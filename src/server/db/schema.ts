import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// After changing this file, run `pnpm db:generate` to add a migration.

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    bank: text("bank").notNull(),
    type: text("type", { enum: ["checking", "savings"] }).notNull(),
    /** ISO 4217 code. */
    currency: text("currency").notNull(),
    /** Balance anchor: the end-of-day balance on anchor_date, in minor units. */
    anchorAmount: integer("anchor_amount"),
    /** YYYY-MM-DD. */
    anchorDate: text("anchor_date"),
    anchorSource: text("anchor_source", { enum: ["manual", "statement"] }),
    /** YYYY-MM-DD, or null while the account is active. */
    archivedOn: text("archived_on"),
  },
  (t) => [
    check("accounts_type", sql`${t.type} in ('checking', 'savings')`),
    // The three anchor columns are all set or all empty.
    check(
      "accounts_anchor",
      sql`(${t.anchorAmount} is null) = (${t.anchorDate} is null) and (${t.anchorDate} is null) = (${t.anchorSource} is null)`,
    ),
    check(
      "accounts_anchor_source",
      sql`${t.anchorSource} is null or ${t.anchorSource} in ('manual', 'statement')`,
    ),
  ],
);
