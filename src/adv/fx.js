import * as THREE from 'three';
import { clamp, damp } from '../util.js';

// 形のアトラス（丸・ハート・星・花びら）
function atlas() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  const cell = (i, draw) => { c.save(); c.translate(i * 64 + 32, 32); draw(); c.restore(); };
  cell(0, () => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-32, -32, 64, 64);
  });
  cell(1, () => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, 20);
    c.bezierCurveTo(-30, -2, -18, -26, 0, -10);
    c.bezierCurveTo(18, -26, 30, -2, 0, 20);
    c.fill();
  });
  cell(2, () => {
    c.fillStyle = '#fff';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 9 : 26, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.fill();
  });
  cell(3, () => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(0, 0, 12, 22, 0.5, 0, Math.PI * 2);
    c.fill();
  });
  const t = new THREE.CanvasTexture(cv);
  return t;
}
const ATLAS = atlas();

const vert = /* glsl */`
attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aShape;
varying vec3 vColor; varying float vAlpha; varying float vShape;
uniform float uScale;
void main() {
  vColor = aColor; vAlpha = aAlpha; vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */`
uniform sampler2D uMap; uniform float uGain;
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main() {
  vec2 uv = vec2((gl_PointCoord.x + vShape) / 4.0, 1.0 - gl_PointCoord.y);
  float a = texture2D(uMap, uv).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}`;

/** まとめて1命令で描く粒（加算ブレンドのきらきら／通常ブレンドの土ぼこり） */
export class PointFX {
  constructor(scene, cap = 400, { additive = true, gain = 1 } = {}) {
    this.cap = cap;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.shape = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: ATLAS }, uScale: { value: 300 }, uGain: { value: gain } },
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.geo = g;
    this.list = [];
  }
  setScale(h) { this.mat.uniforms.uScale.value = h * 0.42; }
  spawn(p) {
    if (this.list.length >= this.cap) this.list.shift();
    const c = new THREE.Color(p.color ?? 0xffffff);
    this.list.push({
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      vx: p.vel ? p.vel.x : 0, vy: p.vel ? p.vel.y : 0, vz: p.vel ? p.vel.z : 0,
      r: c.r, g: c.g, b: c.b, size: p.size ?? 0.2, grow: p.grow ?? 0, life: p.life ?? 1, age: 0,
      gravity: p.gravity ?? 0, drag: p.drag ?? 1, shape: p.shape ?? 0, alpha: p.alpha ?? 1,
    });
  }
  burst(pos, n, f) { for (let i = 0; i < n; i++) this.spawn(f(i, pos)); }
  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vy -= q.gravity * dt;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vz *= k; q.vy *= q.gravity ? 1 : k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const t = q.age / q.life;
      this.pos[n * 3] = q.x; this.pos[n * 3 + 1] = q.y; this.pos[n * 3 + 2] = q.z;
      this.col[n * 3] = q.r; this.col[n * 3 + 1] = q.g; this.col[n * 3 + 2] = q.b;
      this.size[n] = q.size * (1 + q.grow * t);
      this.alpha[n] = q.alpha * clamp(Math.min(t * 8, (1 - t) * 3), 0, 1);
      this.shape[n] = q.shape;
      L[n] = q;
      n++;
    }
    L.length = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']) this.geo.attributes[k].needsUpdate = true;
  }
}

/**
 * 飼い主のにおいの道（くんくん中だけ光る）。
 * path: [[x,z],...]、heightAt(x,z) で地面の高さ
 */
export class ScentTrail {
  constructor(scene, path, heightAt) {
    const pts = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(len / 0.55));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([ax + (bx - ax) * t, az + (bz - az) * t, pts.length]);
      }
    }
    this.pts = pts;
    const cap = pts.length * 2;
    this.fx = new PointFX(scene, cap, { additive: true, gain: 1.35 });
    this.fx.points.renderOrder = 7;
    this.heightAt = heightAt;
    this.t = 0;
    this.k = 0;
  }
  update(dt, amount, dog) {
    this.t += dt;
    this.k = amount;
    const fx = this.fx;
    fx.list.length = 0;
    if (amount < 0.02) { fx.update(0); return; }
    for (const [x, z, i] of this.pts) {
      const d = Math.hypot(x - dog.x, z - dog.z);
      if (d > 34) continue;
      const near = clamp(1 - d / 34, 0, 1);
      const ph = this.t * 1.6 - i * 0.18;
      const y = this.heightAt(x, z) + 0.25 + Math.sin(ph) * 0.12;
      const wob = Math.sin(i * 1.7 + this.t) * 0.18;
      const pulse = 0.55 + 0.45 * Math.sin(ph * 1.3);
      fx.list.push({ x: x + wob, y, z: z + Math.cos(i * 1.3 + this.t) * 0.18, vx: 0, vy: 0, vz: 0, r: 1, g: 0.66, b: 0.28, size: 0.2 * (0.6 + pulse * 0.6), grow: 0, life: 10, age: 5, gravity: 0, drag: 0, shape: 0, alpha: amount * near * (0.35 + pulse * 0.65) });
      if (i % 3 === 0) fx.list.push({ x: x - wob, y: y + 0.3 + Math.sin(ph * 0.7) * 0.2, z, vx: 0, vy: 0, vz: 0, r: 1, g: 0.85, b: 0.55, size: 0.1, grow: 0, life: 10, age: 5, gravity: 0, drag: 0, shape: 2, alpha: amount * near * pulse });
    }
    // 位置だけ更新（寿命は使わない）
    const L = fx.list;
    for (let n = 0; n < L.length; n++) {
      const q = L[n];
      fx.pos[n * 3] = q.x; fx.pos[n * 3 + 1] = q.y; fx.pos[n * 3 + 2] = q.z;
      fx.col[n * 3] = q.r; fx.col[n * 3 + 1] = q.g; fx.col[n * 3 + 2] = q.b;
      fx.size[n] = q.size; fx.alpha[n] = q.alpha; fx.shape[n] = q.shape;
    }
    fx.geo.setDrawRange(0, L.length);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']) fx.geo.attributes[k].needsUpdate = true;
  }
}

// ------------------------------------------------------------
// チュートリアルの目じるし（ピン型のアイコン＋足もとで広がる光の輪）
// ------------------------------------------------------------
function markerTexture(icon) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 168;
  const c = cv.getContext('2d');
  // ピン：金のふち・クリーム色の丸・下向きのとがり
  c.fillStyle = '#f2a445';
  c.beginPath();
  c.moveTo(38, 100); c.lineTo(90, 100); c.lineTo(64, 162); c.closePath();
  c.fill();
  c.beginPath(); c.arc(64, 62, 56, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fffaf2';
  c.beginPath(); c.arc(64, 62, 46, 0, Math.PI * 2); c.fill();
  c.save();
  c.translate(64, 62);
  const ink = '#5a3a28';
  if (icon === 'nose') {
    // 鼻でおす：犬の鼻と、押す向きの矢印
    c.fillStyle = ink;
    c.beginPath(); c.ellipse(-10, 4, 20, 15, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fffaf2';
    c.beginPath(); c.ellipse(-17, 4, 4.5, 3.5, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(-3, 4, 4.5, 3.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8744f';
    c.beginPath(); c.moveTo(14, -8); c.lineTo(32, 4); c.lineTo(14, 16); c.closePath(); c.fill();
    c.fillRect(8, -1, 10, 10);
  } else {
    // ほる：肉球と、かいた土
    c.fillStyle = ink;
    c.beginPath(); c.ellipse(0, 2, 15, 12, 0, 0, Math.PI * 2); c.fill();
    for (const [x, y] of [[-17, -12], [-6, -21], [6, -21], [17, -12]]) { c.beginPath(); c.ellipse(x, y, 5.5, 7, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#9a6a46';
    c.beginPath(); c.ellipse(0, 30, 26, 8, 0, Math.PI, 0); c.fill();
    c.strokeStyle = '#e8744f'; c.lineWidth = 4; c.lineCap = 'round';
    for (const x of [-22, 22]) { c.beginPath(); c.moveTo(x, 12); c.lineTo(x * 1.25, 4); c.stroke(); }
  }
  c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HintMarker {
  /** icon: 'nose' | 'dig'、pos: 印を立てる地面の点 */
  constructor(scene, icon, pos, { ring = 0.5, height = 0.9 } = {}) {
    this.base = pos.clone();
    this.height = height;
    this.mat = new THREE.SpriteMaterial({ map: markerTexture(icon), transparent: true, depthWrite: false, fog: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);     // とがった先が base の上
    this.sprite.renderOrder = 8;
    scene.add(this.sprite);
    const rg = new THREE.RingGeometry(ring * 0.8, ring, 40);
    rg.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.position.set(pos.x, pos.y + 0.02, pos.z);
    this.ring.renderOrder = 3;
    scene.add(this.ring);
    this.t = 0;
    this.k = 0;
    this.on = false;
    this.sprite.visible = this.ring.visible = false;
  }
  show(on) { this.on = on; }
  update(dt, camPos, dogPos) {
    this.t += dt;
    this.k = damp(this.k, this.on ? 1 : 0, this.on ? 3 : 6, dt);
    const vis = this.k > 0.01;
    this.sprite.visible = this.ring.visible = vis;
    if (!vis) return;
    const b = this.base;
    // 遠くからでも見える大きさに。犬がすぐそばに来たら、うすく小さく（ボタンが光るので）
    const s = clamp(camPos.distanceTo(b) * 0.09, 0.5, 1.2);
    const near = dogPos ? clamp((Math.hypot(dogPos.x - b.x, dogPos.z - b.z) - 0.5) / 1.5, 0.3, 1) : 1;
    const bob = Math.sin(this.t * 3.2) * 0.06;
    this.sprite.position.set(b.x, b.y + this.height + bob, b.z);
    this.sprite.scale.set(s * 0.76 * (0.7 + 0.3 * near), s * (0.7 + 0.3 * near), 1);
    this.mat.opacity = this.k * (0.45 + 0.55 * near);
    const p = (this.t * 0.7) % 1;
    this.ring.scale.setScalar(0.6 + p * 0.7);
    this.ringMat.opacity = this.k * (1 - p) * 0.85;
  }
}
