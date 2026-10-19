import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof openDatabase>;

/**
 * Opens the SQLite database in `file`, or a throwaway one for ":memory:", and
 * brings its tables up to date.
 */
export function openDatabase(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: resolve(import.meta.dirname, "migrations") });
  return db;
}
