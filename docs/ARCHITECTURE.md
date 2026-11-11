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
