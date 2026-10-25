import { expect, test } from "@playwright/test";
import { startFrom } from "./states.ts";

// Plan §6, flow 3: give a transaction a category, then make it a rule that
// also categorizes the others like it.
test("categorize a transaction, then create a rule that does the rest", async ({
  page,
  request,
}) => {
  await startFrom(request, "october");

  // S5 → S6: October's groceries, the newest.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "ESSELUNGA MILANO" }).first().click();
  const panel = page.getByRole("complementary", { name: "Transaction" });
  await panel.getByLabel("Category").selectOption({ label: "Groceries" });

  // D6, prefilled from it, applies to September's groceries too.
  await panel.getByRole("button", { name: "Create rule from this" }).click();
  const form = page.getByRole("dialog", { name: "Add rule" });
  await expect(form.getByLabel("Description", { exact: true })).toHaveValue(
    /ESSELUNGA/,
  );
  await expect(
    form.getByLabel("Category").locator("option:checked"),
  ).toHaveText("Groceries");
  const apply = form.getByRole("checkbox", {
    name: /Also apply to 1 uncategorized transaction/,
  });
  await expect(apply).toBeChecked();
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(form).toBeHidden();

  // Neither waits for a category in Review any more (money coming in may
  // still name them as what it could pay back), and S17 has the rule.
  await page.goto("/review");
  const uncategorized = page
    .locator("section.group, details")
    .filter({ hasText: /^Uncategorized/ });
  await expect(uncategorized.getByText("AFFITTO VIA ROMA")).toHaveCount(1);
  await expect(uncategorized.getByText("ESSELUNGA MILANO")).toHaveCount(0);
  await page.goto("/rules");
  await expect(page.getByText(/ESSELUNGA/).first()).toBeVisible();
  await expect(page.getByText("Groceries").first()).toBeVisible();
});
