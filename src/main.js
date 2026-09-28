import * as THREE from 'three';
import { buildRoom, SUN_DIR, WINDOW } from './room.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Dog } from './dog.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { CamRig } from './camera.js';
import { Game } from './game.js';
import { audio } from './audio.js';
import { loadSave, save, getSave } from './save.js';
import { defaultDogParams, BREEDS } from './dogModel.js';
import { MOMENTS, MOMENT_MAP } from './moments.js';
import { shareResult } from './share.js';
import { isTouchDevice } from './util.js';

const sv = loadSave();
audio.enabled = sv.settings.sound;

// ------------------------------------------------------------
// レンダラ
// ------------------------------------------------------------
const canvas = document.getElementById('c');
const dpr = window.devicePixelRatio || 1;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3dcc0);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

// 光：窓からの日差し＋やわらかい環境光
const hemi = new THREE.HemisphereLight(0xfff4e6, 0xd8a476, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd6a0, 3.1);
sun.position.copy(SUN_DIR).multiplyScalar(14);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
const sc = sun.shadow.camera;
sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 2; sc.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xfff0e2, 1.05);
fill.position.set(-3, 6, 8);
scene.add(fill);

const room = buildRoom(scene, renderer);

// 影なし画質用の、床の日だまり（窓の形を床に投影）
const fakeSun = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const panes = [[WINDOW.z0 + 0.05, -2.08], [-2.02, -1.24], [-1.16, -0.38], [-0.32, WINDOW.z1 - 0.05]];
  for (const [z0, z1] of panes) {
    const pts = [];
    for (const [y, z] of [[0.05, z0], [0.05, z1], [WINDOW.y1 - 0.05, z1], [WINDOW.y1 - 0.05, z0]]) {
      const t = y / SUN_DIR.y;
      pts.push(new THREE.Vector3(WINDOW.x - SUN_DIR.x * t, 0.006, z - SUN_DIR.z * t));
    }
    const g = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
    g.computeVertexNormals();
    fakeSun.add(new THREE.Mesh(g, mat));
  }
  fakeSun.visible = false;
  scene.add(fakeSun);
}

const fx = new FX(scene, camera);
const world = new World(scene, room, fx);
const dog = new Dog(scene);
const initial = sv.dog || defaultDogParams();
if (!initial.personality) initial.personality = BREEDS[initial.breed]?.personality || 'amaenbo';
dog.setParams(initial);
const input = new Input(canvas);
const ui = new UI();
const camRig = new CamRig(camera);

// ------------------------------------------------------------
// 撮影（写真・アバター）
// ------------------------------------------------------------
function captureView(cam, w, h, blurred = false, type = 'image/jpeg') {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const saved = { aspect: cam.aspect, view: cam.view ? { ...cam.view } : null };
  cam.clearViewOffset();
  cam.aspect = size.x / size.y;
  cam.updateProjectionMatrix();
  const bubbleVis = fx.bubble.visible, ringVis = fx.ring.visible;
  fx.bubble.visible = false; fx.ring.visible = false;
  renderer.render(scene, cam);
  fx.bubble.visible = bubbleVis; fx.ring.visible = ringVis;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const r = w / h;
  let sw = size.x, sh = size.x / r;
  if (sh > size.y) { sh = size.y; sw = sh * r; }
  if (blurred) ctx.filter = 'blur(3px)';
  ctx.drawImage(renderer.domElement, (size.x - sw) / 2, (size.y - sh) / 2, sw, sh, 0, 0, w, h);
  ctx.filter = 'none';
  cam.aspect = saved.aspect;
  if (saved.view && saved.view.enabled) cam.setViewOffset(saved.view.fullWidth, saved.view.fullHeight, saved.view.offsetX, saved.view.offsetY, saved.view.width, saved.view.height);
  cam.updateProjectionMatrix();
  return out.toDataURL(type, 0.86);
}

const portraitCam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
function capturePortrait() {
  dog.rig.root.updateMatrixWorld(true);
  const head = new THREE.Vector3();
  dog.rig.head.getWorldPosition(head);
  const f = new THREE.Vector3(Math.sin(dog.heading), 0, Math.cos(dog.heading));
  const dist = 0.62 + dog.rig.dims.headR * 1.5;
  portraitCam.position.copy(head).addScaledVector(f, dist).add(new THREE.Vector3(0, 0.1, 0));
  portraitCam.lookAt(head.x, head.y + 0.02, head.z);
  const devVis = room.devices.map((d) => d.visible);
  room.devices.forEach((d) => { d.visible = false; });
  const url = captureView(portraitCam, 256, 256, false, 'image/png');
  room.devices.forEach((d, i) => { d.visible = devVis[i]; });
  return url;
}

let lastPortrait = null;
function updateAvatar() {
  const save0 = { h: dog.heading, look: dog.lookAt, hold: dog.lookHold, exp: dog.expr, pose: dog.poseTarget, p: { ...dog.pose }, pos: dog.pos.clone() };
  dog.heading = 0;
  dog.lookAt = null;
  dog.lookYaw = 0;
  dog.lookPitch = 0;
  dog.blinking = 0;
  dog.blinkT = 3;
  dog.setExpr('happy');
  dog.setPose('sit');
  dog.pose.sit = 1; dog.pose.lie = 0; dog.pose.belly = 0; dog.pose.bow = 0;
  dog.update(0.001, { x: 0, z: 0 }, null);
  const url = capturePortrait();
  ui.setAvatar(url);
  lastPortrait = url;
  dog.heading = save0.h;
  dog.lookAt = save0.look;
  dog.lookHold = save0.hold;
  dog.setExpr(save0.exp);
  dog.setPose(save0.pose);
  Object.assign(dog.pose, save0.p);
  dog.pos.copy(save0.pos);
  dog.update(0.001, { x: 0, z: 0 }, null);
}

const game = new Game({ scene, camera, camRig, world, dog, fx, ui, input, renderer, room, capture: captureView });

// ------------------------------------------------------------
// 画質（端末負荷に合わせて自動調整）
// ------------------------------------------------------------
const QUALITY = [
  { id: 'low', label: 'かるい', pr: 1, shadow: 0 },
  { id: 'mid', label: 'ふつう', pr: 1.5, shadow: 1024 },
  { id: 'high', label: 'きれい', pr: 2, shadow: 2048 },
];
let qLevel = isTouchDevice() ? 1 : 2;
if (sv.settings.quality !== 'auto') qLevel = Math.max(0, QUALITY.findIndex((q) => q.id === sv.settings.quality));
const perf = { t: 0, frames: 0, grace: 3 };

function applyQuality(level) {
  qLevel = Math.max(0, Math.min(QUALITY.length - 1, level));
  const q = QUALITY[qLevel];
  renderer.setPixelRatio(Math.min(dpr, q.pr));
  const shadows = q.shadow > 0;
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
  }
  sun.castShadow = shadows;
  if (shadows && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  fakeSun.visible = !shadows;
  sun.intensity = shadows ? 3.1 : 1.3;
  hemi.intensity = shadows ? 1.6 : 1.75;
  document.getElementById('quality-state').textContent = sv.settings.quality === 'auto' ? `自動（${q.label}）` : q.label;
  resize();
}

function samplePerf(dt) {
  if (sv.settings.quality !== 'auto' || document.hidden) return;
  if (perf.grace > 0) { perf.grace -= dt; return; }
  perf.t += dt;
  perf.frames++;
  if (perf.t >= 2.5) {
    const fps = perf.frames / perf.t;
    perf.t = 0; perf.frames = 0;
    if (fps < 42 && qLevel > 0) {
      applyQuality(qLevel - 1);
      perf.grace = 2;
    }
  }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camRig.resize(w, h);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------
// 画面遷移
// ------------------------------------------------------------
function startRun() {
  audio.unlock();
  game.startRun();
  updateAvatar();
  perf.grace = 2;
}
function openCustom() {
  game.toCustom();
  ui.buildCustom(dog.params, (p, rebuild) => {
    if (rebuild) {
      dog.setParams({ ...p });
      dog.update(0.016, { x: 0, z: 0 }, null);
    } else dog.params = { ...dog.params, name: p.name, personality: p.personality };
  });
}
const albumCount = () => `${Object.keys(getSave().album).filter((k) => MOMENT_MAP[k]).length}/${MOMENTS.length}`;

ui.on('start', () => {
  if (!getSave().dog) { openCustom(); return; }
  startRun();
});
ui.on('custom', openCustom);
ui.on('customOk', () => {
  const p = ui.customParams || dog.params;
  dog.params = { ...p };
  getSave().dog = { ...p };
  save();
  startRun();
});
ui.on('collection', () => ui.showCollection());
ui.on('collectionClose', () => ui.hide('collection'));
ui.on('again', () => startRun());
ui.on('title', () => { ui.hide('pause'); game.toTitle(); });
ui.on('pause', () => game.pause());
ui.on('resume', () => game.resume());
ui.on('restart', () => { ui.hide('pause'); startRun(); });
ui.on('end', () => game.finish());
ui.on('shutter', () => game.action('shutter'));
ui.on('treat', () => game.action('treat'));
ui.on('call', () => game.action('call'));
ui.on('laser', () => game.action('laser'));
ui.on('find', () => game.action('find'));
ui.on('switch', () => game.action('switch'));
ui.on('zoom', (f) => { if (game.state === 'play') camRig.zoomBy(f); });
ui.on('sound', () => {
  sv.settings.sound = !sv.settings.sound;
  audio.setEnabled(sv.settings.sound);
  document.getElementById('sound-state').textContent = sv.settings.sound ? 'ON' : 'OFF';
  save();
});
document.getElementById('sound-state').textContent = sv.settings.sound ? 'ON' : 'OFF';
ui.on('quality', () => {
  const order = ['auto', 'high', 'mid', 'low'];
  const i = order.indexOf(sv.settings.quality);
  sv.settings.quality = order[(i + 1) % order.length];
  save();
  applyQuality(sv.settings.quality === 'auto' ? (isTouchDevice() ? 1 : 2) : QUALITY.findIndex((q) => q.id === sv.settings.quality));
});
ui.on('share', () => game.result && shareResult(game.result, ui.cover, lastPortrait, albumCount(), 'share'));
ui.on('save', () => game.result && shareResult(game.result, ui.cover, lastPortrait, albumCount(), 'save'));
ui.on('shareClose', () => document.getElementById('share-modal').classList.add('hidden'));

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.state === 'play') game.pause();
    else if (game.state === 'paused') game.resume();
  }
  if (e.code === 'KeyR' && game.state === 'album') startRun();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
window.addEventListener('keydown', () => audio.unlock(), { capture: true });

// ------------------------------------------------------------
// ループ
// ------------------------------------------------------------
applyQuality(qLevel);
resize();
game.toTitle();
camRig.setMode('overview', dog, true);

let last = performance.now();
const motes = room.motes.geometry.attributes.position;
let manual = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) {
    game.update(dt);
    camRig.update(dt);
  }
  for (let i = 0; i < motes.count; i++) {
    let y = motes.getY(i) + dt * 0.03;
    if (y > 2.3) y = 0.2;
    motes.setY(i, y);
    motes.setX(i, motes.getX(i) + Math.sin(now * 0.0005 + i) * dt * 0.02);
  }
  motes.needsUpdate = true;
  renderer.render(scene, camera);
  samplePerf(dt);
}
requestAnimationFrame(frame);

const loading = document.getElementById('loading');
loading.classList.add('fade');
setTimeout(() => loading.remove(), 600);

// 検証用フック（ブラウザ自動テストから固定ステップで操作する。通常プレイには影響しない）
window.__game = {
  game, dog, world, camRig, renderer, input, applyQuality, brain: game.brain,
  get quality() { return QUALITY[qLevel].id; },
  setManual(v) { manual = v; },
  sim(seconds) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      game.update(1 / 60);
      camRig.update(1 / 60);
    }
  },
  startRun,
};
