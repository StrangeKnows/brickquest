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
const { SPACES, ZONES, GATE_SPACES, BRICK_COLORS, BRICK_NAMES, MONSTER_TEMPLATES, COMPLICATIONS, LANDING_EVENTS, PLAYER_META, SHIELD_MAX, SHIELD_COST } = require('./game.js');

const PORT = 8080;
const MIME = {
  '.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.json':'application/json'
};

// ── INITIAL GAME STATE ────────────────────────────────────
function freshState() {
  return {
    round: 1,
    phase: 'setup',           // setup|trade|move|land|battle
    activePlayerIdx: 0,
    turnOrder: ['warrior','wizard','scout','builder','mender','beastcaller'],
    battle: null,
    activeEvent: null,
    pendingTrade: null,       // { fromCls, toCls, color, id }
    enhancedMovement: {},     // { cls: turnsRemaining }
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
    greenSpaces: {},          // { spaceIdx: 1 } — unresolved green events (future)
    allowBackward: false,     // DM toggle: allow players to move backward
    battleResult: null,       // { loot, combatants, resolvedBy } — shown post-battle
    storeDisabled: false,     // DM toggle: disable store for all zones
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
    skills: {},
    tamed: null,           // { name, hp, hpMax, dmg, armor }
    statusEffects: [],     // ['poisoned','confused','cursed']
    connected: false,
    scavengeRolled: false, // reset each gate deconstruct
    playerName: '',        // real player's name, set on login
    earnedClues: [],      // clues this player earned by solving yellow challenges
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
      console.log('Battle active:', !!G.battle);
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
const SELF_HEAL = { mender:4, warrior:3, builder:3, scout:2, wizard:2, beastcaller:2 };
const ALLY_HEAL = { mender:4 }; // others = 2

function applyHeal(healerCls, targetCls, overHeal=false) {
  const p = G.players[targetCls];
  const isSelf = healerCls === targetCls;
  let amt = isSelf ? (SELF_HEAL[healerCls]||2) : (ALLY_HEAL[healerCls]||2);
  // Deep Mend: if target below half HP
  if (healerCls==='mender' && p.hp <= Math.floor(p.hpMax/2)) {
    if (G.players.mender.skills.deep_mend) amt = Math.floor(Math.random()*3)+6; // 6-8
  }
  const cap = overHeal ? p.hpMax + 3 : p.hpMax;
  p.hp = Math.min(cap, p.hp + amt);
  if (p.hp > 0) p.alive = true;
  log(`${G.players[healerCls].name} healed ${p.name} +${amt} HP`, 'heal');
  return amt;
}

// ── ROLL HELPERS ──────────────────────────────────────────
function roll(sides) { return Math.floor(Math.random()*sides)+1; }
function rollRange(min,max) { return min + Math.floor(Math.random()*(max-min+1)); }

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
      G.phase = 'trade';
      const nextCls = G.turnOrder[G.activePlayerIdx];
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

    if (type === 'setActivePlayer') { G.activePlayerIdx = P.idx; G.phase='trade'; }

    // ── MOVEMENT (DM enters roll) ──
    if (type === 'dmMovePlayer') {
      const { cls, roll: rawRoll, destination, backward } = P;
      const p = G.players[cls];
      let finalRoll = rawRoll;
      // Apply modifiers
      if (cls==='scout') finalRoll += (p.skills.fleet_foot ? 3 : 1);
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
      const { cls, roll: r, zone } = P;
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
        G.activeEvent = { ...G.activeEvent, riddleActive:false, riddleWinner:cls,
          pendingClue: clueEntry, resolved:false };
        log(pNameR+' answered correctly — +1 yellow brick','reward');
        clients.forEach((info,cws)=>{ if(cws.readyState===1) cws.send(JSON.stringify({type:'rewardPopup',kind:'brick',color:'yellow',label:pNameR+' solved it! +1 Yellow Brick!',brickColor:'#F5D000'})); });
      } else {
        // Wrong — mark this player as wrong so they can't try again
        if (!G.activeEvent.riddleWrong) G.activeEvent = { ...G.activeEvent, riddleWrong:[] };
        if (!G.activeEvent.riddleWrong.includes(cls)) {
          G.activeEvent = { ...G.activeEvent, riddleWrong:[...G.activeEvent.riddleWrong, cls] };
          log(cls+' answered wrong','event');
        }
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
      G.phase = 'trade';
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

    // ── ORANGE TRAP PERSISTENCE ROLL (in battle) ──
    if (type === 'battleTrapPersist') {
      const { trapIdx } = P;
      const r = roll(6);
      const persists = r % 2 !== 0; // odd = continues
      G.battle.traps = G.battle.traps || [];
      if (!persists && G.battle.traps[trapIdx]) G.battle.traps[trapIdx].active = false;
      ws.send(JSON.stringify({ type:'trapPersistResult', roll:r, persists, trapIdx }));
      if (persists) {
        const t = G.battle.traps[trapIdx];
        if (t) {
          const isScount = t.setBy==='scout';
          const dmg = isScount ? rollRange(2,4) : rollRange(1,2);
          // Apply to monster
          if (G.battle && G.battle.monsters[0]) {
            G.battle.monsters[0].hpCurrent = Math.max(0, G.battle.monsters[0].hpCurrent - dmg);
            log(`Battle trap persists — ${dmg} damage to ${G.battle.monsters[0].name}`,'damage');
          }
        }
      }
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

    if (type === 'addShield') {
      const sp = G.players[P.cls];
      const hasIH = P.cls==='warrior' && sp.skills && sp.skills.iron_hide;
      const sCost = (P.cls==='warrior'||P.cls==='builder') ? 1 : 2;
      const sGain = hasIH ? 2 : 1;
      if ((sp.bricks.gray||0) < sCost) {
        ws.send(JSON.stringify({type:'error',msg:'Need '+sCost+' gray brick'+(sCost>1?'s':'')+' to add shield'}));
        broadcastState(); return;
      }
      const sMult = hasIH ? 1.5 : (P.cls==='warrior' ? 0.75 : 0.5);
      const sMax = Math.floor(sp.hpMax * sMult);
      if ((sp.armor||0) >= sMax) {
        ws.send(JSON.stringify({type:'error',msg:'Shield at maximum ('+sMax+')'}));
        broadcastState(); return;
      }
      sp.bricks.gray -= sCost;
      sp.armor = Math.min(sMax, (sp.armor||0) + sGain);
      log(`${sp.playerName||sp.name} +${sGain} shield (${sp.armor}/${sMax} max, cost ${sCost} gray)`,'action');
    }

    if (type === 'adjustArmor') {
      const ap = G.players[P.cls];
      const shieldMult2 = (P.cls==='warrior' && ap.skills && ap.skills.iron_hide) ? 1.5 : (P.cls==='warrior' ? 0.75 : 0.5);
      const maxShield2 = Math.floor(ap.hpMax * shieldMult2);
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

    // ── HEALING ──
    if (type === 'healPlayer') {
      const { healerCls, targetCls } = P;
      const healer = G.players[healerCls];
      if ((healer.bricks.white||0) < 1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 white brick'})); broadcastState(); return; }
      healer.bricks.white--;
      applyHeal(healerCls, targetCls, false);
    }
    if (type === 'massRepair') {
      const mender = G.players.mender;
      const cost = mender.skills.mass_surge ? 2 : 2;
      if ((mender.bricks.white||0) < cost) { ws.send(JSON.stringify({type:'error',msg:`Need ${cost} white bricks`})); broadcastState(); return; }
      mender.bricks.white -= cost;
      const amt = mender.skills.mass_surge ? rollRange(3,5) : 3;
      G.turnOrder.forEach(cls => {
        const p = G.players[cls];
        if(p.alive) { p.hp = Math.min(p.hpMax+3, p.hp+amt); }
      });
      log(`Mender Mass Repair: all players +${amt} HP`,'heal');
    }

    // ── REVIVAL ──
    if (type === 'revivePlayer') {
      const { healerCls, targetCls } = P;
      const healer = G.players[healerCls];
      const target = G.players[targetCls];
      const isMender = healerCls === 'mender';
      const purpleCost = isMender?1:2;
      const whiteCost  = isMender?1:2;
      if ((healer.bricks.purple||0)<purpleCost || (healer.bricks.white||0)<whiteCost) {
        ws.send(JSON.stringify({type:'error',msg:`Need ${purpleCost} purple + ${whiteCost} white`}));
        broadcastState(); return;
      }
      healer.bricks.purple -= purpleCost;
      healer.bricks.white  -= whiteCost;
      target.hp = isMender ? target.hpMax : Math.floor(target.hpMax/2);
      target.alive = true;
      target.statusEffects = target.statusEffects.filter(s=>s!=='down');
      log(`${healer.name} revived ${target.name} → ${target.hp} HP`,'heal');
    }

    // ── TRADING ──
    if (type === 'offerTrade') {
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
    if (type === 'unlockSkill') {
      const { cls, skillId, cost } = P;
      const p = G.players[cls];
      const canAfford = Object.entries(cost).every(([k,v])=>(p.bricks[k]||0)>=v);
      if (!canAfford) { ws.send(JSON.stringify({type:'error',msg:'Cannot afford skill'})); broadcastState(); return; }
      Object.entries(cost).forEach(([k,v])=>p.bricks[k]-=v);
      p.skills[skillId]=true;
      log((p.playerName||p.name)+' unlocked '+skillId,'skill');
      // Notify the player's own socket
      const skMsg = JSON.stringify({ type:'skillUnlocked', skillId, cls,
        playerName: p.playerName||p.name,
        skillName: skillId.replace(/_/g,' ')
      });
      clients.forEach((info, cws) => {
        if ((info.role===cls || info.role==='dm') && cws.readyState===1) {
          cws.send(skMsg);
        }
      });
    }

    // ── ENHANCED MOVEMENT ──
    if (type === 'activateEnhanced') {
      const { cls } = P;
      const p = G.players[cls];
      if ((p.bricks.purple||0)<1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 purple brick'})); broadcastState(); return; }
      p.bricks.purple--;
      const duration = roll(3); // d3
      G.enhancedMovement[cls] = duration;
      log((p.playerName||p.name)+' activated Enhanced Movement for '+duration+' turn(s)','action');
      // Notify both the player and broadcast to DM
      const enhMsg = JSON.stringify({ type:'enhancedResult', cls, duration, playerName:p.playerName||p.name });
      clients.forEach((info, cws) => { if(cws.readyState===1) cws.send(enhMsg); });
    }
    if (type === 'consumeEnhanced') {
      if (G.enhancedMovement[P.cls]) {
        G.enhancedMovement[P.cls]--;
        if (G.enhancedMovement[P.cls]<=0) delete G.enhancedMovement[P.cls];
      }
    }

    // ── GATES ──
    if (type === 'deconstructGate') {
      const { cls, gate } = P;
      const p = G.players[cls];
      if (cls!=='builder') { ws.send(JSON.stringify({type:'error',msg:'Only Builder can deconstruct'})); broadcastState(); return; }
      if ((p.bricks.gray||0)<2) { ws.send(JSON.stringify({type:'error',msg:'Need 2 gray bricks'})); broadcastState(); return; }
      p.bricks.gray -= 2;
      G.gates[gate] = 'open';
      log(`Builder deconstructed ${gate} gate`,'gate');
      // Scavenge roll
      if (p.skills.scavenge) {
        const r = roll(6);
        const recovered = r>=6?2:r>=4?1:0;
        if (recovered>0) { p.bricks.gray+=recovered; log(`Scavenge: recovered ${recovered} gray brick(s)! (roll ${r})`,'reward'); }
        else log(`Scavenge: no recovery (roll ${r})`,'action');
        ws.send(JSON.stringify({ type:'scavengeResult', roll:r, recovered }));
      }
    }
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
    if (type === 'rebuildBridge') {
      const p = G.players.builder;
      if ((p.bricks.gray||0)<4) { ws.send(JSON.stringify({type:'error',msg:'Need 4 gray bricks'})); broadcastState(); return; }
      p.bricks.gray -= 4;
      G.gates.z4z5 = 'open';
      log('Builder rebuilt the bridge!','gate');
    }
    if (type === 'setGate') { G.gates[P.gate] = P.status; log(`Gate ${P.gate} → ${P.status}`,'gate'); }
    if (type === 'collectKey') { G.magicKeys[P.keyColor]=P.cls; log(`${G.players[P.cls].name} claimed ${P.keyColor} key`,'key'); }
    if (type === 'useKey') {
      const { cls, gate, keyColor } = P;
      G.magicKeys[keyColor]=null;
      G.gates[gate]='open';
      log(`${G.players[cls].name} used ${keyColor} key → ${gate} open`,'gate');
    }

    // ── BUILDER SPECIAL ──
    if (type === 'blueprint') {
      const p = G.players.builder;
      if ((p.bricks.gray||0)<1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 gray brick'})); broadcastState(); return; }
      p.bricks.gray--;
      p.bricks[P.color] = (p.bricks[P.color]||0)+1;
      log(`Blueprint: duplicated 1 ${P.color} brick`,'action');
    }
    if (type === 'forge') {
      const p = G.players.builder;
      const { fromColor, toColor } = P;
      if ((p.bricks[fromColor]||0)<2) { ws.send(JSON.stringify({type:'error',msg:'Need 2 '+fromColor+' bricks'})); broadcastState(); return; }
      p.bricks[fromColor]-=2;
      p.bricks[toColor]=(p.bricks[toColor]||0)+1;
      log(`Forge: 2 ${fromColor} → 1 ${toColor}`,'action');
    }
    if (type === 'infiniteBlueprint') {
      const p = G.players.builder;
      if ((p.bricks.gray||0)<3) { ws.send(JSON.stringify({type:'error',msg:'Need 3 gray bricks'})); broadcastState(); return; }
      p.bricks.gray-=3;
      Object.keys(p.bricks).forEach(k=>{ p.bricks[k]*=2; });
      log('INFINITE BLUEPRINT: all bricks doubled!','action');
    }
    if (type === 'salvage') {
      // Builder claims monster loot + d3 bonus
      const p = G.players.builder;
      const bonus = roll(3);
      const colors = ['red','blue','green','gray','white','yellow','orange'];
      for(let i=0;i<bonus;i++) { const c=colors[Math.floor(Math.random()*colors.length)]; p.bricks[c]=(p.bricks[c]||0)+1; }
      log(`Salvage: Builder claims monster loot + ${bonus} bonus brick(s)!`,'reward');
    }
    if (type === 'wrecking_ball') {
      // Damage monster during deconstruct
      if (G.battle && G.battle.monsters[0]) {
        G.battle.monsters[0].hpCurrent = Math.max(0, G.battle.monsters[0].hpCurrent-2);
        log('Wrecking Ball: 2 bonus damage!','damage');
      }
    }

    // ── TAMING ──
    if (type === 'tameAttempt') {
      const { cls, monsterIdx } = P;
      const p = G.players[cls];
      const threshold = cls==='beastcaller' ? (p.skills.easy_tame?2:3) : 5;
      if ((p.bricks.green||0)<2) { ws.send(JSON.stringify({type:'error',msg:'Need 2 green bricks'})); broadcastState(); return; }
      p.bricks.green-=2;
      const r = roll(6);
      const success = r >= threshold;
      ws.send(JSON.stringify({ type:'tameResult', roll:r, success, threshold }));
      if (success && G.battle) {
        const mon = G.battle.monsters[monsterIdx];
        if (mon) {
          p.tamed = { name:mon.name, hp:mon.hpCurrent+2, hpMax:mon.hpMax+2, dmg:mon.dmg, armor:mon.armor };
          // Remove from battle monsters
          G.battle.monsters[monsterIdx].hpCurrent = 0;
          log(`${p.name} TAMED ${mon.name}!`,'action');
        }
      } else {
        log(`${p.name} tame failed (rolled ${r}, need ${threshold})`,'action');
      }
    }
    if (type === 'commandTamed') {
      const p = G.players[P.cls];
      if ((p.bricks.green||0)<1) { ws.send(JSON.stringify({type:'error',msg:'Need 1 green brick'})); broadcastState(); return; }
      p.bricks.green--;
      if (p.skills.beast_bond) {
        // +1 to roll
        const r = roll(6)+1;
        const bonus = p.skills.beast_bond ? 1 : 0;
        const dmg = r + (p.tamed?.armor||0 > 0 ? 0 : 0);
        if (G.battle && G.battle.monsters[0]) {
          G.battle.monsters[0].hpCurrent = Math.max(0, G.battle.monsters[0].hpCurrent - r);
          log(`${p.tamed?.name} attacks for ${r} damage! (beast bond +1)`,'damage');
        }
      } else {
        const tDmg = parseInt((p.tamed?.dmg||'d6').replace('d','').split('+')[0]);
        const r = roll(tDmg||6);
        if (G.battle && G.battle.monsters[P.monsterIdx||0]) {
          const mon = G.battle.monsters[P.monsterIdx||0];
          const net = Math.max(0,r-mon.armor);
          mon.hpCurrent = Math.max(0, mon.hpCurrent-net);
          log(`${p.tamed?.name} attacks ${mon.name} for ${net} damage`,'damage');
        }
      }
    }

    // ── BATTLE ──
    if (type === 'startBattle') {
      const { monsters, combatants, isBoss } = P;
      // Build initiative
      const init = combatants.map(cls=>({cls,roll:roll(6)})).sort((a,b)=>b.roll-a.roll);
      G.battle = {
        monsters: monsters.map(m=>({...m,hpCurrent:m.hp,confused:false,cursed:0,confuseRounds:0})),
        combatants, initiative:init,
        initIdx:0, monsterTurn:false,
        battleRound:1, isBoss,
        complication:null, traps:[],
        scoutDamageActive:false,
        phase1Complete:isBoss?false:null,
        lastAction:null,
      };
      // Ambush check
      monsters.forEach((m,i)=>{
        if(m.ambush && !isBoss) {
          const targets = combatants.map(c=>G.players[c]).filter(p=>p.alive);
          let tgt = m.target==='lowest' ? targets.reduce((a,b)=>b.hp<a.hp?b:a) : targets.reduce((a,b)=>b.hp>a.hp?b:a);
          const dmg = rollRange(1,6)+(parseInt((m.dmg||'d6').split('+')[1])||0);
          const ambushAbsorb = Math.min(tgt.armor||0, dmg);
          tgt.armor = Math.max(0, (tgt.armor||0) - ambushAbsorb);
          const net = Math.max(0,dmg-ambushAbsorb);
          tgt.hp=Math.max(0,tgt.hp-net); if(tgt.hp<=0)tgt.alive=false;
          log(`⚡ AMBUSH! ${m.name} → ${tgt.name}: −${net} HP${ambushAbsorb>0?' ('+ambushAbsorb+' blocked)':''}`,'damage');
        }
      });
      G.phase='battle';
      G.activeEvent = null; // clear landing event when battle begins
      log(`Battle: ${monsters.map(m=>m.name).join(' + ')}`,'battle');
    }
    if (type === 'rollAttack') {
      const { cls, monsterIdx, useSkill } = P;
      const p = G.players[cls];
      if (!G.battle) return;
      const mon = G.battle.monsters[monsterIdx];
      if (!mon || mon.hpCurrent<=0) return;

      const sides = parseInt(p.die.replace('d',''));
      let r = roll(sides);
      let dmg = r;
      let note = `d${sides}=${r}`;

      // Boss phase 2 — physical = 0
      if (G.battle.isBoss && G.battle.phase1Complete && !mon.blueOnly===false) {
        // If it's the core (blueOnly=true) and this is physical
        if (mon.blueOnly) { dmg=0; note='physical=0 (Phase 2)'; }
      }

      // Power Strike (Warrior)
      if (cls==='warrior' && p.skills.power_strike && r===sides) { dmg+=3; note+='+3 PowerStrike'; }
      // Cursed
      const curse = G.cursedPlayers[cls];
      if (curse) { dmg=Math.max(0,dmg-curse.penalty); note+=`−${curse.penalty}curse`; delete G.cursedPlayers[cls]; p.statusEffects=p.statusEffects.filter(s=>s!=='cursed'); }

      const net = Math.max(0, dmg-(mon.armor||0));
      mon.hpCurrent = Math.max(0, mon.hpCurrent-net);
      log(`${p.name} ${note} → −${net} HP on ${mon.name} (${mon.hpCurrent}/${mon.hpMax})`,'damage');

      // Bloodlust (Beastcaller)
      if (cls==='beastcaller' && p.skills.bloodlust && p.tamed && mon.hpCurrent<=0) {
        // Find next living monster
        const next = G.battle.monsters.find(m=>m.hpCurrent>0);
        if(next) { const bd=roll(6); next.hpCurrent=Math.max(0,next.hpCurrent-bd); log(`Bloodlust: ${p.tamed.name} hits ${next.name} for ${bd}!`,'damage'); }
      }

      ws.send(JSON.stringify({ type:'attackResult', roll:r, dmg, net, note }));
      G.battle.lastAction = { cls, icon:'⚔️', description:(p.playerName||p.name)+' attacked '+mon.name+' for '+net+' damage (rolled '+r+')', color:p.color };
      G.battle.initIdx++;
    }
    if (type === 'useBrickInBattle') {
      const { cls, brickColor, monsterIdx } = P;
      const p = G.players[cls];
      if ((p.bricks[brickColor]||0)<1) { ws.send(JSON.stringify({type:'error',msg:'No '+brickColor+' bricks'})); broadcastState(); return; }
      p.bricks[brickColor]--;

      const mon = G.battle?.monsters[monsterIdx||0];
      let result = { type:'brickResult', color:brickColor, effect:'', dmg:0 };

      if (brickColor==='red') {
        const range = cls==='warrior' ? '3-5' : '1-3';
        const dmg = cls==='warrior' ? rollRange(3,5) : rollRange(1,3);
        if(mon){mon.hpCurrent=Math.max(0,mon.hpCurrent-dmg);} result.dmg=dmg; result.range=range; result.effect=`${dmg} armor-ignoring damage`;
        log(`${p.name} red brick: ${dmg} damage (ignores armor)`,'damage');
        G.battle.lastAction = { cls, icon:'🔴', description:(p.playerName||p.name)+' used RED BRICK — '+dmg+' armor-ignoring damage on '+mon?.name, color:'#D01012' };
      }
      if (brickColor==='blue') {
        const range = cls==='wizard' ? '4-8' : '3';
        const base = cls==='wizard' ? rollRange(4,8) : 3;
        if(mon){mon.hpCurrent=Math.max(0,mon.hpCurrent-base);} result.dmg=base; result.range=range; result.effect=`${base} magic damage (ignores armor)`;
        log(`${p.name} blue brick: ${base} magic damage`,'damage');
        G.battle.lastAction = { cls, icon:'🔵', description:(p.playerName||p.name)+' used BLUE BRICK — '+base+' magic damage (ignores armor) on '+mon?.name, color:'#006DB7' };
      }
      if (brickColor==='white') {
        const isSelf = !P.targetCls || P.targetCls===cls;
        const tgtCls = P.targetCls||cls;
        applyHeal(cls,tgtCls,true); result.effect='heal used';
      }
      if (brickColor==='gray') {
        // Iron Hide warrior: 1 gray = +2 shield. Builder: 1 gray = +1. Others: 2 gray = +1.
        const hasIronHide = cls==='warrior' && p.skills && p.skills.iron_hide;
        const grayNeeded = (cls==='warrior'||cls==='builder') ? 1 : 2;
        const shieldGain = hasIronHide ? 2 : 1;
        if (grayNeeded === 2 && (p.bricks.gray||0) < 1) {
          ws.send(JSON.stringify({type:'error',msg:'Need 2 gray bricks to add shield'})); broadcastState(); return;
        }
        if (grayNeeded === 2) {
          p.bricks.gray = Math.max(0, (p.bricks.gray||0) - 1);
        }
        const shieldMult = hasIronHide ? 1.5 : (cls==='warrior' ? 0.75 : 0.5);
        const maxShield = Math.floor(p.hpMax * shieldMult);
        if ((p.armor||0) >= maxShield) {
          result.effect = 'Shield at maximum (' + maxShield + ')';
          log(`${p.name} shield already at max (${maxShield})`,'action');
        } else {
          p.armor = Math.min(maxShield, (p.armor||0) + shieldGain);
          result.effect = '+' + shieldGain + ' shield ('+p.armor+'/'+maxShield+' max)';
          log(`${p.name} +${shieldGain} shield (${p.armor}/${maxShield} max)`,'action');
        }
      }
      if (brickColor==='purple') {
        const dmg=rollRange(3,5); const heal=rollRange(2,3);
        const wizDmg=cls==='wizard'?rollRange(4,8):dmg;
        const purpleRange = cls==='wizard' ? '4-8 dmg + 2-3 HP' : '3-5 dmg + 2-3 HP';
        if(mon){mon.hpCurrent=Math.max(0,mon.hpCurrent-wizDmg);}
        p.hp=Math.min(p.hpMax+3,p.hp+heal); result.dmg=wizDmg; result.heal=heal; result.range=purpleRange; result.effect=`${wizDmg} damage + ${heal} HP self`;
        log(`${p.name} purple brick: ${wizDmg} dmg + ${heal} HP`,'action');
        G.battle.lastAction = { cls, icon:'🟣', description:(p.playerName||p.name)+' used PURPLE BRICK — '+wizDmg+' dmg + '+heal+' HP healed', color:'#7B2FBE' };
      }
      if (brickColor==='yellow') {
        if(mon){ mon.confused=true; mon.confuseRounds=1;
          if(cls==='scout'){ G.battle.scoutDamageActive=true; }
          if(cls==='beastcaller'){ mon.slowedAttack=true; }
        }
        result.effect='monster confused (guaranteed 1 round, then DM rolls)';
        log(`${p.name} yellow brick: ${mon?.name} confused`,'action');
        G.battle.lastAction = { cls, icon:'🟡', description:(p.playerName||p.name)+' used YELLOW BRICK — '+mon?.name+' is CONFUSED! Skips next attack.', color:'#F5D000' };
      }
      if (brickColor==='orange') {
        // Set battle trap
        const trapDmg = cls==='scout'?rollRange(2,4):rollRange(1,2);
        if(!G.battle.traps)G.battle.traps=[];
        G.battle.traps.push({active:true,setBy:cls,dmg:trapDmg});
        if(mon){mon.hpCurrent=Math.max(0,mon.hpCurrent-trapDmg);}
        result.effect=`Trap set! Fires ${trapDmg} dmg immediately, persists on odd rolls`;
        log(`${p.name} orange brick: trap set (${trapDmg} dmg)`,'action');
      }
      if (brickColor==='black') {
        const pen=cls==='wizard'?rollRange(3,4):2;
        if(mon){mon.cursed=(mon.cursed||0)+pen;}
        result.effect=`Monster cursed −${pen} per attack, persists until even roll`;
        log(`${p.name} black brick: monster cursed −${pen}`,'action');
        G.battle.lastAction = { cls, icon:'⬛', description:(p.playerName||p.name)+' used BLACK BRICK — '+mon?.name+' cursed, -'+pen+' per attack', color:'#555' };
      }

      ws.send(JSON.stringify(result));
    }
    if (type === 'catapult') {
      const p = G.players.builder;
      if ((p.bricks.gray||0)<2) { ws.send(JSON.stringify({type:'error',msg:'Need 2 gray bricks'})); broadcastState(); return; }
      p.bricks.gray-=2;
      const dmg=rollRange(6,8);
      const mon=G.battle?.monsters[P.monsterIdx||0];
      if(mon){mon.hpCurrent=Math.max(0,mon.hpCurrent-dmg);}
      log(`Catapult: ${dmg} damage ignoring armor!`,'damage');
      ws.send(JSON.stringify({type:'catapultResult',dmg}));
    }
    if (type === 'monsterAttack') {
      const { monsterIdx } = P;
      if(!G.battle) return;
      const mon = G.battle.monsters[monsterIdx];
      if(!mon||mon.hpCurrent<=0) return;
      // Confusion check (after first guaranteed round)
      if(mon.confused && mon.confuseRounds>0) {
        const r=roll(6);
        if(r>=5){ mon.confused=false; mon.confuseRounds=0;
          if(G.battle.scoutDamageActive) G.battle.scoutDamageActive=false;
          log(`${mon.name} confusion dispelled (rolled ${r})`,'action');
        } else {
          // Check Beastcaller slow
          if(mon.slowedAttack){ log(`${mon.name} confused & slowed — skips attack`,'action'); G.battle.initIdx++; broadcastState(); return; }
          log(`${mon.name} still confused — skips attack (rolled ${r})`,'action');
          G.battle.initIdx++; broadcastState(); return;
        }
      }
      mon.confuseRounds++;

      // Determine target
      const alive = G.battle.combatants.map(c=>G.players[c]).filter(p=>p.alive);
      let tgt;
      if(mon.target==='highest') tgt=alive.reduce((a,b)=>b.hp>a.hp?b:a);
      else if(mon.target==='lowest') tgt=alive.reduce((a,b)=>b.hp<a.hp?b:a);
      else tgt=alive[Math.floor(Math.random()*alive.length)];
      if(!tgt) { G.battle.initIdx++; broadcastState(); return; }

      const parts = (mon.dmg||'d6').split('+');
      const sides = parseInt(parts[0].replace('d',''));
      const bonus = parseInt(parts[1]||0);
      let r=roll(sides)+bonus;
      const mCurse=mon.cursed||0;
      if(mCurse>0){ r=Math.max(0,r-mCurse);
        const mRoll=roll(6);
        if(mRoll%2===0){ mon.cursed=0; log(`${mon.name} curse cleared (even roll)`,'action'); }
      }
      // Each armor point absorbs 1 damage and is consumed — iron_hide affects pip gain not absorption
      const armorAbsorb = Math.min(tgt.armor||0, r);
      tgt.armor = Math.max(0, (tgt.armor||0) - armorAbsorb);
      const net=Math.max(0,r-armorAbsorb);
      tgt.hp=Math.max(0,tgt.hp-net); if(tgt.hp<=0)tgt.alive=false;

      // Scout damage during confusion
      if(G.battle.scoutDamageActive&&cls==='scout') { /* applied per-turn by scout */ }

      log(`${mon.name} → ${tgt.name}: −${net} HP (${tgt.hp}/${tgt.hpMax})`,'damage');
      // Broadcast to ALL so every player's battle log gets the monster action
      const monAtkMsg = JSON.stringify({ type:'monsterAttackResult', monsterName:mon.name, targetCls:tgt.cls, targetName:(tgt.playerName||tgt.name), roll:r, net, armorAbsorbed:armorAbsorb });
      clients.forEach((info, cws) => { if(cws.readyState===1) cws.send(monAtkMsg); });
      G.battle.initIdx++;
    }
    if (type === 'advanceBattleTurn') { G.battle && G.battle.initIdx++; }
    if (type === 'nextBattleRound') {
      if(!G.battle) return;
      G.battle.battleRound++;
      G.battle.initIdx=0;
      G.battle.monsterTurn=false;
      // End of battle round poison
      if(G.battle.complication==='poison') {
        G.battle.combatants.forEach(cls=>{
          const p=G.players[cls];
          if(p.alive){p.hp=Math.max(0,p.hp-1);if(p.hp<=0)p.alive=false;log(`${p.name} poison −1`,'damage');}
        });
      }
      log(`--- Battle round ${G.battle.battleRound} ---`,'battle');
    }
    if (type === 'setComplication') {
      if(G.battle) G.battle.complication=P.complication;
      log(`Complication: ${P.complication}`,'battle');
    }
    if (type === 'bossPhase2') {
      if(G.battle) { G.battle.phase1Complete=true; log('PHASE 2 — BLACK CORE!','battle'); }
    }
    if (type === 'monsterHPDelta') {
      const { monsterIdx, delta } = P;
      if (G.battle && G.battle.monsters[monsterIdx]) {
        const mon = G.battle.monsters[monsterIdx];
        mon.hpCurrent = Math.max(0, Math.min(mon.hpMax, mon.hpCurrent + delta));
        if (delta < 0) log(`${mon.name} ${delta} HP → ${mon.hpCurrent}/${mon.hpMax}`, 'damage');
        else log(`${mon.name} +${delta} HP → ${mon.hpCurrent}/${mon.hpMax}`, 'heal');
      }
    }
    if (type === 'endBattle') {
      if (!G.battle) { broadcastState(); return; }
      const loot = { gold:0, bricks:[] };
      G.battle.monsters.forEach(m => {
        if (m.hpCurrent <= 0) {
          loot.gold += (m.loot && m.loot.gold) ? m.loot.gold : 0;
          if (m.loot && m.loot.bricks) loot.bricks.push(...m.loot.bricks);
        }
      });
      const combatants = G.battle.combatants || [];
      // Distribute loot to all combatants immediately
      combatants.forEach(cls => {
        const p = G.players[cls];
        if (!p) return;
        p.gold += loot.gold;
        loot.bricks.forEach(b => { p.bricks[b] = (p.bricks[b]||0)+1; });
      });
      log('Battle won! Loot: +'+loot.gold+'G + ['+loot.bricks.join(', ')+'] to '+combatants.join(', '),'reward');
      // Store result for player victory screens — battle clears, turn advances when all resolve
      G.battleResult = { loot, combatants, resolvedBy:[] };
      G.battle = null;
    }
    if (type === 'collectLoot') { broadcastState(); return; }
    if (type === 'resolveBattleResult') {
      // Player clicked Continue on their victory screen
      if (!G.battleResult) { broadcastState(); return; }
      const { cls } = P;
      if (!G.battleResult.resolvedBy.includes(cls)) G.battleResult.resolvedBy.push(cls);
      const allDone = G.battleResult.combatants.every(c => G.battleResult.resolvedBy.includes(c));
      if (allDone) {
        G.battleResult = null;
        G.phase = 'trade';
        G.activePlayerIdx = (G.activePlayerIdx + 1) % G.turnOrder.length;
        log('All players acknowledged — next turn begins','normal');
      }
    }
    if (type === 'resolveBattle') {
      // DM force-resolves — skips waiting for players
      G.battleResult = null;
      if (G.battle) G.battle = null;
      G.phase = 'trade';
      G.activePlayerIdx = (G.activePlayerIdx + 1) % G.turnOrder.length;
      log('Battle resolved by DM','normal');
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
  console.log(`  All Players:  http://${ip}:${PORT}/players.html\n`);
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
