// player.js — first-person builder on legs.
//
// Movement is a Rapier kinematic character controller, not a dynamic body: a
// builder should not be shoved off a scaffold by the construction they are
// standing on, and autostep + ground snap make walking over a lattice of 0.25 m
// blocks feel like walking on a floor. Gravity is integrated by hand so the
// jump arc is ours to tune.
//
// The camera is the head: FPP only, no third person, per the design.

import * as THREE from 'three';
import { FILTER, FIXED_DT } from '../physics/world.js';

const RADIUS = 0.32;
const HALF_HEIGHT = 0.58;          // capsule cylinder half-height
export const EYE_HEIGHT = 0.68;    // above the capsule centre
const WALK = 4.6;
const RUN = 7.8;
const ACCEL = 42;
const AIR_ACCEL = 9;
const JUMP = 5.4;
const GRAVITY = -21;
const MAX_PITCH = Math.PI / 2 - 0.02;

export class Player {
  constructor(RAPIER, world, spawn = [0, 2, 8]) {
    this.RAPIER = RAPIER;
    this.world = world;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...spawn),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(FILTER.PLAYER),
      this.body,
    );

    const c = world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((38 * Math.PI) / 180);
    c.enableAutostep(0.42, 0.2, true);   // a 0.25 m block is a step, not a wall
    c.enableSnapToGround(0.34);
    c.setApplyImpulsesToDynamicBodies(true);
    this.controller = c;

    this.velocity = new THREE.Vector3();
    this.yaw = 0; // spawn looking at the build pad, not away from it
    this.pitch = 0;
    this.grounded = false;
    this._tmp = new THREE.Vector3();
  }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -MAX_PITCH, MAX_PITCH);
  }

  /** Unit vector the camera is looking along. */
  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  step(input) {
    // --- wish direction in the horizontal plane ----------------------------
    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1;
    if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = this._tmp.set(0, 0, 0);
    if (len > 0) {
      fx /= len; fz /= len;
      // Rotate the local wish into world space. At yaw 0 the camera looks down
      // -Z, so W (fz = -1) must come out as -Z and D (fx = +1) as +X.
      wish.set(fx * cos + fz * sin, 0, -fx * sin + fz * cos);
    }

    const speed = input.down('ShiftLeft') || input.down('ShiftRight') ? RUN : WALK;
    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    const target = wish.multiplyScalar(speed);
    const blend = Math.min(1, accel * FIXED_DT / Math.max(speed, 0.001));
    this.velocity.x += (target.x - this.velocity.x) * blend;
    this.velocity.z += (target.z - this.velocity.z) * blend;

    // --- vertical ----------------------------------------------------------
    if (this.grounded && this.velocity.y <= 0) this.velocity.y = -1.5; // stay pinned
    this.velocity.y += GRAVITY * FIXED_DT;
    if (this.grounded && input.down('Space')) this.velocity.y = JUMP;

    // --- resolve -----------------------------------------------------------
    const desired = {
      x: this.velocity.x * FIXED_DT,
      y: this.velocity.y * FIXED_DT,
      z: this.velocity.z * FIXED_DT,
    };
    this.controller.computeColliderMovement(this.collider, desired, undefined, FILTER.PLAYER);
    const move = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + move.x, y: t.y + move.y, z: t.z + move.z });

    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    // A ceiling or a wall eats the movement we asked for; drop the matching
    // velocity component so we do not keep accelerating into it.
    if (Math.abs(move.y - desired.y) > 1e-5 && !this.grounded) this.velocity.y = move.y / FIXED_DT;
    if (this.grounded && !wasGrounded) this.velocity.y = 0;

    if (t.y < -30) { // fell off the world
      this.body.setNextKinematicTranslation({ x: 0, y: 3, z: 8 });
      this.velocity.set(0, 0, 0);
    }
  }

  /** Point the camera at the head position for this frame. */
  applyToCamera(camera) {
    const p = this.position;
    camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
