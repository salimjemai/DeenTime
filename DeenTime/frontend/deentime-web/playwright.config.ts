import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env['DEENTIME_WEB_URL'] ?? 'http://127.0.0.1:4200',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env['DEENTIME_CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    },
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: 'node e2e/external-origin-server.mjs',
    url: 'http://127.0.0.1:4300',
    reuseExistingServer: true,
    timeout: 15_000
  }
});
