import * as THREE from 'three';
import { MOMENT_MAP, PLAIN, starsFor } from './moments.js';
import { clamp } from './util.js';

// 写真は 4:3。画面上の「写る範囲」枠と同じ比率
export const PHOTO_ASPECT = 4 / 3;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ray = new THREE.Raycaster();
const frustum = new THREE.Frustum();

/** 画面（NDC）のうち写真に写る範囲 */
export function cropLimits(aspect) {
  if (aspect > PHOTO_ASPECT) return { lx: PHOTO_ASPECT / aspect, ly: 1 };
  return { lx: 1, ly: aspect / PHOTO_ASPECT };
}

function proj(p, cam, L) {
  _v.copy(p).project(cam);
  const x = _v.x / L.lx, y = _v.y / L.ly;
  return { x, y, in: _v.z < 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1 };
}

function sizeFactor(h) {
  if (h < 0.05) return 0.12;
  if (h < 0.1) return 0.4;
  if (h < 0.18) return 0.72;
  if (h < 0.85) return 1;
  return 0.85;
}

function occluded(game, from, to) {
  const dir = _v.subVectors(to, from);
  const len = dir.length();
  ray.set(from, dir.normalize());
  ray.far = len - 0.15;
  const hits = ray.intersectObjects([game.world.group, game.room.group], true);
  return hits.some((h) => {
    const o = h.object;
    if (!o.visible || o.isPoints || o.isSprite || o.userData.noOcclude) return false;
    const m = o.material;
    return m && !m.transparent;
  });
}

/**
 * 今の画面を採点する。
 * 瞬間（犬の状態・倒れている物・割れたマグなど）× 写り方（大きさ・中央・顔の向き・ブレ・隠れ）
 */
export function evaluateShot(game) {
  const cam = game.camera;
  cam.updateMatrixWorld();
  const L = cropLimits(cam.aspect);
  const { dog, world, fx } = game;
  const d = dog.rig.dims;

  // ---- 犬の写り ----
  const head = dog.headWorld.clone();
  const top = head.clone().setY(head.y + d.headR * 1.05);
  const body = dog.pos.clone().setY(Math.max(0.12, d.bodyY * 0.85));
  const feet = dog.pos.clone().setY(0.02);
  const tail = dog.pos.clone().addScaledVector(dog.fwd, -d.bodyLen * 0.6).setY(d.bodyY);
  const pr = [head, body, tail, feet, top].map((p) => proj(p, cam, L));
  const inFrac = pr.filter((p) => p.in).length / pr.length;
  let occ = 0;
  if (inFrac > 0) {
    if (occluded(game, cam.position, head)) occ++;
    if (occluded(game, cam.position, body)) occ++;
  }
  const visible = inFrac * (1 - occ * 0.4);
  const ys = pr.map((p) => p.y);
  const xs = pr.map((p) => p.x);
  const hFrac = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 * 0.8);
  const centerF = 1 - 0.3 * Math.min(1, Math.hypot(pr[1].x, pr[1].y));
  const sizeF = sizeFactor(hFrac);
  const dogF = visible >= 0.6 ? sizeF * centerF : visible * 0.6 * sizeF;
  _v.subVectors(cam.position, head).normalize();
  const faceDot = dog.headDir.dot(_v);
  const faceQ = clamp((faceDot - 0.15) / 0.6, 0, 1);
  const faceOK = faceDot > 0.3 && occ === 0 && pr[0].in;

  // ---- ブレ ----
  const av = game.camRig.angVel;
  const blurF = av < 0.25 ? 1 : av < 0.9 ? 0.75 : 0.5;

  // ---- 散らかり（写っている散乱物）----
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_m);
  let mess = 0;
  for (const pool of [fx.fluff, fx.bits]) {
    for (const it of pool.items) if (!it.dead && it.landed && frustum.containsPoint(it.pos)) mess += 0.35;
  }
  for (const t of world.topplers) if (t.state === 'down' && frustum.containsPoint(t.pos)) mess += 2;
  const rib = world.tissue.ribbons;
  for (const r of rib) for (let i = 0; i < r.points.length; i += 8) if (frustum.containsPoint(r.points[i])) mess += 0.5;
  for (const dcl of fx.decals) if (frustum.containsPoint(dcl.position)) mess += 1.5;

  // ---- 瞬間の候補 ----
  const cands = [];
  const bm = game.brain.moment;
  if (bm) cands.push({ id: bm.id, q: bm.q, subject: 'dog', extra: bm.extra });
  if (world.isInBed(dog.pos.x, dog.pos.z, 0.1)) {
    const n = world.treasures().length;
    if (n >= 2) cands.push({ id: 'treasure', q: Math.min(1, n / 3), subject: 'dog' });
  }
  const now = world.time;
  for (const t of world.topplers) {
    const active = t.state === 'falling' || (t.downAt && now - t.downAt < 0.45);
    if (!active) continue;
    const mid = t.pos.clone().addScaledVector(t.dir, t.h * 0.4).setY(t.h * 0.35);
    cands.push({ id: 'topple', q: clamp(t.h / 1.2, 0.55, 1), subject: mid, size: t.h });
  }
  // 段ボールが短い間に3つ以上倒れていればドミノ
  const boxes = world.topplers.filter((t) => t.kind === 'box' && (t.state === 'falling' || (t.downAt && now - t.downAt < 1.4)));
  if (boxes.length >= 3) {
    const c = new THREE.Vector3();
    boxes.forEach((t) => c.add(t.pos));
    c.multiplyScalar(1 / boxes.length).setY(0.25);
    cands.push({ id: 'domino', q: Math.min(1, boxes.length / 5), subject: c, size: 1.4 });
  }
  if (world.mug.mode === 'air') cands.push({ id: 'mug', q: 1, subject: world.mug.pos.clone(), size: 0.5 });
  if (game.lastBurst && now - game.lastBurst.t < 1.1) {
    cands.push({ id: 'fluff', q: 1 - ((now - game.lastBurst.t) / 1.1) * 0.5, subject: game.lastBurst.pos.clone(), size: 0.8 });
  }

  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const scoreOf = (c) => {
    const def = MOMENT_MAP[c.id];
    if (!def) return 0;
    let F;
    if (c.subject === 'dog') {
      F = dogF;
      // 顔が写っているほど良い写真（後ろ姿が主役の瞬間だけ逆）
      if (def.face) F *= faceOK ? 0.55 + 0.45 * faceQ : 0.22;
      else if (def.back) F *= 1.05 - 0.35 * faceQ;
      else F *= 0.62 + 0.38 * faceQ;
      if (c.extra) F *= proj(c.extra, cam, L).in ? 1.1 : 0.8;
    } else {
      const p = proj(c.subject, cam, L);
      if (!p.in) F = 0.04;
      else {
        const dist = cam.position.distanceTo(c.subject);
        const sz = c.size / (2 * dist * Math.tan(vfov / 2)) / L.ly;
        F = (1 - 0.3 * Math.min(1, Math.hypot(p.x, p.y))) * sizeFactor(sz);
        if (dogF > 0.3) F *= 1.15;
      }
    }
    let q = clamp(c.q, 0, 1);
    if (c.id === 'innocent' || c.id === 'caught') q *= 0.55 + 0.45 * Math.min(1, mess / 12);
    return def.base * (0.35 + 0.65 * q) * F * blurF;
  };

  let best = null, bestScore = -1;
  for (const c of cands) {
    const s = scoreOf(c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  // ふつうの一枚
  const plainScore = PLAIN.base * dogF * (0.6 + 0.4 * faceQ) * blurF;
  let def = best ? MOMENT_MAP[best.id] : PLAIN;
  let score = bestScore;
  if (!best || bestScore < plainScore) { def = PLAIN; score = plainScore; best = null; }
  const ratio = score / def.base;
  const miss = score < 12;
  return {
    id: def.id,
    name: miss ? (visible < 0.2 ? 'うちの子がいない…' : 'ぼんやり') : def.name,
    caption: def.caption,
    stars: miss ? 0 : def === PLAIN ? Math.min(2, starsFor(ratio)) : starsFor(ratio),
    score: Math.round(score),
    ratio,
    face: faceOK,
    blurred: av >= 0.25,
    visible,
    mess: Math.round(mess),
    isMoment: def !== PLAIN && !miss,
  };
}
