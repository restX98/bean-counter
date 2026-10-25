import { describe, expect, it } from "vitest";
import { cellText, toTable, type Cell, type Table } from "./table.ts";

function table(grid: Cell[][]): Table {
  const result = toTable(grid);
  if (!result.ok) throw new Error(result.error);
  return result.table;
}

describe("toTable", () => {
  it("takes the first row as the header when the file starts with it", () => {
    expect(
      table([
        ["Date", "Description", "Amount"],
        ["01/10/2026", "SALARY ACME SPA", "2.000,00"],
        ["02/10/2026", "ESSELUNGA MILANO", "-56,30"],
      ]),
    ).toEqual({
      columns: ["Date", "Description", "Amount"],
      rows: [
        { line: 2, cells: ["01/10/2026", "SALARY ACME SPA", "2.000,00"] },
        { line: 3, cells: ["02/10/2026", "ESSELUNGA MILANO", "-56,30"] },
      ],
    });
  });

  it("skips the lines above the header, and blank rows", () => {
    const result = table([
      ["Conto corrente", "IT60X0542811101000000123456"],
      ["Periodo", "01/10/2026 - 31/10/2026"],
      [""],
      ["Data", "Valuta", "Descrizione", "Importo"],
      ["01/10/2026", "01/10/2026", "SALARY ACME SPA", "2.000,00"],
      ["", "", "", ""],
      ["02/10/2026", "03/10/2026", "ESSELUNGA MILANO", "-56,30"],
      [""],
    ]);
    expect(result.columns).toEqual([
      "Data",
      "Valuta",
      "Descrizione",
      "Importo",
    ]);
    expect(result.rows.map((r) => r.line)).toEqual([5, 7]);
  });

  it("trims cells and leaves out empty columns at the end", () => {
    const result = table([
      [" Date ", "Amount", "", ""],
      ["01/10/2026 ", " 12,00", "", ""],
    ]);
    expect(result).toEqual({
      columns: ["Date", "Amount"],
      rows: [{ line: 2, cells: ["01/10/2026", "12,00"] }],
    });
  });

  it("names columns that have values but no name", () => {
    const result = table([
      ["Date", "Description", "Amount", ""],
      ["01/10/2026", "SALARY ACME SPA", "2.000,00", "EUR"],
      ["02/10/2026", "ESSELUNGA MILANO", "-56,30", "EUR"],
    ]);
    expect(result.columns).toEqual([
      "Date",
      "Description",
      "Amount",
      "Column 4",
    ]);
    expect(result.rows).toHaveLength(2);
  });

  it("numbers the columns when the file has no header", () => {
    const result = table([
      ["01/10/2026", "SALARY ACME SPA", "2.000,00"],
      ["02/10/2026", "ESSELUNGA MILANO", "-56,30"],
    ]);
    expect(result.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(result.rows.map((r) => r.line)).toEqual([1, 2]);
  });

  it("skips a title above a file without a header", () => {
    const result = table([
      ["Movimenti"],
      ["01/10/2026", "SALARY ACME SPA", "2.000,00"],
    ]);
    expect(result.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(result.rows.map((r) => r.line)).toEqual([2]);
  });

  it("treats Excel numbers and dates as values, not names", () => {
    const result = table([
      ["Movements"],
      [{ date: "2026-10-01" }, "SALARY ACME SPA", 2000],
    ]);
    expect(result.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(result.rows[0]?.cells).toEqual([
      { date: "2026-10-01" },
      "SALARY ACME SPA",
      2000,
    ]);
  });

  it("refuses an empty file and a file with one column", () => {
    expect(toTable([])).toEqual({ ok: false, error: "The file is empty." });
    expect(toTable([[""], ["", " "]])).toEqual({
      ok: false,
      error: "The file is empty.",
    });
    expect(toTable([["a;b;c"], ["1;2;3"]])).toEqual({
      ok: false,
      error: "This file doesn't look like a statement: it has only one column.",
    });
  });
});

describe("cellText", () => {
  it("writes numbers as Excel shows them, and dates as the app does", () => {
    expect(cellText("SALARY")).toBe("SALARY");
    expect(cellText(-56.3)).toBe("-56.3");
    expect(cellText(0.1 + 0.2)).toBe("0.3");
    expect(cellText({ date: "2026-10-01" })).toBe("01/10/2026");
    expect(cellText({ date: "2026-10-16", time: "21:02:16" })).toBe(
      "16/10/2026 21:02",
    );
  });
});
