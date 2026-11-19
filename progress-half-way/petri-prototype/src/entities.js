// =============================================================
// entities.js; things in the dish that aren't creatures:
// food pellets, berry plants, rocks, shelters / nests, graves,
// and short-lived visual effects.
// =============================================================

const SPRITE_CACHE = {
  _plant: [],
  plant(stage) { return this._plant[stage] || (this._plant[stage] = Sprites.plant(stage)); },
  _shelter: {},
  shelter(lit) { return this._shelter[lit] || (this._shelter[lit] = Sprites.shelter(lit)); },
  _grave: null,
  grave() { return this._grave || (this._grave = Sprites.grave()); },
};

// ---------------------------------------------------------
class Food {
  constructor(x, y, kind = 'pellet', opts = {}) {
    this.pos = createVector(x, y);
    this.kind = kind;                      // 'pellet' (dropped / wild) or 'berry' (from a plant)
    this.nutrition = kind === 'berry' ? CONFIG.BERRY_NUTRITION : CONFIG.FOOD_NUTRITION;
    this.byUser = !!opts.byUser;           // used to teach creatures that the player feeds them
    this.born = opts.tick || 0;
    this.plant = opts.plant || null;
    this.age = 0;
    this.eaten = false;
    this.targetedBy = 0;                   // id of the creature heading for it
    this.phase = Math.random() * 6.28;
  }

  update() {
    this.age++;
    if (this.kind === 'pellet' && this.age > CONFIG.FOOD_LIFETIME) this.eaten = true; // rots away
  }

  draw(ctx, tick, glow) {
    const x = Math.round(this.pos.x), y = Math.round(this.pos.y);
    const rotting = this.kind === 'pellet' && this.age > CONFIG.FOOD_LIFETIME * 0.75;
    const col = this.kind === 'berry' ? [255, 82, 128] : rotting ? [130, 104, 60] : [255, 201, 74];
    const a = 0.1 + 0.07 * Math.sin(tick * 0.07 + this.phase) + glow * 0.18;
    ctx.fillStyle = U.rgbStr(col, a);
    ctx.fillRect(x - 2, y - 2, 5, 5);            // soft glow
    ctx.fillStyle = U.rgbStr(col);
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = rotting ? '#8a7a5a' : '#fff4c8';
    ctx.fillRect(x - 1, y - 1, 1, 1);            // highlight
  }

  toJSON() { return { x: this.pos.x, y: this.pos.y, kind: this.kind, age: this.age }; }
}

// ---------------------------------------------------------
class Plant {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.age = 0;
    this.timer = CONFIG.PLANT_INTERVAL * Math.random();
    this.berries = 0;
    this.r = 4;
  }

  get stage() {
    const t = this.age / CONFIG.PLANT_GROW_TIME;
    return t < 0.15 ? 0 : t < 0.5 ? 1 : t < 1 ? 2 : 3;
  }

  update(world) {
    this.age++;
    if (this.age < CONFIG.PLANT_GROW_TIME) return;
    if (--this.timer > 0) return;
    this.timer = CONFIG.PLANT_INTERVAL * U.rand(0.7, 1.3);
    if (this.berries >= CONFIG.PLANT_MAX_BERRIES) return;
    for (let tries = 0; tries < 6; tries++) {
      const a = U.rand(Math.PI * 2), d = U.rand(7, 14);
      const x = this.pos.x + Math.cos(a) * d, y = this.pos.y + Math.sin(a) * d;
      if (world.inDish(x, y, 4) && !world.rockAt(x, y, 2)) {
        world.addFood(x, y, 'berry', { plant: this });
        this.berries++;
        break;
      }
    }
  }

  draw(ctx, glow) {
    const s = SPRITE_CACHE.plant(this.stage);
    const x = Math.round(this.pos.x - s.width / 2), y = Math.round(this.pos.y - s.height + 2);
    if (glow > 0.2 && this.stage === 3) {
      ctx.fillStyle = `rgba(120,255,160,${0.06 * glow})`;
      ctx.fillRect(x - 2, y - 2, s.width + 4, s.height + 4);
    }
    ctx.drawImage(s, x, y);
  }

  toJSON() { return { x: this.pos.x, y: this.pos.y, age: this.age }; }
}

// ---------------------------------------------------------
class Rock {
  constructor(x, y, r, seed) {
    this.pos = createVector(x, y);
    this.r = r || U.randInt(4, 9);
    this.seed = seed || U.randInt(1, 1e9);
    this.img = Sprites.rock(this.r, this.seed);
  }
  draw(ctx) {
    ctx.drawImage(this.img, Math.round(this.pos.x - this.img.width / 2), Math.round(this.pos.y - this.img.height / 2));
  }
  toJSON() { return { x: this.pos.x, y: this.pos.y, r: this.r, seed: this.seed }; }
}

// ---------------------------------------------------------
// kind 'user' = placed by the player (an old terminal)
// kind 'nest' = built by the creatures themselves
class Shelter {
  constructor(x, y, kind = 'user', seed) {
    this.pos = createVector(x, y);
    this.kind = kind;
    this.r = CONFIG.SHELTER_RADIUS;
    this.seed = seed || U.randInt(1, 1e9);
    if (kind === 'nest') this.img = Sprites.nest(this.seed);
    this.occupants = 0;
  }
  draw(ctx, night) {
    if (this.kind === 'nest') {
      ctx.drawImage(this.img, Math.round(this.pos.x - this.img.width / 2), Math.round(this.pos.y - this.img.height / 2));
    } else {
      const s = SPRITE_CACHE.shelter(night > 0.3);
      const x = Math.round(this.pos.x - s.width / 2), y = Math.round(this.pos.y - s.height + 3);
      if (night > 0.3) {                         // the screen glows at night
        ctx.fillStyle = `rgba(125,255,155,${0.08 * night})`;
        ctx.fillRect(x - 3, y - 2, s.width + 6, s.height + 6);
      }
      ctx.drawImage(s, x, y);
    }
  }
  toJSON() { return { x: this.pos.x, y: this.pos.y, kind: this.kind, seed: this.seed }; }
}

// ---------------------------------------------------------
class Grave {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.age = 0;
    this.life = 60 * 25;
  }
  draw(ctx) {
    const a = 1 - this.age / this.life;
    if (a <= 0) return;
    ctx.globalAlpha = a * 0.8;
    ctx.drawImage(SPRITE_CACHE.grave(), Math.round(this.pos.x - 1), Math.round(this.pos.y - 3));
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------
// visual-only effects (rings, sparks)
class Effect {
  constructor(type, x, y, opts = {}) {
    this.type = type; this.x = x; this.y = y;
    this.age = 0;
    this.life = opts.life || 40;
    this.r0 = opts.r0 || 1;
    this.r1 = opts.r1 || 20;
    this.color = opts.color || PAL.cyan;
    this.vx = opts.vx || 0; this.vy = opts.vy || 0;
  }
  get done() { return this.age >= this.life; }
  update() { this.age++; this.x += this.vx; this.y += this.vy; this.vy += this.type === 'spark' ? 0.02 : 0; }
  draw(ctx) {
    const t = this.age / this.life;
    ctx.globalAlpha = 1 - t;
    if (this.type === 'ring') Sprites.pixelCircle(ctx, this.x, this.y, U.lerp(this.r0, this.r1, U.smooth(t)), this.color);
    else if (this.type === 'spark') Sprites.px(ctx, Math.round(this.x), Math.round(this.y), 1, 1, this.color);
    ctx.globalAlpha = 1;
  }
}
