// Reports (brief §5.5): what a period's transactions add up to, in one
// currency. Amounts in different currencies are never added together.

import type { AccountType } from "./accounts.ts";
import type { CategoryType } from "./categories.ts";
import { addMonths } from "./dates.ts";
import { writePeriod, type Period } from "./filters.ts";
import { linkedInFull, paybackTotals, type PaybackLink } from "./paybacks.ts";

export interface ReportAccount {
  id: number;
  type: AccountType;
  currency: string;
}

export interface ReportCategory {
  id: number;
  type: CategoryType;
}

export interface ReportTransaction {
  id: number;
  accountId: number;
  date: string;
  /** Minor units: negative for money going out. */
  amount: number;
  categoryId: number | null;
  excluded: boolean;
  /** The other side of its transfer. */
  transferWith: number | null;
  /**
   * A possible transfer in one currency, or one of its possible other
   * sides: left out until I decide. A suggested exchange counts as it is.
   */
  pending: boolean;
}

export interface ReportData {
  accounts: ReportAccount[];
  categories: ReportCategory[];
  transactions: ReportTransaction[];
  paybacks: PaybackLink[];
}

export interface ReportLine {
  /** Null for the Uncategorized line. */
  categoryId: number | null;
  amount: number;
  /** How many transactions it adds up. */
  count: number;
}

export interface ReportSide {
  /** The largest first, Uncategorized last. */
  lines: ReportLine[];
  total: number;
}

/** A transfer between a checking and a savings account, seen from savings. */
export interface MovedLine {
  /** The side in the savings account, and the other side. */
  savingsSide: number;
  otherSide: number;
  /** Positive into savings, negative out of it. */
  amount: number;
}

export interface PeriodReport {
  income: ReportSide;
  expenses: ReportSide;
  /** Income + expenses (which are negative). */
  net: number;
  /** Net ÷ income; null without income. */
  savingsRate: number | null;
  movedToSavings: { transfers: MovedLine[]; total: number };
  /** The possible transfers left out, to say they're not counted yet. */
  pending: number[];
}

/**
 * Whole months in one currency: one for S12 (brief §6.1), several for S13.
 * Each category adds up under its type, so a refund reduces its expense;
 * what has no category goes to the Uncategorized line of the side its sign
 * puts it on. An expense counts as my share of it: a payback reduces the
 * expense's line, in the expense's month, and only the part of a payment
 * that isn't linked counts as itself. Excluded transactions, transfers and
 * possible transfers don't count.
 *
 * Moved to savings is the linked transfers between a checking and a
 * savings account, seen from the savings side: what came in, less what
 * went out, on that side's date and in its currency.
 */
export function periodReport(
  { accounts, categories, transactions, paybacks }: ReportData,
  currency: string,
  { from, to }: Period,
): PeriodReport {
  const accountOf = new Map(accounts.map((a) => [a.id, a]));
  const typeOf = new Map(categories.map((c) => [c.id, c.type]));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const totals = paybackTotals(paybacks);
  const inPeriod = (t: ReportTransaction) =>
    t.date.slice(0, 7) >= from &&
    t.date.slice(0, 7) <= to &&
    accountOf.get(t.accountId)?.currency === currency;

  const sides = { income: new Map(), expense: new Map() } as Record<
    CategoryType,
    Map<number | null, ReportLine>
  >;
  const moved: MovedLine[] = [];
  const pending: number[] = [];
  for (const t of transactions) {
    if (t.excluded) continue;
    if (t.transferWith !== null) {
      const other = byId.get(t.transferWith);
      const here = accountOf.get(t.accountId);
      const there = other && accountOf.get(other.accountId);
      if (
        other &&
        here?.type === "savings" &&
        there?.type === "checking" &&
        inPeriod(t)
      ) {
        moved.push({
          savingsSide: t.id,
          otherSide: other.id,
          amount: t.amount,
        });
      }
      continue;
    }
    if (!inPeriod(t)) continue;
    if (t.pending) {
      pending.push(t.id);
      continue;
    }
    // A payment linked in full isn't income; an expense counts as my share.
    if (linkedInFull(t, totals)) continue;
    const amount =
      t.amount +
      (totals.paidBack.get(t.id) ?? 0) -
      (totals.linked.get(t.id) ?? 0);
    const known = t.categoryId === null ? undefined : typeOf.get(t.categoryId);
    const categoryId = known ? t.categoryId : null;
    const side = sides[known ?? (amount > 0 ? "income" : "expense")];
    const line = side.get(categoryId) ?? { categoryId, amount: 0, count: 0 };
    line.amount += amount;
    line.count += 1;
    side.set(categoryId, line);
  }

  const side = (lines: Map<number | null, ReportLine>): ReportSide => ({
    lines: [...lines.values()].sort(
      (a, b) =>
        Number(a.categoryId === null) - Number(b.categoryId === null) ||
        Math.abs(b.amount) - Math.abs(a.amount),
    ),
    total: [...lines.values()].reduce((sum, l) => sum + l.amount, 0),
  });
  const income = side(sides.income);
  const expenses = side(sides.expense);
  const net = income.total + expenses.total;
  return {
    income,
    expenses,
    net,
    savingsRate: income.total > 0 ? net / income.total : null,
    movedToSavings: {
      transfers: moved,
      total: moved.reduce((sum, m) => sum + m.amount, 0),
    },
    pending,
  };
}

/** A category in S13: what it spent, less what it got back. */
export interface SpendingLine {
  /** Null for the Uncategorized line. */
  categoryId: number | null;
  /** Positive. */
  amount: number;
  count: number;
  /** In tenths of a percent of the total; the lines add up to 1000. */
  share: number;
  /** Its own chart color, 1 to 6; null for Other, in gray. */
  color: number | null;
}

export interface Spending {
  /** The largest first, Uncategorized last. */
  lines: SpendingLine[];
  total: number;
  /** The categories that got more back than they spent, the most first. */
  refunded: ReportLine[];
}

/**
 * S13: a period's expenses as spending, with each category's share. A
 * category that got more back than it spent is left out of the shares and
 * the total, and named instead; one that came to nothing is left out. The
 * six largest categories get their own color; the rest, and
 * Uncategorized, are Other.
 */
export function spending(expenses: ReportSide): Spending {
  const spent = expenses.lines
    .filter((l) => l.amount < 0)
    .map((l) => ({ ...l, amount: -l.amount }))
    .sort(
      (a, b) =>
        Number(a.categoryId === null) - Number(b.categoryId === null) ||
        b.amount - a.amount ||
        (a.categoryId ?? 0) - (b.categoryId ?? 0),
    );
  const total = spent.reduce((sum, l) => sum + l.amount, 0);

  // Each share rounded down, then the tenths still missing go to the
  // shares that lost the most to rounding, so that they add up to 100 %.
  const scaled = spent.map((l) => l.amount * 1000);
  const shares = scaled.map((s) => Math.floor(s / total));
  const missing = 1000 - shares.reduce((sum, s) => sum + s, 0);
  for (const i of [...scaled.keys()]
    .sort((a, b) => (scaled[b]! % total) - (scaled[a]! % total) || a - b)
    .slice(0, total > 0 ? missing : 0)) {
    shares[i]! += 1;
  }

  return {
    lines: spent.map((l, i) => ({
      ...l,
      share: shares[i]!,
      color: i < 6 && l.categoryId !== null ? i + 1 : null,
    })),
    total,
    refunded: expenses.lines.filter((l) => l.amount > 0),
  };
}

/** A period S13 offers, by name. */
export interface PeriodChoice {
  /** "Last 3 months", "2026 so far", "2025", "All time". */
  label: string;
  period: Period;
}

/**
 * The periods S13 offers, from the oldest to the newest month with
 * transactions: the last 3, 6 and 12 months up to the newest, each
 * calendar year (newest first), then all time. Each is cut to the months
 * with transactions. Last months that come to a calendar year are left
 * out, as the year names them better, and so is anything that comes to
 * all time.
 */
export function periodChoices(
  first: string,
  last: string,
  thisMonth: string,
): PeriodChoice[] {
  const cut = (from: string, to: string): Period => ({
    from: from < first ? first : from,
    to: to > last ? last : to,
  });
  const lasts = [3, 6, 12].map((count) => ({
    label: `Last ${count} months`,
    period: cut(addMonths(last, 1 - count), last),
  }));
  const years: PeriodChoice[] = [];
  for (
    let year = Number(last.slice(0, 4));
    year >= Number(first.slice(0, 4));
    year--
  ) {
    years.push({
      label: `${year}${String(year) === thisMonth.slice(0, 4) ? " so far" : ""}`,
      period: cut(`${year}-01`, `${year}-12`),
    });
  }
  const all = { label: "All time", period: { from: first, to: last } };
  const key = (c: PeriodChoice) => writePeriod(c.period);
  const taken = new Set([all, ...years].map(key));
  return [
    ...lasts.filter((c) => !taken.has(key(c))),
    ...years.filter((c) => key(c) !== key(all)),
    all,
  ];
}

/** The currencies of my accounts, EUR first, then by code. */
export function reportCurrencies(accounts: { currency: string }[]): string[] {
  return [...new Set(accounts.map((a) => a.currency))].sort(
    (a, b) => Number(b === "EUR") - Number(a === "EUR") || a.localeCompare(b),
  );
}
