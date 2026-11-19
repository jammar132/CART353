// =============================================================
// sprites.js procedural pixel art.
//
// Everything is drawn into a low-resolution buffer (see sketch.js)
// that gets scaled up 3x with smoothing off, so every shape is
// crisp pixel art. Bodies are generated once per creature from its
// genome and cached on an off-screen canvas; the eyes are drawn
// live every frame so they can look around and change expression.
// =============================================================

const PAL = {
  white: '#f4f4f4',
  pupil: '#0d0b16',
  red: '#e0140f',
  cyan: '#6fd8f2',
  indigo: '#2c1ca8',
  grey: '#9d9d9d',
  amber: '#ffc94a',
  pink: '#ff7aa8',
  blush: 'rgba(255,110,150,0.85)',
  shadow: 'rgba(0,0,0,0.55)',
};

// ---------- tiny bitmap icons (emotes over heads) ----------
const ICONS = {
  heart: ['.#.#.', '#####', '.###.', '..#..'],
  excl: ['#', '#', '#', '.', '#'],
  question: ['##.', '..#', '.#.', '...', '.#.'],
  z: ['###', '.#.', '###'],
  anger: ['#.#', '.#.', '#.#'],
  sparkle: ['.#.', '###', '.#.'],
  dots: ['#.#.#'],
  eye: ['.###.', '#.#.#', '.###.'],
};

const Sprites = {
  _glyphCache: new Map(),
  _iconCache: new Map(),

  // ---------------------------------------------------------
  // low-level pixel helpers (native canvas = fast)
  // ---------------------------------------------------------
  px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  },

  bitmap(ctx, rows, x, y, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
    }
  },

  pixelCircle(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    if (r < 0.5) { ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1); return; }
    const steps = Math.max(8, Math.ceil(r * 6.3));
    let lx = null, ly = null;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (x !== lx || y !== ly) ctx.fillRect(x, y, 1, 1);
      lx = x; ly = y;
    }
  },

  pixelLine(ctx, x0, y0, x1, y1, color) {
    ctx.fillStyle = color;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    while (n++ < 400) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  },

  // ---------------------------------------------------------
  // CREATURE BODY — generated from the genome
  // ---------------------------------------------------------
  creature(genome) {
    const g = genome.genes, m = genome.morph;
    const W = genome.bodySize, H = W - 1;
    const PADX = 2, PADT = 3, PADB = 2;
    const cw = W + PADX * 2, ch = H + PADT + PADB;
    const canvas = U.makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const rng = U.seeded(m.seed);

    // colours from the hue gene
    const base = U.hsl(g.hue, 0.55, 0.64);
    const shade = U.hsl(g.hue, 0.5, 0.46);
    const outline = U.hsl(g.hue, 0.45, 0.19);
    const light = U.hsl(g.hue, 0.6, 0.83);
    const accent = U.hsl(g.hue + 0.5, 0.75, 0.62);

    // 1) body mask: a superellipse (round → boxy), warped by asymmetry
    const p = U.lerp(2, 5, m.shape);
    const mask = [];
    for (let y = 0; y < H; y++) {
      mask.push([]);
      for (let x = 0; x < W; x++) {
        let nx = (x + 0.5 - W / 2) / (W / 2);
        const ny = (y + 0.5 - H / 2) / (H / 2);
        if (m.asym > 0) nx += m.asym * 0.35 * Math.sin(ny * 2.6 + (m.seed % 7));
        mask[y].push(Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) <= 1);
      }
    }
    const inMask = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y][x];

    // spots: decided on the left half and mirrored (unless asymmetric)
    const spots = new Set();
    if (m.pattern === 2) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < Math.ceil(W / 2); x++) {
        if (rng() < 0.16) { spots.add(y * 100 + x); if (m.asym < 0.3) spots.add(y * 100 + (W - 1 - x)); }
      }
    }

    const put = (x, y, c) => {
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const i = (y * cw + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    };

    // 2) paint body
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y][x]) continue;
        const edge = !inMask(x - 1, y) || !inMask(x + 1, y) || !inMask(x, y - 1) || !inMask(x, y + 1);
        let c = base;
        if (edge) c = outline;
        else {
          const nx = (x + 0.5 - W / 2) / (W / 2);
          if (!inMask(x, y + 2)) c = shade;                                   // underside shading
          if (m.pattern === 1 && y >= H * 0.55 && Math.abs(nx) < 0.5) c = light; // belly
          if (m.pattern === 2 && spots.has(y * 100 + x)) c = shade;           // spots
          if (m.pattern === 3 && y < H * 0.5 && y % 2 === 1) c = shade;       // stripes
        }
        put(PADX + x, PADT + y, c);
      }
    }
    // glossy highlight (top-left)
    const hx = Math.max(1, Math.floor(W * 0.22)), hy = 1;
    if (inMask(hx, hy) && inMask(hx - 1, hy) && inMask(hx, hy - 1)) put(PADX + hx, PADT + hy, light);

    const cx = Math.floor(W / 2);
    const topAt = (x) => { for (let y = 0; y < H; y++) if (mask[y][x]) return y; return 0; };
    const botAt = (x) => { for (let y = H - 1; y >= 0; y--) if (mask[y][x]) return y; return H - 1; };

    // 3) ears / antennae
    if (m.ears === 1) {               // pointy ears
      for (const ex of [Math.round(W * 0.22), W - 1 - Math.round(W * 0.22)]) {
        const t = topAt(ex), dir = ex < cx ? 1 : -1;
        put(PADX + ex, PADT + t - 1, outline); put(PADX + ex + dir, PADT + t - 1, outline);
        put(PADX + ex, PADT + t - 2, outline);
      }
    } else if (m.ears === 2) {        // single antenna
      const t = topAt(cx);
      put(PADX + cx, PADT + t - 1, outline); put(PADX + cx, PADT + t - 2, outline); put(PADX + cx, PADT + t - 3, accent);
    } else if (m.ears === 3) {        // twin antennae
      for (const [bx, dir] of [[cx - 1, -1], [cx + 1, 1]]) {
        const t = topAt(bx);
        put(PADX + bx, PADT + t - 1, outline); put(PADX + bx + dir, PADT + t - 2, outline); put(PADX + bx + dir, PADT + t - 3, accent);
      }
    } else if (m.ears === 4) {        // tuft
      const t = topAt(cx);
      put(PADX + cx - 1, PADT + t - 1, accent); put(PADX + cx, PADT + t - 1, accent); put(PADX + cx + 1, PADT + t - 1, accent);
      put(PADX + cx, PADT + t - 2, accent);
    }

    // 4) feet
    if (m.feet === 1) {
      for (const fx of [Math.round(W * 0.28), W - 1 - Math.round(W * 0.28)]) {
        const b = botAt(fx), dir = fx < cx ? -1 : 1;
        put(PADX + fx, PADT + b + 1, outline); put(PADX + fx + dir, PADT + b + 1, outline);
      }
    } else if (m.feet === 2) {
      for (const fx of [Math.round(W * 0.2), cx, W - 1 - Math.round(W * 0.2)]) put(PADX + fx, PADT + botAt(fx) + 1, outline);
    }

    ctx.putImageData(img, 0, 0);

    // 5) eye + mouth anchors (drawn live each frame)
    const eyeY = PADT + Math.max(1, Math.floor(H * 0.22));
    const eyes = [];
    if (m.eyes === 1) {
      eyes.push({ x: PADX + cx - 1, y: eyeY, w: 3, h: 3 });
    } else {
      const halfGap = W >= 11 ? 1 : 0;
      eyes.push({ x: PADX + cx - halfGap - 2, y: eyeY, w: 2, h: 3 });
      eyes.push({ x: PADX + cx + halfGap + 1, y: eyeY, w: 2, h: 3 });
      if (m.eyes === 3) eyes.push({ x: PADX + cx, y: eyeY + (H >= 8 ? 4 : 3), w: 1, h: 2, third: true });
    }
    const mouth = { x: PADX + cx, y: eyeY + (H >= 8 ? 4 : 3) };

    return {
      canvas, w: cw, h: ch, W, H,
      ax: PADX + W / 2, ay: PADT + H / 2,           // anchor = body centre
      top: PADT, bottom: PADT + H,
      eyes, mouth, hasMouth: m.eyes !== 3,
      outline: U.rgbStr(outline),
      bodyColor: U.rgbStr(base),
    };
  },

  // A still image of a creature (body + neutral eyes) for the inspector.
  portrait(sprite) {
    const c = U.makeCanvas(sprite.w, sprite.h);
    const ctx = c.getContext('2d');
    ctx.drawImage(sprite.canvas, 0, 0);
    for (const e of sprite.eyes) {
      Sprites.px(ctx, e.x, e.y, e.w, e.h, PAL.white);
      Sprites.px(ctx, e.x + (e.w > 2 ? 1 : 1), e.y + 1, 1, Math.min(2, e.h - 1), PAL.pupil);
    }
    return c.toDataURL();
  },

  // ---------------------------------------------------------
  // GLYPHS & ICONS
  // ---------------------------------------------------------
  glyph(i, color) {
    const key = i + '|' + color;
    let c = this._glyphCache.get(key);
    if (!c) {
      c = U.makeCanvas(5, 5);
      this.bitmap(c.getContext('2d'), GLYPHS[i % GLYPHS.length], 0, 0, color);
      this._glyphCache.set(key, c);
    }
    return c;
  },

  icon(name, color) {
    const key = name + '|' + color;
    let c = this._iconCache.get(key);
    if (!c) {
      const rows = ICONS[name];
      c = U.makeCanvas(rows[0].length, rows.length);
      this.bitmap(c.getContext('2d'), rows, 0, 0, color);
      this._iconCache.set(key, c);
    }
    return c;
  },

  // glyph as a data-URL image for the HTML interface
  glyphURL(i, color = PAL.cyan) {
    const c = U.makeCanvas(5, 5);
    this.bitmap(c.getContext('2d'), GLYPHS[i % GLYPHS.length], 0, 0, color);
    return c.toDataURL();
  },

  // ---------------------------------------------------------
  // ENVIRONMENT OBJECTS
  // ---------------------------------------------------------
  rock(r, seed) {
    const size = r * 2 + 3;
    const c = U.makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const rng = U.seeded(seed);
    const radii = Array.from({ length: 8 }, () => r * (0.78 + rng() * 0.3));
    const radiusAt = (a) => {
      const t = ((a / (Math.PI * 2)) * 8 + 8) % 8, i = Math.floor(t), f = t - i;
      return U.lerp(radii[i], radii[(i + 1) % 8], U.smooth(f));
    };
    const ctr = size / 2;
    const inside = (x, y) => {
      const dx = x + 0.5 - ctr, dy = y + 0.5 - ctr;
      return Math.hypot(dx, dy) <= radiusAt(Math.atan2(dy, dx) + Math.PI);
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const nx = (x - ctr) / r, ny = (y - ctr) / r;
      let col = '#4a4a58';
      if (edge) col = '#15151c';
      else if (nx + ny < -0.55) col = '#80808f';
      else if (nx + ny > 0.45) col = '#33333f';
      else if (rng() < 0.12) col = '#5d5d6d';
      Sprites.px(ctx, x, y, 1, 1, col);
    }
    return c;
  },

  plant(stage) {
    const art = [
      ['.....', '.....', '.....', '..s..', '..s..'],
      ['.....', 'm...m', '.m.m.', '..s..', '..s..'],
      ['...h...', '.m.m.m.', 'mhmmmhm', '.mmmmm.', '...s...', '...s...'],
      ['...h.h...', '..mhmmh..', '.mmmhmmm.', 'mhmmmmmhm', 'mmmhmmmmm', '.mmmmmhm.', '....s....', '....s....'],
    ][stage];
    const colors = { m: '#2f8f55', h: '#86f5a6', s: '#6b5236' };
    const c = U.makeCanvas(art[0].length, art.length);
    const ctx = c.getContext('2d');
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) Sprites.px(ctx, x, y, 1, 1, colors[ch]); }));
    return c;
  },

  // user-placed shelter: an old CRT terminal the creatures sleep in
  shelter(lit) {
    const art = [
      '.ooooooooooooo.',
      'oGGGGGGGGGGGGGo',
      'oGoooooooooooGo',
      'oGosssssssssoGo',
      'oGoslllsssssoGo',
      'oGosssssssssoGo',
      'oGosssllllssoGo',
      'oGoooooooooooGo',
      'oGGGGGGGGGGrGGo',
      '.ooooooooooooo.',
      '.....oGGGo.....',
      '...ooooooooo...',
    ];
    const colors = {
      o: '#111116', G: '#9d9d9d', s: lit ? '#0a2a18' : '#06140c',
      l: lit ? '#7dff9b' : '#1f6b3a', r: '#e0140f',
    };
    const c = U.makeCanvas(art[0].length, art.length);
    const ctx = c.getContext('2d');
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) Sprites.px(ctx, x, y, 1, 1, colors[ch]); }));
    return c;
  },

  // creature-built nest: a woven ring with a few glowing trinkets
  nest(seed) {
    const w = 19, h = 11;
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const rng = U.seeded(seed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.hypot(nx, ny);
      if (Math.abs(d - 0.85) < 0.17 && rng() < 0.9) Sprites.px(ctx, x, y, 1, 1, rng() < 0.5 ? '#7a5b3c' : '#a8845a');
      else if (d < 0.65 && rng() < 0.05) Sprites.px(ctx, x, y, 1, 1, rng() < 0.5 ? PAL.cyan : '#b6a6ff');
    }
    return c;
  },

  grave() {
    const c = U.makeCanvas(3, 4);
    this.bitmap(c.getContext('2d'), ['.#.', '###', '.#.', '.#.'], 0, 0, '#8a8a8a');
    return c;
  },

  // ---------------------------------------------------------
  // BACKGROUND: black lab bench + glowing petri dish
  // ---------------------------------------------------------
  background(w, h, dish) {
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const rng = U.seeded(1234);
    const { cx, cy, r: R } = dish;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
        let col;
        if (d <= R) {
          const t = d / R;
          col = [U.lerp(11, 4, t * t), U.lerp(10, 3, t * t), U.lerp(24, 11, t * t)];
          const n = rng();
          if (n < 0.05) col = col.map((v) => v + 6);
          else if (n < 0.056) col = [18, 34, 44];
          if ((x === Math.round(cx) || y === Math.round(cy)) && (x + y) % 3 === 0) col = [20, 19, 40]; // reticle
          if (d > R - 1.2) col = dx + dy < 0 ? [170, 170, 185] : [80, 80, 95];        // glass rim
          else if (Math.abs(d - (R - 3)) < 0.5) col = [24, 22, 42];
        } else {
          col = (x % 8 === 0 && y % 8 === 0) ? [22, 22, 22] : [0, 0, 0];
        }
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // measurement ticks around the dish (like a microscope stage)
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180, long = a % 30 === 0;
      const r0 = R + 3, r1 = R + (long ? 8 : 5);
      const col = a === 270 ? PAL.red : long ? '#5a5a5a' : '#2e2e2e';
      Sprites.pixelLine(ctx, cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0, cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1, col);
    }
    return c;
  },
};
