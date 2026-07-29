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

import { JOINT_STRENGTH_PER_CELL, PARTS, partMass } from './parts.js';
import { CELL, cellBoxCentre, cellKey, contactArea, forEachCell, rotateSize, rotateVec } from './grid.js';

export const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const EMPTY = new Set();

/** Does `other` sit against the face a mechanism moves — its local +Y side? */
function onMovingFace(mech, other) {
  if (!other) return false;
  const d = rotateVec(mech.ori, 0, 1, 0);
  const a = d.findIndex((v) => v !== 0);
  if (a < 0) return false;
  return d[a] > 0
    ? other.cell[a] === mech.cell[a] + mech.rs[a]
    : other.cell[a] + other.rs[a] === mech.cell[a];
}

export class Blueprint {
  constructor() {
    this.parts = new Map();       // id -> part record
    this.occupancy = new Map();   // "x,y,z" -> part id
    this.adj = new Map();         // id -> Map(other id -> contact area in cells²)
    this.mech = new Map();        // mechanism part id -> Set(ids on its moving face)
    this.broken = new Set();      // link keys that have snapped and stay snapped
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
    this._wire(rec);
    return rec;
  }

  /**
   * Record this part's face contacts in the adjacency cache, both ways.
   *
   * The graph is walked several times per placement — components, bridges,
   * overload — and finding a part's neighbours by probing its cell shell costs
   * a hundred string keys every time. Computing it once when the part lands and
   * reading it thereafter is the difference between a placement costing 28 ms
   * on a 500-part build and costing under one.
   */
  _wire(rec) {
    const mine = new Map();
    const [cx, cy, cz] = rec.cell;
    const [sx, sy, sz] = rec.rs;
    const probe = (x, y, z) => {
      const otherId = this.occupancy.get(cellKey(x, y, z));
      if (otherId === undefined || otherId === rec.id || mine.has(otherId)) return;
      const other = this.parts.get(otherId);
      const area = contactArea(rec.cell, rec.rs, other.cell, other.rs);
      if (area > 0) mine.set(otherId, area);
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
    this.adj.set(rec.id, mine);
    for (const [otherId, area] of mine) this.adj.get(otherId)?.set(rec.id, area);

    // Work out which of these contacts are a mechanism's moving face. Doing it
    // once at placement keeps it out of every later graph walk.
    if (PARTS[rec.partId].mechanism) {
      const moving = new Set();
      for (const otherId of mine.keys()) {
        if (onMovingFace(rec, this.parts.get(otherId))) moving.add(otherId);
      }
      this.mech.set(rec.id, moving);
    }
    for (const otherId of mine.keys()) {
      const other = this.parts.get(otherId);
      if (!PARTS[other.partId].mechanism) continue;
      if (onMovingFace(other, rec)) this.mech.get(otherId)?.add(rec.id);
    }
  }

  /** Parts a mechanism carries on its far face — the ones it has to move. */
  movingSideOf(id) { return this.mech.get(id) ?? EMPTY; }

  /** Is this link a mechanism's moving face, i.e. a cut rather than a weld? */
  isMechLink(a, b) {
    return !!(this.mech.get(a)?.has(b) || this.mech.get(b)?.has(a));
  }

  /**
   * Neighbours through welds only. Body forming uses this on a released
   * construction, so a piston really does split it in two; the yard uses plain
   * neighbours, so a construction on the lift stays one solid piece while you
   * build on it.
   */
  weldNeighbours(id) {
    return this.neighbours(id).filter((n) => !this.isMechLink(id, n.id));
  }

  /** Where a mechanism's joint sits, in blueprint space: the centre of its far face. */
  jointAnchor(id) {
    const rec = this.parts.get(id);
    const d = rotateVec(rec.ori, 0, 1, 0);
    const a = d.findIndex((v) => v !== 0);
    const c = cellBoxCentre(rec.cell, rec.rs);
    c[a] += Math.sign(d[a]) * rec.rs[a] * CELL / 2;
    return { point: c, axis: d };
  }

  remove(id) {
    const rec = this.parts.get(id);
    if (!rec) return null;
    forEachCell(rec.cell, rec.rs, (x, y, z) => { this.occupancy.delete(cellKey(x, y, z)); });
    for (const otherId of this.adj.get(id)?.keys() ?? []) {
      this.adj.get(otherId)?.delete(id);
      this.mech.get(otherId)?.delete(id);
    }
    this.adj.delete(id);
    this.mech.delete(id);
    this.parts.delete(id);
    // A broken link to a part that no longer exists would resurrect as a break
    // if that part id were ever reused; drop it with the part.
    for (const key of this.broken) {
      const [a, b] = key.split('|');
      if (+a === id || +b === id) this.broken.delete(key);
    }
    return rec;
  }

  mass(id) { return partMass(PARTS[this.parts.get(id).partId]); }

  centre(id) {
    const rec = this.parts.get(id);
    return cellBoxCentre(rec.cell, rec.rs);
  }

  /** Force, in newtons, a link can carry before it snaps. */
  linkStrength(a, b) { return this.linkArea(a, b) * JOINT_STRENGTH_PER_CELL; }

  breakLink(a, b) {
    const key = linkKey(a, b);
    if (this.broken.has(key)) return false;
    this.broken.add(key);
    return true;
  }

  partAtCell(x, y, z) {
    const id = this.occupancy.get(cellKey(x, y, z));
    return id === undefined ? null : this.parts.get(id);
  }

  /** Parts still sharing a face with `id` — snapped links do not count. */
  neighbours(id) {
    const mine = this.adj.get(id);
    if (!mine) return [];
    const out = [];
    // The string key is only built when something has actually snapped — on an
    // undamaged build this loop does no allocation beyond the result itself,
    // and it runs across every part several times per placement.
    const anyBroken = this.broken.size > 0;
    for (const [otherId, area] of mine) {
      if (anyBroken && this.broken.has(linkKey(id, otherId))) continue;
      out.push({ id: otherId, part: this.parts.get(otherId), area });
    }
    return out;
  }

  /** Contact area of a link, snapped or not. */
  linkArea(a, b) { return this.adj.get(a)?.get(b) ?? 0; }

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

  /**
   * Links that are the only thing holding part of the structure on, together
   * with what hangs off them.
   *
   * This is Tarjan's bridge search rooted at the parts that reach the ground,
   * so "the far side" always means "the side away from the anchor". One linear
   * pass gives every load-bearing link and the mass and centre of mass it
   * carries — which is exactly what the overload check needs, and why the
   * check is affordable to run on every placement.
   *
   * The roots are tied together through a virtual node, because **the ground is
   * itself a structural member**. Without it, a row of blocks lying flat on the
   * meadow reads as a chain of cantilevers hanging off whichever block the
   * search happened to start at, and the whole row snaps the moment it is long
   * enough — every link in a chain is a bridge.
   *
   * Returns [{ a, b, mass, centre }] where `a` is the anchor-side part.
   */
  loadBearingLinks(group, roots) {
    const ids = [...group];
    if (!ids.length || !roots.length) return [];

    const GROUND = -1;
    const rootSet = new Set(roots);
    // Since mechanisms split one construction across several bodies, a part's
    // neighbours can now live in a body this search knows nothing about. Walking
    // into one used to reach a node with no mass recorded and crash; the load
    // path stops at the body boundary, which is also what is physically true —
    // beyond it there is a joint, not a weld.
    const inGroup = group instanceof Set ? group : new Set(ids);
    const linksOf = (u) => {
      if (u === GROUND) return roots.map((id) => ({ id }));
      const out = this.neighbours(u).filter((n) => inGroup.has(n.id));
      return rootSet.has(u) ? [...out, { id: GROUND }] : out;
    };

    const disc = new Map(), low = new Map(), parentOf = new Map();
    const subMass = new Map(), subMoment = new Map();
    const out = [];
    let timer = 0;

    for (const id of ids) { subMass.set(id, this.mass(id)); const c = this.centre(id);
      subMoment.set(id, [c[0] * subMass.get(id), c[1] * subMass.get(id), c[2] * subMass.get(id)]); }
    subMass.set(GROUND, 0);
    subMoment.set(GROUND, [0, 0, 0]);

    // Iterative DFS: a deep lattice would blow the stack on the recursive form.
    const NONE = -2;
    const stack = [{ u: GROUND, it: linksOf(GROUND)[Symbol.iterator](), parent: NONE }];
    disc.set(GROUND, timer); low.set(GROUND, timer); timer++;
    parentOf.set(GROUND, NONE);

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const step = frame.it.next();
      if (step.done) {
        stack.pop();
        const u = frame.u, p = frame.parent;
        if (p !== NONE) {
          low.set(p, Math.min(low.get(p), low.get(u)));
          subMass.set(p, subMass.get(p) + subMass.get(u));
          const mp = subMoment.get(p), mu = subMoment.get(u);
          subMoment.set(p, [mp[0] + mu[0], mp[1] + mu[1], mp[2] + mu[2]]);
          // A bridge out of the virtual ground node just means "this part rests
          // on the meadow", which is not a link that can snap.
          if (p !== GROUND && low.get(u) > disc.get(p)) {
            const m = subMass.get(u), mom = subMoment.get(u);
            if (m > 0) out.push({ a: p, b: u, mass: m, centre: [mom[0] / m, mom[1] / m, mom[2] / m] });
          }
        }
        continue;
      }
      const v = step.value.id;
      if (v === frame.parent) continue;
      if (disc.has(v)) {
        low.set(frame.u, Math.min(low.get(frame.u), disc.get(v)));
        continue;
      }
      disc.set(v, timer); low.set(v, timer); timer++;
      parentOf.set(v, frame.u);
      stack.push({ u: v, it: linksOf(v)[Symbol.iterator](), parent: frame.u });
    }
    return out;
  }

  /** Serialise for Firebase / the wire. Cell boxes are recomputed on load. */
  toJSON() {
    return {
      parts: [...this.parts.values()].map((p) => ({
        i: p.id, t: p.partId, c: p.cell, o: p.ori, k: p.color,
      })),
      broken: [...this.broken],
    };
  }

  static fromJSON(data) {
    const bp = new Blueprint();
    for (const p of data?.parts ?? []) {
      bp.add({ id: p.i, partId: p.t, cell: p.c, ori: p.o, color: p.k });
    }
    for (const k of data?.broken ?? []) bp.broken.add(k);
    return bp;
  }
}
