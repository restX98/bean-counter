import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  exchangeSuggestions,
  linkOptions,
  matchTransfers,
  pairKey,
  TRANSFER_WINDOW,
} from "../domain/transfers.ts";
import type { Db } from "./db/index.ts";
import {
  accounts,
  categories,
  rules,
  settings,
  transactions,
  transferDismissals,
} from "./db/schema.ts";

/** How many days apart the two sides of a transfer can be (S18). */
export function transferWindow(db: Db): number {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, "transferWindow"))
    .get();
  return typeof row?.value === "number" ? row.value : TRANSFER_WINDOW;
}

/**
 * The transactions that could still be part of a transfer: counted, not
 * linked, in accounts that aren't archived.
 */
export const loadTransferPool = (db: Db) =>
  db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      currency: accounts.currency,
      date: transactions.date,
      time: transactions.time,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        isNull(transactions.transferWith),
        eq(transactions.excluded, false),
        isNull(accounts.archivedOn),
      ),
    )
    .all();

export const loadDismissed = (db: Db) =>
  new Set(
    db
      .select()
      .from(transferDismissals)
      .all()
      .map(({ low, high }) => pairKey(low, high)),
  );

/**
 * The pool, what links on its own, the candidates of everything else, and
 * the pairs across currencies to suggest. A transaction that has candidates
 * waits for that decision before it's paired across currencies.
 */
export function findTransfers(db: Db) {
  const pool = loadTransferPool(db);
  const options = { window: transferWindow(db), dismissed: loadDismissed(db) };
  const { links, candidates } = matchTransfers(pool, options);
  const linked = new Set(links.flatMap((l) => [l.out.id, l.in.id]));
  return {
    pool,
    links,
    candidates,
    exchanges: exchangeSuggestions(
      pool.filter((t) => !linked.has(t.id) && !candidates.has(t.id)),
      options,
    ),
  };
}

/** What a decision changed, so that Undo can put it back. */
export interface TransferChange {
  /** The pairs it linked: the one I picked, then those that linked on their own. */
  linked: [number, number][];
  /** The pairs it dismissed. */
  dismissed: [number, number][];
  /** The categories the linked transactions had before. */
  before: { id: number; categoryId: number | null; ruleId: number | null }[];
}

/** Points two transactions at each other, or apart. */
function setTransfer(db: Db, a: number, b: number, linked: boolean) {
  for (const [id, other] of [
    [a, b],
    [b, a],
  ] as const) {
    db.update(transactions)
      // A transfer has no category, and unlinking doesn't bring one back.
      .set({
        transferWith: linked ? other : null,
        categoryId: null,
        ruleId: null,
      })
      .where(eq(transactions.id, id))
      .run();
  }
}

/** Links pairs, and returns the categories they had. */
function link(db: Db, pairs: [number, number][]): TransferChange["before"] {
  const ids = pairs.flat();
  const before =
    ids.length === 0
      ? []
      : db
          .select({
            id: transactions.id,
            categoryId: transactions.categoryId,
            ruleId: transactions.ruleId,
          })
          .from(transactions)
          .where(inArray(transactions.id, ids))
          .all();
  for (const [a, b] of pairs) setTransfer(db, a, b, true);
  return before;
}

/**
 * Links every pair of transactions that are each other's only candidate.
 * Run after anything that changes the candidates, inside the caller's
 * transaction.
 */
export function linkTransfers(
  db: Db,
): Pick<TransferChange, "linked" | "before"> {
  const linked = findTransfers(db).links.map(
    (l) => [l.out.id, l.in.id] as [number, number],
  );
  return { linked, before: link(db, linked) };
}

function dismiss(db: Db, a: number, b: number): [number, number] {
  const [low, high] = a < b ? [a, b] : [b, a];
  db.insert(transferDismissals)
    .values({ low, high })
    .onConflictDoNothing()
    .run();
  return [low, high];
}

interface WithId {
  Params: { id: number };
}

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

const pairs = {
  type: "array",
  items: {
    type: "array",
    items: { type: "integer" },
    minItems: 2,
    maxItems: 2,
  },
} as const;

export function transferRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const find = (id: number) =>
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        currency: accounts.currency,
        date: transactions.date,
        amount: transactions.amount,
        excluded: transactions.excluded,
        transferWith: transactions.transferWith,
        archivedOn: accounts.archivedOn,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(eq(transactions.id, id))
      .get();
  type Row = NonNullable<ReturnType<typeof find>>;

  /**
   * A transaction that can still become one side of a transfer. When it
   * can't, the reply says why and it's null.
   */
  const unlinked = (id: number, reply: FastifyReply): Row | null => {
    const row = find(id);
    const refuse = (status: number, error: string) => {
      reply.code(status).send({ error });
      return null;
    };
    if (!row) return refuse(404, "Not found");
    if (row.archivedOn) {
      return refuse(
        409,
        "This account is archived. Unarchive it to change it.",
      );
    }
    if (row.transferWith !== null) return refuse(409, "It's already linked.");
    if (row.excluded)
      return refuse(409, "It's excluded. Restore it to link it.");
    return row;
  };

  // D4: what the transaction can be linked with by hand.
  app.get<WithId>(
    "/api/transactions/:id/link-options",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = unlinked(req.params.id, reply);
      if (!row) return reply;
      const window = transferWindow(db);
      const options = linkOptions(row, loadTransferPool(db), window);
      return {
        window,
        options: options.map(
          ({ id, accountId, date, time, amount, description }) => ({
            id,
            accountId,
            date,
            time,
            amount,
            description,
          }),
        ),
      };
    },
  );

  // D4, Link: the pair I picked, then whatever now links on its own.
  app.post<WithId & { Body: { otherId: number } }>(
    "/api/transactions/:id/link",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["otherId"],
          properties: { otherId: { type: "integer" } },
        },
      },
    },
    (req, reply) => {
      const row = unlinked(req.params.id, reply);
      if (!row) return reply;
      const options = linkOptions(
        row,
        loadTransferPool(db),
        transferWindow(db),
      );
      if (!options.some((o) => o.id === req.body.otherId)) {
        return reply.code(409).send({
          error: "These two can't be linked any more. Pick another one.",
        });
      }
      const pair: [number, number] =
        row.amount < 0
          ? [row.id, req.body.otherId]
          : [req.body.otherId, row.id];
      const change: TransferChange = db.transaction(() => {
        const before = link(db, [pair]);
        const more = linkTransfers(db);
        return {
          linked: [pair, ...more.linked],
          dismissed: [],
          before: [...before, ...more.before],
        };
      });
      return change;
    },
  );

  // S2, Not a transfer: none of its candidates is its other side. With
  // `otherId`, only that pair isn't one, such as an exchange I was suggested.
  app.post<WithId & { Body: { otherId?: number } | undefined }>(
    "/api/transactions/:id/not-a-transfer",
    {
      schema: {
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: { otherId: { type: "integer" } },
        },
      },
    },
    (req, reply) => {
      const row = unlinked(req.params.id, reply);
      if (!row) return reply;
      const otherId = req.body?.otherId;
      const candidates =
        otherId === undefined
          ? (findTransfers(db).candidates.get(row.id) ?? [])
          : linkOptions(row, loadTransferPool(db), transferWindow(db)).filter(
              (o) => o.id === otherId,
            );
      if (candidates.length === 0) {
        return reply.code(409).send({
          error: "Nothing in your other accounts could be its other side.",
        });
      }
      const change: TransferChange = db.transaction(() => {
        const dismissed = candidates.map((c) => dismiss(db, row.id, c.id));
        return { dismissed, ...linkTransfers(db) };
      });
      return change;
    },
  );

  // Undo, right after Link or Not a transfer: puts back what it changed.
  app.post<{ Body: TransferChange }>(
    "/api/transfers/undo",
    {
      schema: {
        body: {
          type: "object",
          required: ["linked", "dismissed", "before"],
          properties: {
            linked: pairs,
            dismissed: pairs,
            before: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "categoryId", "ruleId"],
                properties: {
                  id: { type: "integer" },
                  categoryId: { type: ["integer", "null"] },
                  ruleId: { type: ["integer", "null"] },
                },
              },
            },
          },
        },
      },
    },
    (req, reply) => {
      const { linked, dismissed, before } = req.body;
      const exists = (table: typeof categories | typeof rules, id: number) =>
        db.select({ id: table.id }).from(table).where(eq(table.id, id)).get();
      db.transaction(() => {
        for (const [a, b] of linked) {
          // Only a pair that's still linked together.
          if (find(a)?.transferWith === b) setTransfer(db, a, b, false);
        }
        for (const { id, categoryId, ruleId } of before) {
          if (find(id)?.transferWith !== null) continue;
          db.update(transactions)
            .set({
              categoryId:
                categoryId !== null && exists(categories, categoryId)
                  ? categoryId
                  : null,
              ruleId: ruleId !== null && exists(rules, ruleId) ? ruleId : null,
            })
            .where(eq(transactions.id, id))
            .run();
        }
        for (const [a, b] of dismissed) {
          db.delete(transferDismissals)
            .where(
              and(
                eq(transferDismissals.low, Math.min(a, b)),
                eq(transferDismissals.high, Math.max(a, b)),
              ),
            )
            .run();
        }
      });
      return reply.code(204).send();
    },
  );

  // S6, Unlink: both sides become normal, uncategorized transactions, and
  // the pair is never linked on its own again.
  app.post<WithId>(
    "/api/transactions/:id/unlink",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (row.transferWith === null) {
        return reply.code(409).send({ error: "It isn't linked." });
      }
      if (row.archivedOn || find(row.transferWith)?.archivedOn) {
        return reply.code(409).send({
          error: "One side is in an archived account. Unarchive it first.",
        });
      }
      const other = row.transferWith;
      db.transaction(() => {
        setTransfer(db, row.id, other, false);
        dismiss(db, row.id, other);
        linkTransfers(db);
      });
      return reply.code(204).send();
    },
  );
}
