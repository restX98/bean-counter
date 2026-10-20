import { formatDate } from "../dates.ts";

// A statement file read into a table: its column names and the rows under
// them. CSV cells are always text; Excel cells can also be numbers and dates.

/** A cell's value. Excel dates come as calendar days, like the rest of the app. */
export type Cell = string | number | { date: string };

export interface TableRow {
  /** The row's number in the file, counting from 1, for messages. */
  line: number;
  cells: Cell[];
}

export interface Table {
  /** From the header row, or "Column 1", "Column 2"… when there's none. */
  columns: string[];
  /** The rows under the header, without blank ones. */
  rows: TableRow[];
}

export type TableResult =
  { ok: true; table: Table } | { ok: false; error: string };

/** A cell as text. Numbers are written as Excel shows them, to 15 digits. */
export function cellText(cell: Cell): string {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return String(Number(cell.toPrecision(15)));
  return formatDate(cell.date);
}

// Digits with the characters that dates, times and amounts use, no letters.
const VALUE_TEXT = /^[\d\s.,'’/:+\-−]+$/;

const looksLikeValue = (cell: Cell) =>
  typeof cell !== "string" || (VALUE_TEXT.test(cell) && /\d/.test(cell));

const countFilled = (cells: Cell[]) => cells.filter((c) => c !== "").length;

/** One past the last filled cell. */
function width(cells: Cell[]): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== "") return i + 1;
  return 0;
}

/**
 * Finds the header row in a grid of cells and keeps the rows under it.
 *
 * The first row with the most filled cells is the header, so lines above it
 * (account number, period) are skipped. If that row holds values (dates,
 * amounts), it's the first transaction instead: the header is the text-only
 * row just above, if there is one. Without it the file has no header, and
 * the columns get numbers.
 */
export function toTable(grid: Cell[][]): TableResult {
  const rows = grid.map((cells) =>
    cells.map((c) => (typeof c === "string" ? c.trim() : c)),
  );
  const filled = rows.map(countFilled);
  const most = filled.reduce((a, b) => Math.max(a, b), 0);
  if (most === 0) return { ok: false, error: "The file is empty." };
  if (most === 1) {
    return {
      ok: false,
      error: "This file doesn't look like a statement: it has only one column.",
    };
  }

  const isData = (i: number) => rows[i]!.some(looksLikeValue);
  let header = filled.indexOf(most);
  if (isData(header)) {
    do header--;
    while (header >= 0 && (filled[header] === 0 || isData(header)));
  }
  // A single text cell above the transactions is a title, not a header.
  const hasHeader = header >= 0 && filled[header]! >= 2;
  const headerCells = hasHeader ? rows[header]! : [];

  const data = rows
    .map((cells, i) => ({ line: i + 1, cells }))
    .slice(header + 1)
    .filter(({ cells }) => countFilled(cells) > 0);
  const columnCount = data.reduce(
    (count, row) => Math.max(count, width(row.cells)),
    width(headerCells),
  );
  const columns = Array.from({ length: columnCount }, (_, i) => {
    const name = headerCells[i] ?? "";
    return name === "" ? `Column ${i + 1}` : cellText(name);
  });
  return {
    ok: true,
    table: {
      columns,
      rows: data.map(({ line, cells }) => ({
        line,
        cells: Array.from({ length: columnCount }, (_, i) => cells[i] ?? ""),
      })),
    },
  };
}
