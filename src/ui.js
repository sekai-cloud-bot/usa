import { yen } from './util.js';
import { MOMENTS, MOMENT_MAP, PERSONALITIES } from './moments.js';
import { BREEDS, COLORS, EARS, TAILS, BODIES, breedParams } from './dogModel.js';
import { getSave } from './save.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const SCREENS = { title: 'screen-title', custom: 'screen-custom', album: 'screen-album', collection: 'screen-collection', pause: 'screen-pause', hud: 'hud' };

export function starsHTML(n, max = 3) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

export class UI {
  constructor() {
    this.cb = {};
    this.el = new Proxy({}, { get: (t, k) => t[k] || (t[k] = $(k)) });
    const click = (id, name) => $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('ui'); this.cb[name]?.(e); });
    // すぐ反応してほしいボタンは pointerdown
    const press = (id, name) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        audio.unlock();
        b.classList.add('pressed');
        this.cb[name]?.(e);
      });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    click('btn-start', 'start');
    click('btn-custom', 'custom');
    click('btn-collection', 'collection');
    click('btn-collection-close', 'collectionClose');
    click('btn-custom-ok', 'customOk');
    click('btn-again', 'again');
    click('btn-share', 'share');
    click('btn-save', 'save');
    click('btn-al-custom', 'custom');
    click('btn-al-title', 'title');
    click('btn-pause', 'pause');
    click('btn-end', 'end');
    click('btn-resume', 'resume');
    click('btn-restart', 'restart');
    click('btn-quit', 'title');
    click('btn-sound', 'sound');
    click('btn-quality', 'quality');
    click('btn-share-close', 'shareClose');
    press('btn-shutter', 'shutter');
    press('g-treat', 'treat');
    press('g-call', 'call');
    press('g-laser', 'laser');
    press('g-find', 'find');
    press('g-switch', 'switch');
    // ズームボタンは押しっぱなしで連続
    for (const [id, f] of [['zoom-in', 1.035], ['zoom-out', 1 / 1.035]]) {
      const b = $(id);
      let timer = null;
      const stop = () => { clearInterval(timer); timer = null; };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.cb.zoom?.(f); timer = setInterval(() => this.cb.zoom?.(f), 16); });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('pointercancel', stop);
    }
  }

  on(name, fn) { this.cb[name] = fn; }

  show(name, overlay = false) {
    if (!overlay) for (const k in SCREENS) if (k !== name) $(SCREENS[k]).classList.add('hidden');
    $(SCREENS[name]).classList.remove('hidden');
    if (name === 'title') this.refreshTitle();
  }
  hide(name) { $(SCREENS[name]).classList.add('hidden'); }

  refreshTitle() {
    const sv = getSave();
    const got = Object.keys(sv.album).filter((k) => MOMENT_MAP[k]).length;
    this.el['collection-count'].textContent = `${got}/${MOMENTS.length}`;
    this.el['title-best'].textContent = sv.best.score > 0 ? `ベストショット ${sv.best.score}pt` : '';
    $('btn-start').textContent = sv.dog ? `${sv.dog.name}をみまもる` : 'みまもりスタート';
  }

  // ---------------- HUD ----------------
  resetHud(name, film, treats) {
    this.el['hud-name'].textContent = name;
    this.el.strip.innerHTML = '';
    this.el.alerts.innerHTML = '';
    this.el.banner.className = 'banner';
    this.hint(null);
    this.setFilm(film);
    this.setTreats(treats);
    this.setDamage(0);
    this.setLaser(false, 1);
  }
  setAvatar(url) { if (url) this.el.avatar.src = url; }
  setCine(on) { this.el.hud.classList.toggle('cine', !!on); }
  setCamName(n) { this.el['cam-name'].textContent = n; }
  setStatus(text) {
    if (this._status === text) return;
    this._status = text;
    const s = this.el['hud-status'];
    s.textContent = text;
    s.classList.remove('pulse');
    void s.offsetWidth;
    s.classList.add('pulse');
  }
  setClock(text, frac) {
    if (this._clock !== text) { this.el['clock-text'].textContent = text; this._clock = text; }
    this.el['clock-fill'].style.width = Math.min(100, frac * 100).toFixed(1) + '%';
  }
  setFilm(n) {
    this.el.film.textContent = n;
    this.el['btn-shutter'].classList.toggle('empty', n <= 0);
  }
  setTreats(n) {
    this.el['treat-count'].textContent = n;
    this.el['g-treat'].classList.toggle('off', n <= 0);
  }
  setDamage(v) {
    const s = `被害 ${yen(v)}`;
    if (this._dmg !== s) { this.el.damage.textContent = s; this._dmg = s; }
  }
  setLaser(on, frac) {
    this.el['g-laser'].classList.toggle('on', !!on);
    this.el['g-laser'].classList.toggle('off', frac <= 0.02);
    this.el['laser-bat'].style.width = Math.max(0, frac * 100).toFixed(0) + '%';
  }
  setZoom(z) {
    const s = z.toFixed(1) + '×';
    if (this._zoom === s) return;
    this._zoom = s;
    this.el['zoom-val'].textContent = s;
    this.el['zoom-fill'].style.height = ((z - 1) / 4 * 100).toFixed(0) + '%';
  }
  banner(text, cls = '') {
    const b = this.el.banner;
    b.textContent = text;
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
  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }
  speech(text) {
    const s = this.el.speech;
    s.textContent = text;
    s.classList.remove('show');
    void s.offsetWidth;
    s.classList.add('show');
  }
  flash() {
    const f = this.el.flash;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
  }
  staticFx(boot = false) {
    const s = this.el.static;
    s.className = 'static';
    void s.offsetWidth;
    s.classList.add(boot ? 'boot' : 'show');
  }
  bootCam() { this.staticFx(true); }

  /** 画面の外で起きた物音を、画面のふちに矢印で出す */
  edgeAlert(angle, text) {
    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H / 2;
    const dx = Math.cos(angle), dy = -Math.sin(angle);
    const mx = W / 2 - 90, my = H / 2 - 110;
    const k = Math.min(mx / Math.max(1e-3, Math.abs(dx)), my / Math.max(1e-3, Math.abs(dy)));
    const el = document.createElement('div');
    el.className = 'alert';
    el.innerHTML = '<i class="arr"></i><span></span>';
    el.children[1].textContent = text;
    el.children[0].style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg)`;
    el.style.left = cx + dx * k + 'px';
    el.style.top = cy + dy * k + 'px';
    this.el.alerts.appendChild(el);
    setTimeout(() => el.remove(), 2200);
    while (this.el.alerts.children.length > 3) this.el.alerts.firstChild.remove();
  }

  showShot(p) {
    const card = this.el.shotcard;
    this.el['shot-img'].src = p.url;
    this.el['shot-stars'].innerHTML = p.stars > 0 ? starsHTML(p.stars) : '<span class="off">★★★</span>';
    this.el['shot-name'].textContent = p.name + (p.blurred ? '（ブレ）' : '');
    this.el['shot-pts'].textContent = `${p.score}pt${p.face ? ' ・ 顔◎' : ''}`;
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
    const th = document.createElement('img');
    th.className = 'th';
    th.src = p.url;
    const strip = this.el.strip;
    strip.appendChild(th);
    while (strip.children.length > 4) strip.firstChild.remove();
  }

  // ---------------- うちの子エディタ ----------------
  buildCustom(params, onChange) {
    this.customParams = { ...params };
    const p = this.customParams;
    if (!p.personality) p.personality = BREEDS[p.breed]?.personality || 'amaenbo';
    const name = this.el['in-name'];
    name.value = p.name;
    name.oninput = () => { p.name = name.value.trim() || 'うさ'; onChange(p, false); };
    const chips = (el, items, key, rebuild = true) => {
      el.innerHTML = '';
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'chip' + (p[key] === it.id ? ' on' : '');
        b.textContent = it.label;
        if (it.desc) {
          const s = document.createElement('small');
          s.textContent = it.desc;
          b.append(s);
        }
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
    chips(this.el['opt-pers'], PERSONALITIES, 'personality', false);
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

  // ---------------- 昼休みのアルバム ----------------
  showAlbum(r) {
    this.show('album');
    this.albumResult = r;
    this.el['al-title'].textContent = `${r.name}の昼休みアルバム`;
    const photos = r.photos;
    const sorted = [...photos].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    const totalPts = photos.reduce((s, p) => s + p.score, 0);
    this.el['al-sub'].textContent = photos.length ? `${photos.length}枚撮影 ・ 合計 ${totalPts}pt` : '1枚も撮らなかった昼休み';
    const grid = this.el['al-grid'];
    grid.innerHTML = '';
    photos.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'al-item' + (p === best ? ' sel' : '');
      d.innerHTML = '<img alt=""><div class="stars"></div><div class="n"></div>';
      d.children[0].src = p.url;
      d.children[1].innerHTML = p.stars ? starsHTML(p.stars) : '<span class="off">★★★</span>';
      d.children[2].textContent = p.name;
      d.onclick = () => {
        audio.play('ui');
        grid.querySelectorAll('.al-item').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        this.setCover(p);
      };
      grid.append(d);
    });
    this.setCover(best || null);

    const nw = this.el['al-new'];
    nw.innerHTML = '';
    for (const id of r.newIds) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = MOMENT_MAP[id].name;
      nw.append(t);
    }
    const sv = getSave();
    const missing = MOMENTS.filter((m) => !sv.album[m.id]);
    const nx = this.el['al-next'];
    if (missing.length) {
      const pick = [...missing].sort(() => Math.random() - 0.5).slice(0, 2);
      nx.innerHTML = 'まだ撮れていない瞬間：<br>' + pick.map((m) => `・${m.hint}`).join('<br>');
    } else nx.textContent = 'アルバムコンプリート！ ★3をそろえよう';
    const got = Object.keys(sv.album).filter((k) => MOMENT_MAP[k]).length;
    this.el['al-meta'].innerHTML = `アルバム <b>${got}/${MOMENTS.length}</b> ・ 本日の被害 <b>${yen(r.damage)}</b> ・ おやつ ${r.treatsUsed}こ`;
    $('screen-album').scrollTop = 0;
  }

  setCover(p) {
    this.cover = p;
    const img = this.el['al-cover-img'];
    if (!p) {
      img.removeAttribute('src');
      this.el['al-cover-stars'].innerHTML = '';
      this.el['al-cover-name'].textContent = '写真なし';
      this.el['al-cover-cap'].textContent = '次はシャッターを押してみよう';
      return;
    }
    img.src = p.url;
    this.el['al-cover-stars'].innerHTML = p.stars ? starsHTML(p.stars) : '';
    this.el['al-cover-name'].textContent = p.name;
    this.el['al-cover-cap'].textContent = `${p.time} 「${p.caption}」`;
  }

  // ---------------- コレクション ----------------
  showCollection() {
    const sv = getSave();
    const list = this.el['col-list'];
    list.innerHTML = '';
    let got = 0;
    for (const m of MOMENTS) {
      const a = sv.album[m.id];
      if (a) got++;
      const d = document.createElement('div');
      d.className = 'col' + (a ? '' : ' locked');
      d.innerHTML = '<div class="ph"></div><div class="t"></div><div class="stars"></div><div class="h"></div>';
      if (a && a.thumb) d.children[0].style.backgroundImage = `url(${a.thumb})`;
      else if (!a) d.children[0].textContent = '？';
      d.children[1].textContent = a ? m.name : '？？？';
      d.children[2].innerHTML = a ? starsHTML(a.stars) : '';
      d.children[3].textContent = a ? `ベスト ${a.score}pt` : `ヒント：${m.hint}`;
      list.append(d);
    }
    this.el['col-count'].textContent = `${got}/${MOMENTS.length}`;
    this.show('collection', true);
  }

  update() {}
}
