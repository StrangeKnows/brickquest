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
//     dashDmgAlwaysRolls — true = always damages,     (false)
//                          false = only on actual break
//
//     REVISIT (S015) — the player-side red-dash UI button was stripped in the
//     S015 cleanup pass. dashBreakChance/Dmg/AlwaysRolls are still consumed by
//     server.js resolveDash and remain functional via DM controls. When the
//     brick-bar action overhaul lands, consider whether to keep probabilistic
//     dash-break or move to deterministic class-based outcomes.
// ═══════════════════════════════════════════════════════════════════════
var CHARACTERS = {
  breaker: {
    name: 'Breaker', icon: '⚔️',
    color: '#993C1D', uiColor: '#993C1D',
    uiBg: 'rgba(153,60,29,0.15)', uiBorder: 'rgba(153,60,29,0.4)',
    hp: 14, speed: 150,
    signature: ['red', 'gray'],
    secondary: ['orange'],
    startingKit: { red: 2, gray: 1 },
    weight: 'heavy', dashBreakChance: 1.00, dashBreakDmg: [0, 3], dashDmgAlwaysRolls: false,
  },
  formwright: {
    name: 'Formwright', icon: '🔮',
    color: '#3C3489', uiColor: '#534AB7',
    uiBg: 'rgba(83,74,183,0.15)', uiBorder: 'rgba(83,74,183,0.4)',
    hp: 6, speed: 180,
    signature: ['blue', 'purple', 'black'],
    secondary: ['white'],
    startingKit: { blue: 2, purple: 1 },
    weight: 'light', dashBreakChance: 0.15, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
    // Purple signature: drag-and-drop teleports player to the drop point,
    // fires DUAL blasts at scaled radii. Tap or hold-release on bar (no
    // drag) plays as a normal purple burst at self. Per design doc §2.3
    // (FW PURPLE: teleport on tap/drag target, dual blast at each end).
    // Engine reads this via getPurpleProfile(cls); other classes return null.
    //
    // Warp sequence (1000ms total, all phases relative to drag release):
    //   t=0      origin blast fires + departure pulse begins + alpha 1→0
    //   t=200    player invisible, particles in transit
    //   t=500    player snaps to target + alpha 0→1 + target blast fires
    //            + arrival pulse begins
    //   t=650    player fully visible, arrival pulse continues
    //   t=1000   arrival pulse ends, sequence complete
    // Invuln applies for the entire 1000ms (depart + transit + arrive).
    purpleProfile: {
      teleport: true,
      targetScale: 1.3,        // drop-location blast: 130% radius + damage
      originScale: 0.7,        // origin blast: 70% radius + damage (fires at t=0)
      fadeOutMs: 200,          // departure: player alpha 1→0
      transitMs: 300,          // 200→500: invisible, particles in flight
      fadeInMs: 150,           // arrival: player alpha 0→1
      arrivalInvulnMs: 350,    // 650→1000: post-arrival safety window
      trailDensity: 6,         // particles per frame during fadeOut + transit
    },
  },
  snapstep: {
    name: 'Snapstep', icon: '🏃',
    color: '#085041', uiColor: '#1D9E75',
    uiBg: 'rgba(29,158,117,0.15)', uiBorder: 'rgba(29,158,117,0.4)',
    hp: 9, speed: 260,
    signature: ['orange', 'red'],
    secondary: ['yellow'],
    startingKit: { orange: 2, red: 1 },
    weight: 'light', dashBreakChance: 0.35, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
  blocksmith: {
    name: 'Blocksmith', icon: '🔧',
    color: '#C87800', uiColor: '#EF9F27',
    uiBg: 'rgba(239,159,39,0.15)', uiBorder: 'rgba(239,159,39,0.4)',
    hp: 12, speed: 150,
    signature: ['gray', 'yellow'],
    secondary: ['orange'],
    startingKit: { gray: 2, orange: 1 },
    weight: 'heavy', dashBreakChance: 1.00, dashBreakDmg: [0, 3], dashDmgAlwaysRolls: false,
  },
  fixer: {
    name: 'Fixer', icon: '💊',
    color: '#72243E', uiColor: '#D4537E',
    uiBg: 'rgba(212,83,126,0.15)', uiBorder: 'rgba(212,83,126,0.4)',
    hp: 8, speed: 160,
    signature: ['white', 'black'],
    secondary: ['purple'],
    startingKit: { white: 2, black: 1 },
    weight: 'mid', dashBreakChance: 0.50, dashBreakDmg: [1, 2], dashDmgAlwaysRolls: true,
  },
  wild_one: {
    name: 'Wild One', icon: '🐾',
    color: '#27500A', uiColor: '#5DA831',
    uiBg: 'rgba(93,168,49,0.15)', uiBorder: 'rgba(93,168,49,0.4)',
    hp: 10, speed: 220,
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
    hp: c.hp, speed: c.speed,
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

// Class-specific purple cast profile. Returns the profile object when the
// class has signature purple behavior (FW teleport dual-blast), null
// otherwise. Engine call sites (rumble.js doFwTeleportPurple, drag indicator
// preview) read this to decide whether to apply teleport mechanics.
function getPurpleProfile(cls) {
  return (CHARACTERS[cls] && CHARACTERS[cls].purpleProfile) || null;
}

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
  // Blue gets a per-color radius profile: smaller T1 anchor + steeper
  // tier slope. Tap-drag impact at T1 used to feel oversized (63px); this
  // brings it down to ~46px and grows more visibly per overload tier.
  // Other knobs (dmg, burstDmg) remain in the universal pipeline.
  blue: {
    dmg: 0.80,
    burstDmg: 0.40,
    radiusBase: 37,    // overrides global BASE_R (50)
    radiusSlope: 0.30, // overrides global tierCurve slope (0.15) for radius only
  },
  purple: { dmg: 0.60 },
  black:  { dmg: 0.20, dur: 0.60, witherDmg: 0.40, witherStacks: 0.20 },
  green:  { stackDmg: 0.20, stacks: 0.40 },
  // White uses a custom tier function instead of universal m-based scaling.
  // Heal-over-time accumulates discretely, so universal m can't deliver
  // strict integer growth without plateaus. Same effectiveAt interface,
  // different per-tier shape. Class affinity and inventory still multiply
  // on top of these raw values.
  //
  //   total      = BASE + (tier-1) × 2     →  5, 7, 9, 11, ..., 23  (strict +2)
  //   burst      = ceil(total / 2)         →  3, 4, 5, 6, ..., 12   (strict +1)
  //   fieldPool  = total - burst           →  2, 3, 4, 5, ..., 11   (strict +1)
  //   tickValue  = floor(burst / 2)        →  1, 2, 2, 3, ..., 6    (gentle ramp)
  //   ticks      = ceil(fieldPool / tickV) →  derived
  //   duration   = ticks × 0.5             →  1.0s flat at low tier, grows late
  //
  // Self-cast: target receives `burst` instantly, field follows target
  //   with `fieldPool` HP available for OTHER allies in radius (HoT).
  // Drag-far: no burst, stationary field with `total` HP available
  //   for anyone who enters (HoT).
  // Crit: burst × 2 (matches red/blue/gray convention).
  white: {
    customTierFn: function(tier) {
      var n = Math.max(1, tier || 1);
      var total      = BASE + (n - 1) * 2;
      var burst      = Math.ceil(total / 2);
      var fieldPool  = total - burst;
      var tickValue  = Math.max(1, Math.floor(burst / 2));
      var ticks      = Math.max(1, Math.ceil(fieldPool / tickValue));
      return {
        burst:     burst,      // instant heal to self-cast target (pre-affinity)
        heal:      tickValue,  // per-tick value for allies in field (pre-affinity)
        totalHeal: total,      // total HP this cast can deliver (pre-affinity)
        fieldPool: fieldPool,  // HoT pool after burst (pre-affinity)
        ticks:     ticks,
        duration:  ticks * 0.5,
      };
    }
  },
  yellow: { dur: 0.60, yellowSeed: 0.40 },
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

  // Per-color radius profile. If a color sets its own radiusBase and/or
  // radiusSlope, those override the universal BASE_R and tierCurve for
  // RADIUS ONLY (damage and other outputs still use the universal m).
  // Class affinity and tap-scale still multiply on top.
  //
  // Use case: blue's tap-drag impact felt oversized at T1 with the
  // universal pipeline (63px). Custom profile (37/0.30) lands at 46px T1
  // and grows ~14px/tier, hitting 171px at T10 — clearly perceptible
  // tier-up while keeping the unified architecture (color profile is the
  // single source of truth).
  var rBase  = (c.radiusBase  != null) ? c.radiusBase  : BASE_R;
  var rSlope = (c.radiusSlope != null) ? c.radiusSlope : 0.15;
  var radiusCurve = 1 + (Math.max(1, tier) - 1) * rSlope;
  var radiusMult = tap * aff * radiusCurve;

  var out = { mult: m, radiusPx: rBase * radiusMult, tap: tap, aff: aff, curve: curve };

  // Custom per-color tier scaling (currently white). Heal-over-time needs
  // integer total HP with strict monotonic growth, which universal m-based
  // math can't provide due to ceil-collision plateaus. Custom function
  // returns the relevant integer outputs directly; affinity × tap still
  // multiply on top so class identity and inventory progression are honored.
  if (c.customTierFn) {
    var custom = c.customTierFn(tier);
    var classMult = aff * tap; // skip tierCurve since custom owns the curve
    if (custom.heal      != null) out.heal       = Math.max(1, Math.ceil(custom.heal      * classMult));
    if (custom.burst     != null) out.burst      = Math.max(1, Math.ceil(custom.burst     * classMult));
    if (custom.fieldPool != null) out.fieldPool  = Math.max(1, Math.ceil(custom.fieldPool * classMult));
    if (custom.totalHeal != null) out.totalHeal  = Math.max(1, Math.ceil(custom.totalHeal * classMult));
    if (custom.ticks     != null) out.ticks      = custom.ticks; // tick count is structural, not class-scaled
    if (custom.duration  != null) out.duration   = custom.duration;
    return out;
  }

  if (c.dmg         != null) out.dmg         = Math.max(1, Math.ceil(BASE * c.dmg         * m));
  if (c.burstDmg    != null) out.burstDmg    = Math.max(1, Math.ceil(BASE * c.burstDmg    * m));
  if (c.heal        != null) out.heal        = Math.max(1, Math.ceil(BASE * c.heal        * m));
  if (c.stackDmg    != null) out.stackDmg    = Math.max(1, Math.ceil(BASE * c.stackDmg    * m));
  if (c.hp          != null) out.hp          = Math.max(1, Math.ceil(BASE * c.hp          * m));
  if (c.witherDmg   != null) out.witherDmg   = Math.max(1, Math.ceil(BASE * c.witherDmg   * m));
  if (c.dur         != null) out.duration    = BASE * c.dur         * m;
  if (c.bleedDur    != null) out.bleedDur    = BASE * c.bleedDur    * m;
  if (c.yellowSeed != null) out.yellowSeed = BASE * c.yellowSeed * m;
  if (c.charges     != null) out.charges     = Math.max(1, Math.round(BASE * c.charges    * m));
  if (c.stacks      != null) out.stacks      = Math.max(1, Math.round(BASE * c.stacks     * m));
  if (c.witherStacks!= null) out.witherStacks= Math.max(1, Math.round(BASE * c.witherStacks* m));
  return out;
}

// ── COMPUTE HEAL (compatibility wrapper) ────────────────────────────────
// Stable interface for board / server / preview callers that don't yet
// use effectiveAt directly. For white (heal-over-time field), returns
// totalHeal — the full HP delivered over the field's lifetime, which is
// the closest analog to "the heal amount of one cast." For any other
// healing color (none today), falls back to .heal.
function computeHeal(cls, color, owned, overload) {
  var fx = effectiveAt(color, overload || 1, cls, owned);
  return fx.totalHeal || fx.heal || 0;
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
  window.getPurpleProfile = getPurpleProfile;
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
    getSignature, getSecondary, getPurpleProfile,
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
