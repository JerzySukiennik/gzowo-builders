// geometry.js — procedural part geometry.
//
// Every part gets a moulded edge: boxes are rounded by a constant 2 cm radius
// regardless of how big the part is, which is what makes a wall of blocks read
// as stacked plastic bricks rather than one flat slab. Wedges and corners are
// flat-shaded prisms — a bevel there would fight the slope silhouette.
//
// These are placeholders in the honest sense: each is replaced one-for-one by a
// Blender .glb as the models land, and the collider shapes never change.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../shared/grid.js';

const BEVEL = 0.02;
const cache = new Map();
const modelled = new Map();
const modelledMaterial = new Map();

/** A Blender model has landed for this part — it wins over the placeholder. */
export function registerModel(partId, geometry, material = null) {
  modelled.set(partId, geometry);
  if (material) modelledMaterial.set(partId, material);
  cache.delete(partId);
}

/**
 * The material a part came with, or null if it is painted.
 *
 * Structural parts export with no material at all and wear the player's colour.
 * Machines export with theirs — rubber, steel, chrome, copper, cast iron — so a
 * wheel is a wheel rather than a wheel-shaped lump of whatever the palette was
 * set to. That is the whole distinction: **you paint what you build with, not
 * what you build from.**
 */
export const modelMaterialFor = (partId) => modelledMaterial.get(partId) ?? null;

/** Cached geometry for a part definition, centred on its own origin. */
export function geometryFor(part) {
  if (modelled.has(part.id)) return modelled.get(part.id);
  if (cache.has(part.id)) return cache.get(part.id);
  const w = part.size[0] * CELL, h = part.size[1] * CELL, d = part.size[2] * CELL;
  let geo;
  if (part.shape === 'wedge') geo = wedgeGeometry(w, h, d);
  else if (part.shape === 'corner') geo = cornerGeometry(w, h, d);
  else if (part.shape === 'wheel') {
    geo = new THREE.CylinderGeometry(part.wheel.radius, part.wheel.radius, part.wheel.width, 20);
  } else if (part.shape === 'seat') {
    geo = seatGeometry(w, h, d);
  } else if (part.shape === 'button' || part.shape === 'switch') {
    geo = buttonGeometry(w, h, d, part.shape === 'switch');
  } else if (part.shape === 'lamp' || part.shape === 'sensor') {
    geo = logicGeometry(w, h, d);
  } else if (part.shape === 'logic') {
    geo = logicGeometry(w, h, d);
  } else if (part.shape === 'piston') {
    geo = pistonGeometry(w, h, d);
  } else if (part.shape === 'hinge' || part.shape === 'bearing') {
    geo = bearingGeometry(w, h, d, part.shape === 'bearing');
  } else geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(BEVEL, Math.min(w, h, d) / 3));
  cache.set(part.id, geo);
  return geo;
}

/**
 * Merge parts of a composite shape. RoundedBoxGeometry comes out non-indexed and
 * CylinderGeometry indexed, and mergeGeometries silently returns null when the
 * two are mixed — which then blows up inside three's Mesh constructor, a long
 * way from the cause.
 */
function merge(parts) {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function fromTriangles(tris) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

/** Triangular prism: the slope falls from the top of -Z to the bottom of +Z. */
function wedgeGeometry(w, h, d) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
  const quad = (a, b, c, e) => [a, b, c, a, c, e];
  const tris = [
    // bottom
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]).reverse(),
    // back wall (-Z)
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    // slope
    ...quad([x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z0]),
    // sides
    [x0, y0, z0], [x0, y0, z1], [x0, y1, z0],
    [x1, y0, z0], [x1, y1, z0], [x1, y0, z1],
  ];
  return fromTriangles(tris);
}

/** Corner tetrahedron — mates flush with a wedge on either of its slopes. */
function cornerGeometry(w, h, d) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
  const a = [x0, y0, z0], b = [x1, y0, z0], c = [x0, y0, z1], apex = [x0, y1, z0];
  const tris = [
    a, c, b,        // bottom
    a, b, apex,     // back wall
    a, apex, c,     // side wall
    b, c, apex,     // the cut face
  ];
  return fromTriangles(tris);
}

/** Seat: a base slab and a back, facing -Z (the direction the driver looks). */
function seatGeometry(w, h, d) {
  const base = new RoundedBoxGeometry(w, h * 0.28, d * 0.8, 2, BEVEL);
  base.translate(0, -h * 0.36, d * 0.1);
  const back = new RoundedBoxGeometry(w, h * 0.72, d * 0.22, 2, BEVEL);
  back.translate(0, h * 0.14, d * 0.39);
  return merge([base, back]);
}

/** Piston: a body with a rod out of its +Y face — the face it moves things on. */
function pistonGeometry(w, h, d) {
  const body = new RoundedBoxGeometry(w * 0.86, h * 0.62, d * 0.86, 2, BEVEL);
  body.translate(0, -h * 0.19, 0);
  const rod = new THREE.CylinderGeometry(w * 0.20, w * 0.20, h * 0.44, 14);
  rod.translate(0, h * 0.28, 0);
  const cap = new RoundedBoxGeometry(w * 0.72, h * 0.10, d * 0.72, 2, BEVEL);
  cap.translate(0, h * 0.45, 0);
  return merge([body, rod, cap]);
}

/** Hinge and rotary motor: a plate with a barrel turning about +Y. */
function bearingGeometry(w, h, d, powered) {
  const plate = new RoundedBoxGeometry(w, h * 0.44, d, 2, BEVEL);
  plate.translate(0, -h * 0.28, 0);
  const barrel = new THREE.CylinderGeometry(w * 0.34, w * 0.34, h * 0.56, 16);
  barrel.translate(0, h * 0.22, 0);
  const parts = [plate, barrel];
  if (powered) {
    const ring = new THREE.CylinderGeometry(w * 0.44, w * 0.44, h * 0.14, 16);
    ring.translate(0, 0, 0);
    parts.push(ring);
  }
  return merge(parts);
}

/** Button and switch: a base with something to press or flick on top. */
function buttonGeometry(w, h, d, isSwitch) {
  const base = new RoundedBoxGeometry(w, h * 0.55, d, 2, BEVEL);
  base.translate(0, -h * 0.22, 0);
  let top;
  if (isSwitch) {
    top = new RoundedBoxGeometry(w * 0.26, h * 0.52, d * 0.42, 2, BEVEL);
    top.rotateX(-0.42);
    top.translate(0, h * 0.26, 0);
  } else {
    // Fills the rest of the cell box: a mesh smaller than its collider means you
    // can stand on air above a button, which reads as a bug even though nothing
    // is wrong with the physics.
    top = new THREE.CylinderGeometry(w * 0.30, w * 0.34, h * 0.45, 14);
    top.translate(0, h * 0.275, 0);
  }
  return merge([base, top]);
}

/** Gates and timers: a slab with a raised die on it, so a circuit reads. */
function logicGeometry(w, h, d) {
  const base = new RoundedBoxGeometry(w, h * 0.62, d, 2, BEVEL);
  base.translate(0, -h * 0.19, 0);
  const die = new RoundedBoxGeometry(w * 0.56, h * 0.38, d * 0.56, 2, BEVEL);
  die.translate(0, h * 0.31, 0);
  return merge([base, die]);
}

/** Half-extents, in metres, of a part's collider box in its local frame. */
export function halfExtents(part) {
  return [part.size[0] * CELL / 2, part.size[1] * CELL / 2, part.size[2] * CELL / 2];
}
