import { formatDate, isIsoDate } from "../dates.ts";
import { digitsOf, stripCurrency, type ParseResult } from "../money.ts";
import { cellText, type Cell } from "./table.ts";

// Reading dates and amounts the way one bank writes them. Each export format
// has its own date format and decimal mark, saved with its column mapping.

/** The order of day, month and year. The parts can be separated by /, . or -. */
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

// A time after the date is ignored: "01/10/2026 14:32", "2026-10-01T14:32:05Z".
const TIME = String.raw`(?:[ T]\d{1,2}[:.]\d{2}.*)?`;
const YEAR_LAST = new RegExp(
  String.raw`^(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})${TIME}$`,
);
const YEAR_FIRST = new RegExp(
  String.raw`^(\d{4})([./-])(\d{1,2})\2(\d{1,2})${TIME}$`,
);

/**
 * A statement's date as an ISO date, or undefined if it isn't one in this
 * format. A two-digit year is in the 2000s. Excel dates need no format.
 */
export function parseStatementDate(
  cell: Cell,
  format: DateFormat,
): string | undefined {
  if (typeof cell === "object") return cell.date;
  if (typeof cell === "number") return undefined;

  let year: string, month: string, day: string;
  if (format === "YYYY-MM-DD") {
    const match = YEAR_FIRST.exec(cell);
    if (!match) return undefined;
    [, year = "", , month = "", day = ""] = match;
  } else {
    const match = YEAR_LAST.exec(cell);
    if (!match) return undefined;
    const [, first = "", , second = "", y = ""] = match;
    [day, month] = format === "DD/MM/YYYY" ? [first, second] : [second, first];
    year = y.length === 2 ? `20${y}` : y;
  }
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : undefined;
}

/** The character between whole units and decimals: 1,234.56 or 1.234,56. */
export type DecimalMark = "point" | "comma";

// The whole part may group thousands with the other mark, a space or an
// apostrophe, but only in groups of three. So with the wrong decimal mark,
// "56,30" is refused instead of being read as 5,630.
const AMOUNT: Record<DecimalMark, RegExp> = {
  point: /^(\d{1,3}(?:[, \u00a0\u202f'\u2019]\d{3})+|\d+)(?:\.(\d+))?$/,
  comma: /^(\d{1,3}(?:[. \u00a0\u202f'\u2019]\d{3})+|\d+)(?:,(\d+))?$/,
};
const SIGN = /^[+\-−]/;
const TRAILING_MINUS = /[-−]$/;

/**
 * A statement's amount in minor units: "-56,30", "2.000,00", "56,30-",
 * "€ 1,234.56". Decimals past the currency's are allowed only if they're
 * zeros. Excel numbers are read as Excel shows them, whatever the mark.
 */
export function parseStatementAmount(
  cell: Cell,
  mark: DecimalMark,
  currency: string,
): ParseResult {
  if (typeof cell === "object") {
    return {
      ok: false,
      error: `${formatDate(cell.date)} is a date, not an amount.`,
    };
  }
  return typeof cell === "number"
    ? parseText(cellText(cell), "point", currency)
    : parseText(cell, mark, currency);
}

function parseText(
  text: string,
  mark: DecimalMark,
  currency: string,
): ParseResult {
  const digits = digitsOf(currency);
  let rest = text.trim();
  let sign = SIGN.exec(rest)?.[0] ?? "";
  rest = stripCurrency(rest.slice(sign.length).trim(), currency);
  if (!sign) {
    // After the symbol ("€ -18.50") or at the end ("56,30-").
    sign = SIGN.exec(rest)?.[0] ?? TRAILING_MINUS.exec(rest)?.[0] ?? "";
    rest = rest.startsWith(sign)
      ? rest.slice(sign.length)
      : rest.slice(0, -sign.length);
    rest = rest.trim();
  }

  const match = AMOUNT[mark].exec(rest);
  if (!match) {
    return {
      ok: false,
      error: `"${text}" isn't an amount with a ${mark} for decimals.`,
    };
  }
  const [, whole = "", decimals = ""] = match;
  if (/[^0]/.test(decimals.slice(digits))) {
    return {
      ok: false,
      error:
        digits === 0
          ? `"${text}" has decimals, and ${currency} amounts have none.`
          : `"${text}" has more than ${digits} decimals.`,
    };
  }
  const minor = Number(
    whole.replace(/\D/g, "") + decimals.slice(0, digits).padEnd(digits, "0"),
  );
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, error: `"${text}" is too large.` };
  }
  // No −0: "-0,00" is zero.
  return { ok: true, minor: sign && sign !== "+" && minor ? -minor : minor };
}
