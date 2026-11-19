// =============================================================
// utils.js; small maths, randomness and colour helpers.
// Uses Math.random so the simulation logic doesn't depend on p5.
// GENERATIVE AI USED FOR THIS FILE; CLAUDE AI TRANSLATED THE MATH
// =============================================================

const U = {
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  lerp: (a, b, t) => a + (b - a) * t,
  // rand() → [0,1), rand(a) → [0,a), rand(a,b) → [a,b)
  rand(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(U.rand(a, b)); },       // integer in [a, b)
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,

  // normally-distributed random number (mean 0, sd 1) — used for mutation
  gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },

  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
  smooth: (t) => t * t * (3 - 2 * t),

  // deterministic PRNG (mulberry32) — sprites use it so the same genome looks the same
  seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  hashInts(...nums) {
    let h = 2166136261;
    for (const n of nums) { h ^= n & 0xffff; h = Math.imul(h, 16777619); }
    return h >>> 0;
  },

  // HSL (all 0..1) → [r,g,b] 0..255
  hsl(h, s, l) {
    h = ((h % 1) + 1) % 1;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  },
  rgbStr: (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`),
  hslStr: (h, s, l, a = 1) => U.rgbStr(U.hsl(h, s, l), a),

  pad: (n, w = 4) => String(n).padStart(w, '0'),

  makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  },
};
