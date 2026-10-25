import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// pnpm e2e. The built app runs on its own port, with a throwaway database
// that each run starts empty: never the one in data/. E2E_PORT runs another
// copy alongside, such as next to UI mode, each with its own database.
const PORT = Number(process.env.E2E_PORT ?? 4290);
const DB = join(tmpdir(), `bean-counter-e2e-${PORT}.db`);

export default defineConfig({
  testDir: "e2e",
  // One server, one database: the tests take turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Saves the states the tests start from (see e2e/states.ts).
    { name: "states", testMatch: /states\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["states"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1024 },
      },
    },
    {
      name: "mobile",
      dependencies: ["states"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `rm -f "${DB}" "${DB}-wal" "${DB}-shm" && pnpm build && pnpm exec tsx src/server/main.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { NODE_ENV: "production", PORT: String(PORT), BEAN_COUNTER_DB: DB },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
