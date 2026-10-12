import { defineConfig, devices } from '@playwright/test';

// The browser suite runs the production build against its own database
// (E2E_DATABASE_URL), reset by `npm run e2e` before every run.
const PORT = 3200;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://r1:r1@localhost:5432/r1_e2e';
export const E2E_ADMIN = { username: 'admin', password: 'e2e-admin-password' };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'lv-LV',
    timezoneId: 'Europe/Riga',
    // Use a preinstalled Chromium when one is provided (sandboxes, some CI images).
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB,
      AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
      ADMIN_USERNAME: E2E_ADMIN.username,
      ADMIN_PASSWORD: E2E_ADMIN.password,
    },
  },
});
