import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();
// 吹き出しを ずらす候補（近い順。横より たてに ずらすほうを 先に）
const OFFSETS = [];
for (let dy = -360; dy <= 360; dy += 12) for (let dx = -420; dx <= 420; dx += 24) if (dx || dy) OFFSETS.push([dx, dy]);
OFFSETS.sort((a, b) => (Math.abs(a[1]) * (a[1] > 0 ? 1.15 : 1) + Math.abs(a[0]) * 1.4) - (Math.abs(b[1]) * (b[1] > 0 ? 1.15 : 1) + Math.abs(b[0]) * 1.4));

const ICONS = {
  star: '★', nose: '👃', bolt: '⚡', flower: '✿', paw: '🐾', heart: '♥', gift: '🎁', eye: '☀',
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

  /** できごとの数（右上） */
  events(n, total) {
    $('events-n').textContent = n;
    $('events-total').textContent = `/${total}`;
    if (n > 0) {
      const pill = $('events-pill');
      pill.classList.remove('pop');
      void pill.offsetWidth;
      pill.classList.add('pop');
    }
  }
  /** 思い出カード（写真＋できごと）。続けて来たら順番に */
  memory(m) {
    this.memQ = this.memQ || [];
    this.memQ.push(m);
    if (!this.memBusy) this._nextMemory();
  }
  _nextMemory() {
    const m = this.memQ.shift();
    if (!m) { this.memBusy = false; return; }
    this.memBusy = true;
    const el = $('memory');
    const img = $('m-img');
    const icon = $('m-icon');
    // 写真のかわりに、大きなアイコン（おたから・ごほうび）
    el.classList.toggle('icon', !!m.icon);
    icon.textContent = m.icon || '';
    if (m.url) { img.src = m.url; el.classList.remove('nophoto'); } else { img.removeAttribute('src'); el.classList.toggle('nophoto', !m.icon); }
    el.style.setProperty('--kc', m.color);
    $('m-kind').textContent = m.kindLabel;
    $('m-new').style.display = m.isNew ? '' : 'none';
    $('m-title').textContent = m.title;
    $('m-line').textContent = m.line || '';
    $('m-count').textContent = m.count || `できごと ${m.n} / ${m.total}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.memTimer);
    this.memTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => this._nextMemory(), 450);
    }, 3800);
  }
  clockFF(on) { document.body.classList.toggle('ff', on); }

  /** だるまさんが ころんだ：言い終わった音まで明るく。look: ふり向いた、caught: つかまった */
  daruma(s) {
    const el = $('daruma');
    if (!s) { el.classList.remove('show', 'look', 'caught'); return; }
    el.classList.add('show');
    el.classList.toggle('look', !!s.look);
    el.classList.toggle('caught', !!s.caught);
    const spans = el.querySelectorAll('span');
    spans.forEach((sp, i) => sp.classList.toggle('on', i < s.n));
  }

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

  clock(hour, h0, h1, ff = false) {
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    const s = `${hh}:${String(mm).padStart(2, '0')}`;
    if (s !== this.lastClock) {
      this.lastClock = s;
      $('clock-text').textContent = s;
      const k = Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
      $('clock-fill').style.width = `${k * 100}%`;
      const left = (h1 - hour) * 60;
      let t;
      if (ff) t = '⏩ 早送り中';
      else if (left <= 0) t = '電車 到着';
      else if (left < 1) t = 'まもなく到着';
      else {
        const m = Math.ceil(left);
        t = `電車まで ${Math.floor(m / 60) ? Math.floor(m / 60) + '時間' : ''}${m % 60 ? (m % 60) + '分' : ''}`;
      }
      $('clock-left').textContent = t;
      document.body.classList.toggle('dusk', hour > 17.3);
      document.body.classList.toggle('late', hour >= h1);
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
  say(getPos, text, dur = 2.5, name = '', key = null) {
    // 同じ人の古い吹き出しは消す（key：話している人）
    if (key) for (const o of this.bubbles) if (o.key === key) o.until = 0;
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
    const b = { el, getPos, key, until: performance.now() + dur * 1000, w: 0, h: 0 };
    this.bubbles.push(b);
    this.updateBubbles();
  }
  hideBubbles(h) { this.bubbleRoot.style.visibility = h ? 'hidden' : ''; }
  updateBubbles() {
    this.layoutTop();
    const now = performance.now();
    const W = innerWidth, H = innerHeight;
    if (!this.bubbles.length) return;
    const dt = Math.min(0.1, (now - (this._bt || now)) / 1000);
    this._bt = now;
    // 演出中は黒帯（高さ 9vh）の内側に収める（スマホの横向きで、吹き出しの上が切れていた）。
    // 黒帯は伸びるアニメーションの途中でも、伸びきった高さで考える
    const cine = document.body.classList.contains('cine');
    const band = cine ? Math.max(this.letterTop().getBoundingClientRect().bottom, H * 0.1) : 0;
    // ふだんは 上の表示（時計・目標の札・右上のボタン）に 重ならないように（スマホの縦向きでは 札が 2段目に来る）
    const top = cine ? band + 8 : Math.max(64, this.hudBottom() + 8);
    const bottom = H - band - 8;
    // ほかの表示（通知・カード・字幕・ボタン など）と、先に置いた吹き出しにも 重ならないように
    const obs = this.obstacles().slice();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (now > b.until) {
        b.el.classList.remove('show');
        const el = b.el;
        setTimeout(() => el.remove(), 300);
        this.bubbles.splice(i, 1);
        continue;
      }
      if (!b.w) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; }
      _p.copy(b.getPos());
      _p.project(this.camera);
      const behind = _p.z > 1;
      // 位置は吹き出しの下のしっぽの先。本体は translate で上に乗る（margin-top: -14px 分も含める）
      const hw = Math.min(b.w / 2 + 8, W / 2);
      const ax = (_p.x * 0.5 + 0.5) * W, ay = (-_p.y * 0.5 + 0.5) * H;   // 話している人
      const x0 = Math.min(W - hw, Math.max(hw, ax));
      const y0 = Math.min(bottom, Math.max(top + b.h + 14, ay));
      // 重なっている 広さ（画面から はみ出す時は -1）
      const overlap = (dx, dy) => {
        const x = x0 + dx, y = y0 + dy;
        if (x - hw < 0 || x + hw > W || y - b.h - 14 < top || y > bottom) return -1;
        const l = x - b.w / 2 - 6, r = x + b.w / 2 + 6, t = y - b.h - 20, bt = y;
        let s = 0;
        for (const o of obs) if (l < o.r && r > o.l && t < o.b && bt > o.t) s += (Math.min(r, o.r) - Math.max(l, o.l)) * (Math.min(bt, o.b) - Math.max(t, o.t));
        return s;
      };
      const fits = (dx, dy) => overlap(dx, dy) === 0;
      // 重なる時は、近くの あいている所へ（前の ずらし方が まだ使えれば それ。行ったり来たり しないように）。
      // どこにも あきが ない時は、いちばん 重なりの 少ない所
      let tx = 0, ty = 0;
      if (!behind && !fits(0, 0)) {
        if (b.tx !== undefined && (b.tx || b.ty) && fits(b.tx, b.ty)) { tx = b.tx; ty = b.ty; }
        else {
          let found = false, best = overlap(0, 0), bx = 0, by = 0;
          if (best < 0) best = Infinity;
          for (let n = 0; n < OFFSETS.length; n++) {
            const [dx, dy] = OFFSETS[n];
            const s = overlap(dx, dy);
            if (s === 0) { tx = dx; ty = dy; found = true; break; }
            if (s > 0 && s < best * 0.8) { best = s; bx = dx; by = dy; }
          }
          if (!found) { tx = bx; ty = by; }
        }
      }
      b.tx = tx; b.ty = ty;
      // すっと 動かす
      if (b.ox === undefined) { b.ox = tx; b.oy = ty; }
      const k = 1 - Math.exp(-dt * 10);
      b.ox += (tx - b.ox) * k;
      b.oy += (ty - b.oy) * k;
      const x = x0 + b.ox, y = y0 + b.oy;
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      // しっぽは 話している人の ほうへ
      b.el.style.setProperty('--tx', `${Math.max(-b.w / 2 + 18, Math.min(b.w / 2 - 18, ax - x)).toFixed(1)}px`);
      b.el.style.opacity = behind ? '0' : '';
      if (!behind) obs.push({ l: x - b.w / 2, r: x + b.w / 2, t: y - b.h - 14, b: y });
    }
  }
  /**
   * スマホの縦向き：上の お知らせ（音の案内・だるまさん・ヒント・できごとカード・通知）を、
   * 時計と目標の札の下に じゅんに ならべる（同じ高さに 出て かさならないように）。0.12秒ごと
   */
  layoutTop() {
    const now = performance.now();
    if (now - (this._ltT || 0) < 120) return;
    this._ltT = now;
    const els = this._stack || (this._stack = [$('sound-tap'), $('daruma'), $('hint'), $('memory'), this.toastRoot]);
    if (!(innerWidth <= 520 && innerHeight > innerWidth)) {
      if (this._stacked) { for (const el of els) el.style.top = ''; this._stacked = false; }
      return;
    }
    this._stacked = true;
    let y = 0;
    for (const el of [$('objective'), this._clock || (this._clock = document.querySelector('#hud .clock-pill')), this._hr || (this._hr = document.querySelector('#hud .hud-right'))]) {
      if (el.id === 'objective' && !el.classList.contains('show')) continue;
      y = Math.max(y, el.getBoundingClientRect().bottom);
    }
    y += 8;
    for (const el of els) {
      el.style.top = `${Math.round(y)}px`;
      const shown = el === this.toastRoot ? !!el.querySelector('.toast.show') : el.classList.contains('show');
      if (shown) y = el.getBoundingClientRect().bottom + 8;
    }
  }
  /** 吹き出しが よける 表示（0.15秒ごとに はかりなおす）：通知・できごとカード・ヒント・字幕・場所の名前・ボタン など */
  obstacles() {
    const now = performance.now();
    if (now - (this._obT || 0) < 150) return this._ob;
    this._obT = now;
    const out = [];
    const push = (r) => { if (r.width > 0 && r.height > 0) out.push({ l: r.left, r: r.right, t: r.top, b: r.bottom }); };
    // 字幕・ヒントは 横に長い箱なので、文字の ところだけ
    const text = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); push(rg.getBoundingClientRect()); };
    const hudOn = !$('hud').classList.contains('off');
    for (const id of ['hint', 'caption', 'memory', 'daruma', 'prompt', 'carry', 'area-card', 'sound-tap']) {
      const el = $(id);
      if (!el || !el.classList.contains('show') || (!hudOn && el.closest('#hud'))) continue;
      if (id === 'hint' || id === 'caption') text(el); else push(el.getBoundingClientRect());
    }
    if ($('title-card').classList.contains('show')) for (const id of ['tc-main', 'tc-sub']) text($(id));
    for (const el of this.toastRoot.querySelectorAll('.toast.show')) push(el.getBoundingClientRect());
    if (hudOn) {
      // 右下の ボタン（ボタンの ところだけ。すき間は あけておく）
      const pad = this._pad || (this._pad = document.querySelector('.pad'));
      if (pad && pad.offsetParent) for (const bt of pad.querySelectorAll('.pbtn')) push(bt.getBoundingClientRect());
      const st = $('stick');
      if (st && st.classList.contains('on')) push(st.getBoundingClientRect());
    }
    return (this._ob = out);
  }
  letterTop() { return this._lt || (this._lt = document.querySelector('.letterbox.top')); }
  /** 上の表示（時計・目標の札・右上のボタン・音の案内）の いちばん下（0.3秒ごとに はかりなおす） */
  hudBottom() {
    const now = performance.now();
    if (now - (this._hbT || 0) < 300) return this._hb;
    this._hbT = now;
    let b = 0;
    if (!$('hud').classList.contains('off')) {
      this._hudTop = this._hudTop || [...document.querySelectorAll('#hud .clock-pill, #objective, #hud .hud-right')];
      for (const el of this._hudTop) {
        if (el.id === 'objective' && !el.classList.contains('show')) continue;
        b = Math.max(b, el.getBoundingClientRect().bottom);
      }
    }
    const st = $('sound-tap');
    if (st && st.classList.contains('show')) b = Math.max(b, st.getBoundingClientRect().bottom);
    return (this._hb = b);
  }
}
