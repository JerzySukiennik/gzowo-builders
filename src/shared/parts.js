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

/**
 * You paint what you build *with*, not what you build *from*.
 *
 * Structural parts carry no material of their own and wear the player's colour.
 * Machines ship with theirs — rubber, steel, chrome, copper, cast iron — because
 * a wheel painted signal yellow stops reading as a wheel, and because the whole
 * point of a machine part is that you recognise it at a glance in a pile of
 * blocks. `paintable: false` says so; the loader only keeps a model's materials
 * for those parts.
 */

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
    paintable: false,
    name: 'Koło',
    category: CATEGORY.DRIVE,
    size: [4, 2, 4],
    shape: 'wheel',
    model: 'assets/models/wheel.glb',
    hotbar: 1,
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
    id: 'wheel_offroad',
    name: 'Koło terenowe',
    paintable: false,
    category: CATEGORY.DRIVE,
    size: [6, 3, 6],
    shape: 'wheel',
    model: 'assets/models/wheel_offroad.glb',
    hotbar: 2,
    autoOrient: true,
    wheel: {
      radius: 0.75, width: 0.75,
      rest: 0.34,             // half again the travel of the road wheel
      grip: 3.2,
      steerAngle: 0.46,
    },
  },
  {
    id: 'engine_electric',
    paintable: false,
    name: 'Silnik el.',
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'box',
    model: 'assets/models/engine_electric.glb',
    hotbar: 3,
    // Measured against a fifteen-block car (2.8 t): 9 kN is 3.2 m/s², which is
    // 0-40 km/h in about four seconds. One engine moves a small car properly,
    // two make it quick — which is the point of a light plastic density.
    engine: { force: 9000, topSpeed: 15 },
  },
  // --- motion --------------------------------------------------------------
  // Every mechanism turns or slides about **its mount normal**, which is its
  // local +Y — the same convention as a wheel's axle. One rule for all three
  // means the cursor can auto-orient them all the same way, and you never have
  // to work out which way a part will move before you place it.
  //
  // A mechanism is a cut in the weld graph: the part itself belongs to the body
  // it is bolted to, and whatever touches its far face becomes a separate body
  // joined by a real Rapier joint. In the yard that cut is not made — a
  // construction on the lift is one solid piece while you build on it.
  {
    id: 'piston',
    paintable: false,
    name: 'Tłok',
    category: CATEGORY.MOTION,
    size: [4, 4, 4],
    shape: 'piston',
    model: 'assets/models/piston.glb',
    hotbar: 1,
    autoOrient: true,
    mechanism: { kind: 'piston', travel: 0.75, force: 40000, speed: 1.1 },
  },
  {
    id: 'piston_long',
    name: 'Tłok długi',
    paintable: false,
    category: CATEGORY.MOTION,
    size: [4, 4, 4],
    shape: 'piston',
    model: 'assets/models/piston_long.glb',
    hotbar: 2,
    autoOrient: true,
    mechanism: { kind: 'piston', travel: 1.9, force: 40000, speed: 0.9 },
  },
  {
    id: 'hinge',
    paintable: false,
    name: 'Zawias',
    category: CATEGORY.MOTION,
    size: [4, 2, 4],
    shape: 'hinge',
    model: 'assets/models/hinge.glb',
    hotbar: 3,
    autoOrient: true,
    mechanism: { kind: 'hinge', limit: 2.36 },      // free swing, +-135 degrees
  },
  {
    id: 'motor_rotary',
    paintable: false,
    name: 'Obrotnica',
    category: CATEGORY.MOTION,
    size: [4, 2, 4],
    shape: 'bearing',
    model: 'assets/models/motor_rotary.glb',
    hotbar: 4,
    autoOrient: true,
    mechanism: { kind: 'bearing', torque: 26000, speed: 2.6 },
  },

  {
    id: 'engine_petrol',
    name: 'Silnik spalinowy',
    paintable: false,
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'box',
    model: 'assets/models/engine_petrol.glb',
    hotbar: 4,
    // Twice the punch of the electric motor and half again the speed, but it
    // has to be revving: `lowEnd` throttles it back below its power band, so a
    // petrol build is quicker down a straight and worse off the line. Two
    // engines that differ only in a number are two engines nobody would choose
    // between.
    engine: { force: 17000, topSpeed: 23, lowEnd: 0.30, band: 7.5 },
  },
  {
    id: 'seat',
    paintable: false,
    name: 'Siedzenie',
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'seat',
    model: 'assets/models/seat.glb',
    hotbar: 1,
    seat: { eye: [0, 0.42, 0], driver: true },
  },
  {
    id: 'seat_passenger',
    name: 'Fotel',
    paintable: false,
    category: CATEGORY.DRIVE,
    size: [4, 4, 4],
    shape: 'seat',
    model: 'assets/models/seat_passenger.glb',
    hotbar: 5,
    // Same seat, no controls. Somebody has to be able to come along for the
    // ride without taking the wheel out of the driver's hands.
    seat: { eye: [0, 0.42, 0], driver: false },
  },

  // --- logic ---------------------------------------------------------------
  // Small, cheap and paintable, because a circuit you cannot colour-code is a
  // circuit you cannot read. Every one of them holds a single boolean; wires
  // carry it from part to part and finally into a mechanism.
  {
    id: 'button',
    name: 'Przycisk',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'button',
    hotbar: 1,
    autoOrient: true,
    logic: { kind: 'button' },      // on while you hold E on it
  },
  {
    id: 'switch',
    name: 'Przełącznik',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'switch',
    hotbar: 2,
    autoOrient: true,
    logic: { kind: 'switch' },      // E flips it and it stays
  },
  {
    id: 'timer',
    name: 'Timer',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'logic',
    hotbar: 3,
    logic: { kind: 'timer', delay: 60 },   // one second, in physics steps
  },
  {
    id: 'gate_and',
    name: 'Bramka I',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'logic',
    hotbar: 4,
    logic: { kind: 'and' },
  },
  {
    id: 'gate_or',
    name: 'Bramka LUB',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'logic',
    hotbar: 5,
    logic: { kind: 'or' },
  },
  {
    id: 'lamp',
    name: 'Reflektor',
    paintable: false,
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'lamp',
    model: 'assets/models/lamp.glb',
    hotbar: 7,
    autoOrient: true,
    // A lamp is a logic *sink*: it does nothing to the world but show you the
    // signal. Debugging a circuit by watching a piston is guesswork; watching a
    // row of lamps is reading.
    logic: { kind: 'lamp' },
  },
  {
    id: 'sensor',
    name: 'Czujnik',
    paintable: false,
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'sensor',
    model: 'assets/models/sensor.glb',
    hotbar: 8,
    autoOrient: true,
    logic: { kind: 'sensor', range: 6 },   // looks along its mount normal
  },
  {
    id: 'gate_not',
    name: 'Bramka NIE',
    category: CATEGORY.LOGIC,
    size: [2, 2, 2],
    shape: 'logic',
    hotbar: 6,
    logic: { kind: 'not' },
  },
];

export const PARTS = Object.fromEntries(PART_LIST.map((p) => [p.id, p]));
export const PART_IDS = PART_LIST.map((p) => p.id);

/**
 * The hotbar is per category, because nine number keys stopped being enough at
 * twelve parts and will be nowhere near enough after the logic gates. Tab walks
 * the categories; the numbers stay meaningful inside one.
 */
export const partsOf = (cat) => PART_LIST
  .filter((p) => p.category === cat && p.hotbar)
  .sort((a, b) => a.hotbar - b.hotbar)
  .map((p) => p.id);

/** Volume of a part in m³, accounting for shapes that are not a full box. */
export function partVolume(part) {
  const box = part.size[0] * part.size[1] * part.size[2] * CELL ** 3;
  if (part.shape === 'wedge') return box / 2;
  if (part.shape === 'corner') return box / 6;
  if (part.shape === 'wheel') return Math.PI * part.wheel.radius ** 2 * part.wheel.width;
  if (part.shape === 'seat') return box * 0.45;
  if (part.shape === 'piston') return box * 0.55;
  if (part.shape === 'hinge' || part.shape === 'bearing') return box * 0.7;
  if (part.logic) return box * 0.8;
  if (part.shape === 'lamp' || part.shape === 'sensor') return box * 0.75;
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
