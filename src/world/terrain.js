// terrain.js — the meadow itself.
//
// A height field, not a mesh soup: one array of heights drives the visible
// geometry, the physics collider and the tree scatter, so the three can never
// disagree about where the ground is. Rapier has a heightfield collider that
// takes the same array, which is the whole reason to build the world this way.
//
// The middle of the map is deliberately flat. A building game needs somewhere
// level to build on, and hills are scenery — the moment you have to fight the
// ground to put a chassis down, the hills have stopped being a feature.

import * as THREE from 'three';
import { FILTER } from '../physics/world.js';

export const WORLD = 256;      // metres across
export const SAMPLES = 129;    // height samples per side (128 cells)
export const PAD_RADIUS = 34;  // flat build pad in the middle
const PAD_BLEND = 16;          // metres of skirt from flat to hills
const RIDGE_START = 88;        // where the mountains begin
const RIDGE_HEIGHT = 46;

/** Deterministic value noise — the world is the same every time you load it. */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += smoothNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Height in metres at a world position. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const rolling = (fbm(x / 46, z / 46) - 0.5) * 7.5;
  const away = smoothstep((r - PAD_RADIUS) / PAD_BLEND);
  let h = rolling * away;

  if (r > RIDGE_START) {
    // The mountains are the same field pushed up hard, so the join is seamless
    // and the collider needs no special case at the foot of the range.
    const t = smoothstep((r - RIDGE_START) / 46);
    h += (0.35 + fbm(x / 30 + 11, z / 30 + 7) * 0.8) * RIDGE_HEIGHT * t * t;
  }
  return h;
}

export function buildTerrain(scene, RAPIER, world) {
  const step = WORLD / (SAMPLES - 1);
  const heights = new Float32Array(SAMPLES * SAMPLES);

  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SAMPLES - 1, SAMPLES - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);

  const GRASS = new THREE.Color(0x74ae43);
  const GRASS_DRY = new THREE.Color(0x8fae53);
  const ROCK = new THREE.Color(0x8d8b83);
  const SNOW = new THREE.Color(0xe8ecef);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Rapier's heightfield indexes rows by x and columns by z, both from the
    // low corner; the plane's vertices arrive in the same order once rotated.
    const col = i % SAMPLES, row = (i / SAMPLES) | 0;
    heights[col * SAMPLES + row] = h;

    c.copy(GRASS).lerp(GRASS_DRY, fbm(x / 12 + 3, z / 12 + 5));
    if (h > 8) c.lerp(ROCK, smoothstep((h - 8) / 14));
    if (h > 30) c.lerp(SNOW, smoothstep((h - 30) / 12));
    colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
  }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(SAMPLES - 1, SAMPLES - 1, heights,
                                    { x: WORLD, y: 1, z: WORLD })
      .setFriction(1.0)
      .setCollisionGroups(FILTER.TERRAIN),
    body,
  );

  return { mesh, heights, step };
}
