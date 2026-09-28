import * as THREE from 'three';
import { DayCycle } from './sky.js';
import { Post } from './post.js';
import { buildTown } from './town.js';
import { Player } from './player.js';
import { TPCam } from './tpcam.js';
import { Controls } from './controls.js';
import { WIND } from './build.js';
import { UI } from './ui.js';
import { Game, FRIENDS, GIFTS, DETOURS } from './game.js';
import { loadSave, save, getSave } from './save.js';
import { shareDiary, fmtHour } from './share.js';
import { BREEDS, COLORS, breedParams, defaultDogParams, colorHex } from '../dogModel.js';
import { audio } from '../audio.js';
import { isTouchDevice, clamp, smooth } from '../util.js';
import { BED } from '../room.js';

const $ = (id) => document.getElementById(id);
const loadingText = $('loading-text');
const setLoading = (t) => { if (loadingText) loadingText.textContent = t; };

// ------------------------------------------------------------
// 描画の準備
// ------------------------------------------------------------
const canvas = $('c');
const touch = isTouchDevice();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const data = loadSave();
const QUALITY = { auto: '自動', 2: '高', 1: '中', 0: '低' };
let qSetting = data.settings.quality ?? 'auto';
let level = qSetting === 'auto' ? (touch ? 1 : 2) : Number(qSetting);
const PR = [1, 1.5, 2];
renderer.setPixelRatio(Math.min(devicePixelRatio, PR[level]));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 380);
setLoading('空と光を準備中…');
const day = new DayCycle(scene, renderer);
day.setHour(17.2);
setLoading('町を建てています…');
const town = buildTown(scene, renderer, day);
const post = new Post(renderer, scene, camera);
post.setLevel(level);
const player = new Player(scene, town.col);
const cam = new TPCam(camera, town.col);
const ctl = new Controls(canvas, cam);
const ui = new UI(camera);
ui.setTouch(touch);
ctl.onAny = () => { if (ctl.touch !== ui.touch) ui.setTouch(ctl.touch); };
let dogParams = data.dog || defaultDogParams();
player.setParams(dogParams);
player.place(BED.x, 0.05, BED.z, -2.2);
player.dog.setPose('lie');
player.dog.setExpr('sleep');
const game = new Game({ scene, camera, renderer, day, town, player, cam, ctl, post, ui, save: data });

function applyShadowQuality() {
  const size = level === 0 ? 1024 : 2048;
  if (day.sun.shadow.mapSize.x !== size) {
    day.sun.shadow.mapSize.set(size, size);
    if (day.sun.shadow.map) { day.sun.shadow.map.dispose(); day.sun.shadow.map = null; }
  }
}
applyShadowQuality();

// ------------------------------------------------------------
// タイトルの空撮（町を夕方に流していく）
// ------------------------------------------------------------
const FLY = new THREE.CatmullRomCurve3([
  new THREE.Vector3(30, 2.4, 8.6), new THREE.Vector3(40.5, 2.6, 8.2), new THREE.Vector3(43, 2.8, 1),
  new THREE.Vector3(43, 2.6, -20), new THREE.Vector3(43.5, 3.0, -42), new THREE.Vector3(48, 4.0, -58), new THREE.Vector3(58, 3.4, -70),
  new THREE.Vector3(72, 4.2, -73), new THREE.Vector3(86, 5.0, -71), new THREE.Vector3(100, 3.4, -68), new THREE.Vector3(114, 2.6, -74),
]);
const FLY_LOOK = new THREE.CatmullRomCurve3([
  new THREE.Vector3(42, 1.6, 7.5), new THREE.Vector3(44, 2.2, -2), new THREE.Vector3(43, 2.6, -16),
  new THREE.Vector3(43, 2.5, -40), new THREE.Vector3(46, 2.2, -58), new THREE.Vector3(54, 1.8, -76), new THREE.Vector3(70, 2, -76),
  new THREE.Vector3(86, 3, -72), new THREE.Vector3(108, 4.5, -68), new THREE.Vector3(130, 6, -72), new THREE.Vector3(140, 9, -72),
]);
let flyT = 0;
const FLY_DUR = 64;
const fadeEl = $('fade');
function titleCam(c, dt) {
  flyT = (flyT + dt / FLY_DUR) % 1;
  const k = flyT;
  c.position.copy(FLY.getPointAt(k));
  c.lookAt(FLY_LOOK.getPointAt(Math.min(1, k + 0.02)));
  if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
  // 一周のつなぎ目は暗転
  if (mode === 'title') {
    const edge = Math.max(smooth(clamp((k - 0.955) / 0.04, 0, 1)), 1 - smooth(clamp(k / 0.025, 0, 1)));
    fadeEl.style.transition = 'none';
    fadeEl.style.opacity = String(edge);
  }
  return true;
}
// うちの子えらびの時は、部屋の犬をアップで
function customCam(c) {
  const d = player.dog;
  c.position.set(player.pos.x - 1.3, 0.75, player.pos.z + 1.35);
  c.lookAt(d.pos.x - 0.35, 0.33, d.pos.z + 0.1);
  if (c.fov !== 42) { c.fov = 42; c.updateProjectionMatrix(); }
  return true;
}

// ------------------------------------------------------------
// ループ
// ------------------------------------------------------------
let mode = 'loading';   // loading | title | custom | play | result
let paused = false;
let t = 0;
const focus = new THREE.Vector3();
let titleHour = 17.25;

function step(dt) {
  t += dt;
  WIND.time.value = t;
  ctl.update();
  if (mode === 'title' || mode === 'custom') game.hour = titleHour;
  game.update(dt);
  cam.update(dt, player);
  const hour = game.hour;
  day.setHour(hour);
  if (mode === 'title') focus.copy(FLY_LOOK.getPointAt(Math.min(1, flyT + 0.02)));
  else focus.copy(player.pos);
  day.update(dt, focus, camera.position);
  town.update(dt, t, hour, camera.position);
  ui.updateBubbles();
  const h = renderer.domElement.height;
  game.fx.setScale(h); game.dust.setScale(h); game.trail.fx.setScale(h);
}

// 画質の自動調整
let fpsAcc = 0, fpsN = 0, fpsT = 0, lowT = 0;
function autoQuality(dt) {
  if (qSetting !== 'auto' || mode === 'loading') return;
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT < 1) return;
  const fps = fpsN / fpsAcc;
  fpsAcc = 0; fpsN = 0; fpsT = 0;
  if (fps < 38) lowT++; else lowT = Math.max(0, lowT - 1);
  if (lowT >= 3 && level > 0) {
    lowT = 0;
    setLevel(level - 1);
  }
}
function setLevel(l) {
  level = l;
  renderer.setPixelRatio(Math.min(devicePixelRatio, PR[level]));
  renderer.setSize(innerWidth, innerHeight);
  post.setLevel(level);
  post.setSize(innerWidth, innerHeight);
  applyShadowQuality();
}

let manual = false;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (manual || mode === 'loading') return;
  if (!paused) step(dt);
  post.render(dt);
  autoQuality(dt);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------
// 画面
// ------------------------------------------------------------
function show(id) {
  for (const s of ['screen-title', 'screen-custom', 'screen-pause', 'screen-result']) $(s).classList.toggle('hidden', s !== id);
}
function refreshTitle() {
  const s = getSave();
  const lines = [];
  if (s.clears) lines.push(`おむかえ ${s.clears}回 ・ ともだち ${s.friends.length}/${FRIENDS.length} ・ おみやげ ${s.gifts.length}/${Object.keys(GIFTS).length}`);
  if (s.best) lines.push(`いちばん早い到着 ${fmtHour(s.best)}`);
  $('title-stats').textContent = '';
  lines.forEach((l) => { const d = document.createElement('div'); d.textContent = l; $('title-stats').appendChild(d); });
  $('btn-start').textContent = s.clears ? 'もういちど おむかえに' : 'おむかえに行く';
}
function soundLabel() {
  const on = data.settings.sound;
  $('sound-state').textContent = on ? 'ON' : 'OFF';
  $('sound-state2').textContent = on ? 'ON' : 'OFF';
}
function enterTitle() {
  mode = 'title';
  show('screen-title');
  ui.hud(false);
  cam.startCine(titleCam);
  day.fogScale = 1.15;
  refreshTitle();
  soundLabel();
}

function startGame() {
  fadeEl.style.transition = '';
  audio.unlock();
  audio.setEnabled(data.settings.sound);
  show(null);
  mode = 'play';
  day.fogScale = 1;
  ui.fade(1, 0.5);
  setTimeout(() => {
    cam.override = null;
    game.start(dogParams);
    audio.startBgm();
  }, 520);
}

$('btn-start').addEventListener('click', () => { audio.unlock(); audio.play('ok'); startGame(); });
$('btn-sound').addEventListener('click', () => { data.settings.sound = !data.settings.sound; audio.unlock(); audio.setEnabled(data.settings.sound); soundLabel(); save(); });
$('btn-sound2').addEventListener('click', () => { data.settings.sound = !data.settings.sound; audio.setEnabled(data.settings.sound); soundLabel(); save(); });

// うちの子えらび
function buildCustom() {
  const bw = $('opt-breed');
  bw.innerHTML = '';
  for (const [id, b] of Object.entries(BREEDS)) {
    const c = document.createElement('button');
    c.className = 'chip' + (dogParams.breed === id ? ' on' : '');
    c.textContent = b.label;
    c.onclick = () => {
      dogParams = { ...breedParams(id, dogParams.name) };
      applyDog();
      buildCustom();
    };
    bw.appendChild(c);
  }
  const cw = $('opt-color');
  cw.innerHTML = '';
  for (const col of COLORS) {
    const s = document.createElement('button');
    s.className = 'sw' + (dogParams.color === col.id ? ' on' : '');
    s.style.background = col.hex;
    s.title = col.label;
    s.onclick = () => { dogParams = { ...dogParams, color: col.id }; applyDog(); buildCustom(); };
    cw.appendChild(s);
  }
  $('in-fluff').value = Math.round(dogParams.fluff * 100);
  $('in-name').value = dogParams.name || '';
}
function applyDog() {
  player.setParams(dogParams);
  player.place(BED.x - 0.2, 0, BED.z + 0.5, -0.9);
  player.dog.setPose('sit');
  player.dog.setExpr('happy');
}
$('in-fluff').addEventListener('input', (e) => { dogParams = { ...dogParams, fluff: Number(e.target.value) / 100 }; applyDog(); });
$('in-name').addEventListener('input', (e) => { dogParams = { ...dogParams, name: e.target.value.trim() || 'うさ' }; });
$('btn-custom').addEventListener('click', () => {
  audio.unlock(); audio.play('ui');
  mode = 'custom';
  fadeEl.style.opacity = '0';
  show('screen-custom');
  $('screen-custom').classList.add('side');
  titleHour = 15.6;
  applyDog();
  cam.startCine(customCam);
  buildCustom();
});
$('btn-custom-ok').addEventListener('click', () => {
  audio.play('ok');
  dogParams.name = ($('in-name').value || '').trim() || 'うさ';
  data.dog = dogParams;
  save();
  titleHour = 17.25;
  player.place(BED.x, 0.05, BED.z, -2.2);
  player.dog.setPose('lie');
  player.dog.setExpr('sleep');
  enterTitle();
});

// 一時停止
function pause(on) {
  if (mode !== 'play') return;
  paused = on;
  show(on ? 'screen-pause' : null);
  $('quality-state').textContent = QUALITY[qSetting];
  soundLabel();
  if (on) audio.stopBgm(0.3); else audio.startBgm();
}
$('btn-pause').addEventListener('click', () => pause(true));
$('btn-resume').addEventListener('click', () => pause(false));
$('btn-quality').addEventListener('click', () => {
  const order = ['auto', 2, 1, 0];
  const i = order.indexOf(qSetting === 'auto' ? 'auto' : Number(qSetting));
  qSetting = order[(i + 1) % order.length];
  data.settings.quality = qSetting;
  save();
  setLevel(qSetting === 'auto' ? (touch ? 1 : 2) : Number(qSetting));
  $('quality-state').textContent = QUALITY[qSetting];
});
const reload = (auto) => {
  try { if (auto) sessionStorage.setItem('omukae-autostart', '1'); } catch (e) { /* noop */ }
  location.reload();
};
$('btn-restart').addEventListener('click', () => reload(true));
$('btn-quit').addEventListener('click', () => reload(false));
addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && mode === 'play') pause(!paused);
});

// 結果
let lastResult = null;
game.onFinish = (r) => {
  save();
  mode = 'result';
  lastResult = r;
  setTimeout(() => showResult(r), 600);
};
function showResult(r) {
  audio.setBgmMood('normal');
  $('r-title').textContent = `${r.name}、駅までおむかえに行けました`;
  $('r-photo').src = r.photo || '';
  $('r-time').textContent = '18:00 ひだまり駅';
  $('r-gift').textContent = GIFTS[r.gift].label;
  $('r-friends').textContent = `${r.friends.length} / ${FRIENDS.length}`;
  $('r-arrive').textContent = fmtHour(r.arrive);
  const st = $('r-stamps');
  st.innerHTML = '';
  for (const f of FRIENDS) if (r.friends.includes(f.id)) { const s = document.createElement('span'); s.className = 'stamp friend'; s.textContent = f.name; st.appendChild(s); }
  for (const d of r.detours) { const s = document.createElement('span'); s.className = 'stamp'; s.textContent = DETOURS[d]; st.appendChild(s); }
  const s = getSave();
  const missF = FRIENDS.filter((f) => !s.friends.includes(f.id));
  const missG = Object.keys(GIFTS).length - s.gifts.length;
  const tips = [];
  if (missF.length) tips.push(`まだ会っていない ともだち：${missF.length}人（${missF[0].where}に だれかいるかも）`);
  if (missG > 0) tips.push(`おみやげで、飼い主の反応がかわる（あと${missG}種類）`);
  $('r-next').textContent = tips.join(' ／ ') || 'ぜんぶの ともだちと おみやげを見つけました！';
  show('screen-result');
  ui.hud(false);
}
$('btn-share').addEventListener('click', () => { audio.play('ui'); shareDiary(lastResult, 'share'); });
$('btn-save').addEventListener('click', () => { audio.play('ui'); shareDiary(lastResult, 'save'); });
$('btn-again').addEventListener('click', () => reload(true));
$('btn-title').addEventListener('click', () => reload(false));
$('btn-share-close').addEventListener('click', () => $('share-modal').classList.add('hidden'));

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------
setLoading('シェーダーを準備中…');
requestAnimationFrame(() => {
  // 最初の1枚を描いてから幕を上げる（重いシェーダーの準備）
  mode = 'title';
  cam.startCine(titleCam);
  step(0.016);
  try { renderer.compile(scene, camera); } catch (e) { /* noop */ }
  post.render(0.016);
  $('loading').classList.add('gone');
  let auto = false;
  try { auto = sessionStorage.getItem('omukae-autostart') === '1'; sessionStorage.removeItem('omukae-autostart'); } catch (e) { /* noop */ }
  if (auto) {
    show(null);
    ui.fade(1, 0);
    startGame();
  } else {
    enterTitle();
    ui.fade(0, 1.4);
  }
});

// 検証用フック
window.__adv = {
  THREE, renderer, scene, camera, day, town, player, cam, ctl, post, game, ui,
  get mode() { return mode; },
  setManual(v) { manual = v; },
  sim(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) step(dt); post.render(dt); },
  start() { startGame(); },
  setHour(h) { game.hour = h; day.setHour(h); },
  teleport(x, y, z, hd = 0) { player.place(x, y, z, hd); cam.snap(player); },
  view(p, l, fov = 55) {
    cam.startCine((c) => { c.position.set(p[0], p[1], p[2]); c.lookAt(l[0], l[1], l[2]); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } return true; });
  },
  unview() { cam.override = null; cam.blend = 1; },
  setLevel,
  stats() {
    renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length };
  },
  clamp, smooth, colorHex,
};
