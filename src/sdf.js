import * as THREE from 'three';

// ------------------------------------------------------------
// 距離関数（SDF）で形を作って、なめらかな1枚の面にする。
// 球を重ねただけだと つなぎ目に「くびれ」や「段」ができるので、
// やわらかく溶けあうように足し合わせ（smooth min）、面は Surface Nets で作る。
// ------------------------------------------------------------

/** 楕円体（近似の距離） */
export function sdEll(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  if (k0 < 1e-7) return -Math.min(rx, ry, rz);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return (k0 * (k0 - 1)) / k1;
}

/** 太さの変わる円柱（両はしは球）。a → b、半径 r1 → r2 */
export function sdCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-10) return Math.hypot(px - ax, py - ay, pz - az) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  if (a2 <= 1e-10) {
    // 片方の球がもう片方を飲みこんでいる
    return r1 > r2 ? Math.hypot(px - ax, py - ay, pz - az) - r1 : Math.hypot(px - bx, py - by, pz - bz) - r2;
  }
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** やわらかい足し算（k: とけあう幅） */
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}
/** やわらかい引き算用 */
export function smax(a, b, k) { return -smin(-a, -b, k); }

// 3D の値ノイズ（0..1）
function hash(x, y, z, s) {
  let h = (s | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let u = x - xi, v = y - yi, w = z - zi;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
  const c000 = hash(xi, yi, zi, s), c100 = hash(xi + 1, yi, zi, s), c010 = hash(xi, yi + 1, zi, s), c110 = hash(xi + 1, yi + 1, zi, s);
  const c001 = hash(xi, yi, zi + 1, s), c101 = hash(xi + 1, yi, zi + 1, s), c011 = hash(xi, yi + 1, zi + 1, s), c111 = hash(xi + 1, yi + 1, zi + 1, s);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u, x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/**
 * 形の組み立て。add(prim, k) でやわらかく足し、cut(prim, k) でやわらかく削る。
 * prim は (x, y, z) => 距離。bound: [cx, cy, cz, r]（遠い部品は計算を省く）
 */
export class Shape {
  constructor() { this.ops = []; this.disp = null; this.dispMax = 0; }
  add(f, k = 0, bound = null) { this.ops.push({ f, k, sub: false, bound }); return this; }
  cut(f, k = 0, bound = null) { this.ops.push({ f, k, sub: true, bound }); return this; }
  ell(cx, cy, cz, rx, ry, rz, k = 0, rot = null) {
    const f = rot ? rotEll(cx, cy, cz, rx, ry, rz, rot) : (x, y, z) => sdEll(x - cx, y - cy, z - cz, rx, ry, rz);
    return this.add(f, k, [cx, cy, cz, Math.max(rx, ry, rz)]);
  }
  /** 向きを軸で決めた楕円体（ax, ay, az: たがいに直交する単位ベクトル） */
  ellAxes(c, rx, ry, rz, ax, ay, az, k = 0) {
    const f = (x, y, z) => {
      const px = x - c.x, py = y - c.y, pz = z - c.z;
      return sdEll(px * ax.x + py * ax.y + pz * ax.z, px * ay.x + py * ay.y + pz * ay.z, px * az.x + py * az.y + pz * az.z, rx, ry, rz);
    };
    return this.add(f, k, [c.x, c.y, c.z, Math.max(rx, ry, rz)]);
  }
  cone(a, b, r1, r2, k = 0) {
    const f = (x, y, z) => sdCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r1, r2);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return this.add(f, k, [...c, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2 + Math.max(r1, r2)]);
  }
  /** 点列を なめらかな管でつなぐ。pts: [[x, y, z, r], ...] */
  chain(pts, k = 0, kIn = 0) {
    const s = new Shape();
    for (let i = 0; i < pts.length - 1; i++) s.cone(pts[i], pts[i + 1], pts[i][3], pts[i + 1][3], kIn);
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) + p[3]);
    return this.add((x, y, z) => s.base(x, y, z), k, [cx, cy, cz, r]);
  }
  /** 面を法線方向にずらす（もこもこ）。fn(x, y, z) → ずらす量（外がプラス）。max: 最大量 */
  displace(fn, max) { this.disp = fn; this.dispMax = max; return this; }
  /** ずらす前の形 */
  base(x, y, z) {
    let d = 1e9;
    for (let i = 0; i < this.ops.length; i++) {
      const o = this.ops[i];
      if (o.bound && d < 1e8) {
        // 部品の外接球より十分遠ければ、足しても削っても変わらない
        const b = o.bound;
        const lb = Math.hypot(x - b[0], y - b[1], z - b[2]) - b[3];
        if (lb > (o.sub ? 0 : d) + o.k) continue;
      }
      const v = o.f(x, y, z);
      if (d >= 1e8) d = o.sub ? 1e9 : v;
      else d = o.sub ? smax(d, -v, o.k) : smin(d, v, o.k);
    }
    return d;
  }
  eval(x, y, z) {
    const d = this.base(x, y, z);
    if (!this.disp || Math.abs(d) > this.dispMax * 2.5) return d;
    return d - this.disp(x, y, z);
  }
  /** 中心 o から方向 dir へ進んで、面にあたる点（displaced: もこもこ後の面で） */
  surface(o, dir, maxT = 1, displaced = false) {
    const d = dir.clone().normalize();
    let lo = 0, hi = maxT;
    const at = displaced ? (t) => this.eval(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) : (t) => this.base(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    // 外に出るまで進んでから二分探索
    const N = 48;
    for (let i = 1; i <= N; i++) {
      const t = (i / N) * maxT;
      if (at(t) > 0) { hi = t; lo = ((i - 1) / N) * maxT; break; }
    }
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (at(m) > 0) hi = m; else lo = m;
    }
    return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
  }
  normal(p, e = 1e-4, base = true) {
    const f = base ? (x, y, z) => this.base(x, y, z) : (x, y, z) => this.eval(x, y, z);
    return new THREE.Vector3(
      f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z),
      f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z),
      f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e),
    ).normalize();
  }
}

const _m = new THREE.Matrix4();
function rotEll(cx, cy, cz, rx, ry, rz, rot) {
  // rot: [ax, ay, az]（オイラー角）。点を逆回転してから楕円体の距離
  _m.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])).invert();
  const e = _m.elements.slice();
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    return sdEll(e[0] * px + e[4] * py + e[8] * pz, e[1] * px + e[5] * py + e[9] * pz, e[2] * px + e[6] * py + e[10] * pz, rx, ry, rz);
  };
}

const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * 形 → なめらかなメッシュ（Surface Nets）。
 * min/max: 範囲、h: 格子の細かさ。頂点は面の上に寄せ、法線は形の傾きから
 */
export function meshShape(shape, min, max, h) {
  const f = (x, y, z) => shape.eval(x, y, z);
  const nx = Math.max(2, Math.ceil((max[0] - min[0]) / h));
  const ny = Math.max(2, Math.ceil((max[1] - min[1]) / h));
  const nz = Math.max(2, Math.ceil((max[2] - min[2]) / h));
  const sx = nx + 1, sy = ny + 1, sxy = sx * sy;
  const val = new Float32Array(sx * sy * (nz + 1));
  // まず1つおきの粗い格子で測り、面から遠い所は細かく測らない（符号だけわかればよい）
  for (let k = 0; k <= nz; k += 2) {
    const z = min[2] + k * h;
    for (let j = 0; j <= ny; j += 2) {
      const y = min[1] + j * h;
      for (let i = 0; i <= nx; i += 2) val[i + sx * j + sxy * k] = f(min[0] + i * h, y, z);
    }
  }
  const far = h * 5.5;
  for (let k = 0; k <= nz; k++) {
    const z = min[2] + k * h;
    const k0 = k & 1 ? k - 1 : k, k1 = k & 1 && k + 1 <= nz ? k + 1 : k0;
    for (let j = 0; j <= ny; j++) {
      const y = min[1] + j * h;
      const j0 = j & 1 ? j - 1 : j, j1 = j & 1 && j + 1 <= ny ? j + 1 : j0;
      for (let i = 0; i <= nx; i++) {
        if (!(i & 1) && !(j & 1) && !(k & 1)) continue;
        const i0 = i & 1 ? i - 1 : i, i1 = i & 1 && i + 1 <= nx ? i + 1 : i0;
        // まわりの粗い点が、みな同じ側で十分遠いなら、その値で代用
        const a0 = sx * j0 + sxy * k0, a1 = sx * j1 + sxy * k0, a2 = sx * j0 + sxy * k1, a3 = sx * j1 + sxy * k1;
        const w0 = val[i0 + a0], w1 = val[i1 + a0], w2 = val[i0 + a1], w3 = val[i1 + a1];
        const w4 = val[i0 + a2], w5 = val[i1 + a2], w6 = val[i0 + a3], w7 = val[i1 + a3];
        const lo = Math.min(w0, w1, w2, w3, w4, w5, w6, w7), hi = Math.max(w0, w1, w2, w3, w4, w5, w6, w7);
        const p = i + sx * j + sxy * k;
        if (lo > far) val[p] = lo;
        else if (hi < -far) val[p] = hi;
        else val[p] = f(min[0] + i * h, y, z);
      }
    }
  }
  // 各セルに頂点を1つ（辺の交点の平均）
  const cells = new Int32Array(nx * ny * nz).fill(-1);
  const P = [];
  const co = [0, 1, sx, sx + 1, sxy, sxy + 1, sxy + sx, sxy + sx + 1];
  const v = new Float32Array(8);
  // セルの中の、符号が変わる辺の交点の平均
  const cellVertex = (i, j, k) => {
    let ax = 0, ay = 0, az = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const ea = EDGES[e][0], eb = EDGES[e][1];
      const va = v[ea], vb = v[eb];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      ax += (ea & 1) + ((eb & 1) - (ea & 1)) * t;
      ay += ((ea >> 1) & 1) + (((eb >> 1) & 1) - ((ea >> 1) & 1)) * t;
      az += ((ea >> 2) & 1) + (((eb >> 2) & 1) - ((ea >> 2) & 1)) * t;
      cnt++;
    }
    cells[i + nx * (j + ny * k)] = P.length / 3;
    P.push(min[0] + (i + ax / cnt) * h, min[1] + (j + ay / cnt) * h, min[2] + (k + az / cnt) * h);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b = i + sx * j + sxy * k;
        let mask = 0;
        for (let c = 0; c < 8; c++) { v[c] = val[b + co[c]]; if (v[c] < 0) mask |= 1 << c; }
        if (mask !== 0 && mask !== 255) cellVertex(i, j, k);
      }
    }
  }
  // 符号が変わる格子の辺ごとに、まわりの4セルで四角形
  const I = [];
  const cellAt = (i, j, k) => cells[i + nx * (j + ny * k)];
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; I.push(a, b, c, a, c, d); };
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const p = i + sx * j + sxy * k;
        const in0 = val[p] < 0;
        if (i < nx && j > 0 && k > 0 && j < ny && k < nz && in0 !== (val[p + 1] < 0)) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k));
        }
        if (j < ny && i > 0 && k > 0 && i < nx && k < nz && in0 !== (val[p + sx] < 0)) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1));
        }
        if (k < nz && i > 0 && j > 0 && i < nx && j < ny && in0 !== (val[p + sxy] < 0)) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
      }
    }
  }
  // 法線：格子の値の傾きを、頂点の位置でなめらかに補間（面の近くは細かく測ってある）
  const count = P.length / 3;
  const pos = new Float32Array(P);
  const nor = new Float32Array(P.length);
  const gAt = (i, j, k, out) => {
    const ci = Math.min(Math.max(i, 1), nx - 1), cj = Math.min(Math.max(j, 1), ny - 1), ck = Math.min(Math.max(k, 1), nz - 1);
    const p = ci + sx * cj + sxy * ck;
    out[0] += val[p + 1] - val[p - 1];
    out[1] += val[p + sx] - val[p - sx];
    out[2] += val[p + sxy] - val[p - sxy];
  };
  const g = [0, 0, 0], gc = [0, 0, 0];
  for (let q = 0; q < count; q++) {
    const fx = (pos[q * 3] - min[0]) / h, fy = (pos[q * 3 + 1] - min[1]) / h, fz = (pos[q * 3 + 2] - min[2]) / h;
    const i = Math.min(nx - 1, Math.floor(fx)), j = Math.min(ny - 1, Math.floor(fy)), k = Math.min(nz - 1, Math.floor(fz));
    const tx = fx - i, ty = fy - j, tz = fz - k;
    g[0] = g[1] = g[2] = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      gc[0] = gc[1] = gc[2] = 0;
      gAt(i + dx, j + dy, k + dz, gc);
      g[0] += gc[0] * w; g[1] += gc[1] * w; g[2] += gc[2] * w;
    }
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    nor[q * 3] = g[0] / l; nor[q * 3 + 1] = g[1] / l; nor[q * 3 + 2] = g[2] / l;
  }
  // 三角形の向きを法線にそろえ、四角形は短い対角線で割る
  for (let t = 0; t < I.length; t += 6) {
    const a = I[t], b = I[t + 1], c = I[t + 2], d = I[t + 5];
    const dAC = dist2(pos, a, c), dBD = dist2(pos, b, d);
    if (dBD < dAC) { I[t] = b; I[t + 1] = c; I[t + 2] = d; I[t + 3] = b; I[t + 4] = d; I[t + 5] = a; }
    for (const s of [t, t + 3]) {
      const i0 = I[s], i1 = I[s + 1], i2 = I[s + 2];
      const ux = pos[i1 * 3] - pos[i0 * 3], uy = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], uz = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const vx = pos[i2 * 3] - pos[i0 * 3], vy = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], vz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const nx2 = nor[i0 * 3] + nor[i1 * 3] + nor[i2 * 3], ny2 = nor[i0 * 3 + 1] + nor[i1 * 3 + 1] + nor[i2 * 3 + 1], nz2 = nor[i0 * 3 + 2] + nor[i1 * 3 + 2] + nor[i2 * 3 + 2];
      if (cx * nx2 + cy * ny2 + cz * nz2 < 0) { I[s + 1] = i2; I[s + 2] = i1; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P.length).fill(1), 3));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
function dist2(p, a, b) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
