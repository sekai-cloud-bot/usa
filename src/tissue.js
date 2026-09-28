import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE } from './room.js';
import { angleDiff, TAU, clamp } from './util.js';
import { audio } from './audio.js';

const MAXP = 420;
const STEP = 0.075;       // 点を置く間隔
const SHEET = 0.2;        // 1枚あたりの長さ
export const TISSUE_SHEETS = 130;
export const TISSUE_YEN = 40;
const WIDTH = 0.13;

const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.95, side: THREE.DoubleSide, flatShading: true });
ribbonMat.userData.shared = true;

class Ribbon {
  constructor(parent, start, startTop) {
    this.points = [start.clone()];
    this.startTop = startTop;
    this.len = 0;
    this.air = [];
    this.attached = true;
    this.mouth = start.clone();
    const n = MAXP + 6;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, ribbonMat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
    this.dropT = 0;
  }

  /** 床の点列＋口までの垂れ下がりを帯にする */
  rebuild() {
    const pts = this.points;
    const all = [];
    // 箱の口から床へ
    all.push(this.startTop);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const wob = Math.sin(i * 1.7) * 0.006 + Math.sin(i * 0.43) * 0.004;
      all.push(new THREE.Vector3(p.x, 0.012 + Math.abs(wob), p.z));
    }
    if (this.attached) {
      const last = pts[pts.length - 1];
      const m = this.mouth;
      for (let j = 1; j <= 4; j++) {
        const t = j / 4;
        all.push(new THREE.Vector3(
          last.x + (m.x - last.x) * t,
          0.012 + (m.y - 0.012) * t * t,
          last.z + (m.z - last.z) * t,
        ));
      }
    }
    const n = Math.min(all.length, MAXP + 6);
    const side = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = all[Math.max(0, i - 1)], b = all[Math.min(n - 1, i + 1)];
      tan.subVectors(b, a);
      tan.y = 0;
      if (tan.lengthSq() < 1e-8) tan.set(1, 0, 0);
      tan.normalize();
      side.set(tan.z, 0, -tan.x).multiplyScalar(WIDTH / 2);
      const p = all[i];
      const tw = Math.sin(i * 2.3) * 0.008;
      this.pos[i * 6] = p.x + side.x;
      this.pos[i * 6 + 1] = p.y + tw;
      this.pos[i * 6 + 2] = p.z + side.z;
      this.pos[i * 6 + 3] = p.x - side.x;
      this.pos[i * 6 + 4] = p.y - tw * 0.5 + (i % 3 === 0 ? 0.006 : 0);
      this.pos[i * 6 + 5] = p.z - side.z;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
  }
}

export class TissueSystem {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    world.group.add(this.group);
    this.ribbons = [];
    this.active = null;
  }

  build(x, z) {
    // 箱
    const box = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.13, 0.19, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0xa8d8c2, roughness: 0.7 }));
    body.position.y = 0.065;
    body.castShadow = true;
    body.receiveShadow = true;
    box.add(body);
    const bone = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.04, 0.005, 1, 0.015), new THREE.MeshStandardMaterial({ color: 0xfff6ea, roughness: 0.7 }));
    bone.position.set(0, 0.065, 0.097);
    box.add(bone);
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
    puff.scale.set(1, 1.1, 0.5);
    puff.position.y = 0.16;
    box.add(puff);
    box.position.set(x, 0, z);
    box.rotation.y = 0.3;
    this.group.add(box);
    this.box = { mesh: box, puff, pos: new THREE.Vector3(x, 0, z), r: 0.17, sheets: TISSUE_SHEETS, jig: 0 };
    this.total = 0;
    this.wrapAcc = 0;
    this.wrapPrev = null;
    this.maxRibbon = 0;
  }

  reset(x, z) {
    for (const r of this.ribbons) r.dispose();
    this.ribbons.length = 0;
    this.active = null;
    if (this.box) {
      this.group.remove(this.box.mesh);
    }
    this.build(x, z);
  }

  get empty() { return this.box.sheets <= 0; }
  get full() { return this.active && this.active.points.length >= MAXP; }

  start(mouth) {
    const b = this.box;
    const top = new THREE.Vector3(b.pos.x, 0.15, b.pos.z);
    const start = new THREE.Vector3(b.pos.x, 0.012, b.pos.z);
    const r = new Ribbon(this.group, start, top);
    r.mouth.copy(mouth);
    this.ribbons.push(r);
    this.active = r;
    this.acc = 0;
    this.wrapAcc = 0;
    this.wrapPrev = null;
    b.jig = 1;
    r.rebuild();
    return r;
  }

  release() {
    if (!this.active) return;
    this.active.attached = false;
    // 口元の部分を床に落とす
    const m = this.active.mouth;
    this.active.points.push(new THREE.Vector3(m.x, 0.012, m.z));
    this.active.rebuild();
    this.active = null;
  }

  /** mouth: 口のワールド座標。戻り値: 今回引き出した枚数 */
  update(dt, mouth, game) {
    const b = this.box;
    if (b.jig > 0) {
      b.jig = Math.max(0, b.jig - dt * 4);
      const k = b.jig;
      b.mesh.scale.set(1 + 0.08 * k * Math.sin(k * 30), 1 - 0.1 * k * Math.sin(k * 30), 1);
      b.puff.scale.set(1, 1.1 + 0.4 * k, 0.5);
    }
    b.puff.visible = b.sheets > 0;
    const r = this.active;
    if (!r) return 0;
    r.mouth.copy(mouth);
    let last = r.points[r.points.length - 1];
    const fx = mouth.x, fz = mouth.z;
    let d = Math.hypot(fx - last.x, fz - last.z);
    let sheets = 0;
    while (d > STEP && r.points.length < MAXP && b.sheets > 0) {
      const t = STEP / d;
      const np = new THREE.Vector3(last.x + (fx - last.x) * t, 0.012, last.z + (fz - last.z) * t);
      r.points.push(np);
      r.len += STEP;
      this.acc += STEP;
      last = np;
      d = Math.hypot(fx - np.x, fz - np.z);
      while (this.acc >= SHEET && b.sheets > 0) {
        this.acc -= SHEET;
        b.sheets--;
        this.total++;
        sheets++;
      }
    }
    if (sheets > 0) b.jig = 1;
    this.maxRibbon = Math.max(this.maxRibbon, r.len);

    // テーブル一周の検出
    const dx = mouth.x - TABLE.x, dz = mouth.z - TABLE.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.2) {
      const a = Math.atan2(dz, dx);
      if (this.wrapPrev !== null) this.wrapAcc += angleDiff(this.wrapPrev, a);
      this.wrapPrev = a;
      if (Math.abs(this.wrapAcc) >= TAU) {
        this.wrapAcc = 0;
        game?.onWrap(new THREE.Vector3(TABLE.x, 0.5, TABLE.z));
      }
    } else {
      this.wrapPrev = null;
      this.wrapAcc *= Math.exp(-dt * 0.5);
    }
    r.rebuild();
    return sheets;
  }

  /** 箱の中身の残り割合 */
  get remain() { return clamp(this.box.sheets / TISSUE_SHEETS, 0, 1); }
}
