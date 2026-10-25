import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The data a test starts from, saved as backups by states.setup.ts:
 * - empty: nothing at all;
 * - september: the categories Salary and Interest (income), Rent and
 *   Groceries (expense); Main checking (Bank A), with September imported and
 *   its balance entered, and the "Bank A · checking" preset; nothing
 *   categorized, no rules;
 * - october: also October in Main checking, and Savings (Bank A) with its
 *   October statement; the transfer between them is linked.
 */
export type State = "empty" | "september" | "october";

export const STATES = join(import.meta.dirname, ".states");
export const fixture = (name: string) =>
  join(import.meta.dirname, "fixtures", name);

/** Replaces all data with the state's, through Restore (D8). */
export async function startFrom(request: APIRequestContext, state: State) {
  const res = await request.post("/api/restore", {
    headers: { "content-type": "application/octet-stream" },
    data: readFileSync(join(STATES, `${state}.db`)),
  });
  expect(res.ok()).toBe(true);
}

/** S7: picks a statement through Browse files. */
export async function chooseFile(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse files" }).click();
  await (await chooser).setFiles(fixture(name));
}

const MAPPINGS = {
  checking: ["date", "ignore", "description", "amount", "reference"],
  savings: ["date", "ignore", "description", "amount", "balance", "reference"],
};

/** A Bank A account in euros, through the API. */
export async function addAccount(
  request: APIRequestContext,
  name: string,
  type: "checking" | "savings",
) {
  const res = await request.post("/api/accounts", {
    data: { name, bank: "Bank A", type, currency: "EUR" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).id as number;
}

/** An account's id, from its name. */
export async function accountId(request: APIRequestContext, name: string) {
  const res = await request.get("/api/accounts");
  const { accounts } = (await res.json()) as {
    accounts: { id: number; name: string }[];
  };
  return accounts.find((a) => a.name === name)!.id;
}

/**
 * Imports a Bank A statement through the API, saving its format as the
 * "Bank A · checking" or "Bank A · savings" preset.
 */
export async function importStatement(
  request: APIRequestContext,
  account: number,
  file: string,
  kind: keyof typeof MAPPINGS,
  balance?: { amount: string; date: string },
) {
  const upload = await request.post(
    `/api/imports?account=${account}&file=${file}`,
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
