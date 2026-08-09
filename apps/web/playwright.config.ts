import { defineConfig, devices } from '@playwright/test'
import { loadWebEnv } from './e2e/env'

loadWebEnv()

export const ORGANIZER_STORAGE_STATE = 'e2e/.auth/organizer.json'

// The suite runs against the local Vite dev server backed by the cloud dev
// Convex deployment. Convex functions are pushed by `convex dev` (or
// `convex dev --once`), not by this config — run the backend dev process when
// backend code has changed.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Driving a full tournament through the UI takes a while.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: ORGANIZER_STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
  ],
})
