import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone vitest config: vite.config.ts loads the TanStack Start plugin,
// which the plain-function tests here don't need (and shouldn't pay for).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
