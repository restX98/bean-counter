import { expect, test } from "@playwright/test";
import { categorize, startFrom } from "./states.ts";

// Plan §6, flow 7: from the dashboard to the reports and back down to one
// transaction.

test("from the dashboard to this month's report, a category's transactions, and the other reports", async ({
  page,
  request,
}) => {
  await startFrom(request, "october");
  for (const [description, category] of [
    ["SALARY ACME SPA", "Salary"],
    ["INTERESSI", "Interest"],
    ["AFFITTO VIA ROMA", "Rent"],
    ["ESSELUNGA MILANO", "Groceries"],
  ] as const) {
    await categorize(request, description, category);
  }

  // S1 → S12, on October.
  await page.goto("/");
  await page.getByRole("link", { name: "Open monthly report" }).click();
  await expect(
    page.getByRole("heading", { name: "October 2026" }),
  ).toBeVisible();
  const month = page.locator("section.card", { hasText: "Net cashflow" });
  await expect(month).toContainText("2,005.00 €");
  await expect(month).toContainText("1,948.70 €");

  // A category → S5, filtered to it and the month → S6.
  await month.getByRole("link", { name: "Groceries" }).click();
  await expect(page).toHaveURL(/\/transactions\?.*category=/);
  const groceries = page.getByRole("button", { name: "ESSELUNGA MILANO" });
  await expect(groceries).toHaveCount(1);
  await groceries.click();
  await expect(
    page
      .getByRole("complementary", { name: "Transaction" })
      .getByLabel("Category")
      .locator("option:checked"),
  ).toHaveText("Groceries");

  // S13, over the months there are: both groceries, and the rent.
  await page.goto("/reports/monthly");
  await page.getByRole("link", { name: "Spending by category" }).click();
  await expect(
    page.getByRole("link", { name: /Groceries.*140\.40 €/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Rent.*700\.00 €/ }),
  ).toBeVisible();

  // S11, the balance trend.
  await page.getByRole("link", { name: "Balance over time" }).click();
  await expect(
    page.getByRole("img", { name: /Balance per account/ }),
  ).toBeVisible();
});
