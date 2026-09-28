import * as THREE from 'three';
import { clamp, damp, angleDiff } from './util.js';
import { BED, CAM_SPOTS } from './room.js';

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

// ペットカメラの設置場所（yaw=0 で奥の壁方向、正で右）
export const PETCAMS = CAM_SPOTS;
const PITCH_MIN = -1.25, PITCH_MAX = -0.05;
const ZOOM_MIN = 1, ZOOM_MAX = 5;

export class CamRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'overview';
    this.look = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 6, 8);
    this.t = 0;
    this.aspect = 1.6;
    this.dog = null;
    // ペットカメラ
    this.camIndex = 0;
    this.yaw = PETCAMS[0].yaw0;
    this.pitch = PETCAMS[0].pitch0;
    this.zoom = 1.3;
    this.tYaw = this.yaw;
    this.tPitch = this.pitch;
    this.tZoom = this.zoom;
    this.angVel = 0;
    this.prevDir = new THREE.Vector3(0, 0, -1);
    this.dir = new THREE.Vector3(0, 0, -1);
    this.switchT = 0;
  }

  get portrait() { return this.aspect < 0.95; }
  get petcam() { return PETCAMS[this.camIndex]; }
  get devicePos() { return PETCAMS[this.camIndex].pos; }

  resize(w, h) {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.w = w; this.h = h;
    this.applyLens();
  }

  /** ズーム1倍での縦の画角 */
  baseFov() { return this.portrait ? 78 : 58; }

  applyLens() {
    const c = this.camera;
    if (this.mode === 'petcam') c.fov = this.baseFov() / this.zoom;
    else if (this.mode === 'custom') c.fov = this.portrait ? 44 : 34;
    else c.fov = this.portrait ? 55 : 42;
    if (this.mode === 'custom') {
      const off = this.portrait ? 0.23 : 0.2;
      c.setViewOffset(this.w, this.h, 0, this.h * off, this.w, this.h);
    } else c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  setMode(mode, dog, snap = false) {
    this.mode = mode;
    this.dog = dog || this.dog;
    this.applyLens();
    if (snap) {
      this.compute();
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
    }
  }

  // ---------- ペットカメラ操作 ----------
  resetPetcam(index = 0) {
    this.camIndex = index;
    const c = PETCAMS[index];
    this.yaw = this.tYaw = c.yaw0;
    this.pitch = this.tPitch = c.pitch0;
    this.zoom = this.tZoom = 1.3;
    this.applyLens();
  }
  /** 画面上のドラッグ量（px）で向きを変える。景色をつかんで動かす感覚 */
  panByPixels(dx, dy) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const k = vfov / Math.max(1, this.h);
    this.tYaw = clamp(this.tYaw - dx * k, this.petcam.yawMin, this.petcam.yawMax);
    this.tPitch = clamp(this.tPitch + dy * k, PITCH_MIN, PITCH_MAX);
  }
  /** キーボード：-1..1 の入力 × 秒 */
  panBy(ix, iy, dt) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    this.tYaw = clamp(this.tYaw + ix * vfov * 0.9 * dt, this.petcam.yawMin, this.petcam.yawMax);
    this.tPitch = clamp(this.tPitch - iy * vfov * 0.9 * dt, PITCH_MIN, PITCH_MAX);
  }
  zoomBy(f) { this.tZoom = clamp(this.tZoom * f, ZOOM_MIN, ZOOM_MAX); }
  setZoom(z) { this.tZoom = clamp(z, ZOOM_MIN, ZOOM_MAX); }
  get zoomRange() { return [ZOOM_MIN, ZOOM_MAX]; }

  /** 指定位置が画面中央に来る向き */
  aimAt(target, zoom = null) {
    const p = this.devicePos;
    _d.subVectors(target, p);
    const yaw = Math.atan2(_d.x, -_d.z);
    const pitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
    // yaw の範囲はカメラごとに連続になるように
    let y = yaw;
    const mid = (this.petcam.yawMin + this.petcam.yawMax) / 2;
    y = mid + angleDiff(mid, y);
    this.tYaw = clamp(y, this.petcam.yawMin, this.petcam.yawMax);
    this.tPitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (zoom) {
      const dist = _d.length();
      this.tZoom = clamp(zoom * dist / 4, ZOOM_MIN, ZOOM_MAX);
    }
  }

  switchCam() {
    const next = (this.camIndex + 1) % PETCAMS.length;
    const target = this.dog ? this.dog.pos.clone().setY(0.35) : null;
    this.camIndex = next;
    this.yaw = this.tYaw = PETCAMS[next].yaw0;
    this.pitch = this.tPitch = PETCAMS[next].pitch0;
    if (target) {
      this.aimAt(target);
      this.yaw = this.tYaw;
      this.pitch = this.tPitch;
    }
    this.switchT = 0.35;
  }

  dirFrom(yaw, pitch, out) {
    return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  compute() {
    this.wantPos = this.wantPos || new THREE.Vector3();
    this.wantLook = this.wantLook || new THREE.Vector3();
    const dog = this.dog;
    switch (this.mode) {
      case 'overview': {
        const s = Math.sin(this.t * 0.15) * 0.4;
        if (this.portrait) {
          this.wantPos.set(BED.x - 0.7 + s * 0.5, 2.9, BED.z + 3.6);
          this.wantLook.set(BED.x - 0.35, 0.0, BED.z + 1.35);
        } else {
          this.wantPos.set(-1.4 + s, 5.2, 6.4);
          this.wantLook.set(1.2, 0.2, -1.2);
        }
        break;
      }
      case 'custom': {
        const d = dog.pos;
        this.wantPos.set(d.x + 0.3, this.portrait ? 1.0 : 0.95, d.z + (this.portrait ? 2.75 : 2.35));
        this.wantLook.set(d.x, 0.3, d.z);
        break;
      }
      case 'petcam': {
        this.wantPos.copy(this.devicePos);
        this.dirFrom(this.yaw, this.pitch, _p);
        this.wantLook.copy(this.devicePos).add(_p);
        break;
      }
    }
  }

  update(dt) {
    this.t += dt;
    const c = this.camera;
    if (this.mode === 'petcam') {
      // モーター付きカメラ：少しだけ遅れて追従
      this.yaw = damp(this.yaw, this.tYaw, 14, dt);
      this.pitch = damp(this.pitch, this.tPitch, 14, dt);
      const pz = this.zoom;
      this.zoom = damp(this.zoom, this.tZoom, 10, dt);
      if (Math.abs(pz - this.zoom) > 1e-4) this.applyLens();
      this.compute();
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
      c.position.copy(this.pos);
      c.lookAt(this.look);
      // 角速度（ブレ判定用）
      this.dirFrom(this.yaw, this.pitch, this.dir);
      const ang = this.prevDir.angleTo(this.dir) / Math.max(dt, 1e-4);
      this.angVel = damp(this.angVel, ang, 12, dt);
      this.prevDir.copy(this.dir);
      if (this.switchT > 0) this.switchT -= dt;
      return;
    }
    this.compute();
    const k = 4;
    this.pos.x = damp(this.pos.x, this.wantPos.x, k, dt);
    this.pos.y = damp(this.pos.y, this.wantPos.y, k, dt);
    this.pos.z = damp(this.pos.z, this.wantPos.z, k, dt);
    this.look.x = damp(this.look.x, this.wantLook.x, k, dt);
    this.look.y = damp(this.look.y, this.wantLook.y, k, dt);
    this.look.z = damp(this.look.z, this.wantLook.z, k, dt);
    c.position.copy(this.pos);
    c.lookAt(this.look);
  }

  /** 画面中央の先にある床の点（なければ null） */
  floorPointAtCenter(out = new THREE.Vector3()) {
    const d = this.dirFrom(this.yaw, this.pitch, _d);
    if (d.y >= -0.02) return null;
    const t = -this.devicePos.y / d.y;
    out.copy(this.devicePos).addScaledVector(d, t);
    out.y = 0;
    return out;
  }
}
