// grid.js — the build grid and its integer orientation algebra.
// Pure maths, no three.js, no Rapier: this module is imported unchanged by the
// browser client and (from phase 7) by the authoritative Node server, so the two
// always agree on which cells a part occupies.

/** One grid cell, in metres. Scrap-Mechanic-ish: small enough for detail, big
 *  enough that a 4-cell block reads as one chunky brick. */
export const CELL = 0.25;

/** Orientation is an integer 0..15: low two bits = yaw (90° steps about +Y),
 *  high two bits = pitch (90° steps about +X). Applied as yaw ∘ pitch. */
export const ORIENTATIONS = 16;

export const yawOf = (ori) => ori & 3;
export const pitchOf = (ori) => (ori >> 2) & 3;
export const makeOri = (yaw, pitch) => ((pitch & 3) << 2) | (yaw & 3);

/** Rotate an integer vector by the orientation. Returns a new [x, y, z]. */
export function rotateVec(ori, x, y, z) {
  // pitch about +X
  switch (pitchOf(ori)) {
    case 1: { const t = y; y = -z; z = t; break; }
    case 2: { y = -y; z = -z; break; }
    case 3: { const t = y; y = z; z = -t; break; }
  }
  // yaw about +Y
  switch (yawOf(ori)) {
    case 1: { const t = x; x = z; z = -t; break; }
    case 2: { x = -x; z = -z; break; }
    case 3: { const t = x; x = -z; z = t; break; }
  }
  return [x, y, z];
}

/** Size of a part's cell box after rotation (always positive). */
export function rotateSize(ori, size) {
  const [x, y, z] = rotateVec(ori, size[0], size[1], size[2]);
  return [Math.abs(x), Math.abs(y), Math.abs(z)];
}

/** Euler angles (radians, YXZ order) for an orientation — for the renderer. */
export function oriEuler(ori) {
  return { x: pitchOf(ori) * Math.PI / 2, y: yawOf(ori) * Math.PI / 2, z: 0 };
}

/** World-space centre of a part whose cell box starts at `cell` and spans `rs`. */
export function cellBoxCentre(cell, rs) {
  return [
    (cell[0] + rs[0] / 2) * CELL,
    (cell[1] + rs[1] / 2) * CELL,
    (cell[2] + rs[2] / 2) * CELL,
  ];
}

export const cellKey = (x, y, z) => `${x},${y},${z}`;

/** Snap a world position to the cell containing it. */
export function worldToCell(x, y, z) {
  return [Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)];
}

/** Iterate every cell of a box. `fn(x, y, z)` — return false to stop early. */
export function forEachCell(cell, rs, fn) {
  for (let i = 0; i < rs[0]; i++)
    for (let j = 0; j < rs[1]; j++)
      for (let k = 0; k < rs[2]; k++)
        if (fn(cell[0] + i, cell[1] + j, cell[2] + k) === false) return false;
  return true;
}

/** Do two cell boxes overlap? */
export function boxesOverlap(a, as, b, bs) {
  return a[0] < b[0] + bs[0] && b[0] < a[0] + as[0] &&
         a[1] < b[1] + bs[1] && b[1] < a[1] + as[1] &&
         a[2] < b[2] + bs[2] && b[2] < a[2] + as[2];
}

/** Do two cell boxes touch face-to-face (share a face, not just an edge)? */
export function boxesTouch(a, as, b, bs) {
  let touching = 0;
  for (let ax = 0; ax < 3; ax++) {
    const aMin = a[ax], aMax = a[ax] + as[ax];
    const bMin = b[ax], bMax = b[ax] + bs[ax];
    if (aMax === bMin || bMax === aMin) touching++;
    else if (aMax <= bMin || bMax <= aMin) return false; // separated on this axis
  }
  return touching === 1; // exactly one axis flush, overlapping on the other two
}

/** Contact area, in cells², between two face-to-face boxes (0 if not touching). */
export function contactArea(a, as, b, bs) {
  if (!boxesTouch(a, as, b, bs)) return 0;
  let area = 1;
  for (let ax = 0; ax < 3; ax++) {
    const aMin = a[ax], aMax = a[ax] + as[ax];
    const bMin = b[ax], bMax = b[ax] + bs[ax];
    if (aMax === bMin || bMax === aMin) continue; // the flush axis contributes nothing
    area *= Math.min(aMax, bMax) - Math.max(aMin, bMin);
  }
  return area;
}
