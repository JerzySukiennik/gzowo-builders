// materials.js — one material per palette colour, shared by every part that
// wears it. Painting a part swaps its material, never clones one, so a thousand
// blocks still cost twelve materials.

import * as THREE from 'three';
import { PALETTE } from '../shared/parts.js';

const painted = PALETTE.map((hex) => new THREE.MeshStandardMaterial({
  color: new THREE.Color(hex),
  roughness: 0.62,
  metalness: 0.0,
  flatShading: false,
}));

export const materialFor = (colorIndex) => painted[colorIndex % painted.length];

/** The placement preview: a solid tint that never writes depth against itself. */
export const ghostOk = new THREE.MeshStandardMaterial({
  color: 0xffffff, transparent: true, opacity: 0.45,
  roughness: 0.9, depthWrite: false,
});

export const ghostBlocked = new THREE.MeshStandardMaterial({
  color: 0xe8442e, transparent: true, opacity: 0.35,
  roughness: 0.9, depthWrite: false,
});

/** Thin wire box drawn around the cell the cursor is pointing at. */
export const ghostEdge = new THREE.LineBasicMaterial({ color: 0x191712, transparent: true, opacity: 0.6 });
