// Reports (brief §5.5): what a month's transactions add up to, in one
// currency. Amounts in different currencies are never added together.

import type { AccountType } from "./accounts.ts";
import type { CategoryType } from "./categories.ts";

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

export interface MonthReport {
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
 * One month in one currency (brief §6.1). Each category adds up under its
 * type, so a refund reduces its expense; what has no category goes to the
 * Uncategorized line of the side its sign puts it on. Excluded
 * transactions, transfers and possible transfers don't count.
 *
 * Moved to savings is the linked transfers between a checking and a
 * savings account, seen from the savings side: what came in, less what
 * went out, on that side's date and in its currency.
 */
export function monthReport(
  { accounts, categories, transactions }: ReportData,
  currency: string,
  month: string,
): MonthReport {
  const accountOf = new Map(accounts.map((a) => [a.id, a]));
  const typeOf = new Map(categories.map((c) => [c.id, c.type]));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const inMonth = (t: ReportTransaction) =>
    t.date.slice(0, 7) === month &&
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
        inMonth(t)
      ) {
        moved.push({
          savingsSide: t.id,
          otherSide: other.id,
          amount: t.amount,
        });
      }
      continue;
    }
    if (!inMonth(t)) continue;
    if (t.pending) {
      pending.push(t.id);
      continue;
    }
    const known = t.categoryId === null ? undefined : typeOf.get(t.categoryId);
    const categoryId = known ? t.categoryId : null;
    const side = sides[known ?? (t.amount > 0 ? "income" : "expense")];
    const line = side.get(categoryId) ?? { categoryId, amount: 0, count: 0 };
    line.amount += t.amount;
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

/** The currencies of my accounts, EUR first, then by code. */
export function reportCurrencies(accounts: { currency: string }[]): string[] {
  return [...new Set(accounts.map((a) => a.currency))].sort(
    (a, b) => Number(b === "EUR") - Number(a === "EUR") || a.localeCompare(b),
  );
}
