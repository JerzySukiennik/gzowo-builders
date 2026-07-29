// blueprint.js — what has been built, as data.
//
// The blueprint is the single source of truth for the world's construction: a
// set of placed parts, a cell → part index so placement checks are O(cells of
// the part being placed), and the face-contact graph that phase 2 turns into
// rigid bodies and breakable joints.
//
// Pure logic — no renderer, no physics. The client mirrors it into meshes, the
// server (phase 7) mirrors it into Rapier bodies, and both stay in step because
// the ids and cell boxes are computed here and nowhere else.

import { PARTS } from './parts.js';
import { cellKey, contactArea, forEachCell, rotateSize } from './grid.js';

export class Blueprint {
  constructor() {
    this.parts = new Map();       // id -> part record
    this.occupancy = new Map();   // "x,y,z" -> part id
    this._nextId = 1;
  }

  /** All cells of a hypothetical placement are free and above ground? */
  canPlace(partId, cell, ori) {
    const def = PARTS[partId];
    if (!def) return false;
    const rs = rotateSize(ori, def.size);
    if (cell[1] < 0) return false; // nothing below the meadow
    return forEachCell(cell, rs, (x, y, z) =>
      this.occupancy.has(cellKey(x, y, z)) ? false : true);
  }

  /** Place a part. Returns the record, or null if the space is taken. */
  add({ partId, cell, ori = 0, color = 0, id = null }) {
    const def = PARTS[partId];
    if (!def) return null;
    const rs = rotateSize(ori, def.size);
    if (id === null && !this.canPlace(partId, cell, ori)) return null;

    const rec = {
      id: id ?? this._nextId++,
      partId,
      cell: [cell[0], cell[1], cell[2]],
      rs,
      ori,
      color,
    };
    if (id !== null && id >= this._nextId) this._nextId = id + 1;

    this.parts.set(rec.id, rec);
    forEachCell(rec.cell, rs, (x, y, z) => { this.occupancy.set(cellKey(x, y, z), rec.id); });
    return rec;
  }

  remove(id) {
    const rec = this.parts.get(id);
    if (!rec) return null;
    forEachCell(rec.cell, rec.rs, (x, y, z) => { this.occupancy.delete(cellKey(x, y, z)); });
    this.parts.delete(id);
    return rec;
  }

  partAtCell(x, y, z) {
    const id = this.occupancy.get(cellKey(x, y, z));
    return id === undefined ? null : this.parts.get(id);
  }

  /** Parts sharing a face with `id`, with the contact area in cells². */
  neighbours(id) {
    const rec = this.parts.get(id);
    if (!rec) return [];
    const seen = new Set();
    const out = [];
    // Walk the shell one cell outside the part's box and collect whatever is there.
    const [cx, cy, cz] = rec.cell;
    const [sx, sy, sz] = rec.rs;
    const probe = (x, y, z) => {
      const otherId = this.occupancy.get(cellKey(x, y, z));
      if (otherId === undefined || otherId === id || seen.has(otherId)) return;
      seen.add(otherId);
      const other = this.parts.get(otherId);
      const area = contactArea(rec.cell, rec.rs, other.cell, other.rs);
      if (area > 0) out.push({ id: otherId, part: other, area });
    };
    for (let i = 0; i < sx; i++) for (let j = 0; j < sy; j++) {
      probe(cx + i, cy + j, cz - 1); probe(cx + i, cy + j, cz + sz);
    }
    for (let i = 0; i < sx; i++) for (let k = 0; k < sz; k++) {
      probe(cx + i, cy - 1, cz + k); probe(cx + i, cy + sy, cz + k);
    }
    for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) {
      probe(cx - 1, cy + j, cz + k); probe(cx + sx, cy + j, cz + k);
    }
    return out;
  }

  /** Connected groups of parts — one group becomes one rigid body in phase 2. */
  components() {
    const seen = new Set();
    const groups = [];
    for (const id of this.parts.keys()) {
      if (seen.has(id)) continue;
      const group = new Set([id]);
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const cur = stack.pop();
        for (const n of this.neighbours(cur)) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          group.add(n.id);
          stack.push(n.id);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  /** Serialise for Firebase / the wire. Cell boxes are recomputed on load. */
  toJSON() {
    return {
      parts: [...this.parts.values()].map((p) => ({
        i: p.id, t: p.partId, c: p.cell, o: p.ori, k: p.color,
      })),
    };
  }

  static fromJSON(data) {
    const bp = new Blueprint();
    for (const p of data?.parts ?? []) {
      bp.add({ id: p.i, partId: p.t, cell: p.c, ori: p.o, color: p.k });
    }
    return bp;
  }
}
