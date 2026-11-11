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

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ port: string, distance: number, angle: number } | null} target
 */
async function aim(page, target) {
  await page.evaluate(async (to) => {
    const { passage } = await import('#stores/passage.js');
    passage.aim(to);
  }, target);
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
  await expect(hud.locator('li[data-goal="ports:6"]')).not.toHaveAttribute('data-done');
  await expect(hud.locator('li[aria-current="step"]')).toHaveCount(1);
});

test('offers a view once its port is found and switches to it', async ({ page }) => {
  const hud = await openHud(page);
  const views = page.getByRole('group', { name: 'View' });
  await expect(views).toBeHidden();

  await discover(page, ['wittgenstein']);
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

  await discover(page, ['dioxus', 'juniper']);
  await expect(views.getByRole('button')).toHaveText(['Poster', 'Terminal', 'Gold', 'Chart']);
  await expect(hud.locator('li[data-goal="views:4"]')).toHaveAttribute('data-done', '');
});

test('reads the compass out as distance and side', async ({ page }) => {
  const hud = await openHud(page);
  const compass = hud.locator('[data-compass]');
  const needle = hud.locator('.needle');
  await expect(compass).toHaveText('Every port found');
  await expect(needle).toBeHidden();

  await aim(page, { port: 'wittgenstein', distance: 14.2, angle: 0.9 });
  await expect(compass).toHaveText('Unknown port, 140 m, to starboard');
  await expect(needle).toBeVisible();
  expect(await needle.evaluate((el) => /** @type {HTMLElement} */ (el).style.rotate)).toBe(
    '0.9rad',
  );

  await aim(page, { port: 'wittgenstein', distance: 6, angle: -0.1 });
  await expect(compass).toHaveText('Unknown port, 60 m, dead ahead');
  await aim(page, { port: 'wittgenstein', distance: 6, angle: -1.5 });
  await expect(compass).toHaveText('Unknown port, 60 m, to port');
  await aim(page, { port: 'wittgenstein', distance: 6, angle: 3.1 });
  await expect(compass).toHaveText('Unknown port, 60 m, astern');
});

test('announces grounding, the edge and arrival, then falls silent', async ({ page }) => {
  await openHud(page);
  const status = page.locator('voyage-hud [data-notice]');
  await expect(status).toHaveText('');

  await page.evaluate(async () => (await import('#stores/passage.js')).passage.note('aground'));
  await expect(status).toHaveText('Aground. Back off and steer round.');
  await page.evaluate(async () => (await import('#stores/passage.js')).passage.note('edge'));
  await expect(status).toHaveText('Here be dragons. The wind turns you back.');

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
  await discover(page, ['wittgenstein']);
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
});

test('fits a phone: the current order and a count in the top third', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const hud = await openHud(page);
  await discover(page, ['wittgenstein', 'juniper', 'dioxus']);
  await aim(page, { port: 'edge', distance: 23.7, angle: -2.2 });
  await page.evaluate(async () => (await import('#stores/passage.js')).passage.note('aground'));

  const box = await hud.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(640 / 3);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  await expect(hud.locator('li[aria-current="step"]')).toBeInViewport();
  // The other orders are clipped out of sight, not removed from the list.
  await expect(hud.getByRole('listitem')).toHaveCount(await hud.locator('li[data-goal]').count());
});
