import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { fixture, STATES } from "./states.ts";

// The server starts with an empty database. Each state is built on the one
// before, through the API, and saved as a backup.

const MAPPINGS = {
  checking: ["date", "ignore", "description", "amount", "reference"],
  savings: ["date", "ignore", "description", "amount", "balance", "reference"],
};

async function save(request: APIRequestContext, state: string) {
  const res = await request.get("/api/backup");
  expect(res.ok()).toBe(true);
  writeFileSync(join(STATES, `${state}.db`), await res.body());
}

async function account(request: APIRequestContext, name: string, type: string) {
  const res = await request.post("/api/accounts", {
    data: { name, bank: "Bank A", type, currency: "EUR" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).id as number;
}

async function importFile(
  request: APIRequestContext,
  accountId: number,
  file: string,
  kind: keyof typeof MAPPINGS,
  balance?: { amount: string; date: string },
) {
  const upload = await request.post(
    `/api/imports?account=${accountId}&file=${file}`,
    {
      headers: { "content-type": "application/octet-stream" },
      data: readFileSync(fixture(file)),
    },
  );
  expect(upload.ok()).toBe(true);
  const saved = await request.post(
    `/api/imports/${(await upload.json()).id}/save`,
    {
      data: {
        mapping: {
          roles: MAPPINGS[kind],
          dateFormat: "DD/MM/YYYY",
          decimalMark: "comma",
        },
        presetName: `Bank A · ${kind}`,
        ...(balance && { balance }),
      },
    },
  );
  expect(saved.ok()).toBe(true);
}

test("save the states the tests start from", async ({ request }) => {
  mkdirSync(STATES, { recursive: true });
  await save(request, "empty");

  const checking = await account(request, "Main checking", "checking");
  await importFile(
    request,
    checking,
    "bank-a-checking-2026-09.csv",
    "checking",
    {
      amount: "1,240.50",
      date: "2026-09-12",
    },
  );
  await save(request, "september");

  await importFile(
    request,
    checking,
    "bank-a-checking-2026-10.csv",
    "checking",
  );
  const savings = await account(request, "Savings", "savings");
  await importFile(request, savings, "bank-a-savings-2026-10.csv", "savings");
  await save(request, "october");
});
