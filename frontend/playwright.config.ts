/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 120000,
  fullyParallel: false, // Run tests sequentially to avoid shared state conflicts
  forbidOnly: !!process.env.CI,
  // No blanket retries (#337 AC 2): "always retry" masked the three
  // load-contention flakes for months — a red must mean something. Any future
  // per-spec retry needs an inline comment naming the upstream race and its
  // narrow signature (the run_frontend_suites.sh precedent).
  retries: 0,
  workers: 1, // Sequential execution needed for profile/sql tests sharing admin user
  reporter: 'html',
  use: {
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'public-e2e',
      testDir: './e2e/public',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL || 'http://localhost:4200', // Public site (dev default, override for CI/Docker)
      },
    },
    {
      name: 'admin-e2e',
      testDir: './e2e/admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_BASE_URL || 'http://admin.localhost', // Admin SPA origin
      },
    },
  ],
});
