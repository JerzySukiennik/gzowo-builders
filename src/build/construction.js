// construction.js — the blueprint made visible, solid and breakable.
//
// One place owns the three representations of a placed part: the record in the
// Blueprint (truth), the mesh (what you see) and the collider (what you stand
// on). Adding, removing or snapping a part goes through here so they can never
// drift.
//
// The central decision of phase 2 is **one rigid body per connected component,
// not per part**. A thousand-part build would otherwise be a thousand bodies
// and three thousand joints, which the target machine will not carry, and which
// solves into jelly long before it solves into a car. So a construction is one
// rigid body, and structural failure is modelled by *cutting the graph* and
// re-forming bodies — a break makes two bodies out of one, rather than a joint
// giving way.
//
// A component that touches the meadow is a fixed body while you build on it, so
// a half-finished tower does not topple as you work. `G` releases it: the same
// construction becomes dynamic and gravity gets to vote. `G` again snaps it
// back to the pose it was designed in — this game's version of the lift.

import * as THREE from 'three';
import { Blueprint } from '../shared/blueprint.js';
import { DENSITY, JOINT_STRENGTH_PER_CELL, PARTS } from '../shared/parts.js';
import { CELL, cellBoxCentre, oriEuler } from '../shared/grid.js';
import { geometryFor } from '../render/geometry.js';
import { materialFor } from '../render/materials.js';
import { FILTER, FIXED_DT } from '../physics/world.js';

const G = 9.81;
/** The weakest link in the catalogue is one cell² of face. A blow that cannot
 *  break even that is not worth a per-link search. */
const MIN_LINK_FORCE = JOINT_STRENGTH_PER_CELL;
/** A cantilever multiplies the load its root link carries. Half a metre of
 *  overhang doubles it — a stand-in for a real moment calculation, tuned so
 *  walls are safe and long unsupported arms are not. */
const LEVER_SCALE = 0.5;
const MAX_OVERLOAD_PASSES = 6;

export class Construction {
  constructor(scene, RAPIER, world) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.blueprint = new Blueprint();

    this.root = new THREE.Group();
    this.root.name = 'construction';
    scene.add(this.root);

    this.meshes = new Map();        // part id -> Mesh
    this.bodies = new Map();        // body key -> body record
    this.partBody = new Map();      // part id -> body key
    this.partCollider = new Map();  // part id -> Collider
    this.released = new Set();      // parts the player has cut loose from the ground
    this._nextKey = 1;
    this.dirty = false;
  }

  get count() { return this.blueprint.parts.size; }
  get bodyCount() { return this.bodies.size; }
  get raycastTargets() { return [...this.meshes.values()]; }

  canPlace(partId, cell, ori) { return this.blueprint.canPlace(partId, cell, ori); }

  /** Is this part where its blueprint says it is, i.e. safe to build against? */
  isAnchored(partId) {
    const rec = this.bodies.get(this.partBody.get(partId));
    return !!rec && !rec.dynamic;
  }

  place(partId, cell, ori, color) {
    const rec = this.blueprint.add({ partId, cell, ori, color });
    if (!rec) return null;
    this._insertPart(rec.id);
    this._relieveOverload();
    return rec;
  }

  removeById(id) {
    const rec = this.blueprint.remove(id);
    if (!rec) return null;
    this.released.delete(id);
    const body = this.bodies.get(this.partBody.get(id));
    if (body) {
      this._detachPart(body, id);
      if (body.ids.size) this._resplit(body); else this._destroyBody(body.key);
    }
    this._forgetMesh(id);
    this._relieveOverload();
    this.dirty = true;
    return rec;
  }

  /**
   * Fold a freshly placed part into the bodies it touches.
   *
   * Placement is the one operation that happens under the player's finger, so
   * it never scans the world: a new part can only ever *join* components, and
   * which ones is answered by its own neighbours. Splitting — the expensive
   * direction — can only be caused by removing a part or snapping a link, and
   * even then only within the one body affected.
   */
  _insertPart(id) {
    const keys = new Set();
    for (const n of this.blueprint.neighbours(id)) {
      const key = this.partBody.get(n.id);
      const rec = key === undefined ? null : this.bodies.get(key);
      // Never merge into a construction that has been released: it has moved,
      // so its parts are not really where the grid says they are.
      if (rec && !rec.dynamic) keys.add(key);
    }

    if (!keys.size) { this._createBody(new Set([id]), new Map()); this.dirty = true; return; }

    let target = null;
    for (const key of keys) {
      const rec = this.bodies.get(key);
      if (!target || rec.ids.size > target.ids.size) target = rec;
    }
    this._attachPart(target, id);
    for (const key of keys) {
      if (key === target.key) continue;
      const other = this.bodies.get(key);
      for (const pid of [...other.ids]) { this._detachPart(other, pid); this._attachPart(target, pid); }
      this._destroyBody(key);
    }
    this._refreshAnchor(target);
    this.dirty = true;
  }

  /** Has this body come apart? If so, leave the largest piece and rehome the rest. */
  _resplit(rec) {
    const groups = [];
    const seen = new Set();
    for (const start of rec.ids) {
      if (seen.has(start)) continue;
      const group = new Set([start]);
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop();
        for (const n of this.blueprint.neighbours(cur)) {
          if (!rec.ids.has(n.id) || seen.has(n.id)) continue;
          seen.add(n.id); group.add(n.id); stack.push(n.id);
        }
      }
      groups.push(group);
    }
    if (groups.length <= 1) { this._refreshAnchor(rec); this.dirty = true; return; }

    groups.sort((a, b) => b.size - a.size);
    const motion = new Map();
    if (rec.dynamic) {
      const snap = {
        t: rec.body.translation(), q: rec.body.rotation(),
        lv: rec.body.linvel(), av: rec.body.angvel(), origin: rec.origin,
      };
      for (const id of rec.ids) motion.set(id, snap);
    }
    for (let i = 1; i < groups.length; i++) {
      for (const id of groups[i]) this._detachPart(rec, id);
      this._createBody(groups[i], motion);
    }
    this._refreshAnchor(rec);
    this.dirty = true;
  }

  paint(id, color) {
    const rec = this.blueprint.parts.get(id);
    if (!rec) return;
    rec.color = color;
    const mesh = this.meshes.get(id);
    if (mesh) mesh.material = materialFor(color);
  }

  idOfObject(obj) { return obj?.userData?.partId ?? null; }

  /** `G`: cut a construction loose, or put a loose one back where it belongs. */
  toggleRelease(partId) {
    const rec = this.bodies.get(this.partBody.get(partId));
    if (!rec) return null;
    const wasDynamic = rec.dynamic;
    for (const id of rec.ids) {
      if (wasDynamic) this.released.delete(id); else this.released.add(id);
    }
    if (wasDynamic) this._resetToBlueprint(rec);
    this._reform();
    this._relieveOverload();
    return wasDynamic ? 'anchored' : 'released';
  }

  // --- forming bodies -------------------------------------------------------

  /**
   * Full reconciliation: bring every rigid body back in line with the
   * blueprint's components, from scratch.
   *
   * This is the O(everything) path, and it is reserved for the two operations
   * that can rearrange the world wholesale — putting a released construction
   * back on its anchor, and loading a save. Placing, removing and snapping all
   * take incremental paths instead.
   *
   * Even here, colliders are not torn down wholesale: each component is matched
   * to the existing body it shares the most parts with, that body is kept, and
   * only the parts that actually changed hands move.
   */
  _reform() {
    const motion = new Map();
    for (const rec of this.bodies.values()) {
      if (!rec.dynamic) continue;
      const snap = {
        t: rec.body.translation(), q: rec.body.rotation(),
        lv: rec.body.linvel(), av: rec.body.angvel(), origin: rec.origin,
      };
      for (const id of rec.ids) motion.set(id, snap);
    }

    const groups = this._groups();
    const claimed = new Set();
    const assignments = [];
    for (const group of groups) {
      const counts = new Map();
      for (const id of group) {
        const k = this.partBody.get(id);
        if (k === undefined || claimed.has(k)) continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let best = null, bestN = 0;
      for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
      if (best !== null) claimed.add(best);
      assignments.push({ key: best, group });
    }

    for (const key of [...this.bodies.keys()]) {
      if (!claimed.has(key)) this._destroyBody(key);
    }

    for (const { key, group } of assignments) {
      const rec = key === null ? this._createBody(group, motion) : this.bodies.get(key);
      if (key !== null) {
        for (const id of [...rec.ids]) if (!group.has(id)) this._detachPart(rec, id);
        for (const id of group) if (!rec.ids.has(id)) this._attachPart(rec, id);
      }
      this._refreshAnchor(rec);
    }
    this.dirty = true;
  }

  /**
   * Components, with one correction: a construction that has been released has
   * moved, so its blueprint cells no longer say where it is. Its parts must
   * never be folded into a body with anything else, however adjacent the two
   * look on the grid.
   */
  _groups() {
    const groups = this.blueprint.components();
    const loose = [...this.bodies.values()].filter((r) => r.dynamic);
    if (!loose.length) return groups;

    const out = [];
    for (const group of groups) {
      for (const rec of loose) {
        const shared = [...rec.ids].filter((id) => group.has(id));
        if (!shared.length || shared.length === group.size) continue;
        for (const id of shared) group.delete(id);
        out.push(new Set(shared));
      }
      if (group.size) out.push(group);
    }
    return out;
  }

  _shouldAnchor(ids) {
    for (const id of ids) if (this.released.has(id)) return false;
    for (const id of ids) if (this.blueprint.parts.get(id).cell[1] === 0) return true;
    return false;
  }

  /** Flip a body between fixed and dynamic without rebuilding it. */
  _refreshAnchor(rec) {
    const anchored = this._shouldAnchor(rec.ids);
    if (anchored === !rec.dynamic) return;
    const { RAPIER } = this;
    rec.dynamic = !anchored;
    rec.body.setBodyType(anchored ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    rec.prevVel = null;
  }

  /** Put a loose body back exactly where its blueprint drew it. */
  _resetToBlueprint(rec) {
    rec.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rec.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rec.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    rec.body.setTranslation({ x: rec.origin[0], y: rec.origin[1], z: rec.origin[2] }, true);
    rec.prevVel = null;
  }

  /**
   * A body for a group that has no ancestor to inherit. If any of its parts was
   * moving a moment ago — because it just broke off something — the new body
   * takes that motion, including the part of the velocity that comes from the
   * parent's spin about a point this fragment no longer turns around. Without
   * that term, debris from a spinning wreck drops straight down and the whole
   * impact reads as fake.
   */
  _createBody(group, motion) {
    const { RAPIER, world } = this;

    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const id of group) {
      const r = this.blueprint.parts.get(id);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], r.cell[a]);
        max[a] = Math.max(max[a], r.cell[a] + r.rs[a]);
      }
    }
    const origin = [
      (min[0] + max[0]) / 2 * CELL, (min[1] + max[1]) / 2 * CELL, (min[2] + max[2]) / 2 * CELL,
    ];

    let pos = { x: origin[0], y: origin[1], z: origin[2] };
    let rot = { x: 0, y: 0, z: 0, w: 1 };
    let linvel = null, angvel = null;
    const seed = [...group].map((id) => motion.get(id)).find(Boolean);
    if (seed) {
      const q = new THREE.Quaternion(seed.q.x, seed.q.y, seed.q.z, seed.q.w);
      const d = new THREE.Vector3(
        origin[0] - seed.origin[0], origin[1] - seed.origin[1], origin[2] - seed.origin[2],
      ).applyQuaternion(q);
      pos = { x: seed.t.x + d.x, y: seed.t.y + d.y, z: seed.t.z + d.z };
      rot = seed.q;
      angvel = seed.av;
      linvel = {
        x: seed.lv.x + (seed.av.y * d.z - seed.av.z * d.y),
        y: seed.lv.y + (seed.av.z * d.x - seed.av.x * d.z),
        z: seed.lv.z + (seed.av.x * d.y - seed.av.y * d.x),
      };
    }

    const anchored = this._shouldAnchor(group);
    const body = world.createRigidBody(
      (anchored ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(rot),
    );
    if (!anchored && linvel) { body.setLinvel(linvel, true); body.setAngvel(angvel, true); }

    const group3 = new THREE.Group();
    group3.position.set(pos.x, pos.y, pos.z);
    group3.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.root.add(group3);

    const rec = {
      key: this._nextKey++, body, group: group3, ids: new Set(),
      origin, dynamic: !anchored, prevVel: null,
    };
    this.bodies.set(rec.key, rec);
    for (const id of group) this._attachPart(rec, id);
    return rec;
  }

  _attachPart(rec, id) {
    const { RAPIER, world } = this;
    const part = this.blueprint.parts.get(id);
    const def = PARTS[part.partId];
    const c = cellBoxCentre(part.cell, part.rs);
    const local = [c[0] - rec.origin[0], c[1] - rec.origin[1], c[2] - rec.origin[2]];
    const e = oriEuler(part.ori);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'YXZ'));

    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometryFor(def), materialFor(part.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = id;
      this.meshes.set(id, mesh);
    }
    mesh.position.set(local[0], local[1], local[2]);
    mesh.quaternion.copy(q);
    rec.group.add(mesh);

    const col = world.createCollider(
      colliderDescFor(RAPIER, def)
        .setTranslation(local[0], local[1], local[2])
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setDensity(DENSITY)
        .setFriction(0.9)
        .setRestitution(0.05)
        .setCollisionGroups(FILTER.PART),
      rec.body,
    );
    this.partCollider.set(id, col);
    this.partBody.set(id, rec.key);
    rec.ids.add(id);
  }

  _detachPart(rec, id) {
    if (!rec) return;
    const col = this.partCollider.get(id);
    if (col) { this.world.removeCollider(col, true); this.partCollider.delete(id); }
    const mesh = this.meshes.get(id);
    if (mesh && mesh.parent === rec.group) rec.group.remove(mesh);
    rec.ids.delete(id);
    if (this.partBody.get(id) === rec.key) this.partBody.delete(id);
  }

  _destroyBody(key) {
    const rec = this.bodies.get(key);
    if (!rec) return;
    for (const id of [...rec.ids]) this._detachPart(rec, id);
    this.world.removeRigidBody(rec.body);
    this.root.remove(rec.group);
    this.bodies.delete(key);
  }

  _forgetMesh(id) {
    const mesh = this.meshes.get(id);
    if (mesh) { mesh.parent?.remove(mesh); this.meshes.delete(id); }
  }

  // --- failure --------------------------------------------------------------

  /**
   * Snap the links that cannot carry what hangs off them. Runs after every
   * change, and only on anchored components: a free body in flight is not
   * loaded by its own weight.
   */
  _relieveOverload() {
    for (let pass = 0; pass < MAX_OVERLOAD_PASSES; pass++) {
      let broke = false;
      const touched = new Set();
      for (const rec of [...this.bodies.values()]) {
        if (rec.dynamic) continue;
        const roots = [...rec.ids].filter((id) => this.blueprint.parts.get(id).cell[1] === 0);
        if (!roots.length) continue;
        for (const link of this.blueprint.loadBearingLinks(rec.ids, roots)) {
          const strength = this.blueprint.linkStrength(link.a, link.b);
          if (strength <= 0) continue;
          const ca = this.blueprint.centre(link.a), cb = this.blueprint.centre(link.b);
          const arm = Math.hypot(
            link.centre[0] - (ca[0] + cb[0]) / 2,
            link.centre[2] - (ca[2] + cb[2]) / 2,
          );
          const load = link.mass * G * (1 + arm / LEVER_SCALE);
          if (load > strength && this.blueprint.breakLink(link.a, link.b)) {
            broke = true; touched.add(rec);
          }
        }
      }
      if (!broke) return;
      for (const rec of touched) if (this.bodies.has(rec.key)) this._resplit(rec);
    }
  }

  /**
   * A body was struck: it lost `dv` metres per second in one step, at `partId`.
   *
   * The force a link has to survive is not the whole body's momentum change —
   * only what that link has to decelerate, i.e. the mass hanging beyond it on
   * the far side from the blow. Rooting the bridge search at the struck part
   * gives exactly that, and it is why a heavy braced build is not automatically
   * more fragile than a light one: braced links sit in cycles, so they are not
   * bridges, so nothing asks them to carry the blow alone.
   */
  impact(partId, dv) {
    const rec = this.bodies.get(this.partBody.get(partId));
    if (!rec) return false;
    let broke = false;
    for (const link of this.blueprint.loadBearingLinks(rec.ids, [partId])) {
      if (link.mass * dv / FIXED_DT > this.blueprint.linkStrength(link.a, link.b)
          && this.blueprint.breakLink(link.a, link.b)) broke = true;
    }
    return broke;
  }

  /**
   * Called after every physics step. Rapier's own contact-force events report
   * the resting weight of a stack, not the shock of a landing — measured, they
   * came back at ~370 N whether a block fell half a metre or twenty. The
   * momentum a body actually loses in one step does scale with the fall, so
   * that is the signal: everything above what gravity alone explains is a blow.
   */
  afterStep() {
    let broke = false;
    const touched = new Set();
    for (const rec of [...this.bodies.values()]) {
      if (!rec.dynamic) continue;
      const v = rec.body.linvel();
      const prev = rec.prevVel;
      rec.prevVel = { x: v.x, y: v.y, z: v.z };
      if (!prev) continue;

      const dx = v.x - prev.x, dy = v.y - prev.y, dz = v.z - prev.z;
      const dv = Math.max(0, Math.hypot(dx, dy, dz) - G * FIXED_DT);
      if (dv <= 0) continue;
      // Cheap gate: if the body's whole momentum could not break the weakest
      // link in the catalogue, no per-link search can find a break either.
      if (rec.body.mass() * dv / FIXED_DT < MIN_LINK_FORCE) continue;

      const struck = this._partFacing(rec, -dx, -dy, -dz);
      if (struck !== null && this.impact(struck, dv)) { broke = true; touched.add(rec); }
    }
    if (broke) {
      for (const rec of touched) if (this.bodies.has(rec.key)) this._resplit(rec);
      this._relieveOverload();
    }
    return broke;
  }

  /** The part of a body furthest along a world direction — where the blow landed. */
  _partFacing(rec, dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz);
    if (len === 0) return null;
    const q = rec.body.rotation();
    const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const v = new THREE.Vector3();
    let best = null, bestDot = -Infinity;
    for (const id of rec.ids) {
      const c = this.blueprint.centre(id);
      v.set(c[0] - rec.origin[0], c[1] - rec.origin[1], c[2] - rec.origin[2]).applyQuaternion(rot);
      const dot = (v.x * dx + v.y * dy + v.z * dz) / len;
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    return best;
  }

  // --- per-frame ------------------------------------------------------------

  sync() {
    for (const rec of this.bodies.values()) {
      if (!rec.dynamic && !this.dirty) continue;
      const t = rec.body.translation();
      const q = rec.body.rotation();
      rec.group.position.set(t.x, t.y, t.z);
      rec.group.quaternion.set(q.x, q.y, q.z, q.w);
    }
    this.dirty = false;
  }

  load(data) {
    for (const key of [...this.bodies.keys()]) this._destroyBody(key);
    for (const id of [...this.meshes.keys()]) this._forgetMesh(id);
    this.released.clear();
    this.blueprint = Blueprint.fromJSON(data);
    this._reform();
    this._relieveOverload();
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
