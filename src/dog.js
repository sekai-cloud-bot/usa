import * as THREE from 'three';
import { buildDog, fitLeg } from './dogModel.js';
import { clamp, damp, dampAngle, lerp, rand, disposeObject } from './util.js';
import { audio } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * 犬の体（移動・当たり・手続きアニメーション・表情）。
 * 何をするかは AI（ai.js）が決め、move ベクトルや姿勢・表情を指示する。
 */
export class Dog {
  constructor(scene) {
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;
    this.radius = 0.2;
    this.t = 0;
    this.gait = 0;
    this.held = null;
    this.dashT = 0;
    this.dashCD = 0;
    this.pose = { sit: 0, lie: 0, bow: 0, belly: 0 };
    this.poseTarget = 'stand';
    this.expr = 'happy';
    this.blinkT = 2;
    this.blinking = 0;
    this.lookAt = null;
    this.lookHold = undefined;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.tilt = 0;
    this.tiltTarget = 0;
    this.excite = 0.5;
    this.hopY = 0;
    this.hopV = 0;
    this.shake = 0;
    this.shaking = false;
    this.chew = 0;
    this.chewing = false;
    this.earV = [0, 0];
    this.earA = [0, 0];
    this.squash = 0;
    this.bumpT = 0;
    this.sparkle = 0;
    this.surprise = 0;
    this.locked = false;
    this.speedMul = 1;
    this.yawnT = -1;     // あくびの進行（0..1.4秒）
    this.barkT = 0;
    this.reach = 0;      // ジャンプキャッチの前足
    this.sniff = 0;      // くんくん
    this.digging = false; // 穴ほり（冒険版）
    this.dig = 0;
    this.air = 0;         // 空中姿勢（冒険版のジャンプ）
    this.extraPitch = 0;
    this.mouthWorld = new THREE.Vector3();
    this.headWorld = new THREE.Vector3();
    this.headDir = new THREE.Vector3();
    this.front = new THREE.Vector3();
  }

  setParams(params) {
    const prevHeld = this.held;
    if (this.rig) {
      if (prevHeld && prevHeld.mesh && prevHeld.mesh.parent === this.rig.mouth) this.rig.mouth.remove(prevHeld.mesh);
      this.scene.remove(this.rig.root);
      disposeObject(this.rig.root);
    }
    this.params = params;
    this.rig = buildDog(params);
    this.scene.add(this.rig.root);
    const dm = this.rig.dims;
    this.rig.neck.userData.baseY = this.rig.neck.position.y;
    // 当たりの半径（大きい子ほど大きく。細い道で引っかからないように上限あり）
    this.radius = Math.min(0.34, dm.scale * (0.09 + Math.max(dm.rx, dm.rz) * 0.42));
    if (prevHeld && prevHeld.mesh) this.rig.mouth.add(prevHeld.mesh);
    this.syncRoot();
  }

  place(x, z, heading, y = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.dashT = 0;
    for (const k in this.pose) this.pose[k] = 0;
    this.poseTarget = 'stand';
    this.hopY = 0; this.hopV = 0;
    this.yawnT = -1;
    this.syncRoot();
  }

  get fwd() { return _w.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get isNapping() { return (this.poseTarget === 'lie' || this.poseTarget === 'belly') && this.expr === 'sleep' && (this.pose.lie + this.pose.belly) > 0.6; }
  get yawning() { return this.yawnT >= 0; }

  setPose(p) { this.poseTarget = p; }
  setExpr(e) { this.expr = e; }

  hop(v = 1.6) {
    if (this.hopY <= 0.001) this.hopV = v;
  }
  yawn() {
    if (this.yawnT < 0) { this.yawnT = 0; audio.play('yawn'); }
  }
  bark(pitch = 1) {
    this.barkT = 0.28;
    this.hop(0.9);
    audio.play('bark', pitch);
  }

  /** ものにぶつかった時の反応 */
  onBump(big, target) {
    if (big) {
      this.squash = 1;
      this.hop(1.3);
    } else {
      this.bumpT = 0.35;
      if (target) this.lookAt = target.pos.clone().setY(0.5);
    }
  }

  /** びっくり（近くで何かが起きた） */
  startle(pos, level = 1) {
    if (this.isNapping && level < 2) return;
    this.lookAt = pos.clone();
    this.lookHold = 1.2;
    if (level >= 2) { this.hop(1.9); this.surprise = 0.8; audio.play('surprise'); }
    else this.surprise = 0.5;
    this.excite = 1;
  }

  tryDash(dir) {
    if (this.dashCD > 0 || this.locked) return false;
    if (dir && dir.lengthSq() > 0.01) this.heading = Math.atan2(dir.x, dir.z);
    const f = this.fwd;
    this.dashT = 0.3;
    this.dashCD = 0.55;
    this.vel.set(f.x * 5.2, 0, f.z * 5.2);
    this.squash = -0.8;
    this.poseTarget = 'stand';
    audio.play('whoosh');
    return true;
  }

  /** move: ワールドXZの移動ベクトル（長さ0..1） */
  update(dt, move, world) {
    this.t += dt;
    const rig = this.rig;
    const d = rig.dims;
    if (this.dashCD > 0) this.dashCD -= dt;

    // ---- 移動 ----
    const inLen = this.locked ? 0 : Math.min(1, Math.hypot(move.x, move.z));
    const heavy = this.held && this.held.kind === 'cushion' ? 0.85 : 1;
    const maxSp = (1.25 + 1.35 * inLen) * heavy * this.speedMul;
    if (this.dashT > 0) {
      this.dashT -= dt;
      if (inLen > 0.1) this.heading = dampAngle(this.heading, Math.atan2(move.x, move.z), 5, dt);
      const f = this.fwd;
      const sp = 5.2 * Math.max(0.55, this.dashT / 0.3);
      this.vel.x = f.x * sp;
      this.vel.z = f.z * sp;
    } else {
      const tx = inLen > 0 ? (move.x / Math.max(inLen, 1e-5)) * maxSp * inLen : 0;
      const tz = inLen > 0 ? (move.z / Math.max(inLen, 1e-5)) * maxSp * inLen : 0;
      const lam = inLen > 0 ? 7 : 10;
      const wake = 1 - Math.max(this.pose.sit, this.pose.lie, this.pose.belly) * 0.7;
      this.vel.x = damp(this.vel.x, tx * wake, lam, dt);
      this.vel.z = damp(this.vel.z, tz * wake, lam, dt);
      if (this.bumpT > 0) { this.bumpT -= dt; this.vel.multiplyScalar(0.8); }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (world) world.resolveDog(this);

    const sp = this.speed;
    if (sp > 0.12 && this.dashT <= 0 && !this.shaking) {
      this.heading = dampAngle(this.heading, Math.atan2(this.vel.x, this.vel.z), 11, dt);
    }
    if (inLen > 0.1 || sp > 0.3) this.poseTarget = 'stand';

    // ---- 姿勢 ----
    const P = this.pose, T = this.poseTarget;
    P.sit = damp(P.sit, T === 'sit' ? 1 : 0, T === 'sit' ? 6 : 12, dt);
    P.lie = damp(P.lie, T === 'lie' ? 1 : 0, T === 'lie' ? 3 : 12, dt);
    P.bow = damp(P.bow, T === 'bow' ? 1 : 0, T === 'bow' ? 9 : 10, dt);
    P.belly = damp(P.belly, T === 'belly' ? 1 : 0, T === 'belly' ? 2.5 : 8, dt);
    this.shake = damp(this.shake, this.shaking ? 1 : 0, 14, dt);
    this.chew = damp(this.chew, this.chewing ? 1 : 0, 14, dt);
    this.squash = damp(this.squash, 0, 8, dt);
    this.tilt = damp(this.tilt, this.tiltTarget, 6, dt);
    this.sniff = Math.max(0, this.sniff - dt);
    this.dig = damp(this.dig, this.digging ? 1 : 0, 12, dt);
    if (this.surprise > 0) this.surprise -= dt;
    if (this.barkT > 0) this.barkT -= dt;
    let yawn = 0;
    if (this.yawnT >= 0) {
      this.yawnT += dt;
      const k = this.yawnT / 1.4;
      yawn = k < 0.35 ? k / 0.35 : k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
      if (this.yawnT > 1.4) this.yawnT = -1;
    }
    this.yawnAmt = yawn;

    // 小ジャンプ
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopV -= 14 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) { this.hopY = 0; this.hopV = 0; }
    }
    this.reach = damp(this.reach, this.hopY > 0.02 && this.reachWanted ? 1 : 0, 12, dt);

    // ---- 歩行 ----
    const dash = this.dashT > 0 ? 1 : 0;
    this.gait += dt * (5 + sp * 6.5);
    const amp = clamp(sp / 2.6, 0, 1) * (0.62 + 0.3 * dash);
    const g = this.gait;
    const s = Math.sin(g);
    const sit = P.sit, lie = P.lie, bow = P.bow, belly = P.belly;
    const breathe = Math.sin(this.t * 2.2) * 0.006 * (1 + lie + belly);

    const body = rig.body;
    // 足が地面から浮かないように、上下のゆれは小さく
    let y = lerp(d.bodyY, d.sitY, sit) + Math.abs(Math.sin(g)) * 0.008 * amp + breathe
      - lie * (d.bodyY - d.lieY) - bow * d.ry * 0.22 + this.hopY;
    y = y * (1 - belly) + (d.ry * 1.02 + breathe) * belly;
    body.position.y = y;
    body.position.z = -sit * d.rz * 0.12;
    const gallop = dash ? Math.sin(g) * 0.14 : 0;
    body.rotation.x = -d.sitPitch * sit + gallop + lie * 0.05 + bow * 0.36 - this.reach * 0.35 + this.dig * 0.32 + this.extraPitch;
    body.position.y -= this.dig * 0.03;
    body.rotation.y = bow * Math.sin(this.t * 13) * 0.14;
    body.rotation.z = Math.sin(g) * 0.05 * amp + Math.sin(this.t * 34) * 0.05 * this.shake
      + belly * (Math.PI * 0.9 + Math.sin(this.t * 1.8) * 0.1);
    const sq = this.squash;
    body.scale.set(1 + sq * 0.08, 1 - sq * 0.1, 1 + sq * 0.12);

    // 脚
    const [FL, FR, BL, BR] = rig.legs;
    let fl, fr, bl, br;
    if (dash) {
      fl = fr = Math.sin(g) * 0.95;
      bl = br = Math.sin(g + Math.PI) * 0.95;
    } else {
      fl = s * amp; br = s * amp; fr = -s * amp; bl = -s * amp;
    }
    const w = clamp(sit + lie + bow + belly, 0, 1);
    const paddle = Math.sin(this.t * 5) * 0.25;
    const frontP = sit * 0.45 + lie * -1.35 + bow * -1.55 + belly * (-0.7 + paddle);
    const hindP = sit * -0.95 + lie * -1.25 + bow * -0.36 + belly * (0.5 - paddle * 0.7);
    FL.rotation.x = fl * (1 - w) + frontP - this.reach * 1.2;
    FR.rotation.x = fr * (1 - w) + frontP - this.reach * 1.2 + belly * 0.3;
    BL.rotation.x = bl * (1 - w) + hindP;
    BR.rotation.x = br * (1 - w) + hindP - belly * 0.2;
    if (this.dig > 0.01) {
      const k = this.t * 24;
      FL.rotation.x += this.dig * (Math.sin(k) * 0.85 - 0.7);
      FR.rotation.x += this.dig * (Math.sin(k + Math.PI) * 0.85 - 0.7);
      BL.rotation.x += this.dig * 0.25;
      BR.rotation.x += this.dig * 0.25;
    }
    if (this.air > 0.01) {
      FL.rotation.x -= this.air * 0.95; FR.rotation.x -= this.air * 0.8;
      BL.rotation.x += this.air * 0.85; BR.rotation.x += this.air * 0.7;
    }
    FL.rotation.z = -0.15 * this.shake - belly * 0.3;
    FR.rotation.z = 0.15 * this.shake + belly * 0.3;
    // おすわり・ふせでは、前足の長さを地面に合わせる（浮かない・めりこまない）
    const plant = clamp(sit + bow, 0, 1) * (1 - lie) * (1 - belly) * (1 - this.air);
    for (const L of rig.legs) L.scale.y = 1;
    if (plant > 0.01) { fitLeg(rig, FL, plant); fitLeg(rig, FR, plant); }

    // ---- 頭 ----
    let yawT = 0, pitchT = 0;
    if (this.lookAt) {
      rig.root.updateMatrixWorld();
      _v.copy(this.lookAt);
      rig.neck.worldToLocal(_v);
      yawT = clamp(Math.atan2(_v.x, _v.z), -1.1, 1.1);
      pitchT = clamp(-Math.atan2(_v.y - 0.1, Math.hypot(_v.x, _v.z)), -0.6, 0.5);
      if (this.lookHold !== undefined) {
        this.lookHold -= dt;
        if (this.lookHold <= 0) { this.lookAt = null; this.lookHold = undefined; }
      }
    }
    if (belly > 0.5) { yawT *= 0.3; pitchT = 0; }
    this.lookYaw = damp(this.lookYaw, yawT, 7, dt);
    this.lookPitch = damp(this.lookPitch, pitchT, 7, dt);
    const head = rig.head;
    const shakeYaw = Math.sin(this.t * 30) * 0.75 * this.shake;
    const chewNod = Math.sin(this.t * 13) * 0.22 * this.chew;
    const sniffNod = this.sniff > 0 ? 0.45 + Math.sin(this.t * 22) * 0.06 : 0;
    const barkUp = this.barkT > 0 ? -0.25 * Math.sin((this.barkT / 0.28) * Math.PI) : 0;
    head.rotation.y = this.lookYaw + shakeYaw;
    head.rotation.x = this.lookPitch + chewNod + sniffNod + Math.sin(g) * 0.05 * amp + lie * 0.25 + sit * 0.3
      - (this.dashT > 0 ? 0.1 : 0) - yawn * 0.5 + barkUp + bow * 0.12 - this.reach * 0.4 + this.dig * 0.35;
    head.rotation.z = this.tilt + Math.sin(this.t * 30) * 0.2 * this.shake;
    rig.neck.position.y = rig.neck.userData.baseY - lie * d.ry * 0.25;

    // しっぽ
    const wagSpeed = 7 + this.excite * 13 + sp * 2 + bow * 10 + this.dig * 8;
    const wagAmp = 0.3 + this.excite * 0.45 + bow * 0.2;
    rig.tail.rotation.y = Math.sin(this.t * wagSpeed) * wagAmp;
    rig.tail.rotation.x = (this.expr === 'guilty' ? 0.6 : -0.1) - dash * 0.5 + lie * 0.4 - bow * 0.4;
    this.excite = damp(this.excite, this.held ? 0.8 : sp > 1 ? 0.6 : 0.3, 1.2, dt);

    // 耳（バネ）
    const bobAcc = -Math.sin(g * 2) * amp * 40 + (this.hopV > 0 ? -6 : 0);
    for (let i = 0; i < 2; i++) {
      const ear = rig.ears[i];
      const side = i === 0 ? -1 : 1;
      const floppy = d.earType === 'fuwa' || d.earType === 'long' || d.earType === 'tare';
      const target = (this.surprise > 0 ? -0.35 : 0) + (dash ? 0.5 : 0) + (this.expr === 'guilty' ? 0.4 : 0);
      this.earV[i] += (bobAcc * (floppy ? 0.02 : 0.006) - (this.earA[i] - target) * 90 - this.earV[i] * 10) * dt;
      this.earA[i] += this.earV[i] * dt;
      if (floppy) {
        ear.rotation.z = ear.userData.baseZ - side * this.earA[i] * 0.8 + side * this.shake * Math.sin(this.t * 30) * 0.4;
        ear.rotation.x = -this.earA[i] * 0.6;
      } else {
        ear.rotation.x = -this.earA[i] * 0.7;
        ear.rotation.z = ear.userData.baseZ + side * Math.sin(this.t * 1.3 + i) * 0.02;
      }
    }

    // ---- 表情 ----
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinking = 0.13; this.blinkT = rand(1.8, 4.5); }
    if (this.blinking > 0) this.blinking -= dt;
    let eyeY = 1, eyeS = 1, tongue = 0;
    switch (this.expr) {
      case 'happy': tongue = sp > 1.2 || this.excite > 0.7 ? 1 : 0.6; break;
      case 'focus': eyeY = 0.85; break;
      case 'sleep': eyeY = 0.12; break;
      case 'innocent': eyeS = 1.28; tongue = 0.35; break;
      case 'beg': eyeS = 1.15; tongue = 0.8; break;
      case 'surprised': eyeS = 1.18; break;
      case 'guilty': eyeY = 0.7; break;
    }
    if (this.surprise > 0) { eyeS = Math.max(eyeS, 1.2); tongue = 0; }
    if (this.blinking > 0 && this.expr !== 'sleep') eyeY = 0.1;
    if (yawn > 0.4) eyeY = 0.12;
    this.sparkle = damp(this.sparkle, this.expr === 'innocent' || this.expr === 'beg' ? 1 : 0, 5, dt);
    for (const e of rig.eyes) {
      e.scale.set(eyeS, eyeS * eyeY, eyeS);
      e.children[1].scale.setScalar(1 + this.sparkle * 0.6);
      e.children[2].scale.setScalar(1 + this.sparkle * 0.8);
    }
    // 口：うれしい時は にこっと あいて、舌が見える
    const smile = this.expr === 'sleep' ? 0 : tongue * (0.45 + 0.3 * this.excite);
    const mouthAmt = Math.max(yawn, smile, this.barkT > 0 ? Math.sin((this.barkT / 0.28) * Math.PI) * 0.9 : 0);
    rig.mouthOpen.visible = mouthAmt > 0.03 && !this.held;
    rig.mouthOpen.scale.set(1, Math.max(0.05, mouthAmt), 1);
    rig.tongue.visible = mouthAmt > 0.18 && !this.held;
    if (rig.tongue.userData.baseY === undefined) rig.tongue.userData.baseY = rig.tongue.position.y;
    rig.tongue.position.y = rig.tongue.userData.baseY + (1 - mouthAmt) * d.headR * 0.05;
    for (const b of rig.blush) b.material.opacity = 0.26 + this.sparkle * 0.34;

    this.syncRoot();
    rig.root.updateMatrixWorld(true);
    rig.mouth.getWorldPosition(this.mouthWorld);
    rig.head.getWorldPosition(this.headWorld);
    rig.head.getWorldDirection(this.headDir);
    const f = this.fwd;
    const reachF = (0.22 + d.rz * 1.2) * d.scale;
    this.front.set(this.pos.x + f.x * reachF, this.pos.y, this.pos.z + f.z * reachF);
  }

  syncRoot() {
    if (!this.rig) return;
    this.rig.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.rig.root.rotation.y = this.heading;
    const b = this.rig.blob;
    if (b) b.material.opacity = 0.22 * (1 - Math.min(0.6, this.hopY * 3));
  }
}
