// A smoke test of the game through the real page, written against docs/ARCHITECTURE.md.
import { test as base, expect } from '@playwright/test';

// The sea is drawn in software here, at under a frame a second for a full canvas. A low device
// pixel ratio keeps the CSS layout of a small window while the canvas has a sixteenth of the pixels.
base.use({
  viewport: { width: 640, height: 480 },
  deviceScaleFactor: 0.25,
  reducedMotion: 'reduce',
});

/**
 * `problems` collects what must never happen on the page: console errors, uncaught exceptions
 * and CSP violations. Every test ends by checking that it is empty.
 */
const test = base.extend({
  problems: [
    async ({ page }, use) => {
      /** @type {string[]} */
      const problems = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
      await page.exposeFunction('reportCspViolation', (/** @type {string} */ violation) => {
        problems.push(`CSP: ${violation}`);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          /** @type {any} */ (window).reportCspViolation(
            `${event.effectiveDirective} blocked ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}`,
          );
        });
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

/** Open the page and wait until the game is running. @param {import('@playwright/test').Page} page */
async function board(page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => {
    const found = [...document.querySelectorAll('voyage-sea, voyage-hud, voyage-log')];
    return found.length === 3 && found.every((element) => element.matches(':defined'));
  });
  await expect(page.locator('voyage-sea')).toHaveAttribute('live');
}

/** Put the intro card away, as the captain would. @param {import('@playwright/test').Page} page */
async function weighAnchor(page) {
  const close = page.locator('voyage-log [data-card="intro"] [data-close]');
  if (await close.isVisible()) await close.click();
  await expect(close).toBeHidden();
}

test('the page loads as a game: a canvas, the HUD, one view to choose', async ({ page }) => {
  await board(page);
  const sea = page.locator('voyage-sea');
  await expect(sea).toHaveAttribute('data-view', 'poster');
  await expect(sea.locator('canvas[aria-hidden="true"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('voyage-hud [data-goal][data-done]')).toHaveCount(0);
  const views = page.locator('voyage-hud .views button');
  await expect(views).toHaveCount(4);
  await expect(page.locator('voyage-hud button[data-view="poster"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const view of ['terminal', 'gold', 'chart']) {
    await expect(page.locator(`voyage-hud button[data-view="${view}"]`)).toBeHidden();
  }
});

test('holding ArrowUp sets sail, ticks "Weigh anchor" and puts the intro away', async ({
  page,
}) => {
  await board(page);
  const goal = page.locator('voyage-hud [data-goal="sail"]');
  const intro = page.locator('voyage-log [data-card="intro"]');
  await expect(goal).not.toHaveAttribute('data-done');
  await expect(intro).toBeVisible();
  await page.keyboard.down('ArrowUp');
  await expect(goal).toHaveAttribute('data-done', { timeout: 30_000 });
  await page.keyboard.up('ArrowUp');
  await expect(intro).toBeHidden();
  expect(
    await page.evaluate(async () => (await import('/js/stores/voyage.js')).voyage.state.sailed),
  ).toBe(true);
});

test('arriving at Wittgenstein opens his card; finding him ticks the goal and unlocks Gold', async ({
  page,
}) => {
  await board(page);
  await weighAnchor(page);
  const card = page.locator('#port-wittgenstein');
  const goal = page.locator('voyage-hud [data-goal="port:wittgenstein"]');
  const gold = page.locator('voyage-hud button[data-view="gold"]');
  await expect(card).not.toHaveAttribute('data-open');
  await expect(goal).not.toHaveAttribute('data-done');
  await expect(gold).toHaveJSProperty('hidden', true);

  // The game loop reports the boat's real position every frame, and the boat is not at this
  // port, so read the result before the next frame can take the arrival back.
  const opened = await page.evaluate(async () => {
    const { passage } = await import('/js/stores/passage.js');
    const { voyage } = await import('/js/stores/voyage.js');
    passage.arriveAt('wittgenstein');
    const isNew = voyage.discover('wittgenstein');
    await Promise.resolve();
    return {
      isNew,
      near: passage.state.near,
      open: document.querySelector('#port-wittgenstein')?.hasAttribute('data-open'),
    };
  });
  expect(opened).toEqual({ isNew: true, near: 'wittgenstein', open: true });

  await expect(goal).toHaveAttribute('data-done');
  await expect(gold).toHaveJSProperty('hidden', false);
  await expect(gold).toBeVisible();

  await gold.click();
  await expect(gold).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('voyage-sea')).toHaveAttribute('data-view', 'gold');
});

test('progress is remembered across a reload', async ({ page }) => {
  await board(page);
  await page.evaluate(async () => {
    (await import('/js/stores/voyage.js')).voyage.discover('wittgenstein');
  });
  await board(page);
  await expect(page.locator('voyage-hud [data-goal="port:wittgenstein"]')).toHaveAttribute(
    'data-done',
  );
});

test('the birthday paper wraps the page on request and keeps to the CSP', async ({ page }) => {
  await page.goto('/?wrap=always');
  // The paper is one focused button over everything; Enter tears it off.
  const paper = page.locator('.gift-wrap');
  await expect(paper).toBeVisible();
  await expect(paper).toHaveAttribute('role', 'button');
  await page.keyboard.press('Enter');
  await expect(paper).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('voyage-sea')).toHaveAttribute('live');
});

test('without WebGL 2 the page stays a logbook with every card readable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ type,
      /** @type {any[]} */ ...rest
    ) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...rest);
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('voyage-sea')?.matches(':defined'));
  await expect(page.locator('voyage-sea')).not.toHaveAttribute('live');
  await expect(page.locator('voyage-log [data-port]')).toHaveCount(6);
  for (const card of await page.locator('voyage-log [data-card]').all()) {
    await expect(card).toBeVisible();
  }
});
