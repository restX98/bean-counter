import { expect, test, type Page } from "@playwright/test";
import { categorize, startFrom } from "./states.ts";

// Plan §6, flow 11: categories in S16 with D5, rules in S17 with D6. Both
// groceries are in Groceries, which a rule gives ESSELUNGA MILANO.

test.beforeEach(async ({ request }) => {
  await startFrom(request, "october");
  await categorize(request, "ESSELUNGA MILANO", "Groceries");
  const { categories } = await (await request.get("/api/categories")).json();
  const groceries = categories.find(
    (c: { name: string }) => c.name === "Groceries",
  );
  const res = await request.post("/api/rules", {
    data: {
      match: "contains",
      text: "ESSELUNGA MILANO",
      accountId: null,
      min: "",
      max: "",
      currency: "EUR",
      categoryId: groceries.id,
    },
  });
  expect(res.ok()).toBe(true);
});

/** Opens D5 or D6 for an item: its Edit button, or on a phone its row. */
async function edit(
  page: Page,
  isMobile: boolean,
  desktop: string,
  mobile: RegExp,
) {
  await (
    isMobile
      ? page.getByRole("button", { name: mobile })
      : page.getByRole("button", { name: desktop, exact: true })
  ).click();
}

test("add, rename and delete a category, moving its transactions and its rule", async ({
  page,
  isMobile,
}) => {
  await page.goto("/categories");

  // D5: a new expense category.
  await page
    .getByRole("button", { name: /^Add( category)?$/ })
    .first()
    .click();
  let form = page.getByRole("dialog", { name: "Add category" });
  await form.getByLabel("Name").fill("Food");
  await form.getByText("Expense", { exact: true }).click();
  await form.getByRole("button", { name: "Save category" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Food", { exact: true })).toBeVisible();

  // D5: Groceries becomes Supermarket.
  await edit(page, isMobile, "Edit Groceries", /^Groceries/);
  form = page.getByRole("dialog", { name: "Edit category" });
  await form.getByLabel("Name").fill("Supermarket");
  await form.getByRole("button", { name: "Save category" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Supermarket", { exact: true })).toBeVisible();

  // Deleting it asks where its 2 transactions go; they go to Food, and
  // the rule that gives it follows them.
  await edit(page, isMobile, "Edit Supermarket", /^Supermarket/);
  await page
    .getByRole("dialog", { name: "Edit category" })
    .getByRole("button", { name: "Delete this category…" })
    .click();
  const remove = page.getByRole("dialog", { name: "Delete “Supermarket”?" });
  await remove
    .getByLabel("Category to move them to")
    .selectOption({ label: "Food" });
  await remove.getByRole("button", { name: "Delete category" }).click();
  await expect(remove).toBeHidden();
  await expect(page.getByText("Supermarket", { exact: true })).toHaveCount(0);

  await page.goto("/rules");
  await expect(page.getByText("Food").first()).toBeVisible();
  await page.goto("/transactions");
  await page.getByRole("button", { name: "ESSELUNGA MILANO" }).first().click();
  await expect(
    page
      .getByRole("complementary", { name: "Transaction" })
      .getByLabel("Category")
      .locator("option:checked"),
  ).toHaveText("Food");
});

test("edit a rule, then delete it", async ({ page, isMobile }) => {
  await page.goto("/rules");

  // D6: the rule now looks for ESSELUNGA only.
  await edit(
    page,
    isMobile,
    "Edit rule contains “ESSELUNGA MILANO”",
    /contains “ESSELUNGA MILANO”/,
  );
  const form = page.getByRole("dialog", { name: "Edit rule" });
  await form.getByLabel("Description", { exact: true }).fill("ESSELUNGA");
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("contains “ESSELUNGA”")).toBeVisible();

  // Deleting it keeps the categories it gave.
  await edit(
    page,
    isMobile,
    "Edit rule contains “ESSELUNGA”",
    /contains “ESSELUNGA”/,
  );
  await page
    .getByRole("dialog", { name: "Edit rule" })
    .getByRole("button", { name: "Delete this rule…" })
    .click();
  await page
    .getByRole("dialog", { name: "Delete rule?" })
    .getByRole("button", { name: "Delete rule" })
    .click();
  await expect(page.getByText("contains “ESSELUNGA”")).toHaveCount(0);
  await page.goto("/review");
  await expect(
    page
      .locator("section.group, details")
      .filter({ hasText: /^Uncategorized/ })
      .getByText("ESSELUNGA MILANO"),
  ).toHaveCount(0);
});
