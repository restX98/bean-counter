import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export type Db = ReturnType<typeof openDatabase>;

/** Opens the SQLite database in `file`, or a throwaway one for ":memory:". */
export function openDatabase(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle({ client: sqlite });
}
