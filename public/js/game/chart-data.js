// The sea Christoph sails, as data. Distances are in world units (the boat is about 3 long),
// x runs east, z runs north, and heading 0 is north. Nothing here knows about the DOM or the GPU.

/** The world is a square of this side, centred on the origin. */
export const EXTENT = 2400;
/** The height grid has this many samples a side. */
export const GRID = 1536;
/** Past this distance from the origin along x or z the wind turns the boat back. */
export const EDGE = 1150;
/** Where the boat lies at the start: in the harbour bay of the mainland, bow to the north. */
export const START = { x: 0, z: -1072, heading: 0 };

/**
 * @typedef {'mainland' | 'isle' | 'crescent' | 'volcano' | 'mesa' | 'strand' | 'reef'} Kind
 * @typedef {{
 *   id: string, name: string, kind: Kind, x: number, z: number,
 *   radius: number, height: number, forest: number, seed: number,
 * }} Feature
 */

/** @type {Feature[]} */
export const FEATURES = [
  // The mainland fills the south; x and radius are unused, z is the mean coastline.
  {
    id: 'mainland',
    name: 'Österreich am Meer',
    kind: 'mainland',
    x: 0,
    z: -1040,
    radius: 0,
    height: 26,
    forest: 0.7,
    seed: 3,
  },

  // Ports of call
  {
    id: 'juniper',
    name: 'Juniper Isle',
    kind: 'isle',
    x: -540,
    z: -430,
    radius: 95,
    height: 24,
    forest: 1,
    seed: 11,
  },
  {
    id: 'quickjs',
    name: 'QuickJS Reef',
    kind: 'isle',
    x: 520,
    z: -260,
    radius: 55,
    height: 9,
    forest: 0.2,
    seed: 23,
  },
  {
    id: 'edge',
    name: 'Edge Harbour',
    kind: 'crescent',
    x: -820,
    z: 400,
    radius: 100,
    height: 20,
    forest: 0.5,
    seed: 31,
  },
  {
    id: 'dioxus',
    name: 'Dioxus Bay',
    kind: 'crescent',
    x: 660,
    z: 540,
    radius: 120,
    height: 28,
    forest: 0.7,
    seed: 47,
  },
  {
    id: 'plato',
    name: 'Schattenfels',
    kind: 'mesa',
    x: -140,
    z: 260,
    radius: 62,
    height: 19,
    forest: 0.4,
    seed: 53,
  },
  {
    id: 'strand',
    name: 'Geburtstagsstrand',
    kind: 'strand',
    x: 160,
    z: 960,
    radius: 70,
    height: 5,
    forest: 0.25,
    seed: 61,
  },

  // Landmarks
  {
    id: 'panic',
    name: 'Mount Panic',
    kind: 'volcano',
    x: 90,
    z: -120,
    radius: 130,
    height: 62,
    forest: 0.5,
    seed: 71,
  },
  {
    id: 'ferris',
    name: 'Ferris Island',
    kind: 'isle',
    x: -250,
    z: -700,
    radius: 60,
    height: 14,
    forest: 0.8,
    seed: 83,
  },
  {
    id: 'cargo',
    name: 'Cargo Cay',
    kind: 'isle',
    x: 330,
    z: -720,
    radius: 45,
    height: 8,
    forest: 0.4,
    seed: 97,
  },
  {
    id: 'crate',
    name: 'Crate Island',
    kind: 'isle',
    x: 880,
    z: -640,
    radius: 80,
    height: 18,
    forest: 0.9,
    seed: 101,
  },
  {
    id: 'lifetime',
    name: 'Lifetime Atoll',
    kind: 'crescent',
    x: -900,
    z: -760,
    radius: 70,
    height: 6,
    forest: 0.3,
    seed: 113,
  },
  {
    id: 'wasm',
    name: 'Wasm Holm',
    kind: 'isle',
    x: -480,
    z: 40,
    radius: 50,
    height: 16,
    forest: 0.6,
    seed: 127,
  },
  {
    id: 'async',
    name: 'Async Isle',
    kind: 'isle',
    x: 340,
    z: 220,
    radius: 65,
    height: 15,
    forest: 0.7,
    seed: 131,
  },
  {
    id: 'trait',
    name: 'Trait Holm',
    kind: 'isle',
    x: 960,
    z: 80,
    radius: 55,
    height: 20,
    forest: 0.5,
    seed: 149,
  },
  {
    id: 'macro',
    name: 'Macro Island',
    kind: 'isle',
    x: -330,
    z: 700,
    radius: 90,
    height: 26,
    forest: 0.9,
    seed: 157,
  },
  {
    id: 'closure',
    name: 'Closure Cay',
    kind: 'isle',
    x: 520,
    z: 900,
    radius: 45,
    height: 9,
    forest: 0.4,
    seed: 163,
  },
  {
    id: 'graphql',
    name: 'Query Rock',
    kind: 'mesa',
    x: -960,
    z: -160,
    radius: 40,
    height: 15,
    forest: 0.2,
    seed: 173,
  },
  {
    id: 'kaffee',
    name: 'Melange Island',
    kind: 'isle',
    x: -780,
    z: 900,
    radius: 60,
    height: 12,
    forest: 0.6,
    seed: 181,
  },
  {
    id: 'veltliner',
    name: 'Veltliner Holm',
    kind: 'isle',
    x: 920,
    z: 960,
    radius: 55,
    height: 13,
    forest: 0.8,
    seed: 191,
  },

  // Hazards: low rocks that hole a hull
  {
    id: 'borrow',
    name: 'Borrow Checker Bank',
    kind: 'reef',
    x: 230,
    z: -480,
    radius: 70,
    height: 1.3,
    forest: 0,
    seed: 211,
  },
  {
    id: 'tokio',
    name: 'Tokio Shoals',
    kind: 'reef',
    x: -260,
    z: -240,
    radius: 80,
    height: 1.2,
    forest: 0,
    seed: 223,
  },
  {
    id: 'unsafe',
    name: 'Unsafe Rocks',
    kind: 'reef',
    x: 620,
    z: -200,
    radius: 60,
    height: 1.5,
    forest: 0,
    seed: 227,
  },
  {
    id: 'deadlock',
    name: 'Deadlock Ledge',
    kind: 'reef',
    x: -560,
    z: 430,
    radius: 75,
    height: 1.2,
    forest: 0,
    seed: 233,
  },
  {
    id: 'nullptr',
    name: 'Null Skerries',
    kind: 'reef',
    x: 380,
    z: 640,
    radius: 70,
    height: 1.4,
    forest: 0,
    seed: 239,
  },
  {
    id: 'segfault',
    name: 'Segfault Shallows',
    kind: 'reef',
    x: -40,
    z: 640,
    radius: 65,
    height: 1.2,
    forest: 0,
    seed: 241,
  },
  {
    id: 'panicrocks',
    name: 'Unwrap Rocks',
    kind: 'reef',
    x: 760,
    z: 250,
    radius: 55,
    height: 1.3,
    forest: 0,
    seed: 251,
  },
];

/**
 * A port is a lighthouse on the shore of a feature, found by walking out from the feature's
 * middle on a compass bearing (degrees, 0 north, 90 east), or the chamber of the cave.
 * @typedef {{ id: string, feature: string, bearing: number, kind: 'light' | 'cave' }} PortSpec
 * @type {PortSpec[]}
 */
export const PORT_SPECS = [
  { id: 'wittgenstein', feature: 'mainland', bearing: 0, kind: 'light' },
  { id: 'juniper', feature: 'juniper', bearing: 120, kind: 'light' },
  { id: 'quickjs', feature: 'quickjs', bearing: 200, kind: 'light' },
  { id: 'edge', feature: 'edge', bearing: 35, kind: 'light' },
  { id: 'dioxus', feature: 'dioxus', bearing: 270, kind: 'light' },
  { id: 'plato', feature: 'plato', bearing: 0, kind: 'cave' },
  { id: 'strand', feature: 'strand', bearing: 180, kind: 'light' },
];

/** The lighthouse of the home port stands on the headland east of the harbour bay. */
export const HOME_LIGHT = { x: 92, z: -1046 };

/**
 * The sea cave in Schattenfels: a tunnel from the mouth (a) to a round chamber (b).
 * Offsets are from the middle of the feature.
 */
export const CAVE_SHAPE = {
  mouth: { x: -78, z: 0 },
  chamber: { x: 6, z: 0 },
  radius: 7.5,
  hall: 13,
  roof: 9,
};
