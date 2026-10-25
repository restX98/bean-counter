import { expect, test, type Page } from "@playwright/test";
import { categorize, startFrom } from "./states.ts";

// Plan §6, flow 8: a Groceries budget of 100.00 € a month from September.
// Groceries cost 84.10 € in September and 56.30 € in October.

/** S14's row for the budget, named by its numbers. */
const row = (page: Page, numbers: string) =>
  page.getByRole("link", { name: `Groceries: ${numbers}` });

test("add a budget, follow it this month and over time, and change its limit", async ({
  page,
  request,
}) => {
  await startFrom(request, "october");
  await categorize(request, "ESSELUNGA MILANO", "Groceries");

  // S14 → D7.
  await page.goto("/budgets");
  await page
    .getByRole("button", { name: /^Add( budget)?$/ })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: "Add budget" });
  await form.getByLabel("Category").selectOption({ label: "Groceries" });
  await form.getByLabel("Monthly limit").fill("100");
  await form.getByLabel("Starts in").selectOption({ label: "September 2026" });
  await form.getByRole("button", { name: "Save budget" }).click();
  await expect(form).toBeHidden();

  // This month, then the running balance: 200.00 € budgeted since
  // September, 140.40 € spent.
  await expect(
    row(page, "56.30 € spent of 100.00 €, 43.70 € left"),
  ).toBeVisible();
  await page.getByText("Running balance", { exact: true }).click();
  await expect(
    row(
      page,
      "140.40 € spent of 200.00 € budgeted since September 2026, 59.60 € left",
    ),
  ).toBeVisible();

  // S1 shows it too.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Groceries" })).toBeVisible();

  // S15 → D7: 150.00 € a month from October on.
  await page.getByRole("link", { name: "Groceries" }).click();
  await page.getByRole("button", { name: "Change limit" }).click();
  const change = page.getByRole("dialog", { name: /^Change limit/ });
  await change.getByLabel("New limit").fill("150");
  await change
    .getByLabel("Applies from")
    .selectOption({ label: "October 2026" });
  await change.getByRole("button", { name: "Save limit" }).click();
  await expect(change).toBeHidden();
  await expect(page.getByText("150.00 € per month")).toBeVisible();

  await page.goto("/budgets");
  await expect(
    row(page, "56.30 € spent of 150.00 €, 93.70 € left"),
  ).toBeVisible();
});
