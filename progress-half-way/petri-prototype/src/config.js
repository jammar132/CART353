// =============================================================
// config.js
// Time is measured in TICKS (60 ticks ≈ 1 second at 1x speed).
// Distances are in WORLD PIXELS (1 world px = CONFIG.PIXEL screen px).
// =============================================================

const CONFIG = {
  // ---------- display ----------
  PIXEL: 3,                    // size of one "world pixel" on screen
  SIDE_COLUMNS: 300,           // screen px reserved for each HUD column
  TOP_MARGIN: 56,
  BOTTOM_MARGIN: 76,
  UI_REFRESH_FRAMES: 10,       // HUD refresh rate (frames)

  // ---------- population ----------
  START_CREATURES: 1,
  MAX_POP: 320,                // hard cap for performance

  // ---------- light cycle ----------
  DAY_LENGTH: 60 * 180,        // ticks per full day/night (3 min at 1x)
  START_TIME: 0.30,            // 0 = midnight, 0.5 = noon
  NIGHT_ENABLED: true,

  // ---------- needs (per tick) ----------
  HUNGER_RATE: 0.00028,        // base hunger gain (scaled by genes)
  ENERGY_IDLE: 0.00007,
  ENERGY_MOVE: 0.00038,        // extra cost at full speed
  ENERGY_SLEEP_GAIN: 0.0017,
  SHELTER_SLEEP_MULT: 2.2,     // sleeping in a shelter/nest restores faster
  STARVE_DAMAGE: 0.0016,       // health lost per tick while starving
  EXHAUST_DAMAGE: 0.0008,
  HEAL_RATE: 0.0004,
  FEAR_DECAY: 0.0045,

  // ---------- life cycle ----------
  LIFESPAN_MIN: 60 * 60 * 3,   // 3 minutes
  LIFESPAN_MAX: 60 * 60 * 7,   // 7 minutes
  MATURITY: 60 * 20,           // can reproduce after 20 s
  REPRO_COOLDOWN: 60 * 16,
  REPRO_HUNGER_MAX: 0.45,
  REPRO_ENERGY_MIN: 0.40,
  REPRO_HEALTH_MIN: 0.50,
  REPRO_CHANCE: 0.012,         // chance per tick once eligible
  REPRO_COST_HUNGER: 0.26,
  REPRO_COST_ENERGY: 0.18,
  CROWD_LIMIT: 10,             // more neighbours than this → much lower fertility
  REPRODUCTION_MODE: 'bud',    // 'bud' = one parent (proposal) | 'pair' = two parents + crossover

  // ---------- genetics ----------
  MUTATION_CHANCE: 0.30,       // chance each gene mutates at birth
  MUTATION_SIZE: 0.07,         // std-dev of a mutation
  MORPH_MUTATION_CHANCE: 0.06, // body-shape mutations (ears, eyes, pattern…)

  // ---------- movement / senses ----------
  SPEED_MIN: 0.35,
  SPEED_MAX: 1.05,
  SENSE_MIN: 26,
  SENSE_MAX: 78,
  MAX_FLOCKMATES: 12,          // how many neighbours count for alignment/cohesion
  GRID_CELL: 32,               // spatial hash cell size

  // steering weights (Reynolds-style behaviours blended together)
  W_SEPARATION: 1.7,
  W_ALIGNMENT: 0.55,
  W_COHESION: 0.45,
  W_WANDER: 0.5,
  W_SEEK: 1.2,
  W_AVOID: 3.0,
  W_EDGE: 2.6,
  W_FLEE: 2.3,

  // ---------- food & environment ----------
  FOOD_NUTRITION: 0.32,
  BERRY_NUTRITION: 0.26,
  FOOD_LIFETIME: 60 * 100,     // dropped pellets rot after 100 s
  WILD_FOOD_CHANCE: 0.004,     // per tick: a pellet appears somewhere on its own
  PLANT_GROW_TIME: 60 * 8,
  PLANT_INTERVAL: 60 * 5,      // a grown plant drops a berry this often
  PLANT_MAX_BERRIES: 4,
  SHELTER_RADIUS: 17,

  // ---------- caretaker supply (the player's budget) ----------
  SUPPLY_ENABLED: true,
  SUPPLY_MAX: 100,
  SUPPLY_REGEN: 0.03,          // per tick
  COST: { observe: 0, food: 1, plant: 12, rock: 3, shelter: 18, startle: 2, erase: 0 },

  // ---------- the player's cursor ----------
  CURSOR_THREAT_SPEED: 2.0,    // world px / frame — faster than this is "chasing"
  CURSOR_HARM_RADIUS: 10,
  CURSOR_HARM: 0.010,          // health removed per frame when caught (not inside shelters)
  CURSOR_STILL_FRAMES: 25,     // cursor counts as "still" after this many frames
  TRUST_FROM_FEEDING: 0.05,    // eating food the player just dropped
  TRUST_FROM_CHASE: -0.03,
  TRUST_FROM_STARTLE: -0.10,
  TRUST_FROM_ATTENTION: 0.0006,// cursor resting gently on a creature
  TRUST_SOCIAL_RATE: 0.0015,   // trust drifts toward neighbours' trust (social learning)
  TRUST_INHERIT: 0.6,          // children start with this fraction of parent trust

  // ---------- communication ----------
  SIGNAL_RANGE: 60,
  SIGNAL_COOLDOWN: 60 * 2.5,
  NUM_SYMBOLS: 16,
  LEXICON_MUTATION: 0.035,     // chance a newborn invents a new word for a meaning
  LEARN_RATE: 0.35,            // chance to copy an unknown word (scaled by sociability)
  CONTEXT_INFER: 0.75,         // chance the copied word gets attached to the right meaning

  // ---------- culture / emergent behaviour ----------
  STARE_BASE: 0.0015,          // chance per tick to start staring at a still cursor
  STARE_CONTAGION: 0.06,       // extra chance per staring neighbour fraction
  NEST_CELL: 24,
  NEST_HEAT: 60 * 60 * 1.5,    // sleeping-ticks in one area before the colony builds a nest
  NEST_MAX: 6,
  GROUP_LINK: 20,              // creatures closer than this belong to the same group

  // ---------- bookkeeping ----------
  HISTORY_EVERY: 120,          // ticks between population graph samples
  HISTORY_MAX: 600,
  TRAIT_SNAPSHOT_EVERY: 600,
};
