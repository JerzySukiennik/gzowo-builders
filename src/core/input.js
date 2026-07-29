// input.js — keyboard, mouse look and pointer lock.
//
// Held state is polled by the player each frame; one-shot events (a click, a
// wheel notch, a number key) are queued and drained once per frame so a fast
// click between two frames is never dropped.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.events = [];
    this.sensitivity = 0.0022;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.locked) this.events.push({ type: 'key', code: e.code });
      if (this.locked && e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX * this.sensitivity;
      this.dy += e.movementY * this.sensitivity;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.events.push({ type: 'mouse', button: e.button });
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.events.push({ type: 'wheel', dir: Math.sign(e.deltaY) });
      e.preventDefault();
    }, { passive: false });
  }

  lock() { this.canvas.requestPointerLock(); }

  down(code) { return this.keys.has(code); }

  /** Consume the mouse-look delta accumulated since the last call. */
  takeLook() {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  }

  /** Consume this frame's discrete events. */
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
