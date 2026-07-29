// builder.js — the cursor: what you are pointing at, and what happens when you click.
//
// Targeting is the whole feel of the game, so it is deliberately simple and
// predictable: cast from the eye, take the surface you hit and its face normal,
// snap to the cell that face belongs to, then step one cell out along the
// normal. On the two axes across the face the part is centred on the cell you
// pointed at, so a 1 m block lands where you are looking rather than up and to
// the right of it.

import * as THREE from 'three';
import { PARTS, PALETTE } from '../shared/parts.js';
import { PREFABS } from '../shared/prefabs.js';
import { SLOT, SLOTS_MAX, TOOLBARS, TOOLS } from './toolbars.js';
import { CELL, ORIENTATIONS, cellBoxCentre, makeOri, oriEuler, pitchOf, rotateSize, rotateVec, worldToCell, yawOf } from '../shared/grid.js';
import { geometryFor } from '../render/geometry.js';
import { ghostBlocked, ghostEdge, ghostOk } from '../render/materials.js';

const REACH = 7.0;
// How far past the surface to step when asking "which cell did I hit?". A
// hair's breadth is not enough: the ground plane sits exactly on a cell
// boundary, and a rounded part's bevel puts the hit point a couple of
// centimetres proud of its own face. A quarter of a cell clears both and still
// lands inside the thinnest part in the catalogue (the 1-cell panel).
const INSET = CELL * 0.25;

// The Blender parts are chamfered and panelled, so the default 1° edge
// threshold would outline every facet of every bevel — a wireframe ball of
// fluff. 30° keeps the silhouette and the panel lines and drops the rest.
const outlineOf = (geo) => new THREE.EdgesGeometry(geo, 30);
const ZERO = [0, 0, 0];
/** How many parts one drag may lay down. A slip of the wrist should not cost
 *  you a thousand blocks and the undo you do not have. */
const MAX_FILL = 240;

/** The orientation whose local +Y points along a face normal — used by wheels. */
function orientToFace(normal) {
  const n = [normal.x, normal.y, normal.z];
  const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
  const want = [0, 0, 0];
  want[axis] = Math.sign(n[axis]) || 1;
  for (let ori = 0; ori < ORIENTATIONS; ori++) {
    const v = rotateVec(ori, 0, 1, 0);
    if (v[0] === want[0] && v[1] === want[1] && v[2] === want[2]) return ori;
  }
  return 0;
}

export class Builder {
  constructor(scene, construction, camera, worldTargets, session) {
    this.scene = scene;
    this.construction = construction;
    this.session = session ?? construction;
    this.camera = camera;
    this.worldTargets = worldTargets;  // ground + static props, for building on

    this.barIndex = 0;                 // which toolbar
    this.slotIndex = 0;                 // which slot inside it
    this.color = 2;                    // signal yellow reads well against grass
    this.ori = 0;
    this.wireFrom = null;              // first end of a cable being run

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;

    // The preview must be invisible to its own raycast — `visible = false` is
    // not enough, three still ray-tests hidden objects.
    // The cursor starts on the tools bar, which previews nothing, so the ghost
    // is seeded with any geometry and swapped the moment a part is picked up.
    this.ghost = new THREE.Mesh(geometryFor(PARTS.block), ghostOk);
    this.ghost.visible = false;
    this.ghost.raycast = () => {};
    scene.add(this.ghost);

    this.edges = new THREE.LineSegments(outlineOf(this.ghost.geometry), ghostEdge);
    this.edges.visible = false;
    this.edges.raycast = () => {};
    scene.add(this.edges);

    // Dragging out a wall needs a preview that can show more than one part, so
    // the single ghost gains an instanced twin. It is only switched on while a
    // drag is running; a one-part placement still uses the plain ghost.
    this.fill = null;          // { anchor, ori, targetKey, cells } while dragging
    this.fillView = new THREE.InstancedMesh(this.ghost.geometry, ghostOk, MAX_FILL);
    this.fillView.count = 0;
    this.fillView.frustumCulled = false;
    this.fillView.raycast = () => {};
    scene.add(this.fillView);
    this._fm = new THREE.Matrix4();
    this._fq = new THREE.Quaternion();
    this._fp = new THREE.Vector3();
    this._fs = new THREE.Vector3(1, 1, 1);

    this.target = null; // {cell, valid, hitPartId}
    this._dir = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._normalMat = new THREE.Matrix3();
    this._invQ = new THREE.Quaternion();
    this._origin = new THREE.Vector3();
  }

  get bar() { return TOOLBARS[this.barIndex]; }
  get slot() { return this.bar.slots[Math.min(this.slotIndex, this.bar.slots.length - 1)]; }
  get holdingPart() { return this.slot.kind === SLOT.PART; }
  get holdingPrefab() { return this.slot.kind === SLOT.PREFAB; }
  get tool() { return this.slot.kind === SLOT.TOOL ? this.slot.id : null; }
  /** The part the ghost should show — a part slot, or a prefab's first block. */
  get partId() { return this.holdingPart ? this.slot.id : null; }
  get part() { return this.partId ? PARTS[this.partId] : null; }

  selectSlot(index) {
    const n = this.bar.slots.length;
    this.slotIndex = ((index % n) + n) % n;
    this.wireFrom = null;
    this._refreshGhostGeometry();
  }

  /** Tab walks the toolbars; the numbers stay meaningful inside one. */
  cycleToolbar(dir = 1) {
    const n = TOOLBARS.length;
    this.barIndex = ((this.barIndex + dir) % n + n) % n;
    this.slotIndex = Math.min(this.slotIndex, this.bar.slots.length - 1);
    this.wireFrom = null;
    this._refreshGhostGeometry();
  }

  cycleSlot(dir) { this.selectSlot(this.slotIndex + dir); }
  cycleColor(dir) { this.color = (this.color + dir + PALETTE.length) % PALETTE.length; }
  rotate(pitchAxis) {
    this.ori = pitchAxis
      ? makeOri(yawOf(this.ori), pitchOf(this.ori) + 1)
      : makeOri(yawOf(this.ori) + 1, pitchOf(this.ori));
  }

  _refreshGhostGeometry() {
    this.fill = null;
    this.fillView.count = 0;
    if (!this.holdingPart) { this.ghost.visible = false; this.edges.visible = false; return; }
    const geo = geometryFor(this.part);
    this.ghost.geometry = geo;
    this.fillView.geometry = geo;
    this.edges.geometry.dispose();
    this.edges.geometry = outlineOf(geo);
  }

  /** Recompute what the crosshair is over. Call once per rendered frame. */
  update(player) {
    // The raycast reads world matrices, so it must not depend on the renderer
    // having traversed the scene first: a part placed this frame, or a frame the
    // browser skipped because the tab was in the background, would otherwise be
    // ray-tested against a stale (often identity) transform.
    this.scene.updateMatrixWorld();

    const origin = this.camera.position;
    player.forward(this._dir);
    this.raycaster.set(origin, this._dir);

    const hits = this.raycaster.intersectObjects(
      [...this.construction.raycastTargets, ...this.worldTargets], false);
    const hit = hits[0];

    if (!hit || !hit.face) {
      this.target = null;
      this.ghost.visible = false;
      this.edges.visible = false;
      return;
    }

    const hitPartId = this.construction.idOfObject(hit.object);
    // Every construction has its own grid, so the whole cell calculation happens
    // in the frame of whatever you are pointing at. On the ground that frame is
    // the world; on a car it is the car, which is why you can build on one while
    // it is parked at an angle halfway across the meadow.
    const target = hitPartId === null ? null : this.construction.bodyOf(hitPartId);
    const frame = target ? target.group : null;

    this._normalMat.getNormalMatrix(hit.object.matrixWorld);
    this._normal.copy(hit.face.normal).applyMatrix3(this._normalMat).normalize();
    const point = hit.point.clone();
    if (frame) {
      // A body's group sits at the body's origin and its part meshes hang off it
      // by `centre - origin`, so group-local space is blueprint space shifted by
      // the origin. Forgetting to shift back means every cell you compute on a
      // construction is displaced — by the centre of that construction's
      // bounding box, which grows as you build.
      frame.worldToLocal(point).add(this._origin.fromArray(target.origin));
      this._normal.applyQuaternion(this._invQ.copy(frame.quaternion).invert());
    }
    this._normal.normalize();

    const inside = point.addScaledVector(this._normal, -INSET);
    const surfaceCell = worldToCell(inside.x, inside.y, inside.z);

    // Step one cell out along the dominant component of the face normal.
    const n = [this._normal.x, this._normal.y, this._normal.z];
    const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    const step = Math.sign(n[axis]) || 1;
    const anchor = [...surfaceCell];
    anchor[axis] += step;

    // Across the face, snap to a tiling grid anchored on the part you are
    // building against (or on the world origin, on bare ground). Pointing
    // anywhere inside a tile places there, so a wall of panels comes out flush
    // without pixel-hunting, and you can still step a whole part sideways.
    const hitRec = target ? target.bp.parts.get(hitPartId) : null;
    // A wheel is useless pointing the wrong way, so drive parts turn themselves
    // to the face you stick them on rather than making you cycle R until the
    // axle happens to line up.
    const held = this.holdingPart ? this.part
      : (this.holdingPrefab ? PARTS[PREFABS[this.slot.id].parts[0].t] : null);
    const ori = held?.autoOrient ? orientToFace(this._normal) : this.ori;
    const rs = held ? rotateSize(ori, held.size) : [1, 1, 1];
    const cell = [...anchor];
    for (let a = 0; a < 3; a++) {
      if (a === axis) {
        if (step < 0) cell[a] -= rs[a] - 1;       // grow away from the face
      } else {
        const base = hitRec ? hitRec.cell[a] : 0;
        cell[a] = base + Math.floor((surfaceCell[a] - base) / rs[a]) * rs[a];
      }
    }

    const targetKey = target ? target.key : null;
    const valid = this.holdingPart
      ? this.construction.canPlace(this.partId, cell, ori, targetKey)
      : (this.holdingPrefab ? this.construction.canStamp(this.slot.id, cell, targetKey) : false);
    this.target = { cell, ori, valid, hitPartId, targetKey, axis, normal: [...n] };

    if (!held) {                       // a tool has nothing to preview
      this.ghost.visible = false;
      this.edges.visible = false;
      return;
    }

    // The preview lives in the same frame as the placement will.
    const parent = frame ?? this.scene;
    if (this.ghost.parent !== parent) { parent.add(this.ghost); parent.add(this.edges); }

    // Inside a body's group, positions are measured from the body's origin —
    // the same offset every part mesh gets. Drawing the preview at the raw
    // blueprint centre puts it a whole origin away from where the part will
    // actually land, and since the origin is the centre of the build's bounding
    // box, the error grows with the build: on a big one the ghost ends up
    // somewhere else entirely on the map.
    const o = target ? target.origin : ZERO;
    if (this.fill) {
      this._updateFill(rs);
      this._drawFill(rs, parent, o, ori);
      this.ghost.visible = false;
      this.edges.visible = false;
      return;
    }
    this.fillView.count = 0;
    const [gx, gy, gz] = cellBoxCentre(cell, rs);
    const e = oriEuler(ori);
    this.ghost.position.set(gx - o[0], gy - o[1], gz - o[2]);
    this.ghost.rotation.set(e.x, e.y, e.z, 'YXZ');
    this.ghost.material = valid ? ghostOk : ghostBlocked;
    this.ghost.visible = true;
    this.edges.position.copy(this.ghost.position);
    this.edges.rotation.copy(this.ghost.rotation);
    this.edges.visible = valid;
  }

  _drawFill(rs, parent, origin, ori) {
    const view = this.fillView;
    if (view.parent !== parent) parent.add(view);
    const e = oriEuler(ori);
    this._fq.setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'YXZ'));
    let n = 0;
    let anyBlocked = false;
    for (const cell of this.fill.cells) {
      const free = this.construction.canPlace(this.partId, cell, ori, this.fill.targetKey);
      if (!free) { anyBlocked = true; continue; }
      const [cx, cy, cz] = cellBoxCentre(cell, rs);
      this._fm.compose(this._fp.set(cx - origin[0], cy - origin[1], cz - origin[2]),
                       this._fq, this._fs);
      view.setMatrixAt(n++, this._fm);
      if (n >= MAX_FILL) break;
    }
    view.count = n;
    view.instanceMatrix.needsUpdate = true;
    view.material = anyBlocked ? ghostBlocked : ghostOk;
  }

  /** A seat under the cursor you could get into. */
  seatUnderCursor() {
    const id = this.target?.hitPartId;
    if (id === null || id === undefined) return null;
    const rec = this.construction.bodyOf(id);
    if (!rec?.vehicle) return null;
    return rec.vehicle.seats.some((s) => s.id === id) ? { rec, seatId: id } : null;
  }

  /**
   * Start dragging out a fill. Only parts drag: a tool acts where you click it,
   * and a prefab is already a hundred parts in one go.
   */
  beginFill() {
    if (!this.holdingPart || !this.target?.valid) return false;
    this.fill = {
      anchor: [...this.target.cell], ori: this.target.ori,
      targetKey: this.target.targetKey, axis: this.target.axis, cells: [this.target.cell],
    };
    return true;
  }

  /** Finish the drag and lay down everything the preview was showing. */
  commitFill() {
    const fill = this.fill;
    this.fill = null;
    this.fillView.count = 0;
    if (!fill) return 0;
    let placed = 0;
    for (const cell of fill.cells) {
      if (!this.construction.canPlace(this.partId, cell, fill.ori, fill.targetKey)) continue;
      this.session.place(this.partId, cell, fill.ori, this.color, fill.targetKey);
      placed++;
    }
    return placed;
  }

  /**
   * The rectangle between where the drag started and where the cursor is now,
   * stepping by the part's own size. The axis the face points along is held
   * fixed, so a drag across a wall stays on that wall instead of burrowing into
   * it — which is what makes this feel like painting rather than aiming.
   */
  _updateFill(rs) {
    const f = this.fill;
    if (!f || !this.target) return;
    const now = this.target.cell;
    const cells = [];
    const span = (a) => {
      const step = rs[a];
      const from = f.anchor[a];
      const n = Math.trunc((now[a] - from) / step);
      return { from, step, n };
    };
    const axes = [0, 1, 2].filter((a) => a !== f.axis);
    const A = span(axes[0]), B = span(axes[1]);
    const dirA = A.n >= 0 ? 1 : -1, dirB = B.n >= 0 ? 1 : -1;
    for (let i = 0; i <= Math.abs(A.n); i++) {
      for (let j = 0; j <= Math.abs(B.n); j++) {
        if (cells.length >= MAX_FILL) break;
        const cell = [...f.anchor];
        cell[axes[0]] = A.from + i * A.step * dirA;
        cell[axes[1]] = B.from + j * B.step * dirB;
        cells.push(cell);
      }
    }
    f.cells = cells;
  }

  /** Left button: use whatever the cursor is holding. */
  primary() {
    if (!this.target) return null;
    const hit = this.target.hitPartId;
    switch (this.slot.kind) {
      case SLOT.PART:
        if (this.target.valid) {
          this.session.place(this.partId, this.target.cell, this.target.ori,
                             this.color, this.target.targetKey);
        }
        return null;
      case SLOT.PREFAB:
        if (this.target.valid) {
          this.session.stamp(this.slot.id, this.target.cell, this.color, this.target.targetKey);
        }
        return null;
      default:
        return this._useTool(this.slot.id, hit);
    }
  }

  _useTool(tool, hit) {
    if (hit === null || hit === undefined) {
      if (tool === 'wire') this.wireFrom = null;
      return null;
    }
    switch (tool) {
      case 'remove': this.session.remove(hit); return 'usunięto';
      case 'paint': this.session.paint(hit, this.color); return 'pomalowano';
      case 'clone': this.pipette(); return 'skopiowano';
      case 'release': return this.session.release(hit);
      case 'wire': {
        if (this.wireFrom === null) { this.wireFrom = hit; return 'wybierz cel'; }
        const ok = this.session.connect(this.wireFrom, hit);
        this.wireFrom = null;
        return ok ? 'połączono' : 'nie da się połączyć';
      }
      default: return null;
    }
  }

  /** Right button stays "undo the last thing you did", whatever you hold. */
  secondary() {
    const hit = this.target?.hitPartId;
    if (hit === null || hit === undefined) return;
    if (this.slot.kind === SLOT.TOOL && this.slot.id === 'wire') {
      this.session.disconnect(hit);
      this.wireFrom = null;
      return;
    }
    this.session.remove(hit);
  }

  /** `G`: cut the construction under the cursor loose, or put it back. */
  toggleRelease() {
    const id = this.target?.hitPartId;
    if (id === null || id === undefined) return null;
    return this.construction.toggleRelease(id);
  }

  /** Middle click: adopt the part type, orientation and colour under the cursor. */
  pipette() {
    const id = this.target?.hitPartId;
    if (id === null || id === undefined) return;
    const rec = this.construction.recordOf(id);
    if (!rec) return;
    // Find whichever toolbar carries this part and hold it.
    for (let b = 0; b < TOOLBARS.length; b++) {
      const idx = TOOLBARS[b].slots.findIndex((sl) => sl.kind === SLOT.PART && sl.id === rec.partId);
      if (idx < 0) continue;
      this.barIndex = b;
      this.selectSlot(idx);
      break;
    }
    this.ori = rec.ori;
    this.color = rec.color;
  }

  /** One line of state for the HUD. */
  status(player = null) {
    const seat = player?.seat ?? null;
    if (seat) {
      const v = seat.rec.vehicle;
      const lv = seat.rec.body.linvel();
      return {
        driving: true,
        speed: Math.round(Math.hypot(lv.x, lv.y, lv.z) * 3.6),
        wheels: v?.wheels.length ?? 0,
        grounded: v ? v.wheels.filter((w) => w.grounded).length : 0,
        throttle: this.lastThrottle ?? 0,
        engines: v ? Math.round(v.engineForce / 1000) : 0,
        mechs: seat.rec.bp ? this.construction.mechanisms.count : 0,
      };
    }
    const cell = this.target?.cell;
    return {
      held: this.slot.name ?? PARTS[this.slot.id]?.name ?? this.slot.id,
      partId: this.partId,
      color: this.color,
      yaw: yawOf(this.ori) * 90,
      pitch: pitchOf(this.ori) * 90,
      paint: this.tool === 'paint',
      auto: !!this.part?.autoOrient,
      cell: cell ? `${cell[0]} ${cell[1]} ${cell[2]}` : '—',
      filling: this.fill ? this.fill.cells.length : 0,
      barName: this.bar.name,
      slots: this.bar.slots,
      slotIndex: this.slotIndex,
      toolHint: this.tool ? TOOLS[this.tool].hint : null,
      wiring: this.wireFrom !== null,
      count: this.construction.count,
      bodies: this.construction.bodyCount,
      seatHere: !!this.seatUnderCursor(),
      unpaintable: this.tool === 'paint' && this.target?.hitPartId !== null
        && this.target?.hitPartId !== undefined
        && PARTS[this.construction.recordOf(this.target.hitPartId)?.partId]?.paintable === false,
      cellSize: CELL,
    };
  }
}
