// particles.js — dust off the wheels, chips off the breaks.
//
// A single fixed pool drawn as one instanced mesh. Nothing is allocated after
// startup and nothing is ever removed: a dead particle is simply one with no
// life left, reused next time something needs one. That keeps the garbage
// collector out of the frame, which matters more than the particles do —
// a hitch while the wheels kick up dust would be a worse trade than no dust.

import * as THREE from 'three';

const POOL = 220;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const GRAVITY = -7.5;

export class Particles {
  constructor(scene) {
    this.items = Array.from({ length: POOL }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, spin: 0,
    }));
    this.next = 0;

    const geo = new THREE.TetrahedronGeometry(0.5, 0);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, opacity: 0.9 }),
      POOL,
    );
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'particles';
    this.mesh.raycast = () => {};
    this.colour = new THREE.Color();
    scene.add(this.mesh);
    this.mesh.count = 0;
  }

  _spawn(x, y, z, spread, up, size, life, colour) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % POOL;
    it.life = life; it.max = life;
    it.x = x; it.y = y; it.z = z;
    it.vx = (Math.random() - 0.5) * spread;
    it.vy = up * (0.6 + Math.random() * 0.8);
    it.vz = (Math.random() - 0.5) * spread;
    it.size = size * (0.7 + Math.random() * 0.7);
    it.spin = (Math.random() - 0.5) * 8;
    it.r = colour.r; it.g = colour.g; it.b = colour.b;
  }

  /** A wheel scuffing the ground. */
  dust(x, y, z, strength) {
    const n = strength > 0.6 ? 2 : 1;
    this.colour.setRGB(0.62, 0.58, 0.44);
    for (let i = 0; i < n; i++) this._spawn(x, y + 0.05, z, 1.6, 1.1, 0.09, 0.5, this.colour);
  }

  /** A joint letting go: chips in the colour of whatever broke. */
  chips(x, y, z, hex) {
    this.colour.set(hex);
    for (let i = 0; i < 7; i++) this._spawn(x, y, z, 4.5, 3.0, 0.075, 0.9, this.colour);
  }

  update(dt) {
    let live = 0;
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) continue;
      it.vy += GRAVITY * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (it.y < 0.02) { it.y = 0.02; it.vy *= -0.25; it.vx *= 0.6; it.vz *= 0.6; }
      const t = it.life / it.max;
      const s = it.size * (0.35 + t * 0.9);
      _q.setFromAxisAngle(UPISH, it.spin * (it.max - it.life) * 3);
      _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(live, _m);
      this.colour.setRGB(it.r, it.g, it.b);
      this.mesh.setColorAt(live, this.colour);
      live++;
    }
    this.mesh.count = live;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const UPISH = new THREE.Vector3(0.3, 1, 0.2).normalize();
