// ═══════════════════════════════════════════════════════════════════════
// rumble.js — BrickQuest real-time combat module
// ═══════════════════════════════════════════════════════════════════════
// Public API (exposed as window.Rumble):
//
//   Lifecycle:
//     init(options)         options: { onEvent: fn(type,data) }
//                           Hooks up canvas, input listeners, emits 'ready'.
//     teardown()            Cleans up everything. Safe to call multiple times.
//
//   Control:
//     start(config)         config: { cls, hp, hpMax, armor, bricks }
//                           Begins a battle; emits 'start', then 'tick'/'victory'/'defeat'/etc.
//     setPauseState(paused) true = pause, false = resume
//     forceEnd(reason)      reason: 'quit' | 'timeout' | 'dm-reset' | custom
//
//   Queries:
//     isActive()            boolean; is a battle currently running?
//     getState()            snapshot: { playerHp, playerArmor, playerBricks,
//                                       enemyHp, enemyHpMax, elapsed, status }
//     getConfig()           returns a copy of the last config passed to start()
//     getDebugInfo()        verbose internal state (particle counts, etc.)
//
//   DM tools:
//     injectBricks(delta)   delta: { red: 2, gray: -1, ... } — adjusts player bricks
//     setPlayerHP(n)        clamp to [0, hpMax]
//     setEnemyHP(n)         clamp to [0, enemy.hpMax] — targets first living entity
//
// Events emitted via options.onEvent(type, data):
//   'ready'    — module initialized
//   'start'    — battle began             data: { cls }
//   'tick'     — periodic state snapshot  data: getState()
//   'pause'    'resume'
//   'playerHit'  data: { amount }
//   'enemyHit'   data: { amount }
//   'playerDown' 'enemyKilled'
//   'victory' 'defeat' 'timeout' 'quit'   data: { reason? }
//   'end'      — always fires after 'victory'/'defeat'/'timeout'/'quit'. data: { reason }
//
// DOM requirements on the host page:
//   Required:
//     <canvas id="rumble-canvas"></canvas>
//     <div id="rumble-brick-bar-left"></div>
//     <div id="rumble-brick-bar-right"></div>
//   Optional (only rendered if present):
//     <div id="rumble-hud">…<span id="rumble-timer-display"></span>…</div>
//     <div id="rumble-debug"></div>
//
// Legacy: if #rumble-brick-bar exists (single container), all 9 bricks render there.
//
// CSS:
//   <link rel="stylesheet" href="rumble.css">
// ═══════════════════════════════════════════════════════════════════════

(function() {
'use strict';

// ═══════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════
const RUMBLE_DURATION = 30; // seconds (30 for real game, 5 placeholder)

// Combat & Economy v1 spec. See NOTES.md for full design doc.
const BRICK_ECONOMY = {
  refreshRates: { signature: 3.0, secondary: 5.0, baseline: 10.0 },
};

// Class-color affinity tier. Returns 'signature' | 'secondary' | 'baseline'.
// Canonical data lives in characters.js (CLASS_AFFINITY table).
function brickTier(cls, color) {
  return window.brickTier ? window.brickTier(cls, color) : 'baseline';
}

// ── COMBAT FORMULA WRAPPERS ─────────────────────────────────────────────
// These functions are THIN WRAPPERS over characters.js (the canonical
// source). They preserve the 1-argument call signatures used throughout
// rumble (affinityMult('white'), tapScaleMult('white'), etc.) by reading
// player.cls and player.brickMax internally. The actual formulas live
// in characters.js; if values need tuning, edit there, not here.
function affinityMult(color) {
  if (!player) return 1.0;
  return window.affinityMult(player.cls, color);
}

function affinityRadiusMult(color) {
  if (!player) return 1.0;
  return window.affinityRadiusMult(player.cls, color);
}

function overloadStackMult(count) {
  return window.overloadStackMult(count);
}

function tapScaleMult(color) {
  if (!player || !player.brickMax) return 1.0;
  var owned = player.brickMax[color] || 0;
  return window.tapScaleMult(player.cls, color, owned);
}

// Crit chance: base 10% + 8% per extra brick in overload, +/- affinity bonus.
// Tap is treated as count=1 (just the base + affinity).
//   signature: +5%, secondary: 0%, baseline: -3%
// Clamped 0-0.99 so there's always a chance to miss (never guaranteed).
function critChance(color, count) {
  if (!player) return 0;
  var n = count || 1;
  var base = 0.10 + 0.08 * Math.max(0, n - 1);
  var tier = brickTier(player.cls, color);
  var bonus = tier === 'signature' ? 0.05 : tier === 'baseline' ? -0.03 : 0;
  return Math.max(0, Math.min(0.99, base + bonus));
}

// Roll a crit for a given color+count. Returns true if crit fires.
// Called at the moment a cast is dispatched. Threshold EFFECTS are applied
// downstream based on this boolean (see threshold handlers per color).
// Crit stats debug — tracks recent rolls for player visibility.
// Toggle CRIT_DEBUG to true to log to console and overlay the panel.
var CRIT_DEBUG = true;
// Toggle FLOATER_DEBUG to true in browser console (or here) to log every
// damage/floater spawn with: text, tier, parent type, side, spawn coords,
// parent radius. Useful for diagnosing placement issues (collisions,
// clipping, wrong side).
var FLOATER_DEBUG = false;
var _critStats = { total: 0, crits: 0, perColor: {} };

// Per-battle stats — populated during combat, consumed by victory screen.
// Reset at _internalStart, read at _internalEnd.
var _battleStats = {
  startedAt: 0,
  endedAt: 0,
  damageDealt: 0,
  damageTaken: 0,
  armorAbsorbed: 0,
  bricksUsed: {},       // { red: 3, orange: 1, ... } — spent
  bricksGained: {},     // { red: 1, cheese: 1, ... } — looted (kind: 'cheese', 'gold' included)
  goldGained: 0,
  cheeseEaten: 0,
  enemiesKilled: [],    // array of entity types slain
  critsLanded: 0,
  overloadsFired: 0,
  hpLow: 9999,          // lowest hp reached during battle (for 'flawless' tier)
  // Active-combat tracking — accumulated time during which the player has
  // dealt damage in the last ACTIVE_COMBAT_WINDOW_MS. Used for "active DPS"
  // (damage rate during engagement, not corrupted by idle gaps).
  activeCombatMs: 0,
  _lastDamageAt: 0,
  // Damage source/target attribution for run-summary tuning analysis
  damageByColor: {},    // { red: 247, purple: 102, ... }
  damageByTarget: {},   // { goblin: 96, stone_troll: 240, ... }
};

function _addBrickStat(bucket, color, amount) {
  if (!bucket || !color) return;
  bucket[color] = (bucket[color] || 0) + (amount || 1);
}

function rollCrit(color, count) {
  var chance = critChance(color, count);
  var roll = Math.random();
  var hit = roll < chance;
  if (hit && _battleStats) _battleStats.critsLanded++;
  if (CRIT_DEBUG) {
    _critStats.total++;
    if (hit) _critStats.crits++;
    if (!_critStats.perColor[color]) _critStats.perColor[color] = { total: 0, crits: 0 };
    _critStats.perColor[color].total++;
    if (hit) _critStats.perColor[color].crits++;
    if (typeof console !== 'undefined') {
      console.log('[CRIT] ' + color + ' count=' + count + ' chance=' + (chance*100).toFixed(0) + '% roll=' + (roll*100).toFixed(0) + '% → ' + (hit ? 'HIT' : 'miss') + ' (cumulative ' + _critStats.crits + '/' + _critStats.total + ' = ' + Math.round(_critStats.crits/_critStats.total*100) + '%)');
    }
  }
  return hit;
}

// Display scale: 0.60 (phones) to 1.00 (desktops). Smooth-interpolated.
// Reference = smaller of viewport W/H so tall portrait phones still scale down.
// Used to shrink player radius, entity radius, and aggro ranges on small screens.
function getDisplayScale() {
  var ref = Math.min(W || window.innerWidth || 800, H || window.innerHeight || 600);
  if (ref <= 400)  return 0.60;
  if (ref >= 1100) return 1.00;
  if (ref <= 700)  return 0.60 + (ref - 400) / 300 * 0.20; // 0.60 -> 0.80 over 400-700
  return 0.80 + (ref - 700) / 400 * 0.20;                   // 0.80 -> 1.00 over 700-1100
}

// Scale a pixel distance by the current display scale. Used for targeting
// thresholds, effect radii, burst sizes. Called per-frame but cheap.
function scaleDist(px) {
  return px * getDisplayScale();
}

const BRICK_COLORS = {
  red:'#E24B4A', blue:'#006DB7', green:'#1D9E75', white:'#EFEFEF',
  gray:'#AAAAAA', purple:'#7B2FBE', yellow:'#F5D000', orange:'#F57C00',
  black:'#6a5870'  // dark slate-purple — readable against #0a0a0f, retains "darkest brick" identity, purple cast hints at curse role
};

// ═══════════════════════════════════════════════════
// CRIT VISUAL POLISH
// Universal signature: screen flash + banner + haptic. Each color also has
// a set of rotating flavor text lines so the same banner doesn't repeat.
// Per-color visual flourishes (unique per-crit particle effects) live in
// the individual handler functions where the effect is applied.
// ═══════════════════════════════════════════════════

// Rotating flavor text per color — 6 lines each, thematically linked to
// color properties and damage family. Picked randomly at crit time.
//   Physical family (red / gray / orange) — force, mass, impact, shrapnel.
//   Ethereal family (blue / purple / white) — precision, magic, light.
//   Malady family   (yellow / green / black) — mind, rot, decay.
var CRIT_FLAVOR = {
  // Physical
  red:    ['CRUSHING BLOW!',  'SHATTERING IMPACT!', 'BONE-BREAKER!',    'DEVASTATION!',     'RAMMING FORCE!',   'PULVERIZED!'],
  orange: ['SHRAPNEL!',       'THORN STORM!',       'EXPLOSIVE TRAP!',  'SCATTERED DEATH!', 'SHREDDING BURST!', 'SPLINTERED!'],
  gray:   ['REINFORCE!',      'BULWARK!',           'UNBREAKABLE!',     'IRON RESOLVE!',    'STONEWALL!',       'FORTRESS!'],
  // Ethereal
  blue:   ['MARKED!',         'WEAKNESS FOUND!',    'PRECISION STRIKE!','TARGET EXPOSED!',  'LANCE OF TRUTH!',  'PIERCED!'],
  purple: ['SILENCE!',        'MAGIC SEVERED!',     'VOICELESS!',       'NULLIFIED!',       'ARCANE RUPTURE!',  'UNMADE!'],
  white:  ['BLESSING!',       'SANCTIFIED!',        'THE LIGHT PURGES!','GRACE ABOUNDS!',   'HALLOWED!',        'RADIANT!'],
  // Malady
  yellow: ['DAZE!',           'MIND UNSPOOLED!',    'REELING!',         'COMPLETELY LOST!', 'SENSES SHATTERED!','BEFOGGED!'],
  green:  ['NECROSIS!',       'ROTTING WOUND!',     'VIRULENT!',        'DECAY SETS IN!',   'PUTREFIED!',       'CORRUPTED!'],
  black:  ['DEEP WITHER!',    'CURSED!',            'DECAY UNLEASHED!', 'THE ROT SPREADS!', 'VOID-TOUCHED!',    'UNMAKING!'],
};

function pickCritFlavor(color) {
  var lines = CRIT_FLAVOR[color] || ['CRIT!'];
  return lines[Math.floor(Math.random() * lines.length)];
}

// Screen flash overlay. Fades quickly (150-200ms) so it flashes and clears.
// Stored as state and drawn each frame during its lifetime.
var critFlash = null; // { color, alpha, timer, duration }

function triggerCritFlash(color) {
  var hex = BRICK_COLORS[color] || '#FFD700';
  critFlash = { color: hex, alpha: 0.35, timer: 0.18, duration: 0.18 };
}

function updateCritFlash(dt) {
  if (!critFlash) return;
  critFlash.timer -= dt;
  if (critFlash.timer <= 0) { critFlash = null; return; }
  critFlash.alpha = 0.35 * (critFlash.timer / critFlash.duration);
}

function drawCritFlash() {
  if (!critFlash || !ctx) return;
  ctx.save();
  ctx.globalAlpha = critFlash.alpha;
  ctx.fillStyle = critFlash.color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Big banner — used for crit name. Different from showFloatingText: larger
// font, stronger glow, longer lifetime, slight vertical rise.
var critBanners = []; // { x, y, text, color, alpha, timer, duration, rise }

function spawnCritBanner(x, y, text, color) {
  critBanners.push({
    x: x, y: y,
    text: text,
    color: color || '#FFD700',
    alpha: 1.0,
    timer: 1.4,
    duration: 1.4,
    rise: 0,
  });
}

function updateCritBanners(dt) {
  critBanners = critBanners.filter(function(b) { return b.timer > 0; });
  critBanners.forEach(function(b) {
    b.timer -= dt;
    b.rise += 30 * dt; // gentle upward drift
    b.alpha = Math.max(0, Math.min(1, b.timer / (b.duration * 0.6)));
  });
}

function drawCritBanners() {
  if (!ctx || !critBanners.length) return;
  var fontPx = Math.max(14, Math.round(26 * getDisplayScale()));
  critBanners.forEach(function(b) {
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.font = 'bold ' + fontPx + 'px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 20 * getDisplayScale();
    ctx.lineWidth = Math.max(2, 3 * getDisplayScale());
    ctx.strokeStyle = '#000';
    ctx.strokeText(b.text, b.x, b.y - b.rise);
    ctx.fillText(b.text, b.x, b.y - b.rise);
    ctx.restore();
  });
}

// Haptic ping on mobile — short vibration when a crit fires. No-op on
// platforms without the vibrate API (desktop, unsupported browsers).
function hapticCrit() {
  try {
    if (navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(30);
    }
  } catch (e) { /* ignore */ }
}

// Unified crit-signature trigger. Call this when a crit fires to get all
// three of: screen flash, banner text, haptic. Per-color particle flair
// is layered inside the individual handlers.
function triggerCritSignature(color, x, y) {
  triggerCritFlash(color);
  spawnCritBanner(x, y, pickCritFlavor(color), BRICK_COLORS[color] || '#FFD700');
  hapticCrit();
}

// Crit shockwave rings — expanding color-tinted rings used as per-color
// flourish by multiple colors (red, gray, black, etc). Configurable start
// radius, max radius, color, ring thickness.
var critShockwaves = [];

function spawnCritShockwave(x, y, color, opts) {
  var o = opts || {};
  critShockwaves.push({
    x: x, y: y,
    r: o.r0 || 8,
    maxR: o.maxR || scaleDist(160),
    color: color || '#FFD700',
    thickness: o.thickness || 3,
    alpha: 1.0,
    growth: o.growth || 260,  // px/s
    fadeRate: o.fadeRate || 2.2,
  });
}

function updateCritShockwaves(dt) {
  critShockwaves = critShockwaves.filter(function(s) { return s.alpha > 0.02 && s.r < s.maxR; });
  critShockwaves.forEach(function(s) {
    s.r += s.growth * dt;
    s.alpha -= s.fadeRate * dt;
  });
}

function drawCritShockwaves() {
  if (!ctx) return;
  var scale = getDisplayScale();
  critShockwaves.forEach(function(s) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.alpha);
    ctx.strokeStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 16 * scale;
    ctx.lineWidth = Math.max(1.2, s.thickness * scale);
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  });
}

// Generic per-color flourish burst. Spawns `n` color-tinted particles
// radially from a point. Used for quick visual punctuation on crits.
// Count scales down on small screens so dense bursts stay readable.
function spawnCritFlourish(x, y, color, n) {
  var scale = getDisplayScale();
  var count = Math.max(4, Math.round((n || 18) * scale));
  for (var i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    var speed = (40 + Math.random() * 180) * scale;
    purpleParticles.push({
      x: x, y: y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: (2 + Math.random() * 3) * scale,
      alpha: 0.95,
      color: color,
    });
  }
}

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
var canvas, ctx, W, H;
var running = false;
var rafId = null;
// v4: While the revive minigame overlay is active, gameplay systems (movement,
// enemy AI, damage, timer, loot) are frozen. `running` stays true (so _internalEnd
// isn't triggered prematurely) but _revivePaused gates every per-tick side-effect.
var _revivePaused = false;
// S013.1: post-victory brick-refill boost. Set true when victory screen is shown,
// cleared at rumble end. While true, brick regen rate is multiplied so empty pips
// fill visibly during the victory card display.
var _victoryRefillActive = false;
var lastTs = 0;
var cfg = null; // last start(config) object

var player = null;
var entities = [];
var deadEntities = [];
var pendingVictory = 0; // countdown to victory screen
var rumble = {};
var timerLeft = RUMBLE_DURATION;
var timerInterval = null;

// Touch/drag state
var dragActive = false;
var dragTarget = null;

// Dash state
var dashCooldown = 0;
var dashActive = false;
var dashTarget = null;
var dashEntity = null;
var dashSpeed = 0;
var DASH_DURATION = 0.75; // distance = dashSpeed * 0.75 px
var dashTimer = 0;

// Double-tap detection
var lastTapTime = 0;
var lastTapPos = null;
var DOUBLE_TAP_MS = 300;
var DOUBLE_TAP_DIST = 60; // max px between taps to count as double-tap

// ═══════════════════════════════════════════════════
// PLAYER OBJECT
// ═══════════════════════════════════════════════════
function makePlayer(cls) {
  var meta = window.CHARACTERS ? window.CHARACTERS[cls] : null;
  if (!meta) { console.warn('[BQ-RUMBLE] makePlayer: unknown class', cls); meta = {}; }
  var COLORS = ['red','white','yellow','blue','orange','gray','green','purple','black'];
  var brickMax = {}; var brickRecharge = {}; var bricks = {};
  COLORS.forEach(function(c) {
    brickMax[c] = 1 + Math.floor(Math.random() * 10); // 1-10
    bricks[c] = brickMax[c];
    brickRecharge[c] = 0;
  });
  return {
    cls: cls,
    color: meta.color,
    icon: meta.icon,
    x: W / 2,
    y: H / 2,
    r: Math.round(22 * getDisplayScale()),
    hp: meta.hp,
    hpMax: meta.hp,
    speed: meta.speed,
    bricks: bricks,                // current charges
    brickMax: brickMax,            // max charges
    brickRecharge: brickRecharge,  // seconds until next recharge
    overloadCount: 0,              // total overloads this battle (any color)
    reviveCount: 0,                // S013.3: heart-revives this run (drives loot penalty)
    armor: 0,                      // shield pips
    gold: 0,                       // coins picked up in rumble; surfaces to server
    cheese: 0,                     // cheese picked up in rumble; surfaces to server
    // PHASE B — status effect slots.
    // Each slot tracks timer (>0 = active). Applied via applyStatus(),
    // ticked in updateStatusEffects() once per frame.
    status: {
      poison:  { stacks: 0, timer: 0, tickTimer: 0, dmgPerTick: 1 },
      slow:    { factor: 0, timer: 0 },   // factor 0.4 → speed × 0.6
      daze:    { timer: 0 },              // brick refresh 50% slower
      confuse: { timer: 0 },              // movement inverted
      weaken:  { timer: 0 },              // incoming dmg × 1.5
    },
  };
}

// ═══════════════════════════════════════════════════
// PHASE B — PLAYER STATUS EFFECTS
// ═══════════════════════════════════════════════════
// Five debuffs the player can suffer: poison, slow, daze, confuse, weaken.
// Applied by entity arsenal effects (Phase C), cleansed by white crit or
// battle end / respawn. Visual state shows above the HP bar via the HUD
// and as outline pulses on the player sprite.

function applyStatus(kind, opts) {
  if (!player || !player.status) return;
  opts = opts || {};
  var s = player.status[kind];
  if (!s) return;
  switch (kind) {
    case 'poison':
      // Stacking: each application adds a stack up to 5; timer refreshes
      // to the longest incoming duration.
      s.stacks = Math.min(5, (s.stacks || 0) + (opts.stacks || 1));
      s.timer  = Math.max(s.timer || 0, opts.duration || 6);
      s.dmgPerTick = opts.dmgPerTick || s.dmgPerTick || 1;
      break;
    case 'slow':
      // Slow factor = how much speed is REMOVED. factor 0.4 = speed × 0.6.
      // Longer / stronger slow overrides weaker.
      if ((opts.factor || 0) > (s.factor || 0)) s.factor = opts.factor;
      s.timer = Math.max(s.timer || 0, opts.duration || 1);
      break;
    case 'daze':
    case 'confuse':
    case 'weaken':
      s.timer = Math.max(s.timer || 0, opts.duration || 2);
      break;
  }
}

function clearStatuses() {
  if (!player || !player.status) return;
  var s = player.status;
  s.poison.stacks = 0;  s.poison.timer = 0;  s.poison.tickTimer = 0;
  s.slow.factor   = 0;  s.slow.timer   = 0;
  s.daze.timer    = 0;
  s.confuse.timer = 0;
  s.weaken.timer  = 0;
}

function hasStatus(kind) {
  if (!player || !player.status) return false;
  var s = player.status[kind];
  if (!s) return false;
  if (kind === 'poison') return (s.timer > 0 && s.stacks > 0);
  if (kind === 'slow')   return (s.timer > 0 && s.factor > 0);
  return s.timer > 0;
}

// Per-frame tick — runs once in update(). Handles decay timers and the
// per-tick poison damage application. Does not apply gameplay effects
// (those live at each read site: movement uses slow factor, incoming
// damage multiplies by weaken, brick refresh divides by daze, etc).
function updateStatusEffects(dt) {
  if (!player || !player.status) return;
  var s = player.status;

  // Poison: stack-based DoT, ticks once per second.
  if (s.poison.timer > 0 && s.poison.stacks > 0) {
    s.poison.timer     = Math.max(0, s.poison.timer - dt);
    s.poison.tickTimer = (s.poison.tickTimer || 0) + dt;
    while (s.poison.tickTimer >= 1.0 && s.poison.timer > 0) {
      s.poison.tickTimer -= 1.0;
      var dmg = (s.poison.dmgPerTick || 1) * s.poison.stacks;
      // Bypass armor for DoT (armor is for physical absorption).
      // Routes through applyDamageToPlayer — non-killing ticks instant-apply,
      // a killing tick triggers bleed (with overflow-scaled duration).
      if (_battleStats) {
        _battleStats.damageTaken += dmg;
        if ((player.hp - dmg) < _battleStats.hpLow) _battleStats.hpLow = Math.max(0, player.hp - dmg);
        if (dmg > (_battleStats.biggestDamageTaken || 0)) _battleStats.biggestDamageTaken = dmg;
      }
      showFloatingText(player.x, player.y - 40, '☠ ' + dmg, '#1D9E75', player);
      applyDamageToPlayer(dmg);
      // Stop ticking once dying or dead — bleed will resolve to death on its
      // own timer, and we don't want repeated ticks compounding during bleed.
      if (player.hp <= 0 || player.bleedOut) {
        break;
      }
    }
    if (s.poison.timer <= 0) { s.poison.stacks = 0; s.poison.tickTimer = 0; }
  }

  // Non-damage timers just decrement
  if (s.slow.timer > 0) {
    s.slow.timer = Math.max(0, s.slow.timer - dt);
    if (s.slow.timer === 0) s.slow.factor = 0;
  }
  if (s.daze.timer    > 0) s.daze.timer    = Math.max(0, s.daze.timer    - dt);
  if (s.confuse.timer > 0) s.confuse.timer = Math.max(0, s.confuse.timer - dt);
  if (s.weaken.timer  > 0) s.weaken.timer  = Math.max(0, s.weaken.timer  - dt);
}

// Read helpers — each gameplay site that needs to apply a status effect
// calls these. Keeps effect application centralized and easy to tune.

function playerSpeedMult() {
  // Called by player movement code. slow factor 0..0.7 subtracts from 1.
  if (!player || !player.status) return 1;
  var f = player.status.slow.factor || 0;
  if (player.status.slow.timer <= 0) f = 0;
  return Math.max(0.3, 1 - f);
}

function playerRefreshMult() {
  // Called by brick refresh tick.
  // Base: 1.0
  // × FW refresh boost (e.g. 2.0 for first 10s of next rumble after FW blue success)
  // × 0.5 if dazed
  if (!player) return 1;
  var m = 1;
  if (player.refreshBoost) {
    if (performance.now() < player.refreshBoost.endsAt) {
      m *= player.refreshBoost.multiplier;
    } else {
      // Expired — clear so we skip the check on subsequent ticks
      player.refreshBoost = null;
    }
  }
  if (player.status && hasStatus('daze')) m *= 0.5;
  return m;
}

function playerDamageTakenMult() {
  // Called by damage application. weaken amplifies by 1.5×.
  if (!player || !player.status) return 1;
  return hasStatus('weaken') ? 1.5 : 1;
}

function playerInputInvert() {
  // Called by movement input. confuse flips direction.
  return hasStatus('confuse');
}

// ═══════════════════════════════════════════════════
// ARENA BOUNDS
// ═══════════════════════════════════════════════════
function getRumbleBounds() {
  var pad = 12;
  // Reservation for brick bar + comfortable thumb gutter.
  // Layout: page edge → 12px → 48px button → 24px gutter → arena.
  // The previous 54px reservation crammed thumbs against the arena edge;
  // mistapped player drags were common when reaching for chips.
  var panelWidth = 84;
  var topHUD = 50;
  return {
    x: panelWidth + pad,
    y: topHUD,
    w: W - (panelWidth + pad) * 2,
    h: H - topHUD - pad
  };
}

// ═══════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════
function getEventPos(e) {
  var rect = canvas.getBoundingClientRect();
  // Use changedTouches when available — it's the touch that triggered THIS event.
  // Using touches[0] breaks multitouch: if a first finger is already down elsewhere
  // (e.g. holding a brick bar button), touches[0] returns that finger's position
  // instead of the new finger that landed on the canvas. changedTouches[0] always
  // refers to the touch the event is actually about.
  var touch = (e.changedTouches && e.changedTouches[0])
              || (e.touches && e.touches[0])
              || e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width / rect.width),
    y: (touch.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function onPointerDown(e) {
  if (!running) return;
  e.preventDefault();
  var pos = getEventPos(e);

  // Ignore if touch is outside the playable rumble area bounds — don't let clicks
  // on brick bar or other UI above the canvas move the player if they bubble.
  var bounds = getRumbleBounds();
  if (pos.x < bounds.x || pos.x > bounds.x + bounds.w ||
      pos.y < bounds.y || pos.y > bounds.y + bounds.h) {
    return;
  }

  // Double-tap detection
  var now = performance.now();
  var dt = now - lastTapTime;
  var nearLast = lastTapPos && Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < DOUBLE_TAP_DIST;
  if (dt < DOUBLE_TAP_MS && nearLast && dashCooldown <= 0 && player) {
    // Trigger dash
    var dx = pos.x - player.x;
    var dy = pos.y - player.y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 10) {
      dashActive = true;
      dashTarget = { x: pos.x, y: pos.y };
      dashSpeed = player.speed * 3;
      dashTimer = DASH_DURATION;
      dashCooldown = 5;
      // If released near a entity, track toward them
      var rect2 = canvas.getBoundingClientRect();
      var cx2 = (pos.x - rect2.left) * (canvas.width / rect2.width);
      var cy2 = (pos.y - rect2.top) * (canvas.height / rect2.height);
      dashEntity = entities.find(function(g){ return Math.hypot(cx2-g.x,cy2-g.y)<g.r+50; }) || null;
      showFloatingText(player.x, player.y - 50, 'EVADE!', player.color, player);
    }
    lastTapTime = 0; // reset so triple-tap doesn't re-trigger
    lastTapPos = null;
  } else {
    lastTapTime = now;
    lastTapPos = { x: pos.x, y: pos.y };
  }

  dragActive = true;
  dragTarget = { x: pos.x, y: pos.y };
}

function onPointerMove(e) {
  if (!running || !dragActive) return;
  e.preventDefault();
  var pos = getEventPos(e);
  // Clamp to arena bounds so finger drift onto brick bars / page edges
  // doesn't direct the player off the play surface. Player would stop at
  // the wall anyway, but the clamped target makes positioning feel right
  // (player parks near the visible finger, not crammed in the corner).
  if (player) {
    var b = getRumbleBounds();
    var pr = player.r || 12;
    pos.x = Math.max(b.x + pr, Math.min(b.x + b.w - pr, pos.x));
    pos.y = Math.max(b.y + pr, Math.min(b.y + b.h - pr, pos.y));
  }
  dragTarget = { x:pos.x, y:pos.y };
}

function onPointerUp(e) {
  dragActive = false;
  // dragTarget persists — player keeps moving toward last position
}

// ═══════════════════════════════════════════════════
// UPDATE
// ═══════════════════════════════════════════════════
function update(dt) {
  if (!player) return;
  var bounds = getRumbleBounds();

  // Active-combat accumulator. Counts this frame as "engaged" if the player
  // has dealt damage in the last ACTIVE_COMBAT_WINDOW_MS. Used for time-on-
  // target DPS calculation; excludes idle/travel/dodge gaps.
  if (_battleStats && _battleStats._lastDamageAt > 0) {
    var sinceDmg = performance.now() - _battleStats._lastDamageAt;
    if (sinceDmg < 1500) {
      _battleStats.activeCombatMs += dt * 1000;
    }
  }

  // Dash cooldown tick
  if (dashCooldown > 0) dashCooldown = Math.max(0, dashCooldown - dt);

  // Dash movement — overrides normal movement
  if (dashActive) {
    dashTimer -= dt;
    // If tracking a entity, update target to follow them
    if (dashEntity && dashEntity.hp > 0) {
      dashTarget = { x: dashEntity.x, y: dashEntity.y };
    }
    var ddx = dashTarget ? dashTarget.x - player.x : 0;
    var ddy = dashTarget ? dashTarget.y - player.y : 0;
    var ddist = Math.sqrt(ddx*ddx + ddy*ddy);
    if (ddist > 4 && dashTimer > 0) {
      var step = Math.min(dashSpeed * dt, ddist);
      player.x += (ddx/ddist) * step;
      player.y += (ddy/ddist) * step;
    } else {
      if (dashTarget && ddist <= 4) { player.x = dashTarget.x; player.y = dashTarget.y; }
      dashActive = false;
      dashTarget = null;
      dashEntity = null;
      dragTarget = null; // clear drag target so normal movement doesn't continue
    }
  } else if (dragTarget) {
    var dx = dragTarget.x - player.x;
    var dy = dragTarget.y - player.y;
    // Confuse flips the direction of movement input.
    if (playerInputInvert()) { dx = -dx; dy = -dy; }
    var dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 8) {
      // Slow status reduces effective speed via playerSpeedMult().
      var step = Math.min(player.speed * playerSpeedMult() * dt, dist);
      player.x += (dx / dist) * step;
      player.y += (dy / dist) * step;
    } else if (!dragActive) {
      dragTarget = null;
    }
  }

  // Clamp player
  player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
  player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));

  // Push player and entity apart if overlapping
  // Push entities away from player — player is not moved by collision
  entities.forEach(function(entity) {
    var odx = player.x - entity.x, ody = player.y - entity.y;
    var odist = Math.sqrt(odx*odx+ody*ody);
    var minDist = player.r + entity.r;
    if (odist < minDist && odist > 0) {
      var push = minDist - odist;
      var nx = odx/odist, ny = ody/odist;
      entity.x -= nx*push;
      entity.y -= ny*push;
      entity.x = Math.max(bounds.x+entity.r, Math.min(bounds.x+bounds.w-entity.r, entity.x));
      entity.y = Math.max(bounds.y+entity.r, Math.min(bounds.y+bounds.h-entity.r, entity.y));
    }
  });

  // Entity
  deadEntities.forEach(function(g) { g.deathTimer -= dt; });
  deadEntities = deadEntities.filter(function(g) { return g.deathTimer > 0; });
  entities.forEach(function(g) { updateEntityConfusion(g, dt); updateEntity(g, dt, bounds); });
  entities.forEach(function(g) {
    if (g.hp > 0 || g.dead) return;
    // PHASE E — bone_rise: small-hit kill queues a revive instead of death.
    // Snap HP back up, restore to chase state, mark _boneRisen so the
    // second death proceeds normally. A brief collapse/rise visual is
    // cheaply simulated with an iframes-like invulnerable window and
    // a pulse flash.
    if (g._boneRiseQueued && !g._boneRisen) {
      g._boneRisen = true;
      g._boneRiseQueued = false;
      g.hp = Math.max(1, Math.round(g.hpMax * 0.40));
      g._phaseFadeTimer = 1.5;  // reuse invuln window — player can't attack during rise
      g.aggroed = true;
      g.state = 'chase';
      showFloatingText(g.x, g.y - (g.r + 14), 'BONE RISE', '#dcdcdc', g);
      return;
    }
    g.dead = true;
    g.deathTimer = 2.5;
    deadEntities.push(g);
    // PHASE E — mitosis_split: on death, spawn smaller clones that inherit
    // the signature (up to max recursion depth). Runs AFTER the death
    // decision so clones spawn at the moment of visible death.
    // Two places this can trigger: primary signature === 'mitosis_split'
    // (rot_grub) OR deathSignature === 'mitosis_split' (blight_worm).
    if (g.signature === 'mitosis_split' || g.deathSignature === 'mitosis_split') {
      _spawnSplitClones(g);
    }
  });
  entities = entities.filter(function(g) { return !g.dead; });
  // Brick actions
  tickBrickCooldowns(dt);
  // Brick refresh. In 'spec' mode, uses BRICK_ECONOMY per-tier rates based on class.
  // In 'sandbox' mode (default), uses a simple flat table for fast testing.
  if (player) {
    if (!player.brickRecharge) player.brickRecharge = {};
    if (!player.brickMax) player.brickMax = {};
    var SANDBOX_RATES = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
    var useSpec = (cfg && cfg.mode === 'spec');
    // S013.1: victory-screen refill boost. When the victory overlay is up,
    // regen rate spikes so players see empty pips fill visibly (~1.5-2s
    // full refill). This is the "earned-rest" beat between rumble and
    // next board leg. Only on victory, not defeat or force-quit.
    var victoryBoost = _victoryRefillActive ? 20 : 1;
    Object.keys(player.bricks).forEach(function(c) {
      if (!player.brickMax[c]) player.brickMax[c] = player.bricks[c];
      var isHeld = overloadState && overloadState.color === c;
      if (player.bricks[c] < (player.brickMax[c]||0)) {
        // Daze slows refresh rate (playerRefreshMult 0.5 under daze, 1 else).
        if (!isHeld) player.brickRecharge[c] = (player.brickRecharge[c]||0) + dt * playerRefreshMult() * victoryBoost;
        var rate;
        if (useSpec) {
          var tier = brickTier(player.cls, c);
          rate = BRICK_ECONOMY.refreshRates[tier];
        } else {
          rate = SANDBOX_RATES[c] || 1;
        }
        if (player.brickRecharge[c] >= rate) {
          player.brickRecharge[c] -= rate;
          player.bricks[c]++;
        }
      } else {
        player.brickRecharge[c] = 0;
      }
    });
  }
  if (brickAction) updateBrickAction(dt, bounds);
  updateOverload(dt);

  // PHASE A: PLAYER SENSORS — expose state that entities read for reactions.
  // Called every frame after overload/dash updates so fields are current.
  // Consumed by the reaction dispatcher in updateEntity().
  if (player) {
    var _charging = overloadState && !overloadState.fired;
    player.overloadCharging = !!_charging;
    player.overloadColor    = _charging ? overloadState.color : null;
    if (_charging) {
      var _maxT = (player.bricks[overloadState.color] || 1) * OVERLOAD_TIER;
      player.overloadChargePct = Math.min(1, overloadState.timer / _maxT);
    } else {
      player.overloadChargePct = 0;
    }
    player.hpPct = (player.hp || 0) / Math.max(1, player.hpMax || 1);
    player.dashCharging = !!dashTarget;
  }

  // PHASE B — status effect tick (poison DoT, timer decay).
  updateStatusEffects(dt);
  // PHASE C — hazards on the ground (poison puddles, thorn shards).
  updatePoisonPuddles(dt);
  updateThornShards(dt);
  // PHASE E — arcing projectiles (troll boulder toss)
  updateBoulders(dt);

  // Blue bolts, traps, armor
  updateBlueBolts(dt, bounds);
  updateWitherbolts(dt);
  updateTraps(dt);
  updateGrayWalls(dt);
  updateArmorBursts(dt);
  updateGreenBurst(dt);
  updateGreenSlowAuras(dt);
  updateGreenBubbles(dt);
  updateYellowAura(dt);
  updateWhiteField(dt);
  updateCritFlash(dt);
  updateCritBanners(dt);
  updateCritShockwaves(dt);
  updateConfuseParticles(dt);
  updateRegen(dt);
  updateBleedOut(dt);
  updateDrain(dt);
  entities.forEach(function(g) {
    updateEntityPoison(g, dt);
    g.slowTimer = Math.max(0, (g.slowTimer||0) - dt);
    if (g.slowTimer <= 0) g.slowed = false;
    g.attackSlowTimer = Math.max(0, (g.attackSlowTimer||0) - dt);
    if (g.attackSlowTimer <= 0) g.attackSlowed = false;
  });
  updatePurpleBursts(dt);
  updatePurpleParticles(dt);
  updateBlackEffect(dt);
  updateEnemyProjectiles(dt);
  updateDroppedBricks(dt);
}

// ═══════════════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════════════
function draw() {
  ctx.clearRect(0, 0, W, H);

  var bounds = getRumbleBounds();

  // ── Rumble floor ──
  ctx.save();
  ctx.fillStyle = '#0d0d14';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2;
  roundRect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 16);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // ── Floor grid ──
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  var gridSize = 40;
  for (var gx = bounds.x; gx < bounds.x + bounds.w; gx += gridSize) {
    ctx.beginPath(); ctx.moveTo(gx, bounds.y); ctx.lineTo(gx, bounds.y + bounds.h); ctx.stroke();
  }
  for (var gy = bounds.y; gy < bounds.y + bounds.h; gy += gridSize) {
    ctx.beginPath(); ctx.moveTo(bounds.x, gy); ctx.lineTo(bounds.x + bounds.w, gy); ctx.stroke();
  }
  ctx.restore();

  // ── Rumble border glow ──
  ctx.save();
  ctx.shadowColor = player ? player.color : '#333';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = player ? player.color + '44' : '#33333344';
  ctx.lineWidth = 2;
  roundRect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 16);
  ctx.stroke();
  ctx.restore();

  // ── Drag indicator ──
  // Shows path from player to drag target. Visible both during active drag
  // (stronger) and while player is still auto-moving toward the last target
  // (softer). Without this, two-finger movement on mobile (where finger 1
  // holds a brick and finger 2 briefly taps the rumble area then lifts) leaves no
  // feedback for where the player is moving.
  if (dragTarget && player) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = player.color + (dragActive ? 'cc' : '88');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(dragTarget.x, dragTarget.y);
    ctx.stroke();
    // Target dot
    ctx.setLineDash([]);
    ctx.fillStyle = player.color + (dragActive ? '66' : '44');
    ctx.beginPath();
    ctx.arc(dragTarget.x, dragTarget.y, 8, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = player.color + (dragActive ? 'cc' : '88');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ── Black effect (below everything) ──
  var _bounds = getRumbleBounds();
  drawBlackEffect(_bounds);
  // ── Traps ──
  drawTraps();
  // ── PHASE C hazards (poison puddles, thorn shards) ── under everything else
  drawPoisonPuddles();
  drawThornShards();
  // ── Yellow aura (persistent daze field) ──
  drawYellowAura();
  drawWhiteField();
  // ── Confuse particles ──
  drawConfuseParticles();
  // ── Green burst ──
  drawGreenSlowAuras();
  drawGreenBurst();
  drawGreenBubbles();
  // ── Purple burst ──
  drawPurpleBursts();
  // ── Drag indicators ──
  drawBlueDrag();
  drawDragIndicator(greenDragPos, '#1D9E75', 'PUSH');
  // Green — show burst radius any time green is held (faint pulsing ring at
  // player) or being dragged (solid ring at drag target).
  if (player && (greenDragPos || (overloadState && overloadState.color === 'green'))) {
    var rectGR = canvas.getBoundingClientRect();
    var greenOverRumble = greenDragPos &&
      greenDragPos.x >= rectGR.left && greenDragPos.x <= rectGR.right &&
      greenDragPos.y >= rectGR.top  && greenDragPos.y <= rectGR.bottom;
    var gcx2, gcy2, isActiveDrag;
    if (greenOverRumble) {
      gcx2 = (greenDragPos.x - rectGR.left) * (canvas.width / rectGR.width);
      gcy2 = (greenDragPos.y - rectGR.top)  * (canvas.height / rectGR.height);
      isActiveDrag = true;
    } else {
      // Held but not yet dragged over rumble area — show faint preview at player
      gcx2 = player.x; gcy2 = player.y;
      isActiveDrag = false;
    }
    // Match startGreenBurst / fireOverloadGreen: scaleDist(113 * tap * affR * stack).
    var gnTier = (overloadState && overloadState.color === 'green') ?
      Math.max(1, Math.min(player.brickMax?player.brickMax['green']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
    var gnTap = tapScaleMult('green');
    var gnAff = affinityRadiusMult('green');
    var gnStack = overloadStackMult(gnTier);
    var gnRadius = scaleDist(113 * gnTap * gnAff * gnStack);
    ctx.save();
    // Pulsing alpha between barely-visible (0.08) and visible (0.35)
    var gPulse = isActiveDrag ? 0.35 : (0.08 + 0.15 * (0.5 + 0.5 * Math.sin(performance.now() * 0.003)));
    ctx.globalAlpha = gPulse;
    ctx.strokeStyle = '#1D9E75';
    ctx.shadowColor = '#1D9E75'; ctx.shadowBlur = 10;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(gcx2, gcy2, gnRadius, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  // Yellow — show AoE ring (around player by default, around drag target when over rumble area)
  if (player) {
    var rect2 = canvas.getBoundingClientRect();
    var yellowOverRumble = yellowDragPos &&
      yellowDragPos.x >= rect2.left && yellowDragPos.x <= rect2.right &&
      yellowDragPos.y >= rect2.top  && yellowDragPos.y <= rect2.bottom;
    var ycx, ycy;
    if (yellowOverRumble) {
      ycx = (yellowDragPos.x - rect2.left) * (canvas.width / rect2.width);
      ycy = (yellowDragPos.y - rect2.top)  * (canvas.height / rect2.height);
    } else {
      ycx = player.x; ycy = player.y;
    }
    // Show ring whenever yellow is held (overloadState color=yellow) or dragging
    var showYellowRing = (overloadState && overloadState.color === 'yellow') || yellowDragPos;
    if (showYellowRing) {
      ctx.save();
      var now4 = performance.now();
      var yPulse = 0.3 + 0.15 * Math.sin(now4 * 0.004);
      // Line from player to drag target if over rumble area
      if (yellowOverRumble) {
        ctx.setLineDash([4,6]);
        ctx.strokeStyle = '#F5D000aa'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(ycx, ycy); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Radius ring — match the ACTUAL effect radius used at cast time.
      // fireOverloadYellow uses: scaleDist((120 + (count-1)*40) * tap * affR * stack)
      // Tap yellow uses: scaleDist(120 * tap * affR)
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#F5D000';
      ctx.shadowColor = '#F5D000'; ctx.shadowBlur = 10;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      var yTier = (overloadState && overloadState.color==='yellow') ? Math.max(1, Math.floor(overloadState.timer / OVERLOAD_TIER) + 1) : 1;
      var yTap = tapScaleMult('yellow');
      var yAff = affinityRadiusMult('yellow');
      var yStack = overloadStackMult(yTier);
      // Match fireOverloadYellow cap at scaleDist(500) — prevents preview
      // from growing past the actual effect radius on high-tier overloads.
      var yCapR = scaleDist(500);
      var yRadius = Math.min(yCapR, scaleDist((120 + (yTier - 1) * 40) * yTap * yAff * yStack));
      ctx.beginPath(); ctx.arc(ycx, ycy, yRadius, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // Center dot
      ctx.globalAlpha = yPulse * 2;
      ctx.fillStyle = '#F5D000';
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(ycx, ycy, 4, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  // Orange — growing spike trap radius reticle on drag
  if (player && orangeDragPos) {
    var rectO = canvas.getBoundingClientRect();
    var oOverRumble = orangeDragPos.x >= rectO.left && orangeDragPos.x <= rectO.right &&
                     orangeDragPos.y >= rectO.top  && orangeDragPos.y <= rectO.bottom;
    if (oOverRumble) {
      var ocx = (orangeDragPos.x - rectO.left) * (canvas.width / rectO.width);
      var ocy = (orangeDragPos.y - rectO.top)  * (canvas.height / rectO.height);
      var oTier = overloadState && overloadState.color==='orange' ?
        Math.max(1, Math.min(player.brickMax?player.brickMax['orange']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
      // Match fireOverloadOrangeScatter / startOrangeTrap: raw (25 + count*15) * tap * affR * stack.
      // Trap radius is stored raw (not scaleDist-wrapped), so preview must
      // omit scaleDist to line up with the rendered trap ring.
      var oTap = tapScaleMult('orange');
      var oAff = affinityRadiusMult('orange');
      var oStack = overloadStackMult(oTier);
      var oRadius = (25 + oTier * 15) * oTap * oAff * oStack;
      ctx.save();
      // Dashed line from player
      ctx.setLineDash([4,6]); ctx.strokeStyle='#F57C00aa'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(player.x,player.y); ctx.lineTo(ocx,ocy); ctx.stroke();
      ctx.setLineDash([]);
      // Radius ring
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle='#F57C00'; ctx.shadowColor='#F57C00'; ctx.shadowBlur=10; ctx.lineWidth=2;
      ctx.setLineDash([5,5]);
      ctx.beginPath(); ctx.arc(ocx,ocy,oRadius,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // Spike hints around ring
      var nSpikes = 6;
      ctx.fillStyle='#F57C00'; ctx.globalAlpha=0.5; ctx.shadowBlur=4;
      for (var si=0;si<nSpikes;si++){
        var sa=(si/nSpikes)*Math.PI*2;
        ctx.beginPath();
        ctx.moveTo(ocx+Math.cos(sa)*oRadius, ocy+Math.sin(sa)*oRadius);
        ctx.lineTo(ocx+Math.cos(sa+0.15)*(oRadius-8), ocy+Math.sin(sa+0.15)*(oRadius-8));
        ctx.lineTo(ocx+Math.cos(sa-0.15)*(oRadius-8), ocy+Math.sin(sa-0.15)*(oRadius-8));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  drawDragIndicator(redDragPos, '#E24B4A', 'CHARGE');
  // Gray — show wall radius on hold, move to drag target when over rumble area
  if (player) {
    var rectG = canvas.getBoundingClientRect();
    var grayOverRumble = grayDragPos &&
      grayDragPos.x >= rectG.left && grayDragPos.x <= rectG.right &&
      grayDragPos.y >= rectG.top  && grayDragPos.y <= rectG.bottom;
    var gcx = grayOverRumble ? (grayDragPos.x - rectG.left) * (canvas.width / rectG.width) : player.x;
    var gcy = grayOverRumble ? (grayDragPos.y - rectG.top)  * (canvas.height / rectG.height) : player.y;
    var showGrayRing = grayOverRumble;
    if (showGrayRing) {
      var gTier = overloadState && overloadState.color === 'gray' ?
        Math.min(Math.floor(overloadState.timer / OVERLOAD_TIER) + 1, player.brickMax ? (player.brickMax['gray']||1) : 1) : 1;
      // Match startGrayWall: scaleDist((30 + tier * 22) * tap * affR * stack)
      var gTap = tapScaleMult('gray');
      var gAff = affinityRadiusMult('gray');
      var gStack = overloadStackMult(gTier);
      var gWallR = scaleDist((30 + gTier * 22) * gTap * gAff * gStack);
      ctx.save();
      var gPulse = 0.3 + 0.15 * Math.sin(performance.now() * 0.004);
      if (grayOverRumble) {
        ctx.setLineDash([4,6]); ctx.strokeStyle = '#AAAAAA88'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(gcx, gcy); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#AAAAAA'; ctx.shadowColor = '#AAAAAA'; ctx.shadowBlur = 10;
      ctx.lineWidth = 2; ctx.setLineDash([6,6]);
      ctx.beginPath(); ctx.arc(gcx, gcy, gWallR, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  drawDragIndicator(purpleDragPos, '#9B6FD4', 'BURST');
  // Purple — show burst radius any time purple is held.
  if (player && (purpleDragPos || (overloadState && overloadState.color === 'purple'))) {
    var rectPR = canvas.getBoundingClientRect();
    var purpleOverRumble = purpleDragPos &&
      purpleDragPos.x >= rectPR.left && purpleDragPos.x <= rectPR.right &&
      purpleDragPos.y >= rectPR.top  && purpleDragPos.y <= rectPR.bottom;
    var pcx2, pcy2, isActiveDragP;
    if (purpleOverRumble) {
      pcx2 = (purpleDragPos.x - rectPR.left) * (canvas.width / rectPR.width);
      pcy2 = (purpleDragPos.y - rectPR.top)  * (canvas.height / rectPR.height);
      isActiveDragP = true;
    } else {
      pcx2 = player.x; pcy2 = player.y;
      isActiveDragP = false;
    }
    // Preview radius matches startPurpleBurst / fireOverloadPurple threshold
    // tiers: 237px (1 brick / tap), 400 (2), 600 (3), 900 (4+). Brick count
    // is the sole tier unlocker; tap/aff/stack scale within tier.
    var puTier = (overloadState && overloadState.color === 'purple') ?
      Math.max(1, Math.min(player.brickMax?player.brickMax['purple']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
    var puTap = tapScaleMult('purple');
    var puAff = affinityMult('purple');
    var puStack = overloadStackMult(puTier);
    var puBaseR;
    if (puTier >= 4)      puBaseR = 900;
    else if (puTier >= 3) puBaseR = 600;
    else if (puTier >= 2) puBaseR = 400;
    else                  puBaseR = 237;
    var puTierCeil = scaleDist(puBaseR);
    var puRadius = Math.min(puTierCeil, scaleDist(puBaseR * puTap * puAff * puStack));
    ctx.save();
    var pPulse = isActiveDragP ? 0.35 : (0.08 + 0.15 * (0.5 + 0.5 * Math.sin(performance.now() * 0.003)));
    ctx.globalAlpha = pPulse;
    ctx.strokeStyle = '#9B6FD4';
    ctx.shadowColor = '#7B2FBE'; ctx.shadowBlur = 10;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(pcx2, pcy2, puRadius, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  // White — show heal target position + radius on hold/drag
  if (player) {
    var rectW = canvas.getBoundingClientRect();
    var whiteOverRumble = whiteDragPos &&
      whiteDragPos.x >= rectW.left && whiteDragPos.x <= rectW.right &&
      whiteDragPos.y >= rectW.top  && whiteDragPos.y <= rectW.bottom;
    var wcx = whiteOverRumble ? (whiteDragPos.x - rectW.left) * (canvas.width / rectW.width) : player.x;
    var wcy = whiteOverRumble ? (whiteDragPos.y - rectW.top)  * (canvas.height / rectW.height) : player.y;
    var showWhiteRing = (overloadState && overloadState.color === 'white') || whiteDragPos;
    if (showWhiteRing) {
      // Field radius preview — match startWhiteField: scaleDist((60 + count*20) * tap * affR * stack).
      // Tap white has no field, so for tap-hold we show a small tap-heal drop point.
      var wTier = (overloadState && overloadState.color === 'white') ?
        Math.max(1, Math.min(player.brickMax?player.brickMax['white']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
      var wTap = tapScaleMult('white');
      var wAff = affinityRadiusMult('white');
      var wStack = overloadStackMult(wTier);
      var isOverload = wTier > 1;
      var wRadius = isOverload
        ? scaleDist((60 + wTier * 20) * wTap * wAff * wStack)
        : scaleDist(40 * wTap * wAff); // tap heal "drop" visualization radius
      ctx.save();
      // Line from player to drop zone when dragging over rumble area
      if (whiteOverRumble) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = '#FFFFFFaa';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(wcx, wcy); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Drop-zone ring
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#FFFFFF';
      ctx.shadowColor = '#FFEEEE'; ctx.shadowBlur = 10;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(wcx, wcy, wRadius, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // Center cross mark for heal target
      ctx.globalAlpha = 0.6;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wcx - 6, wcy); ctx.lineTo(wcx + 6, wcy);
      ctx.moveTo(wcx, wcy - 6); ctx.lineTo(wcx, wcy + 6);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Black — show darkness radius on hold/drag
  if (player) {
    var rectB = canvas.getBoundingClientRect();
    var blackOverRumble = blackDragPos &&
      blackDragPos.x >= rectB.left && blackDragPos.x <= rectB.right &&
      blackDragPos.y >= rectB.top  && blackDragPos.y <= rectB.bottom;
    var bcx = blackOverRumble ? (blackDragPos.x - rectB.left) * (canvas.width / rectB.width) : player.x;
    var bcy = blackOverRumble ? (blackDragPos.y - rectB.top)  * (canvas.height / rectB.height) : player.y;
    var showBlackRing = (overloadState && overloadState.color === 'black') || blackDragPos;
    if (showBlackRing) {
      var bTierR = (overloadState && overloadState.color === 'black') ?
        Math.max(1, Math.min(player.brickMax?player.brickMax['black']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
      // Match fireOverloadBlack: scaleDist((50+(count-1)*100) * tap * aff * stack), clamped to 900*mult
      var bTap = tapScaleMult('black');
      var bAff = affinityMult('black');
      var bStack = overloadStackMult(bTierR);
      var bMult = bTap * bAff * bStack;
      var bRadius = Math.min(scaleDist((50 + (bTierR - 1) * 100) * bMult), scaleDist(900 * bMult));
      ctx.save();
      if (blackOverRumble) {
        ctx.setLineDash([4,6]); ctx.strokeStyle = '#55555588'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(bcx, bcy); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#888888'; ctx.shadowColor = '#444444'; ctx.shadowBlur = 12;
      ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.arc(bcx, bcy, bRadius, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // Faint swirling inner fill
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(bcx, bcy, bRadius, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  // ── Blue bolts ──
  drawBlueBolts();
  drawWitherbolts();

  // ── Entity ──
  deadEntities.forEach(function(g) { drawDeadEntity(g); });
  // PHASE E — burrow telegraphs render BEFORE entity sprites so they
  // appear as ground markings underneath any living entities.
  entities.forEach(function(g) { drawBurrowTelegraph(g); });
  entities.forEach(function(g) { drawEntity(g); });
  drawEnemyProjectiles();
  drawBoulders();
  drawDroppedBricks();

  // ── Player ──
  if (player) {
    // Brick action visual — red charge trail, charge phase only
    if (brickAction && brickAction.type === 'red' && brickAction.phase === 'charge') {
      var mult = brickAction.dmgMult || 1;
      var now2 = performance.now();
      var flicker = 0.85 + 0.15 * Math.sin(now2 * 0.03);
      var trailLen = Math.max(1, Math.round((1 + Math.ceil(mult * 0.5)) * vScale(mult))); // longer trail at higher tier
      ctx.save();
      // Outer heat shockwave rings — scale with mult
      for (var ri2 = Math.max(1, Math.round(Math.ceil(mult*0.25)*vScale(mult))); ri2 > 0; ri2--) {
        ctx.globalAlpha = 0.035 * ri2 * flicker * vScale(mult);
        ctx.fillStyle = ri2 > mult * 0.6 ? '#ff2200' : '#ff6644';
        ctx.beginPath();
        ctx.arc(player.x, player.y, (player.r + ri2 * 8) * flicker, 0, Math.PI*2);
        ctx.fill();
      }
      // Trail segments — solid, aggressive, tapered
      for (var ti = 0; ti < trailLen; ti++) {
        var tPct = ti / trailLen;
        var tDist = 12 + ti * (10 + mult * 2);
        var tSize = player.r * (1 - tPct * 0.7) * (mult > 1 ? 1 + mult * 0.1 : 1);
        var tAlpha = (1 - tPct) * (0.5 + mult * 0.08);
        // Shift hotter (more orange) near player, darker at tail
        var tColor = tPct < 0.3 ? '#ff3300' : tPct < 0.6 ? '#cc2200' : '#881100';
        ctx.globalAlpha = Math.min(1, tAlpha) * flicker;
        ctx.shadowColor = '#ff2200';
        ctx.shadowBlur = (2 + mult * 1.5) * (1 - tPct);
        ctx.fillStyle = tColor;
        ctx.beginPath();
        ctx.arc(
          player.x - brickAction.dirX * tDist,
          player.y - brickAction.dirY * tDist,
          tSize, 0, Math.PI*2
        );
        ctx.fill();
      }
      // Leading edge glow — brighter with tier
      ctx.globalAlpha = 0.6 + mult * 0.08;
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 4 + mult * 2;
      ctx.fillStyle = '#ff4400';
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r * 0.6 * flicker, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // Dash trail
    if (dashActive) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r * 1.4, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + player.r - 4, player.r * 0.8, 6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Glow — flicker white during iframes
    var iframeFlash = player.iframes > 0 && Math.floor(player.iframes * 10) % 2 === 0;
    ctx.save();
    ctx.shadowColor = iframeFlash ? '#ffffff' : player.color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = iframeFlash ? '#ffffff88' : player.color + 'cc';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Inner circle
    ctx.save();
    ctx.fillStyle = iframeFlash ? '#ffffff' : player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r - 4, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Icon
    ctx.save();
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.icon, player.x, player.y);
    ctx.restore();

    // ── Armor pips around player circle ──
    var aMaxC = getArmorMax();
    if ((player.armor||0) > 0) {
      var orbitR = player.r + 10;
      ctx.save();
      for (var pi2 = 0; pi2 < (player.armor||0); pi2++) {
        var pa2 = (pi2 / aMaxC) * Math.PI * 2 - Math.PI / 2;
        var px2 = player.x + Math.cos(pa2) * orbitR;
        var py2 = player.y + Math.sin(pa2) * orbitR;
        ctx.fillStyle = '#AAAAAA';
        ctx.shadowColor = '#AAAAAA'; ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(px2, py2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Class armor visual (when armor > 0) ──
    if ((player.armor||0) > 0) {
      var ap = player.armor, ar = player.r;
      var now3 = performance.now();
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.4 + ap * 0.06);
      ctx.shadowBlur = 8;
      if (player.cls === 'breaker') {
        // Plate segments — heavy overlapping arcs
        ctx.shadowColor = '#cc8844';
        ctx.strokeStyle = '#cc8844'; ctx.lineWidth = 4;
        for (var pi=0; pi<6; pi++) {
          var pa = (pi/6)*Math.PI*2;
          ctx.beginPath();
          ctx.arc(player.x+Math.cos(pa)*ar*0.55, player.y+Math.sin(pa)*ar*0.55, ar*0.38, pa-0.6, pa+0.6);
          ctx.stroke();
        }
        // Center plate
        ctx.fillStyle = '#cc884422';
        ctx.beginPath(); ctx.arc(player.x, player.y, ar*0.4, 0, Math.PI*2); ctx.fill();
      } else if (player.cls === 'blocksmith') {
        // Brick pattern — grid lines
        ctx.shadowColor = '#C87800';
        ctx.strokeStyle = '#C87800'; ctx.lineWidth = 2;
        var bsize = ar * 0.35;
        for (var bx=-1; bx<=1; bx++) {
          for (var by=-1; by<=1; by++) {
            var bpx = player.x + bx*bsize*1.1, bpy = player.y + by*bsize*0.7;
            if (Math.hypot(bpx-player.x,bpy-player.y) < ar*0.9) {
              ctx.strokeRect(bpx-bsize/2+(by%2)*bsize*0.5, bpy-bsize*0.35, bsize, bsize*0.7);
            }
          }
        }
      } else if (player.cls === 'fixer') {
        // Bandage cross pattern
        ctx.shadowColor = '#ffffff';
        ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(player.x, player.y-ar*0.8); ctx.lineTo(player.x, player.y+ar*0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(player.x-ar*0.8, player.y); ctx.lineTo(player.x+ar*0.8, player.y); ctx.stroke();
        // Rotating ring
        ctx.strokeStyle = '#ff9999'; ctx.lineWidth = 2;
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.arc(player.x, player.y, ar*0.85, now3*0.001, now3*0.001+Math.PI*1.5); ctx.stroke();
        ctx.setLineDash([]);
      } else if (player.cls === 'formwright') {
        // Magic shield — rotating rune ring
        ctx.shadowColor = '#8866ff';
        ctx.strokeStyle = '#8866ff'; ctx.lineWidth = 2;
        ctx.setLineDash([3,5]);
        ctx.beginPath(); ctx.arc(player.x, player.y, ar*0.9, now3*0.0015, now3*0.0015+Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        for (var ri3=0; ri3<4; ri3++) {
          var ra3 = now3*0.002 + (ri3/4)*Math.PI*2;
          ctx.fillStyle = '#8866ff';
          ctx.beginPath(); ctx.arc(player.x+Math.cos(ra3)*ar*0.75, player.y+Math.sin(ra3)*ar*0.75, 3, 0, Math.PI*2); ctx.fill();
        }
      } else if (player.cls === 'snapstep') {
        // Lightweight — just fast-rotating dashes
        ctx.shadowColor = '#085041';
        ctx.strokeStyle = '#22cc88'; ctx.lineWidth = 2;
        ctx.setLineDash([6,10]);
        ctx.beginPath(); ctx.arc(player.x, player.y, ar*0.88, -now3*0.003, -now3*0.003+Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (player.cls === 'wild_one') {
        // Organic — claw marks / leaf pattern
        ctx.shadowColor = '#27500A';
        ctx.strokeStyle = '#44aa44'; ctx.lineWidth = 2;
        for (var ci=0; ci<3; ci++) {
          var ca = (ci/3)*Math.PI*2 + now3*0.001;
          ctx.beginPath();
          ctx.moveTo(player.x+Math.cos(ca)*ar*0.3, player.y+Math.sin(ca)*ar*0.3);
          ctx.quadraticCurveTo(
            player.x+Math.cos(ca+0.6)*ar*0.7, player.y+Math.sin(ca+0.6)*ar*0.7,
            player.x+Math.cos(ca+0.3)*ar*0.9, player.y+Math.sin(ca+0.3)*ar*0.9
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ── Player HP bar above player ──
    var pBarW = 60, pBarH = 6;
    var pBarX = player.x - pBarW/2;
    var pBarY = player.y - player.r - 46; // above aura ring (r+22) and armor pip orbit (r+10)
    var pHpPct = Math.min(1, player.hp / player.hpMax);
    var isOverhealC = player.hp > player.hpMax;
    var pHpColor = isOverhealC ? '#b06fef' : pHpPct > 0.5 ? '#4a9a35' : pHpPct > 0.25 ? '#F5D000' : '#E24B4A';
    ctx.save();
    ctx.fillStyle = '#111'; ctx.fillRect(pBarX-1, pBarY-1, pBarW+2, pBarH+2);
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(pBarX, pBarY, pBarW, pBarH);
    ctx.fillStyle = pHpColor; ctx.shadowColor = pHpColor; ctx.shadowBlur = 4;
    ctx.fillRect(pBarX, pBarY, pBarW * pHpPct, pBarH);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.ceil(player.hp) + '/' + player.hpMax, player.x, pBarY - 9);

    ctx.restore();

    // ── Player buff/debuff icons — unified stack above HP number ──
    _drawEffectStack(player.x, pBarY, _playerEffects());
  }

  // ── Player sparkles (white heal — follow player, or world-space for field) ──
  if (player && playerSparkles.length) {
    playerSparkles = playerSparkles.filter(function(s) { return s.alpha > 0.05; });
    playerSparkles.forEach(function(s) {
      s.alpha -= 0.024;
      if (s.worldSpace) {
        s.wx += s.vox * 60;
        s.wy += s.voy * 60;
      } else if (s.fixed) {
        s.fx += s.vox * 60;
        s.fy += s.voy * 60;
      } else {
        s.ox += s.vox;
        s.oy += s.voy;
      }
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.font = 'bold ' + Math.round(s.size) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 10 * s.alpha;
      var sx = s.worldSpace ? s.wx : (s.fixed ? s.fx : player.x + s.ox);
      var sy = s.worldSpace ? s.wy : (s.fixed ? s.fy : player.y + s.oy);
      ctx.fillText(s.text, sx, sy);
      ctx.restore();
    });
  }

  // ── Overload charge ──
  drawOverloadCharge();
  drawGrayWalls();
  drawRegen();
  drawDrainAura();
  // ── Armor bursts ──
  drawArmorBursts();

  // ── PHASE B: status effects ── outline tint on player (ring colors only;
  // the status icon stack above the player HP bar is drawn at line ~1555 via
  // _drawEffectStack(_playerEffects()), same system as entities).
  drawPlayerStatusOutline();

  // ── Debug ── (only renders if #rumble-debug element exists on page)
  if (player) {
    var dbg = document.getElementById('rumble-debug');
    if (dbg) {
      dbg.textContent = `${player.cls} hp:${player.hp} | dash:${dashActive} dashTimer:${dashTimer.toFixed(2)} dragTarget:${dragTarget?'SET':'null'} dragActive:${dragActive} brickAction:${brickAction?brickAction.type+'/'+brickAction.phase:'null'}`;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════
// External pause flag — host pages set this via Rumble.setExternalPause(bool)
// when an overlay/screen is up that should freeze gameplay (wave-victory,
// run-summary). Same gating semantics as _revivePaused: update is skipped,
// draw + HUD continue. Without this, enemies still tick and damage still
// applies while the player is reading stats.
var _externalPause = false;

function loop(ts) {
  try {
    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (!_revivePaused && !_externalPause) update(dt);
    draw();
    updateHUD();
    renderBrickBar();
    if (running) rafId = requestAnimationFrame(loop);
  } catch (err) {
    // DIAGNOSTIC — surface render-loop failures to an on-screen panel.
    // Without this, an exception silently halts the loop and the canvas
    // shows whatever was last cleared (black). Remove this try/catch
    // once the underlying bug is identified and fixed.
    running = false;
    var d = document.getElementById('rumble-loop-error');
    if (!d) {
      d = document.createElement('div');
      d.id = 'rumble-loop-error';
      d.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:9999;'
        + 'background:#0c0c10;border:1px solid #ff4466;border-radius:8px;'
        + 'box-shadow:0 8px 32px rgba(0,0,0,0.6),0 0 0 1px rgba(255,68,102,0.2);'
        + 'padding:0;color:#eeeeee;font-family:ui-monospace,monospace;'
        + 'font-size:12px;line-height:1.5;max-height:70vh;overflow:hidden;'
        + 'pointer-events:auto;display:flex;flex-direction:column;';
      document.body.appendChild(d);
    }
    var stack = (err && err.stack) ? err.stack : String(err);
    var playerInfo = player
      ? ('cls=' + player.cls + ' hp=' + player.hp + '/' + player.hpMax
        + ' x=' + Math.round(player.x) + ' y=' + Math.round(player.y)
        + ' bleed=' + (player.bleedOut ? 'YES' : 'no'))
      : 'NULL';
    var safeStack = stack.replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; });
    var errMsg = (err && err.message ? err.message : String(err));
    var safeErr = errMsg.replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; });
    d.innerHTML =
      '<div style="background:#1a0008;border-bottom:1px solid #ff446644;padding:8px 12px;'
      + 'display:flex;align-items:center;justify-content:space-between;">'
      +   '<div style="color:#ff6680;font-weight:700;font-size:12px;letter-spacing:.12em;">RUMBLE LOOP ERROR</div>'
      +   '<button onclick="this.parentNode.parentNode.remove()" '
      +     'style="background:transparent;border:1px solid #444;color:#888;'
      +     'border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;'
      +     'font-family:ui-monospace,monospace;">DISMISS</button>'
      + '</div>'
      + '<div style="padding:10px 12px;overflow-y:auto;">'
      +   '<div style="margin-bottom:4px;"><span style="color:#888;">player </span><span style="color:#eee;">' + playerInfo + '</span></div>'
      +   '<div style="margin-bottom:4px;"><span style="color:#888;">entities </span><span style="color:#eee;">' + (entities ? entities.length : 'null') + '</span></div>'
      +   '<div style="margin-bottom:8px;"><span style="color:#888;">error </span><span style="color:#ff8899;">' + safeErr + '</span></div>'
      +   '<pre style="white-space:pre-wrap;margin:0;color:#aaa;font-size:11px;'
      +     'background:#000;padding:8px;border-radius:4px;border:1px solid #222;">'
      +     safeStack
      +   '</pre>'
      + '</div>';
    console.error('[Rumble loop error]', err);
  }
}

function updateHUD() {
  if (!player) return;
  // All HUD element writes are guarded — test page has hidden compatibility
  // elements, production host pages may not include them at all.
  var el;
  if (el = document.getElementById('hud-hp'))     el.textContent = player.hp;
  if (el = document.getElementById('hud-hp-max')) el.textContent = '/ ' + player.hpMax + ' HP';
  if (el = document.getElementById('hud-class'))  el.textContent = player.cls.toUpperCase();
  var hpPct = Math.min(100, (player.hp / player.hpMax * 100));
  var isOverheal = player.hp > player.hpMax;
  var isBleeding = !!player.bleedOut;
  // Drive the screen-tint overlay — fades in during bleed, out on recovery
  updateBleedOverlay(isBleeding);
  var hpBar = document.getElementById('hp-bar');
  if (hpBar) {
    hpBar.style.width = hpPct + '%';
    if (isBleeding) {
      // Red-purple gradient + glow during bleed, signals critical state
      hpBar.style.background = 'linear-gradient(90deg,#7B0033,#b06fef)';
      hpBar.style.boxShadow = '0 0 12px #b06fef, 0 0 24px #7B0033';
    } else if (isOverheal) {
      hpBar.style.background = 'linear-gradient(90deg,#7B2FBE,#b06fef)';
      hpBar.style.boxShadow = '';
    } else {
      hpBar.style.background = 'linear-gradient(90deg,#E24B4A,#ff6b6b)';
      hpBar.style.boxShadow = '';
    }
  }
  if (el = document.getElementById('hud-hp'))     el.style.color = isOverheal ? '#b06fef' : '#E24B4A';
  // Armor pips — show filled and empty up to max
  var armorEl = document.getElementById('armor-pips');
  if (armorEl) {
    var aMax3 = getArmorMax();
    var pips = '';
    for (var i = 0; i < aMax3; i++) {
      var filled = i < (player.armor||0);
      pips += '<span style="width:10px;height:10px;border-radius:2px;background:' + (filled ? '#AAAAAA' : '#333') + ';display:inline-block;box-shadow:0 1px 3px rgba(0,0,0,.5);"></span>';
    }
    armorEl.innerHTML = pips;
  }
  // Timer
  if (el = document.getElementById('rumble-timer-display')) el.textContent = '∞';
  // Dash cooldown
  var dashEl = document.getElementById('dash-cd');
  var dashLabel = document.getElementById('dash-display');
  if (dashEl && dashLabel) {
    if (dashCooldown > 0) {
      dashEl.textContent = Math.ceil(dashCooldown) + 's';
      dashEl.style.color = '#E24B4A';
      dashLabel.style.color = '#555';
    } else {
      dashEl.textContent = 'READY';
      dashEl.style.color = '#F5D000';
      dashLabel.style.color = '#F5D000';
    }
  }
}


// ═══════════════════════════════════════════════════
// OVERLOAD SYSTEM
// ═══════════════════════════════════════════════════
var overloadState = null; // { color, timer, startX, startY, dragPos }
var OVERLOAD_HOLD = 2.5; // 0.5 second per tier (5 bricks = 2.5s max)
var OVERLOAD_TIER = 0.5; // seconds per tier

function startOverload(e, color) {
  if (!player || !player.bricks[color] || player.bricks[color] <= 0) return;
  var touch = e.touches ? e.touches[0] : e;
  overloadState = {
    color: color,
    timer: 0,
    startClientX: touch.clientX,
    startClientY: touch.clientY,
    dragPos: null,
    fired: false,
  };
}

function updateOverload(dt) {
  if (!overloadState || overloadState.fired) return;
  var maxTimer = player ? ((player.bricks[overloadState.color]||1) * OVERLOAD_TIER) : OVERLOAD_TIER;
  overloadState.timer = Math.min(overloadState.timer + dt, maxTimer);
}

function cancelOverload() {
  overloadState = null;
}

var _currentCrit = false;      // crit flag from last cast; color handlers apply threshold effects

function fireOverload(dragX, dragY, bricksUsed) {
  if (!overloadState || !player) return;
  var color = overloadState.color;
  var maxAvail = player.bricks[color] || 0;
  var count = bricksUsed !== undefined ? Math.min(bricksUsed, maxAvail) : maxAvail;
  if (count <= 0) return;
  count = Math.max(1, count);
  player.bricks[color] = Math.max(0, maxAvail - count);
  if (_battleStats) {
    _addBrickStat(_battleStats.bricksUsed, color, count);
    if (count >= 2) _battleStats.overloadsFired++;
  }
  renderBrickBar();
  overloadState.fired = true;
  overloadState = null;

  // Crit roll — one per cast. Stored globally so per-color handlers can
  // read it without threading a parameter through every fire function.
  // Threshold EFFECTS are implemented per-color in Session B; this turn
  // only establishes the roll + flag + universal "CRIT!" floating text.
  _currentCrit = rollCrit(color, count);
  if (_currentCrit) {
    triggerCritSignature(color, player.x, player.y - 80);
  }

  // Origin — for most bricks collapse to player if tap, but pass raw coords so individual handlers can decide
  var _dist = dragX !== undefined ? Math.hypot(dragX - player.x, dragY - player.y) : -1;
  // dropped on player = regen signal (pass player coords), tap or drag elsewhere = instant heal (undefined/far coords)
  var droppedOnPlayer = dragX !== undefined && _dist < player.r + 20;
  var ox = droppedOnPlayer ? player.x : (dragX !== undefined ? dragX : undefined);
  var oy = droppedOnPlayer ? player.y : (dragY !== undefined ? dragY : undefined);
  var _usePlayer = (dragX === undefined) || droppedOnPlayer;
  var oxP = _usePlayer ? player.x : dragX;
  var oyP = _usePlayer ? player.y : dragY;

  if (color === 'red')    fireOverloadRed(count, oxP, oyP);
  if (color === 'white')  fireOverloadWhite(count, ox, oy);  // needs raw undefined for tap detection
  if (color === 'yellow') fireOverloadYellow(count, oxP, oyP);
  if (color === 'blue')   fireOverloadBlue(count);
  if (color === 'orange') fireOverloadOrange(count, oxP, oyP);
  if (color === 'gray')   fireOverloadGray(count, oxP, oyP);
  if (color === 'green')  fireOverloadGreen(count, oxP, oyP, _usePlayer);
  if (color === 'purple') fireOverloadPurple(count, oxP, oyP);
  if (color === 'black')  fireOverloadBlack(count, oxP, oyP);

  // overload announcement handled by each action's flavor text
}

function fireOverloadRed(count, ox, oy)   {
  if (ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40)) {
    startRedChargeTo(count, ox, oy);
  } else {
    startRedCharge(count, null);
  }
}
function fireOverloadWhite(count, ox, oy) {
  var _isDrag = ox !== undefined;
  var isOnPlayer = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) < player.r + 30;
  if (isOnPlayer || !_isDrag) {
    // Tap or drop-on-player: direct overload heal (canonical formula in characters.js)
    var ownedW = (player.brickMax && player.brickMax.white) || 0;
    var healAmt = window.computeHeal(player.cls, 'white', ownedW, count);
    var prev = player.hp;
    var cap2 = Math.max(player.hpMax, player.hp);
    player.hp = Math.min(cap2, player.hp + healAmt);
    var healed = Math.round(player.hp - prev);
    if (healed > 0) applyBleedRescue(healed);
    // v4: track total + biggest-single-heal for victory screen
    if (_battleStats && healed > 0) {
      _battleStats.totalHealed = (_battleStats.totalHealed || 0) + healed;
      if (healed > (_battleStats.biggestHealPlayer || 0)) _battleStats.biggestHealPlayer = healed;
    }
    // Only surface the floater when actual HP was restored. Healing at
    // full HP produces a 0 that was rendering as "0 ✚ x3" on the player.
    if (healed > 0) {
      showFloatingText(player.x, player.y-50, healed + ' ✚', '#EFEFEF', player);
    }
    spawnHealSparkles(count);
    var sparkCount = Math.max(1, Math.round(count * 3 * vScale(count)));
    var sizeBase = 2 + count * 0.4;
    var speedBase = 0.15 + count * 0.04;
    var spreadR = 6 + count * 4;
    var colors2 = ['#ffffff','#ffccee','#ff99cc','#ffe0f0'];
    if (count >= 4) colors2.push('#ffaaff','#cc88ff');
    for (var i = 0; i < sparkCount; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = speedBase + Math.random() * speedBase;
      var size = sizeBase + Math.random() * sizeBase * 0.8;
      playerSparkles.push({
        ox: Math.cos(angle)*(spreadR * Math.random()),
        oy: Math.sin(angle)*(spreadR * Math.random()),
        vox: Math.cos(angle)*speed, voy: Math.sin(angle)*speed-0.3*(count*0.5),
        text: i%3===0?'✦':'✧',
        color: colors2[Math.floor(Math.random()*colors2.length)],
        size: size, alpha: 1, life: 1
      });
    }
    return;
  }
  // Drop on empty space or entity: create static healing field.
  // Heals allies (including player if they enter) per tick, soft-slows
  // enemies inside to discourage staying in it.
  startWhiteField(ox, oy, count);
}

// ── WHITE HEALING FIELD ─────────────────────────────
// Overload white cast on empty space/entity creates a persistent zone.
// Allies inside heal per tick. Entities inside have their movement
// gently slowed (soft repel).
var whiteField = null; // { timer, duration, ox, oy, radius, healPerTick, tickTimer, pulse, sparkleTimer }

function startWhiteField(ox, oy, count) {
  var tap = tapScaleMult('white');
  var aff = affinityMult('white');           // for heal amount
  var affR = affinityRadiusMult('white');    // for field radius
  var stack = overloadStackMult(count);
  var duration = 3.0 * count * stack;
  var radius = scaleDist((60 + count * 20) * tap * affR * stack);
  whiteField = {
    timer: duration,
    duration: duration,
    ox: ox, oy: oy,
    radius: radius,
    healPerTick: Math.max(1, Math.ceil((1 + count) * tap * aff * stack)),
    tickTimer: 0,
    pulse: 0,
    sparkleTimer: 0,
    firstTickDouble: !!_currentCrit,  // WHITE BLESSING: first heal tick doubles on crit
  };
}

function updateWhiteField(dt) {
  if (!whiteField) return;
  whiteField.timer -= dt;
  whiteField.pulse = (whiteField.pulse + dt * 2) % (Math.PI * 2);
  if (whiteField.timer <= 0) { whiteField = null; return; }
  var cx = whiteField.ox, cy = whiteField.oy, r = whiteField.radius;
  // Heal the player if inside the field (allies: player only for now)
  if (player && Math.hypot(player.x - cx, player.y - cy) <= r) {
    whiteField.tickTimer += dt;
    if (whiteField.tickTimer >= 0.5) {
      whiteField.tickTimer -= 0.5;
      var prev = player.hp;
      // WHITE BLESSING: first tick doubles if the field was cast on crit.
      var tickHeal = whiteField.healPerTick;
      if (whiteField.firstTickDouble) {
        tickHeal *= 2;
        whiteField.firstTickDouble = false; // one-shot
        spawnCritShockwave(whiteField.ox, whiteField.oy, '#FFFFFF', { r0: 10, maxR: whiteField.radius, thickness: 3, growth: 300 });
        spawnCritFlourish(player.x, player.y, '#FFEEFF', 12);
      }
      player.hp = Math.min(player.hpMax, player.hp + tickHeal);
      if (player.hp > prev) {
        var tickHealed = player.hp - prev;
        applyBleedRescue(tickHealed);
        if (_battleStats) {
          _battleStats.totalHealed = (_battleStats.totalHealed || 0) + tickHealed;
          if (tickHealed > (_battleStats.biggestHealPlayer || 0)) _battleStats.biggestHealPlayer = tickHealed;
        }
        showFloatingText(player.x, player.y - 40, tickHealed + ' ✚', '#EFEFEF', player);
      }
    }
  }
  // Soft-slow any entity inside the field (gentle repel effect)
  entities.forEach(function(e) {
    if (Math.hypot(e.x - cx, e.y - cy) <= r) {
      e.whiteFieldSlowed = true;
      e.whiteFieldSlowTimer = 0.25; // refreshed each frame while inside
    }
  });
  // Occasional sparkle shimmer in the field for visual life
  whiteField.sparkleTimer += dt;
  if (whiteField.sparkleTimer >= 0.08) {
    whiteField.sparkleTimer = 0;
    var angle = Math.random() * Math.PI * 2;
    var dist = Math.random() * r * 0.9;
    spawnHealSparkleAt(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
  }
}

function drawWhiteField() {
  if (!whiteField || !ctx) return;
  var cx = whiteField.ox, cy = whiteField.oy, r = whiteField.radius;
  var pct = whiteField.timer / whiteField.duration;
  var a = Math.max(0, Math.min(1, pct)) * 0.55;
  ctx.save();
  // Soft white radial glow
  var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, 'rgba(255, 255, 255, ' + (a * 0.28) + ')');
  grad.addColorStop(0.6, 'rgba(255, 240, 245, ' + (a * 0.18) + ')');
  grad.addColorStop(1.0, 'rgba(255, 200, 220, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // Pulsing edge ring that doubles as duration indicator.
  // Arc shrinks clockwise from full circle to zero as field time runs out.
  var pulseScale = 1 + Math.sin(whiteField.pulse) * 0.04;
  ctx.strokeStyle = 'rgba(255, 255, 255, ' + a + ')';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  // Full dim ring (background)
  ctx.save();
  ctx.globalAlpha = a * 0.25;
  ctx.beginPath(); ctx.arc(cx, cy, r * pulseScale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // Timer arc (foreground, bright)
  ctx.beginPath();
  ctx.arc(cx, cy, r * pulseScale, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * pct);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

// Helper used by updateWhiteField for shimmer particles. We reuse the
// existing playerSparkles array with world-space coords so we don't
// build a separate particle system.
function spawnHealSparkleAt(x, y) {
  playerSparkles.push({
    worldSpace: true,
    wx: x, wy: y,
    vox: (Math.random() - 0.5) * 0.1,
    voy: -0.2 - Math.random() * 0.15,
    text: Math.random() < 0.5 ? '✦' : '✧',
    color: '#ffffff',
    size: 2 + Math.random() * 2,
    alpha: 1, life: 1,
  });
}


function fireOverloadYellow(count, ox, oy) {
  // 3s aura. Radius scales with count. If cast from drag-target coords,
  // aura is anchored there. Otherwise it follows the player.
  // Per-entity confuse duration is extended each frame they're in the aura,
  // so overloading (bigger radius, higher hit chance) naturally produces
  // longer confuses on the entities you manage to keep inside.
  var dragOrigin = ox !== undefined && Math.hypot(ox - player.x, oy - player.y) > scaleDist(40);
  var tap = tapScaleMult('yellow');
  var aff = affinityMult('yellow');           // for confuse damage/duration
  var affR = affinityRadiusMult('yellow');    // for aura radius
  var stack = overloadStackMult(count);
  // Radius cap: yellow is a utility confusion field, capping at 500 keeps
  // overload stacks focused rather than rumble-wide. Tap base is 120.
  var yCapR = scaleDist(500);
  var r = Math.min(yCapR, scaleDist((120 + (count - 1) * 40) * tap * affR * stack));
  startYellowAura({
    follow: !dragOrigin,
    ox: dragOrigin ? ox : player.x,
    oy: dragOrigin ? oy : player.y,
    radius: r,
    duration: 3.0 * tap * stack,
    label: 'MIND SHATTER x' + count + '!',
    isCrit: _currentCrit,
  });
}
function fireOverloadBlue(count) {
  var target = entities.length ? entities.reduce(function(a,b){
    return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null;
  if (!target) return;
  // Single bolt. Damage scales with overload count, class affinity, inventory,
  // and crit. Overload bolts also create a minor impact burst radius that
  // damages nearby entities for half damage. Burst radius scales with count.
  //
  // BLUE CRUSHING STRIKE: crit doubles bolt damage (matches red/gray/purple
  // convention). Previously blue crit only marked targets for +50% follow-up
  // damage, which was wasted on solo kills and made blue crit feel weak.
  var tap = tapScaleMult('blue');
  var aff = affinityMult('blue');
  var stack = overloadStackMult(count);
  var bcritMult = _currentCrit ? 2.0 : 1.0;
  blueBolts.push({
    x: player.x, y: player.y,
    target: target,
    speed: 400 + count * 40,
    dmg: Math.ceil(4 * tap * count * aff * stack * bcritMult),
    r: 6 + count * 4,       // x1=10, x5=26
    dead: false,
    travelled: 0,
    tier: count,
    glow: count * 10,
    delayTimer: 0,
    burstRadius: scaleDist((30 + count * 15) * stack),  // impact burst AoE
    burstDmg: Math.ceil(2 * tap * count * aff * stack * bcritMult),      // ~half primary dmg
    isCrit: _currentCrit,
  });
}
function fireOverloadOrange(count, ox, oy) {
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40);
  if (isDrag) {
    fireOverloadOrangeScatter(count, ox, oy);
  } else {
    // Tap overload — spike aura with count charges (tap scaling + affinity + stack boost charges)
    var charges = Math.max(1, Math.ceil(count * tapScaleMult('orange') * affinityMult('orange') * overloadStackMult(count)));
    if (orangeAura) {
      orangeAura.charges += charges;
    } else {
      orangeAura = { charges: charges, pulse: 0, r: player.r + 22 };
    }
  }
}
function fireOverloadGray(count, ox, oy) {
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40);
  if (isDrag) {
    startGrayWall(ox, oy, count);
  } else {
    var aMax2 = getArmorMax();
    var prevArmor = player.armor||0;
    // Base: 1 armor pip per brick × tap scaling × affinity × overload stack.
    // GRAY REINFORCE: crit doubles pip count.
    var gcritMult = _currentCrit ? 2.0 : 1.0;
    var pips = Math.max(1, Math.ceil(count * tapScaleMult('gray') * affinityMult('gray') * overloadStackMult(count) * gcritMult));
    player.armor = Math.min(aMax2, prevArmor + pips);
    var gained = player.armor - prevArmor;
    if (_currentCrit) {
      spawnCritShockwave(player.x, player.y, '#CCCCCC', { r0: 10, maxR: scaleDist(160), thickness: 4, growth: 240 });
      spawnCritFlourish(player.x, player.y, '#DDDDDD', 18);
    }
    armorBursts.push({ x:player.x, y:player.y, r:player.r, alpha:0.9 });
  }
}
function fireOverloadGreen(count, ox, oy, followPlayer) {
  // Each brick beyond the first doubles poison damage (1-2-4-8-16)
  var tap = tapScaleMult('green');
  var aff = affinityMult('green');          // for poison damage
  var affR = affinityRadiusMult('green');   // for burst radius (gentler)
  var stack = overloadStackMult(count);
  if (greenBurst && !greenBurst.done) {
    greenBurst._poisonedIds=[]; greenBurst._pushIds=[];
  } else {
    greenBurst = { r:0, maxR:scaleDist(113 * tap * affR * stack), alpha:1, done:false, _poisonedIds:[], _pushIds:[], ox:ox, oy:oy };
  }
  greenBurst._poisonMult = count * tap * aff * stack; // inventory + affinity + stack scale poison
  greenBurst._castCount = count; // for duration extension (3 + count)
  // GREEN NECROSIS: on crit, poison applied by this burst doesn't decay.
  greenBurst._necrosis = !!_currentCrit;
  // Follow flag: true when cast on-player (release on bar, or drag dropped
  // back onto player). When true, both the burst expansion and the spawned
  // afterimage track the player's position each frame instead of sitting
  // at the fixed cast origin.
  greenBurst._followPlayer = !!followPlayer;
  if (_currentCrit) {
    var gr = scaleDist(113 * tap * affR * stack);
    spawnCritShockwave(ox, oy, '#39d67a', { r0: 10, maxR: gr, thickness: 4, growth: 350 });
    spawnCritFlourish(ox, oy, '#1D9E75', 24);
    spawnCritFlourish(ox, oy, '#7ce39a', 16);
  }
}
function fireOverloadPurple(count, ox, oy) {
  var tap = tapScaleMult('purple');
  var aff = affinityMult('purple');           // for damage
  var affR = affinityRadiusMult('purple');    // for radius
  var stack = overloadStackMult(count);
  // Threshold tier table:
  //   1 brick  (tap)     → 237px, tier I   (handled by startPurpleBurst)
  //   2 bricks           → 400px, tier II
  //   3 bricks           → 600px, tier III
  //   4+ bricks          → 900px, tier IV (cap)
  // Tap scaling / affinity still modulate within tier but can't cross the
  // next threshold — brick count is the sole tier-unlocker.
  var baseR, purpleTier;
  if (count >= 4)      { baseR = 900; purpleTier = 4; }
  else if (count >= 3) { baseR = 600; purpleTier = 3; }
  else if (count >= 2) { baseR = 400; purpleTier = 2; }
  else                 { baseR = 237; purpleTier = 1; }
  var tierCeil = scaleDist(baseR);
  var maxR = Math.min(tierCeil, scaleDist(baseR * tap * affR * stack));
  purpleBursts.push({ r:0, maxR:maxR, alpha:1, done:false, hit:false, ox:ox, oy:oy, dmgMult:count * tap * aff * stack, isCrit: _currentCrit, purpleTier: purpleTier });
  if (_currentCrit) {
    spawnCritShockwave(ox, oy, '#7B2FBE', { r0: 14, maxR: maxR, thickness: 4, growth: 380 });
    spawnCritFlourish(ox, oy, '#9B6FD4', 26);
    spawnCritFlourish(ox, oy, '#CC99FF', 16);
  }
}
function fireOverloadBlack(count, ox, oy) {
  var tap = tapScaleMult('black');
  var aff = affinityMult('black');           // for damage/duration
  var affR = affinityRadiusMult('black');    // for radius
  var stack = overloadStackMult(count);
  var mult = tap * aff * stack;              // damage/duration multiplier
  var multR = tap * affR * stack;            // radius multiplier
  var crit = !!_currentCrit;
  if (blackEffect) {
    blackEffect.RADIUS = Math.min(blackEffect.RADIUS + scaleDist(count * 100 * multR), scaleDist(900 * multR));
    blackEffect.timer = 3.0 * count * mult;
    blackEffect.DURATION = 3.0 * count * mult;
    blackEffect.tickDmg = Math.max(1, Math.ceil(count * mult));
    if (crit) blackEffect.isCrit = true; // elevate to singularity on crit stack
  } else {
    blackEffect = { timer:3.0*count*mult, DURATION:3.0*count*mult, tickTimer:0, TICK:0.5, alpha:0,
      FADE_IN:0.8, FADE_OUT:0.8, ox:ox, oy:oy, RADIUS:scaleDist((50+(count-1)*100)*multR), tickDmg:Math.max(1, Math.ceil(count*mult)), isCrit: crit };
  }
  if (crit) {
    spawnCritShockwave(ox, oy, '#552288', { r0: 12, maxR: blackEffect.RADIUS, thickness: 4, growth: 280 });
    spawnCritShockwave(ox, oy, '#BB88FF', { r0: 16, maxR: blackEffect.RADIUS * 0.8, thickness: 2, growth: 240 });
    spawnCritFlourish(ox, oy, '#7744AA', 28);
    spawnCritFlourish(ox, oy, '#333333', 20);
  }
  entities.forEach(function(g) {
    if (Math.hypot(g.x-ox,g.y-oy)<blackEffect.RADIUS) { g.attackSlowed=true; g.attackSlowTimer=blackEffect.DURATION; }
  });
}

// ═══════════════════════════════════════════════════
// PHASE B — PLAYER STATUS OUTLINE (concentric rings)
// ═══════════════════════════════════════════════════
// S013.7: The old drawStatusHUD (radial pie-wedge icons above player) was
// REMOVED. All status effects now flow through _playerEffects() →
// _drawEffectStack() above the player's HP bar, matching how entities
// already work. The outline rings below stay — they're a different visual
// channel (passive body tint at a glance), not duplicated by the stack.

// Subtle outline pulse on the player sprite that telegraphs current status.
// Rendered as a soft ring just outside player.r in the status's signature
// color. Multiple statuses stack as concentric thin rings so player can
// see "I'm poisoned AND weakened" without competing for the same ring.
function drawPlayerStatusOutline() {
  if (!player || !player.status) return;
  var s = player.status;
  var rings = [];
  if (s.poison.timer  > 0) rings.push('#1D9E75');
  if (s.slow.timer    > 0) rings.push('#7FE0FF');
  if (s.daze.timer    > 0) rings.push('#F5D000');
  if (s.confuse.timer > 0) rings.push('#E08CF0');
  if (s.weaken.timer  > 0) rings.push('#553366');
  if (rings.length === 0) return;

  // Pulse alpha breathes between 0.5 and 0.9.
  var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.004;
  var pulseA = 0.5 + Math.abs(Math.sin(t)) * 0.4;

  ctx.save();
  ctx.lineWidth = 2;
  for (var i = 0; i < rings.length; i++) {
    ctx.globalAlpha = pulseA * (1 - i * 0.15);
    ctx.strokeStyle = rings[i];
    ctx.shadowColor = rings[i];
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 4 + i * 3, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}


function drawOverloadCharge() {
  if (!overloadState || overloadState.fired) return;
  // Don't show the charge ring during a tap. The ring only means something
  // once the user has held long enough to cross the first brick tier (i.e.
  // they're actually overloading). Before that threshold the press is a tap
  // and shows no indicator.
  if (overloadState.timer < OVERLOAD_TIER) return;
  var col = BRICK_COLORS[overloadState.color] || '#FFD700';
  var maxBricks = player && player.brickMax ? (player.brickMax[overloadState.color] || 1) : 1;
  var totalDur = maxBricks * OVERLOAD_TIER;
  var pct = Math.min(1, overloadState.timer / totalDur);
  if (pct <= 0) return;
  var tierDur = OVERLOAD_TIER;
  var bricksCharged = Math.min(maxBricks, Math.floor(overloadState.timer / tierDur));
  ctx.save();
  // Background track
  ctx.strokeStyle = col + '33';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r + 12, -Math.PI/2, -Math.PI/2 + Math.PI*2);
  ctx.stroke();
  // Fill arc
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 18 * pct;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.5 + pct * 0.5;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r + 12, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
  ctx.stroke();
  // Tier tick marks
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  for (var t = 1; t < maxBricks; t++) {
    var ta = -Math.PI/2 + Math.PI*2*(t/maxBricks);
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(ta)*(player.r+8), player.y + Math.sin(ta)*(player.r+8));
    ctx.lineTo(player.x + Math.cos(ta)*(player.r+17), player.y + Math.sin(ta)*(player.r+17));
    ctx.stroke();
  }
  // Count label. Position:
  //   • No active drag → 10 o'clock on the player (current orientation)
  //   • Dragging → fixed offset ABOVE the cursor, so the count reads at the
  //     drop target instead of getting lost behind the player avatar.
  if (bricksCharged > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.font = 'bold 16px Cinzel,serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Look up the current color's drag position, if any. Each color stores
    // its own drag pos (greenDragPos, purpleDragPos, etc).
    var dragMap = {
      blue: typeof blueDragPos !== 'undefined' ? blueDragPos : null,
      green: typeof greenDragPos !== 'undefined' ? greenDragPos : null,
      yellow: typeof yellowDragPos !== 'undefined' ? yellowDragPos : null,
      orange: typeof orangeDragPos !== 'undefined' ? orangeDragPos : null,
      red: typeof redDragPos !== 'undefined' ? redDragPos : null,
      purple: typeof purpleDragPos !== 'undefined' ? purpleDragPos : null,
      white: typeof whiteDragPos !== 'undefined' ? whiteDragPos : null,
      gray: typeof grayDragPos !== 'undefined' ? grayDragPos : null,
      black: typeof blackDragPos !== 'undefined' ? blackDragPos : null,
    };
    var dragPos = dragMap[overloadState.color];
    var labelX, labelY;
    if (dragPos) {
      // Active drag — convert client coords to canvas space, offset above.
      var rect = canvas.getBoundingClientRect();
      labelX = (dragPos.x - rect.left) * (canvas.width / rect.width);
      labelY = (dragPos.y - rect.top) * (canvas.height / rect.height) - 28;
    } else {
      // No drag — 10 o'clock on the player.
      var _oa = -Math.PI * 5/6;
      var _or = player.r + 36;
      labelX = player.x + Math.cos(_oa)*_or;
      labelY = player.y + Math.sin(_oa)*_or;
    }
    ctx.fillText('x' + bricksCharged, labelX, labelY);
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// BRICK BAR — dynamic distribution rule:
//   • Signature color goes RIGHT (dominant thumb side)
//   • Secondary goes LEFT
//   • Additional bricks (baseline colors carried in) alternate right/left
// Sort priority: tier (sig > sec > base) then alphabetical inside each tier.
// ═══════════════════════════════════════════════════
var ALL_BRICK_COLORS = ['red','white','yellow','blue','orange','gray','green','purple','black'];
var TEST_BRICKS  = ALL_BRICK_COLORS; // kept for legacy refs

var blueDragActive = false;
var blueDragPos = null;
var greenDragActive = false;
var greenDragPos = null;
var yellowDragActive = false;
var yellowDragPos = null;
var orangeDragActive = false;
var orangeDragPos = null;
var redDragActive = false;
var redDragPos = null;
var grayDragActive = false;
var grayDragPos = null;
var purpleDragActive = false;
var purpleDragPos = null;
var blackDragActive = false;
var blackDragPos = null;
var whiteDragActive = false;
var whiteDragPos = null;

// Distribute the given list of colors across left and right bars using
// Rule E (sig right, sec left, alternate beyond that).
function _distributeBricks(colors) {
  if (!player) return { left: [], right: [] };
  var cls = player.cls;
  var tierRank = { signature: 0, secondary: 1, baseline: 2 };
  var sorted = colors.slice().sort(function(a, b) {
    var ta = tierRank[brickTier(cls, a)];
    var tb = tierRank[brickTier(cls, b)];
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  // sig (first in sorted) goes right; sec (second) goes left; then alternate.
  var right = [], left = [];
  sorted.forEach(function(c, i) {
    // i=0 → right, i=1 → left, i=2 → right, i=3 → left, ...
    if (i % 2 === 0) right.push(c);
    else             left.push(c);
  });
  return { left: left, right: right };
}

function _brickBtnHTML(color) {
  var qty = player.bricks[color] || 0;
  var maxQ = player.brickMax ? (player.brickMax[color]||0) : qty;
  var bg = BRICK_COLORS[color] || '#555';
  var recharging = qty < maxQ;
  // Compute the actual refresh rate for this color (mode-dependent) so the
  // progress bar fills over the FULL rate rather than a hardcoded 1 second.
  var rate;
  if (cfg && cfg.mode === 'spec') {
    var tier = brickTier(player.cls, color);
    rate = BRICK_ECONOMY.refreshRates[tier];
  } else {
    var SANDBOX_RATES_R = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
    rate = SANDBOX_RATES_R[color] || 1;
  }
  var rechargePct = recharging ? Math.min(100, (player.brickRecharge[color]||0) / rate * 100) : 0;
  var pips = '';
  for (var i = 0; i < maxQ; i++) {
    var filled = i < qty;
    // Empty pips get a thin color-accent border over a neutral grey fill so
    // low-contrast colors (notably black at #2a2a2a) still read as distinct
    // slots. Filled pips keep their glow. Border is omitted when filled
    // because the filled color + shadow already carry the identity.
    pips += '<span style="display:inline-block;width:6px;height:6px;border-radius:2px;margin:1px;'
      + 'background:' + (filled ? bg : '#1a1a1a') + ';'
      + (filled ? '' : 'border:1px solid ' + bg + 'aa;box-sizing:border-box;')
      + 'box-shadow:' + (filled ? '0 0 4px '+bg : 'none') + ';"></span>';
  }
  return '<button class="rumble-brick-btn" '
    + 'id="rumble-brick-btn-' + color + '" '
    + 'style="background:' + bg + (qty>0?'22':'11') + ';border:2px solid ' + bg + (qty>0?'66':'33') + ';" '
    + 'onpointerdown="onBrickDown(event,\'' + color + '\')" >'
    + '<span style="width:22px;height:22px;border-radius:4px;background:' + bg + ';opacity:' + (qty>0?'1':'0.3') + ';'
    + 'display:inline-block;box-shadow:0 1px 4px rgba(0,0,0,.5);"></span>'
    + '<div style="display:flex;flex-wrap:wrap;justify-content:center;width:44px;">' + pips + '</div>'
    + (recharging ? '<div style="width:38px;height:3px;background:#111;border-radius:2px;overflow:hidden;">'
      + '<div style="width:'+rechargePct+'%;height:100%;background:'+bg+';transition:width 0.1s;"></div></div>' : '')
    + '</button>';
}

function renderBrickBar() {
  var left  = document.getElementById('rumble-brick-bar-left');
  var right = document.getElementById('rumble-brick-bar-right');
  // Backwards compat: if host still uses single-bar #rumble-brick-bar, render all 9 there.
  var single = document.getElementById('rumble-brick-bar');
  if (!left && !right && !single) return;
  if (!player) {
    if (left)   left.innerHTML = '';
    if (right)  right.innerHTML = '';
    if (single) single.innerHTML = '';
    return;
  }
  // Render only colors where brickMax > 0 (the kit the player brought).
  // Colors the player never had (brickMax = 0) stay hidden for a clean layout.
  var kitColors = ALL_BRICK_COLORS.filter(function(c) { return (player.brickMax[c] || 0) > 0; });
  if (left || right) {
    var dist = _distributeBricks(kitColors);
    if (left)  left.innerHTML  = dist.left.map(_brickBtnHTML).join('');
    if (right) right.innerHTML = dist.right.map(_brickBtnHTML).join('');
  } else if (single) {
    single.innerHTML = kitColors.map(_brickBtnHTML).join('');
  }
}

// Blue drag-to-target
function startDragAction(e, color, activeFn, dragActiveVar, dragPosVar) {
  var touch = e.touches ? e.touches[0] : e;
  var startX = touch.clientX, startY = touch.clientY;
  window[dragActiveVar] = true;
  window[dragPosVar] = { x: startX, y: startY };
  function onMove(ev) {
    var t = ev.touches ? ev.touches[0] : ev;
    window[dragPosVar] = { x: t.clientX, y: t.clientY };
  }
  function onUp(ev) {
    if (!window[dragActiveVar]) return;
    window[dragActiveVar] = false;
    var pos = window[dragPosVar];
    if (pos) {
      var dragDist = Math.hypot(pos.x - startX, pos.y - startY);
      if (dragDist < 20) {
        // Tap — use player position as origin
        activeFn(player.x, player.y);
      } else {
        // Drag — use released canvas position
        var rect = canvas.getBoundingClientRect();
        var cx = (pos.x - rect.left) * (canvas.width / rect.width);
        var cy = (pos.y - rect.top) * (canvas.height / rect.height);
        activeFn(cx, cy);
      }
    }
    window[dragPosVar] = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive:true});
  document.addEventListener('touchend', onUp);
}

function onBrickDown(e, color) {
  e.preventDefault();
  e.stopPropagation();

  // NOTE: we attach pointermove/pointerup to document rather than the button
  // because renderBrickBar() runs every animation frame, replacing the button's
  // innerHTML. Listeners on the button would be wiped out mid-press. The pointer
  // event system still delivers pointerup to document reliably even without
  // setPointerCapture, as long as the original pointerdown was handled on a
  // descendant of document (always true here).
  var pointerId = e.pointerId;

  startOverload(e, color);
  var startTime = performance.now();
  var startCX = e.clientX, startCY = e.clientY;
  var dragPos = null;
  var dragFns = {
    green:  function(cx,cy){ startGreenBurst(cx,cy); },
    purple: function(cx,cy){ startPurpleBurst(cx,cy); },
    black:  function(cx,cy){ startWitherbolt(cx,cy); },
    orange: function(cx,cy,isDrag,tier){ startOrangeTrap(cx,cy,isDrag?tier:undefined); },
    yellow: function(cx,cy,isDrag){
      if (isDrag) {
        startYellowConfuse(cx, cy, scaleDist(87 * tapScaleMult('yellow') * affinityRadiusMult('yellow')));
      } else {
        startYellowAura({ follow: true, radius: scaleDist(120), duration: 3.0, label: 'DAZE FIELD', isCrit: _currentCrit });
      }
    },
    red:    function(cx,cy,isDrag){
      if (isDrag) {
        startRedChargeTo(1, cx, cy);
      } else {
        startRedCharge(1, null);
      }
    },
    white:  function(cx,cy,isDrag){ if(isDrag && Math.hypot(cx-player.x,cy-player.y) < player.r+30){ startWhiteRegen(1); } else { doWhiteHeal(cx,cy); } },
    gray:   function(cx,cy){ startGrayArmor(cx,cy,1); },
  };

  function onMove(ev) {
    // Filter to the same pointer that started this press (in case of multitouch)
    if (pointerId !== undefined && ev.pointerId !== pointerId) return;
    dragPos = { x: ev.clientX, y: ev.clientY };
    if (overloadState) overloadState.dragPos = dragPos;
    var moved = Math.hypot(ev.clientX - startCX, ev.clientY - startCY);
    if (moved > 15) {
      if (color === 'blue')   blueDragPos   = dragPos;
      if (color === 'green')  greenDragPos  = dragPos;
      if (color === 'purple') purpleDragPos = dragPos;
      if (color === 'black')  blackDragPos  = dragPos;
      if (color === 'white')  whiteDragPos  = dragPos;
      if (color === 'yellow') yellowDragPos = dragPos;
      if (color === 'orange') orangeDragPos = dragPos;
      if (color === 'red')    redDragPos    = dragPos;
      if (color === 'gray')   grayDragPos   = dragPos;
    }
  }

  function onUp(ev) {
    if (pointerId !== undefined && ev.pointerId !== pointerId) return;
    var held = (performance.now() - startTime) / 1000;
    var upClientX = ev.clientX !== undefined ? ev.clientX : startCX;
    var upClientY = ev.clientY !== undefined ? ev.clientY : startCY;
    var rect = canvas.getBoundingClientRect();
    var canvasX = (upClientX - rect.left) * (canvas.width / rect.width);
    var canvasY = (upClientY - rect.top)  * (canvas.height / rect.height);
    var isDrag = Math.hypot(upClientX - startCX, upClientY - startCY) > scaleDist(20);
    var _ab = getRumbleBounds();
    var _outOfRumble = canvasX < _ab.x || canvasX > _ab.x+_ab.w || canvasY < _ab.y || canvasY > _ab.y+_ab.h;
    if (_outOfRumble) {
      // Dropped outside playable rumble area (bottom brick bar, top HUD, side gutter).
      // Treat as plain overload released at player position — as if the drag
      // never went over the rumble area. Fixes: dragging from brick bar into rumble area
      // then back to bar should not send the cast to wherever the pointer is.
      isDrag = false;
      canvasX = player ? player.x : _ab.x + _ab.w/2;
      canvasY = player ? player.y : _ab.y + _ab.h/2;
    }

    blueDragPos=null; greenDragPos=null; purpleDragPos=null; blackDragPos=null;
    yellowDragPos=null; orangeDragPos=null; redDragPos=null; grayDragPos=null;
    whiteDragPos=null;
    blueDragActive=false; greenDragActive=false; purpleDragActive=false; blackDragActive=false;
    yellowDragActive=false; orangeDragActive=false; redDragActive=false;
    whiteDragActive=false;

    var currentCharges = player.bricks[color] || 0;
    var tierDur = OVERLOAD_TIER;
    var bricksUsed = Math.max(1, Math.min(currentCharges, Math.floor(held / tierDur)));

    if (held >= tierDur && Math.floor(held / tierDur) >= 1) {
      if (overloadState) {
        fireOverload(isDrag ? canvasX : undefined, isDrag ? canvasY : undefined, bricksUsed);
      }
    } else {
      cancelOverload();
      if (!player.bricks[color] || player.bricks[color] <= 0) { cleanup(); return; }
      if (color === 'blue') {
        player.bricks[color]--;
        if (_battleStats) _addBrickStat(_battleStats.bricksUsed, color, 1);
        player.brickRecharge[color] = player.brickRecharge[color] || 0;
        renderBrickBar();
        if (isDrag) {
          // Drag-drop: fire a bolt at the drop point regardless of target.
          // Hits any entity within impact radius; harmless if dropped on empty
          // rumble floor. Enables AoE positioning / area denial.
          startBlueBoltAtPoint(canvasX, canvasY);
        } else {
          // Tap: home on nearest entity (legacy behavior).
          startBlueBolt(null);
        }
      } else if (dragFns[color]) {
        player.bricks[color]--;
        if (_battleStats) _addBrickStat(_battleStats.bricksUsed, color, 1);
        player.brickRecharge[color] = player.brickRecharge[color] || 0;
        renderBrickBar();
        var ox = isDrag ? canvasX : player.x;
        var oy = isDrag ? canvasY : player.y;
        dragFns[color](ox, oy, isDrag, 1);
      } else {
        useBrickAction(color);
      }
    }
    cleanup();
  }

  function onCancel(ev) {
    if (pointerId !== undefined && ev.pointerId !== pointerId) return;
    cancelOverload();
    blueDragPos=null; greenDragPos=null; purpleDragPos=null; blackDragPos=null;
    yellowDragPos=null; orangeDragPos=null; redDragPos=null; grayDragPos=null;
    cleanup();
  }

  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);

  if (color === 'blue') { blueDragActive = true; }
}

function useBrick(color) {
  useBrickAction(color);
}

// ═══════════════════════════════════════════════════
// FLOATING TEXT
// ═══════════════════════════════════════════════════
var floatingTexts = [];
// ═══════════════════════════════════════════════════
// UNIFIED BUFF / DEBUFF STACK
// Single renderer for player and entity effect lists. Effects stack
// vertically above the HP bar. Sort order: longest-remaining timer sits
// CLOSEST to the HP bar (bottom of stack), shortest at the top. Timerless
// effects (e.g. zone presence) render above all timered ones at the very
// top. Stacks shown as "×N" suffix on icon.
//
// Each effect: { icon, color, timer, stack? }
//   icon   — glyph or short string
//   color  — hex for glow and icon fill
//   timer  — seconds remaining, or null for untimered
//   stack  — optional integer; rendered as "icon ×N" if > 1
// ═══════════════════════════════════════════════════
function _drawEffectStack(anchorX, anchorBarY, effects) {
  if (!effects || !effects.length) return;
  // Sort: timerless → top. Among timered → shortest at top, longest nearest
  // HP bar (bottom). So sort ascending by timer with nulls as Infinity, then
  // render in that order from top down.
  effects.sort(function(a, b) {
    var ta = a.timer === null ? -1 : a.timer;
    var tb = b.timer === null ? -1 : b.timer;
    // Nulls first (smallest). Timered ascending after — longest last.
    return ta - tb;
  });
  var now = performance.now();
  var pulse = 0.75 + 0.25 * Math.sin(now * 0.005);
  var rowH = 16;
  var startY = anchorBarY - 8 - effects.length * rowH;
  effects.forEach(function(fx, i) {
    var ry = startY + i * rowH;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = fx.color; ctx.shadowBlur = 5;
    // Icon (left of center)
    ctx.font = '13px serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = fx.color;
    // Stack display: count sits BEFORE the icon (e.g. "3 ☠", "2 ✦", "5 ♥").
    // Matches the damage-number layout where numbers lead and the status
    // glyph trails. Keeps one visual grammar for "count + symbol" across
    // the whole UI. Single-stack effects show just the icon.
    var iconText = ((fx.stack && fx.stack > 1) ? fx.stack + ' ' : '') + fx.icon;
    ctx.fillText(iconText, anchorX - 2, ry);
    // Right-of-icon text: either a timer (Ns) or an explicit label (e.g.
    // the slow hourglass's "×0.25" move multiplier). Label takes priority
    // when both are present. Keeps the same mono-right column layout.
    var rightText = null;
    if (fx.label) {
      rightText = fx.label;
    } else if (fx.timer !== null && fx.timer !== undefined) {
      rightText = Math.ceil(fx.timer) + 's';
    }
    if (rightText) {
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dddddd';
      ctx.shadowBlur = 0;
      ctx.fillText(rightText, anchorX + 2, ry);
    }
    ctx.restore();
  });
}

// Assemble the entity effect list. Pure state read — returns the array.
function _entityEffects(g) {
  var fx = [];
  // Malady stacks
  if (g.poisoned) {
    fx.push({ icon:'☠', color:'#1D9E75', timer: g.poisonTimer || 0,
              stack: g.poisonStack || 1 });
  }
  var gBleeds = bleeds.filter(function(b){ return b.target === g && b.timer > 0; });
  if (gBleeds.length > 0) {
    var maxBleed = gBleeds.reduce(function(a,b){ return a.timer>b.timer?a:b; });
    fx.push({ icon:'🩸', color:'#cc2200', timer: maxBleed.timer });
  }
  if ((g.witherStacks||0) > 0) {
    fx.push({ icon:'✦', color:'#BB88FF', timer: g.witherTimer || 0,
              stack: g.witherStacks });
  }
  // Mind
  if (g.confused && (g.confuseTimer||0) > 0)
    fx.push({ icon:'?', color:'#F5D000', timer: g.confuseTimer });
  if (g.dazed && (g.confuseTimer||0) > 0)
    fx.push({ icon:'‼', color:'#FFEE44', timer: g.confuseTimer });
  // Vulnerabilities / casting
  if ((g.markedTimer||0) > 0)
    fx.push({ icon:'◎', color:'#4db8ff', timer: g.markedTimer });
  if ((g.silencedTimer||0) > 0)
    fx.push({ icon:'Ø', color:'#7B2FBE', timer: g.silencedTimer });
  // Slow — unified indicator. Any slow source (green field, white sanctuary,
  // generic snare, attack-slow) shows one hourglass icon. Movement and
  // attack slows are treated as one status visually and mechanically: if
  // you're move-slowed, you also attack-slow. Timer shown is the longest
  // remaining across all active sources; zone-refreshed slows (green/white)
  // register as timerless.
  //
  // Color: matches the source color when exactly one slow source is active.
  // When two or more overlap (e.g. standing in green field AND hit by
  // darkness attack-slow), the hourglass renders white to signal "multiple
  // slow sources stacked" without picking a single color arbitrarily.
  //
  // Label: decimal movement multiplier shown beside the hourglass so you
  // can see how hard the slow actually bites. Per-source mults match the
  // math in updateEntity (white 0.5, green 0.25, snare 0.1, attack-slow is
  // attack-only so doesn't multiply move speed).
  var timered = 0;
  var slowSources = []; // color per active source
  var moveMult = 1.0;
  if (g.greenSlowed && (g.greenSlowTimer||0) > 0) {
    slowSources.push('#1D9E75');
    moveMult *= 0.75;
  }
  if (g.whiteFieldSlowed && (g.whiteFieldSlowTimer||0) > 0) {
    slowSources.push('#EFEFEF');
    moveMult *= 0.5;
  }
  if (g.slowed && (g.slowTimer||0) > 0) {
    slowSources.push('#AAAAAA');
    moveMult *= 0.1;
    timered = Math.max(timered, g.slowTimer);
  }
  if (g.attackSlowed && (g.attackSlowTimer||0) > 0) {
    // Attack-slow is an attack-cooldown penalty, not a move mult — don't
    // fold into moveMult. Still counts as a slow source for icon color.
    slowSources.push('#7744AA');
    timered = Math.max(timered, g.attackSlowTimer);
  }
  if (slowSources.length > 0) {
    var anyZone = g.greenSlowed || g.whiteFieldSlowed;
    var slowColor = slowSources.length === 1 ? slowSources[0] : '#FFFFFF';
    // Show the multiplier as a label (e.g. .25). Use 2 decimals; strip the
    // leading "0" since the value is always < 1 when surfaced. No prefix —
    // the hourglass icon itself signals "this is a speed modifier".
    var slowLabel = null;
    if (moveMult < 1.0) {
      var mTxt = moveMult.toFixed(2);
      if (mTxt.charAt(0) === '0') mTxt = mTxt.slice(1); // "0.25" → ".25"
      slowLabel = mTxt;
    }
    fx.push({
      icon:'⧖', color: slowColor,
      timer: anyZone ? null : timered,
      label: slowLabel,
    });
  }
  // Zone presence — timerless
  if (blackEffect && blackEffect.alpha > 0) {
    var bDist = Math.hypot(g.x - (blackEffect.ox||blackEffect.x||0),
                           g.y - (blackEffect.oy||blackEffect.y||0));
    if (bDist < (blackEffect.RADIUS || blackEffect.r || 0)) {
      fx.push({ icon:'◉', color:'#555555', timer: null });
    }
  }
  return fx;
}

// Assemble the player effect list. Mirrors _entityEffects shape.
function _playerEffects() {
  var fx = [];
  if (!player) return fx;
  // S013.7: ALL player status effects flow through the unified effect
  // stack above the HP bar. Previously maladies (poison/slow/daze/confuse/
  // weaken) used a separate "pie wedge radial timer" above the player sprite
  // which was occluded by enemies and didn't match the entity side's
  // rendering. Now everything uses _drawEffectStack via this return array.
  //
  // Shape: { icon, color, timer (null = timerless), stack?, label? }
  if (player.status) {
    var s = player.status;
    // Maladies — poison leads (most actionable), stacks badge shown.
    if (s.poison.timer > 0 && s.poison.stacks > 0) {
      fx.push({ icon:'☠', color:'#1D9E75', timer: s.poison.timer, stack: s.poison.stacks });
    }
    if (s.slow.timer > 0 && s.slow.factor > 0) {
      // Format move multiplier like the entity side (".25" etc)
      var pMult = Math.max(0, 1 - s.slow.factor);
      var mTxt = pMult.toFixed(2);
      if (mTxt.charAt(0) === '0') mTxt = mTxt.slice(1);
      fx.push({ icon:'⧖', color:'#7FE0FF', timer: s.slow.timer, label: mTxt });
    }
    if (s.daze.timer > 0) {
      fx.push({ icon:'✦', color:'#F5D000', timer: s.daze.timer });
    }
    if (s.confuse.timer > 0) {
      fx.push({ icon:'?', color:'#E08CF0', timer: s.confuse.timer });
    }
    if (s.weaken.timer > 0) {
      fx.push({ icon:'▼', color:'#553366', timer: s.weaken.timer });
    }
  }
  // Buffs / resource timers. Regen is triggered by WHITE (brick) overload
  // or tap, so the icon color stays white (matches source).
  if (playerRegen && playerRegen.timer > 0)
    fx.push({ icon:'✚', color:'#EFEFEF', timer: playerRegen.timer });
  if (player.iframes > 0)
    fx.push({ icon:'🛡', color:'#88aaff', timer: player.iframes });
  if (dashCooldown > 0)
    fx.push({ icon:'💨', color:'#F5D000', timer: dashCooldown });
  // Sanctuary (white field) presence — timerless while inside the zone.
  if (whiteField) {
    var wDist = Math.hypot(player.x - (whiteField.ox||0), player.y - (whiteField.oy||0));
    if (wDist < (whiteField.radius || whiteField.r || 0)) {
      fx.push({ icon:'✦', color:'#EFEFEF', timer: null });
    }
  }
  // Overheal — player.hp is above hpMax (only source currently: purple
  // life-steal, which allows up to 3× hpMax). Shows the excess as a stack
  // count so a glance tells you how much overheal shield remains.
  if (player.hp > player.hpMax) {
    var overheal = Math.ceil(player.hp - player.hpMax);
    fx.push({ icon:'♥', color:'#9B6FD4', timer: null, stack: overheal });
  }
  return fx;
}

function showFloatingText(x, y, text, color, parent) {
  var now = performance.now();
  // ── Semantic lane classification ────────────────────────────────────
  // Three lanes relative to parent:
  //   RIGHT — damage numbers ("6", "12 ✦"), pickup numbers ("+1 🧀")
  //   LEFT  — heal numbers ("3 ✚", "+1 ♥", "2 🛡"), entity self-heal ("+1")
  //   CENTER-ABOVE — banners ("EVADE!", "DAZED", "Well aged.")
  //
  // Decision tree (ordered): Letter-led + no digit → banner. Presence of
  // heal icon (✚✨♥🛡) → heal-left. Presence of pickup icon (🧀🪙) → pickup-right.
  // Leading "+" with nothing else → treat as heal-left (it's a gain applied
  // to self — used by entity regen "+1" and similar). Otherwise damage-right.
  var startsWithLetter = /^[A-Za-z]/.test(text);
  var hasDigit = /\d/.test(text);
  var isHealIcon = /[✚✨♥🛡]/.test(text);
  var isPickupIcon = /[🧀🪙]/.test(text);
  var isPlainPlus = /^\+\d+\s*$/.test(text); // "+1", "+3 " (no icon) → self-heal tick
  // Banner: letters, no digits (e.g. "DAZED", "EVADE!", "Well aged.")
  // OR letters-then-digits like "HP LOW" patterns don't appear in the callers.
  var isBanner = startsWithLetter && !hasDigit;
  // Numeric routing:
  var isNumeric = hasDigit || /^[+\-−]/.test(text);
  var isHeal = isHealIcon || isPlainPlus;
  if (parent && parent.r !== undefined && isNumeric && !isBanner) {
    // Fixed-offset placement relative to parent, matching showDamageNumber.
    var offset = parent.r + 22;
    if (isHeal) {
      x = parent.x - offset;  // LEFT lane
      y = parent.y;
    } else {
      x = parent.x + offset;  // RIGHT lane (damage + pickup)
      y = parent.y;
    }
  }
  // Damage/heal detection: starts with a digit (we stripped +/- prefixes).
  // Non-numeric text like "EVADE!" or "WAIT..." stays unmerged.
  var isDmg = isNumeric;
  // Merge damage numbers at same target position within 120ms
  if (isDmg) {
    var num = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
    var merged = floatingTexts.find(function(ft) {
      return ft.mergeable && ft.color === (color||'#fff') &&
        Math.hypot(ft.x - x, ft.y - y) < 30 &&
        now - ft.spawnTime < 120;
    });
    if (merged) {
      merged.accum = (merged.accum||0) + num;
      // Preserve whatever icon/suffix came with the incoming text (☠, 🩸, HP, 🛡, etc).
      // Everything after the leading numeric run is the suffix.
      var suffixMatch = text.match(/^[0-9.]+(.*)$/);
      var suffix = suffixMatch ? suffixMatch[1] : '';
      merged.text = merged.accum + suffix;
      var scale = Math.min(2.6, 0.72 + Math.log2(merged.accum + 1) * 0.38);
      merged.fontSize = Math.round(10 * scale);
      merged.fadeRate = Math.max(0.005, 0.02 / scale);
      merged.vy = -(60 + scale * 24);
      return;
    }
  }
  var num2 = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
  var hasIcon = /[☠🩸💀✚✨🛡♥🧀🪙]/.test(text);
  // Font scale: numeric hits use log curve; icon-bearing text (pickups)
  // gets a fixed boost; pure flavor text (no digits, no icons) renders
  // largest so it reads cleanly against the canvas.
  var scale2;
  if (num2 > 0) {
    scale2 = Math.min(2.6, 0.72 + Math.log2(num2 + 1) * 0.38);
  } else if (hasIcon) {
    scale2 = 1.4; // was 1.0 — pickup icons need presence
  } else {
    scale2 = 1.5; // was 0.9 — flavor text was sub-10px and unreadable
  }
  var fontSize2 = Math.round(10 * scale2);
  var fadeRate2 = Math.max(0.005, 0.02 / scale2);
  var riseSpeed2 = 60 + scale2 * 24;
  // Parent linkage: if a parent ref is passed, store offset from parent at
  // spawn so the text can track parent motion in the update loop.
  var par = parent || null;
  var offX0 = x - (par ? par.x : x);
  var offY0 = y - (par ? par.y : y);
  // Side hint for the renderer — heals on the left, everything else right.
  var _side = par && isHeal ? 'left' : 'right';
  floatingTexts.push({ x: x, y: y, text: text, color: color||'#fff', alpha:1,
    vy: -riseSpeed2, fadeRate: fadeRate2, fontSize: fontSize2,
    mergeable: !!isDmg, accum: num2, spawnTime: now,
    parent: par, offX: offX0, offY: offY0, side: _side });
  if (FLOATER_DEBUG && typeof console !== 'undefined') {
    console.log('[FLOAT-TXT]', JSON.stringify({
      text: text, isDmg: isDmg, isHeal: isHeal, isNumeric: isNumeric,
      parent: par ? (par === player ? 'player' : (par.type || '?')) : 'none',
      parR: par ? par.r : null,
      parPos: par ? ('(' + Math.round(par.x) + ',' + Math.round(par.y) + ')') : null,
      spawn: '(' + Math.round(x) + ',' + Math.round(y) + ')',
      offset: par ? ('(' + Math.round(offX0) + ',' + Math.round(offY0) + ')') : null,
      side: _side, fontSize: fontSize2,
    }));
  }
}

// Fizzle sparks — small erratic grey-white embers near an entity's edge.
// Reads as a visual "dink" — a short, twitchy burst of tiny particles that
// die fast. Contrast with DEFLECTION sparks (big directional punch) and
// PULSE particles (smooth drift). Each fizzle particle jitters its velocity
// on every frame (erratic, not smooth), so the effect reads as noise/static
// rather than a controlled motion.
//   ex, ey: entity center
//   count:  particle count (IMMUNE uses more than RESIST)
//   color:  grey-white shade; pass '#d8d8d8' or similar
//   entR:   optional entity radius so sparks spawn OUTSIDE the sprite
//           (prevents clipping). Defaults to 16 if not provided.
function _spawnFizzleSparks(ex, ey, count, color, entR) {
  count = count || 8;
  color = color || '#d8d8d8';
  entR = entR || 16;
  var spawnRadius = entR + 6;  // spawn ring sits clear of the sprite edge
  for (var i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    // Spawn ring around entity edge, small jitter
    var sx = ex + Math.cos(a) * spawnRadius + (Math.random() - 0.5) * 3;
    var sy = ey + Math.sin(a) * spawnRadius + (Math.random() - 0.5) * 3;
    // Faster emission (40-80 px/s), still outward
    var s = 40 + Math.random() * 40;
    // Short life so particles pop and die (2-3x prior decay rate)
    var life = 0.25 + Math.random() * 0.2;
    purpleParticles.push({
      x: sx, y: sy,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 4,           // faint upward bias
      r: 0.6 + Math.random() * 0.7,       // SMALLER particles (was 1.0-2.3)
      alpha: 0.85 + Math.random() * 0.15,
      color: color,
      shadowColor: color,                 // glow matches fill
      fadeRate: 0.05 / life,              // ~0.15-0.20/frame = dies in ~5-8 frames
      // Fizzle-specific behavior flags (read by updatePurpleParticles):
      isFizzle: true,
      jitter: 80 + Math.random() * 60,    // erratic velocity perturbation per-frame
      droop: 30 + Math.random() * 20,     // downward pull while fading
    });
  }
}

// Tiered damage number display. Pure numeric, no text suffix.
// Each tier conveys effectiveness through VISUAL PHYSICS, not words:
//   IMMUNE  → tiny "0" that fizzles (shrinks, wobbles, vanishes) + grey puff at entity
//   RESIST  → small muted number that BOUNCES OUTWARD off the entity edge
//   NEUTRAL → standard floater (baseline)
//   VULN    → bigger, brighter, faster rise, pulsing glow
//   WEAK    → largest, white-outlined, rises with SHAKE jitter + strong glow
function showDamageNumber(x, y, applied, color, tier, entityX, entityY, prefix, witherBoost, parent) {
  var baseColor = color || '#fff';
  var now = performance.now();
  // Entity center defaults to hit point if not supplied.
  var ex = (entityX !== undefined) ? entityX : x;
  var ey = (entityY !== undefined) ? entityY : y;
  // Parent is the entity or player the damage is attached to. When present,
  // the floating text tracks the parent's position each frame (offX/offY are
  // the offset from parent center). Lets numbers follow pushed/moved targets
  // instead of hanging in world space. If the parent dies (hp<=0 or missing),
  // the text detaches at its last position and continues rising on its own.
  var par = parent || null;
  // Spawn position: when parented, numbers appear to the RIGHT of the target's
  // hitbox at roughly vertical center rather than stacked between the target
  // and its HP bar. Offset par.r + 22 (unified with showFloatingText) gives
  // proper clearance past the sprite edge + HP bar region.
  // RESIST tier overrides this below (its bounce-off geometry is independent).
  if (par && par.r !== undefined && tier !== 'RESIST') {
    var rightOffset = par.r + 22;
    x = par.x + rightOffset;
    y = par.y;
    ex = par.x + rightOffset;
    ey = par.y;
  }
  var offX0 = x - (par ? par.x : x);
  var offY0 = y - (par ? par.y : y);
  var offExX0 = ex - (par ? par.x : ex);
  var offExY0 = ey - (par ? par.y : ey);
  // Optional icon prefix (e.g. ☠ for poison ticks). Rendered slightly smaller
  // than the damage text; status icon sits left of the number.
  var icon = prefix || '';
  // Wither boost — when hits are amplified by wither stacks on the target,
  // the number renders larger and persists longer so the payoff of stacking
  // is legible even when base damage is small. Linear growth: +25% font
  // size per stack, capped at 11 stacks (3.75× size). Fade slows on the
  // same curve so big numbers linger. Only affects NEUTRAL/VULN/WEAK rises
  // — RESIST/IMMUNE are unaffected (stacking wither on an immune target
  // shouldn't look heroic).
  var wb = witherBoost || 0;
  var wbClamped = Math.min(11, wb);
  var witherFontScale = 1 + 0.25 * wbClamped;   // 1 → 1.25, 11 → 3.75
  var witherFadeScale = Math.max(0.18, Math.pow(0.55, Math.min(wbClamped, 6)));
  if (tier === 'IMMUNE') {
    // Fizzle-out "0" — grows a touch then shrinks to nothing. Larger than
    // before (11 → 15) so it reads against the canvas. Parent-anchored
    // RIGHT of the target. Offset 24 puts it clear of sprite edge + HP bar
    // area on larger enemies.
    var immX = par ? par.x + par.r + 24 : ex;
    var immY = par ? par.y : ey - 10;
    var immOffX = par ? par.r + 24 : offExX0;
    var immOffY = par ? 0 : offExY0 - 10;
    floatingTexts.push({
      x: immX, y: immY, text: '0' + (icon ? ' ' + icon : ''), color: '#bfbfbf',
      alpha: 0.95, vy: -10, fadeRate: 0.035, fontSize: 15,  // slow rise, slightly longer fade
      mergeable: false, accum: 0, spawnTime: now,
      tier: 'IMMUNE', shrink: true, wobbleAmp: 2,
      parent: par, offX: immOffX, offY: immOffY, side: 'right',
    });
    // FIZZLE sparks: grey-white embers drifting outward from the entity's
    // edge, with flutter + droop. Reads as "the attack gave up / scattered
    // harmlessly". Sparse + slow, not a splash.
    _spawnFizzleSparks(ex, ey, 10, '#d8d8d8', par ? par.r : 16);
    return;
  }
  var text = '' + applied + (icon ? ' ' + icon : '');
  if (tier === 'RESIST') {
    // Bounce OUTWARD off the entity — spawn at entity EDGE plus a gap,
    // initial velocity carries it a bit further out, then gravity arcs
    // it down. Font 14 for legibility. Prior 22-unit fixed offset was
    // too tight on larger entities and could clip their sprite.
    var dx = x - ex, dy = y - ey;
    var dist = Math.sqrt(dx*dx + dy*dy) || 1;
    var nx = dx / dist, ny = dy / dist;
    var entR = (par && par.r) ? par.r : 16;
    var spawnDist = entR + 22;        // sprite radius + clear gap
    floatingTexts.push({
      x: ex + nx * spawnDist, y: ey + ny * spawnDist, text: text, color: _muteColor(baseColor),
      alpha: 0.95, vy: ny * 40 - 16, vx: nx * 40,   // halved bounce speed
      fadeRate: 0.025, fontSize: 14,
      mergeable: false, accum: applied, spawnTime: now,
      tier: 'RESIST', glowMult: 0.3,
      // Bounce physics: gravity pulls it down gently
      gravity: 140,
    });
    // Deflection sparks — directional burst along the bounce vector
    for (var si = 0; si < 3; si++) {
      var sa = Math.atan2(ny, nx) + (Math.random() - 0.5) * 0.7;
      var ss = 60 + Math.random() * 60;
      purpleParticles.push({
        x: ex + nx * 18, y: ey + ny * 18,
        vx: Math.cos(sa) * ss, vy: Math.sin(sa) * ss,
        r: 1.5 + Math.random() * 1.5, alpha: 0.8, color: _muteColor(baseColor),
      });
    }
    // FIZZLE sparks layer — grey-white embers drifting outward from the
    // entity's edge with flutter + droop. Sits alongside the deflection
    // sparks: deflection is fast/directional, fizzle is slow/ambient.
    _spawnFizzleSparks(ex, ey, 7, '#d0d0d0', par ? par.r : 16);
    return;
  }
  // NEUTRAL / VULN / WEAK use "rising number" style
  // Rise speeds tuned fast so numbers clear the hit zone before the next
  // tick arrives. Prior values (35/50/65) let rapid hits overlap into a
  // muddle; current (70/100/130) double the rise so stacking reads clearly.
  var cfg;
  switch (tier) {
    case 'VULN':
      cfg = { fontSize: 18, rise: 100, fade: 0.018, color: _brightColor(baseColor),
              glow: 1.6, pulse: true };
      break;
    case 'WEAK':
      cfg = { fontSize: 24, rise: 130, fade: 0.014, color: _brightColor(baseColor),
              glow: 2.4, pulse: true, shake: true, outline: true };
      break;
    case 'NEUTRAL':
    default:
      cfg = { fontSize: 14, rise: 70, fade: 0.02, color: baseColor, glow: 1.0 };
      break;
  }
  // ── Unified text-styling model ────────────────────────────────────────
  // Final font/fade/glow are the product of independent signal multipliers:
  //   tier     : NEUTRAL 1.0, VULN 1.3, WEAK 1.7  (via cfg.fontSize curve)
  //   wither   : +25% per stack (cap 11), fade slows ×0.55^stacks
  //   magnitude: log2-smooth growth with damage size, cap at ~2.0×
  // Crit deliberately NOT on damage numbers — handled by the crit banner.
  //
  // Magnitude curve: 1 + 0.22 * log2(applied + 1), clamped [1.0, 2.0].
  //   1 dmg  → 1.22×      (tiny bump keeps low hits legible)
  //   5 dmg  → 1.57×
  //   10 dmg → 1.76×
  //   25 dmg → 1.99× (near cap)
  //   100+   → 2.00× (cap)
  // Fade scales inversely with sqrt of magnitude so bigger numbers linger.
  var magScale = Math.min(2.0, Math.max(1.0, 1 + 0.22 * Math.log2((applied || 0) + 1)));
  var magFadeScale = 1 / Math.sqrt(magScale);
  // Compose final multipliers. cfg.fontSize already encodes tier, so we
  // multiply by wither and magnitude. Same for fade.
  var finalFontSize = Math.round(cfg.fontSize * witherFontScale * magScale);
  var finalFadeRate = cfg.fade * witherFadeScale * magFadeScale;
  var finalGlow     = cfg.glow * (1 + wb * 0.15) * (1 + 0.25 * (magScale - 1));
  floatingTexts.push({
    x: x, y: y, text: text, color: cfg.color,
    alpha: 1, vy: -cfg.rise, fadeRate: finalFadeRate,
    fontSize: finalFontSize,
    mergeable: false, accum: applied, spawnTime: now,
    tier: tier, glowMult: finalGlow,
    pulse: !!cfg.pulse || wb > 0, // withered hits pulse even at neutral tier
    shake: !!cfg.shake, outline: !!cfg.outline || wb >= 3,
    parent: par, offX: offX0, offY: offY0, side: 'right',
  });
  if (FLOATER_DEBUG && typeof console !== 'undefined') {
    console.log('[FLOAT-DMG]', JSON.stringify({
      text: text, tier: tier, applied: applied,
      parent: par ? (par === player ? 'player' : (par.type || '?')) : 'none',
      parR: par ? par.r : null,
      parPos: par ? ('(' + Math.round(par.x) + ',' + Math.round(par.y) + ')') : null,
      spawn: '(' + Math.round(x) + ',' + Math.round(y) + ')',
      offset: par ? ('(' + Math.round(offX0) + ',' + Math.round(offY0) + ')') : null,
      side: 'right', fontSize: finalFontSize,
    }));
  }
}

// Helpers to shift color for resist tier rendering.
// _muteColor desaturates and darkens. _brightColor brightens.
function _muteColor(hex) {
  // Simple blend toward grey
  var rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  var r = Math.round(rgb.r * 0.5 + 120 * 0.5);
  var g = Math.round(rgb.g * 0.5 + 120 * 0.5);
  var b = Math.round(rgb.b * 0.5 + 120 * 0.5);
  return '#' + _toHex(r) + _toHex(g) + _toHex(b);
}
function _brightColor(hex) {
  // Saturation boost that preserves hue. Prior version blended 70/30 toward
  // white, which desaturated everything — red became salmon, blue became
  // powder-blue, and users read those as wrong colors. Multiplying each
  // channel by 1.35 with a ceiling clamp brightens vividness while keeping
  // the color on-hue. Example: #E24B4A (226,75,74) → (255,101,100) = rich
  // saturated red instead of salmon.
  var rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  var r = Math.min(255, Math.round(rgb.r * 1.35));
  var g = Math.min(255, Math.round(rgb.g * 1.35));
  var b = Math.min(255, Math.round(rgb.b * 1.35));
  return '#' + _toHex(r) + _toHex(g) + _toHex(b);
}
function _hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return null;
  var h = hex.slice(1);
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function _toHex(n) { var s = n.toString(16); return s.length < 2 ? '0'+s : s; }

// Shift a hex color toward white (lighten) or toward black (darken) by amount
// in [0, 1]. Used by drawEntity for inner-body and shadow colors derived
// from the entity template's base color. Preserves hue.
function _lightenHex(hex, amount) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  var a = Math.max(0, Math.min(1, amount));
  var r = Math.round(rgb.r + (255 - rgb.r) * a);
  var g = Math.round(rgb.g + (255 - rgb.g) * a);
  var b = Math.round(rgb.b + (255 - rgb.b) * a);
  return '#' + _toHex(r) + _toHex(g) + _toHex(b);
}
function _darkenHex(hex, amount) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return hex;
  var a = Math.max(0, Math.min(1, amount));
  var r = Math.round(rgb.r * (1 - a));
  var g = Math.round(rgb.g * (1 - a));
  var b = Math.round(rgb.b * (1 - a));
  return '#' + _toHex(r) + _toHex(g) + _toHex(b);
}

// (injected into draw loop)
var _origDraw = draw;
draw = function() {
  _origDraw();
  var now = performance.now();
  floatingTexts = floatingTexts.filter(function(ft) { return ft.alpha > 0.05; });
  floatingTexts.forEach(function(ft) {
    // Parent tracking: if this text is attached to a live entity/player, its
    // screen position is parent position + (offX, offY). offY carries the
    // vertical rise so the number drifts upward from the parent as it does
    // in world space. If parent dies or disappears, detach — the text falls
    // back to world-space motion from its last known offset.
    if (ft.parent) {
      var parentAlive =
        (ft.parent.hp === undefined || ft.parent.hp > 0) &&
        (ft.parent.x !== undefined && ft.parent.y !== undefined);
      if (parentAlive) {
        if (ft.offY === undefined) ft.offY = ft.y - ft.parent.y;
        if (ft.offX === undefined) ft.offX = ft.x - ft.parent.x;
        ft.offY += (ft.vy || 0) * 0.016;
        if (ft.vx !== undefined) ft.offX += ft.vx * 0.016;
        if (ft.gravity) ft.vy += ft.gravity * 0.016;
        ft.x = ft.parent.x + ft.offX;
        ft.y = ft.parent.y + ft.offY;
      } else {
        // Detach — remember final world pos and continue as if unparented.
        ft.parent = null;
        ft.y += (ft.vy || 0) * 0.016;
        if (ft.vx !== undefined) ft.x += ft.vx * 0.016;
        if (ft.gravity) ft.vy += ft.gravity * 0.016;
      }
    } else {
      // Position update — supports vx (bounce-back) and gravity (resist arc)
      ft.y += (ft.vy || 0) * 0.016;
      if (ft.vx !== undefined) ft.x += ft.vx * 0.016;
      if (ft.gravity) ft.vy += ft.gravity * 0.016;
    }
    ft.alpha -= (ft.fadeRate || 0.02);
    // Shrink (IMMUNE tier) — font size interpolates down with alpha
    var fs = ft.fontSize || 14;
    if (ft.shrink) fs = fs * Math.max(0.3, ft.alpha);
    // Wobble (IMMUNE tier) — small horizontal jitter
    var drawX = ft.x;
    if (ft.wobbleAmp) drawX += Math.sin(performance.now() * 0.02 + ft.spawnTime) * ft.wobbleAmp;
    // Shake (WEAK tier) — random horizontal jitter in first 200ms
    if (ft.shake) {
      var age = now - ft.spawnTime;
      if (age < 200) {
        drawX += (Math.random() - 0.5) * 6;
      }
    }
    // Pulse (VULN/WEAK) — glow modulated by sin
    var glow = ft.glowMult !== undefined ? ft.glowMult : 1.0;
    if (ft.pulse) {
      glow *= (1 + 0.3 * Math.sin((now - ft.spawnTime) * 0.025));
    }
    ctx.save();
    ctx.globalAlpha = ft.alpha;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold ' + Math.round(fs) + 'px Cinzel, serif';
    // Alignment rule:
    //   • Parented + left side (heals): right-align so text reads out
    //     away from the entity (extends further left).
    //   • Parented + right side (damage): left-align, text extends right.
    //   • Unparented: center-align (banners, evade text, etc).
    var _align = 'center';
    if (ft.parent) {
      _align = (ft.side === 'left') ? 'right' : 'left';
    }
    ctx.textAlign = _align;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = (fs / 14) * 5 * ft.alpha * glow;
    // Outline (WEAK tier) for extra saturation pop
    if (ft.outline || ft.tier === 'WEAK') {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(ft.text, drawX, ft.y);
    }
    ctx.fillText(ft.text, drawX, ft.y);
    ctx.restore();
  });
  // Crit visual polish — flash under everything (but we draw last as
  // translucent overlay for punch) and banners on top.
  drawCritShockwaves();
  drawCritFlash();
  drawCritBanners();
};

// ═══════════════════════════════════════════════════
// ENTITY AI HELPERS (projectiles, pulses, shared melee damage)
// ═══════════════════════════════════════════════════
// Enemy projectile pool — simple straight-line bolts fired by ranged_kite
// entities (slingers, etc). Each projectile tracks source for log lines,
// direction for render orientation, and a TTL so stray misses expire.
var enemyProjectiles = [];

// Fire a projectile from entity `g` toward a target point (usually player
// position at time of firing). Physical damage; no homing. TTL long enough
// to reach the player from any spawn location at the default speed.
function spawnEnemyProjectile(g, tx, ty, dmg) {
  var pdx = tx - g.x, pdy = ty - g.y;
  var pd = Math.hypot(pdx, pdy);
  if (pd < 0.01) return null; // avoid div-by-zero when player is exactly on entity
  var speed = 320;
  var proj = {
    x: g.x, y: g.y,
    vx: (pdx/pd) * speed,
    vy: (pdy/pd) * speed,
    dmg: dmg || 2,
    r: 5,
    ttl: 2.5,
    sourceType: g.type || 'enemy',
    color: null,   // Phase C: special variants override (orange/yellow/black)
  };
  enemyProjectiles.push(proj);
  return proj;
}

function updateEnemyProjectiles(dt) {
  if (!player) return;
  enemyProjectiles.forEach(function(p) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) { p.done = true; return; }
    // Hit player?
    var pdx = player.x - p.x, pdy = player.y - p.y;
    if (Math.hypot(pdx, pdy) < p.r + player.r) {
      if (!player.iframes) {
        _applyEnemyMeleeDamage({ type: p.sourceType }, p.dmg, -p.vx, -p.vy, 0);
        // PHASE C — consume slinger special-shot flags on impact.
        if (p._yellowDaze) {
          applyStatus('daze', { duration: 1.5 });
          showFloatingText(player.x, player.y - 60, 'DAZED', '#F5D000', player);
        }
        if (p._orangeShrapnel) {
          // Spawn 3 thorn shards radiating outward at impact point.
          for (var si = 0; si < 3; si++) {
            var ang = (si / 3) * Math.PI * 2;
            spawnThornShard(p.x + Math.cos(ang) * 10, p.y + Math.sin(ang) * 10);
          }
        }
        // PHASE C — black weaken orb on impact.
        if (p._blackWeaken) {
          applyStatus('weaken', { duration: 3 });
          showFloatingText(player.x, player.y - 60, 'WEAKENED', '#553366', player);
        }
      }
      p.done = true;
    }
  });
  enemyProjectiles = enemyProjectiles.filter(function(p) { return !p.done; });
}

function drawEnemyProjectiles() {
  if (!ctx) return;
  enemyProjectiles.forEach(function(p) {
    var col = p.color || '#E24B4A';
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();
    // Inner highlight for visibility
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffffcc';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
}

// PHASE E — BOULDER TOSS SYSTEM
// Troll's signature arcing projectile. Flies in a parabolic arc to a
// pre-selected impact point (player's position at throw time). Lands
// with 1.2s total travel time, damages 4 in 50px radius, and spawns
// thorn pool 2s. Shadow on ground telegraphs impact location.
var boulders = [];
function spawnBoulder(g, tx, ty) {
  if (!player) return;
  boulders.push({
    sx: g.x, sy: g.y,           // start
    tx: tx,  ty: ty,            // target (impact point)
    t: 0,                       // 0..1 progress
    dur: 1.2,                   // travel time
    ownerType: g.type || 'boulder',
    done: false,
  });
}
function updateBoulders(dt) {
  for (var i = boulders.length - 1; i >= 0; i--) {
    var b = boulders[i];
    b.t += dt / b.dur;
    if (b.t >= 1) {
      // Impact — AoE damage + thorn pool.
      if (player && !player.iframes) {
        var dx = player.x - b.tx, dy = player.y - b.ty;
        if (Math.hypot(dx, dy) < 50 + player.r) {
          _applyEnemyMeleeDamage({ type: b.ownerType }, 4, dx, dy, 0);
        }
      }
      // Drop 3 thorn shards around impact for the 2s thorn pool effect.
      for (var si = 0; si < 3; si++) {
        var ang = (si / 3) * Math.PI * 2 + Math.random();
        spawnThornShard(b.tx + Math.cos(ang) * 16, b.ty + Math.sin(ang) * 16);
      }
      // Dust puff floater.
      showFloatingText(b.tx, b.ty, '💥', '#8A7A5B', null);
      boulders.splice(i, 1);
    }
  }
}
function drawBoulders() {
  if (!ctx) return;
  for (var i = 0; i < boulders.length; i++) {
    var b = boulders[i];
    // Parabolic arc position.
    var x = b.sx + (b.tx - b.sx) * b.t;
    var y = b.sy + (b.ty - b.sy) * b.t;
    var arcH = -80 * 4 * b.t * (1 - b.t);    // peak height at t=0.5
    // Ground shadow at impact target — grows as boulder falls.
    var shadowA = 0.2 + b.t * 0.5;
    ctx.save();
    ctx.globalAlpha = shadowA;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(b.tx, b.ty, 50 * (0.4 + b.t * 0.6), 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    // Boulder itself
    ctx.save();
    ctx.fillStyle = '#6f6f6f';
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y + arcH, 12, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}


// PHASE C/D — fire one slinger shot, tagging for orange shrapnel (every 3rd)
// or yellow daze (every 5th). Extracted into a helper so both legacy
// single-shot rhythm and burst_fire signature can share the arsenal logic.
function _fireSlingerShot(g) {
  if (!g || !player) return;
  g._shotCount = (g._shotCount || 0) + 1;
  var proj = spawnEnemyProjectile(g, player.x, player.y, g.rangedDmg || 2);
  if (proj && g.affinityColors) {
    if (g.affinityColors.indexOf('yellow') >= 0 && g._shotCount % 5 === 0) {
      proj._yellowDaze = true;
      proj.color = '#F5D000';
    } else if (g.affinityColors.indexOf('orange') >= 0 && g._shotCount % 3 === 0) {
      proj._orangeShrapnel = true;
      proj.color = '#F57C00';
    }
  }
}

// Pulse FX — spawned by stationary entities on AoE cooldown. Piggybacks
// the existing armorBursts visual pool since it already handles the
// expanding-ring animation and fadeout.
function spawnEnemyPulseFX(g, r) {
  if (typeof armorBursts !== 'undefined') {
    armorBursts.push({
      x: g.x, y: g.y,
      r: 8, maxR: r,
      color: '#aa2030',
      age: 0, ttl: 0.6,
      _enemyPulse: true,
    });
  }
}

// Shared enemy melee damage resolver — handles armor absorb then HP,
// shows floaters, sets iframes. Called by heavy_melee swing resolution,
// stationary pulse, and projectile impacts.
// ═══════════════════════════════════════════════════
// PHASE C — ENTITY ARSENAL EFFECTS
// ═══════════════════════════════════════════════════
// Each entity's affinityColors drive on-touch and per-frame effects.
// Three hook points:
//   1. applyArsenalOnTouch(g) — called whenever entity makes contact damage.
//        Fires touch-triggered arsenal: poison (green), vampire heal (purple),
//        knockback (red handled inline at damage site).
//   2. tickPassiveArsenal(g, dt) — called once per frame per entity. Handles
//        continuous arsenals: gray armor-pip refresh, white slow regen.
//   3. entityIncomingDmgMult(g) — called when PLAYER hits entity. Returns
//        multiplier (0.7 for gray DR, 1.0 default). Hook adds "−30%" floater.
//
// Projectile/emerge arsenals (black weaken orb, slinger orange/yellow,
// colossus orange cracks, worm poison trail) hook in their respective
// firing sites, not here.

function applyArsenalOnTouch(g, dx, dy, dist) {
  if (!g || !g.affinityColors || !player) return;
  var cols = g.affinityColors;
  // GREEN — apply poison DoT (3 dmg over 6s, stacks)
  if (cols.indexOf('green') >= 0) {
    applyStatus('poison', { stacks: 1, duration: 6, dmgPerTick: 1 });
  }
  // PURPLE — vampiric heal to entity. +5 for cursed_knight (swing-hit),
  // +2 for all others (touch contact).
  // PHASE E — stone_colossus purple vampirism is phase-2 only (gated by
  // _enraged flag set via enrage_phase signature).
  if (cols.indexOf('purple') >= 0) {
    var purpleOK = (g.type !== 'stone_colossus') || g._enraged;
    if (purpleOK) {
      var healAmt = (g.type === 'cursed_knight') ? 5
                  : (g.type === 'stone_colossus') ? 3 : 2;
      var prevEntityHp = g.hp;
      g.hp = Math.min(g.hpMax, g.hp + healAmt);
      var entityHealed = g.hp - prevEntityHp;
      if (_battleStats && entityHealed > 0) {
        _battleStats.totalEntityHeal = (_battleStats.totalEntityHeal || 0) + entityHealed;
        if (entityHealed > (_battleStats.biggestHealEntity || 0)) _battleStats.biggestHealEntity = entityHealed;
      }
      // Reactive tell: red heart floater from player toward entity
      spawnHeartFloat(player.x, player.y, g.x, g.y);
    }
  }
  // RED knockback is applied inline at the damage site via bounce vectors;
  // nothing needed here (the default bounce IS the knockback for red users).
}

// Per-frame passive arsenals. Called from updateEntity for each entity.
// Does not interact with touch damage — handles continuous/timed effects.
function tickPassiveArsenal(g, dt) {
  if (!g || !g.affinityColors || !running) return;
  var cols = g.affinityColors;

  // GRAY — periodic armor-pip refresh. Every arsenalCooldown seconds,
  // grant entity 3 armor pips (reduces next 3 hits by 50% via resistMult
  // existing system). Only applies if entity has arsenalCooldown > 0
  // AND has gray in affinity.
  if (cols.indexOf('gray') >= 0 && (g.arsenalCooldown || 0) > 0) {
    g._grayArmorTimer = (g._grayArmorTimer || 0) - dt;
    if (g._grayArmorTimer <= 0) {
      g._grayArmorPips = Math.min(3, (g._grayArmorPips || 0) + 3);
      g._grayArmorTimer = g.arsenalCooldown;
      // Small gray flash to signal armor refresh
      showFloatingText(g.x, g.y - (g.r + 10), '🛡 +3', '#AAAAAA', g);
    }
  }

  // WHITE — slow self regen. +1 HP every 3s while not hit in 2s.
  if (cols.indexOf('white') >= 0 && g.hp < g.hpMax) {
    g._whiteDisengageTimer = (g._whiteDisengageTimer || 0) + dt;
    // If recently flashed (took damage), reset disengage timer.
    if (g.flashTimer > 0) g._whiteDisengageTimer = 0;
    if (g._whiteDisengageTimer >= 2.0) {
      g._whiteRegenAccum = (g._whiteRegenAccum || 0) + dt;
      if (g._whiteRegenAccum >= 3.0) {
        g._whiteRegenAccum -= 3.0;
        g.hp = Math.min(g.hpMax, g.hp + 1);
        showFloatingText(g.x, g.y - (g.r + 10), '+1', '#EFEFEF', g);
      }
    } else {
      g._whiteRegenAccum = 0;
    }
  }

  // GREEN POISON TRAIL — worm-style: leaves poison puddle in wake.
  // Spawns every 0.4s while moving. Only on entities with green in arsenal
  // AND family 'malady' (so it's boss-tier distinctive, not on grunts).
  if (cols.indexOf('green') >= 0 && g.family === 'malady' && g.speed > 0) {
    g._poisonTrailTimer = (g._poisonTrailTimer || 0) + dt;
    if (g._poisonTrailTimer >= 0.4) {
      g._poisonTrailTimer = 0;
      spawnPoisonPuddle(g.x, g.y);
    }
  }
}

// Applied to PLAYER-DEALT damage before it hits entity. 0.7 if gray pips active.
// Hooked into the entity damage path — called in the existing damage function.
function entityIncomingDmgMult(g) {
  if (!g) return 1;
  // Troll passive DR: 30% reduction (constant) if gray in affinity AND
  // template is stone_troll. Other gray users rely on pip system.
  if (g.type === 'stone_troll' && g.affinityColors && g.affinityColors.indexOf('gray') >= 0) {
    return 0.7;
  }
  // Gray pip system: consume one pip and halve damage.
  if ((g._grayArmorPips || 0) > 0) {
    g._grayArmorPips -= 1;
    return 0.5;
  }
  return 1;
}

// Small visual: red heart floater from (ax,ay) toward (bx,by).
// Used to telegraph vampiric heal on an entity.
function spawnHeartFloat(ax, ay, bx, by) {
  floatingTexts.push({
    text: '♥',
    color: '#E24B4A',
    size: 18,
    alpha: 1,
    timer: 0.6,
    maxTimer: 0.6,
    worldSpace: true,
    wx: ax, wy: ay,
    vox: (bx - ax) / 36,   // reach target in ~36 frames at 60fps
    voy: (by - ay) / 36,
  });
}

// Poison puddle hazard. Short-lived ground patch that damages player
// on contact and applies poison. Boss/elite-only arsenal effect.
var poisonPuddles = [];
function spawnPoisonPuddle(x, y) {
  poisonPuddles.push({ x: x, y: y, r: 18, timer: 2.0, tickTimer: 0 });
}
function updatePoisonPuddles(dt) {
  for (var i = poisonPuddles.length - 1; i >= 0; i--) {
    var p = poisonPuddles[i];
    p.timer -= dt;
    if (p.timer <= 0) { poisonPuddles.splice(i, 1); continue; }
    if (player && !player.iframes) {
      var dx = player.x - p.x, dy = player.y - p.y;
      if (Math.hypot(dx, dy) < p.r + player.r) {
        p.tickTimer -= dt;
        if (p.tickTimer <= 0) {
          p.tickTimer = 0.5;
          applyStatus('poison', { stacks: 1, duration: 4, dmgPerTick: 1 });
        }
      }
    }
  }
}
function drawPoisonPuddles() {
  for (var i = 0; i < poisonPuddles.length; i++) {
    var p = poisonPuddles[i];
    var a = Math.min(1, p.timer / 2.0);
    ctx.save();
    ctx.globalAlpha = 0.35 * a;
    ctx.fillStyle = '#1D9E75';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 0.6 * a;
    ctx.strokeStyle = '#0B5C3B';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

// Thorn shards — small ground hazards from slinger orange shrapnel.
// Tiny, short-lived, 1 dmg on contact then consumed.
var thornShards = [];
function spawnThornShard(x, y) {
  thornShards.push({ x: x, y: y, r: 6, timer: 2.5 });
}
function updateThornShards(dt) {
  for (var i = thornShards.length - 1; i >= 0; i--) {
    var s = thornShards[i];
    s.timer -= dt;
    if (s.timer <= 0) { thornShards.splice(i, 1); continue; }
    if (player && !player.iframes) {
      var dx = player.x - s.x, dy = player.y - s.y;
      if (Math.hypot(dx, dy) < s.r + player.r) {
        _applyEnemyMeleeDamage({ type: 'thorn' }, 1, dx, dy, 0);
        thornShards.splice(i, 1);
      }
    }
  }
}
function drawThornShards() {
  for (var i = 0; i < thornShards.length; i++) {
    var s = thornShards[i];
    var a = Math.min(1, s.timer / 2.5);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#F57C00';
    ctx.strokeStyle = '#8A4500';
    ctx.lineWidth = 1.5;
    // 4-pointed star (thorn shape)
    ctx.beginPath();
    var pts = 4;
    for (var k = 0; k < pts * 2; k++) {
      var angK = (k / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
      var rK = (k % 2 === 0) ? s.r : s.r * 0.4;
      var px = s.x + Math.cos(angK) * rK;
      var py = s.y + Math.sin(angK) * rK;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}


function _applyEnemyMeleeDamage(g, dmg, dx, dy, dist) {
  if (!player || player.iframes) return;
  // PHASE B — weaken amplifies incoming damage (×1.5 while active).
  var dmgLeft = Math.ceil((dmg || 1) * playerDamageTakenMult());
  // Armor absorb first.
  if ((player.armor||0) > 0) {
    var absorbed = Math.min(player.armor, dmgLeft);
    player.armor -= absorbed;
    dmgLeft -= absorbed;
    if (_battleStats) _battleStats.armorAbsorbed += absorbed;
    showFloatingText(player.x, player.y - 55, absorbed + ' 🛡', '#AAAAAA', player);
  }
  if (dmgLeft > 0) {
    if (_battleStats) {
      _battleStats.damageTaken += dmgLeft;
      if ((player.hp - dmgLeft) < _battleStats.hpLow) _battleStats.hpLow = Math.max(0, player.hp - dmgLeft);
      if (dmgLeft > (_battleStats.biggestDamageTaken || 0)) _battleStats.biggestDamageTaken = dmgLeft;
    }
    showFloatingText(player.x, player.y - 40, dmgLeft + ' HP', '#E24B4A', player);
    applyDamageToPlayer(dmgLeft);
  }
  player.iframes = 0.9;
  // PHASE C — arsenal triggers on every successful enemy hit on player.
  applyArsenalOnTouch(g, dx, dy, dist);
  if (player.hp <= 0 && !player.bleedOut && typeof respawnPlayer === 'function') respawnPlayer();
}

// ═══════════════════════════════════════════════════
// LOOT DROP SYSTEM
// ═══════════════════════════════════════════════════
// When entities die, they roll their loot table and spawn physical pickups
// in the rumble area. Pickups pop out with a small arc, settle, then magnet-pull
// toward the player when close. Collection is automatic on contact.
//
// Kinds:
//   brick   — adds to player.bricks pool by color
//   cheese  — permanent +1 max HP and +1 current HP
//   gold    — adds amount to player.gold (surfaces to server on battleEnd)
var droppedBricks = [];
                               // Used by victory flow to skip grace period when no loot existed.
var LOOT_MAGNET_RANGE = 80;   // player must be this close before magnet kicks in
var LOOT_PICKUP_RADIUS = 24;  // actual contact radius for collection (generous)
var LOOT_VISUAL_R = 8;        // rendered size — kept small so drops don't dominate the scene

// Roll an entity's loot table. Each entry is independent.
// Returns an array of drop descriptors:
//   { kind: 'brick', color: 'red' }
//   { kind: 'cheese' }
//   { kind: 'gold', amount: 2 }
function rollLoot(entity) {
  if (!entity.loot) return [];
  var drops = [];
  // S013.3: revive loot penalty. Each heart-revive this run cuts drop chance
  // by 10% (multiplicative), floored at 10% of normal. reviveCount carries
  // across rumbles on player state; cheese-revives reset it to 0.
  // cfg.suppressLootPenalty (waves mode) bypasses this — the test tool
  // needs clean drop-rate observation, the live penalty is still in place.
  var reviveMult = 1.0;
  if (player && player.reviveCount > 0 && !(cfg && cfg.suppressLootPenalty)) {
    reviveMult = Math.max(0.1, 1.0 - 0.1 * player.reviveCount);
  }
  entity.loot.forEach(function(entry) {
    var effectiveChance = entry.chance * reviveMult;
    if (Math.random() >= effectiveChance) return;
    var kind = entry.kind || 'brick';
    if (kind === 'brick') {
      var n = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
      for (var i = 0; i < n; i++) {
        drops.push({ kind: 'brick', color: entry.color });
      }
    } else if (kind === 'cheese') {
      // Cheese is a single pickup per successful roll (rare permanent buff).
      drops.push({ kind: 'cheese' });
    } else if (kind === 'gold') {
      // One coin pickup per roll, carrying a random amount in [min, max].
      var amt = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
      drops.push({ kind: 'gold', amount: amt });
    }
  });
  return drops;
}

function spawnLootFromEntity(entity) {
  var drops = rollLoot(entity);
  // PHASE E — bone_rise: second death of a revived skeleton gives half loot.
  // Halve min/max on brick amounts and gold stacks. Cheese has no "half"
  // (it's a discrete 1-HP bonus) so we roll it at 50% chance of keeping.
  if (entity._boneRisen) {
    drops = drops.map(function(d) {
      if (d.kind === 'cheese') {
        return (Math.random() < 0.5) ? d : null;
      }
      if (d.kind === 'gold') {
        return { kind:'gold', amount: Math.max(1, Math.floor((d.amount||1) * 0.5)) };
      }
      if (d.color) {
        return { kind:'brick', color: d.color, amount: Math.max(1, Math.floor((d.amount||1) * 0.5)) };
      }
      return d;
    }).filter(Boolean);
  }
  drops.forEach(function(drop, i) {
    // Pop out in a spread pattern around the death position.
    var angle = (i / Math.max(1, drops.length)) * Math.PI * 2 + Math.random() * 0.3;
    var popSpeed = 80 + Math.random() * 60;
    droppedBricks.push({
      x: entity.x, y: entity.y,
      vx: Math.cos(angle) * popSpeed,
      vy: Math.sin(angle) * popSpeed - 40, // slight upward arc
      kind: drop.kind,
      color: drop.color,    // brick only
      amount: drop.amount,  // gold only
      r: LOOT_VISUAL_R,     // visual radius — draw size
      pickupR: LOOT_PICKUP_RADIUS,  // detection radius — collection contact
      age: 0,
      ttl: 30.0, // 30s before expiry
      state: 'popping',
      bobPhase: Math.random() * Math.PI * 2,
    });
  });
}

function updateDroppedBricks(dt) {
  if (!player) return;
  droppedBricks.forEach(function(p) {
    p.age += dt;
    if (p.age >= p.ttl) { p.done = true; return; }
    if (p.state === 'popping') {
      // Decelerate pop-out velocity, settle into idle after ~0.6s
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9; p.vy *= 0.9;
      p.vy += 80 * dt; // gravity pulls it back down
      if (p.age > 0.6) { p.state = 'idle'; p.vx = 0; p.vy = 0; }
    } else {
      // Check distance to player for magnet / collection.
      var ddx = player.x - p.x, ddy = player.y - p.y;
      var dist = Math.hypot(ddx, ddy);
      var contactR = (p.pickupR || p.r) + player.r;
      if (dist < contactR) {
        // Collect by kind. Each pickup type has its own effect.
        if (p.kind === 'cheese') {
          // v4: Cheese loot goes into player's cheese inventory (+1 per pickup).
          // Previously cheese gave permanent +1 max HP + +1 HP — replaced so cheese
          // is a tradeable consumable, eaten via the out-of-battle menu for +1 Max HP.
          //
          // EXCEPTION: cfg.cheeseAutoApply (waves mode test tool) restores the
          // old behavior — pickups apply immediately for visible feedback during
          // stress testing. Live game keeps the inventory model.
          if (cfg && cfg.cheeseAutoApply) {
            player.hpMax += 1;
            player.hp = Math.min(player.hpMax, player.hp + 1);
            if (_battleStats) {
              if (!_battleStats.bricksGained) _battleStats.bricksGained = {};
              _battleStats.bricksGained.cheese = (_battleStats.bricksGained.cheese || 0) + 1;
            }
            showFloatingText(player.x, player.y, '🧀 +1 HP MAX', '#FFD96A', player);
          } else {
            player.cheese = (player.cheese || 0) + 1;
            if (_battleStats) _battleStats.cheeseEaten++;
            if (!_battleStats.bricksGained) _battleStats.bricksGained = {};
            _battleStats.bricksGained.cheese = (_battleStats.bricksGained.cheese || 0) + 1;
            showFloatingText(player.x, player.y, '+1 🧀', '#FFD96A', player);
            // S013.3: occasional flavor line for cheese pickups — every 3rd to avoid spam
            if (player.cheese % 3 === 1) {
              // Spawn ABOVE the player (not parented) so it floats independently
              // and doesn't stack on top of the pickup number.
              showFloatingText(player.x, player.y - (player.r + 48), _pickCheeseEventFlavor(), '#FFD96A');
            }
          }
        } else if (p.kind === 'gold') {
          // Coins accumulate on player.gold; battleTick surfaces to server.
          var amt = p.amount || 1;
          player.gold = (player.gold || 0) + amt;
          if (_battleStats) _battleStats.goldGained += amt;
          showFloatingText(player.x, player.y - 40, '+' + amt + ' 🪙', '#F5D000', player);
        } else {
          // Brick — looted mid-rumble grows both inventory ceiling AND active
          // charges. S013.6: previously only spec mode grew the ceiling, which
          // meant non-spec loot vanished after the battle (ceiling unchanged →
          // server never saw the pickup). Now looted bricks persist AND are
          // immediately usable.
          //   bricks[c]   += 1  — charges (immediately usable)
          //   brickMax[c] += 1  — inventory ceiling (persists post-rumble)
          player.bricks[p.color] = (player.bricks[p.color] || 0) + 1;
          player.brickMax[p.color] = (player.brickMax[p.color] || 0) + 1;
          if (_battleStats) _addBrickStat(_battleStats.bricksGained, p.color, 1);
          showFloatingText(player.x, player.y - 40, '+1 ' + p.color.charAt(0).toUpperCase(),
            BRICK_COLORS[p.color] || '#fff', player);
        }
        p.done = true;
        return;
      }
      if (dist < scaleDist(LOOT_MAGNET_RANGE)) {
        // Magnet pull — accelerate toward player, snappy.
        var pullStrength = 240 + (1 - dist / scaleDist(LOOT_MAGNET_RANGE)) * 300;
        p.x += (ddx/dist) * pullStrength * dt;
        p.y += (ddy/dist) * pullStrength * dt;
      } else {
        // Idle bob — small vertical oscillation.
        p.bobPhase += dt * 3;
      }
    }
  });
  droppedBricks = droppedBricks.filter(function(p) { return !p.done; });
}

function drawDroppedBricks() {
  if (!ctx) return;
  droppedBricks.forEach(function(p) {
    ctx.save();
    // Fading alpha in the last 3s of life
    var life = Math.min(1, (p.ttl - p.age) / 3);
    var alpha = life < 1 ? Math.max(0.3, life) : 1;
    // Idle bob
    var bobY = p.state === 'idle' ? Math.sin(p.bobPhase) * 2 : 0;
    ctx.globalAlpha = alpha;

    if (p.kind === 'cheese') {
      // Render the 🧀 emoji so the on-ground cheese loot matches the cheese
      // icon used everywhere else (DM chips, player HUD, victory card).
      // Previously rendered as a yellow triangle with dark dots, which was
      // stylized but didn't read as cheese at a glance.
      var cz = p.r * 2.4; // slightly larger than a brick
      ctx.shadowColor = '#F5C800'; ctx.shadowBlur = 10;
      ctx.font = cz + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧀', p.x, p.y + bobY);
      ctx.shadowBlur = 0;
    } else if (p.kind === 'gold') {
      // Gold coin: round disc with rim + inner highlight.
      var rad = p.r;
      ctx.shadowColor = '#F5D000'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#F5D000';
      ctx.beginPath();
      ctx.arc(p.x, p.y + bobY, rad, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#A88B00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y + bobY, rad - 2, 0, Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(p.x - rad/3, p.y + bobY - rad/3, rad * 0.25, 0, Math.PI*2);
      ctx.fill();
    } else {
      // Brick (default): small colored square. The LEGO-style stud dot
      // used to sit on top but reads as a visual artifact at this size,
      // so it's been removed — the square + glow is enough to identify.
      var col = BRICK_COLORS[p.color] || '#888';
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillStyle = col;
      var sz = p.r * 1.4;
      ctx.fillRect(p.x - sz/2, p.y - sz/2 + bobY, sz, sz);
    }
    ctx.restore();
  });
}

// ═══════════════════════════════════════════════════
//  ENTITY REGISTRY — content library for all creature types
// ═══════════════════════════════════════════════════
// Every creature that can appear in the rumble is defined here. The game.js
// ENTITY_TYPES/ENTITY_META arrays must stay in sync with the keys below.
// Loot tables use shape: { kind?, color?, chance, min, max }
//   kind: 'brick' (default) | 'cheese' | 'gold'
//   color: required for 'brick', ignored for 'cheese'/'gold'
//   chance: 0-1, rolled independently per entry on entity death
//   min/max: for 'brick' = count; for 'gold' = amount-per-coin; 'cheese' always 1
// Each entity's `family` drives its resistance profile via _familyResist().
// AI behavior (`ai` field) drives the update-loop dispatcher:
//   chase        — run at player, touch to damage (default legacy behavior)
//   ranged_kite  — back away to kiteDistance, fire ranged projectiles
//   stationary   — doesn't move; periodic AoE pulse around itself
//   heavy_melee  — chase then telegraph a wind-up swing, AoE damage
//   teleport     — chase + periodic blink to near player
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
    ai: 'chase', attackPattern: 'telegraph_swing',
    swingTelegraph: 0.45, swingDmg: 4, swingRadius: 50,
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

// ═══════════════════════════════════════════════════
// ENTITY OBJECT
// ═══════════════════════════════════════════════════
// Resolve an entityType config value to an actual registry key. Pass-through
// for known type names; 'random' rolls a fresh type from the registry each
// call (used by sandbox respawn loop for variety). Unknown strings fall back
// to goblin so unrecognized configs don't crash the spawn.
function _resolveEntityType(t) {
  if (t === 'random') {
    var keys = Object.keys(ENTITY_REGISTRY);
    return keys[Math.floor(Math.random() * keys.length)];
  }
  if (t && ENTITY_REGISTRY[t]) return t;
  return 'goblin';
}

// PHASE E — mitosis_split: spawn smaller clones at parent's position.
// Shared between rot_grub (2-level recursion) and blight_worm (1 level).
// Max split depth is configured per-entity via template field splitMaxDepth
// (default 1). Clone stats:
//   hp    = parent.hp * 0.6   (at max)
//   speed = parent.speed * 0.8
//   r     = parent.r * 0.7
// Clones inherit affinityColors/reactions but with weaker arsenal.
// Clones do NOT drop gold/cheese on death (only parent's loot was full).
// Clones drop minimal bricks (5% green/black for grubs, 10% green for worm).
function _spawnSplitClones(parent) {
  if (!parent || !running) return;
  var currentDepth = parent._splitDepth || 0;
  var maxDepth = parent.splitMaxDepth || 1;
  if (currentDepth >= maxDepth) return;

  var bounds = getRumbleBounds();
  var cloneHpMax  = Math.max(2, Math.round((parent.hpMax || parent.hp || 20) * 0.6));
  var cloneSpeed  = (parent.speed || 120) * 0.8;
  var cloneR      = Math.max(8, Math.round(parent.r * 0.7));
  for (var ci = 0; ci < 2; ci++) {
    var ang = Math.random() * Math.PI * 2;
    var off = 14 + Math.random() * 10;
    var cx = parent.x + Math.cos(ang) * off;
    var cy = parent.y + Math.sin(ang) * off;
    cx = Math.max(bounds.x + cloneR, Math.min(bounds.x + bounds.w - cloneR, cx));
    cy = Math.max(bounds.y + cloneR, Math.min(bounds.y + bounds.h - cloneR, cy));
    // Build a minimal clone entity — copy fields from parent's current state
    // rather than going through makeEntity (we want positional control + trim loot).
    var clone = Object.assign({}, parent);
    clone.x = cx; clone.y = cy;
    clone.spawnX = cx; clone.spawnY = cy;
    clone.hp = cloneHpMax;
    clone.hpMax = cloneHpMax;
    clone.speed = cloneSpeed;
    clone.r = cloneR;
    clone.dead = false;
    clone.deathTimer = 0;
    // Reset runtime state (so reactions and AI aren't carried over)
    clone._reactionTimer = 0;
    clone._arsenalTimer = 0;
    clone._reactionState = null;
    clone._lastSeenCharge = null;
    clone._burrowState = null;
    clone._burrowTimer = 0;
    clone._burrowHidden = false;
    clone._phaseFadeTimer = 0;
    clone._enraged = false;
    clone._boneRisen = false;
    clone._splitDepth = currentDepth + 1;
    // Clones get reduced loot — small bricks only, no gold/cheese.
    if (parent.type === 'rot_grub') {
      clone.loot = [{ color: 'green', chance: 0.05, min: 1, max: 1 }];
    } else if (parent.type === 'blight_worm') {
      clone.loot = [
        { color: 'green', chance: 0.10, min: 1, max: 1 },
        { kind: 'gold',   chance: 0.50, min: 1, max: 2 },
      ];
    } else {
      clone.loot = [];
    }
    // Disable split-on-death if we've reached max depth
    if (clone._splitDepth >= maxDepth) {
      clone.signature = null;
    }
    // Clone resistances must be a fresh copy (not shared reference)
    clone.resistances = Object.assign({}, parent.resistances || {});
    // Also clone status object refs where applicable
    clone.affinityColors = (parent.affinityColors || []).slice();
    clone.reactions = Object.assign({}, parent.reactions || {});
    entities.push(clone);
  }
  // Telegraphy: "SPLIT!" floater at parent's death point
  showFloatingText(parent.x, parent.y - parent.r - 12, 'SPLIT!', '#2d5c2e', parent);
}

function makeEntity(bounds, angleOffset, entityType) {
  // Spawn on side opposite player, spread by angleOffset
  var px = player.x, py = player.y;
  var cx = bounds.x + bounds.w/2, cy = bounds.y + bounds.h/2;
  var baseAngle = Math.atan2(cy - py, cx - px) + Math.PI; // opposite side
  var angle = baseAngle + (angleOffset||0);
  var spawnR = Math.min(bounds.w, bounds.h) * 0.42;
  var gx = cx + Math.cos(angle) * spawnR;
  var gy = cy + Math.sin(angle) * spawnR;
  gx = Math.max(bounds.x+40, Math.min(bounds.x+bounds.w-40, gx));
  gy = Math.max(bounds.y+40, Math.min(bounds.y+bounds.h-40, gy));
  var scale = getDisplayScale();
  // Resolve type (handles 'random' rolls, unknown fallbacks).
  var resolvedType = _resolveEntityType(entityType);
  var tpl = ENTITY_REGISTRY[resolvedType];
  return {
    x: gx, y: gy,
    spawnX: gx, spawnY: gy,
    // Core stats from template — apply scale for display parity.
    r: Math.round(tpl.r * scale),
    speed: tpl.speed,
    hp: tpl.hp, hpMax: tpl.hpMax,
    // Type identity — for HP-reporting, log lines, and debugging.
    type: resolvedType,
    family: tpl.family,
    resistances: Object.assign({}, tpl.resistances || {}),
    // Visual identity (used by drawEntity)
    visColor: tpl.color,
    visIcon:  tpl.icon,
    // AI behavior fields
    ai: tpl.ai || 'chase',
    attackPattern: tpl.attackPattern || 'touch',
    // Ranged_kite fields
    kiteDistance: tpl.kiteDistance || 0,
    rangedCooldown: tpl.rangedCooldown || 0,
    rangedTimer: 0,
    rangedDmg: tpl.rangedDmg || 0,
    // Stationary pulse fields
    pulseCooldown: tpl.pulseCooldown || 0,
    pulseTimer: tpl.pulseCooldown ? (tpl.pulseCooldown * 0.5) : 0, // half-delay first pulse
    pulseRadius: tpl.pulseRadius || 0,
    pulseDmg: tpl.pulseDmg || 0,
    // Heavy_melee (telegraph swing) fields
    swingTelegraph: tpl.swingTelegraph || 0,
    swingDmg: tpl.swingDmg || 0,
    swingRadius: tpl.swingRadius || 0,
    swingState: 'idle',      // 'idle' | 'winding' | 'cooldown'
    swingTimer: 0,
    swingTargetX: 0, swingTargetY: 0,
    swingCooldown: 0,
    // Teleport fields
    teleportCooldown: tpl.teleportCooldown || 0,
    teleportTimer: tpl.teleportCooldown || 0,
    teleportRange: tpl.teleportRange || 0,
    // Loot table (copied by reference — templates aren't mutated at runtime)
    loot: tpl.loot,
    state: 'patrol',   // 'patrol' | 'chase' | 'bounce'
    AGGRO_RANGE: Math.round(200 * scale),
    DEAGGRO_RANGE: Math.round(320 * scale),
    aggroed: false,
    // Patrol wander
    wanderTarget: { x: gx, y: gy },
    wanderTimer: 0,
    // Bounce after attack
    bounceVx: 0, bounceVy: 0,
    bounceTimer: 0,
    // Attack cooldown (for touch-damage pattern)
    attackCooldown: 0,
    attackDebuff: 0,
    // Flash on hit
    flashTimer: 0,
    // Contact damage (touch pattern) — from template, default 1
    dmg: tpl.dmg || 1,
    // ── PHASE A ENTITY INTELLIGENCE FIELDS ─────────────────────────
    // Copied from template so per-entity mutations (cooldown drift)
    // don't leak back to the registry. All null/empty defaults so
    // existing entities without these fields behave exactly as before.
    affinityColors:   (tpl.affinityColors || []).slice(),
    signature:        tpl.signature || null,
    deathSignature:   tpl.deathSignature || null,
    splitMaxDepth:    tpl.splitMaxDepth || 1,
    _splitDepth:      0,
    reactions:        Object.assign({}, tpl.reactions || {}),
    reactionCooldown: tpl.reactionCooldown || 0,
    arsenalCooldown:  tpl.arsenalCooldown || 0,
    // Runtime counters (internal)
    _reactionTimer:     0,   // ticks down; when 0, entity can react again
    _arsenalTimer:      0,   // ticks down; when 0, arsenal can fire
    _reactionState:     null,// current active reaction: { kind, timer, ... }
    _lastSeenCharge:    null,// last overload color seen — detects edge (new charge)
  };
}


// Color-to-family mapping for resistance system.
// Physical = weapons/armor/traps. Ethereal = spells/bolts/blessings.
// Malady = stateful afflictions (poison, daze, curse).
var FAMILY_OF_COLOR = {
  red:    'physical', gray:   'physical', orange: 'physical',
  blue:   'ethereal', purple: 'ethereal', white:  'ethereal',
  yellow: 'malady',   green:  'malady',   black:  'malady',
};

// Build a resistance profile for an entity of the given family.
// Strict rock-paper-scissors cycle: physical > ethereal > malady > physical.
// - Same family → 1.0 (neutral)
// - Family this one BEATS → 0.5 (resistant — they hit me weakly)
// - Family that beats THIS one → 1.5 (vulnerable — they hit me hard)
// Used by ENTITY_REGISTRY templates so each enemy's family drives its
// full resistance profile without manual bookkeeping.
function _familyResist(family) {
  var cycle = { physical: 'ethereal', ethereal: 'malady', malady: 'physical' };
  var resistant = cycle[family];                  // this family RESISTS attacks from
  var vulnerable = Object.keys(cycle).find(function(k) { return cycle[k] === family; });
  var r = { physical: 1.0, ethereal: 1.0, malady: 1.0 };
  r[resistant] = 0.5;
  r[vulnerable] = 1.5;
  return r;
}

// Lookup resistance multiplier for (entity, source-color or family).
// Per-color overrides take priority over family default.
// Returns 1.0 for untyped sources (aggro damage, environmental).
function resistMult(g, source) {
  if (!source) return 1.0;
  var rs = g.resistances;
  if (!rs) return 1.0;
  // Per-color override (specific color, e.g. "red")
  if (rs[source] !== undefined) return rs[source];
  // Family default (e.g. 'physical')
  var fam = FAMILY_OF_COLOR[source];
  if (fam && rs[fam] !== undefined) return rs[fam];
  return 1.0;
}

// Translate raw resist multiplier to tier name.
// Tiers drive visual styling of damage floaters.
function resistTier(mult) {
  if (mult <= 0.01) return 'IMMUNE';
  if (mult <= 0.6)  return 'RESIST';
  if (mult <  1.3)  return 'NEUTRAL';
  if (mult <= 1.7)  return 'VULN';
  return 'WEAK';
}

function vScale(tier) { return tier <= 1 ? 1.5 : 0.5; }

// damageEntity(g, dmg, aggro, source)
//   g: entity
//   dmg: pre-resist incoming damage
//   aggro: pass false to prevent aggro trigger (environmental damage)
//   source: color string ('red', 'blue', ...) or family string ('physical'),
//           or null/undefined for untyped (bypasses resistance)
// Returns { applied, tier } so caller can render a floater matching result.
function damageEntity(g, dmg, aggro, source) {
  // PHASE D — phase_fade signature: wraith is fully invulnerable during
  // the brief post-teleport window. Damage is absorbed to zero with a
  // "PHASED" floater telling the player why their hit didn't land.
  if ((g._phaseFadeTimer || 0) > 0) {
    showFloatingText(g.x, g.y - (g.r + 16), 'PHASED', '#9060C0', g);
    return { applied: 0, tier: 'none' };
  }
  // PHASE E — front_shield signature (cursed knight): 50% damage reduction
  // when hit from within the 120° arc the knight is facing. Knight's
  // "facing" is the direction from knight → player (tracked continuously).
  // For player-origin hits, the incoming angle is from knight → player.
  // Shield absorbs frontal, ignores side/back.
  var _shieldBlockedPct = 0;
  if (g.signature === 'front_shield' && player) {
    // Knight's current facing vector (always points at player)
    var fx = player.x - g.x, fy = player.y - g.y;
    var fd = Math.hypot(fx, fy) || 1;
    // Assume damage comes from player's direction (true for melee, overloads
    // targeted at entity, and projectiles player fires). Incoming vector
    // points FROM player TO knight (opposite of facing).
    // If the knight is facing the player, any frontal hit is at angle 0
    // from the facing vector. 120° arc = ±60° tolerance.
    // cos(60°) = 0.5 — so if dot(incoming, facing) > 0.5 → inside arc.
    // Incoming is -facing direction, so dot is -1 (fully behind facing).
    // We want: is player WITHIN knight's front cone. Yes by construction,
    // so always true for player-origin hits. The meaningful test is:
    // was the knight actively facing when the hit landed? During a swing
    // wind-up the knight is locked facing swingTargetX/Y — hits from the
    // side should bypass the shield. That's the real skill-check.
    var ffx, ffy;
    if (g.swingState === 'winding' || g.swingState === 'cooldown') {
      ffx = g.swingTargetX - g.x;
      ffy = g.swingTargetY - g.y;
    } else {
      ffx = fx; ffy = fy;
    }
    var ffd = Math.hypot(ffx, ffy) || 1;
    var toPlayerX = fx / fd, toPlayerY = fy / fd;
    var facingX = ffx / ffd, facingY = ffy / ffd;
    var dotFacing = facingX * toPlayerX + facingY * toPlayerY;
    // dot > 0.5 ≡ within 60° of facing direction ≡ player in front arc
    if (dotFacing > 0.5) {
      _shieldBlockedPct = 0.5;
    }
  }
  // BLUE MARK: target takes +50% damage from all sources while marked.
  var finalDmg = dmg;
  if ((g.markedTimer || 0) > 0) {
    finalDmg = Math.ceil(dmg * 1.5);
  }
  // PHASE E — true_burrow recover window: worm takes 1.5× damage while
  // stunned post-emerge. Rewards catching the emerge timing.
  if (g._recoverVulnerable) {
    finalDmg = Math.ceil(finalDmg * 1.5);
    showFloatingText(g.x, g.y - (g.r + 44), 'CRIT WINDOW', '#ffee55', g);
  }
  // YELLOW DAZE: confused entities take 2x damage from all sources.
  if (g.dazed && (g.confuseTimer || 0) > 0) {
    finalDmg = Math.ceil(finalDmg * 2.0);
  }
  // WITHER: damage from non-witherbolt sources is amplified by diminishing
  // returns curve based on current stacks. Witherbolt itself is excluded.
  // The witherBoost return field lets callers size the damage number up when
  // the hit was amplified (visual payoff for stacking wither).
  var _witherBoost = 0;
  if (!_witherboltDamage && (g.witherStacks || 0) > 0) {
    var ampBefore = finalDmg;
    finalDmg = Math.ceil(finalDmg * witherOtherAmp(g.witherStacks));
    if (finalDmg > ampBefore) _witherBoost = g.witherStacks;
  }
  // FAMILY RESISTANCE: apply the entity's resistance to this damage source.
  var rMult = resistMult(g, source);
  finalDmg = Math.ceil(finalDmg * rMult);
  // PHASE C — Arsenal-side damage reduction (troll passive 30%, gray pips 50%).
  // Called AFTER family resist so it's a last-line reduction. Shows floater
  // so player knows the hit was mitigated.
  var armorMult = entityIncomingDmgMult(g);
  if (armorMult < 1 && finalDmg > 0) {
    var pre = finalDmg;
    finalDmg = Math.ceil(finalDmg * armorMult);
    var reduction = pre - finalDmg;
    if (reduction > 0) {
      var pct = Math.round((1 - armorMult) * 100);
      showFloatingText(g.x, g.y - (g.r + 22), '−' + pct + '%', '#AAAAAA', g);
    }
  }
  // PHASE E — front_shield: 50% reduction for frontal hits on cursed knight.
  // Applied AFTER resist and arsenal DR so it's the final layer. Shows a
  // shield flash floater so player can see the block.
  if (_shieldBlockedPct > 0 && finalDmg > 0) {
    var preShield = finalDmg;
    finalDmg = Math.ceil(finalDmg * (1 - _shieldBlockedPct));
    if (preShield > finalDmg) {
      showFloatingText(g.x, g.y - (g.r + 32), '🛡 BLOCK', '#BBBBFF', g);
    }
  }
  // Clamp to min 0 (for immune/zero-damage cases)
  finalDmg = Math.max(0, finalDmg);

  g.hp = Math.max(0, g.hp - finalDmg);
  // PHASE E — enrage_phase signature (stone colossus). At 50% HP, trigger
  // a 1s roar freeze, then permanently boost speed/telegraph and enable
  // purple vampirism on future hits. Only fires once per life via _enraged.
  if (g.signature === 'enrage_phase' && !g._enraged && g.hp > 0
      && g.hp <= Math.floor(g.hpMax * 0.5)) {
    g._enraged = true;
    g._enrageRoarTimer = 1.0;          // frozen/invulnerable during roar
    g._enrageRegenTimer = 3.0;         // +1 HP/sec for 3s post-roar
    showFloatingText(g.x, g.y - (g.r + 20), 'ENRAGED', '#ff3300', g);
    // Apply the combat buffs immediately
    g.speed = 140;
    g.swingTelegraph = 0.40;
  }
  // PHASE E — bone_rise signature. Skeleton killed by a hit dealing ≤10
  // damage doesn't die on the first kill — it collapses and reassembles
  // at 40% HP. Big hits (overloads, crits) bypass this by doing >10 dmg.
  // Only happens once per skeleton (_boneRisen gates). Flag is consumed
  // by the entity's own update loop to trigger the revive timer.
  if (g.hp <= 0
      && g.signature === 'bone_rise'
      && !g._boneRisen
      && finalDmg > 0 && finalDmg <= 10) {
    g._boneRiseQueued = true;
  }
  if (_battleStats) {
    _battleStats.damageDealt += finalDmg;
    if (finalDmg > (_battleStats.biggestDamageDealt || 0)) {
      _battleStats.biggestDamageDealt = finalDmg;
    }
    // Mark this moment as "actively dealing damage" — used by the
    // active-combat accumulator to compute time-on-target DPS.
    if (finalDmg > 0) _battleStats._lastDamageAt = performance.now();
    // Damage-by-color (which kit colors carry your output) and
    // damage-by-target (which enemy types absorb your damage).
    // Both are critical for tuning analysis on the run summary.
    if (finalDmg > 0) {
      if (!_battleStats.damageByColor) _battleStats.damageByColor = {};
      var srcKey = source || 'untyped';
      _battleStats.damageByColor[srcKey] = (_battleStats.damageByColor[srcKey] || 0) + finalDmg;
      if (!_battleStats.damageByTarget) _battleStats.damageByTarget = {};
      var tgtKey = g.type || 'unknown';
      _battleStats.damageByTarget[tgtKey] = (_battleStats.damageByTarget[tgtKey] || 0) + finalDmg;
    }
  }
  if (aggro !== false) {
    g.aggroed = true;
    g.state = 'chase';
  }
  return { applied: finalDmg, tier: resistTier(rMult), source: source, witherBoost: _witherBoost };
}

// ═══════════════════════════════════════════════════
// PHASE A — REACTION VOCABULARY
// ═══════════════════════════════════════════════════
// Each reaction sets up a transient state on the entity that updateEntity
// consults during its normal update. The reaction persists for its own
// `timer` duration, then clears. Reactions modify MOVEMENT and TIMING but
// never directly damage — they exist to make enemies FEEL responsive.
//
// Tell the player visually: when a reaction starts we emit a floating
// icon above the entity. Cheap but readable.

function _entityFaceDir(g) {
  // unit vector from entity to player, or 0,0 if player gone
  if (!player) return { x: 0, y: 0 };
  var dx = player.x - g.x, dy = player.y - g.y;
  var d = Math.hypot(dx, dy) || 1;
  return { x: dx/d, y: dy/d };
}

function _reactClose(g, speedMult, duration) {
  // Sprint at player at speedMult × normal speed for duration seconds.
  g._reactionState = { kind:'close', speedMult: speedMult, timer: duration };
}

function _reactBackstep(g, speedMult, duration) {
  // Move AWAY from player at speedMult × normal speed for duration seconds.
  g._reactionState = { kind:'backstep', speedMult: speedMult, timer: duration };
}

function _reactEvade(g, speedMult, duration) {
  // Strafe perpendicular to player line. Pick left-or-right once and commit.
  var sign = Math.random() < 0.5 ? -1 : 1;
  g._reactionState = { kind:'evade', speedMult: speedMult, timer: duration, sign: sign };
}

function _reactInterruptSwing(g) {
  // Cancel any telegraph in progress; perform a fast 1-dmg jab.
  // If entity has swingState machine, reset it. Spawn a short peck animation.
  if (g.swingState && g.swingState !== 'idle') {
    g.swingState = 'idle';
    g.swingTimer = 0;
  }
  g._reactionState = { kind:'peck', timer: 0.35, damage: 1, _fired: false };
}

function _reactPeck(g) {
  // Light 1-dmg quick jab. Same as interrupt_swing but without swing cancel.
  g._reactionState = { kind:'peck', timer: 0.35, damage: 1, _fired: false };
}

function _reactShieldUp(g) {
  // For front_shield entities, refresh the shield. For others, pass-through.
  g._shieldUpTimer = 1.5;
  g._reactionState = { kind:'shield', timer: 0.3 };
}

function _reactTeleportAway(g, bounds) {
  // Blink to a point on the opposite side of the arena from the player.
  // Only call for entities that support teleport (void_wraith).
  if (!player || !bounds) return;
  var cx = bounds.x + bounds.w/2, cy = bounds.y + bounds.h/2;
  var dx = cx - player.x, dy = cy - player.y;
  var dist = Math.hypot(dx, dy) || 1;
  var tx = cx + (dx/dist) * (Math.min(bounds.w, bounds.h) * 0.35);
  var ty = cy + (dy/dist) * (Math.min(bounds.w, bounds.h) * 0.35);
  tx = Math.max(bounds.x + 40, Math.min(bounds.x + bounds.w - 40, tx));
  ty = Math.max(bounds.y + 40, Math.min(bounds.y + bounds.h - 40, ty));
  // Instant telegraph-less move for Phase A. Phase-fade signature comes later.
  g.x = tx; g.y = ty;
  g._reactionState = { kind:'teleport', timer: 0.4 };
}

function _reactBurrow(g) {
  // Reserved for blight_worm. For Phase A just flag; the true_burrow signature
  // in Phase E will do the real cycle management. Here we just set a flag
  // the worm's update logic reads.
  g._reactionState = { kind:'burrow', timer: 0.5 };
  g._wantsBurrow = true;
}

// Dispatcher — called once per entity per frame BEFORE any other AI logic.
// Detects the "edge" of a new player overload charge and triggers the
// reaction for that color, if any. Reactions are one-shot per overload.
function runEntityReactions(g, dt, bounds) {
  // Tick timers
  if (g._reactionTimer > 0) g._reactionTimer = Math.max(0, g._reactionTimer - dt);
  if (g._arsenalTimer  > 0) g._arsenalTimer  = Math.max(0, g._arsenalTimer  - dt);
  if (g._reactionState) {
    g._reactionState.timer -= dt;
    if (g._reactionState.timer <= 0) g._reactionState = null;
  }

  if (!player) return;

  // Detect edge: player just STARTED a new overload
  var currentCharge = (player.overloadCharging && player.overloadColor) ? player.overloadColor : null;
  var edge = currentCharge && currentCharge !== g._lastSeenCharge;
  g._lastSeenCharge = currentCharge;

  if (!edge) return;
  if (g._reactionTimer > 0) return; // on cooldown, no new reaction

  // Pick reaction for this color from the entity's policy
  var rxnKind = g.reactions && g.reactions[currentCharge];
  if (!rxnKind) return;

  // Run the reaction
  switch (rxnKind) {
    case 'close_fast':       _reactClose(g, 1.5, 1.5);     break;
    case 'backstep':         _reactBackstep(g, 1.2, 1.0);  break;
    case 'evade':            _reactEvade(g, 1.0, 1.0);     break;
    case 'interrupt_swing':  _reactInterruptSwing(g);      break;
    case 'peck_attack':      _reactPeck(g);                break;
    case 'shield_up':        _reactShieldUp(g);            break;
    case 'teleport_away':    _reactTeleportAway(g, bounds); break;
    case 'burrow':           _reactBurrow(g);              break;
    default: return;
  }

  // Put reaction on cooldown; show a small tell above the entity.
  g._reactionTimer = g.reactionCooldown || 5;
  showFloatingText(g.x, g.y - (g.r + 14), '!', '#F5D000', g);
}

// Apply the active reaction state as a velocity override / damage jab.
// Returns true if the reaction commandeered movement this frame (so the
// default AI should skip its own movement logic).
function applyReactionMovement(g, dt, bounds) {
  var rs = g._reactionState;
  if (!rs) return false;

  if (rs.kind === 'close') {
    var dir = _entityFaceDir(g);
    var spd = (g.speed || 120) * rs.speedMult;
    g.x += dir.x * spd * dt;
    g.y += dir.y * spd * dt;
    return true;
  }
  if (rs.kind === 'backstep') {
    var dir2 = _entityFaceDir(g);
    var spd2 = (g.speed || 120) * rs.speedMult;
    g.x -= dir2.x * spd2 * dt;
    g.y -= dir2.y * spd2 * dt;
    return true;
  }
  if (rs.kind === 'evade') {
    // Perpendicular to face direction.
    var dir3 = _entityFaceDir(g);
    var perpX = -dir3.y * rs.sign;
    var perpY =  dir3.x * rs.sign;
    var spd3 = (g.speed || 120) * rs.speedMult;
    g.x += perpX * spd3 * dt;
    g.y += perpY * spd3 * dt;
    return true;
  }
  if (rs.kind === 'peck' && !rs._fired) {
    // Fire once when timer is between 0.1-0.2 remaining (mid-windup).
    var windDone = rs.timer <= 0.15;
    if (windDone && typeof _applyEnemyMeleeDamage === 'function') {
      var dx = player.x - g.x, dy = player.y - g.y;
      var dist = Math.hypot(dx, dy);
      // Peck has short reach — only lands if close enough.
      if (dist < g.r + player.r + 20) {
        _applyEnemyMeleeDamage(g, rs.damage || 1, dx, dy, dist);
      }
      rs._fired = true;
    }
    // Peck does not move the entity itself
    return false;
  }
  // teleport / shield / burrow: no per-frame movement
  return false;
}


function updateEntity(g, dt, bounds) {
  if (!player) return;

  // PHASE A — reaction dispatcher runs FIRST so reactions can override AI.
  // Detects edges (new overload charges), picks from g.reactions policy,
  // and sets g._reactionState. applyReactionMovement (called later where
  // each AI branch runs) will consume that state.
  runEntityReactions(g, dt, bounds);
  // PHASE C — tick per-frame arsenals (gray armor refresh, white regen,
  // malady poison trails).
  tickPassiveArsenal(g, dt);

  g.attackCooldown = Math.max(0, g.attackCooldown - dt);
  // Post-darkness attack debuff
  if (g.attackDebuff > 0) {
    g.attackDebuff = Math.max(0, g.attackDebuff - dt);
  }
  g.flashTimer     = Math.max(0, g.flashTimer - dt);
  // PHASE D — phase_fade invulnerability window
  if ((g._phaseFadeTimer || 0) > 0) g._phaseFadeTimer = Math.max(0, g._phaseFadeTimer - dt);
  // PHASE E — enrage_phase roar (frozen + invulnerable) and regen window.
  if ((g._enrageRoarTimer || 0) > 0) {
    g._enrageRoarTimer = Math.max(0, g._enrageRoarTimer - dt);
    // Freeze by reusing phase_fade invuln (already prevents damage) + no-move
    g._phaseFadeTimer = Math.max(g._phaseFadeTimer || 0, 0.05);
    // Visible roar pulse
    if (Math.random() < 0.4) {
      showFloatingText(g.x, g.y - g.r - 6, '🔥', '#ff6600', g);
    }
    return; // skip all AI this frame
  }
  if ((g._enrageRegenTimer || 0) > 0) {
    g._enrageRegenTimer = Math.max(0, g._enrageRegenTimer - dt);
    g._enrageRegenAccum = (g._enrageRegenAccum || 0) + dt;
    if (g._enrageRegenAccum >= 1.0 && g.hp < g.hpMax) {
      g._enrageRegenAccum -= 1.0;
      g.hp = Math.min(g.hpMax, g.hp + 1);
      showFloatingText(g.x, g.y - (g.r + 10), '+1', '#ff9933', g);
    }
  }

  // White field soft-slow decays every frame; refreshed from updateWhiteField
  // while entity is inside the healing zone. Slows movement to ~50% when active.
  if ((g.whiteFieldSlowTimer || 0) > 0) {
    g.whiteFieldSlowTimer = Math.max(0, g.whiteFieldSlowTimer - dt);
    if (g.whiteFieldSlowTimer <= 0) g.whiteFieldSlowed = false;
  }
  // BLUE MARK: decay marked timer; +50% damage amp fades when it hits 0.
  if ((g.markedTimer || 0) > 0) {
    g.markedTimer = Math.max(0, g.markedTimer - dt);
  }
  // PURPLE SILENCE: decay silenced timer; entity can't attack while > 0.
  if ((g.silencedTimer || 0) > 0) {
    g.silencedTimer = Math.max(0, g.silencedTimer - dt);
  }
  // WITHER: decay shared timer. When it expires, all stacks drop.
  decayWither(g, dt);
  // GREEN FIELD SLOW: decay every frame; refreshed while inside green burst.
  if ((g.greenSlowTimer || 0) > 0) {
    g.greenSlowTimer = Math.max(0, g.greenSlowTimer - dt);
    if (g.greenSlowTimer <= 0) g.greenSlowed = false;
  }
  var whiteFieldMult = g.whiteFieldSlowed ? 0.5 : 1;
  // GREEN slow: entities inside a green burst or slow-aura afterimage move
  // at 25% of their normal speed (a -75% move-rate debuff). Stacks
  // multiplicatively with white-field slow.
  var greenSlowMult  = g.greenSlowed ? 0.75 : 1;
  var zoneSlowMult   = whiteFieldMult * greenSlowMult; // stacks multiplicatively

  var dx = player.x - g.x;
  var dy = player.y - g.y;
  var distToPlayer = Math.sqrt(dx*dx + dy*dy);

  // ── State transitions ──
  if (g.state !== 'bounce') {
    if (!g.aggroed && distToPlayer < g.AGGRO_RANGE) {
      g.aggroed = true;
    } else if (g.aggroed && distToPlayer > g.DEAGGRO_RANGE) {
      g.aggroed = false;
    }
    g.state = g.aggroed ? 'chase' : 'patrol';
  }

  if (g.state === 'bounce') {
    // Bounce back from attack
    g.x += g.bounceVx * dt;
    g.y += g.bounceVy * dt;
    g.bounceVx *= 0.82;
    g.bounceVy *= 0.82;
    g.bounceTimer -= dt;
    if (g.bounceTimer <= 0) {
      g.state = g.aggroed ? 'chase' : 'patrol';
    }
    // Clamp
    g.x = Math.max(bounds.x + g.r, Math.min(bounds.x + bounds.w - g.r, g.x));
    g.y = Math.max(bounds.y + g.r, Math.min(bounds.y + bounds.h - g.r, g.y));
    return;
  }

  if (g.state === 'patrol') {
    // Wander near spawn
    g.wanderTimer -= dt;
    var wdx = g.wanderTarget.x - g.x;
    var wdy = g.wanderTarget.y - g.y;
    var wdist = Math.sqrt(wdx*wdx + wdy*wdy);
    if (wdist < 10 || g.wanderTimer <= 0) {
      // Pick new wander target near spawn
      var spread = 180;
      g.wanderTarget = {
        x: Math.max(bounds.x + g.r, Math.min(bounds.x + bounds.w - g.r, g.spawnX + (Math.random()-0.5)*spread*2)),
        y: Math.max(bounds.y + g.r, Math.min(bounds.y + bounds.h - g.r, g.spawnY + (Math.random()-0.5)*spread*2))
      };
      g.wanderTimer = 1.5 + Math.random() * 2;
    }
    var slowMult = g.slowed ? 0.1 : 1;
    var patrolSpeed = g.speed * 0.35 * slowMult * zoneSlowMult;
    if (wdist > 4) {
      g.x += (wdx/wdist) * patrolSpeed * dt;
      g.y += (wdy/wdist) * patrolSpeed * dt;
    }
  }

  if (g.state === 'chase') {
    if (g.confused && g.confuseDirX !== undefined) {
      // Move randomly when confused — overrides all AI patterns.
      var confusedSpeed = g.speed * 0.5 * (g.slowed ? 0.1 : 1) * zoneSlowMult;
      g.x += g.confuseDirX * confusedSpeed * dt;
      g.y += g.confuseDirY * confusedSpeed * dt;
    } else {
      // PHASE A — if an active reaction is commandeering movement this
      // frame, let it do its thing and skip the default AI locomotion.
      // Reactions still allow attack cooldowns / arsenal timers to tick.
      if (applyReactionMovement(g, dt, bounds)) {
        // Reaction moved the entity. Don't run chase/kite/etc this frame,
        // but still clamp position inside rumble bounds so sprint doesn't
        // push the entity off-screen.
        g.x = Math.max(bounds.x + g.r, Math.min(bounds.x + bounds.w - g.r, g.x));
        g.y = Math.max(bounds.y + g.r, Math.min(bounds.y + bounds.h - g.r, g.y));
        return;
      }

      // ═══════════════════════════════════════════════
      // AI DISPATCHER — branch on entity's template-declared behavior
      // ═══════════════════════════════════════════════
      var aiType = g.ai || 'chase';
      var effSpeed = (g.slowed ? g.speed * 0.1 : g.speed) * zoneSlowMult;

      // PHASE E — true_burrow signature (blight_worm). Custom 4-phase cycle
      // that supersedes the template ai/attackPattern. Phases:
      //   chase   (~6s): normal chase + poison trail (trail via tickPassiveArsenal)
      //   dive    (1s telegraph): dirt cloud, then become hidden
      //   hidden  (3s): invisible + invulnerable, tracks player position
      //   emerge  (0.8s telegraph): shadow circle beneath player
      //   erupt   (instant): 8 dmg AoE, arsenal effects (confuse/weaken/heart)
      //   recover (1s): surfaces stunned, takes 1.5× damage
      if (g.signature === 'true_burrow') {
        if (!g._burrowState) { g._burrowState = 'chase'; g._burrowTimer = 6.0; }
        g._burrowTimer = Math.max(0, (g._burrowTimer || 0) - dt);

        if (g._burrowState === 'chase') {
          if (distToPlayer > 2) {
            g.x += (dx/distToPlayer) * effSpeed * dt;
            g.y += (dy/distToPlayer) * effSpeed * dt;
          }
          if (g._burrowTimer <= 0) {
            g._burrowState = 'dive';
            g._burrowTimer = 1.0;
          }
        } else if (g._burrowState === 'dive') {
          // Telegraph: dirt swirl. Entity slows to stop.
          if (g._burrowTimer <= 0) {
            g._burrowState = 'hidden';
            g._burrowTimer = 3.0;
            g._phaseFadeTimer = 3.0 + 0.8;   // invuln through hidden + emerge
            g._burrowHidden = true;
          }
        } else if (g._burrowState === 'hidden') {
          // Invisible; track player so emerge point is current.
          g._burrowEmergeX = player.x;
          g._burrowEmergeY = player.y;
          if (g._burrowTimer <= 0) {
            g._burrowState = 'emerge';
            g._burrowTimer = 0.8;
          }
        } else if (g._burrowState === 'emerge') {
          // Shadow on ground at emerge point. Worm stays hidden until resolve.
          if (g._burrowTimer <= 0) {
            // Resolve: snap to emerge position, damage in AoE, apply arsenals.
            g.x = g._burrowEmergeX;
            g.y = g._burrowEmergeY;
            g._burrowHidden = false;
            var eruptR = 70;
            var edx = player.x - g.x, edy = player.y - g.y;
            var ed = Math.hypot(edx, edy);
            if (ed < eruptR + player.r && !player.iframes) {
              _applyEnemyMeleeDamage(g, 8, edx, edy, ed);
              // PHASE E — worm erupt arsenal:
              // yellow = confuse, purple = vampire heal, black = weaken
              if (g.affinityColors) {
                if (g.affinityColors.indexOf('yellow') >= 0) {
                  applyStatus('confuse', { duration: 1.5 });
                  showFloatingText(player.x, player.y - 60, 'CONFUSED', '#E08CF0', player);
                }
                if (g.affinityColors.indexOf('purple') >= 0) {
                  g.hp = Math.min(g.hpMax, g.hp + 4);
                  spawnHeartFloat(player.x, player.y, g.x, g.y);
                }
                if (g.affinityColors.indexOf('black') >= 0) {
                  applyStatus('weaken', { duration: 5 });
                  showFloatingText(player.x, player.y - 76, 'WEAKENED', '#553366', player);
                }
              }
            }
            // Ring shockwave visual (reuse spawnEnemyPulseFX)
            spawnEnemyPulseFX(g, eruptR);
            g._burrowState = 'recover';
            g._burrowTimer = 1.0;
            g._recoverVulnerable = true;   // consumed by damageEntity crit-window
            g._phaseFadeTimer = 0;          // become vulnerable again
          }
        } else { // recover
          // Stunned — takes 1.5× damage. No move, no attack.
          if (g._burrowTimer <= 0) {
            g._burrowState = 'chase';
            g._burrowTimer = 5.5 + Math.random() * 1.5;
            g._recoverVulnerable = false;
          }
        }
      } else if (aiType === 'ranged_kite') {
        // Keep kiteDistance from player; fire projectiles on cooldown.
        var kite = scaleDist(g.kiteDistance || 260);
        if (distToPlayer < kite * 0.9) {
          // Too close — back away
          g.x -= (dx/distToPlayer) * effSpeed * dt;
          g.y -= (dy/distToPlayer) * effSpeed * dt;
        } else if (distToPlayer > kite * 1.1) {
          // Too far — close in slowly
          g.x += (dx/distToPlayer) * effSpeed * 0.5 * dt;
          g.y += (dy/distToPlayer) * effSpeed * 0.5 * dt;
        }
        // Fire ranged projectile on cooldown (suppressed while silenced).
        g.rangedTimer = Math.max(0, g.rangedTimer - dt);
        // PHASE D — burst_fire signature overrides the single-shot rhythm.
        // Instead of one shot every 1.5s, the slinger fires 3 shots in
        // rapid succession (0.15s apart) every 2.5s.
        var _isBurst = (g.signature === 'burst_fire');
        if (_isBurst) {
          // Burst state machine on the entity:
          //   _burstRemaining: shots left to fire in current burst (0-3)
          //   _burstNextShotIn: time until next shot within a burst
          //   rangedTimer acts as "time until NEXT burst" when _burstRemaining=0
          if ((g._burstRemaining || 0) > 0 && (g.silencedTimer||0) <= 0) {
            g._burstNextShotIn = (g._burstNextShotIn || 0) - dt;
            if (g._burstNextShotIn <= 0) {
              _fireSlingerShot(g);
              g._burstRemaining -= 1;
              g._burstNextShotIn = 0.15;
              if (g._burstRemaining <= 0) {
                g.rangedTimer = 2.5;   // cooldown to next burst
              }
            }
          } else if (g.rangedTimer <= 0 && (g.silencedTimer||0) <= 0) {
            // Start a new burst.
            g._burstRemaining = 3;
            g._burstNextShotIn = 0;
          }
        } else {
          // Legacy single-shot rhythm.
          if (g.rangedTimer <= 0 && (g.silencedTimer||0) <= 0) {
            _fireSlingerShot(g);
            g.rangedTimer = g.rangedCooldown || 1.5;
          }
        }
      } else if (aiType === 'stationary') {
        // Doesn't move. Periodic AoE pulse centered on self.
        g.pulseTimer = Math.max(0, g.pulseTimer - dt);
        if (g.pulseTimer <= 0 && (g.silencedTimer||0) <= 0) {
          var pulseR = scaleDist(g.pulseRadius || 90);
          spawnEnemyPulseFX(g, pulseR);
          // PHASE C — arsenal per pulse. Track pulse count so every Nth can
          // be a confuse variant (yellow affinity). Applied only if player
          // is inside the pulse radius.
          g._pulseCount = (g._pulseCount || 0) + 1;
          if (distToPlayer < pulseR) {
            _applyEnemyMeleeDamage(g, g.pulseDmg || 2, dx, dy, distToPlayer);
            // GREEN arsenal: poison DoT (4 dmg over 4s — stronger than grunt poison)
            if (g.affinityColors && g.affinityColors.indexOf('green') >= 0) {
              applyStatus('poison', { stacks: 1, duration: 4, dmgPerTick: 1 });
            }
            // YELLOW arsenal: every 3rd pulse applies confuse (1.5s)
            if (g.affinityColors && g.affinityColors.indexOf('yellow') >= 0
                && g._pulseCount % 3 === 0) {
              applyStatus('confuse', { duration: 1.5 });
              showFloatingText(player.x, player.y - 60, 'CONFUSED', '#E08CF0', player);
            }
            // root_pulse signature: 0.7s slow on pulse hit (vines only for now)
            if (g.signature === 'root_pulse') {
              applyStatus('slow', { factor: 0.6, duration: 0.7 });
            }
          }
          g.pulseTimer = g.pulseCooldown || 2.0;
        }
      } else if (aiType === 'heavy_melee') {
        // Close to swing range, then telegraph a wind-up swing.
        var swingR = scaleDist(g.swingRadius || 60);
        // PHASE E — boulder_toss signature (stone troll). When player is
        // beyond 120px AND troll is idle (not mid-swing/cooldown), lob a
        // boulder instead of closing. Alternates naturally with swings
        // because the boulder tosses use their own cooldown.
        if (g.signature === 'boulder_toss'
            && g.swingState === 'idle'
            && distToPlayer > 120
            && (g._boulderCd || 0) <= 0
            && (g.silencedTimer || 0) <= 0) {
          spawnBoulder(g, player.x, player.y);
          g._boulderCd = 3.5;
        }
        if ((g._boulderCd || 0) > 0) g._boulderCd -= dt;

        if (g.swingState === 'idle') {
          // Chase in until we're in swing range
          if (distToPlayer > swingR * 0.7) {
            g.x += (dx/distToPlayer) * effSpeed * dt;
            g.y += (dy/distToPlayer) * effSpeed * dt;
          } else if ((g.silencedTimer||0) <= 0 && g.swingCooldown <= 0) {
            // Begin telegraph at player's current position.
            g.swingState = 'winding';
            g.swingTimer = g.swingTelegraph || 0.6;
            g.swingTargetX = player.x;
            g.swingTargetY = player.y;
          }
          g.swingCooldown = Math.max(0, g.swingCooldown - dt);
        } else if (g.swingState === 'winding') {
          // Telegraph: stand still, tick timer; on zero, resolve swing.
          g.swingTimer -= dt;
          if (g.swingTimer <= 0) {
            // Resolve swing — damage if player is in radius at landing.
            var sdx = player.x - g.swingTargetX;
            var sdy = player.y - g.swingTargetY;
            var sd = Math.sqrt(sdx*sdx + sdy*sdy);
            if (sd < swingR + player.r) {
              _applyEnemyMeleeDamage(g, g.swingDmg || 6, dx, dy, distToPlayer);
            }
            g.swingState = 'cooldown';
            g.swingCooldown = 1.2;
          }
        } else if (g.swingState === 'cooldown') {
          // Resting; don't move.
          g.swingCooldown -= dt;
          if (g.swingCooldown <= 0) g.swingState = 'idle';
        }
      } else if (aiType === 'teleport') {
        // Chase normally, but periodically blink to near player.
        if (distToPlayer > 2) {
          g.x += (dx/distToPlayer) * effSpeed * dt;
          g.y += (dy/distToPlayer) * effSpeed * dt;
        }
        g.teleportTimer = Math.max(0, g.teleportTimer - dt);
        if (g.teleportTimer <= 0 && (g.silencedTimer||0) <= 0) {
          // Blink to a spot within teleportRange of player (but not ON them).
          var tpR = scaleDist(g.teleportRange || 80);
          var blinkAngle = Math.random() * Math.PI * 2;
          var blinkDist = tpR * (0.6 + Math.random() * 0.4);
          g.x = player.x + Math.cos(blinkAngle) * blinkDist;
          g.y = player.y + Math.sin(blinkAngle) * blinkDist;
          g.teleportTimer = g.teleportCooldown || 3.0;
          g.flashTimer = 0.25; // brief flash on reappear
          // PHASE D — phase_fade signature: brief invulnerability window
          // during and just after teleport. Player must time attacks.
          if (g.signature === 'phase_fade') {
            g._phaseFadeTimer = 0.3;
          }
          // PHASE C — WHITE arsenal: wraith heals +3 HP on each teleport.
          if (g.affinityColors && g.affinityColors.indexOf('white') >= 0
              && g.hp < g.hpMax) {
            g.hp = Math.min(g.hpMax, g.hp + 3);
            showFloatingText(g.x, g.y - (g.r + 10), '+3', '#EFEFEF', g);
          }
        }
        // PHASE C — BLACK arsenal: wraith fires weaken orb on own cooldown.
        // Slow-moving projectile; on impact applies weaken 3s.
        if (g.affinityColors && g.affinityColors.indexOf('black') >= 0) {
          g._blackOrbTimer = (g._blackOrbTimer || 0) - dt;
          if (g._blackOrbTimer <= 0 && (g.silencedTimer||0) <= 0 && distToPlayer < 300) {
            var orb = spawnEnemyProjectile(g, player.x, player.y, 1);
            if (orb) {
              orb._blackWeaken = true;
              orb.color = '#553366';
              orb.vx *= 0.55; orb.vy *= 0.55; // slow (telegraphed)
              orb.ttl = 4.0;
              orb.r = 7;
            }
            g._blackOrbTimer = 4.5;   // every 4.5s
          }
        }
      } else {
        // Default: chase (goblin/skeleton/wolf/knight legacy behavior).
        // PHASE E — leap_lunge signature (shadow wolf). Wolf periodically
        // winds up a straight-line charge when the player is in mid-range.
        // States via g._leapState: 'ready' (cooldown) | 'winding' (telegraph)
        //                         | 'leaping' (charge) | 'recovering' (cooldown)
        if (g.signature === 'leap_lunge') {
          if (!g._leapState) { g._leapState = 'ready'; g._leapTimer = 2.0; }
          g._leapTimer = Math.max(0, (g._leapTimer || 0) - dt);

          if (g._leapState === 'ready') {
            // Normal chase until cooldown elapses and player is in leap range.
            if (distToPlayer > 2) {
              g.x += (dx/distToPlayer) * effSpeed * dt;
              g.y += (dy/distToPlayer) * effSpeed * dt;
            }
            if (g._leapTimer <= 0 && distToPlayer >= 80 && distToPlayer <= 220) {
              g._leapState = 'winding';
              g._leapTimer = 0.5;
              // Lock in direction at telegraph start — player must sidestep
              g._leapDirX = dx / distToPlayer;
              g._leapDirY = dy / distToPlayer;
              g._leapOrigX = g.x;
              g._leapOrigY = g.y;
            }
          } else if (g._leapState === 'winding') {
            // Stationary during wind-up so the telegraph is readable.
            if (g._leapTimer <= 0) {
              g._leapState = 'leaping';
              g._leapTimer = 0.35; // leap duration at 600 speed ≈ 210px
            }
          } else if (g._leapState === 'leaping') {
            // Charge straight along locked direction.
            var leapSpd = 600;
            g.x += (g._leapDirX || 0) * leapSpd * dt;
            g.y += (g._leapDirY || 0) * leapSpd * dt;
            // Connect with player?
            if (!player.iframes && distToPlayer < g.r + player.r + 6) {
              _applyEnemyMeleeDamage(g, 3, dx, dy, distToPlayer);
              g._leapState = 'recovering';
              g._leapTimer = 0.6;
            }
            if (g._leapTimer <= 0) {
              g._leapState = 'recovering';
              g._leapTimer = 0.4;
            }
          } else { // recovering
            if (g._leapTimer <= 0) {
              g._leapState = 'ready';
              g._leapTimer = 3.0 + Math.random() * 1.5; // next leap in 3-4.5s
            }
            // Slow drift during recovery
            if (distToPlayer > 2) {
              g.x += (dx/distToPlayer) * effSpeed * 0.35 * dt;
              g.y += (dy/distToPlayer) * effSpeed * 0.35 * dt;
            }
          }
        } else {
          // Plain chase (goblin, skeleton, knight).
          if (distToPlayer > 2) {
            g.x += (dx/distToPlayer) * effSpeed * dt;
            g.y += (dy/distToPlayer) * effSpeed * dt;
          }
        }
      }
    }
  }

  // Clamp
  g.x = Math.max(bounds.x + g.r, Math.min(bounds.x + bounds.w - g.r, g.x));
  g.y = Math.max(bounds.y + g.r, Math.min(bounds.y + bounds.h - g.r, g.y));

  // ── Contact attack — only for touch-damage entities (default legacy).
  // Registry entities with attackPattern 'ranged', 'pulse', or 'telegraph_swing'
  // have their damage handled by the AI dispatcher above, not contact.
  var pat = g.attackPattern || 'touch';
  var contact = g.r + player.r;
  if (pat === 'touch' && !g.confused && (g.silencedTimer||0) <= 0 && distToPlayer < contact && g.attackCooldown <= 0 && !player.iframes) {
    // Physical attack — absorbed by armor pips first.
    // PHASE B — weaken amplifies incoming damage.
    var dmgLeft = Math.ceil((g.dmg || 1) * playerDamageTakenMult());
    if ((player.armor||0) > 0) {
      var absorbed = Math.min(player.armor, dmgLeft);
      player.armor -= absorbed;
      dmgLeft -= absorbed;
      if (_battleStats) _battleStats.armorAbsorbed += absorbed;
      showFloatingText(player.x, player.y - 55, absorbed + ' 🛡', '#AAAAAA', player);
    }
    if (dmgLeft > 0) {
      if (_battleStats) {
        _battleStats.damageTaken += dmgLeft;
        if ((player.hp - dmgLeft) < _battleStats.hpLow) _battleStats.hpLow = Math.max(0, player.hp - dmgLeft);
        if (dmgLeft > (_battleStats.biggestDamageTaken || 0)) _battleStats.biggestDamageTaken = dmgLeft;
      }
      showFloatingText(player.x, player.y - 40, dmgLeft + ' HP', '#E24B4A', player);
      applyDamageToPlayer(dmgLeft);
    }
    player.iframes = 0.9;
    // PHASE C — fire arsenal effects for entities with affinityColors.
    applyArsenalOnTouch(g, dx, dy, distToPlayer);

    // Bounce entity back
    var nx = -dx/distToPlayer, ny = -dy/distToPlayer;
    g.bounceVx = nx * 320;
    g.bounceVy = ny * 320;
    g.bounceTimer = 0.5;
    g.state = 'bounce';
    // Unified slow: any active slow source (greenSlowed, whiteFieldSlowed,
    // slowed, attackSlowed) all flow into the same attack-cooldown penalty.
    // Previously attackSlowed drove this alone; now movement slows piggyback
    // so "slow" is one concept mechanically and visually.
    var _isSlowed = g.attackSlowed || g.attackDebuff > 0
      || g.slowed || g.greenSlowed || g.whiteFieldSlowed;
    g.attackCooldown = _isSlowed ? 2.4 : 1.2;
    g.flashTimer = 0.2;

    if (player.hp <= 0 && !player.bleedOut) respawnPlayer();
  }

  // Player iframes
  if (player.iframes > 0) {
    player.iframes = Math.max(0, player.iframes - dt);
  }
}

function drawDeadEntity(g) {
  var fadeAlpha = Math.min(1, g.deathTimer / 0.5); // fade out in last 0.5s
  ctx.save();
  ctx.globalAlpha = fadeAlpha;
  ctx.translate(g.x, g.y);
  ctx.rotate(Math.PI / 2); // on its side
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, g.r - 3, g.r * 1.2, 4, 0, 0, Math.PI*2);
  ctx.fill();
  // Body — greyed out
  ctx.fillStyle = '#2a3a2a';
  ctx.beginPath();
  ctx.arc(0, 0, g.r, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#3a4a3a';
  ctx.beginPath();
  ctx.arc(0, 0, g.r - 4, 0, Math.PI*2);
  ctx.fill();
  // Icon sideways — use the entity's own icon (not hardcoded goblin).
  // Scale icon the same way the living entity scaled it, so bosses remain
  // imposing in death; small entities look compact.
  var deadIconPx = Math.max(12, Math.round(g.r * 0.9));
  ctx.font = deadIconPx + 'px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = fadeAlpha * 0.7;
  ctx.fillText(g.visIcon || '👺', 0, 0);
  // X eyes — sized with entity radius
  ctx.globalAlpha = fadeAlpha;
  var xPx = Math.max(9, Math.round(g.r * 0.55));
  ctx.font = 'bold ' + xPx + 'px sans-serif';
  ctx.fillStyle = '#ffffff88';
  var xOff = Math.max(4, Math.round(g.r * 0.3));
  ctx.fillText('✕', -xOff, -Math.round(xPx * 0.4));
  ctx.fillText('✕', xOff, -Math.round(xPx * 0.4));
  ctx.restore();
}

// PHASE E — burrow telegraphs for true_burrow entities. Dive swirl during
// 'dive' phase, expanding ground shadow during 'emerge' phase. Drawn before
// entity sprites so they sit underneath.
function drawBurrowTelegraph(g) {
  if (g.signature !== 'true_burrow') return;
  if (g._burrowState === 'dive') {
    // Dirt swirl around the diving worm.
    var diveT = 1 - (g._burrowTimer / 1.0);   // 0..1
    ctx.save();
    ctx.globalAlpha = 0.3 + diveT * 0.5;
    ctx.fillStyle = '#6a4a2a';
    for (var s = 0; s < 8; s++) {
      var ang = (s / 8) * Math.PI * 2 + diveT * Math.PI * 2;
      var rad = 8 + diveT * 22;
      var sx = g.x + Math.cos(ang) * rad;
      var sy = g.y + Math.sin(ang) * rad;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI*2);
      ctx.fill();
    }
    // Hole outline under worm
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#3a2510';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + 2, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  if (g._burrowState === 'emerge' && g._burrowEmergeX !== undefined) {
    // Shadow circle beneath player's tracked position — grows as emerge lands.
    var emT = 1 - (g._burrowTimer / 0.8);     // 0..1
    ctx.save();
    ctx.globalAlpha = 0.35 + emT * 0.45;
    ctx.fillStyle = '#1a0d0a';
    ctx.beginPath();
    ctx.arc(g._burrowEmergeX, g._burrowEmergeY, 70 * (0.45 + emT * 0.55), 0, Math.PI*2);
    ctx.fill();
    // Threat ring around the shadow
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#7a2510';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(g._burrowEmergeX, g._burrowEmergeY, 70, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawEntity(g) {
  ctx.save();

  // PHASE E — true_burrow: hide worm sprite entirely when underground.
  // Emerge shadow telegraph is drawn separately (see drawBurrowTelegraph).
  if (g.signature === 'true_burrow' && g._burrowHidden) {
    ctx.restore();
    return;
  }

  // PHASE E — enrage_phase visual: colossus in phase 2 gets a pulsing
  // red-orange corona. During the 1s roar freeze, the aura peaks with
  // a shockwave ring.
  if (g.signature === 'enrage_phase' && g._enraged) {
    var nowE = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.006;
    var pulseE = 0.5 + Math.abs(Math.sin(nowE)) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.35 * pulseE;
    ctx.shadowColor = '#ff3300';
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = '#ff4422';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + 10, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    if ((g._enrageRoarTimer || 0) > 0) {
      var rt = 1 - g._enrageRoarTimer;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - rt);
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + rt * 80, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }
  // red-orange corona. During the 1s roar freeze, the aura peaks with
  // a shockwave ring.
  if (g.signature === 'enrage_phase' && g._enraged) {
    var nowE = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.006;
    var pulseE = 0.5 + Math.abs(Math.sin(nowE)) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.35 * pulseE;
    ctx.shadowColor = '#ff3300';
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = '#ff4422';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + 10, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    if ((g._enrageRoarTimer || 0) > 0) {
      var rt = 1 - g._enrageRoarTimer;   // 0..1 through roar
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - rt);
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + rt * 80, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // PHASE E — front_shield: visible shield arc on the side the knight
  // is facing. Brightens briefly after absorbing a hit (reuse flashTimer
  // as the brighten signal).
  if (g.signature === 'front_shield' && player) {
    var sfx, sfy;
    if (g.swingState === 'winding' || g.swingState === 'cooldown') {
      sfx = g.swingTargetX - g.x;
      sfy = g.swingTargetY - g.y;
    } else {
      sfx = player.x - g.x;
      sfy = player.y - g.y;
    }
    var sfd = Math.hypot(sfx, sfy) || 1;
    var ang = Math.atan2(sfy, sfx);
    var shieldR = g.r + 6;
    ctx.save();
    ctx.globalAlpha = g.flashTimer > 0 ? 0.9 : 0.55;
    ctx.strokeStyle = '#BBBBFF';
    ctx.shadowColor = '#BBBBFF';
    ctx.shadowBlur  = g.flashTimer > 0 ? 16 : 6;
    ctx.lineWidth   = 4;
    ctx.beginPath();
    // 120° arc centered on facing direction (±60°)
    ctx.arc(g.x, g.y, shieldR, ang - Math.PI/3, ang + Math.PI/3);
    ctx.stroke();
    ctx.restore();
  }

  // PHASE E — leap_lunge telegraph line during windup, so player has a
  // readable sidestep cue. Drawn beneath everything else on the entity.
  if (g.signature === 'leap_lunge' && g._leapState === 'winding') {
    var lwPct = 1 - (g._leapTimer / 0.5);
    ctx.save();
    ctx.globalAlpha = 0.25 + lwPct * 0.5;
    ctx.strokeStyle = '#9060C0';
    ctx.shadowColor = '#9060C0';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x + (g._leapDirX || 0) * 210, g.y + (g._leapDirY || 0) * 210);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // PHASE D — phase_fade visual: when the wraith is in the invulnerable
  // window, render its sprite at reduced alpha with a purple smoke glow
  // so the player can SEE it's untouchable. The timer peaks at 0.3s;
  // alpha drops to ~0.35 at peak and fades back in as the timer ticks.
  if ((g._phaseFadeTimer || 0) > 0) {
    var pfPct = Math.min(1, g._phaseFadeTimer / 0.3); // 1 at fresh, 0 at end
    ctx.globalAlpha = 0.35 + (1 - pfPct) * 0.4;       // 0.35 → 0.75
    ctx.shadowColor = '#9060C0';
    ctx.shadowBlur = 24 * pfPct;
  }

  // Flash white on attack
  var flashing = g.flashTimer > 0;

  // Template-provided visual identity (falls back to legacy goblin colors
  // if absent — keeps the file tolerant of any rogue manual spawns).
  var bodyColor  = g.visColor || '#3a7a2a';
  var innerColor = _lightenHex(bodyColor, 0.2);
  var entityIcon = g.visIcon || '👺';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(g.x, g.y + g.r - 3, g.r * 0.75, 5, 0, 0, Math.PI*2);
  ctx.fill();

  // Swing telegraph (heavy_melee wind-up) — render first so body draws on
  // top. Orange dashed ring plus a fill pulse that grows as the telegraph
  // completes, so players can read the timing visually.
  if (g.swingState === 'winding') {
    var swR = scaleDist(g.swingRadius || 60);
    var swPct = 1 - (g.swingTimer / (g.swingTelegraph || 0.6)); // 0→1 fill
    ctx.save();
    ctx.globalAlpha = 0.3 + swPct * 0.4;
    ctx.strokeStyle = '#ff6600';
    ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(g.swingTargetX, g.swingTargetY, swR, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = swPct * 0.15;
    ctx.fillStyle = '#ff3300';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(g.swingTargetX, g.swingTargetY, swR, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // State ring — red when chasing/bouncing; darker shadow otherwise.
  if (g.state === 'chase' || g.state === 'bounce') {
    ctx.shadowColor = '#E24B4A';
    ctx.shadowBlur = 16;
  } else {
    ctx.shadowColor = _darkenHex(bodyColor, 0.5);
    ctx.shadowBlur = 10;
  }

  // Body
  ctx.fillStyle = flashing ? '#ffffff' : bodyColor;
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r, 0, Math.PI*2);
  ctx.fill();

  // Inner
  ctx.shadowBlur = 0;
  ctx.fillStyle = flashing ? '#eeeeee' : innerColor;
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r - 4, 0, Math.PI*2);
  ctx.fill();

  // Entity icon — sized relative to radius so bosses look imposing.
  var iconPx = Math.max(12, Math.round(g.r * 0.9));
  ctx.font = iconPx + 'px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(entityIcon, g.x, g.y);

  // Aggro indicator — small red dot when chasing
  if (g.state === 'chase') {
    ctx.fillStyle = '#E24B4A';
    ctx.beginPath();
    ctx.arc(g.x + g.r - 4, g.y - g.r + 4, 4, 0, Math.PI*2);
    ctx.fill();
  }

  // HP bar above entity
  var barW = 60, barH = 7;
  var barX = g.x - barW/2, barY = g.y - g.r - 16;
  var hpPct = g.hp / g.hpMax;
  var hpColor = hpPct > 0.5 ? '#4a9a35' : hpPct > 0.25 ? '#F5D000' : '#E24B4A';
  // Background
  ctx.fillStyle = '#111';
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  // Empty bar
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(barX, barY, barW, barH);
  // Fill
  ctx.fillStyle = hpColor;
  ctx.shadowColor = hpColor;
  ctx.shadowBlur = 6;
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.shadowBlur = 0;
  // HP numbers — match player style
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(g.hp + '/' + g.hpMax, g.x, barY - 9);

  // ── Unified status effect stack (above HP bar) ──
  _drawEffectStack(g.x, barY, _entityEffects(g));

  // Aggro range indicator (faint, patrol only)
  if (g.state === 'patrol') {
    ctx.strokeStyle = 'rgba(255,100,100,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,5]);
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.AGGRO_RANGE, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Deaggro ring when chasing — shows player how far to run
  if (g.state === 'chase') {
    ctx.strokeStyle = 'rgba(255,80,80,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6,6]);
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.DEAGGRO_RANGE, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Wither body stain — preserved as a per-entity visual cue.
  // The stack above shows the count + timer; the stain reinforces "this
  // entity is being withered" at a glance without reading text.
  if ((g.witherStacks||0) > 0) {
    ctx.save();
    var stainAlpha = Math.min(0.45, 0.08 * g.witherStacks);
    ctx.globalAlpha = stainAlpha;
    ctx.fillStyle = '#1a0033';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

// ═══════════════════════════════════════════════════
// BRICK ACTIONS
// ═══════════════════════════════════════════════════
var brickAction = null;
var blackEffect = null; // current active brick action state

// ═══════════════════════════════════════════════════
// WITHERBOLT — Fixer black tap
// Medium-range slow bolt, damages + stacks WITHER on target.
// Witherbolts scale HARD per stack ("curse hits harder each time") while other
// damage sources benefit from a softer diminishing-returns amp per stack.
// Any new witherbolt cast refreshes the shared timer to WITHER_DURATION.
// Stacks have no hard cap; diminishing returns keep other-source amp bounded.
// ═══════════════════════════════════════════════════
var witherBolts = [];
var WITHER_DURATION = 5.0;       // seconds; any new cast refreshes to this
var WITHER_BOLT_SPEED = 260;     // slow compared to blue (500) — "slow application"

// Damage scaling of the NEXT witherbolt against a target that already has stacks.
// Accelerating: 1x, 1.5x, 2.25x, 3.375x, 5.06x, 7.59x...
// This is what makes back-to-back witherbolts snowball.
function witherSelfScale(stacks) {
  return Math.pow(1.5, Math.max(0, stacks));
}

// Amplifier applied to damage from NON-witherbolt sources (red, blue, etc.)
// against a withered target. Soft cap, approaches +60%.
// stacks=0 → 1.0, 1 → 1.15, 2 → 1.26, 3 → 1.34, 5 → 1.46, 10 → 1.57
function witherOtherAmp(stacks) {
  if (stacks <= 0) return 1.0;
  return 1.0 + 0.6 * (1 - Math.pow(0.75, stacks));
}

function startWitherbolt(ox, oy) {
  if (!player) return;
  var tap = tapScaleMult('black');
  var aff = affinityMult('black');
  var crit = !!_currentCrit;
  // Target: if dragged to coords, target nearest entity to those coords.
  // Otherwise, nearest entity to player.
  var targetX = (ox !== undefined) ? ox : player.x;
  var targetY = (oy !== undefined) ? oy : player.y;
  var target = null;
  var best = Infinity;
  entities.forEach(function(g) {
    if (g.hp <= 0) return;
    var d = Math.hypot(g.x - targetX, g.y - targetY);
    if (d < best) { best = d; target = g; }
  });
  if (!target) {
    // No enemies to hit — consume nothing silently. Let caller return brick.
    showFloatingText(player.x, player.y - 50, 'NO TARGET', '#555', player);
    return false;
  }
  // Base direct damage: 2 * scale. Crit DEEP WITHER applies +1 stack bonus.
  var baseDmg = 2 * tap * aff;
  witherBolts.push({
    x: player.x, y: player.y,
    target: target,
    speed: WITHER_BOLT_SPEED,
    baseDmg: baseDmg,
    r: 8,
    alpha: 1.0,
    wobble: 0,
    wobbleAmp: 12,
    trailTimer: 0,
    dead: false,
    stacksApplied: crit ? 2 : 1, // DEEP WITHER crit stacks double
    isCrit: crit,
  });
  return true;
}

function updateWitherbolts(dt) {
  witherBolts = witherBolts.filter(function(b) { return !b.dead; });
  witherBolts.forEach(function(b) {
    if (!b.target || b.target.hp <= 0) { b.dead = true; return; }
    var dx = b.target.x - b.x, dy = b.target.y - b.y;
    var dist = Math.sqrt(dx*dx + dy*dy) || 1;
    // Perpendicular wobble for the curved "sinister" flight path
    b.wobble += dt * 6;
    var nx = dx / dist, ny = dy / dist;
    var px = -ny, py = nx; // perp
    var wob = Math.sin(b.wobble) * b.wobbleAmp;
    var step = b.speed * dt;
    b.x += nx * step + px * wob * dt;
    b.y += ny * step + py * wob * dt;
    // Trail particles
    b.trailTimer += dt;
    if (b.trailTimer >= 0.05) {
      b.trailTimer = 0;
      purpleParticles.push({
        x: b.x + (Math.random()-0.5)*6, y: b.y + (Math.random()-0.5)*6,
        vx: (Math.random()-0.5)*20, vy: (Math.random()-0.5)*20,
        r: 2 + Math.random()*2, alpha: 0.7, color: '#552288',
      });
    }
    // Impact check
    if (dist < b.r + b.target.r) {
      // Compute damage: base scaled by current stacks on target (pre-new).
      var existing = b.target.witherStacks || 0;
      var dmg = Math.max(1, Math.ceil(b.baseDmg * witherSelfScale(existing)));
      // Mark as witherbolt-source so damageEntity doesn't double-amp it.
      _witherboltDamage = true;
      var res = damageEntity(b.target, dmg, undefined, 'black');
      _witherboltDamage = false;
      b.target.flashTimer = 0.2;
      showDamageNumber(b.target.x, b.target.y - 30, res.applied, '#552288', res.tier, b.target.x, b.target.y, undefined, res.witherBoost, b.target);
      // Apply wither stacks + refresh shared timer. Stack readout lives in
      // the unified buff bar above the entity now — no impact floater.
      b.target.witherStacks = (b.target.witherStacks || 0) + b.stacksApplied;
      b.target.witherTimer = WITHER_DURATION;
      // WITHERED threshold banner only when it crits and reaches the cap.
      if (b.target.witherStacks >= 5 && b.isCrit) {
        showFloatingText(b.target.x, b.target.y - 70, 'WITHERED!', '#9B6FD4', b.target);
      }
      // Crit visuals
      if (b.isCrit) {
        spawnCritShockwave(b.target.x, b.target.y, '#552288', { r0: 6, maxR: scaleDist(140), thickness: 3, growth: 280 });
        spawnCritFlourish(b.target.x, b.target.y, '#7744AA', 16);
        spawnCritFlourish(b.target.x, b.target.y, '#CC99FF', 10);
      }
      b.dead = true;
      triggerVictory();
    }
  });
}

function drawWitherbolts() {
  if (!ctx) return;
  witherBolts.forEach(function(b) {
    ctx.save();
    // Outer glow
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#7744AA';
    ctx.shadowColor = '#552288'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.5, 0, Math.PI*2); ctx.fill();
    // Core
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#333';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI*2); ctx.fill();
    // Inner highlight
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#BB88FF';
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(b.x - b.r*0.2, b.y - b.r*0.2, b.r * 0.3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

// Track when damageEntity is being called FROM a witherbolt so we don't
// apply the other-source amp to the witherbolt itself (that would double-count).
var _witherboltDamage = false;

// Per-entity wither timer decay — called each frame from updateEntity.
function decayWither(g, dt) {
  if ((g.witherTimer || 0) > 0) {
    g.witherTimer = Math.max(0, g.witherTimer - dt);
    if (g.witherTimer <= 0) {
      g.witherStacks = 0;
    }
  }
}

var BRICK_COOLDOWNS = {};
var BRICK_CD_TIMES = { red:8, yellow:10 }; // kept for reference but not used for timing

function tickBrickCooldowns(dt) {
  // No-op — cooldowns now only block while brickAction is active
}

function useBrickAction(color) {
  if (!player || !running) return;
  // Only block if a duration action is in progress AND this brick also needs exclusive control
  var exclusiveColors = ['red']; // only these block others
  if (brickAction && exclusiveColors.indexOf(color) >= 0) {
    showFloatingText(player.x, player.y - 50, 'WAIT...', '#888', player);
    return;
  }
  if (!player.bricks[color] || player.bricks[color] <= 0) return;

  if (player.bricks[color] <= 0) return; // no charges
  player.bricks[color]--;
  if (_battleStats) _addBrickStat(_battleStats.bricksUsed, color, 1);
  player.brickRecharge[color] = player.brickRecharge[color] || 0;
  renderBrickBar();

  // Crit roll for taps. Count=1 for taps. Threshold EFFECTS per color
  // land in Session B; universal signature fires here for consistency
  // across tap and overload paths.
  _currentCrit = rollCrit(color, 1);
  if (_currentCrit) {
    triggerCritSignature(color, player.x, player.y - 80);
  }

  if (color === 'red')    startRedCharge(1);
  if (color === 'white')  doWhiteHeal(player.x, player.y);
  if (color === 'yellow') startYellowAura({ follow: true, radius: scaleDist(120 * tapScaleMult('yellow') * affinityRadiusMult('yellow')), duration: 3.0, label: 'DAZE FIELD', isCrit: _currentCrit });
  if (color === 'blue')   startBlueBolt(null);
  if (color === 'orange') startOrangeTrap(player.x, player.y);
  if (color === 'gray')   startGrayArmor(player.x, player.y);
  if (color === 'purple') startPurpleBurst(player.x, player.y);
  if (color === 'black') {
    var fired = startWitherbolt();
    if (fired === false) {
      // No target — refund the brick.
      player.bricks[color]++;
      renderBrickBar();
    }
  }
}

// ── RED — Charge ──────────────────────────────────
function startRedChargeTo(dmgMult, tx, ty) {
  // Charge toward a specific canvas point
  var _dmgMult = dmgMult || 1;
  var startX = player.x, startY = player.y;
  var dx = tx - player.x, dy = ty - player.y;
  var dist = Math.sqrt(dx*dx+dy*dy) || 1;
  brickAction = {
    type: 'red', phase: 'charge',
    startX: startX, startY: startY,
    dirX: dx/dist, dirY: dy/dist,
    chargeSpeed: player.speed * 4,
    returnSpeed: player.speed * 2,
    hit: false, dmgMult: _dmgMult,
    targetX: tx, targetY: ty, // fixed target point
    usePoint: true,
    isCrit: _currentCrit,
  };
}

function startRedCharge(dmgMult, targetEntity) {
  if (!entities.length) return;
  var _dmgMult = dmgMult || 1;
  var entity = targetEntity || entities.reduce(function(a,b){
    return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;});
  var startX = player.x, startY = player.y;
  var dx = entity.x - player.x, dy = entity.y - player.y;
  var dist = Math.sqrt(dx*dx + dy*dy) || 1;
  var nx = dx/dist, ny = dy/dist;
  brickAction = {
    type: 'red',
    phase: 'charge',
    startX: startX, startY: startY,
    dirX: nx, dirY: ny,
    chargeSpeed: player.speed * 4,
    returnSpeed: player.speed * 2,
    hit: false,
    dmgMult: _dmgMult,
    isCrit: _currentCrit,
  };
}

// ── WHITE — Heal ─────────────────────────────────
var playerSparkles = [];
var playerRegen = null; // { hpPerSec, timer, duration, tick } // anchored to player position


function getArmorMax() {
  if (!player) return 0;
  var mult = player.cls === 'breaker' ? 0.75 : 0.5;
  return Math.floor(player.hpMax * mult);
}
function startWhiteRegen(tier) {
  var tap = tapScaleMult('white');
  var mult = affinityMult('white');
  var baseAmt = window.baseHeal(player.cls);
  var baseDur = 5;
  var hpPerSec = baseAmt * tap * Math.pow(1.25, tier-1) / baseDur * mult;
  var duration = baseDur * Math.pow(2, tier-1) * mult;
  if (playerRegen) {
    // Stack — extend duration
    playerRegen.hpPerSec = Math.max(playerRegen.hpPerSec, hpPerSec);
    playerRegen.timer = Math.max(playerRegen.timer, duration);
    playerRegen.duration = duration;
  } else {
    playerRegen = { hpPerSec: hpPerSec, timer: duration, duration: duration, tick: 0 };
  }
}

function updateRegen(dt) {
  if (!playerRegen || !player) return;
  playerRegen.timer -= dt;
  playerRegen.tick += dt;
  if (playerRegen.tick >= 1.0) {
    playerRegen.tick -= 1.0;
    var cap = Math.max(player.hpMax, player.hp);
    var prev = player.hp;
    player.hp = Math.min(cap, player.hp + playerRegen.hpPerSec);
    var healed = Math.ceil(player.hp - prev);
    if (healed > 0) {
      if (_battleStats) {
        _battleStats.totalHealed = (_battleStats.totalHealed || 0) + healed;
        if (healed > (_battleStats.biggestHealPlayer || 0)) _battleStats.biggestHealPlayer = healed;
      }
      showFloatingText(player.x, player.y-40, healed + ' ✨', '#EFEFEF', player);
      spawnHealSparkles(1);
      // Regen counts as a heal — could rescue from bleed.
      applyBleedRescue(healed);
    }
  }
  if (playerRegen.timer <= 0) playerRegen = null;
}

// ── BLEED-OUT (per design doc §1.4, refined) ───────────────────────────
// Every killing blow initiates a bleed window — no damage threshold.
// The window's length scales with how much overflow damage was dealt:
//   overflow=1  (barely fatal)  → 2400ms
//   overflow=5                  → 2000ms
//   overflow=15                 → 1000ms
//   overflow=25+ (catastrophic) → 500ms (floor)
//
// Heals during the window can push toHp positive (rescue trajectory).
// Additional damage during bleed compounds toHp lower without extending duration.
//
// Three central helpers route HP changes through bleed-aware paths:
//   applyDamageToPlayer(dmg) — replaces direct `player.hp -= dmg`. Triggers
//     bleed on any killing blow, else applies instantly.
//   applyHealToPlayer(amount) — caps + heals, also rescues from bleed if active.
//   applyBleedRescue(healed) — called by any heal path to interrupt bleed.

var BLEED_DURATION_MAX_MS = 2500;
var BLEED_DURATION_MIN_MS = 500;
var BLEED_OVERFLOW_PENALTY_MS = 100; // ms shaved off duration per point of overflow

function applyDamageToPlayer(dmg) {
  if (!player || dmg <= 0) return;
  var newHp = player.hp - dmg;
  // Non-killing blow — instant apply, no bleed. Round so HP stays integer.
  if (newHp > 0) {
    player.hp = Math.max(0, Math.round(newHp));
    return;
  }
  // Killing blow path
  if (player.bleedOut) {
    // Already bleeding — stack overflow into existing toHp (drives rescue
    // target deeper). Don't extend duration; existing window plays out.
    player.bleedOut.toHp -= dmg;
    return;
  }
  // Initiate fresh bleed
  var overflow = Math.max(1, dmg - player.hp);
  var duration = Math.max(
    BLEED_DURATION_MIN_MS,
    Math.min(BLEED_DURATION_MAX_MS, BLEED_DURATION_MAX_MS - overflow * BLEED_OVERFLOW_PENALTY_MS)
  );
  player.bleedOut = {
    fromHp: player.hp,
    toHp: -overflow,    // negative; we visually clamp to 0 in the renderer
    startTime: performance.now(),
    duration: duration,
  };
  showFloatingText(player.x, player.y - 60, '⚠ BLEED', '#b06fef', player);
}

function applyHealToPlayer(amount) {
  if (!player || amount <= 0) return 0;
  var prev = player.hp;
  var cap = Math.max(player.hpMax, player.hp);
  player.hp = Math.min(cap, Math.round(player.hp + amount));
  var actual = player.hp - prev;
  if (actual > 0) applyBleedRescue(actual);
  return actual;
}

// Called by any heal path to interrupt bleed-out. Raises the bleed's toHp
// toward rescue. If the new toHp is positive, the trajectory becomes a
// rescue arc — bleed will resolve to a saved state when its window ends.
function applyBleedRescue(healAmount) {
  if (!player || !player.bleedOut || healAmount <= 0) return;
  var b = player.bleedOut;
  // Compute current visual HP based on bleed progress (mirrors update logic)
  var elapsed = performance.now() - b.startTime;
  var t = Math.min(1, elapsed / b.duration);
  var currentVisualHp = b.fromHp + (b.toHp - b.fromHp) * t;
  // New target = current visual HP + heal amount, capped at hpMax
  var newToHp = Math.min(player.hpMax, currentVisualHp + healAmount);
  // Restart math from current visual position toward new target.
  // Remaining duration stays the same — heal just bends the trajectory.
  var remaining = Math.max(0, b.duration - elapsed);
  b.fromHp = currentVisualHp;
  b.toHp = newToHp;
  b.startTime = performance.now();
  b.duration = remaining;
  // If toHp positive, this is a rescue trajectory — show the rescued floater
  if (newToHp > 0) {
    showFloatingText(player.x, player.y - 70, '✓ RESCUED', '#5dd055', player);
  }
}

// ── BLEED SCREEN TINT ───────────────────────────────────────────────
// Faint red overlay during bleed-out. Lazy-created so it works in any
// host page (test harness, players.html) without needing HTML markup.
// Pulses subtly while bleeding; fades in/out cleanly on enter/exit.
function _ensureBleedOverlay() {
  var el = document.getElementById('rumble-bleed-overlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'rumble-bleed-overlay';
  el.style.cssText = [
    'position:fixed', 'inset:0',
    'pointer-events:none',
    'z-index:150',                      // below HUD/picker, above canvas
    'opacity:0',
    'transition:opacity 600ms ease-out',
    // Radial gradient — vignette-style. Deeper red at edges, light center.
    // Layered with subtle inner pulse via animation.
    'background:radial-gradient(ellipse at center, rgba(176,0,40,0) 30%, rgba(176,0,40,0.18) 75%, rgba(120,0,30,0.32) 100%)',
    'animation:bleedPulse 1.4s ease-in-out infinite',
  ].join(';');
  // Inject keyframes once — no-op if already present
  if (!document.getElementById('rumble-bleed-keyframes')) {
    var style = document.createElement('style');
    style.id = 'rumble-bleed-keyframes';
    style.textContent =
      '@keyframes bleedPulse {'
      + '  0%, 100% { filter:brightness(1.0); }'
      + '  50%      { filter:brightness(1.25); }'
      + '}';
    document.head.appendChild(style);
  }
  document.body.appendChild(el);
  return el;
}

function updateBleedOverlay(isBleeding) {
  var el = _ensureBleedOverlay();
  if (isBleeding) {
    // Faster fade IN (urgency) than fade OUT (relief)
    el.style.transition = 'opacity 300ms ease-out';
    el.style.opacity = '1';
  } else {
    el.style.transition = 'opacity 600ms ease-out';
    el.style.opacity = '0';
  }
}

function updateBleedOut(dt) {
  if (!player || !player.bleedOut) return;
  var b = player.bleedOut;
  var elapsed = performance.now() - b.startTime;
  var t = b.duration > 0 ? Math.min(1, elapsed / b.duration) : 1;
  // Linear interpolation from fromHp to toHp over duration. Clamp visual to 0.
  // Round to whole int — internal interp is float for smooth math but the
  // displayed HP should always be a whole number.
  var interp = b.fromHp + (b.toHp - b.fromHp) * t;
  player.hp = Math.max(0, Math.round(interp));
  if (t >= 1) {
    // Bleed complete. Lock in toHp (clamped to 0, rounded) and clear state.
    player.hp = Math.max(0, Math.round(b.toHp));
    player.bleedOut = null;
    if (player.hp <= 0) {
      // Death — route through normal respawn/revive flow
      if (typeof respawnPlayer === 'function') respawnPlayer();
    }
  }
}

// ── PURPLE DRAIN ────────────────────────────────────────────────────
// Inverse of bleed: bleed shrinks HP over a window, drain grows HP over
// a window. Triggered by purple lifesteal. Faster than bleed because
// feeding is eager (drain ~700ms vs bleed 2500ms).
// Compounds: multiple lifesteal hits during an active drain extend toHp.
// Visual: pulsing purple aura around the player, local (follows player),
// in contrast to bleed's global red screen tint.

var DRAIN_DURATION_MS = 700;        // baseline drain window
var DRAIN_DURATION_EXTRA_MS = 80;   // ms added per HP per stacked hit

function applyDrainHeal(amount) {
  if (!player || amount <= 0) return 0;
  // If currently bleeding, route to existing rescue path — drain animation
  // doesn't apply here because bleed is the dominant state and its rescue
  // arc is the visual that already plays. The two systems share the same
  // intent (HP rising over time) so doubling them up would clash.
  if (player.bleedOut) {
    var prev = player.hp;
    var cap = player.hpMax * 2;
    player.hp = Math.min(cap, Math.round(player.hp + amount));
    var actual = player.hp - prev;
    if (actual > 0) applyBleedRescue(actual);
    return actual;
  }
  var cap = player.hpMax * 2;
  if (player.draining) {
    // Compound — extend toHp toward new target, refresh duration so the
    // newly-added heal has time to play out (don't truncate mid-arc)
    var d = player.draining;
    var newTo = Math.min(cap, d.toHp + amount);
    var added = newTo - d.toHp;
    if (added > 0) {
      d.toHp = newTo;
      d.duration += DRAIN_DURATION_EXTRA_MS * added;
    }
    return added;
  }
  // Initiate fresh drain
  var fromHp = player.hp;
  var toHp = Math.min(cap, fromHp + amount);
  if (toHp <= fromHp) return 0;
  player.draining = {
    fromHp: fromHp,
    toHp: toHp,
    startTime: performance.now(),
    duration: DRAIN_DURATION_MS + DRAIN_DURATION_EXTRA_MS * (toHp - fromHp),
  };
  return toHp - fromHp;
}

function updateDrain(dt) {
  if (!player || !player.draining) return;
  var d = player.draining;
  var elapsed = performance.now() - d.startTime;
  var t = d.duration > 0 ? Math.min(1, elapsed / d.duration) : 1;
  // Linear interp from fromHp to toHp. Round so displayed HP stays integer.
  var interp = d.fromHp + (d.toHp - d.fromHp) * t;
  player.hp = Math.round(interp);
  if (t >= 1) {
    // Drain complete. Lock in toHp, account stats, clear state.
    var totalGained = Math.round(d.toHp) - Math.round(d.fromHp);
    player.hp = Math.round(d.toHp);
    if (_battleStats && totalGained > 0) {
      _battleStats.totalHealed = (_battleStats.totalHealed || 0) + totalGained;
      if (totalGained > (_battleStats.biggestHealPlayer || 0)) {
        _battleStats.biggestHealPlayer = totalGained;
      }
    }
    // Overheal floater on completion if we ended above hpMax
    if (player.hp > player.hpMax) {
      var oh = player.hp - Math.max(player.hpMax, Math.round(d.fromHp));
      if (oh > 0) showFloatingText(player.x, player.y - 50, oh + ' ♥', '#9B6FD4', player);
    }
    player.draining = null;
  }
}

// Pulsing purple aura — drawn each frame while draining. The pulse syncs
// with the int-HP increments so the player sees the aura flare each time
// HP visibly rises. Fades in over 100ms (eager onset), stays bright while
// active, fades out via no-render once player.draining clears.
function drawDrainAura() {
  if (!player || !player.draining) return;
  var d = player.draining;
  var elapsed = performance.now() - d.startTime;
  var t = d.duration > 0 ? Math.min(1, elapsed / d.duration) : 1;
  // Fade-in ramp during first 100ms, full intensity through middle,
  // taper off slightly toward end (subtle release).
  var fadeIn = Math.min(1, elapsed / 100);
  var fadeOut = (t > 0.85) ? (1 - (t - 0.85) / 0.15) : 1;
  var intensity = fadeIn * Math.max(0.4, fadeOut);
  // Pulse — frequency matches the visual HP-tick cadence (one beat per HP
  // gained, roughly). The sin wave makes the aura "breathe" with the heal.
  var hpGained = Math.max(1, Math.round(d.toHp - d.fromHp));
  var pulseFreq = (hpGained * Math.PI) / Math.max(0.05, d.duration / 1000);
  var pulse = 0.5 + 0.5 * Math.sin(elapsed / 1000 * pulseFreq);
  ctx.save();
  // Outer ring — soft purple glow at player.r + 14, throbs with pulse
  var outerR = player.r + 12 + pulse * 8;
  var grad = ctx.createRadialGradient(player.x, player.y, player.r, player.x, player.y, outerR);
  grad.addColorStop(0, 'rgba(155,111,212,0)');
  grad.addColorStop(0.5, 'rgba(155,111,212,' + (0.35 * intensity) + ')');
  grad.addColorStop(1, 'rgba(123,47,190,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(player.x, player.y, outerR, 0, Math.PI * 2);
  ctx.fill();
  // Inner ring — sharper edge, brighter purple, slightly smaller
  ctx.strokeStyle = 'rgba(204, 153, 255,' + (0.7 * intensity * (0.5 + 0.5 * pulse)) + ')';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#9B6FD4';
  ctx.shadowBlur = 14 * intensity;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRegen() {
  if (!playerRegen || !player) return;
  var pct = playerRegen.timer / playerRegen.duration;
  var now5 = performance.now();
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.1 * Math.sin(now5*0.005);
  ctx.strokeStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8;
  ctx.lineWidth = 2;
  ctx.setLineDash([4,6]);
  ctx.beginPath(); ctx.arc(player.x, player.y, player.r+10, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function spawnHealSparkles(tier) {
  var count = Math.max(1, Math.round(3 * tier * vScale(tier)));
  var colors = ['#ffffff', '#ffeeee', '#ffe0f0', '#ffddff'];
  var sizeBase = 5 + tier * 1.2;
  var speedBase = 0.3 + tier * 0.1;
  for (var i = 0; i < count; i++) {
    var angle = Math.random() * Math.PI * 2;
    var r = 3 + Math.random() * (6 + tier * 2);
    playerSparkles.push({
      ox: Math.cos(angle)*r, oy: Math.sin(angle)*r,
      vox: Math.cos(angle)*speedBase*(0.5+Math.random()),
      voy: Math.sin(angle)*speedBase*(0.5+Math.random()) - 0.15,
      text: tier >= 3 ? '✦' : '✧',
      color: colors[Math.floor(Math.random()*colors.length)],
      size: sizeBase + Math.random()*sizeBase, alpha: 0.9, life: 1,
    });
  }
}

function doWhiteHeal(targetX, targetY) {
  // Tap heal — canonical formula in characters.js (count=1 for tap, no overload stack)
  var ownedW = (player.brickMax && player.brickMax.white) || 0;
  var healAmt = window.computeHeal(player.cls, 'white', ownedW, 1);
  var prev = player.hp;
  var cap = Math.max(player.hpMax, player.hp);
  player.hp = Math.min(cap, player.hp + healAmt);
  var actual = player.hp - prev;
  if (actual > 0) applyBleedRescue(actual);
  if (_battleStats && actual > 0) {
    _battleStats.totalHealed = (_battleStats.totalHealed || 0) + actual;
    if (actual > (_battleStats.biggestHealPlayer || 0)) _battleStats.biggestHealPlayer = actual;
  }
  var fx = targetX !== undefined ? targetX : player.x;
  var fy = targetY !== undefined ? targetY : player.y;
  showFloatingText(fx, fy - 50, actual + ' ✚', '#EFEFEF', player);
  spawnHealSparkles(1);
  // WHITE BLESSING: on crit, purge player debuffs.
  if (_currentCrit) {
    // PHASE B — cleanse all player status effects (poison/slow/daze/confuse/weaken).
    clearStatuses();
    showFloatingText(fx, fy - 68, 'CLEANSED', '#FFFFFF', player);
    // WHITE flourish: white radiant halo + pink-tinted sparkle burst
    spawnCritShockwave(fx, fy, '#FFFFFF', { r0: 6, maxR: scaleDist(160), thickness: 3, growth: 240 });
    spawnCritFlourish(fx, fy, '#FFEEFF', 16);
    spawnCritFlourish(fx, fy, '#FFAACC', 10);
  }
}

// ── YELLOW — Confuse ──────────────────────────────
// Two flavors:
//   • Aura (tap, overload):       3s ring that follows player or stays anchored;
//                                  any entity inside gets confused, refreshed
//                                  each frame while in contact.
//   • Instant burst (drag-to-pt): one-shot confuse burst at the drop point.
var yellowAura = null; // { timer, baseRadius, followPlayer, ox, oy, label }

function startYellowAura(opts) {
  // opts = { radius, duration, follow (bool), ox, oy, label, isCrit }
  yellowAura = {
    timer: opts.duration || 3.0,
    duration: opts.duration || 3.0,
    baseRadius: opts.radius || scaleDist(120),
    followPlayer: !!opts.follow,
    ox: opts.ox !== undefined ? opts.ox : player.x,
    oy: opts.oy !== undefined ? opts.oy : player.y,
    label: opts.label || 'DAZE FIELD',
    pulse: 0,
    isCrit: !!opts.isCrit,  // YELLOW DAZE flag
  };
  if (opts.isCrit) {
    // YELLOW flourish: electric yellow shockwave + static spark burst
    spawnCritShockwave(yellowAura.ox, yellowAura.oy, '#F5D000', { r0: 10, maxR: yellowAura.baseRadius, thickness: 3, growth: 300 });
    spawnCritFlourish(yellowAura.ox, yellowAura.oy, '#FFEE44', 20);
    spawnCritFlourish(yellowAura.ox, yellowAura.oy, '#FFD700', 12);
  }
}

function updateYellowAura(dt) {
  if (!yellowAura) return;
  yellowAura.timer -= dt;
  yellowAura.pulse = (yellowAura.pulse + dt * 3) % (Math.PI * 2);
  if (yellowAura.timer <= 0) { yellowAura = null; return; }
  // Anchor follows player if flagged
  var cx = yellowAura.followPlayer ? player.x : yellowAura.ox;
  var cy = yellowAura.followPlayer ? player.y : yellowAura.oy;
  var r = yellowAura.baseRadius;
  var mult = tapScaleMult('yellow') * affinityMult('yellow');
  var isCrit = !!yellowAura.isCrit;
  entities.forEach(function(g) {
    if (Math.hypot(g.x - cx, g.y - cy) <= r) {
      if (!g.confused) {
        // First entry: seed a 2s confuse (scaled by inventory × affinity)
        g.confused = true;
        g.confuseTimer = Math.max(g.confuseTimer || 0, 2.0 * mult);
      } else {
        // Already confused: top up each frame in contact (scaled by inventory × affinity)
        g.confuseTimer = Math.max(g.confuseTimer || 0, 1.0 * mult);
      }
      // YELLOW DAZE: entities caught by crit aura take 2x damage while confused.
      if (isCrit) g.dazed = true;
    }
  });
  // Occasional "?" particle shimmer while active — tuned sparse so the field
  // reads as "confusion" without visual noise. Prior: 40% × 2-3. Now: ~13% × 1.
  if (Math.random() < 0.13) {
    spawnConfuseParticles(cx, cy, r, 1);
  }
}

function drawYellowAura() {
  if (!yellowAura || !ctx) return;
  var cx = yellowAura.followPlayer ? player.x : yellowAura.ox;
  var cy = yellowAura.followPlayer ? player.y : yellowAura.oy;
  var r  = yellowAura.baseRadius;
  var pct = yellowAura.timer / yellowAura.duration;
  var a = Math.max(0, Math.min(1, pct)) * 0.55;
  ctx.save();
  // Soft glow
  var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, 'rgba(245, 208, 0, 0)');
  grad.addColorStop(0.6, 'rgba(245, 208, 0, ' + (a * 0.15) + ')');
  grad.addColorStop(1.0, 'rgba(245, 208, 0, ' + (a * 0.35) + ')');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // Pulsing edge ring that doubles as duration indicator.
  var pulseScale = 1 + Math.sin(yellowAura.pulse) * 0.03;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  // Full dim background ring
  ctx.save();
  ctx.strokeStyle = 'rgba(245, 208, 0, ' + (a * 0.25) + ')';
  ctx.beginPath(); ctx.arc(cx, cy, r * pulseScale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // Timer arc (foreground)
  ctx.strokeStyle = 'rgba(245, 208, 0, ' + a + ')';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * pulseScale, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * pct);
  ctx.stroke();
  ctx.restore();
}

function startYellowConfuse(ox, oy, radius) {
  // Retained for drag-to-point instant bursts. Aura behavior now lives in
  // startYellowAura; taps and overloads route through there.
  var mult = tapScaleMult('yellow') * affinityMult('yellow');
  var cx = ox !== undefined ? ox : player.x;
  var cy = oy !== undefined ? oy : player.y;
  var r = radius || scaleDist(300 * mult);
  var hit = 0;
  var isCrit = _currentCrit;
  entities.forEach(function(g) {
    if (Math.hypot(g.x-cx, g.y-cy) <= r) {
      g.confused = true;
      g.confuseTimer = (g.confuseTimer||0) + 2.0 * mult;
      // YELLOW DAZE: drag-burst crit also applies daze.
      if (isCrit) g.dazed = true;
      hit++;
    }
  });
  brickAction = null;
  // Spawn ? particles within radius
  spawnConfuseParticles(cx, cy, r, Math.round((8 + hit * 3) * vScale(1)));
  if (isCrit) {
    spawnCritShockwave(cx, cy, '#F5D000', { r0: 8, maxR: r, thickness: 3, growth: 320 });
    spawnCritFlourish(cx, cy, '#FFEE44', 18);
    spawnCritFlourish(cx, cy, '#FFD700', 10);
  }
}

// ── UPDATE BRICK ACTION ───────────────────────────
function updateBrickAction(dt, bounds) {
  if (!brickAction) return;

  if (brickAction.type === 'red') {
    if (brickAction.phase === 'charge') {
      if (brickAction.usePoint) {
        // Fixed direction toward dropped point
      } else {
        // Track nearest entity
        var nearestG = entities.length ? entities.reduce(function(a,b){return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null;
        if (nearestG) {
          var cdx = nearestG.x - player.x, cdy = nearestG.y - player.y;
          var cdist = Math.sqrt(cdx*cdx+cdy*cdy);
          if (cdist > 1) { brickAction.dirX = cdx/cdist; brickAction.dirY = cdy/cdist; }
        }
      }
      brickAction.chargeTimer = (brickAction.chargeTimer||0) + dt;
      var step = brickAction.chargeSpeed * dt;
      // Wall sweep: test the line segment from current position to the
      // intended next position against each gray wall. If it intersects,
      // clamp the move to the wall's near edge and end the charge. Without
      // this, chargeSpeed (player.speed × 4) can move the player further
      // than wall thickness in one frame, letting them phase clean through.
      var nextX = player.x + brickAction.dirX * step;
      var nextY = player.y + brickAction.dirY * step;
      var blocked = false;
      for (var wi = 0; wi < grayWalls.length && !blocked; wi++) {
        var w = grayWalls[wi];
        if (w.hp <= 0 || w.alpha < 0.05) continue;
        // Skip if player is already inside (e.g. wall expanded around them).
        var startDist = Math.hypot(player.x - w.x, player.y - w.y);
        if (startDist < w.r + player.r) continue;
        // Parametric line-circle intersection along the move vector.
        var fx0 = player.x - w.x, fy0 = player.y - w.y;
        var dxm = brickAction.dirX * step, dym = brickAction.dirY * step;
        var aQ = dxm*dxm + dym*dym;
        var bQ = 2 * (fx0*dxm + fy0*dym);
        var cQ = fx0*fx0 + fy0*fy0 - (w.r + player.r)*(w.r + player.r);
        var disc = bQ*bQ - 4*aQ*cQ;
        if (disc < 0) continue; // no intersection this frame
        var tHit = (-bQ - Math.sqrt(disc)) / (2*aQ);
        if (tHit < 0 || tHit > 1) continue; // intersection is outside this step
        // Stop just before contact, cancel charge.
        var tStop = Math.max(0, tHit - 0.01);
        player.x = player.x + dxm * tStop;
        player.y = player.y + dym * tStop;
        blocked = true;
        brickAction.hit = true; // ends the charge on the next frame
      }
      if (!blocked) {
        player.x = nextX;
        player.y = nextY;
      }
      player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
      player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));
      // Hit check
      if (!brickAction.hit) {
        var hitG = entities.find(function(g){ return Math.hypot(player.x-g.x,player.y-g.y) < player.r+g.r; });
        if (hitG) {
          var rMult = brickAction.dmgMult||1;
          var crit = !!brickAction.isCrit;
          var critMult = crit ? 2.0 : 1.0; // CRUSHING BLOW: 2x damage
          var knockMult = crit ? 2.0 : 1.0; // 2x knockback
          var rDmg = Math.ceil(3 * tapScaleMult('red') * rMult * overloadStackMult(rMult) * affinityMult('red') * critMult);
          var rRes = damageEntity(hitG, rDmg, undefined, 'red'); hitG.flashTimer = 0.3;
          showDamageNumber(hitG.x, hitG.y - 30, rRes.applied, crit ? '#FFAA00' : '#E24B4A', rRes.tier, hitG.x, hitG.y, undefined, rRes.witherBoost, hitG);
          if (crit) {
            // RED flourish: molten gold shockwave ring + dense red particle burst
            spawnCritShockwave(hitG.x, hitG.y, '#FFAA00', { r0: 6, maxR: scaleDist(180), thickness: 4, growth: 320 });
            spawnCritShockwave(hitG.x, hitG.y, '#FF4400', { r0: 10, maxR: scaleDist(140), thickness: 2, growth: 220, fadeRate: 2.6 });
            spawnCritFlourish(hitG.x, hitG.y, '#FFAA00', 24);
          }
          var rBurst = 8 + rMult * 4; // consistent count regardless of vScale
          for (var rbi = 0; rbi < rBurst; rbi++) {
            var rba = Math.random()*Math.PI*2;
            var rbs = (1.5+Math.random())*(30+rMult*15);
            purpleParticles.push({ x:hitG.x, y:hitG.y,
              vx:Math.cos(rba)*rbs, vy:Math.sin(rba)*rbs,
              r:3+rMult+Math.random()*3, alpha:0.9, color:'#ff3300' });
          }
          var kx = hitG.x - player.x, ky = hitG.y - player.y;
          var kd = Math.sqrt(kx*kx+ky*ky)||1;
          hitG.bounceVx = (kx/kd)*300*knockMult; hitG.bounceVy = (ky/kd)*300*knockMult;
          hitG.bounceTimer = 0.35; hitG.state = 'bounce';
          brickAction.hit = true;
          triggerVictory();
          // Reverse red particles to stream back toward player origin
          var _rdx = brickAction.startX - hitG.x, _rdy = brickAction.startY - hitG.y;
          var _rd = Math.sqrt(_rdx*_rdx+_rdy*_rdy)||1;
          // Log before clear
          var _before = purpleParticles.map(function(p){return p.color+':'+(p.isRed?'isRed':'noFlag')+'@'+Math.round(p.x)+','+Math.round(p.y);});
          purpleParticles = purpleParticles.filter(function(p){ return p.color !== '#ff3300' && !p.isRed; });
          // Spawn trail particles behind player (opposite to charge direction)
          // Store return trail state on brickAction — emits particles each frame during return
          brickAction._trailRMult = rMult;
          brickAction.phase = 'return';
          brickAction.returnTimer = 0;
        }
      }
      // Stop charge after 2s timeout OR reaching drag target — no return unless hit enemy
      if (brickAction.chargeTimer >= 2.0) {
        brickAction = null;
      } else if (brickAction.usePoint) {
        var ptDist = Math.hypot(player.x - brickAction.targetX, player.y - brickAction.targetY);
        if (ptDist < player.r + 8) {
          brickAction = null;
        }
      }
    } else {
      // Return toward start — emit trail particles behind player
      if (player && brickAction._trailRMult !== undefined) {
        var _rMult2 = brickAction._trailRMult;
        var _ba2 = Math.atan2(-brickAction.dirY, -brickAction.dirX); // opposite to charge = behind
        for (var _ei = 0; _ei < 2; _ei++) {
          var _ea = _ba2 + (Math.random()-0.5)*1.2;
          var _es = 30 + Math.random()*50;
          purpleParticles.push({
            x: player.x + Math.cos(_ea)*(player.r*0.6),
            y: player.y + Math.sin(_ea)*(player.r*0.6),
            vx: Math.cos(_ea)*_es, vy: Math.sin(_ea)*_es,
            r: 2 + Math.random()*_rMult2, alpha: 0.8,
            color: '#ff3300', isRed: true,
          });
        }
      }
      var rx = brickAction.startX - player.x;
      var ry = brickAction.startY - player.y;
      var rd = Math.sqrt(rx*rx+ry*ry);
      var nearestForReturn = entities.length ? entities[0] : null;
      var safeStop = nearestForReturn ? nearestForReturn.AGGRO_RANGE * 1.5 : 0;
      var distToEntity = nearestForReturn ? Math.hypot(player.x-nearestForReturn.x, player.y-nearestForReturn.y) : 9999;
      brickAction.returnTimer = (brickAction.returnTimer||0) + dt;
      if (distToEntity >= safeStop || rd <= 8 || brickAction.returnTimer >= 3.0) {
        brickAction = null; // always terminates within 3s
      } else {
        var rs = Math.min(brickAction.returnSpeed * dt, rd);
        player.x += (rx/rd)*rs;
        player.y += (ry/rd)*rs;
      }
    }
  }

}


// ── UPDATE ENTITY CONFUSION ───────────────────────
function updateEntityConfusion(g, dt) {
  if (!g.confused) return;
  g.confuseTimer -= dt;
  if (g.confuseTimer <= 0) {
    g.confused = false;
    g.confuseTimer = 0;
    g.dazed = false; // YELLOW DAZE ends with confuse
    return;
  }
  // Move randomly while confused
  if (!g.confuseDashTimer || g.confuseDashTimer <= 0) {
    var ca = Math.random() * Math.PI * 2;
    g.confuseDirX = Math.cos(ca);
    g.confuseDirY = Math.sin(ca);
    g.confuseDashTimer = 0.3 + Math.random() * 0.3;
  }
  g.confuseDashTimer -= dt;
}

// ═══════════════════════════════════════════════════
// BLUE — Homing Bolt
// ═══════════════════════════════════════════════════
var blueBolts = [];

function startBlueBolt(lockedTarget) {
  var target = lockedTarget || (entities.length ? entities.reduce(function(a,b){return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null);
  if (!target || !player) return;
  // BLUE CRUSHING STRIKE: crit doubles damage (matches red/gray/purple).
  var bcritTap = _currentCrit ? 2.0 : 1.0;
  blueBolts.push({ x: player.x, y: player.y, target: target, speed: 500, dmg: Math.ceil(4 * tapScaleMult('blue') * affinityMult('blue') * bcritTap), r: 7, dead: false, travelled: 0, tier: 1, glow: 0, delayTimer: 0, isCrit: _currentCrit });
}

// Blue drag-drop variant: fires a bolt at a fixed world-space point.
// On arrival the bolt performs an AoE impact that damages any entity within
// the impact radius. Dropping on empty rumble area causes a visible impact effect
// but deals no damage (no entities in range). Used for positioning /
// area-denial casts instead of always homing on the nearest entity.
function startBlueBoltAtPoint(tx, ty) {
  if (!player) return;
  // BLUE CRUSHING STRIKE: crit doubles damage.
  var bcritAP = _currentCrit ? 2.0 : 1.0;
  blueBolts.push({
    x: player.x, y: player.y,
    target: null, fixedPoint: true,
    targetX: tx, targetY: ty,
    speed: 500,
    dmg: Math.ceil(4 * tapScaleMult('blue') * affinityMult('blue') * bcritAP),
    // Impact radius for drag-drop fire: modest AoE so dropping near a goblin
    // still connects. Scales with display (scaleDist). Snapstep-tight enough
    // that you have to aim, wide enough to be useful.
    impactR: scaleDist(42),
    r: 7, dead: false, travelled: 0, tier: 1, glow: 0, delayTimer: 0,
    isCrit: _currentCrit,
  });
}

function updateBlueBolts(dt, bounds) {
  blueBolts = blueBolts.filter(function(b) { return !b.dead; });
  blueBolts.forEach(function(b) {
    if (b.dead) return;
    if (b.delayTimer > 0) { b.delayTimer -= dt; return; } // staggered launch
    // Fixed-point bolts navigate to targetX/targetY regardless of entities.
    // Homing bolts require a live target; if target dies mid-flight the bolt
    // dies (legacy behavior).
    if (!b.fixedPoint && (!b.target || b.target.hp <= 0)) { b.dead = true; return; }
    var tx, ty;
    if (b.fixedPoint) { tx = b.targetX; ty = b.targetY; }
    else              { tx = b.target.x; ty = b.target.y; }
    var dx = tx - b.x, dy = ty - b.y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    var step = b.speed * dt;
    b.x += (dx/dist) * step;
    b.y += (dy/dist) * step;
    b.travelled = (b.travelled||0) + step;
    // Spawn healing-style trail particles
    var tier = b.tier || 1;
    var trailCount = Math.max(1, Math.round(Math.ceil(tier * 0.25) * vScale(tier)));
    for (var ti = 0; ti < trailCount; ti++) {
      var trailColor = tier >= 4 ? '#1a8fff' : tier >= 3 ? '#2299ff' : tier >= 2 ? '#2299ff' : '#4db8ff';
      playerSparkles.push({
        ox: b.x - player.x + (Math.random()-0.5)*b.r,
        oy: b.y - player.y + (Math.random()-0.5)*b.r,
        vox: (Math.random()-0.5)*0.4,
        voy: (Math.random()-0.5)*0.4 - 0.1,
        text: tier >= 3 ? '✦' : '✧',
        color: trailColor,
        size: 2 + tier * 0.4 + Math.random(),
        alpha: 0.7 + Math.random()*0.3,
        life: 1,
        fixed: true, // don't follow player
        fx: b.x + (Math.random()-0.5)*b.r,
        fy: b.y + (Math.random()-0.5)*b.r,
      });
    }
    // Fixed-point bolt arrival: reached the drop location. AoE damage any
    // entity within impact radius; always leaves a visible burst even on
    // empty ground.
    if (b.fixedPoint && b.travelled > 30 && dist < b.r + 6) {
      var impactR = b.impactR || scaleDist(42);
      var ix = b.targetX, iy = b.targetY;
      var primaryHit = null;
      entities.forEach(function(ent) {
        if (ent.hp <= 0) return;
        if (Math.hypot(ent.x - ix, ent.y - iy) <= impactR + ent.r) {
          var fpRes = damageEntity(ent, b.dmg, undefined, 'blue');
          ent.flashTimer = 0.2;
          showDamageNumber(ent.x, ent.y - 30, fpRes.applied, '#4db8ff', fpRes.tier, ent.x, ent.y, undefined, fpRes.witherBoost, ent);
          if (b.isCrit && !primaryHit) {
            primaryHit = ent;
            ent.markedTimer = 3.0;
          }
        }
      });
      if (b.isCrit) {
        spawnCritShockwave(ix, iy, '#4db8ff', { r0: 8, maxR: scaleDist(140), thickness: 3, growth: 280 });
        spawnCritFlourish(ix, iy, '#6fb8ff', 14);
        spawnCritFlourish(ix, iy, '#a0dfff', 10);
      }
      // Impact burst at drop point regardless of hit
      var tierFP = b.tier || 1;
      var burstCountFP = Math.max(1, Math.round((2 + Math.ceil(tierFP * 1.25)) * vScale(tierFP)));
      for (var fpi = 0; fpi < burstCountFP; fpi++) {
        var fpa = Math.random() * Math.PI * 2;
        var fps = (1 + Math.random()) * (8 + tierFP * 5);
        purpleParticles.push({
          x: ix, y: iy,
          vx: Math.cos(fpa)*fps, vy: Math.sin(fpa)*fps,
          r: 1 + tierFP * 0.5 + Math.random() * 1.5,
          alpha: 0.9, color: '#4db8ff',
        });
      }
      b.dead = true;
      triggerVictory();
      return;
    }
    // Require minimum travel before hit registers
    if (!b.fixedPoint && b.travelled > 30 && dist < b.r + b.target.r) {
      var bRes = damageEntity(b.target, b.dmg, undefined, 'blue');
      b.target.flashTimer = 0.2;
      showDamageNumber(b.target.x, b.target.y - 30, bRes.applied, '#4db8ff', bRes.tier, b.target.x, b.target.y, undefined, bRes.witherBoost, b.target);
      // BLUE MARK: on crit, mark target to take +50% damage from all sources for 3s.
      if (b.isCrit) {
        b.target.markedTimer = 3.0;
        // BLUE flourish: cyan shockwave + rainbow-ish halo burst
        spawnCritShockwave(b.target.x, b.target.y, '#4db8ff', { r0: 8, maxR: scaleDist(140), thickness: 3, growth: 280 });
        spawnCritFlourish(b.target.x, b.target.y, '#6fb8ff', 14);
        spawnCritFlourish(b.target.x, b.target.y, '#a0dfff', 10);
      }
      // Overload impact burst: damage entities near the target (primary target
      // excluded since it already took full dmg). burstRadius/burstDmg only set
      // on overload bolts, so tap-blue impacts act as before.
      if (b.burstRadius && b.burstDmg) {
        entities.forEach(function(other) {
          if (other === b.target || other.hp <= 0) return;
          if (Math.hypot(other.x - b.target.x, other.y - b.target.y) <= b.burstRadius) {
            var burstRes = damageEntity(other, b.burstDmg, undefined, 'blue');
            other.flashTimer = 0.2;
            showDamageNumber(other.x, other.y - 30, burstRes.applied, '#6fb8ff', burstRes.tier, other.x, other.y, undefined, burstRes.witherBoost, other);
          }
        });
      }
      // Impact burst scaled by tier
      var tier = b.tier || 1;
      var burstCount = Math.max(1, Math.round((2 + Math.ceil(tier * 1.25)) * vScale(tier)));
      var cImpact = '#4db8ff';
      for (var bi = 0; bi < burstCount; bi++) {
        var ba = Math.random() * Math.PI * 2;
        var bs = (1 + Math.random()) * (8 + tier * 5);
        purpleParticles.push({
          x: b.target.x, y: b.target.y,
          vx: Math.cos(ba)*bs, vy: Math.sin(ba)*bs,
          r: 1 + tier * 0.5 + Math.random() * 1.5,
          alpha: 0.9, color: cImpact,
        });
      }
      b.dead = true;
      if (b.target.hp <= 0) triggerVictory();
      return;
    }
    if (b.x < bounds.x || b.x > bounds.x+bounds.w || b.y < bounds.y || b.y > bounds.y+bounds.h) b.dead = true;
  });
}

function drawBlueBolts() {
  var now = performance.now();
  blueBolts.forEach(function(b) {
    if (b.delayTimer > 0) return;
    var tier = b.tier || 1;
    // All blue — deepen with tier
    var hue = 210 + tier * 4;
    var coreColor = 'hsl(' + hue + ',100%,' + Math.max(45, 65 - tier * 4) + '%)';
    var glowColor = 'hsl(' + hue + ',100%,60%)';
    // Flicker — oscillate radius and alpha slightly
    var flicker = 0.9 + 0.1 * Math.sin(now * 0.02 + b.x);
    var flickerR = b.r * flicker;
    ctx.save();
    // Outer energy rings
    for (var ri = Math.max(1, Math.round(Math.ceil(tier*0.25)*vScale(tier))); ri > 0; ri--) {
      ctx.globalAlpha = (0.02 + 0.01 * Math.sin(now * 0.015 + ri)) * ri * vScale(tier);
      ctx.fillStyle = glowColor;
      ctx.beginPath(); ctx.arc(b.x, b.y, flickerR * (1 + ri * 0.5), 0, Math.PI*2); ctx.fill();
    }
    // Core
    ctx.globalAlpha = flicker;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = (6 + tier * 3) * flicker * vScale(tier);
    ctx.fillStyle = coreColor;
    ctx.beginPath(); ctx.arc(b.x, b.y, flickerR, 0, Math.PI*2); ctx.fill();
    // Bright blue center — not white
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'hsl(' + hue + ',80%,85%)';
    ctx.globalAlpha = flicker * 0.8;
    ctx.beginPath(); ctx.arc(b.x, b.y, flickerR * 0.3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function drawDragIndicator(dragPos, color, label) {
  if (!dragPos || !player) return;
  var rect = canvas.getBoundingClientRect();
  // Only draw if pointer is actually over the canvas
  if (dragPos.x < rect.left || dragPos.x > rect.right || dragPos.y < rect.top || dragPos.y > rect.bottom) return;
  var cx = (dragPos.x - rect.left) * (canvas.width / rect.width);
  var cy = (dragPos.y - rect.top) * (canvas.height / rect.height);
  ctx.save();
  ctx.setLineDash([5,5]); ctx.strokeStyle = color+'88'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

function drawBlueDrag() {
  if (!blueDragActive || !blueDragPos || !player) return;
  var rect = canvas.getBoundingClientRect();
  var cx = (blueDragPos.x - rect.left) * (canvas.width / rect.width);
  var cy = (blueDragPos.y - rect.top) * (canvas.height / rect.height);
  ctx.save();
  ctx.setLineDash([5,5]); ctx.strokeStyle = '#4db8ff88'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.setLineDash([]);
  // Indicator radius matches startBlueBoltAtPoint's impactR (scaleDist(42))
  // so players can see the actual AoE they're dropping into.
  var impactR = scaleDist(42);
  var onTarget = entities.some(function(g){return Math.hypot(cx-g.x,cy-g.y)<g.r+impactR;});
  ctx.strokeStyle = onTarget ? '#4db8ff' : '#4db8ff66'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, impactR, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// ORANGE — Trap
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// YELLOW — Confuse Particles
// ═══════════════════════════════════════════════════
var confuseParticles = [];

function spawnConfuseParticles(cx, cy, radius, count) {
  for (var i = 0; i < count; i++) {
    var angle = Math.random() * Math.PI * 2;
    var r = Math.random() * radius;
    confuseParticles.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 30,
      vy: -(20 + Math.random() * 40),
      size: 10 + Math.random() * 16,
      alpha: 0.9 + Math.random() * 0.1,
      fadeRate: 0.025 + Math.random() * 0.02,
    });
  }
}

function updateConfuseParticles(dt) {
  confuseParticles = confuseParticles.filter(function(p) { return p.alpha > 0.05; });
  confuseParticles.forEach(function(p) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 10 * dt; // gentle gravity
    p.alpha -= p.fadeRate;
    p.size *= 1.008; // grow slightly as they rise
  });
}

function drawConfuseParticles() {
  confuseParticles.forEach(function(p) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = '#F5D000';
    ctx.shadowColor = '#F5D000';
    ctx.shadowBlur = 8 * p.alpha;
    ctx.font = 'bold ' + Math.round(p.size) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', p.x, p.y);
    ctx.restore();
  });
}

var traps = [];
var orangeAura = null;

// Bleed tracking
var bleeds = []; // { target, dmg, timer, tick }

function spawnSpikeTrap(x, y, r, initialDmg, sealed, isCrit) {
  // sealed=true means trap immediately snaps (used for aura/drag at placement)
  // isCrit=true flags ORANGE SHRAPNEL: detonation hits AoE radius instead of single target.
  var t = {
    x: x, y: y, r: r,
    triggered: false, sealed: sealed||false,
    snapTimer: 0, SNAP: 0.3,  // snap animation duration
    holdTimer: 0, HOLD_DURATION: 1.5,
    initialDmg: initialDmg || 2,
    pulse: 0, done: false, target: null,
    spikeAngle: Math.random() * Math.PI * 2,
    isCrit: !!isCrit,
    // if sealed, trap contains already-caught entities
    caughtEntities: [],
  };
  if (sealed) {
    // Catch entities within radius immediately
    entities.forEach(function(g) {
      if (Math.hypot(g.x-x, g.y-y) < r + g.r) {
        t.caughtEntities.push(g);
        t.triggered = true;
        t.holdTimer = t.HOLD_DURATION;
        var tRes = damageEntity(g, t.initialDmg, false, 'orange');
        showDamageNumber(g.x, g.y-30, tRes.applied, '#ff6600', tRes.tier, g.x, g.y, undefined, tRes.witherBoost, g);
      }
    });
    // ORANGE SHRAPNEL: on crit sealed-trap placement, also hit anyone in a
    // wider AoE around the trap center (1.8x radius).
    if (isCrit) {
      var aoeR = r * 1.8;
      entities.forEach(function(g) {
        // Skip already-caught entities so we don't double-hit them
        if (t.caughtEntities.indexOf(g) >= 0) return;
        if (Math.hypot(g.x-x, g.y-y) < aoeR + g.r) {
          var sRes = damageEntity(g, t.initialDmg, true, 'orange');
          g.flashTimer = 0.2;
          showDamageNumber(g.x, g.y-30, sRes.applied, '#ff9933', sRes.tier, g.x, g.y, undefined, sRes.witherBoost, g);
        }
      });
      spawnCritShockwave(x, y, '#F57C00', { r0: 10, maxR: aoeR, thickness: 4, growth: 360 });
      spawnCritFlourish(x, y, '#FF9933', 22);
      spawnCritFlourish(x, y, '#FFC080', 14);
    }
    // BUGFIX (0.14.3): sealed traps fire damage on spawn. If this kills the
    // last entity, no hit path will follow up to call triggerVictory. Same
    // hang pattern as the unsealed-trap trigger site below.
    triggerVictory();
  }
  traps.push(t);
}

function startOrangeTrap(ox, oy, tier) {
  var tap = tapScaleMult('orange');
  var aff = affinityMult('orange');           // for damage
  var affR = affinityRadiusMult('orange');    // for radius
  var mult = tap * aff;
  var multR = tap * affR;
  var crit = _currentCrit;
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40);
  if (isDrag) {
    var tr = (25 + (tier||1) * 15) * multR;
    var dmg = Math.max(1, Math.ceil((1 + (tier||1)) * mult));
    spawnSpikeTrap(ox, oy, tr, dmg, true, crit);
  } else {
    // Tap — just place small trap at feet
    spawnSpikeTrap(player.x, player.y, 20 * multR, Math.max(1, Math.round(2 * mult)), false, crit);
  }
}

function fireOverloadOrangeScatter(count, ox, oy) {
  var tap = tapScaleMult('orange');
  var aff = affinityMult('orange');           // for damage
  var affR = affinityRadiusMult('orange');    // for radius
  var stack = overloadStackMult(count);
  var tr = (25 + count * 15) * tap * affR * stack;
  var dmg = Math.max(1, Math.ceil((1 + count) * tap * aff * stack));
  spawnSpikeTrap(ox, oy, tr, dmg, true, _currentCrit);
}

function applyBleed(g, dmg, tier) {
  var bleedDmg = Math.max(1, Math.floor(dmg * 0.5));
  var duration = 3.0 * Math.pow(1.25, (tier || 1) - 1) * tapScaleMult('orange') * affinityMult('orange');
  bleeds.push({ target: g, dmg: bleedDmg, timer: duration, tick: 0 });
}

function updateBleeds(dt) {
  bleeds = bleeds.filter(function(b) { return b.timer > 0 && b.target && b.target.hp > 0; });
  bleeds.forEach(function(b) {
    b.timer -= dt;
    b.tick += dt;
    if (b.tick >= 1.0) {
      b.tick -= 1.0;
      var bRes2 = damageEntity(b.target, b.dmg, false, 'orange');
      showDamageNumber(b.target.x, b.target.y-20, bRes2.applied, '#cc2200', bRes2.tier, b.target.x, b.target.y, '🩸', bRes2.witherBoost, b.target);
      triggerVictory();
    }
  });
}

function updateTraps(dt) {
  // Aura
  if (orangeAura) {
    orangeAura.pulse = (orangeAura.pulse + dt*4) % (Math.PI*2);
    entities.forEach(function(g) {
      // orangeAura can be nulled mid-loop when charges hit 0; guard each iter.
      if (!orangeAura) return;
      if (Math.hypot(g.x-player.x, g.y-player.y) < orangeAura.r + g.r) {
        if (!g._auraTrap) {
          g._auraTrap = true;
          orangeAura.charges--;
          spawnSpikeTrap(g.x, g.y, 20, 2, true);
          if (orangeAura.charges <= 0) orangeAura = null;
        }
      } else { g._auraTrap = false; }
    });
  }

  traps = traps.filter(function(t) { return !t.done; });
  traps.forEach(function(t) {
    t.pulse = (t.pulse + dt*3) % (Math.PI*2);

    if (t.triggered) {
      // Snap animation
      if (t.snapTimer < t.SNAP) t.snapTimer += dt;
      t.holdTimer -= dt;
      if (t.holdTimer <= 0) {
        // Release — apply bleed to caught entities
        var bTier = Math.max(1, t.initialDmg - 1);
        t.caughtEntities.forEach(function(g) {
          applyBleed(g, t.initialDmg, bTier);
        });
        t.done = true;
        return;
      }
      // Hold caught entities in place — no movement at all while snared.
      // Prior behavior pulled them toward trap center (0.08 interp each
      // frame), which looked like the trap was sucking them in. Snares
      // read better as "feet are stuck" — entity stays exactly where it
      // was caught until the hold expires.
      t.caughtEntities.forEach(function(g) {
        g.bounceVx=0; g.bounceVy=0; g.bounceTimer=0.05; g.state='bounce';
      });
    } else {
      // Waiting — detect entity
      entities.forEach(function(g) {
        if (!t.triggered && Math.hypot(g.x-t.x,g.y-t.y)<t.r+g.r) {
          t.triggered = true;
          t.holdTimer = t.HOLD_DURATION;
          t.caughtEntities = [g];
          var uRes = damageEntity(g, t.initialDmg, false, 'orange');
          showDamageNumber(g.x, g.y-30, uRes.applied, '#ff6600', uRes.tier, g.x, g.y, undefined, uRes.witherBoost, g);
          // ORANGE SHRAPNEL: on crit unsealed-trap trigger, detonate AoE.
          if (t.isCrit) {
            var aoeR2 = t.r * 1.8;
            entities.forEach(function(other) {
              if (other === g) return;
              if (Math.hypot(other.x-t.x, other.y-t.y) < aoeR2 + other.r) {
                var shRes = damageEntity(other, t.initialDmg, true, 'orange');
                other.flashTimer = 0.2;
                showDamageNumber(other.x, other.y-30, shRes.applied, '#ff9933', shRes.tier, other.x, other.y, undefined, shRes.witherBoost, other);
              }
            });
            spawnCritShockwave(t.x, t.y, '#F57C00', { r0: 8, maxR: aoeR2, thickness: 4, growth: 340 });
            spawnCritFlourish(t.x, t.y, '#FF9933', 20);
            spawnCritFlourish(t.x, t.y, '#FFC080', 12);
          }
          // BUGFIX: trap damage can be the killing blow on the last entity.
          // Without this, damage applies but no callsite invokes triggerVictory
          // until another hit occurs — which may never happen if this was the
          // last enemy. The battle hangs: no victory screen, no loot, traps
          // remain rendered. Bleeds already handle this at line ~6636.
          triggerVictory();
        }
      });
    }
  });

  updateBleeds(dt);
}

function drawSpike(ctx, x, y, r, angle, alpha, color) {
  var spikes = 6;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.translate(x, y);
  ctx.rotate(angle);
  for (var i=0; i<spikes; i++) {
    var a = (i/spikes)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
    ctx.lineTo(Math.cos(a+0.2)*r*0.4, Math.sin(a+0.2)*r*0.4);
    ctx.lineTo(Math.cos(a-0.2)*r*0.4, Math.sin(a-0.2)*r*0.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTraps() {
  if (orangeAura) {
    ctx.save();
    var p = Math.sin(orangeAura.pulse)*0.3+0.7;
    ctx.globalAlpha = p*0.5; ctx.strokeStyle='#F57C00';
    ctx.shadowColor='#F57C00'; ctx.shadowBlur=16; ctx.lineWidth=2;
    ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.arc(player.x,player.y,orangeAura.r,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    for (var i=0;i<orangeAura.charges;i++){
      var a=(i/Math.max(1,orangeAura.charges))*Math.PI*2-Math.PI/2;
      ctx.globalAlpha=0.9; ctx.fillStyle='#F57C00';
      ctx.beginPath(); ctx.arc(player.x+Math.cos(a)*(orangeAura.r+8),player.y+Math.sin(a)*(orangeAura.r+8),4,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  traps.forEach(function(t) {
    var snapPct = t.triggered ? Math.min(1, t.snapTimer/t.SNAP) : 0;
    var color = t.triggered ? '#ff3300' : '#F57C00';
    ctx.save();

    if (!t.triggered) {
      // Dormant — subtle spike hints at ground level
      ctx.globalAlpha = 0.3 + Math.sin(t.pulse)*0.1;
      drawSpike(ctx, t.x, t.y, t.r*0.5, t.spikeAngle, 0.4, '#F57C00');
      // Trigger radius ring
      ctx.globalAlpha = 0.2 + Math.sin(t.pulse)*0.1;
      ctx.strokeStyle = '#F57C0066'; ctx.lineWidth=1;
      ctx.setLineDash([3,5]);
      ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Triggered — spikes shoot up
      var spikeR = t.r * (0.3 + 0.7 * snapPct);
      ctx.globalAlpha = 0.9;
      drawSpike(ctx, t.x, t.y, spikeR, t.spikeAngle, 1, color);
      drawSpike(ctx, t.x, t.y, spikeR*0.7, t.spikeAngle + Math.PI/6, 0.6, '#ffaa00');
      // Hold timer — shrinking arc around the trap edge, matching field style
      var pct = t.holdTimer/t.HOLD_DURATION;
      pct = Math.max(0, Math.min(1, pct));
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 6, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r + 6, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * pct);
      ctx.stroke();
    }
    ctx.restore();
  });
}

// ═══════════════════════════════════════════════════
// GRAY — Armor
// ═══════════════════════════════════════════════════
var armorBursts = [];
var grayWalls = []; // drag-placed walls

function startGrayArmor(targetX, targetY, tier) {
  var isDrag = targetX !== undefined && Math.hypot(targetX-player.x, targetY-player.y) > scaleDist(40);
  if (isDrag) {
    startGrayWall(targetX, targetY, tier || 1);
  } else {
    var aMax = getArmorMax();
    // Base: 1 armor pip per gray brick, scaled by affinity and inventory.
    // GRAY REINFORCE: crit doubles the pip count.
    var critMult = _currentCrit ? 2.0 : 1.0;
    var pips = Math.max(1, Math.ceil(1 * tapScaleMult('gray') * affinityMult('gray') * critMult));
    player.armor = Math.min(aMax, (player.armor||0) + pips);
    if (_currentCrit) {
      // GRAY flourish: stone-colored shockwave + silvery sparkle burst
      spawnCritShockwave(player.x, player.y, '#CCCCCC', { r0: 8, maxR: scaleDist(140), thickness: 4, growth: 200 });
      spawnCritFlourish(player.x, player.y, '#DDDDDD', 14);
    }
    armorBursts.push({ x: player.x, y: player.y, r: player.r, alpha: 0.8 });
  }
}

function startGrayWall(cx, cy, tier) {
  var tap = tapScaleMult('gray');
  var aff = affinityMult('gray');           // for wall HP
  var affR = affinityRadiusMult('gray');    // for wall radius
  var stack = overloadStackMult(tier);
  // GRAY REINFORCE: wall HP doubles on crit.
  var wcritMult = _currentCrit ? 2.0 : 1.0;
  var maxR = scaleDist((30 + tier * 22) * tap * affR * stack);
  // Cap maxR to 40% of the arena's shorter side so the wall can never
  // fill the arena (which would push the player out of bounds on mobile).
  // The cap is generous enough to let overloads feel big while leaving
  // room for the player to maneuver.
  var _bounds = getRumbleBounds();
  var _arenaMin = Math.min(_bounds.w, _bounds.h);
  var _maxAllowed = Math.max(40, Math.round(_arenaMin * 0.40));
  if (maxR > _maxAllowed) maxR = _maxAllowed;
  var hp = Math.max(1, Math.ceil(4 * tier * tap * aff * stack * wcritMult));
  // Mark which entities start inside — only they get contained
  var containedIds = [];
  entities.forEach(function(g, i) {
    if (Math.hypot(g.x-cx, g.y-cy) < maxR) containedIds.push(i);
  });
  grayWalls.push({
    x: cx, y: cy,
    r: 10, maxR: maxR,
    hp: hp, hpMax: hp,
    expanding: true,
    alpha: 1, pulse: 0,
    containedIds: containedIds,
  });
  if (_currentCrit) {
    spawnCritShockwave(cx, cy, '#CCCCCC', { r0: 12, maxR: maxR, thickness: 4, growth: 280 });
    spawnCritFlourish(cx, cy, '#DDDDDD', 20);
  }
}

function updateGrayWalls(dt) {
  grayWalls = grayWalls.filter(function(w) { return w.alpha > 0.02; });
  grayWalls.forEach(function(w) {
    w.pulse = (w.pulse + dt * 2) % (Math.PI * 2);
    // Expand to maxR
    if (w.expanding) {
      w.r += 200 * dt;
      if (w.r >= w.maxR) { w.r = w.maxR; w.expanding = false; }
    }
    // Fade when dead
    if (w.hp <= 0) {
      w.alpha -= 1.5 * dt;
      return;
    }
    // Block player from entering wall from outside. Previously this only
    // fired when the player was in a narrow boundary band (w.r - player.r
    // to w.r + player.r), which high-speed moves like Red Charge could
    // skip over in a single frame. Now any frame where the player ends up
    // inside the wall circle gets pushed to the outer edge. Walls cage
    // entities only (containedIds); player is always blocked from outside.
    // Player ALSO damages walls on sustained contact — same cooldown model
    // as entity-bump so leaning is deliberate, not accidental. Player tick
    // is faster (0.6s vs entity 2.0s outer-bump) because the player is the
    // active agent: deliberately crashing into a wall is destructive intent,
    // and this gives players a way to escape a containment wall in waves
    // mode without needing an explicit demolish action.
    if (player && w.hp > 0) {
      var pdx = player.x - w.x, pdy = player.y - w.y;
      var pdist = Math.sqrt(pdx*pdx+pdy*pdy) || 1;
      var pEdge = w.r + player.r;
      if (pdist < pEdge) {
        player.x = w.x + (pdx/pdist) * pEdge;
        player.y = w.y + (pdy/pdist) * pEdge;
        // Re-clamp to arena bounds — if the wall push would place player
        // outside the arena (because the wall is large and positioned near
        // the arena edge), the arena clamp wins. Without this the player
        // ends up outside the arena, unable to move back in.
        var _wb = getRumbleBounds();
        player.x = Math.max(_wb.x + player.r, Math.min(_wb.x + _wb.w - player.r, player.x));
        player.y = Math.max(_wb.y + player.r, Math.min(_wb.y + _wb.h - player.r, player.y));
        // Tick wall hp on sustained contact
        w._playerCooldown = (w._playerCooldown || 0) - dt;
        if (w._playerCooldown <= 0) {
          w._playerCooldown = 0.6;
          w.hp = Math.max(0, w.hp - 1);
          w.flashTimer = 0.15;
        }
      } else {
        // Not in contact — let cooldown decay to 0 so re-contact feels responsive
        w._playerCooldown = 0;
      }
    }

    // Push contained entities back inside, damage wall on sustained contact.
    // Also block non-contained entities from entering from outside.
    if (!w._entityCooldowns) w._entityCooldowns = {};
    entities.forEach(function(g, gi) {
      var dx = g.x - w.x, dy = g.y - w.y;
      var dist = Math.sqrt(dx*dx+dy*dy) || 1;
      var isContained = w.containedIds && w.containedIds.indexOf(gi) >= 0;

      if (isContained) {
        // Inside the cage — push toward center if beyond inner edge
        var wallEdge = w.r - g.r;
        if (dist > wallEdge && wallEdge > 0) {
          g.x = w.x + (dx/dist) * wallEdge;
          g.y = w.y + (dy/dist) * wallEdge;
          w._entityCooldowns[gi] = (w._entityCooldowns[gi]||0) - dt;
          if (w._entityCooldowns[gi] <= 0) {
            w._entityCooldowns[gi] = 1.0;
            w.hp = Math.max(0, w.hp - 1);
            w.flashTimer = 0.15;
          }
        } else {
          w._entityCooldowns[gi] = 0;
        }
      } else {
        // Outside the cage — block entry. Push back if approaching the wall
        // from the outer edge. Treat as a solid barrier: entity radius can't
        // cross into the wall circle.
        var outerEdge = w.r + g.r;
        if (dist < outerEdge && dist > 0) {
          g.x = w.x + (dx/dist) * outerEdge;
          g.y = w.y + (dy/dist) * outerEdge;
          // Tiny damage to wall on bump (much less than contained-scrape)
          w._entityCooldowns[gi] = (w._entityCooldowns[gi]||0) - dt;
          if (w._entityCooldowns[gi] <= 0) {
            w._entityCooldowns[gi] = 2.0; // slower decay for outer bumps
            w.hp = Math.max(0, w.hp - 1);
            w.flashTimer = 0.15;
          }
        } else {
          w._entityCooldowns[gi] = 0;
        }
      }
    });
  });
}

function drawGrayWalls() {
  grayWalls.forEach(function(w) {
    ctx.save();
    var hpPct = w.hpMax > 0 ? w.hp / w.hpMax : 0;
    var wallColor = hpPct > 0.5 ? '#AAAAAA' : hpPct > 0.25 ? '#888866' : '#AA6644';
    ctx.globalAlpha = w.alpha * (w.hp <= 0 ? 1 : 0.7 + 0.15 * Math.sin(w.pulse));
    ctx.shadowColor = wallColor;
    ctx.shadowBlur = w.flashTimer > 0 ? 20 : 10;
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = 4 + (w.hp <= 0 ? 0 : 2 * (1 - hpPct));
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    // HP bar
    if (w.hp > 0) {
      var bw = 50, bh = 5;
      ctx.globalAlpha = w.alpha;
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#222'; ctx.fillRect(w.x-bw/2, w.y-w.r-14, bw, bh);
      ctx.fillStyle = wallColor; ctx.fillRect(w.x-bw/2, w.y-w.r-14, bw*hpPct, bh);
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
      ctx.strokeRect(w.x-bw/2, w.y-w.r-14, bw, bh);
    }
    // Segment ticks around ring
    var segs = 8;
    ctx.strokeStyle = wallColor + '66'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
    for (var i=0; i<segs; i++) {
      var a = (i/segs)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(w.x+Math.cos(a)*(w.r-6), w.y+Math.sin(a)*(w.r-6));
      ctx.lineTo(w.x+Math.cos(a)*(w.r+6), w.y+Math.sin(a)*(w.r+6));
      ctx.stroke();
    }
    if (w.flashTimer > 0) w.flashTimer -= 0.016;
    ctx.restore();
  });
}

function updateArmorBursts(dt) {
  armorBursts = armorBursts.filter(function(b) { return b.alpha > 0.02; });
  armorBursts.forEach(function(b) { b.r += 60*dt; b.alpha -= 2.5*dt; });
}

function drawArmorBursts() {
  armorBursts.forEach(function(b) {
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.strokeStyle = '#AAAAAA'; ctx.shadowColor = '#AAAAAA'; ctx.shadowBlur = 12; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  });
}


// ═══════════════════════════════════════════════════
// GREEN — Push Burst + Poison
// ═══════════════════════════════════════════════════
var greenBurst = null;

function startGreenBurst(ox, oy) {
  var x = (ox !== undefined) ? ox : player.x;
  var y = (oy !== undefined) ? oy : player.y;
  var BURST_R = scaleDist(113 * tapScaleMult('green') * affinityRadiusMult('green'));
  if (greenBurst && !greenBurst.done) {
    // Already active — just trigger a new push wave without restarting radius
    greenBurst._poisonedIds = []; // allow re-poison on reuse
    greenBurst._pushIds = [];     // allow re-push
    return;
  }
  greenBurst = { r: 0, maxR: BURST_R, alpha: 1, done: false, _poisonedIds: [], _pushIds: [], ox: x, oy: y };
  greenBurst._poisonMult = 1 * tapScaleMult('green') * affinityMult('green');
  greenBurst._castCount = 1;
  // GREEN NECROSIS: tap crit also sets necrosis flag.
  greenBurst._necrosis = !!_currentCrit;
  // Tap (and release-on-bar) always anchors to the player — aura follows.
  greenBurst._followPlayer = true;
  if (_currentCrit) {
    // GREEN flourish: toxic green shockwave + dense virulent spore burst
    spawnCritShockwave(x, y, '#39d67a', { r0: 8, maxR: BURST_R, thickness: 3, growth: 320 });
    spawnCritFlourish(x, y, '#1D9E75', 20);
    spawnCritFlourish(x, y, '#7ce39a', 14);
  }
}

function updateGreenBurst(dt) {
  if (!greenBurst || greenBurst.done) return;
  // Follow player: on-player casts re-anchor the burst origin to player.
  // Drag-placed casts keep their original ox/oy so the ring expands from
  // the drop point.
  if (greenBurst._followPlayer && player) {
    greenBurst.ox = player.x;
    greenBurst.oy = player.y;
  }
  // Expansion speed: slowed from 600 to 360 px/s for more readable ring
  // travel. Slow field duration inside the expanding burst is enforced by
  // the greenSlowed refresh below; poison still applies once per entity.
  greenBurst.r += 360 * dt;
  greenBurst.alpha = Math.max(0, 1 - (greenBurst.r / greenBurst.maxR));

  // Bubble spawns within the expanding ring — rate scales with current area
  // so the field never looks thin. Each field-facing draw iterates the
  // shared bubble pool; see updateGreenBubbles / drawGreenBubbles below.
  _spawnGreenBubbles(
    greenBurst.ox || player.x,
    greenBurst.oy || player.y,
    greenBurst.r,
    dt,
    0.6 // density multiplier
  );

  // Ring acts as solid wall — push all entities
  entities.forEach(function(entity) {
    var gox = greenBurst.ox||player.x, goy = greenBurst.oy||player.y;
    var dx = entity.x - gox, dy = entity.y - goy;
    var dist = Math.sqrt(dx*dx+dy*dy) || 1;
    var gId = entities.indexOf(entity);
    if (!greenBurst._pushIds) greenBurst._pushIds = [];

    // SLOW: while inside the green zone, entities move at reduced speed
    // (see greenSlowMult in updateEntity). Refreshed every frame they're
    // inside; decays after leaving.
    if (dist < greenBurst.maxR) {
      entity.greenSlowed = true;
      entity.greenSlowTimer = 0.25; // refresh window; decays in updateEntity
    }

    // PUSH: when the expanding ring reaches an entity for the first time,
    // fling them outward from the burst center. Duration stays 0.4s — the
    // distance knob is what varies. Prior tuning (60px) felt limp; doubled
    // to 120px base. Crit adds another 60% of that for a meaningful "kicks
    // like a truck" feel on necrosis bursts.
    var pushTriggerRadius = entity.r + 4; // ring "reaches" entity
    if (greenBurst.r >= dist - pushTriggerRadius && greenBurst._pushIds.indexOf(gId) < 0) {
      var nx = dx/dist, ny = dy/dist;
      var basePushDist = 120;
      var critBonus = greenBurst._necrosis ? 1.6 : 1.0;
      var nudgeDist = scaleDist(basePushDist * critBonus);
      var pushVel = nudgeDist / 0.4; // distance / duration
      entity.bounceVx = nx * pushVel;
      entity.bounceVy = ny * pushVel;
      entity.bounceTimer = 0.4;
      entity.state = 'bounce';
      greenBurst._pushIds.push(gId);
    }

    // Poison when ring passes — per-burst tracking so stacking always works
    var distCheck = Math.hypot(entity.x - gox, entity.y - goy);
    if (greenBurst.r >= distCheck - entity.r) {
      if (!greenBurst._poisonedIds) greenBurst._poisonedIds = [];
      if (greenBurst._poisonedIds.indexOf(gId) < 0) {
        entity.poisoned = true;
        // Duration extends by 1s per brick committed to the cast.
        // Tap = 4s, 2-brick = 5s, 5-brick = 8s, 10-brick = 13s.
        var castCount = greenBurst._castCount || 1;
        var castDuration = 3 + castCount;
        entity.poisonTimer = castDuration;
        entity.poisonDuration = castDuration; // remember initial for display
        // GREEN NECROSIS: poison from crit burst doesn't decay (permanent until cleanse/death).
        if (greenBurst._necrosis) {
          entity.poisonNoDecay = true;
        }
        // Linear stack: new applications ADD to existing stack count, so
        // rapid tap-casting genuinely stacks the DoT. Previous behavior
        // (Math.max) capped first tap at 1 and rejected subsequent taps —
        // effectively single-stack poison. Cap at 10 to prevent runaway on
        // high-count overloads combined with tap spam.
        var mult = greenBurst._poisonMult || 1;
        var newStack = Math.max(1, Math.ceil(mult));
        entity.poisonStack = Math.min(10, (entity.poisonStack || 0) + newStack);
        entity.poisonTick = entity.poisonTick || 0;
        greenBurst._poisonedIds.push(gId);
      }
    }
  });

  if (greenBurst.r >= greenBurst.maxR * 1.1) {
    // Burst completes → drop a slow-aura afterimage at the burst perimeter.
    // Any entity that ENTERS (or is inside) during this window gets slowed.
    // Duration: 1.5s base + 0.5s per cast tier (greenBurst._castCount).
    // The afterimage also adds HALF-stack poison to entities that weren't
    // already poisoned by this burst — catches mobs that wander in after
    // the ring passes. Per-field _poisonedIds prevents re-poison from the
    // same afterimage on the same entity.
    var tier = Math.max(1, greenBurst._castCount || 1);
    var auraDur = 1.5 + 0.5 * tier;
    greenSlowAuras.push({
      x: greenBurst.ox || player.x,
      y: greenBurst.oy || player.y,
      r: greenBurst.maxR,
      timer: auraDur,
      duration: auraDur,
      pulse: 0,
      // Field poison: half of the burst's stack count, same cast duration.
      poisonMult: (greenBurst._poisonMult || 1) * 0.5,
      poisonDuration: 3 + (greenBurst._castCount || 1),
      necrosis: !!greenBurst._necrosis,
      // Inherit the burst's poison tracker so entities already hit by the
      // blast aren't poisoned again by the field on the same cast. Field
      // only catches newcomers that wandered in after the ring passed.
      _poisonedIds: (greenBurst._poisonedIds || []).slice(),
      // Inherit follow flag — on-player casts keep the afterimage glued to
      // the player as they move. Drag-placed casts stay planted.
      followPlayer: !!greenBurst._followPlayer,
    });
    greenBurst.done = true;
  }
}

// Afterimage slow fields dropped when a green burst completes. Entities
// inside get refreshed greenSlowed while the field is alive. Purely a lag
// mechanic — does NOT damage or poison on its own.
var greenSlowAuras = [];

function updateGreenSlowAuras(dt) {
  greenSlowAuras = greenSlowAuras.filter(function(a) { return a.timer > 0; });
  greenSlowAuras.forEach(function(a) {
    a.timer -= dt;
    a.pulse = (a.pulse + dt * 2) % (Math.PI * 2);
    var pct = Math.max(0, a.timer / a.duration);
    // Follow player: on-player casts re-anchor the aura to the player each
    // frame. Drag-placed casts keep their original x/y.
    if (a.followPlayer && player) {
      a.x = player.x;
      a.y = player.y;
    }
    // Bubbles spawn inside the afterimage, density fading with remaining
    // duration so the field visibly dies down instead of cutting off.
    _spawnGreenBubbles(a.x, a.y, a.r, dt, 0.35 * pct);
    entities.forEach(function(ent) {
      if (ent.hp <= 0) return;
      var d = Math.hypot(ent.x - a.x, ent.y - a.y);
      if (d < a.r) {
        ent.greenSlowed = true;
        ent.greenSlowTimer = 0.25;
        // Field poison: apply half-stack on first contact with this
        // afterimage. Per-aura tracking (_poisonedIds) means each field
        // poisons a given entity at most once, so standing in an old field
        // is a slow + bleed-out (existing poison ticks) rather than a
        // runaway stack farm. New burst = new field = new poison chance.
        if (a.poisonMult) {
          var eId = entities.indexOf(ent);
          if (a._poisonedIds.indexOf(eId) < 0) {
            a._poisonedIds.push(eId);
            var fieldStack = Math.max(1, Math.ceil(a.poisonMult));
            ent.poisoned = true;
            ent.poisonTimer = a.poisonDuration || 4;
            ent.poisonDuration = a.poisonDuration || 4;
            if (a.necrosis) ent.poisonNoDecay = true;
            ent.poisonStack = Math.min(10, (ent.poisonStack || 0) + fieldStack);
            ent.poisonTick = ent.poisonTick || 0;
            // Field-poison signal: shows the stack count applied by this
            // afterimage contact. Distinct from blast poison (which fires
            // at ring-pass) — this only surfaces when the field catches
            // a newcomer. Reads as "N ☠" on the entity's heal-damage left
            // lane since it's a status-building event, not damage.
            showFloatingText(ent.x, ent.y - 40, fieldStack + ' ☠', '#1D9E75', ent);
          }
        }
      }
    });
  });
}

function drawGreenSlowAuras() {
  if (!ctx) return;
  greenSlowAuras.forEach(function(a) {
    var pct = Math.max(0, Math.min(1, a.timer / a.duration));
    // Pulse as unsigned oscillation so it never drives alpha negative (which
    // was the source of the end-of-duration flicker: sin() going to -0.04
    // cancelled the 0.14*pct fill term once pct approached zero). abs() +
    // pct gate keep the pulse bounded strictly >= 0.
    var pulse = Math.abs(Math.sin(a.pulse)) * 0.04 * pct;
    ctx.save();
    // Dim pulsing fill — visual language: "afterimage"
    ctx.globalAlpha = Math.max(0, 0.14 * pct + pulse);
    ctx.fillStyle = '#1D9E75';
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.fill();
    // Dim background ring (full circumference) — shows the aura's extent.
    ctx.globalAlpha = Math.max(0, 0.18 * pct);
    ctx.strokeStyle = '#39d67a';
    ctx.shadowColor = '#1D9E75'; ctx.shadowBlur = 10;
    ctx.setLineDash([6, 10]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    // Timer arc overlaid on the outer edge — sweeps from 12 o'clock and
    // shrinks as the aura decays. Matches the yellow-aura pattern so the
    // visual vocabulary is consistent across colors.
    ctx.globalAlpha = Math.max(0, 0.7 * pct);
    ctx.strokeStyle = '#7ce39a';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.r, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * pct);
    ctx.stroke();
    ctx.restore();
  });
}

function updateEntityPoison(g, dt) {
  if (!g.poisoned) return;
  // GREEN NECROSIS: poisonNoDecay keeps the timer from running out.
  // Ticks still happen at their normal cadence; they just never stop.
  if (!g.poisonNoDecay) {
    g.poisonTimer -= dt;
    if (g.poisonTimer <= 0) { g.poisoned = false; g.poisonTick = 0; g.poisonStack = 0; return; }
  }
  g.poisonTick = (g.poisonTick||0) + dt;
  if (g.poisonTick >= 1.0) {
    g.poisonTick -= 1.0;
    var poisonDmg = g.poisonStack || 1;
    var pRes = damageEntity(g, poisonDmg, false, 'green');
    g.flashTimer = 0.08;
    showDamageNumber(g.x, g.y-30, pRes.applied, '#1D9E75', pRes.tier, g.x, g.y, '☠', pRes.witherBoost, g);
    triggerVictory();
  }
}

// ── GREEN — Bubble ambient particles ──────────────
// Small bubbles spawn from random points inside any green field (both the
// expanding burst and the afterimage aura). Each zigzags upward via a sine
// oscillation on vx with short vertical bounces, shrinks slightly as it
// rises, and bursts at a random life expiry into a tiny puff. Bubbles are
// purely decorative — no damage, no collision.
var greenBubbles = [];
var _greenBubbleAccum = 0; // fractional spawns carry across frames

function _spawnGreenBubbles(cx, cy, radius, dt, density) {
  if (radius < 8 || density <= 0) return;
  // Spawn rate proportional to area and density knob. Tripled from baseline
  // (0.00025 → 0.00075) for a more carbonated field that reads at a glance.
  var rate = (radius * radius) * 0.00075 * density;
  _greenBubbleAccum += rate * dt;
  while (_greenBubbleAccum >= 1) {
    _greenBubbleAccum -= 1;
    // Uniform sampling inside circle (sqrt for even distribution)
    var ang = Math.random() * Math.PI * 2;
    var dist = Math.sqrt(Math.random()) * radius;
    var bx = cx + Math.cos(ang) * dist;
    var by = cy + Math.sin(ang) * dist;
    // All small. Mixed sizes: 1.2–3.4 px.
    var r = 1.2 + Math.random() * 2.2;
    // Lifespan: random 0.4–1.6s so bursts are staggered, not synchronized.
    var life = 0.4 + Math.random() * 1.2;
    greenBubbles.push({
      x: bx, y: by,
      vx: 0, vy: -(14 + Math.random() * 20), // gentle rise
      r: r,
      life: life, maxLife: life,
      phase: Math.random() * Math.PI * 2, // per-bubble phase offset for zigzag
      amp: 18 + Math.random() * 22,        // horizontal zigzag amplitude (px/s)
      freq: 8 + Math.random() * 6,         // zigzag frequency (tight bounces)
      // Clip-to-field: remember owning center + radius so bubbles don't wander
      // outside the field shape when it's small or asymmetric.
      cx: cx, cy: cy, owningR: radius,
    });
  }
}

function updateGreenBubbles(dt) {
  if (!greenBubbles.length) return;
  var alive = [];
  for (var i = 0; i < greenBubbles.length; i++) {
    var b = greenBubbles[i];
    b.life -= dt;
    if (b.life <= 0) {
      // Pop — emit 3-5 micro-particles spreading outward. Uses the shared
      // purpleParticles pool (despite the name, it's the generic particle bin).
      var puffs = 3 + Math.floor(Math.random() * 3);
      for (var pi = 0; pi < puffs; pi++) {
        var pa = Math.random() * Math.PI * 2;
        var ps = 20 + Math.random() * 35;
        purpleParticles.push({
          x: b.x, y: b.y,
          vx: Math.cos(pa) * ps, vy: Math.sin(pa) * ps - 10,
          r: Math.max(0.6, b.r * 0.5),
          alpha: 0.7, color: '#7ce39a',
        });
      }
      continue; // drop bubble
    }
    // Tight zigzag: sine-wave horizontal velocity, small vertical bounce.
    // phase advances fast (freq) to give the "tight bounces" feel.
    b.phase += dt * b.freq;
    b.vx = Math.sin(b.phase) * b.amp;
    // Vertical bounce: brief upward nudge every ~half cycle.
    var bounce = Math.sin(b.phase * 2) * 6;
    b.x += b.vx * dt;
    b.y += (b.vy - bounce) * dt;
    // Shrink slightly as it rises toward pop.
    var pct = b.life / b.maxLife;
    b.drawR = b.r * (0.6 + 0.4 * pct);
    b.alpha = 0.55 * pct + 0.2;
    alive.push(b);
  }
  greenBubbles = alive;
}

function drawGreenBubbles() {
  if (!ctx || !greenBubbles.length) return;
  for (var i = 0; i < greenBubbles.length; i++) {
    var b = greenBubbles[i];
    ctx.save();
    ctx.globalAlpha = b.alpha;
    // Bubble body — translucent green
    ctx.fillStyle = '#1D9E75';
    ctx.shadowColor = '#7ce39a'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.drawR || b.r, 0, Math.PI * 2); ctx.fill();
    // Highlight dot — small bright spot top-left for "bubble" read
    ctx.shadowBlur = 0;
    ctx.globalAlpha = b.alpha * 0.85;
    ctx.fillStyle = '#c8f5d9';
    var hr = Math.max(0.5, (b.drawR || b.r) * 0.35);
    ctx.beginPath(); ctx.arc(b.x - (b.drawR||b.r)*0.3, b.y - (b.drawR||b.r)*0.3, hr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawGreenBurst() {
  if (!greenBurst || greenBurst.done) return;
  ctx.save();
  // Outer ring
  ctx.globalAlpha = greenBurst.alpha * 0.9;
  ctx.strokeStyle = '#1D9E75';
  ctx.shadowColor = '#1D9E75'; ctx.shadowBlur = 24;
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(greenBurst.ox||player.x, greenBurst.oy||player.y, greenBurst.r, 0, Math.PI*2); ctx.stroke();
  // Inner fill
  ctx.globalAlpha = greenBurst.alpha * 0.12;
  ctx.fillStyle = '#1D9E75';
  ctx.beginPath(); ctx.arc(greenBurst.ox||player.x, greenBurst.oy||player.y, greenBurst.r, 0, Math.PI*2); ctx.fill();
  // Max range indicator ring (shows full reach)
  ctx.globalAlpha = 0.2;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = '#1D9E75';
  ctx.lineWidth = 2; ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(greenBurst.ox||player.x, greenBurst.oy||player.y, greenBurst.maxR, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// PURPLE — Full Rumble Burst
// ═══════════════════════════════════════════════════
var purpleBursts = [];

function startPurpleBurst(ox, oy) {
  var x = (ox !== undefined) ? ox : player.x;
  var y = (oy !== undefined) ? oy : player.y;
  var tap = tapScaleMult('purple');
  var aff = affinityMult('purple');           // for damage
  var affR = affinityRadiusMult('purple');    // for radius
  // Tap is tier I: 237px base. Overload fireOverloadPurple steps through
  // tier II (400px, 2 bricks), III (600px, 3 bricks), IV (900px, 4+ bricks).
  // Tap scaling + affinity still apply but won't cross the tier II threshold
  // since overload is the only way to step up.
  var maxR = scaleDist(237 * tap * affR);
  purpleBursts.push({ r: 0, maxR: maxR, alpha: 1, done: false, hit: false, ox: x, oy: y, dmgMult: tap * aff, isCrit: _currentCrit, purpleTier: 1 });
  if (_currentCrit) {
    // PURPLE flourish: arcane violet shockwave + deep wisp burst
    spawnCritShockwave(x, y, '#7B2FBE', { r0: 12, maxR: maxR, thickness: 4, growth: 340 });
    spawnCritFlourish(x, y, '#9B6FD4', 22);
    spawnCritFlourish(x, y, '#CC99FF', 14);
  }
}

var purpleParticles = [];  // shared across all bursts

function updatePurpleBursts(dt) {
  purpleBursts.forEach(function(purpleBurst) {
  if (purpleBurst.done) return;
  purpleBurst.r += 400 * dt;
  purpleBurst.alpha = Math.max(0, 1 - purpleBurst.r/purpleBurst.maxR);
  // Spawn particles along expanding ring
  var circumference = 2 * Math.PI * purpleBurst.r;
  var count = Math.min(4, Math.floor(circumference / 30));
  for (var i = 0; i < count; i++) {
    var angle = Math.random() * Math.PI * 2;
    purpleParticles.push({
      x: purpleBurst.ox + Math.cos(angle) * purpleBurst.r,
      y: purpleBurst.oy + Math.sin(angle) * purpleBurst.r,
      vx: Math.cos(angle) * (20 + Math.random()*30),
      vy: Math.sin(angle) * (20 + Math.random()*30),
      r: 2 + Math.random() * 3,
      alpha: 0.8 + Math.random() * 0.2,
      color: Math.random() > 0.5 ? '#9B6FD4' : '#ffffff',
    });
  }
  // Hit entity — per-burst tracking so back-to-back bursts each deal damage
  if (!purpleBurst._hitIds) purpleBurst._hitIds = [];
  entities.forEach(function(entity) {
    var gId = entities.indexOf(entity);
    if (purpleBurst._hitIds.indexOf(gId) >= 0) return;
    var dist = Math.hypot(entity.x-purpleBurst.ox, entity.y-purpleBurst.oy);
    if (purpleBurst.r >= dist) {
      var pbRemote = Math.hypot(purpleBurst.ox-player.x, purpleBurst.oy-player.y) > 20;
      var purpleDmg = Math.max(1, Math.ceil(3 * (purpleBurst.dmgMult||1)));
      var prevHp = entity.hp;
      var puRes = damageEntity(entity, purpleDmg, !pbRemote, 'purple'); entity.flashTimer = 0.2;
      var actualDmg = prevHp - entity.hp; // actual damage dealt (may be less if entity low HP)
      showDamageNumber(entity.x, entity.y-30, actualDmg, '#7B2FBE', puRes.tier, entity.x, entity.y, undefined, puRes.witherBoost, entity);

      // PURPLE SILENCE: crit bursts silence entities for 2s (can't attack).
      if (purpleBurst.isCrit) {
        entity.silencedTimer = 2.0;
      }
      purpleBurst._hitIds.push(gId);
      // Purple lifesteal: heal player for 1/3 of damage dealt (rounded up).
      // Routes through applyDrainHeal so HP fills in over a window with the
      // pulsing purple aura — the inverse of bleed. Multiple hits during a
      // burst compound into a single drain (toHp extended). Overheal cap,
      // bleed-rescue routing, stats accounting, and the overheal floater
      // are all handled inside applyDrainHeal / updateDrain.
      var healAmt = Math.ceil(actualDmg / 3);
      if (healAmt > 0) applyDrainHeal(healAmt);
      triggerVictory();
    }
  });
  if (purpleBurst.r >= purpleBurst.maxR) purpleBurst.done = true;
  });
  purpleBursts = purpleBursts.filter(function(p) { return !p.done; });
}

function updatePurpleParticles(dt) {
  purpleParticles = purpleParticles.filter(function(p) { return p.alpha > 0.05; });
  purpleParticles.forEach(function(p) {
    if (p.isFizzle) {
      // Erratic "dink" fizzle: fast decay + random velocity perturbation
      // per frame → reads as a twitchy metallic particle burst, not smooth
      // drift. Gravity droop pulls embers down as they die.
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Random jitter on velocity each frame — this is what makes it erratic
      var j = (p.jitter || 80) * dt;
      p.vx += (Math.random() - 0.5) * j * 2;
      p.vy += (Math.random() - 0.5) * j * 2;
      // Minimal friction — we want particles to keep their erratic motion
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.vy += (p.droop || 30) * dt;       // droop downward while fizzling
      p.alpha -= p.fadeRate * 60 * dt;
    } else if (p.isRed) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.95; p.vy *= 0.95;
      p.alpha -= 1.2 * dt;
    } else if (p.fadeRate !== undefined) {
      // Per-particle fade (non-fizzle) — honor supplied rate
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.alpha -= p.fadeRate * 60 * dt;
    } else {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.alpha -= 1.8 * dt;
    }
  });
}

function drawPurpleBursts() {
  purpleBursts.forEach(function(purpleBurst) {
  if (purpleBurst.done) return;
  ctx.save();
  ctx.globalAlpha = purpleBurst.alpha * 0.6;
  ctx.strokeStyle = '#9B6FD4';
  ctx.shadowColor = '#7B2FBE'; ctx.shadowBlur = 20;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(purpleBurst.ox, purpleBurst.oy, purpleBurst.r, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  });
  // Particles
  purpleParticles.forEach(function(p) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    // Per-particle shadow color (for fizzle sparks) or default purple bloom
    ctx.shadowColor = p.shadowColor || '#7B2FBE';
    ctx.shadowBlur = 8 * p.alpha;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function startBlackEffect(ox, oy) {
  var x = (ox !== undefined) ? ox : player.x;
  var y = (oy !== undefined) ? oy : player.y;
  var mult = tapScaleMult('black') * affinityMult('black');
  var crit = !!_currentCrit;
  if (blackEffect) {
    // Already active — expand radius by 1.3x, reset timer, shift origin toward new cast
    blackEffect.RADIUS = Math.min(blackEffect.RADIUS * 1.3, scaleDist(900 * mult));
    blackEffect.timer = blackEffect.DURATION;
    blackEffect.ox = (blackEffect.ox + x) / 2;
    blackEffect.oy = (blackEffect.oy + y) / 2;
    if (crit) blackEffect.isCrit = true;
  } else {
    blackEffect = { timer: 3.0 * mult, DURATION: 3.0 * mult, tickTimer: 0, TICK: 0.5, alpha: 0,
      FADE_IN: 0.8, FADE_OUT: 0.8, ox: x, oy: y, RADIUS: scaleDist(50 * mult), tickDmg: Math.max(1, Math.ceil(1 * mult)), isCrit: crit };
  }
  if (crit) {
    // BLACK flourish: dark violet shockwave + void particle burst
    spawnCritShockwave(x, y, '#552288', { r0: 10, maxR: blackEffect.RADIUS, thickness: 4, growth: 260 });
    spawnCritShockwave(x, y, '#BB88FF', { r0: 14, maxR: blackEffect.RADIUS * 0.8, thickness: 2, growth: 220 });
    spawnCritFlourish(x, y, '#7744AA', 22);
    spawnCritFlourish(x, y, '#333333', 16);
  }
  entities.forEach(function(g) {
    if (Math.hypot(g.x-x, g.y-y) < blackEffect.RADIUS) { g.attackSlowed = true; g.attackSlowTimer = 3.0; }
  });
}

function updateBlackEffect(dt) {
  if (!blackEffect) return;
  blackEffect.timer -= dt;
  var elapsed = blackEffect.DURATION - blackEffect.timer;
  // Smooth linear fade in, hold, fade out
  var fadeIn = blackEffect.FADE_IN, fadeOut = blackEffect.FADE_OUT;
  var hold = blackEffect.DURATION - fadeIn - fadeOut;
  if (elapsed < fadeIn) {
    blackEffect.alpha = (elapsed / fadeIn) * 0.7;
  } else if (elapsed < fadeIn + hold) {
    blackEffect.alpha = 0.7;
  } else {
    var outProgress = (elapsed - fadeIn - hold) / fadeOut;
    blackEffect.alpha = Math.max(0, (1 - outProgress) * 0.7);
  }
  // Pull entities toward origin + damage ticks
  // BLACK SINGULARITY: crit doubles pull speed and tick damage.
  var singularity = !!blackEffect.isCrit;
  var pullMult = singularity ? 2.0 : 1.0;
  var tickDmgMult = singularity ? 2.0 : 1.0;
  entities.forEach(function(g) {
    var dx = blackEffect.ox - g.x, dy = blackEffect.oy - g.y;
    var dist = Math.sqrt(dx*dx+dy*dy);
    if (dist < blackEffect.RADIUS && dist > 4) {
      var pullStr = 220 * dt * pullMult; // pull speed px/s
      g.x += (dx/dist) * pullStr;
      g.y += (dy/dist) * pullStr;
    }
  });
  // Damage tick every TICK seconds. Accumulate damage per entity and only
  // display a floating number every DISPLAY_INTERVAL seconds so players can
  // read the impact instead of seeing a spam of small ticks.
  blackEffect.tickTimer += dt;
  blackEffect.displayTimer = (blackEffect.displayTimer || 0) + dt;
  var DISPLAY_INTERVAL = 1.5;
  if (blackEffect.tickTimer >= blackEffect.TICK) {
    blackEffect.tickTimer -= blackEffect.TICK;
    entities.forEach(function(entity) {
      var dist = Math.hypot(entity.x-blackEffect.ox, entity.y-blackEffect.oy);
      if (dist < blackEffect.RADIUS) {
        var beRemote = Math.hypot(blackEffect.ox-player.x, blackEffect.oy-player.y) > 20;
        var beTick = Math.max(1, Math.round((blackEffect.tickDmg || 1) * tickDmgMult));
        var beRes = damageEntity(entity, beTick, !beRemote, 'black'); entity.flashTimer=0.08;
        // Accumulate displayed damage on the entity. Use applied (post-resist)
        // so the flush total reflects what the target actually took.
        entity._blackAccumDmg = (entity._blackAccumDmg || 0) + beRes.applied;
        // Also track worst-tier observed this accumulation window so the
        // flushed number styles correctly (resist/weak/etc).
        var tierRank = { IMMUNE: 0, RESIST: 1, NEUTRAL: 2, VULN: 3, WEAK: 4 };
        var curRank = tierRank[entity._blackAccumTier || 'NEUTRAL'];
        if (tierRank[beRes.tier] > curRank) entity._blackAccumTier = beRes.tier;
        if (!entity._blackAccumTier) entity._blackAccumTier = beRes.tier;
        // Track max wither boost observed this window so the flush scales
        // correctly for withered targets. Otherwise black accum misses the
        // wither visual signal even though the damage math already amplifies.
        if ((beRes.witherBoost || 0) > (entity._blackAccumWither || 0)) {
          entity._blackAccumWither = beRes.witherBoost;
        }
      }
    });
  }
  // Flush accumulated damage display every DISPLAY_INTERVAL seconds.
  // Uses the worst-tier-observed-this-window so a dense zone of resist hits
  // shows as resist style, a weak target shows as weak style, etc.
  if (blackEffect.displayTimer >= DISPLAY_INTERVAL) {
    blackEffect.displayTimer -= DISPLAY_INTERVAL;
    entities.forEach(function(entity) {
      if (entity._blackAccumDmg && entity._blackAccumDmg > 0) {
        showDamageNumber(entity.x, entity.y-25, entity._blackAccumDmg,
          '#888888', entity._blackAccumTier || 'NEUTRAL', entity.x, entity.y, undefined, entity._blackAccumWither || 0, entity);
        entity._blackAccumDmg = 0;
        entity._blackAccumTier = null;
        entity._blackAccumWither = 0;
      }
    });
  }
  triggerVictory();
  if (blackEffect && blackEffect.timer <= 0) {
    var _ox = blackEffect.ox, _oy = blackEffect.oy, _r = blackEffect.RADIUS;
    blackEffect = null;
    entities.forEach(function(g) {
      g.attackSlowed=false; g.attackSlowTimer=0;
      if (Math.hypot(g.x-_ox, g.y-_oy) < _r) { g.slowed=true; g.slowTimer=5.0; }
      // Flush any pending black accum damage text so players see final total
      if (g._blackAccumDmg && g._blackAccumDmg > 0) {
        showDamageNumber(g.x, g.y-25, g._blackAccumDmg,
          '#888888', g._blackAccumTier || 'NEUTRAL', g.x, g.y, undefined, g._blackAccumWither || 0, g);
        g._blackAccumDmg = 0;
        g._blackAccumTier = null;
        g._blackAccumWither = 0;
      }
    });
  }
}

function drawBlackEffect(bounds) {
  if (!blackEffect) return;
  var ox = blackEffect.ox, oy = blackEffect.oy, r = blackEffect.RADIUS;
  ctx.save();
  // Radial dark zone centered on origin
  var grad = ctx.createRadialGradient(ox, oy, r*0.1, ox, oy, r);
  grad.addColorStop(0, 'rgba(0,0,0,' + (blackEffect.alpha * 0.85) + ')');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  // Edge ring that doubles as duration indicator.
  // Dim full ring in back, bright arc draining clockwise as timer runs out.
  var bePct = blackEffect.timer / (blackEffect.DURATION || 3);
  bePct = Math.max(0, Math.min(1, bePct));
  ctx.setLineDash([]);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.globalAlpha = blackEffect.alpha * 0.2;
  ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI*2); ctx.stroke();
  // Timer arc (foreground bright)
  ctx.globalAlpha = blackEffect.alpha * 0.7;
  ctx.strokeStyle = '#BB88FF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ox, oy, r, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * bePct);
  ctx.stroke();
  // Pull indicator — small inward arrows
  ctx.globalAlpha = blackEffect.alpha * 0.3;
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1.5;
  for (var i=0; i<8; i++) {
    var a = (i/8)*Math.PI*2;
    var ax = ox + Math.cos(a)*r*0.7, ay = oy + Math.sin(a)*r*0.7;
    var bx = ox + Math.cos(a)*r*0.5, by = oy + Math.sin(a)*r*0.5;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
  }
  ctx.restore();
}






function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  var scale = getDisplayScale();
  if (player) {
    player.r = Math.round(22 * scale);
    var bounds = getRumbleBounds();
    player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
    player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));
  }
  if (entities && entities.length) {
    entities.forEach(function(g) {
      g.r = Math.round(18 * scale);
      g.AGGRO_RANGE = Math.round(200 * scale);
      g.DEAGGRO_RANGE = Math.round(320 * scale);
    });
  }
}

// ═══════════════════════════════════════════════════
// START / END
// ═══════════════════════════════════════════════════
// Internal — called by Rumble.start(config). config = { cls, hp, hpMax, armor, bricks }.
// All presentation-layer decisions (hiding overlays, showing victory screens)
// are left to the host page via emit('...') events.
function _internalStart(config) {
  cfg = config || {};
  // Re-size canvas here — the host page typically makes the rumble container
  // visible just before calling start(). If init() was called while the
  // container was display:none, the canvas may have picked up stale
  // dimensions. Calling resize() here guarantees we render at the current
  // viewport size.
  resize();
  var cls = cfg.cls || 'breaker';
  player = makePlayer(cls);

  // Seed HP/armor/gold from config if provided (else class default from makePlayer).
  if (typeof cfg.hp === 'number')      player.hp = cfg.hp;
  if (typeof cfg.hpMax === 'number')   player.hpMax = cfg.hpMax;
  if (typeof cfg.armor === 'number')   player.armor = cfg.armor;
  if (typeof cfg.gold === 'number')    player.gold = cfg.gold;

  // Seed bricks based on mode.
  // Spec mode: brickMax = inventory ceiling; bricks = starting charges.
  //   S013 spec change: bricks and brickMax can differ at rumble start.
  //   Rumble receives partial board charge state; regen ticks bricks
  //   toward brickMax as before. If cfg.brickMax absent, fall back to
  //   cfg.bricks (old behavior, treat starting charges as ceiling).
  //   As players earn bricks via fragments/fusion, inventory grows and so
  //   does available rumble capacity.
  // Sandbox mode: keeps makePlayer's random 1-10 per color.
  // Waves mode: same treatment as spec — kit is the inventory ceiling.
  if (cfg.mode === 'spec' || cfg.mode === 'waves') {
    var rates = BRICK_ECONOMY.refreshRates;
    Object.keys(player.bricks).forEach(function(c) {
      var tier = brickTier(cls, c);
      var ceiling = (cfg.brickMax && cfg.brickMax[c] != null) ? cfg.brickMax[c]
                    : ((cfg.bricks && cfg.bricks[c]) || 0);
      var startCharges = (cfg.bricks && cfg.bricks[c] != null) ? cfg.bricks[c] : ceiling;
      // Invariant: charges <= ceiling
      if (startCharges > ceiling) startCharges = ceiling;
      player.brickMax[c] = ceiling;
      player.bricks[c] = startCharges;
      // Stagger initial refresh clocks per color so bricks don't all
      // refresh synchronously mid-battle.
      player.brickRecharge[c] = Math.random() * rates[tier];
    });
  } else if (cfg.bricks && typeof cfg.bricks === 'object') {
    // Sandbox with custom bricks: apply the provided counts, keep makePlayer's maxes
    Object.keys(player.bricks).forEach(function(c) {
      player.bricks[c] = cfg.bricks[c] || 0;
    });
  }

  // PHASE B — clear any lingering status effects from a previous battle
  // (poison/slow/daze/confuse/weaken). Defensive: makePlayer seeds them
  // fresh, but clearStatuses is the canonical reset.
  clearStatuses();
  player.overloadCount = 0;
  _currentCrit = false;
  _wasRevivedThisFight = false;
  _lastReviveWasCheese = false;
  critFlash = null;
  critBanners = [];
  critShockwaves = [];
  witherBolts = [];
  _critStats = { total: 0, crits: 0, perColor: {} };
  _battleStats = {
    startedAt: performance.now(),
    endedAt: 0,
    damageDealt: 0,
    damageTaken: 0,
    armorAbsorbed: 0,
    bricksUsed: {},
    bricksGained: {},
    goldGained: 0,
    cheeseEaten: 0,
    enemiesKilled: [],
    critsLanded: 0,
    overloadsFired: 0,
    hpLow: (typeof cfg.hp === 'number') ? cfg.hp : (player.hpMax || 10),
    // v4: single-hit highlights for victory screen
    biggestDamageDealt: 0,
    biggestDamageTaken: 0,
    biggestHealPlayer: 0,
    biggestHealEntity: 0,
    totalHealed: 0,
    totalEntityHeal: 0,
    // Active-combat accumulator (see top-of-file definition)
    activeCombatMs: 0,
    _lastDamageAt: 0,
    // Damage attribution
    damageByColor: {},
    damageByTarget: {},
  };

  timerLeft = RUMBLE_DURATION;
  running = true;
  _startedAt = performance.now();
  renderBrickBar();

  // v4: FW Formwright buff — 2× brick refresh speed for first 10s (from blue-event success).
  // Server sends refreshBoost = { multiplier, durationMs }; we stash the expiry time and
  // playerRefreshMult() checks it on every tick.
  var _rb = cfg.refreshBoost;
  if (_rb && typeof _rb.multiplier === 'number' && _rb.durationMs > 0) {
    player.refreshBoost = {
      multiplier: _rb.multiplier,
      endsAt: performance.now() + _rb.durationMs,
    };
    if (typeof showFloatingText === 'function') {
      showFloatingText(player.x, player.y - 30, '⚡ FORMWRIGHT CHARGE', '#4db8ff');
    }
  }

  // v4: Apply queued poison from failed green/black board events.
  // Each stack adds a poison tick; the duration is 6s (standard arsenal poison).
  // Server already decremented queuedPoisonBattles for this battle.
  var _qpStacks = Math.max(0, parseInt(cfg.queuedPoisonStacks || 0));
  if (_qpStacks > 0) {
    applyStatus('poison', { stacks: _qpStacks, duration: 6.0, dmgPerTick: 1 });
    if (typeof showFloatingText === 'function') {
      showFloatingText(player.x, player.y - 30, 'POISONED (' + _qpStacks + ')', '#88dd44');
    }
  }

  // Spawn entities after player is placed. cfg.entityCount (default 1) lets
  // the host page request multiple entities for scaling tests.
  var bounds = getRumbleBounds();
  entities = [];
  enemyProjectiles = [];
  droppedBricks = [];
  var count = Math.max(0, Math.min(10, cfg.entityCount != null ? cfg.entityCount : 1));
  for (var si = 0; si < count; si++) {
    // Spread entities around a circle so they don't all spawn stacked.
    var angleOffset = count > 1 ? (si / count) * Math.PI * 2 : 0;
    entities.push(makeEntity(bounds, angleOffset, cfg.entityType));
  }
  // PHASE D — pack_flank signature. For each entity with this signature,
  // roll 30% to spawn a FLANKING TWIN mirrored across the player's position.
  // The twin is a full, independent entity — same stats, same arsenal,
  // same AI — just pre-positioned to force the player to face two sides.
  var _packAdds = [];
  entities.forEach(function(g) {
    if (g.signature !== 'pack_flank') return;
    if (Math.random() >= 0.30) return;
    var twin = makeEntity(bounds, Math.random() * Math.PI * 2, g.type);
    // Mirror twin across player so player is between the two.
    twin.x = 2 * player.x - g.x;
    twin.y = 2 * player.y - g.y;
    // Clamp back into arena if mirror put it out of bounds.
    twin.x = Math.max(bounds.x + twin.r, Math.min(bounds.x + bounds.w - twin.r, twin.x));
    twin.y = Math.max(bounds.y + twin.r, Math.min(bounds.y + bounds.h - twin.r, twin.y));
    twin._isPackTwin = true;   // flag for future tuning / debug
    _packAdds.push(twin);
  });
  for (var pi = 0; pi < _packAdds.length; pi++) entities.push(_packAdds[pi]);
  // Apply resistance overrides from host (e.g. rumble_test dialer).
  // cfg.entityResistances is a flat color→multiplier map keyed by brick color
  // (red/blue/green/etc). Each entity's resistances object takes these as
  // per-color overrides, which take priority over family defaults in
  // resistMult(). Missing values default to 1.0 (neutral).
  if (cfg.entityResistances) {
    entities.forEach(function(g) {
      g.resistances = Object.assign(g.resistances || {}, cfg.entityResistances);
    });
  }

  // Reset all effects, visual arrays, and carry-over state. Any array or
  // singleton that could persist between battles needs to be cleared here —
  // otherwise a fresh battle starts with leftover corpses, floating text, or
  // mid-flight projectiles from the previous fight.
  blueBolts = []; traps = []; armorBursts = []; grayWalls = []; orangeAura = null; bleeds = [];
  greenBurst = null; greenDragActive = false; greenDragPos = null; purpleBursts = []; purpleParticles = []; greenSlowAuras = []; greenBubbles = []; _greenBubbleAccum = 0;
  blackEffect = null; playerSparkles = []; entityRespawnPending = false; playerRegen = null;
  yellowAura = null; whiteField = null;
  brickAction = null; dashCooldown = 0; dragTarget = null; dashEntity = null; overloadState = null;
  // Carry-over hazards: bodies, floating damage numbers, in-flight bolts.
  deadEntities = [];
  floatingTexts = [];
  enemyProjectiles = [];
  // PHASE C — reset arena hazards (poison puddles, thorn shards).
  poisonPuddles = [];
  thornShards = [];
  // PHASE E — reset arcing projectiles
  boulders = [];
  // Remove any leftover DOM overlays (exit card, victory screen) from a
  // previous battle that didn't tear down cleanly.
  var stale;
  stale = document.getElementById('rumble-victory-screen'); if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  stale = document.getElementById('rumble-exit-overlay');   if (stale) stale.classList.remove('visible');
  stale = document.getElementById('bq-vic-styles');         if (stale) stale.remove();
  // Also clear the body scroll-lock class from any stale victory state.
  document.body.classList.remove('bq-vic-active');

  lastTs = performance.now();
  updateHUD();
  rafId = requestAnimationFrame(loop);

  _tickInterval = setInterval(function() {
    if (running) emit('tick', _computeState());
  }, 500);

  emit('start', { cls: cls, mode: cfg.mode || 'sandbox' });
}

var entityRespawnPending = false;

function triggerVictory() {
  if (!running || entityRespawnPending) return;

  // Guard: if any entity has a pending bone-rise queued (skeleton small-hit
  // death → will revive this frame), don't declare victory. The rise
  // happens in the dead-entity sweep AFTER callers have already hit 0 HP,
  // so we could easily declare victory one frame too early.
  var bonePending = entities.some(function(g) {
    return g._boneRiseQueued && !g._boneRisen;
  });
  if (bonePending) return;

  // Drop loot for every entity that just died but hasn't been processed yet.
  // This handles multi-entity kills on the same frame (e.g. black AoE
  // finishing off a cluster). Each entity drops at most once via the
  // _lootDropped flag.
  entities.forEach(function(g) {
    if (g.hp <= 0 && !g._lootDropped) {
      g._lootDropped = true;
      spawnLootFromEntity(g);
      if (_battleStats) _battleStats.enemiesKilled.push(g.type);
      showFloatingText(g.x, g.y - 60, 'FELLED!', '#F5D000');
      emit('enemyKilled', { type: g.type });
    }
  });

  // Check remaining living entities.
  var livingCount = entities.filter(function(g) { return g.hp > 0; }).length;
  if (livingCount > 0) return; // more kills pending; don't end/respawn yet

  // All dead. Behavior split by mode:
  //   • spec mode (real battle from board) → wait for player to collect all
  //     loot, THEN emit 'victory' and end. Victory screen shows stats.
  //   • sandbox mode (rumble_test) → respawn a fresh batch after a delay.
  if (cfg && cfg.mode === 'spec') {
    entityRespawnPending = true;
    _battleStats.endedAt = performance.now();
    // v4: Fight is won — clear any lingering DoTs (poison, etc.) so the
    // player doesn't get dragged into the revive minigame while waiting
    // for loot collection. Heals/regen remain active.
    if (typeof clearStatuses === 'function') clearStatuses();
    // S013.7: Clear lingering combat effects that outlive entity death.
    // Gray walls in particular render an HP bar and read as "still a target",
    // holding up visual resolution even though they block no gameplay. Same
    // for orange aura, bleeds (their targets are gone), poison puddles, etc.
    grayWalls = [];
    if (typeof orangeAura !== 'undefined') orangeAura = null;
    bleeds = [];
    if (typeof poisonPuddles !== 'undefined') poisonPuddles = [];
    if (typeof greenBurst !== 'undefined') greenBurst = null;
    // 0.14.3: Also clear traps. They spawn during combat, stay visible after
    // their hold timer, and otherwise persist past victory because nothing
    // between here and the next battle's start-reset removes them. Visual
    // clutter with no functional purpose post-combat.
    traps = [];
    var victoryDeadline = performance.now() + 5000;
    // Victory always follows a 2s grace period after the last loot pickup
    // (or after vacuum sweep, whichever comes first). The victory overlay
    // itself fades in over 1s after that. Consistent flow, no exceptions —
    // loot-zero fights still get the beat because it reads as "the dust
    // settling" before the scoreboard appears.
    var VICTORY_GRACE_MS = 2000;
    var waitLoot = function() {
      if (!running) { entityRespawnPending = false; return; }
      var now = performance.now();
      if (droppedBricks.length === 0) {
        setTimeout(function() {
          if (!running) return;
          _showVictoryScreen();
          entityRespawnPending = false;
        }, VICTORY_GRACE_MS);
        return;
      }
      if (now >= victoryDeadline) {
        _autoVacuumLoot();
        setTimeout(function() {
          if (!running) return;
          _showVictoryScreen();
          entityRespawnPending = false;
        }, VICTORY_GRACE_MS);
        return;
      }
      setTimeout(waitLoot, 200);
    };
    setTimeout(waitLoot, 800); // brief delay after FELLED before we start waiting
  } else if (cfg && cfg.suppressRespawn) {
    // Waves mode (or any host that wants to manage spawns externally) —
    // skip auto-respawn. Host polls entity count and spawns next wave
    // via Rumble.spawnEntity().
    return;
  } else {
    // Sandbox mode — respawn
    entityRespawnPending = true;
    setTimeout(function() {
      if (!running) { entityRespawnPending = false; return; }
      var bounds = getRumbleBounds();
      var count = Math.max(1, Math.min(10, (cfg && cfg.entityCount) || 1));
      for (var si = 0; si < count; si++) {
        var angleOffset = count > 1 ? (si / count) * Math.PI * 2 : 0;
        // Respawn uses the same entityType config (so 'random' rerolls, a
        // locked type repeats the same enemy, etc).
        var ent = makeEntity(bounds, angleOffset, cfg && cfg.entityType);
        // Re-apply dialer resistances if configured.
        if (cfg && cfg.entityResistances) {
          ent.resistances = Object.assign(ent.resistances || {}, cfg.entityResistances);
        }
        entities.push(ent);
      }
      entityRespawnPending = false;
    }, 2000);
  }
}

function respawnPlayer() {
  if (!running) return;
  if (_revivePaused) return; // already in minigame
  // v4: Player hit 0 HP. Show defeat overlay + revive minigame. Battle state is
  // preserved; `_revivePaused` gates gameplay updates while the overlay is up.
  _revivePaused = true;
  showFloatingText(player.x, player.y - 60, 'DEFEATED', '#d44', player);
  player.iframes = 999;  // invulnerable during minigame
  // Attempt 0 = first try (full speed). Attempt 1 = retry at 80% speed.
  _startReviveMinigame(0);
}

// ── REVIVE MINIGAME STATE ──
var _reviveState = null;

// S013.5: CPR blip pool. Single words or 1-3 word phrases that fade in/out
// every 5 taps during the revive minigame. Mix: encouragement (you got this)
// / unsteadiness (is this working?) / mild dad humor. Concise to keep the
// player's eye on the heart, not the text.
var _CPR_BLIPS = [
  // encouragement
  'Push!',
  'Almost!',
  "Don't stop",
  'Breathe!',
  'Stay with me',
  'Come back',
  'You got this',
  // unsteadiness / brink
  'Flickering...',
  'Wait\u2014',
  'Maybe?',
  'Not yet',
  'Hang on',
  // dad-joke style
  'Heart-y effort!',
  'A-beating we go',
  'Pump it, friend',
];

// S013.6: LAST CHANCE (retry) blip pool — dire, desperate tone.
// Dad jokes removed. These play during the second/final revive attempt
// where failure = actual defeat. Whisper-of-doom feel.
var _CPR_BLIPS_DIRE = [
  'Fading...',
  'Almost gone',
  'Slipping',
  'Please',
  'Not here',
  'Too far',
  'Hold on',
  'One more',
  "Don't go",
  'Come on',
  'Barely',
  'Still here?',
  'Harder',
  'Stay',
  'Now',
];

function _pickCPRBlip(usedSet, isRetry) {
  // No-repeat within a revive session. When every blip has been used, clear
  // the set so we can cycle through again (rare — 15 blips vs 4 per session).
  // On retry (LAST CHANCE), pull from the DIRE pool — dad jokes replaced
  // with desperate, whispered urgency.
  var sourcePool = isRetry ? _CPR_BLIPS_DIRE : _CPR_BLIPS;
  var pool = sourcePool.filter(function(b) { return !usedSet[b]; });
  if (!pool.length) {
    // Exhausted — clear and restart
    Object.keys(usedSet).forEach(function(k) { delete usedSet[k]; });
    pool = sourcePool.slice();
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function _fireCPRBlip() {
  if (!_reviveState) return;
  var stack = document.getElementById('revive-heart-stack');
  if (!stack) return;
  if (!_reviveState.usedBlips) _reviveState.usedBlips = {};
  var blip = _pickCPRBlip(_reviveState.usedBlips, _reviveState.isRetry);
  _reviveState.usedBlips[blip] = true;
  _reviveState.lastBlip = blip;

  // Pick a random position around/over the heart. Avoid repeating the
  // same quadrant as the previous blip to spread them out.
  // Quadrants (relative to heart center): 0=top-left, 1=top-right,
  // 2=bottom-right, 3=bottom-left. Also allow 4=overlapping center.
  var quads = [0, 1, 2, 3, 4];
  if (_reviveState.lastBlipQuad != null) {
    quads = quads.filter(function(q) { return q !== _reviveState.lastBlipQuad; });
  }
  var quad = quads[Math.floor(Math.random() * quads.length)];
  _reviveState.lastBlipQuad = quad;

  // Offsets in percentage of stack dimensions. Rough clusters per quadrant
  // with a bit of jitter so consecutive blips don't land at identical coords.
  var jitter = function() { return (Math.random() - 0.5) * 14; };
  var offsets = {
    0: { x: -32 + jitter(), y: -28 + jitter() },
    1: { x:  32 + jitter(), y: -28 + jitter() },
    2: { x:  30 + jitter(), y:  22 + jitter() },
    3: { x: -30 + jitter(), y:  22 + jitter() },
    4: { x:  0  + jitter(), y:   0 + jitter() },
  };
  var pos = offsets[quad];

  // Drift direction — slightly upward with some lateral bias based on quadrant
  var driftX = (quad === 0 || quad === 3) ? -6 : (quad === 1 || quad === 2) ? 6 : 0;
  var driftY = -18; // always drift up a bit

  // Build the blip element and append to the heart stack
  var el = document.createElement('div');
  el.className = 'revive-cpr-blip';
  el.textContent = blip;
  var isRetry = !!_reviveState.isRetry;
  // Retry gets a more ragged, dying-breath typography: bolder weight,
  // wider letter-spacing, slight tracking shake, and a bone-white color
  // (matches the heart outline). Normal gets the warm CPR italic look.
  var fontStyle = isRetry
    ? 'font-family:Georgia,\'Times New Roman\',serif;font-style:italic;font-weight:900;font-size:clamp(16px,4.6vw,22px);letter-spacing:.14em;'
    : 'font-family:\'Crimson Pro\',Georgia,serif;font-style:italic;font-weight:600;font-size:clamp(14px,3.8vw,19px);letter-spacing:.04em;';
  var colorStyle = isRetry
    ? 'color:#e8dcc0;text-shadow:0 0 14px rgba(0,0,0,0.95), 0 0 22px rgba(232,220,192,0.5), 0 2px 5px rgba(0,0,0,0.95);'
    : 'color:#fff;text-shadow:0 0 10px #000, 0 0 18px rgba(220,80,80,0.8), 0 1px 3px rgba(0,0,0,0.9);';
  el.style.cssText =
      'position:absolute;'
    + 'left:calc(50% + ' + pos.x.toFixed(1) + '%);'
    + 'top:calc(50% + ' + pos.y.toFixed(1) + '%);'
    + 'transform:translate(-50%,-50%);'
    + fontStyle
    + colorStyle
    + 'opacity:0;pointer-events:none;white-space:nowrap;'
    + 'z-index:3;';
  stack.appendChild(el);

  // Animate: fade in, drift up, fade out, remove.
  // Retry blips hang longer and fade more slowly — desperate pacing.
  var holdMs   = isRetry ? 2200 : 650;    // time on screen at full opacity
  var fadeMs   = isRetry ? 1500 : 400;    // fade-out duration
  var driftMs  = isRetry ? 3200 : 1100;   // total transform duration
  var removeMs = holdMs + fadeMs + 100;

  requestAnimationFrame(function() {
    el.style.transition = 'opacity 0.2s ease-out, transform ' + driftMs + 'ms ease-out';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,-50%) translate(' + driftX + 'px,' + driftY + 'px)';
  });
  setTimeout(function() {
    el.style.transition = 'opacity ' + fadeMs + 'ms ease-in';
    el.style.opacity = '0';
  }, holdMs);
  setTimeout(function() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }, removeMs);
}

function _startReviveMinigame(attemptIdx) {
  // attemptIdx: 0 = first attempt, 1 = retry at reduced difficulty
  var isRetry = attemptIdx > 0;
  var windowMs = isRetry ? 6000 / 0.8 : 6000;   // retry window is 80% speed → 7500ms
  var targetTaps = 20;
  _reviveState = {
    attempt: attemptIdx,
    startedAt: performance.now(),
    endsAt: performance.now() + windowMs,
    windowMs: windowMs,
    tapsNeeded: targetTaps,
    taps: 0,
    isRetry: isRetry,
    tickId: null,
    lastBlipAtTap: 0,    // last tap count at which a blip fired
    lastBlip: null,      // last blip text (prevents immediate repeat)
    usedBlips: {},       // S013.6: session-level used-blip set (no repeats)
    lastBlipQuad: null,  // last quadrant used for positioning
    blipFadeTimer: null, // handle for the fade-out timeout
    pathLength: 0,       // measured on overlay mount (SVG path.getTotalLength)
  };
  _showReviveOverlay();
  // Poll every 100ms to update UI + check time
  _reviveState.tickId = setInterval(_reviveTick, 100);
}

function _reviveTick() {
  if (!_reviveState) return;
  var now = performance.now();
  var pct = Math.min(1, (now - _reviveState.startedAt) / _reviveState.windowMs);
  var tapPct = Math.min(1, _reviveState.taps / _reviveState.tapsNeeded);

  // Inner heart grows with taps; pulse accelerates as life returns.
  // S013.6: inner is SVG <g> — scale applies via SVG transform attribute
  // (not CSS), which resolves in viewBox coordinates reliably.
  var innerG = document.getElementById('revive-heart-inner-g');
  if (innerG) {
    var innerScale = 0.2 + 0.8 * tapPct;
    innerG.setAttribute('transform', 'scale(' + innerScale.toFixed(3) + ')');
    var pulseSpeed = Math.max(0.3, 1.0 - 0.7 * tapPct); // seconds per cycle
    innerG.style.animationDuration = pulseSpeed.toFixed(2) + 's';
  }

  // S013.5: Outer heart SVG outline drains from full perimeter to empty.
  // At t=0, strokeDashoffset=0 → full outline drawn. At t=windowMs,
  // strokeDashoffset=pathLength → outline fully erased. Shape stays the
  // same size throughout; only the visible stroke segment changes.
  var pathEl = document.getElementById('revive-heart-outer-path');
  if (pathEl) {
    // Lazy-init: measure path length on first tick (SVG must be mounted).
    if (!_reviveState.pathLength) {
      try {
        _reviveState.pathLength = pathEl.getTotalLength();
        pathEl.style.strokeDasharray = _reviveState.pathLength;
        pathEl.style.strokeDashoffset = 0;
      } catch (e) {
        _reviveState.pathLength = 50;
        pathEl.style.strokeDasharray = 50;
        pathEl.style.strokeDashoffset = 0;
      }
    }
    // Drain: offset grows from 0 to full length as pct goes 0 → 1
    pathEl.style.strokeDashoffset = (_reviveState.pathLength * pct).toFixed(2);
  }

  // CPR blip frequency. Normal first attempt: every 5 taps (5,10,15,20).
  // LAST CHANCE retry: every 3 taps (more frequent, desperate pacing matches
  // the dire flavor pool).
  var blipInterval = _reviveState.isRetry ? 3 : 5;
  var blipThreshold = Math.floor(_reviveState.taps / blipInterval);
  var lastBlipThreshold = Math.floor((_reviveState.lastBlipAtTap || 0) / blipInterval);
  if (_reviveState.taps > 0 && blipThreshold > lastBlipThreshold) {
    _reviveState.lastBlipAtTap = _reviveState.taps;
    _fireCPRBlip();
  }

  // Success?
  if (_reviveState.taps >= _reviveState.tapsNeeded) {
    _resolveRevive(true);
    return;
  }
  // Time out?
  if (now >= _reviveState.endsAt) {
    if (!_reviveState.isRetry) {
      _offerReviveRetry();
    } else {
      _resolveRevive(false);
    }
  }
}

function _reviveTapHandler(e) {
  if (!_reviveState) return;
  if (e && e.preventDefault) e.preventDefault();
  _reviveState.taps++;
  // S013.3: CPR feel — inner heart gives a quick extra squeeze on tap.
  // Overall scale is driven by _reviveTick; this is a brief filter impulse on top.
  var innerG = document.getElementById('revive-heart-inner-g');
  if (innerG) {
    innerG.classList.remove('revive-tap-impulse');
    void innerG.offsetWidth; // restart animation
    innerG.classList.add('revive-tap-impulse');
  }
}

function _showReviveOverlay() {
  var root = document.getElementById('rumble-root') || document.body;
  var existing = document.getElementById('revive-overlay');
  if (existing) existing.remove();

  var isRetry = _reviveState.isRetry;
  var titleColor = isRetry ? '#ff884d' : '#d44';
  var title = isRetry ? 'LAST CHANCE' : 'DEFEATED';
  var subtitle = isRetry ? 'Tap fast — final attempt' : 'Tap rapidly to revive!';

  // S013.3: Two-heart design.
  //   outer: faint heart at baseline — represents time remaining, shrinks inward
  //   inner: small red beating heart — represents life returning, grows with taps
  // Revive succeeds when taps fill the inner heart (scale 1.0).
  // Revive fails when the time-driven outer scale reaches 0.2 before taps catch up.
  // Entire overlay is the tap target (huge area) — no small button to miss.
  // Tap counter removed — the visual (inner catching outer) IS the progress indicator.
  // Centered layout reads equally well in portrait and landscape.

  // Color helpers: convert hex shorthand (#d44) to rgba() for alpha safety.
  // The earlier implementation did `titleColor + '44'` which produces an
  // invalid 5-char color (e.g. '#d4444') for 3-digit hex inputs — browsers
  // silently fall back to transparent, so the outer heart was invisible.
  var tcRgba = function(alpha) {
    // Parse #d44 or #dd4444 into rgba
    var h = titleColor.replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.substr(0,2),16);
    var g = parseInt(h.substr(2,2),16);
    var b = parseInt(h.substr(4,2),16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  };

  // Two-heart stack — landscape-friendly sizing (uses min of vw and vh).
  // Outer = SVG heart path with stroke-dasharray drain (timer). The outline
  // erases from the bottom cusp around the perimeter as time runs out.
  // Inner = Unicode ❤ that grows with taps and pulses like a beating heart.
  // The SVG path starts at the bottom cusp (0, 8) and traces counterclockwise
  // up the right lobe, across the top, down the left lobe, back to cusp.
  // This gives us a natural "drain from the bottom" when we animate
  // stroke-dashoffset from 0 upward — the outline retreats from its own
  // starting point.
  //
  // Heart SVG path — canonical shape matching a classic heart silhouette.
  // Path geometry: width 22 (x:[-11,11]), height 18 (y:[-9,9]), centered
  // on origin. Lobes flat-rounded at top with deep dip. Sharp bottom cusp.
  // viewBox is -13 -13 26 26 for small padding around the heart.
  //
  // Path traces: cusp → left side up → left lobe over top to dip → right
  // lobe over top → right side down to cusp. Drain starts at the cusp
  // so outline erases from the bottom first.
  var heartPath = 'M 0 9 '
               + 'C 0 9, -11 3, -11 -2 '    // left side: cusp up to shoulder
               + 'C -11 -7, -8 -9, -5 -9 '  // left lobe outer curve to peak
               + 'C -2 -9, 0 -7, 0 -5 '     // left lobe to top dip
               + 'C 0 -7, 2 -9, 5 -9 '      // right lobe from dip to peak
               + 'C 8 -9, 11 -7, 11 -2 '    // right lobe outer curve
               + 'C 11 3, 0 9, 0 9 Z';      // right side back down to cusp

  var heartStackHtml =
        '<div id="revive-heart-stack" style="position:relative;width:min(260px,60vmin);height:min(260px,60vmin);overflow:visible;'
      +   'display:flex;align-items:center;justify-content:center;">'
      // Outer heart — SVG outline, bone white at whisper-thin stroke.
      // Acts as a timer: starts at full perimeter, drains to zero as time
      // runs out. stroke-width 0.3 (in 22-unit viewBox ≈ 3.5px actual).
      +   '<svg id="revive-heart-outer-svg" viewBox="-13 -13 26 26" '
      +     'style="position:absolute;top:50%;left:50%;'
      +     'transform:translate(-50%,-50%);'
      +     'width:min(260px,60vmin);height:min(260px,60vmin);'
      +     'pointer-events:none;'
      +     'overflow:visible;">'
      +     '<path id="revive-heart-outer-path" d="' + heartPath + '" '
      +       'fill="none" '
      +       'stroke="#e8dcc0" '
      +       'stroke-width="0.1" '
      +       'stroke-linejoin="round" '
      +       'style="filter:drop-shadow(0 0 1.2px rgba(0,0,0,0.95));'
      +       'transition:stroke-dashoffset 0.1s linear;" />'
      +   '</svg>'
      // Inner heart — SVG filled shape, same path as outer. Grows with taps
      // via SVG native transform attribute on the <g> wrapper. Using the
      // SVG transform attribute (not CSS) because it resolves in viewBox
      // coordinates reliably across browsers — CSS transform-origin on
      // SVG <g> behaves inconsistently.
      +   '<svg id="revive-heart-inner-svg" viewBox="-13 -13 26 26" '
      +     'style="position:absolute;top:50%;left:50%;'
      +     'transform:translate(-50%,-50%);'
      +     'width:min(260px,60vmin);height:min(260px,60vmin);'
      +     'pointer-events:none;'
      +     'overflow:visible;z-index:2;">'
      +     '<g id="revive-heart-inner-g" transform="scale(0.2)" '
      +       'style="animation:reviveInnerPulse 1s ease-in-out infinite;">'
      +       '<path d="' + heartPath + '" '
      +         'fill="' + titleColor + '" '
      +         'style="filter:drop-shadow(0 0 3px ' + titleColor + ');" />'
      +     '</g>'
      +   '</svg>'
      // CPR blips are spawned dynamically at random positions by
      // _fireCPRBlip (every 5 taps). They float, fade, and self-remove.
      + '</div>';

  var html =
    '<div id="revive-overlay" style="position:absolute;top:0;left:0;right:0;bottom:0;'
      + 'background:rgba(10,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'z-index:250;padding:20px;pointer-events:auto;font-family:\'Cinzel\',serif;'
      + 'touch-action:manipulation;user-select:none;-webkit-user-select:none;cursor:pointer;">'
      // Title
      + '<div style="font-size:clamp(22px,6vw,38px);font-weight:700;color:' + titleColor
      +   ';letter-spacing:.15em;text-shadow:0 0 20px ' + titleColor + ';margin-bottom:4px;text-align:center;">'
      +   title + '</div>'
      + '<div style="font-size:clamp(12px,3vw,15px);color:#ddd;margin-bottom:16px;font-family:\'Crimson Pro\',serif;font-style:italic;text-align:center;">'
      +   subtitle + '</div>'
      + heartStackHtml
      // Style: inner pulse + tap impulse (layered)
      + '<style>'
      +   '@keyframes reviveInnerPulse { 0%,100% { filter:drop-shadow(0 0 4px ' + titleColor + '); }'
      +     ' 50% { filter:drop-shadow(0 0 8px ' + titleColor + ') brightness(1.15); } }'
      +   '.revive-tap-impulse { animation: reviveTapBurst 0.18s ease-out; }'
      +   '@keyframes reviveTapBurst { 0% { filter:drop-shadow(0 0 12px #fff) brightness(1.6); }'
      +     ' 100% { filter:drop-shadow(0 0 4px ' + titleColor + ') brightness(1); } }'
      + '</style>'
    + '</div>';

  var wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  var node = wrapper.firstChild;
  root.appendChild(node);

  var overlay = document.getElementById('revive-overlay');
  var heartStack = document.getElementById('revive-heart-stack');
  if (overlay && heartStack) {
    // Tap target is constrained to the heart stack — focuses input on the
    // visual focal point, no longer counts taps on subtitle/empty space.
    // Overlay still catches stray clicks so they don't leak to the canvas.
    heartStack.style.cursor = 'pointer';
    heartStack.style.touchAction = 'manipulation';
    heartStack.addEventListener('pointerdown', _reviveTapHandler);
    overlay.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); });
  }
}

function _offerReviveRetry() {
  // Time expired on first attempt — swap to retry mode
  if (_reviveState && _reviveState.tickId) clearInterval(_reviveState.tickId);
  _startReviveMinigame(1);
}

// S013.3: Revive tracking state.
//   _wasRevivedThisFight = true after any successful revive this rumble
//   (drives the REVIVED flavor pool on victory).
//   player.reviveCount = stacking counter for loot-drop penalty. Heart-revive
//   increments; cheese-revive resets to 0 (cheese revive is the "clean save").
//   Loot mult = max(0.1, 1.0 - 0.1 * player.reviveCount).
var _wasRevivedThisFight = false;
var _lastReviveWasCheese = false;

function _resolveRevive(success) {
  if (!_reviveState) return;
  if (_reviveState.tickId) clearInterval(_reviveState.tickId);
  var overlay = document.getElementById('revive-overlay');
  if (overlay) overlay.remove();
  _reviveState = null;

  if (success) {
    // Restore player
    var hadCheese = (player.cheese || 0) > 0;
    if (hadCheese) {
      player.cheese -= 1;
      player.hp = player.hpMax;
      // Cheese revive is a clean save — resets the stacking loot penalty.
      player.reviveCount = 0;
      _lastReviveWasCheese = true;
      showFloatingText(player.x, player.y - 50, '🧀 REVIVED', '#FFD96A', player);
      // Cheese-specific flavor float
      var cFlavor = _pickCheeseReviveFlavor();
      showFloatingText(player.x, player.y - 80, cFlavor, '#FFD96A', player);
    } else {
      player.hp = Math.max(1, Math.floor(player.hpMax * 0.5));
      // Heart-tap revive stacks the loot penalty (-10% per revive, floor 10%).
      player.reviveCount = (player.reviveCount || 0) + 1;
      _lastReviveWasCheese = false;
      showFloatingText(player.x, player.y - 50, 'REVIVED', '#9adb9a', player);
    }
    _wasRevivedThisFight = true;
    player.iframes = 2.5;
    clearStatuses();
    _revivePaused = false;
  } else {
    // True defeat — end battle
    _revivePaused = false;
    _internalEnd('defeat');
  }
}

// Internal — called by Rumble.forceEnd or via in-combat end conditions.
// Emits 'victory' | 'defeat' | 'timeout' | 'quit' | <custom> events.
// Battle-end flavor lines. Picked by performance tier.
var _VICTORY_FLAVORS = {
  FLAWLESS: [
    'Not a scratch. The enemy never had a chance.',
    'Masterful. They fell before they could raise a hand.',
    'A perfect dance of blade and brick.',
  ],
  DOMINANT: [
    'A clean victory. The path ahead opens.',
    'Bloodied but unshaken — they knew who was in charge.',
    'Decisive. The woods grow quieter.',
  ],
  SURVIVED: [
    'That was closer than expected. Take a breath.',
    'You live to fight on — but the road ahead will test you.',
    'The threat is past. Your wounds will tell the story later.',
  ],
  LIMPING: [
    'A miracle, nothing less. You should not have survived.',
    'You stagger forward, leaving a trail of blood behind you.',
    'The fight is won. Whether you will live is another question.',
  ],
  // Revived mid-fight (heart-tap) and went on to win. Flavor acknowledges
  // the near-death comeback.
  REVIVED: [
    'You were gone. You came back. The enemy is worse off.',
    'Your heart started again, and you started swinging.',
    'Resurrected by sheer stubbornness — and vengeance.',
    'The darkness almost took you. You took the enemy instead.',
    'A second breath, a second chance, and one more kill.',
    'You woke up angry. It showed.',
    'The fall gave you clarity. The getting-up gave you fury.',
    'You were half-ghost when the killing blow landed. The other half was plenty.',
  ],
};

// Cheese saved you at the edge of death. Flavor leans warm, almost silly,
// because cheese is a warm-silly resource. The fight continues.
var _CHEESE_REVIVE_FLAVORS = [
  'A crumb of cheese, a full heart. That is how the old stories go.',
  'You bit down. The cheese bit back — into your chest, straight to the soul.',
  'The cheese remembered you. It always does.',
  'Rinded and ready. You rise from the floor mid-chew.',
  'A small mercy in a dairy shape. You live.',
  'Cheese is not magic. But it is close enough today.',
];

// Any event that grants or discovers cheese. Kept CONCISE — 1-3 word phrases
// so the text reads cleanly as a rumble floater. A few 5-word dad jokes mixed
// in because cheese is inherently silly. Rendered larger than damage text.
var _CHEESE_EVENT_FLAVORS = [
  // Concise
  'Cheesy!',
  'Fresh wheel!',
  'Big find.',
  'Dairy won.',
  'Gouda day.',
  'Mmm...',
  'Smell that?',
  'Well aged.',
  'Creamy!',
  'Rind of joy.',
  'Hole-y moly.',
  'Cheese dreams.',
  // Dad-joke tier
  'A grate discovery.',
  'That is nacho cheese.',
  'You brie-long here.',
  'Cheddar believe it.',
  'Feta late than never.',
];

function _pickFlavor(tierLabel, opts) {
  // opts.revived: was the player revived mid-fight via heart-tap?
  if (opts && opts.revived) {
    var rPool = _VICTORY_FLAVORS.REVIVED;
    return rPool[Math.floor(Math.random() * rPool.length)];
  }
  var pool = _VICTORY_FLAVORS[tierLabel] || _VICTORY_FLAVORS.SURVIVED;
  return pool[Math.floor(Math.random() * pool.length)];
}

function _pickCheeseReviveFlavor() {
  return _CHEESE_REVIVE_FLAVORS[Math.floor(Math.random() * _CHEESE_REVIVE_FLAVORS.length)];
}

function _pickCheeseEventFlavor() {
  return _CHEESE_EVENT_FLAVORS[Math.floor(Math.random() * _CHEESE_EVENT_FLAVORS.length)];
}

// Auto-vacuum any remaining loot onto the player. Used when the safety
// timeout hits and there are still dropped bricks on the ground — sweep
// them all up so the player doesn't miss loot just because they didn't
// walk over every coin.
function _autoVacuumLoot() {
  if (!player || !droppedBricks || droppedBricks.length === 0) return;
  droppedBricks.forEach(function(p) {
    if (p.done) return;
    if (p.kind === 'cheese') {
      // S013.6: vacuum cheese mirrors normal pickup — adds to inventory,
      // not direct hpMax buff. Cheese is a tradeable consumable in v4.
      player.cheese = (player.cheese || 0) + 1;
      if (_battleStats) _battleStats.cheeseEaten++;
      if (_battleStats) {
        if (!_battleStats.bricksGained) _battleStats.bricksGained = {};
        _battleStats.bricksGained.cheese = (_battleStats.bricksGained.cheese || 0) + 1;
      }
    } else if (p.kind === 'gold') {
      var amt = p.amount || 1;
      player.gold = (player.gold || 0) + amt;
      if (_battleStats) _battleStats.goldGained += amt;
    } else {
      // S013.6: vacuum bricks grow ceiling + charges (matches normal pickup).
      player.bricks[p.color] = (player.bricks[p.color] || 0) + 1;
      player.brickMax[p.color] = (player.brickMax[p.color] || 0) + 1;
      if (_battleStats) _addBrickStat(_battleStats.bricksGained, p.color, 1);
    }
    p.done = true;
  });
  droppedBricks = droppedBricks.filter(function(p) { return !p.done; });
  showFloatingText(player.x, player.y - 70, 'AUTO-COLLECT', '#F5D000', player);
}

// Performance tier based on HP remaining + damage taken profile.
// Used by victory screen as a narrative banner AND (future) by server-side
// HP regen scaling per NOTES thread "HP regeneration philosophy".
function _perfTier() {
  if (!player || !_battleStats) return { label: 'SURVIVED', color: '#888', regen: 1 };
  var hpPct = player.hp / (player.hpMax || 10);
  var tookNoDamage = _battleStats.damageTaken === 0;
  if (tookNoDamage)       return { label: 'FLAWLESS',  color: '#F5D000', regen: 6 };
  if (hpPct >= 0.75)      return { label: 'DOMINANT',  color: '#5DE05D', regen: 3 };
  if (hpPct >= 0.40)      return { label: 'SURVIVED',  color: '#A8A8A8', regen: 1 };
  return                         { label: 'LIMPING',   color: '#E24B4A', regen: 0 };
}

// Compute the favorite (most-used) brick color. Returns { color, count } or null.
function _favoriteMove() {
  if (!_battleStats || !_battleStats.bricksUsed) return null;
  var best = null, bestCount = 0;
  Object.keys(_battleStats.bricksUsed).forEach(function(c) {
    var n = _battleStats.bricksUsed[c];
    if (n > bestCount) { bestCount = n; best = c; }
  });
  return best ? { color: best, count: bestCount } : null;
}

// S013.1: Victory card brick refill helpers.
// During the victory overlay, player.bricks ticks up rapidly (via the
// _victoryRefillActive boost). These helpers render a live pip row in the
// card and poll it every 80ms so players see charges filling in.
var _victoryRefillInterval = null;

// Build initial pip DOM. One wrapper div per color that needs refilling.
// Each wrapper holds individual pip spans. Subsequent updates MUTATE these
// nodes in place (see _updateVictoryPips) so CSS transitions can run when
// a color tops off and fades out.
//
// Returns empty string if no colors are currently refilling (all full).
function _renderVictoryPipsInitial() {
  if (!player || !player.bricks || !player.brickMax) return '';
  var ALL = ['red','blue','green','white','gray','purple','yellow','orange','black'];
  var out = '';
  ALL.forEach(function(c) {
    var max = player.brickMax[c] || 0;
    if (max <= 0) return;                          // didn't bring this color
    var cur = Math.min(max, player.bricks[c] || 0);
    if (cur >= max) return;                        // already full — skip entirely
    var bg = BRICK_COLORS[c] || '#555';
    out += '<span class="vic-pip-group" data-color="' + c + '" data-state="refilling" '
      +    'style="display:inline-flex;gap:3px;margin-right:6px;'
      +    'transition:opacity 600ms ease-out, transform 600ms ease-out;">';
    for (var i = 0; i < max; i++) {
      var lit = i < cur;
      out += '<span data-pip-idx="' + i + '" style="display:inline-block;width:10px;height:10px;border-radius:2px;'
        + (lit
          ? 'background:' + bg + ';box-shadow:0 0 4px ' + bg + ';'
          : 'background:#1a1a1a;border:1px solid ' + bg + 'aa;box-sizing:border-box;')
        + '"></span>';
    }
    out += '</span>';
  });
  return out;
}

// Mutate existing pip DOM in place. For each color group wrapper:
//   - update individual pip spans' lit/unlit state to match current charges
//   - when the color tops off, flip data-state="filled" (CSS fades opacity)
//   - after fade completes, remove the wrapper from DOM
function _updateVictoryPips() {
  if (!player || !player.bricks || !player.brickMax) return;
  var container = document.getElementById('rumble-victory-pips');
  if (!container) return;
  var groups = container.querySelectorAll('.vic-pip-group');
  groups.forEach(function(group) {
    var c = group.getAttribute('data-color');
    var state = group.getAttribute('data-state');
    if (state === 'filled') return;                // already fading; CSS owns it
    var max = player.brickMax[c] || 0;
    var cur = Math.min(max, player.bricks[c] || 0);
    var bg = BRICK_COLORS[c] || '#555';
    // Update pip lit states
    var pips = group.querySelectorAll('[data-pip-idx]');
    pips.forEach(function(pip, i) {
      var lit = i < cur;
      // Avoid re-styling unless changed (prevents layout thrash + lets CSS settle)
      var isLit = pip.style.background && pip.style.background !== 'rgb(26, 26, 26)';
      if (lit && !isLit) {
        pip.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:2px;'
          + 'background:' + bg + ';box-shadow:0 0 4px ' + bg + ';';
      } else if (!lit && isLit) {
        pip.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:2px;'
          + 'background:#1a1a1a;border:1px solid ' + bg + 'aa;box-sizing:border-box;';
      }
    });
    // If now full, mark for fade-out
    if (cur >= max) {
      group.setAttribute('data-state', 'filled');
      group.style.opacity = '0';
      group.style.transform = 'scale(0.85)';
      // Remove from layout after fade completes (700ms = 600ms transition + buffer)
      setTimeout(function() {
        if (group.parentNode) group.parentNode.removeChild(group);
      }, 700);
    }
  });
  // If no groups are still refilling, fade out the entire REFILLING wrapper
  // (label + container together). Counts only refilling groups; "filled" groups
  // are mid-fade and don't count. Once wrapper is fully faded, removed from DOM
  // so empty grid rows don't leave layout gaps.
  var refillingCount = container.querySelectorAll('.vic-pip-group:not([data-state="filled"])').length;
  if (refillingCount === 0) {
    var wrapper = document.getElementById('rumble-victory-refill');
    if (wrapper && wrapper.getAttribute('data-state') !== 'done') {
      wrapper.setAttribute('data-state', 'done');
      // Wait until the last pip group's fade animation finishes (700ms),
      // then start the wrapper fade. Total: pip-fade (700) + wrapper-fade (600) = ~1.3s
      setTimeout(function() {
        if (!wrapper.parentNode) return;
        wrapper.style.opacity = '0';
        setTimeout(function() {
          if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        }, 650);
      }, 700);
    }
  }
}

function _startVictoryRefillLoop() {
  if (_victoryRefillInterval) clearInterval(_victoryRefillInterval);
  _victoryRefillInterval = setInterval(function() {
    // Element may be briefly missing during card cross-fade (DOM swap).
    // Don't kill the loop — just skip this tick. Loop is only stopped by
    // _stopVictoryRefillLoop when victory ends.
    var el = document.getElementById('rumble-victory-pips');
    if (!el) return;
    _updateVictoryPips();
  }, 80);
}

function _stopVictoryRefillLoop() {
  if (_victoryRefillInterval) { clearInterval(_victoryRefillInterval); _victoryRefillInterval = null; }
}

// Build + inject the victory overlay. Called after all loot is collected
// (or safety-timeout expires). Click "Continue" button to dismiss → triggers
// _internalEnd('victory'). Has a 1-second pointer-events guard so the same
// click that killed the enemy doesn't also dismiss the overlay.
function _showVictoryScreen() {
  if (!player || !_battleStats) {
    console.warn('[BQ-RUMBLE] _showVictoryScreen bailing — missing player or _battleStats');
    _internalEnd('victory'); return;
  }
  // S013.1: kick off the post-victory brick refill boost. Existing regen
  // tick in the update loop runs at 20× speed until _internalEnd clears
  // the flag (when player finishes the victory flow). Pips animate during
  // both cards; they're only VISIBLE on card 2 but the fill continues
  // through card 1 so the bar is further along when card 2 appears.
  _victoryRefillActive = true;
  _startVictoryRefillLoop();

  var durMs = Math.max(1, _battleStats.endedAt - _battleStats.startedAt);
  var durSec = Math.round(durMs / 1000);
  var mm = Math.floor(durSec / 60), ss = durSec % 60;
  var timeStr = mm + ':' + (ss < 10 ? '0' : '') + ss;
  var dps = Math.round(_battleStats.damageDealt / (durMs / 1000) * 10) / 10;
  var tier = _perfTier();
  var fav = _favoriteMove();
  var flavor = _pickFlavor(tier.label, { revived: _wasRevivedThisFight });

  // Bricks-gained summary (filter to only actual brick-color keys — cheese
  // is tracked separately to avoid double-rendering; same dedup pattern as
  // the DM v4 DmResultBlock).
  var gainedLines = Object.keys(_battleStats.bricksGained).filter(function(c) {
    return BRICK_COLORS[c];
  }).map(function(c) {
    return '<span style="display:inline-flex;align-items:center;margin:0 6px 4px 0;padding:3px 8px;border-radius:6px;background:' + (BRICK_COLORS[c]||'#555') + '33;border:1px solid ' + (BRICK_COLORS[c]||'#555') + '88;font-size:11px;">'
      + '<span style="width:10px;height:10px;border-radius:2px;background:' + (BRICK_COLORS[c]||'#555') + ';margin-right:6px;"></span>'
      + '+' + _battleStats.bricksGained[c] + ' ' + c
      + '</span>';
  }).join('');
  if (_battleStats.cheeseEaten > 0) {
    gainedLines += '<span style="display:inline-flex;align-items:center;margin:0 6px 4px 0;padding:3px 8px;border-radius:6px;background:#F5C80033;border:1px solid #F5C800;font-size:11px;">🧀 +' + _battleStats.cheeseEaten + '</span>';
  }
  if (_battleStats.goldGained > 0) {
    gainedLines += '<span style="display:inline-flex;align-items:center;margin:0 6px 4px 0;padding:3px 8px;border-radius:6px;background:#F5D00033;border:1px solid #F5D000;font-size:11px;">🪙 +' + _battleStats.goldGained + '</span>';
  }
  if (!gainedLines) gainedLines = '<span style="color:#888;font-size:11px;font-style:italic;">No loot gained</span>';

  var favLine = fav
    ? '<span style="color:' + (BRICK_COLORS[fav.color]||'#fff') + ';font-weight:700;">' + fav.color + '</span> brick × ' + fav.count
    : '<span style="color:#888;font-style:italic;">—</span>';

  // ── Shared CSS block for both cards ──
  // Responsive approach: aspect-ratio-based layout (wide vs tall),
  // vmin-scaled sizing so content "exhales when it can, contracts when needed".
  // No overflow scroll — content is sized to fit the viewport at any dimension.
  //
  // Cards size to CONTENT, not to available space. A short stats card doesn't
  // stretch; a long stats card gets its cells, never overflows. Grid gap
  // provides breathing room between zones, not empty card interiors.
  var sharedCss =
    '<style>'
    +   '@keyframes bqVictoryFadeIn  { from { opacity: 0; } to { opacity: 1; } }'
    +   '@keyframes bqVictoryFadeOut { from { opacity: 1; } to { opacity: 0; } }'
    +   '.bq-vic-backdrop {'
    +     ' position:absolute;top:0;left:0;right:0;bottom:0;'
    +     ' background:rgba(8,8,14,.97);'
    +     ' display:flex;flex-direction:column;align-items:center;justify-content:center;'
    +     ' z-index:200;box-sizing:border-box;'
    +     ' font-family:\'Cinzel\',serif;'
    +     ' opacity:0;animation:bqVictoryFadeIn .6s ease-out forwards;'
    +     ' overflow:hidden;'
    +   '}'
    +   '.bq-vic-backdrop.fading-out { animation:bqVictoryFadeOut .3s ease-in forwards; }'
    +   '.bq-vic-card {'
    +     ' width:min(92vw, 480px) !important;'
    +     ' max-height:96% !important;'
    +     ' display:flex !important;flex-direction:column !important;align-items:center !important;'
    +     ' padding:clamp(14px, 3vmin, 28px) clamp(16px, 3.5vmin, 32px) !important;'
    +     ' gap:clamp(10px, 2.2vmin, 20px) !important;'
    +     ' pointer-events:auto;'
    +     ' overflow:hidden !important;'
    +     ' box-sizing:border-box !important;'
    +   '}'
    +   '.bq-vic-card::-webkit-scrollbar { display:none; width:0; height:0; }'
    +   'body.bq-vic-active, body.bq-vic-active html { overflow:hidden !important; }'
    +   'body.bq-vic-active::-webkit-scrollbar { display:none; width:0; height:0; }'
    +   '.bq-vic-btn {'
    +     ' padding:clamp(10px, 2.2vmin, 14px) clamp(28px, 6.5vmin, 46px);'
    +     ' font-size:clamp(12px, 2.4vmin, 15px);'
    +     ' font-family:\'Cinzel\',serif;letter-spacing:.14em;font-weight:700;'
    +     ' border-radius:10px;cursor:pointer;border:2px solid;'
    +     ' min-width:clamp(150px, 28vmin, 200px);'
    +   '}'
    +   '.vic-zone-wrap {'
    +     ' display:flex;flex-direction:column;align-items:center;'
    +     ' gap:clamp(4px, 1vmin, 8px);'
    +     ' text-align:center;'
    +   '}'
    +   '.vic-zone-label {'
    +     ' font-size:clamp(9px, 1.7vmin, 11px) !important;'
    +     ' letter-spacing:.2em;color:#888;'
    +     ' font-family:ui-sans-serif,system-ui !important;'
    +     ' font-weight:500;'
    +   '}'
    +   '.vic-zone-body {'
    +     ' background:#15151e;border:1px solid #2a2a3e;border-radius:12px;'
    +     ' padding:clamp(12px, 2.6vmin, 20px) clamp(14px, 3vmin, 24px);'
    +     ' font-family:ui-sans-serif,system-ui;'
    +     ' box-sizing:border-box;'
    +   '}'
    +   '@media (min-aspect-ratio: 1/1) {'
    +     '.bq-vic-card.card-moment {'
    +       ' width:min(88vw, 720px) !important;'
    +     '}'
    +     '.bq-vic-card.card-rewards {'
    +       ' width:fit-content; max-width:96vw;'
    +       ' display:grid;'
    +       ' grid-template-columns:auto auto;'
    +       ' grid-template-areas:"stats rewards" "refill refill" "claim claim";'
    +       ' justify-content:center; align-items:center; justify-items:center;'
    +       ' gap:clamp(10px, 2vmin, 18px) clamp(18px, 4vmin, 32px);'
    +     '}'
    +     '.bq-vic-card.card-rewards .vic-stats-wrap   { grid-area:stats;   }'
    +     '.bq-vic-card.card-rewards .vic-rewards-wrap { grid-area:rewards; }'
    +     '.bq-vic-card.card-rewards .vic-refill-wrap  { grid-area:refill;  }'
    +     '.bq-vic-card.card-rewards .vic-claim-zone   { grid-area:claim; margin-top:clamp(2px,1vmin,8px); }'
    +   '}'
    + '</style>';

  // ── Card 1 HTML: THE MOMENT ──
  function buildCardMoment() {
    var refillHtml = _renderVictoryPipsInitial();
    var refillBlock = refillHtml
      ? ('<div id="rumble-victory-refill" style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:clamp(4px,1.5vmin,10px);transition:opacity 600ms ease-out;">'
         + '<span style="font-size:clamp(9px,1.7vmin,11px);color:#666;letter-spacing:.18em;font-family:ui-sans-serif,system-ui;">REFILLING</span>'
         + '<div id="rumble-victory-pips" style="display:flex;flex-wrap:wrap;justify-content:center;">' + refillHtml + '</div>'
         + '</div>')
      : '';
    return '<div class="bq-vic-backdrop" id="bq-vic-backdrop">'
      + '<div class="bq-vic-card card-moment">'
        + '<div style="font-size:clamp(10px,2.2vmin,14px);letter-spacing:.25em;color:' + tier.color + ';font-family:\'Cinzel\',serif;">⚔ VICTORY ⚔</div>'
        + '<div style="font-size:clamp(26px,7vmin,56px);font-weight:700;color:' + tier.color + ';letter-spacing:.06em;text-shadow:0 0 22px ' + tier.color + ';text-align:center;line-height:1.1;font-family:\'Cinzel\',serif;">' + tier.label + '</div>'
        + '<div style="font-family:\'Crimson Pro\',serif;font-style:italic;font-size:clamp(13px,2.8vmin,19px);color:#d8d8d8;text-align:center;max-width:94%;line-height:1.5;">"' + flavor + '"</div>'
        + '<div style="font-family:ui-sans-serif,system-ui;text-align:center;color:#aaa;display:flex;flex-direction:column;align-items:center;gap:4px;">'
          + '<span style="font-size:clamp(9px,1.9vmin,12px);color:#888;letter-spacing:.18em;font-family:ui-sans-serif,system-ui;">FAVORITE MOVE</span>'
          + '<span style="font-size:clamp(13px,2.6vmin,16px);font-family:ui-sans-serif,system-ui;">' + favLine + '</span>'
        + '</div>'
        + refillBlock
        + '<button id="bq-vic-btn-continue" class="bq-vic-btn" style="'
        + 'background:linear-gradient(180deg,' + tier.color + ' 0%,' + tier.color + 'cc 100%);'
        + 'border-color:' + tier.color + ';color:#000;'
        + 'box-shadow:0 4px 20px ' + tier.color + '66;'
        + 'margin-top:clamp(4px,1.5vmin,12px);'
        + '">CONTINUE →</button>'
      + '</div>'
      + sharedCss
      + '</div>';
  }

  // ── Card 2 HTML: THE NUMBERS ──
  function buildCardRewards() {
    // Stats grid cells
    var cells = [];
    cells.push({ label: 'TIME', value: timeStr, color: '#eee', mono: true });
    cells.push({ label: 'HP',   value: player.hp + '/' + player.hpMax, color: '#eee' });
    if (_battleStats.damageDealt > 0) cells.push({ label: 'DMG DEALT', value: _battleStats.damageDealt, color: '#E24B4A' });
    if (_battleStats.damageTaken > 0) cells.push({ label: 'DMG TAKEN', value: _battleStats.damageTaken, color: '#D4537E' });
    if (_battleStats.biggestDamageDealt > 0) cells.push({ label: 'HIGHEST HIT', value: _battleStats.biggestDamageDealt, color: '#F57C00' });
    if (_battleStats.biggestDamageTaken > 0) cells.push({ label: 'BIGGEST HIT TAKEN', value: _battleStats.biggestDamageTaken, color: '#D4537E' });
    if (_battleStats.totalHealed > 0) cells.push({ label: 'HP HEALED', value: _battleStats.totalHealed, color: '#9adb9a' });
    if (_battleStats.biggestHealPlayer > 0) cells.push({ label: 'BIGGEST HEAL', value: _battleStats.biggestHealPlayer, color: '#9adb9a' });
    if (_battleStats.totalEntityHeal > 0) cells.push({ label: 'ENEMY HEALED', value: _battleStats.totalEntityHeal, color: '#B586D6' });
    if (_battleStats.biggestHealEntity > 0) cells.push({ label: 'BIGGEST ENEMY HEAL', value: _battleStats.biggestHealEntity, color: '#B586D6' });
    if (_battleStats.damageDealt > 0) cells.push({ label: 'DPS', value: dps, color: '#F5D000' });
    if (_battleStats.critsLanded > 0) cells.push({ label: 'CRITS', value: _battleStats.critsLanded, color: '#F57C00' });
    if (_battleStats.overloadsFired > 0) cells.push({ label: 'OVERLOADS', value: _battleStats.overloadsFired, color: '#7B2FBE' });
    if (_battleStats.armorAbsorbed > 0) cells.push({ label: 'ARMOR ABSORBED', value: _battleStats.armorAbsorbed, color: '#AAA' });
    if (player && (player.reviveCount || 0) > 0) {
      var effPenalty = Math.min(90, 10 * player.reviveCount);
      cells.push({ label: 'REVIVES (−' + effPenalty + '% LOOT)', value: player.reviveCount, color: '#e8dcc0' });
    }
    var rows = cells.map(function(c) {
      var monoStyle = c.mono ? 'font-family:ui-monospace,monospace;' : '';
      return '<div><div style="font-size:clamp(8px,1.6vmin,9px);letter-spacing:.12em;color:#888;margin-bottom:2px;">' + c.label + '</div>'
           + '<div style="font-size:clamp(12px,3vmin,18px);color:' + c.color + ';' + monoStyle + '">' + c.value + '</div></div>';
    }).join('');

    var refillHtml = _renderVictoryPipsInitial();
    var refillBlock = refillHtml
      ? ('<div id="rumble-victory-refill" class="vic-zone-wrap vic-refill-wrap" style="display:flex;flex-direction:column;align-items:center;gap:6px;transition:opacity 600ms ease-out;">'
         + '<span style="font-size:clamp(9px,1.7vmin,11px);color:#666;letter-spacing:.18em;font-family:ui-sans-serif,system-ui;">REFILLING</span>'
         + '<div id="rumble-victory-pips" style="display:flex;flex-wrap:wrap;justify-content:center;">' + refillHtml + '</div>'
         + '</div>')
      : '';

    return '<div class="bq-vic-backdrop" id="bq-vic-backdrop">'
      + '<div class="bq-vic-card card-rewards">'
        // Stats zone — label + body, content-sized
        + '<div class="vic-zone-wrap vic-stats-wrap">'
          + '<div class="vic-zone-label" style="font-size:clamp(10px,1.9vmin,12px);letter-spacing:.22em;color:#888;font-family:ui-sans-serif,system-ui;font-weight:500;">COMBAT</div>'
          + '<div class="vic-zone-body" style="display:grid;grid-template-columns:auto auto;gap:clamp(6px,1.6vmin,12px) clamp(16px,3.6vmin,28px);">'
            + rows
          + '</div>'
        + '</div>'
        // Rewards zone — pure loot content (gold/cheese/bricks gained, felled list)
        + '<div class="vic-zone-wrap vic-rewards-wrap">'
          + '<div class="vic-zone-label" style="font-size:clamp(10px,1.9vmin,12px);letter-spacing:.22em;color:#888;font-family:ui-sans-serif,system-ui;font-weight:500;">REWARDS</div>'
          + '<div class="vic-zone-body" style="display:flex;flex-direction:column;align-items:center;gap:clamp(6px,1.8vmin,12px);min-width:clamp(180px,32vmin,260px);">'
            + '<div style="text-align:center;line-height:1.7;">' + gainedLines + '</div>'
            + (_battleStats.enemiesKilled.length
              ? '<div style="font-size:clamp(9px,1.8vmin,11px);color:#666;text-align:center;font-style:italic;">Felled: ' + _battleStats.enemiesKilled.join(', ') + '</div>'
              : '')
          + '</div>'
        + '</div>'
        // Refill zone — own row below stats|rewards. Only included when refilling.
        + refillBlock
        // Claim button
        + '<div class="vic-claim-zone" style="display:flex;justify-content:center;">'
          + '<button id="bq-vic-btn-claim" class="bq-vic-btn" style="'
          + 'background:linear-gradient(180deg,' + tier.color + ' 0%,' + tier.color + 'cc 100%);'
          + 'border-color:' + tier.color + ';color:#000;'
          + 'box-shadow:0 4px 20px ' + tier.color + '66;'
          + '">CLAIM →</button>'
        + '</div>'
      + '</div>'
      + sharedCss
      + '</div>';
  }

  // ── Render + state machine ──
  var root = document.getElementById('rumble-root') || document.body;
  var existing = document.getElementById('rumble-victory-screen');
  if (existing) existing.remove();
  // Inject CSS into <head> — guarantees rules are active regardless of
  // where card DOM is injected. Previous runs replace their own style node.
  var oldStyleNode = document.getElementById('bq-vic-styles');
  if (oldStyleNode) oldStyleNode.remove();
  var styleNode = document.createElement('style');
  styleNode.id = 'bq-vic-styles';
  styleNode.textContent = sharedCss.replace(/^<style>/, '').replace(/<\/style>$/, '');
  document.head.appendChild(styleNode);

  var wrapper = document.createElement('div');
  wrapper.id = 'rumble-victory-screen';
  root.appendChild(wrapper);
  // Body flag — suppresses viewport-level scrollbars while victory is up.
  // The backdrop covers everything, so no ambient scroll should peek through.
  document.body.classList.add('bq-vic-active');

  var dismissed = false;
  var dismiss = function() {
    if (dismissed) return;
    dismissed = true;
    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    var s = document.getElementById('bq-vic-styles');
    if (s) s.remove();
    document.body.classList.remove('bq-vic-active');
    _internalEnd('victory');
  };

  function showCard(step) {
    wrapper.innerHTML = (step === 'moment') ? buildCardMoment() : buildCardRewards();
    // Wire buttons for this card
    if (step === 'moment') {
      var btnC = document.getElementById('bq-vic-btn-continue');
      if (btnC) {
        btnC.addEventListener('click', function() {
          // Cross-fade to card 2 — trigger fadeout, swap after animation
          var bd = document.getElementById('bq-vic-backdrop');
          if (bd) bd.classList.add('fading-out');
          setTimeout(function() { showCard('rewards'); }, 280);
        });
        btnC.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
      }
    } else {
      var btnX = document.getElementById('bq-vic-btn-claim');
      if (btnX) {
        btnX.addEventListener('click', dismiss);
        btnX.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
      }
    }
    // Wire the debug overlay toggle
    _wireVictoryDebug();
  }
  showCard('moment');

  // 60s absolute safety fallback in case buttons never get tapped.
  setTimeout(dismiss, 60000);
}


// Debug overlay — a tiny 🔍 button in the top-right of the victory screen.
// Tapping it outlines all victory elements in colored borders and shows a
// floating readout of their computed styles + dimensions. Useful for
// diagnosing layout issues on mobile where devtools aren't available.
// Tap again to toggle off.
function _wireVictoryDebug() {
  // Inject the debug button if it doesn't exist yet in this card's DOM
  var bd = document.getElementById('bq-vic-backdrop');
  if (!bd) return;
  var existing = bd.querySelector('.bq-vic-debug-btn');
  if (!existing) {
    var btn = document.createElement('button');
    btn.className = 'bq-vic-debug-btn';
    btn.textContent = '🔍';
    btn.style.cssText = 'position:absolute;top:8px;right:8px;width:32px;height:32px;'
      + 'border-radius:50%;border:1px solid #333;background:#1a1a24;color:#888;'
      + 'font-size:14px;cursor:pointer;z-index:210;padding:0;line-height:1;'
      + 'display:flex;align-items:center;justify-content:center;';
    btn.addEventListener('click', _toggleVictoryDebug);
    btn.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
    bd.appendChild(btn);
  }
  // If debug was active before card swap, re-apply to the new DOM
  if (window._bqVicDebugActive) {
    _applyVictoryDebug();
  }
}

function _toggleVictoryDebug() {
  window._bqVicDebugActive = !window._bqVicDebugActive;
  if (window._bqVicDebugActive) {
    _applyVictoryDebug();
  } else {
    _removeVictoryDebug();
  }
}

function _applyVictoryDebug() {
  var bd = document.getElementById('bq-vic-backdrop');
  if (!bd) return;

  // Outline every victory element
  var outlineRules = [
    { sel: '.bq-vic-card',        color: '#ff3b3b', label: 'CARD' },
    { sel: '.vic-zone-wrap',      color: '#3bff3b', label: 'ZONE-WRAP' },
    { sel: '.vic-zone-label',     color: '#3bbcff', label: 'LABEL' },
    { sel: '.vic-zone-body',      color: '#ffbc3b', label: 'BODY' },
    { sel: '.vic-claim-zone',     color: '#bc3bff', label: 'CLAIM-ZONE' },
  ];
  outlineRules.forEach(function(r) {
    var nodes = bd.querySelectorAll(r.sel);
    nodes.forEach(function(n) {
      n.setAttribute('data-bq-vicdbg-prev-outline', n.style.outline || '');
      n.style.outline = '2px dashed ' + r.color;
      n.style.outlineOffset = '-2px';
    });
  });

  // Build a readout panel
  var readout = document.createElement('div');
  readout.id = 'bq-vic-debug-readout';
  readout.style.cssText = 'position:absolute;top:48px;right:8px;max-width:min(340px,60vw);'
    + 'background:#0a0a0a;border:1px solid #333;border-radius:6px;padding:8px;'
    + 'font-family:ui-monospace,monospace;font-size:10px;line-height:1.4;'
    + 'color:#ccc;z-index:210;max-height:80vh;overflow-y:auto;'
    + 'scrollbar-width:thin;';

  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var vmin = Math.min(vw, vh);
  var aspect = (vw / vh).toFixed(2);
  var lines = [];
  lines.push('<div style="color:#ffbc3b;font-weight:bold;">VIEWPORT</div>');
  lines.push('  w=' + vw + 'px h=' + vh + 'px');
  lines.push('  vmin=' + vmin + 'px aspect=' + aspect);
  lines.push('  media min-aspect-ratio:1/1 → ' + (vw >= vh ? '<span style="color:#3bff3b">FIRES</span>' : '<span style="color:#ff3b3b">BLOCKED</span>'));
  lines.push('');

  outlineRules.forEach(function(r) {
    var nodes = bd.querySelectorAll(r.sel);
    if (nodes.length === 0) return;
    lines.push('<div style="color:' + r.color + ';font-weight:bold;">' + r.label + ' (' + r.sel + ') × ' + nodes.length + '</div>');
    nodes.forEach(function(n, i) {
      var cs = window.getComputedStyle(n);
      var rect = n.getBoundingClientRect();
      var text = (n.textContent || '').substring(0, 20).replace(/\s+/g, ' ').trim();
      lines.push('  [' + i + '] "' + text + '"');
      lines.push('      box: ' + Math.round(rect.width) + '×' + Math.round(rect.height)
        + ' at (' + Math.round(rect.left) + ',' + Math.round(rect.top) + ')');
      lines.push('      font: ' + cs.fontSize + ' ' + cs.fontFamily.split(',')[0].replace(/["']/g, ''));
      lines.push('      display:' + cs.display + ' width:' + cs.width);
    });
    lines.push('');
  });
  readout.innerHTML = lines.join('<br>');
  bd.appendChild(readout);
}

function _removeVictoryDebug() {
  var bd = document.getElementById('bq-vic-backdrop');
  if (!bd) return;
  // Restore outlines
  var nodes = bd.querySelectorAll('[data-bq-vicdbg-prev-outline]');
  nodes.forEach(function(n) {
    var prev = n.getAttribute('data-bq-vicdbg-prev-outline');
    n.style.outline = prev;
    n.style.outlineOffset = '';
    n.removeAttribute('data-bq-vicdbg-prev-outline');
  });
  // Remove readout
  var r = document.getElementById('bq-vic-debug-readout');
  if (r) r.parentNode.removeChild(r);
}


// Internal — called by Rumble.forceEnd, _showVictoryScreen dismissal, or
// any terminal in-combat condition. Emits 'end' always, plus a reason-specific
// event ('victory' | 'defeat' | 'timeout' | 'quit').
function _internalEnd(reason) {
  running = false;
  _victoryRefillActive = false;
  _stopVictoryRefillLoop();
  // v4: tear down revive minigame if still active
  if (_reviveState && _reviveState.tickId) clearInterval(_reviveState.tickId);
  _reviveState = null;
  _revivePaused = false;
  // Clear bleed-out screen tint if still showing
  var bleedOverlay = document.getElementById('rumble-bleed-overlay');
  if (bleedOverlay) {
    bleedOverlay.style.transition = 'opacity 600ms ease-out';
    bleedOverlay.style.opacity = '0';
  }
  var reviveOverlay = document.getElementById('revive-overlay');
  if (reviveOverlay && reviveOverlay.parentNode) reviveOverlay.parentNode.removeChild(reviveOverlay);
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  emit('end', { reason: reason });
  if (reason === 'timeout')       emit('timeout');
  else if (reason === 'victory')  emit('victory');
  else if (reason === 'defeat')   emit('defeat');
  else                            emit('quit', { reason: reason });
}

// Module-private state helpers
var _startedAt = 0;
var _tickInterval = null;

function _computeState() {
  if (!player) return null;
  var first = null;
  for (var i = 0; i < entities.length; i++) { if (entities[i].hp > 0) { first = entities[i]; break; } }
  return {
    playerCls:   player.cls,
    playerHp:    player.hp,
    playerHpMax: player.hpMax,
    playerArmor: player.armor || 0,
    playerGold:  player.gold || 0,
    playerCheese: player.cheese || 0,
    playerBricks: Object.assign({}, player.bricks),
    playerBrickMax: Object.assign({}, player.brickMax || {}),
    enemyHp:     first ? first.hp : 0,
    enemyHpMax:  first ? first.hpMax : 0,
    elapsed:     _startedAt ? (performance.now() - _startedAt) / 1000 : 0,
    status:      running ? (player.hp > 0 ? 'active' : 'downed') : 'idle',
    mode:        (cfg && cfg.mode) || 'sandbox',
    overloadCount: player.overloadCount || 0,
    reviveCount:   player.reviveCount || 0,    // S013.6: heart-revives this run (drives loot penalty)
    battleStats: _battleStats ? {
      damageDealt:    _battleStats.damageDealt || 0,
      damageTaken:    _battleStats.damageTaken || 0,
      armorAbsorbed:  _battleStats.armorAbsorbed || 0,
      bricksUsed:     Object.assign({}, _battleStats.bricksUsed || {}),
      bricksGained:   Object.assign({}, _battleStats.bricksGained || {}),
      goldGained:     _battleStats.goldGained || 0,
      cheeseEaten:    _battleStats.cheeseEaten || 0,
      critsLanded:    _battleStats.critsLanded || 0,
      overloadsFired: _battleStats.overloadsFired || 0,
      hpLow:          _battleStats.hpLow === 9999 ? (player.hpMax||0) : _battleStats.hpLow,
      enemiesKilled:  (_battleStats.enemiesKilled || []).slice(),
      activeCombatMs: _battleStats.activeCombatMs || 0,
      damageByColor:  Object.assign({}, _battleStats.damageByColor || {}),
      damageByTarget: Object.assign({}, _battleStats.damageByTarget || {}),
      // v4 single-hit highlights
      biggestDamageDealt: _battleStats.biggestDamageDealt || 0,
      biggestDamageTaken: _battleStats.biggestDamageTaken || 0,
      biggestHealPlayer:  _battleStats.biggestHealPlayer || 0,
      biggestHealEntity:  _battleStats.biggestHealEntity || 0,
      totalHealed:        _battleStats.totalHealed || 0,
      totalEntityHeal:    _battleStats.totalEntityHeal || 0,
    } : null,
  };
}

// ═══════════════════════════════════════════════════
// INIT / TEARDOWN (private — called by public API)
// ═══════════════════════════════════════════════════
var _eventHandler = null;
var _cleanupFns = [];
var _initialized = false;

function emit(type, data) {
  if (_eventHandler) { try { _eventHandler(type, data || {}); } catch(e) { console.error('[Rumble] listener error:', e); } }
}

function _internalInit(options) {
  if (_initialized) return;
  options = options || {};
  _eventHandler = options.onEvent || null;

  canvas = document.getElementById('rumble-canvas');
  if (!canvas) {
    console.error('[Rumble] init failed: #rumble-canvas not found');
    return;
  }
  ctx = canvas.getContext('2d');
  resize();

  var resizeHandler = function() { resize(); };
  window.addEventListener('resize', resizeHandler);
  _cleanupFns.push(function() { window.removeEventListener('resize', resizeHandler); });

  var cvDown = function(e) { onPointerDown(e); };
  var cvMove = function(e) { onPointerMove(e); };
  var cvUp   = function(e) { onPointerUp(e); };
  canvas.addEventListener('mousedown',  cvDown, { passive:false });
  canvas.addEventListener('mousemove',  cvMove, { passive:false });
  canvas.addEventListener('mouseup',    cvUp);
  canvas.addEventListener('touchstart', cvDown, { passive:false });
  canvas.addEventListener('touchmove',  cvMove, { passive:false });
  canvas.addEventListener('touchend',   cvUp);
  _cleanupFns.push(function() {
    canvas.removeEventListener('mousedown',  cvDown);
    canvas.removeEventListener('mousemove',  cvMove);
    canvas.removeEventListener('mouseup',    cvUp);
    canvas.removeEventListener('touchstart', cvDown);
    canvas.removeEventListener('touchmove',  cvMove);
    canvas.removeEventListener('touchend',   cvUp);
  });

  _initialized = true;
  draw(); // idle frame
  emit('ready');
}

function _internalTeardown() {
  if (!_initialized) return;
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
  _cleanupFns.forEach(function(fn) { try { fn(); } catch(e){} });
  _cleanupFns = [];
  _eventHandler = null;
  _initialized = false;
  player = null;
  entities = [];
}

// ═══════════════════════════════════════════════════════════════════════
// INLINE-EVENT BRIDGE
// ═══════════════════════════════════════════════════════════════════════
// The brick bar uses onpointerdown="onBrickDown(...)" inline-event attributes
// because that's how the original code was written. Inline-event attributes
// are resolved against the GLOBAL scope, but our module-scope functions are
// not on window. We bridge by exposing the needed handlers.
window.onBrickDown = function(e, color) { return onBrickDown(e, color); };

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════
window.Rumble = {
  // ── Lifecycle ──
  init: function(options) { _internalInit(options); },
  teardown: function() { _internalTeardown(); },

  // ── Control ──
  start: function(config) {
    if (!_initialized) { console.warn('[Rumble] start() called before init()'); return; }
    _internalStart(config);
  },
  setPauseState: function(paused) {
    if (!player || !_initialized) return;
    if (paused) {
      if (running) { running = false; emit('pause'); }
    } else {
      if (!running) {
        running = true;
        lastTs = performance.now();
        rafId = requestAnimationFrame(loop);
        emit('resume');
      }
    }
  },
  forceEnd: function(reason) { _internalEnd(reason || 'quit'); },

  // ── Queries ──
  isActive: function() { return !!(running && player); },
  getState: function() { return _computeState(); },
  getConfig: function() { return cfg ? JSON.parse(JSON.stringify(cfg)) : null; },
  getDebugInfo: function() {
    return {
      running: running,
      hasPlayer: !!player,
      entityCount: entities.length,
      projectileCount: (blueBolts||[]).length,
      trapCount: (traps||[]).length,
      wallCount: (grayWalls||[]).length,
      floatingTexts: (floatingTexts||[]).length,
      // Per-entity details — shown by waves-live-debug to identify what's
      // hanging around when a wave doesn't advance. Keep it cheap; this gets
      // polled every frame.
      entitiesDetail: entities.map(function(g) {
        return {
          type: g.type,
          hp: Math.round(g.hp || 0),
          hpMax: g.hpMax || 0,
          x: Math.round(g.x || 0),
          y: Math.round(g.y || 0),
          dead: !!g.dead,
          burrowHidden: !!g._burrowHidden,
          phaseFade: (g._phaseFadeTimer || 0) > 0,
          splitDepth: g._splitDepth || 0,
          deathSig: g.deathSignature || null,
          aiState: g._burrowState || g.swingState || null,
        };
      }),
    };
  },

  // ── DM tools ──
  injectBricks: function(delta) {
    if (!player || !delta) return;
    Object.keys(delta).forEach(function(c) {
      if (typeof player.bricks[c] === 'number') {
        player.bricks[c] = Math.max(0, player.bricks[c] + delta[c]);
      }
    });
    renderBrickBar();
  },
  setPlayerHP: function(n) {
    if (!player) return;
    player.hp = Math.max(0, Math.min(player.hpMax, n|0));
    updateHUD();
    // v4: if the setter drops player to 0, trigger the defeat/revive minigame
    if (player.hp <= 0 && running && !_revivePaused && typeof respawnPlayer === 'function') {
      respawnPlayer();
    }
  },
  setEnemyHP: function(n) {
    var g = entities.find(function(x){ return x.hp > 0; });
    if (!g) return;
    g.hp = Math.max(0, Math.min(g.hpMax, n|0));
  },
  // Spawn a single entity into an active rumble. Used by waves mode in
  // rumble_test for staged enemy reveals. Type defaults to cfg.entityType
  // (which may be 'random'). Re-applies any dialer resistances. Returns
  // the spawned entity reference, or null if rumble isn't running.
  spawnEntity: function(type) {
    if (!_initialized || !player) return null;
    var bounds = getRumbleBounds();
    // Spread angle around existing entities so new spawns don't all land
    // in the same spot. Pseudo-random offset is fine for a dev tool.
    var angleOffset = (entities.length / Math.max(1, entities.length + 1)) * Math.PI * 2
                       + Math.random() * 0.5;
    var ent = makeEntity(bounds, angleOffset, type || (cfg && cfg.entityType));
    if (cfg && cfg.entityResistances) {
      ent.resistances = Object.assign(ent.resistances || {}, cfg.entityResistances);
    }
    entities.push(ent);
    return ent;
  },
  // Pause/unpause gameplay sim from a host page. While true, update(dt) is
  // skipped — entities don't tick, damage doesn't apply, DoTs don't fire.
  // draw() and HUD continue rendering so visuals stay accurate. Used by
  // test harness when wave-victory or run-summary screens are showing.
  setExternalPause: function(paused) {
    _externalPause = !!paused;
    // Clear the active-combat timestamp on unpause so the tracker doesn't
    // count the pause window as engagement time.
    if (!paused && _battleStats) {
      _battleStats._lastDamageAt = 0;
    }
  },
  // Instantly refill all brick charges to their max. Used between waves
  // (waves mode skips the post-rumble refill loop). No animation; the
  // brick bar just shows full pips next render.
  refillBricks: function() {
    if (!player || !player.bricks || !player.brickMax) return;
    Object.keys(player.brickMax).forEach(function(c) {
      player.bricks[c] = player.brickMax[c];
    });
    if (typeof renderBrickBar === 'function') renderBrickBar();
  },
  // Eat all cheese in player inventory. Each wheel grants +1 max HP and
  // +1 current HP (the simplified pre-0.17.0 cheese behavior). Returns
  // the number of wheels consumed. Used by waves mode auto-consume; will
  // be wired to the real cheese-eat UI when the cheese system ships.
  eatAllCheese: function() {
    if (!player) return 0;
    var n = player.cheese || 0;
    if (n <= 0) return 0;
    player.cheese = 0;
    player.hpMax += n;
    player.hp += n;
    showFloatingText(player.x, player.y - 70, '🧀 +' + n + ' HP MAX', '#FFD96A', player);
    if (typeof updateHUD === 'function') updateHUD();
    return n;
  },
};

})(); // end IIFE
