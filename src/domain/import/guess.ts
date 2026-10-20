import { checkMapping, type ColumnRole, type Mapping } from "./mapping.ts";
import type { Cell } from "./table.ts";
import {
  DATE_FORMATS,
  parseStatementAmount,
  parseStatementDate,
  type DecimalMark,
} from "./values.ts";

// S8 starts from a guess at a new format's mapping, which I then check.

/** A mapping being made: a column whose role isn't picked yet is null. */
export interface MappingDraft extends Omit<Mapping, "roles"> {
  roles: (ColumnRole | null)[];
}

/** The draft as a mapping: columns not picked yet are ignored. */
export const toMapping = (draft: MappingDraft): Mapping => ({
  ...draft,
  roles: draft.roles.map((role) => role ?? "ignore"),
});

// Words in column names, in the languages banks nearby use. Checked in this
// order, so "Debit Amount" is a debit, not an amount.
const NAMES: [ColumnRole, RegExp][] = [
  [
    "debit",
    /debit|\bdare\b|uscit|addebit|withdraw|paid out|money out|\bsoll\b/,
  ],
  [
    "credit",
    /credit|\bavere\b|entrat|accredit|deposit|paid in|money in|\bhaben\b/,
  ],
  ["fee", /\bfees?\b|commission|spese/],
  ["balance", /balance|saldo|kontostand/],
  ["date", /date|\bdata\b|datum|fecha/],
  ["amount", /amount|importo|betrag|importe|montant/],
  [
    "description",
    /descri|detail|dettagli|payee|beneficiar|causale|memo|narrative|verwendungszweck|merchant/,
  ],
  ["reference", /reference|riferimento|\bref\b|transaction id/],
  // After the date, so "Data valuta" (value date) is a date.
  ["currency", /currenc|\bvaluta\b|wahrung|moneda|divisa/],
  ["status", /\bstate\b|status|\bstato\b|estado|zustand/],
];
// The value date and the day a card payment started come second to the day
// the money moved.
const SECOND_DATE = /valu|start/;
// The shop's currency on a card payment abroad isn't the account's.
const SECOND_CURRENCY = /local|orig/;

const normalize = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Guesses a new format's mapping from its column names and some rows. Roles
 * that can only be used once go to the first column that fits; the others
 * are ignored. Unknown columns are left to pick, unless the guess is already
 * complete: then they're ignored too.
 */
export function guessMapping(
  columns: string[],
  rows: Cell[][],
  currency: string,
): MappingDraft {
  const named = columns.map((column) => {
    const name = normalize(column);
    return NAMES.find(([, words]) => words.test(name))?.[0] ?? null;
  });
  const roles: (ColumnRole | null)[] = [...named];
  const keepFirst = (role: ColumnRole, prefer?: (i: number) => boolean) => {
    const found = named.flatMap((r, i) => (r === role ? [i] : []));
    const chosen = found.find((i) => prefer?.(i) ?? true) ?? found[0];
    for (const i of found) if (i !== chosen) roles[i] = "ignore";
  };

  keepFirst("date", (i) => !SECOND_DATE.test(normalize(columns[i]!)));
  keepFirst("currency", (i) => !SECOND_CURRENCY.test(normalize(columns[i]!)));
  if (named.includes("debit") && named.includes("credit")) {
    named.forEach((r, i) => {
      if (r === "amount") roles[i] = "ignore";
    });
  }
  for (const role of [
    "amount",
    "debit",
    "credit",
    "fee",
    "balance",
    "reference",
    "status",
  ] as const) {
    keepFirst(role);
  }

  const values = (role: ColumnRole) =>
    roles.flatMap((r, i) =>
      r === role
        ? rows.map((cells) => cells[i] ?? "").filter((c) => c !== "")
        : [],
    );
  const draft: MappingDraft = {
    roles,
    dateFormat: guessDateFormat(values("date")),
    decimalMark: guessDecimalMark(
      (["amount", "debit", "credit", "fee", "balance"] as const).flatMap(
        values,
      ),
      currency,
    ),
  };
  return checkMapping(toMapping(draft)).length === 0
    ? { ...draft, roles: roles.map((role) => role ?? "ignore") }
    : draft;
}

/** The format that reads the most dates, day first when they all fit. */
function guessDateFormat(cells: Cell[]) {
  const read = (format: (typeof DATE_FORMATS)[number]) =>
    cells.filter((cell) => parseStatementDate(cell, format)).length;
  return DATE_FORMATS.reduce((best, format) =>
    read(format) > read(best) ? format : best,
  );
}

/**
 * The mark that reads the most amounts. On a tie, a comma with one or two
 * digits after it means comma decimals ("12,5"), where "2,000" doesn't.
 */
function guessDecimalMark(cells: Cell[], currency: string): DecimalMark {
  const read = (mark: DecimalMark) =>
    cells.filter((cell) => parseStatementAmount(cell, mark, currency).ok)
      .length;
  const [point, comma] = [read("point"), read("comma")];
  if (point !== comma) return point > comma ? "point" : "comma";
  return cells.some(
    (cell) => typeof cell === "string" && /,\d{1,2}(?!\d)/.test(cell),
  )
    ? "comma"
    : "point";
}
