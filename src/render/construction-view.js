// construction-view.js — everything the Construction knows about looking good.
//
// The split exists so the phase-7 server can run `Construction` unchanged: the
// server is authoritative over the same class the client is looking at, rather
// than over a reimplementation of it that quietly drifts. Anything that touches
// geometry, materials or the scene graph lives here and nowhere else.

import * as THREE from 'three';
import { geometryFor, modelMaterialFor } from './geometry.js';
import { materialFor } from './materials.js';

export class ConstructionView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'construction';
    scene.add(this.root);
    this.meshes = new Map();     // part id -> Mesh
  }

  makeGroup(pos, rot) {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y, pos.z);
    g.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.root.add(g);
    return g;
  }

  dropGroup(group) { if (group) this.root.remove(group); }

  addLoose(object) { this.scene.add(object); }

  paintable(partId) { return !modelMaterialFor(partId); }

  attach(group, id, def, part, local, quat) {
    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometryFor(def), modelMaterialFor(def.id) ?? materialFor(part.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = id;
      this.meshes.set(id, mesh);
    }
    mesh.position.set(local[0], local[1], local[2]);
    mesh.quaternion.copy(quat);
    group.add(mesh);
  }

  detach(group, id) {
    const mesh = this.meshes.get(id);
    if (mesh && mesh.parent === group) group.remove(mesh);
  }

  forget(id) {
    const mesh = this.meshes.get(id);
    if (mesh) { mesh.parent?.remove(mesh); this.meshes.delete(id); }
  }

  paint(id, color) {
    const mesh = this.meshes.get(id);
    if (mesh) mesh.material = materialFor(color);
  }

  /** The exposed length of a piston rod, drawn between the two bodies. */
  makeRod(geometry, part) {
    const own = modelMaterialFor(part.partId);
    const chrome = Array.isArray(own) ? own[own.length - 1] : own;
    const rod = new THREE.Mesh(geometry, chrome ?? materialFor(part.color));
    rod.castShadow = true;
    rod.visible = false;
    this.root.add(rod);
    return rod;
  }
}
