import * as THREE from 'three';
import { buildDog } from './dogModel.js';
import { clamp, damp, dampAngle, angleDiff, rand, disposeObject } from './util.js';
import { audio } from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

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
    this.pose = { sit: 0, lie: 0 };
    this.poseTarget = 'stand';
    this.expr = 'happy';
    this.blinkT = 2;
    this.blinking = 0;
    this.lookAt = null;
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
    this.locked = false;
    this.speedMul = 1;
    this.mouthWorld = new THREE.Vector3();
    this.headWorld = new THREE.Vector3();
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
    this.radius = 0.16 + this.rig.dims.bodyLen * 0.15;
    if (prevHeld && prevHeld.mesh) {
      this.rig.mouth.add(prevHeld.mesh);
    }
    this.syncRoot();
  }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.dashT = 0;
    this.pose.sit = 0; this.pose.lie = 0;
    this.poseTarget = 'stand';
    this.hopY = 0; this.hopV = 0;
    this.syncRoot();
  }

  get fwd() { return _w.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get isNapping() { return this.poseTarget === 'lie' && this.pose.lie > 0.6; }

  setPose(p) { this.poseTarget = p; }
  setExpr(e) { this.expr = e; }

  hop(v = 1.6) {
    if (this.hopY <= 0.001) this.hopV = v;
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
    this.lookAt = pos.clone();
    this.lookHold = 1.2;
    if (level >= 2) { this.hop(1.9); this.surprise = 0.8; audio.play('surprise'); }
    else { this.surprise = 0.5; }
    this.excite = 1;
  }

  tryDash(dir) {
    if (this.dashCD > 0 || this.locked) return false;
    if (dir && dir.lengthSq() > 0.01) this.heading = Math.atan2(dir.x, dir.z);
    const f = this.fwd;
    this.dashT = 0.3;
    this.dashCD = 0.55;
    this.vel.set(f.x * 5.4, 0, f.z * 5.4);
    this.squash = -0.8;
    this.poseTarget = 'stand';
    audio.play('whoosh');
    if (Math.random() < 0.35) setTimeout(() => audio.play('bark', 1.05), 60);
    return true;
  }

  /**
   * move: ワールドXZの入力ベクトル（長さ0..1）
   */
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
      // ダッシュ中も少し曲がれる
      if (inLen > 0.1) {
        const want = Math.atan2(move.x, move.z);
        this.heading = dampAngle(this.heading, want, 5, dt);
      }
      const f = this.fwd;
      const sp = 5.4 * Math.max(0.55, this.dashT / 0.3);
      this.vel.x = f.x * sp;
      this.vel.z = f.z * sp;
    } else {
      const tx = inLen > 0 ? (move.x / Math.max(inLen, 1e-5)) * maxSp * inLen : 0;
      const tz = inLen > 0 ? (move.z / Math.max(inLen, 1e-5)) * maxSp * inLen : 0;
      const lam = inLen > 0 ? 9 : 11;
      // 座り・伏せからは少し遅れて動き出す（ためらい）
      const wake = 1 - Math.max(this.pose.sit, this.pose.lie) * 0.6;
      this.vel.x = damp(this.vel.x, tx * wake, lam, dt);
      this.vel.z = damp(this.vel.z, tz * wake, lam, dt);
      if (this.bumpT > 0) {
        this.bumpT -= dt;
        this.vel.multiplyScalar(0.8);
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (world) world.resolveDog(this);

    const sp = this.speed;
    if (sp > 0.12 && this.dashT <= 0 && !this.shaking) {
      this.heading = dampAngle(this.heading, Math.atan2(this.vel.x, this.vel.z), 13, dt);
    }
    if (inLen > 0.1 || sp > 0.3) this.poseTarget = 'stand';

    // ---- 姿勢の補間 ----
    this.pose.sit = damp(this.pose.sit, this.poseTarget === 'sit' ? 1 : 0, this.poseTarget === 'sit' ? 6 : 12, dt);
    this.pose.lie = damp(this.pose.lie, this.poseTarget === 'lie' ? 1 : 0, this.poseTarget === 'lie' ? 3 : 12, dt);
    this.shake = damp(this.shake, this.shaking ? 1 : 0, 14, dt);
    this.chew = damp(this.chew, this.chewing ? 1 : 0, 14, dt);
    this.squash = damp(this.squash, 0, 8, dt);
    this.tilt = damp(this.tilt, this.tiltTarget, 6, dt);
    if (this.surprise > 0) this.surprise -= dt;

    // 小ジャンプ
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopV -= 14 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) { this.hopY = 0; this.hopV = 0; }
    }

    // ---- 歩行アニメ ----
    const dash = this.dashT > 0 ? 1 : 0;
    this.gait += dt * (5 + sp * 6.5);
    const amp = clamp(sp / 2.6, 0, 1) * (0.62 + 0.3 * dash);
    const g = this.gait;
    const s = Math.sin(g);
    const sit = this.pose.sit, lie = this.pose.lie;
    const breathe = Math.sin(this.t * 2.2) * 0.006 * (1 + lie);

    const body = rig.body;
    body.position.y = d.bodyY + Math.abs(Math.sin(g)) * 0.03 * amp + breathe
      - sit * d.bodyY * 0.18 - lie * (d.bodyY - d.bodyR * 0.95) + this.hopY;
    body.position.z = -sit * 0.03;
    const gallop = dash ? Math.sin(g) * 0.14 : 0;
    body.rotation.x = -0.45 * sit + gallop + lie * 0.05;
    body.rotation.z = Math.sin(g) * 0.05 * amp + Math.sin(this.t * 34) * 0.05 * this.shake;
    const sq = this.squash;
    body.scale.set(1 + sq * 0.08, 1 - sq * 0.1, 1 + sq * 0.12);

    // 脚
    const [FL, FR, BL, BR] = rig.legs;
    if (dash) {
      FL.rotation.x = FR.rotation.x = Math.sin(g) * 0.95;
      BL.rotation.x = BR.rotation.x = Math.sin(g + Math.PI) * 0.95;
    } else {
      FL.rotation.x = s * amp;
      BR.rotation.x = s * amp;
      FR.rotation.x = -s * amp;
      BL.rotation.x = -s * amp;
    }
    // 座る・伏せる
    FL.rotation.x = FL.rotation.x * (1 - sit - lie) + sit * 0.45 + lie * -1.35;
    FR.rotation.x = FR.rotation.x * (1 - sit - lie) + sit * 0.45 + lie * -1.35;
    BL.rotation.x = BL.rotation.x * (1 - sit - lie) + sit * -0.95 + lie * -1.25;
    BR.rotation.x = BR.rotation.x * (1 - sit - lie) + sit * -0.95 + lie * -1.25;
    // ぶんぶん中は踏んばる
    FL.rotation.z = -0.15 * this.shake; FR.rotation.z = 0.15 * this.shake;

    // ---- 頭 ----
    let yawT = 0, pitchT = 0;
    if (this.lookAt) {
      rig.root.updateMatrixWorld();
      _v.copy(this.lookAt);
      rig.neck.worldToLocal(_v);
      yawT = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
      pitchT = clamp(-Math.atan2(_v.y - 0.1, Math.hypot(_v.x, _v.z)), -0.5, 0.45);
      if (this.lookHold !== undefined) {
        this.lookHold -= dt;
        if (this.lookHold <= 0) { this.lookAt = null; this.lookHold = undefined; }
      }
    }
    this.lookYaw = damp(this.lookYaw, yawT, 7, dt);
    this.lookPitch = damp(this.lookPitch, pitchT, 7, dt);
    const head = rig.head;
    const shakeYaw = Math.sin(this.t * 30) * 0.75 * this.shake;
    const chewNod = Math.sin(this.t * 13) * 0.22 * this.chew;
    head.rotation.y = this.lookYaw + shakeYaw;
    head.rotation.x = this.lookPitch + chewNod + Math.sin(g) * 0.05 * amp + lie * 0.25 + sit * 0.3 - (this.dashT > 0 ? 0.1 : 0);
    head.rotation.z = this.tilt + Math.sin(this.t * 30) * 0.2 * this.shake;
    rig.neck.position.y = d.bodyR * 0.5 - lie * 0.04;

    // しっぽ
    const wagSpeed = 7 + this.excite * 13 + sp * 2;
    const wagAmp = 0.3 + this.excite * 0.45;
    rig.tail.rotation.y = Math.sin(this.t * wagSpeed) * wagAmp;
    rig.tail.rotation.x = (this.expr === 'guilty' ? 0.6 : -0.1) - dash * 0.5 + lie * 0.4;
    this.excite = damp(this.excite, this.held ? 0.8 : sp > 1 ? 0.6 : 0.3, 1.2, dt);

    // 耳（バネ）
    const bobAcc = -Math.sin(g * 2) * amp * 40 + (this.hopV > 0 ? -6 : 0);
    for (let i = 0; i < 2; i++) {
      const ear = rig.ears[i];
      const side = i === 0 ? -1 : 1;
      const floppy = d.earType === 'fluffy' || d.earType === 'long';
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
      case 'surprised': eyeS = 1.18; break;
      case 'guilty': eyeY = 0.7; break;
    }
    if (this.surprise > 0) { eyeS = Math.max(eyeS, 1.2); tongue = 0; }
    if (this.blinking > 0 && this.expr !== 'sleep') eyeY = 0.1;
    this.sparkle = damp(this.sparkle, this.expr === 'innocent' ? 1 : 0, 5, dt);
    for (const e of rig.eyes) {
      e.scale.set(eyeS, eyeS * eyeY, eyeS);
      e.children[1].scale.setScalar(1 + this.sparkle * 0.6);
      e.children[2].scale.setScalar(1 + this.sparkle * 0.8);
    }
    rig.tongue.visible = tongue > 0.05 && !this.held;
    rig.tongue.scale.set(1, 0.45, 0.6 + tongue * 0.6);
    for (const b of rig.blush) b.material.opacity = 0.3 + this.sparkle * 0.35;

    this.syncRoot();
    rig.root.updateMatrixWorld(true);
    rig.mouth.getWorldPosition(this.mouthWorld);
    rig.head.getWorldPosition(this.headWorld);
    const f = this.fwd;
    this.front.set(this.pos.x + f.x * (0.3 + d.bodyLen * 0.25), 0, this.pos.z + f.z * (0.3 + d.bodyLen * 0.25));
  }

  syncRoot() {
    if (!this.rig) return;
    this.rig.root.position.set(this.pos.x, 0, this.pos.z);
    this.rig.root.rotation.y = this.heading;
    const b = this.rig.blob;
    if (b) b.material.opacity = 0.22 * (1 - Math.min(0.6, this.hopY * 3));
  }
}
