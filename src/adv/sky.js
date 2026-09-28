import * as THREE from 'three';
import { LIGHTS } from './build.js';
import { SkyEnv } from './look.js';
import { clamp, lerp } from '../util.js';

// 時刻ごとの空と光（13時 → 日没 → 夕闇）
const KEYS = [
  { h: 13.0, el: 52, az: 138, sun: '#fff3de', si: 2.9, zen: '#3f86d8', hor: '#cfe4f2', hs: '#e8f1ff', hg: '#bfa07c', hi: 1.15, fog: '#d3e2ea', lamp: 0, cloud: 0.8 },
  { h: 15.0, el: 38, az: 124, sun: '#ffecd0', si: 2.8, zen: '#4a8bd6', hor: '#dbe7ec', hs: '#eef1f6', hg: '#c3a17a', hi: 1.1, fog: '#dde5e5', lamp: 0, cloud: 0.8 },
  { h: 16.5, el: 20, az: 112, sun: '#ffd49a', si: 2.8, zen: '#5a86cc', hor: '#f6d6ae', hs: '#f5ead8', hg: '#c49a70', hi: 1.0, fog: '#eed8bd', lamp: 0.05, cloud: 0.85 },
  { h: 17.25, el: 11, az: 106, sun: '#ffbd7c', si: 2.6, zen: '#5a70b8', hor: '#ffc493', hs: '#f4dcc6', hg: '#bf8d6c', hi: 0.95, fog: '#f2c6a0', lamp: 0.3, cloud: 0.9 },
  { h: 17.75, el: 5, az: 102, sun: '#ff9e60', si: 2.2, zen: '#57609f', hor: '#ffa274', hs: '#eac4b4', hg: '#ab7a64', hi: 0.85, fog: '#e9ac8c', lamp: 0.62, cloud: 0.92 },
  { h: 18.0, el: 2.5, az: 100, sun: '#ff8850', si: 1.7, zen: '#4d5392', hor: '#fb9068', hs: '#d8aeae', hg: '#946a60', hi: 0.78, fog: '#dc9a84', lamp: 0.85, cloud: 0.9 },
  { h: 18.5, el: -2, az: 97, sun: '#ff7650', si: 0.6, zen: '#343a72', hor: '#c47478', hs: '#a08fab', hg: '#6a5460', hi: 0.68, fog: '#8e6c7e', lamp: 1, cloud: 0.7 },
  { h: 19.5, el: -8, az: 94, sun: '#ff6650', si: 0.15, zen: '#1b2150', hor: '#56466e', hs: '#6f7aa8', hg: '#3a384c', hi: 0.55, fog: '#3a3a5a', lamp: 1, cloud: 0.5 },
];

const C = (hex) => new THREE.Color(hex);
const KEYC = KEYS.map((k) => ({ ...k, sun: C(k.sun), zen: C(k.zen), hor: C(k.hor), hs: C(k.hs), hg: C(k.hg), fog: C(k.fog) }));

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // 一番最初に深度を書かずに描くので、z は遠くの平面で切られない位置に
  gl_Position = vec4(p.xy, 0.0, p.w);
}`;
const skyFrag = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor; uniform vec3 uSunDir;
uniform float uTime; uniform float uCloud; uniform float uStars; uniform float uGolden;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hz = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(hz, 0.42));
  float s = max(dot(d, uSunDir), 0.0);
  // 地平線の霞（太陽の側ほど明るい）
  float band = exp(-abs(h) * 10.0);
  col += uSunColor * band * (0.08 + 0.4 * pow(s, 3.0)) * (0.6 + 0.4 * uGolden);
  col = mix(col, uGround, smoothstep(0.0, -0.22, h));
  // 太陽のまわりの光（ミー散乱）
  col += uSunColor * (pow(s, 7.0) * 0.3 + pow(s, 60.0) * 0.7 + pow(s, 2.0) * 0.12 * (1.0 - hz));
  float disc = smoothstep(0.99925, 0.99962, s);
  col += uSunColor * disc * 9.0 * step(-0.03, uSunDir.y);
  if (h > -0.03) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.12);
    vec2 wind = vec2(uTime * 0.004, uTime * 0.0017);
    float n = fbm(uv * 0.5 + wind);
    float n2 = fbm(uv * 1.6 - wind * 1.6 + 3.1);
    float body = n * 0.78 + n2 * 0.32;
    float cum = smoothstep(0.54, 0.82, body);
    float cir = smoothstep(0.55, 0.86, fbm(vec2(uv.x * 0.3, uv.y * 2.2) + wind * 0.6 + 7.0)) * 0.5;
    float fade = smoothstep(0.0, 0.14, hh);
    float cov = clamp(cum + cir * (1.0 - cum), 0.0, 1.0) * fade * uCloud;
    float thick = clamp((body - 0.54) * 3.2, 0.0, 1.0);
    vec3 sunlit = mix(vec3(1.0, 0.97, 0.94), uSunColor * 1.3, 0.3 + 0.45 * uGolden);
    vec3 shade = mix(uZenith, uHorizon, 0.55) * 0.85;
    vec3 cc = mix(sunlit, shade, thick * 0.7);
    // 雲のふちが太陽で光る
    cc += uSunColor * pow(s, 4.0) * (1.0 - thick) * 1.3;
    cc = mix(cc, uHorizon * 1.08, (1.0 - smoothstep(0.0, 0.22, hh)) * 0.5);
    col = mix(col, cc, cov * 0.9);
    // 星（夕闇だけ）
    vec2 sp = floor(d.xz / (hh + 0.3) * 160.0);
    float st = step(0.9975, hash(sp)) * uStars * smoothstep(0.1, 0.5, hh) * (1.0 - cov);
    col += vec3(st) * (1.2 + 0.6 * sin(uTime * 3.0 + hash(sp) * 40.0));
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
      uTime: { value: 0 }, uCloud: { value: 0.8 }, uStars: { value: 0 }, uGolden: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: true }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    this.shadowSize = 26;
    sc.left = -this.shadowSize; sc.right = this.shadowSize; sc.top = this.shadowSize; sc.bottom = -this.shadowSize;
    sc.near = 1; sc.far = 180;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.0);
    scene.add(this.hemi);
    // 夕暮れの町を照らす「街の灯り」（空気の色）
    this.fill = new THREE.DirectionalLight(0xffe6cc, 0.25);
    this.fill.position.set(-30, 40, 40);
    scene.add(this.fill);
    scene.fog = new THREE.Fog(0xd3e2ea, 45, 170);
    this.sunDir = new THREE.Vector3();
    this.k = KEYC[0];
    this.env = new SkyEnv(renderer, sky);
    this.groundBounce = new THREE.Color();
    this.envOn = true;
    this.setHour(13);
  }

  setShadowRange(size) {
    this.shadowSize = size;
    const sc = this.sun.shadow.camera;
    sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
    sc.updateProjectionMatrix();
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
    // 環境光（空の映りこみ）があるので、半球光は控えめに
    this.hemi.intensity = L(a.hi, b.hi) * (this.envOn ? 0.32 : 1);
    this.scene.environmentIntensity = 0.85;
    col(a.fog, b.fog, this.scene.fog.color);
    this.fill.color.copy(this.sun.color).lerp(new THREE.Color(0xffffff), 0.5);
    this.fill.intensity = 0.18 + 0.2 * clamp((h - 17) / 1.5, 0, 1);
    this.lamp = L(a.lamp, b.lamp);
    LIGHTS.set(this.lamp);
    // 夕方ほど空気がかすむ（fogScale は空撮の演出用）
    const g = clamp((h - 15) / 3.5, 0, 1);
    this.scene.fog.near = lerp(60, 34, g) * this.fogScale;
    this.scene.fog.far = lerp(240, 170, g) * this.fogScale;
    this.golden = clamp((h - 15.5) / 2.5, 0, 1);
    U.uGolden.value = this.golden;
    this.dusk = clamp((h - 17.4) / 1.0, 0, 1);
    // 地面からの照り返し：夕日に照らされた町の色
    this.groundBounce.copy(a.hg).lerp(b.hg, t).multiplyScalar(0.55).lerp(this.sun.color, 0.12);
    if (this.envOn) this.env.update(this.scene, h, this.groundBounce);
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
    const dir = this.sunDir.y > 0.06 ? this.sunDir : new THREE.Vector3(this.sunDir.x, 0.06, this.sunDir.z).normalize();
    s.target.position.set(fx, 0, fz);
    s.position.set(fx + dir.x * 90, dir.y * 90, fz + dir.z * 90);
    s.target.updateMatrixWorld();
  }
}
