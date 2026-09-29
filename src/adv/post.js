import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// 夕日の光の筋（明るい空を太陽の方へ放射状にぼかして足す）
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uAspect: { value: 1.7 },
    uThresh: { value: 1.1 },
    uTint: { value: new THREE.Color(1, 0.8, 0.55) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform float uAspect; uniform float uThresh; uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = vUv - uSun;
      float dist = length(delta * vec2(uAspect, 1.0));
      vec2 st = delta / 40.0 * 0.92;
      vec2 uv = vUv;
      float decay = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        uv -= st;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        acc += s * smoothstep(uThresh, uThresh + 0.8, l) * decay;
        decay *= 0.96;
      }
      acc /= 40.0;
      float fall = exp(-dist * 1.8);
      gl_FragColor = vec4(base.rgb + acc * uTint * uStrength * fall, base.a);
    }`,
};

// 模型のような被写界深度（上下がぼける）。uDir で縦横2回かける
const TiltShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uAmount: { value: 0 },
    uFocus: { value: 0.5 },
    uBand: { value: 0.12 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uAmount; uniform float uFocus; uniform float uBand; uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - uFocus);
      float r = smoothstep(uBand, uBand + 0.32, d) * uAmount;
      vec2 px = uDir / uRes * r;
      vec4 sum = vec4(0.0);
      float ws = 0.0;
      for (int i = -6; i <= 6; i++) {
        float w = exp(-float(i * i) / 16.0);
        sum += texture2D(tDiffuse, vUv + px * float(i)) * w;
        ws += w;
      }
      gl_FragColor = sum / ws;
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uWarm: { value: 0 },
    uDusk: { value: 0 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.022 },
    uSniff: { value: 0 },
    uFade: { value: 0 },
    uCA: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uWarm; uniform float uDusk; uniform float uSat; uniform float uContrast; uniform float uVignette; uniform float uGrain; uniform float uSniff; uniform float uFade; uniform float uCA;
    varying vec2 vUv;
    void main() {
      vec2 q = vUv - 0.5;
      // 画面のふちで、ほんの少しだけ色がずれる（レンズ）
      vec2 ca = q * dot(q, q) * 0.012 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // 暗い所は青紫に、明るい所は金色に（夕方ほど強く）
      vec3 shadowTint = mix(vec3(0.97, 0.99, 1.04), vec3(0.93, 0.95, 1.08), uDusk);
      vec3 hiTint = mix(vec3(1.02, 1.0, 0.97), vec3(1.08, 1.0, 0.9), uWarm);
      col *= mix(shadowTint, hiTint, smoothstep(0.08, 0.8, l));
      // においモード：明るく光るもの以外は色を抜いて青く沈める
      float bright = smoothstep(0.72, 0.95, max(col.r, max(col.g, col.b)));
      float sniff = uSniff * (1.0 - bright);
      l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - 0.85 * sniff));
      col = mix(col, col * vec3(0.72, 0.8, 1.0) * 0.85, sniff * 0.75);
      // やわらかいS字のコントラスト
      col = (col - 0.5) * uContrast + 0.5;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.12);
      float v = 1.0 - dot(q * vec2(1.1, 1.0), q * vec2(1.1, 1.0)) * (uVignette + uSniff * 0.8);
      col *= clamp(v, 0.0, 1.0);
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      col = mix(col, vec3(1.0, 0.97, 0.93), uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.level = 2;
    this.enabled = true;
    this.tilt = 0;          // 0..1（演出のときに上げる）
    this.tiltFocus = 0.5;
    this.shafts = 1;
    this.sunDir = null;
    this.noAO = [];         // 環境光の遮蔽の計算に入れない物（空・遠くの山・粒）
    this.build();
  }

  build() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const w = Math.max(1, Math.floor(size.x * pr)), h = Math.max(1, Math.floor(size.y * pr));
    const samples = this.level >= 1 && r.capabilities.isWebGL2 ? 4 : 0;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (this.level >= 2) {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // 空や遠くの山は、遮蔽の計算用の描画では描かない（遠い平面で切れて黒い影になる）。
      // 目じるしのピン（スプライト）や光の柱・丸影など、奥行きを書かない半透明の物も入れない
      // （法線の描画ではスプライトが画面を向かない四角になり、その形の黒い影が出る）
      const orig = this.gtao.render.bind(this.gtao);
      const hidden = [];
      const skip = (o) => {
        if (!o.visible) return;
        const m = o.material;
        if (o.isSprite || (m && !Array.isArray(m) && m.transparent && !m.depthWrite)) { o.visible = false; hidden.push(o); }
      };
      this.gtao.render = (...args) => {
        for (const o of this.noAO) if (o.visible) { o.visible = false; hidden.push(o); }
        this.scene.traverseVisible(skip);
        orig(...args);
        for (const o of hidden) o.visible = true;
        hidden.length = 0;
      };
      this.composer.addPass(this.gtao);
    }
    this.shaft = new ShaderPass(ShaftShader);
    this.shaft.enabled = this.level >= 2;
    this.composer.addPass(this.shaft);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.26, 0.42, 1.8);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(TiltShader);
    this.tiltV = new ShaderPass(TiltShader);
    this.tiltV.uniforms.uDir.value.set(0, 1);
    for (const p of [this.tiltH, this.tiltV]) { p.uniforms.uRes.value.set(w, h); p.enabled = false; this.composer.addPass(p); }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value.set(w, h);
    this.grade.uniforms.uCA.value = this.level >= 1 ? 1 : 0;
    this.composer.addPass(this.grade);
  }

  setLevel(level) {
    if (this.level === level && this.composer) return;
    this.level = level;
    this.enabled = level >= 1;
    this.build();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    for (const p of [this.tiltH, this.tiltV]) p.uniforms.uRes.value.set(w * pr, h * pr);
  }

  /** 太陽の画面上の位置から光の筋の強さを決める */
  updateSun(sunDir, sunColor, golden) {
    if (!this.shaft || this.level < 2) return;
    const cam = this.camera;
    cam.getWorldDirection(_f);
    const facing = _f.dot(sunDir);
    _v.copy(cam.position).addScaledVector(sunDir, 500).project(cam);
    const U = this.shaft.uniforms;
    U.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    U.uAspect.value = cam.aspect;
    const off = Math.max(Math.abs(_v.x), Math.abs(_v.y));
    const k = Math.max(0, Math.min(1, (facing - 0.1) / 0.5)) * Math.max(0, Math.min(1, (1.9 - off) / 0.9));
    U.uStrength.value = k * (0.55 + 0.9 * golden) * this.shafts;
    U.uTint.value.copy(sunColor).lerp(new THREE.Color(1, 1, 1), 0.3);
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const on = this.tilt > 0.01;
    this.tiltH.enabled = this.tiltV.enabled = on;
    if (on) {
      for (const p of [this.tiltH, this.tiltV]) {
        p.uniforms.uAmount.value = this.tilt * 3.2;
        p.uniforms.uFocus.value = this.tiltFocus;
      }
    }
    if (this.shaft) this.shaft.enabled = this.level >= 2 && this.shaft.uniforms.uStrength.value > 0.01;
    this.composer.render(dt);
  }
}
