# The Philosopher's Voyage: architecture

A birthday gift for Christoph: a small sailing game. He steers a boat across a poster-style 3D sea with the
arrow keys, finds six highlighted port islands, and each port rewards him with a card (a philosopher's quote,
a wine, a coffee, a dish). Some ports also unlock a new **view** (a different shader for the whole sea).
A HUD tracks objectives. Static site, no framework, no build, deployed to Wasmer Edge from `public/`.

House rules: the vanilla-web skill, cloned at
`/tmp/claude-0/-home-user/a6755b44-9e88-50ce-8f41-b04d47588d45/scratchpad/dl/skills/skills/vanilla-web/`
(read `SKILL.md`, and `assets/example-app` for the file conventions). Prettier: single quotes, width 100.
JSDoc types, checked by `tsc --checkJs`. Strict CSP: `script-src 'self'`, `style-src 'self'`, Trusted Types
(no `innerHTML`, no inline `style=""` attributes in markup, no `setAttribute('style')`; `el.style.x = …` is fine).

## Separation of concerns

Each folder has one job and may import only what is listed.

| Folder | Job | May import |
|---|---|---|
| `js/game/` | The sea as numbers. Pure functions, no DOM, no GPU. `world.js` (islands, boat physics, bearings), `objectives.js` (is a goal done?) | nothing |
| `js/stores/` | State. `voyage.js` (remembered progress), `passage.js` (the passage right now) | `#lib/store.js` |
| `js/render/` | Pixels. WebGL 2 plumbing and GLSL. Knows nothing about the DOM beyond its canvas, nothing about stores | nothing outside `js/render/` |
| `js/input/` | `helm.js`: keyboard and on-screen buttons to a `Helm` object | nothing |
| `js/components/voyage-sea/` | The game loop. Reads the helm, moves the boat (`game/`), writes the stores, hands a frame to the renderer | game, stores, render, input |
| `js/components/voyage-hud/` | The HUD: objective tracker, compass, view switcher, notices | stores, `game/objectives.js` |
| `js/components/voyage-log/` | The cards: intro, port rewards, finale | stores |
| `js/gift/` | Birthday wrapping paper (ported module, do not edit) | itself |
| `js/lib/` | `store.js`, `lazy-define.js` | nothing |

Elements never talk to each other. They read and write the two stores and re-render on the store's `change` event.

Import map prefixes (absolute, in `index.html`): `#lib/`, `#stores/`, `#components/`, `#game/`, `#render/`,
`#input/`, `#gift/` map to `/js/<name>/`. Inside a folder use relative imports with the extension.

## Stores (already written, do not change their API without telling the lead)

`js/stores/voyage.js` exports `voyage` (persisted in localStorage):

- `voyage.state`: `{ found: readonly string[], view: string, sailed: boolean }`. `found` holds port ids in the
  order found. `view` is one of the view ids below. `sailed` is true once the boat has moved.
- `voyage.discover(port)` returns true when new, `voyage.look(view)`, `voyage.setSail()`, `voyage.reset()`.

`js/stores/passage.js` exports `passage` (transient):

- `passage.state`: `{ near: string | null, target: { port, distance, angle } | null, notice: '' | 'aground' | 'edge', reading: boolean }`.
  `near` is the port id the boat is at. `target` is the nearest port not yet found (`angle` in radians, 0 dead
  ahead, positive to starboard; `distance` in world units). `reading` is true while a card is open.
- Written by voyage-sea: `arriveAt(port | null)`, `aim(target | null)` (about 10 times a second), `note(notice)`.
- Written by voyage-log: `read(boolean)`.

Both are `EventTarget`s that fire `change`.

## Views

Ids, in shader order: `poster` (0, the default, always unlocked), `terminal` (1), `gold` (2), `chart` (3).
A view is unlocked when a found port has `data-view="<id>"`. `voyage-sea` reflects the current view as
`<voyage-sea data-view="…">`, and CSS themes the cards and HUD from that attribute.

## Markup contract (`public/index.html`)

```html
<voyage-sea>                       <!-- prepends its <canvas aria-hidden="true">; sets [live] and [data-view] -->
  <voyage-hud>
    <h2>Captain's orders</h2>
    <ol class="objectives">
      <li data-goal="sail">Weigh anchor</li>          <!-- gets data-done when done -->
      <li data-goal="port:wittgenstein">…</li>
      <li data-goal="ports:3">…</li>
      <li data-goal="views:4">…</li>
      <li data-goal="ports:6">…</li>
    </ol>
    <p class="compass"><span class="needle" aria-hidden="true"></span> <span data-compass></span></p>
    <div class="views" role="group" aria-label="View">
      <button type="button" data-view="poster" aria-pressed="true">Poster</button>
      <button type="button" data-view="terminal" hidden>Terminal</button>
      <button type="button" data-view="gold" hidden>Gold</button>
      <button type="button" data-view="chart" hidden>Chart</button>
    </div>
    <p role="status" data-notice></p>
  </voyage-hud>
  <div class="helm" role="group" aria-label="Helm">
    <button type="button" data-helm="left" aria-label="Turn to port">…svg…</button>
    <button type="button" data-helm="up" aria-label="Sail ahead">…</button>
    <button type="button" data-helm="right" aria-label="Turn to starboard">…</button>
  </div>
  <voyage-log>
    <section class="card intro" data-card="intro">… <button type="button" data-close>Weigh anchor</button></section>
    <ol class="ports">
      <li><article class="card port" id="port-wittgenstein" data-card="wittgenstein"
                   data-port data-x="7" data-z="16" data-view="gold">
        … <p class="unlock">…</p> <button type="button" data-close>Sail on</button></article></li>
      …six ports…
    </ol>
    <section class="card finale" data-card="finale">… <button type="button" data-reset>Sail it again</button></section>
  </voyage-log>
</voyage-sea>
```

Goal grammar (`game/objectives.js`): `sail` (the boat has moved), `port:<id>` (that port found),
`ports:<n>` (at least n ports found), `views:<n>` (at least n views unlocked, poster counts).
Objectives are placeholders for now; they are edited in the HTML only.

Ports (id, x, z, unlocks): wittgenstein (7, 16, gold), juniper (-24, 36, chart), quickjs (27, 50),
edge (-12, 74), dioxus (30, 92, terminal), strand (-2, 120). The boat starts at (0, 0) heading +z.

Without JavaScript or WebGL 2 the page is a readable logbook: the intro, all six port cards in a list, the
finale. `voyage-sea[live]` is the CSS switch for game mode (fixed full-viewport canvas, cards hidden unless
`data-open`, HUD and helm shown).

## Renderer contract (`js/render/renderer.js`)

```js
/** @returns {Renderer | null} null when WebGL 2 or the shaders are unavailable */
export function createRenderer(canvas)
// Renderer: { draw(frame), dispose() }
// frame: {
//   dt, time,                     seconds
//   boat: { x, z, heading, speed, lean },
//   isles: { x, z, height, spread }[],   at most 14, the first 6 are the ports
//   found: boolean[],             one per port, same order
//   view: 'poster' | 'terminal' | 'gold' | 'chart',
//   yaw, pitch,                   camera orbit round the boat (yaw Math.PI is dead astern)
//   shift: [x, y],                where the boat sits on screen, in units of viewport height from the centre
//   end,                          0..1, sunset: share of ports found
//   sun: [x, y, z],               world direction
// }
```

The renderer sizes the canvas (device pixel ratio capped at 1.5) and lowers its resolution when frames run long.
`js/render/views.js` exports `VIEWS = ['poster', 'terminal', 'gold', 'chart']`. GLSL is split by concern under
`js/render/shaders/`: scene geometry in one file, one file per view (sky + shade), assembled by an index module.
Adding a view means adding one file and one entry.

## CSS

`css/main.css` declares `@layer reset, tokens, base, layout, components, utilities;`. One layer per file, each
linked from the head, never `@import`. `css/tokens.css` defines the theme tokens on `:root` (poster values) and
overrides them under `voyage-sea[data-view="terminal" | "gold" | "chart"]`:

`--card-bg --card-fg --card-accent --card-line --btn-bg --btn-fg --hud-bg --hud-fg --hud-line --hud-accent
--font-display --font-text --focus`.

Each element's sheet (`js/components/<tag>/<tag>.css`, `@layer components`, rules nested under the tag) uses only
those tokens. Fonts are self-hosted in `assets/fonts/` (Anton, DM Sans, IM Fell English, Poiret One, Josefin Sans).

Palettes. Poster: navy #12304a, cream #fff4dc, coral #ef6a4c (text-safe red #a8321a), amber #f9b84a, teal #0f6e7a.
Terminal: bg #0b1014, text #c9d6cf, green #7ee0a1, amber #f0b35a, system monospace. Gold: bg #0e0e0d, ivory
#f1ece0, gold #d4ae5a, Poiret One and Josefin Sans. Chart: paper #e9dcbc, ink #2a2418, red #7a2a1c, IM Fell English.

## Who owns what

- Lead: `js/stores/`, `js/input/helm.js`, `js/components/voyage-sea/`, `js/main.js`, the `<head>` of `index.html`, integration.
- Render: `js/render/**`.
- HUD: `js/components/voyage-hud/**`, `js/game/objectives.js`.
- Log and theme: `<body>` of `index.html`, `css/**`, `js/components/voyage-log/**`.
- Tooling: `package.json`, lint and type configs, `test/**`, `README.md`.

---

# Version 2: a real sailing game (this section overrides anything above that it contradicts)

Lorentz's brief: the map is ten times larger and takes 30 to 60 minutes to sail through; islands have forests,
there is a volcano; the voyage starts in a harbour on a mainland coast; one objective is inside a sea cave;
there is a map of the area with no markers (he navigates on his own) and a compass; the boat really sails:
a wind indicator, sails that must be trimmed to the wind, an engine he may switch on; running ashore damages
the hull, and there are reefs to steer clear of.

## World (`js/game/chart-data.js`, `js/game/terrain.js`, written by the lead, read-only for workers)

- Square world, side `EXTENT` = 2400 units, centred on the origin. x runs east, z runs north. Heading 0 is north,
  positive clockwise (east is PI/2). The boat is about 3 units long; 1 unit a second reads as 1 knot.
- `FEATURES`: the mainland (all land south of about z = -1040, with a harbour bay round x = 0), 19 islands of
  kinds `isle`, `crescent`, `volcano` (Mount Panic, at 90, -120), `mesa` (cliffs; Schattenfels at -140, 260 holds
  the cave), `strand`, and 7 `reef`s (low rocks over shoals). Each has `id`, `name`, `x`, `z`, `radius`, `height`.
- `getTerrain()` returns the shared `Terrain` (built once, about 0.5 s):
  `{ n: 1536, extent: 2400, heights: Float32Array(n*n), forest: Float32Array(n*n), ports, cave, volcano }`.
  Index `iz * n + ix`; sample (ix, iz) is centred at `-extent/2 + (i + 0.5) * extent/n`. Heights are in units
  above the sea (0); the sea floor is negative, down to -5. `forest` is 0..1.
- `terrain.ports`: `{ id, kind: 'light' | 'cave', x, z, base }[]`, seven of them, in this order: wittgenstein
  (lighthouse on the mainland headland by the harbour), juniper, quickjs, edge, dioxus, plato (kind `cave`: the
  chamber of the sea cave, no lighthouse), strand. `base` is the ground height under the lighthouse.
- `terrain.cave`: `{ ax, az, bx, bz, radius, hall, roof }`: a tunnel of that radius at sea level from the mouth
  (a) to the middle of a round chamber (b) of radius `hall`; `roof` is the height of the vault above the sea.
  The height grid knows nothing of the cave: the rock above it is solid in `heights`.
- `terrain.volcano`: `{ x, z, radius, height, crater }` (height of the rim, radius of the crater).
- `heightAt(terrain, x, z)`, `isWater(terrain, x, z)` (true over water deeper than `SHALLOW`, and inside the cave),
  `insideCave(cave, x, z)` (positive inside), `noise(x, y)`.
- `START` = `{ x: 0, z: -1072, heading: 0 }`; `EDGE` = 1150 (beyond it on either axis the boat is turned back).

## Sailing (`js/game/sailing.js`, GAME worker; replaces `world.js`)

```js
export const MAX_SPEED = 7.5;      // best point of sail in a fresh breeze
export const ENGINE_SPEED = 3.4;   // under engine alone
/** @returns {{ from: number, speed: number }} from: compass bearing it blows from; speed about 0.55..1.25 */
export function windAt(time)
/** @returns {Boat} { x, z, heading, speed, lean, sheet, boom } */
export function newBoat(berth)     // berth: { x, z, heading }
/** @returns {Outcome} { event: '' | 'aground' | 'edge', impact, relative, best, trim } */
export function sail(boat, helm, wind, dt, terrain)
export function damageFor(impact)  // share of the hull lost, 0..1
export function bearingTo(boat, point) // { distance, angle }
```

- `helm` is `{ left, right, out, in, engine }` (`js/input/helm.js`).
- `boat.sheet` is 0 (hauled in) .. 1 (right out). `boat.boom` is the angle of the boom off the centreline in
  radians, signed, positive when the sail lies to starboard; the wind always blows it to leeward.
- `relative` is where the wind comes from seen from the boat (0 on the bow, positive to starboard, -PI..PI).
  `best` is the sheet setting (0..1) that drives best on this point of sail. `trim` is 0..1, how close `sheet`
  is to `best` (1 perfect). The boat cannot sail closer than about 40 degrees to the wind; it must tack.
- `impact` is the speed at which the boat struck, 0 when it did not.

## Stores (lead; see the JSDoc in the files)

- `voyage.state` adds `hull` (1 sound .. 0 wrecked) and `berth` (`{ x, z, heading } | null`). New methods:
  `damage(amount)`, `repair(hull = 1)`, `moor(berth)`.
- `passage.state` is now `{ near, notice, reading, chart, log }`. `notice` is one of `''`, `'aground'`,
  `'edge'`, `'wrecked'`, `'repaired'`, `'luffing'`. `log` is `{ heading, speed, windFrom, windSpeed, relative,
  sheet, best, trim, engine }`, reported about ten times a second. `target` and `aim()` are gone: there is no
  pointer to the next port any more. New: `report(log)`, `unroll(boolean)` (the map).

## Renderer v2 (`js/render/`, RENDER worker)

```js
export function createRenderer(canvas, terrain)   // uploads the height grid once; null on failure
// frame: {
//   dt, time,
//   boat: { x, z, heading, speed, lean, boom },
//   found: boolean[],            one per terrain.ports entry, same order
//   view, end, sun,              as before
//   camera: { yaw, pitch, distance },   distance from the boat; the game shortens it inside the cave
//   shift: [x, y],
//   wind: { from, speed },       for the pennant and the run of the waves
// }
```

## Elements

- `<voyage-sea>` (lead): the loop. Heaves to (stops the clock) while the map is open.
- `<voyage-hud>` (HUD worker): objectives, compass, wind and trim, speed, hull, engine, views, notices.
- `<voyage-chart>` (HUD worker): the map. Listens for `M` and its own button, draws `getTerrain()` on a 2D canvas
  as a sea chart with place names, a compass rose and a scale, and NO markers: no boat, no ports, no route.
- `<voyage-log>` (LOG worker): cards. Seven ports now (`plato` is new).

Helm buttons: `button[data-helm="left|right|out|in|engine"]`. The map button is `button[data-chart-toggle]`
inside `<voyage-chart>`.
