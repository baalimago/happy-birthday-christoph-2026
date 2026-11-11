import { test, expect } from '@playwright/test';

/**
 * Opens the game with the sea's own module held back, so nothing but the test writes the
 * stores, then puts the page in game mode by hand and loads the HUD.
 * @param {import('@playwright/test').Page} page
 */
async function openHud(page) {
  await page.route('**/voyage-sea/voyage-sea.js', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    document.querySelector('voyage-sea')?.toggleAttribute('live', true);
    await import('#components/voyage-hud/voyage-hud.js');
  });
  await expect(page.locator('voyage-hud:defined')).toHaveCount(1);
  return page.locator('voyage-hud');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string[]} ports port ids to mark as found
 */
async function discover(page, ports) {
  await page.evaluate(async (ids) => {
    const { voyage } = await import('#stores/voyage.js');
    for (const id of ids) voyage.discover(id);
  }, ports);
}

/** A boat reaching along on the port tack, sails a little too far in. */
const REACHING = {
  heading: 1.2,
  speed: 5.3,
  windFrom: 4.3,
  windSpeed: 1.05,
  relative: -1.4,
  sheet: 0.4,
  best: 0.55,
  trim: 0.7,
  engine: false,
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {Partial<typeof REACHING>} [change] what differs from the boat reaching along
 */
async function report(page, change = {}) {
  await page.evaluate(
    async (log) => {
      const { passage } = await import('#stores/passage.js');
      passage.report(log);
    },
    { ...REACHING, ...change },
  );
}

/**
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<number>} the element's own rotation in degrees
 */
function rotation(locator) {
  return locator.evaluate((el) => parseFloat(/** @type {SVGElement} */ (el).style.rotate));
}

test('ticks objectives off and marks the next one as the current step', async ({ page }) => {
  const hud = await openHud(page);
  const sail = hud.locator('li[data-goal="sail"]');
  const port = hud.locator('li[data-goal="port:wittgenstein"]');
  await expect(hud.locator('li[data-done]')).toHaveCount(0);
  await expect(sail).toHaveAttribute('aria-current', 'step');

  await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.setSail());
  await expect(sail).toHaveAttribute('data-done', '');
  await expect(sail.locator('[data-done-mark]')).toBeAttached();
  await expect(sail.locator('[data-done-mark]')).not.toHaveAttribute('hidden');
  await expect(sail).not.toHaveAttribute('aria-current');
  await expect(port).toHaveAttribute('aria-current', 'step');
  await expect(port.locator('[data-done-mark]')).toHaveAttribute('hidden');

  await discover(page, ['wittgenstein', 'juniper', 'quickjs']);
  await expect(port).toHaveAttribute('data-done', '');
  await expect(hud.locator('li[data-goal="ports:3"]')).toHaveAttribute('data-done', '');
  await expect(hud.locator('li[data-goal^="ports:"]').last()).not.toHaveAttribute('data-done');
  await expect(hud.locator('li[aria-current="step"]')).toHaveCount(1);
});

test('offers a view once its port is found and switches to it', async ({ page }) => {
  await openHud(page);
  const views = page.getByRole('group', { name: 'View' });
  await expect(views).toBeHidden();

  // Which port opens which view is the cards' business: read it from them.
  const unlocks = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-port][data-view]')].map((port) => [
        /** @type {HTMLElement} */ (port).dataset.view,
        /** @type {HTMLElement} */ (port).dataset.card,
      ]),
    ),
  );
  await discover(page, [unlocks.gold]);
  await expect(views).toBeVisible();
  await expect(views.getByRole('button')).toHaveText(['Poster', 'Gold']);
  await expect(views.getByRole('button', { name: 'Poster' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await views.getByRole('button', { name: 'Gold' }).press('Enter');
  await expect(views.getByRole('button', { name: 'Gold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(views.getByRole('button', { name: 'Poster' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(
    await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.state.view),
  ).toBe('gold');

  await discover(page, [unlocks.terminal, unlocks.chart]);
  await expect(views.getByRole('button')).toHaveText(['Poster', 'Terminal', 'Gold', 'Chart']);
});

test('turns the compass card under the lubber line and reads the heading out', async ({ page }) => {
  const hud = await openHud(page);
  await report(page);
  await expect(hud.locator('[data-heading]')).toHaveText('069');
  await expect(hud.locator('[data-point]')).toHaveText('ENE');
  expect(await rotation(hud.locator('[data-card]'))).toBeCloseTo(-68.8, 1);

  // Through north the card takes the short way round, and the figure never reads 360.
  await report(page, { heading: 6.2 });
  await expect(hud.locator('[data-heading]')).toHaveText('355');
  await expect(hud.locator('[data-point]')).toHaveText('N');
  await report(page, { heading: 0.05 });
  await expect(hud.locator('[data-heading]')).toHaveText('003');
  await report(page, { heading: 6.2825 });
  await expect(hud.locator('[data-heading]')).toHaveText('000');
  expect(Math.abs(await rotation(hud.locator('[data-card]')))).toBeLessThan(400);
  await report(page, { heading: Math.PI });
  await expect(hud.locator('[data-heading]')).toHaveText('180');
  await expect(hud.locator('[data-point]')).toHaveText('S');
});

test('shows the wind, the boom to leeward and the mark to trim to', async ({ page }) => {
  const hud = await openHud(page);
  await report(page);
  await expect(hud.locator('[data-wind]')).toHaveText('WSW');
  await expect(hud.locator('[data-wind-strength]')).toHaveText('fresh');
  // Wind over the port side: the arrow comes in from the left, the boom lies to starboard.
  expect(await rotation(hud.locator('[data-wind-arrow]'))).toBeCloseTo(-80.2, 1);
  const boom = await rotation(hud.locator('[data-boom]'));
  const best = await rotation(hud.locator('[data-best]'));
  expect(boom).toBeLessThan(0);
  expect(best).toBeLessThan(boom);
  await expect(hud.locator('[data-trim]')).toHaveText('fair');
  await expect(hud.locator('.instruments')).not.toHaveAttribute('data-trimmed');

  // Ease the sheet to the mark: boom and mark meet, and the read-out says so.
  await report(page, { sheet: 0.55, trim: 0.96 });
  expect(await rotation(hud.locator('[data-boom]'))).toBeCloseTo(best, 1);
  await expect(hud.locator('[data-trim]')).toHaveText('good');
  await expect(hud.locator('.instruments')).toHaveAttribute('data-trimmed', '');

  // On the other tack the boom crosses over.
  await report(page, { relative: 1.4, windSpeed: 0.6 });
  expect(await rotation(hud.locator('[data-boom]'))).toBeGreaterThan(0);
  await expect(hud.locator('[data-wind-strength]')).toHaveText('light');
  await report(page, { windSpeed: 0.8, trim: 0.1 });
  await expect(hud.locator('[data-wind-strength]')).toHaveText('moderate');
  await expect(hud.locator('[data-trim]')).toHaveText('luffing');
  await report(page, { trim: 0.4 });
  await expect(hud.locator('[data-trim]')).toHaveText('poor');
});

test('warns when the boat lies in irons, unless the engine runs', async ({ page }) => {
  const hud = await openHud(page);
  const irons = hud.locator('[data-irons-note]');
  await report(page);
  await expect(irons).toBeHidden();

  await report(page, { relative: 0.3, trim: 0.05, speed: 0.2 });
  await expect(irons).toBeVisible();
  await expect(irons).toHaveText('In irons: bear away or start the engine');

  await report(page, { relative: 0.3, trim: 0.05, speed: 2, engine: true });
  await expect(irons).toBeHidden();
  await expect(hud.locator('[data-power]')).toHaveText('under engine');
});

test('gives the speed in knots and says what drives the boat', async ({ page }) => {
  const hud = await openHud(page);
  await expect(hud.locator('[data-speed]')).toHaveText('0.0');
  await expect(hud.locator('[data-power]')).toHaveText('stopped');
  await report(page);
  await expect(hud.locator('[data-speed]')).toHaveText('5.3');
  await expect(hud.locator('[data-power]')).toHaveText('under sail');
  await report(page, { speed: 3.44, engine: true });
  await expect(hud.locator('[data-speed]')).toHaveText('3.4');
  await expect(hud.locator('[data-power]')).toHaveText('under engine');
});

test('shows the hull, and sounds the alarm below 30 percent in more than colour', async ({
  page,
}) => {
  const hud = await openHud(page);
  const low = hud.locator('[data-hull-low]');
  await expect(hud.locator('[data-hull]')).toHaveText('100');
  await expect(low).toBeHidden();

  await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.damage(0.55));
  await expect(hud.locator('[data-hull]')).toHaveText('45');
  await expect(low).toBeHidden();
  await expect(hud.locator('.hull')).not.toHaveAttribute('data-low');

  await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.damage(0.21));
  await expect(hud.locator('[data-hull]')).toHaveText('24');
  await expect(low).toBeVisible();
  await expect(low).toContainText('low');
  await expect(hud.locator('.hull')).toHaveAttribute('data-low', '');
  await expect(hud.locator('[data-readout]')).toContainText('Hull 24 percent, low.');

  await page.evaluate(async () => (await import('#stores/voyage.js')).voyage.repair());
  await expect(hud.locator('[data-hull]')).toHaveText('100');
  await expect(low).toBeHidden();
});

test('reads the instruments out as one sentence, no more than once a second', async ({ page }) => {
  const hud = await openHud(page);
  const readout = hud.locator('[data-readout]');
  await expect(hud.getByRole('group', { name: 'Instruments' })).toBeVisible();
  // The dials and figures are for the eye; the sentence is for everyone else.
  await expect(hud.locator('.gauges')).toHaveAttribute('aria-hidden', 'true');
  await expect(readout).not.toHaveAttribute('aria-live');

  await page.waitForTimeout(1100);
  await report(page);
  await expect(readout).toHaveText(
    'Heading 69 degrees, east-north-east. Wind from the west-south-west, fresh, ' +
      '80 degrees to port. 5.3 knots, under sail. Trim fair. Hull 100 percent.',
  );

  // A burst of reports changes the sentence once, to the last of them.
  const changes = await page.evaluate(async () => {
    const { passage } = await import('#stores/passage.js');
    const target = document.querySelector('voyage-hud [data-readout]');
    let count = 0;
    const observer = new MutationObserver(() => count++);
    if (target) observer.observe(target, { childList: true, characterData: true, subtree: true });
    for (let i = 1; i <= 8; i++) {
      passage.report({ ...passage.state.log, heading: 1.2 + i * 0.1 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    observer.disconnect();
    return count;
  });
  expect(changes).toBe(1);
  await expect(readout).toContainText('Heading 115 degrees, east-south-east.');
});

test('announces grounding, the edge, a wreck, repairs and arrival, then falls silent', async ({
  page,
}) => {
  await openHud(page);
  const status = page.locator('voyage-hud [data-notice]');
  await expect(status).toHaveText('');
  /** @param {string} notice */
  const note = (notice) =>
    page.evaluate(async (text) => {
      const { passage } = await import('#stores/passage.js');
      passage.note(/** @type {import('#stores/passage.js').Notice} */ (text));
    }, notice);

  await note('luffing');
  await expect(status).toHaveText('');
  await note('aground');
  await expect(status).toHaveText('Aground! The hull takes damage. Back off and steer round.');
  await note('edge');
  await expect(status).toHaveText('Here be dragons. The wind turns you back.');
  await note('wrecked');
  await expect(status).toHaveText('Holed and sinking. Towed back to the last port for repairs.');
  await note('repaired');
  await expect(status).toHaveText('Hull repaired in port.');

  const name = (await page.locator('#port-wittgenstein h2').innerText()).trim();
  await page.evaluate(async () => {
    const { passage } = await import('#stores/passage.js');
    passage.note('');
    passage.arriveAt('wittgenstein');
  });
  await expect(status).toHaveText(`Arrived at ${name}`);

  await page.evaluate(async () => (await import('#stores/passage.js')).passage.arriveAt(null));
  await expect(status).toHaveText(`Arrived at ${name}`);
  await expect(status).toHaveText('', { timeout: 8000 });
});

test('survives being moved: one set of marks, one listener', async ({ page }) => {
  const hud = await openHud(page);
  const gold = await page.evaluate(
    () =>
      /** @type {HTMLElement | null} */ (document.querySelector('[data-port][data-view="gold"]'))
        ?.dataset.card ?? '',
  );
  await discover(page, [gold]);
  await page.evaluate(() => {
    const element = document.querySelector('voyage-hud');
    const parent = element?.parentNode;
    element?.remove();
    if (element) parent?.prepend(element);
  });
  await expect(hud.locator('li[data-goal] > [data-done-mark]')).toHaveCount(
    await hud.locator('li[data-goal]').count(),
  );
  await page.getByRole('button', { name: 'Gold' }).click();
  await expect(page.getByRole('button', { name: 'Gold' })).toHaveAttribute('aria-pressed', 'true');
  await report(page);
  await expect(hud.locator('[data-heading]')).toHaveText('069');
});

test('fits a phone: instruments in a row, the current order, all in the top third', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const hud = await openHud(page);
  await discover(page, ['wittgenstein', 'juniper', 'dioxus', 'quickjs']);
  await report(page);
  await page.evaluate(async () => {
    (await import('#stores/voyage.js')).voyage.damage(0.8);
    (await import('#stores/passage.js')).passage.note('aground');
  });

  const box = await hud.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(740 / 3);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  // Nothing of the HUD reaches the lower 40 percent, where the cards and the helm live.
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(740 * 0.6);
  await expect(hud.locator('li[aria-current="step"]')).toBeInViewport();
  // The other orders are clipped out of sight, not removed from the list.
  await expect(hud.getByRole('listitem')).toHaveCount(await hud.locator('li[data-goal]').count());

  // One row: the compass, the wind and sail, the speed and the hull side by side, none clipped.
  const tops = [];
  for (const part of ['.compass .dial', '.wind .dial', '.speed', '.hull']) {
    const gauge = await hud.locator(part).boundingBox();
    expect(gauge, part).not.toBeNull();
    expect((gauge?.x ?? 0) + (gauge?.width ?? 0), part).toBeLessThanOrEqual(360);
    tops.push((gauge?.y ?? 0) + (gauge?.height ?? 0) / 2);
  }
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(40);
  const widest = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(widest).toBeLessThanOrEqual(360);
});

test('on a wide screen keeps clear of the cards and the helm', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const hud = await openHud(page);
  await discover(page, ['wittgenstein', 'juniper', 'dioxus', 'quickjs']);
  await report(page, { relative: 0.2 });
  await page.evaluate(async () => {
    (await import('#stores/voyage.js')).voyage.damage(0.8);
    (await import('#stores/passage.js')).passage.note('wrecked');
  });
  const orders = await hud.locator('.orders').boundingBox();
  const instruments = await hud.locator('.instruments').boundingBox();
  // The card column on the left starts 18.5rem down; the helm sits in the bottom right corner.
  expect((orders?.y ?? 0) + (orders?.height ?? 0)).toBeLessThanOrEqual(18.5 * 16);
  expect((instruments?.y ?? 0) + (instruments?.height ?? 0)).toBeLessThanOrEqual(800 * 0.5);
  expect(instruments?.x ?? 0).toBeGreaterThan((orders?.x ?? 0) + (orders?.width ?? 0));
});
