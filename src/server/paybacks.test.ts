import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-24" });
  return () => app.close();
});

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

async function account(name: string, type = "checking", currency = "EUR") {
  const { body } = await call("POST", "/api/accounts", {
    name,
    bank: "Bank A",
    type,
    currency,
  });
  return body.id as number;
}

/** Imports rows ("DD/MM/YYYY;description;amount") into an account; returns S10's answer. */
async function importRows(accountId: number, rows: string[]) {
  const upload = await app.inject({
    method: "POST",
    url: `/api/imports?account=${accountId}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(["Data;Descrizione;Importo", ...rows].join("\n")),
  });
  return (
    await call("POST", `/api/imports/${upload.json().id}/save`, {
      mapping: {
        roles: ["date", "description", "amount"],
        dateFormat: "DD/MM/YYYY",
        decimalMark: "comma",
      },
      balance: { amount: "1000", date: "2026-10-01" },
      presetName: null,
    })
  ).body;
}

/** The id of the transaction with this description. */
async function id(description: string) {
  const { body } = await call(
    "GET",
    `/api/transactions?q=${encodeURIComponent(description)}`,
  );
  return body.transactions[0].id as number;
}

const split = (paymentId: number, expenses: [number, string][]) =>
  call("PUT", `/api/transactions/${paymentId}/paybacks`, {
    expenses: expenses.map(([expenseId, amount]) => ({
      id: expenseId,
      amount,
    })),
  });
const paybacksOf = async (transactionId: number) =>
  (await call("GET", `/api/transactions/${transactionId}/paybacks`)).body;
const unlink = (transactionId: number) =>
  call("DELETE", `/api/transactions/${transactionId}/paybacks`);
const october = async () =>
  (await call("GET", "/api/reports/monthly?month=2026-10")).body;
const waiting = async () =>
  (await call("GET", "/api/review")).body.uncategorized.map(
    (t: { id: number }) => t.id,
  ) as number[];

/**
 * The design's split bill: the pizzeria and the dinner, both Eating out,
 * and Marco's payment two days later.
 */
async function splitBill() {
  const main = await account("Main checking");
  const eatingOut = (
    await call("POST", "/api/categories", {
      name: "Eating out",
      type: "expense",
    })
  ).body.id as number;
  await importRows(main, [
    "15/10/2026;PHARMACY 24;-18,50",
    "16/10/2026;PIZZERIA DA GINO;-48,00",
    "17/10/2026;RISTORANTE DA MARIO;-305,00",
    "19/10/2026;BONIFICO DA MARCO;174,00",
  ]);
  const pizzeria = await id("PIZZERIA DA GINO");
  const dinner = await id("RISTORANTE DA MARIO");
  for (const expense of [pizzeria, dinner]) {
    await call("PUT", `/api/transactions/${expense}/category`, {
      categoryId: eatingOut,
    });
  }
  return {
    main,
    eatingOut,
    pharmacy: await id("PHARMACY 24"),
    pizzeria,
    dinner,
    marco: await id("BONIFICO DA MARCO"),
  };
}

describe("linking paybacks (D9)", () => {
  it("splits a payment across the expenses it pays back, and counts my share", async () => {
    const { eatingOut, pizzeria, dinner, marco } = await splitBill();
    expect(
      await split(marco, [
        [dinner, "150.00"],
        [pizzeria, "24.00"],
      ]),
    ).toEqual({ status: 204, body: null });

    expect(await paybacksOf(marco)).toMatchObject({
      total: 17400,
      links: [
        {
          amount: 15000,
          other: {
            id: dinner,
            date: "2026-10-17",
            amount: -30500,
            description: "RISTORANTE DA MARIO",
            categoryId: eatingOut,
          },
        },
        { amount: 2400, other: { id: pizzeria } },
      ],
    });
    expect(await paybacksOf(dinner)).toMatchObject({
      total: 15000,
      links: [{ amount: 15000, other: { id: marco, amount: 17400 } }],
    });

    const report = await october();
    expect(report.expenses.lines).toEqual([
      { categoryId: eatingOut, amount: -17900, count: 2 },
      { categoryId: null, amount: -1850, count: 1 },
    ]);
    expect(report.income.total).toBe(0);
  });

  it("replaces the split, and never pays back more than an expense cost", async () => {
    const { eatingOut, pizzeria, dinner, marco } = await splitBill();
    const savings = await account("Savings", "savings");
    await importRows(savings, ["20/10/2026;BONIFICO DA LUCIA;30,00"]);
    const lucia = await id("BONIFICO DA LUCIA");
    expect((await split(lucia, [[pizzeria, "30"]])).status).toBe(204);

    expect(
      await split(marco, [
        [dinner, "150"],
        [pizzeria, "24"],
      ]),
    ).toEqual({
      status: 400,
      body: {
        errors: { [pizzeria]: "Only 18.00 € of it is left to pay back." },
      },
    });
    expect((await split(marco, [[dinner, "174"]])).status).toBe(204);
    expect(
      (
        await split(marco, [
          [dinner, "150"],
          [pizzeria, "18"],
        ])
      ).status,
    ).toBe(204);
    expect((await paybacksOf(marco)).total).toBe(16800);

    // 353.00 € less 150.00 + 18.00 € from Marco and 30.00 € from Lucia; the
    // 6.00 € of Marco's payment that isn't linked counts as it is.
    const report = await october();
    expect(report.expenses.lines[0]).toEqual({
      categoryId: eatingOut,
      amount: -15500,
      count: 2,
    });
    expect(report.income.lines).toEqual([
      { categoryId: null, amount: 600, count: 1 },
    ]);
  });

  it("takes a payment linked in full out of Review, and puts back a part that isn't linked", async () => {
    const { eatingOut, pizzeria, dinner, marco } = await splitBill();
    expect(await waiting()).toContain(marco);
    expect((await october()).waiting).toBe(2);

    await split(marco, [
      [dinner, "150"],
      [pizzeria, "24"],
    ]);
    expect(await waiting()).not.toContain(marco);
    expect((await october()).waiting).toBe(1);
    expect(
      await call("PUT", `/api/transactions/${marco}/category`, {
        categoryId: eatingOut,
      }),
    ).toEqual({
      status: 409,
      body: {
        error:
          "All of it pays back expenses, so it has no category. Link less of it, or unlink it, first.",
      },
    });

    // 74.00 € of it is now left: it needs a category.
    await split(marco, [[dinner, "100"]]);
    expect(await waiting()).toContain(marco);
    expect(
      (
        await call("PUT", `/api/transactions/${marco}/category`, {
          categoryId: eatingOut,
        })
      ).status,
    ).toBe(204);
  });

  it("unlinks from either side, back to normal transactions", async () => {
    const { eatingOut, pizzeria, dinner, marco } = await splitBill();
    await split(marco, [
      [dinner, "150"],
      [pizzeria, "24"],
    ]);

    expect((await unlink(dinner)).status).toBe(204);
    expect(await paybacksOf(marco)).toMatchObject({
      total: 2400,
      links: [{ other: { id: pizzeria } }],
    });
    expect((await unlink(marco)).status).toBe(204);
    expect(await paybacksOf(pizzeria)).toEqual({ total: 0, links: [] });
    expect(await unlink(marco)).toEqual({
      status: 409,
      body: { error: "It isn't linked." },
    });

    const report = await october();
    expect(report.expenses.lines[0]).toEqual({
      categoryId: eatingOut,
      amount: -35300,
      count: 2,
    });
    expect(report.income.lines).toEqual([
      { categoryId: null, amount: 17400, count: 1 },
    ]);
  });

  it("unlinks a payment or an expense that gets excluded, for good", async () => {
    const { pizzeria, dinner, marco } = await splitBill();
    await split(marco, [
      [dinner, "150"],
      [pizzeria, "24"],
    ]);
    await call("POST", `/api/transactions/${pizzeria}/exclude`);
    expect((await paybacksOf(marco)).total).toBe(15000);
    await call("POST", `/api/transactions/${pizzeria}/restore`);
    expect((await paybacksOf(marco)).total).toBe(15000);

    await call("POST", `/api/transactions/${marco}/exclude`);
    expect(await paybacksOf(dinner)).toEqual({ total: 0, links: [] });
    expect(await split(marco, [[dinner, "150"]])).toEqual({
      status: 409,
      body: { error: "It's excluded. Restore it to link it." },
    });
  });

  it("only links what can still be paid back", async () => {
    const { main, pharmacy, dinner, marco } = await splitBill();
    const savings = await account("Savings", "savings");
    const us = await account("US checking", "checking", "USD");
    await importRows(main, ["21/10/2026;TRANSFER TO SAVINGS;-500,00"]);
    await importRows(savings, ["21/10/2026;TRANSFER FROM CHECKING;500,00"]);
    await importRows(us, ["18/10/2026;WHOLE FOODS;-64,00"]);
    const transfer = await id("TRANSFER TO SAVINGS");
    const wholeFoods = await id("WHOLE FOODS");
    await call("POST", `/api/transactions/${pharmacy}/exclude`);

    expect(
      await split(marco, [
        [transfer, "10"],
        [pharmacy, "10"],
        [wholeFoods, "10"],
        [marco, "10"],
      ]),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          [transfer]: "It can't be paid back any more. Pick another expense.",
          [pharmacy]: "It can't be paid back any more. Pick another expense.",
          [wholeFoods]:
            "It's in USD: a payback and its expenses must be in the same currency.",
          [marco]: "Only money going out can be paid back.",
        },
      },
    });
    expect(await split(dinner, [[marco, "10"]])).toMatchObject({
      status: 400,
      body: {
        errors: { expenses: "Only money coming in can pay back an expense." },
      },
    });
    expect(await split(marco, [])).toMatchObject({
      status: 400,
      body: { errors: { expenses: "Pick the expenses it pays back." } },
    });

    await call("POST", `/api/accounts/${main}/archive`);
    expect(await split(marco, [[dinner, "10"]])).toEqual({
      status: 409,
      body: { error: "This account is archived. Unarchive it to change it." },
    });
  });

  it("waits while the payment may be a transfer", async () => {
    const { dinner, marco } = await splitBill();
    const savings = await account("Savings", "savings");
    await importRows(savings, [
      "19/10/2026;GIROCONTO;-174,00",
      "20/10/2026;GIROCONTO;-174,00",
    ]);
    expect(await split(marco, [[dinner, "150"]])).toEqual({
      status: 409,
      body: {
        error:
          "It may be a transfer. Link it or mark it as not a transfer first.",
      },
    });
  });

  it("keeps linked transactions out of transfers until they're unlinked", async () => {
    const { main, dinner, marco } = await splitBill();
    await split(marco, [[dinner, "174"]]);
    const savings = await account("Savings", "savings");
    expect(
      await importRows(savings, ["20/10/2026;GIROCONTO;-174,00"]),
    ).toMatchObject({ linked: 0 });
    expect(
      await call("GET", `/api/transactions/${marco}/link-options`),
    ).toEqual({
      status: 409,
      body: { error: "It's part of a payback. Unlink that first." },
    });

    // Unlinked, Marco's payment is the only match for the savings one.
    await unlink(marco);
    const { body } = await call("GET", `/api/accounts/${main}/transactions`);
    expect(
      body.transactions.find((t: { id: number }) => t.id === marco).transfer,
    ).toMatchObject({ accountId: savings, amount: -17400 });
  });
});
