import { eq } from "drizzle-orm";
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
  // uncategorized one says which categories its rules disagree on, if any.
  app.get<WithId>(
    "/api/accounts/:id/transactions",
    { schema: { params: idParams } },
    (req, reply) => {
      const account = findAccount(req.params.id);
      if (!account) return reply.code(404).send({ error: "Not found" });

      const { entries, gaps, offDays, checks } = loadLedger(db, account);
      const check = ruleChecker(loadRules(db));
      const conflict = (t: (typeof entries)[number]) => {
        if (t.categoryId !== null || t.excluded) return null;
        const outcome = check({
          ...t,
          accountId: account.id,
          currency: account.currency,
        });
        return outcome.kind === "conflict"
          ? [...new Set(outcome.rules.map((r) => r.categoryId))]
          : null;
      };
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
          balance: t.balance,
        })),
        gaps: gaps.map(({ suspects, ...gap }) => ({
          ...gap,
          suspects: suspects.map(({ reason, transaction: t }) => ({
            reason,
            id: t.id,
            date: t.date,
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
      .select({ id: transactions.id, accountId: transactions.accountId })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
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
        })
        .from(transactions)
        .where(eq(transactions.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      const account = findAccount(row.accountId)!;
      if (account.archivedOn) return archived(reply);
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
  const setExcluded =
    (excluded: boolean) =>
    (req: FastifyRequest<WithId>, reply: FastifyReply) => {
      const row = findTransaction(req.params.id);
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (findAccount(row.accountId)?.archivedOn) return archived(reply);
      db.update(transactions)
        .set({ excluded })
        .where(eq(transactions.id, row.id))
        .run();
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
