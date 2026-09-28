import { isTouchDevice } from '../util.js';

/**
 * 入力：PC はキーボード＋マウス、スマホは左の仮想スティック＋右のドラッグ＋ボタン。
 * move は (x=右, y=前) の -1..1。押した瞬間のボタンは pressed で拾う。
 */
export class Controls {
  constructor(canvas, cam) {
    this.canvas = canvas;
    this.cam = cam;
    this.touch = isTouchDevice();
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.keys = new Set();
    this.pressed = new Set();
    this.holding = new Set();
    this.enabled = true;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.mouse = { down: false, x: 0, y: 0, moved: 0 };
    this.lastInput = 0;
    this.onAny = null;

    const KEYMAP = {
      Space: 'jump', KeyE: 'action', Enter: 'action', KeyF: 'sniff', KeyQ: 'bark', KeyB: 'bark', KeyC: 'sit', KeyX: 'sit',
      Escape: 'pause', KeyP: 'pause', KeyR: 'recenter',
    };
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        const a = KEYMAP[e.code];
        if (a) { this.pressed.add(a); this.holding.add(a); }
      }
      this.keys.add(e.code);
      this.lastInput = performance.now();
      if (this.onAny) this.onAny();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) this.holding.delete(a);
    });
    addEventListener('blur', () => { this.keys.clear(); this.holding.clear(); });

    // マウス：ドラッグでカメラ、ホイールでズーム
    canvas.addEventListener('mousedown', (e) => { this.mouse.down = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = 0; });
    addEventListener('mousemove', (e) => {
      if (!this.mouse.down || !this.enabled) return;
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.moved += Math.abs(dx) + Math.abs(dy);
      this.cam.orbit(dx, dy);
    });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

    // タッチ：左半分はスティック、右半分はカメラ
    const stickEl = document.getElementById('stick');
    const knobEl = document.getElementById('stick-knob');
    this.stickEl = stickEl;
    const R = 56;
    canvas.addEventListener('touchstart', (e) => {
      this.touch = true;
      if (this.onAny) this.onAny();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.stick.id === null) {
          this.stick.id = t.identifier;
          this.stick.ox = t.clientX; this.stick.oy = t.clientY;
          this.stick.x = 0; this.stick.y = 0;
          if (stickEl) {
            stickEl.style.left = `${t.clientX}px`;
            stickEl.style.top = `${t.clientY}px`;
            stickEl.classList.add('on');
          }
        } else if (this.look.id === null) {
          this.look.id = t.identifier;
          this.look.x = t.clientX; this.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          this.stick.x = dx / R; this.stick.y = -dy / R;
          if (knobEl) knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === this.look.id) {
          if (this.enabled) this.cam.orbit((t.clientX - this.look.x) * 1.3, (t.clientY - this.look.y) * 1.1);
          this.look.x = t.clientX; this.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.id = null; this.stick.x = 0; this.stick.y = 0;
          if (knobEl) knobEl.style.transform = '';
          if (stickEl) stickEl.classList.remove('on');
        }
        if (t.identifier === this.look.id) this.look.id = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);

    // 画面のボタン
    for (const el of document.querySelectorAll('[data-btn]')) {
      const a = el.dataset.btn;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.pressed.add(a);
        this.holding.add(a);
        el.classList.add('down');
        if (this.onAny) this.onAny();
      };
      const up = (e) => {
        e.preventDefault();
        this.holding.delete(a);
        el.classList.remove('down');
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    }
  }

  get stickActive() { return this.stick.id !== null; }

  update() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.stick.id !== null) {
      x = this.stick.x; y = this.stick.y;
      const m = Math.hypot(x, y);
      if (m < 0.12) { x = 0; y = 0; }
      run = m > 0.9;
    }
    if (!this.enabled) { x = 0; y = 0; run = false; }
    this.move.x = x; this.move.y = y;
    this.run = run;
  }

  consume(a) {
    if (!this.enabled) { this.pressed.delete(a); return false; }
    if (this.pressed.has(a)) { this.pressed.delete(a); return true; }
    return false;
  }
  held(a) { return this.enabled && this.holding.has(a); }
  clear() { this.pressed.clear(); }
}
