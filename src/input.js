import { isTouchDevice } from './util.js';

/**
 * ペットカメラの操作。
 * - 1本指／マウスドラッグ：カメラの向き（景色をつかんで動かす）
 * - 2本指ピンチ／ホイール：ズーム
 * - キー：矢印・WASD 向き、Q/E ズーム、Space シャッター、1〜3 ちょっかい、F さがす、C カメラ切替
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;
    this.touch = isTouchDevice();
    this.keys = new Set();
    this.pointers = new Map();
    this.pinchDist = 0;
    this.onPan = null;
    this.onZoom = null;
    this.onAction = null;
    this.dragging = false;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.onZoom?.(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _key(e, down) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const k = e.code;
    const move = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'];
    const act = { Space: 'shutter', Enter: 'shutter', Digit1: 'treat', Digit2: 'call', Digit3: 'laser', KeyF: 'find', KeyC: 'switch' };
    if (move.includes(k)) {
      e.preventDefault();
      if (down) this.keys.add(k); else this.keys.delete(k);
      return;
    }
    if (act[k]) {
      e.preventDefault();
      if (down && !e.repeat && this.enabled) this.onAction?.(act[k]);
    }
  }

  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.canvas.setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    this.dragging = true;
  }
  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.onZoom?.(d / this.pinchDist);
      this.pinchDist = d;
    } else {
      this.onPan?.(dx, dy);
    }
  }
  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
  }

  reset() {
    this.keys.clear();
    this.pointers.clear();
    this.pinchDist = 0;
    this.dragging = false;
  }

  /** キーボードの向き入力（-1..1）とズーム入力 */
  axes() {
    const k = this.keys;
    let x = 0, y = 0, z = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyE')) z += 1;
    if (k.has('KeyQ')) z -= 1;
    return { x, y, z };
  }
}
