import { expect, test } from "@playwright/test";
import { startFrom } from "./states.ts";

// Plan §6, flow 9: S3 → S4, then edit (D1), set the balance (D2) and
// archive (D3). Main checking's balance is 2,684.20 € since 5 October.
test("open an account from the list, edit it, set its balance and archive it", async ({
  page,
  request,
}) => {
  await startFrom(request, "october");
  await page.goto("/accounts");
  await page.getByRole("link", { name: /Main checking/ }).click();
  await expect(
    page.getByRole("heading", { name: "Main checking" }),
  ).toBeVisible();

  // D1: a new name.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit account" });
  await edit.getByLabel("Name").fill("Everyday checking");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Everyday checking" }),
  ).toBeVisible();

  // D2: the bank app says 2,700.00 € on 20 October. D2 shows the
  // difference first, then it becomes the anchor.
  await page.getByRole("button", { name: "Set balance" }).click();
  const balance = page.getByRole("dialog", { name: /^Set balance/ });
  await balance.getByLabel("Balance and date").fill("2,700.00");
  await balance.getByLabel("Date of the balance").fill("2026-10-20");
  await balance.getByRole("button", { name: "Save balance" }).click();
  await expect(balance).toContainText("15.80 € more than the app's balance");
  await balance.getByRole("button", { name: "Use my balance" }).click();
  await expect(balance).toBeHidden();
  await expect(page.getByText("2,700.00 €").first()).toBeVisible();

  // D3: archived, and read-only.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Archive Everyday checking?" })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByText(/^Archived on/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();

  // S3 hides it until archived accounts are shown.
  await page.goto("/accounts");
  const link = page.getByRole("link", { name: /Everyday checking/ });
  await expect(link).toHaveCount(0);
  await page.getByText(/^Show archived accounts/).click();
  await expect(link).toBeVisible();
});
