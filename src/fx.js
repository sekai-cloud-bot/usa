import * as THREE from 'three';
import { rand, clamp } from './util.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** インスタンス描画のパーティクル（落ちたものは床に残る＝散らかりが見える） */
class ParticlePool {
  constructor(scene, geo, material, cap, opts = {}) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.shadow;
    this.mesh.count = 0;
    if (opts.colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    }
    scene.add(this.mesh);
    this.items = [];
    this.next = 0;
    this.dirty = true;
  }
  spawn(p) {
    let it = this.items.find((x) => x.dead);
    if (it) {
      // 消えた粒を再利用
    } else if (this.items.length < this.cap) {
      it = {};
      this.items.push(it);
    } else {
      // 古いものから再利用
      it = this.items[this.next];
      this.next = (this.next + 1) % this.cap;
    }
    Object.assign(it, {
      pos: p.pos.clone(), vel: p.vel ? p.vel.clone() : new THREE.Vector3(),
      rot: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)),
      spin: p.spin ?? 6, size: p.size ?? 1, grow: p.grow ?? 0,
      life: p.life ?? 1.5, age: 0, gravity: p.gravity ?? 9.8, drag: p.drag ?? 0.5,
      persist: !!p.persist, landed: false, dead: false, floorY: p.floorY ?? 0.02, flat: p.flat ?? 0.35,
      fade: p.fade ?? true,
    });
    if (this.mesh.instanceColor && p.color) {
      const idx = this.items.indexOf(it);
      const c = p.color instanceof THREE.Color ? p.color : new THREE.Color(p.color);
      this.mesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.dirty = true;
    return it;
  }
  update(dt) {
    const items = this.items;
    let any = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.dead) { continue; }
      any = true;
      it.age += dt;
      if (!it.landed) {
        it.vel.y -= it.gravity * dt;
        const k = Math.exp(-it.drag * dt);
        it.vel.x *= k; it.vel.z *= k;
        if (it.gravity < 3) it.vel.y *= k;
        it.pos.addScaledVector(it.vel, dt);
        it.rot.x += it.spin * dt; it.rot.y += it.spin * 0.7 * dt;
        if (it.pos.y <= it.floorY && it.vel.y <= 0) {
          it.pos.y = it.floorY;
          if (it.persist) {
            it.landed = true;
            it.rot.x = rand(-0.3, 0.3); it.rot.z = rand(-0.3, 0.3);
          } else {
            it.vel.y *= -0.3; it.vel.x *= 0.6; it.vel.z *= 0.6;
          }
        }
        // 壁
        if (it.pos.x < -4.45) { it.pos.x = -4.45; it.vel.x *= -0.4; }
        if (it.pos.x > 4.45) { it.pos.x = 4.45; it.vel.x *= -0.4; }
        if (it.pos.z < -3.45) { it.pos.z = -3.45; it.vel.z *= -0.4; }
      }
      if (!it.persist && it.age > it.life) it.dead = true;
    }
    if (!any && !this.dirty) return;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let s = it.size * (1 + it.grow * it.age);
      if (it.dead) s = 0;
      else if (!it.persist && it.fade) s *= clamp((it.life - it.age) / 0.35, 0, 1);
      if (it.landed) {
        _e.set(it.rot.x, it.rot.y, it.rot.z);
        _s.set(s, s * it.flat, s);
      } else {
        _e.set(it.rot.x, it.rot.y, it.rot.z);
        _s.set(s, s, s);
      }
      _q.setFromEuler(_e);
      _m.compose(it.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      n = i + 1;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }
  clear() {
    this.items.length = 0;
    this.next = 0;
    this.mesh.count = 0;
    this.dirty = true;
  }
}

function makeTextSprite(draw, w = 128, h = 128, scale = 0.5) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(scale * (w / h), scale, 1);
  sp.renderOrder = 10;
  return sp;
}

const ICONS = {
  tissue: '🧻', cushion: '🛋️', slipper: '🩴', ball: '⚽', plant: '🪴', mug: '☕', box: '📦', lamp: '💡',
  trash: '🗑️', bed: '💤', teddy: '🧸', basket: '🧺', sun: '☀️', heart: '💗', q: '❓', ex: '❗', door: '🚪',
};

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.popLayer = document.getElementById('popups');
    this.popCount = 0;

    const fluffGeo = new THREE.IcosahedronGeometry(0.05, 1);
    const fluffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    this.fluff = new ParticlePool(scene, fluffGeo, fluffMat, 260, { shadow: false });

    const bitGeo = new THREE.TetrahedronGeometry(0.045, 0);
    const bitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    this.bits = new ParticlePool(scene, bitGeo, bitMat, 220, { colors: true });

    const starGeo = new THREE.OctahedronGeometry(0.04, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffe07a });
    this.stars = new ParticlePool(scene, starGeo, starMat, 80);

    const dustGeo = new THREE.IcosahedronGeometry(0.06, 0);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xf3e2cc, transparent: true, opacity: 0.75, depthWrite: false });
    this.dust = new ParticlePool(scene, dustGeo, dustMat, 80);

    // 床のしみ（土・水）
    this.decals = [];
    this.decalGroup = new THREE.Group();
    scene.add(this.decalGroup);

    // 考えごとの吹き出し
    this.bubble = new THREE.Group();
    this.bubble.visible = false;
    this.bubbleSprites = {};
    scene.add(this.bubble);
    this.bubbleKey = null;
    this.bubbleT = 0;

    // Zzz
    this.zzz = makeTextSprite((ctx, w, h) => {
      ctx.font = '800 64px sans-serif';
      ctx.fillStyle = '#7b8fc9';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 10;
      ctx.textAlign = 'center';
      ctx.strokeText('Zzz', w / 2, h * 0.65);
      ctx.fillText('Zzz', w / 2, h * 0.65);
    }, 160, 96, 0.17);
    this.zzz.material.depthTest = true;
    this.zzz.visible = false;
    scene.add(this.zzz);

    // つかめる対象のリング
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringT = 0;

    // 初回ガイドの矢印
    this.guide = makeTextSprite((ctx, w, h) => {
      ctx.fillStyle = '#f08c78';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.25, h * 0.2); ctx.lineTo(w * 0.75, h * 0.2); ctx.lineTo(w * 0.75, h * 0.45);
      ctx.lineTo(w * 0.92, h * 0.45); ctx.lineTo(w * 0.5, h * 0.88); ctx.lineTo(w * 0.08, h * 0.45); ctx.lineTo(w * 0.25, h * 0.45);
      ctx.closePath();
      ctx.stroke(); ctx.fill();
    }, 96, 96, 0.28);
    this.guide.visible = false;
    scene.add(this.guide);
    this.guideTarget = null;
    this.t = 0;
  }

  _bubble(key) {
    if (!this.bubbleSprites[key]) {
      const icon = ICONS[key] || key;
      const sp = makeTextSprite((ctx, w, h) => {
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.strokeStyle = 'rgba(200,170,150,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.4, w * 0.4, h * 0.33, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(w * 0.22, h * 0.8, w * 0.07, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(w * 0.1, h * 0.93, w * 0.04, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = `${Math.round(h * 0.38)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(icon, w * 0.55, h * 0.42);
      }, 128, 128, 0.42);
      this.bubbleSprites[key] = sp;
      this.bubble.add(sp);
    }
    return this.bubbleSprites[key];
  }

  showBubble(key, pos) {
    if (!key) { this.bubble.visible = false; this.bubbleKey = null; return; }
    if (this.bubbleKey !== key) {
      for (const k in this.bubbleSprites) this.bubbleSprites[k].visible = false;
      this._bubble(key).visible = true;
      this.bubbleKey = key;
      this.bubbleT = 0;
    }
    this.bubble.visible = true;
    this.bubble.position.copy(pos);
  }

  showRing(pos, r, color = 0xffffff) {
    if (!pos) { this.ring.visible = false; return; }
    this.ring.visible = true;
    this.ring.position.set(pos.x, 0.02, pos.z);
    this.ring.userData.r = r;
    this.ring.material.color.setHex(color);
  }

  setGuide(pos) { this.guideTarget = pos; this.guide.visible = !!pos; }

  // ---- 放出系 ----
  fluffBurst(pos, n = 6, power = 1.5, persist = true) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.3, 1) * power;
      this.fluff.spawn({
        pos, vel: new THREE.Vector3(Math.cos(a) * sp, rand(0.8, 2.2) * power * 0.7, Math.sin(a) * sp),
        size: rand(0.6, 1.4), gravity: 2.2, drag: 1.6, life: 3, persist, spin: 3, flat: 0.5,
      });
    }
  }
  bitsBurst(pos, n, colors, power = 2, persist = true, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.3, 1) * power;
      this.bits.spawn({
        pos, vel: new THREE.Vector3(Math.cos(a) * sp, rand(1, 3) * power * 0.5, Math.sin(a) * sp),
        size: rand(0.6, 1.3) * size, gravity: 9.8, drag: 0.8, life: 2, persist, spin: 10, flat: 0.3,
        color: colors[i % colors.length],
      });
    }
  }
  sparkle(pos, n = 8, spread = 0.4) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3(rand(-spread, spread), rand(0, spread), rand(-spread, spread)));
      this.stars.spawn({ pos: p, vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1.2), rand(-0.3, 0.3)), size: rand(0.6, 1.3), gravity: 0.3, drag: 1.5, life: rand(0.5, 0.9), spin: 8 });
    }
  }
  dustPuff(pos, n = 5, power = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      this.dust.spawn({
        pos: pos.clone().setY(0.05), vel: new THREE.Vector3(Math.cos(a) * power, rand(0.1, 0.5), Math.sin(a) * power),
        size: rand(0.6, 1.2), grow: 1.2, gravity: -0.2, drag: 3, life: 0.55, spin: 2,
      });
    }
  }
  spill(pos, color, r = 0.4, seed = 1) {
    const shape = new THREE.Shape();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.7 + 0.3 * Math.abs(Math.sin(a * 3 + seed)) + 0.1 * Math.sin(a * 7 + seed * 2));
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(shape);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.92, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.008 + this.decals.length * 0.0005, pos.z);
    m.scale.setScalar(0.2);
    m.receiveShadow = true;
    m.userData.grow = 0;
    m.renderOrder = 1;
    this.decalGroup.add(m);
    this.decals.push(m);
  }

  // ---- 画面上のポップアップ ----
  popup(worldPos, text, cls = '') {
    if (this.popCount > 26) return;
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el.textContent = text;
    const p = { el, pos: worldPos.clone() };
    if (!this._placePop(p)) return;
    this.popLayer.appendChild(el);
    this.popCount++;
    this.pops = this.pops || [];
    this.pops.push(p);
    el.addEventListener('animationend', () => {
      el.remove();
      this.popCount--;
      this.pops.splice(this.pops.indexOf(p), 1);
    });
  }
  /** ポップアップはワールド座標に追従させる（カメラが動いてもずれない） */
  _placePop(p) {
    _v.copy(p.pos).project(this.camera);
    if (_v.z > 1) return false;
    p.el.style.left = ((_v.x * 0.5 + 0.5) * window.innerWidth).toFixed(1) + 'px';
    p.el.style.top = ((-_v.y * 0.5 + 0.5) * window.innerHeight).toFixed(1) + 'px';
    return true;
  }

  update(dt, dogHeadPos, sleeping) {
    this.t += dt;
    if (this.pops) for (const p of this.pops) this._placePop(p);
    this.fluff.update(dt);
    this.bits.update(dt);
    this.stars.update(dt);
    this.dust.update(dt);
    for (const d of this.decals) {
      if (d.userData.grow < 1) {
        d.userData.grow = Math.min(1, d.userData.grow + dt * 3);
        d.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - d.userData.grow, 3)));
      }
    }
    if (this.ring.visible) {
      this.ringT += dt;
      const r = this.ring.userData.r * (1 + 0.08 * Math.sin(this.ringT * 6));
      this.ring.scale.set(r, r, r);
    }
    if (this.bubble.visible) {
      this.bubbleT += dt;
      const s = Math.min(1, this.bubbleT * 5);
      this.bubble.scale.setScalar(s * (1 + 0.04 * Math.sin(this.t * 3)));
    }
    if (this.guideTarget) {
      this.guide.position.copy(this.guideTarget);
      this.guide.position.y += 0.1 * Math.sin(this.t * 5);
    }
    this.zzz.visible = !!sleeping;
    if (sleeping && dogHeadPos) {
      this.zzz.position.copy(dogHeadPos).add(new THREE.Vector3(0.18, 0.22 + 0.05 * Math.sin(this.t * 2), 0));
      this.zzz.material.opacity = 0.6 + 0.4 * Math.sin(this.t * 2);
    }
  }

  clear() {
    this.fluff.clear(); this.bits.clear(); this.stars.clear(); this.dust.clear();
    for (const d of this.decals) { d.geometry.dispose(); d.material.dispose(); this.decalGroup.remove(d); }
    this.decals.length = 0;
    this.popLayer.innerHTML = '';
    this.popCount = 0;
    this.pops = [];
    this.showBubble(null);
    this.showRing(null);
    this.setGuide(null);
  }
}
