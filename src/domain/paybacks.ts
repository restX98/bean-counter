import type { FieldErrors, Validated } from "./accounts.ts";
import { formatAmount, parseAmount } from "./money.ts";

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

/** One expense of a split, with the amount as typed (D9). */
export interface SplitField {
  expenseId: number;
  amount: string;
}

/**
 * Checks how a payment is split across the expenses it pays back (D9). The
 * split replaces any the payment had. `expenses` are the transactions it
 * could pay back, by id, and `links` every payback linked so far: an
 * expense never gets back more than it cost. Errors use each expense's id
 * as key, and `expenses` for the split as a whole.
 */
export function validateSplit(
  payment: PaybackTarget,
  fields: SplitField[],
  expenses: Map<number, PaybackTarget>,
  links: PaybackLink[],
): Validated<PaybackLink[]> {
  const errors: FieldErrors = {};
  const { currency } = payment;
  const money = (minor: number) => formatAmount(minor, currency);
  // What each expense got back from other payments.
  const { paidBack } = paybackTotals(
    links.filter((l) => l.paymentId !== payment.id),
  );

  const split: PaybackLink[] = [];
  const seen = new Set<number>();
  for (const { expenseId, amount: typed } of fields) {
    const key = String(expenseId);
    const expense = expenses.get(expenseId);
    if (seen.has(expenseId)) {
      errors[key] = "Each expense can be in the split once.";
      continue;
    }
    seen.add(expenseId);
    if (!expense) {
      errors[key] = "It can't be paid back any more. Pick another expense.";
      continue;
    }
    if (expense.amount >= 0) {
      errors[key] = "Only money going out can be paid back.";
      continue;
    }
    if (expense.currency !== currency) {
      errors[key] =
        `It's in ${expense.currency}: a payback and its expenses ` +
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
    const left = -expense.amount - (paidBack.get(expenseId) ?? 0);
    if (parsed.minor <= 0) errors[key] = "Enter an amount above zero.";
    else if (left <= 0) errors[key] = "It's already paid back in full.";
    else if (parsed.minor > left)
      errors[key] = `Only ${money(left)} of it is left to pay back.`;
    else split.push({ paymentId: payment.id, expenseId, amount: parsed.minor });
  }

  const total = split.reduce((sum, l) => sum + l.amount, 0);
  if (payment.amount <= 0)
    errors.expenses = "Only money coming in can pay back an expense.";
  else if (fields.length === 0)
    errors.expenses = "Pick the expenses it pays back.";
  else if (total > payment.amount)
    errors.expenses =
      `That's ${money(total)} in all, more than the payment's ` +
      `${money(payment.amount)}.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: split };
}
