import { test, expect } from '@playwright/test';

// The log is tested on its own: the real sea is kept from loading, the test raises `live` in its
// place and plays the sea's part by writing to the two stores.

const PORTS = ['wittgenstein', 'juniper', 'quickjs', 'edge', 'dioxus', 'strand'];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ found?: string[], sailed?: boolean, live?: boolean }} [voyage]
 */
async function board(page, { found = [], sailed = false, live = true } = {}) {
  await page.route('**/components/voyage-sea/voyage-sea.js', (route) => route.abort());
  await page.addInitScript(
    (state) => localStorage.setItem('philosophers-voyage:v1', JSON.stringify(state)),
    { found, view: 'poster', sailed },
  );
  await page.goto('/?wrap=never');
  await page.evaluate(async (raise) => {
    await import('/js/components/voyage-log/voyage-log.js');
    document.querySelector('voyage-sea')?.toggleAttribute('live', raise);
  }, live);
  await expect(page.locator('voyage-log:defined')).toHaveCount(1);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | null} port
 * @param {boolean} [discover]
 */
async function arriveAt(page, port, discover = true) {
  await page.evaluate(async ([at, isNew]) => {
    const { passage } = await import('/js/stores/passage.js');
    const { voyage } = await import('/js/stores/voyage.js');
    passage.arriveAt(at);
    if (at && isNew) voyage.discover(at);
  }, /** @type {[string | null, boolean]} */ ([port, discover]));
}

/** @param {import('@playwright/test').Page} page */
const reading = (page) =>
  page.evaluate(async () => (await import('/js/stores/passage.js')).passage.state.reading);

/** @param {import('@playwright/test').Page} page */
const voyageState = (page) =>
  page.evaluate(async () => (await import('/js/stores/voyage.js')).voyage.state);

/** @param {import('@playwright/test').Page} page */
const openCards = (page) => page.locator('voyage-log [data-card][data-open]');

test('ashore every card stays on the page and nothing opens', async ({ page }) => {
  await board(page, { live: false });
  await expect(openCards(page)).toHaveCount(0);
  await expect(page.locator('voyage-log .card:visible')).toHaveCount(8);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Philosopher's Voyage");
  expect(await reading(page)).toBe(false);
});

test('opens the intro on a new voyage, and closing it sets sail', async ({ page }) => {
  await board(page);
  await expect(openCards(page)).toHaveAttribute('data-card', 'intro');
  await expect(page.locator('voyage-log .card:visible')).toHaveCount(1);
  expect(await reading(page)).toBe(true);

  await page.getByRole('button', { name: 'Weigh anchor' }).click();
  await expect(openCards(page)).toHaveCount(0);
  expect(await reading(page)).toBe(false);
  expect((await voyageState(page)).sailed).toBe(true);
});

test('skips the intro once the captain has sailed', async ({ page }) => {
  await board(page, { sailed: true });
  await expect(openCards(page)).toHaveCount(0);
  expect(await reading(page)).toBe(false);
});

test('works when the sea comes alive after the log has upgraded', async ({ page }) => {
  await board(page, { live: false });
  await expect(openCards(page)).toHaveCount(0);
  await page.evaluate(() => document.querySelector('voyage-sea')?.toggleAttribute('live', true));
  await expect(openCards(page)).toHaveAttribute('data-card', 'intro');
  await page.evaluate(() => document.querySelector('voyage-sea')?.toggleAttribute('live', false));
  await expect(openCards(page)).toHaveCount(0);
  expect(await reading(page)).toBe(false);
});

test('a landfall opens that port card and sailing away closes it', async ({ page }) => {
  await board(page, { sailed: true });
  await arriveAt(page, 'juniper');
  await expect(openCards(page)).toHaveAttribute('data-card', 'juniper');
  await expect(page.getByRole('heading', { name: 'Juniper Isle' })).toBeVisible();
  await expect(page.locator('voyage-log [data-status]')).toContainText('Juniper Isle');
  expect(await reading(page)).toBe(true);

  await arriveAt(page, null);
  await expect(openCards(page)).toHaveCount(0);
  expect(await reading(page)).toBe(false);
});

test('a landfall replaces the intro and never takes the keyboard', async ({ page }) => {
  await board(page);
  await arriveAt(page, 'wittgenstein');
  await expect(openCards(page)).toHaveCount(1);
  await expect(openCards(page)).toHaveAttribute('data-card', 'wittgenstein');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('Escape and "Sail on" close a card, and focus goes to the sea', async ({ page }) => {
  await board(page, { sailed: true });
  await arriveAt(page, 'edge');
  await page.keyboard.press('Escape');
  await expect(openCards(page)).toHaveCount(0);

  await arriveAt(page, null);
  await arriveAt(page, 'quickjs');
  const close = page.getByRole('button', { name: 'Sail on' });
  await close.focus();
  await close.press('Enter');
  await expect(openCards(page)).toHaveCount(0);
  await expect(page.locator('voyage-sea')).toBeFocused();
  expect(await reading(page)).toBe(false);
});

test('focus leaves a card that sailing away hides', async ({ page }) => {
  await board(page, { sailed: true });
  await arriveAt(page, 'dioxus');
  await page.getByRole('button', { name: 'Sail on' }).focus();
  await arriveAt(page, null);
  await expect(page.locator('voyage-sea')).toBeFocused();
});

test('the finale waits for the last port card to close, then shows once', async ({ page }) => {
  await board(page, { sailed: true, found: PORTS.slice(0, 5) });
  await arriveAt(page, 'strand');
  await expect(openCards(page)).toHaveAttribute('data-card', 'strand');

  await page.getByRole('button', { name: 'Sail on' }).click();
  await expect(openCards(page)).toHaveAttribute('data-card', 'finale');
  expect(await reading(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(openCards(page)).toHaveCount(0);
  // Calling at a port again does not bring the finale back.
  await arriveAt(page, null);
  await arriveAt(page, 'edge', false);
  await arriveAt(page, null);
  await expect(openCards(page)).toHaveCount(0);
});

test('the finale greets a captain who comes back with every port found', async ({ page }) => {
  await board(page, { sailed: true, found: PORTS });
  await expect(openCards(page)).toHaveAttribute('data-card', 'finale');
});

test('"Sail it again" starts a new voyage', async ({ page }) => {
  await board(page, { sailed: true, found: PORTS });
  await page.getByRole('button', { name: 'Sail it again' }).click();
  await expect(openCards(page)).toHaveCount(0);
  expect(await voyageState(page)).toEqual({ found: [], view: 'poster', sailed: false });
  expect(await reading(page)).toBe(false);
});
