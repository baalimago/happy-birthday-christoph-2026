import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The reading panel is tested on its own: the real sea is kept from loading, the test raises
// `live` in its place and plays the sea's part by writing to the voyage store.

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ found?: string[], live?: boolean }} [voyage]
 */
async function openReading(page, { found = [], live = true } = {}) {
  await page.route('**/voyage-sea/voyage-sea.js', (route) => route.abort());
  await page.addInitScript(
    (state) => localStorage.setItem('philosophers-voyage:v2', JSON.stringify(state)),
    { found, view: 'poster', sailed: true },
  );
  await page.goto('/?wrap=never');
  await page.evaluate(async (raise) => {
    document.querySelector('voyage-sea')?.toggleAttribute('live', raise);
    await import('#components/voyage-reading/voyage-reading.js');
  }, live);
  await expect(page.locator('voyage-reading:defined')).toHaveCount(1);
  return page.locator('voyage-reading');
}

/** The readings as the game has them. @param {import('@playwright/test').Page} page */
const readings = (page) =>
  page.evaluate(async () => {
    const { READINGS } = await import('#game/readings.js');
    return READINGS.map(({ leg, work, author, year, text }) => ({
      leg: leg ?? '',
      work,
      author,
      year,
      first: text[0] ?? '',
    }));
  });

/**
 * @param {import('@playwright/test').Page} page
 * @param {string[]} ports
 */
const discover = (page, ports) =>
  page.evaluate(async (ids) => {
    const { voyage } = await import('#stores/voyage.js');
    for (const id of ids) voyage.discover(id);
  }, ports);

test('is out of sight ashore, and R does nothing there', async ({ page }) => {
  const reading = await openReading(page, { live: false });
  await expect(page.locator('.aids')).toBeHidden();
  await expect(reading.locator('[data-reading-toggle]')).toBeHidden();
  await page.keyboard.press('r');
  await expect(reading).not.toHaveAttribute('open');
});

test('the button opens and closes the panel', async ({ page }) => {
  const reading = await openReading(page);
  const toggle = reading.locator('[data-reading-toggle]');
  const panel = reading.locator('[data-reading-panel]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'R');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(reading).toHaveAttribute('open');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();

  await toggle.click();
  await expect(reading).not.toHaveAttribute('open');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
});

test('R opens and closes it, and typing in a field is left alone', async ({ page }) => {
  const reading = await openReading(page);
  await page.keyboard.press('r');
  await expect(reading).toHaveAttribute('open');
  await expect(reading.locator('[data-reading-panel]')).toBeVisible();
  await page.keyboard.press('R');
  await expect(reading).not.toHaveAttribute('open');

  await page.keyboard.press('Control+r');
  await expect(reading).not.toHaveAttribute('open');
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch');
    document.querySelector('voyage-sea')?.append(field);
    field.focus();
  });
  await page.keyboard.press('r');
  await expect(reading).not.toHaveAttribute('open');
  await expect(page.getByLabel('Scratch')).toHaveValue('r');
});

test('a fresh voyage offers the reading for the first port, wittgenstein', async ({ page }) => {
  const reading = await openReading(page);
  const all = await readings(page);
  const index = all.findIndex((entry) => entry.leg === 'wittgenstein');
  expect(index).toBeGreaterThanOrEqual(0);
  const expected = all[index];
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading.locator('[data-reading-title]')).toHaveText(expected.work);
  await expect(reading.locator('[data-reading-by]')).toContainText(
    `${expected.author}, ${expected.year}`,
  );
  await expect(reading.locator('[data-reading-text] p').first()).toHaveText(expected.first);
  await expect(reading.locator('[data-reading-count]')).toHaveText(`${index + 1} of ${all.length}`);
});

test('the reading follows the first port not yet found', async ({ page }) => {
  const reading = await openReading(page, { found: ['wittgenstein', 'juniper'] });
  const all = await readings(page);
  /** @param {string} leg */
  const expectLeg = async (leg) => {
    const index = all.findIndex((entry) => entry.leg === leg);
    expect(index, leg).toBeGreaterThanOrEqual(0);
    await expect(reading.locator('[data-reading-title]')).toHaveText(all[index].work);
    await expect(reading.locator('[data-reading-count]')).toHaveText(
      `${index + 1} of ${all.length}`,
    );
  };
  await reading.locator('[data-reading-toggle]').click();
  await expectLeg('quickjs');

  await discover(page, ['quickjs']);
  await expectLeg('edge');
});

test('the arrows leaf through the readings and wrap round', async ({ page }) => {
  const reading = await openReading(page);
  await reading.locator('[data-reading-toggle]').click();
  const title = reading.locator('[data-reading-title]');
  const count = reading.locator('[data-reading-count]');
  const total = await page.evaluate(
    async () => (await import('#game/readings.js')).READINGS.length,
  );
  const all = await readings(page);
  const first = all.findIndex((entry) => entry.leg === 'wittgenstein');
  await expect(count).toHaveText(`${first + 1} of ${total}`);

  await reading.locator('[data-reading-step="1"]').click();
  await expect(count).toHaveText(`${((first + 1) % total) + 1} of ${total}`);
  await expect(title).toHaveText(all[(first + 1) % total].work);

  await reading.locator('[data-reading-step="-1"]').click();
  await expect(count).toHaveText(`${first + 1} of ${total}`);

  // Walk all the way round: after `total` steps back it is the same reading again.
  for (let step = 0; step < total; step++) {
    await reading.locator('[data-reading-step="-1"]').click();
  }
  await expect(count).toHaveText(`${first + 1} of ${total}`);
  await expect(title).toHaveText(all[first].work);
});

test('"Put it away" closes the panel', async ({ page }) => {
  const reading = await openReading(page);
  await reading.locator('[data-reading-toggle]').click();
  await reading.locator('[data-reading-close]').click();
  await expect(reading).not.toHaveAttribute('open');
  await expect(reading.locator('[data-reading-panel]')).toBeHidden();
});

test('a new reading while closed marks the button fresh, and opening clears it', async ({
  page,
}) => {
  const reading = await openReading(page);
  // The first text is waiting when the page arrives; looking at it clears the mark.
  await expect(reading).toHaveAttribute('fresh');
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading).not.toHaveAttribute('fresh');
  await reading.locator('[data-reading-close]').click();
  await expect(reading).not.toHaveAttribute('fresh');

  await discover(page, ['wittgenstein']);
  await expect(reading).toHaveAttribute('fresh');
  await expect(reading).not.toHaveAttribute('open');

  await reading.locator('[data-reading-toggle]').click();
  await expect(reading).not.toHaveAttribute('fresh');
  const all = await readings(page);
  const work = (/** @type {string} */ leg) => all.find((entry) => entry.leg === leg)?.work ?? '';
  await expect(reading.locator('[data-reading-title]')).toHaveText(work('juniper'));

  // Open when the next port is found: the reader is looking, so nothing is marked.
  await discover(page, ['juniper']);
  await expect(reading.locator('[data-reading-title]')).toHaveText(work('quickjs'));
  await expect(reading).not.toHaveAttribute('fresh');
});

test('passes axe with the button alone and with the panel open', async ({ page }) => {
  const reading = await openReading(page);
  const closed = await new AxeBuilder({ page }).include('voyage-reading').withTags(tags).analyze();
  expect(closed.violations).toEqual([]);

  await reading.locator('[data-reading-toggle]').click();
  await expect(reading.locator('[data-reading-panel]')).toBeVisible();
  const open = await new AxeBuilder({ page }).include('voyage-reading').withTags(tags).analyze();
  expect(open.violations).toEqual([]);
});
