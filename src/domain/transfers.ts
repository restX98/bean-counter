import { daysBetween } from "./dates.ts";

// Transfers between my own accounts: money out of one account and the same
// money into another. Two transactions that could be the two sides are
// candidates; a pair that has no other candidates is linked automatically.

/** How many days apart the two sides can be, unless I change it. */
export const TRANSFER_WINDOW = 3;

/** A transaction as transfer detection sees it: counted, and not linked. */
export interface TransferTarget {
  id: number;
  accountId: number;
  currency: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Minor units: negative for money going out. */
  amount: number;
}

/** The pairs I said aren't a transfer, written by `pairKey`. */
export type Dismissed = ReadonlySet<string>;

/** The same key for a pair, whichever side comes first. */
export const pairKey = (a: number, b: number) =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

export interface MatchOptions {
  window?: number;
  dismissed?: Dismissed;
}

/**
 * Whether two transactions could be the two sides of one transfer: in two
 * accounts with the same currency, one out and one in by the same amount, at
 * most `window` days apart, and not a pair I dismissed.
 */
export function isCandidate(
  a: TransferTarget,
  b: TransferTarget,
  { window = TRANSFER_WINDOW, dismissed = new Set() }: MatchOptions = {},
): boolean {
  return (
    a.accountId !== b.accountId &&
    a.currency === b.currency &&
    a.amount !== 0 &&
    a.amount === -b.amount &&
    daysBetween(a.date, b.date) <= window &&
    !dismissed.has(pairKey(a.id, b.id))
  );
}

export interface TransferMatches<T> {
  /** Pairs that are each other's only candidate, linked automatically. */
  links: { out: T; in: T }[];
  /**
   * For the others that have any, their candidates, oldest first: I pick
   * the other side.
   */
  candidates: Map<number, T[]>;
}

/** Finds the transfers among transactions that aren't linked yet. */
export function matchTransfers<T extends TransferTarget>(
  pool: T[],
  options: MatchOptions = {},
): TransferMatches<T> {
  // Only the same amount in the same currency can match.
  const buckets = new Map<string, T[]>();
  for (const t of pool) {
    if (t.amount === 0) continue;
    const key = `${t.currency} ${Math.abs(t.amount)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  const found = new Map<number, T[]>();
  const add = (t: T, candidate: T) =>
    found.set(t.id, [...(found.get(t.id) ?? []), candidate]);
  for (const bucket of buckets.values()) {
    const ins = bucket.filter((t) => t.amount > 0);
    for (const out of bucket.filter((t) => t.amount < 0)) {
      for (const into of ins) {
        if (isCandidate(out, into, options)) {
          add(out, into);
          add(into, out);
        }
      }
    }
  }

  const only = (t: T) => {
    const list = found.get(t.id);
    return list?.length === 1 ? list[0]! : null;
  };
  const links: TransferMatches<T>["links"] = [];
  const linked = new Set<number>();
  for (const t of pool) {
    const other = only(t);
    if (t.amount < 0 && other && only(other) === t) {
      links.push({ out: t, in: other });
      linked.add(t.id).add(other.id);
    }
  }
  const candidates = new Map(
    [...found]
      .filter(([id]) => !linked.has(id))
      .map(([id, list]) => [
        id,
        list.toSorted((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
      ]),
  );
  return { links, candidates };
}

/**
 * What I can link a transaction with by hand (D4): its candidates, even
 * pairs I dismissed, then the transactions in other currencies going the
 * other way within the window, whose amounts can't be compared. Each kind
 * oldest first.
 */
export function linkOptions<T extends TransferTarget>(
  t: TransferTarget,
  pool: T[],
  window = TRANSFER_WINDOW,
): T[] {
  const near = (o: T) =>
    o.accountId !== t.accountId &&
    t.amount !== 0 &&
    Math.sign(o.amount) === -Math.sign(t.amount) &&
    daysBetween(o.date, t.date) <= window;
  const byDate = (a: T, b: T) => a.date.localeCompare(b.date) || a.id - b.id;
  return [
    ...pool
      .filter((o) => near(o) && o.currency === t.currency)
      .filter((o) => o.amount === -t.amount)
      .sort(byDate),
    ...pool.filter((o) => near(o) && o.currency !== t.currency).sort(byDate),
  ];
}

/**
 * What Review asks me to pick, from `matchTransfers`' candidates: in each
 * group of transactions that could pair up in more than one way, the side
 * with fewer of them (money out when they're as many), each with its
 * candidates. The other side are the candidates.
 */
export function transfersToPick<T extends TransferTarget>(
  candidates: Map<number, T[]>,
): (T & { candidates: T[] })[] {
  const byId = new Map(
    [...candidates.values()].flat().map((t) => [t.id, t] as const),
  );
  const seen = new Set<number>();
  const picks: (T & { candidates: T[] })[] = [];
  for (const id of candidates.keys()) {
    if (seen.has(id)) continue;
    // The group: everything linked to this one through candidates.
    const group: T[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const next = byId.get(queue.pop()!)!;
      group.push(next);
      for (const other of candidates.get(next.id) ?? []) {
        if (!seen.has(other.id)) {
          seen.add(other.id);
          queue.push(other.id);
        }
      }
    }
    const outs = group.filter((t) => t.amount < 0);
    const ins = group.filter((t) => t.amount > 0);
    for (const t of ins.length < outs.length ? ins : outs) {
      picks.push({ ...t, candidates: candidates.get(t.id)! });
    }
  }
  return picks.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}
