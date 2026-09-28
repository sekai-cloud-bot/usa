import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { ROOM, BED } from './room.js';

const _t = new THREE.Vector3();
const _p = new THREE.Vector3();

export class CamRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'overview';
    this.target = new THREE.Vector3(0, 0, 0);
    this.look = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 6, 8);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.shake = 0;
    this.t = 0;
    this.aspect = 1.6;
    this.zoom = 1;
    this.dog = null;
  }

  get portrait() { return this.aspect < 0.95; }

  resize(w, h) {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.w = w; this.h = h;
    this.applyLens();
  }

  applyLens() {
    const c = this.camera;
    if (this.mode === 'follow') c.fov = this.portrait ? 52 : 40;
    else if (this.mode === 'custom') c.fov = this.portrait ? 44 : 34;
    else if (this.mode === 'cinematic') c.fov = this.portrait ? 50 : 36;
    else c.fov = this.portrait ? 55 : 42;
    if (this.mode === 'custom') {
      const off = this.portrait ? 0.23 : 0.2;
      c.setViewOffset(this.w, this.h, this.portrait ? 0 : -this.w * 0.0, this.h * off, this.w, this.h);
    } else c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  setMode(mode, dog, snap = false) {
    this.mode = mode;
    this.dog = dog || this.dog;
    this.modeT = 0;
    this.applyLens();
    if (snap) {
      this.compute(0);
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
    }
  }

  followOffset() {
    const el = this.portrait ? 1.0 : 0.9;
    const yaw = -0.2;
    const dist = (this.portrait ? 6.6 : 5.6) * this.zoom;
    return _p.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(dist);
  }

  compute(dt) {
    const dog = this.dog;
    this.wantPos = this.wantPos || new THREE.Vector3();
    this.wantLook = this.wantLook || new THREE.Vector3();
    switch (this.mode) {
      case 'follow': {
        _t.set(dog.pos.x + dog.vel.x * 0.28, 0, dog.pos.z + dog.vel.z * 0.22);
        const mx = this.portrait ? 3.4 : 2.7;
        _t.x = clamp(_t.x, -mx, mx);
        _t.z = clamp(_t.z, -2.1, 1.7);
        if (dt === 0) this.target.copy(_t);
        else {
          this.target.x = damp(this.target.x, _t.x, 4.5, dt);
          this.target.z = damp(this.target.z, _t.z, 4.5, dt);
        }
        this.wantPos.copy(this.target).add(this.followOffset());
        this.wantLook.copy(this.target).setY(0.25);
        break;
      }
      case 'overview': {
        const s = Math.sin(this.t * 0.15) * 0.4;
        if (this.portrait) {
          // ベッドで眠る子を画面の上寄りに（下はタイトルのカード）
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
      case 'cinematic': {
        const d = dog.pos;
        const a = this.cineAngle || 0;
        const dist = this.cineDist || (this.portrait ? 2.7 : 2.0);
        const px = clamp(d.x + Math.sin(a) * dist, ROOM.minX + 0.3, ROOM.maxX - 0.3);
        const pz = Math.max(ROOM.minZ + 0.3, d.z + Math.cos(a) * dist);
        this.wantPos.set(px, 1.05, pz);
        this.wantLook.set(d.x, 0.32, d.z);
        break;
      }
    }
  }

  update(dt) {
    this.t += dt;
    if (this.modeT !== undefined) this.modeT += dt;
    this.compute(dt);
    const k = this.mode === 'follow' ? 12 : this.mode === 'cinematic' ? 3 : 4;
    this.pos.x = damp(this.pos.x, this.wantPos.x, k, dt);
    this.pos.y = damp(this.pos.y, this.wantPos.y, k, dt);
    this.pos.z = damp(this.pos.z, this.wantPos.z, k, dt);
    this.look.x = damp(this.look.x, this.wantLook.x, k, dt);
    this.look.y = damp(this.look.y, this.wantLook.y, k, dt);
    this.look.z = damp(this.look.z, this.wantLook.z, k, dt);
    const c = this.camera;
    c.position.copy(this.pos);
    if (this.shake > 0.01) {
      const s = this.shake * 0.06;
      c.position.x += (Math.random() - 0.5) * s;
      c.position.y += (Math.random() - 0.5) * s;
    }
    c.lookAt(this.look);
    // 入力の向き（カメラ基準）
    this.forward.set(this.look.x - this.pos.x, 0, this.look.z - this.pos.z).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
  }
}
