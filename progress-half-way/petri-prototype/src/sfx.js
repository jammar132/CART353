// =============================================================
// sfx.js tiny WebAudio synth
// Every symbol has its own two-note call; each creature's
// "voice" gene shifts the pitch, so dialects SOUND different too.
// Off by default (browsers block audio until a click) — press M.
// =============================================================

const SFX = {
  ctx: null,
  master: null,
  on: false,
  _count: 0,
  _windowStart: 0,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.12;
    this.master.connect(this.ctx.destination);
  },

  toggle() {
    this.init();
    if (!this.ctx) return false;
    this.on = !this.on;
    if (this.on && this.ctx.state === 'suspended') this.ctx.resume();
    return this.on;
  },

  // avoid a wall of noise when hundreds of creatures talk at once
  _budget(max = 5) {
    const now = performance.now();
    if (now - this._windowStart > 400) { this._windowStart = now; this._count = 0; }
    if (this._count >= max) return false;
    this._count++;
    return true;
  },

  _tone(freq, start, dur, type = 'square', vol = 0.25, slideTo = null, pan = 0) {
    const t0 = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = U.clamp(pan, -1, 1);
      gain.connect(p); node = p;
    }
    osc.connect(gain);
    node.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  chirp(symbol, voice, pan = 0) {
    if (!this.on || !this._budget()) return;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const base = 320 * Math.pow(2, voice * 1.2);
    const n1 = scale[symbol % 8], n2 = scale[(symbol * 3 + 2) % 8];
    const f = (n) => base * Math.pow(2, n / 12);
    const type = symbol >= 8 ? 'triangle' : 'square';
    this._tone(f(n1), 0, 0.06, type, 0.18, null, pan);
    this._tone(f(n2), 0.07, 0.07, type, 0.18, null, pan);
  },

  birth(pan = 0) { if (this.on && this._budget(6)) this._tone(500, 0, 0.12, 'sine', 0.2, 1200, pan); },
  death(pan = 0) { if (this.on && this._budget(6)) this._tone(300, 0, 0.35, 'triangle', 0.22, 70, pan); },
  place() { if (this.on && this._budget(8)) this._tone(220, 0, 0.05, 'square', 0.1, 180); },
  startle() { if (this.on) { this._tone(90, 0, 0.3, 'sawtooth', 0.25, 40); this._tone(1400, 0, 0.08, 'square', 0.08, 300); } },
  hum() { if (this.on) { this._tone(55, 0, 2.5, 'sine', 0.3, 52); this._tone(110.5, 0, 2.5, 'sine', 0.12, 104); } },
};
