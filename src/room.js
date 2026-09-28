import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, mergeParts, mat } from './util.js';

export const ROOM = { minX: -4.5, maxX: 4.5, minZ: -3.5, maxZ: 3.5, h: 2.8 };
export const WINDOW = { x: 4.5, z0: -2.9, z1: 0.5, y0: 0.0, y1: 2.3 };
export const SUN_DIR = new THREE.Vector3(6, 4.3, -1.6).normalize(); // 床→太陽の向き
export const BED = { x: 2.95, z: -2.2, r: 0.62 };
export const TABLE = { x: -1.7, z: -0.75, r: 0.64, top: 0.45 };
export const DOOR = { x: 1.1, w: 0.95, h: 2.05 };
// みまもりカメラの設置場所（yaw=0 で奥の壁方向、正で右）
export const CAM_SPOTS = [
  { name: 'リビング', pos: new THREE.Vector3(0.55, 1.6, 3.32), yaw0: 0.12, pitch0: -0.42, yawMin: -1.15, yawMax: 1.2, stand: true },
  { name: 'ソファの上', pos: new THREE.Vector3(-2.42, 1.66, -3.26), yaw0: 2.5, pitch0: -0.38, yawMin: 1.3, yawMax: 4.0, stand: false },
];

/** 小さなドーム型のペットカメラ */
function petcamDevice(stand) {
  const g = new THREE.Group();
  const white = std(0xfbf8f2, 0.4);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16), white);
  base.position.y = -0.09;
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), white);
  g.add(dome);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), std(0x1c1a22, 0.15));
  lens.position.set(0, 0, 0.084);
  g.add(lens);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
  led.position.set(0.04, 0.04, 0.072);
  g.add(led);
  if (stand) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 8), std(0xd9a066, 0.5));
    pole.position.y = -0.84;
    g.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), std(0xd9a066, 0.5));
    foot.position.y = -1.585;
    g.add(foot);
  }
  g.userData.led = led;
  g.userData.dome = dome;
  return g;
}

function std(color, rough = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
}

function floorTexture(maxAniso) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(7);
  const rows = 8;
  const ph = 1024 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 400;
    while (x < 1024) {
      const len = 380 + rnd() * 420;
      const l = 62 + rnd() * 8;
      const hue = 29 + rnd() * 5;
      ctx.fillStyle = `hsl(${hue}, ${58 + rnd() * 10}%, ${l}%)`;
      ctx.fillRect(x, r * ph, len, ph);
      // 木目
      for (let g = 0; g < 7; g++) {
        ctx.strokeStyle = `hsla(${hue - 4}, 55%, ${l - 10 - rnd() * 8}%, ${0.12 + rnd() * 0.12})`;
        ctx.lineWidth = 1 + rnd() * 2;
        ctx.beginPath();
        const y0 = r * ph + 8 + rnd() * (ph - 16);
        ctx.moveTo(x, y0);
        for (let s = 0; s <= 8; s++) ctx.lineTo(x + (len * s) / 8, y0 + Math.sin(s * 1.3 + rnd() * 2) * 3);
        ctx.stroke();
      }
      // 継ぎ目
      ctx.fillStyle = 'rgba(120, 70, 30, 0.35)';
      ctx.fillRect(x, r * ph, 3, ph);
      x += len;
    }
    ctx.fillStyle = 'rgba(120, 70, 30, 0.4)';
    ctx.fillRect(0, r * ph, 1024, 3);
    ctx.fillStyle = 'rgba(255, 240, 210, 0.25)';
    ctx.fillRect(0, r * ph + 3, 1024, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.2, 2.5);
  tex.anisotropy = maxAniso;
  return tex;
}

function rugTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 10, 256, 256, 256);
  g.addColorStop(0, '#93c9ab');
  g.addColorStop(0.86, '#8cc3a5');
  g.addColorStop(0.88, '#7db596');
  g.addColorStop(0.92, '#9dd1b4');
  g.addColorStop(1, '#86bd9f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(3);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '40,90,60'}, ${0.04 + rnd() * 0.05})`;
    ctx.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function gardenTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#fff6dc');
  sky.addColorStop(0.5, '#fbe6b8');
  sky.addColorStop(1, '#d6e8a8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);
  // フェンス
  ctx.fillStyle = '#e8c79c';
  for (let x = 0; x < 512; x += 26) ctx.fillRect(x, 120, 18, 90);
  ctx.fillRect(0, 140, 512, 8);
  const rnd = mulberry32(5);
  // 植え込み
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 512, y = 170 + rnd() * 70, r = 18 + rnd() * 30;
    ctx.fillStyle = `hsl(${95 + rnd() * 25}, ${45 + rnd() * 15}%, ${48 + rnd() * 14}%)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#ffe2ec';
    ctx.beginPath(); ctx.arc(rnd() * 512, 175 + rnd() * 70, 3 + rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#b9d98a';
  ctx.fillRect(0, 236, 512, 20);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shaftTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,236,190,0.9)');
  g.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.3, 'rgba(0,0,0,0)');
  h.addColorStop(0.7, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafArtTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7efe2';
  ctx.fillRect(0, 0, 128, 160);
  ctx.fillStyle = '#9ccab2';
  ctx.beginPath();
  ctx.ellipse(64, 80, 30, 52, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f7efe2';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(52, 128); ctx.lineTo(74, 32); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(56 + i * 3.5, 112 - i * 16); ctx.lineTo(40 + i * 3, 96 - i * 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(58 + i * 3.5, 108 - i * 16); ctx.lineTo(84 + i * 2, 98 - i * 16); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 小さな観葉植物（装飾・転倒物で共用） */
export function makePlant(potColor = 0xf3ece2, leafColor = 0x6fae7c, size = 1, seed = 1) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * size, 0.12 * size, 0.26 * size, 12), std(potColor, 0.7));
  pot.position.y = 0.13 * size;
  pot.castShadow = true;
  pot.receiveShadow = true;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.145 * size, 0.145 * size, 0.02, 12), std(0x6b4a33, 1));
  soil.position.y = 0.25 * size;
  g.add(soil);
  const leaves = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const tilt = 0.5 + rnd() * 0.5;
    const len = (0.28 + rnd() * 0.18) * size;
    const leaf = new THREE.SphereGeometry(1, 6, 4);
    const c = new THREE.Color(leafColor).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    leaves.push({
      geo: leaf,
      matrix: new THREE.Matrix4()
        .makeRotationY(a)
        .multiply(new THREE.Matrix4().makeTranslation(0, 0.26 * size, 0))
        .multiply(new THREE.Matrix4().makeRotationX(tilt))
        .multiply(new THREE.Matrix4().makeTranslation(0, len * 0.55, 0))
        .multiply(new THREE.Matrix4().makeScale(0.075 * size, len * 0.55, 0.025 * size)),
      color: c,
    });
  }
  leaves.push({ geo: new THREE.SphereGeometry(1, 6, 4), matrix: mat(0, 0.42 * size, 0, 0, 0, 0, 0.07 * size, 0.2 * size, 0.03 * size), color: new THREE.Color(leafColor) });
  const lm = new THREE.Mesh(mergeParts(leaves), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
  lm.castShadow = true;
  g.add(lm);
  return g;
}

export function buildRoom(scene, renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ;
  const colliders = [];
  const room = new THREE.Group();
  scene.add(room);

  // 床（手前はカメラに映る範囲まで続けて、部屋の端が見えないように）
  const FRONT = 3.5;
  const floorMat = std(0xffffff, 0.62, { map: floorTexture(maxAniso) });
  floorMat.map.repeat.set(3.2, 2.5 * (D + FRONT) / D);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D + FRONT), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = FRONT / 2;
  floor.receiveShadow = true;
  room.add(floor);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.3, D + FRONT + 0.1), std(0xc48b58, 0.9));
  slab.position.set(0, -0.151, FRONT / 2 - 0.05);
  room.add(slab);

  // 手前の境界：左はキッチンへのペットゲート、右は低いテレビ台
  {
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.4), std(0xf2e8dc, 0.8));
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(-1.6, 0.003, ROOM.maxZ + 1.75);
    tile.receiveShadow = true;
    room.add(tile);
    const bars = [];
    const gx0 = ROOM.minX, gx1 = 1.2, gz = ROOM.maxZ - 0.02;
    bars.push({ geo: new THREE.BoxGeometry(gx1 - gx0, 0.04, 0.04), matrix: mat((gx0 + gx1) / 2, 0.56, gz), color: 0xfbf8f2 });
    bars.push({ geo: new THREE.BoxGeometry(gx1 - gx0, 0.03, 0.04), matrix: mat((gx0 + gx1) / 2, 0.05, gz), color: 0xfbf8f2 });
    for (let x = gx0 + 0.06; x < gx1; x += 0.13) {
      bars.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 0.52, 5), matrix: mat(x, 0.3, gz), color: 0xfbf8f2 });
    }
    for (const x of [gx0 + 0.03, gx1 - 0.03]) bars.push({ geo: new THREE.BoxGeometry(0.06, 0.62, 0.06), matrix: mat(x, 0.31, gz), color: 0xf1ebe2 });
    const gate = new THREE.Mesh(mergeParts(bars), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    gate.castShadow = true;
    room.add(gate);
    const tv = new THREE.Mesh(new RoundedBoxGeometry(3.1, 0.4, 0.46, 2, 0.04), std(0xd9a066, 0.6));
    tv.position.set(2.95, 0.2, ROOM.maxZ + 0.2);
    tv.castShadow = true;
    tv.receiveShadow = true;
    room.add(tv);
    for (const [x, c] of [[1.9, 0xe7d3b3], [2.5, 0xa8d8c2]]) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.26, 0.34, 2, 0.04), std(c, 0.9));
      b.position.set(x, 0.17, ROOM.maxZ + 0.2);
      room.add(b);
    }
    const tvp = makePlant(0xf5efe6, 0x6fae7c, 0.7, 17);
    tvp.position.set(4.0, 0.4, ROOM.maxZ + 0.2);
    room.add(tvp);
  }

  // 壁
  const wallMat = std(0xf8ecdc, 0.95);
  const baseMat = std(0xd9a26e, 0.7);
  const addBox = (w, h, d, x, y, z, m, cast = true, recv = true) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = cast;
    b.receiveShadow = recv;
    room.add(b);
    return b;
  };
  const H = ROOM.h;
  // 奥の壁（ドア部分をあける）
  const dL = DOOR.x - DOOR.w / 2, dR = DOOR.x + DOOR.w / 2;
  addBox(dL - ROOM.minX, H, 0.12, (ROOM.minX + dL) / 2, H / 2, ROOM.minZ - 0.06, wallMat);
  addBox(ROOM.maxX - dR + 0.12, H, 0.12, (dR + ROOM.maxX + 0.12) / 2, H / 2, ROOM.minZ - 0.06, wallMat);
  addBox(DOOR.w, H - DOOR.h, 0.12, DOOR.x, DOOR.h + (H - DOOR.h) / 2, ROOM.minZ - 0.06, wallMat);
  // 廊下（ドアが開いたら見える）
  const hall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), std(0xf2dcc0, 1));
  hall.position.set(DOOR.x, 1.2, ROOM.minZ - 0.9);
  room.add(hall);
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), std(0xd7a56e, 1));
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(DOOR.x, 0.001, ROOM.minZ - 0.45);
  room.add(hallFloor);
  // 左の壁
  addBox(0.12, H, D + 0.12, ROOM.minX - 0.06, H / 2, 0, wallMat);
  // 右の壁（大きな掃き出し窓）
  const wz0 = WINDOW.z0, wz1 = WINDOW.z1;
  addBox(0.12, H, wz0 - ROOM.minZ + 0.12, ROOM.maxX + 0.06, H / 2, (ROOM.minZ - 0.12 + wz0) / 2, wallMat);
  addBox(0.12, H, ROOM.maxZ - wz1, ROOM.maxX + 0.06, H / 2, (wz1 + ROOM.maxZ) / 2, wallMat);
  addBox(0.12, H - WINDOW.y1, wz1 - wz0, ROOM.maxX + 0.06, WINDOW.y1 + (H - WINDOW.y1) / 2, (wz0 + wz1) / 2, wallMat);
  // 巾木
  addBox(W, 0.1, 0.03, 0, 0.05, ROOM.minZ + 0.015, baseMat, false);
  addBox(0.03, 0.1, D, ROOM.minX + 0.015, 0.05, 0, baseMat, false);

  // 窓枠・ガラス・外の景色
  const frameMat = std(0xe8c49a, 0.6);
  const wx = ROOM.maxX;
  addBox(0.14, WINDOW.y1, 0.09, wx, WINDOW.y1 / 2, wz0, frameMat);
  addBox(0.14, WINDOW.y1, 0.09, wx, WINDOW.y1 / 2, wz1, frameMat);
  addBox(0.14, 0.09, wz1 - wz0, wx, WINDOW.y1, (wz0 + wz1) / 2, frameMat);
  addBox(0.18, 0.06, wz1 - wz0, wx, 0.03, (wz0 + wz1) / 2, frameMat);
  for (const z of [-1.2]) addBox(0.12, WINDOW.y1, 0.07, wx, WINDOW.y1 / 2, z, frameMat);
  for (const z of [-2.05, -0.35]) addBox(0.06, WINDOW.y1, 0.035, wx, WINDOW.y1 / 2, z, frameMat);
  addBox(0.06, 0.035, wz1 - wz0, wx, 1.45, (wz0 + wz1) / 2, frameMat);
  const garden = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: gardenTexture() }));
  garden.position.set(wx + 2.2, 1.6, (wz0 + wz1) / 2);
  garden.rotation.y = -Math.PI / 2;
  room.add(garden);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), std(0xdcae7a, 0.9));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(wx + 1.1, 0.0, (wz0 + wz1) / 2);
  deck.receiveShadow = true;
  room.add(deck);

  // カーテン（レース）
  const curtainMat = std(0xfff6e8, 0.9, { transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const folds = [];
  const curtain = (z0, z1) => {
    const n = 5;
    const w = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      folds.push({ geo: new THREE.CylinderGeometry(w * 0.62, w * 0.62, 2.45, 8, 1, true, 0, Math.PI), matrix: mat(wx - 0.16, 1.25, z0 + w * (i + 0.5), 0, Math.PI / 2, 0), color: 0xffffff });
    }
  };
  curtain(wz0 - 0.55, wz0 + 0.15);
  curtain(wz1 - 0.1, wz1 + 0.6);
  const curtains = new THREE.Mesh(mergeParts(folds), curtainMat);
  curtains.castShadow = true;
  room.add(curtains);
  addBox(0.05, 0.05, wz1 - wz0 + 1.6, wx - 0.14, 2.5, (wz0 + wz1) / 2, std(0xc79a6a, 0.6), false);

  // 光の筋
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shafts = new THREE.Group();
  const camDir = new THREE.Vector3(0.1, 0.72, 0.69).normalize();
  const yAxis = SUN_DIR.clone();
  const zAxis = camDir.clone().addScaledVector(yAxis, -camDir.dot(yAxis)).normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const shaftQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  const shaftGeos = [];
  for (const [z, y, w] of [[-2.5, 1.95, 0.55], [-1.65, 2.05, 0.75], [-0.8, 1.85, 0.6], [0.05, 2.0, 0.7], [-1.2, 1.2, 0.4]]) {
    const len = y / SUN_DIR.y;
    // 窓から床へ伸ばす
    const center = new THREE.Vector3(wx - 0.1, y, z).addScaledVector(SUN_DIR, -len / 2);
    const g = new THREE.PlaneGeometry(w, len);
    g.applyMatrix4(new THREE.Matrix4().compose(center, shaftQ, new THREE.Vector3(1, 1, 1)));
    shaftGeos.push(g);
  }
  {
    // UV付きで1つのジオメトリに
    const pos = [], uv = [];
    for (const g of shaftGeos) {
      const idx = g.index.array, p = g.attributes.position, u = g.attributes.uv;
      for (let i = 0; i < idx.length; i++) {
        pos.push(p.getX(idx[i]), p.getY(idx[i]), p.getZ(idx[i]));
        uv.push(u.getX(idx[i]), u.getY(idx[i]));
      }
      g.dispose();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const s = new THREE.Mesh(sg, shaftMat);
    s.renderOrder = 5;
    shafts.add(s);
  }
  room.add(shafts);

  // ドア
  const doorPivot = new THREE.Group();
  doorPivot.position.set(dL, 0, ROOM.minZ - 0.02);
  const doorMat = std(0xd39a61, 0.55);
  const doorPanel = new THREE.Mesh(new RoundedBoxGeometry(DOOR.w, DOOR.h, 0.06, 2, 0.02), doorMat);
  doorPanel.position.set(DOOR.w / 2, DOOR.h / 2, 0);
  doorPanel.castShadow = true;
  doorPanel.receiveShadow = true;
  doorPivot.add(doorPanel);
  for (const y of [0.55, 1.45]) {
    const inset = new THREE.Mesh(new RoundedBoxGeometry(DOOR.w * 0.7, 0.6, 0.02, 2, 0.01), std(0xc98c52, 0.6));
    inset.position.set(DOOR.w / 2, y, 0.03);
    doorPivot.add(inset);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), std(0x8a7a6a, 0.3, { metalness: 0.6 }));
  knob.position.set(DOOR.w - 0.12, 1.0, 0.07);
  doorPivot.add(knob);
  room.add(doorPivot);
  addBox(DOOR.w + 0.14, 0.07, 0.08, DOOR.x, DOOR.h + 0.035, ROOM.minZ + 0.01, frameMat, false);
  const mat_ = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.02, 0.55, 2, 0.01), std(0xe6d3b3, 1));
  mat_.position.set(DOOR.x, 0.01, ROOM.minZ + 0.42);
  mat_.receiveShadow = true;
  room.add(mat_);

  // 飼い主（帰宅演出用、ふだんは非表示）
  const owner = new THREE.Group();
  const legMat = std(0x6f7fa8, 0.8);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.95, 8), legMat);
    leg.position.set(s * 0.11, 0.5, 0);
    owner.add(leg);
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.08, 0.26, 2, 0.03), std(0xf2eee8, 0.6));
    shoe.position.set(s * 0.11, 0.04, 0.05);
    owner.add(shoe);
  }
  const coat = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.7, 0.28, 3, 0.1), std(0xe7b98a, 0.8));
  coat.position.y = 1.3;
  owner.add(coat);
  const bag = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.24, 0.12, 2, 0.04), std(0xf2c14e, 0.6));
  bag.position.set(0.34, 0.95, 0.02);
  owner.add(bag);
  owner.position.set(DOOR.x, 0, ROOM.minZ - 0.45);
  owner.visible = false;
  room.add(owner);

  // ソファ
  const sofaMat = std(0xec9a7e, 0.95);
  const sofa = new THREE.Group();
  const sx = -1.9, sz = ROOM.minZ + 0.55;
  const sb = (w, h, d, x, y, z, m = sofaMat, r = 0.08) => {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    sofa.add(b);
    return b;
  };
  sb(2.6, 0.26, 0.95, 0, 0.25, 0);
  sb(1.14, 0.18, 0.78, -0.58, 0.46, 0.06, sofaMat, 0.08);
  sb(1.14, 0.18, 0.78, 0.58, 0.46, 0.06, sofaMat, 0.08);
  sb(2.6, 0.62, 0.3, 0, 0.72, -0.34, sofaMat, 0.12);
  sb(0.3, 0.5, 0.95, -1.3, 0.5, 0, sofaMat, 0.12);
  sb(0.3, 0.5, 0.95, 1.3, 0.5, 0, sofaMat, 0.12);
  const pillowMat = std(0xf7ecd9, 1);
  const p1 = sb(0.5, 0.42, 0.16, -0.75, 0.78, -0.12, pillowMat, 0.14);
  p1.rotation.set(-0.25, 0.15, 0.08);
  const p2 = sb(0.48, 0.42, 0.16, 0.8, 0.78, -0.12, std(0x98cdb6, 1), 0.14);
  p2.rotation.set(-0.25, -0.2, -0.06);
  for (const [x, z] of [[-1.2, 0.38], [1.2, 0.38], [-1.2, -0.38], [1.2, -0.38]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.12, 6), std(0xa06a3c, 0.6));
    leg.position.set(x, 0.06, z);
    sofa.add(leg);
  }
  sofa.position.set(sx, 0, sz);
  room.add(sofa);
  colliders.push({ type: 'box', minX: sx - 1.35, maxX: sx + 1.35, minZ: ROOM.minZ, maxZ: sz + 0.48, h: 0.9 });

  // 壁の棚と飾り
  const shelf = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.05, 0.22, 2, 0.02), std(0xd39a61, 0.6));
  shelf.position.set(-2.9, 1.55, ROOM.minZ + 0.11);
  shelf.castShadow = true;
  room.add(shelf);
  const sp = makePlant(0xf5efe6, 0x77b284, 0.6, 9);
  sp.position.set(-3.2, 1.575, ROOM.minZ + 0.12);
  room.add(sp);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2 + i * 0.02, 0.15), std([0x9fcdb9, 0xf2c6a0, 0xf6e8d2][i], 0.8));
    b.position.set(-2.7 + i * 0.07, 1.68 + i * 0.01, ROOM.minZ + 0.11);
    room.add(b);
  }
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.58), new THREE.MeshStandardMaterial({ map: leafArtTexture(), roughness: 0.9 }));
  const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.03), std(0xd39a61, 0.6));
  artFrame.position.set(-1.35, 1.62, ROOM.minZ + 0.02);
  art.position.set(-1.35, 1.62, ROOM.minZ + 0.04);
  room.add(artFrame, art);
  const art2 = art.clone();
  const artFrame2 = artFrame.clone();
  art2.position.set(2.2, 1.55, ROOM.minZ + 0.04);
  artFrame2.position.set(2.2, 1.55, ROOM.minZ + 0.02);
  room.add(artFrame2, art2);

  // 壁掛け時計（ゲーム内時刻を表示）
  const clock = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), std(0xfffaf2, 0.5));
  face.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24), std(0xd39a61, 0.5));
  clock.add(face, rim);
  const handMat = std(0x5b4033, 0.5);
  const hourHand = new THREE.Group();
  const hh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.01), handMat);
  hh.position.y = 0.05;
  hourHand.add(hh);
  const minHand = new THREE.Group();
  const mh = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.17, 0.01), handMat);
  mh.position.y = 0.08;
  minHand.add(mh);
  hourHand.position.z = minHand.position.z = 0.03;
  clock.add(hourHand, minHand);
  clock.position.set(3.3, 1.75, ROOM.minZ + 0.03);
  room.add(clock);

  // ラグとテーブル
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), std(0xffffff, 1, { map: rugTexture() }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(TABLE.x, 0.004, TABLE.z + 0.1);
  rug.receiveShadow = true;
  room.add(rug);
  const woodMat = std(0xd9a066, 0.55);
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r, TABLE.r, 0.06, 32), woodMat);
  top.position.y = TABLE.top - 0.03;
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, TABLE.top - 0.06, 8), woodMat);
    leg.position.set(Math.cos(a) * TABLE.r * 0.62, (TABLE.top - 0.06) / 2, Math.sin(a) * TABLE.r * 0.62);
    leg.castShadow = true;
    table.add(leg);
  }
  table.position.set(TABLE.x, 0, TABLE.z);
  room.add(table);
  const tp = makePlant(0xf5efe6, 0x7fbb8a, 0.45, 4);
  tp.position.set(TABLE.x - 0.18, TABLE.top, TABLE.z - 0.2);
  table.userData.plant = tp;
  room.add(tp);
  colliders.push({ type: 'circle', x: TABLE.x, z: TABLE.z, r: TABLE.r, h: TABLE.top + 0.05, tag: 'table' });

  // 本棚（右手前）
  const shelfG = new THREE.Group();
  const bsMat = std(0xd9a066, 0.6);
  const bs = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.72, 1.7, 2, 0.03), bsMat);
  bs.position.set(0, 0.36, 0);
  bs.castShadow = true;
  bs.receiveShadow = true;
  shelfG.add(bs);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 1.6), std(0xb98150, 0.8));
  inner.position.set(-0.04, 0.2, 0);
  shelfG.add(inner);
  const inner2 = inner.clone();
  inner2.position.y = 0.52;
  shelfG.add(inner2);
  const rb = mulberry32(21);
  const bookCols = [0x9fcdb9, 0xf2c6a0, 0xf4e2c8, 0xe99f86, 0x7fa9c9, 0xf6d38a];
  for (let row = 0; row < 2; row++) {
    let z = -0.75;
    while (z < 0.7) {
      const w = 0.05 + rb() * 0.04, h = 0.18 + rb() * 0.05;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, w), std(bookCols[Math.floor(rb() * bookCols.length)], 0.85));
      b.position.set(-0.2, 0.08 + row * 0.32 + h / 2, z + w / 2);
      b.rotation.x = (rb() - 0.5) * 0.08;
      shelfG.add(b);
      z += w + 0.012 + (rb() < 0.15 ? 0.1 : 0);
    }
  }
  const sp2 = makePlant(0xf5efe6, 0x6fae7c, 0.55, 12);
  sp2.position.set(0, 0.72, -0.45);
  shelfG.add(sp2);
  const frameS = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.24), std(0xd39a61, 0.6));
  frameS.position.set(0.08, 0.87, 0.3);
  frameS.rotation.z = 0.12;
  shelfG.add(frameS);
  shelfG.position.set(ROOM.maxX - 0.27, 0, 1.95);
  room.add(shelfG);
  colliders.push({ type: 'box', minX: ROOM.maxX - 0.54, maxX: ROOM.maxX, minZ: 1.1, maxZ: 2.8, h: 0.75 });

  // 犬のベッド
  const bed = new THREE.Group();
  const bedMat = std(0xa2d4c0, 1);
  const rimGeo = new THREE.TorusGeometry(BED.r - 0.14, 0.17, 10, 28);
  const bedRim = new THREE.Mesh(rimGeo, bedMat);
  bedRim.rotation.x = Math.PI / 2;
  bedRim.scale.set(1, 1, 0.9);
  bedRim.position.y = 0.15;
  bedRim.castShadow = true;
  bedRim.receiveShadow = true;
  bed.add(bedRim);
  const bedBase = new THREE.Mesh(new THREE.CylinderGeometry(BED.r - 0.1, BED.r - 0.05, 0.1, 28), std(0xf4e9d8, 1));
  bedBase.position.y = 0.06;
  bedBase.receiveShadow = true;
  bed.add(bedBase);
  const bone = new THREE.Group();
  const boneMat = std(0xfffaf2, 0.8);
  const bRod = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), boneMat);
  bRod.rotation.z = Math.PI / 2;
  bone.add(bRod);
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), boneMat);
    k.position.set(s * 0.09, t * 0.03, 0);
    bone.add(k);
  }
  bone.position.set(0, 0.16, BED.r + 0.03);
  bed.add(bone);
  bed.position.set(BED.x, 0, BED.z);
  room.add(bed);

  // ほこり（日差しの中を漂う）
  const motes = new THREE.BufferGeometry();
  const mc = 70;
  const mp = new Float32Array(mc * 3);
  const rm = mulberry32(99);
  for (let i = 0; i < mc; i++) {
    mp[i * 3] = 1.5 + rm() * 3;
    mp[i * 3 + 1] = 0.2 + rm() * 2;
    mp[i * 3 + 2] = -2.8 + rm() * 3.6;
  }
  motes.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const dotCv = document.createElement('canvas');
  dotCv.width = dotCv.height = 32;
  const dctx = dotCv.getContext('2d');
  const dg = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  dg.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, 32, 32);
  const motePts = new THREE.Points(motes, new THREE.PointsMaterial({
    color: 0xfff1c8, size: 0.035, map: new THREE.CanvasTexture(dotCv), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  room.add(motePts);

  // みまもりカメラ本体
  const devices = CAM_SPOTS.map((c) => {
    const d = petcamDevice(c.stand);
    d.position.copy(c.pos);
    d.rotation.y = Math.PI - c.yaw0;
    room.add(d);
    return d;
  });

  batchStatic(room, new Set([doorPivot, owner, shafts, hourHand, minHand, tp, motePts, ...devices]));

  return {
    devices,
    group: room, colliders, doorPivot, owner, clockHands: { hour: hourHand, min: minHand }, shafts, motes: motePts,
    tablePlant: tp,
  };
}

/** 小物のモデル（原点に置いた状態）を1〜数メッシュにまとめる */
export function mergeModel(g) {
  batchStatic(g, new Set());
  return g;
}

/**
 * 動かない家具をマテリアルの性質ごとに1メッシュへまとめ、描画命令を減らす。
 * 色は頂点カラーへ移す。exclude の子孫（ドア・時計の針など動くもの）はそのまま。
 */
function batchStatic(group, exclude) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const isExcluded = (o) => {
    for (let p = o; p && p !== group; p = p.parent) if (exclude.has(p)) return true;
    return false;
  };
  group.traverse((o) => {
    if (!o.isMesh || isExcluded(o)) return;
    const m = o.material;
    if (Array.isArray(m) || !m.isMeshStandardMaterial || m.map || m.transparent) return;
    const key = [m.roughness, m.metalness, m.flatShading, m.side, o.castShadow, o.receiveShadow, m.emissive.getHex(), m.emissiveIntensity].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  const col = new THREE.Color();
  const vcol = new THREE.Color();
  for (const [, list] of buckets) {
    if (list.length < 2) continue;
    const parts = [];
    let total = 0;
    for (const o of list) {
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      parts.push({ g, o });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), cols = new Float32Array(total * 3);
    let off = 0;
    for (const { g, o } of parts) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      const vc = o.material.vertexColors && g.attributes.color;
      for (let i = 0; i < n; i++) {
        col.copy(o.material.color);
        if (vc) col.multiply(vcol.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)));
        cols[(off + i) * 3] = col.r; cols[(off + i) * 3 + 1] = col.g; cols[(off + i) * 3 + 2] = col.b;
      }
      off += n;
      g.dispose();
      o.parent.remove(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m0 = list[0].material;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: m0.roughness, metalness: m0.metalness, flatShading: m0.flatShading, side: m0.side,
      emissive: m0.emissive, emissiveIntensity: m0.emissiveIntensity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    group.add(mesh);
  }
}

/** 床の点が日だまりにあるか（窓から太陽へたどる） */
export function inSun(x, z) {
  const t = (WINDOW.x - x) / SUN_DIR.x;
  if (t < 0) return false;
  const y = t * SUN_DIR.y;
  const zz = z + t * SUN_DIR.z;
  return y > 0.15 && y < WINDOW.y1 - 0.05 && zz > WINDOW.z0 + 0.05 && zz < WINDOW.z1 - 0.05;
}
