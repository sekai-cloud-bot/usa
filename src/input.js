import { isTouchDevice } from './util.js';

const STICK_R = 54;

/**
 * キーボード / タッチ / マウス入力
 * move: 画面基準（x=右, y=下）で長さ0..1
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.keys = new Set();
    this.actDown = false;
    this.actPressed = false;
    this.actReleased = false;
    this.actHold = 0;
    this.dashDown = false;
    this.dashPressed = false;
    this.lastInputAt = performance.now();
    this.enabled = false;
    this.touch = isTouchDevice();
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.stickVec = { x: 0, y: 0 };
    this.onAnyInput = null;

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stick-knob');
    this.btnAct = document.getElementById('btn-act');
    this.btnDash = document.getElementById('btn-dash');

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());

    canvas.addEventListener('pointerdown', (e) => this._pDown(e));
    window.addEventListener('pointermove', (e) => this._pMove(e));
    window.addEventListener('pointerup', (e) => this._pUp(e));
    window.addEventListener('pointercancel', (e) => this._pUp(e));

    this._bindBtn(this.btnAct, (d) => this._setAct(d));
    this._bindBtn(this.btnDash, (d) => this._setDash(d));
    this.updateStickHint();
  }

  _poke() {
    this.lastInputAt = performance.now();
    if (this.onAnyInput) this.onAnyInput();
  }

  _bindBtn(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('pressed');
      fn(true);
    });
    const up = (e) => {
      el.classList.remove('pressed');
      fn(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _setAct(d) {
    if (!this.enabled) { this.actDown = false; return; }
    if (d && !this.actDown) { this.actPressed = true; this.actHold = 0; }
    if (!d && this.actDown) this.actReleased = true;
    this.actDown = d;
    this._poke();
  }
  _setDash(d) {
    if (!this.enabled) { this.dashDown = false; return; }
    if (d && !this.dashDown) this.dashPressed = true;
    this.dashDown = d;
    this._poke();
  }

  _key(e, down) {
    const k = e.code;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyZ', 'KeyX', 'Enter'];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'Space' || k === 'KeyJ' || k === 'KeyZ' || k === 'Enter') {
      this._setAct(down);
      this.btnAct.classList.toggle('pressed', down && this.enabled);
    }
    if (k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyK' || k === 'KeyX') {
      this._setDash(down);
      this.btnDash.classList.toggle('pressed', down && this.enabled);
    }
    if (this.enabled) this._poke();
  }

  _pDown(e) {
    if (!this.enabled) return;
    // 画面の右下ボタン領域以外なら、どこを触ってもスティック開始（左寄りが自然）
    if (this.stickId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stickId = e.pointerId;
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stickVec = { x: 0, y: 0 };
    this.stickEl.style.left = e.clientX + 'px';
    this.stickEl.style.top = e.clientY + 'px';
    this.stickEl.classList.add('active');
    this.stickEl.classList.remove('idle');
    this.knobEl.style.transform = 'translate(0px, 0px)';
    this._poke();
  }
  _pMove(e) {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // 追従スティック：大きく動かしたら原点も付いてくる
      const over = d - STICK_R;
      this.stickOrigin.x += (dx / d) * over;
      this.stickOrigin.y += (dy / d) * over;
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
      this.stickEl.style.left = this.stickOrigin.x + 'px';
      this.stickEl.style.top = this.stickOrigin.y + 'px';
    }
    this.stickVec = { x: dx / STICK_R, y: dy / STICK_R };
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    this._poke();
  }
  _pUp(e) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickEl.classList.remove('active');
    this.updateStickHint();
  }

  updateStickHint() {
    if (this.touch && this.stickId === null) {
      this.stickEl.classList.add('idle');
      this.stickEl.style.left = 'calc(90px + env(safe-area-inset-left, 0px))';
      this.stickEl.style.top = `calc(100% - 120px)`;
      this.knobEl.style.transform = 'translate(0px, 0px)';
    } else if (this.stickId === null) {
      this.stickEl.classList.remove('idle');
    }
  }

  reset() {
    this.keys.clear();
    this.actDown = false; this.actPressed = false; this.actReleased = false;
    this.dashDown = false; this.dashPressed = false;
    this.stickId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickEl.classList.remove('active');
    this.btnAct.classList.remove('pressed');
    this.btnDash.classList.remove('pressed');
    this.updateStickHint();
  }

  /** フレーム開始時に呼ぶ */
  poll(dt) {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const kl = Math.hypot(x, y);
    if (kl > 0) { x /= kl; y /= kl; }
    else { x = this.stickVec.x; y = this.stickVec.y; }
    const l = Math.hypot(x, y);
    // デッドゾーン
    if (l < 0.12) { x = 0; y = 0; }
    this.move.x = x; this.move.y = y;
    if (this.actDown) this.actHold += dt;
  }

  /** フレーム終了時に呼ぶ */
  endFrame() {
    this.actPressed = false;
    this.actReleased = false;
    this.dashPressed = false;
  }
}
