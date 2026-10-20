import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-19" });
  return () => app.close();
});

async function call(method: "GET" | "POST", url: string, payload?: object) {
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
