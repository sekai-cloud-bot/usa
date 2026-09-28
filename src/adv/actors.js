import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeParts, mat as M4, clamp, damp, dampAngle, angleDiff, mulberry32, puffGeometry } from '../util.js';
import { LIGHTS } from './build.js';
import { audio } from '../audio.js';

// ------------------------------------------------------------
// 人（ころんとした等身。部位ごとに1メッシュ）
// ------------------------------------------------------------
const personMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
personMat.userData.shared = true;
personMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.1;');
};

const SKIN = [0xf6d2b8, 0xefc3a4, 0xe2b08e, 0xf8dcc6];
const rb = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
const sph = (r, a = 12, b = 8) => new THREE.SphereGeometry(r, a, b);
const cy = (rt, rbm, h, s = 10) => new THREE.CylinderGeometry(rt, rbm, h, s);

function part(parts, pivot) {
  const m = new THREE.Mesh(mergeParts(parts), personMat);
  m.castShadow = true;
  m.receiveShadow = true;
  pivot.add(m);
  return m;
}

/** 回転体（胴・スカート・コート）。pts: [[半径, 高さ], ...] 下から上へ */
function lathe(pts, seg = 14) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
const cap = (r, len, s = 10) => new THREE.CapsuleGeometry(r, len, 4, s);

/**
 * opts: { skin, hair, hairStyle('short'|'long'|'bun'|'bald'), top, bottom, shoes, apron, hat, kid, scarf, bag, glasses, flag, skirt, coat, vest }
 */
export function buildPerson(o = {}) {
  const skin = o.skin ?? SKIN[0];
  const hair = o.hair ?? 0x3b2a22;
  const top = o.top ?? 0x8fb4d8;
  const bottom = o.bottom ?? 0x4a5468;
  const shoes = o.shoes ?? 0xf2eee8;
  const s = o.kid ? 0.62 : 1;
  const root = new THREE.Group();
  const body = new THREE.Group();   // 腰から上（しゃがむと下がる）
  root.add(body);
  const hipY = 0.8;
  body.position.y = hipY;
  const legCol = o.skirt ? (o.tights ?? 0x5b4a52) : bottom;
  // 脚
  const legs = [];
  for (const side of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(side * 0.1, 0.02, 0);
    part([
      { geo: cap(0.068, 0.56), matrix: M4(0, -0.36, 0), color: legCol },
      { geo: rb(0.13, 0.085, 0.25, 0.04), matrix: M4(0, -0.74, 0.045), color: shoes },
    ], pv);
    body.add(pv);
    legs.push(pv);
  }
  // 胴（なめらかな回転体をすこし平たく）
  const torso = new THREE.Group();
  const flat = (g) => { g.scale(1, 1, 0.74); return g; };
  const tp = [];
  if (o.coat) {
    tp.push({ geo: flat(lathe([[0.001, -0.3], [0.25, -0.3], [0.235, -0.05], [0.205, 0.2], [0.215, 0.44], [0.2, 0.56], [0.13, 0.64], [0.05, 0.67]])), color: top });
    tp.push({ geo: flat(lathe([[0.1, 0.6], [0.12, 0.66], [0.09, 0.7]], 12)), color: o.inner ?? 0xf6efe2 });
    tp.push({ geo: new THREE.BoxGeometry(0.018, 0.8, 0.02), matrix: M4(0, 0.16, 0.165), color: 0x000000 });
  } else {
    tp.push({ geo: flat(lathe([[0.001, -0.02], [0.2, -0.02], [0.2, 0.1], [0.185, 0.26], [0.205, 0.44], [0.195, 0.56], [0.13, 0.64], [0.05, 0.67]])), color: top });
    tp.push({ geo: flat(lathe([[0.001, -0.06], [0.205, -0.06], [0.2, 0.12]])), color: bottom });
  }
  if (o.skirt) tp.push({ geo: lathe([[0.001, -0.34], [0.3, -0.34], [0.24, -0.05], [0.2, 0.12]]), color: bottom });
  if (o.apron) tp.push({ geo: rb(0.36, 0.62, 0.03, 0.02), matrix: M4(0, 0.12, 0.155), color: o.apron });
  if (o.vest) tp.push({ geo: flat(lathe([[0.215, 0.05], [0.21, 0.3], [0.22, 0.5], [0.16, 0.62]])), color: o.vest });
  if (o.scarf) tp.push({ geo: new THREE.TorusGeometry(0.1, 0.045, 8, 16), matrix: M4(0, 0.63, 0, Math.PI / 2 - 0.15), color: o.scarf }, { geo: rb(0.08, 0.26, 0.04, 0.02), matrix: M4(0.06, 0.48, 0.13, 0.1, 0, 0.1), color: o.scarf });
  if (o.bag) tp.push({ geo: rb(0.26, 0.22, 0.1, 0.04), matrix: M4(0.27, 0.1, 0.02, 0, 0, 0.08), color: o.bag }, { geo: cy(0.012, 0.012, 0.6, 4), matrix: M4(0.07, 0.38, 0.08, 0, 0, 0.55), color: o.bag });
  tp.push({ geo: cy(0.055, 0.06, 0.1, 10), matrix: M4(0, 0.7, 0), color: skin });
  part(tp, torso);
  body.add(torso);
  // 腕
  const arms = [];
  for (const side of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(side * 0.235, 0.56, 0);
    const parts = [
      { geo: cap(0.056, 0.4), matrix: M4(0, -0.24, 0), color: top },
      { geo: sph(0.058, 10, 8), matrix: M4(0, -0.5, 0.01, 0, 0, 0, 0.9, 1.1, 0.9), color: skin },
    ];
    if (o.flag && side > 0) {
      parts.push({ geo: cy(0.012, 0.012, 0.9, 4), matrix: M4(0, -0.52, 0.28, Math.PI / 2), color: 0xdddddd });
      parts.push({ geo: new THREE.BoxGeometry(0.02, 0.32, 0.42), matrix: M4(0, -0.38, 0.55), color: 0xf2c23a });
    }
    part(parts, pv);
    torso.add(pv);
    arms.push(pv);
  }
  // 頭
  const head = new THREE.Group();
  head.position.y = 0.73;
  const hs = o.kid ? 1.3 : 1;
  const H = (x, y, z) => M4(x * hs, y * hs, z * hs);
  const Hs = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => M4(x * hs, y * hs, z * hs, rx, ry, rz, sx * hs, sy * hs, sz * hs);
  const hp = [
    { geo: sph(0.2, 18, 14), matrix: Hs(0, 0.2, 0, 1, 1.04, 0.97), color: skin },
    { geo: sph(0.045, 8, 6), matrix: Hs(-0.195, 0.19, 0, 0.6, 1, 1), color: skin },
    { geo: sph(0.045, 8, 6), matrix: Hs(0.195, 0.19, 0, 0.6, 1, 1), color: skin },
    // 目・まゆ・鼻・口・ほお
    { geo: sph(0.027, 10, 8), matrix: Hs(-0.068, 0.2, 0.176, 1, 1.3, 0.5), color: 0x2a1f1b },
    { geo: sph(0.027, 10, 8), matrix: Hs(0.068, 0.2, 0.176, 1, 1.3, 0.5), color: 0x2a1f1b },
    { geo: sph(0.009, 6, 4), matrix: H(-0.06, 0.214, 0.19), color: 0xffffff },
    { geo: sph(0.009, 6, 4), matrix: H(0.076, 0.214, 0.19), color: 0xffffff },
    { geo: new THREE.BoxGeometry(0.05, 0.011, 0.01), matrix: Hs(-0.07, 0.262, 0.178, 1, 1, 1, 0, 0, 0.12), color: hair },
    { geo: new THREE.BoxGeometry(0.05, 0.011, 0.01), matrix: Hs(0.07, 0.262, 0.178, 1, 1, 1, 0, 0, -0.12), color: hair },
    { geo: sph(0.016, 8, 6), matrix: H(0, 0.165, 0.198), color: 0xe8b394 },
    { geo: new THREE.TorusGeometry(0.022, 0.006, 4, 10, Math.PI), matrix: Hs(0, 0.125, 0.187, 1, 1, 1, 0, 0, Math.PI), color: 0x9a4a4a },
    { geo: sph(0.035, 8, 6), matrix: Hs(-0.115, 0.15, 0.15, 1, 0.55, 0.4), color: 0xf4a3a0 },
    { geo: sph(0.035, 8, 6), matrix: Hs(0.115, 0.15, 0.15, 1, 0.55, 0.4), color: 0xf4a3a0 },
  ];
  const st = o.hairStyle || 'short';
  const hc = o.hat === 'kerchief' ? (o.hatColor ?? 0xe8604c) : hair;
  if (st !== 'bald') {
    hp.push({ geo: new THREE.SphereGeometry(0.214, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), matrix: Hs(0, 0.215, -0.012, 1, 1.02, 1, -0.22), color: hc });
    hp.push({ geo: sph(0.196, 14, 10), matrix: Hs(0, 0.19, -0.045, 1.04, 1, 0.92), color: hc });
    hp.push({ geo: sph(0.15, 12, 8), matrix: Hs(0.02, 0.33, 0.1, 1.25, 0.42, 0.75, 0.25, 0, -0.1), color: hc });
  }
  if (st === 'long') {
    hp.push({ geo: rb(0.37, 0.42, 0.14, 0.07), matrix: H(0, 0.04, -0.1), color: hair });
    hp.push({ geo: cap(0.042, 0.18, 8), matrix: H(-0.17, 0.09, -0.02), color: hair });
    hp.push({ geo: cap(0.042, 0.18, 8), matrix: H(0.17, 0.09, -0.02), color: hair });
  }
  if (st === 'bun') hp.push({ geo: sph(0.085, 10, 8), matrix: H(0, 0.43, -0.1), color: hair });
  if (st === 'bald') hp.push({ geo: sph(0.2, 12, 8), matrix: Hs(0, 0.15, -0.035, 1.03, 0.7, 0.95), color: hair });
  if (o.hat === 'cap') hp.push({ geo: new THREE.SphereGeometry(0.222, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), matrix: H(0, 0.24, 0), color: o.hatColor ?? 0x3f8f6a }, { geo: cy(0.15, 0.15, 0.02, 14), matrix: Hs(0, 0.25, 0.16, 1, 1, 0.9, 0.12), color: o.hatColor ?? 0x3f8f6a });
  if (o.hat === 'kerchief') hp.push({ geo: new THREE.ConeGeometry(0.06, 0.1, 4), matrix: M4(0, 0.2 * hs, -0.22 * hs, -2.2), color: o.hatColor ?? 0xe8604c });
  if (o.hat === 'straw') hp.push({ geo: cy(0.34, 0.34, 0.02, 18), matrix: H(0, 0.33, 0), color: 0xe8cf8a }, { geo: cy(0.17, 0.2, 0.14, 14), matrix: H(0, 0.4, 0), color: 0xe8cf8a }, { geo: cy(0.205, 0.205, 0.04, 14), matrix: H(0, 0.36, 0), color: 0x6b4a3e });
  if (o.hat === 'yellow') hp.push({ geo: new THREE.SphereGeometry(0.23, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), matrix: H(0, 0.23, 0), color: 0xf6d35a }, { geo: cy(0.28, 0.28, 0.015, 16), matrix: H(0, 0.23, 0), color: 0xf6d35a });
  if (o.glasses) hp.push({ geo: new THREE.TorusGeometry(0.042, 0.007, 4, 14), matrix: H(-0.068, 0.2, 0.19), color: 0x3b3330 }, { geo: new THREE.TorusGeometry(0.042, 0.007, 4, 14), matrix: H(0.068, 0.2, 0.19), color: 0x3b3330 }, { geo: new THREE.BoxGeometry(0.05, 0.008, 0.008), matrix: H(0, 0.21, 0.195), color: 0x3b3330 });
  part(hp, head);
  torso.add(head);
  root.scale.setScalar(s * (o.scale || 1));
  return { root, body, torso, head, arms, legs, hipY };
}

export class Person {
  constructor(scene, opts = {}) {
    this.rig = buildPerson(opts);
    this.root = this.rig.root;
    scene.add(this.root);
    this.pos = this.root.position;
    this.heading = opts.heading || 0;
    this.speed = opts.speed || 1.15;
    this.path = null;
    this.pathI = 0;
    this.loop = true;
    this.pause = 0;
    this.t = Math.random() * 10;
    this.phase = 0;
    this.pose = 'stand';     // stand | wave | crouch | hug | give | flag | sit | look
    this.poseK = {};
    this.lookAt = null;
    this.walking = false;
    this.name = opts.name || '';
    this.kid = !!opts.kid;
    this.height = (opts.kid ? 1.15 : 1.65) * (opts.scale || 1);
    this.onArrive = null;
    this.target = null;
  }
  place(x, z, h = this.heading, y = 0) { this.pos.set(x, y, z); this.heading = h; }
  walkTo(x, z, cb) { this.target = new THREE.Vector3(x, 0, z); this.path = null; this.onArrive = cb || null; }
  follow(points, loop = true) { this.path = points; this.pathI = 0; this.loop = loop; this.target = null; }

  update(dt, dogPos) {
    this.t += dt;
    let goal = null;
    if (this.target) goal = this.target;
    else if (this.path && this.pause <= 0) goal = this.path[this.pathI];
    if (this.pause > 0) this.pause -= dt;
    this.walking = false;
    if (goal && this.pose !== 'crouch' && this.pose !== 'sit') {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        if (this.target) { this.target = null; const cb = this.onArrive; this.onArrive = null; if (cb) cb(); }
        else if (this.path) {
          this.pathI++;
          if (this.pathI >= this.path.length) { if (this.loop) this.pathI = 0; else { this.path = null; } }
          if (Math.random() < 0.3) this.pause = 1 + Math.random() * 3;
        }
      } else {
        this.walking = true;
        const sp = Math.min(this.speed, d * 3);
        this.pos.x += (dx / d) * sp * dt;
        this.pos.z += (dz / d) * sp * dt;
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 8, dt);
      }
    }
    // 犬が近いと見る
    let look = this.lookAt;
    if (!look && dogPos && this.pos.distanceTo(dogPos) < 4.5) look = dogPos;
    this.animate(dt, look);
  }

  animate(dt, look) {
    const r = this.rig;
    const k = this.poseK;
    for (const p of ['wave', 'crouch', 'hug', 'give', 'flag', 'sit', 'cheer']) k[p] = damp(k[p] || 0, this.pose === p || (p === 'crouch' && this.kneel) ? 1 : 0, 6, dt);
    this.phase += dt * (this.walking ? 7.5 * (this.speed / 1.15) : 0);
    const w = this.walking ? 1 : 0;
    this.wk = damp(this.wk || 0, w, 8, dt);
    const sw = Math.sin(this.phase) * 0.55 * this.wk;
    r.legs[0].rotation.x = sw;
    r.legs[1].rotation.x = -sw;
    const bob = Math.abs(Math.sin(this.phase)) * 0.035 * this.wk;
    const breathe = Math.sin(this.t * 2) * 0.008;
    // しゃがむ（片ひざ）
    const c = k.crouch, st = k.sit;
    r.body.position.y = r.hipY + bob + breathe - c * 0.42 - st * 0.34;
    r.legs[0].rotation.x += -c * 1.55 - st * 1.5;
    r.legs[1].rotation.x += c * 0.3 - st * 1.5;
    r.torso.rotation.x = c * 0.35 + k.hug * 0.1;
    // 腕
    const aw = Math.sin(this.phase) * 0.45 * this.wk;
    let aL = -aw, aR = aw, zL = 0.08, zR = -0.08;
    aL += -k.hug * 1.2 - k.give * 0.2 - k.cheer * 2.6;
    aR += -k.hug * 1.2 - k.give * 1.3 - k.wave * 2.7 - k.flag * 1.6 - k.cheer * 2.6;
    zL += -k.hug * 0.55 - k.cheer * 0.35;
    zR += k.hug * 0.55 + k.cheer * 0.35 - k.wave * (0.3 + Math.sin(this.t * 9) * 0.25);
    r.arms[0].rotation.set(aL, 0, zL);
    r.arms[1].rotation.set(aR, 0, zR);
    // 頭
    let yaw = 0, pitch = 0;
    if (look) {
      const dx = look.x - this.pos.x, dz = look.z - this.pos.z;
      yaw = clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -1.1, 1.1);
      const dy = (look.y || 0) - (this.pos.y + this.height * 0.9 - c * 0.4);
      pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.2, 0.7);
    }
    r.head.rotation.y = damp(r.head.rotation.y, yaw, 5, dt);
    r.head.rotation.x = damp(r.head.rotation.x, pitch, 5, dt);
    this.root.rotation.y = this.heading;
  }

  headWorld(out) { return this.rig.head.getWorldPosition(out).add(new THREE.Vector3(0, 0.5 * this.root.scale.y, 0)); }
}

// ------------------------------------------------------------
// ねこ
// ------------------------------------------------------------
export class Cat {
  constructor(scene, { color = 0xf0a55e, belly = 0xfff4e6, stripes = 0xc9773a } = {}) {
    const g = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    bm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.15;');
    };
    // 胴：前が少し高い、しなやかな形
    const bodyParts = [
      { geo: cap(0.11, 0.26, 10), matrix: M4(0, 0.2, 0, Math.PI / 2 - 0.08), color },
      { geo: cap(0.085, 0.2, 8), matrix: M4(0, 0.15, 0.03, Math.PI / 2 - 0.08, 0, 0, 1, 1, 0.9), color: belly },
    ];
    for (let i = 0; i < 4; i++) bodyParts.push({ geo: new THREE.TorusGeometry(0.108, 0.012, 4, 12, Math.PI), matrix: M4(0, 0.21, -0.14 + i * 0.07, 0, Math.PI / 2, 0), color: stripes });
    const body = new THREE.Mesh(mergeParts(bodyParts), bm);
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Group();
    head.position.set(0, 0.3, 0.2);
    const hm = new THREE.Mesh(mergeParts([
      { geo: sph(0.105, 14, 12), matrix: M4(0, 0, 0, 0, 0, 0, 1.12, 0.95, 1), color },
      { geo: new THREE.ConeGeometry(0.048, 0.085, 4), matrix: M4(-0.065, 0.095, -0.01, 0, 0.8, -0.28), color },
      { geo: new THREE.ConeGeometry(0.048, 0.085, 4), matrix: M4(0.065, 0.095, -0.01, 0, -0.8, 0.28), color },
      { geo: new THREE.ConeGeometry(0.03, 0.05, 4), matrix: M4(-0.064, 0.09, 0.005, 0, 0.8, -0.28), color: 0xf2b6ad },
      { geo: new THREE.ConeGeometry(0.03, 0.05, 4), matrix: M4(0.064, 0.09, 0.005, 0, -0.8, 0.28), color: 0xf2b6ad },
      { geo: sph(0.055, 10, 8), matrix: M4(0, -0.035, 0.07, 0, 0, 0, 1.25, 0.8, 0.8), color: belly },
      { geo: sph(0.014, 6, 4), matrix: M4(0, -0.01, 0.11), color: 0xe98a8a },
      { geo: new THREE.BoxGeometry(0.03, 0.08, 0.01), matrix: M4(0, 0.07, 0.07, -0.5), color: stripes },
      { geo: new THREE.BoxGeometry(0.015, 0.06, 0.01), matrix: M4(-0.03, 0.065, 0.075, -0.5, 0, 0.3), color: stripes },
      { geo: new THREE.BoxGeometry(0.015, 0.06, 0.01), matrix: M4(0.03, 0.065, 0.075, -0.5, 0, -0.3), color: stripes },
    ]), bm);
    hm.castShadow = true;
    head.add(hm);
    this.eyes = [];
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x3a5a1a, roughness: 0.15, emissive: 0x2a3a10, emissiveIntensity: 0.4 });
    for (const sd of [-1, 1]) {
      const e = new THREE.Group();
      const ball = new THREE.Mesh(sph(0.021, 10, 8), eyeM);
      ball.scale.set(1, 1.1, 0.6);
      e.add(ball);
      const pupil = new THREE.Mesh(sph(0.009, 6, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.scale.set(0.6, 1.6, 0.6);
      pupil.position.z = 0.011;
      e.add(pupil);
      const hi = new THREE.Mesh(sph(0.005, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      hi.position.set(0.006, 0.008, 0.013);
      e.add(hi);
      e.position.set(sd * 0.045, 0.015, 0.093);
      head.add(e);
      this.eyes.push(e);
    }
    // ひげ
    const wh = [];
    for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) wh.push({ geo: new THREE.BoxGeometry(0.09, 0.002, 0.002), matrix: M4(sd * 0.07, -0.02 - k * 0.012, 0.09, 0, 0, sd * (0.08 - k * 0.14)), color: 0xffffff });
    head.add(new THREE.Mesh(mergeParts(wh), new THREE.MeshBasicMaterial({ vertexColors: true })));
    g.add(head);
    // しっぽ（3節）
    const tail = new THREE.Group();
    tail.position.set(0, 0.24, -0.22);
    let parent = tail;
    this.tailSegs = [];
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      const m = new THREE.Mesh(mergeParts([{ geo: cap(0.024 - i * 0.003, 0.1, 6), matrix: M4(0, 0.06, 0), color: i === 2 ? stripes : color }]), bm);
      m.castShadow = true;
      seg.add(m);
      if (i > 0) seg.position.y = 0.12;
      parent.add(seg);
      parent = seg;
      this.tailSegs.push(seg);
    }
    tail.rotation.x = -0.9;
    g.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.06, 0.13], [0.06, 0.13], [-0.06, -0.12], [0.06, -0.12]]) {
      const l = new THREE.Mesh(mergeParts([{ geo: cap(0.026, 0.1, 6), matrix: M4(0, -0.07, 0), color }, { geo: sph(0.03, 6, 4), matrix: M4(0, -0.13, 0.01, 0, 0, 0, 1, 0.6, 1.2), color: belly }]), bm);
      l.position.set(x, 0.15, z);
      l.castShadow = true;
      g.add(l);
      legs.push(l);
    }
    scene.add(g);
    Object.assign(this, { root: g, body, head, tail, legs, pos: g.position });
    this.heading = 0;
    this.t = Math.random() * 5;
    this.state = 'loaf';   // loaf | sit | walk | run
    this.sleep = 1;
    this.target = null;
    this.speed = 0;
    this.lookAt = null;
    g.scale.setScalar(1.1);
  }
  update(dt) {
    this.t += dt;
    const loaf = this.state === 'loaf' ? 1 : 0;
    this.lf = damp(this.lf ?? 1, loaf, 6, dt);
    const moving = this.target && this.state !== 'loaf';
    if (moving) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      const sp = this.state === 'run' ? 3.8 : 1.0;
      if (d > 0.1) {
        this.pos.x += (dx / d) * Math.min(sp, d * 4) * dt;
        this.pos.z += (dz / d) * Math.min(sp, d * 4) * dt;
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 10, dt);
        this.speed = sp;
      } else { this.target = null; this.speed = 0; if (this.onArrive) { const f = this.onArrive; this.onArrive = null; f(); } }
    } else this.speed = 0;
    const ph = this.t * (this.speed > 2 ? 16 : 8);
    const a = this.speed > 0 ? (this.speed > 2 ? 0.9 : 0.5) : 0;
    this.legs[0].rotation.x = Math.sin(ph) * a; this.legs[3].rotation.x = Math.sin(ph) * a;
    this.legs[1].rotation.x = -Math.sin(ph) * a; this.legs[2].rotation.x = -Math.sin(ph) * a;
    for (const l of this.legs) l.scale.y = 1 - this.lf * 0.8;
    this.body.position.y = -this.lf * 0.1;
    this.head.position.y = 0.33 - this.lf * 0.1 + (this.state === 'sit' ? 0.06 : 0);
    this.body.rotation.x = this.state === 'sit' ? -0.35 : 0;
    this.tail.rotation.z = Math.sin(this.t * (this.sleep > 0.5 ? 0.8 : 2.2)) * 0.5;
    this.tailSegs.forEach((sg, i) => { if (i) sg.rotation.x = 0.35 + Math.sin(this.t * 1.6 - i) * 0.25; });
    this.tail.rotation.x = this.speed > 2 ? -1.4 : -0.9 + this.lf * 0.7;
    const closed = this.sleep > 0.5 || (Math.sin(this.t * 1.7) > 0.97);
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
    if (this.lookAt && this.sleep < 0.5) {
      const dx = this.lookAt.x - this.pos.x, dz = this.lookAt.z - this.pos.z;
      this.head.rotation.y = damp(this.head.rotation.y, clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -1, 1), 6, dt);
    } else this.head.rotation.y = damp(this.head.rotation.y, Math.sin(this.t * 0.3) * 0.2, 2, dt);
    this.root.rotation.y = this.heading;
  }
}

// ------------------------------------------------------------
// カラス
// ------------------------------------------------------------
export class Crow {
  constructor(scene) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25, flatShading: true });
    const black = 0x1d1e26, beak = 0x2b2b30;
    const body = new THREE.Mesh(mergeParts([
      { geo: sph(0.14, 10, 8), matrix: M4(0, 0.2, 0, 0, 0, 0, 0.85, 0.85, 1.4), color: black },
      { geo: sph(0.09, 10, 8), matrix: M4(0, 0.32, 0.16), color: black },
      { geo: new THREE.ConeGeometry(0.035, 0.12, 5), matrix: M4(0, 0.31, 0.29, Math.PI / 2), color: beak },
      { geo: new THREE.BoxGeometry(0.12, 0.02, 0.2), matrix: M4(0, 0.2, -0.26, 0.3), color: black },
      { geo: cy(0.012, 0.012, 0.14, 4), matrix: M4(-0.05, 0.07, 0), color: beak },
      { geo: cy(0.012, 0.012, 0.14, 4), matrix: M4(0.05, 0.07, 0), color: beak },
    ]), m);
    body.castShadow = true;
    g.add(body);
    const eye = new THREE.Mesh(sph(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(0.06, 0.34, 0.22);
    g.add(eye);
    const eye2 = eye.clone(); eye2.position.x = -0.06; g.add(eye2);
    this.wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.1, 0.25, 0);
      const wm = new THREE.Mesh(mergeParts([{ geo: new THREE.BoxGeometry(0.34, 0.02, 0.22), matrix: M4(s * 0.17, 0, -0.03), color: black }]), m);
      wm.castShadow = true;
      w.add(wm);
      g.add(w);
      this.wings.push(w);
    }
    scene.add(g);
    this.root = g;
    this.pos = g.position;
    this.heading = 0;
    this.t = 0;
    this.fly = 0;
    this.flight = null;
    g.scale.setScalar(1.25);
  }
  /** 放物線の飛行：from→to を dur 秒で */
  flyTo(to, dur = 1.6, arc = 2, cb) {
    this.flight = { from: this.pos.clone(), to: to.clone(), t: 0, dur, arc, cb };
  }
  update(dt) {
    this.t += dt;
    const f = this.flight;
    if (f) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(f.from, f.to, e);
      this.pos.y += Math.sin(k * Math.PI) * f.arc;
      const dx = f.to.x - f.from.x, dz = f.to.z - f.from.z;
      if (Math.hypot(dx, dz) > 0.1) this.heading = Math.atan2(dx, dz);
      this.fly = 1;
      if (k >= 1) { this.flight = null; if (f.cb) f.cb(); }
    } else this.fly = damp(this.fly, 0, 8, dt);
    const flap = this.fly > 0.2 ? Math.sin(this.t * 22) * 0.9 : 0;
    this.wings[0].rotation.z = -0.1 * (1 - this.fly) + flap * this.fly;
    this.wings[1].rotation.z = 0.1 * (1 - this.fly) - flap * this.fly;
    // ぴょこぴょこ首をかしげる
    this.root.rotation.x = this.fly ? 0 : Math.sin(this.t * 1.3) > 0.8 ? 0.2 : 0;
    this.root.rotation.y = this.heading + (this.fly ? 0 : Math.sin(this.t * 0.7) * 0.6);
  }
}

// ------------------------------------------------------------
// ハトの群れ（インスタンス描画で2命令）
// ------------------------------------------------------------
export class Pigeons {
  constructor(scene, center, count = 22) {
    const bodyGeo = mergeParts([
      { geo: sph(0.1, 8, 6), matrix: M4(0, 0.13, 0, 0, 0, 0, 0.85, 0.8, 1.3), color: 0x9aa0ab },
      { geo: sph(0.062, 8, 6), matrix: M4(0, 0.23, 0.1), color: 0x7a8290 },
      { geo: sph(0.066, 8, 6), matrix: M4(0, 0.18, 0.07), color: 0x6a8a82 },
      { geo: new THREE.ConeGeometry(0.018, 0.05, 4), matrix: M4(0, 0.225, 0.17, Math.PI / 2), color: 0xd9a0a0 },
      { geo: new THREE.BoxGeometry(0.08, 0.015, 0.12), matrix: M4(0, 0.13, -0.16, 0.25), color: 0x5a606b },
      { geo: cy(0.008, 0.008, 0.08, 3), matrix: M4(-0.03, 0.04, 0), color: 0xd97a7a },
      { geo: cy(0.008, 0.008, 0.08, 3), matrix: M4(0.03, 0.04, 0), color: 0xd97a7a },
    ]);
    const wingGeo = mergeParts([{ geo: new THREE.BoxGeometry(0.2, 0.012, 0.13), matrix: M4(0.1, 0, 0), color: 0x8a909b }]);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
    this.body = new THREE.InstancedMesh(bodyGeo, m, count);
    this.wing = new THREE.InstancedMesh(wingGeo, m, count * 2);
    this.body.castShadow = true;
    this.body.frustumCulled = this.wing.frustumCulled = false;
    scene.add(this.body, this.wing);
    this.center = center.clone();
    this.birds = [];
    const r = mulberry32(5);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = r() * 3.2;
      this.birds.push({
        p: new THREE.Vector3(center.x + Math.cos(a) * d, center.y, center.z + Math.sin(a) * d),
        v: new THREE.Vector3(), h: r() * 6.28, st: 'ground', t: r() * 5, peck: 0, air: 0, orbit: r() * 6.28, seed: r(),
        home: new THREE.Vector3(center.x + Math.cos(a) * d, center.y, center.z + Math.sin(a) * d),
      });
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3(1, 1, 1);
    this.scattered = 0;
    this.onScatter = null;
  }
  update(dt, dogPos, dogSpeed) {
    let scared = false;
    for (const b of this.birds) {
      b.t += dt;
      if (b.st === 'ground') {
        const dd = Math.hypot(dogPos.x - b.p.x, dogPos.z - b.p.z);
        if ((dd < 1.4 && dogSpeed > 0.5) || (dd < 3.2 && dogSpeed > 3.2) || dd < 0.7) {
          b.st = 'fly'; b.air = 0; b.v.set((b.p.x - dogPos.x) / (dd + 0.1) * 3, 4 + Math.random() * 2, (b.p.z - dogPos.z) / (dd + 0.1) * 3);
          scared = true;
          continue;
        }
        // 歩いてついばむ
        b.peck = Math.max(0, Math.sin(b.t * 3 + b.seed * 10)) > 0.8 ? 1 : 0;
        if (Math.sin(b.t * 0.7 + b.seed * 20) > 0.6) {
          b.p.x += Math.sin(b.h) * 0.25 * dt; b.p.z += Math.cos(b.h) * 0.25 * dt;
        }
        if (Math.random() < dt * 0.3) b.h += (Math.random() - 0.5) * 2;
        // 群れから離れすぎない
        const hx = b.home.x - b.p.x, hz = b.home.z - b.p.z;
        if (Math.hypot(hx, hz) > 2.5) b.h = Math.atan2(hx, hz);
      } else {
        b.air += dt;
        // 舞い上がって広場の上を旋回し、しばらくして戻る
        b.orbit += dt * 0.9;
        const tx = this.center.x + Math.cos(b.orbit) * 7, tz = this.center.z + Math.sin(b.orbit) * 7, ty = this.center.y + 6 + Math.sin(b.orbit * 2 + b.seed * 9) * 1.5;
        const landing = b.air > 7 + b.seed * 3;
        const gx = landing ? b.home.x : tx, gy = landing ? b.home.y : ty, gz = landing ? b.home.z : tz;
        b.v.x = damp(b.v.x, (gx - b.p.x) * 1.2, 1.5, dt);
        b.v.y = damp(b.v.y, (gy - b.p.y) * 1.2, 1.5, dt);
        b.v.z = damp(b.v.z, (gz - b.p.z) * 1.2, 1.5, dt);
        b.p.addScaledVector(b.v, dt);
        b.h = Math.atan2(b.v.x, b.v.z);
        if (landing && b.p.distanceTo(b.home) < 0.3) { b.st = 'ground'; b.p.copy(b.home); b.v.set(0, 0, 0); }
        if (b.p.y < b.home.y) b.p.y = b.home.y;
      }
    }
    if (scared) {
      audio.play('flap', 1);
      this.scattered++;
      if (this.onScatter) this.onScatter();
    }
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const flying = b.st === 'fly';
      this.e.set(flying ? -0.2 : b.peck * 0.5, b.h, 0);
      this.q.setFromEuler(this.e);
      this.m4.compose(b.p, this.q, this.s);
      this.body.setMatrixAt(i, this.m4);
      const flap = flying ? Math.sin(b.t * 30 + b.seed * 9) * 1.0 : 0;
      for (const side of [0, 1]) {
        const sg = side ? 1 : -1;
        const wm = new THREE.Matrix4().makeRotationZ(sg > 0 ? -0.05 + flap : Math.PI + 0.05 - flap);
        wm.premultiply(new THREE.Matrix4().makeTranslation(sg * 0.07, 0.16, -0.01));
        wm.premultiply(this.m4);
        this.wing.setMatrixAt(i * 2 + side, wm);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.wing.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------
// カモ（池をゆっくり回る）
// ------------------------------------------------------------
export class Ducks {
  constructor(scene, pond) {
    this.pond = pond;
    this.list = [];
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const male = i !== 1;
      const geo = mergeParts([
        { geo: sph(0.17, 8, 6), matrix: M4(0, 0.07, 0, 0, 0, 0, 0.85, 0.6, 1.3), color: male ? 0xd8d2c6 : 0xa07a56 },
        { geo: sph(0.09, 8, 6), matrix: M4(0, 0.22, 0.16), color: male ? 0x2f7a4f : 0x8a6a4a },
        { geo: new THREE.BoxGeometry(0.06, 0.025, 0.1), matrix: M4(0, 0.2, 0.26), color: 0xf2c23a },
        { geo: new THREE.BoxGeometry(0.1, 0.05, 0.12), matrix: M4(0, 0.1, -0.22, 0.4), color: male ? 0x3b3330 : 0x8a6a4a },
      ]);
      const d = new THREE.Mesh(geo, m);
      d.castShadow = true;
      scene.add(d);
      this.list.push({ mesh: d, a: i * 2.1, sp: 0.08 + i * 0.02, r: 0.45 + i * 0.13 });
    }
  }
  update(dt, t) {
    const P = this.pond;
    for (const d of this.list) {
      d.a += d.sp * dt;
      const x = P.x + Math.cos(d.a) * P.rx * d.r, z = P.z + Math.sin(d.a) * P.rz * d.r;
      d.mesh.position.set(x, 0.1 + Math.sin(t * 2 + d.a * 5) * 0.012, z);
      d.mesh.rotation.y = Math.atan2(-Math.sin(d.a) * P.rx, Math.cos(d.a) * P.rz);
    }
  }
}

// ------------------------------------------------------------
// 車（左側通行。信号・前の車・道にいる犬で止まる）
// ------------------------------------------------------------
const CAR_TYPES = [
  { kind: 'kei', len: 3.4, w: 1.5, h: 1.6, body: [0xf2f0ea, 0xf6d35a, 0x9fcfe8, 0xe8a0a0, 0x9fd4b0] },
  { kind: 'sedan', len: 4.4, w: 1.7, h: 1.4, body: [0x3b4a5e, 0xc9ccd0, 0x8a2f35, 0xf2f0ea] },
  { kind: 'taxi', len: 4.4, w: 1.7, h: 1.45, body: [0xf2c23a] },
  { kind: 'bus', len: 10.5, w: 2.4, h: 3.0, body: [0x3f8f6a] },
  { kind: 'van', len: 4.8, w: 1.8, h: 2.0, body: [0xf2f2ee] },
];
const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15 });
const headMat = LIGHTS.make(0xfff2d0, 0.2, 3.2, 0xfffaf0);
const tailMat = LIGHTS.make(0xff3030, 0.35, 2.2, 0xd02020);

function buildCar(type, color) {
  const g = new THREE.Group();
  const L = type.len, W = type.w, H = type.h;
  const glass = 0x2e3a48, tire = 0x1c1c1f;
  const parts = [];
  if (type.kind === 'bus') {
    parts.push({ geo: rb(W, H - 0.35, L, 0.2), matrix: M4(0, 0.35 + (H - 0.35) / 2, 0), color });
    parts.push({ geo: rb(W + 0.02, 0.9, L - 1.4, 0.05), matrix: M4(0, 1.8, -0.2), color: glass });
    parts.push({ geo: rb(W + 0.03, 0.3, L + 0.02, 0.05), matrix: M4(0, 1.05, 0), color: 0xf4efe2 });
    parts.push({ geo: rb(W - 0.3, 1.3, 0.05, 0.03), matrix: M4(0, 1.9, L / 2 + 0.01), color: glass });
  } else {
    const lowH = H * 0.5;
    parts.push({ geo: rb(W, lowH, L, 0.18), matrix: M4(0, 0.3 + lowH / 2, 0), color });
    const cabL = type.kind === 'van' ? L * 0.8 : L * 0.55;
    const cabZ = type.kind === 'van' ? -L * 0.08 : -L * 0.05;
    parts.push({ geo: rb(W - 0.12, H - lowH - 0.25, cabL, 0.16), matrix: M4(0, 0.3 + lowH + (H - lowH - 0.25) / 2 - 0.02, cabZ), color });
    parts.push({ geo: rb(W - 0.08, (H - lowH - 0.25) * 0.72, cabL - 0.3, 0.1), matrix: M4(0, 0.3 + lowH + (H - lowH - 0.25) * 0.45, cabZ), color: glass });
    if (type.kind === 'taxi') parts.push({ geo: rb(0.4, 0.16, 0.18, 0.04), matrix: M4(0, H + 0.1, cabZ), color: 0xf4efe2 });
  }
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    parts.push({ geo: cy(0.33, 0.33, 0.22, 12), matrix: M4(sx * (W / 2 - 0.12), 0.33, sz * (L / 2 - 0.75), 0, 0, Math.PI / 2), color: tire });
  }
  const body = new THREE.Mesh(mergeParts(parts), carMat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const hl = new THREE.Mesh(mergeParts([
    { geo: rb(0.32, 0.14, 0.05, 0.03), matrix: M4(-W / 2 + 0.3, 0.72, L / 2 + 0.01), color: 0xffffff },
    { geo: rb(0.32, 0.14, 0.05, 0.03), matrix: M4(W / 2 - 0.3, 0.72, L / 2 + 0.01), color: 0xffffff },
  ]), headMat);
  g.add(hl);
  const tl = new THREE.Mesh(mergeParts([
    { geo: rb(0.26, 0.14, 0.05, 0.03), matrix: M4(-W / 2 + 0.25, 0.8, -L / 2 - 0.01), color: 0xffffff },
    { geo: rb(0.26, 0.14, 0.05, 0.03), matrix: M4(W / 2 - 0.25, 0.8, -L / 2 - 0.01), color: 0xffffff },
  ]), tailMat);
  g.add(tl);
  return g;
}

export class Traffic {
  constructor(scene, road, signals, pools) {
    this.road = road;         // { northX, southX, stopN, stopS }
    this.signals = signals;
    this.cars = [];
    this.phase = 0;           // 信号サイクル（秒）
    this.cycle = 30;
    const r = mulberry32(12);
    const Z0 = -250, Z1 = 110;
    for (let i = 0; i < 12; i++) {
      const dir = i % 2 === 0 ? -1 : 1;  // -1: 北へ（z が減る）
      const type = CAR_TYPES[i === 3 ? 3 : i === 6 ? 2 : Math.floor(r() * 3) === 0 ? 4 : Math.floor(r() * 2)];
      const color = type.body[Math.floor(r() * type.body.length)];
      const g = buildCar(type, color);
      scene.add(g);
      const z = Z0 + ((i * 53) % (Z1 - Z0));
      this.cars.push({ g, type, dir, z, v: 9, vmax: type.kind === 'bus' ? 8 : 9.5 + r() * 2, honkT: 0, lane: dir < 0 ? road.northX : road.southX });
    }
    this.Z0 = Z0; this.Z1 = Z1;
    this.pedGreen = false;
    this.carState = 'green';
    this.blinkT = 0;
    this.onHonk = null;
  }
  /** 信号の状態：0-14 車青, 14-17 車黄, 17-18 全赤, 18-28 歩行者青（25から点滅）, 28-30 全赤 */
  lights() {
    const p = this.phase % this.cycle;
    const car = p < 14 ? 'green' : p < 17 ? 'yellow' : 'red';
    const ped = p >= 18 && p < 28 ? (p >= 25 ? 'blink' : 'green') : 'red';
    return { car, ped, p };
  }
  update(dt, dog, dogOnRoad) {
    this.phase += dt;
    const L = this.lights();
    this.carState = L.car;
    this.pedGreen = L.ped !== 'red';
    // 信号の灯り
    for (const lamps of this.signals.car) {
      const on = { green: 0, yellow: 1, red: 2 }[L.car];
      lamps.forEach((m, i) => { m.material.emissiveIntensity = i === on ? 3.2 : 0.05; });
    }
    this.blinkT += dt;
    for (const [g, r] of this.signals.ped) {
      const gOn = L.ped === 'green' || (L.ped === 'blink' && Math.sin(this.blinkT * 12) > 0);
      g.material.emissiveIntensity = gOn ? 3 : 0.05;
      r.material.emissiveIntensity = L.ped === 'red' ? 3 : 0.05;
    }
    if (L.ped === 'green' && Math.floor(this.phase * 2.5) !== Math.floor((this.phase - dt) * 2.5)) this.pedBeep = true;
    // 車
    const byLane = { [-1]: [], [1]: [] };
    for (const c of this.cars) byLane[c.dir].push(c);
    for (const dir of [-1, 1]) byLane[dir].sort((a, b) => (a.z - b.z) * -dir);
    for (const c of this.cars) {
      let target = c.vmax;
      const stopZ = c.dir < 0 ? this.road.stopN : this.road.stopS;
      const toStop = (c.z - stopZ) * -c.dir * -1;  // 停止線までの距離（前方が正）
      const ahead = c.dir < 0 ? c.z - stopZ : stopZ - c.z;
      if (L.car !== 'green' && ahead > 0.5 && ahead < 30) {
        if (L.car === 'red' || ahead > 6) target = Math.min(target, Math.max(0, (ahead - 1.5) * 0.9));
      }
      // 前の車
      const list = byLane[c.dir];
      const idx = list.indexOf(c);
      if (idx > 0) {
        const front = list[idx - 1];
        const gap = (front.z - c.z) * c.dir - (front.type.len + c.type.len) / 2;
        if (gap < 18) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.8));
      }
      // 道路の犬
      if (dogOnRoad) {
        const dx = Math.abs(dog.x - c.lane);
        const dz = (dog.z - c.z) * c.dir;
        if (dx < 2.2 && dz > 0 && dz < 16) {
          target = Math.min(target, Math.max(0, (dz - c.type.len / 2 - 1.8) * 1.1));
          if (dz < 11 && c.honkT <= 0) { c.honkT = 3; audio.play('horn'); if (this.onHonk) this.onHonk(c); }
        }
      }
      if (c.honkT > 0) c.honkT -= dt;
      c.v = target < c.v ? damp(c.v, target, 3.5, dt) : damp(c.v, target, 0.9, dt);
      c.z += c.v * c.dir * dt;
      if (c.dir < 0 && c.z < this.Z0) c.z = this.Z1;
      if (c.dir > 0 && c.z > this.Z1) c.z = this.Z0;
      c.g.position.set(c.lane, 0, c.z);
      c.g.rotation.y = c.dir < 0 ? Math.PI : 0;
      void toStop;
    }
  }
}

// ------------------------------------------------------------
// 電車（高架を走る。駅に止まる）
// ------------------------------------------------------------
export class Train {
  constructor(scene, track) {
    this.track = track;
    this.cars = [];
    const n = 4, L = 19;
    const bodyM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 });
    bodyM.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.18;');
    };
    const winM = LIGHTS.make(0xfff0d0, 0.15, 1.5, 0x3a4658);
    this.group = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      const parts = [
        { geo: rb(2.9, 3.0, L - 0.4, 0.3), matrix: M4(0, 1.75, 0), color: 0xeef0ee },
        { geo: rb(2.92, 0.28, L - 0.3, 0.05), matrix: M4(0, 1.05, 0), color: 0xe8743a },
        { geo: rb(2.92, 0.12, L - 0.3, 0.03), matrix: M4(0, 3.0, 0), color: 0x3f8f6a },
        { geo: rb(2.4, 0.3, L - 2, 0.1), matrix: M4(0, 3.3, 0), color: 0xb8bcc2 },
        { geo: new THREE.BoxGeometry(2.4, 0.5, L - 1), matrix: M4(0, 0.25, 0), color: 0x3b3f45 },
      ];
      if (i === 0 || i === n - 1) {
        const s = i === 0 ? 1 : -1;
        parts.push({ geo: rb(2.6, 1.2, 0.1, 0.1), matrix: M4(0, 2.1, s * (L / 2 - 0.18)), color: 0x2a3440 });
      }
      if (i === 0) {
        const hl = new THREE.Mesh(mergeParts([
          { geo: sph(0.14, 10, 8), matrix: M4(-0.9, 1.1, L / 2 - 0.15), color: 0xffffff },
          { geo: sph(0.14, 10, 8), matrix: M4(0.9, 1.1, L / 2 - 0.15), color: 0xffffff },
        ]), headMat);
        car.add(hl);
      }
      const b = new THREE.Mesh(mergeParts(parts), bodyM);
      b.castShadow = true;
      car.add(b);
      const wparts = [];
      for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) {
        wparts.push({ geo: new THREE.BoxGeometry(0.04, 0.9, 1.9), matrix: M4(sx * 1.46, 2.05, -L / 2 + 2 + k * 3), color: 0xffffff });
      }
      const w = new THREE.Mesh(mergeParts(wparts), winM);
      car.add(w);
      car.position.z = -i * L;
      this.group.add(car);
      this.cars.push(car);
    }
    this.len = n * L;
    this.group.position.set(track.x, track.y, 0);
    scene.add(this.group);
    this.z = -600;
    this.dir = 1;
    this.v = 0;
    this.state = 'run';     // run | stop | wait
    this.stopZ = null;
    this.waitT = 0;
    this.onArrive = null;
    this.soundT = 0;
  }
  /** 次の電車を走らせる。stopAt を渡すと駅に止まる */
  depart(dir, stopAt = null) {
    this.dir = dir;
    this.z = dir > 0 ? -560 : 360;
    this.v = 22;
    this.state = 'run';
    this.stopZ = stopAt;
    this.soundT = 0;
  }
  update(dt, listener) {
    if (this.state === 'run') {
      let target = 22;
      if (this.stopZ !== null) {
        const ahead = (this.stopZ - this.headZ()) * this.dir;
        if (ahead < 110) target = Math.max(0, Math.sqrt(Math.max(0, ahead) * 2 * 3.2));
        if (ahead <= 0.3 && this.v < 0.8) { this.state = 'stop'; this.v = 0; this.waitT = 0; if (this.onArrive) this.onArrive(); }
      }
      this.v = target < this.v ? Math.max(target, this.v - 6 * dt) : damp(this.v, target, 0.5, dt);
      this.z += this.v * this.dir * dt;
    } else if (this.state === 'stop') {
      this.waitT += dt;
    }
    this.group.position.z = this.z;
    this.group.rotation.y = this.dir > 0 ? 0 : Math.PI;
    // 近づくとゴトンゴトン
    if (listener && this.state === 'run') {
      const d = Math.abs(this.z - this.dir * this.len / 2 - listener.z) + Math.abs(this.track.x - listener.x) * 0.5;
      this.soundT -= dt;
      if (d < 140 && this.soundT <= 0) { audio.play('train', 1); this.soundT = 9; }
    }
  }
  headZ() { return this.z; }
  get running() { return this.state === 'run' && Math.abs(this.z) < 700; }
}

// ------------------------------------------------------------
// 物（くわえられる）
// ------------------------------------------------------------
export function makeItem(kind) {
  const g = new THREE.Group();
  const m = (c, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...extra });
  if (kind === 'cap') {
    const c = new THREE.Mesh(cy(0.07, 0.07, 0.025, 14), m(0xd9dde2, 0.2, { metalness: 0.9 }));
    const top = new THREE.Mesh(cy(0.055, 0.055, 0.005, 14), m(0xe8604c, 0.3, { metalness: 0.4 }));
    top.position.y = 0.014;
    g.add(c, top);
  } else if (kind === 'ball') {
    const b = new THREE.Mesh(sph(0.11, 14, 10), m(0xe8604c, 0.5));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.015, 6, 20), m(0xffffff, 0.5));
    band.rotation.x = Math.PI / 2;
    g.add(b, band);
  } else if (kind === 'sunflower') {
    const stem = new THREE.Mesh(cy(0.012, 0.012, 0.5, 5), m(0x5f9a55));
    stem.rotation.x = Math.PI / 2;
    stem.position.z = -0.1;
    g.add(stem);
    const petals = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), m(0xf6c83a, 0.7));
    petals.rotation.x = Math.PI / 2;
    petals.position.z = 0.16;
    const c = new THREE.Mesh(cy(0.055, 0.055, 0.03, 10), m(0x6a4330));
    c.rotation.x = Math.PI / 2;
    c.position.z = 0.175;
    g.add(petals, c);
  } else if (kind === 'sakura') {
    const br = new THREE.Mesh(cy(0.012, 0.016, 0.45, 5), m(0x6b4a3e));
    br.rotation.x = Math.PI / 2;
    g.add(br);
    const r = mulberry32(3);
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(puffGeometry(0.05, 0, 0.1, i), m(0xf6c2cf, 0.8, { emissive: 0xf6c2cf, emissiveIntensity: 0.1 }));
      f.position.set((r() - 0.5) * 0.12, (r() - 0.3) * 0.1, -0.15 + r() * 0.35);
      g.add(f);
    }
  } else if (kind === 'stick') {
    const s = new THREE.Mesh(cy(0.018, 0.022, 0.55, 6), m(0x8a6446, 0.9));
    s.rotation.x = Math.PI / 2;
    g.add(s);
  } else if (kind === 'niboshi') {
    const s = new THREE.Mesh(sph(0.05, 8, 6), m(0xb8c2cc, 0.4, { metalness: 0.3 }));
    s.scale.set(0.6, 0.6, 1.8);
    g.add(s);
  } else if (kind === 'bandana') {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 3), m(0xd8362f, 0.8));
    t.rotation.x = Math.PI / 2;
    g.add(t);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** 犬の首まわり・頭にのせる きせかえ */
export function makeWear(kind) {
  const g = new THREE.Group();
  if (kind === 'bandana') {
    const m = new THREE.MeshStandardMaterial({ color: 0xd8362f, roughness: 0.8, flatShading: true });
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 3), m);
    tri.rotation.set(Math.PI * 0.9, 0, 0);
    tri.scale.set(1.4, 1, 0.35);
    tri.position.set(0, -0.08, 0.08);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 16), m);
    band.rotation.x = Math.PI / 2 - 0.3;
    g.add(tri, band);
    // 白い水玉
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(sph(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      d.position.set((i - 2) * 0.05, -0.07 - (i % 2) * 0.04, 0.14);
      g.add(d);
    }
  } else if (kind === 'crown') {
    const cols = [0xf6d35a, 0xf28aa8, 0xffffff, 0xb58ae0, 0xf2735a];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 20), new THREE.MeshStandardMaterial({ color: 0x5f9a55, roughness: 0.8 }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const f = new THREE.Mesh(puffGeometry(0.035, 0, 0.1, i + 1), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.7, emissive: cols[i % cols.length], emissiveIntensity: 0.12 }));
      f.position.set(Math.cos(a) * 0.12, 0.015, Math.sin(a) * 0.12);
      g.add(f);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
