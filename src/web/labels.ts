import type { Account, AccountType } from "../domain/accounts.ts";
import type { CategoryType } from "../domain/categories.ts";
import type { TransactionType } from "../domain/filters.ts";
import { describeAmount, type Rule, type RuleMatch } from "../domain/rules.ts";

export const TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
};

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  income: "Income",
  expense: "Expense",
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  payback: "Payback",
  uncategorized: "Uncategorized",
  excluded: "Excluded",
};

/** In a sentence: "among expenses". */
export const TRANSACTION_TYPE_PLURALS: Record<TransactionType, string> = {
  income: "income",
  expense: "expenses",
  transfer: "transfers",
  payback: "paybacks",
  uncategorized: "uncategorized transactions",
  excluded: "excluded transactions",
};

/** "1 account", "3 accounts"; irregular plurals are passed in. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Savings", "Savings and Card account", "A, B and C"; or "A, B or C". */
export function listNames(names: string[], last = "and"): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`
    : (names[0] ?? "");
}

/** "2 possible matches in Savings": a possible transfer's candidates. */
export const possibleMatches = (count: number, accounts: string[]) =>
  `${plural(count, "possible match", "possible matches")} in ${listNames(accounts)}`;

export const RULE_MATCH_LABELS: Record<RuleMatch, string> = {
  contains: "contains",
  regex: "matches regex",
};

/** A rule's description test: contains “ESSELUNGA”, matches regex ^SALARY. */
export function ruleTest({ match, text }: Pick<Rule, "match" | "text">) {
  return match === "contains" ? `contains “${text}”` : `matches regex ${text}`;
}

/** What else a rule needs: "account: Main checking", "amount under 10.00 €". */
export function ruleNarrowing(
  { accountId, amount }: Pick<Rule, "accountId" | "amount">,
  accounts: Account[],
): string[] {
  const parts: string[] = [];
  if (accountId !== null) {
    const name = accounts.find((a) => a.id === accountId)?.name;
    parts.push(`account: ${name ?? "unknown"}`);
  }
  if (amount) parts.push(`amount ${describeAmount(amount)}`);
  return parts;
}

/** A rule's text, to name it in a sentence: “SATISPAY”, regex ^SALARY. */
export function ruleText({ match, text }: Pick<Rule, "match" | "text">) {
  return match === "contains" ? `“${text}”` : `regex ${text}`;
}

/** A rule in a few words: “SATISPAY”, amount under 10.00 €. */
export function ruleName(rule: Rule, accounts: Account[]): string {
  return [ruleText(rule), ...ruleNarrowing(rule, accounts)].join(", ");
}
