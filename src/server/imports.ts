import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateAnchor,
  type Anchor,
  type AnchorFields,
} from "../domain/accounts.ts";
import {
  checkMapping,
  COLUMN_ROLES,
  readRows,
  type Mapping,
} from "../domain/import/mapping.ts";
import {
  isImported,
  planImport,
  type Decision,
} from "../domain/import/plan.ts";
import type { Table } from "../domain/import/table.ts";
import { DATE_FORMATS } from "../domain/import/values.ts";
import type { Db } from "./db/index.ts";
import { accounts, importPresets, imports, transactions } from "./db/schema.ts";
import { readStatementFile } from "./statements.ts";

// The import in three steps, one per screen: upload a file (S7), preview it
// with a mapping and my decisions (S8, S9), save it (S9's Import button).

/** A file waiting between the steps. It's lost if the server restarts. */
interface Upload {
  accountId: number;
  fileName: string;
  table: Table;
  openedAt: number;
}

const MAX_FILE = 20 * 1024 * 1024;
const KEEP_UPLOADS = 10;
const UPLOAD_LIFETIME = 60 * 60 * 1000;
/** Rows sent back with an upload, for S8's samples and live preview. */
const SAMPLE_ROWS = 10;
/** Rows per insert, well under SQLite's limit on query parameters. */
const INSERT_BATCH = 500;

interface PlanBody {
  mapping: Mapping;
  /** Near-match decisions, by line. */
  decisions?: Record<string, Decision>;
  /** The current balance, when the plan asks for it. */
  balance?: AnchorFields;
}

const mappingSchema = {
  type: "object",
  required: ["roles", "dateFormat", "decimalMark"],
  properties: {
    roles: { type: "array", items: { enum: [...COLUMN_ROLES] } },
    dateFormat: { enum: [...DATE_FORMATS] },
    decimalMark: { enum: ["point", "comma"] },
  },
} as const;
const planProperties = {
  mapping: mappingSchema,
  decisions: {
    type: "object",
    additionalProperties: { enum: ["keep", "skip"] },
  },
  balance: {
    type: "object",
    required: ["amount", "date"],
    properties: { amount: { type: "string" }, date: { type: "string" } },
  },
} as const;
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

/** A request the plan can't go ahead with: the reply to send instead. */
class Refusal {
  readonly status: number;
  readonly body: object;

  constructor(status: number, body: object) {
    this.status = status;
    this.body = body;
  }
}

export function importRoutes(
  app: FastifyInstance,
  { db, today }: { db: Db; today: () => string },
) {
  const uploads = new Map<string, Upload>();

  // Files arrive as the request body, without multipart encoding.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_FILE },
    (_req, body, done) => done(null, body),
  );

  /** The account to import into: it must exist and not be archived. */
  function openAccount(id: number) {
    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) throw new Refusal(404, { error: "Not found" });
    if (account.archivedOn) {
      throw new Refusal(409, {
        error: "This account is archived. Unarchive it to import into it.",
      });
    }
    return account;
  }

  function upload(id: string): Upload {
    const found = uploads.get(id);
    if (!found) {
      throw new Refusal(404, {
        error: "This file is no longer open. Choose it again.",
      });
    }
    return found;
  }

  function plan(file: Upload, { mapping, decisions, balance }: PlanBody) {
    const account = openAccount(file.accountId);
    const problems = checkMapping(mapping);
    if (mapping.roles.length !== file.table.columns.length) {
      problems.unshift("The mapping doesn't fit this file's columns.");
    }
    if (problems.length > 0) {
      throw new Refusal(400, { errors: { mapping: problems.join(" ") } });
    }

    let entered: Pick<Anchor, "amount" | "date"> | null = null;
    if (balance) {
      const checked = validateAnchor(balance, account.currency, today());
      if (!checked.ok) throw new Refusal(400, { errors: checked.errors });
      entered = checked.value;
    }

    const { rows, errors } = readRows(file.table, mapping, account.currency);
    const existing = db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        description: transactions.description,
        reference: transactions.reference,
        excluded: transactions.excluded,
        nearMatchOf: transactions.nearMatchOf,
      })
      .from(transactions)
      .where(eq(transactions.accountId, account.id))
      .all();
    const anchor: Anchor | null =
      account.anchorAmount !== null &&
      account.anchorDate !== null &&
      account.anchorSource !== null
        ? {
            amount: account.anchorAmount,
            date: account.anchorDate,
            source: account.anchorSource,
          }
        : null;
    return {
      account,
      unreadable: errors,
      ...planImport({ rows, existing, anchor, decisions, balance: entered }),
    };
  }

  /** Runs a step, turning a refusal into its reply. */
  const step =
    <R>(handler: (req: R, reply: FastifyReply) => unknown) =>
    async (req: R, reply: FastifyReply) => {
      try {
        return await handler(req, reply);
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.status).send(error.body);
        }
        throw error;
      }
    };

  // S7: the file and the account to import it into.
  app.post<{ Querystring: { account: number; file: string }; Body: unknown }>(
    "/api/imports",
    {
      bodyLimit: MAX_FILE,
      schema: {
        querystring: {
          type: "object",
          required: ["account", "file"],
          properties: {
            account: { type: "integer" },
            file: { type: "string", minLength: 1 },
          },
        },
      },
    },
    step(async (req, reply) => {
      const account = openAccount(req.query.account);
      if (!Buffer.isBuffer(req.body)) {
        throw new Refusal(415, {
          error: "Send the file as application/octet-stream.",
        });
      }
      const read = await readStatementFile(req.body);
      if (!read.ok) throw new Refusal(400, { error: read.error });

      // Forget files left behind: too old, or too many.
      const now = Date.now();
      for (const [id, { openedAt }] of uploads) {
        if (now - openedAt > UPLOAD_LIFETIME) uploads.delete(id);
      }
      while (uploads.size >= KEEP_UPLOADS) {
        uploads.delete(uploads.keys().next().value!);
      }
      const id = randomUUID();
      const { table } = read;
      uploads.set(id, {
        accountId: account.id,
        fileName: req.query.file,
        table,
        openedAt: now,
      });

      const preset = db
        .select()
        .from(importPresets)
        .where(eq(importPresets.columns, table.columns))
        .get();
      return reply.code(201).send({
        id,
        fileName: req.query.file,
        columns: table.columns,
        rowCount: table.rows.length,
        sample: table.rows.slice(0, SAMPLE_ROWS),
        preset: preset
          ? { id: preset.id, name: preset.name, mapping: preset.mapping }
          : null,
      });
    }),
  );

  // S8 and S9: what the import would do. Asked again as I change things.
  app.post<{ Params: { id: string }; Body: PlanBody }>(
    "/api/imports/:id/preview",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["mapping"],
          properties: planProperties,
        },
      },
    },
    step((req) => {
      const { rows, unreadable, needsBalance, anchor, gaps } = plan(
        upload(req.params.id),
        req.body,
      );
      return { rows, unreadable, needsBalance, anchor, gaps };
    }),
  );

  // S9's Import button. The mapping is saved as a preset unless presetName
  // is null; a preset for the same columns is updated.
  app.post<{
    Params: { id: string };
    Body: PlanBody & { presetName: string | null };
  }>(
    "/api/imports/:id/save",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["mapping", "presetName"],
          properties: {
            ...planProperties,
            presetName: { type: ["string", "null"] },
          },
        },
      },
    },
    step((req, reply) => {
      const file = upload(req.params.id);
      const { account, unreadable, rows, needsBalance, anchor, gaps } = plan(
        file,
        req.body,
      );
      if (rows.some((r) => r.status === "near-match" && !r.decision)) {
        throw new Refusal(400, {
          error: "Decide whether to keep or skip each near-match first.",
        });
      }
      if (needsBalance && !anchor) {
        throw new Refusal(400, {
          errors: { anchorAmount: "Enter the balance." },
        });
      }
      const presetName = req.body.presetName?.trim() ?? null;
      if (presetName === "") {
        throw new Refusal(400, {
          errors: { presetName: "Give the format a name." },
        });
      }

      const { columns } = file.table;
      const { mapping } = req.body;
      const cells = new Map(file.table.rows.map((r) => [r.line, r.cells]));
      const saved = rows.filter(isImported);

      const importId = db.transaction((tx) => {
        const preset =
          presetName === null
            ? null
            : tx
                .insert(importPresets)
                .values({ name: presetName, columns, mapping })
                .onConflictDoUpdate({
                  target: importPresets.columns,
                  set: { name: presetName, mapping },
                })
                .returning({ id: importPresets.id })
                .get();
        const { id } = tx
          .insert(imports)
          .values({
            accountId: account.id,
            presetId: preset?.id ?? null,
            fileName: file.fileName,
            importedOn: today(),
            columns,
            mapping,
          })
          .returning({ id: imports.id })
          .get();
        for (let i = 0; i < saved.length; i += INSERT_BATCH) {
          tx.insert(transactions)
            .values(
              saved.slice(i, i + INSERT_BATCH).map((row) => ({
                accountId: account.id,
                importId: id,
                line: row.line,
                date: row.date,
                amount: row.amount,
                description: row.description,
                reference: row.reference,
                bankBalance: row.balance,
                raw: cells.get(row.line)!,
                nearMatchOf: row.status === "near-match" ? row.match!.id : null,
              })),
            )
            .run();
        }
        if (anchor) {
          tx.update(accounts)
            .set({
              anchorAmount: anchor.amount,
              anchorDate: anchor.date,
              anchorSource: anchor.source,
            })
            .where(eq(accounts.id, account.id))
            .run();
        }
        return id;
      });
      uploads.delete(req.params.id);

      // S10.
      return reply.code(201).send({
        importId,
        imported: saved.length,
        skipped: rows.length - saved.length,
        unreadable: unreadable.length,
        anchor,
        gaps,
      });
    }),
  );
}
