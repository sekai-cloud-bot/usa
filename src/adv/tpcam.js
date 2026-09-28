import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../util.js';
import { ROOM } from '../room.js';

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _look = new THREE.Vector3();

/** 三人称カメラ。犬のうしろを追いかけ、壁の手前で止まる */
export class TPCam {
  constructor(camera, col) {
    this.camera = camera;
    this.col = col;
    this.yaw = Math.PI;
    this.pitch = 0.3;
    this.dist = 3.3;
    this.curDist = 3.3;
    this.target = new THREE.Vector3();
    this.userT = 10;
    this.shake = 0;
    this.override = null;    // 演出用：fn(camera, dt) が true を返す間はこちらが操作
    this.blend = 1;          // 演出から戻るときのなめらかさ
    this.fromPos = new THREE.Vector3();
    this.fromQuat = new THREE.Quaternion();
    this.fovBase = 55;
    this.fovKick = 0;
    this.lookLead = new THREE.Vector3();
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.0055;
    this.pitch = clamp(this.pitch + dy * 0.004, -0.12, 1.25);
    this.userT = 0;
  }
  zoom(k) { this.dist = clamp(this.dist * k, 1.6, 7); }

  snap(player) {
    this.yaw = player.heading + Math.PI;
    this.target.copy(player.pos).add(_t.set(0, 0.5, 0));
    this.curDist = this.dist;
    this.update(0.016, player, true);
  }

  /** 入力をカメラ基準のワールド方向へ */
  toWorld(ix, iy, out) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return out.set(fx * iy + rx * ix, 0, fz * iy + rz * ix);
  }

  startCine(fn) {
    this.override = fn;
  }
  endCine() {
    if (!this.override) return;
    this.override = null;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.blend = 0;
  }

  update(dt, player, instant = false) {
    const cam = this.camera;
    if (this.override) {
      if (this.override(cam, dt) !== false) return;
      this.endCine();
    }
    this.userT += dt;
    const p = player.pos;
    // 目標点：ジャンプでは上下をゆっくり追う
    const ty = p.y + 0.5;
    this.target.x = instant ? p.x : damp(this.target.x, p.x, 14, dt);
    this.target.z = instant ? p.z : damp(this.target.z, p.z, 14, dt);
    this.target.y = instant ? ty : damp(this.target.y, ty, player.grounded ? 8 : 3, dt);
    const sp = player.dog.speed;
    // 動いている間は、少しずつ犬のうしろへ回りこむ
    if (sp > 0.6 && this.userT > 1.2) {
      const k = clamp((sp - 0.6) / 3, 0, 1) * 1.6;
      this.yaw = dampAngle(this.yaw, player.heading + Math.PI, k, dt);
      this.pitch = damp(this.pitch, 0.26, 0.6, dt);
    }
    const inside = p.x > ROOM.minX && p.x < ROOM.maxX && p.z > ROOM.minZ && p.z < ROOM.maxZ;
    const want = inside ? Math.min(this.dist, 2.6) : this.dist + (player.run ? 0.5 : 0);
    const cp = Math.cos(this.pitch);
    _d.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // 壁よけ
    const hit = this.col.rayDist(this.target.x, this.target.y, this.target.z, _d.x, _d.y, _d.z, want + 0.3);
    let dist = Math.max(0.55, Math.min(want, hit - 0.3));
    // 壁が近くて寄りすぎる時は、上から見下ろす
    if (hit < want * 0.65 && !inside) this.pitch = damp(this.pitch, 0.95, 2.2, dt);
    this.curDist = instant ? dist : (dist < this.curDist ? damp(this.curDist, dist, 18, dt) : damp(this.curDist, dist, 3, dt));
    _t.copy(this.target).addScaledVector(_d, this.curDist);
    if (inside) _t.y = Math.min(_t.y, ROOM.h - 0.25);
    const gy = this.col.groundAt(_t.x, _t.z, 0.1, _t.y + 0.5, 0.5);
    _t.y = Math.max(_t.y, gy + 0.25, 0.25);
    // 画面のゆれ
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.06;
      _t.x += (Math.random() - 0.5) * s; _t.y += (Math.random() - 0.5) * s; _t.z += (Math.random() - 0.5) * s;
    }
    // 視線は犬の少し前
    const f = player.dog.fwd;
    this.lookLead.x = damp(this.lookLead.x, f.x * Math.min(sp, 4) * 0.12, 3, dt);
    this.lookLead.z = damp(this.lookLead.z, f.z * Math.min(sp, 4) * 0.12, 3, dt);
    _look.copy(this.target).add(this.lookLead);
    cam.position.copy(_t);
    cam.lookAt(_look);
    // 演出から戻る
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.9);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, _t, k);
      const q = cam.quaternion.clone();
      cam.quaternion.copy(this.fromQuat).slerp(q, k);
    }
    // 走るとほんの少し広角に
    this.fovKick = damp(this.fovKick, player.run && sp > 3 ? 6 : 0, 3, dt);
    const fov = this.fovBase + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}

export { lerp };
