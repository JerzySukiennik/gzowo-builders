// session.js — the one place that decides who changes the world.
//
// Every verb that mutates a construction goes through here. On your own it does
// the thing. In a game it asks the host and waits — a millisecond on a LAN — so
// that there is exactly one copy of the truth and every client is replaying the
// same list of changes rather than each guessing its own.
//
// The builder does not know which of the two it is talking to, which is the
// entire point: multiplayer is not a mode the rest of the code has to handle.

import { UP, VERBS, encode } from './protocol.js';

export class Session {
  constructor(construction) {
    this.c = construction;
    this.socket = null;         // set once a game is joined
    this.selfId = null;
  }

  get online() { return !!this.socket && this.socket.readyState === 1; }

  /** Ask for a change. Solo: do it now and return the result. Online: send. */
  ask(verb, ...args) {
    if (!VERBS.has(verb)) return null;
    if (!this.online) return this.apply(verb, args);
    this.socket.send(encode(UP.CMD, { verb, args }));
    return null;                // the answer arrives as an echo
  }

  /** Do a change for real. Called locally when solo, and by the net layer when not. */
  apply(verb, args) {
    const c = this.c;
    switch (verb) {
      case 'place': return c.place(...args);
      case 'remove': return c.removeById(...args);
      case 'paint': return c.paint(...args);
      case 'stamp': return c.stamp(...args);
      case 'connect': return c.connect(...args);
      case 'disconnect': return c.disconnectAll(...args);
      case 'release': return c.toggleRelease(...args);
      case 'interact': return c.logic.interact(...args);
      default: return null;
    }
  }

  // --- the verbs the game actually calls -----------------------------------
  place(partId, cell, ori, color, targetKey) {
    return this.ask('place', partId, cell, ori, color, targetKey);
  }

  remove(id) { return this.ask('remove', id); }
  paint(id, color) { return this.ask('paint', id, color); }
  stamp(prefabId, cell, color, targetKey) { return this.ask('stamp', prefabId, cell, color, targetKey); }
  connect(a, b) { return this.ask('connect', a, b); }
  disconnect(id) { return this.ask('disconnect', id); }
  release(id) { return this.ask('release', id); }
  interact(id) { return this.ask('interact', id); }
}
