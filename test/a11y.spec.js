import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const islands = 'voyage-sea, voyage-hud, voyage-log';

// The sea is drawn in software here, at under a frame a second for a full canvas. A low device
// pixel ratio keeps the CSS layout of a small window while the canvas has a sixteenth of the pixels.
test.use({
  viewport: { width: 640, height: 480 },
  deviceScaleFactor: 0.25,
  reducedMotion: 'reduce',
});

test('/ passes axe after the islands upgrade', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction((selector) => {
    const found = [...document.querySelectorAll(selector)];
    return found.length === 3 && found.every((element) => element.matches(':defined'));
  }, islands);
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});

test('/ passes axe when no module loads', async ({ page }) => {
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('voyage-sea')).not.toHaveAttribute('live');
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations).toEqual([]);
});
