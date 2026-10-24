import { eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  filterer,
  readPeriod,
  TRANSACTION_TYPES,
  transactionType,
  type TransactionType,
} from "../domain/filters.ts";
import { inOrder, ledger } from "../domain/ledger.ts";
import { linkedInFull, paybackTotals } from "../domain/paybacks.ts";
import { ruleChecker } from "../domain/rules.ts";
import type { Db } from "./db/index.ts";
import {
  accounts,
  balanceChecks,
  categories,
  paybacks,
  transactions,
} from "./db/schema.ts";
import { findPossiblePaybacks, loadPaybacks } from "./paybacks.ts";
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
  // after it, and where the bank's balances disagree with the app's.
  app.get<WithId>(
    "/api/accounts/:id/transactions",
    { schema: { params: idParams } },
    (req, reply) => {
      const account = findAccount(req.params.id);
      if (!account) return reply.code(404).send({ error: "Not found" });

      const { entries, gaps, offDays, checks } = loadLedger(db, account);
      const list = lister(db, entries);
      return {
        transactions: entries.toReversed().map((t) => ({
          ...list(t, account),
          bankBalance: t.bankBalance,
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

  // S5: every account's transactions, archived ones included, newest
  // first: the first `limit` of those that pass the filters, how many pass
  // in all, and the months that have any, newest first, to pick a period.
  app.get<{
    Querystring: {
      q: string;
      limit: number;
      account?: number;
      currency?: string;
      period?: string;
      category?: number;
      type?: TransactionType;
    };
  }>(
    "/api/transactions",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string", default: "" },
            limit: { type: "integer", minimum: 1, default: 50 },
            account: { type: "integer" },
            currency: { type: "string" },
            period: { type: "string" },
            category: { type: "integer" },
            type: { type: "string", enum: [...TRANSACTION_TYPES] },
          },
        },
      },
    },
    (req, reply) => {
      const { q, limit, account, currency, period, category, type } = req.query;
      const months = period === undefined ? null : readPeriod(period);
      if (period !== undefined && !months) {
        return reply.code(400).send({
          error:
            "Give the period as a month, 2026-10, or months, 2026-08..2026-10.",
        });
      }
      const owners = new Map(
        db
          .select()
          .from(accounts)
          .all()
          .map((a) => [a.id, a]),
      );
      const categoryTypes = new Map(
        db
          .select({ id: categories.id, type: categories.type })
          .from(categories)
          .all()
          .map((c) => [c.id, c.type]),
      );
      const transfers = findTransfers(db);
      const { candidates } = transfers;
      const totals = paybackTotals(loadPaybacks(db));
      const possible = new Set(
        findPossiblePaybacks(db, transfers).map((t) => t.id),
      );
      const all = inOrder(
        db
          .select({
            ...LISTED,
            accountId: transactions.accountId,
            importId: transactions.importId,
            line: transactions.line,
          })
          .from(transactions)
          .all(),
      ).toReversed();
      const passes = filterer({
        accountId: account ?? null,
        currency: currency ?? null,
        period: months,
        categoryId: category ?? null,
        type: type ?? null,
        q,
      });
      const found = all.filter((t) =>
        passes({
          ...t,
          currency: owners.get(t.accountId)!.currency,
          type: transactionType({
            excluded: t.excluded,
            transfer: t.transferWith !== null || candidates.has(t.id),
            payback: linkedInFull(t, totals) || possible.has(t.id),
            categoryType:
              t.categoryId === null
                ? null
                : (categoryTypes.get(t.categoryId) ?? null),
          }),
        }),
      );
      const page = found.slice(0, limit);
      const list = lister(db, page, transfers);
      return {
        transactions: page.map((t) => ({
          ...list(t, owners.get(t.accountId)!),
          accountId: t.accountId,
        })),
        total: found.length,
        months: [...new Set(all.map((t) => t.date.slice(0, 7)))],
      };
    },
  );

  // S6 over S5: one transaction as the lists show it, so that its panel
  // stays open when a filter leaves it out of the list.
  app.get<WithId>(
    "/api/transactions/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = db
        .select({ ...LISTED, accountId: transactions.accountId })
        .from(transactions)
        .where(eq(transactions.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      return {
        ...lister(db, [row])(row, findAccount(row.accountId)!),
        accountId: row.accountId,
      };
    },
  );

  const findTransaction = (id: number) =>
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amount: transactions.amount,
        transferWith: transactions.transferWith,
      })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
  const transfer = (reply: FastifyReply) =>
    reply.code(409).send({
      error: "It's a transfer, so it has no category. Unlink it first.",
    });
  const allPayback = (row: { id: number; amount: number }) =>
    linkedInFull(row, paybackTotals(loadPaybacks(db, row.id)));
  const payback = (reply: FastifyReply) =>
    reply.code(409).send({
      error:
        "All of it pays back expenses, so it has no category. Link less of it, or unlink it, first.",
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
      if (allPayback(row)) return payback(reply);
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
      if (allPayback(row)) return payback(reply);
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
  // A transfer loses its other side, which becomes a normal transaction,
  // and a payback or an expense loses its links. Restoring brings neither
  // back.
  const setExcluded =
    (excluded: boolean) =>
    (req: FastifyRequest<WithId>, reply: FastifyReply) => {
      const row = findTransaction(req.params.id);
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (findAccount(row.accountId)?.archivedOn) return archived(reply);
      db.transaction(() => {
        if (excluded) {
          db.delete(paybacks)
            .where(
              or(
                eq(paybacks.paymentId, row.id),
                eq(paybacks.expenseId, row.id),
              ),
            )
            .run();
        }
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

/** The columns a list shows a transaction with (S4, S5). */
const LISTED = {
  id: transactions.id,
  date: transactions.date,
  time: transactions.time,
  amount: transactions.amount,
  description: transactions.description,
  reference: transactions.reference,
  excluded: transactions.excluded,
  nearMatchOf: transactions.nearMatchOf,
  categoryId: transactions.categoryId,
  ruleId: transactions.ruleId,
  transferWith: transactions.transferWith,
};

type Listed = Pick<typeof transactions.$inferSelect, keyof typeof LISTED>;

/**
 * Shows the rows as a list does (S4, S5). An uncategorized one says which
 * categories its rules disagree on, if any; a transfer gives its other
 * side, and a possible one says how many could be that side, and where. A
 * payment says how many expenses it pays back and how much of it that
 * takes; an expense, how many paybacks it has and what they add up to. A
 * possible payback says how many expenses it could pay back.
 */
function lister(db: Db, rows: Listed[], transfers = findTransfers(db)) {
  const { candidates } = transfers;
  const check = ruleChecker(loadRules(db));
  const possible = new Map(
    findPossiblePaybacks(db, transfers).map((t) => [t.id, t.expenses.length]),
  );
  const paybacks = new Map<number, { count: number; total: number }>();
  for (const { paymentId, expenseId, amount } of loadPaybacks(db)) {
    for (const id of [paymentId, expenseId]) {
      const sum = paybacks.get(id) ?? { count: 0, total: 0 };
      paybacks.set(id, { count: sum.count + 1, total: sum.total + amount });
    }
  }
  const linkedIds = rows.flatMap((t) =>
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

  return (t: Listed, account: { id: number; currency: string }) => {
    const toPick = candidates.get(t.id);
    const outcome =
      t.categoryId !== null || t.transferWith !== null || t.excluded
        ? null
        : check({ ...t, accountId: account.id, currency: account.currency });
    return {
      id: t.id,
      date: t.date,
      time: t.time,
      amount: t.amount,
      description: t.description,
      reference: t.reference,
      excluded: t.excluded,
      nearMatchOf: t.nearMatchOf,
      categoryId: t.categoryId,
      ruleId: t.ruleId,
      conflict:
        outcome?.kind === "conflict"
          ? [...new Set(outcome.rules.map((r) => r.categoryId))]
          : null,
      toPick: toPick
        ? {
            count: toPick.length,
            accountIds: [...new Set(toPick.map((c) => c.accountId))],
          }
        : null,
      transfer:
        t.transferWith === null ? null : (others.get(t.transferWith) ?? null),
      paybacks: paybacks.get(t.id) ?? null,
      possiblePayback: possible.get(t.id) ?? null,
    };
  };
}

/**
 * An account's transactions in order with their balances, and where the
 * bank's balances disagree (see `ledger`). Without an anchor there's nothing
 * to compare, but every import sets one.
 */
export function loadLedger(db: Db, account: typeof accounts.$inferSelect) {
  const rows = db
    .select({
      ...LISTED,
      importId: transactions.importId,
      line: transactions.line,
      bankBalance: transactions.bankBalance,
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
