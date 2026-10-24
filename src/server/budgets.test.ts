import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-24" });
  return () => app.close();
});

async function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

const mapping = {
  roles: ["date", "description", "amount", "balance"],
  dateFormat: "DD/MM/YYYY",
  decimalMark: "comma",
};

async function account(name: string, currency = "EUR") {
  const { body } = await call("POST", "/api/accounts", {
    name,
    bank: "Bank A",
    type: "checking",
    currency,
  });
  return body.id as number;
}

async function importRows(account: number, rows: string[]) {
  const res = await app.inject({
    method: "POST",
    url: `/api/imports?account=${account}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(
      ["Data;Descrizione;Importo;Saldo", ...rows].join("\n"),
    ),
  });
  await call("POST", `/api/imports/${res.json().id}/save`, {
    mapping,
    presetName: null,
  });
}

async function category(name: string, type: string) {
  return (await call("POST", "/api/categories", { name, type })).body
    .id as number;
}

/** Gives each transaction with this description the category. */
async function categorize(description: string, categoryId: number) {
  const { body } = await call(
    "GET",
    `/api/transactions?q=${encodeURIComponent(description)}&limit=100`,
  );
  for (const t of body.transactions) {
    await call("PUT", `/api/transactions/${t.id}/category`, { categoryId });
  }
}

/**
 * The brief's Groceries (§6.2): 250.00 € in September and 320.00 € in
 * October, with a pharmacy bill left uncategorized.
 */
async function groceries() {
  const checking = await account("Checking");
  await importRows(checking, [
    "05/09/2026;ESSELUNGA;-150,00;1.850,00",
    "20/09/2026;ESSELUNGA;-100,00;1.750,00",
    "03/10/2026;ESSELUNGA;-200,00;1.550,00",
    "10/10/2026;PHARMACY;-18,50;1.531,50",
    "15/10/2026;ESSELUNGA;-120,00;1.411,50",
  ]);
  const ids = {
    checking,
    salary: await category("Salary", "income"),
    groceries: await category("Groceries", "expense"),
    eatingOut: await category("Eating out", "expense"),
  };
  await categorize("ESSELUNGA", ids.groceries);
  return ids;
}

const add = (fields: object) =>
  call("POST", "/api/budgets", {
    currency: "EUR",
    limit: "300,00",
    start: "2026-09",
    ...fields,
  });

describe("budgets (S14)", () => {
  it("has none at first, and offers the expense categories", async () => {
    const { groceries: g, eatingOut } = await groceries();
    const { status, body } = await call("GET", "/api/budgets");
    expect(status).toBe(200);
    expect(body).toEqual({
      currencies: ["EUR"],
      currency: "EUR",
      month: "2026-10",
      thisMonth: "2026-10",
      budgets: [],
      uncategorized: -1850,
      available: [
        { id: eatingOut, name: "Eating out" },
        { id: g, name: "Groceries" },
      ],
      firstMonths: { EUR: "2026-09" },
    });
  });

  it("shows a month and the running balance (brief §6.2)", async () => {
    const { groceries: g, eatingOut } = await groceries();
    const added = await add({ categoryId: g });
    expect(added.status).toBe(201);

    const { body } = await call("GET", "/api/budgets");
    expect(body.budgets).toEqual([
      {
        id: added.body.id,
        categoryId: g,
        name: "Groceries",
        currency: "EUR",
        start: "2026-09",
        limit: 30000,
        status: {
          month: { limit: 30000, spent: 32000, left: -2000 },
          running: {
            since: "2026-09",
            budgeted: 60000,
            spent: 57000,
            left: 3000,
          },
        },
      },
    ]);
    expect(body.available).toEqual([{ id: eatingOut, name: "Eating out" }]);

    const september = await call("GET", "/api/budgets?month=2026-09");
    expect(september.body.budgets[0].status).toEqual({
      month: { limit: 30000, spent: 25000, left: 5000 },
      running: { since: "2026-09", budgeted: 30000, spent: 25000, left: 5000 },
    });
    expect(september.body.uncategorized).toBe(0);
  });

  it("shows a budget that starts next month with its first limit", async () => {
    const { groceries: g } = await groceries();
    await add({ categoryId: g, limit: "280", start: "2026-11" });
    const { body } = await call("GET", "/api/budgets");
    expect(body.budgets[0]).toMatchObject({
      start: "2026-11",
      limit: 28000,
      status: null,
    });
  });

  it("counts only spending in the budget's currency", async () => {
    const { groceries: g } = await groceries();
    const us = await account("US account", "USD");
    await importRows(us, ["12/10/2026;WHOLE FOODS;-50,00;100,00"]);
    await categorize("WHOLE FOODS", g);
    await add({ categoryId: g });

    const eur = await call("GET", "/api/budgets");
    expect(eur.body.budgets[0].status.month.spent).toBe(32000);
    const usd = await call("GET", "/api/budgets?currency=USD");
    expect(usd.body).toMatchObject({
      currencies: ["EUR", "USD"],
      budgets: [],
      firstMonths: { EUR: "2026-09", USD: "2026-10" },
    });
    // Groceries has its EUR budget: it can't have one in USD too.
    expect(usd.body.available.map((c: { name: string }) => c.name)).toEqual([
      "Eating out",
    ]);
    expect((await call("GET", "/api/budgets?currency=GBP")).body).toEqual({
      error: "None of your accounts is in GBP.",
    });
  });

  it("takes refunds off the month's spending", async () => {
    const { checking, groceries: g } = await groceries();
    await importRows(checking, ["18/10/2026;ESSELUNGA REFUND;30,00;1.441,50"]);
    await categorize("ESSELUNGA REFUND", g);
    await add({ categoryId: g });
    const { body } = await call("GET", "/api/budgets");
    expect(body.budgets[0].status.month).toEqual({
      limit: 30000,
      spent: 29000,
      left: 1000,
    });
  });
});

describe("adding a budget (D7)", () => {
  it("answers with the new budget, month by month", async () => {
    const { groceries: g } = await groceries();
    const { body } = await add({ categoryId: g });
    expect(body).toEqual({
      id: expect.any(Number),
      categoryId: g,
      name: "Groceries",
      currency: "EUR",
      plan: {
        start: "2026-09",
        limits: [{ from: "2026-09", amount: 30000 }],
        restarts: [],
      },
      month: "2026-10",
      thisMonth: "2026-10",
      status: expect.objectContaining({
        running: expect.objectContaining({ left: 3000 }),
      }),
      history: [
        {
          month: "2026-09",
          limit: 30000,
          spent: 25000,
          left: 5000,
          running: 5000,
          restart: false,
        },
        {
          month: "2026-10",
          limit: 30000,
          spent: 32000,
          left: -2000,
          running: 3000,
          restart: false,
        },
      ],
    });
    expect((await call("GET", `/api/budgets/${body.id}`)).body).toEqual(body);
  });

  it("explains what's wrong", async () => {
    const { salary, groceries: g } = await groceries();
    expect(
      await add({ categoryId: salary, currency: "USD", limit: "", start: "" }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          categoryId: "Pick an expense category.",
          currency: "Pick the currency of one of your accounts.",
          limit: "Enter the monthly limit.",
          start: "Pick a month.",
        },
      },
    });
    expect((await add({ categoryId: g, start: "2026-08" })).body).toEqual({
      errors: {
        start: "Pick September 2026 or later: there's nothing before it.",
      },
    });
    expect((await add({ categoryId: g, start: "2026-12" })).body).toEqual({
      errors: { start: "Pick November 2026 at the latest." },
    });
    await add({ categoryId: g });
    expect((await add({ categoryId: g })).body).toEqual({
      errors: { categoryId: "It has a budget already." },
    });
  });
});

describe("changing a budget (D7)", () => {
  it("changes the limit from a month on; earlier months keep theirs", async () => {
    const { groceries: g } = await groceries();
    const { id } = (await add({ categoryId: g })).body;
    const raised = await call("POST", `/api/budgets/${id}/limits`, {
      limit: "350,00",
      from: "2026-11",
    });
    expect(raised.status).toBe(200);
    expect(raised.body.plan.limits).toEqual([
      { from: "2026-09", amount: 30000 },
      { from: "2026-11", amount: 35000 },
    ]);
    expect(raised.body.history.map((m: { limit: number }) => m.limit)).toEqual([
      30000, 30000,
    ]);

    // From October: it replaces November's change too.
    const { body } = await call("POST", `/api/budgets/${id}/limits`, {
      limit: "320,00",
      from: "2026-10",
    });
    expect(body.plan.limits).toEqual([
      { from: "2026-09", amount: 30000 },
      { from: "2026-10", amount: 32000 },
    ]);
    expect(body.status.running).toEqual({
      since: "2026-09",
      budgeted: 62000,
      spent: 57000,
      left: 5000,
    });
    expect(
      (
        await call("POST", `/api/budgets/${id}/limits`, {
          limit: "0",
          from: "2026-08",
        })
      ).body,
    ).toEqual({
      errors: {
        limit: "Enter a limit above zero.",
        from: "Pick September 2026 or later: the budget starts then.",
      },
    });
  });

  it("starts the running balance over; the history keeps the months before", async () => {
    const { groceries: g } = await groceries();
    const { id } = (await add({ categoryId: g })).body;
    const { status, body } = await call("POST", `/api/budgets/${id}/restarts`, {
      from: "2026-10",
    });
    expect(status).toBe(200);
    expect(body.plan.restarts).toEqual(["2026-10"]);
    expect(body.status.running).toEqual({
      since: "2026-10",
      budgeted: 30000,
      spent: 32000,
      left: -2000,
    });
    expect(
      body.history.map((m: { running: number; restart: boolean }) => [
        m.running,
        m.restart,
      ]),
    ).toEqual([
      [5000, false],
      [-2000, true],
    ]);
    expect(
      (await call("POST", `/api/budgets/${id}/restarts`, { from: "2026-10" }))
        .body,
    ).toEqual({ errors: { from: "Pick a month after October 2026." } });
  });

  it("answers 404 for a budget that doesn't exist", async () => {
    expect((await call("GET", "/api/budgets/9")).status).toBe(404);
    expect(
      (
        await call("POST", "/api/budgets/9/limits", {
          limit: "1",
          from: "2026-10",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("POST", "/api/budgets/9/restarts", { from: "2026-10" }))
        .status,
    ).toBe(404);
  });
});

describe("a budget's category", () => {
  it("stays an expense category", async () => {
    const { groceries: g } = await groceries();
    await add({ categoryId: g });
    expect(
      await call("PATCH", `/api/categories/${g}`, {
        name: "Groceries",
        type: "income",
      }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          type: "It has a budget, and only expense categories can have one.",
        },
      },
    });
  });

  it("knows its budget", async () => {
    const { groceries: g } = await groceries();
    const { id } = (await add({ categoryId: g })).body;
    const { body } = await call("GET", "/api/categories");
    expect(
      body.categories.map((c: { name: string; budgetId: number | null }) => [
        c.name,
        c.budgetId,
      ]),
    ).toEqual([
      ["Salary", null],
      ["Groceries", id],
      ["Eating out", null],
    ]);
  });

  it("takes its budget with it when deleted", async () => {
    const { groceries: g } = await groceries();
    const { id } = (await add({ categoryId: g })).body;
    await call("POST", `/api/budgets/${id}/restarts`, { from: "2026-10" });
    expect(
      (await call("DELETE", `/api/categories/${g}`, { moveTo: null })).status,
    ).toBe(204);
    expect((await call("GET", `/api/budgets/${id}`)).status).toBe(404);
    expect((await call("GET", "/api/budgets")).body.budgets).toEqual([]);
  });
});
