// S5's filters: an account (or every account in a currency), a period of
// whole months, a category, a type and a search. Each is optional, and a
// transaction must pass all of them.

import type { CategoryType } from "./categories.ts";
import { formatMonth, isMonth } from "./dates.ts";
import { contains } from "./rules.ts";

export const TRANSACTION_TYPES = [
  "income",
  "expense",
  "transfer",
  "payback",
  "uncategorized",
  "excluded",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export function isTransactionType(text: string): text is TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(text);
}

/**
 * How reports count a transaction, which S5 filters by. An excluded one
 * counts nowhere. A transfer, or one that may be (it has candidates to pick
 * from), is neither income nor expense, and neither is a payment linked in
 * full to the expenses it pays back. The rest count by their category's
 * type, or as uncategorized.
 */
export function transactionType(t: {
  excluded: boolean;
  /** Linked to its other side, or with candidates to pick from. */
  transfer: boolean;
  /** A payment linked in full. */
  payback: boolean;
  categoryType: CategoryType | null;
}): TransactionType {
  if (t.excluded) return "excluded";
  if (t.transfer) return "transfer";
  if (t.payback) return "payback";
  return t.categoryType ?? "uncategorized";
}

/** Whole months, "2026-08" to "2026-10": one month when they're the same. */
export interface Period {
  from: string;
  to: string;
}

/** "2026-10", or "2026-08..2026-10" for several; null when it's neither. */
export function readPeriod(text: string): Period | null {
  const [from = "", to = from, ...rest] = text.split("..");
  return rest.length === 0 && isMonth(from) && isMonth(to) && from <= to
    ? { from, to }
    : null;
}

/** The other way round: "2026-10", "2026-08..2026-10". */
export function writePeriod({ from, to }: Period): string {
  return from === to ? from : `${from}..${to}`;
}

/** "October 2026", "Aug – Oct 2026", "Nov 2025 – Jan 2026". */
export function formatRange({ from, to }: Period): string {
  if (from === to) return formatMonth(from);
  const start = formatMonth(from, { short: true });
  const end = formatMonth(to, { short: true });
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${start.slice(0, 3)} – ${end}`
    : `${start} – ${end}`;
}

/** "October 2026", "Aug – Oct 2026 (3 months)", "Nov 2025 – Jan 2026 (3 months)". */
export function formatPeriod(period: Period): string {
  if (period.from === period.to) return formatMonth(period.from);
  const index = (month: string) => {
    const [year, number] = month.split("-").map(Number) as [number, number];
    return year * 12 + number;
  };
  const count = index(period.to) - index(period.from) + 1;
  return `${formatRange(period)} (${count} months)`;
}

export interface Filters {
  accountId: number | null;
  /** Every account in this currency, as a report counts them. */
  currency: string | null;
  /** Null for all time. */
  period: Period | null;
  categoryId: number | null;
  type: TransactionType | null;
  /** The search: descriptions that contain it, as a rule's "contains". */
  q: string;
}

export interface Filtered {
  accountId: number;
  /** Its account's. */
  currency: string;
  date: string;
  description: string;
  categoryId: number | null;
  type: TransactionType;
}

/** A test for transactions, compiled once from the filters. */
export function filterer({
  accountId,
  currency,
  period,
  categoryId,
  type,
  q,
}: Filters): (t: Filtered) => boolean {
  const matches = contains(q);
  return (t) => {
    const month = t.date.slice(0, 7);
    return (
      (accountId === null || t.accountId === accountId) &&
      (currency === null || t.currency === currency) &&
      (period === null || (month >= period.from && month <= period.to)) &&
      (categoryId === null || t.categoryId === categoryId) &&
      (type === null || t.type === type) &&
      matches(t.description)
    );
  };
}
