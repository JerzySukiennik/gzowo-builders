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
import { cellBoxCentre } from '../shared/grid.js';

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
   * Draw the cables. One line list for the whole world, rebuilt when the wiring
   * changes — a few dozen segments, so redrawing beats tracking each one.
   */
  syncVisuals() {
    if (!this.viewDirty) return;
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
      this.c.root.parent.add(this.wireView);
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
