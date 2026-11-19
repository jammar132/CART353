// =============================================================
// language.js; the creatures' proto-language.
//
// Every creature carries a LEXICON: which symbol it uses for each
// MEANING. Words are inherited from the parent (with occasional
// invention) and COPIED from others when overheard — a simple
// version of Luc Steels' "naming game". Groups that talk to each
// other converge on shared words; isolated groups drift into
// their own dialects. Nobody scripts the language — it emerges.
// =============================================================

const MEANINGS = ['FOOD', 'DANGER', 'GATHER', 'HOME'];

// 5x5 pixel glyphs. The first five echo the deck: ◇ ✦ ✿ ! ✶
const GLYPHS = [
  ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'], // 0  ◇
  ['..#..', '.###.', '#####', '.###.', '..#..'], // 1  ✦
  ['.#.#.', '##.##', '..#..', '##.##', '.#.#.'], // 2  ✿
  ['..#..', '..#..', '..#..', '.....', '..#..'], // 3  !
  ['#.#.#', '.###.', '#####', '.###.', '#.#.#'], // 4  ✶
  ['.###.', '#...#', '#.#.#', '#...#', '.###.'], // 5  ◉
  ['#...#', '.#.#.', '..#..', '..#..', '..#..'], // 6  Y
  ['#.#.#', '#.#.#', '.###.', '..#..', '..#..'], // 7  trident
  ['..#..', '.###.', '#.#.#', '..#..', '..#..'], // 8  arrow
  ['#####', '#....', '#.###', '#...#', '#####'], // 9  spiral
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'], // 10 #
  ['.....', '.#...', '#.#.#', '...#.', '.....'], // 11 wave
  ['.....', '.###.', '#.#.#', '.###.', '.....'], // 12 eye
  ['#...#', '#...#', '#####', '#...#', '#...#'], // 13 H
  ['..#..', '.#.#.', '#...#', '#####', '.....'], // 14 △
  ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'], // 15 checker
];

const Language = {
  // founder: a random symbol for each meaning (all different)
  founderLexicon() {
    const pool = [...Array(CONFIG.NUM_SYMBOLS).keys()];
    const lex = {};
    for (const m of MEANINGS) lex[m] = pool.splice(U.randInt(0, pool.length), 1)[0];
    return lex;
  },

  // child copies parent's words; occasionally invents a new one
  inherit(parentLex) {
    const lex = { ...parentLex };
    const invented = [];
    for (const m of MEANINGS) {
      if (U.chance(CONFIG.LEXICON_MUTATION)) {
        const s = U.randInt(0, CONFIG.NUM_SYMBOLS);
        if (s !== lex[m]) { lex[m] = s; invented.push(m); }
      }
    }
    return { lex, invented };
  },

  // a stable colour for a whole lexicon (used by the DIALECT lens)
  dialectHue(lex) {
    const h = U.hashInts(lex.FOOD, lex.DANGER, lex.GATHER, lex.HOME);
    return (h % 997) / 997;
  },
  dialectKey(lex) { return `${lex.FOOD}.${lex.DANGER}.${lex.GATHER}.${lex.HOME}`; },

  // population statistics: which words are in use for each meaning
  survey(creatures) {
    const out = { words: {}, agreement: 0, dialects: 0 };
    if (!creatures.length) return out;
    let agreeSum = 0;
    for (const m of MEANINGS) {
      const counts = new Map();
      for (const c of creatures) counts.set(c.lexicon[m], (counts.get(c.lexicon[m]) || 0) + 1);
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      out.words[m] = list.map(([symbol, n]) => ({ symbol, n, share: n / creatures.length }));
      agreeSum += list[0][1] / creatures.length;
    }
    out.agreement = agreeSum / MEANINGS.length;
    // a "dialect" = a complete lexicon spoken by at least 3 creatures
    const keys = new Map();
    for (const c of creatures) {
      const k = Language.dialectKey(c.lexicon);
      keys.set(k, (keys.get(k) || 0) + 1);
    }
    out.dialects = [...keys.values()].filter((n) => n >= 3).length || (creatures.length ? 1 : 0);
    return out;
  },
};
