import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The cloud workspace ships one Chromium whose revision need not match this @playwright/test.
// When it is there, launch it directly; anywhere else Playwright uses its own download.
const preinstalled = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const chromium = existsSync(preinstalled)
  ? { launchOptions: { executablePath: preinstalled } }
  : {};

// Firefox and WebKit run only when asked for: PW_ALL_BROWSERS=1 npm run test:browser
const others = process.env.PW_ALL_BROWSERS
  ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ]
  : [];

export default defineConfig({
  testMatch: ['test/**/*.spec.js', 'public/js/components/**/*.test.js'],
  // WebGL is drawn in software in a headless browser, so everything is slow.
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'python3 -m http.server 4173 --directory public',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    stderr: 'ignore',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } }, ...others],
});
