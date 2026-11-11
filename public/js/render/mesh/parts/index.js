// The parts of the world, in the order they are drawn: what hides most goes first, the sea after
// the land it laps against, and whatever is see-through last.

import { createBoat } from './boat.js';
import { createCave } from './cave.js';
import { createCreatures } from './creatures.js';
import { createBeacons, createPorts } from './ports.js';
import { createSea } from './sea.js';
import { createSky } from './sky.js';
import { createTerrain } from './terrain.js';
import { createTrail } from './trail.js';
import { createTrees } from './trees.js';
import { createVolcano } from './volcano.js';

/** @typedef {import('../renderer.js').Kit} Kit */
/** @typedef {import('../renderer.js').Part} Part */

/** @type {readonly ((kit: Kit) => Part)[]} */
export const PARTS = [
  createSky,
  createTerrain,
  createCave,
  createPorts,
  createTrees,
  createBoat,
  createCreatures,
  createSea,
  createVolcano,
  createTrail,
  createBeacons,
];
