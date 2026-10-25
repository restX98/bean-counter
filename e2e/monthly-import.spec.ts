import { expect, test } from "@playwright/test";
import { chooseFile, startFrom } from "./states.ts";

// Plan §6, flow 2: the next month's statement, in a format the app knows.
test("monthly import: the preset skips the mapping, and what's left goes to Review", async ({
  page,
  request,
}) => {
  await startFrom(request, "september");
  await page.goto("/import");

  // S7: the only account is chosen; the format is recognised.
  await chooseFile(page, "bank-a-checking-2026-10.csv");
  await expect(page.getByText("Bank A · checking")).toBeVisible();
  await page.getByRole("button", { name: "Continue →" }).click();

  // S9 straight away: S8 is skipped.
  await expect(page.getByText("Bank A · new format.")).toHaveCount(0);
  await expect(page.getByText("SALARY ACME SPA")).toBeVisible();
  await page.getByRole("button", { name: /^Import\b/ }).click();

  // S10 → S2: no rules yet, so all three wait for a category.
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to Review (3)" }).click();
  await expect(page).toHaveURL(/\/review$/);
  for (const description of [
    "SALARY ACME SPA",
    "ESSELUNGA MILANO",
    "TRANSFER TO SAVINGS",
  ]) {
    await expect(page.getByText(description).first()).toBeVisible();
  }
});
