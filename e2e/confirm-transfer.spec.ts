import { expect, test, type Page } from "@playwright/test";
import { accountId, addAccount, importStatement, startFrom } from "./states.ts";

// Plan §6, flow 4: a transfer with two possible other sides. Savings got
// 500.00 € twice, so the 500.00 € out of Main checking waits in Review.
test.beforeEach(async ({ request }) => {
  await startFrom(request, "september");
  const savings = await addAccount(request, "Savings", "savings");
  await importStatement(
    request,
    savings,
    "bank-a-savings-2026-10-two-deposits.csv",
    "savings",
  );
  await importStatement(
    request,
    await accountId(request, "Main checking"),
    "bank-a-checking-2026-10.csv",
    "checking",
  );
});

const pick = (page: Page) =>
  page.getByRole("button", {
    name: "Pick the other side of TRANSFER TO SAVINGS",
  });

/** S5 → S6 for the transfer out of Main checking. */
async function openTransfer(page: Page) {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "TRANSFER TO SAVINGS" }).click();
  return page.getByRole("complementary", { name: "Transaction" });
}

const uncategorized = (page: Page) =>
  page.locator("section.group, details").filter({ hasText: /^Uncategorized/ });

test("pick the other side in Review, unlink it, then link it by hand", async ({
  page,
}) => {
  // S2 → D4: pick the other side.
  await page.goto("/review");
  await pick(page).click();
  let dialog = page.getByRole("dialog", { name: "Link transfer" });
  await dialog.getByText("TRANSFER FROM CHECKING").click();
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(pick(page)).toHaveCount(0);

  // S6 → Unlink. The pair is remembered as not a transfer, so DEPOSIT is
  // the only other side left, and it links on its own.
  const panel = await openTransfer(page);
  await expect(panel.getByText("TRANSFER FROM CHECKING ·")).toBeVisible();
  await panel.getByRole("button", { name: "Unlink" }).click();
  await expect(panel.getByText("DEPOSIT ·")).toBeVisible();

  // Unlink again: nothing is left to link, so it's a normal transaction.
  await panel.getByRole("button", { name: "Unlink" }).click();
  await expect(panel.getByText("Linked to Savings")).toHaveCount(0);

  // By hand, S6 → D4, a pair I unlinked can still be linked.
  await panel.getByRole("button", { name: "Link transfer…" }).click();
  dialog = page.getByRole("dialog", { name: "Link transfer" });
  await dialog.getByText("TRANSFER FROM CHECKING").click();
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("TRANSFER FROM CHECKING ·")).toBeVisible();
});

test("say it isn't a transfer in Review", async ({ page }) => {
  await page.goto("/review");
  await page
    .getByRole("button", { name: "TRANSFER TO SAVINGS isn't a transfer" })
    .click();
  await expect(pick(page)).toHaveCount(0);
  // It waits for a category instead, and stays that way after a reload.
  await page.reload();
  await expect(pick(page)).toHaveCount(0);
  await expect(
    uncategorized(page).getByText("TRANSFER TO SAVINGS"),
  ).toHaveCount(1);
});
