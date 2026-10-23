import { describe, expect, it } from "vitest";
import {
  filterer,
  formatPeriod,
  readPeriod,
  transactionType,
  writePeriod,
  type Filtered,
  type Filters,
} from "./filters.ts";

describe("transactionType", () => {
  it("counts a transaction as the reports do", () => {
    const type = (more: Partial<Parameters<typeof transactionType>[0]>) =>
      transactionType({
        excluded: false,
        transfer: false,
        categoryType: null,
        ...more,
      });
    expect(type({ categoryType: "income" })).toBe("income");
    expect(type({ categoryType: "expense" })).toBe("expense");
    expect(type({})).toBe("uncategorized");
    expect(type({ transfer: true })).toBe("transfer");
  });

  it("puts a possible transfer with a category among transfers", () => {
    expect(
      transactionType({
        excluded: false,
        transfer: true,
        categoryType: "expense",
      }),
    ).toBe("transfer");
  });

  it("puts excluded ones apart, whatever their category", () => {
    expect(
      transactionType({
        excluded: true,
        transfer: false,
        categoryType: "expense",
      }),
    ).toBe("excluded");
  });
});

describe("periods", () => {
  it("reads one month or several, as the address writes them", () => {
    expect(readPeriod("2026-10")).toEqual({ from: "2026-10", to: "2026-10" });
    expect(readPeriod("2026-08..2026-10")).toEqual({
      from: "2026-08",
      to: "2026-10",
    });
    expect(writePeriod({ from: "2026-10", to: "2026-10" })).toBe("2026-10");
    expect(writePeriod({ from: "2025-11", to: "2026-01" })).toBe(
      "2025-11..2026-01",
    );
  });

  it("refuses anything else", () => {
    for (const text of [
      "",
      "2026-13",
      "2026-1",
      "10/2026",
      "2026-10..2026-08",
      "2026-08..2026-09..2026-10",
      "2026-08..",
    ]) {
      expect(readPeriod(text), text).toBe(null);
    }
  });

  it("names them", () => {
    expect(formatPeriod({ from: "2026-10", to: "2026-10" })).toBe(
      "October 2026",
    );
    expect(formatPeriod({ from: "2026-08", to: "2026-10" })).toBe(
      "Aug – Oct 2026 (3 months)",
    );
    expect(formatPeriod({ from: "2025-11", to: "2026-01" })).toBe(
      "Nov 2025 – Jan 2026 (3 months)",
    );
  });
});

describe("filterer", () => {
  const none: Filters = {
    accountId: null,
    period: null,
    categoryId: null,
    type: null,
    q: "",
  };
  const rows: Filtered[] = [
    {
      accountId: 1,
      date: "2026-10-02",
      description: "ESSELUNGA MILANO",
      categoryId: 10,
      type: "expense",
    },
    {
      accountId: 1,
      date: "2026-09-30",
      description: "NETFLIX.COM",
      categoryId: 11,
      type: "expense",
    },
    {
      accountId: 2,
      date: "2026-08-01",
      description: "INTEREST",
      categoryId: 12,
      type: "income",
    },
    {
      accountId: 2,
      date: "2026-10-06",
      description: "TRANSFER FROM CHECKING",
      categoryId: null,
      type: "transfer",
    },
  ];
  const found = (filters: Partial<Filters>) =>
    rows.filter(filterer({ ...none, ...filters })).map((t) => t.description);

  it("keeps everything with no filter", () => {
    expect(found({})).toHaveLength(4);
  });

  it("keeps one account, a period's months, a category or a type", () => {
    expect(found({ accountId: 2 })).toEqual([
      "INTEREST",
      "TRANSFER FROM CHECKING",
    ]);
    expect(found({ period: { from: "2026-09", to: "2026-10" } })).toEqual([
      "ESSELUNGA MILANO",
      "NETFLIX.COM",
      "TRANSFER FROM CHECKING",
    ]);
    expect(found({ categoryId: 11 })).toEqual(["NETFLIX.COM"]);
    expect(found({ type: "transfer" })).toEqual(["TRANSFER FROM CHECKING"]);
  });

  it("needs every filter to pass, the search too", () => {
    expect(
      found({
        accountId: 1,
        period: { from: "2026-10", to: "2026-10" },
        type: "expense",
      }),
    ).toEqual(["ESSELUNGA MILANO"]);
    expect(
      found({ period: { from: "2026-10", to: "2026-10" }, q: "netflix" }),
    ).toEqual([]);
    expect(found({ q: "netflix" })).toEqual(["NETFLIX.COM"]);
  });
});
