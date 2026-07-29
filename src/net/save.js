// save.js — keeping a world.
//
// One format for three destinations, because the snapshot the host hands a
// joining player is already a complete description of the world: if it can be
// joined it can be saved, and a save that loads is a save that can be joined.
//
//   solo      → the browser's own storage, instantly, no setup
//   in a game → the host's disk, so the world outlives whoever leaves first
//   Firebase  → the same JSON under `worlds/<slot>`, when a config is present
//
// Firebase is off until `assets/firebase.json` exists. That file holds a normal
// web app config (apiKey, databaseURL and friends), and it is deliberately not
// in the repo: it is Jurek's project, not the game's, and a config baked into a
// public repo is a config someone else can write to.

import { UP, encode } from './protocol.js';

const KEY = (slot) => `gzowo-builders:world:${slot}`;
export const SLOTS = ['A', 'B', 'C'];

let firebase = null;      // resolved lazily, once, if a config is there

async function tryFirebase() {
  if (firebase !== null) return firebase;
  firebase = false;
  try {
    const cfg = await fetch('assets/firebase.json').then((r) => (r.ok ? r.json() : null));
    if (!cfg?.databaseURL) return false;
    const [{ initializeApp }, db] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'),
    ]);
    const app = initializeApp(cfg);
    firebase = { db: db.getDatabase(app), ...db };
  } catch {
    firebase = false;
  }
  return firebase;
}

export class Saves {
  constructor(construction, net) {
    this.c = construction;
    this.net = net;
    this.last = '';
  }

  get where() { return this.net?.online ? 'host' : 'przeglądarka'; }

  async save(slot) {
    const world = this.c.snapshot();
    const json = JSON.stringify(world);
    if (this.net?.online) {
      this.net.ws.send(encode(UP.SAVE, { slot, world }));
      this.last = `zapisano u hosta (${slot})`;
      return true;
    }
    try {
      localStorage.setItem(KEY(slot), json);
    } catch (err) {
      this.last = `nie zmieściło się: ${err.message}`;
      return false;
    }
    const fb = await tryFirebase();
    if (fb) {
      try { await fb.set(fb.ref(fb.db, `worlds/${slot}`), world); } catch { /* local copy stands */ }
    }
    this.last = `zapisano (${slot}, ${(json.length / 1024).toFixed(0)} kB)`;
    return true;
  }

  async load(slot) {
    if (this.net?.online) {
      this.net.ws.send(encode(UP.LOAD, { slot }));
      this.last = `wczytuję u hosta (${slot})`;
      return true;
    }
    let world = null;
    const raw = localStorage.getItem(KEY(slot));
    if (raw) { try { world = JSON.parse(raw); } catch { world = null; } }
    if (!world) {
      const fb = await tryFirebase();
      if (fb) {
        try { world = (await fb.get(fb.ref(fb.db, `worlds/${slot}`))).val(); } catch { world = null; }
      }
    }
    if (!world) { this.last = `slot ${slot} jest pusty`; return false; }
    this.c.restore(world);
    this.last = `wczytano (${slot})`;
    return true;
  }

  /** Which slots have something in them — for the menu. */
  used() {
    return SLOTS.filter((s) => {
      try { return !!localStorage.getItem(KEY(s)); } catch { return false; }
    });
  }
}
