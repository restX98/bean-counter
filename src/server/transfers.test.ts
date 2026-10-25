import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-19" });
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
      time: null,
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

  it("undoes with the category it had, unless it was deleted since", async () => {
    const { main, out, fromChecking } = await toPick();
    const { body: category } = await call("POST", "/api/categories", {
      name: "Rent",
      type: "expense",
    });
    await call("PUT", `/api/transactions/${out}/category`, {
      categoryId: category.id,
    });
    const link = () =>
      call("POST", `/api/transactions/${out}/link`, { otherId: fromChecking });
    await call("POST", "/api/transfers/undo", (await link()).body);
    expect(await find(main, "TRANSFER TO SAVINGS")).toMatchObject({
      transfer: null,
      categoryId: category.id,
    });

    const { body: change } = await link();
    expect(change.before).toContainEqual({
      id: out,
      categoryId: category.id,
      ruleId: null,
    });
    expect(
      (await call("DELETE", `/api/categories/${category.id}`)).status,
    ).toBe(204);
    await call("POST", "/api/transfers/undo", change);
    // A second Undo finds the pair unlinked already, and changes nothing.
    await call("POST", "/api/transfers/undo", change);
    expect(await find(main, "TRANSFER TO SAVINGS")).toMatchObject({
      transfer: null,
      categoryId: null,
    });
  });

  it("links from the money coming in too", async () => {
    const { out, fromChecking, savings } = await toPick();
    const { status, body: change } = await call(
      "POST",
      `/api/transactions/${fromChecking}/link`,
      { otherId: out },
    );
    expect(status).toBe(200);
    // The pair is written money out first, whichever side I started from.
    expect(change.linked).toEqual([[out, fromChecking]]);
    expect(
      (await find(savings, "TRANSFER FROM CHECKING")).transfer,
    ).toMatchObject({ id: out });
  });

  it("answers 404 for a transaction that doesn't exist", async () => {
    expect(
      (await call("POST", "/api/transactions/99/link", { otherId: 1 })).status,
    ).toBe(404);
    expect(
      (await call("POST", "/api/transactions/99/not-a-transfer")).status,
    ).toBe(404);
  });

  it("can't link a transaction in an archived account", async () => {
    const { out, fromChecking, savings } = await toPick();
    await call("POST", `/api/accounts/${savings}/archive`);
    expect(
      await call("POST", `/api/transactions/${fromChecking}/link`, {
        otherId: out,
      }),
    ).toEqual({
      status: 409,
      body: { error: "This account is archived. Unarchive it to change it." },
    });
  });
});

/** 200.00 € out of Main checking, and 218.00 $ into the US account the next day. */
async function exchange() {
  const main = await account("Main checking");
  const { body: us } = await call("POST", "/api/accounts", {
    name: "US account",
    bank: "Bank B",
    type: "checking",
    currency: "USD",
  });
  await importRows(main, ["28/09/2026;EXCHANGE TO USD;-200,00"]);
  await importRows(us.id, ["29/09/2026;FROM EUR;218,00"]);
  return {
    main,
    us: us.id as number,
    out: (await find(main, "EXCHANGE TO USD")).id,
    into: (await find(us.id, "FROM EUR")).id,
  };
}

describe("an exchange between currencies", () => {
  it("is suggested in Review, never linked on its own", async () => {
    const { us, out, into } = await exchange();
    const { exchanges, uncategorized, count } = await review();
    expect(exchanges).toEqual([
      {
        id: out,
        accountId: expect.any(Number),
        date: "2026-09-28",
        time: null,
        amount: -20000,
        currency: "EUR",
        description: "EXCHANGE TO USD",
        other: {
          id: into,
          accountId: us,
          date: "2026-09-29",
          time: null,
          amount: 21800,
          description: "FROM EUR",
        },
      },
    ]);
    // Still normal transactions, waiting for a category too.
    expect(uncategorized).toHaveLength(2);
    expect(count).toBe(3);
  });

  it("links when I confirm it", async () => {
    const { us, out, into } = await exchange();
    const { status } = await call("POST", `/api/transactions/${out}/link`, {
      otherId: into,
    });
    expect(status).toBe(200);
    expect((await find(us, "FROM EUR")).transfer).toMatchObject({ id: out });
    expect((await review()).count).toBe(0);
  });

  it("isn't suggested again once I say it isn't one, until Undo", async () => {
    const { out, into } = await exchange();
    const { body: change } = await call(
      "POST",
      `/api/transactions/${out}/not-a-transfer`,
      { otherId: into },
    );
    expect(change).toEqual({
      linked: [],
      dismissed: [[out, into]],
      before: [],
    });
    expect((await review()).exchanges).toEqual([]);
    await call("POST", "/api/transfers/undo", change);
    expect((await review()).exchanges).toHaveLength(1);
  });

  it("waits while either side has candidates in its own currency", async () => {
    const { main } = await exchange();
    const savings = await account("Savings");
    await importRows(main, ["28/09/2026;TRANSFER TO SAVINGS;-200,00"]);
    await importRows(savings, [
      "28/09/2026;FROM CHECKING;200,00",
      "29/09/2026;FROM CHECKING;200,00",
    ]);
    // EXCHANGE TO USD and TRANSFER TO SAVINGS could both go to Savings.
    expect((await review()).exchanges).toEqual([]);
  });
});

describe("the transfer window (S18)", () => {
  it("is 3 days until I change it", async () => {
    expect((await call("GET", "/api/settings")).body).toEqual({
      transferWindow: 3,
      lastBackup: null,
    });
  });

  it("links what a wider window brings in, and keeps the setting", async () => {
    const main = await account("Main checking");
    const savings = await account("Savings");
    await importRows(main, ["05/10/2026;TRANSFER TO SAVINGS;-500,00"]);
    // Five days later: outside the window.
    await importRows(savings, ["10/10/2026;TRANSFER FROM CHECKING;500,00"]);
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).toBeNull();

    expect(
      await call("PATCH", "/api/settings", { transferWindow: "5" }),
    ).toEqual({ status: 200, body: { transferWindow: 5, linked: 1 } });
    expect((await find(main, "TRANSFER TO SAVINGS")).transfer).not.toBeNull();
    expect((await call("GET", "/api/settings")).body).toEqual({
      transferWindow: 5,
      lastBackup: null,
    });
  });

  it("refuses what isn't whole days from 0 to 30", async () => {
    expect(
      await call("PATCH", "/api/settings", { transferWindow: "31" }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          transferWindow: "Enter a whole number of days, from 0 to 30.",
        },
      },
    });
  });
});
