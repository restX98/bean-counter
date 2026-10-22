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

const account = async (name: string) =>
  (
    await call("POST", "/api/accounts", {
      name,
      bank: "Bank A",
      type: name === "Savings" ? "savings" : "checking",
      currency: "EUR",
    })
  ).body.id as number;

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

interface Row {
  id: number;
  description: string;
  categoryId: number | null;
  transfer: { id: number; accountId: number; description: string } | null;
}
const ledger = async (accountId: number) =>
  (await call("GET", `/api/accounts/${accountId}/transactions`)).body
    .transactions as Row[];
const find = async (accountId: number, description: string) =>
  (await ledger(accountId)).find((t) => t.description === description)!;

/** Main checking with a transfer out to Savings and a grocery shop; Savings with the transfer in. */
async function twoAccounts() {
  const main = await account("Main checking");
  const savings = await account("Savings");
  await importRows(main, [
    "02/10/2026;ESSELUNGA MILANO;-56,30",
    "05/10/2026;TRANSFER TO SAVINGS;-500,00",
  ]);
  const result = await importRows(savings, [
    "06/10/2026;TRANSFER FROM CHECKING;500,00",
  ]);
  return { main, savings, result };
}

describe("linking transfers on import", () => {
  it("links the only candidate in another account, both ways", async () => {
    const { main, savings, result } = await twoAccounts();
    expect(result).toMatchObject({ imported: 1, linked: 1, categorized: 0 });

    const out = await find(main, "TRANSFER TO SAVINGS");
    const into = await find(savings, "TRANSFER FROM CHECKING");
    expect(out.transfer).toEqual({
      id: into.id,
      accountId: savings,
      date: "2026-10-06",
      amount: 50000,
      description: "TRANSFER FROM CHECKING",
    });
    expect(into.transfer).toMatchObject({ id: out.id, accountId: main });
    expect((await find(main, "ESSELUNGA MILANO")).transfer).toBeNull();
  });

  it("takes the rules' category away, and leaves transfers out of what waits for one", async () => {
    const { body: category } = await call("POST", "/api/categories", {
      name: "Savings",
      type: "expense",
    });
    await call("POST", "/api/rules", {
      match: "contains",
      text: "TRANSFER",
      accountId: null,
      min: "",
      max: "",
      currency: "EUR",
      categoryId: category.id,
    });
    const { main, result } = await twoAccounts();
    expect(result).toMatchObject({ linked: 1, categorized: 0 });
    expect((await find(main, "TRANSFER TO SAVINGS")).categoryId).toBeNull();

    const review = (await call("GET", "/api/review")).body;
    expect(
      review.uncategorized.map((t: { description: string }) => t.description),
    ).toEqual(["ESSELUNGA MILANO"]);
    expect((await call("GET", "/api/categories")).body.uncategorized).toBe(1);
  });

  it("doesn't link when one side has two candidates", async () => {
    const main = await account("Main checking");
    const savings = await account("Savings");
    await importRows(main, ["05/10/2026;TRANSFER TO SAVINGS;-500,00"]);
    const result = await importRows(savings, [
      "05/10/2026;TRANSFER FROM CHECKING;500,00",
      "07/10/2026;DEPOSIT;500,00",
    ]);
    expect(result.linked).toBe(0);
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).toBeNull();
  });

  it("leaves archived accounts alone", async () => {
    const main = await account("Main checking");
    await importRows(main, ["05/10/2026;TRANSFER TO SAVINGS;-500,00"]);
    await call("POST", `/api/accounts/${main}/archive`);
    const savings = await account("Savings");
    const result = await importRows(savings, [
      "06/10/2026;TRANSFER FROM CHECKING;500,00",
    ]);
    expect(result.linked).toBe(0);
  });
});

describe("a linked transfer", () => {
  it("has no category to set, by hand or by rules", async () => {
    const { main } = await twoAccounts();
    const { id } = await find(main, "TRANSFER TO SAVINGS");
    const { body: category } = await call("POST", "/api/categories", {
      name: "Savings",
      type: "expense",
    });
    const refused = {
      status: 409,
      body: {
        error: "It's a transfer, so it has no category. Unlink it first.",
      },
    };
    expect(
      await call("PUT", `/api/transactions/${id}/category`, {
        categoryId: category.id,
      }),
    ).toEqual(refused);
    expect(await call("POST", `/api/transactions/${id}/apply-rules`)).toEqual(
      refused,
    );
  });

  it("unlinks for good: both sides become uncategorized, and stay apart", async () => {
    const { main, savings } = await twoAccounts();
    const { id } = await find(main, "TRANSFER TO SAVINGS");
    expect(await call("POST", `/api/transactions/${id}/unlink`)).toEqual({
      status: 204,
      body: null,
    });
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).toBeNull();
    expect((await find(savings, "TRANSFER FROM CHECKING")).transfer).toBeNull();
    expect((await call("GET", "/api/review")).body.count).toBe(3);

    // Another import doesn't link them again.
    const card = await account("Card account");
    expect((await importRows(card, ["08/10/2026;COFFEE;-1,20"])).linked).toBe(
      0,
    );
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).toBeNull();

    expect(await call("POST", `/api/transactions/${id}/unlink`)).toEqual({
      status: 409,
      body: { error: "It isn't linked." },
    });
    expect((await call("POST", "/api/transactions/99/unlink")).status).toBe(
      404,
    );
  });

  it("can't be unlinked while one side's account is archived", async () => {
    const { main, savings } = await twoAccounts();
    await call("POST", `/api/accounts/${savings}/archive`);
    const { id } = await find(main, "TRANSFER TO SAVINGS");
    expect(await call("POST", `/api/transactions/${id}/unlink`)).toEqual({
      status: 409,
      body: {
        error: "One side is in an archived account. Unarchive it first.",
      },
    });
  });

  it("loses its other side when one is excluded", async () => {
    const { main, savings } = await twoAccounts();
    const { id } = await find(main, "TRANSFER TO SAVINGS");
    await call("POST", `/api/transactions/${id}/exclude`);
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).toBeNull();
    expect((await find(savings, "TRANSFER FROM CHECKING")).transfer).toBeNull();
  });
});
