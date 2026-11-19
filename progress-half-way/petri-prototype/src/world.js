// =============================================================
// world.js; the petri dish and everything in it.
// Owns the tick loop, births/deaths, signals, the player's
// influence, emergent statistics (groups, dialects, nests) and
// the drawing order.
// =============================================================

class World {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.computeDish();
    this.creatureGrid = new SpatialGrid(w, h, CONFIG.GRID_CELL);
    this.foodGrid = new SpatialGrid(w, h, CONFIG.GRID_CELL);
    this.bg = Sprites.background(w, h, this.dish);
    this.onLog = null;          // set by the UI
    this.reset();
  }

  reset() {
    this.creatures = [];
    this.births = [];
    this.foods = [];
    this.plants = [];
    this.rocks = [];
    this.shelters = [];
    this.graves = [];
    this.effects = [];
    this.signals = [];
    this.tick = 0;
    this.nextId = 1;
    this.day = 1;
    this.timeOfDay = CONFIG.START_TIME;
    this.light = 1;
    this.darkness = 0;
    this.visionMult = 1;
    this.supply = CONFIG.SUPPLY_MAX;
    this.sandbox = !CONFIG.SUPPLY_ENABLED;
    this.cursor = { x: -999, y: -999, speed: 0, inside: false, still: false, stillFrames: 0, pressed: false };
    this.stats = { born: 0, died: 0, maxGen: 0, peak: 0, signals: 0, understood: 0, unknown: 0, fights: 0, causes: {} };
    this.history = [];
    this.traitSnapshots = [];
    this.groups = { count: 0, loners: 0, largest: 0 };
    this.language = Language.survey([]);
    this.dominantWords = {};
    this.spreading = new Set();
    this.selected = null;
    this.stareFraction = 0;
    this.watching = false;
    this.extinct = false;
    this.extinctAcknowledged = false;
    this.milestones = new Set();
    this.resetHeat();
    this.updateLight();
  }

  // the dish is a circle that fits between the HUD columns
  computeDish() {
    const P = CONFIG.PIXEL;
    const availW = this.w - (CONFIG.SIDE_COLUMNS * 2 + 20) / P;
    const top = CONFIG.TOP_MARGIN / P, bottom = CONFIG.BOTTOM_MARGIN / P;
    const availH = this.h - top - bottom;
    let r = Math.floor(Math.min(availW, availH) / 2) - 9;
    r = Math.max(r, Math.floor(Math.min(this.w, this.h - top - bottom) * 0.42)); // tiny screens: overlap the panels
    this.dish = { cx: Math.floor(this.w / 2), cy: Math.floor(top + availH / 2), r };
    // population cap scales with the dish area so small screens don't overcrowd
    this.maxPop = Math.round(U.clamp((Math.PI * r * r) / 105, 60, CONFIG.MAX_POP));
  }

  resize(w, h) {
    const old = this.dish;
    this.w = w; this.h = h;
    this.computeDish();
    const D = this.dish, s = D.r / old.r;
    const map = (p) => { if (p) { p.x = D.cx + (p.x - old.cx) * s; p.y = D.cy + (p.y - old.cy) * s; } };
    for (const list of [this.creatures, this.foods, this.plants, this.rocks, this.shelters, this.graves]) for (const e of list) map(e.pos);
    for (const c of this.creatures) { map(c.memory.home); map(c.memory.food); map(c.investigate); map(c.socialTarget); map(c.fearSource); }
    this.signals.length = 0;
    this.effects.length = 0;
    this.creatureGrid.resize(w, h);
    this.foodGrid.resize(w, h);
    this.resetHeat();
    this.bg = Sprites.background(w, h, this.dish);
  }

  seed() {
    for (let i = 0; i < CONFIG.START_CREATURES; i++) {
      const c = new Creature(this, Genome.founder(), this.dish.cx + U.rand(-4, 4), this.dish.cy + U.rand(-4, 4));
      this.creatures.push(c);
      if (i === 0) this.selected = c;
    }
    this.stats.maxGen = 1;
    this.log(`Specimen ${this.creatures[0].label} detected. It is alone.`, 'milestone');
  }

  // ===========================================================
  // TICK
  // ===========================================================
  update() {
    this.tick++;
    this.updateLight();
    if (!this.sandbox) this.supply = Math.min(CONFIG.SUPPLY_MAX, this.supply + CONFIG.SUPPLY_REGEN);

    // rebuild the spatial hashes
    this.creatureGrid.clear();
    for (const c of this.creatures) if (c.alive) this.creatureGrid.insert(c);
    this.foodGrid.clear();
    for (const f of this.foods) if (!f.eaten) this.foodGrid.insert(f);

    // environment
    if (U.chance(CONFIG.WILD_FOOD_CHANCE)) this.spawnWildFood();
    for (const p of this.plants) p.update(this);
    for (const f of this.foods) f.update();

    // agents
    for (const c of this.creatures) if (c.alive) c.update(this);
    if (this.births.length) { for (const b of this.births) this.creatures.push(b); this.births.length = 0; }
    this.cleanup();

    // visuals with a lifetime
    for (const g of this.graves) g.age++;
    for (const e of this.effects) e.update();
    for (const s of this.signals) s.age++;
    if (this.tick % 30 === 0) {
      this.graves = this.graves.filter((g) => g.age < g.life);
      this.updateStare();
    }
    this.effects = this.effects.filter((e) => !e.done);
    this.signals = this.signals.filter((s) => s.age < s.life);

    // slower bookkeeping
    if (this.tick % 60 === 0) { this.updateNests(); this.updateLanguage(); }
    if (this.tick % 90 === 0) this.computeGroups();
    if (this.tick % CONFIG.HISTORY_EVERY === 0) this.recordHistory();
    if (this.tick % CONFIG.TRAIT_SNAPSHOT_EVERY === 0) {
      this.traitSnapshots.push(this.traitMeans());
      if (this.traitSnapshots.length > 60) this.traitSnapshots.shift();
    }
    this.checkMilestones();
  }

  cleanup() {
    if (this.creatures.some((c) => !c.alive)) this.creatures = this.creatures.filter((c) => c.alive);
    if (this.foods.some((f) => f.eaten)) this.foods = this.foods.filter((f) => !f.eaten);
  }

  updateLight() {
    if (!CONFIG.NIGHT_ENABLED) { this.light = 1; this.darkness = 0; this.visionMult = 1; return; }
    const t = CONFIG.START_TIME + this.tick / CONFIG.DAY_LENGTH;
    this.day = Math.floor(t) + 1;
    this.timeOfDay = t % 1;
    this.light = 0.5 - 0.5 * Math.cos(this.timeOfDay * Math.PI * 2);
    this.darkness = U.clamp(1 - this.light * 1.7, 0, 1);
    this.visionMult = 1 - 0.35 * this.darkness;
  }

  clockString() {
    const mins = Math.floor(this.timeOfDay * 24 * 60);
    return `D${this.day} ${U.pad(Math.floor(mins / 60), 2)}:${U.pad(mins % 60, 2)}`;
  }

  // ===========================================================
  // LIFE & DEATH
  // ===========================================================
  reproduce(parent) {
    let genome, partner = null;
    if (CONFIG.REPRODUCTION_MODE === 'pair') {
      partner = parent.neighbours.find((o) => o.alive && o !== parent && o.canReproduce(this)
        && U.dist2(o.pos.x, o.pos.y, parent.pos.x, parent.pos.y) < 400);
      if (!partner) return;
      genome = Genome.crossover(parent.genome, partner.genome).mutate();
    } else {
      genome = parent.genome.mutate();
    }

    const a = U.rand(Math.PI * 2);
    const child = new Creature(this, genome, parent.pos.x + Math.cos(a) * 5, parent.pos.y + Math.sin(a) * 5, parent);
    const { lex, invented } = Language.inherit(parent.lexicon);
    child.lexicon = lex;
    child.trust = parent.trust * CONFIG.TRUST_INHERIT;                // culture passed down
    if (parent.memory.home) child.memory.home = parent.memory.home.copy();

    for (const p of partner ? [parent, partner] : [parent]) {
      const share = partner ? 0.5 : 1;
      p.hunger = Math.min(1, p.hunger + CONFIG.REPRO_COST_HUNGER * share);
      p.energy = Math.max(0, p.energy - CONFIG.REPRO_COST_ENERGY * share);
      p.reproCooldown = CONFIG.REPRO_COOLDOWN * U.lerp(1.4, 0.6, p.g.fertility);
      p.children++;
      p.setEmote('heart', 50);
    }

    this.constrain(child);
    this.births.push(child);
    this.stats.born++;
    this.effects.push(new Effect('ring', child.pos.x, child.pos.y, { r0: 1, r1: 8, life: 24, color: PAL.pink }));
    SFX.birth(this.pan(child.pos.x));

    const pop = this.creatures.length + this.births.length;
    if (pop <= 12) this.log(`${parent.label} budded → ${child.label}`, 'birth');
    if (child.gen > this.stats.maxGen) {
      this.stats.maxGen = child.gen;
      if (child.gen <= 10 || child.gen % 5 === 0) this.log(`GENERATION ${child.gen} reached.`, 'milestone');
    }
    // new words are only announced while the colony is small; later we report the ones that SPREAD
    if (pop < 25) {
      for (const m of invented) {
        const sym = child.lexicon[m];
        if (!this.creatures.some((c) => c.lexicon[m] === sym)) this.log(`${child.label} invented a new word {g:${sym}} for ${m}.`, 'lang');
      }
    }
  }

  onDeath(c) {
    this.stats.died++;
    this.stats.causes[c.causeOfDeath] = (this.stats.causes[c.causeOfDeath] || 0) + 1;
    this.graves.push(new Grave(c.pos.x, c.pos.y));
    SFX.death(this.pan(c.pos.x));
    // witnesses are frightened; the sociable ones mourn
    for (const o of this.creatureGrid.query(c.pos.x, c.pos.y, 40, [])) {
      if (o === c || !o.alive) continue;
      o.addFear(0.15 * (0.4 + o.g.fear), c.pos.x, c.pos.y, this);
      if (o.g.sociability > 0.6) o.setEmote('dots', 60);
    }
    const pop = this.creatures.filter((k) => k.alive).length;
    if (pop < 15 || c.causeOfDeath === 'hunted') {
      const how = { starved: 'starved', exhausted: 'died of exhaustion', 'old age': 'died of old age', hunted: 'was killed by YOU', wounded: 'was killed in a fight' };
      this.log(`${c.label} ${how[c.causeOfDeath] || 'died'}.`, c.causeOfDeath === 'hunted' ? 'warn' : 'death');
    }
  }

  checkMilestones() {
    const pop = this.creatures.length;
    if (pop > this.stats.peak) this.stats.peak = pop;
    for (const m of [2, 10, 25, 50, 100, 200, 300]) {
      if (pop >= m && !this.milestones.has('pop' + m)) {
        this.milestones.add('pop' + m);
        this.log(m === 2 ? 'It is no longer alone.' : `POPULATION ${m}.`, 'milestone');
      }
    }
    if (pop === 0 && this.tick > 10 && !this.extinct) {
      this.extinct = true;
      this.log('The colony is extinct.', 'warn');
    }
  }

  // ===========================================================
  // THE PLAYER
  // Called once per FRAME (not per tick): a fast-moving cursor is
  // a predator. Fearful creatures notice it earlier and get away;
  // the bold or slow ones get hurt. Chase them for long enough and
  // fear becomes common in the gene pool.
    // ===========================================================
  applyCursor() {
    const c = this.cursor;
    if (!c.inside || c.pressed || c.speed < CONFIG.CURSOR_THREAT_SPEED * 0.6) return;
    const fast = c.speed > CONFIG.CURSOR_THREAT_SPEED;
    for (const k of this.creatureGrid.query(c.x, c.y, CONFIG.SENSE_MAX, [])) {
      if (!k.alive) continue;
      const g = k.g;
      const d = U.dist(k.pos.x, k.pos.y, c.x, c.y);
      const reactR = k.sense * (0.35 + 0.85 * g.fear) * (1 - 0.3 * g.affinity);
      const threshold = CONFIG.CURSOR_THREAT_SPEED * (1.3 - 0.6 * g.fear);
      if (d < reactR && c.speed > threshold) {
        const amt = (1 - d / reactR) * (0.3 + g.fear) * (1 - 0.5 * Math.max(0, k.trust)) * 0.25;
        k.addFear(amt, c.x, c.y, this);
        if (U.chance(0.02)) k.trust = Math.max(-1, k.trust + CONFIG.TRUST_FROM_CHASE);
      }
      // shelters are safe: the cursor can't hurt anything inside one
      if (fast && !k.shelter && d < CONFIG.CURSOR_HARM_RADIUS + k.radius) {
        // vigilant (high-fear) creatures that are already fleeing are much harder to catch
        const dodge = k.state === STATE.FLEE ? U.lerp(1, 0.25, g.fear) : 1;
        const harm = CONFIG.CURSOR_HARM * Math.min(2, c.speed / CONFIG.CURSOR_THREAT_SPEED) * (1.25 - 0.5 * g.size) * dodge;
        k.health -= harm;
        k.energy = Math.max(0, k.energy - harm * 0.5);
        k.lastHarm = 'hunted';
        k.trust = Math.max(-1, k.trust - 0.01);
        k.addFear(0.1, c.x, c.y, this);
        if (k.health <= 0) k.die(this, 'hunted');
      }
    }
  }

  startle(x, y) {
    this.effects.push(new Effect('ring', x, y, { r0: 2, r1: 55, life: 30, color: PAL.red }));
    this.effects.push(new Effect('ring', x, y, { r0: 1, r1: 30, life: 20, color: '#ffffff' }));
    SFX.startle();
    for (const k of this.creatureGrid.query(x, y, 55, [])) {
      if (!k.alive) continue;
      const d = U.dist(k.pos.x, k.pos.y, x, y), f = 1 - d / 55;
      k.addFear((0.4 + 0.6 * k.g.fear) * (0.4 + f), x, y, this);
      k.trust = Math.max(-1, k.trust + CONFIG.TRUST_FROM_STARTLE * f);
      if (d < 14) { k.health -= 0.08; k.lastHarm = 'hunted'; if (k.health <= 0) k.die(this, 'hunted'); }
    }
  }

  // ===========================================================
  // SIGNALS
  // ===========================================================
  emitSignal(speaker, meaning, at) {
    if (speaker.signalCooldown > 0 || !speaker.alive) return;
    speaker.signalCooldown = CONFIG.SIGNAL_COOLDOWN * U.rand(0.7, 1.3);
    const sig = {
      x: speaker.pos.x, y: speaker.pos.y,
      tx: at ? at.x : speaker.pos.x, ty: at ? at.y : speaker.pos.y,   // what the signal is about
      symbol: speaker.lexicon[meaning], meaning, speaker: speaker.id, age: 0, life: 42,
    };
    this.signals.push(sig);
    speaker.bubble = { symbol: sig.symbol, t: 70 };
    this.stats.signals++;
    for (const h of this.creatureGrid.query(sig.x, sig.y, CONFIG.SIGNAL_RANGE, [])) if (h !== speaker) h.hear(sig, this);
    SFX.chirp(sig.symbol, speaker.g.voice, this.pan(sig.x));
  }

  updateLanguage() {
    this.language = Language.survey(this.creatures);
    if (this.creatures.length < 6) return;
    if (!this.spreading) this.spreading = new Set();
    for (const m of MEANINGS) {
      const words = this.language.words[m];
      const top = words[0];
      if (top && top.share >= 0.5) {
        const prev = this.dominantWords[m];
        if (prev !== undefined && prev !== top.symbol) this.log(`The colony now says {g:${top.symbol}} for ${m} (was {g:${prev}}).`, 'lang');
        this.dominantWords[m] = top.symbol;
      }
      // a rival word catching on = a dialect forming
      for (const w of words.slice(1)) {
        const key = m + w.symbol;
        if (w.share >= 0.15 && this.creatures.length >= 12 && !this.spreading.has(key)) {
          this.spreading.add(key);
          this.log(`A rival word {g:${w.symbol}} for ${m} is spreading (${Math.round(w.share * 100)}%).`, 'lang');
        } else if (w.share < 0.05) this.spreading.delete(key);
      }
    }
  }

  // ===========================================================
  // EMERGENT STRUCTURE
  // ===========================================================
  // GROUPS; union-find over "close enough" links
  computeGroups() {
    const cs = this.creatures, n = cs.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) { parent[i] = i; cs[i]._i = i; }
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const tmp = [];
    for (let i = 0; i < n; i++) {
      this.creatureGrid.query(cs[i].pos.x, cs[i].pos.y, CONFIG.GROUP_LINK, tmp);
      for (const o of tmp) {
        if (o._i === undefined || cs[o._i] !== o) continue;
        const a = find(i), b = find(o._i);
        if (a !== b) parent[a] = b;
      }
    }
    const size = new Map(), label = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      size.set(r, (size.get(r) || 0) + 1);
      label.set(r, Math.min(label.has(r) ? label.get(r) : Infinity, cs[i].id));
    }
    let count = 0, loners = 0, largest = 0;
    for (const s of size.values()) { if (s >= 3) count++; if (s === 1) loners++; largest = Math.max(largest, s); }
    for (let i = 0; i < n; i++) {
      const r = find(i);
      cs[i].groupSize = size.get(r);
      cs[i].groupId = size.get(r) >= 3 ? label.get(r) : 0;
    }
    this.groups = { count, loners, largest };
  }

  // NESTS — if creatures keep sleeping in the same open spot, they build a nest there
  resetHeat() {
    this.heatCols = Math.ceil(this.w / CONFIG.NEST_CELL);
    this.heatRows = Math.ceil(this.h / CONFIG.NEST_CELL);
    const n = this.heatCols * this.heatRows;
    this.heat = new Float32Array(n);
    this.heatX = new Float32Array(n);
    this.heatY = new Float32Array(n);
  }

  addSleepHeat(x, y) {
    const cx = U.clamp(Math.floor(x / CONFIG.NEST_CELL), 0, this.heatCols - 1);
    const cy = U.clamp(Math.floor(y / CONFIG.NEST_CELL), 0, this.heatRows - 1);
    const i = cy * this.heatCols + cx;
    this.heat[i] += 1; this.heatX[i] += x; this.heatY[i] += y;
  }

  updateNests() {
    const nests = this.shelters.filter((s) => s.kind === 'nest').length;
    for (let i = 0; i < this.heat.length; i++) {
      if (nests < CONFIG.NEST_MAX && this.heat[i] > CONFIG.NEST_HEAT) {
        const x = this.heatX[i] / this.heat[i], y = this.heatY[i] / this.heat[i];
        if (this.inDish(x, y, 12) && !this.rockAt(x, y, 8) && !this.shelters.some((s) => U.dist2(s.pos.x, s.pos.y, x, y) < 900)) {
          this.shelters.push(new Shelter(x, y, 'nest'));
          this.effects.push(new Effect('ring', x, y, { r0: 2, r1: 20, life: 50, color: '#b6a6ff' }));
          this.log('The creatures have built a nest.', 'culture');
          if (!this.milestones.has('firstNest')) { this.milestones.add('firstNest'); this.log('Nobody told them how.', 'culture'); }
        }
        this.heat[i] = this.heatX[i] = this.heatY[i] = 0;
      }
      this.heat[i] *= 0.985; this.heatX[i] *= 0.985; this.heatY[i] *= 0.985;
    }
  }

  // collective staring
  updateStare() {
    const n = this.creatures.length;
    let staring = 0;
    for (const c of this.creatures) if (c.stareTicks > 0) staring++;
    this.stareFraction = n ? staring / n : 0;
    if (!this.watching && n >= 12 && this.stareFraction > 0.4) {
      this.watching = true;
      this.log('THEY ARE ALL LOOKING AT YOU.', 'warn');
      SFX.hum();
      if (typeof UI !== 'undefined') UI.glitch(400);
    } else if (this.watching && this.stareFraction < 0.1) this.watching = false;
  }

  traitMeans() {
    const m = { trust: 0 };
    for (const [k] of TRAIT_DISPLAY) m[k] = 0;
    const n = this.creatures.length;
    if (!n) return m;
    for (const c of this.creatures) {
      for (const [k] of TRAIT_DISPLAY) m[k] += c.g[k];
      m.trust += c.trust;
    }
    for (const k in m) m[k] /= n;
    return m;
  }

  recordHistory() {
    let fear = 0;
    for (const c of this.creatures) fear += c.g.fear;
    this.history.push({
      t: this.tick, pop: this.creatures.length, food: this.foods.length,
      fear: this.creatures.length ? fear / this.creatures.length : 0, signals: this.stats.signals,
    });
    if (this.history.length > CONFIG.HISTORY_MAX) this.history = this.history.filter((_, i) => i % 2 === 0);
  }

  // ===========================================================
  // PLACEMENT & QUERIES
  // ===========================================================
  inDish(x, y, margin = 0) {
    const D = this.dish, r = D.r - margin;
    return U.dist2(x, y, D.cx, D.cy) <= r * r;
  }
  rockAt(x, y, margin = 0) {
    return this.rocks.some((r) => U.dist2(x, y, r.pos.x, r.pos.y) < (r.r + margin) * (r.r + margin));
  }
  shelterAt(x, y) {
    for (const s of this.shelters) if (U.dist2(x, y, s.pos.x, s.pos.y) < s.r * s.r) return s;
    return null;
  }
  nearestShelter(x, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const s of this.shelters) { const d = U.dist2(x, y, s.pos.x, s.pos.y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  pan(x) { return U.clamp((x - this.dish.cx) / this.dish.r, -1, 1) * 0.7; }

  // keep a creature inside the dish and out of rocks
  constrain(c) {
    const D = this.dish;
    const dx = c.pos.x - D.cx, dy = c.pos.y - D.cy, d = Math.hypot(dx, dy);
    const maxD = D.r - c.radius - 2;
    if (d > maxD) {
      c.pos.x = D.cx + (dx / d) * maxD;
      c.pos.y = D.cy + (dy / d) * maxD;
      const radial = (c.vel.x * dx + c.vel.y * dy) / d;
      if (radial > 0) { c.vel.x -= (dx / d) * radial * 1.5; c.vel.y -= (dy / d) * radial * 1.5; }
    }
    for (const r of this.rocks) {
      const rx = c.pos.x - r.pos.x, ry = c.pos.y - r.pos.y, rd = Math.hypot(rx, ry) || 0.01;
      const min = r.r + c.radius - 1;
      if (rd < min) { c.pos.x = r.pos.x + (rx / rd) * min; c.pos.y = r.pos.y + (ry / rd) * min; }
    }
  }

  canPlace(type, x, y) {
    if (!this.inDish(x, y, 6)) return false;
    const near = (list, d) => list.some((o) => U.dist2(o.pos.x, o.pos.y, x, y) < d * d);
    switch (type) {
      case 'food': return !this.rockAt(x, y, 1);
      case 'plant': return !this.rockAt(x, y, 4) && !near(this.plants, 10);
      case 'rock': return !this.rockAt(x, y, 6) && !near(this.shelters, 14) && !near(this.plants, 8);
      case 'shelter': return !this.rockAt(x, y, 12) && !near(this.shelters, 30) && this.inDish(x, y, 16);
      default: return true;
    }
  }

  addFood(x, y, kind = 'pellet', opts = {}) {
    const f = new Food(x, y, kind, { ...opts, tick: this.tick });
    this.foods.push(f);
    return f;
  }
  addPlant(x, y) { const p = new Plant(x, y); this.plants.push(p); return p; }
  addRock(x, y, r) { const k = new Rock(x, y, r); this.rocks.push(k); return k; }
  addShelter(x, y, kind = 'user') { const s = new Shelter(x, y, kind); this.shelters.push(s); return s; }

  spawnWildFood() {
    if (this.foods.length > 250) return;
    for (let i = 0; i < 8; i++) {
      const a = U.rand(Math.PI * 2), d = Math.sqrt(Math.random()) * (this.dish.r - 10);
      const x = this.dish.cx + Math.cos(a) * d, y = this.dish.cy + Math.sin(a) * d;
      if (!this.rockAt(x, y, 2)) { this.addFood(x, y, 'pellet'); return; }
    }
  }

  onFoodEaten(food) {
    if (food.plant) food.plant.berries = Math.max(0, food.plant.berries - 1);
  }

  eraseNear(x, y) {
    let best = null, bd = Infinity, list = null;
    const consider = (arr, reach) => {
      for (const o of arr) {
        const d = U.dist(o.pos.x, o.pos.y, x, y);
        if (d < reach(o) && d < bd) { bd = d; best = o; list = arr; }
      }
    };
    consider(this.foods, () => 5);
    consider(this.plants, () => 7);
    consider(this.rocks, (o) => o.r + 2);
    consider(this.shelters, () => 10);
    if (!best) return false;
    if (list === this.foods) best.eaten = true;
    else list.splice(list.indexOf(best), 1);
    this.effects.push(new Effect('ring', best.pos.x, best.pos.y, { r0: 1, r1: 6, life: 14, color: '#9d9d9d' }));
    return true;
  }

  creatureAt(x, y, reach = 8) {
    let best = null, bd = reach * reach;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = U.dist2(c.pos.x, c.pos.y, x, y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  log(msg, kind = '') { if (this.onLog) this.onLog(msg, kind, this.clockString()); }

  // ===========================================================
  // DRAW
  // ===========================================================
  draw(pg, opts) {
    const ctx = pg.drawingContext;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
    const dark = this.darkness;

    if (opts.debug) this.drawHeat(ctx);
    for (const s of this.shelters) s.draw(ctx, 0);
    for (const p of this.plants) p.draw(ctx, dark);
    for (const r of this.rocks) r.draw(ctx);
    for (const g of this.graves) g.draw(ctx);

    const living = this.creatures.filter((c) => c.alive).sort((a, b) => a.pos.y - b.pos.y);
    for (const c of living) c.draw(ctx, this, opts.frame);

    // night falls over the dish…
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(3,2,18,${dark * 0.62})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = dark;                      // …but the old terminals keep glowing
      for (const s of this.shelters) if (s.kind === 'user') s.draw(ctx, 1);
      ctx.globalAlpha = 1;
    }
    // food glows (drawn after the dark so it shines)
    for (const f of this.foods) if (!f.eaten) f.draw(ctx, this.tick, dark);

    // signals: expanding rings
    for (const s of this.signals) {
      const t = s.age / s.life;
      ctx.globalAlpha = (1 - t) * 0.8;
      Sprites.pixelCircle(ctx, s.x, s.y, 3 + t * CONFIG.SIGNAL_RANGE * 0.45, PAL.cyan);
    }
    ctx.globalAlpha = 1;
    for (const e of this.effects) e.draw(ctx);

    for (const c of living) c.drawOverlay(ctx, this, opts);
    if (opts.debug) this.drawDebug(ctx, living);
    if (opts.preview) opts.preview(ctx);
  }

  drawHeat(ctx) {
    const C = CONFIG.NEST_CELL;
    for (let i = 0; i < this.heat.length; i++) {
      if (this.heat[i] < 30) continue;
      const x = (i % this.heatCols) * C, y = Math.floor(i / this.heatCols) * C;
      ctx.fillStyle = `rgba(182,166,255,${Math.min(0.35, this.heat[i] / CONFIG.NEST_HEAT * 0.35)})`;
      ctx.fillRect(x, y, C, C);
    }
  }

  drawDebug(ctx, living) {
    for (const c of living) {
      Sprites.pixelLine(ctx, c.pos.x, c.pos.y, c.pos.x + c.vel.x * 10, c.pos.y + c.vel.y * 10, 'rgba(111,216,242,0.6)');
    }
    const s = this.selected;
    if (s && s.alive) {
      ctx.globalAlpha = 0.5;
      Sprites.pixelCircle(ctx, s.pos.x, s.pos.y, s.sense * this.visionMult, PAL.amber);
      Sprites.pixelCircle(ctx, s.pos.x, s.pos.y, CONFIG.SIGNAL_RANGE, PAL.cyan);
      ctx.globalAlpha = 1;
      if (s.target) Sprites.pixelLine(ctx, s.pos.x, s.pos.y, s.target.pos.x, s.target.pos.y, PAL.amber);
      if (s.memory.home) Sprites.pixelLine(ctx, s.pos.x, s.pos.y, s.memory.home.x, s.memory.home.y, '#b6a6ff');
      if (s.fearSource && s.fear > 0.1) Sprites.pixelLine(ctx, s.pos.x, s.pos.y, s.fearSource.x, s.fearSource.y, PAL.red);
      for (const o of s.neighbours) if (o.alive) Sprites.px(ctx, Math.round(o.pos.x), Math.round(o.pos.y) + 6, 1, 1, PAL.amber);
    }
  }

  // ===========================================================
  // SAVE / LOAD
  // ===========================================================
  serialize() {
    return {
      v: 1, savedAt: Date.now(), tick: this.tick, nextId: this.nextId, supply: this.supply, sandbox: this.sandbox,
      dish: { ...this.dish }, stats: this.stats, history: this.history, traitSnapshots: this.traitSnapshots,
      milestones: [...this.milestones], dominantWords: this.dominantWords,
      creatures: this.creatures.filter((c) => c.alive).map((c) => c.toJSON()),
      foods: this.foods.filter((f) => !f.eaten).map((f) => f.toJSON()),
      plants: this.plants.map((p) => p.toJSON()),
      rocks: this.rocks.map((r) => r.toJSON()),
      shelters: this.shelters.map((s) => s.toJSON()),
    };
  }

  deserialize(d) {
    this.reset();
    const D = this.dish, s = D.r / d.dish.r;
    const mx = (x) => D.cx + (x - d.dish.cx) * s, my = (y) => D.cy + (y - d.dish.cy) * s;
    this.tick = d.tick;
    this.supply = d.supply;
    this.sandbox = !!d.sandbox;
    Object.assign(this.stats, d.stats);
    this.history = d.history || [];
    this.traitSnapshots = d.traitSnapshots || [];
    this.milestones = new Set(d.milestones || []);
    this.dominantWords = d.dominantWords || {};
    for (const p of d.plants) this.addPlant(mx(p.x), my(p.y)).age = p.age;
    for (const r of d.rocks) this.rocks.push(new Rock(mx(r.x), my(r.y), r.r, r.seed));
    for (const sh of d.shelters) this.shelters.push(new Shelter(mx(sh.x), my(sh.y), sh.kind, sh.seed));
    for (const f of d.foods) {
      const food = this.addFood(mx(f.x), my(f.y), f.kind);
      food.age = f.age;
      if (f.kind === 'berry') {                       // re-attach berries to the nearest plant
        const p = this.plants.find((pl) => U.dist2(pl.pos.x, pl.pos.y, food.pos.x, food.pos.y) < 256);
        if (p) { food.plant = p; p.berries++; }
      }
    }
    let maxId = 0;
    for (const o of d.creatures) {
      const c = Creature.fromJSON(this, o, mx, my);
      this.creatures.push(c);
      maxId = Math.max(maxId, c.id);
    }
    this.nextId = Math.max(d.nextId, maxId + 1);
    this.updateLight();
    this.computeGroups();
    this.updateLanguage();
  }
}
