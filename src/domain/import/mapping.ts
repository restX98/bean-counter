import { currencySymbol } from "../money.ts";
import { cellText, type Cell, type Table } from "./table.ts";
import {
  parseStatementAmount,
  parseStatementDate,
  type DateFormat,
  type StatementDate,
  type DecimalMark,
} from "./values.ts";

// A column mapping teaches the app one bank's export format: what each column
// holds, the date format and the decimal mark. It's saved as an import preset.

export const COLUMN_ROLES = [
  "date",
  "amount",
  "debit",
  "credit",
  "fee",
  "description",
  "balance",
  "reference",
  "currency",
  "status",
  "ignore",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  date: "Date",
  amount: "Amount",
  debit: "Debit",
  credit: "Credit",
  fee: "Fee",
  description: "Description",
  balance: "Balance",
  reference: "Bank reference",
  currency: "Currency",
  status: "Status",
  ignore: "Ignore",
};

export interface Mapping {
  /** What each column holds, by position. Several can be the description. */
  roles: ColumnRole[];
  dateFormat: DateFormat;
  decimalMark: DecimalMark;
}

const SINGLE_ROLES = [
  "date",
  "amount",
  "debit",
  "credit",
  "fee",
  "balance",
  "reference",
  "currency",
  "status",
] as const;

/** What's missing or doubled in a mapping; empty when it's complete. */
export function checkMapping({ roles }: Mapping): string[] {
  const has = (role: ColumnRole) => roles.filter((r) => r === role).length;
  const problems = SINGLE_ROLES.filter((role) => has(role) > 1).map(
    (role) => `Only one column can be the ${ROLE_LABELS[role]}.`,
  );
  if (!has("date")) problems.push("Pick the Date column.");
  if (has("amount") && (has("debit") || has("credit"))) {
    problems.push(
      "Pick an Amount column or Debit and Credit columns, not both.",
    );
  } else if (!has("amount") && !has("debit") && !has("credit")) {
    problems.push("Pick the Amount column, or the Debit and Credit columns.");
  } else if (!has("amount") && !has("credit")) {
    problems.push("Pick the Credit column too.");
  } else if (!has("amount") && !has("debit")) {
    problems.push("Pick the Debit column too.");
  }
  if (!has("description")) problems.push("Pick a Description column.");
  return problems;
}

/** A transaction as the statement writes it. */
export interface StatementRow {
  /** The row's number in the file. */
  line: number;
  date: string;
  /** "14:32:05", when the file has times. */
  time: string | null;
  /** In minor units, after any fee: negative for money going out. */
  amount: number;
  /** The description columns, joined with " · ". */
  description: string;
  /** The bank's own id for the transaction, if the file has one. */
  reference: string | null;
  /** The account's balance after this row, if the file has a balance column. */
  balance: number | null;
}

export interface RowError {
  line: number;
  /** Every problem in the row, each starting with its column's name. */
  problems: string[];
}

/** A row that is read but not imported, and why. */
export interface LeftOutRow {
  line: number;
  /** In another currency than the account's, or not completed. */
  reason: "currency" | "status";
  /** The row's currency or status, as the file writes it. */
  value: string;
}

/** One row, read with as much of the mapping as there is. */
export interface RowReading {
  /** Null without a date column, or when the date can't be read. */
  date: string | null;
  time: string | null;
  /** Null without amount columns, or when the amount can't be read. */
  amount: number | null;
  description: string;
  reference: string | null;
  balance: number | null;
  /** What can't be read, each starting with its column's name. */
  problems: string[];
  /** Why the row isn't imported, even if it can be read. */
  leftOut: Omit<LeftOutRow, "line"> | null;
}

// The statuses of transactions that went through, in the languages banks
// nearby use. Rows with any other status (pending, reverted, declined) are
// left out; mapping the status column to Ignore imports every row.
const DONE =
  /^(completed?|booked|posted|settled|cleared|executed|done|contabilizzat[oa]|eseguit[oa]|gebucht|ausgef(u|ue|ü)hrt|completad[oa]|realizad[oa])$/i;

/**
 * Reads one row. The mapping can still be incomplete, as in S8's live
 * preview: a role without a column gives null rather than a problem.
 */
export function readRow(
  columns: string[],
  cells: Cell[],
  { roles, dateFormat, decimalMark }: Mapping,
  currency: string,
): RowReading {
  const columnsFor = (role: ColumnRole) =>
    columns.flatMap((_, i) => (roles[i] === role ? [i] : []));
  const [date] = columnsFor("date");
  const [amount] = columnsFor("amount");
  const [debit] = columnsFor("debit");
  const [credit] = columnsFor("credit");
  const [fee] = columnsFor("fee");
  const [balance] = columnsFor("balance");
  const [reference] = columnsFor("reference");
  const [rowCurrency] = columnsFor("currency");
  const [status] = columnsFor("status");

  const problems: string[] = [];
  const name = (i: number) => columns[i]!;
  const cell = (i: number) => cells[i] ?? "";
  const text = (i: number | undefined) =>
    i === undefined ? "" : cellText(cell(i)).trim();

  /** An amount column's value, or null if the cell is empty or unreadable. */
  const amountIn = (i: number | undefined): number | null => {
    if (i === undefined || cell(i) === "") return null;
    const result = parseStatementAmount(cell(i), decimalMark, currency);
    if (result.ok) return result.minor;
    problems.push(`${name(i)}: ${result.error}`);
    return null;
  };

  let when: StatementDate | undefined;
  if (date !== undefined) {
    if (cell(date) === "") problems.push(`${name(date)} is empty.`);
    else {
      when = parseStatementDate(cell(date), dateFormat);
      if (!when) {
        problems.push(
          `${name(date)}: "${cellText(cell(date))}" isn't a ${dateFormat} date.`,
        );
      }
    }
  }

  let value: number | null = null;
  if (amount !== undefined) {
    value = amountIn(amount);
    if (cell(amount) === "") problems.push(`${name(amount)} is empty.`);
  } else if (debit !== undefined && credit !== undefined) {
    // Banks write debits with or without a minus, so only the size counts.
    const out = amountIn(debit);
    const into = amountIn(credit);
    value = Math.abs(into ?? 0) - Math.abs(out ?? 0);
    if (cell(debit) === "" && cell(credit) === "") {
      problems.push(`${name(debit)} and ${name(credit)} are both empty.`);
    } else if (out && into) {
      problems.push(`${name(debit)} and ${name(credit)} both have an amount.`);
    }
  }
  // A fee is charged on top of the amount, as some banks write it.
  const charged = amountIn(fee);
  if (value !== null && charged) value -= Math.abs(charged);

  // An empty status or currency says nothing, so the row stays.
  const state = text(status);
  const code = text(rowCurrency).toUpperCase();
  const leftOut: RowReading["leftOut"] =
    state && !DONE.test(state)
      ? { reason: "status", value: state }
      : code &&
          code !== currency &&
          code !== currencySymbol(currency).toUpperCase()
        ? { reason: "currency", value: code }
        : null;

  return {
    date: when?.date ?? null,
    time: when?.time ?? null,
    amount: value,
    description: columnsFor("description")
      .map((i) => cellText(cell(i)).replace(/\s+/g, " "))
      .filter((text) => text !== "")
      .join(" · "),
    reference: text(reference) || null,
    balance: amountIn(balance),
    problems,
    leftOut,
  };
}

/**
 * Reads every row of the table with a complete mapping (see checkMapping).
 * Rows that can't be read come back as errors; nothing is guessed. Rows in
 * another currency or not completed are left out, whether or not they can
 * be read: a pending payment often has no date yet.
 */
export function readRows(
  table: Table,
  mapping: Mapping,
  currency: string,
): { rows: StatementRow[]; errors: RowError[]; leftOut: LeftOutRow[] } {
  const has = (role: ColumnRole) => mapping.roles.includes(role);
  if (!has("date")) throw new Error("The mapping has no date column.");
  if (!has("amount") && !(has("debit") && has("credit"))) {
    throw new Error("The mapping has no amount columns.");
  }

  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  const leftOut: LeftOutRow[] = [];
  for (const { line, cells } of table.rows) {
    const read = readRow(table.columns, cells, mapping, currency);
    const { date, time, amount, description, reference, balance } = read;
    if (read.leftOut) leftOut.push({ line, ...read.leftOut });
    else if (read.problems.length > 0 || date === null || amount === null) {
      errors.push({ line, problems: read.problems });
    } else {
      rows.push({ line, date, time, amount, description, reference, balance });
    }
  }
  return { rows, errors, leftOut };
}
