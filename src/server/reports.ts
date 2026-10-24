import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { addMonths } from "../domain/dates.ts";
import { readPeriod, type Period } from "../domain/filters.ts";
import {
  periodChoices,
  periodReport,
  reportCurrencies,
  spending,
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
    paybacks: [],
  };
  const suggested = new Set(exchanges.flatMap((p) => [p.out.id, p.in.id]));
  return { data, suggested };
}

/** The months with transactions in a currency, oldest first. */
function monthsIn(data: ReportData, currency: string): string[] {
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  return [
    ...new Set(
      data.transactions
        .filter((t) => currencyOf.get(t.accountId) === currency)
        .map((t) => t.date.slice(0, 7)),
    ),
  ].sort();
}

/**
 * How many transactions in these months Review can still change: what has
 * no category yet, what may be a transfer, and the suggested exchanges.
 */
function waitingIn(
  data: ReportData,
  suggested: Set<number>,
  currency: string,
  { from, to }: Period,
): number {
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  return data.transactions.filter(
    (t) =>
      !t.excluded &&
      t.transferWith === null &&
      t.date.slice(0, 7) >= from &&
      t.date.slice(0, 7) <= to &&
      currencyOf.get(t.accountId) === currency &&
      (t.categoryId === null || t.pending || suggested.has(t.id)),
  ).length;
}

/** The transactions a report names, by id. */
function named(db: Db, ids: number[]) {
  return new Map(
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
      const months = monthsIn(data, currency);
      const thisMonth = today().slice(0, 7);
      const month = req.query.month ?? months.at(-1) ?? thisMonth;
      const report = periodReport(data, currency, { from: month, to: month });

      // The transactions the report names: the sides of each transfer to
      // savings, and the possible transfers it left out.
      const names = named(db, [
        ...report.movedToSavings.transfers.flatMap((m) => [
          m.savingsSide,
          m.otherSide,
        ]),
        ...report.pending,
      ]);

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
            savings: names.get(m.savingsSide)!,
            other: names.get(m.otherSide)!,
          })),
        },
        pending: report.pending.map((id) => names.get(id)!),
        waiting: waitingIn(data, suggested, currency, {
          from: month,
          to: month,
        }),
        // Oldest first, ending with this one.
        months: Array.from({ length: 12 }, (_, i) => {
          const m = addMonths(month, i - 11);
          const { income, expenses } =
            m === month
              ? report
              : periodReport(data, currency, { from: m, to: m });
          return { month: m, income: income.total, expenses: expenses.total };
        }),
      };
    },
  );

  // S13: spending by category over whole months in one currency. Without a
  // period, the last 3 months up to the newest with transactions in it.
  app.get<{ Querystring: { currency?: string; period?: string } }>(
    "/api/reports/spending",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            currency: { type: "string" },
            period: { type: "string" },
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
      const asked =
        req.query.period === undefined ? null : readPeriod(req.query.period);
      if (req.query.period !== undefined && !asked) {
        return reply
          .code(400)
          .send({ error: "A period is a month, or two joined by “..”." });
      }
      const months = monthsIn(data, currency);
      const first = months[0] ?? null;
      const last = months.at(-1) ?? null;
      const thisMonth = today().slice(0, 7);
      let period = asked ?? { from: thisMonth, to: thisMonth };
      if (!asked && first && last) {
        // The last 3 months, or as many as there are.
        const from = addMonths(last, -2);
        period = { from: from < first ? first : from, to: last };
      }
      const report = periodReport(data, currency, period);
      // Only the possible transfers going out could be spending.
      const amountOf = new Map(data.transactions.map((t) => [t.id, t.amount]));
      const pending = report.pending.filter((id) => amountOf.get(id)! < 0);
      const names = named(db, pending);

      return {
        currencies,
        currency,
        period,
        thisMonth,
        // The oldest and the newest month with transactions in this currency.
        first,
        last,
        choices: first && last ? periodChoices(first, last, thisMonth) : [],
        ...spending(report.expenses),
        pending: pending.map((id) => names.get(id)!),
        waiting: waitingIn(data, suggested, currency, period),
      };
    },
  );
}
