// client.js — the guest half of a game.
//
// A connected client never simulates a construction. It builds the same bodies
// and colliders as everyone else — it needs them to aim at, to walk on and to
// stand inside — but they are kinematic here and their transforms arrive from
// the host twenty times a second. That is the whole reason the physics agrees:
// there is one simulation, not four that started the same and drifted.
//
// Players are the exception and go the other way: each one owns their own
// capsule and just says where they are. Arguing with a friend about where they
// are standing costs latency and buys nothing in a game with no winner.

import * as THREE from 'three';
import { DOWN, PROTOCOL, UP, decode, encode } from './protocol.js';

export class NetClient {
  constructor(construction, session, scene) {
    this.c = construction;
    this.session = session;
    this.scene = scene;
    this.ws = null;
    this.id = null;
    this.status = 'offline';
    this.players = new Map();      // id -> { name, mesh }
    this.onStatus = null;
    this.onNote = null;
    this._avatarGeo = new THREE.CapsuleGeometry(0.32, 1.16, 4, 8);
    this._avatarMat = new THREE.MeshStandardMaterial({ color: 0xe8442e, roughness: 0.7 });
    this._lastPose = 0;
  }

  get online() { return this.ws?.readyState === 1; }

  connect(address, name) {
    const url = address.includes('://') ? address : `ws://${address}`;
    this.status = 'łączę…';
    this.onStatus?.(this.status);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => ws.send(encode(UP.HELLO, { name })));
    ws.addEventListener('message', (e) => this._handle(decode(e.data)));
    ws.addEventListener('close', () => {
      this.status = 'rozłączono';
      this.onStatus?.(this.status);
      this.session.socket = null;
      this.c.remote = false;
      for (const p of this.players.values()) this.scene.remove(p.mesh);
      this.players.clear();
    });
    ws.addEventListener('error', () => {
      this.status = 'brak połączenia';
      this.onStatus?.(this.status);
    });
  }

  _handle(msg) {
    if (!msg) return;
    switch (msg.type) {
      case DOWN.WELCOME: {
        if (msg.protocol !== PROTOCOL) {
          this.status = 'inna wersja gry';
          this.onStatus?.(this.status);
          this.ws.close();
          return;
        }
        this.id = msg.id;
        this.c.remote = true;
        this.session.socket = this.ws;
        this.session.selfId = msg.id;
        this._loadWorld(msg.world);
        this.status = 'w grze';
        this.onStatus?.(this.status);
        break;
      }
      case DOWN.CMD:
        // Everyone applies the same list in the same order, including whoever
        // asked for it — so "my" changes are not special and cannot diverge.
        this.session.apply(msg.verb, msg.args);
        break;
      case DOWN.BODIES:
        this.c.applyBodies(msg.t);
        break;
      case DOWN.PLAYERS:
        this._players(msg.list);
        break;
      case DOWN.WORLD:
        this.c.restore(msg.world);
        break;
      case DOWN.NOTE:
        this.onNote?.(msg.text);
        break;
      case DOWN.BYE:
        this._drop(msg.id);
        break;
      default: break;
    }
  }

  /** Rebuild the world exactly as the host has it. */
  _loadWorld(world) { this.c.restore(world); }

  _players(list) {
    const alive = new Set();
    for (const p of list) {
      if (p.id === this.id) continue;
      alive.add(p.id);
      let entry = this.players.get(p.id);
      if (!entry) {
        const mesh = new THREE.Mesh(this._avatarGeo, this._avatarMat);
        mesh.castShadow = true;
        this.scene.add(mesh);
        entry = { name: p.name, mesh };
        this.players.set(p.id, entry);
      }
      entry.mesh.visible = !p.s;                 // seated players are inside the seat
      entry.mesh.position.set(p.p[0], p.p[1], p.p[2]);
      entry.mesh.rotation.y = p.y ?? 0;
    }
    for (const id of [...this.players.keys()]) if (!alive.has(id)) this._drop(id);
  }

  _drop(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    this.players.delete(id);
  }

  /** Tell the host where we are and what we are driving. Called once a frame. */
  report(player, drive) {
    if (!this.online) return;
    const now = performance.now();
    if (now - this._lastPose < 50) return;       // 20 Hz is plenty for a walker
    this._lastPose = now;
    const p = player.position;
    this.ws.send(encode(UP.POSE, {
      p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      y: +player.yaw.toFixed(2),
      s: player.seat ? player.seat.seatId : null,
    }));
    const key = player.seat ? player.seat.rec.key : null;
    this.ws.send(encode(UP.DRIVE, key === null ? { key: null } : { key, ...drive }));
  }
}
