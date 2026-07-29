// prefabs.js — machines you can stamp down whole.
//
// Building a working car from twenty parts teaches you the game once. After
// that it is homework. A prefab is a plain list of placements relative to a
// corner, stamped into whatever grid the cursor is over, so you can drop a
// rolling chassis and spend your time on the interesting half.
//
// Pure data, like the rest of `shared/` — the server can stamp these too.

import { rotateSize } from './grid.js';
import { PARTS } from './parts.js';

/** Orientation whose local +Y points along a unit axis, for wheels and mounts. */
function facing(x, y, z) {
  for (let ori = 0; ori < 16; ori++) {
    const p = ori >> 2 & 3, w = ori & 3;
    let v = [0, 1, 0];
    switch (p) { case 1: v = [0, 0, 1]; break; case 2: v = [0, -1, 0]; break; case 3: v = [0, 0, -1]; break; }
    let [a, b, c] = v;
    switch (w) {
      case 1: [a, c] = [c, -a]; break;
      case 2: [a, c] = [-a, -c]; break;
      case 3: [a, c] = [-c, a]; break;
    }
    if (a === x && b === y && c === z) return ori;
  }
  return 0;
}

const LEFT = facing(-1, 0, 0);
const RIGHT = facing(1, 0, 0);
const UP = facing(0, 1, 0);

const car = () => {
  const out = [];
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 5; z++) out.push({ t: 'block', c: [2 + x * 4, 4, z * 4], o: 0, k: 6 });
  }
  out.push({ t: 'wheel', c: [0, 2, 0], o: LEFT });
  out.push({ t: 'wheel', c: [0, 2, 16], o: LEFT });
  out.push({ t: 'wheel', c: [14, 2, 0], o: RIGHT });
  out.push({ t: 'wheel', c: [14, 2, 16], o: RIGHT });
  out.push({ t: 'seat', c: [6, 8, 8], o: 0 });
  out.push({ t: 'engine_electric', c: [6, 8, 16], o: 0 });
  return out;
};

const lift = () => ([
  { t: 'block', c: [0, 0, 0], o: 0, k: 11 },
  { t: 'block', c: [4, 0, 0], o: 0, k: 11 },
  { t: 'piston', c: [0, 4, 0], o: UP },
  { t: 'panel', c: [0, 8, 0], o: 0, k: 10 },
  { t: 'panel', c: [4, 8, 0], o: 0, k: 10 },
]);

const arm = () => ([
  { t: 'block', c: [0, 0, 0], o: 0, k: 11 },
  { t: 'block', c: [0, 4, 0], o: 0, k: 11 },
  { t: 'motor_rotary', c: [0, 8, 0], o: UP },
  { t: 'piston', c: [0, 10, 0], o: UP },
  { t: 'beam', c: [0, 14, 0], o: 0, k: 3 },
]);

const button = () => ([
  { t: 'block', c: [0, 0, 0], o: 0, k: 11 },
  { t: 'button', c: [1, 4, 1], o: UP },
]);

const PREFAB_LIST = [
  { id: 'pf_car', name: 'Autko', build: car, hotbar: 1 },
  { id: 'pf_lift', name: 'Winda', build: lift, hotbar: 2 },
  { id: 'pf_arm', name: 'Ramię', build: arm, hotbar: 3 },
  { id: 'pf_button', name: 'Pulpit', build: button, hotbar: 4 },
];

export const PREFABS = Object.fromEntries(PREFAB_LIST.map((p) => {
  const parts = p.build();
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const it of parts) {
    const rs = rotateSize(it.o ?? 0, PARTS[it.t].size);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], it.c[a]);
      max[a] = Math.max(max[a], it.c[a] + rs[a]);
    }
  }
  return [p.id, { ...p, parts, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }];
}));

export const PREFAB_IDS = PREFAB_LIST.map((p) => p.id);
