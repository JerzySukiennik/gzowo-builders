// models.js — load the Blender parts.
//
// Every part is modelled once in Blender (tools/parts.blend), exported to a
// .glb, and loaded here before the first frame. The models are tiny — a few
// hundred triangles each — so they all load up front and the game never has to
// stream geometry while you are building.
//
// A model that fails to load is not fatal: geometryFor() falls back to the
// procedural shape, which has the same dimensions and the same collider. You
// get an uglier block, not a broken game.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARTS } from '../shared/parts.js';
import { CELL } from '../shared/grid.js';
import { registerModel } from './geometry.js';

const SIZE_TOLERANCE = 0.02; // metres — a chamfer shaves a little off the box

export async function loadPartModels() {
  const loader = new GLTFLoader();
  const jobs = Object.values(PARTS)
    .filter((p) => p.model)
    .map((p) => loadOne(loader, p).catch((err) => {
      console.warn(`[models] ${p.id}: ${err.message} — używam geometrii proceduralnej`);
      return null;
    }));
  const loaded = (await Promise.all(jobs)).filter(Boolean);
  return loaded.length;
}

async function loadOne(loader, part) {
  const gltf = await loader.loadAsync(part.model);
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) throw new Error('brak siatki w pliku');

  // A part with several materials exports as several primitives. Merging them
  // with groups turns that back into one mesh with a material array, so the
  // rest of the game still deals in exactly one mesh per placed part.
  // A painted part must come back with no material at all: GLTFLoader hands out
  // a default white one for primitives that declare none, and taking that would
  // silently make every block unpaintable.
  const keepMaterials = part.paintable === false;
  let geo, material = null;
  if (meshes.length === 1) {
    geo = meshes[0].geometry;
    material = keepMaterials ? meshes[0].material ?? null : null;
  } else {
    geo = mergeGeometries(meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)), true);
    if (!geo) throw new Error('nie da się scalić prymitywów');
    material = keepMaterials ? meshes.map((m) => m.material) : null;
  }

  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new (geo.boundingBox.max.constructor)());
  const expect = part.size.map((c) => c * CELL);
  // The model has to match the cell box it claims, or the collider and the
  // mesh describe different objects and everything downstream is a lie.
  for (let a = 0; a < 3; a++) {
    const got = [size.x, size.y, size.z][a];
    if (Math.abs(got - expect[a]) > SIZE_TOLERANCE) {
      throw new Error(`rozmiar ${got.toFixed(3)} m zamiast ${expect[a].toFixed(3)} m na osi ${'XYZ'[a]}`);
    }
  }

  registerModel(part.id, geo, material);
  return part.id;
}
