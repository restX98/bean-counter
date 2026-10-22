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

/** Main checking's 500.00 to Savings, which got 500.00 twice that week. */
async function toPick() {
  const main = await account("Main checking");
  const savings = await account("Savings");
  await importRows(main, ["05/10/2026;TRANSFER TO SAVINGS;-500,00"]);
  const result = await importRows(savings, [
    "05/10/2026;TRANSFER FROM CHECKING;500,00",
    "07/10/2026;DEPOSIT;500,00",
  ]);
  const id = async (accountId: number, description: string) =>
    (await find(accountId, description)).id;
  return {
    main,
    savings,
    result,
    out: await id(main, "TRANSFER TO SAVINGS"),
    fromChecking: await id(savings, "TRANSFER FROM CHECKING"),
    deposit: await id(savings, "DEPOSIT"),
  };
}

const review = async () => (await call("GET", "/api/review")).body;

describe("a transfer to pick", () => {
  it("waits in Review with its candidates, not as uncategorized", async () => {
    const { result, out, fromChecking, deposit, main, savings } =
      await toPick();
    expect(result).toMatchObject({ linked: 0, toPick: 2 });
    const { transfers, uncategorized, count } = await review();
    expect(transfers).toEqual([
      {
        id: out,
        date: "2026-10-05",
        time: null,
        description: "TRANSFER TO SAVINGS",
        amount: -50000,
        accountId: expect.any(Number),
        currency: "EUR",
        candidates: [
          expect.objectContaining({ id: fromChecking, accountId: savings }),
          expect.objectContaining({ id: deposit, description: "DEPOSIT" }),
        ],
      },
    ]);
    expect(uncategorized).toEqual([]);
    expect(count).toBe(1);
    expect(
      (await ledger(savings)).map(
        (t) => (t as Row & { toPick: object | null }).toPick,
      ),
    ).toEqual([
      { count: 1, accountIds: [main] },
      { count: 1, accountIds: [main] },
    ]);
  });

  it("offers its candidates, then other currencies, to link by hand", async () => {
    const { out, fromChecking, deposit } = await toPick();
    const { body: us } = await call("POST", "/api/accounts", {
      name: "US account",
      bank: "Bank B",
      type: "checking",
      currency: "USD",
    });
    await importRows(us.id, ["06/10/2026;FROM EUR;545,00"]);
    const { body } = await call("GET", `/api/transactions/${out}/link-options`);
    expect(body.window).toBe(3);
    expect(body.options.map((o: { id: number }) => o.id)).toEqual([
      fromChecking,
      deposit,
      (await find(us.id, "FROM EUR")).id,
    ]);
  });

  it("links the one I pick, and Undo puts it back", async () => {
    const { out, fromChecking, deposit, savings } = await toPick();
    const { status, body: change } = await call(
      "POST",
      `/api/transactions/${out}/link`,
      { otherId: fromChecking },
    );
    expect(status).toBe(200);
    expect(change).toEqual({
      linked: [[out, fromChecking]],
      dismissed: [],
      before: expect.arrayContaining([
        { id: out, categoryId: null, ruleId: null },
      ]),
    });
    expect(
      (await find(savings, "TRANSFER FROM CHECKING")).transfer,
    ).toMatchObject({ id: out });
    // DEPOSIT is a normal transaction again.
    let waiting = await review();
    expect(waiting.transfers).toEqual([]);
    expect(waiting.uncategorized.map((t: Row) => t.id)).toEqual([deposit]);

    expect(await call("POST", "/api/transfers/undo", change)).toEqual({
      status: 204,
      body: null,
    });
    waiting = await review();
    expect(waiting.transfers.map((t: Row) => t.id)).toEqual([out]);
    expect((await find(savings, "TRANSFER FROM CHECKING")).transfer).toBeNull();
  });

  it("links what's left on its own after a pick", async () => {
    // The same 500.00 transfer, twice on the same day.
    const main = await account("Main checking");
    const savings = await account("Savings");
    await importRows(main, [
      "05/10/2026;TRANSFER TO SAVINGS;-500,00",
      "05/10/2026;TRANSFER TO SAVINGS;-500,00",
    ]);
    await importRows(savings, [
      "05/10/2026;TRANSFER FROM CHECKING;500,00",
      "05/10/2026;TRANSFER FROM CHECKING;500,00",
    ]);
    const [a, b] = await ledger(main);
    const [c, d] = await ledger(savings);
    const { body: change } = await call(
      "POST",
      `/api/transactions/${a!.id}/link`,
      { otherId: c!.id },
    );
    expect(change.linked).toEqual([
      [a!.id, c!.id],
      [b!.id, d!.id],
    ]);
    expect((await review()).count).toBe(0);
  });

  it("isn't a transfer when I say so, and the rest may link on its own", async () => {
    const { out, fromChecking, deposit, savings } = await toPick();
    // DEPOSIT came from someone else: what's left is a pair.
    const { body: change } = await call(
      "POST",
      `/api/transactions/${deposit}/not-a-transfer`,
    );
    expect(change).toMatchObject({
      dismissed: [[out, deposit]],
      linked: [[out, fromChecking]],
    });
    expect((await find(savings, "DEPOSIT")).transfer).toBeNull();
    expect((await review()).uncategorized.map((t: Row) => t.id)).toEqual([
      deposit,
    ]);

    await call("POST", "/api/transfers/undo", change);
    expect((await review()).transfers.map((t: Row) => t.id)).toEqual([out]);
  });

  it("refuses what can't be linked", async () => {
    const { out, fromChecking, deposit } = await toPick();
    // Not with itself: it's in the same account.
    expect(
      await call("POST", `/api/transactions/${out}/link`, { otherId: out }),
    ).toEqual({
      status: 409,
      body: { error: "These two can't be linked any more. Pick another one." },
    });
    await call("POST", `/api/transactions/${out}/link`, {
      otherId: fromChecking,
    });
    expect(
      await call("POST", `/api/transactions/${deposit}/link`, {
        otherId: out,
      }),
    ).toEqual({
      status: 409,
      body: { error: "These two can't be linked any more. Pick another one." },
    });
    expect(
      await call("POST", `/api/transactions/${out}/link`, {
        otherId: deposit,
      }),
    ).toEqual({ status: 409, body: { error: "It's already linked." } });
    expect(
      await call("POST", `/api/transactions/${deposit}/not-a-transfer`),
    ).toEqual({
      status: 409,
      body: {
        error: "Nothing in your other accounts could be its other side.",
      },
    });
    await call("POST", `/api/transactions/${deposit}/exclude`);
    expect(
      (await call("GET", `/api/transactions/${deposit}/link-options`)).body,
    ).toEqual({ error: "It's excluded. Restore it to link it." });
  });
});
