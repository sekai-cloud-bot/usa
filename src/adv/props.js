import * as THREE from 'three';
import { box, cyl, ball, mat, LIGHTS, TEX, signTex, canvasTex, texMaterial } from './build.js';
import { mulberry32 } from '../util.js';

const rnd = mulberry32(2024);
export const R = () => rnd();
export const pickR = (arr) => arr[Math.floor(rnd() * arr.length)];

// 灯りのマテリアル
export const LM = {
  // ガラスはつるつる（空が映る）。夕方は部屋の灯りがともる
  window: LIGHTS.make(0xffc98a, 0.0, 1.35, 0x7d97a8, { roughness: 0.14, metalness: 0.15 }),
  windowWarm: LIGHTS.make(0xffb870, 0.0, 1.6, 0x8aa2b2, { roughness: 0.18, metalness: 0.12 }),
  lamp: LIGHTS.make(0xffd9a0, 0.05, 3.2, 0xfff3de),
  lantern: LIGHTS.make(0xff7a4a, 0.25, 3.0, 0xff9a70),
  vend: LIGHTS.make(0xeaf6ff, 0.55, 1.7, 0xffffff),
  sign: LIGHTS.make(0xfff1d6, 0.0, 0.9, 0xffffff),
};

const texMat = new Map();
function texM(tex, color = 0xffffff, rough = 0.85) {
  const k = tex.uuid + color;
  if (!texMat.has(k)) {
    const m = texMaterial(tex, color, rough);
    m.userData.shared = true;
    texMat.set(k, m);
  }
  return texMat.get(k);
}

/** 箱の側面にだけテクスチャを貼ったメッシュ（UVを実寸に合わせる） */
function texturedBox(g, w, h, d, x, y, z, tex, color, tileW = 1, tileH = 1) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const sx = ny > 0.5 ? w : nx > 0.5 ? d : w;
    const sy = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx / tileW, uv.getY(i) * sy / tileH);
  }
  const m = new THREE.Mesh(geo, texM(tex, color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

// ------------------------------------------------------------
// 家
// ------------------------------------------------------------
const WALLS = [0xf3e9d8, 0xefe1cc, 0xe2e6e4, 0xf1dccb, 0xe9e2d3, 0xdfe3ea, 0xf6efe4, 0xe7d8c3];
const ROOFS = [0x4c5b78, 0x735548, 0x5b6858, 0x8a5146, 0x5c5f66, 0x3f4a5c];

/** 窓（枠＋ガラス。ガラスは夕方に灯る） */
export function windowUnit(g, w, h, x, y, z, ry = 0, lit = true) {
  const f = new THREE.Group();
  box(f, w + 0.12, h + 0.12, 0.08, 0, -0.06, 0, 0xf6f2ea, { cast: false });
  const glass = box(f, w, h, 0.04, 0, 0, 0.03, lit && R() < 0.75 ? (R() < 0.5 ? LM.window : LM.windowWarm) : mat(0x8aa3b2, { rough: 0.2 }), { cast: false });
  glass.userData.window = true;
  box(f, 0.04, h, 0.05, 0, 0, 0.05, 0xf6f2ea, { cast: false });
  if (R() < 0.5) box(f, w * 0.45, h * 0.9, 0.02, -w * 0.25, h * 0.05, 0.055, 0xf7efe6, { cast: false }); // カーテン
  f.position.set(x, y, z);
  f.rotation.y = ry;
  g.add(f);
  return f;
}

/**
 * 日本の家。正面は +z。戻り値の group を回転・配置して使う。
 * w: 幅, d: 奥行き, floors: 階数
 */
export function makeHouse({ w = 7, d = 7, floors = 2, wall = pickR(WALLS), roof = pickR(ROOFS), balcony = R() < 0.6, flat = false } = {}) {
  const g = new THREE.Group();
  const fh = 2.7;
  const H = floors * fh;
  texturedBox(g, w, H, d, 0, 0, 0, TEX.siding, wall, 2, 2.2);
  // 基礎
  box(g, w + 0.06, 0.35, d + 0.06, 0, 0, 0, 0xb9b3aa, { cast: false });
  // 屋根
  if (flat) {
    box(g, w + 0.3, 0.25, d + 0.3, 0, H, 0, 0xd9d4ca);
  } else {
    const rise = Math.min(2.2, w * 0.28);
    const half = w / 2 + 0.45;
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const r = texturedBox(g, len, 0.16, d + 0.9, 0, 0, 0, TEX.roof, roof, 0.9, 0.9);
      r.position.set(s * half / 2, H + rise / 2 - 0.02, 0);
      r.rotation.z = -s * ang;
    }
    // 妻壁（三角）
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, rise * (w / 2) / half); tri.lineTo(-w / 2, 0);
    const tg = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false });
    tg.translate(0, 0, -d / 2);
    const tm = new THREE.Mesh(tg, mat(wall));
    tm.position.y = H;
    tm.castShadow = true;
    g.add(tm);
  }
  // 窓とドア（正面）
  for (let f = 0; f < floors; f++) {
    const y = f * fh + 1.0;
    const n = Math.max(1, Math.floor(w / 2.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      if (f === 0 && i === 0) {
        // 玄関
        box(g, 0.95, 2.05, 0.1, x, 0.35, d / 2 + 0.02, 0x9c6b45, { cast: false });
        box(g, 1.3, 0.1, 0.7, x, 2.5, d / 2 + 0.3, 0xe8e2d8);
        continue;
      }
      windowUnit(g, 1.1, 1.05, x, y + 0.3, d / 2 + 0.02);
    }
    // 側面の窓
    for (const s of [-1, 1]) if (R() < 0.7) windowUnit(g, 0.8, 0.9, s * (w / 2 + 0.02), y + 0.3, (R() - 0.5) * d * 0.4, s * Math.PI / 2);
  }
  if (floors >= 2 && balcony) {
    box(g, w * 0.6, 0.12, 0.9, w * 0.15, fh, d / 2 + 0.45, 0xe8e3db);
    for (let i = 0; i <= 8; i++) box(g, 0.03, 0.9, 0.03, w * 0.15 - w * 0.3 + (w * 0.6 / 8) * i, fh + 0.12, d / 2 + 0.88, 0xf4f1eb, { cast: false });
    box(g, w * 0.6, 0.05, 0.05, w * 0.15, fh + 1.0, d / 2 + 0.88, 0xf4f1eb, { cast: false });
    // 洗濯物
    if (R() < 0.6) {
      const cols = [0xffffff, 0x9fcfe8, 0xf7c9c0, 0xfff1b8, 0xb8e0c8];
      for (let i = 0; i < 4; i++) box(g, 0.35, 0.5, 0.02, w * 0.15 - w * 0.2 + i * 0.45, fh + 0.35, d / 2 + 0.6, pickR(cols), { cast: true });
    }
  }
  // 室外機
  if (R() < 0.7) acUnit(g, w / 2 - 0.7, 0, d / 2 + 0.35);
  return g;
}

export function acUnit(g, x, y, z, ry = 0) {
  const a = new THREE.Group();
  box(a, 0.8, 0.55, 0.3, 0, 0, 0, 0xeeeeea, { round: 0.03 });
  cyl(a, 0.19, 0.19, 0.02, 0.12, 0.27, 0.16, 0x9a9a98, 16, { rx: Math.PI / 2, cast: false }).position.y = 0.27;
  a.position.set(x, y, z);
  a.rotation.y = ry;
  g.add(a);
  return a;
}

// ------------------------------------------------------------
// 商店街の店。正面は +z。
// ------------------------------------------------------------
const AWNINGS = [
  ['#e8604c', '#fff4e6'], ['#3f8f6a', '#fff4e6'], ['#3e6ea8', '#fff4e6'], ['#f0a13a', '#fff4e6'], ['#8a5aa8', '#fff4e6'], ['#d94f6b', '#fff4e6'],
];
const awningTex = new Map();
function stripeTex(a, b) {
  const k = a + b;
  if (!awningTex.has(k)) {
    awningTex.set(k, canvasTex(128, 32, (c, w, h) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? b : a; c.fillRect(i * 16, 0, 16, h); }
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(0, h - 4, w, 4);
    }));
  }
  return awningTex.get(k);
}

export function makeShop({ w = 7, d = 7, name = '店', sub = '', goods = 'box', awning = pickR(AWNINGS), wall = pickR(WALLS), noren = false, lanterns = true } = {}) {
  const g = new THREE.Group();
  const H1 = 3.1, H2 = 2.6;
  // 2階部分
  texturedBox(g, w, H2, d, 0, H1, 0, TEX.siding, wall, 2, 2.2);
  box(g, w + 0.3, 0.3, d + 0.3, 0, H1 + H2, 0, 0xd9d2c6);
  for (let i = 0; i < 2; i++) windowUnit(g, 1.2, 1.0, -w / 4 + (w / 2) * i, H1 + 1.0, d / 2 + 0.02);
  // 1階：奥の壁と左右の柱
  box(g, w, H1, d - 1.6, 0, 0, -0.8, 0xe9e1d3);
  box(g, 0.35, H1, 1.6, -w / 2 + 0.175, 0, d / 2 - 0.8, wall);
  box(g, 0.35, H1, 1.6, w / 2 - 0.175, 0, d / 2 - 0.8, wall);
  // 店の中の灯り
  const inner = box(g, w - 0.8, H1 - 0.6, 0.05, 0, 0.3, d / 2 - 1.58, LM.windowWarm, { cast: false });
  inner.userData.window = true;
  // 陳列台と品物
  box(g, w - 1.2, 0.85, 0.9, 0, 0, d / 2 - 0.55, 0xc99b6a, { round: 0.03 });
  const goodsCols = {
    fish: [0x9fb6c9, 0xd8e3ea, 0xe98c7a, 0x7f97ad], meat: [0xe8837a, 0xd9665e, 0xf1b0a4, 0xc75a50], veg: [0x7bb35a, 0xe85d45, 0xf0c84a, 0x9fcf6a, 0xf29a3a],
    bread: [0xd9a05b, 0xe8bb73, 0xc98a45, 0xf2d29b], candy: [0xef7aa0, 0x7ec7e8, 0xf6d35a, 0x9ad77e, 0xf29a5a], flower: [0xf28aa8, 0xf6d35a, 0xffffff, 0xb58ae0, 0xf2735a],
    book: [0x9fcdb9, 0xf2c6a0, 0xe99f86, 0x7fa9c9], tea: [0xf4e6cf, 0x9c6b45, 0x7fa37a], box: [0xd9c3a3, 0xb8d4c8, 0xe8b8a8],
  }[goods] || [0xd9c3a3];
  for (let i = 0; i < Math.floor((w - 1.4) / 0.42); i++) {
    for (let j = 0; j < 2; j++) {
      const x = -w / 2 + 0.9 + i * 0.42, z = d / 2 - 0.8 + j * 0.42;
      if (goods === 'fish' || goods === 'bread' || goods === 'veg') ball(g, 0.14, x, 0.95, z, pickR(goodsCols), { sx: goods === 'fish' ? 1.6 : 1, sy: 0.6, sz: 1, seg: 8, seg2: 6, cast: false });
      else box(g, 0.3, 0.14 + R() * 0.12, 0.3, x, 0.85, z, pickR(goodsCols), { cast: false });
    }
  }
  // 日よけ
  const aw = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.06, 1.5), texM(stripeTex(awning[0], awning[1])));
  aw.position.set(0, H1 - 0.3, d / 2 + 0.55);
  aw.rotation.x = 0.32;
  aw.castShadow = true;
  aw.receiveShadow = true;
  g.add(aw);
  // 看板
  const sw = Math.min(w - 0.6, 4.2);
  box(g, sw + 0.12, 0.85, 0.12, 0, H1 + 0.12, d / 2 + 0.06, 0xf6efe2);
  const st = signTex(name, { bg: '#fff8ea', fg: awning[0] });
  const sm = new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.1, roughness: 0.7 });
  sm.userData.noBake = true;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.72), sm);
  sign.position.set(0, H1 + 0.545, d / 2 + 0.125);
  g.add(sign);
  if (sub) {
    const vs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.08), new THREE.MeshStandardMaterial({ map: signTex(sub, { w: 128, h: 460, size: 64, vertical: true, bg: awning[0], fg: '#ffffff' }) }));
    vs.position.set(w / 2 - 0.35, H1 + 1.2, d / 2 + 0.35);
    vs.rotation.y = Math.PI / 2;
    vs.castShadow = true;
    g.add(vs);
  }
  if (noren) {
    const nm = new THREE.MeshStandardMaterial({ map: signTex(noren, { w: 256, h: 128, size: 60, bg: '#27406b', fg: '#ffffff' }), side: THREE.DoubleSide });
    const nr = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), nm);
    nr.position.set(-w / 2 + 1.4, H1 - 0.95, d / 2 - 0.05);
    g.add(nr);
  }
  if (lanterns) {
    for (const x of [-w / 2 + 0.5, w / 2 - 0.5]) {
      const l = ball(g, 0.22, x, H1 - 0.55, d / 2 + 1.1, LM.lantern, { sx: 1, sy: 1.3, sz: 1, seg: 10, seg2: 8, cast: false });
      l.userData.lantern = true;
      box(g, 0.02, 0.35, 0.02, x, H1 - 0.35, d / 2 + 1.1, 0x6b4a33, { cast: false });
    }
  }
  return g;
}

// ------------------------------------------------------------
// 町の小物
// ------------------------------------------------------------
export function utilityPole(g, x, z, h = 8.2) {
  cyl(g, 0.14, 0.18, h, x, 0, z, 0xbdb8b0, 10);
  box(g, 1.8, 0.1, 0.1, x, h - 0.9, z, 0x8f8a82);
  box(g, 1.4, 0.1, 0.1, x, h - 1.5, z, 0x8f8a82);
  if (R() < 0.5) cyl(g, 0.22, 0.22, 0.7, x + 0.35, h - 3.0, z, 0x9aa0a4, 10);
  // 黄色と黒の縞（足元）
  cyl(g, 0.185, 0.185, 1.6, x, 0.2, z, 0xf2c23a, 10, { cast: false });
  return [x, h - 0.85, z];
}

/** 電柱の間の電線（たるみのある線） */
export function wires(g, tops, sag = 0.7) {
  const parts = [];
  for (let i = 0; i < tops.length - 1; i++) {
    const [ax, ay, az] = tops[i], [bx, by, bz] = tops[i + 1];
    for (const off of [-0.75, 0, 0.75]) {
      const pts = [];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * off, pz = dx / len * off;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push(new THREE.Vector3(ax + dx * t + px, ay + (by - ay) * t - Math.sin(t * Math.PI) * sag + (off === 0 ? -0.6 : 0), az + dz * t + pz));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.012, 3));
    }
  }
  if (!parts.length) return;
  for (const p of parts) {
    const m = new THREE.Mesh(p, mat(0x2f2f33, { rough: 0.6 }));
    m.castShadow = false;
    g.add(m);
  }
}

export function streetLamp(g, x, z, ry = 0, h = 4.6) {
  const s = new THREE.Group();
  cyl(s, 0.06, 0.08, h, 0, 0, 0, 0x6a6f74, 8);
  box(s, 0.08, 0.08, 0.9, 0, h - 0.1, 0.4, 0x6a6f74);
  const head = box(s, 0.35, 0.12, 0.5, 0, h - 0.25, 0.8, LM.lamp, { cast: false });
  head.userData.lamp = true;
  s.position.set(x, 0, z);
  s.rotation.y = ry;
  g.add(s);
  return s;
}

export function parkLamp(g, x, z) {
  cyl(g, 0.06, 0.08, 3.2, x, 0, z, 0x3f4a44, 8);
  const l = ball(g, 0.22, x, 3.4, z, LM.lamp, { cast: false, seg: 12, seg2: 10 });
  l.userData.lamp = true;
  cyl(g, 0.24, 0.2, 0.08, x, 3.58, z, 0x3f4a44, 12);
}

let vendTexCache = null;
export function vendingMachine(g, x, z, ry = 0, color = 0xd9453f) {
  if (!vendTexCache) {
    vendTexCache = canvasTex(128, 256, (c, w, h) => {
      c.fillStyle = '#f5f8fb';
      c.fillRect(0, 0, w, h);
      const cols = ['#e8604c', '#3e8fd8', '#f2c23a', '#4fae6a', '#f08ab0', '#8a5a3a', '#ffffff', '#6ac2c9'];
      for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) {
        c.fillStyle = cols[(r * 5 + i * 3) % cols.length];
        c.fillRect(10 + i * 23, 18 + r * 36, 14, 26);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(10 + i * 23, 46 + r * 36, 14, 3);
      }
      c.fillStyle = '#20252b';
      c.fillRect(20, 180, 88, 30);
      c.fillStyle = '#c9d2da';
      c.fillRect(10, 222, 108, 20);
    });
  }
  const v = new THREE.Group();
  box(v, 1.0, 1.85, 0.75, 0, 0, 0, color, { round: 0.04 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.5), new THREE.MeshStandardMaterial({ map: vendTexCache, emissive: 0xeaf6ff, emissiveMap: vendTexCache, emissiveIntensity: 0.9 }));
  face.position.set(0, 1.0, 0.38);
  v.add(face);
  v.position.set(x, 0, z);
  v.rotation.y = ry;
  g.add(v);
  return v;
}

export function bench(g, x, z, ry = 0, color = 0xb98652) {
  const b = new THREE.Group();
  for (let i = 0; i < 3; i++) box(b, 1.6, 0.05, 0.12, 0, 0.42, -0.14 + i * 0.14, color, { round: 0.02 });
  for (let i = 0; i < 2; i++) box(b, 1.6, 0.12, 0.04, 0, 0.62 + i * 0.16, -0.24, color, { rx: -0.15 });
  for (const s of [-1, 1]) {
    box(b, 0.06, 0.45, 0.4, s * 0.7, 0, 0, 0x4a4f55);
    box(b, 0.06, 0.4, 0.05, s * 0.7, 0.45, -0.24, 0x4a4f55);
  }
  b.position.set(x, 0, z);
  b.rotation.y = ry;
  g.add(b);
  return b;
}

export function bicycle(g, x, z, ry = 0, color = pickR([0xe8604c, 0x3e6ea8, 0xf2f2ee, 0x3f8f6a, 0xf0a13a])) {
  const b = new THREE.Group();
  const tm = mat(0x2a2a2e, { rough: 0.6 });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 6, 20), tm);
    t.position.set(s * 0.52, 0.34, 0);
    t.castShadow = true;
    b.add(t);
  }
  const fm = mat(color, { rough: 0.4, metal: 0.2 });
  const bar = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), fm);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    m.rotation.z = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;
    m.castShadow = true;
    b.add(m);
  };
  bar(-0.52, 0.34, 0, 0.34); bar(0, 0.34, 0.4, 0.78); bar(-0.52, 0.34, -0.15, 0.8); bar(-0.15, 0.8, 0.4, 0.78); bar(0, 0.34, -0.15, 0.8); bar(0.52, 0.34, 0.42, 0.9);
  box(b, 0.24, 0.05, 0.1, -0.16, 0.82, 0, 0x2a2a2e, { round: 0.02 });
  box(b, 0.05, 0.05, 0.5, 0.42, 0.92, 0, 0x2a2a2e);
  box(b, 0.34, 0.22, 0.28, 0.62, 0.72, 0, 0xc9c9c4, { cast: true }); // かご
  b.position.set(x, 0, z);
  b.rotation.y = ry;
  g.add(b);
  return b;
}

export function postBox(g, x, z) {
  cyl(g, 0.26, 0.26, 1.1, x, 0, z, 0xd8362f, 16);
  ball(g, 0.26, x, 1.1, z, 0xd8362f, { sy: 0.5, seg: 16, seg2: 8 });
  box(g, 0.3, 0.04, 0.05, x, 0.85, z + 0.25, 0x2a2a2e, { cast: false });
}

export function pottedPlant(g, x, z, s = 1) {
  cyl(g, 0.18 * s, 0.14 * s, 0.32 * s, x, 0, z, pickR([0xc98a5a, 0xe8e2d6, 0x8a9aa8, 0xd8b48a]), 10);
  const c = pickR([0x6fae7c, 0x5f9f6e, 0x7fbb6a, 0x4f8f5e]);
  ball(g, 0.26 * s, x, 0.48 * s, z, c, { seg: 7, seg2: 5, sy: 0.9 });
  if (R() < 0.5) ball(g, 0.07 * s, x + 0.12 * s, 0.62 * s, z + 0.1 * s, pickR([0xf28aa8, 0xf6d35a, 0xffffff]), { seg: 6, seg2: 4, cast: false });
}

export function blockWall(g, x0, x1, z0, z1, h = 1.5) {
  const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
  const m = texturedBox(g, w, h, d, (x0 + x1) / 2, 0, (z0 + z1) / 2, TEX.block, 0xffffff, 2, 1);
  box(g, w + 0.04, 0.06, d + 0.04, (x0 + x1) / 2, h, (z0 + z1) / 2, 0xa8a49c, { cast: false });
  return m;
}

export function woodFence(g, x0, z0, x1, z1, h = 1.3, color = 0xc79a6a) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(z1 - z0, x1 - x0);
  const f = new THREE.Group();
  const n = Math.floor(len / 0.16);
  for (let i = 0; i < n; i++) box(f, 0.11, h - (i % 2) * 0.06, 0.03, -len / 2 + 0.08 + i * 0.16, 0, 0, color, { cast: true });
  box(f, len, 0.07, 0.05, 0, h * 0.25, -0.04, 0x9c7650);
  box(f, len, 0.07, 0.05, 0, h * 0.75, -0.04, 0x9c7650);
  f.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  f.rotation.y = -ang;
  g.add(f);
  return f;
}

export function crate(g, x, y, z, w = 0.8, h = 0.45, d = 0.6, color = 0xc9975f) {
  const c = new THREE.Group();
  box(c, w, h, d, 0, 0, 0, color, { round: 0.015 });
  for (const s of [-1, 1]) box(c, w + 0.01, 0.06, 0.02, 0, h * 0.5, s * d / 2, 0x9c7040, { cast: false });
  box(c, w + 0.01, 0.05, d + 0.01, 0, h - 0.05, 0, 0xa87b48, { cast: false });
  c.position.set(x, y, z);
  g.add(c);
  return c;
}

export function guardrail(g, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(z1 - z0, x1 - x0);
  const r = new THREE.Group();
  box(r, len, 0.28, 0.04, 0, 0.5, 0, 0xf4f4f0, { round: 0.02 });
  for (let i = 0; i <= Math.floor(len / 2); i++) cyl(r, 0.05, 0.05, 0.8, -len / 2 + i * 2, 0, 0, 0xe8e8e4, 8);
  r.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  r.rotation.y = -ang;
  g.add(r);
}

export function mirror(g, x, z, ry = 0) {
  cyl(g, 0.05, 0.05, 3.0, x, 0, z, 0xf2a13a, 8);
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), mat(0xdfe8ee, { rough: 0.05, metal: 0.8 }));
  m.position.set(x, 3.1, z + 0.05);
  m.rotation.y = ry;
  g.add(m);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 20), mat(0xf2a13a));
  rim.position.copy(m.position);
  rim.rotation.y = ry;
  g.add(rim);
}

export function trafficSign(g, x, z, ry, text = '止まれ') {
  cyl(g, 0.04, 0.04, 2.4, x, 0, z, 0xdcdcd8, 8);
  const t = new THREE.Mesh(new THREE.CircleGeometry(0.45, 3), new THREE.MeshStandardMaterial({ map: signTex(text, { w: 256, h: 256, size: 60, bg: '#d8362f', fg: '#ffffff' }) }));
  t.position.set(x, 2.6, z + 0.03);
  t.rotation.set(0, ry, Math.PI);
  g.add(t);
}
