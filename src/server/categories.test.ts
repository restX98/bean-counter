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
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

const add = (name: string, type = "expense") =>
  call("POST", "/api/categories", { name, type });
const list = async () => (await call("GET", "/api/categories")).body;

/** An account with three imported transactions; returns their ids. */
async function imported(): Promise<number[]> {
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
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .all()
    .map((t) => t.id);
}

const categorize = (transaction: number, category: number) =>
  db
    .update(transactions)
    .set({ categoryId: category })
    .where(eq(transactions.id, transaction))
    .run();

describe("categories (S16, D5)", () => {
  it("starts with none", async () => {
    expect(await list()).toEqual({ categories: [], uncategorized: 0 });
  });

  it("adds one, tidying its name", async () => {
    const { status, body } = await add("  Eating   out ");
    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(Number),
      name: "Eating out",
      type: "expense",
      transactionCount: 0,
      ruleCount: 0,
    });
    expect((await list()).categories).toEqual([body]);
  });

  it("refuses a missing name, a wrong type and a name already used", async () => {
    expect(await add("", "transfer")).toEqual({
      status: 400,
      body: {
        errors: {
          name: "Give the category a name.",
          type: "Pick income or expense.",
        },
      },
    });
    await add("Refunds", "income");
    expect((await add("REFUNDS")).body).toEqual({
      errors: { name: "You already have a category called REFUNDS." },
    });
  });

  it("renames one or changes its type, keeping its own name free", async () => {
    const { body: groceries } = await add("Groceries");
    await add("Rent");
    const rename = (name: string, type = "expense") =>
      call("PATCH", `/api/categories/${groceries.id}`, { name, type });

    expect((await rename("groceries", "income")).body).toMatchObject({
      name: "groceries",
      type: "income",
    });
    expect((await rename("Rent")).status).toBe(400);
    expect(
      (await call("PATCH", "/api/categories/99", { name: "X", type: "income" }))
        .status,
    ).toBe(404);
  });

  it("counts each one's transactions, and the counted ones without", async () => {
    const [, groceries, savings] = await imported();
    const { body: food } = await add("Groceries");
    categorize(groceries!, food.id);
    expect(await list()).toMatchObject({
      categories: [{ name: "Groceries", transactionCount: 1 }],
      uncategorized: 2,
    });

    // An excluded transaction doesn't need a category.
    await call("POST", `/api/transactions/${savings}/exclude`);
    expect((await list()).uncategorized).toBe(1);
  });

  it("deletes one that nothing uses, and refuses one in use without a choice", async () => {
    const [, groceries] = await imported();
    const { body: unused } = await add("Gifts");
    const { body: used } = await add("Groceries");
    categorize(groceries!, used.id);

    expect((await call("DELETE", `/api/categories/${unused.id}`)).status).toBe(
      204,
    );
    expect(await call("DELETE", `/api/categories/${used.id}`)).toEqual({
      status: 409,
      body: {
        error: "1 transaction uses this category. Say where it goes first.",
      },
    });
    expect((await list()).categories).toMatchObject([{ name: "Groceries" }]);
    expect((await call("DELETE", `/api/categories/${unused.id}`)).status).toBe(
      404,
    );
  });

  it("moves its transactions to another category", async () => {
    const [salary, groceries] = await imported();
    const { body: food } = await add("Food");
    const { body: groceriesCategory } = await add("Groceries");
    categorize(salary!, food.id);
    categorize(groceries!, food.id);

    expect(
      (
        await call("DELETE", `/api/categories/${food.id}`, {
          moveTo: groceriesCategory.id,
        })
      ).status,
    ).toBe(204);
    expect(await list()).toMatchObject({
      categories: [{ name: "Groceries", transactionCount: 2 }],
      uncategorized: 1,
    });
  });

  it("leaves its transactions uncategorized", async () => {
    const [, groceries] = await imported();
    const { body: food } = await add("Food");
    categorize(groceries!, food.id);

    expect(
      (await call("DELETE", `/api/categories/${food.id}`, { moveTo: null }))
        .status,
    ).toBe(204);
    expect(await list()).toEqual({ categories: [], uncategorized: 3 });
  });

  it("refuses to move them to itself or to a category that doesn't exist", async () => {
    const [, groceries] = await imported();
    const { body: food } = await add("Food");
    categorize(groceries!, food.id);
    for (const moveTo of [food.id, 99]) {
      expect(
        await call("DELETE", `/api/categories/${food.id}`, { moveTo }),
      ).toEqual({
        status: 400,
        body: { error: "Pick another category to move them to." },
      });
    }
    expect((await list()).categories).toHaveLength(1);
  });
});
