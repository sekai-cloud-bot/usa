import * as THREE from 'three';
import { makePigeon, waddle } from './actors.js';
import { RIVER } from './town2.js';
import { audio } from '../audio.js';
import { clamp, damp, dampAngle, lerp } from '../util.js';

// ------------------------------------------------------------
// なかま：友だちになった動物が、駅まで いっしょに来てくれる。
//   犬の歩いた道（足あと）を記録して、なかまは その道を少しうしろから たどる。
//   ・道をたどるので、壁をすりぬけたり、せまい所で引っかかったりしない
//   ・犬が引き返してきたら、道の「輪」を ショートカットする
//   ・犬が止まると止まって、しばらくすると おすわり（犬がおすわりすると いっしょに）
//   ハトは犬の頭の上に乗る（rider）
// ------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** from から to へ なめらかに。ただし 1フレームで maxSp*dt より先へは行かない */
function approach(from, to, maxSp, dt, out, lam = 14) {
  out.set(damp(from.x, to.x, lam, dt), damp(from.y, to.y, lam * 1.5, dt), damp(from.z, to.z, lam, dt));
  const dx = out.x - from.x, dz = out.z - from.z, l = Math.hypot(dx, dz), cap = maxSp * dt;
  if (l > cap) { out.x = from.x + (dx / l) * cap; out.z = from.z + (dz / l) * cap; }
  return out;
}

export class Party {
  constructor(game) {
    this.g = game;
    this.trail = [];        // { x, y, z, s }（s はそこまでの道のり）
    this.members = [];      // うしろを歩く子（近い順）
    this.riders = [];       // 頭の上に乗る子
    this.stillT = 0;
    this.gathering = null;  // 再会の時の並び
  }

  get size() { return this.members.length + this.riders.length; }
  all() { return this.members.concat(this.riders); }
  has(id) { return this.all().some((m) => m.id === id); }
  get(id) { return this.all().find((m) => m.id === id) || null; }
  names() { return this.all().map((m) => m.name); }

  /** なかまに入れる。犬の道のうち、いちばん近い所から合流する */
  join(m) {
    if (this.has(m.id)) return false;
    m.party = this;
    if (m.rider) this.riders.push(m);
    else {
      if (!this.trail.length) this.reset(this.g.player.pos);
      m.s = this.nearestS(m.pos);
      m.v = 0;
      this.members.push(m);
      this.members.sort((a, b) => a.order - b.order);
    }
    if (m.onJoin) m.onJoin();
    return true;
  }
  leave(id) {
    for (const L of [this.members, this.riders]) {
      const i = L.findIndex((m) => m.id === id);
      if (i < 0) continue;
      const m = L[i];
      L.splice(i, 1);
      m.party = null;
      if (m.onLeave) m.onLeave();
      return m;
    }
    return null;
  }

  // ---- 犬の道 ----
  reset(p) {
    this.trail.length = 0;
    this.trail.push({ x: p.x, y: p.y, z: p.z, s: 0 });
  }
  get total() { const t = this.trail; return t.length ? t[t.length - 1].s : 0; }
  /** 道のり s より手前で いちばん近い点の番号 */
  index(s) {
    const t = this.trail;
    let lo = 0, hi = t.length - 1;
    if (hi <= 0 || s <= t[0].s) return 0;
    if (s >= t[hi].s) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid].s <= s) lo = mid; else hi = mid; }
    return lo;
  }
  /** 道のり s の場所 */
  at(s, out) {
    const t = this.trail;
    if (!t.length) return out.copy(this.g.player.pos);
    const i = this.index(s);
    const a = t[i], b = t[Math.min(i + 1, t.length - 1)];
    const k = b === a ? 0 : clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    return out.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
  }
  /** pos にいちばん近い道の点（fromS より先だけを さがすこともできる） */
  nearestS(pos, fromS = -Infinity) {
    let best = Infinity, bs = this.total;
    for (const q of this.trail) {
      if (q.s < fromS) continue;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z) + Math.abs(q.y - pos.y) * 0.5;
      if (d < best) { best = d; bs = q.s; }
    }
    return bs;
  }
  record(p) {
    const t = this.trail;
    if (!t.length) { this.reset(p); return; }
    const L = t[t.length - 1];
    const dh = Math.hypot(p.x - L.x, p.z - L.z), dy = p.y - L.y;
    // 演出などで犬が遠くへ移った：なかまも犬のうしろへ
    if (dh > 2.5) { this.teleport(p); return; }
    const d = Math.hypot(dh, dy);
    if (d < 0.1) return;
    t.push({ x: p.x, y: p.y, z: p.z, s: L.s + d });
    // いちばんうしろの子より前の道は いらない（まとめて捨てる）
    let minS = L.s + d - 90;
    for (const m of this.members) minS = Math.min(minS, m.s - 2);
    let cut = 0;
    while (cut < t.length - 2 && t[cut + 1].s < minS) cut++;
    if (cut > 64) t.splice(0, cut);
  }
  teleport(p) {
    const f = this.g.player.dog.fwd;
    this.reset(p);
    let k = 0;
    for (const m of this.members) {
      k += m.gap;
      _a.set(p.x - f.x * k, p.y, p.z - f.z * k);
      this.g.town.col.resolve(_a, m.radius * 0.8, 0.4, 0.3);
      m.place(_a);
      m.s = 0;
      m.v = 0;
      this.g.puff(_a, 4, 0xd9cbb5);
    }
  }
  /** 犬が引き返してきた：道の「輪」をとばす */
  cutLoops(m, sT) {
    const t = this.trail;
    const i0 = this.index(m.s + 1.2), i1 = this.index(sT);
    for (let j = i1; j > i0; j--) {
      const q = t[j];
      if (Math.abs(q.x - m.pos.x) < 0.5 && Math.abs(q.z - m.pos.z) < 0.5 && Math.abs(q.y - m.pos.y) < 0.3) { m.s = q.s; return; }
    }
  }
  tooClose(m, q, other, min) {
    const dn = hdist(q, other);
    return dn < min && dn < hdist(m.pos, other) && Math.abs(q.y - other.y) < 1.0;
  }
  /** 入れない所（ねこは水に入らない）：その先の入れる所まで とばす。なければ待つ */
  skipAvoid(m, s2, sT) {
    const t = this.trail;
    for (let j = this.index(s2) + 1; j < t.length && t[j].s <= sT; j++) {
      if (!m.avoid(t[j])) return t[j].s;
    }
    m.v = 0;
    return m.s;
  }

  update(dt) {
    if (dt <= 0) return;
    for (const r of this.riders) r.update(dt);
    if (!this.members.length) return;
    if (this.gathering) { this.updateGather(dt); return; }
    const p = this.g.player, dp = p.pos, d = p.dog;
    this.record(dp);
    const t = this.trail;
    const still = d.speed < 0.25 && p.grounded;
    this.stillT = still ? this.stillT + dt : 0;
    const sitting = this.stillT > 0.25 && (d.poseTarget === 'sit' || d.poseTarget === 'lie');
    const total = this.total;
    let off = 0, ahead = null;
    for (const m of this.members) {
      off += m.gap;
      const sT = Math.max(t[0].s, total - off);
      if (m.s < t[0].s) m.s = t[0].s;
      this.cutLoops(m, sT);
      const lag = sT - m.s;
      // hold：その場で待つ（はぐれた ひな など）
      const want = lag > 0.05 && !m.hold ? Math.min(m.maxSpeed, 0.4 + lag * 2.4) : 0;
      m.v = damp(m.v, want, want > m.v ? 5 : 12, dt);
      let s2 = Math.min(sT, m.s + m.v * dt);
      if (s2 > m.s) {
        this.at(s2, _a);
        // 犬にも、前を歩く子にも、近づきすぎない
        if (this.tooClose(m, _a, dp, m.minGap) || (ahead && this.tooClose(m, _a, ahead.pos, 0.62))) { s2 = m.s; m.v = 0; }
        else if (m.avoid && m.avoid(_a)) s2 = this.skipAvoid(m, s2, sT);
      }
      m.s = s2;
      this.at(m.s, _a);
      if (m.side) this.offset(m, _a, dt);
      m.drive(dt, _a, { sitting, idle: this.stillT > 1.4 });
      ahead = m;
    }
  }
  /**
   * 道の真うしろだと、カメラから見て犬が かくれてしまうので、少し横を歩く。
   * 横が壁・段差（塀の上など）の時は、道の上に もどる
   */
  offset(m, q, dt) {
    const col = this.g.town.col;
    this.at(m.s - 0.5, _t0);
    this.at(m.s + 0.5, _t1);
    const dx = _t1.x - _t0.x, dz = _t1.z - _t0.z, l = Math.hypot(dx, dz);
    if (!m.dir) m.dir = new THREE.Vector3(0, 0, 1);
    if (l > 0.2) m.dir.set(dx / l, 0, dz / l);
    m.lat = damp(m.lat || 0, m.side * 0.55, 3, dt);
    _c.set(q.x + m.dir.z * m.lat, q.y, q.z - m.dir.x * m.lat);
    col.resolve(_c, 0.2, 0.4, 0.3);
    const gy = col.groundAt(_c.x, _c.z, 0.15, q.y + 0.3, 0.35);
    if (Math.abs(gy - q.y) < 0.15) q.copy(_c);
    else m.lat = damp(m.lat, 0, 12, dt);
  }

  /** 再会：なかまを あの人のまわりへ（slots: 場所、face: 見る所） */
  gather(slots, face) {
    this.gathering = { face: face.clone() };
    this.members.forEach((m, i) => { m.goal = slots[i % slots.length].clone(); });
  }
  updateGather(dt) {
    const G = this.gathering;
    for (const m of this.members) {
      const arrived = hdist(m.pos, m.goal) < 0.12;
      const face = Math.atan2(G.face.x - m.pos.x, G.face.z - m.pos.z);
      m.drive(dt, _b.copy(m.goal), { sitting: arrived, idle: arrived, face, speed: 3.2 });
    }
  }

  /** 犬の行動に、なかまが反応する（'bark' など） */
  react(kind) {
    for (const m of this.all()) if (m.react) m.react(kind);
  }
}

// ------------------------------------------------------------
// なかまの体（それぞれの見た目を動かす）
// drive(dt, target, { sitting, idle, face, speed }) で、道の上の点へ
// ------------------------------------------------------------

/** 犬の友だち（コロンちゃん）。Dog をそのまま動かす */
export class DogFollower {
  constructor(g, dog, { id, name, gap = 1.2, order = 2 } = {}) {
    Object.assign(this, { g, dog, id, name, gap, order });
    this.maxSpeed = 6.8;
    this.minGap = 0.9;
    this.radius = 0.42;
    this.side = 1;
    this.pos = dog.pos;
    this.s = 0;
    this.v = 0;
    this.restT = 0;
    this._w = new THREE.Vector3();
    this._mv = new THREE.Vector3();
    // 位置は道の点に合わせる（Dog の当たり判定のかわり）
    this.adapter = { resolveDog: (d) => d.pos.copy(this._w) };
  }
  place(p) { this.dog.place(p.x, p.z, this.dog.heading, p.y); }
  drive(dt, target, o) {
    const d = this.dog;
    const w = approach(d.pos, target, o.speed || this.maxSpeed, dt, this._w);
    const vx = (w.x - d.pos.x) / dt, vz = (w.z - d.pos.z) / dt, sp = Math.hypot(vx, vz);
    if (sp > 0.2) {
      this._mv.set(vx / sp, 0, vz / sp);
      d.speedMul = Math.max(0.25, sp / 2.6);
      this.restT = 0;
    } else {
      this._mv.set(0, 0, 0);
      d.speedMul = 1;
      this.restT += dt;
      if (o.face !== undefined) d.heading = dampAngle(d.heading, o.face, 6, dt);
    }
    d.update(dt, this._mv, this.adapter);
    // ジャンプの道をたどる時は、空中の姿勢
    const ground = this.g.town.col.groundAt(w.x, w.z, d.radius, w.y + 0.05, 0.35);
    d.air = damp(d.air, w.y - ground > 0.08 ? 1 : 0, 12, dt);
    if (sp < 0.2 && (o.sitting || this.restT > 1.8) && d.poseTarget === 'stand') d.setPose('sit');
    // 止まると、犬のほうを見る
    if (sp < 0.2 && this.restT > 0.5 && !d.lookAt && o.face === undefined) { d.lookAt = this.g.player.dog.headWorld.clone(); d.lookHold = 1.2; }
    d.excite = Math.max(d.excite, 0.65);
  }
  react(kind) {
    if (kind !== 'bark' || !this.party) return;
    const d = this.dog, g = this.g;
    // ワンと言うと、コロンちゃんも ワン
    g.run(function* () { yield 0.32; d.bark(1.32); }());
  }
}

/** ねこの友だち（ミケ）。ねこは水に入らない */
export class CatFollower {
  constructor(g, cat, { id, name, gap = 1.45, order = 3 } = {}) {
    Object.assign(this, { g, cat, id, name, gap, order });
    this.maxSpeed = 6.6;
    this.minGap = 1.1;
    this.radius = 0.3;
    this.side = -1;
    this.pos = cat.pos;
    this.s = 0;
    this.v = 0;
    this.restT = 0;
    this._w = new THREE.Vector3();
    this.avoid = (q) => q.y < RIVER.waterY + 0.02 && q.z < RIVER.beach + 0.5;
  }
  place(p) { this.cat.pos.copy(p); }
  drive(dt, target, o) {
    const c = this.cat;
    const w = approach(c.pos, target, o.speed || this.maxSpeed, dt, this._w);
    const vx = (w.x - c.pos.x) / dt, vz = (w.z - c.pos.z) / dt, sp = Math.hypot(vx, vz);
    c.pos.copy(w);
    if (sp > 0.2) { c.heading = dampAngle(c.heading, Math.atan2(vx, vz), 10, dt); this.restT = 0; }
    else {
      this.restT += dt;
      if (o.face !== undefined) c.heading = dampAngle(c.heading, o.face, 5, dt);
    }
    c.drive = sp;
    c.state = sp > 0.2 ? (sp > 2.4 ? 'run' : 'walk') : (o.sitting || this.restT < 7 ? 'sit' : 'loaf');
    c.sleep = 0;
    c.lookAt = sp < 0.2 ? this.g.player.pos : null;
    c.update(dt);
  }
  react(kind) {
    if (kind === 'bark' && Math.random() < 0.35) {
      const c = this.cat, g = this.g;
      g.run(function* () { yield 0.4; audio.play('meow', 1.15); g.sayAt(c.pos.clone().add(_a.set(0, 0.55, 0)), 'にゃ', 0.9); }());
    }
  }
}

/** カルガモのひな（池まで つれていく）。足が おそいので、走ると はぐれる */
export class ChickFollower {
  constructor(g, chick, { id = 'chick', name = 'ひな', gap = 0.8, order = 1 } = {}) {
    Object.assign(this, { g, chick, id, name, gap, order });
    this.maxSpeed = 3.4;
    this.minGap = 0.6;
    this.radius = 0.2;
    this.pos = chick.root.position;
    this.s = 0;
    this.v = 0;
    this.t = 0;
    this.heading = 0;
    this._w = new THREE.Vector3();
  }
  place(p) { this.pos.copy(p); }
  drive(dt, target, o) {
    this.t += dt;
    const c = this.chick;
    const w = approach(this.pos, target, o.speed || this.maxSpeed, dt, this._w);
    const vx = (w.x - this.pos.x) / dt, vz = (w.z - this.pos.z) / dt, sp = Math.hypot(vx, vz);
    this.pos.copy(w);
    if (sp > 0.1) this.heading = dampAngle(this.heading, Math.atan2(vx, vz), 12, dt);
    else if (o.face !== undefined) this.heading = dampAngle(this.heading, o.face, 5, dt);
    else this.heading = dampAngle(this.heading, Math.atan2(this.g.player.pos.x - this.pos.x, this.g.player.pos.z - this.pos.z), 3, dt);
    c.root.rotation.y = this.heading;
    waddle(c, this.t, Math.min(1, sp / 2));
  }
  react(kind) {
    if (kind !== 'bark') return;
    const g = this.g, p = this.pos;
    g.run(function* () { yield 0.3; audio.play('peep', 1.2); g.sayAt(p.clone().add(_a.set(0, 0.3, 0)), 'ピヨ！', 0.8); }());
  }
}

/** 頭の上に乗るハト（ポッポ） */
export class PigeonRider {
  constructor(g, { id = 'poppo', name = 'ポッポ' } = {}) {
    Object.assign(this, { g, id, name });
    this.rider = true;
    Object.assign(this, makePigeon());   // root, body, wings, pose
    this.pos = new THREE.Vector3();
    this.t = 0;
    this.fold = 1;
    this.flapT = 0;
    this.yaw = 0;
    this.yawGoal = 0;
    this.yawT = 1;
    this.cooT = 4;
    this.state = 'idle';
    this.flight = null;
  }
  /** from（世界の位置）から、犬の頭へ飛んでくる */
  flyIn(from) {
    this.root.position.copy(from);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(0.8);
    this.g.scene.add(this.root);
    this.flight = { from: from.clone(), t: 0, dur: 1.5 };
    this.state = 'fly';
    audio.play('flap', 0.6);
  }
  rig() { return this.g.player.dog.rig; }
  /** 頭の上の高さ（きせかえの帽子などの上） */
  seatY(rig) {
    // 足は ふわふわの毛に少し うもれる
    let y = rig.dims.crown.y - 0.03;
    for (const c of rig.head.children) {
      if (c.name && c.name.startsWith('wear-') && c.userData.top != null) y = Math.max(y, c.position.y + c.userData.top * c.scale.y);
    }
    return y;
  }
  seatWorld(out) {
    const rig = this.rig();
    rig.head.updateMatrixWorld();
    return rig.head.localToWorld(out.set(0, this.seatY(rig), rig.dims.crown.z));
  }
  attach() {
    const rig = this.rig();
    rig.head.add(this.root);
    this.root.position.set(0, this.seatY(rig), rig.dims.crown.z);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(0.8 / rig.dims.scale);
    this.state = 'ride';
    this.flight = null;
  }
  update(dt) {
    this.t += dt;
    const d = this.g.player.dog;
    if (this.state === 'fly') {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k * (3 - 2 * k);
      this.seatWorld(_a);
      this.root.position.lerpVectors(f.from, _a, e);
      this.root.position.y += Math.sin(k * Math.PI) * 1.4;
      _b.copy(_a).sub(f.from);
      this.root.rotation.y = Math.atan2(_b.x, _b.z);
      this.pose(k > 0.85 ? (k - 0.85) / 0.15 : 0, Math.sin(this.t * 28) * 1.0);
      this.pos.copy(this.root.position);
      if (k >= 1) { this.attach(); audio.play('coo'); }
      return;
    }
    if (this.state !== 'ride') return;
    if (this.root.parent !== d.rig.head) this.attach();
    // 犬が走る・跳ぶと、つばさで バランス
    const p = this.g.player;
    const busy = !p.grounded ? 1 : d.speed > 3.2 ? 0.55 : 0;
    if (this.flapT > 0) this.flapT -= dt;
    const flapping = this.flapT > 0 ? 1 : busy;
    this.fold = damp(this.fold, flapping ? 0.25 : 1, flapping ? 14 : 6, dt);
    this.pose(this.fold, Math.sin(this.t * (flapping > 0.9 ? 30 : 16)) * (flapping > 0.9 ? 0.9 : 0.4));
    // きょろきょろ・こくこく
    this.yawT -= dt;
    if (this.yawT <= 0) { this.yawT = 0.8 + Math.random() * 2.2; this.yawGoal = (Math.random() - 0.5) * 1.6; }
    this.yaw = damp(this.yaw, this.yawGoal, 9, dt);
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = Math.max(0, Math.sin(this.t * 3.1)) > 0.92 ? 0.25 : 0;
    this.root.position.y = this.seatY(d.rig) + Math.abs(Math.sin(this.t * 6)) * 0.004;
    this.root.getWorldPosition(this.pos);
    this.cooT -= dt;
    if (this.cooT <= 0) { this.cooT = 6 + Math.random() * 8; audio.play('coo'); }
  }
  react(kind) {
    if (kind !== 'bark' || this.state !== 'ride') return;
    this.flapT = 0.5;
    if (Math.random() < 0.4) this.g.sayAt(this.pos.clone().add(_a.set(0, 0.25, 0)), 'クルッ！？', 1.0);
  }
}
