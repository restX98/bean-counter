import type { Anchor } from "./accounts.ts";
import {
  balanceHistory,
  bankBalances,
  checkBalances,
  type BalanceGap,
  type Checked,
} from "./balances.ts";

// An account's transactions in the order they happened, each with the
// balance after it, as the account page lists them.

/** A transaction as the ledger needs it. */
export interface LedgerEntry extends Checked {
  id: number;
  importId: number;
  /** The row's number in its file. */
  line: number;
  time: string | null;
  /** The bank's balance after it, if its file had a balance column. */
  bankBalance: number | null;
}

type Ordering = Pick<LedgerEntry, "date" | "time" | "importId" | "line">;

/**
 * Sorts transactions into the order they happened: by date, then time, then
 * within a day in their file's order. A file that lists the newest first,
 * its first line dated after its last, is read backwards.
 */
export function inOrder<T extends Ordering>(entries: T[]): T[] {
  const ends = new Map<number, { first: T; last: T }>();
  for (const entry of entries) {
    const seen = ends.get(entry.importId);
    if (!seen) ends.set(entry.importId, { first: entry, last: entry });
    else {
      if (entry.line < seen.first.line) seen.first = entry;
      if (entry.line > seen.last.line) seen.last = entry;
    }
  }
  const newestFirst = (importId: number) => {
    const { first, last } = ends.get(importId)!;
    return first.date > last.date;
  };
  return entries.toSorted(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.importId - b.importId ||
      (newestFirst(a.importId) ? b.line - a.line : a.line - b.line),
  );
}

export interface Ledger<T> {
  /** Oldest first, each with the balance after it; null when excluded. */
  entries: (T & { balance: number | null })[];
  /** Where the app's balances and the bank's part ways (see checkBalances). */
  gaps: BalanceGap<T>[];
  /** The days, oldest first, whose bank balance differs from the app's. */
  offDays: string[];
}

/**
 * The account's transactions with their running balance, worked out from
 * the anchor, compared with the bank's balances where the files had them.
 * Excluded transactions don't move the balance, but the bank's balances
 * still include them.
 */
export function ledger<T extends LedgerEntry>(
  anchor: Pick<Anchor, "amount" | "date">,
  transactions: T[],
): Ledger<T> {
  const ordered = inOrder(transactions);
  const history = balanceHistory(anchor, ordered);
  let running = history.opening;
  const entries = ordered.map((t) => {
    if (t.excluded) return { ...t, balance: null };
    running += t.amount;
    return { ...t, balance: running };
  });

  const bank = bankBalances(
    ordered.map((t) => ({
      date: t.date,
      amount: t.amount,
      balance: t.bankBalance,
    })),
  );
  return {
    entries,
    gaps:
      bank.length > 0
        ? checkBalances({ anchor, transactions: ordered, bank })
        : [],
    offDays: bank
      .filter(({ date, balance }) => balance !== history.on(date))
      .map(({ date }) => date),
  };
}
