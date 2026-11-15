import {defineConfig, devices} from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 45_000,
  expect: {timeout: 10_000},
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: {width: 1280, height: 900},
    channel:
      process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command:
      'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3001',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DIST_DIR: '.next-e2e',
      // Isolate browser tests from the developer's real store and paid model API.
      SHOPIFY_STORE_DOMAIN: '',
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: '',
      SHOPIFY_TEST_CHECKOUT_ENABLED: 'false',
      GEMINI_API_KEY: '',
      ENABLE_LIVE_AI: 'false',
    },
  },
});
