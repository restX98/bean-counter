import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const root = resolve(import.meta.dirname, "../..");
const dbFile =
  process.env.BEAN_COUNTER_DB ?? resolve(root, "data/bean-counter.db");
// vite.config.ts proxies /api to this port in development.
const port = Number(process.env.PORT ?? 4280);
const production = process.env.NODE_ENV === "production";

mkdirSync(dirname(dbFile), { recursive: true });
const app = buildApp({
  db: openDatabase(dbFile),
  webDir: production ? resolve(root, "dist/web") : undefined,
  log: true,
});

// Localhost only: the data never leaves this machine.
const address = await app.listen({ host: "127.0.0.1", port });
console.log(
  production
    ? `Bean Counter is running at ${address}`
    : `API listening at ${address}; open the app at the Vite address`,
);
