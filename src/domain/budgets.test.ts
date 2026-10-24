import { describe, expect, it } from "vitest";
import {
  budgetHistory,
  budgetStatus,
  countsFrom,
  limitIn,
  spendingIn,
  validateBudget,
  validateLimitChange,
  validateRestart,
  type BudgetPlan,
} from "./budgets.ts";
import { periodReport, type ReportTransaction } from "./reports.ts";

// The brief's Groceries (§6.2): 300.00 € a month from September; 250.00 €
// spent in September, 320.00 € in October.
const groceries: BudgetPlan = {
  start: "2026-09",
  limits: [{ from: "2026-09", amount: 30000 }],
  restarts: [],
};
const spent = (amounts: Record<string, number>) => (month: string) =>
  amounts[month] ?? 0;
const brief = spent({ "2026-09": 25000, "2026-10": 32000 });
const october = { first: "2026-01", thisMonth: "2026-10" };

describe("limitIn", () => {
  it("gives each month the limit in force then", () => {
    const changed: BudgetPlan = {
      ...groceries,
      limits: [
        { from: "2026-11", amount: 35000 },
        { from: "2026-09", amount: 30000 },
      ],
    };
    expect(limitIn(changed, "2026-08")).toBe(null);
    expect(limitIn(changed, "2026-10")).toBe(30000);
    expect(limitIn(changed, "2026-11")).toBe(35000);
    expect(limitIn(changed, "2027-03")).toBe(35000);
  });
});

describe("budgetStatus", () => {
  it("shows the brief's October both ways (§6.2)", () => {
    expect(budgetStatus(groceries, brief, "2026-10")).toEqual({
      month: { limit: 30000, spent: 32000, left: -2000 },
      running: {
        since: "2026-09",
        budgeted: 60000,
        spent: 57000,
        left: 3000,
      },
    });
  });

  it("counts the first month in full, and nothing before it", () => {
    expect(budgetStatus(groceries, brief, "2026-09")).toEqual({
      month: { limit: 30000, spent: 25000, left: 5000 },
      running: { since: "2026-09", budgeted: 30000, spent: 25000, left: 5000 },
    });
    expect(budgetStatus(groceries, brief, "2026-08")).toBe(null);
  });

  it("carries over at the limit in force each month", () => {
    // From November 350.00 €: +30.00 € carried over, then 350.00 € more.
    const raised = {
      ...groceries,
      limits: [...groceries.limits, { from: "2026-11", amount: 35000 }],
    };
    const november = spent({
      "2026-09": 25000,
      "2026-10": 32000,
      "2026-11": 20000,
    });
    expect(budgetStatus(raised, november, "2026-11")?.running).toEqual({
      since: "2026-09",
      budgeted: 95000,
      spent: 77000,
      left: 18000,
    });
  });

  it("starts the running balance over, and keeps what came before", () => {
    const over = { ...groceries, restarts: ["2026-11"] };
    const months = spent({
      "2026-09": 25000,
      "2026-10": 32000,
      "2026-11": 20000,
    });
    expect(budgetStatus(over, months, "2026-11")?.running).toEqual({
      since: "2026-11",
      budgeted: 30000,
      spent: 20000,
      left: 10000,
    });
    // October still shows the balance it had.
    expect(budgetStatus(over, months, "2026-10")?.running.left).toBe(3000);
    expect(countsFrom(over, "2026-10")).toBe("2026-09");
  });

  it("gives back what a month got back", () => {
    // A 60.00 € refund and nothing spent: 360.00 € left that month.
    expect(
      budgetStatus(groceries, spent({ "2026-09": -6000 }), "2026-09")?.month,
    ).toEqual({ limit: 30000, spent: -6000, left: 36000 });
  });
});

describe("budgetHistory", () => {
  it("lists each month with its running balance, oldest first", () => {
    const over = { ...groceries, restarts: ["2026-11"] };
    const months = spent({
      "2026-09": 25000,
      "2026-10": 32000,
      "2026-11": 20000,
    });
    expect(budgetHistory(over, months, "2026-11")).toEqual([
      {
        month: "2026-09",
        limit: 30000,
        spent: 25000,
        left: 5000,
        running: 5000,
        restart: false,
      },
      {
        month: "2026-10",
        limit: 30000,
        spent: 32000,
        left: -2000,
        running: 3000,
        restart: false,
      },
      {
        month: "2026-11",
        limit: 30000,
        spent: 20000,
        left: 10000,
        running: 10000,
        restart: true,
      },
    ]);
  });
});

describe("spendingIn", () => {
  it("takes refunds and paybacks off, in the expense's month", () => {
    const EATING_OUT = 23;
    const SHOPPING = 22;
    const tx = (
      id: number,
      date: string,
      amount: number,
      categoryId: number | null,
    ): ReportTransaction => ({
      id,
      accountId: 1,
      date,
      amount,
      categoryId,
      excluded: false,
      transferWith: null,
      pending: false,
    });
    const report = periodReport(
      {
        accounts: [{ id: 1, type: "checking", currency: "EUR" }],
        categories: [
          { id: EATING_OUT, type: "expense" },
          { id: SHOPPING, type: "expense" },
        ],
        transactions: [
          tx(1, "2026-10-17", -30500, EATING_OUT),
          tx(2, "2026-11-02", 15000, null),
          tx(3, "2026-10-14", -3490, SHOPPING),
          tx(4, "2026-10-20", 6000, SHOPPING),
          tx(5, "2026-10-15", -1850, null),
        ],
        paybacks: [{ paymentId: 2, expenseId: 1, amount: 15000 }],
      },
      "EUR",
      { from: "2026-10", to: "2026-10" },
    );
    expect(spendingIn(report)).toEqual(
      new Map([
        [EATING_OUT, 15500],
        [SHOPPING, -2510],
      ]),
    );
  });
});

describe("validateBudget", () => {
  const SALARY = 10;
  const GROCERIES = 21;
  const SHOPPING = 22;
  const context = {
    categories: [
      { id: SALARY, type: "income" as const },
      { id: GROCERIES, type: "expense" as const },
      { id: SHOPPING, type: "expense" as const },
    ],
    budgeted: new Set([GROCERIES]),
    currencies: ["EUR", "USD"],
    months: (currency: string) =>
      currency === "USD" ? { first: "2026-08", thisMonth: "2026-10" } : october,
  };
  const fields = {
    categoryId: SHOPPING,
    currency: "EUR",
    limit: "150",
    start: "2026-10",
  };

  it("takes the design's Shopping budget", () => {
    expect(validateBudget(fields, context)).toEqual({
      ok: true,
      value: {
        categoryId: SHOPPING,
        currency: "EUR",
        limit: 15000,
        start: "2026-10",
      },
    });
  });

  it("needs an expense category without a budget", () => {
    for (const categoryId of [null, SALARY, 99]) {
      expect(validateBudget({ ...fields, categoryId }, context)).toEqual({
        ok: false,
        errors: { categoryId: "Pick an expense category." },
      });
    }
    expect(
      validateBudget({ ...fields, categoryId: GROCERIES }, context),
    ).toEqual({
      ok: false,
      errors: { categoryId: "It has a budget already." },
    });
  });

  it("needs a limit above zero, in one of my currencies", () => {
    expect(validateBudget({ ...fields, limit: "" }, context)).toEqual({
      ok: false,
      errors: { limit: "Enter the monthly limit." },
    });
    expect(validateBudget({ ...fields, limit: "0" }, context)).toEqual({
      ok: false,
      errors: { limit: "Enter a limit above zero." },
    });
    expect(validateBudget({ ...fields, currency: "GBP" }, context)).toEqual({
      ok: false,
      errors: { currency: "Pick the currency of one of your accounts." },
    });
  });

  it("starts from the first month with transactions to next month", () => {
    expect(validateBudget({ ...fields, start: "2026-11" }, context).ok).toBe(
      true,
    );
    expect(validateBudget({ ...fields, start: "2026-12" }, context)).toEqual({
      ok: false,
      errors: { start: "Pick November 2026 at the latest." },
    });
    expect(
      validateBudget({ ...fields, currency: "USD", start: "2026-07" }, context),
    ).toEqual({
      ok: false,
      errors: {
        start: "Pick August 2026 or later: there's nothing before it.",
      },
    });
    expect(validateBudget({ ...fields, start: "October" }, context)).toEqual({
      ok: false,
      errors: { start: "Pick a month." },
    });
  });
});

describe("validateLimitChange", () => {
  it("changes the limit from a month on: earlier months keep theirs", () => {
    expect(
      validateLimitChange(
        { limit: "350", from: "2026-11" },
        groceries,
        "EUR",
        october,
      ),
    ).toEqual({
      ok: true,
      value: {
        ...groceries,
        limits: [
          { from: "2026-09", amount: 30000 },
          { from: "2026-11", amount: 35000 },
        ],
      },
    });
  });

  it("replaces the changes from that month on", () => {
    const planned = {
      ...groceries,
      limits: [...groceries.limits, { from: "2026-11", amount: 40000 }],
    };
    const result = validateLimitChange(
      { limit: "320", from: "2026-10" },
      planned,
      "EUR",
      october,
    );
    expect(result.ok && result.value.limits).toEqual([
      { from: "2026-09", amount: 30000 },
      { from: "2026-10", amount: 32000 },
    ]);
  });

  it("applies from the start to next month", () => {
    expect(
      validateLimitChange(
        { limit: "350", from: "2026-08" },
        groceries,
        "EUR",
        october,
      ),
    ).toEqual({
      ok: false,
      errors: { from: "Pick September 2026 or later: the budget starts then." },
    });
    expect(
      validateLimitChange(
        { limit: "-5", from: "2026-12" },
        groceries,
        "EUR",
        october,
      ),
    ).toEqual({
      ok: false,
      errors: {
        limit: "Enter a limit above zero.",
        from: "Pick November 2026 at the latest.",
      },
    });
  });
});

describe("validateRestart", () => {
  it("starts over after the start and any start-over before", () => {
    expect(validateRestart({ from: "2026-11" }, groceries, october)).toEqual({
      ok: true,
      value: { ...groceries, restarts: ["2026-11"] },
    });
    expect(validateRestart({ from: "2026-09" }, groceries, october)).toEqual({
      ok: false,
      errors: { from: "Pick a month after September 2026." },
    });
    const over = { ...groceries, restarts: ["2026-10"] };
    expect(validateRestart({ from: "2026-10" }, over, october)).toEqual({
      ok: false,
      errors: { from: "Pick a month after October 2026." },
    });
  });
});
