import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM, TABLE, BED, makePlant, inSun, mergeModel } from './room.js';
import { clamp, rand, easeInQuad, disposeObject, mergeParts, mat } from './util.js';
import { TissueSystem, TISSUE_YEN } from './tissue.js';
import { audio } from './audio.js';

const GRAV = 9.8;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export const LAYOUT = {
  spawn: { x: 1.0, z: -1.75 },
  tissue: { x: 0.2, z: -1.2 },
};

// 段ボールの並び（毎回ちがう「仕掛け」）
const SETUPS = [
  { name: '窓辺へつづく段ボール', from: [0.55, 2.3], to: [2.7, 1.25], n: 5 },
  { name: 'テーブルへつづく段ボール', from: [0.6, 1.5], to: [-0.95, -0.05], n: 5 },
  { name: 'ゴミ箱へつづく段ボール', from: [-1.45, 2.65], to: [-3.55, 1.38], n: 5 },
];

const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

// ------------------------------------------------------------
// メッシュ
// ------------------------------------------------------------
function ballMesh(r, colA, colB) {
  const g = new THREE.IcosahedronGeometry(r, 2).toNonIndexed();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const ca = new THREE.Color(colA), cb = new THREE.Color(colB), cw = new THREE.Color(0xffffff);
  for (let f = 0; f < pos.count; f += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(f + k); cy += pos.getY(f + k); cz += pos.getZ(f + k); }
    const a = Math.atan2(cz, cx);
    let c = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 2 ? ca : cb;
    if (Math.abs(cy / 3) > r * 0.8) c = cw;
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, flatShading: true }));
  m.castShadow = true;
  const grp = new THREE.Group();
  grp.add(m);
  return grp;
}

function pumpkinCushion(r, h, color, btn) {
  const g = new THREE.SphereGeometry(1, 24, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 4)), 0.6);
    p.setXYZ(i, x * r * k, y * h * (y > 0 ? 1 : 0.8), z * r * k);
  }
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const m = new THREE.Mesh(g, std(color, 0.95));
  m.castShadow = true;
  m.receiveShadow = true;
  grp.add(m);
  const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 10, 6), std(btn, 0.9));
  b.scale.y = 0.5;
  b.position.y = h * 0.92;
  grp.add(b);
  grp.userData.body = m;
  return grp;
}

function squareCushion(w, h, color) {
  const grp = new THREE.Group();
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, w, 3, h * 0.45), std(color, 0.95));
  m.castShadow = true;
  grp.add(m);
  grp.userData.body = m;
  return grp;
}

function slipperMesh(color) {
  const grp = new THREE.Group();
  const sole = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.035, 0.29, 2, 0.015), std(0xf3ead9, 0.9));
  sole.castShadow = true;
  grp.add(sole);
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.15, 12, 1, false, 0, Math.PI), std(color, 0.95));
  cover.rotation.z = Math.PI / 2;
  cover.rotation.y = Math.PI / 2;
  cover.scale.set(1, 1, 0.8);
  cover.position.set(0, 0.012, 0.055);
  cover.castShadow = true;
  grp.add(cover);
  grp.userData.cover = cover;
  return grp;
}

function teddyMesh() {
  const grp = new THREE.Group();
  const c = 0xc68a5a;
  const parts = [
    { geo: new THREE.SphereGeometry(0.075, 10, 8), matrix: mat(0, 0, 0, 0, 0, 0, 1, 1.05, 0.9), color: c },
    { geo: new THREE.SphereGeometry(0.06, 10, 8), matrix: mat(0, 0.1, 0.01), color: c },
    { geo: new THREE.SphereGeometry(0.022, 6, 5), matrix: mat(0.045, 0.15, 0), color: c },
    { geo: new THREE.SphereGeometry(0.022, 6, 5), matrix: mat(-0.045, 0.15, 0), color: c },
    { geo: new THREE.SphereGeometry(0.026, 8, 6), matrix: mat(0, 0.09, 0.055), color: 0xf0d2b0 },
    { geo: new THREE.SphereGeometry(0.028, 6, 5), matrix: mat(0.07, -0.01, 0.02), color: c },
    { geo: new THREE.SphereGeometry(0.028, 6, 5), matrix: mat(-0.07, -0.01, 0.02), color: c },
    { geo: new THREE.SphereGeometry(0.03, 6, 5), matrix: mat(0.04, -0.07, 0.03), color: c },
    { geo: new THREE.SphereGeometry(0.03, 6, 5), matrix: mat(-0.04, -0.07, 0.03), color: c },
    { geo: new THREE.SphereGeometry(0.009, 6, 4), matrix: mat(0.022, 0.115, 0.055), color: 0x2a1e1b },
    { geo: new THREE.SphereGeometry(0.009, 6, 4), matrix: mat(-0.022, 0.115, 0.055), color: 0x2a1e1b },
    { geo: new THREE.SphereGeometry(0.01, 6, 4), matrix: mat(0, 0.095, 0.08), color: 0x2a1e1b },
  ];
  const m = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.castShadow = true;
  grp.add(m);
  return grp;
}

function mugMesh() {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 14), std(0xfffaf2, 0.4));
  body.castShadow = true;
  grp.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0565, 0.0555, 0.03, 14), std(0xf29c8c, 0.5));
  band.position.y = 0.01;
  grp.add(band);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 10), std(0xfffaf2, 0.4));
  handle.position.set(0.065, 0, 0);
  grp.add(handle);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.048, 12), std(0x7a4a2a, 0.3));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.045;
  grp.add(coffee);
  return grp;
}

function bookMesh() {
  const grp = new THREE.Group();
  const cover = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.035, 0.15, 1, 0.005), std(0x9fcdb9, 0.8));
  cover.castShadow = true;
  grp.add(cover);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.027, 0.14), std(0xfffaf0, 0.9));
  pages.position.x = 0.006;
  grp.add(pages);
  return grp;
}

function paperMesh() {
  const grp = new THREE.Group();
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), std(0xfdf8ee, 1, { flatShading: true }));
  m.castShadow = true;
  grp.add(m);
  return grp;
}

function lampMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), std(0xd9a066, 0.5));
  base.position.y = 0.02;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 8), std(0xd9a066, 0.5));
  pole.position.y = 0.67;
  pole.castShadow = true;
  g.add(pole);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 16, 1, true), std(0xfff4e0, 0.8, { emissive: 0xffd9a0, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  shade.position.y = 1.42;
  shade.castShadow = true;
  g.add(shade);
  return g;
}

function trashMesh() {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.38, 14, 1, true), std(0xf6efe4, 0.7, { side: THREE.DoubleSide }));
  can.position.y = 0.19;
  can.castShadow = true;
  g.add(can);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14), std(0xe8dccb, 0.8));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.01;
  g.add(bottom);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.158, 0.05, 14, 1, true), std(0x9fcdb9, 0.7));
  band.position.y = 0.3;
  g.add(band);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), std(0xfdf8ee, 1, { flatShading: true }));
    p.position.set((i - 1) * 0.06, 0.36 + (i % 2) * 0.02, (i % 2) * 0.04 - 0.02);
    g.add(p);
  }
  return g;
}

function basketMesh() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.2, 16, 1, true), std(0xd8ad74, 0.9, { side: THREE.DoubleSide, flatShading: true }));
  b.position.y = 0.1;
  b.castShadow = true;
  g.add(b);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.21, 16), std(0xc9995d, 0.9));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.01;
  g.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 6, 20), std(0xc9995d, 0.8));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  g.add(rim);
  return g;
}

function cardboardMesh(w, h, d) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.015), std(0xd9a86c, 0.9));
  b.position.y = h / 2;
  b.castShadow = true;
  b.receiveShadow = true;
  g.add(b);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.005, d + 0.004), std(0xe9c89a, 0.7));
  tape.position.y = h + 0.002;
  g.add(tape);
  const stamp = new THREE.Mesh(new RoundedBoxGeometry(w * 0.4, h * 0.14, 0.004, 1, 0.01), std(0xb07c45, 0.9));
  stamp.position.set(0, h * 0.55, d / 2 + 0.002);
  g.add(stamp);
  return g;
}

// ------------------------------------------------------------
// 動くもの（くわえる・転がる・投げる）
// ------------------------------------------------------------
class Movable {
  constructor(world, kind, mesh, o) {
    this.world = world;
    this.kind = kind;
    this.mesh = mesh;
    this.label = o.label;
    this.r = o.r;
    this.restY = o.restY;
    this.bounce = o.bounce ?? 0.3;
    this.fric = o.fric ?? 3;
    this.grabbable = o.grabbable ?? true;
    this.rolls = !!o.rolls;
    this.holdPos = o.holdPos || new THREE.Vector3(0, -0.02, 0.08);
    this.holdRot = o.holdRot || new THREE.Euler(0, 0, 0);
    this.hp = o.hp ?? 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.mode = 'rest';
    this.yaw = 0;
    this.cause = null;
    this.thrown = false;
    this.data = {};
    this.restQ = new THREE.Quaternion();
    this.spin = 0;
    this.groundY = 0;
    world.group.add(mesh);
  }
  place(x, y, z, yaw = 0) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.restQ.setFromAxisAngle(_up, yaw);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.restQ);
    return this;
  }
  get active() { return this.mode === 'air' || this.mode === 'roll'; }
  kick(vx, vy, vz, cause) {
    if (this.mode === 'held' || this.mode === 'contained' || this.mode === 'gone') return;
    this.vel.set(vx, vy, vz);
    this.mode = vy > 0.01 || this.pos.y > this.restY + 0.01 ? 'air' : 'roll';
    if (cause) this.cause = cause;
  }
}

// ------------------------------------------------------------
// 立っているもの（倒れる）
// ------------------------------------------------------------
class Toppler {
  constructor(world, kind, model, o) {
    this.world = world;
    this.kind = kind;
    this.label = o.label;
    this.r = o.r;
    this.h = o.h;
    this.value = o.value;
    this.maxAngle = o.maxAngle ?? Math.PI / 2;
    this.onDown = o.onDown;
    this.pos = new THREE.Vector3(o.x, 0, o.z);
    this.outer = new THREE.Group();
    this.inner = new THREE.Group();
    this.outer.add(this.inner);
    this.inner.add(model);
    this.outer.position.copy(this.pos);
    if (o.yaw) model.rotation.y = o.yaw;
    world.group.add(this.outer);
    this.state = 'stand';
    this.wobT = 0;
    this.wobAxis = new THREE.Vector3(1, 0, 0);
    this.dir = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.t = 0;
    this.lastWobble = -9;
  }
  get standing() { return this.state === 'stand'; }

  wobble(dir) {
    if (this.state !== 'stand') return false;
    const now = this.world.time;
    if (now - this.lastWobble < 0.5) return false;
    this.lastWobble = now;
    this.wobT = 1;
    this.wobAxis.set(dir.z, 0, -dir.x).normalize();
    audio.play('wobble');
    return true;
  }

  topple(dir, cause, delay = 0) {
    if (this.state !== 'stand') return false;
    if (delay > 0) {
      this.state = 'pending';
      this.world.after(delay, () => { this.state = 'stand'; this.topple(dir, cause); });
      return true;
    }
    const d = this.world.safeDir(this.pos, dir, this.h + this.r);
    this.dir.copy(d);
    this.axis.set(d.z, 0, -d.x).normalize();
    this.cause = cause;
    this.state = 'falling';
    this.t = 0;
    this.dur = 0.22 + 0.16 * Math.sqrt(this.h);
    // 回転軸を底の縁へ
    this.outer.position.set(this.pos.x + d.x * this.r, 0, this.pos.z + d.z * this.r);
    this.inner.position.set(-d.x * this.r, 0, -d.z * this.r);
    this.outer.quaternion.identity();
    this.startAt = this.world.time;
    this.world.game?.onToppleStart?.(this);
    return true;
  }

  update(dt) {
    if (this.state === 'stand' && this.wobT > 0) {
      this.wobT = Math.max(0, this.wobT - dt * 1.8);
      const a = Math.sin(this.wobT * 26) * 0.1 * this.wobT;
      this.outer.quaternion.setFromAxisAngle(this.wobAxis, a);
    } else if (this.state === 'falling') {
      this.t += dt;
      const k = Math.min(1, this.t / this.dur);
      const a = this.maxAngle * easeInQuad(k);
      this.outer.quaternion.setFromAxisAngle(this.axis, a);
      if (k >= 1) {
        this.state = 'down';
        this.bounceT = 0;
        this.downAt = this.world.time;
        this.world.onToppled(this);
      }
    } else if (this.state === 'down' && this.bounceT < 1) {
      this.bounceT = Math.min(1, this.bounceT + dt * 4);
      const b = Math.sin(this.bounceT * Math.PI) * 0.12 * (1 - this.bounceT);
      this.outer.quaternion.setFromAxisAngle(this.axis, this.maxAngle - b);
    }
  }
}

// ------------------------------------------------------------
// ワールド
// ------------------------------------------------------------
export class World {
  constructor(scene, room, fx) {
    this.scene = scene;
    this.room = room;
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = room.colliders;
    this.game = null;
    this.movables = [];
    this.topplers = [];
    this.timers = [];
    this.time = 0;
    this.tissue = new TissueSystem(this);
    this.mug = null;
    this.setup = 0;
  }

  after(t, fn) { this.timers.push({ t, fn }); }

  reset() {
    for (const m of this.movables) { this.group.remove(m.mesh); disposeObject(m.mesh); }
    for (const t of this.topplers) { this.group.remove(t.outer); disposeObject(t.outer); }
    this.movables = [];
    this.topplers = [];
    this.timers = [];
    this.time = 0;
    this.flags = {};
    this.tableHits = 0;

    this.tissue.reset(LAYOUT.tissue.x, LAYOUT.tissue.z);

    // クッション
    const c1 = new Movable(this, 'cushion', pumpkinCushion(0.27, 0.11, 0xf1a08e, 0xe07f6c), {
      label: 'クッション', r: 0.27, restY: 0.09, bounce: 0.2, fric: 5, hp: 9,
      holdPos: new THREE.Vector3(0, -0.1, 0.2), holdRot: new THREE.Euler(1.1, 0, 0),
    }).place(-2.75, 0.09, 0.45);
    const c2 = new Movable(this, 'cushion', pumpkinCushion(0.27, 0.11, 0xf7efe2, 0xe8d8c0), {
      label: 'クッション', r: 0.27, restY: 0.09, bounce: 0.2, fric: 5, hp: 9,
      holdPos: new THREE.Vector3(0, -0.1, 0.2), holdRot: new THREE.Euler(1.1, 0, 0),
    }).place(-1.0, 0.09, 0.9);
    const c3 = new Movable(this, 'cushion', squareCushion(0.34, 0.12, 0x98cdb6), {
      label: 'クッション', r: 0.2, restY: 0.06, bounce: 0.2, fric: 5, hp: 9,
      holdPos: new THREE.Vector3(0, -0.08, 0.16), holdRot: new THREE.Euler(1.2, 0, 0.3),
    }).place(-1.2, 0.6, -2.5, 0.3);
    c3.groundY = 0;
    this.movables.push(c1, c2, c3);

    // スリッパ
    for (const [x, z, yaw] of [[0.82, -2.95, 0.15], [1.22, -2.9, -0.1]]) {
      this.movables.push(new Movable(this, 'slipper', mergeModel(slipperMesh(0xe3cdb0)), {
        label: 'スリッパ', r: 0.13, restY: 0.018, bounce: 0.3, fric: 4,
        holdPos: new THREE.Vector3(0, -0.04, 0.06), holdRot: new THREE.Euler(0.2, Math.PI / 2, 0),
      }).place(x, 0.018, z, yaw));
    }

    // くま（ベッドの住人）
    this.movables.push(new Movable(this, 'teddy', teddyMesh(), {
      label: 'くまちゃん', r: 0.1, restY: 0.08, bounce: 0.3, fric: 4,
      holdPos: new THREE.Vector3(0, -0.08, 0.1), holdRot: new THREE.Euler(0.4, 0, 0),
    }).place(BED.x + 0.15, 0.16, BED.z - 0.2, -0.4));

    // テーブルの上：マグと本
    this.mug = new Movable(this, 'mug', mergeModel(mugMesh()), { label: 'マグカップ', r: 0.06, restY: 0.055, bounce: 0.1, fric: 4, grabbable: false });
    this.mug.place(TABLE.x + 0.28, TABLE.top + 0.055, TABLE.z + 0.18, 0.6);
    this.mug.mode = 'table';
    this.book = new Movable(this, 'book', mergeModel(bookMesh()), {
      label: '本', r: 0.12, restY: 0.018, bounce: 0.2, fric: 5,
      holdPos: new THREE.Vector3(0, -0.04, 0.08), holdRot: new THREE.Euler(0.3, Math.PI / 2, 0),
    });
    this.book.place(TABLE.x + 0.05, TABLE.top + 0.018, TABLE.z + 0.28, -0.3);
    this.book.mode = 'table';
    this.movables.push(this.mug, this.book);

    // おもちゃカゴとボール
    const bx = 3.65, bz = -0.5;
    const basket = new Toppler(this, 'basket', mergeModel(basketMesh()), { label: 'おもちゃカゴ', x: bx, z: bz, r: 0.25, h: 0.22, value: 300, maxAngle: 1.75 });
    this.topplers.push(basket);
    this.balls = [];
    const ballCols = [[0xf7d154, 0xffffff], [0x5fa9e6, 0xffffff], [0xef6f8e, 0xffffff]];
    ballCols.forEach(([a, b], i) => {
      const ang = (i / 3) * Math.PI * 2;
      const ball = new Movable(this, 'ball', ballMesh(0.11, a, b), {
        label: 'ボール', r: 0.11, restY: 0.11, bounce: 0.55, fric: 0.55, rolls: true,
        holdPos: new THREE.Vector3(0, -0.03, 0.09),
      }).place(bx + Math.cos(ang) * 0.09, 0.24, bz + Math.sin(ang) * 0.09);
      ball.mode = 'contained';
      this.movables.push(ball);
      this.balls.push(ball);
    });
    basket.data = { balls: this.balls };
    // 外に出ているボール1つ（最初から蹴れる）
    const freeBall = new Movable(this, 'ball', ballMesh(0.11, 0xf29c6b, 0xfff3d6), {
      label: 'ボール', r: 0.11, restY: 0.11, bounce: 0.55, fric: 0.55, rolls: true,
      holdPos: new THREE.Vector3(0, -0.03, 0.09),
    }).place(2.3, 0.11, -0.2);
    this.movables.push(freeBall);

    // 観葉植物
    this.topplers.push(new Toppler(this, 'plant', mergeModel(makePlant(0xf1ebe1, 0x5f9f6e, 2.0, 31)), { label: '大きな観葉植物', x: 0.08, z: -3.12, r: 0.3, h: 1.15, value: 4000, maxAngle: 1.4 }));
    this.topplers.push(new Toppler(this, 'plant', mergeModel(makePlant(0xe8d2bb, 0x6fae7c, 1.45, 32)), { label: '観葉植物', x: -4.0, z: -0.15, r: 0.23, h: 0.85, value: 2500, maxAngle: 1.4 }));
    this.topplers.push(new Toppler(this, 'plant', mergeModel(makePlant(0xf6efe6, 0x74b182, 1.45, 33)), { label: '観葉植物', x: 3.3, z: 0.92, r: 0.23, h: 0.85, value: 2500, maxAngle: 1.4 }));

    // スタンドライト
    this.topplers.push(new Toppler(this, 'lamp', mergeModel(lampMesh()), { label: 'スタンドライト', x: -4.0, z: -1.75, r: 0.17, h: 1.6, value: 3500 }));
    // ゴミ箱
    this.topplers.push(new Toppler(this, 'trash', mergeModel(trashMesh()), { label: 'ゴミ箱', x: -4.0, z: 0.8, r: 0.17, h: 0.4, value: 400 }));

    // 段ボール（ドミノ）：回ごとに並びが変わる
    const setup = SETUPS[this.setup % SETUPS.length];
    const S = new THREE.Vector2(...setup.from), E = new THREE.Vector2(...setup.to);
    const n = setup.n;
    const lineYaw = Math.atan2(E.x - S.x, E.y - S.y);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = S.x + (E.x - S.x) * t, z = S.y + (E.y - S.y) * t;
      this.topplers.push(new Toppler(this, 'box', mergeModel(cardboardMesh(0.36, 0.5, 0.2)), { label: '段ボール', x, z, r: 0.14, h: 0.5, value: 400, yaw: lineYaw + Math.PI / 2 + (i % 2 ? 0.05 : -0.05) }));
    }
    this.boxCount = n;
  }

  get setupName() { return SETUPS[this.setup % SETUPS.length].name; }

  // ---- 補助 ----
  /** 倒れる先が壁なら、壁ぞいの向きに逃がす */
  safeDir(pos, dir, len) {
    const d = new THREE.Vector3(dir.x, 0, dir.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    d.normalize();
    // 横の壁：壁ぞいに倒れる（ほぼ真横なら部屋の手前側へ）
    const ex = pos.x + d.x * len;
    if (ex < ROOM.minX + 0.1 || ex > ROOM.maxX - 0.1) {
      d.x = 0;
      if (Math.abs(d.z) < 0.35) d.z = pos.z < 1 ? 1 : -1;
      d.normalize();
    }
    // 奥の壁：はね返って手前へ
    if (pos.z + d.z * len < ROOM.minZ + 0.1) {
      d.z = Math.abs(d.z) * 0.7 + 0.3;
      d.normalize();
    }
    return d;
  }

  isInBed(x, z, pad = 0) {
    return Math.hypot(x - BED.x, z - BED.z) < BED.r + pad;
  }

  /** 口の前にある、くわえられるもの */
  findGrabTarget(front, reach = 0.36) {
    let best = null, bestD = Infinity;
    for (const m of this.movables) {
      if (!m.grabbable || m.mode === 'held' || m.mode === 'contained' || m.mode === 'gone' || m.mode === 'table') continue;
      if (m.pos.y > 0.75) continue;
      const d = Math.hypot(m.pos.x - front.x, m.pos.z - front.z) - m.r * 0.6;
      if (d < reach && d < bestD) { best = m; bestD = d; }
    }
    const b = this.tissue.box;
    if (b.sheets > 0) {
      const d = Math.hypot(b.pos.x - front.x, b.pos.z - front.z) - 0.08;
      if (d < reach && d < bestD) { best = 'tissue'; bestD = d; }
    }
    return best;
  }

  grabTargetPos(t) {
    if (t === 'tissue') return this.tissue.box.pos;
    return t.pos;
  }

  // ---- くわえる / はなす ----
  attachHeld(m, mouth) {
    m.mode = 'held';
    m.vel.set(0, 0, 0);
    mouth.add(m.mesh);
    m.mesh.position.copy(m.holdPos);
    m.mesh.rotation.copy(m.holdRot);
    m.thrown = false;
    m.data.shakeT = 0;
  }

  releaseHeld(m, throwVel, heading) {
    this.group.attach(m.mesh);
    m.pos.copy(m.mesh.position);
    if (m.pos.y < m.restY) m.pos.y = m.restY;
    m.restQ.setFromAxisAngle(_up, heading + (m.kind === 'slipper' || m.kind === 'book' ? Math.PI / 2 : 0));
    if (throwVel) {
      m.vel.copy(throwVel);
      m.thrown = true;
      m.cause = 'throw';
      m.spin = 8;
    } else {
      m.vel.set(0, 0, 0);
      m.thrown = false;
      m.cause = null;
      m.spin = 0;
    }
    m.mode = 'air';
  }

  // ---- 犬との当たり ----
  resolveDog(dog) {
    const p = dog.pos;
    const r = dog.radius;
    const speed = Math.hypot(dog.vel.x, dog.vel.z);
    const dashing = dog.dashT > 0 && speed > 2.6;
    // 壁
    p.x = clamp(p.x, ROOM.minX + r, ROOM.maxX - r);
    p.z = clamp(p.z, ROOM.minZ + r, 3.2);
    // 家具
    for (const c of this.colliders) {
      if (c.type === 'circle') {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + r;
        if (d < min && d > 1e-5) {
          p.x = c.x + (dx / d) * min;
          p.z = c.z + (dz / d) * min;
          if (c.tag === 'table') this.bumpTable(dog, -dx / d, -dz / d, speed, dashing);
        }
      } else {
        const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-5) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
          else p.z = c.maxZ + r;
        }
      }
    }
    // ティッシュ箱
    {
      const b = this.tissue.box.pos;
      const dx = p.x - b.x, dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      const min = 0.15 + r;
      if (d < min && d > 1e-5) { p.x = b.x + (dx / d) * min; p.z = b.z + (dz / d) * min; }
    }
    // 立っているもの
    for (const t of this.topplers) {
      if (!t.standing) continue;
      const dx = p.x - t.pos.x, dz = p.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      const min = t.r + r;
      if (d < min && d > 1e-5) {
        p.x = t.pos.x + (dx / d) * min;
        p.z = t.pos.z + (dz / d) * min;
        _v.set(-dx / d, 0, -dz / d);
        if (dashing) {
          _v2.set(dog.vel.x, 0, dog.vel.z).normalize().add(_v).normalize();
          t.topple(_v2, 'dash');
          dog.onBump(true);
          this.fx.dustPuff(t.pos, 6, 1);
        } else if (speed > 0.6) {
          if (t.wobble(_v)) {
            dog.onBump(false, t);
            this.game?.onWobble(t);
          }
        }
      }
    }
    // 転がるもの・置いてあるもの
    for (const m of this.movables) {
      if (m.mode === 'held' || m.mode === 'contained' || m.mode === 'gone' || m.mode === 'table' || m.kind === 'treat') continue;
      if (m.pos.y > 0.5) continue;
      const dx = m.pos.x - p.x, dz = m.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = m.r + r * 0.9;
      if (d < min && d > 1e-5) {
        const nx = dx / d, nz = dz / d;
        const push = min - d;
        if (m.kind === 'ball' || m.kind === 'paper') {
          const s = Math.max(speed * (dashing ? 1.7 : 1.25), 1.0);
          const along = (dog.vel.x * nx + dog.vel.z * nz) / Math.max(speed, 0.001);
          const kx = nx * s * 0.7 + (dog.vel.x / Math.max(speed, 0.001)) * s * 0.5 * Math.max(0, along);
          const kz = nz * s * 0.7 + (dog.vel.z / Math.max(speed, 0.001)) * s * 0.5 * Math.max(0, along);
          m.kick(kx, dashing ? 1.2 : 0.3, kz, 'ball');
          m.pos.x += nx * push;
          m.pos.z += nz * push;
          if (speed > 1) audio.play('bounce', 1.2);
        } else {
          // 押しのける
          m.pos.x += nx * push;
          m.pos.z += nz * push;
          if (dashing) m.kick(nx * 2.2, 0.6, nz * 2.2, 'dash');
        }
      }
    }
  }

  /** テーブルが大きく揺れて、マグと本が落ちる */
  knockTable(dir, cause) {
    if (this.mug.mode !== 'table') return false;
    this.mug.mode = 'air';
    this.mug.vel.set(dir.x * 1.6, 1.2, dir.z * 1.6);
    this.mug.cause = cause;
    this.mug.spin = 10;
    this.mug.groundY = 0;
    if (this.book.mode === 'table') {
      this.book.mode = 'air';
      this.book.vel.set(dir.x * 1.2 + 0.3, 1.0, dir.z * 1.2);
      this.book.spin = 6;
    }
    this.room.tablePlant.userData.wob = 1;
    audio.play('wobble');
    return true;
  }

  bumpTable(dog, dx, dz, speed, dashing) {
    if (this.mug.mode === 'table') {
      if (dashing) {
        const dir = new THREE.Vector3(dog.vel.x, 0, dog.vel.z).normalize();
        this.knockTable(dir, 'dash');
        dog.onBump(true);
      } else if (speed > 0.8 && this.time - (this.lastTableWob || -9) > 0.6) {
        this.lastTableWob = this.time;
        this.mug.data.wob = 1;
        audio.play('wobble');
        dog.onBump(false);
        this.game?.onTableWobble();
      }
    }
  }

  // ---- 倒れた時 ----
  onToppled(t) {
    const g = this.game;
    const d = t.dir;
    const tip = new THREE.Vector3(t.pos.x + d.x * (t.r + t.h * 0.85), 0.1, t.pos.z + d.z * (t.r + t.h * 0.85));
    const mid = new THREE.Vector3(t.pos.x + d.x * (t.h * 0.5), 0.3, t.pos.z + d.z * (t.h * 0.5));
    this.fx.dustPuff(mid, 8, 1.1);
    switch (t.kind) {
      case 'plant':
        audio.play('plant');
        this.fx.spill(tip.clone().addScaledVector(d, -0.1), 0x6b4a33, 0.26 + t.h * 0.1, Math.random() * 10);
        this.fx.bitsBurst(tip, 10, [0x6b4a33, 0x5a3d2a, 0x6fae7c], 1.8, true, 0.9);
        break;
      case 'lamp':
        audio.play('crash');
        this.fx.bitsBurst(tip, 10, [0xfff4e0, 0xffe6b0], 2.2, true, 0.8);
        break;
      case 'trash': {
        audio.play('box', 1.3);
        for (let i = 0; i < 4; i++) {
          const pm = new Movable(this, 'paper', paperMesh(), { label: 'ゴミ', r: 0.05, restY: 0.05, bounce: 0.3, fric: 1.6, rolls: true, grabbable: false });
          pm.place(tip.x, 0.1, tip.z);
          const a = Math.atan2(d.z, d.x) + rand(-0.7, 0.7);
          const s = rand(1.2, 2.4);
          pm.kick(Math.cos(a) * s, rand(0.5, 1.5), Math.sin(a) * s, 'trash');
          this.movables.push(pm);
        }
        g?.incident('trash', tip);
        break;
      }
      case 'basket': {
        audio.play('box', 0.8);
        const a0 = Math.atan2(d.z, d.x);
        t.data.balls.forEach((b, i) => {
          b.mode = 'air';
          b.pos.set(tip.x, 0.2, tip.z);
          const a = a0 + (i - 1) * 0.45 + rand(-0.1, 0.1);
          const s = rand(2.4, 3.4);
          b.vel.set(Math.cos(a) * s, rand(1, 2), Math.sin(a) * s);
          b.cause = 'ball';
        });
        g?.incident('ballAvalanche', tip);
        break;
      }
      case 'box':
        audio.play('box', 1 + Math.random() * 0.3);
        break;
    }
    g?.damage({ key: t.kind, label: t.label, yen: t.value, pos: mid.setY(0.5), chain: true, count: 1, cause: t.cause });
    if (t.kind === 'plant' && (t.cause === 'ball')) g?.incident('plantByBall', mid);
    if (t.cause === 'throw') g?.incident('throwHit', mid);
    if (t.kind === 'box' && this.topplers.filter((x) => x.kind === 'box' && x.state !== 'down').length === 0) g?.incident('domino', mid);
    g?.react(mid, t.h > 0.8 ? 2 : 1);

    // 倒れた先にあるものを巻き込む
    const len = t.r + t.h;
    let hits = 0;
    for (const o of this.topplers) {
      if (o === t || o.state !== 'stand') continue;
      _v.set(o.pos.x - t.pos.x, 0, o.pos.z - t.pos.z);
      const along = _v.dot(d);
      if (along < 0 || along > len + o.r * 0.6) continue;
      const lat = Math.abs(_v.x * d.z - _v.z * d.x);
      if (lat > o.r + 0.14) continue;
      const nd = _v.clone().normalize().add(d).normalize();
      o.topple(nd, t.kind === 'lamp' ? 'lamp' : 'chain', 0.04 + along * 0.03);
      hits++;
    }
    // テーブルに倒れこんだら、マグが落ちる
    {
      _v.set(TABLE.x - t.pos.x, 0, TABLE.z - t.pos.z);
      const along = _v.dot(d);
      const lat = Math.abs(_v.x * d.z - _v.z * d.x);
      const reach = Math.sqrt(Math.max(0, TABLE.r * TABLE.r - lat * lat));
      if (lat < TABLE.r && along - reach < len && along + reach > 0) {
        if (this.knockTable(d, 'chain')) hits++;
      }
    }
    if (t.kind === 'lamp' && hits > 0) g?.incident('lamp', mid);
    for (const m of this.movables) {
      if (!(m.mode === 'rest' || m.mode === 'roll')) continue;
      _v.set(m.pos.x - t.pos.x, 0, m.pos.z - t.pos.z);
      const along = _v.dot(d);
      if (along < 0 || along > len) continue;
      const lat = Math.abs(_v.x * d.z - _v.z * d.x);
      if (lat > m.r + 0.15) continue;
      m.kick(d.x * 2.2 + _v.x * 0.5, 1.0, d.z * 2.2 + _v.z * 0.5, 'chain');
    }
  }

  // ---- 毎フレーム ----
  update(dt) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    for (const t of this.topplers) t.update(dt);

    // マグの揺れ
    if (this.mug.mode === 'table' && this.mug.data.wob > 0) {
      this.mug.data.wob = Math.max(0, this.mug.data.wob - dt * 2);
      const w = this.mug.data.wob;
      this.mug.mesh.rotation.z = Math.sin(w * 30) * 0.12 * w;
    }
    const tp = this.room.tablePlant;
    if (tp.userData.wob > 0) {
      tp.userData.wob = Math.max(0, tp.userData.wob - dt * 2);
      tp.rotation.z = Math.sin(tp.userData.wob * 25) * 0.15 * tp.userData.wob;
    }

    const ms = this.movables;
    for (const m of ms) {
      if (!m.active) {
        if (m.mode === 'rest' && !m.rolls) m.mesh.quaternion.slerp(m.restQ, 1 - Math.exp(-12 * dt));
        continue;
      }
      // 重力と移動
      const onGround = m.pos.y <= m.restY + m.groundY + 0.001;
      if (!onGround || m.vel.y > 0) m.vel.y -= GRAV * dt;
      m.pos.addScaledVector(m.vel, dt);
      const floorY = m.restY + m.groundY;
      if (m.pos.y <= floorY) {
        m.pos.y = floorY;
        if (m.vel.y < -1.3) {
          const impact = -m.vel.y;
          m.vel.y = impact * m.bounce;
          this.onLand(m, impact);
          if (m.mode === 'gone') continue;
        } else {
          m.vel.y = 0;
          if (m.mode === 'air') this.onLand(m, 0);
          if (m.mode === 'gone') continue;
          m.mode = 'roll';
        }
      }
      if (m.pos.y <= floorY + 0.001) {
        const k = Math.exp(-m.fric * dt);
        m.vel.x *= k; m.vel.z *= k;
      }
      // 壁
      if (m.pos.x < ROOM.minX + m.r) { m.pos.x = ROOM.minX + m.r; m.vel.x = Math.abs(m.vel.x) * 0.6; this._bonk(m); }
      if (m.pos.x > ROOM.maxX - m.r) { m.pos.x = ROOM.maxX - m.r; m.vel.x = -Math.abs(m.vel.x) * 0.6; this._bonk(m); }
      if (m.pos.z < ROOM.minZ + m.r) { m.pos.z = ROOM.minZ + m.r; m.vel.z = Math.abs(m.vel.z) * 0.6; this._bonk(m); }
      if (m.pos.z > 3.3) { m.pos.z = 3.3; m.vel.z = -Math.abs(m.vel.z) * 0.6; this._bonk(m); }
      // 家具
      for (const c of this.colliders) {
        if (m.pos.y - m.r > c.h) continue;
        if (c.type === 'circle') {
          const dx = m.pos.x - c.x, dz = m.pos.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + m.r;
          if (d < min && d > 1e-5) {
            const nx = dx / d, nz = dz / d;
            m.pos.x = c.x + nx * min; m.pos.z = c.z + nz * min;
            const vn = m.vel.x * nx + m.vel.z * nz;
            if (vn < 0) { m.vel.x -= 1.6 * vn * nx; m.vel.z -= 1.6 * vn * nz; this._bonk(m); }
            if (c.tag === 'table' && Math.abs(vn) > 2.2 && this.mug.mode === 'table') {
              // 強く当たるとテーブルが揺れる
              this.mug.data.wob = 1;
            }
          }
        } else {
          const cx = clamp(m.pos.x, c.minX, c.maxX), cz = clamp(m.pos.z, c.minZ, c.maxZ);
          const dx = m.pos.x - cx, dz = m.pos.z - cz;
          const d = Math.hypot(dx, dz);
          if (d < m.r) {
            if (d > 1e-5) {
              const nx = dx / d, nz = dz / d;
              m.pos.x = cx + nx * m.r; m.pos.z = cz + nz * m.r;
              const vn = m.vel.x * nx + m.vel.z * nz;
              if (vn < 0) { m.vel.x -= 1.6 * vn * nx; m.vel.z -= 1.6 * vn * nz; this._bonk(m); }
            } else if (m.pos.y > c.h * 0.7) {
              // 家具の上に落ちた → 手前に転がす
              m.pos.z = c.maxZ + m.r;
            }
          }
        }
      }
      // 立っているものに当たる
      const sp = Math.hypot(m.vel.x, m.vel.z);
      for (const t of this.topplers) {
        if (!t.standing) continue;
        if (m.pos.y - m.r > t.h) continue;
        const dx = m.pos.x - t.pos.x, dz = m.pos.z - t.pos.z;
        const d = Math.hypot(dx, dz), min = t.r + m.r;
        if (d < min && d > 1e-5) {
          const nx = dx / d, nz = dz / d;
          const need = m.kind === 'treat' ? 99 : m.thrown ? 0.8 : (t.kind === 'lamp' ? 1.9 : 1.3);
          if (sp > need) {
            t.topple(_v.set(m.vel.x, 0, m.vel.z), m.thrown ? 'throw' : (m.kind === 'ball' ? 'ball' : m.cause || 'chain'));
            m.vel.x *= 0.5; m.vel.z *= 0.5;
          } else if (sp > 0.5) {
            t.wobble(_v.set(-nx, 0, -nz));
          }
          m.pos.x = t.pos.x + nx * min; m.pos.z = t.pos.z + nz * min;
          const vn = m.vel.x * nx + m.vel.z * nz;
          if (vn < 0) { m.vel.x -= 1.5 * vn * nx; m.vel.z -= 1.5 * vn * nz; }
        }
      }
      // 他の動くもの
      for (const o of ms) {
        if (o === m || o.mode === 'held' || o.mode === 'contained' || o.mode === 'gone' || o.mode === 'table') continue;
        if (Math.abs(o.pos.y - m.pos.y) > (o.r + m.r)) continue;
        const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
        const d = Math.hypot(dx, dz), min = o.r + m.r;
        if (d < min && d > 1e-5) {
          const nx = dx / d, nz = dz / d;
          const rel = (m.vel.x - o.vel.x) * nx + (m.vel.z - o.vel.z) * nz;
          const push = (min - d) / 2;
          m.pos.x -= nx * push; m.pos.z -= nz * push;
          o.pos.x += nx * push; o.pos.z += nz * push;
          if (rel > 0) {
            const heavy = o.kind === 'cushion' || o.kind === 'slipper' ? 0.5 : 1;
            o.vel.x += nx * rel * 0.9 * heavy; o.vel.z += nz * rel * 0.9 * heavy;
            m.vel.x -= nx * rel * 0.7; m.vel.z -= nz * rel * 0.7;
            if (o.mode === 'rest') o.mode = 'roll';
            if (!o.cause) o.cause = m.cause;
            if (rel > 1) audio.play('bounce', 0.9 + Math.random() * 0.3);
          }
        }
      }
      // 回転
      if (m.rolls) {
        const s = Math.hypot(m.vel.x, m.vel.z);
        if (s > 0.01) {
          _v.set(m.vel.z, 0, -m.vel.x).normalize();
          _q.setFromAxisAngle(_v, (s * dt) / m.r);
          m.mesh.quaternion.premultiply(_q);
        }
      } else if (m.mode === 'air' && m.spin > 0) {
        _q.setFromAxisAngle(_v.set(1, 0, 0.3).normalize(), m.spin * dt);
        m.mesh.quaternion.multiply(_q);
      } else {
        m.mesh.quaternion.slerp(m.restQ, 1 - Math.exp(-12 * dt));
      }
      m.mesh.position.copy(m.pos);
      // 止まった
      if (m.mode === 'roll' && Math.hypot(m.vel.x, m.vel.z) < 0.04) {
        m.vel.set(0, 0, 0);
        m.mode = 'rest';
        m.thrown = false;
        m.cause = null;
        this.onRest(m);
      }
    }
    // 転がり中は投げた扱いを弱める
    for (const m of ms) if (m.thrown && m.mode === 'roll' && Math.hypot(m.vel.x, m.vel.z) < 1.2) m.thrown = false;
  }

  _bonk(m) {
    const s = Math.hypot(m.vel.x, m.vel.z);
    if (s > 0.8 && (m.kind === 'ball' || m.kind === 'paper')) audio.play('bounce', 0.8);
  }

  // ---- おやつ（カメラから発射） ----
  spawnTreat(from, to) {
    const g = new THREE.Group();
    const parts = [
      { geo: new THREE.CapsuleGeometry(0.018, 0.07, 3, 6), matrix: mat(0, 0, 0, 0, 0, Math.PI / 2), color: 0xd9a05b },
      { geo: new THREE.SphereGeometry(0.024, 6, 5), matrix: mat(0.05, 0.012, 0), color: 0xd9a05b },
      { geo: new THREE.SphereGeometry(0.024, 6, 5), matrix: mat(0.05, -0.012, 0), color: 0xd9a05b },
      { geo: new THREE.SphereGeometry(0.024, 6, 5), matrix: mat(-0.05, 0.012, 0), color: 0xd9a05b },
      { geo: new THREE.SphereGeometry(0.024, 6, 5), matrix: mat(-0.05, -0.012, 0), color: 0xd9a05b },
    ];
    const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    mesh.castShadow = true;
    g.add(mesh);
    const m = new Movable(this, 'treat', g, { label: 'おやつ', r: 0.05, restY: 0.03, bounce: 0.3, fric: 5, grabbable: false });
    m.place(from.x, from.y, from.z);
    const T = clamp(0.45 + from.distanceTo(to) * 0.09, 0.55, 1.1);
    m.vel.set((to.x - from.x) / T, (to.y + 0.03 - from.y) / T + 0.5 * GRAV * T, (to.z - from.z) / T);
    m.mode = 'air';
    m.spin = 9;
    m.data.land = to.clone();
    this.movables.push(m);
    return m;
  }

  removeMovable(m) {
    m.mode = 'gone';
    m.mesh.visible = false;
    if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
  }

  onLand(m, impact) {
    m.spin = 0;
    if (m.kind === 'treat') {
      if (!m.data.landed) { m.data.landed = true; audio.play('bounce', 1.6); this.game?.onTreatLanded?.(m); }
      return;
    }
    if (m.kind === 'mug' && m.mode !== 'gone') {
      m.mode = 'gone';
      m.mesh.visible = false;
      audio.play('crash');
      const p = m.pos.clone().setY(0.05);
      this.fx.bitsBurst(p, 12, [0xfffaf2, 0xf29c8c, 0xfffaf2], 1.6, true, 0.8);
      this.fx.spill(p, 0x8a5a36, 0.28, 3);
      this.game?.damage({ key: 'mug', label: 'マグカップ', yen: 1800, pos: p.setY(0.3), chain: true, count: 1 });
      this.game?.incident('mug', p);
      this.game?.react(p, 1);
      return;
    }
    if (m.kind === 'book' && impact > 0 && !m.data.fell) {
      m.data.fell = true;
      audio.play('thud', 1.4);
      this.game?.damage({ key: 'book', label: '本', yen: 300, pos: m.pos.clone().setY(0.3), chain: true, count: 1 });
      return;
    }
    if (impact > 3) {
      if (m.kind === 'cushion') { audio.play('thud', 0.7); this.fx.dustPuff(m.pos, 5, 0.9); }
      else if (m.kind === 'ball') audio.play('bounce', 1);
      else audio.play('thud', 1.2);
    } else if (impact > 1.3 && m.kind === 'ball') audio.play('bounce', 0.7);
  }

  onRest(m) {
    if (m.kind === 'treat') return;
    if (m.kind === 'slipper') {
      const inBed = this.movables.filter((s) => s.kind === 'slipper' && s.mode === 'rest' && this.isInBed(s.pos.x, s.pos.z, 0.05));
      if (inBed.length >= 2) this.game?.incident('slipperMove', m.pos.clone());
    }
    if (this.isInBed(m.pos.x, m.pos.z) && m.kind !== 'teddy' && this.game && !m.data.bedNoted) {
      m.data.bedNoted = true;
      this.game.onTreasure(m);
    }
    if (!this.isInBed(m.pos.x, m.pos.z)) m.data.bedNoted = false;
  }

  treasures() {
    return this.movables.filter((m) => m.kind !== 'teddy' && m.kind !== 'paper' && m.kind !== 'treat' && m.mode !== 'held' && m.mode !== 'gone' && this.isInBed(m.pos.x, m.pos.z, 0.05));
  }

  /** 犬が考えごとをする対象（未体験のいたずら） */
  interestFor(pos, done) {
    const cands = [];
    const b = this.tissue.box;
    if (b.sheets > 0 && !done.tissue) cands.push({ key: 'tissue', pos: b.pos });
    for (const m of this.movables) {
      if (m.mode !== 'rest' || !m.grabbable) continue;
      if (m.kind === 'cushion' && !done.cushion) cands.push({ key: 'cushion', pos: m.pos });
      if (m.kind === 'slipper' && !done.slipper) cands.push({ key: 'slipper', pos: m.pos });
    }
    for (const t of this.topplers) {
      if (!t.standing) continue;
      if (t.kind === 'basket' && !done.basket) cands.push({ key: 'basket', pos: t.pos });
      if (t.kind === 'box' && !done.box) cands.push({ key: 'box', pos: t.pos });
      if (t.kind === 'lamp' && !done.lamp) cands.push({ key: 'lamp', pos: t.pos });
    }
    if (this.mug.mode === 'table' && !done.mug) cands.push({ key: 'mug', pos: this.mug.pos });
    let best = null, bd = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  inSun(x, z) { return inSun(x, z); }
}

export { TISSUE_YEN };
