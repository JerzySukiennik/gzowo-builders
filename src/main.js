// main.js — Gzowo Builders, entry point.
//
// Boot order: Rapier WASM → renderer → meadow → player → construction → HUD.
// The loop is fixed-step physics with a variable-rate render on top; nothing in
// the simulation ever reads the frame time directly.

import * as THREE from 'three';
import { initPhysics, StepClock } from './physics/world.js';
import { buildMeadow } from './world/meadow.js';
import { Input } from './core/input.js';
import { Player } from './player/player.js';
import { Construction } from './build/construction.js';
import { ConstructionView } from './render/construction-view.js';
import { Builder } from './build/builder.js';
import { Hud } from './ui/hud.js';
import { SLOTS_MAX } from './build/toolbars.js';
import { Session } from './net/session.js';
import { NetClient } from './net/client.js';
import { loadPartModels } from './render/models.js';


const gate = document.getElementById('gate');
const gateBtn = document.getElementById('gate-btn');
const gateText = document.getElementById('gate-text');
const loadingEl = document.getElementById('loading');

boot().catch((err) => {
  console.error(err);
  loadingEl.textContent = 'BŁĄD — zobacz konsolę';
  gateText.textContent = String(err?.message ?? err);
});

async function boot() {
  const [{ RAPIER, world }, modelCount] = await Promise.all([initPhysics(), loadPartModels()]);
  console.log(`[boot] modele części: ${modelCount}`);

  // --- renderer ------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // the 5500M is not a 4K card
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // No tone mapping: this world is painted plastic under a poster sun. ACES
  // desaturates exactly the bright greens and yellows the art is built from.
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.06, 400);

  const meadow = await buildMeadow(scene, RAPIER, world, renderer);
  const worldTargets = scene.children.filter((o) => o.isMesh);

  const player = new Player(RAPIER, world, [0, 2, 8]);
  const construction = new Construction(RAPIER, world, new ConstructionView(scene));
  const input = new Input(renderer.domElement);
  const session = new Session(construction);
  const net = new NetClient(construction, session, scene);
  const builder = new Builder(scene, construction, camera, worldTargets, session);
  const hud = new Hud();

  // Debug handle: the console is the only inspector this project has.
  globalThis.GB = { THREE, scene, camera, renderer, world, RAPIER, player, construction, builder, input, hud, session, net };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // --- the gate ------------------------------------------------------------
  loadingEl.hidden = true;
  gateBtn.hidden = false;
  gateBtn.addEventListener('click', () => input.lock());

  const joinBtn = document.getElementById('join-btn');
  const joinHost = document.getElementById('join-host');
  const joinName = document.getElementById('join-name');
  const joinState = document.getElementById('join-state');
  net.onStatus = (t) => { joinState.textContent = t; };
  joinBtn.addEventListener('click', () => {
    const host = joinHost.value.trim();
    if (!host) return;
    net.connect(host.includes(':') ? host : `${host}:3000`, joinName.value.trim() || 'gracz');
  });
  joinHost.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
  input.onLockChange = (locked) => {
    gate.classList.toggle('hidden', locked);
    if (locked) hud.show(); else hud.hide();
    if (!locked) gateBtn.textContent = 'Wróć do gry';
  };

  // --- loop ----------------------------------------------------------------
  const clock = new StepClock();
  let last = performance.now();
  let fps = 60, fpsAcc = 0, fpsN = 0;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (input.locked) {
      const look = input.takeLook();
      player.look(look.dx, look.dy);
      handleEvents(input.drain(), builder, player);
    }

    const drive = driveControls(input, player);
    clock.advance(dt, () => {
      if (input.locked) player.step(input);
      construction.beforeStep(drive);
      world.step();
      construction.afterStep();
    });
    construction.sync();
    net.report(player, drive.get(player.seat?.rec.key) ?? { throttle: 0, steer: 0, brake: false, mech: { extend: 0, turn: 0 } });

    player.applyToCamera(camera);
    // Keep the shadow frustum around the builder rather than the origin.
    meadow.sun.position.set(camera.position.x + 38, 54, camera.position.z + 26);
    meadow.sun.target.position.set(camera.position.x, 0, camera.position.z);
    meadow.sun.target.updateMatrixWorld();

    if (input.locked) builder.update(player);

    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (input.locked) hud.update(builder.status(player), fps);

    renderer.render(scene, camera);
  });
}

/**
 * The only vehicle that gets input is the one you are sitting in; everything
 * else on the meadow rolls on whatever momentum it has.
 */
const NO_CONTROLS = new Map();
function driveControls(input, player) {
  if (!player.seat || !input.locked) return NO_CONTROLS;
  const m = new Map();
  m.set(player.seat.rec.key, {
    throttle: (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0),
    steer: (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0),
    brake: input.down('Space'),
    // Mechanisms ride on the arrow keys until phase 5 gives them real wiring.
    mech: {
      extend: (input.down('ArrowUp') ? 1 : 0) - (input.down('ArrowDown') ? 1 : 0),
      turn: (input.down('ArrowRight') ? 1 : 0) - (input.down('ArrowLeft') ? 1 : 0),
    },
  });
  return m;
}

/**
 * `E` is the one "do the obvious thing here" key: get out of a seat, get into
 * one, or work whatever switch you are looking at.
 */
function interact(player, builder) {
  if (player.seat) {
    const pose = player.seat.rec.vehicle?.seatPose(player.seat.seatId);
    const out = pose ? pose.position.clone() : null;
    if (out) out.y += 0.4;
    player.stand(out ?? { x: 0, y: 2, z: 8 }, player.yaw);
    return;
  }
  const seat = builder.seatUnderCursor();
  if (seat) { player.sit(seat); return; }
  const hit = builder.target?.hitPartId;
  if (hit !== null && hit !== undefined) builder.session.interact(hit);
}

function handleEvents(events, builder, player) {
  for (const e of events) {
    if (e.type === 'mouse') {
      if (e.button === 0) builder.primary();
      else if (e.button === 2) builder.secondary();
      else if (e.button === 1) builder.pipette();
    } else if (e.type === 'wheel') {
      if (builder.tool === 'paint') builder.cycleColor(e.dir);
      else builder.cycleSlot(e.dir);
    } else if (e.type === 'key') {
      if (e.code === 'KeyR') builder.rotate(builder_shift());
      else if (e.code === 'Tab') builder.cycleToolbar(builder_shift() ? -1 : 1);
      else if (e.code === 'KeyE') interact(player, builder);
      else if (e.code === 'KeyV') player.thirdPerson = !player.thirdPerson;
      else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= SLOTS_MAX) builder.selectSlot(n - 1);
      }
    }
  }
}

// R rotates yaw; Shift+R tips the part on its side.
let shiftHeld = false;
addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftHeld = true; });
addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftHeld = false; });
const builder_shift = () => shiftHeld;
