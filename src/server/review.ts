import { isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { reviewGroups, shownEnd } from "../domain/review.ts";
import type { Db } from "./db/index.ts";
import { accounts } from "./db/schema.ts";
import { loadRules, loadUncategorized } from "./rules.ts";
import { loadLedger } from "./transactions.ts";

export function reviewRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S2: what the app can't decide on its own, in Review's groups, and how
  // many items wait in all: the transactions waiting for a category, and
  // each place where an account's balances and the bank's part ways.
  // Archived accounts can't change, so they're left out.
  app.get("/api/review", () => {
    const { uncategorized, conflicts } = reviewGroups(
      loadUncategorized(db),
      loadRules(db),
    );
    const mismatches = db
      .select()
      .from(accounts)
      .where(isNull(accounts.archivedOn))
      .all()
      .flatMap((account) =>
        loadLedger(db, account).gaps.map((gap, index) => ({
          accountId: account.id,
          currency: account.currency,
          // Its place in the account's list, to show it there.
          index,
          after: gap.after,
          until: gap.until,
          amount: gap.amount,
          balances: gap.balances,
        })),
      )
      // Newest first, like the other groups.
      .sort(
        (a, b) =>
          shownEnd(b).date.localeCompare(shownEnd(a).date) ||
          a.accountId - b.accountId,
      );
    return {
      uncategorized,
      conflicts,
      mismatches,
      count: uncategorized.length + conflicts.length + mismatches.length,
    };
  });
}
