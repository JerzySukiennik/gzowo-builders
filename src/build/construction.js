// construction.js — constructions: their grids, their bodies, their failure.
//
// One place owns the three representations of a placed part: the record in a
// Blueprint (truth), the mesh (what you see) and the collider (what you stand
// on). Adding, removing or snapping a part goes through here so they can never
// drift.
//
// **One rigid body per connected component, not per part.** A thousand-part
// build would otherwise be a thousand bodies and three thousand joints, which
// the target machine will not carry, and which solves into jelly long before it
// solves into a car. Structural failure is modelled by *cutting the graph* and
// re-forming bodies: a break makes two bodies out of one, rather than a joint
// giving way.
//
// **Every construction has its own grid.** The yard is the grid of everything
// anchored to the meadow; it sits at identity, so its cells are world cells. The
// moment a construction is released it is carved out into a blueprint of its
// own and carries a transform. That is what lets a car drive away, be built on
// while it stands somewhere else entirely, and free up the ground it was
// designed on.

import * as THREE from 'three';
import { Blueprint, linkKey } from '../shared/blueprint.js';
import { DENSITY, JOINT_STRENGTH_PER_CELL, PARTS } from '../shared/parts.js';
import { CELL, cellBoxCentre, oriEuler } from '../shared/grid.js';
import { geometryFor } from '../render/geometry.js';
import { materialFor } from '../render/materials.js';
import { FILTER, FIXED_DT } from '../physics/world.js';
import { Vehicle } from './vehicle.js';

const G = 9.81;
/** The weakest link in the catalogue is one cell² of face. A blow that cannot
 *  break even that is not worth a per-link search. */
const MIN_LINK_FORCE = JOINT_STRENGTH_PER_CELL;
/**
 * Speed a body has to lose in one step before it counts as being hit, m/s.
 *
 * Cancelling a vehicle's own suspension impulses is never exact — the solver
 * clamps, contacts fight, and a few centimetres per second of residue survives
 * every step. That residue is harmless until you notice what the impact rule
 * does with it: rooted at a wheel, the one link holding that wheel on is asked
 * to carry the deceleration of the entire car, so 0.2 m/s of noise tears the
 * wheels off a car that is driving in a straight line. Real blows are metres
 * per second — the smallest measured in phase 2 was 1.26 from a 0.25 m drop —
 * so this floor throws away the noise without touching a single real impact.
 */
const MIN_IMPACT_DV = 0.6;
/** A cantilever multiplies the load its root link carries. Half a metre of
 *  overhang doubles it — a stand-in for a real moment calculation, tuned so
 *  walls are safe and long unsupported arms are not. */
const LEVER_SCALE = 0.5;
const MAX_OVERLOAD_PASSES = 6;

export class Construction {
  constructor(scene, RAPIER, world) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.yard = new Blueprint();

    this.root = new THREE.Group();
    this.root.name = 'construction';
    scene.add(this.root);

    this.meshes = new Map();        // part id -> Mesh
    this.bodies = new Map();        // body key -> body record
    this.partBody = new Map();      // part id -> body key
    this.partCollider = new Map();  // part id -> Collider
    this.released = new Set();      // parts cut loose from the ground
    this._nextKey = 1;
    this._nextPartId = 1;
    this.dirty = false;
  }

  get count() {
    let n = this.yard.parts.size;
    for (const rec of this.bodies.values()) if (rec.bp !== this.yard) n += rec.bp.parts.size;
    return n;
  }

  get bodyCount() { return this.bodies.size; }
  get raycastTargets() { return [...this.meshes.values()]; }

  bodyOf(partId) { return this.bodies.get(this.partBody.get(partId)) ?? null; }
  bpOf(partId) { return this.bodyOf(partId)?.bp ?? null; }
  recordOf(partId) { return this.bpOf(partId)?.parts.get(partId) ?? null; }

  /** Every construction is anchored or not; the cursor needs to know which. */
  isAnchored(partId) {
    const rec = this.bodyOf(partId);
    return !!rec && !rec.dynamic;
  }

  /**
   * Which grid a placement lands in — a body you pointed at, or the yard.
   *
   * Returns null for a key that no longer names a body. Falling back to the yard
   * would be silently catastrophic: a part aimed at a car would be created at
   * the car's *local* cell coordinates in world space, i.e. somewhere near the
   * origin, nowhere near where the player was looking. Bodies are destroyed and
   * remade routinely (merges, splits), so a stale key is ordinary, not exotic.
   */
  gridFor(targetKey) {
    if (targetKey === null || targetKey === undefined) return this.yard;
    return this.bodies.get(targetKey)?.bp ?? null;
  }

  canPlace(partId, cell, ori, targetKey = null) {
    return this.gridFor(targetKey)?.canPlace(partId, cell, ori) ?? false;
  }

  place(partId, cell, ori, color, targetKey = null) {
    const bp = this.gridFor(targetKey);
    if (!bp) return null;
    const rec = bp.add({ partId, cell, ori, color, id: this._nextPartId++ });
    if (!rec) { this._nextPartId--; return null; }
    this._insertPart(bp, rec.id);
    this._relieveOverload();
    return rec;
  }

  removeById(id) {
    const body = this.bodyOf(id);
    const bp = body ? body.bp : this.yard;
    const rec = bp.remove(id);
    if (!rec) return null;
    this.released.delete(id);
    if (body) {
      this._detachPart(body, id);
      if (body.ids.size) this._resplit(body); else this._destroyBody(body.key);
    }
    this._forgetMesh(id);
    this._relieveOverload();
    this.dirty = true;
    return rec;
  }

  paint(id, color) {
    const rec = this.recordOf(id);
    if (!rec) return;
    rec.color = color;
    const mesh = this.meshes.get(id);
    if (mesh) mesh.material = materialFor(color);
  }

  idOfObject(obj) { return obj?.userData?.partId ?? null; }

  /**
   * `G`: cut a construction loose from the meadow, or put a loose one back.
   *
   * Releasing carves the component out of the yard into a grid of its own, which
   * both frees the ground it was designed on and gives the construction a frame
   * that travels with it. Re-anchoring is the same move in reverse, and it can
   * fail: if someone has built where the car used to stand, there is nowhere to
   * put it back.
   */
  toggleRelease(partId) {
    const rec = this.bodyOf(partId);
    if (!rec) return null;

    if (rec.dynamic) {
      for (const [id, part] of rec.bp.parts) {
        if (!this.yard.canPlace(part.partId, part.cell, part.ori)) return 'blocked';
      }
      this._resetToBlueprint(rec);
      for (const [id, part] of rec.bp.parts) {
        this.yard.add({ id, partId: part.partId, cell: part.cell, ori: part.ori, color: part.color });
        this.released.delete(id);
      }
      for (const key of rec.bp.broken) this.yard.broken.add(key);
      rec.bp = this.yard;
      this._refreshAnchor(rec);
      this._relieveOverload();
      return 'anchored';
    }

    rec.bp = this._carve(this.yard, rec.ids);
    for (const id of rec.ids) this.released.add(id);
    this._refreshAnchor(rec);
    this.dirty = true;
    return 'released';
  }

  /** Move a set of parts out of one grid into a fresh one, links and all. */
  _carve(from, ids) {
    const bp = new Blueprint();
    for (const id of ids) {
      const part = from.parts.get(id);
      if (!part) continue;
      bp.add({ id, partId: part.partId, cell: part.cell, ori: part.ori, color: part.color });
    }
    for (const id of ids) {
      for (const other of ids) {
        if (id >= other) continue;
        const key = linkKey(id, other);
        if (from.broken.has(key)) bp.broken.add(key);
      }
    }
    for (const id of ids) from.remove(id);
    return bp;
  }

  // --- forming bodies -------------------------------------------------------

  /**
   * Fold a freshly placed part into the bodies it touches.
   *
   * Placement is the one operation that happens under the player's finger, so it
   * never scans the world: a new part can only ever *join* components, and which
   * ones is answered by its own neighbours. Splitting — the expensive direction
   * — can only be caused by removing a part or snapping a link, and even then
   * only within the one body affected.
   */
  _insertPart(bp, id) {
    const keys = new Set();
    for (const n of bp.neighbours(id)) {
      const key = this.partBody.get(n.id);
      const rec = key === undefined ? null : this.bodies.get(key);
      if (rec && rec.bp === bp) keys.add(key);
    }

    if (!keys.size) { this._createBody(bp, new Set([id]), new Map()); this.dirty = true; return; }

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
        for (const n of rec.bp.neighbours(cur)) {
          if (!rec.ids.has(n.id) || seen.has(n.id)) continue;
          seen.add(n.id); group.add(n.id); stack.push(n.id);
        }
      }
      groups.push(group);
    }
    if (groups.length <= 1) { this._refreshAnchor(rec); this.dirty = true; return; }

    // One fragment keeps the yard and stays put; the rest are carved out and
    // fall. The keeper is whichever still reaches the meadow, or the largest.
    const reachesGround = (g) => [...g].some((id) => rec.bp.parts.get(id).cell[1] === 0);
    groups.sort((a, b) => (reachesGround(b) - reachesGround(a)) || (b.size - a.size));
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
      // Every fragment gets a grid of its own — including fragments of the yard,
      // which is what lets them stop being anchored and drop.
      const bp = this._carve(rec.bp, groups[i]);
      this._createBody(bp, groups[i], motion);
    }
    this._refreshAnchor(rec);
    this.dirty = true;
  }

  /**
   * Anchored means "still in the yard". Not "touching the ground" — a car
   * chassis sits a metre up on its wheels and would have nothing to stand on
   * while you build it, which is exactly the problem a workshop lift solves.
   * Everything you place is held where you put it until you release it; a piece
   * that snaps off is carved out of the yard by _resplit and falls.
   */
  _shouldAnchor(bp, ids) {
    if (bp !== this.yard) return false;
    for (const id of ids) if (this.released.has(id)) return false;
    return true;
  }

  /** Flip a body between fixed and dynamic without rebuilding it. */
  _refreshAnchor(rec) {
    const anchored = this._shouldAnchor(rec.bp, rec.ids);
    if (anchored === !rec.dynamic) { this._refreshVehicle(rec); return; }
    const { RAPIER } = this;
    rec.dynamic = !anchored;
    rec.body.setBodyType(anchored ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    rec.prevVel = null;
    this._refreshVehicle(rec);
  }

  /** A loose construction with wheels is a vehicle; an anchored one is furniture. */
  _refreshVehicle(rec) {
    if (rec.dynamic) {
      if (!rec.vehicle) rec.vehicle = new Vehicle(this, rec);
      rec.vehicle.rebuild();
      const v = rec.vehicle;
      // A wheel needs something to be a wheel *of*. A bare one that has just
      // been torn off is debris: it should lie in the grass like any other part,
      // not keep running a suspension that holds nothing up.
      const isVehicle = v.seats.length > 0
        || (v.wheels.length > 0 && v.wheels.length < rec.ids.size);
      if (!isVehicle) rec.vehicle = null;
    } else if (rec.vehicle) {
      rec.vehicle = null;
    }
    this._refreshWheelFilters(rec);
  }

  /**
   * A wheel is held off the ground by its suspension ray, so its collider is
   * filtered off the terrain — otherwise ray and collider fight and the car
   * buzzes. The moment that wheel stops being part of a vehicle, nothing holds
   * it up any more and it falls straight through the meadow. So the filter is
   * not a property of the part, it is a property of the part's *job*: a wheel
   * doing suspension ignores terrain, a wheel lying in the grass does not.
   */
  _refreshWheelFilters(rec) {
    for (const id of rec.ids) {
      const def = PARTS[rec.bp.parts.get(id).partId];
      if (def.shape !== 'wheel') continue;
      const driving = !!rec.vehicle?.wheels.some((w) => w.id === id);
      this.partCollider.get(id)?.setCollisionGroups(driving ? FILTER.WHEEL : FILTER.PART);
    }
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
   * A body for a group. If any of its parts was moving a moment ago — because it
   * just broke off something — the new body takes that motion, including the
   * part of the velocity that comes from the parent's spin about a point this
   * fragment no longer turns around. Without that term, debris from a spinning
   * wreck drops straight down and the whole impact reads as fake.
   */
  _createBody(bp, group, motion) {
    const { RAPIER, world } = this;

    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const id of group) {
      const r = bp.parts.get(id);
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

    const anchored = this._shouldAnchor(bp, group);
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
      key: this._nextKey++, bp, body, group: group3, ids: new Set(),
      origin, dynamic: !anchored, prevVel: null, vehicle: null,
    };
    this.bodies.set(rec.key, rec);
    for (const id of group) this._attachPart(rec, id);
    this._refreshVehicle(rec);
    return rec;
  }

  _attachPart(rec, id) {
    const { RAPIER, world } = this;
    const part = rec.bp.parts.get(id);
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
        .setCollisionGroups(def.shape === 'wheel' ? FILTER.WHEEL : FILTER.PART),
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
    rec.vehicle = null;
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
        const roots = [...rec.ids].filter((id) => rec.bp.parts.get(id).cell[1] === 0);
        if (!roots.length) continue;
        for (const link of rec.bp.loadBearingLinks(rec.ids, roots)) {
          const strength = rec.bp.linkStrength(link.a, link.b);
          if (strength <= 0) continue;
          const ca = rec.bp.centre(link.a), cb = rec.bp.centre(link.b);
          const arm = Math.hypot(
            link.centre[0] - (ca[0] + cb[0]) / 2,
            link.centre[2] - (ca[2] + cb[2]) / 2,
          );
          const load = link.mass * G * (1 + arm / LEVER_SCALE);
          if (load > strength && rec.bp.breakLink(link.a, link.b)) { broke = true; touched.add(rec); }
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
    const rec = this.bodyOf(partId);
    if (!rec) return false;
    let broke = false;
    for (const link of rec.bp.loadBearingLinks(rec.ids, [partId])) {
      if (link.mass * dv / FIXED_DT > rec.bp.linkStrength(link.a, link.b)
          && rec.bp.breakLink(link.a, link.b)) broke = true;
    }
    return broke;
  }

  /**
   * Called after every physics step. Rapier's own contact-force events report
   * the resting weight of a stack, not the shock of a landing — measured, they
   * came back at ~370 N whether a block fell half a metre or twenty. The
   * momentum a body actually loses in one step does scale with the fall, so that
   * is the signal: everything above what gravity alone explains is a blow.
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

      // What the world did to this body = the momentum it gained, less what
      // gravity explains and less what the vehicle's own suspension pushed with.
      // Without the second term a car landing on its springs reads as a crash
      // and shakes itself to pieces the moment it is released.
      const m = rec.body.mass();
      const own = rec.vehicle?.appliedImpulse;
      const dx = v.x - prev.x - (own ? own.x / m : 0);
      const dy = v.y - prev.y - (own ? own.y / m : 0) + G * FIXED_DT;
      const dz = v.z - prev.z - (own ? own.z / m : 0);
      const dv = Math.hypot(dx, dy, dz);
      if (dv < MIN_IMPACT_DV) continue;
      if (m * dv / FIXED_DT < MIN_LINK_FORCE) continue;

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
      const c = rec.bp.centre(id);
      v.set(c[0] - rec.origin[0], c[1] - rec.origin[1], c[2] - rec.origin[2]).applyQuaternion(rot);
      const dot = (v.x * dx + v.y * dy + v.z * dz) / len;
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    return best;
  }

  // --- per-frame ------------------------------------------------------------

  /** Wheels and drive, before the solver runs. */
  beforeStep(controls) {
    for (const rec of this.bodies.values()) {
      if (rec.vehicle) rec.vehicle.step(controls.get(rec.key) ?? null);
    }
  }

  sync() {
    for (const rec of this.bodies.values()) {
      if (rec.dynamic || this.dirty) {
        const t = rec.body.translation();
        const q = rec.body.rotation();
        rec.group.position.set(t.x, t.y, t.z);
        rec.group.quaternion.set(q.x, q.y, q.z, q.w);
      }
      rec.vehicle?.syncVisuals();
    }
    this.dirty = false;
  }

  clear() {
    for (const key of [...this.bodies.keys()]) this._destroyBody(key);
    for (const id of [...this.meshes.keys()]) this._forgetMesh(id);
    this.released.clear();
    this.yard = new Blueprint();
  }
}

/** Colliders stay primitive: a box for boxes, a hull for the sloped shapes. */
function colliderDescFor(RAPIER, def) {
  const hx = def.size[0] * CELL / 2, hy = def.size[1] * CELL / 2, hz = def.size[2] * CELL / 2;
  if (def.shape === 'wheel') return RAPIER.ColliderDesc.cylinder(def.wheel.width / 2, def.wheel.radius);
  if (def.shape === 'box' || def.shape === 'seat') return RAPIER.ColliderDesc.cuboid(hx, hy, hz);

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
