// terrain-collider.js — the ground, for a machine with no screen.
//
// The client builds its terrain mesh and its collider from one height array in
// terrain.js. The server needs only the second half of that, and it must come
// out of the *same* height function or a car would drive up a hill the host
// cannot see. So the numbers come from terrain.js and only the mesh is skipped.

import { FILTER } from '../src/physics/world.js';
import { SAMPLES, WORLD, heightAt } from '../src/world/terrain.js';

export function buildServerTerrain(RAPIER, world) {
  const heights = new Float32Array(SAMPLES * SAMPLES);
  const step = WORLD / (SAMPLES - 1);
  const half = WORLD / 2;
  for (let row = 0; row < SAMPLES; row++) {
    for (let col = 0; col < SAMPLES; col++) {
      // Same indexing as the client: column runs along x, row along z, and the
      // plane's vertices are laid out from the far corner back.
      const x = -half + col * step;
      const z = -half + row * step;
      heights[col * SAMPLES + row] = heightAt(x, z);
    }
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(SAMPLES - 1, SAMPLES - 1, heights, { x: WORLD, y: 1, z: WORLD })
      .setFriction(1.0)
      .setCollisionGroups(FILTER.TERRAIN),
    body,
  );
  return heights;
}
