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
  test: { include: ["src/**/*.test.ts"] },
});
