import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type Db, openDatabase } from "./db/index.ts";
import { settings } from "./db/schema.ts";

/** A backup holds everything, so it may be larger than a statement. */
const MAX_BACKUP = 200 * 1024 * 1024;

const NOT_A_BACKUP = "This file isn't a Bean Counter backup.";

/** The day I last downloaded a backup, YYYY-MM-DD, or null. */
export function lastBackup(db: Db) {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, "lastBackup"))
    .get();
  return (row?.value as string | undefined) ?? null;
}

export function backupRoutes(
  app: FastifyInstance,
  { db, today }: { db: Db; today: () => string },
) {
  // S18: a backup is a copy of the whole database.
  app.get("/api/backup", (_req, reply) => {
    const file = db.$client.serialize();
    db.insert(settings)
      .values({ key: "lastBackup", value: today() })
      .onConflictDoUpdate({ target: settings.key, set: { value: today() } })
      .run();
    return reply
      .header("content-type", "application/octet-stream")
      .header(
        "content-disposition",
        `attachment; filename="bean-counter-backup-${today()}.db"`,
      )
      .send(file);
  });

  // D8: all current data is replaced with the backup's. A backup from an
  // older version is first brought up to date, and the copy is one
  // transaction, so a restore that fails leaves the data as it was.
  app.post<{ Body: unknown }>(
    "/api/restore",
    { bodyLimit: MAX_BACKUP },
    (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        return reply
          .code(415)
          .send({ error: "Send the file as application/octet-stream." });
      }
      const dir = mkdtempSync(join(tmpdir(), "bean-counter-"));
      const file = join(dir, "backup.db");
      try {
        writeFileSync(file, req.body);
        if (!isBackup(file))
          return reply.code(400).send({ error: NOT_A_BACKUP });
        openDatabase(file).$client.close();
        replaceAll(db, file);
        return null;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

/** A sound SQLite file with this app's tables. */
function isBackup(file: string) {
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(file, { fileMustExist: true });
    const tables = new Set(
      sqlite
        .prepare("select name from sqlite_master where type = 'table'")
        .pluck()
        .all(),
    );
    return (
      tables.has("__drizzle_migrations") &&
      tables.has("accounts") &&
      sqlite.pragma("quick_check", { simple: true }) === "ok"
    );
  } catch {
    // Not a database at all.
    return false;
  } finally {
    sqlite?.close();
  }
}

/** Replaces every table's rows with those of the database in `file`. */
function replaceAll(db: Db, file: string) {
  const sqlite = db.$client;
  // Both are on the same migrations, so they have the same tables. The
  // AUTOINCREMENT counters in sqlite_sequence come along, so ids carry on
  // where the backup left off.
  const tables = sqlite
    .prepare(
      `select name from sqlite_master where type = 'table'
       and (name = 'sqlite_sequence'
         or (name not like 'sqlite%' and name <> '__drizzle_migrations'))`,
    )
    .pluck()
    .all() as string[];
  sqlite.prepare("attach database ? as backup").run(file);
  // Rows go in table by table, so a row can arrive before the one it
  // points to. foreign_keys can't change inside a transaction.
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      for (const table of tables) {
        const columns = (
          sqlite.pragma(`main.table_info("${table}")`) as { name: string }[]
        )
          .map((column) => `"${column.name}"`)
          .join(", ");
        sqlite.exec(`delete from main."${table}"`);
        sqlite.exec(
          `insert into main."${table}" (${columns}) select ${columns} from backup."${table}"`,
        );
      }
    })();
  } finally {
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec("detach database backup");
  }
}
