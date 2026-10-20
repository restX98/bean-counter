import { cellText, type Table } from "./table.ts";
import {
  parseStatementAmount,
  parseStatementDate,
  type DateFormat,
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

/**
 * Reads every row of the table with a complete mapping (see checkMapping).
 * Rows that can't be read come back as errors; nothing is guessed.
 */
export function readRows(
  table: Table,
  { roles, dateFormat, decimalMark }: Mapping,
  currency: string,
): { rows: StatementRow[]; errors: RowError[] } {
  const columnsFor = (role: ColumnRole) =>
    table.columns.flatMap((_, i) => (roles[i] === role ? [i] : []));
  const [date] = columnsFor("date");
  const [amount] = columnsFor("amount");
  const [debit] = columnsFor("debit");
  const [credit] = columnsFor("credit");
  const [fee] = columnsFor("fee");
  const [balance] = columnsFor("balance");
  const [reference] = columnsFor("reference");
  const descriptions = columnsFor("description");
  if (date === undefined) throw new Error("The mapping has no date column.");

  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  for (const { line, cells } of table.rows) {
    const problems: string[] = [];
    const name = (i: number) => table.columns[i]!;
    const cell = (i: number) => cells[i] ?? "";

    /** An amount column's value, or null if the cell is empty or unreadable. */
    const amountIn = (i: number | undefined): number | null => {
      if (i === undefined || cell(i) === "") return null;
      const result = parseStatementAmount(cell(i), decimalMark, currency);
      if (result.ok) return result.minor;
      problems.push(`${name(i)}: ${result.error}`);
      return null;
    };

    let day: string | undefined;
    if (cell(date) === "") problems.push(`${name(date)} is empty.`);
    else {
      day = parseStatementDate(cell(date), dateFormat);
      if (!day) {
        problems.push(
          `${name(date)}: "${cellText(cell(date))}" isn't a ${dateFormat} date.`,
        );
      }
    }

    let value: number | null;
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
        problems.push(
          `${name(debit)} and ${name(credit)} both have an amount.`,
        );
      }
    } else {
      throw new Error("The mapping has no amount columns.");
    }
    // A fee is charged on top of the amount, as some banks write it.
    const charged = amountIn(fee);
    if (value !== null && charged) value -= Math.abs(charged);

    const balanceAfter = amountIn(balance);
    if (problems.length > 0 || day === undefined || value === null) {
      errors.push({ line, problems });
      continue;
    }
    rows.push({
      line,
      date: day,
      amount: value,
      description: descriptions
        .map((i) => cellText(cell(i)).replace(/\s+/g, " "))
        .filter((text) => text !== "")
        .join(" · "),
      reference:
        reference === undefined || cell(reference) === ""
          ? null
          : cellText(cell(reference)),
      balance: balanceAfter,
    });
  }
  return { rows, errors };
}
