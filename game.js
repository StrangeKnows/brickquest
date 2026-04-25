// ═══════════════════════════════════════════════════════════
//  BRICK QUEST — Shared Game Constants v2.0
// ═══════════════════════════════════════════════════════════

const BRICK_COLORS = {
  red:'#D01012', blue:'#006DB7', green:'#237841', white:'#EFEFEF',
  gray:'#AAAAAA', purple:'#7B2FBE', yellow:'#F5D000',
  orange:'#F57C00', black:'#4a4250'
};
const BRICK_NAMES = Object.keys(BRICK_COLORS);

// PLAYER_META lives in characters.js now (Phase 2 consolidation). In Node,
// we require it so server.js's existing import pattern keeps working. In the
// browser, PLAYER_META is set as a global when characters.js loads (which
// happens AFTER game.js loads, but before any code references PLAYER_META).
var PLAYER_META;
if (typeof require !== 'undefined') {
  PLAYER_META = require('./characters.js').PLAYER_META;
}

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
  // ══════════════════════════════════════════════════════
  // Zone 1 — Courtyard (tutorial, core mechanics)
  // ══════════════════════════════════════════════════════
  {
    q: "The more you take, the more you leave behind. What am I?",
    a: "footsteps",
    zone: 0,
    clue: "GATES & FORCE: Every gate that isn't magic-locked can be forced open. Roll 5+ on the attempt or take damage trying. Breaker and Blocksmith — hold red and DASH — break gates clean without a roll.",
    category: "Zone Progression",
    answerType: "noun"
  },

  // ══════════════════════════════════════════════════════
  // Zone 2 — Corridor (magic awakening, class identity)
  // ══════════════════════════════════════════════════════
  {
    q: "I have cities but no houses, mountains but no trees, water but no fish. What am I?",
    a: "a map",
    zone: 1,
    clue: "KEY GATES: Some gates refuse brute force — they want a key. The key is held by whatever blocks your path. Defeat the keeper, claim the key, let anyone turn it. The Corridor's gate waits for one such keeper.",
    category: "Zone Progression",
    answerType: "noun"
  },
  {
    q: "What gets wetter the more it dries?",
    a: "a towel",
    zone: 1,
    clue: "FORMWRIGHT'S GIFT: Blue and purple bricks cut where iron won't. The Formwright's blue bolt ignores armor entirely. Stockpile magic now — deeper foes have skin that laughs at steel.",
    category: "Class Tips",
    answerType: "noun"
  },
  {
    q: "What has hands but cannot clap?",
    a: "a clock",
    zone: 1,
    clue: "FIXER'S PRESENCE: The Fixer heals +4 HP per white brick where others get +3. When an ally falls, the Fixer can lead the revive minigame — tap-rhythm to pull them back. Keep the Fixer alive above all else.",
    category: "Party Tips",
    answerType: "noun"
  },

  // ══════════════════════════════════════════════════════
  // Zone 3 — Guard Post (pressure, hard choices)
  // ══════════════════════════════════════════════════════
  {
    q: "What has one eye but cannot see?",
    a: "a needle",
    zone: 2,
    clue: "WILD ONE'S POISON: Green brick lays a slow curse that bleeds HP tick by tick. The Wild One's poison bites harder than any other class — and every stack on a corpse counts toward Whistle. Learn what that word means before Zone 4.",
    category: "Class Tips",
    answerType: "noun"
  },
  {
    q: "What can run but never walks, has a mouth but never talks, has a head but never weeps?",
    a: "a river",
    zone: 2,
    clue: "SNAPSTEP'S DANCE: Orange brick lays a trap at your feet or where you drag it. The Snapstep's traps bite harder and place faster than anyone else. A well-placed snare buys the whole party three free seconds.",
    category: "Class Tips",
    answerType: "noun"
  },

  // ══════════════════════════════════════════════════════
  // Zone 4 — Flood Chamber (boss approach)
  // ══════════════════════════════════════════════════════
  {
    q: "Heaviest step, hardest swing, last to fall. What class stands at the front of every line?",
    a: "breaker",
    a_alt: ["the breaker"],
    zone: 3,
    clue: "BREAKER'S STRENGTH: The Breaker rolls a d8 on movement — the biggest die in the party. Shoulder-rushes gates clean like Blocksmith. Stacks shields 1-to-1 from gray. Built to eat damage so the softer classes can work. First through the gate, last from the field.",
    category: "Class Tips",
    answerType: "class"
  },

  // ══════════════════════════════════════════════════════
  // Zone 5 — Throne Room (final, warnings)
  // ══════════════════════════════════════════════════════
  {
    q: "I am always hungry and must always be fed. The finger I touch will soon turn red. What am I?",
    a: "fire",
    zone: 4,
    clue: "ETHEREAL FOES: Void Wraiths phase out of reach and teleport when you lash at them. Red steel barely touches them. Hoard blue, purple, yellow — the colors that pass through shadow — before the throne.",
    category: "Boss Warning",
    answerType: "noun"
  },

  // ══════════════════════════════════════════════════════
  // BRICKS — color-answer riddles (each teaches a color's role)
  // ══════════════════════════════════════════════════════
  {
    q: "I turn a locked door to rubble in a single rush. What color am I?",
    a: "red",
    zone: 0,
    clue: "RED BRICK DASH: Breaker and Blocksmith can shoulder-rush gates for a guaranteed break — no roll, no damage. Light-weight classes can try but break only some of the time. Red is the key to every forceable gate.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "Two of me stack as one shield pip for the armored. One of me is all others need, twice over. What color am I?",
    a: "gray",
    zone: 0,
    clue: "GRAY AS ARMOR: Breaker and Blocksmith convert 1 gray → 1 shield pip. Everyone else needs 2. Max shield caps at 50% of your HP. Gray is the class-inequality color — the armored are built to carry it.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "I heal the wounded and cleanse the cursed. What color drinks like water and burns like fire?",
    a: "white",
    zone: 0,
    clue: "WHITE — HEAL & CLEANSE: Tap white for +3 HP (Fixer: +4). White also purges every active debuff in one press — poison, slow, daze, confuse, weaken, all sweep away. Carry at least one white into every deep rumble.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "I confuse the mind and steal the next attack. The beast will skip its turn when I strike true. What color am I?",
    a: "yellow",
    zone: 1,
    clue: "YELLOW — CONFUSE: Tap yellow at an enemy; they skip their next attack. In the rumble, confuse also inverts movement inputs on the caster's first throw — be careful casting near yourself.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "I scatter and sow. The ground I touch becomes a blade. What color am I?",
    a: "orange",
    zone: 1,
    clue: "ORANGE — TRAP & SHRAPNEL: Orange lays traps at your feet or drag-placed elsewhere. On crit, traps detonate AoE shrapnel. Snapstep places them larger, faster, deadlier than any other class.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "The hungry one. Take as I give, give as I take. What color heals the caster while it harms the enemy?",
    a: "purple",
    zone: 2,
    clue: "PURPLE — VAMPIRIC: Purple damages the target AND heals the caster. When the Colossus hits 50% HP, he unlocks purple too — and his swings start feeding him. Kill him before then.",
    category: "Bricks",
    answerType: "color"
  },
  {
    q: "I am the shadow's offer. I take your blood, your bricks, sometimes your allies'. What color am I?",
    a: "black",
    zone: 3,
    clue: "BLACK — BARGAIN: The wraith at Zone 3 offers pacts. BLOOD PRICE costs permanent max HP. BINDING PACT takes a random brick from every ally. Refuse for a safe cheese — fail a pact for curses that last rumbles.",
    category: "Events",
    answerType: "color"
  },
  {
    q: "Two chests. One blesses. One curses. Which color forces this choice?",
    a: "purple",
    zone: 2,
    clue: "PURPLE EVENT — FATED CHOICE: Two chests appear. 67% chance the blessed path yields +1 purple and gold. 33% the cursed path fires a random curse. Pass for 1 safe cheese. Fixer can spend 1 black to cleanse a cursed result.",
    category: "Events",
    answerType: "color"
  },
  {
    q: "Three lines of thorn. Cut them or pay in poison. What color event am I?",
    a: "green",
    zone: 2,
    clue: "GREEN EVENT — VINE PATH: Trace three vines without slipping. Three cuts clean yields +1 green and gold. Zero cuts yields damage AND queued poison for your next rumble. Trace carefully.",
    category: "Events",
    answerType: "color"
  },

  // ══════════════════════════════════════════════════════
  // NUMBERS & ENTITIES — combat-lore riddles
  // ══════════════════════════════════════════════════════
  {
    q: "How many bricks at most can I hold in a single overload?",
    a: "5",
    a_alt: ["five"],
    zone: 3,
    clue: "OVERLOAD TIERS: Press and hold a brick button to charge. Each half-second adds one brick to the stack, up to 5. Tier 5 is max damage, max radius, max crit chance — but also drains your reserve fast.",
    category: "Combat",
    answerType: "number"
  },
  {
    q: "At half HP I enrage. My speed climbs, my telegraph shrinks, my swings heal me. What beast am I?",
    a: "stone colossus",
    a_alt: ["colossus", "stone_colossus"],
    zone: 3,
    clue: "COLOSSUS ENRAGE: At 50% HP the Colossus speeds up, his wind-up collapses, and his swings drain you to heal him. If he crosses that line, the fight usually ends. Burn him down fast.",
    category: "Bosses",
    answerType: "entity"
  },
  {
    q: "I split when I die. One becomes two, two become four. What worm am I?",
    a: "blight worm",
    a_alt: ["blight_worm", "worm", "blightworm"],
    zone: 3,
    clue: "MITOSIS: The Blight Worm's death spawns smaller clones. Each clone can split once more. Big AoE overloads on the parent kill multiple children at once — single-target hits just scatter the swarm.",
    category: "Entities",
    answerType: "entity"
  },

  // ══════════════════════════════════════════════════════
  // FUTURE — hints at cheese, fusion, achievements
  // (These teach players to look forward. Clues describe
  //  mechanics being built. Answer puzzles remain classic.)
  // ══════════════════════════════════════════════════════
  {
    q: "Soft in hand, yellow as gold, mine to eat — or mine to throw. What am I?",
    a: "cheese",
    zone: 2,
    clue: "CHEESE IS A WEAPON: Every wheel can be eaten for permanent max HP — or thrown before a rumble for a battlefield effect. Sour cheese skips the fight. Smoky distracts. Aged halves the horde. Used either way, the cheese is gone. No refills, no refresh. Save the rare wheels.",
    category: "Cheese",
    answerType: "noun"
  },
  {
    q: "Six wheels in the cellar, each its own secret. How many ways can cheese be spent?",
    a: "6",
    a_alt: ["six"],
    zone: 3,
    clue: "CHEESE VARIANTS: Standard, Sour, Smoky, Rich, Bleu, Aged — six wheels with distinct effects. Rarer wheels grant more max HP when eaten and stronger effects when thrown. Cheese drops from monsters and events — rare wheels rarest of all.",
    category: "Cheese",
    answerType: "number"
  },
  {
    q: "Two become one, and one strikes harder than either. What power waits in the combining?",
    a: "fusion",
    a_alt: ["brick fusion"],
    zone: 3,
    clue: "FUSION IS COMING: A future power will let you combine charged bricks across colors — spending multiple charges to forge a single higher-tier piece. Mastery means knowing which colors to fuse. Watch the Fusion tab.",
    category: "Future",
    answerType: "noun"
  },
  {
    q: "Dodge a hundred strikes and a new path opens. What is earned through trial?",
    a: "an achievement",
    a_alt: ["achievement", "mastery", "unlock"],
    zone: 4,
    clue: "ACHIEVEMENTS GATE ABILITIES: Each class has abilities locked behind milestones. Snapstep unlocks GHOST STEP after 100 dodges — pass through enemies without triggering rumbles. The Status tab tracks progress. Play your class to learn its secrets.",
    category: "Future",
    answerType: "noun"
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
  //
  // healPlayer(target, source = target)
  //   target: whose HP is healed (class id)
  //   source: whose white charge is spent (defaults to target for self-heal)
  //
  // Examples:
  //   client.healPlayer(MY_CLASS)          → self-heal (source = target = me)
  //   client.healPlayer('snapstep', MY_CLASS) → I heal Snapstep (I pay the charge)
  healPlayer(target, source)         { this.send('healPlayer', { target, source: source || target }); }
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
  goblin:         { hpMax: 12,  name: 'Goblin',         icon: '👺', family: 'physical' },
  skeleton:       { hpMax: 18,  name: 'Skeleton',       icon: '💀', family: 'physical' },
  slinger:        { hpMax: 10,  name: 'Slinger',        icon: '🏹', family: 'physical' },
  shadow_wolf:    { hpMax: 14,  name: 'Shadow Wolf',    icon: '🐺', family: 'ethereal' },
  creeping_vines: { hpMax: 25,  name: 'Creeping Vines', icon: '🌿', family: 'malady' },
  stone_troll:    { hpMax: 40,  name: 'Stone Troll',    icon: '🪨', family: 'physical' },
  cursed_knight:  { hpMax: 30,  name: 'Cursed Knight',  icon: '⚔️', family: 'physical' },
  void_wraith:    { hpMax: 20,  name: 'Void Wraith',    icon: '👻', family: 'ethereal' },
  stone_colossus: { hpMax: 80,  name: 'Stone Colossus', icon: '🗿', family: 'physical' },
  blight_worm:    { hpMax: 120, name: 'Blight Worm',    icon: '🪱', family: 'malady' },
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
