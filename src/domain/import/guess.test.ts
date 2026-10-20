import { describe, expect, it } from "vitest";
import { guessMapping, toMapping } from "./guess.ts";

describe("guessMapping", () => {
  it("maps an export with a fee and two dates", () => {
    const draft = guessMapping(
      [
        "Type",
        "Product",
        "Started Date",
        "Completed Date",
        "Description",
        "Amount",
        "Fee",
        "Currency",
        "State",
        "Balance",
      ],
      [
        [
          "Topup",
          "Current",
          "2026-06-12 21:02:14",
          "2026-06-12 21:02:16",
          "Top-up",
          "100.00",
          "0.00",
          "EUR",
          "COMPLETED",
          "100.00",
        ],
      ],
      "EUR",
    );
    expect(draft).toEqual({
      roles: [
        "ignore",
        "ignore",
        "ignore",
        "date",
        "description",
        "amount",
        "fee",
        "ignore",
        "ignore",
        "balance",
      ],
      dateFormat: "YYYY-MM-DD",
      decimalMark: "point",
    });
  });

  it("maps debit and credit columns and several descriptions", () => {
    const draft = guessMapping(
      [
        "Posted Account",
        "Posted Transactions Date",
        "Description1",
        "Description2",
        "Description3",
        "Debit Amount",
        "Credit Amount",
        "Balance",
        "Posted Currency",
        "Transaction Type",
        "Local Currency Amount",
        "Local Currency",
      ],
      [
        [
          "1 - 2",
          "28/08/2025",
          "SALARY",
          "",
          "",
          "",
          "6,304.57",
          "6304.57",
          "EUR",
          "Credit",
          "6,304.57",
          "EUR",
        ],
        [
          "1 - 2",
          "29/08/2025",
          "TESCO",
          "",
          "",
          "57.00",
          "",
          "6247.57",
          "EUR",
          "Debit",
          "57.00",
          "EUR",
        ],
      ],
      "EUR",
    );
    expect(draft).toEqual({
      roles: [
        "ignore",
        "date",
        "description",
        "description",
        "description",
        "debit",
        "credit",
        "balance",
        "ignore",
        "ignore",
        "ignore",
        "ignore",
      ],
      dateFormat: "DD/MM/YYYY",
      decimalMark: "point",
    });
  });

  it("maps Italian column names, with the value date second", () => {
    const draft = guessMapping(
      ["Data contabile", "Data valuta", "Descrizione", "Importo", "Saldo"],
      [["01/10/2026", "01/10/2026", "SALARY", "2.000,00", "3.240,50"]],
      "EUR",
    );
    expect(draft).toEqual({
      roles: ["date", "ignore", "description", "amount", "balance"],
      dateFormat: "DD/MM/YYYY",
      decimalMark: "comma",
    });
  });

  it("leaves unknown columns to pick while something is missing", () => {
    expect(
      guessMapping(
        ["Booking date", "Value date", "Text", "Sum"],
        [["01/10/2026", "01/10/2026", "SALARY", "2000.00"]],
        "EUR",
      ).roles,
    ).toEqual(["date", "ignore", null, null]);
    expect(guessMapping(["Column 1", "Column 2"], [["a", "b"]], "EUR")).toEqual(
      {
        roles: [null, null],
        dateFormat: "DD/MM/YYYY",
        decimalMark: "point",
      },
    );
  });

  it("tells month-first dates from day-first ones", () => {
    const draft = guessMapping(
      ["Date", "Description", "Amount"],
      [
        ["10/01/2026", "SALARY", "2000.00"],
        ["10/31/2026", "RENT", "-700.00"],
      ],
      "EUR",
    );
    expect(draft.dateFormat).toBe("MM/DD/YYYY");
  });

  it("reads 2,000 as thousands when nothing else decides", () => {
    const amounts = (...values: string[]) =>
      guessMapping(
        ["Date", "Description", "Amount"],
        values.map((amount) => ["01/10/2026", "X", amount]),
        "EUR",
      ).decimalMark;
    expect(amounts("2,000", "500")).toBe("point");
    expect(amounts("2000", "500")).toBe("point");
    expect(amounts("12,5", "500")).toBe("comma");
  });
});

describe("toMapping", () => {
  it("ignores the columns not picked yet", () => {
    expect(
      toMapping({
        roles: ["date", null, "amount"],
        dateFormat: "DD/MM/YYYY",
        decimalMark: "comma",
      }).roles,
    ).toEqual(["date", "ignore", "amount"]);
  });
});
