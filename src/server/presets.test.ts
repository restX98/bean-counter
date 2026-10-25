import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;
let today: string;

beforeEach(() => {
  today = "2026-10-12";
  app = buildApp({ db: openDatabase(":memory:"), today: () => today });
  return () => app.close();
});

async function account(name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/accounts",
    payload: {
      name,
      bank: "Bank A",
      type: "checking",
      currency: "EUR",
      // So a file without a balance column can be imported.
      anchor: { amount: "10.00", date: "2026-10-01" },
    },
  });
  return res.json().id as number;
}

/** Imports one row with these columns, saving the format as `presetName`. */
async function importFile(
  account: number,
  header: string,
  presetName: string | null,
) {
  const row =
    header.split(";").length === 4
      ? "01/10/2026;Rent;-1,00;9,00"
      : "01/10/2026;Rent;-1,00";
  const res = await app.inject({
    method: "POST",
    url: `/api/imports?account=${account}&file=statement.csv`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(`${header}\n${row}`),
  });
  const roles = ["date", "description", "amount", "balance"].slice(
    0,
    header.split(";").length,
  );
  await app.inject({
    method: "POST",
    url: `/api/imports/${res.json().id}/save`,
    payload: {
      mapping: { roles, dateFormat: "DD/MM/YYYY", decimalMark: "comma" },
      presetName,
    },
  });
}

const presets = async () =>
  (await app.inject({ method: "GET", url: "/api/presets" })).json().presets;

describe("import presets (S18)", () => {
  it("lists each format with its accounts and last import", async () => {
    const checking = await account("Main checking");
    const savings = await account("Savings");
    await importFile(checking, "Data;Descrizione;Importo", "Bank A · checking");
    today = "2026-10-16";
    await importFile(savings, "Data;Descrizione;Importo", "Bank A · checking");
    await importFile(savings, "Data;Descr;Importo;Saldo", "Bank A · savings");
    // Not saved as a preset: it doesn't count.
    today = "2026-10-20";
    await importFile(checking, "Data;Descr;Importo;Saldo", null);

    expect(await presets()).toEqual([
      {
        id: expect.any(Number),
        name: "Bank A · checking",
        columns: 3,
        balance: false,
        accounts: ["Main checking", "Savings"],
        lastUsed: "2026-10-16",
      },
      {
        id: expect.any(Number),
        name: "Bank A · savings",
        columns: 4,
        balance: true,
        accounts: ["Savings"],
        lastUsed: "2026-10-16",
      },
    ]);
  });

  it("deletes a preset and keeps what was imported with it", async () => {
    const checking = await account("Main checking");
    await importFile(checking, "Data;Descrizione;Importo", "Bank A · checking");

    const res = await app.inject({ method: "DELETE", url: "/api/presets/1" });
    expect(res.statusCode).toBe(204);
    expect(await presets()).toEqual([]);
    const list = await app.inject({ method: "GET", url: "/api/transactions" });
    expect(list.json().transactions).toHaveLength(1);

    const again = await app.inject({ method: "DELETE", url: "/api/presets/1" });
    expect(again.statusCode).toBe(404);
  });
});
