// mechanisms.js — pistons, hinges and rotary motors.
//
// These are the first parts that genuinely need Rapier joints. Everything up to
// now was a weld (one rigid body per component) or a raycast (wheels), both
// chosen specifically to keep joints out of the simulation, because joints are
// where a physics build starts to shiver. A piston cannot be faked that way: it
// has to hold two bodies together and move one relative to the other.
//
// The damage is bounded by making mechanisms the *only* joints, and few: a
// construction with three pistons has three joints, not three hundred. Rapier
// solves that without complaint.
//
// A mechanism moves whatever touches its far face. That set is worked out once
// when the part is placed (Blueprint.movingSideOf) and turned into exactly one
// joint per mechanism here.

import * as THREE from 'three';
import { PARTS } from '../shared/parts.js';
import { materialFor } from '../render/materials.js';
import { modelMaterialFor } from '../render/geometry.js';

/** A unit cylinder, scaled each frame to bridge whatever the piston has opened. */
const ROD = new THREE.CylinderGeometry(0.12, 0.12, 1, 12);
const UP = new THREE.Vector3(0, 1, 0);

/** How hard a piston holds its commanded length. */
const PISTON_STIFFNESS = 1.0;
const PISTON_DAMPING = 0.35;

export class Mechanisms {
  constructor(construction) {
    this.c = construction;
    this.joints = new Map();   // mechanism part id -> record
    this.dirty = true;
  }

  markDirty() { this.dirty = true; }

  get count() { return this.joints.size; }

  /**
   * Rebuild every joint from scratch.
   *
   * Bodies are created and destroyed constantly — merges, splits, breaks — and a
   * joint outliving its body is a crash. Rebuilding all of them after a topology
   * change is a handful of operations and removes the entire question of which
   * joints a given change invalidated.
   */
  refresh() {
    const { c } = this;
    for (const m of this.joints.values()) {
      c.world.removeImpulseJoint(m.joint, true);
      m.rod?.parent?.remove(m.rod);
    }
    this.joints.clear();
    this.dirty = false;

    for (const rec of c.bodies.values()) {
      // In the yard nothing articulates: the construction is on the lift.
      if (rec.bp === c.yard) continue;
      for (const id of rec.ids) {
        const part = rec.bp.parts.get(id);
        const def = PARTS[part.partId];
        if (!def.mechanism) continue;
        for (const otherId of rec.bp.movingSideOf(id)) {
          const other = c.bodyOf(otherId);
          if (!other || other.key === rec.key) continue;
          const made = this._make(rec, other, id, def);
          if (made) this.joints.set(id, made);
          break;   // one mechanism, one joint, whatever it carries
        }
      }
    }
  }

  _make(rec, other, id, def) {
    const { RAPIER, world } = this.c;
    const { point, axis } = rec.bp.jointAnchor(id);
    const anchor = (origin) => ({
      x: point[0] - origin[0], y: point[1] - origin[1], z: point[2] - origin[2],
    });
    const ax = { x: axis[0], y: axis[1], z: axis[2] };
    const spec = def.mechanism;

    let params;
    if (spec.kind === 'piston') {
      params = RAPIER.JointData.prismatic(anchor(rec.origin), anchor(other.origin), ax);
      params.limitsEnabled = true;
      params.limits = [0, spec.travel];
    } else {
      params = RAPIER.JointData.revolute(anchor(rec.origin), anchor(other.origin), ax);
      if (spec.limit) {
        params.limitsEnabled = true;
        params.limits = [-spec.limit, spec.limit];
      }
    }
    const joint = world.createImpulseJoint(params, rec.body, other.body, true);
    const m = { joint, spec, id, bp: rec.bp, target: 0, a: rec.body, b: other.body,
                a1: anchor(rec.origin), a2: anchor(other.origin) };
    if (spec.kind === 'piston') {
      // The model is a *retracted* piston: it fills its cell and its rod is
      // inside. Extended, the part it carries walks away and leaves a hole, so
      // the exposed length of rod is drawn as its own mesh between the two
      // bodies. Cheaper and more honest than trying to stretch a baked mesh.
      // The rod belongs to the piston, so it wears the piston's own steel —
      // the chrome slug in the model, whose material slot is the last one.
      const own = modelMaterialFor(rec.bp.parts.get(id).partId);
      const chrome = Array.isArray(own) ? own[own.length - 1] : own;
      m.rod = new THREE.Mesh(ROD, chrome ?? materialFor(rec.bp.parts.get(id).color));
      m.rod.castShadow = true;
      m.rod.visible = false;
      this.c.root.add(m.rod);
    }
    return m;
  }

  /**
   * One step of mechanism control. `byGrid` maps a construction's grid to the
   * input its driver is giving, so every body of one machine gets the same
   * orders even though the machine is several bodies.
   */
  step(byGrid) {
    if (this.dirty) this.refresh();
    for (const m of this.joints.values()) {
      // A wired mechanism takes its orders from the circuit; only an unwired one
      // still answers the arrow keys. That is the whole promise of phase 5: once
      // you have built the controls, you stop driving the parts by hand.
      const wired = this.c.logic.signalFor(m.bp, m.id);
      const ctl = wired === null
        ? byGrid.get(m.bp)?.mech
        : { extend: wired ? 1 : -1, turn: wired ? 1 : 0 };
      // Rapier sends idle bodies to sleep and configuring a motor does not wake
      // them: measured, a piston commanded to full extension sat still for four
      // seconds because both its bodies were asleep. Any live command wakes them.
      if (ctl && (ctl.extend || ctl.turn)) { m.a.wakeUp(); m.b.wakeUp(); }
      if (m.spec.kind === 'piston') {
        if (ctl?.extend > 0) m.target = m.spec.travel;
        else if (ctl?.extend < 0) m.target = 0;
        m.joint.configureMotorPosition?.(m.target, m.spec.force * PISTON_STIFFNESS,
                                         m.spec.force * PISTON_DAMPING);
      } else if (m.spec.kind === 'bearing') {
        const dir = ctl?.turn ?? 0;
        m.joint.configureMotorVelocity?.(dir * m.spec.speed, m.spec.torque);
      }
      // A hinge has no motor: it swings on whatever the world does to it.
    }
  }

  /** Stretch each piston's exposed rod across the gap it has opened. */
  syncVisuals() {
    for (const m of this.joints.values()) {
      if (!m.rod) continue;
      worldPoint(m.a, m.a1, PA);
      worldPoint(m.b, m.a2, PB);
      const len = PA.distanceTo(PB);
      m.rod.visible = len > 0.01;
      if (!m.rod.visible) continue;
      m.rod.position.copy(PA).add(PB).multiplyScalar(0.5);
      m.rod.quaternion.setFromUnitVectors(UP, DIR.copy(PB).sub(PA).normalize());
      m.rod.scale.set(1, len, 1);
    }
  }

  clear() {
    for (const m of this.joints.values()) {
      this.c.world.removeImpulseJoint(m.joint, true);
      m.rod?.parent?.remove(m.rod);
    }
    this.joints.clear();
    this.dirty = true;
  }
}

const PA = new THREE.Vector3();
const PB = new THREE.Vector3();
const DIR = new THREE.Vector3();
const Q = new THREE.Quaternion();

/** A body-local point in world space. */
function worldPoint(body, local, out) {
  const t = body.translation();
  const r = body.rotation();
  return out.set(local.x, local.y, local.z)
    .applyQuaternion(Q.set(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}
