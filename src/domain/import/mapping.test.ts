import { describe, expect, it } from "vitest";
import {
  checkMapping,
  readRow,
  readRows,
  type ColumnRole,
  type Mapping,
} from "./mapping.ts";
import type { Cell, Table } from "./table.ts";

const mapping = (roles: ColumnRole[]): Mapping => ({
  roles,
  dateFormat: "DD/MM/YYYY",
  decimalMark: "comma",
});

const table = (columns: string[], ...rows: Cell[][]): Table => ({
  columns,
  rows: rows.map((cells, i) => ({ line: i + 2, cells })),
});

describe("checkMapping", () => {
  it("accepts one amount column, or a debit and a credit column", () => {
    expect(checkMapping(mapping(["date", "description", "amount"]))).toEqual(
      [],
    );
    expect(
      checkMapping(
        mapping([
          "date",
          "ignore",
          "description",
          "debit",
          "credit",
          "balance",
        ]),
      ),
    ).toEqual([]);
  });

  it("names what's missing", () => {
    expect(checkMapping(mapping(["ignore", "description", "ignore"]))).toEqual([
      "Pick the Date column.",
      "Pick the Amount column, or the Debit and Credit columns.",
    ]);
    expect(checkMapping(mapping(["date", "amount"]))).toEqual([
      "Pick a Description column.",
    ]);
    expect(checkMapping(mapping(["date", "description", "debit"]))).toEqual([
      "Pick the Credit column too.",
    ]);
    expect(checkMapping(mapping(["date", "description", "credit"]))).toEqual([
      "Pick the Debit column too.",
    ]);
  });

  it("refuses doubled columns, and an amount with debit and credit", () => {
    expect(
      checkMapping(mapping(["date", "date", "description", "amount"])),
    ).toEqual(["Only one column can be the Date."]);
    expect(
      checkMapping(mapping(["date", "description", "amount", "debit"])),
    ).toEqual(["Pick an Amount column or Debit and Credit columns, not both."]);
  });

  it("lets several columns be the description", () => {
    expect(
      checkMapping(mapping(["date", "description", "description", "amount"])),
    ).toEqual([]);
  });
});

describe("readRows", () => {
  it("reads dates, amounts, descriptions, references and balances", () => {
    const result = readRows(
      table(
        ["Data", "Descrizione", "Importo", "Saldo", "Rif."],
        ["01/10/2026", "SALARY ACME SPA", "2.000,00", "3.240,50", "TX88213"],
        ["02/10/2026", "ESSELUNGA   MILANO", "-56,30", "", ""],
      ),
      mapping(["date", "description", "amount", "balance", "reference"]),
      "EUR",
    );
    expect(result).toEqual({
      rows: [
        {
          line: 2,
          date: "2026-10-01",
          time: null,
          amount: 200000,
          description: "SALARY ACME SPA",
          reference: "TX88213",
          balance: 324050,
        },
        {
          line: 3,
          date: "2026-10-02",
          time: null,
          amount: -5630,
          description: "ESSELUNGA MILANO",
          reference: null,
          balance: null,
        },
      ],
      errors: [],
      leftOut: [],
    });
  });

  it("joins the description columns, skipping empty ones", () => {
    const { rows } = readRows(
      table(
        ["Date", "Payee", "Reference text", "Amount"],
        ["01/10/2026", "ACME SPA", "Salary October", "2000"],
        ["02/10/2026", "ESSELUNGA", "", "-56,30"],
      ),
      mapping(["date", "description", "description", "amount"]),
      "EUR",
    );
    expect(rows.map((r) => r.description)).toEqual([
      "ACME SPA · Salary October",
      "ESSELUNGA",
    ]);
  });

  it("subtracts debits from credits, with or without a minus", () => {
    const { rows, errors } = readRows(
      table(
        ["Date", "Description", "Dare", "Avere"],
        ["01/10/2026", "SALARY", "", "2.000,00"],
        ["02/10/2026", "ESSELUNGA", "56,30", ""],
        ["03/10/2026", "PHARMACY", "-18,50", "0,00"],
      ),
      mapping(["date", "description", "debit", "credit"]),
      "EUR",
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amount)).toEqual([200000, -5630, -1850]);
  });

  it("takes a fee off the amount", () => {
    const { rows, errors } = readRows(
      table(
        ["Completed Date", "Description", "Amount", "Fee", "Balance"],
        ["2026-06-12 21:02:16", "Top-up", "100.00", "0.00", "100.00"],
        ["2026-06-12 21:02:16", "Card Delivery Fee", "0.00", "7.99", "92.01"],
        ["2026-06-13 12:08:46", "Pizza abroad", "-16.00", "0.50", "75.51"],
        ["2026-06-14 09:00:00", "Coffee", "-2.00", "", "73.51"],
      ),
      {
        roles: ["date", "description", "amount", "fee", "balance"],
        dateFormat: "YYYY-MM-DD",
        decimalMark: "point",
      },
      "EUR",
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amount)).toEqual([10000, -799, -1650, -200]);
  });

  it("returns the rows it can't read with every problem", () => {
    const { rows, errors } = readRows(
      table(
        ["Data", "Descrizione", "Dare", "Avere", "Saldo"],
        ["31/02/2026", "SALARY", "", "", "abc"],
        ["", "ESSELUNGA", "56,30", "56,30", ""],
        ["Saldo finale", "", "", "", "3.240,50"],
        ["03/10/2026", "PHARMACY", "18,50", "", ""],
      ),
      mapping(["date", "description", "debit", "credit", "balance"]),
      "EUR",
    );
    expect(errors).toEqual([
      {
        line: 2,
        problems: [
          `Data: "31/02/2026" isn't a DD/MM/YYYY date.`,
          "Dare and Avere are both empty.",
          `Saldo: "abc" isn't an amount with a comma for decimals.`,
        ],
      },
      {
        line: 3,
        problems: ["Data is empty.", "Dare and Avere both have an amount."],
      },
      {
        line: 4,
        problems: [
          `Data: "Saldo finale" isn't a DD/MM/YYYY date.`,
          "Dare and Avere are both empty.",
        ],
      },
    ]);
    expect(rows.map((r) => r.line)).toEqual([5]);
  });

  it("reports an empty or unreadable amount", () => {
    const { errors } = readRows(
      table(
        ["Date", "Description", "Amount"],
        ["01/10/2026", "SALARY", ""],
        ["02/10/2026", "ESSELUNGA", "2,000.00"],
      ),
      mapping(["date", "description", "amount"]),
      "EUR",
    );
    expect(errors).toEqual([
      { line: 2, problems: ["Amount is empty."] },
      {
        line: 3,
        problems: [
          `Amount: "2,000.00" isn't an amount with a comma for decimals.`,
        ],
      },
    ]);
  });

  it("reads Excel dates and numbers", () => {
    const { rows } = readRows(
      table(
        ["Date", "Description", "Amount", "Reference"],
        [{ date: "2026-10-01" }, "SALARY", 2000, 88213],
      ),
      mapping(["date", "description", "amount", "reference"]),
      "EUR",
    );
    expect(rows).toEqual([
      {
        line: 2,
        date: "2026-10-01",
        time: null,
        amount: 200000,
        description: "SALARY",
        reference: "88213",
        balance: null,
      },
    ]);
  });
});

describe("readRow", () => {
  it("reads what an incomplete mapping has, without complaining about the rest", () => {
    const columns = ["Data", "Descrizione", "Importo"];
    expect(
      readRow(
        columns,
        ["01/10/2026", "SALARY", "2.000,00"],
        mapping(["date", "description", "ignore"]),
        "EUR",
      ),
    ).toEqual({
      date: "2026-10-01",
      time: null,
      amount: null,
      description: "SALARY",
      reference: null,
      balance: null,
      problems: [],
      leftOut: null,
    });
    expect(
      readRow(
        columns,
        ["2026-10-01", "SALARY", "2.000,00"],
        mapping(["date", "ignore", "amount"]),
        "EUR",
      ),
    ).toMatchObject({
      date: null,
      amount: 200000,
      problems: [`Data: "2026-10-01" isn't a DD/MM/YYYY date.`],
    });
  });
});

describe("leaving rows out", () => {
  const columns = [
    "Completed Date",
    "Description",
    "Amount",
    "Currency",
    "State",
  ];
  const revolut: Mapping = {
    roles: ["date", "description", "amount", "currency", "status"],
    dateFormat: "YYYY-MM-DD",
    decimalMark: "point",
  };

  it("leaves out rows in another currency, or not completed", () => {
    const result = readRows(
      table(
        columns,
        ["2026-06-12 21:02:16", "Top-up", "100.00", "EUR", "COMPLETED"],
        ["2026-06-13 08:00:00", "Hotel", "-80.00", "USD", "COMPLETED"],
        ["", "Pizza", "-16.00", "EUR", "PENDING"],
        ["2026-06-14 10:00:00", "Refund", "5.00", "EUR", "REVERTED"],
        ["2026-06-15 10:00:00", "Coffee", "-2.00", "€", "completed"],
      ),
      revolut,
      "EUR",
    );
    expect(result.rows.map((r) => [r.line, r.time])).toEqual([
      [2, "21:02:16"],
      [6, "10:00:00"],
    ]);
    // A pending payment has no date yet: it's left out, not unreadable.
    expect(result.errors).toEqual([]);
    expect(result.leftOut).toEqual([
      {
        line: 3,
        reason: "currency",
        value: "USD",
        date: "2026-06-13",
        amount: -8000,
        description: "Hotel",
      },
      {
        line: 4,
        reason: "status",
        value: "PENDING",
        date: null,
        amount: -1600,
        description: "Pizza",
      },
      {
        line: 5,
        reason: "status",
        value: "REVERTED",
        date: "2026-06-14",
        amount: 500,
        description: "Refund",
      },
    ]);
  });

  it("keeps rows with an empty currency or status", () => {
    const { rows } = readRows(
      table(columns, ["2026-06-12", "Top-up", "100.00", "", ""]),
      revolut,
      "EUR",
    );
    expect(rows).toHaveLength(1);
  });

  it("allows one currency and one status column", () => {
    expect(
      checkMapping(
        mapping(["date", "description", "amount", "currency", "currency"]),
      ),
    ).toEqual(["Only one column can be the Currency."]);
  });
});
