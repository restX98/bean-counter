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

/** Sets the split of a payment, or of an expense. */
const split = (id: number, links: [number, string][]) =>
  call("PUT", `/api/transactions/${id}/paybacks`, {
    links: links.map(([other, amount]) => ({ id: other, amount })),
  });
const paybacksOf = async (transactionId: number) =>
  (await call("GET", `/api/transactions/${transactionId}/paybacks`)).body;
const unlink = (transactionId: number) =>
  call("DELETE", `/api/transactions/${transactionId}/paybacks`);
const october = async () =>
  (await call("GET", "/api/reports/monthly?month=2026-10")).body;
/** The ids in a Review group. */
const inReview = async (group: "uncategorized" | "paybacks") =>
  (await call("GET", "/api/review")).body[group].map(
    (t: { id: number }) => t.id,
  ) as number[];
const waiting = () => inReview("uncategorized");

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
    // Waiting first as a possible payback.
    expect(await inReview("paybacks")).toEqual([marco]);
    expect(await waiting()).not.toContain(marco);
    expect((await october()).waiting).toBe(2);

    await split(marco, [
      [dinner, "150"],
      [pizzeria, "24"],
    ]);
    expect(await inReview("paybacks")).toEqual([]);
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

  it("unlinks from either side: a possible payback again", async () => {
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

    expect(await inReview("paybacks")).toEqual([marco]);
    const report = await october();
    expect(report.expenses.lines[0]).toEqual({
      categoryId: eatingOut,
      amount: -35300,
      count: 2,
    });
    expect(report.income.lines).toEqual([]);
    expect(report.paybacks).toMatchObject([
      { id: marco, description: "BONIFICO DA MARCO" },
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
    expect(await split(dinner, [[pharmacy, "10"]])).toMatchObject({
      status: 400,
      body: {
        errors: {
          [pharmacy]:
            "It can't pay anything back any more. Pick another payment.",
        },
      },
    });
    expect(await split(marco, [])).toMatchObject({
      status: 400,
      body: { errors: { split: "Pick the expenses it pays back." } },
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
    // That decision comes first: it isn't a possible payback yet.
    expect(await inReview("paybacks")).toEqual([]);
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

  it("links an expense to the payments that pay it back", async () => {
    const { pizzeria, dinner, marco } = await splitBill();
    const savings = await account("Savings", "savings");
    await importRows(savings, ["20/10/2026;BONIFICO DA LUCIA;30,00"]);
    const lucia = await id("BONIFICO DA LUCIA");
    await split(marco, [[pizzeria, "24"]]);

    expect(
      await split(dinner, [
        [marco, "150"],
        [lucia, "30"],
      ]),
    ).toEqual({ status: 204, body: null });
    expect(await paybacksOf(dinner)).toMatchObject({
      total: 18000,
      links: [
        { amount: 3000, other: { id: lucia } },
        { amount: 15000, other: { id: marco } },
      ],
    });
    // Marco's link with the pizzeria stays; the dinner's split is replaced.
    expect((await split(dinner, [[marco, "100"]])).status).toBe(204);
    expect((await paybacksOf(marco)).total).toBe(12400);
    expect(await paybacksOf(lucia)).toEqual({ total: 0, links: [] });
    expect(await split(dinner, [[marco, "160"]])).toEqual({
      status: 400,
      body: { errors: { [marco]: "Only 150.00 € of it is left to link." } },
    });
  });

  it("offers D9 the expenses of the 30 days up to a payment, and searches older ones", async () => {
    const { main, pharmacy, pizzeria, dinner, marco } = await splitBill();
    await importRows(main, ["10/09/2026;PIZZERIA DA GINO;-26,00"]);
    const { body } = await call(
      "GET",
      `/api/transactions/${marco}/payback-options`,
    );
    expect(body.window).toBe(30);
    expect(body.options).toEqual([
      {
        id: dinner,
        accountId: main,
        date: "2026-10-17",
        time: null,
        amount: -30500,
        description: "RISTORANTE DA MARIO",
        categoryId: expect.any(Number),
        left: 30500,
        linked: 0,
      },
      expect.objectContaining({ id: pizzeria }),
      expect.objectContaining({ id: pharmacy, categoryId: null }),
    ]);
    const older = await call(
      "GET",
      `/api/transactions/${marco}/payback-options?q=pizzeria`,
    );
    expect(older.body.options).toMatchObject([
      { date: "2026-09-10", amount: -2600, left: 2600 },
    ]);

    // From the expense: the payments of the 30 days after it.
    await split(marco, [[pizzeria, "24"]]);
    const payments = await call(
      "GET",
      `/api/transactions/${dinner}/payback-options`,
    );
    expect(payments.body.options).toMatchObject([
      { id: marco, left: 15000, linked: 0 },
    ]);
  });

  it("says in the lists what's linked, and filters paybacks in S5", async () => {
    const { pizzeria, dinner, marco } = await splitBill();
    await split(marco, [
      [dinner, "150"],
      [pizzeria, "24"],
    ]);
    const listed = async (query = "") =>
      (await call("GET", `/api/transactions?${query}`)).body.transactions as {
        id: number;
        paybacks: { count: number; total: number } | null;
      }[];
    const rows = await listed();
    const of = (id: number) => rows.find((t) => t.id === id)?.paybacks;
    expect(of(marco)).toEqual({ count: 2, total: 17400 });
    expect(of(dinner)).toEqual({ count: 1, total: 15000 });
    expect(of(await id("PHARMACY 24"))).toBeNull();

    expect((await listed("type=payback")).map((t) => t.id)).toEqual([marco]);
    // Part of it is left: it counts as uncategorized, as reports have it.
    await split(marco, [[dinner, "150"]]);
    expect(await listed("type=payback")).toEqual([]);
    expect((await listed("type=uncategorized")).map((t) => t.id)).toContain(
      marco,
    );
  });
});

describe("possible paybacks (S2)", () => {
  const notAPayback = (id: number, categoryId: number) =>
    call("POST", `/api/transactions/${id}/not-a-payback`, { categoryId });
  const income = async () =>
    (await call("POST", "/api/categories", { name: "Gifts", type: "income" }))
      .body.id as number;

  it("suggests money in without a category, with what it could pay back", async () => {
    const { main, eatingOut, pharmacy, pizzeria, dinner, marco } =
      await splitBill();
    // Nothing to pay back in the 30 days before it.
    await importRows(main, ["25/11/2026;BONIFICO DA ANNA;20,00"]);
    const anna = await id("BONIFICO DA ANNA");

    const { body } = await call("GET", "/api/review");
    expect(body.paybacks).toEqual([
      {
        id: marco,
        date: "2026-10-19",
        time: null,
        description: "BONIFICO DA MARCO",
        amount: 17400,
        accountId: main,
        currency: "EUR",
        expenses: [
          {
            id: dinner,
            accountId: main,
            date: "2026-10-17",
            time: null,
            amount: -30500,
            description: "RISTORANTE DA MARIO",
            categoryId: eatingOut,
            left: 30500,
          },
          expect.objectContaining({ id: pizzeria, left: 4800 }),
          expect.objectContaining({ id: pharmacy, categoryId: null }),
        ],
      },
    ]);
    expect(body.uncategorized.map((t: { id: number }) => t.id)).toEqual([
      anna,
      pharmacy,
    ]);
    expect(body.count).toBe(3);
  });

  it("leaves a possible payback out of reports, and names it", async () => {
    const { marco } = await splitBill();
    const report = await october();
    expect(report.income).toEqual({ lines: [], total: 0 });
    expect(report.paybacks).toEqual([
      {
        id: marco,
        accountId: expect.any(Number),
        date: "2026-10-19",
        amount: 17400,
        description: "BONIFICO DA MARCO",
      },
    ]);
    expect(report.pending).toEqual([]);
    const spending = (await call("GET", "/api/reports/spending?period=2026-10"))
      .body;
    expect(spending.paybacks).toMatchObject([{ id: marco }]);
    expect(spending.pending).toEqual([]);
  });

  it("It's income: gives it the category for good, and Undo puts it back", async () => {
    const { dinner, marco } = await splitBill();
    const gifts = await income();
    expect(await notAPayback(marco, gifts)).toEqual({
      status: 204,
      body: null,
    });
    expect(await inReview("paybacks")).toEqual([]);
    expect(await waiting()).not.toContain(marco);
    expect((await october()).income.lines).toEqual([
      { categoryId: gifts, amount: 17400, count: 1 },
    ]);

    // Remembered: without its category, it waits for one, not as a payback.
    await call("PUT", `/api/transactions/${marco}/category`, {
      categoryId: null,
    });
    expect(await inReview("paybacks")).toEqual([]);
    expect(await waiting()).toContain(marco);

    expect(
      (await call("DELETE", `/api/transactions/${marco}/not-a-payback`)).status,
    ).toBe(204);
    expect(await inReview("paybacks")).toEqual([marco]);

    // Linking by hand stays possible.
    await notAPayback(marco, gifts);
    expect((await split(marco, [[dinner, "150"]])).status).toBe(204);
  });

  it("only takes money in that isn't linked, and a category that exists", async () => {
    const { dinner, marco } = await splitBill();
    const gifts = await income();
    expect(await notAPayback(dinner, gifts)).toEqual({
      status: 409,
      body: { error: "Only money coming in can be a payback." },
    });
    expect(await notAPayback(marco, 999)).toEqual({
      status: 400,
      body: { error: "This category doesn't exist any more." },
    });
    await split(marco, [[dinner, "100"]]);
    expect(await notAPayback(marco, gifts)).toEqual({
      status: 409,
      body: { error: "It's linked as a payback. Unlink it first." },
    });
  });

  it("tags a possible payback in the lists, and filters it with paybacks", async () => {
    const { marco } = await splitBill();
    const { body } = await call("GET", "/api/transactions");
    const row = (t: { id: number }) => t.id === marco;
    expect(body.transactions.find(row).possiblePayback).toBe(3);
    expect(
      body.transactions.filter(
        (t: { possiblePayback: number | null }) => t.possiblePayback !== null,
      ),
    ).toHaveLength(1);
    const paybacks = (await call("GET", "/api/transactions?type=payback")).body
      .transactions;
    expect(paybacks.map((t: { id: number }) => t.id)).toEqual([marco]);
  });
});
