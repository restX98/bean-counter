import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { inOrder, ledger } from "../domain/ledger.ts";
import { ruleChecker } from "../domain/rules.ts";
import type { Db } from "./db/index.ts";
import {
  accounts,
  balanceChecks,
  categories,
  transactions,
} from "./db/schema.ts";
import { loadRules } from "./rules.ts";
import { findTransfers } from "./transfers.ts";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

export function transactionRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const findAccount = (id: number) =>
    db.select().from(accounts).where(eq(accounts.id, id)).get();

  // S4: the account's transactions, newest first, each with the balance
  // after it, and where the bank's balances disagree with the app's. An
  // uncategorized one says which categories its rules disagree on, if any;
  // a transfer gives its other side, and a possible one says so.
  app.get<WithId>(
    "/api/accounts/:id/transactions",
    { schema: { params: idParams } },
    (req, reply) => {
      const account = findAccount(req.params.id);
      if (!account) return reply.code(404).send({ error: "Not found" });

      const { entries, gaps, offDays, checks } = loadLedger(db, account);
      const { candidates } = findTransfers(db);
      // A possible transfer: how many could be its other side, and where.
      const toPick = (id: number) => {
        const list = candidates.get(id);
        return list
          ? {
              count: list.length,
              accountIds: [...new Set(list.map((c) => c.accountId))],
            }
          : null;
      };
      const check = ruleChecker(loadRules(db));
      const conflict = (t: (typeof entries)[number]) => {
        if (t.categoryId !== null || t.transferWith !== null || t.excluded) {
          return null;
        }
        const outcome = check({
          ...t,
          accountId: account.id,
          currency: account.currency,
        });
        return outcome.kind === "conflict"
          ? [...new Set(outcome.rules.map((r) => r.categoryId))]
          : null;
      };
      // The other side of each transfer.
      const linkedIds = entries.flatMap((t) =>
        t.transferWith === null ? [] : [t.transferWith],
      );
      const others = new Map(
        (linkedIds.length === 0
          ? []
          : db
              .select({
                id: transactions.id,
                accountId: transactions.accountId,
                date: transactions.date,
                time: transactions.time,
                amount: transactions.amount,
                description: transactions.description,
              })
              .from(transactions)
              .where(inArray(transactions.id, linkedIds))
              .all()
        ).map((other) => [other.id, other]),
      );
      return {
        transactions: entries.toReversed().map((t) => ({
          id: t.id,
          date: t.date,
          time: t.time,
          amount: t.amount,
          description: t.description,
          reference: t.reference,
          bankBalance: t.bankBalance,
          excluded: t.excluded,
          nearMatchOf: t.nearMatchOf,
          categoryId: t.categoryId,
          ruleId: t.ruleId,
          conflict: conflict(t),
          toPick: toPick(t.id),
          transfer:
            t.transferWith === null
              ? null
              : (others.get(t.transferWith) ?? null),
          balance: t.balance,
        })),
        gaps: gaps.map(({ suspects, ...gap }) => ({
          ...gap,
          suspects: suspects.map(({ reason, transaction: t }) => ({
            reason,
            id: t.id,
            date: t.date,
            time: t.time,
            amount: t.amount,
            description: t.description,
          })),
        })),
        offDays,
        // The balances I entered, newest first, each with the app's that day.
        checks: checks.toReversed().map((c) => ({
          id: c.id,
          date: c.date,
          amount: c.balance,
          app: c.app,
        })),
      };
    },
  );

  const findTransaction = (id: number) =>
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        transferWith: transactions.transferWith,
      })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
  const transfer = (reply: FastifyReply) =>
    reply.code(409).send({
      error: "It's a transfer, so it has no category. Unlink it first.",
    });
  const archived = (reply: FastifyReply) =>
    reply.code(409).send({
      error: "This account is archived. Unarchive it to change it.",
    });

  // S6: sets the transaction's category, or takes it away (null).
  app.put<WithId & { Body: { categoryId: number | null } }>(
    "/api/transactions/:id/category",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["categoryId"],
          properties: { categoryId: { type: ["integer", "null"] } },
        },
      },
    },
    (req, reply) => {
      const row = findTransaction(req.params.id);
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (findAccount(row.accountId)?.archivedOn) return archived(reply);
      if (row.transferWith !== null) return transfer(reply);
      const { categoryId } = req.body;
      if (
        categoryId !== null &&
        !db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, categoryId))
          .get()
      ) {
        return reply
          .code(400)
          .send({ error: "This category doesn't exist any more." });
      }
      // Picked by hand: no rule gave it.
      db.update(transactions)
        .set({ categoryId, ruleId: null })
        .where(eq(transactions.id, row.id))
        .run();
      return reply.code(204).send();
    },
  );

  // S2, Use it: the category the rules agree on now, credited to them. The
  // transaction must still have none, and the rules must still agree.
  app.post<WithId>(
    "/api/transactions/:id/apply-rules",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          description: transactions.description,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          transferWith: transactions.transferWith,
        })
        .from(transactions)
        .where(eq(transactions.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      const account = findAccount(row.accountId)!;
      if (account.archivedOn) return archived(reply);
      if (row.transferWith !== null) return transfer(reply);
      if (row.categoryId !== null) {
        return reply.code(409).send({ error: "It already has a category." });
      }
      const outcome = ruleChecker(loadRules(db))({
        ...row,
        currency: account.currency,
      });
      if (outcome.kind !== "category") {
        return reply.code(409).send({
          error: "No rule gives it a category any more. Pick one instead.",
        });
      }
      const { categoryId, ruleId } = outcome;
      db.update(transactions)
        .set({ categoryId, ruleId })
        .where(eq(transactions.id, row.id))
        .run();
      return { categoryId, ruleId };
    },
  );

  // Excluding takes a transaction out of balances, reports and budgets; it
  // stays listed, greyed out, and still counts as a duplicate on re-import.
  // A transfer loses its other side, which becomes a normal transaction.
  const setExcluded =
    (excluded: boolean) =>
    (req: FastifyRequest<WithId>, reply: FastifyReply) => {
      const row = findTransaction(req.params.id);
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (findAccount(row.accountId)?.archivedOn) return archived(reply);
      db.transaction(() => {
        if (excluded && row.transferWith !== null) {
          db.update(transactions)
            .set({ transferWith: null })
            .where(eq(transactions.id, row.transferWith))
            .run();
        }
        db.update(transactions)
          .set(excluded ? { excluded, transferWith: null } : { excluded })
          .where(eq(transactions.id, row.id))
          .run();
      });
      return reply.code(204).send();
    };
  app.post<WithId>(
    "/api/transactions/:id/exclude",
    { schema: { params: idParams } },
    setExcluded(true),
  );
  app.post<WithId>(
    "/api/transactions/:id/restore",
    { schema: { params: idParams } },
    setExcluded(false),
  );
}

/**
 * An account's transactions in order with their balances, and where the
 * bank's balances disagree (see `ledger`). Without an anchor there's nothing
 * to compare, but every import sets one.
 */
export function loadLedger(db: Db, account: typeof accounts.$inferSelect) {
  const rows = db
    .select({
      id: transactions.id,
      importId: transactions.importId,
      line: transactions.line,
      date: transactions.date,
      time: transactions.time,
      amount: transactions.amount,
      description: transactions.description,
      reference: transactions.reference,
      bankBalance: transactions.bankBalance,
      excluded: transactions.excluded,
      nearMatchOf: transactions.nearMatchOf,
      categoryId: transactions.categoryId,
      ruleId: transactions.ruleId,
      transferWith: transactions.transferWith,
    })
    .from(transactions)
    .where(eq(transactions.accountId, account.id))
    .all()
    .map((row) => ({ ...row, keptNearMatch: row.nearMatchOf !== null }));

  const entered = db
    .select({
      id: balanceChecks.id,
      date: balanceChecks.date,
      balance: balanceChecks.amount,
    })
    .from(balanceChecks)
    .where(eq(balanceChecks.accountId, account.id))
    .all();

  return account.anchorAmount !== null && account.anchorDate !== null
    ? ledger(
        { amount: account.anchorAmount, date: account.anchorDate },
        rows,
        entered,
      )
    : {
        entries: inOrder(rows).map((row) => ({ ...row, balance: null })),
        gaps: [],
        offDays: [],
        checks: [],
      };
}
