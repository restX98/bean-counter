import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  matchTransfers,
  pairKey,
  TRANSFER_WINDOW,
} from "../domain/transfers.ts";
import type { Db } from "./db/index.ts";
import { accounts, transactions, transferDismissals } from "./db/schema.ts";

/**
 * The transactions that could still be part of a transfer: counted, not
 * linked, in accounts that aren't archived.
 */
const loadUnlinked = (db: Db) =>
  db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      currency: accounts.currency,
      date: transactions.date,
      amount: transactions.amount,
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

const loadDismissed = (db: Db) =>
  new Set(
    db
      .select()
      .from(transferDismissals)
      .all()
      .map(({ low, high }) => pairKey(low, high)),
  );

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

/**
 * Links every pair of transactions that are each other's only candidate,
 * and returns how many it linked. Run inside the caller's transaction.
 */
export function linkTransfers(db: Db): number {
  const { links } = matchTransfers(loadUnlinked(db), {
    window: TRANSFER_WINDOW,
    dismissed: loadDismissed(db),
  });
  for (const link of links) setTransfer(db, link.out.id, link.in.id, true);
  return links.length;
}

interface WithId {
  Params: { id: number };
}

export function transferRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S6, Unlink: both sides become normal, uncategorized transactions, and
  // the pair is never linked on its own again.
  app.post<WithId>(
    "/api/transactions/:id/unlink",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer" } },
        },
      },
    },
    (req, reply) => {
      const row = db
        .select({
          id: transactions.id,
          transferWith: transactions.transferWith,
          archivedOn: accounts.archivedOn,
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(eq(transactions.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (row.transferWith === null) {
        return reply.code(409).send({ error: "It isn't linked." });
      }
      const other = db
        .select({ archivedOn: accounts.archivedOn })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(eq(transactions.id, row.transferWith))
        .get();
      if (row.archivedOn || other?.archivedOn) {
        return reply.code(409).send({
          error: "One side is in an archived account. Unarchive it first.",
        });
      }
      const [low, high] = [row.id, row.transferWith].sort((a, b) => a - b) as [
        number,
        number,
      ];
      db.transaction(() => {
        setTransfer(db, low, high, false);
        db.insert(transferDismissals)
          .values({ low, high })
          .onConflictDoNothing()
          .run();
      });
      return reply.code(204).send();
    },
  );
}
