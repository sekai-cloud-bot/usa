import * as THREE from 'three';

// ------------------------------------------------------------
// 見た目の土台：空の光で照らす（IBL）・太陽に向かうと霧が金色に光る・
// 高さから法線マップを作る・葉と毛並みのシェーダー
// ------------------------------------------------------------

/**
 * 組み込みシェーダーの差し替え。マテリアルを作る前に一度だけ呼ぶ。
 * 霧：太陽の方向を見ると、霧が太陽の色に染まって明るくなる（夕方の空気の厚み）
 */
export function patchChunks() {
  const C = THREE.ShaderChunk;
  if (C.__omukae) return;
  C.__omukae = true;
  C.lights_pars_begin += '\n#define HAS_DIR_LIGHT_UNIFORMS\n';
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogCol = fogColor;
  #if defined( HAS_DIR_LIGHT_UNIFORMS ) && NUM_DIR_LIGHTS > 0
  {
    vec3 vdir = normalize( - vViewPosition );
    float sd = max( dot( vdir, directionalLights[ 0 ].direction ), 0.0 );
    vec3 sc = directionalLights[ 0 ].color;
    float sl = max( max( sc.r, sc.g ), max( sc.b, 1e-3 ) );
    float fl = max( max( fogColor.r, fogColor.g ), fogColor.b );
    fogCol = mix( fogColor, sc / sl * fl * 1.25, pow( sd, 4.0 ) * 0.65 );
    fogFactor = min( 1.0, fogFactor * ( 1.0 + pow( sd, 6.0 ) * 0.35 ) );
  }
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif
`;
}

/** 空を小さな立方体に描いて、環境光（映りこみ・まわりこむ光）にする */
export class SkyEnv {
  constructor(renderer, skyMesh) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    const sky = new THREE.Mesh(skyMesh.geometry, skyMesh.material);
    sky.frustumCulled = false;
    this.scene.add(sky);
    // 地面側：町の照り返し（あたたかい灰色）
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x6b5a4c, side: THREE.BackSide, depthWrite: false });
    const g = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8, 0, Math.PI * 2, Math.PI * 0.53, Math.PI * 0.47), this.groundMat);
    g.renderOrder = 1;
    this.scene.add(g);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.1, 1000, this.cubeRT);
    this.out = null;
    this.last = -99;
  }
  /** ground: 地面の照り返しの色 */
  update(scene, hour, ground, force = false) {
    if (!force && Math.abs(hour - this.last) < 0.008) return;
    this.last = hour;
    if (ground) this.groundMat.color.copy(ground);
    this.cubeCam.update(this.renderer, this.scene);
    this.out = this.pmrem.fromCubemap(this.cubeRT.texture, this.out);
    if (scene.environment !== this.out.texture) scene.environment = this.out.texture;
  }
}

// ------------------------------------------------------------
// 高さ → 法線マップ
// ------------------------------------------------------------
/** height: 描画済みの canvas（明るい所が高い）。strength: 凹凸の強さ */
export function normalFromHeight(height, strength = 2, { repeat = [1, 1], aniso = 8 } = {}) {
  const w = height.width, h = height.height;
  const src = height.getContext('2d').getImageData(0, 0, w, h).data;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

// ------------------------------------------------------------
// 葉：風でゆれる＋逆光で透ける
// ------------------------------------------------------------
export const WIND = { time: { value: 0 }, strength: { value: 1 } };

const TRANSLUCENT = /* glsl */`
#include <lights_fragment_end>
#if defined( HAS_DIR_LIGHT_UNIFORMS ) && NUM_DIR_LIGHTS > 0
{
  vec3 Ls = directionalLights[ 0 ].direction;
  float back = pow( saturate( dot( - geometryViewDir, Ls ) ), 2.5 );
  float wrapL = saturate( dot( - normal, Ls ) * 0.6 + 0.4 );
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * back * wrapL * TRANS_K;
  // 上を向いた面は空の色をすこし受ける
  reflectedLight.indirectDiffuse *= 1.0 + saturate( normal.y ) * 0.0;
}
#endif
`;

/**
 * 葉・草・花のマテリアル。sway: 高さあたりのゆれ、trans: 逆光の透け、flat: 面ごとの陰影
 * grass: true なら草の根元を暗く・先を明るく（position.y を 0..gh として）
 */
export function foliageMaterial({ sway = 0.06, trans = 0.45, flat = false, side = THREE.FrontSide, grass = 0, self = 0.05, rough = 0.78, map = null, leafy = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, flatShading: flat, side });
  if (map) { m.map = map; m.alphaTest = 0.5; m.alphaToCoverage = true; }
  m.userData.shared = true;
  m.userData.wind = true;
  m.customProgramCacheKey = () => `fol${sway}|${trans}|${flat}|${grass}|${self}|${map ? 'm' : ''}|${leafy}`;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.time;
    sh.uniforms.uWind = WIND.strength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying float vGH;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          float h = max(0.0, position.y) * ${sway.toFixed(3)};
          float ph = wp.x * 0.37 + wp.z * 0.29;
          float gust = 0.75 + 0.25 * sin(uTime * 0.6 + wp.x * 0.05);
          transformed.x += sin(uTime * 1.7 + ph) * h * uWind * gust;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * h * 0.7 * uWind * gust;
          vGH = ${grass ? `clamp(position.y / ${grass.toFixed(3)}, 0.0, 1.0)` : '1.0'};
          vWP = wp.xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGH;\nvarying vec3 vWP;\n#define TRANS_K ${trans.toFixed(3)}\n${leafy ? NOISE : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${grass ? 'diffuseColor.rgb *= mix(0.45, 1.05, vGH * vGH * (3.0 - 2.0 * vGH)); diffuseColor.rgb += vec3(0.0, 0.025, 0.0) * vGH;' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${leafy ? `{
          // 葉のかたまり：小さな房ごとに明るさがちがい、房のふちは影になる
          vec3 q = vWP * ${(4.2 * leafy).toFixed(2)};
          float n1 = fn3(q);
          float n2 = fn3(q * 2.7 + 5.1);
          float e = 0.25;
          vec3 g = vec3(fn3(q + vec3(e, 0, 0)) - n1, fn3(q + vec3(0, e, 0)) - n1, fn3(q + vec3(0, 0, e)) - n1) / e;
          normal = normalize(normal + (g - dot(g, normal) * normal) * 0.55);
          float leafK = 0.74 + 0.3 * smoothstep(0.2, 0.8, n1) + 0.12 * n2;
          diffuseColor.rgb *= leafK;
          diffuseColor.rgb += vec3(0.02, 0.03, -0.01) * n2;
        }` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${self.toFixed(3)};`)
      .replace('#include <lights_fragment_end>', TRANSLUCENT);
  };
  return m;
}

// ------------------------------------------------------------
// 毛並み：なめらかな陰影＋細かい毛のゆらぎ＋ふちが光る
// ------------------------------------------------------------
const NOISE = /* glsl */`
float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fn3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

/** 毛のマテリアル。rim: ふちの光、fuzz: 毛並みの細かい凹凸、self: 自己発光（白い毛が灰色にならないように） */
export function furMaterial({ rim = 0.55, fuzz = 0.5, self = 0.12, scale = 70, rough = 0.9, flat = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, flatShading: flat });
  m.userData.shared = true;
  m.customProgramCacheKey = () => `fur${rim}|${fuzz}|${self}|${scale}|${flat}`;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFurP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFurP;\n${NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 q = vFurP * ${scale.toFixed(1)};
          float e = 0.35;
          float n0 = fn3(q);
          vec3 g = vec3(fn3(q + vec3(e, 0, 0)) - n0, fn3(q + vec3(0, e, 0)) - n0, fn3(q + vec3(0, 0, e)) - n0) / e;
          normal = normalize(normal + (g - dot(g, normal) * normal) * ${(fuzz * 0.35).toFixed(3)});
          // 毛の房の奥はすこし暗く
          diffuseColor.rgb *= 0.9 + 0.1 * fn3(q * 0.35);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${self.toFixed(3)};`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float fr = pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.6);
          vec3 rimC = vec3(1.0, 0.93, 0.85) * 0.35;
          #if defined( HAS_DIR_LIGHT_UNIFORMS ) && NUM_DIR_LIGHTS > 0
            float back = saturate(dot(-geometryViewDir, directionalLights[0].direction) * 0.5 + 0.5);
            rimC += directionalLights[0].color * back * back * 0.45;
          #endif
          reflectedLight.directDiffuse += diffuseColor.rgb * rimC * fr * ${rim.toFixed(3)};
        }`);
  };
  return m;
}

/**
 * 毛の「殻」：同じ形を法線方向に少しずつふくらませて重ね、毛先だけ残して穴をあける。
 * k: 0..1（外側ほど1）、len: 毛の長さ、density: 毛の細かさ
 */
export const FUR = { shells: 7 };
const shellCache = new Map();
/**
 * masks: [[x, y, z, r], ...]（最大4つ）その近くは毛を生やさない（目・鼻・口）。
 * masks 付きは共有しない
 */
export function furShellMaterial(k, len, { density = 150, masks = null } = {}) {
  const key = k.toFixed(3) + '|' + len.toFixed(3) + '|' + density;
  if (!masks && shellCache.has(key)) return shellCache.get(key);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.userData.shared = true;
  m.userData.shell = true;
  m.alphaToCoverage = true;
  const mk = [];
  for (let i = 0; i < 4; i++) {
    const v = masks && masks[i] ? masks[i] : [0, 0, 0, 0];
    mk.push(new THREE.Vector4(v[0], v[1], v[2], v[3]));
  }
  m.customProgramCacheKey = () => 'furshell' + density + (masks ? 'm' : '');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShell = { value: k };
    sh.uniforms.uFurLen = { value: len };
    sh.uniforms.uMask = { value: mk };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uShell;\nuniform float uFurLen;\nvarying vec3 vFurP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFurP = position;
        transformed += normalize(objectNormal) * uShell * uFurLen;
        transformed.y -= uShell * uShell * uFurLen * 0.4;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uShell;\nuniform vec4 uMask[4];\nvarying vec3 vFurP;\n${NOISE}
        vec3 fh3(vec3 p) { return vec3(fh(p), fh(p + 17.3), fh(p + 41.7)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${masks ? 'for (int i = 0; i < 4; i++) { if (uMask[i].w > 0.0 && distance(vFurP, uMask[i].xyz) < uMask[i].w * (0.6 + 0.4 * uShell)) discard; }' : ''}
          // 毛の1本1本：小さな箱ごとに1本、中心からの距離で丸い断面。外側ほど細く
          vec3 q = vFurP * ${density.toFixed(1)};
          vec3 cell = floor(q);
          vec3 c = fh3(cell) * 0.6 + 0.2;
          float d = length(fract(q) - c);
          float clump = fn3(vFurP * 34.0);
          float rad = (0.62 - uShell * 0.5) * (0.75 + 0.45 * clump);
          float w = fwidth(d) + 0.02;
          diffuseColor.a = 1.0 - smoothstep(rad - w, rad + w, d);
          if (diffuseColor.a < 0.02) discard;
          diffuseColor.rgb *= mix(0.62, 1.08, uShell) * (0.94 + 0.12 * clump);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.08;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float fr = pow(1.0 - saturate(abs(dot(normal, geometryViewDir))), 2.2);
          vec3 rimC = vec3(1.0, 0.93, 0.85) * 0.18;
          #if defined( HAS_DIR_LIGHT_UNIFORMS ) && NUM_DIR_LIGHTS > 0
            float back = saturate(dot(-geometryViewDir, directionalLights[0].direction) * 0.5 + 0.5);
            rimC += directionalLights[0].color * back * back * 0.35;
          #endif
          reflectedLight.directDiffuse += diffuseColor.rgb * rimC * fr * (0.15 + 0.5 * uShell);
        }`);
  };
  if (!masks) shellCache.set(key, m);
  return m;
}
/** mesh に毛の殻を子として足す（同じジオメトリを使い回す） */
export function addFurShells(mesh, len, n = FUR.shells, masks = null) {
  if (n <= 0 || len <= 0.002) return;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const mat = furShellMaterial(k, len, { masks });
    const s = new THREE.Mesh(mesh.geometry, mat);
    s.castShadow = false;
    s.receiveShadow = true;
    s.userData.shell = true;
    s.frustumCulled = mesh.frustumCulled;
    mesh.add(s);
  }
}

/** ふつうのマテリアルに、ふちの光と自己発光を足す（人・動物・車など） */
export function softMaterial({ rim = 0.3, self = 0.08, rough = 0.8, metal = 0, flat = false, vertexColors = true, color = 0xffffff } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors, color, roughness: rough, metalness: metal, flatShading: flat });
  m.userData.shared = true;
  m.customProgramCacheKey = () => `soft${rim}|${self}|${flat}`;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${self.toFixed(3)};`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float fr = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
          vec3 rimC = vec3(1.0, 0.94, 0.86) * 0.3;
          #if defined( HAS_DIR_LIGHT_UNIFORMS ) && NUM_DIR_LIGHTS > 0
            float back = saturate(dot(-geometryViewDir, directionalLights[0].direction) * 0.5 + 0.5);
            rimC += directionalLights[0].color * back * back * 0.4;
          #endif
          reflectedLight.directDiffuse += diffuseColor.rgb * rimC * fr * ${rim.toFixed(3)};
        }`);
  };
  return m;
}
