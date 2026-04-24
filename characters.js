// ═══════════════════════════════════════════════════════════════════════
// characters.js — canonical character data + combat formulas
// ═══════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for class-driven combat math.
//
// Loaded BEFORE rumble.js in players.html and test_players.html. Both the
// dashboard (where actions PREVIEW) and rumble (where actions FIRE) read
// from this file — same inputs always produce the same answer.
//
// Adding a new formula or per-class number:
//   1. Define here.
//   2. Use everywhere via the helper functions.
//   3. NEVER inline a copy elsewhere — that's the failure mode this file exists to prevent.
//
// Phase 1 scope (current): heal-related formulas + the data they need.
// Phase 2 (queued): consolidate PLAYER_META / CLASS_META / CLASS_SIGNATURE
// duplicates into this file, replace hardcoded class checks throughout.
// Phase 3 (queued): server-side reuse via Node require().
// ═══════════════════════════════════════════════════════════════════════

// ── STARTING KIT COUNTS ─────────────────────────────────────────────────
// Number of bricks per color a class begins the game with. Used by
// tapScaleMult to compute how many extras the player has earned (which
// permanently scales their output). When a class's starting kit changes,
// this table is the one place to update.
var STARTING_KIT_COUNTS = {
  breaker:     { red: 2, gray: 1 },
  formwright:  { blue: 2, purple: 1 },
  snapstep:    { orange: 2, red: 1 },
  blocksmith:  { gray: 2, orange: 1 },
  fixer:       { white: 2, black: 1 },
  wild_one:    { green: 2, yellow: 1 },
};

// ── CLASS AFFINITY (signature / secondary / baseline) ───────────────────
// Each class has TWO signature colors (highest output, fastest refresh)
// and TWO secondary colors (neutral output, medium refresh). Everything
// else is baseline (reduced output, slow refresh).
//
// Phase 2 will fold this into a unified CHARACTERS table alongside name,
// icon, HP, die, speed. For Phase 1, isolated here so combat formulas
// are self-contained.
var CLASS_AFFINITY = {
  breaker:     { signature: ['red',    'gray'],   secondary: ['orange', 'yellow'] },
  formwright:  { signature: ['blue',   'purple'], secondary: ['black',  'white']  },
  snapstep:    { signature: ['orange', 'red'],    secondary: ['yellow', 'green']  },
  blocksmith:  { signature: ['gray',   'orange'], secondary: ['red',    'yellow'] },
  fixer:       { signature: ['white',  'black'],  secondary: ['purple', 'green']  },
  wild_one:    { signature: ['green',  'yellow'], secondary: ['orange', 'blue']   },
};

// ── BASE HEAL AMOUNT ────────────────────────────────────────────────────
// The raw white-tap heal value before any multipliers are applied.
// Fixer is the dedicated healer and gets a bigger base; everyone else
// uses the standard 3. When per-class healer tuning happens, this is the
// table to update. Replaces the hardcoded `cls === 'fixer' ? 5 : 3`.
function baseHeal(cls) {
  return cls === 'fixer' ? 5 : 3;
}

// ── AFFINITY MULTIPLIER ─────────────────────────────────────────────────
// Multiplier applied to amounts/durations/radii based on the relationship
// between the class and the color being used. Signature colors hit harder,
// baseline (off-class) colors hit softer.
//   signature: ×1.25   secondary: ×1.00   baseline: ×0.80
function affinityMult(cls, color) {
  var aff = CLASS_AFFINITY[cls];
  if (!aff) return 1.0;
  if (aff.signature.indexOf(color) >= 0) return 1.25;
  if (aff.secondary.indexOf(color) >= 0) return 1.0;
  return 0.8;
}

// ── AFFINITY RADIUS MULTIPLIER ──────────────────────────────────────────
// Same concept as affinityMult, but tuned for AoE RADIUS specifically.
// Signature gets a gentler 1.10× (vs 1.25× for amounts) — preventing
// signature-color AoE radii from ballooning to screen-filling sizes on
// overloads when compounded with tapScale + overloadStack.
//   signature: ×1.10   secondary: ×1.00   baseline: ×0.80
//
// Sites that compute a RADIUS from affinity should use this helper;
// damage/heal/duration amounts keep the regular affinityMult.
function affinityRadiusMult(cls, color) {
  var aff = CLASS_AFFINITY[cls];
  if (!aff) return 1.0;
  if (aff.signature.indexOf(color) >= 0) return 1.10;
  if (aff.secondary.indexOf(color) >= 0) return 1.0;
  return 0.8;
}

// ── TAP SCALING ─────────────────────────────────────────────────────────
// Owning more bricks of a color than your starting kit permanently boosts
// output for that color. +10% per extra brick beyond starting count.
// Compounds with overload (overload multiplies off the scaled base).
//
// Caller passes `owned` directly (player.brickMax in rumble, me.bricks
// on the board) so this works regardless of where the inventory state lives.
function tapScaleMult(cls, color, owned) {
  var starting = (STARTING_KIT_COUNTS[cls] && STARTING_KIT_COUNTS[cls][color]) || 0;
  var extra = Math.max(0, (owned || 0) - starting);
  return 1.0 + 0.10 * extra;
}

// ── OVERLOAD STACK MULTIPLIER ───────────────────────────────────────────
// Spending multiple charges in one cast bonuses output beyond linear.
// Tier 2 (2 charges): +20%, Tier 3: +40%, Tier 4: +60%.
// Single-charge taps return 1.0 (no overload bonus, no fatigue).
function overloadStackMult(count) {
  if (!count || count < 2) return 1.0;
  return 1.0 + (count - 1) * 0.2;
}

// ── COMPUTE HEAL ────────────────────────────────────────────────────────
// Canonical heal-amount calculation. Used by:
//   - Rumble:    when a white tap or overload heal fires.
//   - Dashboard: when the hold-gesture overlay previews a heal amount.
//   - Server:    (Phase 3) when board white actions resolve.
//
// Inputs:
//   cls          — class id ('fixer', 'breaker', etc.)
//   color        — brick color ('white' for heal; future colors as designed)
//   owned        — total bricks of `color` the player owns (for tap scaling)
//   overload     — overload count (1 = tap, 2..N = overload tier)
// Returns: integer heal amount (rounded up).
function computeHeal(cls, color, owned, overload) {
  var count = Math.max(1, overload || 1);
  return Math.ceil(
    baseHeal(cls)
    * tapScaleMult(cls, color, owned)
    * count
    * overloadStackMult(count)
    * affinityMult(cls, color)
  );
}

// ── CommonJS export (server-side reuse, future) ─────────────────────────
// Browser ignores this. Node can require('./characters.js') and access
// the same functions. Phase 3 work will wire this up server-side.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STARTING_KIT_COUNTS,
    CLASS_AFFINITY,
    baseHeal,
    affinityMult,
    affinityRadiusMult,
    tapScaleMult,
    overloadStackMult,
    computeHeal,
  };
}
