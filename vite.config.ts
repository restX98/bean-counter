import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Must match the default PORT in src/server/main.ts.
const SERVER = "http://127.0.0.1:4280";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // Not Vite's default 5173, so it doesn't clash with other projects.
    port: 4281,
    strictPort: true,
    proxy: { "/api": SERVER },
  },
  build: { outDir: "dist/web", emptyOutDir: true },
  test: {
    include: ["src/**/*.test.ts"],
    // pnpm test:coverage. UI tests are optional, so only the domain and the
    // server are measured.
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/server/**/*.ts"],
      exclude: ["**/*.test.ts", "src/server/main.ts"],
      reporter: ["text-summary", "html"],
      // Domain logic must have unit tests (CLAUDE.md): it can't slip below
      // where it is now, give or take an edge case.
      thresholds: {
        "src/domain/**/*.ts": {
          lines: 98,
          functions: 98,
          statements: 98,
          branches: 95,
        },
      },
    },
  },
});
