// すべての効果音・BGMは WebAudio でその場で合成（外部素材なし）

const MELODY = [
  76, null, 79, null, 81, 79, 76, null,
  84, null, 81, null, 79, null, 76, null,
  74, null, 77, null, 81, null, 79, 77,
  76, null, 74, null, 79, null, null, null,
  76, 79, 84, null, 86, 84, 81, null,
  79, null, 76, null, 81, null, 79, null,
  77, null, 81, null, 84, null, 81, null,
  79, null, 74, null, 72, null, null, null,
];
const BASS = [48, 45, 41, 43, 48, 45, 41, 43];

// くり返しの曲（町の人が演奏している）[音, 拍]
const arp = (chords, pattern = [0, 2, 3, 1, 4, 1, 3, 2]) => chords.flatMap((c) => pattern.map((i) => [c[i % c.length], 0.5]));
const LOOPS = {
  harmonica: {
    voice: 'harmonica', bpm: 84, vol: 0.1,
    notes: [[64, 1], [67, 1], [69, 1], [67, 1], [64, 1], [62, 1], [60, 2], [62, 1], [64, 1], [67, 1], [64, 1], [62, 4],
      [64, 1], [67, 1], [69, 1], [72, 1], [69, 1], [67, 1], [64, 2], [62, 1], [64, 1], [62, 1], [60, 1], [null, 4]],
  },
  guitar: {
    voice: 'pluck', bpm: 100, vol: 0.13, legato: 1.6,
    notes: arp([[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]]),
  },
  yakiimo: {
    voice: 'voice', bpm: 60, vol: 0.1,
    notes: [[69, 1.4], [67, 0.4], [69, 0.9], [null, 0.3], [67, 0.35], [64, 0.35], [67, 1.8], [null, 1.2], [67, 0.5], [64, 0.5], [67, 2.2], [null, 5]],
  },
};
// 1回だけの曲
const TUNES = {
  // 5時のチャイム（オリジナルの旋律）
  chime: {
    voice: 'bell', bpm: 84, vol: 0.12,
    notes: [[67, 1], [69, 1], [72, 1], [69, 1], [67, 1], [64, 1], [67, 2], [72, 1], [74, 1], [76, 1], [74, 1], [72, 1], [69, 1], [67, 2],
      [69, 1], [72, 1], [74, 1], [72, 1], [69, 1], [67, 1], [64, 2], [67, 1], [69, 1], [67, 1], [64, 1], [62, 2], [60, 3]],
  },
  harmonicaSolo: {
    voice: 'harmonica', bpm: 76, vol: 0.13,
    notes: [[67, 1], [69, 0.5], [72, 0.5], [74, 1.5], [72, 0.5], [69, 1], [67, 1], [64, 1], [67, 1], [69, 1], [72, 1], [69, 0.5], [67, 0.5], [64, 1], [62, 1.5], [60, 2.5]],
  },
  busker: {
    voice: 'pluck', bpm: 112, vol: 0.16, strum: true, legato: 1.4,
    notes: [[43, 50, 55, 59, 62, 67], [50, 57, 62, 66, 69], [40, 47, 52, 55, 59, 64], [48, 52, 55, 60, 64, 67]].flatMap((c) => [[c, 1], [c, 0.5], [c, 0.5], [c, 1], [c, 1]]).concat([[[43, 50, 55, 59, 62, 67], 2]]),
  },
};
const PENTA = [0, 2, 4, 7, 9];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// 生き物の声などは、短い間に何度も鳴らすと重なってうるさいので間引く（秒）
const MIN_GAP = { meow: 0.7, caw: 0.9, coo: 0.4, quack: 0.5, chirp: 0.25, flap: 0.3, horn: 0.6, peep: 0.18 };

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgmOn = false;
    this.bgmStep = 0;
    this.bgmNext = 0;
    this.bgmTimer = null;
    this.bgmLevel = 1;
    this.lastPlay = {};
  }

  unlock() {
    if (!this.ctx) {
      if (!this._build()) return;
      this._watch();
    }
    // タップの中なら すぐ鳴る。タップの外（「もういちど」の 読み込みなおし など）なら、鳴るまで ためして 案内を出す
    if (this.ctx.state !== 'running') { this._kick(); this._retry(); }
  }

  /** 音の部品を作る（作りなおす時も、音量・BGMの こもり具合は そのまま） */
  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.gen = (this.gen || 0) + 1;
    ctx.onstatechange = () => this._stateChanged(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = this._vol();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.bgm = ctx.createGain();
    this.bgm.gain.value = 0.0;
    this.bgmFilter = ctx.createBiquadFilter();
    this.bgmFilter.type = 'lowpass';
    this.bgmFilter.frequency.value = this.mood === 'sleep' ? 900 : 5000;
    // ほんのりエコー
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.bgm.connect(this.bgmFilter);
    this.bgmFilter.connect(this.master);
    this.bgmFilter.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  /**
   * 作りなおす（iPhone の Safari は、別のアプリやタブから戻ると、止まったまま
   * 再開できなかったり、動いているのに 音が出なかったりするため）。
   * 鳴っていた BGM・環境音・町の曲は、新しい部品で つづきから鳴らす
   */
  _rebuild() {
    const old = this.ctx;
    const amb = this.amb ? { ...this.ambLv } : null;
    // 作れなかった時（数の上限 など）は、いまの部品の まま。次の タップで もう一度
    try { if (!this._build()) return; } catch (e) { this.ctx = old; return; }
    this.amb = null;
    if (old) old.onstatechange = null;
    try { if (old && old.close && old.state !== 'closed') Promise.resolve(old.close()).catch(() => {}); } catch (e) { /* noop */ }
    if (this.bgmOn) {
      this.bgm.gain.value = 0.11 * this.bgmLevel;
      this.bgmNext = this.ctx.currentTime + 0.1;
    }
    for (const L of this.loops || []) { L.gain = null; L.out = null; L.next = 0; }
    this.lastPlay = {};
    this.stallN = 0;
    this.stalled = false;
    this.lastCT = null;
    if (amb) { this.startAmbience(); this.setAmbience(amb); }
    this._kick();
  }

  /** タップの中で：無音の音を1つ鳴らして、音の出口を ひらく（iOS） */
  _kick() {
    const ctx = this.ctx;
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* noop */ }
    if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch((e) => this.log('resume× ' + (e && e.name)));
  }

  _resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || document.hidden) return;
    ctx.resume().catch((e) => this.log('resume× ' + (e && e.name)));
  }

  /**
   * 止まっている間、しばらく くり返し 鳴らし直してみる。
   * 戻ってすぐは アプリが まだ前に出きっていなくて 失敗するので、1回では足りない。
   * それでも もどらない時（iPhone は タップしないと もどせないことがある）は「タップ」の案内を出す
   */
  _retry() {
    if (this.retryT) return;
    let n = 0;
    const id = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || document.hidden || ctx.state === 'running' || ++n > 40) {
        clearInterval(id);
        if (this.retryT === id) this.retryT = null;
        return;
      }
      ctx.resume().catch(() => {});
      if (n === 4) { this.log('retry: まだ止まっている'); this._needTap(true); }
    }, 300);
    this.retryT = id;
    this._resume();
  }

  /** 「タップで 音が でます」の案内（onNeedTap に知らせる） */
  _needTap(on) {
    on = !!(on && this.enabled && this.ctx && !document.hidden);
    if (on === this.tapShown) return;
    this.tapShown = on;
    this.log(on ? '案内を出す' : '案内を消す');
    if (this.onNeedTap) this.onNeedTap(on);
  }

  /** 音の状態が かわった（ブラウザに止められた時は、すぐ もどしにいく） */
  _stateChanged(ctx) {
    if (ctx !== this.ctx) return;
    this.log('state');
    if (ctx.state === 'running') { this.stallN = 0; this.stalled = false; this._needTap(false); }
    else if (ctx.state !== 'closed' && !document.hidden && !this.hiddenNow) this._retry();
  }

  /** 0.5秒ごと：止まっていないか、時間が すすまずに 黙っていないか、ページが ねむっていなかったか */
  _tick() {
    const now = performance.now(), gap = now - (this.lastTick || now);
    this.lastTick = now;
    const ctx = this.ctx;
    if (!ctx || document.hidden) { this.lastCT = null; return; }
    // しばらく うごいていなかった（タブや アプリの うらに いた）
    if (gap > 2500) this._retry();
    if (ctx.state === 'running') {
      const ct = ctx.currentTime;
      if (this.lastCT != null) {
        // 動いていることになっているのに 時間が すすまない＝音が出ていない
        this.stallN = ct - this.lastCT < (gap / 1000) * 0.25 ? (this.stallN || 0) + 1 : 0;
        const was = this.stalled;
        this.stalled = this.stallN >= 3;
        if (this.stalled && !was) this.log('時間が すすまない');
        this._needTap(this.stalled);
      }
      this.lastCT = ct;
    } else {
      this.lastCT = null;
      this._retry();
    }
  }

  /**
   * タップした時（本当の「ふれた」）：ここでなら、どのブラウザでも 鳴らし直せる。
   * iPhone は、止められた音を 再開できないことがあるので 作りなおす（タップの中なら 鳴りだす）。
   * ※ スティックや カメラを うごかす「なぞり」は タップに ならないので、ここでは 作りなおさない
   *   （なぞりで作りなおすと、新しい音も タップ待ちで 止まったままに なる）
   */
  tap(force = false) {
    if (!this.ctx || document.hidden) return;
    // iPhone は、別の画面から 戻って はじめての タップでは、動いているように 見えても 作りなおす
    // （「動いていて 時間も すすむのに、音が出ない」ことがあり、それは 外からは わからないため）
    force = force || (this.ios && this.backTap);
    if (!force && this.ctx.state === 'running' && !this.stalled) return;
    // 1回の タップで touchend・mousedown・click（と 案内の ボタン）が つづけて来る。
    // 作りなおしたばかりの 音は、動きだすまで 少しのあいだ「止まっている」ので、
    // そこで また作りなおすと 動きだす前に こわしてしまう。しばらくは 再開を たのむだけに
    const now = performance.now();
    if (now - (this.rebuiltAt || 0) < 1000) { this._kick(); return; }
    if (force || this.ios || this.stalled || this.kickFailed) {
      this.kickFailed = false;
      this.backTap = false;
      this.rebuiltAt = now;
      this._rebuild();
      this.log('作りなおし');
      return;
    }
    this._kick();
    clearTimeout(this.kickT);
    this.kickT = setTimeout(() => { if (this.ctx.state !== 'running') this.kickFailed = true; }, 500);
  }
  /** 「音が でない時」の ボタン：動いているように 見えても 作りなおす（タップの中で 呼ぶ） */
  repair() { this.log('音をなおす'); this.tap(true); }
  /** タップではない ふれ方（なぞり など）：再開だけ ためす */
  _poke() {
    const now = performance.now();
    if (!this.ctx || document.hidden || this.ctx.state === 'running' || now - (this.pokeT || 0) < 250) return;
    this.pokeT = now;
    this.ctx.resume().catch(() => {});
  }

  // 別のタブやアプリへ行くとブラウザが音を止めるので、戻ってきたら鳴らし直す
  _watch() {
    const ua = navigator.userAgent || '';
    this.ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    // 離れる時：iPhone は 自分で止めず（ブラウザが止めて、戻った時に ブラウザが 動かしなおせるように）、
    // 音量だけ 0 に。ほかは 止める
    const leave = () => {
      if (this.hiddenNow) return;
      this.hiddenNow = true;
      this.log('離れた');
      this._needTap(false);
      if (this.ios) { this._mute(true); this.backTap = true; }
      else if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    };
    const back = () => {
      if (document.hidden) return;
      if (this.hiddenNow) this.log('戻った');
      this.hiddenNow = false;
      this.lastCT = null;
      this._mute(false);
      this._retry();
    };
    document.addEventListener('visibilitychange', () => (document.hidden ? leave() : back()));
    addEventListener('pagehide', leave);
    addEventListener('pageshow', back);
    addEventListener('focus', back);
    // タップかどうか：iOS は、ほとんど うごかさずに はなした時だけが「タップ」
    const starts = new Map();
    const opt = { capture: true, passive: true };
    addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) starts.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now() });
      this._poke();
    }, opt);
    addEventListener('touchmove', () => this._poke(), opt);
    addEventListener('touchend', (e) => {
      let tap = false;
      for (const t of e.changedTouches) {
        const s0 = starts.get(t.identifier);
        starts.delete(t.identifier);
        if (s0 && Math.hypot(t.clientX - s0.x, t.clientY - s0.y) < 14 && performance.now() - s0.t < 800) tap = true;
      }
      // ほとんど うごかさずに はなした時だけ。userActivation は 少し前の タップでも しばらく true のままなので、それだけでは きめない
      const act = navigator.userActivation;
      if (tap && (!act || act.isActive)) this.tap();
      else this._poke();
    }, opt);
    for (const ev of ['click', 'mousedown', 'keydown']) addEventListener(ev, () => this.tap(), opt);
    this.lastTick = performance.now();
    setInterval(() => this._tick(), 500);
    // 調べ用：URL に ?oto を つけると、音の記録を 画面の左下に出す
    if (/[?&]oto\b/.test(location.search)) {
      this.logEl = document.createElement('pre');
      this.logEl.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;margin:0;padding:6px 8px;max-width:92vw;font:10px/1.35 monospace;color:#fff;background:rgba(0,0,0,.6);border-radius:6px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(this.logEl);
      this.log('記録 はじめ' + (this.ios ? '（iPhone）' : ''));
    }
  }

  /** 調べ用の記録（時刻・できごと・何代目の音か・状態・音の時計・画面の うら・タップ中か） */
  log(ev) {
    const c = this.ctx, act = navigator.userActivation;
    const line = `${(performance.now() / 1000).toFixed(1)} ${ev} #${this.gen || 0} ${c ? c.state : '-'} t=${c ? c.currentTime.toFixed(1) : '-'}${document.hidden ? ' うら' : ''}${act && act.isActive ? ' タップ中' : ''}`;
    (this.logs = this.logs || []).push(line);
    if (this.logs.length > 40) this.logs.shift();
    if (this.logEl) this.logEl.textContent = this.logs.slice(-16).join('\n');
  }

  /** 全体の音量（オフ・ほかの画面にいる間は 0、話の間は 小さく） */
  _vol() { return this.enabled && !this.muted ? (this.ducked ? 0.25 : 0.8) : 0; }
  _mute(on) {
    if (this.muted === on) return;
    this.muted = on;
    if (!this.master) return;
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    if (on) g.setValueAtTime(0, t); else g.setTargetAtTime(this._vol(), t, 0.05);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(this._vol(), this.ctx.currentTime, 0.05);
    if (!on) this._needTap(false);
    else if (this.ctx && (this.ctx.state !== 'running' || this.stalled)) this._needTap(true);
  }

  get ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  // ---- 部品 ----
  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _osc(type, f0, f1, dur, vol, t = 0, dest = this.sfx) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain();
    this._env(g, now, 0.006, vol, dur);
    o.connect(g).connect(dest);
    o.start(now);
    o.stop(now + dur + 0.05);
    return o;
  }
  _noise(filterType, freq, q, dur, vol, t = 0, freqEnd = null) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, now);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, now, 0.005, vol, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(now, Math.random() * 0.5);
    s.stop(now + dur + 0.05);
  }

  play(name, p = 1) {
    if (!this.ok) return;
    const gap = MIN_GAP[name];
    if (gap) {
      const now = this.ctx.currentTime;
      if (now - (this.lastPlay[name] ?? -99) < gap) return;
      this.lastPlay[name] = now;
    }
    const r = Math.random;
    switch (name) {
      case 'grab': this._osc('sine', 480 * p, 900 * p, 0.08, 0.22); break;
      case 'drop': this._osc('sine', 340, 170, 0.12, 0.2); break;
      case 'tissue':
        this._noise('bandpass', 2600 + r() * 1400, 1.4, 0.07, 0.16);
        break;
      case 'fluff':
        this._noise('lowpass', 900, 0.8, 0.16, 0.28);
        this._osc('sine', 190, 90, 0.12, 0.12);
        break;
      case 'burst':
        this._noise('lowpass', 1400, 0.7, 0.55, 0.5, 0, 300);
        this._osc('sine', 150, 45, 0.35, 0.4);
        this.play('sparkle');
        break;
      case 'thud':
        this._osc('sine', 150 * p, 48, 0.2, 0.5);
        this._noise('lowpass', 500, 0.8, 0.1, 0.3);
        break;
      case 'wobble':
        this._osc('triangle', 260, 220, 0.07, 0.18);
        this._osc('triangle', 240, 200, 0.07, 0.14, 0.09);
        break;
      case 'crash':
        this._noise('highpass', 1600, 0.6, 0.4, 0.35);
        for (let i = 0; i < 5; i++) this._osc('sine', 1800 + r() * 2200, 1600 + r() * 1500, 0.12, 0.1, r() * 0.12);
        this._osc('sine', 130, 50, 0.18, 0.35);
        break;
      case 'plant':
        this._osc('sine', 120, 45, 0.25, 0.55);
        this._noise('bandpass', 700, 0.9, 0.35, 0.35);
        this._noise('highpass', 2500, 0.5, 0.2, 0.12, 0.05);
        break;
      case 'box':
        this._osc('triangle', 160 * p, 70, 0.14, 0.35);
        this._noise('bandpass', 1200, 1, 0.08, 0.2);
        break;
      case 'bounce': this._osc('sine', 420 * p, 290 * p, 0.08, 0.12 * Math.min(1, p)); break;
      case 'coin':
        this._osc('triangle', 1318, 1318, 0.07, 0.07);
        this._osc('triangle', 1976, 1976, 0.14, 0.07, 0.06);
        break;
      case 'tick': this._osc('triangle', 1568 * p, 1568 * p, 0.05, 0.06); break;
      case 'chain': {
        const n = Math.max(1, Math.min(14, p));
        for (let i = 0; i < 3; i++) {
          const k = n + i;
          const m = 72 + PENTA[k % 5] + 12 * Math.floor(k / 5);
          this._osc('triangle', mtof(m), mtof(m), 0.2, 0.13, i * 0.06);
        }
        break;
      }
      case 'fanfare':
        [72, 76, 79, 84].forEach((m, i) => this._osc('triangle', mtof(m), mtof(m), 0.28, 0.14, i * 0.08));
        this._osc('sine', mtof(88), mtof(88), 0.4, 0.06, 0.32);
        break;
      case 'bark': {
        const f = 640 * p * (0.95 + r() * 0.1);
        const ctx = this.ctx, now = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.9, now);
        o.frequency.linearRampToValueAtTime(f * 1.15, now + 0.03);
        o.frequency.exponentialRampToValueAtTime(f * 0.62, now + 0.16);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.6;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3200;
        const g = ctx.createGain();
        this._env(g, now, 0.012, 0.42, 0.17);
        o.connect(bp).connect(lp).connect(g).connect(this.sfx);
        o.start(now); o.stop(now + 0.25);
        break;
      }
      case 'whine': this._osc('sine', 900, 1300, 0.25, 0.08); this._osc('sine', 1300, 800, 0.2, 0.06, 0.25); break;
      case 'whoosh': this._noise('bandpass', 400, 1.2, 0.28, 0.22, 0, 2400); break;
      case 'chew':
        this._noise('bandpass', 1700, 2, 0.05, 0.22);
        this._noise('bandpass', 1300, 2, 0.05, 0.18, 0.08);
        break;
      case 'step':
        this._osc('sine', 95, 55, 0.1, 0.4 * p);
        this._noise('lowpass', 280, 0.7, 0.07, 0.25 * p);
        break;
      case 'keys':
        for (let i = 0; i < 6; i++) this._osc('sine', 2600 + r() * 1800, 2400, 0.06, 0.07, i * 0.07 + r() * 0.03);
        break;
      case 'door':
        this._osc('sawtooth', 110, 80, 0.5, 0.05);
        this._osc('triangle', 300, 150, 0.12, 0.2, 0.45);
        break;
      case 'sparkle':
        [88, 91, 95].forEach((m, i) => this._osc('sine', mtof(m), mtof(m), 0.25, 0.05, i * 0.05));
        break;
      case 'snore':
        this._noise('lowpass', 380, 0.8, 0.9, 0.08);
        break;
      case 'surprise': this._osc('sine', 500, 1100, 0.12, 0.12); break;
      case 'ok': this._osc('triangle', mtof(79), mtof(79), 0.1, 0.1); this._osc('triangle', mtof(84), mtof(84), 0.16, 0.1, 0.08); break;
      case 'ui': this._osc('sine', 700, 900, 0.05, 0.09); break;
      case 'shutter':
        this._noise('highpass', 3000, 0.7, 0.04, 0.35);
        this._osc('square', 1800, 900, 0.03, 0.05);
        this._noise('bandpass', 1800, 1.5, 0.05, 0.25, 0.07);
        break;
      case 'pop':
        this._osc('sine', 300, 700, 0.09, 0.25);
        this._noise('bandpass', 900, 1, 0.06, 0.15);
        break;
      case 'call':
        this._osc('triangle', mtof(81), mtof(81), 0.12, 0.12);
        this._osc('triangle', mtof(88), mtof(88), 0.2, 0.12, 0.1);
        break;
      case 'static': this._noise('bandpass', 2400, 0.4, 0.4, 0.12); break;
      case 'ping': this._osc('sine', 1320, 1320, 0.12, 0.08); this._osc('sine', 1760, 1760, 0.16, 0.07, 0.1); break;
      case 'doorbell':
        this._osc('sine', mtof(76), mtof(76), 0.9, 0.22);
        this._osc('sine', mtof(72), mtof(72), 1.3, 0.22, 0.45);
        break;
      case 'crunch':
        for (let i = 0; i < 3; i++) this._noise('bandpass', 2200 + r() * 800, 2, 0.04, 0.2, i * 0.09);
        break;
      case 'yawn': this._osc('sine', 520, 300, 0.9, 0.05); break;
      // ---- 冒険版 ----
      case 'jump': this._osc('sine', 330, 620, 0.1, 0.1); this._noise('bandpass', 900, 1, 0.06, 0.06); break;
      case 'land':
        this._osc('sine', 120, 60, 0.1, 0.25 * p);
        this._noise('lowpass', 420, 0.8, 0.08, 0.2 * p);
        break;
      case 'dig':
        for (let i = 0; i < 2; i++) this._noise('bandpass', 700 + r() * 600, 1.2, 0.07, 0.22, i * 0.09);
        break;
      case 'meow': {
        const ctx = this.ctx, now = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(620 * p, now);
        o.frequency.linearRampToValueAtTime(980 * p, now + 0.14);
        o.frequency.exponentialRampToValueAtTime(520 * p, now + 0.5);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2.2;
        const g = ctx.createGain();
        this._env(g, now, 0.05, 0.18, 0.45);
        o.connect(bp).connect(g).connect(this.sfx);
        o.start(now); o.stop(now + 0.6);
        break;
      }
      case 'caw':
        for (let i = 0; i < 2; i++) {
          this._osc('sawtooth', 520, 380, 0.22, 0.09, i * 0.3);
          this._noise('bandpass', 1100, 3, 0.2, 0.12, i * 0.3);
        }
        break;
      case 'coo': this._osc('sine', 380, 320, 0.25, 0.06); this._osc('sine', 400, 300, 0.3, 0.05, 0.28); break;
      case 'flap':
        for (let i = 0; i < 10; i++) this._noise('bandpass', 500 + r() * 900, 0.8, 0.07, 0.16 * p, i * 0.045 + r() * 0.03);
        break;
      case 'horn':
        this._osc('square', 392, 392, 0.32, 0.05);
        this._osc('square', 494, 494, 0.32, 0.04);
        break;
      case 'whistle':
        this._osc('sine', 2600, 2700, 0.18, 0.09);
        this._osc('sine', 2600, 2750, 0.35, 0.09, 0.24);
        break;
      case 'chime':
        [76, 72, 74, 67, 67, 74, 76, 72].forEach((m, i) => this._osc('sine', mtof(m), mtof(m), 0.7, 0.11, i * 0.42));
        break;
      case 'crossing':
        this._osc('square', 2100, 2100, 0.05, 0.03);
        this._osc('square', 1500, 1500, 0.06, 0.03, 0.1);
        break;
      case 'slide': this._noise('bandpass', 600, 1, 0.9, 0.18, 0, 2200); this._osc('sine', 700, 1100, 0.8, 0.05); break;
      case 'splash':
        this._noise('lowpass', 1800, 0.7, 0.4, 0.35, 0, 400);
        for (let i = 0; i < 6; i++) this._osc('sine', 900 + r() * 1400, 500, 0.08, 0.04, r() * 0.2);
        break;
      case 'chirp':
        for (let i = 0; i < 3; i++) this._osc('sine', 3200 + r() * 900, 2600 + r() * 600, 0.07, 0.03 * p, i * 0.11);
        break;
      case 'quack': this._osc('sawtooth', 320 * p, 260 * p, 0.14, 0.07); this._noise('bandpass', 900, 3, 0.12, 0.08); break;
      case 'mora':
        // 「だるまさんが ころんだ」の1音（子どもの声）。p は音の高さ（半音）
        this._voice('voice', mtof(76 + p), this.ctx.currentTime + 0.01, 0.12, 0.085, this.sfx);
        break;
      case 'buzz':
        // うごいた〜！：ぶっぶー
        this._osc('square', 330, 320, 0.12, 0.05);
        this._osc('square', 247, 240, 0.22, 0.05, 0.16);
        break;
      case 'peep':
        // ひなの声：ピヨピヨ
        for (let i = 0; i < 2; i++) this._osc('sine', 2500 * p, 3300 * p, 0.07, 0.07, i * 0.12);
        break;
      // ---- できごと ----
      case 'suzu':
        // 神社の鈴：ガラガラと鳴る高い金属の粒
        for (let i = 0; i < 9; i++) {
          const f = (2300 + r() * 1700) * p;
          this._osc('sine', f, f * 0.98, 0.35 + r() * 0.3, 0.035, r() * 0.28);
          this._osc('sine', f * 2.76, f * 2.7, 0.2, 0.012, r() * 0.28);
        }
        this._noise('bandpass', 5200, 2, 0.3, 0.05);
        break;
      case 'kalan':
        // 福引きの手ベル：カランカラーン
        for (let k = 0; k < 4; k++) {
          const f = k % 2 ? 1180 : 1320;
          for (const [m, v] of [[1, 0.09], [2.76, 0.04], [5.4, 0.02]]) this._osc('sine', f * m, f * m, 0.7, v, k * 0.2);
        }
        break;
      case 'gara':
        this._noise('bandpass', 2200 + r() * 800, 3, 0.06, 0.12);
        this._osc('triangle', 900 + r() * 300, 700, 0.04, 0.05, 0.03);
        break;
      case 'clap2':
        this._noise('bandpass', 1300, 1.2, 0.05, 0.4);
        this._noise('highpass', 2400, 0.8, 0.03, 0.2, 0.01);
        break;
      case 'crowd':
        for (let i = 0; i < 38; i++) this._noise('bandpass', 1100 + r() * 900, 1.3, 0.04, 0.08 + r() * 0.08, r() * 2.4);
        break;
      case 'capsule':
        this._osc('triangle', 1400, 900, 0.05, 0.1);
        this._noise('bandpass', 3000, 2, 0.05, 0.15, 0.04);
        this._osc('sine', 500, 800, 0.08, 0.1, 0.12);
        break;
      case 'catch':
        this._osc('sine', 520, 1040, 0.08, 0.16);
        [84, 88, 91].forEach((m, i) => this._osc('triangle', mtof(m), mtof(m), 0.18, 0.07, 0.05 + i * 0.05));
        break;
      case 'rustle':
        this._noise('highpass', 2200, 0.6, 0.9, 0.2, 0, 5000);
        this._noise('bandpass', 900, 0.7, 0.6, 0.12, 0.1);
        break;
      case 'memory':
        [79, 83, 86, 91].forEach((m, i) => this._osc('sine', mtof(m), mtof(m), 0.5, 0.06, i * 0.07));
        this._osc('triangle', mtof(74), mtof(74), 0.7, 0.05);
        break;
      // ---- おたから ----
      case 'sniffhit':
        // くんくんで「あやしいにおい」を見つけた：ぽわん
        this._osc('sine', mtof(81), mtof(88), 0.18, 0.05);
        this._osc('sine', mtof(93), mtof(93), 0.25, 0.03, 0.09);
        break;
      case 'treasure':
        // ほり出した：ちいさなファンファーレと きらきら
        [76, 80, 83, 88].forEach((m, i) => this._osc('triangle', mtof(m), mtof(m), 0.24, 0.11, i * 0.07));
        [95, 100].forEach((m, i) => this._osc('sine', mtof(m), mtof(m), 0.35, 0.035, 0.3 + i * 0.06));
        break;
      case 'howl': {
        // 犬の遠吠え：すべりあがって、ゆれながら下がる
        const ctx = this.ctx, now = ctx.currentTime;
        const base = 520 * p;
        for (const [type, mul, vol] of [['sawtooth', 1, 0.07], ['sine', 2, 0.05]]) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.setValueAtTime(base * 0.8 * mul, now);
          o.frequency.linearRampToValueAtTime(base * 1.35 * mul, now + 0.35);
          o.frequency.linearRampToValueAtTime(base * 1.25 * mul, now + 0.9);
          o.frequency.exponentialRampToValueAtTime(base * 0.9 * mul, now + 1.4);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5.5;
          const lg = ctx.createGain();
          lg.gain.value = base * 0.025 * mul;
          lfo.connect(lg).connect(o.frequency);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(vol * 3, now + 0.25);
          g.gain.setValueAtTime(vol * 3, now + 1.0);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
          o.connect(bp).connect(g).connect(this.sfx);
          o.start(now); o.stop(now + 1.6);
          lfo.start(now); lfo.stop(now + 1.6);
        }
        break;
      }
      case 'train': {
        // 走ってくる電車：低いうなりと、線路の継ぎ目の音
        const ctx = this.ctx, now = ctx.currentTime;
        const dur = 7 * p;
        const src = ctx.createBufferSource();
        src.buffer = this.noise; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.35, now + dur * 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(now); src.stop(now + dur + 0.1);
        for (let i = 0; i < 16; i++) {
          const t = dur * 0.2 + i * 0.26 + (i % 2) * 0.08;
          if (t < dur * 0.85) this._osc('sine', 110, 60, 0.08, 0.09, t);
        }
        break;
      }
    }
  }

  // ---- BGM ----
  startBgm() {
    if (!this.ctx) return;
    if (this.bgmOn) return;
    this.bgmOn = true;
    this.bgmNext = this.ctx.currentTime + 0.1;
    this.bgm.gain.setTargetAtTime(0.11 * this.bgmLevel, this.ctx.currentTime, 0.8);
    const tick = () => {
      if (!this.bgmOn) return;
      const spb = 60 / 84 / 2; // 8分音符
      // 止まっていた間の音を、まとめて鳴らさない
      if (this.bgmNext < this.ctx.currentTime) this.bgmNext = this.ctx.currentTime + 0.05;
      while (this.bgmNext < this.ctx.currentTime + 0.25) {
        this._bgmNote(this.bgmStep, this.bgmNext);
        this.bgmStep = (this.bgmStep + 1) % MELODY.length;
        this.bgmNext += spb;
      }
    };
    this.bgmTimer = setInterval(tick, 90);
    tick();
  }
  _bgmNote(step, t) {
    const ctx = this.ctx;
    const m = MELODY[step];
    const mk = (freq, vol, dur, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.bgm);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (m != null) {
      mk(mtof(m), 0.5, 1.1);
      mk(mtof(m) * 2, 0.08, 0.5);
    }
    if (step % 8 === 0) {
      const b = BASS[(step / 8) % BASS.length];
      mk(mtof(b), 0.45, 1.6, 'triangle');
      // やわらかいパッド（和音をうっすら）
      const minor = b === 45 || b === 50;
      const chord = [b + 12, b + 12 + (minor ? 3 : 4), b + 19];
      const spb = 60 / 84 / 2;
      for (const n of chord) this._pad(mtof(n), t, spb * 8, 0.022);
    } else if (step % 8 === 4) {
      const b = BASS[Math.floor(step / 8) % BASS.length];
      mk(mtof(b + 7), 0.25, 1.0, 'triangle');
    }
    // シェイカー（うら拍）
    if (step % 2 === 1) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      s.connect(f).connect(g).connect(this.bgm);
      s.start(t, Math.random() * 0.5);
      s.stop(t + 0.1);
    }
  }
  _pad(freq, t, dur, vol) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.15);
    f.connect(g).connect(this.bgm);
    for (const d of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(f);
      o.start(t);
      o.stop(t + dur * 1.2);
    }
  }
  stopBgm(fade = 0.6) {
    if (!this.ctx || !this.bgmOn) return;
    this.bgmOn = false;
    clearInterval(this.bgmTimer);
    this.bgm.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
  }

  // ---- 楽器の音色 ----
  _voice(kind, freq, t, dur, vol, dest) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(dest);
    const osc = (type, f, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.start(t); o.stop(t + dur + 1.6); return o; };
    if (kind === 'harmonica') {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
      bp.connect(lp).connect(g);
      const a = osc('square', freq), b = osc('sawtooth', freq, 7);
      const lfo = osc('sine', 5.3);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(0.35, dur));
      lfo.connect(lg);
      lg.connect(a.frequency); lg.connect(b.frequency);
      a.connect(bp); b.connect(bp);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
      g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.07, dur - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    } else if (kind === 'pluck') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(3400, t);
      lp.frequency.exponentialRampToValueAtTime(520, t + 0.7);
      lp.connect(g);
      osc('sawtooth', freq).connect(lp);
      const tr = osc('triangle', freq * 2.001);
      const tg = ctx.createGain(); tg.gain.value = 0.35;
      tr.connect(tg).connect(lp);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.5, dur) + 0.9);
    } else if (kind === 'bell') {
      for (const [m, v] of [[1, 1], [2, 0.5], [3.01, 0.25], [4.17, 0.14]]) {
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, t);
        pg.gain.exponentialRampToValueAtTime(vol * v, t + 0.01);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 / m + 0.4);
        osc('sine', freq * m).connect(pg).connect(g);
      }
      g.gain.value = 1;
    } else if (kind === 'voice') {
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 760; f1.Q.value = 3;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1180; f2.Q.value = 4;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      f1.connect(lp); f2.connect(lp); lp.connect(g);
      const o = osc('sawtooth', freq);
      const lfo = osc('sine', 5.6);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(freq * 0.018, t + Math.min(0.5, dur));
      lfo.connect(lg).connect(o.frequency);
      o.connect(f1); o.connect(f2);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.09);
      g.gain.setValueAtTime(vol * 0.9, t + Math.max(0.1, dur - 0.1));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    }
  }
  _chain(kind) {
    // 楽器ごとの出口（チャイムは町のスピーカーのような響き）
    const ctx = this.ctx;
    const out = ctx.createGain();
    if (kind === 'bell') {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.5;
      const d = ctx.createDelay(1); d.delayTime.value = 0.33;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      out.connect(bp);
      bp.connect(this.sfx);
      bp.connect(d);
      d.connect(fb).connect(d);
      d.connect(this.sfx);
    } else out.connect(this.sfx);
    return out;
  }

  // ---- 曲（1回）：演奏の長さ（秒）を返す ----
  tune(name) {
    if (!this.ok) return 0;
    const T = TUNES[name];
    if (!T) return 0;
    const out = this._chain(T.voice);
    let t = this.ctx.currentTime + 0.08;
    const spb = 60 / T.bpm;
    for (const [m, beats] of T.notes) {
      if (m != null) {
        const ms = Array.isArray(m) ? m : [m];
        ms.forEach((n, i) => this._voice(T.voice, mtof(n), t + (T.strum ? i * 0.03 : 0), beats * spb * (T.legato ?? 0.95), T.vol / Math.sqrt(ms.length), out));
      }
      t += beats * spb;
    }
    const dur = t - this.ctx.currentTime;
    this._duckFor(dur);
    return dur;
  }
  _duckFor(dur) {
    this.duckUntil = Math.max(this.duckUntil || 0, performance.now() + dur * 1000);
  }

  // ---- くり返しの曲（近づくと聞こえる）----
  loop(name) {
    const L = { name, vol: 0, target: 0, idx: 0, next: 0, gain: null, out: null };
    L.setVolume = (v) => { L.target = v; };
    L.stop = () => { L.target = 0; L.dead = true; };
    this.loops = this.loops || [];
    this.loops.push(L);
    this._loopTimer();
    return L;
  }
  _loopTimer() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      if (!this.ctx || !this.loops) return;
      const ctx = this.ctx;
      let maxV = 0;
      for (const L of this.loops) {
        const T = LOOPS[L.name];
        if (!L.gain) { L.gain = ctx.createGain(); L.gain.gain.value = 0; L.out = this._chain(T.voice); L.gain.connect(L.out); }
        L.gain.gain.setTargetAtTime(L.target * (this.enabled ? 1 : 0), ctx.currentTime, 0.25);
        maxV = Math.max(maxV, L.target);
        if (L.target < 0.01 || !this.ok) { L.next = 0; continue; }
        const spb = 60 / T.bpm;
        if (L.next < ctx.currentTime) L.next = ctx.currentTime + 0.05;
        while (L.next < ctx.currentTime + 0.3) {
          const [m, beats] = T.notes[L.idx];
          if (m != null) {
            const ms = Array.isArray(m) ? m : [m];
            ms.forEach((n, i) => this._voice(T.voice, mtof(n), L.next + (T.strum ? i * 0.028 : 0), beats * spb * (T.legato ?? 0.95), T.vol / Math.sqrt(ms.length), L.gain));
          }
          L.next += beats * spb;
          L.idx = (L.idx + 1) % T.notes.length;
        }
      }
      // 曲が聞こえている間は BGM を小さく
      if (this.bgmOn) {
        const solo = performance.now() < (this.duckUntil || 0) ? 1 : 0;
        const k = 1 - Math.min(0.85, Math.max(maxV, solo) * 0.85);
        this.bgm.gain.setTargetAtTime(0.11 * this.bgmLevel * k, ctx.currentTime, 0.4);
      }
    }, 90);
  }

  // ---- 環境音（川・商店街のざわめき・風・車）----
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const ctx = this.ctx;
    const mk = (type, freq, q, lfoHz, lfoDepth) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.7 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      const m = ctx.createGain();
      m.gain.value = 1;
      s.connect(f).connect(m).connect(g).connect(this.sfx);
      if (lfoHz) {
        const l = ctx.createOscillator();
        l.frequency.value = lfoHz;
        const lg = ctx.createGain();
        lg.gain.value = lfoDepth;
        l.connect(lg).connect(m.gain);
        l.start();
      }
      s.start();
      return g;
    };
    this.amb = {
      river: mk('lowpass', 650, 0.6, 0.23, 0.35),
      // 商店街のざわめきは、ノイズだと波の音に聞こえるので使わない
      wind: mk('lowpass', 320, 0.8, 0.09, 0.6),
      traffic: mk('lowpass', 150, 0.7, 0.05, 0.3),
    };
    this.ambLv = { river: 0, wind: 0, traffic: 0 };
  }
  /** 0..1 の大きさ */
  setAmbience(lv) {
    if (!this.amb) return;
    const MAX = { river: 0.22, street: 0.09, wind: 0.1, traffic: 0.12 };
    for (const k in lv) {
      if (!this.amb[k]) continue;
      if (Math.abs((this.ambLv[k] ?? 0) - lv[k]) < 0.02) continue;
      this.ambLv[k] = lv[k];
      this.amb[k].gain.setTargetAtTime(lv[k] * MAX[k], this.ctx.currentTime, 0.6);
    }
  }
  duck(on) {
    this.ducked = on;
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this._vol(), this.ctx.currentTime, 0.15);
  }
  setBgmMood(mood) {
    this.mood = mood;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (mood === 'sleep') {
      this.bgmFilter.frequency.setTargetAtTime(900, t, 0.4);
      this.bgmLevel = 0.7;
    } else {
      this.bgmFilter.frequency.setTargetAtTime(5000, t, 0.4);
      this.bgmLevel = 1;
    }
    if (this.bgmOn) this.bgm.gain.setTargetAtTime(0.11 * this.bgmLevel, t, 0.4);
  }
}

export const audio = new Audio();
