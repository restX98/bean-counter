import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { addAccount, importStatement, STATES } from "./states.ts";

// The server starts with an empty database. Each state is built on the one
// before, through the API, and saved as a backup.

async function save(request: APIRequestContext, state: string) {
  const res = await request.get("/api/backup");
  expect(res.ok()).toBe(true);
  writeFileSync(join(STATES, `${state}.db`), await res.body());
}

test("save the states the tests start from", async ({ request }) => {
  mkdirSync(STATES, { recursive: true });
  await save(request, "empty");

  for (const [name, type] of [
    ["Salary", "income"],
    ["Interest", "income"],
    ["Rent", "expense"],
    ["Groceries", "expense"],
  ]) {
    const res = await request.post("/api/categories", { data: { name, type } });
    expect(res.ok()).toBe(true);
  }
  const checking = await addAccount(request, "Main checking", "checking");
  await importStatement(
    request,
    checking,
    "bank-a-checking-2026-09.csv",
    "checking",
    {
      amount: "1,240.50",
      date: "2026-09-12",
    },
  );
  await save(request, "september");

  await importStatement(
    request,
    checking,
    "bank-a-checking-2026-10.csv",
    "checking",
  );
  const savings = await addAccount(request, "Savings", "savings");
  await importStatement(
    request,
    savings,
    "bank-a-savings-2026-10.csv",
    "savings",
  );
  await save(request, "october");
});
