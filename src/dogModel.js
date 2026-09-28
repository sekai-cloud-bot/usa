import * as THREE from 'three';
import { puffGeometry, mergeParts, mat, shadeColor, mulberry32, clamp } from './util.js';

export const COLORS = [
  { id: 'white', label: 'ホワイト', hex: '#f8f3ec' },
  { id: 'cream', label: 'クリーム', hex: '#f1dcb8' },
  { id: 'apricot', label: 'アプリコット', hex: '#e7ad76' },
  { id: 'red', label: 'レッド', hex: '#d9843f' },
  { id: 'brown', label: 'ブラウン', hex: '#9b5b34' },
  { id: 'choco', label: 'チョコ', hex: '#6a4330' },
  { id: 'black', label: 'ブラック', hex: '#3b3330' },
  { id: 'gray', label: 'シルバー', hex: '#b8b3ae' },
];

export const BREEDS = {
  bichon: { label: 'ビション', color: 'white', fluff: 1.0, ear: 'fluffy', tail: 'pom', body: 'chibi', snout: 0.55, legs: 0.9, head: 1.18, eye: 1.0, pattern: 'solid' },
  poodle: { label: 'トイプードル', color: 'apricot', fluff: 0.82, ear: 'fluffy', tail: 'pom', body: 'normal', snout: 0.95, legs: 1.1, head: 1.0, eye: 1.0, pattern: 'solid' },
  pome: { label: 'ポメラニアン', color: 'red', fluff: 0.92, ear: 'pointy', tail: 'plume', body: 'chibi', snout: 0.5, legs: 0.8, head: 1.08, eye: 1.05, pattern: 'light' },
  shiba: { label: '柴', color: 'red', fluff: 0.18, ear: 'pointy', tail: 'curl', body: 'normal', snout: 1.0, legs: 1.1, head: 1.0, eye: 0.9, pattern: 'urajiro' },
  chihuahua: { label: 'チワワ', color: 'cream', fluff: 0.05, ear: 'big', tail: 'thin', body: 'chibi', snout: 0.55, legs: 1.05, head: 1.12, eye: 1.3, pattern: 'light' },
  dachs: { label: 'ダックス', color: 'brown', fluff: 0.3, ear: 'long', tail: 'thin', body: 'long', snout: 1.25, legs: 0.62, head: 0.95, eye: 1.0, pattern: 'solid' },
};

export const EARS = [
  { id: 'fluffy', label: 'もふたれ' },
  { id: 'pointy', label: 'ピン' },
  { id: 'big', label: 'おおきい' },
  { id: 'long', label: 'ながたれ' },
];
export const TAILS = [
  { id: 'pom', label: 'ぽんぽん' },
  { id: 'plume', label: 'ふさふさ' },
  { id: 'curl', label: 'くるりん' },
  { id: 'thin', label: 'ほそ' },
];
export const BODIES = [
  { id: 'chibi', label: 'ころころ' },
  { id: 'normal', label: 'ふつう' },
  { id: 'long', label: 'ながい' },
];

export function defaultDogParams() {
  return breedParams('bichon', 'うさ');
}

export function breedParams(breed, name) {
  const b = BREEDS[breed];
  return {
    name: name || 'うさ', breed, color: b.color, fluff: b.fluff, ear: b.ear, tail: b.tail, body: b.body,
    snout: b.snout, legs: b.legs, head: b.head, eye: b.eye, pattern: b.pattern,
  };
}

export function colorHex(id) {
  return (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
}

// 共有マテリアル
const M = {};
function mats() {
  if (M.fur) return M;
  M.fur = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0 });
  // 毛の中で光が回るイメージ：影側も地の色で少し明るく（白い子が灰色にならないように）
  M.fur.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.2;',
    );
  };
  M.eye = new THREE.MeshStandardMaterial({ color: 0x1b1412, roughness: 0.18, metalness: 0.0 });
  M.nose = new THREE.MeshStandardMaterial({ color: 0x2a1e1b, roughness: 0.35 });
  M.hi = new THREE.MeshBasicMaterial({ color: 0xffffff });
  M.tongue = new THREE.MeshStandardMaterial({ color: 0xf07a8c, roughness: 0.5 });
  M.blush = new THREE.MeshBasicMaterial({ color: 0xff9aa6, transparent: true, opacity: 0.38, depthWrite: false });
  M.innerEar = new THREE.MeshStandardMaterial({ color: 0xf2b6ad, roughness: 0.9, flatShading: true });
  for (const k in M) M[k].userData.shared = true;
  return M;
}

/** y方向の簡易AO（下ほど少し暗く） */
function verticalShade(geo, y0, y1, amt) {
  const p = geo.attributes.position, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    const k = 1 - amt * (1 - t);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/**
 * 犬のリグを生成。前方は +Z。
 */
export function buildDog(params) {
  const m = mats();
  const rnd = mulberry32(12345);
  const F = clamp(params.fluff, 0, 1);
  const coat = colorHex(params.color);
  const isDark = new THREE.Color(coat).getHSL({}).l < 0.3;
  let accent = coat;
  if (params.pattern === 'urajiro') accent = isDark ? '#f1e2c8' : '#fbf1e0';
  else if (params.pattern === 'light') accent = shadeColor(coat, 0.12).getStyle();
  const vary = (hex, a = 0.035) => shadeColor(hex, (rnd() - 0.5) * 2 * a);

  const bodyScale = params.body === 'long' ? 1.5 : params.body === 'chibi' ? 0.88 : 1.0;
  const legLen = 0.155 * params.legs;
  const bodyR = 0.145 + F * 0.03;
  const bodyLen = 0.34 * bodyScale;
  const bodyY = legLen + bodyR * 0.82;
  const headR = 0.145 * params.head + F * 0.02;
  const jit = 0.035 + F * 0.075;
  const detail = F > 0.4 ? 1 : 2;

  const root = new THREE.Group();
  root.name = 'dog';
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);

  // ---- 胴体 ----
  const torsoParts = [];
  if (F > 0.4) {
    const n = Math.max(4, Math.round(4 + bodyScale * 2));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = (t - 0.5) * bodyLen;
      const r = bodyR * (0.92 + 0.12 * Math.sin(t * Math.PI));
      torsoParts.push({ geo: puffGeometry(r, 2, jit * 0.7, 11 + i), matrix: mat(0, (rnd() - 0.5) * 0.02, z), color: vary(coat, 0.02) });
    }
    // 胸毛と脇のもこもこ
    torsoParts.push({ geo: puffGeometry(bodyR * 0.72, 1, jit, 31), matrix: mat(0, -0.02, bodyLen / 2 + bodyR * 0.35), color: vary(accent) });
    for (const s of [-1, 1]) {
      torsoParts.push({ geo: puffGeometry(bodyR * 0.62, 1, jit, 41 + s), matrix: mat(s * bodyR * 0.55, -bodyR * 0.2, bodyLen * 0.25), color: vary(coat) });
      torsoParts.push({ geo: puffGeometry(bodyR * 0.62, 1, jit, 51 + s), matrix: mat(s * bodyR * 0.55, -bodyR * 0.2, -bodyLen * 0.3), color: vary(coat) });
    }
  } else {
    torsoParts.push({ geo: puffGeometry(1, detail, 0.04, 7), matrix: mat(0, 0, 0, 0, 0, 0, bodyR, bodyR * 0.95, bodyLen / 2 + bodyR * 0.75), color: coat });
    // お腹・胸（裏白）
    torsoParts.push({ geo: puffGeometry(1, detail, 0.04, 8), matrix: mat(0, -bodyR * 0.2, bodyR * 0.25, 0, 0, 0, bodyR * 0.86, bodyR * 0.8, bodyLen / 2 + bodyR * 0.55), color: accent });
    if (F > 0.1) torsoParts.push({ geo: puffGeometry(bodyR * 0.75, 1, 0.12, 9), matrix: mat(0, bodyR * 0.1, bodyLen / 2 + bodyR * 0.2), color: vary(accent) });
  }
  const torsoGeo = mergeParts(torsoParts);
  verticalShade(torsoGeo, -bodyR, bodyR * 0.3, 0.16);
  const torso = new THREE.Mesh(torsoGeo, m.fur);
  torso.castShadow = true;
  body.add(torso);

  // ---- 頭 ----
  const neck = new THREE.Group();
  neck.position.set(0, bodyR * 0.5, bodyLen / 2 + bodyR * 0.15);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, headR * 0.62, headR * 0.3);
  neck.add(head);

  const headParts = [];
  const snoutL = params.snout;
  const muzzleZ = headR * (0.72 + 0.22 * snoutL);
  const muzzleY = -headR * 0.3;
  if (F > 0.4) {
    headParts.push({ geo: puffGeometry(headR * 1.02, 2, jit * 0.6, 61), matrix: mat(0, 0, 0), color: vary(coat, 0.015) });
    const tufts = [
      [0, 0.72, 0.05, 0.55], [0.5, 0.55, 0.1, 0.48], [-0.5, 0.55, 0.1, 0.48], [0.3, 0.75, -0.35, 0.46], [-0.3, 0.75, -0.35, 0.46],
      [0.78, 0.05, -0.05, 0.5], [-0.78, 0.05, -0.05, 0.5], [0, 0.4, -0.6, 0.5], [0.62, -0.35, 0.25, 0.42], [-0.62, -0.35, 0.25, 0.42],
    ];
    tufts.forEach(([x, y, z, r], i) => {
      const s = 0.85 + F * 0.25;
      headParts.push({ geo: puffGeometry(headR * r * s, 1, jit, 70 + i), matrix: mat(x * headR, y * headR, z * headR), color: vary(i < 5 ? coat : coat) });
    });
    // マズル
    headParts.push({ geo: puffGeometry(headR * 0.42, 1, jit * 0.8, 91), matrix: mat(0, muzzleY, muzzleZ * 0.95, 0, 0, 0, 1.1, 0.85, 0.85 + 0.2 * snoutL), color: vary(accent, 0.02) });
    headParts.push({ geo: puffGeometry(headR * 0.3, 1, jit, 92), matrix: mat(headR * 0.3, muzzleY - headR * 0.05, muzzleZ * 0.82), color: vary(accent) });
    headParts.push({ geo: puffGeometry(headR * 0.3, 1, jit, 93), matrix: mat(-headR * 0.3, muzzleY - headR * 0.05, muzzleZ * 0.82), color: vary(accent) });
  } else {
    headParts.push({ geo: puffGeometry(1, detail, 0.03, 61), matrix: mat(0, 0, 0, 0, 0, 0, headR, headR * 0.92, headR * 0.95), color: coat });
    // 頬（裏白）
    for (const s of [-1, 1]) {
      headParts.push({ geo: puffGeometry(1, detail, 0.03, 62 + s), matrix: mat(s * headR * 0.42, -headR * 0.28, headR * 0.45, 0, 0, 0, headR * 0.45, headR * 0.4, headR * 0.45), color: accent });
    }
    headParts.push({
      geo: puffGeometry(1, detail, 0.03, 64),
      matrix: mat(0, muzzleY, muzzleZ * 0.9, 0.1, 0, 0, headR * 0.42, headR * 0.34, headR * (0.34 + 0.24 * snoutL)),
      color: accent,
    });
    if (params.pattern === 'urajiro') {
      // 麻呂眉
      for (const s of [-1, 1]) headParts.push({ geo: puffGeometry(headR * 0.1, 1, 0.05, 66 + s), matrix: mat(s * headR * 0.35, headR * 0.38, headR * 0.82, 0, 0, 0, 1.2, 0.8, 0.6), color: accent });
    }
    if (F > 0.1) {
      for (const s of [-1, 1]) headParts.push({ geo: puffGeometry(headR * 0.45, 1, 0.14, 68 + s), matrix: mat(s * headR * 0.7, -headR * 0.2, -headR * 0.1), color: vary(coat) });
    }
  }
  const headGeo = mergeParts(headParts);
  verticalShade(headGeo, -headR, headR * 0.2, 0.1);
  const headMesh = new THREE.Mesh(headGeo, m.fur);
  headMesh.castShadow = true;
  head.add(headMesh);

  // 目
  const eyeR = headR * 0.15 * params.eye;
  const eyes = [];
  const eyeGeo = new THREE.SphereGeometry(eyeR, 16, 12);
  const hiGeo = new THREE.SphereGeometry(eyeR * 0.32, 8, 6);
  const hi2Geo = new THREE.SphereGeometry(eyeR * 0.16, 6, 4);
  const surf = F > 0.4 ? 1.0 : 0.93;
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(s * 0.4, 0.1, 0.9).normalize().multiplyScalar(headR * surf);
    const g = new THREE.Group();
    g.position.copy(dir);
    g.lookAt(dir.clone().multiplyScalar(3));
    const e = new THREE.Mesh(eyeGeo, m.eye);
    e.scale.set(1, 1.08, 0.7);
    g.add(e);
    const h1 = new THREE.Mesh(hiGeo, m.hi);
    h1.position.set(-s * eyeR * 0.3, eyeR * 0.35, eyeR * 0.6);
    g.add(h1);
    const h2 = new THREE.Mesh(hi2Geo, m.hi);
    h2.position.set(s * eyeR * 0.3, -eyeR * 0.35, eyeR * 0.62);
    g.add(h2);
    head.add(g);
    eyes.push(g);
  }

  // 鼻・舌・ほっぺ
  const noseZ = F > 0.4 ? muzzleZ * 0.95 + headR * 0.36 * (0.85 + 0.2 * snoutL) : muzzleZ * 0.9 + headR * (0.32 + 0.24 * snoutL);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.1, 12, 8), m.nose);
  nose.scale.set(1.3, 0.95, 0.9);
  nose.position.set(0, muzzleY + headR * 0.1, noseZ);
  head.add(nose);
  const noseHi = new THREE.Mesh(hi2Geo, m.hi);
  noseHi.position.set(-headR * 0.03, muzzleY + headR * 0.16, noseZ + headR * 0.06);
  head.add(noseHi);

  const tongue = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.12, 10, 8), m.tongue);
  tongue.scale.set(1, 0.45, 1.1);
  tongue.position.set(0, muzzleY - headR * 0.24, noseZ - headR * 0.14);
  head.add(tongue);

  const blushGeo = new THREE.CircleGeometry(headR * 0.16, 14);
  const blush = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(blushGeo, m.blush);
    const d = new THREE.Vector3(s * 0.62, -0.16, 0.8).normalize().multiplyScalar(headR * (F > 0.4 ? 1.08 : 0.97));
    b.position.copy(d);
    b.lookAt(d.clone().multiplyScalar(3));
    b.renderOrder = 2;
    head.add(b);
    blush.push(b);
  }

  // くわえ位置
  const mouth = new THREE.Object3D();
  mouth.position.set(0, muzzleY - headR * 0.2, noseZ - headR * 0.05);
  head.add(mouth);

  // ---- 耳 ----
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    let mesh;
    if (params.ear === 'fluffy') {
      ear.position.set(s * headR * 0.78, headR * 0.3, -headR * 0.05);
      const parts = [];
      for (let i = 0; i < 3; i++) {
        parts.push({ geo: puffGeometry(headR * (0.36 - i * 0.02) * (0.8 + F * 0.3), 1, jit, 100 + i + s * 10), matrix: mat(s * headR * 0.08, -headR * (0.12 + i * 0.26), 0), color: vary(coat) });
      }
      mesh = new THREE.Mesh(mergeParts(parts), m.fur);
    } else if (params.ear === 'long') {
      ear.position.set(s * headR * 0.8, headR * 0.25, -headR * 0.1);
      const parts = [{ geo: puffGeometry(1, 1, 0.08, 120 + s), matrix: mat(s * headR * 0.06, -headR * 0.45, 0, 0, 0, s * 0.1, headR * 0.16, headR * 0.55, headR * 0.34), color: shadeColor(coat, -0.06) }];
      mesh = new THREE.Mesh(mergeParts(parts), m.fur);
    } else {
      const big = params.ear === 'big';
      const r = headR * (big ? 0.42 : 0.3);
      const h = headR * (big ? 0.95 : 0.6);
      ear.position.set(s * headR * (big ? 0.55 : 0.5), headR * (big ? 0.62 : 0.72), -headR * 0.1);
      ear.rotation.z = -s * (big ? 0.62 : 0.28);
      const parts = [{ geo: new THREE.ConeGeometry(r, h, 5, 1), matrix: mat(0, h * 0.4, 0, 0, 0, 0, 1, 1, 0.55), color: coat }];
      if (F > 0.5) parts.push({ geo: puffGeometry(r * 0.8, 1, jit, 130 + s), matrix: mat(0, 0, -r * 0.1), color: vary(coat) });
      mesh = new THREE.Mesh(mergeParts(parts), m.fur);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.6, h * 0.7, 5, 1), m.innerEar);
      inner.scale.set(1, 1, 0.3);
      inner.position.set(0, h * 0.34, r * 0.22);
      ear.add(inner);
    }
    mesh.castShadow = true;
    ear.add(mesh);
    ear.userData.baseZ = ear.rotation.z;
    head.add(ear);
    ears.push(ear);
  }

  // ---- しっぽ ----
  const tail = new THREE.Group();
  tail.position.set(0, bodyR * 0.55, -bodyLen / 2 - bodyR * 0.55);
  body.add(tail);
  const tailParts = [];
  if (params.tail === 'pom') {
    const r = 0.055 + F * 0.03;
    tailParts.push({ geo: puffGeometry(r * 0.7, 1, jit, 140), matrix: mat(0, 0.03, -0.01), color: vary(coat) });
    tailParts.push({ geo: puffGeometry(r, 1, jit, 141), matrix: mat(0, 0.1, -0.02), color: vary(coat) });
    tailParts.push({ geo: puffGeometry(r * 0.8, 1, jit, 142), matrix: mat(0, 0.16, 0.02), color: vary(coat) });
  } else if (params.tail === 'plume') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * 2.1;
      const rr = (0.065 + F * 0.03) * (1 - i * 0.08);
      tailParts.push({ geo: puffGeometry(rr, 1, jit, 150 + i), matrix: mat(0, Math.sin(a) * 0.14 + 0.03, -0.05 + (1 - Math.cos(a)) * 0.08), color: vary(i > 2 ? accent : coat) });
    }
  } else if (params.tail === 'curl') {
    const tor = new THREE.TorusGeometry(0.065, 0.032 + F * 0.012, 6, 12, Math.PI * 1.55);
    tailParts.push({ geo: tor, matrix: mat(0, 0.085, 0.0, 0, Math.PI / 2, -0.4), color: coat });
    tailParts.push({ geo: puffGeometry(0.03, 1, 0.1, 160), matrix: mat(0, 0.07, 0.07), color: accent });
  } else {
    const cone = new THREE.ConeGeometry(0.024 + F * 0.012, 0.2, 6, 1);
    tailParts.push({ geo: cone, matrix: mat(0, 0.085, -0.04, -0.45, 0, 0), color: coat });
  }
  const tailMesh = new THREE.Mesh(mergeParts(tailParts), m.fur);
  tailMesh.castShadow = true;
  tail.add(tailMesh);

  // ---- 脚 ----
  const legs = [];
  const legR = 0.04 + F * 0.022;
  const legZ = bodyLen / 2 - 0.02;
  const legX = bodyR * 0.52;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Group();
    leg.position.set(sx * legX, -bodyY + legLen + 0.01, sz * legZ);
    const parts = [];
    if (F > 0.4) {
      parts.push({ geo: puffGeometry(legR * 1.15, 1, jit, 170 + sx * 3 + sz), matrix: mat(0, -legLen * 0.25, 0), color: vary(coat) });
      parts.push({ geo: puffGeometry(legR * 1.1, 1, jit, 180 + sx * 3 + sz), matrix: mat(0, -legLen * 0.62, 0.005), color: vary(coat) });
      parts.push({ geo: puffGeometry(legR * 1.15, 1, jit, 190 + sx * 3 + sz), matrix: mat(0, -legLen + legR * 0.75, 0.02, 0, 0, 0, 1, 0.8, 1.2), color: vary(accent) });
    } else {
      parts.push({ geo: new THREE.CylinderGeometry(legR, legR * 0.9, legLen, 7), matrix: mat(0, -legLen / 2, 0), color: sz > 0 && params.pattern === 'urajiro' ? accent : coat });
      parts.push({ geo: puffGeometry(legR * 1.15, 1, 0.05, 200 + sx * 3 + sz), matrix: mat(0, -legLen + legR * 0.6, 0.02, 0, 0, 0, 1, 0.7, 1.3), color: params.pattern === 'urajiro' ? accent : coat });
    }
    const g = mergeParts(parts);
    const lm = new THREE.Mesh(g, m.fur);
    lm.castShadow = true;
    leg.add(lm);
    body.add(leg);
    legs.push(leg);
  }

  // 接地影（安価な丸影、影なし画質でも接地感を出す）
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: 0x6b4526, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.006;
  blob.scale.set(bodyR * 1.35, bodyLen * 0.5 + bodyR * 0.9, 1);
  blob.renderOrder = 1;
  root.add(blob);

  const top = bodyY + bodyR * 0.5 + headR * 0.62 + headR * 1.1;
  return {
    root, body, neck, head, headMesh, eyes, nose, tongue, blush, mouth, ears, tail, legs, blob,
    dims: { legLen, bodyY, bodyLen, bodyR, headR, top, earType: params.ear, tailType: params.tail },
  };
}
