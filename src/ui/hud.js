// hud.js — hotbar, palette and the status line.
//
// The DOM is written only when something changes: a status line rebuilt every
// frame is a layout pass every frame, and on the target Intel MacBook that is
// visible in the frame time.

import { HOTBAR, PALETTE, PARTS } from '../shared/parts.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.hotbarEl = document.getElementById('hotbar');
    this.paletteEl = document.getElementById('palette');
    this.statusEl = document.getElementById('status');
    this._last = '';

    this.slots = HOTBAR.map((id, i) => {
      const def = PARTS[id];
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="key">${i + 1}</span>` +
        `<svg class="icon" viewBox="0 0 24 24">${slotGlyph(def)}</svg>` +
        `<span>${def.name.toUpperCase()}</span>`;
      this.hotbarEl.appendChild(el);
      return el;
    });

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
    this.hotbarEl.style.opacity = s.driving ? '0.35' : '1';
    this.paletteEl.style.opacity = s.driving ? '0.35' : '1';
    this.slots.forEach((el, i) => el.classList.toggle('on', !s.driving && HOTBAR[i] === s.partId));
    this.swatches.forEach((el, i) => el.classList.toggle('on', !s.driving && i === s.color));

    const line = s.driving
      ? `<b>ZA KIEROWNICĄ</b>   ${s.speed} km/h   KOŁA ${s.wheels}   ` +
        `SILNIKI ${s.engines}   E — WYSIĄDŹ   ${fps} FPS`
      : `<b>${s.paint ? 'MALOWANIE' : s.part.toUpperCase()}</b>   ` +
        (s.auto ? 'OBRÓT AUTO   ' : `OBRÓT ${s.yaw}°/${s.pitch}°   `) +
        `KOMÓRKA ${s.cell}   ` +
        `CZĘŚCI ${s.count}   BRYŁY ${s.bodies}   ` +
        (s.seatHere ? '<b>E — WSIĄDŹ</b>   ' : '') +
        `${fps} FPS`;
    if (line !== this._last) { this.statusEl.innerHTML = line; this._last = line; }
  }
}

/** A tiny elevation of the part, drawn in ink — enough to tell them apart. */
function slotGlyph(def) {
  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"';
  if (def.shape === 'wedge') return `<path d="M3 19 L21 19 L3 6 Z" ${stroke}/>`;
  if (def.shape === 'corner') return `<path d="M3 19 L21 19 L3 6 Z M21 19 L3 6" ${stroke}/>`;
  const [w, h] = [def.size[0], def.size[1]];
  const ar = w / Math.max(h, 0.5);
  const bw = Math.min(18, 6 * Math.sqrt(ar));
  const bh = Math.min(18, 108 / Math.max(bw, 1));
  const x = 12 - bw / 2, y = 12 - bh / 2;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" ${stroke}/>`;
}
