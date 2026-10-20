import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readStatementFile } from "./statements.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);

async function read(bytes: Uint8Array) {
  const result = await readStatementFile(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.table;
}

async function excel(build: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("readStatementFile: CSV", () => {
  it("finds the separator and the header", async () => {
    const table = await read(
      utf8(
        "Conto;IT60X0542811101000000123456\n" +
          "\n" +
          "Data;Descrizione;Importo\n" +
          "01/10/2026;SALARY ACME SPA;2.000,00\n" +
          "02/10/2026;ESSELUNGA MILANO;-56,30\n",
      ),
    );
    expect(table).toEqual({
      columns: ["Data", "Descrizione", "Importo"],
      rows: [
        { line: 4, cells: ["01/10/2026", "SALARY ACME SPA", "2.000,00"] },
        { line: 5, cells: ["02/10/2026", "ESSELUNGA MILANO", "-56,30"] },
      ],
    });
  });

  it("reads quoted cells and tabs", async () => {
    const quoted = await read(
      utf8('Date,Description,Amount\r\n01/10/2026,"ACME, SPA",2000.00\r\n'),
    );
    expect(quoted.rows[0]?.cells).toEqual([
      "01/10/2026",
      "ACME, SPA",
      "2000.00",
    ]);
    const tabs = await read(utf8("Date\tAmount\n01/10/2026\t12.00\n"));
    expect(tabs.columns).toEqual(["Date", "Amount"]);
  });

  it("puts back line breaks missing between records", async () => {
    // As in a real export: after the first record, each one starts right
    // after the last field of the one before.
    const table = await read(
      utf8(
        "Date,Description,Debit,Credit,Balance,Currency\n" +
          '"01/10/2026","SALARY",,"2,000.00","2000.00",EUR\n' +
          '"02/10/2026","TESCO","57.00",,"1943.00",EUR' +
          '"03/10/2026","ATM","100.00",,"1843.00",EUR' +
          '"04/10/2026","SAY ""HI""","1.00",,"1842.00",EUR',
      ),
    );
    expect(table.columns).toHaveLength(6);
    expect(table.rows.map((r) => r.cells.slice(0, 2))).toEqual([
      ["01/10/2026", "SALARY"],
      ["02/10/2026", "TESCO"],
      ["03/10/2026", "ATM"],
      ["04/10/2026", 'SAY "HI"'],
    ]);
  });

  it("puts back a single missing line break", async () => {
    const table = await read(
      utf8(
        "Date,Description,Amount,Currency\n" +
          '"01/10/2026","SALARY","2000.00",EUR\n' +
          '"02/10/2026","TESCO","-57.00",EUR' +
          '"03/10/2026","ATM","-100.00",EUR',
      ),
    );
    expect(table.rows.map((r) => r.cells[1])).toEqual([
      "SALARY",
      "TESCO",
      "ATM",
    ]);
  });

  it("leaves a stray quote alone when the rows are fine", async () => {
    const table = await read(
      utf8('Date,Description,Amount\n01/10/2026,TABLET 5" SCREEN,12.00\n'),
    );
    expect(table.rows[0]?.cells).toEqual([
      "01/10/2026",
      'TABLET 5" SCREEN',
      "12.00",
    ]);
  });

  it("reads UTF-8 with a byte order mark, UTF-16 and Windows text", async () => {
    const withBom = await read(utf8("\uFEFFData;Importo\n01/10/2026;1,00\n"));
    expect(withBom.columns).toEqual(["Data", "Importo"]);

    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...Array.from("Date;Caffè\n01/10/2026;1\n").flatMap((c) => [
        c.charCodeAt(0),
        0,
      ]),
    ]);
    expect((await read(utf16)).columns).toEqual(["Date", "Caffè"]);

    // "Caffè" in Windows-1252: è is the single byte 0xE8.
    const windows = new Uint8Array([
      ...utf8("Date;Caff"),
      0xe8,
      ...utf8("\n01/10/2026;1\n"),
    ]);
    expect((await read(windows)).columns).toEqual(["Date", "Caffè"]);
  });

  it("refuses empty files, old Excel files, PDFs and other binary files", async () => {
    expect(await readStatementFile(new Uint8Array())).toEqual({
      ok: false,
      error: "The file is empty.",
    });
    const xls = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
    ]);
    expect(await readStatementFile(xls)).toMatchObject({
      ok: false,
      error: expect.stringContaining("old Excel file (.xls)"),
    });
    const notStatement = {
      ok: false,
      error: expect.stringContaining("This isn't a CSV or Excel file."),
    };
    expect(await readStatementFile(utf8("%PDF-1.7\n"))).toMatchObject(
      notStatement,
    );
    expect(
      await readStatementFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1])),
    ).toMatchObject(notStatement);
  });
});

describe("readStatementFile: Excel", () => {
  it("reads text, numbers and dates from the first sheet with data", async () => {
    const bytes = await excel((workbook) => {
      workbook.addWorksheet("Cover");
      const sheet = workbook.addWorksheet("Movements");
      sheet.addRow(["Account", "Main checking"]);
      sheet.addRow([]);
      sheet.addRow(["Date", "Description", "Amount", "Balance"]);
      sheet.addRow([
        new Date(Date.UTC(2026, 9, 1)),
        "SALARY ACME SPA",
        2000,
        3240.5,
      ]);
      sheet.addRow([
        new Date(Date.UTC(2026, 9, 2, 14, 32, 5)),
        "ESSELUNGA",
        -56.3,
      ]);
    });
    expect(await read(bytes)).toEqual({
      columns: ["Date", "Description", "Amount", "Balance"],
      rows: [
        {
          line: 4,
          cells: [{ date: "2026-10-01" }, "SALARY ACME SPA", 2000, 3240.5],
        },
        {
          line: 5,
          cells: [
            { date: "2026-10-02", time: "14:32:05" },
            "ESSELUNGA",
            -56.3,
            "",
          ],
        },
      ],
    });
  });

  it("reads rich text, links and formula results as values", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("Sheet1");
      sheet.addRow(["Date", "Description", "Amount", "Note"]);
      sheet.addRow([
        "01/10/2026",
        {
          richText: [{ text: "ACME " }, { text: "SPA", font: { bold: true } }],
        },
        { formula: "1000*2", result: 2000 },
        { text: "receipt", hyperlink: "https://example.com" },
      ]);
    });
    expect((await read(bytes)).rows[0]?.cells).toEqual([
      "01/10/2026",
      "ACME SPA",
      2000,
      "receipt",
    ]);
  });

  it("refuses a damaged file", async () => {
    const damaged = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(await readStatementFile(damaged)).toEqual({
      ok: false,
      error: "This Excel file can't be read. It may be damaged.",
    });
  });
});
