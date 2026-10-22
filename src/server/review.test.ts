import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-19" });
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

const category = async (name: string) =>
  (await call("POST", "/api/categories", { name, type: "expense" })).body
    .id as number;
const rule = async (text: string, categoryId: number, more: object = {}) =>
  (
    await call("POST", "/api/rules", {
      match: "contains",
      text,
      accountId: null,
      min: "",
      max: "",
      currency: "EUR",
      categoryId,
      ...more,
    })
  ).body.id as number;

const FOUR = [
  "01/10/2026;SALARY ACME SPA;2.000,00;3.240,50",
  "02/10/2026;AMAZON PRIME;-4,99;3.235,51",
  "03/10/2026;AMAZON EU SARL;-34,90;3.200,61",
  "04/10/2026;PHARMACY 24;-18,50;3.182,11",
];

/** An account with imported transactions; returns their ids by description. */
async function imported(name = "Main checking", rows = FOUR) {
  const { body: account } = await call("POST", "/api/accounts", {
    name,
    bank: "Bank A",
    type: "checking",
    currency: "EUR",
  });
  const text = ["Data;Descrizione;Importo;Saldo", ...rows].join("\n");
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
  const { body } = await call(
    "GET",
    `/api/accounts/${account.id}/transactions`,
  );
  const ids: Record<string, number> = Object.fromEntries(
    body.transactions.map((t: { description: string; id: number }) => [
      t.description,
      t.id,
    ]),
  );
  return { account: account.id as number, ids };
}

const review = async () => (await call("GET", "/api/review")).body;
const descriptions = (list: { description: string }[]) =>
  list.map((t) => t.description);

describe("the Review list (S2)", () => {
  it("starts empty", async () => {
    expect(await review()).toEqual({
      uncategorized: [],
      conflicts: [],
      mismatches: [],
      count: 0,
    });
  });

  it("lists what waits for a category, newest first, and the conflicts apart", async () => {
    const shopping = await category("Shopping");
    const digital = await category("Digital");
    await rule("AMAZON", shopping);
    await rule("AMAZON", digital, { max: "15" });
    const { ids } = await imported();

    const { uncategorized, conflicts, count } = await review();
    expect(descriptions(uncategorized)).toEqual([
      "PHARMACY 24",
      "SALARY ACME SPA",
    ]);
    expect(uncategorized[0]).toEqual({
      id: ids["PHARMACY 24"],
      date: "2026-10-04",
      time: null,
      description: "PHARMACY 24",
      amount: -1850,
      accountId: expect.any(Number),
      currency: "EUR",
      suggestion: null,
    });
    expect(conflicts).toMatchObject([
      { description: "AMAZON PRIME", categoryIds: [shopping, digital] },
    ]);
    expect(count).toBe(3);
  });

  it("leaves out excluded transactions and archived accounts", async () => {
    const { ids } = await imported();
    await call("POST", `/api/transactions/${ids["PHARMACY 24"]}/exclude`);
    const { uncategorized, mismatches } = await review();
    expect(descriptions(uncategorized)).not.toContain("PHARMACY 24");
    // The bank's balances still include it.
    expect(mismatches).toMatchObject([{ amount: -1850 }]);

    const { account } = await imported("Old account");
    await call("POST", `/api/accounts/${account}/archive`);
    expect((await review()).count).toBe(4);
  });

  it("lists each place where an account's balances and the bank's part ways", async () => {
    // The bank's balance is 10.00 lower from the 3rd: something it took out
    // that day isn't in the file.
    const { account } = await imported("Main checking", [
      ...FOUR.slice(0, 2),
      "03/10/2026;AMAZON EU SARL;-34,90;3.190,61",
      "04/10/2026;PHARMACY 24;-18,50;3.172,11",
    ]);
    const { mismatches, count } = await review();
    expect(mismatches).toEqual([
      {
        accountId: account,
        currency: "EUR",
        index: 0,
        after: "2026-10-02",
        until: "2026-10-03",
        amount: -1000,
        balances: {
          after: { app: 322551, bank: 323551 },
          until: { app: 319061, bank: 319061 },
        },
      },
    ]);
    expect(count).toBe(5);

    await call("POST", `/api/accounts/${account}/archive`);
    expect(await review()).toMatchObject({ mismatches: [], count: 0 });
  });

  it("suggests the category a rule would give now, and Use it takes it", async () => {
    const { ids } = await imported();
    const shopping = await category("Shopping");
    // Saved without applying it.
    const amazon = await rule("AMAZON", shopping);
    const { uncategorized } = await review();
    expect(
      uncategorized.find(
        (t: { description: string }) => t.description === "AMAZON PRIME",
      ).suggestion,
    ).toEqual({ categoryId: shopping, ruleId: amazon });

    const prime = ids["AMAZON PRIME"];
    expect(
      await call("POST", `/api/transactions/${prime}/apply-rules`),
    ).toEqual({ status: 200, body: { categoryId: shopping, ruleId: amazon } });
    expect(descriptions((await review()).uncategorized)).not.toContain(
      "AMAZON PRIME",
    );
    expect(
      (await call("POST", `/api/transactions/${prime}/apply-rules`)).body,
    ).toEqual({ error: "It already has a category." });
  });

  it("refuses Use it when no rule gives a category any more", async () => {
    const { ids } = await imported();
    expect(
      await call("POST", `/api/transactions/${ids["PHARMACY 24"]}/apply-rules`),
    ).toEqual({
      status: 409,
      body: {
        error: "No rule gives it a category any more. Pick one instead.",
      },
    });
    expect(
      (await call("POST", "/api/transactions/99/apply-rules")).status,
    ).toBe(404);
  });
});
