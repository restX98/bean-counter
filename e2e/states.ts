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
