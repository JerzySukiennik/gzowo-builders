// world.js — the Rapier world, and the one place the WASM module is awaited.
//
// The client and the phase-7 server run the same Rapier version at the same
// fixed timestep so a construction behaves identically on both. Nothing here
// touches three.js: physics owns transforms, the renderer only reads them.

import RAPIER from '@dimforge/rapier3d-compat';

export const FIXED_DT = 1 / 60;
export const GRAVITY = { x: 0, y: -9.81, z: 0 };

/** Collision groups: 16 bits of membership, 16 bits of filter. */
export const GROUP = {
  TERRAIN: 0x0001,
  PART: 0x0002,
  PLAYER: 0x0004,
  WHEEL: 0x0008,
};

const bits = (member, collidesWith) => ((member << 16) | collidesWith) >>> 0;
export const FILTER = {
  // WHEEL is in the terrain's accept mask so the *suspension ray* can see the
  // ground. The wheel collider still bounces off, because the test is symmetric
  // and FILTER.WHEEL does not accept TERRAIN.
  TERRAIN: bits(GROUP.TERRAIN, GROUP.PART | GROUP.PLAYER | GROUP.WHEEL),
  PART: bits(GROUP.PART, GROUP.TERRAIN | GROUP.PART | GROUP.WHEEL),
  /**
   * The player's capsule takes part in no contacts at all.
   *
   * It is a kinematic body, which means infinite mass, which means a person
   * standing on the meadow is a wall: measured, a 2.8 t car driving into the
   * spawn point lost 10 m/s in a single step and tore its own wheels off. A
   * character should not stop a truck.
   *
   * Walking still collides with everything, because the character controller
   * does its own sweeps — and those use PLAYER_QUERY, whose membership is PART
   * so that parts and terrain accept it. The asymmetry interaction groups cannot
   * express for a collider pair is expressible for a query.
   */
  PLAYER: bits(GROUP.PLAYER, 0),
  PLAYER_QUERY: bits(GROUP.PART, GROUP.TERRAIN | GROUP.PART),
  // A wheel is held off the ground by its ray, not by its collider. If it also
  // collided with the terrain the two would fight and the car would buzz.
  WHEEL: bits(GROUP.WHEEL, GROUP.PART),
  // What the suspension ray is allowed to see.
  RAY: bits(GROUP.WHEEL, GROUP.TERRAIN | GROUP.PART),
};

export async function initPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World(GRAVITY);
  world.timestep = FIXED_DT;
  return { RAPIER, world };
}

/** Fixed-step accumulator — physics never sees a variable frame time. */
export class StepClock {
  constructor(maxSteps = 5) {
    this.acc = 0;
    this.maxSteps = maxSteps;
  }

  /** Calls `step()` zero or more times; returns the leftover alpha for lerping. */
  advance(dt, step) {
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= FIXED_DT && n < this.maxSteps) {
      this.acc -= FIXED_DT;
      n++;
      step();
    }
    if (n === this.maxSteps) this.acc = 0; // we are behind; drop the debt rather than spiral
    return this.acc / FIXED_DT;
  }
}
