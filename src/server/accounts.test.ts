import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../domain/accounts.ts";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

const TODAY = "2026-10-19";
let today = TODAY;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  today = TODAY;
  app = buildApp({ db: openDatabase(":memory:"), today: () => today });
  return () => app.close();
});

const fields = {
  name: "Main checking",
  bank: "Bank A",
  type: "checking",
  currency: "EUR",
};

async function call(
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() };
}

async function create(extra: object = {}): Promise<Account> {
  const res = await call("POST", "/api/accounts", { ...fields, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

describe("adding an account (D1)", () => {
  it("saves it without a balance anchor", async () => {
    expect(await create()).toEqual({
      id: 1,
      ...fields,
      anchor: null,
      archivedOn: null,
      balance: null,
      transactionCount: 0,
    });
  });

  it("saves the optional anchor typed by hand, which is also the balance", async () => {
    const account = await create({
      anchor: { amount: "3,240.50", date: "2026-10-16" },
    });
    expect(account.anchor).toEqual({
      amount: 324050,
      date: "2026-10-16",
      source: "manual",
    });
    expect(account.balance).toEqual({ amount: 324050, date: "2026-10-16" });
  });

  it("ignores an anchor with no amount", async () => {
    expect(
      (await create({ anchor: { amount: " ", date: TODAY } })).anchor,
    ).toBeNull();
  });

  it("answers with every field's error", async () => {
    const res = await call("POST", "/api/accounts", {
      name: "",
      bank: "Bank A",
      type: "checking",
      currency: "EUR",
      anchor: { amount: "3.240,50", date: "2026-10-20" },
    });
    expect(res).toEqual({
      status: 400,
      body: {
        errors: {
          name: "Give the account a name.",
          anchorAmount:
            "Write the amount like 3,240.50, with a point for decimals.",
          anchorDate: "The date can't be in the future.",
        },
      },
    });
  });

  it("checks the anchor against the chosen currency", async () => {
    const res = await call("POST", "/api/accounts", {
      ...fields,
      currency: "JPY",
      anchor: { amount: "1,500.50", date: TODAY },
    });
    expect(res.body).toEqual({
      errors: { anchorAmount: "JPY amounts have no decimals." },
    });
  });

  it("refuses a name that's taken", async () => {
    await create();
    const res = await call("POST", "/api/accounts", {
      ...fields,
      name: "MAIN checking",
    });
    expect(res.body.errors.name).toBe(
      "You already have an account called MAIN checking.",
    );
  });

  it("rejects a malformed request before validating it", async () => {
    const res = await call("POST", "/api/accounts", { name: "Main checking" });
    expect(res).toEqual({
      status: 400,
      body: { error: "body must have required property 'bank'" },
    });
  });
});

describe("reading accounts", () => {
  it("lists every account, archived ones too, in the order they were added", async () => {
    await create();
    await create({ name: "Savings", type: "savings" });
    await create({ name: "US account", bank: "Bank C", currency: "USD" });
    await call("POST", "/api/accounts/2/archive");

    const { body } = await call("GET", "/api/accounts");
    expect(
      body.accounts.map((a: Account) => [a.name, a.currency, a.archivedOn]),
    ).toEqual([
      ["Main checking", "EUR", null],
      ["Savings", "EUR", TODAY],
      ["US account", "USD", null],
    ]);
  });

  it("has no transactions, and no balances to check, at first", async () => {
    await create();
    const res = await call("GET", "/api/accounts/1/transactions");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ transactions: [], gaps: [] });
  });

  it("finds one account, or answers 404", async () => {
    const account = await create();
    expect(await call("GET", "/api/accounts/1")).toEqual({
      status: 200,
      body: account,
    });
    expect((await call("GET", "/api/accounts/9")).status).toBe(404);
    expect((await call("GET", "/api/accounts/abc")).status).toBe(400);
  });
});

describe("editing an account (D1)", () => {
  it("saves the changed fields and keeps the anchor", async () => {
    await create({ anchor: { amount: "100", date: TODAY } });
    const res = await call("PATCH", "/api/accounts/1", {
      ...fields,
      name: "Checking",
      bank: "Bank B",
      type: "savings",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Checking",
      bank: "Bank B",
      type: "savings",
      anchor: { amount: 10000, date: TODAY },
    });
  });

  it("lets the account keep its own name", async () => {
    await create();
    expect((await call("PATCH", "/api/accounts/1", fields)).status).toBe(200);
  });

  it("keeps the anchor's written amount when the currency changes", async () => {
    await create({ anchor: { amount: "1,120.00", date: TODAY } });
    const usd = await call("PATCH", "/api/accounts/1", {
      ...fields,
      currency: "USD",
    });
    expect(usd.body.anchor.amount).toBe(112000);
    const jpy = await call("PATCH", "/api/accounts/1", {
      ...fields,
      currency: "JPY",
    });
    expect(jpy.body.anchor.amount).toBe(1120);
  });

  it("refuses a currency that can't hold the anchor", async () => {
    await create({ anchor: { amount: "1,120.50", date: TODAY } });
    const res = await call("PATCH", "/api/accounts/1", {
      ...fields,
      currency: "JPY",
    });
    expect(res).toEqual({
      status: 400,
      body: {
        errors: {
          currency:
            "The balance anchor, 1,120.50 €, can't be written exactly in JPY. Set the balance again first.",
        },
      },
    });
  });

  it("answers 404 for an unknown account", async () => {
    expect((await call("PATCH", "/api/accounts/9", fields)).status).toBe(404);
    const balance = { amount: "100", date: TODAY };
    for (const [method, url, payload] of [
      ["PUT", "/api/accounts/9/anchor", balance],
      ["POST", "/api/accounts/9/balance-checks", balance],
      ["POST", "/api/accounts/9/archive", undefined],
      ["POST", "/api/accounts/9/unarchive", undefined],
    ] as const) {
      expect((await call(method, url, payload)).status).toBe(404);
    }
  });

  it("explains a wrong edit", async () => {
    await create();
    const res = await call("PATCH", "/api/accounts/1", {
      ...fields,
      name: " ",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors)).toEqual(["name"]);
  });
});

describe("setting the balance (D2)", () => {
  it("replaces the anchor with the typed balance", async () => {
    await create({ anchor: { amount: "100", date: "2026-10-01" } });
    const res = await call("PUT", "/api/accounts/1/anchor", {
      amount: "3,250.50",
      date: "2026-10-17",
    });
    expect(res.body).toMatchObject({
      anchor: { amount: 325050, date: "2026-10-17", source: "manual" },
      balance: { amount: 325050, date: "2026-10-17" },
    });
  });

  it("explains a wrong balance", async () => {
    await create();
    const res = await call("PUT", "/api/accounts/1/anchor", {
      amount: "",
      date: "x",
    });
    expect(res).toEqual({
      status: 400,
      body: {
        errors: {
          anchorAmount: "Enter the balance.",
          anchorDate: "Enter a valid date.",
        },
      },
    });
  });
});

describe("archiving (D3)", () => {
  it("archives today and unarchives", async () => {
    await create();
    expect(
      (await call("POST", "/api/accounts/1/archive")).body.archivedOn,
    ).toBe(TODAY);
    expect(
      (await call("POST", "/api/accounts/1/unarchive")).body.archivedOn,
    ).toBeNull();
  });

  it("keeps the first date when archived twice", async () => {
    await create();
    await call("POST", "/api/accounts/1/archive");
    today = "2026-10-20";
    expect(
      (await call("POST", "/api/accounts/1/archive")).body.archivedOn,
    ).toBe(TODAY);
  });

  it("makes the account read-only", async () => {
    await create();
    await call("POST", "/api/accounts/1/archive");
    const edit = await call("PATCH", "/api/accounts/1", {
      ...fields,
      name: "X",
    });
    const balance = await call("PUT", "/api/accounts/1/anchor", {
      amount: "1",
      date: TODAY,
    });
    for (const res of [edit, balance]) {
      expect(res).toEqual({
        status: 409,
        body: { error: "This account is archived. Unarchive it to change it." },
      });
    }
  });
});
