import { describe, expect, it } from "vitest";
import { reviewGroups, shownEnd, type ReviewTarget } from "./review.ts";
import type { Rule } from "./rules.ts";

const SHOPPING = 10;
const DIGITAL = 11;

const tx = (
  id: number,
  date: string,
  description: string,
  amount: number,
  time: string | null = null,
): ReviewTarget => ({
  id,
  date,
  time,
  description,
  amount,
  accountId: 1,
  currency: "EUR",
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

describe("reviewGroups", () => {
  const pharmacy = tx(1, "2026-10-15", "PHARMACY 24", -1850);
  const digital = tx(2, "2026-10-13", "AMAZON DIGITAL", -999);
  const deposit = tx(3, "2026-10-12", "DEPOSIT", 50000);
  const prime = tx(4, "2026-09-28", "AMAZON PRIME", -499);
  const all = [prime, deposit, pharmacy, digital];

  it("lists them newest first, with nothing to suggest without rules", () => {
    expect(reviewGroups(all, [])).toEqual({
      uncategorized: [pharmacy, digital, deposit, prime].map((t) => ({
        ...t,
        suggestion: null,
      })),
      conflicts: [],
    });
  });

  it("puts the ones the rules disagree on apart, with their categories", () => {
    const under15 = rule(2, {
      categoryId: DIGITAL,
      amount: { currency: "EUR", min: null, max: 1500 },
    });
    const { uncategorized, conflicts } = reviewGroups(all, [rule(1), under15]);
    expect(conflicts).toEqual([
      { ...digital, ruleIds: [1, 2], categoryIds: [SHOPPING, DIGITAL] },
      { ...prime, ruleIds: [1, 2], categoryIds: [SHOPPING, DIGITAL] },
    ]);
    expect(uncategorized.map((t) => t.id)).toEqual([1, 3]);
  });

  it("suggests the category the rules agree on", () => {
    const { uncategorized } = reviewGroups([digital, deposit], [rule(1)]);
    expect(uncategorized).toEqual([
      { ...digital, suggestion: { categoryId: SHOPPING, ruleId: 1 } },
      { ...deposit, suggestion: null },
    ]);
  });

  it("orders a day's transactions by time, then as imported", () => {
    const early = tx(5, "2026-10-15", "COFFEE", -120, "08:10:00");
    const late = tx(6, "2026-10-15", "COFFEE", -120, "16:40:00");
    const ids = reviewGroups([early, pharmacy, late], []).uncategorized.map(
      (t) => t.id,
    );
    expect(ids).toEqual([6, 5, 1]);
  });
});

describe("shownEnd", () => {
  const gap = (after: [number, number], until: [number, number]) => ({
    after: "2026-10-05",
    until: "2026-10-10",
    balances: {
      after: { app: after[0], bank: after[1] },
      until: { app: until[0], bank: until[1] },
    },
  });

  it("shows the day they differ, after the anchor or before it", () => {
    expect(shownEnd(gap([1250500, 1250500], [1250500, 1251500]))).toEqual({
      date: "2026-10-10",
      app: 1250500,
      bank: 1251500,
    });
    expect(shownEnd(gap([1250500, 1251500], [1250500, 1250500]))).toEqual({
      date: "2026-10-05",
      app: 1250500,
      bank: 1251500,
    });
  });

  it("shows where they differ more when an account has two gaps", () => {
    // 10.00 apart up to the 5th, then 15.00: another 5.00 is missing.
    expect(shownEnd(gap([1000, 2000], [1000, 2500])).date).toBe("2026-10-10");
    // 10.00 apart up to the 5th, then 3.00: a 7.00 one counted twice.
    expect(shownEnd(gap([1000, 2000], [1000, 1300])).date).toBe("2026-10-05");
  });

  it("shows the later day when the anchor disagrees with the bank that day", () => {
    expect(
      shownEnd({
        after: "2026-10-05",
        until: "2026-10-05",
        balances: {
          after: { app: 268000, bank: 268000 },
          until: { app: 268000, bank: 268420 },
        },
      }),
    ).toEqual({ date: "2026-10-05", app: 268000, bank: 268420 });
  });
});
