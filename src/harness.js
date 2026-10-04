import * as THREE from 'three';
import { clamp, lerp } from './util.js';

// ------------------------------------------------------------
// ハーネス（胸あてのついた ベストハーネス）。
// 体の形（距離関数）の表面を 光線で さぐって、首まわり・胴まわりのベルトと
// 胸あてを、毛の上に ぴったり沿わせる。白い反射ステッチ・黒いバックル・銀のDリングつき。
// 座標は胴（body）の中。前が +Z
// ------------------------------------------------------------

const COLORS = {
  pink: { base: '#d8246f', edge: '#a3134d', mesh: '#1b1719' },
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- 布の模様（色ごとに1枚ずつ。使い回すので dispose しない） ----
const texCache = new Map();
function canvasTex(key, w, h, draw, repeatU = false) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeatU) t.wrapS = THREE.RepeatWrapping;
  t.userData.shared = true;
  texCache.set(key, t);
  return t;
}
/** ベルト：u がベルトの長さ方向（くり返し）、v が はば方向。ふちに2本の 白い点線 */
function strapTexture(c) {
  return canvasTex('strap-' + c.base, 64, 32, (x, w, h) => {
    x.fillStyle = c.base;
    x.fillRect(0, 0, w, h);
    // ふちは 少し こく（縫いしろ）
    x.fillStyle = c.edge;
    x.fillRect(0, 0, w, 3);
    x.fillRect(0, h - 3, w, 3);
    // 織り目
    x.globalAlpha = 0.08;
    x.fillStyle = '#000';
    for (let i = 0; i < w; i += 2) x.fillRect(i, 0, 1, h);
    x.globalAlpha = 1;
    // 反射ステッチ（白い点線）
    x.fillStyle = '#fff6f8';
    for (const y of [Math.round(h * 0.24), Math.round(h * 0.76) - 2]) {
      for (let i = 0; i < w; i += 16) x.fillRect(i + 2, y, 10, 2);
    }
  }, true);
}
/** 胸あて：u が横、v が上→下。ふちに白いパイピング、下のまん中に黒いメッシュのポケット */
function plateTexture(c) {
  return canvasTex('plate-' + c.base, 128, 128, (x, w, h) => {
    x.fillStyle = c.base;
    x.fillRect(0, 0, w, h);
    // ふち（こい色の縁どり）
    x.strokeStyle = c.edge;
    x.lineWidth = 8;
    x.strokeRect(0, 0, w, h);
    // まん中が ふっくら明るい
    const g = x.createRadialGradient(w * 0.5, h * 0.35, 4, w * 0.5, h * 0.4, w * 0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // 白いパイピング：上の ふちに そって、両はしは ポケットの横へ
    x.strokeStyle = '#fff6f8';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(w * 0.1, h * 0.1);
    x.quadraticCurveTo(w * 0.18, h * 0.4, w * 0.3, h * 0.4);
    x.lineTo(w * 0.7, h * 0.4);
    x.quadraticCurveTo(w * 0.82, h * 0.4, w * 0.9, h * 0.1);
    x.stroke();
    // 黒いメッシュのポケット
    const px = w * 0.3, py = h * 0.48, pw = w * 0.4, ph = h * 0.32;
    x.fillStyle = c.mesh;
    // 角の丸い四角（roundRect は 古い Safari に ないので 自分で）
    const r = 8;
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + pw, py, px + pw, py + ph, r);
    x.arcTo(px + pw, py + ph, px, py + ph, r);
    x.arcTo(px, py + ph, px, py, r);
    x.arcTo(px, py, px + pw, py, r);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.lineWidth = 1;
    for (let i = -ph; i < pw; i += 5) {
      x.beginPath(); x.moveTo(px + i, py); x.lineTo(px + i + ph, py + ph); x.stroke();
      x.beginPath(); x.moveTo(px + i + ph, py); x.lineTo(px + i, py + ph); x.stroke();
    }
    // ポケットの口（ゴムの ふち）
    x.fillStyle = '#2c2528';
    x.fillRect(px, py, pw, 5);
  });
}

const M = {};
function mats(c) {
  const k = c.base;
  if (M[k]) return M[k];
  const strapMap = strapTexture(c), plateMap = plateTexture(c);
  const fabric = (map) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x2a2a2a, roughness: 0.72, envMapIntensity: 0.6 });
  M[k] = {
    strap: fabric(strapMap),
    plate: fabric(plateMap),
    buckle: new THREE.MeshStandardMaterial({ color: 0x1d1a1c, roughness: 0.42, envMapIntensity: 0.8 }),
    ring: new THREE.MeshStandardMaterial({ color: 0xd8d6d4, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 }),
  };
  for (const m of Object.values(M[k])) m.userData.shared = true;
  return M[k];
}

// ---- 面の上の線 ----
/** 中心 c から、e1・e2 の面の中を ぐるりと光線で さぐった輪（点・法線）。a=π/2 が e2 の向き */
function ring(shape, c, e1, e2, n, off) {
  const P = [], N = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dir = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    const S = shape.surface(c, dir, 0.6);
    const nn = shape.normal(S);
    P.push(S.addScaledVector(nn, off));
    N.push(nn);
  }
  smooth(P, true, 2);
  return { P, N };
}
/** 点列を少し ならす（面の小さな でこぼこで ベルトが波打たないように） */
function smooth(P, closed, iters) {
  const n = P.length;
  for (let k = 0; k < iters; k++) {
    const Q = P.map((p) => p.clone());
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = Q[(i - 1 + n) % n], b = Q[(i + 1) % n];
      P[i].copy(Q[i]).multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25);
    }
  }
}

/**
 * 点列にそった、角の丸い四角の断面のベルト。
 * P: 中心、N: 面の法線、hw(i): はばの半分、ht: 厚みの半分
 */
function strapGeometry(P, N, hw, ht, closed) {
  const n = P.length, K = 16;
  const pos = [], nor = [], uv = [], idx = [];
  const T = V(0, 0, 0), S = V(0, 0, 0), U = V(0, 0, 0);
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    S.crossVectors(T, N[i]).normalize();
    U.crossVectors(S, T).normalize();
    if (i > 0) len += P[i].distanceTo(P[i - 1]);
    const w = hw(i);
    for (let k = 0; k < K; k++) {
      // 角の丸い四角（スーパー楕円）
      const f = (k / K) * Math.PI * 2, cs = Math.cos(f), sn = Math.sin(f);
      const px = Math.sign(cs) * Math.abs(cs) ** 0.35, py = Math.sign(sn) * Math.abs(sn) ** 0.35;
      pos.push(...P[i].clone().addScaledVector(S, px * w).addScaledVector(U, py * ht).toArray());
      const gx = px ** 3 / w, gy = py ** 3 / ht, gl = Math.hypot(gx, gy) || 1;
      nor.push(...S.clone().multiplyScalar(gx / gl).addScaledVector(U, gy / gl).toArray());
      uv.push(len / 0.05, 0.5 + 0.5 * px);
    }
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % n;
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      const a = i * K + k, b = i * K + k2, c = i2 * K + k2, d = i2 * K + k;
      idx.push(a, d, c, a, c, b);
    }
  }
  if (!closed) {
    // 両はしの ふた
    for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
      const base = pos.length / 3;
      const t = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize().multiplyScalar(sgn);
      pos.push(...P[i].toArray()); nor.push(...t.toArray()); uv.push(0, 0.5);
      for (let k = 0; k < K; k++) {
        pos.push(pos[(i * K + k) * 3], pos[(i * K + k) * 3 + 1], pos[(i * K + k) * 3 + 2]);
        nor.push(...t.toArray()); uv.push(0, 0.5);
      }
      for (let k = 0; k < K; k++) {
        const a = base + 1 + k, b = base + 1 + ((k + 1) % K);
        if (sgn > 0) idx.push(base, a, b); else idx.push(base, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 同じ属性（position・normal・uv）の 形を 1つにまとめる */
function merge(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let v = 0, k = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    uv.set(g.attributes.uv.array, v * 2);
    if (g.index) for (const i of g.index.array) idx[k++] = v + i;
    else for (let i = 0; i < n; i++) idx[k++] = v + i;
    v += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 点列の i 番目の向き（T: すすむ向き、S: はばの向き、U: 面から外） */
function frameAt(P, N, i, closed) {
  const n = P.length;
  const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const T = b.clone().sub(a).normalize();
  const S = new THREE.Vector3().crossVectors(T, N[i]).normalize();
  const U = new THREE.Vector3().crossVectors(S, T).normalize();
  return { T, S, U };
}

/**
 * shape: 胴の形（Shape）、d: 寸法 { W, H, L, zG }、off: 面から ベルトの内がわまでの高さ（毛の上）
 * 戻り値は 胴（body）に足す Group
 */
export function buildHarness(shape, d, off, color = 'pink') {
  const c = COLORS[color] || COLORS.pink;
  const m = mats(c);
  const { W, H, L } = d;
  const g = new THREE.Group();
  g.name = 'harness';
  const ht = 0.0034;                 // ベルトの厚みの半分
  const lift = off + ht;             // 面から ベルトの中心まで
  const strapGeos = [], buckleGeos = [];

  // ---- 胴ベルト：前足の うしろを ぐるり（上が少し うしろへ 傾く） ----
  const tilt = 0.12;
  const zG = d.zG;
  const eUpG = V(0, Math.cos(tilt), -Math.sin(tilt));
  const girth = ring(shape, V(0, -H * 0.12, zG), V(1, 0, 0), eUpG, 72, lift);
  const nG = girth.P.length;
  // 背中の上は はばの広い パッド（首のベルトと つながる所）
  const topK = (i) => { const a = (i / nG) * Math.PI * 2; return sstep(0.55, 0.95, Math.sin(a)); };
  strapGeos.push(strapGeometry(girth.P, girth.N, (i) => W * (0.15 + 0.17 * topK(i)), ht, true));

  // ---- 首ベルト：背中の上（胴ベルトの すぐ前）から、肩をとおって 胸の前へ ----
  const pTop = shape.surface(V(0, 0, zG + W * 0.3), V(0, 1, 0), 0.4);
  const pFront = shape.surface(V(0, -H * 0.05, L * 0.4), V(0, 0, 1), 0.4);
  const cN = pTop.clone().add(pFront).multiplyScalar(0.5);
  const eUpN = pTop.clone().sub(pFront).normalize();
  const neck = ring(shape, cN, V(1, 0, 0), eUpN, 72, lift + ht * 0.6);
  strapGeos.push(strapGeometry(neck.P, neck.N, () => W * 0.135, ht, true));

  // ---- 胸あて：首ベルトの前から、前足の あいだへ（上が広く、下が せまい） ----
  const cP = V(0, -H * 0.3, L * 0.5);
  const top = pFront.clone().sub(cP);
  const e0 = Math.atan2(top.y, top.z) + 0.16, e1 = -1.12;
  const NA = 13, NB = 14;
  const front = [], back = [], ptsB = [];
  let plateBottom = null;
  for (let j = 0; j < NB; j++) {
    const b = j / (NB - 1);
    const el = e0 + (e1 - e0) * b;
    const half = 0.98 - 0.56 * b;
    for (let i = 0; i < NA; i++) {
      const a = (i / (NA - 1)) * 2 - 1;
      const az = a * half;
      const dir = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const S = shape.surface(cP, dir, 0.5);
      const nn = shape.normal(S);
      // まん中が ふっくらした パッド
      const puffy = ht * 0.9 * (1 - a * a) * Math.sin(Math.PI * Math.min(1, b * 1.15 + 0.08));
      front.push(S.clone().addScaledVector(nn, lift + ht * 0.5 + puffy));
      back.push(S.clone().addScaledVector(nn, off * 0.7));
      ptsB.push([a, b]);
      if (i === (NA - 1) / 2 && j === NB - 1) plateBottom = S.clone();
    }
  }
  {
    const pos = [], uv = [], idx = [];
    const id = (i, j, f) => (f ? NA * NB : 0) + j * NA + i;
    for (const [list, isBack] of [[front, false], [back, true]]) {
      list.forEach((p, k) => { pos.push(p.x, p.y, p.z); uv.push((ptsB[k][0] + 1) / 2, 1 - ptsB[k][1]); });
      for (let j = 0; j < NB - 1; j++) {
        for (let i = 0; i < NA - 1; i++) {
          const a = id(i, j, isBack), b = id(i + 1, j, isBack), cc = id(i + 1, j + 1, isBack), dd = id(i, j + 1, isBack);
          if (isBack) idx.push(a, b, cc, a, cc, dd); else idx.push(a, cc, b, a, dd, cc);
        }
      }
    }
    // まわりの ふち（表と裏を つなぐ）
    const border = [];
    for (let i = 0; i < NA - 1; i++) border.push([i, 0]);
    for (let j = 0; j < NB - 1; j++) border.push([NA - 1, j]);
    for (let i = NA - 1; i > 0; i--) border.push([i, NB - 1]);
    for (let j = NB - 1; j > 0; j--) border.push([0, j]);
    const rimBase = pos.length / 3;
    for (const [i, j] of border) {
      const f = front[j * NA + i], bk = back[j * NA + i];
      pos.push(f.x, f.y, f.z, bk.x, bk.y, bk.z);
      uv.push(0.02, 0.02, 0.02, 0.02);
    }
    for (let k = 0; k < border.length; k++) {
      const a = rimBase + k * 2, b = rimBase + ((k + 1) % border.length) * 2;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    pg.setIndex(idx);
    pg.computeVertexNormals();
    const pm = new THREE.Mesh(pg, m.plate);
    pm.castShadow = true;
    g.add(pm);
  }

  // ---- おなかのベルト：胸あての下から、前足の あいだを とおって 胴ベルトの下へ ----
  {
    const P = [], N = [];
    const z0 = plateBottom.z + 0.004, z1 = zG - H * 0.12 * Math.sin(tilt);
    for (let i = 0; i <= 8; i++) {
      const z = z0 + (z1 - z0) * (i / 8);
      const S = shape.surface(V(0, -H * 0.2, z), V(0, -1, 0), 0.4);
      const nn = shape.normal(S);
      P.push(S.addScaledVector(nn, lift));
      N.push(nn);
    }
    strapGeos.push(strapGeometry(P, N, () => W * 0.13, ht, false));
  }

  // ---- バックル（黒）：ベルトの上に のせる ----
  const buckle = (R, closed, i, len, wid, th = 0.0055) => {
    const { T, S, U } = frameAt(R.P, R.N, i, closed);
    const bx = new THREE.BoxGeometry(wid, th, len);
    // S × U = −T なので、z を −T にして 右手系に（裏返らないように）
    const mtx = new THREE.Matrix4().makeBasis(S, U, T.clone().negate()).setPosition(R.P[i].clone().addScaledVector(U, ht + th * 0.35));
    bx.applyMatrix4(mtx);
    buckleGeos.push(bx);
  };
  const at = (R, a) => Math.round(((a / (Math.PI * 2)) % 1 + 1) % 1 * R.P.length) % R.P.length;
  // 首ベルト：肩の上と、胸の横（左右）
  for (const a of [0.95, Math.PI - 0.95, -0.55, Math.PI + 0.55]) buckle(neck, true, at(neck, a), 0.02, W * 0.33);
  // 胴ベルト：わきの上と下（左右）
  for (const a of [0.6, Math.PI - 0.6, -0.45, Math.PI + 0.45]) buckle(girth, true, at(girth, a), 0.019, W * 0.36);
  const bm = new THREE.Mesh(merge(buckleGeos), m.buckle);
  bm.castShadow = true;
  g.add(bm);

  // ---- ベルト（まとめて1つに） ----
  const sm = new THREE.Mesh(merge(strapGeos), m.strap);
  sm.castShadow = true;
  g.add(sm);

  // ---- Dリング：背中の上（胴ベルトのパッドの前のほう） ----
  {
    const i = at(girth, Math.PI / 2);
    const { T, S, U } = frameAt(girth.P, girth.N, i, true);
    const R = W * 0.16;
    // D の形：まっすぐな辺を 下にした 半円より少し大きい弧
    const tg = new THREE.TorusGeometry(R, R * 0.2, 8, 24, Math.PI * 1.2);
    tg.rotateZ(-Math.PI * 0.1);
    const ringM = new THREE.Mesh(tg, m.ring);
    // 輪は 背骨にそって立てて（輪の面 = 前後と上）、少し前へ ねかせる。(−T) × U = −S なので z は −S
    ringM.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T.clone().negate(), U, S.clone().negate()));
    ringM.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(S, -0.45));
    ringM.position.copy(girth.P[i]).addScaledVector(U, ht * 1.6);
    ringM.castShadow = true;
    g.add(ringM);
    // 輪の 根もと（黒い留め具）
    const base = new THREE.Mesh(new THREE.BoxGeometry(R * 1.9, ht * 1.4, R * 0.8), m.buckle);
    base.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(S, U, T.clone().negate()));
    base.position.copy(girth.P[i]).addScaledVector(U, ht * 1.2);
    g.add(base);
  }
  return g;
}

// ------------------------------------------------------------
// いちごがらの バンダナ（たたんで 首に ぐるりと まき、右の首すじで 結ぶ）と、迷子札。
// d: { W, H, L, c: 首の中心, ax: 首の向き(上・前) }、harness: いっしょに つける ハーネス（その上に かぶせる）
// ------------------------------------------------------------
const BANDANA = {
  ichigo: { base: '#f7bccb', hem: '#e7869f', band: '#f2a9bb' },
};
/** いちごがら：ピンクの地に、赤い いちご（黄色い つぶ・緑の へた）と 白い小花 */
function bandanaTexture(c) {
  const t = canvasTex('bandana-' + c.base, 128, 128, (x, w, h) => {
    x.fillStyle = c.base;
    x.fillRect(0, 0, w, h);
    // 布目
    x.globalAlpha = 0.05;
    x.fillStyle = '#7a2a3a';
    for (let i = 0; i < w; i += 3) x.fillRect(i, 0, 1, h);
    for (let i = 0; i < h; i += 3) x.fillRect(0, i, w, 1);
    x.globalAlpha = 1;
    const berry = (cx, cy, s, rot) => {
      x.save();
      x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
      x.fillStyle = '#e2334c';
      x.beginPath();
      x.moveTo(0, 13);
      x.bezierCurveTo(-13, 4, -12, -9, -5, -9);
      x.quadraticCurveTo(0, -10, 5, -9);
      x.bezierCurveTo(12, -9, 13, 4, 0, 13);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,0.35)';
      x.beginPath(); x.ellipse(-4, -3, 2.2, 4, 0.3, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffe9a6';
      for (const [px, py] of [[-4, 4], [3, 3], [0, -2], [-5, -4], [5, -4], [0, 8], [-1, 3]]) x.fillRect(px - 0.8, py - 1, 1.6, 2);
      x.fillStyle = '#3f9a4a';
      for (let i = 0; i < 5; i++) {
        x.save(); x.translate(0, -9); x.rotate((i / 4 - 0.5) * 2.4);
        x.beginPath(); x.ellipse(0, -3.5, 1.8, 4, 0, 0, Math.PI * 2); x.fill();
        x.restore();
      }
      x.restore();
    };
    const flower = (cx, cy) => {
      x.fillStyle = '#fffaf6';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        x.beginPath(); x.arc(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, 2.4, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = '#f6c94a';
      x.beginPath(); x.arc(cx, cy, 1.6, 0, Math.PI * 2); x.fill();
    };
    berry(32, 34, 1, -0.35);
    berry(96, 98, 1, 0.3);
    berry(98, 30, 0.9, 0.5);
    berry(30, 96, 0.9, -0.15);
    flower(64, 64); flower(4, 64); flower(124, 64); flower(64, 4); flower(64, 124);
  }, true);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
const BM = {};
function bandanaMats(c) {
  if (BM[c.base]) return BM[c.base];
  const map = bandanaTexture(c);
  BM[c.base] = {
    cloth: new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x262626, roughness: 0.86, side: THREE.DoubleSide, envMapIntensity: 0.5 }),
    hem: new THREE.MeshStandardMaterial({ color: c.hem, roughness: 0.85, envMapIntensity: 0.5 }),
    tag: new THREE.MeshStandardMaterial({ color: 0x2a2729, roughness: 0.35, envMapIntensity: 0.9 }),
    ring: new THREE.MeshStandardMaterial({ color: 0xd8d6d4, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 }),
  };
  for (const m of Object.values(BM[c.base])) m.userData.shared = true;
  return BM[c.base];
}

export function buildBandana(shape, d, off, kind = 'ichigo', harness = null) {
  const c = BANDANA[kind] || BANDANA.ichigo;
  const m = bandanaMats(c);
  const g = new THREE.Group();
  g.name = 'bandana';
  const tile = 0.045;                 // 模様 1まい分の大きさ
  // 首を ぐるりと まく 輪の面（前が 少し さがる）。e1・e2 の面の中で 角度 a、a=−π/2 が 前
  const el = Math.atan2(d.ax.y, d.ax.z) - 0.2;
  const ax = V(0, Math.sin(el), Math.cos(el));
  const e1 = V(1, 0, 0), e2 = new THREE.Vector3().crossVectors(ax, e1).normalize();
  const aKnot = Math.PI + 0.45;       // 結び目（右の首すじ）。布の つぎ目も ここに かくす
  // たたんだ 布の はば（前は 広く、うしろは 細く）と、まん中の ふくらみ
  const half = (a) => lerp(0.0085, 0.0145, (1 - Math.sin(a)) / 2);
  const bulge = 0.003;
  const NA = 72, NR = 7;
  const base = [], nrm = [], lift = [];
  for (let i = 0; i <= NA; i++) {
    const a = aKnot + (i / NA) * Math.PI * 2;
    const dir = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    for (let j = 0; j < NR; j++) {
      const u = (j / (NR - 1)) * 2 - 1;     // −1: 下（体がわ）のふち、1: 上のふち
      const S = shape.surface(d.c.clone().addScaledVector(ax, u * half(a)), dir, 0.6);
      base.push(S);
      nrm.push(shape.normal(S));
      lift.push(off + 0.0016 + bulge * (1 - u * u));
    }
  }
  // ハーネスの ベルトが ある所は、その上まで 浮かせる（外から 体へ むけて 光線を うつ）
  if (harness) {
    harness.updateMatrixWorld(true);
    const R = 0.04, rc = new THREE.Raycaster();
    rc.far = R;
    base.forEach((S, k) => {
      rc.set(S.clone().addScaledVector(nrm[k], R), nrm[k].clone().negate());
      const h = rc.intersectObject(harness, true)[0];
      if (h) lift[k] = Math.max(lift[k], R - h.distance + 0.0022);
    });
  }
  const P = base.map((S, k) => S.clone().addScaledVector(nrm[k], lift[k]));
  smooth2(P, NA + 1, NR);
  // ---- 布（まん中が ふっくらした 帯） ----
  let len = 0;
  const pos = [], uv = [], idx = [];
  const mid = (NR - 1) >> 1;
  for (let i = 0; i <= NA; i++) {
    if (i > 0) len += P[i * NR + mid].distanceTo(P[(i - 1) * NR + mid]);
    const a = aKnot + (i / NA) * Math.PI * 2;
    for (let j = 0; j < NR; j++) {
      const p = P[i * NR + j];
      pos.push(p.x, p.y, p.z);
      uv.push(len / tile, ((j / (NR - 1)) * 2 - 1) * half(a) / tile);
    }
  }
  for (let i = 0; i < NA; i++) {
    for (let j = 0; j < NR - 1; j++) {
      const a = i * NR + j, b = a + 1, cc = a + NR + 1, dd = a + NR;
      idx.push(a, b, cc, a, cc, dd);
    }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sheet.setIndex(idx);
  sheet.computeVertexNormals();
  const sm = new THREE.Mesh(sheet, m.cloth);
  sm.castShadow = true;
  g.add(sm);
  // 上下の ふち（たたんだ 布の 折り目。まるく）
  for (const j of [0, NR - 1]) {
    const pts = [];
    for (let i = 0; i < NA; i++) pts.push(P[i * NR + j]);
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), NA, 0.0017, 6, true);
    const tm = new THREE.Mesh(tube, m.hem);
    tm.castShadow = true;
    g.add(tm);
  }
  // 帯の まん中の線（結び目・迷子札の 位置さがし用）
  const midP = [], midN = [];
  for (let i = 0; i < NA; i++) { midP.push(P[i * NR + mid]); midN.push(nrm[i * NR + mid]); }

  // ---- 結び目：右の首すじ。ころんと した こぶと、ぴょこんと 出た 2つの はし ----
  {
    const { T, U } = frameAt(midP, midN, 0, true);
    const p = midP[0].clone().addScaledVector(U, 0.004);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m.cloth);
    knot.scale.set(0.013, 0.012, 0.013);
    knot.position.copy(p);
    knot.castShadow = true;
    g.add(knot);
    for (const [k, up] of [[0.55, 0.75], [-0.45, -0.85]]) {
      const flap = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 4), m.cloth);
      flap.scale.z = 0.4;
      const dir = U.clone().multiplyScalar(0.65).addScaledVector(T, k).addScaledVector(ax, up).normalize();
      flap.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      flap.position.copy(p).addScaledVector(dir, 0.02);
      flap.castShadow = true;
      g.add(flap);
    }
  }

  // ---- 迷子札：首の前の 左がわ、帯の 下のふちに ぶらさげる ----
  {
    const i = Math.round((((-Math.PI / 2 + 0.55 - aKnot) / (Math.PI * 2)) % 1 + 1) % 1 * NA) % NA;
    const { U } = frameAt(midP, midN, i, true);
    const p = P[i * NR].clone().addScaledVector(U, 0.003);
    const o = new THREE.Group();
    o.position.copy(p);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(V(0, 0, 0), U, V(0, 1, 0)));
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.0034, 0.0009, 6, 12), m.ring);
    r.position.y = -0.003;
    const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0022, 18), m.tag);
    tag.rotation.x = Math.PI / 2;
    tag.scale.set(1, 1, 1.15);
    tag.position.y = -0.0135;
    o.add(r, tag);
    g.add(o);
  }
  return g;
}

/** 帯の点（ni 列 × nj 行）を少し ならす。列の はし（つぎ目）は 両はしを そろえる */
function smooth2(P, ni, nj) {
  for (let k = 0; k < 2; k++) {
    const Q = P.map((p) => p.clone());
    for (let i = 0; i < ni; i++) {
      const ia = i === 0 ? ni - 2 : i - 1, ib = i === ni - 1 ? 1 : i + 1;
      for (let j = 0; j < nj; j++) {
        P[i * nj + j].copy(Q[i * nj + j]).multiplyScalar(0.5).addScaledVector(Q[ia * nj + j], 0.25).addScaledVector(Q[ib * nj + j], 0.25);
      }
    }
  }
}
