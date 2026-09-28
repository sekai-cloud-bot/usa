import * as THREE from 'three';
import { audio } from './audio.js';
import { getSave, save } from './save.js';
import { Brain } from './ai.js';
import { evaluateShot, cropLimits } from './photo.js';
import { MOMENTS, MOMENT_MAP, PERSONALITY_MAP } from './moments.js';
import { LAYOUT, TISSUE_YEN } from './world.js';
import { BED, DOOR, ROOM } from './room.js';
import { clamp, damp, rand, pick, isTouchDevice } from './util.js';

export const SESSION = 150;     // 昼休み（秒）
export const FILM = 15;         // 撮影枠
export const TREATS = 5;
export const LASER_MAX = 12;    // レーザーの電池（秒）
const START_MIN = 12 * 60;
const END_MIN = 13 * 60;

const SFX = {
  plant: 'ガシャーン！', lamp: 'ガッシャーン！', trash: 'ガラガラッ', basket: 'ドサッ', box: 'ドン！',
  mug: 'パリーン！', book: 'バサッ', cushion: 'ボフッ！', slipper: 'ガジガジ', wrap: 'ぐるぐる',
};

const _v = new THREE.Vector3();

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, camera, camRig, world, dog, fx, ui, input, renderer, room, capture
    this.state = 'boot';
    this.time = 0;
    this.stateT = 0;
    this.runT = 0;
    this.world.game = this;
    this.brain = new Brain(this);
    this.touch = isTouchDevice();
    this.hintQueue = [];
    this.hintCur = null;
    this.hintT = 0;
    this.hintSeen = {};
    this.photos = [];
    this.total = 0;
    // くわえたティッシュ
    const th = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
    th.scale.set(1.2, 0.7, 1);
    this.tissueHandle = th;
    // レーザーの点
    const dot = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshBasicMaterial({ color: 0xff3048, transparent: true, opacity: 0.95, depthWrite: false }));
    core.rotation.x = -Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: 0xff5068, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    dot.add(core, glow);
    dot.visible = false;
    dot.renderOrder = 6;
    this.scene.add(dot);
    this.laser = { on: false, pos: null, battery: LASER_MAX, mesh: dot, p: new THREE.Vector3() };

    this.input.onPan = (dx, dy) => { if (this.state === 'play') this.camRig.panByPixels(dx, dy); };
    this.input.onZoom = (f) => { if (this.state === 'play') this.camRig.zoomBy(f); };
    this.input.onAction = (a) => this.action(a);
  }

  // ------------------------------------------------------------
  // 状態遷移
  // ------------------------------------------------------------
  resetRoom() {
    this.dropHeld(false, true);
    this.world.reset();
    this.fx.clear();
    this.room.owner.visible = false;
    this.room.doorPivot.rotation.y = 0;
    this.setLaser(false);
    this.room.devices.forEach((d) => { d.visible = true; });
  }

  toTitle() {
    this.state = 'title';
    this.stateT = 0;
    this.input.enabled = false;
    this.input.reset();
    this.resetRoom();
    this.dog.place(BED.x - 0.05, BED.z + 0.05, 0.5);
    this.dog.setPose('lie');
    this.dog.pose.lie = 1;
    this.dog.setExpr('sleep');
    this.dog.locked = true;
    this.camRig.setMode('overview');
    this.ui.show('title');
    audio.stopBgm();
  }

  toCustom() {
    this.state = 'custom';
    this.stateT = 0;
    this.input.enabled = false;
    this.resetRoom();
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
    this.world.setup = sv.plays;
    this.resetRoom();
    const [sx, sz] = pick([[1.6, 0.4], [-0.5, 1.7], [2.2, -1.1], [-2.6, -1.3], [0.3, 0.2]]);
    this.dog.place(sx, sz, rand(0, Math.PI * 2));
    this.dog.setPose('sit');
    this.dog.setExpr('happy');
    this.dog.locked = false;
    this.dog.lookAt = null;
    const pers = PERSONALITY_MAP[this.dog.params.personality] || PERSONALITY_MAP.amaenbo;
    this.brain.reset(pers);
    this.camRig.resetPetcam(0);
    this.camRig.setMode('petcam', this.dog, true);
    this.camRig.aimAt(this.dog.pos.clone().setY(0.3));
    this.camRig.yaw = this.camRig.tYaw;
    this.camRig.pitch = this.camRig.tPitch;
    this.updateDevices();

    this.runT = 0;
    this.film = FILM;
    this.treats = TREATS;
    this.laser.battery = LASER_MAX;
    this.photos = [];
    this.total = 0;
    this.ledger = {};
    this.lastBurst = null;
    this.doorbellAt = rand(55, 95);
    this.doorbellDone = false;
    this.callCD = 0;
    this.hintQueue = [];
    this.hintCur = null;
    this.expert = sv.plays >= 3;
    this.firstTelegraph = true;

    this.ui.show('hud');
    this.ui.resetHud(this.dog.params.name, FILM, TREATS);
    this.ui.setCamName(this.camRig.petcam.name);
    this.ui.setCine(true);
    this.ui.bootCam();
    audio.play('static');
    audio.startBgm();
  }

  beginPlay() {
    this.state = 'play';
    this.stateT = 0;
    this.input.enabled = true;
    this.input.reset();
    this.ui.setCine(false);
    this.queueHint(this.touch ? 'なぞってカメラの向きを変える ・ 2本指でズーム' : 'ドラッグ／矢印キーでカメラの向き ・ ホイール／Q・Eでズーム', 'pan', 5);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.ui.show('pause', true);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.input.enabled = true;
    this.ui.hide('pause');
  }

  updateDevices() {
    const petcam = this.camRig.mode === 'petcam';
    this.room.devices.forEach((d, i) => { d.visible = !petcam || i !== this.camRig.camIndex; });
  }

  // ------------------------------------------------------------
  // 時計・ヒント
  // ------------------------------------------------------------
  clockText(t) {
    const m = START_MIN + (END_MIN - START_MIN) * clamp(t / SESSION, 0, 1);
    return `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }

  queueHint(html, id, dur = 4.5) {
    if (id && this.hintSeen[id]) return;
    if (this.expert) return;
    if (id) this.hintSeen[id] = true;
    this.hintQueue.push({ html, id, dur });
  }
  updateHints(dt) {
    if (this.hintCur) {
      this.hintT -= dt;
      if (this.hintT <= 0) { this.hintCur = null; this.ui.hint(null); }
    } else if (this.hintQueue.length && this.state === 'play') {
      this.hintCur = this.hintQueue.shift();
      this.hintT = this.hintCur.dur;
      this.ui.hint(this.hintCur.html);
    }
  }

  // ------------------------------------------------------------
  // プレイヤーの操作
  // ------------------------------------------------------------
  action(a) {
    if (this.state !== 'play') return;
    audio.unlock();
    switch (a) {
      case 'shutter': this.shutter(); break;
      case 'treat': this.throwTreat(); break;
      case 'call': this.call(); break;
      case 'laser': this.setLaser(!this.laser.on); break;
      case 'find': this.findDog(); break;
      case 'switch': this.switchCam(); break;
    }
  }

  shutter() {
    if (this.film <= 0) { this.ui.toast('もう撮れません（のこり0枚）'); audio.play('ui'); return; }
    const res = evaluateShot(this);
    const url = this.capture(this.camera, 640, 480, res.blurred);
    this.film--;
    const photo = { ...res, url, time: this.clockText(this.runT) };
    this.photos.push(photo);
    this.ui.flash();
    audio.play('shutter');
    this.ui.showShot(photo);
    this.ui.setFilm(this.film);
    if (res.stars >= 3) setTimeout(() => audio.play('sparkle'), 150);
    if (this.photos.length === 1) this.queueHint('決定的瞬間ほど★が増える。顔が写るとさらに◎', 'shot1', 4.5);
    if (res.blurred) this.queueHint('カメラを動かしながら撮るとブレる。止めてからパシャ', 'blur', 4);
    if (!res.isMoment && res.visible > 0.5) this.queueHint('何かしそうな時や、おもしろい瞬間をねらおう', 'plain', 4);
    if (this.film === 0) {
      this.ui.hint('撮影枠がいっぱい！ そのまま見守るか、右上の「おわる」で昼休みを終える');
      this.hintT = 6;
      this.hintCur = { id: 'filmout' };
    }
  }

  throwTreat() {
    if (this.treats <= 0) { this.ui.toast('おやつはもうありません'); return; }
    const target = this.camRig.floorPointAtCenter(new THREE.Vector3());
    if (!target) { this.ui.toast('床に向けて投げてね'); return; }
    target.x = clamp(target.x, ROOM.minX + 0.35, ROOM.maxX - 0.35);
    target.z = clamp(target.z, ROOM.minZ + 0.35, 3.1);
    const from = this.camRig.devicePos.clone();
    from.addScaledVector(_v.subVectors(target, from).normalize(), 0.25);
    const tr = this.world.spawnTreat(from, target);
    this.treats--;
    this.ui.setTreats(this.treats);
    audio.play('pop');
    this.brain.stimulus('treat', tr);
  }

  call() {
    if (this.callCD > 0) return;
    this.callCD = 1.4;
    audio.play('call');
    this.ui.speech(`${this.dog.params.name}〜！`);
    this.brain.stimulus('call');
  }

  setLaser(on) {
    if (on && this.laser.battery <= 0.2) { this.ui.toast('レーザーの電池切れ'); return; }
    this.laser.on = on;
    this.laser.mesh.visible = false;
    this.ui.setLaser(on, this.laser.battery / LASER_MAX);
    if (on) {
      audio.play('ui');
      this.updateLaser(0);
      this.brain.stimulus('laser');
    }
  }
  updateLaser(dt) {
    const L = this.laser;
    if (!L.on) { L.mesh.visible = false; L.pos = null; return; }
    L.battery -= dt;
    const p = this.camRig.floorPointAtCenter(L.p);
    if (p && p.x > ROOM.minX + 0.05 && p.x < ROOM.maxX - 0.05 && p.z > ROOM.minZ + 0.05 && p.z < 3.3) {
      L.pos = p;
      L.mesh.position.set(p.x, 0.012, p.z);
      L.mesh.visible = true;
      const s = 1 + 0.15 * Math.sin(this.time * 20);
      L.mesh.scale.set(s, s, s);
    } else {
      L.pos = null;
      L.mesh.visible = false;
    }
    if (L.battery <= 0) { L.battery = 0; this.setLaser(false); this.ui.toast('レーザーの電池切れ'); }
    this.ui.setLaser(L.on, L.battery / LASER_MAX);
  }

  findDog() {
    this.camRig.aimAt(this.dog.pos.clone().setY(0.3), 2.2);
    audio.play('ui');
  }

  switchCam() {
    this.camRig.switchCam();
    this.updateDevices();
    this.ui.setCamName(this.camRig.petcam.name);
    this.ui.staticFx();
    audio.play('static');
  }

  camPos() { return this.camRig.devicePos.clone(); }

  // ------------------------------------------------------------
  // 画面内判定と「音の方向」
  // ------------------------------------------------------------
  inView(pos) {
    const L = cropLimits(this.camera.aspect);
    _v.copy(pos).project(this.camera);
    return _v.z < 1 && Math.abs(_v.x) <= L.lx && Math.abs(_v.y) <= L.ly;
  }
  alertAt(pos, text) {
    _v.copy(pos).project(this.camera);
    let x = _v.x, y = _v.y;
    if (_v.z > 1) { x = -x; y = -y; }
    this.ui.edgeAlert(Math.atan2(y, x), text);
  }
  sfx(pos, text) {
    if (this.state !== 'play') return;
    if (this.inView(pos)) this.fx.popup(pos, text, 'sfx');
    else this.alertAt(pos, text);
  }

  // ------------------------------------------------------------
  // 部屋からの通知
  // ------------------------------------------------------------
  damage({ key, label, yen: base, pos, count = 0, small = false }) {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.total += base;
    const L = this.ledger[key] || (this.ledger[key] = { label, count: 0, yen: 0 });
    L.count += count;
    L.yen += base;
    if (!small && pos) this.sfx(pos, SFX[key] || 'ガタン！');
    this.ui.setDamage(this.total);
  }
  incident(id, pos) {
    if (id === 'fluff' && pos) this.lastBurst = { t: this.world.time, pos: pos.clone() };
    if (id === 'trash' && pos) this.brain.stimulus('noise', { pos, kind: 'trash' });
  }
  react(pos, level) {
    if (this.state !== 'play') return;
    if (['idle', 'wander', 'window', 'lookcam', 'nap'].includes(this.brain.name)) this.dog.startle(pos, level);
    this.brain.stimulus('noise', { pos, kind: 'fall' });
  }
  onWobble(t) {
    if (this.inView(t.pos)) this.fx.popup(t.pos.clone().setY(t.h + 0.1), 'グラッ…', 'label');
  }
  onTableWobble() {
    if (this.inView(this.world.mug.pos)) this.fx.popup(this.world.mug.pos.clone().setY(0.7), 'カタカタ…', 'label');
  }
  onTreasure(m) {
    if (this.state !== 'play') return;
    const p = new THREE.Vector3(BED.x, 0.55, BED.z);
    if (this.inView(p)) this.fx.popup(p, `お宝：${m.label}`, 'label mint');
  }
  onWrap(pos) {
    this.damage({ key: 'wrap', label: 'テーブルぐるぐる巻き', yen: 1500, pos, count: 1 });
  }
  onToppleStart(t) {
    if (this.state === 'play' && !this.inView(t.pos)) this.alertAt(t.pos, SFX[t.kind] || 'ガタン！');
  }
  onTelegraph(pos, c) {
    if (this.state !== 'play') return;
    if (!this.inView(this.dog.pos.clone().setY(0.3))) {
      this.alertAt(this.dog.pos, `うずうず…（${c.label}）`);
      audio.play('ping');
    }
    if (this.firstTelegraph) {
      this.firstTelegraph = false;
      this.queueHint('おしりが上がったら、いたずらの合図！ カメラを向けて待ちかまえよう', 'bow', 5);
    }
  }
  onTreatLanded() {}
  eatTreat(tr, caught) {
    this.world.removeMovable(tr);
    audio.play('crunch');
    if (caught) {
      this.fx.sparkle(this.dog.headWorld, 8, 0.25);
      if (this.inView(this.dog.headWorld)) this.fx.popup(this.dog.headWorld.clone().setY(this.dog.headWorld.y + 0.2), 'パクッ！', 'sfx');
    }
  }

  // ------------------------------------------------------------
  // くわえる・はなす（AIから呼ばれる）
  // ------------------------------------------------------------
  grab(target) {
    const dog = this.dog;
    if (target === 'tissue') {
      this.world.tissue.start(dog.mouthWorld);
      dog.rig.mouth.add(this.tissueHandle);
      this.tissueHandle.position.set(0, -0.02, 0.03);
      dog.held = { kind: 'tissue', label: 'ティッシュ', mesh: this.tissueHandle, data: {} };
    } else {
      this.world.attachHeld(target, dog.rig.mouth);
      dog.held = target;
    }
    audio.play('grab', 1 + Math.random() * 0.2);
    dog.excite = 1;
    dog.squash = 0.5;
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
        h.data.chews = (h.data.chews || 0) + 1;
        const p = dog.mouthWorld.clone();
        if (k === 'slipper' && h.data.chews <= 6) this.damage({ key: 'slipper', label: 'スリッパ', yen: 150, pos: p, small: true });
        if (k === 'slipper' && h.data.chews === 6) {
          this.addSlipperHoles(h);
          this.damage({ key: 'slipper', label: '穴あきスリッパ', yen: 1000, pos: p, count: 1 });
          this.fx.bitsBurst(p, 6, [0xe3cdb0, 0xf3ead9], 1, true, 0.6);
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
        if (h.hp <= 0) {
          h.data.burst = true;
          this.fx.fluffBurst(p, 40, 2.4);
          audio.play('burst');
          const body = h.mesh.userData.body;
          if (body) body.scale.set(1.12, 0.35, 1.12);
          h.label = 'ぺちゃんこクッション';
          this.damage({ key: 'cushion', label: 'クッション破裂', yen: 1800, pos: p, count: 1 });
          this.incident('fluff', p);
        }
      }
    } else if (k === 'teddy') {
      h.data.sq = (h.data.sq ?? 0) - dt;
      if (h.data.sq <= 0) { h.data.sq = 0.35; audio.play('whine'); }
    }
  }

  addSlipperHoles(h) {
    if (h.data.holes) return;
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
  update(dt) {
    this.time += dt;
    this.stateT += dt;
    const dog = this.dog;
    switch (this.state) {
      case 'title':
        dog.update(dt, { x: 0, z: 0 }, null);
        this.fx.update(dt, dog.headWorld, true);
        break;
      case 'custom':
        dog.update(dt, { x: 0, z: 0 }, null);
        dog.tiltTarget = Math.sin(this.time * 0.7) > 0.6 ? 0.28 : 0;
        dog.lookAt = this.camera.position.clone();
        this.fx.update(dt, dog.headWorld, false);
        break;
      case 'intro':
        this.brain.update(dt);
        dog.update(dt, this.brain.move, this.world);
        this.fx.update(dt, dog.headWorld, dog.isNapping);
        if (this.stateT > 1.4) this.beginPlay();
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      default:
        this.fx.update(dt, dog.headWorld, dog.isNapping);
    }
    this.world.update(this.state === 'paused' || this.state === 'album' ? 0 : dt);
    this.updateHints(dt);
  }

  updatePlay(dt) {
    const dog = this.dog;
    const world = this.world;
    const ax = this.input.axes();
    if (ax.x || ax.y) this.camRig.panBy(ax.x, ax.y, dt);
    if (ax.z) this.camRig.zoomBy(Math.exp(ax.z * dt * 1.6));
    this.runT += dt;
    if (this.callCD > 0) this.callCD -= dt;

    this.brain.update(dt);
    dog.update(dt, this.brain.move, world);

    // ティッシュ
    const tis = world.tissue;
    if (dog.held && dog.held.kind === 'tissue') {
      const n = tis.update(dt, dog.mouthWorld, this);
      if (n > 0) {
        audio.play('tissue');
        this.damage({ key: 'tissue', label: 'ティッシュ', yen: TISSUE_YEN * n, pos: dog.mouthWorld, count: n, small: true });
      }
      if (tis.empty || tis.full) this.dropHeld(false);
    } else {
      tis.update(dt, dog.mouthWorld, null);
    }

    this.updateLaser(dt);

    // 考えごとの吹き出し
    if (this.brain.icon && !dog.isNapping) this.fx.showBubble(this.brain.icon, dog.headWorld.clone().add(new THREE.Vector3(0.2, 0.34, 0)));
    else this.fx.showBubble(null);

    // インターホン
    if (!this.doorbellDone && this.runT > this.doorbellAt) {
      this.doorbellDone = true;
      audio.play('doorbell');
      this.ui.banner('ピンポーン（宅配便）', 'mint');
      this.brain.stimulus('doorbell');
      if (!this.inView(new THREE.Vector3(DOOR.x, 1, ROOM.minZ))) this.alertAt(new THREE.Vector3(DOOR.x, 1, ROOM.minZ), 'ピンポーン');
    }

    // ヒント
    if (this.stateT > 7) this.queueHint('うちの子を枠に入れて、右下のシャッター！', 'shoot', 4.5);
    if (this.stateT > 26 && this.treats === TREATS) this.queueHint('おやつは画面の中心に飛ぶ。うちの子を好きな場所に呼べる', 'treat', 5);
    if (this.stateT > 46) this.queueHint('【よぶ】で名前を呼ぶとこっちを見る。いたずらの直後に呼ぶと…？', 'call', 5);

    // HUD
    this.ui.setStatus(this.brain.intent);
    this.ui.setClock(this.clockText(this.runT), this.runT / SESSION);
    this.ui.setZoom(this.camRig.zoom);
    if (this.runT >= SESSION) this.finish();

    this.fx.update(dt, dog.headWorld, dog.isNapping);
  }

  // ------------------------------------------------------------
  // 昼休みおわり → アルバム
  // ------------------------------------------------------------
  finish() {
    if (this.state !== 'play' && this.state !== 'paused') return;
    this.state = 'album';
    this.input.enabled = false;
    this.input.reset();
    this.setLaser(false);
    this.fx.showBubble(null);
    this.ui.hint(null);
    audio.stopBgm(0.6);
    audio.play('fanfare');
    const sv = getSave();
    sv.plays++;
    const newIds = [];
    for (const p of this.photos) {
      if (!p.isMoment) continue;
      const cur = sv.album[p.id];
      if (!cur) newIds.push(p.id);
      if (!cur || p.score > cur.score) sv.album[p.id] = { stars: p.stars, score: p.score, thumb: null, at: Date.now(), url: p.url };
    }
    const bestScore = this.photos.reduce((m, p) => Math.max(m, p.score), 0);
    sv.best.score = Math.max(sv.best.score, bestScore);
    sv.best.total = Math.max(sv.best.total, this.photos.reduce((s, p) => s + p.score, 0));
    this.newIds = [...new Set(newIds)];
    // サムネイルを作って保存
    const jobs = Object.entries(sv.album).filter(([, v]) => v.url).map(([id, v]) => this.makeThumb(v.url).then((t) => { v.thumb = t; delete v.url; }));
    Promise.all(jobs).then(() => save());
    const pers = PERSONALITY_MAP[this.dog.params.personality];
    this.result = {
      name: this.dog.params.name,
      personality: pers ? pers.label : '',
      photos: this.photos,
      newIds: this.newIds,
      damage: this.total,
      ledger: this.ledger,
      treatsUsed: TREATS - this.treats,
    };
    this.ui.showAlbum(this.result);
  }

  makeThumb(url) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 180;
        c.getContext('2d').drawImage(img, 0, 0, 240, 180);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => res(null);
      img.src = url;
    });
  }

  collectionCount() {
    return Object.keys(getSave().album).filter((k) => MOMENT_MAP[k]).length;
  }
  totalMoments() { return MOMENTS.length; }
}
