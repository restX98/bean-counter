import type { Anchor } from "./accounts.ts";
import { addDays, addMonthsToDay } from "./dates.ts";

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

/** The ranges Balance over time offers (S11). */
export const BALANCE_RANGES = ["3M", "1Y", "All"] as const;
export type BalanceRange = (typeof BALANCE_RANGES)[number];

const RANGE_MONTHS: Record<Exclude<BalanceRange, "All">, number> = {
  "3M": 3,
  "1Y": 12,
};

/** An account with a balance, as Balance over time reads it. */
export interface AccountMovements {
  anchor: Pick<Anchor, "amount" | "date">;
  transactions: Posted[];
}

export interface BalanceSeries {
  /** Every day of the range, oldest first. */
  dates: string[];
  /**
   * Each account's balance at the end of each day, in the order given: null
   * before the first day the app knows it.
   */
  balances: (number | null)[][];
  /** The total of the balances known on each day. */
  totals: number[];
}

/**
 * S11: the end-of-day balances of accounts in one currency, every day of the
 * range up to the newest day any of them has. An account's balances start on
 * its first day with a transaction, or its anchor's day if that's earlier:
 * before then the app doesn't know them, so they count for nothing. After its
 * last day its balance stays as it was, as it does everywhere else.
 */
export function balanceSeries(
  accounts: AccountMovements[],
  range: BalanceRange,
): BalanceSeries {
  if (accounts.length === 0) return { dates: [], balances: [], totals: [] };
  const known = accounts.map(({ anchor, transactions }) => {
    const history = balanceHistory(anchor, transactions);
    const first = history.days[0]?.date;
    const last = history.days.at(-1)?.date;
    return {
      history,
      from: first !== undefined && first < anchor.date ? first : anchor.date,
      to: last !== undefined && last > anchor.date ? last : anchor.date,
    };
  });
  const end = known
    .map((k) => k.to)
    .sort()
    .at(-1)!;
  const earliest = known.map((k) => k.from).sort()[0]!;
  const back =
    range === "All" ? earliest : addMonthsToDay(end, -RANGE_MONTHS[range]);
  const start = back > earliest ? back : earliest;

  const dates: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  const balances = known.map(({ history, from }) =>
    dates.map((day) => (day < from ? null : history.on(day))),
  );
  const totals = dates.map((_, i) =>
    balances.reduce((sum, account) => sum + (account[i] ?? 0), 0),
  );
  return { dates, balances, totals };
}

/** A balance I entered (Set balance), next to the app's on the same day. */
export interface Comparison {
  /** The app's balance at the end of that day. */
  app: number;
  /** How much more mine is than the app's: negative when it's less. */
  difference: number;
  /**
   * The last day with a transaction, when mine is dated after it: newer
   * transactions may simply not be imported yet. Null otherwise.
   */
  lastDate: string | null;
}

export function compareBalance(
  anchor: Pick<Anchor, "amount" | "date">,
  transactions: Posted[],
  mine: DayBalance,
): Comparison {
  const app = balanceHistory(anchor, transactions).on(mine.date);
  let last: string | null = null;
  for (const { date } of transactions)
    if (last === null || date > last) last = date;
  return {
    app,
    difference: mine.balance - app,
    lastDate: last !== null && last < mine.date ? last : null,
  };
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
  /**
   * The app's balance and the bank's at the end of `after` and of `until`.
   * On the anchor's day, the bank's is the anchor.
   */
  balances: { after: BothBalances; until: BothBalances };
}

export interface BothBalances {
  app: number;
  bank: number;
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
    { date: anchor.date, app: anchor.amount, bank: anchor.amount, order: 0 },
    ...bank.map(({ date, balance }) => ({
      date,
      app: history.on(date),
      bank: balance,
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
    const amount = next.bank - next.app - (previous.bank - previous.app);
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
      balances: {
        after: { app: previous.app, bank: previous.bank },
        until: { app: next.app, bank: next.bank },
      },
    });
  }
  return gaps;
}
