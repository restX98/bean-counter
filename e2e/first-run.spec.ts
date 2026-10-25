import { expect, test } from "@playwright/test";
import { chooseFile, startFrom } from "./states.ts";

// Plan §6, flow 1: from no data at all to the first statement on the
// dashboard.
test("first run: add an account, import its first statement, see it on the dashboard", async ({
  page,
  request,
}) => {
  await startFrom(request, "empty");
  await page.goto("/");

  // S1, empty → D1.
  await expect(
    page.getByRole("heading", { name: "No accounts yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add account" }).click();
  const form = page.getByRole("dialog", { name: "Add account" });
  await form.getByLabel("Name").fill("Main checking");
  await form.getByLabel("Bank").fill("Bank A");
  await form.getByRole("button", { name: "Save account" }).click();

  // S4, empty → Import.
  await expect(
    page.getByRole("heading", { name: "Main checking" }),
  ).toBeVisible();
  await expect(page.getByText("No transactions yet")).toBeVisible();
  await page.getByRole("link", { name: "Import statement" }).click();

  // S7: the account is chosen already.
  await chooseFile(page, "bank-a-checking-2026-09.csv");
  await page.getByRole("button", { name: "Continue →" }).click();

  // S8: a new format, mapped from its column names.
  await expect(page.getByText("Bank A · new format.")).toBeVisible();
  await page.getByRole("button", { name: "Continue →" }).click();

  // S9: no balance column and no balance yet, so it asks for one.
  await page.getByLabel("Current balance and its date").fill("1,240.50");
  await page.getByLabel("Date of the balance").fill("2026-09-12");
  await page.getByRole("button", { name: /^Import\b/ }).click();

  // S10 → S1, which now shows the account.
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await page.goto("/");
  await expect(
    page.locator("section.card", { hasText: "Total balance" }),
  ).toContainText("1,240.50 €");
});
