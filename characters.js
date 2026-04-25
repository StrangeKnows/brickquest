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

// CLASS_AFFINITY — used by affinityMult / affinityRadiusMult / brickTier.
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

// ── BRICK TIER ──────────────────────────────────────────────────────────
// Returns the affinity tier name for a class+color combination. Unlike the
// multiplier helpers above which return numbers, this returns strings that
// legacy callers switch on.
//   Returns: 'signature' | 'secondary' | 'baseline'
function brickTier(cls, color) {
  var aff = CLASS_AFFINITY[cls];
  if (!aff) return 'baseline';
  if (aff.signature.indexOf(color) >= 0) return 'signature';
  if (aff.secondary.indexOf(color) >= 0) return 'secondary';
  return 'baseline';
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
//   - Server:    when board white actions resolve.
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

// ── BROWSER GLOBAL EXPORTS ──────────────────────────────────────────────
// Rumble.js runs inside an IIFE and reaches for these via window.X. In a
// classic script tag, top-level `function foo` declarations are global
// (callable as `foo()`) but do NOT auto-attach to window.foo. We attach
// them explicitly here so the IIFE can reach them.
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
  window.affinityRadiusMult = affinityRadiusMult;
  window.brickTier = brickTier;
  window.tapScaleMult = tapScaleMult;
  window.overloadStackMult = overloadStackMult;
  window.computeHeal = computeHeal;
}

// ── CommonJS export for server-side reuse ───────────────────────────────
// Browser ignores this. Node require('./characters.js') grabs the same
// values the browser uses via globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHARACTERS,
    PLAYER_META,
    STARTING_KIT_COUNTS,
    CLASS_AFFINITY,
    getChar, getCharName, getCharIcon, getCharColor, getCharUiStyle,
    getSignature, getSecondary,
    baseHeal,
    affinityMult, affinityRadiusMult,
    brickTier,
    tapScaleMult,
    overloadStackMult,
    computeHeal,
  };
}
