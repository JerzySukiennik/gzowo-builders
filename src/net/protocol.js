// protocol.js — the words the client and server use.
//
// Pure data and pure functions, imported unchanged by both sides, so a message
// can never mean one thing when it is sent and another when it arrives.
//
// The shape of the thing: **commands go up, facts come down.** A client never
// changes the world itself; it asks, the server does it and tells everybody,
// including the asker. On a LAN that round trip is a millisecond and nobody can
// feel it, and it buys exact agreement for free — there is only ever one copy
// of the truth and every client is replaying the same list of changes.

export const PROTOCOL = 1;

/** Client → server. */
export const UP = {
  HELLO: 'hello',        // { name }
  CMD: 'cmd',            // { verb, args }  — one change to the world
  POSE: 'pose',          // { p:[x,y,z], y:yaw, s:seatId|null } — where I am
  DRIVE: 'drive',        // { key, throttle, steer, brake, mech } — what I am driving
  SAVE: 'save',          // { slot, world } — keep this world on the host's disk
  LOAD: 'load',          // { slot } — and put it back for everybody
};

/** Server → client. */
export const DOWN = {
  WELCOME: 'welcome',    // { id, protocol, world }  — the whole world, once
  CMD: 'cmd',            // { verb, args, by } — a change everybody must apply
  BODIES: 'bodies',      // { t: [[key, x,y,z, qx,qy,qz,qw], ...] }
  PLAYERS: 'players',    // { list: [{ id, name, p, y, s }] }
  BYE: 'bye',            // { id }
  DENY: 'deny',          // { why }
  WORLD: 'world',        // { world } — everyone reloads, after a host-side load
  NOTE: 'note',          // { text } — one line for the menu
};

/** The verbs a client may ask for. Anything else is dropped on the floor. */
export const VERBS = new Set([
  'place', 'remove', 'paint', 'stamp', 'connect', 'disconnect', 'release', 'interact',
]);

export const encode = (type, data) => JSON.stringify({ ...data, type });

export function decode(raw) {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}

/** Body transforms, packed flat — this is the message that goes out every tick. */
export function packBodies(bodies) {
  const out = [];
  for (const rec of bodies.values()) {
    if (!rec.dynamic) continue;
    const t = rec.body.translation();
    const q = rec.body.rotation();
    out.push([rec.key, r3(t.x), r3(t.y), r3(t.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)]);
  }
  return out;
}

// Three decimals is a millimetre, four is well past what a quaternion needs at
// this scale, and together they roughly halve the size of the tick message.
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
