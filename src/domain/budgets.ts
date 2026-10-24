import type { FieldErrors, Validated } from "./accounts.ts";
import type { CategoryType } from "./categories.ts";
import { addMonths, formatMonth, isMonth } from "./dates.ts";
import { parseAmount } from "./money.ts";
import type { PeriodReport } from "./reports.ts";

// Budgets (brief §5.6): a monthly limit for one expense category, in one
// currency. Each month keeps the limit in force then. The running balance
// adds each month's limit and takes off what that month spent, from the
// start month or the last start-over; it never resets on its own.

/** A budget's limits and start-overs. */
export interface BudgetPlan {
  /** The first month that counts, in full. */
  start: string;
  /** Each limit with the month it applies from; the first is from `start`. */
  limits: { from: string; amount: number }[];
  /** The months the running balance was started over from, oldest first. */
  restarts: string[];
}

/** The limit in force in a month; null before the budget starts. */
export function limitIn(plan: BudgetPlan, month: string): number | null {
  if (month < plan.start) return null;
  let limit: number | null = null;
  for (const { from, amount } of plan.limits.toSorted((a, b) =>
    a.from.localeCompare(b.from),
  )) {
    if (from <= month) limit = amount;
  }
  return limit;
}

/** Where the running balance counts from in a month: the start, or the last start-over by then. */
export function countsFrom(plan: BudgetPlan, month: string): string {
  return plan.restarts.filter((r) => r <= month).at(-1) ?? plan.start;
}

/**
 * What each expense category spent in a month (S12's expenses, one month):
 * positive when it spent, negative when it got more back. Refunds and
 * paybacks are taken off; uncategorized spending counts toward no budget.
 */
export function spendingIn(report: PeriodReport): Map<number, number> {
  return new Map(
    report.expenses.lines.flatMap((l) =>
      l.categoryId === null ? [] : [[l.categoryId, -l.amount] as const],
    ),
  );
}

export interface BudgetMonth {
  month: string;
  limit: number;
  spent: number;
  /** The limit less what it spent. */
  left: number;
  /** Everything budgeted less everything spent, up to this month. */
  running: number;
  /** The running balance started over this month. */
  restart: boolean;
}

/**
 * S15: each month from the start to `through`, oldest first. `spent` gives
 * what the category spent in a month, in the budget's currency.
 */
export function budgetHistory(
  plan: BudgetPlan,
  spent: (month: string) => number,
  through: string,
): BudgetMonth[] {
  const months: BudgetMonth[] = [];
  let running = 0;
  for (let month = plan.start; month <= through; month = addMonths(month, 1)) {
    const limit = limitIn(plan, month)!;
    const restart = plan.restarts.includes(month);
    const left = limit - spent(month);
    running = (restart ? 0 : running) + left;
    months.push({ month, limit, spent: limit - left, left, running, restart });
  }
  return months;
}

/** A budget as S14 shows it in a month. */
export interface BudgetStatus {
  /** That month: its limit, what it spent and what's left. */
  month: { limit: number; spent: number; left: number };
  /** Since the running balance last started: in all. */
  running: { since: string; budgeted: number; spent: number; left: number };
}

/** S14: a budget in a month; null before it starts. */
export function budgetStatus(
  plan: BudgetPlan,
  spent: (month: string) => number,
  month: string,
): BudgetStatus | null {
  const history = budgetHistory(plan, spent, month);
  const last = history.at(-1);
  if (!last) return null;
  const since = countsFrom(plan, month);
  const counted = history.filter((m) => m.month >= since);
  const budgeted = counted.reduce((sum, m) => sum + m.limit, 0);
  return {
    month: { limit: last.limit, spent: last.spent, left: last.left },
    running: {
      since,
      budgeted,
      spent: budgeted - last.running,
      left: last.running,
    },
  };
}

/** D7's months: a budget can start, change or start over up to the next month. */
export interface BudgetMonths {
  /** The oldest month with transactions in its currency; null without any. */
  first: string | null;
  /** The current month. */
  thisMonth: string;
}

/** The months D7 offers, newest first: from next month back to `first`. */
export function monthChoices(first: string, thisMonth: string): string[] {
  const months: string[] = [];
  for (let m = addMonths(thisMonth, 1); m >= first; m = addMonths(m, -1)) {
    months.push(m);
  }
  return months;
}

/** The months a budget can start over from: after its last start, newest first. */
export function restartChoices(plan: BudgetPlan, thisMonth: string): string[] {
  return monthChoices(
    addMonths(plan.restarts.at(-1) ?? plan.start, 1),
    thisMonth,
  );
}

const pickMonth = (
  month: string,
  { first, thisMonth }: BudgetMonths,
  after: string | null,
): string | null => {
  const next = addMonths(thisMonth, 1);
  if (!isMonth(month)) return "Pick a month.";
  if (month > next) return `Pick ${formatMonth(next)} at the latest.`;
  if (after !== null && month <= after)
    return `Pick a month after ${formatMonth(after)}.`;
  if (after === null && first !== null && month < first)
    return `Pick ${formatMonth(first)} or later: there's nothing before it.`;
  return null;
};

const readLimit = (typed: string, currency: string, errors: FieldErrors) => {
  if (!typed.trim()) {
    errors.limit = "Enter the monthly limit.";
    return 0;
  }
  const parsed = parseAmount(typed, currency);
  if (!parsed.ok) errors.limit = parsed.error;
  else if (parsed.minor <= 0) errors.limit = "Enter a limit above zero.";
  else return parsed.minor;
  return 0;
};

/** D7, adding: the form's fields, as typed. */
export interface BudgetFields {
  categoryId: number | null;
  currency: string;
  limit: string;
  start: string;
}

/**
 * Checks a new budget. A category has one budget, in one of my accounts'
 * currencies; it starts at the earliest in the oldest month with
 * transactions in that currency, and at the latest next month.
 */
export function validateBudget(
  fields: BudgetFields,
  {
    categories,
    budgeted,
    currencies,
    months,
  }: {
    categories: { id: number; type: CategoryType }[];
    /** The categories that have a budget. */
    budgeted: ReadonlySet<number>;
    currencies: string[];
    months: (currency: string) => BudgetMonths;
  },
): Validated<{
  categoryId: number;
  currency: string;
  limit: number;
  start: string;
}> {
  const errors: FieldErrors = {};
  const { categoryId, currency } = fields;
  const category = categories.find((c) => c.id === categoryId);
  if (categoryId === null || !category || category.type !== "expense")
    errors.categoryId = "Pick an expense category.";
  else if (budgeted.has(categoryId))
    errors.categoryId = "It has a budget already.";

  const known = currencies.includes(currency);
  if (!known) errors.currency = "Pick the currency of one of your accounts.";
  const limit = readLimit(fields.limit, currency, errors);
  const start = known
    ? pickMonth(fields.start, months(currency), null)
    : isMonth(fields.start)
      ? null
      : "Pick a month.";
  if (start) errors.start = start;

  if (Object.keys(errors).length > 0 || categoryId === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { categoryId, currency, limit, start: fields.start },
  };
}

/**
 * D7, changing the limit: the new limit, from a month of the budget's on.
 * It replaces any change from that month on.
 */
export function validateLimitChange(
  fields: { limit: string; from: string },
  plan: BudgetPlan,
  currency: string,
  months: BudgetMonths,
): Validated<BudgetPlan> {
  const errors: FieldErrors = {};
  const amount = readLimit(fields.limit, currency, errors);
  const from =
    isMonth(fields.from) && fields.from < plan.start
      ? `Pick ${formatMonth(plan.start)} or later: the budget starts then.`
      : pickMonth(fields.from, months, null);
  if (from) errors.from = from;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...plan,
      limits: [
        ...plan.limits.filter((l) => l.from < fields.from),
        { from: fields.from, amount },
      ],
    },
  };
}

/**
 * D7, starting over: the running balance counts again from a month after
 * the start and any start-over before.
 */
export function validateRestart(
  fields: { from: string },
  plan: BudgetPlan,
  months: BudgetMonths,
): Validated<BudgetPlan> {
  const after = plan.restarts.at(-1) ?? plan.start;
  const from = pickMonth(fields.from, months, after);
  if (from) return { ok: false, errors: { from } };
  return {
    ok: true,
    value: { ...plan, restarts: [...plan.restarts, fields.from] },
  };
}
