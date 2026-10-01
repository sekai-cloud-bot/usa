import * as THREE from 'three';
import { clamp, damp } from '../util.js';
import { audio } from '../audio.js';

// ------------------------------------------------------------
// できごと（寄り道・ともだち・見つけた物・けしき）の一覧と、町の中の目じるし
// ------------------------------------------------------------
export const KINDS = {
  friend: { label: 'ともだち', color: '#ff8fa8', glyph: 'heart' },
  item: { label: 'みつけた', color: '#f6c24a', glyph: 'gift' },
  play: { label: 'よりみち', color: '#6fd3ae', glyph: 'star' },
  view: { label: 'けしき', color: '#a99bff', glyph: 'eye' },
};

export const AREA_NAMES = {
  home: '家と庭', lane: 'ひだまり二丁目', shrine: 'ひだまり神社', street: 'ひだまり商店街', park: 'さくら公園',
  river: 'ひだまり川', road: '駅前通り', plaza: 'ひだまり駅', time: 'いつでも',
};

export const EVENTS = [
  { id: 'sock', kind: 'item', area: 'home', title: 'あの人のくつした', hint: '物干しの下に、なにか落ちている' },
  { id: 'cat', kind: 'friend', area: 'lane', title: 'ねこのミケ', hint: '塀の上のねこ。ゴミ置き場から塀に のぼれそう' },
  { id: 'cap', kind: 'item', area: 'lane', title: 'ぴかぴかの王冠', hint: '塀の上で、なにかが光っている' },
  { id: 'wall', kind: 'play', area: 'lane', title: '塀の上をおさんぽ', hint: '塀の上を、しばらく歩いてみよう' },
  { id: 'coin', kind: 'item', area: 'lane', title: '自販機の下の100円', hint: '自販機の下で、なにかが光っている…？' },
  { id: 'jizo', kind: 'play', area: 'lane', title: 'お地蔵さんに ごあいさつ', hint: 'お地蔵さんの前で おすわり' },
  { id: 'lookout', kind: 'view', area: 'shrine', title: '高台からの ながめ', hint: '神社の奥に、町を見わたせる場所がある' },
  { id: 'bell', kind: 'item', area: 'shrine', title: '神社の鈴と おみくじ', hint: '鈴緒（すずお）を ひっぱってみよう' },
  { id: 'cats', kind: 'friend', area: 'shrine', title: 'ねこの集会', hint: 'ねこたちの輪。走らずに近づいて、おすわり' },
  { id: 'grandma', kind: 'friend', area: 'street', title: '魚屋のおばあちゃん', hint: 'おばあちゃんの前で おすわり' },
  { id: 'florist', kind: 'friend', area: 'street', title: '花屋のおねえさん', hint: '花屋さんの前で おすわり' },
  { id: 'crow', kind: 'friend', area: 'street', title: 'カラスのクロ', hint: 'カラスは、ぴかぴかした物が大好き' },
  { id: 'butcher', kind: 'friend', area: 'street', title: '肉屋のおじさん', hint: '揚げたてコロッケのにおい…。おすわりして待ってみよう' },
  { id: 'lottery', kind: 'play', area: 'street', title: '商店街の福引き', hint: 'ガラガラを まわしてみよう' },
  { id: 'gacha', kind: 'friend', area: 'street', title: 'ガチャの男の子', hint: '100円が たりなくて、こまっているみたい' },
  { id: 'duckling', kind: 'friend', area: 'street', title: 'まいごの カルガモ', hint: 'ピヨピヨ…まいごの ひな。そっと近づいて おすわり' },
  { id: 'kid', kind: 'friend', area: 'park', title: 'ボールの男の子', hint: 'ボールをさがしている。茂みのあたりを くんくん' },
  { id: 'shiba', kind: 'friend', area: 'park', title: '柴犬のこむぎ', hint: '柴犬に「ワン」と あいさつしてみよう' },
  { id: 'slide', kind: 'play', area: 'park', title: 'すべり台', hint: '階段をのぼって、すべってみよう' },
  { id: 'sakura', kind: 'play', area: 'park', title: '桜ふぶき', hint: '大きな桜の木。体あたりしてみよう' },
  { id: 'ducks', kind: 'play', area: 'park', title: '池のカモ', hint: '池のカモに「ワン」' },
  { id: 'river', kind: 'view', area: 'river', title: 'ひだまり川の夕日', hint: '公園の北の路地を ぬけると…' },
  { id: 'harmonica', kind: 'friend', area: 'river', title: 'ハーモニカのおじいさん', hint: '橋の下から、ハーモニカの音がする' },
  { id: 'wade', kind: 'play', area: 'river', title: '川で水あそび', hint: '岸の浅い所なら、入っても だいじょうぶ' },
  { id: 'train', kind: 'view', area: 'river', title: '鉄橋をわたる電車', hint: '河川敷で、電車が鉄橋をわたるのを待とう' },
  { id: 'fireflies', kind: 'view', area: 'river', title: 'ほたる', hint: '日がくれるころ、葦のしげみで おすわり' },
  { id: 'daruma', kind: 'play', area: 'river', title: 'だるまさんが ころんだ', hint: '河川敷の子どもたち。ワンで なかまに いれてもらおう' },
  { id: 'guard', kind: 'friend', area: 'road', title: 'みどりのおじさん', hint: '赤信号のあいだ、おすわりして待とう' },
  { id: 'yakiimo', kind: 'friend', area: 'plaza', title: '焼きいも屋さん', hint: '「い〜しや〜きいも〜」…いいにおい。おすわり' },
  { id: 'pigeons', kind: 'friend', area: 'plaza', title: '駅前のハトたち', hint: 'ハトの群れに、かけこんでみよう' },
  { id: 'statue', kind: 'play', area: 'plaza', title: 'まちあわせの犬', hint: '像の台座に のぼってみよう' },
  { id: 'musician', kind: 'friend', area: 'plaza', title: 'ギターのおにいさん', hint: '歌を聴きながら、ワン！' },
  { id: 'chime', kind: 'view', area: 'time', title: '5時のチャイム', hint: '5時になると町にチャイムが流れる。いっしょに「ワン」' },
];
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
export const FRIEND_IDS = EVENTS.filter((e) => e.kind === 'friend').map((e) => e.id);

// ------------------------------------------------------------
// 目じるしの絵（しずく型のピン・中に種類の絵）
// ------------------------------------------------------------
function glyph(c, kind) {
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#ffffff';
  c.lineWidth = 7;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (kind === 'heart') {
    c.beginPath();
    c.moveTo(0, 22);
    c.bezierCurveTo(-34, -2, -20, -30, 0, -12);
    c.bezierCurveTo(20, -30, 34, -2, 0, 22);
    c.fill();
  } else if (kind === 'gift') {
    c.fillRect(-24, -8, 48, 30);
    c.fillRect(-28, -18, 56, 12);
    c.clearRect(-3, -18, 6, 40);
    c.beginPath(); c.ellipse(-10, -24, 10, 7, -0.5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(10, -24, 10, 7, 0.5, 0, Math.PI * 2); c.stroke();
  } else if (kind === 'star') {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 29, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r + 2);
    }
    c.fill();
  } else if (kind === 'eye') {
    // 山と夕日
    c.beginPath(); c.arc(8, -6, 11, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-30, 22); c.lineTo(-10, -4); c.lineTo(4, 12); c.lineTo(14, 4); c.lineTo(30, 22); c.closePath(); c.fill();
  } else if (kind === 'q') {
    c.font = '800 54px "M PLUS Rounded 1c", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 0, 4);
  }
}
const texCache = new Map();
function pinTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const K = KINDS[kind];
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 168;
  const c = cv.getContext('2d');
  // やわらかい影
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.beginPath(); c.arc(64, 66, 54, 0, Math.PI * 2); c.fill();
  // ピン
  const g = c.createLinearGradient(0, 8, 0, 130);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.08, K.color);
  g.addColorStop(1, K.color);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(40, 104); c.lineTo(88, 104); c.lineTo(64, 160); c.closePath(); c.fill();
  c.beginPath(); c.arc(64, 62, 52, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 5;
  c.beginPath(); c.arc(64, 62, 46, 0, Math.PI * 2); c.stroke();
  c.save();
  c.translate(64, 62);
  glyph(c, K.glyph);
  c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, t);
  return t;
}
let beamTex = null;
function beamTexture() {
  if (beamTex) return beamTex;
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 256;
  const c = cv.getContext('2d');
  const gy = c.createLinearGradient(0, 256, 0, 0);
  gy.addColorStop(0, 'rgba(255,255,255,1)');
  gy.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gy.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gy;
  c.fillRect(0, 0, 32, 256);
  c.globalCompositeOperation = 'destination-in';
  const gx = c.createLinearGradient(0, 0, 32, 0);
  gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.5, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gx;
  c.fillRect(0, 0, 32, 256);
  beamTex = new THREE.CanvasTexture(cv);
  return beamTex;
}

const _v = new THREE.Vector3();
const _q = new THREE.Vector3();

/** 1つのできごとの目じるし：浮かぶピン＋（くんくん中は）空へのびる光の柱 */
class Marker {
  constructor(scene, kind) {
    this.mat = new THREE.SpriteMaterial({ map: pinTexture(kind), transparent: true, depthWrite: false, fog: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 9;
    scene.add(this.sprite);
    const col = new THREE.Color(KINDS[kind].color);
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    const bg = new THREE.PlaneGeometry(1.4, 36);
    bg.translate(0, 18, 0);
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.beam.renderOrder = 8;
    this.beam.frustumCulled = false;
    scene.add(this.beam);
    this.k = 0;
    this.bk = 0;
    this.t = Math.random() * 6;
    this.sprite.visible = this.beam.visible = false;
  }
  update(dt, pos, camera, dogPos, show, sniff) {
    this.t += dt;
    const dCam = camera.position.distanceTo(pos);
    const dDog = Math.hypot(dogPos.x - pos.x, dogPos.z - pos.z);
    // ふだんは近い物だけ。くんくん中は遠くまで（壁ごしにも）
    const near = show && (dDog < 30 || sniff > 0.3);
    this.k = damp(this.k, near ? 1 : 0, near ? 4 : 6, dt);
    this.bk = damp(this.bk, show && sniff > 0.3 && dDog > 3 && dDog < 140 ? 1 : 0, 3, dt);
    const vis = this.k > 0.01;
    this.sprite.visible = vis;
    if (vis) {
      const s = clamp(dCam * 0.055, 0.5, 3.4) * (dDog < 2.5 ? 0.7 : 1);
      const bob = Math.sin(this.t * 2.6) * 0.08 * s;
      this.sprite.position.set(pos.x, pos.y + 0.25 + bob, pos.z);
      this.sprite.scale.set(s * 0.62, s * 0.8, 1);
      const far = sniff > 0.3 ? 1 : clamp((30 - dDog) / 8, 0, 1);
      this.mat.opacity = this.k * far * (dDog < 2.5 ? 0.55 : 1);
      // くんくん中は壁ごしに見える
      this.mat.depthTest = sniff < 0.3;
    }
    const bvis = this.bk > 0.01;
    this.beam.visible = bvis;
    if (bvis) {
      this.beam.position.set(pos.x, pos.y - 0.2, pos.z);
      // 柱はいつもカメラのほうを向く（縦の軸だけ回す）
      this.beam.rotation.y = Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
      this.beamMat.opacity = this.bk * (0.6 + 0.2 * Math.sin(this.t * 3)) * clamp(1.3 - dDog / 140, 0.35, 1);
      // 光の柱も、建物ごしに見える（においで感じている）
      this.beamMat.depthTest = sniff < 0.3;
    }
  }
  hide() { this.sprite.visible = this.beam.visible = false; this.k = this.bk = 0; }
}

/**
 * できごとの進みぐあい・目じるし・思い出の写真。
 * pos(id, v|fn) で目じるしの場所、when(id, fn) で出る条件を決める
 */
export class EventDirector {
  constructor(game) {
    this.game = game;
    this.done = new Set();
    this.noticed = new Set();
    this.posFn = new Map();
    this.whenFn = new Map();
    this.markers = new Map();
    for (const e of EVENTS) this.markers.set(e.id, new Marker(game.scene, e.kind));
    this.memories = [];
    this.total = EVENTS.length;
  }
  pos(id, p) { this.posFn.set(id, p); }
  when(id, fn) { this.whenFn.set(id, fn); }
  isDone(id) { return this.done.has(id); }
  reset() {
    this.done.clear();
    this.noticed.clear();
    this.memories.length = 0;
  }
  where(id) {
    const p = this.posFn.get(id);
    if (!p) return null;
    return typeof p === 'function' ? p(_q) : p;
  }
  available(id) {
    const w = this.whenFn.get(id);
    return !w || w();
  }
  /** できた！ line: カードの一言、photo: 写真を残す、wait: 写真の前に少し待つ（秒） */
  complete(id, line = '', { photo = true, wait = 0.15 } = {}) {
    if (this.done.has(id)) return false;
    this.done.add(id);
    const e = EVENT_BY_ID[id];
    const g = this.game;
    const saved = g.save.events || [];
    const isNew = !saved.includes(id);
    this.markers.get(id).hide();
    const card = (url) => {
      g.ui.memory({ url, kind: e.kind, kindLabel: KINDS[e.kind].label, color: KINDS[e.kind].color, title: e.title, line, isNew, n: this.done.size, total: this.total });
      if (url) this.memories.push({ id, url, title: e.title, kind: e.kind });
    };
    audio.play(e.kind === 'friend' ? 'fanfare' : e.kind === 'view' ? 'memory' : 'sparkle');
    if (photo) g.requestPhoto((url) => card(url), wait);
    else card(null);
    g.ui.events(this.done.size, this.total);
    return true;
  }
  /** 毎フレーム：目じるしの位置と、近づいた時のヒント */
  update(dt, dogPos, camera, sniff, active) {
    for (const e of EVENTS) {
      const m = this.markers.get(e.id);
      if (this.done.has(e.id)) continue;
      const p = this.where(e.id);
      const show = active && !!p && this.available(e.id);
      if (!p) { m.hide(); continue; }
      _v.copy(p);
      m.update(dt, _v, camera, dogPos, show, sniff);
      if (show && !this.noticed.has(e.id) && Math.hypot(dogPos.x - _v.x, dogPos.z - _v.z) < 7 && Math.abs(dogPos.y - _v.y) < 4) {
        this.noticed.add(e.id);
        this.game.ui.toast(e.hint, e.kind === 'friend' ? 'heart' : e.kind === 'item' ? 'gift' : e.kind === 'view' ? 'eye' : 'star');
      }
    }
  }
  hideAll() { for (const m of this.markers.values()) m.hide(); }
  /** まだのできごと（一時停止の地図と一覧用） */
  list() {
    return EVENTS.map((e) => ({ ...e, done: this.done.has(e.id), pos: this.where(e.id) ? this.where(e.id).clone() : null }));
  }
}
