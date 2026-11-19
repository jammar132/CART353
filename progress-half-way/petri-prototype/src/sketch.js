// =============================================================
// sketch.js; p5 entry point: setup, draw loop, input.
//
// Rendering trick: the world is drawn into a small buffer (pg)
// at 1/3 of screen resolution, then scaled up with smoothing
// off that's what makes everything chunky pixel art.
// =============================================================

let world, pg, cnv;
let started = false;
let paused = false;
let simSpeed = 1;
let lensIndex = 0;
let debugView = false;
let pointerOnCanvas = false;
let mouseOverCanvas = false;

const SPEEDS = [1, 2, 4, 8];
const LENSES = ['NONE', 'DIALECT', 'GROUPS', 'ATTITUDE'];

function setup() {
  pixelDensity(1);
  cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent('stage');
  noSmooth();
  cnv.elt.addEventListener('mouseenter', () => { mouseOverCanvas = true; });
  cnv.elt.addEventListener('mouseleave', () => { mouseOverCanvas = false; });
  cnv.elt.addEventListener('contextmenu', (e) => e.preventDefault());
  cnv.mousePressed(canvasPressed);

  updateLayoutReserve();
  pg = makeBuffer();
  world = new World(pg.width, pg.height);
  UI.init(world);
  UI.showBoot(Persistence.info());
}

function makeBuffer() {
  const b = createGraphics(Math.floor(width / CONFIG.PIXEL), Math.floor(height / CONFIG.PIXEL));
  b.pixelDensity(1);
  b.noSmooth();
  return b;
}

// how much screen the HUD covers, so the dish fits between the panels
function updateLayoutReserve() {
  const hidden = document.body.classList.contains('hud-hidden');
  const left = document.getElementById('left');
  CONFIG.SIDE_COLUMNS = hidden ? 0 : (left.offsetWidth || 300) + 12;
  CONFIG.TOP_MARGIN = hidden ? 16 : 56;
  CONFIG.BOTTOM_MARGIN = hidden ? 16 : 76;
}

function startGame(fromSave) {
  SFX.init();
  world.reset();
  let loaded = false;
  if (fromSave) loaded = Persistence.load(world);
  if (loaded) world.log('Saved dish restored.', 'milestone');
  else world.seed();
  started = true;
  paused = false;
  UI.hideOverlay();
}

// =============================================================
function draw() {
  background(0);
  updateCursor();

  if (started && !paused) {
    for (let i = 0; i < simSpeed; i++) world.update();
    world.applyCursor();
    if (pointerOnCanvas && mouseIsPressed) Tools.drag(world, world.cursor.x, world.cursor.y);
    if (world.extinct && !world.extinctAcknowledged && !UI.overlayOpen) UI.showExtinct(world);
  }

  const hovered = Tools.current === 'observe' && world.cursor.inside ? world.creatureAt(world.cursor.x, world.cursor.y, 9) : null;
  world.draw(pg, {
    frame: frameCount,
    lens: LENSES[lensIndex],
    debug: debugView,
    hovered,
    preview: started ? (ctx) => Tools.drawPreview(ctx, world) : null,
  });
  image(pg, 0, 0, pg.width * CONFIG.PIXEL, pg.height * CONFIG.PIXEL);

  if (frameCount % CONFIG.UI_REFRESH_FRAMES === 0) {
    UI.refresh(world, { paused, speed: simSpeed, lens: LENSES[lensIndex] });
  }
}

// the cursor, in world pixels, plus how fast / still it is
function updateCursor() {
  const c = world.cursor;
  const x = mouseX / CONFIG.PIXEL, y = mouseY / CONFIG.PIXEL;
  const inside = mouseOverCanvas && started && world.inDish(x, y);
  const moved = Math.hypot(x - c.x, y - c.y);
  c.speed = inside && c.inside ? c.speed * 0.5 + moved * 0.5 : 0;   // entering the dish isn't a "jump"
  c.x = x; c.y = y;
  c.inside = inside;
  c.pressed = pointerOnCanvas && mouseIsPressed;
  c.stillFrames = c.speed < 0.25 ? c.stillFrames + 1 : 0;
  c.still = c.stillFrames > CONFIG.CURSOR_STILL_FRAMES;
}

// =============================================================
// INPUT
// =============================================================
function canvasPressed() {
  if (!started || UI.overlayOpen) return;
  pointerOnCanvas = true;
  SFX.init();
  Tools.press(world, mouseX / CONFIG.PIXEL, mouseY / CONFIG.PIXEL);
}

function mouseReleased() {
  pointerOnCanvas = false;
}

function keyPressed() {
  if (UI.overlayOpen) {
    if (keyCode === ESCAPE && started) UI.hideOverlay();
    else if (!started && (keyCode === ENTER || key === ' ')) startGame(false);
    return false;
  }
  if (keyCode === TAB) { toggleHUD(); return false; }
  if (keyCode === ESCAPE) { world.selected = null; return false; }

  const tool = TOOLS.find((t) => t.key === key);
  if (tool) { Tools.set(tool.id); return false; }

  switch (key.toLowerCase()) {
    case ' ': togglePause(); break;
    case '=': case '+': setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(simSpeed) + 1)]); break;
    case '-': case '_': setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(simSpeed) - 1)]); break;
    case 'v': cycleLens(); break;
    case 'g': debugView = !debugView; break;
    case 'm': toggleSound(); break;
    case 's': saveGame(); break;
    case 'l': loadGame(); break;
    case 'h': case '?': UI.showHelp(); break;
    case 'x':
      world.sandbox = !world.sandbox;
      world.log(world.sandbox ? 'Sandbox: unlimited supply.' : 'Supply limits restored.', 'milestone');
      break;
    default: return true;
  }
  return false;
}

// =============================================================
// actions used by the toolbar buttons too
// =============================================================
function togglePause() { if (started) paused = !paused; }
function setSpeed(s) { simSpeed = s; }
function cycleLens() {
  lensIndex = (lensIndex + 1) % LENSES.length;
  const notes = {
    NONE: '',
    DIALECT: 'Lens: DIALECT — colour = full vocabulary; symbol = their word for FOOD.',
    GROUPS: 'Lens: GROUPS — each colour is one connected group; grey = alone.',
    ATTITUDE: 'Lens: ATTITUDE — green trusts you, red fears you (genes + experience).',
  };
  UI.tip(notes[LENSES[lensIndex]]);
}
function toggleSound() { SFX.toggle(); }
function saveGame() {
  if (!started) return;
  world.log(Persistence.save(world) ? 'Dish saved.' : 'Save failed.', 'milestone');
}
function loadGame() {
  if (!Persistence.info()) { if (started) world.log('No saved dish found.', 'warn'); return; }
  startGame(true);
}
function toggleHUD() {
  document.body.classList.toggle('hud-hidden');
  updateLayoutReserve();
  world.resize(pg.width, pg.height);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateLayoutReserve();
  if (pg && pg.elt && pg.elt.parentNode) pg.elt.parentNode.removeChild(pg.elt);   // drop the old buffer
  pg = makeBuffer();
  world.resize(pg.width, pg.height);
}
