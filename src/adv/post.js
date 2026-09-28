import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uWarm: { value: 0 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.04 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uSniff: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uWarm; uniform float uSat; uniform float uContrast; uniform float uVignette; uniform float uGrain; uniform float uSniff; uniform float uFade;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // 夕方はあたたかく、影側は少しだけ青く（映画っぽい色分け）
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 warm = mix(vec3(0.97, 0.99, 1.04), vec3(1.07, 1.0, 0.9), smoothstep(0.15, 0.75, l));
      col *= mix(vec3(1.0), warm, 0.35 + 0.65 * uWarm);
      // においモード：明るく光るもの以外は色を抜いて青く沈める
      float bright = smoothstep(0.72, 0.95, max(col.r, max(col.g, col.b)));
      float sniff = uSniff * (1.0 - bright);
      l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - 0.85 * sniff));
      col = mix(col, col * vec3(0.78, 0.84, 1.0) * 0.9, sniff * 0.7);
      col = (col - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q * vec2(1.15, 1.0), q * vec2(1.15, 1.0)) * (uVignette + uSniff * 0.8);
      col *= clamp(v, 0.0, 1.0);
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      col = mix(col, vec3(1.0, 0.97, 0.93), uFade);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.level = 2;
    this.enabled = true;
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
      this.gtao.blendIntensity = 0.75;
      this.gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.62, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value.set(w, h);
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
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }
}
