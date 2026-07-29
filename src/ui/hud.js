// hud.js — hotbar, palette and the status line.
//
// The DOM is written only when something changes: a status line rebuilt every
// frame is a layout pass every frame, and on the target Intel MacBook that is
// visible in the frame time.

import { PALETTE, PARTS } from '../shared/parts.js';
import { SLOT, SLOTS_MAX } from '../build/toolbars.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.hotbarEl = document.getElementById('hotbar');
    this.paletteEl = document.getElementById('palette');
    this.statusEl = document.getElementById('status');
    this._last = '';

    this.slots = Array.from({ length: SLOTS_MAX }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      this.hotbarEl.appendChild(el);
      return el;
    });
    this._hotbarKey = '';

    this.swatches = PALETTE.map((hex) => {
      const el = document.createElement('div');
      el.className = 'swatch';
      el.style.background = hex;
      this.paletteEl.appendChild(el);
      return el;
    });
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  update(s, fps) {
    // Driving is not building: the toolbar and palette have nothing to say, and
    // a faded row of empty boxes says it worse than nothing at all.
    this.hotbarEl.hidden = !!s.driving;
    this.paletteEl.hidden = !!s.driving;
    const key = s.driving ? '' : s.barName + ':' + s.slots.map((x) => x.id).join(',');
    if (key !== this._hotbarKey) {
      this._hotbarKey = key;
      this.slots.forEach((el, i) => {
        const slot = s.slots?.[i];
        el.hidden = !slot;
        if (!slot) return;
        const label = slot.kind === SLOT.PART ? PARTS[slot.id].name : slot.name;
        el.innerHTML = `<span class="key">${i + 1}</span>` +
          `<svg class="icon" viewBox="0 0 24 24">${slotGlyph(slot)}</svg>` +
          `<span>${label.toUpperCase()}</span>`;
      });
    }
    if (!s.driving) this.slots.forEach((el, i) => el.classList.toggle('on', i === s.slotIndex));
    this.swatches.forEach((el, i) => el.classList.toggle('on', !s.driving && i === s.color));

    const line = s.driving
      ? `<b>ZA KIEROWNICĄ</b>   ${s.speed} km/h   KOŁA ${s.wheels}   ` +
        `MOC ${s.engines} kN   E — WYSIĄDŹ   V — KAMERA   ${fps} FPS`
      : `${s.barName}  <b>${s.held.toUpperCase()}</b>   ` +
        (s.toolHint ? `${s.toolHint}   ` : (s.auto ? 'OBRÓT AUTO   ' : `OBRÓT ${s.yaw}°/${s.pitch}°   `)) +
        `CZĘŚCI ${s.count}   BRYŁY ${s.bodies}   ` +
        (s.wiring ? '<b>WYBIERZ CEL KABLA</b>   ' : '') +
        (s.seatHere ? '<b>E — WSIĄDŹ</b>   ' : '') +
        (s.unpaintable ? '<b>TEJ CZĘŚCI SIĘ NIE MALUJE</b>   ' : '') +
        `${fps} FPS`;
    if (line !== this._last) { this.statusEl.innerHTML = line; this._last = line; }
  }
}

const TOOL_GLYPH = {
  remove:  '<path d="M6 8 L18 8 L17 20 L7 20 Z"/><path d="M9 8 L9 5 L15 5 L15 8"/>',
  paint:   '<path d="M5 12 L12 5 L19 12 L12 19 Z"/><path d="M12 19 L12 22"/>',
  clone:   '<rect x="4" y="4" width="11" height="11" rx="1.5"/><rect x="9" y="9" width="11" height="11" rx="1.5"/>',
  release: '<path d="M6 11 L18 11 L18 20 L6 20 Z"/><path d="M9 11 L9 7 A3 3 0 0 1 16 7"/>',
  wire:    '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M6 10 C6 16 18 8 18 14"/>',
};

/** A tiny elevation of the slot, drawn in ink — enough to tell them apart. */
function slotGlyph(slot) {
  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"';
  if (slot.kind === SLOT.TOOL) return `<g ${stroke}>${TOOL_GLYPH[slot.id] ?? ''}</g>`;
  if (slot.kind === SLOT.PREFAB) {
    return `<g ${stroke}><rect x="3" y="12" width="18" height="6" rx="1.5"/>` +
           `<circle cx="7.5" cy="19" r="2.5"/><circle cx="16.5" cy="19" r="2.5"/>` +
           `<path d="M8 12 L10 7 L16 7 L18 12"/></g>`;
  }
  const def = PARTS[slot.id];
  if (def.shape === 'wedge') return `<path d="M3 19 L21 19 L3 6 Z" ${stroke}/>`;
  if (def.shape === 'wheel') return `<circle cx="12" cy="12" r="8.5" ${stroke}/><circle cx="12" cy="12" r="3" ${stroke}/>`;
  if (def.shape === 'piston') return `<rect x="6" y="12" width="12" height="8" rx="1.5" ${stroke}/><path d="M12 12 L12 4" ${stroke}/>`;
  if (def.shape === 'hinge') return `<path d="M3 16 L21 16" ${stroke}/><circle cx="12" cy="10" r="4.5" ${stroke}/>`;
  if (def.shape === 'bearing') return `<path d="M3 17 L21 17" ${stroke}/><circle cx="12" cy="10" r="5.5" ${stroke}/><circle cx="12" cy="10" r="2" ${stroke}/>`;
  if (def.shape === 'seat') return `<path d="M5 20 L19 20 L19 15 L9 15 L9 5 L5 5 Z" ${stroke}/>`;
  if (def.shape === 'button') return `<path d="M4 17 L20 17" ${stroke}/><circle cx="12" cy="11" r="4.5" ${stroke}/>`;
  if (def.shape === 'switch') return `<path d="M4 17 L20 17" ${stroke}/><path d="M12 17 L16 7" ${stroke}/>`;
  if (def.shape === 'logic') return `<rect x="5" y="9" width="14" height="9" rx="1.5" ${stroke}/><path d="M9 9 L9 5 M15 9 L15 5" ${stroke}/>`;
  if (def.shape === 'corner') return `<path d="M3 19 L21 19 L3 6 Z M21 19 L3 6" ${stroke}/>`;
  const [w, h] = [def.size[0], def.size[1]];
  const ar = w / Math.max(h, 0.5);
  const bw = Math.min(18, 6 * Math.sqrt(ar));
  const bh = Math.min(18, 108 / Math.max(bw, 1));
  const x = 12 - bw / 2, y = 12 - bh / 2;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" ${stroke}/>`;
}
