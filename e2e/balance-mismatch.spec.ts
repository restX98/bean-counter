import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  chooseFile,
  importStatement,
  startFrom,
} from "./states.ts";

// Plan §6, flow 6: the bank's balances and the app's part ways, and Review
// says between which days. Savings' statements have a balance column.

const banner = (page: Page) =>
  page.getByRole("status").filter({ hasText: "The app's balances" });

/** S2 → S4, at the gap. */
async function openFromReview(page: Page, off: string) {
  await page.goto("/review");
  await expect(page.getByText(`Off by ${off}`)).toBeVisible();
  await page.getByRole("link", { name: "Open Savings" }).click();
  await expect(banner(page)).toBeVisible();
}

test("a duplicate that slipped through: exclude it", async ({
  page,
  request,
}) => {
  await startFrom(request, "september");
  // The bank listed a 2.00 € coffee twice, but took it once.
  await importStatement(
    request,
    await addAccount(request, "Savings", "savings"),
    "bank-a-savings-2026-10-duplicate.csv",
    "savings",
  );

  await openFromReview(page, "2.00 €");
  await expect(banner(page)).toContainText("differ by 2.00 €");
  await expect(banner(page)).toContainText(
    "They split between 05/10/2026 and 10/10/2026",
  );

  // S6: exclude one of the two.
  await page.getByRole("button", { name: "BAR CENTRALE" }).first().click();
  await page
    .getByRole("complementary", { name: "Transaction" })
    .getByRole("button", { name: "Exclude transaction" })
    .click();
  await expect(banner(page)).toHaveCount(0);
  await page.goto("/review");
  await expect(page.getByText(/^Off by/)).toHaveCount(0);
});

test("a missing transaction: import the statement that has it", async ({
  page,
  request,
}) => {
  await startFrom(request, "september");
  // This export left out a 30.00 € withdrawal on 12 October.
  const savings = await addAccount(request, "Savings", "savings");
  await importStatement(
    request,
    savings,
    "bank-a-savings-2026-10-missing-row.csv",
    "savings",
  );

  await openFromReview(page, "30.00 €");
  await expect(banner(page)).toContainText(
    "They split between 05/10/2026 and 20/10/2026",
  );

  // The full statement: its other rows are duplicates, so only the
  // withdrawal comes in.
  await page.goto(`/import?account=${savings}`);
  await chooseFile(page, "bank-a-savings-2026-10-full.csv");
  await page.getByRole("button", { name: "Continue →" }).click();
  await page.getByRole("button", { name: /^Import\b/ }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();

  await page.goto(`/accounts/${savings}`);
  await expect(page.getByText("PRELIEVO BANCOMAT")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await page.goto("/review");
  await expect(page.getByText(/^Off by/)).toHaveCount(0);
});
