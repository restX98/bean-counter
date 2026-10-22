import fastifyStatic from "@fastify/static";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError } from "fastify";
import { todayIso } from "../domain/dates.ts";
import { accountRoutes } from "./accounts.ts";
import { categoryRoutes } from "./categories.ts";
import type { Db } from "./db/index.ts";
import { importRoutes } from "./imports.ts";
import { reviewRoutes } from "./review.ts";
import { ruleRoutes } from "./rules.ts";
import { transactionRoutes } from "./transactions.ts";

export interface AppOptions {
  db: Db;
  /** Folder with the built UI. Left out in development, where Vite serves the UI. */
  webDir?: string;
  /** Log warnings and errors (off in tests). */
  log?: boolean;
  /** Today's date, YYYY-MM-DD. Tests fix it. */
  today?: () => string;
}

export function buildApp({
  db,
  webDir,
  log = false,
  today = () => todayIso(),
}: AppOptions) {
  const app = Fastify({ logger: log ? { level: "warn" } : false });

  accountRoutes(app, { db, today });
  categoryRoutes(app, { db });
  ruleRoutes(app, { db });
  importRoutes(app, { db, today });
  transactionRoutes(app, { db });
  reviewRoutes(app, { db });

  app.get("/api/health", () => {
    const row = db.get<{ version: string }>(
      sql`select sqlite_version() as version`,
    );
    return { ok: true, sqlite: row.version };
  });

  if (webDir) app.register(fastifyStatic, { root: webDir });

  // Every error answers { error: message }, like the routes' own errors, so
  // the UI reads them all the same way.
  app.setNotFoundHandler((request, reply) => {
    // The UI has its own routes, so any other page gets index.html.
    if (
      webDir &&
      request.method === "GET" &&
      !request.url.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Fastify's own errors carry a status; anything else thrown is a 500.
    const status = error.statusCode ?? 500;
    // A malformed request: Fastify's message says what's wrong with it.
    if (status < 500) return reply.code(status).send({ error: error.message });
    request.log.error(error);
    return reply
      .code(500)
      .send({ error: "Something went wrong on the server." });
  });

  return app;
}
