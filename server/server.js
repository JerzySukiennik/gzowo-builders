// server.js — the host.
//
// Runs the same `Construction` the players are looking at, headless, and owns
// the physics. Clients ask for changes and get told what happened; nobody
// simulates a construction twice, so nobody can disagree about where it ended
// up. Players themselves are relayed rather than simulated: they are kinematic
// capsules driven by their own owner, and a co-op building game with friends has
// nothing to gain from arguing about where a friend is standing.
//
//   npm start            → host on 0.0.0.0:3000, serving the game as well
//   npm start -- 4000    → a different port
//
// Everyone else opens http://<your LAN address>:3000 in a browser.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

import { initPhysics, FIXED_DT } from '../src/physics/world.js';
import { Construction } from '../src/build/construction.js';
import { DOWN, PROTOCOL, UP, VERBS, decode, encode, packBodies } from '../src/net/protocol.js';
import { Session } from '../src/net/session.js';
import { buildServerTerrain } from './terrain-collider.js';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PORT = Number(process.argv[2]) || 3000;
const TICK_MS = 1000 / 60;
const BODY_HZ = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm',
};

// --- static files ------------------------------------------------------------
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (url.pathname === '/' || url.pathname === '') path = join(ROOT, 'index.html');
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404).end('nie ma');
  }
});

// --- the world ---------------------------------------------------------------
const { RAPIER, world } = await initPhysics();
buildServerTerrain(RAPIER, world);
const construction = new Construction(RAPIER, world);   // no view: headless
const session = new Session(construction);

const clients = new Map();      // id -> { ws, name, pose, drive }
let nextId = 1;

const wss = new WebSocketServer({ server: http });
wss.on('connection', (ws) => {
  const id = nextId++;
  const client = { ws, name: `gracz ${id}`, pose: null, drive: null };
  clients.set(id, client);

  ws.send(encode(DOWN.WELCOME, {
    id, protocol: PROTOCOL, world: snapshot(),
  }));

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg) return;
    if (msg.type === UP.HELLO) {
      client.name = String(msg.name ?? client.name).slice(0, 24);
    } else if (msg.type === UP.CMD) {
      if (!VERBS.has(msg.verb) || !Array.isArray(msg.args)) return;
      // Do it here first: if the host refuses it (space taken, bad wire), the
      // change never happened and nobody hears about it.
      const result = session.apply(msg.verb, msg.args);
      if (result === null || result === false) return;
      broadcast(encode(DOWN.CMD, { verb: msg.verb, args: msg.args, by: id }));
    } else if (msg.type === UP.POSE) {
      client.pose = { p: msg.p, y: msg.y, s: msg.s ?? null };
    } else if (msg.type === UP.DRIVE) {
      client.drive = msg.key === null ? null : msg;
    }
  });

  ws.on('close', () => { clients.delete(id); broadcast(encode(DOWN.BYE, { id })); });
  ws.on('error', () => { clients.delete(id); });
});

function broadcast(payload, except = null) {
  for (const [id, c] of clients) {
    if (id === except || c.ws.readyState !== 1) continue;
    c.ws.send(payload);
  }
}

/** Everything a joining player needs to build the world exactly as it is. */
function snapshot() {
  const grids = [];
  const seen = new Set();
  for (const rec of construction.bodies.values()) {
    if (seen.has(rec.bp)) continue;
    seen.add(rec.bp);
    grids.push({
      yard: rec.bp === construction.yard,
      data: rec.bp.toJSON(),
      released: [...construction.released].filter((pid) => rec.bp.parts.has(pid)),
      pose: rec.bp === construction.yard ? null : bodyPose(rec),
    });
  }
  if (!seen.has(construction.yard)) {
    grids.push({ yard: true, data: construction.yard.toJSON(), released: [], pose: null });
  }
  return { grids, nextPartId: construction._nextPartId };
}

const bodyPose = (rec) => {
  const t = rec.body.translation(), q = rec.body.rotation();
  return { t: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w] };
};

// --- the loop ----------------------------------------------------------------
let lastBodies = 0;
setInterval(() => {
  const controls = new Map();
  for (const c of clients.values()) {
    if (c.drive?.key !== undefined && c.drive?.key !== null) {
      controls.set(c.drive.key, {
        throttle: c.drive.throttle ?? 0, steer: c.drive.steer ?? 0,
        brake: !!c.drive.brake, mech: c.drive.mech ?? { extend: 0, turn: 0 },
      });
    }
  }
  construction.beforeStep(controls);
  world.step();
  construction.afterStep();

  const now = Date.now();
  if (now - lastBodies >= 1000 / BODY_HZ) {
    lastBodies = now;
    broadcast(encode(DOWN.BODIES, { t: packBodies(construction.bodies) }));
    broadcast(encode(DOWN.PLAYERS, {
      list: [...clients].filter(([, c]) => c.pose)
        .map(([id, c]) => ({ id, name: c.name, ...c.pose })),
    }));
  }
}, TICK_MS);

http.listen(PORT, () => {
  const addrs = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('Gzowo Builders — host wystartował');
  console.log(`  ty:        http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  reszta:    http://${a}:${PORT}`);
});
