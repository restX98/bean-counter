import { describe, expect, it } from "vitest";
import {
  groupByCurrency,
  validateAccount,
  validateAnchor,
  type Account,
} from "./accounts.ts";

const fields = {
  name: "Main checking",
  bank: "Bank A",
  type: "checking",
  currency: "EUR",
};

describe("validateAccount", () => {
  it("accepts a complete form and tidies the spaces", () => {
    expect(
      validateAccount(
        { ...fields, name: "  Main   checking ", bank: " Bank A" },
        [],
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Main checking",
        bank: "Bank A",
        type: "checking",
        currency: "EUR",
      },
    });
  });

  it("explains every missing or wrong field", () => {
    expect(
      validateAccount(
        { name: " ", bank: "", type: "credit", currency: "" },
        [],
      ),
    ).toEqual({
      ok: false,
      errors: {
        name: "Give the account a name.",
        bank: "Enter the bank's name.",
        type: "Pick checking or savings.",
        currency: "Pick a currency.",
      },
    });
    expect(validateAccount({ ...fields, currency: "XYZ" }, [])).toMatchObject({
      ok: false,
      errors: { currency: "Pick a currency." },
    });
  });

  it("refuses a name another account already has, ignoring case", () => {
    expect(
      validateAccount({ ...fields, name: "main CHECKING" }, ["Main checking"]),
    ).toEqual({
      ok: false,
      errors: { name: "You already have an account called main CHECKING." },
    });
  });

  it("limits the length of names", () => {
    const long = "x".repeat(61);
    expect(validateAccount({ ...fields, name: long, bank: long }, [])).toEqual({
      ok: false,
      errors: {
        name: "Keep it under 60 characters.",
        bank: "Keep it under 60 characters.",
      },
    });
  });
});

describe("validateAnchor", () => {
  const today = "2026-10-19";

  it("turns the typed balance into minor units", () => {
    expect(
      validateAnchor({ amount: "3,240.50", date: "2026-10-16" }, "EUR", today),
    ).toEqual({ ok: true, value: { amount: 324050, date: "2026-10-16" } });
    expect(
      validateAnchor({ amount: "-12", date: today }, "EUR", today),
    ).toEqual({ ok: true, value: { amount: -1200, date: today } });
  });

  it("explains a missing or wrong amount and date", () => {
    expect(validateAnchor({ amount: "", date: "" }, "EUR", today)).toEqual({
      ok: false,
      errors: {
        anchorAmount: "Enter the balance.",
        anchorDate: "Enter a valid date.",
      },
    });
    expect(
      validateAnchor({ amount: "10.5", date: today }, "JPY", today),
    ).toEqual({
      ok: false,
      errors: { anchorAmount: "JPY amounts have no decimals." },
    });
  });

  it("refuses a date in the future", () => {
    expect(
      validateAnchor({ amount: "10", date: "2026-10-20" }, "EUR", today),
    ).toEqual({
      ok: false,
      errors: { anchorDate: "The date can't be in the future." },
    });
  });
});

describe("groupByCurrency", () => {
  let nextId = 1;
  const account = (
    currency: string,
    balance: number | null,
    archivedOn: string | null = null,
  ): Account => ({
    id: nextId++,
    name: `Account ${nextId}`,
    bank: "Bank A",
    type: "checking",
    currency,
    anchor: null,
    archivedOn,
    balance: balance === null ? null : { amount: balance, date: "2026-10-16" },
    transactionCount: 0,
  });

  it("puts EUR first, then other currencies by code, never mixing them", () => {
    const groups = groupByCurrency([
      account("USD", 112000),
      account("CHF", 5000),
      account("EUR", 324050),
      account("EUR", 1250500),
    ]);
    expect(groups.map((g) => [g.currency, g.total])).toEqual([
      ["EUR", 1574550],
      ["CHF", 5000],
      ["USD", 112000],
    ]);
  });

  it("leaves archived accounts out", () => {
    const groups = groupByCurrency([
      account("EUR", 1000),
      account("EUR", 99999, "2026-03-15"),
      account("GBP", 500, "2026-03-15"),
    ]);
    expect(groups.map((g) => [g.currency, g.accounts.length, g.total])).toEqual(
      [["EUR", 1, 1000]],
    );
  });

  it("has no total while an account has no balance yet", () => {
    const [eur] = groupByCurrency([account("EUR", 1000), account("EUR", null)]);
    expect(eur?.total).toBeNull();
  });
});
