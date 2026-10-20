import ExcelJS, { type CellValue } from "exceljs";
import Papa from "papaparse";
import {
  toTable,
  type Cell,
  type TableResult,
} from "../domain/import/table.ts";

// Reads an uploaded statement, CSV or .xlsx, into a table. The format comes
// from the file's content, not its name.

const XLSX = [0x50, 0x4b, 0x03, 0x04]; // a zip archive
// Old .xls files, and password-protected .xlsx ones, are OLE containers.
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF = [0x25, 0x50, 0x44, 0x46];

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

const fail = (error: string): TableResult => ({ ok: false, error });
const NOT_A_STATEMENT =
  "This isn't a CSV or Excel file. Download the statement from your bank as CSV or Excel (.xlsx).";

export async function readStatementFile(
  bytes: Uint8Array,
): Promise<TableResult> {
  if (bytes.length === 0) return fail("The file is empty.");
  if (startsWith(bytes, XLSX)) return readExcel(bytes);
  if (startsWith(bytes, OLE)) {
    return fail(
      "This is an old Excel file (.xls) or a password-protected one. Open it in Excel or LibreOffice and save it as .xlsx or .csv, without a password.",
    );
  }
  if (startsWith(bytes, PDF)) return fail(NOT_A_STATEMENT);
  const text = decode(bytes);
  if (text.includes("\0")) return fail(NOT_A_STATEMENT);
  return toTable(parseCsv(text));
}

const SEPARATORS = [",", ";", "\t", "|"];

/**
 * Splits CSV text with the separator that gives the most lines the same
 * number of columns (two or more); on a tie, the one with more columns.
 * Papa Parse's own guess fails on short files and on lines above the header.
 */
function parseCsv(text: string): string[][] {
  let best = { rows: [[text]], lines: 0, columns: 0, delimiter: "," };
  for (const delimiter of SEPARATORS) {
    const rows = Papa.parse<string[]>(text, { delimiter }).data;
    const lines = new Map<number, number>();
    for (const { length } of rows) {
      if (length > 1) lines.set(length, (lines.get(length) ?? 0) + 1);
    }
    for (const [columns, count] of lines) {
      if (
        count > best.lines ||
        (count === best.lines && columns > best.columns)
      ) {
        best = { rows, lines: count, columns, delimiter };
      }
    }
  }
  const { rows, columns, delimiter } = best;
  // Records glued together by missing line breaks make a wider row: two
  // records share the field where they meet, so two make 2 × columns − 1.
  if (columns > 1 && rows.some((row) => row.length >= 2 * columns - 1)) {
    return Papa.parse<string[]>(restoreLineBreaks(text, delimiter), {
      delimiter,
    }).data;
  }
  return rows;
}

/**
 * Puts back the line breaks some exports leave out between records
 * (`…,EUR"02/10/2026",…`). A quote can only open a field, so one in the middle of
 * an unquoted field starts the next record.
 */
function restoreLineBreaks(text: string, delimiter: string): string {
  let out = "";
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        out += '""'; // An escaped quote inside the field.
        i++;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      if (!fieldStart) out += "\n";
      quoted = true;
    }
    if (!quoted)
      fieldStart = char === delimiter || char === "\n" || char === "\r";
    out += char;
  }
  return out;
}

function decode(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: an older Windows export, as many banks still produce.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function readExcel(bytes: Uint8Array): Promise<TableResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS's own Buffer type is an ArrayBuffer; this copies into one.
    await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  } catch {
    return fail("This Excel file can't be read. It may be damaged.");
  }
  const sheet = workbook.worksheets.find((s) => s.actualRowCount > 0);
  if (!sheet) return fail("The file is empty.");
  // Rows and cells count from 1, and empty ones are holes.
  const grid = Array.from(sheet.getSheetValues(), (row) =>
    Array.isArray(row) ? Array.from(row, toCell).slice(1) : [],
  ).slice(1);
  return toTable(grid);
}

function toCell(value: CellValue): Cell {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    // Excel dates have no time zone; ExcelJS returns them as UTC. Midnight
    // is how Excel writes a date without a time.
    if (Number.isNaN(value.getTime())) return "";
    const [date = "", time = ""] = value.toISOString().split(/[T.]/);
    return time === "00:00:00" ? { date } : { date, time };
  }
  if ("richText" in value) return value.richText.map((r) => r.text).join("");
  if ("hyperlink" in value) return value.text;
  // A formula: the value Excel last computed.
  if ("formula" in value || "sharedFormula" in value) {
    return toCell(value.result ?? null);
  }
  return ""; // An error value, such as #N/A.
}
