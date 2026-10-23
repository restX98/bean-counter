import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-19" });
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

const statement = (groceries = "ESSELUNGA MILANO") =>
  [
    "Data;Descrizione;Importo;Saldo",
    "01/10/2026;SALARY ACME SPA;2.000,00;3.240,50",
    `02/10/2026;${groceries};-56,30;3.184,20`,
    "05/10/2026;TRANSFER TO SAVINGS;-500,00;2.684,20",
  ].join("\n");
const mapping = {
  roles: ["date", "description", "amount", "balance"],
  dateFormat: "DD/MM/YYYY",
  decimalMark: "comma",
};

async function setup(): Promise<number> {
  const { body } = await call("POST", "/api/accounts", {
    name: "Main checking",
    bank: "Bank A",
    type: "checking",
    currency: "EUR",
  });
  await importText(body.id, statement());
  return body.id;
}

async function importText(account: number, text: string, extra: object = {}) {
  const res = await app.inject({
    method: "POST",
    url: `/api/imports?account=${account}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(text),
  });
  const file = res.json();
  return call("POST", `/api/imports/${file.id}/save`, {
    mapping,
    presetName: null,
    ...extra,
  });
}

const ledger = (account: number) =>
  call("GET", `/api/accounts/${account}/transactions`);

describe("an account's transactions (S4)", () => {
  it("lists them newest first, with the balance after each", async () => {
    const { status, body } = await ledger(await setup());
    expect(status).toBe(200);
    expect(
      body.transactions.map((t: { description: string; balance: number }) => [
        t.description,
        t.balance,
      ]),
    ).toEqual([
      ["TRANSFER TO SAVINGS", 268420],
      ["ESSELUNGA MILANO", 318420],
      ["SALARY ACME SPA", 324050],
    ]);
    expect(body.gaps).toEqual([]);
    expect(body.offDays).toEqual([]);
  });

  it("counts them on the account", async () => {
    const id = await setup();
    expect(
      (await call("GET", `/api/accounts/${id}`)).body.transactionCount,
    ).toBe(3);
  });

  it("shows where a kept near-match breaks the balances", async () => {
    const id = await setup();
    await importText(id, statement("ESSELUNGA SPA"), {
      decisions: { 3: "keep" },
    });
    const { body } = await ledger(id);
    expect(body.gaps).toEqual([
      {
        after: "2026-10-01",
        until: "2026-10-02",
        amount: 5630,
        suspects: [
          expect.objectContaining({
            reason: "kept-near-match",
            description: "ESSELUNGA SPA",
          }),
          expect.objectContaining({
            reason: "same-amount",
            description: "ESSELUNGA MILANO",
          }),
        ],
        balances: {
          after: { app: 329680, bank: 324050 },
          until: { app: 318420, bank: 318420 },
        },
      },
    ]);
    expect(body.offDays).toEqual(["2026-10-01"]);
  });
});

describe("every account's transactions (S5)", () => {
  const list = (query = "") => call("GET", `/api/transactions${query}`);
  const described = (body: { transactions: { description: string }[] }) =>
    body.transactions.map((t) => t.description);

  async function twoAccounts() {
    const main = await setup();
    const { body } = await call("POST", "/api/accounts", {
      name: "Savings",
      bank: "Bank B",
      type: "savings",
      currency: "EUR",
    });
    await importText(
      body.id,
      [
        "Data;Descrizione;Importo;Saldo",
        "28/09/2026;INTEREST;5,00;1.005,00",
        "05/10/2026;TRANSFER FROM CHECKING;500,00;1.505,00",
      ].join("\n"),
    );
    return { main, savings: body.id as number };
  }

  it("lists them newest first, each with its account", async () => {
    const { main, savings } = await twoAccounts();
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(
      body.transactions.map(
        (t: { date: string; accountId: number; description: string }) => [
          t.date,
          t.accountId,
          t.description,
        ],
      ),
    ).toEqual([
      ["2026-10-05", savings, "TRANSFER FROM CHECKING"],
      ["2026-10-05", main, "TRANSFER TO SAVINGS"],
      ["2026-10-02", main, "ESSELUNGA MILANO"],
      ["2026-10-01", main, "SALARY ACME SPA"],
      ["2026-09-28", savings, "INTEREST"],
    ]);
    expect(body.total).toBe(5);
    expect(body.months).toEqual(["2026-10", "2026-09"]);
  });

  it("gives a transfer's other side, as the account's list does", async () => {
    const { main } = await twoAccounts();
    const { body } = await list();
    expect(body.transactions[0]).toEqual(
      expect.objectContaining({
        categoryId: null,
        conflict: null,
        toPick: null,
        transfer: expect.objectContaining({
          accountId: main,
          description: "TRANSFER TO SAVINGS",
        }),
      }),
    );
  });

  it("finds the descriptions that contain the search, ignoring case and spaces", async () => {
    await twoAccounts();
    const { body } = await list("?q=transfer%20%20to");
    expect(described(body)).toEqual(["TRANSFER TO SAVINGS"]);
    expect(body.total).toBe(1);
    expect((await list("?q=netflix")).body).toEqual({
      transactions: [],
      total: 0,
      months: ["2026-10", "2026-09"],
    });
  });

  it("sends the first ones, and how many there are in all", async () => {
    await twoAccounts();
    const { body } = await list("?q=r&limit=2");
    expect(described(body)).toEqual([
      "TRANSFER FROM CHECKING",
      "TRANSFER TO SAVINGS",
    ]);
    expect(body.total).toBe(4);
    expect((await list("?limit=0")).status).toBe(400);
  });

  it("keeps an account, a period's months, a category or a type", async () => {
    const { main, savings } = await twoAccounts();
    const category = async (name: string, type: string) =>
      (await call("POST", "/api/categories", { name, type })).body.id;
    const salary = await category("Salary", "income");
    const groceries = await category("Groceries", "expense");
    const ids = new Map(
      (await list()).body.transactions.map(
        (t: { description: string; id: number }) => [t.description, t.id],
      ),
    );
    const put = (description: string, categoryId: number) =>
      call("PUT", `/api/transactions/${ids.get(description)}/category`, {
        categoryId,
      });
    await put("SALARY ACME SPA", salary);
    await put("ESSELUNGA MILANO", groceries);
    await call("POST", `/api/transactions/${ids.get("INTEREST")}/exclude`);

    const found = async (query: string) => described((await list(query)).body);
    expect(await found(`?account=${savings}`)).toEqual([
      "TRANSFER FROM CHECKING",
      "INTEREST",
    ]);
    expect(await found("?currency=EUR")).toHaveLength(5);
    expect(await found("?currency=USD")).toEqual([]);
    expect(await found("?period=2026-09")).toEqual(["INTEREST"]);
    expect(await found("?period=2026-09..2026-10")).toHaveLength(5);
    expect(await found(`?category=${groceries}`)).toEqual(["ESSELUNGA MILANO"]);
    expect(await found("?type=income")).toEqual(["SALARY ACME SPA"]);
    expect(await found("?type=expense")).toEqual(["ESSELUNGA MILANO"]);
    expect(await found("?type=transfer")).toEqual([
      "TRANSFER FROM CHECKING",
      "TRANSFER TO SAVINGS",
    ]);
    expect(await found("?type=excluded")).toEqual(["INTEREST"]);
    expect(await found("?type=uncategorized")).toEqual([]);
    expect(
      await found(`?account=${main}&period=2026-10&type=expense&q=esselunga`),
    ).toEqual(["ESSELUNGA MILANO"]);
    // The months to pick from don't depend on the filters.
    expect((await list("?period=2026-09")).body.months).toEqual([
      "2026-10",
      "2026-09",
    ]);
  });

  it("counts a possible transfer among transfers", async () => {
    // Two accounts could take Main's 500.00 €, so nothing links on its own.
    for (const name of ["Savings", "Card"]) {
      const { body } = await call("POST", "/api/accounts", {
        name,
        bank: "Bank B",
        type: "savings",
        currency: "EUR",
      });
      await importText(
        body.id,
        "Data;Descrizione;Importo;Saldo\n05/10/2026;FROM CHECKING;500,00;500,00",
      );
    }
    await setup();
    const { body } = await list("?type=transfer");
    expect(
      body.transactions.map(
        (t: { description: string; toPick: { count: number } | null }) => [
          t.description,
          t.toPick?.count,
        ],
      ),
    ).toEqual([
      ["TRANSFER TO SAVINGS", 2],
      ["FROM CHECKING", 1],
      ["FROM CHECKING", 1],
    ]);
  });

  it("refuses a period that isn't one", async () => {
    for (const period of ["2026-13", "october", "2026-10..2026-08"]) {
      expect((await list(`?period=${period}`)).status, period).toBe(400);
    }
    expect((await list("?type=refund")).status).toBe(400);
  });
});

describe("one transaction (S6 over S5)", () => {
  it("gives it as the lists do, with its account", async () => {
    const id = await setup();
    const [first] = (await ledger(id)).body.transactions;
    const { status, body } = await call("GET", `/api/transactions/${first.id}`);
    expect(status).toBe(200);
    // The account's list adds the balances; toEqual ignores undefined ones.
    expect(body).toEqual({
      ...first,
      bankBalance: undefined,
      balance: undefined,
      accountId: id,
    });
  });

  it("refuses an unknown one", async () => {
    expect((await call("GET", "/api/transactions/99")).status).toBe(404);
  });
});

describe("excluding a transaction", () => {
  it("takes it out of the balances until it's restored", async () => {
    const id = await setup();
    const { body } = await ledger(id);
    const groceries = body.transactions[1].id;

    expect(
      (await call("POST", `/api/transactions/${groceries}/exclude`)).status,
    ).toBe(204);
    const after = (await ledger(id)).body;
    expect(after.transactions[1]).toMatchObject({
      excluded: true,
      balance: null,
    });
    // The bank had it, so the balances now disagree before the anchor.
    expect(after.gaps).toHaveLength(1);

    await call("POST", `/api/transactions/${groceries}/restore`);
    expect((await ledger(id)).body.gaps).toEqual([]);
  });

  it("fixes the balances when it's the duplicate", async () => {
    const id = await setup();
    await importText(id, statement("ESSELUNGA SPA"), {
      decisions: { 3: "keep" },
    });
    const kept = (await ledger(id)).body.gaps[0].suspects[0].id;
    await call("POST", `/api/transactions/${kept}/exclude`);
    expect((await ledger(id)).body.gaps).toEqual([]);
  });

  it("refuses unknown transactions and archived accounts", async () => {
    expect((await call("POST", "/api/transactions/99/exclude")).status).toBe(
      404,
    );
    const id = await setup();
    const first = (await ledger(id)).body.transactions[0].id;
    await call("POST", `/api/accounts/${id}/archive`);
    expect(await call("POST", `/api/transactions/${first}/exclude`)).toEqual({
      status: 409,
      body: { error: "This account is archived. Unarchive it to change it." },
    });
  });

  it("refuses an unknown account's list", async () => {
    expect((await ledger(42)).status).toBe(404);
  });
});

describe("balances I entered to look for what's missing (D2)", () => {
  const enter = (account: number, amount: string, date = "2026-10-19") =>
    call("POST", `/api/accounts/${account}/balance-checks`, { amount, date });

  it("keeps the anchor and shows where the balances part ways", async () => {
    const id = await setup();
    const { status, body } = await enter(id, "2,450.00");
    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(Number),
      date: "2026-10-19",
      amount: 245000,
    });

    const after = (await ledger(id)).body;
    expect(after.checks).toEqual([
      { id: body.id, date: "2026-10-19", amount: 245000, app: 268420 },
    ]);
    // October's later transactions aren't imported yet.
    expect(after.gaps).toMatchObject([
      { after: "2026-10-05", until: "2026-10-19", amount: -23420 },
    ]);
    expect((await call("GET", `/api/accounts/${id}`)).body.anchor).toEqual({
      amount: 268420,
      date: "2026-10-05",
      source: "statement",
    });
  });

  it("keeps one a day, and drops it when that day's balance becomes the anchor", async () => {
    const id = await setup();
    await enter(id, "2,450.00");
    await enter(id, "2,460.00");
    expect((await ledger(id)).body.checks).toMatchObject([{ amount: 246000 }]);

    await call("PUT", `/api/accounts/${id}/anchor`, {
      amount: "2,460.00",
      date: "2026-10-19",
    });
    const after = (await ledger(id)).body;
    expect(after.checks).toEqual([]);
    // Mine is the anchor now, so the statement's balances are the ones off.
    expect(after.gaps).toMatchObject([
      { after: "2026-10-05", until: "2026-10-19", amount: -22420 },
    ]);
  });

  it("can be removed", async () => {
    const id = await setup();
    const check = (await enter(id, "2,450.00")).body.id;
    const remove = () => call("DELETE", `/api/balance-checks/${check}`);
    expect((await remove()).status).toBe(204);
    expect((await ledger(id)).body).toMatchObject({ checks: [], gaps: [] });
    expect((await remove()).status).toBe(404);
  });

  it("refuses wrong balances, archived accounts and accounts without one", async () => {
    const id = await setup();
    expect(await enter(id, "2,450.00", "2026-10-20")).toEqual({
      status: 400,
      body: { errors: { anchorDate: "The date can't be in the future." } },
    });

    const check = (await enter(id, "2,450.00")).body.id;
    await call("POST", `/api/accounts/${id}/archive`);
    expect((await enter(id, "2,450.00")).status).toBe(409);
    expect((await call("DELETE", `/api/balance-checks/${check}`)).status).toBe(
      409,
    );

    const { body: empty } = await call("POST", "/api/accounts", {
      name: "Savings",
      bank: "Bank A",
      type: "savings",
      currency: "EUR",
    });
    expect(await enter(empty.id, "100.00")).toMatchObject({ status: 409 });
  });
});

describe("a transaction's category (S6)", () => {
  const setCategory = (id: number, categoryId: number | null) =>
    call("PUT", `/api/transactions/${id}/category`, { categoryId });
  const addCategory = async (name: string, type = "expense") =>
    (await call("POST", "/api/categories", { name, type })).body.id;

  it("sets it, and takes it away", async () => {
    const account = await setup();
    const groceries = await addCategory("Groceries");
    const id = (await ledger(account)).body.transactions[1].id;

    expect((await setCategory(id, groceries)).status).toBe(204);
    expect((await ledger(account)).body.transactions[1]).toMatchObject({
      description: "ESSELUNGA MILANO",
      categoryId: groceries,
    });
    expect((await call("GET", "/api/categories")).body).toMatchObject({
      categories: [{ name: "Groceries", transactionCount: 1 }],
      uncategorized: 2,
    });

    await setCategory(id, null);
    expect((await ledger(account)).body.transactions[1].categoryId).toBeNull();
  });

  it("refuses unknown transactions and categories, and archived accounts", async () => {
    const account = await setup();
    const groceries = await addCategory("Groceries");
    expect((await setCategory(99, groceries)).status).toBe(404);

    const id = (await ledger(account)).body.transactions[0].id;
    expect(await setCategory(id, 99)).toEqual({
      status: 400,
      body: { error: "This category doesn't exist any more." },
    });
    await call("POST", `/api/accounts/${account}/archive`);
    expect((await setCategory(id, groceries)).status).toBe(409);
  });
});
