import * as THREE from 'three';
import { riverGroundY } from './town2.js';
import { audio } from '../audio.js';
import { clamp, puffGeometry, smooth } from '../util.js';

// ------------------------------------------------------------
// おたから：町のあちこちに うまっている。
//   くんくんすると「あやしいにおい」の場所が見えて（10m 以内）、ほると出てくる。
//   見つけた たからは「たからばこ」に入る（ずっと残る）。もう持っている物の所からは、おやつ。
//   たからが ふえると、きせかえが もらえる。
// ------------------------------------------------------------
export const TREASURES = [
  // 家と庭
  { id: 'bone', name: 'とっておきの ほね', icon: '🦴', area: 'home', x: 5.6, z: -5.0, line: '…いつ うめたんだっけ？' },
  { id: 'sock2', name: 'もうかたっぽの くつした', icon: '🧦', area: 'home', x: 12.6, z: -0.6, line: 'あの人の くつした、ここにも…' },
  // ひだまり神社
  { id: 'acorn', name: 'つやつや どんぐり', icon: '🌰', area: 'shrine', x: -63.6, z: -14.6, line: 'ご神木の 根もとに ころん' },
  { id: 'gold', name: '金の ほね', icon: '🌟', area: 'shrine', x: -82.0, z: 8.5, line: '拝殿の うら…伝説の 金のほね！', rare: true },
  { id: 'suzu', name: 'ちいさな 鈴', icon: '🔔', area: 'shrine', x: -57.2, z: 18.5, line: 'ちりん…と、土の中で 鳴った' },
  { id: 'fossil', name: 'きょうりゅうの ほね？', icon: '🦕', area: 'shrine', x: -77, z: -20, line: 'すごく 大きい ほね…！？' },
  // さくら公園
  { id: 'marble', name: 'ビー玉', icon: '🔮', area: 'park', x: 33.2, z: -58.6, vy: 0.1, ground: 'sand', line: '砂場の中で、きらっ' },
  { id: 'duck', name: 'アヒルの おもちゃ', icon: '🐤', area: 'park', x: 62.4, z: -85.2, line: 'ぷぴー' },
  { id: 'medal', name: 'うんどう会の メダル', icon: '🏅', area: 'park', x: 31.6, z: -93.0, line: 'いっとうしょう…だれの？' },
  { id: 'yoyo', name: 'ヨーヨー', icon: '🪀', area: 'park', x: 74.4, z: -56, line: 'ひもが からまっている' },
  { id: 'ring', name: 'おもちゃの ゆびわ', icon: '💍', area: 'park', x: 67, z: -91.6, line: 'ガチャの ゆびわ。ぴかぴか' },
  // ひだまり川
  { id: 'shell', name: 'さくら貝', icon: '🐚', area: 'river', x: 48, z: -131.5, line: '川の 水ぎわで 見つけた' },
  { id: 'stone', name: 'まんまるの 石', icon: '🪨', area: 'river', x: 100, z: -131.8, line: 'ころころ、すべすべ' },
  { id: 'coin10', name: 'ギザギザの 10円玉', icon: '🪙', area: 'river', x: 21.6, z: -126, ground: 'dirt', line: 'ふちが ギザギザ。めずらしい？' },
  { id: 'key', name: 'だれかの カギ', icon: '🔑', area: 'river', x: 88.5, z: -122.2, line: '橋の下に、落とし物' },
  { id: 'glass', name: 'シーグラス', icon: '💎', area: 'river', x: -20, z: -131, line: 'まるくなった ガラスのかけら' },
  { id: 'mitt', name: 'かたっぽの てぶくろ', icon: '🧤', area: 'river', x: 138.5, z: -124, line: '鉄橋の下に、ぽつん' },
  { id: 'baseball', name: '野球ボール', icon: '⚾', area: 'river', x: 6, z: -124, line: 'ホームランボール…かも' },
  // ひだまり駅
  { id: 'clover', name: '四つ葉の クローバー', icon: '🍀', area: 'plaza', x: 101.6, z: -88.6, line: '植えこみの 中に、しあわせ' },
  { id: 'bear', name: 'くまの キーホルダー', icon: '🧸', area: 'plaza', x: 121.5, z: -52.5, line: 'だれかの カバンから 落ちた？' },
];
export const TREASURE_BY_ID = Object.fromEntries(TREASURES.map((t) => [t.id, t]));
/** たからの数で もらえる きせかえ */
export const TREASURE_REWARDS = [
  { n: 5, wear: 'hat', icon: '👒', label: 'むぎわらぼうし' },
  { n: 10, wear: 'glasses', icon: '👓', label: 'まるメガネ' },
  { n: 15, wear: 'bowtie', icon: '🎀', label: 'ちょうネクタイ' },
  { n: 20, wear: 'goldcrown', icon: '👑', label: '金の王冠' },
];
// もう持っている たからの所から出てくる おやつ
const SNACKS = [
  { icon: '🍖', name: 'ほねつき ジャーキー' },
  { icon: '🍪', name: 'わんこクッキー' },
  { icon: '🍠', name: 'ほしいも' },
];
const DIRT = { soil: 0x7a5638, sand: 0xd8c39a, dirt: 0xa9805a, gravel: 0x9a8c78, pebble: 0x8c8274 };

// 絵文字のアイコン（ほり出した時に うかぶ）。絵文字が出ない環境では星
const iconCache = new Map();
export function iconTexture(icon) {
  if (iconCache.has(icon)) return iconCache.get(icon);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const glow = c.createRadialGradient(64, 64, 0, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
  glow.addColorStop(0.55, 'rgba(255, 220, 140, 0.45)');
  glow.addColorStop(1, 'rgba(255, 210, 120, 0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, 128, 128);
  c.font = '76px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(icon, 64, 68);
  // 色がついたか（絵文字が描けたか）
  const px = c.getImageData(40, 40, 48, 48).data;
  let colored = 0;
  for (let i = 0; i < px.length; i += 16) if (Math.abs(px[i] - px[i + 2]) > 40 || Math.abs(px[i + 1] - px[i + 2]) > 60) colored++;
  if (colored < 12) {
    c.fillStyle = '#f2a445';
    c.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 16 : 36, a = (i / 10) * Math.PI * 2 - Math.PI / 2; c.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); }
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(icon, t);
  return t;
}

let holeTex = null;
function holeTexture() {
  if (holeTex) return holeTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 34, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(30, 18, 10, 0.95)');
  g.addColorStop(0.45, 'rgba(48, 30, 18, 0.85)');
  g.addColorStop(0.75, 'rgba(90, 62, 40, 0.45)');
  g.addColorStop(1, 'rgba(110, 80, 52, 0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  holeTex = new THREE.CanvasTexture(cv);
  holeTex.colorSpace = THREE.SRGBColorSpace;
  return holeTex;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class Treasures {
  constructor(game) {
    this.g = game;
    const col = game.town.col;
    this.spots = TREASURES.map((t, i) => {
      const y = col.groundAt(t.x, t.z, 0.3, (t.area === 'shrine' ? 7.5 : t.area === 'river' ? -2.6 : t.area === 'plaza' ? 0.6 : 0) + 0.3, 0.35);
      const ground = t.ground || (t.area === 'shrine' ? 'gravel' : t.area === 'river' ? (t.z < -131 ? 'pebble' : 'soil') : 'soil');
      // 河川敷の地面は、見た目だけ ゆるく波うっている
      const vy = t.vy ?? (t.area === 'river' ? riverGroundY(t.x, t.z) : y);
      return { t, i, pos: new THREE.Vector3(t.x, y, t.z), vy, ground, state: 'hidden', k: 0, wispT: Math.random() };
    });
    // もりあがった土（あやしい所）と、ほったあとの穴：まとめて2命令
    const n = this.spots.length;
    const moundGeo = puffGeometry(0.2, 1, 0.22, 7);
    moundGeo.scale(1.25, 0.32, 1.0);
    this.mound = new THREE.InstancedMesh(moundGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), n);
    // 穴：まん中が濃く、ふちは土になじむ
    const holeGeo = new THREE.PlaneGeometry(0.42, 0.42);
    holeGeo.rotateX(-Math.PI / 2);
    this.hole = new THREE.InstancedMesh(holeGeo, new THREE.MeshBasicMaterial({ map: holeTexture(), color: 0xffffff, transparent: true, depthWrite: false }), n);
    this.hole.renderOrder = 2;
    this.mound.receiveShadow = true;
    this.mound.castShadow = false;
    this.mound.frustumCulled = this.hole.frustumCulled = false;
    const c = new THREE.Color();
    for (const s of this.spots) this.mound.setColorAt(s.i, c.setHex(DIRT[s.ground]));
    game.scene.add(this.mound, this.hole);
    this.nudged = false;
    this.reset();
  }

  get collected() { return this.g.save.treasures || (this.g.save.treasures = []); }

  /** 出発のたびに：ぜんぶ うまった状態に */
  reset() {
    for (const s of this.spots) { s.state = 'hidden'; s.k = 0; }
    this.found = [];      // この回で はじめて見つけた たから
    this.dug = 0;         // この回で ほった数（おやつも）
    this.busy = false;
    this.nudgeT = 0;
    this.layout();
  }
  /** 土の山と穴の形をそろえる */
  layout() {
    for (const s of this.spots) {
      const k = s.state === 'hidden' ? 0 : s.state === 'dug' ? 0.7 : s.k;
      // 穴をほったら、土の山は 横に よける
      const off = s.state === 'dug' ? 0.32 : 0;
      _e.set(0, s.i * 1.7, 0);
      _q.setFromEuler(_e);
      _s.set(k, k * (s.state === 'dug' ? 0.8 : 1), k);
      _v.set(s.pos.x + off, s.vy + 0.01, s.pos.z - off * 0.4);
      this.mound.setMatrixAt(s.i, _m.compose(_v, _q, _s));
      const h = s.state === 'dug' ? 1 : 0;
      _s.set(h, h, h * 0.8);
      _v.set(s.pos.x, s.vy + 0.012, s.pos.z);
      this.hole.setMatrixAt(s.i, _m.compose(_v, _q, _s));
    }
    this.mound.instanceMatrix.needsUpdate = true;
    this.hole.instanceMatrix.needsUpdate = true;
    if (this.mound.instanceColor) this.mound.instanceColor.needsUpdate = true;
  }

  update(dt, playing) {
    const g = this.g, dp = g.player.pos, sniff = g.sniffK;
    let changed = false;
    for (const s of this.spots) {
      if (s.state === 'dug') continue;
      const d = Math.hypot(s.pos.x - dp.x, s.pos.z - dp.z), dy = Math.abs(s.pos.y - dp.y);
      // くんくんで、近くの あやしい所が見える
      if (s.state === 'hidden' && playing && sniff > 0.35 && d < 10 && dy < 3) {
        s.state = 'smell';
        audio.play('sniffhit');
        g.fx.burst(_v.set(s.pos.x, s.vy + 0.2, s.pos.z), 10, (i, p) => ({ pos: p.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8), color: 0xd6f59a, size: 0.14, life: 1.0, drag: 1.5, shape: 0 }));
      }
      if (s.state === 'smell') {
        if (s.k < 1) { s.k = Math.min(1, s.k + dt * 3); changed = true; }
        // におい（くんくん中は強く）
        s.wispT -= dt * (sniff > 0.3 ? 3 : 1);
        if (s.wispT <= 0 && d < 26) {
          s.wispT = 0.35 + Math.random() * 0.3;
          const a = Math.random() * Math.PI * 2;
          g.fx.spawn({ pos: _v.set(s.pos.x + Math.cos(a) * 0.15, s.vy + 0.08, s.pos.z + Math.sin(a) * 0.15), vel: new THREE.Vector3(-Math.sin(a) * 0.25, 0.55 + Math.random() * 0.3, Math.cos(a) * 0.25), color: 0xd6f59a, size: 0.12 + Math.random() * 0.06, life: 1.3, drag: 0.6, shape: Math.random() < 0.3 ? 2 : 0, alpha: 0.85 });
        }
      }
      // くんくん していなくても、すぐそばを通ると 鼻が ぴくっ
      if (s.state === 'hidden' && playing && d < 2.4 && dy < 1) {
        this.nudgeT -= dt;
        if (this.nudgeT <= 0) {
          this.nudgeT = 4;
          g.player.dog.sniff = 0.5;
          g.fx.spawn({ pos: g.player.dog.headWorld.clone().add(_v.set(0, 0.25, 0)), vel: new THREE.Vector3(0, 0.4, 0), color: 0xd6f59a, size: 0.18, life: 0.9, shape: 2 });
          if (!this.nudged) {
            this.nudged = true;
            g.ui.toast(g.ctl.touch ? 'なにか におう…？「くんくん」長押しで さがそう' : 'なにか におう…？ F 長押しで くんくん', 'nose');
          }
        }
      }
    }
    if (changed) this.layout();
  }

  /** そばの「あやしい所」：ほる（長押し） */
  interact(dp) {
    if (this.busy) return null;
    let best = null, bd = 1.0;
    for (const s of this.spots) {
      if (s.state !== 'smell') continue;
      const d = Math.hypot(s.pos.x - dp.x, s.pos.z - dp.z);
      if (d < bd && Math.abs(s.pos.y - dp.y) < 0.6) { bd = d; best = s; }
    }
    if (!best) return null;
    return {
      id: 'treasure-' + best.t.id, label: 'ほる', hold: true, dur: 0.9, at: best.pos, dust: DIRT[best.ground],
      done: () => this.g.run(this.unearth(best)),
    };
  }

  *unearth(s) {
    const g = this.g, p = g.player, d = p.dog;
    this.busy = true;
    s.state = 'dug';
    this.dug++;
    this.layout();
    const have = this.collected;
    const isNew = !have.includes(s.t.id);
    const snack = SNACKS[Math.floor(Math.random() * SNACKS.length)];
    const icon = isNew ? s.t.icon : snack.icon;
    p.locked = true;
    g.puff(s.pos, 10, DIRT[s.ground]);
    audio.play('pop');
    // ぽんっと うかぶ
    const mat = new THREE.SpriteMaterial({ map: iconTexture(icon), transparent: true, depthWrite: false, toneMapped: false });
    const spr = new THREE.Sprite(mat);
    spr.renderOrder = 9;
    g.scene.add(spr);
    const base = new THREE.Vector3(s.pos.x, s.vy + 0.05, s.pos.z);
    let t = 0;
    const size = 0.42 * Math.max(1, d.rig.dims.scale * 0.8);
    while (t < 1.1) {
      const dt = yield;
      t += dt || 0.016;
      const k = clamp(t / 0.55, 0, 1);
      spr.position.copy(base).add(_v.set(0, smooth(k) * 0.75 + Math.sin(t * 5) * 0.03 * k, 0));
      // くるっと（横はばで まわっているように見せる）
      spr.scale.set(size * (0.3 + 0.7 * k) * Math.cos(Math.min(1, t / 0.7) * Math.PI * 2), size * (0.3 + 0.7 * k), 1);
      d.lookAt = spr.position;
      d.lookHold = 0.2;
    }
    audio.play(isNew ? (s.t.rare ? 'fanfare' : 'treasure') : 'grab');
    g.sparkle(spr.position.clone(), s.t.rare && isNew ? 30 : 16, s.t.rare && isNew ? 0xfff0a0 : 0xffe6a8, 2);
    // 犬のほうへ すいこまれる
    const from = spr.position.clone();
    t = 0;
    while (t < 0.35) {
      const dt = yield;
      t += dt || 0.016;
      const k = smooth(clamp(t / 0.35, 0, 1));
      spr.position.lerpVectors(from, d.headWorld, k);
      spr.scale.setScalar(size * (1 - k * 0.8));
    }
    g.scene.remove(spr);
    mat.dispose();
    p.locked = false;
    d.excite = 1;
    if (isNew) {
      have.push(s.t.id);
      this.found.push(s.t.id);
      d.hop(1.4);
      g.ui.memory({ icon, kind: 'treasure', kindLabel: s.t.rare ? 'おたから（でんせつ）' : 'おたから', color: s.t.rare ? '#e0a200' : '#c98a3a', title: s.t.name, line: s.t.line, isNew: true, count: `たからばこ ${have.length} / ${TREASURES.length}` });
      this.reward(have.length);
    } else {
      // もう持っている：おやつ（少しのあいだ足が速くなる）
      audio.play('chew');
      d.chewing = true;
      g.hearts(p.pos.clone().add(_v.set(0, 0.6, 0)), 4);
      g.ui.toast(`${snack.name}が うまってた！ もぐもぐ…元気が出た`, 'bolt');
      p.boost = Math.max(p.boost, 12);
      yield 1.0;
      d.chewing = false;
    }
    this.busy = false;
  }

  /** たからの数が ふえたら、きせかえの ごほうび */
  reward(n) {
    const r = TREASURE_REWARDS.find((x) => x.n === n);
    if (!r) return;
    const g = this.g;
    g.run(function* () {
      yield 1.2;
      g.unlockWear(r.wear);
      g.wear(r.wear);
      audio.play('fanfare');
      g.confetti(g.player.pos.clone().add(_v.set(0, 0.8, 0)), 30);
      g.ui.memory({ icon: r.icon, kind: 'reward', kindLabel: 'たからばこの ごほうび', color: '#e8744f', title: r.label, line: `たからを ${n}こ 見つけた！ ${r.label}を もらった`, isNew: true, count: 'きせかえは「うちの子をえらぶ」で かえられる' });
    }());
  }

  /** 一時停止の地図用：見つけた所（この回） */
  marks() {
    return this.spots.filter((s) => s.state !== 'hidden').map((s) => ({ x: s.pos.x, z: s.pos.z, dug: s.state === 'dug' }));
  }
}
