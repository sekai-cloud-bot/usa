import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../util.js';
import { patchChunks, normalFromHeight, foliageMaterial, WIND } from './look.js';

patchChunks();

// ------------------------------------------------------------
// マテリアル（同じ見た目は共有して、あとで結合しやすくする）
// ------------------------------------------------------------
const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  let m = cache.get(key);
  if (!m) {
    const { rough = 0.85, metal = 0, ...rest } = opts;
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...rest });
    m.userData.shared = true;
    cache.set(key, m);
  }
  return m;
}

// 夕方に明るくなる「灯り」マテリアル（窓・提灯・街灯）。lampFactor で一括制御
export const LIGHTS = {
  factor: 0,
  mats: [],
  make(color, day = 0.0, night = 2.4, base = 0xffffff, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: day, roughness: 0.6, ...extra });
    m.userData.day = day;
    m.userData.night = night;
    m.userData.shared = true;
    this.mats.push(m);
    return m;
  },
  set(f) {
    this.factor = f;
    for (const m of this.mats) m.emissiveIntensity = m.userData.day + (m.userData.night - m.userData.day) * f;
  },
};

// 風で揺れる植物（木の葉・草・花）。uTime を共有
export { WIND };
export function windMaterial(opts = {}) {
  return foliageMaterial({
    sway: opts.sway ?? 0.06,
    flat: opts.flatShading ?? false,
    side: opts.side ?? THREE.FrontSide,
    trans: opts.trans ?? 0.45,
    grass: opts.grass ?? 0,
    self: opts.self ?? 0.05,
    rough: opts.rough ?? 0.78,
    map: opts.map ?? null,
    leafy: opts.leafy ?? 0,
  });
}

// ------------------------------------------------------------
// 形の部品
// ------------------------------------------------------------
export function box(parent, w, h, d, x, y, z, material, opts = {}) {
  const geo = opts.round ? new RoundedBoxGeometry(w, h, d, 2, Math.min(opts.round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, typeof material === 'number' || typeof material === 'string' ? mat(material) : material);
  m.position.set(x, y + h / 2, z);
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.recv !== false;
  parent.add(m);
  return m;
}
export function cyl(parent, rt, rb, h, x, y, z, material, seg = 12, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!opts.open), typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y + h / 2, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.rz) m.rotation.z = opts.rz;
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.recv !== false;
  parent.add(m);
  return m;
}
export function ball(parent, r, x, y, z, material, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg || 12, opts.seg2 || 8), typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z);
  if (opts.sx) m.scale.set(opts.sx, opts.sy || 1, opts.sz || 1);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.recv !== false;
  parent.add(m);
  return m;
}
/** 床に貼る平面（道路・歩道など） */
export function plane(parent, w, d, x, z, material, y = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = ry;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------
// テクスチャ（すべて canvas で生成）
// ------------------------------------------------------------
export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

/**
 * 色と高さを同時に描いて、色テクスチャ（userData.normal に法線マップ）を返す。
 * draw(c, hc, w, h)：c は色、hc は高さ（灰色 #808080 が基準、明るいほど高い）
 */
function texPair(w, h, draw, { normal = 2, aniso = 8 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const hv = document.createElement('canvas');
  hv.width = w; hv.height = h;
  const c = cv.getContext('2d');
  const hc = hv.getContext('2d', { willReadFrequently: true });
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w, h);
  draw(c, hc, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (normal > 0) t.userData.normal = normalFromHeight(hv, normal, { aniso });
  return t;
}

/** 端をまたぐ図形は反対側にも描く（くり返しの継ぎ目が出ない） */
function wrap(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    const px = x + ox, py = y + oy;
    if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
    fn(px, py);
  }
}
/** やわらかい染み（色むら） */
function blotches(c, w, h, r, n, cols, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = rMin + r() * (rMax - rMin);
    const col = cols[Math.floor(r() * cols.length)];
    const a = alpha * (0.4 + r() * 0.6);
    wrap(w, h, x, y, rad, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g;
      c.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
}
function specks(c, w, h, r, n, cols, sMin, sMax, alpha = 1) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(${cols[Math.floor(r() * cols.length)]},${alpha * (0.35 + r() * 0.65)})`;
    const s = sMin + r() * (sMax - sMin);
    c.fillRect(r() * w, r() * h, s, s);
  }
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
/** 面取りした板（高さ用）：外から内へ明るくなる段 */
function bevelRect(hc, x, y, w, h, top = 200, steps = 3, inset = 1.5) {
  for (let i = 0; i <= steps; i++) {
    const v = Math.round(90 + (top - 90) * (i / steps));
    hc.fillStyle = `rgb(${v},${v},${v})`;
    hc.fillRect(x + i * inset, y + i * inset, w - i * inset * 2, h - i * inset * 2);
  }
}

function noiseFill(ctx, w, h, base, amt, n, seed, size = 2) {
  const r = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = r();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${amt * r()})` : `rgba(0,0,0,${amt * r()})`;
    const s = size * (0.5 + r());
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

export const TEX = {};
export function makeTextures() {
  if (TEX.asphalt) return TEX;
  // アスファルト：骨材の粒・色むら・補修の跡・細いひび
  TEX.asphalt = texPair(1024, 1024, (c, hc, w, h) => {
    const r = mulberry32(1);
    c.fillStyle = '#6c6a6b';
    c.fillRect(0, 0, w, h);
    blotches(c, w, h, r, 70, ['40,38,40', '120,116,112', '90,84,78'], 60, 260, 0.13);
    specks(c, w, h, r, 42000, ['60,58,60', '88,86,86', '120,118,114', '150,146,140'], 1, 2.4, 0.7);
    specks(c, w, h, r, 2600, ['170,166,158', '190,186,176'], 1.5, 3.5, 0.8);
    specks(hc, w, h, mulberry32(1), 42000, ['150,150,150', '120,120,120', '170,170,170'], 1, 2.4, 0.6);
    specks(hc, w, h, r, 6000, ['210,210,210'], 1.5, 3.2, 0.9);
    // 補修の跡（少し黒い四角）
    for (let i = 0; i < 4; i++) {
      const x = r() * w, y = r() * h, pw = 90 + r() * 180, ph = 60 + r() * 140;
      c.fillStyle = 'rgba(40,38,40,0.09)';
      c.fillRect(x, y, pw, ph);
      c.strokeStyle = 'rgba(30,28,30,0.16)';
      c.lineWidth = 2;
      c.strokeRect(x, y, pw, ph);
    }
    // ひび
    for (let i = 0; i < 16; i++) {
      let x = r() * w, y = r() * h;
      const pts = [[x, y]];
      for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; pts.push([x, y]); }
      for (const [ctx, col, lw] of [[c, `rgba(30,28,30,${0.25 + r() * 0.2})`, 1 + r() * 1.5], [hc, 'rgba(20,20,20,0.9)', 2.2]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      }
    }
  }, { normal: 3.2 });

  // 歩道：インターロッキングブロック（半分ずらし）
  TEX.sidewalk = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(2);
    c.fillStyle = '#8f877c';
    c.fillRect(0, 0, w, h);
    hc.fillStyle = '#303030';
    hc.fillRect(0, 0, w, h);
    const bw = 128, bh = 64;
    for (let y = 0; y < h; y += bh) {
      const off = ((y / bh) % 2) * bw / 2;
      for (let x = -bw; x < w + bw; x += bw) {
        const px = x + off;
        const l = 70 + r() * 9;
        c.fillStyle = hsl(32 + r() * 8, 10 + r() * 6, l);
        c.fillRect(px + 2, y + 2, bw - 4, bh - 4);
        c.fillStyle = 'rgba(0,0,0,0.08)';
        c.fillRect(px + 2, y + bh - 6, bw - 4, 4);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(px + 2, y + 2, bw - 4, 3);
        bevelRect(hc, px + 2, y + 2, bw - 4, bh - 4, 190, 3, 1.5);
      }
    }
    specks(c, w, h, r, 9000, ['80,74,68', '200,194,184'], 1, 2, 0.35);
    blotches(c, w, h, r, 30, ['60,50,40', '255,250,240'], 30, 120, 0.08);
  }, { normal: 2.2 });

  // 商店街：レンガ色のタイル（段違い）
  TEX.brick = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(3);
    c.fillStyle = '#b7a48f';
    c.fillRect(0, 0, w, h);
    hc.fillStyle = '#383838';
    hc.fillRect(0, 0, w, h);
    const cols = [[28, 42, 72], [24, 40, 66], [30, 45, 76], [20, 36, 62], [32, 38, 70], [18, 30, 58]];
    const bw = 64, bh = 32;
    for (let y = 0; y < h; y += bh) {
      const off = ((y / bh) % 2) * bw / 2;
      for (let x = -bw; x < w + bw; x += bw) {
        const px = x + off;
        const [hh, ss, ll] = cols[Math.floor(r() * cols.length)];
        c.fillStyle = hsl(hh, ss, ll + (r() - 0.5) * 5);
        c.fillRect(px + 1.5, y + 1.5, bw - 3, bh - 3);
        c.fillStyle = 'rgba(255,245,230,0.10)';
        c.fillRect(px + 1.5, y + 1.5, bw - 3, 2);
        bevelRect(hc, px + 1.5, y + 1.5, bw - 3, bh - 3, 185, 2, 1.2);
      }
    }
    specks(c, w, h, r, 6000, ['90,60,40', '255,240,220'], 1, 2, 0.25);
    blotches(c, w, h, r, 26, ['70,50,35', '255,245,230'], 30, 110, 0.07);
  }, { normal: 2.0 });

  // 駅前広場：御影石の大きな敷石（白っぽい・グレー・あたたかい色の3種）
  TEX.plaza = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(31);
    c.fillStyle = '#9d968c';
    c.fillRect(0, 0, w, h);
    hc.fillStyle = '#383838';
    hc.fillRect(0, 0, w, h);
    const cols = [[36, 14, 80], [30, 8, 72], [34, 16, 76], [28, 6, 66]];
    const s = 128;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      const [hh, ss, ll] = (x / s + y / s) % 2 ? cols[Math.floor(r() * 2)] : cols[2 + Math.floor(r() * 2)];
      c.fillStyle = hsl(hh, ss, ll + (r() - 0.5) * 3);
      c.fillRect(x + 2, y + 2, s - 4, s - 4);
      bevelRect(hc, x + 2, y + 2, s - 4, s - 4, 190, 3, 1.5);
    }
    // 御影石のつぶつぶ
    specks(c, w, h, r, 26000, ['70,66,62', '120,114,108', '235,230,222', '150,120,110'], 0.8, 1.8, 0.45);
    specks(hc, w, h, mulberry32(31), 9000, ['170,170,170', '110,110,110'], 0.8, 1.6, 0.4);
    blotches(c, w, h, r, 20, ['80,70,60', '255,250,240'], 30, 120, 0.06);
  }, { normal: 1.6 });

  // 石畳：不定形の石（ボロノイ）
  TEX.stone = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(4);
    const pts = [];
    for (let i = 0; i < 34; i++) pts.push([r() * w, r() * h, 36 + r() * 10, 12 + r() * 10, 58 + r() * 14]);
    const img = c.createImageData(w, h), himg = hc.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let d1 = 1e9, d2 = 1e9, k = 0;
        for (let i = 0; i < pts.length; i++) {
          let dx = Math.abs(x - pts[i][0]), dy = Math.abs(y - pts[i][1]);
          if (dx > w / 2) dx = w - dx;
          if (dy > h / 2) dy = h - dy;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
        }
        const e = Math.sqrt(d2) - Math.sqrt(d1);
        const edge = Math.min(1, e / 7);
        const p = pts[k];
        const col = new THREE.Color().setHSL(p[2] / 360, p[3] / 100, (p[4] / 100) * (0.72 + 0.28 * edge));
        const i = (y * w + x) * 4;
        const g = e < 2 ? 0.55 : 1;
        img.data[i] = col.r * 255 * g; img.data[i + 1] = col.g * 255 * g; img.data[i + 2] = col.b * 255 * g; img.data[i + 3] = 255;
        const hv = 60 + 170 * Math.pow(edge, 0.6);
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    hc.putImageData(himg, 0, 0);
    specks(c, w, h, r, 8000, ['70,64,58', '220,214,204'], 1, 2, 0.3);
  }, { normal: 2.4 });

  // 芝：大小の色むら＋細い葉
  TEX.grass = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(6);
    c.fillStyle = '#76a552';
    c.fillRect(0, 0, w, h);
    blotches(c, w, h, r, 40, ['60,110,40', '150,170,80', '90,130,50'], 40, 160, 0.3);
    for (let i = 0; i < 16000; i++) {
      const x = r() * w, y = r() * h, len = 3 + r() * 5;
      const g = 110 + r() * 80;
      c.strokeStyle = `rgba(${60 + r() * 60},${g},${30 + r() * 30},0.55)`;
      c.lineWidth = 1 + r();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - len); c.stroke();
      hc.strokeStyle = `rgba(${170 + r() * 60},${170 + r() * 60},${170 + r() * 60},0.6)`;
      hc.beginPath(); hc.moveTo(x, y); hc.lineTo(x + (r() - 0.5) * 3, y - len); hc.stroke();
    }
  }, { normal: 1.4 });

  TEX.soil = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(7);
    c.fillStyle = '#8c684c';
    c.fillRect(0, 0, w, h);
    blotches(c, w, h, r, 20, ['60,40,28', '170,130,96'], 20, 70, 0.25);
    specks(c, w, h, r, 5000, ['70,48,34', '160,124,94', '190,160,130'], 1, 3, 0.6);
    specks(hc, w, h, mulberry32(7), 5000, ['200,200,200', '90,90,90'], 1, 3, 0.7);
  }, { normal: 1.8 });
  TEX.sand = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(9);
    c.fillStyle = '#e2cfa4';
    c.fillRect(0, 0, w, h);
    blotches(c, w, h, r, 16, ['190,160,110', '250,240,210'], 20, 70, 0.2);
    specks(c, w, h, r, 7000, ['180,150,110', '250,244,226', '150,130,100'], 1, 2, 0.5);
    specks(hc, w, h, mulberry32(9), 7000, ['190,190,190', '100,100,100'], 1, 2, 0.6);
  }, { normal: 1.2 });

  // コンクリートブロック塀
  TEX.block = texPair(256, 128, (c, hc, w, h) => {
    const r = mulberry32(10);
    c.fillStyle = '#a19c93';
    c.fillRect(0, 0, w, h);
    hc.fillStyle = '#404040';
    hc.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      const ox = (y % 2) * 32;
      for (let x = -1; x < 5; x++) {
        const px = x * 64 + ox;
        c.fillStyle = hsl(40, 5 + r() * 4, 72 + r() * 6);
        c.fillRect(px + 1.5, y * 32 + 1.5, 61, 29);
        bevelRect(hc, px + 1.5, y * 32 + 1.5, 61, 29, 180, 2, 1);
      }
    }
    specks(c, w, h, r, 5000, ['90,86,80', '210,206,198'], 1, 1.8, 0.4);
    specks(hc, w, h, r, 3000, ['60,60,60'], 1, 1.6, 0.5);
    // 雨だれ
    for (let i = 0; i < 12; i++) {
      const x = r() * w, len = 20 + r() * 80;
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(60,56,50,0.16)'); g.addColorStop(1, 'rgba(60,56,50,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, 2 + r() * 5, len);
    }
  }, { normal: 2.2 });

  // 外壁（横張りのサイディング）：板ごとに下が影になる
  TEX.siding = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(12);
    c.fillStyle = '#f4f2ee';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      const g = c.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.92, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0.2)');
      c.fillStyle = g;
      c.fillRect(0, y, w, 16);
      const hg = hc.createLinearGradient(0, y, 0, y + 16);
      hg.addColorStop(0, 'rgb(90,90,90)');
      hg.addColorStop(0.9, 'rgb(190,190,190)');
      hg.addColorStop(1, 'rgb(70,70,70)');
      hc.fillStyle = hg;
      hc.fillRect(0, y, w, 16);
    }
    // 継ぎ目
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(r() * w);
      c.fillStyle = 'rgba(0,0,0,0.08)';
      c.fillRect(x, 0, 2, h);
      hc.fillStyle = 'rgb(60,60,60)';
      hc.fillRect(x, 0, 2, h);
    }
    // うっすら雨だれ
    for (let i = 0; i < 10; i++) {
      const x = r() * w, y = r() * h, len = 30 + r() * 90;
      const g = c.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(90,80,70,0.07)'); g.addColorStop(1, 'rgba(90,80,70,0)');
      c.fillStyle = g;
      c.fillRect(x, y, 3 + r() * 6, len);
    }
    specks(c, w, h, r, 2000, ['200,196,190'], 1, 1.5, 0.3);
  }, { normal: 1.6 });

  // 瓦：丸みのある列、段ごとに重なりの影
  TEX.roof = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(13);
    const cw = 64, rh = 48;
    const img = c.createImageData(w, h), himg = hc.createImageData(w, h);
    const tint = [];
    for (let i = 0; i < 64; i++) tint.push(0.9 + r() * 0.16);
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / rh), fy = (y % rh) / rh;
      for (let x = 0; x < w; x++) {
        const xo = x + (row % 2) * (cw / 2);
        const col = Math.floor(xo / cw) % 4, fx = (xo % cw) / cw;
        const round = Math.cos((fx - 0.5) * Math.PI);           // 瓦の丸み
        const lap = fy > 0.86 ? 1 - (fy - 0.86) / 0.14 : 1;      // 下の段との重なり
        const hv = 40 + 150 * round * 0.8 + 50 * fy * lap;
        const k = tint[(row * 4 + col) % 64] * (0.62 + 0.38 * round) * (fy > 0.9 ? 0.62 : 1) * (0.9 + 0.1 * fy);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, 250 * k); img.data[i + 3] = 255;
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = Math.min(255, hv * (fy > 0.9 ? 0.4 : 1)); himg.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    hc.putImageData(himg, 0, 0);
    specks(c, w, h, r, 1500, ['255,255,255', '0,0,0'], 1, 1.5, 0.12);
  }, { normal: 3.0 });

  TEX.wood = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(11);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let p = 0; p < 4; p++) {
      const y0 = p * 64;
      c.fillStyle = `rgba(120,80,40,${r() * 0.12})`;
      c.fillRect(0, y0, w, 64);
      for (let i = 0; i < 14; i++) {
        c.strokeStyle = `rgba(90,55,25,${0.06 + r() * 0.1})`;
        c.lineWidth = 1 + r() * 1.5;
        c.beginPath();
        const y = y0 + 4 + r() * 56;
        c.moveTo(0, y);
        c.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.6, y + (r() - 0.5) * 8, w, y);
        c.stroke();
      }
      c.fillStyle = 'rgba(60,35,15,0.35)';
      c.fillRect(0, y0 + 62, w, 2);
      hc.fillStyle = 'rgb(40,40,40)';
      hc.fillRect(0, y0 + 62, w, 2);
      hc.fillStyle = 'rgb(160,160,160)';
      hc.fillRect(0, y0, w, 62);
    }
  }, { normal: 1.6 });

  // 打ち放しのコンクリート（川の護岸・橋）
  TEX.concrete = texPair(512, 512, (c, hc, w, h) => {
    const r = mulberry32(14);
    c.fillStyle = '#b5b0a6';
    c.fillRect(0, 0, w, h);
    blotches(c, w, h, r, 50, ['120,116,108', '220,216,208', '140,130,110'], 20, 120, 0.18);
    specks(c, w, h, r, 9000, ['110,106,100', '210,206,198'], 1, 2, 0.35);
    // 型枠の目地と穴
    c.strokeStyle = 'rgba(80,76,70,0.35)';
    hc.strokeStyle = 'rgb(50,50,50)';
    for (const ctx of [c, hc]) {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    }
    for (let y = 1; y < 4; y += 2) for (let x = 1; x < 4; x += 2) {
      c.fillStyle = 'rgba(70,66,60,0.5)';
      c.beginPath(); c.arc(x * w / 4, y * h / 4, 5, 0, Math.PI * 2); c.fill();
      hc.fillStyle = 'rgb(30,30,30)';
      hc.beginPath(); hc.arc(x * w / 4, y * h / 4, 5, 0, Math.PI * 2); hc.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = r() * w, len = 60 + r() * 160;
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(70,64,56,0.18)'); g.addColorStop(1, 'rgba(70,64,56,0)');
      c.fillStyle = g;
      c.fillRect(x, r() * h * 0.5, 3 + r() * 8, len);
    }
  }, { normal: 1.4 });

  // 白い小さなタイル（駅の壁）
  TEX.tile = texPair(256, 256, (c, hc, w, h) => {
    const r = mulberry32(15);
    c.fillStyle = '#c9c2b6';
    c.fillRect(0, 0, w, h);
    hc.fillStyle = '#404040';
    hc.fillRect(0, 0, w, h);
    const s = 32;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      c.fillStyle = hsl(36, 18 + r() * 8, 88 + r() * 5);
      c.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
      bevelRect(hc, x + 1.5, y + 1.5, s - 3, s - 3, 200, 2, 1);
    }
  }, { normal: 1.5 });

  TEX.water = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, '#ffffff', 0.25, 1200, 12, 4), { srgb: false });
  return TEX;
}

/** テクスチャ（法線マップ付きなら一緒に）を貼った MeshStandardMaterial */
export function texMaterial(tex, color = 0xffffff, rough = 0.9, extra = {}) {
  const { bump = 1, ...rest } = extra;
  const n = tex.userData.normal;
  const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, ...rest });
  if (n && bump > 0) { m.normalMap = n; m.normalScale = new THREE.Vector2(bump, bump); }
  return m;
}

/** 看板の文字テクスチャ */
export function signTex(text, { bg = '#fff8ea', fg = '#5b3a2a', w = 512, h = 128, font = 800, size = 78, border = null, vertical = false } = {}) {
  const t = canvasTex(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (border) { c.strokeStyle = border; c.lineWidth = 10; c.strokeRect(6, 6, w - 12, h - 12); }
    c.fillStyle = fg;
    let fs = size;
    const setFont = () => { c.font = `${font} ${fs}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", "IPAGothic", sans-serif`; };
    setFont();
    // 板からはみ出さないように縮める
    if (!vertical) while (fs > 10 && c.measureText(text).width > w * 0.9) { fs -= 2; setFont(); }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (vertical) {
      const chars = [...text];
      const step = h / (chars.length + 0.5);
      chars.forEach((ch, i) => c.fillText(ch, w / 2, step * (i + 0.75)));
    } else c.fillText(text, w / 2, h / 2 + 4);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------
// 結合（描画命令を減らす）
// ------------------------------------------------------------
/**
 * group 以下の静的メッシュを、マテリアルの性質ごとに1メッシュへ。
 * 色は頂点カラーへ。テクスチャ付き・透明・特殊マテリアルは同じマテリアル同士で結合。
 */
export function bake(group, { keep = new Set() } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const plain = new Map();   // 色を頂点カラーにできるもの
  const same = new Map();    // マテリアルごと
  const isKept = (o) => { for (let p = o; p && p !== group; p = p.parent) if (keep.has(p)) return true; return false; };
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || isKept(o)) return;
    const m = o.material;
    if (Array.isArray(m)) return;
    const simple = m.isMeshStandardMaterial && !m.map && !m.transparent && !m.userData.wind && !LIGHTS.mats.includes(m) && !m.onBeforeCompile.toString().includes('uTime') && !m.userData.noBake;
    if (simple) {
      const key = [m.roughness, m.metalness, m.flatShading, m.side, o.castShadow, o.receiveShadow, m.emissive.getHex(), m.emissiveIntensity].join('|');
      if (!plain.has(key)) plain.set(key, []);
      plain.get(key).push(o);
    } else if (!m.userData.noBake) {
      const key = m.uuid + '|' + o.castShadow + '|' + o.receiveShadow;
      if (!same.has(key)) same.set(key, []);
      same.get(key).push(o);
    }
  });
  const tmp = new THREE.Matrix4();
  const col = new THREE.Color();
  const vcol = new THREE.Color();
  const build = (list, withColor) => {
    let total = 0;
    const gs = list.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      tmp.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(tmp);
      if (!g.attributes.normal) g.computeVertexNormals();
      total += g.attributes.position.count;
      return { g, o };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const cols = withColor ? new Float32Array(total * 3) : null;
    const src = withColor ? null : list[0].geometry.attributes.color;
    const cols2 = !withColor && src ? new Float32Array(total * 3) : null;
    let off = 0;
    for (const { g, o } of gs) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      const vc = g.attributes.color;
      if (withColor) {
        for (let i = 0; i < n; i++) {
          col.copy(o.material.color);
          if (o.material.vertexColors && vc) col.multiply(vcol.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)));
          cols[(off + i) * 3] = col.r; cols[(off + i) * 3 + 1] = col.g; cols[(off + i) * 3 + 2] = col.b;
        }
      } else if (cols2 && vc) cols2.set(vc.array.subarray(0, n * 3), off * 3);
      off += n;
      g.dispose();
      o.parent.remove(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (cols) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (cols2) geo.setAttribute('color', new THREE.BufferAttribute(cols2, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  };
  const out = [];
  for (const [, list] of plain) {
    if (list.length < 2) continue;
    const m0 = list[0].material;
    const geo = build(list, true);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: m0.roughness, metalness: m0.metalness, flatShading: m0.flatShading, side: m0.side, emissive: m0.emissive, emissiveIntensity: m0.emissiveIntensity });
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    group.add(mesh);
    out.push(mesh);
  }
  for (const [, list] of same) {
    if (list.length < 2) continue;
    const geo = build(list, false);
    const mesh = new THREE.Mesh(geo, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}
