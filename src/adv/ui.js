import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

const ICONS = {
  star: '★', nose: '👃', bolt: '⚡', flower: '✿', paw: '🐾',
};

/** 画面の文字まわり（HUD・吹き出し・字幕・カード） */
export class UI {
  constructor(camera) {
    this.camera = camera;
    this.bubbles = [];
    this.bubbleRoot = $('bubbles');
    this.toastRoot = $('toasts');
    this.lastClock = '';
    this.objText = null;
    this.actionText = null;
    this.hintTimer = null;
    this.touch = false;
  }

  setTouch(t) {
    this.touch = t;
    document.body.classList.toggle('touch', t);
  }
  setName(n) { this.name = n; }

  hud(on) { $('hud').classList.toggle('off', !on); }
  letterbox(on) { document.body.classList.toggle('cine', on); }
  fade(to, dur = 0.6) {
    const f = $('fade');
    f.style.transition = `opacity ${dur}s ease`;
    f.style.opacity = String(to);
  }
  flash() {
    const f = $('flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  objective(text) {
    if (text === this.objText) return;
    this.objText = text;
    const el = $('objective');
    if (!text) { el.classList.remove('show'); return; }
    el.classList.remove('show');
    void el.offsetWidth;
    $('objective-text').textContent = text;
    el.classList.add('show');
  }

  hint(text, dur = 7) {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
  }

  caption(text, dur = 2.5) {
    const el = $('caption');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
  }

  title(main, sub, dur = 5) {
    const el = $('title-card');
    $('tc-main').textContent = main;
    $('tc-sub').textContent = sub;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.tcTimer);
    this.tcTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
  }

  area(name, sub) {
    const el = $('area-card');
    $('ac-name').textContent = name;
    $('ac-sub').textContent = sub || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.acTimer);
    this.acTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  toast(text, icon = 'star') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<i>${ICONS[icon] || '★'}</i><span></span>`;
    el.querySelector('span').textContent = text;
    this.toastRoot.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 3600);
  }

  friend(f, n, total, line, isNew, collected) {
    const el = $('friend-card');
    $('fc-dot').style.background = f.color;
    $('fc-name').textContent = f.name;
    $('fc-line').textContent = line;
    $('fc-count').textContent = `ともだち ${n} / ${total}`;
    $('fc-new').style.display = isNew ? '' : 'none';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.fcTimer);
    this.fcTimer = setTimeout(() => el.classList.remove('show'), 3400);
    $('friends-n').textContent = n;
    const pill = $('friends-pill');
    pill.classList.remove('pop');
    void pill.offsetWidth;
    pill.classList.add('pop');
    void collected;
  }
  resetFriends() { $('friends-n').textContent = '0'; }

  action(label) {
    if (label === this.actionText) return;
    this.actionText = label;
    const b = $('btn-action');
    const pr = $('prompt');
    if (label) {
      $('action-label').textContent = label;
      b.classList.add('on');
      $('prompt-label').textContent = label;
      pr.classList.add('show');
    } else {
      b.classList.remove('on');
      pr.classList.remove('show');
    }
  }
  progress(k) {
    const r = $('dig-ring');
    if (k === null || k === undefined) { r.classList.remove('show'); return; }
    r.classList.add('show');
    r.style.setProperty('--k', String(Math.min(1, k)));
  }

  clock(hour, h0, h1) {
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    const s = `${hh}:${String(mm).padStart(2, '0')}`;
    if (s !== this.lastClock) {
      this.lastClock = s;
      $('clock-text').textContent = s;
      const k = Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
      $('clock-fill').style.width = `${k * 100}%`;
      const left = Math.max(0, (h1 - hour) * 60);
      $('clock-left').textContent = left > 0.5 ? `あと ${Math.floor(left / 60) ? Math.floor(left / 60) + '時間' : ''}${Math.round(left % 60)}分` : 'まもなく';
      document.body.classList.toggle('dusk', hour > 17.3);
    }
  }
  carry(label) {
    if (label === this.carryText) return;
    this.carryText = label;
    const el = $('carry');
    if (label) { $('carry-label').textContent = label; el.classList.add('show'); } else el.classList.remove('show');
  }
  sniff(k) {
    const on = k > 0.3;
    if (on !== this.sniffOn) {
      this.sniffOn = on;
      document.body.classList.toggle('sniffing', on);
    }
  }

  // ---- 吹き出し ----
  say(getPos, text, dur = 2.5, name = '') {
    // 同じ人の古い吹き出しは消す
    const el = document.createElement('div');
    el.className = 'bubble';
    if (name) {
      const n = document.createElement('b');
      n.textContent = name;
      el.appendChild(n);
    }
    const s = document.createElement('span');
    s.textContent = text;
    el.appendChild(s);
    this.bubbleRoot.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const b = { el, getPos, until: performance.now() + dur * 1000 };
    this.bubbles.push(b);
    this.updateBubbles();
  }
  hideBubbles(h) { this.bubbleRoot.style.visibility = h ? 'hidden' : ''; }
  updateBubbles() {
    const now = performance.now();
    const W = innerWidth, H = innerHeight;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (now > b.until) {
        b.el.classList.remove('show');
        const el = b.el;
        setTimeout(() => el.remove(), 300);
        this.bubbles.splice(i, 1);
        continue;
      }
      _p.copy(b.getPos());
      _p.project(this.camera);
      const behind = _p.z > 1;
      const x = Math.min(W - 90, Math.max(90, (_p.x * 0.5 + 0.5) * W));
      const y = Math.min(H - 60, Math.max(70, (-_p.y * 0.5 + 0.5) * H));
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      b.el.style.opacity = behind ? '0' : '';
    }
  }
}
