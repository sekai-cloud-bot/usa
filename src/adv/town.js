import * as THREE from 'three';
import { box, cyl, ball, mat, LIGHTS, TEX, makeTextures, signTex, canvasTex, bake } from './build.js';
import {
  R, pickR, LM, windowUnit, makeHouse, makeShop, acUnit, utilityPole, wires, streetLamp, parkLamp, vendingMachine,
  bench, bicycle, postBox, pottedPlant, blockWall, woodFence, crate, guardrail, mirror,
} from './props.js';
import { tree, hedge, bush, grassField, flowerBed, waterMaterial, Petals } from './nature.js';
import { Collision } from './collide.js';
import { buildRoom, ROOM, WINDOW } from '../room.js';
import { buildDog, breedParams } from '../dogModel.js';
import { mulberry32 } from '../util.js';

// ------------------------------------------------------------
// 町の設計図（単位はメートル。x=東、z=南）
// 家(原点) → 庭(東) → 路地(南, 東西) → 商店街(北へ) → 公園 → 大通りの横断歩道 → 駅前広場 → 駅
// ------------------------------------------------------------
export const Z = {
  home: { x0: -6, x1: 13.5, z0: -7, z1: 5.6 },
  lane: { x0: -30, x1: 48, z0: 5.6, z1: 11.3 },
  street: { x0: 39, x1: 47, z0: -49, z1: 5.6 },
  park: { x0: 26, x1: 79, z0: -96, z1: -49.5 },
  road: { x0: 81, x1: 93, z0: -100, z1: -44 },
  cross: { x0: 81, x1: 93, z0: -74, z1: -70 },
  plaza: { x0: 95, x1: 130, z0: -100, z1: -44 },
};
export const DIG = { x: 10, z: 5.6 };             // 庭の柵の下
export const GATE = { x: 133.4, z: -72 };           // 改札の前
export const TRACK = { x: 142, y: 9.3 };            // 高架の線路
export const LANE_Z = 8.45;
export const ROAD = { northX: 84.2, southX: 89.8, stopN: -67.2, stopS: -76.8 };

// 飼い主の匂いの道（においモードで光る）
export const SCENT = [
  [2.5, -0.8], [4.9, -0.8], [7.5, 1.8], [10, 4.4], [10, 7.6], [18, 8.4], [30, 8.4], [43, 8.2], [43, -10], [43, -30], [43, -46],
  [45, -55], [52, -61], [62, -65], [71, -69], [78, -72], [87, -72], [96, -72], [108, -70], [122, -72], [130, -72],
];

// ------------------------------------------------------------
// 地面の部品：ワールド座標でUVを振るので、テクスチャの継ぎ目が出ない
// ------------------------------------------------------------
const gmats = new Map();
function gmat(tex, color = 0xffffff, rough = 0.95, extra = {}) {
  const k = tex.uuid + '|' + color + '|' + rough + JSON.stringify(extra);
  if (!gmats.has(k)) {
    const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, ...extra });
    m.userData.shared = true;
    gmats.set(k, m);
  }
  return gmats.get(k);
}

function worldUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) / scale, -p.getZ(i) / scale);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) / scale, p.getY(i) / scale);
    else uv.setXY(i, p.getX(i) / scale, p.getY(i) / scale);
  }
  uv.needsUpdate = true;
}

function ground(g, x0, x1, z0, z1, material, scale = 4, y = 0) {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  worldUV(geo, scale);
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.castShadow = false;
  g.add(m);
  return m;
}

/** 厚みのある地面（歩道・縁石・花壇の縁）。上に乗れる */
function slab(g, col, x0, x1, z0, z1, h, material, scale = 2, y0 = 0, tag = null) {
  const geo = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
  geo.translate((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
  worldUV(geo, scale);
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.castShadow = h > 0.3;
  g.add(m);
  if (col) col.addBox(x0, x1, z0, z1, y0, y0 + h, tag);
  return m;
}

/** 路面の線（白線など） */
function paint(g, x0, z0, x1, z1, w, color = 0xf4f1ea, y = 0.012) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const geo = new THREE.PlaneGeometry(len, w);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(-Math.atan2(z1 - z0, x1 - x0));
  geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const m = new THREE.Mesh(geo, mat(color, { rough: 0.7 }));
  m.receiveShadow = true;
  m.castShadow = false;
  g.add(m);
  return m;
}

function decal(g, text, x, z, w, h, ry = 0, color = '#f4f1ea', size = 150) {
  const t = canvasTex(512, 256, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = color;
    c.font = `800 ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.save();
    c.translate(W / 2, H / 2);
    c.scale(1, 1.6);
    c.fillText(text, 0, 4);
    c.restore();
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = ry;
  m.position.set(x, 0.016, z);
  m.receiveShadow = true;
  m.userData.noBake = true;
  g.add(m);
  return m;
}

/** 看板（両面ではなく片面の文字板） */
function signBoard(g, text, x, y, z, w, h, ry = 0, opts = {}) {
  const t = signTex(text, { w: 512, h: Math.round(512 * h / w), size: opts.size || Math.round(512 * h / w * 0.62), ...opts });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: opts.glow ?? 0.12, roughness: 0.7 }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.userData.noBake = true;
  g.add(m);
  return m;
}

// 灯りの溜まり（街灯の下のあたたかい円）。夕方に浮かび上がる
class LightPools {
  constructor(scene, max = 160) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,150,0.9)');
    gr.addColorStop(0.35, 'rgba(255,190,120,0.45)');
    gr.addColorStop(1, 'rgba(255,170,100,0)');
    c.fillStyle = gr;
    c.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4();
  }
  add(x, z, r = 3, y = 0.03) {
    if (this.mesh.count >= this.mesh.instanceMatrix.count) return;
    this.m4.makeScale(r * 2, 1, r * 2).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.mesh.count++, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  set(f) { this.mat.opacity = f * 0.55; this.mesh.visible = f > 0.01; }
}

// 遠くの窓明かりのビル（テクスチャ1枚で、夕方に灯る）
let cityMat = null;
function cityMaterial() {
  if (cityMat) return cityMat;
  // 1マス＝幅3.2m×高さ3.2m。窓・ベランダの帯・窓枠
  const draw = (lit) => (c, w, h) => {
    const r = mulberry32(41);
    c.fillStyle = lit ? '#000' : '#fff';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < 16; y++) {
      if (!lit) { c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(0, y * 32 + 28, w, 4); }
      for (let x = 0; x < 8; x++) {
        const on = r() < 0.5;
        const wx = x * 32 + 6, wy = y * 32 + 8;
        if (lit) {
          c.fillStyle = on ? (r() < 0.5 ? '#ffcf8f' : '#fff0d0') : '#000';
          c.fillRect(wx + 1, wy + 1, 18, 15);
        } else {
          c.fillStyle = '#8f9aa3';
          c.fillRect(wx, wy, 20, 17);
          c.fillStyle = r() < 0.5 ? '#b9c9d4' : '#a8bac6';
          c.fillRect(wx + 1, wy + 1, 18, 15);
          c.fillStyle = 'rgba(255,255,255,0.35)';
          c.fillRect(wx + 1, wy + 1, 18, 3);
          c.fillStyle = 'rgba(0,0,0,0.12)';
          c.fillRect(wx + 9, wy + 1, 1.5, 15);
        }
      }
    }
  };
  const map = canvasTex(256, 512, draw(false));
  const em = canvasTex(256, 512, draw(true));
  cityMat = LIGHTS.make(0xffffff, 0.0, 1.1, 0xffffff);
  cityMat.map = map;
  cityMat.emissiveMap = em;
  cityMat.roughness = 0.9;
  cityMat.vertexColors = true;
  cityMat.needsUpdate = true;
  return cityMat;
}
function cityBlock(g, x, z, w, d, h, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, h / 2, z);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, 0.01, 0.01);
    else uv.setXY(i, (ax > 0.5 ? p.getZ(i) : p.getX(i)) / 25.6, p.getY(i) / 51.2);
    // 上の階ほど少し明るく（空の照り返し）
    const k = 0.92 + 0.08 * (p.getY(i) / Math.max(1, h));
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, cityMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  box(g, w + 0.3, 0.4, d + 0.3, x, h, z, 0xcfc8bb);
  return m;
}

// 遠景の山（霧を無視して、空の地平線の色になじませる）
function mountains(scene) {
  const r = mulberry32(19);
  const parts = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2;
    const d = 360 + r() * 70;
    const h = 22 + r() * 34;
    const w = 80 + r() * 90;
    const geo = new THREE.ConeGeometry(w, h, 6 + Math.floor(r() * 3), 1);
    geo.translate(60 + Math.cos(a) * d, h / 2 - 6, -40 + Math.sin(a) * d);
    parts.push(geo);
  }
  const pos = [];
  for (const gg of parts) {
    const ng = gg.toNonIndexed();
    pos.push(...ng.attributes.position.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
    vertexShader: 'varying float vY; void main(){ vY = position.y; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; varying float vY; void main(){ gl_FragColor = vec4(mix(uBottom, uTop, clamp(vY/80.0,0.0,1.0)), 1.0); }',
    fog: false,
    depthWrite: false,
  }));
  m.frustumCulled = false;
  m.renderOrder = -5;
  scene.add(m);
  return m;
}

/** 屋上の小物：室外機・給水タンク・手すり・物干し */
function rooftop(g, x, z, w, d, y = 5.7) {
  const r = R();
  for (let i = 0; i < 1 + Math.floor(r * 3); i++) acUnit(g, x - w / 2 + 0.8 + R() * (w - 1.6), y, z - d / 2 + 0.6 + R() * (d - 1.2), R() * 6);
  if (r < 0.45) {
    cyl(g, 0.5, 0.5, 1.1, x + (R() - 0.5) * 2, y, z + (R() - 0.5) * 2, 0x9fb6c9, 12);
    cyl(g, 0.52, 0.52, 0.08, x + 0.0, y + 1.1, z, 0x8a9aa8, 12, { cast: false });
  }
  if (r > 0.6) {
    for (const s of [-1, 1]) box(g, w - 0.4, 0.05, 0.05, x, y + 0.9, z + s * (d / 2 - 0.2), 0xcfc8bb, { cast: false });
    for (let i = 0; i < 5; i++) box(g, 0.05, 0.9, 0.05, x - w / 2 + 0.2 + i * (w - 0.4) / 4, y, z + d / 2 - 0.2, 0xcfc8bb, { cast: false });
  }
  if (r > 0.3 && r < 0.6) {
    const cols = [0xffffff, 0x9fcfe8, 0xf7c9c0, 0xfff1b8];
    for (let i = 0; i < 4; i++) box(g, 0.4, 0.55, 0.03, x - 1 + i * 0.6, y + 0.8, z + 1.2, cols[i % 4], { cast: true });
    box(g, 2.6, 0.03, 0.03, x - 0.1, y + 1.4, z + 1.2, 0xdddddd, { cast: false });
  }
}

// ------------------------------------------------------------
// 町を建てる
// ------------------------------------------------------------
export function buildTown(scene, renderer, day) {
  makeTextures();
  const col = new Collision();
  const districts = {};
  const D = (name) => {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    districts[name] = g;
    return g;
  };
  const pools = new LightPools(scene);
  const anchors = {};
  const dynamic = [];   // update(dt, t) を持つもの
  const petalsEmit = [];

  const M = {
    asphalt: gmat(TEX.asphalt, 0xffffff, 0.92),
    lane: gmat(TEX.asphalt, 0xd9d6d2, 0.92),
    walk: gmat(TEX.sidewalk, 0xffffff, 0.9),
    plaza: gmat(TEX.plaza, 0xffffff, 0.85),
    arcade: gmat(TEX.plaza, 0xf2e2cc, 0.85),
    stone: gmat(TEX.stone, 0xffffff, 0.9),
    grass: gmat(TEX.grass, 0xffffff, 1),
    lawn: gmat(TEX.grass, 0xe9f5d0, 1),
    soil: gmat(TEX.soil, 0xffffff, 1),
    path: gmat(TEX.sand, 0xe8d6b8, 1),
    sand: gmat(TEX.sand, 0xffffff, 1),
    wood: gmat(TEX.wood, 0xc9955e, 0.8),
    deck: gmat(TEX.wood, 0xc08a58, 0.75),
  };

  // 一番下の地面（町の外まで）
  const base = D('base');
  ground(base, -160, 320, -300, 200, gmat(TEX.sidewalk, 0xb9b4aa, 1), 3, -0.02);

  // ==========================================================
  // 1) 家（プロローグの部屋）と庭
  // ==========================================================
  const home = D('home');
  const room = buildRoom(scene, renderer, { town: true });
  // 部屋の当たり（壁・家具）
  {
    const h = ROOM.h;
    col.addBox(ROOM.minX - 0.14, ROOM.minX, ROOM.minZ - 0.14, ROOM.maxZ + 0.14, 0, h, 'wall');
    col.addBox(ROOM.minX - 0.14, ROOM.maxX + 0.14, ROOM.minZ - 0.14, ROOM.minZ, 0, h, 'wall');
    col.addBox(ROOM.minX - 0.14, ROOM.maxX + 0.14, ROOM.maxZ, ROOM.maxZ + 0.14, 0, h, 'wall');
    col.addBox(ROOM.maxX, ROOM.maxX + 0.14, ROOM.minZ - 0.14, WINDOW.z0, 0, h, 'wall');
    col.addBox(ROOM.maxX, ROOM.maxX + 0.14, WINDOW.z1, ROOM.maxZ + 0.14, 0, h, 'wall');
    col.addBox(ROOM.maxX, ROOM.maxX + 0.14, WINDOW.z0, WINDOW.z1, WINDOW.y1, h, 'wall');
    col.addBox(ROOM.maxX - 0.1, ROOM.maxX + 0.06, WINDOW.z0, -1.2, 0, WINDOW.y1, 'glass');
    // ソファ（座面に乗れる）
    col.addBox(-3.25, -0.55, ROOM.minZ + 0.35, ROOM.minZ + 1.03, 0, 0.55, 'sofa');
    col.addBox(-3.25, -0.55, ROOM.minZ, ROOM.minZ + 0.35, 0, 1.03, 'sofa');
    col.addBox(-2.15, -1.25, -1.2, -0.3, 0, 0.45, 'table');
    col.addBox(ROOM.maxX - 0.54, ROOM.maxX, 1.1, 2.8, 0, 0.75, 'shelf');
  }
  // 窓ガラス（奥は固定、手前は引き戸）
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfeef5, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
  glassMat.userData.noBake = true;
  const fixedGlass = new THREE.Mesh(new THREE.BoxGeometry(0.02, WINDOW.y1 - 0.1, -1.2 - WINDOW.z0), glassMat);
  fixedGlass.position.set(ROOM.maxX + 0.02, WINDOW.y1 / 2, (WINDOW.z0 - 1.2) / 2);
  scene.add(fixedGlass);
  const slider = new THREE.Group();
  const sLen = WINDOW.z1 + 1.2;
  const sGlass = new THREE.Mesh(new THREE.BoxGeometry(0.02, WINDOW.y1 - 0.1, sLen), glassMat);
  sGlass.position.set(0, WINDOW.y1 / 2, 0);
  slider.add(sGlass);
  const frameM = mat(0xe8c49a, { rough: 0.6 });
  for (const zz of [-sLen / 2, sLen / 2]) box(slider, 0.06, WINDOW.y1, 0.06, 0, 0, zz, frameM, { cast: false });
  box(slider, 0.06, 0.06, sLen, 0, WINDOW.y1 - 0.06, 0, frameM, { cast: false });
  box(slider, 0.06, 0.06, sLen, 0, 0.02, 0, frameM, { cast: false });
  slider.position.set(ROOM.maxX - 0.05, 0, (WINDOW.z1 - 1.2) / 2);
  scene.add(slider);
  const sliderCol = col.addBox(ROOM.maxX - 0.12, ROOM.maxX + 0.02, -1.2, WINDOW.z1, 0, WINDOW.y1, 'glass');
  const win = {
    open: 0.14,
    set(o) {
      this.open = o;
      slider.position.z = (WINDOW.z1 - 1.2) / 2 - o;
      sliderCol.z1 = WINDOW.z1 - o;
    },
  };
  win.set(0.14);

  // 家の外側：2階・屋根・南の壁の窓・基礎
  {
    const X0 = ROOM.minX - 0.14, X1 = ROOM.maxX + 0.14, Z0 = ROOM.minZ - 0.14, Z1 = ROOM.maxZ + 0.14;
    const W = X1 - X0, Dd = Z1 - Z0;
    box(home, W, 0.16, Dd, 0, ROOM.h, 0, 0xf6efe4, { cast: true });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(W, 2.6, Dd), gmat(TEX.siding, 0xf1e4cf, 0.9));
    worldUV(upper.geometry, 2.2);
    upper.position.set(0, ROOM.h + 0.16 + 1.3, 0);
    upper.castShadow = true;
    upper.receiveShadow = true;
    home.add(upper);
    const top = ROOM.h + 0.16 + 2.6;
    // 切妻屋根（棟は東西）
    const rise = 2.1, half = Dd / 2 + 0.6, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const rg = new THREE.BoxGeometry(W + 1.0, 0.18, len);
      const rm = new THREE.Mesh(rg, gmat(TEX.roof, 0x6d5c52, 0.8));
      worldUV(rg, 0.9);
      rm.position.set(0, top + rise / 2, s * half / 2);
      rm.rotation.x = s * ang;
      rm.castShadow = true;
      rm.receiveShadow = true;
      home.add(rm);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-Dd / 2, 0); tri.lineTo(Dd / 2, 0); tri.lineTo(0, rise * (Dd / 2) / half); tri.lineTo(-Dd / 2, 0);
    const tg = new THREE.ExtrudeGeometry(tri, { depth: W, bevelEnabled: false });
    tg.rotateY(Math.PI / 2);
    tg.translate(-W / 2, top, 0);
    const tm = new THREE.Mesh(tg, mat(0xf1e4cf));
    tm.castShadow = true;
    home.add(tm);
    // 2階の窓
    for (const x of [-2.6, 0, 2.6]) windowUnit(home, 1.1, 1.0, x, ROOM.h + 0.9, Z1 + 0.01);
    for (const z of [-1.5, 1.5]) windowUnit(home, 0.9, 1.0, X1 + 0.01, ROOM.h + 0.9, z, Math.PI / 2);
    // 1階・南の壁の窓（外から見ると明かりが灯る）
    windowUnit(home, 1.6, 1.2, 2.2, 1.0, Z1 + 0.01);
    box(home, 2.0, 0.08, 0.35, 2.2, 0.7, Z1 + 0.15, 0xe9e2d6);
    // 基礎（外周の帯。床の上には出さない）
    box(home, W + 0.16, 0.34, 0.08, 0, -0.12, Z0 - 0.04, 0xb9b3aa, { cast: false });
    box(home, W + 0.16, 0.34, 0.08, 0, -0.12, Z1 + 0.04, 0xb9b3aa, { cast: false });
    box(home, 0.08, 0.34, Dd, X0 - 0.04, -0.12, 0, 0xb9b3aa, { cast: false });
    box(home, 0.08, 0.34, Dd, X1 + 0.04, -0.12, 0, 0xb9b3aa, { cast: false });
    // 窓の上のひさし
    box(home, 0.9, 0.08, 4.0, X1 + 0.45, 2.45, (WINDOW.z0 + WINDOW.z1) / 2, 0xd9d2c6);
    // 玄関（南）
    box(home, 1.0, 2.1, 0.1, -2.6, 0, Z1, 0x8a5a3a, { cast: false });
    box(home, 1.5, 0.1, 0.9, -2.6, 2.35, Z1 + 0.45, 0xe8e2d8);
    box(home, 1.4, 0.12, 0.8, -2.6, 0, Z1 + 0.4, 0xb9b3aa);
    signBoard(home, 'うさの家', -1.55, 1.75, Z1 + 0.02, 0.5, 0.18, 0, { bg: '#f6efe2', fg: '#6b4a33', size: 60 });
  }
  // ウッドデッキ
  slab(home, col, ROOM.maxX + 0.14, ROOM.maxX + 2.2, -3.2, 0.9, 0.16, M.deck, 1.2, 0, 'deck');
  // 庭
  // 芝生は家の床の下には敷かない
  ground(home, 4.62, 13.5, -7, 5.6, M.lawn, 5, 0.001);
  ground(home, -6, -4.62, -7, 3.62, M.lawn, 5, 0.001);
  ground(home, -4.62, 4.62, -7, -3.62, M.lawn, 5, 0.001);
  ground(home, -6, 4.62, 3.62, 5.6, M.stone, 2.5, 0.004);
  // 飛び石
  for (let i = 0; i < 6; i++) {
    const s = cyl(home, 0.32, 0.34, 0.05, 6.8 + i * 0.6, 0, -0.6 + i * 1.0, 0xc9c2b6, 10, { cast: false });
    s.scale.set(1, 1, 0.8);
  }
  // 柵と塀
  const fenceZ = Z.home.z1;
  woodFence(home, 4.8, fenceZ, 9.35, fenceZ, 1.3);
  woodFence(home, 10.65, fenceZ, 13.5, fenceZ, 1.3);
  // 掘れる所の柵は下に隙間
  woodFence(home, 9.35, fenceZ, 10.65, fenceZ, 1.3);
  col.addBox(4.8, 9.35, fenceZ - 0.08, fenceZ + 0.08, 0, 1.3, 'fence');
  col.addBox(10.65, 13.5, fenceZ - 0.08, fenceZ + 0.08, 0, 1.3, 'fence');
  anchors.digBox = col.addBox(9.35, 10.65, fenceZ - 0.08, fenceZ + 0.08, 0, 1.3, 'fence');
  woodFence(home, 13.5, -7, 13.5, fenceZ, 1.3);
  col.addBox(13.42, 13.58, -7, fenceZ, 0, 1.3, 'fence');
  woodFence(home, 4.8, -7, 13.5, -7, 1.3);
  col.addBox(4.8, 13.5, -7.08, -6.92, 0, 1.3, 'fence');
  blockWall(home, -6, 4.8, -7.08, -6.92, 1.5);
  col.addBox(-6, 4.8, -7.08, -6.92, 0, 1.5, 'wall');
  blockWall(home, -6.08, -5.92, -7, fenceZ, 1.5);
  col.addBox(-6.08, -5.92, -7, fenceZ, 0, 1.5, 'wall');
  blockWall(home, -6, -1.1, fenceZ - 0.08, fenceZ + 0.08, 1.2);
  blockWall(home, 1.1, 4.8, fenceZ - 0.08, fenceZ + 0.08, 1.2);
  col.addBox(-6, 4.8, fenceZ - 0.08, fenceZ + 0.08, 0, 1.2, 'wall');
  // 門扉（閉まっている）
  for (let i = 0; i < 11; i++) box(home, 0.03, 1.05, 0.03, -1.0 + i * 0.2, 0.05, fenceZ, 0x4a4f55, { cast: true });
  box(home, 2.1, 0.05, 0.05, 0, 1.05, fenceZ, 0x4a4f55);
  box(home, 2.1, 0.05, 0.05, 0, 0.15, fenceZ, 0x4a4f55);
  // 掘る場所：柔らかい土と、柵の下のすき間
  const dirt = cyl(home, 0.55, 0.62, 0.05, DIG.x, 0, DIG.z - 0.45, 0x8a6446, 12, { cast: false });
  dirt.scale.set(1, 1, 0.7);
  anchors.digSoil = dirt;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0x2a1c14 }));
  hole.rotation.x = -Math.PI / 2;
  hole.scale.set(1, 0.7, 1);
  hole.position.set(DIG.x, 0.012, DIG.z);
  hole.visible = false;
  scene.add(hole);
  anchors.digHole = hole;
  // 犬小屋
  {
    const kx = 11.3, kz = -4.6;
    box(home, 1.1, 0.8, 1.0, kx, 0, kz, 0xd9a066, { round: 0.03 });
    for (const s of [-1, 1]) {
      const r = box(home, 0.7, 0.07, 1.2, kx + s * 0.3, 0.92, kz, 0xc0564a);
      r.rotation.z = -s * 0.62;
    }
    box(home, 0.45, 0.5, 0.03, kx, 0.05, kz + 0.5, 0x3b2a22, { cast: false });
    signBoard(home, 'USA', kx, 1.02, kz + 0.52, 0.34, 0.12, 0, { bg: '#fff6e0', fg: '#c0564a', size: 60 });
    col.addBox(kx - 0.55, kx + 0.55, kz - 0.5, kz + 0.5, 0, 0.8, 'kennel');
  }
  // 物干し
  {
    const x0 = 6.8, x1 = 10.6, z = -5.8;
    for (const x of [x0, x1]) { cyl(home, 0.04, 0.04, 1.9, x, 0, z, 0xd0d0cc, 8); col.addCircle(x, z, 0.08, 0, 2, 'pole'); }
    cyl(home, 0.02, 0.02, x1 - x0, (x0 + x1) / 2, 1.8, z, 0xd0d0cc, 6, { rz: Math.PI / 2 });
    const laundry = new THREE.Group();
    const cols = [0xffffff, 0x9fcfe8, 0xf7c9c0, 0xfff1b8];
    for (let i = 0; i < 5; i++) {
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62, 1, 3), new THREE.MeshStandardMaterial({ color: cols[i % 4], side: THREE.DoubleSide, roughness: 0.9 }));
      cl.geometry.translate(0, -0.31, 0);
      cl.position.set(x0 + 0.5 + i * 0.7, 1.8, z);
      cl.castShadow = true;
      cl.userData.noBake = true;
      laundry.add(cl);
    }
    scene.add(laundry);
    dynamic.push({ update: (dt, t) => laundry.children.forEach((c, i) => { c.rotation.x = Math.sin(t * 2.1 + i) * 0.18 + 0.12; }) });
  }
  // 花壇と植木
  flowerBed(home, 5.2, -6.6, 12.8, -6.0, 90, 3);
  box(home, 7.8, 0.2, 0.08, 9.0, 0, -5.92, 0xd8cfc0, { cast: false });
  tree(home, 12.3, 3.8, 'maple', 4, 0.9);
  col.addCircle(12.3, 3.8, 0.22, 0, 4, 'trunk');
  tree(home, -4.6, -5.6, 'garden', 6, 1);
  col.addCircle(-4.6, -5.6, 0.2, 0, 4, 'trunk');
  bush(home, 5.4, 4.8, 1, 11, true);
  bush(home, 12.8, -3, 0.9, 12, true);
  bush(home, -5.2, 4.6, 0.9, 14, false);
  pottedPlant(home, 5.0, -3.6, 1.2);
  pottedPlant(home, 5.0, 1.3, 1.0);
  pottedPlant(home, 3.4, 4.4, 1.1);
  // じょうろ
  cyl(home, 0.12, 0.14, 0.24, 6.3, 0, 2.8, 0x4fa3c8, 10);
  box(home, 0.3, 0.04, 0.04, 6.45, 0.18, 2.8, 0x4fa3c8, { rz: 0.6 });
  // 家庭菜園
  slab(home, null, 8.4, 11.6, -3.4, -1.6, 0.12, M.soil, 1.5, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) ball(home, 0.16, 8.8 + i * 0.8, 0.22, -3 + j * 0.9, [0x5f9a55, 0x7bb35a][j], { seg: 6, seg2: 4 });
  for (let i = 0; i < 4; i++) ball(home, 0.06, 8.85 + i * 0.8, 0.28, -2.95, 0xe85d45, { seg: 6, seg2: 4, cast: false });
  grassField(home, [[4.8, -6.8, 13.4, 5.4], [-5.9, -6.8, -4.7, 3.4]], 2200, (x, z) => (x > 8.3 && x < 11.7 && z > -3.5 && z < -1.5) || (x < 6.7 && z > -3.3 && z < 1.0), 21);
  // 近所の家（西）
  for (const [x, w] of [[-12.8, 10], [-24, 9]]) {
    const hs = makeHouse({ w, d: 8, floors: 2 });
    hs.position.set(x, 0, -0.2);
    home.add(hs);
  }
  // 家の北側
  for (const [x, z, w] of [[-10, -16, 9], [2, -15, 10], [14, -15, 8], [25, -16, 9]]) {
    const hs = makeHouse({ w, d: 8, floors: 2 });
    hs.position.set(x, 0, z);
    home.add(hs);
  }
  anchors.window = new THREE.Vector3(ROOM.maxX, 0, 0.3);
  anchors.bed = new THREE.Vector3(2.95, 0, -2.2);

  // ==========================================================
  // 2) 路地（東西の生活道路）
  // ==========================================================
  const lane = D('lane');
  ground(lane, Z.lane.x0, Z.lane.x1, Z.lane.z0, Z.lane.z1, M.lane, 5, 0.006);
  paint(lane, -29, 6.0, 38.5, 6.0, 0.12);
  paint(lane, -29, 10.9, 47.5, 10.9, 0.12);
  paint(lane, 38.5, 6.0, 38.5, 6.9, 0.3);
  decal(lane, '止まれ', 36.8, 8.4, 3.0, 1.2, Math.PI / 2);
  // マンホール
  for (const x of [3, 27]) cyl(lane, 0.32, 0.32, 0.012, x, 0.004, 8.6, mat(0x6b6a68, { rough: 0.6, metal: 0.3 }), 20, { cast: false });
  // 北側：隣の家と塀
  for (const [x, w, z] of [[19.2, 8.4, -0.6], [28.2, 6, 0.4]]) {
    const hs = makeHouse({ w, d: 7.5, floors: 2 });
    hs.position.set(x, 0, z);
    lane.add(hs);
  }
  blockWall(lane, 13.58, 32, 5.52, 5.68, 1.4);
  col.addBox(13.58, 32, 5.5, 5.7, 0, 1.4, 'wall');
  blockWall(lane, -30, -6.08, 5.52, 5.68, 1.4);
  col.addBox(-30, -6.08, 5.5, 5.7, 0, 1.4, 'wall');
  // 南側：家が並ぶ（正面は北向き）
  const southHouses = [[-24.5, 9], [-13.5, 9], [-2.5, 9.5], [8.5, 9], [19.5, 9], [30.5, 9], [41.5, 9]];
  for (const [x, w] of southHouses) {
    const hs = makeHouse({ w, d: 8, floors: 2 });
    hs.rotation.y = Math.PI;
    hs.position.set(x, 0, 17.6);
    lane.add(hs);
    // 前庭の植木と自転車
    if (R() < 0.7) pottedPlant(lane, x - w / 2 + 1.2, 12.3, 1.2);
    if (R() < 0.5) bicycle(lane, x + 2, 12.4, 0.2);
    // 門扉（塀の切れ目）
    for (let i = 0; i < 7; i++) box(lane, 0.03, 1.0, 0.03, x - 0.6 + i * 0.2, 0.05, 11.38, 0x4a4f55);
    box(lane, 1.3, 0.05, 0.05, x, 1.0, 11.38, 0x4a4f55);
    blockWall(lane, x - w / 2 - 1, x - 0.75, 11.3, 11.46, 1.4);
    blockWall(lane, x + 0.75, x + w / 2 + 1, 11.3, 11.46, 1.4);
  }
  col.addBox(-31, 48, 11.3, 11.5, 0, 1.4, 'wall');
  // 西の突き当たり：小さなお社
  {
    const sx = -28.6, sz = 8.45;
    box(lane, 1.6, 0.35, 1.4, sx, 0, sz, 0xb9b3aa);
    box(lane, 0.9, 0.8, 0.8, sx, 0.35, sz, 0xb98652);
    for (const s of [-1, 1]) { const r = box(lane, 0.7, 0.06, 1.1, sx + s * 0.25, 1.28, sz, 0x5b4a40); r.rotation.z = -s * 0.5; }
    // 鳥居
    for (const s of [-1, 1]) cyl(lane, 0.07, 0.08, 1.9, sx + 1.5, 0, sz + s * 0.6, 0xd8452f, 8);
    box(lane, 0.14, 0.12, 1.8, sx + 1.5, 1.85, sz, 0xd8452f);
    box(lane, 0.18, 0.12, 1.5, sx + 1.5, 1.55, sz, 0xd8452f);
    col.addBox(sx - 0.8, sx + 0.8, sz - 0.7, sz + 0.7, 0, 1.1, 'shrine');
    blockWall(lane, -31, -30.2, 5.6, 11.3, 1.6);
    col.addBox(-31, -29.8, 5.6, 11.3, 0, 1.6, 'wall');
    anchors.shrine = new THREE.Vector3(sx + 1.2, 0, sz);
  }
  // 電柱と電線・街灯
  const poleTops = [];
  for (const x of [-22, -6, 9, 24, 38]) {
    poleTops.push(utilityPole(lane, x, 11.0));
    col.addCircle(x, 11.0, 0.2, 0, 9, 'pole');
    streetLamp(lane, x, 10.85, Math.PI, 4.3);
    pools.add(x, 10.0, 2.6);
  }
  wires(lane, poleTops, 0.6);
  mirror(lane, 38.2, 11.0, Math.PI * 0.8);
  // 自販機とゴミ置き場
  vendingMachine(lane, 33.4, 6.05, 0, 0xd9453f);
  col.addBox(32.9, 33.9, 5.7, 6.45, 0, 1.85, 'vend');
  vendingMachine(lane, 34.5, 6.05, 0, 0x3e7fc4);
  col.addBox(34.0, 35.0, 5.7, 6.45, 0, 1.85, 'vend');
  pools.add(34, 6.8, 1.6);
  {
    // ゴミ置き場（ネットのかかった箱）→ 塀に登れる
    const gx = 27.2, gz = 6.15;
    box(lane, 1.4, 0.7, 0.8, gx, 0, gz, 0x5d8a6c, { round: 0.04 });
    box(lane, 1.44, 0.04, 0.84, gx, 0.7, gz, 0x3f6b52);
    for (let i = 0; i < 3; i++) ball(lane, 0.2, gx - 0.4 + i * 0.4, 0.8, gz, [0xf4f1ea, 0xe8e4f0, 0xf0ebdf][i], { seg: 6, seg2: 5 });
    col.addBox(gx - 0.7, gx + 0.7, gz - 0.4, gz + 0.4, 0, 0.7, 'trash');
    anchors.trash = new THREE.Vector3(gx, 0.7, gz);
  }
  // 植木鉢・自転車
  for (const x of [-18, -3, 16.2, 22]) pottedPlant(lane, x, 6.0, 1.1);
  for (const x of [-18, -3, 16.2, 22]) col.addCircle(x, 6.0, 0.2, 0, 0.6, 'pot');
  bicycle(lane, 5.5, 6.25, 0.05);
  col.addBox(4.8, 6.2, 5.9, 6.6, 0, 0.9, 'bike');
  anchors.catWall = new THREE.Vector3(21.5, 1.4, 5.6);
  anchors.capWall = new THREE.Vector3(17.2, 1.4, 5.6);
  // 東の突き当たり：マンション
  {
    const mg = new THREE.Group();
    const w = 12, d = 16, h = 12.4;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gmat(TEX.siding, 0xe7e1d6, 0.9));
    worldUV(b.geometry, 2.2);
    b.position.set(0, h / 2, 0);
    b.castShadow = b.receiveShadow = true;
    mg.add(b);
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < 4; i++) windowUnit(mg, 1.3, 1.2, -w / 2 - 0.02, f * 3.1 + 1.3, -d / 2 + 2 + i * 4, -Math.PI / 2);
      box(mg, 0.9, 0.1, d - 1, -w / 2 - 0.45, f * 3.1 + 0.2, 0, 0xd8d2c6);
      box(mg, 0.05, 1.0, d - 1, -w / 2 - 0.88, f * 3.1 + 0.3, 0, 0xcfc8bb);
    }
    mg.position.set(54.2, 0, 14.2);
    lane.add(mg);
    col.addBox(48, 60.2, 6.2, 22.2, 0, 12, 'building');
    col.addBox(47.4, 48.2, 5.6, 11.3, 0, 1.5, 'wall');
    blockWall(lane, 47.3, 48.1, 5.6, 11.3, 1.5);
  }

  // ==========================================================
  // 3) 商店街「ひだまり商店街」
  // ==========================================================
  const st = D('street');
  ground(st, Z.street.x0, Z.street.x1, Z.street.z0, Z.street.z1, M.arcade, 2.4, 0.008);
  // 中央の色タイルの帯
  ground(st, 42.4, 43.6, Z.street.z0, Z.street.z1, gmat(TEX.plaza, 0xe9c9a3, 0.85), 1.6, 0.01);
  const shopsW = [
    ['うおまさ', '鮮魚', 'fish', true], ['やおよし', '八百屋', 'veg', false], ['こむぎ堂', 'パン', 'bread', false],
    ['みどり園', 'お茶', 'tea', true], ['ひだまり書店', '本', 'book', false], ['まるや', '駄菓子', 'candy', false], ['はなぞの', '花', 'flower', false],
  ];
  const shopsE = [
    ['たなか精肉店', 'コロッケ', 'meat', true], ['喫茶こもれび', '珈琲', 'box', true], ['とうふ山本', 'とうふ', 'box', true],
    ['さくら薬局', 'くすり', 'box', false], ['和菓子 月見', '和菓子', 'candy', true], ['ようふく堀', '洋品', 'box', false],
  ];
  const shopW = 7.2;
  anchors.shops = {};
  shopsW.forEach(([name, sub, goods, noren], i) => {
    const zc = 1.9 - i * shopW;
    const s = makeShop({ w: shopW - 0.1, d: 7, name, sub, goods, noren: noren ? name.slice(0, 2) : false });
    s.rotation.y = Math.PI / 2;
    s.position.set(39 - 3.5, 0, zc);
    st.add(s);
    col.addBox(32, 39, zc - shopW / 2, zc + shopW / 2, 0, 5.7, 'shop');
    rooftop(st, 35.5, zc, 6, 6);
    anchors.shops[goods === 'fish' ? 'fish' : goods === 'flower' ? 'flower' : goods === 'veg' ? 'veg' : name] = new THREE.Vector3(39.9, 0, zc);
    pools.add(40.5, zc - 1.8, 2.2);
    pools.add(40.5, zc + 1.8, 2.2);
  });
  // 東側（北の端から交番まで）
  shopsE.forEach(([name, sub, goods, noren], i) => {
    const zc = -5.3 - i * shopW;
    const s = makeShop({ w: shopW - 0.1, d: 7, name, sub, goods, noren: noren ? name.slice(0, 2) : false });
    s.rotation.y = -Math.PI / 2;
    s.position.set(47 + 3.5, 0, zc);
    st.add(s);
    col.addBox(47, 54, zc - shopW / 2, zc + shopW / 2, 0, 5.7, 'shop');
    rooftop(st, 50.5, zc, 6, 6);
    if (goods === 'meat') anchors.shops.meat = new THREE.Vector3(46.1, 0, zc);
    pools.add(45.5, zc - 1.8, 2.2);
    pools.add(45.5, zc + 1.8, 2.2);
  });
  // 北端は塀
  blockWall(st, 47, 47.2, -49.5, -44.9, 1.5);
  col.addBox(47, 47.3, -49.5, -44.9, 0, 1.5, 'wall');
  blockWall(st, 38.8, 39, -49.5, -44.9, 1.5);
  col.addBox(38.7, 39, -49.5, -44.9, 0, 1.5, 'wall');
  // 交番
  {
    const kg = new THREE.Group();
    const kx = 50.5, kz = 1.9;
    box(kg, 6.6, 3.6, 7.2, 0, 0, 0, 0xf2efe8);
    box(kg, 7.0, 0.3, 7.6, 0, 3.6, 0, 0x3b4a5e);
    box(kg, 0.1, 2.2, 2.4, -3.33, 0.2, 0.6, 0x9fb6c9, { cast: false });
    windowUnit(kg, 1.6, 1.1, -3.32, 1.1, -1.8, -Math.PI / 2, true);
    const lamp = ball(kg, 0.22, -3.5, 3.1, 0.6, LIGHTS.make(0xff3a2a, 0.9, 3.2, 0xff5a4a), { seg: 12, seg2: 10, cast: false });
    lamp.userData.lamp = true;
    signBoard(kg, '交番', -3.36, 2.8, -1.4, 1.3, 0.5, -Math.PI / 2, { bg: '#ffffff', fg: '#27406b', size: 150 });
    kg.position.set(kx, 0, kz);
    st.add(kg);
    col.addBox(47, 53.8, -1.8, 5.6, 0, 3.9, 'koban');
    anchors.koban = new THREE.Vector3(46.3, 0, 2.3);
  }
  // アーチ（入口と出口）
  const arch = (z, faceSign) => {
    for (const x of [39.35, 46.65]) {
      cyl(st, 0.16, 0.18, 5.2, x, 0, z, mat(0x8a5a3a, { rough: 0.6 }), 10);
      col.addCircle(x, z, 0.22, 0, 6, 'arch');
    }
    box(st, 8.2, 1.15, 0.36, 43, 4.9, z, 0x8a5a3a, { round: 0.06 });
    box(st, 8.6, 0.18, 0.7, 43, 6.05, z, 0x5b3a2a);
    for (const s of [1, -1]) {
      signBoard(st, 'ひだまり商店街', 43, 5.47, z + s * 0.19, 7.4, 0.9, s > 0 ? 0 : Math.PI, { bg: '#fff3dd', fg: '#b4452f', size: 88, glow: 0.35 });
    }
    // 提灯
    for (let i = 0; i < 6; i++) {
      const l = ball(st, 0.2, 39.9 + i * 1.24, 4.62, z + faceSign * 0.3, LM.lantern, { sx: 1, sy: 1.25, sz: 1, seg: 10, seg2: 8, cast: false });
      l.userData.lantern = true;
    }
  };
  arch(5.1, 1);
  arch(-49.2, -1);
  anchors.archTop = new THREE.Vector3(43, 6.25, 5.1);
  // 通りを横切る提灯の列
  for (let k = 0; k < 7; k++) {
    const z = -1.7 - k * shopW;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(39.3 + 7.4 * t, 4.8 - Math.sin(t * Math.PI) * 0.45, z));
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.012, 3), mat(0x3b3330));
    m.castShadow = false;
    st.add(m);
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const l = ball(st, 0.17, 39.3 + 7.4 * t, 4.8 - Math.sin(t * Math.PI) * 0.45 - 0.28, z, k % 2 ? LM.lantern : LM.lamp, { sx: 1, sy: 1.3, sz: 1, seg: 10, seg2: 8, cast: false });
      l.userData.lantern = true;
    }
    pools.add(43, z, 3.2);
  }
  // 通りの小物
  bench(st, 43, -18.5, Math.PI / 2, 0xb98652);
  col.addBox(42.6, 43.4, -19.3, -17.7, 0, 0.45, 'bench');
  bench(st, 43, -33, -Math.PI / 2, 0xb98652);
  col.addBox(42.6, 43.4, -33.8, -32.2, 0, 0.45, 'bench');
  for (const z of [-11, -26, -40.5]) {
    slab(st, col, 42.3, 43.7, z - 0.7, z + 0.7, 0.45, M.wood, 1, 0, 'planter');
    bush(st, 43, z, 0.8, Math.floor(z * -3), true);
  }
  // のぼり旗
  const flagCols = ['#d94f6b', '#3e6ea8', '#f0a13a', '#3f8f6a'];
  const flagText = ['大売出し', 'コロッケ', '本日特売', 'できたて'];
  for (let i = 0; i < 8; i++) {
    const west = i % 2 === 0;
    const x = west ? 39.5 : 46.5, z = -4 - i * 5.6;
    cyl(st, 0.025, 0.025, 2.4, x, 0, z, 0xdcdcd8, 6);
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.6), new THREE.MeshStandardMaterial({ map: signTex(flagText[i % 4], { w: 128, h: 420, size: 80, vertical: true, bg: flagCols[i % 4], fg: '#ffffff' }), side: THREE.DoubleSide, roughness: 0.9 }));
    fm.position.set(x + (west ? 0.26 : -0.26), 1.55, z);
    fm.rotation.y = Math.PI / 2;
    fm.castShadow = true;
    fm.userData.noBake = true;
    st.add(fm);
    col.addCircle(x, z, 0.06, 0, 2.4, 'thin');
  }
  // 魚屋の前の木箱（登れる）
  crate(st, 39.7, 0, 3.2, 0.8, 0.45, 0.6, 0x9fb6c9);
  crate(st, 39.7, 0.45, 3.2, 0.8, 0.45, 0.6, 0xc9975f);
  col.addBox(39.3, 40.1, 2.9, 3.5, 0, 0.9, 'crate');
  crate(st, 39.75, 0, 2.3, 0.8, 0.45, 0.6, 0xc9975f);
  col.addBox(39.35, 40.15, 2.0, 2.6, 0, 0.45, 'crate');
  bicycle(st, 46.3, -9.5, Math.PI / 2);
  bicycle(st, 46.3, -10.4, Math.PI / 2);
  col.addBox(45.9, 46.7, -11, -8.9, 0, 0.9, 'bike');
  postBox(st, 46.4, -44);
  col.addCircle(46.4, -44, 0.3, 0, 1.4, 'post');
  // カプセルトイ（駄菓子屋）
  for (let i = 0; i < 3; i++) {
    box(st, 0.5, 1.1, 0.45, 39.35, 0, -34.2 + i * 0.55, [0xf2c23a, 0x3e8fd8, 0xe8604c][i], { round: 0.03 });
    ball(st, 0.18, 39.35, 1.25, -34.2 + i * 0.55, mat(0xffffff, { rough: 0.1, transparent: true, opacity: 0.6 }), { cast: false });
  }
  col.addBox(39.1, 39.6, -34.5, -32.8, 0, 1.1, 'gacha');
  anchors.gacha = new THREE.Vector3(40, 0, -33.6);

  // ==========================================================
  // 4) さくら公園
  // ==========================================================
  const park = D('park');
  ground(park, Z.park.x0, Z.park.x1, Z.park.z0, Z.park.z1, M.grass, 5, 0.004);
  // 小道（砂利）
  const pathPts = [[43, -49.5], [43.8, -54], [48, -59], [55, -62.5], [64, -66], [72, -70], [79, -72]];
  const pathW = 3.2;
  const pathLoop = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    pathLoop.push([52 + Math.cos(a) * 12.5, -80 + Math.sin(a) * 9.5]);
  }
  pathLoop.push(pathLoop[0]);
  const strip = (pts, w, material, y) => {
    const pos = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      const nx = -dz / l * w / 2, nz = dx / l * w / 2;
      const ex = dx / l * w * 0.3, ez = dz / l * w * 0.3;
      const A = [ax - nx - ex, az - nz - ez], B = [ax + nx - ex, az + nz - ez], C = [bx + nx + ex, bz + nz + ez], Dd = [bx - nx + ex, bz - nz + ez];
      pos.push(A[0], y, A[1], C[0], y, C[1], B[0], y, B[1], A[0], y, A[1], Dd[0], y, Dd[1], C[0], y, C[1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 3, -pos[i + 2] / 3);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    park.add(m);
  };
  strip(pathPts, pathW, M.path, 0.012);
  strip(pathLoop, 2.4, M.path, 0.011);
  strip([[36, -66], [44, -72], [40.2, -80]], 2.2, M.path, 0.013);
  // 池
  const POND = { x: 52, z: -80, rx: 8.6, rz: 5.8 };
  {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, POND.rx, POND.rz, 0, Math.PI * 2);
    const bg = new THREE.ShapeGeometry(shape, 40);
    bg.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bg, mat(0x44695e, { rough: 1 }));
    bed.position.set(POND.x, 0.014, POND.z);
    park.add(bed);
    const wg = new THREE.ShapeGeometry(shape, 40);
    wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, waterMaterial(day));
    water.position.set(POND.x, 0.1, POND.z);
    water.renderOrder = 1;
    scene.add(water);
    anchors.water = water;
    dynamic.push({ update: (dt) => { water.material.uniforms.uTime.value += dt; } });
    // 石の縁
    const rr = mulberry32(31);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const s = 0.42 + rr() * 0.25;
      const st2 = ball(park, s, POND.x + Math.cos(a) * (POND.rx + 0.15), 0.05, POND.z + Math.sin(a) * (POND.rz + 0.15), [0xb3aa9c, 0xa39a8c, 0xc2baad][i % 3], { sx: 1.2, sy: 0.55, sz: 1, seg: 6, seg2: 4 });
      st2.rotation.y = rr() * 3;
    }
    // 当たり：楕円を円で埋める
    for (let i = 0; i < 9; i++) {
      const x = POND.x - POND.rx + 1.2 + (i / 8) * (POND.rx * 2 - 2.4);
      const k = Math.sqrt(Math.max(0, 1 - ((x - POND.x) / POND.rx) ** 2));
      col.addCircle(x, POND.z, Math.max(1.4, POND.rz * k * 0.98), 0, 0.5, 'pond');
    }
    // 蓮の葉
    for (let i = 0; i < 9; i++) {
      const a = rr() * Math.PI * 2, d = 0.4 + rr() * 0.5;
      const lp = cyl(park, 0.35, 0.35, 0.02, POND.x + Math.cos(a) * POND.rx * d, 0.1, POND.z + Math.sin(a) * POND.rz * d, 0x5f9a55, 10, { cast: false });
      lp.scale.set(1, 1, 0.9);
      if (i % 3 === 0) ball(park, 0.1, lp.position.x + 0.1, 0.18, lp.position.z, 0xf6c2cf, { seg: 6, seg2: 4, cast: false });
    }
    anchors.pond = new THREE.Vector3(POND.x, 0.1, POND.z);
    anchors.pondR = POND;
  }
  // 桜並木（池のまわりと小道）
  const sakura = [[46, -69.5], [58.5, -70.5], [63.5, -83], [44, -89.5], [38.5, -79.5], [66.5, -60.5], [50.5, -55.5], [57, -91.5], [72, -78]];
  sakura.forEach(([x, z], i) => {
    const t = tree(park, x, z, 'sakura', 40 + i, 1.25);
    col.addCircle(x, z, 0.3, 0, 5, 'trunk');
    petalsEmit.push({ x, z, r: 2.6, h: t.h * 1.1 });
  });
  for (const [x, z, k] of [[30, -54, 'keyaki'], [30, -92, 'keyaki'], [76, -54, 'ginkgo'], [76, -92, 'keyaki'], [66, -94, 'keyaki'], [28.5, -70, 'keyaki']]) {
    tree(park, x, z, k, Math.floor(x * z), 1.2);
    col.addCircle(x, z, 0.3, 0, 5, 'trunk');
  }
  // 砂場（掘れる）
  {
    const sx = 34.5, sz = -59.5;
    slab(park, col, sx - 3.1, sx + 3.1, sz - 2.4, sz - 2.2, 0.28, M.wood, 1, 0, 'rim');
    slab(park, col, sx - 3.1, sx + 3.1, sz + 2.2, sz + 2.4, 0.28, M.wood, 1, 0, 'rim');
    slab(park, col, sx - 3.1, sx - 2.9, sz - 2.2, sz + 2.2, 0.28, M.wood, 1, 0, 'rim');
    slab(park, col, sx + 2.9, sx + 3.1, sz - 2.2, sz + 2.2, 0.28, M.wood, 1, 0, 'rim');
    ground(park, sx - 2.9, sx + 2.9, sz - 2.2, sz + 2.2, M.sand, 2, 0.1);
    // 砂の山とバケツ
    const hill = ball(park, 0.8, sx + 1.2, 0.05, sz - 0.6, 0xe0cba0, { sx: 1, sy: 0.4, sz: 1, seg: 10, seg2: 6 });
    hill.castShadow = false;
    cyl(park, 0.14, 0.11, 0.2, sx - 1.5, 0.1, sz + 1.2, 0xe8604c, 10);
    box(park, 0.3, 0.03, 0.12, sx - 1.1, 0.1, sz + 1.5, 0x3e8fd8, { ry: 0.6 });
    anchors.sandbox = new THREE.Vector3(sx, 0.1, sz);
  }
  // すべり台（階段で上って、すべれる）
  {
    const sx = 35, sz = -72;
    const plat = 1.62;
    for (let i = 0; i < 5; i++) {
      slab(park, col, sx - 0.5, sx + 0.5, sz + 1.6 - i * 0.32, sz + 1.92 - i * 0.32, 0.32 * (i + 1), mat(0x3e8fd8, { rough: 0.5 }), 1, 0, 'step');
    }
    slab(park, col, sx - 0.65, sx + 0.65, sz - 0.3, sz + 0.3, plat, mat(0xf2c23a, { rough: 0.5 }), 1, 0, 'slidetop');
    // 手すり
    for (const s of [-1, 1]) box(park, 0.05, 0.6, 0.6, sx + s * 0.62, plat, sz, 0xe8604c, { cast: true });
    // すべる面
    const len = 3.4, ang = Math.atan2(plat, 3.0);
    const sl = box(park, 0.9, 0.06, len, sx, 0, sz - 0.3 - 1.5, mat(0xe8604c, { rough: 0.35 }), { cast: true });
    sl.position.y = plat / 2;
    sl.rotation.x = -ang;
    for (const s of [-1, 1]) {
      const rail = box(park, 0.05, 0.18, len, sx + s * 0.45, 0, sz - 0.3 - 1.5, mat(0xe8604c, { rough: 0.35 }), { cast: false });
      rail.position.y = plat / 2 + 0.1;
      rail.rotation.x = -ang;
    }
    anchors.slide = { top: new THREE.Vector3(sx, plat, sz - 0.2), bottom: new THREE.Vector3(sx, 0, sz - 3.6), dir: new THREE.Vector3(0, 0, -1) };
  }
  // ブランコ
  {
    const bx = 41, bz = -88.5;
    for (const s of [-1, 1]) {
      const p = cyl(park, 0.06, 0.06, 2.4, bx + s * 1.6, 0, bz, 0x3f8f6a, 8);
      p.rotation.z = s * 0.12;
      col.addCircle(bx + s * 1.6, bz, 0.1, 0, 2.4, 'pole');
    }
    cyl(park, 0.05, 0.05, 3.4, bx, 2.35, bz, 0x3f8f6a, 8, { rz: Math.PI / 2 });
    const sw = new THREE.Group();
    for (const o of [-0.7, 0.7]) {
      const seat = new THREE.Group();
      box(seat, 0.5, 0.05, 0.22, 0, -1.75, 0, 0xe8604c);
      for (const s of [-1, 1]) box(seat, 0.015, 1.75, 0.015, s * 0.22, -1.75, 0, 0x777777, { cast: false });
      seat.position.set(bx + o, 2.35, bz);
      sw.add(seat);
    }
    scene.add(sw);
    dynamic.push({ update: (dt, t) => sw.children.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.6 + i * 1.3) * 0.08; }) });
  }
  // ベンチと公園灯
  for (const [x, z, ry] of [[48.5, -63.5, -0.4], [61, -67.8, -0.35], [44.5, -76, Math.PI / 2], [59, -87, Math.PI]]) {
    bench(park, x, z, ry);
    col.addCircle(x, z, 0.55, 0, 0.45, 'bench');
  }
  for (const [x, z] of [[46, -58], [57, -65.5], [68, -69.5], [40, -74], [62, -76], [48, -90], [74, -73.5]]) {
    parkLamp(park, x, z);
    col.addCircle(x, z, 0.1, 0, 3.5, 'pole');
    pools.add(x, z, 3.2);
  }
  // 水飲み場
  cyl(park, 0.25, 0.3, 0.8, 66, 0, -62.5, 0xc2baad, 10);
  col.addCircle(66, -62.5, 0.32, 0, 0.8, 'fountain');
  // 花壇
  flowerBed(park, 45, -52.5, 49, -51, 70, 23, [0xf6d35a, 0xf28aa8, 0xffffff]);
  flowerBed(park, 64, -94.5, 70, -93, 80, 24);
  // 生け垣（境界）
  hedge(park, 26, -49.5, 39, -49.5, 1.1, 41);
  hedge(park, 47, -49.5, 79, -49.5, 1.1, 42);
  col.addBox(26, 39, -50.1, -48.9, 0, 1.2, 'hedge');
  col.addBox(47, 79, -50.1, -48.9, 0, 1.2, 'hedge');
  hedge(park, 26, -49.5, 26, -96, 1.1, 43);
  col.addBox(25.4, 26.6, -96, -49.5, 0, 1.2, 'hedge');
  hedge(park, 26, -96, 79, -96, 1.1, 44);
  col.addBox(26, 79, -96.6, -95.4, 0, 1.2, 'hedge');
  hedge(park, 79, -49.5, 79, -69, 1.1, 45);
  hedge(park, 79, -75, 79, -96, 1.1, 46);
  col.addBox(78.4, 79.6, -69, -49.5, 0, 1.2, 'hedge');
  col.addBox(78.4, 79.6, -96, -75, 0, 1.2, 'hedge');
  // 茂み（ボールが転がりこんでいる）
  bush(park, 29, -84, 1.3, 51, true);
  bush(park, 30.2, -86, 1.1, 52, false);
  bush(park, 70, -90, 1.2, 53, true);
  anchors.ballBush = new THREE.Vector3(29.8, 0, -85.2);
  // 草
  grassField(park, [[26.5, -95.5, 78.5, -50]], 9000, (x, z) => {
    if (((x - POND.x) / (POND.rx + 1.2)) ** 2 + ((z - POND.z) / (POND.rz + 1.2)) ** 2 < 1) return true;
    if (x > 31 && x < 38 && z > -62.5 && z < -56.5) return true;
    for (let i = 0; i < pathPts.length - 1; i++) {
      const [ax, az] = pathPts[i], [bx, bz] = pathPts[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < pathW * 0.6) return true;
    }
    const dl = Math.hypot((x - 52) / 12.5, (z + 80) / 9.5);
    if (Math.abs(dl - 1) < 0.11) return true;
    return false;
  }, 22, -0.01);
  // 公園の外（西・北）の家並み
  for (let i = 0; i < 5; i++) {
    const hs = makeHouse({ w: 9, d: 8, floors: 2 });
    hs.rotation.y = -Math.PI / 2;
    hs.position.set(20.5, 0, -56 - i * 9.5);
    park.add(hs);
  }
  for (let i = 0; i < 6; i++) {
    const hs = makeHouse({ w: 8.5, d: 8, floors: 2 + (i % 2) });
    hs.position.set(30 + i * 9.2, 0, -102);
    park.add(hs);
  }

  // ==========================================================
  // 5) 大通りと横断歩道
  // ==========================================================
  const road = D('road');
  const RZ0 = -260, RZ1 = 120;
  ground(road, Z.road.x0, Z.road.x1, RZ0, RZ1, M.asphalt, 6, 0.008);
  // 歩道（縁石で一段高い）
  slab(road, col, 79, 81, -96, -49.5, 0.15, M.walk, 2, 0, 'walk');
  slab(road, col, 93, 95, -100, -44, 0.15, M.walk, 2, 0, 'walk');
  slab(road, null, 79, 81, RZ0, -96, 0.15, M.walk, 2);
  slab(road, null, 79, 81, -49.5, RZ1, 0.15, M.walk, 2);
  slab(road, null, 93, 95, RZ0, -100, 0.15, M.walk, 2);
  slab(road, null, 93, 95, -44, RZ1, 0.15, M.walk, 2);
  box(road, 0.14, 0.17, 380, 81, 0, (RZ0 + RZ1) / 2, 0xcfc8bb, { cast: false });
  box(road, 0.14, 0.17, 380, 93, 0, (RZ0 + RZ1) / 2, 0xcfc8bb, { cast: false });
  // 車線
  paint(road, 87, RZ0, 87, -77.2, 0.16, 0xf2c23a);
  paint(road, 87, -66.8, 87, RZ1, 0.16, 0xf2c23a);
  for (let z = RZ0; z < RZ1; z += 8) {
    if (z > -80 && z < -62) continue;
    paint(road, 84.1 - 1.4, z, 84.1 - 1.4, z + 4, 0.12);
    paint(road, 89.9 + 1.4, z, 89.9 + 1.4, z + 4, 0.12);
  }
  // 横断歩道のしま
  for (let x = 81.6; x < 92.6; x += 0.9) paint(road, x, -73.8, x, -70.2, 0.5, 0xf4f1ea, 0.013);
  paint(road, 81.2, ROAD.stopN, 86.8, ROAD.stopN, 0.35);
  paint(road, 87.2, ROAD.stopS, 92.8, ROAD.stopS, 0.35);
  // ガードレール（横断歩道だけあいている）
  guardrail(road, 80.85, -96, 80.85, -75);
  guardrail(road, 80.85, -69, 80.85, -49.5);
  guardrail(road, 93.15, -100, 93.15, -75);
  guardrail(road, 93.15, -69, 93.15, -44);
  col.addBox(80.75, 80.95, -96, -75, 0, 0.9, 'rail');
  col.addBox(80.75, 80.95, -69, -49.5, 0, 0.9, 'rail');
  col.addBox(93.05, 93.25, -100, -75, 0, 0.9, 'rail');
  col.addBox(93.05, 93.25, -69, -44, 0, 0.9, 'rail');
  // 道路の端（犬だけが通れない見えない壁）
  col.addBox(79, 95, -101, -100, 0, 3, 'edge');
  col.addBox(79, 95, -44, -43, 0, 3, 'edge');
  col.addBox(79, 81, -97, -96, 0, 3, 'edge');
  col.addBox(79, 81, -49.5, -48.5, 0, 3, 'edge');
  // 信号機
  const signals = { car: [], ped: [] };
  const sigMat = (c) => new THREE.MeshStandardMaterial({ color: 0x222222, emissive: c, emissiveIntensity: 0.05, roughness: 0.4 });
  const makeCarSignal = (x, z, ry) => {
    const g = new THREE.Group();
    cyl(g, 0.09, 0.1, 5.2, 0, 0, 0, 0x8e949a, 8);
    box(g, 0.1, 0.1, 3.4, 0, 5.0, -1.6, 0x8e949a);
    box(g, 0.34, 0.36, 1.3, 0, 4.7, -3.0, 0x3c4146, { round: 0.04 });
    const lights = [0x2fd17a, 0xf2c23a, 0xff3a2a].map((c, i) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), sigMat(c));
      m.position.set(0.18, 4.88, -3.4 + i * 0.4);
      m.rotation.y = Math.PI / 2;
      g.add(m);
      return m;
    });
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    road.add(g);
    signals.car.push(lights);
    return g;
  };
  makeCarSignal(80.6, ROAD.stopN + 0.4, Math.PI);
  makeCarSignal(93.4, ROAD.stopS - 0.4, 0);
  const makePedSignal = (x, z, ry) => {
    const g = new THREE.Group();
    cyl(g, 0.07, 0.07, 2.9, 0, 0, 0, 0x8e949a, 8);
    box(g, 0.34, 0.8, 0.2, 0, 2.2, 0, 0x3c4146, { round: 0.03 });
    const red = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.3), sigMat(0xff3a2a));
    red.position.set(0, 2.8, 0.11);
    const green = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.3), sigMat(0x2fd17a));
    green.position.set(0, 2.42, 0.11);
    g.add(red, green);
    // 人の形（簡単なアイコン）
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    road.add(g);
    signals.ped.push([green, red]);
    return g;
  };
  makePedSignal(80.3, -75.2, Math.PI / 2);
  makePedSignal(93.7, -68.8, -Math.PI / 2);
  col.addCircle(80.3, -75.2, 0.1, 0, 3, 'pole');
  col.addCircle(93.7, -68.8, 0.1, 0, 3, 'pole');
  anchors.crossW = new THREE.Vector3(80.2, 0.15, -72);
  anchors.crossE = new THREE.Vector3(94, 0.15, -72);
  // 街路樹（イチョウ）と街灯
  for (let z = -240; z < 110; z += 14) {
    if (z > -78 && z < -66) continue;
    tree(road, 79.8, z, 'ginkgo', Math.abs(z) + 3, 1.1);
    tree(road, 94.2, z + 7, 'ginkgo', Math.abs(z) + 9, 1.1);
    if (z > -100 && z < -44) {
      col.addCircle(79.8, z, 0.25, 0, 5, 'trunk');
      col.addCircle(94.2, z + 7, 0.25, 0, 5, 'trunk');
    }
  }
  for (let z = -236; z < 110; z += 22) {
    streetLamp(road, 80.1, z, Math.PI / 2, 5.4);
    streetLamp(road, 93.9, z + 11, -Math.PI / 2, 5.4);
    pools.add(81.2, z, 3.4);
    pools.add(92.8, z + 11, 3.4);
  }
  anchors.signals = signals;

  // ==========================================================
  // 6) 駅前広場と駅
  // ==========================================================
  const plaza = D('plaza');
  slab(plaza, col, Z.plaza.x0, Z.plaza.x1 + 2, Z.plaza.z0, Z.plaza.z1, 0.15, M.plaza, 2.4, 0, 'plaza');
  // 時計塔（ゲーム内の時刻を指す）
  const clockTower = new THREE.Group();
  {
    const cx = 112, cz = -55.5;
    box(clockTower, 1.6, 9.5, 1.6, 0, 0, 0, 0xd8cdbd);
    box(clockTower, 2.0, 0.4, 2.0, 0, 0, 0, 0xb9ae9e);
    box(clockTower, 2.1, 2.2, 2.1, 0, 9.5, 0, 0x8a5a3a);
    box(clockTower, 2.4, 0.2, 2.4, 0, 11.7, 0, 0x5b3a2a);
    const roof = cyl(clockTower, 0.05, 1.6, 1.4, 0, 11.9, 0, 0x4c5b78, 4);
    roof.rotation.y = Math.PI / 4;
    clockTower.position.set(cx, 0.15, cz);
    plaza.add(clockTower);
    col.addBox(cx - 1, cx + 1, cz - 1, cz + 1, 0, 12, 'tower');
    anchors.clockTower = clockTower;
  }
  const clockFaces = [];
  {
    const faceM = LIGHTS.make(0xfff1d6, 0.25, 1.8, 0xfffaf0);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const f = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), faceM);
      f.add(disk);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 32), mat(0x3b3330));
      f.add(rim);
      const hh = new THREE.Group(), mh = new THREE.Group();
      const hm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.02), mat(0x2a2320));
      hm.position.y = 0.2;
      hh.add(hm);
      const mm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), mat(0x2a2320));
      mm.position.y = 0.31;
      mh.add(mm);
      hh.position.z = mh.position.z = 0.03;
      f.add(hh, mh);
      f.position.set(Math.sin(a) * 1.07, 10.6, Math.cos(a) * 1.07);
      f.rotation.y = a;
      clockTower.add(f);
      clockFaces.push({ hh, mh });
    }
  }
  // 犬の像（台座に登れる）
  {
    const sx = 108, sz = -78.5;
    slab(plaza, col, sx - 1.6, sx + 1.6, sz - 1.6, sz + 1.6, 0.5, M.stone, 1.5, 0.15, 'ped1');
    slab(plaza, col, sx - 0.95, sx + 0.95, sz - 0.95, sz + 0.95, 0.75, M.stone, 1.5, 0.65, 'ped2');
    const statue = buildDog({ ...breedParams('shiba', ''), fluff: 0.2 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.35, metalness: 0.75, flatShading: true });
    statue.root.traverse((o) => { if (o.isMesh) { o.material = bronze; o.castShadow = true; o.userData.statue = true; } });
    if (statue.blob) statue.blob.visible = false;
    statue.root.scale.setScalar(2.2);
    statue.root.position.set(sx, 1.4, sz);
    statue.root.rotation.y = Math.PI / 2; // 駅の改札を見つめて待っている
    // おすわりの姿勢
    statue.body.rotation.x = -0.45;
    statue.body.position.y = statue.dims.bodyY * 0.82;
    statue.legs[2].rotation.x = -0.95;
    statue.legs[3].rotation.x = -0.95;
    statue.legs[0].rotation.x = 0.45;
    statue.legs[1].rotation.x = 0.45;
    statue.head.rotation.x = 0.1;
    // 1つのメッシュにまとめる
    statue.root.updateMatrixWorld(true);
    const sgeos = [];
    statue.root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.material.transparent) return;
      const gg = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      gg.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
      sgeos.push(gg);
    });
    const spos = [], snor = [];
    for (const gg of sgeos) { spos.push(...gg.attributes.position.array); snor.push(...gg.attributes.normal.array); }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
    sgeo.setAttribute('normal', new THREE.Float32BufferAttribute(snor, 3));
    const smesh = new THREE.Mesh(sgeo, bronze);
    smesh.castShadow = true;
    smesh.receiveShadow = true;
    scene.add(smesh);
    signBoard(plaza, 'まちあわせの犬', sx - 1.62, 0.45, sz, 1.4, 0.3, -Math.PI / 2, { bg: '#3b3330', fg: '#f2d9a8', size: 90 });
    anchors.statue = new THREE.Vector3(sx, 1.4, sz);
    anchors.statueTop = new THREE.Vector3(sx + 0.6, 1.4, sz);
  }
  // 丸い植え込み（縁に座れる）
  for (const [x, z] of [[101, -60], [101, -88], [121, -89], [121, -53]]) {
    const rim = cyl(plaza, 1.5, 1.5, 0.45, x, 0.15, z, mat(0xcfc4b3, { rough: 0.9 }), 20);
    rim.receiveShadow = true;
    cyl(plaza, 1.35, 1.35, 0.02, x, 0.6, z, 0x6a5040, 20, { cast: false });
    const tr = tree(plaza, x, z, 'keyaki', Math.floor(x + z * 3), 1.15);
    tr.group.position.y = 0.6;
    col.addBox(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 0.15, 0.6, 'planter');
    col.addCircle(x, z, 0.3, 0.6, 6, 'trunk');
  }
  flowerBed(plaza, 103, -80, 105.5, -77, 50, 61, [0xf6d35a, 0xf2735a, 0xffffff]);
  box(plaza, 2.9, 0.3, 3.4, 104.25, 0.15, -78.5, 0x9c7650, { cast: false });
  col.addBox(102.8, 105.7, -80.2, -76.8, 0.15, 0.45, 'bed');
  // ベンチ
  for (const [x, z, ry] of [[104, -63, 0], [116, -63, 0], [116, -84, Math.PI], [104, -93, Math.PI]]) {
    const b = bench(plaza, x, z, ry, 0x9c7650);
    b.position.y = 0.15;
    col.addCircle(x, z, 0.55, 0.15, 0.6, 'bench');
  }
  anchors.benchWait = new THREE.Vector3(116, 0.6, -84);
  // バス停
  {
    const bx = 98, bz = -95.5;
    for (const s of [-1, 1]) cyl(plaza, 0.05, 0.05, 2.4, bx + s * 1.4, 0.15, bz, 0x8e949a, 8);
    box(plaza, 3.2, 0.1, 1.3, bx, 2.55, bz + 0.3, 0x8e949a);
    box(plaza, 3.0, 1.6, 0.04, bx, 0.8, bz - 0.3, mat(0xcfe0ea, { rough: 0.1, transparent: true, opacity: 0.5 }), { cast: false });
    signBoard(plaza, 'ひだまり駅前', bx - 2.0, 2.1, bz + 0.02, 0.9, 0.3, 0, { bg: '#27406b', fg: '#ffffff', size: 90 });
    cyl(plaza, 0.04, 0.04, 2.2, bx - 2.0, 0.15, bz, 0x8e949a, 6);
    col.addBox(bx - 1.6, bx + 1.6, bz - 0.4, bz - 0.2, 0.15, 2.5, 'wall');
  }
  // 自販機・郵便ポスト
  vendingMachine(plaza, 127.5, -48.5, Math.PI, 0xf2f2ee);
  col.addBox(127, 128, -49.2, -47.8, 0, 2, 'vend');
  postBox(plaza, 97.5, -46.5);
  col.addCircle(97.5, -46.5, 0.3, 0, 1.4, 'post');
  for (const [x, z] of [[100, -70], [124, -60], [124, -84], [108, -46.5]]) {
    const pl = new THREE.Group();
    parkLamp(pl, x, z);
    pl.position.y = 0.15;
    plaza.add(pl);
    pools.add(x, z, 3.4, 0.18);
    col.addCircle(x, z, 0.1, 0, 3.5, 'pole');
  }
  // 広場の南北のビル
  const plazaBldg = (x0, x1, z0, z1, h, name, colr, face) => {
    const w = x1 - x0, d = z1 - z0;
    cityBlock(plaza, (x0 + x1) / 2, (z0 + z1) / 2, w, d, h, colr);
    col.addBox(x0, x1, z0, z1, 0, h, 'building');
    if (name) {
      // 1階の店のガラスと看板
      const fz = face > 0 ? z1 + 0.02 : z0 - 0.02;
      const glass = box(plaza, w - 2, 2.4, 0.06, (x0 + x1) / 2, 0.15, fz, LM.windowWarm, { cast: false });
      glass.userData.window = true;
      signBoard(plaza, name, (x0 + x1) / 2, 3.2, fz + face * 0.03, Math.min(w - 2, 7), 0.9, face > 0 ? 0 : Math.PI, { bg: colr === 0x3e8fd8 ? '#3e8fd8' : '#fff8ea', fg: colr === 0x3e8fd8 ? '#ffffff' : '#b4452f', size: 90, glow: 0.5 });
      box(plaza, w, 0.3, 1.4, (x0 + x1) / 2, 2.8, fz + face * 0.7, colr);
    }
  };
  plazaBldg(95, 113, -110, -100, 14, 'ひだまり百貨店', 0xb4452f, 1);
  plazaBldg(113, 130, -110, -100, 10, 'ベーカリー 麦', 0x8a5a3a, 1);
  plazaBldg(95, 110, -44, -34, 8, 'ひだまりマート', 0x3e8fd8, -1);
  plazaBldg(110, 130, -44, -34, 16, 'カフェ ことり', 0x3f8f6a, -1);
  // 駅舎
  const station = D('station');
  {
    const X0 = 130, X1 = 150, Z0 = -106, Z1 = -38;
    const H = 5.6;
    // 壁（タイル張り）
    const wallM = gmat(TEX.sidewalk, 0xf1e9dc, 0.8);
    const part = (x0, x1, z0, z1, y0, y1, m = wallM) => {
      const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      worldUV(geo, 2.4);
      const mm = new THREE.Mesh(geo, m);
      mm.castShadow = mm.receiveShadow = true;
      station.add(mm);
      return mm;
    };
    part(X0, X1, Z0, -80, 0, H);
    part(X0, X1, -64, Z1, 0, H);
    part(X0 + 7, X1, -80, -64, 0, H);
    part(X0, X0 + 7, -80, -64, 4.2, H);
    col.addBox(X0, X1, Z0, -80, 0, H, 'station');
    col.addBox(X0, X1, -64, Z1, 0, H, 'station');
    // 改札の奥（行き止まり）
    col.addBox(X0 + 4.2, X1, -80, -64, 0, H, 'gates');
    // 入口の床・天井
    slab(station, col, X0, X0 + 7, -80, -64, 0.15, M.plaza, 2.4, 0, 'plaza');
    box(station, 7, 0.2, 16, X0 + 3.5, 3.95, -72, mat(0xfbf7f0, { emissive: 0x6a5a48, emissiveIntensity: 0.25 }), { cast: false });
    // 改札機（ぼんやり光る）
    const gateGlow = LIGHTS.make(0x9fe0ff, 0.6, 1.8, 0xdff4ff);
    for (let i = 0; i < 6; i++) {
      const gz = -78 + i * 2.4;
      box(station, 1.3, 1.0, 0.3, X0 + 4.6, 0.15, gz, 0xeef0f2, { round: 0.06 });
      box(station, 1.32, 0.12, 0.32, X0 + 4.6, 0.95, gz, 0x3e7fc4, { round: 0.03, cast: false });
      box(station, 0.34, 0.04, 0.22, X0 + 4.05, 1.15, gz, gateGlow, { cast: false });
      // 扉（オレンジ）
      box(station, 0.06, 0.34, 0.5, X0 + 4.5, 0.55, gz + 0.38, 0xf0a13a, { cast: false });
    }
    // 改札の奥：コンコースの壁（発車標・ポスター・時計）
    const conc = canvasTex(1024, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fff4e2'); g.addColorStop(1, '#f3dcc0');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // 発車標
      c.fillStyle = '#20252b'; c.fillRect(330, 26, 364, 92);
      c.fillStyle = '#ffb347'; c.font = '800 26px sans-serif'; c.textBaseline = 'middle';
      c.fillText('18:00  普通  ひだまり  着', 350, 54);
      c.fillStyle = '#7fe0a0'; c.fillText('18:12  快速  みなと  行', 350, 94);
      // ポスター
      const cols = ['#f28aa8', '#7ec7e8', '#f6d35a', '#9fd4b0', '#e8744f', '#b58ae0'];
      for (let i = 0; i < 6; i++) {
        const x = i < 3 ? 40 + i * 95 : 730 + (i - 3) * 95;
        c.fillStyle = cols[i]; c.fillRect(x, 40, 72, 100);
        c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x + 10, 52, 52, 30);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x + 10, 92, 40, 6); c.fillRect(x + 10, 104, 30, 6);
      }
      // 人のかげ（奥のホームへの階段）
      c.fillStyle = 'rgba(120, 80, 50, 0.18)';
      for (let i = 0; i < 9; i++) c.fillRect(0, 170 + i * 9, w, 4);
    });
    const innerM = new THREE.MeshStandardMaterial({ map: conc, emissive: 0xffffff, emissiveMap: conc, emissiveIntensity: 0.55, roughness: 0.8 });
    innerM.userData.noBake = true;
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 3.9), innerM);
    inner.position.set(X0 + 6.9, 2.1, -72);
    inner.rotation.y = -Math.PI / 2;
    station.add(inner);
    // 天井の照明と「改札口」のつり看板
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) box(station, 0.9, 0.05, 0.3, X0 + 1.4 + i * 2.2, 3.85, -77.5 + j * 3.7, LM.lamp, { cast: false });
    signBoard(station, '改札口', X0 + 3.9, 3.45, -72, 3.2, 0.55, -Math.PI / 2, { bg: '#1f5a46', fg: '#ffffff', size: 90, glow: 0.6 });
    box(station, 0.08, 0.6, 3.3, X0 + 3.95, 3.15, -72, 0x1f5a46, { cast: false });
    // ガラス窓の列
    for (let i = 0; i < 9; i++) {
      const z = Z0 + 3 + i * 7.5;
      if (z > -82 && z < -62) continue;
      const w = box(station, 0.06, 2.2, 5, X0 - 0.03, 1.5, z, LM.window, { cast: false });
      w.userData.window = true;
    }
    // ひさしと駅名
    box(station, 4.2, 0.25, 22, X0 - 2.0, 3.9, -72, 0x3b4a5e);
    for (const z of [-82.5, -61.5]) {
      cyl(station, 0.12, 0.12, 3.75, X0 - 3.8, 0.15, z, 0x8e949a, 8);
      col.addCircle(X0 - 3.8, z, 0.15, 0, 4.2, 'pole');
    }
    for (let i = 0; i < 6; i++) pools.add(X0 - 1.6, -80 + i * 3.2, 2.2, 0.18);
    signBoard(station, 'ひだまり駅', X0 - 0.06, 4.92, -72, 6.4, 1.1, -Math.PI / 2, { bg: '#27406b', fg: '#ffffff', size: 110, glow: 0.6 });
    signBoard(station, 'HIDAMARI STATION', X0 - 4.12, 4.025, -72, 4.4, 0.2, -Math.PI / 2, { bg: '#3b4a5e', fg: '#e8eef5', size: 70, glow: 0.4 });
    box(station, X1 - X0 + 0.4, 0.4, Z1 - Z0 + 0.4, (X0 + X1) / 2, H, (Z0 + Z1) / 2, 0xcfc4b3);
    // 駅の時計
    anchors.gate = new THREE.Vector3(X0 + 3.4, 0.15, -72);
    anchors.gateInside = new THREE.Vector3(X0 + 6.2, 0.15, -72);
  }
  // 高架とホーム
  {
    const x = TRACK.x, y = TRACK.y;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.8, 900), gmat(TEX.block, 0xd9d4ca, 0.9));
    worldUV(deck.geometry, 2);
    deck.position.set(x, y - 0.4, -150);
    deck.castShadow = deck.receiveShadow = true;
    station.add(deck);
    for (const s of [-1, 1]) box(station, 0.25, 1.2, 900, x + s * 3.7, y, -150, 0xcfc8bb);
    for (const s of [-0.72, 0.72]) box(station, 0.08, 0.14, 900, x + s, y, -150, mat(0x8a8a88, { metal: 0.6, rough: 0.4 }), { cast: false });
    for (let z = -590; z < 290; z += 16) {
      if (z > -110 && z < -34) continue;
      box(station, 1.6, y - 0.8, 1.6, x, 0, z, 0xcfc8bb);
    }
    // ホームの屋根
    for (let z = -104; z <= -40; z += 8) {
      for (const s of [-1, 1]) cyl(station, 0.1, 0.1, 3.8, x + s * 5.4, y, z, 0x8e949a, 6);
    }
    for (const sx of [-5.4, 5.4]) box(station, 3.8, 0.18, 68, x + sx, y + 3.8, -72, 0x5c6b7e);
    box(station, 3.2, 1.0, 68, x - 5.4, y - 0.1, -72, 0xd9d4ca);
    box(station, 3.2, 1.0, 68, x + 5.4, y - 0.1, -72, 0xd9d4ca);
    const lampM = LM.lamp;
    for (let z = -100; z <= -44; z += 8) box(station, 0.6, 0.06, 0.2, x - 5.4, y + 3.72, z, lampM, { cast: false });
  }
  anchors.platform = new THREE.Vector3(TRACK.x - 5.4, TRACK.y + 0.4, -72);

  // ==========================================================
  // 7) 遠景：ビル群
  // ==========================================================
  const far = D('far');
  const fr = mulberry32(88);
  const fcols = [0xe9dccb, 0xd8d0c4, 0xf0e6d6, 0xc9d0d4, 0xe6d2bf, 0xd4c2b0, 0xdfe2e0];
  const farBlock = (x, z, w, d, h) => cityBlock(far, x, z, w, d, h, fcols[Math.floor(fr() * fcols.length)]);
  // 大通り沿い
  for (let z = -250; z < 110; z += 16) {
    if (z > -114 && z < -36) continue;
    farBlock(73, z, 12, 14, 7 + fr() * 8);
    farBlock(103 + fr() * 3, z, 14, 13, 9 + fr() * 12);
  }
  // 駅の向こう
  for (let z = -250; z < 110; z += 18) farBlock(162 + fr() * 6, z, 16, 15, 10 + fr() * 14);
  for (let z = -250; z < 110; z += 22) farBlock(188 + fr() * 10, z, 18, 18, 14 + fr() * 18);
  // 南・西・北の住宅街の向こう
  for (let x = -60; x < 70; x += 16) farBlock(x, 40 + fr() * 6, 14, 12, 8 + fr() * 10);
  for (let x = -60; x < 70; x += 18) farBlock(x, -130 - fr() * 6, 15, 12, 10 + fr() * 14);
  for (let z = -120; z < 40; z += 16) farBlock(-48 - fr() * 6, z, 12, 14, 8 + fr() * 10);
  // 商店街の裏手
  for (let z = -45; z < -30; z += 11) {
    const hs = makeHouse({ w: 9, d: 9, floors: 3, flat: true });
    hs.rotation.y = -Math.PI / 2;
    hs.position.set(26.5, 0, z);
    far.add(hs);
  }
  for (let z = -40; z < 0; z += 12) {
    const hs = makeHouse({ w: 10, d: 10, floors: 4, flat: true });
    hs.rotation.y = Math.PI / 2;
    hs.position.set(60.5, 0, z);
    far.add(hs);
  }
  const mtn = mountains(scene);

  // ==========================================================
  // 結合（描画命令を減らす）
  // ==========================================================
  for (const g of Object.values(districts)) bake(g);
  // 遠景のビルは影を落とさない
  for (const k of ['far', 'base']) districts[k].traverse((o) => { if (o.isMesh) o.castShadow = false; });
  // 看板・旗など結合できなかった細かい物は、地区ごとに遠いと描かない
  const details = [];
  for (const [name, g] of Object.entries(districts)) {
    if (name === 'far' || name === 'base') continue;
    const list = [];
    g.traverse((o) => { if (o.isMesh && o.parent !== g) list.push(o); });
    const box3 = new THREE.Box3().setFromObject(g);
    details.push({ list, box: box3, on: true });
  }

  // 地区の結合メッシュ（影を落とすもの）を、遠いときは影なしに
  const shadowSets = [];
  for (const [name, g] of Object.entries(districts)) {
    if (name === 'far' || name === 'base') continue;
    const list = g.children.filter((o) => o.isMesh && o.castShadow);
    shadowSets.push({ list, box: new THREE.Box3().setFromObject(g), on: true });
  }

  const petals = new Petals(scene, petalsEmit, 260);
  const tmpC = new THREE.Color();
  return {
    col, districts, anchors, room, win, pools, petals, signals, clockFaces,
    update(dt, t, hour, camPos, focus) {
      for (const d of dynamic) d.update(dt, t);
      if (camPos) {
        const inRoom = camPos.x > ROOM.minX && camPos.x < ROOM.maxX && camPos.z > ROOM.minZ && camPos.z < ROOM.maxZ && camPos.y < ROOM.h;
        if (inRoom !== this._inRoom) {
          this._inRoom = inRoom;
          for (const k of ['street', 'park', 'road', 'plaza', 'station']) districts[k].visible = !inRoom;
        }
      }
      if (focus) {
        for (const s of shadowSets) {
          const on = s.box.distanceToPoint(focus) < 30;
          if (on !== s.on) { s.on = on; for (const m of s.list) m.castShadow = on; }
        }
      }
      if (camPos) {
        for (const d of details) {
          const on = d.box.distanceToPoint(camPos) < 75;
          if (on !== d.on) { d.on = on; for (const o of d.list) o.visible = on; }
        }
      }
      petals.update(dt, t);
      pools.set(LIGHTS.factor);
      // 時計塔の針
      const hh = hour % 12, mm = (hour % 1) * 60;
      for (const f of clockFaces) {
        f.hh.rotation.z = -(hh / 12) * Math.PI * 2;
        f.mh.rotation.z = -(mm / 60) * Math.PI * 2;
      }
      // 遠い山の色は空の地平線に合わせる
      const U = day.uniforms;
      tmpC.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.42);
      mtn.material.uniforms.uTop.value.copy(tmpC);
      mtn.material.uniforms.uBottom.value.copy(U.uHorizon.value).lerp(scene.fog.color, 0.6);
    },
  };
}
