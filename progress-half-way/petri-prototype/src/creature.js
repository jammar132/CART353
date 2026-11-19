// =============================================================
// creature.js; one autonomous agent.
// Every tick a creature:
//   1. PERCEIVES  nearby creatures, food, shelters, the cursor
//   2. METABOLISES  hunger rises, energy drains, health changes
//   3. DECIDES  which need wins right now (utility scores)
//   4. STEERS   blends Reynolds steering forces: separation · alignment · cohesion · seek · flee · wander · obstacle avoidance · stay-in-dish
//   5. MOVES
//   6. ACTS     eats, reproduces, calls out, learns from others
// =============================================================

const STATE = {
  WANDER: 'WANDER', FORAGE: 'FORAGE', EAT: 'EAT', SLEEP: 'SLEEP',
  FLEE: 'FLEE', SOCIAL: 'SOCIAL', CURIOUS: 'CURIOUS', STARE: 'STARE',
};

const STATE_LABEL = {
  WANDER: 'wandering', FORAGE: 'searching for food', EAT: 'eating', SLEEP: 'sleeping',
  FLEE: 'fleeing', SOCIAL: 'looking for others', CURIOUS: 'investigating', STARE: 'staring at you',
};

const SYLLABLES = ['ka', 'mi', 'bo', 'lu', 'ze', 'ti', 'no', 'ra', 'pi', 'su', 'yo', 've', 'gu', 'fa', 'ne', 'ho', 'qi', 'da'];
function makeName(id) {
  const r = U.seeded(id * 7919 + 13);
  const s = () => SYLLABLES[Math.floor(r() * SYLLABLES.length)];
  return (s() + s() + (r() < 0.3 ? s() : '')).toUpperCase();
}

class Creature {
  constructor(world, genome, x, y, parent = null) {
    this.id = world.nextId++;
    this.name = makeName(this.id);
    this.genome = genome;
    this.gen = parent ? parent.gen + 1 : 1;
    this.parentId = parent ? parent.id : null;

    // body
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(0.2);
    this.acc = createVector(0, 0);
    this.wanderTheta = U.rand(Math.PI * 2);
    this.speedMult = 1;

    // needs, all 0..1
    this.hunger = parent ? 0.35 : 0.3;
    this.energy = parent ? 0.7 : 0.9;
    this.health = 1;
    this.fear = 0;
    this.fearSource = null;
    this.age = 0;
    this.lastHarm = null;

    // mind
    this.state = STATE.WANDER;
    this.stateTicks = 0;
    this.target = null;               // food it is heading for
    this.eatTicks = 0;
    this.memory = { food: null, home: null, foodLead: 0 };
    this.investigate = null;          // {x, y, t} something odd to check out
    this.socialTarget = null;         // {x, y, t} where someone called "GATHER"
    this.stareTicks = 0;
    this.stareCooldown = 0;
    this.lonely = 0;
    this.reproCooldown = 0;
    this.signalCooldown = U.randInt(0, 120);
    this.pendingCall = null;          // a call to make on our next turn
    this.lexicon = Language.founderLexicon();
    this.trust = 0;                   // LEARNED attitude toward the player (-1..1)
    this.children = 0;
    this.wordsLearned = 0;

    // perception caches (reused arrays = less garbage)
    this.neighbours = [];
    this.nearFood = [];
    this.shelter = null;
    this.cursorDist = Infinity;
    this.flock = { sepX: 0, sepY: 0, alX: 0, alY: 0, coX: 0, coY: 0, n: 0, close: 0, staring: 0, threatX: 0, threatY: 0, threats: 0 };
    this.groupId = 0;
    this.groupSize = 1;

    // looks
    this.sprite = Sprites.creature(genome);
    this.portraitURL = null;
    this.emote = null;
    this.bubble = null;
    this.blinkIn = U.randInt(120, 400);
    this.blinkT = 0;
    this.look = { x: 0, y: 0.5 };
    this.drawX = 0; this.drawY = 0;

    this.alive = true;
    this.causeOfDeath = null;

    // phenotype (genes → numbers)
    this.maxSpeed = genome.maxSpeed;
    this.maxForce = this.maxSpeed * 0.09;
    this.radius = this.sprite.W / 2;
    this.sense = genome.senseRadius;
    this.lifespan = genome.lifespan;
    this.hungerRate = genome.hungerRate;
  }

  get g() { return this.genome.genes; }
  get label() { return `${this.name}-${U.pad(this.id)}`; }
  get isAdult() { return this.age >= CONFIG.MATURITY; }
  get isElder() { return this.age > this.lifespan * 0.82; }
  get mood() {
    if (!this.alive) return 'gone';
    if (this.fear > 0.5) return 'frightened';
    if (this.hunger > 0.75) return 'starving';
    if (this.state === STATE.SLEEP) return 'asleep';
    if (this.energy < 0.25) return 'exhausted';
    if (this.stareTicks > 0) return 'fixated';
    if (this.lonely > 400 && this.g.sociability > 0.5) return 'lonely';
    if (this.hunger < 0.35 && this.energy > 0.5) return 'content';
    return 'restless';
  }

  // ============
  // MAIN LOOP
  // ==============
  update(world) {
    this.age++;
    this.stateTicks++;
    if (this.signalCooldown > 0) this.signalCooldown--;
    if (this.reproCooldown > 0) this.reproCooldown--;
    if (this.emote && --this.emote.t <= 0) this.emote = null;
    if (this.bubble && --this.bubble.t <= 0) this.bubble = null;
    if (this.investigate && --this.investigate.t <= 0) this.investigate = null;
    if (this.socialTarget && --this.socialTarget.t <= 0) this.socialTarget = null;
    if (this.memory.foodLead > 0) this.memory.foodLead--;
    if (this.stareTicks > 0 && --this.stareTicks === 0) this.stareCooldown = U.randInt(900, 2000);
    if (this.stareCooldown > 0) this.stareCooldown--;

    this.perceive(world);
    this.metabolise(world);
    if (!this.alive) return;
    this.observeCursor(world);
    this.decide(world);
    this.steer(world);
    this.move(world);
    this.act(world);
  }

  // ===============
  // 1. PERCEIVE
  // ===============
  perceive(world) {
    const r = this.sense * world.visionMult;
    world.creatureGrid.query(this.pos.x, this.pos.y, r, this.neighbours);
    const i = this.neighbours.indexOf(this);
    if (i >= 0) { this.neighbours[i] = this.neighbours[this.neighbours.length - 1]; this.neighbours.pop(); }
    world.foodGrid.query(this.pos.x, this.pos.y, r, this.nearFood);

    this.shelter = world.shelterAt(this.pos.x, this.pos.y);
    // MEMORY: remember the closest shelter seen as "home"
    const seen = world.nearestShelter(this.pos.x, this.pos.y, r);
    if (seen) {
      const h = this.memory.home;
      if (!h || U.dist2(this.pos.x, this.pos.y, h.x, h.y) > U.dist2(this.pos.x, this.pos.y, seen.pos.x, seen.pos.y) + 900) {
        this.memory.home = seen.pos.copy();
      }
    }
    this.scanNeighbours();
  }

  // One pass over neighbours collects everything flocking needs.
  scanNeighbours() {
    const f = this.flock;
    f.sepX = f.sepY = f.alX = f.alY = f.coX = f.coY = f.threatX = f.threatY = 0;
    f.n = f.close = f.staring = f.threats = 0;
    const sepDist = this.radius * 2 + 3;
    let awake = 0;
    for (const o of this.neighbours) {
      if (!o.alive) continue;
      let dx = this.pos.x - o.pos.x, dy = this.pos.y - o.pos.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.0001) { dx = U.rand(-0.5, 0.5); dy = U.rand(-0.5, 0.5); d2 = dx * dx + dy * dy + 0.0001; }
      const d = Math.sqrt(d2);
      // SEPARATION
      if (d < sepDist) {
        const w = (sepDist - d) / sepDist;
        f.sepX += (dx / d) * w; f.sepY += (dy / d) * w; f.close++;
        const overlap = this.radius + o.radius - 1 - d;          // don't stack bodies
        if (overlap > 0) { this.pos.x += (dx / d) * overlap * 0.2; this.pos.y += (dy / d) * overlap * 0.2; }
      }
      // ALIGNMENT + COHESION; only with a limited number of awake flockmates
      if (o.state !== STATE.SLEEP) {
        awake++;
        if (f.n < CONFIG.MAX_FLOCKMATES) { f.alX += o.vel.x; f.alY += o.vel.y; f.coX += o.pos.x; f.coY += o.pos.y; f.n++; }
      }
      if (o.stareTicks > 0) f.staring++;
      // bullies nearby?
      if (o.state === STATE.FORAGE && d < 24 && o.g.aggression > 0.6 && o.g.aggression > this.g.aggression) {
        f.threatX += dx / d; f.threatY += dy / d; f.threats++;
      }
    }
    f.awake = awake;
    if (this.neighbours.length === 0) this.lonely++;
    else {
      if (this.lonely > 300 && this.g.sociability > 0.5) this.setEmote('heart', 40); // reunited
      this.lonely = 0;
    }
  }

  // =============
  // 2. METABOLISE
  // ============+
  metabolise(world) {
    const g = this.g;
    const sleeping = this.state === STATE.SLEEP;
    const speedFrac = this.vel.mag() / this.maxSpeed;

    this.hunger += this.hungerRate * (sleeping ? 0.4 : 1);
    if (sleeping) {
      this.energy += CONFIG.ENERGY_SLEEP_GAIN * (this.shelter ? CONFIG.SHELTER_SLEEP_MULT : 1);
    } else {
      const cost = CONFIG.ENERGY_IDLE + CONFIG.ENERGY_MOVE * speedFrac * speedFrac * (0.8 + 0.4 * g.size);
      this.energy -= cost * (1 + 0.3 * world.darkness);
    }
    this.hunger = U.clamp(this.hunger, 0, 1);
    this.energy = U.clamp(this.energy, 0, 1);

    if (this.hunger >= 1) { this.health -= CONFIG.STARVE_DAMAGE; this.lastHarm = 'starved'; }
    else if (this.energy <= 0) { this.health -= CONFIG.EXHAUST_DAMAGE; this.lastHarm = 'exhausted'; }
    else if (this.hunger < 0.6 && this.energy > 0.2) {
      this.health = Math.min(1, this.health + CONFIG.HEAL_RATE * (0.7 + 0.6 * g.metabolism));
    }

    // fear fades; faster when safe inside a shelter
    this.fear = Math.max(0, this.fear - CONFIG.FEAR_DECAY * (this.shelter ? 3 : 1));
    if (this.fear < 0.05) this.fearSource = null;

    if (this.health <= 0) this.die(world, this.lastHarm || 'unknown');
    else if (this.age > this.lifespan) this.die(world, 'old age');
  }

  // =====================================================================
  // the player's cursor (gentle part — harm happens in World.applyCursor)
  // =====================================================================
  observeCursor(world) {
    const c = world.cursor;
    if (!c.inside) { this.cursorDist = Infinity; return; }
    this.cursorDist = U.dist(this.pos.x, this.pos.y, c.x, c.y);
    const g = this.g;
    const awake = this.state !== STATE.SLEEP && this.state !== STATE.EAT && this.state !== STATE.FLEE;

    // a still cursor resting on a creature = attention
    if (c.still && awake && this.cursorDist < this.radius + 5) {
      const liking = g.affinity + this.trust - g.fear * 0.5;
      if (liking > 0.2) {
        this.trust = Math.min(1, this.trust + CONFIG.TRUST_FROM_ATTENTION);
        if (U.chance(0.008)) this.setEmote('heart', 40);
      } else if (U.chance(0.01)) this.addFear(0.2, c.x, c.y, world);
    }

    // STARING spreads by imitation: the more neighbours stare, the likelier you join in
    if (awake && this.stareTicks <= 0 && this.stareCooldown <= 0) {
      const sees = c.still && this.cursorDist < this.sense * 2;
      const frac = this.neighbours.length ? this.flock.staring / this.neighbours.length : 0;
      const p = (sees ? CONFIG.STARE_BASE * (g.curiosity + g.affinity) : 0) + CONFIG.STARE_CONTAGION * frac;
      if (p > 0 && U.chance(p)) this.stareTicks = U.randInt(120, 300);
    }
  }

  // =======================================================
  // 3. DECIDE; every need gets a score; the strongest wins.
  // =======================================================
  decide(world) {
    if (this.eatTicks > 0) { this.setState(STATE.EAT, world); return; }
    const g = this.g, c = world.cursor;
    const s = {};

    s.WANDER = 0.25;
    s.FORAGE = this.hunger < 0.22 ? 0 : (this.hunger - 0.22) * 1.7 + (this.memory.foodLead > 0 ? 0.15 : 0);
    s.SLEEP = this.energy > 0.55 ? 0 : (0.55 - this.energy) * 2.4;
    if (world.darkness > 0.4 && this.energy < 0.8) s.SLEEP += 0.45 * world.darkness;
    s.FLEE = this.fear > 0.22 ? this.fear * 1.6 : 0;
    const crowd = Math.min(1, this.neighbours.length / 4);
    s.SOCIAL = g.sociability * (1 - crowd) * 0.75 + (this.socialTarget ? 0.15 * g.sociability : 0);
    s.CURIOUS = this.investigate ? g.curiosity * 0.7 : 0;
    if (c.inside && c.still && this.cursorDist < this.sense * 1.6) {
      // innate attraction + learned trust − fear (never stronger than real hunger)
      const attraction = g.curiosity * 0.4 + g.affinity * 0.5 + this.trust * 0.35 - g.fear * 0.4;
      s.CURIOUS = Math.max(s.CURIOUS, attraction * 0.75 * (1.1 - this.hunger));
    }
    s.STARE = this.stareTicks > 0 && this.hunger < 0.6 ? 0.7 : 0;

    // stickiness: keep doing the current thing unless something is clearly more urgent
    if (this.state in s) s[this.state] += 0.12;
    if (this.state === STATE.SLEEP && this.fear < 0.45) {
      if (this.energy < 0.97) s.SLEEP += 0.7;
      s.SLEEP += 0.7 * world.darkness;           // sleep through the night
    }
    if (this.fear > 0.35) s.SLEEP = 0;           // too scared to sleep…
    if (this.energy <= 0.02) s.SLEEP = 5;        // …unless collapsing

    let best = STATE.WANDER, bestV = -1;
    for (const k in s) if (s[k] > bestV) { bestV = s[k]; best = k; }
    this.setState(best, world);
  }

  setState(st, world) {
    if (st === this.state) return;
    this.state = st;
    this.stateTicks = 0;
    if (st === STATE.STARE || st === STATE.SLEEP) this.target = null;
    // going to sleep in a shelter: tell others where home is
    if (st === STATE.SLEEP && this.shelter && this.g.sociability > 0.5 && U.chance(0.5)) {
      this.pendingCall = { meaning: 'HOME', x: this.shelter.pos.x, y: this.shelter.pos.y };
    }
  }

  // ===========================================================
  // 4. STEER; Reynolds-style behaviours blended by weight
  // ===========================================================
  steer(world) {
    const g = this.g, f = this.flock;
    let speedMult = 1;

    // always-on rules
    if (f.close) this.steerDir(f.sepX, f.sepY, CONFIG.W_SEPARATION);
    this.avoidRocks(world, CONFIG.W_AVOID);
    this.stayInDish(world, CONFIG.W_EDGE);
    if (f.threats && g.fear > 0.35) this.steerDir(f.threatX, f.threatY, CONFIG.W_FLEE * g.fear);

    const social = g.sociability;
    switch (this.state) {
      case STATE.WANDER:
        speedMult = 0.55;
        this.wander(CONFIG.W_WANDER * (0.6 + g.curiosity * 0.8));
        this.flockForces(social * 0.8);
        break;

      case STATE.FORAGE: {
        speedMult = 0.85 + this.hunger * 0.3;
        this.chooseFood();
        if (this.target) {
          this.seek(this.target.pos.x, this.target.pos.y, CONFIG.W_SEEK * 1.3, 6);
        } else if (this.memory.food) {
          const m = this.memory.food;
          this.seek(m.x, m.y, CONFIG.W_SEEK);
          if (U.dist2(this.pos.x, this.pos.y, m.x, m.y) < 64) this.memory.food = null; // nothing left here
          this.flockForces(social * 0.3);
        } else {
          this.wander(CONFIG.W_WANDER * 1.6);
          this.flockForces(social * 0.4);         
        }
        break;
      }

      case STATE.EAT:
      case STATE.STARE:
        speedMult = 0;
        break;

      case STATE.SLEEP: {
        speedMult = 0.45;
        const h = this.memory.home;
        if (h && !this.shelter && this.energy > 0.06 && this.stateTicks < 60 * 20) {
          if (U.dist2(this.pos.x, this.pos.y, h.x, h.y) > 36) this.seek(h.x, h.y, CONFIG.W_SEEK, 10);
          else this.memory.home = null;              // the shelter is gone
        } else speedMult = 0;
        break;
      }

      case STATE.FLEE: {
        // the FEAR gene = vigilance: fearful creatures sprint harder and zig-zag (see World.applyCursor)
        speedMult = 1.3 + 0.7 * g.fear;
        if (this.fearSource) this.flee(this.fearSource.x, this.fearSource.y, CONFIG.W_FLEE);
        else this.wander(CONFIG.W_WANDER * 2);
        if (g.fear > 0.4) this.wander(CONFIG.W_WANDER * g.fear);
        const h = this.memory.home;
        if (h && this.fear > 0.5) this.seek(h.x, h.y, CONFIG.W_SEEK * 0.6, 8);
        this.flockForces(social * 0.5);             // herd together when afraid
        break;
      }

      case STATE.SOCIAL:
        speedMult = 0.7;
        if (f.n > 0) this.flockForces(0.6 + social * 1.2);
        else if (this.socialTarget) this.seek(this.socialTarget.x, this.socialTarget.y, CONFIG.W_SEEK, 10);
        else this.wander(CONFIG.W_WANDER * 1.3);
        break;

      case STATE.CURIOUS: {
        speedMult = 0.65;
        const c = world.cursor;
        let tx, ty, stop;
        if (c.inside && c.still && this.cursorDist < this.sense * 1.6) {
          tx = c.x; ty = c.y;
          stop = 5 + (1 - U.clamp(this.trust + g.affinity, 0, 1)) * 14;   // shy ones keep their distance
        } else if (this.investigate) {
          tx = this.investigate.x; ty = this.investigate.y; stop = 4;
          if (U.dist2(this.pos.x, this.pos.y, tx, ty) < 64) this.investigate = null;
        }
        if (tx !== undefined) {
          const d = U.dist(this.pos.x, this.pos.y, tx, ty);
          if (d > stop) this.seek(tx, ty, CONFIG.W_SEEK, 10, stop); else this.brake();
        }
        this.flockForces(social * 0.3);
        break;
      }
    }
    if (this.energy < 0.15) speedMult *= 0.55;
    if (this.isElder) speedMult *= 0.75;
    this.speedMult = speedMult;
  }

  // --- steering primitives (all add into this.acc) ---
  _steer(desX, desY, w) {
    let sx = desX - this.vel.x, sy = desY - this.vel.y;
    const m = Math.hypot(sx, sy), mf = this.maxForce;
    if (m > mf) { sx = (sx / m) * mf; sy = (sy / m) * mf; }
    this.acc.x += sx * w;
    this.acc.y += sy * w;
  }

  // seek a point; slow down inside arriveR, stop at `stop`
  seek(tx, ty, w, arriveR = 0, stop = 0) {
    const dx = tx - this.pos.x, dy = ty - this.pos.y, d = Math.hypot(dx, dy);
    if (d < 0.001) return;
    let sp = this.maxSpeed;
    if (arriveR > 0) sp *= U.clamp((d - stop) / arriveR, 0, 1);
    this._steer((dx / d) * sp, (dy / d) * sp, w);
  }

  flee(tx, ty, w) {
    let dx = this.pos.x - tx, dy = this.pos.y - ty;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) { dx = U.rand(-1, 1); dy = U.rand(-1, 1); }
    this.steerDir(dx, dy, w);
  }

  steerDir(dx, dy, w) {
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    this._steer((dx / d) * this.maxSpeed, (dy / d) * this.maxSpeed, w);
  }

  wander(w) {
    this.wanderTheta += U.rand(-0.4, 0.4);
    const vm = Math.hypot(this.vel.x, this.vel.y);
    const hx = vm > 0.01 ? this.vel.x / vm : Math.cos(this.wanderTheta);
    const hy = vm > 0.01 ? this.vel.y / vm : Math.sin(this.wanderTheta);
    this.seek(this.pos.x + hx * 8 + Math.cos(this.wanderTheta) * 5, this.pos.y + hy * 8 + Math.sin(this.wanderTheta) * 5, w);
  }

  // ALIGNMENT (match heading) + COHESION (move to the group's centre)
  flockForces(w) {
    const f = this.flock;
    if (!f.n || w <= 0) return;
    this.steerDir(f.alX, f.alY, CONFIG.W_ALIGNMENT * w);
    this.seek(f.coX / f.n, f.coY / f.n, CONFIG.W_COHESION * w, 12, 4);
  }

  avoidRocks(world, w) {
    for (const r of world.rocks) {
      const dx = this.pos.x - r.pos.x, dy = this.pos.y - r.pos.y, d = Math.hypot(dx, dy);
      const minD = r.r + this.radius + 3, look = 10;
      if (d > minD + look || d < 0.001) continue;
      const ax = dx / d, ay = dy / d;
      let tx = -ay, ty = ax;                                   // slide around the rock
      if (tx * this.vel.x + ty * this.vel.y < 0) { tx = -tx; ty = -ty; }
      this.steerDir(ax + tx * 0.8, ay + ty * 0.8, w * (minD + look - d) / look);
    }
  }

  stayInDish(world, w) {
    const D = world.dish, d = U.dist(this.pos.x, this.pos.y, D.cx, D.cy);
    const edge = D.r - this.radius - 14;
    if (d > edge) this.seek(D.cx, D.cy, w * U.clamp((d - edge) / 14, 0, 1.5));
  }

  brake() { this.acc.x -= this.vel.x * 0.2; this.acc.y -= this.vel.y * 0.2; }

  // ===========================================================
  // 5. MOVE
  // ===========================================================
  move(world) {
    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;
    if (this.speedMult === 0) this.vel.mult(0.75);
    else {
      const lim = this.maxSpeed * this.speedMult;
      if (this.vel.magSq() > lim * lim) this.vel.setMag(lim);
    }
    this.pos.add(this.vel);
    this.acc.set(0, 0);
    world.constrain(this);
  }

  // ===========================================================
  // 6. ACT
  // ===========================================================
  act(world) {
    const g = this.g;

    // eating
    const reach = this.radius + 2.5;
    if (this.eatTicks > 0) this.eatTicks--;
    else if (this.state === STATE.FORAGE && this.target && !this.target.eaten) {
      if (U.dist2(this.pos.x, this.pos.y, this.target.pos.x, this.target.pos.y) < reach * reach) this.tryEat(this.target, world);
    } else if (this.hunger > 0.3 && this.state !== STATE.SLEEP && this.state !== STATE.FLEE) {
      // opportunistic: food right under your nose gets eaten whatever you're doing
      for (const f of this.nearFood) {
        if (!f.eaten && U.dist2(this.pos.x, this.pos.y, f.pos.x, f.pos.y) < reach * reach) { this.tryEat(f, world); break; }
      }
    }

    // reproduction (budding)
    if (this.canReproduce(world)) {
      let p = CONFIG.REPRO_CHANCE * U.lerp(0.5, 1.6, g.fertility);
      if (this.neighbours.length > CONFIG.CROWD_LIMIT) p *= 0.25;
      p *= 1 - (world.creatures.length / world.maxPop) * 0.6;
      if (U.chance(p)) world.reproduce(this);
    }

    // calling out
    if (this.pendingCall) {
      world.emitSignal(this, this.pendingCall.meaning, this.pendingCall);
      this.pendingCall = null;
    } else if (this.lonely > 400 && g.sociability > 0.4 && U.chance(0.004 * g.sociability)) {
      world.emitSignal(this, 'GATHER', this.pos);
    }

    // social learning: attitudes toward the player rub off on neighbours
    if (this.neighbours.length && this.state !== STATE.SLEEP) {
      const o = this.neighbours[U.randInt(0, this.neighbours.length)];
      if (o.alive) this.trust += (o.trust - this.trust) * CONFIG.TRUST_SOCIAL_RATE * (0.5 + g.sociability);
    }

    // sleeping out in the open leaves "warmth" — enough of it and they build a nest
    if (this.state === STATE.SLEEP && !this.shelter) world.addSleepHeat(this.pos.x, this.pos.y);
  }

  chooseFood() {
    const t = this.target;
    if (t && !t.eaten && this.stateTicks % 20 !== 0) return;
    let best = null, bestScore = Infinity;
    const aggr = this.g.aggression;
    for (const f of this.nearFood) {
      if (f.eaten) continue;
      let s = Math.hypot(f.pos.x - this.pos.x, f.pos.y - this.pos.y);
      if (f.targetedBy && f.targetedBy !== this.id) s += 28 * (1 - aggr);   // polite ones avoid claimed food
      if (s < bestScore) { bestScore = s; best = f; }
    }
    if (t && t !== best && t.targetedBy === this.id) t.targetedBy = 0;
    this.target = best;
    if (best) best.targetedBy = this.id;
  }

  tryEat(food, world) {
    const g = this.g;
    // competition with anyone else right at the same food
    for (const o of this.neighbours) {
      if (!o.alive || o === this || o.target !== food) continue;
      if (U.dist2(o.pos.x, o.pos.y, food.pos.x, food.pos.y) > 144) continue;
      // the more assertive one (aggression + size + luck) gets the food
      const mine = g.aggression + g.size * 0.3 + U.rand(0.2);
      const theirs = o.g.aggression + o.g.size * 0.3 + U.rand(0.2);
      if (theirs > mine + 0.05) {                              // back off
        this.target = null;
        this.addFear(0.08 + 0.1 * g.fear, o.pos.x, o.pos.y, world);
        return;
      }
      if (g.aggression > 0.55) this.shove(o, world);
      else { o.target = null; }
    }

    food.eaten = true;
    world.onFoodEaten(food);
    this.hunger = Math.max(0, this.hunger - food.nutrition);
    this.eatTicks = 34;
    this.target = null;
    this.setState(STATE.EAT, world);
    this.memory.food = { x: food.pos.x, y: food.pos.y };
    this.setEmote('sparkle', 30);

    // learning: "the hand feeds me"
    if (food.byUser && world.tick - food.born < 60 * 20) this.trust = Math.min(1, this.trust + CONFIG.TRUST_FROM_FEEDING);

    // generous, social creatures announce food
    let others = 0;
    for (const f of this.nearFood) if (!f.eaten) others++;
    if (others > 0 && g.aggression < 0.65 && U.chance(0.25 + g.sociability * 0.6)) {
      this.pendingCall = { meaning: 'FOOD', x: food.pos.x, y: food.pos.y };
    }
  }

  shove(o, world) {
    const dx = o.pos.x - this.pos.x, dy = o.pos.y - this.pos.y, d = Math.hypot(dx, dy) || 1;
    o.vel.x += (dx / d) * 1.6;
    o.vel.y += (dy / d) * 1.6;
    o.health -= 0.035 * this.g.aggression * (1.2 - o.g.size * 0.4);
    o.lastHarm = 'wounded';
    o.target = null;
    o.addFear(0.3, this.pos.x, this.pos.y, world);
    this.energy = Math.max(0, this.energy - 0.015);
    this.setEmote('anger', 40);
    world.stats.fights++;
    // hawk vs hawk: an aggressive victim may hit back, so aggression is costly when common
    if (o.alive && o.health > 0 && o.g.aggression > 0.5 && U.chance(o.g.aggression)) {
      this.health -= 0.035 * o.g.aggression * (1.2 - this.g.size * 0.4);
      this.lastHarm = 'wounded';
      this.addFear(0.2, o.pos.x, o.pos.y, world);
      o.setEmote('anger', 40);
      if (this.health <= 0) this.die(world, 'wounded');
    }
    if (o.health <= 0) o.die(world, 'wounded');
  }

  canReproduce(world) {
    return this.age >= CONFIG.MATURITY
      && this.reproCooldown <= 0
      && this.hunger < CONFIG.REPRO_HUNGER_MAX
      && this.energy > CONFIG.REPRO_ENERGY_MIN
      && this.health > CONFIG.REPRO_HEALTH_MIN
      && this.fear < 0.4
      && (this.state === STATE.WANDER || this.state === STATE.SOCIAL || this.state === STATE.CURIOUS)
      && world.creatures.length + world.births.length < world.maxPop;
  }

  addFear(amount, sx, sy, world) {
    const before = this.fear;
    this.fear = Math.min(1, this.fear + amount);
    this.fearSource = { x: sx, y: sy };
    if (this.state === STATE.SLEEP && this.fear > 0.3) this.setState(STATE.FLEE, world);   // woken up
    if (before < 0.5 && this.fear >= 0.5) {
      this.setEmote('excl', 45);
      if (this.stareTicks > 0) { this.stareTicks = 0; this.stareCooldown = 600; }
      if (U.chance(0.35 + this.g.sociability * 0.4)) this.pendingCall = { meaning: 'DANGER', x: sx, y: sy };
    }
  }

  // ==============
  // COMMUNICATION
  // ==============
  hear(sig, world) {
    if (!this.alive) return;
    const g = this.g;
    if (this.state === STATE.SLEEP && sig.meaning !== 'DANGER') return;   // sleeps through it

    if (this.lexicon[sig.meaning] === sig.symbol) {              // understood
      world.stats.understood++;
      this.respond(sig, world);
      return;
    }

    // an unfamiliar word
    world.stats.unknown++;
    if (!this.emote) this.setEmote('question', 40);
    if (g.curiosity > 0.45 && !this.investigate) this.investigate = { x: sig.x, y: sig.y, t: 240 };

    // IMITATION: maybe copy the word. Young & sociable creatures learn more.
    const p = CONFIG.LEARN_RATE * (0.3 + g.sociability) * (this.isAdult ? 1 : 1.8);
    if (U.chance(p)) {
      // usually the context reveals the meaning… sometimes they get it wrong
      const meaning = U.chance(CONFIG.CONTEXT_INFER) ? sig.meaning : U.pick(MEANINGS);
      this.lexicon[meaning] = sig.symbol;
      this.wordsLearned++;
      if (meaning === sig.meaning) this.respond(sig, world);
    }
  }

  respond(sig, world) {
    const g = this.g;
    switch (sig.meaning) {
      case 'FOOD':
        if (this.hunger > 0.18) { this.memory.food = { x: sig.tx, y: sig.ty }; this.memory.foodLead = 300; }
        break;
      case 'DANGER':
        this.addFear(0.18 + 0.4 * g.fear, sig.tx, sig.ty, world);   // may relay the alarm
        break;
      case 'GATHER':
        if (g.sociability > 0.3) {
          this.socialTarget = { x: sig.x, y: sig.y, t: 300 };
          if (this.lonely > 200 && U.chance(0.3 * g.sociability)) this.pendingCall = { meaning: 'GATHER', x: this.pos.x, y: this.pos.y };
        }
        break;
      case 'HOME':
        this.memory.home = createVector(sig.tx, sig.ty);
        break;
    }
  }

  setEmote(name, t) { this.emote = { name, t }; }

  die(world, cause) {
    if (!this.alive) return;
    this.alive = false;
    this.causeOfDeath = cause;
    this.deathTick = world.tick;
    if (this.target && this.target.targetedBy === this.id) this.target.targetedBy = 0;
    world.onDeath(this);
  }

  // =======
  // DRAWING
  // ======
  updateLook(world) {
    const c = world.cursor;
    let tx, ty;
    if ((this.stareTicks > 0 || this.state === STATE.CURIOUS) && c.inside) { tx = c.x; ty = c.y; }
    else if (this.state === STATE.FLEE && this.fearSource) { tx = this.fearSource.x; ty = this.fearSource.y; }
    else if (this.target) { tx = this.target.pos.x; ty = this.target.pos.y; }
    else if (this.vel.magSq() > 0.01) { tx = this.pos.x + this.vel.x * 10; ty = this.pos.y + this.vel.y * 10; }
    else return;
    const dx = tx - this.pos.x, dy = ty - this.pos.y, d = Math.hypot(dx, dy) || 1;
    this.look.x = dx / d; this.look.y = dy / d;
  }

  expression() {
    if (this.state === STATE.SLEEP) return 'closed';
    if (this.blinkT > 0) return 'blink';
    if (this.fear > 0.5) return 'scared';
    if (this.state === STATE.EAT || (this.emote && this.emote.name === 'heart')) return 'happy';
    if (this.emote && this.emote.name === 'anger') return 'angry';
    if (this.hunger > 0.85 || this.health < 0.3) return 'sad';
    return 'open';
  }

  draw(ctx, world, frame) {
    const s = this.sprite;
    // per-frame animation state
    this.updateLook(world);
    if (--this.blinkIn <= 0) { this.blinkT = 6; this.blinkIn = U.randInt(150, 420); }
    if (this.blinkT > 0) this.blinkT--;

    const sp = this.vel.mag();
    let bob = 0, jx = 0;
    if (this.state !== STATE.SLEEP && sp > 0.12) bob = Math.floor(this.age * sp * 0.22) % 2 ? -1 : 0;  // little steps
    if (this.state === STATE.EAT) bob = Math.floor(this.age / 6) % 2;
    if (this.fear > 0.6 && this.state !== STATE.SLEEP) jx = frame % 4 < 2 ? 1 : 0;                    // shivering
    const x = Math.round(this.pos.x - s.ax) + jx;
    const y = Math.round(this.pos.y - s.ay) + bob;
    this.drawX = x; this.drawY = y;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 3, y + s.bottom + 1, s.w - 6, 1);
    ctx.drawImage(s.canvas, x, y);
    this.drawEyes(ctx, x, y, world, false);
  }

  drawEyes(ctx, x, y, world, glow) {
    const s = this.sprite, ex = this.expression();
    const P = Sprites.px;
    const white = glow ? '#dff8ff' : PAL.white;
    const pupil = this.stareTicks > 0 && world.stareFraction > 0.3 ? '#a00d0a' : PAL.pupil;
    const lx = this.look.x, ly = this.look.y;

    for (const e of s.eyes) {
      const X = x + e.x, Y = y + e.y;
      const leftEye = e.x + e.w / 2 < s.ax;
      if (e.third) {                                   // the strange third eye (a slit)
        if (ex === 'closed' || ex === 'blink') P(ctx, X, Y + 1, 1, 1, s.outline);
        else { P(ctx, X, Y, 1, 2, white); P(ctx, X, Y + 1, 1, 1, pupil); }
        continue;
      }
      switch (ex) {
        case 'closed': P(ctx, X, Y + 2, e.w, 1, s.outline); break;
        case 'blink': P(ctx, X, Y + 1, e.w, 1, s.outline); break;
        case 'happy':
          P(ctx, X, Y + 1, e.w, 1, s.outline);
          if (!glow) P(ctx, X, Y + 3, e.w, 1, PAL.blush);
          break;
        case 'scared':                                  // wide eyes, tiny pupils
          P(ctx, X, Y, e.w, e.h, white);
          P(ctx, X + Math.floor(e.w / 2) - (e.w === 2 && lx < 0 ? 1 : 0), Y + 1, 1, 1, pupil);
          break;
        case 'angry':
          P(ctx, X, Y + 1, e.w, e.h - 1, white);
          P(ctx, X + (lx > 0 ? e.w - 1 : 0), Y + 2, 1, 1, pupil);
          P(ctx, leftEye ? X + e.w - 1 : X, Y, 1, 1, s.outline);       // brow
          break;
        case 'sad':
          P(ctx, X, Y + 1, e.w, e.h - 1, white);
          P(ctx, X + (lx > 0 ? e.w - 1 : 0), Y + 2, 1, 1, pupil);
          P(ctx, leftEye ? X : X + e.w - 1, Y, 1, 1, s.outline);       // droopy brow
          break;
        default: {                                       // open, looking around
          P(ctx, X, Y, e.w, e.h, white);
          let pxl;
          if (e.w === 3) pxl = 1 + (lx > 0.35 ? 1 : lx < -0.35 ? -1 : 0);
          else pxl = lx > 0.2 ? 1 : lx < -0.2 ? 0 : (leftEye ? 1 : 0);  // straight ahead: slightly cross-eyed
          P(ctx, X + pxl, Y + (ly < -0.35 ? 0 : 1), 1, 2, pupil);
        }
      }
    }
    if (!glow && s.hasMouth) {
      if (this.state === STATE.EAT) P(ctx, x + s.mouth.x, y + s.mouth.y, 1, Math.floor(this.age / 5) % 2 ? 2 : 1, s.outline);
      else if (ex === 'scared') P(ctx, x + s.mouth.x, y + s.mouth.y, 1, 1, s.outline);
    }
  }

  // drawn after the night overlay so it stays readable
  drawOverlay(ctx, world, opts) {
    const s = this.sprite, x = this.drawX, y = this.drawY, cx = Math.round(this.pos.x);
    if (world.darkness > 0.25 && this.state !== STATE.SLEEP) {   // eyes glow in the dark
      ctx.globalAlpha = Math.min(1, world.darkness * 1.4);
      this.drawEyes(ctx, x, y, world, true);
      ctx.globalAlpha = 1;
    }

    const headY = y + s.top - 1;
    if (this.bubble) {                                // speech bubble with the spoken symbol
      const bx = cx - 3, by = headY - 9;
      Sprites.px(ctx, bx, by, 7, 7, '#05050c');
      ctx.fillStyle = PAL.cyan;
      ctx.fillRect(bx, by, 7, 1); ctx.fillRect(bx, by + 6, 7, 1); ctx.fillRect(bx, by, 1, 7); ctx.fillRect(bx + 6, by, 1, 7);
      ctx.fillRect(cx, by + 7, 1, 1);
      ctx.drawImage(Sprites.glyph(this.bubble.symbol, PAL.cyan), bx + 1, by + 1);
    } else if (this.state === STATE.SLEEP) {
      const t = (opts.frame + this.id * 13) % 90;
      if (t < 60) ctx.drawImage(Sprites.icon('z', '#9d9d9d'), cx + 2 + Math.floor(t / 30), headY - 3 - Math.floor(t / 12));
    } else if (this.emote) {
      const colors = { heart: PAL.pink, excl: PAL.red, question: PAL.cyan, anger: PAL.red, sparkle: PAL.amber, dots: '#9d9d9d', eye: PAL.red };
      const ic = Sprites.icon(this.emote.name, colors[this.emote.name] || '#fff');
      ctx.drawImage(ic, cx - Math.floor(ic.width / 2), headY - ic.height - 1);
    }

    // analysis lenses
    if (opts.lens && opts.lens !== 'NONE') {
      let col = null;
      if (opts.lens === 'DIALECT') {
        col = U.hslStr(Language.dialectHue(this.lexicon), 0.85, 0.6);
        if (!this.bubble && !this.emote && this.state !== STATE.SLEEP) {
          ctx.drawImage(Sprites.glyph(this.lexicon.FOOD, col), cx - 2, headY - 7);
        }
      } else if (opts.lens === 'GROUPS') {
        col = this.groupId ? U.hslStr((this.groupId * 0.618) % 1, 0.8, 0.6) : '#555';
      } else if (opts.lens === 'ATTITUDE') {
        const att = U.clamp(this.g.affinity * 0.6 + this.trust * 0.7 - this.g.fear * 0.7, -1, 1);
        col = att >= 0 ? U.rgbStr([90 + 120 * (1 - att), 255, 120 + 60 * (1 - att)]) : U.rgbStr([255, 60 + 140 * (1 + att), 50]);
      }
      if (col) Sprites.px(ctx, x + 2, y + s.bottom + 2, s.w - 4, 2, col);
    }

    if (world.selected === this) this.drawBrackets(ctx, PAL.red, opts.frame % 40 < 28);
    else if (opts.hovered === this) this.drawBrackets(ctx, '#9d9d9d', true);
  }

  drawBrackets(ctx, col, show) {
    if (!show) return;
    const s = this.sprite;
    const x0 = this.drawX - 1, y0 = this.drawY - 1, x1 = this.drawX + s.w, y1 = this.drawY + s.bottom + 2;
    ctx.fillStyle = col;
    ctx.fillRect(x0, y0, 3, 1); ctx.fillRect(x0, y0, 1, 3);
    ctx.fillRect(x1 - 2, y0, 3, 1); ctx.fillRect(x1, y0, 1, 3);
    ctx.fillRect(x0, y1, 3, 1); ctx.fillRect(x0, y1 - 2, 1, 3);
    ctx.fillRect(x1 - 2, y1, 3, 1); ctx.fillRect(x1, y1 - 2, 1, 3);
  }

  // -------------- SAVE / LOAD ---------------
  toJSON() {
    return {
      id: this.id, name: this.name, gen: this.gen, parentId: this.parentId,
      genome: this.genome.toJSON(),
      x: this.pos.x, y: this.pos.y, vx: this.vel.x, vy: this.vel.y,
      hunger: this.hunger, energy: this.energy, health: this.health, fear: this.fear, age: this.age,
      lexicon: this.lexicon, trust: this.trust, children: this.children, wordsLearned: this.wordsLearned,
      reproCooldown: this.reproCooldown,
      home: this.memory.home ? [this.memory.home.x, this.memory.home.y] : null,
    };
  }

  static fromJSON(world, o, mx, my) {
    const c = new Creature(world, Genome.fromJSON(o.genome), mx(o.x), my(o.y));
    Object.assign(c, {
      id: o.id, name: o.name, gen: o.gen, parentId: o.parentId,
      hunger: o.hunger, energy: o.energy, health: o.health, fear: o.fear || 0, age: o.age,
      lexicon: { ...o.lexicon }, trust: o.trust || 0, children: o.children || 0,
      wordsLearned: o.wordsLearned || 0, reproCooldown: o.reproCooldown || 0,
    });
    c.vel.set(o.vx || 0, o.vy || 0);
    if (o.home) c.memory.home = createVector(mx(o.home[0]), my(o.home[1]));
    return c;
  }
}