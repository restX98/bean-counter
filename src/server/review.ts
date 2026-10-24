import { isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { reviewGroups, shownEnd } from "../domain/review.ts";
import { transfersToPick } from "../domain/transfers.ts";
import type { Db } from "./db/index.ts";
import { accounts } from "./db/schema.ts";
import { findPossiblePaybacks } from "./paybacks.ts";
import { loadRules, loadUncategorized } from "./rules.ts";
import { loadLedger } from "./transactions.ts";
import { findTransfers } from "./transfers.ts";

export function reviewRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S2: what the app can't decide on its own, in Review's groups, and how
  // many items wait in all: the money in that may pay back expenses, the
  // transactions waiting for a category, the transfers whose other side I
  // pick, the pairs across currencies that could be an exchange, and each
  // place where an account's balances and the bank's part ways. A possible
  // transfer and its candidates wait for that decision first, then a
  // possible payback. Archived accounts can't change, so they're left out.
  app.get("/api/review", () => {
    const found = findTransfers(db);
    const { candidates, exchanges: pairs } = found;
    const possible = findPossiblePaybacks(db, found);
    const suggested = new Set(possible.map((t) => t.id));
    const { uncategorized, conflicts } = reviewGroups(
      loadUncategorized(db).filter(
        (t) => !candidates.has(t.id) && !suggested.has(t.id),
      ),
      loadRules(db),
    );
    const paybacks = possible
      .map((t) => ({
        id: t.id,
        date: t.date,
        time: t.time,
        description: t.description,
        amount: t.amount,
        accountId: t.accountId,
        currency: t.currency,
        expenses: t.expenses.map((e) => ({
          id: e.id,
          accountId: e.accountId,
          date: e.date,
          time: e.time,
          amount: e.amount,
          description: e.description,
          categoryId: e.categoryId,
          left: e.left,
        })),
      }))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.time ?? "").localeCompare(a.time ?? "") ||
          b.id - a.id,
      );
    const transfers = transfersToPick(candidates)
      .map((t) => ({
        id: t.id,
        date: t.date,
        time: t.time,
        description: t.description,
        amount: t.amount,
        accountId: t.accountId,
        currency: t.currency,
        candidates: t.candidates.map((c) => ({
          id: c.id,
          accountId: c.accountId,
          date: c.date,
          time: c.time,
          amount: c.amount,
          description: c.description,
        })),
      }))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.time ?? "").localeCompare(a.time ?? "") ||
          b.id - a.id,
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
    // Newest first, by the money going out.
    const side = (t: (typeof pairs)[number]["out"]) => ({
      id: t.id,
      accountId: t.accountId,
      date: t.date,
      time: t.time,
      amount: t.amount,
      description: t.description,
    });
    const exchanges = pairs
      .map((pair) => ({
        ...side(pair.out),
        currency: pair.out.currency,
        other: side(pair.in),
      }))
      .reverse();
    return {
      paybacks,
      uncategorized,
      conflicts,
      transfers,
      exchanges,
      mismatches,
      count:
        paybacks.length +
        uncategorized.length +
        conflicts.length +
        transfers.length +
        exchanges.length +
        mismatches.length,
    };
  });
}
