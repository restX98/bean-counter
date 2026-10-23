import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { addMonths } from "../domain/dates.ts";
import {
  monthReport,
  reportCurrencies,
  type ReportData,
} from "../domain/reports.ts";
import type { Db } from "./db/index.ts";
import { accounts, categories, transactions } from "./db/schema.ts";
import { findTransfers } from "./transfers.ts";

const MONTH = "^\\d{4}-(0[1-9]|1[0-2])$";

/** Everything a report adds up: archived accounts too, they're history. */
function loadReportData(db: Db) {
  const { candidates, exchanges } = findTransfers(db);
  const data: ReportData = {
    accounts: db
      .select({
        id: accounts.id,
        type: accounts.type,
        currency: accounts.currency,
      })
      .from(accounts)
      .all(),
    categories: db
      .select({ id: categories.id, type: categories.type })
      .from(categories)
      .all(),
    // Only possible transfers in one currency wait for a decision; a
    // suggested exchange counts as it is until I link it.
    transactions: db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        excluded: transactions.excluded,
        transferWith: transactions.transferWith,
      })
      .from(transactions)
      .all()
      .map((t) => ({ ...t, pending: candidates.has(t.id) })),
  };
  const suggested = new Set(exchanges.flatMap((p) => [p.out.id, p.in.id]));
  return { data, suggested };
}

export function reportRoutes(
  app: FastifyInstance,
  { db, today }: { db: Db; today: () => string },
) {
  // S12: one month in one currency, with the 12 months up to it. Without a
  // month, the newest that has transactions in that currency.
  app.get<{ Querystring: { currency?: string; month?: string } }>(
    "/api/reports/monthly",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            currency: { type: "string" },
            month: { type: "string", pattern: MONTH },
          },
        },
      },
    },
    (req, reply) => {
      const { data, suggested } = loadReportData(db);
      const currencies = reportCurrencies(data.accounts);
      const currency = req.query.currency ?? currencies[0] ?? "EUR";
      if (req.query.currency && !currencies.includes(currency)) {
        return reply
          .code(400)
          .send({ error: `None of your accounts is in ${currency}.` });
      }
      const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
      const months = data.transactions
        .filter((t) => currencyOf.get(t.accountId) === currency)
        .map((t) => t.date.slice(0, 7))
        .sort();
      const thisMonth = today().slice(0, 7);
      const month = req.query.month ?? months.at(-1) ?? thisMonth;
      const report = monthReport(data, currency, month);

      // What Review can still change in this month: what has no category
      // yet, what may be a transfer, and the suggested exchanges.
      const counted = new Set(
        data.transactions
          .filter(
            (t) =>
              !t.excluded &&
              t.transferWith === null &&
              t.date.startsWith(month) &&
              currencyOf.get(t.accountId) === currency &&
              (t.categoryId === null || t.pending || suggested.has(t.id)),
          )
          .map((t) => t.id),
      );

      // The transactions the report names: the sides of each transfer to
      // savings, and the possible transfers it left out.
      const ids = [
        ...report.movedToSavings.transfers.flatMap((m) => [
          m.savingsSide,
          m.otherSide,
        ]),
        ...report.pending,
      ];
      const named = new Map(
        (ids.length === 0
          ? []
          : db
              .select({
                id: transactions.id,
                accountId: transactions.accountId,
                date: transactions.date,
                amount: transactions.amount,
                description: transactions.description,
              })
              .from(transactions)
              .where(inArray(transactions.id, ids))
              .all()
        ).map((t) => [t.id, t]),
      );

      return {
        currencies,
        currency,
        month,
        thisMonth,
        // The oldest month with transactions in this currency.
        first: months[0] ?? null,
        income: report.income,
        expenses: report.expenses,
        net: report.net,
        savingsRate: report.savingsRate,
        movedToSavings: {
          total: report.movedToSavings.total,
          transfers: report.movedToSavings.transfers.map((m) => ({
            amount: m.amount,
            savings: named.get(m.savingsSide)!,
            other: named.get(m.otherSide)!,
          })),
        },
        pending: report.pending.map((id) => named.get(id)!),
        waiting: counted.size,
        // Oldest first, ending with this one.
        months: Array.from({ length: 12 }, (_, i) => {
          const m = addMonths(month, i - 11);
          const { income, expenses } =
            m === month ? report : monthReport(data, currency, m);
          return { month: m, income: income.total, expenses: expenses.total };
        }),
      };
    },
  );
}
