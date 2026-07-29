// logic.js — buttons, switches, timers and gates.
//
// Phase 5. Every logic part holds one boolean and a cable carries it onward.
// That is the whole model, and it is deliberately the smallest one that can
// build something interesting: a button wired to a piston is a working lift,
// and an AND of two switches is a safety interlock.
//
// Unlike welds, wires do not have to touch — which is the entire reason to have
// them. They live in the construction's own grid, so they travel with it and
// survive being released, driven away and re-anchored.
//
// Evaluation is two passes over the parts per physics step. A proper
// topological sort would be exact for feed-forward circuits and useless for the
// ones with feedback, which are the interesting ones; two passes costs nothing
// and settles most circuits within a frame or two, which at 60 Hz nobody sees.

import * as THREE from 'three';
import { PARTS } from '../shared/parts.js';
import { cellBoxCentre, rotateVec } from '../shared/grid.js';
import { FILTER } from '../physics/world.js';

const _q = new THREE.Quaternion();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _t = new THREE.Vector3();

const PASSES = 2;
/** How long a button stays on after a poke, in physics steps. */
const PULSE = 24;

export class Logic {
  constructor(construction) {
    this.c = construction;
    this.state = new Map();      // part id -> boolean
    this.pulse = new Map();      // part id -> steps remaining
    this.delay = new Map();      // timer part id -> steps remaining
    this.wireView = null;
    this.viewDirty = true;
  }

  markDirty() { this.viewDirty = true; }

  isOn(id) { return this.state.get(id) === true; }

  /** `E` on a button pokes it; on a switch it flips it and it stays. */
  interact(id) {
    const rec = this.c.recordOf(id);
    const def = rec && PARTS[rec.partId];
    if (!def?.logic) return false;
    if (def.logic.kind === 'button') { this.pulse.set(id, PULSE); return true; }
    if (def.logic.kind === 'switch') { this.state.set(id, !this.state.get(id)); return true; }
    return false;
  }

  /** The signal a mechanism should obey, or null if nothing is wired to it. */
  signalFor(bp, id) {
    const inputs = bp.inputsOf(id);
    if (!inputs.length) return null;
    return inputs.some((src) => this.state.get(src) === true);
  }

  step() {
    for (const [id, left] of this.pulse) {
      if (left <= 1) this.pulse.delete(id); else this.pulse.set(id, left - 1);
    }

    for (let pass = 0; pass < PASSES; pass++) {
      for (const rec of this.c.bodies.values()) {
        for (const id of rec.ids) {
          const part = rec.bp.parts.get(id);
          const def = PARTS[part.partId];
          if (!def.logic) continue;
          const kind = def.logic.kind;
          if (kind === 'switch') continue;                       // held by hand
          if (kind === 'button') { this.state.set(id, this.pulse.has(id)); continue; }
          if (kind === 'sensor') { this.state.set(id, this._sees(rec, id, def.logic.range)); continue; }

          const inputs = rec.bp.inputsOf(id).map((src) => this.state.get(src) === true);
          let out;
          if (kind === 'and') out = inputs.length > 0 && inputs.every(Boolean);
          else if (kind === 'or') out = inputs.some(Boolean);
          else if (kind === 'not') out = !inputs.some(Boolean);
          else if (kind === 'timer') {
            // A timer copies its input, late. Counting only while the input
            // differs from the output makes it delay both edges, which is what
            // makes a pair of them into a blinker.
            const want = inputs.some(Boolean);
            const now = this.state.get(id) === true;
            if (want === now) { this.delay.delete(id); out = now; }
            else {
              const left = (this.delay.get(id) ?? def.logic.delay) - 1;
              if (left <= 0) { this.delay.delete(id); out = want; }
              else { this.delay.set(id, left); out = now; }
            }
          } else out = false;
          this.state.set(id, out);
        }
      }
    }
  }

  /**
   * A sensor looks along its own mount normal and fires when anything solid is
   * closer than its range. Deliberately a ray and not a volume: a cone would
   * need a shape query every step for every sensor, and one ray is enough to
   * build a garage door that opens when you drive at it.
   */
  _sees(rec, id, range) {
    const { RAPIER, world } = this.c;
    if (!RAPIER) return false;
    const part = rec.bp.parts.get(id);
    const c = cellBoxCentre(part.cell, part.rs);
    const d = rotateVec(part.ori, 0, 1, 0);
    const q = rec.body.rotation();
    _q.set(q.x, q.y, q.z, q.w);
    const t = rec.body.translation();
    _from.set(c[0] - rec.origin[0], c[1] - rec.origin[1], c[2] - rec.origin[2])
      .applyQuaternion(_q).add(_t.set(t.x, t.y, t.z));
    _dir.set(d[0], d[1], d[2]).applyQuaternion(_q).normalize();
    _from.addScaledVector(_dir, 0.2);              // start outside its own box
    const hit = world.castRay(new RAPIER.Ray(_from, _dir), range, true,
                              undefined, FILTER.RAY, undefined, rec.body);
    return !!hit;
  }

  /** Lamps show their signal. Nothing else in a circuit is visible at a glance. */
  syncLamps() {
    if (!this.c.view) return;
    for (const rec of this.c.bodies.values()) {
      for (const id of rec.ids) {
        const def = PARTS[rec.bp.parts.get(id).partId];
        if (def?.shape !== 'lamp') continue;
        const mesh = this.c.meshes.get(id);
        if (!mesh) continue;
        const on = this.state.get(id) === true;
        if (mesh.userData.lampOn === on) continue;
        mesh.userData.lampOn = on;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m.emissive) continue;
          if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissiveIntensity ?? 0;
          if (m.userData.baseEmissive > 0) m.emissiveIntensity = on ? m.userData.baseEmissive : 0;
        }
      }
    }
  }

  /**
   * Draw the cables. One line list for the whole world, rebuilt when the wiring
   * changes — a few dozen segments, so redrawing beats tracking each one.
   */
  syncVisuals() {
    this.syncLamps();
    if (!this.c.view || !this.viewDirty) return;
    this.viewDirty = false;
    const pts = [];
    const seen = new Set();
    for (const rec of this.c.bodies.values()) {
      if (seen.has(rec.bp)) continue;
      seen.add(rec.bp);
      for (const [from, tos] of rec.bp.wires) {
        const a = this._worldOf(from);
        if (!a) continue;
        for (const to of tos) {
          const b = this._worldOf(to);
          if (b) pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    if (!this.wireView) {
      this.wireView = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x1d6fd0, transparent: true, opacity: 0.85 }),
      );
      this.wireView.frustumCulled = false;
      this.wireView.raycast = () => {};
      this.c.view.addLoose(this.wireView);
    }
    this.wireView.geometry.dispose();
    this.wireView.geometry = new THREE.BufferGeometry();
    this.wireView.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wireView.visible = pts.length > 0;
  }

  _worldOf(id) {
    const rec = this.c.bodyOf(id);
    const mesh = this.c.meshes.get(id);
    if (!rec || !mesh) return null;
    const part = rec.bp.parts.get(id);
    const c = cellBoxCentre(part.cell, part.rs);
    return new THREE.Vector3(c[0] - rec.origin[0], c[1] - rec.origin[1], c[2] - rec.origin[2])
      .applyQuaternion(rec.group.quaternion)
      .add(rec.group.position);
  }
}
