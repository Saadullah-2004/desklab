import {defineConfig, devices} from '@playwright/test';

const baseURL = 'http://127.0.0.1:3001';

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
    viewport: {width: 1280, height: 900},
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel:
          process.env.PLAYWRIGHT_CHANNEL ??
          (process.env.CI ? undefined : 'chrome'),
      },
    },
    {name: 'webkit', use: {...devices['Desktop Safari']}},
  ],
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next build && "${process.execPath}" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DIST_DIR: '.next-e2e',
      APP_ORIGIN: baseURL,
      RATE_LIMIT_BACKEND: 'memory',
      RATE_LIMIT_CLIENT_IP_HEADER: 'x-forwarded-for',
      RATE_LIMIT_IP_HASH_SECRET:
        'isolated-browser-tests-not-a-production-secret',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      // Isolate browser tests from the developer's real store and paid model API.
      SHOPIFY_STORE_DOMAIN: '',
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: '',
      SHOPIFY_TEST_CHECKOUT_ENABLED: 'false',
      GEMINI_API_KEY: '',
      ENABLE_LIVE_AI: 'false',
      GEMINI_FREE_TIER_CONFIRMED: 'false',
    },
  },
});
