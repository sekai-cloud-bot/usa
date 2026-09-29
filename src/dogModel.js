import * as THREE from 'three';
import { mergeParts, mat, clamp, lerp, mulberry32 } from './util.js';
import { furMaterial, addFurShells, FUR } from './adv/look.js';

// ------------------------------------------------------------
// うちの子の見た目。犬種ではなく「タイプ（体つき）」を選んで、
// 大きさ・毛の色・もよう・耳・しっぽ・もこもこ を組み合わせる。
// 形はすべて なめらかな楕円体を重ねて作る（おもちのように丸く、やわらかく）
// ------------------------------------------------------------

export const COLORS = [
  { id: 'white', label: 'ホワイト', hex: '#fbf6ef' },
  { id: 'cream', label: 'クリーム', hex: '#f4dfbb' },
  { id: 'apricot', label: 'アプリコット', hex: '#edb27a' },
  { id: 'gold', label: 'ゴールド', hex: '#e0a458' },
  { id: 'red', label: 'レッド', hex: '#dc8442' },
  { id: 'brown', label: 'ブラウン', hex: '#a3653b' },
  { id: 'choco', label: 'チョコ', hex: '#6f4733' },
  { id: 'black', label: 'ブラック', hex: '#3a3230' },
  { id: 'gray', label: 'シルバー', hex: '#bcb7b2' },
];

/**
 * 体つき。
 * r: 胴の太さ、w/h/l: 胴の横・たて・長さの比、leg: 見えている脚の長さ、legR: 脚の太さ、
 * head: 頭の大きさ、hy/hz: 頭の位置（胴の大きさに対する比）、snout: 鼻すじ、cheek: ほっぺ、
 * chest: 胸毛、eye: 目の大きさ、earS: 耳の大きさ、size: 全体の大きさ
 */
export const TYPES = {
  maru: {
    label: 'もふもふまん丸', sub: 'ポメ・ビションみたいな', size: 1.0,
    r: 0.165, w: 1.0, h: 0.98, l: 1.12, leg: 0.06, legR: 0.05, head: 0.158, hy: 0.62, hz: 0.6,
    snout: 0.28, cheek: 1.0, chest: 1.0, eye: 1.12, earS: 0.72,
    def: { color: 'cream', pattern: 'belly', ear: 'pin', tail: 'plume', fluff: 1.0 },
  },
  koro: {
    label: 'ころころ短毛', sub: 'チワワ・子犬みたいな', size: 0.92,
    r: 0.12, w: 0.95, h: 0.92, l: 1.32, leg: 0.1, legR: 0.034, head: 0.15, hy: 0.85, hz: 0.78,
    snout: 0.42, cheek: 0.5, chest: 0.25, eye: 1.28, earS: 1.0,
    def: { color: 'cream', pattern: 'solid', ear: 'big', tail: 'thin', fluff: 0.12 },
  },
  kuru: {
    label: 'くるくる巻き毛', sub: 'トイプードルみたいな', size: 1.0,
    r: 0.125, w: 0.95, h: 0.96, l: 1.42, leg: 0.14, legR: 0.043, head: 0.132, hy: 0.95, hz: 0.8,
    snout: 0.8, cheek: 0.6, chest: 0.5, eye: 1.05, earS: 1.0,
    def: { color: 'apricot', pattern: 'solid', ear: 'fuwa', tail: 'pom', fluff: 0.85 }, curly: true,
  },
  doss: {
    label: 'どっしり胴長', sub: 'ダックス・コーギーみたいな', size: 1.05,
    r: 0.12, w: 1.0, h: 0.95, l: 2.35, leg: 0.06, legR: 0.042, head: 0.126, hy: 0.82, hz: 0.86,
    snout: 1.1, cheek: 0.35, chest: 0.35, eye: 1.0, earS: 1.0,
    def: { color: 'brown', pattern: 'solid', ear: 'long', tail: 'thin', fluff: 0.3 },
  },
  sura: {
    label: 'すらっと中型', sub: '柴・ミックスみたいな', size: 1.25,
    r: 0.135, w: 0.9, h: 0.95, l: 1.85, leg: 0.16, legR: 0.042, head: 0.128, hy: 1.0, hz: 0.82,
    snout: 0.95, cheek: 0.5, chest: 0.4, eye: 0.95, earS: 0.92,
    def: { color: 'red', pattern: 'mask', ear: 'pin', tail: 'curl', fluff: 0.25 },
  },
  bigfuwa: {
    label: 'おおきいふわふわ', sub: 'ゴールデン・サモエドみたいな', size: 1.85,
    r: 0.15, w: 0.95, h: 0.97, l: 1.85, leg: 0.16, legR: 0.05, head: 0.13, hy: 0.95, hz: 0.82,
    snout: 1.0, cheek: 0.6, chest: 0.85, eye: 0.95, earS: 0.95,
    def: { color: 'gold', pattern: 'solid', ear: 'tare', tail: 'plume', fluff: 0.72 },
  },
  bigtsuya: {
    label: 'おおきいつやつや', sub: 'ラブラドールみたいな', size: 1.85,
    r: 0.15, w: 0.93, h: 0.95, l: 1.9, leg: 0.17, legR: 0.052, head: 0.13, hy: 0.95, hz: 0.82,
    snout: 1.05, cheek: 0.45, chest: 0.25, eye: 0.95, earS: 0.95,
    def: { color: 'cream', pattern: 'solid', ear: 'tare', tail: 'thin', fluff: 0.06 },
  },
};

export const SIZES = [
  { id: 's', label: 'ちいさめ', k: 0.85 },
  { id: 'm', label: 'ふつう', k: 1.0 },
  { id: 'l', label: 'おおきめ', k: 1.15 },
];
export const PATTERNS = [
  { id: 'solid', label: 'いちいろ' },
  { id: 'belly', label: 'おなか白' },
  { id: 'mask', label: 'ほっぺ白' },
  { id: 'buchi', label: 'ぶち' },
  { id: 'socks', label: 'くつした' },
];
export const EARS = [
  { id: 'pin', label: 'ピン' },
  { id: 'big', label: 'おおきい' },
  { id: 'tare', label: 'たれ' },
  { id: 'fuwa', label: 'ふわたれ' },
  { id: 'long', label: 'ながたれ' },
];
export const TAILS = [
  { id: 'plume', label: 'ふさふさ' },
  { id: 'curl', label: 'くるりん' },
  { id: 'pom', label: 'ぽんぽん' },
  { id: 'thin', label: 'ほそ' },
];

export function typeParams(type, name, over = {}) {
  const t = TYPES[type] || TYPES.maru;
  return { name: name || 'うさ', type: TYPES[type] ? type : 'maru', size: 'm', ...t.def, ...over };
}

export function defaultDogParams() {
  return typeParams('maru', 'うさ', { color: 'white' });
}

// 前のバージョン（犬種）の保存データを、タイプに読みかえる
const OLD = {
  bichon: ['maru', { color: 'white', pattern: 'solid', ear: 'fuwa', tail: 'pom' }],
  poodle: ['kuru', {}],
  pome: ['maru', {}],
  shiba: ['sura', {}],
  chihuahua: ['koro', {}],
  dachs: ['doss', {}],
};
const OLD_EAR = { fluffy: 'fuwa', pointy: 'pin', big: 'big', long: 'long' };
export function normalizeDogParams(p) {
  if (!p) return defaultDogParams();
  if (p.type && TYPES[p.type]) {
    const t = TYPES[p.type];
    return { ...t.def, size: 'm', ...p };
  }
  const [type, extra] = OLD[p.breed] || ['maru', {}];
  const out = typeParams(type, p.name, extra);
  if (p.color && COLORS.find((c) => c.id === p.color)) out.color = p.color;
  if (typeof p.fluff === 'number') out.fluff = p.fluff;
  if (OLD_EAR[p.ear] && type !== 'maru') out.ear = OLD_EAR[p.ear];
  return out;
}
/** 町の柴犬や像など（前の呼び方のまま使えるように） */
export function breedParams(breed, name) {
  const [type, extra] = OLD[breed] || ['maru', {}];
  return typeParams(type, name, extra);
}

export function colorHex(id) {
  return (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
}

// ------------------------------------------------------------
// 材質
// ------------------------------------------------------------
const M = {};
function mats() {
  if (M.fur) return M;
  // 毛：光がまわりこむ やわらかい陰影、ふちはあたたかく光る、毛並みのゆらぎは控えめ
  M.fur = furMaterial({ rim: 0.62, fuzz: 0.1, self: 0.15, scale: 18, wrap: 0.75, mottle: 0.03, rough: 1 });
  M.fur.envMapIntensity = 0.6;   // 毛は てかてか光らない
  M.eye = new THREE.MeshStandardMaterial({ color: 0x1c110d, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.8 });
  M.iris = new THREE.MeshStandardMaterial({ color: 0x6a3a26, roughness: 0.2, envMapIntensity: 1.2 });
  M.nose = new THREE.MeshStandardMaterial({ color: 0x2e201c, roughness: 0.22, envMapIntensity: 1.3 });
  M.hi = new THREE.MeshBasicMaterial({ color: 0xffffff });
  M.tongue = new THREE.MeshStandardMaterial({ color: 0xf2808f, roughness: 0.45, emissive: 0x6a1a24, emissiveIntensity: 0.18 });
  M.mouth = new THREE.MeshStandardMaterial({ color: 0x8e3440, roughness: 0.7, emissive: 0x3a0a10, emissiveIntensity: 0.3 });
  M.blush = new THREE.MeshBasicMaterial({ color: 0xff9aa6, transparent: true, opacity: 0.32, depthWrite: false });
  M.innerEar = new THREE.MeshStandardMaterial({ color: 0xf3b8ae, roughness: 0.9, emissive: 0x6a2a20, emissiveIntensity: 0.12 });
  M.pad = new THREE.MeshStandardMaterial({ color: 0x5a3a36, roughness: 0.6 });
  for (const k in M) M[k].userData.shared = true;
  return M;
}

// ------------------------------------------------------------
// 形の部品
// ------------------------------------------------------------
const SPH_HI = new THREE.SphereGeometry(1, 36, 26);
const SPH = new THREE.SphereGeometry(1, 26, 18);
const SPH_LO = new THREE.SphereGeometry(1, 16, 12);
const ell = (rx, ry, rz, x = 0, y = 0, z = 0, ax = 0, ay = 0, az = 0, geo = SPH) => ({ geo, matrix: mat(x, y, z, ax, ay, az, rx, ry, rz), color: 0xffffff });

// 3D の値ノイズ（ぶちの形）
function hash(x, y, z, s) {
  let h = (s | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function strSeed(s) { let h = 7; for (const ch of String(s || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/** 頂点ごとに色をぬる。fn(x, y, z) は「白さ」0..1 と「影」を返す */
const _c = new THREE.Color();
function paint(geo, coat, white, fn) {
  const p = geo.attributes.position, col = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const r = fn(p.getX(i), p.getY(i), p.getZ(i));
    _c.copy(coat).lerp(white, clamp(r.w, 0, 1)).multiplyScalar(r.s ?? 1);
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
}

// ------------------------------------------------------------
// 犬を作る。前方は +Z。サイズは root.scale に入る（寸法 dims は1倍のときの値）
// ------------------------------------------------------------
export function buildDog(params0, opts = {}) {
  const params = normalizeDogParams(params0);
  const T = TYPES[params.type];
  const m = mats();
  const F = clamp(params.fluff ?? T.def.fluff, 0, 1);
  let coat = new THREE.Color(colorHex(params.color));
  const white = new THREE.Color('#fcf7f0');
  // 白い子の「ぶち」は、茶色のぶちにする
  if (params.pattern === 'buchi' && coat.getHSL({}, THREE.SRGBColorSpace).l > 0.75) coat = new THREE.Color('#90522e');
  const dark = coat.getHSL({}, THREE.SRGBColorSpace).l < 0.3;
  const pat = params.pattern || 'solid';
  const seed = params.seed ?? strSeed(params.name);
  const rnd = mulberry32(seed || 1);
  const sizeK = (SIZES.find((s) => s.id === params.size) || SIZES[1]).k;
  const scale = T.size * sizeK;

  // もこもこは形にも出る（ふくらむ）
  const puff = 1 + F * 0.1;
  const R = T.r * puff;
  const rx = R * T.w, ry = R * T.h, rz = T.r * T.l * (1 + F * 0.05);
  const legVis = T.leg;
  const bodyY = legVis + ry;
  const headR = T.head * (1 + F * 0.08);
  // 短い毛の子は毛の殻なし（ビロードのように なめらか）
  const furLen = opts.shells === false || F < 0.2 ? 0 : 0.003 + F * 0.02;
  const shellOpts = { soft: true, density: T.curly ? 110 : 170 };
  const shell = (mesh, k = 1, masks = null) => { if (furLen > 0) addFurShells(mesh, furLen * k, FUR.shells, masks, shellOpts); };
  // 毛の色：上は地の色、下にいくほど ほんのり明るく（黒い子は明るくしない）
  const under = dark ? 0.04 : 0.16;

  const root = new THREE.Group();
  root.name = 'dog';
  root.scale.setScalar(scale);
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);

  // ---- 胴 ----
  const tp = [ell(rx, ry, rz, 0, 0, 0, 0, 0, 0, SPH_HI)];
  // 首（頭とつながる）
  tp.push(ell(R * 0.62, R * 0.66, R * 0.62, 0, ry * 0.5, rz * 0.62));
  // 胸毛
  const cr = R * (0.5 + 0.38 * T.chest) * (0.9 + F * 0.2);
  tp.push(ell(cr * 1.02, cr, cr * 0.92, 0, -ry * 0.05, rz * 0.66));
  // おしり
  for (const s of [-1, 1]) tp.push(ell(R * 0.55, R * 0.6, R * 0.58, s * rx * 0.42, -ry * 0.08, -rz * 0.58));
  // たてがみ（ふわふわの子）
  if (F > 0.55) tp.push(ell(R * 0.72, R * 0.62, R * 0.7, 0, ry * 0.62, rz * 0.3));
  // 巻き毛のでこぼこ
  if (T.curly) {
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, b = (rnd() - 0.3) * 1.4;
      const x = Math.cos(b) * Math.cos(a), y = Math.sin(b), z = Math.cos(b) * Math.sin(a);
      tp.push(ell(R * 0.34, R * 0.34, R * 0.34, x * rx * 0.86, y * ry * 0.86, z * rz * 0.86, 0, 0, 0, SPH_LO));
    }
  }
  const torsoGeo = mergeParts(tp);
  const buchi = (x, y, z, f) => sstep(0.56, 0.62, vnoise(x * f + 11.3, y * f + 3.1, z * f + 7.7, seed));
  paint(torsoGeo, coat, white, (x, y, z) => {
    const yn = y / ry, zn = z / rz;
    let w = sstep(0.2, -0.9, yn) * under;
    const bottomShade = 1 - 0.1 * sstep(-0.5, -1.0, yn);
    if (pat === 'belly' || pat === 'mask') {
      // 胸からお腹にかけて白（胸は高いところまで）
      const v = yn - 1.3 * Math.max(0, zn - 0.15);
      w = Math.max(w, pat === 'belly' ? sstep(-0.12, -0.42, v) : sstep(-0.3, -0.58, v));
    } else if (pat === 'buchi') {
      w = 1 - buchi(x, y, z, 2.3 / R) * (1 - sstep(-0.1, -0.7, yn));
    }
    return { w, s: bottomShade };
  });
  const torso = new THREE.Mesh(torsoGeo, m.fur);
  torso.castShadow = true;
  shell(torso);
  body.add(torso);

  // ---- 頭 ----
  const neck = new THREE.Group();
  neck.position.set(0, ry * 0.45, rz * 0.62);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, ry * T.hy * 0.62 + headR * 0.35, rz * (T.hz - 0.62) + headR * 0.28);
  neck.add(head);

  const hr = headR;
  const hp = [ell(hr, hr * 0.94, hr * 0.96, 0, 0, 0, 0, 0, 0, SPH_HI)];
  // ほっぺ（おもちの顔）
  const ck = 0.5 + 0.25 * T.cheek + F * 0.12;
  for (const s of [-1, 1]) hp.push(ell(hr * ck, hr * ck * 0.86, hr * ck * 0.9, s * hr * 0.42, -hr * 0.3, hr * 0.12));
  // マズル
  const sn = T.snout;
  const mrx = hr * (0.32 + 0.06 * T.cheek), mry = hr * (0.24 + 0.04 * sn), mrz = hr * (0.2 + 0.32 * sn);
  const muzzleY = -hr * (0.26 + 0.04 * sn), muzzleZ = hr * (0.66 + 0.2 * sn);
  hp.push(ell(mrx, mry, mrz, 0, muzzleY, muzzleZ, 0.08));
  // 頭のてっぺんの毛
  if (F > 0.5) hp.push(ell(hr * 0.72, hr * 0.55, hr * 0.7, 0, hr * 0.42, -hr * 0.12));
  if (T.curly) {
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, b = 0.2 + rnd() * 1.1;
      const x = Math.cos(b) * Math.cos(a), y = Math.sin(b), z = Math.cos(b) * Math.sin(a) * 0.8 - 0.25;
      hp.push(ell(hr * 0.3, hr * 0.3, hr * 0.3, x * hr * 0.85, y * hr * 0.85, z * hr * 0.85, 0, 0, 0, SPH_LO));
    }
  }
  const headGeo = mergeParts(hp);
  // 目の位置（頭の表面）
  const eyeDir = (s) => new THREE.Vector3(s * 0.46, 0.0, 0.89).normalize();
  const onHead = (d) => {
    const t = 1 / Math.sqrt((d.x / hr) ** 2 + (d.y / (hr * 0.94)) ** 2 + (d.z / (hr * 0.96)) ** 2);
    return d.clone().multiplyScalar(t);
  };
  const eyeC = [-1, 1].map((s) => onHead(eyeDir(s)));
  paint(headGeo, coat, white, (x, y, z) => {
    const yn = y / hr, zn = z / hr;
    let w = sstep(0.0, -0.9, yn) * under;
    // マズルはいつも少し明るく
    const mz = Math.hypot(x / (mrx * 1.1), (y - muzzleY) / (mry * 1.2), (z - muzzleZ) / (mrz * 1.1));
    w = Math.max(w, (1 - sstep(0.7, 1.05, mz)) * (dark ? 0.12 : 0.3));
    if (pat === 'belly' || pat === 'mask') {
      // マズル・あご・ほっぺの下が白
      const face = Math.max(1 - sstep(0.75, 1.1, mz), sstep(-0.15, -0.5, yn) * sstep(-0.1, 0.35, zn));
      w = Math.max(w, face);
      if (pat === 'mask') {
        // まろまゆ
        for (const s of [-1, 1]) {
          const d = Math.hypot(x - s * hr * 0.3, y - hr * 0.42, z - hr * 0.78);
          w = Math.max(w, 1 - sstep(hr * 0.07, hr * 0.12, d));
        }
      }
    } else if (pat === 'buchi') {
      // 白い顔に、片目のまわりだけ ぶち
      const d = Math.hypot(x - hr * 0.45, y - hr * 0.22, z - hr * 0.55);
      w = sstep(hr * 0.42, hr * 0.5, d);
      if (z < -hr * 0.2 && y > hr * 0.3) w = Math.min(w, 0.2);
    }
    return { w, s: 1 };
  });
  const headMesh = new THREE.Mesh(headGeo, m.fur);
  headMesh.castShadow = true;
  head.add(headMesh);

  // 目：大きくて つやつや。下半分は茶色がかる
  const eyeR = hr * 0.16 * T.eye;
  const eyes = [];
  const eyeGeo = new THREE.SphereGeometry(eyeR, 20, 16);
  const irisGeo = new THREE.SphereGeometry(eyeR * 0.72, 16, 12);
  const hiGeo = new THREE.SphereGeometry(eyeR * 0.3, 10, 8);
  const hi2Geo = new THREE.SphereGeometry(eyeR * 0.14, 8, 6);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const g = new THREE.Group();
    g.position.copy(eyeC[i]).multiplyScalar(0.985);
    g.lookAt(g.position.clone().multiplyScalar(3).add(new THREE.Vector3(0, 0, hr)));
    const e = new THREE.Mesh(eyeGeo, m.eye);
    e.scale.set(1, 1.06, 0.5);
    g.add(e);
    const iris = new THREE.Mesh(irisGeo, m.iris);
    iris.scale.set(1, 0.7, 0.4);
    iris.position.set(0, -eyeR * 0.3, eyeR * 0.14);
    e.add(iris);
    const h1 = new THREE.Mesh(hiGeo, m.hi);
    h1.position.set(-s * eyeR * 0.28, eyeR * 0.38, eyeR * 0.42);
    g.add(h1);
    const h2 = new THREE.Mesh(hi2Geo, m.hi);
    h2.position.set(s * eyeR * 0.32, -eyeR * 0.3, eyeR * 0.45);
    g.add(h2);
    head.add(g);
    eyes.push(g);
  }

  // 鼻：小さくて まるい
  const noseZ = muzzleZ + mrz * 0.94;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.085 * (0.85 + 0.3 * sn), 14, 10), m.nose);
  nose.scale.set(1.35, 0.95, 0.9);
  nose.position.set(0, muzzleY + mry * 0.55, noseZ - hr * 0.02);
  head.add(nose);
  const noseHi = new THREE.Mesh(hi2Geo, m.hi);
  noseHi.scale.setScalar(0.8);
  noseHi.position.set(-hr * 0.025, nose.position.y + hr * 0.035, nose.position.z + hr * 0.06);
  head.add(noseHi);

  // 口：あけると赤い口の中と舌が見える（にこっ）
  const mouthOpen = new THREE.Group();
  mouthOpen.position.set(0, muzzleY - mry * 0.5, muzzleZ + mrz * 0.66);
  const inner = new THREE.Mesh(SPH, m.mouth);
  inner.scale.set(mrx * 0.62, mry * 0.62, mrz * 0.42);
  mouthOpen.add(inner);
  head.add(mouthOpen);
  const tongue = new THREE.Mesh(SPH, m.tongue);
  tongue.scale.set(mrx * 0.42, mry * 0.22, mrz * 0.46);
  tongue.position.set(0, muzzleY - mry * 0.78, muzzleZ + mrz * 0.62);
  head.add(tongue);

  const blushGeo = new THREE.CircleGeometry(hr * 0.15, 16);
  const blush = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(blushGeo, m.blush);
    const d = onHead(new THREE.Vector3(s * 0.66, -0.22, 0.72).normalize());
    // ほっぺがふくらんでいるので、少し外へ
    b.position.copy(d).multiplyScalar(1.0 + 0.1 * T.cheek);
    b.lookAt(b.position.clone().multiplyScalar(3));
    b.renderOrder = 2;
    head.add(b);
    blush.push(b);
  }

  // 頭の毛（目・鼻・口のまわりはあけておく）
  if (furLen > 0) {
    const masks = eyes.map((e) => [e.position.x, e.position.y, e.position.z, eyeR * 2.0]);
    masks.push([0, nose.position.y, nose.position.z, hr * 0.2]);
    masks.push([0, mouthOpen.position.y, mouthOpen.position.z, mrx * 0.9]);
    addFurShells(headMesh, furLen * 0.75, FUR.shells, masks, shellOpts);
  }

  // くわえ位置
  const mouth = new THREE.Object3D();
  mouth.position.set(0, muzzleY - mry * 0.6, muzzleZ + mrz * 0.5);
  head.add(mouth);

  // ---- 耳 ----
  const ears = [];
  const earType = params.ear || 'pin';
  const eS = T.earS;
  const earTint = (geo, w0 = 0) => paint(geo, coat, white, () => ({ w: pat === 'buchi' ? 0 : w0, s: 0.96 }));
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    let mesh;
    if (earType === 'pin' || earType === 'big') {
      const big = earType === 'big';
      const eh = hr * (big ? 0.92 : 0.6) * eS, er = hr * (big ? 0.42 : 0.3) * eS;
      ear.position.set(s * hr * (big ? 0.56 : 0.5), hr * (big ? 0.6 : 0.68), -hr * 0.06);
      ear.rotation.z = -s * (big ? 0.62 : 0.32);
      ear.rotation.x = -0.12;
      // 丸みのある三角：球をしずく形にのばす
      const g = new THREE.SphereGeometry(1, 16, 12);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = (y + 1) / 2;
        const taper = 1 - 0.82 * Math.pow(t, 1.3);
        p.setXYZ(i, x * er * taper, t * eh, z * er * 0.42 * taper);
      }
      g.computeVertexNormals();
      const eg = mergeParts([{ geo: g, color: 0xffffff }]);
      earTint(eg);
      mesh = new THREE.Mesh(eg, m.fur);
      const innerE = new THREE.Mesh(g, m.innerEar);
      innerE.scale.set(0.62, 0.8, 0.5);
      innerE.position.set(0, eh * 0.06, er * 0.14);
      ear.add(innerE);
    } else if (earType === 'fuwa') {
      ear.position.set(s * hr * 0.8, hr * 0.28, -hr * 0.04);
      const parts = [];
      for (let i = 0; i < 3; i++) parts.push(ell(hr * (0.34 - i * 0.02), hr * 0.3, hr * 0.3, s * hr * 0.06, -hr * (0.1 + i * 0.25), 0, 0, 0, 0, SPH_LO));
      const g = mergeParts(parts);
      earTint(g);
      mesh = new THREE.Mesh(g, m.fur);
    } else {
      // たれ耳（long は長く）
      const long = earType === 'long';
      ear.position.set(s * hr * 0.82, hr * 0.32, -hr * 0.04);
      ear.rotation.z = s * 0.18;
      const g = mergeParts([ell(hr * 0.13, hr * (long ? 0.62 : 0.42), hr * (long ? 0.36 : 0.34), s * hr * 0.05, -hr * (long ? 0.46 : 0.3), 0, 0, 0, s * 0.1)]);
      earTint(g);
      paint(g, coat, white, () => ({ w: 0, s: dark ? 0.9 : 0.93 }));
      mesh = new THREE.Mesh(g, m.fur);
    }
    mesh.castShadow = true;
    shell(mesh, earType === 'fuwa' ? 1 : 0.55);
    ear.add(mesh);
    ear.userData.baseZ = ear.rotation.z;
    head.add(ear);
    ears.push(ear);
  }

  // ---- しっぽ ----
  const tail = new THREE.Group();
  tail.position.set(0, ry * 0.5, -rz * 0.9);
  body.add(tail);
  const tailType = params.tail || 'plume';
  const tparts = [];
  const tR = (0.05 + F * 0.03) * (T.r / 0.14);
  const chain = (pts, r0) => {
    // 点を つないで なめらかに（あいだにも玉を置く）
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        const r = lerp(a[3], b[3], t) * r0;
        tparts.push(ell(r, r, r, lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 0, 0, 0, SPH_LO));
      }
    }
    const e = pts[pts.length - 1];
    tparts.push(ell(e[3] * r0, e[3] * r0, e[3] * r0, e[0], e[1], e[2], 0, 0, 0, SPH_LO));
  };
  const L = T.r * 1.3;
  if (tailType === 'plume') {
    // 背中の上に くるんと のる、大きな ふさふさ
    chain([[0, 0, 0, 0.7], [0, L * 0.45, -L * 0.18, 1.0], [0, L * 0.9, -L * 0.1, 1.12], [0, L * 1.12, L * 0.2, 1.05], [0, L * 1.08, L * 0.55, 0.85], [0, L * 0.9, L * 0.78, 0.55]], tR * 0.85);
  } else if (tailType === 'curl') {
    const tor = new THREE.TorusGeometry(L * 0.42, tR * 0.62, 10, 20, Math.PI * 1.6);
    tparts.push({ geo: tor, matrix: mat(0, L * 0.45, -L * 0.05, 0, Math.PI / 2, -0.5), color: 0xffffff });
    tparts.push(ell(tR * 0.5, tR * 0.5, tR * 0.5, 0, L * 0.3, L * 0.3, 0, 0, 0, SPH_LO));
  } else if (tailType === 'pom') {
    chain([[0, 0, 0, 0.35], [0, L * 0.35, -L * 0.08, 0.3]], tR);
    tparts.push(ell(tR * 1.25, tR * 1.25, tR * 1.25, 0, L * 0.6, -L * 0.1, 0, 0, 0, SPH));
  } else {
    chain([[0, 0, 0, 0.62], [0, L * 0.3, -L * 0.42, 0.48], [0, L * 0.62, -L * 0.72, 0.36], [0, L * 0.95, -L * 0.86, 0.24]], tR);
  }
  const tailGeo = mergeParts(tparts);
  paint(tailGeo, coat, white, (x, y, z) => {
    let w = 0;
    if (pat === 'buchi') w = 1 - buchi(x + 3, y, z, 2.3 / R) * 0.9;
    // ふさふさの内がわは明るく
    if (tailType === 'plume' && !dark) w = Math.max(w, sstep(L * 0.3, L * 1.1, y) * 0.35);
    return { w, s: 1 };
  });
  const tailMesh = new THREE.Mesh(tailGeo, m.fur);
  tailMesh.castShadow = true;
  shell(tailMesh, 1.2);
  tail.add(tailMesh);

  // ---- 脚：つけ根は胴の中にうめておく（動かしても すき間が出ない） ----
  const legs = [];
  const legR = T.legR * (1 + F * 0.3);
  const hipY = -ry * 0.42;
  const legModel = bodyY + hipY;          // つけ根から地面まで
  const legX = rx * 0.5;
  const pawR = legR * 1.22;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Group();
    const front = sz > 0;
    leg.position.set(sx * legX, hipY, sz * rz * (front ? 0.58 : 0.56));
    const len = legModel - pawR * 0.55;
    const parts = [
      // つけ根の もも（胴にうまる）
      ell(legR * (front ? 1.35 : 1.7), legR * (front ? 1.6 : 1.9), legR * (front ? 1.35 : 1.7), 0, legR * 0.4, front ? 0 : -legR * 0.2, 0, 0, 0, SPH_LO),
      { geo: new THREE.CapsuleGeometry(legR, Math.max(0.001, len - legR), 6, 12), matrix: mat(0, -len / 2 + legR * 0.2, 0), color: 0xffffff },
      // 足先：まるくて少し平たい
      ell(pawR, pawR * 0.72, pawR * 1.2, 0, -legModel + pawR * 0.66, pawR * 0.28, 0, 0, 0, SPH_LO),
    ];
    const g = mergeParts(parts);
    paint(g, coat, white, (x, y, z) => {
      const t = clamp(-y / legModel, 0, 1);  // 0: つけ根 → 1: 足先
      let w = under * t * 0.6;
      if (pat === 'socks' || pat === 'mask') w = Math.max(w, sstep(0.55, 0.72, t));
      if (pat === 'belly' && front) w = Math.max(w, sstep(0.3, 0.6, t) * 0.8);
      if (pat === 'buchi') w = 1 - buchi(x + sx * 0.3, y + 2, z + sz * 0.5, 2.3 / R) * (1 - t);
      return { w, s: 1 - 0.06 * t };
    });
    const lm = new THREE.Mesh(g, m.fur);
    lm.castShadow = true;
    shell(lm, 0.6);
    leg.add(lm);
    body.add(leg);
    legs.push(leg);
  }

  // 接地影（安価な丸影）
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x6b4526, transparent: true, opacity: 0.24, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.006;
  blob.scale.set(rx * 1.25, rz * 1.2, 1);
  blob.renderOrder = 1;
  root.add(blob);

  // おすわり：おしりが地面につく高さ
  const sitPitch = 0.42;
  const sitY = ry * 0.86 * Math.cos(sitPitch) + rz * 0.8 * Math.sin(sitPitch) + 0.004;
  const top = bodyY + head.position.y + neck.position.y + hr * 1.1;
  return {
    root, body, neck, head, headMesh, eyes, nose, tongue, blush, mouth, mouthOpen, ears, tail, legs, blob,
    dims: {
      scale, legLen: legVis, legModel, bodyY, bodyLen: rz * 1.6, bodyR: R, rx, ry, rz, headR: hr, top,
      sitY, sitPitch, lieY: ry * 0.96, earType, tailType,
    },
  };
}

/** 像や置物用：おすわりの形にする */
export function sitRig(rig) {
  const d = rig.dims;
  rig.body.position.y = d.sitY;
  rig.body.rotation.x = -d.sitPitch;
  rig.legs[2].rotation.x = -1.0;
  rig.legs[3].rotation.x = -1.0;
  for (const L of [rig.legs[0], rig.legs[1]]) {
    L.rotation.x = d.sitPitch;
    fitLeg(rig, L, 1);
  }
}

/** 脚の長さを、地面にとどくように合わせる（w: 0..1 どれだけ合わせるか） */
export function fitLeg(rig, L, w) {
  const a = rig.body.rotation.x;
  const hipY = rig.body.position.y + L.position.y * Math.cos(a) - L.position.z * Math.sin(a);
  const t = a + L.rotation.x;
  const need = hipY / Math.max(0.35, Math.cos(t));
  const k = clamp(need / rig.dims.legModel, 0.55, 1.9);
  L.scale.y = 1 + (k - 1) * w;
}
