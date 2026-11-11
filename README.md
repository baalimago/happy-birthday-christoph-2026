# The Philosopher's Voyage

A birthday gift for Christoph: a real sailing game. He steers a boat across a poster-style 3D sea of 2400
units with a mainland, some twenty islands, a volcano, reefs and a sea cave, and finds seven ports (one in
the cave). Each port rewards him with a card (a philosopher's quote, a wine, a coffee, a dish) and sometimes
a new view of the whole sea. The wind matters, the sails must be trimmed, an engine is optional, and running
aground damages the hull. The HUD has a compass and instruments; the chart (M) carries no markers. It is a
static site with no framework and no build step, deployed to Wasmer Edge from `public/`.

## Controls

- Left / right (or A / D): steer.
- Up / down (or W / S): let the sails out / haul them in.
- E: engine on or off.
- M: open or close the chart.
- Drag: look round.

## Folder map

```
public/              the deployable site, and nothing else
  index.html         the one document; a readable logbook without JavaScript or WebGL 2
  css/               one cascade layer per file
  js/main.js         wires the page: the birthday paper, then the three lazy islands
  js/game/           the sea as numbers (pure, unit tested):
                     chart-data.js (the world as data), terrain.js (height grid, collision queries),
                     sailing.js (wind and boat physics), objectives.js
  js/stores/         state: remembered progress, and the passage right now
  js/render/         WebGL 2 and GLSL, one file per view
  js/input/          the helm: keys and on-screen buttons
  js/components/     <voyage-sea>, <voyage-hud>, <voyage-chart>, <voyage-log>
  js/gift/           the birthday wrapping paper (ported module)
  js/lib/            store.js, lazy-define.js
  assets/            fonts, icon
Staticfile           Wasmer Edge static-website marker: root is public/
settings/config.toml Wasmer Edge static server settings
docs/old-world.js    the retired v1 physics, kept for reference
docs/ARCHITECTURE.md the contract: who may import what, the stores, the markup, the renderer
test/                shell test, CSP hash helper, browser tests
package.json, *.config.js, tsconfig.json, types.d.ts   dev tooling, never deployed
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the place to start before changing anything.

## Run it locally

```sh
npm install
npm run serve        # http://localhost:4173
```

The birthday wrapping paper shows only on 11 November. To preview it on any other day open
<http://localhost:4173/?wrap=always>; `?wrap=never` skips it on the day itself.

## Checks

```sh
npm run check          # every gate that needs no browser: check:html, check:js, test:unit
npm run check:html     # html-validate (standard, a11y, document presets) and the Nu checker (needs Java)
npm run check:js       # eslint, prettier --check, tsc --checkJs over the JSDoc types
npm run test:unit      # node --test: js/game, js/gift and test/*.test.js (the shell test)
npm run test:browser   # Playwright: axe-core before and after upgrade, and a smoke test of the game
```

- The shell test (`test/shell.test.js`) checks that the CSP carries the hash of every inline script, that
  `package.json` `imports` mirror the import map, that the document has one title, description, `h1` and
  `main`, that the `modulepreload` list equals the import graph, and that no module imports across the
  folder boundaries in the architecture.
- After editing the import map or any other inline script, run `npm run csp-hash` and paste the printed
  `'sha256-…'` sources into `script-src` of the CSP meta in `public/index.html`.
- After adding, removing or re-wiring a module, run `npm run preloads` and replace the
  `<link rel="modulepreload">` lines in the head with what it prints.
- `public/js/gift/` is a ported module: Prettier, ESLint and tsc leave it alone, and `types.gift.d.ts`
  declares the one function the app calls from it.
- Browser tests run in Chromium only by default. `PW_ALL_BROWSERS=1 npm run test:browser` adds Firefox and
  WebKit (after `npx playwright install`). Where a Chromium is preinstalled at `/opt/pw-browsers/chromium`
  (or at the path in `PW_CHROMIUM`) it is launched directly, so no download is needed.

## Deploy to Wasmer Edge

The site deploys automatically to Wasmer Edge from the `main` branch. To deploy by hand:

The repository root is already a Wasmer Edge static website (`Staticfile`, `settings/config.toml`, `public/`).

1. Install the Wasmer CLI: `curl https://get.wasmer.io -sSfL | sh`
2. Sign in: `wasmer login`
3. From the repository root: `wasmer deploy`. The first run asks for the owner and the app name
   (suggested: `philosophers-voyage`) and writes `app.yaml`; keep that file.
4. Preview locally before deploying: `wasmer run .` and open <http://localhost:8080>.
5. Redeploy after any change: `wasmer deploy` again.

The cloud workspace this was built in could not reach wasmer.io, so the deploy has not been run from there:
run it from a machine that can.
