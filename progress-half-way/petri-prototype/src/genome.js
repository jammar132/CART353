// =============================================================
// genome.js; the inherited "DNA" of a creature.
// genes  : continuous values 0..1 that shape behaviour + body
// morph  : discrete body-shape genes (ears, feet, eyes, pattern)
// *Offspring copy the parent's genome with small random mutations,
// so traits that help creatures survive and reproduce in the
// current environment (including how the PLAYER behaves) slowly
// become more common. That's the whole genetic algorithm:
// inheritance + mutation + natural selection.*
// =============================================================

const GENE_KEYS = [
  'speed',        // movement speed (costs more food)
  'size',         // bigger body: tougher, wins food fights, hungrier
  'sense',        // perception radius (costs a little food)
  'metabolism',   // fast metabolism: hungrier but heals faster
  'curiosity',    // explores, investigates new things and the cursor
  'sociability',  // flocking strength, shares food calls, learns words
  'fear',         // how early it reacts to threats (cursor, bullies, death)
  'aggression',   // shoves others away from food
  'affinity',     // inborn attraction to the player ("attraction to the user")
  'fertility',    // shorter reproduction cooldown
  'longevity',    // lifespan
  'hue',          // body colour (drifts → lineages are visible)
  'voice',        // pitch of its calls
];

// The traits shown in the HUD's gene-pool panel
const TRAIT_DISPLAY = [
  ['curiosity', 'CURIOSITY'],
  ['sociability', 'SOCIABILITY'],
  ['fear', 'FEAR'],
  ['aggression', 'AGGRESSION'],
  ['speed', 'SPEED'],
  ['affinity', 'USER ATTRACT.'],
  ['sense', 'PERCEPTION'],
  ['fertility', 'FERTILITY'],
];

class Genome {
  constructor(genes, morph) {
    this.genes = genes;
    this.morph = morph;
  }

  // The very first creature: average-ish, a bit curious and friendly
  static founder() {
    const g = {};
    for (const k of GENE_KEYS) g[k] = U.clamp(0.5 + U.gauss() * 0.07, 0.05, 0.95);
    g.curiosity = 0.6;
    g.affinity = 0.6;
    g.fear = 0.45;
    g.aggression = 0.3;
    g.hue = Math.random();
    g.voice = Math.random();
    const morph = {
      eyes: 2,                     // 1, 2 or 3; mutations make them stranger
      ears: U.randInt(0, 5),       // 0 none | 1 pointy | 2 antenna | 3 twin antennae | 4 tuft
      feet: U.randInt(0, 3),       // 0 none | 1 two feet | 2 three legs
      pattern: U.randInt(0, 4),    // 0 plain | 1 belly | 2 spots | 3 stripes
      shape: Math.random(),        // 0 round → 1 boxy
      asym: 0,                     // asymmetry: grows with mutations (unsettling)
      seed: U.randInt(1, 1e9),     // seed for spot placement etc.
    };
    return new Genome(g, morph);
  }

  // Copy with mutation — used for every birth.
  mutate() {
    const g = { ...this.genes };
    for (const k of GENE_KEYS) {
      if (!U.chance(CONFIG.MUTATION_CHANCE)) continue;
      if (k === 'hue') g.hue = (g.hue + U.gauss() * 0.035 + 1) % 1;
      else g[k] = U.clamp(g[k] + U.gauss() * CONFIG.MUTATION_SIZE, 0.01, 0.99);
    }
    const m = { ...this.morph };
    const p = CONFIG.MORPH_MUTATION_CHANCE;
    if (U.chance(p)) m.ears = U.randInt(0, 5);
    if (U.chance(p)) m.feet = U.randInt(0, 3);
    if (U.chance(p)) m.pattern = U.randInt(0, 4);
    if (U.chance(p)) m.seed = U.randInt(1, 1e9);
    if (U.chance(p * 0.4)) m.eyes = U.pick([1, 2, 3]);
    if (U.chance(p * 0.5)) m.asym = U.clamp(m.asym + U.rand(0.1, 0.3), 0, 1);
    m.shape = U.clamp(m.shape + U.gauss() * 0.04, 0, 1);
    return new Genome(g, m);
  }

  // Two-parent recombination (used when CONFIG.REPRODUCTION_MODE === 'pair').
  static crossover(a, b) {
    const g = {};
    for (const k of GENE_KEYS) g[k] = U.chance(0.5) ? a.genes[k] : b.genes[k];
    const m = {};
    for (const k of Object.keys(a.morph)) m[k] = U.chance(0.5) ? a.morph[k] : b.morph[k];
    return new Genome(g, m);
  }

  // ---------- phenotype: how genes turn into numbers ----------
  get maxSpeed() { return U.lerp(CONFIG.SPEED_MIN, CONFIG.SPEED_MAX, this.genes.speed) * (0.9 + 0.2 * this.genes.metabolism); }
  get bodySize() { const s = this.genes.size; return s < 0.34 ? 7 : s < 0.67 ? 9 : 11; }
  get senseRadius() { return U.lerp(CONFIG.SENSE_MIN, CONFIG.SENSE_MAX, this.genes.sense); }
  get lifespan() { return U.lerp(CONFIG.LIFESPAN_MIN, CONFIG.LIFESPAN_MAX, this.genes.longevity); }
  get hungerRate() {
    const g = this.genes;
    return CONFIG.HUNGER_RATE
      * U.lerp(0.65, 1.4, g.metabolism)
      * (0.75 + 0.5 * g.speed)
      * (0.8 + 0.4 * g.size)
      * (0.9 + 0.2 * g.sense);
  }
  // how "strange" this body looks (used for the creeping unsettling feel)
  get strangeness() { return (this.morph.eyes !== 2 ? 0.5 : 0) + this.morph.asym * 0.5; }

  toJSON() { return { genes: this.genes, morph: this.morph }; }
  static fromJSON(o) { return new Genome({ ...o.genes }, { ...o.morph }); }
}
