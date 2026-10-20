import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-19" });
  return () => app.close();
});

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() };
}

async function addAccount(extra: object = {}): Promise<number> {
  const res = await call("POST", "/api/accounts", {
    name: "Main checking",
    bank: "Bank A",
    type: "checking",
    currency: "EUR",
    ...extra,
  });
  return res.body.id;
}

async function upload(account: number, text: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/imports?account=${account}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(text),
  });
  return { status: res.statusCode, body: res.json() };
}

const statement = (groceries = "ESSELUNGA MILANO") =>
  [
    "Data;Descrizione;Importo;Saldo",
    "01/10/2026;SALARY ACME SPA;2.000,00;3.240,50",
    `02/10/2026;${groceries};-56,30;3.184,20`,
    "05/10/2026;TRANSFER TO SAVINGS;-500,00;2.684,20",
    "Saldo finale;;;2.684,20",
  ].join("\n");

const mapping = {
  roles: ["date", "description", "amount", "balance"],
  dateFormat: "DD/MM/YYYY",
  decimalMark: "comma",
};
const noBalance = {
  ...mapping,
  roles: ["date", "description", "amount", "ignore"],
};

/** Uploads a statement and saves it with the mapping. */
async function importStatement(
  account: number,
  text = statement(),
  body: object = {},
) {
  const { body: file } = await upload(account, text);
  return call("POST", `/api/imports/${file.id}/save`, {
    mapping,
    presetName: "Bank A · checking",
    ...body,
  });
}

describe("uploading a file (S7)", () => {
  it("sends back its columns and first rows", async () => {
    const { status, body } = await upload(await addAccount(), statement());
    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(String),
      fileName: "statement.csv",
      columns: ["Data", "Descrizione", "Importo", "Saldo"],
      rowCount: 4,
      sample: expect.arrayContaining([
        {
          line: 2,
          cells: ["01/10/2026", "SALARY ACME SPA", "2.000,00", "3.240,50"],
        },
      ]),
      preset: null,
    });
    expect(body.sample).toHaveLength(4);
  });

  it("refuses a file it can't read", async () => {
    const res = await upload(await addAccount(), "%PDF-1.7\n");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^This isn't a CSV or Excel file\./);
  });

  it("refuses an unknown or archived account", async () => {
    expect((await upload(9, statement())).status).toBe(404);
    const id = await addAccount();
    await call("POST", `/api/accounts/${id}/archive`);
    expect(await upload(id, statement())).toEqual({
      status: 409,
      body: {
        error: "This account is archived. Unarchive it to import into it.",
      },
    });
  });
});

describe("previewing an import (S8, S9)", () => {
  it("shows what each row would become, and the unreadable ones", async () => {
    const { body: file } = await upload(await addAccount(), statement());
    const { status, body } = await call(
      "POST",
      `/api/imports/${file.id}/preview`,
      {
        mapping,
      },
    );
    expect(status).toBe(200);
    expect(body.rows.map((r: { status: string }) => r.status)).toEqual([
      "new",
      "new",
      "new",
    ]);
    expect(body.unreadable).toEqual([
      {
        line: 5,
        problems: [
          `Data: "Saldo finale" isn't a DD/MM/YYYY date.`,
          "Importo is empty.",
        ],
      },
    ]);
    expect(body).toMatchObject({
      needsBalance: false,
      anchor: { amount: 268420, date: "2026-10-05", source: "statement" },
      gaps: [],
    });
  });

  it("names what the mapping is missing", async () => {
    const { body: file } = await upload(await addAccount(), statement());
    expect(
      await call("POST", `/api/imports/${file.id}/preview`, {
        mapping: {
          ...mapping,
          roles: ["ignore", "ignore", "ignore", "ignore"],
        },
      }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          mapping:
            "Pick the Date column. Pick the Amount column, or the Debit and Credit columns. Pick a Description column.",
        },
      },
    });
  });

  it("asks to choose the file again once it's gone", async () => {
    expect(
      await call("POST", "/api/imports/no-such-file/preview", { mapping }),
    ).toEqual({
      status: 404,
      body: { error: "This file is no longer open. Choose it again." },
    });
  });
});

describe("saving an import", () => {
  it("saves the transactions and takes the anchor from the file", async () => {
    const id = await addAccount();
    expect(await importStatement(id)).toEqual({
      status: 201,
      body: {
        importId: 1,
        imported: 3,
        skipped: 0,
        unreadable: 1,
        leftOut: 0,
        anchor: { amount: 268420, date: "2026-10-05", source: "statement" },
        gaps: [],
      },
    });
    const { body: account } = await call("GET", `/api/accounts/${id}`);
    expect(account).toMatchObject({
      anchor: { amount: 268420, date: "2026-10-05", source: "statement" },
      balance: { amount: 268420, date: "2026-10-05" },
    });
  });

  it("recognises the format and skips duplicates the second time", async () => {
    const id = await addAccount();
    await importStatement(id);
    const { body: file } = await upload(id, statement());
    expect(file.preset).toEqual({ id: 1, name: "Bank A · checking", mapping });

    const preview = await call("POST", `/api/imports/${file.id}/preview`, {
      mapping,
    });
    expect(preview.body.rows.map((r: { status: string }) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(await importStatement(id)).toMatchObject({
      status: 201,
      body: { imported: 0, skipped: 3 },
    });
  });

  it("waits for a decision on each near-match, and remembers a kept one", async () => {
    const id = await addAccount();
    await importStatement(id);
    const lookalike = statement("ESSELUNGA SPA");
    expect(await importStatement(id, lookalike)).toEqual({
      status: 400,
      body: { error: "Decide whether to keep or skip each near-match first." },
    });

    const kept = await importStatement(id, lookalike, {
      decisions: { 3: "keep" },
    });
    expect(kept.body).toMatchObject({ imported: 1, skipped: 2 });
    expect(kept.body.gaps).toHaveLength(1);

    // Imported again, the kept one is suspected from the database.
    const { body: file } = await upload(id, lookalike);
    const { body } = await call("POST", `/api/imports/${file.id}/preview`, {
      mapping,
    });
    expect(body.gaps[0].suspects[0]).toEqual({
      reason: "kept-near-match",
      date: "2026-10-02",
      amount: -5630,
      description: "ESSELUNGA SPA",
      id: 4,
      line: null,
    });
  });

  it("asks for the balance when there's no anchor and no balance column", async () => {
    const id = await addAccount();
    const { body: file } = await upload(id, statement());
    const preview = await call("POST", `/api/imports/${file.id}/preview`, {
      mapping: noBalance,
    });
    expect(preview.body).toMatchObject({ needsBalance: true, anchor: null });

    const save = (body: object) =>
      call("POST", `/api/imports/${file.id}/save`, {
        mapping: noBalance,
        presetName: null,
        ...body,
      });
    expect(await save({})).toEqual({
      status: 400,
      body: { errors: { anchorAmount: "Enter the balance." } },
    });
    expect(
      await save({ balance: { amount: "2684,20", date: "2026-10-20" } }),
    ).toEqual({
      status: 400,
      body: { errors: { anchorDate: "The date can't be in the future." } },
    });
    expect(
      await save({ balance: { amount: "2684,20", date: "2026-10-16" } }),
    ).toMatchObject({
      status: 201,
      body: {
        imported: 3,
        anchor: { amount: 268420, date: "2026-10-16", source: "manual" },
      },
    });
  });

  it("saves the format as a preset only when asked", async () => {
    const id = await addAccount();
    await importStatement(id, statement(), { presetName: null });
    expect((await upload(id, statement())).body.preset).toBeNull();
    expect(
      (await importStatement(id, statement(), { presetName: "  " })).body,
    ).toEqual({ errors: { presetName: "Give the format a name." } });
  });

  it("forgets the file once it's saved", async () => {
    const { body: file } = await upload(await addAccount(), statement());
    const url = `/api/imports/${file.id}/save`;
    const body = { mapping, presetName: null };
    expect((await call("POST", url, body)).status).toBe(201);
    expect((await call("POST", url, body)).status).toBe(404);
  });
});

describe("accounts with transactions", () => {
  it("work their balance out from the transactions", async () => {
    const id = await addAccount({
      anchor: { amount: "1,240.50", date: "2026-09-30" },
    });
    await importStatement(id, statement(), { mapping: noBalance });
    const { body: account } = await call("GET", "/api/accounts");
    expect(account.accounts[0]).toMatchObject({
      anchor: { amount: 124050, date: "2026-09-30", source: "manual" },
      balance: { amount: 268420, date: "2026-10-05" },
    });
  });

  it("can't change currency any more", async () => {
    const id = await addAccount();
    await importStatement(id);
    const fields = { name: "Main", bank: "Bank A", type: "checking" };
    expect(
      await call("PATCH", `/api/accounts/${id}`, {
        ...fields,
        currency: "USD",
      }),
    ).toEqual({
      status: 400,
      body: {
        errors: {
          currency:
            "The currency can't change once the account has transactions.",
        },
      },
    });
    expect(
      (
        await call("PATCH", `/api/accounts/${id}`, {
          ...fields,
          currency: "EUR",
        })
      ).status,
    ).toBe(200);
  });
});

describe("times, currencies and statuses", () => {
  const card = (rows: string[]) =>
    ["Completed Date,Description,Amount,Currency,State,Balance", ...rows].join(
      "\n",
    );
  const cardMapping = {
    roles: ["date", "description", "amount", "currency", "status", "balance"],
    dateFormat: "YYYY-MM-DD",
    decimalMark: "point",
  };
  const save = async (account: number, text: string, body: object = {}) => {
    const { body: file } = await upload(account, text);
    return call("POST", `/api/imports/${file.id}/save`, {
      mapping: cardMapping,
      presetName: null,
      ...body,
    });
  };

  it("keeps times, and a different time is a near-match", async () => {
    const id = await addAccount();
    const morning = "2026-10-03 09:10:00,BAR,-1.20,EUR,COMPLETED,98.80";
    expect((await save(id, card([morning]))).status).toBe(201);
    const { body: file } = await upload(
      id,
      card(["2026-10-03 15:40:00,BAR,-1.20,EUR,COMPLETED,97.60"]),
    );
    const { body } = await call("POST", `/api/imports/${file.id}/preview`, {
      mapping: cardMapping,
    });
    expect(body.rows[0]).toMatchObject({
      time: "15:40:00",
      status: "near-match",
      match: { id: 1 },
    });
  });

  it("leaves out other currencies and unfinished payments, and lists them", async () => {
    const id = await addAccount();
    const { body: file } = await upload(
      id,
      card([
        "2026-10-01 09:00:00,Top-up,100.00,EUR,COMPLETED,100.00",
        "2026-10-02 10:00:00,Hotel,-80.00,USD,COMPLETED,20.00",
        ",Pizza,-16.00,EUR,PENDING,",
      ]),
    );
    const { body } = await call("POST", `/api/imports/${file.id}/preview`, {
      mapping: cardMapping,
    });
    expect(body.rows).toHaveLength(1);
    expect(
      body.leftOut.map((r: { line: number; reason: string; value: string }) => [
        r.line,
        r.reason,
        r.value,
      ]),
    ).toEqual([
      [3, "currency", "USD"],
      [4, "status", "PENDING"],
    ]);
  });

  it("refuses a file with nothing in the account's currency", async () => {
    const id = await addAccount();
    expect(
      await save(
        id,
        card(["2026-10-02 10:00:00,Hotel,-80.00,USD,COMPLETED,20.00"]),
      ),
    ).toEqual({
      status: 400,
      body: {
        error:
          "None of this file's rows are in EUR: they're in USD. Import it into a USD account.",
      },
    });
  });
});
