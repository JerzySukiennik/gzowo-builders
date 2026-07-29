// construction.js — the blueprint made visible and solid.
//
// One place owns the three representations of a placed part: the record in the
// Blueprint (truth), the mesh (what you see) and the collider (what you stand
// on). Adding or removing a part goes through here so they can never drift.
//
// Phase 1 gives every part a fixed collider on a shared static body: you can
// walk on what you build immediately. Phase 2 replaces that with one dynamic
// body per connected component and breakable joints between them — the seam is
// `_bodyFor()`, and nothing outside this file needs to know which regime is on.

import * as THREE from 'three';
import { Blueprint } from '../shared/blueprint.js';
import { PARTS } from '../shared/parts.js';
import { CELL, cellBoxCentre, oriEuler } from '../shared/grid.js';
import { geometryFor } from '../render/geometry.js';
import { materialFor } from '../render/materials.js';
import { FILTER } from '../physics/world.js';

export class Construction {
  constructor(scene, RAPIER, world) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.blueprint = new Blueprint();
    this.group = new THREE.Group();
    this.group.name = 'construction';
    scene.add(this.group);

    this.meshes = new Map();    // part id -> Mesh
    this.colliders = new Map(); // part id -> Collider

    // Everything built in phase 1 hangs off one static body.
    this.staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  get count() { return this.blueprint.parts.size; }

  canPlace(partId, cell, ori) { return this.blueprint.canPlace(partId, cell, ori); }

  place(partId, cell, ori, color) {
    const rec = this.blueprint.add({ partId, cell, ori, color });
    if (!rec) return null;
    this._spawn(rec);
    return rec;
  }

  removeById(id) {
    const rec = this.blueprint.remove(id);
    if (!rec) return null;
    const mesh = this.meshes.get(id);
    if (mesh) { this.group.remove(mesh); this.meshes.delete(id); }
    const col = this.colliders.get(id);
    if (col) { this.world.removeCollider(col, true); this.colliders.delete(id); }
    return rec;
  }

  paint(id, color) {
    const rec = this.blueprint.parts.get(id);
    if (!rec) return;
    rec.color = color;
    const mesh = this.meshes.get(id);
    if (mesh) mesh.material = materialFor(color);
  }

  /** The part id a mesh belongs to — used by the cursor raycast. */
  idOfObject(obj) {
    while (obj && obj.parent !== this.group) obj = obj.parent;
    return obj?.userData?.partId ?? null;
  }

  get raycastTargets() { return this.group.children; }

  _spawn(rec) {
    const def = PARTS[rec.partId];
    const [cx, cy, cz] = cellBoxCentre(rec.cell, rec.rs);
    const e = oriEuler(rec.ori);

    const mesh = new THREE.Mesh(geometryFor(def), materialFor(rec.color));
    mesh.position.set(cx, cy, cz);
    mesh.rotation.set(e.x, e.y, e.z, 'YXZ');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = rec.id;
    this.group.add(mesh);
    this.meshes.set(rec.id, mesh);

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'YXZ'));
    const desc = colliderDescFor(this.RAPIER, def)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.9)
      .setCollisionGroups(FILTER.PART);
    this.colliders.set(rec.id, this.world.createCollider(desc, this._bodyFor(rec)));
  }

  /** Phase 2 hook: which rigid body this part's collider belongs to. */
  _bodyFor() { return this.staticBody; }

  /** Rebuild everything from a blueprint (load from Firebase, or a net join). */
  load(data) {
    for (const id of [...this.meshes.keys()]) this.removeById(id);
    this.blueprint = Blueprint.fromJSON(data);
    for (const rec of this.blueprint.parts.values()) this._spawn(rec);
  }
}

/** Colliders stay primitive: a box for boxes, a hull for the sloped shapes. */
function colliderDescFor(RAPIER, def) {
  const hx = def.size[0] * CELL / 2, hy = def.size[1] * CELL / 2, hz = def.size[2] * CELL / 2;
  if (def.shape === 'box') return RAPIER.ColliderDesc.cuboid(hx, hy, hz);

  const pts = def.shape === 'wedge'
    ? [
        [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz],
        [-hx, hy, -hz], [hx, hy, -hz],
      ]
    : [
        [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz],
        [-hx, hy, -hz],
      ];
  return RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flat()))
      ?? RAPIER.ColliderDesc.cuboid(hx, hy, hz);
}
