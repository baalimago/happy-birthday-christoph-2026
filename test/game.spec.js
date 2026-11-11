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

const ALL_PORTS = ['wittgenstein', 'juniper', 'quickjs', 'edge', 'dioxus', 'plato', 'strand'];

// Every frame costs seconds in software, so give each test far more time than the config does.
test.setTimeout(240_000);

/**
 * Open the page and wait until the game is running. The HUD, chart and reading panel are
 * defined lazily, when they come into view; with the splash open they are hidden, so they are
 * awaited only for a voyage that skips it.
 * @param {import('@playwright/test').Page} page
 * @param {{ splash?: boolean }} [options]
 */
async function board(page, { splash = true } = {}) {
  await page.goto('/');
  await page.waitForFunction((all) => {
    const tags = all
      ? 'voyage-sea, voyage-log'
      : 'voyage-sea, voyage-log, voyage-hud, voyage-chart, voyage-reading';
    const found = [...document.querySelectorAll(tags)];
    return found.length === (all ? 2 : 5) && found.every((element) => element.matches(':defined'));
  }, splash);
  await expect(page.locator('voyage-sea')).toHaveAttribute('live');
}

/**
 * Put the splash and then the intro away, as the captain would.
 * @param {import('@playwright/test').Page} page
 */
async function weighAnchor(page) {
  await page.locator('voyage-log [data-card="splash"] [data-next="intro"]').click();
  await expect(page.locator('voyage-log [data-card="intro"]')).toBeVisible();
  await page.locator('voyage-log [data-card="intro"] [data-close]').click();
  await expect(page.locator('voyage-log [data-card][data-open]')).toHaveCount(0);
}

/**
 * Start the page with a saved voyage in place of a new one.
 * @param {import('@playwright/test').Page} page
 * @param {{ found: string[], view: string, sailed: boolean }} saved
 */
async function seed(page, saved) {
  await page.addInitScript(
    (state) => localStorage.setItem('philosophers-voyage:v2', JSON.stringify(state)),
    { hull: 1, berth: null, ...saved },
  );
}

test('the page loads as a game: a canvas, the HUD, the splash open, one view to choose', async ({
  page,
}) => {
  await board(page);
  const sea = page.locator('voyage-sea');
  await expect(sea).toHaveAttribute('data-view', 'poster');
  await expect(sea.locator(':scope > canvas[aria-hidden="true"]')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);

  await expect(page.locator('voyage-log [data-card][data-open]')).toHaveAttribute(
    'data-card',
    'splash',
  );
  await expect(
    page.getByRole('heading', { name: 'Happy Birthday from team Wasmer!' }),
  ).toBeVisible();
  // The greeting has the screen to itself.
  for (const hidden of ['voyage-hud', '.helm', '.aids', 'voyage-chart [data-chart-toggle]']) {
    await expect(page.locator(hidden).first()).toBeHidden();
  }

  await expect(page.locator('voyage-hud li[data-goal]')).toHaveCount(6);
  await expect(page.locator('voyage-hud [data-goal][data-done]')).toHaveCount(0);
  await expect(page.locator('voyage-hud .views button')).toHaveCount(4);
});

test('the splash leads to the intro, and "Weigh anchor" puts to sea with the instruments showing', async ({
  page,
}) => {
  await board(page);
  const splash = page.locator('voyage-log [data-card="splash"]');
  const intro = page.locator('voyage-log [data-card="intro"]');
  await expect(splash).toBeVisible();
  await expect(intro).toBeHidden();

  await splash.locator('[data-next="intro"]').click();
  await expect(splash).toBeHidden();
  await expect(intro).toBeVisible();
  // The sailing orders: the instruments are back for the captain to look at.
  await expect(page.locator('.helm')).toBeVisible();
  await expect(page.locator('voyage-hud')).toBeVisible();
  await expect(page.locator('voyage-hud [data-goal="sail"]')).not.toHaveAttribute('data-done');
  await expect(page.locator('voyage-hud button[data-view="poster"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const view of ['terminal', 'gold', 'chart']) {
    await expect(page.locator(`voyage-hud button[data-view="${view}"]`)).toBeHidden();
  }

  await intro.locator('[data-close]').click();
  await expect(intro).toBeHidden();
  await expect(page.locator('voyage-hud [data-goal="sail"]')).toHaveAttribute('data-done');
  expect(
    await page.evaluate(async () => (await import('/js/stores/voyage.js')).voyage.state.sailed),
  ).toBe(true);
});

test('the engine (E) drives the boat: the speed rises and the first objective is ticked', async ({
  page,
}) => {
  await board(page);
  await weighAnchor(page);
  const engine = page.locator('button[data-helm="engine"]');
  const speed = page.locator('voyage-hud [data-speed]');
  await expect(engine).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('e');
  await expect(engine).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => Number.parseFloat((await speed.textContent()) ?? '0'), {
      timeout: 150_000,
      intervals: [2_000],
    })
    .toBeGreaterThan(0);
  await expect(page.locator('voyage-hud li[data-goal="sail"][data-done]')).toHaveCount(1);

  await page.keyboard.press('e');
  await expect(engine).toHaveAttribute('aria-pressed', 'false');
});

test('M unrolls the chart and closes it again', async ({ page }) => {
  await board(page);
  await weighAnchor(page);
  const dialog = page.locator('voyage-chart dialog');
  await expect(dialog).toBeHidden();

  await page.keyboard.press('m');
  await expect(dialog).toBeVisible();
  await expect(page.locator('voyage-chart [data-chart-toggle]')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.keyboard.press('m');
  await expect(dialog).toBeHidden();
  await expect(page.locator('voyage-chart [data-chart-toggle]')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('a saved voyage is restored: found ports ticked and their views unlocked', async ({
  page,
}) => {
  await seed(page, { found: ['wittgenstein', 'juniper'], view: 'gold', sailed: true });
  await board(page, { splash: false });
  // He has sailed before, so no greeting.
  await expect(page.locator('voyage-log [data-card][data-open]')).toHaveCount(0);
  await expect(page.locator('voyage-sea')).toHaveAttribute('data-view', 'gold');
  await expect(page.locator('voyage-hud [data-goal="sail"]')).toHaveAttribute('data-done');
  await expect(page.locator('voyage-hud [data-goal="port:wittgenstein"]')).toHaveAttribute(
    'data-done',
  );
  await expect(page.locator('voyage-hud [data-goal="ports:3"]')).not.toHaveAttribute('data-done');
  await expect(page.locator('voyage-hud button[data-view="gold"]')).toBeVisible();
  await expect(page.locator('voyage-hud button[data-view="gold"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('voyage-hud button[data-view="chart"]')).toBeVisible();
  await expect(page.locator('voyage-hud button[data-view="terminal"]')).toBeHidden();
});

test('with every port found the finale opens, and "Sail it again" starts over', async ({
  page,
}) => {
  await seed(page, { found: ALL_PORTS, view: 'poster', sailed: true });
  await board(page, { splash: false });
  const finale = page.locator('voyage-log [data-card="finale"]');
  await expect(finale).toBeVisible();
  await expect(page.locator('voyage-hud [data-goal][data-done]')).toHaveCount(6);

  await finale.locator('[data-reset]').click();
  await expect(finale).toBeHidden();
  for (const goal of ['port:wittgenstein', 'ports:3', 'ports:7']) {
    await expect(page.locator(`voyage-hud [data-goal="${goal}"]`)).not.toHaveAttribute('data-done');
  }
  // The sailing orders open again and hold the boat in the harbour.
  await expect(page.locator('voyage-log [data-card="intro"]')).toBeVisible();
  expect(
    await page.evaluate(async () => (await import('/js/stores/voyage.js')).voyage.state),
  ).toMatchObject({ found: [], view: 'poster', sailed: false });
  await expect(page.locator('voyage-sea')).toHaveAttribute('data-view', 'poster');
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
  await expect(page.locator('voyage-log [data-port]')).toHaveCount(7);
  for (const card of await page.locator('voyage-log [data-card]').all()) {
    await expect(card).toBeVisible();
  }
});
