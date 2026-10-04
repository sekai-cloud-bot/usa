import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './util.js';
import { furMaterial, addFurShells, FUR } from './adv/look.js';
import { Shape, meshShape, vnoise, sdCone, sdEll } from './sdf.js';
import { buildHarness } from './harness.js';

// ------------------------------------------------------------
// うちの子の見た目。犬種ではなく「タイプ（体つき）」を選んで、
// 大きさ・毛の色・もよう・耳・しっぽ・もこもこ を組み合わせる。
//
// 形は「距離関数」で作る：胴・首・もも・脚・頭・マズルを やわらかく溶けあわせ、
// つなぎ目のない1枚の面にする（球を重ねたときの くびれ や 段 が出ない）。
// 顔は「赤ちゃんらしさ」を大事に：大きな丸い頭、少し下によった つぶらな目、
// 小さな黒い鼻、ω の口と ちょこんと出た舌。
// もこもこの子は、面そのものを わたのように でこぼこさせて、ふちに毛を足す。
// ------------------------------------------------------------

export const COLORS = [
  { id: 'white', label: 'ホワイト', hex: '#fbf7f1' },
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
 * 体つき（大きさ1のときのメートル）。
 * L/W/H: 胴の長さ・幅・高さの半分、legH: 胴の下から地面まで、legR: 脚の太さ、thigh: ももの太さ
 * hr: 頭の半径、hy/hz: 頭の中心（胴の中心から上・前）、neck: 首の太さ
 * snout: マズルが顔から出る長さ（頭の半径に対する比）、snW/snH: マズルの幅・高さ、snY: マズルの高さ
 * eye: 目の大きさ、eyeX/eyeY: 目の位置、nose: 鼻の大きさ、cheek: ほっぺ、chest: 胸毛
 * lump: もこもこの房の大きさ、size: 全体の大きさ
 */
export const TYPES = {
  bichon: {
    label: 'ふわふわ わたあめ', sub: 'ビションみたいな', size: 1.0,
    L: 0.16, W: 0.104, H: 0.098, legH: 0.085, legR: 0.041, thigh: 1.0,
    hr: 0.138, hy: 0.19, hz: 0.125, neck: 0.075,
    snout: 0.16, snW: 0.3, snH: 0.25, snY: -0.44,
    eye: 0.14, eyeX: 0.31, eyeY: -0.14, nose: 0.13, cheek: 0.55, chest: 0.6,
    earS: 1.0, tailS: 1.0, lump: 0.03,
    def: { color: 'white', pattern: 'solid', ear: 'fuwa', tail: 'curl', fluff: 1.0 },
  },
  maru: {
    label: 'もふもふ まん丸', sub: 'ポメ・スピッツみたいな', size: 0.96,
    L: 0.15, W: 0.104, H: 0.1, legH: 0.07, legR: 0.034, thigh: 1.0,
    hr: 0.12, hy: 0.185, hz: 0.13, neck: 0.08,
    snout: 0.3, snW: 0.26, snH: 0.2, snY: -0.33,
    eye: 0.118, eyeX: 0.33, eyeY: -0.06, nose: 0.1, cheek: 0.6, chest: 1.0, mane: true,
    earS: 0.8, tailS: 1.0, lump: 0.024,
    def: { color: 'cream', pattern: 'belly', ear: 'pin', tail: 'plume', fluff: 1.0 },
  },
  koro: {
    label: 'ころころ短毛', sub: 'チワワ・子犬みたいな', size: 0.92,
    L: 0.13, W: 0.078, H: 0.08, legH: 0.12, legR: 0.022, thigh: 1.1,
    hr: 0.112, hy: 0.165, hz: 0.14, neck: 0.052,
    snout: 0.3, snW: 0.24, snH: 0.18, snY: -0.3,
    eye: 0.15, eyeX: 0.37, eyeY: 0.0, nose: 0.085, cheek: 0.25, chest: 0.2,
    earS: 1.0, tailS: 0.9, lump: 0.02,
    def: { color: 'cream', pattern: 'solid', ear: 'big', tail: 'thin', fluff: 0.12 },
  },
  kuru: {
    label: 'くるくる巻き毛', sub: 'トイプードルみたいな', size: 1.0,
    L: 0.15, W: 0.085, H: 0.092, legH: 0.155, legR: 0.03, thigh: 1.0,
    hr: 0.108, hy: 0.2, hz: 0.155, neck: 0.058,
    snout: 0.62, snW: 0.24, snH: 0.2, snY: -0.3,
    eye: 0.12, eyeX: 0.33, eyeY: -0.02, nose: 0.09, cheek: 0.4, chest: 0.4, topknot: true,
    earS: 1.0, tailS: 1.0, lump: 0.016, curly: true,
    def: { color: 'apricot', pattern: 'solid', ear: 'fuwa', tail: 'pom', fluff: 0.85 },
  },
  doss: {
    label: 'どっしり胴長', sub: 'ダックス・コーギーみたいな', size: 1.05,
    L: 0.25, W: 0.09, H: 0.09, legH: 0.06, legR: 0.03, thigh: 1.1,
    hr: 0.1, hy: 0.155, hz: 0.24, neck: 0.056,
    snout: 0.85, snW: 0.24, snH: 0.2, snY: -0.3,
    eye: 0.11, eyeX: 0.35, eyeY: 0.04, nose: 0.1, cheek: 0.2, chest: 0.45,
    earS: 1.0, tailS: 1.2, lump: 0.022,
    def: { color: 'brown', pattern: 'solid', ear: 'long', tail: 'thin', fluff: 0.3 },
  },
  sura: {
    label: 'すらっと中型', sub: '柴・ミックスみたいな', size: 1.25,
    L: 0.19, W: 0.09, H: 0.1, legH: 0.155, legR: 0.032, thigh: 1.1,
    hr: 0.11, hy: 0.2, hz: 0.19, neck: 0.062,
    snout: 0.55, snW: 0.26, snH: 0.21, snY: -0.3,
    eye: 0.1, eyeX: 0.37, eyeY: 0.05, nose: 0.095, cheek: 0.55, chest: 0.4,
    earS: 0.95, tailS: 1.0, lump: 0.024,
    def: { color: 'red', pattern: 'mask', ear: 'pin', tail: 'curl', fluff: 0.25 },
  },
  bigfuwa: {
    label: 'おおきいふわふわ', sub: 'ゴールデン・サモエドみたいな', size: 1.85,
    L: 0.2, W: 0.098, H: 0.108, legH: 0.165, legR: 0.036, thigh: 1.1,
    hr: 0.112, hy: 0.21, hz: 0.2, neck: 0.07,
    snout: 0.82, snW: 0.29, snH: 0.23, snY: -0.32,
    eye: 0.11, eyeX: 0.36, eyeY: 0.05, nose: 0.1, cheek: 0.4, chest: 0.85,
    earS: 0.95, tailS: 1.0, lump: 0.03, lumpK: 0.55,
    def: { color: 'gold', pattern: 'solid', ear: 'tare', tail: 'plume', fluff: 0.72 },
  },
  bigtsuya: {
    label: 'おおきいつやつや', sub: 'ラブラドールみたいな', size: 1.85,
    L: 0.2, W: 0.1, H: 0.106, legH: 0.165, legR: 0.038, thigh: 1.15,
    hr: 0.11, hy: 0.2, hz: 0.2, neck: 0.072,
    snout: 0.86, snW: 0.31, snH: 0.24, snY: -0.32,
    eye: 0.11, eyeX: 0.36, eyeY: 0.05, nose: 0.105, cheek: 0.35, chest: 0.25,
    earS: 0.95, tailS: 1.05, lump: 0.026,
    def: { color: 'cream', pattern: 'solid', ear: 'tare', tail: 'thin', fluff: 0.06 },
  },
  // 公園の コロンちゃん（コーギーと柴犬のミックス）。うちの子えらびには出さない
  // 柴より胴が長く 足は短め、大きな立ち耳、ふさふさの巻き尾、うらじろ、ピンクのハーネス
  koron: {
    label: 'コロン', sub: 'コーギー×柴', size: 1.08, hidden: true,
    L: 0.215, W: 0.098, H: 0.104, legH: 0.125, legR: 0.036, thigh: 1.2,
    hr: 0.112, hy: 0.19, hz: 0.228, neck: 0.072,
    snout: 0.66, snW: 0.27, snH: 0.22, snY: -0.3,
    eye: 0.1, eyeX: 0.37, eyeY: 0.05, nose: 0.095, cheek: 0.6, chest: 0.65,
    earS: 1.3, tailS: 1.15, tailFat: 1.5, lump: 0.024, urajiro: true,
    def: { color: 'red', coat: '#cc9058', pattern: 'mask', ear: 'pin', tail: 'curl', fluff: 0.32, harness: 'pink' },
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
  const t = TYPES[type] || TYPES.bichon;
  return { name: name || 'うさ', type: TYPES[type] ? type : 'bichon', size: 'm', ...t.def, ...over };
}

/** はじめての子：うさ（白いビション） */
export function defaultDogParams() {
  return typeParams('bichon', 'うさ');
}

// 前のバージョン（犬種）の保存データを、タイプに読みかえる
const OLD = {
  bichon: ['bichon', {}],
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
    // 前の「もふもふまん丸」の白い子は、もともと ビションのつもりだった子（うさ）なので、ビションに
    if (p.type === 'maru' && p.color === 'white' && !p.v2) return { ...typeParams('bichon', p.name), size: p.size || 'm', v2: 1 };
    const t = TYPES[p.type];
    return { ...t.def, size: 'm', ...p, v2: 1 };
  }
  const [type, extra] = OLD[p.breed] || ['bichon', {}];
  const out = typeParams(type, p.name, extra);
  if (p.color && COLORS.find((c) => c.id === p.color)) out.color = p.color;
  if (typeof p.fluff === 'number') out.fluff = p.fluff;
  if (OLD_EAR[p.ear] && type !== 'bichon') out.ear = OLD_EAR[p.ear];
  out.v2 = 1;
  return out;
}
/** 町の柴犬や像など（前の呼び方のまま使えるように） */
export function breedParams(breed, name) {
  const [type, extra] = OLD[breed] || ['bichon', {}];
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
  // 毛：光がまわりこむ やわらかい陰影、ふちはあたたかく光る
  M.fur = furMaterial({ rim: 0.55, fuzz: 0.16, self: 0.14, scale: 60, wrap: 0.8, mottle: 0.04, rough: 1 });
  M.fur.envMapIntensity = 0.55;
  M.eye = new THREE.MeshPhysicalMaterial({ color: 0x1a100c, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });
  M.iris = new THREE.MeshStandardMaterial({ color: 0x4a2a1c, roughness: 0.3, envMapIntensity: 0.6 });
  M.nose = new THREE.MeshPhysicalMaterial({ color: 0x241816, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 1.0 });
  M.line = new THREE.MeshStandardMaterial({ color: 0x3a2522, roughness: 0.7 });
  M.hi = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  M.tongue = new THREE.MeshStandardMaterial({ color: 0xf0788a, roughness: 0.4, emissive: 0x6a1a24, emissiveIntensity: 0.2 });
  M.mouth = new THREE.MeshStandardMaterial({ color: 0x8a2c3a, roughness: 0.8, emissive: 0x3a0810, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  M.innerEar = new THREE.MeshStandardMaterial({ color: 0xf0b0a8, roughness: 0.9, emissive: 0x6a2a20, emissiveIntensity: 0.14 });
  // 柴の耳の中は、クリーム色の毛
  M.innerEarFur = new THREE.MeshStandardMaterial({ color: 0xf3dcc0, roughness: 0.95, emissive: 0x6a4a30, emissiveIntensity: 0.12 });
  for (const k in M) M[k].userData.shared = true;
  return M;
}
// ほっぺのうすいピンク（ふちがぼける丸）
let blushTex = null;
function blushTexture() {
  if (blushTex) return blushTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,140,160,1)');
  g.addColorStop(0.45, 'rgba(255,150,168,0.6)');
  g.addColorStop(1, 'rgba(255,160,175,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  blushTex = new THREE.CanvasTexture(cv);
  blushTex.colorSpace = THREE.SRGBColorSpace;
  blushTex.userData.shared = true;
  return blushTex;
}

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function strSeed(s) { let h = 7; for (const ch of String(s || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** 頂点ごとに色をぬる。fn(x, y, z) は「白さ」w 0..1 と明るさ s を返す */
const _c = new THREE.Color();
function paint(geo, coat, white, fn) {
  const p = geo.attributes.position, col = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const r = fn(p.getX(i), p.getY(i), p.getZ(i));
    _c.copy(coat).lerp(white, clamp(r.w, 0, 1)).multiplyScalar(r.s ?? 1);
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
  col.needsUpdate = true;
}

/** 形の範囲を少し広げてメッシュにする */
function mesh(shape, min, max, h, pad) {
  return meshShape(shape, min.map((v) => v - pad), max.map((v) => v + pad), h);
}

// ------------------------------------------------------------
// 犬を作る。前方は +Z。サイズは root.scale に入る（寸法 dims は1倍のときの値）
// opts.shells: false で毛の殻なし（像など）、opts.res: 形の細かさ（大きいほど粗い）
// ------------------------------------------------------------
export function buildDog(params0, opts = {}) {
  const params = normalizeDogParams(params0);
  const T = TYPES[params.type];
  const m = mats();
  const F = clamp(params.fluff ?? T.def.fluff, 0, 1);
  const fluffy = F >= 0.2;
  // coat: 色の一覧にない毛色（町の子用）
  let coat = new THREE.Color(params.coat || colorHex(params.color));
  const white = new THREE.Color('#fcf8f2');
  // 白い子の「ぶち」は、茶色のぶちにする
  if (params.pattern === 'buchi' && coat.getHSL({}, THREE.SRGBColorSpace).l > 0.75) coat = new THREE.Color('#90522e');
  const dark = coat.getHSL({}, THREE.SRGBColorSpace).l < 0.3;
  const isWhite = coat.getHSL({}, THREE.SRGBColorSpace).l > 0.9;
  const pat = params.pattern || 'solid';
  const seed = params.seed ?? strSeed(params.name);
  const rnd = mulberry32(seed || 1);
  const sizeK = (SIZES.find((s) => s.id === params.size) || SIZES[1]).k;
  const scale = T.size * sizeK;
  const q = opts.res || 1;

  // もこもこ：全体が少しふくらみ、面が わたのように でこぼこする
  const puff = F * 0.011 * (T.hr / 0.12);
  const lumpA = fluffy ? (0.0025 + F * 0.0068) * (T.curly ? 1.15 : 1) * (T.lump / 0.022) * (T.lumpK ?? 1) : 0;
  const lumpF = 1 / (T.lump * (T.curly ? 0.75 : 1));
  const s0 = seed % 997;
  const lumpN = (x, y, z) => vnoise(x * lumpF, y * lumpF, z * lumpF, s0) * 0.78 + vnoise(x * lumpF * 2.1 + 5.3, y * lumpF * 2.1 + 1.7, z * lumpF * 2.1 + 3.1, s0 + 1) * 0.22;
  const fluffDisp = (maskFn) => (x, y, z) => {
    const mk = maskFn ? maskFn(x, y, z) : 1;
    if (mk <= 0) return puff * 0.6;
    return puff * (0.6 + 0.4 * mk) + lumpA * (lumpN(x, y, z) * 2 - 0.75) * mk;
  };
  const dispMax = puff + lumpA * 1.3;
  // 毛の殻（ふちの ふわっと感）
  const furLen = opts.shells === false || !fluffy ? 0 : 0.0025 + F * 0.011;
  const shellOpts = { soft: true, density: T.curly ? 120 : 170 };
  const shell = (mesh, k = 1, masks = null) => { if (furLen > 0) addFurShells(mesh, furLen * k, FUR.shells, masks, shellOpts); };
  // 毛の色：下にいくほど ほんのり明るく、房のすきまは少し暗く（黒い子は明るくしない）
  const under = dark ? 0.04 : 0.14;
  const ao = (x, y, z) => (lumpA > 0 ? 0.86 + 0.16 * lumpN(x, y, z) : 1);

  const { L, W, H, hr } = T;
  const bodyY = T.legH + H;
  const root = new THREE.Group();
  root.name = 'dog';
  root.scale.setScalar(scale);
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);
  const hd = V(0, T.hy, T.hz);  // 頭の中心（胴の中心から）

  // ---- 胴（首・胸・もも・肩をいっしょに） ----
  const neckA = [0, H * 0.35, L * 0.5], neckB = [0, T.hy - hr * 0.5, T.hz - hr * 0.2];
  const torso = new Shape();
  torso.ell(0, 0, 0, W, H, L);
  const ch = 0.72 + 0.4 * T.chest;
  torso.ell(0, -H * 0.1, L * 0.55, W * 0.82 * ch, H * 0.82 * ch, L * 0.42, W * 0.5);
  torso.ell(0, H * 0.02, -L * 0.55, W * 0.92, H * 0.93, L * 0.46, W * 0.4);
  for (const s of [-1, 1]) {
    torso.ell(s * W * 0.56, -H * 0.3, -L * 0.56, W * 0.5 * T.thigh, H * 0.72, L * 0.4 * T.thigh, W * 0.35);
    torso.ell(s * W * 0.52, -H * 0.28, L * 0.52, W * 0.44, H * 0.64, L * 0.3, W * 0.35);
  }
  torso.cone(neckA, neckB, T.neck, T.neck * 0.88, T.neck * 0.7);
  // ポメのえりまき
  if (T.mane) torso.ell(0, H * 0.25, L * 0.6, W * 1.05, H * 0.95, L * 0.5, W * 0.3);
  if (lumpA > 0 || puff > 0) torso.displace(fluffDisp(null), dispMax);
  const hh = 0.0082 * q * clamp((W + H) / 0.2, 0.8, 1.3);
  const torsoGeo = mesh(torso, [-W * 1.15, -H * 1.15, -L * 1.12], [W * 1.15, Math.max(H, neckB[1] + T.neck), Math.max(L * 1.12, neckB[2] + T.neck)], hh, dispMax + hh * 2);
  const buchi = (x, y, z, f) => sstep(0.56, 0.62, vnoise(x * f + 11.3, y * f + 3.1, z * f + 7.7, seed));
  paint(torsoGeo, coat, white, (x, y, z) => {
    const yn = y / H, zn = z / L;
    let w = sstep(0.2, -0.9, yn) * under;
    const shade = (1 - 0.1 * sstep(-0.5, -1.0, yn)) * ao(x, y, z);
    if (pat === 'belly' || pat === 'mask') {
      // 胸からお腹にかけて白（胸は高いところまで）
      const v = yn - 1.3 * Math.max(0, zn - 0.15);
      w = Math.max(w, pat === 'belly' ? sstep(-0.1, -0.4, v) : sstep(-0.28, -0.56, v));
      // 首の前も白く
      if (y > H * 0.3 && z > L * 0.5) w = Math.max(w, sstep(0.0, W * 0.5, z - L * 0.5 - Math.abs(x) * 0.6) * (pat === 'belly' ? 1 : 0.8));
    } else if (pat === 'buchi') {
      w = 1 - buchi(x, y, z, 2.3 / W) * (1 - sstep(-0.1, -0.7, yn));
    }
    let s = shade;
    if (T.urajiro) {
      // うらじろ：わき腹は クリームに明るく、背中は少し こく、ももの うしろ（パンツ）と しっぽの下は白
      w = Math.max(w, sstep(0.25, -0.6, yn) * 0.38);
      s *= 1 - 0.1 * sstep(0.3, 0.95, yn);
      // うしろ足の もも の外がわは 毛の色のまま（おなかの白が もも まで広がらない）
      const thighOut = sstep(W * 0.2, W * 0.55, Math.abs(x)) * sstep(0.2, -0.3, zn) * sstep(-1.15, -0.55, yn);
      w = Math.min(w, lerp(w, 0.06, thighOut));
      w = Math.max(w, sstep(-0.78, -1.02, zn) * sstep(0.25, -0.3, yn) * 0.85);
    }
    return { w, s };
  });
  const torsoMesh = new THREE.Mesh(torsoGeo, m.fur);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  shell(torsoMesh);
  body.add(torsoMesh);
  // ハーネス：毛の上に のせる（ベルトの内がわが 毛先に少し うもれるくらい）
  if (params.harness) {
    const zG = L * 0.55 - T.legR * 1.35 - W * 0.2;   // 前足の すぐ うしろ
    body.add(buildHarness(torso, { W, H, L, zG }, puff + lumpA * 0.9 + furLen * 0.4, params.harness));
  }

  // ---- 頭 ----
  const neck = new THREE.Group();
  neck.position.set(0, H * 0.45, L * 0.55);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(hd.x - neck.position.x, hd.y - neck.position.y, hd.z - neck.position.z);
  neck.add(head);

  const hs = new Shape();
  hs.ell(0, 0, 0, hr, hr * 0.96, hr * 0.96);
  const ck = T.cheek;
  for (const s of [-1, 1]) hs.ell(s * hr * 0.42, -hr * 0.3, hr * 0.3, hr * (0.36 + 0.2 * ck), hr * (0.32 + 0.16 * ck), hr * (0.34 + 0.14 * ck), hr * 0.25);
  // マズル（顔から前へ出る）と、あご
  const snY = T.snY * hr;
  const faceZ = hr * 0.96 * Math.sqrt(Math.max(0.1, 1 - (T.snY / 0.96) ** 2));
  const mw = T.snW * hr, mh = T.snH * hr, front = faceZ + T.snout * hr;
  const mlen = Math.max(mh * 1.05, (T.snout * hr + hr * 0.38) / 2);
  const mz = front - mlen;
  hs.ell(0, snY, mz, mw, mh, mlen, hr * 0.2, [0.06 * T.snout, 0, 0]);
  hs.ell(0, snY - mh * 0.5, mz - mlen * 0.1, mw * 0.72, mh * 0.62, mlen * 0.85, hr * 0.12);
  // 鼻すじの上（長い鼻の子は、目の間から なだらかに）
  if (T.snout > 0.4) hs.ell(0, snY + mh * 0.55, mz - mlen * 0.2, mw * 0.62, mh * 0.55, mlen * 0.9, hr * 0.14);
  // トイプードルの頭の毛
  if (T.topknot && F > 0.4) hs.ell(0, hr * 0.42, -hr * 0.12, hr * 0.78, hr * 0.62, hr * 0.78, hr * 0.28);

  // 顔のまわりは、もこもこを弱く（目・鼻・口が毛にうもれない）
  const faceC = V(0, (T.eyeY * hr + snY) * 0.5, faceZ);
  const faceR = hr * (0.36 + 0.08 * T.snout);
  const headMask = (x, y, z) => {
    let k = sstep(faceR * 0.75, faceR * 1.55, Math.hypot(x - faceC.x, (y - faceC.y) * 1.1, (z - faceC.z) * 0.7));
    if (z > faceZ - hr * 0.1) k = Math.min(k, sstep(front + hr * 0.02, faceZ - hr * 0.3, z) * 0.6 + k * 0.4);
    return k;
  };
  if (lumpA > 0 || puff > 0) hs.displace(fluffDisp(headMask), dispMax);
  // 目の位置（面の上）。まわりを少しくぼませて、目が毛の中に おさまるように
  const er = hr * T.eye;
  const eyeC = [], eyeN = [];
  for (const s of [-1, 1]) {
    const dir = V(s * T.eyeX, T.eyeY, Math.sqrt(Math.max(0.05, 1 - T.eyeX ** 2 - T.eyeY ** 2)));
    const S = hs.surface(V(0, 0, 0), dir, hr * 2, true);
    const n = hs.normal(S);
    eyeC.push(S.clone().addScaledVector(n, -er * 0.4));
    eyeN.push(n);
  }
  for (let i = 0; i < 2; i++) {
    const c = eyeC[i].clone().addScaledVector(eyeN[i], er * 1.02);
    hs.cut((x, y, z) => Math.hypot(x - c.x, y - c.y, z - c.z) - er * 1.02, er * 0.5, [c.x, c.y, c.z, er * 1.02]);
  }
  // 鼻の位置：マズルの前、少し上
  const noseR = hr * T.nose * (0.9 + 0.2 * Math.min(1, T.snout));
  const Ns = hs.surface(V(0, snY, mz), V(0, 0.5 * mh / mw, 1), mlen * 3, true);
  const Nn = hs.normal(Ns);
  const noseC = Ns.clone().addScaledVector(Nn, -noseR * 0.28);
  // 口（ω）の線：鼻の下から
  const proj = (x, y) => hs.surface(V(x, y, mz - mlen * 0.3), V(0, 0, 1), mlen * 3 + hr, true);
  const mouthTop = noseC.y - noseR * 0.75;
  const lip = hr * (0.07 + 0.02 * Math.min(1, T.snout));
  const my = mouthTop - lip;
  const mouthW = hr * (0.12 + 0.03 * Math.min(1, T.snout));
  const hh2 = 0.0068 * q * clamp(hr / 0.12, 0.8, 1.25);
  const headGeo = mesh(hs, [-hr * 1.05, -hr * 1.02 - mh, -hr * 1.02], [hr * 1.05, hr * (T.topknot ? 1.15 : 1.0), front + hr * 0.04], hh2, dispMax + hh2 * 2);
  paint(headGeo, coat, white, (x, y, z) => {
    const yn = y / hr, zn = z / hr;
    let w = sstep(0.0, -0.9, yn) * under;
    // マズルは いつも少し明るく
    const mzd = Math.hypot(x / (mw * 1.1), (y - snY) / (mh * 1.25), (z - mz) / (mlen * 1.1));
    w = Math.max(w, (1 - sstep(0.7, 1.05, mzd)) * (dark ? 0.1 : 0.28));
    if (pat === 'belly' || pat === 'mask') {
      // マズル・あご・ほっぺの下が白
      // 白い所：マズル、ほっぺ（目の下から横へ）、あごの下
      let face = 1 - sstep(0.8, 1.15, mzd);
      for (const sgn of [-1, 1]) {
        const cd = Math.hypot((x - sgn * hr * 0.46) / 1.0, (y + hr * 0.3) / 0.8, (z - hr * 0.42) / 1.2);
        face = Math.max(face, 1 - sstep(hr * 0.3, hr * 0.46, cd));
      }
      face = Math.max(face, sstep(-0.45, -0.72, yn) * sstep(-0.3, 0.2, zn));
      w = Math.max(w, face);
      if (pat === 'mask') {
        // まろまゆ
        for (let i = 0; i < 2; i++) {
          const e = eyeC[i];
          const d = Math.hypot(x - e.x * 0.9, y - (e.y + er * 1.9), z - e.z);
          w = Math.max(w, 1 - sstep(er * 0.45, er * 0.8, d));
        }
      }
    } else if (pat === 'buchi') {
      // 白い顔に、片目のまわりだけ ぶち
      const e = eyeC[1];
      const d = Math.hypot(x - e.x, y - e.y - er * 0.4, z - e.z);
      w = sstep(er * 2.6, er * 3.2, d);
      if (z < -hr * 0.2 && y > hr * 0.3) w = Math.min(w, 0.2);
    }
    return { w, s: ao(x, y, z) };
  });
  const headMesh = new THREE.Mesh(headGeo, m.fur);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  // 目：つぶらで つやつや。ひかりは 上に大きく1つ、下に小さく1つ
  const eyes = [];
  const eyeGeo = new THREE.SphereGeometry(er, 24, 18);
  const irisGeo = new THREE.SphereGeometry(er * 0.8, 18, 12);
  const hiGeo = new THREE.SphereGeometry(er * 0.26, 12, 8);
  const hi2Geo = new THREE.SphereGeometry(er * 0.12, 8, 6);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const g = new THREE.Group();
    g.position.copy(eyeC[i]);
    // 前を見る（面の向きと まっすぐ前の あいだ）
    const look = eyeN[i].clone().multiplyScalar(0.45).add(V(0, 0, 0.55)).normalize();
    g.lookAt(g.position.clone().add(look));
    const e = new THREE.Mesh(eyeGeo, m.eye);
    e.scale.set(1, 1.04, 0.92);
    g.add(e);
    const iris = new THREE.Mesh(irisGeo, m.iris);
    // 下のほうが ほんのり茶色（黒一色より、目に奥行きが出る）
    iris.scale.set(0.78, 0.62, 0.45);
    iris.position.set(0, -er * 0.3, er * 0.66);
    e.add(iris);
    const h1 = new THREE.Mesh(hiGeo, m.hi);
    h1.position.set(-s * er * 0.3, er * 0.38, er * 0.84);
    g.add(h1);
    const h2 = new THREE.Mesh(hi2Geo, m.hi);
    h2.position.set(s * er * 0.3, -er * 0.34, er * 0.86);
    g.add(h2);
    head.add(g);
    eyes.push(g);
  }

  // 鼻：まるみのある三角
  const noseGeo = new THREE.SphereGeometry(1, 22, 16);
  {
    const p = noseGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const taper = 1 - Math.max(0, -y) * 0.38;
      p.setXYZ(i, x * 1.32 * taper * noseR, (y * 0.86 + (y > 0 ? 0 : y * 0.05)) * noseR, z * 0.8 * noseR);
    }
    noseGeo.computeVertexNormals();
  }
  const nose = new THREE.Mesh(noseGeo, m.nose);
  nose.position.copy(noseC);
  nose.lookAt(noseC.clone().add(Nn.clone().multiplyScalar(0.3).add(V(0, 0, 0.7)).normalize()));
  head.add(nose);
  const noseHi = new THREE.Mesh(hi2Geo, m.hi);
  noseHi.scale.setScalar(noseR / (er * 0.12) * 0.22);
  noseHi.position.copy(noseC).add(V(-noseR * 0.35, noseR * 0.45, noseR * 0.62));
  noseHi.material = m.hi;
  head.add(noseHi);

  // 口の線（ω）：鼻の下から たてに少し、左右に くるん
  const lineR = hr * 0.0085;
  const lift = (p) => p.addScaledVector(hs.normal(p), lineR * 0.6);
  const philtrum = [proj(0, mouthTop + noseR * 0.2), proj(0, (mouthTop + my) / 2), proj(0, my)].map(lift);
  const smile = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 * 2 - 1;       // -1..1
    const x = t * mouthW;
    const y = my - Math.sin(Math.abs(t) * Math.PI) * lip * 0.55 + Math.abs(t) * lip * 0.2;
    smile.push(lift(proj(x, y)));
  }
  const lineGeo = (pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 4, lineR, 5);
  const mouthLine = new THREE.Group();
  mouthLine.add(new THREE.Mesh(lineGeo(philtrum), m.line), new THREE.Mesh(lineGeo(smile), m.line));
  head.add(mouthLine);

  // 口：あけると 口の中と舌が見える（にこっ）
  const mouthPt = proj(0, my);
  const mouthN = hs.normal(mouthPt);
  const mouthOpen = new THREE.Group();
  mouthOpen.position.copy(mouthPt).addScaledVector(mouthN, -hr * 0.01);
  // 上のふちが ω の線にそろう、下がまるい口
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m.mouth);
  inner.scale.set(mouthW * 0.82, hr * 0.24, hr * 0.06);
  mouthOpen.add(inner);
  head.add(mouthOpen);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), m.tongue);
  tongue.scale.set(mouthW * 0.62, hr * 0.032, hr * 0.1);
  tongue.position.copy(mouthPt).add(V(0, -hr * 0.11, hr * 0.025));
  tongue.rotation.x = 0.45;
  head.add(tongue);

  // ほっぺ
  const blushMat = new THREE.MeshBasicMaterial({ map: blushTexture(), transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const blushGeo = new THREE.PlaneGeometry(hr * 0.36, hr * 0.28);
  const blush = [];
  for (const s of [-1, 1]) {
    const S = hs.surface(V(0, 0, 0), V(s * 0.62, -0.3, 0.72), hr * 2, true);
    const n = hs.normal(S);
    const b = new THREE.Mesh(blushGeo, blushMat);
    b.position.copy(S).addScaledVector(n, furLen * 0.35 + 0.0015);
    b.lookAt(b.position.clone().add(n));
    b.renderOrder = 2;
    head.add(b);
    blush.push(b);
  }

  // 頭の毛（目・鼻・口のまわりは あけておく）
  if (furLen > 0) {
    const masks = eyes.map((e) => [e.position.x, e.position.y, e.position.z, er * 1.7]);
    masks.push([noseC.x, noseC.y, noseC.z, noseR * 2.0]);
    masks.push([mouthPt.x, mouthPt.y - hr * 0.03, mouthPt.z, mouthW * 1.2]);
    addFurShells(headMesh, furLen * 0.8, FUR.shells, masks, shellOpts);
  }

  // くわえ位置
  const mouth = new THREE.Object3D();
  mouth.position.copy(mouthPt).add(V(0, -hr * 0.06, hr * 0.04));
  head.add(mouth);

  // ---- 耳 ----
  const ears = [];
  const earType = params.ear || 'pin';
  const eS = T.earS;
  const earTint = (geo) => paint(geo, coat, white, (x, y, z) => ({ w: pat === 'buchi' ? 0 : under * 0.3, s: (dark ? 0.94 : 0.96) * ao(x, y, z) }));
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    const es = new Shape();
    let bounds, innerE = null;
    if (earType === 'pin' || earType === 'big') {
      // 立ち耳：まるみのある三角。前がわは少し くぼむ
      const big = earType === 'big';
      const eh = hr * (big ? 0.82 : 0.55) * eS, eb = hr * (big ? 0.4 : 0.28) * eS, th = big ? 0.3 : 0.4;
      const A = hs.surface(V(0, 0, 0), V(s * (big ? 0.62 : 0.5), 0.78, -0.08), hr * 2);
      ear.position.copy(A).addScaledVector(hs.normal(A), -eb * 0.3);
      ear.rotation.set(-0.12, 0, -s * (big ? 0.62 : 0.3));
      es.add((x, y, z) => sdCone(x, y, z / th, 0, -eh * 0.05, 0, 0, eh - eb * 0.2, 0, eb, eb * 0.2) * th, 0);
      es.cut((x, y, z) => sdEll(x, y - eh * 0.4, z - eb * th * 1.05, eb * 0.64, eh * 0.5, eb * th * 0.75), eb * 0.18);
      bounds = [[-eb * 1.1, -eh * 0.2, -eb * 0.6], [eb * 1.1, eh * 1.05, eb * 0.6]];
      innerE = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), T.urajiro ? m.innerEarFur : m.innerEar);
      innerE.scale.set(eb * 0.56, eh * 0.42, eb * 0.06);
      innerE.position.set(0, eh * 0.36, eb * th * 0.28);
    } else if (earType === 'fuwa') {
      // ふわふわの たれ耳：頭の横に ふっくら（頭の毛と ひとつづきに見えるように、つけ根は頭の中）
      const A = hs.surface(V(0, 0, 0), V(s * 0.86, 0.24, -0.14), hr * 2);
      ear.position.copy(A).addScaledVector(hs.normal(A), -hr * 0.14);
      ear.rotation.z = s * 0.1;
      const r0 = hr * 0.23 * eS;
      es.chain([[0, 0, 0, r0 * 0.85], [s * r0 * 0.3, -hr * 0.3 * eS, r0 * 0.05, r0 * 1.08], [s * r0 * 0.36, -hr * 0.56 * eS, r0 * 0.15, r0 * 0.95]], 0, r0 * 0.5);
      bounds = [[-r0 * 1.6, -hr * 0.56 * eS - r0 * 1.2, -r0 * 1.4], [r0 * 1.6, r0 * 1.2, r0 * 1.4]];
    } else {
      // たれ耳（long は長く）：うすい耳が、頭の丸みに そって横に たれる
      const long = earType === 'long';
      const len = hr * (long ? 1.05 : 0.66) * eS;
      const wTop = hr * (long ? 0.2 : 0.22), wBot = hr * (long ? 0.25 : 0.12);
      const th = hr * 0.065;
      const az = -0.28, el0 = 0.72;
      const N = 9;
      const at = (el) => {
        // 赤道より下は、まっすぐ下へ（頭の下へ まきこまない）
        const e = Math.max(el, 0);
        const dir = V(s * Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
        const S = hs.surface(V(0, 0, 0), dir, hr * 2, true);
        const n = hs.normal(S);
        if (el < 0) S.y += hr * el;
        return { S, n };
      };
      const top = at(el0);
      ear.position.copy(top.S);
      const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const el = el0 - (len / hr) * t;
        const { S, n } = at(el);
        const nx = at(el - 0.05);
        const down = nx.S.clone().sub(S).normalize();
        const out = n.clone().sub(down.clone().multiplyScalar(n.dot(down))).normalize();
        const side = new THREE.Vector3().crossVectors(out, down).normalize();
        const c = S.clone().addScaledVector(out, th * (i === 0 ? 0.2 : 1.05) + furLen * 0.2).sub(top.S);
        const w = lerp(wTop, wBot, t) * (long ? 1 : 1 - 0.25 * t * t) * (i === 0 ? 0.8 : 1);
        es.ellAxes(c, th, (len / N) * 0.9, w, out, down, side, th * 1.6);
        lo.min(c); hi.max(c);
      }
      const mgn = Math.max(wTop, wBot) + th;
      bounds = [[lo.x - mgn, lo.y - mgn, lo.z - mgn], [hi.x + mgn, hi.y + mgn, hi.z + mgn]];
    }
    if (lumpA > 0 || puff > 0) es.displace(fluffDisp(earType === 'fuwa' ? null : () => 0.5), dispMax);
    const hE = 0.0056 * q * clamp(hr / 0.12, 0.8, 1.2);
    const eg = mesh(es, bounds[0], bounds[1], hE, dispMax + hE * 2);
    earTint(eg);
    const em = new THREE.Mesh(eg, m.fur);
    em.castShadow = true;
    ear.add(em);
    if (innerE) ear.add(innerE);
    shell(em, earType === 'fuwa' ? 1 : 0.5);
    ear.userData.baseZ = ear.rotation.z;
    head.add(ear);
    ears.push(ear);
  }

  // ---- しっぽ ----
  const tail = new THREE.Group();
  tail.position.set(0, H * 0.5, -L * 0.86);
  body.add(tail);
  const tailType = params.tail || 'plume';
  const u = H * T.tailS;
  const ts = new Shape();
  const tf = 0.7 + 0.5 * F;   // もこもこの子は太い
  const fat = T.tailFat ?? 1;
  if (tailType === 'pom') {
    // 背中の上に、わたのような まるい ぽんぽん
    ts.chain([[0, 0, 0, u * 0.24], [0, u * 0.45, -u * 0.26, u * 0.22], [0, u * 0.78, -u * 0.18, u * 0.2]], 0, u * 0.1);
    ts.ell(0, u * 0.86, -u * 0.08, u * 0.58 * tf, u * 0.52 * tf, u * 0.56 * tf, u * 0.2);
  } else if (tailType === 'plume') {
    // 背中の上に くるんと のる、大きな ふさふさ
    const r = (v) => v * u * (0.55 + 0.55 * F);
    ts.chain([[0, 0, 0, r(0.3)], [0, u * 0.55, -u * 0.32, r(0.4)], [0, u * 1.02, -u * 0.12, r(0.5)], [0, u * 1.18, u * 0.32, r(0.52)], [0, u * 1.02, u * 0.72, r(0.4)], [0, u * 0.8, u * 0.92, r(0.2)]], 0, u * 0.2);
  } else if (tailType === 'curl') {
    // 柴犬の くるりん：背中の上で まるく まく
    const R = u * 0.56, pts = [];
    for (let i = 0; i <= 12; i++) {
      const th = (i / 12) * Math.PI * 1.75;
      pts.push([u * 0.14 * th / Math.PI, R - R * Math.cos(th), -R * Math.sin(th) * 0.95, u * lerp(0.28, 0.17, i / 12) * (0.85 + 0.3 * F) * fat]);
    }
    ts.chain(pts, 0, u * 0.05);
  } else {
    // ほそいしっぽ：うしろ上へ、先はほそく
    ts.chain([[0, 0, 0, u * 0.2], [0, u * 0.35, -u * 0.48, u * 0.16], [0, u * 0.82, -u * 0.8, u * 0.12], [0, u * 1.22, -u * 0.9, u * 0.07]], 0, u * 0.08);
  }
  if (lumpA > 0 || puff > 0) ts.displace(fluffDisp(null), dispMax);
  const hT = 0.0064 * q;
  const tailGeo = mesh(ts, [-u * 1.1, -u * 0.4, -u * 1.25], [u * 1.1, u * 1.75, u * 1.3], hT, dispMax + hT * 2);
  paint(tailGeo, coat, white, (x, y, z) => {
    let w = 0;
    if (pat === 'buchi') w = 1 - buchi(x + 3, y, z, 2.3 / W) * 0.9;
    // ふさふさ・くるりんの内がわは明るく
    if ((tailType === 'plume' || (tailType === 'curl' && pat === 'mask')) && !dark) w = Math.max(w, sstep(u * 0.3, u * 1.1, y) * 0.4);
    // うらじろの子の巻き尾は、全体に クリーム色で、背中に のる側（下・内がわ）は白っぽい
    if (T.urajiro) w = Math.max(w, 0.22 + 0.45 * sstep(u * 0.5, -u * 0.1, z) * sstep(u * 1.2, u * 0.4, y));
    return { w, s: ao(x, y, z) };
  });
  const tailMesh = new THREE.Mesh(tailGeo, m.fur);
  tailMesh.castShadow = true;
  shell(tailMesh, 1.2 * Math.sqrt(fat));
  tail.add(tailMesh);

  // ---- 脚：つけ根は胴の中にうめておく（動かしても すき間が出ない） ----
  const legs = [];
  const legR = T.legR;
  const hipY = -H * 0.3;
  const legModel = bodyY + hipY;          // つけ根から地面まで
  const pawR = legR * 1.12;
  const pawY = -legModel + pawR * 0.66;
  const legGeos = {};
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Group();
    const front = sz > 0;
    leg.position.set(sx * W * 0.54, hipY, sz * L * (front ? 0.55 : 0.54));
    const key = front ? 'f' : 'b';
    if (!legGeos[key]) {
      const ls = new Shape();
      const top = front ? legR * 1.35 : legR * 1.55 * T.thigh;
      ls.chain([[0, legR * 0.4, front ? 0 : -legR * 0.2, top], [0, -legModel * 0.45, front ? 0 : -legR * 0.25, legR * 1.02], [0, pawY + pawR * 0.4, 0, legR * 0.96]], 0, legR * 0.5);
      // 足先：まるくて少し平たい
      ls.ell(0, pawY, pawR * 0.3, pawR, pawR * 0.66, pawR * 1.25, legR * 0.5);
      // 地面に しずまないように、足の裏はもこもこさせない
      if (lumpA > 0 || puff > 0) ls.displace(fluffDisp((x, y) => sstep(-legModel + 0.004, -legModel + pawR * 1.4, y)), dispMax);
      const hL = Math.min(0.0066, legR * 0.24) * q;
      const g = mesh(ls, [-top, -legModel, -top - legR * 0.3], [top, legR * 0.4 + top, top + pawR * 0.9], hL, dispMax + hL * 2);
      paint(g, coat, white, (x, y, z) => {
        const t = clamp(-y / legModel, 0, 1);  // 0: つけ根 → 1: 足先
        let w = under * t * 0.6;
        if (pat === 'socks' || pat === 'mask') w = Math.max(w, sstep(0.55, 0.72, t));
        if (pat === 'belly' && front) w = Math.max(w, sstep(0.3, 0.6, t) * 0.8);
        // 白い胸から出る前足は、つけ根も白く（胸とのさかいに色の島ができない）
        if ((pat === 'belly' || pat === 'mask') && front) w = Math.max(w, sstep(0.34, 0.12, t));
        if (pat === 'buchi') w = 1 - buchi(x + (front ? 0.3 : -0.3), y + 2, z + (front ? 0.5 : -0.5), 2.3 / W) * (1 - t);
        // うらじろ：足は ひざから下が白、前足は前がわも白っぽい
        // （うしろ足の上のほうは 胴の横から見えるので、毛の色のまま）
        if (T.urajiro) w = Math.max(w, front ? sstep(0.3, 0.5, t) : sstep(0.5, 0.68, t), front ? sstep(-legR * 0.2, legR * 0.8, z) * 0.7 : 0);
        return { w, s: (1 - 0.05 * t) * ao(x, y, z) };
      });
      legGeos[key] = g;
    }
    const lm = new THREE.Mesh(legGeos[key], m.fur);
    lm.castShadow = true;
    lm.receiveShadow = true;
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
  const rx = W + puff, ry = H + puff, rz = L + puff;
  blob.scale.set(rx * 1.3, rz * 1.25, 1);
  blob.renderOrder = 1;
  root.add(blob);

  // おすわり：うしろへ傾けた胴の いちばん下が 地面につく高さ
  const sitPitch = 0.42;
  const sitY = Math.hypot(ry * Math.cos(sitPitch), rz * Math.sin(sitPitch)) * 0.97 + 0.004;
  const top = bodyY + hd.y + hr + puff;
  // きせかえの位置：首輪（首の つけ根）と、頭の上
  const cA = new THREE.Vector3(...neckA).lerp(new THREE.Vector3(...neckB), 0.42);
  const collar = { y: cA.y, z: cA.z + T.neck * 0.1, r: T.neck * 0.95 + puff + lumpA };
  const crown = { y: hr * 0.94 + puff + lumpA * 0.5 + (T.topknot && F > 0.4 ? hr * 0.12 : 0), z: -hr * 0.08, r: hr * 0.62 };
  return {
    root, body, neck, head, headMesh, eyes, nose, tongue, blush, mouth, mouthOpen, mouthLine, ears, tail, legs, blob,
    dims: {
      scale, legLen: T.legH, legModel, bodyY, bodyLen: rz * 1.6, bodyR: ry, rx, ry, rz, headR: hr, top,
      sitY, sitPitch, lieY: ry * 0.97, earType, tailType, collar, crown,
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
