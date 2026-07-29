// meadow.js — the shared build site.
//
// Phase 1 is the flat pad plus the test furniture you need to know whether a
// build works: two ramps at different angles, a step, and a kerb. Phase 6
// replaces the ground with the real meadow (hills, trees, bushes) modelled in
// Blender; the collider strategy here — static cuboids, never trimeshes for the
// things you drive on — carries over unchanged.

import * as THREE from 'three';
import { FILTER } from '../physics/world.js';

export const GROUND_SIZE = 220;
const GRASS = 0x7fb347;
const GRASS_DARK = 0x6ba03c;

export function buildMeadow(scene, RAPIER, world) {
  scene.background = new THREE.Color(0x8fc7e8);
  scene.fog = new THREE.Fog(0x8fc7e8, 90, 200);

  // --- light: one hard sun for chunky shadows, sky bounce for the rest ------
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6e8f47, 0.62);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4dd, 1.45);
  sun.position.set(38, 54, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  const s = 46;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // --- ground --------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0));
  const groundCol = RAPIER.ColliderDesc.cuboid(GROUND_SIZE / 2, 2, GROUND_SIZE / 2)
    .setFriction(1.0)
    .setCollisionGroups(FILTER.TERRAIN);
  world.createCollider(groundCol, groundBody);

  // --- the build pad: a paler slab so you can see the grid you build on -----
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 32),
    new THREE.MeshStandardMaterial({ color: GRASS_DARK, roughness: 1 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.01;
  pad.receiveShadow = true;
  scene.add(pad);

  // --- test furniture ------------------------------------------------------
  const props = [
    { size: [10, 1.2, 6], pos: [22, 0.0, 0], rot: -0.16, color: 0xb9a882 },   // gentle ramp
    { size: [8, 1.6, 6], pos: [22, 0.0, -14], rot: -0.36, color: 0xb9a882 },  // steep ramp
    { size: [7, 0.5, 7], pos: [-20, 0.25, 6], rot: 0, color: 0xc9bb99 },      // step
    { size: [22, 0.4, 1], pos: [0, 0.2, 24], rot: 0, color: 0xc9bb99 },       // kerb
  ];
  for (const p of props) addStaticBox(scene, RAPIER, world, p);

  return { sun, ground };
}

function addStaticBox(scene, RAPIER, world, { size, pos, rot = 0, color }) {
  const [w, h, d] = size;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.position.set(pos[0], pos[1] + h / 2, pos[2]);
  mesh.rotation.z = rot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rot));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setFriction(1.0)
      .setCollisionGroups(FILTER.TERRAIN),
    body,
  );
  return mesh;
}
