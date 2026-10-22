import type { BalanceGap, BothBalances } from "./balances.ts";
import { ruleChecker, type Rule, type RuleTarget } from "./rules.ts";

// S2: what waits for a decision, in Review's groups.

/** An uncategorized, counted transaction. */
export interface ReviewTarget extends RuleTarget {
  id: number;
  date: string;
  time: string | null;
}

/** The category the rules agree on now, and the rule credited with it. */
export interface Suggestion {
  categoryId: number;
  ruleId: number;
}

export interface ReviewGroups<T extends ReviewTarget> {
  /**
   * Newest first. A suggestion means a rule would categorize it now: it was
   * saved without applying it, or the other rule of a conflict was deleted.
   */
  uncategorized: (T & { suggestion: Suggestion | null })[];
  /** Newest first, with the rules that match and the categories they give. */
  conflicts: (T & { ruleIds: number[]; categoryIds: number[] })[];
}

/** Sorts uncategorized transactions into Review's groups. */
export function reviewGroups<T extends ReviewTarget>(
  transactions: T[],
  rules: Rule[],
): ReviewGroups<T> {
  const check = ruleChecker(rules);
  const newest = transactions.toSorted(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.time ?? "").localeCompare(a.time ?? "") ||
      b.id - a.id,
  );
  const groups: ReviewGroups<T> = { uncategorized: [], conflicts: [] };
  for (const t of newest) {
    const outcome = check(t);
    if (outcome.kind === "conflict") {
      groups.conflicts.push({
        ...t,
        ruleIds: outcome.rules.map((r) => r.id),
        categoryIds: [...new Set(outcome.rules.map((r) => r.categoryId))],
      });
    } else {
      groups.uncategorized.push({
        ...t,
        suggestion:
          outcome.kind === "category"
            ? { categoryId: outcome.categoryId, ruleId: outcome.ruleId }
            : null,
      });
    }
  }
  return groups;
}

/**
 * The end of a gap that Review shows: where the app's balance and the
 * bank's differ more, the later on a tie. With one gap that's the end where
 * they differ; the other end is where they match, often the anchor.
 */
export function shownEnd({
  after,
  until,
  balances,
}: Pick<BalanceGap<unknown>, "after" | "until" | "balances">): BothBalances & {
  date: string;
} {
  const off = ({ app, bank }: BothBalances) => Math.abs(bank - app);
  return off(balances.after) > off(balances.until)
    ? { date: after, ...balances.after }
    : { date: until, ...balances.until };
}
