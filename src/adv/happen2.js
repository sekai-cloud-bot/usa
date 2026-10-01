import * as THREE from 'three';
import { makeChick, waddle } from './actors.js';
import { ChickFollower } from './party.js';
import { riverGroundY } from './town2.js';
import { audio } from '../audio.js';
import { clamp, dampAngle, lerp, smooth } from '../util.js';

// ------------------------------------------------------------
// あとから足した できごと：まいごのカルガモ（商店街 → 公園の池）と、
// 河川敷の「だるまさんが ころんだ」
// ------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function installMore(g) {
  duckling(g);
  daruma(g);
}

/** ひなの顔のしるし（クリーム色の丸に、黄色い顔） */
function chickIcon() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(255, 250, 240, 0.92)';
  c.beginPath(); c.arc(32, 32, 30, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ead48f';
  c.beginPath(); c.arc(32, 35, 20, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5a4a32';
  c.beginPath(); c.arc(32, 31, 20, Math.PI * 1.08, Math.PI * 1.92); c.fill();
  c.fillStyle = '#15100c';
  for (const x of [24, 40]) { c.beginPath(); c.arc(x, 35, 3, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#e8944a';
  c.beginPath(); c.moveTo(27, 41); c.lineTo(37, 41); c.lineTo(32, 46); c.closePath(); c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------
// まいごのカルガモ：商店街で ないている ひなを、さくら公園の池の お母さんの所へ。
//   そっと近づいて おすわりすると、ついてくる（なかま）。
//   ひなは足が おそいので、走ると はぐれて ないてしまう
// ------------------------------------------------------------
function duckling(g) {
  const P = g.A.pondR;
  const home = V(44.4, 0, -15.2);   // 商店街のまんなか、ベンチのそば
  const c = makeChick();
  const pos = c.root.position;
  pos.copy(home);
  g.scene.add(c.root);
  const follower = new ChickFollower(g, c, { id: 'chick', name: 'カルガモのひな' });
  g.duckling = follower;
  let st = 'lost';   // lost（まいご）| scared | imprint | follow | returning | home（池に帰った）
  let t = 0, heading = 2.2, peepT = 2, scaredT = 0, lostT = 0, cryT = 0, warnedRun = false, warnedSlow = false, saidGrandma = false;
  const goal = home.clone();
  const inPond = (p, m) => ((p.x - P.x) / (P.rx + m)) ** 2 + ((p.z - P.z) / (P.rz + m)) ** 2 < 1;
  const up = (y = 0.3) => pos.clone().add(_a.set(0, y, 0));
  // ついてきている間は、ひなの上に 小さな顔のしるし（草むらでも見失わないように）
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: chickIcon(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  tag.renderOrder = 9;
  tag.visible = false;
  g.scene.add(tag);

  // 目じるし：まいごの時は ひなの上、ついてきている時は 行き先（池の南のふち）
  g.ev.pos('duckling', () => {
    if (st === 'home' || st === 'returning') return null;
    if (st === 'follow') return _a.set(P.x, 1.7, P.z + P.rz + 0.6);
    return _a.copy(pos).setY(pos.y + 0.6);
  });

  g.on('update', (dt) => {
    t += dt;
    const p = g.player, dp = p.pos;
    const d = dist2(dp, pos);
    tag.visible = st === 'follow' && g.state === 'play';
    if (tag.visible) {
      // はぐれた時は、大きく ぴょこぴょこ
      const k = follower.hold ? 1.35 + Math.abs(Math.sin(t * 7)) * 0.25 : 1;
      tag.position.set(pos.x, pos.y + 0.48 + Math.sin(t * 3) * 0.03, pos.z);
      tag.scale.setScalar(0.2 * k * clamp(g.camera.position.distanceTo(pos) / 4, 0.8, 2.2));
    }
    if (st === 'follow') { followUpdate(dt, d); return; }
    if (st !== 'lost' && st !== 'scared') return;
    // ピヨピヨ（近いと聞こえる）
    peepT -= dt;
    if (peepT <= 0 && d < 24 && g.state === 'play') {
      peepT = 2.2 + Math.random() * 2;
      audio.play('peep', 0.95 + Math.random() * 0.15);
      if (d < 12 && Math.random() < 0.5) g.sayAt(up(), 'ピヨ…ピヨ…', 1.2);
    }
    // 走って近づくと、こわがって にげる
    if (st === 'lost' && d < 3.2 && p.run && p.dog.speed > 2.8) {
      st = 'scared';
      scaredT = 2.5;
      audio.play('peep', 1.3);
      g.sayAt(up(), 'ピヨッ！', 1.0);
      const ax = pos.x - dp.x, az = pos.z - dp.z, l = Math.hypot(ax, az) || 1;
      goal.set(clamp(pos.x + (ax / l) * 2.4, 39.8, 46.2), 0, pos.z + (az / l) * 2.4);
      g.town.col.resolve(goal, 0.25, 0.3, 0.3);
      if (!warnedRun) { warnedRun = true; g.ui.toast('ひなが こわがっている…。走らずに、そっと近づこう', 'heart'); }
    }
    if (st === 'scared') { scaredT -= dt; if (scaredT <= 0) st = 'lost'; }
    // うろうろ（もとの場所の まわり）
    if (st === 'lost' && Math.random() < dt * 0.3) {
      goal.set(home.x + (Math.random() - 0.5) * 2.4, home.y, home.z + (Math.random() - 0.5) * 3);
      g.town.col.resolve(goal, 0.25, 0.3, 0.3);
    }
    const gx = goal.x - pos.x, gz = goal.z - pos.z, gl = Math.hypot(gx, gz);
    const spd = st === 'scared' ? 2.4 : 0.35;
    let k = 0;
    if (gl > 0.05) {
      const s = Math.min(spd, gl * 3) * dt;
      pos.x += (gx / gl) * s;
      pos.z += (gz / gl) * s;
      heading = dampAngle(heading, Math.atan2(gx, gz), 8, dt);
      k = Math.min(1, spd / 1.5);
    } else if (d < 6) heading = dampAngle(heading, Math.atan2(dp.x - pos.x, dp.z - pos.z), 2, dt);
    c.root.rotation.y = heading;
    waddle(c, t, k);
  });

  // ついてくる間：はぐれたら ないて待つ／池に着いたら、お母さんの所へ
  function followUpdate(dt, d) {
    if (!follower.hold && d > 9) {
      follower.hold = true;
      lostT = 0;
      cryT = 0;
      if (!warnedSlow) { warnedSlow = true; g.ui.toast('ひなが おいつけない…！ もどって、ゆっくり歩こう', 'heart'); }
    } else if (follower.hold) {
      lostT += dt;
      cryT -= dt;
      if (cryT <= 0) { cryT = 1.6; audio.play('peep', 1.35); g.sayAt(up(), 'ピヨー！ ピヨー！', 1.2); }
      if (d < 2.8) {
        // 犬が もどってきた：いま来た道の、ひなに近い所から また ついていく
        follower.hold = false;
        follower.s = g.party.nearestS(pos, g.party.total - 14);
        audio.play('peep', 1.2);
        g.sayAt(up(), 'ピヨッ！', 0.9);
      } else if (lostT > 45 || d > 80) {
        // あきらめて、その場で まいごに もどる
        g.party.leave('chick');
        follower.hold = false;
        st = 'lost';
        home.copy(pos);
        goal.copy(pos);
        g.restoreObjective();
        return;
      }
    }
    // 魚屋のおばあちゃんが 行き先を教えてくれる
    if (!saidGrandma && g.grandma && g.grandma.pos.distanceTo(g.player.pos) < 4.5) {
      saidGrandma = true;
      g.say(g.grandma, 'あらまあ、カルガモの赤ちゃん！ お母さんなら、公園の池に いたわよ', 3.2);
    }
    if (!follower.hold && inPond(pos, 3.2) && g.state === 'play' && !g.player.locked) g.run(reunite());
  }

  g.on('sit', (dp) => {
    if (st !== 'lost' || dist2(dp, pos) > 2.4) return false;
    g.run(imprint());
    return true;
  });

  function* imprint() {
    st = 'imprint';
    const dp = g.player.pos;
    heading = Math.atan2(dp.x - pos.x, dp.z - pos.z);
    c.root.rotation.y = heading;
    waddle(c, t, 0);
    audio.play('peep');
    g.sayAt(up(), 'ピヨ…？', 1.4);
    yield 0.8;
    // ぴょこぴょこ
    for (let i = 0; i < 2; i++) {
      let k = 0;
      audio.play('peep', 1.15 + i * 0.1);
      while (k < 1) {
        const dt = yield;
        k = Math.min(1, k + (dt || 0.016) / 0.3);
        c.body.position.y = Math.sin(k * Math.PI) * 0.09;
      }
    }
    g.sayAt(up(), 'ピヨピヨッ！（ついていく！）', 2.0);
    g.hearts(up(0.25), 4);
    yield 0.6;
    if (g.flags.arrival) { st = 'lost'; return; }
    st = 'follow';
    follower.hold = false;
    follower.heading = heading;
    g.party.join(follower);
    g.ui.objective('ひなを、さくら公園の池の お母さんの所へ');
    g.ui.toast('ひなが ついてきた！ 走ると はぐれるので、ゆっくり歩こう', 'heart');
  }

  function* reunite() {
    if (st !== 'follow') return;
    st = 'returning';
    const p = g.player;
    g.lock(true);
    g.party.leave('chick');
    p.dog.setPose('sit');
    const start = pos.clone();
    // 池に入る所（ふちから少し内がわ）と、岸の外向き
    const ex = (start.x - P.x) / P.rx, ez = (start.z - P.z) / P.rz, el = Math.hypot(ex, ez) || 1;
    const W = V(P.x + (ex / el) * P.rx * 0.8, 0.1, P.z + (ez / el) * P.rz * 0.8);
    const out = V(start.x - P.x, 0, start.z - P.z).normalize();
    const side = V(-out.z, 0, out.x);
    g.ducks.attract(W, 9);
    // 岸の石の上から、池の中まで見える高さで
    const camP = V(start.x + out.x * 2.2 + side.x * 1.4, start.y + 1.75, start.z + out.z * 2.2 + side.z * 1.4);
    const look = V(lerp(W.x, start.x, 0.35), 0.15, lerp(W.z, start.z, 0.35));
    g.post.tilt = 0.45;
    g.post.tiltFocus = 0.5;
    g.cine((cam) => {
      cam.position.copy(camP);
      cam.lookAt(look);
      if (cam.fov !== 48) { cam.fov = 48; cam.updateProjectionMatrix(); }
      return true;
    });
    audio.play('peep', 1.2);
    g.sayAt(up(), 'ピヨ！', 1.0);
    yield 1.1;
    // ぴょんっと 池へ
    heading = Math.atan2(W.x - start.x, W.z - start.z);
    c.root.rotation.y = heading;
    let k = 0;
    while (k < 1) {
      const dt = yield;
      k = Math.min(1, k + (dt || 0.016) / 0.6);
      pos.lerpVectors(start, W, smooth(k));
      pos.y = lerp(start.y, 0.1, k) + Math.sin(k * Math.PI) * 0.35;
      waddle(c, t += dt || 0.016, 0.5);
    }
    g.splash(W.clone(), 12);
    audio.play('splash', 0.7);
    // お母さんの列の いちばんうしろへ（あとは Ducks が動かす）
    g.ducks.addChick(c, W.x, W.z);
    yield 0.9;
    for (let i = 0; i < 3; i++) { audio.play('quack', 1 + i * 0.1); yield 0.35; }
    const M = g.ducks.mother;
    g.sayAt(V(M.x, 0.6, M.z), 'グワッ、グワッ！（ぼうや！）', 2.0);
    yield 0.5;
    audio.play('peep', 1.25);
    g.hearts(V(W.x, 0.45, W.z), 6);
    g.ev.complete('duckling', 'まいごの ひなを、池の お母さんの所へ つれていった', { wait: 0.7 });
    st = 'home';
    yield 2.8;
    g.restoreObjective();
    g.endCine(Math.atan2(out.x, out.z), 0.3);
    g.lock(false);
  }
}

// ------------------------------------------------------------
// だるまさんが ころんだ（河川敷）
//   オニの子が 一本木に顔をふせて「だるまさんが ころんだ」と言う間だけ 動ける。
//   ふり向いた時に動いていたら、スタートの線へ もどる。オニに タッチできたら かち。
//   犬が来なくても、子どもたちだけで遊んでいる（見ていると、ルールが わかる）
// ------------------------------------------------------------
const MORAE = ['だ', 'る', 'ま', 'さ', 'ん', 'が', 'こ', 'ろ', 'ん', 'だ'];
const MELODY = [0, 0, 2, 2, 0, -2, 0, 2, 0, -3];
// 1音ごとの間（秒）。ふつう／はやい／ゆっくり→はやい（ひっかけ）／「が」で ためる
const TEMPO = [
  [0.23, 0.23, 0.23, 0.23, 0.23, 0.23, 0.23, 0.23, 0.23, 0.23],
  [0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14],
  [0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.1, 0.1, 0.1, 0.1],
  [0.2, 0.2, 0.2, 0.2, 0.2, 0.55, 0.18, 0.18, 0.18, 0.18],
];
const FREEZE = ['cheer', 'wave', 'give', 'flag'];

function daruma(g) {
  const A = g.A;
  const T = A.darumaTree, LINE = A.darumaLine;
  const gy = (x, z) => riverGroundY(x, z);
  const ox = T.x + 1.15, oz = T.z;
  const oni = g.P({ name: 'オニの かいとくん', kid: true, top: 0xe8604c, bottom: 0x3b3f45, hat: 'cap', hatColor: 0x3e6ea8 }, ox, oz, -Math.PI / 2, gy(ox, oz));
  const kids = [
    { p: g.P({ name: 'ゆいちゃん', kid: true, top: 0xf6a5c0, bottom: 0x6f7fa8, hairStyle: 'long', hair: 0x3b2a22, skirt: true }, LINE + 0.7, -125.2, -Math.PI / 2, gy(LINE + 0.7, -125.2)), z: -125.2 },
    { p: g.P({ name: 'そうたくん', kid: true, top: 0x9fd4b0, bottom: 0x3e6ea8, hat: 'yellow' }, LINE + 0.7, -129.8, -Math.PI / 2, gy(LINE + 0.7, -129.8)), z: -129.8 },
  ];
  const lookTree = V(T.x - 1, -1.6, oz);
  let mode = 'ambient';     // ambient（子どもだけ）| join（線に ならぶのを待つ）| play（犬もいっしょ）| win
  let phase = 'rest', ph = 0, mi = 0, mt = 0, tempo = TEMPO[0], lookDur = 2, caught = 0, wobbled = false;
  let invited = false, back = false, firstPlay = true;
  const inRange = () => Math.hypot(g.player.pos.x - ox, g.player.pos.z - oz) < 45;
  const onLine = (p) => p.x > LINE - 0.25 && p.x < LINE + 3 && p.z < -123 && p.z > -131.5 && p.y < -1.5;
  const dogPlaying = () => mode === 'play';
  const heads = (p) => p.headWorld(V());

  g.ev.pos('daruma', () => _a.copy(oni.headWorld(_a)).add(V(0, 0.35, 0)));

  function startChant() {
    phase = 'chant';
    ph = 0;
    mi = 0;
    mt = -0.45;
    // 犬とする はじめの1回は ふつうの速さ。あとは いろいろ
    const r = Math.random();
    tempo = firstPlay && dogPlaying() ? TEMPO[0] : r < 0.4 ? TEMPO[0] : r < 0.6 ? TEMPO[1] : r < 0.85 ? TEMPO[2] : TEMPO[3];
    if (dogPlaying()) firstPlay = false;
    oni.pose = 'play';           // 両手で 顔をかくす
    oni.lookAt = lookTree;
    // 子どもたちは 少しずつ前へ（犬がいる時は、犬より先に タッチしないように ゆっくり）
    for (const k of kids) {
      if (k.p.target || k.back) continue;
      k.p.pose = 'stand';
      const step = (dogPlaying() ? 0.6 : 0.9) + Math.random() * 1.5;
      const x = Math.max(ox + (dogPlaying() ? 3.6 : 0.9), k.p.pos.x - step);
      k.p.speed = 1.2 + Math.random() * 0.6;
      k.p.walkTo(x, k.z);
    }
    wobbled = false;
    if (dogPlaying()) g.ui.daruma({ n: 0 });
  }
  function turn() {
    phase = 'turn';
    ph = 0;
    oni.pose = 'stand';
    for (const k of kids) {
      if (k.back) continue;
      k.p.target = null;
      k.p.pose = FREEZE[Math.floor(Math.random() * FREEZE.length)];
    }
    if (dogPlaying()) audio.play('whoosh');
  }
  function goBack(k) {
    k.back = true;
    k.p.pose = 'stand';
    k.p.speed = 1.8;
    k.p.walkTo(LINE + 0.7, k.z, () => { k.back = false; k.p.heading = -Math.PI / 2; });
  }
  function resetAll() {
    for (const k of kids) goBack(k);
    phase = 'rest';
    ph = 0;
  }
  function stop(say) {
    mode = 'ambient';
    g.ui.daruma(null);
    document.body.classList.remove('daruma-look');
    if (back) { g.autoRun = null; back = false; }
    if (say) g.say(oni, say, 2);
    g.restoreObjective();
    resetAll();
  }

  g.on('update', (dt) => {
    const p = g.player, dp = p.pos, d = p.dog;
    for (const k of kids) k.p.pos.y = gy(k.p.pos.x, k.p.pos.z);
    const near = inRange();
    // 犬が見ていない時は、休けい
    if (!near && mode === 'ambient') { if (phase !== 'rest') { phase = 'rest'; oni.pose = 'stand'; } return; }
    // 線のそばに来たら、さそってくれる
    if (mode === 'ambient' && !invited && !g.ev.isDone('daruma') && g.state === 'play' && Math.hypot(dp.x - (LINE - 4), dp.z - oz) < 9) {
      invited = true;
      g.say(kids[0].p, 'ワンちゃんも いっしょに やる？ ワンって 言ったら なかまに いれてあげる！', 3.2);
    }
    // 犬が スタートの線に ならんだら、はじめる
    if (mode === 'join' && onLine(dp) && !p.locked) {
      mode = 'play';
      caught = 0;
      firstPlay = true;
      g.say(oni, 'いくよー！', 1.2);
      g.ui.objective('オニに タッチしよう！');
      g.ui.toast('「…ころんだ！」で ピタッと止まる。うごいたら スタートへ もどる', 'star');
      phase = 'rest';
      ph = 0.4;
    }
    // 遠くへ行ったら、おしまい
    if ((mode === 'play' || mode === 'join') && (Math.hypot(dp.x - ox, dp.z - oz) > 24 || g.flags.arrival || g.state !== 'play')) {
      stop(g.state === 'play' ? 'ワンちゃん、またね〜！' : null);
      return;
    }
    // つかまって、スタートの線へ もどる途中
    if (back && (!g.autoRun || Math.hypot(dp.x - g.autoRun.x, dp.z - g.autoRun.z) < 0.5)) { g.autoRun = null; back = false; }
    if (mode === 'win') return;
    ph += dt;
    if (phase === 'rest') {
      oni.heading = dampAngle(oni.heading, -Math.PI / 2, 8, dt);
      if (ph > 1.2 && kids.every((k) => !k.back)) startChant();
    } else if (phase === 'chant') {
      oni.heading = dampAngle(oni.heading, -Math.PI / 2, 14, dt);
      mt += dt;
      const hear = Math.hypot(dp.x - ox, dp.z - oz);
      while (mi < MORAE.length && mt >= 0) {
        if (dogPlaying() || hear < 20) audio.play('mora', MELODY[mi]);
        mt -= tempo[mi];
        mi++;
        if (dogPlaying()) g.ui.daruma({ n: mi });
        else if (mi === MORAE.length && hear < 26) g.sayAt(heads(oni).add(V(0, 0.4, 0)), 'だるまさんが ころんだ！', 1.4);
      }
      if (mi >= MORAE.length && mt >= -0.05) turn();
      // 子どもだけの時：オニのそばまで行けたら タッチ
      if (!dogPlaying()) {
        for (const k of kids) {
          if (!k.back && Math.hypot(k.p.pos.x - ox, k.p.pos.z - oz) < 1.4) {
            g.sayAt(heads(k.p).add(V(0, 0.4, 0)), 'タッチ！', 1.2);
            oni.pose = 'cheer';
            resetAll();
            break;
          }
        }
      }
    } else if (phase === 'turn') {
      oni.heading = dampAngle(oni.heading, Math.PI / 2, 22, dt);
      if (ph > 0.22) {
        phase = 'look';
        ph = 0;
        lookDur = 1.5 + Math.random() * 1.1;
        oni.lookAt = dogPlaying() ? d.headWorld : heads(kids[0].p);
        if (dogPlaying()) { g.ui.daruma({ n: MORAE.length, look: true }); document.body.classList.add('daruma-look'); }
      }
    } else if (phase === 'look') {
      oni.heading = Math.PI / 2;
      // 犬：動いたら（ジャンプも）つかまる。ふり向いて すぐは見のがす
      if (dogPlaying() && !back && ph > 0.15 && (d.speed > 0.4 || !p.grounded)) {
        caught++;
        back = true;
        audio.play('buzz');
        oni.pose = 'give';
        g.say(oni, ['ワンちゃん、うごいた〜！', 'あっ、しっぽ うごいた！', 'うごいたー！ もどってー！'][Math.min(2, caught - 1)], 1.8);
        g.ui.daruma({ n: MORAE.length, look: true, caught: true });
        g.autoRun = { x: LINE + 0.8, z: clamp(dp.z, -130.6, -123.8), walk: true };
      }
      // 子ども：たまに ぐらっ
      if (!wobbled && ph > 0.6) {
        wobbled = true;
        if (Math.random() < 0.3) {
          const k = kids[Math.floor(Math.random() * kids.length)];
          if (!k.back && k.p.pos.x < LINE - 0.5) {
            g.say(oni, `${k.p.name}、うごいた！`, 1.6);
            g.sayAt(heads(k.p).add(V(0, 0.4, 0)), 'あ〜っ！', 1.0);
            goBack(k);
          }
        }
      }
      if (ph > lookDur) {
        document.body.classList.remove('daruma-look');
        phase = 'rest';
        ph = 0.6;
        oni.pose = 'stand';
        for (const k of kids) if (!k.back) k.p.pose = 'stand';
      }
    }
  });

  // ワンで なかまに
  g.on('bark', (dp) => {
    if (mode !== 'ambient' || Math.hypot(dp.x - (LINE - 3), dp.z - oz) > 11) return false;
    mode = 'join';
    g.say(oni, g.ev.isDone('daruma') ? 'もういっかい？ いいよー！ 白い線に ならんでー！' : 'よーし！ ワンちゃんも、白い線に ならんでー！', 2.6);
    g.ui.objective('白い線に ならぼう（だるまさんが ころんだ）');
    document.body.classList.remove('daruma-look');
    resetAll();
    oni.pose = 'stand';
    return true;
  });

  // オニの そばで タッチ（オニが顔をふせている間だけ）
  g.on('interact', (dp) => (mode === 'play' && phase === 'chant' && !back && Math.hypot(dp.x - ox, dp.z - oz) < 1.5 && Math.abs(dp.y - oni.pos.y) < 1 ? { id: 'daruma', label: 'タッチ', act: () => g.run(win()) } : null));

  function* win() {
    mode = 'win';
    g.ui.daruma(null);
    document.body.classList.remove('daruma-look');
    const p = g.player;
    audio.play('catch');
    g.sayAt(p.pos.clone().add(V(0, 0.8, 0)), 'タッチ！', 1.2);
    p.dog.hop(1.6);
    oni.lookAt = p.dog.headWorld;
    oni.heading = Math.atan2(p.pos.x - oni.pos.x, p.pos.z - oni.pos.z);
    oni.pose = 'cheer';
    for (const k of kids) { k.p.target = null; k.p.pose = 'cheer'; }
    g.confetti(p.pos.clone().add(V(0, 0.8, 0)), 30);
    yield 0.5;
    g.sayAt(heads(kids[1].p).add(V(0, 0.4, 0)), 'わ〜っ！', 1.2);
    yield 0.5;
    g.say(oni, caught === 0 ? 'いっかいも うごかなかった！ ワンちゃん すごい！' : 'やられた〜！ ワンちゃんの かち！', 2.6);
    g.hearts(p.pos.clone().add(V(0, 0.6, 0)), 6);
    if (caught === 0) g.flags.darumaPerfect = true;
    g.ev.complete('daruma', caught === 0 ? 'いちども うごかずに、オニに タッチ！' : 'オニに タッチ！ ワンちゃんの かち', { wait: 0.3 });
    yield 2.8;
    oni.pose = 'stand';
    oni.lookAt = null;
    mode = 'ambient';
    g.restoreObjective();
    resetAll();
  }
}
