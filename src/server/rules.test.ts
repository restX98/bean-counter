import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase, type Db } from "./db/index.ts";
import { transactions } from "./db/schema.ts";

let db: Db;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  db = openDatabase(":memory:");
  app = buildApp({ db, today: () => "2026-10-19" });
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

const category = async (name: string, type = "expense") =>
  (await call("POST", "/api/categories", { name, type })).body.id as number;

const fields = (categoryId: number | null, more: object = {}) => ({
  match: "contains",
  text: "ESSELUNGA",
  accountId: null,
  min: "",
  max: "",
  currency: "EUR",
  categoryId,
  ...more,
});
const add = (categoryId: number | null, more: object = {}) =>
  call("POST", "/api/rules", fields(categoryId, more));
const list = async () => (await call("GET", "/api/rules")).body;

/** An account with three imported transactions; returns their ids. */
async function imported(): Promise<{ account: number; ids: number[] }> {
  const { body: account } = await call("POST", "/api/accounts", {
    name: "Main checking",
    bank: "Bank A",
    type: "checking",
    currency: "EUR",
  });
  const text = [
    "Data;Descrizione;Importo;Saldo",
    "01/10/2026;SALARY ACME SPA;2.000,00;3.240,50",
    "02/10/2026;ESSELUNGA MILANO;-56,30;3.184,20",
    "05/10/2026;TRANSFER TO SAVINGS;-500,00;2.684,20",
  ].join("\n");
  const upload = await app.inject({
    method: "POST",
    url: `/api/imports?account=${account.id}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(text),
  });
  await call("POST", `/api/imports/${upload.json().id}/save`, {
    mapping: {
      roles: ["date", "description", "amount", "balance"],
      dateFormat: "DD/MM/YYYY",
      decimalMark: "comma",
    },
    presetName: null,
  });
  const ids = db
    .select({ id: transactions.id })
    .from(transactions)
    .all()
    .map((t) => t.id);
  return { account: account.id, ids };
}

describe("rules (S17, D6)", () => {
  it("starts with none", async () => {
    expect(await list()).toEqual({ rules: [], conflicts: 0 });
  });

  it("adds one and lists it", async () => {
    const groceries = await category("Groceries");
    const { status, body } = await add(groceries, { text: " esselunga " });
    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(Number),
      match: "contains",
      text: "esselunga",
      accountId: null,
      amount: null,
      categoryId: groceries,
    });
    expect((await list()).rules).toEqual([
      { ...body, matches: 0, overlaps: [] },
    ]);
  });

  it("keeps amount bounds in the account's currency", async () => {
    const { account } = await imported();
    const eating = await category("Eating out");
    const { body } = await add(eating, {
      text: "SATISPAY",
      accountId: account,
      currency: "USD",
      max: "10",
    });
    expect(body).toMatchObject({
      accountId: account,
      amount: { currency: "EUR", min: null, max: 1000 },
    });
  });

  it("explains what's wrong with the form", async () => {
    expect(
      await add(99, { match: "regex", text: "AMAZON (", min: "5", max: "1" }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          text: "That isn't a valid regular expression.",
          categoryId: "Pick a category.",
          max: "Make it more than the lower amount.",
        },
      },
    });
  });

  it("edits and deletes one", async () => {
    const groceries = await category("Groceries");
    const shopping = await category("Shopping");
    const { body: rule } = await add(groceries);

    const { body } = await call(
      "PATCH",
      `/api/rules/${rule.id}`,
      fields(shopping, { text: "AMAZON" }),
    );
    expect(body).toMatchObject({ text: "AMAZON", categoryId: shopping });
    expect(
      (await call("PATCH", "/api/rules/99", fields(shopping))).status,
    ).toBe(404);

    expect((await call("DELETE", `/api/rules/${rule.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/rules/${rule.id}`)).status).toBe(404);
    expect((await list()).rules).toEqual([]);
  });

  it("flags rules that overlap, and counts the transactions they can't decide", async () => {
    await imported();
    const shopping = await category("Shopping");
    const digital = await category("Digital");
    const groceries = await category("Groceries");
    const { body: amazon } = await add(shopping, { text: "AMAZON" });
    const { body: prime } = await add(digital, { text: "AMAZON PRIME" });
    const { body: esselunga } = await add(groceries);
    const { body: milano } = await add(shopping, { text: "MILANO" });

    const { rules, conflicts } = await list();
    const overlaps = Object.fromEntries(
      rules.map((r: { id: number; overlaps: number[] }) => [r.id, r.overlaps]),
    );
    expect(overlaps).toEqual({
      [amazon.id]: [prime.id],
      [prime.id]: [amazon.id],
      // Only ESSELUNGA MILANO shows these two meet.
      [esselunga.id]: [milano.id],
      [milano.id]: [esselunga.id],
    });
    expect(conflicts).toBe(1);
  });

  it("counts the transactions each rule categorized, until I change them", async () => {
    const { ids } = await imported();
    const groceries = await category("Groceries");
    const { body: rule } = await add(groceries);
    const [, esselunga] = ids;
    db.update(transactions)
      .set({ categoryId: groceries, ruleId: rule.id })
      .where(eq(transactions.id, esselunga!))
      .run();
    expect((await list()).rules[0].matches).toBe(1);

    await call("PUT", `/api/transactions/${esselunga}/category`, {
      categoryId: groceries,
    });
    expect((await list()).rules[0].matches).toBe(0);
  });

  it("leaves the categories it gave when it's deleted", async () => {
    const { ids } = await imported();
    const groceries = await category("Groceries");
    const { body: rule } = await add(groceries);
    const [, esselunga] = ids;
    db.update(transactions)
      .set({ categoryId: groceries, ruleId: rule.id })
      .where(eq(transactions.id, esselunga!))
      .run();

    await call("DELETE", `/api/rules/${rule.id}`);
    expect(
      db
        .select({
          categoryId: transactions.categoryId,
          ruleId: transactions.ruleId,
        })
        .from(transactions)
        .where(eq(transactions.id, esselunga!))
        .get(),
    ).toEqual({ categoryId: groceries, ruleId: null });
  });
});

describe("deleting a category with rules (D5)", () => {
  it("asks where they go, then moves them along", async () => {
    const food = await category("Food");
    const groceries = await category("Groceries");
    await add(food);
    expect(
      (await call("GET", "/api/categories")).body.categories,
    ).toMatchObject([{ name: "Food", ruleCount: 1 }, { ruleCount: 0 }]);
    expect(await call("DELETE", `/api/categories/${food}`)).toEqual({
      status: 409,
      body: { error: "1 rule gives it. Say where it goes first." },
    });

    await call("DELETE", `/api/categories/${food}`, { moveTo: groceries });
    expect((await list()).rules).toMatchObject([{ categoryId: groceries }]);
  });

  it("deletes them when its transactions become uncategorized", async () => {
    const food = await category("Food");
    await add(food);
    await add(food, { text: "LIDL" });
    await call("DELETE", `/api/categories/${food}`, { moveTo: null });
    expect((await list()).rules).toEqual([]);
  });
});
