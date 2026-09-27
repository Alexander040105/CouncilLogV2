import { defineConfig } from '@playwright/test';

// Live E2E: expects the API on :8000 and `vite dev` on :5173 (real Supabase).
// Dev accounts mirror api/tests/smoke_e2e.py — override via env if needed.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // shared live backend + shared dev users — run serially
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth-setup\.spec\.js/,
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'noauth',
      testMatch: /noauth\.spec\.js/,
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testMatch: /app\.spec\.js/,
      use: { storageState: 'e2e/.auth/user.json' },
    },
    {
      name: 'mobile-360',
      dependencies: ['setup'],
      testMatch: /mobile\.spec\.js/,
      use: { storageState: 'e2e/.auth/user.json', viewport: { width: 360, height: 800 } },
    },
  ],
});
