import * as THREE from 'three';
import { LIGHTS } from './build.js';
import { clamp, lerp } from '../util.js';

// 時刻ごとの空と光（13時 → 日没 → 夕闇）
const KEYS = [
  { h: 13.0, el: 52, az: 138, sun: '#fff3de', si: 2.9, zen: '#3f86d8', hor: '#cfe4f2', hs: '#e8f1ff', hg: '#bfa07c', hi: 1.15, fog: '#d3e2ea', lamp: 0, cloud: 0.8 },
  { h: 15.0, el: 38, az: 124, sun: '#ffecd0', si: 2.8, zen: '#4a8bd6', hor: '#dbe7ec', hs: '#eef1f6', hg: '#c3a17a', hi: 1.1, fog: '#dde5e5', lamp: 0, cloud: 0.8 },
  { h: 16.5, el: 20, az: 112, sun: '#ffd49a', si: 2.7, zen: '#5b82c8', hor: '#f4d5ac', hs: '#f5ead8', hg: '#c49a70', hi: 1.0, fog: '#ecd6bb', lamp: 0.05, cloud: 0.85 },
  { h: 17.5, el: 8, az: 104, sun: '#ffac6c', si: 2.4, zen: '#5b66b0', hor: '#ffb183', hs: '#f3d4c0', hg: '#b88466', hi: 0.9, fog: '#efbd98', lamp: 0.45, cloud: 0.9 },
  { h: 18.0, el: 3, az: 100, sun: '#ff9056', si: 1.7, zen: '#565a9b', hor: '#ff9870', hs: '#e0b8b4', hg: '#9e7162', hi: 0.8, fog: '#e2a087', lamp: 0.85, cloud: 0.9 },
  { h: 18.5, el: -2, az: 97, sun: '#ff7650', si: 0.6, zen: '#393e77', hor: '#cc7a78', hs: '#a894ad', hg: '#6f5660', hi: 0.7, fog: '#94707f', lamp: 1, cloud: 0.7 },
  { h: 19.5, el: -8, az: 94, sun: '#ff6650', si: 0.15, zen: '#1e2350', hor: '#5b4a70', hs: '#6f7aa8', hg: '#3c3a4c', hi: 0.55, fog: '#3d3d5c', lamp: 1, cloud: 0.5 },
];

const C = (hex) => new THREE.Color(hex);
const KEYC = KEYS.map((k) => ({ ...k, sun: C(k.sun), zen: C(k.zen), hor: C(k.hor), hs: C(k.hs), hg: C(k.hg), fog: C(k.fog) }));

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor; uniform vec3 uSunDir;
uniform float uTime; uniform float uCloud; uniform float uStars;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.38));
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.5);
  col += uSunColor * pow(s, 2.0) * 0.18 * (1.0 - clamp(h * 2.5, 0.0, 1.0));
  col += uSunColor * smoothstep(0.99935, 0.99965, s) * 6.0 * step(-0.02, uSunDir.y + 0.02);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.2) * 0.85 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv * 1.2);
    float cl = smoothstep(0.5, 0.78, n) * smoothstep(0.0, 0.22, h) * uCloud;
    vec3 lit = mix(vec3(1.0, 0.98, 0.96), uSunColor * 1.15, 0.35 + 0.45 * pow(s, 2.0));
    vec3 shade = mix(uZenith, uHorizon, 0.5) * 0.9;
    vec3 cc = mix(shade, lit, smoothstep(0.45, 0.95, n + pow(s, 3.0) * 0.3));
    col = mix(col, cc, cl * 0.9);
    // 星（夕闇だけ）
    vec2 sp = floor(d.xz / (h + 0.3) * 160.0);
    float st = step(0.9975, hash(sp)) * uStars * smoothstep(0.1, 0.5, h);
    col += vec3(st) * 1.5;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class DayCycle {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 13;
    this.fogScale = 1;
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 }, uCloud: { value: 0.8 }, uStars: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: true }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    this.shadowSize = 17;
    sc.left = -this.shadowSize; sc.right = this.shadowSize; sc.top = this.shadowSize; sc.bottom = -this.shadowSize;
    sc.near = 1; sc.far = 140;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.0);
    scene.add(this.hemi);
    // 夕暮れの町を照らす「街の灯り」（空気の色）
    this.fill = new THREE.DirectionalLight(0xffe6cc, 0.35);
    this.fill.position.set(-30, 40, 40);
    scene.add(this.fill);
    scene.fog = new THREE.Fog(0xd3e2ea, 45, 170);
    this.sunDir = new THREE.Vector3();
    this.k = KEYC[0];
    this.setHour(13);
  }

  setHour(h) {
    this.hour = h;
    let a = KEYC[0], b = KEYC[KEYC.length - 1];
    for (let i = 0; i < KEYC.length - 1; i++) {
      if (h >= KEYC[i].h && h <= KEYC[i + 1].h) { a = KEYC[i]; b = KEYC[i + 1]; break; }
    }
    if (h < KEYC[0].h) { a = b = KEYC[0]; }
    if (h > KEYC[KEYC.length - 1].h) { a = b = KEYC[KEYC.length - 1]; }
    const t = a === b ? 0 : clamp((h - a.h) / (b.h - a.h), 0, 1);
    const L = (x, y) => lerp(x, y, t);
    const col = (x, y, out) => out.copy(x).lerp(y, t);
    const el = THREE.MathUtils.degToRad(L(a.el, b.el));
    const az = THREE.MathUtils.degToRad(L(a.az, b.az));
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const U = this.uniforms;
    col(a.zen, b.zen, U.uZenith.value);
    col(a.hor, b.hor, U.uHorizon.value);
    col(a.hg, b.hg, U.uGround.value).multiplyScalar(0.8);
    col(a.sun, b.sun, U.uSunColor.value);
    U.uSunDir.value.copy(this.sunDir);
    U.uCloud.value = L(a.cloud, b.cloud);
    U.uStars.value = clamp((h - 18.4) / 0.8, 0, 1);
    col(a.sun, b.sun, this.sun.color);
    // 太陽が沈むと直射は弱く
    this.sun.intensity = L(a.si, b.si) * clamp((this.sunDir.y + 0.05) / 0.12, 0.15, 1);
    col(a.hs, b.hs, this.hemi.color);
    col(a.hg, b.hg, this.hemi.groundColor);
    this.hemi.intensity = L(a.hi, b.hi);
    col(a.fog, b.fog, this.scene.fog.color);
    this.fill.color.copy(this.sun.color).lerp(new THREE.Color(0xffffff), 0.5);
    this.fill.intensity = 0.25 + 0.2 * clamp((h - 17) / 1.5, 0, 1);
    this.lamp = L(a.lamp, b.lamp);
    LIGHTS.set(this.lamp);
    // 夕方ほど空気がかすむ（fogScale は空撮の演出用）
    const g = clamp((h - 15) / 3.5, 0, 1);
    this.scene.fog.near = lerp(55, 32, g) * this.fogScale;
    this.scene.fog.far = lerp(210, 150, g) * this.fogScale;
    this.golden = clamp((h - 15.5) / 2.5, 0, 1);
  }

  /** focus: 影の中心（プレイヤー） */
  update(dt, focus, camPos) {
    this.uniforms.uTime.value += dt;
    this.sky.position.copy(camPos);
    const s = this.sun;
    const size = this.shadowSize;
    // 影の揺らぎを防ぐため、影テクスチャの1ピクセル単位に合わせる
    const texel = (size * 2) / s.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    const dir = this.sunDir.y > 0.05 ? this.sunDir : new THREE.Vector3(this.sunDir.x, 0.05, this.sunDir.z).normalize();
    s.target.position.set(fx, 0, fz);
    s.position.set(fx + dir.x * 70, dir.y * 70, fz + dir.z * 70);
    s.target.updateMatrixWorld();
  }
}
