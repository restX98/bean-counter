import { describe, expect, it } from "vitest";
import {
  groupCategories,
  validateCategory,
  type Category,
} from "./categories.ts";

describe("validateCategory", () => {
  it("accepts a name and a type, tidying the spaces", () => {
    expect(
      validateCategory({ name: "  Eating   out ", type: "expense" }, []),
    ).toEqual({ ok: true, value: { name: "Eating out", type: "expense" } });
  });

  it("explains a missing name and a wrong type", () => {
    expect(validateCategory({ name: " ", type: "transfer" }, [])).toEqual({
      ok: false,
      errors: {
        name: "Give the category a name.",
        type: "Pick income or expense.",
      },
    });
  });

  it("refuses long names", () => {
    expect(
      validateCategory({ name: "x".repeat(41), type: "income" }, []),
    ).toMatchObject({
      errors: { name: "Keep it under 40 characters." },
    });
  });

  it("refuses a name another category has, ignoring case and type", () => {
    expect(
      validateCategory({ name: "refunds", type: "income" }, [
        "Groceries",
        "Refunds",
      ]),
    ).toMatchObject({
      errors: { name: "You already have a category called refunds." },
    });
  });
});

describe("groupCategories", () => {
  const category = (
    id: number,
    name: string,
    type: Category["type"],
  ): Category => ({ id, name, type, transactionCount: 0, ruleCount: 0 });

  it("puts income first, then expenses, each by name", () => {
    const rent = category(1, "Rent", "expense");
    const salary = category(2, "Salary", "income");
    const eating = category(3, "eating out", "expense");
    const groceries = category(4, "Groceries", "expense");
    expect(groupCategories([rent, salary, eating, groceries])).toEqual([
      { type: "income", categories: [salary] },
      { type: "expense", categories: [eating, groceries, rent] },
    ]);
  });

  it("leaves out empty groups", () => {
    const rent = category(1, "Rent", "expense");
    expect(groupCategories([rent])).toEqual([
      { type: "expense", categories: [rent] },
    ]);
    expect(groupCategories([])).toEqual([]);
  });
});
