# Soundscape

`public/js/audio/` makes the voyage audible. Everything is synthesised with Web Audio: no files, no
network, nothing for the CSP to allow.

| File | Job |
|---|---|
| `mix.js` | Pure. Store state to levels (`mix`) and to one-shot cues (`cues`). Unit tested in `mix.test.js`. |
| `voices.js` | The instruments: the beds (sea, wash, wind, whistle, luff, engine), gull and creak events, and the cues. |
| `soundscape.js` | The one entry, `startSoundscape(signal)`. Listens to the stores, owns the AudioContext, the mute toggle and the gesture gate. |

Boundary: `/js/audio/` may import only `/js/stores/` (add `'/js/audio/': ['/js/stores/']` to `BOUNDARIES` in `test/shell.test.js`).

## Wiring

1. Import map in `index.html`: `"#audio/": "/js/audio/"` (then `npm run csp-hash` and update the CSP).
   `package.json` `imports` and `tsconfig.json` `paths` already have `#audio/*`.
2. `main.js`, after the elements are defined:

   ```js
   import('#audio/soundscape.js').then(({ startSoundscape }) =>
     startSoundscape(new AbortController().signal),
   );
   ```

3. The toggle, anywhere in the document (the HUD is a good place). It ships `hidden`, so without JS it
   never shows; the module unhides it and keeps `aria-pressed` in step (true = sound on):

   ```html
   <button type="button" class="sound" data-sound aria-pressed="true" hidden>Sound</button>
   ```

   The Q key toggles too. The choice is kept in `localStorage['philosophers-voyage:sound']` (`on` / `off`).

## What it listens to

From `passage`: `state.log` (`speed` 0..8, `windSpeed` 0.55..1.25, `trim` 0..1 with 1 well trimmed,
`engine`; optional `land`, 0 open sea .. 1 on the beach, for gulls along any coast), `state.near`,
`state.notice`, `state.reading` and `state.chart` (both duck the sea). From `voyage`: `state.found`
(a new entry rings the ship's bell) and `state.hull` (0..1 or 0..100; a worn hull creaks more).

| Sound | Driven by |
|---|---|
| Sea swell, two slow stereo layers | always; a little louder and brighter with wind |
| Wash along the hull | speed |
| Wind gusts, rigging whistle | `windSpeed` |
| Flogging canvas | `1 - trim`, scaled by wind; silent under engine |
| Engine | `engine`; pitch rises with speed |
| Gulls | `near` a port, or `log.land` |
| Timber creaks | speed, wind, hull wear |
| Cues | new port (bells), revisit (one bell), `aground` (thud), `wrecked` (crash and low bell), `repaired` (hammer and bell), `edge` (foghorn) |

Nothing starts before the first `pointerdown` or `keydown` (browsers require a gesture). Muting fades out
and suspends the context; a hidden tab suspends it too. Aborting the signal closes it.

Tuning: bed loudness is `BED_GAIN` in `soundscape.js`; how state maps to levels is `mix.js`.
