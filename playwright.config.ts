import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'live-ui',
      testMatch: /live-(guest-navigation|guest-chat|guest-search-files|release-notes)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.LIVE_BASE_URL || 'http://127.0.0.1:9',
      },
    },
    {
      name: 'live-mobile',
      testMatch: /live-mobile-navigation\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: process.env.LIVE_BASE_URL || 'http://127.0.0.1:9',
      },
    },
  ],
});
