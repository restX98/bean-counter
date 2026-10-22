import { describe, expect, it } from "vitest";
import {
  currencies,
  currencySymbol,
  findCurrency,
  formatAmount,
  formatSize,
  parseAmount,
  rescale,
} from "./money.ts";

describe("currencies", () => {
  it("puts EUR first, then the rest by code", () => {
    const codes = currencies().map((c) => c.code);
    expect(codes[0]).toBe("EUR");
    expect(codes.slice(1)).toEqual([...codes.slice(1)].sort());
    expect(codes).toContain("USD");
  });

  it("knows each currency's decimals and name", () => {
    expect(findCurrency("EUR")).toEqual({
      code: "EUR",
      name: "Euro",
      digits: 2,
    });
    expect(findCurrency("JPY")?.digits).toBe(0);
    expect(findCurrency("KWD")?.digits).toBe(3);
    expect(findCurrency("XYZ")).toBeUndefined();
  });

  it("uses the short symbol, or the code when there's none", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CHF")).toBe("CHF");
  });
});

describe("formatAmount", () => {
  it("writes minor units with grouping, decimals and the symbol after", () => {
    expect(formatAmount(324050, "EUR")).toBe("3,240.50 €");
    expect(formatAmount(5, "EUR")).toBe("0.05 €");
    expect(formatAmount(0, "EUR")).toBe("0.00 €");
    expect(formatAmount(112000, "USD")).toBe("1,120.00 $");
    expect(formatAmount(1500, "JPY")).toBe("1,500 ¥");
    expect(formatAmount(1234567, "KWD")).toBe("1,234.567 KWD");
  });

  it("uses a real minus sign, and a plus only when asked", () => {
    expect(formatAmount(-1850, "EUR")).toBe("−18.50 €");
    expect(formatAmount(200000, "EUR")).toBe("2,000.00 €");
    expect(formatAmount(200000, "EUR", { signed: true })).toBe("+2,000.00 €");
    expect(formatAmount(0, "EUR", { signed: true })).toBe("0.00 €");
  });

  it("stays exact for large amounts", () => {
    expect(formatAmount(Number.MAX_SAFE_INTEGER, "EUR")).toBe(
      "90,071,992,547,409.91 €",
    );
  });
});

describe("formatSize", () => {
  it("writes the size alone, which parseAmount reads back", () => {
    expect(formatSize(-324050, "EUR")).toBe("3,240.50");
    expect(formatSize(1500, "JPY")).toBe("1,500");
    expect(parseAmount(formatSize(1234567, "KWD"), "KWD")).toEqual({
      ok: true,
      minor: 1234567,
    });
  });
});

describe("parseAmount", () => {
  const eur = (text: string) => parseAmount(text, "EUR");

  it("reads amounts written the way the app shows them", () => {
    expect(eur("3,240.50")).toEqual({ ok: true, minor: 324050 });
    expect(eur("3240.50")).toEqual({ ok: true, minor: 324050 });
    expect(eur("3240.5")).toEqual({ ok: true, minor: 324050 });
    expect(eur("3240")).toEqual({ ok: true, minor: 324000 });
    expect(eur(" 1,234,567.89 ")).toEqual({ ok: true, minor: 123456789 });
    expect(eur("0.05")).toEqual({ ok: true, minor: 5 });
  });

  it("accepts a sign, including the real minus sign", () => {
    expect(eur("-18.50")).toEqual({ ok: true, minor: -1850 });
    expect(eur("−18.50")).toEqual({ ok: true, minor: -1850 });
    expect(eur("+18.50")).toEqual({ ok: true, minor: 1850 });
  });

  it("reads a lone comma before one or two digits as decimals", () => {
    expect(eur("3240,50")).toEqual({ ok: true, minor: 324050 });
    expect(eur("3240,5")).toEqual({ ok: true, minor: 324050 });
    expect(eur("-0,99")).toEqual({ ok: true, minor: -99 });
    // Three digits after a comma are thousands, as in 1,234.
    expect(eur("1,234")).toEqual({ ok: true, minor: 123400 });
  });

  it("accepts the account's currency symbol or code at either end", () => {
    expect(eur("3,240.50 €")).toEqual({ ok: true, minor: 324050 });
    expect(eur("€3,240.50")).toEqual({ ok: true, minor: 324050 });
    expect(eur("eur 12")).toEqual({ ok: true, minor: 1200 });
    expect(eur("-€ 18.50")).toEqual({ ok: true, minor: -1850 });
    expect(eur("€ -18.50")).toEqual({ ok: true, minor: -1850 });
    expect(parseAmount("$1,120", "USD")).toEqual({ ok: true, minor: 112000 });
    expect(eur("$12").ok).toBe(false);
  });

  it("never goes through floats", () => {
    // 0.1 + 0.2 style rounding errors would show up here.
    expect(eur("0.30")).toEqual({ ok: true, minor: 30 });
    expect(eur("1,000,000.01")).toEqual({ ok: true, minor: 100000001 });
  });

  it("rejects other ways of writing amounts", () => {
    for (const text of [
      "",
      "abc",
      "€",
      "3.240,50",
      "1,234,50",
      "32,40.50",
      "1,2345",
      "1e3",
      "--5",
      "- -5",
      "5-",
    ]) {
      expect(eur(text).ok, text).toBe(false);
    }
  });

  it("respects the currency's decimals", () => {
    expect(eur("1.234")).toEqual({
      ok: false,
      error: "EUR amounts have at most 2 decimals.",
    });
    expect(parseAmount("1500", "JPY")).toEqual({ ok: true, minor: 1500 });
    expect(parseAmount("1500.5", "JPY")).toEqual({
      ok: false,
      error: "JPY amounts have no decimals.",
    });
    expect(parseAmount("1.234", "KWD")).toEqual({ ok: true, minor: 1234 });
  });

  it("rejects amounts too large to be exact", () => {
    expect(eur("99,999,999,999,999,999")).toEqual({
      ok: false,
      error: "That amount is too large.",
    });
  });
});

describe("rescale", () => {
  it("keeps the written amount between currencies", () => {
    expect(rescale(112050, "EUR", "USD")).toBe(112050);
    expect(rescale(112050, "EUR", "KWD")).toBe(1120500);
    expect(rescale(112000, "EUR", "JPY")).toBe(1120);
  });

  it("refuses when the decimals would be lost", () => {
    expect(rescale(112050, "EUR", "JPY")).toBeUndefined();
  });

  it("refuses when more decimals would make it too large to be exact", () => {
    expect(rescale(Number.MAX_SAFE_INTEGER, "EUR", "KWD")).toBeUndefined();
    expect(rescale(-Number.MAX_SAFE_INTEGER, "EUR", "KWD")).toBeUndefined();
    expect(rescale(900719925474099, "EUR", "KWD")).toBe(9007199254740990);
  });
});
