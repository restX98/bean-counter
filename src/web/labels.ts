import type { AccountType } from "../domain/accounts.ts";
import type { CategoryType } from "../domain/categories.ts";

export const TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
};

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  income: "Income",
  expense: "Expense",
};

/** "1 account", "3 accounts"; irregular plurals are passed in. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
