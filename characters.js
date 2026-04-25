// ═══════════════════════════════════════════════════════════════════════
// characters.js — CANONICAL character data + combat formulas
// ═══════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for everything class-specific. Rumble, server,
// dashboard, test harness — all read from the CHARACTERS table below.
//
// Loaded BEFORE rumble.js in the HTML files. Required by server.js via Node.
// Preview and fire always agree because both derive from the same source.
//
// Adding a new class field (e.g. a new per-class stat):
//   1. Add it to CHARACTERS.
//   2. Access it everywhere via a getter (or direct read).
//   3. NEVER inline a copy elsewhere — that's the failure mode this file exists to prevent.
// ═══════════════════════════════════════════════════════════════════════

// ── CHARACTERS ──────────────────────────────────────────────────────────
// The master class table. Every piece of class-specific data lives here.
//
// Fields:
//   Identity
//     name          — display name                    ('Breaker')
//     icon          — emoji icon                      ('⚔️')
//
//   Visual
//     color         — brand color, dark, for rumble   ('#993C1D')
//                     class identification + in-combat HP bar
//     uiColor       — UI accent color, brighter, for  ('#993C1D' for Breaker)
//                     dashboard badges / selector chips / borders
//     uiBg          — translucent UI background       ('rgba(153,60,29,0.15)')
//     uiBorder      — translucent UI border           ('rgba(153,60,29,0.4)')
//
//   Combat
//     hp            — starting + max HP               (14)
//     die           — hit die for rolls               ('d8')
//     speed         — rumble movement speed px/s      (150)
//
//   Affinity (per design doc §2.2 — the canonical spec)
//     signature     — array of high-output colors     (['red', 'gray'])
//     secondary     — array of neutral colors         (['orange'])
//     (anything not listed is baseline — reduced output)
//
//   Board
//     startingKit   — brick counts at game start      ({ red: 2, gray: 1 })
//     weight        — gate-break class                ('heavy', 'mid', 'light')
//     dashBreakChance — 0..1 chance to break a gate   (1.00)
//     dashBreakDmg    — [min, max] damage range       ([0, 3])
//     dashDmgAlwaysRolls — true = always rolls,       (false)
//                         false = only on actual break
// ═══════════════════════════════════════════════════════════════════════
var CHARACTERS = {
  breaker: {
    name: 'Breaker', icon: '⚔️',
    color: '#993C1D', uiColor: '#993C1D',
    uiBg: 'rgba(153,60,29,0.15)', uiBorder: 'rgba(153,60,29,0.4)',
    hp: 14, die: 'd8', speed: 150,
    signature: ['red', 'gray'],
    secondary: ['orange'],
    startingKit: { red: 2, gray: 1 },
    weight: 'heavy', dashBreakChance: 1.00, dashBreakDmg: [0, 3], dashDmgAlwaysRolls: false,
  },
  formwright: {
    name: 'Formwright', icon: '🔮',
    color: '#3C3489', uiColor: '#534AB7',
    uiBg: 'rgba(83,74,183,0.15)', uiBorder: 'rgba(83,74,183,0.4)',
    hp: 6, die: 'd6', speed: 180,
    signature: ['blue', 'purple', 'black'],
    secondary: ['white'],
    startingKit: { blue: 2, purple: 1 },
    weight: 'light', dashBreakChance: 0.15, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
  snapstep: {
    name: 'Snapstep', icon: '🏃',
    color: '#085041', uiColor: '#1D9E75',
    uiBg: 'rgba(29,158,117,0.15)', uiBorder: 'rgba(29,158,117,0.4)',
    hp: 9, die: 'd6', speed: 260,
    signature: ['orange', 'red'],
    secondary: ['yellow'],
    startingKit: { orange: 2, red: 1 },
    weight: 'light', dashBreakChance: 0.35, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
  blocksmith: {
    name: 'Blocksmith', icon: '🔧',
    color: '#C87800', uiColor: '#EF9F27',
    uiBg: 'rgba(239,159,39,0.15)', uiBorder: 'rgba(239,159,39,0.4)',
    hp: 12, die: 'd6', speed: 150,
    signature: ['gray', 'yellow'],
    secondary: ['orange'],
    startingKit: { gray: 2, orange: 1 },
    weight: 'heavy', dashBreakChance: 1.00, dashBreakDmg: [0, 3], dashDmgAlwaysRolls: false,
  },
  fixer: {
    name: 'Fixer', icon: '💊',
    color: '#72243E', uiColor: '#D4537E',
    uiBg: 'rgba(212,83,126,0.15)', uiBorder: 'rgba(212,83,126,0.4)',
    hp: 8, die: 'd4', speed: 160,
    signature: ['white', 'black'],
    secondary: ['purple'],
    startingKit: { white: 2, black: 1 },
    weight: 'mid', dashBreakChance: 0.50, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
  wild_one: {
    name: 'Wild One', icon: '🐾',
    color: '#27500A', uiColor: '#5DA831',
    uiBg: 'rgba(93,168,49,0.15)', uiBorder: 'rgba(93,168,49,0.4)',
    hp: 10, die: 'd6', speed: 220,
    signature: ['green', 'yellow'],
    secondary: ['black'],
    startingKit: { green: 2, yellow: 1 },
    weight: 'light', dashBreakChance: 0.35, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
};

// ── DERIVED TABLES ──────────────────────────────────────────────────────
// Built from CHARACTERS above. Provide the shape existing call sites expect.
// Changing CHARACTERS auto-updates all derived tables since they're generated
// at load time. NEVER edit derived tables directly.

// PLAYER_META — consumed by server.js + game.js. Fields match legacy shape
// minus the old single-string signature/secondary (which was incomplete —
// now full arrays matching design doc §2.2).
var PLAYER_META = {};
Object.keys(CHARACTERS).forEach(function(cls) {
  var c = CHARACTERS[cls];
  PLAYER_META[cls] = {
    name: c.name, icon: c.icon, color: c.color,
    hp: c.hp, speed: c.speed, die: c.die,
    signature: c.signature, secondary: c.secondary,
    weight: c.weight, dashBreakChance: c.dashBreakChance,
    dashBreakDmg: c.dashBreakDmg, dashDmgAlwaysRolls: c.dashDmgAlwaysRolls,
  };
});

// STARTING_KIT_COUNTS — used by tapScaleMult below.
var STARTING_KIT_COUNTS = {};
Object.keys(CHARACTERS).forEach(function(cls) {
  STARTING_KIT_COUNTS[cls] = CHARACTERS[cls].startingKit;
});

// CLASS_AFFINITY — used by affinityMult / brickTier.
var CLASS_AFFINITY = {};
Object.keys(CHARACTERS).forEach(function(cls) {
  CLASS_AFFINITY[cls] = {
    signature: CHARACTERS[cls].signature,
    secondary: CHARACTERS[cls].secondary,
  };
});

// ── HELPER GETTERS ──────────────────────────────────────────────────────
// Terse accessors for the common cases. Unknown class → safe fallbacks.
function getChar(cls) { return CHARACTERS[cls] || null; }
function getCharName(cls) { return (CHARACTERS[cls] && CHARACTERS[cls].name) || cls; }
function getCharIcon(cls) { return (CHARACTERS[cls] && CHARACTERS[cls].icon) || '◆'; }
function getCharColor(cls) { return (CHARACTERS[cls] && CHARACTERS[cls].color) || '#888'; }
function getCharUiStyle(cls) {
  var c = CHARACTERS[cls];
  if (!c) return { color: '#888', bg: 'rgba(136,136,136,0.15)', border: 'rgba(136,136,136,0.4)' };
  return { color: c.uiColor, bg: c.uiBg, border: c.uiBorder };
}
function getSignature(cls) { return (CHARACTERS[cls] && CHARACTERS[cls].signature) || []; }
function getSecondary(cls) { return (CHARACTERS[cls] && CHARACTERS[cls].secondary) || []; }

// ── BASE HEAL AMOUNT ────────────────────────────────────────────────────
// The raw white-tap heal value before any multipliers are applied.
// Fixer is the dedicated healer and gets a bigger base; everyone else
// uses the standard 3. When per-class healer tuning happens, this is the
// table to update. Replaces the hardcoded `cls === 'fixer' ? 5 : 3`.
function baseHeal(cls) {
  return cls === 'fixer' ? 5 : 3;
}

// ── AFFINITY MULTIPLIER ─────────────────────────────────────────────────
// Class-color relationship multiplier. Signature colors hit harder,
// baseline (off-class) colors hit softer. Used uniformly across all
// tier-scaled outputs (damage, radius, duration, HP, charges, etc.) —
// the "per-class bonus" knob.
//   signature: ×1.25   secondary: ×1.00   baseline: ×0.80
function affinityMult(cls, color) {
  var aff = CLASS_AFFINITY[cls];
  if (!aff) return 1.0;
  if (aff.signature.indexOf(color) >= 0) return 1.25;
  if (aff.secondary.indexOf(color) >= 0) return 1.0;
  return 0.8;
}

// ── BRICK TIER ──────────────────────────────────────────────────────────
// String form of the affinity tier, for legacy callers that switch on it.
//   Returns: 'signature' | 'secondary' | 'baseline'
function brickTier(cls, color) {
  var aff = CLASS_AFFINITY[cls];
  if (!aff) return 'baseline';
  if (aff.signature.indexOf(color) >= 0) return 'signature';
  if (aff.secondary.indexOf(color) >= 0) return 'secondary';
  return 'baseline';
}

// ── TAP SCALING ─────────────────────────────────────────────────────────
// Owning more bricks of a color than your starting kit boosts output
// for that color. +10% per extra brick beyond starting count.
function tapScaleMult(cls, color, owned) {
  var starting = (STARTING_KIT_COUNTS[cls] && STARTING_KIT_COUNTS[cls][color]) || 0;
  var extra = Math.max(0, (owned || 0) - starting);
  return 1.0 + 0.10 * extra;
}

// ════════════════════════════════════════════════════════════════════════
// UNIFIED OVERLOAD PIPELINE
// ════════════════════════════════════════════════════════════════════════
// Single source of truth for every tier-scaled output (damage, radius,
// duration, HP, charges, status seed). Engine fire sites, preview
// drawers, and audit panels all call effectiveAt() — preview = payload
// guaranteed because both compute from the same function.
//
// Architecture:
//   final = BASE × COLOR[c].thing × tap × aff × tierCurve(tier)
//
// Knobs:
//   BASE       — universal yardstick. 5 means "average tier-1 output".
//   BASE_R     — universal radius (px). 50 = small AoE.
//   COLOR[c]   — per-color profile, fractions of BASE per output type.
//   tierCurve  — shared scaling curve. Linear gentle: 1 + 0.15(n-1).
//
// Class differentiation lives in affinityMult (sig/sec/base).
// Inventory ceiling is enforced upstream by the brick-spend mechanic.
// Fusion will add a fusionMult parameter when it lands.
// ════════════════════════════════════════════════════════════════════════

var BASE = 5;
var BASE_R = 50;

// Per-color output profile. Each color uses only the keys relevant to it.
// All values are FRACTIONS OF BASE — e.g. red.dmg=0.60 means red's base
// damage is 5×0.60=3 dmg before scaling. Calibrated to preserve current
// T1 numerics at canonical (level-1) inventory and aff=1.0.
var COLOR = {
  red:    { dmg: 0.60 },
  blue:   { dmg: 0.80, burstDmg: 0.40 },
  purple: { dmg: 0.60 },
  black:  { dmg: 0.20, dur: 0.60 },
  green:  { stackDmg: 0.20, stacks: 0.40 },
  white:  { heal: 0.40, dur: 0.60 },
  yellow: { dur: 0.60, confuseSeed: 0.40 },
  orange: { dmg: 0.40, bleedDur: 0.60, charges: 0.40 },
  gray:   { hp: 0.80 },
};

// Tier curve. Linear gentle: T1=1.0, T4=1.45, T8=2.05.
// Replaces the old `count × stack` multiplicative chain. Inventory cap
// (player.brickMax[color]) is enforced at the spend site, not here.
function tierCurve(tier) {
  var n = Math.max(1, tier || 1);
  return 1 + (n - 1) * 0.15;
}

// Compute every tier-scaled output for a (color, tier, class, owned)
// situation. Returns only the keys defined in COLOR[color]; callers
// pick what they need. Radius is always returned (every effect has
// some spatial footprint, including projectile impact bursts).
//
// Damage and integer fields are pre-rounded with Math.ceil/Math.round
// so call sites can use them directly. Duration fields stay floats.
function effectiveAt(color, tier, cls, owned) {
  var tap   = tapScaleMult(cls, color, owned);
  var aff   = affinityMult(cls, color);
  var curve = tierCurve(tier);
  var m     = tap * aff * curve;
  var c     = COLOR[color] || {};

  var out = { mult: m, radiusPx: BASE_R * m, tap: tap, aff: aff, curve: curve };
  if (c.dmg         != null) out.dmg         = Math.max(1, Math.ceil(BASE * c.dmg         * m));
  if (c.burstDmg    != null) out.burstDmg    = Math.max(1, Math.ceil(BASE * c.burstDmg    * m));
  if (c.heal        != null) out.heal        = Math.max(1, Math.ceil(BASE * c.heal        * m));
  if (c.stackDmg    != null) out.stackDmg    = Math.max(1, Math.ceil(BASE * c.stackDmg    * m));
  if (c.hp          != null) out.hp          = Math.max(1, Math.ceil(BASE * c.hp          * m));
  if (c.dur         != null) out.duration    = BASE * c.dur         * m;
  if (c.bleedDur    != null) out.bleedDur    = BASE * c.bleedDur    * m;
  if (c.confuseSeed != null) out.confuseSeed = BASE * c.confuseSeed * m;
  if (c.charges     != null) out.charges     = Math.max(1, Math.round(BASE * c.charges    * m));
  if (c.stacks      != null) out.stacks      = Math.max(1, Math.round(BASE * c.stacks     * m));
  return out;
}

// ── COMPUTE HEAL (compatibility wrapper) ────────────────────────────────
// Stable interface for board / server / preview callers that don't yet
// use effectiveAt directly. Returns the integer heal amount, same shape
// as before. Internally just reads effectiveAt(...).heal.
function computeHeal(cls, color, owned, overload) {
  var fx = effectiveAt(color, overload || 1, cls, owned);
  return fx.heal || 0;
}

// ── BROWSER GLOBAL EXPORTS ──────────────────────────────────────────────
// Rumble.js runs inside an IIFE and reaches for these via window.X.
if (typeof window !== 'undefined') {
  window.CHARACTERS = CHARACTERS;
  window.PLAYER_META = PLAYER_META;
  window.STARTING_KIT_COUNTS = STARTING_KIT_COUNTS;
  window.CLASS_AFFINITY = CLASS_AFFINITY;
  window.getChar = getChar;
  window.getCharName = getCharName;
  window.getCharIcon = getCharIcon;
  window.getCharColor = getCharColor;
  window.getCharUiStyle = getCharUiStyle;
  window.getSignature = getSignature;
  window.getSecondary = getSecondary;
  window.baseHeal = baseHeal;
  window.affinityMult = affinityMult;
  window.brickTier = brickTier;
  window.tapScaleMult = tapScaleMult;
  // Unified pipeline
  window.BASE = BASE;
  window.BASE_R = BASE_R;
  window.COLOR_PROFILE = COLOR;
  window.tierCurve = tierCurve;
  window.effectiveAt = effectiveAt;
  // Compatibility wrapper
  window.computeHeal = computeHeal;
}

// ── CommonJS export for server-side reuse ───────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHARACTERS,
    PLAYER_META,
    STARTING_KIT_COUNTS,
    CLASS_AFFINITY,
    getChar, getCharName, getCharIcon, getCharColor, getCharUiStyle,
    getSignature, getSecondary,
    baseHeal,
    affinityMult,
    brickTier,
    tapScaleMult,
    BASE, BASE_R,
    COLOR_PROFILE: COLOR,
    tierCurve,
    effectiveAt,
    computeHeal,
  };
}
