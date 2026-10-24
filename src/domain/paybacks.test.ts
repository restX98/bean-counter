import { describe, expect, it } from "vitest";
import {
  linkedInFull,
  paybackOptions,
  paybackTotals,
  prefill,
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
/** Gone since D9 listed it. */
const gone: PaybackTarget = { id: 7, currency: "EUR", amount: -1000 };
const others = new Map(
  [dinner, pizzeria, marco, lucia, groceriesUS, salary].map((t) => [t.id, t]),
);
const link = (
  payment: PaybackTarget,
  expense: PaybackTarget,
  amount: number,
): PaybackLink => ({ paymentId: payment.id, expenseId: expense.id, amount });
/** The split of a payment, or of an expense. */
const split = (
  row: PaybackTarget,
  fields: [PaybackTarget, string][],
  links: PaybackLink[] = [],
) =>
  validateSplit(
    row,
    fields.map(([other, amount]) => ({ id: other.id, amount })),
    others,
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

describe("linkedInFull", () => {
  it("tells a payment that's all payback", () => {
    const totals = paybackTotals([
      link(marco, dinner, 15000),
      link(marco, pizzeria, 2400),
      link(lucia, pizzeria, 2000),
    ]);
    expect(linkedInFull(marco, totals)).toBe(true);
    expect(linkedInFull(lucia, totals)).toBe(false);
    expect(linkedInFull(salary, totals)).toBe(false);
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
        split: "That's 198.00 € in all, more than the payment's 174.00 €.",
      },
    });
    expect(
      split(marco, [
        [dinner, "300"],
        [pizzeria, "60"],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        [pizzeria.id]: "Only 48.00 € of it is left to pay back.",
        split: "That's 360.00 € in all, more than the payment's 174.00 €.",
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

  it("splits an expense across the payments that pay it back", () => {
    // Marco already pays back 24.00 € of the pizzeria: 150.00 € of his
    // payment is left for the dinner.
    const pizza = [link(marco, pizzeria, 2400)];
    expect(
      split(
        dinner,
        [
          [marco, "150"],
          [lucia, "30"],
        ],
        pizza,
      ),
    ).toEqual({
      ok: true,
      value: [link(marco, dinner, 15000), link(lucia, dinner, 3000)],
    });
    expect(split(dinner, [[marco, "160"]], pizza)).toEqual({
      ok: false,
      errors: { [marco.id]: "Only 150.00 € of it is left to link." },
    });
    expect(
      split(pizzeria, [[marco, "10"]], [link(marco, dinner, 17400)]),
    ).toEqual({
      ok: false,
      errors: { [marco.id]: "All of it already pays back other expenses." },
    });
    // The pizzeria's own link with Marco is replaced, not added to.
    expect(split(pizzeria, [[marco, "48"]], pizza).ok).toBe(true);
    expect(
      split(pizzeria, [
        [marco, "40"],
        [lucia, "30"],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        split: "That's 70.00 € in all, more than the expense's 48.00 €.",
      },
    });
  });

  it("needs an amount above zero for each one", () => {
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

  it("links money in with money out, in one currency", () => {
    expect(
      split(marco, [
        [groceriesUS, "10"],
        [salary, "10"],
        [gone, "10"],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        [groceriesUS.id]:
          "It's in USD: a payback and its expenses must be in the same currency.",
        [salary.id]: "Only money going out can be paid back.",
        [gone.id]: "It can't be paid back any more. Pick another expense.",
      },
    });
    expect(split(dinner, [[pizzeria, "10"]])).toEqual({
      ok: false,
      errors: {
        [pizzeria.id]: "Only money coming in can pay back an expense.",
      },
    });
  });

  it("takes each one once", () => {
    expect(
      split(marco, [
        [dinner, "100"],
        [dinner, "50"],
      ]),
    ).toEqual({
      ok: false,
      errors: { [dinner.id]: "Each one can be in the split once." },
    });
  });

  it("needs something in the split", () => {
    expect(split(marco, [])).toEqual({
      ok: false,
      errors: { split: "Pick the expenses it pays back." },
    });
    expect(split(dinner, [])).toEqual({
      ok: false,
      errors: { split: "Pick the payments that pay it back." },
    });
  });
});

describe("paybackOptions", () => {
  const on = (t: PaybackTarget, date: string, description: string) => ({
    ...t,
    date,
    description,
  });
  const dated = {
    dinner: on(dinner, "2026-10-17", "RISTORANTE DA MARIO"),
    pizzeria: on(pizzeria, "2026-10-16", "PIZZERIA DA GINO"),
    marco: on(marco, "2026-10-19", "BONIFICO DA MARCO"),
    lucia: on(lucia, "2026-10-20", "BONIFICO DA LUCIA"),
    groceriesUS: on(groceriesUS, "2026-10-18", "WHOLE FOODS"),
    salary: on(salary, "2026-11-27", "SALARY ACME SPA"),
    olderPizzeria: on(gone, "2026-09-10", "PIZZERIA DA GINO"),
    concert: on(
      { id: 8, currency: "EUR", amount: -9000 },
      "2026-08-01",
      "CONCERT TICKETS",
    ),
  };
  const pool = Object.values(dated);
  const ids = (options: { id: number }[]) => options.map((o) => o.id);

  it("offers a payment the expenses of the 30 days up to it, newest first", () => {
    const options = paybackOptions(dated.marco, pool, []);
    expect(ids(options)).toEqual([dinner.id, pizzeria.id]);
    expect(options[0]).toMatchObject({ left: 30500, linked: 0 });
  });

  it("offers an expense the payments of the 30 days after it, nearest first", () => {
    expect(ids(paybackOptions(dated.dinner, pool, []))).toEqual([
      marco.id,
      lucia.id,
    ]);
  });

  it("leaves out what's fully linked elsewhere, and keeps what it's linked with", () => {
    const links = [link(lucia, pizzeria, 3000), link(marco, pizzeria, 1800)];
    // Marco's own 18.00 € doesn't count against the pizzeria for him.
    expect(paybackOptions(dated.marco, pool, links)).toMatchObject([
      { id: dinner.id, left: 30500, linked: 0 },
      { id: pizzeria.id, left: 1800, linked: 1800 },
    ]);
    expect(
      ids(paybackOptions(dated.lucia, pool, [link(marco, pizzeria, 4800)])),
    ).toEqual([dinner.id]);
    // Linked already, though it's older than 30 days.
    expect(
      ids(
        paybackOptions(dated.marco, pool, [link(marco, dated.concert, 1000)]),
      ),
    ).toEqual([dinner.id, pizzeria.id, dated.concert.id]);
  });

  it("searches older expenses, or later payments, by description", () => {
    expect(ids(paybackOptions(dated.marco, pool, [], "pizzeria  da"))).toEqual([
      gone.id,
    ]);
    expect(ids(paybackOptions(dated.marco, pool, [], ""))).toEqual([
      gone.id,
      dated.concert.id,
    ]);
    expect(ids(paybackOptions(dated.dinner, pool, [], "salary"))).toEqual([
      salary.id,
    ]);
  });
});

describe("prefill", () => {
  it("gives what's left to the ticked ones I didn't type, nearest first", () => {
    // Marco's 174.00 € with the dinner and the pizzeria ticked.
    const rows = (dinnerTyped: number | null) => [
      { left: 30500, typed: dinnerTyped },
      { left: 4800, typed: null },
    ];
    expect(prefill(17400, rows(null))).toEqual([17400, 0]);
    expect(prefill(17400, rows(15000))).toEqual([15000, 2400]);
    expect(prefill(17400, rows(20000))).toEqual([20000, 0]);
  });
});
