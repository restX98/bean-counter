// Money is an integer number of minor units (cents for EUR) plus an ISO 4217
// currency code. Amounts are never floats and never converted between
// currencies.

export interface Currency {
  code: string;
  name: string;
  /** Digits after the decimal point: 2 for EUR, 0 for JPY, 3 for KWD. */
  digits: number;
}

const MAIN_CURRENCY = "EUR";
/** The sign of a negative amount: "−20.00 €", not a hyphen. */
export const MINUS = "−";

const names = new Intl.DisplayNames(["en"], { type: "currency" });

function currencyFormat(code: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
  });
}

let cache: Currency[] | undefined;

/** Every current ISO 4217 currency, EUR first and then by code. */
export function currencies(): Currency[] {
  cache ??= Intl.supportedValuesOf("currency")
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
      digits: currencyFormat(code).resolvedOptions().maximumFractionDigits ?? 2,
    }))
    .sort((a, b) =>
      a.code === MAIN_CURRENCY
        ? -1
        : b.code === MAIN_CURRENCY
          ? 1
          : a.code.localeCompare(b.code),
    );
  return cache;
}

export function findCurrency(code: string): Currency | undefined {
  return currencies().find((c) => c.code === code);
}

export function digitsOf(code: string): number {
  const currency = findCurrency(code);
  if (!currency) throw new Error(`Unknown currency ${code}`);
  return currency.digits;
}

/** The short symbol shown after amounts: € for EUR, $ for USD, CHF for CHF. */
export function currencySymbol(code: string): string {
  const part = currencyFormat(code)
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? code;
}

const grouping = new Intl.NumberFormat("en", { useGrouping: true });

/**
 * Formats minor units as the app shows them: "3,240.50 €", "−18.50 €".
 * With `signed`, positive amounts get a "+" too, as transactions do.
 */
export function formatAmount(
  minor: number,
  currency: string,
  { signed = false }: { signed?: boolean } = {},
): string {
  const sign = minor < 0 ? MINUS : signed && minor > 0 ? "+" : "";
  return `${sign}${formatSize(minor, currency)} ${currencySymbol(currency)}`;
}

/** An amount's size without sign or symbol, as typed in a field: "3,240.50". */
export function formatSize(minor: number, currency: string): string {
  const digits = digitsOf(currency);
  const abs = Math.abs(minor);
  const scale = 10 ** digits;
  const rest = abs % scale;
  const whole = grouping.format((abs - rest) / scale);
  const fraction = digits > 0 ? "." + String(rest).padStart(digits, "0") : "";
  return `${whole}${fraction}`;
}

export type ParseResult =
  { ok: true; minor: number } | { ok: false; error: string };

const SIGN = /^[+\-−]/;
// Written the way the app shows amounts: digits with optional comma thousands
// separators, then an optional decimal point (3,240.50).
const POINT_DECIMALS = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
// A single comma followed by one or two digits can only be decimals (3240,50).
// Phone keypads in many languages type a comma there.
const COMMA_DECIMALS = /^(\d+),(\d{1,2})$/;

/** Removes the currency's symbol or code from either end: "3,240.50 €", "EUR 12". */
export function stripCurrency(text: string, currency: string): string {
  let rest = text;
  for (const token of [currencySymbol(currency), currency]) {
    const upper = rest.toUpperCase();
    if (upper.startsWith(token.toUpperCase())) rest = rest.slice(token.length);
    else if (upper.endsWith(token.toUpperCase()))
      rest = rest.slice(0, -token.length);
    rest = rest.trim();
  }
  return rest;
}

/**
 * Parses an amount typed by hand into minor units: "3,240.50", "-12",
 * "3240,50", "3,240.50 €". Anything else is refused rather than guessed.
 */
export function parseAmount(text: string, currency: string): ParseResult {
  const digits = digitsOf(currency);
  let rest = text.trim();
  let sign = SIGN.exec(rest)?.[0] ?? "";
  rest = stripCurrency(rest.slice(sign.length).trim(), currency);
  if (!sign) {
    // The sign can also follow the symbol: "€ -18.50".
    sign = SIGN.exec(rest)?.[0] ?? "";
    rest = rest.slice(sign.length).trim();
  }
  const match = COMMA_DECIMALS.exec(rest) ?? POINT_DECIMALS.exec(rest);
  if (!match) {
    return {
      ok: false,
      error: "Write the amount like 3,240.50, with a point for decimals.",
    };
  }
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > digits) {
    return {
      ok: false,
      error:
        digits === 0
          ? `${currency} amounts have no decimals.`
          : `${currency} amounts have at most ${digits} decimals.`,
    };
  }
  const minor = Number(whole.replace(/,/g, "") + fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, minor: sign === "" || sign === "+" ? minor : -minor };
}

/**
 * The same written amount in a currency with a different number of decimals:
 * 1,120.50 in EUR (112050) is 1,120.500 in KWD (1120500). Returns undefined
 * when the amount can't be written exactly in the new currency: it has too
 * many decimals (1,120.50 in JPY), or more decimals make it too large.
 */
export function rescale(
  minor: number,
  from: string,
  to: string,
): number | undefined {
  const diff = digitsOf(to) - digitsOf(from);
  if (diff >= 0) {
    const moved = minor * 10 ** diff;
    return Number.isSafeInteger(moved) ? moved : undefined;
  }
  const factor = 10 ** -diff;
  return minor % factor === 0 ? minor / factor : undefined;
}
