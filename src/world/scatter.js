// scatter.js — trees, bushes and rocks on the meadow.
//
// Everything here is instanced: one draw call per kind, however many there are.
// A few hundred trees drawn one at a time would cost more than the entire rest
// of the frame on the target card, and they are the cheapest thing in the world
// to batch because none of them ever moves.
//
// Placement is a deterministic hash of the grid cell, so the meadow looks the
// same on every machine — which matters the moment two people are on it.

import * as THREE from 'three';
import { FILTER } from '../physics/world.js';
import { PAD_RADIUS, WORLD, heightAt } from './terrain.js';

/** Nothing grows on the pad, on the ramps, or on the rock faces. */
const KEEP_CLEAR = PAD_RADIUS + 8;
const CELL = 7.5;               // one candidate per cell of this size
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function rand(x, z, salt) {
  let h = Math.imul(x | 0, 668265263) ^ Math.imul(z | 0, 374761393) ^ Math.imul(salt, 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Slope, as the drop over one metre — steep ground stays bare. */
function slopeAt(x, z) {
  const h = heightAt(x, z);
  return Math.max(
    Math.abs(heightAt(x + 1, z) - h),
    Math.abs(heightAt(x, z + 1) - h),
  );
}

/**
 * @param kinds [{ id, geometry, material, density, scale:[min,max], trunk:{r,h}|null }]
 */
export function scatter(scene, RAPIER, world, kinds) {
  const half = WORLD / 2 - CELL;
  const picks = new Map(kinds.map((k) => [k.id, []]));
  const total = kinds.reduce((n, k) => n + k.density, 0);

  for (let x = -half; x <= half; x += CELL) {
    for (let z = -half; z <= half; z += CELL) {
      const gx = Math.round(x / CELL), gz = Math.round(z / CELL);
      const r0 = rand(gx, gz, 1);
      if (r0 > 0.62) continue;                       // leave gaps, or it is a hedge

      const px = x + (rand(gx, gz, 2) - 0.5) * CELL * 0.9;
      const pz = z + (rand(gx, gz, 3) - 0.5) * CELL * 0.9;
      const r = Math.hypot(px, pz);
      if (r < KEEP_CLEAR) continue;
      const h = heightAt(px, pz);
      if (h > 26 || slopeAt(px, pz) > 0.55) continue;

      // Which kind: a weighted draw, so density is a number you can tune.
      let pick = rand(gx, gz, 4) * total;
      let kind = kinds[0];
      for (const k of kinds) { pick -= k.density; if (pick <= 0) { kind = k; break; } }

      const s = kind.scale[0] + rand(gx, gz, 5) * (kind.scale[1] - kind.scale[0]);
      picks.get(kind.id).push({ x: px, y: h, z: pz, s, rot: rand(gx, gz, 6) * Math.PI * 2 });
    }
  }

  const out = [];
  const trunkBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const kind of kinds) {
    const list = picks.get(kind.id);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(kind.geometry, kind.material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = kind.id;
    list.forEach((it, i) => {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      _m.compose(_v.set(it.x, it.y, it.z), _q, _s.set(it.s, it.s, it.s));
      mesh.setMatrixAt(i, _m);
      if (!kind.trunk) return;
      // Only the trunk is solid. A collider per leaf would be thousands of
      // shapes for something you are meant to drive past, not climb.
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(kind.trunk.h * it.s / 2, kind.trunk.r * it.s)
          .setTranslation(it.x, it.y + kind.trunk.h * it.s / 2, it.z)
          .setFriction(0.9)
          .setCollisionGroups(FILTER.TERRAIN),
        trunkBody,
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    out.push({ id: kind.id, mesh, count: list.length });
  }
  return out;
}
