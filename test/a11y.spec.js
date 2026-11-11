import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const islands = 'voyage-sea, voyage-hud, voyage-log, voyage-chart, voyage-reading';

// The sea is drawn in software here, at under a frame a second for a full canvas. A low device
// pixel ratio keeps the CSS layout of a small window while the canvas has a sixteenth of the pixels.
test.use({
  viewport: { width: 640, height: 480 },
  deviceScaleFactor: 0.25,
  reducedMotion: 'reduce',
});

test.setTimeout(240_000);

/**
 * The HUD, chart and reading panel are defined when they first come into view, so with the
 * splash open only the sea and the log are upgraded.
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector]
 * @param {number} [count]
 */
async function upgraded(page, selector = islands, count = 5) {
  await page.waitForFunction(([tags, expected]) => {
    const found = [...document.querySelectorAll(String(tags))];
    return found.length === expected && found.every((element) => element.matches(':defined'));
  }, /** @type {const} */ ([selector, count]));
  await expect(page.locator('voyage-sea')).toHaveAttribute('live');
}

test('/ passes axe after the islands upgrade, with the splash open', async ({ page }) => {
  await page.goto('/');
  await upgraded(page, 'voyage-sea, voyage-log', 2);
  await expect(page.locator('voyage-log [data-card="splash"]')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});

/** @param {import('@playwright/test').Page} page */
async function weighAnchor(page) {
  await page.goto('/');
  await upgraded(page, 'voyage-sea, voyage-log', 2);
  await page.locator('voyage-log [data-next="intro"]').click();
  await expect(page.locator('voyage-log [data-card="intro"]')).toBeVisible();
}

test('/ passes axe with the intro open', async ({ page }) => {
  await weighAnchor(page);
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});

test('/ passes axe at sea, with the splash and intro dismissed', async ({ page }) => {
  await weighAnchor(page);
  await page.locator('voyage-log [data-card="intro"] [data-close]').click();
  await expect(page.locator('voyage-log [data-card][data-open]')).toHaveCount(0);
  await upgraded(page);
  await expect(page.locator('voyage-hud')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});

test('/ passes axe at sea with the reading panel and the chart open', async ({ page }) => {
  await weighAnchor(page);
  await page.locator('voyage-log [data-card="intro"] [data-close]').click();
  await upgraded(page);
  await page.keyboard.press('r');
  await expect(page.locator('voyage-reading [data-reading-panel]')).toBeVisible();
  const reading = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(reading.violations).toEqual([]);

  await page.keyboard.press('r');
  await page.keyboard.press('m');
  await expect(page.locator('voyage-chart dialog')).toBeVisible();
  const chart = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(chart.violations).toEqual([]);
});

test('/ passes axe when no module loads', async ({ page }) => {
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('voyage-sea')).not.toHaveAttribute('live');
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});
