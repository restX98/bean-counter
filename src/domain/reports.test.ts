import { describe, expect, it } from "vitest";
import {
  monthReport,
  reportCurrencies,
  type ReportAccount,
  type ReportTransaction,
} from "./reports.ts";

const CHECKING = 1;
const SAVINGS = 2;
const US = 3;
const US_SAVINGS = 4;
const DEPOSIT = 5;
const CARD = 6;
const accounts: ReportAccount[] = [
  { id: CHECKING, type: "checking", currency: "EUR" },
  { id: SAVINGS, type: "savings", currency: "EUR" },
  { id: US, type: "checking", currency: "USD" },
  { id: US_SAVINGS, type: "savings", currency: "USD" },
  { id: DEPOSIT, type: "savings", currency: "EUR" },
  { id: CARD, type: "checking", currency: "EUR" },
];
const SALARY = 10;
const INTEREST = 11;
const RENT = 20;
const GROCERIES = 21;
const SHOPPING = 22;
const categories = [
  { id: SALARY, type: "income" as const },
  { id: INTEREST, type: "income" as const },
  { id: RENT, type: "expense" as const },
  { id: GROCERIES, type: "expense" as const },
  { id: SHOPPING, type: "expense" as const },
];

let next = 1;
const tx = (
  accountId: number,
  date: string,
  amount: number,
  more: Partial<ReportTransaction> = {},
): ReportTransaction => ({
  id: next++,
  accountId,
  date,
  amount,
  categoryId: null,
  excluded: false,
  transferWith: null,
  pending: false,
  ...more,
});
/** Two sides of a transfer, linked. */
const transfer = (out: ReportTransaction, into: ReportTransaction) => {
  out.transferWith = into.id;
  into.transferWith = out.id;
  return [out, into] as const;
};
const report = (
  transactions: ReportTransaction[],
  currency = "EUR",
  month = "2026-10",
) => monthReport({ accounts, categories, transactions }, currency, month);
const line = (categoryId: number | null, amount: number, count = 1) => ({
  categoryId,
  amount,
  count,
});

describe("monthReport", () => {
  it("adds up the brief's October (§6.1)", () => {
    const [out, into] = transfer(
      tx(CHECKING, "2026-10-05", -50000),
      tx(SAVINGS, "2026-10-05", 50000),
    );
    const october = report([
      tx(CHECKING, "2026-10-01", 200000, { categoryId: SALARY }),
      tx(CHECKING, "2026-10-03", -70000, { categoryId: RENT }),
      tx(CHECKING, "2026-10-10", -30000, { categoryId: GROCERIES }),
      out,
      into,
      tx(SAVINGS, "2026-10-31", 500, { categoryId: INTEREST }),
    ]);
    expect(october.income).toEqual({
      lines: [line(SALARY, 200000), line(INTEREST, 500)],
      total: 200500,
    });
    expect(october.expenses).toEqual({
      lines: [line(RENT, -70000), line(GROCERIES, -30000)],
      total: -100000,
    });
    expect(october.net).toBe(100500);
    expect(Math.round(october.savingsRate! * 100)).toBe(50);
    expect(october.movedToSavings).toEqual({
      transfers: [{ savingsSide: into.id, otherSide: out.id, amount: 50000 }],
      total: 50000,
    });
    expect(october.pending).toEqual([]);
  });

  it("keeps to its month and its currency", () => {
    const transactions = [
      tx(CHECKING, "2026-09-30", -1000, { categoryId: GROCERIES }),
      tx(CHECKING, "2026-10-01", -2000, { categoryId: GROCERIES }),
      tx(US, "2026-10-01", -3000, { categoryId: GROCERIES }),
    ];
    expect(report(transactions).expenses.total).toBe(-2000);
    expect(report(transactions, "USD").expenses.total).toBe(-3000);
    expect(report(transactions, "EUR", "2026-09").expenses.total).toBe(-1000);
  });

  it("adds up each category, refunds included", () => {
    const { expenses } = report([
      tx(CHECKING, "2026-10-14", -3490, { categoryId: SHOPPING }),
      tx(CHECKING, "2026-10-20", 1000, { categoryId: SHOPPING }),
      tx(CHECKING, "2026-10-15", -1850, { categoryId: GROCERIES }),
    ]);
    expect(expenses.lines).toEqual([
      line(SHOPPING, -2490, 2),
      line(GROCERIES, -1850),
    ]);
  });

  it("puts what has no category on its side's Uncategorized line, last", () => {
    const { income, expenses } = report([
      tx(CHECKING, "2026-10-02", -50000),
      tx(CHECKING, "2026-10-03", -1000),
      tx(CHECKING, "2026-10-04", -30000, { categoryId: GROCERIES }),
      tx(SAVINGS, "2026-10-12", 50000),
    ]);
    expect(expenses.lines).toEqual([
      line(GROCERIES, -30000),
      line(null, -51000, 2),
    ]);
    expect(income.lines).toEqual([line(null, 50000)]);
  });

  it("leaves out excluded transactions", () => {
    const { expenses } = report([
      tx(CHECKING, "2026-10-14", -3490, { categoryId: SHOPPING }),
      tx(CHECKING, "2026-10-14", -3490, {
        categoryId: SHOPPING,
        excluded: true,
      }),
    ]);
    expect(expenses.total).toBe(-3490);
  });

  it("leaves out possible transfers until I decide, and says which", () => {
    const out = tx(CHECKING, "2026-10-10", -50000, {
      categoryId: RENT,
      pending: true,
    });
    const match = tx(SAVINGS, "2026-10-10", 50000, { pending: true });
    const october = report([
      out,
      match,
      tx(SAVINGS, "2026-09-30", 50000, { pending: true }),
    ]);
    expect(october.income.total).toBe(0);
    expect(october.expenses.total).toBe(0);
    expect(october.movedToSavings.total).toBe(0);
    expect(october.pending).toEqual([out.id, match.id]);
  });

  it("takes withdrawals from savings off Moved to savings", () => {
    const october = report([
      ...transfer(
        tx(CHECKING, "2026-10-05", -50000),
        tx(SAVINGS, "2026-10-05", 50000),
      ),
      ...transfer(
        tx(SAVINGS, "2026-10-20", -20000),
        tx(CHECKING, "2026-10-20", 20000),
      ),
    ]);
    expect(october.movedToSavings.total).toBe(30000);
    expect(october.movedToSavings.transfers.map((m) => m.amount)).toEqual([
      50000, -20000,
    ]);
    expect(october.income.total + october.expenses.total).toBe(0);
  });

  it("only counts transfers between checking and savings", () => {
    const october = report([
      ...transfer(
        tx(SAVINGS, "2026-10-05", -10000),
        tx(DEPOSIT, "2026-10-05", 10000),
      ),
      ...transfer(
        tx(CHECKING, "2026-10-06", -20000),
        tx(CARD, "2026-10-06", 20000),
      ),
    ]);
    expect(october.movedToSavings).toEqual({ transfers: [], total: 0 });
    expect(october.net).toBe(0);
  });

  it("counts an exchange into savings on the savings side: its currency and its date", () => {
    const [out, into] = transfer(
      tx(CHECKING, "2026-09-30", -50000),
      tx(US_SAVINGS, "2026-10-02", 54500),
    );
    expect(report([out, into], "USD").movedToSavings.total).toBe(54500);
    expect(report([out, into]).movedToSavings.total).toBe(0);
    expect(report([out, into], "EUR", "2026-09").movedToSavings.total).toBe(0);
  });

  it("has no savings rate without income", () => {
    const october = report([
      tx(CHECKING, "2026-10-03", -70000, { categoryId: RENT }),
    ]);
    expect(october.net).toBe(-70000);
    expect(october.savingsRate).toBe(null);
  });
});

describe("reportCurrencies", () => {
  it("puts EUR first, then the others by code", () => {
    expect(
      reportCurrencies([
        { currency: "USD" },
        { currency: "EUR" },
        { currency: "CHF" },
        { currency: "EUR" },
      ]),
    ).toEqual(["EUR", "CHF", "USD"]);
  });
});
