// =============================================================
// tools.js; how the caretaker touches the world.
// You never control a creature directly; you only change its
// environment (and, by moving the cursor, how safe it feels).
// =============================================================

const TOOLS = [
  { id: 'observe', key: '1', label: 'OBSERVE', hint: 'Click a creature to inspect it. Rest the cursor still and the curious ones come closer.' },
  { id: 'food', key: '2', label: 'FOOD', hint: 'Click or drag to drop food pellets.' },
  { id: 'plant', key: '3', label: 'PLANT', hint: 'Plant a seed. Once grown it drops berries forever.' },
  { id: 'rock', key: '4', label: 'ROCK', hint: 'Place an obstacle.' },
  { id: 'shelter', key: '5', label: 'SHELTER', hint: 'An old terminal. Sleeping here restores energy faster and calms fear.' },
  { id: 'startle', key: '6', label: 'STARTLE', hint: 'A shock-wave. Frightens — and can hurt — creatures nearby.' },
  { id: 'erase', key: '7', label: 'ERASE', hint: 'Remove food, plants, rocks or shelters.' },
];

const Tools = {
  current: 'observe',
  _drag: 0,

  set(id) {
    this.current = id;
    if (typeof UI !== 'undefined') UI.onToolChange(id);
  },

  cost(id) { return CONFIG.COST[id] || 0; },
  afford(world, id) { return world.sandbox || world.supply >= this.cost(id); },
  spend(world, id) { if (!world.sandbox) world.supply = Math.max(0, world.supply - this.cost(id)); },

  press(world, x, y) {
    this._drag = 0;
    this.apply(world, x, y);
  },

  // holding the mouse down: keep dropping food / erasing
  drag(world, x, y) {
    if (this.current !== 'food' && this.current !== 'erase') return;
    if (++this._drag % 5 === 0) this.apply(world, x + U.rand(-2, 2), y + U.rand(-2, 2));
  },

  apply(world, x, y) {
    const id = this.current;
    if (id === 'observe') { world.selected = world.creatureAt(x, y, 9); return; }
    if (id === 'erase') { if (world.eraseNear(x, y)) SFX.place(); return; }
    if (!this.afford(world, id)) { UI.flashSupply(); return; }
    if (id === 'startle') {
      if (!world.inDish(x, y)) return;
      world.startle(x, y);
      this.spend(world, id);
      return;
    }
    if (!world.canPlace(id, x, y)) return;
    if (id === 'food') world.addFood(x, y, 'pellet', { byUser: true });
    else if (id === 'plant') world.addPlant(x, y);
    else if (id === 'rock') world.addRock(x, y);
    else if (id === 'shelter') world.addShelter(x, y, 'user');
    this.spend(world, id);
    SFX.place();
  },

  // shadow/ghost of what you're about to place
  drawPreview(ctx, world) {
    const c = world.cursor;
    if (!c.inside) return;
    const id = this.current;
    const x = Math.round(c.x), y = Math.round(c.y);
    const ok = id === 'observe' || id === 'erase'
      || (this.afford(world, id) && (id === 'startle' ? world.inDish(x, y) : world.canPlace(id, x, y)));
    const col = ok ? 'rgba(242,242,242,0.6)' : 'rgba(224,20,15,0.8)';
    ctx.globalAlpha = 0.85;
    switch (id) {
      case 'food': Sprites.pixelCircle(ctx, x, y, 3, col); break;
      case 'plant':
        ctx.globalAlpha = 0.45;
        ctx.drawImage(SPRITE_CACHE.plant(3), x - 4, y - 6);
        ctx.globalAlpha = 0.85;
        if (!ok) Sprites.pixelCircle(ctx, x, y, 5, col);
        break;
      case 'rock': Sprites.pixelCircle(ctx, x, y, 7, col); break;
      case 'shelter':
        ctx.globalAlpha = 0.4;
        ctx.drawImage(SPRITE_CACHE.shelter(false), x - 7, y - 9);
        ctx.globalAlpha = 0.6;
        Sprites.pixelCircle(ctx, x, y, CONFIG.SHELTER_RADIUS, col);
        break;
      case 'startle': ctx.globalAlpha = 0.35; Sprites.pixelCircle(ctx, x, y, 55, ok ? PAL.red : col); break;
      case 'erase':
        ctx.fillStyle = PAL.red;
        ctx.fillRect(x - 3, y - 3, 7, 1); ctx.fillRect(x - 3, y + 3, 7, 1);
        ctx.fillRect(x - 3, y - 3, 1, 7); ctx.fillRect(x + 3, y - 3, 1, 7);
        break;
    }
    ctx.globalAlpha = 1;
  },
};
