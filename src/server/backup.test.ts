import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDatabase(":memory:"), today: () => "2026-10-24" });
  return () => app.close();
});

async function addAccount(name: string) {
  await app.inject({
    method: "POST",
    url: "/api/accounts",
    payload: { name, bank: "Bank A", type: "checking", currency: "EUR" },
  });
}

async function accountNames() {
  const res = await app.inject({ method: "GET", url: "/api/accounts" });
  return (res.json().accounts as { name: string }[]).map((a) => a.name);
}

const restore = (payload: Buffer) =>
  app.inject({
    method: "POST",
    url: "/api/restore",
    headers: { "content-type": "application/octet-stream" },
    payload,
  });

describe("backup and restore", () => {
  it("downloads all data as one file and remembers the day", async () => {
    const res = await app.inject({ method: "GET", url: "/api/backup" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="bean-counter-backup-2026-10-24.db"',
    );
    expect(res.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");
    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json().lastBackup).toBe("2026-10-24");
  });

  it("replaces all current data with the backup's", async () => {
    await addAccount("Main checking");
    const backup = (await app.inject({ method: "GET", url: "/api/backup" }))
      .rawPayload;
    await addAccount("Savings");

    expect((await restore(backup)).statusCode).toBe(200);
    expect(await accountNames()).toEqual(["Main checking"]);
    // Ids carry on from the backup's.
    await addAccount("US account");
    const res = await app.inject({ method: "GET", url: "/api/accounts" });
    expect(res.json().accounts.map((a: { id: number }) => a.id)).toEqual([
      1, 2,
    ]);
  });

  it("refuses a file that isn't a backup and keeps the data", async () => {
    await addAccount("Main checking");
    const empty = openDatabase(":memory:").$client;
    empty.exec("drop table accounts");

    for (const file of [
      Buffer.from("Date,Description,Amount\n"),
      empty.serialize(),
    ]) {
      const res = await restore(file);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("This file isn't a Bean Counter backup.");
    }
    expect(await accountNames()).toEqual(["Main checking"]);
  });
});
