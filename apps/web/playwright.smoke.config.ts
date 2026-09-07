import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'pnpm exec vite --config vite.smoke.config.ts',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
  },
})
