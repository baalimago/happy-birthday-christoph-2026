import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Opens the game with the sea's own module held back, puts the page in game mode by hand
 * and loads the chart.
 * @param {import('@playwright/test').Page} page
 */
async function openSea(page) {
  // A captain who has sailed before: a new voyage would open the splash, which hides the HUD and chart.
  await page.addInitScript(() =>
    localStorage.setItem(
      'philosophers-voyage:v2',
      JSON.stringify({ found: [], view: 'poster', sailed: true }),
    ),
  );
  await page.route('**/voyage-sea/voyage-sea.js', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    document.querySelector('voyage-sea')?.toggleAttribute('live', true);
    await import('#components/voyage-chart/voyage-chart.js');
  });
  await expect(page.locator('voyage-chart:defined')).toHaveCount(1);
  return page.locator('voyage-chart');
}

/** @param {import('@playwright/test').Page} page */
function unrolled(page) {
  return page.evaluate(async () => (await import('#stores/passage.js')).passage.state.chart);
}

test('is out of sight ashore, and M does nothing there', async ({ page }) => {
  await page.route('**/voyage-sea/voyage-sea.js', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() => import('#components/voyage-chart/voyage-chart.js'));
  await expect(page.locator('voyage-chart:defined')).toHaveCount(1);
  await expect(page.locator('voyage-chart button[data-chart-toggle]')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('voyage-chart dialog')).not.toHaveAttribute('open');
  expect(await unrolled(page)).toBe(false);
});

test('the button unrolls the chart and tells the store; closing tells it too', async ({ page }) => {
  await openSea(page);
  const button = page.getByRole('button', { name: 'Map', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'M');
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await button.click();
  const dialog = page.getByRole('dialog', { name: /chart/i });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
  expect(await unrolled(page)).toBe(true);
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  await dialog.getByRole('button', { name: 'Roll up the chart' }).click();
  await expect(dialog).toBeHidden();
  expect(await unrolled(page)).toBe(false);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('M opens and closes it, Esc closes it, and typing is left alone', async ({ page }) => {
  await openSea(page);
  const dialog = page.locator('voyage-chart dialog');

  await page.keyboard.press('m');
  await expect(dialog).toBeVisible();
  expect(await unrolled(page)).toBe(true);
  await page.keyboard.press('m');
  await expect(dialog).toBeHidden();
  expect(await unrolled(page)).toBe(false);

  await page.keyboard.press('m');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await unrolled(page)).toBe(false);

  // With a modifier, or in a field, M is somebody else's key.
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Shift+M');
  await expect(dialog).toBeHidden();
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch');
    document.querySelector('voyage-sea')?.append(field);
    field.focus();
  });
  await page.keyboard.press('m');
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Scratch')).toHaveValue('m');
  expect(await unrolled(page)).toBe(false);
});

test('follows the store when the map is unrolled or put away elsewhere', async ({ page }) => {
  await openSea(page);
  const dialog = page.locator('voyage-chart dialog');
  await page.evaluate(async () => (await import('#stores/passage.js')).passage.unroll(true));
  await expect(dialog).toBeVisible();
  await page.evaluate(async () => (await import('#stores/passage.js')).passage.unroll(false));
  await expect(dialog).toBeHidden();
});

test('draws the chart once, on first opening, as paper with land and sea', async ({ page }) => {
  const chart = await openSea(page);
  const canvas = chart.locator('canvas');
  await expect(chart).not.toHaveAttribute('data-drawn');

  await page.keyboard.press('m');
  await expect(chart).toHaveAttribute('data-drawn', '', { timeout: 30_000 });
  const size = await canvas.evaluate((el) => /** @type {HTMLCanvasElement} */ (el).width);
  expect(size).toBeGreaterThanOrEqual(1200);
  expect(size).toBeLessThanOrEqual(2400);

  // Sample the picture: open sea is paper, the mainland in the south is darker land.
  const sample = await canvas.evaluate((el) => {
    const c = /** @type {HTMLCanvasElement} */ (el);
    const ctx = c.getContext('2d');
    /** @param {number} x @param {number} y share of the side, from the top left */
    const mean = (x, y) => {
      const d = ctx?.getImageData(Math.round(x * c.width), Math.round(y * c.height), 12, 12).data;
      let sum = 0;
      for (let i = 0; d && i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return d ? sum / (d.length / 4) / 3 : 0;
    };
    return { sea: mean(0.62, 0.52), land: mean(0.75, 0.925), fingerprint: c.toDataURL().length };
  });
  expect(sample.sea).toBeGreaterThan(190);
  expect(sample.land).toBeLessThan(sample.sea - 12);

  // Closing and opening again does not draw again.
  await page.keyboard.press('Escape');
  const marked = await canvas.evaluate((el) => {
    const c = /** @type {HTMLCanvasElement} */ (el);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 4, 4);
    }
    return true;
  });
  expect(marked).toBe(true);
  await page.keyboard.press('m');
  await page.waitForTimeout(600);
  const pixel = await canvas.evaluate((el) => {
    const ctx = /** @type {HTMLCanvasElement} */ (el).getContext('2d');
    return [...(ctx?.getImageData(1, 1, 1, 1).data ?? [])];
  });
  expect(pixel.slice(0, 3)).toEqual([255, 0, 255]);
});

test('names the places for those who cannot see the picture', async ({ page }) => {
  await openSea(page);
  await page.keyboard.press('m');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
  const names = await page.evaluate(async () => {
    const { FEATURES } = await import('#game/chart-data.js');
    return FEATURES.map((feature) => feature.name);
  });
  const text = (await dialog.innerText()) + (await dialog.locator('.visually-hidden').innerText());
  for (const name of names) expect(text, name).toContain(name);
});

test('on a phone the chart can be zoomed and scrolled, and stays inside the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const chart = await openSea(page);
  const button = chart.locator('button[data-chart-toggle]');
  const place = await button.boundingBox();
  expect(place?.width).toBeGreaterThanOrEqual(44);
  expect(place?.height).toBeGreaterThanOrEqual(44);
  expect((place?.y ?? 0) + (place?.height ?? 0)).toBeLessThan(740 / 3);

  await button.click();
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(740);

  const sheet = dialog.locator('[data-chart-sheet]');
  const canvas = dialog.locator('canvas');
  const width = () => canvas.evaluate((el) => el.getBoundingClientRect().width);
  const start = await width();
  // Larger than the screen from the start, so the names can be read; the sheet scrolls.
  expect(start).toBeGreaterThanOrEqual(640);
  expect(await sheet.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  expect(await width()).toBeGreaterThan(start * 1.3);
  await dialog.getByRole('button', { name: 'Zoom out' }).click();
  await dialog.getByRole('button', { name: 'Zoom out' }).click();
  await dialog.getByRole('button', { name: 'Zoom out' }).click();
  // All the way out the whole chart fits the sheet.
  const fit = await sheet.evaluate((el) => Math.min(el.clientWidth, el.clientHeight));
  expect(Math.abs((await width()) - fit)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: 'Zoom out' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('survives being moved: one listener for the key', async ({ page }) => {
  await openSea(page);
  await page.evaluate(() => {
    const element = document.querySelector('voyage-chart');
    const parent = element?.parentNode;
    element?.remove();
    if (element) parent?.append(element);
  });
  const dialog = page.locator('voyage-chart dialog');
  await page.keyboard.press('m');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('m');
  await expect(dialog).toBeHidden();
});

test('passes axe at sea in every view, with the chart rolled up and unrolled', async ({ page }) => {
  await openSea(page);
  await page.evaluate(async () => {
    await import('#components/voyage-hud/voyage-hud.js');
    const { voyage } = await import('#stores/voyage.js');
    const { passage } = await import('#stores/passage.js');
    voyage.setSail();
    for (const port of document.querySelectorAll('[data-port][data-view]')) {
      voyage.discover(/** @type {HTMLElement} */ (port).dataset.card ?? '');
    }
    voyage.damage(0.8);
    passage.report({ ...passage.state.log, heading: 1.2, speed: 0.3, relative: 0.2, windSpeed: 1 });
    passage.note('aground');
  });
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  for (const view of ['poster', 'terminal', 'gold', 'chart']) {
    await page.evaluate((id) => {
      const sea = document.querySelector('voyage-sea');
      if (sea instanceof HTMLElement) sea.dataset.view = id;
    }, view);
    const rolled = await new AxeBuilder({ page })
      .include('voyage-hud')
      .include('voyage-chart')
      .withTags(tags)
      .analyze();
    expect(rolled.violations, view).toEqual([]);
  }
  await page.keyboard.press('m');
  await expect(page.locator('voyage-chart')).toHaveAttribute('data-drawn', '', { timeout: 30_000 });
  // The chart fades in: measure its colours once it is fully there.
  await expect(page.locator('voyage-chart dialog')).toHaveCSS('opacity', '1');
  const open = await new AxeBuilder({ page }).include('voyage-chart').withTags(tags).analyze();
  expect(open.violations).toEqual([]);
});
