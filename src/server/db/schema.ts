import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { Mapping } from "../../domain/import/mapping.ts";
import type { Cell } from "../../domain/import/table.ts";

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

/** A bank's export format, saved so the next file like it skips the mapping. */
export const importPresets = sqliteTable(
  "import_presets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "Bank A · checking". */
    name: text("name").notNull(),
    /** The file's column names: a file with the same ones uses this preset. */
    columns: text("columns", { mode: "json" }).$type<string[]>().notNull(),
    mapping: text("mapping", { mode: "json" }).$type<Mapping>().notNull(),
  },
  (t) => [uniqueIndex("import_presets_columns").on(t.columns)],
);

/** One imported file. */
export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  presetId: integer("preset_id").references(() => importPresets.id, {
    onDelete: "set null",
  }),
  fileName: text("file_name").notNull(),
  /** YYYY-MM-DD. */
  importedOn: text("imported_on").notNull(),
  /** The columns and mapping used, so the raw rows can be read again. */
  columns: text("columns", { mode: "json" }).$type<string[]>().notNull(),
  mapping: text("mapping", { mode: "json" }).$type<Mapping>().notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    importId: integer("import_id")
      .notNull()
      .references(() => imports.id),
    /** The row's number in the file. */
    line: integer("line").notNull(),
    // As the file wrote them, never changed: duplicate detection relies on
    // them. Edits will get their own columns.
    /** YYYY-MM-DD. */
    date: text("date").notNull(),
    /** HH:MM:SS, when the file had times. */
    time: text("time"),
    /** Minor units, after any fee: negative for money going out. */
    amount: integer("amount").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    /** The bank's balance after this transaction, if the file had one. */
    bankBalance: integer("bank_balance"),
    /** Every cell of the file's row. */
    raw: text("raw", { mode: "json" }).$type<Cell[]>().notNull(),
    /** Ignored by balances, reports and budgets; still a duplicate on re-import. */
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    /** Kept although the import flagged it as a near-match of this one. */
    nearMatchOf: integer("near_match_of").references(
      (): AnySQLiteColumn => transactions.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("transactions_account_date").on(t.accountId, t.date)],
);

/**
 * A balance I entered (Set balance) that differed from the app's, kept to
 * look for what's missing. The account page compares it like the bank's.
 */
export const balanceChecks = sqliteTable(
  "balance_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    /** YYYY-MM-DD: the balance is the one at the end of that day. */
    date: text("date").notNull(),
    /** Minor units. */
    amount: integer("amount").notNull(),
  },
  // One a day: a newer one for the same day replaces it.
  (t) => [uniqueIndex("balance_checks_account_date").on(t.accountId, t.date)],
);
