import * as THREE from 'three';
import { DayCycle } from './sky.js';
import { Post } from './post.js';
import { buildTown } from './town.js';
import { Player } from './player.js';
import { TPCam } from './tpcam.js';
import { Controls } from './controls.js';
import { WIND } from './build.js';
import { GRASS } from './nature.js';
import { FUR } from './look.js';
import { UI } from './ui.js';
import { Game, GIFTS, EVENTS, KINDS } from './game.js';
import { WEAR } from './actors.js';
import { TREASURES } from './treasure.js';
import { TITLES } from './titles.js';
import { AREA_NAMES } from './events.js';
import { loadSave, save, getSave } from './save.js';
import { shareDiary, fmtHour } from './share.js';
import { TYPES, SIZES, PATTERNS, EARS, TAILS, COLORS, typeParams, normalizeDogParams, colorHex } from '../dogModel.js';
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
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const data = loadSave();
const QUALITY = { auto: '自動', 2: '高', 1: '中', 0: '低' };
let qSetting = data.settings.quality ?? 'auto';
let level = qSetting === 'auto' ? (touch ? 1 : 2) : Number(qSetting);
const PR = [1, 1.5, 2];
renderer.setPixelRatio(Math.min(devicePixelRatio, PR[level]));
FUR.shells = [3, 5, 7][level];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 420);
setLoading('空と光を準備中…');
const day = new DayCycle(scene, renderer);
day.setHour(17.2);
setLoading('町を建てています…');
const town = buildTown(scene, renderer, day);
const post = new Post(renderer, scene, camera);
post.noAO.push(day.sky, town.mtn.far, town.mtn.near);
post.setLevel(level);
const player = new Player(scene, town.col);
const cam = new TPCam(camera, town.col);
const ctl = new Controls(canvas, cam);
const ui = new UI(camera);
ui.setTouch(touch);
ctl.onAny = () => { if (ctl.touch !== ui.touch) ui.setTouch(ctl.touch); };
// 前のバージョン（犬種）の保存データも、タイプに読みかえて使う
let dogParams = normalizeDogParams(data.dog);
player.setParams(dogParams);
player.place(BED.x, 0.05, BED.z, -2.2);
player.dog.setPose('lie');
player.dog.setExpr('sleep');
const game = new Game({ scene, camera, renderer, day, town, player, cam, ctl, post, ui, save: data });
game.applyWear();

function applyShadowQuality() {
  const size = [1024, 2048, 4096][level];
  if (day.sun.shadow.mapSize.x !== size) {
    day.sun.shadow.mapSize.set(size, size);
    if (day.sun.shadow.map) { day.sun.shadow.map.dispose(); day.sun.shadow.map = null; }
  }
  day.setShadowRange([18, 24, 30][level]);
  GRASS.density = [0.3, 0.62, 1][level];
}
applyShadowQuality();

// ------------------------------------------------------------
// タイトルの空撮：神社の石段 → 高台 → 町の上 → 商店街 → 公園 → 川（橋の下をくぐる）→ 鉄橋 → 駅
// ------------------------------------------------------------
const FLY_PTS = [
  [-26.5, 1.3, 8.7, -46, 4.8, 8.5],
  [-35, 3.2, 8.6, -52, 8.4, 8.5],
  [-45, 8.7, 8.6, -62, 9.2, 8.5],
  [-54, 9.8, 5.5, -72, 9.6, 8.5],
  [-58, 10.2, -6, -66, 10.5, -12],
  [-54.5, 10.8, -19, -30, 5, -30],
  [-30, 19, -26, 30, 2, -35],
  [18, 17, -12, 43, 4, -18],
  [40, 8, 5, 43, 3, -18],
  [43, 3.4, -12, 43, 2.8, -40],
  [43, 3.2, -38, 50, 2, -62],
  [50, 6.5, -60, 60, 1, -82],
  [58, 6.5, -84, 62, 0, -108],
  [60, 3.5, -106, 90, -2, -128],
  [72, -1.6, -123, 100, -2, -128],
  [88, -1.95, -125, 120, -1, -130],
  [104, -1.2, -127, 142, 8, -138],
  [124, 2.5, -131, 142, 10.5, -140],
  [134, 12, -116, 132, 6, -84],
  [126, 7, -92, 134, 2.5, -72],
  [118, 4, -78, 134, 2.2, -72],
];
const FLY = new THREE.CatmullRomCurve3(FLY_PTS.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
const FLY_LOOK = new THREE.CatmullRomCurve3(FLY_PTS.map((p) => new THREE.Vector3(p[3], p[4], p[5])));
let flyT = 0.004;
const FLY_DUR = 92;
const fadeEl = $('fade');
let trainSent = false;
function titleCam(c, dt) {
  flyT = (flyT + dt / FLY_DUR) % 1;
  const k = flyT;
  c.position.copy(FLY.getPointAt(k));
  c.lookAt(FLY_LOOK.getPointAt(Math.min(1, k + 0.012)));
  if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
  // 川で、ちょうど鉄橋を電車がわたるように
  if (k > 0.66 && k < 0.7 && !trainSent) { trainSent = true; game.sendTrain(1, -320); }
  if (k < 0.1) trainSent = false;
  // 一周のつなぎ目は暗転
  if (mode === 'title') {
    const edge = Math.max(smooth(clamp((k - 0.96) / 0.035, 0, 1)), 1 - smooth(clamp(k / 0.02, 0, 1)));
    fadeEl.style.transition = 'none';
    fadeEl.style.opacity = String(edge);
    post.tilt = 0.55;
    post.tiltFocus = 0.5;
  }
  return true;
}
// うちの子えらびの時は、部屋の犬をアップで。
// 設定カードに隠れない所（横長の画面なら左、縦長なら上）のまんなかに犬が来るよう、画面の中心をずらす
const customCard = document.querySelector('#screen-custom .sheet-card');
function customCam(c) {
  const d = player.dog;
  const W = innerWidth, H = innerHeight;
  const land = W >= H;
  const r = customCard.getBoundingClientRect();
  const cx = land ? clamp(r.left / 2 / W, 0.2, 0.5) : 0.5;
  const cy = land ? 0.5 : clamp(r.top / 2 / H, 0.2, 0.5);
  // 縦長は横が狭いので引く。大きい子は そのぶん引く
  const sz = Math.max(0.9, d.rig.dims.scale);
  const k = (land ? 1 : 1.55) * sz;
  c.position.set(player.pos.x - 1.3 * k, 0.75 * sz + (k / sz - 1) * 0.3, player.pos.z + 1.35 * k);
  c.lookAt(d.pos.x, 0.3 * sz, d.pos.z);
  if (c.fov !== 42) c.fov = 42;
  c.setViewOffset(W, H, W * (0.5 - cx), H * (0.5 - cy), W, H);
  post.tilt = 0;
  return true;
}

// ------------------------------------------------------------
// ループ
// ------------------------------------------------------------
let mode = 'loading';   // loading | title | custom | play | result
let paused = false;
let t = 0;
const focus = new THREE.Vector3();
let titleHour = 17.45;

function step(dt) {
  t += dt;
  WIND.time.value = t;
  ctl.update();
  if (mode === 'title' || mode === 'custom') game.hour = titleHour;
  game.update(dt);
  cam.update(dt, player);
  const hour = game.hour;
  day.setHour(hour);
  if (mode === 'title') focus.copy(FLY_LOOK.getPointAt(Math.min(1, flyT + 0.012)));
  else focus.copy(player.pos);
  day.update(dt, focus, camera.position);
  town.update(dt, t, hour, camera.position, focus);
  post.updateSun(day.sunDir, day.sun.color, day.golden);
  post.grade.uniforms.uWarm.value = day.golden;
  post.grade.uniforms.uDusk.value = day.dusk;
  ui.updateBubbles();
  const h = renderer.domElement.height;
  game.fx.setScale(h); game.dust.setScale(h); game.trail.fx.setScale(h); game.motes.setScale(h);
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
  game.afterRender(dt);
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
  if (s.clears) lines.push(`おむかえ ${s.clears}回 ・ できごと ${(s.events || []).length}/${EVENTS.length} ・ おみやげ ${s.gifts.length}/${Object.keys(GIFTS).length}`);
  if (s.clears || (s.treasures || []).length) lines.push(`たからばこ ${(s.treasures || []).length}/${TREASURES.length} ・ 称号 ${(s.titles || []).length}/${TITLES.length} ・ きせかえ ${(s.wear || []).filter((k) => WEAR[k]).length}/${Object.keys(WEAR).length}`);
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
  camera.clearViewOffset();
  show('screen-title');
  ui.hud(false);
  cam.startCine(titleCam);
  day.fogScale = 1.35;
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
  post.tilt = 0;
  camera.clearViewOffset();
  ui.fade(1, 0.5);
  setTimeout(() => {
    cam.override = null;
    game.start(dogParams);
    audio.startBgm();
    audio.startAmbience();
  }, 520);
}

$('btn-start').addEventListener('click', () => { audio.unlock(); audio.play('ok'); startGame(); });
$('btn-sound').addEventListener('click', () => { data.settings.sound = !data.settings.sound; audio.unlock(); audio.setEnabled(data.settings.sound); soundLabel(); save(); });
$('btn-sound2').addEventListener('click', () => { data.settings.sound = !data.settings.sound; audio.setEnabled(data.settings.sound); soundLabel(); save(); });

// うちの子えらび
let colorPicked = false;
function buildCustom() {
  // タイプ：体つきを選ぶと、耳・しっぽ・もよう・毛の量も その子らしく
  const tw = $('opt-type');
  tw.innerHTML = '';
  for (const [id, t] of Object.entries(TYPES)) {
    const c = document.createElement('button');
    c.className = 'chip' + (dogParams.type === id ? ' on' : '');
    const b = document.createElement('b');
    b.textContent = t.label;
    const sm = document.createElement('small');
    sm.textContent = t.sub;
    c.append(b, sm);
    c.onclick = () => {
      // 色を自分で選んでいたら、その色のまま
      dogParams = typeParams(id, dogParams.name, colorPicked ? { color: dogParams.color } : {});
      applyDog();
      buildCustom();
    };
    tw.appendChild(c);
  }
  const chips = (el, list, key) => {
    const w = $(el);
    w.innerHTML = '';
    for (const o of list) {
      const c = document.createElement('button');
      c.className = 'chip' + (dogParams[key] === o.id ? ' on' : '');
      c.textContent = o.label;
      c.onclick = () => { dogParams = { ...dogParams, [key]: o.id }; applyDog(); buildCustom(); };
      w.appendChild(c);
    }
  };
  chips('opt-size', SIZES, 'size');
  chips('opt-pattern', PATTERNS, 'pattern');
  chips('opt-ear', EARS, 'ear');
  chips('opt-tail', TAILS, 'tail');
  const cw = $('opt-color');
  cw.innerHTML = '';
  for (const col of COLORS) {
    const s = document.createElement('button');
    s.className = 'sw' + (dogParams.color === col.id ? ' on' : '');
    s.style.background = col.hex;
    s.title = col.label;
    s.onclick = () => { colorPicked = true; dogParams = { ...dogParams, color: col.id }; applyDog(); buildCustom(); };
    cw.appendChild(s);
  }
  $('in-fluff').value = Math.round(dogParams.fluff * 100);
  $('in-name').value = dogParams.name || '';
  // きせかえ：もらった物は つけたり はずしたり（場所ごとに1つ）。まだの物は もらい方のヒント
  const ww = $('opt-wear');
  ww.innerHTML = '';
  const have = data.wear || [];
  for (const [k, w] of Object.entries(WEAR)) {
    const c = document.createElement('button');
    const got = have.includes(k);
    const on = got && game.wearChoice(w.slot) === k;
    c.className = 'chip' + (on ? ' on' : '') + (got ? '' : ' locked');
    c.textContent = got ? `${w.icon} ${w.label}` : `？ ${w.how}`;
    c.disabled = !got;
    c.onclick = () => {
      data.wearOn = data.wearOn || {};
      data.wearOn[w.slot] = on ? null : k;
      save();
      audio.play('ui');
      applyDog();
      buildCustom();
    };
    ww.appendChild(c);
  }
  $('wear-count').textContent = `${have.filter((k) => WEAR[k]).length} / ${Object.keys(WEAR).length}`;
}
function applyDog() {
  player.setParams(dogParams);
  game.applyWear();
  player.place(BED.x - 0.2, 0, BED.z + 0.5, -0.9);
  player.dog.setPose('sit');
  player.dog.setExpr('happy');
}
// もこもこ：作り直しは少し重いので、動かしている間は まとめて（0.12秒ごと）
let fluffT = 0;
$('in-fluff').addEventListener('input', (e) => {
  dogParams = { ...dogParams, fluff: Number(e.target.value) / 100 };
  clearTimeout(fluffT);
  fluffT = setTimeout(applyDog, 120);
});
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
  titleHour = 17.45;
  player.place(BED.x, 0.05, BED.z, -2.2);
  player.dog.setPose('lie');
  player.dog.setExpr('sleep');
  enterTitle();
});

// ------------------------------------------------------------
// 一時停止：町の地図と、できごとの一覧
// ------------------------------------------------------------
// 地図の範囲（x: 西→東、z: 北が上）
const MAP = { x0: -92, x1: 212, z0: -176, z1: 32 };
function drawMap() {
  const cv = $('pause-map');
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const sx = W / (MAP.x1 - MAP.x0), sz = H / (MAP.z1 - MAP.z0);
  const s = Math.min(sx, sz);
  const ox = (W - (MAP.x1 - MAP.x0) * s) / 2, oz = (H - (MAP.z1 - MAP.z0) * s) / 2;
  const X = (x) => ox + (x - MAP.x0) * s;
  const Y = (z) => oz + (z - MAP.z0) * s;
  const rect = (x0, z0, x1, z1, col) => { c.fillStyle = col; c.fillRect(X(x0), Y(z0), (x1 - x0) * s, (z1 - z0) * s); };
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#efe4d2';
  c.fillRect(0, 0, W, H);
  // 川
  rect(-92, -166, 212, -110, '#cfe3cf');
  rect(-92, -146.4, 212, -134, '#8fbfd2');
  rect(-92, -114, 212, -110, '#e6dccb');
  // 神社の高台
  rect(-84, -28, -50, 28, '#d6e3c2');
  rect(-50, 7, -34, 10, '#cfc6b6');
  // 家と庭、路地
  rect(-6, -7, 13.5, 5.6, '#d9e8c4');
  rect(-36, 5.6, 48, 11.3, '#d8d0c4');
  // 商店街
  rect(39, -49, 47, 5.6, '#f2d2b0');
  // 公園
  rect(26, -96, 79, -49.5, '#cfe3b6');
  c.fillStyle = '#9cc8d8';
  c.beginPath(); c.ellipse(X(52), Y(-80), 8.6 * s, 5.8 * s, 0, 0, Math.PI * 2); c.fill();
  // 道路
  rect(81, -176, 93, 32, '#bdb6ac');
  // 駅前広場と駅
  rect(95, -100, 130, -44, '#eadfcf');
  rect(130, -106, 150, -38, '#c9b8a2');
  rect(138.2, -176, 145.8, 32, '#a8998a');
  // 路地
  rect(53.8, -106, 61.2, -96, '#d8d0c4');
  rect(108.5, -110, 115.5, -100, '#eadfcf');
  // 名前
  c.fillStyle = 'rgba(90, 60, 40, .75)';
  c.font = `800 ${Math.round(13 * W / 720)}px "M PLUS Rounded 1c", sans-serif`;
  c.textAlign = 'center';
  const label = (t, x, z) => c.fillText(t, X(x), Y(z));
  label('ひだまり神社', -66, -18);
  label('家', 3, -2);
  label('路地', 5, 16);
  label('商店街', 43, -52);
  label('さくら公園', 52, -64);
  label('ひだまり川', 20, -150);
  label('駅', 140, -30);
  // できごと
  const list = game.ev.list();
  const seen = new Set(getSave().events || []);
  for (const e of list) {
    if (!e.pos) continue;
    const x = X(e.pos.x), y = Y(e.pos.z);
    c.beginPath();
    c.arc(x, y, e.done ? 6 : 7, 0, Math.PI * 2);
    c.fillStyle = e.done ? KINDS[e.kind].color : 'rgba(255,255,255,.9)';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = KINDS[e.kind].color;
    c.stroke();
    if (!e.done) {
      c.fillStyle = KINDS[e.kind].color;
      c.font = `800 ${Math.round(10 * W / 720)}px sans-serif`;
      c.fillText(seen.has(e.id) ? '・' : '?', x, y + 4);
    }
  }
  // この回で見つけた「あやしいにおい」（ほった所は ✓）
  for (const m of game.treasure.marks()) {
    const x = X(m.x), y = Y(m.z);
    c.fillStyle = m.dug ? '#a9805a' : '#9ccf5a';
    c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.fill();
  }
  // いまいる所
  const p = player.pos;
  c.save();
  c.translate(X(p.x), Y(p.z));
  c.rotate(-player.dog.heading + Math.PI);
  c.fillStyle = '#e8744f';
  c.strokeStyle = '#fff';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 8); c.lineTo(0, 4); c.lineTo(-8, 8); c.closePath();
  c.fill(); c.stroke();
  c.restore();
  // 一覧
  const box = $('pause-list');
  box.textContent = '';
  for (const e of list) {
    const d = document.createElement('div');
    d.className = 'pl-item ' + (e.done ? 'done' : 'todo');
    const i = document.createElement('i');
    i.style.background = KINDS[e.kind].color;
    d.appendChild(i);
    const s2 = document.createElement('span');
    s2.textContent = e.done || seen.has(e.id) ? e.title : `？？？（${AREA_NAMES[e.area]}）`;
    d.appendChild(s2);
    box.appendChild(d);
  }
  $('pm-count').textContent = `できごと ${game.ev.done.size} / ${EVENTS.length}`;
  // いっしょにいる なかま
  const names = game.party.names();
  $('pm-party').textContent = names.length ? `いっしょに 駅へ：${names.join('・')}` : '';
  // たからばこ（見つけた物だけ絵が出る）
  const have = new Set(getSave().treasures || []);
  const grid = $('tb-grid');
  grid.textContent = '';
  for (const t of TREASURES) {
    const d = document.createElement('div');
    const got = have.has(t.id);
    d.className = 'tb-cell' + (got ? '' : ' empty');
    d.textContent = got ? t.icon : '？';
    d.title = got ? t.name : AREA_NAMES[t.area];
    grid.appendChild(d);
  }
  $('tb-count').textContent = `${have.size} / ${TREASURES.length}`;
}

function pause(on) {
  if (mode !== 'play') return;
  paused = on;
  show(on ? 'screen-pause' : null);
  $('quality-state').textContent = QUALITY[qSetting];
  soundLabel();
  if (on) { drawMap(); audio.stopBgm(0.3); audio.duck(true); } else { audio.startBgm(); audio.duck(false); }
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

// ------------------------------------------------------------
// 結果：おむかえ日記（再会の写真と、思い出アルバム）
// ------------------------------------------------------------
let lastResult = null;
game.onFinish = (r) => {
  save();
  mode = 'result';
  lastResult = r;
  setTimeout(() => showResult(r), 600);
};
function showResult(r) {
  audio.setBgmMood('normal');
  $('r-title').textContent = r.late ? `${r.name}、駅まで さがしに来てくれました` : `${r.name}、駅までおむかえに行けました`;
  $('r-photo').src = r.photo || '';
  $('r-time').textContent = `${fmtHour(r.arrive)} ひだまり駅`;
  $('r-gift').textContent = GIFTS[r.gift].label;
  $('r-events').textContent = `${r.events.length} / ${EVENTS.length}`;
  $('r-arrive').textContent = r.late ? `${fmtHour(r.arrive)}（おくれて）` : fmtHour(r.arrive);
  const al = $('r-album');
  al.textContent = '';
  const pick = r.memories.filter((m) => m.url);
  // 種類がばらけるように、最大6枚
  const shown = [];
  for (const k of ['view', 'friend', 'play', 'item']) for (const m of pick) if (m.kind === k && shown.length < 6 && !shown.includes(m) && shown.filter((x) => x.kind === k).length < 2) shown.push(m);
  for (const m of pick) if (shown.length < 6 && !shown.includes(m)) shown.push(m);
  shown.forEach((m, i) => {
    const f = document.createElement('figure');
    f.style.setProperty('--r', `${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg`);
    const img = document.createElement('img');
    img.src = m.url;
    img.alt = m.title;
    const cap = document.createElement('figcaption');
    cap.textContent = m.title;
    f.append(img, cap);
    al.appendChild(f);
  });
  al.style.display = shown.length ? '' : 'none';
  // きょうの称号
  const T = r.title;
  $('r-badge').style.display = T ? '' : 'none';
  if (T) {
    $('rb-name').textContent = T.name;
    $('rb-new').style.display = T.isNew ? '' : 'none';
    $('rb-sub').textContent = `${T.sub}${T.more ? `（ほかにも 新しい称号が ${T.more}こ）` : ''} ・ 称号 ${T.count}/${T.total}`;
  }
  const st = $('r-stamps');
  st.innerHTML = '';
  const line = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; st.appendChild(d); };
  if (r.party && r.party.length) line('r-party', `いっしょに 駅へ：${r.party.join('・')}`);
  if (r.dug) line('r-treasure', r.treasureNew.length ? `おたから ＋${r.treasureNew.length}こ（たからばこ ${r.treasureTotal} / ${TREASURES.length}）` : `ほった所 ${r.dug}か所（ぜんぶ おやつだった）`);
  if (r.fortune) line('r-fortune', `おみくじ 大吉：${r.fortune}`);
  for (const e of EVENTS) if (r.events.includes(e.id) && e.kind === 'friend') { const s = document.createElement('span'); s.className = 'stamp friend'; s.textContent = e.title; st.appendChild(s); }
  const s = getSave();
  const missE = EVENTS.filter((e) => !(s.events || []).includes(e.id));
  const missG = Object.keys(GIFTS).length - s.gifts.length;
  const missT = TREASURES.length - (s.treasures || []).length;
  const tips = [];
  if (missE.length) tips.push(`まだ見ていない できごと：${missE.length}こ（${AREA_NAMES[missE[0].area]}に なにかあるかも）`);
  if (missG > 0) tips.push(`おみやげで、あの人の反応がかわる（あと${missG}種類）`);
  if (missT > 0) tips.push(`たからばこ あと${missT}こ（くんくん で さがそう）`);
  $('r-next').textContent = tips.join(' ／ ') || 'ぜんぶの できごと・おみやげ・おたからを見つけました！';
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
  sim(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) step(dt); post.render(dt); game.afterRender(dt * n); },
  start() { startGame(); },
  setHour(h) { game.hour = h; day.setHour(h); },
  teleport(x, y, z, hd = 0) { player.place(x, y, z, hd); cam.snap(player); },
  view(p, l, fov = 55) {
    cam.startCine((c) => { c.position.set(p[0], p[1], p[2]); c.lookAt(l[0], l[1], l[2]); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } return true; });
  },
  unview() { cam.override = null; cam.blend = 1; },
  setLevel,
  pause,
  showResult,
  stats() {
    renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length };
  },
  clamp, smooth, colorHex,
};
