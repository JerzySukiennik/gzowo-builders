// meadow.js — the shared build site.
//
// Phase 1 is the flat pad plus the test furniture you need to know whether a
// build works: two ramps at different angles, a step, and a kerb. Phase 6
// replaces the ground with the real meadow (hills, trees, bushes) modelled in
// Blender; the collider strategy here — static cuboids, never trimeshes for the
// things you drive on — carries over unchanged.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FILTER } from '../physics/world.js';
import { PAD_RADIUS, WORLD, buildTerrain, heightAt } from './terrain.js';
import { scatter } from './scatter.js';
import { buildGrass } from './grass.js';
import { buildSky } from './sky.js';

export const GROUND_SIZE = WORLD;

/**
 * A two-stop sky-and-grass gradient, blurred into an environment map.
 *
 * Without one, every metal in the game renders black: a metallic surface has no
 * diffuse colour of its own, so with nothing to reflect there is nothing to see.
 * Chrome piston rods and steel plates came out as dark holes until this existed.
 * Eight pixels wide is plenty — it is reflection, not scenery.
 */
function skyEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.00, '#b7dcf5');
  g.addColorStop(0.46, '#e8f2fa');
  g.addColorStop(0.54, '#86a761');
  g.addColorStop(1.00, '#3f5329');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

export async function buildMeadow(scene, RAPIER, world, renderer) {
  scene.fog = new THREE.Fog(0xa8cfe6, 130, 320);
  scene.environment = skyEnvironment(renderer);

  // --- light: one hard sun for chunky shadows, sky bounce for the rest ------
  // The environment map now carries most of the ambient, so the fill drops.
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6e8f47, 0.30);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4dd, 1.45);
  sun.position.set(38, 54, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 170;
  const s = 52;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const terrain = buildTerrain(scene, RAPIER, world);

  // --- the build pad: a mown circle, so the flat ground reads as deliberate -
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(PAD_RADIUS, 64),
    new THREE.MeshStandardMaterial({ color: 0x6ba03c, roughness: 1 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  scene.add(pad);

  // --- test furniture: the things you drive at on purpose -------------------
  const props = [
    { size: [11, 1.3, 7], pos: [24, 0, 2], rot: -0.16, color: 0xb9a882 },
    { size: [9, 1.9, 7], pos: [24, 0, -16], rot: -0.34, color: 0xb9a882 },
    { size: [8, 0.5, 8], pos: [-24, 0.25, 8], rot: 0, color: 0xc9bb99 },
    { size: [24, 0.4, 1], pos: [0, 0.2, 27], rot: 0, color: 0xc9bb99 },
  ];
  for (const p of props) addStaticBox(scene, RAPIER, world, p);

  // --- greenery -------------------------------------------------------------
  const kinds = await loadScatterKinds();
  const planted = kinds.length ? scatter(scene, RAPIER, world, kinds) : [];
  const grass = buildGrass(scene);
  const sky = buildSky(scene, sun.position);

  return { sun, terrain, planted, grass, sky };
}

/**
 * Load the scenery models. They are not parts — no cell box, no collider built
 * from a catalogue entry — so they skip the part loader entirely and keep their
 * own materials and their own geometry, whatever shape Blender gave them.
 */
async function loadScatterKinds() {
  const loader = new GLTFLoader();
  const wanted = [
    { id: 'tree_pine', file: 'assets/models/tree_pine.glb', density: 5, scale: [0.85, 1.35], trunk: { r: 0.22, h: 5.0 } },
    { id: 'tree_oak', file: 'assets/models/tree_oak.glb', density: 4, scale: [0.85, 1.30], trunk: { r: 0.28, h: 3.2 } },
    { id: 'bush', file: 'assets/models/bush.glb', density: 6, scale: [0.7, 1.4], trunk: null },
    { id: 'rock', file: 'assets/models/rock.glb', density: 2, scale: [0.6, 1.6], trunk: null },
  ];
  const out = [];
  for (const w of wanted) {
    try {
      const gltf = await loader.loadAsync(w.file);
      gltf.scene.updateMatrixWorld(true);
      const meshes = [];
      gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) continue;
      const geometry = meshes.length === 1
        ? meshes[0].geometry
        : mergeGeometries(meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)), true);
      if (!geometry) continue;
      const material = meshes.length === 1 ? meshes[0].material : meshes.map((m) => m.material);
      out.push({ ...w, geometry, material });
    } catch (err) {
      console.warn(`[meadow] ${w.id}: ${err.message} — bez tej roślinności`);
    }
  }
  return out;
}

function addStaticBox(scene, RAPIER, world, { size, pos, rot = 0, color }) {
  const [w, h, d] = size;
  const y = heightAt(pos[0], pos[2]);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.position.set(pos[0], y + pos[1] + h / 2, pos[2]);
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
