import * as THREE from 'three';
import { Cat, Crow, Pigeons, Ducks, makeItem } from './actors.js';
import { DogFollower, CatFollower, PigeonRider } from './party.js';
import { installMore } from './happen2.js';
import { Dog } from '../dog.js';
import { typeParams } from '../dogModel.js';
import { audio } from '../audio.js';
import { RIVER, SHRINE } from './town2.js';
import { softMaterial } from './look.js';
import { clamp, damp, lerp, smooth, mergeParts, mat as M4 } from '../util.js';

// ------------------------------------------------------------
// 町のできごと。場所ごとに、住人・物・行動（おすわり／ワン／アクション）を登録する
// ------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _h = new THREE.Vector3();
const _a = new THREE.Vector3();
const headOf = (p, up = 0.45) => () => p.headWorld(_h).add(_a.set(0, up, 0));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

export function installHappenings(g) {
  home(g);
  lane(g);
  shrine(g);
  street(g);
  park(g);
  river(g);
  road(g);
  plaza(g);
  chime(g);
  installMore(g);
}

/** 静かな物（屋台・トラック）をまとめて1つのメッシュに */
const propMat = softMaterial({ rim: 0.2, self: 0.05, rough: 0.7 });
function prop(scene, parts, x, y, z, ry = 0) {
  const m = new THREE.Mesh(mergeParts(parts), propMat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// ------------------------------------------------------------
// 家と庭
// ------------------------------------------------------------
function home(g) {
  const sock = g.addItem('sock', 'あの人のくつした', V(8.4, 0.02, -4.4), 0.6);
  g.ev.pos('sock', () => (sock.ground && !sock.picked ? _a.copy(sock.mesh.position).setY(0.25) : null));
  g.onPick('sock', () => g.ev.complete('sock', '物干しから落ちていた、あの人のくつした'));
}

// ------------------------------------------------------------
// 路地：ねこ・王冠・塀の上・自販機の下の100円・お地蔵さん
// ------------------------------------------------------------
function lane(g) {
  const A = g.A, scene = g.scene;
  // ねこのミケ
  const cat = new Cat(scene);
  cat.pos.copy(A.catWall);
  cat.heading = -Math.PI / 2;
  const catHome = A.catWall.clone();
  g.cat = cat;
  let calmT = 0, runId = 0, hinted = false;
  const flee = () => {
    if (g.t < calmT) return;
    calmT = g.t + 8;
    cat.state = 'run';
    cat.sleep = 0;
    audio.play('meow', 1.3);
    g.sayAt(cat.pos, 'フーッ！', 1.2);
    const dx = g.player.pos.x;
    const tx = Math.abs(dx - 14.2) > Math.abs(dx - 31.4) ? 14.2 : 31.4;
    cat.target = V(tx, cat.pos.y, 5.6);
    const id = ++runId;
    cat.onArrive = () => {
      cat.state = 'loaf';
      g.run(function* () {
        yield 14;
        if (id !== runId) return;
        cat.state = 'walk';
        cat.target = catHome.clone();
        cat.onArrive = () => { cat.state = 'loaf'; cat.sleep = 1; };
      }());
    };
  };
  g.ev.pos('cat', () => _a.copy(cat.pos).add(_h.set(0, 0.55, 0)));
  // あいさつすると、ミケは 駅まで ついてきてくれる（なかま）
  const mike = new CatFollower(g, cat, { id: 'mike', name: 'ミケ', gap: 1.45, order: 3 });
  mike.onJoin = () => g.ui.toast('ミケが ついてきた！ 駅まで いっしょ', 'heart');
  g.on('update', (dt) => {
    const p = g.player, dp = p.pos;
    if (cat.inParty) return;
    cat.update(dt);
    if (g.ev.isDone('cat') || cat.state === 'run') return;
    const dd = dist2(dp, cat.pos);
    cat.lookAt = dd < 6 ? dp : null;
    cat.sleep = dd < 5 ? damp(cat.sleep, 0, 2, dt) : damp(cat.sleep, 1, 0.5, dt);
    if (dd < 3.2 && p.run && p.dog.speed > 2.5) { flee(); return; }
    if (dd < 1.5 && dp.y > 1.1) {
      cat.state = 'sit';
      audio.play('meow');
      g.sayAt(cat.pos, 'にゃ〜', 1.6);
      g.hearts(cat.pos.clone().add(V(0, 0.4, 0)), 4);
      g.ev.complete('cat', '塀の上で、ねこと あいさつした');
      g.run(function* () {
        yield 2.4;
        audio.play('meow', 1.1);
        g.sayAt(cat.pos.clone().add(V(0, 0.55, 0)), 'にゃ（…駅まで、ついていって あげる）', 2.6);
        yield 0.8;
        if (g.flags.arrival) return;
        cat.inParty = true;
        g.party.join(mike);
      }());
    } else if (dd < 2.4 && dp.y < 0.5 && !hinted) {
      hinted = true;
      g.sayAt(cat.pos, '（…塀の上まで来れる？）', 2.4);
    }
  });
  g.on('bark', (dp) => {
    if (dist2(cat.pos, dp) < 5 && !g.ev.isDone('cat') && cat.state !== 'run') { flee(); return true; }
    return false;
  });

  // ぴかぴかの王冠（塀の上）
  const cap = g.addItem('cap', 'ぴかぴかの王冠', V(A.capWall.x, A.capWall.y + 0.02, A.capWall.z), 0);
  g.ev.pos('cap', () => (cap.ground && !cap.picked ? _a.copy(cap.mesh.position).setY(cap.mesh.position.y + 0.2) : null));
  g.onPick('cap', () => {
    g.ev.complete('cap', '塀の上で、ぴかぴかを見つけた');
    g.ui.toast('ぴかぴかの王冠。…カラスが好きそう？', 'star');
  });

  // 塀の上をおさんぽ
  let wallT = 0;
  g.ev.pos('wall', V(25.6, 1.5, 5.6));
  g.on('update', (dt) => {
    const p = g.player, dp = p.pos;
    if (g.ev.isDone('wall')) return;
    if (p.grounded && dp.y > 1.3 && dp.y < 1.6 && p.support && p.support.tag === 'wall' && dp.z > 5 && dp.z < 6) {
      wallT += dt;
      if (wallT > 3) g.ev.complete('wall', '塀の上を、ねこみたいに歩いた');
    }
  });

  // 自販機の下の100円
  const coin = g.addItem('coin', '100円玉', V(34.15, 0.0, 6.95), 0, { hidden: true });
  let revealed = false, glintT = 0;
  g.ev.pos('coin', () => (!revealed ? _a.set(34, 0.35, 6.6) : (coin.ground && !coin.picked ? _a.copy(coin.mesh.position).setY(0.3) : null)));
  function* peek() {
    const p = g.player, d = p.dog;
    p.locked = true;
    d.heading = Math.PI;
    d.digging = true;
    audio.play('dig');
    yield 0.45;
    audio.play('dig');
    yield 0.45;
    d.digging = false;
    revealed = true;
    coin.mesh.visible = true;
    coin.ground = true;
    const from = V(34.15, 0.0, 6.35), to = V(34.15, 0.0, 6.95);
    let t = 0;
    audio.play('coin');
    while (t < 0.5) {
      const dt = yield;
      t += dt || 0.016;
      coin.mesh.position.lerpVectors(from, to, smooth(clamp(t / 0.5, 0, 1)));
      coin.mesh.rotation.y += 0.4;
    }
    g.sparkle(coin.mesh.position.clone().add(V(0, 0.1, 0)), 10, 0xffffff);
    g.ui.toast('100円玉が 出てきた！', 'star');
    p.locked = false;
  }
  g.on('interact', () => (!revealed && g.near(V(34, 0, 6.95), 1.05, 0.6) ? { id: 'coin', label: 'のぞく', act: () => g.run(peek()) } : null));
  g.on('update', (dt) => {
    if (revealed || !g.flags.dug) return;
    glintT -= dt;
    if (glintT <= 0 && dist2(g.player.pos, V(34, 0, 6.5)) < 9) {
      glintT = 1.4 + Math.random();
      g.fx.spawn({ pos: V(33.7 + Math.random() * 0.8, 0.06, 6.45), vel: V(0, 0.15, 0), color: 0xffffff, size: 0.12, life: 0.5, shape: 2 });
    }
  });
  g.onPick('coin', () => g.ev.complete('coin', '自販機の下から、100円玉が出てきた'));

  // お地蔵さん
  g.ev.pos('jizo', () => _a.copy(A.jizo).setY(1.5));
  g.on('sit', (dp) => {
    if (dist2(dp, A.jizo) > 1.9 || dp.y > 0.5) return false;
    g.sayAt(A.jizo.clone().add(V(0, 1.2, 0)), '…ちりん。', 1.6);
    audio.play('suzu', 1.4);
    if (!g.ev.isDone('jizo')) g.run(function* () { yield 0.9; g.ev.complete('jizo', 'お地蔵さんに、ちゃんと ごあいさつ'); }());
    return true;
  });
}

// ------------------------------------------------------------
// 神社：展望台・鈴とおみくじ・ねこの集会
// ------------------------------------------------------------
function shrine(g) {
  const A = g.A, scene = g.scene, Y = SHRINE.y;
  // 展望台からのながめ
  g.ev.pos('lookout', () => _a.copy(A.lookout).add(_h.set(0, 1.3, 0)));
  function* lookoutScene() {
    const p = g.player, day = g.day;
    g.lock(true);
    const L = A.lookoutLook;
    const base = A.lookout.clone();
    const dir = V(L.x - base.x, 0, L.z - base.z).normalize();
    const side = V(-dir.z, 0, dir.x);
    p.dog.heading = Math.atan2(dir.x, dir.z);
    p.dog.setPose('sit');
    const fog0 = day.fogScale;
    g.post.tilt = 0.75;
    g.post.tiltFocus = 0.42;
    const back = base.clone().addScaledVector(dir, -2.4).add(V(0, 1.0, 0));
    const high = base.clone().addScaledVector(dir, -1.2).addScaledVector(side, 1.8).add(V(0, 3.4, 0));
    g.cine((c, dt, t) => {
      const k = smooth(clamp(t / 7, 0, 1));
      day.fogScale = lerp(fog0, 1.9, smooth(clamp(t / 2, 0, 1)));
      c.position.lerpVectors(back, high, k);
      const look = _h.lerpVectors(p.dog.headWorld, L, smooth(clamp((t - 0.4) / 4, 0, 1)));
      c.lookAt(look);
      const fov = lerp(50, 36, k);
      if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
      return true;
    });
    audio.play('whoosh');
    yield 1.4;
    g.ui.caption('ひだまり町が、夕日にそまっていく…', 3.6);
    yield 3.4;
    g.ev.complete('lookout', '石段の上から、ひだまり町が見わたせた', { wait: 0.05 });
    yield 2.4;
    const cam0 = g.camera.position.clone();
    g.cine((c, dt, t) => {
      const k = smooth(clamp(t / 1.2, 0, 1));
      day.fogScale = lerp(1.9, fog0, k);
      g.post.tilt = 0.75 * (1 - k);
      c.position.lerpVectors(cam0, back.clone().add(V(0, 0.4, 0)), k);
      c.lookAt(_h.lerpVectors(L, p.dog.headWorld, k));
      return t < 1.2;
    });
    yield 1.2;
    day.fogScale = fog0;
    g.endCine(Math.atan2(dir.x, dir.z) + Math.PI, 0.25);
    g.lock(false);
  }
  g.on('update', () => {
    if (g.ev.isDone('lookout') || g.state !== 'play' || g.player.locked) return;
    const dp = g.player.pos;
    if (dist2(dp, A.lookout) < 2.4 && dp.y > Y - 0.2) g.run(lookoutScene());
  });

  // 鈴とおみくじ
  const B = A.shrineBell;
  const front = A.shrineFront;
  let rang = false, swing = 0;
  const omi = g.addItem('omikuji', 'おみくじ（大吉）', V(A.omikuji.x - 0.1, Y + 0.02, A.omikuji.z - 0.2), 0.4, { hidden: true });
  g.ev.pos('bell', () => (!rang ? _a.set(front.x - 0.8, Y + 1.7, front.z) : (omi.ground && !omi.picked ? _a.copy(omi.mesh.position).setY(Y + 0.4) : null)));
  function* ring() {
    const p = g.player, d = p.dog;
    rang = true;
    g.lock(true);
    // 鈴緒の前に立って、横から（犬・鈴緒・鈴が一度に入るように）
    p.place(front.x, Y, front.z, -Math.PI / 2);
    g.post.tilt = 0.25;
    g.post.tiltFocus = 0.45;
    g.cine((c, dt, t) => {
      c.position.set(front.x + 0.9 + t * 0.04, Y + 1.3, front.z + 5.4);
      c.lookAt(front.x - 0.7, Y + 1.55, front.z);
      if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
      return true;
    });
    yield 0.5;
    d.hop(2.2);
    audio.play('jump');
    yield 0.25;
    swing = 1;
    for (let i = 0; i < 3; i++) { audio.play('suzu'); yield 0.32; }
    g.sayAt(B.bell.position.clone().add(V(0, 0.3, 0)), 'ガラン、ガラン…', 1.6);
    yield 0.6;
    d.setPose('bow');
    yield 0.5;
    audio.play('clap2'); yield 0.3; audio.play('clap2');
    g.sayAt(front.clone().add(V(0, 1.6, 0)), '（あの人に、はやく会えますように）', 2.4);
    yield 2.2;
    d.setPose('stand');
    // おみくじの箱から、ぽんっ
    omi.mesh.visible = true;
    omi.ground = true;
    const from = V(A.omikuji.x - 0.8, Y + 1.0, A.omikuji.z), to = omi.mesh.position.clone();
    let t = 0;
    audio.play('pop');
    while (t < 0.6) {
      const dt = yield;
      t += dt || 0.016;
      const k = clamp(t / 0.6, 0, 1);
      omi.mesh.position.lerpVectors(from, to, k);
      omi.mesh.position.y += Math.sin(k * Math.PI) * 0.6;
    }
    omi.mesh.position.copy(to);
    g.sparkle(to.clone().add(V(0, 0.2, 0)), 16, 0xfff0c0);
    g.ui.toast('おみくじが 出てきた！', 'gift');
    g.endCine(Math.PI / 2, 0.3);
    g.lock(false);
  }
  g.on('interact', () => (!rang && g.near(front, 1.5, 0.8) ? { id: 'bell', label: 'すずをならす', act: () => g.run(ring()) } : null));
  g.on('update', (dt) => {
    swing = damp(swing, 0, 0.9, dt);
    B.rope.rotation.z = Math.sin(g.t * 7) * swing * 0.22;
    B.rope.rotation.x = Math.cos(g.t * 5.3) * swing * 0.12;
    B.bell.position.x = B.base.x + Math.sin(g.t * 7) * swing * 0.06;
  });
  const fortunes = ['まっている人に、もうすぐ会える', '寄り道の先に、たからものあり', 'ともだちが たくさんできる日'];
  g.onPick('omikuji', () => {
    const f = fortunes[Math.floor(Math.random() * fortunes.length)];
    g.fortune = f;
    g.ui.caption(`おみくじ 大吉 ── ${f}`, 4.2);
    g.ev.complete('bell', `大吉：${f}`);
  });

  // ねこの集会
  const C = A.catCircle;
  const looks = [
    { color: 0x3b3330, belly: 0x5b5350, stripes: 0x2a2420 },
    { color: 0xf4efe8, belly: 0xffffff, stripes: 0xd8d0c6 },
    { color: 0xe39a58, belly: 0xfff4e6, stripes: 0x3b3330 },
    { color: 0xa8a4a0, belly: 0xe8e4e0, stripes: 0x6a6662 },
    { color: 0xc9b08a, belly: 0xfff4e6, stripes: 0x8a6a4a },
  ];
  const cats = looks.map((l, i) => {
    const c = new Cat(scene, l);
    const a = (i / looks.length) * Math.PI * 2 + 0.3;
    c.pos.set(C.x + Math.cos(a) * 1.3, Y, C.z + Math.sin(a) * 1.3);
    c.heading = Math.atan2(C.x - c.pos.x, C.z - c.pos.z);
    c.state = i % 2 ? 'loaf' : 'sit';
    c.sleep = 0.2;
    c.root.scale.setScalar(0.95 + (i % 3) * 0.08);
    return c;
  });
  let alertT = 0, sitT = 0, accepted = false;
  g.ev.pos('cats', () => _a.copy(C).setY(Y + 1.1));
  g.on('update', (dt) => {
    const p = g.player, dp = p.pos;
    const d = dist2(dp, C);
    for (const c of cats) {
      c.update(dt);
      c.lookAt = d < 8 ? dp : null;
    }
    if (accepted || Math.abs(dp.y - Y) > 1) return;
    alertT -= dt;
    if (d < 5 && p.run && p.dog.speed > 2.6 && alertT <= 0) {
      alertT = 3;
      audio.play('meow', 1.4);
      g.sayAt(cats[0].pos.clone().add(V(0, 0.5, 0)), 'シャーッ！（しずかに…）', 1.8);
      for (const c of cats) { c.state = 'sit'; c.sleep = 0; }
    }
    if (d < 2.6 && p.dog.poseTarget === 'sit') sitT += dt; else sitT = 0;
    if (sitT > 1.0) {
      accepted = true;
      g.run(function* () {
        for (let i = 0; i < cats.length; i++) {
          const c = cats[i];
          c.state = 'sit';
          c.heading = Math.atan2(dp.x - c.pos.x, dp.z - c.pos.z);
          audio.play('meow', 0.9 + i * 0.12);
          g.hearts(c.pos.clone().add(V(0, 0.35, 0)), 2);
          yield 0.35;
        }
        g.sayAt(C.clone().add(V(0, 1.2, 0)), 'にゃ〜ん（なかまに いれてあげる）', 2.4);
        yield 0.6;
        g.ev.complete('cats', 'ねこの集会に、そっと まぜてもらった', { wait: 0.3 });
        yield 3;
        for (const c of cats) c.state = 'loaf';
      }());
    }
  });
  g.on('sit', (dp) => dist2(dp, C) < 2.6 && Math.abs(dp.y - Y) < 1);
}

// ------------------------------------------------------------
// 商店街
// ------------------------------------------------------------
function street(g) {
  const A = g.A, scene = g.scene;
  const grandma = g.P({ name: '魚屋のおばあちゃん', hair: 0xd8d2cc, hairStyle: 'bun', top: 0x8a7fb0, bottom: 0x5b4a40, apron: 0xf2f0ea, hat: 'kerchief', hatColor: 0xe8604c, skirt: true, scale: 0.92, skin: 0xf2cdb2 }, 40.2, 1.0, Math.PI / 2);
  const florist = g.P({ name: '花屋のおねえさん', hair: 0x5a3a2a, hairStyle: 'long', top: 0xf6efe2, apron: 0x3f8f6a, bottom: 0x6f7fa8 }, 40.2, -40.2, Math.PI / 2);
  const butcher = g.P({ name: '肉屋のおじさん', hairStyle: 'bald', hair: 0x3b2a22, top: 0xffffff, apron: 0xd9d4ca, hat: 'cap', hatColor: 0xffffff, bottom: 0x4a5468 }, 45.9, -6.2, -Math.PI / 2);
  g.grandma = grandma;
  // 魚屋のおばあちゃん：おすわり → にぼし（しばらく足が速くなる）
  g.ev.pos('grandma', headOf(grandma));
  function* grandmaGift() {
    const p = g.player;
    grandma.lookAt = p.pos;
    g.say(grandma, 'あらまあ、おすわり上手ねえ', 2.2);
    yield 1.6;
    grandma.pose = 'give';
    g.say(grandma, 'はい、にぼし。ないしょよ', 2.4);
    yield 1.0;
    audio.play('chew');
    p.dog.chewing = true;
    g.hearts(p.pos.clone().add(V(0, 0.6, 0)), 5);
    yield 1.2;
    p.dog.chewing = false;
    grandma.pose = 'stand';
    grandma.lookAt = null;
    p.boost = 45;
    g.ui.toast('にぼしで 元気100倍！ しばらく足が速くなる', 'bolt');
    g.ev.complete('grandma', 'にぼしを もらって、元気100倍');
  }
  // 花屋さん：おすわり → ひまわり
  g.ev.pos('florist', headOf(florist));
  function* floristGift() {
    const p = g.player;
    florist.lookAt = p.pos;
    g.say(florist, 'いい子ね。だれかのお迎え？', 2.2);
    yield 2.0;
    florist.pose = 'give';
    g.say(florist, 'じゃあこれ、持っていって。きっと喜ぶよ', 2.8);
    yield 1.2;
    g.give('sunflower', 'ひまわり');
    g.sparkle(p.pos.clone().add(V(0, 0.5, 0)), 16, 0xfff0a0);
    yield 0.8;
    florist.pose = 'stand';
    florist.lookAt = null;
    g.ev.complete('florist', 'ひまわりを 一輪もらった');
  }
  // 肉屋さん：おすわり → 揚げたてコロッケを投げてくれる（ジャンプでキャッチ）
  g.ev.pos('butcher', headOf(butcher));
  function* croquette() {
    const p = g.player, d = p.dog;
    butcher.lookAt = p.pos;
    g.say(butcher, 'おっ、いい子だ。揚げたてだぞ〜', 2.2);
    yield 1.8;
    const f = V(Math.sin(p.heading), 0, Math.cos(p.heading));
    const land = V(p.pos.x + f.x * 0.2, p.pos.y, p.pos.z + f.z * 0.2);
    const from = butcher.headWorld(V()).add(V(-0.3, -0.4, 0));
    const mesh = makeItem('croquette');
    scene.add(mesh);
    butcher.pose = 'give';
    g.ui.toast('ジャンプで キャッチ！', 'bolt');
    audio.play('whoosh');
    let t = 0, caught = false;
    const dur = 1.3;
    while (t < dur) {
      const dt = yield;
      t += dt || 0.016;
      const k = clamp(t / dur, 0, 1);
      mesh.position.lerpVectors(from, land, k);
      mesh.position.y += Math.sin(k * Math.PI) * 1.4 + (1 - k) * 0.25;
      mesh.rotation.x += 0.2;
      if (k > 0.45 && mesh.position.distanceTo(d.mouthWorld) < 0.42) { caught = true; break; }
    }
    butcher.pose = 'stand';
    if (caught) {
      scene.remove(mesh);
      audio.play('catch');
      g.sayAt(p.pos.clone().add(V(0, 1.0, 0)), 'ナイスキャッチ！', 1.6);
      g.confetti(p.pos.clone().add(V(0, 0.7, 0)), 26);
    } else {
      mesh.position.copy(land).setY(p.pos.y + 0.05);
      audio.play('drop');
      yield 0.4;
      scene.remove(mesh);
    }
    audio.play('chew');
    d.chewing = true;
    g.hearts(p.pos.clone().add(V(0, 0.6, 0)), 5);
    yield 1.2;
    d.chewing = false;
    g.say(butcher, caught ? 'やるなあ！ 将来は大物だ' : 'はっはっは、うまいか？', 2.2);
    butcher.lookAt = null;
    g.ev.complete('butcher', caught ? '揚げたてコロッケを、ジャンプでキャッチ！' : '揚げたてコロッケを もらった', { wait: 0.2 });
  }
  g.on('sit', (dp) => {
    const busy = g.flags.shopBusy;
    if (busy) return false;
    const run = (gen) => { g.flags.shopBusy = true; g.run(function* () { yield* gen; g.flags.shopBusy = false; }()); return true; };
    if (grandma.pos.distanceTo(dp) < 2.6 && !g.ev.isDone('grandma')) return run(grandmaGift());
    if (florist.pos.distanceTo(dp) < 2.6 && !g.ev.isDone('florist')) return run(floristGift());
    if (butcher.pos.distanceTo(dp) < 2.8 && !g.ev.isDone('butcher')) return run(croquette());
    return false;
  });
  g.on('area', (id) => {
    if (id === 'street') g.run(function* () { yield 2.5; g.say(grandma, 'あら、かわいいお客さん', 2); }());
  });

  // カラスのクロ（ぴかぴかの王冠 → 赤いバンダナ）
  const crow = new Crow(scene);
  crow.pos.copy(A.archTop);
  const crowHome = A.archTop.clone();
  let crowHint = false, busy = false;
  g.ev.pos('crow', () => _a.copy(crow.pos).add(_h.set(0, 0.6, 0)));
  function* crowTrade() {
    if (busy || g.ev.isDone('crow')) return;
    busy = true;
    const p = g.player;
    g.lock(true);
    // 少しはなれた所から、犬とアーチの上のカラスが一度に入るように
    const sz = p.pos.z < crowHome.z ? -1 : 1;
    const cpos = V(crowHome.x + 1.8, 1.5, p.pos.z + sz * 8.5);
    const look = V(crowHome.x, 3.4, (p.pos.z + crowHome.z) / 2);
    g.cine((c, dt) => {
      c.position.copy(cpos);
      look.y = damp(look.y, clamp((crow.pos.y + p.pos.y) / 2 + 0.6, 1.6, 3.6), 2, dt);
      c.lookAt(look);
      if (c.fov !== 56) { c.fov = 56; c.updateProjectionMatrix(); }
      return true;
    });
    audio.play('caw');
    g.sayAt(crow.pos, 'カァ？', 1.2);
    yield 0.6;
    const f = p.dog.fwd;
    const land = V(p.pos.x + f.x * 0.7, p.pos.y, p.pos.z + f.z * 0.7);
    crow.flyTo(land, 1.3, 1.2);
    yield () => !crow.flight;
    const c = p.drop();
    if (c && c.item) {
      c.item.ground = false;
      crow.root.add(c.item.mesh);
      c.item.mesh.position.set(0, 0.3, 0.33);
    }
    audio.play('caw');
    yield 0.5;
    crow.flyTo(crowHome, 1.6, 2.2);
    yield () => !crow.flight;
    yield 0.4;
    g.sayAt(crow.pos, 'カァ！', 1.2);
    const b = makeItem('bandana');
    b.position.copy(crow.pos);
    scene.add(b);
    let t = 0;
    const from = crow.pos.clone();
    const to = p.pos.clone().add(V(0, 0.4, 0));
    while (t < 1) {
      const dt = yield;
      t += (dt || 0.016) / 0.9;
      b.position.lerpVectors(from, to, t);
      b.position.y += Math.sin(t * Math.PI) * 1.2;
      b.rotation.y += 0.3;
    }
    scene.remove(b);
    g.wear('bandana');
    g.unlockWear('bandana');
    g.ui.toast('赤いバンダナを もらった！', 'star');
    g.ev.complete('crow', 'ぴかぴかの王冠と、赤いバンダナを交換', { wait: 0.3 });
    yield 1.8;
    g.endCine(p.heading + Math.PI, 0.3);
    g.lock(false);
  }
  const nearArch = (dp) => Math.hypot(dp.x - 43, dp.z - 5.1) < 5;
  g.on('interact', (dp) => (g.player.carry && g.player.carry.id === 'cap' && nearArch(dp) && !g.ev.isDone('crow') ? { id: 'crow', label: 'みせる', act: () => g.run(crowTrade()) } : null));
  g.on('bark', (dp) => {
    if (g.player.carry && g.player.carry.id === 'cap' && nearArch(dp) && !g.ev.isDone('crow')) { g.run(crowTrade()); return true; }
    return false;
  });
  g.on('update', (dt) => {
    crow.update(dt);
    const dp = g.player.pos;
    if (!crow.flight && Math.random() < dt * 0.08 && crow.pos.distanceTo(dp) < 25) audio.play('caw');
    if (!crowHint && crow.pos.distanceTo(dp) < 6 && !crow.flight) {
      crowHint = true;
      g.sayAt(crow.pos, 'カァ（ぴかぴか、ほしい…）', 2.6);
    }
  });

  // 福引き（ガラガラ）
  const bx = 45.6, bz = -27;
  const wood = 0x9c7650, red = 0xc0392b;
  prop(scene, [
    { geo: new THREE.BoxGeometry(0.62, 0.78, 1.6), matrix: M4(0, 0.39, 0), color: wood },
    { geo: new THREE.BoxGeometry(0.66, 0.05, 1.66), matrix: M4(0, 0.8, 0), color: 0xf2ece0 },
    { geo: new THREE.BoxGeometry(0.64, 0.3, 1.62), matrix: M4(-0.01, 0.62, 0), color: red },
    { geo: new THREE.BoxGeometry(0.08, 0.5, 0.08), matrix: M4(0, 1.05, -0.3), color: 0x6b4a33 },
    { geo: new THREE.BoxGeometry(0.08, 0.5, 0.08), matrix: M4(0, 1.05, 0.3), color: 0x6b4a33 },
    { geo: new THREE.BoxGeometry(0.3, 0.04, 0.4), matrix: M4(-0.18, 0.84, 0.55), color: 0xe8d9b0 },
    // のぼり
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 2.2, 5), matrix: M4(0.25, 1.1, -0.75), color: 0xdcdcd8 },
  ], bx, 0, bz);
  const flagTex = (() => { const cv = document.createElement('canvas'); cv.width = 96; cv.height = 320; const c = cv.getContext('2d'); c.fillStyle = '#c0392b'; c.fillRect(0, 0, 96, 320); c.fillStyle = '#fff'; c.font = '800 60px "M PLUS Rounded 1c", sans-serif'; c.textAlign = 'center'; ['福', '引', '大', '会'].forEach((ch, i) => c.fillText(ch, 48, 70 + i * 72)); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.3), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.85 }));
  flag.position.set(bx + 0.25, 1.6, bz - 0.98);
  flag.rotation.y = Math.PI / 2;
  scene.add(flag);
  // 八角形の箱（回る）
  const drum = new THREE.Group();
  const drumM = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0xb8402e, roughness: 0.45, metalness: 0.1 }));
  drumM.rotation.x = Math.PI / 2;
  drumM.castShadow = true;
  drum.add(drumM);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.5 }));
  handle.position.set(0, 0.15, 0.25);
  drum.add(handle);
  drum.position.set(bx, 1.32, bz);
  scene.add(drum);
  g.A.lotteryDrum = drum;
  const man = g.P({ name: '福引きのおじさん', hairStyle: 'short', hair: 0x2a2020, top: 0xc0392b, bottom: 0x3b3f45, hat: 'kerchief', hatColor: 0xffffff, glasses: true }, bx + 0.9, bz, -Math.PI / 2);
  g.town.col.addBox(bx - 0.33, bx + 0.33, bz - 0.82, bz + 0.82, 0, 0.82, 'booth');
  const bellItem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8c04a, metalness: 1, roughness: 0.25 }));
  bellItem.position.set(bx - 0.1, 0.9, bz + 0.62);
  scene.add(bellItem);
  const front = V(bx - 1.0, 0, bz);
  g.ev.pos('lottery', () => _a.set(bx, 1.9, bz));
  let spinning = false, spin = 0;
  function* lottery() {
    const p = g.player, d = p.dog;
    spinning = true;
    g.lock(true);
    d.heading = Math.PI / 2;
    g.cine((c) => {
      c.position.set(bx - 2.4, 1.5, bz + 1.9);
      c.lookAt(bx - 0.2, 1.0, bz);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
      return true;
    });
    g.say(man, 'お、ワンちゃんも ひいてくかい？ ほら、ぐるっと！', 2.4);
    yield 1.6;
    d.hop(1.8);
    const saved = g.save.events || [];
    const first = !saved.includes('lottery');
    const gold = first || Math.random() < 0.25;
    for (let i = 0; i < 8; i++) { spin += 0.8; audio.play('gara'); yield 0.14; }
    // 玉が出る
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: gold ? 0xf2c23a : 0xe8604c, metalness: gold ? 1 : 0, roughness: 0.25, emissive: gold ? 0x806010 : 0, emissiveIntensity: 0.5 }));
    ball.position.set(bx - 0.18, 0.9, bz + 0.5);
    scene.add(ball);
    audio.play('pop');
    yield 0.8;
    if (gold) {
      audio.play('kalan');
      g.say(man, 'カランカラ〜ン！ 大当たり〜！！', 2.6);
      g.confetti(V(bx - 0.4, 1.8, bz), 60);
      man.pose = 'cheer';
      yield 1.4;
      g.wear('bell');
      g.unlockWear('bell');
      audio.play('suzu', 1.8);
      g.ui.toast('金のすずを もらった！ ちりんちりん', 'star');
      yield 0.6;
      g.ev.complete('lottery', '福引きで大当たり！ 金のすずを もらった', { wait: 0.1 });
    } else {
      g.say(man, 'あ〜、残念！ ポケットティッシュね', 2.2);
      yield 1.8;
      g.ev.complete('lottery', '福引きは…ティッシュ（つぎこそ！）', { wait: 0.1 });
    }
    yield 1.8;
    scene.remove(ball);
    man.pose = 'stand';
    g.endCine(-Math.PI / 2, 0.3);
    g.lock(false);
    spinning = false;
  }
  g.on('interact', () => (!spinning && !g.ev.isDone('lottery') && g.near(front, 1.3, 0.6) ? { id: 'lottery', label: 'まわす', act: () => g.run(lottery()) } : null));
  g.on('update', (dt) => {
    drum.rotation.z = damp(drum.rotation.z, spin, 6, dt);
  });

  // ガチャの男の子（100円をあげると、おまけをくれる）
  const gkid = g.P({ name: 'ガチャの男の子', kid: true, top: 0x5b8fd8, bottom: 0x3b3f45, hat: 'cap', hatColor: 0xe8604c }, 40.35, -33.6, -Math.PI / 2);
  let gHintT = 0, gBusy = false;
  g.ev.pos('gacha', headOf(gkid, 0.35));
  function* gachaGive() {
    const p = g.player;
    gBusy = true;
    g.lock(true);
    g.cine((c) => {
      c.position.set(42.6, 1.25, -31.4);
      c.lookAt(39.8, 0.8, -33.8);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
      return true;
    });
    gkid.lookAt = p.pos;
    const c = p.drop();
    if (c && c.item) { c.item.mesh.visible = false; c.item.ground = false; }
    g.say(gkid, 'えっ…100円！？ くれるの！？', 2.2);
    yield 2.0;
    gkid.heading = -Math.PI / 2;
    gkid.pose = 'crouch';
    gkid.lookAt = null;
    audio.play('coin');
    yield 0.5;
    for (let i = 0; i < 4; i++) { audio.play('tick'); yield 0.2; }
    audio.play('capsule');
    const cap = makeItem('capsule');
    cap.position.set(39.7, 0.35, -33.6);
    scene.add(cap);
    yield 0.8;
    gkid.pose = 'cheer';
    audio.play('pop');
    scene.remove(cap);
    g.say(gkid, 'しばいぬだ！ …これ、きみにあげる！', 2.6);
    yield 1.6;
    gkid.pose = 'give';
    gkid.heading = faceTo(gkid.pos, p.pos);
    g.give('figure', 'ガチャの柴犬');
    g.sparkle(p.pos.clone().add(V(0, 0.5, 0)), 16, 0xbfe0ff);
    yield 1.0;
    gkid.pose = 'stand';
    g.ev.complete('gacha', '100円をあげたら、ガチャの柴犬をくれた', { wait: 0.1 });
    yield 1.4;
    g.endCine(Math.PI / 2, 0.3);
    g.lock(false);
  }
  g.on('interact', (dp) => (!gBusy && g.player.carry && g.player.carry.id === 'coin' && dist2(dp, gkid.pos) < 1.9 ? { id: 'gacha', label: 'わたす', act: () => g.run(gachaGive()) } : null));
  g.on('update', (dt) => {
    if (gBusy || g.ev.isDone('gacha')) return;
    gHintT -= dt;
    const d = dist2(g.player.pos, gkid.pos);
    if (d < 4 && gHintT <= 0) {
      gHintT = 9;
      g.say(gkid, g.player.carry && g.player.carry.id === 'coin' ? 'あっ、それ…100円？' : '100円 たりない…（あと1回だけ まわしたいのに）', 2.6);
    }
  });
}

// ------------------------------------------------------------
// さくら公園
// ------------------------------------------------------------
function park(g) {
  const A = g.A, scene = g.scene;
  // ボールの男の子（ボールは茂みのふちに見えている。くわえて届ける）
  const kid = g.P({ name: 'ボールの男の子', kid: true, top: 0xf6d35a, bottom: 0x3e6ea8, hat: 'yellow' }, 37.2, -62.8, -0.6);
  const ball = g.addItem('ball', 'だれかのボール', V(30.6, 0.075, -85.4), 0);
  g.ev.pos('kid', () => {
    const carrying = g.player.carry && g.player.carry.id === 'ball';
    if (!carrying && ball.ground && !ball.picked) return _a.copy(ball.mesh.position).setY(0.55);
    return headOf(kid, 0.35)();
  });
  g.onPick('ball', () => g.ui.toast('だれかのボール。…男の子が さがしていた？', 'star'));
  let kidBusy = false;
  function* giveKid() {
    const p = g.player;
    kidBusy = true;
    const c = p.drop();
    if (c && c.item) { c.item.mesh.visible = false; c.item.ground = false; }
    kid.pose = 'cheer';
    audio.play('ok');
    g.say(kid, 'ぼくのボール！ ありがとう！', 2.2);
    yield 1.6;
    kid.pose = 'give';
    g.say(kid, 'おれいに これあげる！', 2.2);
    yield 1.0;
    g.wear('crown');
    g.unlockWear('crown');
    g.ui.toast('花かんむりを もらった！', 'flower');
    g.ev.complete('kid', 'ボールを届けたら、花かんむりを くれた');
    yield 1.2;
    kid.pose = 'stand';
  }
  g.on('interact', (dp) => (!kidBusy && g.player.carry && g.player.carry.id === 'ball' && dist2(kid.pos, dp) < 1.9 ? { id: 'give-kid', label: 'わたす', act: () => g.run(giveKid()) } : null));
  g.on('area', (id) => {
    if (id === 'park') g.run(function* () { yield 3; if (!g.ev.isDone('kid')) g.say(kid, 'ボール、どこいっちゃったんだろう…', 2.6); }());
  });

  // コロンちゃん（コーギーと柴犬のミックス。ピンクのハーネス）。ワンで、おいかけっこ
  // （できごとの id 'shiba' と なかまの id 'komugi' は、保存データのため そのまま）
  const koron = new Dog(scene);
  koron.setParams(typeParams('koron', 'コロン'));
  koron.place(60.3, -66.6, Math.PI + 0.3);
  koron.setPose('sit');
  g.koron = koron;
  g.solidDogs = [koron];
  // escaped: 一度ちゃんと逃げきったか（となりで「ワン」した瞬間に つかまえて終わらないように）
  let st = 'sit', tagT = 0, escaped = false;
  const adapter = { resolveDog: (d) => { d.pos.y = 0; g.town.col.resolve(d.pos, d.radius, 0.5, 0.3); } };
  g.ev.pos('shiba', () => _a.copy(koron.pos).setY(0.95));
  // つかまえると、コロンちゃんは 駅まで いっしょに来てくれる（なかま）
  const koronF = new DogFollower(g, koron, { id: 'komugi', name: 'コロンちゃん', gap: 1.2, order: 2 });
  koronF.onJoin = () => g.ui.toast('コロンちゃんが なかまに なった！ 駅まで いっしょ', 'heart');
  function* startTag() {
    st = 'bow';
    koron.setPose('bow');
    koron.bark(1.25);
    g.sayAt(koron.pos, 'わんっ！（おいかけっこ！）', 1.6);
    yield 0.9;
    st = 'run';
    koron.setPose('stand');
    tagT = 0;
    escaped = false;
    g.ui.objective('コロンちゃんを つかまえろ！');
  }
  g.on('bark', (dp) => {
    if (koron.pos.distanceTo(dp) < 4.5 && st === 'sit' && !g.ev.isDone('shiba')) { g.run(startTag()); return true; }
    return false;
  });
  g.on('update', (dt) => {
    if (st === 'party') return;
    const dp = g.player.pos;
    const mv = _h.set(0, 0, 0);
    if (st === 'run') {
      tagT += dt;
      const dx = koron.pos.x - dp.x, dz = koron.pos.z - dp.z, dd = Math.hypot(dx, dz);
      const cx = 55 - koron.pos.x, cz = -64 - koron.pos.z;
      mv.set(dx / (dd + 0.01) + cx * 0.04 + Math.sin(g.t * 1.7) * 0.5, 0, dz / (dd + 0.01) + cz * 0.04 + Math.cos(g.t * 1.3) * 0.5);
      if (mv.length() > 1) mv.normalize();
      // 走り出しは、ぴょんと はなれる
      koron.speedMul = tagT < 1.2 ? 1.8 : dd < 3 ? 1.6 : 1.1;
      if (dd > 1.8) escaped = true;
      if (Math.random() < dt * 1.5) g.puff(koron.pos, 1, 0xc9b79a);
      // 隅に追いこまれて逃げられないときは、少したてば つかまえられる
      if (dd < 0.75 && (escaped || tagT > 3.5)) {
        st = 'caught';
        koron.setPose('belly');
        koron.setExpr('happy');
        koron.bark(1.3);
        g.hearts(koron.pos.clone().add(V(0, 0.5, 0)), 6);
        g.ui.objective('においをたどって 駅へ');
        g.ev.complete('shiba', 'おいかけっこで、コロンちゃんを つかまえた');
        g.run(function* () {
          yield 2.4;
          koron.setPose('stand');
          yield 0.5;
          if (g.flags.arrival) { st = 'home'; return; }
          koron.bark(1.3);
          koron.setExpr('happy');
          g.sayAt(koron.pos.clone().add(V(0, 0.65, 0)), 'わんっ！（駅まで いっしょに 行く！）', 2.4);
          st = 'party';
          g.party.join(koronF);
          yield 1.6;
          g.say(g.oldman, 'おや、コロン。おともかい？ 気をつけて 行っておいで', 2.8);
        }());
      } else if (tagT > 25) {
        st = 'home';
        g.ui.objective('においをたどって 駅へ');
        g.sayAt(koron.pos, 'わふ（またね）', 1.6);
      }
    } else if (st === 'home') {
      const hx = 60.3 - koron.pos.x, hz = -66.6 - koron.pos.z, hd = Math.hypot(hx, hz);
      if (hd > 0.3) mv.set(hx / hd, 0, hz / hd).multiplyScalar(Math.min(1, hd));
      else { st = 'sit'; koron.setPose('sit'); koron.heading = Math.PI + 0.3; }
      koron.speedMul = 1;
    } else if (koron.pos.distanceTo(dp) < 5) { koron.lookAt = dp.clone().setY(0.4); koron.lookHold = 0.3; koron.excite = 0.9; }
    koron.update(dt, mv, adapter);
  });

  // すべり台
  const S = A.slide;
  g.ev.pos('slide', () => _a.set(S.top.x, S.top.y + 0.9, S.top.z));
  function* slide() {
    const p = g.player;
    p.locked = true;
    p.puppet = true;
    p.dog.setPose('sit');
    p.dog.heading = Math.PI;
    audio.play('slide');
    let t = 0;
    const from = V(S.top.x, S.top.y, S.top.z - 0.3);
    while (t < 1) {
      const dt = yield;
      t += (dt || 0.016) / 1.1;
      const k = t * t;
      p.pos.set(from.x, lerp(from.y, 0, k), lerp(from.z, S.bottom.z, k));
      p.dog.syncRoot();
    }
    p.pos.y = 0;
    p.puppet = false;
    p.grounded = true;
    p.dog.setPose('stand');
    p.dog.hop(1.8);
    g.puff(p.pos, 6, 0xe0cba0);
    p.locked = false;
    g.ev.complete('slide', 'すべり台を、しゅーっと すべった', { wait: 0.05 });
  }
  g.on('interact', (dp) => (Math.hypot(dp.x - S.top.x, dp.z - (S.top.z + 0.2)) < 0.8 && dp.y > 1.3 ? { id: 'slide', label: 'すべる', act: () => g.run(slide()) } : null));

  // 桜ふぶき（大きな桜に体あたり → 花びらがいっせいに舞って、枝が落ちてくる）
  const T = V(58.5, 0, -70.5);
  let shaken = false;
  g.ev.pos('sakura', () => (shaken ? null : _a.set(T.x, 5.2, T.z)));
  function* shake() {
    const p = g.player, d = p.dog;
    shaken = true;
    p.locked = true;
    const dir = V(T.x - p.pos.x, 0, T.z - p.pos.z).normalize();
    d.heading = Math.atan2(dir.x, dir.z);
    // 少し下がって…
    const back = p.pos.clone().addScaledVector(dir, -0.6);
    const start = p.pos.clone();
    let t = 0;
    while (t < 0.35) { const dt = yield; t += dt || 0.016; p.pos.lerpVectors(start, back, smooth(t / 0.35)); p.dog.syncRoot(); }
    t = 0;
    const hit = T.clone().addScaledVector(dir, -0.55);
    while (t < 0.22) { const dt = yield; t += dt || 0.016; p.pos.lerpVectors(back, hit, clamp(t / 0.22, 0, 1)); p.dog.syncRoot(); }
    audio.play('thud');
    audio.play('rustle');
    g.cam.shake = 1.1;
    d.onBump(true);
    g.town.petals.burst(T.x, T.z, 4.6, 200, 2.8);
    g.sparkle(V(T.x, 3.5, T.z), 20, 0xffc0d0, 3);
    yield 0.5;
    // 枝が落ちてくる
    const br = g.addItem('sakura', '桜の枝', V(T.x + 0.9, 3.4, T.z - 0.8), 1.2);
    br.ground = false;
    t = 0;
    while (t < 1) {
      const dt = yield;
      t += (dt || 0.016) / 0.9;
      br.mesh.position.y = lerp(3.4, 0.03, t * t);
      br.mesh.rotation.z = Math.sin(t * 9) * 0.4 * (1 - t);
    }
    br.mesh.position.y = 0.03;
    br.mesh.rotation.z = 0;
    br.ground = true;
    g.puff(br.mesh.position, 4, 0xf0c8d0);
    p.locked = false;
    g.ev.complete('sakura', '体あたりで、桜ふぶき！', { wait: 0.1 });
  }
  g.on('interact', (dp) => (!shaken && dist2(dp, T) < 1.9 && dp.y < 0.5 ? { id: 'sakura', label: 'ゆらす', act: () => g.run(shake()) } : null));

  // 池のカモ
  const ducks = new Ducks(scene, A.pondR);
  g.ducks = ducks;
  const P = A.pondR;
  g.ev.pos('ducks', () => _a.set(P.x, 1.4, P.z));
  g.on('update', (dt) => ducks.update(dt, g.t));
  g.on('bark', (dp) => {
    const e = Math.hypot((dp.x - P.x) / (P.rx + 3.5), (dp.z - P.z) / (P.rz + 3.5));
    if (e > 1) return false;
    ducks.attract(dp, 10);
    g.run(function* () {
      for (let i = 0; i < 3; i++) { audio.play('quack', 1 + i * 0.1); yield 0.45; }
      g.sayAt(V(P.x, 1.2, P.z), 'グワッ、グワッ（なあに？）', 2.2);
      yield 2.4;
      if (!g.ev.isDone('ducks')) g.ev.complete('ducks', 'カモたちが、泳いで寄ってきた', { wait: 0.1 });
    }());
    return true;
  });
}

// ------------------------------------------------------------
// ひだまり川
// ------------------------------------------------------------
function river(g) {
  const A = g.A, scene = g.scene, R = RIVER;
  // 夕日の川（はじめて土手に立ったとき）
  g.ev.pos('river', () => _a.set(57.5, 1.4, -99.5));
  function* riverScene() {
    const p = g.player, day = g.day;
    g.lock(true);
    // 写真のころに、ちょうど鉄橋の上を電車がわたるように
    g.sendTrain(1, -275);
    const fog0 = day.fogScale;
    const base = p.pos.clone();
    // 鉄橋のシルエットと夕日、光の道がうつる川が一度に見える場所
    const V1 = V(96, 5.5, -114), L = V(165, 3, -142);
    g.post.tilt = 0.35;
    g.post.tiltFocus = 0.45;
    const c0 = g.camera.position.clone();
    const up = V(base.x - 2, base.y + 5, base.z + 4);
    const look = V();
    g.cine((c, dt, t) => {
      day.fogScale = lerp(fog0, 1.5, smooth(clamp(t / 2, 0, 1)));
      // 犬のうしろ → 上へ → 川ぞいを すべるように、ながめの場所へ
      const k1 = smooth(clamp(t / 1.6, 0, 1));
      const k2 = smooth(clamp((t - 1.0) / 5.0, 0, 1));
      c.position.lerpVectors(c0, up, k1).lerp(V1, k2);
      look.lerpVectors(V(base.x, base.y - 1, base.z - 10), L, smooth(clamp((t - 0.6) / 4.6, 0, 1)));
      c.lookAt(look);
      const fov = lerp(52, 42, k2);
      if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
      return true;
    });
    audio.play('whoosh');
    yield 2.0;
    g.ui.caption('川が、夕日で きらきら光っている', 3.6);
    yield 4.0;
    g.ev.complete('river', '夕日が、川いっぱいに うつっていた', { wait: 0.05 });
    yield 2.0;
    const cam1 = g.camera.position.clone();
    const look1 = look.clone();
    g.cine((c, dt, t) => {
      const k = smooth(clamp(t / 1.6, 0, 1));
      day.fogScale = lerp(1.5, fog0, k);
      g.post.tilt = 0.35 * (1 - k);
      c.position.lerpVectors(cam1, V(p.pos.x, p.pos.y + 1.4, p.pos.z + 3), k);
      c.lookAt(_h.lerpVectors(look1, p.pos, k));
      if (Math.abs(c.fov - 55) > 0.01) { c.fov = lerp(42, 55, k); c.updateProjectionMatrix(); }
      return t < 1.6;
    });
    yield 1.6;
    day.fogScale = fog0;
    g.endCine(0, 0.3);
    g.lock(false);
  }
  g.on('update', () => {
    if (g.ev.isDone('river') || g.state !== 'play' || g.player.locked) return;
    const dp = g.player.pos;
    if (dp.z < -110.5 && dp.z > -122 && dp.x > R.x0 && dp.x < R.x1) g.run(riverScene());
  });

  // ハーモニカのおじいさん（橋の下）
  const ub = A.underBridge;
  const oldman = g.P({ name: 'ハーモニカのおじいさん', hairStyle: 'bald', hair: 0xcfc8c0, top: 0x5b6858, bottom: 0x3b3f45, hat: 'cap', hatColor: 0x3b4a5e, glasses: true }, 0, 0);
  oldman.sitOn(ub.x, ub.z - 0.05, Math.PI, R.flatY);
  oldman.seated = true;
  oldman.pose = 'play';
  const harp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.9, roughness: 0.25 }));
  harp.position.set(0, 0.13, 0.21);
  oldman.rig.head.add(harp);
  const loop = audio.loop('harmonica');
  let hBusy = false, solo = false;
  g.ev.pos('harmonica', headOf(oldman, 0.35));
  g.on('update', () => {
    const d = oldman.pos.distanceTo(g.player.pos);
    if (loop) loop.setVolume(solo ? 0 : clamp(1 - d / 24, 0, 1) * 0.9 * (g.state === 'play' || g.cineLock ? 1 : 0));
  });
  function* session() {
    const p = g.player, d = p.dog;
    hBusy = true;
    g.lock(true);
    d.setPose('sit');
    d.heading = faceTo(p.pos, oldman.pos);
    const mid = V((p.pos.x + oldman.pos.x) / 2, R.flatY, (p.pos.z + oldman.pos.z) / 2);
    g.post.tilt = 0.5;
    g.post.tiltFocus = 0.55;
    g.cine((c, dt, t) => {
      const a = 0.9 + t * 0.03;
      c.position.set(mid.x + Math.sin(a) * 3.2, mid.y + 0.75, mid.z + Math.cos(a) * 3.2);
      c.lookAt(mid.x, mid.y + 0.55, mid.z);
      if (c.fov !== 42) { c.fov = 42; c.updateProjectionMatrix(); }
      return true;
    });
    oldman.pose = 'sit';
    oldman.lookAt = p.pos;
    g.say(oldman, 'おや、聴いてくれるのかい', 2.2);
    yield 2.2;
    g.say(oldman, 'じゃあ、とっておきの一曲を', 2.0);
    yield 1.6;
    oldman.pose = 'play';
    oldman.lookAt = null;
    solo = true;
    const dur = audio.tune('harmonicaSolo') || 10;
    yield Math.min(3.2, dur * 0.3);
    for (let i = 0; i < 3; i++) {
      d.setPose('stand');
      d.lookAt = p.pos.clone().add(V(0, 3, 0));
      d.lookHold = 1.2;
      d.bark(0.75);
      audio.play('howl', 1 + i * 0.06);
      g.sayAt(p.pos.clone().add(V(0, 0.9, 0)), 'ワオ〜ン♪', 1.3);
      yield 1.5;
    }
    d.setPose('sit');
    yield Math.max(0.5, dur - 3.2 - 4.5);
    solo = false;
    oldman.pose = 'sit';
    oldman.lookAt = p.pos;
    g.say(oldman, 'ははは、じょうずじょうず。いい声だ', 2.4);
    g.hearts(p.pos.clone().add(V(0, 0.7, 0)), 6);
    g.ev.complete('harmonica', 'ハーモニカに合わせて、いっしょに うたった', { wait: 0.3 });
    yield 2.4;
    oldman.pose = 'play';
    oldman.lookAt = null;
    g.endCine(faceTo(oldman.pos, p.pos), 0.3);
    g.lock(false);
  }
  g.on('sit', (dp) => {
    if (hBusy || g.ev.isDone('harmonica') || oldman.pos.distanceTo(dp) > 2.8) return false;
    g.run(session());
    return true;
  });

  // 川で水あそび（浅い所に入ると、ちゃぷちゃぷ。出るとぶるぶる）
  let inWater = false, splashT = 0;
  g.ev.pos('wade', () => _a.copy(A.riverWade).setY(R.flatY + 1.0));
  g.on('update', (dt) => {
    const p = g.player, dp = p.pos, d = p.dog;
    const w = dp.y < R.waterY - 0.05 && dp.z < R.beach && dp.z > R.farFlat;
    if (w) {
      splashT -= dt;
      if (splashT <= 0 && d.speed > 0.4) {
        splashT = 0.18;
        g.splash(V(dp.x, R.waterY + 0.02, dp.z), 6);
        if (Math.random() < 0.4) audio.play('splash', 0.6);
      }
      if (!inWater) {
        inWater = true;
        audio.play('splash');
        g.splash(V(dp.x, R.waterY + 0.02, dp.z), 16);
        g.flags.wet = true;
        if (!g.ev.isDone('wade')) g.ev.complete('wade', 'ちゃぷちゃぷ、川で水あそび', { wait: 0.4 });
      }
    } else if (inWater && dp.y > R.waterY + 0.1) {
      inWater = false;
      g.run(function* () {
        d.shaking = true;
        audio.play('fluff');
        for (let i = 0; i < 4; i++) { g.splash(d.headWorld.clone(), 8); yield 0.12; }
        d.shaking = false;
      }());
    }
  });

  // 鉄橋をわたる電車（河川敷にいる時に通ったら）
  let trainBusy = false;
  g.ev.pos('train', () => _a.set(142, 15, -140));
  const onBridge = () => {
    const tr = g.train;
    if (tr.state !== 'run') return false;
    return tr.dir > 0 ? tr.z > -150 && tr.z < -70 : tr.z < -125 && tr.z > -175;
  };
  function* trainScene() {
    const p = g.player, tr = g.train;
    trainBusy = true;
    g.lock(true);
    const base = p.pos.clone();
    // 鉄橋（x=142）の手前から見上げる。橋より東にいる時は、反対がわから
    const sx = base.x < 138 ? -1 : 1;
    p.dog.heading = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    p.dog.setPose('sit');
    g.post.tilt = 0.3;
    g.post.tiltFocus = 0.36;
    const look = V(142, 5, base.z - 9);
    g.cine((c, dt, t) => {
      c.position.set(base.x + sx * 10 + t * 0.15 * -sx, base.y + 1.8, base.z + 4.5);
      look.z = damp(look.z, clamp(tr.z - tr.dir * 6, base.z - 30, base.z + 10), 1.5, dt);
      c.lookAt(look);
      if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
      return true;
    });
    yield 1.6;
    g.ev.complete('train', '夕日の鉄橋を、電車が ゴトンゴトン わたっていった', { wait: 0 });
    yield 2.2;
    g.endCine(null);
    g.lock(false);
    trainBusy = false;
  }
  g.on('update', () => {
    if (trainBusy || g.ev.isDone('train') || g.state !== 'play' || g.player.locked) return;
    const dp = g.player.pos;
    if (dp.z < -112 && dp.y < -0.5 && dp.x > 75 && dp.x < 205 && onBridge()) g.run(trainScene());
  });

  // ほたる（17:36 から、葦のしげみ）
  const RE = A.reeds;
  g.ev.when('fireflies', () => g.hour >= 17.6);
  g.ev.pos('fireflies', () => _a.set(RE.x, R.flatY + 1.1, RE.z));
  let flyT = 0, flySit = 0;
  g.on('update', (dt) => {
    if (g.hour < 17.6) return;
    const dp = g.player.pos;
    if (dist2(dp, RE) > 45) return;
    flyT -= dt;
    if (flyT <= 0) {
      flyT = 0.12;
      g.fx.spawn({ pos: V(RE.x - 14 + Math.random() * 28, R.flatY + 0.4 + Math.random() * 1.4, RE.z - 2.5 + Math.random() * 4), vel: V((Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.3, (Math.random() - 0.5) * 0.5), color: 0xd4ff7a, size: 0.1, life: 3 + Math.random() * 2, drag: 0.2, shape: 0 });
    }
    if (!g.ev.isDone('fireflies') && dist2(dp, RE) < 5 && g.player.dog.poseTarget === 'sit') flySit += dt; else flySit = 0;
    if (flySit > 1.2) {
      flySit = -99;
      g.run(fireflyScene());
    }
  });
  function* fireflyScene() {
    const p = g.player, dp = p.pos;
    g.lock(true);
    p.dog.setPose('sit');
    const c0 = dp.clone();
    // 犬の少し前・低い所から。うしろに葦と、向こう岸の町の灯り
    const dir = V(RE.x - c0.x, 0, RE.z - c0.z);
    if (dir.lengthSq() < 0.5) dir.set(0, 0, -1);
    dir.normalize();
    const side = V(-dir.z, 0, dir.x);
    g.post.tilt = 0.4;
    g.post.tiltFocus = 0.5;
    g.cine((c, dt, t) => {
      const a = t * 0.08;
      c.position.set(c0.x - dir.x * 3.0 + side.x * (1.6 + a), c0.y + 0.55 + t * 0.03, c0.z - dir.z * 3.0 + side.z * (1.6 + a));
      c.lookAt(c0.x + dir.x * 0.8, c0.y + 0.55, c0.z + dir.z * 0.8);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
      return true;
    });
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.8;
        g.fx.spawn({ pos: V(c0.x + Math.cos(a) * r, c0.y + 0.2 + Math.random() * 1.3, c0.z + Math.sin(a) * r), vel: V(-Math.sin(a) * 0.35, 0.08, Math.cos(a) * 0.35), color: 0xd4ff7a, size: 0.12, life: 4 + Math.random() * 2, drag: 0.1, shape: 0 });
      }
      yield 0.4;
    }
    audio.play('sparkle');
    p.dog.lookAt = c0.clone().add(V(0, 1.4, 0));
    p.dog.lookHold = 2;
    g.ui.caption('ほたるが、ふわり…ふわり…', 2.8);
    yield 1.4;
    g.ev.complete('fireflies', 'ほたるが、まわりで ふわふわ光っていた', { wait: 0.05 });
    yield 2.4;
    g.endCine(Math.atan2(dir.x, dir.z) + Math.PI, 0.3);
    g.lock(false);
  }
  g.on('sit', (dp) => dist2(dp, RE) < 5 && g.hour >= 17.6 && !g.ev.isDone('fireflies'));
}

// ------------------------------------------------------------
// 駅前通り：みどりのおじさん
// ------------------------------------------------------------
function road(g) {
  const tr = g.traffic;
  const guard = g.P({ name: 'みどりのおじさん', top: 0xf2f0ea, vest: 0xf2c23a, hat: 'cap', hatColor: 0x3f8f6a, bottom: 0x4a5468, flag: true, glasses: true, hair: 0xd8d2cc }, 80.0, -75.9, Math.PI / 2, 0.15);
  g.ev.pos('guard', headOf(guard));
  let said = false, whistled = false;
  tr.onHonk = () => { if (guard.pos.distanceTo(g.player.pos) < 14) g.say(guard, 'こらこら、あぶないよー！', 2.2); };
  g.on('update', () => {
    const dp = g.player.pos;
    const gd = guard.pos.distanceTo(dp);
    guard.pose = tr.pedGreen && gd < 14 ? 'flag' : 'stand';
    if (tr.pedGreen && gd < 8 && !said && g.state === 'play') { said = true; g.say(guard, 'はい、青だよ。わたっていいよー', 2.2); }
    if (!tr.pedGreen) said = false;
    const onCross = dp.x > 81 && dp.x < 93 && dp.z > -74.5 && dp.z < -69.5;
    if (onCross && !tr.pedGreen && !whistled && g.state === 'play') {
      whistled = true;
      audio.play('whistle');
      g.say(guard, 'ピピーッ！ 赤だよー！', 1.8);
      g.run(function* () { yield 6; whistled = false; }());
    }
  });
  g.on('sit', (dp) => {
    if (guard.pos.distanceTo(dp) > 4.6 || g.ev.isDone('guard') || tr.pedGreen) return false;
    g.run(function* () {
      guard.lookAt = g.player.pos;
      g.say(guard, 'おっ、ちゃんと待ってて えらいねえ', 2.4);
      yield 2.2;
      g.say(guard, '青になったら わたるんだよ', 2.2);
      g.ev.complete('guard', '赤信号で、ちゃんと おすわりして待てた');
      yield 2;
      guard.lookAt = null;
    }());
    return true;
  });
}

// ------------------------------------------------------------
// 駅前広場：ハト・まちあわせの犬・ギターのおにいさん・焼きいも屋さん
// ------------------------------------------------------------
function plaza(g) {
  const A = g.A, scene = g.scene;
  // ハト
  const pigeons = new Pigeons(scene, V(104.5, 0.15, -67.5), 24);
  g.ev.pos('pigeons', () => _a.set(104.5, 1.1, -67.5));
  // 飛んだハトのうち1羽（ポッポ）が、犬の頭に おりてくる（なかま）
  const poppo = new PigeonRider(g);
  let poppoSent = false;
  pigeons.onScatter = () => {
    if (!g.ev.isDone('pigeons')) g.run(function* () { yield 1.1; g.ev.complete('pigeons', 'バサバサッ！ 広場のハトが いっせいに飛んだ', { wait: 0 }); }());
    if (poppoSent || g.state !== 'play' || g.flags.arrival) return;
    poppoSent = true;
    g.run(function* () {
      yield 3.4;
      if (g.state !== 'play' || g.flags.arrival) { poppoSent = false; return; }
      poppo.flyIn(V(104.5 + 3, 6.5, -67.5 - 2));
      g.party.join(poppo);
      yield 1.7;
      g.sayAt(poppo.pos.clone().add(V(0, 0.3, 0)), 'クルックー', 1.6);
      g.ui.toast('ハトの ポッポが、あたまに のった！', 'heart');
    }());
  };
  g.on('update', (dt) => pigeons.update(dt, g.player.pos, g.player.dog.speed));
  g.on('bark', (dp) => {
    if (Math.hypot(dp.x - 104.5, dp.z + 67.5) > 6) return false;
    for (const b of pigeons.birds) if (b.st === 'ground') { b.st = 'fly'; b.air = 0; b.v.set((Math.random() - 0.5) * 3, 5, (Math.random() - 0.5) * 3); }
    audio.play('flap');
    pigeons.onScatter();
    return true;
  });

  // まちあわせの犬（像の台座にのぼる）
  g.ev.pos('statue', () => _a.copy(A.statue).setY(3.2));
  g.on('update', () => {
    const p = g.player, dp = p.pos;
    if (g.ev.isDone('statue') || g.state !== 'play') return;
    if (p.grounded && Math.hypot(dp.x - A.statue.x, dp.z - A.statue.z) < 1.1 && dp.y > 1.3) {
      p.dog.setPose('sit');
      g.sayAt(A.statue.clone().add(V(0, 1.4, 0)), '（となりに すわってみた）', 2.2);
      g.ev.complete('statue', 'まちあわせの犬と、ならんで すわった', { wait: 0.8 });
    }
  });

  // ギターのおにいさん
  const mpos = V(106.4, 0.15, -61.2);
  const musician = g.P({ name: 'ギターのおにいさん', hairStyle: 'short', hair: 0x6a4330, top: 0x3b4a5e, bottom: 0x2a2f38, scarf: 0xe8c04a }, mpos.x, mpos.z, 2.6, 0.15);
  musician.pose = 'strum';
  const guitar = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10), new THREE.MeshStandardMaterial({ color: 0xb87a3e, roughness: 0.35 }));
  gb.scale.set(1, 1.25, 0.45);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.5 }));
  neck.position.set(0, 0.36, 0);
  guitar.add(gb, neck);
  guitar.position.set(-0.05, 0.25, 0.2);
  guitar.rotation.z = 1.15;
  musician.rig.torso.add(guitar);
  // ギターケース（お金が入っている）
  const cx = mpos.x + Math.sin(2.6) * 1.0, cz = mpos.z + Math.cos(2.6) * 1.0;
  prop(scene, [
    { geo: new THREE.BoxGeometry(0.4, 0.1, 1.0), matrix: M4(0, 0.05, 0), color: 0x2a2320 },
    { geo: new THREE.BoxGeometry(0.34, 0.02, 0.9), matrix: M4(0, 0.1, 0), color: 0x8a2f35 },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.005, 10), matrix: M4(0.05, 0.115, 0.1), color: 0xd9dde2 },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.005, 10), matrix: M4(-0.07, 0.115, -0.2), color: 0xe8c04a },
  ], cx, 0.15, cz, 2.6 + Math.PI / 2);
  const gLoop = audio.loop('guitar');
  let mBusy = false, mSolo = false;
  g.ev.pos('musician', headOf(musician, 0.35));
  g.on('update', () => {
    const d = musician.pos.distanceTo(g.player.pos);
    if (gLoop) gLoop.setVolume(mSolo ? 0 : clamp(1 - d / 26, 0, 1) * 0.85 * (g.state === 'play' || g.cineLock ? 1 : 0));
  });
  const fans = [];
  for (let i = 0; i < 3; i++) {
    const f = g.P({ top: [0xe8a0a0, 0x9fcfe8, 0xf2d29b][i], bottom: [0x4a5468, 0x3b3f45, 0x6f7fa8][i], hairStyle: ['long', 'short', 'bun'][i], hair: 0x3b2a22, skirt: i === 0 }, 100 + i * 2, -48, 0, 0.15);
    f.hidden = true;
    f.root.visible = false;
    fans.push(f);
  }
  function* concert() {
    const p = g.player, d = p.dog;
    mBusy = true;
    g.lock(true);
    d.setPose('sit');
    d.heading = faceTo(p.pos, musician.pos);
    const mid = V((p.pos.x + musician.pos.x) / 2, 0.15, (p.pos.z + musician.pos.z) / 2);
    g.post.tilt = 0.5;
    g.post.tiltFocus = 0.55;
    g.cine((c, dt, t) => {
      const a = 1.3 + t * 0.04;
      c.position.set(mid.x + Math.sin(a) * 4.2, 1.5, mid.z + Math.cos(a) * 4.2);
      c.lookAt(mid.x, 0.9, mid.z);
      if (c.fov !== 42) { c.fov = 42; c.updateProjectionMatrix(); }
      return true;
    });
    musician.pose = 'stand';
    musician.lookAt = p.pos;
    g.say(musician, 'お、ワンちゃん。1曲どう？', 2.2);
    yield 2.2;
    musician.pose = 'strum';
    musician.lookAt = null;
    mSolo = true;
    const dur = audio.tune('busker') || 9;
    // 人が集まってくる
    fans.forEach((f, i) => {
      f.hidden = false;
      f.root.visible = true;
      const a = 1.9 + i * 0.55;
      f.place(mid.x + Math.sin(a) * 9, mid.z + Math.cos(a) * 9, 0, 0.15);
      f.walkTo(mid.x + Math.sin(a) * 2.6, mid.z + Math.cos(a) * 2.6, () => { f.heading = faceTo(f.pos, mid); f.pose = 'clap'; });
    });
    yield 2.4;
    for (let i = 0; i < 4; i++) {
      d.setPose('stand');
      d.bark(0.8 + (i % 2) * 0.15);
      audio.play('howl', 1 + (i % 2) * 0.12);
      g.sayAt(p.pos.clone().add(V(0, 0.9, 0)), i === 3 ? 'ワオ〜〜ン♪' : 'ワン♪', 1.0);
      yield dur / 7;
    }
    d.setPose('sit');
    yield Math.max(0.5, dur - 2.4 - (dur / 7) * 4);
    mSolo = false;
    audio.play('crowd');
    for (const f of fans) f.pose = 'clap';
    musician.pose = 'cheer';
    g.confetti(p.pos.clone().add(V(0, 0.8, 0)), 20);
    g.say(musician, 'ありがとう！ きみ、センスあるね！', 2.6);
    g.ev.complete('musician', '歌に合わせて ワオーン。拍手をもらった', { wait: 0.4 });
    yield 2.6;
    musician.pose = 'strum';
    fans.forEach((f, i) => { f.pose = 'stand'; f.walkTo(100 + i * 6, -47, () => { f.root.visible = false; f.hidden = true; }); });
    g.endCine(faceTo(musician.pos, p.pos), 0.3);
    g.lock(false);
  }
  g.on('sit', (dp) => {
    if (mBusy || g.ev.isDone('musician') || musician.pos.distanceTo(dp) > 3.2) return false;
    g.run(concert());
    return true;
  });

  // 焼きいも屋さん（軽トラ）
  const tx = 99.4, tz = -52.4;
  const white = 0xf2f0ea, glass = 0x2e3a48;
  prop(scene, [
    { geo: new THREE.BoxGeometry(1.45, 0.55, 3.3), matrix: M4(0, 0.6, 0), color: white },
    { geo: new THREE.BoxGeometry(1.4, 0.75, 1.1), matrix: M4(0, 1.2, 1.05), color: white },
    { geo: new THREE.BoxGeometry(1.42, 0.45, 1.0), matrix: M4(0, 1.28, 1.1), color: glass },
    { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), matrix: M4(-0.68, 0.3, 1.05, 0, 0, Math.PI / 2), color: 0x1c1c1f },
    { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), matrix: M4(0.68, 0.3, 1.05, 0, 0, Math.PI / 2), color: 0x1c1c1f },
    { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), matrix: M4(-0.68, 0.3, -1.05, 0, 0, Math.PI / 2), color: 0x1c1c1f },
    { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), matrix: M4(0.68, 0.3, -1.05, 0, 0, Math.PI / 2), color: 0x1c1c1f },
    // 石焼きのかま（黒い箱と煙突）
    { geo: new THREE.BoxGeometry(1.1, 0.7, 1.4), matrix: M4(0, 1.2, -0.7), color: 0x2a2624 },
    { geo: new THREE.BoxGeometry(1.14, 0.08, 1.44), matrix: M4(0, 1.58, -0.7), color: 0x6b5a4a },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), matrix: M4(0.3, 1.95, -1.1), color: 0x3b3330 },
    // 赤ちょうちん
    { geo: new THREE.SphereGeometry(0.16, 10, 8), matrix: M4(-0.62, 1.55, -1.45, 0, 0, 0, 1, 1.3, 1), color: 0xd9322a },
  ], tx, 0.15, tz, Math.PI / 2);
  const noren = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshStandardMaterial({ map: (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 110; const c = cv.getContext('2d'); c.fillStyle = '#d9322a'; c.fillRect(0, 0, 256, 110); c.fillStyle = '#fff'; c.font = '800 54px "M PLUS Rounded 1c", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('石焼いも', 128, 58); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })(), side: THREE.DoubleSide, roughness: 0.9 }));
  noren.position.set(tx - 0.7, 1.35, tz - 0.8);
  noren.rotation.y = Math.PI / 2;
  scene.add(noren);
  g.town.col.addBox(tx - 1.7, tx + 1.7, tz - 0.8, tz + 0.8, 0, 1.8, 'truck');
  const vendor = g.P({ name: '焼きいも屋さん', hairStyle: 'short', hair: 0x9a9088, top: 0x3b4a5e, bottom: 0x3b3f45, hat: 'kerchief', hatColor: 0x3e6ea8, apron: 0xf2ece0 }, tx - 0.4, tz - 1.5, Math.PI, 0.15);
  const yLoop = audio.loop('yakiimo');
  let steamT = 0, yBusy = false, callT = 6;
  g.ev.pos('yakiimo', headOf(vendor, 0.35));
  g.on('update', (dt) => {
    const d = vendor.pos.distanceTo(g.player.pos);
    if (yLoop) yLoop.setVolume(clamp(1 - d / 34, 0, 1) * 0.7 * (g.state === 'play' ? 1 : 0.3));
    steamT -= dt;
    if (steamT <= 0 && d < 40) {
      steamT = 0.25;
      g.dust.spawn({ pos: V(tx + 1.1, 2.35, tz - 0.3), vel: V(0.1 + Math.random() * 0.2, 0.6, (Math.random() - 0.5) * 0.2), color: 0xf2eee8, size: 0.25, grow: 2.4, life: 2.2, drag: 0.6, shape: 0, alpha: 0.35 });
    }
    callT -= dt;
    if (callT <= 0 && d < 22 && g.state === 'play') { callT = 16; g.say(vendor, '♪ い〜しや〜きいも〜 おいも〜', 2.6); }
  });
  g.on('sit', (dp) => {
    if (yBusy || g.ev.isDone('yakiimo') || vendor.pos.distanceTo(dp) > 2.8) return false;
    yBusy = true;
    g.run(function* () {
      const p = g.player;
      g.lock(true);
      p.dog.setPose('sit');
      p.dog.heading = faceTo(p.pos, vendor.pos);
      const mid = V((p.pos.x + vendor.pos.x) / 2, 0.15, (p.pos.z + vendor.pos.z) / 2);
      g.post.tilt = 0.4;
      g.post.tiltFocus = 0.5;
      g.cine((c, dt, t) => {
        c.position.set(mid.x + 3.4 - t * 0.04, 1.35, mid.z - 1.6);
        c.lookAt(mid.x - 0.4, 0.95, mid.z + 0.6);
        if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
        return true;
      });
      vendor.lookAt = p.pos;
      g.say(vendor, 'おっ、いいにおいだろ？ ほら、しっぽのとこだけな', 2.6);
      yield 2.2;
      vendor.pose = 'crouch';
      yield 0.6;
      const piece = makeItem('yakiimo');
      piece.position.copy(p.dog.mouthWorld);
      scene.add(piece);
      yield 0.5;
      scene.remove(piece);
      audio.play('chew');
      p.dog.chewing = true;
      g.hearts(p.pos.clone().add(V(0, 0.6, 0)), 6);
      for (let i = 0; i < 6; i++) { g.dust.spawn({ pos: p.dog.mouthWorld.clone(), vel: V(0, 0.5, 0), color: 0xffffff, size: 0.12, grow: 2, life: 1, drag: 1, alpha: 0.4 }); yield 0.2; }
      p.dog.chewing = false;
      vendor.pose = 'stand';
      g.say(vendor, 'ほくほくだろ？ 気をつけて帰りな', 2.4);
      vendor.lookAt = null;
      g.ev.complete('yakiimo', 'ほくほくの焼きいもを、ひとくち', { wait: 0.2 });
      yield 1.8;
      g.endCine(faceTo(vendor.pos, p.pos), 0.3);
      g.lock(false);
    }());
    return true;
  });
}

// ------------------------------------------------------------
// 5時のチャイム（夕焼け小焼け）とカラスの群れ
// ------------------------------------------------------------
function chime(g) {
  let started = false, chimeT = 99, hinted = false;
  const flock = [];
  g.on('update', (dt) => {
    if (!g.flags.escaped || g.state !== 'play') return;
    if (!hinted && g.hour >= 16.95) { hinted = true; g.ui.toast('もうすぐ5時。町にチャイムが流れる…', 'eye'); }
    if (!started && g.hour >= 17.0) {
      started = true;
      chimeT = 0;
      audio.tune('chime');
      g.ui.toast('♪ 5時のチャイム。いっしょに「ワン」', 'eye');
      // カラスが山へ帰っていく
      const p = g.player.pos;
      for (let i = 0; i < 6; i++) {
        const c = new Crow(g.scene);
        c.pos.set(p.x - 60 + i * 2.5, 18 + (i % 3) * 2, p.z + 20 - i * 3);
        c.flyTo(V(p.x + 90 + i * 3, 22 + (i % 2) * 3, p.z - 40 - i * 4), 16 + i * 0.8, 4);
        flock.push(c);
      }
      g.run(function* () { yield 1.5; audio.play('caw'); yield 2; audio.play('caw', 0.9); }());
    }
    if (started) chimeT += dt;
    for (let i = flock.length - 1; i >= 0; i--) {
      const c = flock[i];
      c.update(dt);
      if (!c.flight) { g.scene.remove(c.root); flock.splice(i, 1); }
    }
  });
  g.on('bark', (dp) => {
    if (!started || chimeT > 24 || g.ev.isDone('chime')) return false;
    g.player.dog.bark(0.75);
    audio.play('howl');
    g.sayAt(dp.clone().add(V(0, 0.9, 0)), 'ワオ〜〜ン♪', 1.6);
    g.ev.complete('chime', 'チャイムに合わせて、町じゅうに ワオーン', { wait: 0.4 });
    return true;
  });
}
