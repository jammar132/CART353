// =============================================================
// ui.js; the retro terminal around the dish (plain HTML/CSS).
// Reads from the world every few frames; never changes the
// simulation except through the buttons.
// =============================================================

const UI = {
  overlayOpen: false,

  init(world) {
    this.world = world;
    const $ = (id) => document.getElementById(id);
    this.el = {
      pop: $('s-pop'), gen: $('s-gen'), unknown: $('s-unknown'),
      born: $('s-born'), died: $('s-died'), groups: $('s-groups'), loners: $('s-loners'), largest: $('s-largest'), nests: $('s-nests'),
      food: $('s-food'), plants: $('s-plants'), rocks: $('s-rocks'), shelters: $('s-shelters'), light: $('s-light'), causes: $('s-causes'),
      supplyBar: $('supply-bar'), supplyNum: $('supply-num'),
      sent: $('s-sent'), understood: $('s-understood'), dialects: $('s-dialects'), agree: $('s-agree'),
      lexicon: $('lexicon'), inspect: $('inspect'), log: $('log'), graph: $('graph'),
      traits: $('traits'), clock: $('clock'), status: $('status'), tooltip: $('tooltip'),
      overlay: $('overlay'), tools: $('tools'), timectl: $('timectl'), sys: $('sys'), stage: $('stage'),
    };
    this.glyphURLs = GLYPHS.map((_, i) => Sprites.glyphURL(i, PAL.cyan));
    this.buildToolbar();
    this.buildTraits();
    world.onLog = (msg, kind, time) => this.log(msg, kind, time);
  },

  // ---------------------------------------------------------
  // toolbar
  // ---------------------------------------------------------
  buildToolbar() {
    const mk = (parent, html, onClick, hint) => {
      const b = document.createElement('button');
      b.innerHTML = html;
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); b.blur(); });
      if (hint) {
        b.addEventListener('mouseenter', () => this.tip(hint));
        b.addEventListener('mouseleave', () => this.tip(''));
      }
      parent.appendChild(b);
      return b;
    };
    this.toolButtons = {};
    for (const t of TOOLS) {
      const cost = CONFIG.COST[t.id] ? `<span class="c">${CONFIG.COST[t.id]}</span>` : '';
      this.toolButtons[t.id] = mk(this.el.tools, `<span class="k">${t.key}</span>${t.label}${cost}`, () => Tools.set(t.id), t.hint);
    }
    this.pauseBtn = mk(this.el.timectl, 'PAUSE', () => togglePause(), 'Space');
    this.speedButtons = {};
    for (const s of [1, 2, 4, 8]) this.speedButtons[s] = mk(this.el.timectl, `${s}x`, () => setSpeed(s), 'Simulation speed  [ + / - ]');
    this.lensBtn = mk(this.el.sys, 'LENS', () => cycleLens(), 'V — see dialects, groups or attitudes toward you');
    this.soundBtn = mk(this.el.sys, 'SOUND', () => toggleSound(), 'M — hear their calls');
    mk(this.el.sys, 'SAVE', () => saveGame(), 'S — save this dish in the browser');
    mk(this.el.sys, 'LOAD', () => loadGame(), 'L — load the saved dish');
    mk(this.el.sys, '?', () => this.showHelp(), 'H — help');
    this.onToolChange(Tools.current);
  },

  onToolChange(id) {
    for (const k in this.toolButtons) this.toolButtons[k].classList.toggle('on', k === id);
    const t = TOOLS.find((x) => x.id === id);
    this.tip(t ? t.hint : '');
  },

  tip(text) {
    this.el.tooltip.textContent = text;
    this.el.tooltip.style.display = text ? 'block' : 'none';
    clearTimeout(this._tipTimer);
    if (text) this._tipTimer = setTimeout(() => { this.el.tooltip.style.display = 'none'; }, 5000);
  },

  flashSupply() {
    this.el.supplyNum.classList.add('red');
    this.tip('Not enough SUPPLY — it refills over time.');
    setTimeout(() => this.el.supplyNum.classList.remove('red'), 600);
  },

  glitch(ms = 120) {
    this.el.stage.classList.add('glitch');
    setTimeout(() => this.el.stage.classList.remove('glitch'), ms);
  },

  // ---------------------------------------------------------
  // gene pool rows
  // ---------------------------------------------------------
  buildTraits() {
    this.traitEls = {};
    const rows = [...TRAIT_DISPLAY, ['trust', 'TRUST (learned)']];
    for (const [k, label] of rows) {
      const row = document.createElement('div');
      row.className = 'trait';
      row.innerHTML = `<span>${label}</span><span class="bar ${k === 'fear' || k === 'aggression' ? 'red' : k === 'trust' ? 'green' : ''}"><i></i>${k === 'trust' ? '<b class="mark" style="left:50%"></b>' : ''}</span><span class="v">—</span><span class="t"></span>`;
      this.el.traits.appendChild(row);
      this.traitEls[k] = { bar: row.querySelector('i'), v: row.querySelector('.v'), t: row.querySelector('.t') };
    }
  },

  // ---------------------------------------------------------
  // refresh everything (called every few frames)
  // ---------------------------------------------------------
  refresh(world, st) {
    const E = this.el, S = world.stats, pop = world.creatures.length;
    E.pop.textContent = pop;
    E.gen.textContent = S.maxGen;
    E.unknown.textContent = S.unknown;
    E.born.textContent = S.born;
    E.died.textContent = S.died;
    E.groups.textContent = world.groups.count;
    E.loners.textContent = world.groups.loners;
    E.largest.textContent = world.groups.largest;
    E.nests.textContent = world.shelters.filter((s) => s.kind === 'nest').length;

    E.food.textContent = world.foods.length;
    E.plants.textContent = world.plants.length;
    E.rocks.textContent = world.rocks.length;
    E.shelters.textContent = world.shelters.filter((s) => s.kind === 'user').length;
    E.light.textContent = world.darkness < 0.05 ? 'DAY' : world.darkness < 0.5 ? 'DUSK' : 'NIGHT';
    const causes = Object.entries(S.causes).sort((a, b) => b[1] - a[1]);
    E.causes.textContent = causes.length ? `${causes[0][0].toUpperCase()}·${causes[0][1]}` : '—';
    E.supplyBar.style.width = world.sandbox ? '100%' : `${(world.supply / CONFIG.SUPPLY_MAX) * 100}%`;
    E.supplyNum.textContent = world.sandbox ? '∞' : Math.floor(world.supply);

    E.clock.textContent = `DAY ${world.day} · ${world.clockString().split(' ')[1]}`;
    E.status.textContent = st.paused ? '❚❚ PAUSED' : `● OBSERVING ${st.speed > 1 ? '×' + st.speed : ''}`;
    E.status.classList.toggle('paused', st.paused);
    this.pauseBtn.textContent = st.paused ? 'PLAY' : 'PAUSE';
    this.pauseBtn.classList.toggle('on', st.paused);
    for (const s in this.speedButtons) this.speedButtons[s].classList.toggle('on', +s === st.speed);
    this.lensBtn.textContent = `LENS: ${st.lens}`;
    this.lensBtn.classList.toggle('on', st.lens !== 'NONE');
    this.soundBtn.textContent = `SOUND: ${SFX.on ? 'ON' : 'OFF'}`;
    this.soundBtn.classList.toggle('on', SFX.on);

    this.refreshTraits(world);
    this.refreshLanguage(world);
    this.refreshInspector(world);
    this.drawGraph(world);

    // the deeper the experiment goes, the less stable the terminal feels
    const unease = 0.002 + world.stats.maxGen * 0.0003 + world.stareFraction * 0.04;
    if (pop > 0 && Math.random() < unease) this.glitch(80 + Math.random() * 120);
  },

  refreshTraits(world) {
    const now = world.traitMeans();
    const snaps = world.traitSnapshots;
    const past = snaps.length > 6 ? snaps[snaps.length - 7] : snaps[0];
    for (const k in this.traitEls) {
      const el = this.traitEls[k];
      const v = now[k];
      if (!world.creatures.length) { el.bar.style.width = '0%'; el.v.textContent = '—'; el.t.textContent = ''; continue; }
      if (k === 'trust') {
        const pct = Math.abs(v) * 50;
        el.bar.style.left = v >= 0 ? '50%' : `${50 - pct}%`;
        el.bar.style.width = `${pct}%`;
        el.v.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
      } else {
        el.bar.style.width = `${v * 100}%`;
        el.v.textContent = v.toFixed(2);
      }
      const diff = past ? v - past[k] : 0;
      el.t.textContent = diff > 0.015 ? '▲' : diff < -0.015 ? '▼' : '';
      el.t.className = 't ' + (diff > 0 ? 'up' : 'down');
    }
  },

  glyphImg(i) { return `<img class="glyph" src="${this.glyphURLs[i]}" alt="symbol ${i}">`; },

  refreshLanguage(world) {
    const S = world.stats, L = world.language;
    this.el.sent.textContent = S.signals;
    const heard = S.understood + S.unknown;
    this.el.understood.textContent = heard ? `${Math.round((S.understood / heard) * 100)}%` : '—';
    this.el.dialects.textContent = world.creatures.length ? L.dialects : 0;
    this.el.agree.textContent = world.creatures.length ? `${Math.round(L.agreement * 100)}%` : '—';
    let html = '';
    for (const m of MEANINGS) {
      const words = (L.words[m] || []).slice(0, 3);
      html += `<div class="lex-row"><span>${m}</span><span class="lex-words">${words.map((w, i) =>
        `<span class="word ${i === 0 ? 'top' : ''}">${this.glyphImg(w.symbol)}<small>${Math.round(w.share * 100)}%</small></span>`).join('')}</span></div>`;
    }
    html += `<div class="lex-note">Meanings are what the code intends. The symbols are theirs.</div>`;
    this.el.lexicon.innerHTML = html;
  },

  refreshInspector(world) {
    const c = world.selected;
    if (!c) { this.el.inspect.innerHTML = '<p class="dim">No specimen selected.<br>Press [1] and click a creature.</p>'; return; }
    if (!c.portraitURL) c.portraitURL = Sprites.portrait(c.sprite);
    const g = c.g;
    const bar = (v, cls = '') => `<span class="bar ${cls}"><i style="width:${U.clamp(v, 0, 1) * 100}%"></i></span>`;
    const row = (label, v, cls) => `<div class="mini" title="${label} ${v.toFixed(2)}"><span>${label}</span>${bar(v, cls)}</div>`;
    const SHORT = { curiosity: 'CURIOUS', sociability: 'SOCIAL', fear: 'FEAR', aggression: 'AGGRESS', speed: 'SPEED', affinity: 'ATTRACT', sense: 'PERCEPT', fertility: 'FERTILE' };
    const ageS = Math.floor(c.age / 60);
    const status = c.alive
      ? `NOW: ${STATE_LABEL[c.state]} · ${c.mood}`
      : `<span class="red">DECEASED — ${c.causeOfDeath}</span>`;
    const trustPct = Math.abs(c.trust) * 50;
    const lex = MEANINGS.map((m) => `<span>${m.slice(0, 4)} ${this.glyphImg(c.lexicon[m])}</span>`).join('');
    this.el.inspect.innerHTML = `
      <img class="portrait" src="${c.portraitURL}" alt="">
      <div class="name">${c.name} <span class="red">#${U.pad(c.id)}</span></div>
      <div class="meta">GEN ${c.gen} · AGE ${Math.floor(ageS / 60)}:${U.pad(ageS % 60, 2)} · ${c.parentId ? 'CHILD OF #' + U.pad(c.parentId) : 'FOUNDER'} · ${c.children} OFFSPRING</div>
      <div class="meta">${status}</div>
      <div class="sub">NEEDS</div>
      <div class="grid2">
        ${row('HUNGER', c.hunger, 'amber')}${row('ENERGY', c.energy, 'cyan')}
        ${row('HEALTH', c.health, 'green')}${row('FEAR', c.fear, 'red')}
      </div>
      <div class="sub">GENES</div>
      <div class="grid2">${TRAIT_DISPLAY.map(([k]) => row(SHORT[k], g[k], k === 'fear' || k === 'aggression' ? 'red' : '')).join('')}</div>
      <div class="sub">LEARNED</div>
      <div class="row"><span>TRUST</span><span class="bar green"><i style="left:${c.trust >= 0 ? 50 : 50 - trustPct}%;width:${trustPct}%"></i><b class="mark" style="left:50%"></b></span><span>${(c.trust >= 0 ? '+' : '') + c.trust.toFixed(2)}</span></div>
      <div class="lexline">${lex}</div>
      <div class="meta">HOME ${c.memory.home ? 'KNOWN' : '—'} · WORDS COPIED ${c.wordsLearned} · GROUP ${c.groupSize}</div>`;
  },

  drawGraph(world) {
    const cv = this.el.graph, ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#151515';
    for (let y = 0; y < H; y += 10) ctx.fillRect(0, y, W, 1);
    const hist = world.history;
    if (hist.length < 2) return;
    const n = Math.min(W, hist.length);
    const sample = (i) => hist[Math.floor((i / (n - 1)) * (hist.length - 1))];
    let maxV = 10;
    for (const h of hist) maxV = Math.max(maxV, h.pop, h.food);
    const plot = (key, color, scale) => {
      ctx.fillStyle = color;
      let prev = null;
      for (let i = 0; i < n; i++) {
        const x = Math.floor((i / (n - 1)) * (W - 1));
        const y = H - 1 - Math.round(scale(sample(i)[key]) * (H - 2));
        if (prev !== null) {
          const y0 = Math.min(prev, y), y1 = Math.max(prev, y);
          ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        } else ctx.fillRect(x, y, 1, 1);
        prev = y;
      }
    };
    plot('food', '#7a5f1f', (v) => v / maxV);
    plot('fear', PAL.red, (v) => v);
    plot('pop', PAL.white, (v) => v / maxV);
  },

  // ---------------------------------------------------------
  // event log
  // ---------------------------------------------------------
  log(msg, kind, time) {
    const p = document.createElement('p');
    p.className = kind || '';
    const html = msg.replace(/\{g:(\d+)\}/g, (_, n) => this.glyphImg(+n));
    p.innerHTML = `<span class="t">${time}</span>${html}`;
    this.el.log.prepend(p);
    while (this.el.log.children.length > 120) this.el.log.lastChild.remove();
  },

  // ---------------------------------------------------------
  // overlays
  // ---------------------------------------------------------
  _open(html) {
    this.el.overlay.onclick = null;
    this.el.overlay.innerHTML = `<div class="box">${html}</div>`;
    this.el.overlay.classList.add('show');
    this.overlayOpen = true;
  },

  hideOverlay() {
    this.el.overlay.classList.remove('show');
    this.overlayOpen = false;
    clearTimeout(this._typeTimer);
  },

  showBoot(saveInfo) {
    const resume = saveInfo
      ? `<button id="btn-resume">RESUME SAVED DISH · POP ${saveInfo.pop} · GEN ${saveInfo.gen}</button>` : '';
    this._open(`
      <h1>PETRI</h1>
      <div class="body">
        <pre id="boot-text"></pre>
        <div class="btns"><button id="btn-new">NEW DISH</button>${resume}</div>
        <div class="cta">CLICK TO BEGIN</div>
      </div>`);
    document.getElementById('btn-new').onclick = (e) => { e.stopPropagation(); startGame(false); };
    if (saveInfo) document.getElementById('btn-resume').onclick = (e) => { e.stopPropagation(); startGame(true); };
    this.el.overlay.onclick = () => startGame(false);           // "click to begin" anywhere
    const lines = [
      'PETRI v0.6 — AN ARTIFICIAL LIFE EXPERIMENT',
      '',
      '> preparing culture medium ........... OK',
      `> calibrating dish (r = ${this.world.dish.r}px) ...... OK`,
      '> seeding specimen 0001 .............. OK',
      '> 1 LIFEFORM DETECTED.',
      '> IT IS HUNGRY.',
      '',
      'You do not control the creature.',
      'You control its world.',
      '',
      '[2] FOOD to feed it · [1] OBSERVE to watch · [H] help',
    ];
    const pre = document.getElementById('boot-text');
    let i = 0;
    const type = () => {
      if (i >= lines.length || !this.overlayOpen) return;
      pre.textContent += lines[i++] + '\n';
      this._typeTimer = setTimeout(type, i < 3 ? 220 : 160);
    };
    type();
  },

  showHelp() {
    this._open(`
      <h1>HOW TO CARE FOR THEM</h1>
      <div class="body">
        <div class="keys">
          <span>1 – 7</span><span>Tools: observe, food, plant, rock, shelter, startle, erase</span>
          <span>CLICK / DRAG</span><span>Use the tool inside the dish</span>
          <span>SPACE</span><span>Pause / play</span>
          <span>+ / −</span><span>Simulation speed (1× 2× 4× 8×)</span>
          <span>V</span><span>Lens: dialects · groups · attitude toward you</span>
          <span>G</span><span>Debug view: velocities, senses, nest heat</span>
          <span>M</span><span>Sound on/off</span>
          <span>S / L</span><span>Save / load the dish (browser storage)</span>
          <span>X</span><span>Unlimited supply (sandbox)</span>
          <span>TAB</span><span>Hide the interface</span>
        </div>
        <p class="dim">You never control a creature. Everything you do changes the world they evolve in.
        Chase them with a fast cursor and the fearful survive. Feed them under a still cursor and the
        curious thrive. Leave them alone and see what they become.</p>
        <div class="btns"><button id="btn-close">BACK TO THE DISH</button></div>
      </div>`);
    document.getElementById('btn-close').onclick = () => this.hideOverlay();
  },

  showExtinct(world) {
    const S = world.stats;
    const causes = Object.entries(S.causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    this._open(`
      <h1>SPECIMEN LINE TERMINATED</h1>
      <div class="body">
        <pre>The colony is extinct.

GENERATIONS ....... ${S.maxGen}
PEAK POPULATION ... ${S.peak}
BORN / DIED ....... ${S.born} / ${S.died}
SIGNALS SENT ...... ${S.signals}
DAYS SURVIVED ..... ${world.day}
CAUSES ............ ${causes || '—'}</pre>
        <div class="btns"><button id="btn-new">NEW DISH</button><button id="btn-load">LOAD SAVE</button><button id="btn-stay">KEEP LOOKING</button></div>
      </div>`);
    document.getElementById('btn-new').onclick = () => startGame(false);
    document.getElementById('btn-load').onclick = () => startGame(true);
    document.getElementById('btn-stay').onclick = () => { world.extinctAcknowledged = true; this.hideOverlay(); };
  },
};
