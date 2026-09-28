import * as THREE from 'three';
import { cyl, windMaterial, WIND, mat } from './build.js';
import { puffGeometry, mergeParts, mulberry32 } from '../util.js';

const leafMat = windMaterial({ sway: 0.018 });
const grassMat = windMaterial({ sway: 0.55, side: THREE.DoubleSide, flatShading: false });
const flowerMat = windMaterial({ sway: 0.5, flatShading: false });

const TREE = {
  keyaki: { trunk: 0x7a5a42, leaf: [0x6ea35a, 0x5e944e, 0x7fb366, 0x88b86a], h: 4.2, r: 2.1 },
  sakura: { trunk: 0x6b4a3e, leaf: [0xf6c2cf, 0xf3b0c2, 0xf9d3dc, 0xeea3b8], h: 3.6, r: 2.3 },
  ginkgo: { trunk: 0x7d6048, leaf: [0xb5cf5a, 0xa3c34e, 0xc8d96a], h: 5.0, r: 1.5 },
  garden: { trunk: 0x7a5a42, leaf: [0x7fb36a, 0x6ea35a, 0x93c276], h: 2.6, r: 1.3 },
  maple: { trunk: 0x6b4a3e, leaf: [0xe8744f, 0xf09a4f, 0xd95f45, 0xf2b35a], h: 3.0, r: 1.6 },
};

/** 木（幹は円柱、葉はもこもこの塊） */
export function tree(g, x, z, kind = 'keyaki', seed = 1, scale = 1) {
  const T = TREE[kind];
  const r = mulberry32(seed);
  const h = T.h * scale * (0.85 + r() * 0.3);
  const t = new THREE.Group();
  cyl(t, 0.1 * scale, 0.18 * scale, h * 0.62, 0, 0, 0, T.trunk, 8);
  // 枝
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    const b = cyl(t, 0.05 * scale, 0.08 * scale, h * 0.35, Math.cos(a) * 0.2, h * 0.45, Math.sin(a) * 0.2, T.trunk, 6);
    b.rotation.z = Math.cos(a) * 0.7;
    b.rotation.x = -Math.sin(a) * 0.7;
  }
  const parts = [];
  const n = kind === 'ginkgo' ? 6 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const rr = T.r * scale * (0.35 + r() * 0.5);
    const y = h * (0.62 + r() * 0.35) + (kind === 'ginkgo' ? i * 0.25 * scale : 0);
    const s = T.r * scale * (0.45 + r() * 0.3) * (kind === 'ginkgo' ? 0.8 : 1);
    parts.push({ geo: puffGeometry(s, 1, 0.18, seed * 10 + i), matrix: new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * rr * (kind === 'ginkgo' ? 0.5 : 1), y, Math.sin(a) * rr * (kind === 'ginkgo' ? 0.5 : 1)), new THREE.Quaternion(), new THREE.Vector3(1, 0.8, 1)), color: T.leaf[Math.floor(r() * T.leaf.length)] });
  }
  parts.push({ geo: puffGeometry(T.r * scale * 0.7, 1, 0.15, seed * 10 + 99), matrix: new THREE.Matrix4().makeTranslation(0, h * 0.95, 0), color: T.leaf[0] });
  const m = new THREE.Mesh(mergeParts(parts), leafMat);
  m.castShadow = true;
  m.receiveShadow = true;
  t.add(m);
  t.position.set(x, 0, z);
  t.rotation.y = r() * Math.PI * 2;
  g.add(t);
  return { group: t, h, trunkR: 0.2 * scale };
}

/** 生け垣（もこもこの箱） */
export function hedge(g, x0, z0, x1, z1, h = 1.0, seed = 3) {
  const r = mulberry32(seed);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / 0.8));
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    parts.push({ geo: puffGeometry(0.62, 1, 0.2, seed * 100 + i), matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, h * 0.55, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.9, 1)), color: [0x5f9a55, 0x6aa65c, 0x578f4c][Math.floor(r() * 3)] });
  }
  const m = new THREE.Mesh(mergeParts(parts), leafMat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

export function bush(g, x, z, s = 1, seed = 5, flowers = false) {
  const r = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    parts.push({ geo: puffGeometry(0.45 * s, 1, 0.2, seed * 7 + i), matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.3 * s, 0.35 * s, Math.sin(a) * 0.3 * s), color: [0x5f9a55, 0x6aa65c, 0x74b064][i % 3] });
  }
  if (flowers) for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2;
    parts.push({ geo: puffGeometry(0.07 * s, 0, 0.1, seed + i), matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.5 * s, 0.55 * s + r() * 0.2, Math.sin(a) * 0.5 * s), color: [0xf28aa8, 0xffffff, 0xf6d35a][i % 3] });
  }
  const m = new THREE.Mesh(mergeParts(parts), leafMat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** 草むら（インスタンス描画）。areas: [[x0,z0,x1,z1], ...], avoid(x,z)=>bool */
export function grassField(g, areas, count, avoid = () => false, seed = 7, colorBias = 0) {
  const r = mulberry32(seed);
  // 3枚の葉を交差させた小さな株
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.PlaneGeometry(0.05, 0.16, 1, 2);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 0.08;
      p.setY(k, y);
      if (y > 0.14) p.setX(k, p.getX(k) * 0.15);
    }
    geo.rotateY((i / 3) * Math.PI);
    const c = new THREE.Color().setHSL(0.26 + colorBias, 0.45, 0.42 + i * 0.03);
    blades.push({ geo, color: c });
  }
  const geo = mergeParts(blades);
  const mesh = new THREE.InstancedMesh(geo, grassMat, count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tint = new THREE.Color();
  let n = 0;
  const totalA = areas.reduce((a, [x0, z0, x1, z1]) => a + Math.abs((x1 - x0) * (z1 - z0)), 0);
  for (const [x0, z0, x1, z1] of areas) {
    const k = Math.round(count * Math.abs((x1 - x0) * (z1 - z0)) / totalA);
    for (let i = 0; i < k && n < count; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (avoid(x, z)) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
      const sc = 0.6 + r() * 0.7;
      s.set(sc * 1.4, sc * (0.7 + r() * 0.6), sc * 1.4);
      pos.set(x, 0, z);
      m4.compose(pos, q, s);
      mesh.setMatrixAt(n, m4);
      tint.setHSL(0.25 + colorBias + r() * 0.05, 0.4 + r() * 0.15, 0.7 + r() * 0.3);
      mesh.setColorAt(n, tint);
      n++;
    }
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  g.add(mesh);
  return mesh;
}

/** 花壇の花（インスタンス） */
export function flowerBed(g, x0, z0, x1, z1, count = 60, seed = 9, palette = [0xf28aa8, 0xf6d35a, 0xffffff, 0xf2735a, 0xb58ae0]) {
  const r = mulberry32(seed);
  const stem = new THREE.CylinderGeometry(0.01, 0.01, 0.28, 3);
  stem.translate(0, 0.14, 0);
  const head = new THREE.IcosahedronGeometry(0.055, 0);
  head.translate(0, 0.3, 0);
  const leaf = new THREE.SphereGeometry(0.05, 4, 3);
  leaf.scale(1, 0.4, 2);
  leaf.translate(0.03, 0.08, 0);
  const geo = mergeParts([{ geo: stem, color: 0x5f9a55 }, { geo: head, color: 0xffffff }, { geo: leaf, color: 0x6aa65c }]);
  // 花びらの色はインスタンスカラーで（茎も少し色づくが遠目には自然）
  const mesh = new THREE.InstancedMesh(geo, flowerMat, count);
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    m4.makeTranslation(x0 + r() * (x1 - x0), 0, z0 + r() * (z1 - z0));
    const s = 0.8 + r() * 0.6;
    m4.scale(new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m4);
    c.setHex(palette[Math.floor(r() * palette.length)]).lerp(new THREE.Color(0xffffff), 0.05);
    mesh.setColorAt(i, c);
  }
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

// ------------------------------------------------------------
// 池の水面（フレネル＋ゆらぐ反射＋太陽のきらめき）
// ------------------------------------------------------------
export function waterMaterial(day) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uSunDir: { value: day.sunDir },
    uSunColor: { value: day.uniforms.uSunColor.value },
    uSky: { value: day.uniforms.uHorizon.value },
    uZenith: { value: day.uniforms.uZenith.value },
    uDeep: { value: new THREE.Color(0x3f7f86) },
  }]);
  u.uSunDir.value = day.sunDir;
  u.uSunColor.value = day.uniforms.uSunColor.value;
  u.uSky.value = day.uniforms.uHorizon.value;
  u.uZenith.value = day.uniforms.uZenith.value;
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    fog: true,
    transparent: true,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uZenith; uniform vec3 uDeep;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        vec3 n = normalize(vec3(
          sin(p.x * 1.9 + t * 1.3) * 0.05 + sin(p.x * 4.1 - p.y * 2.7 + t * 2.1) * 0.03 + sin(p.y * 6.3 + t * 2.9) * 0.015,
          1.0,
          cos(p.y * 2.3 + t * 1.1) * 0.05 + cos(p.x * 3.7 + p.y * 3.1 - t * 1.7) * 0.03));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uSky, uZenith, clamp(r.y * 1.5, 0.0, 1.0));
        vec3 col = mix(uDeep, sky, 0.25 + 0.7 * fres);
        float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 180.0);
        col += uSunColor * spec * 3.0;
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }`,
  });
  m.userData.noBake = true;
  return m;
}

// ------------------------------------------------------------
// 舞い散る桜
// ------------------------------------------------------------
export class Petals {
  constructor(scene, emitters, count = 220) {
    this.emitters = emitters; // [{x, z, r, h}]
    const geo = new THREE.PlaneGeometry(0.06, 0.045);
    const m = new THREE.MeshStandardMaterial({ color: 0xf8c9d4, side: THREE.DoubleSide, roughness: 0.7, emissive: 0xf8c9d4, emissiveIntensity: 0.15 });
    this.mesh = new THREE.InstancedMesh(geo, m, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.p = [];
    const r = mulberry32(77);
    for (let i = 0; i < count; i++) {
      this.p.push({ pos: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(r() * 3, r() * 3, r() * 3), t: r() * 10, life: 0, seed: r() * 100 });
      this.respawn(this.p[i], r(), true);
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.one = new THREE.Vector3(1, 1, 1);
  }
  respawn(p, rv = Math.random(), initial = false) {
    const e = this.emitters[Math.floor(Math.random() * this.emitters.length)];
    const a = Math.random() * Math.PI * 2, d = Math.random() * e.r;
    p.pos.set(e.x + Math.cos(a) * d, initial ? Math.random() * e.h : e.h * (0.6 + Math.random() * 0.4), e.z + Math.sin(a) * d);
    p.life = 0;
    p.ground = 0;
  }
  update(dt, t) {
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (p.pos.y > 0.02) {
        p.pos.x += (Math.sin(t * 0.9 + p.seed) * 0.35 + 0.25) * dt;
        p.pos.z += Math.cos(t * 0.7 + p.seed * 1.3) * 0.25 * dt;
        p.pos.y -= (0.35 + Math.sin(t * 2 + p.seed) * 0.12) * dt;
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      } else {
        p.pos.y = 0.01;
        p.rot.x = -Math.PI / 2;
        p.ground += dt;
        if (p.ground > 6 + (p.seed % 5)) this.respawn(p);
      }
      this.q.setFromEuler(p.rot);
      this.m4.compose(p.pos, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { WIND, mat };
