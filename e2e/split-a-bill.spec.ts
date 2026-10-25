import { expect, test } from "@playwright/test";
import { accountId, categorize, importStatement, startFrom } from "./states.ts";

// Plan §6, flow 12: I paid the dinner (305.00 €) and the pizzeria
// (48.00 €); Marco pays me back 174.00 €: 150.00 € of the dinner and
// 24.00 € of the pizzeria.
test("link a friend's payback to the bills it pays, and count only my share", async ({
  page,
  request,
}) => {
  await startFrom(request, "september");
  const res = await request.post("/api/categories", {
    data: { name: "Eating out", type: "expense" },
  });
  expect(res.ok()).toBe(true);
  await importStatement(
    request,
    await accountId(request, "Main checking"),
    "bank-a-checking-2026-10-split.csv",
    "checking",
  );
  await categorize(request, "PIZZERIA DA GINO", "Eating out");
  await categorize(request, "RISTORANTE DA MARIO", "Eating out");

  // S2: Marco's payment waits under Possible paybacks → D9.
  await page.goto("/review");
  await page
    .getByRole("button", {
      name: "Link BONIFICO DA MARCO to the expenses it pays back",
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Link payback" });
  await dialog.getByText("RISTORANTE DA MARIO").click();
  await dialog.getByLabel("Payback, RISTORANTE DA MARIO").fill("150.00");
  await dialog.getByText("PIZZERIA DA GINO").click();
  await dialog.getByLabel("Payback, PIZZERIA DA GINO").fill("24.00");
  await dialog.getByRole("button", { name: "Link payback" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Link BONIFICO DA MARCO to the expenses it pays back",
    }),
  ).toHaveCount(0);

  // S6: the dinner shows my share.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "RISTORANTE DA MARIO" }).click();
  const share = page
    .getByRole("complementary", { name: "Transaction" })
    .locator(".share");
  await expect(share).toContainText("Your share");
  await expect(share).toContainText("155.00 €");

  // S12: Eating out counts my share only, 353.00 € − 174.00 €, and the
  // payback isn't income.
  await page.goto("/reports/monthly?month=2026-10");
  const month = page.locator("section.card", { hasText: "Net cashflow" });
  await expect(month.getByRole("link", { name: "Eating out" })).toBeVisible();
  await expect(month).toContainText("179.00 €");
  await expect(month).not.toContainText("174.00 €");
});
