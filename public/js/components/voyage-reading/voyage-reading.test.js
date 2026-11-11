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

test('is out of sight ashore, and L does nothing there', async ({ page }) => {
  const reading = await openReading(page, { live: false });
  await expect(page.locator('.aids')).toBeHidden();
  await expect(reading.locator('[data-reading-toggle]')).toBeHidden();
  await page.keyboard.press('l');
  await expect(reading).not.toHaveAttribute('open');
});

test('the button opens and closes the panel', async ({ page }) => {
  const reading = await openReading(page);
  const toggle = reading.locator('[data-reading-toggle]');
  const panel = reading.locator('[data-reading-panel]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'L');
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

test('L opens and closes it, and typing in a field is left alone', async ({ page }) => {
  const reading = await openReading(page);
  await page.keyboard.press('l');
  await expect(reading).toHaveAttribute('open');
  await expect(reading.locator('[data-reading-panel]')).toBeVisible();
  await page.keyboard.press('L');
  await expect(reading).not.toHaveAttribute('open');

  await page.keyboard.press('Control+r');
  await expect(reading).not.toHaveAttribute('open');
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch');
    document.querySelector('voyage-sea')?.append(field);
    field.focus();
  });
  await page.keyboard.press('l');
  await expect(reading).not.toHaveAttribute('open');
  await expect(page.getByLabel('Scratch')).toHaveValue('l');
});

test('a fresh voyage has an empty shelf: no passage can be read before a place is found', async ({
  page,
}) => {
  const reading = await openReading(page);
  const all = await readings(page);
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading.locator('[data-reading-title]')).toHaveText('The shelf is empty');
  await expect(reading.locator('[data-reading-count]')).toHaveText('nothing aboard yet');
  const page1 = (await reading.locator('[data-reading-text]').textContent()) ?? '';
  for (const { first } of all) expect(page1).not.toContain(first.slice(0, 40));
  await expect(reading.locator('[data-reading-step="1"]')).toBeDisabled();
  await expect(reading.locator('[data-reading-step="-1"]')).toBeDisabled();
});

test('each place found puts its own passage aboard, and only those can be read', async ({
  page,
}) => {
  const reading = await openReading(page);
  const all = await readings(page);
  const of = (/** @type {string} */ leg) => all.find((entry) => entry.leg === leg) ?? all[0];
  await reading.locator('[data-reading-toggle]').click();

  await discover(page, ['juniper']);
  await expect(reading.locator('[data-reading-title]')).toHaveText(of('juniper').work);
  await expect(reading.locator('[data-reading-by]')).toContainText(of('juniper').author);
  await expect(reading.locator('[data-reading-text] p').first()).toHaveText(of('juniper').first);
  await expect(reading.locator('[data-reading-count]')).toHaveText(
    `passage 1 of 1 aboard, ${all.length - 1} still to find`,
  );
  // One passage: nothing to leaf to.
  await expect(reading.locator('[data-reading-step="1"]')).toBeDisabled();

  await discover(page, ['plato']);
  await expect(reading.locator('[data-reading-title]')).toHaveText(of('plato').work);
  await expect(reading.locator('[data-reading-count]')).toHaveText(
    `passage 2 of 2 aboard, ${all.length - 2} still to find`,
  );
});

test('the arrows leaf through the passages aboard, in the order found, and wrap round', async ({
  page,
}) => {
  const reading = await openReading(page, { found: ['strand', 'edge', 'wittgenstein'] });
  const all = await readings(page);
  const work = (/** @type {string} */ leg) => all.find((entry) => entry.leg === leg)?.work ?? '';
  await reading.locator('[data-reading-toggle]').click();
  const title = reading.locator('[data-reading-title]');
  // It opens at the newest.
  await expect(title).toHaveText(work('wittgenstein'));
  await reading.locator('[data-reading-step="1"]').click();
  await expect(title).toHaveText(work('strand'));
  await reading.locator('[data-reading-step="1"]').click();
  await expect(title).toHaveText(work('edge'));
  await reading.locator('[data-reading-step="-1"]').click();
  await expect(title).toHaveText(work('strand'));
  await reading.locator('[data-reading-step="-1"]').click();
  await expect(title).toHaveText(work('wittgenstein'));
});

test('with all seven found the shelf is full', async ({ page }) => {
  const reading = await openReading(page);
  const all = await readings(page);
  await discover(
    page,
    all.map((entry) => entry.leg),
  );
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading.locator('[data-reading-count]')).toHaveText(
    `passage ${all.length} of ${all.length} aboard, the shelf is full`,
  );
});

test('a port card offers its passage, and taking the offer opens the book at it', async ({
  page,
}) => {
  const reading = await openReading(page, { found: ['juniper', 'plato'] });
  const all = await readings(page);
  await page.evaluate(() => {
    const offer = document.querySelector('#port-juniper [data-reading-open]');
    if (offer instanceof HTMLElement) offer.click();
  });
  await expect(reading).toHaveAttribute('open');
  await expect(reading.locator('[data-reading-title]')).toHaveText(
    all.find((entry) => entry.leg === 'juniper')?.work ?? '',
  );
});

test('Space and the Page keys turn the page while the book is open', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  const reading = await openReading(page, { found: ['edge'] });
  await page.keyboard.press('l');
  const text = reading.locator('[data-reading-text]');
  await expect(text).toBeVisible();
  const top = () => text.evaluate((element) => element.scrollTop);
  expect(await top()).toBe(0);
  await page.locator('body').click({ position: { x: 900, y: 250 } });
  await page.keyboard.press(' ');
  await expect.poll(top).toBeGreaterThan(50);
  await page.keyboard.press('PageUp');
  await expect.poll(top).toBe(0);
});

test('a new voyage empties the shelf again', async ({ page }) => {
  const reading = await openReading(page, { found: ['edge'] });
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading.locator('[data-reading-title]')).not.toHaveText('The shelf is empty');
  await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.reset());
  await expect(reading.locator('[data-reading-title]')).toHaveText('The shelf is empty');
  await expect(reading.locator('[data-reading-count]')).toHaveText('nothing aboard yet');
});

test('"Put it away" closes the panel', async ({ page }) => {
  const reading = await openReading(page);
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading).toHaveAttribute('open');
  await reading.locator('[data-reading-close]').click();
  await expect(reading).not.toHaveAttribute('open');
});

test('a passage coming aboard while the book is shut marks the button fresh, and opening clears it', async ({
  page,
}) => {
  const reading = await openReading(page);
  // Nothing new on arrival.
  await expect(reading).not.toHaveAttribute('fresh');
  await discover(page, ['wittgenstein']);
  await expect(reading).toHaveAttribute('fresh');
  await reading.locator('[data-reading-toggle]').click();
  await expect(reading).not.toHaveAttribute('fresh');
  // With the book open a new passage is simply shown.
  await discover(page, ['juniper']);
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
