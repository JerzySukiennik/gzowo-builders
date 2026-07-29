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
};

const bits = (member, collidesWith) => ((member << 16) | collidesWith) >>> 0;
export const FILTER = {
  TERRAIN: bits(GROUP.TERRAIN, GROUP.PART | GROUP.PLAYER),
  PART: bits(GROUP.PART, GROUP.TERRAIN | GROUP.PART | GROUP.PLAYER),
  PLAYER: bits(GROUP.PLAYER, GROUP.TERRAIN | GROUP.PART),
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
