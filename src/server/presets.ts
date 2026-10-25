import { desc, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { checkMapping, type Mapping } from "../domain/import/mapping.ts";
import type { Db } from "./db/index.ts";
import { accounts, importPresets, imports, transactions } from "./db/schema.ts";
import { mappingSchema } from "./imports.ts";

/** As many sample rows as an uploaded file gets. */
const SAMPLE_ROWS = 10;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: "Not found" });

export function presetRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const find = (id: number) =>
    db.select().from(importPresets).where(eq(importPresets.id, id)).get();

  // S18: the saved formats, with the accounts they've been used for and the
  // day of their last import.
  app.get("/api/presets", () => {
    const uses = db
      .select({
        presetId: imports.presetId,
        account: accounts.name,
        importedOn: imports.importedOn,
      })
      .from(imports)
      .innerJoin(accounts, eq(accounts.id, imports.accountId))
      .where(isNotNull(imports.presetId))
      .all();
    const presets = db
      .select()
      .from(importPresets)
      .orderBy(importPresets.name)
      .all()
      .map((preset) => {
        const mine = uses.filter((use) => use.presetId === preset.id);
        return {
          id: preset.id,
          name: preset.name,
          columns: preset.columns.length,
          balance: preset.mapping.roles.includes("balance"),
          accounts: [...new Set(mine.map((use) => use.account))].sort(),
          lastUsed:
            mine
              .map((use) => use.importedOn)
              .sort()
              .at(-1) ?? null,
        };
      });
    return { presets };
  });

  // S8 opened from S18: the preset, with its last import, whose first rows
  // are the samples.
  app.get<WithId>(
    "/api/presets/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const preset = find(req.params.id);
      if (!preset) return notFound(reply);
      const last = db
        .select({
          id: imports.id,
          fileName: imports.fileName,
          importedOn: imports.importedOn,
          account: accounts.name,
          currency: accounts.currency,
        })
        .from(imports)
        .innerJoin(accounts, eq(accounts.id, imports.accountId))
        .where(eq(imports.presetId, preset.id))
        .orderBy(desc(imports.importedOn), desc(imports.id))
        .limit(1)
        .get();
      const sample = last
        ? db
            .select({ line: transactions.line, cells: transactions.raw })
            .from(transactions)
            .where(eq(transactions.importId, last.id))
            .orderBy(transactions.line)
            .limit(SAMPLE_ROWS)
            .all()
        : [];
      return {
        id: preset.id,
        name: preset.name,
        columns: preset.columns,
        mapping: preset.mapping,
        lastImport: last && {
          fileName: last.fileName,
          importedOn: last.importedOn,
          account: last.account,
          currency: last.currency,
        },
        sample,
      };
    },
  );

  // The change applies to the next files in this format. What was imported
  // with the preset stays as it is.
  app.patch<WithId & { Body: { name: string; mapping: Mapping } }>(
    "/api/presets/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["name", "mapping"],
          properties: { name: { type: "string" }, mapping: mappingSchema },
        },
      },
    },
    (req, reply) => {
      const preset = find(req.params.id);
      if (!preset) return notFound(reply);
      const { mapping } = req.body;
      const name = req.body.name.trim();
      const errors: Record<string, string> = {};
      if (name === "") errors.name = "Give the preset a name.";
      const problems = checkMapping(mapping);
      if (mapping.roles.length !== preset.columns.length) {
        problems.unshift("The mapping doesn't fit this preset's columns.");
      }
      if (problems.length > 0) errors.mapping = problems.join(" ");
      if (Object.keys(errors).length > 0) {
        return reply.code(400).send({ errors });
      }
      db.update(importPresets)
        .set({ name, mapping })
        .where(eq(importPresets.id, preset.id))
        .run();
      return reply.code(204).send();
    },
  );

  // The imports made with it keep their own copy of the mapping, so nothing
  // else changes. The next file in this format goes through S8 again.
  app.delete<WithId>(
    "/api/presets/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const deleted = db
        .delete(importPresets)
        .where(eq(importPresets.id, req.params.id))
        .returning({ id: importPresets.id })
        .get();
      if (!deleted) return notFound(reply);
      return reply.code(204).send();
    },
  );
}
