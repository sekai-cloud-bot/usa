import * as THREE from 'three';
import { TABLE, BED, DOOR, ROOM, WINDOW, inSun } from './room.js';
import { clamp, rand, dampAngle, angleDiff } from './util.js';
import { audio } from './audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (a, x, z) => Math.hypot(a.x - x, a.z - z);

/**
 * うちの子の頭の中。
 * 欲求（退屈・眠気・おなか・興奮）と性格で次の行動を選び、
 * 行動は「近づく → うずうず（予告）→ 実行 → ちらっ」のような手順（ジェネレータ）で進む。
 * おやつ・名前・レーザー・インターホンは割り込みとして反応する。
 */
export class Brain {
  constructor(game) {
    this.game = game;
    this.dog = game.dog;
    this.world = game.world;
    this.move = { x: 0, z: 0 };
    this.side = 1;
  }

  reset(pers) {
    this.p = pers;
    this.needs = { bored: 0.62, sleepy: 0.1 + 0.05 * pers.sleep, hungry: 0.3, excite: 0.35 };
    this.task = null;
    this.name = 'idle';
    this.intent = 'のんびり中';
    this.icon = null;
    this.moment = null;
    this.t = 0;
    this.dt = 0;
    this.lastMischiefAt = -99;
    this.lastYawnAt = -10;
    this.lastWindowAt = -20;
    this.lastCamLookAt = -8;
    this.calls = [];
    this.cool = new Map();
    this.catchT = 0;
  }

  get busyLevel() {
    // 割り込みやすさ（数字が大きいほど割り込みにくい）
    return { called: 2, doorbell: 3, treat: 1, laser: 1 }[this.name] || 0;
  }

  set(name, intent, icon = null) {
    this.name = name;
    this.intent = intent;
    this.icon = icon;
  }

  camPos() { return this.game.camPos(); }

  // ------------------------------------------------------------
  update(dt) {
    this.dt = dt;
    this.t += dt;
    const n = this.needs, p = this.p;
    if (this.name !== 'mischief') n.bored = Math.min(1, n.bored + 0.03 * p.mischief * dt);
    if (this.name !== 'nap') n.sleepy = Math.min(1, n.sleepy + 0.0045 * p.sleep * dt);
    n.hungry = Math.min(1, n.hungry + 0.003 * dt);
    n.excite = Math.max(0.1, n.excite - 0.03 * dt);
    this.move.x = 0;
    this.move.z = 0;
    this.moment = null;
    if (!this.task) this.choose();
    const task = this.task;
    const r = task.next();
    // 実行中に割り込みで差し替わっていたら、新しい方を残す
    if (r.done && this.task === task) {
      this.task = null;
      this.cleanupPose();
    }
  }

  cleanupPose() {
    const d = this.dog;
    d.shaking = false;
    d.chewing = false;
    d.tiltTarget = 0;
    d.reachWanted = false;
    if (d.expr !== 'sleep') d.setExpr('happy');
  }

  start(name, gen) {
    this.cleanupPose();
    this.task = gen;
    this.name = name;
  }

  // ------------------------------------------------------------
  // 行動の選択
  // ------------------------------------------------------------
  choose() {
    const n = this.needs, p = this.p, t = this.t, dog = this.dog;
    const opts = [];
    const add = (score, name, make) => { if (score > 0) opts.push({ score, name, make }); };
    add(n.sleepy > 0.5 ? (n.sleepy - 0.35) * 3 : 0, 'nap', () => this.nap());
    add(n.excite > 0.72 ? n.excite * 1.3 * p.zoom : 0, 'zoomies', () => this.zoomies());
    for (const c of this.mischiefCandidates()) {
      const d = flat(dog.pos, c.pos.x, c.pos.z);
      add(n.bored * p.mischief * c.w * (1.4 / (1 + d * 0.25)), 'mischief', () => this.mischief(c));
    }
    add(0.3, 'wander', () => this.wander());
    add(0.2, 'idle', () => this.idle(rand(2.5, 4)));
    add(t - this.lastYawnAt > 16 ? n.sleepy * 1.1 + 0.05 : 0, 'yawn', () => this.yawnB());
    add(t - this.lastWindowAt > 28 ? 0.22 : 0, 'window', () => this.windowB());
    add(t - this.lastCamLookAt > 14 ? 0.15 * p.amae : 0, 'lookcam', () => this.lookCam());
    let sum = 0;
    for (const o of opts) { o.w = Math.pow(o.score, 1.6); sum += o.w; }
    let r = Math.random() * sum;
    let pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    this.start(pick.name, pick.make());
  }

  mischiefCandidates() {
    const W = this.world, out = [];
    const cool = (k) => (this.cool.get(k) || -1) > this.t;
    const b = W.tissue.box;
    if (b.sheets > 12 && !cool('tissue')) out.push({ kind: 'tissue', pos: b.pos, w: 1.1, key: 'tissue', label: 'ティッシュ', icon: 'tissue' });
    for (const m of W.movables) {
      if (m.mode !== 'rest' || !m.grabbable || m.pos.y > 0.75 || cool(m)) continue;
      if (m.kind === 'cushion') out.push({ kind: 'cushion', m, pos: m.pos, w: m.data.burst ? 0.25 : 0.95, key: m, label: 'クッション', icon: 'cushion' });
      else if (m.kind === 'slipper' && !W.isInBed(m.pos.x, m.pos.z, 0.1)) out.push({ kind: 'slipper', m, pos: m.pos, w: 0.8, key: m, label: 'スリッパ', icon: 'slipper' });
      else if (m.kind === 'teddy') out.push({ kind: 'teddy', m, pos: m.pos, w: 0.35, key: m, label: 'くまちゃん', icon: 'teddy' });
      else if (m.kind === 'ball') out.push({ kind: 'ball', m, pos: m.pos, w: 0.45, key: m, label: 'ボール', icon: 'ball' });
    }
    const boxes = W.topplers.filter((t) => t.kind === 'box' && t.standing);
    for (const t of W.topplers) {
      if (!t.standing || cool(t)) continue;
      if (t.kind === 'basket') out.push({ kind: 'topple', t, pos: t.pos, w: 0.75, key: t, label: 'おもちゃカゴ', icon: 'basket' });
      else if (t.kind === 'trash') out.push({ kind: 'topple', t, pos: t.pos, w: 0.6 * this.p.food, key: t, label: 'ゴミ箱', icon: 'trash' });
      else if (t.kind === 'lamp') out.push({ kind: 'topple', t, pos: t.pos, w: 0.4, key: t, label: 'スタンドライト', icon: 'lamp' });
      else if (t.kind === 'plant' && t.h < 1) out.push({ kind: 'topple', t, pos: t.pos, w: 0.2, key: t, label: '植木鉢', icon: 'plant' });
      else if (t.kind === 'box' && (t === boxes[0] || t === boxes[boxes.length - 1])) out.push({ kind: 'topple', t, pos: t.pos, w: 0.55, key: t, label: '段ボール', icon: 'box' });
    }
    if (W.mug.mode === 'table' && !cool('table')) out.push({ kind: 'table', pos: V(TABLE.x, 0, TABLE.z), w: 0.5, key: 'table', label: 'テーブルのマグ', icon: 'mug' });
    return out;
  }

  // ------------------------------------------------------------
  // 刺激（プレイヤーのちょっかい・物音）
  // ------------------------------------------------------------
  stimulus(type, data) {
    const dog = this.dog;
    switch (type) {
      case 'treat':
        if (this.name === 'treat' || this.name === 'doorbell') return;
        if (dog.isNapping && Math.random() < 0.45) { dog.startle(data.pos, 1); return; }
        if (dog.held) this.game.dropHeld(false);
        this.start('treat', this.goTreat(data));
        break;
      case 'call': {
        this.calls = this.calls.filter((c) => this.t - c < 12);
        this.calls.push(this.t);
        if (this.name === 'doorbell') return;
        if (this.calls.length >= 4) { this.calls = []; this.start('ignore', this.ignore()); }
        else this.start('called', this.called());
        break;
      }
      case 'laser':
        if (this.name === 'laser' || this.name === 'doorbell' || this.name === 'called') return;
        if (dog.isNapping && Math.random() < 0.6) return;
        if (dog.held) this.game.dropHeld(false);
        this.start('laser', this.chaseLaser());
        break;
      case 'doorbell':
        if (dog.held) this.game.dropHeld(false);
        this.start('doorbell', this.doorbell());
        break;
      case 'noise':
        if (!['idle', 'wander', 'window', 'lookcam'].includes(this.name)) return;
        if (flat(dog.pos, data.pos.x, data.pos.z) > 4.5 || Math.random() > 0.55) return;
        this.start('investigate', this.investigate(data.pos, data.kind));
        break;
    }
  }

  // ------------------------------------------------------------
  // 移動の部品
  // ------------------------------------------------------------
  /** テーブルをよける中継点 */
  waypoint(x, z) {
    const p = this.dog.pos;
    const R = TABLE.r + 0.42;
    const ax = x - p.x, az = z - p.z;
    const L2 = ax * ax + az * az || 1;
    const t = clamp(((TABLE.x - p.x) * ax + (TABLE.z - p.z) * az) / L2, 0, 1);
    const cx = p.x + ax * t, cz = p.z + az * t;
    if (Math.hypot(cx - TABLE.x, cz - TABLE.z) < R && t > 0.02 && t < 0.98) {
      let nx = cx - TABLE.x, nz = cz - TABLE.z;
      let nl = Math.hypot(nx, nz);
      if (nl < 1e-3) { nx = -az; nz = ax; nl = Math.hypot(nx, nz); }
      return [TABLE.x + (nx / nl) * (R + 0.3), TABLE.z + (nz / nl) * (R + 0.3)];
    }
    return [x, z];
  }

  steer(x, z, speed) {
    const dog = this.dog;
    const [wx, wz] = this.waypoint(x, z);
    const mx = wx - dog.pos.x, mz = wz - dog.pos.z;
    const ml = Math.hypot(mx, mz) || 1;
    this.move.x = (mx / ml) * speed;
    this.move.z = (mz / ml) * speed;
  }

  *wait(s, fn) {
    let t = 0;
    while (t < s) {
      t += this.dt;
      if (fn) fn(t);
      yield;
    }
  }

  *walkTo(x, z, speed = 0.6, stopR = 0.3, timeout = 8, fn = null) {
    const dog = this.dog;
    x = clamp(x, ROOM.minX + 0.3, ROOM.maxX - 0.3);
    z = clamp(z, ROOM.minZ + 0.3, 3.1);
    let t = 0, stuck = 0, sideT = 0;
    while (t < timeout) {
      t += this.dt;
      const d = flat(dog.pos, x, z);
      if (d < stopR) break;
      const sp = speed * Math.min(1, 0.4 + d / 1.1);
      if (sideT > 0) {
        sideT -= this.dt;
        const [wx, wz] = this.waypoint(x, z);
        const mx = wx - dog.pos.x, mz = wz - dog.pos.z, ml = Math.hypot(mx, mz) || 1;
        this.move.x = (-mz / ml) * this.side * 0.6 + (mx / ml) * 0.3;
        this.move.z = (mx / ml) * this.side * 0.6 + (mz / ml) * 0.3;
      } else this.steer(x, z, sp);
      if (dog.speed < 0.15 && t > 0.5) stuck += this.dt;
      else stuck = Math.max(0, stuck - this.dt);
      if (stuck > 0.6) { sideT = 0.5; stuck = 0; this.side *= -1; }
      if (fn) fn(t);
      yield;
    }
    this.move.x = 0;
    this.move.z = 0;
  }

  *faceTo(pos, s = 0.4) {
    const dog = this.dog;
    yield* this.wait(s, () => {
      const want = Math.atan2(pos.x - dog.pos.x, pos.z - dog.pos.z);
      dog.heading = dampAngle(dog.heading, want, 9, this.dt);
    });
  }

  *approach(pos, dist, speed = 0.62) {
    const dog = this.dog;
    let dx = dog.pos.x - pos.x, dz = dog.pos.z - pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    yield* this.walkTo(pos.x + dx * dist, pos.z + dz * dist, speed, 0.25, 7);
    yield* this.faceTo(pos, 0.3);
  }

  /** いたずら直前の「うずうず」。プレイヤーへの予告 */
  *playBow(pos, c) {
    const dog = this.dog;
    this.set('bow', `${c.label}をねらってる…！`, c.icon);
    this.game.onTelegraph(pos, c);
    dog.lookAt = pos.clone().setY(0.15);
    dog.setPose('bow');
    dog.excite = 1;
    yield* this.wait(rand(1.4, 1.9), () => {
      this.moment = { id: 'playbow', q: dog.pose.bow };
      const want = Math.atan2(pos.x - dog.pos.x, pos.z - dog.pos.z);
      dog.heading = dampAngle(dog.heading, want, 6, this.dt);
    });
    dog.setPose('stand');
  }

  *fetch(m) {
    const dog = this.dog;
    yield* this.walkTo(m.pos.x, m.pos.z, 0.5, 0.28 + m.r * 0.6, 3);
    yield* this.faceTo(m.pos, 0.25);
    if (m.mode === 'held' || m.mode === 'gone') return false;
    const t = this.world.findGrabTarget(dog.front, 0.55);
    if (t !== m) return false;
    this.game.grab(m);
    return true;
  }

  *hold(dur) {
    const dog = this.dog;
    let t = 0;
    while (t < dur && dog.held) {
      t += this.dt;
      this.game.holdAction(this.dt);
      const k = dog.held?.kind;
      this.moment = { id: k === 'slipper' || k === 'book' ? 'slipper' : k === 'tissue' ? 'tissue' : 'shake', q: Math.min(1, 0.5 + t) };
      yield;
    }
    dog.shaking = false;
    dog.chewing = false;
  }

  /** いたずらのあと、カメラをちらっ（見られてないよね？） */
  *glance() {
    const dog = this.dog;
    this.set('after', 'ちらっ…', null);
    dog.setPose('stand');
    dog.setExpr('guilty');
    yield* this.faceTo(this.camPos(), 0.35);
    dog.lookAt = this.camPos();
    dog.setExpr('innocent');
    yield* this.wait(1.4, () => { this.moment = { id: 'innocent', q: 0.55 }; });
    dog.setExpr('happy');
    dog.lookAt = null;
  }

  // ------------------------------------------------------------
  // ふだんの行動
  // ------------------------------------------------------------
  *idle(dur) {
    const dog = this.dog;
    this.set('idle', 'のんびり中');
    let t = 0, next = 0, camT = 0;
    while (t < dur) {
      t += this.dt;
      if (t > 1.0) dog.setPose('sit');
      next -= this.dt;
      if (next <= 0) {
        next = rand(1.2, 2.2);
        if (Math.random() < 0.28 * this.p.amae) { dog.lookAt = this.camPos(); camT = 1.4; }
        else dog.lookAt = V(dog.pos.x + rand(-2, 2), 0.3, dog.pos.z + rand(-2, 2));
      }
      if (camT > 0) { camT -= this.dt; this.moment = { id: 'camme', q: 0.8 }; }
      yield;
    }
    dog.lookAt = null;
  }

  *wander() {
    const dog = this.dog;
    this.set('wander', 'おさんぽ中');
    let x = 0, z = 0;
    for (let i = 0; i < 10; i++) {
      x = clamp(dog.pos.x + rand(-2.6, 2.6), -3.8, 3.8);
      z = clamp(dog.pos.z + rand(-2.2, 2.2), -2.2, 2.9);
      if (Math.hypot(x - TABLE.x, z - TABLE.z) > TABLE.r + 0.4) break;
    }
    yield* this.walkTo(x, z, 0.42, 0.3, 6);
    this.set('wander', 'くんくん…');
    dog.sniff = 1.3;
    // 倒れたゴミ箱の近くなら探検
    const trash = this.world.topplers.find((t) => t.kind === 'trash' && t.state === 'down');
    const nearTrash = trash && flat(dog.pos, trash.pos.x, trash.pos.z) < 1.5;
    yield* this.wait(1.3, () => { if (nearTrash) this.moment = { id: 'trash', q: 0.9 }; });
  }

  *investigate(pos, kind) {
    const dog = this.dog;
    this.set('investigate', 'なんの音…？', 'q');
    dog.lookAt = pos.clone().setY(0.3);
    yield* this.wait(0.6);
    yield* this.approach(pos, 0.7, 0.55);
    this.set('investigate', 'くんくん…');
    dog.sniff = 1.6;
    yield* this.wait(1.6, () => { if (kind === 'trash') this.moment = { id: 'trash', q: 1 }; });
  }

  *yawnB() {
    const dog = this.dog;
    this.set('yawn', 'ねむそう…', 'sleep');
    dog.setPose('sit');
    yield* this.wait(0.7);
    dog.yawn();
    this.lastYawnAt = this.t;
    yield* this.wait(1.5, () => {
      const k = dog.yawnAmt || 0;
      if (k > 0.25) this.moment = { id: 'yawn', q: k };
    });
    yield* this.wait(0.5);
  }

  *windowB() {
    const dog = this.dog;
    this.set('window', '窓の外が気になる', null);
    const z = rand(-2.2, 0.1);
    yield* this.walkTo(ROOM.maxX - 0.45, z, 0.55, 0.3, 7);
    const out = V(ROOM.maxX + 3, 1.2, z);
    yield* this.faceTo(out, 0.5);
    dog.setPose('sit');
    dog.lookAt = out;
    const sunny = inSun(dog.pos.x, dog.pos.z);
    let barked = false;
    const dur = rand(4.5, 6.5);
    yield* this.wait(dur, (t) => {
      this.moment = { id: 'window', q: sunny ? 1 : 0.75 };
      if (!barked && t > dur * 0.5 && Math.random() < 0.3) { barked = true; dog.bark(1.15); this.set('window', '鳥がいた！'); }
    });
    this.lastWindowAt = this.t;
    dog.lookAt = null;
  }

  *lookCam() {
    const dog = this.dog;
    this.set('lookcam', 'こっちを見てる…', 'heart');
    yield* this.faceTo(this.camPos(), 0.6);
    dog.setPose('sit');
    dog.lookAt = this.camPos();
    dog.tiltTarget = 0.22;
    yield* this.wait(2.4, () => { this.moment = { id: 'camme', q: 1 }; });
    dog.tiltTarget = 0;
    this.lastCamLookAt = this.t;
  }

  *nap() {
    const dog = this.dog;
    this.set('nap', 'ねむい…', 'sleep');
    // 日だまりか、ベッド
    let spot = null;
    if (Math.random() < 0.6) {
      for (let i = 0; i < 20; i++) {
        const x = rand(1.6, 4.1), z = rand(-2.6, 1.0);
        if (inSun(x, z) && !this.world.isInBed(x, z, 0.3)) { spot = V(x, 0, z); break; }
      }
    }
    if (!spot) spot = V(BED.x + rand(-0.1, 0.1), 0, BED.z + rand(-0.1, 0.1));
    yield* this.walkTo(spot.x, spot.z, 0.45, 0.22, 8);
    // くるっと回ってから寝る
    const h0 = dog.heading;
    yield* this.wait(1.1, (t) => { dog.heading = h0 + (t / 1.1) * Math.PI * 2; });
    dog.setPose('lie');
    yield* this.wait(0.8);
    dog.setExpr('sleep');
    const sunny = inSun(dog.pos.x, dog.pos.z);
    this.set('nap', sunny ? 'ひなたでうとうと' : 'おひるね中', null);
    let t = 0, bellyUntil = -1, bellyDone = false;
    while (this.needs.sleepy > 0.08) {
      t += this.dt;
      this.needs.sleepy -= 0.04 * this.dt;
      if (!bellyDone && sunny && t > 2.5 && Math.random() < this.dt * 0.35 * this.p.sleep) {
        bellyDone = true;
        bellyUntil = t + rand(5, 8);
        dog.setPose('belly');
        this.set('nap', 'へそ天…', null);
      }
      if (bellyUntil > 0 && t > bellyUntil) { dog.setPose('lie'); bellyUntil = -1; this.set('nap', 'ひなたでうとうと'); }
      this.moment = { id: dog.pose.belly > 0.6 ? 'belly' : 'nap', q: sunny ? 1 : 0.7 };
      if (Math.random() < this.dt * 0.35) audio.play('snore');
      yield;
    }
    dog.setExpr('happy');
    dog.setPose('sit');
    this.set('nap', 'ふぁ〜…', null);
    yield* this.wait(0.5);
    dog.yawn();
    yield* this.wait(1.5, () => { const k = dog.yawnAmt || 0; if (k > 0.25) this.moment = { id: 'yawn', q: k }; });
  }

  *zoomies() {
    const dog = this.dog;
    this.set('zoomies', 'ズーミー発動！', 'ex');
    dog.bark(1.25);
    const cx = rand(-1.2, 1.5), cz = rand(-0.6, 1.0), rx = rand(2.0, 2.8), rz = rand(1.3, 1.8);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const a0 = Math.atan2(dog.pos.z - cz, dog.pos.x - cx);
    const dur = rand(4.5, 6);
    let t = 0, dashT = rand(0.4, 0.8);
    while (t < dur) {
      t += this.dt;
      const a = a0 + dir * t * 1.6;
      const tx = clamp(cx + Math.cos(a) * rx, -3.9, 3.9), tz = clamp(cz + Math.sin(a) * rz, -2.3, 3.0);
      this.steer(tx, tz, 1);
      dashT -= this.dt;
      if (dashT <= 0) { dog.tryDash(V(this.move.x, 0, this.move.z)); dashT = rand(0.7, 1.3); }
      this.moment = { id: 'zoomies', q: clamp(dog.speed / 4, 0.45, 1) };
      yield;
    }
    this.needs.excite = 0.15;
    this.needs.sleepy = Math.min(1, this.needs.sleepy + 0.15 * this.p.sleep);
    this.set('zoomies', 'はぁはぁ…', null);
    dog.setPose('sit');
    dog.lookAt = this.camPos();
    yield* this.wait(1.4, () => { this.moment = { id: 'camme', q: 0.75 }; });
    dog.lookAt = null;
  }

  // ------------------------------------------------------------
  // いたずら
  // ------------------------------------------------------------
  *mischief(c) {
    const dog = this.dog;
    this.cool.set(c.key, this.t + 30);
    this.set('mischief', `${c.label}が気になる…`, c.icon);
    let did = false;
    switch (c.kind) {
      case 'tissue': {
        const b = this.world.tissue.box.pos;
        yield* this.approach(b, 0.85);
        yield* this.playBow(b, c);
        yield* this.walkTo(b.x, b.z, 0.35, 0.48, 2);
        yield* this.faceTo(b, 0.25);
        if (this.world.findGrabTarget(dog.front, 0.55) !== 'tissue') break;
        this.game.grab('tissue');
        did = true;
        this.set('mischief', 'ティッシュを引っぱり中！', 'tissue');
        const pts = [];
        if (Math.random() < 0.55) {
          // テーブルをぐるっと
          const a0 = Math.atan2(dog.pos.z - TABLE.z, dog.pos.x - TABLE.x);
          const dir = Math.random() < 0.5 ? 1 : -1;
          for (let i = 1; i <= 7; i++) {
            const a = a0 + dir * (i / 6) * Math.PI * 2 * 1.05;
            pts.push([TABLE.x + Math.cos(a) * 1.05, TABLE.z + Math.sin(a) * 1.05]);
          }
        } else {
          for (let i = 0; i < 3; i++) pts.push([rand(-3.5, 3.5), rand(-1.9, 2.8)]);
        }
        const shakeAt = Math.random() < 0.35 ? Math.floor(rand(1, pts.length)) : -1;
        for (let i = 0; i < pts.length && dog.held; i++) {
          yield* this.walkTo(pts[i][0], pts[i][1], 0.95, 0.4, 3, () => {
            const len = this.world.tissue.active ? this.world.tissue.active.len : 0;
            this.moment = { id: 'tissue', q: clamp(len / 9, 0.2, 1) };
          });
          if (i === shakeAt) yield* this.hold(0.9);
        }
        if (dog.held) this.game.dropHeld(false);
        break;
      }
      case 'cushion':
      case 'teddy': {
        const m = c.m;
        yield* this.approach(m.pos, 0.9);
        yield* this.playBow(m.pos, c);
        if (!(yield* this.fetch(m))) break;
        did = true;
        this.set('mischief', `${c.label}をぶんぶん！`, c.icon);
        const a = rand(0, Math.PI * 2);
        yield* this.walkTo(dog.pos.x + Math.cos(a) * 1.5, dog.pos.z + Math.sin(a) * 1.5, 0.7, 0.3, 2.5);
        yield* this.hold(rand(1.6, 3.4));
        if (!dog.held) break;
        const tgt = this.world.topplers.filter((t) => t.standing && flat(dog.pos, t.pos.x, t.pos.z) < 3.2)
          .sort((p, q) => flat(dog.pos, p.pos.x, p.pos.z) - flat(dog.pos, q.pos.x, q.pos.z))[0];
        if (tgt && Math.random() < 0.6) yield* this.faceTo(tgt.pos, 0.4);
        this.game.dropHeld(true);
        yield* this.wait(0.4);
        break;
      }
      case 'slipper': {
        const m = c.m;
        yield* this.approach(m.pos, 0.8);
        // こっそり：取る前にカメラをちらっ
        dog.lookAt = this.camPos();
        dog.setExpr('guilty');
        this.set('mischief', 'スリッパ、だれも見てない…？', 'slipper');
        yield* this.wait(0.9, () => { this.moment = { id: 'camme', q: 0.7 }; });
        dog.lookAt = null;
        dog.setExpr('happy');
        if (!(yield* this.fetch(m))) break;
        did = true;
        if (Math.random() < 0.6) {
          this.set('mischief', 'スリッパをお引っ越し', 'bed');
          yield* this.walkTo(BED.x + rand(-0.2, 0.2), BED.z + rand(-0.2, 0.2), 0.75, 0.25, 7, () => { this.moment = { id: 'slipper', q: 0.9 }; });
        } else {
          this.set('mischief', 'スリッパをかみかみ…', 'slipper');
          yield* this.hold(2.4);
        }
        if (dog.held) this.game.dropHeld(false);
        break;
      }
      case 'ball': {
        const m = c.m;
        yield* this.approach(m.pos, 1.2);
        yield* this.playBow(m.pos, c);
        did = true;
        this.set('mischief', 'ボールであそぶ！', 'ball');
        for (let i = 0; i < 3; i++) {
          const dir = V(m.pos.x - dog.pos.x, 0, m.pos.z - dog.pos.z).normalize();
          dog.tryDash(dir);
          yield* this.wait(0.45, () => { this.move.x = dir.x; this.move.z = dir.z; this.moment = { id: 'ball', q: 1 }; });
          yield* this.walkTo(m.pos.x, m.pos.z, 0.9, 0.9, 1.6, () => { this.moment = { id: 'ball', q: 0.8 }; });
        }
        break;
      }
      case 'topple': {
        const t = c.t;
        let dir;
        if (t.kind === 'box') {
          const boxes = this.world.topplers.filter((b) => b.kind === 'box' && b.standing);
          const nb = t === boxes[0] ? boxes[1] : boxes[boxes.length - 2];
          dir = nb ? V(nb.pos.x - t.pos.x, 0, nb.pos.z - t.pos.z).normalize() : V(t.pos.x - dog.pos.x, 0, t.pos.z - dog.pos.z).normalize();
        } else dir = V(t.pos.x - dog.pos.x, 0, t.pos.z - dog.pos.z).normalize();
        const ax = clamp(t.pos.x - dir.x * 1.4, ROOM.minX + 0.35, ROOM.maxX - 0.35);
        const az = clamp(t.pos.z - dir.z * 1.4, ROOM.minZ + 0.35, 3.1);
        yield* this.walkTo(ax, az, 0.6, 0.25, 7);
        yield* this.faceTo(t.pos, 0.35);
        yield* this.playBow(t.pos, c);
        const d2 = V(t.pos.x - dog.pos.x, 0, t.pos.z - dog.pos.z).normalize();
        dog.tryDash(d2);
        did = true;
        yield* this.wait(0.55, () => { this.move.x = d2.x; this.move.z = d2.z; });
        dog.lookAt = t.pos.clone().setY(0.3);
        yield* this.wait(0.9);
        if (t.kind === 'trash' && t.state !== 'stand') {
          this.set('mischief', 'ゴミ箱を調査中…', 'trash');
          yield* this.approach(V(t.pos.x + t.dir.x * 0.6, 0, t.pos.z + t.dir.z * 0.6), 0.45, 0.5);
          dog.sniff = 2.2;
          yield* this.wait(2.2, () => { this.moment = { id: 'trash', q: 1 }; });
        }
        break;
      }
      case 'table': {
        const dir = V(TABLE.x - dog.pos.x, 0, TABLE.z - dog.pos.z).normalize();
        yield* this.walkTo(TABLE.x - dir.x * (TABLE.r + 1.3), TABLE.z - dir.z * (TABLE.r + 1.3), 0.6, 0.25, 7);
        yield* this.faceTo(V(TABLE.x, 0, TABLE.z), 0.35);
        yield* this.playBow(V(TABLE.x, 0.4, TABLE.z), c);
        const d2 = V(TABLE.x - dog.pos.x, 0, TABLE.z - dog.pos.z).normalize();
        dog.tryDash(d2);
        did = true;
        yield* this.wait(0.55, () => { this.move.x = d2.x; this.move.z = d2.z; });
        yield* this.wait(0.8);
        break;
      }
    }
    if (did) {
      this.lastMischiefAt = this.t;
      this.needs.bored = Math.max(0, this.needs.bored - 0.5);
      this.needs.excite = Math.min(1, this.needs.excite + 0.3);
      this.needs.sleepy = Math.min(1, this.needs.sleepy + 0.03);
      if (Math.random() < 0.55) yield* this.glance();
    } else {
      this.needs.bored *= 0.8;
    }
  }

  // ------------------------------------------------------------
  // 割り込み
  // ------------------------------------------------------------
  *goTreat(tr) {
    const dog = this.dog;
    this.set('treat', 'おやつ！', 'treat');
    dog.setExpr('happy');
    dog.setPose('stand');
    dog.excite = 1;
    dog.lookAt = null;
    let t = 0, ate = false;
    this.catchT = 0;
    while (tr.mode !== 'gone' && t < 7) {
      t += this.dt;
      const land = tr.data.land || tr.pos;
      const inAir = tr.mode === 'air';
      const d = flat(dog.pos, inAir ? land.x : tr.pos.x, inAir ? land.z : tr.pos.z);
      // 空中のおやつにジャンプ
      if (inAir && flat(dog.pos, tr.pos.x, tr.pos.z) < 0.75 && tr.pos.y < 1.0 && tr.pos.y > 0.3 && dog.hopY <= 0.001 && tr.vel.y < 0) {
        dog.reachWanted = true;
        dog.hop(2.7);
        this.catchT = 0.7;
      }
      if (this.catchT > 0) {
        this.catchT -= this.dt;
        this.moment = { id: 'treat', q: 1 };
        if (dog.mouthWorld.distanceTo(tr.pos) < 0.32) { this.game.eatTreat(tr, true); ate = true; break; }
      }
      if (!inAir && d < 0.36) {
        dog.sniff = 0.9;
        this.set('treat', 'もぐもぐ', 'treat');
        yield* this.wait(0.8, () => { this.moment = { id: 'treat', q: 0.45 }; });
        if (tr.mode !== 'gone') { this.game.eatTreat(tr, false); ate = true; }
        break;
      }
      const tx = inAir ? land.x : tr.pos.x, tz = inAir ? land.z : tr.pos.z;
      if (d > 0.3) this.steer(tx, tz, Math.min(1, 0.85 + 0.15 * this.p.food) * Math.min(1, 0.4 + d));
      yield;
    }
    dog.reachWanted = false;
    if (!ate) return;
    this.needs.hungry = Math.max(0, this.needs.hungry - 0.3);
    this.needs.excite = Math.min(1, this.needs.excite + 0.15);
    // もっと？
    yield* this.wait(0.4);
    this.set('treat', 'もっとちょうだい？', 'heart');
    yield* this.faceTo(this.camPos(), 0.45);
    dog.setPose('sit');
    dog.setExpr('beg');
    dog.lookAt = this.camPos();
    dog.tiltTarget = 0.25;
    yield* this.wait(2.0, () => { this.moment = { id: 'camme', q: 1 }; });
    dog.tiltTarget = 0;
    dog.setExpr('happy');
    dog.lookAt = null;
  }

  *called() {
    const dog = this.dog;
    const cam = this.camPos();
    const wasAsleep = dog.isNapping;
    this.set('called', 'よばれた！', 'heart');
    if (wasAsleep) {
      dog.setExpr('happy');
      dog.setPose('sit');
      yield* this.wait(0.7);
    }
    dog.lookAt = cam;
    yield* this.faceTo(cam, 0.45);
    const far = flat(dog.pos, cam.x, cam.z);
    if (far > 3.8 && !dog.held) {
      const dx = (cam.x - dog.pos.x) / far, dz = (cam.z - dog.pos.z) / far;
      yield* this.walkTo(dog.pos.x + dx * 1.2, dog.pos.z + dz * 1.2, 0.7, 0.2, 2);
      yield* this.faceTo(cam, 0.3);
    }
    const holding = !!dog.held;
    const recent = this.t - this.lastMischiefAt < 12;
    const id = holding ? 'caught' : recent ? 'innocent' : 'tilt';
    if (!holding) dog.setPose('sit');
    dog.setExpr(holding || recent ? 'innocent' : 'happy');
    dog.tiltTarget = 0.3;
    if (id !== 'tilt') this.set('called', holding ? '……（くわえたまま）' : '……なんのこと？', null);
    yield* this.wait(this.p.amae > 1.2 ? 3.2 : 2.6, (t) => {
      dog.lookAt = cam;
      this.moment = { id, q: Math.min(1, 0.65 + t * 0.4) };
    });
    dog.tiltTarget = 0;
    dog.setExpr('happy');
    dog.lookAt = null;
    if (dog.held) { yield* this.wait(0.3); this.game.dropHeld(false); }
  }

  *ignore() {
    const dog = this.dog;
    const cam = this.camPos();
    this.set('ignore', '（聞こえないふり）', null);
    if (dog.held) this.game.dropHeld(false);
    dog.lookAt = null;
    const away = V(dog.pos.x * 2 - cam.x, 0, dog.pos.z * 2 - cam.z);
    yield* this.faceTo(away, 0.6);
    dog.setPose('lie');
    dog.setExpr('guilty');
    yield* this.wait(3.8, () => { this.moment = { id: 'ignore', q: 1 }; });
    dog.setExpr('happy');
  }

  *chaseLaser() {
    const dog = this.dog;
    this.set('laser', 'あかい点をロックオン！', 'ex');
    dog.setExpr('focus');
    let pounce = 0;
    while (this.game.laser.on) {
      const lp = this.game.laser.pos;
      pounce -= this.dt;
      if (!lp) { yield; continue; }
      const d = flat(dog.pos, lp.x, lp.z);
      dog.lookAt = lp;
      if (d > 0.45) {
        this.steer(lp.x, lp.z, Math.min(1, 0.55 + d * 0.4));
        if (d > 2.4 && Math.random() < this.dt * 1.2) dog.tryDash(V(this.move.x, 0, this.move.z));
        if (dog.poseTarget === 'bow') dog.setPose('stand');
      } else if (pounce <= 0) {
        pounce = 0.9;
        dog.setPose('bow');
        dog.hop(1.9);
        if (Math.random() < 0.3) audio.play('bark', 1.2);
      }
      this.moment = { id: 'laser', q: d < 1.2 ? 1 : 0.7, extra: lp };
      yield;
    }
    dog.setPose('stand');
    dog.setExpr('happy');
    this.set('laser', 'あれ…？ どこいった？', 'q');
    yield* this.wait(1.2, (t) => { dog.lookAt = V(dog.pos.x + Math.sin(t * 3) * 2, 0.2, dog.pos.z + 1); });
    dog.lookAt = null;
  }

  *doorbell() {
    const dog = this.dog;
    this.set('bark', 'だれか来た！', 'door');
    dog.startle(V(DOOR.x, 1, ROOM.minZ), 2);
    yield* this.wait(0.4);
    yield* this.walkTo(DOOR.x, ROOM.minZ + 0.9, 1.0, 0.3, 5);
    yield* this.faceTo(V(DOOR.x, 0, ROOM.minZ), 0.3);
    for (let i = 0; i < 4; i++) {
      dog.bark(1 + Math.random() * 0.1);
      yield* this.wait(0.5, () => { this.moment = { id: 'bark', q: 1 }; });
    }
    this.set('bark', 'ドアの前で見張り中', null);
    dog.setPose('sit');
    dog.lookAt = V(DOOR.x, 1, ROOM.minZ);
    yield* this.wait(1.8, () => { this.moment = { id: 'bark', q: 0.5 }; });
    dog.lookAt = null;
  }
}

export { angleDiff };
