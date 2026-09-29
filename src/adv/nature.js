import * as THREE from 'three';
import { cyl, windMaterial, WIND, mat } from './build.js';
import { puffGeometry, mergeParts, mulberry32, clamp } from '../util.js';

const leafMat = windMaterial({ sway: 0.018, trans: 0.55, self: 0.04, leafy: 1 });
const hedgeMat = windMaterial({ sway: 0.012, trans: 0.35, self: 0.03, leafy: 1.6 });
const grassMat = windMaterial({ sway: 0.9, side: THREE.DoubleSide, grass: 0.2, trans: 0.12, self: 0.03, rough: 0.9 });
const flowerMat = windMaterial({ sway: 0.5, trans: 0.3 });

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

const TREE = {
  keyaki: { trunk: 0x6f5440, leaf: [0x5f9a4c, 0x528c44, 0x6fa656, 0x7aae5e], h: 4.2, r: 2.1 },
  sakura: { trunk: 0x5e4238, leaf: [0xeaa5b8, 0xf0b6c6, 0xe096ac, 0xf4c2cf], h: 3.6, r: 2.3 },
  ginkgo: { trunk: 0x6f5642, leaf: [0xd9c24a, 0xcdb640, 0xe6cf5c, 0xc4c04a], h: 5.0, r: 1.5 },
  garden: { trunk: 0x6f5440, leaf: [0x6fa85e, 0x5f9a4f, 0x84b86a], h: 2.6, r: 1.3 },
  maple: { trunk: 0x5e4238, leaf: [0xe06a45, 0xea8a45, 0xd2553e, 0xf0a552], h: 3.0, r: 1.6 },
  pine: { trunk: 0x5a4a3e, leaf: [0x3f6e46, 0x4a7a4e, 0x36633f], h: 4.6, r: 1.6 },
  camphor: { trunk: 0x5c4a3a, leaf: [0x4f8a44, 0x5c9a4c, 0x467e3e, 0x69a656], h: 7.5, r: 4.2 },
};

/**
 * 葉のかたまりの陰影を「ひとつの大きな玉」として整える。
 * 法線を樹冠の中心からの向きに寄せ、下と内側を暗く、上を明るく
 */
function shapeCanopy(geo, center, radius, bend = 0.85, ao = 0.45) {
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i).sub(center);
    const d = _p.length();
    _n.fromBufferAttribute(n, i).lerp(_p.normalize(), bend).normalize();
    n.setXYZ(i, _n.x, _n.y, _n.z);
    const up = clamp((p.getY(i) - center.y) / radius * 0.7 + 0.5, 0, 1);
    const out = clamp(d / radius, 0, 1);
    const k = 1 - ao + ao * (0.55 * up + 0.45 * out);
    c.setXYZ(i, c.getX(i) * k * (0.96 + up * 0.12), c.getY(i) * k * (0.97 + up * 0.08), c.getZ(i) * k);
  }
}

/** 木（幹は円柱、葉はもこもこの塊） */
export function tree(g, x, z, kind = 'keyaki', seed = 1, scale = 1) {
  const T = TREE[kind];
  const r = mulberry32(seed);
  const h = T.h * scale * (0.85 + r() * 0.3);
  const t = new THREE.Group();
  const trunkM = mat(T.trunk, { rough: 0.95 });
  cyl(t, 0.1 * scale, 0.19 * scale, h * 0.62, 0, 0, 0, trunkM, 10);
  // 根元のふくらみ
  cyl(t, 0.19 * scale, 0.26 * scale, 0.22 * scale, 0, 0, 0, trunkM, 10);
  // 枝：根元を幹の中に置き、外へ向けて斜めに（葉の塊の中に先が入るように）
  const lean = kind === 'ginkgo' || kind === 'pine' ? 0.35 : 0.7;
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const len = h * 0.38;
    const geo = new THREE.CylinderGeometry(0.035 * scale, 0.07 * scale, len, 6);
    geo.translate(0, len / 2, 0);
    const b = new THREE.Mesh(geo, trunkM);
    b.position.set(0, h * (0.38 + i * 0.06), 0);
    _dir.set(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
    b.quaternion.setFromUnitVectors(_up, _dir);
    b.castShadow = true;
    b.receiveShadow = true;
    t.add(b);
  }
  const parts = [];
  const tall = kind === 'ginkgo' || kind === 'pine';
  const n = tall ? 8 : kind === 'camphor' ? 16 : 11;
  const R = T.r * scale;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const rr = R * (0.35 + r() * 0.5) * (tall ? 0.5 : 1);
    const y = h * (0.62 + r() * 0.32) + (tall ? i * 0.25 * scale : 0);
    const s = R * (0.42 + r() * 0.3) * (tall ? 0.85 : 1);
    const color = T.leaf[Math.floor(r() * T.leaf.length)];
    parts.push({ geo: puffGeometry(s, 2, 0.14, seed * 10 + i), matrix: new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), new THREE.Quaternion(), new THREE.Vector3(1, 0.82, 1)), color });
  }
  // ふちの小さなかたまり（輪郭がこまかくなる）
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = R * (0.8 + r() * 0.25) * (tall ? 0.55 : 1);
    const y = h * (0.66 + r() * 0.3) + (tall ? r() * n * 0.25 * scale : 0);
    parts.push({ geo: puffGeometry(R * (0.2 + r() * 0.12), 1, 0.25, seed * 30 + i), matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * rr, y, Math.sin(a) * rr), color: T.leaf[Math.floor(r() * T.leaf.length)] });
  }
  parts.push({ geo: puffGeometry(R * 0.72, 2, 0.12, seed * 10 + 99), matrix: new THREE.Matrix4().makeTranslation(0, h * 0.95 + (tall ? n * 0.12 * scale : 0), 0), color: T.leaf[0] });
  const geo = mergeParts(parts);
  const cy = h * 0.85 + (tall ? n * 0.12 * scale : 0);
  shapeCanopy(geo, new THREE.Vector3(0, cy, 0), R * (tall ? 1.4 : 1.1));
  const m = new THREE.Mesh(geo, leafMat);
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
  const n = Math.max(2, Math.ceil(len / 0.6));
  const parts = [];
  const cols = [0x5a9150, 0x659d56, 0x528849, 0x6fa35c];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    parts.push({ geo: puffGeometry(0.6, 1, 0.22, seed * 100 + i), matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, h * 0.52, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.92, 1)), color: cols[Math.floor(r() * cols.length)] });
    if (r() < 0.6) parts.push({ geo: puffGeometry(0.28, 1, 0.25, seed * 200 + i), matrix: new THREE.Matrix4().makeTranslation(x + (r() - 0.5) * 0.4, h * 0.95, z + (r() - 0.5) * 0.4), color: cols[3] });
  }
  const geo = mergeParts(parts);
  // 下ほど暗く
  const p = geo.attributes.position, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = 0.6 + 0.4 * clamp(p.getY(i) / (h * 1.1), 0, 1);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  const m = new THREE.Mesh(geo, hedgeMat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

export function bush(g, x, z, s = 1, seed = 5, flowers = false, y = 0) {
  const r = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    parts.push({ geo: puffGeometry(0.42 * s * (0.8 + r() * 0.4), 1, 0.22, seed * 7 + i), matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.32 * s, 0.34 * s + r() * 0.12 * s, Math.sin(a) * 0.32 * s), color: [0x5a9150, 0x659d56, 0x70a860][i % 3] });
  }
  if (flowers) for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2;
    parts.push({ geo: puffGeometry(0.06 * s, 0, 0.1, seed + i), matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.52 * s, 0.5 * s + r() * 0.28 * s, Math.sin(a) * 0.52 * s), color: [0xf28aa8, 0xffffff, 0xf6d35a][i % 3] });
  }
  const geo = mergeParts(parts);
  shapeCanopy(geo, new THREE.Vector3(0, 0.35 * s, 0), 0.7 * s, 0.5, 0.45);
  const m = new THREE.Mesh(geo, leafMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

// ------------------------------------------------------------
// 草むら：細い葉の株をインスタンスで。12m 四方ごとに分けて、遠い所・見えない所は描かない
// ------------------------------------------------------------
export const GRASS = { chunks: [], density: 1 };
let bladeGeo = null;
function grassTuft() {
  if (bladeGeo) return bladeGeo;
  const r = mulberry32(99);
  const pos = [], nor = [], col = [];
  for (let b = 0; b < 6; b++) {
    const a = r() * Math.PI * 2, d = r() * 0.05;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const hgt = 0.1 + r() * 0.1;
    const w = 0.013 + r() * 0.008;
    const lean = (r() - 0.5) * 0.5;
    const rot = r() * Math.PI;
    const cx = Math.cos(rot), sz = Math.sin(rot);
    const pt = (u, v) => {
      // u: -1..1 横、v: 0..1 高さ（先ほど細く・曲がる）
      const ww = w * (1 - v * 0.92) * u;
      const off = lean * v * v * hgt;
      return [bx + ww * cx + off * sz, v * hgt, bz + ww * sz - off * cx];
    };
    const rows = [0, 0.45, 1];
    for (let k = 0; k < rows.length - 1; k++) {
      const a0 = pt(-1, rows[k]), a1 = pt(1, rows[k]), b0 = pt(-1, rows[k + 1]), b1 = pt(1, rows[k + 1]);
      pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
    }
    const g = 0.85 + r() * 0.3;
    for (let i = 0; i < 12; i++) { nor.push(0, 1, 0); col.push(g, g, g); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bladeGeo = geo;
  return geo;
}

/** 草むら（インスタンス描画）。areas: [[x0,z0,x1,z1], ...], avoid(x,z)=>bool, ground(x,z)=>高さ */
export function grassField(g, areas, count, avoid = () => false, seed = 7, colorBias = 0, ground = null) {
  const r = mulberry32(seed);
  const geo = grassTuft();
  const CH = 12;
  const buckets = new Map();
  const totalA = areas.reduce((a, [x0, z0, x1, z1]) => a + Math.abs((x1 - x0) * (z1 - z0)), 0);
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const ax = new THREE.Vector3(0, 1, 0);
  for (const [x0, z0, x1, z1] of areas) {
    const k = Math.round(count * Math.abs((x1 - x0) * (z1 - z0)) / totalA);
    for (let i = 0; i < k; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (avoid(x, z)) continue;
      const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
      if (!buckets.has(key)) buckets.set(key, []);
      q.setFromAxisAngle(ax, r() * Math.PI * 2);
      const sc = 0.8 + r() * 0.45;
      s.set(sc * 1.3, sc * (0.75 + r() * 0.5), sc * 1.3);
      pos.set(x, ground ? ground(x, z) : 0, z);
      const hue = 0.27 + colorBias + r() * 0.05 - (r() < 0.06 ? 0.03 : 0);
      buckets.get(key).push({ m: new THREE.Matrix4().compose(pos.clone(), q.clone(), s.clone()), c: new THREE.Color().setHSL(hue, 0.5 + r() * 0.15, 0.3 + r() * 0.09) });
    }
  }
  const group = new THREE.Group();
  for (const [key, list] of buckets) {
    // 取り出す順をばらばらに（数を減らしても一様に薄くなる）
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const mesh = new THREE.InstancedMesh(geo, grassMat, list.length);
    list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const [cx, cz] = key.split(',').map(Number);
    const center = new THREE.Vector3((cx + 0.5) * CH, 0.2, (cz + 0.5) * CH);
    mesh.geometry = geo;
    mesh.boundingSphere = new THREE.Sphere(center, CH * 0.75);
    mesh.frustumCulled = true;
    // InstancedMesh の視錐台判定は boundingSphere を使う
    mesh.computeBoundingSphere = function () { this.boundingSphere = new THREE.Sphere(center, CH * 0.75); };
    group.add(mesh);
    GRASS.chunks.push({ mesh, center, total: list.length });
  }
  g.add(group);
  return group;
}
/** 近い草だけ描く。density で本数を減らす（画質） */
export function updateGrass(camPos, maxDist = 60) {
  for (const c of GRASS.chunks) {
    const d = Math.hypot(camPos.x - c.center.x, camPos.z - c.center.z);
    const vis = d < maxDist;
    c.mesh.visible = vis;
    if (vis) {
      const fade = clamp(1.25 - d / maxDist, 0.25, 1);
      c.mesh.count = Math.max(1, Math.floor(c.total * GRASS.density * fade));
    }
  }
}

/** 水辺の葦（背の高い草）。ground(x,z) で根元の高さ */
const reedMat = windMaterial({ sway: 0.22, side: THREE.DoubleSide, grass: 1.3, trans: 0.5, self: 0.03, rough: 0.85 });
export function reeds(g, areas, count, ground, seed = 3) {
  const r = mulberry32(seed);
  const pos = [], nor = [], col = [];
  for (let b = 0; b < 7; b++) {
    const a = r() * Math.PI * 2, d = r() * 0.12;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const hgt = 0.8 + r() * 0.6, w = 0.018 + r() * 0.01, lean = (r() - 0.5) * 0.4, rot = r() * Math.PI;
    const cx = Math.cos(rot), sz = Math.sin(rot);
    const pt = (u, v) => { const ww = w * (1 - v * 0.9) * u; const off = lean * v * v * hgt; return [bx + ww * cx + off * sz, v * hgt, bz + ww * sz - off * cx]; };
    const rows = [0, 0.35, 0.7, 1];
    for (let k = 0; k < rows.length - 1; k++) {
      const a0 = pt(-1, rows[k]), a1 = pt(1, rows[k]), b0 = pt(-1, rows[k + 1]), b1 = pt(1, rows[k + 1]);
      pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
      for (let i = 0; i < 6; i++) { nor.push(0, 1, 0); col.push(1, 1, 1); }
    }
    // 穂
    if (b < 3) {
      const tip = pt(0, 1);
      const pg = [tip[0] - 0.02, tip[1] - 0.18, tip[2], tip[0] + 0.02, tip[1] - 0.18, tip[2], tip[0], tip[1] + 0.02, tip[2]];
      pos.push(...pg);
      for (let i = 0; i < 3; i++) { nor.push(0, 1, 0); col.push(1.25, 1.05, 0.8); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.InstancedMesh(geo, reedMat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), ax = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const totalA = areas.reduce((a, [x0, z0, x1, z1]) => a + Math.abs((x1 - x0) * (z1 - z0)), 0);
  let n = 0;
  for (const [x0, z0, x1, z1] of areas) {
    const k = Math.round(count * Math.abs((x1 - x0) * (z1 - z0)) / totalA);
    for (let i = 0; i < k && n < count; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      q.setFromAxisAngle(ax, r() * Math.PI * 2);
      const sc = 0.75 + r() * 0.5;
      s.set(sc, sc * (0.8 + r() * 0.4), sc);
      p.set(x, ground(x, z) - 0.05, z);
      m4.compose(p, q, s);
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, c.setHSL(0.16 + r() * 0.08, 0.35 + r() * 0.15, 0.36 + r() * 0.1));
      n++;
    }
  }
  mesh.count = n;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** 花壇の花（インスタンス） */
export function flowerBed(g, x0, z0, x1, z1, count = 60, seed = 9, palette = [0xf28aa8, 0xf6d35a, 0xffffff, 0xf2735a, 0xb58ae0]) {
  const r = mulberry32(seed);
  const stem = new THREE.CylinderGeometry(0.01, 0.01, 0.28, 3);
  stem.translate(0, 0.14, 0);
  const head = puffGeometry(0.055, 0, 0.1, 3);
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
// 水面（フレネル＋ゆらぐ反射＋太陽のきらめき＋浅い所はすける）
// ------------------------------------------------------------
export function waterMaterial(day, { deep = 0x2f6a72, shallow = 0x6fa89a, flow = 0, scale = 1, ellipse = null } = {}) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uSunDir: { value: day.sunDir },
    uSunColor: { value: day.uniforms.uSunColor.value },
    uSky: { value: day.uniforms.uHorizon.value },
    uZenith: { value: day.uniforms.uZenith.value },
    uDeep: { value: new THREE.Color(deep) },
    uShallow: { value: new THREE.Color(shallow) },
    uFlow: { value: flow },
    uScale: { value: scale },
    uLamp: { value: 0 },
    uEllipse: { value: new THREE.Vector4(0, 0, 0, 0) },
  }]);
  if (ellipse) u.uEllipse.value.set(ellipse.x, ellipse.z, ellipse.rx, ellipse.rz);
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
      varying vec2 vUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vUv = uv;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uZenith;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform float uFlow; uniform float uScale; uniform float uLamp; uniform vec4 uEllipse;
      varying vec3 vWorld;
      varying vec2 vUv;
      // 向きのちがう小さな波を重ねる（同じ模様がならんで石畳のように見えないように）
      vec2 wave(vec2 p, float t) {
        vec2 g = vec2(0.0);
        g += vec2(0.83, 0.55) * cos(dot(p, vec2(0.83, 0.55)) * 1.7 + t * 1.2) * 0.03;
        g += vec2(-0.41, 0.91) * cos(dot(p, vec2(-0.41, 0.91)) * 2.9 + t * 1.9) * 0.026;
        g += vec2(0.97, -0.26) * cos(dot(p, vec2(0.97, -0.26)) * 4.3 + t * 2.4) * 0.02;
        g += vec2(-0.72, -0.69) * cos(dot(p, vec2(-0.72, -0.69)) * 6.1 + t * 3.1) * 0.015;
        g += vec2(0.28, 0.96) * cos(dot(p, vec2(0.28, 0.96)) * 9.7 + t * 3.9) * 0.011;
        g += vec2(0.6, -0.8) * cos(dot(p, vec2(0.6, -0.8)) * 13.3 + t * 4.6) * 0.008;
        g += vec2(-0.95, 0.31) * cos(dot(p, vec2(-0.95, 0.31)) * 19.1 + t * 5.7) * 0.005;
        return g;
      }
      void main() {
        vec2 p = vWorld.xz * uScale;
        p.x -= uTime * uFlow;
        float t = uTime;
        float dist = length(cameraPosition - vWorld);
        // 遠くの波は細かすぎて模様になるので、だんだん静かに
        vec2 g = wave(p, t) * (1.0 / (1.0 + dist * 0.025));
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uSky, uZenith, clamp(r.y * 1.4, 0.0, 1.0)) * 0.9;
        // 太陽の方向の空は明るく（夕焼けが水に映る）
        float sd = max(dot(normalize(vec3(r.x, max(r.y, 0.0), r.z)), normalize(uSunDir)), 0.0);
        sky += uSunColor * (pow(sd, 6.0) * 0.4 + pow(sd, 40.0) * 0.7);
        // 低い角度の映りこみは、向こう岸の草や木（暗い緑）
        vec3 bank = vec3(0.07, 0.1, 0.07) + uSky * 0.1;
        vec3 refl = mix(bank, sky, smoothstep(0.02, 0.24, r.y));
        float edge;
        if (uEllipse.z > 0.0) {
          vec2 e = (vWorld.xz - uEllipse.xy) / uEllipse.zw;
          edge = 1.0 - smoothstep(0.55, 1.0, length(e));
        } else edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(0.0, 0.18, 1.0 - vUv.y);
        vec3 body = mix(uShallow, uDeep, edge) * (0.75 + 0.25 * uSky);
        vec3 col = mix(body, refl, 0.18 + 0.72 * fres);
        // 太陽の光の道（きらきら）
        float sdot = max(dot(r, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sdot, 300.0) * 5.0 + pow(sdot, 30.0) * 0.25);
        float gl = pow(sdot, 14.0) * step(0.975, fract(sin(dot(floor(p * 9.0), vec2(12.9898, 78.233))) * 43758.5453 + t * 0.4));
        col += uSunColor * gl * 1.8;
        col += vec3(1.0, 0.75, 0.45) * uLamp * 0.06 * fres;
        gl_FragColor = vec4(col, mix(0.72, 0.94, edge));
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
    const m = new THREE.MeshStandardMaterial({ color: 0xf8c9d4, side: THREE.DoubleSide, roughness: 0.7, emissive: 0xf8c9d4, emissiveIntensity: 0.18 });
    this.mesh = new THREE.InstancedMesh(geo, m, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.p = [];
    const r = mulberry32(77);
    for (let i = 0; i < count; i++) {
      this.p.push({ pos: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(r() * 3, r() * 3, r() * 3), t: r() * 10, life: 0, seed: r() * 100, vel: new THREE.Vector3() });
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
    p.vel.set(0, 0, 0);
  }
  /** 木をゆらした時：その木から一気に花びらを散らす */
  burst(x, z, h, n = 120, r = 2.6) {
    let k = 0;
    for (const p of this.p) {
      if (k >= n) break;
      if (p.pos.y > 0.4 && Math.random() < 0.6) continue;
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      p.pos.set(x + Math.cos(a) * d, h * (0.55 + Math.random() * 0.45), z + Math.sin(a) * d);
      p.vel.set(Math.cos(a) * (1 + Math.random() * 2), 0.5 + Math.random() * 1.5, Math.sin(a) * (1 + Math.random() * 2));
      p.ground = 0;
      k++;
    }
  }
  update(dt, t) {
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (p.pos.y > 0.02) {
        p.pos.x += ((Math.sin(t * 0.9 + p.seed) * 0.35 + 0.25) + p.vel.x) * dt;
        p.pos.z += (Math.cos(t * 0.7 + p.seed * 1.3) * 0.25 + p.vel.z) * dt;
        p.pos.y -= (0.35 + Math.sin(t * 2 + p.seed) * 0.12 - p.vel.y) * dt;
        p.vel.multiplyScalar(Math.exp(-1.2 * dt));
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
