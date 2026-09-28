import { yen } from './util.js';
import { INCIDENTS, INCIDENT_MAP } from './incidents.js';
import { BREEDS, COLORS, EARS, TAILS, BODIES, breedParams } from './dogModel.js';
import { getSave } from './save.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

const SCREENS = { title: 'screen-title', custom: 'screen-custom', report: 'screen-report', zukan: 'screen-zukan', pause: 'screen-pause', hud: 'hud' };

const UNITS = { tissue: '枚' };

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'hud-name', 'hud-status', 'hud-dot', 'avatar', 'odai', 'odai-text', 'clock-text', 'clock-fill', 'yen', 'log', 'chain', 'banner', 'hint',
      'act-label', 'act-ico', 'btn-act', 'btn-dash', 'zukan-count', 'title-best', 'in-name', 'opt-breed', 'opt-color', 'opt-ear', 'opt-tail', 'opt-body', 'in-fluff',
      'rp-title', 'rp-photo', 'rp-verdict', 'rp-total', 'rp-best', 'rp-quote', 'rp-items', 'rp-incidents', 'rp-next', 'rp-hansei', 'rp-kawaii', 'zk-count', 'zk-list',
      'sound-state', 'quality-state']) {
      this.el[id] = $(id);
    }
    this.yenShown = 0;
    this.yenTarget = 0;
    this.cb = {};
    this.chainTimer = null;
    this.bannerTimer = null;
    this.clockEl = document.querySelector('.clock');

    const on = (id, name) => $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('ui'); this.cb[name]?.(e); });
    on('btn-start', 'start');
    on('btn-custom', 'custom');
    on('btn-zukan', 'zukan');
    on('btn-custom-ok', 'customOk');
    on('btn-again', 'again');
    on('btn-share', 'share');
    on('btn-save', 'save');
    on('btn-rp-custom', 'custom');
    on('btn-rp-title', 'title');
    on('btn-zukan-close', 'zukanClose');
    on('btn-pause', 'pause');
    on('btn-resume', 'resume');
    on('btn-restart', 'restart');
    on('btn-quit', 'title');
    on('btn-sound', 'sound');
    on('btn-quality', 'quality');
    on('btn-share-close', 'shareClose');
  }

  on(name, fn) { this.cb[name] = fn; }

  show(name, overlay = false) {
    if (!overlay) {
      for (const k in SCREENS) if (k !== name) $(SCREENS[k]).classList.add('hidden');
    }
    $(SCREENS[name]).classList.remove('hidden');
    if (name === 'title') this.refreshTitle();
  }
  hide(name) { $(SCREENS[name]).classList.add('hidden'); }

  refreshTitle() {
    const sv = getSave();
    const found = Object.keys(sv.incidents).length;
    this.el['zukan-count'].textContent = `${found}/${INCIDENTS.length}`;
    this.el['title-best'].textContent = sv.best.yen > 0 ? `自己ベスト被害総額 ${yen(sv.best.yen)} ・ 最大${sv.best.chain}連鎖` : '';
    $('btn-start').textContent = sv.dog ? `${sv.dog.name}とおるすばん` : 'おるすばんスタート';
  }

  // ---------------- HUD ----------------
  resetHud(name) {
    this.el['hud-name'].textContent = name;
    this.el.log.innerHTML = '';
    this.el.chain.className = 'chain';
    this.el.banner.className = 'banner';
    this.hint(null);
    this.yenShown = 0;
    this.yenTarget = 0;
    this.el.yen.textContent = '¥0';
  }
  setAvatar(url) { if (url) this.el.avatar.src = url; }
  setCine(on) { this.el.hud.classList.toggle('cine', !!on); }
  setOdai(text, done) {
    this.el['odai-text'].textContent = text;
    this.el.odai.classList.toggle('done', !!done);
  }
  setYen(v, bump) {
    this.yenTarget = v;
    if (bump) {
      const e = this.el.yen;
      e.classList.remove('bump');
      void e.offsetWidth;
      e.classList.add('bump');
    }
  }
  setClock(text, frac, alert) {
    if (this._clock !== text) { this.el['clock-text'].textContent = text; this._clock = text; }
    this.el['clock-fill'].style.width = Math.min(100, frac * 100).toFixed(1) + '%';
    this.clockEl.classList.toggle('alert', !!alert);
  }
  setStatus(text, lvl) {
    if (this._status !== text) { this.el['hud-status'].textContent = text; this._status = text; }
    const d = this.el['hud-dot'];
    d.classList.toggle('warn', lvl === 'warn');
    d.classList.toggle('alert', lvl === 'alert');
  }
  banner(text, isNew = false, cls = '') {
    const b = this.el.banner;
    b.innerHTML = '';
    b.append(text);
    if (isNew) {
      const s = document.createElement('span');
      s.className = 'new';
      s.textContent = 'NEW';
      b.append(s);
    }
    b.className = 'banner ' + cls;
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('out'), 2200);
  }
  hint(html) {
    const h = this.el.hint;
    if (!html) { h.classList.remove('show'); return; }
    h.innerHTML = html;
    h.classList.add('show');
  }
  showChain(n, mult) {
    const c = this.el.chain;
    c.innerHTML = `＼${n}連鎖！／<small>×${mult.toFixed(1)}</small>`;
    c.className = 'chain';
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(this.chainTimer);
    this.chainTimer = setTimeout(() => c.classList.add('fade'), 1600);
  }
  log(time, html) {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `<b>${time}</b>${html}`;
    const L = this.el.log;
    L.prepend(item);
    const items = L.querySelectorAll('.log-item');
    items.forEach((it, i) => { if (i > 0) it.classList.add('old'); if (i > 2) it.remove(); });
  }
  setAct(held, hasTarget, active, target) {
    let label, ico;
    if (held) {
      if (held.kind === 'slipper' || held.kind === 'book') { label = active ? 'かみかみ' : 'はなす'; ico = active ? 'ico-chew' : 'ico-hand'; }
      else if (held.kind === 'tissue') { label = active ? 'ぶんぶん' : 'はなす'; ico = active ? 'ico-shake' : 'ico-hand'; }
      else { label = active ? 'ぶんぶん' : 'はなす'; ico = active ? 'ico-shake' : 'ico-hand'; }
    } else if (hasTarget) { label = 'くわえる'; ico = 'ico-bone'; }
    else { label = 'わん！'; ico = 'ico-bone'; }
    const key = label + ico + hasTarget + !!held + active;
    if (this._act === key) return;
    this._act = key;
    this.el['act-label'].textContent = label;
    this.el['act-ico'].className = ico;
    const b = this.el['btn-act'];
    b.classList.toggle('ready', !!hasTarget && !held);
    b.classList.toggle('holding', !!held);
  }
  setDashReady(r) {
    if (this._dash === r) return;
    this._dash = r;
    this.el['btn-dash'].classList.toggle('cool', !r);
  }

  update(dt) {
    if (this.yenShown !== this.yenTarget) {
      const d = this.yenTarget - this.yenShown;
      this.yenShown += d * (1 - Math.exp(-9 * dt));
      if (Math.abs(this.yenTarget - this.yenShown) < 5) this.yenShown = this.yenTarget;
      const s = yen(Math.round(this.yenShown / 10) * 10);
      if (s !== this._yenText) { this.el.yen.textContent = s; this._yenText = s; }
    }
  }

  // ---------------- うちの子エディタ ----------------
  buildCustom(params, onChange) {
    this.customParams = { ...params };
    const p = this.customParams;
    const name = this.el['in-name'];
    name.value = p.name;
    name.oninput = () => { p.name = name.value.trim() || 'うさ'; onChange(p, false); };
    const chips = (el, items, key, labelKey = 'label', rebuild = true) => {
      el.innerHTML = '';
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'chip' + (p[key] === it.id ? ' on' : '');
        b.textContent = it[labelKey];
        b.onclick = () => {
          audio.unlock();
          audio.play('ui');
          if (key === 'breed') {
            Object.assign(p, breedParams(it.id, p.name));
            this.buildCustom(p, onChange);
          } else {
            p[key] = it.id;
            el.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
            b.classList.add('on');
          }
          onChange(p, rebuild);
        };
        el.append(b);
      }
    };
    chips(this.el['opt-breed'], Object.entries(BREEDS).map(([id, b]) => ({ id, label: b.label })), 'breed');
    chips(this.el['opt-ear'], EARS, 'ear');
    chips(this.el['opt-tail'], TAILS, 'tail');
    chips(this.el['opt-body'], BODIES, 'body');
    const sw = this.el['opt-color'];
    sw.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (p.color === c.id ? ' on' : '');
      b.style.background = c.hex;
      b.title = c.label;
      b.setAttribute('aria-label', c.label);
      b.onclick = () => {
        audio.unlock();
        audio.play('ui');
        p.color = c.id;
        sw.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
        b.classList.add('on');
        onChange(p, true);
      };
      sw.append(b);
    }
    const fl = this.el['in-fluff'];
    fl.value = Math.round(p.fluff * 100);
    fl.oninput = () => { p.fluff = fl.value / 100; onChange(p, true); };
  }

  // ---------------- 報告書 ----------------
  showReport(r) {
    this.show('report');
    this.el['rp-title'].textContent = `${r.name}のお留守番報告書`;
    if (r.photo) this.el['rp-photo'].src = r.photo;
    const v = this.el['rp-verdict'];
    v.textContent = r.verdictLabel;
    v.classList.toggle('mint', r.verdict === 'innocent' || r.verdict === 'goodboy' || r.verdict === 'nap');
    this.el['rp-quote'].textContent = r.caption;
    this.el['rp-best'].textContent = r.isBest && r.total > 0 ? (r.prevBest > 0 ? '自己ベスト更新！' : 'はじめての記録！') : (r.prevBest > 0 ? `自己ベスト ${yen(Math.max(r.prevBest, r.total))}` : '');
    this.el['rp-hansei'].textContent = r.hansei + '%';
    this.el['rp-kawaii'].textContent = r.kawaii + '%';

    // 明細
    const items = this.el['rp-items'];
    items.innerHTML = '';
    const entries = Object.entries(r.ledger);
    const normal = entries.filter(([, e]) => !e.bonus).sort((a, b) => b[1].yen - a[1].yen);
    const bonus = entries.filter(([, e]) => e.bonus);
    const row = (key, e, isBonus) => {
      const d = document.createElement('div');
      d.className = 'ri' + (isBonus ? ' bonus' : '');
      const n = !isBonus && e.count > 0 ? (UNITS[key] ? `${e.count}${UNITS[key]}` : `×${e.count}`) : '';
      d.innerHTML = `<span></span><span class="dots"></span><span class="n"></span><span class="y"></span>`;
      d.children[0].textContent = e.label.replace(/^クッション破裂$/, 'クッション');
      d.children[2].textContent = n;
      d.children[3].textContent = yen(e.yen);
      items.append(d);
    };
    // 同じラベルはまとめる
    const merged = {};
    for (const [k, e] of normal) {
      const lbl = { cushion: 'クッション', slipper: 'スリッパ', book: '本' }[k] || e.label;
      const m = merged[lbl] || (merged[lbl] = { key: k, label: lbl, count: 0, yen: 0 });
      m.count += e.count;
      m.yen += e.yen;
    }
    const mergedList = Object.values(merged).sort((a, b) => b.yen - a.yen);
    mergedList.slice(0, 7).forEach((e) => row(e.key, e, false));
    if (mergedList.length === 0) {
      const d = document.createElement('div');
      d.className = 'ri';
      d.textContent = '被害なし。えらい！（ほんとに？）';
      items.append(d);
    }
    for (const [k, e] of bonus) row(k, e, true);

    // じけん
    const inc = this.el['rp-incidents'];
    inc.innerHTML = '';
    for (const id of r.incidents) {
      const t = document.createElement('span');
      t.className = 'tag' + (r.newIncidents.includes(id) ? ' new' : '');
      t.textContent = INCIDENT_MAP[id].name;
      inc.append(t);
    }
    if (r.maxChain >= 2) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = `最大${r.maxChain}連鎖`;
      inc.append(t);
    }

    // 次に試したいこと
    const sv = getSave();
    const notFound = INCIDENTS.filter((i) => !sv.incidents[i.id] && i.id !== 'goodboy');
    const nx = this.el['rp-next'];
    if (notFound.length) {
      const pickN = notFound.slice(0, 2);
      nx.innerHTML = `<div>つぎは… ${pickN.map((i) => `『？？？』<span style="font-weight:500">${i.hint}</span>`).join('<br>')}</div>`;
    } else {
      nx.textContent = 'じけん図鑑コンプリート！ 被害総額の自己ベストをねらおう';
    }

    // 合計のカウントアップ
    const tot = this.el['rp-total'];
    const start = performance.now();
    const dur = Math.min(1600, 400 + r.total / 30);
    let lastTick = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      tot.textContent = yen(Math.round((r.total * e) / 10) * 10);
      if (now - lastTick > 70 && k < 1) { lastTick = now; audio.play('tick', 1 + e * 0.5); }
      if (k < 1) requestAnimationFrame(step);
      else if (r.total > 0) audio.play('coin');
    };
    requestAnimationFrame(step);
    $('screen-report').scrollTop = 0;
  }

  // ---------------- 図鑑 ----------------
  showZukan() {
    const sv = getSave();
    const list = this.el['zk-list'];
    list.innerHTML = '';
    let found = 0;
    for (const i of INCIDENTS) {
      const f = !!sv.incidents[i.id];
      if (f) found++;
      const d = document.createElement('div');
      d.className = 'zk ' + (f ? 'found' : 'locked');
      d.innerHTML = '<div class="t"></div><div class="h"></div>';
      d.children[0].textContent = f ? i.name : '？？？';
      d.children[1].textContent = f ? `+${yen(i.bonus)} ・ ${i.hint}` : `ヒント：${i.hint}`;
      list.append(d);
    }
    this.el['zk-count'].textContent = `${found}/${INCIDENTS.length}`;
    this.show('zukan', true);
  }
}
