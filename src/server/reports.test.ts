import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-11-03" });
  return () => app.close();
});

async function call(
  method: "GET" | "POST" | "PUT",
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

async function account(name: string, type: string, currency = "EUR") {
  const { body } = await call("POST", "/api/accounts", {
    name,
    bank: "Bank A",
    type,
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

const monthly = (query = "") => call("GET", `/api/reports/monthly${query}`);

/** The brief's October (§6.1), and one September expense. */
async function october() {
  const checking = await account("Checking", "checking");
  const savings = await account("Savings", "savings");
  await importRows(checking, [
    "28/09/2026;ESSELUNGA;-40,00;3.000,00",
    "01/10/2026;SALARY ACME SPA;2.000,00;5.000,00",
    "03/10/2026;RENT OCTOBER;-700,00;4.300,00",
    "05/10/2026;TRANSFER TO SAVINGS;-500,00;3.800,00",
    "10/10/2026;ESSELUNGA;-300,00;3.500,00",
  ]);
  await importRows(savings, [
    "05/10/2026;TRANSFER FROM CHECKING;500,00;10.500,00",
    "31/10/2026;INTEREST;5,00;10.505,00",
  ]);
  const ids = {
    salary: await category("Salary", "income"),
    interest: await category("Interest", "income"),
    rent: await category("Rent", "expense"),
    groceries: await category("Groceries", "expense"),
  };
  await categorize("SALARY", ids.salary);
  await categorize("INTEREST", ids.interest);
  await categorize("RENT", ids.rent);
  await categorize("ESSELUNGA", ids.groceries);
  return { checking, savings, ...ids };
}

describe("the monthly report (S12)", () => {
  it("adds up the newest month by default", async () => {
    const { checking, savings, salary, interest, rent, groceries } =
      await october();
    const { status, body } = await monthly();
    expect(status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        currencies: ["EUR"],
        currency: "EUR",
        month: "2026-10",
        thisMonth: "2026-11",
        first: "2026-09",
        net: 100500,
        waiting: 0,
        pending: [],
      }),
    );
    expect(body.income).toEqual({
      lines: [
        { categoryId: salary, amount: 200000, count: 1 },
        { categoryId: interest, amount: 500, count: 1 },
      ],
      total: 200500,
    });
    expect(body.expenses).toEqual({
      lines: [
        { categoryId: rent, amount: -70000, count: 1 },
        { categoryId: groceries, amount: -30000, count: 1 },
      ],
      total: -100000,
    });
    expect(body.movedToSavings).toEqual({
      total: 50000,
      transfers: [
        {
          amount: 50000,
          savings: expect.objectContaining({
            accountId: savings,
            date: "2026-10-05",
            description: "TRANSFER FROM CHECKING",
          }),
          other: expect.objectContaining({ accountId: checking }),
        },
      ],
    });
  });

  it("gives the 12 months up to the one asked for, oldest first", async () => {
    await october();
    const { body } = await monthly("?month=2026-09");
    expect(body.month).toBe("2026-09");
    expect(body.expenses.total).toBe(-4000);
    expect(body.months).toHaveLength(12);
    expect(body.months[0]).toEqual({
      month: "2025-10",
      income: 0,
      expenses: 0,
    });
    expect(body.months.at(-1)).toEqual({
      month: "2026-09",
      income: 0,
      expenses: -4000,
    });
    expect((await monthly()).body.months.at(-1)).toEqual({
      month: "2026-10",
      income: 200500,
      expenses: -100000,
    });
  });

  it("keeps each currency apart, EUR first", async () => {
    await october();
    const us = await account("US account", "checking", "USD");
    await importRows(us, ["15/08/2026;COFFEE;-4,50;100,00"]);
    const { body } = await monthly("?currency=USD");
    expect(body.currencies).toEqual(["EUR", "USD"]);
    expect(body.month).toBe("2026-08");
    expect(body.expenses).toEqual({
      lines: [{ categoryId: null, amount: -450, count: 1 }],
      total: -450,
    });
    expect(body.waiting).toBe(1);
  });

  it("leaves out possible transfers, naming them, and counts what Review can change", async () => {
    const checking = await account("Checking", "checking");
    // Two accounts could take the 500.00 €, so nothing links on its own.
    for (const name of ["Savings", "Deposit"]) {
      await importRows(await account(name, "savings"), [
        "05/10/2026;FROM CHECKING;500,00;500,00",
      ]);
    }
    await importRows(checking, [
      "05/10/2026;TRANSFER TO SAVINGS;-500,00;1.000,00",
      "06/10/2026;PHARMACY;-18,50;981,50",
    ]);
    const { body } = await monthly();
    expect(body.income.total).toBe(0);
    expect(body.expenses.total).toBe(-1850);
    expect(body.movedToSavings.total).toBe(0);
    expect(
      body.pending.map((t: { description: string }) => t.description).sort(),
    ).toEqual(["FROM CHECKING", "FROM CHECKING", "TRANSFER TO SAVINGS"]);
    expect(body.waiting).toBe(4);
  });

  it("counts a suggested exchange as it is, while Review can change it", async () => {
    const checking = await account("Checking", "checking");
    const us = await account("US account", "checking", "USD");
    await importRows(checking, ["28/09/2026;EXCHANGE TO USD;-200,00;800,00"]);
    await importRows(us, ["29/09/2026;FROM EUR;218,00;218,00"]);
    const groceries = await category("Groceries", "expense");
    await categorize("EXCHANGE", groceries);
    const { body } = await monthly();
    expect(body.expenses.total).toBe(-20000);
    expect(body.pending).toEqual([]);
    expect(body.waiting).toBe(1);
    expect((await monthly("?currency=USD")).body.income.total).toBe(21800);
  });

  it("opens on this month when there's nothing yet", async () => {
    const { body } = await monthly();
    expect(body).toEqual(
      expect.objectContaining({
        currencies: [],
        currency: "EUR",
        month: "2026-11",
        first: null,
        net: 0,
      }),
    );
  });

  it("refuses a currency without accounts and a month that isn't one", async () => {
    await october();
    expect((await monthly("?currency=CHF")).status).toBe(400);
    expect((await monthly("?month=2026-13")).status).toBe(400);
    expect((await monthly("?month=10/2026")).status).toBe(400);
  });
});
