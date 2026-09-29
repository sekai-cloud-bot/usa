// 町の当たり判定：軸に沿った箱（建物・塀・木箱・ベンチ）と円柱（電柱・幹）。
// 箱の上面には乗れる（塀の上を歩ける）。
const CELL = 6;

export class Collision {
  constructor() {
    this.boxes = [];
    this.circles = [];
    this.grid = new Map();
    this.cgrid = new Map();
    this.terrains = [];   // 起伏のある地面（川の土手など）{ x0, x1, z0, z1, fn(x, z) }
  }

  /** 起伏のある地面。範囲の中では地面の高さを fn(x, z) にする（範囲外は 0） */
  addTerrain(x0, x1, z0, z1, fn) {
    const t = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), fn };
    this.terrains.push(t);
    return t;
  }
  /** 箱をのぞいた、地面そのものの高さ */
  baseAt(x, z) {
    for (const t of this.terrains) {
      if (x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) return t.fn(x, z);
    }
    return 0;
  }

  _cells(x0, x1, z0, z1, fn) {
    const a = Math.floor(x0 / CELL), b = Math.floor(x1 / CELL), c = Math.floor(z0 / CELL), d = Math.floor(z1 / CELL);
    for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) fn(i + ',' + j);
  }

  /** 箱：x0..x1, z0..z1, 下端 y0, 上端 y1 */
  addBox(x0, x1, z0, z1, y0, y1, tag = null) {
    const b = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1, tag, on: true };
    this.boxes.push(b);
    this._cells(b.x0, b.x1, b.z0, b.z1, (k) => {
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(b);
    });
    return b;
  }
  /** 中心・幅・奥行き・高さ（下端0）で箱 */
  addBoxC(cx, cz, w, d, h, y0 = 0, tag = null) {
    return this.addBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y0, y0 + h, tag);
  }
  addCircle(x, z, r, y0 = 0, y1 = 10, tag = null) {
    const c = { x, z, r, y0, y1, tag, on: true };
    this.circles.push(c);
    this._cells(x - r, x + r, z - r, z + r, (k) => {
      if (!this.cgrid.has(k)) this.cgrid.set(k, []);
      this.cgrid.get(k).push(c);
    });
    return c;
  }

  near(x, z, r = 1) {
    const set = new Set();
    this._cells(x - r, x + r, z - r, z + r, (k) => { const l = this.grid.get(k); if (l) for (const b of l) set.add(b); });
    return set;
  }
  nearCircles(x, z, r = 1) {
    const set = new Set();
    this._cells(x - r, x + r, z - r, z + r, (k) => { const l = this.cgrid.get(k); if (l) for (const b of l) set.add(b); });
    return set;
  }

  /** 足元の高さ（乗れる面の一番上） */
  groundAt(x, z, r, footY, step = 0.2) {
    let g = this.terrains.length ? this.baseAt(x, z) : 0;
    this.support = null;
    const rr = r * 0.55;
    for (const b of this.near(x, z, r)) {
      if (!b.on) continue;
      if (x + rr < b.x0 || x - rr > b.x1 || z + rr < b.z0 || z - rr > b.z1) continue;
      if (b.y1 <= footY + step && b.y1 > g) { g = b.y1; this.support = b; }
    }
    return g;
  }

  /** 点が箱の中か（天井や屋根の判定用） */
  inside(x, y, z, tag) {
    for (const b of this.near(x, z, 0.1)) {
      if (!b.on || (tag && b.tag !== tag)) continue;
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) return b;
    }
    return null;
  }

  /** 水平方向の押し戻し。p: {x,y,z}, 犬の半径 r, 高さ h */
  resolve(p, r, h, step = 0.2) {
    let hit = false;
    for (const b of this.near(p.x, p.z, r + 0.5)) {
      if (!b.on) continue;
      if (b.y1 <= p.y + step || b.y0 >= p.y + h) continue;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1));
      const cz = Math.max(b.z0, Math.min(p.z, b.z1));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // 箱の中に入ってしまった：一番近い面へ
        const ex = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
        const i = ex.indexOf(Math.min(...ex));
        if (i === 0) p.x = b.x0 - r; else if (i === 1) p.x = b.x1 + r; else if (i === 2) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
    for (const c of this.nearCircles(p.x, p.z, r + 0.5)) {
      if (!c.on || c.y1 <= p.y + step || c.y0 >= p.y + h) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = r + c.r;
      if (d < min && d > 1e-6) {
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
        hit = true;
      }
    }
    return hit;
  }

  /** 線分と箱の交差（カメラの壁よけ用）。一番近い距離を返す */
  rayDist(ox, oy, oz, dx, dy, dz, maxD) {
    let best = maxD;
    const ex = ox + dx * maxD, ey = oy + dy * maxD, ez = oz + dz * maxD;
    const mnx = Math.min(ox, ex), mxx = Math.max(ox, ex), mnz = Math.min(oz, ez), mxz = Math.max(oz, ez);
    const seen = new Set();
    this._cells(mnx, mxx, mnz, mxz, (k) => {
      const l = this.grid.get(k);
      if (!l) return;
      for (const b of l) {
        if (seen.has(b) || !b.on || b.tag === 'thin') continue;
        seen.add(b);
        if (b.x1 < mnx || b.x0 > mxx || b.z1 < mnz || b.z0 > mxz) continue;
        let t0 = 0, t1 = best;
        const slab = (o, d, lo, hi) => {
          if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
          let a = (lo - o) / d, c = (hi - o) / d;
          if (a > c) { const s = a; a = c; c = s; }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, c);
          return t0 <= t1;
        };
        if (slab(ox, dx, b.x0, b.x1) && slab(oy, dy, b.y0, b.y1) && slab(oz, dz, b.z0, b.z1)) {
          if (t0 < best) best = t0;
        }
      }
    });
    return best;
  }
}
