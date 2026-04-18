// ═══════════════════════════════════════════════════════════
//  BRICK QUEST — Shared Game Constants v2.0
// ═══════════════════════════════════════════════════════════

const BRICK_COLORS = {
  red:'#D01012', blue:'#006DB7', green:'#237841', white:'#EFEFEF',
  gray:'#AAAAAA', purple:'#7B2FBE', yellow:'#F5D000',
  orange:'#F57C00', black:'#333333'
};
const BRICK_NAMES = Object.keys(BRICK_COLORS);

const PLAYER_META = {
  warrior:     { name:'Warrior',     icon:'⚔️', color:'#993C1D', hp:12, die:'d8', weight:'heavy', dashBreakChance:1.00, dashBreakDmg:[0,3], dashDmgAlwaysRolls:false },
  wizard:      { name:'Wizard',      icon:'🔮', color:'#3C3489', hp:8,  die:'d6', weight:'light', dashBreakChance:0.15, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  scout:       { name:'Scout',       icon:'🏃', color:'#085041', hp:10, die:'d6', weight:'light', dashBreakChance:0.35, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  builder:     { name:'Builder',     icon:'🔧', color:'#854F0B', hp:10, die:'d6', weight:'heavy', dashBreakChance:1.00, dashBreakDmg:[0,3], dashDmgAlwaysRolls:false },
  mender:      { name:'Mender',      icon:'💊', color:'#72243E', hp:10, die:'d4', weight:'mid',   dashBreakChance:0.50, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  beastcaller: { name:'Beastcaller', icon:'🐾', color:'#27500A', hp:10, die:'d6', weight:'light', dashBreakChance:0.35, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
};

// Flavor text per class for dash gate-break outcomes
const DASH_FLAVOR = {
  warrior: {
    success: 'Shoulder first! The gate shatters like kindling.',
    fail:    'The gate holds. Impossible.',
  },
  builder: {
    success: 'Iron boot meets brittle wood. The gate folds inward.',
    fail:    'The hinges refuse. That\'s not how I built them.',
  },
  mender: {
    success: 'Faster than expected! The gate cracks under the charge.',
    fail:    'The gate absorbs the blow. Mender falls back, winded.',
  },
  scout: {
    success: 'Shoulder-rolled through the splinters.',
    fail:    'Bounced off. That\'s going to leave a mark.',
  },
  beastcaller: {
    success: 'The totem hums, the gate yields.',
    fail:    'The spirits decline this battle. The gate remains.',
  },
  wizard: {
    success: 'Somehow... the gate gives way. A minor miracle.',
    fail:    'Why did I think these frail wrists could handle that?',
  },
};

const SELF_HEAL_AMT  = { mender:4, warrior:3, builder:3, scout:2, wizard:2, beastcaller:2 };
// Shield (armor) rules:
// Warrior+Builder: 1 gray = +1 shield (free). Others: 2 gray = +1 shield.
// Max shield: Warrior base 75% hpMax, with Iron Hide 150% hpMax. All others 50% hpMax. Builder 50%.
const SHIELD_MAX = {
  warrior:     { base: 0.75, upgraded: 1.5, upgradeSkill: 'iron_hide' },
  builder:     { base: 0.50, upgraded: 0.50 },
  wizard:      { base: 0.50, upgraded: 0.50 },
  scout:       { base: 0.50, upgraded: 0.50 },
  mender:      { base: 0.50, upgraded: 0.50 },
  beastcaller: { base: 0.50, upgraded: 0.50 },
};
const SHIELD_COST = {
  warrior: 1, builder: 1,    // 1 gray per shield
  wizard: 2, scout: 2, mender: 2, beastcaller: 2  // 2 gray per shield
};
const ALLY_HEAL_AMT  = { mender:4 }; // everyone else = 2

// ── ZONES & SPACES ───────────────────────────────────────
// Zone 1: 8 spaces, store at idx 3 (space 4)
// Zone 2: 8 spaces
// Zone 3: 10 spaces, store at idx 4 (space 5)
// Zone 4: 10 spaces, merchant boat (store everywhere)
// Zone 5: 2 spaces, boss
const ZONES = [
  { name:'Zone 1', sub:'Courtyard',     icon:'🏰', tier:1, spaces:8,  storeAt:3 },
  { name:'Zone 2', sub:'Corridor',      icon:'🌑', tier:2, spaces:8,  storeAt:null },
  { name:'Zone 3', sub:'Guard Post',    icon:'👺', tier:3, spaces:10, storeAt:4 },
  { name:'Zone 4', sub:'Flood Chamber', icon:'🌊', tier:4, spaces:10, storeAt:'anywhere' },
  { name:'Zone 5', sub:'Throne Room',   icon:'💀', tier:5, spaces:2,  storeAt:null },
];

// Build flat space array
const SPACES = [];
let _si = 0;
ZONES.forEach((z,zi)=>{
  for(let s=0;s<z.spaces;s++){
    SPACES.push({
      idx:_si, zone:zi, zIdx:s,
      label:`${z.name}-${s+1}`,
      isStore: z.storeAt===s || z.storeAt==='anywhere',
      isBoss: zi===4,
      gateAfter: s===z.spaces-1 && zi<4, // last space of each non-final zone
    });
    _si++;
  }
});

// Gate index: space index of gate entrance per zone boundary
const GATE_SPACES = {
  z1z2: ZONES[0].spaces - 1,
  z2z3: ZONES[0].spaces + ZONES[1].spaces - 1,
  z3z4: ZONES[0].spaces + ZONES[1].spaces + ZONES[2].spaces - 1,
  z4z5: ZONES[0].spaces + ZONES[1].spaces + ZONES[2].spaces + ZONES[3].spaces - 1,
};

// Gate traversal rules — which gates can be forced vs which require a key
// 'forceable' = can be broken open via forceGate (or dash-through in future)
// 'key'       = requires a magical/colored key to open; cannot be forced
const GATE_RULES = {
  z1z2:   'forceable',
  z2z3:   'key',
  z3z4:   'forceable',
  z4z5:   'key',
  z5boss: 'forceable',
};

// ── LANDING EVENT TABLES ─────────────────────────────────
// roll: 1-6, type determines what DM places
const LANDING_EVENTS = {
  1: [ // Zone 1 — Courtyard
    { roll:1, type:'nothing',   icon:'💨', name:'Nothing',      desc:'The courtyard is still.' },
    { roll:2, type:'nothing',   icon:'💨', name:'Nothing',      desc:'All clear.' },
    { roll:3, type:'gold',      icon:'🪙', name:'Found Gold',   desc:'A coin among the rubble.', amount:1 },
    { roll:4, type:'gray',      icon:null, name:'Gray Brick',   desc:'Rubble and scrap metal. Take it or search for more.', color:'gray' },
    { roll:5, type:'monster',   icon:'👺', name:'Goblin Scout', desc:'A goblin leaps out!', mids:['goblin'] },
    { roll:6, type:'riddle',    icon:null, name:'Clue Found!',  desc:'A yellow brick with a card beneath it.', zoneRiddlePool:0 },
  ],
  2: [ // Zone 2 — Corridor
    { roll:1, type:'trap',      icon:null, name:'Trap!',         desc:'An orange brick snaps into place beneath your feet.' },
    { roll:2, type:'nothing',   icon:'💨', name:'Nothing',       desc:'The corridor is empty.' },
    { roll:3, type:'gold',      icon:'🪙', name:'Found Gold',    desc:'Coins scattered on the floor.', amount:2 },
    { roll:4, type:'blue',      icon:null, name:'Blue Brick',    desc:'A magical residue crystallized into brick form.', color:'blue' },
    { roll:5, type:'monster',   icon:'💀', name:'Skeleton Guard',desc:'Bones rattle to life!', mids:['skeleton'] },
    { roll:6, type:'riddle',    icon:null, name:'Clue Found!',   desc:'A yellow brick resting against the wall.', zoneRiddlePool:1 },
  ],
  3: [ // Zone 3 — Guard Post
    { roll:1, type:'monster',   icon:'👺', name:'Goblin Pair',   desc:'Two goblins on patrol!', mids:['goblin','goblin'] },
    { roll:2, type:'trap',      icon:null, name:'Trap!',         desc:'A hidden pressure plate fires.' },
    { roll:3, type:'gold',      icon:'🪙', name:'Found Gold',    desc:'A goblin dropped its purse.', amount:1 },
    { roll:4, type:'monster',   icon:'🐺', name:'Shadow Wolf',   desc:'A wolf lunges from the shadows!', mids:['wolf'] },
    { roll:5, type:'riddle',    icon:null, name:'Clue Found!',   desc:'A yellow brick on the elevated platform.', zoneRiddlePool:2 },
    { roll:6, type:'creeper',   icon:'🌿', name:'Creeping Vines!',desc:'Vines surge across the path — cut them in time!' },
  ],
  4: [ // Zone 4 — Flood Chamber
    { roll:1, type:'monster',   icon:'🧌', name:'Stone Troll',   desc:'A massive troll blocks the path.', mids:['troll'] },
    { roll:2, type:'doubletrap',icon:null, name:'Double Trap!',  desc:'Two orange bricks snap into place!' },
    { roll:3, type:'gold',      icon:'🪙', name:'Found Gold',    desc:'A waterlogged chest.', amount:3 },
    { roll:4, type:'monster',   icon:'💀', name:'Knight + Goblin',desc:'A cursed knight with a goblin lackey!', mids:['knight','goblin'] },
    { roll:5, type:'purple',    icon:null, name:'Purple Brick',  desc:'A rare fragment — but it\'s locked. Answer a LEGO question to claim it.', color:'purple' },
    { roll:6, type:'monster',   icon:'👻', name:'Void Wraith',   desc:'A wraith materializes — AMBUSH!', mids:['wraith'] },
  ],
  5: [ // Zone 5 — Throne Room (boss always)
    { roll:1, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
    { roll:2, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
    { roll:3, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
    { roll:4, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
    { roll:5, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
    { roll:6, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!' },
  ],
};


// ── STORE PRICES ─────────────────────────────────────────
const STORE_PRICES = {
  red:1, gray:1, green:1,
  blue:2, white:2, yellow:2, orange:2,
  purple:3, black:3
};

// ── LEGO TRIVIA ───────────────────────────────────────────
const LEGO_TRIVIA = [
  { q:"What year was LEGO founded?",                              a:"1932",        diff:"easy"   },
  { q:"What does LEGO mean in Danish?",                          a:"play well",   diff:"easy"   },
  { q:"What color was the first LEGO brick?",                    a:"red",         diff:"easy"   },
  { q:"How many studs does a standard 2×4 LEGO brick have?",    a:"8",           diff:"easy"   },
  { q:"What country is LEGO headquartered in?",                  a:"denmark",     diff:"easy"   },
  { q:"What year did LEGO Mindstorms launch?",                   a:"1998",        diff:"medium" },
  { q:"What was the first licensed LEGO theme?",                 a:"star wars",   diff:"medium" },
  { q:"In what decade did LEGO minifigures first appear?",       a:"1970s",       diff:"medium" },
  { q:"What material are LEGO bricks made from?",                a:"abs plastic", diff:"medium" },
  { q:"How many LEGO sets are sold per second worldwide (approx)?", a:"7",        diff:"medium" },
  { q:"How many possible combinations exist with 6 standard 2×4 LEGO bricks?", a:"915 million", diff:"hard" },
  { q:"What is the clutch power of a LEGO stud in Newtons?",    a:"4.4",         diff:"hard"   },
  { q:"Approximately how many LEGO pieces are produced each year?", a:"36 billion", diff:"hard" },
];

// ── RIDDLES ───────────────────────────────────────────────
// ── ZONE-SPECIFIC CLUES ─────────────────────────────────
// Each clue teaches zone-relevant tactics. clueZone matches ZONES index (0-4).
const RIDDLES = [
  // Zone 1 — Courtyard
  {
    q: "The more you take, the more you leave behind. What am I?",
    a: "footsteps",
    zone: 0,
    clue: "GATE AHEAD: The Builder can deconstruct the Zone 1→2 gate using their Deconstruct skill — no damage taken. Others can force it open (roll 5+) but take 2 damage trying. Let Builder lead.",
    category: "Zone Progression"
  },
  {
    q: "I speak without a mouth and hear without ears. I have no body but I come alive with wind. What am I?",
    a: "an echo",
    zone: 0,
    clue: "BRICKS MATTER: Red bricks deal damage ignoring armor. Gray bricks add shield. White bricks heal. Purple bricks deal damage AND heal you. Yellow bricks confuse monsters — they skip their next attack.",
    category: "Core Mechanics"
  },
  {
    q: "The more you have of it, the less you see. What is it?",
    a: "darkness",
    zone: 0,
    clue: "SHIELD UP: Warrior and Builder stack shields efficiently (1 gray = 1 shield). All others need 2 gray bricks per shield. Max shields = 50% of your HP. Get shields before fighting.",
    category: "Combat Tips"
  },
  // Zone 2 — Corridor
  {
    q: "I have cities but no houses, mountains but no trees, water but no fish. What am I?",
    a: "a map",
    zone: 1,
    clue: "MAGIC GATE AHEAD: The Zone 2→3 gate is sealed by magic. The Skeleton Guard in this zone carries the Blue Key. Defeat it to claim the key — then any player can unlock the gate.",
    category: "Zone Progression"
  },
  {
    q: "What gets wetter the more it dries?",
    a: "a towel",
    zone: 1,
    clue: "WIZARD POWER: Stock up on blue and purple bricks now. In the Phase 2 boss fight, ONLY magic bricks deal damage. The Wizard's blue brick hits 4-8 ignoring armor — the hardest single hit in the game.",
    category: "Boss Preparation"
  },
  {
    q: "What has hands but cannot clap?",
    a: "a clock",
    zone: 1,
    clue: "MENDER IS VITAL: Mender heals 4 HP per white brick — double everyone else. In battle, Mender can revive fallen players using 1 purple + 1 white brick. Keep Mender near the back of initiative order.",
    category: "Party Tips"
  },
  // Zone 3 — Guard Post
  {
    q: "The man who made it doesn't need it. The man who bought it doesn't want it. The man who uses it doesn't know it. What is it?",
    a: "a coffin",
    zone: 2,
    clue: "GATE AHEAD: Zone 3→4 is a structural gate. Builder can dismantle it free. Others must force it (roll 5+, take 2 damage). A Warrior with Fortress Stance gains +3 shield before attempting — worth doing first.",
    category: "Zone Progression"
  },
  {
    q: "What has one eye but cannot see?",
    a: "a needle",
    zone: 2,
    clue: "BEASTCALLER SECRET: Tamed monsters fight alongside you every turn for 1 green brick. A tamed Shadow Wolf or Stone Troll hits with its full stats. Easy Tame skill lowers the capture roll from 3+ to 2+.",
    category: "Class Tips"
  },
  {
    q: "What can run but never walks, has a mouth but never talks, has a head but never weeps?",
    a: "a river",
    zone: 2,
    clue: "SCOUT ADVANTAGE: Scout gets +1 to every movement roll automatically. Orange battle traps deal 2-4 damage (others do 1-2). Scout also finds bricks on 3+ while searching in battle — others need 5+.",
    category: "Class Tips"
  },
  // Zone 4 — Flood Chamber
  {
    q: "What word becomes shorter when you add two letters to it?",
    a: "short",
    zone: 3,
    clue: "BRIDGE AHEAD: The Zone 4→5 bridge is destroyed. ONLY the Builder can rebuild it — costs 4 gray bricks. Trade gray bricks to Builder now. No one else can advance until the bridge is rebuilt.",
    category: "Zone Progression"
  },
  {
    q: "Feed me and I live. Give me water and I die. What am I?",
    a: "fire",
    zone: 3,
    clue: "BOSS PHASE 1: The Colossus Shell has 28 HP and 3 armor. Physical attacks work in Phase 1 — use them freely. Save all blue, purple, and yellow bricks for Phase 2 when only magic deals damage.",
    category: "Boss Preparation"
  },
  {
    q: "I have a head and a tail but no body. What am I?",
    a: "a coin",
    zone: 3,
    clue: "WINNING COMBO: In Phase 2, use yellow brick to confuse the boss (skips attack), then Wizard hits with blue for 4-8 magic damage. Confused boss cannot retaliate. Chain this with Mender healing between rounds.",
    category: "Boss Preparation"
  },
  // Zone 5 — Throne Room
  {
    q: "I am always hungry and must always be fed. The finger I touch will soon turn red. What am I?",
    a: "fire",
    zone: 4,
    clue: "PHASE 2 WARNING: When the Shell's HP hits 0, the Void Core emerges. It has 3 armor and is immune to ALL physical damage. Only blue bricks, purple bricks, and yellow bricks can harm it. Hoard these now.",
    category: "Boss Warning"
  },
];

const CHALLENGES = [
  "First to stack 5 bricks end-on-end with ONE hand wins!",
  "Rock Paper Scissors — best of 3 against the DM!",
  "Guess the DM's number (1–10). Closest wins!",
  "First to name 3 brick colors without looking at the supply!",
  "Thumb war with the player on your LEFT — winner claims the brick!",
];

// ── CLIENT CLASS ─────────────────────────────────────────
class GameClient {
  constructor(role) {
    this.role = role;
    this.state = null;
    this.handlers = [];
    this._connect();
  }
  _connect() {
    const host = location.hostname;
    const port = location.port || 8080;
    this.ws = new WebSocket(`ws://${host}:${port}?role=${this.role}`);
    this.ws.onopen    = () => this._emit('connected');
    this.ws.onmessage = e => { const m=JSON.parse(e.data); if(m.type==='state'){this.state=m.state;this._emit('state',m.state);} else this._emit(m.type,m); };
    this.ws.onclose   = () => { this._emit('disconnected'); setTimeout(()=>this._connect(),2000); };
    this.ws.onerror   = () => this.ws.close();
  }
  send(type,payload={}) { if(this.ws.readyState===1) this.ws.send(JSON.stringify({type,payload})); }
  on(fn) { this.handlers.push(fn); }
  _emit(event,data) { this.handlers.forEach(h=>h(event,data)); }

  // Convenience
  nextTurn()                        { this.send('nextTurn'); }
  setPhase(p)                       { this.send('setPhase',{phase:p}); }
  adjustHP(cls,amount)              { this.send('adjustHP',{cls,amount}); }
  adjustBrick(cls,color,amount)     { this.send('adjustBrick',{cls,color,amount}); }
  purchaseBrick(cls,color)          { this.send('purchaseBrick',{cls,color}); }
  adjustGold(cls,amount)            { this.send('adjustGold',{cls,amount}); }
  adjustArmor(cls,amount)           { this.send('adjustArmor',{cls,amount}); }
  offerTrade(fromCls,toCls,wantBricks,offerBricks,offerGold) { this.send('offerTrade',{fromCls,toCls,wantBricks,offerBricks,offerGold}); }
  respondTrade(id,accept)           { this.send('respondTrade',{id,accept}); }
  setGate(gate,status)              { this.send('setGate',{gate,status}); }
  forceGate(cls,gate)               { this.send('forceGate',{cls,gate}); }
  collectKey(color,cls)             { this.send('collectKey',{keyColor:color,cls}); }
  useKey(cls,gate,color)            { this.send('useKey',{cls,gate,keyColor:color}); }
  landingRoll(cls,roll,zone)        { this.send('landingRoll',{cls,roll,zone}); }
  resolveEvent(cls,eventType,data)  { this.send('resolveEvent',{cls,eventType,data}); }
  startRiddle(cls)                  { this.send('startRiddle',{cls}); }
  riddleAnswer(cls,answer)          { this.send('riddleAnswer',{cls,answer}); }
  dmMovePlayer(cls,roll,destination){ this.send('dmMovePlayer',{cls,roll,destination}); }
  addLog(text,kind)                 { this.send('addLog',{text,kind}); }
  resetGame()                       { this.send('resetGame'); }
  disarmTrap(cls,spaceIdx)          { this.send('disarmTrap',{cls,spaceIdx}); }
  triggerTrap(cls,spaceIdx)         { this.send('triggerTrap',{cls,spaceIdx}); }
  removeFortressBrick()             { this.send('removeFortressBrick'); }
  rescueVillager()                  { this.send('rescueVillager'); }

  // ── LEGACY STUBS ──
  // Kept as no-ops so orphaned UI paths (dead code tied to removed turn-based
  // battle + skills) don't throw if they fire. Remove after full UI cleanup.
  _legacy(name) { console.warn('[legacy no-op]', name); }
  unlockSkill()       { this._legacy('unlockSkill'); }
  healPlayer()        { this._legacy('healPlayer'); }
  revivePlayer()      { this._legacy('revivePlayer'); }
  massRepair()        { this._legacy('massRepair'); }
  tameAttempt()       { this._legacy('tameAttempt'); }
  commandTamed()      { this._legacy('commandTamed'); }
  rollAttack()        { this._legacy('rollAttack'); }
  useBrick()          { this._legacy('useBrick'); }
  catapult()          { this._legacy('catapult'); }
  startBattle()       { this._legacy('startBattle'); }
  endBattle()         { this._legacy('endBattle'); }
  monsterAttack()     { this._legacy('monsterAttack'); }
  nextBattleRound()   { this._legacy('nextBattleRound'); }
  setComplication()   { this._legacy('setComplication'); }
  bossPhase2()        { this._legacy('bossPhase2'); }
  deconstructGate()   { this._legacy('deconstructGate'); }
  rebuildBridge()     { this._legacy('rebuildBridge'); }
  blueprint()         { this._legacy('blueprint'); }
  forge()             { this._legacy('forge'); }
  salvage()           { this._legacy('salvage'); }
  activateEnhanced()  { this._legacy('activateEnhanced'); }
  addShield()         { this._legacy('addShield'); }
}

// ── UTILITY ───────────────────────────────────────────────
function roll(sides)             { return Math.floor(Math.random()*sides)+1; }
function rollRange(min,max)      { return min+Math.floor(Math.random()*(max-min+1)); }
function brickDot(color,size=12) {
  const bg=BRICK_COLORS[color]||'#999';
  const border=color==='white'?'border:1px solid #ccc;':'';
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:3px;background:${bg};${border}vertical-align:middle;flex-shrink:0;"></span>`;
}
function brickTag(color,qty,onClick='') {
  const bg=BRICK_COLORS[color]||'#999';
  const border=color==='white'?'border:1px solid #ccc;':'';
  return `<span class="brick-tag" style="background:${bg}22;border:1px solid ${bg};color:${color==='white'||color==='yellow'?'#555':bg};" ${onClick?`onclick="${onClick}"`:''}>
    <span style="width:10px;height:10px;border-radius:2px;background:${bg};${border}display:inline-block;"></span> ${qty} ${color}
  </span>`;
}
function hpBar(hp,max,color='#1D9E75') {
  const pct=Math.max(0,Math.round(hp/Math.max(max,1)*100));
  const c=hp<=Math.floor(max*.25)?'#E24B4A':hp<=Math.floor(max*.5)?'#EF9F27':color;
  return `<div style="height:8px;border-radius:4px;background:#333;overflow:hidden;">
    <div style="width:${pct}%;height:100%;background:${c};border-radius:4px;transition:width .4s;"></div>
  </div>`;
}

// ── ARENA BATTLE (real-time combat) ───────────────────────────
// Enemy templates used by the arena battle system (distinct from the
// turn-based MONSTER_TEMPLATES). V1 has one hardcoded goblin.
const ARENA_ENEMIES = {
  goblin: {
    type:     'goblin',
    name:     'Goblin',
    hp:       60,
    hpMax:    60,
    speed:    120,       // pixels/sec
    attackDmg:3,
    attackCd: 1.8,       // seconds between attacks
    r:        22,
    color:    '#27500A',
  },
};

// Flavor text pool for battle initiation. One line is picked at random per
// encounter and shown on the player's event card + logged to the DM.
// Keyed by enemy type — each enemy has its own pool.
const ARENA_BATTLE_FLAVOR = {
  goblin: [
    'A goblin leaps from the shadows, blade already swinging.',
    'You hear a snarl. A goblin steps into your path, grinning.',
    'The path ahead is blocked by a goblin. It smells awful.',
    'Green-skinned and cackling, a goblin lunges.',
    'A goblin, half-starved and twice as mean, bares its teeth.',
  ],
};

// Node.js export (ignored in browser)
if (typeof module !== 'undefined') {
  module.exports = { SPACES, ZONES, GATE_SPACES, GATE_RULES, BRICK_COLORS, BRICK_NAMES, LANDING_EVENTS, PLAYER_META, DASH_FLAVOR, ARENA_ENEMIES, ARENA_BATTLE_FLAVOR, SHIELD_MAX, SHIELD_COST, RIDDLES };
}
