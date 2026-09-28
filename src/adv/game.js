import * as THREE from 'three';
import { Person, Cat, Crow, Pigeons, Ducks, Traffic, Train, makeItem, makeWear } from './actors.js';
import { PointFX, ScentTrail } from './fx.js';
import { Z, DIG, SCENT, ROAD, TRACK } from './town.js';
import { Dog } from '../dog.js';
import { breedParams } from '../dogModel.js';
import { audio } from '../audio.js';
import { clamp, damp, lerp, smooth, dampAngle, angleDiff } from '../util.js';
import { ROOM, BED } from '../room.js';

export const FRIENDS = [
  { id: 'cat', name: 'ねこのミケ', where: '路地の塀の上', color: '#f2a45a' },
  { id: 'crow', name: 'カラスのクロ', where: '商店街のアーチ', color: '#3b3f4a' },
  { id: 'grandma', name: '魚屋のおばあちゃん', where: 'うおまさ', color: '#e8604c' },
  { id: 'florist', name: '花屋のおねえさん', where: 'はなぞの', color: '#3f8f6a' },
  { id: 'kid', name: 'ボールの男の子', where: 'さくら公園', color: '#f2c23a' },
  { id: 'shiba', name: '柴犬のこむぎ', where: 'さくら公園', color: '#d9843f' },
  { id: 'guard', name: 'みどりのおじさん', where: '駅前通りの横断歩道', color: '#6fae7c' },
  { id: 'pigeons', name: '駅前のハトたち', where: '駅前広場', color: '#9aa0ab' },
];
export const GIFTS = {
  none: { label: 'なし', line: (n) => `…${n}？ むかえに来てくれたの？ ひとりで？`, stamp: 'むかえにきた' },
  stick: { label: 'りっぱな枝', line: () => 'えっ、これ おみやげ？ ふふ、りっぱな枝だね', stamp: '枝をプレゼント' },
  cap: { label: 'ぴかぴかの王冠', line: () => 'きらきら…！ 宝物、見せにきてくれたんだね', stamp: '宝物をみせた' },
  ball: { label: 'だれかのボール', line: () => 'そのボール…だれの？ あとで一緒に返しにいこうね', stamp: 'ボールをくわえてきた' },
  sakura: { label: '桜の枝', line: () => '春を持ってきてくれたの？ ありがとう', stamp: '桜をプレゼント' },
  sunflower: { label: 'ひまわり', line: (n) => `お花…！ ${n}、ありがとう。最高のおかえりだよ`, stamp: 'ひまわりをプレゼント' },
};
export const DETOURS = {
  wall: '塀の上をおさんぽ',
  slide: 'すべり台',
  statue: 'まちあわせの犬とならんだ',
  shrine: 'おやしろにおまいり',
  dash: '商店街を全力ダッシュ',
};

const AREAS = [
  { id: 'lane', name: 'ひだまり二丁目', sub: '路地', test: (p) => p.z >= 5.7 && p.z <= 11.3 && p.x < 48 && p.x > -31 },
  { id: 'street', name: 'ひだまり商店街', sub: '夕方の買いもの', test: (p) => p.x > 38.5 && p.x < 47.5 && p.z < 4.8 && p.z > -49.2 },
  { id: 'park', name: 'さくら公園', sub: '池とすべり台', test: (p) => p.x > 26 && p.x < 79 && p.z < -50 && p.z > -96 },
  { id: 'road', name: '駅前通り', sub: '信号は青で', test: (p) => p.x >= 79 && p.x <= 95 && p.z < -44 && p.z > -100 },
  { id: 'plaza', name: 'ひだまり駅', sub: '18:00 着', test: (p) => p.x > 95 && p.z < -44 && p.z > -100 },
];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const START_HOUR = 16.5;
const ARRIVE_HOUR = 18;
const HOUR_PER_SEC = 1 / 230;   // 1時間半 ≒ 5分45秒（夕方の光の中を歩く）

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, camera, renderer, day, town, player, cam, ctl, post, ui, save
    const { scene, town } = this;
    this.A = town.anchors;
    this.fx = new PointFX(scene, 600, { additive: true, gain: 1.6 });
    this.dust = new PointFX(scene, 300, { additive: false, gain: 1 });
    this.trail = new ScentTrail(scene, SCENT, (x, z) => this.heightAt(x, z));
    this.co = [];
    this.people = [];
    this.buildActors();
    this.buildItems();
    this.state = 'idle';
    this.t = 0;
    this.hour = START_HOUR;
    this.sniffK = 0;
    this.sitT = 0;
    this.digT = 0;
    this.area = null;
    this.flags = {};
    this.friends = new Set();
    this.detours = new Set();
    this.trainT = 20;
    this.actionLabel = null;
    this.hintT = 0;
    this.lastSpeed = 0;
  }

  // ------------------------------------------------------------
  // 住人
  // ------------------------------------------------------------
  buildActors() {
    const { scene, town } = this;
    const A = this.A;
    const P = (o, x, z, h = 0, y = 0) => { const p = new Person(scene, o); p.place(x, z, h, y); this.people.push(p); return p; };
    this.grandma = P({ name: 'おばあちゃん', hair: 0xd8d2cc, hairStyle: 'bun', top: 0x8a7fb0, bottom: 0x5b4a40, apron: 0xf2f0ea, hat: 'kerchief', hatColor: 0xe8604c, skirt: true, scale: 0.92, skin: 0xf2cdb2 }, 40.2, 1.0, Math.PI / 2);
    this.florist = P({ name: '花屋さん', hair: 0x5a3a2a, hairStyle: 'long', top: 0xf6efe2, apron: 0x3f8f6a, bottom: 0x6f7fa8 }, 40.2, -40.2, Math.PI / 2);
    this.butcher = P({ name: '肉屋さん', hairStyle: 'bald', hair: 0x3b2a22, top: 0xffffff, apron: 0xd9d4ca, hat: 'cap', hatColor: 0xffffff, bottom: 0x4a5468 }, 45.9, -6.2, -Math.PI / 2);
    const shopper = (o, pts, sp = 1.0) => { const p = P(o, pts[0].x, pts[0].z); p.follow(pts); p.speed = sp; return p; };
    shopper({ top: 0xe8a0a0, bottom: 0x6f7fa8, bag: 0xf2e6cf, hairStyle: 'long', hair: 0x4a3428 }, [V(41.2, 0, 3), V(41.4, 0, -46), V(44.8, 0, -46), V(44.6, 0, 3)], 0.95);
    shopper({ top: 0x6f8fb0, bottom: 0x3b3f45, hairStyle: 'short', hair: 0x2a2020, glasses: true }, [V(44.5, 0, -44), V(44.2, 0, 2), V(41.6, 0, 2), V(41.8, 0, -44)], 1.1);
    shopper({ top: 0xf2d29b, bottom: 0x7a5a3a, hairStyle: 'bun', hair: 0xd8d2cc, skirt: true, bag: 0x9c6b45, scale: 0.9 }, [V(42, 0, -20), V(42.2, 0, -36), V(44, 0, -36), V(44, 0, -20)], 0.6);
    shopper({ kid: true, top: 0x9fd4b0, bottom: 0x3e6ea8, hat: 'yellow' }, [V(43.6, 0, 4), V(43.4, 0, -12), V(42.4, 0, -12), V(42.6, 0, 4)], 1.3);
    shopper({ top: 0xb58ae0, bottom: 0x4a5468, hairStyle: 'short', hair: 0x6a4330, bag: 0x3e6ea8 }, [V(-20, 0, 7.4), V(36, 0, 7.4), V(36, 0, 9.6), V(-20, 0, 9.6)], 1.0);
    // 公園
    this.kid = P({ name: '男の子', kid: true, top: 0xf6d35a, bottom: 0x3e6ea8, hat: 'yellow' }, 37.2, -62.8, -0.6);
    this.oldman = P({ name: 'おじいさん', hairStyle: 'bald', hair: 0xd8d2cc, top: 0x7a8a6a, bottom: 0x5b5b5b, glasses: true, hat: 'straw' }, 61.1, -68.05, -0.35 + Math.PI);
    this.oldman.pose = 'sit';
    this.oldman.pos.y = 0.0;
    const jog = P({ top: 0xe8604c, bottom: 0x3b3f45, hairStyle: 'short', hat: 'cap', hatColor: 0x3b3f45 }, 52, -70.5);
    const loop = [];
    for (let i = 0; i < 16; i++) { const a = -(i / 16) * Math.PI * 2; loop.push(V(52 + Math.cos(a) * 12.5, 0, -80 + Math.sin(a) * 9.5)); }
    jog.follow(loop);
    jog.speed = 2.6;
    // 横断歩道
    this.guard = P({ name: 'みどりのおじさん', top: 0xf2f0ea, vest: 0xf2c23a, hat: 'cap', hatColor: 0x3f8f6a, bottom: 0x4a5468, flag: true, glasses: true, hair: 0xd8d2cc }, 80.0, -75.9, Math.PI / 2, 0.15);
    // 駅前
    P({ top: 0x3b4a5e, bottom: 0x3b3f45, hairStyle: 'short', bag: 0x5b4033 }, 110.2, -58.2, Math.PI, 0.15);
    P({ top: 0xf2c6a0, bottom: 0x6f7fa8, hairStyle: 'long', hair: 0x6a4330, skirt: true }, 114.4, -58.6, -2.4, 0.15);
    const wait = P({ top: 0x9fcfe8, bottom: 0x4a5468, hairStyle: 'short', hair: 0x3b2a22, glasses: true }, 104, -62.5, 0, 0.15);
    wait.pose = 'sit';
    // 飼い主（最後に改札から）
    this.owner = P({ name: '', coat: true, top: 0xd9a676, inner: 0xf6efe2, bottom: 0x3f4a5e, bag: 0xf2c14e, hairStyle: 'long', hair: 0x3b2a22, scarf: 0xc9574a, shoes: 0x6b4a3e }, A.gateInside.x + 3, A.gateInside.z, -Math.PI / 2, 0.15);
    this.owner.root.visible = false;
    this.owner.hidden = true;
    this.commuters = [];
    for (let i = 0; i < 3; i++) {
      const c = P({ top: [0x3b4a5e, 0xd9d4ca, 0x8a2f35][i], bottom: [0x3b3f45, 0x4a5468, 0x3b3f45][i], hairStyle: ['short', 'long', 'bun'][i], hair: 0x2a2020, bag: [0x5b4033, null, 0xf2e6cf][i] }, A.gateInside.x + 3, -72, -Math.PI / 2, 0.15);
      c.root.visible = false;
      c.hidden = true;
      this.commuters.push(c);
    }
    // 動物
    this.cat = new Cat(scene);
    this.cat.pos.copy(A.catWall);
    this.cat.heading = -Math.PI / 2;
    this.catHome = A.catWall.clone();
    this.crow = new Crow(scene);
    this.crow.pos.copy(A.archTop);
    this.crow.heading = 0;
    this.crowHome = A.archTop.clone();
    this.pigeons = new Pigeons(scene, V(104.5, 0.15, -67.5), 24);
    this.pigeons.onScatter = () => {
      if (!this.friends.has('pigeons')) {
        this.run(function* () { yield 1.2; this.makeFriend('pigeons', 'バサバサッ！ 広場のハトが いっせいに飛んだ'); }.bind(this)());
      }
    };
    this.ducks = new Ducks(scene, A.pondR);
    this.shiba = new Dog(scene);
    this.shiba.setParams({ ...breedParams('shiba', 'こむぎ'), fluff: 0.25 });
    this.shiba.place(60.3, -66.6, Math.PI + 0.3);
    this.shiba.setPose('sit');
    this.shibaState = 'sit';
    this.shibaAdapter = { resolveDog: (d) => { d.pos.y = 0; this.town.col.resolve(d.pos, d.radius, 0.5, 0.3); } };
    this.traffic = new Traffic(scene, ROAD, town.signals, town.pools);
    this.traffic.onHonk = () => {
      if (this.guard.pos.distanceTo(this.player.pos) < 14) this.say(this.guard, 'こらこら、あぶないよー！', 2.2);
    };
    this.train = new Train(scene, TRACK);
    // 静止している人には当たり判定
    this.solid = [this.grandma, this.florist, this.butcher, this.kid, this.guard];
  }

  buildItems() {
    const { scene } = this;
    this.items = [];
    const add = (id, label, x, y, z, ry = 0, hidden = false) => {
      const mesh = makeItem(id);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      scene.add(mesh);
      const it = { id, label, mesh, ground: true, home: V(x, y, z), hidden };
      this.items.push(it);
      return it;
    };
    add('stick', 'りっぱな枝', 11.6, 0.03, 2.4, 0.7);
    add('cap', 'ぴかぴかの王冠', this.A.capWall.x, this.A.capWall.y + 0.02, this.A.capWall.z, 0);
    add('ball', 'だれかのボール', this.A.ballBush.x, 0.11, this.A.ballBush.z, 0, true);
    add('sakura', '桜の枝', 58.9, 0.03, -72.2, 1.2);
  }

  // ------------------------------------------------------------
  // 便利
  // ------------------------------------------------------------
  heightAt(x, z) {
    let best = 0;
    for (const b of this.town.col.near(x, z, 0.3)) {
      if (b.y1 < 0.5 && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 > best) best = b.y1;
    }
    return best;
  }
  run(gen) { this.co.push({ it: gen, wait: 0, until: null }); }
  tickCo(dt) {
    for (let i = this.co.length - 1; i >= 0; i--) {
      const c = this.co[i];
      if (c.wait > 0) { c.wait -= dt; continue; }
      if (c.until && !c.until()) continue;
      c.until = null;
      const r = c.it.next(dt);
      if (r.done) { this.co.splice(i, 1); continue; }
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
  hearts(pos, n = 6) {
    this.fx.burst(pos, n, (i, p) => ({ pos: V(p.x + (Math.random() - 0.5) * 0.4, p.y, p.z + (Math.random() - 0.5) * 0.4), vel: V((Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6), color: 0xff8fa8, size: 0.22 + Math.random() * 0.12, life: 1.6, drag: 1, shape: 1 }));
  }
  puff(pos, n = 8, color = 0xc9b79a) {
    this.dust.burst(pos, n, (i, p) => ({ pos: V(p.x, p.y + 0.05, p.z), vel: V((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6), color, size: 0.3 + Math.random() * 0.2, grow: 1.5, life: 0.7 + Math.random() * 0.4, drag: 3, shape: 0, alpha: 0.55 }));
  }

  makeFriend(id, line) {
    if (this.friends.has(id)) return;
    this.friends.add(id);
    const f = FRIENDS.find((x) => x.id === id);
    audio.play('fanfare');
    const total = new Set([...(this.save.friends || []), ...this.friends]).size;
    const isNew = !(this.save.friends || []).includes(id);
    this.ui.friend(f, this.friends.size, FRIENDS.length, line, isNew, total);
  }
  detour(id) {
    if (this.detours.has(id)) return;
    this.detours.add(id);
    audio.play('sparkle');
    this.ui.toast(`寄り道：${DETOURS[id]}`, 'star');
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
    this.friends.clear();
    this.detours.clear();
    this.town.win.set(0.14);
    this.cam.snap(p);
    this.ui.setName(this.dogName);
    this.run(this.prologue());
  }

  applyWear() {
    const rig = this.player.dog.rig;
    const unlocked = this.save.wear || [];
    if (unlocked.includes('bandana')) this.wear('bandana', true);
    if (unlocked.includes('crown')) this.wear('crown', true);
    void rig;
  }
  wear(kind, silent = false) {
    const rig = this.player.dog.rig;
    if (!rig) return;
    if (rig.root.getObjectByName('wear-' + kind)) return;
    const w = makeWear(kind);
    w.name = 'wear-' + kind;
    const d = rig.dims;
    if (kind === 'bandana') {
      w.position.set(0, d.bodyR * 0.55, d.bodyLen * 0.3);
      w.scale.setScalar(0.9 + d.bodyR * 1.2);
      rig.body.add(w);
    } else {
      w.position.set(0, d.headR * 0.95, -0.02);
      w.scale.setScalar(0.7 + d.headR * 1.4);
      rig.head.add(w);
    }
    if (!silent) this.sparkle(this.player.pos.clone().add(V(0, 0.6, 0)), 20, 0xfff0c0, 2);
  }

  *prologue() {
    const p = this.player, cam = this.cam, ui = this.ui;
    p.locked = true;
    ui.letterbox(true);
    ui.hud(false);
    // 寝ている顔のアップ
    const d = p.dog;
    let t = 0;
    cam.startCine((c, dt) => {
      t += dt;
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
    cam.endCine();
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
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
    let t = 0;
    const from = this.camera.position.clone();
    const station = V(128, 7, -66);
    const dogP = p.pos.clone();
    cam.startCine((c, dt) => {
      t += dt;
      day.fogScale = lerp(fog0, 1.9, smooth(clamp(t / 2.5, 0, 1)));
      const k = smooth(clamp(t / 6.5, 0, 1));
      // 犬の背中 → 空へ持ち上がって町を見わたす
      const a = V(dogP.x - 1.8, dogP.y + 0.7, dogP.z + 0.3);
      const b = V(dogP.x - 7, 16, dogP.z + 13);
      c.position.lerpVectors(t < 0.01 ? from : a, b, k);
      const look = _v.lerpVectors(V(dogP.x + 3, 0.6, dogP.z), V(station.x, 13, station.z), smooth(clamp((t - 0.6) / 5, 0, 1)));
      c.lookAt(look);
      const fov = lerp(50, 38, k);
      if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
      return true;
    });
    audio.play('whoosh');
    yield 1.0;
    // カメラが空へ上がっている間に、犬は庭へ降りておく
    p.place(6.9, 0, 0.4, 0.54);
    yield 1.2;
    ui.title('駅まで、おむかえに。', `18:00 の電車で、あの人が帰ってくる。`, 5.2);
    audio.play('chime');
    yield 5.8;
    // 犬のうしろへ戻る
    const back = this.camera.position.clone();
    t = 0;
    cam.startCine((c, dt) => {
      t += dt;
      const k = smooth(clamp(t / 1.6, 0, 1));
      day.fogScale = lerp(1.9, fog0, k);
      const behind = V(p.pos.x - 1.6, p.pos.y + 1.3, p.pos.z - 2.8);
      c.position.lerpVectors(back, behind, k);
      c.lookAt(_v.lerpVectors(station, V(p.pos.x + 1.5, 0.5, p.pos.z + 2.6), k));
      const fov = lerp(38, 55, k);
      c.fov = fov; c.updateProjectionMatrix();
      return t < 1.6;
    });
    yield 1.6;
    day.fogScale = fog0;
    cam.yaw = 0.54 + Math.PI;
    cam.pitch = 0.3;
    cam.endCine();
    cam.blend = 1;
    p.locked = false;
    ui.letterbox(false);
    ui.hud(true);
    ui.objective('庭から出る方法を さがそう');
    this.hintT = 0;
    this.flags.needSniffHint = true;
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
    ui.toast('くんくんすると、あの人のにおいが光って見える', 'nose');
  }

  // ------------------------------------------------------------
  // 毎フレーム
  // ------------------------------------------------------------
  update(dt) {
    this.t += dt;
    const p = this.player, d = p.dog, ctl = this.ctl, ui = this.ui;
    this.tickCo(dt);
    // 時間
    if (this.state === 'play') {
      const cap = this.flags.arrival ? 18.35 : 17.9;
      this.hour = Math.min(cap, this.hour + dt * HOUR_PER_SEC * (this.flags.escaped ? 1 : 0.35));
    } else if (this.state === 'arrival' || this.state === 'reunion') {
      this.hour = Math.min(18.3, this.hour + dt / 240);
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
      if (this.flags.needSniffHint) this.flags.needSniffHint = false;
    }
    p.run = ctl.run && !sniffing;
    const mv = playing ? this.cam.toWorld(ctl.move.x, ctl.move.y, _v) : _v.set(0, 0, 0);
    if (sniffing) mv.multiplyScalar(0.45);
    if (this.autoRun) {
      mv.set(this.autoRun.x - p.pos.x, 0, this.autoRun.z - p.pos.z);
      if (mv.length() > 1) mv.normalize();
      p.run = true;
    }
    if (d.poseTarget === 'sit' && mv.lengthSq() > 0.01) this.sitT = 0;
    p.update(dt, mv);
    if (this.carryUpdate) this.carryUpdate(dt);
    else this.pushOut(p);

    // 行動ボタン
    this.updateAction(dt, playing);

    // 住人たち
    const dp = p.pos;
    for (const q of this.people) {
      if (q.hidden) continue;
      const far = q.pos.distanceTo(this.camera.position) > 48;
      q.root.visible = !far;
      if (!far || q.path || q.target) q.update(dt, dp);
    }
    this.updateCat(dt);
    this.updateCrow(dt);
    this.pigeons.update(dt, dp, d.speed);
    this.ducks.update(dt, this.t);
    this.updateShiba(dt);
    const onRoad = dp.x > Z.road.x0 - 0.2 && dp.x < Z.road.x1 + 0.2 && dp.z < -44 && dp.z > -100;
    this.traffic.update(dt, dp, onRoad);
    this.updateCars(dt, onRoad);
    this.updateCrossing(dt);
    // 鳥のさえずり（公園と家のまわり）
    if (this.state === 'play' && (this.area === 'park' || !this.flags.dug) && Math.random() < dt * 0.25) audio.play('chirp', 0.7);
    this.updateTrain(dt);
    this.updateItems(dt);
    this.fx.update(dt);
    this.dust.update(dt);
    this.trail.update(dt, this.sniffK, dp);
    this.post.grade.uniforms.uSniff.value = this.sniffK * 0.9;

    // 場所の名前
    if (this.state === 'play' && this.flags.dug) {
      const a = AREAS.find((z) => z.test(dp));
      if (a && a.id !== this.area) {
        this.area = a.id;
        if (!this.flags['area-' + a.id]) {
          this.flags['area-' + a.id] = true;
          ui.area(a.name, a.sub);
          this.onArea(a.id);
        }
      }
    }
    // 窓
    if (!this.flags.escaped && this.flags.windowOpen && dp.x > ROOM.maxX + 0.35) { this.flags.escaped = true; this.run(this.escapeReveal()); }
    if (this.curtainPuff > 0) this.curtainPuff -= dt;
    // 寄り道
    if (this.state === 'play') this.checkDetours(dt);
    // 着地のほこり
    if (!this._landHook) {
      this._landHook = true;
      p.onLand = (imp) => { if (imp > 3) this.puff(p.pos, 5, 0xd9cbb5); };
    }
    // 駅
    if (this.state === 'play' && !this.flags.arrival) this.checkStation(dt);
    // HUD
    ui.clock(this.hour, START_HOUR, ARRIVE_HOUR);
    ui.carry(p.carry ? p.carry.label : null);
    ui.sniff(this.sniffK);
    // ヒント
    this.hintT += dt;
    if (this.flags.needSniffHint && this.hintT > 12 && !this.flags.sniffHinted) {
      this.flags.sniffHinted = true;
      ui.toast(this.ctl.touch ? '「くんくん」を長押しすると、においが見える' : 'F を長押しで「くんくん」。においが見える', 'nose');
    }
    this.lastSpeed = d.speed;
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
    const s = this.shiba.pos;
    const dx = dp.x - s.x, dz = dp.z - s.z, dd = Math.hypot(dx, dz);
    if (dd < 0.45 && dd > 1e-4) { dp.x = s.x + (dx / dd) * 0.45; dp.z = s.z + (dz / dd) * 0.45; }
  }

  // ------------------------------------------------------------
  // 行動
  // ------------------------------------------------------------
  interactables() {
    const p = this.player, dp = p.pos, A = this.A;
    const list = [];
    const near = (v, r, dy = 0.6) => Math.hypot(v.x - dp.x, v.z - dp.z) < r && Math.abs(v.y - dp.y) < dy;
    // 窓
    if (!this.flags.windowOpen && near(V(ROOM.maxX - 0.2, 0, 0.3), 1.0)) {
      list.push({ id: 'window', label: 'はなでおす', act: () => this.run(this.openWindow()) });
    }
    // 掘る
    if (!this.flags.dug && near(V(DIG.x, 0, DIG.z - 0.45), 0.95)) {
      list.push({ id: 'dig', label: 'ほる', hold: true });
    }
    // 物
    if (!p.carry || true) {
      for (const it of this.items) {
        if (!it.ground) continue;
        if (it.hidden && this.sniffK < 0.3 && !it.found) continue;
        const v = it.mesh.position;
        if (near(v, 1.0, 0.5)) {
          list.push({ id: 'pick', label: p.carry ? 'とりかえる' : 'くわえる', act: () => this.pick(it) });
          break;
        }
      }
    }
    // わたす
    if (p.carry) {
      if (p.carry.id === 'ball' && this.kid.pos.distanceTo(dp) < 1.8) list.push({ id: 'give-kid', label: 'わたす', act: () => this.run(this.giveKid()) });
      else if (p.carry.id === 'cap' && Math.hypot(dp.x - 43, dp.z - 5.1) < 5 && !this.flags.crowDone) list.push({ id: 'show-crow', label: 'みせる', act: () => this.run(this.crowTrade()) });
      else if (!this.flags.arrival) list.push({ id: 'drop', label: 'はなす', act: () => this.dropItem() });
    }
    // すべり台
    if (A.slide && Math.hypot(dp.x - A.slide.top.x, dp.z - (A.slide.top.z + 0.2)) < 0.8 && dp.y > 1.3) {
      list.push({ id: 'slide', label: 'すべる', act: () => this.run(this.slide()) });
    }
    return list;
  }

  updateAction(dt, playing) {
    const ui = this.ui, ctl = this.ctl, d = this.player.dog;
    if (!playing) { ui.action(null); ctl.consume('action'); d.digging = false; return; }
    const list = this.interactables();
    const a = list[0] || null;
    ui.action(a ? a.label : null);
    if (a && a.hold) {
      if (ctl.held('action')) {
        d.digging = true;
        this.digT += dt;
        if (Math.random() < dt * 14) {
          this.puff(V(DIG.x + (Math.random() - 0.5) * 0.3, 0.05, DIG.z - 0.7), 2, 0x8a6446);
          audio.play('dig');
        }
        ui.progress(this.digT / 1.6);
        if (this.digT >= 1.6) { d.digging = false; ui.progress(null); this.run(this.crawl()); }
      } else {
        d.digging = false;
        ui.progress(this.digT > 0 ? this.digT / 1.6 : null);
      }
      ctl.consume('action');
      return;
    }
    d.digging = false;
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
    if (it.id === 'cap' && !this.flags.capHint) {
      this.flags.capHint = true;
      this.ui.toast('ぴかぴかの王冠。…カラスが好きそう？', 'star');
    }
    if (it.id === 'ball' && !this.flags.ballHint) {
      this.flags.ballHint = true;
      this.ui.toast('だれかのボールを見つけた', 'star');
    }
  }
  dropItem() {
    const p = this.player;
    const c = p.drop();
    if (!c) return;
    const it = c.item;
    if (!it) return;
    const f = p.dog.fwd;
    it.mesh.position.set(p.pos.x + f.x * 0.45, p.pos.y + 0.03, p.pos.z + f.z * 0.45);
    it.mesh.rotation.set(0, p.heading, 0);
    this.scene.add(it.mesh);
    it.ground = true;
    audio.play('drop');
  }

  bark() {
    const p = this.player, dp = p.pos;
    p.dog.bark(1 + (Math.random() - 0.5) * 0.1);
    // ハト
    if (Math.hypot(dp.x - 104.5, dp.z + 67.5) < 6) for (const b of this.pigeons.birds) if (b.st === 'ground') { b.st = 'fly'; b.air = 0; b.v.set((Math.random() - 0.5) * 3, 5, (Math.random() - 0.5) * 3); }
    if (Math.hypot(dp.x - 104.5, dp.z + 67.5) < 6) { audio.play('flap'); this.pigeons.onScatter(); }
    // ねこ
    const cd = this.cat.pos.distanceTo(dp);
    if (cd < 5 && !this.friends.has('cat') && this.cat.state !== 'run') this.catFlee();
    // カラス
    if (p.carry && p.carry.id === 'cap' && Math.hypot(dp.x - 43, dp.z - 5.1) < 5 && !this.flags.crowDone) this.run(this.crowTrade());
    // 柴犬
    if (this.shiba.pos.distanceTo(dp) < 4.5 && this.shibaState === 'sit' && !this.friends.has('shiba')) this.run(this.shibaTag());
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
    // 魚屋
    if (this.grandma.pos.distanceTo(dp) < 2.6 && !this.friends.has('grandma')) this.run(this.grandmaGift());
    else if (this.florist.pos.distanceTo(dp) < 2.6 && !this.friends.has('florist')) this.run(this.floristGift());
    else if (this.guard.pos.distanceTo(dp) < 4.6 && !this.friends.has('guard') && !this.traffic.pedGreen) this.run(this.guardFriend());
    else if (Math.hypot(dp.x - this.A.shrine.x, dp.z - this.A.shrine.z) < 1.6) {
      this.detour('shrine');
      this.sayAt(V(this.A.shrine.x - 1, 1.4, this.A.shrine.z), '…ちりん。', 1.6);
    }
  }

  // ------------------------------------------------------------
  // 住人とのできごと
  // ------------------------------------------------------------
  *grandmaGift() {
    const g = this.grandma, p = this.player;
    g.lookAt = p.pos;
    this.say(g, 'あらまあ、おすわり上手ねえ', 2.2);
    yield 1.6;
    g.pose = 'give';
    this.say(g, 'はい、にぼし。ないしょよ', 2.4);
    yield 1.0;
    audio.play('chew');
    p.dog.chewing = true;
    this.hearts(p.pos.clone().add(V(0, 0.6, 0)), 5);
    yield 1.2;
    p.dog.chewing = false;
    g.pose = 'stand';
    g.lookAt = null;
    p.boost = 45;
    this.ui.toast('にぼしで 元気100倍！ しばらく足が速くなる', 'bolt');
    this.makeFriend('grandma', 'にぼしをもらった');
  }
  *floristGift() {
    const g = this.florist, p = this.player;
    g.lookAt = p.pos;
    this.say(g, 'いい子ね。だれかのお迎え？', 2.2);
    yield 2.0;
    g.pose = 'give';
    this.say(g, 'じゃあこれ、持っていって。きっと喜ぶよ', 2.8);
    yield 1.2;
    const mesh = makeItem('sunflower');
    const it = { id: 'sunflower', label: 'ひまわり', mesh, ground: false, home: p.pos.clone() };
    this.items.push(it);
    if (p.carry) this.dropItem();
    p.hold({ id: 'sunflower', label: 'ひまわり', mesh, item: it });
    this.sparkle(p.pos.clone().add(V(0, 0.5, 0)), 16, 0xfff0a0);
    yield 0.8;
    g.pose = 'stand';
    g.lookAt = null;
    this.makeFriend('florist', 'ひまわりをもらった');
  }
  *guardFriend() {
    const g = this.guard;
    g.lookAt = this.player.pos;
    this.say(g, 'おっ、ちゃんと待ってて えらいねえ', 2.4);
    yield 2.2;
    this.say(g, '青になったら わたるんだよ', 2.2);
    this.makeFriend('guard', '赤信号で ちゃんと待った');
    yield 2;
    g.lookAt = null;
  }
  *giveKid() {
    const k = this.kid, p = this.player;
    const c = p.drop();
    if (c && c.item) { c.item.mesh.visible = false; c.item.ground = false; }
    k.pose = 'cheer';
    audio.play('ok');
    this.say(k, 'ぼくのボール！ ありがとう！', 2.2);
    yield 1.6;
    k.pose = 'give';
    this.say(k, 'おれいに これあげる！', 2.2);
    yield 1.0;
    this.wear('crown');
    this.unlockWear('crown');
    this.ui.toast('花かんむりを もらった！', 'flower');
    this.makeFriend('kid', 'ボールを届けた');
    yield 1.2;
    k.pose = 'stand';
  }
  *crowTrade() {
    if (this.flags.crowDone || this.flags.crowBusy) return;
    this.flags.crowBusy = true;
    const cr = this.crow, p = this.player;
    audio.play('caw');
    this.sayAt(cr.pos, 'カァ？', 1.2);
    yield 0.6;
    const f = p.dog.fwd;
    const land = V(p.pos.x + f.x * 0.7, p.pos.y, p.pos.z + f.z * 0.7);
    cr.flyTo(land, 1.3, 1.2);
    yield () => !cr.flight;
    const c = p.drop();
    if (c && c.item) {
      c.item.ground = false;
      cr.root.add(c.item.mesh);
      c.item.mesh.position.set(0, 0.3, 0.33);
    }
    audio.play('caw');
    yield 0.5;
    cr.flyTo(this.crowHome, 1.6, 2.2);
    yield () => !cr.flight;
    yield 0.4;
    // お礼を落とす
    this.sayAt(cr.pos, 'カァ！', 1.2);
    const b = makeItem('bandana');
    b.position.copy(cr.pos);
    this.scene.add(b);
    let t = 0;
    const from = cr.pos.clone();
    const to = p.pos.clone().add(V(0, 0.4, 0));
    while (t < 1) {
      const dt = yield;
      t += (dt || 0.016) / 0.9;
      b.position.lerpVectors(from, to, t);
      b.position.y += Math.sin(t * Math.PI) * 1.2;
      b.rotation.y += 0.3;
    }
    this.scene.remove(b);
    this.wear('bandana');
    this.unlockWear('bandana');
    this.ui.toast('赤いバンダナを もらった！', 'star');
    this.flags.crowDone = true;
    this.makeFriend('crow', 'ぴかぴかと バンダナを交換した');
  }
  unlockWear(k) {
    const w = this.save.wear || (this.save.wear = []);
    if (!w.includes(k)) w.push(k);
  }

  catFlee() {
    const c = this.cat;
    c.state = 'run';
    c.sleep = 0;
    audio.play('meow', 1.3);
    this.sayAt(c.pos, 'フーッ！', 1.2);
    c.target = V(14.2, c.pos.y, 5.6);
    c.onArrive = () => {
      c.state = 'loaf';
      this.run(function* () {
        yield 14;
        c.state = 'walk';
        c.target = this.catHome.clone();
        c.onArrive = () => { c.state = 'loaf'; c.sleep = 1; };
      }.bind(this)());
    };
  }
  updateCat(dt) {
    const c = this.cat, p = this.player, dp = p.pos;
    c.update(dt);
    if (this.friends.has('cat') || c.state === 'run') return;
    const dd = Math.hypot(dp.x - c.pos.x, dp.z - c.pos.z);
    c.lookAt = dd < 6 ? dp : null;
    if (dd < 5) c.sleep = damp(c.sleep, 0, 2, dt);
    else c.sleep = damp(c.sleep, 1, 0.5, dt);
    if (dd < 3.2 && p.run && p.dog.speed > 2.5) { this.catFlee(); return; }
    if (dd < 1.5 && dp.y > 1.1) {
      c.state = 'sit';
      audio.play('meow');
      this.sayAt(c.pos, 'にゃ〜', 1.6);
      this.hearts(c.pos.clone().add(V(0, 0.4, 0)), 4);
      this.makeFriend('cat', '塀の上で あいさつした');
    } else if (dd < 2.4 && dp.y < 0.5 && !this.flags.catHint) {
      this.flags.catHint = true;
      this.sayAt(c.pos, '（…塀の上まで来れる？）', 2.4);
    }
  }
  updateCrow(dt) {
    const cr = this.crow;
    cr.update(dt);
    if (!cr.flight && Math.random() < dt * 0.08 && cr.pos.distanceTo(this.player.pos) < 25) audio.play('caw');
    if (!this.flags.crowHint && cr.pos.distanceTo(this.player.pos) < 6 && !cr.flight) {
      this.flags.crowHint = true;
      this.sayAt(cr.pos, 'カァ（ぴかぴか、ほしい…）', 2.6);
    }
  }

  *shibaTag() {
    const s = this.shiba;
    this.shibaState = 'bow';
    s.setPose('bow');
    s.bark(1.25);
    this.sayAt(s.pos, 'わんっ！（おいかけっこ！）', 1.6);
    yield 0.9;
    this.shibaState = 'run';
    s.setPose('stand');
    this.tagT = 0;
    this.ui.objective('こむぎを つかまえろ！');
  }
  updateShiba(dt) {
    const s = this.shiba, p = this.player, dp = p.pos;
    const mv = _w.set(0, 0, 0);
    if (this.shibaState === 'run') {
      this.tagT += dt;
      const dx = s.pos.x - dp.x, dz = s.pos.z - dp.z, dd = Math.hypot(dx, dz);
      // 逃げる。公園のまんなかへ戻ろうとする
      const cx = 55 - s.pos.x, cz = -64 - s.pos.z;
      mv.set(dx / (dd + 0.01) + cx * 0.04 + Math.sin(this.t * 1.7) * 0.5, 0, dz / (dd + 0.01) + cz * 0.04 + Math.cos(this.t * 1.3) * 0.5);
      if (mv.length() > 1) mv.normalize();
      s.speedMul = dd < 3 ? 1.6 : 1.1;
      if (dd < 0.75) {
        this.shibaState = 'caught';
        s.setPose('belly');
        s.setExpr('happy');
        s.bark(1.3);
        this.hearts(s.pos.clone().add(V(0, 0.5, 0)), 6);
        this.ui.objective('においをたどって 駅へ');
        this.makeFriend('shiba', 'おいかけっこで つかまえた');
        this.run(function* () { yield 2.5; this.shibaState = 'home'; s.setPose('stand'); }.bind(this)());
      } else if (this.tagT > 25) {
        this.shibaState = 'home';
        this.ui.objective('においをたどって 駅へ');
        this.sayAt(s.pos, 'わふ（またね）', 1.6);
      }
    } else if (this.shibaState === 'home') {
      const hx = 60.3 - s.pos.x, hz = -66.6 - s.pos.z, hd = Math.hypot(hx, hz);
      if (hd > 0.3) mv.set(hx / hd, 0, hz / hd).multiplyScalar(Math.min(1, hd));
      else { this.shibaState = 'sit'; s.setPose('sit'); s.heading = Math.PI + 0.3; }
      s.speedMul = 1;
    } else {
      // すわって しっぽを振る。近いと見る
      if (s.pos.distanceTo(dp) < 5) { s.lookAt = dp.clone().setY(0.4); s.lookHold = 0.3; s.excite = 0.9; }
    }
    s.update(dt, mv, this.shibaAdapter);
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

  updateCrossing() {
    const tr = this.traffic, dp = this.player.pos;
    const nearCross = Math.hypot(dp.x - 87, dp.z + 72) < 26;
    if (tr.pedBeep) { tr.pedBeep = false; if (nearCross && this.state === 'play') audio.play('crossing'); }
    const g = this.guard;
    const gd = g.pos.distanceTo(dp);
    g.pose = tr.pedGreen && gd < 14 ? 'flag' : 'stand';
    if (tr.pedGreen && gd < 8 && !this.flags.guardSaid && this.state === 'play') {
      this.flags.guardSaid = true;
      this.say(g, 'はい、青だよ。わたっていいよー', 2.2);
    }
    if (!tr.pedGreen) this.flags.guardSaid = false;
    // 赤で横断歩道に入ったら注意
    const onCross = dp.x > 81 && dp.x < 93 && dp.z > -74.5 && dp.z < -69.5;
    if (onCross && !tr.pedGreen && !this.flags.whistled && this.state === 'play') {
      this.flags.whistled = true;
      audio.play('whistle');
      this.say(g, 'ピピーッ！ 赤だよー！', 1.8);
      this.run(function* () { yield 6; this.flags.whistled = false; }.bind(this)());
    }
  }

  updateTrain(dt) {
    const tr = this.train;
    tr.update(dt, this.player.pos);
    if (this.flags.arrival) return;
    this.trainT -= dt;
    if (this.trainT <= 0 && tr.state !== 'run') {
      tr.depart(Math.random() < 0.5 ? 1 : -1);
      this.trainT = 55 + Math.random() * 25;
    } else if (this.trainT <= 0 && Math.abs(tr.z) > 650) {
      tr.state = 'idle';
    }
    if (tr.state === 'run' && (tr.z > 420 || tr.z < -640)) tr.state = 'idle';
  }

  updateItems(dt) {
    // くんくん中は見つけていない物がきらっと光る
    if (this.sniffK > 0.4 && Math.random() < dt * 10) {
      for (const it of this.items) {
        if (!it.ground || it.mesh.position.distanceTo(this.player.pos) > 16) continue;
        this.fx.spawn({ pos: it.mesh.position.clone().add(V((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3)), vel: V(0, 0.4, 0), color: 0xfff0b0, size: 0.16, life: 0.8, shape: 2 });
      }
      if (!this.flags.dug && this.flags.escaped) this.fx.spawn({ pos: V(DIG.x + (Math.random() - 0.5) * 0.8, 0.1 + Math.random() * 0.3, DIG.z - 0.45), vel: V(0, 0.5, 0), color: 0xffd28a, size: 0.2, life: 0.9, shape: 0 });
    }
    // 落ちているボールはゆらゆら
    for (const it of this.items) if (it.ground && it.id === 'cap') it.mesh.rotation.y += dt * 1.2;
  }

  checkDetours(dt) {
    const p = this.player, dp = p.pos, A = this.A;
    if (p.grounded && dp.y > 1.3 && dp.y < 1.6 && p.support && p.support.tag === 'wall' && dp.z > 5 && dp.z < 6) {
      this.wallT = (this.wallT || 0) + dt;
      if (this.wallT > 3) this.detour('wall');
    }
    if (p.grounded && Math.hypot(dp.x - A.statue.x, dp.z - A.statue.z) < 1.1 && dp.y > 1.3) {
      if (!this.detours.has('statue')) {
        this.detour('statue');
        p.dog.setPose('sit');
        this.sayAt(A.statue.clone().add(V(0, 1.4, 0)), '（となりに すわってみた）', 2.2);
      }
    }
    if (this.area === 'street' && p.run && p.dog.speed > 4) {
      this.dashT = (this.dashT || 0) + dt;
      if (this.dashT > 5) this.detour('dash');
    } else if (this.area !== 'street') this.dashT = 0;
  }

  *slide() {
    const p = this.player, S = this.A.slide;
    p.locked = true;
    p.puppet = true;
    p.dog.setPose('sit');
    p.dog.heading = Math.PI;
    audio.play('slide');
    let t = 0;
    const from = V(S.top.x, S.top.y, S.top.z - 0.3);
    while (t < 1) {
      const dt = yield;
      t += (dt || 0.016) / 1.1;
      const k = t * t;
      p.pos.set(from.x, lerp(from.y, 0, k), lerp(from.z, S.bottom.z, k));
      p.dog.syncRoot();
    }
    p.pos.y = 0;
    p.puppet = false;
    p.grounded = true;
    p.dog.setPose('stand');
    p.dog.hop(1.8);
    this.puff(p.pos, 6, 0xe0cba0);
    p.locked = false;
    this.detour('slide');
  }

  onArea(id) {
    const ui = this.ui;
    if (id === 'lane') ui.objective('においをたどって 駅へ');
    if (id === 'street' && !this.flags.streetHint) {
      this.flags.streetHint = true;
      this.run(function* () { yield 2.5; this.say(this.grandma, 'あら、かわいいお客さん', 2); }.bind(this)());
    }
    if (id === 'park') {
      this.run(function* () { yield 3; if (!this.friends.has('kid')) this.say(this.kid, 'ボール、どこいっちゃったんだろう…', 2.6); }.bind(this)());
    }
    if (id === 'road') ui.objective('信号が 青になったら わたろう');
    if (id === 'plaza') ui.objective('改札の前で まとう（おすわり）');
  }

  // ------------------------------------------------------------
  // 駅：電車の到着と再会
  // ------------------------------------------------------------
  checkStation(dt) {
    const p = this.player, dp = p.pos, g = this.A.gate;
    const near = Math.hypot(dp.x - g.x, dp.z - g.z);
    const sitting = p.dog.poseTarget === 'sit';
    if (this.area === 'plaza' && sitting && near < 9) this.sitT += dt;
    else this.sitT = 0;
    if (this.sitT > 1.2 || (this.hour >= 17.89 && near < 10)) {
      this.flags.arrival = true;
      this.run(this.arrival());
    }
  }

  *arrival() {
    const p = this.player, ui = this.ui, cam = this.cam, A = this.A;
    this.state = 'arrival';
    this.arrivedAt = this.hour;
    p.locked = true;
    p.dog.setPose('sit');
    ui.objective(null);
    ui.hud(false);
    ui.letterbox(true);
    // 夕暮れまで早送り
    if (this.hour < 17.95) {
      ui.caption('電車を まっている…', 2.4);
      this.timelapse = { to: 17.97, rate: Math.max(0.3, (17.97 - this.hour) / 3.2) };
      let t = 0;
      const c0 = this.camera.position.clone();
      cam.startCine((c, dt) => {
        t += dt;
        const k = smooth(clamp(t / 3.4, 0, 1));
        c.position.lerpVectors(c0, V(p.pos.x - 3.2, p.pos.y + 1.1, p.pos.z + 2.4), k);
        c.lookAt(p.pos.x + 6, p.pos.y + 1.6 + k * 1.5, p.pos.z - 1.5);
        return true;
      });
      yield 3.4;
      this.timelapse = null;
    }
    this.hour = Math.max(this.hour, 17.97);
    // 電車が入ってくる
    const tr = this.train;
    tr.depart(1, -34);
    tr.z = -125;
    tr.v = 16;
    let t = 0;
    // 広場から、入ってくる電車の先頭を追う
    const look = V(142, 11, tr.z);
    cam.startCine((c, dt) => {
      t += dt;
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
    // 改札から人が出てくる
    const O = this.owner;
    const out = [V(131, 0.15, -69.5), V(131.2, 0.15, -74.6), V(130.8, 0.15, -71)];
    const exits = [V(112, 0.15, -48), V(118, 0.15, -97), V(97, 0.15, -64)];
    this.commuters.forEach((c, i) => {
      c.hidden = false;
      c.root.visible = true;
      c.place(A.gateInside.x + 1.5 + i * 0.8, [-69.5, -74.6, -76][i], -Math.PI / 2, 0.15);
      c.speed = 1.3;
      this.run(function* () { yield i * 0.7; c.walkTo(out[i].x, out[i].z, () => c.walkTo(exits[i].x, exits[i].z, () => { c.root.visible = false; c.hidden = true; })); }.bind(this)());
    });
    // 犬の肩ごしに改札を見る
    t = 0;
    cam.startCine((c, dt) => {
      t += dt;
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
    // 改札を出て、広場に一歩出たところで立ち止まる
    const oz = clamp(p.pos.z, -75.5, -68.5);
    const ox = p.pos.x < 127 ? 129.4 : Math.min(A.gate.x - 0.3, p.pos.x + 2.2);
    O.walkTo(ox, oz);
    yield () => !O.target;
    O.lookAt = p.pos.clone().setY(p.pos.y + 0.3);
    yield 0.5;
    this.say(O, '…え？', 1.4);
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
    cam.endCine();
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    cam.yaw = Math.atan2(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
    cam.pitch = 0.22;
    ui.letterbox(false);
    ui.hud(true);
    ui.objective('かけよろう！');
    this.state = 'play';
    p.locked = false;
    const t0 = this.t;
    const self = this;
    yield (function () {
      const d = Math.hypot(p.pos.x - O.pos.x, p.pos.z - O.pos.z);
      if (self.t - t0 > 4 && d > 1.4) self.autoRun = O.pos; // 自動で駆けよる
      return d < 1.25;
    });
    this.autoRun = null;
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
    // 腕の中の位置（胸の前・少し横向き）
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
    // ぎゅっ → くるっと一回転 → 正面へ
    let ct = 0;
    const self = this;
    this.carryUpdate = (dt) => {
      ct += dt;
      if (ct > 0.5) O.kneel = false;
      O.pose = 'hug';
      const spin = smooth(clamp((ct - 1.0) / 2.6, 0, 1)) * turn;
      O.heading = h0 + spin + Math.sin(ct * 2.2) * 0.05 * (ct > 3.6 ? 1 : 0);
      arms(p.pos);
      // 抱っこ：犬も前を向いて、ほっぺを寄せる
      d.heading = O.heading - 0.35;
      d.air = 0.75;
      d.excite = 1;
      d.lookAt = ct % 3 < 1.4 ? O.headWorld(_w).clone() : self.camera.position.clone();
      d.lookHold = 0.2;
      d.setExpr('happy');
      O.lookAt = d.headWorld;
      if (ct < 6.5 && Math.random() < dt * 2) self.hearts(p.pos.clone().add(V((Math.random() - 0.5) * 0.9, 1.2, (Math.random() - 0.5) * 0.9)), 1);
    };
    // 正面から、ゆっくり回りこむ
    let orbit = camA - 0.35;
    cam.startCine((c, dt) => {
      orbit += dt * 0.05;
      const r = Math.max(2.2, 3.0 - ct * 0.1);
      c.position.set(O.pos.x + Math.sin(orbit) * r, O.pos.y + 1.28, O.pos.z + Math.cos(orbit) * r);
      c.lookAt(O.pos.x, O.pos.y + 1.12, O.pos.z);
      if (c.fov !== 38) { c.fov = 38; c.updateProjectionMatrix(); }
      return true;
    });
    yield 3.4;
    if (gift !== 'none') {
      this.say(O, 'これ、くれるの？', 1.8);
      yield 2.0;
    }
    this.say(O, GIFTS[this.giftId].line(this.dogName), 3.4);
    this.sparkle(p.pos.clone().add(V(0, 0.4, 0)), 24, 0xffe0a0);
    yield 3.5;
    this.say(O, 'いっしょに かえろっか', 2.2);
    yield 1.6;
    // 写真
    ui.flash();
    audio.play('shutter');
    this.photo = this.capture();
    yield 1.4;
    this.state = 'result';
    this.finish();
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
    s.friends = [...new Set([...(s.friends || []), ...this.friends])];
    s.gifts = [...new Set([...(s.gifts || []), this.giftId])];
    s.detours = [...new Set([...(s.detours || []), ...this.detours])];
    const arrive = this.arrivedAt || this.hour;
    if (!s.best || arrive < s.best) s.best = arrive;
    this.result = {
      name: this.dogName, arrive, friends: [...this.friends], gift: this.giftId, detours: [...this.detours],
      photo: this.photo, totalFriends: s.friends.length, totalGifts: s.gifts.length, clears: s.clears,
    };
    if (this.onFinish) this.onFinish(this.result);
  }

  /** 結果画面の後ろで、ふたりで歩いて帰る */
  epilogue(dt) {
    if (!this.carryUpdate) return;
    this.carryUpdate(dt);
  }
}
