import { expect, test } from "@playwright/test";
import { accountId, chooseFile, importStatement, startFrom } from "./states.ts";

// Plan §6, flow 5: 200.00 € out of Main checking, 218.00 $ into the US
// account the next day. Across currencies the app never links on its own:
// Review suggests the pair.
test("an exchange between currencies is suggested in Review and linked there", async ({
  page,
  request,
}) => {
  await startFrom(request, "september");
  await importStatement(
    request,
    await accountId(request, "Main checking"),
    "bank-a-checking-2026-10-exchange.csv",
    "checking",
  );
  const res = await request.post("/api/accounts", {
    data: {
      name: "US account",
      bank: "Bank C",
      type: "checking",
      currency: "USD",
    },
  });
  const us = (await res.json()).id as number;

  // The USD file, a new format: S7 → S8 → S9, with its balance.
  await page.goto(`/import?account=${us}`);
  await chooseFile(page, "bank-c-us-2026-10.csv");
  await page.getByRole("button", { name: "Continue →" }).click();
  await expect(page.getByText("Bank C · new format.")).toBeVisible();
  await page.getByRole("button", { name: "Continue →" }).click();
  await page.getByLabel("Current balance and its date").fill("1,000.00");
  await page.getByLabel("Date of the balance").fill("2026-10-15");
  await page.getByRole("button", { name: /^Import\b/ }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();

  // S2: the pair waits to be confirmed.
  await page.getByRole("link", { name: /^Go to Review/ }).click();
  const link = page.getByRole("button", {
    name: /^Link (EXCHANGE TO USD with FROM EUR ACCOUNT|FROM EUR ACCOUNT with EXCHANGE TO USD)$/,
  });
  await link.click();
  await expect(link).toHaveCount(0);

  // S6: the dollars came from Main checking.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "FROM EUR ACCOUNT" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Transaction" })
      .getByText("Linked to Main checking"),
  ).toBeVisible();
});
