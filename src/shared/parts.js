// parts.js — the catalogue. Pure data, shared by client and server.
//
// `size` is in grid cells (CELL = 0.25 m), measured in the part's own local
// frame before orientation is applied. `shape` tells the renderer and the
// physics collider builder which primitive to use; once a part has a Blender
// model, `model` points at the .glb and `shape` still drives the collider —
// colliders stay primitive so the simulation is cheap and deterministic.
//
// `density` is kg/m³ of moulded plastic — light, so a hand-built car is
// drivable with two motors rather than eight.

import { CELL } from './grid.js';

export const DENSITY = 150;

export const CATEGORY = {
  STRUCTURE: 'structure',
  DRIVE: 'drive',
  MOTION: 'motion',
  LOGIC: 'logic',
};

/** Force, in newtons, a single cell² of joint face can carry before it snaps.
 *  Tuned in phase 2 against the ramps on the meadow. */
export const JOINT_STRENGTH_PER_CELL = 2600;

const PART_LIST = [
  {
    id: 'block',
    name: 'Blok',
    category: CATEGORY.STRUCTURE,
    size: [4, 4, 4],
    shape: 'box',
    model: 'assets/models/block.glb',
    hotbar: 1,
  },
  {
    id: 'block_small',
    name: 'Kostka',
    category: CATEGORY.STRUCTURE,
    size: [2, 2, 2],
    shape: 'box',
    model: 'assets/models/block_small.glb',
    hotbar: 2,
  },
  {
    id: 'panel',
    name: 'Płyta',
    category: CATEGORY.STRUCTURE,
    size: [4, 1, 4],
    shape: 'box',
    model: 'assets/models/panel.glb',
    hotbar: 3,
  },
  {
    id: 'beam',
    name: 'Belka',
    category: CATEGORY.STRUCTURE,
    size: [8, 2, 2],
    shape: 'box',
    model: 'assets/models/beam.glb',
    hotbar: 4,
  },
  {
    id: 'wedge',
    name: 'Klin',
    category: CATEGORY.STRUCTURE,
    size: [4, 4, 4],
    shape: 'wedge',
    model: 'assets/models/wedge.glb',
    hotbar: 5,
  },
  {
    id: 'corner',
    name: 'Naroże',
    category: CATEGORY.STRUCTURE,
    size: [4, 4, 4],
    shape: 'corner',
    model: 'assets/models/corner.glb',
    hotbar: 6,
  },
];

export const PARTS = Object.fromEntries(PART_LIST.map((p) => [p.id, p]));
export const PART_IDS = PART_LIST.map((p) => p.id);

/** Hotbar order — index 0..n maps to keys 1..n. */
export const HOTBAR = PART_LIST
  .filter((p) => p.hotbar)
  .sort((a, b) => a.hotbar - b.hotbar)
  .map((p) => p.id);

/** Volume of a part in m³, accounting for shapes that are not a full box. */
export function partVolume(part) {
  const box = part.size[0] * part.size[1] * part.size[2] * CELL ** 3;
  if (part.shape === 'wedge') return box / 2;
  if (part.shape === 'corner') return box / 6;
  return box;
}

export const partMass = (part) => partVolume(part) * DENSITY;

/** The paint palette. Chunky, saturated, readable across a meadow at distance. */
export const PALETTE = [
  '#E8442E', // red
  '#F2842B', // orange
  '#FFC42E', // yellow
  '#7FBF3F', // leaf
  '#2E9E5B', // green
  '#2FA5B5', // teal
  '#3B7DD8', // blue
  '#6A5AD1', // violet
  '#D0509E', // pink
  '#8B5E3C', // wood
  '#DCD6C6', // bone
  '#2A2E33', // graphite
];
