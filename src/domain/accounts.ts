import { isIsoDate } from "./dates.ts";
import { findCurrency, parseAmount } from "./money.ts";

export const ACCOUNT_TYPES = ["checking", "savings"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * The one known balance of an account: its end-of-day balance on `date`.
 * Every other balance is worked out from it.
 */
export interface Anchor {
  /** Minor units of the account's currency. */
  amount: number;
  date: string;
  /** Typed by hand, or taken from a statement's balance column. */
  source: "manual" | "statement";
}

export interface Account {
  id: number;
  name: string;
  bank: string;
  type: AccountType;
  currency: string;
  anchor: Anchor | null;
  /** The day it was archived, or null while it's active. */
  archivedOn: string | null;
  /** The current balance and the day it's for; null while there's no anchor. */
  balance: { amount: number; date: string } | null;
}

/** The account form's fields, as typed. */
export interface AccountFields {
  name: string;
  bank: string;
  type: string;
  currency: string;
}

/** A balance and its date, as typed (in D1 or D2). */
export interface AnchorFields {
  amount: string;
  date: string;
}

/** Messages to show next to form fields, by field name. */
export type FieldErrors = Record<string, string>;

export type Validated<T> =
  { ok: true; value: T } | { ok: false; errors: FieldErrors };

const MAX_LENGTH = 60;

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

function isAccountType(type: string): type is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(type);
}

/**
 * Checks the account form. `takenNames` are the other accounts' names
 * (archived ones included): two accounts can't share a name.
 */
export function validateAccount(
  fields: AccountFields,
  takenNames: string[],
): Validated<{
  name: string;
  bank: string;
  type: AccountType;
  currency: string;
}> {
  const errors: FieldErrors = {};
  const name = tidy(fields.name);
  const bank = tidy(fields.bank);

  if (!name) errors.name = "Give the account a name.";
  else if (name.length > MAX_LENGTH)
    errors.name = `Keep it under ${MAX_LENGTH} characters.`;
  else if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase()))
    errors.name = `You already have an account called ${name}.`;

  if (!bank) errors.bank = "Enter the bank's name.";
  else if (bank.length > MAX_LENGTH)
    errors.bank = `Keep it under ${MAX_LENGTH} characters.`;

  const type = fields.type;
  if (!isAccountType(type)) errors.type = "Pick checking or savings.";
  if (!findCurrency(fields.currency)) errors.currency = "Pick a currency.";

  if (Object.keys(errors).length > 0 || !isAccountType(type)) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, bank, type, currency: fields.currency } };
}

/** Checks a balance typed by hand. Errors use the keys anchorAmount and anchorDate. */
export function validateAnchor(
  fields: AnchorFields,
  currency: string,
  today: string,
): Validated<{ amount: number; date: string }> {
  const errors: FieldErrors = {};
  let amount = 0;

  if (!fields.amount.trim()) {
    errors.anchorAmount = "Enter the balance.";
  } else {
    const parsed = parseAmount(fields.amount, currency);
    if (parsed.ok) amount = parsed.minor;
    else errors.anchorAmount = parsed.error;
  }

  if (!isIsoDate(fields.date)) errors.anchorDate = "Enter a valid date.";
  else if (fields.date > today)
    errors.anchorDate = "The date can't be in the future.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { amount, date: fields.date } };
}

export interface CurrencyGroup {
  currency: string;
  accounts: Account[];
  /** The sum of the balances; null while any of the accounts has none yet. */
  total: number | null;
}

/**
 * Active accounts grouped by currency, EUR first and then by code. Amounts in
 * different currencies are never added together.
 */
export function groupByCurrency(accounts: Account[]): CurrencyGroup[] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) {
    if (account.archivedOn) continue;
    const list = groups.get(account.currency) ?? [];
    list.push(account);
    groups.set(account.currency, list);
  }
  return [...groups]
    .sort(([a], [b]) =>
      a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b),
    )
    .map(([currency, list]) => ({
      currency,
      accounts: list,
      total: list.every((a) => a.balance)
        ? list.reduce((sum, a) => sum + (a.balance?.amount ?? 0), 0)
        : null,
    }));
}
