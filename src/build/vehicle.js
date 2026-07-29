// vehicle.js — wheels, suspension and drive.
//
// Wheels are **raycast, not simulated as bodies**. Each wheel casts a ray down
// from its mount and applies three forces to the chassis at the contact point:
// a spring holding the car up, a drive force along the way the wheel points, and
// a lateral force resisting sideways slide. That is the same shape as Bullet's
// RaycastVehicle and Unity's WheelCollider, and it is the pattern that already
// works in [voxel-demolition].
//
// The alternative — a hub body on a prismatic spring, a wheel body on a motored
// revolute, and a kingpin joint for steering — is four extra bodies and three
// joints per corner, and every one of them is a tuning problem that ends in a
// car that shivers. A raycast wheel cannot shiver: it has no state the solver
// can fight over.
//
// What it costs: wheels do not collide with the ground as objects, so they
// cannot be wedged under a kerb. Worth it.

import * as THREE from 'three';
import { PARTS } from '../shared/parts.js';
import { cellBoxCentre, rotateVec } from '../shared/grid.js';
import { FILTER, FIXED_DT } from '../physics/world.js';

const G = 9.81;
/** How hard a tyre can push before it slides, as a multiple of its load. */
const MU = 1.7;
/** Fraction of suspension travel the car should settle at under its own weight.
 *  The spring rate is derived from this and the build's actual mass, so a heavy
 *  truck and a light buggy both sit right without anyone tuning a constant. */
const SAG = 0.45;
const DAMPING_RATIO = 0.7;
/** Slip speed, m/s, at which lateral grip saturates. */
const SLIP_SCALE = 2.5;
/** Drag, as a fraction of wheel load per m/s. Measured: at 0.02 it ate most of
 *  the engine by 8 m/s and the car plateaued at half its rated speed. */
const ROLL_RESIST = 0.008;
/**
 * A wheel nobody is driving holds. Real wheels do — through gearbox, motor
 * cogging and brake drag — and without it a parked build wanders off the moment
 * the meadow is a hair off level, which is exactly what a workshop floor is not
 * supposed to do. The hold is a fraction of available grip, applied against
 * whatever motion exists, so it stops a roll dead but never launches anything.
 */
const HOLD_GRIP = 0.75;
const HOLD_SPEED = 1.4;
const BRAKE_FORCE = 1.4;

export class Vehicle {
  constructor(construction, rec) {
    this.c = construction;
    this.rec = rec;
    this.wheels = [];
    this.seats = [];
    this.forward = new THREE.Vector3(0, 0, -1);   // in body-local space
    this.appliedImpulse = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** Read the construction and work out what it has become. */
  rebuild() {
    const { rec } = this;
    this.wheels = [];
    this.seats = [];

    // Which way is forwards has to be settled before any wheel is built: a
    // wheel's rolling direction is the cross product of its axle and up, and
    // that comes out reversed on one side of the car. Left and right wheels then
    // drive against each other and the car crabs sideways at walking pace.
    let seatOri = null;
    for (const id of rec.ids) {
      const def = PARTS[rec.bp.parts.get(id).partId];
      if (def.seat) { seatOri = rec.bp.parts.get(id).ori; break; }
    }
    const f = seatOri === null ? [0, 0, -1] : rotateVec(seatOri, 0, 0, -1);
    this.forward.set(f[0], f[1], f[2]).normalize();

    for (const id of rec.ids) {
      const part = rec.bp.parts.get(id);
      const def = PARTS[part.partId];
      if (def.seat) this.seats.push({ id, part, def, local: this._localOf(part) });
      if (def.wheel) this.wheels.push(this._makeWheel(id, part, def));
    }

    if (!this.wheels.length) return;

    // Which end steers: everything ahead of the mean wheel position.
    let mid = 0;
    for (const w of this.wheels) mid += w.local.dot(this.forward);
    mid /= this.wheels.length;
    for (const w of this.wheels) w.steers = w.local.dot(this.forward) > mid + 0.05;
    if (!this.wheels.some((w) => w.steers)) for (const w of this.wheels) w.steers = true;

    this._tuneSprings();
    this.engineForce = 0;
    this.topSpeed = 0;
    for (const id of rec.ids) {
      const def = PARTS[rec.bp.parts.get(id).partId];
      if (!def.engine) continue;
      this.engineForce += def.engine.force;
      this.topSpeed = Math.max(this.topSpeed, def.engine.topSpeed);
    }
  }

  _localOf(part) {
    const c = cellBoxCentre(part.cell, part.rs);
    return new THREE.Vector3(
      c[0] - this.rec.origin[0], c[1] - this.rec.origin[1], c[2] - this.rec.origin[2],
    );
  }

  _makeWheel(id, part, def) {
    // The axle is the part's local +Y turned by its orientation; the wheel rolls
    // in the plane perpendicular to it.
    const a = rotateVec(part.ori, 0, 1, 0);
    const axle = new THREE.Vector3(a[0], a[1], a[2]).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const roll = new THREE.Vector3().crossVectors(axle, up);
    if (roll.lengthSq() < 1e-6) roll.copy(this.forward); else roll.normalize();
    // cross(axle, up) points opposite ways on the two sides of a car, so half
    // the wheels would drive backwards. Flipping the rolling direction to match
    // the vehicle also flips which way the wheel has to turn to roll that way —
    // miss the second half and one side of the car spins backwards on screen.
    const flipped = roll.dot(this.forward) < 0;
    if (flipped) roll.negate();
    return {
      id, part, def, spec: def.wheel,
      local: this._localOf(part),
      axle, roll,
      steers: false, steerAngle: 0, spinSign: flipped ? -1 : 1,
      k: 0, c: 0,
      compression: 0, grounded: false, spin: 0, spinVel: 0,
    };
  }

  /**
   * Derive the spring rate from what this build actually weighs, so the car sits
   * at the same fraction of its travel whether it is a buggy or a truck.
   */
  _tuneSprings() {
    const share = Math.max(1, this.rec.body.mass()) / this.wheels.length;
    for (const w of this.wheels) {
      w.k = (share * G) / (w.spec.rest * SAG);
      w.c = 2 * DAMPING_RATIO * Math.sqrt(w.k * share);
    }
  }

  /** One physics step of suspension and drive. `control` may be null (parked). */
  step(control) {
    if (!this.wheels.length) return;
    const { rec, c: cons } = this;
    const { RAPIER, world } = cons;
    const body = rec.body;
    if (Math.abs(body.mass() - (this._tunedFor ?? -1)) > 1) {
      this._tunedFor = body.mass();
      this._tuneSprings();
    }

    const bq = body.rotation();
    this._q.set(bq.x, bq.y, bq.z, bq.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this._q);
    const down = up.clone().negate();

    // Everything this vehicle pushes on itself with, summed, so the impact
    // detector can tell our own suspension from being hit by the world.
    this.appliedImpulse.set(0, 0, 0);

    const throttle = control?.throttle ?? 0;
    const steer = control?.steer ?? 0;
    const braking = control?.brake ?? false;
    const perWheel = this.wheels.length ? this.engineForce / this.wheels.length : 0;

    for (const w of this.wheels) {
      const hub = w.local.clone().applyQuaternion(this._q).add(vec(body.translation()));
      const maxToi = w.spec.radius + w.spec.rest;

      const hit = world.castRay(
        new RAPIER.Ray(hub, down), maxToi, true,
        undefined, FILTER.RAY, undefined, body,
      );

      if (!hit) {
        w.grounded = false;
        w.compression = 0;
        w.spinVel *= 0.99;
        w.spin += w.spinVel * FIXED_DT;
        continue;
      }

      const dist = hit.timeOfImpact ?? hit.toi;
      w.grounded = true;
      w.compression = Math.min(w.spec.rest, maxToi - dist);
      const contact = hub.clone().addScaledVector(down, dist);

      // Velocity of the chassis at the contact point.
      const vel = pointVelocity(body, contact, this._v);
      const vUp = vel.dot(up);
      const spring = Math.max(0, w.k * w.compression - w.c * vUp);

      // Where this wheel points, after steering.
      const roll = w.roll.clone();
      if (w.steers && steer !== 0) roll.applyAxisAngle(new THREE.Vector3(0, 1, 0), -steer * w.spec.steerAngle);
      const rollW = roll.applyQuaternion(this._q).projectOnPlane(up).normalize();
      const sideW = new THREE.Vector3().crossVectors(up, rollW).normalize();

      const vLong = vel.dot(rollW);
      const vLat = vel.dot(sideW);
      const budget = MU * spring;

      let fLong = 0;
      if (throttle !== 0 && this.engineForce > 0) {
        // Full force until the car is doing what the engine is asking for, then
        // nothing. Pressing forward while rolling backwards keeps full force,
        // which is what makes reversing out of a ditch feel right.
        // Cubic, not linear: a linear fade is already down to half force at half
        // speed, so the car crawls up to its rated top speed and never gets
        // there. This holds most of the pull until the last third.
        const ratio = clamp((vLong * Math.sign(throttle)) / this.topSpeed, 0, 1);
        const fade = this.topSpeed > 0 ? 1 - ratio ** 3 : 1;
        fLong = throttle * perWheel * fade;
      }
      fLong -= vLong * ROLL_RESIST * spring;
      if (throttle === 0 && !braking) {
        fLong -= clamp(vLong / HOLD_SPEED, -1, 1) * budget * HOLD_GRIP;
      }
      if (braking) fLong -= vLong * BRAKE_FORCE * spring / Math.max(1, Math.abs(vLong));
      fLong = clamp(fLong, -budget, budget);

      const fLat = clamp(-vLat / SLIP_SCALE, -1, 1) * budget;

      const impulse = new THREE.Vector3()
        .addScaledVector(up, spring)
        .addScaledVector(rollW, fLong)
        .addScaledVector(sideW, fLat)
        .multiplyScalar(FIXED_DT);
      body.applyImpulseAtPoint(impulse, contact, true);
      this.appliedImpulse.add(impulse);

      w.spinVel = w.spinSign * vLong / w.spec.radius;
      w.spin += w.spinVel * FIXED_DT;
      w.steerAngle = w.steers ? -steer * w.spec.steerAngle : 0;
    }
  }

  /** Drop each wheel to where its suspension actually is, steer it, spin it. */
  syncVisuals() {
    for (const w of this.wheels) {
      const mesh = this.c.meshes.get(w.id);
      if (!mesh) continue;
      const drop = w.grounded ? w.spec.rest - w.compression : w.spec.rest;
      mesh.position.set(w.local.x, w.local.y - drop, w.local.z);
      // Steering turns the wheel about the body's vertical; the part's own
      // orientation places the axle; the spin runs about that axle, which is
      // the mesh's local +Y — so the three compose in that order.
      mesh.quaternion
        .setFromAxisAngle(AXLE, w.steerAngle)
        .multiply(QT.setFromEuler(oriEulerOf(w.part.ori)))
        .multiply(QS.setFromAxisAngle(AXLE, w.spin));
    }
  }

  /** Where the driver's head goes, in world space. */
  seatPose(seatId) {
    const seat = this.seats.find((s) => s.id === seatId);
    if (!seat) return null;
    const bq = this.rec.body.rotation();
    const q = new THREE.Quaternion(bq.x, bq.y, bq.z, bq.w);
    const eye = seat.def.seat.eye;
    const local = seat.local.clone().add(new THREE.Vector3(eye[0], eye[1], eye[2]));
    const pos = local.applyQuaternion(q).add(vec(this.rec.body.translation()));
    const e = oriEulerOf(seat.part.ori);
    const facing = q.clone().multiply(new THREE.Quaternion().setFromEuler(e));
    return { position: pos, quaternion: facing };
  }
}

const AXLE = new THREE.Vector3(0, 1, 0);
const QT = new THREE.Quaternion();
const QS = new THREE.Quaternion();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const vec = (t) => new THREE.Vector3(t.x, t.y, t.z);
const oriX = (ori) => ((ori >> 2) & 3) * Math.PI / 2;
const oriY = (ori) => (ori & 3) * Math.PI / 2;
const oriEulerOf = (ori) => new THREE.Euler(oriX(ori), oriY(ori), 0, 'YXZ');

/** Velocity of a point rigidly attached to a body: v + ω × r. */
function pointVelocity(body, point, out) {
  const v = body.linvel();
  const w = body.angvel();
  const t = body.translation();
  const rx = point.x - t.x, ry = point.y - t.y, rz = point.z - t.z;
  return out.set(
    v.x + (w.y * rz - w.z * ry),
    v.y + (w.z * rx - w.x * rz),
    v.z + (w.x * ry - w.y * rx),
  );
}
