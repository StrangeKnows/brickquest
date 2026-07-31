// ═══════════════════════════════════════════════════════════════════════
// bestiary.js — CANONICAL entity/monster data
// ═══════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for every entity template that appears in rumble.
// Grunts, elites, bosses — all live here. Runtime code (rumble.js) reads
// from ENTITY_REGISTRY; it does NOT define entity data inline.
//
// Loaded BEFORE rumble.js in every HTML file that runs the combat engine
// (rumble_test.html, players.html, test_players.html). Also require-able
// from Node for server-side reuse.
//
// Sibling to characters.js:
//   characters.js  → player class data (Breaker, Wildcast, Fixer, ...)
//   bestiary.js    → entity/monster data (goblin, cursed_knight, ...)
// Two files, two concerns. Do NOT mix.
//
// Adding a new entity:
//   1. Add a new key to ENTITY_REGISTRY below.
//   2. Give it the fields it needs (hp, speed, ai, attackPattern, etc.).
//   3. Reference it by string name from wave definitions or spawn calls.
//   4. NEVER inline entity data at a callsite — that's the failure mode
//      this file exists to prevent.
//
// Front-shield signature fields (cursed_knight and future shield-carriers):
//   shieldTurnRate       — rad/sec the shield rotates toward target.
//                           Lower = easier to flank/backstab.
//                           Math.PI (~3.14) = 180°/sec.
//   shieldArcDeg         — arc width of shield (degrees), centered on
//                           facing direction. 120 = ±60°.
//   shieldBlockPct       — damage reduction when hit inside arc (0-1).
//   shieldPierceBlockPct — reduced block for piercing attacks (0-1).
// Runtime code reads these; do NOT hardcode shield values in rumble.js.
//
// AI behavior (`ai` field) drives the update-loop dispatcher in rumble.js:
//   chase        — run at target, touch to damage (default legacy behavior)
//   ranged_kite  — back away to kiteDistance, fire ranged projectiles
//   stationary   — doesn't move; periodic AoE pulse around itself
//   heavy_melee  — chase then telegraph a wind-up swing, AoE damage
//   teleport     — chase + periodic blink to near target
// ═══════════════════════════════════════════════════════════════════════

// ── Resistance helper ───────────────────────────────────────────────────
// Each family resists one family (0.5×), is neutral to itself (1.0×), and
// is vulnerable to another (1.5×). Cycle: physical → ethereal → malady →
// physical. Used by ENTITY_REGISTRY entries below so each entity's family
// drives its full resistance profile without manual bookkeeping.
function _familyResist(family) {
  var cycle = { physical: 'ethereal', ethereal: 'malady', malady: 'physical' };
  var resistant = cycle[family];                  // this family RESISTS attacks from
  var vulnerable = Object.keys(cycle).find(function(k) { return cycle[k] === family; });
  var r = { physical: 1.0, ethereal: 1.0, malady: 1.0 };
  r[resistant] = 0.5;
  r[vulnerable] = 1.5;
  return r;
}

// ── ENTITY_REGISTRY ─────────────────────────────────────────────────────
var ENTITY_REGISTRY = {
  // ── Tier 1 grunts ──────────────────────────────────────────────────
  goblin: {
    hp: 12, hpMax: 12, speed: 180, r: 16,
    family: 'physical',
    resistances: _familyResist('physical'),
    ai: 'chase', attackPattern: 'touch',
    color: '#8b5a2b', icon: '👺',
    // Rare-ish drops — most goblin kills yield nothing; occasionally a
    // green or red chip falls. Gold is the most common drop.
    loot: [
      { color: 'green', chance: 0.05, min: 1, max: 1 },
      { color: 'red',   chance: 0.10, min: 1, max: 1 },
      { kind: 'gold',   chance: 1.00, min: 1, max: 1 },
      { kind: 'cheese', chance: 0.15, min: 1, max: 1 },
    ],
    // PHASE A — intelligence fields
    affinityColors: ['red', 'green'],
    signature: 'pack_flank',        // implemented in Phase E
    reactions: {
      green: 'close_fast',          // interrupt player AoE charge
      red:   'backstep',            // avoid knockback AoE
    },
    reactionCooldown: 7,
    arsenalCooldown: 5,             // headbutt (Phase C)
  },
  skeleton: {
    hp: 16, hpMax: 16, speed: 140, r: 17,
    family: 'physical',
    resistances: _familyResist('physical'),
    ai: 'chase', attackPattern: 'touch',
    dmg: 3,
    color: '#dcdcdc', icon: '💀',
    loot: [
      { color: 'gray',  chance: 0.07, min: 1, max: 1 },
      { color: 'white', chance: 0.03, min: 1, max: 1 },
      { kind: 'gold',   chance: 1.00, min: 1, max: 1 },
    ],
    // PHASE A
    affinityColors: ['gray', 'white'],
    signature: 'bone_rise',         // Phase E: revive once at 40% HP if small-hit kill
    reactions: {
      gray:  'shield_up',           // add more armor
      white: 'close_fast',          // don't let player heal
    },
    reactionCooldown: 8,
    arsenalCooldown: 5,             // gray armor refresh (Phase C)
  },
  // ── Tier 1 ranged / special ────────────────────────────────────────
  slinger: {
    hp: 10, hpMax: 10, speed: 160, r: 14,
    family: 'physical',
    resistances: _familyResist('physical'),
    ai: 'ranged_kite', attackPattern: 'ranged',
    kiteDistance: 260, rangedCooldown: 1.5, rangedDmg: 2,
    color: '#a4682a', icon: '🏹',
    loot: [
      { color: 'orange', chance: 0.05, min: 1, max: 1 },
      { color: 'yellow', chance: 0.10, min: 1, max: 1 },
      { kind: 'gold',    chance: 1.00, min: 1, max: 1 },
      { kind: 'cheese',  chance: 0.25, min: 1, max: 1 },
    ],
    // PHASE A
    affinityColors: ['orange', 'yellow'],
    signature: 'burst_fire',        // Phase D: 3 rocks in sequence
    reactions: {
      red:   'backstep',
      blue:  'evade',
      green: 'backstep',
    },
    reactionCooldown: 5,
  },
  shadow_wolf: {
    hp: 14, hpMax: 14, speed: 240, r: 18,
    family: 'ethereal',
    resistances: _familyResist('ethereal'),
    ai: 'chase', attackPattern: 'touch',
    color: '#3d2e5a', icon: '🐺',
    loot: [
      { color: 'purple', chance: 0.05, min: 1, max: 1 },
      { color: 'blue',   chance: 0.10, min: 1, max: 1 },
      { kind: 'gold',    chance: 0.30, min: 1, max: 3 },
    ],
    // PHASE A
    affinityColors: ['purple', 'blue'],
    signature: 'leap_lunge',        // Phase E
    reactions: {
      red:    'interrupt_swing',    // swift peck before swing
      yellow: 'close_fast',         // interrupt daze cast
      green:  'backstep',
    },
    reactionCooldown: 5,
  },
  creeping_vines: {
    hp: 25, hpMax: 25, speed: 0, r: 20,
    family: 'malady',
    resistances: _familyResist('malady'),
    ai: 'stationary', attackPattern: 'pulse',
    pulseCooldown: 2.0, pulseRadius: 90, pulseDmg: 2,
    color: '#2d5c2e', icon: '🌿',
    // v0.16.86 — Visual identity fields.
    // pulseColor: color of the expanding AoE ring on each pulse attack
    //             (rumble.js spawnEnemyPulseFX reads this).
    // tendrilAura*: passive ambient FX — small tendrils continuously
    //               sprout around the vine, giving a lifelike feel
    //               (rumble.js updateEntity spawns; drawTendrilParticles
    //               renders). Applies to any entity that opts in.
    pulseColor: '#3ea150',
    tendrilAura: true,
    tendrilAuraColor: '#3ea150',
    tendrilAuraRate: 4,             // spawns per second
    loot: [
      { color: 'green',  chance: 0.15, min: 1, max: 2 },
      { color: 'yellow', chance: 0.10, min: 1, max: 1 },
      { kind: 'gold',    chance: 0.30, min: 1, max: 1 },
    ],
    // PHASE A — stationary, no movement reactions
    affinityColors: ['green', 'yellow'],
    signature: 'root_pulse',        // Phase D: pulse applies 0.7s slow
    reactions: {
      // stationary; no physical reactions. Arsenal-side fires early on charge.
    },
    reactionCooldown: 3,
  },
  // ── Tier 2 heavy ───────────────────────────────────────────────────
  // Elites drop a bit more reliably. Cheese starts appearing here as a
  // rare bonus (permanent +1 max HP on pickup).
  // ── Tier 1.5 splitter — bridge between grunts and elites ─────────
  rot_grub: {
    hp: 20, hpMax: 20, speed: 150, r: 16,
    family: 'malady',
    resistances: _familyResist('malady'),
    ai: 'chase', attackPattern: 'touch',
    color: '#7a5a2a', icon: '🪱',
    loot: [
      { color: 'green',  chance: 0.12, min: 1, max: 2 },
      { color: 'black',  chance: 0.08, min: 1, max: 1 },
      { kind: 'gold',    chance: 1.00, min: 1, max: 2 },
      { kind: 'cheese',  chance: 0.10, min: 1, max: 1 },
    ],
    // PHASE E — mitosis_split primary (2-level recursion: 1 → 2 → 4 grubs).
    // Teaches the split mechanic before blight_worm boss fight.
    affinityColors: ['green', 'black'],
    signature: 'mitosis_split',
    splitMaxDepth: 2,
    reactions: {
      red:   'backstep',
    },
    reactionCooldown: 6,
  },
  stone_troll: {
    hp: 40, hpMax: 40, speed: 110, r: 24,
    family: 'physical',
    resistances: _familyResist('physical'),
    ai: 'heavy_melee', attackPattern: 'telegraph_swing',
    swingTelegraph: 0.6, swingDmg: 6, swingRadius: 60,
    color: '#6f6f6f', icon: '🪨',
    loot: [
      { color: 'gray',   chance: 0.15, min: 1, max: 2 },
      { color: 'orange', chance: 0.10, min: 1, max: 1 },
      { color: 'red',    chance: 0.12, min: 1, max: 1 },
      { kind: 'gold',    chance: 0.60, min: 1, max: 3 },
      { kind: 'cheese',  chance: 0.08, min: 1, max: 1 },
    ],
    // PHASE A
    affinityColors: ['gray', 'orange', 'red'],
    signature: 'boulder_toss',      // Phase E
    reactions: {
      blue:   'close_fast',
      green:  'close_fast',
      white:  'close_fast',
    },
    reactionCooldown: 4,
  },
  cursed_knight: {
    hp: 30, hpMax: 30, speed: 160, r: 20,
    family: 'physical',
    resistances: _familyResist('physical'),
    // v0.16.84 — Sentinel AI. Knight holds position (standoff) when player
    // is in range, watches for player stillness, then charges. Shield
    // rotation (see shieldTurnRate) is visible during standoff because
    // the knight isn't chasing you — vectors change direction as you
    // move around it. Full-chase behavior would defeat the shield.
    //
    // Sentinel schema (all read by rumble.js — no hardcoded values):
    //   standoffRange         — hold at this distance; approach slowly if farther
    //   chargeTriggerDelay    — sec of player stillness → charge
    //   chargeSpeed           — pixels/sec during charge (typically 2x base)
    //   chargeMaxDuration     — sec before giving up on a charge
    //   playerStillThreshold  — pixels/sec below which player is "still"
    ai: 'sentinel', attackPattern: 'telegraph_swing',
    swingTelegraph: 0.45, swingDmg: 4, swingRadius: 50,
    standoffRange: 220,
    chargeTriggerDelay: 1.2,
    chargeSpeed: 320,
    chargeMaxDuration: 1.8,
    playerStillThreshold: 60,
    color: '#4a4a6a', icon: '⚔️',
    loot: [
      { color: 'red',    chance: 0.30, min: 1, max: 1 },
      { color: 'purple', chance: 0.10, min: 1, max: 1 },
      { color: 'gray',   chance: 0.15, min: 1, max: 1 },
      { kind: 'gold',    chance: 0.60, min: 1, max: 5 },
      { kind: 'cheese',  chance: 0.17, min: 1, max: 1 },
    ],
    // PHASE A
    affinityColors: ['red', 'purple', 'gray'],
    signature: 'front_shield',      // Phase E
    // Front-shield signature parameters. Runtime code branches on
    // `signature === 'front_shield'` and reads these fields.
    // Tuning:
    //   shieldTurnRate lower  → easier to flank (bigger backstab window)
    //   shieldTurnRate higher → shield tracks aggressively, no flank
    //   v0.16.83 tuning pass: EXAGGERATED slow rate for visible testing.
    //     Math.PI / 6 = 30°/sec = 12 seconds for a full rotation.
    //     With sentinel AI (v0.16.84), rotation is finally visible
    //     because knight isn't constantly moving to face player. Circle
    //     the standoff knight tightly to see the flank window.
    shieldTurnRate: Math.PI / 6,    // rad/sec — 30°/sec (exaggerated for testing)
    shieldArcDeg: 120,              // shield covers ±60° from facing
    shieldBlockPct: 0.5,            // frontal hits take 50% damage
    shieldPierceBlockPct: 0.25,     // piercing frontal hits take 75% (weaker block)
    // v0.16.85 — Shield is the weapon. During swing wind-up the shield
    // pops out of defensive position to strike. Frontal block is
    // eliminated (0) for that window — player gets a real attack
    // opportunity. Set to e.g. 0.25 to keep partial block during
    // wind-up if the swing feels too vulnerable.
    shieldWindupBlockPct: 0,
    reactions: {
      red:    'shield_up',
      blue:   'shield_up',
      green:  'interrupt_swing',
    },
    reactionCooldown: 3,
  },
  void_wraith: {
    hp: 20, hpMax: 20, speed: 200, r: 17,
    family: 'ethereal',
    resistances: _familyResist('ethereal'),
    ai: 'teleport', attackPattern: 'touch',
    teleportCooldown: 3.0, teleportRange: 80,
    color: '#5a2e7a', icon: '👻',
    loot: [
      { color: 'purple', chance: 0.20, min: 1, max: 1 },
      { color: 'black',  chance: 0.15, min: 1, max: 1 },
      { kind: 'gold',    chance: 0.50, min: 1, max: 3 },
      { kind: 'cheese',  chance: 0.16, min: 1, max: 1 },
    ],
    // PHASE A
    affinityColors: ['purple', 'black', 'white'],
    signature: 'phase_fade',        // Phase D
    reactions: {
      red:    'teleport_away',
      green:  'teleport_away',
      blue:   'teleport_away',
      orange: 'teleport_away',
    },
    reactionCooldown: 2,            // highly reactive
  },
  // ── Bosses ─────────────────────────────────────────────────────────
  // Boss kills drop a meaningful haul: bricks + reliable gold + likely cheese.
  stone_colossus: {
    hp: 80, hpMax: 80, speed: 90, r: 32,
    family: 'physical',
    resistances: _familyResist('physical'),
    ai: 'heavy_melee', attackPattern: 'telegraph_swing',
    swingTelegraph: 0.75, swingDmg: 10, swingRadius: 80,
    color: '#565656', icon: '🗿',
    loot: [
      { color: 'gray',   chance: 0.60, min: 1, max: 3 },
      { color: 'red',    chance: 0.30, min: 1, max: 1 },
      { color: 'orange', chance: 0.35, min: 1, max: 2 },
      { color: 'purple', chance: 0.15, min: 1, max: 1 },
      { kind: 'gold',    chance: 1.00, min: 3, max: 6 },
      { kind: 'cheese',  chance: 0.45, min: 1, max: 3 },
    ],
    // PHASE A
    affinityColors: ['gray', 'red', 'orange', 'purple'],
    signature: 'enrage_phase',      // Phase E — phase 2 at 50% HP
    reactions: {
      blue:  'close_fast',
      green: 'interrupt_swing',
      white: 'close_fast',
    },
    reactionCooldown: 3,
  },
  blight_worm: {
    hp: 120, hpMax: 120, speed: 130, r: 28,
    family: 'malady',
    resistances: _familyResist('malady'),
    ai: 'heavy_melee', attackPattern: 'telegraph_swing', // true_burrow replaces in Phase E
    swingTelegraph: 0.6, swingDmg: 8, swingRadius: 70,
    color: '#3e2a1a', icon: '🪱',
    loot: [
      { color: 'green',  chance: 0.60, min: 1, max: 3 },
      { color: 'yellow', chance: 0.50, min: 1, max: 2 },
      { color: 'purple', chance: 0.35, min: 1, max: 1 },
      { color: 'black',  chance: 0.30, min: 1, max: 1 },
      { kind: 'gold',    chance: 1.00, min: 4, max: 8 },
      { kind: 'cheese',  chance: 0.50, min: 1, max: 5 },
    ],
    // PHASE A
    affinityColors: ['green', 'yellow', 'purple', 'black'],
    signature: 'true_burrow',       // Phase E + mitosis_split on death
    // mitosis_split is a secondary death behavior. Treated as a tag, not
    // a primary signature (primary drives AI, secondary fires at death).
    deathSignature: 'mitosis_split',
    splitMaxDepth: 1,
    reactions: {
      red:   'interrupt_swing',
      white: 'burrow',              // heal-denial via disengagement
    },
    reactionCooldown: 4,
  },
};

// ── Browser globals (rumble.js runs inside an IIFE and reads via window.X) ─
if (typeof window !== 'undefined') {
  window.ENTITY_REGISTRY = ENTITY_REGISTRY;
  window._familyResist = _familyResist;
}

// ── CommonJS export for server-side reuse ───────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ENTITY_REGISTRY,
    _familyResist,
  };
}
