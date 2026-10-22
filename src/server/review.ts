import type { FastifyInstance } from "fastify";
import { reviewGroups } from "../domain/review.ts";
import type { Db } from "./db/index.ts";
import { loadRules, loadUncategorized } from "./rules.ts";

export function reviewRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S2: the transactions waiting for a category, in Review's groups, and how
  // many items wait in all. Archived accounts can't change, so they're left
  // out.
  app.get("/api/review", () => {
    const { uncategorized, conflicts } = reviewGroups(
      loadUncategorized(db),
      loadRules(db),
    );
    return {
      uncategorized,
      conflicts,
      count: uncategorized.length + conflicts.length,
    };
  });
}
