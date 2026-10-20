import { describe, expect, it } from "vitest";
import { parseStatementAmount, parseStatementDate } from "./values.ts";

describe("parseStatementDate", () => {
  /** Just the date, for the tests about dates. */
  const day = (
    text: string,
    format: Parameters<typeof parseStatementDate>[1],
  ) => parseStatementDate(text, format)?.date;

  it("reads day/month/year with any of / . -", () => {
    expect(day("01/10/2026", "DD/MM/YYYY")).toBe("2026-10-01");
    expect(day("1.10.2026", "DD/MM/YYYY")).toBe("2026-10-01");
    expect(day("31-12-2026", "DD/MM/YYYY")).toBe("2026-12-31");
  });

  it("reads month/day/year and year-month-day", () => {
    expect(day("10/31/2026", "MM/DD/YYYY")).toBe("2026-10-31");
    expect(day("2026-10-01", "YYYY-MM-DD")).toBe("2026-10-01");
    expect(day("2026/10/1", "YYYY-MM-DD")).toBe("2026-10-01");
  });

  it("puts a two-digit year in the 2000s", () => {
    expect(day("01/10/26", "DD/MM/YYYY")).toBe("2026-10-01");
    expect(day("10/01/26", "MM/DD/YYYY")).toBe("2026-10-01");
  });

  it("keeps the time after the date, with seconds", () => {
    expect(parseStatementDate("01/10/2026", "DD/MM/YYYY")).toEqual({
      date: "2026-10-01",
      time: null,
    });
    expect(parseStatementDate("01/10/2026 14:32", "DD/MM/YYYY")).toEqual({
      date: "2026-10-01",
      time: "14:32:00",
    });
    expect(
      parseStatementDate("2026-10-01T09:05:07.123Z", "YYYY-MM-DD"),
    ).toEqual({ date: "2026-10-01", time: "09:05:07" });
    expect(parseStatementDate("2026-06-12 21:02:16", "YYYY-MM-DD")).toEqual({
      date: "2026-06-12",
      time: "21:02:16",
    });
  });

  it("reads 12-hour times", () => {
    expect(parseStatementDate("10/01/2026 2:32 PM", "MM/DD/YYYY")?.time).toBe(
      "14:32:00",
    );
    expect(parseStatementDate("10/01/2026 12:05 am", "MM/DD/YYYY")?.time).toBe(
      "00:05:00",
    );
    expect(parseStatementDate("10/01/2026 12:05 PM", "MM/DD/YYYY")?.time).toBe(
      "12:05:00",
    );
  });

  it("refuses dates and times that don't exist or don't fit the format", () => {
    expect(day("31/02/2026", "DD/MM/YYYY")).toBeUndefined();
    expect(day("13/31/2026", "MM/DD/YYYY")).toBeUndefined();
    expect(day("2026-10-01", "DD/MM/YYYY")).toBeUndefined();
    expect(day("01/10-2026", "DD/MM/YYYY")).toBeUndefined();
    expect(day("26-10-01", "YYYY-MM-DD")).toBeUndefined();
    expect(day("01/10/2026 foo", "DD/MM/YYYY")).toBeUndefined();
    expect(day("01/10/2026 25:00", "DD/MM/YYYY")).toBeUndefined();
    expect(day("01/10/2026 13:00 PM", "DD/MM/YYYY")).toBeUndefined();
    expect(day("SALARY", "DD/MM/YYYY")).toBeUndefined();
  });

  it("takes Excel dates as they are, but not plain numbers", () => {
    expect(parseStatementDate({ date: "2026-10-01" }, "MM/DD/YYYY")).toEqual({
      date: "2026-10-01",
      time: null,
    });
    expect(
      parseStatementDate(
        { date: "2026-10-01", time: "14:32:05" },
        "DD/MM/YYYY",
      ),
    ).toEqual({ date: "2026-10-01", time: "14:32:05" });
    expect(parseStatementDate(46296, "DD/MM/YYYY")).toBeUndefined();
  });
});

describe("parseStatementAmount", () => {
  const comma = (text: string | number) =>
    parseStatementAmount(text, "comma", "EUR");
  const point = (text: string | number) =>
    parseStatementAmount(text, "point", "EUR");

  it("reads amounts with a comma for decimals", () => {
    expect(comma("2.000,00")).toEqual({ ok: true, minor: 200000 });
    expect(comma("-56,30")).toEqual({ ok: true, minor: -5630 });
    expect(comma("1234,5")).toEqual({ ok: true, minor: 123450 });
    expect(comma("+12")).toEqual({ ok: true, minor: 1200 });
    expect(comma("1.234.567,89")).toEqual({ ok: true, minor: 123456789 });
  });

  it("reads amounts with a point for decimals", () => {
    expect(point("2,000.00")).toEqual({ ok: true, minor: 200000 });
    expect(point("-56.30")).toEqual({ ok: true, minor: -5630 });
    expect(point("−18.50")).toEqual({ ok: true, minor: -1850 });
  });

  it("accepts spaces and apostrophes between thousands", () => {
    expect(comma("1 234,56")).toEqual({ ok: true, minor: 123456 });
    expect(comma("1\u00a0234,56")).toEqual({ ok: true, minor: 123456 });
    expect(point("1'234.56")).toEqual({ ok: true, minor: 123456 });
  });

  it("reads a minus at the end, and the currency at either end", () => {
    expect(comma("56,30-")).toEqual({ ok: true, minor: -5630 });
    expect(comma("€ 1.234,56")).toEqual({ ok: true, minor: 123456 });
    expect(comma("-12,00 EUR")).toEqual({ ok: true, minor: -1200 });
    expect(comma("€ -18,50")).toEqual({ ok: true, minor: -1850 });
  });

  it("refuses amounts written with the other decimal mark", () => {
    // Groups of thousands have three digits, so these can't be misread.
    expect(point("-56,30")).toEqual({
      ok: false,
      error: `"-56,30" isn't an amount with a point for decimals.`,
    });
    expect(comma("2,000.00")).toEqual({
      ok: false,
      error: `"2,000.00" isn't an amount with a comma for decimals.`,
    });
    expect(comma("56.30").ok).toBe(false);
  });

  it("allows extra decimals only when they're zeros", () => {
    expect(comma("12,3400")).toEqual({ ok: true, minor: 1234 });
    expect(comma("12,345")).toEqual({
      ok: false,
      error: `"12,345" has more than 2 decimals.`,
    });
    expect(parseStatementAmount("1.500", "comma", "JPY")).toEqual({
      ok: true,
      minor: 1500,
    });
    expect(parseStatementAmount("1500,50", "comma", "JPY")).toEqual({
      ok: false,
      error: `"1500,50" has decimals, and JPY amounts have none.`,
    });
  });

  it("never returns minus zero", () => {
    expect(comma("-0,00")).toEqual({ ok: true, minor: 0 });
    expect(Object.is((comma("-0,00") as { minor: number }).minor, 0)).toBe(
      true,
    );
  });

  it("refuses text and amounts too large to be exact", () => {
    expect(comma("SALARY").ok).toBe(false);
    expect(comma("").ok).toBe(false);
    expect(comma("99999999999999999,00")).toEqual({
      ok: false,
      error: `"99999999999999999,00" is too large.`,
    });
  });

  it("reads Excel numbers whatever the decimal mark", () => {
    expect(comma(2000)).toEqual({ ok: true, minor: 200000 });
    expect(comma(-56.3)).toEqual({ ok: true, minor: -5630 });
    expect(comma(0.1 + 0.2)).toEqual({ ok: true, minor: 30 });
    expect(comma(12.345).ok).toBe(false);
  });

  it("refuses an Excel date", () => {
    expect(
      parseStatementAmount({ date: "2026-10-01" }, "comma", "EUR"),
    ).toEqual({ ok: false, error: "01/10/2026 is a date, not an amount." });
  });
});
