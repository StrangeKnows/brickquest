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

// ── MONSTERS ─────────────────────────────────────────────
const MONSTER_TEMPLATES = {
  goblin:   { name:'Goblin Scout',  hp:5,  armor:0, dmg:'d6',   color:'#237841', target:'random',  ambush:false, tameable:true,  loot:{gold:1,bricks:['green']} },
  skeleton: { name:'Skeleton Guard',hp:6,  armor:1, dmg:'d6',   color:'#B4B2A9', target:'highest', ambush:false, tameable:false, loot:{gold:1,bricks:['gray']}, holdsKey:'blue' },
  wolf:     { name:'Shadow Wolf',   hp:10, armor:1, dmg:'d6+1', color:'#444444', target:'lowest',  ambush:true,  tameable:true,  loot:{gold:1,bricks:['gray','black']} },
  troll:    { name:'Stone Troll',   hp:18, armor:2, dmg:'d6+2', color:'#5F5E5A', target:'highest', ambush:false, tameable:true,  loot:{gold:2,bricks:['gray','gray']} },
  imp:      { name:'Fire Imp',      hp:8,  armor:0, dmg:'d6+1', color:'#D01012', target:'lowest',  ambush:true,  tameable:false, loot:{gold:1,bricks:['red','orange']} },
  knight:   { name:'Cursed Knight', hp:15, armor:2, dmg:'d6+2', color:'#534AB7', target:'highest', ambush:false, tameable:false, loot:{gold:2,bricks:['purple','gray']} },
  wraith:   { name:'Void Wraith',   hp:12, armor:3, dmg:'d6+3', color:'#3C3489', target:'lowest',  ambush:true,  tameable:false, loot:{gold:2,bricks:['purple','blue']} },
  colossus_shell: { name:'Colossus — Shell', hp:28, armor:3, dmg:'d6+3', color:'#888780', target:'highest', ambush:false, tameable:false, loot:{gold:0,bricks:[]}, phase:1 },
  colossus_core:  { name:'Colossus — Core',  hp:12, armor:0, dmg:'d6+3', color:'#222222', target:'random',  ambush:false, tameable:false, loot:{gold:5,bricks:['purple','purple']}, phase:2, blueOnly:true },
};

// ── COMPLICATIONS ─────────────────────────────────────────
const COMPLICATIONS = [
  { id:'none',    label:'No complication',  desc:'Straight fight.' },
  { id:'none',    label:'No complication',  desc:'Straight fight.' },
  { id:'poison',  label:'Poison',           desc:'All players lose 1 HP end of each battle round. Mender Cleanse removes it.' },
  { id:'trapped', label:'Trapped Battlefield', desc:'DM places 2 orange bricks on random spaces. Landing = 1–3 damage each.' },
  { id:'armored', label:'Armored Surge',    desc:'Main monster +2 armor this fight. Blue magic still ignores.' },
  { id:'swarm',   label:'Swarm',            desc:'New Goblin Scout spawns end of round 2 if original monsters alive.' },
];

// ── SKILLS ───────────────────────────────────────────────
const SKILLS = {
  warrior: [
    { id:'iron_hide',         tier:1, name:'Iron Hide',         desc:'Upgrades Warrior shield: each gray brick now fills 2 shield pips instead of 1. Max shields raised to 150% of max HP.', use:'Passive', unlock:{gray:2} },
    { id:'power_strike',      tier:1, name:'Power Strike',      desc:'Rolling max on d8 adds +3 bonus damage.', use:'Passive', unlock:{red:2} },
    { id:'cover',             tier:1, name:'Cover',             desc:'Redirect one attack per round from any ally to yourself.', use:'Free reaction, no cost', unlock:{gray:1,white:1} },
    { id:'rage_break_plus',   tier:2, name:'Rage Break+',       desc:'Multiply last attack roll ×2, usable twice per battle.', use:'Brick slot: 2 red', unlock:{red:3} },
    { id:'whirlwind',         tier:2, name:'Whirlwind',         desc:'Attack every monster in zone, each takes half d8.', use:'Brick slot: 1 red', unlock:{red:3,gray:1} },
    { id:'fortress_stance',   tier:2, name:'Fortress Stance',   desc:'Skip movement: +3 armor bricks, all monsters −1 this round.', use:'Skip move, no cost', unlock:{gray:3,white:1} },
    { id:'legendary_bastion', tier:3, name:'Legendary Bastion', desc:'ONCE PER GAME: immune 2 rounds, all monsters must target you.', use:'2 gray + 1 red', unlock:{gray:4,white:2} },
    { id:'warlords_fury',     tier:3, name:"Warlord's Fury",    desc:'ONCE PER GAME: roll d8 three times on one monster, ignores armor.', use:'3 red', unlock:{red:5,gray:1} },
  ],
  wizard: [
    { id:'overcharge',    tier:1, name:'Overcharge',    desc:'Arcane Bolt damage scales: base 4–8 + 1 extra per blue/purple held.', use:'Passive', unlock:{blue:2} },
    { id:'extended_ward', tier:1, name:'Extended Ward', desc:'Ward blocks 2 attacks instead of 1.', use:'1 purple — upgraded Ward', unlock:{purple:1,blue:1} },
    { id:'chain_lightning',tier:1,name:'Chain Lightning',desc:'Arcane Bolt bounces to second monster for half damage.', use:'Passive, automatic', unlock:{blue:2,yellow:1} },
    { id:'shatter_storm', tier:2, name:'Shatter Storm', desc:'Shatter removes 7–11 bricks, 2 overflow to nearest monster.', use:'Brick slot: 2 blue', unlock:{blue:3} },
    { id:'mana_surge',    tier:2, name:'Mana Surge',    desc:'Once per battle: cast any ability for free.', use:'Saves next ability cost', unlock:{blue:3,purple:1} },
    { id:'confound',      tier:2, name:'Confound',      desc:'Force monster to attack random target this round.', use:'Brick slot: 1 yellow', unlock:{yellow:2,purple:1} },
    { id:'time_freeze',   tier:3, name:'Time Freeze',   desc:'ONCE PER GAME: all monsters skip 2 full turns.', use:'1 purple + 1 blue', unlock:{purple:3,blue:2} },
    { id:'cataclysm',     tier:3, name:'Cataclysm',     desc:'ONCE PER GAME: 13–17 magic damage to every monster, ignores armor.', use:'3 blue', unlock:{blue:5,purple:1} },
  ],
  scout: [
    { id:'long_shot',  tier:1, name:'Long Shot',  desc:'Snipe extends to 4 zones, critical on 4–6.', use:'Passive', unlock:{red:2} },
    { id:'ghost_step', tier:1, name:'Ghost Step', desc:'Shadow Step free once per round.', use:'Free first Shadow Step each round', unlock:{gray:2} },
    { id:'fleet_foot', tier:1, name:'Fleet Foot', desc:'+2 to every movement roll (stacks with Scout +1 base = +3 total).', use:'Passive', unlock:{green:2} },
    { id:'backstab',   tier:2, name:'Backstab',   desc:'+3 damage when attacking same turn as Shadow Step.', use:'Passive, triggers on condition', unlock:{gray:1,orange:1} },
    { id:'barrage',    tier:2, name:'Barrage',    desc:'Triple Shot: roll d6 three times, use highest.', use:'Brick slot: 2 red', unlock:{red:3} },
    { id:'relay',      tier:2, name:'Relay',      desc:'Pass brick to ally while moving through their zone.', use:'Free during movement, consent required', unlock:{green:2,yellow:1} },
    { id:'death_mark', tier:3, name:'Death Mark', desc:'Once per battle: mark one monster, all attacks +3 this round.', use:'1 orange', unlock:{gray:3,orange:2} },
    { id:'blitz',      tier:3, name:'Blitz',      desc:'ONCE PER GAME: take two full turns in a row.', use:'No cost', unlock:{green:3,red:2} },
  ],
  builder: [
    { id:'scavenge',          tier:1, name:'Scavenge',          desc:'After gate deconstruct: roll d6 — 4+ recover 1 gray, 6 recover 2.', use:'Automatic on deconstruct', unlock:{gray:2} },
    { id:'blueprint',         tier:1, name:'Blueprint',         desc:'Once per zone: duplicate 1 brick from inventory.', use:'Free action, costs 1 gray', unlock:{gray:1,yellow:1} },
    { id:'wrecking_ball',     tier:1, name:'Wrecking Ball',     desc:'Deconstruct deals 2 bonus damage to monster in zone.', use:'Free bonus on Deconstruct', unlock:{red:1,gray:1} },
    { id:'forge',             tier:2, name:'Forge',             desc:'Spend 2 same-color bricks → receive 1 any-color brick. Out of battle only.', use:'Free action, out of battle', unlock:{gray:2,yellow:1} },
    { id:'catapult',          tier:2, name:'Catapult',          desc:'6–8 damage ignoring all armor.', use:'Brick slot: 2 gray', unlock:{red:1,gray:3} },
    { id:'supply_drop',       tier:2, name:'Supply Drop',       desc:'Give 2 bricks to ally in same or adjacent zone. Once per battle.', use:'No cost, proximity restricted', unlock:{green:2,yellow:1} },
    { id:'salvage',           tier:3, name:'Salvage',           desc:'ONCE PER GAME: claim all monster loot + d3 bonus bricks on defeat.', use:'No cost, triggers on kill', unlock:{gray:3,orange:1} },
    { id:'infinite_blueprint',tier:3, name:'Infinite Blueprint',desc:'ONCE PER GAME: every brick in hand doubles.', use:'Costs 3 gray', unlock:{yellow:3,purple:2} },
  ],
  mender: [
    { id:'deep_mend',    tier:1, name:'Deep Mend',    desc:'Brick Mend heals 6–8 HP when target is below half HP.', use:'Passive upgrade, same cost', unlock:{white:2} },
    { id:'fast_heal',    tier:1, name:'Fast Heal',    desc:'First Brick Mend each round costs no slot (brick still spent).', use:'First heal free per round', unlock:{white:2,yellow:1} },
    { id:'cleanse_plus', tier:1, name:'Cleanse+',     desc:'Cleanse removes effects from all players in zone (was single target).', use:'Free action, once per round', unlock:{yellow:2} },
    { id:'mass_surge',   tier:2, name:'Mass Surge',   desc:'Mass Repair heals 3–5 HP to every living player.', use:'Brick slot: 2 white', unlock:{white:3} },
    { id:'swift_revive', tier:2, name:'Swift Revive', desc:'Revival uses no action slot — just the brick cost.', use:'Bricks only, no slot', unlock:{purple:1,white:1} },
    { id:'sanctuary',    tier:2, name:'Sanctuary',    desc:'Monsters cannot enter Mender\'s zone while Mender is present.', use:'Passive while in zone', unlock:{white:2,yellow:2} },
    { id:'phoenix_surge',tier:3, name:'Phoenix Surge',desc:'ONCE PER GAME: all fallen players return at full HP.', use:'2 purple', unlock:{purple:4,white:2} },
    { id:'divine_shield',tier:3, name:'Divine Shield',desc:'ONCE PER GAME: no player takes any damage for 1 full round.', use:'1 white + 1 yellow', unlock:{white:3,yellow:2,purple:1} },
  ],
  beastcaller: [
    { id:'easy_tame',      tier:1, name:'Easy Tame',      desc:'Tame succeeds on 2+. Yellow gift drops to 1+.', use:'Passive upgrade', unlock:{green:1,yellow:1} },
    { id:'beast_bond',     tier:1, name:'Beast Bond',     desc:'Tamed monsters +2 HP and +1 to attack rolls.', use:'Passive, all tamed', unlock:{green:2} },
    { id:'thorn_trap',     tier:1, name:'Thorn Trap',     desc:'Your orange brick traps deal 3–5 damage (others deal 1–2).', use:'Passive upgrade', unlock:{orange:1,green:1} },
    { id:'double_tame',    tier:2, name:'Double Tame',    desc:'Hold 2 tamed monsters. Both act each turn (1 green each).', use:'Passive, just tame a second', unlock:{green:3} },
    { id:'bloodlust',      tier:2, name:'Bloodlust',      desc:'When tamed monster kills, it immediately attacks again. No cost.', use:'Passive, triggers on kill', unlock:{orange:2,green:1} },
    { id:'pack_call_plus', tier:2, name:'Pack Call+',     desc:'All monsters target Beastcaller for 3 rounds.', use:'Brick slot: 1 orange', unlock:{orange:2} },
    { id:'alpha_predator', tier:3, name:'Alpha Predator', desc:"ONCE PER GAME: tamed monster hits every monster in zone at once.", use:'1 green', unlock:{orange:3,green:2} },
    { id:'natures_wrath',  tier:3, name:"Nature's Wrath", desc:"ONCE PER GAME: 3–5 armor-ignoring dmg all monsters, then 2–3/turn until dispelled.", use:'2 green + 1 yellow', unlock:{green:5,yellow:2} },
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
  addShield(cls)                    { this.send('addShield',{cls}); }
  purchaseBrick(cls,color)          { this.send('purchaseBrick',{cls,color}); }
  adjustGold(cls,amount)            { this.send('adjustGold',{cls,amount}); }
  adjustArmor(cls,amount)           { this.send('adjustArmor',{cls,amount}); }
  offerTrade(fromCls,toCls,wantBricks,offerBricks,offerGold) { this.send('offerTrade',{fromCls,toCls,wantBricks,offerBricks,offerGold}); }
  respondTrade(id,accept)           { this.send('respondTrade',{id,accept}); }
  unlockSkill(cls,skillId,cost)     { this.send('unlockSkill',{cls,skillId,cost}); }
  healPlayer(healerCls,targetCls)   { this.send('healPlayer',{healerCls,targetCls}); }
  revivePlayer(healerCls,targetCls) { this.send('revivePlayer',{healerCls,targetCls}); }
  massRepair()                      { this.send('massRepair'); }
  tameAttempt(cls,monsterIdx)       { this.send('tameAttempt',{cls,monsterIdx}); }
  commandTamed(cls,monsterIdx)      { this.send('commandTamed',{cls,monsterIdx}); }
  rollAttack(cls,monsterIdx)        { this.send('rollAttack',{cls,monsterIdx}); }
  useBrick(cls,color,monsterIdx,targetCls) { this.send('useBrickInBattle',{cls,brickColor:color,monsterIdx,targetCls}); }
  catapult(monsterIdx)              { this.send('catapult',{monsterIdx}); }
  startBattle(monsters,combatants,isBoss) { this.send('startBattle',{monsters,combatants,isBoss}); }
  endBattle()                       { this.send('endBattle'); }
  monsterAttack(idx)                { this.send('monsterAttack',{monsterIdx:idx}); }
  nextBattleRound()                 { this.send('nextBattleRound'); }
  setComplication(c)                { this.send('setComplication',{complication:c}); }
  bossPhase2()                      { this.send('bossPhase2'); }
  setGate(gate,status)              { this.send('setGate',{gate,status}); }
  deconstructGate(cls,gate)         { this.send('deconstructGate',{cls,gate}); }
  forceGate(cls,gate)               { this.send('forceGate',{cls,gate}); }
  rebuildBridge()                   { this.send('rebuildBridge'); }
  collectKey(color,cls)             { this.send('collectKey',{keyColor:color,cls}); }
  useKey(cls,gate,color)            { this.send('useKey',{cls,gate,keyColor:color}); }
  landingRoll(cls,roll,zone)        { this.send('landingRoll',{cls,roll,zone}); }
  resolveEvent(cls,eventType,data)  { this.send('resolveEvent',{cls,eventType,data}); }
  startRiddle(cls)                  { this.send('startRiddle',{cls}); }
  riddleAnswer(cls,answer)          { this.send('riddleAnswer',{cls,answer}); }
  dmMovePlayer(cls,roll,destination){ this.send('dmMovePlayer',{cls,roll,destination}); }
  addLog(text,kind)                 { this.send('addLog',{text,kind}); }
  resetGame()                       { this.send('resetGame'); }
  blueprint(color)                  { this.send('blueprint',{color}); }
  forge(fromColor,toColor)          { this.send('forge',{fromColor,toColor}); }
  salvage()                         { this.send('salvage'); }
  activateEnhanced(cls)             { this.send('activateEnhanced',{cls}); }
  disarmTrap(cls,spaceIdx)          { this.send('disarmTrap',{cls,spaceIdx}); }
  triggerTrap(cls,spaceIdx)         { this.send('triggerTrap',{cls,spaceIdx}); }
  removeFortressBrick()             { this.send('removeFortressBrick'); }
  rescueVillager()                  { this.send('rescueVillager'); }
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
function buildMonsters(mids) {
  return mids.map(id=>{
    const t=MONSTER_TEMPLATES[id]; if(!t)return null;
    return {...t,hpCurrent:t.hp,hpMax:t.hp,confused:false,cursed:0,confuseRounds:0};
  }).filter(Boolean);
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
  module.exports = { SPACES, ZONES, GATE_SPACES, GATE_RULES, BRICK_COLORS, BRICK_NAMES, MONSTER_TEMPLATES, COMPLICATIONS, LANDING_EVENTS, PLAYER_META, DASH_FLAVOR, ARENA_ENEMIES, ARENA_BATTLE_FLAVOR, SHIELD_MAX, SHIELD_COST, RIDDLES };
}
