import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../util.js';

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
  make(color, day = 0.0, night = 2.4, base = 0xffffff) {
    const m = new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: day, roughness: 0.6 });
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
export const WIND = { time: { value: 0 }, strength: { value: 1 } };
export function windMaterial(opts = {}) {
  const { sway, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, ...rest });
  m.userData.shared = true;
  m.userData.wind = true;
  m.customProgramCacheKey = () => 'wind' + (sway || 0.06) + (rest.flatShading === false ? 's' : 'f');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.time;
    sh.uniforms.uWind = WIND.strength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          float h = max(0.0, position.y) * ${sway ? sway.toFixed(3) : '0.06'};
          float ph = wp.x * 0.37 + wp.z * 0.29;
          transformed.x += sin(uTime * 1.7 + ph) * h * uWind;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * h * 0.7 * uWind;
        }`);
    // 葉の裏から光が透ける感じ（逆光でふんわり明るく）
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.12;',
    );
  };
  return m;
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
  TEX.asphalt = canvasTex(512, 512, (c, w, h) => {
    noiseFill(c, w, h, '#77767a', 0.12, 9000, 1, 2);
    const r = mulberry32(5);
    for (let i = 0; i < 18; i++) {
      c.strokeStyle = `rgba(40,40,45,${0.08 + r() * 0.08})`;
      c.lineWidth = 1 + r() * 2;
      c.beginPath();
      let x = r() * w, y = r() * h;
      c.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); }
      c.stroke();
    }
  }, { repeat: [1, 1] });
  TEX.sidewalk = canvasTex(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#cfc7ba', 0.08, 2500, 2, 2);
    c.strokeStyle = 'rgba(120,105,90,0.35)';
    c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke(); }
  });
  TEX.plaza = canvasTex(256, 256, (c, w, h) => {
    const r = mulberry32(3);
    const cols = ['#e3d6c3', '#d9c9b2', '#e8dcc9', '#cfbfa8', '#dccdb6'];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      c.fillStyle = cols[Math.floor(r() * cols.length)];
      c.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
    c.globalCompositeOperation = 'multiply';
    noiseFill(c, 0, 0, 'rgba(0,0,0,0)', 0, 0, 1);
    c.globalCompositeOperation = 'source-over';
  });
  TEX.stone = canvasTex(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#bdb3a4', 0.1, 3000, 4, 2);
    const r = mulberry32(8);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = 'rgba(110,95,80,0.35)';
      c.lineWidth = 2;
      c.strokeRect(r() * w, r() * h, 30 + r() * 40, 20 + r() * 30);
    }
  });
  TEX.grass = canvasTex(256, 256, (c, w, h) => {
    const r = mulberry32(6);
    c.fillStyle = '#86b562';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const g = 90 + r() * 70;
      c.fillStyle = `rgba(${60 + r() * 50},${g + 40},${40 + r() * 30},0.5)`;
      c.fillRect(r() * w, r() * h, 1.5, 3 + r() * 3);
    }
  });
  TEX.soil = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, '#9a7456', 0.18, 5000, 7, 3));
  TEX.sand = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, '#e7d3a8', 0.12, 5000, 9, 2));
  TEX.block = canvasTex(256, 128, (c, w, h) => {
    noiseFill(c, w, h, '#c4c0b8', 0.08, 2500, 10, 2);
    c.strokeStyle = 'rgba(90,85,80,0.4)';
    c.lineWidth = 2;
    for (let y = 0; y <= 4; y++) {
      c.beginPath(); c.moveTo(0, y * 32); c.lineTo(w, y * 32); c.stroke();
      for (let x = 0; x <= 4; x++) {
        const ox = (y % 2) * 32;
        c.beginPath(); c.moveTo(x * 64 + ox, y * 32); c.lineTo(x * 64 + ox, y * 32 + 32); c.stroke();
      }
    }
  });
  TEX.siding = canvasTex(64, 256, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      c.fillStyle = 'rgba(0,0,0,0.07)';
      c.fillRect(0, y, w, 2);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(0, y + 2, w, 1);
    }
  });
  TEX.roof = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(0, y + 13, w, 3);
      for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(x, y, 2, 16); }
    }
  });
  TEX.wood = canvasTex(128, 128, (c, w, h) => {
    const r = mulberry32(11);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.08})`;
      c.beginPath();
      const y = r() * h;
      c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.6, y + (r() - 0.5) * 8, w, y);
      c.stroke();
    }
  });
  TEX.water = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, '#ffffff', 0.25, 1200, 12, 4), { srgb: false });
  return TEX;
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
