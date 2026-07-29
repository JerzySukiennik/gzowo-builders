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
import { CELL } from '../shared/grid.js';

const BEVEL = 0.02;
const cache = new Map();
const modelled = new Map();

/** A Blender model has landed for this part — it wins over the placeholder. */
export function registerModel(partId, geometry) {
  modelled.set(partId, geometry);
  cache.delete(partId);
}

/** Cached geometry for a part definition, centred on its own origin. */
export function geometryFor(part) {
  if (modelled.has(part.id)) return modelled.get(part.id);
  if (cache.has(part.id)) return cache.get(part.id);
  const w = part.size[0] * CELL, h = part.size[1] * CELL, d = part.size[2] * CELL;
  let geo;
  if (part.shape === 'wedge') geo = wedgeGeometry(w, h, d);
  else if (part.shape === 'corner') geo = cornerGeometry(w, h, d);
  else geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(BEVEL, Math.min(w, h, d) / 3));
  cache.set(part.id, geo);
  return geo;
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

/** Half-extents, in metres, of a part's collider box in its local frame. */
export function halfExtents(part) {
  return [part.size[0] * CELL / 2, part.size[1] * CELL / 2, part.size[2] * CELL / 2];
}
