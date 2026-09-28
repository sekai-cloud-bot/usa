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
const PENTA = [0, 2, 4, 7, 9];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgmOn = false;
    this.bgmStep = 0;
    this.bgmNext = 0;
    this.bgmTimer = null;
    this.bgmLevel = 1;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
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
      this.bgmFilter.frequency.value = 5000;
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
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
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
      case 'quack': this._osc('sawtooth', 320, 260, 0.14, 0.07); this._noise('bandpass', 900, 3, 0.12, 0.08); break;
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
    } else if (step % 8 === 4) {
      const b = BASS[Math.floor(step / 8) % BASS.length];
      mk(mtof(b + 7), 0.25, 1.0, 'triangle');
    }
  }
  stopBgm(fade = 0.6) {
    if (!this.ctx || !this.bgmOn) return;
    this.bgmOn = false;
    clearInterval(this.bgmTimer);
    this.bgm.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
  }
  setBgmMood(mood) {
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
