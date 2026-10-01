import * as THREE from 'three';
import { Person, Traffic, Train, makeItem, makeWear, glassesFit, WEAR, WEAR_SLOTS } from './actors.js';
import { PointFX, ScentTrail, HintMarker, Motes } from './fx.js';
import { Z, DIG, SCENT, ROAD, TRACK } from './town.js';
import { RIVER, SHRINE } from './town2.js';
import { EventDirector, EVENTS, FRIEND_IDS, KINDS } from './events.js';
import { installHappenings } from './happen.js';
import { Party } from './party.js';
import { Treasures } from './treasure.js';
import { pickTitle, TITLES } from './titles.js';
import { audio } from '../audio.js';
import { clamp, damp, dampAngle, angleDiff, lerp, smooth, disposeObject } from '../util.js';
import { ROOM, BED } from '../room.js';

export { EVENTS, KINDS };
export const GIFTS = {
  none: { label: 'なし', line: (n, party) => (party ? `${n}、ありがとう。…すごく うれしい` : `…${n}？ むかえに来てくれたの？ ひとりで？`) },
  stick: { label: 'りっぱな枝', line: () => 'えっ、これ おみやげ？ ふふ、りっぱな枝だね' },
  cap: { label: 'ぴかぴかの王冠', line: () => 'きらきら…！ 宝物、見せにきてくれたんだね' },
  ball: { label: 'だれかのボール', line: () => 'そのボール…だれの？ あとで一緒に返しにいこうね' },
  sakura: { label: '桜の枝', line: () => '春を持ってきてくれたの？ ありがとう' },
  sunflower: { label: 'ひまわり', line: (n) => `お花…！ ${n}、ありがとう。最高のおかえりだよ` },
  sock: { label: 'あの人のくつした', line: () => 'あっ、わたしのくつした！ …さがしてたんだよ、それ' },
  coin: { label: '100円玉', line: () => '100円…？ ひろったの？ 帰りにアイス、はんぶんこしよっか' },
  omikuji: { label: 'おみくじ（大吉）', line: () => '大吉！？ …うん。いいこと、いまあったよ' },
  figure: { label: 'ガチャの柴犬', line: () => 'ちっちゃい柴犬…！ ふふ、おそろいだね' },
};

const AREAS = [
  { id: 'shrine', name: 'ひだまり神社', sub: '石段の上のおやしろ', test: (p) => p.x < -33.6 && p.z > -30 && p.z < 30 },
  { id: 'lane', name: 'ひだまり二丁目', sub: '路地', test: (p) => p.z >= 5.7 && p.z <= 11.3 && p.x < 48 && p.x >= -33.6 },
  { id: 'street', name: 'ひだまり商店街', sub: '夕方の買いもの', test: (p) => p.x > 38.5 && p.x < 47.5 && p.z < 4.8 && p.z > -49.2 },
  { id: 'park', name: 'さくら公園', sub: '池とすべり台', test: (p) => p.x > 26 && p.x < 79 && p.z < -50 && p.z > -96 },
  { id: 'river', name: 'ひだまり川', sub: '夕日の河川敷', test: (p) => p.z < -105.5 && p.z > -170 },
  { id: 'road', name: '駅前通り', sub: '信号は青で', test: (p) => p.x >= 79 && p.x <= 95 && p.z < -44 && p.z > -100 },
  { id: 'plaza', name: 'ひだまり駅', sub: '18:00 着', test: (p) => p.x > 95 && p.z < -44 && p.z > -100 },
];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
export const START_HOUR = 16.5;
export const ARRIVE_HOUR = 18;
// 1時間半 ≒ 12分（夕方の光の中を、寄り道しながら歩く）
const HOUR_PER_SEC = 1.5 / 720;

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, camera, renderer, day, town, player, cam, ctl, post, ui, save
    const { scene } = this;
    this.A = this.town.anchors;
    this.fx = new PointFX(scene, 900, { additive: true, gain: 1.6 });
    this.dust = new PointFX(scene, 400, { additive: false, gain: 1 });
    this.motes = new Motes(scene, 110);
    this.trail = new ScentTrail(scene, SCENT, (x, z) => this.heightAt(x, z));
    // チュートリアルの目じるし：リビングの窓のすき間／庭の柵の下のやわらかい土
    this.markWindow = new HintMarker(scene, 'nose', V(ROOM.maxX - 0.45, 0, 0.3), { ring: 0.42, height: 0.72 });
    this.markDig = new HintMarker(scene, 'dig', V(DIG.x, 0.05, DIG.z - 0.45), { ring: 0.62, height: 0.85 });
    this.co = [];
    this.people = [];
    this.solid = [];
    this.items = [];
    this.hooks = { update: [], interact: [], sit: [], bark: [], area: [], pick: new Map() };
    this.photoQueue = [];
    this.state = 'idle';
    this.t = 0;
    this.hour = START_HOUR;
    this.sniffK = 0;
    this.sitT = 0;
    this.digT = 0;
    this.area = null;
    this.flags = {};
    this.trainT = 20;
    this.hintT = 0;
    this.ev = new EventDirector(this);
    this.party = new Party(this);
    this.buildCore();
    installHappenings(this);
    this.treasure = new Treasures(this);
  }

  // ------------------------------------------------------------
  // しくみ
  // ------------------------------------------------------------
  on(type, fn) { this.hooks[type].push(fn); }
  onPick(id, fn) { this.hooks.pick.set(id, fn); }
  P(o, x, z, h = 0, y = 0) { const p = new Person(this.scene, o); p.place(x, z, h, y); this.people.push(p); return p; }
  /** 地面に物を置く。gift: 飼い主へのおみやげになる */
  addItem(id, label, pos, ry = 0, { gift = true, hidden = false } = {}) {
    const mesh = makeItem(id);
    mesh.position.copy(pos);
    mesh.rotation.y = ry;
    mesh.visible = !hidden;
    this.scene.add(mesh);
    const it = { id, label, mesh, ground: !hidden, home: pos.clone(), gift };
    this.items.push(it);
    return it;
  }
  near(v, r, dy = 1.2) { const dp = this.player.pos; return Math.hypot(v.x - dp.x, v.z - dp.z) < r && Math.abs(v.y - dp.y) < dy; }
  heightAt(x, z) {
    let best = this.town.col.baseAt(x, z);
    for (const b of this.town.col.near(x, z, 0.3)) {
      if (b.y1 - best < 0.5 && b.y1 > best && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) best = b.y1;
    }
    return best;
  }
  run(gen) { const c = { it: gen, wait: 0, until: null }; this.co.push(c); return c; }
  tickCo(dt) {
    for (let i = this.co.length - 1; i >= 0; i--) {
      const c = this.co[i];
      if (!c) continue;
      if (c.wait > 0) { c.wait -= dt; continue; }
      if (c.until && !c.until()) continue;
      c.until = null;
      const r = c.it.next(dt);
      if (r.done) { const k = this.co.indexOf(c); if (k >= 0) this.co.splice(k, 1); continue; }
      if (typeof r.value === 'number') c.wait = r.value;
      else if (typeof r.value === 'function') c.until = r.value;
    }
  }
  say(who, text, dur = 2.6) {
    const name = who === this.owner ? '' : who.name;
    this.ui.say(() => (who.headWorld ? who.headWorld(_w) : _w.copy(who.pos).add(_v.set(0, 0.7, 0))), text, dur, name);
  }
  sayAt(pos, text, dur, name = '') { this.ui.say(() => pos, text, dur, name); }
  sparkle(pos, n = 14, color = 0xffe6a8, shape = 2) {
    this.fx.burst(pos, n, (i, p) => ({ pos: p, vel: V((Math.random() - 0.5) * 2.2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.2), color, size: 0.14 + Math.random() * 0.12, life: 0.8 + Math.random() * 0.6, gravity: 2.5, drag: 1.5, shape }));
  }
  confetti(pos, n = 40) {
    const cols = [0xff8fa8, 0xf6c24a, 0x6fd3ae, 0x8fb8ff, 0xffffff];
    this.fx.burst(pos, n, (i, p) => ({ pos: p.clone(), vel: V((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), color: cols[i % cols.length], size: 0.12 + Math.random() * 0.1, life: 1.4 + Math.random() * 0.8, gravity: 4, drag: 1.2, shape: i % 2 ? 2 : 3 }));
  }
  hearts(pos, n = 6) {
    this.fx.burst(pos, n, (i, p) => ({ pos: V(p.x + (Math.random() - 0.5) * 0.4, p.y, p.z + (Math.random() - 0.5) * 0.4), vel: V((Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6), color: 0xff8fa8, size: 0.22 + Math.random() * 0.12, life: 1.6, drag: 1, shape: 1 }));
  }
  puff(pos, n = 8, color = 0xc9b79a) {
    this.dust.burst(pos, n, (i, p) => ({ pos: V(p.x, p.y + 0.05, p.z), vel: V((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6), color, size: 0.3 + Math.random() * 0.2, grow: 1.5, life: 0.7 + Math.random() * 0.4, drag: 3, shape: 0, alpha: 0.55 }));
  }
  splash(pos, n = 12) {
    this.fx.burst(pos, n, (i, p) => ({ pos: V(p.x + (Math.random() - 0.5) * 0.3, p.y, p.z + (Math.random() - 0.5) * 0.3), vel: V((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2), color: 0xcfe8ff, size: 0.08 + Math.random() * 0.08, life: 0.6 + Math.random() * 0.3, gravity: 9, drag: 0.5, shape: 0, alpha: 0.8 }));
  }
  /** 写真を撮る（次に描いた画面を小さく保存）。wait 秒あとに */
  requestPhoto(cb, wait = 0) { this.photoQueue.push({ cb, wait }); }
  afterRender(dt) {
    if (!this.photoQueue.length) return;
    const q = this.photoQueue[0];
    q.wait -= dt;
    if (q.wait > 0) return;
    this.photoQueue.shift();
    let url = null;
    try {
      this.ui.hideBubbles(true);
      const src = this.renderer.domElement;
      const cv = this._photoCv || (this._photoCv = document.createElement('canvas'));
      const W = 480, H = 300;
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      const r = W / H, sr = src.width / src.height;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sr > r) { sw = sh * r; sx = (src.width - sw) / 2; } else { sh = sw / r; sy = (src.height - sh) / 2; }
      c.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      url = cv.toDataURL('image/jpeg', 0.85);
    } catch (e) { url = null; }
    this.ui.hideBubbles(false);
    q.cb(url);
  }

  /** 演出用：カメラを一時的に動かす（fn(c, dt, t) が false を返すまで） */
  cine(fn) {
    let t = 0;
    this.cam.startCine((c, dt) => { t += dt; return fn(c, dt, t); });
  }
  endCine(yaw = null, pitch = 0.3) {
    this.cam.endCine();
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    if (yaw !== null) { this.cam.yaw = yaw; this.cam.pitch = pitch; }
    this.post.tilt = 0;
  }
  /** 短い演出の開始と終わり（操作をとめて黒帯） */
  lock(on, hud = false) {
    const p = this.player;
    p.locked = on;
    this.ui.letterbox(on);
    this.ui.hud(!on || hud);
    this.cineLock = on;
  }

  // ------------------------------------------------------------
  // 住人（どのできごとにも関係する人・電車・車）
  // ------------------------------------------------------------
  buildCore() {
    const { scene, town } = this;
    const A = this.A;
    const shopper = (o, pts, sp = 1.0) => { const p = this.P(o, pts[0].x, pts[0].z); p.follow(pts); p.speed = sp; return p; };
    shopper({ top: 0xe8a0a0, bottom: 0x6f7fa8, bag: 0xf2e6cf, hairStyle: 'long', hair: 0x4a3428 }, [V(41.2, 0, 3), V(41.4, 0, -46), V(44.8, 0, -46), V(44.6, 0, 3)], 0.95);
    shopper({ top: 0x6f8fb0, bottom: 0x3b3f45, hairStyle: 'short', hair: 0x2a2020, glasses: true }, [V(44.5, 0, -44), V(44.2, 0, 2), V(41.6, 0, 2), V(41.8, 0, -44)], 1.1);
    shopper({ top: 0xf2d29b, bottom: 0x7a5a3a, hairStyle: 'bun', hair: 0xd8d2cc, skirt: true, bag: 0x9c6b45, scale: 0.9 }, [V(42, 0, -20), V(42.2, 0, -36), V(44, 0, -36), V(44, 0, -20)], 0.6);
    shopper({ kid: true, top: 0x9fd4b0, bottom: 0x3e6ea8, hat: 'yellow' }, [V(43.6, 0, 4), V(43.4, 0, -12), V(42.4, 0, -12), V(42.6, 0, 4)], 1.3);
    shopper({ top: 0xb58ae0, bottom: 0x4a5468, hairStyle: 'short', hair: 0x6a4330, bag: 0x3e6ea8 }, [V(-20, 0, 7.4), V(36, 0, 7.4), V(36, 0, 9.6), V(-20, 0, 9.6)], 1.0);
    // 公園の人
    const sitOn = (p, b) => p.sitOn(b.x, b.z, b.ry, b.y);
    this.oldman = this.P({ name: 'おじいさん', hairStyle: 'bald', hair: 0xd8d2cc, top: 0x7a8a6a, bottom: 0x5b5b5b, glasses: true, hat: 'straw' }, 0, 0);
    sitOn(this.oldman, A.benches.park[1]);
    const jog = this.P({ top: 0xe8604c, bottom: 0x3b3f45, hairStyle: 'short', hat: 'cap', hatColor: 0x3b3f45 }, 52, -70.5);
    const loop = [];
    for (let i = 0; i < 16; i++) { const a = -(i / 16) * Math.PI * 2; loop.push(V(52 + Math.cos(a) * 12.5, 0, -80 + Math.sin(a) * 9.5)); }
    jog.follow(loop);
    jog.speed = 2.6;
    // 河川敷：犬の散歩・ジョギング・自転車
    const rj = this.P({ top: 0x3e8fd8, bottom: 0x2a2f38, hairStyle: 'short', hat: 'cap', hatColor: 0xf2f0ea }, 0, RIVER.flatY);
    rj.follow([V(-50, RIVER.flatY, -121.5), V(195, RIVER.flatY, -121.5), V(195, RIVER.flatY, -121.2), V(-50, RIVER.flatY, -121.2)]);
    rj.speed = 2.4;
    rj.pos.y = RIVER.flatY;
    const walker = this.P({ top: 0xd9a676, bottom: 0x4a5468, hairStyle: 'bun', hair: 0x9a8a80, scale: 0.95 }, 10, -112);
    walker.follow([V(-40, 0, -112.5), V(70, 0, -112.5), V(70, 0, -111.5), V(-40, 0, -111.5)]);
    walker.speed = 0.9;
    // 駅前
    this.P({ top: 0x3b4a5e, bottom: 0x3b3f45, hairStyle: 'short', bag: 0x5b4033 }, 110.2, -58.2, Math.PI, 0.15);
    const wait = this.P({ top: 0x9fcfe8, bottom: 0x4a5468, hairStyle: 'short', hair: 0x3b2a22, glasses: true }, 0, 0);
    sitOn(wait, A.benches.plaza[0]);
    // 飼い主（最後に改札から）
    this.owner = this.P({ name: '', coat: true, top: 0xd9a676, inner: 0xf6efe2, bottom: 0x3f4a5e, bag: 0xf2c14e, hairStyle: 'long', hair: 0x3b2a22, scarf: 0xc9574a, shoes: 0x6b4a3e }, A.gateInside.x + 3, A.gateInside.z, -Math.PI / 2, 0.15);
    this.owner.root.visible = false;
    this.owner.hidden = true;
    this.commuters = [];
    for (let i = 0; i < 4; i++) {
      const c = this.P({ top: [0x3b4a5e, 0xd9d4ca, 0x8a2f35, 0x5b6858][i], bottom: [0x3b3f45, 0x4a5468, 0x3b3f45, 0x2a2f38][i], hairStyle: ['short', 'long', 'bun', 'short'][i], hair: 0x2a2020, bag: [0x5b4033, null, 0xf2e6cf, 0x3b3f45][i] }, A.gateInside.x + 3, -72, -Math.PI / 2, 0.15);
      c.root.visible = false;
      c.hidden = true;
      this.commuters.push(c);
    }
    this.traffic = new Traffic(scene, ROAD, town.signals, town.pools);
    this.train = new Train(scene, TRACK);
    // 庭の枝（だれでも拾えるおみやげ）
    this.addItem('stick', 'りっぱな枝', V(11.6, 0.03, 2.4), 0.7);
  }

  // ------------------------------------------------------------
  // はじまり
  // ------------------------------------------------------------
  start(params) {
    const p = this.player;
    this.params = params;
    this.dogName = params.name || 'うさ';
    p.setParams(params);
    this.applyWear();
    p.place(BED.x, 0.05, BED.z, -Math.PI / 2 - 0.6);
    p.dog.setPose('lie');
    p.dog.setExpr('sleep');
    this.hour = START_HOUR;
    this.state = 'prologue';
    this.flags = {};
    this.ev.reset();
    this.treasure.reset();
    this.town.win.set(0.14);
    this.cam.snap(p);
    this.ui.setName(this.dogName);
    this.ui.events(0, this.ev.total);
    this.run(this.prologue());
  }

  /** その場所（head / face / neck）に つける きせかえ。決めていなければ、いちばん新しく もらった物 */
  wearChoice(slot) {
    const s = this.save, have = s.wear || [];
    const on = s.wearOn || (s.wearOn = {});
    if (on[slot] !== undefined) return on[slot] && have.includes(on[slot]) ? on[slot] : null;
    let k = null;
    for (const u of have) if (WEAR[u] && WEAR[u].slot === slot) k = u;
    return k;
  }
  applyWear() {
    for (const slot of WEAR_SLOTS) {
      const k = this.wearChoice(slot);
      if (k) this.wear(k, true);
    }
  }
  wear(kind, silent = false) {
    const rig = this.player.dog.rig;
    const info = WEAR[kind];
    if (!rig || !info) return;
    if (rig.root.getObjectByName('wear-' + kind)) return;
    // 同じ場所の きせかえは はずす
    for (const k in WEAR) {
      if (k === kind || WEAR[k].slot !== info.slot) continue;
      const old = rig.root.getObjectByName('wear-' + k);
      if (old) { old.parent.remove(old); disposeObject(old); }
    }
    const w = makeWear(kind, kind === 'glasses' ? glassesFit(rig) : null);
    w.name = 'wear-' + kind;
    const d = rig.dims;
    if (info.slot === 'neck') {
      // 首のつけ根に（首輪の輪の半径は 0.14）
      const c = d.collar;
      w.position.set(0, c.y - (kind === 'bell' ? c.r * 0.1 : 0), c.z);
      w.scale.setScalar(c.r / 0.14);
      rig.body.add(w);
    } else if (info.slot === 'head') {
      // 頭の上に（花かんむりの輪の半径は 0.12）
      w.position.set(0, d.crown.y, d.crown.z);
      w.scale.setScalar(d.crown.r / 0.12);
      rig.head.add(w);
    } else {
      // まるメガネ：目の位置から作ってある（頭の中の座標）
      rig.head.add(w);
    }
    if (!silent) this.sparkle(this.player.pos.clone().add(V(0, 0.6, 0)), 20, 0xfff0c0, 2);
  }
  unlockWear(k) {
    const w = this.save.wear || (this.save.wear = []);
    if (!w.includes(k)) w.push(k);
    // もらった物は、次から身につけて出発
    const on = this.save.wearOn || (this.save.wearOn = {});
    if (WEAR[k]) on[WEAR[k].slot] = k;
  }

  *prologue() {
    const p = this.player, cam = this.cam, ui = this.ui;
    p.locked = true;
    ui.letterbox(true);
    ui.hud(false);
    // 寝ている顔のアップ
    const d = p.dog;
    this.post.tilt = 0.5;
    this.post.tiltFocus = 0.52;
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / 7, 0, 1));
      c.position.set(BED.x - 0.9 + k * 0.3, 0.55 + k * 0.25, BED.z + 1.35 - k * 0.2);
      c.lookAt(d.headWorld.x, d.headWorld.y - 0.05, d.headWorld.z);
      if (c.fov !== 40) { c.fov = 40; c.updateProjectionMatrix(); }
      return true;
    });
    ui.fade(0, 1.6);
    yield 1.4;
    ui.caption('「いってきまーす！」', 2.2);
    yield 2.4;
    ui.caption(`「${this.dogName}、6時の電車で帰るからね。おるすばん、おねがいね」`, 3.4);
    audio.play('door');
    yield 3.6;
    ui.caption('…カチャン。', 1.6);
    yield 2.0;
    // 目がさめる
    d.setExpr('happy');
    d.yawn();
    yield 1.4;
    d.setPose('stand');
    d.lookAt = this.A.window.clone().setY(0.6);
    d.lookHold = 2;
    audio.play('whoosh');
    ui.caption('ふわっ…と、風。', 1.8);
    this.curtainPuff = 1.5;
    yield 2.0;
    this.endCine();
    p.locked = false;
    ui.letterbox(false);
    ui.hud(true);
    this.state = 'play';
    ui.objective('まどが すこし あいてる…？');
    ui.hint(this.ctl.touch ? '左をなぞって移動 ／ 右をなぞってカメラ' : 'WASD・矢印で移動 ／ マウスドラッグでカメラ ／ Shift で走る');
  }

  *escapeReveal() {
    const p = this.player, cam = this.cam, ui = this.ui, day = this.day;
    this.flags.escaped = true;
    p.locked = true;
    ui.letterbox(true);
    ui.hud(false);
    ui.objective(null);
    // 電車をちょうど見える所に
    this.train.depart(1);
    this.train.z = -255;
    this.train.v = 21;
    const fog0 = day.fogScale;
    const station = V(128, 7, -66);
    // 犬は窓の外の芝生へ。まっすぐ前（家と反対がわ）を向く
    const dogP = V(7.4, 0, 0.3);
    p.place(dogP.x, 0, dogP.z, Math.PI / 2);
    p.dog.setPose('stand');
    this.post.tilt = 0.8;
    this.post.tiltFocus = 0.45;
    // カメラは いつも家の外（庭がわ x > 5）：犬の横から → 庭の上へ上がり、町と駅を見わたす
    const a = V(dogP.x + 1.6, 0.75, dogP.z + 2.2);
    const b = V(dogP.x + 3.5, 17, dogP.z + 12);
    this.cine((c, dt, t) => {
      day.fogScale = lerp(fog0, 1.9, smooth(clamp(t / 2.5, 0, 1)));
      const k = smooth(clamp(t / 6.5, 0, 1));
      c.position.lerpVectors(a, b, k);
      // 少しだけ弧をえがく（柵や木の上を通る）
      c.position.y += Math.sin(k * Math.PI) * 1.5;
      const look = _v.lerpVectors(V(dogP.x, 0.45, dogP.z), V(station.x, 13, station.z - 10), smooth(clamp((t - 0.6) / 5, 0, 1)));
      c.lookAt(look);
      const fov = lerp(50, 38, k);
      if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
      return true;
    });
    audio.play('whoosh');
    yield 2.2;
    ui.title('駅まで、おむかえに。', '18:00 の電車で、あの人が帰ってくる。', 5.2);
    audio.play('chime');
    yield 5.8;
    // 犬のうしろへ戻る（家の壁より外がわから）
    const back = this.camera.position.clone();
    const size = p.dog.rig.dims.scale;
    const behind = V(Math.max(5.1, p.pos.x - 2.4 * Math.max(1, size * 0.8)), p.pos.y + 1.15 * Math.max(1, size * 0.8), p.pos.z);
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / 1.6, 0, 1));
      day.fogScale = lerp(1.9, fog0, k);
      this.post.tilt = 0.8 * (1 - k);
      c.position.lerpVectors(back, behind, k);
      c.lookAt(_v.lerpVectors(station, V(p.pos.x + 2.5, 0.5, p.pos.z), k));
      c.fov = lerp(38, 55, k); c.updateProjectionMatrix();
      return t < 1.6;
    });
    yield 1.6;
    day.fogScale = fog0;
    this.endCine(Math.PI / 2 + Math.PI, 0.28);
    cam.blend = 1;
    p.locked = false;
    ui.letterbox(false);
    ui.hud(true);
    ui.objective('庭から出る方法を さがそう');
    this.hintT = 0;
    this.flags.needSniffHint = true;
    // 光る印の説明
    this.run(function* () { yield 4; this.ui.toast('光る印は「できごと」。町じゅうに かくれている', 'star'); }.bind(this)());
  }

  *crawl() {
    const p = this.player, ui = this.ui;
    p.locked = true;
    p.puppet = true;
    this.flags.dug = true;
    this.A.digHole.visible = true;
    this.A.digBox.on = false;
    const d = p.dog;
    d.digging = false;
    d.setPose('lie');
    const from = p.pos.clone();
    const to = V(DIG.x, 0, DIG.z + 1.1);
    p.dog.heading = 0;
    let t = 0;
    audio.play('fluff');
    while (t < 1.5) {
      const dt = yield;
      t += dt || 0.016;
      const k = smooth(clamp(t / 1.5, 0, 1));
      p.pos.lerpVectors(from, to, k);
      p.pos.y = 0;
      if (Math.random() < 0.3) this.puff(p.pos, 1, 0x9a7456);
    }
    this.A.digBox.on = true;
    p.puppet = false;
    d.heading = Math.PI / 2;
    this.cam.yaw = Math.PI / 2 + Math.PI;
    this.cam.pitch = 0.32;
    d.setPose('stand');
    d.shaking = true;
    audio.play('fluff');
    this.puff(p.pos, 10, 0xb89a7a);
    yield 0.6;
    d.shaking = false;
    p.locked = false;
    ui.objective('においをたどって 駅へ');
    ui.toast('くんくん（F／くんくん長押し）で、あの人のにおいと「できごと」の光が見える', 'nose');
  }

  // ------------------------------------------------------------
  // 毎フレーム
  // ------------------------------------------------------------
  update(dt) {
    this.t += dt;
    const p = this.player, d = p.dog, ctl = this.ctl, ui = this.ui, F = this.flags;
    this.tickCo(dt);
    // 時間：遊んでいる間だけ進む（演出の間は止まる）。まどを出るまではゆっくり
    if (this.state === 'play' && !p.locked && !this.timelapse) {
      this.hour += dt * HOUR_PER_SEC * (F.escaped ? 1 : 0.5);
    } else if (this.state === 'reunion' || this.state === 'result') {
      this.hour = Math.min(18.6, this.hour + dt / 300);
    }
    if (this.timelapse) this.hour = Math.min(this.timelapse.to, this.hour + dt * this.timelapse.rate);

    // 入力
    const playing = this.state === 'play' && !p.locked;
    if (playing) {
      if (ctl.consume('jump')) {
        if (d.poseTarget === 'sit' || d.poseTarget === 'lie') d.setPose('stand');
        p.jump();
      }
      if (ctl.consume('bark')) this.bark();
      if (ctl.consume('sit')) this.sit();
    } else {
      ctl.consume('jump'); ctl.consume('bark'); ctl.consume('sit');
    }
    const sniffing = playing && ctl.held('sniff') && p.grounded;
    this.sniffK = damp(this.sniffK, sniffing ? 1 : 0, sniffing ? 5 : 3, dt);
    if (sniffing) {
      d.sniff = 0.2;
      if (F.needSniffHint) F.needSniffHint = false;
    }
    p.run = ctl.run && !sniffing;
    const mv = playing ? this.cam.toWorld(ctl.move.x, ctl.move.y, _v) : _v.set(0, 0, 0);
    if (sniffing) mv.multiplyScalar(0.45);
    if (this.autoRun) {
      mv.set(this.autoRun.x - p.pos.x, 0, this.autoRun.z - p.pos.z);
      if (mv.length() > 1) mv.normalize();
      p.run = !this.autoRun.walk;
    }
    if (d.poseTarget === 'sit' && mv.lengthSq() > 0.01) this.sitT = 0;
    p.update(dt, mv);
    // なかま（犬の歩いた道を、うしろから ついてくる）
    this.party.update(dt);
    if (this.carryUpdate) this.carryUpdate(dt);
    else this.pushOut(p);

    // 行動ボタン
    this.updateAction(dt, playing);

    // 住人たち
    const dp = p.pos;
    for (const q of this.people) {
      if (q.hidden) continue;
      const far = q.pos.distanceTo(this.camera.position) > 55;
      q.root.visible = !far;
      if (!far || q.path || q.target) q.update(dt, dp);
    }
    const onRoad = dp.x > Z.road.x0 - 0.2 && dp.x < Z.road.x1 + 0.2 && dp.z < -44 && dp.z > -100;
    const roadDogs = this._roadDogs || (this._roadDogs = []);
    roadDogs.length = 0;
    if (onRoad) roadDogs.push(dp);
    for (const m of this.party.members) {
      const q = m.pos;
      if (q.x > Z.road.x0 - 0.2 && q.x < Z.road.x1 + 0.2 && q.z < -44 && q.z > -100) roadDogs.push(q);
    }
    this.traffic.update(dt, roadDogs);
    this.updateCars(dt, onRoad);
    this.updateCrossingSound();
    // 鳥のさえずり（公園・神社・家のまわり）
    if (this.state === 'play' && (this.area === 'park' || this.area === 'shrine' || !F.dug) && Math.random() < dt * 0.25) audio.play('chirp', 0.7);
    this.updateTrain(dt);
    for (const h of this.hooks.update) h(dt, playing);
    this.updateItems(dt);
    this.updateHints(dt);
    this.ev.update(dt, dp, this.camera, this.sniffK, this.state === 'play' && F.escaped && !this.cineLock);
    this.treasure.update(dt, playing && F.escaped);
    this.fx.update(dt);
    this.dust.update(dt);
    this.motes.update(dt, this.camera, this.day, this.area === 'home' && !F.escaped);
    this.trail.update(dt, this.sniffK, dp);
    this.post.grade.uniforms.uSniff.value = this.sniffK * 0.9;

    // 場所の名前
    if (this.state === 'play' && F.dug) {
      const a = AREAS.find((z) => z.test(dp));
      const id = a ? a.id : null;
      if (id !== this.area) {
        this.area = id;
        if (a && !F['area-' + a.id]) {
          F['area-' + a.id] = true;
          ui.area(a.name, a.sub);
          this.onArea(a.id);
        }
      }
    }
    // 窓
    if (!F.escaped && F.windowOpen && dp.x > ROOM.maxX + 0.35) { F.escaped = true; this.run(this.escapeReveal()); }
    if (this.curtainPuff > 0) this.curtainPuff -= dt;
    // 着地のほこり
    if (!this._landHook) {
      this._landHook = true;
      p.onLand = (imp) => { if (imp > 3) this.puff(p.pos, 5, 0xd9cbb5); };
    }
    // 駅と電車
    if (this.state === 'play') this.checkStation(dt);
    // 環境音：川の音・高台の風・大通りの車
    if (this.state !== 'idle') {
      const nearRiver = dp.z < -100 ? clamp(1 - (Math.abs(dp.z + 140) - 6) / 38, 0, 1) : 0;
      audio.setAmbience({
        river: nearRiver,
        wind: dp.y > 5 ? 1 : this.area === 'river' ? 0.45 : 0.1,
        traffic: clamp(1 - (Math.abs(dp.x - 87) - 6) / 36, 0, 1) * (dp.z < -30 && dp.z > -160 ? 1 : 0.3),
      });
    }
    // HUD
    ui.clock(this.hour, START_HOUR, ARRIVE_HOUR, !!this.timelapse);
    ui.carry(p.carry ? p.carry.label : null);
    ui.sniff(this.sniffK);
    // ヒント
    this.hintT += dt;
    if (F.needSniffHint && this.hintT > 12 && !F.sniffHinted) {
      F.sniffHinted = true;
      ui.toast(this.ctl.touch ? '「くんくん」を長押しすると、においが見える' : 'F を長押しで「くんくん」。においが見える', 'nose');
    }
  }

  pushOut(p) {
    const dp = p.pos;
    for (const q of this.people) {
      if (q.hidden || !q.root.visible) continue;
      const dx = dp.x - q.pos.x, dz = dp.z - q.pos.z;
      const dd = Math.hypot(dx, dz);
      const r = q.kid ? 0.35 : 0.42;
      if (dd < r && dd > 1e-4 && Math.abs(dp.y - q.pos.y) < 1) {
        dp.x = q.pos.x + (dx / dd) * r;
        dp.z = q.pos.z + (dz / dd) * r;
      }
    }
    for (const s of this.solidDogs || []) {
      const dx = dp.x - s.pos.x, dz = dp.z - s.pos.z, dd = Math.hypot(dx, dz);
      if (dd < 0.45 && dd > 1e-4 && Math.abs(dp.y - s.pos.y) < 0.8) { dp.x = s.pos.x + (dx / dd) * 0.45; dp.z = s.pos.z + (dz / dd) * 0.45; }
    }
    // なかまとも重ならない（細い塀の上では押さない：落ちてしまうので）
    const b = p.support;
    if (b && p.pos.y > 0.3 && (b.x1 - b.x0 < 0.5 || b.z1 - b.z0 < 0.5)) return;
    for (const m of this.party.members) {
      const dx = dp.x - m.pos.x, dz = dp.z - m.pos.z, dd = Math.hypot(dx, dz), r = m.radius;
      if (dd < r && dd > 1e-4 && Math.abs(dp.y - m.pos.y) < 0.6) { dp.x = m.pos.x + (dx / dd) * r; dp.z = m.pos.z + (dz / dd) * r; }
    }
  }

  // ------------------------------------------------------------
  // 行動
  // ------------------------------------------------------------
  interactables() {
    const p = this.player, dp = p.pos;
    const list = [];
    const near = (v, r, dy = 0.6) => Math.hypot(v.x - dp.x, v.z - dp.z) < r && Math.abs(v.y - dp.y) < dy;
    // 窓
    if (!this.flags.windowOpen && near(V(ROOM.maxX - 0.2, 0, 0.3), 1.0)) {
      list.push({ id: 'window', label: 'はなでおす', act: () => this.run(this.openWindow()) });
    }
    // 掘る
    if (!this.flags.dug && near(V(DIG.x, 0, DIG.z - 0.45), 0.95)) {
      list.push({ id: 'dig', label: 'ほる', hold: true, dur: 1.6, at: V(DIG.x, 0, DIG.z - 0.7), done: () => this.run(this.crawl()) });
    }
    // できごと（先に登録したものが優先）
    for (const f of this.hooks.interact) {
      const a = f(dp);
      if (a) list.push(a);
    }
    // おたから（くんくんで見つけた所）
    const tr = this.treasure.interact(dp);
    if (tr) list.push(tr);
    // 物
    let best = null, bd = 1.15;
    for (const it of this.items) {
      if (!it.ground || !it.mesh.visible) continue;
      const v = it.mesh.position;
      const dd = Math.hypot(v.x - dp.x, v.z - dp.z);
      if (dd < bd && Math.abs(v.y - dp.y) < 0.6) { bd = dd; best = it; }
    }
    if (best) list.push({ id: 'pick', label: p.carry ? 'とりかえる' : 'くわえる', act: () => this.pick(best) });
    // はなす
    if (p.carry && !this.flags.arrival) list.push({ id: 'drop', label: 'はなす', act: () => this.dropItem() });
    return list;
  }

  updateAction(dt, playing) {
    const ui = this.ui, ctl = this.ctl, d = this.player.dog;
    if (!playing) { ui.action(null); ctl.consume('action'); d.digging = false; return; }
    const list = this.interactables();
    const a = list[0] || null;
    ui.action(a ? a.label : null);
    if (a && a.hold) {
      // 長押し（ほる）。ちがう所へ移ったら、はじめから
      if (this.holdId !== a.id) { this.holdId = a.id; this.digT = 0; }
      const dur = a.dur || 1.6;
      if (ctl.held('action')) {
        d.digging = true;
        // おたからは、その場所のほうを向いて ほる
        const P = this.player.pos;
        if (a.id !== 'dig' && Math.hypot(a.at.x - P.x, a.at.z - P.z) > 0.25) d.heading = dampAngle(d.heading, Math.atan2(a.at.x - P.x, a.at.z - P.z), 8, dt);
        this.digT += dt;
        if (Math.random() < dt * 14) {
          this.puff(V(a.at.x + (Math.random() - 0.5) * 0.3, a.at.y + 0.05, a.at.z + (Math.random() - 0.5) * 0.3), 2, a.dust || 0x8a6446);
          audio.play('dig');
        }
        ui.progress(this.digT / dur);
        if (this.digT >= dur) { d.digging = false; ui.progress(null); this.digT = 0; this.holdId = null; a.done(); }
      } else {
        d.digging = false;
        ui.progress(this.digT > 0 ? this.digT / dur : null);
      }
      ctl.consume('action');
      return;
    }
    d.digging = false;
    this.holdId = null;
    ui.progress(null);
    if (ctl.consume('action') && a) a.act();
  }

  *openWindow() {
    const p = this.player;
    this.flags.windowOpen = true;
    p.dog.sniff = 0.5;
    audio.play('wobble');
    let t = 0;
    while (t < 0.7) {
      const dt = yield;
      t += dt || 0.016;
      this.town.win.set(lerp(0.14, 0.72, smooth(clamp(t / 0.7, 0, 1))));
    }
    this.ui.objective('外へ出てみよう');
  }

  pick(it) {
    const p = this.player;
    if (p.carry) this.dropItem();
    it.ground = false;
    it.found = true;
    p.hold({ id: it.id, label: it.label, mesh: it.mesh, item: it });
    const h = this.hooks.pick.get(it.id);
    if (h && !it.picked) h(it);
    it.picked = true;
  }
  /** 口に物をわたす（もらった物） */
  give(id, label) {
    const it = this.addItem(id, label, this.player.pos.clone(), 0, { hidden: true });
    it.mesh.visible = true;
    const p = this.player;
    if (p.carry) this.dropItem();
    it.ground = false;
    it.picked = true;
    p.hold({ id, label, mesh: it.mesh, item: it });
    return it;
  }
  dropItem() {
    const p = this.player;
    const c = p.drop();
    if (!c) return;
    const it = c.item;
    if (!it) return;
    const f = p.dog.fwd;
    it.mesh.position.set(p.pos.x + f.x * 0.45, p.pos.y + (it.id === 'ball' ? 0.075 : 0.03), p.pos.z + f.z * 0.45);
    it.mesh.rotation.set(0, p.heading, 0);
    this.scene.add(it.mesh);
    it.ground = true;
    audio.play('drop');
  }

  bark() {
    const p = this.player, dp = p.pos;
    p.dog.bark(1 + (Math.random() - 0.5) * 0.1);
    this.party.react('bark');
    let used = false;
    for (const f of this.hooks.bark) if (f(dp)) used = true;
    if (used) return;
    // 人
    for (const q of this.people) {
      if (q.hidden || q.pos.distanceTo(dp) > 3) continue;
      if (q === this.owner) continue;
      if (Math.random() < 0.6) this.say(q, ['あら、わんちゃん', 'おっ、元気だねえ', 'どこの子かな？', 'ひとりでお散歩？'][Math.floor(Math.random() * 4)], 1.8);
      break;
    }
  }

  sit() {
    const p = this.player, d = p.dog, dp = p.pos;
    if (d.poseTarget === 'sit') { d.setPose('stand'); return; }
    d.setPose('sit');
    d.setExpr('happy');
    this.sitT = 0;
    for (const f of this.hooks.sit) if (f(dp)) break;
  }

  updateCars(dt, onRoad) {
    // 車にぶつかりそうなら、ぽよんと押し戻す（けがはしない）
    const dp = this.player.pos;
    if (!onRoad) return;
    for (const c of this.traffic.cars) {
      const hx = c.type.w / 2 + 0.3, hz = c.type.len / 2 + 0.3;
      if (Math.abs(dp.x - c.lane) < hx && Math.abs(dp.z - c.g.position.z) < hz) {
        const side = dp.x < c.lane ? -1 : 1;
        dp.x = c.lane + side * hx;
        this.player.dog.startle(c.g.position.clone().setY(0.5), 2);
        this.cam.shake = 0.6;
      }
    }
  }
  updateCrossingSound() {
    const tr = this.traffic, dp = this.player.pos;
    const nearCross = Math.hypot(dp.x - 87, dp.z + 72) < 26;
    if (tr.pedBeep) { tr.pedBeep = false; if (nearCross && this.state === 'play') audio.play('crossing'); }
  }

  updateTrain(dt) {
    const tr = this.train;
    tr.update(dt, this.player.pos);
    if (this.flags.trainArrived) return;
    this.trainT -= dt;
    if (this.trainT <= 0 && tr.state !== 'run') {
      tr.depart(Math.random() < 0.5 ? 1 : -1);
      this.trainT = 50 + Math.random() * 25;
    } else if (this.trainT <= 0 && Math.abs(tr.z) > 650) {
      tr.state = 'idle';
    }
    if (tr.state === 'run' && (tr.z > 420 || tr.z < -640)) tr.state = 'idle';
  }
  /** すぐに次の電車を走らせる（川の演出用） */
  sendTrain(dir = 1, z = null) {
    const tr = this.train;
    if (this.flags.trainArrived) return;
    tr.depart(dir);
    if (z !== null) tr.z = z;
    this.trainT = 60;
  }

  updateItems(dt) {
    // くんくん中は見つけていない物がきらっと光る
    if (this.sniffK > 0.4 && Math.random() < dt * 10) {
      for (const it of this.items) {
        if (!it.ground || !it.mesh.visible || it.mesh.position.distanceTo(this.player.pos) > 18) continue;
        this.fx.spawn({ pos: it.mesh.position.clone().add(V((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3)), vel: V(0, 0.4, 0), color: 0xfff0b0, size: 0.16, life: 0.8, shape: 2 });
      }
      if (!this.flags.dug && this.flags.escaped) this.fx.spawn({ pos: V(DIG.x + (Math.random() - 0.5) * 0.8, 0.1 + Math.random() * 0.3, DIG.z - 0.45), vel: V(0, 0.5, 0), color: 0xffd28a, size: 0.2, life: 0.9, shape: 0 });
    }
    for (const it of this.items) if (it.ground && (it.id === 'cap' || it.id === 'coin')) it.mesh.rotation.y += dt * 1.2;
  }

  /** 窓と穴ほりの目じるし（チュートリアル）。やることが終わったら消える */
  updateHints(dt) {
    const p = this.player, F = this.flags;
    const active = this.state === 'play' && !p.locked;
    this.markWindow.show(active && !F.windowOpen);
    this.markDig.show(active && F.escaped && !F.dug);
    this.markWindow.update(dt, this.camera.position, p.pos);
    this.markDig.update(dt, this.camera.position, p.pos);
    if (active && !F.windowOpen) {
      F.winHintT = (F.winHintT || 0) + dt;
      if (F.winHintT > 9 && !F.winHinted) { F.winHinted = true; this.ui.toast('光っている窓のすき間を、鼻でおしてみよう', 'nose'); }
    }
    if (active && F.escaped && !F.dug) {
      F.digHintT = (F.digHintT || 0) + dt;
      if (F.digHintT > 7 && !F.digHinted) {
        F.digHinted = true;
        this.ui.toast(this.ctl.touch ? '柵の下の土が やわらかそう。印の所で「ほる」を長押し' : '柵の下の土が やわらかそう。印の所で E を長押し', 'paw');
      }
    }
    const glow = this.town.win.glow;
    const g = !F.windowOpen && (this.state === 'play' || this.state === 'prologue') ? 1 : 0;
    this.gapK = damp(this.gapK || 0, g, g ? 2 : 5, dt);
    glow.material.opacity = this.gapK * (0.75 + 0.25 * Math.sin(this.t * 2.4));
    glow.visible = this.gapK > 0.01;
    if (this.gapK > 0.5 && Math.random() < dt * 7) {
      const z = glow.position.z + (Math.random() - 0.5) * 0.08;
      this.fx.spawn({ pos: V(ROOM.maxX - 0.05, 0.3 + Math.random() * 1.6, z), vel: V(-0.35 - Math.random() * 0.3, (Math.random() - 0.3) * 0.12, (Math.random() - 0.5) * 0.25), color: 0xffe2a8, size: 0.07 + Math.random() * 0.05, life: 2 + Math.random(), drag: 0.25, shape: Math.random() < 0.5 ? 0 : 3, alpha: 0.8 });
    }
  }

  /** 寄り道が終わったら、いまの目標に もどす */
  restoreObjective() {
    const F = this.flags;
    if (F.arrival) return;
    if (F.trainArrived) this.ui.objective('改札へ いそごう！');
    else if (this.area === 'plaza') this.ui.objective(this.hour < 17.9 ? '改札の前で まとう（おすわり）' : '改札へ いそごう！');
    else this.ui.objective('においをたどって 駅へ');
  }

  onArea(id) {
    const ui = this.ui;
    if (id === 'lane') ui.objective('においをたどって 駅へ');
    if (id === 'road') ui.objective('信号が 青になったら わたろう');
    if (id === 'plaza') ui.objective(this.hour < 17.9 ? '改札の前で まとう（おすわり）' : '改札へ いそごう！');
    for (const f of this.hooks.area) f(id);
  }

  // ------------------------------------------------------------
  // 駅：電車の到着と再会
  //   ・早く着いたら：改札の前でおすわり → 時間を早送りして 18:00 まで待つ
  //   ・18:00 になったら：どこにいても電車は着く。あの人は改札の前で待っている
  // ------------------------------------------------------------
  checkStation(dt) {
    const p = this.player, dp = p.pos, g = this.A.gate, F = this.flags;
    const near = Math.hypot(dp.x - g.x, dp.z - g.z);
    const sitting = p.dog.poseTarget === 'sit';
    if (!F.trainArrived) {
      if (this.area === 'plaza' && near < 10 && !F.gateHint) {
        F.gateHint = true;
        if (this.hour < 17.85) this.ui.toast('改札の前で おすわりすると、電車が来るまで待てる（時間がすすむ）', 'star');
      }
      if (this.area === 'plaza' && sitting && near < 9 && !p.locked) this.sitT += dt;
      else this.sitT = 0;
      if (this.sitT > 1.2) { this.sitT = 0; this.run(this.waitForTrain()); return; }
      if (this.hour >= ARRIVE_HOUR && !p.locked) this.run(this.trainArrive());
    } else if (F.ownerWaiting && !p.locked) {
      const O = this.owner;
      if (Math.hypot(dp.x - O.pos.x, dp.z - O.pos.z) < 7.5) { F.ownerWaiting = false; this.run(this.meetLate()); }
    }
  }

  /** 改札の前で 18:00 まで待つ（早送り） */
  *waitForTrain() {
    const p = this.player, ui = this.ui;
    this.lock(true);
    ui.clockFF(true);
    p.dog.setPose('sit');
    ui.objective(null);
    ui.caption('電車を まっている…', 3.0);
    const to = ARRIVE_HOUR - 0.001;
    const dur = 4.2;
    this.timelapse = { to, rate: Math.max(0.05, (to - this.hour) / dur) };
    const c0 = this.camera.position.clone();
    const ang0 = Math.atan2(c0.x - p.pos.x, c0.z - p.pos.z);
    this.post.tilt = 0.6;
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / dur, 0, 1));
      const a = ang0 + k * 1.4;
      c.position.set(p.pos.x + Math.sin(a) * lerp(3, 4.2, k), p.pos.y + lerp(1.2, 1.9, k), p.pos.z + Math.cos(a) * lerp(3, 4.2, k));
      c.lookAt(p.pos.x, p.pos.y + 0.8 + k * 1.2, p.pos.z);
      return true;
    });
    audio.play('tick');
    yield dur + 0.2;
    this.timelapse = null;
    ui.clockFF(false);
    this.hour = Math.max(this.hour, ARRIVE_HOUR);
    yield* this.trainArrive(true);
  }

  /** 18:00 の電車。atGate なら改札の前で再会の演出、ちがえば あの人は改札で待つ */
  *trainArrive(forceGate = false) {
    const F = this.flags;
    if (F.trainArrived) return;
    F.trainArrived = true;
    this.hour = Math.max(this.hour, ARRIVE_HOUR);
    const p = this.player, ui = this.ui, A = this.A, O = this.owner;
    const dp = p.pos;
    const atGate = forceGate || Math.hypot(dp.x - A.gate.x, dp.z - A.gate.z) < 12;
    const tr = this.train;
    tr.depart(1, -34);
    tr.z = -125;
    tr.v = 16;
    if (!atGate) {
      // 遠くにいる：知らせだけ出して、あの人は改札の前で待つ
      ui.toast('18:00 電車がついた！ あの人は改札の前で まっている', 'star');
      audio.play('chime');
      ui.objective('改札へ いそごう！');
      this.run(function* () {
        yield () => tr.state === 'stop';
        yield 2.5;
        this.releaseCommuters();
        yield 1.5;
        O.hidden = false;
        O.root.visible = true;
        O.place(A.gateInside.x + 0.5, -71.6, -Math.PI / 2, 0.15);
        O.speed = 1.1;
        O.walkTo(A.gate.x - 1.0, -72);
        yield () => !O.target;
        O.heading = -Math.PI / 2;
        F.ownerWaiting = true;
        F.ownerReady = true;
      }.bind(this)());
      return;
    }
    this.arrivedAt = this.hour;
    this.state = 'arrival';
    this.lock(true);
    p.dog.setPose('sit');
    ui.objective(null);
    // 広場から、入ってくる電車の先頭を追う
    const look = V(142, 11, tr.z);
    this.post.tilt = 0.4;
    this.post.tiltFocus = 0.5;
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / 7, 0, 1));
      c.position.set(lerp(121, 122.5, k), lerp(9.6, 8.8, k), lerp(-67, -65, k));
      look.x = 142;
      look.y = damp(look.y, 11.4, 2, dt);
      look.z = damp(look.z, tr.z - 9, 3, dt);
      c.lookAt(look);
      if (c.fov !== 42) { c.fov = 42; c.updateProjectionMatrix(); }
      return true;
    });
    yield () => tr.state === 'stop';
    audio.play('chime');
    ui.caption('「ひだまり〜、ひだまり〜」', 2.4);
    yield 2.2;
    this.releaseCommuters();
    // 犬の肩ごしに改札を見る
    this.post.tilt = 0.55;
    this.post.tiltFocus = 0.55;
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / 4, 0, 1));
      const bx = p.pos.x - 1.6, bz = p.pos.z + 1.2;
      c.position.set(bx - k * 0.3, p.pos.y + 0.75, bz);
      c.lookAt(A.gate.x, 1.1, A.gate.z);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
      return true;
    });
    yield 1.6;
    O.hidden = false;
    O.root.visible = true;
    O.place(A.gateInside.x + 0.5, -71.6, -Math.PI / 2, 0.15);
    O.speed = 1.25;
    const oz = clamp(p.pos.z, -75.5, -68.5);
    const ox = p.pos.x < 127 ? 129.4 : Math.min(A.gate.x - 0.3, p.pos.x + 2.2);
    O.walkTo(ox, oz);
    yield () => !O.target;
    yield* this.notice(false);
  }

  releaseCommuters() {
    const A = this.A;
    const out = [V(131, 0.15, -69.5), V(131.2, 0.15, -74.6), V(130.8, 0.15, -71), V(131, 0.15, -73)];
    const exits = [V(112, 0.15, -48), V(118, 0.15, -97), V(97, 0.15, -64), V(112, 0.15, -104)];
    this.commuters.forEach((c, i) => {
      c.hidden = false;
      c.root.visible = true;
      c.place(A.gateInside.x + 1.5 + i * 0.8, [-69.5, -74.6, -76, -70.5][i], -Math.PI / 2, 0.15);
      c.speed = 1.3;
      this.run(function* () { yield i * 0.7; c.walkTo(out[i].x, out[i].z, () => c.walkTo(exits[i].x, exits[i].z, () => { c.root.visible = false; c.hidden = true; })); }.bind(this)());
    });
  }

  /** おそく着いた：待っていたあの人に、かけよる */
  *meetLate() {
    const p = this.player, O = this.owner;
    this.arrivedAt = this.hour;
    this.state = 'arrival';
    this.lock(true);
    this.flags.late = true;
    const mid = V((p.pos.x + O.pos.x) / 2, 0.15, (p.pos.z + O.pos.z) / 2);
    this.cine((c, dt, t) => {
      const a = Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z) + Math.PI / 2;
      c.position.set(mid.x + Math.sin(a) * 4.5, 1.6, mid.z + Math.cos(a) * 4.5);
      c.lookAt(mid.x, 1.0, mid.z);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
      return true;
    });
    yield* this.notice(true);
  }

  /** 気づいて、しゃがんで、かけよる */
  *notice(late) {
    const p = this.player, O = this.owner, ui = this.ui, cam = this.cam;
    O.lookAt = p.pos.clone().setY(p.pos.y + 0.3);
    O.heading = Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
    yield 0.5;
    this.say(O, late ? '…あっ！' : '…え？', 1.4);
    yield 1.4;
    this.say(O, `${this.dogName}！？`, 1.8);
    p.dog.setPose('stand');
    p.dog.bark(1.1);
    p.dog.excite = 1;
    yield 1.2;
    O.pose = 'crouch';
    O.heading = Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
    yield 0.6;
    O.pose = 'hug';
    O.kneel = true;
    // ここだけ自分で走る
    this.endCine(Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z), 0.22);
    ui.letterbox(false);
    ui.hud(true);
    ui.objective('かけよろう！');
    this.state = 'play';
    this.flags.arrival = true;
    p.locked = false;
    this.cineLock = false;
    const t0 = this.t;
    const self = this;
    yield (function () {
      const d = Math.hypot(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
      if (self.t - t0 > 4 && d > 1.4) self.autoRun = O.pos;
      return d < 1.25;
    });
    this.autoRun = null;
    void cam;
    this.run(this.reunion());
  }

  *reunion() {
    const p = this.player, O = this.owner, ui = this.ui, cam = this.cam, d = p.dog;
    this.state = 'reunion';
    p.locked = true;
    p.puppet = true;
    ui.objective(null);
    ui.hud(false);
    ui.letterbox(true);
    this.ev.hideAll();
    audio.play('fanfare');
    const h0 = Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
    O.heading = h0;
    // カメラは夕日の側（駅側）。最後に飼い主がこちらを向くように回る
    const camA = Math.PI / 2 + 0.28;
    const hf = camA - 0.3;
    let turn = (((hf - h0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (turn < 2.4) turn += Math.PI * 2;
    O.kneel = true;
    O.pose = 'hug';
    const arms = (out) => {
      const f = V(Math.sin(O.heading), 0, Math.cos(O.heading));
      const r = V(Math.cos(O.heading), 0, -Math.sin(O.heading));
      return out.set(O.pos.x + f.x * 0.3 - r.x * 0.07, O.pos.y + O.rig.body.position.y * O.root.scale.y - 0.02, O.pos.z + f.z * 0.3 - r.z * 0.07);
    };
    const start = p.pos.clone();
    const tgt = V();
    let t = 0;
    d.hop(2.4);
    audio.play('jump');
    while (t < 0.6) {
      const dt = yield;
      t += dt || 0.016;
      const k = smooth(clamp(t / 0.6, 0, 1));
      arms(tgt);
      p.pos.lerpVectors(start, tgt, k);
      p.pos.y += Math.sin(k * Math.PI) * 0.55;
      d.heading = O.heading + Math.PI;
      d.air = 1;
      d.syncRoot();
    }
    this.hearts(p.pos.clone().add(V(0, 0.5, 0)), 10);
    this.sparkle(p.pos.clone().add(V(0, 0.4, 0)), 18, 0xffe0a0);
    const gift = p.carry ? p.carry.id : 'none';
    this.giftId = GIFTS[gift] ? gift : 'none';
    let ct = 0;
    const self = this;
    // 記念写真では、あの人が カメラのほうへ向きなおる（faceGoal）
    const shot = { add: 0, goal: 0 };
    this.carryUpdate = (dt) => {
      ct += dt;
      if (ct > 0.5) O.kneel = false;
      O.pose = 'hug';
      shot.add = damp(shot.add, shot.goal, 2.6, dt);
      const spin = smooth(clamp((ct - 1.0) / 2.6, 0, 1)) * turn;
      O.heading = h0 + spin + shot.add + Math.sin(ct * 2.2) * 0.05 * (ct > 3.6 ? 1 : 0);
      arms(p.pos);
      d.heading = O.heading - 0.35;
      d.air = 0.75;
      d.excite = 1;
      d.lookAt = ct % 3 < 1.4 && !shot.goal ? O.headWorld(_w).clone() : self.camera.position.clone();
      d.lookHold = 0.2;
      d.setExpr('happy');
      // 記念写真では、カメラのほうを見る
      O.lookAt = shot.goal ? self.camera.position : d.headWorld;
      if (ct < 6.5 && Math.random() < dt * 2) self.hearts(p.pos.clone().add(V((Math.random() - 0.5) * 0.9, 1.2, (Math.random() - 0.5) * 0.9)), 1);
    };
    let orbit = camA - 0.35;
    // なかまは、あの人のまわりに集まって おすわり（写真のころのカメラから見て、左右と前）
    const party = this.party;
    if (party.members.length) {
      const a = orbit + 0.3;
      const fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
      // 縦長の画面では、横に広がりすぎないように
      const w = this.camera.aspect < 1 ? 0.62 : 0.95;
      const slots = [[w, 0.45], [-w, 0.45], [0.3 * w, 1.1]].map(([s, f]) => {
        const v = V(O.pos.x + rx * s + fx * f, O.pos.y, O.pos.z + rz * s + fz * f);
        this.town.col.resolve(v, 0.32, 0.4, 0.3);
        return v;
      });
      party.gather(slots, O.pos);
    }
    this.post.tilt = 0.45;
    this.post.tiltFocus = 0.58;
    cam.startCine((c, dt) => {
      orbit += dt * 0.05;
      const narrow = c.aspect < 1;
      const r = Math.max(2.2, 3.0 - ct * 0.1) * (narrow ? 1.7 : 1);
      c.position.set(O.pos.x + Math.sin(orbit) * r, O.pos.y + 1.58, O.pos.z + Math.cos(orbit) * r);
      c.lookAt(O.pos.x, O.pos.y + (narrow ? 1.22 : 1.3), O.pos.z);
      if (c.fov !== 38) { c.fov = 38; c.updateProjectionMatrix(); }
      return true;
    });
    yield 3.4;
    if (this.flags.late) {
      this.say(O, 'まっててくれたんじゃなくて…さがしに来てくれたの？', 3.0);
      yield 3.2;
    }
    if (this.flags.wet) {
      this.say(O, '…え、なんで ぬれてるの？ ふふ、川で遊んできたの？', 3.0);
      yield 3.2;
    }
    for (const line of this.partyLines()) {
      this.say(O, line, 2.8);
      yield 3.0;
    }
    if (gift !== 'none') {
      this.say(O, 'これ、くれるの？', 1.8);
      yield 2.0;
    }
    this.say(O, GIFTS[this.giftId].line(this.dogName, party.size > 0), 3.4);
    this.sparkle(p.pos.clone().add(V(0, 0.4, 0)), 24, 0xffe0a0);
    yield 3.5;
    if (party.size) {
      this.say(O, 'みんなで いっしょに かえろっか', 2.2);
      yield 1.2;
      // 記念写真：みんなが入るように、少し引いて低い所から
      yield* this.groupShot(O, shot);
    } else {
      this.say(O, 'いっしょに かえろっか', 2.2);
      yield 1.6;
    }
    ui.flash();
    audio.play('shutter');
    this.photo = this.capture();
    yield 1.4;
    this.state = 'result';
    this.finish();
  }

  /** 再会で、なかまのことを話す（多いと長くなるので3つまで） */
  partyLines() {
    const P = this.party, n = P.size, lines = [];
    if (!n) return lines;
    if (n >= 2) lines.push('…えっ、みんなで むかえに来てくれたの！？');
    if (P.has('komugi')) lines.push(n >= 2 ? 'こむぎちゃんまで…！ あとで おじいさんの所に 送っていこうね' : 'あれ、こむぎちゃん？ いっしょに来てくれたの？');
    if (P.has('mike')) lines.push('ねこさんも いっしょ？ ふふ、なかよしに なったんだね');
    if (P.has('chick')) lines.push('カルガモの赤ちゃん…！？ 帰りに、池の お母さんの所へ つれていこうね');
    if (P.has('poppo')) lines.push('…ところで、あたまの上の子は どなた？');
    return lines.slice(0, 3);
  }

  /** 再会の記念写真：あいている向きを さがして、みんなが入る所へカメラを動かす */
  *groupShot(O, shot) {
    const cam = this.camera, col = this.town.col;
    const narrow = cam.aspect < 1;
    const want = narrow ? 5.0 : 3.9, el = 0.17;
    const cx = O.pos.x, cy = O.pos.y + 0.85, cz = O.pos.z;
    const base = Math.atan2(cam.position.x - cx, cam.position.z - cz);
    let best = null;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
      const a = base + da;
      const hit = col.rayDist(cx, cy, cz, Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el), want + 0.5);
      const dist = Math.min(want, hit - 0.35);
      if (!best || dist > best.dist + 0.25) best = { a, dist };
      if (dist >= want - 0.01) { best = { a, dist }; break; }
    }
    const to = V(cx + Math.sin(best.a) * Math.cos(el) * best.dist, cy + Math.sin(el) * best.dist, cz + Math.cos(best.a) * Math.cos(el) * best.dist);
    const look = V(cx, O.pos.y + 0.66, cz);
    // あの人は カメラのほうへ（ほんの少しななめ）、なかまも カメラを見る
    shot.goal = angleDiff(O.heading - shot.add, best.a - 0.12);
    if (this.party.gathering) this.party.gathering.face.copy(to);
    const p0 = cam.position.clone(), q0 = cam.quaternion.clone(), f0 = cam.fov;
    const f1 = narrow ? 52 : 46;
    // カメラの向き（-Z が look のほう）
    const qT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to, look, cam.up));
    this.post.tiltFocus = 0.55;
    this.cine((c, dt, t) => {
      const k = smooth(clamp(t / 1.3, 0, 1));
      c.position.lerpVectors(p0, to, k);
      c.quaternion.copy(q0).slerp(qT, k);
      c.fov = lerp(f0, f1, k);
      c.updateProjectionMatrix();
      // みんなに ピントが合うように、ミニチュア風のぼかしは弱く
      this.post.tilt = lerp(0.45, 0.12, k);
      return true;
    });
    yield 1.9;
    this.say(this.owner, 'はい、チーズ！', 1.2);
    yield 0.9;
  }

  capture() {
    this.ui.hideBubbles(true);
    this.post.render(0);
    let url = null;
    try { url = this.renderer.domElement.toDataURL('image/jpeg', 0.9); } catch (e) { url = null; }
    this.ui.hideBubbles(false);
    return url;
  }

  finish() {
    const s = this.save;
    s.clears = (s.clears || 0) + 1;
    const done = [...this.ev.done];
    s.events = [...new Set([...(s.events || []), ...done])];
    s.friends = [...new Set([...(s.friends || []), ...done.filter((id) => FRIEND_IDS.includes(id))])];
    s.gifts = [...new Set([...(s.gifts || []), this.giftId])];
    const arrive = this.arrivedAt || this.hour;
    if (!s.best || arrive < s.best) s.best = arrive;
    this.result = {
      name: this.dogName, arrive, late: !!this.flags.late, gift: this.giftId, events: done,
      friends: done.filter((id) => FRIEND_IDS.includes(id)), memories: this.ev.memories.slice(),
      photo: this.photo, totalEvents: s.events.length, totalGifts: s.gifts.length, clears: s.clears, fortune: this.fortune || null,
      party: this.party.names(), wet: !!this.flags.wet, darumaPerfect: !!this.flags.darumaPerfect,
      dug: this.treasure.dug, treasureNew: this.treasure.found.slice(), treasureTotal: (s.treasures || []).length,
      totalEventCount: EVENTS.length,
    };
    // きょうの称号
    const tp = pickTitle(this.result, s.titles || []);
    s.titles = tp.earned;
    this.result.title = { id: tp.title.id, name: tp.title.name, sub: tp.title.sub, isNew: tp.isNew, more: tp.more, count: tp.earned.length, total: TITLES.length };
    if (this.onFinish) this.onFinish(this.result);
  }
}
