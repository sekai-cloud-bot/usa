import * as THREE from 'three';
import { box, cyl, ball, mat, LIGHTS, TEX, canvasTex, signTex } from './build.js';
import { LM, makeHouse, bench, streetLamp, parkLamp, woodFence, blockWall, crate, guardrail, pottedPlant, bicycle } from './props.js';
import { tree, hedge, bush, grassField, reeds, waterMaterial } from './nature.js';
import { gmat, worldUV, ground, slab, paint, signBoard, cityBlock } from './town.js';
import { buildDog, breedParams } from '../dogModel.js';
import { mulberry32, clamp, lerp, smooth, mergeParts, mat as M4 } from '../util.js';

// ------------------------------------------------------------
// ひだまり川：町より一段低い川の谷。北向きに z が小さくなる
//   土手の上の遊歩道（y=0）→ 草の斜面 → 河川敷（y=-2.6）→ 小石の岸 → 浅瀬 → 深い所（入れない）→ 向こう岸
// ------------------------------------------------------------
export const RIVER = {
  x0: -62, x1: 206,
  walkS: -106, top: -110, slope: -114, flat: -120, beach: -132, shallow: -135, deep: -136.8, deep2: -144.4,
  farBeach: -146, farFlat: -149, farSlope: -156, farTop: -162,
  flatY: -2.6, waterY: -3.0, shallowY: -3.25, bedY: -3.8,
};

export function riverY(x, z) {
  const R = RIVER;
  if (z >= R.slope) return 0;
  if (z >= R.flat) return R.flatY * smooth((R.slope - z) / (R.slope - R.flat));
  if (z >= R.beach) return R.flatY;
  if (z >= R.shallow) return lerp(R.flatY, R.shallowY, (R.beach - z) / (R.beach - R.shallow));
  if (z >= R.deep) return R.shallowY;
  if (z >= R.deep2) return R.bedY;
  if (z >= R.farBeach) return R.shallowY;
  if (z >= R.farFlat) return lerp(R.shallowY, R.flatY, (R.farBeach - z) / (R.farBeach - R.farFlat));
  if (z >= R.farSlope) return R.flatY;
  if (z >= R.farTop) return R.flatY * smooth((z - R.farTop) / (R.farSlope - R.farTop));
  return 0;
}

/** 起伏のある地面（格子）。zs は南から北への z の刻み */
function terrain(g, x0, x1, dx, zs, fn, material, colorFn, uvScale = 5, cast = false) {
  const cols = Math.ceil((x1 - x0) / dx);
  const pos = [], uv = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = x0 + i * dx, z = zs[j];
      const y = fn(x, z);
      pos.push(x, y, z);
      uv.push(x / uvScale, -z / uvScale);
      colorFn(x, z, y, c);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, cc = a + cols + 1, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.castShadow = cast;
  m.userData.noBake = true;
  g.add(m);
  return m;
}

/** 箱（テクスチャを実寸で貼る） */
function tbox(g, x0, x1, y0, y1, z0, z1, material, scale = 2, cast = true) {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  worldUV(geo, scale);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function stoneLantern(g, x, y, z, s = 1) {
  const stone = mat(0xb2aca1, { rough: 0.95 });
  cyl(g, 0.26 * s, 0.3 * s, 0.18 * s, x, y, z, stone, 8);
  cyl(g, 0.08 * s, 0.1 * s, 0.7 * s, x, y + 0.18 * s, z, stone, 8);
  box(g, 0.42 * s, 0.1 * s, 0.42 * s, x, y + 0.88 * s, z, stone);
  box(g, 0.34 * s, 0.32 * s, 0.34 * s, x, y + 0.98 * s, z, stone);
  const fire = box(g, 0.2 * s, 0.18 * s, 0.36 * s, x, y + 1.05 * s, z, LM.lantern, { cast: false });
  fire.userData.lantern = true;
  const roof = cyl(g, 0.04 * s, 0.4 * s, 0.24 * s, x, y + 1.3 * s, z, stone, 4);
  roof.rotation.y = Math.PI / 4;
  ball(g, 0.07 * s, x, y + 1.58 * s, z, stone, { seg: 8, seg2: 6 });
}

function torii(g, x, y, z, span = 3.2, h = 3.4, ry = 0, color = 0xc4452f) {
  const t = new THREE.Group();
  const red = mat(color, { rough: 0.55 });
  const black = mat(0x2a2522, { rough: 0.6 });
  for (const s of [-1, 1]) {
    cyl(t, 0.14, 0.16, h, 0, 0, s * span / 2, red, 12);
    cyl(t, 0.18, 0.18, 0.3, 0, 0, s * span / 2, black, 12);
  }
  box(t, 0.26, 0.16, span + 0.3, 0, h * 0.78, 0, red);      // 貫
  const kasagi = box(t, 0.34, 0.2, span + 1.3, 0, h, 0, black, { round: 0.04 });
  kasagi.scale.z = 1;
  box(t, 0.3, 0.16, span + 1.0, 0, h - 0.18, 0, red);
  box(t, 0.12, h * 0.2, 0.28, 0, h * 0.8, 0, red);          // 額束
  t.position.set(x, y, z);
  t.rotation.y = ry;
  g.add(t);
  return t;
}

/** しめ縄（たるんだ太い縄と、ぎざぎざの紙垂） */
function shimenawa(g, a, b, sag = 0.25, r = 0.07) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag, lerp(a.z, b.z, t)));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 8), mat(0xd8c48c, { rough: 0.95 }));
  m.castShadow = true;
  g.add(m);
  const paper = mat(0xfbfaf6, { rough: 0.8 });
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag, z = lerp(a.z, b.z, t);
    for (let k = 0; k < 3; k++) box(g, 0.02, 0.12, 0.1, x, y - 0.18 - k * 0.1, z + (k % 2 ? 0.03 : -0.03), paper, { cast: false });
  }
}

// ------------------------------------------------------------
// 川
// ------------------------------------------------------------
export function buildRiver(ctx) {
  const { scene, col, D, pools, anchors, dynamic, day, M, house, petalsEmit } = ctx;
  const R = RIVER;
  const g = D('river');
  const far = D('farbank');
  col.addTerrain(-140, 280, -166, R.top, riverY);

  // 谷の地面（草の斜面・河川敷・川底）
  const zs = [R.top, R.slope, -115, -116, -117, -118, -119, R.flat, -123, -126, -129, R.beach, -133.5, R.shallow, R.deep, -139, -142, R.deep2, R.farBeach, -147.5, R.farFlat, -152.5, R.farSlope, -157, -158, -159, -160, -161, R.farTop, -166];
  const grassM = gmat(TEX.grass, 0xffffff, 1, { vertexColors: true });
  terrain(g, -140, 280, 5, zs, (x, z) => riverY(x, z) + ((z < R.flat && z > R.beach) || (z < R.farFlat && z > R.farSlope) ? Math.sin(x * 0.21) * Math.cos(z * 0.33) * 0.06 : 0), grassM, (x, z, y, c) => {
    if (z < R.beach && z > R.farFlat) {
      // 水ぎわ：ぬれた土と小石
      const k = clamp((y - R.bedY) / (R.flatY - R.bedY), 0, 1);
      c.setRGB(0.42 + 0.2 * k, 0.4 + 0.18 * k, 0.33 + 0.12 * k);
    } else if (y < -0.1) c.setRGB(0.92, 1.0, 0.88);
    else c.setRGB(1, 1, 1);
  });
  // 小石の岸
  const pebM = gmat(TEX.sand, 0x9c9384, 0.95);
  terrain(g, -140, 280, 5, [R.beach + 0.3, -133, -134, R.shallow + 0.2], (x, z) => riverY(x, z) + 0.03, pebM, (x, z, y, c) => c.setRGB(1, 1, 1), 2.5);
  terrain(g, -140, 280, 5, [R.farBeach - 0.2, -147, -148, R.farFlat - 0.3], (x, z) => riverY(x, z) + 0.03, pebM, (x, z, y, c) => c.setRGB(1, 1, 1), 2.5);
  // 川底と水面
  const bedM = mat(0x3b4a42, { rough: 1 });
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(420, 16), bedM);
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(70, R.bedY + 0.02, -140.2);
  g.add(bed);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(420, 12.6, 1, 1), waterMaterial(day, { deep: 0x1d3a3e, shallow: 0x55786c, flow: 0.45, scale: 0.9 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(70, R.waterY, -140.2);
  water.renderOrder = 1;
  scene.add(water);
  dynamic.push({ update: (dt) => { water.material.uniforms.uTime.value += dt; water.material.uniforms.uLamp.value = LIGHTS.factor; } });
  anchors.river = water;
  // 深い所へは入れない（カメラは通す）
  col.addBox(R.x0, R.x1, R.deep2, R.deep, -6, 3, 'thin');
  col.addBox(R.x0 - 1, R.x0, -166, R.walkS, -6, 12, 'thin');
  col.addBox(R.x1, R.x1 + 1, -166, R.walkS, -6, 12, 'thin');
  // 草（斜面と河川敷）と葦
  grassField(g, [[R.x0, R.slope - 0.3, R.x1, R.flat], [R.x0, R.flat, R.x1, R.beach + 0.5]], 16000, (x, z) => (z < -120.3 && z > -122.8) || (x > 12 && x < 36 && z < -121 && z > -131), 71, 0.01, riverY);
  reeds(g, [[R.x0, R.beach + 0.8, R.x1, R.shallow + 0.4], [R.x0, R.farBeach - 0.3, R.x1, R.farFlat - 0.2]], 2600, riverY, 5);

  // 土手の上の遊歩道と、河川敷の道
  ground(g, R.x0, 79, R.slope, R.top, M.lane, 5, 0.012);
  ground(g, 95, R.x1, R.slope, R.top, M.lane, 5, 0.012);
  ground(g, R.x0, R.x1, R.top, R.walkS, gmat(TEX.grass, 0xd9e8c4, 1), 5, 0.006);
  paint(g, R.x0, R.slope + 0.25, 79, R.slope + 0.25, 0.1, 0xe8e4da);
  paint(g, 95, R.slope + 0.25, R.x1, R.slope + 0.25, 0.1, 0xe8e4da);
  ground(g, R.x0, R.x1, -122.6, -120.4, gmat(TEX.asphalt, 0xc9c4bc, 0.92), 5, R.flatY + 0.012);

  // 遊歩道の南は塀（家の庭へは入れない）。公園と駅前からの路地だけあいている
  const wallSeg = (x0, x1) => {
    blockWall(g, x0, x1, R.walkS - 0.08, R.walkS + 0.08, 1.3);
    col.addBox(x0, x1, R.walkS - 0.1, R.walkS + 0.1, 0, 1.3, 'wall');
    col.addBox(x0, x1, R.walkS + 0.2, R.walkS + 0.8, 0, 5, 'thin');
  };
  wallSeg(R.x0, 53.8);
  wallSeg(61.2, 79);
  wallSeg(150, R.x1);
  // 車道とは柵でわける（車の橋の下をくぐって、向こうへ行ける）
  for (const [x0, x1] of [[78.6, 79.4], [94.6, 95.4]]) {
    col.addBox(x0, x1, R.slope - 0.2, -100, 0, 3, 'thin');
    guardrail(g, (x0 + x1) / 2, R.slope, (x0 + x1) / 2, -101);
  }
  // 遊歩道ぞいの家（川のほうを向く）
  for (let x = -56; x < 24; x += 10.5) house(g, x, -101.5, { w: 8.5, d: 7.5, floors: 2 }, Math.PI);
  for (let x = 156; x < 204; x += 11) house(g, x, -101.5, { w: 9, d: 7.5, floors: 2 + (x % 3 === 0 ? 1 : 0) }, Math.PI);

  // 公園からの路地
  ground(g, 53.8, 61.2, R.walkS, -96, M.lane, 5, 0.01);
  for (const x of [53.8, 61.2]) {
    blockWall(g, x - 0.08, x + 0.08, R.walkS, -96.6, 1.4);
    col.addBox(x - 0.1, x + 0.1, R.walkS, -96.6, 0, 1.4, 'wall');
    col.addBox(x - 0.1, x + 0.1, R.walkS, -96.6, 0, 5, 'thin');
  }
  signBoard(g, 'ひだまり川 →', 57.5, 1.6, -96.9, 1.6, 0.34, 0, { bg: '#27406b', fg: '#ffffff', size: 70, glow: 0.3 });
  cyl(g, 0.04, 0.04, 1.8, 58.4, 0, -96.95, 0x8e949a, 6);
  // 駅前広場からの路地
  ground(g, 108.5, 115.5, R.top, -100, M.plaza, 2.4, 0.01);
  signBoard(g, '↑ 河川敷', 112, 1.9, -100.4, 1.2, 0.3, Math.PI, { bg: '#3f8f6a', fg: '#ffffff', size: 70, glow: 0.3 });

  // 土手の桜並木・ベンチ・街灯
  for (let x = R.x0 + 4; x < R.x1; x += 11) {
    if ((x > 50 && x < 65) || (x > 76 && x < 98) || (x > 105 && x < 119) || (x > 136 && x < 148)) continue;
    const t = tree(g, x, -107.6, 'sakura', 300 + Math.floor(x), 1.05);
    col.addCircle(x, -107.6, 0.3, 0, 5, 'trunk');
    petalsEmit.push({ x, z: -107.6, r: 2.4, h: t.h * 1.05 });
  }
  const benchAt = (x, z, ry, y = 0) => {
    const b = bench(g, x, z, ry, 0x9c7650);
    b.position.y = y;
    for (const o of [-0.5, 0, 0.5]) col.addCircle(x + Math.cos(ry) * o, z - Math.sin(ry) * o, 0.32, y, y + 0.45, 'bench');
    return { x, z, ry, y };
  };
  anchors.benches.river = [benchAt(20, -113.2, Math.PI), benchAt(67, -113.2, Math.PI), benchAt(125, -113.2, Math.PI), benchAt(-30, -113.2, Math.PI)];
  for (let x = R.x0 + 10; x < R.x1; x += 24) {
    if (x > 76 && x < 98) continue;
    parkLamp(g, x, -110.4);
    col.addCircle(x, -110.4, 0.1, 0, 3.5, 'pole');
    pools.add(x, -110.4, 3.2);
  }
  // 河川敷の看板
  {
    const sx = 30;
    for (const s of [-1, 1]) cyl(g, 0.05, 0.05, 2.2, sx + s * 1.3, 0, R.slope + 0.4, 0xdcdcd8, 6);
    signBoard(g, '一級河川　ひだまり川', sx, 1.7, R.slope + 0.36, 3.0, 0.5, Math.PI, { bg: '#ffffff', fg: '#27406b', size: 72 });
  }

  // 土手の階段（斜面にのせたコンクリート）
  const stairs = (x) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const z0 = R.slope - i * 0.6, z1 = z0 - 0.6;
      const yTop = Math.max(riverY(x, z0 - 0.3) + 0.12, riverY(x, z1));
      const yBot = Math.min(riverY(x, z0), riverY(x, z1)) - 0.4;
      tbox(g, x - 1.1, x + 1.1, yBot, yTop, z1, z0, gmat(TEX.concrete, 0xd9d4ca, 0.9), 2);
    }
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) { const z = R.slope - i; pts.push(new THREE.Vector3(x + s * 1.2, riverY(x, z) + 0.9, z)); }
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03, 6), mat(0xc9ccd0, { rough: 0.3, metal: 0.7 }));
      rail.castShadow = true;
      g.add(rail);
      for (let i = 0; i <= 6; i += 2) { const z = R.slope - i; cyl(g, 0.025, 0.025, 0.9, x + s * 1.2, riverY(x, z), z, mat(0xc9ccd0, { rough: 0.3, metal: 0.7 }), 6); }
    }
  };
  for (const x of [-24, 42, 112, 170]) stairs(x);

  // 野球のグラウンド（ダイヤモンドとバックネット）
  {
    const hx = 16, hz = -126, y = R.flatY;
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(9, 32, -Math.PI / 4, Math.PI / 2), gmat(TEX.sand, 0xc9a27a, 1));
    dirt.rotation.x = -Math.PI / 2;
    dirt.rotation.z = Math.PI / 2;
    dirt.position.set(hx, y + 0.015, hz);
    dirt.receiveShadow = true;
    g.add(dirt);
    for (const [dx, dz] of [[6.4, 0], [0, 0], [3.2, 3.2], [3.2, -3.2]]) box(g, 0.38, 0.05, 0.38, hx + dx + (dx === 0 && dz === 0 ? 0 : 0), y, hz + dz, 0xffffff, { cast: false, ry: Math.PI / 4 });
    // バックネット
    const netTex = canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(40,44,48,0.9)';
      c.lineWidth = 2;
      for (let i = 0; i <= 64; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
    });
    netTex.repeat.set(6, 3);
    const netM = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 });
    netM.userData.noBake = true;
    for (const a of [-0.6, 0, 0.6]) {
      const net = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), netM);
      net.position.set(hx - 2.6 * Math.cos(a), y + 1.6, hz + 2.6 * Math.sin(a));
      net.rotation.y = Math.PI / 2 - a;
      g.add(net);
      cyl(g, 0.05, 0.05, 3.4, hx - 2.6 * Math.cos(a) + 2.1 * Math.sin(a) * 0.98, y, hz + 2.6 * Math.sin(a) + 2.1 * Math.cos(a) * 0.98, 0x6a6f74, 6);
    }
    col.addBox(hx - 3.2, hx - 2.0, hz - 3, hz + 3, y, y + 3.3, 'net');
    anchors.baseball = new THREE.Vector3(hx + 3.2, y, hz);
    benchAt(hx - 1.5, -121.2, 0, y);
  }

  // 車の橋（ひだまり橋）
  {
    const cM = gmat(TEX.concrete, 0xd6d0c4, 0.85);
    tbox(g, 80.4, 93.6, -1.4, -0.02, -164, R.slope + 1, cM, 3);
    col.addBox(80.4, 93.6, -164, R.slope + 1, -1.4, 0.3, 'bridge');
    // 欄干
    for (const x of [80.7, 93.3]) {
      tbox(g, x - 0.18, x + 0.18, 0.15, 0.95, -163.5, R.slope + 0.5, cM, 2);
      box(g, 0.12, 0.08, 49, x, 0.95, -138.8, mat(0x8a7a5e, { rough: 0.5, metal: 0.3 }));
      for (const z of [R.slope + 0.3, -163.3]) {
        tbox(g, x - 0.3, x + 0.3, 0, 1.25, z - 0.3, z + 0.3, cM, 2);
      }
    }
    signBoard(g, 'ひだまりばし', 80.49, 0.62, R.slope - 0.6, 0.9, 0.24, -Math.PI / 2, { bg: '#6b5a3e', fg: '#f6e6c6', size: 60 });
    // 橋脚
    for (const z of [-128, -151]) {
      tbox(g, 81.5, 92.5, R.bedY, -1.4, z - 0.8, z + 0.8, cM, 2);
      for (const x of [81.5, 92.5]) cyl(g, 0.8, 0.8, -1.4 - R.bedY, x, R.bedY, z, cM, 16);
      col.addBox(81, 93, z - 0.9, z + 0.9, R.bedY, -1.4, 'pier');
    }
    for (const z of [-122, -156]) {
      streetLamp(g, 80.2, z, Math.PI / 2, 5.0);
      pools.add(81.3, z, 3.2, 0.2);
    }
    // 橋の下：ハーモニカのおじいさんの木箱
    crate(g, 86.5, R.flatY, -124.2, 0.8, 0.45, 0.6, 0x9c7650);
    col.addBox(86.1, 86.9, -124.5, -123.9, R.flatY, R.flatY + 0.45, 'crate');
    anchors.underBridge = new THREE.Vector3(86.5, R.flatY + 0.45, -124.2);
  }

  // 電車の鉄橋（トラス）
  {
    const x = 142, y = 9.3;
    const steel = mat(0x8a3a2e, { rough: 0.45, metal: 0.55 });
    const cM = gmat(TEX.concrete, 0xcfc8bb, 0.9);
    const z0 = -104, z1 = -172, bays = 12;
    const bay = (z1 - z0) / bays;
    for (const s of [-1, 1]) {
      const sx = x + s * 3.9;
      const top = y + 4.8;
      box(g, 0.34, 0.4, Math.abs(z1 - z0) - bay, sx, top - 0.2, (z0 + z1) / 2, steel);
      for (let i = 0; i <= bays; i++) {
        const z = z0 + i * bay;
        box(g, 0.26, 4.8, 0.26, sx, y, z, steel);
        if (i < bays) {
          const zm = z + bay / 2;
          const len = Math.hypot(bay, 4.8);
          const d = box(g, 0.2, len, 0.2, sx, y + 2.4 - len / 2, zm, steel);
          d.rotation.x = (i % 2 ? 1 : -1) * Math.atan2(bay, 4.8);
        }
      }
      box(g, 0.3, 0.5, Math.abs(z1 - z0), sx, y - 0.4, (z0 + z1) / 2, steel);
    }
    for (let i = 0; i <= bays; i += 2) box(g, 7.8, 0.22, 0.22, x, y + 4.6, z0 + i * bay, steel);
    for (const z of [-107.5, -140, -171]) {
      tbox(g, x - 1.8, x + 1.8, R.bedY, y - 0.8, z - 1.3, z + 1.3, cM, 3);
      col.addBox(x - 1.9, x + 1.9, z - 1.4, z + 1.4, R.bedY, y, 'pier');
    }
  }

  // 向こう岸：家並みと土手の灯り（行けない）
  {
    const r = mulberry32(88);
    for (let x = -130; x < 270; x += 10.5 + r() * 3) {
      if (x > 135 && x < 149) continue;
      const hs = makeHouse({ w: 8 + r() * 2, d: 8, floors: 2 + (r() < 0.25 ? 1 : 0) });
      hs.position.set(x, 0, -171.5);
      far.add(hs);
    }
    for (let x = -120; x < 270; x += 14) {
      if (x > 135 && x < 149) continue;
      tree(far, x + 3, R.farTop - 2, r() < 0.5 ? 'sakura' : 'keyaki', 500 + Math.floor(x), 1.1);
    }
    for (let x = -110; x < 270; x += 26) {
      parkLamp(far, x, R.farTop - 0.8);
      pools.add(x, R.farTop - 0.8, 3);
    }
    ground(far, -140, 280, -166, R.farTop, M.lane, 5, 0.01);
    for (let x = -120; x < 270; x += 22) cityBlock(far, x + r() * 6, -192 - r() * 8, 14, 12, 12 + r() * 16, [0xe9dccb, 0xd8d0c4, 0xf0e6d6, 0xc9d0d4][Math.floor(r() * 4)]);
    // 向こう岸の河川敷にも少し葦と木
    for (let x = -100; x < 260; x += 23) bush(far, x, -151 - r() * 3, 1 + r() * 0.5, 600 + x, false, R.flatY);
  }

  // 見える所の目印
  anchors.riverView = new THREE.Vector3(60, 0, -113);
  anchors.riverWade = new THREE.Vector3(62, R.shallowY, -135.8);
  anchors.reeds = new THREE.Vector3(66, R.flatY, -131.5);
  return { water };
}

// ------------------------------------------------------------
// ひだまり神社：路地の西のつきあたりから石段で高台へ
// ------------------------------------------------------------
export const SHRINE = { x0: -80, x1: -50, z0: -25, z1: 25, y: 7.5, stairX0: -34, stairX1: -50, stairZ0: 7.0, stairZ1: 10.0 };

export function buildShrine(ctx) {
  const { col, D, pools, anchors, M, petalsEmit, scene } = ctx;
  const S = SHRINE;
  const g = D('shrine');
  const Y = S.y;
  const stoneM = gmat(TEX.stone, 0xd8d2c6, 0.95);
  const wallM = gmat(TEX.stone, 0xb8b0a2, 0.95);
  const gravel = gmat(TEX.sand, 0xc9c3b6, 1);

  // 石段の北のふもと：家と庭（展望台から見える所を空き地にしない）
  ground(g, -36, -6, -34, -4.5, gmat(TEX.grass, 0xc9d8b0, 1), 5, 0.004);
  ctx.house(g, -32.4, -16, { w: 6, d: 7, floors: 2 }, Math.PI / 2);
  ctx.house(g, -24.5, -14, { w: 9, d: 8, floors: 2 });
  ctx.house(g, -24.5, -26, { w: 9, d: 8, floors: 3, flat: true });
  ctx.house(g, -13, -28, { w: 9, d: 7, floors: 2 });
  for (const [x, z, k] of [[-30.5, -7.5, 'garden'], [-17, -8, 'maple'], [-31, -30, 'keyaki'], [-19.5, -20, 'garden']]) tree(g, x, z, k, 1000 + Math.floor(x * z), 1);

  // 路地を西へのばす
  ground(g, -36, -30, 5.6, 11.3, M.lane, 5, 0.006);
  blockWall(g, -36, -30, 5.52, 5.68, 1.4);
  col.addBox(-36, -30, 5.5, 5.7, 0, 1.4, 'wall');
  col.addBox(-36, -30, 4.6, 5.25, 0, 4, 'thin');
  blockWall(g, -36, -30, 11.3, 11.46, 1.4);
  col.addBox(-36, -30, 11.3, 11.5, 0, 1.4, 'wall');
  col.addBox(-36, -30, 11.75, 12.4, 0, 4, 'thin');

  // 石段：30段で 7.5m
  const n = 30, rise = Y / n, run = (S.stairX0 - S.stairX1) / n;
  for (let i = 0; i < n; i++) {
    const x1 = S.stairX0 - i * run, x0 = x1 - run;
    tbox(g, x0, x1 + 0.02, 0, (i + 1) * rise, S.stairZ0, S.stairZ1, stoneM, 1.5, i % 3 === 0);
    col.addBox(x0, x1, S.stairZ0, S.stairZ1, 0, (i + 1) * rise, 'stairs');
  }
  // 両わきの石垣（横へは出られない）
  for (const [z0, z1] of [[S.stairZ0 - 0.7, S.stairZ0], [S.stairZ1, S.stairZ1 + 0.7]]) {
    for (let k = 0; k < 6; k++) {
      const xa = S.stairX0 - k * (S.stairX0 - S.stairX1) / 6, xb = xa - (S.stairX0 - S.stairX1) / 6;
      const top = Math.min(Y + 0.6, ((k + 1) / 6) * Y + 0.7);
      tbox(g, xb, xa, 0, top, z0, z1, wallM, 2);
    }
    col.addBox(S.stairX1, S.stairX0, z0, z1, 0, Y + 3, 'wall');
  }
  for (let i = 3; i < n; i += 6) {
    const x = S.stairX0 - (i + 0.5) * run;
    for (const z of [S.stairZ0 - 0.35, S.stairZ1 + 0.35]) stoneLantern(g, x, Math.min(Y + 0.6, ((i + 1) / n) * Y + 0.7), z, 0.8);
  }
  torii(g, -33.2, 0, (S.stairZ0 + S.stairZ1) / 2, 3.4, 3.6);
  col.addCircle(-33.2, S.stairZ0 - 0.2, 0.18, 0, 4, 'pole');
  col.addCircle(-33.2, S.stairZ1 + 0.2, 0.18, 0, 4, 'pole');

  // お地蔵さん（石段の下）
  {
    const jx = -32.2, jz = 6.25;
    box(g, 0.8, 0.3, 0.7, jx, 0, jz, 0xb3aca0);
    const stone = mat(0xa9a397, { rough: 0.95 });
    ball(g, 0.2, jx, 0.62, jz, stone, { sx: 1, sy: 1.5, sz: 0.9 });
    ball(g, 0.14, jx, 0.98, jz, stone);
    const bib = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.26, 4, 1, true), mat(0xd23a2a, { rough: 0.8, side: THREE.DoubleSide }));
    bib.position.set(jx, 0.72, jz);
    bib.rotation.y = Math.PI / 4;
    g.add(bib);
    cyl(g, 0.12, 0.12, 0.02, jx, 1.1, jz, 0xd23a2a, 12);
    col.addBox(jx - 0.4, jx + 0.4, jz - 0.35, jz + 0.35, 0, 1.1, 'jizo');
    anchors.shrine = new THREE.Vector3(jx + 0.9, 0, jz + 0.9);
    anchors.jizo = new THREE.Vector3(jx, 0, jz);
  }

  // 高台（石垣の上に砂利）
  const P = { x0: -84, x1: S.stairX1, z0: -28, z1: 28 };
  tbox(g, P.x0, P.x1, 0, Y, P.z0, P.z1, wallM, 3);
  col.addBox(P.x0, P.x1, P.z0, P.z1, 0, Y, 'hill');
  ground(g, P.x0, P.x1, P.z0, P.z1, gravel, 3, Y + 0.004);
  // 東の斜面：段々の石垣と茂み（石段の北と南）
  for (const [z0, z1] of [[P.z0, S.stairZ0 - 0.7], [S.stairZ1 + 0.7, P.z1]]) {
    const tiers = [[-50, -45, Y * 0.72], [-45, -40, Y * 0.44], [-40, -36, Y * 0.18]];
    for (const [xa, xb, h] of tiers) {
      tbox(g, xa, xb, 0, h, z0, z1, wallM, 3);
      ground(g, xa, xb, z0, z1, gmat(TEX.grass, 0xc9dcb0, 1), 5, h + 0.004);
      col.addBox(xa, xb, z0, z1, 0, h, 'hill');
      for (let z = z0 + 2; z < z1 - 1; z += 3.2) bush(g, (xa + xb) / 2 + Math.sin(z) * 1.2, z, 1.1, 700 + Math.floor(z * 3 + xa), false, h);
    }
    for (let z = z0 + 3; z < z1 - 2; z += 7) {
      if (z < -12) continue;   // 展望台からの眺めをさえぎらない
      const t = tree(g, -47.5, z, z % 2 ? 'keyaki' : 'pine', 720 + Math.floor(z), 1.1);
      t.group.position.y = Y * 0.72;
    }
  }
  // 高台のまわり：玉垣（見えない壁も）。石段の入口だけあいている
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.floor(len / 1.2));
    for (let i = 0; i <= k; i++) {
      const t = i / k;
      box(g, 0.16, 0.8, 0.16, lerp(x0, x1, t), Y, lerp(z0, z1, t), stoneM);
    }
    const rail = box(g, x1 === x0 ? 0.12 : len, 0.1, z1 === z0 ? 0.12 : len, (x0 + x1) / 2, Y + 0.7, (z0 + z1) / 2, stoneM);
    void rail;
  };
  fence(P.x0 + 0.5, P.z0 + 0.5, P.x0 + 0.5, P.z1 - 0.5);
  fence(P.x0 + 0.5, P.z0 + 0.5, P.x1 - 7, P.z0 + 0.5);
  fence(P.x0 + 0.5, P.z1 - 0.5, P.x1 - 0.5, P.z1 - 0.5);
  fence(P.x1 - 0.5, S.stairZ1 + 0.7, P.x1 - 0.5, P.z1 - 0.5);
  fence(P.x1 - 0.5, P.z0 + 7, P.x1 - 0.5, S.stairZ0 - 0.7);
  col.addBox(P.x0, P.x0 + 0.8, P.z0, P.z1, Y - 1, Y + 3, 'thin');
  col.addBox(P.x0, P.x1, P.z0, P.z0 + 0.8, Y - 1, Y + 3, 'thin');
  col.addBox(P.x0, P.x1, P.z1 - 0.8, P.z1, Y - 1, Y + 3, 'thin');
  col.addBox(P.x1 - 0.8, P.x1, P.z0, S.stairZ0, Y - 1, Y + 3, 'thin');
  col.addBox(P.x1 - 0.8, P.x1, S.stairZ1, P.z1, Y - 1, Y + 3, 'thin');

  // 展望台（北東のすみ）：町と川が見わたせる
  {
    const lx0 = P.x1 - 7, lx1 = P.x1 - 0.6, lz0 = P.z0 + 0.6, lz1 = P.z0 + 7;
    slab(g, col, lx0, lx1, lz0, lz1, 0.18, M.deck, 1.2, Y, 'deck');
    const wood = mat(0x8a6446, { rough: 0.8 });
    for (const [x0, z0, x1, z1] of [[lx0, lz0, lx1, lz0], [lx1, lz0, lx1, lz1]]) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let i = 0; i <= Math.floor(len / 1.1); i++) {
        const t = i / Math.floor(len / 1.1);
        box(g, 0.1, 1.0, 0.1, lerp(x0, x1, t), Y + 0.18, lerp(z0, z1, t), wood);
      }
      box(g, x1 === x0 ? 0.1 : len, 0.08, z1 === z0 ? 0.1 : len, (x0 + x1) / 2, Y + 1.12, (z0 + z1) / 2, wood);
      box(g, x1 === x0 ? 0.06 : len, 0.06, z1 === z0 ? 0.06 : len, (x0 + x1) / 2, Y + 0.65, (z0 + z1) / 2, wood);
    }
    const b = bench(g, lx0 + 3, lz0 + 3.8, -Math.PI * 0.75, 0x8a6446);
    b.position.y = Y + 0.18;
    anchors.lookout = new THREE.Vector3(lx1 - 1.6, Y + 0.18, lz0 + 1.6);
    anchors.lookoutLook = new THREE.Vector3(80, 4, -110);
    signBoard(g, 'ひだまり展望台', lx0 + 0.3, Y + 1.5, lz1 - 0.2, 1.4, 0.3, Math.PI / 2, { bg: '#6b4a33', fg: '#f6e6c6', size: 70 });
  }

  // 参道（石畳）と上の鳥居
  ground(g, -74, S.stairX1, S.stairZ0 + 0.2, S.stairZ1 - 0.2, stoneM, 1.8, Y + 0.01);
  torii(g, -51.8, Y, (S.stairZ0 + S.stairZ1) / 2, 3.6, 4.2);
  col.addCircle(-51.8, S.stairZ0 - 0.3, 0.2, Y, Y + 4.5, 'pole');
  col.addCircle(-51.8, S.stairZ1 + 0.3, 0.2, Y, Y + 4.5, 'pole');
  for (const x of [-56, -61, -66]) {
    for (const z of [S.stairZ0 - 1.2, S.stairZ1 + 1.2]) {
      stoneLantern(g, x, Y, z, 1.1);
      col.addCircle(x, z, 0.32, Y, Y + 1.8, 'lantern');
      pools.add(x, z, 1.8, Y + 0.03);
    }
  }

  // 拝殿（東向き）
  const hz = (S.stairZ0 + S.stairZ1) / 2;
  {
    const hx0 = -80, hx1 = -70, hz0 = hz - 6, hz1 = hz + 6;
    const red = mat(0xb9412e, { rough: 0.55 });
    const white = mat(0xf2ece0, { rough: 0.85 });
    const wood = gmat(TEX.wood, 0x8a5a3a, 0.75);
    tbox(g, hx0 - 0.5, hx1 + 1.2, Y, Y + 0.55, hz0 - 0.5, hz1 + 0.5, stoneM, 2);
    col.addBox(hx0 - 0.5, hx1 + 1.2, hz0 - 0.5, hz1 + 0.5, Y, Y + 0.55, 'haiden-base');
    tbox(g, hx0, hx1, Y + 0.55, Y + 3.6, hz0, hz1, white, 2);
    col.addBox(hx0, hx1, hz0, hz1, Y, Y + 6, 'haiden');
    // 縁側と柱
    tbox(g, hx1, hx1 + 1.1, Y + 0.55, Y + 0.7, hz0, hz1, wood, 1.5);
    for (let i = 0; i <= 4; i++) {
      const z = hz0 + (i / 4) * (hz1 - hz0);
      cyl(g, 0.14, 0.14, 3.1, hx1 + 0.9, Y + 0.55, z, red, 10);
      cyl(g, 0.14, 0.14, 3.1, hx0, Y + 0.55, z, red, 10);
    }
    box(g, 0.3, 0.3, hz1 - hz0 + 0.6, hx1 + 0.9, Y + 3.45, hz, red);
    box(g, 0.3, 0.3, hz1 - hz0 + 0.6, hx0, Y + 3.45, hz, red);
    // 格子戸（正面）
    const lattice = canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#2a1a12'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f7ecd6';
      for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 16) c.fillRect(x, y, 12, 12);
      c.fillStyle = 'rgba(255,190,110,0.35)'; c.fillRect(0, 0, w, h);
    });
    const latM = new THREE.MeshStandardMaterial({ map: lattice, emissive: 0xffb870, emissiveMap: lattice, emissiveIntensity: 0.25, roughness: 0.7 });
    latM.userData.noBake = true;
    const lat = new THREE.Mesh(new THREE.PlaneGeometry(hz1 - hz0 - 1.2, 2.4), latM);
    lat.rotation.y = Math.PI / 2;
    lat.position.set(hx1 + 0.02, Y + 1.85, hz);
    g.add(lat);
    // 大きな屋根（銅板の緑青）：棟は南北
    const roofM = mat(0x46705f, { rough: 0.5, metal: 0.35 });
    const W = hx1 + 1.2 - hx0 + 3.2, half = W / 2, rise = 2.7;
    const len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    const cx = (hx0 + hx1 + 1.2) / 2;
    for (const s of [-1, 1]) {
      const rf = box(g, len, 0.22, hz1 - hz0 + 3.2, cx + s * half / 2, Y + 3.6 + rise / 2 - 0.11, hz, roofM);
      rf.position.y = Y + 3.6 + rise / 2;
      rf.rotation.z = -s * ang;
    }
    const tri = new THREE.Shape();
    tri.moveTo(-half + 1.5, 0); tri.lineTo(half - 1.5, 0); tri.lineTo(0, rise * (half - 1.5) / half); tri.lineTo(-half + 1.5, 0);
    for (const s of [-1, 1]) {
      const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
      const tm = new THREE.Mesh(tg, wood);
      tm.position.set(cx, Y + 3.6, hz + s * (hz1 - hz0) / 2 - (s > 0 ? 0.2 : 0));
      tm.castShadow = true;
      g.add(tm);
    }
    box(g, 0.4, 0.4, hz1 - hz0 + 3.6, cx, Y + 3.6 + rise - 0.1, hz, roofM);
    // 鰹木と千木
    for (let i = 0; i < 5; i++) {
      const c = cyl(g, 0.16, 0.16, 1.2, cx, Y + 3.6 + rise + 0.05, hz - 4 + i * 2, mat(0x3a2a20, { rough: 0.7 }), 10);
      c.rotation.z = Math.PI / 2;
    }
    for (const s of [-1, 1]) {
      for (const k of [-1, 1]) {
        const ch = box(g, 0.12, 1.6, 0.14, cx + k * 0.35, Y + 3.6 + rise - 0.2, hz + s * ((hz1 - hz0) / 2 + 1.6), mat(0x3a2a20, { rough: 0.7 }));
        ch.rotation.z = k * 0.55;
      }
    }
    // 賽銭箱・鈴・鈴緒・しめ縄
    const sx = hx1 + 1.6;
    box(g, 0.7, 0.9, 1.5, sx, Y, hz, gmat(TEX.wood, 0x6b4a33, 0.7));
    for (let i = 0; i < 6; i++) box(g, 0.72, 0.04, 0.05, sx, Y + 0.9, hz - 0.6 + i * 0.24, 0x2a1a12, { cast: false });
    col.addBox(sx - 0.35, sx + 0.35, hz - 0.75, hz + 0.75, Y, Y + 0.95, 'saisen');
    const bell = ball(scene, 0.22, hx1 + 2.25, Y + 3.25, hz, new THREE.MeshStandardMaterial({ color: 0xd9b24a, roughness: 0.25, metalness: 0.95 }), { seg: 16, seg2: 12 });
    const ropeTex = canvasTex(32, 256, (c, w, h) => {
      for (let y = 0; y < h; y += 32) { c.fillStyle = '#d9322a'; c.fillRect(0, y, w, 16); c.fillStyle = '#fbfaf6'; c.fillRect(0, y + 16, w, 16); }
    });
    ropeTex.repeat.set(1, 3);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 2.7, 10), new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 0.9 }));
    rope.material.userData.noBake = true;
    rope.geometry.translate(0, -1.35, 0);
    rope.position.set(hx1 + 2.25, Y + 3.05, hz);
    rope.castShadow = true;
    scene.add(rope);
    const bellGroup = { bell, rope, base: rope.position.clone() };
    anchors.shrineBell = bellGroup;
    anchors.shrineFront = new THREE.Vector3(hx1 + 3.1, Y, hz);
    shimenawa(g, new THREE.Vector3(hx1 + 1.0, Y + 3.3, hz0 + 0.5), new THREE.Vector3(hx1 + 1.0, Y + 3.3, hz1 - 0.5), 0.35, 0.09);
    for (let i = 0; i < 3; i++) {
      const l = ball(g, 0.2, hx1 + 1.0, Y + 2.6, hz0 + 1.5 + i * 3.5, LM.lantern, { sy: 1.3, seg: 10, seg2: 8, cast: false });
      l.userData.lantern = true;
    }
    pools.add(hx1 + 2, hz, 3.6, Y + 0.05);
  }

  // 狛犬（石の犬）
  {
    const stone = new THREE.MeshStandardMaterial({ color: 0xa8a296, roughness: 0.92 });
    for (const [z, ry] of [[hz - 3.2, Math.PI / 2 + 0.35], [hz + 3.2, Math.PI / 2 - 0.35]]) {
      const x = -62.5;
      tbox(g, x - 0.6, x + 0.6, Y, Y + 0.9, z - 0.6, z + 0.6, stoneM, 1.5);
      col.addBox(x - 0.6, x + 0.6, z - 0.6, z + 0.6, Y, Y + 0.9, 'komainu');
      const d = buildDog({ ...breedParams('shiba', ''), fluff: 0.5, ear: 'pointy', tail: 'plume' }, { shells: false });
      d.root.traverse((o) => { if (o.isMesh) { o.material = stone; o.castShadow = true; } });
      if (d.blob) d.blob.visible = false;
      d.body.rotation.x = -0.45;
      d.body.position.y = d.dims.bodyY * 0.82;
      d.legs[2].rotation.x = -0.95; d.legs[3].rotation.x = -0.95;
      d.legs[0].rotation.x = 0.45; d.legs[1].rotation.x = 0.45;
      d.head.rotation.x = -0.1;
      d.root.scale.setScalar(2.4);
      d.root.position.set(x, Y + 0.9, z);
      d.root.rotation.y = ry;
      g.add(d.root);
    }
  }

  // 手水舎・おみくじ・絵馬
  {
    const wood = mat(0x7a5238, { rough: 0.8 });
    const roofM = mat(0x46705f, { rough: 0.5, metal: 0.35 });
    const cx = -58, cz = hz + 7.5;
    for (const [dx, dz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) cyl(g, 0.07, 0.07, 2.2, cx + dx, Y, cz + dz, wood, 8);
    for (const s of [-1, 1]) { const r = box(g, 1.5, 0.1, 2.6, cx + s * 0.62, Y + 2.35, cz, roofM); r.rotation.z = -s * 0.5; }
    box(g, 1.3, 0.6, 0.6, cx, Y, cz, 0x9c968a);
    const wtr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.4), mat(0x5f8f96, { rough: 0.1, metal: 0.2 }));
    wtr.rotation.x = -Math.PI / 2;
    wtr.position.set(cx, Y + 0.58, cz);
    g.add(wtr);
    col.addBox(cx - 1.1, cx + 1.1, cz - 0.9, cz + 0.9, Y, Y + 2.5, 'chozuya');
    // おみくじ掛け
    const ox = -63, oz = hz - 7.5;
    for (const s of [-1, 1]) cyl(g, 0.05, 0.05, 1.5, ox, Y, oz + s * 1.2, wood, 6);
    const paper = mat(0xfbfaf4, { rough: 0.7 });
    const r = mulberry32(9);
    for (let row = 0; row < 3; row++) {
      box(g, 0.03, 0.03, 2.4, ox, Y + 0.7 + row * 0.3, oz, 0x6a6f74, { cast: false });
      for (let i = 0; i < 12; i++) box(g, 0.06, 0.08, 0.05, ox + (r() - 0.5) * 0.04, Y + 0.64 + row * 0.3, oz - 1.1 + i * 0.2 + r() * 0.05, paper, { cast: false });
    }
    col.addBox(ox - 0.2, ox + 0.2, oz - 1.3, oz + 1.3, Y, Y + 1.5, 'omikuji');
    box(g, 0.55, 0.9, 0.55, ox + 1.4, Y, oz + 1.8, gmat(TEX.wood, 0xa8743f, 0.7));
    signBoard(g, 'おみくじ', ox + 1.4 + 0.28, Y + 0.72, oz + 1.8, 0.4, 0.14, Math.PI / 2, { bg: '#f7ecd6', fg: '#b9412e', size: 70 });
    col.addBox(ox + 1.1, ox + 1.7, oz + 1.5, oz + 2.1, Y, Y + 0.9, 'omikuji-box');
    anchors.omikuji = new THREE.Vector3(ox + 2.2, Y, oz + 1.8);
    // 絵馬
    const ex = -66, ez = hz - 12;
    for (const s of [-1, 1]) cyl(g, 0.06, 0.06, 1.8, ex, Y, ez + s * 1.3, wood, 6);
    box(g, 0.1, 0.9, 2.8, ex, Y + 0.7, ez, wood);
    for (let i = 0; i < 16; i++) box(g, 0.04, 0.16, 0.2, ex + 0.08, Y + 0.8 + (i % 3) * 0.26, ez - 1.1 + Math.floor(i / 3) * 0.44 + (i % 2) * 0.1, 0xe8cf9a, { cast: false });
    const er = box(g, 0.9, 0.08, 3.2, ex, Y + 1.85, ez, roofM);
    er.rotation.z = 0.3;
    col.addBox(ex - 0.2, ex + 0.2, ez - 1.4, ez + 1.4, Y, Y + 1.8, 'ema');
  }

  // ご神木（大きなくすのき）と、ねこの集会所
  {
    const tx = -66, tz = -12;
    const t = tree(g, tx, tz, 'camphor', 777, 1.25);
    t.group.position.y = Y;
    col.addCircle(tx, tz, 0.7, Y, Y + 8, 'trunk');
    const trunkR = 0.45;
    const band = new THREE.Mesh(new THREE.TorusGeometry(trunkR + 0.05, 0.07, 8, 24), mat(0xd8c48c, { rough: 0.95 }));
    band.rotation.x = Math.PI / 2;
    band.position.set(tx, Y + 1.9, tz);
    band.castShadow = true;
    g.add(band);
    const paper = mat(0xfbfaf6, { rough: 0.8 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (let k = 0; k < 3; k++) box(g, 0.02, 0.1, 0.08, tx + Math.cos(a) * (trunkR + 0.1), Y + 1.72 - k * 0.1, tz + Math.sin(a) * (trunkR + 0.1), paper, { cast: false, ry: -a });
    }
    // 幹を太く
    cyl(g, 0.42, 0.62, 3.2, tx, Y, tz, mat(0x5a4636, { rough: 0.95 }), 12);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      box(g, 0.12, 0.35, 0.12, tx + Math.cos(a) * 1.5, Y, tz + Math.sin(a) * 1.5, stoneM);
    }
    anchors.catCircle = new THREE.Vector3(-59.5, Y, -6);
    anchors.sacredTree = new THREE.Vector3(tx, Y, tz);
  }
  // 境内のまわりの木（外側）
  {
    const r = mulberry32(31);
    for (const [x, z, k] of [[-81, -20, 'pine'], [-81, -8, 'camphor'], [-82, 22, 'keyaki'], [-74, -24.5, 'maple'], [-74, 24.5, 'maple'], [-60, 24.5, 'sakura'], [-54, 20, 'maple'], [-81, 12, 'pine']]) {
      const t = tree(g, x, z, k, 800 + Math.floor(x * z), k === 'camphor' ? 0.9 : 1.15);
      t.group.position.y = Y;
      col.addCircle(x, z, 0.35, Y, Y + 5, 'trunk');
      if (k === 'sakura') petalsEmit.push({ x, z, r: 2.4, h: Y + t.h });
    }
    // 高台のうしろの森（見えるだけ）
    for (let i = 0; i < 40; i++) {
      const x = -90 - r() * 40, z = -40 + r() * 80;
      const t = tree(g, x, z, r() < 0.4 ? 'pine' : r() < 0.6 ? 'camphor' : 'keyaki', 900 + i, 0.9 + r() * 0.5);
      t.group.position.y = Y;
    }
    tbox(g, -130, P.x0, 0, Y, -45, 45, wallM, 4, false);
    ground(g, -130, P.x0, -45, 45, gmat(TEX.grass, 0x9cb07a, 1), 5, Y + 0.003);
    for (const [z0, z1] of [[-45, P.z0], [P.z1, 45]]) {
      tbox(g, P.x0, -44, 0, Y * 0.8, z0, z1, wallM, 4, false);
      ground(g, P.x0, -44, z0, z1, gmat(TEX.grass, 0x9cb07a, 1), 5, Y * 0.8 + 0.003);
      for (let i = 0; i < 10; i++) {
        const t = tree(g, P.x0 + r() * (P.x0 * -1 - 44), z0 + r() * (z1 - z0), r() < 0.5 ? 'keyaki' : 'pine', 950 + i + Math.floor(z0), 1 + r() * 0.3);
        t.group.position.y = Y * 0.8;
      }
    }
  }
  return {};
}
