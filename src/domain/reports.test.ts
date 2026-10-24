import { describe, expect, it } from "vitest";
import type { PaybackLink } from "./paybacks.ts";
import {
  periodChoices,
  periodReport,
  reportCurrencies,
  spending,
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
const EATING_OUT = 23;
const TRANSPORT = 24;
const HEALTH = 25;
const PETS = 26;
const GIFTS = 27;
const categories = [
  { id: SALARY, type: "income" as const },
  { id: INTEREST, type: "income" as const },
  { id: RENT, type: "expense" as const },
  { id: GROCERIES, type: "expense" as const },
  { id: SHOPPING, type: "expense" as const },
  { id: EATING_OUT, type: "expense" as const },
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
  from = "2026-10",
  to = from,
  paybacks: PaybackLink[] = [],
) =>
  periodReport({ accounts, categories, transactions, paybacks }, currency, {
    from,
    to,
  });
/** A payment's part that pays back an expense. */
const payback = (
  payment: ReportTransaction,
  expense: ReportTransaction,
  amount: number,
): PaybackLink => ({ paymentId: payment.id, expenseId: expense.id, amount });
const line = (categoryId: number | null, amount: number, count = 1) => ({
  categoryId,
  amount,
  count,
});

describe("periodReport", () => {
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

  it("adds up several months, and only those", () => {
    const { expenses } = report(
      [
        tx(CHECKING, "2026-07-31", -4000, { categoryId: GROCERIES }),
        tx(CHECKING, "2026-08-01", -33000, { categoryId: GROCERIES }),
        tx(CHECKING, "2026-09-12", -25000, { categoryId: GROCERIES }),
        tx(CHECKING, "2026-10-31", -32000, { categoryId: GROCERIES }),
        tx(CHECKING, "2026-11-01", -5000, { categoryId: GROCERIES }),
      ],
      "EUR",
      "2026-08",
      "2026-10",
    );
    expect(expenses.lines).toEqual([line(GROCERIES, -90000, 3)]);
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

  it("counts my share of the expenses a friend paid back (§5.10)", () => {
    // The design's split bill: Marco pays back 150.00 € of the dinner and
    // 24.00 € of the pizzeria.
    const dinner = tx(CHECKING, "2026-10-17", -30500, {
      categoryId: EATING_OUT,
    });
    const pizzeria = tx(CHECKING, "2026-10-16", -4800, {
      categoryId: EATING_OUT,
    });
    const marco = tx(CHECKING, "2026-10-19", 17400);
    const october = report(
      [dinner, pizzeria, marco],
      "EUR",
      "2026-10",
      "2026-10",
      [payback(marco, dinner, 15000), payback(marco, pizzeria, 2400)],
    );
    expect(october.expenses.lines).toEqual([line(EATING_OUT, -17900, 2)]);
    expect(october.income).toEqual({ lines: [], total: 0 });
    expect(october.net).toBe(-17900);
  });

  it("takes a payback off the expense's month, even when it comes later", () => {
    const dinner = tx(CHECKING, "2026-09-28", -30500, {
      categoryId: EATING_OUT,
    });
    const marco = tx(CHECKING, "2026-10-02", 15000);
    const transactions = [dinner, marco];
    const paybacks = [payback(marco, dinner, 15000)];
    const september = report(
      transactions,
      "EUR",
      "2026-09",
      "2026-09",
      paybacks,
    );
    expect(september.expenses.lines).toEqual([line(EATING_OUT, -15500)]);
    const october = report(transactions, "EUR", "2026-10", "2026-10", paybacks);
    expect(october.income.lines).toEqual([]);
    expect(october.expenses.lines).toEqual([]);
  });

  it("counts the part of a payment that isn't linked, in any of my accounts", () => {
    const dinner = tx(CHECKING, "2026-10-17", -30500, {
      categoryId: EATING_OUT,
    });
    const marco = tx(CHECKING, "2026-10-19", 20000);
    const lucia = tx(SAVINGS, "2026-10-20", 5000);
    const october = report(
      [dinner, marco, lucia],
      "EUR",
      "2026-10",
      "2026-10",
      [payback(marco, dinner, 15000), payback(lucia, dinner, 5000)],
    );
    expect(october.expenses.lines).toEqual([line(EATING_OUT, -10500)]);
    expect(october.income.lines).toEqual([line(null, 5000)]);
  });

  it("has no savings rate without income", () => {
    const october = report([
      tx(CHECKING, "2026-10-03", -70000, { categoryId: RENT }),
    ]);
    expect(october.net).toBe(-70000);
    expect(october.savingsRate).toBe(null);
  });
});

describe("spending", () => {
  const side = (...lines: ReturnType<typeof line>[]) => ({
    lines,
    total: lines.reduce((sum, l) => sum + l.amount, 0),
  });

  it("gives each category its share of the design's three months", () => {
    const threeMonths = spending(
      side(
        line(RENT, -135000, 3),
        line(GROCERIES, -90000, 21),
        line(EATING_OUT, -24000, 6),
        line(SHOPPING, -21000, 4),
        line(TRANSPORT, -15000, 3),
        line(HEALTH, -7990, 2),
        line(null, -7010, 3),
      ),
    );
    expect(threeMonths.total).toBe(300000);
    expect(threeMonths.lines.map((l) => [l.amount, l.share])).toEqual([
      [135000, 450],
      [90000, 300],
      [24000, 80],
      [21000, 70],
      [15000, 50],
      [7990, 27],
      [7010, 23],
    ]);
    expect(threeMonths.lines.map((l) => l.color)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      null,
    ]);
    expect(threeMonths.refunded).toEqual([]);
  });

  it("names a category that got more back than it spent, out of the shares and the total", () => {
    // Shopping bought for 60.00 € in September, returned in October.
    const october = spending(
      side(
        line(RENT, -45000),
        line(GROCERIES, -32000, 8),
        line(EATING_OUT, -8000, 3),
        line(SHOPPING, 6000),
        line(TRANSPORT, 0, 2),
        line(null, -3000),
      ),
    );
    expect(october.lines).toEqual([
      { ...line(RENT, 45000), share: 511, color: 1 },
      { ...line(GROCERIES, 32000, 8), share: 364, color: 2 },
      { ...line(EATING_OUT, 8000, 3), share: 91, color: 3 },
      { ...line(null, 3000), share: 34, color: null },
    ]);
    expect(october.total).toBe(88000);
    expect(october.refunded).toEqual([line(SHOPPING, 6000)]);
  });

  it("colors the six largest categories, the rest are Other", () => {
    const { lines } = spending(
      side(
        line(null, -90000),
        line(PETS, -1000),
        line(RENT, -70000),
        line(GIFTS, -1000),
        line(GROCERIES, -30000),
        line(EATING_OUT, -8000),
        line(SHOPPING, -6000),
        line(TRANSPORT, -4000),
        line(HEALTH, -2000),
      ),
    );
    expect(lines.map((l) => [l.categoryId, l.color])).toEqual([
      [RENT, 1],
      [GROCERIES, 2],
      [EATING_OUT, 3],
      [SHOPPING, 4],
      [TRANSPORT, 5],
      [HEALTH, 6],
      [PETS, null],
      [GIFTS, null],
      [null, null],
    ]);
    expect(lines.reduce((sum, l) => sum + l.share, 0)).toBe(1000);
  });

  it("has nothing to share without spending", () => {
    expect(spending(side())).toEqual({ lines: [], total: 0, refunded: [] });
    expect(spending(side(line(SHOPPING, 6000)))).toEqual({
      lines: [],
      total: 0,
      refunded: [line(SHOPPING, 6000)],
    });
  });
});

describe("periodChoices", () => {
  const choices = (first: string, last: string, thisMonth = "2026-10") =>
    periodChoices(first, last, thisMonth).map(
      (c) => `${c.label}: ${c.period.from}..${c.period.to}`,
    );

  it("offers the last months, each year and all time", () => {
    expect(choices("2025-03", "2026-10")).toEqual([
      "Last 3 months: 2026-08..2026-10",
      "Last 6 months: 2026-05..2026-10",
      "Last 12 months: 2025-11..2026-10",
      "2026 so far: 2026-01..2026-10",
      "2025: 2025-03..2025-12",
      "All time: 2025-03..2026-10",
    ]);
  });

  it("ends at the newest month with transactions", () => {
    expect(choices("2025-03", "2026-09")[0]).toBe(
      "Last 3 months: 2026-07..2026-09",
    );
  });

  it("leaves out what comes to all time", () => {
    expect(choices("2026-08", "2026-10")).toEqual([
      "All time: 2026-08..2026-10",
    ]);
    expect(choices("2026-06", "2026-10")).toEqual([
      "Last 3 months: 2026-08..2026-10",
      "All time: 2026-06..2026-10",
    ]);
  });

  it("calls the last 12 months by their year when they're one", () => {
    expect(choices("2025-07", "2026-12", "2027-01")).toEqual([
      "Last 3 months: 2026-10..2026-12",
      "Last 6 months: 2026-07..2026-12",
      "2026: 2026-01..2026-12",
      "2025: 2025-07..2025-12",
      "All time: 2025-07..2026-12",
    ]);
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
