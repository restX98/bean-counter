import type { StatementRow } from "./mapping.ts";

// Finding a file's rows that were already imported, so importing the same
// statement twice, or two that overlap, adds nothing twice.

/**
 * A transaction already in the account, with its values as originally
 * imported (not as edited since). Excluded transactions are included, so a
 * re-import doesn't bring them back.
 */
export interface Imported {
  id: number;
  date: string;
  amount: number;
  description: string;
  reference: string | null;
}

/** A duplicate is skipped; a near-match waits for my decision. */
export type Match =
  | { status: "new" }
  | { status: "duplicate"; of: number }
  | { status: "near-match"; of: number };

type Row = Pick<StatementRow, "date" | "amount" | "description" | "reference">;

/**
 * Matches each row of a file with the account's transactions.
 *
 * A row duplicates a transaction with the same bank reference, or, when one
 * of them has none, the same date, amount and description. Two different
 * references are never the same transaction. Each transaction matches one
 * row at most, so if one of two identical coffees in a file was already
 * imported, the other is still new.
 *
 * A row that isn't a duplicate is a near-match of an unmatched transaction
 * with the same date and amount, unless both have references.
 */
export function findDuplicates(rows: Row[], imported: Imported[]): Match[] {
  const byReference = new Map<string, Imported[]>();
  const byDay = new Map<string, Imported[]>();
  for (const t of imported) {
    const key = `${t.date} ${t.amount}`;
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
    if (t.reference !== null) {
      byReference.set(t.reference, [
        ...(byReference.get(t.reference) ?? []),
        t,
      ]);
    }
  }
  const used = new Set<number>();
  const result: Match[] = rows.map(() => ({ status: "new" }));

  const match = (
    status: "duplicate" | "near-match",
    candidates: (row: Row) => Imported[] | undefined,
    same: (row: Row, t: Imported) => boolean,
  ) => {
    rows.forEach((row, i) => {
      if (result[i]!.status !== "new") return;
      const found = candidates(row)?.find(
        (t) => !used.has(t.id) && same(row, t),
      );
      if (!found) return;
      if (status === "duplicate") used.add(found.id);
      result[i] = { status, of: found.id };
    });
  };
  const sameDateAndAmount = (row: Row) =>
    byDay.get(`${row.date} ${row.amount}`);
  const oneHasNoReference = (row: Row, t: Imported) =>
    row.reference === null || t.reference === null;

  // References first, so a row finds its own transaction before a lookalike.
  match(
    "duplicate",
    (row) =>
      row.reference === null ? undefined : byReference.get(row.reference),
    () => true,
  );
  match(
    "duplicate",
    sameDateAndAmount,
    (row, t) => oneHasNoReference(row, t) && row.description === t.description,
  );
  match("near-match", sameDateAndAmount, oneHasNoReference);
  return result;
}
