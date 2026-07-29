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

/**
 * Force, in newtons, a single cell² of joint face can carry before it snaps.
 *
 * Calibrated in phase 2 against measured drops of a one-cubic-metre block
 * (150 kg): the momentum it loses in a single step is 40 kN from one metre,
 * 60 kN from two and 105 kN from six. At 4000 N per cell² a full block-to-block
 * face carries 64 kN, so a construction survives a hop off a ramp, starts
 * shedding parts around two metres, and comes apart properly from six.
 */
export const JOINT_STRENGTH_PER_CELL = 4000;

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

  // --- drive ---------------------------------------------------------------
  // A wheel is a mount, not a lump: the ground is found by a ray cast down from
  // where it sits (see vehicle.js), and its collider is filtered off the terrain
  // so the two never argue. It spins about its local +Y, which is also the axis
  // of the cylinder collider and of the mesh — one convention, no baked-in
  // corrective rotations anywhere.
  {
    id: 'wheel',
    name: 'Koło',
    category: CATEGORY.DRIVE,
    size: [4, 2, 4],
    shape: 'wheel',
    model: 'assets/models/wheel.glb',
    hotbar: 7,
    autoOrient: true,          // the axle points out of the face you place it on
    wheel: {
      radius: 0.5,
      width: 0.5,
      rest: 0.22,              // suspension travel at rest, metres
      stiffness: 46000,        // N per metre of compression
      damping: 3200,           // N per m/s
      grip: 3.2,               // lateral force per m/s of slip, per tonne
      steerAngle: 0.52,        // radians at full lock
    },
  },
  {
    id: 'engine_electric',
    name: 'Silnik el.',
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'box',
    model: 'assets/models/engine_electric.glb',
    hotbar: 8,
    // Measured against a fifteen-block car (2.8 t): 9 kN is 3.2 m/s², which is
    // 0-40 km/h in about four seconds. One engine moves a small car properly,
    // two make it quick — which is the point of a light plastic density.
    engine: { force: 9000, topSpeed: 15 },
  },
  {
    id: 'seat',
    name: 'Siedzenie',
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'seat',
    model: 'assets/models/seat.glb',
    hotbar: 9,
    seat: { eye: [0, 0.42, 0] },   // where the driver's head sits, in part space
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
  if (part.shape === 'wheel') return Math.PI * part.wheel.radius ** 2 * part.wheel.width;
  if (part.shape === 'seat') return box * 0.45;
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
