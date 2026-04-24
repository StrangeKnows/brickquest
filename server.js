// ═══════════════════════════════════════════════════════════
//  BRICK QUEST — Server v2.0
//  node server.js
// ═══════════════════════════════════════════════════════════
const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');
const os = require('os');

// Version — read from package.json so `npm version patch` bumps this everywhere.
// Failure-safe: if the file is missing or malformed, fall back to 'dev'.
const BQ_VERSION = (() => {
  try { return require('./package.json').version || 'dev'; }
  catch (e) { return 'dev'; }
})();

// Shared game constants
const { SPACES, ZONES, GATE_SPACES, GATE_RULES, BRICK_COLORS, BRICK_NAMES, LANDING_EVENTS, PLAYER_META, DASH_FLAVOR, ENTITY_TYPES, ENTITY_META, RUMBLE_FLAVOR } = require('./game.js');

// Family palette per doc §2.1 Per-Color Role Matrix — 3 brick colors per
// expression family. Called at rumble-event initiate so each encounter rolls
// fresh; same goblin can show red one time, gray the next, orange after that.
const _ENCOUNTER_PALETTE = {
  physical: ['red',    'orange', 'gray'],
  ethereal: ['blue',   'yellow', 'white'],
  malady:   ['green',  'purple', 'black'],
};
function rollEncounterColor(entityType) {
  const meta = ENTITY_META[entityType];
  const fam = (meta && meta.family) || 'physical';
  const palette = _ENCOUNTER_PALETTE[fam] || _ENCOUNTER_PALETTE.physical;
  return palette[Math.floor(Math.random() * palette.length)];
}

const PORT = 8080;
const MIME = {
  '.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.json':'application/json'
};

// ── INITIAL GAME STATE ────────────────────────────────────
function freshState() {
  return {
    round: 1,
    phase: 'prepare',           // prepare|land|battle
    activePlayerIdx: 0,
    turnOrder: ['breaker','formwright','snapstep','blocksmith','fixer','wild_one'],
    battle: null,
    activeEvent: null,
    pendingTrade: null,       // { fromCls, toCls, color, id }
    movementDebuffs: {},      // { cls: spacePenalty }
    cursedPlayers: {},        // { cls: { penalty:n } }
    blackBrickSpaces: [],     // [{ spaceIdx, coveredByYellow }]
    fortressBricks: 12,
    villagersRescued: 0,
    gates: {
      z1z2:'locked', z2z3:'locked', z3z4:'locked',
      z4z5:'locked', z5boss:'locked'
    },
    magicKeys: {              // which player holds each key
      blue:null, red:null, green:null, yellow:null
    },
    discoveredClues: [],      // [{ clue, solverCls, riddleQ }]
    usedRiddleIdxs: [],       // track used riddle indices per zone
    usedBlueVariants: {},     // track used Category B variants per player per zone
    lingeringEvents: {},       // v4: { [spaceIdx]: { evType, variant, originCls, attemptsSoFar, createdAt } }
    orangeSpaces: {},         // { spaceIdx: trapCount } — persistent traps
    blueSpaces: {},           // { spaceIdx: 1 } — unresolved blue events
    yellowSpaces: {},          // { spaceIdx: true } — unclaimed yellow brick from expired riddle
    greenSpaces: {},          // { spaceIdx: 1 } — unresolved green events (future)
    allowBackward: false,     // DM toggle: allow players to move backward
    storeDisabled: false,     // DM toggle: disable store for all zones
    pendingDashRequest: null, // { cls, spaces, requestedAt } — awaits DM approval
    pendingRumbleBattle: null, // { cls, entityType, enemy, flavor } — event card stage, awaits player or DM initiate
    rumbleBattle: null,        // active real-time battle state (see rumble handlers below)
    log: [],
    players: {
      // Starting state follows Combat & Economy v1 spec (canonical in
      // rumble.js CLASS_META and game.js PLAYER_META):
      //   HP: breaker 14, formwright 6, snapstep 9, blocksmith 12, fixer 8, wild_one 10
      //   Starting bricks: 2 signature + 1 secondary (3 total per class).
      // Players earn more bricks through play (loot drops, landing events,
      // rewards); these are just the opening kit.
      breaker:     mkPlayer('breaker',    '⚔️', '#993C1D', 14, 'd8',  {red:2,  gray:1}),
      formwright:  mkPlayer('formwright', '🔮', '#3C3489',  6, 'd6',  {blue:2, purple:1}),
      snapstep:    mkPlayer('snapstep',   '🏃', '#085041',  9, 'd6',  {orange:2, red:1}),
      blocksmith:  mkPlayer('blocksmith', '🔧', '#C87800', 12, 'd6',  {gray:2, orange:1}),
      fixer:       mkPlayer('fixer',      '💊', '#72243E',  8, 'd4',  {white:2, black:1}),
      wild_one:    mkPlayer('wild_one',   '🐾', '#27500A', 10, 'd6',  {green:2, yellow:1}),
    }
  };
}

function mkPlayer(cls, icon, color, hp, die, bricks) {
  const allBricks = {red:0,blue:0,green:0,white:0,gray:0,purple:0,yellow:0,orange:0,black:0};
  const startBricks = {...allBricks,...bricks};
  return {
    cls, icon, color,
    name: {breaker:'Breaker',formwright:'Formwright',snapstep:'Snapstep',blocksmith:'Blocksmith',fixer:'Fixer',wild_one:'Wild One'}[cls]||cls,
    hp, hpMax:hp, armor:0, gold:3,
    die, space:0, alive:true,
    bricks: startBricks,            // owned inventory (ceiling)
    bricksCharged: {...startBricks},// active charges (<= bricks[c]). Spent on action; refreshed at rumble entry + zone gate crossing. See DESIGN_S012_PROPOSAL_V2 §1.1.
    lastDropped: {},                // per-color last-spend timestamp (§1.2 pulse timing). Map color → ms since epoch.
    cheese: 0,             // v4: tradable food item (eat for +1 max HP, gift to ally)
    queuedPoisonStacks: 0, // v4: cross-system poison from failed green/black events
    queuedPoisonBattles: 0,// v4: how many rumble battles poison applies to
    statusEffects: [],     // ['poisoned','confused','cursed']
    connected: false,
    playerName: '',        // real player's name, set on login
    earnedClues: [],      // clues this player earned by solving yellow challenges
    dashUsedThisTurn: false, // reset on each turn advance — one red dash per own turn
    battleDashPenalty: 0,    // if >0, decrement red by this much at battle start (consumed once)
    reviveCount: 0,          // S013.6: stacking heart-revive counter; drives loot penalty (−10% per)
  };
}

// ── CHARGE MODEL HELPERS (DESIGN_S012_PROPOSAL_V2 §1.1) ────────
// p.bricks[c]         = owned inventory (ceiling)
// p.bricksCharged[c]  = active charges; invariant: 0 <= bricksCharged[c] <= bricks[c]
// Charges are spent on action, refreshed only at rumble entry and zone gate crossing.
const BRICK_COLORS_ALL = ['red','blue','green','white','gray','purple','yellow','orange','black'];

function refreshCharges(p) {
  if (!p || !p.bricks) return;
  if (!p.bricksCharged) p.bricksCharged = {};
  BRICK_COLORS_ALL.forEach(function(c) { p.bricksCharged[c] = p.bricks[c] || 0; });
}

function addBrick(p, color, n) {
  if (!p || !p.bricks) return;
  n = (n == null) ? 1 : n;
  if (!p.bricksCharged) p.bricksCharged = {};
  p.bricks[color] = (p.bricks[color] || 0) + n;
  p.bricksCharged[color] = (p.bricksCharged[color] || 0) + n; // new bricks arrive charged
}

function removeBrick(p, color, n) {
  // Hard removal from inventory (penalties, trade-out). Maintains invariant.
  if (!p || !p.bricks) return;
  n = (n == null) ? 1 : n;
  if (!p.bricksCharged) p.bricksCharged = {};
  p.bricks[color] = Math.max(0, (p.bricks[color] || 0) - n);
  if ((p.bricksCharged[color] || 0) > p.bricks[color]) {
    p.bricksCharged[color] = p.bricks[color];
  }
}

function spendBrickCharge(p, color, n) {
  // Consume a charge without removing from inventory (board action, overload).
  // Stamps lastDropped[color] per §1.2 so clients can pulse the empty pip's
  // recency tier (<5s fast, 5-30s medium, 30s+ slow).
  if (!p || !p.bricksCharged) return;
  n = (n == null) ? 1 : n;
  p.bricksCharged[color] = Math.max(0, (p.bricksCharged[color] || 0) - n);
  if (!p.lastDropped) p.lastDropped = {};
  p.lastDropped[color] = Date.now();
}

let G = freshState();

// ── v4 RED TRIAL CHALLENGES (party race) ────────────────────
// All 9 challenges are physical. Each lasts up to 30s.
// `digital=true` means the minigame adjudicates via client input
// (frenzy tap race, reflex GO-tap). Others require DM to pick winner.
const RED_CHALLENGES = [
  { id:'trial_of_hand',    name:'TRIAL OF THE HAND', kind:'dexterity', digital:false,
    text:'Flip a coin from one hand to the other three times in a row without dropping. First to finish wins.' },
  { id:'iron_hold',        name:'IRON HOLD', kind:'strength', digital:false,
    text:'Most push-ups in 30 seconds. DM counts. Highest count wins.' },
  { id:'crown_of_stillness',name:'CROWN OF STILLNESS', kind:'dexterity', digital:false,
    text:'Balance on one foot, eyes closed. Last standing wins.' },
  { id:'silver_stare',     name:'SILVER STARE', kind:'focus', digital:false,
    text:'Stare contest. No blinking for 30 seconds. Last eye open wins.' },
  { id:'hammer_throw',     name:'HAMMER THROW', kind:'strength', digital:false,
    text:'Toss a crumpled paper ball into a container placed by the DM. Farthest successful throw wins.' },
  { id:'smooth_tower',     name:'SMOOTH TOWER', kind:'dexterity', digital:false,
    text:'Stack 7 Lego bricks end-to-end, studs outward, resting on their smooth sides. First stable tower wins.' },
  { id:'featherfall',      name:'FEATHERFALL', kind:'dexterity', digital:false,
    text:'Hold a light object flat in your open hand. Race to a finish line set by the DM. First to arrive without dropping wins.' },
  { id:'frenzy',           name:'FRENZY', kind:'strength', digital:true,
    text:'Rapid-tap the button. First to 50 taps wins.' },
  { id:'reflex_hawk',      name:'REFLEX OF THE HAWK', kind:'dexterity', digital:true,
    text:'Tap GO when it appears. First valid tap wins.' },
];

// ── v4 GRAY RUBBLE TETRIS ──────────────────────────
// Outlines are 5-wide × 6-tall grids, stored as strings of 'X.....' per row.
// Row 0 = bottom. All outlines must be gravity-valid: every X cell at row > 0
// must have an X directly below it (so a block placed there has something to rest on).
const GRAY_OUTLINES = [
  ['XXXXX','.....','.....','.....','.....','.....'],  // flat 5
  ['XXXXX','.XXX.','.....','.....','.....','.....'],  // low pyramid
  ['XXXXX','X...X','.....','.....','.....','.....'],  // frame base (open top)
  ['XXXX.','XXXX.','.....','.....','.....','.....'],  // 2x4 block left-aligned
  ['XXXXX','.X.X.','.....','.....','.....','.....'],  // pillars (supported by bottom)
  ['XXXXX','XX.XX','.....','.....','.....','.....'],  // base + split upper
  ['XXX..','XX...','X....','.....','.....','.....'],  // staircase left
  ['..XXX','...XX','....X','.....','.....','.....'],  // staircase right
  ['XXXXX','XXXXX','.....','.....','.....','.....'],  // solid 2x5
  ['XXXXX','XXXXX','.XXX.','.....','.....','.....'],  // bulky pyramid
  ['XXXXX','XXXXX','XX.XX','.....','.....','.....'],  // fortress-ish (row 2 gap supported by full row 1)
  ['XXXXX','X.XXX','..XXX','.....','.....','.....'],  // right ramp
  ['XXXXX','XXX.X','XXX..','.....','.....','.....'],  // left ramp
];

// Block shape palette. Each block is an array of {dx,dy} relative to anchor at (0,0).
// Anchor convention: the block MUST contain (0,0) — this is the lowest-leftmost cell,
// used by the solver as the placement anchor during bottom-up scan.
// Includes 1-3 cell pieces AND standard 4-cell tetrominoes (S and Z normalized so
// their lowest-leftmost cell sits at (0,0)).
const GRAY_BLOCKS = [
  // 1-cell
  [{dx:0,dy:0}],                                                    // single
  // 2-cell
  [{dx:0,dy:0},{dx:1,dy:0}],                                        // horiz 2
  [{dx:0,dy:0},{dx:0,dy:1}],                                        // vert 2
  // 3-cell
  [{dx:0,dy:0},{dx:1,dy:0},{dx:2,dy:0}],                            // horiz 3
  [{dx:0,dy:0},{dx:0,dy:1},{dx:0,dy:2}],                            // vert 3
  [{dx:0,dy:0},{dx:1,dy:0},{dx:1,dy:1}],                            // L3 (step up right)
  [{dx:0,dy:0},{dx:1,dy:0},{dx:0,dy:1}],                            // corner3
  // 4-cell tetrominoes
  [{dx:0,dy:0},{dx:1,dy:0},{dx:0,dy:1},{dx:1,dy:1}],                // O (square)
  [{dx:0,dy:0},{dx:1,dy:0},{dx:2,dy:0},{dx:3,dy:0}],                // I (flat 4)
  [{dx:0,dy:0},{dx:1,dy:0},{dx:2,dy:0},{dx:2,dy:1}],                // L
  [{dx:0,dy:0},{dx:1,dy:0},{dx:2,dy:0},{dx:0,dy:1}],                // J
  [{dx:0,dy:0},{dx:1,dy:0},{dx:2,dy:0},{dx:1,dy:1}],                // T
  // S-tetromino: normalized so anchor is bottom-left. Shape:
  //   .XX
  //   XX.
  // Anchor at (0,0) is the bottom-left X. Offsets: (0,0)(1,0)(1,1)(2,1)
  // Wait — that's Z, not S. Let me pick one canonical orientation and keep it.
  // Using "Z" shape (top-left to bottom-right):
  //   XX.
  //   .XX
  // Bottom-left X at (1,0), so anchor (1,0)... but we want anchor at (0,0).
  // We'll skip S/Z entirely — they can't satisfy the (0,0) anchor constraint in any
  // orientation without overlapping themselves or producing holes.
];

// Parse outline strings → set of "c,r" cell keys for cells the player must fill.
function _outlineCells(outline) {
  const cells = [];
  for (let r = 0; r < outline.length; r++) {
    const row = outline[r] || '.....';
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 'X') cells.push([c, r]);
    }
  }
  return cells;
}

// Backtracking tiler: returns array of {blockIdx, col, row} that exactly covers outline.
// Uses lowest-row-then-leftmost-col scan order so placements match gravity reality.
function _tileOutline(outline) {
  const targetSet = new Set();
  _outlineCells(outline).forEach(([c,r]) => targetSet.add(c+','+r));
  const totalNeeded = targetSet.size;
  const filled = new Set();
  const placements = [];

  function nextAnchor() {
    for (let r = 0; r < 6; r++) {
      const row = outline[r] || '.....';
      for (let c = 0; c < 5; c++) {
        if (row[c] === 'X' && !filled.has(c+','+r)) return [c, r];
      }
    }
    return null;
  }

  function tryBlock(block, anchorCol, anchorRow) {
    const covered = [];
    for (let i = 0; i < block.length; i++) {
      const c = anchorCol + block[i].dx;
      const r = anchorRow + block[i].dy;
      const key = c+','+r;
      if (!targetSet.has(key)) return null;
      if (filled.has(key)) return null;
      covered.push(key);
    }
    return covered;
  }

  function solve() {
    const anchor = nextAnchor();
    if (!anchor) return filled.size === totalNeeded;
    const [ac, ar] = anchor;
    // Randomize block try order so we get varied tilings
    const order = GRAY_BLOCKS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const bIdx of order) {
      const block = GRAY_BLOCKS[bIdx];
      const covered = tryBlock(block, ac, ar);
      if (!covered) continue;
      covered.forEach(k => filled.add(k));
      placements.push({ blockIdx: bIdx, col: ac, row: ar });
      if (solve()) return true;
      covered.forEach(k => filled.delete(k));
      placements.pop();
    }
    return false;
  }

  return solve() ? placements : null;
}

// Gravity-aware topological sort of placements.
// A block at row R is "supported" if, for every cell (c, R_bottom) in its bottom row,
// either R_bottom === 0 (floor) OR (c, R_bottom - 1) is already filled by an earlier placement.
// Returns a valid placement ORDER respecting gravity, or null if none exists.
function _orderByGravity(placements) {
  // For each placement, compute the set of cells it occupies + its bottom-row cells.
  const meta = placements.map(function(p, i) {
    const block = GRAY_BLOCKS[p.blockIdx];
    const cells = block.map(function(o) { return [p.col+o.dx, p.row+o.dy]; });
    // Find minimum dy in the block
    let minDy = Infinity;
    block.forEach(function(o) { if (o.dy < minDy) minDy = o.dy; });
    const bottomCells = block
      .filter(function(o) { return o.dy === minDy; })
      .map(function(o) { return [p.col+o.dx, p.row+o.dy]; });
    return { idx: i, cells, bottomCells, placement: p };
  });
  // cellOwner: "c,r" → placement index that fills it
  const cellOwner = new Map();
  meta.forEach(function(m) {
    m.cells.forEach(function(cell) {
      cellOwner.set(cell[0]+','+cell[1], m.idx);
    });
  });
  // For each placement, compute its dependencies (other placements whose cells it rests on)
  meta.forEach(function(m) {
    m.deps = new Set();
    m.bottomCells.forEach(function(cell) {
      const c = cell[0], r = cell[1];
      if (r === 0) return; // on floor, no dep
      const below = c + ',' + (r - 1);
      if (cellOwner.has(below)) {
        const depIdx = cellOwner.get(below);
        if (depIdx !== m.idx) m.deps.add(depIdx);
      } else {
        // Cell directly below is not part of the solution — means this placement would
        // float mid-air with nothing underneath. That's an unbuildable plan.
        m.deps.add(-1); // sentinel: impossible
      }
    });
  });
  // Check for impossible placements
  for (const m of meta) {
    if (m.deps.has(-1)) return null;
  }
  // Kahn's topological sort with random sibling order
  const inDeg = meta.map(function(m) { return m.deps.size; });
  const ready = [];
  for (let i = 0; i < meta.length; i++) if (inDeg[i] === 0) ready.push(i);
  const order = [];
  const dependents = meta.map(function() { return []; });
  meta.forEach(function(m) {
    m.deps.forEach(function(d) { dependents[d].push(m.idx); });
  });
  while (ready.length > 0) {
    // Shuffle ready queue so independent siblings come out in random order
    const pick = Math.floor(Math.random() * ready.length);
    const cur = ready.splice(pick, 1)[0];
    order.push(cur);
    dependents[cur].forEach(function(dep) {
      inDeg[dep]--;
      if (inDeg[dep] === 0) ready.push(dep);
    });
  }
  if (order.length !== meta.length) return null; // cycle (shouldn't happen but safety)
  return order.map(function(i) { return placements[i]; });
}

function initGrayRubble(eventMeta) {
  // Try multiple outlines/solutions until we find one that's (a) tileable and (b) gravity-orderable
  for (let tries = 0; tries < 20; tries++) {
    const outline = GRAY_OUTLINES[Math.floor(Math.random()*GRAY_OUTLINES.length)];
    const solution = _tileOutline(outline);
    if (!solution || solution.length < 1) continue;
    const ordered = _orderByGravity(solution);
    if (!ordered) continue;
    eventMeta.grayOutline = outline;
    eventMeta.grayBlocks = ordered.map(function(p) { return GRAY_BLOCKS[p.blockIdx]; });
    return;
  }
  // Fallback: flat-5 outline with 5 singles (trivially gravity-safe)
  eventMeta.grayOutline = GRAY_OUTLINES[0];
  eventMeta.grayBlocks = [GRAY_BLOCKS[0], GRAY_BLOCKS[0], GRAY_BLOCKS[0], GRAY_BLOCKS[0], GRAY_BLOCKS[0]];
}

// ── SAVE / LOAD ───────────────────────────────────────────
const SAVE_FILE = path.join(__dirname, 'brickquest-save.json');
let _saveTimer = null;

function saveState() {
  try {
    const data = JSON.stringify({ savedAt: new Date().toISOString(), G }, null, 2);
    fs.writeFileSync(SAVE_FILE, data);
  } catch(e) { console.error('[SAVE] Error:', e.message); }
}

function loadState() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    if (data && data.G) {
      G = data.G;
      // Migration: old phases trade/move/setup → prepare
      if (G.phase === 'trade' || G.phase === 'move' || G.phase === 'setup') {
        console.log('[LOAD] Migrating old phase "' + G.phase + '" → "prepare"');
        G.phase = 'prepare';
      }
      // Migration: ensure new per-player fields exist
      if (G.players) {
        Object.keys(G.players).forEach(function(c) {
          var p = G.players[c];
          if (p.dashUsedThisTurn === undefined) p.dashUsedThisTurn = false;
          if (p.battleDashPenalty === undefined) p.battleDashPenalty = 0;
          // S012: bricksCharged mirrors bricks on first migration (full-charge default)
          if (p.bricksCharged === undefined && p.bricks) {
            p.bricksCharged = { ...p.bricks };
          }
          // S013: per-color pulse-timing map. Empty map means no charges have
          // been spent yet this session (no pulse until first use).
          if (p.lastDropped === undefined) p.lastDropped = {};
        });
      }
      if (G.pendingDashRequest === undefined) G.pendingDashRequest = null;
      if (G.pendingRumbleBattle === undefined) G.pendingRumbleBattle = null;
      if (G.rumbleBattle === undefined) G.rumbleBattle = null;
      console.log('[LOAD] Session restored from ' + data.savedAt);
      return true;
    }
  } catch(e) { console.error('[LOAD] Error:', e.message); }
  return false;
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveState, 1500); // debounce — save 1.5s after last change
}

// Try loading saved state on startup
if (loadState()) {
  console.log('[SAVE] Type  save   to force-save');
  console.log('[SAVE] Type  load   to reload from disk');
  console.log('[SAVE] Type  reset  to start a fresh game');
  console.log('[SAVE] Type  status to see current game state');
} else {
  console.log('[SAVE] No saved session found — starting fresh.');
  console.log('[SAVE] Game auto-saves after every action to brickquest-save.json');
}

// ── CONSOLE COMMANDS ─────────────────────────────────────
if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', function(input) {
    const cmd = input.trim().toLowerCase();
    if (cmd === 'save') {
      saveState();
      console.log('[SAVE] Saved to brickquest-save.json at ' + new Date().toLocaleTimeString());
    } else if (cmd === 'load') {
      if (loadState()) {
        broadcastState();
        console.log('[LOAD] State reloaded and broadcast to all clients.');
      } else {
        console.log('[LOAD] No save file found.');
      }
    } else if (cmd === 'reset') {
      G = freshState();
      saveState();
      broadcastState();
      console.log('[RESET] Game reset to fresh state.');
    } else if (cmd === 'status') {
      console.log('--- GAME STATUS ---');
      console.log('Round:', G.round, '| Phase:', G.phase);
      console.log('Active player:', G.turnOrder[G.activePlayerIdx]);
      console.log('Rumble battle:', !!G.rumbleBattle);
      Object.values(G.players).forEach(function(p) {
        if (!p.playerName && p.hp === p.hpMax) return; // skip unjoined
        var brickTotal = Object.values(p.bricks).reduce(function(a,b){return a+b;},0);
        console.log(' ', p.icon, (p.playerName||p.name).padEnd(16),
          'HP:'+p.hp+'/'+p.hpMax, '🛡'+p.armor, '🪙'+p.gold, '🧱'+brickTotal,
          p.connected?'(online)':'(offline)');
      });
      console.log('-------------------');
    } else if (cmd === '') {
      // ignore blank lines
    } else {
      console.log('[CMD] Unknown command: "' + cmd + '". Try: save | load | reset | status');
    }
  });
}

// ── RIDDLES ───────────────────────────────────────────────
const RIDDLES = require('./game.js').RIDDLES;

// Wrong-answer distractor pools for multiple-choice. Selection is driven
// by the riddle's answerType field (see game.js RIDDLES). Before the pool
// was flat and nouns-only — which made color and number answers trivial
// to spot. Categorized pools mean a color riddle's distractors are all
// colors (with one ironic outlier like 'boot' for flavor), a number
// riddle's distractors are all numbers, etc.
const WRONG_POOLS = {
  noun: [
    'a shadow','a mirror','a candle','the wind','a key','a secret','silence','a door',
    'a bridge','a coin','an hourglass','a flame','a needle','a ladder','a stone',
    'a ring','a book','a well','a thread','a bell','a feather','a riddle',
    'a name','a promise','a breath','a whisper'
  ],
  color: [
    'red','blue','green','yellow','white','black','gray','orange','purple','boot'
    // 'boot' is the ironic outlier — intentionally not a color. Keep the joke rare
    // by only surfacing as one of several distractors; players find it occasionally.
  ],
  number: [
    '1','2','3','4','6','7','8','10','a dozen','zero','none','thirteen'
    // Excluded: '5' — the current '5' riddle's correct answer. Filtered further at pick-time.
  ],
  entity: [
    'goblin','skeleton','slinger','shadow wolf','creeping vines',
    'stone troll','cursed knight','void wraith','stone colossus','blight worm'
  ],
  class: [
    'breaker','formwright','snapstep','blocksmith','fixer','wild one','the dungeon master'
    // 'the dungeon master' is the ironic outlier — a real role in the game but not a player class.
  ],
};
// Back-compat — any legacy code referring to the flat array still works.
const WRONG_ANSWERS = WRONG_POOLS.noun;

const CHALLENGES = [
  "First to stack 5 bricks end-on-end with one hand wins!",
  "Rock Paper Scissors — best of 3 against the DM!",
  "Guess the number the DM is thinking (1–10). Closest wins!",
  "First to name 3 brick colors without looking at the supply!",
  "Thumb war with the player on your left — winner claims the brick!",
];

// ── HTTP SERVER ───────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/dm_screen.html';
  const file = path.join(__dirname, url);
  const ext  = path.extname(file);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── WEBSOCKET ─────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });
const clients = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach((_, ws) => { if (ws.readyState === 1) ws.send(msg); });
}
function broadcastState() { broadcast({ type:'state', state:G }); scheduleSave(); }

function log(text, kind='normal') {
  G.log.unshift({ text, kind, round:G.round, t: new Date().toLocaleTimeString() });
  if (G.log.length > 120) G.log.length = 120;
}

// ── HEAL HELPER ───────────────────────────────────────────
// ── ROLL HELPERS ──────────────────────────────────────────
function roll(sides) { return Math.floor(Math.random()*sides)+1; }
function rollRange(min,max) { return min + Math.floor(Math.random()*(max-min+1)); }

// ── DASH RESOLVER ─────────────────────────────────────────
// Handles movement, gate interactions, damage, and landing event for both
// player-initiated (approveRedDash) and DM force-dash (forceDash).
// Emits a dashResult message to all clients with everything that happened,
// so the active player can show a dramatic result card.
function resolveDash(cls, spaces, forcedByDM) {
  const p = G.players[cls];
  if (!p) return;
  const meta = PLAYER_META[cls] || {};
  const boardLen = SPACES.length;
  const startSpace = p.space;
  const requested = Math.max(1, parseInt(spaces)||1);
  let target = Math.min(startSpace + requested, boardLen - 1);

  // Walk the path from current space +1 to target, stopping/resolving gates as we go
  const gateKeys = Object.keys(GATE_SPACES);
  const gateEvents = []; // accumulate events to report to the client
  let finalDest = target;
  let totalDmg = 0;
  let totalArmorAbsorbed = 0;

  for (let i = startSpace + 1; i <= target; i++) {
    const gateKey = gateKeys.find(k => GATE_SPACES[k] === i);
    if (!gateKey) continue;
    if (G.gates[gateKey] !== 'locked') continue; // open gate, pass through
    const rule = GATE_RULES[gateKey] || 'forceable';
    if (rule === 'key') {
      // Key-only gate — stop at the gate space, do not attempt break
      finalDest = i;
      gateEvents.push({ gate: gateKey, space: i, kind: 'key_stop' });
      break;
    }
    // Forceable gate — attempt break
    const chance = meta.dashBreakChance !== undefined ? meta.dashBreakChance : 0.5;
    const breakSuccess = Math.random() < chance;
    const alwaysDmg = !!meta.dashDmgAlwaysRolls;
    let dmg = 0;
    if (breakSuccess || alwaysDmg) {
      const dmgRange = meta.dashBreakDmg || [1,2];
      dmg = rollRange(dmgRange[0], dmgRange[1]);
    }
    // Apply armor absorption
    let absorbed = 0;
    if (dmg > 0 && (p.armor||0) > 0) {
      absorbed = Math.min(p.armor, dmg);
      p.armor -= absorbed;
      dmg -= absorbed;
    }
    if (dmg > 0) {
      p.hp = Math.max(0, p.hp - dmg);
      if (p.hp <= 0) p.alive = false;
    }
    totalDmg += dmg;
    totalArmorAbsorbed += absorbed;
    if (breakSuccess) {
      G.gates[gateKey] = 'open';
      gateEvents.push({ gate: gateKey, space: i, kind: 'break_success', dmg, armorAbsorbed: absorbed });
      // Continue dash past the gate
    } else {
      finalDest = i; // stop at gate on failure
      gateEvents.push({ gate: gateKey, space: i, kind: 'break_fail', dmg, armorAbsorbed: absorbed });
      break;
    }
  }

  p.space = finalDest;
  // S012 §1.1: charges refresh when the player crosses a zone boundary during dash.
  const prevZoneD = SPACES[startSpace] ? SPACES[startSpace].zone : 0;
  const newZoneD  = SPACES[finalDest]  ? SPACES[finalDest].zone  : 0;
  if (newZoneD !== prevZoneD) refreshCharges(p);
  // DM force-dash stays in prepare so player returns to their prior status.
  // Player-initiated dash advances to land so the landing event triggers.
  if (!forcedByDM) {
    G.phase = 'land';
  }

  const pName = p.playerName || p.name;
  const logPrefix = forcedByDM ? '[DM-force]' : '';
  log(`${logPrefix} ${pName} dashed ${startSpace+1} → ${finalDest+1}${totalDmg>0?' (−'+totalDmg+' HP)':''}`.trim(), 'move');
  for (const g of gateEvents) {
    if (g.kind === 'key_stop') log(`Gate ${g.gate} requires a key — dash halted`, 'gate');
    else if (g.kind === 'break_success') log(`${pName} crashed through ${g.gate}! ${g.dmg>0 ? '−'+g.dmg+' HP' : 'unscathed'}${g.armorAbsorbed>0?' ('+g.armorAbsorbed+' absorbed)':''}`, 'gate');
    else if (g.kind === 'break_fail') log(`${pName} bounced off ${g.gate}${g.dmg>0 ? ' — '+g.dmg+' HP' : ''}${g.armorAbsorbed>0?' ('+g.armorAbsorbed+' absorbed)':''}`, 'gate');
  }

  // Broadcast a dashResult so the active player can show a dramatic card
  const flavor = DASH_FLAVOR[cls] || { success:'Through!', fail:'Blocked!' };
  const resultMsg = JSON.stringify({
    type: 'dashResult',
    cls, forcedByDM,
    start: startSpace, end: finalDest, requested,
    gateEvents, totalDmg, totalArmorAbsorbed,
    flavor,
  });
  clients.forEach((info, cws) => { if(cws.readyState===1) cws.send(resultMsg); });
}

// ── MESSAGE HANDLER ───────────────────────────────────────
wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const role = params.get('role') || 'dm';
  clients.set(ws, { role });
  if (G.players[role]) { G.players[role].connected = true; log(G.players[role].name+' connected','connect'); }
  ws.send(JSON.stringify({ type:'state', state:G }));
  broadcastState();

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload: P } = msg;

    // ── GAME FLOW ──
    if (type === 'setPhase')        { G.phase = P.phase; }
    if (type === 'nextTurn') {
      // Advance to next player — skip disconnected ones
      let attempts = 0;
      do {
        G.activePlayerIdx = (G.activePlayerIdx+1) % G.turnOrder.length;
        attempts++;
        if (G.activePlayerIdx === 0) {
          G.round++;
          // End of round effects
          if (G.fortressBricks > 0) { G.fortressBricks--; log(`Fortress: ${G.fortressBricks} bricks remain`,'scenario'); }
        // Poison
        G.turnOrder.forEach(cls => {
          const p = G.players[cls];
          if (p.alive && p.statusEffects.includes('poisoned')) {
            p.hp = Math.max(0, p.hp-1);
            if (p.hp<=0) { p.alive=false; }
            log(`${p.name} poison −1 HP → ${p.hp}`,'damage');
          }
        });
      }
      G.phase = 'prepare';
      const nextCls = G.turnOrder[G.activePlayerIdx];
      // Reset per-turn flags for the new active player
      if (G.players[nextCls]) {
        G.players[nextCls].dashUsedThisTurn = false;
      }
      // Clear dash penalty for everyone (if no battle triggered, penalty expires)
      G.turnOrder.forEach(c => { if (G.players[c]) G.players[c].battleDashPenalty = 0; });
      // Clear any stale pending dash (shouldn't exist, but defensive)
      G.pendingDashRequest = null;
      log(`--- ${G.players[nextCls]?.playerName||G.players[nextCls]?.name||nextCls}'s turn (Round ${G.round}) ---`,'round');
      // Keep skipping if player not connected (but stop after full loop to avoid infinite)
      } while (!G.players[G.turnOrder[G.activePlayerIdx]]?.connected && attempts < G.turnOrder.length);
    }
    if (type === 'purchaseBrick') {
      const { cls, color } = P;
      const p = G.players[cls];
      if (!p) { broadcastState(); return; }
      const prices = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
      const price = prices[color] || 99;
      // Store disabled in Zone 2 (index 1) and Zone 5 (index 4), or by DM toggle
      const playerZone = SPACES[p.space] ? SPACES[p.space].zone : 0;
      const storeDisabledZones = [4]; // Zone 5 only
      if (G.storeDisabled || storeDisabledZones.includes(playerZone)) {
        ws.send(JSON.stringify({type:'error',msg:'Store not available in this zone'}));
        broadcastState(); return;
      }
      if ((p.gold||0) < price) {
        ws.send(JSON.stringify({type:'error',msg:'Need '+price+' gold for '+color+' brick (have '+(p.gold||0)+')'}));
        broadcastState(); return;
      }
      p.gold -= price;
      addBrick(p, color, 1);
      log((p.playerName||p.name)+' bought '+color+' brick ('+price+'g) → '+p.gold+'g remaining','reward');
      // Notify player of purchase
      ws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color,label:'Bought '+color+' brick! ('+price+'g)',brickColor:BRICK_COLORS[color]||'#888'}));
    }

    if (type === 'setActivePlayer') { G.activePlayerIdx = P.idx; G.phase='prepare'; }

    // ── MOVEMENT (DM enters roll) ──
    if (type === 'dmMovePlayer') {
      const { cls, roll: rawRoll, destination, backward } = P;
      const p = G.players[cls];
      let finalRoll = rawRoll;
      // Apply modifiers
      if (cls==='snapstep') finalRoll += 1;
      if (G.movementDebuffs[cls]) { finalRoll = Math.max(0, finalRoll - G.movementDebuffs[cls]); delete G.movementDebuffs[cls]; }
      // Destination is computed by DM screen after gate checks.
      const prev = p.space;
      p.space = destination;
      // v4 ZONE TRANSITION CLEANUP — WEAKNESS + SLOW TONGUE clear when entering new zone
      const prevZone = SPACES[prev] ? SPACES[prev].zone : 0;
      const newZone = SPACES[destination] ? SPACES[destination].zone : 0;
      if (newZone !== prevZone) {
        // S012 §1.1: charges refresh when the player crosses a zone boundary.
        refreshCharges(p);
        if (p.weaknessReduction && p.weaknessReduction > 0) {
          p.hpMax = (p.hpMax||10) + p.weaknessReduction;
          log((p.playerName||p.name)+' crosses into Zone '+(newZone+1)+' — weakness lifts (+'+p.weaknessReduction+' Max HP restored)','reward');
          p.weaknessReduction = 0;
        }
        if (G.slowTongueZones && G.slowTongueZones[cls]) {
          // Keep only non-expired zones (current + future)
          G.slowTongueZones[cls] = G.slowTongueZones[cls].filter(z => z >= newZone);
        }
      }
      G.phase = 'land';
      log(`${p.name} moved ${rawRoll}${cls==='snapstep'?'+snapstep bonus':''} → space ${destination+1}`,'move');
      // Check black brick pass-through (no stop = safe pickup)
      broadcastState(); return;
    }

    // ── RED DASH — player requests, DM approves ──
    if (type === 'requestRedDash') {
      const { cls, spaces } = P;
      const p = G.players[cls];
      if (!p) { broadcastState(); return; }
      // Validate: must be active player's turn, phase is move or trade, has red brick, hasn't dashed this turn, no pending
      const activeCls = G.turnOrder[G.activePlayerIdx];
      if (cls !== activeCls) { ws.send(JSON.stringify({type:'dashDenied', cls, reason:'not your turn'})); broadcastState(); return; }
      if (G.phase !== 'prepare') { ws.send(JSON.stringify({type:'dashDenied', cls, reason:'not in prepare phase'})); broadcastState(); return; }
      if ((p.bricks.red||0) < 1) { ws.send(JSON.stringify({type:'dashDenied', cls, reason:'no red bricks'})); broadcastState(); return; }
      if (p.dashUsedThisTurn) { ws.send(JSON.stringify({type:'dashDenied', cls, reason:'already dashed this turn'})); broadcastState(); return; }
      if (G.pendingDashRequest) { ws.send(JSON.stringify({type:'dashDenied', cls, reason:'another dash request pending'})); broadcastState(); return; }
      const sp = Math.max(1, Math.min(4, parseInt(spaces)||1));
      G.pendingDashRequest = { cls, spaces: sp, requestedAt: Date.now() };
      log(`${p.playerName||p.name} requested red dash → ${sp} spaces (awaiting DM)`,'move');
      broadcastState(); return;
    }

    if (type === 'approveRedDash') {
      if (!G.pendingDashRequest) { broadcastState(); return; }
      const { cls, spaces } = G.pendingDashRequest;
      const p = G.players[cls];
      if (!p || (p.bricks.red||0) < 1) {
        G.pendingDashRequest = null;
        broadcastState(); return;
      }
      // Consume brick + per-turn flag + next-battle dash penalty
      removeBrick(p, 'red', 1);
      p.dashUsedThisTurn = true;
      p.battleDashPenalty = 1; // next battle this turn decrements red by 1 extra
      resolveDash(cls, spaces, false);
      G.pendingDashRequest = null;
      broadcastState(); return;
    }

    if (type === 'denyRedDash') {
      if (!G.pendingDashRequest) { broadcastState(); return; }
      const { cls } = G.pendingDashRequest;
      const p = G.players[cls];
      G.pendingDashRequest = null;
      if (p) log(`${p.playerName||p.name} red dash denied by DM`,'move');
      const denyMsg = JSON.stringify({type:'dashDenied', cls, reason:'denied by DM'});
      clients.forEach((info, cws) => { if(cws.readyState===1) cws.send(denyMsg); });
      broadcastState(); return;
    }

    // ── DM FORCE DASH — testing tool. No brick cost, no flags. Still gate-resolves normally. ──
    if (type === 'forceDash') {
      const { cls, spaces } = P;
      const p = G.players[cls];
      if (!p) { broadcastState(); return; }
      const sp = Math.max(1, parseInt(spaces)||1);
      G.pendingDashRequest = null;
      log(`[DM] force-dash ${p.playerName||p.name} → ${sp} spaces`,'move');
      resolveDash(cls, sp, true);
      broadcastState(); return;
    }

    // ═══════════════════════════════════════════════════
    // RUMBLE BATTLE HANDLERS
    // ═══════════════════════════════════════════════════
    // Shared helper: transition pendingRumbleBattle → active rumbleBattle state
    function startRumbleBattleFromPending(forced) {
      if (!G.pendingRumbleBattle) return false;
      const pending = G.pendingRumbleBattle;
      const p = G.players[pending.cls];
      if (!p) { G.pendingRumbleBattle = null; return false; }
      // S013.6: reviveCount is scoped to the CURRENT rumble only. Clear any
      // carryover from the prior rumble when this one starts. Loot penalty
      // (−10% per) should never compound across battles. DM roster badge
      // clears at the same moment.
      p.reviveCount = 0;
      // Seed the live battle state — snapshot of player's current HP, armor,
      // and bricks; the client reports back incrementally via battleTick.
      // S013 spec change (supersedes V2 §1.1 line 98): rumble no longer
      // refreshes charges at entry. Partial board state carries through.
      // Zone gate crossings remain the only full refresh trigger.
      G.rumbleBattle = {
        cls: pending.cls,
        entityType: pending.entityType,
        enemy: { ...pending.enemy },
        flavor: pending.flavor,
        playerRumble: {
          hp: p.hp,
          hpMax: p.hpMax,
          armor: p.armor || 0,
          gold: p.gold || 0,
          bricks: { ...p.bricks },
          bricksCharged: { ...p.bricksCharged },
          queuedPoisonStacks: p.queuedPoisonStacks || 0, // v4: rumble applies these on start
          // v4: FW blue-success buff — 2× brick refresh for first 10s of this rumble
          refreshBoost: (p.nextRumbleBuff && p.nextRumbleBuff.refreshBoost) || null,
        },
        startTime: Date.now(),
        elapsedMs: 0,
        paused: false,
        forced: !!forced,
        log: [
          { t:0, actor:'system', text: pending.flavor },
        ],
      };
      // v4: decrement queued poison battles (this battle counts)
      if ((p.queuedPoisonBattles||0) > 0) {
        p.queuedPoisonBattles -= 1;
        if (p.queuedPoisonBattles <= 0) {
          p.queuedPoisonStacks = 0;
          p.queuedPoisonBattles = 0;
        }
      }
      // v4: FW refresh buff is one-shot — consume it on this battle start
      if (p.nextRumbleBuff && p.nextRumbleBuff.refreshBoost) {
        delete p.nextRumbleBuff.refreshBoost;
        if (Object.keys(p.nextRumbleBuff).length === 0) p.nextRumbleBuff = null;
      }
      G.pendingRumbleBattle = null;
      // v4: Snapshot starting stats on the active event so DM can show deltas post-battle
      if (G.activeEvent && (G.activeEvent.evType === 'monster' || G.activeEvent.evType === 'boss')) {
        G.activeEvent.preRumbleSnap = {
          hp: p.hp,
          hpMax: p.hpMax,
          armor: p.armor || 0,
          gold: p.gold || 0,
          bricks: { ...p.bricks },
          enemyName: pending.enemy.name,
          enemyHp: pending.enemy.hp,
          enemyHpMax: pending.enemy.hpMax,
        };
      }
      log((p.playerName||p.name) + ' — rumble battle begins vs ' + pending.enemy.name, 'battle');
    }

    // Player taps "Enter Rumble" on their event card
    if (type === 'battleReady') {
      const { cls } = P;
      if (!G.pendingRumbleBattle || G.pendingRumbleBattle.cls !== cls) { broadcastState(); return; }
      startRumbleBattleFromPending(false);
      broadcastState(); return;
    }

    // DM taps "Start Battle" (same effect as battleReady, DM side)
    if (type === 'battleStartDM') {
      if (!G.pendingRumbleBattle) { broadcastState(); return; }
      startRumbleBattleFromPending(false);
      broadcastState(); return;
    }

    // DM taps "Force Battle" — skips the event card, player drops straight to rumble
    if (type === 'battleForceDM') {
      if (!G.pendingRumbleBattle) { broadcastState(); return; }
      startRumbleBattleFromPending(true);
      broadcastState(); return;
    }

    // Client sends periodic ticks with HP/brick/enemy state + log entries
    if (type === 'battleTick') {
      if (!G.rumbleBattle) { broadcastState(); return; }
      const { cls, playerHp, playerHpMax, playerArmor, playerGold, playerBricks, enemyHp, elapsedMs, logEntries } = P;
      if (cls !== G.rumbleBattle.cls) { broadcastState(); return; }
      if (G.rumbleBattle.paused) { broadcastState(); return; } // ignore ticks while paused
      if (typeof playerHp === 'number') G.rumbleBattle.playerRumble.hp = playerHp;
      if (typeof playerHpMax === 'number') G.rumbleBattle.playerRumble.hpMax = playerHpMax;
      if (typeof playerArmor === 'number') G.rumbleBattle.playerRumble.armor = playerArmor;
      if (typeof playerGold === 'number') G.rumbleBattle.playerRumble.gold = playerGold;
      if (playerBricks && typeof playerBricks === 'object') G.rumbleBattle.playerRumble.bricks = playerBricks;
      if (typeof enemyHp === 'number') G.rumbleBattle.enemy.hp = enemyHp;
      if (typeof elapsedMs === 'number') G.rumbleBattle.elapsedMs = elapsedMs;
      if (Array.isArray(logEntries) && logEntries.length) {
        G.rumbleBattle.log = G.rumbleBattle.log.concat(logEntries);
        // Cap log to last 60 entries
        if (G.rumbleBattle.log.length > 60) {
          G.rumbleBattle.log = G.rumbleBattle.log.slice(-60);
        }
      }
      broadcastState(); return;
    }

    // Client reports battle end with final state + winner
    if (type === 'battleEnd') {
      if (!G.rumbleBattle) { broadcastState(); return; }
      const { cls, victor, finalHp, finalHpMax, finalArmor, finalGold, finalCheese, finalBricks, finalBrickMax, reason, battleStats, reviveCount } = P;
      if (cls !== G.rumbleBattle.cls) { broadcastState(); return; }
      const p = G.players[cls];
      if (p) {
        if (typeof finalHp === 'number') p.hp = Math.max(0, finalHp);
        // Cheese pickups raise hpMax mid-battle — persist the new ceiling.
        if (typeof finalHpMax === 'number') p.hpMax = Math.max(1, finalHpMax);
        if (typeof finalArmor === 'number') p.armor = Math.max(0, finalArmor);
        // Coins picked up in rumble add to the existing board-side gold pool.
        // finalGold is the rumble-end total (started from p.gold at battle
        // start + any drops); we replace rather than add since rumble already
        // has the running total.
        if (typeof finalGold === 'number') p.gold = Math.max(0, finalGold);
        // v4: Rumble cheese loot — add to board cheese inventory (rumble starts at 0 cheese, any loot is new).
        if (typeof finalCheese === 'number' && finalCheese > 0) {
          p.cheese = (p.cheese||0) + Math.max(0, finalCheese);
        }
        // S013.6: Revive counter persists across rumbles on server player.
        // Each heart-revive (not cheese-revive) in-rumble stacks loot penalty.
        if (typeof reviveCount === 'number') {
          p.reviveCount = Math.max(0, reviveCount);
        }
        // S012 §1.1: rumble reports two brick totals at end:
        //   finalBrickMax = inventory ceiling (grew if player looted bricks in rumble)
        //   finalBricks   = remaining charges (<= ceiling; persists to next board phase)
        // Older clients send only finalBricks; treat as both.
        if (finalBrickMax && typeof finalBrickMax === 'object') {
          Object.keys(finalBrickMax).forEach(k => { p.bricks[k] = Math.max(0, finalBrickMax[k]); });
        } else if (finalBricks && typeof finalBricks === 'object') {
          Object.keys(finalBricks).forEach(k => { p.bricks[k] = Math.max(0, finalBricks[k]); });
        }
        if (finalBricks && typeof finalBricks === 'object') {
          if (!p.bricksCharged) p.bricksCharged = {};
          Object.keys(finalBricks).forEach(k => {
            // Clamp to ceiling to preserve invariant.
            p.bricksCharged[k] = Math.max(0, Math.min(p.bricks[k] || 0, finalBricks[k]));
          });
        }
        if (p.hp <= 0) p.alive = false;
      }
      const pName = p ? (p.playerName||p.name) : cls;
      log(pName + ' battle ended — victor: ' + victor + (reason ? ' (' + reason + ')' : ''), 'battle');
      G.rumbleBattle = null;

      // v4: Populate rumbleResult on the active event so DM can see outcome + press Mark Resolved
      // Turn does NOT auto-advance; DM's Mark Resolved button handles that (via dm_resolved handler).
      if (G.activeEvent && (G.activeEvent.evType === 'monster' || G.activeEvent.evType === 'boss')) {
        G.activeEvent.rumbleResult = {
          cls: cls,
          victor: victor,
          reason: reason || null,
          finalHp: p ? p.hp : null,
          finalHpMax: p ? p.hpMax : null,
          finalArmor: p ? (p.armor || 0) : null,
          finalGold: p ? p.gold : null,
          // S013: both fields saved separately (mirrors wire protocol)
          //   finalBrickMax = inventory ceiling post-rumble (BRICK CHANGES delta)
          //   finalBricks   = remaining charges post-rumble
          finalBrickMax: p ? { ...p.bricks } : null,
          finalBricks:   p ? { ...(p.bricksCharged || p.bricks) } : null,
          // S013.6: revive counter (drives loot penalty; surfaces to DM)
          reviveCount: p ? (p.reviveCount || 0) : 0,
          playerDied: p ? !p.alive : false,
          battleStats: battleStats || null,
        };
      } else {
      }
      G.phase = 'prepare';
      broadcastState(); return;
    }

    // DM toggles pause
    if (type === 'battlePause') {
      if (!G.rumbleBattle) { broadcastState(); return; }
      G.rumbleBattle.paused = !!P.paused;
      log('Battle ' + (G.rumbleBattle.paused ? 'paused' : 'resumed') + ' by DM', 'battle');
      broadcastState(); return;
    }

    // DM force-resets the battle to fresh state (both sides full HP, bricks back to snapshot)
    if (type === 'battleForceReset') {
      if (!G.rumbleBattle) { broadcastState(); return; }
      const b = G.rumbleBattle;
      const p = G.players[b.cls];
      if (!p) { broadcastState(); return; }
      const enemyTpl = ENTITY_META[b.entityType] || { hpMax: 12 };
      b.enemy.hp = enemyTpl.hpMax;
      b.playerRumble.hp = p.hpMax;
      b.playerRumble.armor = 0;
      // Don't reset bricks to original since those came from inventory at start;
      // give the player back a snapshot if available, otherwise leave current.
      b.startTime = Date.now();
      b.elapsedMs = 0;
      b.paused = false;
      b.log = [{ t:0, actor:'system', text: '[DM force-reset]' }];
      log('Battle force-reset by DM', 'battle');
      broadcastState(); return;
    }

    // DM force-quits the battle — no consequences, player returns to board
    if (type === 'battleForceQuit') {
      if (!G.rumbleBattle) { broadcastState(); return; }
      log('Battle force-quit by DM', 'battle');
      const fqCls = G.rumbleBattle.cls;
      const fqP = G.players[fqCls];
      G.rumbleBattle = null;
      if (G.activeEvent && (G.activeEvent.evType === 'monster' || G.activeEvent.evType === 'boss')) {
        G.activeEvent.rumbleResult = {
          cls: fqCls,
          victor: 'none',
          reason: 'force-quit',
          finalHp: fqP ? fqP.hp : null,
          finalHpMax: fqP ? fqP.hpMax : null,
          finalArmor: fqP ? (fqP.armor || 0) : null,
          finalGold: fqP ? fqP.gold : null,
          finalBrickMax: fqP ? { ...fqP.bricks } : null,
          finalBricks:   fqP ? { ...(fqP.bricksCharged || fqP.bricks) } : null,
          reviveCount: fqP ? (fqP.reviveCount || 0) : 0,
          playerDied: false,
        };
      }
      G.phase = 'prepare';
      broadcastState(); return;
    }

    // DM dismisses a pending rumble battle without starting it (e.g. reroll, skip)
    if (type === 'battleDismissPending') {
      if (!G.pendingRumbleBattle) { broadcastState(); return; }
      log('Pending battle dismissed by DM', 'battle');
      G.pendingRumbleBattle = null;
      broadcastState(); return;
    }

    if (type === 'pickupBlackBrick') {
      // Player passes through without stopping — gets brick
      const { cls, spaceIdx } = P;
      G.blackBrickSpaces = G.blackBrickSpaces.filter(b => b.spaceIdx !== spaceIdx);
      G.players[cls].bricks.black = (G.players[cls].bricks.black||0)+1;
      log(`${G.players[cls].name} picked up black brick (pass-through)`,'reward');
    }

    // ── LANDING EVENTS ──
    if (type === 'setPlayerName') {
      const { cls, name } = P;
      if (G.players[cls]) {
        G.players[cls].playerName = (name||'').trim().slice(0,24);
        const clsNames = {breaker:'Breaker',formwright:'Formwright',snapstep:'Snapstep',blocksmith:'Blocksmith',fixer:'Fixer',wild_one:'Wild One'};
        log(`${clsNames[cls]||cls} registered as "${G.players[cls].playerName}"`, 'connect');
      }
    }

    if (type === 'forceEvent') {
      // DM forces a landing event — identical to natural landing, DM just chose it
      const { evType, zone, goldAmount, brickColor, mids, isBoss } = P;
      const cls = G.turnOrder[G.activePlayerIdx];
      const p = G.players[cls];
      if (!p) { broadcastState(); return; }
      const pName = p.playerName||p.name;
      const zoneNum = (zone !== undefined ? zone : 0) + 1;
      G.activeEvent = { cls, roll:'DM', zone: zone||0, resolved:false, evType, goldAmount, brickColor, forced:true };
      G.phase = 'land';
      log(pName+' — DM forced event: '+evType,'event');

      // ── GOLD — full mini-game flow, same as natural ──
      if (evType === 'gold') {
        const goldRanges = { 1:[1,2], 2:[2,3], 3:[1,3], 4:[3,5] };
        const [gMin, gMax] = goldRanges[zoneNum] || [1,2];
        const goldVariants = ['crack','torch'];
        const goldVariant = goldVariants[Math.floor(Math.random()*goldVariants.length)];
        G.activeEvent = { ...G.activeEvent, goldVariant, goldMin: gMin, goldMax: gMax, resolved: false };
        log(pName+' — forced gold: '+goldVariant+' ('+gMin+'-'+gMax+')','event');
      }

      // ── BLUE — full mini-game for all zones when forced ──
      if (evType === 'blue') {
        if (!G.usedBlueVariants) G.usedBlueVariants = {};
        if (!G.usedBlueVariants[cls]) G.usedBlueVariants[cls] = {};
        const zKey = zone||0;
        if (!G.usedBlueVariants[cls][zKey]) G.usedBlueVariants[cls][zKey] = [];
        const allVariants = ['singing_stone','sentry_stone','cipher_lock'];
        let pool = allVariants.filter(v => !G.usedBlueVariants[cls][zKey].includes(v));
        if (pool.length === 0) { G.usedBlueVariants[cls][zKey] = []; pool = allVariants; }
        const variant = pool[Math.floor(Math.random()*pool.length)];
        G.usedBlueVariants[cls][zKey].push(variant);
        G.activeEvent.blueVariant = variant;
        G.activeEvent.isFormwright = (cls === 'formwright');
        G.activeEvent.resolved = false;
        log(pName+' — forced blue: '+variant,'event');
      }

      // ── GRAY — player gets Take 1 / Search choice (same as natural) ──
      // No change needed — activeEvent set above, player renders gray card

      // ── WHITE — auto-give (same as natural) ──
      if (evType === 'white') {
        // v4: trigger Pilgrim's Rest card instead of auto-giving brick
        G.activeEvent.whiteVariant = 'pilgrims_rest';
        G.activeEvent.isFixer = (cls === 'fixer');
        G.activeEvent.resolved = false;
        log(pName+' — forced white: Pilgrim\'s Rest','event');
      }

      // ── v4 PURPLE — Fated Choice ──
      if (evType === 'purple') {
        G.activeEvent.purpleVariant = 'fated_choice';
        G.activeEvent.isFixer = (cls === 'fixer');
        G.activeEvent.resolved = false;
        log(pName+' — forced purple: Fated Choice','event');
      }

      // ── v4 BLACK — Shadow Bargain ──
      if (evType === 'black') {
        G.activeEvent.blackVariant = 'shadow_bargain';
        G.activeEvent.isFormwright = (cls === 'formwright');
        G.activeEvent.isFixer = (cls === 'fixer');
        const rT = Math.random();
        let offer;
        if (rT < 0.55) offer = 'blood_price';
        else if (rT < 0.80) offer = 'brick_exchange';
        else if (rT < 0.95) offer = 'poisoned_favor';
        else offer = 'binding_pact';
        G.activeEvent.blackOffer = offer;
        G.activeEvent.resolved = false;
        log(pName+' — forced black: Shadow Bargain ('+offer+')','event');
      }

      // ── v4 GREEN — Vine Path ──
      if (evType === 'green') {
        G.activeEvent.greenVariant = 'vine_path';
        G.activeEvent.isWildOne = (cls === 'wild_one');
        G.activeEvent.resolved = false;
        log(pName+' — forced green: Vine Path','event');
      }

      // ── v4 RED — Trial of the Hand (party race) ──
      if (evType === 'red') {
        G.activeEvent.redVariant = 'trial_of_hand';
        G.activeEvent.isBreaker = (cls === 'breaker');
        G.activeEvent.redChallenge = RED_CHALLENGES[Math.floor(Math.random()*RED_CHALLENGES.length)];
        G.activeEvent.redPhase = 'joining';       // joining → active → picking → done
        G.activeEvent.redJoined = [cls];          // landing player auto-joined
        G.activeEvent.redJoinEndsAt = Date.now() + 30000;
        G.activeEvent.redStartedAt = null;
        G.activeEvent.redDigitalScores = {};      // { cls: { taps, finishedAt } } for digital challenges
        G.activeEvent.resolved = false;
        log(pName+' — forced red: '+G.activeEvent.redChallenge.name,'event');
      }

      // ── v4 GRAY — Rubble Stacking ──
      if (evType === 'gray') {
        G.activeEvent.grayVariant = 'rubble_stacking';
        G.activeEvent.isBlocksmith = (cls === 'blocksmith');
        initGrayRubble(G.activeEvent);
        G.activeEvent.resolved = false;
        log(pName+' — forced gray: Rubble Stacking','event');
      }

      // ── TRAP / DOUBLETRAP — tap-burst game fires on player (same as natural) ──
      // No change needed — player renders tap burst when evType=trap/doubletrap

      // ── RIDDLE — DM reads aloud, player waits (same as natural) ──
      // No change needed

      // ── MONSTER / BOSS ──
      if (evType === 'monster' && mids && mids.length) {
        G.activeEvent = { cls, roll:'DM', zone:zone||0, resolved:false, evType:'monster', mids, forced:true };
        // Force → pending rumble battle. Pick the entity type from the event's
        // mids array. For multi-mob events (e.g. Knight + Goblin) the first
        // mid drives the rumble entity choice; future work could spawn the
        // full mids list as multiple entities. Fall back to goblin if the
        // mid string isn't in the registry (defensive — shouldn't happen
        // since LANDING_EVENTS uses validated names).
        const entityType = ENTITY_META[mids[0]] ? mids[0] : 'goblin';
        const entityTpl = ENTITY_META[entityType];
        const flavorPool = RUMBLE_FLAVOR[entityType] || [entityTpl.name + ' appears!'];
        const flavor = flavorPool[Math.floor(Math.random() * flavorPool.length)];
        G.pendingRumbleBattle = {
          cls,
          entityType,
          enemy: { type: entityType, name: entityTpl.name, hp: entityTpl.hpMax, hpMax: entityTpl.hpMax, encounterColor: rollEncounterColor(entityType) },
          flavor,
          createdAt: Date.now(),
        };
        log(pName + ' — DM forced encounter: ' + entityTpl.name, 'event');
      }
      if (evType === 'boss') {
        G.activeEvent = { cls, roll:'DM', zone:zone||0, resolved:false, evType:'boss', isBoss:true, forced:true };
      }

    }

    if (type === 'landingRoll') {
      const { cls, roll: rClient, zone } = P;
      const r = roll(7); // server-side roll — v4 tables have 7 event slots per zone
      if (G.activeEvent && G.activeEvent.riddleActive) { broadcastState(); return; }
      if (G.activeEvent && G.activeEvent.cls === cls && !G.activeEvent.resolved) { broadcastState(); return; }
      if (G.activeEvent && G.activeEvent.cls === cls && !G.activeEvent.resolved) {
        broadcastState(); return;
      }
      const p = G.players[cls];
      const pName = p ? (p.playerName||p.name) : cls;
      const spaceIdx = p ? p.space : -1;

      // ── PERSISTENT SPACE EVENTS ──
      // If the space has unresolved events, force those instead of rolling
      if (spaceIdx >= 0) {
        const orangeCount = (G.orangeSpaces && G.orangeSpaces[spaceIdx]) || 0;
        const blueCount   = (G.blueSpaces   && G.blueSpaces[spaceIdx])   || 0;
        const greenCount  = (G.greenSpaces  && G.greenSpaces[spaceIdx])  || 0;

        const yellowWaiting = (G.yellowSpaces && G.yellowSpaces[spaceIdx]) || false;
        if (yellowWaiting) {
          log(pName + ' lands on space with unclaimed yellow brick — riddle resumes', 'event');
          G.activeEvent = { cls, roll:'SPACE', zone, resolved:false, evType:'riddle', forced:true };
          broadcastState(); return;
        }

        // ── v4 LINGERING EVENTS (red/gray/green/purple/white/black) ──
        if (G.lingeringEvents && G.lingeringEvents[spaceIdx]) {
          const L = G.lingeringEvents[spaceIdx];
          L.attemptsSoFar = (L.attemptsSoFar||1) + 1;
          log(pName + ' lands on lingering ' + L.evType + ' — attempt #' + L.attemptsSoFar, 'event');
          G.activeEvent = {
            cls, roll:'SPACE', zone, resolved:false,
            evType: L.evType,
            lingering: true,
            lingeringAttempt: L.attemptsSoFar,
            lingeringOriginCls: L.originCls,
            forced: true,
          };
          // Variant-specific re-roll: each event type produces fresh content per attempt
          if (L.evType === 'purple') G.activeEvent.purpleVariant = 'fated_choice';
          if (L.evType === 'gray')   G.activeEvent.grayVariant = 'rubble_stacking';
          if (L.evType === 'green')  G.activeEvent.greenVariant = 'vine_path';
          if (L.evType === 'white')  G.activeEvent.whiteVariant = 'pilgrims_rest';
          if (L.evType === 'black')  G.activeEvent.blackVariant = 'shadow_bargain';
          if (L.evType === 'red') {
            G.activeEvent.redVariant = 'trial_of_hand';
            G.activeEvent.redChallenge = RED_CHALLENGES[Math.floor(Math.random()*RED_CHALLENGES.length)];
            G.activeEvent.redPhase = 'joining';
            G.activeEvent.redJoined = [cls];   // landing player auto-joined
            G.activeEvent.redJoinEndsAt = Date.now() + 30000;
            G.activeEvent.redStartedAt = null;
            G.activeEvent.redDigitalScores = {};
            G.activeEvent.isBreaker = (cls === 'breaker');
          }
          broadcastState(); return;
        }

        if (orangeCount > 0) {
          log(`${pName} lands on persisted trap space (${orangeCount} trap${orangeCount>1?'s':''})`, 'event');
          const evType = orangeCount >= 2 ? 'doubletrap' : 'trap';
          G.activeEvent = { cls, roll:'SPACE', zone, resolved:false, evType, trapCount:orangeCount, forced:true };
          broadcastState(); return;
        }
        if (blueCount > 0) {
          log(`${pName} lands on persisted blue space — arcane energy lingers`, 'event');
          if (!G.usedBlueVariants) G.usedBlueVariants = {};
          if (!G.usedBlueVariants[cls]) G.usedBlueVariants[cls] = {};
          if (!G.usedBlueVariants[cls][zone]) G.usedBlueVariants[cls][zone] = [];
          const allVariants = ['singing_stone','sentry_stone','cipher_lock'];
          let pool = allVariants.filter(v => !G.usedBlueVariants[cls][zone].includes(v));
          if (pool.length === 0) { G.usedBlueVariants[cls][zone] = []; pool = allVariants; }
          const variant = pool[Math.floor(Math.random()*pool.length)];
          G.usedBlueVariants[cls][zone].push(variant);
          G.activeEvent = { cls, roll:'SPACE', zone, resolved:false, evType:'blue', blueVariant:variant, isFormwright:(cls==='formwright'), forced:true };
          broadcastState(); return;
        }
        if (greenCount > 0) {
          // Green events TBD — auto-give green brick for now
          log(`${pName} lands on persisted green space`, 'event');
          if (p) p.bricks.green = (p.bricks.green||0) + 1;
          delete G.greenSpaces[spaceIdx];
          broadcastState(); return;
        }
      }
      const LANDING = {
        1:[
          {roll:1,type:'gray'},{roll:2,type:'red'},{roll:3,type:'gold',amount:1},
          {roll:4,type:'riddle'},{roll:5,type:'monster',mids:['goblin']},{roll:6,type:'trap'},
          {roll:7,type:'gray'}
        ],
        2:[
          {roll:1,type:'white'},{roll:2,type:'green'},{roll:3,type:'gold',amount:2},
          {roll:4,type:'blue'},{roll:5,type:'monster',mids:['skeleton']},{roll:6,type:'riddle'},
          {roll:7,type:'trap'}
        ],
        3:[
          {roll:1,type:'monster',mids:['goblin','goblin']},{roll:2,type:'black'},{roll:3,type:'purple'},
          {roll:4,type:'green'},{roll:5,type:'riddle'},{roll:6,type:'red'},
          {roll:7,type:'gold',amount:2}
        ],
        4:[
          {roll:1,type:'monster',mids:['stone_troll']},{roll:2,type:'gray'},{roll:3,type:'black'},
          {roll:4,type:'purple'},{roll:5,type:'white'},{roll:6,type:'doubletrap'},
          {roll:7,type:'red'}
        ],
        5:[
          {roll:1,type:'boss'},{roll:2,type:'boss'},{roll:3,type:'boss'},
          {roll:4,type:'boss'},{roll:5,type:'boss'},{roll:6,type:'boss'},
          {roll:7,type:'boss'}
        ]
      };
      const zoneTable = LANDING[zone+1] || LANDING[1];
      const evData = zoneTable[r-1] || {};
      // Snapstep Trap Sense: if snapstep is in same zone, orange landing becomes red challenge
      let resolvedType = evData.type;
      if (resolvedType === 'trap' || resolvedType === 'doubletrap') {
        const scoutP = G.players.snapstep;
        if (scoutP && scoutP.alive && SPACES[scoutP.space] && SPACES[scoutP.space].zone === zone) {
          resolvedType = 'challenge'; // treat as red challenge space instead
          log('Snapstep Trap Sense! Orange trap converted to challenge for '+pName,'action');
        }
      }
      // Store gold/blue amounts on event so DM screen can show them
      let eventMeta = { cls, roll:r, zone, resolved:false, evType:resolvedType };
      if (evData.type === 'gold') { eventMeta.goldAmount = evData.amount||1; }
      if (evData.type === 'blue') { eventMeta.brickColor = 'blue'; }
      // For trap events, count existing traps on this space + this new one
      if (resolvedType === 'trap' || resolvedType === 'doubletrap') {
        const existingTraps = (G.orangeSpaces && G.orangeSpaces[p.space]) || 0;
        const newTraps = resolvedType === 'doubletrap' ? 2 : 1;
        eventMeta.trapCount = existingTraps + newTraps;
      }
      G.activeEvent = eventMeta;
      log(pName+' rolled '+r+' in Zone '+(zone+1)+' — '+evData.type,'event');
      // Auto-apply gold and brick rewards immediately on roll (DM still resolves to advance turn)
      if (evData.type === 'gold' && p) {
        // Don't auto-give — launch mini-game on player screen
        const goldRanges = { 1:[1,2], 2:[2,3], 3:[1,3], 4:[3,5] };
        const zoneNum = (zone !== undefined ? zone : 0) + 1;
        const [gMin, gMax] = goldRanges[zoneNum] || [1,2];
        const goldVariants = ['crack','torch'];
        const goldVariant = goldVariants[Math.floor(Math.random()*goldVariants.length)];
        G.activeEvent = { ...G.activeEvent, goldVariant, goldMin: gMin, goldMax: gMax, resolved: false };
        log(pName+' landed on gold ('+goldVariant+', '+gMin+'-'+gMax+') — mini-game starting','event');
      }
      if (evData.type === 'blue' && p) {
        // All zones: pick a Category B memory event variant
        if (!G.usedBlueVariants) G.usedBlueVariants = {};
        if (!G.usedBlueVariants[cls]) G.usedBlueVariants[cls] = {};
        if (!G.usedBlueVariants[cls][zone]) G.usedBlueVariants[cls][zone] = [];
        const allVariants = ['singing_stone','sentry_stone','cipher_lock'];
        let pool = allVariants.filter(v => !G.usedBlueVariants[cls][zone].includes(v));
        if (pool.length === 0) { G.usedBlueVariants[cls][zone] = []; pool = allVariants; }
        const variant = pool[Math.floor(Math.random()*pool.length)];
        G.usedBlueVariants[cls][zone].push(variant);
        eventMeta.blueVariant = variant;
        eventMeta.isFormwright = (cls === 'formwright');
        log(pName+' found blue energy — '+variant+' event','event');
      }
      // v4 PURPLE — Fated Choice (two-chest event)
      if (evData.type === 'purple' && p) {
        eventMeta.purpleVariant = 'fated_choice';
        eventMeta.isFixer = (cls === 'fixer');
        log(pName+' found a Fated Choice — two chests await','event');
      }
      // v4 WHITE — Pilgrim's Rest
      if (evData.type === 'white' && p) {
        eventMeta.whiteVariant = 'pilgrims_rest';
        eventMeta.isFixer = (cls === 'fixer');
        log(pName+' found a Pilgrim\'s Rest shrine','event');
      }
      // v4 BLACK — Shadow Bargain
      if (evData.type === 'black' && p) {
        eventMeta.blackVariant = 'shadow_bargain';
        eventMeta.isFormwright = (cls === 'formwright');
        eventMeta.isFixer = (cls === 'fixer');
        // Roll offer at server so Formwright can see it up-front via isFormwright flag
        const rT = Math.random();
        let offer;
        if (rT < 0.55) offer = 'blood_price';
        else if (rT < 0.80) offer = 'brick_exchange';
        else if (rT < 0.95) offer = 'poisoned_favor';
        else offer = 'binding_pact';
        eventMeta.blackOffer = offer;
        log(pName+' meets the Shadow — a bargain awaits','event');
      }
      // v4 GREEN — Vine Path
      if (evData.type === 'green' && p) {
        eventMeta.greenVariant = 'vine_path';
        eventMeta.isWildOne = (cls === 'wild_one');
        eventMeta.evType = 'green';
        log(pName+' faces the vines — Vine Path','event');
      }
      // v4 RED — Trial of the Hand (party race)
      if (evData.type === 'red' && p) {
        eventMeta.redVariant = 'trial_of_hand';
        eventMeta.isBreaker = (cls === 'breaker');
        eventMeta.redChallenge = RED_CHALLENGES[Math.floor(Math.random()*RED_CHALLENGES.length)];
        eventMeta.redPhase = 'joining';
        eventMeta.redJoined = [cls];             // landing player auto-joined
        eventMeta.redJoinEndsAt = Date.now() + 30000;
        eventMeta.redStartedAt = null;
        eventMeta.redDigitalScores = {};
        eventMeta.evType = 'red';
        log(pName+' faces the Trial — '+eventMeta.redChallenge.name+' (joining phase)','event');
      }
      // v4 GRAY — Rubble Stacking (when landing is 'gray' in zone 1+)
      if (evData.type === 'gray' && p) {
        eventMeta.grayVariant = 'rubble_stacking';
        eventMeta.isBlocksmith = (cls === 'blocksmith');
        initGrayRubble(eventMeta);
        eventMeta.evType = 'gray';
        log(pName+' approaches fallen rubble — stacking challenge','event');
      }
      // ── ARENA BATTLE HOOK ──
      // If the landing event is a monster, set up a pending rumble battle.
      // The event card on the player's screen AND a panel on the DM's screen
      // can both initiate the rumble. Either party's initiate wins.
      // Pick entity type from evData.mids[0]; this is the natural-roll path
      // (the DM-force path is handled above and uses the same logic).
      if (evData.type === 'monster') {
        const evMids = evData.mids || ['goblin'];
        const entityType = ENTITY_META[evMids[0]] ? evMids[0] : 'goblin';
        const entityTpl = ENTITY_META[entityType];
        const flavorPool = RUMBLE_FLAVOR[entityType] || [entityTpl.name + ' appears!'];
        const flavor = flavorPool[Math.floor(Math.random() * flavorPool.length)];
        G.pendingRumbleBattle = {
          cls,
          entityType,
          enemy: { type: entityType, name: entityTpl.name, hp: entityTpl.hpMax, hpMax: entityTpl.hpMax, encounterColor: rollEncounterColor(entityType) },
          flavor,
          createdAt: Date.now(),
        };
        log(pName + ' encounter: ' + entityTpl.name + ' — awaiting initiate', 'event');
      }
    }

    // ── START RIDDLE — player hits SOLVE button ──
    if (type === 'startRiddle') {
      const { cls } = P;
      if (!G.activeEvent || G.activeEvent.evType !== 'riddle') { broadcastState(); return; }
      if (G.activeEvent.riddleActive) { broadcastState(); return; }
      if (G.activeEvent.cls !== cls) { broadcastState(); return; } // only the active player can start
      const zone = G.activeEvent.zone || 0;
      const used = G.usedRiddleIdxs || [];
      let pool = RIDDLES.map((r,i)=>({r,i})).filter(ri=>ri.r.zone===zone && !used.includes(ri.i));
      if (!pool.length) pool = RIDDLES.map((r,i)=>({r,i})).filter(ri=>!used.includes(ri.i));
      if (!pool.length) pool = RIDDLES.map((r,i)=>({r,i}));
      const picked = pool[Math.floor(Math.random()*pool.length)];
      const r = picked.r;
      // Generate 4 options: correct + 3 distractors.
      // Distractor pool picked by answerType so color riddles show colors,
      // number riddles show numbers, entity riddles show entity names.
      // Falls back to noun pool for untagged riddles.
      const distractorType = r.answerType && WRONG_POOLS[r.answerType] ? r.answerType : 'noun';
      const excluded = [r.a].concat(r.a_alt || []).map(s => String(s).toLowerCase());
      const wrongPool = WRONG_POOLS[distractorType].filter(w => excluded.indexOf(String(w).toLowerCase()) === -1);
      const wrongs = [];
      while (wrongs.length < 3 && wrongPool.length > 0) {
        const w = wrongPool[Math.floor(Math.random()*wrongPool.length)];
        if (!wrongs.includes(w)) wrongs.push(w);
        // Safety: if pool is too small, break to avoid infinite loop.
        if (wrongs.length >= wrongPool.length) break;
      }
      const options = [r.a, ...wrongs].sort(() => Math.random()-0.5);
      const endsAt = Date.now() + 30000; // 30 second timer
      G.activeEvent = { ...G.activeEvent,
        riddleActive: true, riddleIdx: picked.i,
        riddleQ: r.q, riddleA: r.a, riddleClue: r.clue||null,
        riddleOptions: options, riddleEndsAt: endsAt,
        riddleInitiator: cls, riddleWinner: null
      };
      log(cls+' started riddle: "'+r.q+'"','event');
      // Auto-resolve after 30s if no answer
      setTimeout(function() {
        if (!G.activeEvent || !G.activeEvent.riddleActive || G.activeEvent.riddleWinner) return;
        const expiredSpaceIdx = G.players[G.activeEvent.cls] ? G.players[G.activeEvent.cls].space : -1;
        if (expiredSpaceIdx >= 0) {
          if (!G.yellowSpaces) G.yellowSpaces = {};
          G.yellowSpaces[expiredSpaceIdx] = true;
          log('Yellow brick left on space ' + (expiredSpaceIdx+1) + ' — unclaimed','event');
        }
        G.activeEvent = { ...G.activeEvent, riddleActive: false, riddleExpired: true };
        log('Riddle timed out — no winner','event');
        broadcastState();
      }, 30000);
      broadcastState(); return;
    }

    // ── RIDDLE ANSWER — player selects an option ──
    if (type === 'riddleAnswer') {
      const { cls, answer } = P;
      if (!G.activeEvent || !G.activeEvent.riddleActive || G.activeEvent.riddleWinner) { broadcastState(); return; }
      // v4: normalize + accept a_alt array alongside canonical answer
      const normalize = s => String(s||'').trim().toLowerCase();
      const userAns = normalize(answer);
      const canonical = normalize(G.activeEvent.riddleA);
      const riddleObj = RIDDLES[G.activeEvent.riddleIdx] || {};
      const altAnswers = (riddleObj.a_alt || []).map(normalize);
      const isCorrect = (userAns === canonical) || altAnswers.includes(userAns);
      if (isCorrect) {
        // Correct!
        const p = G.players[cls];
        const pNameR = p ? (p.playerName||p.name) : cls;
        if (p) p.bricks.yellow = (p.bricks.yellow||0)+1;
        const r = RIDDLES[G.activeEvent.riddleIdx];
        const clueEntry = r && r.clue ? { clue:r.clue, solverCls:cls, riddleQ:r.q, category:r.category||'', zone:G.activeEvent.zone } : null;
        if (clueEntry) {
          if (!G.discoveredClues) G.discoveredClues = [];
          G.discoveredClues.push(clueEntry);
          if (p) { if (!p.earnedClues) p.earnedClues=[]; p.earnedClues.push(clueEntry); }
        }
        if (!G.usedRiddleIdxs) G.usedRiddleIdxs = [];
        G.usedRiddleIdxs.push(G.activeEvent.riddleIdx);
        if (G.yellowSpaces) {
          const solverSpace = G.players[cls] ? G.players[cls].space : -1;
          if (solverSpace >= 0) delete G.yellowSpaces[solverSpace];
        }
        G.activeEvent = { ...G.activeEvent, riddleActive:false, riddleWinner:cls,
          pendingClue: clueEntry, resolved:false };
        log(pNameR+' answered correctly — +1 yellow brick','reward');
        clients.forEach((info,cws)=>{ if(cws.readyState===1) cws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color:'yellow',label:pNameR+' solved it! +1 Yellow Brick!',brickColor:'#F5D000'})); });
      } else {
        // Wrong — track attempt count per player (max 3)
        const wrongCounts = { ...(G.activeEvent.riddleWrong||{}) };
        wrongCounts[cls] = (wrongCounts[cls]||0) + 1;
        G.activeEvent = { ...G.activeEvent, riddleWrong: wrongCounts };
        log(cls+' answered wrong (attempt '+wrongCounts[cls]+'/3)','event');
      }
      broadcastState(); return;
    }

    if (type === 'resolveEvent') {
      const { cls, eventType, data } = P;
      const p = G.players[cls];
      if (eventType === 'gold') {
        const goldAmt = Math.max(0, parseInt(P.amount ?? (data && data.amount) ?? 0) || 0);
        const gMax = G.activeEvent?.goldMax || 10;
        // Award exactly what was tapped — no minimum floor
        const awarded = Math.min(goldAmt, gMax);
        p.gold = (p.gold||0) + awarded;
        const pNameGold = p.playerName||p.name||cls;
        const wrongTap = P.wrongTap || (data && data.wrongTap);
        const totalPlaced = parseInt(P.total || (data && data.total) || 0) || 0;
        const cheeseFound = Math.max(0, parseInt(P.cheeseFound ?? (data && data.cheeseFound) ?? 0) || 0);
        const variant = G.activeEvent?.goldVariant;

        // v4: Torch + Crack cheese pickups add to cheese inventory directly.
        // Crack has rare (~15% spawn) cheese tiles; torch has them as common decoys.
        if (cheeseFound > 0 && (variant === 'torch' || variant === 'crack')) {
          p.cheese = (p.cheese||0) + cheeseFound;
          var whereFound = variant === 'torch' ? 'in the torchlight' : 'tucked in the crack';
          log(pNameGold+' found '+cheeseFound+' 🧀 cheese '+whereFound,'reward');
        }

        // Crack variant still has the rat bite on wrongTap (kept)
        if (wrongTap && variant === 'crack') {
          p.hp = Math.max(0, (p.hp||0) - 1);
          if (p.hp <= 0) p.alive = false;
          log(pNameGold+' found the rat — -1 HP (rat bite)','damage');
        }

        if (awarded > 0) {
          log(pNameGold+' found '+awarded+' gold (mini-game)','reward');
        }
        G.activeEvent = { ...G.activeEvent, goldResult: { amount: awarded, wrongTap: wrongTap||false, totalPlaced, cheeseFound }, resolved: false };
      }
      if (eventType === 'brick')  {
        const d = data||{};
        addBrick(p, d.color, 1);
        log(`${p.name} found 1 ${d.color} brick`,'reward');
        if (d.color === 'red') {
          p.hpMax = (p.hpMax||10) + 1;
          log(`${p.name} red brick: max HP increased to ${p.hpMax}`,'reward');
        }
      }
      if (eventType === 'trap' || eventType === 'doubletrap') {
        // Handled by trapDodge after Tap Burst mini-game completes
        broadcastState(); return;
      }
      if (eventType === 'trapDodge') {
        // trapCount = total traps on space (1 = single, 2 = double, 3+ = stacked)
        const trapCount = (G.activeEvent && G.activeEvent.trapCount) || 1;
        const rawDmg = trapCount * 3;
        const blocked = Math.min((data&&data.dodged)||0, rawDmg);
        const finalDmg = Math.max(0, rawDmg - blocked);
        p.hp = Math.max(0, p.hp - finalDmg); if(p.hp<=0)p.alive=false;
        const pName = p.playerName||p.name;
        // v4: Perfect dodge reward — clean escape (zero dmg) gives +1 orange brick.
        // Rewards skill, parallels Snapstep disarm. Partial dodges / sprung traps get nothing.
        let cleanEscapeBrick = false;
        if (finalDmg === 0 && rawDmg > 0) {
          p.bricks.orange = (p.bricks.orange||0) + 1;
          cleanEscapeBrick = true;
          log(`${pName} escaped the trap cleanly — +1 orange brick`,'reward');
          clients.forEach((info,cws)=>{ if(info.role===cls&&cws.readyState===1) cws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color:'orange',label:'Clean Escape! +1 Orange Brick',brickColor:'#E8610A'})); });
        }
        log(`TRAP! ${pName} — ${trapCount} trap(s), ${rawDmg} raw, ${blocked} blocked, −${finalDmg} HP → ${p.hp}`,'damage');
        if (!G.orangeSpaces) G.orangeSpaces = {};
        G.orangeSpaces[p.space] = (G.orangeSpaces[p.space]||0) + trapCount;
        G.activeEvent = { ...G.activeEvent, trapResult:{ dmg:finalDmg, rawDmg, dodged:blocked, trapCount, disarmed:false, cleanEscape:cleanEscapeBrick } };
        broadcastState(); return;
      }
      if (eventType === 'disarmTrap') {
        // Snapstep disarms trap — costs 1 gray brick, gains 1 orange brick
        if ((p.bricks.gray||0) < 1) {
          ws.send(JSON.stringify({type:'error',msg:'Need 1 gray brick to disarm'}));
          broadcastState(); return;
        }
        p.bricks.gray--;
        p.bricks.orange = (p.bricks.orange||0)+1;
        log(`${p.playerName||p.name} disarmed the trap! (1 gray → 1 orange brick)`,'action');
        G.activeEvent = { ...G.activeEvent, trapResult:{ dmg:0, disarmed:true } };
        clients.forEach((info,cws)=>{ if(info.role===cls&&cws.readyState===1) cws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color:'orange',label:'Trap Disarmed! +1 Orange Brick',brickColor:'#E8610A'})); });
        broadcastState(); return;
      }
      if (eventType === 'blackCurse') {
        // Player stopped on black brick space
        const pen = rollRange(1,3);
        G.cursedPlayers[cls] = { penalty:pen };
        p.statusEffects = [...(p.statusEffects||[]).filter(s=>s!=='cursed'), 'cursed'];
        log(`${p.name} cursed! −${pen} to next attack roll`,'damage');
      }
      if (eventType === 'blueEventComplete') {
        const { success, bonus } = data||{};
        const isFormwright = cls === 'formwright';
        p.bricks.blue = (p.bricks.blue||0) + 1;
        if (bonus === 'gold') p.gold = (p.gold||0) + 1;
        if (bonus === 'shield' && p.armor < Math.floor(p.hpMax * 0.5)) p.armor++;
        if (bonus === 'roll_bonus') { if (!G.rollBonuses) G.rollBonuses = {}; G.rollBonuses[cls] = (G.rollBonuses[cls]||0) + 1; }
        // v4: FW bonus = "next rumble: 2x brick refresh for 10s" (was +1 extra blue brick)
        if (success && isFormwright) {
          p.nextRumbleBuff = p.nextRumbleBuff || {};
          p.nextRumbleBuff.refreshBoost = { multiplier: 2.0, durationMs: 10000 };
        }
        const pNameB = p.playerName||p.name;
        const label = '+1 Blue Brick!';
        const fwLabel = (success && isFormwright) ? ' · next rumble: ⚡ 2× refresh 10s' : '';
        log(pNameB+' completed blue event — '+label+(bonus?' +'+bonus:'')+(success&&isFormwright?' (Formwright charge!)':''),'reward');
        // Clear persisted blue space
        if (!G.blueSpaces) G.blueSpaces = {};
        if (p.space !== undefined) delete G.blueSpaces[p.space];
        G.activeEvent = { ...G.activeEvent, blueResult:{ success:true, msg: label+(bonus==='gold'?' +1 Gold':bonus==='shield'?' +Shield pip':bonus?' +'+bonus.replace('_',' '):'')+fwLabel, fwRefreshBuff: (success && isFormwright) }, resolved:false }; // DM must click resolve
        broadcastState(); return;
      }
      if (eventType === 'blueEventFail') {
        const { penalty } = data;
        // No brick on fail — consolation reward based on penalty type
        const pNameBF = p.playerName||p.name;
        if (penalty === 'damage') {
          // Sentry stone: gold consolation + damage
          p.gold = (p.gold||0) + 1;
          p.hp = Math.max(0, p.hp - 1); if(p.hp<=0) p.alive=false;
          log(pNameBF+' blue event failed — +1 Gold consolation, −1 HP','reward');
        } else if (penalty === 'shield') {
          // Cipher lock: shield pip consolation
          if (p.armor < Math.floor(p.hpMax * 0.5)) p.armor++;
          log(pNameBF+' blue event failed — +1 Shield pip consolation','reward');
        } else {
          // Singing stone: gold consolation
          p.gold = (p.gold||0) + 1;
          log(pNameBF+' blue event failed — +1 Gold consolation','reward');
        }
        if (penalty === 'roll_penalty') { if (!G.rollPenalties) G.rollPenalties = {}; G.rollPenalties[cls] = (G.rollPenalties[cls]||0) + 1; }
        // Persist blue on this space
        if (!G.blueSpaces) G.blueSpaces = {};
        if (p.space !== undefined) { G.blueSpaces[p.space] = 1; log('Space '+p.space+' retains blue energy','event'); }
        G.activeEvent = { ...G.activeEvent, blueResult:{ success:false, msg: penalty==='damage' ? '+1 Gold consolation · −1 HP (it saw you)' : penalty==='shield' ? '+1 Shield pip consolation' : '+1 Gold consolation' }, resolved:false }; // DM must click resolve
        broadcastState(); return;
      }

      // ── v4 PURPLE FATED CHOICE ──
      if (eventType === 'purpleChoose') {
        // data.choice = 'left' | 'right' | 'pass'
        const choice = (data && data.choice) || 'pass';
        const pName = p.playerName||p.name;
        if (choice === 'pass') {
          // PASS: +1 cheese guaranteed; event lingers
          p.cheese = (p.cheese||0) + 1;
          // Store lingering
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = {
            evType: 'purple',
            variant: 'fated_choice',
            originCls: cls,
            attemptsSoFar: 1,
            createdAt: Date.now(),
          };
          G.activeEvent = { ...G.activeEvent, purpleResult:{ outcome:'pass', lingered:true, msg:'+1 cheese — chests left for next traveler' }, resolved:false };
          log(pName+' passed the Fated Choice — +1 cheese (event lingers)','event');
          broadcastState(); return;
        }
        // Opened a chest — roll 67% blessed / 33% cursed
        const rBless = Math.random();
        if (rBless < 0.67) {
          // BLESSED: +1 purple brick, +2-3 gold
          const goldAmt = rollRange(2,3);
          p.bricks.purple = (p.bricks.purple||0) + 1;
          p.gold = (p.gold||0) + goldAmt;
          // Clear lingering (this space is now done)
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, purpleResult:{ outcome:'blessed', chest:choice, goldGained:goldAmt, msg:'+1 Purple Brick, +'+goldAmt+' Gold' }, resolved:false };
          log(pName+' chose '+choice+' — BLESSED! +1 purple, +'+goldAmt+' gold','reward');
        } else {
          // CURSED: random curse from 5-item pool
          const curseRoll = Math.random();
          let curse, msg;
          if (curseRoll < 0.25) {
            // LOST BRICK — random non-purple brick
            const nonPurpleOwned = Object.entries(p.bricks||{}).filter(([c,n]) => c !== 'purple' && n > 0);
            if (nonPurpleOwned.length > 0) {
              const pick = nonPurpleOwned[Math.floor(Math.random()*nonPurpleOwned.length)];
              removeBrick(p, pick[0], 1);
              curse = 'lost_brick';
              msg = 'Lost 1 '+pick[0]+' brick';
            } else {
              curse = 'lost_brick_empty';
              msg = 'No bricks to lose — curse wasted';
            }
          } else if (curseRoll < 0.50) {
            // WEAKNESS — -25% max HP until zone transition
            const reduction = Math.max(1, Math.floor((p.hpMax||10) * 0.25));
            p.weaknessReduction = (p.weaknessReduction||0) + reduction;
            p.hpMax = Math.max(1, (p.hpMax||10) - reduction);
            p.hp = Math.min(p.hpMax, p.hp);
            curse = 'weakness';
            msg = '−'+reduction+' Max HP until next zone';
          } else if (curseRoll < 0.70) {
            // SLOW TONGUE — no shop this zone
            if (!G.slowTongueZones) G.slowTongueZones = {};
            const currentZone = (SPACES[p.space]||{}).zone || 0;
            if (!G.slowTongueZones[cls]) G.slowTongueZones[cls] = [];
            if (!G.slowTongueZones[cls].includes(currentZone)) G.slowTongueZones[cls].push(currentZone);
            curse = 'slow_tongue';
            msg = 'Cannot buy at stores this zone';
          } else if (curseRoll < 0.85) {
            // THIN POCKETS — -2 gold
            const lost = Math.min(2, p.gold||0);
            p.gold = Math.max(0, (p.gold||0) - 2);
            curse = 'thin_pockets';
            msg = '−'+lost+' Gold';
          } else {
            // HEX MARK — -1 HP + 1 queued poison
            p.hp = Math.max(0, (p.hp||0) - 1);
            if (p.hp <= 0) p.alive = false;
            p.queuedPoisonStacks = (p.queuedPoisonStacks||0) + 1;
            p.queuedPoisonBattles = Math.max(p.queuedPoisonBattles||0, 1);
            curse = 'hex_mark';
            msg = '−1 HP + 1 poison stack next battle';
          }
          // Clear lingering (chest was opened)
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, purpleResult:{ outcome:'cursed', chest:choice, curse, msg, fixerCanCleanse:(cls==='fixer') }, resolved:false };
          log(pName+' chose '+choice+' — CURSED: '+msg,'damage');
        }
        broadcastState(); return;
      }

      // ── v4 PURPLE CLEANSE (Fixer only — spend 1 black or 2 white to negate curse) ──
      if (eventType === 'purpleCleanse') {
        if (cls !== 'fixer') {
          ws.send(JSON.stringify({type:'error',msg:'Only Fixer can cleanse curses'}));
          return;
        }
        if (!G.activeEvent || !G.activeEvent.purpleResult || G.activeEvent.purpleResult.outcome !== 'cursed') {
          ws.send(JSON.stringify({type:'error',msg:'No active curse to cleanse'}));
          return;
        }
        const useBlack = (p.bricks.black||0) >= 1;
        const useWhite = !useBlack && (p.bricks.white||0) >= 2;
        if (!useBlack && !useWhite) {
          ws.send(JSON.stringify({type:'error',msg:'Need 1 black or 2 white bricks to cleanse'}));
          return;
        }
        // Revert the curse effect (tracked per-type)
        const prev = G.activeEvent.purpleResult;
        if (prev.curse === 'weakness' && p.weaknessReduction) {
          p.hpMax = (p.hpMax||10) + p.weaknessReduction;
          p.weaknessReduction = 0;
        }
        if (prev.curse === 'hex_mark') {
          // Undo the HP loss
          p.hp = Math.min(p.hpMax, (p.hp||0) + 1);
          if (p.hp > 0) p.alive = true;
          p.queuedPoisonStacks = Math.max(0, (p.queuedPoisonStacks||0) - 1);
          if (p.queuedPoisonStacks === 0) p.queuedPoisonBattles = 0;
        }
        // SLOW_TONGUE — remove from list
        if (prev.curse === 'slow_tongue' && G.slowTongueZones && G.slowTongueZones[cls]) {
          const zoneNow = (SPACES[p.space]||{}).zone || 0;
          G.slowTongueZones[cls] = G.slowTongueZones[cls].filter(z => z !== zoneNow);
        }
        // Deduct bricks
        if (useBlack) {
          p.bricks.black -= 1;
          // And grant the blessed reward since Fixer paid black
          const goldAmt = rollRange(2,3);
          p.bricks.purple = (p.bricks.purple||0) + 1;
          p.gold = (p.gold||0) + goldAmt;
          G.activeEvent = { ...G.activeEvent, purpleResult:{ outcome:'cleansed_blessed', curse:prev.curse, goldGained:goldAmt, msg:'Fixer cleansed the curse — +1 purple, +'+goldAmt+' gold' }, resolved:false };
          log((p.playerName||p.name)+' cleansed the '+prev.curse+' curse with 1 black — blessed reward applied','action');
        } else {
          p.bricks.white -= 2;
          G.activeEvent = { ...G.activeEvent, purpleResult:{ outcome:'cleansed_negated', curse:prev.curse, msg:'Fixer cleansed the curse (2 white) — no blessing' }, resolved:false };
          log((p.playerName||p.name)+' cleansed the '+prev.curse+' curse with 2 white','action');
        }
        broadcastState(); return;
      }

      // ── v4 WHITE PILGRIM'S REST ──
      if (eventType === 'whitePilgrimChoose') {
        const choice = (data && data.choice) || 'self';
        const pName = p.playerName||p.name;
        if (choice === 'heal_ally') {
          const targetCls = data.healTarget;
          const tgt = G.players[targetCls];
          if (!tgt) { ws.send(JSON.stringify({type:'error',msg:'Invalid heal target'})); return; }
          if ((p.bricks.white||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 white brick'})); return; }
          p.bricks.white -= 1;
          const isFixer = (cls === 'fixer');
          const healAmt = isFixer ? 4 : 3;
          tgt.hp = Math.min(tgt.hpMax, (tgt.hp||0) + healAmt);
          const whiteBack = isFixer ? 3 : 2;
          p.bricks.white = (p.bricks.white||0) + whiteBack;
          p.gold = (p.gold||0) + 1;
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, whiteResult:{ outcome:'heal_ally', target:targetCls, healAmt, whiteBack, msg:'Healed '+(tgt.playerName||tgt.name)+' +'+healAmt+' HP · +'+whiteBack+' white, +1 gold' }, resolved:false };
          log(pName+' healed '+(tgt.playerName||tgt.name)+' +'+healAmt+' HP (Pilgrim\'s Rest)','heal');
        } else if (choice === 'heal_self') {
          const wasFull = (p.hp||0) >= (p.hpMax||10);
          if (wasFull) {
            p.hpMax = (p.hpMax||10) + 1;
            p.hp = p.hpMax;
            p.bricks.white = (p.bricks.white||0) + 1;
            if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
            G.activeEvent = { ...G.activeEvent, whiteResult:{ outcome:'self_maxhp', msg:'Already full — +1 Max HP, +1 white' }, resolved:false };
            log(pName+' rests at the shrine — +1 Max HP (full HP), +1 white','reward');
          } else {
            p.hp = Math.min(p.hpMax, (p.hp||0) + 1);
            p.bricks.white = (p.bricks.white||0) + 1;
            if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
            G.activeEvent = { ...G.activeEvent, whiteResult:{ outcome:'self_heal', msg:'+1 HP, +1 white' }, resolved:false };
            log(pName+' rests — +1 HP, +1 white','heal');
          }
        } else if (choice === 'self_rest') {
          // Fallback: roll for reward; event lingers
          const r = roll(6);
          const strong = r >= 3;
          const whiteGot = strong ? 2 : 1;
          const hpGot = strong ? 1 : 0;
          p.bricks.white = (p.bricks.white||0) + whiteGot;
          if (hpGot) p.hp = Math.min(p.hpMax, (p.hp||0) + hpGot);
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = {
            evType:'white', variant:'pilgrims_rest', originCls:cls,
            attemptsSoFar:1, createdAt:Date.now(),
          };
          G.activeEvent = { ...G.activeEvent, whiteResult:{ outcome:'self_rest', roll:r, whiteGot, hpGot, lingered:true, msg:'Rolled '+r+' — +'+whiteGot+' white'+(hpGot?', +1 HP':'') }, resolved:false };
          log(pName+' self-rest roll '+r+' — +'+whiteGot+' white (event lingers)','event');
        } else if (choice === 'revive') {
          if (cls !== 'fixer') { ws.send(JSON.stringify({type:'error',msg:'Only Fixer can revive'})); return; }
          const targetCls = data.healTarget;
          const tgt = G.players[targetCls];
          if (!tgt || tgt.alive || (tgt.hp||0) > 0) { ws.send(JSON.stringify({type:'error',msg:'Target not downed'})); return; }
          if ((p.bricks.white||0) < 1 || (p.bricks.purple||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 white + 1 purple'})); return; }
          p.bricks.white -= 1;
          p.bricks.purple -= 1;
          tgt.hp = Math.max(1, Math.floor((tgt.hpMax||10) * 0.5));
          tgt.alive = true;
          p.bricks.white = (p.bricks.white||0) + 3;
          p.gold = (p.gold||0) + 2;
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, whiteResult:{ outcome:'revive', target:targetCls, reviveHp:tgt.hp, msg:'Revived '+(tgt.playerName||tgt.name)+' to '+tgt.hp+' HP · +3 white, +2 gold' }, resolved:false };
          log(pName+' (Fixer) revived '+(tgt.playerName||tgt.name)+' to '+tgt.hp+' HP','heal');
        }
        broadcastState(); return;
      }

      // ── v4 BLACK SHADOW BARGAIN ──
      if (eventType === 'blackBargainChoose') {
        const choice = (data && data.choice) || 'refuse';
        const pName = p.playerName||p.name;
        // Server rolls the trade type once when event starts; stored on G.activeEvent.blackOffer.
        // For first landing, if blackOffer is missing, roll now.
        if (!G.activeEvent.blackOffer) {
          const rT = Math.random();
          let offer;
          if (rT < 0.55) offer = 'blood_price';
          else if (rT < 0.80) offer = 'brick_exchange';
          else if (rT < 0.95) offer = 'poisoned_favor';
          else offer = 'binding_pact';
          G.activeEvent.blackOffer = offer;
        }
        const offer = G.activeEvent.blackOffer;

        if (choice === 'refuse') {
          // 97% cheese, 3% black
          const rG = Math.random();
          let msg;
          if (rG < 0.97) {
            p.cheese = (p.cheese||0) + 1;
            msg = 'Shadow hands you 1 cheese';
          } else {
            p.bricks.black = (p.bricks.black||0) + 1;
            msg = 'Shadow respects your refusal — +1 black brick';
          }
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = {
            evType:'black', variant:'shadow_bargain', originCls:cls,
            attemptsSoFar:1, createdAt:Date.now(),
          };
          G.activeEvent = { ...G.activeEvent, blackResult:{ outcome:'refused', offer, msg, lingered:true }, resolved:false };
          log(pName+' refused the shadow bargain — '+msg,'event');
          broadcastState(); return;
        }

        // ACCEPT path — apply offer effects
        if (offer === 'blood_price') {
          // Roll 1d10 distribution: 1-4→2, 5-7→3, 8-9→4, 10→5
          const r = roll(10);
          let amt = 2;
          if (r <= 4) amt = 2;
          else if (r <= 7) amt = 3;
          else if (r <= 9) amt = 4;
          else amt = 5;
          // Floor at 1 (per Q4)
          const newMax = Math.max(1, (p.hpMax||10) - amt);
          const actual = (p.hpMax||10) - newMax;
          p.hpMax = newMax;
          p.hp = Math.min(p.hpMax, p.hp);
          addBrick(p, 'black', 2);
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, blackResult:{ outcome:'blood_price', amt:actual, roll:r, msg:'−'+actual+' Max HP (permanent) · +2 black' }, resolved:false };
          log(pName+' paid BLOOD PRICE: −'+actual+' Max HP (permanent), +2 black','damage');
        } else if (offer === 'brick_exchange') {
          const color = (data && data.exchangeColor);
          if (!color || color === 'black') { ws.send(JSON.stringify({type:'error',msg:'Pick a non-black brick to trade'})); return; }
          if ((p.bricks[color]||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Not enough '+color+' bricks'})); return; }
          removeBrick(p, color, 1);
          addBrick(p, 'black', 1);
          p.gold = (p.gold||0) + 3;
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, blackResult:{ outcome:'brick_exchange', color, msg:'−1 '+color+' · +1 black, +3 gold' }, resolved:false };
          log(pName+' traded 1 '+color+' for 1 black + 3 gold','reward');
        } else if (offer === 'poisoned_favor') {
          addBrick(p, 'black', 1);
          p.queuedPoisonStacks = (p.queuedPoisonStacks||0) + 1;
          p.queuedPoisonBattles = Math.max(p.queuedPoisonBattles||0, 3);
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, blackResult:{ outcome:'poisoned_favor', msg:'+1 black · poisoned next 3 battles' }, resolved:false };
          log(pName+' accepted POISONED FAVOR: +1 black, poisoned 3 battles','damage');
        } else if (offer === 'binding_pact') {
          addBrick(p, 'black', 2);
          const losses = [];
          Object.keys(G.players||{}).forEach(allyCls => {
            if (allyCls === cls) return;
            const ally = G.players[allyCls];
            if (!ally || !ally.alive) return;
            const nonBlack = Object.entries(ally.bricks||{}).filter(([c,n]) => c !== 'black' && n > 0);
            if (nonBlack.length === 0) return;
            const pick = nonBlack[Math.floor(Math.random()*nonBlack.length)];
            removeBrick(ally, pick[0], 1);
            losses.push((ally.playerName||ally.name)+' (−1 '+pick[0]+')');
          });
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, blackResult:{ outcome:'binding_pact', losses, msg:'+2 black · allies lost: '+(losses.join(', ')||'none') }, resolved:false };
          log(pName+' sealed BINDING PACT: +2 black; allies paid: '+(losses.join(', ')||'none'),'damage');
        }
        broadcastState(); return;
      }

      // ── v4 GREEN VINE PATH ──
      if (eventType === 'greenVineResolve') {
        // data.cutCount: 0-3 (number of vines successfully cut)
        const cutCount = Math.max(0, Math.min(3, parseInt((data && data.cutCount) || 0)));
        const pName = p.playerName||p.name;
        const isWildOne = (cls === 'wild_one');
        const wildBonus = (isWildOne && cutCount > 0) ? 1 : 0;
        if (cutCount >= 3) {
          const goldAmt = rollRange(2,3);
          p.bricks.green = (p.bricks.green||0) + 1 + wildBonus;
          p.gold = (p.gold||0) + goldAmt;
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          G.activeEvent = { ...G.activeEvent, greenResult:{ outcome:'all_cut', cutCount, greenGained: 1+wildBonus, goldGained:goldAmt, msg:'+'+(1+wildBonus)+' green, +'+goldAmt+' gold' }, resolved:false };
          log(pName+' cut all 3 vines — +'+(1+wildBonus)+' green, +'+goldAmt+' gold','reward');
        } else if (cutCount === 2) {
          const goldAmt = rollRange(1,2);
          p.gold = (p.gold||0) + goldAmt;
          if (wildBonus) p.bricks.green = (p.bricks.green||0) + 1;
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'green', variant:'vine_path', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          G.activeEvent = { ...G.activeEvent, greenResult:{ outcome:'partial_2', cutCount, goldGained:goldAmt, greenGained:wildBonus, lingered:true, msg:'+'+goldAmt+' gold'+(wildBonus?', +1 green':'')+' — vines remain' }, resolved:false };
          log(pName+' cut 2 vines — +'+goldAmt+' gold (event lingers)','event');
        } else if (cutCount === 1) {
          p.hp = Math.max(0, (p.hp||0) - 1);
          if (p.hp <= 0) p.alive = false;
          if (wildBonus) p.bricks.green = (p.bricks.green||0) + 1;
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'green', variant:'vine_path', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          G.activeEvent = { ...G.activeEvent, greenResult:{ outcome:'partial_1', cutCount, greenGained:wildBonus, lingered:true, msg:'−1 HP'+(wildBonus?', +1 green':'')+' — vines remain' }, resolved:false };
          log(pName+' cut 1 vine — −1 HP (event lingers)','damage');
        } else {
          // 0 cut — −1 HP + poison stack queued for next rumble
          p.hp = Math.max(0, (p.hp||0) - 1);
          if (p.hp <= 0) p.alive = false;
          p.queuedPoisonStacks = (p.queuedPoisonStacks||0) + 1;
          p.queuedPoisonBattles = Math.max(p.queuedPoisonBattles||0, 1);
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'green', variant:'vine_path', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          G.activeEvent = { ...G.activeEvent, greenResult:{ outcome:'total_fail', cutCount:0, lingered:true, msg:'−1 HP + 1 poison next battle — vines remain' }, resolved:false };
          log(pName+' — thorns bit deep. −1 HP + 1 poison queued (event lingers)','damage');
        }
        broadcastState(); return;
      }

      // ── v4 RED TRIAL OF THE HAND — phase-based party race ──
      // Phases: joining → active → picking → done
      // Handlers: redTrialJoin, redTrialBegin, redTrialPickWinner, redTrialCancel, redTrialDigitalSubmit

      if (eventType === 'redTrialJoin') {
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { broadcastState(); return; }
        if (G.activeEvent.redPhase !== 'joining') {
          ws.send(JSON.stringify({type:'error',msg:'Join window closed'})); return;
        }
        const joinCls = P.cls || cls;
        const joiner = G.players[joinCls];
        if (!joiner || !joiner.alive) {
          ws.send(JSON.stringify({type:'error',msg:'Only living players can join'})); return;
        }
        if (!G.activeEvent.redJoined) G.activeEvent.redJoined = [];
        if (!G.activeEvent.redJoined.includes(joinCls)) {
          G.activeEvent.redJoined.push(joinCls);
          log((joiner.playerName||joiner.name)+' joined the Trial','event');
        } else {
        }
        broadcastState(); return;
      }

      if (eventType === 'redTrialBegin') {
        // DM triggers — moves to active phase, starts 30s challenge timer
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { broadcastState(); return; }
        if (G.activeEvent.redPhase !== 'joining') {
          ws.send(JSON.stringify({type:'error',msg:'Trial not in joining phase'})); return;
        }
        const joined = G.activeEvent.redJoined || [];
        if (joined.length === 0) {
          ws.send(JSON.stringify({type:'error',msg:'No players joined'})); return;
        }
        G.activeEvent.redPhase = 'active';
        G.activeEvent.redStartedAt = Date.now();
        G.activeEvent.redEndsAt = Date.now() + 30000;
        log('Trial begins! '+joined.length+' challenger'+(joined.length!==1?'s':''),'event');
        // Auto-advance to picking phase when time expires
        const startedEventId = G.activeEvent.redStartedAt;
        setTimeout(function() {
          if (!G.activeEvent || G.activeEvent.redStartedAt !== startedEventId) return;
          if (G.activeEvent.redPhase !== 'active') return;
          G.activeEvent.redPhase = 'picking';
          log('Trial timer expired — DM, pick the winner','event');
          broadcastState();
        }, 30000);
        broadcastState(); return;
      }

      if (eventType === 'redTrialDigitalSubmit') {
        // For digital challenges: players submit their score/finish time
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { broadcastState(); return; }
        if (G.activeEvent.redPhase !== 'active') {
          ws.send(JSON.stringify({type:'error',msg:'Trial not active'})); return;
        }
        const submitCls = P.cls || cls;
        if (!G.activeEvent.redJoined.includes(submitCls)) {
          ws.send(JSON.stringify({type:'error',msg:'Only joined players can submit'})); return;
        }
        if (!G.activeEvent.redDigitalScores) G.activeEvent.redDigitalScores = {};
        const existing = G.activeEvent.redDigitalScores[submitCls];
        if (existing && existing.finishedAt) return; // already submitted
        G.activeEvent.redDigitalScores[submitCls] = {
          taps: (data && data.taps) || 0,
          reactionMs: (data && data.reactionMs) || null,
          finishedAt: Date.now() - G.activeEvent.redStartedAt,
        };
        const submitP = G.players[submitCls];
        log((submitP?submitP.playerName||submitP.name:submitCls)+' submitted Trial score','event');
        broadcastState(); return;
      }

      if (eventType === 'redTrialPickWinner') {
        // DM picks winner (from joined players). winnerCls null = no winner, event lingers.
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { broadcastState(); return; }
        if (G.activeEvent.redPhase !== 'active' && G.activeEvent.redPhase !== 'picking') {
          ws.send(JSON.stringify({type:'error',msg:'Trial not in pickable phase'})); return;
        }
        const winnerCls = (data && data.winnerCls) || null;
        const joined = G.activeEvent.redJoined || [];
        const landSpace = p ? p.space : -1;

        // Distribute rewards
        const results = {};
        if (winnerCls && joined.includes(winnerCls)) {
          const winner = G.players[winnerCls];
          if (winner) {
            winner.bricks.red = (winner.bricks.red||0) + 1;
            winner.cheese = (winner.cheese||0) + 1;
            const breakerBonus = (winnerCls === 'breaker') ? 1 : 0;
            if (breakerBonus) winner.cheese = (winner.cheese||0) + breakerBonus;
            results[winnerCls] = { won:true, red:1, cheese:1+breakerBonus, breakerBonus:!!breakerBonus };
            log((winner.playerName||winner.name)+' won the Trial! +1 red, +'+(1+breakerBonus)+' cheese'+(breakerBonus?' (Breaker bonus)':''),'reward');
          }
          // Clear any lingering on this space — event was won
          if (G.lingeringEvents && G.lingeringEvents[landSpace]) delete G.lingeringEvents[landSpace];
          G.activeEvent.redPhase = 'done';
        } else {
          // No winner — event lingers, red brick stays
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[landSpace] = { evType:'red', variant:'trial_of_hand', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          log('No winner named — red brick remains. Event lingers.','event');
          G.activeEvent.redPhase = 'done';
        }

        // Participation rolls for joined losers (not winner)
        joined.forEach(function(jcls) {
          if (jcls === winnerCls) return;
          const jp = G.players[jcls];
          if (!jp) return;
          const roll30 = Math.random();
          if (roll30 < 0.3) {
            // 30% → 1 cheese
            jp.cheese = (jp.cheese||0) + 1;
            results[jcls] = { won:false, cheese:1 };
            log((jp.playerName||jp.name)+' received 1 cheese (participation)','reward');
          } else {
            // 70% → 1-2 gold
            const gold = 1 + Math.floor(Math.random()*2);
            jp.gold = (jp.gold||0) + gold;
            results[jcls] = { won:false, gold };
            log((jp.playerName||jp.name)+' received '+gold+' gold (participation)','reward');
          }
        });

        G.activeEvent.redResult = { winnerCls, participants: joined, lingered: !winnerCls, results };
        G.activeEvent.resolved = false;  // DM still presses Mark Resolved to advance turn
        broadcastState(); return;
      }

      if (eventType === 'redTrialCancel') {
        // DM cancel during joining phase — event lingers
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { broadcastState(); return; }
        const landSpace = p ? p.space : -1;
        if (!G.lingeringEvents) G.lingeringEvents = {};
        G.lingeringEvents[landSpace] = { evType:'red', variant:'trial_of_hand', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
        G.activeEvent.redPhase = 'done';
        G.activeEvent.redResult = { winnerCls:null, participants:G.activeEvent.redJoined||[], lingered:true, cancelled:true, results:{} };
        G.activeEvent.resolved = false;
        log('DM cancelled the Trial — event lingers','event');
        broadcastState(); return;
      }


      // ── v4 GRAY RUBBLE STACKING ──
      if (eventType === 'grayRubbleResolve') {
        // data.matchPct: 0-100, data.overhang: cells over outline
        const matchPct = Math.max(0, Math.min(100, parseInt((data && data.matchPct) || 0)));
        const overhang = Math.max(0, parseInt((data && data.overhang) || 0));
        const pName = p.playerName||p.name;
        const isBlocksmith = (cls === 'blocksmith');
        const blocksmithBonus = isBlocksmith ? 1 : 0;
        let tier, msg;
        if (matchPct >= 90 && overhang === 0) {
          tier = 'perfect';
          p.bricks.gray = (p.bricks.gray||0) + 1 + blocksmithBonus;
          p.cheese = (p.cheese||0) + 2;
          if (G.lingeringEvents && G.lingeringEvents[p.space]) delete G.lingeringEvents[p.space];
          msg = '+' + (1+blocksmithBonus) + ' gray, +2 cheese';
          log(pName+' stacked the rubble perfectly — '+msg,'reward');
        } else if (matchPct >= 70) {
          tier = 'good';
          p.cheese = (p.cheese||0) + 2;
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'gray', variant:'rubble_stacking', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          msg = '+2 cheese — the wall still has gaps';
          log(pName+' stacked rubble (good) — +2 cheese (event lingers)','event');
        } else if (matchPct >= 40) {
          tier = 'miss';
          p.cheese = (p.cheese||0) + 1;
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'gray', variant:'rubble_stacking', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          msg = '+1 cheese — rubble shifts (event lingers)';
          log(pName+' stacked rubble (miss) — +1 cheese','event');
        } else {
          tier = 'fail';
          p.cheese = (p.cheese||0) + 1;
          if (!G.lingeringEvents) G.lingeringEvents = {};
          G.lingeringEvents[p.space] = { evType:'gray', variant:'rubble_stacking', originCls:cls, attemptsSoFar:1, createdAt:Date.now() };
          msg = '+1 cheese — stones settle their own way';
          log(pName+' fumbled the rubble — +1 cheese','event');
        }
        G.activeEvent = { ...G.activeEvent, grayRubbleResult:{ tier, matchPct, overhang, lingered: tier!=='perfect', msg }, resolved:false };
        broadcastState(); return;
      }

      if (eventType === 'riddle') {
        const solverCls = data.solverCls;
        if (solverCls && G.players[solverCls]) {
          G.players[solverCls].bricks.yellow = (G.players[solverCls].bricks.yellow||0)+1;
          log((G.players[solverCls].playerName||G.players[solverCls].name)+' solved the riddle — +1 yellow brick','reward');
          // Notify ALL players of yellow brick reward for solver
          clients.forEach((info,cws)=>{ if(cws.readyState===1) cws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color:'yellow',label:(G.players[solverCls].playerName||G.players[solverCls].name)+' solved the riddle! +1 Yellow Brick!',brickColor:'#F5D000'})); });
        }
        if (data.clue) {
          if (!G.discoveredClues) G.discoveredClues = [];
          const clueEntry = { clue:data.clue, solverCls:solverCls||null, riddleQ:data.riddleQ||'', category:data.category||'', zone:data.zone };
          // Track riddle index as used for this zone
          if (data.riddleIdx !== undefined) {
            if (!G.usedRiddleIdxs) G.usedRiddleIdxs = [];
            G.usedRiddleIdxs.push(data.riddleIdx);
          }
          G.discoveredClues.push(clueEntry);
          // Broadcast clue to ALL players
          const clueMsg = JSON.stringify({ type:'clueDiscovered', clueEntry });
          clients.forEach((info,cws)=>{ if(cws.readyState===1) cws.send(clueMsg); });
          if (solverCls && G.players[solverCls]) {
            if (!G.players[solverCls].earnedClues) G.players[solverCls].earnedClues = [];
            G.players[solverCls].earnedClues.push(clueEntry);
          }
          // Store on activeEvent so both screens display it prominently before resolve
          G.activeEvent = { ...G.activeEvent, pendingClue:clueEntry, resolved:false };
          log('Clue revealed: "'+data.clue+'"','event');
        }
      }
      // Mark event resolved — DM clicks Mark Resolved to advance turn
      if (G.activeEvent) G.activeEvent = { ...G.activeEvent, resolved: true };
      broadcastState(); return;
    }

    // ── DM MARK RESOLVED — advances turn ──
    // ── DM RESET EVENT — re-initialize current event's mini-game state ──
    // Works for v4 events + gold + blue + riddle. NOT for monster/boss (rumble has its own reset).
    // Clears any in-progress results/phases and rolls fresh content for the SAME event type.
    if (type === 'dm_resetEvent') {
      if (!G.activeEvent) { broadcastState(); return; }
      const ev = G.activeEvent;
      if (ev.evType === 'monster' || ev.evType === 'boss') {
        // Reset behavior on monster/boss events depends on state:
        //   - During an active rumble: blocked (use the rumble-internal force-reset)
        //   - After rumble ended (rumbleResult set): re-pend a fresh rumble with
        //     the same enemy; restore player to pre-rumble snapshot so it's a
        //     clean retry.
        if (G.rumbleBattle) {
          log('Reset ignored — rumble is active; use the rumble-internal reset','event');
          broadcastState(); return;
        }
        // Restore player from preRumbleSnap if available
        const mcls = ev.cls;
        const mp = G.players[mcls];
        if (mp && ev.preRumbleSnap) {
          mp.hp      = ev.preRumbleSnap.hp;
          mp.hpMax   = ev.preRumbleSnap.hpMax;
          mp.armor   = ev.preRumbleSnap.armor || 0;
          mp.gold    = ev.preRumbleSnap.gold || 0;
          mp.bricks  = { ...ev.preRumbleSnap.bricks };
          refreshCharges(mp);
          mp.alive   = true;
        }
        // Re-pend the rumble using the event's mids array (same source as
        // both forced and natural monster event creation).
        const mMids = ev.mids || ['goblin'];
        const mEntity = ENTITY_META[mMids[0]] ? mMids[0] : 'goblin';
        const mTpl = ENTITY_META[mEntity];
        const mFlavorPool = RUMBLE_FLAVOR[mEntity] || [mTpl.name + ' appears!'];
        const mFlavor = mFlavorPool[Math.floor(Math.random() * mFlavorPool.length)];
        G.pendingRumbleBattle = {
          cls: mcls,
          entityType: mEntity,
          enemy: { type: mEntity, name: mTpl.name, hp: mTpl.hpMax, hpMax: mTpl.hpMax, encounterColor: rollEncounterColor(mEntity) },
          flavor: mFlavor,
          createdAt: Date.now(),
        };
        delete ev.rumbleResult;
        ev.resolved = false;
        log('DM reset the rumble — player restored, ' + mTpl.name + ' re-pending','event');
        broadcastState(); return;
      }
      const evCls = ev.cls;
      // Clear every result/phase/in-progress field so variant-specific init gives us a clean start
      ['redResult','purpleResult','whiteResult','blackResult','greenResult','grayRubbleResult',
       'blueResult','trapResult','goldResult','riddleWinner','riddleExpired','riddleActive',
       'redJoined','redJoinEndsAt','redStartedAt','redEndsAt','redPhase','redDigitalScores','redChallenge',
       'blueVariant','purpleChoice','whiteChoice','blackOffer','greenCut','grayBlocks','grayOutline','grayScore','grayPlaced']
        .forEach(function(k) { delete ev[k]; });
      ev.resolved = false;

      // Re-init per variant
      if (ev.redVariant === 'trial_of_hand') {
        ev.redChallenge = RED_CHALLENGES[Math.floor(Math.random()*RED_CHALLENGES.length)];
        ev.redPhase = 'joining';
        ev.redJoined = [evCls];
        ev.redJoinEndsAt = Date.now() + 30000;
        ev.redStartedAt = null;
        ev.redDigitalScores = {};
      }
      if (ev.grayVariant === 'rubble_stacking') {
        initGrayRubble(ev);
      }
      if (ev.blackVariant === 'shadow_bargain') {
        const rT = Math.random();
        ev.blackOffer = rT<0.55?'blood_price' : rT<0.80?'brick_exchange' : rT<0.95?'poisoned_favor' : 'binding_pact';
      }
      // purple, white, green carry no generated content — clearing results above is enough
      log('DM reset the event — fresh attempt','event');
      broadcastState(); return;
    }

    // ── DM RE-ROLL EVENT — land on a DIFFERENT event on this space ──
    // Rolls a new event from the zone's landing table, replacing the current event.
    if (type === 'dm_rerollEvent') {
      if (!G.activeEvent) { broadcastState(); return; }
      const ev = G.activeEvent;
      if (ev.evType === 'monster' || ev.evType === 'boss') {
        log('Re-roll ignored — rumble has its own reset','event');
        broadcastState(); return;
      }
      const evCls = ev.cls;
      const p = G.players[evCls];
      if (!p) { broadcastState(); return; }
      const zone = (ev.zone !== undefined) ? ev.zone : (SPACES[p.space]?.zone || 0);
      const pName = p.playerName||p.name||evCls;

      // Roll a new event on a new server-side roll
      const newRoll = roll(7);
      const landingTable = LANDING_EVENTS[zone+1];
      if (!landingTable) { broadcastState(); return; }
      const newEvData = landingTable[newRoll-1];
      if (!newEvData) { broadcastState(); return; }

      // Build a fresh eventMeta (same shape as natural landingRoll init)
      let newMeta = { cls:evCls, roll:newRoll, zone, resolved:false, evType:newEvData.type };
      if (newEvData.type === 'gold') { newMeta.goldAmount = newEvData.amount||1; }
      if (newEvData.type === 'blue') { newMeta.brickColor = 'blue'; }
      if (newEvData.type === 'trap' || newEvData.type === 'doubletrap') {
        const existingTraps = (G.orangeSpaces && G.orangeSpaces[p.space]) || 0;
        const newTraps = newEvData.type === 'doubletrap' ? 2 : 1;
        newMeta.trapCount = existingTraps + newTraps;
      }
      // Variant init for v4 events
      if (newEvData.type === 'purple') { newMeta.purpleVariant = 'fated_choice'; newMeta.isFixer = (evCls === 'fixer'); }
      if (newEvData.type === 'white')  { newMeta.whiteVariant = 'pilgrims_rest'; newMeta.isFixer = (evCls === 'fixer'); }
      if (newEvData.type === 'black')  {
        newMeta.blackVariant = 'shadow_bargain';
        newMeta.isFormwright = (evCls === 'formwright');
        newMeta.isFixer = (evCls === 'fixer');
        const rT = Math.random();
        newMeta.blackOffer = rT<0.55?'blood_price' : rT<0.80?'brick_exchange' : rT<0.95?'poisoned_favor' : 'binding_pact';
      }
      if (newEvData.type === 'green')  { newMeta.greenVariant = 'vine_path'; newMeta.isWildOne = (evCls === 'wild_one'); newMeta.evType = 'green'; }
      if (newEvData.type === 'red') {
        newMeta.redVariant = 'trial_of_hand';
        newMeta.isBreaker = (evCls === 'breaker');
        newMeta.redChallenge = RED_CHALLENGES[Math.floor(Math.random()*RED_CHALLENGES.length)];
        newMeta.redPhase = 'joining';
        newMeta.redJoined = [evCls];
        newMeta.redJoinEndsAt = Date.now() + 30000;
        newMeta.redStartedAt = null;
        newMeta.redDigitalScores = {};
        newMeta.evType = 'red';
      }
      if (newEvData.type === 'gray') {
        newMeta.grayVariant = 'rubble_stacking';
        newMeta.isBlocksmith = (evCls === 'blocksmith');
        initGrayRubble(newMeta);
        newMeta.evType = 'gray';
      }
      if (newEvData.type === 'monster') {
        // Monster re-roll: set up pending rumble
        const evMids = newEvData.mids || ['goblin'];
        const entityType = ENTITY_META[evMids[0]] ? evMids[0] : 'goblin';
        const entityTpl = ENTITY_META[entityType];
        const flavorPool = RUMBLE_FLAVOR[entityType] || [entityTpl.name + ' appears!'];
        const flavor = flavorPool[Math.floor(Math.random()*flavorPool.length)];
        G.pendingRumbleBattle = {
          cls: evCls,
          entityType,
          enemy: { type: entityType, name: entityTpl.name, hp: entityTpl.hp, hpMax: entityTpl.hp, damageType: entityTpl.dmgType || 'phys', encounterColor: rollEncounterColor(entityType) },
          flavor,
        };
      }
      G.activeEvent = newMeta;
      log('DM re-rolled '+pName+' — zone '+(zone+1)+' roll '+newRoll+' → '+newEvData.type,'event');
      broadcastState(); return;
    }

    if (type === 'dm_resolved') {
      if (!G.activeEvent) { broadcastState(); return; }
      G.activeEvent = null;
      G.activePlayerIdx = (G.activePlayerIdx + 1) % G.turnOrder.length;
      if (G.activePlayerIdx === 0) {
        G.round++;
        if (G.fortressBricks > 0) { G.fortressBricks--; log('Fortress: '+G.fortressBricks+' bricks remain','scenario'); }
        G.turnOrder.forEach(function(c) {
          var pp = G.players[c];
          if (pp && pp.alive && pp.statusEffects && pp.statusEffects.includes('poisoned')) {
            pp.hp = Math.max(0, pp.hp-1);
            if (pp.hp<=0) pp.alive=false;
            log(pp.name+' poison -1 HP','damage');
          }
        });
      }
      G.phase = 'prepare';
      log('DM resolved — ' + (G.players[G.turnOrder[G.activePlayerIdx]]?.name||'?') + ' turn begins','normal');
      broadcastState(); return;
    }


    // ── TRAP DISARM ──
    if (type === 'disarmTrap') {
      const { cls, spaceIdx } = P;
      const p = G.players[cls];
      if (!G.orangeSpaces) G.orangeSpaces = {};

      if (cls === 'blocksmith') {
        // Costs 1 gray brick
        if ((p.bricks.gray||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 gray brick to disarm'})); broadcastState(); return; }
        p.bricks.gray--;
        G.orangeSpaces[spaceIdx] = Math.max(0, (G.orangeSpaces[spaceIdx]||1)-1);
        if (G.orangeSpaces[spaceIdx]<=0) delete G.orangeSpaces[spaceIdx];
        log(`Blocksmith disarmed trap at space ${spaceIdx+1} (1 gray spent)`,'action');
      } else if (cls === 'snapstep') {
        // Spend yellow brick, disarm 1, then roll for more
        if ((p.bricks.yellow||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 yellow brick'})); broadcastState(); return; }
        p.bricks.yellow--;
        G.orangeSpaces[spaceIdx] = Math.max(0,(G.orangeSpaces[spaceIdx]||1)-1);
        if (G.orangeSpaces[spaceIdx]<=0) delete G.orangeSpaces[spaceIdx];
        log(`Snapstep disarmed trap at space ${spaceIdx+1}`,'action');
        // Check if more in zone — server sends back result, DM decides chain
        const r = roll(6);
        ws.send(JSON.stringify({ type:'snapstepDisarmChain', roll:r, continueDisarm: r%2!==0 }));
      } else {
        // Roll d6 4+ success, fail triggers trap
        const r = roll(6);
        if (r >= 4) {
          G.orangeSpaces[spaceIdx] = Math.max(0,(G.orangeSpaces[spaceIdx]||1)-1);
          if (G.orangeSpaces[spaceIdx]<=0) delete G.orangeSpaces[spaceIdx];
          log(`${p.name} disarmed trap (rolled ${r})`,'action');
        } else {
          const dmg = rollRange(1,3);
          p.hp = Math.max(0,p.hp-dmg); if(p.hp<=0)p.alive=false;
          log(`${p.name} failed disarm (${r}) — trap fires! −${dmg} HP`,'damage');
        }
      }
    }

    // ── TRAP TRIGGER ON LANDING ──
    if (type === 'triggerTrap') {
      const { cls, spaceIdx } = P;
      const p = G.players[cls];
      if (!G.orangeSpaces) G.orangeSpaces = {};
      const count = G.orangeSpaces[spaceIdx] || 0;
      let totalDmg = 0;
      for (let i=0; i<count; i++) { totalDmg += rollRange(1,3); }
      p.hp = Math.max(0, p.hp-totalDmg); if(p.hp<=0)p.alive=false;
      log(`${p.name} triggered ${count} trap(s) at space ${spaceIdx+1} — ${totalDmg} damage`,'damage');
    }

    // ── PLAYERS ──
    if (type === 'adjustHP') {
      const p = G.players[P.cls];
      p.hp = Math.max(0, Math.min(p.hpMax+3, p.hp+P.amount));
      if (p.hp<=0) p.alive=false; else p.alive=true;
      if (P.amount<0) log(`${p.name} ${P.amount} HP → ${p.hp}`,'damage');
      else log(`${p.name} +${P.amount} HP → ${p.hp}`,'heal');
    }
    if (type === 'adjustBrick') {
      const p = G.players[P.cls];
      if (P.amount > 0) addBrick(p, P.color, P.amount);
      else if (P.amount < 0) removeBrick(p, P.color, -P.amount);
    }
    if (type === 'adjustGold') {
      G.players[P.cls].gold = Math.max(0, G.players[P.cls].gold+P.amount);
    }

    // ── S013 §8.2 — BOARD ACTIONS CONSUMING bricksCharged ──
    // Heal self: spend 1 white charge → +N HP (per-class, capped at hpMax).
    // Per §1.1 charge model, spend dims the white pip; refresh at rumble
    // entry or zone-gate crossing relights it.
    const SELF_HEAL_AMT = { breaker: 2, formwright: 2, snapstep: 2, blocksmith: 2, fixer: 4, wild_one: 2 };
    if (type === 'healPlayer') {
      const p = G.players[P.cls];
      if (!p || !p.alive) { broadcastState(); return; }
      if (((p.bricksCharged && p.bricksCharged.white) || 0) <= 0) {
        ws.send(JSON.stringify({type:'error',msg:'No white charge available'}));
        broadcastState(); return;
      }
      if (p.hp >= p.hpMax) {
        ws.send(JSON.stringify({type:'error',msg:'Already at full HP'}));
        broadcastState(); return;
      }
      spendBrickCharge(p, 'white', 1);
      const baseHeal = SELF_HEAL_AMT[p.cls] || 2;
      const healAmt = Math.min(baseHeal, p.hpMax - p.hp);
      p.hp += healAmt;
      log(`${p.name} healed +${healAmt} HP (1 white charge) → ${p.hp}/${p.hpMax}`, 'heal');
    }
    // Shield self (§8.2 board action, consumes bricksCharged.gray).
    // BASE for all classes: 1 gray charge → +1 armor, cap = hpMax.
    // CRIT: on a lucky roll, same cost yields +2 armor instead of +1.
    //   Blocksmith: 25% crit (class identity). All other classes: 10%.
    // Class abilities / fusion upgrades will modify these values later.
    if (type === 'addShield') {
      const p = G.players[P.cls];
      if (!p || !p.alive) { broadcastState(); return; }
      const cost = 1;
      const cap  = p.hpMax || 10;
      const critChance = (p.cls === 'blocksmith') ? 0.25 : 0.10;
      if (((p.bricksCharged && p.bricksCharged.gray) || 0) < cost) {
        ws.send(JSON.stringify({type:'error',msg:'Need 1 gray charge (have '+((p.bricksCharged && p.bricksCharged.gray) || 0)+')'}));
        broadcastState(); return;
      }
      if ((p.armor || 0) >= cap) {
        ws.send(JSON.stringify({type:'error',msg:'Armor already at max ('+cap+')'}));
        broadcastState(); return;
      }
      spendBrickCharge(p, 'gray', cost);
      const crit = Math.random() < critChance;
      const gain = crit ? 2 : 1;
      p.armor = Math.min(cap, (p.armor || 0) + gain);
      log(`${p.name} raised shield +${gain} armor${crit?' (CRIT!)':''} (1 gray charge) → 🛡${p.armor}/${cap}`, 'reward');
      if (crit) {
        ws.send(JSON.stringify({type:'rewardPopup',kind:'shield',label:'Shield crit! +2 armor',color:'gray',brickColor:BRICK_COLORS.gray}));
      }
    }

    // ── v4 CHEESE SYSTEM ──
    if (type === 'adjustCheese') {
      const p = G.players[P.cls];
      if (!p) return;
      p.cheese = Math.max(0, (p.cheese||0) + (P.amount||0));
      broadcastState(); return;
    }
    if (type === 'consumeCheese') {
      const p = G.players[P.cls];
      if (!p) return;
      const amt = Math.max(1, parseInt(P.amount||1) || 1);
      const actual = Math.min(amt, p.cheese||0);
      if (actual <= 0) { broadcastState(); return; }
      p.cheese -= actual;
      p.hpMax = (p.hpMax||10) + actual;
      p.hp = Math.min(p.hpMax, (p.hp||0) + actual);
      const pName = p.playerName||p.name;
      log(pName+' ate '+actual+' cheese (+'+actual+' max HP)','reward');
      broadcastState(); return;
    }
    if (type === 'giftCheese') {
      const from = G.players[P.fromCls];
      const to = G.players[P.toCls];
      if (!from || !to) return;
      const amt = Math.max(1, parseInt(P.amount||1) || 1);
      const actual = Math.min(amt, from.cheese||0);
      if (actual <= 0) { broadcastState(); return; }
      // Require same-zone (matches brick trade proximity rule)
      const fromZone = (SPACES[from.space]||{}).zone;
      const toZone = (SPACES[to.space]||{}).zone;
      if (fromZone !== toZone) {
        ws.send(JSON.stringify({type:'error',msg:'Recipient must be in same zone'}));
        return;
      }
      from.cheese -= actual;
      to.cheese = (to.cheese||0) + actual;
      log((from.playerName||from.name)+' gifted '+actual+' cheese to '+(to.playerName||to.name),'action');
      broadcastState(); return;
    }

    // ── v4 POISON CLEANSE (board action, consumes 1 white brick) ──
    if (type === 'cleansePoison') {
      const p = G.players[P.cls];
      if (!p) return;
      if ((p.bricks.white||0) < 1) {
        ws.send(JSON.stringify({type:'error',msg:'Need 1 white brick to cleanse'}));
        return;
      }
      if ((p.queuedPoisonStacks||0) === 0 && (p.queuedPoisonBattles||0) === 0) {
        ws.send(JSON.stringify({type:'error',msg:'No poison to cleanse'}));
        return;
      }
      p.bricks.white -= 1;
      const cleared = p.queuedPoisonStacks||0;
      p.queuedPoisonStacks = 0;
      p.queuedPoisonBattles = 0;
      log((p.playerName||p.name)+' cleansed '+cleared+' poison stack'+(cleared!==1?'s':'')+' (1 white)','action');
      broadcastState(); return;
    }
    if (type === 'toggleMovement') {
      G.allowBackward = !!P.allowBackward;
      log('Movement direction: '+(G.allowBackward?'forward OR backward':'forward only'),'action');
    }
    if (type === 'toggleStore') {
      G.storeDisabled = !!P.disabled;
      log('Store '+(G.storeDisabled?'disabled':'enabled'),'action');
    }

    if (type === 'adjustArmor') {
      const ap = G.players[P.cls];
      const maxShield2 = Math.floor(ap.hpMax * 0.5);
      ap.armor = Math.max(0, Math.min(maxShield2, (ap.armor||0)+P.amount));
      log(`${ap.name} shield ${P.amount>0?'+':''}${P.amount} → ${ap.armor}/${maxShield2}`,'action');
    }
    if (type === 'addStatus') {
      const p = G.players[P.cls];
      if (!p.statusEffects.includes(P.status)) p.statusEffects.push(P.status);
      log(`${p.name} is now ${P.status}`,'action');
    }
    if (type === 'removeStatus') {
      G.players[P.cls].statusEffects = G.players[P.cls].statusEffects.filter(s=>s!==P.status);
      log(`${G.players[P.cls].name} ${P.status} removed`,'action');
    }

    // ── TRADING ──
    // Helper: is this player currently in an active battle?
    const isInBattle = (cls) => !!(G.rumbleBattle && G.rumbleBattle.cls === cls);

    if (type === 'offerTrade') {
      if (isInBattle(P.fromCls) || isInBattle(P.toCls)) {
        ws.send(JSON.stringify({type:'error', msg:'Cannot trade with a player in battle'}));
        broadcastState(); return;
      }
      const id = Date.now().toString();
      const offerBricks = P.offerBricks || (P.offerColor ? {[P.offerColor]:1} : {});
      const offerGold   = P.offerGold || 0;
      const offerCheese = P.offerCheese || 0;
      const wantBricks  = P.wantBricks || (P.wantColor ? {[P.wantColor]:1} : {});
      const wantCheese  = P.wantCheese || 0;
      G.pendingTrade = { id, fromCls:P.fromCls, toCls:P.toCls, wantBricks, wantCheese, offerBricks, offerGold, offerCheese };
      const fromName = G.players[P.fromCls]?.playerName || G.players[P.fromCls]?.name || P.fromCls;
      const toName   = G.players[P.toCls]?.playerName   || G.players[P.toCls]?.name   || P.toCls;
      const offerDesc = Object.entries(offerBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(offerGold>0?` +${offerGold}g`:'')+(offerCheese>0?` +${offerCheese}🧀`:'');
      const wantDesc  = Object.entries(wantBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(wantCheese>0?` +${wantCheese}🧀`:'');
      log(`${fromName} offers [${offerDesc}] for [${wantDesc}] from ${toName}`,'trade');
      clients.forEach((info, cws) => {
        if (info.role === P.toCls && cws.readyState === 1)
          cws.send(JSON.stringify({ type:'tradeOffer', offer:G.pendingTrade }));
      });
    }
    if (type === 'respondTrade') {
      const t = G.pendingTrade;
      if (!t || t.id !== P.id) { broadcastState(); return; }
      if (P.accept) {
        const from = G.players[t.fromCls];
        const to   = G.players[t.toCls];
        const offerBricks = t.offerBricks || {};
        const wantBricks  = t.wantBricks  || {};
        const fromHasBricks = Object.entries(offerBricks).every(([k,v]) => (from.bricks[k]||0) >= v);
        const fromHasGold   = (from.gold||0) >= (t.offerGold||0);
        const fromHasCheese = (from.cheese||0) >= (t.offerCheese||0);
        const toHasWant     = Object.entries(wantBricks).every(([k,v])  => (to.bricks[k]||0)   >= v);
        const toHasCheese   = (to.cheese||0) >= (t.wantCheese||0);
        if (fromHasBricks && fromHasGold && fromHasCheese && toHasWant && toHasCheese) {
          Object.entries(offerBricks).forEach(([k,v]) => { removeBrick(from, k, v); addBrick(to, k, v); });
          if (t.offerGold>0)   { from.gold=(from.gold||0)-t.offerGold;   to.gold=(to.gold||0)+t.offerGold; }
          if (t.offerCheese>0) { from.cheese=(from.cheese||0)-t.offerCheese; to.cheese=(to.cheese||0)+t.offerCheese; }
          Object.entries(wantBricks).forEach(([k,v])  => { removeBrick(to, k, v); addBrick(from, k, v); });
          if (t.wantCheese>0)  { to.cheese=(to.cheese||0)-t.wantCheese; from.cheese=(from.cheese||0)+t.wantCheese; }
          const offerDesc=Object.entries(offerBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(t.offerGold>0?` +${t.offerGold}g`:'')+(t.offerCheese>0?` +${t.offerCheese}🧀`:'');
          const wantDesc=Object.entries(wantBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(t.wantCheese>0?` +${t.wantCheese}🧀`:'');
          log(`Trade accepted: ${from.name} gave [${offerDesc}] for [${wantDesc}] from ${to.name}`,'trade');
          clients.forEach((info, cws) => {
            if ((info.role===t.fromCls||info.role===t.toCls) && cws.readyState===1)
              cws.send(JSON.stringify({type:'tradeAccepted',wantBricks,wantCheese:t.wantCheese||0,offerBricks,offerGold:t.offerGold,offerCheese:t.offerCheese||0,fromCls:t.fromCls,toCls:t.toCls}));
          });
        } else { log(`Trade failed — items no longer available`,'trade'); }
      } else {
        const toName=G.players[t.toCls]?.playerName||G.players[t.toCls]?.name||t.toCls;
        log(`${toName} declined trade`,'trade');
        clients.forEach((info,cws)=>{ if(info.role===t.fromCls&&cws.readyState===1) cws.send(JSON.stringify({type:'tradeDeclined',toCls:t.toCls})); });
      }
      G.pendingTrade = null;
    }
    if (type === 'cancelTrade') { G.pendingTrade = null; }

    // ── GIVE ITEMS (no trade required, direct transfer) ──
    if (type === 'giveItems') {
      const { fromCls, targetCls, bricks: giveBricks, gold: giveGold, cheese: giveCheese } = P;
      if (isInBattle(fromCls) || isInBattle(targetCls)) {
        ws.send(JSON.stringify({type:'error', msg:'Cannot give items to/from a player in battle'}));
        broadcastState(); return;
      }
      const from = G.players[fromCls];
      const to   = G.players[targetCls];
      if (!from || !to) { broadcastState(); return; }
      const fromName = from.playerName || from.name;
      const toName   = to.playerName   || to.name;
      // Transfer bricks
      if (giveBricks) {
        Object.entries(giveBricks).forEach(([k, qty]) => {
          qty = parseInt(qty)||0;
          if (qty <= 0) return;
          const have = from.bricks[k]||0;
          const actual = Math.min(qty, have);
          if (actual <= 0) return;
          removeBrick(from, k, actual);
          addBrick(to, k, actual);
          log(`${fromName} gave ${actual}x ${k} to ${toName}`, 'trade');
        });
      }
      // Transfer gold
      if (giveGold && giveGold > 0) {
        const goldActual = Math.min(giveGold, from.gold||0);
        if (goldActual > 0) {
          from.gold = (from.gold||0) - goldActual;
          to.gold   = (to.gold||0)   + goldActual;
          log(`${fromName} gave ${goldActual} gold to ${toName}`, 'trade');
        }
      }
      // Transfer cheese — 0.14.0: unified give flow now includes cheese so
      // players don't need a separate gift-cheese modal. Same clamp rules.
      if (giveCheese && giveCheese > 0) {
        const cheeseActual = Math.min(giveCheese, from.cheese||0);
        if (cheeseActual > 0) {
          from.cheese = (from.cheese||0) - cheeseActual;
          to.cheese   = (to.cheese||0)   + cheeseActual;
          log(`${fromName} gave ${cheeseActual} cheese to ${toName}`, 'trade');
        }
      }
    }

    // ── GATES ──
    if (type === 'forceGate') {
      const { cls, gate } = P;
      const p = G.players[cls];
      const r = roll(6);
      const success = r>=5;
      let dmg = 2;
      let armorAbsorbed = 0;
      // Use armor charges first
      if ((p.armor||0) > 0) {
        armorAbsorbed = Math.min(p.armor, dmg);
        p.armor -= armorAbsorbed;
        dmg -= armorAbsorbed;
      }
      p.hp = Math.max(0, p.hp-dmg); if(p.hp<=0)p.alive=false;
      if(success) { G.gates[gate]='open'; }
      const note = (success?'Gate forced open':'Gate held') + ' (rolled '+r+') — '+(armorAbsorbed>0?armorAbsorbed+' absorbed by armor, ':'')+(dmg>0?dmg+' HP damage':'no HP damage');
      log((p.playerName||p.name)+' '+note,'gate');
      const fgMsg = JSON.stringify({ type:'forceGateResult', roll:r, success, cls, gate, dmg, armorAbsorbed, note });
      clients.forEach((info, cws) => { if(cws.readyState===1) cws.send(fgMsg); });
    }
    if (type === 'setGate') { G.gates[P.gate] = P.status; log(`Gate ${P.gate} → ${P.status}`,'gate'); }
    if (type === 'collectKey') { G.magicKeys[P.keyColor]=P.cls; log(`${G.players[P.cls].name} claimed ${P.keyColor} key`,'key'); }
    if (type === 'useKey') {
      const { cls, gate, keyColor } = P;
      G.magicKeys[keyColor]=null;
      G.gates[gate]='open';
      log(`${G.players[cls].name} used ${keyColor} key → ${gate} open`,'gate');
    }

    // ── SCENARIO ──
    if (type === 'removeFortressBrick') { G.fortressBricks=Math.max(0,G.fortressBricks-1); log(`Fortress: ${G.fortressBricks} bricks`,'scenario'); }
    if (type === 'rescueVillager') { G.villagersRescued=Math.min(3,G.villagersRescued+1); log(`Villager rescued ${G.villagersRescued}/3`,'scenario'); }
    if (type === 'addLog') { log(P.text, P.kind||'normal'); }
    if (type === 'resetGame') {
      G = freshState();
      log('Game reset','normal');
    }

    broadcastState();
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if(info?.role && G.players[info.role]) { G.players[info.role].connected=false; broadcastState(); }
    clients.delete(ws);
  });
});

// ── API: Trivia & Riddles ─────────────────────────────────
// Served as JSON on /api/trivia and /api/riddle
// Already handled in httpServer by falling through to file

httpServer.listen(PORT,'0.0.0.0',()=>{
  let ip='localhost';
  const nets=os.networkInterfaces();
  for(const n of Object.values(nets).flat()) { if(n.family==='IPv4'&&!n.internal){ip=n.address;break;} }
  console.log(`\n🧱 BRICK QUEST v${BQ_VERSION} RUNNING\n`);
  console.log(`  DM Screen:    http://${ip}:${PORT}/dm_screen.html`);
  console.log(`  All Players:  http://${ip}:${PORT}/players.html`);
  console.log(`  Test Players: http://${ip}:${PORT}/test_players.html`);
  console.log(`  Rumble Test:  http://${ip}:${PORT}/rumble_test.html\n`);
  console.log(`  Console commands: save | load | reset | status\n`);
  console.log(`  Game auto-saves to brickquest-save.json after every action.\n`);
  console.log(`  Press Ctrl+C to stop (state will be saved).\n`);
});

// Save on Ctrl+C / process exit
process.on('SIGINT', function() {
  console.log('\n[SAVE] Saving game state before exit...');
  saveState();
  console.log('[SAVE] Saved. Goodbye!');
  process.exit(0);
});
process.on('SIGTERM', function() { saveState(); process.exit(0); });
process.on('uncaughtException', function(err) {
  console.error('[CRASH] Uncaught exception:', err.message);
  console.log('[CRASH] Attempting emergency save...');
  try { saveState(); console.log('[CRASH] Emergency save successful — restart server to recover.'); }
  catch(e) { console.error('[CRASH] Save failed:', e.message); }
  process.exit(1);
});
