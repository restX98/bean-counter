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
