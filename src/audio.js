// audio.js — the sound of the workshop.
//
// Everything here is synthesised rather than fetched, and that is a decision
// rather than a shortcut. This project's own rule from Gzowo Meadow: **fetch
// what has to be recognisable, synthesise what has to react.** Nothing in this
// game has to be recognisable — there is no birdsong to identify, no radio
// station to name — and everything has to react: an engine note that follows
// road speed, a thud that scales with the blow, a click that lands on the exact
// frame a block appears. A sample library would fight all three, and would put
// a network request in the middle of a click.
//
// It also means the game has no audio assets, no CORS, and no licence page.

const MAX_VOICES = 12;

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.enabled = true;
    this.voices = 0;
  }

  /** Browsers only allow audio after a gesture, so this runs on the click to play. */
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  _voice(make) {
    if (!this.ctx || !this.enabled || this.voices >= MAX_VOICES) return null;
    this.voices++;
    const done = () => { this.voices--; };
    return make(this.ctx, this.master, done);
  }

  /** A short, bright tick — a part landing on the grid. */
  place() {
    this._voice((ctx, out, done) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.05);
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      o.connect(g).connect(out);
      o.start(); o.stop(ctx.currentTime + 0.1);
      o.onended = done;
    });
  }

  /** The same tick, downward — something coming off. */
  remove() {
    this._voice((ctx, out, done) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(700, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.09);
      g.gain.setValueAtTime(0.16, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.connect(g).connect(out);
      o.start(); o.stop(ctx.currentTime + 0.13);
      o.onended = done;
    });
  }

  /** Filtered noise: a heavy thing hitting another heavy thing. */
  thud(strength = 1) {
    this._voice((ctx, out, done) => {
      const n = 0.25 * ctx.sampleRate | 0;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 200 + 500 * Math.min(1, strength);
      const g = ctx.createGain();
      g.gain.value = 0.28 * Math.min(1.4, strength);
      src.connect(f).connect(g).connect(out);
      src.start(); src.onended = done;
    });
  }

  /** A continuous note under the car, following road speed. */
  drive(speed, driving) {
    if (!this.ctx || !this.enabled) return;
    if (!this.engine) {
      const o = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; sub.type = 'sine';
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.value = 0;
      o.connect(f); sub.connect(f); f.connect(g).connect(this.master);
      o.start(); sub.start();
      this.engine = { o, sub, g };
    }
    const t = this.ctx.currentTime;
    const hz = 48 + Math.min(speed, 16) * 7;
    this.engine.o.frequency.setTargetAtTime(hz, t, 0.08);
    this.engine.sub.frequency.setTargetAtTime(hz / 2, t, 0.08);
    this.engine.g.gain.setTargetAtTime(driving ? 0.055 : 0, t, 0.12);
  }
}
