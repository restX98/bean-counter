import { describe, expect, it } from "vitest";
import {
  paybackTotals,
  validateSplit,
  type PaybackLink,
  type PaybackTarget,
} from "./paybacks.ts";

// The design's split bill: Marco pays back 174.00 € of the dinner and the
// pizzeria.
const dinner: PaybackTarget = { id: 1, currency: "EUR", amount: -30500 };
const pizzeria: PaybackTarget = { id: 2, currency: "EUR", amount: -4800 };
const marco: PaybackTarget = { id: 3, currency: "EUR", amount: 17400 };
const lucia: PaybackTarget = { id: 4, currency: "EUR", amount: 3000 };
const groceriesUS: PaybackTarget = { id: 5, currency: "USD", amount: -6400 };
const salary: PaybackTarget = { id: 6, currency: "EUR", amount: 200000 };
const expenses = new Map(
  [dinner, pizzeria, groceriesUS, salary].map((t) => [t.id, t]),
);
const link = (
  payment: PaybackTarget,
  expense: PaybackTarget,
  amount: number,
): PaybackLink => ({ paymentId: payment.id, expenseId: expense.id, amount });
const split = (
  payment: PaybackTarget,
  fields: [PaybackTarget, string][],
  links: PaybackLink[] = [],
) =>
  validateSplit(
    payment,
    fields.map(([expense, amount]) => ({ expenseId: expense.id, amount })),
    expenses,
    links,
  );

describe("paybackTotals", () => {
  it("adds up what each expense got back and what each payment paid", () => {
    const { paidBack, linked } = paybackTotals([
      link(marco, dinner, 15000),
      link(marco, pizzeria, 2400),
      link(lucia, pizzeria, 2400),
    ]);
    expect(paidBack).toEqual(
      new Map([
        [dinner.id, 15000],
        [pizzeria.id, 4800],
      ]),
    );
    expect(linked).toEqual(
      new Map([
        [marco.id, 17400],
        [lucia.id, 2400],
      ]),
    );
  });
});

describe("validateSplit", () => {
  it("splits the design's payment across two expenses", () => {
    expect(
      split(marco, [
        [dinner, "150.00"],
        [pizzeria, "24,00 €"],
      ]),
    ).toEqual({
      ok: true,
      value: [link(marco, dinner, 15000), link(marco, pizzeria, 2400)],
    });
  });

  it("can leave part of the payment unlinked", () => {
    expect(split(marco, [[dinner, "100"]])).toEqual({
      ok: true,
      value: [link(marco, dinner, 10000)],
    });
  });

  it("can't link more than the payment", () => {
    expect(
      split(marco, [
        [dinner, "150"],
        [pizzeria, "48"],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        expenses: "That's 198.00 € in all, more than the payment's 174.00 €.",
      },
    });
  });

  it("can't pay back more than is left on an expense", () => {
    const luciaPaid = [link(lucia, pizzeria, 3000)];
    expect(split(marco, [[pizzeria, "24"]], luciaPaid)).toEqual({
      ok: false,
      errors: { [pizzeria.id]: "Only 18.00 € of it is left to pay back." },
    });
    expect(split(marco, [[pizzeria, "18"]], luciaPaid).ok).toBe(true);
    expect(
      split(marco, [[pizzeria, "1"]], [link(lucia, pizzeria, 4800)]),
    ).toEqual({
      ok: false,
      errors: { [pizzeria.id]: "It's already paid back in full." },
    });
  });

  it("replaces the payment's own split", () => {
    expect(
      split(marco, [[dinner, "174"]], [link(marco, dinner, 15000)]),
    ).toEqual({ ok: true, value: [link(marco, dinner, 17400)] });
  });

  it("needs an amount above zero for each expense", () => {
    for (const typed of ["", "0", "-5", "lots"]) {
      const result = split(marco, [[dinner, typed]]);
      expect(result.ok).toBe(false);
      expect(result.ok || Object.keys(result.errors)).toEqual([
        String(dinner.id),
      ]);
    }
    expect(split(marco, [[dinner, ""]])).toEqual({
      ok: false,
      errors: { [dinner.id]: "Enter how much it pays back." },
    });
    expect(split(marco, [[dinner, "-5"]])).toEqual({
      ok: false,
      errors: { [dinner.id]: "Enter an amount above zero." },
    });
  });

  it("only pays back money going out in the payment's currency", () => {
    expect(
      split(marco, [
        [groceriesUS, "10"],
        [salary, "10"],
        [lucia, "10"],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        [groceriesUS.id]:
          "It's in USD: a payback and its expenses must be in the same currency.",
        [salary.id]: "Only money going out can be paid back.",
        [lucia.id]: "It can't be paid back any more. Pick another expense.",
      },
    });
  });

  it("takes each expense once", () => {
    expect(
      split(marco, [
        [dinner, "100"],
        [dinner, "50"],
      ]),
    ).toEqual({
      ok: false,
      errors: { [dinner.id]: "Each expense can be in the split once." },
    });
  });

  it("needs a payment coming in and at least one expense", () => {
    expect(split(marco, [])).toEqual({
      ok: false,
      errors: { expenses: "Pick the expenses it pays back." },
    });
    expect(split(pizzeria, [[dinner, "10"]])).toEqual({
      ok: false,
      errors: { expenses: "Only money coming in can pay back an expense." },
    });
  });
});
