import type { Anchor } from "./accounts.ts";

// An account's balances all come from its anchor, one known end-of-day
// balance: the transactions before it are subtracted, the ones after added.

/** Money that moved on a day: a transaction or a statement row. */
export interface Movement {
  date: string;
  /** Minor units: negative for money going out. */
  amount: number;
}

/** A transaction of the account. Excluded ones don't count. */
export interface Posted extends Movement {
  excluded: boolean;
}

export interface DayBalance {
  date: string;
  balance: number;
}

export interface BalanceHistory {
  /** The balance before the first transaction, worked out from the anchor. */
  opening: number;
  /** The balance at the end of each day with transactions, oldest first. */
  days: DayBalance[];
  /** The balance at the end of any day. */
  on: (date: string) => number;
}

export function balanceHistory(
  anchor: Pick<Anchor, "amount" | "date">,
  transactions: Posted[],
): BalanceHistory {
  const totals = new Map<string, number>();
  for (const { date, amount, excluded } of transactions) {
    if (!excluded) totals.set(date, (totals.get(date) ?? 0) + amount);
  }
  const dates = [...totals.keys()].sort();
  let running = 0;
  const cumulative = dates.map((date) => (running += totals.get(date)!));

  /** The total of every day up to and including this one. */
  const upTo = (date: string) => {
    let low = 0;
    let high = dates.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (dates[middle]! <= date) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? 0 : cumulative[low - 1]!;
  };

  const opening = anchor.amount - upTo(anchor.date);
  return {
    opening,
    days: dates.map((date, i) => ({ date, balance: opening + cumulative[i]! })),
    on: (date) => opening + upTo(date),
  };
}

/**
 * The account's latest balance: at the end of its last day with a
 * transaction, or of the anchor's day if that's later.
 */
export function currentBalance(
  anchor: Pick<Anchor, "amount" | "date">,
  transactions: Posted[],
): DayBalance {
  const history = balanceHistory(anchor, transactions);
  const last = history.days.at(-1)?.date;
  const date = last !== undefined && last > anchor.date ? last : anchor.date;
  return { date, balance: history.on(date) };
}

/**
 * The bank's balance at the end of each day, oldest first, from statement
 * rows that carry one. Each row moves the balance from (balance − amount) to
 * its balance, so the day ends at the balance that no row of that day starts
 * from, whatever order the file lists them in. If they don't chain, the
 * file's order decides.
 */
export function bankBalances(
  rows: (Movement & { balance: number | null })[],
): DayBalance[] {
  const known = rows.filter(
    (row): row is Movement & { balance: number } => row.balance !== null,
  );
  const newestFirst = known.length > 1 && known[0]!.date > known.at(-1)!.date;
  const days = new Map<string, typeof known>();
  for (const row of newestFirst ? known.toReversed() : known) {
    days.set(row.date, [...(days.get(row.date) ?? []), row]);
  }
  return [...days]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) => ({ date, balance: endOfDay(day) }));
}

function endOfDay(day: (Movement & { balance: number })[]): number {
  const net = new Map<number, number>();
  for (const { amount, balance } of day) {
    net.set(balance, (net.get(balance) ?? 0) + 1);
    net.set(balance - amount, (net.get(balance - amount) ?? 0) - 1);
  }
  const ends = [...net].filter(([, count]) => count > 0);
  return ends.length === 1 && ends[0]![1] === 1
    ? ends[0]![0]
    : day.at(-1)!.balance;
}

/**
 * Why a transaction might explain a gap, most likely first. Missing from the
 * app: a statement row that was "skipped", or a transaction I "excluded".
 * Extra in the app: a near-match I kept although it looked like a duplicate
 * ("kept-near-match"), or, only as a guess, any other transaction with the
 * opposite amount ("same-amount"), such as a payment the bank reversed.
 */
export type SuspectReason =
  "skipped" | "excluded" | "kept-near-match" | "same-amount";

export interface Suspect<T> {
  transaction: T;
  reason: SuspectReason;
}

/**
 * Where the app's balances and the bank's part ways. The bank only reports
 * balances on some days, so a gap can't be placed more precisely than between
 * two of them: it lies in the transactions dated after `after` and up to
 * `until`. The anchor counts as a day where they agree.
 */
export interface BalanceGap<T> {
  after: string;
  /** The same day as `after` when the anchor itself disagrees with the bank. */
  until: string;
  /**
   * How much more the bank's balance moved in those days than the app's: the
   * amount of a missing transaction, or the opposite of an extra one's.
   */
  amount: number;
  /** Transactions in those days that would explain it, most likely first. */
  suspects: Suspect<T>[];
}

/** A transaction as the balance check sees it. */
export interface Checked extends Posted {
  /** Kept although the import flagged it as a near-match of another one. */
  keptNearMatch: boolean;
}

/**
 * Compares the app's end-of-day balances with the bank's. The difference
 * between them only changes where a transaction is missing or extra, so each
 * change is a gap, on either side of the anchor. No gaps: they agree.
 */
export function checkBalances<T extends Checked, S extends Movement>({
  anchor,
  transactions,
  bank,
  skipped = [],
}: {
  anchor: Pick<Anchor, "amount" | "date">;
  /** All of them, excluded ones too: those can explain a gap. */
  transactions: T[];
  bank: DayBalance[];
  /** Statement rows that weren't imported, such as duplicates. */
  skipped?: S[];
}): BalanceGap<T | S>[] {
  const history = balanceHistory(anchor, transactions);
  const points = [
    // First on its day, so a bank balance that day is compared with it.
    { date: anchor.date, difference: 0, order: 0 },
    ...bank.map(({ date, balance }) => ({
      date,
      difference: balance - history.on(date),
      order: 1,
    })),
  ].sort((a, b) =>
    a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1,
  );
  const counted = transactions.filter((t) => !t.excluded);
  // What can explain a gap, most likely first. Missing transactions have the
  // gap's amount; extra ones have the opposite.
  const candidates: [SuspectReason, (T | S)[], 1 | -1][] = [
    ["skipped", skipped, 1],
    ["excluded", transactions.filter((t) => t.excluded), 1],
    ["kept-near-match", counted.filter((t) => t.keptNearMatch), -1],
    ["same-amount", counted.filter((t) => !t.keptNearMatch), -1],
  ];

  const gaps: BalanceGap<T | S>[] = [];
  for (let i = 1; i < points.length; i++) {
    const [previous, next] = [points[i - 1]!, points[i]!];
    const amount = next.difference - previous.difference;
    if (amount === 0) continue;
    gaps.push({
      after: previous.date,
      until: next.date,
      amount,
      suspects: candidates.flatMap(([reason, list, sign]) =>
        list
          .filter(
            (t) =>
              t.date > previous.date &&
              t.date <= next.date &&
              t.amount === sign * amount,
          )
          .map((transaction) => ({ transaction, reason })),
      ),
    });
  }
  return gaps;
}
