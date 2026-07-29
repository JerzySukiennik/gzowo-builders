// builder.js — the cursor: what you are pointing at, and what happens when you click.
//
// Targeting is the whole feel of the game, so it is deliberately simple and
// predictable: cast from the eye, take the surface you hit and its face normal,
// snap to the cell that face belongs to, then step one cell out along the
// normal. On the two axes across the face the part is centred on the cell you
// pointed at, so a 1 m block lands where you are looking rather than up and to
// the right of it.

import * as THREE from 'three';
import { PARTS, HOTBAR, PALETTE } from '../shared/parts.js';
import { CELL, cellBoxCentre, makeOri, oriEuler, pitchOf, rotateSize, worldToCell, yawOf } from '../shared/grid.js';
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

export class Builder {
  constructor(scene, construction, camera, worldTargets) {
    this.scene = scene;
    this.construction = construction;
    this.camera = camera;
    this.worldTargets = worldTargets;  // ground + static props, for building on

    this.partIndex = 0;
    this.color = 2;                    // signal yellow reads well against grass
    this.ori = 0;
    this.paintMode = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;

    // The preview must be invisible to its own raycast — `visible = false` is
    // not enough, three still ray-tests hidden objects.
    this.ghost = new THREE.Mesh(geometryFor(PARTS[this.partId]), ghostOk);
    this.ghost.visible = false;
    this.ghost.raycast = () => {};
    scene.add(this.ghost);

    this.edges = new THREE.LineSegments(outlineOf(this.ghost.geometry), ghostEdge);
    this.edges.visible = false;
    this.edges.raycast = () => {};
    scene.add(this.edges);

    this.target = null; // {cell, valid, hitPartId}
    this._dir = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._normalMat = new THREE.Matrix3();
  }

  get partId() { return HOTBAR[this.partIndex]; }
  get part() { return PARTS[this.partId]; }

  selectPart(index) {
    this.partIndex = ((index % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
    this._refreshGhostGeometry();
  }

  cyclePart(dir) { this.selectPart(this.partIndex + dir); }
  cycleColor(dir) { this.color = (this.color + dir + PALETTE.length) % PALETTE.length; }
  rotate(pitchAxis) {
    this.ori = pitchAxis
      ? makeOri(yawOf(this.ori), pitchOf(this.ori) + 1)
      : makeOri(yawOf(this.ori) + 1, pitchOf(this.ori));
  }

  _refreshGhostGeometry() {
    const geo = geometryFor(this.part);
    this.ghost.geometry = geo;
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

    this._normalMat.getNormalMatrix(hit.object.matrixWorld);
    this._normal.copy(hit.face.normal).applyMatrix3(this._normalMat).normalize();

    const hitPartId = this.construction.idOfObject(hit.object);
    const inside = hit.point.clone().addScaledVector(this._normal, -INSET);
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
    const hitRec = hitPartId === null ? null : this.construction.blueprint.parts.get(hitPartId);
    const rs = rotateSize(this.ori, this.part.size);
    const cell = [...anchor];
    for (let a = 0; a < 3; a++) {
      if (a === axis) {
        if (step < 0) cell[a] -= rs[a] - 1;       // grow away from the face
      } else {
        const base = hitRec ? hitRec.cell[a] : 0;
        cell[a] = base + Math.floor((surfaceCell[a] - base) / rs[a]) * rs[a];
      }
    }

    const valid = this.construction.canPlace(this.partId, cell, this.ori);
    this.target = { cell, valid, hitPartId, normal: [...n] };

    if (this.paintMode) {
      this.ghost.visible = false;
      this.edges.visible = false;
      return;
    }

    const [gx, gy, gz] = cellBoxCentre(cell, rs);
    const e = oriEuler(this.ori);
    this.ghost.position.set(gx, gy, gz);
    this.ghost.rotation.set(e.x, e.y, e.z, 'YXZ');
    this.ghost.material = valid ? ghostOk : ghostBlocked;
    this.ghost.visible = true;
    this.edges.position.copy(this.ghost.position);
    this.edges.rotation.copy(this.ghost.rotation);
    this.edges.visible = valid;
  }

  primary() {
    if (!this.target) return;
    if (this.paintMode) {
      if (this.target.hitPartId !== null) this.construction.paint(this.target.hitPartId, this.color);
      return;
    }
    if (this.target.valid) {
      this.construction.place(this.partId, this.target.cell, this.ori, this.color);
    }
  }

  secondary() {
    if (this.target?.hitPartId !== null && this.target) {
      this.construction.removeById(this.target.hitPartId);
    }
  }

  /** Middle click: adopt the part type, orientation and colour under the cursor. */
  pipette() {
    const id = this.target?.hitPartId;
    if (id === null || id === undefined) return;
    const rec = this.construction.blueprint.parts.get(id);
    if (!rec) return;
    const idx = HOTBAR.indexOf(rec.partId);
    if (idx >= 0) this.selectPart(idx);
    this.ori = rec.ori;
    this.color = rec.color;
  }

  /** One line of state for the HUD. */
  status() {
    const cell = this.target?.cell;
    return {
      part: this.part.name,
      partId: this.partId,
      color: this.color,
      yaw: yawOf(this.ori) * 90,
      pitch: pitchOf(this.ori) * 90,
      paint: this.paintMode,
      cell: cell ? `${cell[0]} ${cell[1]} ${cell[2]}` : '—',
      count: this.construction.count,
      cellSize: CELL,
    };
  }
}
