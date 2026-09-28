import * as THREE from 'three';
import { audio } from './audio.js';
import { getSave, save } from './save.js';
import { INCIDENT_MAP, INCIDENTS, chooseOdai } from './incidents.js';
import { LAYOUT, TISSUE_YEN } from './world.js';
import { BED, DOOR, ROOM, TABLE } from './room.js';
import { clamp, damp, dampAngle, pick, yen, isTouchDevice } from './util.js';

export const RUN_SECONDS = 120;
const WARN_LEFT = 15;
const CHAIN_WINDOW = 2.4;
const START_MIN = 13 * 60;
const END_MIN = 18 * 60;
const HOLD_T = 0.2;

const OWNER_LINES = [
  [0, 'いい子にしてたね〜！'],
  [3000, '…ん？ ちょっと散らかってる？'],
  [10000, '…なにこれ。'],
  [30000, '…………。'],
  [Infinity, 'えええええ！？'],
];

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, camRig, world, dog, fx, ui, input, renderer, camera
    this.state = 'boot';
    this.time = 0;
    this.runT = 0;
    this.world.game = this;
    this.touch = isTouchDevice();
    // くわえたティッシュ
    const th = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
    th.scale.set(1.2, 0.7, 1);
    this.tissueHandle = th;
    this.stateT = 0;
    this.hintQueue = [];
    this.hintCur = null;
    this.hintT = 0;
  }

  // ------------------------------------------------------------
  // 状態遷移
  // ------------------------------------------------------------
  toTitle() {
    this.state = 'title';
    this.stateT = 0;
    this.input.enabled = false;
    this.input.reset();
    this.dropHeld(false, true);
    this.world.reset();
    this.fx.clear();
    this.room.doorPivot.rotation.y = 0;
    this.room.owner.visible = false;
    this.dog.place(BED.x - 0.05, BED.z + 0.05, 0.5);
    this.dog.setPose('lie');
    this.dog.pose.lie = 1;
    this.dog.setExpr('sleep');
    this.dog.locked = true;
    this.camRig.setMode('overview');
    this.ui.show('title');
    audio.setBgmMood('normal');
  }

  toCustom() {
    this.state = 'custom';
    this.stateT = 0;
    this.input.enabled = false;
    this.dropHeld(false, true);
    this.world.reset();
    this.fx.clear();
    this.room.owner.visible = false;
    this.room.doorPivot.rotation.y = 0;
    audio.stopBgm();
    this.dog.place(1.7, 0.2, 0.25);
    this.dog.setPose('sit');
    this.dog.setExpr('happy');
    this.dog.locked = true;
    this.dog.lookAt = null;
    this.camRig.setMode('custom', this.dog);
    this.ui.show('custom');
  }

  startRun() {
    const sv = getSave();
    this.state = 'intro';
    this.stateT = 0;
    this.input.enabled = false;
    this.input.reset();
    this.dropHeld(false, true);
    this.world.setup = sv.plays;
    this.world.reset();
    this.fx.clear();
    this.room.owner.visible = false;
    this.room.doorPivot.rotation.y = -1.25;
    this.dog.place(LAYOUT.spawn.x, LAYOUT.spawn.z, Math.PI);
    this.dog.setPose('sit');
    this.dog.pose.sit = 1;
    this.dog.setExpr('happy');
    this.dog.lookAt = new THREE.Vector3(DOOR.x, 1.0, ROOM.minZ);
    this.dog.lookHold = undefined;
    this.dog.locked = true;
    this.dog.tiltTarget = 0;
    this.camRig.setMode('follow', this.dog, true);

    this.runT = 0;
    this.total = 0;
    this.ledger = {};
    this.chain = 0;
    this.maxChain = 0;
    this.lastChainAt = -99;
    this.runIncidents = new Set();
    this.newIncidents = [];
    this.odai = chooseOdai(sv.incidents, sv.lastOdai);
    sv.lastOdai = this.odai;
    this.odaiDone = false;
    this.done = {};
    this.idle = 0;
    this.moved = 0;
    this.napT = 0;
    this.warned = false;
    this.keysPlayed = false;
    this.stepT = 0;
    this.hintQueue = [];
    this.hintT = 0;
    this.hintCur = null;
    this.firstPlay = sv.plays === 0;
    this.expert = sv.plays >= 4;
    this.logLines = [];
    this.treasureCount = 0;
    this.actHeldAtPress = false;
    this.events = [];
    this.biggest = null;
    this.shakeAmt = 0;

    this.ui.show('hud');
    this.ui.setCine(true);
    this.ui.resetHud(this.dog.params.name);
    this.ui.setOdai(INCIDENT_MAP[this.odai].odai, false);
    this.ui.setYen(0, false);
    this.ui.setClock(this.clockText(0), 0, false);
    this.ui.banner('いってきまーす！', false, 'mint');
    audio.play('door');
    audio.startBgm();
    audio.setBgmMood('normal');
  }

  beginPlay() {
    this.state = 'play';
    this.stateT = 0;
    this.input.enabled = true;
    this.input.reset();
    this.dog.locked = false;
    this.dog.lookAt = null;
    this.dog.setPose('stand');
    this.dog.hop(1.6);
    audio.play('bark');
    this.ui.setCine(false);
    this.ui.banner('おるすばん、スタート！', false);
    this.queueHint(this.touch ? '左側をなぞって うごく' : '<kbd>WASD</kbd> / <kbd>矢印</kbd>で うごく', 'move');
  }

  pause() {
    if (this.state !== 'play') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.ui.show('pause', true);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    this.input.enabled = true;
    this.ui.hide('pause');
  }

  // ------------------------------------------------------------
  // 時計
  // ------------------------------------------------------------
  clockText(t) {
    const m = START_MIN + (END_MIN - START_MIN) * clamp(t / RUN_SECONDS, 0, 1);
    const hh = Math.floor(m / 60), mm = Math.floor(m % 60);
    return `${hh}:${String(mm).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------
  // ヒント
  // ------------------------------------------------------------
  queueHint(html, id, dur = 4.5) {
    if (id && this.hintSeen?.[id]) return;
    if (this.expert && id !== 'warn') return;
    this.hintSeen = this.hintSeen || {};
    if (id) this.hintSeen[id] = true;
    this.hintQueue.push({ html, id, dur });
  }
  clearHint(id) {
    if (this.hintCur && this.hintCur.id === id) { this.hintCur = null; this.ui.hint(null); }
    this.hintQueue = this.hintQueue.filter((h) => h.id !== id);
  }
  updateHints(dt) {
    if (this.hintCur) {
      this.hintT -= dt;
      if (this.hintT <= 0) { this.hintCur = null; this.ui.hint(null); }
    } else if (this.hintQueue.length) {
      this.hintCur = this.hintQueue.shift();
      this.hintT = this.hintCur.dur;
      this.ui.hint(this.hintCur.html);
    }
  }

  // ------------------------------------------------------------
  // スコア
  // ------------------------------------------------------------
  damage({ key, label, yen: base, pos, chain = false, count = 0, small = false, cause }) {
    if (this.state !== 'play' && this.state !== 'ending') return;
    let mult = 1;
    if (chain) {
      if (this.time - this.lastChainAt < CHAIN_WINDOW && this.chain >= 1) this.chain++;
      else this.chain = 1;
      this.lastChainAt = this.time;
      mult = Math.min(5, 1 + 0.5 * (this.chain - 1));
      this.maxChain = Math.max(this.maxChain, this.chain);
      if (this.chain >= 2) {
        this.ui.showChain(this.chain, mult);
        audio.play('chain', this.chain);
        this.hitStop = 0.07;
      }
      if (this.chain >= 3) this.zoomT = 2.5;
      if (this.chain >= 3) this.incident('chain3', pos);
      if (this.chain >= 6) this.incident('chain6', pos);
    }
    const add = Math.round((base * mult) / 10) * 10;
    this.total += add;
    const L = this.ledger[key] || (this.ledger[key] = { label, count: 0, yen: 0 });
    L.count += count;
    L.yen += base;
    if (add > base) {
      const C = this.ledger._chain || (this.ledger._chain = { label: '連鎖ボーナス', count: 0, yen: 0, bonus: true });
      C.yen += add - base;
    }
    if (pos && small) {
      // 小さな加算（ティッシュ1枚など）はまとめて表示して画面を散らかさない
      const P = this.smallPops || (this.smallPops = {});
      const s = P[key] || (P[key] = { yen: 0, t: -9 });
      s.yen += add;
      if (this.time - s.t > 0.45) {
        this.fx.popup(pos, '+' + yen(s.yen), 'small');
        s.yen = 0;
        s.t = this.time;
      }
    } else if (pos) this.fx.popup(pos, '+' + yen(add), add >= 2000 ? 'big' : '');
    if (!small) {
      audio.play('coin');
      this.log(label + (this.chain >= 2 && chain ? ` <b class="c">${this.chain}連鎖</b>` : ''));
      this.shakeAmt = Math.min(1, this.shakeAmt + add / 4000);
      if (!this.biggest || base > this.biggest.yen) this.biggest = { label, yen: base };
      this.events.push({ t: this.runT, label, yen: add });
    }
    this.ui.setYen(this.total, true);
  }

  incident(id, pos) {
    if (!this.runIncidents || this.runIncidents.has(id)) return;
    if (this.state !== 'play' && this.state !== 'ending') return;
    const def = INCIDENT_MAP[id];
    if (!def) return;
    this.runIncidents.add(id);
    const sv = getSave();
    const isNew = !sv.incidents[id];
    if (isNew) { sv.incidents[id] = Date.now(); this.newIncidents.push(id); save(); }
    if (def.bonus) {
      this.total += def.bonus;
      const B = this.ledger._bonus || (this.ledger._bonus = { label: 'じけんボーナス', count: 0, yen: 0, bonus: true });
      B.yen += def.bonus;
      B.count++;
      if (pos) this.world.after(0.35, () => this.fx.popup(pos.clone().setY((pos.y || 0) + 0.4), `じけんボーナス +${yen(def.bonus)}`, 'label'));
    }
    this.ui.banner(`じけん発生！『${def.name}』`, isNew);
    audio.play('fanfare');
    if (pos) this.fx.sparkle(pos, 10, 0.4);
    this.ui.setYen(this.total, true);
    if (id === this.odai && !this.odaiDone) {
      this.odaiDone = true;
      this.total += 2000;
      const O = this.ledger._odai || (this.ledger._odai = { label: 'お題クリア', count: 1, yen: 0, bonus: true });
      O.yen += 2000;
      this.ui.setOdai(def.odai, true);
      this.world.after(1.4, () => { this.ui.banner('お題クリア！ +¥2,000', false, 'mint'); audio.play('ok'); });
    }
  }

  log(text) {
    this.ui.log(this.clockText(this.runT), text);
  }

  onWrap(pos) {
    this.damage({ key: 'wrap', label: 'テーブルぐるぐる巻き', yen: 1500, pos, chain: true, count: 1 });
    this.incident('wrap', pos);
  }
  onWobble(t) {
    if (this.time - (this.lastWobblePop || -9) < 1.2) return;
    this.lastWobblePop = this.time;
    this.fx.popup(t.pos.clone().setY(t.h + 0.1), 'グラッ…', 'label');
    this.queueHint('【はしる】で体当たりすると…？', 'wobble', 3.5);
  }
  onTableWobble() {
    if (this.time - (this.lastWobblePop || -9) < 1.2) return;
    this.lastWobblePop = this.time;
    this.fx.popup(this.world.mug.pos.clone().setY(0.7), 'カタカタ…', 'label');
    this.queueHint('【はしる】でテーブルに体当たりすると…？', 'tablewob', 3.5);
  }
  onTreasure(m) {
    if (this.state !== 'play') return;
    this.fx.popup(new THREE.Vector3(BED.x, 0.6, BED.z), `お宝：${m.label}`, 'label mint');
    this.fx.sparkle(new THREE.Vector3(BED.x, 0.3, BED.z), 6, 0.4);
    audio.play('sparkle');
    this.log(`${m.label}をベッドにしまった`);
    this.done.slipper = this.done.slipper || m.kind === 'slipper';
    if (!this.treasureHinted) {
      this.treasureHinted = true;
      this.queueHint('ベッドに集めたものは「お宝ボーナス」になる', 'treasure', 3.5);
    }
  }
  react(pos, level) {
    if (this.state !== 'play') return;
    if (this.dog.isNapping) {
      this.dog.setPose('stand');
      this.dog.setExpr('happy');
      this.idle = 0;
    }
    if (Math.hypot(pos.x - this.dog.pos.x, pos.z - this.dog.pos.z) < 3.5) this.dog.startle(pos, level);
  }

  // ------------------------------------------------------------
  // くわえる・はなす
  // ------------------------------------------------------------
  grab(target) {
    const dog = this.dog;
    if (target === 'tissue') {
      this.world.tissue.start(dog.mouthWorld);
      dog.rig.mouth.add(this.tissueHandle);
      this.tissueHandle.position.set(0, -0.02, 0.03);
      dog.held = { kind: 'tissue', label: 'ティッシュ', mesh: this.tissueHandle, data: {} };
      this.done.tissue = true;
      this.clearHint('grab');
      this.queueHint('そのまま走って、ひっぱりだそう！', 'pull', 4);
    } else {
      this.world.attachHeld(target, dog.rig.mouth);
      dog.held = target;
      if (target.kind === 'cushion') this.queueHint('【くわえる】を長押しで ぶんぶん → はなすと投げる', 'shake', 5);
      if (target.kind === 'slipper') this.queueHint('長押しで かみかみ。ベッドに運ぶと「お宝」', 'chew', 5);
      if (target.kind === 'ball' || target.kind === 'teddy') this.queueHint('長押しで ぶんぶん → はなすと投げる', 'throw', 4);
    }
    const sv = getSave();
    if (!sv.tutorial.grabbed) { sv.tutorial.grabbed = true; save(); }
    audio.play('grab', 1 + Math.random() * 0.2);
    dog.excite = 1;
    dog.squash = 0.5;
    dog.lookAt = null;
    dog.setPose('stand');
    this.fx.setGuide(null);
  }

  dropHeld(throwIt, silent = false) {
    const dog = this.dog;
    const h = dog.held;
    if (!h) return;
    if (h.kind === 'tissue') {
      this.world.tissue.release();
      if (this.tissueHandle.parent) this.tissueHandle.parent.remove(this.tissueHandle);
    } else {
      let vel = null;
      if (throwIt) {
        const f = dog.fwd;
        const st = Math.min(1.2, h.data.shakeT || 0);
        const power = 3.0 + st * 1.4;
        vel = new THREE.Vector3(f.x * power + dog.vel.x * 0.5, 2.0 + st * 0.6, f.z * power + dog.vel.z * 0.5);
      }
      this.world.releaseHeld(h, vel, dog.heading);
    }
    dog.held = null;
    dog.shaking = false;
    dog.chewing = false;
    if (!silent) audio.play(throwIt ? 'whoosh' : 'drop');
  }

  // ぶんぶん・かみかみ
  holdAction(dt) {
    const dog = this.dog;
    const h = dog.held;
    if (!h) return;
    const k = h.kind;
    h.data.shakeT = (h.data.shakeT || 0) + dt;
    if (k === 'slipper' || k === 'book') {
      dog.chewing = true;
      dog.shaking = false;
      h.data.chewT = (h.data.chewT ?? 0.1) - dt;
      if (h.data.chewT <= 0) {
        h.data.chewT = 0.3;
        audio.play('chew');
        const p = dog.mouthWorld.clone();
        h.data.chews = (h.data.chews || 0) + 1;
        if (k === 'slipper') {
          if (h.data.chews <= 6) this.damage({ key: 'slipper', label: 'スリッパ', yen: 150, pos: p, small: true });
          if (h.data.chews === 6) {
            this.addSlipperHoles(h);
            this.damage({ key: 'slipper', label: '穴あきスリッパ', yen: 1000, pos: p, chain: true, count: 1 });
            this.incident('chew', p);
            this.fx.bitsBurst(p, 6, [0xe3cdb0, 0xf3ead9], 1, true, 0.6);
          }
        } else if (h.data.chews <= 8) {
          this.damage({ key: 'book', label: '本', yen: 100, pos: p, small: true });
          this.fx.bitsBurst(p, 2, [0xfffaf0], 0.8, true, 0.6);
          if (h.data.chews === 8) this.damage({ key: 'book', label: 'ボロボロの本', yen: 800, pos: p, chain: true, count: 1 });
        }
      }
      return;
    }
    dog.shaking = true;
    dog.chewing = false;
    if (k === 'cushion' && !h.data.burst) {
      h.data.fluffT = (h.data.fluffT ?? 0.05) - dt;
      if (h.data.fluffT <= 0) {
        h.data.fluffT = 0.2;
        const p = new THREE.Vector3();
        h.mesh.getWorldPosition(p);
        this.fx.fluffBurst(p, 3, 1.2);
        audio.play('fluff');
        h.hp--;
        this.damage({ key: 'cushion', label: 'クッション', yen: 80, pos: p, small: true });
        this.done.cushion = true;
        if (h.hp <= 0) {
          h.data.burst = true;
          this.fx.fluffBurst(p, 40, 2.4);
          audio.play('burst');
          const body = h.mesh.userData.body;
          if (body) body.scale.set(1.12, 0.35, 1.12);
          h.label = 'ぺちゃんこクッション';
          this.damage({ key: 'cushion', label: 'クッション破裂', yen: 1800, pos: p, chain: true, count: 1 });
          this.incident('fluff', p);
          this.shakeAmt = 1;
        }
      }
    } else if (k === 'teddy') {
      h.data.sq = (h.data.sq ?? 0) - dt;
      if (h.data.sq <= 0) { h.data.sq = 0.35; audio.play('whine'); }
    }
  }

  addSlipperHoles(h) {
    const cover = h.mesh.userData.cover;
    if (!cover || h.data.holes) return;
    h.data.holes = true;
    const m = new THREE.MeshBasicMaterial({ color: 0x8a6d5c });
    for (const [x, z] of [[0.03, 0.02], [-0.025, -0.03]]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), m);
      hole.position.set(x, 0.07, 0.06 + z);
      hole.rotation.x = -Math.PI / 2;
      h.mesh.add(hole);
    }
    h.label = '穴あきスリッパ';
  }

  // ------------------------------------------------------------
  // 毎フレーム
  // ------------------------------------------------------------
  update(rawDt) {
    // ヒットストップ：大きな連鎖の瞬間だけ時間をゆっくりに
    let dt = rawDt;
    if (this.hitStop > 0) { this.hitStop -= rawDt; dt = rawDt * 0.25; }
    if (this.zoomT > 0) this.zoomT -= rawDt;
    this.camRig.zoom = damp(this.camRig.zoom, this.zoomT > 0 && this.state === 'play' ? 1.14 : 1, 2.5, rawDt);
    this.time += dt;
    this.stateT += dt;
    const dog = this.dog;
    const input = this.input;
    input.poll(rawDt);

    switch (this.state) {
      case 'title':
        dog.update(dt, { x: 0, z: 0 }, null);
        this.fx.update(dt, dog.headWorld, true);
        break;
      case 'custom':
        dog.update(dt, { x: 0, z: 0 }, null);
        // 時々カメラを見て首をかしげる
        dog.tiltTarget = Math.sin(this.time * 0.7) > 0.6 ? 0.28 : 0;
        dog.lookAt = this.camera.position.clone();
        this.fx.update(dt, dog.headWorld, false);
        break;
      case 'intro':
        this.updateIntro(dt);
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      case 'ending':
        this.updateEnding(dt);
        break;
      case 'report':
      case 'paused':
        this.fx.update(dt, dog.headWorld, dog.isNapping);
        break;
    }
    this.world.update(this.state === 'paused' ? 0 : dt);
    this.shakeAmt = damp(this.shakeAmt, 0, 5, dt);
    this.camRig.shake = this.shakeAmt;
    this.updateHints(dt);
    input.endFrame();
  }

  updateIntro(dt) {
    const dog = this.dog;
    const t = this.stateT;
    // ドアが閉まる
    const door = this.room.doorPivot;
    if (t > 0.5) door.rotation.y = damp(door.rotation.y, 0, 5, dt);
    if (t > 1.0 && !this.introClosed) { this.introClosed = true; audio.play('door'); dog.setExpr('guilty'); }
    if (t > 1.9 && !this.introTurn) {
      this.introTurn = true;
      dog.setExpr('happy');
      dog.lookAt = this.camera.position.clone();
      dog.tiltTarget = 0.3;
      this.ui.banner('……チャンス？', false, 'mint');
    }
    dog.update(dt, { x: 0, z: 0 }, this.world);
    this.fx.update(dt, dog.headWorld, false);
    if (t > 3.2) {
      this.introClosed = false;
      this.introTurn = false;
      dog.tiltTarget = 0;
      this.beginPlay();
    }
  }

  moveVector() {
    // 画面の入力をカメラ基準でワールドXZへ
    const m = this.input.move;
    const f = this.camRig.forward, r = this.camRig.right;
    return { x: r.x * m.x - f.x * m.y, z: r.z * m.x - f.z * m.y };
  }

  updatePlay(dt) {
    const dog = this.dog;
    const input = this.input;
    const world = this.world;
    const napping = dog.isNapping;
    const speedUp = napping ? 4 : 1;
    this.runT += dt * speedUp;
    const left = RUN_SECONDS - this.runT;

    // 入力
    const mv = this.moveVector();
    const hasMove = Math.hypot(mv.x, mv.z) > 0.05;
    if (hasMove || input.actPressed || input.dashPressed || input.actDown) {
      if (this.idle > 0.5 && napping) { dog.setExpr('happy'); dog.hop(1.2); audio.play('ui'); }
      this.idle = 0;
      if (dog.expr === 'sleep') dog.setExpr('happy');
    } else this.idle += dt;

    // くわえる／はなす
    if (input.actPressed) {
      if (!dog.held) {
        const t = world.findGrabTarget(dog.front, 0.42);
        if (t) this.grab(t);
        else { dog.hop(0.9); audio.play('bark', 1.1); this.actHeldAtPress = false; }
        this.actHeldAtPress = false;
      } else {
        this.actHeldAtPress = true;
      }
    }
    if (dog.held && this.actHeldAtPress && input.actDown && input.actHold > HOLD_T) {
      this.holdAction(dt);
    } else {
      dog.shaking = false;
      dog.chewing = false;
    }
    if (input.actReleased && this.actHeldAtPress && dog.held) {
      const long = input.actHold > HOLD_T;
      const k = dog.held.kind;
      if (long && k !== 'tissue') this.dropHeld(true);
      else if (!long) this.dropHeld(false);
      this.actHeldAtPress = false;
      if (long && k === 'tissue') { /* ティッシュはぶんぶんしてもくわえたまま */ }
    }
    if (input.dashPressed) {
      if (dog.tryDash(hasMove ? new THREE.Vector3(mv.x, 0, mv.z) : null)) {
        this.fx.dustPuff(dog.pos, 4, 0.6);
        this.done.dash = true;
        this.clearHint('dash');
      }
    }

    dog.update(dt, mv, world);

    // ティッシュ
    const tis = world.tissue;
    if (dog.held && dog.held.kind === 'tissue') {
      const n = tis.update(dt, dog.mouthWorld, this);
      if (n > 0) {
        audio.play('tissue');
        this.damage({ key: 'tissue', label: 'ティッシュ', yen: TISSUE_YEN * n, pos: dog.mouthWorld.clone().setY(0.35), count: n, small: true });
        if (tis.active && tis.active.len > 3) this.clearHint('pull');
        if (tis.active && tis.active.len >= 10) this.incident('tissue10', dog.mouthWorld.clone());
      }
      if (tis.empty) {
        this.incident('tissueEmpty', tis.box.pos.clone().setY(0.3));
        this.fx.popup(tis.box.pos.clone().setY(0.4), 'からっぽ！', 'label');
        this.dropHeld(false);
      } else if (tis.full) {
        this.dropHeld(false);
      }
    } else {
      tis.update(dt, dog.mouthWorld, null);
    }

    // 対象リングとボタン表示
    let target = null;
    if (!dog.held) target = world.findGrabTarget(dog.front, 0.42);
    if (target) {
      const p = world.grabTargetPos(target);
      this.fx.showRing(p, target === 'tissue' ? 0.22 : Math.max(0.16, target.r + 0.05));
    } else this.fx.showRing(null);
    this.ui.setAct(dog.held, !!target, dog.shaking || dog.chewing, target);
    this.ui.setDashReady(dog.dashCD <= 0);

    // 最初のガイド
    if (!this.done.tissue && this.stateT > 0.6) {
      if (!tis.empty) this.fx.setGuide(tis.box.pos.clone().setY(0.55));
      if (target === 'tissue') this.queueHint('【くわえる】でティッシュをくわえる', 'grab', 5);
    }
    this.moved += dog.speed * dt;
    if (this.moved > 1.2) this.clearHint('move');
    if (this.stateT > 30 && !this.done.dash) this.queueHint('【はしる】で体当たり！ 何かが倒れるかも', 'dash', 4);

    // 待機中のしぐさ
    this.idleBehavior(dt);

    // 状態表示
    let status = 'おるすばん中', lvl = '';
    if (dog.held) status = dog.shaking ? 'ぶんぶん中！' : dog.chewing ? 'かみかみ中' : `${dog.held.label}をくわえている`;
    if (dog.isNapping) status = world.inSun(dog.pos.x, dog.pos.z) ? 'ひなたでうとうと' : 'おひるね中';
    if (left < WARN_LEFT) { status = '足音が…！'; lvl = 'alert'; }
    else if (left < WARN_LEFT + 15) lvl = 'warn';
    this.ui.setStatus(status, lvl);

    // 時計・帰宅の気配
    this.ui.setClock(this.clockText(this.runT), this.runT / RUN_SECONDS, left < WARN_LEFT);
    this.room.clockHands.min.rotation.z = -((START_MIN + (END_MIN - START_MIN) * this.runT / RUN_SECONDS) % 60) / 60 * Math.PI * 2;
    this.room.clockHands.hour.rotation.z = -(((START_MIN + (END_MIN - START_MIN) * this.runT / RUN_SECONDS) / 60) % 12) / 12 * Math.PI * 2;
    if (left < WARN_LEFT) {
      if (!this.warned) {
        this.warned = true;
        this.ui.banner('……足音！？ ご主人が帰ってくる！', false);
        this.queueHint('ベッドにもどって しらんぷり？ それとも あと1連鎖？', 'warn', 6);
        audio.stopBgm(1.2);
        dog.startle(new THREE.Vector3(DOOR.x, 1, ROOM.minZ), 2);
        if (dog.isNapping) dog.setPose('stand');
        this.hintCur = null;
      }
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.55;
        audio.play('step', clamp(1 - left / WARN_LEFT, 0.2, 1));
      }
      if (left < 2.2 && !this.keysPlayed) { this.keysPlayed = true; audio.play('keys'); }
    }
    if (left <= 0) this.startEnding();

    this.fx.update(dt, dog.headWorld, dog.isNapping);
  }

  idleBehavior(dt) {
    const dog = this.dog;
    const world = this.world;
    const idle = this.idle;
    if (dog.held || this.state !== 'play') { this.fx.showBubble(null); return; }
    if (idle < 1.0) { this.fx.showBubble(null); if (!dog.lookHold) dog.lookAt = null; dog.tiltTarget = 0; return; }
    const interest = world.interestFor(dog.pos, this.done);
    const inSun = world.inSun(dog.pos.x, dog.pos.z);
    const inBed = world.isInBed(dog.pos.x, dog.pos.z);
    // 考えごと（次のいたずらのヒント）
    if (interest && idle > 1.2 && idle < 9 && !dog.isNapping) {
      this.fx.showBubble(interest.key, dog.headWorld.clone().add(new THREE.Vector3(0.22, 0.35, 0)));
    } else this.fx.showBubble(null);
    // ちらっと見る → カメラ（見られてないか確認） → 戻す
    const cyc = idle % 5;
    if (!dog.lookHold) {
      if (cyc < 2.2 && interest) { dog.lookAt = interest.pos.clone().setY(0.3); dog.tiltTarget = 0; }
      else if (cyc < 3.2) { dog.lookAt = this.camera.position.clone(); dog.tiltTarget = 0.25; }
      else dog.lookAt = null;
    }
    if (idle > 3.5 && dog.poseTarget === 'stand') dog.setPose('sit');
    if (idle > 6.5 && (inSun || inBed) && dog.poseTarget !== 'lie') {
      dog.setPose('lie');
      dog.setExpr('sleep');
      audio.setBgmMood('sleep');
      this.fx.showBubble(null);
    }
    if (dog.isNapping) {
      this.napT += dt;
      dog.lookAt = null;
      if (this.napT > 2.5) this.incident('nap', dog.headWorld.clone());
      if (Math.floor(this.time * 0.8) !== Math.floor((this.time - dt) * 0.8)) audio.play('snore');
    } else {
      this.napT = 0;
      if (audio.bgmLevel !== 1 && this.runT < RUN_SECONDS - WARN_LEFT) audio.setBgmMood('normal');
    }
  }

  // ------------------------------------------------------------
  // 帰宅
  // ------------------------------------------------------------
  startEnding() {
    const dog = this.dog;
    const world = this.world;
    this.state = 'ending';
    this.stateT = 0;
    this.input.enabled = false;
    this.input.reset();
    this.ui.hint(null);
    this.fx.showBubble(null);
    this.fx.showRing(null);
    this.fx.setGuide(null);
    dog.locked = true;
    dog.shaking = false;
    dog.chewing = false;
    dog.dashT = 0;

    const held = dog.held;
    const inBed = world.isInBed(dog.pos.x, dog.pos.z, 0.1);
    const napping = dog.isNapping;
    let verdict;
    if (this.total === 0) verdict = 'goodboy';
    else if (held) verdict = 'caught';
    else if (inBed) verdict = 'innocent';
    else if (napping) verdict = 'nap';
    else verdict = 'scene';
    this.verdict = verdict;
    this.heldLabel = held ? held.label : null;

    // お宝ボーナス
    const tre = world.treasures();
    this.treasureN = tre.length;
    const pct = Math.min(0.5, tre.length * 0.1);
    if (pct > 0 && this.total > 0) {
      const add = Math.round((this.total * pct) / 10) * 10;
      this.total += add;
      this.ledger._treasure = { label: `お宝ボーナス（${tre.length}こ）`, count: 0, yen: add, bonus: true };
    }
    if (verdict === 'caught') this.incident('caught');
    if (verdict === 'innocent' && this.total >= 10000) this.incident('innocent');
    if (verdict === 'goodboy') this.incident('goodboy');
    if (this.total >= 30000) this.incident('big30k');
    this.ui.setYen(this.total, true);

    audio.stopBgm(0.3);
    audio.play('door');
    this.room.owner.visible = true;
    this.chooseCineAngle();
    this.camRig.setMode('cinematic', dog);
    this.ui.show('hud');
    this.ui.setCine(true);
    this.ui.setStatus('ご主人 帰宅', 'alert');
  }

  /** 犬の顔が家具に隠れない角度を探す */
  chooseCineAngle() {
    const dog = this.dog;
    const ray = new THREE.Raycaster();
    const targets = [this.world.group, this.room.group];
    const dist = this.camRig.portrait ? 2.7 : 2.0;
    const head = dog.headWorld.clone();
    const body = dog.pos.clone().setY(0.25);
    const ok = (o) => o.visible && !o.isPoints && !o.isSprite && o.material && !o.material.transparent;
    let best = 0, bestHits = Infinity;
    for (const a of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 2.2, -2.2]) {
      for (const dd of [dist, dist * 0.7]) {
        const cam = new THREE.Vector3(dog.pos.x + Math.sin(a) * dd, 1.05, dog.pos.z + Math.cos(a) * dd);
        if (cam.x < ROOM.minX + 0.3 || cam.x > ROOM.maxX - 0.3 || cam.z < ROOM.minZ + 0.3) continue;
        let hits = 0;
        for (const tgt of [head, body]) {
          const dir = tgt.clone().sub(cam);
          const len = dir.length();
          ray.set(cam, dir.normalize());
          ray.far = len - 0.2;
          hits += ray.intersectObjects(targets, true).filter((h) => ok(h.object)).length;
        }
        if (hits < bestHits) { bestHits = hits; best = a; this.camRig.cineDist = dd; }
        if (hits === 0) { this.camRig.cineAngle = a; return; }
      }
    }
    this.camRig.cineAngle = best;
  }

  updateEnding(dt) {
    const dog = this.dog;
    const t = this.stateT;
    const door = this.room.doorPivot;
    door.rotation.y = damp(door.rotation.y, -1.3, 4, dt);
    if (t > 0.4 && !this.e1) {
      this.e1 = true;
      this.ui.banner('ただいま〜', false, 'mint');
    }
    if (t > 0.9 && !this.e2) {
      this.e2 = true;
      // くるっと振り向いて、無実の顔
      if (this.verdict !== 'nap') {
        dog.setPose(this.verdict === 'caught' ? 'stand' : 'sit');
        dog.setExpr('innocent');
        dog.tiltTarget = 0.28;
      }
      dog.lookAt = this.camera.position.clone();
      dog.lookHold = undefined;
      audio.play('sparkle');
    }
    if (this.e2 && this.verdict !== 'nap') {
      const want = Math.atan2(this.camera.position.x - dog.pos.x, this.camera.position.z - dog.pos.z);
      dog.heading = dampAngle(dog.heading, want, 8, dt);
      dog.lookAt = this.camera.position.clone();
      if (Math.random() < dt * 3) this.fx.sparkle(dog.headWorld, 2, 0.25);
    }
    if (t > 2.0 && !this.e3) {
      this.e3 = true;
      const line = OWNER_LINES.find(([v]) => this.total <= v)?.[1] || '…';
      this.ui.banner(line, false);
      if (this.total >= 10000) audio.play('surprise');
    }
    dog.update(dt, { x: 0, z: 0 }, this.world);
    this.fx.update(dt, dog.headWorld, dog.isNapping);
    if (t > 3.4 && !this.e4) {
      this.e4 = true;
      this.snapshot = this.onSnapshot?.();
    }
    if (t > 3.8) {
      this.e1 = this.e2 = this.e3 = this.e4 = false;
      this.finishRun();
    }
  }

  finishRun() {
    this.state = 'report';
    const sv = getSave();
    sv.plays++;
    const prevBest = sv.best.yen;
    const isBest = this.total > prevBest;
    if (isBest) sv.best.yen = this.total;
    sv.best.chain = Math.max(sv.best.chain, this.maxChain);
    save();
    const caption = this.caption();
    this.result = {
      name: this.dog.params.name,
      total: this.total,
      isBest,
      prevBest,
      verdict: this.verdict,
      verdictLabel: { caught: '現行犯', innocent: 'しらんぷり成功', nap: 'おひるね中', scene: '現場にいた', goodboy: 'いい子でした' }[this.verdict],
      caption,
      ledger: this.ledger,
      maxChain: this.maxChain,
      incidents: [...this.runIncidents],
      newIncidents: this.newIncidents,
      odai: this.odai,
      odaiDone: this.odaiDone,
      kawaii: 100 + (this.verdict === 'innocent' ? 20 : 0) + (this.verdict === 'nap' ? 10 : 0) + (this.verdict === 'goodboy' ? 50 : 0) + Math.min(30, this.maxChain * 3),
      hansei: this.verdict === 'caught' ? 3 : 0,
      photo: this.snapshot,
      events: this.events,
    };
    this.ui.showReport(this.result);
  }

  caption() {
    const n = this.dog.params.name;
    switch (this.verdict) {
      case 'caught': return pick([`${this.heldLabel}が、口に入ってきました。`, `これは…${this.heldLabel}がかってに。`]);
      case 'innocent': return pick(['ずっとここで寝てました。', 'なんのことですか？', 'ぼくはずっとベッドにいました。']);
      case 'nap': return pick(['何も知らない寝顔。', 'すやすや…（犯行後）']);
      case 'goodboy': return '今日はほんとうにいい子でした。…ほんとに？';
      default: return this.biggest ? `${this.biggest.label.replace(/^(大きな)/, '')}が先にしかけてきました。` : `${n}は何も見ていません。`;
    }
  }
}
