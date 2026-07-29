// grass.js — the thing that makes a green plane into a meadow.
//
// One instanced mesh, one draw call, thousands of tufts, and a wind that lives
// entirely in the vertex shader — the CPU never touches a blade after setup.
// The sway is a function of world position and time, so neighbouring tufts lean
// together in gusts rather than each jittering on its own, which is the
// difference between wind and static.
//
// The lighting is stock MeshStandardMaterial with the wind patched in through
// onBeforeCompile, so grass takes the sun, the sky map and the shadows for free
// rather than needing its own lighting model that would not match anything else.

import * as THREE from 'three';
import { PAD_RADIUS, heightAt } from './terrain.js';

const RADIUS = 62;          // how far out blades are drawn
const TUFTS = 9000;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** A tuft: three crossed blades, tapered, so it reads from any angle. */
function tuftGeometry() {
  const blades = [];
  for (let b = 0; b < 3; b++) {
    const g = new THREE.PlaneGeometry(0.09, 0.42, 1, 3);
    g.translate(0, 0.21, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 0.42;
      pos.setX(i, pos.getX(i) * (1 - t * 0.75));      // taper to a point
      pos.setZ(i, pos.getZ(i) + t * t * 0.06);        // and lean a little
    }
    g.rotateY((b / 3) * Math.PI);
    blades.push(g);
  }
  const geo = mergeSimple(blades);
  geo.computeVertexNormals();
  return geo;
}

function mergeSimple(list) {
  let count = 0, idx = 0;
  for (const g of list) { count += g.attributes.position.count; idx += g.index.count; }
  const pos = new Float32Array(count * 3);
  const index = new Uint16Array(idx);
  let po = 0, io = 0, base = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, po);
    for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.array[i] + base;
    base += g.attributes.position.count;
    po += g.attributes.position.array.length;
    io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

export function buildGrass(scene) {
  const geo = tuftGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  const uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.55, 0.25) } };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec2 uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Sway grows with height up the blade, so the base stays planted, and
        // the phase comes from world position so a gust crosses the field.
        vec3 tuftPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float phase = dot(tuftPos.xz, uWind) * 0.35 + uTime * 1.6;
        float lean = (sin(phase) * 0.5 + sin(phase * 2.3 + 1.7) * 0.25) * 0.12;
        float up = clamp(transformed.y / 0.42, 0.0, 1.0);
        transformed.xz += uWind * lean * up * up;`);
  };

  const mesh = new THREE.InstancedMesh(geo, material, TUFTS);
  mesh.castShadow = false;         // a shadow per blade costs more than it shows
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  mesh.frustumCulled = false;

  const colour = new THREE.Color();
  let placed = 0;
  // A blue-noise-ish spiral: even coverage without a visible grid, and no
  // rejection loop that could run long near the edge.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; placed < TUFTS && i < TUFTS * 3; i++) {
    const r = RADIUS * Math.sqrt((i + 0.5) / TUFTS);
    const a = i * golden;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = heightAt(x, z);
    if (y > 12) continue;                        // no grass up the rock faces
    const scale = 0.75 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.75;
    _q.setFromAxisAngle(UP, (i * 2.399) % (Math.PI * 2));
    _m.compose(_p.set(x, y, z), _q, _s.set(scale, scale * (0.8 + (i % 7) * 0.06), scale));
    mesh.setMatrixAt(placed, _m);
    const shade = 0.72 + ((i * 7919) % 100) / 100 * 0.42;
    colour.setRGB(0.42 * shade, 0.78 * shade, 0.30 * shade);
    mesh.setColorAt(placed, colour);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  return {
    mesh,
    count: placed,
    update(dt) { uniforms.uTime.value += dt; },
  };
}

export { PAD_RADIUS };
