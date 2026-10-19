import fastifyStatic from "@fastify/static";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import type { Db } from "./db.ts";

export interface AppOptions {
  db: Db;
  /** Folder with the built UI. Left out in development, where Vite serves the UI. */
  webDir?: string;
  /** Log warnings and errors (off in tests). */
  log?: boolean;
}

export function buildApp({ db, webDir, log = false }: AppOptions) {
  const app = Fastify({ logger: log ? { level: "warn" } : false });

  app.get("/api/health", () => {
    const row = db.get<{ version: string }>(
      sql`select sqlite_version() as version`,
    );
    return { ok: true, sqlite: row.version };
  });

  if (webDir) {
    app.register(fastifyStatic, { root: webDir });
    // The UI has its own routes, so any other page gets index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
