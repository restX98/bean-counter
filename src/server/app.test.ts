import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db/index.ts";

describe("GET /api/health", () => {
  it("answers with the SQLite version", async () => {
    const app = buildApp({ db: openDatabase(":memory:") });
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      sqlite: expect.stringMatching(/^3\.\d+\.\d+$/),
    });
    await app.close();
  });
});

describe("errors", () => {
  const app = buildApp({ db: openDatabase(":memory:") });
  app.get("/api/broken", () => {
    throw new Error("database is locked");
  });
  afterAll(() => app.close());

  it("answers unknown API routes with a JSON 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found" });
  });

  it("explains a malformed request in the same shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it("hides the details of a server failure", async () => {
    const res = await app.inject({ method: "GET", url: "/api/broken" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: "Something went wrong on the server.",
    });
  });
});

describe("serving the built UI", () => {
  const webDir = mkdtempSync(join(tmpdir(), "bean-counter-web-"));
  writeFileSync(join(webDir, "index.html"), "<p>app</p>");
  afterAll(() => rmSync(webDir, { recursive: true }));

  it("sends index.html for the UI's own routes", async () => {
    const app = buildApp({ db: openDatabase(":memory:"), webDir });
    const res = await app.inject({ method: "GET", url: "/transactions" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<p>app</p>");
    await app.close();
  });

  it("answers unknown API routes with a JSON 404", async () => {
    const app = buildApp({ db: openDatabase(":memory:"), webDir });
    const res = await app.inject({ method: "GET", url: "/api/nope" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found" });
    await app.close();
  });
});
