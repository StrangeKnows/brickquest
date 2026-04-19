// ═══════════════════════════════════════════════════════════
//  BRICK QUEST — Server v2.0
//  node server.js
// ═══════════════════════════════════════════════════════════
const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');
const os = require('os');

// Shared game constants
const { SPACES, ZONES, GATE_SPACES, GATE_RULES, BRICK_COLORS, BRICK_NAMES, LANDING_EVENTS, PLAYER_META, DASH_FLAVOR, ARENA_ENEMIES, ARENA_BATTLE_FLAVOR, SHIELD_MAX, SHIELD_COST } = require('./game.js');

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
    turnOrder: ['warrior','wizard','scout','builder','mender','beastcaller'],
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
    orangeSpaces: {},         // { spaceIdx: trapCount } — persistent traps
    blueSpaces: {},           // { spaceIdx: 1 } — unresolved blue events
    yellowSpaces: {},          // { spaceIdx: true } — unclaimed yellow brick from expired riddle
    greenSpaces: {},          // { spaceIdx: 1 } — unresolved green events (future)
    allowBackward: false,     // DM toggle: allow players to move backward
    storeDisabled: false,     // DM toggle: disable store for all zones
    pendingDashRequest: null, // { cls, spaces, requestedAt } — awaits DM approval
    pendingArenaBattle: null, // { cls, enemyType, enemy, flavor } — event card stage, awaits player or DM initiate
    arenaBattle: null,        // active real-time battle state (see arena handlers below)
    log: [],
    players: {
      warrior:     mkPlayer('warrior',    '⚔️', '#993C1D', 12, 'd8',  {red:3,gray:2,white:1}),
      wizard:      mkPlayer('wizard',     '🔮', '#3C3489',  8, 'd6',  {blue:4,purple:1,yellow:1}),
      scout:       mkPlayer('scout',      '🏃', '#085041', 10, 'd6',  {red:2,yellow:2,orange:1,gray:1}),
      builder:     mkPlayer('builder',    '🔧', '#854F0B', 10, 'd6',  {green:2,purple:1,gray:2,white:1}),
      mender:      mkPlayer('mender',     '💊', '#72243E', 10, 'd4',  {white:4,purple:2,yellow:1}),
      beastcaller: mkPlayer('beastcaller','🐾', '#27500A', 10, 'd6',  {green:4,yellow:2,orange:1,gray:1}),
    }
  };
}

function mkPlayer(cls, icon, color, hp, die, bricks) {
  const allBricks = {red:0,blue:0,green:0,white:0,gray:0,purple:0,yellow:0,orange:0,black:0};
  return {
    cls, icon, color,
    name: {warrior:'Warrior',wizard:'Wizard',scout:'Scout',builder:'Builder',mender:'Mender',beastcaller:'Beastcaller'}[cls]||cls,
    hp, hpMax:hp, armor:0, gold:3,
    die, space:0, alive:true,
    bricks: {...allBricks,...bricks},
    statusEffects: [],     // ['poisoned','confused','cursed']
    connected: false,
    playerName: '',        // real player's name, set on login
    earnedClues: [],      // clues this player earned by solving yellow challenges
    dashUsedThisTurn: false, // reset on each turn advance — one red dash per own turn
    battleDashPenalty: 0,    // if >0, decrement red by this much at battle start (consumed once)
  };
}

let G = freshState();

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
        });
      }
      if (G.pendingDashRequest === undefined) G.pendingDashRequest = null;
      if (G.pendingArenaBattle === undefined) G.pendingArenaBattle = null;
      if (G.arenaBattle === undefined) G.arenaBattle = null;
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
      console.log('Arena battle:', !!G.arenaBattle);
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

// ── LEGO TRIVIA ───────────────────────────────────────────
const LEGO_TRIVIA = [
  { q:"What year was LEGO founded?", a:"1932", diff:"easy" },
  { q:"What does LEGO mean in Danish?", a:"play well", diff:"easy" },
  { q:"What color was the first LEGO brick?", a:"red", diff:"easy" },
  { q:"How many LEGO sets are sold per second worldwide (approx)?", a:"7", diff:"medium" },
  { q:"What is the most produced LEGO element of all time?", a:"brick", diff:"medium" },
  { q:"What year did LEGO Mindstorms launch?", a:"1998", diff:"medium" },
  { q:"How many studs does a standard 2×4 LEGO brick have?", a:"8", diff:"easy" },
  { q:"What country is LEGO headquartered in?", a:"denmark", diff:"easy" },
  { q:"What was the first licensed LEGO theme?", a:"star wars", diff:"medium" },
  { q:"Approximately how many LEGO pieces are produced each year?", a:"36 billion", diff:"hard" },
  { q:"What is the name of LEGO's fictional city/world theme?", a:"lego city", diff:"easy" },
  { q:"In what decade did LEGO minifigures first appear?", a:"1970s", diff:"medium" },
  { q:"What material are LEGO bricks made from?", a:"abs plastic", diff:"medium" },
  { q:"What is the clutch power of a LEGO stud?", a:"4.4 newtons", diff:"hard" },
  { q:"How many possible combinations exist with 6 standard 2×4 LEGO bricks?", a:"915 million", diff:"hard" },
];

// ── RIDDLES ───────────────────────────────────────────────
const RIDDLES = require('./game.js').RIDDLES;

// Wrong answer pool for multiple choice distractors
const WRONG_ANSWERS = [
  'a shadow','a mirror','a candle','the wind','a key','a secret','silence','a door',
  'a bridge','a coin','an hourglass','a flame','a needle','a ladder','a stone',
  'a ring','a book','a well','a thread','a bell','a feather','a riddle'
];

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
      p.bricks[color] = (p.bricks[color]||0) + 1;
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
      if (cls==='scout') finalRoll += 1;
      if (G.movementDebuffs[cls]) { finalRoll = Math.max(0, finalRoll - G.movementDebuffs[cls]); delete G.movementDebuffs[cls]; }
      // Enhanced movement doesn't add spaces — it adds action slots
      // destination is computed by DM screen after gate checks
      const prev = p.space;
      p.space = destination;
      G.phase = 'land';
      log(`${p.name} moved ${rawRoll}${cls==='scout'?'+scout bonus':''} → space ${destination+1}`,'move');
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
      // Consume brick + per-turn flag + battle fatigue
      p.bricks.red -= 1;
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
    // ARENA BATTLE HANDLERS
    // ═══════════════════════════════════════════════════
    // Shared helper: transition pendingArenaBattle → active arenaBattle state
    function startArenaBattleFromPending(forced) {
      if (!G.pendingArenaBattle) return false;
      const pending = G.pendingArenaBattle;
      const p = G.players[pending.cls];
      if (!p) { G.pendingArenaBattle = null; return false; }
      // Seed the live battle state — snapshot of player's current HP, armor,
      // and bricks; the client reports back incrementally via battleTick.
      G.arenaBattle = {
        cls: pending.cls,
        enemyType: pending.enemyType,
        enemy: { ...pending.enemy },
        flavor: pending.flavor,
        playerArena: {
          hp: p.hp,
          hpMax: p.hpMax,
          armor: p.armor || 0,
          bricks: { ...p.bricks },
        },
        startTime: Date.now(),
        elapsedMs: 0,
        paused: false,
        forced: !!forced,
        log: [
          { t:0, actor:'system', text: pending.flavor },
        ],
      };
      G.pendingArenaBattle = null;
      log((p.playerName||p.name) + ' — arena battle begins vs ' + pending.enemy.name, 'battle');
    }

    // Player taps "Enter Arena" on their event card
    if (type === 'battleReady') {
      const { cls } = P;
      if (!G.pendingArenaBattle || G.pendingArenaBattle.cls !== cls) { broadcastState(); return; }
      startArenaBattleFromPending(false);
      broadcastState(); return;
    }

    // DM taps "Start Battle" (same effect as battleReady, DM side)
    if (type === 'battleStartDM') {
      if (!G.pendingArenaBattle) { broadcastState(); return; }
      startArenaBattleFromPending(false);
      broadcastState(); return;
    }

    // DM taps "Force Battle" — skips the event card, player drops straight to arena
    if (type === 'battleForceDM') {
      if (!G.pendingArenaBattle) { broadcastState(); return; }
      startArenaBattleFromPending(true);
      broadcastState(); return;
    }

    // Client sends periodic ticks with HP/brick/enemy state + log entries
    if (type === 'battleTick') {
      if (!G.arenaBattle) { broadcastState(); return; }
      const { cls, playerHp, playerArmor, playerBricks, enemyHp, elapsedMs, logEntries } = P;
      if (cls !== G.arenaBattle.cls) { broadcastState(); return; }
      if (G.arenaBattle.paused) { broadcastState(); return; } // ignore ticks while paused
      if (typeof playerHp === 'number') G.arenaBattle.playerArena.hp = playerHp;
      if (typeof playerArmor === 'number') G.arenaBattle.playerArena.armor = playerArmor;
      if (playerBricks && typeof playerBricks === 'object') G.arenaBattle.playerArena.bricks = playerBricks;
      if (typeof enemyHp === 'number') G.arenaBattle.enemy.hp = enemyHp;
      if (typeof elapsedMs === 'number') G.arenaBattle.elapsedMs = elapsedMs;
      if (Array.isArray(logEntries) && logEntries.length) {
        G.arenaBattle.log = G.arenaBattle.log.concat(logEntries);
        // Cap log to last 60 entries
        if (G.arenaBattle.log.length > 60) {
          G.arenaBattle.log = G.arenaBattle.log.slice(-60);
        }
      }
      broadcastState(); return;
    }

    // Client reports battle end with final state + winner
    if (type === 'battleEnd') {
      if (!G.arenaBattle) { broadcastState(); return; }
      const { cls, victor, finalHp, finalArmor, finalBricks, reason } = P;
      if (cls !== G.arenaBattle.cls) { broadcastState(); return; }
      const p = G.players[cls];
      if (p) {
        if (typeof finalHp === 'number') p.hp = Math.max(0, finalHp);
        if (typeof finalArmor === 'number') p.armor = Math.max(0, finalArmor);
        if (finalBricks && typeof finalBricks === 'object') {
          Object.keys(finalBricks).forEach(k => { p.bricks[k] = Math.max(0, finalBricks[k]); });
        }
        if (p.hp <= 0) p.alive = false;
      }
      const pName = p ? (p.playerName||p.name) : cls;
      log(pName + ' battle ended — victor: ' + victor + (reason ? ' (' + reason + ')' : ''), 'battle');
      G.arenaBattle = null;
      G.phase = 'prepare';
      broadcastState(); return;
    }

    // DM toggles pause
    if (type === 'battlePause') {
      if (!G.arenaBattle) { broadcastState(); return; }
      G.arenaBattle.paused = !!P.paused;
      log('Battle ' + (G.arenaBattle.paused ? 'paused' : 'resumed') + ' by DM', 'battle');
      broadcastState(); return;
    }

    // DM force-resets the battle to fresh state (both sides full HP, bricks back to snapshot)
    if (type === 'battleForceReset') {
      if (!G.arenaBattle) { broadcastState(); return; }
      const b = G.arenaBattle;
      const p = G.players[b.cls];
      if (!p) { broadcastState(); return; }
      const enemyTpl = ARENA_ENEMIES[b.enemyType] || { hp: 60, hpMax: 60 };
      b.enemy.hp = enemyTpl.hpMax || enemyTpl.hp;
      b.playerArena.hp = p.hpMax;
      b.playerArena.armor = 0;
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
      if (!G.arenaBattle) { broadcastState(); return; }
      log('Battle force-quit by DM', 'battle');
      G.arenaBattle = null;
      G.phase = 'prepare';
      broadcastState(); return;
    }

    // DM dismisses a pending arena battle without starting it (e.g. reroll, skip)
    if (type === 'battleDismissPending') {
      if (!G.pendingArenaBattle) { broadcastState(); return; }
      log('Pending battle dismissed by DM', 'battle');
      G.pendingArenaBattle = null;
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
        const clsNames = {warrior:'Warrior',wizard:'Wizard',scout:'Scout',builder:'Builder',mender:'Mender',beastcaller:'Beastcaller'};
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
        G.activeEvent.isWizard = (cls === 'wizard');
        G.activeEvent.resolved = false;
        log(pName+' — forced blue: '+variant,'event');
      }

      // ── GRAY — player gets Take 1 / Search choice (same as natural) ──
      // No change needed — activeEvent set above, player renders gray card

      // ── WHITE — auto-give (same as natural) ──
      if (evType === 'white') {
        const col = brickColor || 'white';
        p.bricks[col] = (p.bricks[col]||0)+1;
        log(pName+' got 1 '+col+' brick (forced)','reward');
        G.activeEvent.resolved = true;
      }

      // ── TRAP / DOUBLETRAP — tap-burst game fires on player (same as natural) ──
      // No change needed — player renders tap burst when evType=trap/doubletrap

      // ── RIDDLE — DM reads aloud, player waits (same as natural) ──
      // No change needed

      // ── PURPLE — trivia challenge (same as natural) ──
      // No change needed

      // ── MONSTER / BOSS ──
      if (evType === 'monster' && mids && mids.length) {
        G.activeEvent = { cls, roll:'DM', zone:zone||0, resolved:false, evType:'monster', mids, forced:true };
        // Force → pending arena battle: player will see red encounter card with Initiate button.
        const enemyType = 'goblin'; // v1: all monster events become goblin
        const enemyTpl = ARENA_ENEMIES[enemyType];
        const flavorPool = ARENA_BATTLE_FLAVOR[enemyType] || [enemyTpl.name + ' appears!'];
        const flavor = flavorPool[Math.floor(Math.random() * flavorPool.length)];
        G.pendingArenaBattle = {
          cls,
          enemyType,
          enemy: { ...enemyTpl },
          flavor,
          createdAt: Date.now(),
        };
        log(pName + ' — DM forced encounter: ' + enemyTpl.name, 'event');
      }
      if (evType === 'boss') {
        G.activeEvent = { cls, roll:'DM', zone:zone||0, resolved:false, evType:'boss', isBoss:true, forced:true };
      }

      // ── NOTHING ──
      if (evType === 'nothing') {
        G.activeEvent.resolved = true;
      }
    }

    if (type === 'landingRoll') {
      const { cls, roll: rClient, zone } = P;
      const r = roll(6); // server-side roll
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
          G.activeEvent = { cls, roll:'SPACE', zone, resolved:false, evType:'blue', blueVariant:variant, isWizard:(cls==='wizard'), forced:true };
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
          {roll:1,type:'nothing'},{roll:2,type:'nothing'},{roll:3,type:'gold',amount:1},
          {roll:4,type:'gray'},{roll:5,type:'monster'},{roll:6,type:'riddle'}
        ],
        2:[
          {roll:1,type:'trap'},{roll:2,type:'nothing'},{roll:3,type:'gold',amount:2},
          {roll:4,type:'blue'},{roll:5,type:'monster'},{roll:6,type:'riddle'}
        ],
        3:[
          {roll:1,type:'monster'},{roll:2,type:'trap'},{roll:3,type:'gold',amount:1},
          {roll:4,type:'monster'},{roll:5,type:'riddle'},{roll:6,type:'creeper'}
        ],
        4:[
          {roll:1,type:'monster'},{roll:2,type:'doubletrap'},{roll:3,type:'gold',amount:3},
          {roll:4,type:'monster'},{roll:5,type:'purple'},{roll:6,type:'monster'}
        ],
        5:[
          {roll:1,type:'boss'},{roll:2,type:'boss'},{roll:3,type:'boss'},
          {roll:4,type:'boss'},{roll:5,type:'boss'},{roll:6,type:'boss'}
        ]
      };
      const zoneTable = LANDING[zone+1] || LANDING[1];
      const evData = zoneTable[r-1] || {};
      // Scout Trap Sense: if scout is in same zone, orange landing becomes red challenge
      let resolvedType = evData.type;
      if (resolvedType === 'trap' || resolvedType === 'doubletrap') {
        const scoutP = G.players.scout;
        if (scoutP && scoutP.alive && SPACES[scoutP.space] && SPACES[scoutP.space].zone === zone) {
          resolvedType = 'challenge'; // treat as red challenge space instead
          log('Scout Trap Sense! Orange trap converted to challenge for '+pName,'action');
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
        eventMeta.isWizard = (cls === 'wizard');
        log(pName+' found blue energy — '+variant+' event','event');
      }
      // ── ARENA BATTLE HOOK ──
      // If the landing event is a monster, set up a pending arena battle.
      // The event card on the player's screen AND a panel on the DM's screen
      // can both initiate the arena. Either party's initiate wins.
      if (evData.type === 'monster') {
        const enemyType = 'goblin'; // v1: all monster events become goblin
        const enemyTpl = ARENA_ENEMIES[enemyType];
        const flavorPool = ARENA_BATTLE_FLAVOR[enemyType] || [enemyTpl.name + ' appears!'];
        const flavor = flavorPool[Math.floor(Math.random() * flavorPool.length)];
        G.pendingArenaBattle = {
          cls,
          enemyType,
          enemy: { ...enemyTpl }, // clone so mutations don't leak
          flavor,
          createdAt: Date.now(),
        };
        log(pName + ' encounter: ' + enemyTpl.name + ' — awaiting initiate', 'event');
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
      // Generate 4 options: correct + 3 distractors
      const wrongPool = WRONG_ANSWERS.filter(w => w !== r.a);
      const wrongs = [];
      while (wrongs.length < 3) {
        const w = wrongPool[Math.floor(Math.random()*wrongPool.length)];
        if (!wrongs.includes(w)) wrongs.push(w);
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
      if (answer === G.activeEvent.riddleA) {
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
        // wrongTap behavior differs by variant:
        // crack = rat bite → -1 HP
        // torch = tapped decoy → +1 HP consolation
        if (wrongTap) {
          const variant = G.activeEvent?.goldVariant;
          if (variant === 'crack') {
            p.hp = Math.max(0, (p.hp||0) - 1);
            if (p.hp <= 0) p.alive = false;
            log(pNameGold+' found the rat — -1 HP (rat bite)','damage');
          } else {
            // Torch decoy — found crumb/cheese: +1 HP, or +1 max HP if already full
            let maxHpUp = false;
            if (p.hp >= p.hpMax) {
              p.hpMax = (p.hpMax||10) + 1;
              p.hp = p.hpMax;
              maxHpUp = true;
              log(pNameGold+' found something nourishing — max HP +1 (was full)','reward');
            } else {
              p.hp = Math.min(p.hpMax, (p.hp||0)+1);
              log(pNameGold+' found something nourishing — +1 HP','reward');
            }
            G.activeEvent = { ...G.activeEvent, goldResult: { amount: awarded, wrongTap: true, maxHpUp, totalPlaced }, resolved: false };
            broadcastState(); return;
          }
        } else {
          log(pNameGold+' found '+awarded+' gold (mini-game)','reward');
        }
        G.activeEvent = { ...G.activeEvent, goldResult: { amount: awarded, wrongTap: wrongTap||false, totalPlaced }, resolved: false };
      }
      if (eventType === 'brick')  {
        const d = data||{};
        p.bricks[d.color] = (p.bricks[d.color]||0)+1;
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
        log(`TRAP! ${pName} — ${trapCount} trap(s), ${rawDmg} raw, ${blocked} blocked, −${finalDmg} HP → ${p.hp}`,'damage');
        if (!G.orangeSpaces) G.orangeSpaces = {};
        G.orangeSpaces[p.space] = (G.orangeSpaces[p.space]||0) + trapCount;
        G.activeEvent = { ...G.activeEvent, trapResult:{ dmg:finalDmg, rawDmg, dodged:blocked, trapCount, disarmed:false } };
        broadcastState(); return;
      }
      if (eventType === 'disarmTrap') {
        // Scout disarms trap — costs 1 gray brick, gains 1 orange brick
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
        const isWizard = cls === 'wizard';
        const bricks = success && isWizard ? 2 : 1;
        p.bricks.blue = (p.bricks.blue||0) + bricks;
        if (bonus === 'gold') p.gold = (p.gold||0) + 1;
        if (bonus === 'shield' && p.armor < Math.floor(p.hpMax * 0.5)) p.armor++;
        if (bonus === 'roll_bonus') { if (!G.rollBonuses) G.rollBonuses = {}; G.rollBonuses[cls] = (G.rollBonuses[cls]||0) + 1; }
        const pNameB = p.playerName||p.name;
        const label = bricks > 1 ? '+2 Blue Bricks!' : '+1 Blue Brick!';
        log(pNameB+' completed blue event — '+label+(bonus?' +'+bonus:'')+(isWizard&&success?' (Wizard bonus!)':''),'reward');
        // Clear persisted blue space
        if (!G.blueSpaces) G.blueSpaces = {};
        if (p.space !== undefined) delete G.blueSpaces[p.space];
        G.activeEvent = { ...G.activeEvent, blueResult:{ success:true, msg: label+(bonus==='gold'?' +1 Gold':bonus==='shield'?' +Shield pip':bonus?' +'+bonus.replace('_',' '):'')+(isWizard?' (Wizard!)':'') }, resolved:false }; // DM must click resolve
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
      if (eventType === 'grayTake1') {
        const amt = cls==='builder' ? 2 : 1;
        p.bricks.gray = (p.bricks.gray||0)+amt;
        G.activeEvent = { ...G.activeEvent, grayResult:{ took:amt, searched:false } };
        log((p.playerName||p.name)+' took '+amt+' gray brick'+(amt>1?'s':'')+' from rubble','reward');
        broadcastState(); return;
      }
      if (eventType === 'builderScavenge') {
        const base = 2;
        const r = roll(6);
        const bonus = r>=6 ? 2 : r>=4 ? 1 : 0;
        const total = base + bonus;
        p.bricks.gray = (p.bricks.gray||0) + total;
        G.activeEvent = { ...G.activeEvent, grayResult:{ took:base, scavengeRoll:r, scavengeBonus:bonus, searched:false } };
        log((p.playerName||p.name)+' Scavenge: '+base+' base + '+bonus+' bonus (roll '+r+') = '+total+' gray bricks','reward');
        broadcastState(); return;
      }
      if (eventType === 'graySearch') {
        const r = roll(6);
        const found = r>=5?2:r>=3?1:0;
        const builderBonus = cls==='builder' ? 1 : 0;
        const total = found + builderBonus;
        p.bricks.gray = (p.bricks.gray||0)+total;
        G.activeEvent = { ...G.activeEvent, grayResult:{ found:total, roll:r, searched:true, builderBonus:builderBonus>0 } };
        log((p.playerName||p.name)+' searched rubble — found '+total+' gray brick'+(total!==1?'s':'')+' (roll '+r+')'+(builderBonus?' +Builder bonus':''),'reward');
        broadcastState(); return;
      }
      if (eventType === 'whitePickup') {
        // Standard white brick pickup + class bonus
        p.bricks.white = (p.bricks.white||0)+1;
        if (cls==='mender') {
          // Mender heals 2 HP to chosen target — sent as data.healTarget
          const tgt = data.healTarget||cls;
          const tp = G.players[tgt];
          if(tp) { tp.hp = Math.min(tp.hpMax+3, tp.hp+2); log(`Mender white bonus: +2 HP to ${tp.name}`,'heal'); }
        } else {
          // Self-heal 1 HP, overheal allowed
          p.hp = Math.min(p.hpMax+3, p.hp+1);
          log(`${p.name} white pickup +1 HP`,'heal');
        }
      }
      if (eventType === 'creeperSuccess') {
        const amt = cls==='beastcaller'?2:1;
        p.bricks.green = (p.bricks.green||0)+amt;
        log(`${p.name} cut the vine! +${amt} green brick${amt>1?'s':''}`,'reward');
      }
      if (eventType === 'creeperFail') {
        if (cls!=='beastcaller') {
          G.movementDebuffs[cls] = 2;
          log(`${p.name} missed the vine — movement −2 next turn`,'damage');
        } else {
          p.bricks.green = (p.bricks.green||0)+1;
          log(`Beastcaller missed but still gains 1 green brick`,'reward');
        }
      }
      if (eventType === 'triviaSuccess') {
        p.bricks.purple = (p.bricks.purple||0)+1;
        log(`${p.name} answered correctly — claimed purple brick!`,'reward');
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

      if (cls === 'builder') {
        // Costs 1 gray brick
        if ((p.bricks.gray||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 gray brick to disarm'})); broadcastState(); return; }
        p.bricks.gray--;
        G.orangeSpaces[spaceIdx] = Math.max(0, (G.orangeSpaces[spaceIdx]||1)-1);
        if (G.orangeSpaces[spaceIdx]<=0) delete G.orangeSpaces[spaceIdx];
        log(`Builder disarmed trap at space ${spaceIdx+1} (1 gray spent)`,'action');
      } else if (cls === 'scout') {
        // Spend yellow brick, disarm 1, then roll for more
        if ((p.bricks.yellow||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 yellow brick'})); broadcastState(); return; }
        p.bricks.yellow--;
        G.orangeSpaces[spaceIdx] = Math.max(0,(G.orangeSpaces[spaceIdx]||1)-1);
        if (G.orangeSpaces[spaceIdx]<=0) delete G.orangeSpaces[spaceIdx];
        log(`Scout disarmed trap at space ${spaceIdx+1}`,'action');
        // Check if more in zone — server sends back result, DM decides chain
        const r = roll(6);
        ws.send(JSON.stringify({ type:'scoutDisarmChain', roll:r, continueDisarm: r%2!==0 }));
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
      p.bricks[P.color] = Math.max(0,(p.bricks[P.color]||0)+P.amount);
    }
    if (type === 'adjustGold') {
      G.players[P.cls].gold = Math.max(0, G.players[P.cls].gold+P.amount);
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
    const isInBattle = (cls) => !!(G.arenaBattle && G.arenaBattle.cls === cls);

    if (type === 'offerTrade') {
      if (isInBattle(P.fromCls) || isInBattle(P.toCls)) {
        ws.send(JSON.stringify({type:'error', msg:'Cannot trade with a player in battle'}));
        broadcastState(); return;
      }
      const id = Date.now().toString();
      const offerBricks = P.offerBricks || (P.offerColor ? {[P.offerColor]:1} : {});
      const offerGold   = P.offerGold || 0;
      const wantBricks  = P.wantBricks || (P.wantColor ? {[P.wantColor]:1} : {});
      G.pendingTrade = { id, fromCls:P.fromCls, toCls:P.toCls, wantBricks, offerBricks, offerGold };
      const fromName = G.players[P.fromCls]?.playerName || G.players[P.fromCls]?.name || P.fromCls;
      const toName   = G.players[P.toCls]?.playerName   || G.players[P.toCls]?.name   || P.toCls;
      const offerDesc = Object.entries(offerBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(offerGold>0?` +${offerGold}g`:'');
      const wantDesc  = Object.entries(wantBricks).map(([k,v])=>`${v}x${k}`).join(', ');
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
        const toHasWant     = Object.entries(wantBricks).every(([k,v])  => (to.bricks[k]||0)   >= v);
        if (fromHasBricks && fromHasGold && toHasWant) {
          Object.entries(offerBricks).forEach(([k,v]) => { from.bricks[k]=(from.bricks[k]||0)-v; to.bricks[k]=(to.bricks[k]||0)+v; });
          if (t.offerGold>0) { from.gold=(from.gold||0)-t.offerGold; to.gold=(to.gold||0)+t.offerGold; }
          Object.entries(wantBricks).forEach(([k,v])  => { to.bricks[k]=(to.bricks[k]||0)-v; from.bricks[k]=(from.bricks[k]||0)+v; });
          const offerDesc=Object.entries(offerBricks).map(([k,v])=>`${v}x${k}`).join(', ')+(t.offerGold>0?` +${t.offerGold}g`:'');
          const wantDesc=Object.entries(wantBricks).map(([k,v])=>`${v}x${k}`).join(', ');
          log(`Trade accepted: ${from.name} gave [${offerDesc}] for [${wantDesc}] from ${to.name}`,'trade');
          clients.forEach((info, cws) => {
            if ((info.role===t.fromCls||info.role===t.toCls) && cws.readyState===1)
              cws.send(JSON.stringify({type:'tradeAccepted',wantBricks,offerBricks,offerGold:t.offerGold,fromCls:t.fromCls,toCls:t.toCls}));
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
      const { fromCls, targetCls, bricks: giveBricks, gold: giveGold } = P;
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
          from.bricks[k] = have - actual;
          to.bricks[k] = (to.bricks[k]||0) + actual;
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
  console.log(`\n🧱 BRICK QUEST v2 RUNNING\n`);
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
