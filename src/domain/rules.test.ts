import { describe, expect, it } from "vitest";
import {
  contains,
  describeAmount,
  findOverlaps,
  matcher,
  ruleChecker,
  ruleEffect,
  suggestText,
  validateRule,
  type Rule,
  type RuleFields,
  type RuleTarget,
} from "./rules.ts";

const MAIN = 1;
const US = 2;
const accounts = new Map([
  [MAIN, "EUR"],
  [US, "USD"],
]);
const GROCERIES = 10;
const SHOPPING = 11;
const DIGITAL = 12;
const context = { accounts, categoryIds: new Set([GROCERIES, SHOPPING]) };

const fields = (more: Partial<RuleFields> = {}): RuleFields => ({
  match: "contains",
  text: "ESSELUNGA",
  accountId: null,
  min: "",
  max: "",
  currency: "EUR",
  categoryId: GROCERIES,
  ...more,
});

describe("validateRule", () => {
  it("accepts a description and a category, tidying the text", () => {
    expect(
      validateRule(fields({ text: "  satispay*bar   centrale " }), context),
    ).toEqual({
      ok: true,
      value: {
        match: "contains",
        text: "satispay*bar centrale",
        accountId: null,
        amount: null,
        categoryId: GROCERIES,
      },
    });
  });

  it("keeps a regular expression as typed, and refuses one that isn't valid", () => {
    expect(
      validateRule(
        fields({ match: "regex", text: " ^SALARY\\s+ACME " }),
        context,
      ),
    ).toMatchObject({ ok: true, value: { text: "^SALARY\\s+ACME" } });
    expect(
      validateRule(fields({ match: "regex", text: "AMAZON (" }), context),
    ).toEqual({
      ok: false,
      errors: { text: "That isn't a valid regular expression." },
    });
  });

  it("explains every missing or wrong field", () => {
    expect(
      validateRule(
        fields({ match: "starts", text: " ", accountId: 9, categoryId: null }),
        context,
      ),
    ).toEqual({
      ok: false,
      errors: {
        match: "Pick contains or regular expression.",
        text: "Enter the text to look for.",
        accountId: "Pick an account, or any account.",
        categoryId: "Pick a category.",
      },
    });
    expect(validateRule(fields({ categoryId: 99 }), context)).toMatchObject({
      errors: { categoryId: "Pick a category." },
    });
  });

  it("reads the amount bounds in the chosen currency", () => {
    expect(
      validateRule(fields({ min: "15", max: "1,000.50" }), context),
    ).toMatchObject({
      ok: true,
      value: { amount: { currency: "EUR", min: 1500, max: 100050 } },
    });
    expect(validateRule(fields({ max: "10.00" }), context)).toMatchObject({
      value: { amount: { currency: "EUR", min: null, max: 1000 } },
    });
  });

  it("uses the account's currency once an account is picked", () => {
    expect(
      validateRule(
        fields({ accountId: US, currency: "EUR", min: "5" }),
        context,
      ),
    ).toMatchObject({
      value: { accountId: US, amount: { currency: "USD", min: 500 } },
    });
  });

  it("refuses bounds that can't work", () => {
    expect(validateRule(fields({ min: "0" }), context)).toMatchObject({
      errors: { min: "Enter an amount above zero." },
    });
    expect(
      validateRule(fields({ min: "15.00", max: "15" }), context),
    ).toMatchObject({
      errors: { max: "Make it more than the lower amount." },
    });
    expect(validateRule(fields({ max: "ten" }), context)).toMatchObject({
      ok: false,
      errors: { max: expect.stringContaining("Write the amount like") },
    });
    expect(
      validateRule(fields({ currency: "", max: "10" }), context),
    ).toMatchObject({ errors: { currency: "Pick a currency." } });
  });
});

const tx = (
  description: string,
  amount: number,
  more: Partial<RuleTarget> = {},
): RuleTarget => ({
  description,
  amount,
  accountId: MAIN,
  currency: "EUR",
  ...more,
});
const rule = (id: number, more: Partial<Rule> = {}): Rule => ({
  id,
  match: "contains",
  text: "AMAZON",
  accountId: null,
  amount: null,
  categoryId: SHOPPING,
  ...more,
});

describe("contains", () => {
  it("finds the text ignoring case and repeated spaces", () => {
    const test = contains("  bar   centrale ");
    expect(test("SATISPAY*BAR CENTRALE MILANO")).toBe(true);
    expect(test("SATISPAY*BAR\tCENTRALE")).toBe(true);
    expect(test("SATISPAY*BARCENTRALE")).toBe(false);
  });

  it("matches every description when the text is empty", () => {
    expect(contains("")("SALARY ACME SPA")).toBe(true);
    expect(contains("   ")("SALARY ACME SPA")).toBe(true);
  });
});

describe("matcher", () => {
  it("finds the text ignoring case and repeated spaces", () => {
    const test = matcher(rule(1, { text: "satispay*bar centrale" }));
    expect(test(tx("SATISPAY*BAR   CENTRALE MILANO", -240))).toBe(true);
    expect(test(tx("SATISPAY*BAR ROMA", -240))).toBe(false);
  });

  it("tests a regular expression ignoring case", () => {
    const test = matcher(rule(1, { match: "regex", text: "^salary\\b" }));
    expect(test(tx("SALARY ACME SPA", 200000))).toBe(true);
    expect(test(tx("BONUS SALARY", 50000))).toBe(false);
  });

  it("keeps to its account", () => {
    const test = matcher(rule(1, { accountId: US }));
    expect(test(tx("AMAZON", -999))).toBe(false);
    expect(test(tx("AMAZON", -999, { accountId: US, currency: "USD" }))).toBe(
      true,
    );
  });

  it("bounds the size of the amount, in or out, in one currency", () => {
    const under10 = matcher(
      rule(1, { amount: { currency: "EUR", min: null, max: 1000 } }),
    );
    expect(under10(tx("AMAZON", -240))).toBe(true);
    expect(under10(tx("AMAZON", 240))).toBe(true);
    expect(under10(tx("AMAZON", -1000))).toBe(false);
    expect(under10(tx("AMAZON", -240, { currency: "USD" }))).toBe(false);

    const from15 = matcher(
      rule(1, { amount: { currency: "EUR", min: 1500, max: null } }),
    );
    expect(from15(tx("AMAZON", -1500))).toBe(true);
    expect(from15(tx("AMAZON", -1499))).toBe(false);
  });
});

describe("ruleChecker", () => {
  it("says nothing when no rule matches", () => {
    expect(ruleChecker([rule(1)])(tx("ESSELUNGA", -5630))).toEqual({
      kind: "none",
    });
  });

  it("gives the category when the rules that match agree", () => {
    const check = ruleChecker([
      rule(5, { text: "PRIME" }),
      rule(3),
      rule(4, { text: "ESSELUNGA", categoryId: GROCERIES }),
    ]);
    expect(check(tx("AMAZON PRIME", -499))).toEqual({
      kind: "category",
      categoryId: SHOPPING,
      ruleId: 3,
    });
  });

  it("picks nothing when they disagree", () => {
    const shopping = rule(1);
    const digital = rule(2, {
      categoryId: DIGITAL,
      amount: { currency: "EUR", min: null, max: 1500 },
    });
    const check = ruleChecker([shopping, digital]);
    expect(check(tx("AMAZON DIGITAL", -999))).toEqual({
      kind: "conflict",
      rules: [shopping, digital],
    });
    expect(check(tx("AMAZON EU SARL", -3490))).toMatchObject({
      kind: "category",
      categoryId: SHOPPING,
    });
  });
});

describe("findOverlaps", () => {
  const currency = (id: number) => accounts.get(id);

  it("finds rules whose descriptions meet", () => {
    const amazon = rule(1);
    const prime = rule(2, { text: "amazon prime", categoryId: DIGITAL });
    const esselunga = rule(3, { text: "ESSELUNGA", categoryId: GROCERIES });
    expect(findOverlaps([amazon, prime, esselunga], [], currency)).toEqual(
      new Map([
        [1, [2]],
        [2, [1]],
      ]),
    );
  });

  it("ignores rules that agree on the category", () => {
    expect(findOverlaps([rule(1), rule(2)], [], currency).size).toBe(0);
  });

  it("ignores rules whose amounts, accounts or currencies can't meet", () => {
    const under15 = { currency: "EUR", min: null, max: 1500 };
    const from15 = { currency: "EUR", min: 1500, max: null };
    const digital = { categoryId: DIGITAL };
    for (const [a, b] of [
      [rule(1, { amount: from15 }), rule(2, { ...digital, amount: under15 })],
      [rule(1, { accountId: MAIN }), rule(2, { ...digital, accountId: US })],
      [rule(1, { accountId: US }), rule(2, { ...digital, amount: under15 })],
    ] as const) {
      expect(findOverlaps([a, b], [], currency).size).toBe(0);
    }
    expect(
      findOverlaps(
        [
          rule(1, { amount: under15 }),
          rule(2, { ...digital, amount: under15 }),
        ],
        [],
        currency,
      ).size,
    ).toBe(2);
  });

  it("finds regular expressions that meet through a transaction", () => {
    const a = rule(1, { match: "regex", text: "^AMAZON" });
    const b = rule(2, { match: "regex", text: "PRIME$", categoryId: DIGITAL });
    expect(findOverlaps([a, b], [], currency).size).toBe(0);
    expect(findOverlaps([a, b], [tx("AMAZON PRIME", -499)], currency)).toEqual(
      new Map([
        [1, [2]],
        [2, [1]],
      ]),
    );
  });
});

describe("describeAmount", () => {
  it("says each bound that's set", () => {
    const range = (min: number | null, max: number | null) =>
      describeAmount({ currency: "EUR", min, max });
    expect(range(null, 1000)).toBe("under 10.00 €");
    expect(range(1500, null)).toBe("15.00 € or more");
    expect(range(1000, 1500)).toBe("10.00 € or more, under 15.00 €");
  });
});

describe("ruleEffect", () => {
  const under15 = { currency: "EUR", min: null, max: 1500 };
  const digital = rule(2, { categoryId: DIGITAL, amount: under15 });
  const ids = (list: { id: number }[]) => list.map((c) => c.id);
  const uncategorized = [
    { ...tx("AMAZON EU SARL", -3490), id: 101 },
    { ...tx("AMAZON DIGITAL", -999), id: 102 },
    { ...tx("ESSELUNGA MILANO", -5630), id: 103 },
  ];

  it("gives a new rule's category to the transactions it alone decides", () => {
    expect(ruleEffect([digital], rule(3), uncategorized)).toEqual({
      matching: [{ id: 101, categoryId: SHOPPING, ruleId: 3 }],
      conflicts: 1,
      settled: [],
    });
  });

  it("credits the oldest rule when the ones that match agree", () => {
    const old = rule(1, { categoryId: DIGITAL });
    expect(ruleEffect([old], digital, uncategorized).matching).toEqual([
      { id: 102, categoryId: DIGITAL, ruleId: 1 },
    ]);
  });

  it("settles the conflicts an edit takes the rule out of", () => {
    const amazon = rule(1);
    const from15 = rule(1, {
      amount: { currency: "EUR", min: 1500, max: null },
    });
    const effect = ruleEffect([amazon, digital], from15, uncategorized);
    expect(ids(effect.matching)).toEqual([101]);
    expect(effect.conflicts).toBe(0);
    expect(effect.settled).toEqual([
      { id: 102, categoryId: DIGITAL, ruleId: 2 },
    ]);
  });

  it("leaves alone what the old version matched without a conflict", () => {
    const amazon = rule(1);
    const esselunga = rule(1, { text: "ESSELUNGA", categoryId: GROCERIES });
    expect(ruleEffect([amazon], esselunga, uncategorized)).toEqual({
      matching: [{ id: 103, categoryId: GROCERIES, ruleId: 1 }],
      conflicts: 0,
      settled: [],
    });
  });
});

describe("suggestText", () => {
  it("keeps the longest run of words without digits", () => {
    expect(suggestText("PHARMACY 24")).toBe("PHARMACY");
    expect(suggestText("SALARY  ACME SPA ")).toBe("SALARY ACME SPA");
    expect(suggestText("CARD 1234 AMAZON MKTP EU 5678")).toBe("AMAZON MKTP EU");
  });

  it("takes the last of two runs as long, and all of it when every word has digits", () => {
    expect(suggestText("PAGAMENTO POS 12/10 ESSELUNGA MILANO")).toBe(
      "ESSELUNGA MILANO",
    );
    expect(suggestText("12/10 1234")).toBe("12/10 1234");
  });
});
