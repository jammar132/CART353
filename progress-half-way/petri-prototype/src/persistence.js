// =============================================================
// persistence.js saves the dish to the browser (localStorage)
// so a colony can keep living between sessions, like a pet.
// =============================================================

const Persistence = {
  KEY: 'petri.save.v1',

  save(world) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(world.serialize()));
      return true;
    } catch (e) {
      console.warn('Save failed', e);
      return false;
    }
  },

  info() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { pop: d.creatures.length, gen: d.stats.maxGen, savedAt: d.savedAt };
    } catch (e) {
      return null;
    }
  },

  load(world) {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return false;
      world.deserialize(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn('Load failed', e);
      return false;
    }
  },
};
