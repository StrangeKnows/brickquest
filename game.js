// ═══════════════════════════════════════════════════════════
//  BRICK QUEST — Shared Game Constants v2.0
// ═══════════════════════════════════════════════════════════

const BRICK_COLORS = {
  red:'#D01012', blue:'#006DB7', green:'#237841', white:'#EFEFEF',
  gray:'#AAAAAA', purple:'#7B2FBE', yellow:'#F5D000',
  orange:'#F57C00', black:'#333333'
};
const BRICK_NAMES = Object.keys(BRICK_COLORS);

// PLAYER_META — class definitions. Rumble combat values (hp, speed, signature/secondary bricks)
// come from the Combat & Economy v1 spec (see NOTES.md).
// Dash fields (weight, dashBreakChance, dashBreakDmg, dashDmgAlwaysRolls) power board-side
// gate-break mechanics in the red dash flow.
const PLAYER_META = {
  breaker:     { name:'Breaker',     icon:'⚔️', color:'#993C1D', hp:14, speed:150, die:'d8',
                 signature:'red', secondary:'gray',
                 weight:'heavy', dashBreakChance:1.00, dashBreakDmg:[0,3], dashDmgAlwaysRolls:false },
  formwright:  { name:'Formwright',  icon:'🔮', color:'#3C3489', hp:6,  speed:180, die:'d6',
                 signature:'blue', secondary:'purple',
                 weight:'light', dashBreakChance:0.15, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  snapstep:    { name:'Snapstep',    icon:'🏃', color:'#085041', hp:9,  speed:260, die:'d6',
                 signature:'orange', secondary:'red',
                 weight:'light', dashBreakChance:0.35, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  blocksmith:  { name:'Blocksmith',  icon:'🔧', color:'#C87800', hp:12, speed:150, die:'d6',
                 signature:'gray', secondary:'orange',
                 weight:'heavy', dashBreakChance:1.00, dashBreakDmg:[0,3], dashDmgAlwaysRolls:false },
  fixer:       { name:'Fixer',       icon:'💊', color:'#72243E', hp:8,  speed:160, die:'d4',
                 signature:'white', secondary:'black',
                 weight:'mid',   dashBreakChance:0.50, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
  wild_one:    { name:'Wild One',    icon:'🐾', color:'#27500A', hp:10, speed:220, die:'d6',
                 signature:'green', secondary:'yellow',
                 weight:'light', dashBreakChance:0.35, dashBreakDmg:[1,2], dashDmgAlwaysRolls:true  },
};

// Flavor text per class for dash gate-break outcomes
const DASH_FLAVOR = {
  breaker: {
    success: 'Shoulder first! The gate shatters like kindling.',
    fail:    'The gate holds. Impossible.',
  },
  blocksmith: {
    success: 'Iron boot meets brittle wood. The gate folds inward.',
    fail:    'The hinges refuse. That\'s not how I built them.',
  },
  fixer: {
    success: 'Faster than expected! The gate cracks under the charge.',
    fail:    'The gate absorbs the blow. Fixer falls back, winded.',
  },
  snapstep: {
    success: 'Shoulder-rolled through the splinters.',
    fail:    'Bounced off. That\'s going to leave a mark.',
  },
  wild_one: {
    success: 'The totem hums, the gate yields.',
    fail:    'The spirits decline this battle. The gate remains.',
  },
  formwright: {
    success: 'Somehow... the gate gives way. A minor miracle.',
    fail:    'Why did I think these frail wrists could handle that?',
  },
};

// ── BRICK ECONOMY ─────────────────────────────────────────
// Governs in-rumble brick refresh rate. Each class has signature colors
// (fast refresh) and secondary colors (medium refresh). All other colors
// are baseline (slow refresh). Inventory IS the pool (spec mode): no
// artificial cap; owned bricks = rumble capacity for that color.
// See NOTES.md for the full design doc.
const BRICK_ECONOMY = {
  // Seconds per one brick regenerated during active rumble combat.
  refreshRates: {
    signature: 3.0,
    secondary: 5.0,
    baseline: 10.0,
  },
};

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
// roll: 1-6, type determines what DM places.
// `mids` (monster IDs) on monster/creeper/boss events MUST match keys in
// rumble.js ENTITY_REGISTRY exactly. Server reads mids[0] (or rolls from
// the array for multi-spawn) to seed the rumble battle's entity type.
const LANDING_EVENTS = {
  1: [ // Zone 1 — Courtyard (tutorial)
    { roll:1, type:'gray',     icon:null, name:'Rubble Stacking', desc:'Match the outline with 3 falling stones.', color:'gray' },
    { roll:2, type:'red',      icon:null, name:'Trial of the Hand',desc:'The DM presents a challenge — perform or fail.', color:'red' },
    { roll:3, type:'gold',     icon:'🪙', name:'Found Gold',       desc:'A coin among the rubble.', amount:1 },
    { roll:4, type:'riddle',   icon:null, name:'Clue Found!',      desc:'A yellow brick with a card beneath it.', zoneRiddlePool:0 },
    { roll:5, type:'monster',  icon:'👺', name:'Goblin Scout',     desc:'A goblin leaps out!', mids:['goblin'] },
    { roll:6, type:'trap',     icon:null, name:'Trap!',            desc:'An orange brick snaps into place beneath your feet.' },
    { roll:7, type:'gray',     icon:null, name:'Rubble Stacking',  desc:'More fallen stones — stack them before they settle wrong.', color:'gray' },
  ],
  2: [ // Zone 2 — Corridor (magic awakening)
    { roll:1, type:'white',    icon:null, name:"Pilgrim's Rest",   desc:'A shrine. Heal yourself or an ally.', color:'white' },
    { roll:2, type:'green',    icon:null, name:'Vine Path',        desc:'Three vines. Trace each without straying.', color:'green' },
    { roll:3, type:'gold',     icon:'🪙', name:'Found Gold',       desc:'Coins scattered on the floor.', amount:2 },
    { roll:4, type:'blue',     icon:null, name:'Arcane Shrine',    desc:'A magical residue crystallized into brick form.', color:'blue' },
    { roll:5, type:'monster',  icon:'💀', name:'Skeleton Guard',   desc:'Bones rattle to life!', mids:['skeleton'] },
    { roll:6, type:'riddle',   icon:null, name:'Clue Found!',      desc:'A yellow brick resting against the wall.', zoneRiddlePool:1 },
    { roll:7, type:'trap',     icon:null, name:'Trap!',            desc:'A hidden pressure plate fires.' },
  ],
  3: [ // Zone 3 — Guard Post (pressure)
    { roll:1, type:'monster',  icon:'👺', name:'Goblin Pair',      desc:'Two goblins on patrol!', mids:['goblin','goblin'] },
    { roll:2, type:'black',    icon:null, name:'Shadow Bargain',   desc:'A cloaked figure offers a pact.', color:'black' },
    { roll:3, type:'purple',   icon:null, name:'Fated Choice',     desc:'Two sealed chests — one blesses, one curses.', color:'purple' },
    { roll:4, type:'green',    icon:null, name:'Vine Path',        desc:'Another wall of vines blocks the path.', color:'green' },
    { roll:5, type:'riddle',   icon:null, name:'Clue Found!',      desc:'A yellow brick on the elevated platform.', zoneRiddlePool:2 },
    { roll:6, type:'red',      icon:null, name:'Trial of the Hand',desc:'The DM presents a harder challenge.', color:'red' },
    { roll:7, type:'gold',     icon:'🪙', name:'Found Gold',       desc:'A goblin dropped its purse.', amount:2 },
  ],
  4: [ // Zone 4 — Flood Chamber (escalation)
    { roll:1, type:'monster',  icon:'🧌', name:'Stone Troll',      desc:'A massive troll blocks the path.', mids:['stone_troll'] },
    { roll:2, type:'gray',     icon:null, name:'Rubble Stacking',  desc:'The chamber walls collapsed — rebuild them.', color:'gray' },
    { roll:3, type:'black',    icon:null, name:'Shadow Bargain',   desc:'The shadow offers a final pact.', color:'black' },
    { roll:4, type:'purple',   icon:null, name:'Fated Choice',     desc:'Two sealed chests. Higher stakes now.', color:'purple' },
    { roll:5, type:'white',    icon:null, name:"Pilgrim's Rest",   desc:'A shrine glowing even in dark water. Last blessing.', color:'white' },
    { roll:6, type:'doubletrap',icon:null,name:'Double Trap!',     desc:'Two orange bricks snap into place!' },
    { roll:7, type:'red',      icon:null, name:'Trial of the Hand',desc:'The final ceremonial challenge before the throne.', color:'red' },
  ],
  5: [ // Zone 5 — Throne Room (boss always)
    { roll:1, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:2, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:3, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:4, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:5, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:6, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
    { roll:7, type:'boss', icon:'💀', name:'BOSS', desc:'The Stone Colossus awakens!', mids:['stone_colossus'] },
  ],
};


// ── STORE PRICES ─────────────────────────────────────────
const STORE_PRICES = {
  red:1, gray:1, green:1,
  blue:2, white:2, yellow:2, orange:2,
  purple:3, black:3
};

// ── RIDDLES ───────────────────────────────────────────────
// ── ZONE-SPECIFIC CLUES ─────────────────────────────────
// Each clue teaches zone-relevant tactics. clueZone matches ZONES index (0-4).
const RIDDLES = [
  // Zone 1 — Courtyard
  {
    q: "The more you take, the more you leave behind. What am I?",
    a: "footsteps",
    zone: 0,
    clue: "GATE AHEAD: The Blocksmith can deconstruct the Zone 1→2 gate using their Deconstruct skill — no damage taken. Others can force it open (roll 5+) but take 2 damage trying. Let Blocksmith lead.",
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
    clue: "SHIELD UP: Breaker and Blocksmith stack shields efficiently (1 gray = 1 shield). All others need 2 gray bricks per shield. Max shields = 50% of your HP. Get shields before fighting.",
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
    clue: "FORMWRIGHT POWER: Stock up on blue and purple bricks now. In the Phase 2 boss fight, ONLY magic bricks deal damage. The Formwright's blue brick hits 4-8 ignoring armor — the hardest single hit in the game.",
    category: "Boss Preparation"
  },
  {
    q: "What has hands but cannot clap?",
    a: "a clock",
    zone: 1,
    clue: "FIXER IS VITAL: Fixer heals 4 HP per white brick — double everyone else. In battle, Fixer can revive fallen players using 1 purple + 1 white brick. Keep Fixer near the back of initiative order.",
    category: "Party Tips"
  },
  // Zone 3 — Guard Post
  {
    q: "The man who made it doesn't need it. The man who bought it doesn't want it. The man who uses it doesn't know it. What is it?",
    a: "a coffin",
    zone: 2,
    clue: "GATE AHEAD: Zone 3→4 is a structural gate. Blocksmith can dismantle it free. Others must force it (roll 5+, take 2 damage). A Breaker with Fortress Stance gains +3 shield before attempting — worth doing first.",
    category: "Zone Progression"
  },
  {
    q: "What has one eye but cannot see?",
    a: "a needle",
    zone: 2,
    clue: "WILD ONE SECRET: Tamed monsters fight alongside you every turn for 1 green brick. A tamed Shadow Wolf or Stone Troll hits with its full stats. Easy Tame skill lowers the capture roll from 3+ to 2+.",
    category: "Class Tips"
  },
  {
    q: "What can run but never walks, has a mouth but never talks, has a head but never weeps?",
    a: "a river",
    zone: 2,
    clue: "SNAPSTEP ADVANTAGE: Snapstep gets +1 to every movement roll automatically. Orange battle traps deal 2-4 damage (others do 1-2). Snapstep also finds bricks on 3+ while searching in battle — others need 5+.",
    category: "Class Tips"
  },
  // Zone 4 — Flood Chamber
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
    clue: "WINNING COMBO: In Phase 2, use yellow brick to confuse the boss (skips attack), then Formwright hits with blue for 4-8 magic damage. Confused boss cannot retaliate. Chain this with Fixer healing between rounds.",
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
  // ── v4 NEW RIDDLES (gameplay + mechanics teaching pool) ──
  {
    q: "I turn a locked door to rubble in a single rush. What am I?",
    a: "red",
    zone: 0,
    clue: "RED BRICK CHARGE: Breakers and Blocksmiths can SHOULDER-RUSH gates for guaranteed break using the red dash action. Other classes may force-gate (roll 5+, 2 damage on fail).",
    category: "Bricks"
  },
  {
    q: "Two of me stack as one shield pip for the armored. One of me is all others need, twice over. What am I?",
    a: "gray",
    zone: 0,
    clue: "SHIELD ECONOMY: Gray becomes shield pips. Breaker and Blocksmith: 1 gray per pip. All others: 2 gray per pip. Max shields = 50% of your HP (Breaker with Iron Hide unlock: 75%).",
    category: "Bricks"
  },
  {
    q: "I heal the wounded and cleanse the cursed. What color drinks like water and burns like fire?",
    a: "white",
    zone: 0,
    clue: "WHITE BRICK — HEAL & CLEANSE: Tap white for +3 HP (Fixer heals +4). White TAP also purges all debuffs. Spend 1 white on board to cleanse queued poison.",
    category: "Bricks"
  },
  {
    q: "I confuse the mind and steal the next attack. The boss will skip their turn when I strike true. What am I?",
    a: "yellow",
    zone: 1,
    clue: "YELLOW BRICK — CONFUSE: Tap yellow to confuse a monster; it skips next attack. In Rumble Arena confuse also inverts player input — be careful casting on yourself.",
    category: "Bricks"
  },
  {
    q: "I scatter and sow. The path you walked becomes the path I burn. What color am I?",
    a: "orange",
    zone: 1,
    clue: "ORANGE BRICK — SHRAPNEL: Orange tap throws shrapnel in an arc. Every 3rd slinger projectile leaves a shrapnel hazard — Snapstep can disarm these.",
    category: "Bricks"
  },
  {
    q: "The hungry one. Take as I give, give as I take. What color heals the caster while it harms the enemy?",
    a: "purple",
    zone: 2,
    clue: "PURPLE BRICK — VAMPIRIC: Purple tap does 2-4 damage AND heals caster 3-4 HP. Colossus unlocks this mid-fight at 50% HP — he heals off every hit in phase 2.",
    category: "Bricks"
  },
  {
    q: "Two chests. One blesses. One curses. Which color forces this choice?",
    a: "purple",
    zone: 2,
    clue: "PURPLE EVENT: Fated Choice offers 2 chests — 67% blessed (+1 purple +2-3 gold), 33% cursed (random curse from pool). PASS for safe 1 cheese. Fixer can spend 1 black to cleanse a cursed result.",
    category: "Events"
  },
  {
    q: "Three lines of thorn. Cut them or pay in poison. What color event am I?",
    a: "green",
    zone: 2,
    clue: "GREEN EVENT: Vine Path — trace 3 vines without straying. All 3 cut = 1 green + 2-3 gold. 0 cut = damage + queued poison for next rumble battle.",
    category: "Events"
  },
  {
    q: "I am the shadow's offer. I take your blood, your bricks, sometimes your allies'. What color am I?",
    a: "black",
    zone: 3,
    clue: "BLACK BARGAIN: Trade offers from the wraith. BLOOD PRICE costs permanent max HP. BINDING PACT (rare) costs ALL allies a random brick. Refuse for 97% cheese, 3% black.",
    category: "Events"
  },
  {
    q: "How many bricks max fit in a single overload?",
    a: "5",
    a_alt: ["five"],
    zone: 3,
    clue: "OVERLOAD HOLD: Press and hold a brick button to charge. Each tier (0.5s hold) consumes one more brick up to 5. Tier 5 = max damage, max radius, max crit chance.",
    category: "Combat"
  },
  {
    q: "At half HP I enrage. My speed jumps, my telegraph shrinks, my swings heal me. What beast am I?",
    a: "colossus",
    a_alt: ["stone colossus", "stone_colossus"],
    zone: 3,
    clue: "COLOSSUS ENRAGE: At 50% HP: speed 90→140, telegraph 0.75s→0.40s, swings heal +3 HP via purple vampirism. Burn him down fast or phase 2 wins.",
    category: "Bosses"
  },
  {
    q: "Poison. Slow. Daze. Confuse. Weaken. One brick tap cleanses all of me. Which?",
    a: "white",
    zone: 4,
    clue: "STATUS CLEANSE: White brick TAP removes ALL active debuffs on player. Critical during worm and wraith fights. Also cleanses the queued poison from failed GREEN or BLACK bargains.",
    category: "Combat"
  },
  {
    q: "I split when I die. Two of me become four. What grub am I?",
    a: "rot grub",
    a_alt: ["rot_grub", "rotgrub", "grub"],
    zone: 3,
    clue: "MITOSIS: Rot grubs split on death into 2 half-size grubs (2-level recursion: 1 → 2 → 4). Big AoE overloads kill multiple clones efficiently.",
    category: "Entities"
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
  offerTrade(fromCls,toCls,wantBricks,offerBricks,offerGold,wantCheese,offerCheese) { this.send('offerTrade',{fromCls,toCls,wantBricks,offerBricks,offerGold,wantCheese,offerCheese}); }
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

  // ── BOARD ACTIONS (S013 §8.2 — consume bricksCharged) ──
  healPlayer(cls)                   { this.send('healPlayer', { cls }); }
  addShield(cls)                    { this.send('addShield',  { cls }); }

  // ── LEGACY STUBS ──
  // No-ops for UI paths tied to removed turn-based battle + skills systems.
  // Will be replaced by real implementations in Build 0.14.0 (Action Hub).
  _legacy(name) { console.warn('[legacy no-op]', name); }
  revivePlayer()      { this._legacy('revivePlayer'); }
  massRepair()        { this._legacy('massRepair'); }
  useBrick()          { this._legacy('useBrick'); }
  deconstructGate()   { this._legacy('deconstructGate'); }
  rebuildBridge()     { this._legacy('rebuildBridge'); }
  blueprint()         { this._legacy('blueprint'); }
  forge()             { this._legacy('forge'); }
  // 0.14.0: activateEnhanced stub removed. Enhanced Movement (purple d3-turn
  // bonus actions) is deprecated in favor of per-color board overload menus.
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

// ── RUMBLE (real-time combat) ───────────────────────────────
// The rumble runtime owns the actual entity stats / AI / loot tables in
// rumble.js's ENTITY_REGISTRY. Game.js holds only:
//   1. The list of valid entity TYPE NAMES so the server can validate
//      what it sends to clients.
//   2. Flavor-text pools keyed by type, used for the encounter-card
//      narrative line. Story content lives here, not in combat code.
// Adding a new entity: define stats in rumble.js, add the type name here,
// optionally add flavor lines.

// Valid entity types — must match keys in rumble.js ENTITY_REGISTRY.
// 'goblin' is the safe-fallback default if no type is specified.
const ENTITY_TYPES = [
  'goblin', 'skeleton', 'slinger', 'shadow_wolf', 'creeping_vines',
  'stone_troll', 'cursed_knight', 'void_wraith',
  'stone_colossus', 'blight_worm',
];

// Thin server-side stat snapshot: hpMax per type. Used by the DM force-reset
// path which needs to restore an entity's HP without loading the full
// rumble registry. Must stay in sync with rumble.js ENTITY_REGISTRY.
// Display-only "name" string for log lines; actual rendering uses rumble.js.
const ENTITY_META = {
  goblin:         { hpMax: 12,  name: 'Goblin' },
  skeleton:       { hpMax: 18,  name: 'Skeleton' },
  slinger:        { hpMax: 10,  name: 'Slinger' },
  shadow_wolf:    { hpMax: 14,  name: 'Shadow Wolf' },
  creeping_vines: { hpMax: 25,  name: 'Creeping Vines' },
  stone_troll:    { hpMax: 40,  name: 'Stone Troll' },
  cursed_knight:  { hpMax: 30,  name: 'Cursed Knight' },
  void_wraith:    { hpMax: 20,  name: 'Void Wraith' },
  stone_colossus: { hpMax: 80,  name: 'Stone Colossus' },
  blight_worm:    { hpMax: 120, name: 'Blight Worm' },
};

// Flavor text pool for battle initiation. One line is picked at random per
// encounter and shown on the player's event card + logged to the DM.
const RUMBLE_FLAVOR = {
  goblin: [
    'A goblin leaps from the shadows, blade already swinging.',
    'You hear a snarl. A goblin steps into your path, grinning.',
    'The path ahead is blocked by a goblin. It smells awful.',
    'Green-skinned and cackling, a goblin lunges.',
    'A goblin, half-starved and twice as mean, bares its teeth.',
  ],
  skeleton: [
    'Bones rattle to life — a skeleton guard rises.',
    'A pile of bones reassembles itself into a snarling guard.',
    'The skeleton draws its rusted blade with a dry rasp.',
    'Hollow eye sockets fix on you. The skeleton charges.',
  ],
  slinger: [
    'A goblin slinger crouches at range, sling already loaded.',
    'You spot a slinger lining up a shot from a distance.',
    'A wiry figure backs away, twirling a sling overhead.',
  ],
  shadow_wolf: [
    'A shadow detaches from the wall — a wolf, eyes glinting.',
    'A shadow wolf lunges from the dark, faster than thought.',
    'You hear a low growl, then teeth flash in the darkness.',
  ],
  creeping_vines: [
    'Vines surge across the path — cut them in time!',
    'Thorned tendrils erupt from the ground, blocking the way.',
    'A patch of cursed vines stirs, reaching toward you.',
  ],
  stone_troll: [
    'A massive stone troll blocks the path, club in hand.',
    'The ground trembles. A troll heaves itself upright.',
    'A stone troll snorts, then lurches forward to crush you.',
  ],
  cursed_knight: [
    'A cursed knight rises from the rubble, sword raised.',
    'Black armor clatters as the knight steps forward.',
    'The cursed knight\'s helm turns toward you. The duel begins.',
  ],
  void_wraith: [
    'A void wraith materializes — AMBUSH!',
    'Cold air. A wraith forms inches from your face.',
    'The shadows ripple. A wraith fades into being beside you.',
  ],
  stone_colossus: [
    'The stone colossus awakens — boss fight!',
    'A mountain of stone lurches to its feet. The colossus has woken.',
    'Cracks spread across the ancient stones. The colossus stirs.',
  ],
  blight_worm: [
    'The earth churns. The Blight Worm surfaces.',
    'A vast wormlike shape rises from the floor — the Blight Worm.',
    'Decay floods the chamber. The Blight Worm has come.',
  ],
};

// Node.js export (ignored in browser)
if (typeof module !== 'undefined') {
  module.exports = { SPACES, ZONES, GATE_SPACES, GATE_RULES, BRICK_COLORS, BRICK_NAMES, LANDING_EVENTS, PLAYER_META, DASH_FLAVOR, ENTITY_TYPES, ENTITY_META, RUMBLE_FLAVOR, BRICK_ECONOMY, RIDDLES };
}
