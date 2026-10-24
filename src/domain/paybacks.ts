import type { FieldErrors, Validated } from "./accounts.ts";
import { daysBetween } from "./dates.ts";
import { formatAmount, parseAmount } from "./money.ts";
import { contains } from "./rules.ts";

// Split bills (brief §5.10): a friend's payment, a payback, linked to the
// expenses it pays back. My share of an expense is its amount less its
// paybacks; the part of a payment that isn't linked counts as it is.

/** The part of a payment that pays back one expense. */
export interface PaybackLink {
  paymentId: number;
  expenseId: number;
  /** Minor units, positive. */
  amount: number;
}

export interface PaybackTotals {
  /** By expense: what its paybacks add up to. */
  paidBack: Map<number, number>;
  /** By payment: how much of it is linked. */
  linked: Map<number, number>;
}

export function paybackTotals(links: PaybackLink[]): PaybackTotals {
  const paidBack = new Map<number, number>();
  const linked = new Map<number, number>();
  for (const { paymentId, expenseId, amount } of links) {
    paidBack.set(expenseId, (paidBack.get(expenseId) ?? 0) + amount);
    linked.set(paymentId, (linked.get(paymentId) ?? 0) + amount);
  }
  return { paidBack, linked };
}

/**
 * Whether a payment is linked in full: then it's all payback, neither
 * income nor waiting for a category.
 */
export function linkedInFull(
  payment: { id: number; amount: number },
  { linked }: PaybackTotals,
): boolean {
  return linked.get(payment.id) === payment.amount;
}

/**
 * A transaction as a payback link sees it: counted, and neither a transfer
 * nor a possible one.
 */
export interface PaybackTarget {
  id: number;
  /** Its account's currency. */
  currency: string;
  /** Minor units: positive for a payment, negative for an expense. */
  amount: number;
}

/** One other side of a split, with the amount as typed (D9). */
export interface SplitField {
  id: number;
  amount: string;
}

/** What D9 says, for a payment's split or for an expense's. */
const words = (paying: boolean) =>
  paying
    ? {
        wrongWay: "Only money going out can be paid back.",
        gone: "It can't be paid back any more. Pick another expense.",
        full: "It's already paid back in full.",
        left: (left: string) => `Only ${left} of it is left to pay back.`,
        none: "Pick the expenses it pays back.",
        total: (total: string, all: string) =>
          `That's ${total} in all, more than the payment's ${all}.`,
      }
    : {
        wrongWay: "Only money coming in can pay back an expense.",
        gone: "It can't pay anything back any more. Pick another payment.",
        full: "All of it already pays back other expenses.",
        left: (left: string) => `Only ${left} of it is left to link.`,
        none: "Pick the payments that pay it back.",
        total: (total: string, all: string) =>
          `That's ${total} in all, more than the expense's ${all}.`,
      };

/**
 * What's left of `other` to link with `row`: of an expense, what other
 * payments haven't paid back; of a payment, what other expenses haven't
 * taken. `links` are every payback linked so far.
 */
function leftOn(
  other: PaybackTarget,
  row: PaybackTarget,
  links: PaybackLink[],
): number {
  const { paidBack, linked } = paybackTotals(
    links.filter((l) =>
      other.amount < 0 ? l.paymentId !== row.id : l.expenseId !== row.id,
    ),
  );
  return other.amount < 0
    ? -other.amount - (paidBack.get(other.id) ?? 0)
    : other.amount - (linked.get(other.id) ?? 0);
}

/**
 * Checks a split typed in D9: the expenses a payment pays back, or the
 * payments that pay an expense back, each with an amount. It replaces the
 * split the transaction had. `others` are the transactions it could link
 * with, by id, and `links` every payback linked so far: an expense never
 * gets back more than it cost, and a payment never links more than it
 * brought. Errors use each other side's id as key, and `split` for the
 * split as a whole.
 */
export function validateSplit(
  row: PaybackTarget,
  fields: SplitField[],
  others: Map<number, PaybackTarget>,
  links: PaybackLink[],
): Validated<PaybackLink[]> {
  const errors: FieldErrors = {};
  const { currency } = row;
  const paying = row.amount > 0;
  const say = words(paying);
  const money = (minor: number) => formatAmount(minor, currency);

  const split: PaybackLink[] = [];
  // Everything typed, even what's more than is left on another side.
  let total = 0;
  const seen = new Set<number>();
  for (const { id, amount: typed } of fields) {
    const key = String(id);
    const other = others.get(id);
    if (seen.has(id)) {
      errors[key] = "Each one can be in the split once.";
      continue;
    }
    seen.add(id);
    if (!other) {
      errors[key] = say.gone;
      continue;
    }
    if (paying ? other.amount >= 0 : other.amount <= 0) {
      errors[key] = say.wrongWay;
      continue;
    }
    if (other.currency !== currency) {
      errors[key] =
        `It's in ${other.currency}: a payback and its expenses ` +
        `must be in the same currency.`;
      continue;
    }
    if (!typed.trim()) {
      errors[key] = "Enter how much it pays back.";
      continue;
    }
    const parsed = parseAmount(typed, currency);
    if (!parsed.ok) {
      errors[key] = parsed.error;
      continue;
    }
    if (parsed.minor <= 0) {
      errors[key] = "Enter an amount above zero.";
      continue;
    }
    total += parsed.minor;
    const left = leftOn(other, row, links);
    if (left <= 0) errors[key] = say.full;
    else if (parsed.minor > left) errors[key] = say.left(money(left));
    else
      split.push(
        paying
          ? { paymentId: row.id, expenseId: id, amount: parsed.minor }
          : { paymentId: id, expenseId: row.id, amount: parsed.minor },
      );
  }

  if (row.amount === 0) errors.split = "There's nothing to link: it's 0.";
  else if (fields.length === 0) errors.split = say.none;
  else if (total > Math.abs(row.amount))
    errors.split = say.total(money(total), money(Math.abs(row.amount)));

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: split };
}

/** How many days D9 looks back from a payment, or on from an expense. */
export const PAYBACK_WINDOW = 30;

/** Another side D9 offers. */
export type PaybackOption<T> = T & {
  /** What's left of it to link with this transaction. */
  left: number;
  /** What it's linked with this transaction now. */
  linked: number;
};

/**
 * The other sides D9 offers, nearest first: for a payment, the expenses of
 * the 30 days up to it; for an expense, the payments of the 30 days after
 * it. Each in the same currency, with something left, or linked with it
 * already, whatever its date. With `search`, the others beyond those days
 * whose description contains it: older expenses, or later payments.
 * `pool` is what can be linked: counted, and neither a transfer nor a
 * possible one.
 */
export function paybackOptions<
  T extends PaybackTarget & { date: string; description: string },
>(
  row: PaybackTarget & { date: string },
  pool: T[],
  links: PaybackLink[],
  search?: string,
): PaybackOption<T>[] {
  const paying = row.amount > 0;
  const linkedNow = new Map(
    links
      .filter((l) => (paying ? l.paymentId : l.expenseId) === row.id)
      .map((l) => [paying ? l.expenseId : l.paymentId, l.amount]),
  );
  // Before a payment, or after an expense, within the window.
  const beyond = (t: T) => (paying ? t.date < row.date : t.date > row.date);
  const near = (t: T) =>
    (t.date === row.date || beyond(t)) &&
    daysBetween(t.date, row.date) <= PAYBACK_WINDOW;
  const matches = search === undefined ? null : contains(search);
  return pool
    .filter(
      (t) =>
        t.id !== row.id &&
        t.currency === row.currency &&
        (paying ? t.amount < 0 : t.amount > 0),
    )
    .map((t) => ({
      ...t,
      left: leftOn(t, row, links),
      linked: linkedNow.get(t.id) ?? 0,
    }))
    .filter((t) =>
      matches
        ? beyond(t) && !near(t) && t.left > 0 && matches(t.description)
        : (near(t) && t.left > 0) || t.linked > 0,
    )
    .sort(
      (a, b) =>
        daysBetween(a.date, row.date) - daysBetween(b.date, row.date) ||
        a.id - b.id,
    );
}

/**
 * D9's amounts, in the order listed: each one I typed stays as it is, and
 * the others ticked share what's left of `total` (the payment, or the
 * expense), nearest first, each up to what's left on it.
 */
export function prefill(
  total: number,
  rows: { left: number; typed: number | null }[],
): number[] {
  let rest = total - rows.reduce((sum, r) => sum + (r.typed ?? 0), 0);
  return rows.map(({ left, typed }) => {
    if (typed !== null) return typed;
    const amount = Math.max(0, Math.min(left, rest));
    rest -= amount;
    return amount;
  });
}

/**
 * Review's possible paybacks (brief §5.10): money in without a category,
 * not linked, and not one I said is income, with the expenses D9 offers
 * it. One with nothing to pay back isn't suggested. `pool` is what can be
 * linked, as for `paybackOptions`; a possible transfer isn't in it.
 */
export function possiblePaybacks<
  T extends PaybackTarget & {
    date: string;
    description: string;
    categoryId: number | null;
  },
>(
  pool: T[],
  links: PaybackLink[],
  dismissed: ReadonlySet<number>,
): (T & { expenses: PaybackOption<T>[] })[] {
  const linked = new Set(links.map((l) => l.paymentId));
  return pool
    .filter(
      (t) =>
        t.amount > 0 &&
        t.categoryId === null &&
        !linked.has(t.id) &&
        !dismissed.has(t.id),
    )
    .map((t) => ({ ...t, expenses: paybackOptions(t, pool, links) }))
    .filter((t) => t.expenses.length > 0);
}
