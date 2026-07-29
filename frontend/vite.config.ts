import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 127.0.0.1 rather than localhost: Node resolves localhost to ::1 first,
      // and uvicorn bound to 127.0.0.1 does not answer there.
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    // Testing Library registers its cleanup only when afterEach is global.
    globals: true,
  },
})
