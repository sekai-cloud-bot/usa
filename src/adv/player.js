import * as THREE from 'three';
import { Dog } from '../dog.js';
import { clamp, damp } from '../util.js';
import { audio } from '../audio.js';

const GRAV = 24;
const JUMP_V = 6.3;   // 約0.83m 跳べる
const STEP = 0.32;    // これ以下の段差は歩いて上がれる
const HEIGHT = 0.5;

/**
 * 操作する犬。見た目と手足の動きは Dog、ここでは高さ（ジャンプ・段差・落下）と
 * 「くわえる」などの状態を扱う。
 */
export class Player {
  constructor(scene, col) {
    this.scene = scene;
    this.col = col;
    this.dog = new Dog(scene);
    this.vy = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.run = false;
    this.locked = false;
    this.airTime = 0;
    this.stepT = 0;
    this.carry = null;       // くわえている物 { id, mesh, label }
    this.boost = 0;          // にぼしで元気（秒）
    this.onLand = null;
    this.support = null;
    this.puppet = false;
    this._move = new THREE.Vector3();
    this.adapter = { resolveDog: (d) => this.col.resolve(d.pos, d.radius, HEIGHT * Math.max(1, d.rig ? d.rig.dims.scale * 0.8 : 1), STEP) };
  }

  setParams(p) { this.dog.setParams(p); }
  get pos() { return this.dog.pos; }
  get heading() { return this.dog.heading; }

  place(x, y, z, heading = 0) {
    this.dog.place(x, z, heading, y);
    this.vy = 0;
    this.grounded = true;
  }

  jump() { this.jumpBuf = 0.14; }

  /** 口に物をくわえる */
  hold(item) {
    this.drop();
    this.carry = item;
    if (item.mesh) {
      item.mesh.position.set(0, -0.02, 0.06);
      item.mesh.rotation.set(0, Math.PI / 2, 0);
      this.dog.rig.mouth.add(item.mesh);
    }
    this.dog.held = { kind: item.id, mesh: item.mesh };
    audio.play('grab');
  }
  drop() {
    const it = this.carry;
    if (!it) return null;
    if (it.mesh && it.mesh.parent) it.mesh.parent.remove(it.mesh);
    this.carry = null;
    this.dog.held = null;
    return it;
  }

  update(dt, move) {
    const d = this.dog;
    const p = d.pos;
    // 演出中は位置を外から決める（手足の動きだけ）
    if (this.puppet) {
      this.vy = 0;
      this.grounded = true;
      d.update(dt, this._move.set(0, 0, 0), null);
      d.syncRoot();
      return;
    }
    const mv = this.locked ? this._move.set(0, 0, 0) : move;
    d.speedMul = (this.run ? 1.9 : 1.0) * (this.boost > 0 ? 1.18 : 1) * (this.grounded ? 1 : 0.95);
    if (this.boost > 0) this.boost -= dt;
    d.update(dt, mv, this.adapter);

    // ---- 高さ ----
    const ground = this.col.groundAt(p.x, p.z, d.radius, p.y, STEP);
    this.support = this.col.support;
    if (this.jumpBuf > 0) {
      this.jumpBuf -= dt;
      if ((this.grounded || this.coyote > 0) && !this.locked) {
        this.vy = JUMP_V;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        d.squash = -0.7;
        audio.play('jump');
      }
    }
    if (this.grounded) {
      if (ground < p.y - 0.06) {
        this.grounded = false;
        this.coyote = 0.12;
        this.vy = 0;
      } else {
        p.y = ground > p.y ? damp(p.y, ground, 30, dt) : ground;
        // 細い塀の上では、落ちにくいように真ん中へ寄せる
        const b = this.support;
        if (b && p.y > 0.3) {
          if (b.z1 - b.z0 < 0.5) p.z = damp(p.z, (b.z0 + b.z1) / 2, 7, dt);
          if (b.x1 - b.x0 < 0.5) p.x = damp(p.x, (b.x0 + b.x1) / 2, 7, dt);
        }
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.coyote -= dt;
      this.vy -= GRAV * dt;
      p.y += this.vy * dt;
      if (this.vy <= 0 && p.y <= ground) {
        const impact = -this.vy;
        p.y = ground;
        this.vy = 0;
        this.grounded = true;
        d.squash = clamp(impact / 9, 0.2, 1);
        if (this.airTime > 0.12) {
          audio.play('land', clamp(impact / 6, 0.3, 1.2));
          if (this.onLand) this.onLand(impact);
        }
        this.airTime = 0;
      }
    } else this.airTime = 0;

    d.air = damp(d.air, this.grounded ? 0 : 1, 12, dt);
    d.extraPitch = this.grounded ? damp(d.extraPitch, 0, 10, dt) : clamp(-this.vy * 0.045, -0.28, 0.25);
    d.syncRoot();

    // 足音
    const sp = d.speed;
    if (this.grounded && sp > 0.4) {
      this.stepT -= dt * (2.2 + sp * 1.6);
      if (this.stepT <= 0) { this.stepT = 1; audio.play('step', 0.12 + Math.min(0.2, sp * 0.04)); }
    }
  }
}
