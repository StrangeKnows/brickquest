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
//     setEnemyHP(n)         clamp to [0, enemy.hpMax] — targets first living goblin
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
const ARENA_DURATION = 30; // seconds (30 for real game, 5 placeholder)

// CLASS_META — arena stats. These track the Combat & Economy v1 spec.
// For structured playtest of class kits, see server-seeded values in server.js
// (arena_test still uses randomized brick counts for flexibility).
const CLASS_META = {
  warrior:     { color:'#993C1D', icon:'⚔️', hp:14, die:'d8', speed:150, signature:'red',    secondary:'gray'    },
  wizard:      { color:'#3C3489', icon:'🔮', hp:6,  die:'d6', speed:180, signature:'blue',   secondary:'purple'  },
  scout:       { color:'#085041', icon:'🏃', hp:9,  die:'d6', speed:260, signature:'orange', secondary:'red'     },
  builder:     { color:'#C87800', icon:'🔧', hp:12, die:'d6', speed:150, signature:'gray',   secondary:'orange'  },
  mender:      { color:'#72243E', icon:'💊', hp:8,  die:'d4', speed:160, signature:'white',  secondary:'purple'  },
  beastcaller: { color:'#27500A', icon:'🐾', hp:10, die:'d6', speed:220, signature:'green',  secondary:'yellow'  },
};

// Combat & Economy v1 spec. See NOTES.md for full design doc.
const BRICK_ECONOMY = {
  refreshRates: { signature: 3.0, secondary: 5.0, baseline: 10.0 },
  poolCaps:     { signature: 4,   secondary: 3,   baseline: 2 },
  fatigueCurve: [1.0, 0.8, 0.6, 0.5, 0.4],
  offClassFatigueTicks: 2,
};

function brickTier(cls, color) {
  var meta = CLASS_META[cls];
  if (!meta) return 'baseline';
  if (color === meta.signature) return 'signature';
  if (color === meta.secondary) return 'secondary';
  return 'baseline';
}

// Display scale: 0.60 (phones) to 1.00 (desktops). Smooth-interpolated.
// Reference = smaller of viewport W/H so tall portrait phones still scale down.
// Used to shrink player radius, goblin radius, and aggro ranges on small screens.
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

// Fatigue: call on overload fire. Returns damage/effectiveness multiplier to apply.
// - 1-brick "overloads" are free: no fatigue cost, multiplier 1.0.
// - 2+ brick overloads increment counters and apply the curve:
//     signature/secondary tier → signature counter +1
//     baseline tier → off-class counter += offClassFatigueTicks (2)
// Multiplier is read BEFORE increment (so first multi-brick fire = 100%).
function consumeFatigue(color, count) {
  if (!player || !player.fatigue) return 1.0;
  if (!cfg || cfg.mode !== 'spec') return 1.0;
  if (!count || count < 2) return 1.0; // single-brick uses are exempt
  var tier = brickTier(player.cls, color);
  var curve = BRICK_ECONOMY.fatigueCurve;
  var floor = curve[curve.length - 1];
  var mult, counter;
  if (tier === 'signature' || tier === 'secondary') {
    counter = player.fatigue.signature;
    mult = (counter < curve.length) ? curve[counter] : floor;
    player.fatigue.signature += 1;
  } else {
    counter = player.fatigue.offClass;
    mult = (counter < curve.length) ? curve[counter] : floor;
    player.fatigue.offClass += BRICK_ECONOMY.offClassFatigueTicks;
  }
  player.overloadCount = (player.overloadCount || 0) + 1;
  return mult;
}

const BRICK_COLORS = {
  red:'#E24B4A', blue:'#006DB7', green:'#1D9E75', white:'#EFEFEF',
  gray:'#AAAAAA', purple:'#7B2FBE', yellow:'#F5D000', orange:'#F57C00',
  black:'#333333'
};

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
var canvas, ctx, W, H;
var running = false;
var rafId = null;
var lastTs = 0;
var cfg = null; // last start(config) object

var player = null;
var goblins = [];
var deadGoblins = [];
var pendingVictory = 0; // countdown to victory screen
var arena = {};
var timerLeft = ARENA_DURATION;
var timerInterval = null;

// Touch/drag state
var dragActive = false;
var dragTarget = null;

// Dash state
var dashCooldown = 0;
var dashActive = false;
var dashTarget = null;
var dashGoblin = null;
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
  var meta = CLASS_META[cls];
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
    fatigue: { signature: 0, offClass: 0 }, // overload fatigue counters (spec mode)
    overloadCount: 0,              // total overloads this battle (any color)
  };
}

// ═══════════════════════════════════════════════════
// ARENA BOUNDS
// ═══════════════════════════════════════════════════
function getArenaBounds() {
  var pad = 12;
  // Brick buttons are 48px wide; add small breathing room (no dark card anymore).
  var panelWidth = 54;
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
  var touch = e.touches ? e.touches[0] : e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width / rect.width),
    y: (touch.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function onPointerDown(e) {
  if (!running) return;
  e.preventDefault();
  var pos = getEventPos(e);

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
      // If released near a goblin, track toward them
      var rect2 = canvas.getBoundingClientRect();
      var cx2 = (pos.x - rect2.left) * (canvas.width / rect2.width);
      var cy2 = (pos.y - rect2.top) * (canvas.height / rect2.height);
      dashGoblin = goblins.find(function(g){ return Math.hypot(cx2-g.x,cy2-g.y)<g.r+50; }) || null;
      showFloatingText(player.x, player.y - 50, 'EVADE!', player.color);
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
  var bounds = getArenaBounds();

  // Dash cooldown tick
  if (dashCooldown > 0) dashCooldown = Math.max(0, dashCooldown - dt);

  // Dash movement — overrides normal movement
  if (dashActive) {
    dashTimer -= dt;
    // If tracking a goblin, update target to follow them
    if (dashGoblin && dashGoblin.hp > 0) {
      dashTarget = { x: dashGoblin.x, y: dashGoblin.y };
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
      dashGoblin = null;
      dragTarget = null; // clear drag target so normal movement doesn't continue
    }
  } else if (dragTarget) {
    var dx = dragTarget.x - player.x;
    var dy = dragTarget.y - player.y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 8) {
      var step = Math.min(player.speed * dt, dist);
      player.x += (dx / dist) * step;
      player.y += (dy / dist) * step;
    } else if (!dragActive) {
      dragTarget = null;
    }
  }

  // Clamp player
  player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
  player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));

  // Push player and goblin apart if overlapping
  // Push goblins away from player — player is not moved by collision
  goblins.forEach(function(goblin) {
    var odx = player.x - goblin.x, ody = player.y - goblin.y;
    var odist = Math.sqrt(odx*odx+ody*ody);
    var minDist = player.r + goblin.r;
    if (odist < minDist && odist > 0) {
      var push = minDist - odist;
      var nx = odx/odist, ny = ody/odist;
      goblin.x -= nx*push;
      goblin.y -= ny*push;
      goblin.x = Math.max(bounds.x+goblin.r, Math.min(bounds.x+bounds.w-goblin.r, goblin.x));
      goblin.y = Math.max(bounds.y+goblin.r, Math.min(bounds.y+bounds.h-goblin.r, goblin.y));
    }
  });

  // Goblin
  deadGoblins.forEach(function(g) { g.deathTimer -= dt; });
  deadGoblins = deadGoblins.filter(function(g) { return g.deathTimer > 0; });
  goblins.forEach(function(g) { updateGoblinConfusion(g, dt); updateGoblin(g, dt, bounds); });
  goblins.forEach(function(g) { if (g.hp <= 0 && !g.dead) { g.dead = true; g.deathTimer = 2.5; deadGoblins.push(g); } });
  goblins = goblins.filter(function(g) { return !g.dead; });
  // Brick actions
  tickBrickCooldowns(dt);
  // Brick refresh. In 'spec' mode, uses BRICK_ECONOMY per-tier rates based on class.
  // In 'sandbox' mode (default), uses a simple flat table for fast testing.
  if (player) {
    if (!player.brickRecharge) player.brickRecharge = {};
    if (!player.brickMax) player.brickMax = {};
    var SANDBOX_RATES = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
    var useSpec = (cfg && cfg.mode === 'spec');
    Object.keys(player.bricks).forEach(function(c) {
      if (!player.brickMax[c]) player.brickMax[c] = player.bricks[c];
      var isHeld = overloadState && overloadState.color === c;
      if (player.bricks[c] < (player.brickMax[c]||0)) {
        if (!isHeld) player.brickRecharge[c] = (player.brickRecharge[c]||0) + dt;
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

  // Blue bolts, traps, armor
  updateBlueBolts(dt, bounds);
  updateTraps(dt);
  updateGrayWalls(dt);
  updateArmorBursts(dt);
  updateGreenBurst(dt);
  updateYellowAura(dt);
  updateConfuseParticles(dt);
  updateRegen(dt);
  goblins.forEach(function(g) {
    updateGoblinPoison(g, dt);
    g.slowTimer = Math.max(0, (g.slowTimer||0) - dt);
    if (g.slowTimer <= 0) g.slowed = false;
    g.attackSlowTimer = Math.max(0, (g.attackSlowTimer||0) - dt);
    if (g.attackSlowTimer <= 0) g.attackSlowed = false;
  });
  updatePurpleBursts(dt);
  updatePurpleParticles(dt);
  updateBlackEffect(dt);
}

// ═══════════════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════════════
function draw() {
  ctx.clearRect(0, 0, W, H);

  var bounds = getArenaBounds();

  // ── Arena floor ──
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

  // ── Arena border glow ──
  ctx.save();
  ctx.shadowColor = player ? player.color : '#333';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = player ? player.color + '44' : '#33333344';
  ctx.lineWidth = 2;
  roundRect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 16);
  ctx.stroke();
  ctx.restore();

  // ── Drag indicator ──
  if (dragTarget && player) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = player.color + (dragActive ? '88' : '33');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(dragTarget.x, dragTarget.y);
    ctx.stroke();
    // Target dot
    ctx.setLineDash([]);
    ctx.fillStyle = player.color + (dragActive ? '44' : '22');
    ctx.beginPath();
    ctx.arc(dragTarget.x, dragTarget.y, 8, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = player.color + (dragActive ? '88' : '44');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ── Black effect (below everything) ──
  var _bounds = getArenaBounds();
  drawBlackEffect(_bounds);
  // ── Traps ──
  drawTraps();
  // ── Yellow aura (persistent daze field) ──
  drawYellowAura();
  // ── Confuse particles ──
  drawConfuseParticles();
  // ── Green burst ──
  drawGreenBurst();
  // ── Purple burst ──
  drawPurpleBursts();
  // ── Drag indicators ──
  drawBlueDrag();
  drawDragIndicator(greenDragPos, '#1D9E75', 'PUSH');
  // Yellow — show AoE ring (around player by default, around drag target when over arena)
  if (player) {
    var rect2 = canvas.getBoundingClientRect();
    var yellowOverArena = yellowDragPos &&
      yellowDragPos.x >= rect2.left && yellowDragPos.x <= rect2.right &&
      yellowDragPos.y >= rect2.top  && yellowDragPos.y <= rect2.bottom;
    var ycx, ycy;
    if (yellowOverArena) {
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
      // Line from player to drag target if over arena
      if (yellowOverArena) {
        ctx.setLineDash([4,6]);
        ctx.strokeStyle = '#F5D000aa'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(ycx, ycy); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Radius ring
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#F5D000';
      ctx.shadowColor = '#F5D000'; ctx.shadowBlur = 10;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      var yTier = (overloadState && overloadState.color==='yellow') ? Math.max(1, Math.floor(overloadState.timer / OVERLOAD_TIER) + 1) : 1;
      var yRadius = 50 + yTier * 37;
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
    var oOverArena = orangeDragPos.x >= rectO.left && orangeDragPos.x <= rectO.right &&
                     orangeDragPos.y >= rectO.top  && orangeDragPos.y <= rectO.bottom;
    if (oOverArena) {
      var ocx = (orangeDragPos.x - rectO.left) * (canvas.width / rectO.width);
      var ocy = (orangeDragPos.y - rectO.top)  * (canvas.height / rectO.height);
      var oTier = overloadState && overloadState.color==='orange' ?
        Math.max(1, Math.min(player.brickMax?player.brickMax['orange']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
      var oRadius = 25 + oTier * 15;
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
  // Gray — show wall radius on hold, move to drag target when over arena
  if (player) {
    var rectG = canvas.getBoundingClientRect();
    var grayOverArena = grayDragPos &&
      grayDragPos.x >= rectG.left && grayDragPos.x <= rectG.right &&
      grayDragPos.y >= rectG.top  && grayDragPos.y <= rectG.bottom;
    var gcx = grayOverArena ? (grayDragPos.x - rectG.left) * (canvas.width / rectG.width) : player.x;
    var gcy = grayOverArena ? (grayDragPos.y - rectG.top)  * (canvas.height / rectG.height) : player.y;
    var showGrayRing = grayOverArena;
    if (showGrayRing) {
      var gTier = overloadState && overloadState.color === 'gray' ?
        Math.min(Math.floor(overloadState.timer / OVERLOAD_TIER) + 1, player.brickMax ? (player.brickMax['gray']||1) : 1) : 1;
      var gWallR = 30 + gTier * 22;
      ctx.save();
      var gPulse = 0.3 + 0.15 * Math.sin(performance.now() * 0.004);
      if (grayOverArena) {
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
  // Black — show darkness radius on hold/drag
  if (player) {
    var rectB = canvas.getBoundingClientRect();
    var blackOverArena = blackDragPos &&
      blackDragPos.x >= rectB.left && blackDragPos.x <= rectB.right &&
      blackDragPos.y >= rectB.top  && blackDragPos.y <= rectB.bottom;
    var bcx = blackOverArena ? (blackDragPos.x - rectB.left) * (canvas.width / rectB.width) : player.x;
    var bcy = blackOverArena ? (blackDragPos.y - rectB.top)  * (canvas.height / rectB.height) : player.y;
    var showBlackRing = (overloadState && overloadState.color === 'black') || blackDragPos;
    if (showBlackRing) {
      var bTierR = (overloadState && overloadState.color === 'black') ?
        Math.max(1, Math.min(player.brickMax?player.brickMax['black']:1, Math.floor(overloadState.timer/OVERLOAD_TIER)+1)) : 1;
      var bRadius = Math.min(50 + (bTierR - 1) * 100, 900);
      ctx.save();
      if (blackOverArena) {
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

  // ── Goblin ──
  deadGoblins.forEach(function(g) { drawDeadGoblin(g); });
  goblins.forEach(function(g) { drawGoblin(g); });

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
      if (player.cls === 'warrior') {
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
      } else if (player.cls === 'builder') {
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
      } else if (player.cls === 'mender') {
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
      } else if (player.cls === 'wizard') {
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
      } else if (player.cls === 'scout') {
        // Lightweight — just fast-rotating dashes
        ctx.shadowColor = '#085041';
        ctx.strokeStyle = '#22cc88'; ctx.lineWidth = 2;
        ctx.setLineDash([6,10]);
        ctx.beginPath(); ctx.arc(player.x, player.y, ar*0.88, -now3*0.003, -now3*0.003+Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (player.cls === 'beastcaller') {
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
    ctx.fillText(Math.round(player.hp) + '/' + player.hpMax, player.x, pBarY - 9);

    ctx.restore();

    // ── Player buff/debuff icons — above HP numbers, stacked vertically ──
    var playerEffects = [];
    var pNow = performance.now();
    var pPulse = 0.7 + 0.3 * Math.sin(pNow * 0.005);
    if (playerRegen && playerRegen.timer > 0)
      playerEffects.push({ icon: '✚', color: '#ffffff', timer: playerRegen.timer });
    if (player.iframes > 0)
      playerEffects.push({ icon: '🛡', color: '#88aaff', timer: player.iframes });
    if (dashCooldown > 0)
      playerEffects.push({ icon: '💨', color: '#F5D000', timer: dashCooldown });
    if (playerEffects.length > 0) {
      // Sort shortest duration first (top)
      playerEffects.sort(function(a, b) {
        if (a.timer === null) return 1;
        if (b.timer === null) return -1;
        return a.timer - b.timer;
      });
      var pRowH = 16;
      // pBarY - 5 is hp number position, stack above that
      var pStartY = pBarY - 10 - playerEffects.length * pRowH;
      playerEffects.forEach(function(fx, fi) {
        var ry = pStartY + fi * pRowH;
        ctx.save();
        ctx.globalAlpha = pPulse;
        ctx.textBaseline = 'middle';
        ctx.shadowColor = fx.color; ctx.shadowBlur = 5;
        ctx.font = '13px serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = fx.color;
        ctx.fillText(fx.icon, player.x - 2, ry);
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#dddddd';
        ctx.shadowBlur = 0;
        var lbl = fx.timer !== null ? Math.ceil(fx.timer)+'s' : (fx.label||'');
        ctx.fillText(lbl, player.x + 2, ry);
        ctx.restore();
      });
    }
  }

  // ── Player sparkles (white heal — follow player) ──
  if (player && playerSparkles.length) {
    playerSparkles = playerSparkles.filter(function(s) { return s.alpha > 0.05; });
    playerSparkles.forEach(function(s) {
      s.alpha -= 0.024;
      if (s.fixed) {
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
      ctx.fillText(s.text, s.fixed ? s.fx : player.x + s.ox, s.fixed ? s.fy : player.y + s.oy);
      ctx.restore();
    });
  }

  // ── Overload charge ──
  drawOverloadCharge();
  drawGrayWalls();
  drawRegen();
  // ── Armor bursts ──
  drawArmorBursts();

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
function loop(ts) {
  var dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  update(dt);
  draw();
  updateHUD();
  renderBrickBar();
  if (running) rafId = requestAnimationFrame(loop);
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
  var hpBar = document.getElementById('hp-bar');
  if (hpBar) {
    hpBar.style.width = hpPct + '%';
    hpBar.style.background = isOverheal
      ? 'linear-gradient(90deg,#7B2FBE,#b06fef)'
      : 'linear-gradient(90deg,#E24B4A,#ff6b6b)';
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

var _currentFatigueMult = 1.0; // multiplier from last fatigue consume; color-fire fns may read

function fireOverload(dragX, dragY, bricksUsed) {
  if (!overloadState || !player) return;
  var color = overloadState.color;
  var maxAvail = player.bricks[color] || 0;
  var count = bricksUsed !== undefined ? Math.min(bricksUsed, maxAvail) : maxAvail;
  if (count <= 0) return;
  count = Math.max(1, count);
  player.bricks[color] = Math.max(0, maxAvail - count);
  renderBrickBar();
  overloadState.fired = true;
  overloadState = null;

  // Apply fatigue (spec mode only; sandbox returns 1.0).
  // 1-brick uses are exempt — only 2+ brick overloads cost fatigue.
  // NOTE: v1 visualizes fatigue via the floating text below but does NOT
  // yet scale per-color damage/effects. Wiring fatigue into each overload's
  // damage math is a follow-up tuning pass once we play-test the curve.
  _currentFatigueMult = consumeFatigue(color, count);
  if (_currentFatigueMult < 1.0) {
    showFloatingText(player.x, player.y - 40, 'FATIGUE ' + Math.round(_currentFatigueMult*100) + '%', '#ff9944');
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
  if (color === 'green')  fireOverloadGreen(count, oxP, oyP);
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
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) < player.r + 30; // must drop on player
  if (isDrag) {
    startWhiteRegen(count);
    return;
  }
  // Tap overload — instant heal with scaled burst
  var healAmt = (player.cls === 'mender' ? 5 : 3) * count;
  var prev = player.hp;
  var cap2 = Math.max(player.hpMax, player.hp);
  player.hp = Math.min(cap2, player.hp + healAmt);
  showFloatingText(player.x, player.y-50, '✚ +' + Math.round(player.hp-prev) + (count>1?' x'+count:''), '#EFEFEF');
  spawnHealSparkles(count);
  // Overload: scale count, size, speed with overload level
  var sparkCount = Math.max(1, Math.round(count * 3 * vScale(count)));
  var sizeBase = 2 + count * 0.4;   // grows with overload
  var speedBase = 0.15 + count * 0.04;
  var spreadR = 6 + count * 4;
  var colors2 = ['#ffffff','#ffccee','#ff99cc','#ffe0f0'];
  if (count >= 4) colors2.push('#ffaaff','#cc88ff'); // purplish at high overload
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
}
function fireOverloadYellow(count, ox, oy) {
  // 3s aura. Radius scales with count. If cast from drag-target coords,
  // aura is anchored there. Otherwise it follows the player.
  // Per-goblin confuse duration is extended each frame they're in the aura,
  // so overloading (bigger radius, higher hit chance) naturally produces
  // longer confuses on the goblins you manage to keep inside.
  var dragOrigin = ox !== undefined && Math.hypot(ox - player.x, oy - player.y) > scaleDist(40);
  var r = scaleDist(120 + (count - 1) * 40);
  startYellowAura({
    follow: !dragOrigin,
    ox: dragOrigin ? ox : player.x,
    oy: dragOrigin ? oy : player.y,
    radius: r,
    duration: 3.0,
    label: 'MIND SHATTER x' + count + '!',
  });
}
function fireOverloadBlue(count) {
  var target = goblins.length ? goblins.reduce(function(a,b){
    return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null;
  if (!target) return;
  // Single bolt that scales with tier
  blueBolts.push({
    x: player.x, y: player.y,
    target: target,
    speed: 400 + count * 40,
    dmg: 4 * count,
    r: 6 + count * 4,       // x1=10, x5=26
    dead: false,
    travelled: 0,
    tier: count,
    glow: count * 10,
    delayTimer: 0,
  });
}
function fireOverloadOrange(count, ox, oy) {
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40);
  if (isDrag) {
    fireOverloadOrangeScatter(count, ox, oy);
  } else {
    // Tap overload — spike aura with count charges
    if (orangeAura) {
      orangeAura.charges += count;
      showFloatingText(player.x, player.y-50, 'WIRED +'+count, '#F57C00');
    } else {
      orangeAura = { charges: count, pulse: 0, r: player.r + 22 };
      showFloatingText(player.x, player.y-50, 'COILED x'+count, '#F57C00');
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
    // Base: 1 armor pip per brick in overload. Future "Iron Hide" skill will
    // unlock 2-per-brick (multiplier hook goes here once skill system lives).
    player.armor = Math.min(aMax2, prevArmor + count);
    var gained = player.armor - prevArmor;
    showFloatingText(player.x, player.y-50, 'FORTIFIED +'+gained+(count>1?' x'+count:''), '#AAAAAA');
    armorBursts.push({ x:player.x, y:player.y, r:player.r, alpha:0.9 });
  }
}
function fireOverloadGreen(count, ox, oy) {
  // Each brick beyond the first doubles poison damage (1-2-4-8-16)
  if (greenBurst && !greenBurst.done) {
    greenBurst._poisonedIds=[]; greenBurst._pushIds=[];
  } else {
    greenBurst = { r:0, maxR:scaleDist(400), alpha:1, done:false, _poisonedIds:[], _pushIds:[], ox:ox, oy:oy };
  }
  greenBurst._poisonMult = count; // passed to poison application
}
function fireOverloadPurple(count, ox, oy) {
  purpleBursts.push({ r:0, maxR:scaleDist(400), alpha:1, done:false, hit:false, ox:ox, oy:oy, dmgMult:count });
}
function fireOverloadBlack(count, ox, oy) {
  if (blackEffect) {
    blackEffect.RADIUS = Math.min(blackEffect.RADIUS + scaleDist(count * 100), scaleDist(900));
    blackEffect.timer = 3.0 * count;
    blackEffect.DURATION = 3.0 * count;
    blackEffect.tickDmg = count;
  } else {
    blackEffect = { timer:3.0*count, DURATION:3.0*count, tickTimer:0, TICK:0.5, alpha:0,
      FADE_IN:0.8, FADE_OUT:0.8, ox:ox, oy:oy, RADIUS:scaleDist(50+(count-1)*100), tickDmg:count };
  }
  goblins.forEach(function(g) {
    if (Math.hypot(g.x-ox,g.y-oy)<blackEffect.RADIUS) { g.attackSlowed=true; g.attackSlowTimer=blackEffect.DURATION; }
  });
}

function drawOverloadCharge() {
  if (!overloadState || overloadState.fired) return;
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
  // Count label
  if (bricksCharged > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.font = 'bold 16px Cinzel,serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 10 o'clock = -150 degrees = -5π/6
    var _oa = -Math.PI * 5/6;
    var _or = player.r + 36;
    ctx.fillText('x' + bricksCharged, player.x + Math.cos(_oa)*_or, player.y + Math.sin(_oa)*_or);
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
    pips += '<span style="display:inline-block;width:6px;height:6px;border-radius:2px;margin:1px;'
      + 'background:' + (filled ? bg : '#333') + ';'
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
    black:  function(cx,cy){ startBlackEffect(cx,cy); },
    orange: function(cx,cy,isDrag,tier){ startOrangeTrap(cx,cy,isDrag?tier:undefined); },
    yellow: function(cx,cy,isDrag){
      if (isDrag) {
        startYellowConfuse(cx, cy, scaleDist(87));
      } else {
        startYellowAura({ follow: true, radius: scaleDist(120), duration: 3.0, label: 'DAZE FIELD' });
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
    var _ab = getArenaBounds();
    var _outOfArena = canvasX < _ab.x || canvasX > _ab.x+_ab.w || canvasY < _ab.y || canvasY > _ab.y+_ab.h;
    if (_outOfArena) {
      if (upClientX > rect.right - 160) {
        isDrag = false;
        canvasX = player ? player.x : _ab.x + _ab.w/2;
        canvasY = player ? player.y : _ab.y + _ab.h/2;
      } else {
        canvasX = Math.max(_ab.x, Math.min(_ab.x+_ab.w, canvasX));
        canvasY = Math.max(_ab.y, Math.min(_ab.y+_ab.h, canvasY));
      }
    }

    blueDragPos=null; greenDragPos=null; purpleDragPos=null; blackDragPos=null;
    yellowDragPos=null; orangeDragPos=null; redDragPos=null; grayDragPos=null;
    blueDragActive=false; greenDragActive=false; purpleDragActive=false; blackDragActive=false;
    yellowDragActive=false; orangeDragActive=false; redDragActive=false;

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
        player.brickRecharge[color] = player.brickRecharge[color] || 0;
        renderBrickBar();
        var onTarget = goblins.find(function(g){ return Math.hypot(canvasX-g.x,canvasY-g.y)<g.r+30; });
        startBlueBolt(onTarget || null);
      } else if (dragFns[color]) {
        player.bricks[color]--;
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
function showFloatingText(x, y, text, color) {
  var now = performance.now();
  var isDmg = text.match(/^-[0-9]/);
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
      merged.text = '-' + merged.accum + (text.includes('☠') ? ' ☠' : text.includes('HP') ? ' HP' : '');
      var scale = Math.min(2.6, 0.72 + Math.log2(merged.accum + 1) * 0.38);
      merged.fontSize = Math.round(10 * scale);
      merged.fadeRate = Math.max(0.005, 0.02 / scale);
      merged.vy = -(30 + scale * 12);
      return;
    }
  }
  var num2 = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
  var hasIcon = /[☠🩸💀✚✨]/.test(text);
  var scale2 = num2 > 0 ? Math.min(2.6, 0.72 + Math.log2(num2 + 1) * 0.38) : (hasIcon ? 1.0 : 0.9);
  var fontSize2 = Math.round(10 * scale2);
  var fadeRate2 = Math.max(0.005, 0.02 / scale2);
  var riseSpeed2 = 30 + scale2 * 12;
  floatingTexts.push({ x, y, text, color: color||'#fff', alpha:1,
    vy: -riseSpeed2, fadeRate: fadeRate2, fontSize: fontSize2,
    mergeable: !!isDmg, accum: num2, spawnTime: now });
}

// (injected into draw loop)
var _origDraw = draw;
draw = function() {
  _origDraw();
  var now = performance.now();
  floatingTexts = floatingTexts.filter(function(ft) { return ft.alpha > 0.05; });
  floatingTexts.forEach(function(ft) {
    ft.y += ft.vy * 0.016;
    ft.alpha -= (ft.fadeRate || 0.02);
    ctx.save();
    ctx.globalAlpha = ft.alpha;
    ctx.fillStyle = ft.color;
    var fs = ft.fontSize || 14;
    ctx.font = 'bold ' + fs + 'px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = (fs / 14) * 8 * ft.alpha;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  });
};

// ═══════════════════════════════════════════════════
// GOBLIN OBJECT
// ═══════════════════════════════════════════════════
function makeGoblin(bounds, angleOffset) {
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
  return {
    x: gx, y: gy,
    spawnX: gx, spawnY: gy,
    r: Math.round(18 * scale),
    speed: 165,
    hp: 50, hpMax: 50,
    state: 'patrol',   // 'patrol' | 'chase' | 'bounce'
    AGGRO_RANGE: Math.round(200 * scale),
    DEAGGRO_RANGE: Math.round(320 * scale),
    aggroed: false,   // tracks if currently aggro'd
    // Patrol wander
    wanderTarget: { x: gx, y: gy },
    wanderTimer: 0,
    // Bounce after attack
    bounceVx: 0, bounceVy: 0,
    bounceTimer: 0,
    // Attack cooldown
    attackCooldown: 0,
    attackDebuff: 0,
    // Flash
    flashTimer: 0,
    // Damage dealt
    dmg: 1,
  };
}


function vScale(tier) { return tier <= 1 ? 1.5 : 0.5; }
function damageGoblin(g, dmg, aggro) {
  g.hp = Math.max(0, g.hp - dmg);
  if (aggro !== false) {
    g.aggroed = true;
    g.state = 'chase';
  }
}

function updateGoblin(g, dt, bounds) {
  if (!player) return;

  g.attackCooldown = Math.max(0, g.attackCooldown - dt);
  // Post-darkness attack debuff
  if (g.attackDebuff > 0) {
    g.attackDebuff = Math.max(0, g.attackDebuff - dt);
  }
  g.flashTimer     = Math.max(0, g.flashTimer - dt);

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
    var patrolSpeed = g.speed * 0.35 * slowMult;
    if (wdist > 4) {
      g.x += (wdx/wdist) * patrolSpeed * dt;
      g.y += (wdy/wdist) * patrolSpeed * dt;
    }
  }

  if (g.state === 'chase') {
    if (g.confused && g.confuseDirX !== undefined) {
      // Move randomly when confused
      var confusedSpeed = g.speed * 0.5 * (g.slowed ? 0.1 : 1);
      g.x += g.confuseDirX * confusedSpeed * dt;
      g.y += g.confuseDirY * confusedSpeed * dt;
    } else if (distToPlayer > 2) {
      var effectiveSpeed = g.slowed ? g.speed * 0.1 : g.speed;
      g.x += (dx/distToPlayer) * effectiveSpeed * dt;
      g.y += (dy/distToPlayer) * effectiveSpeed * dt;
    }
  }

  // Clamp
  g.x = Math.max(bounds.x + g.r, Math.min(bounds.x + bounds.w - g.r, g.x));
  g.y = Math.max(bounds.y + g.r, Math.min(bounds.y + bounds.h - g.r, g.y));

  // ── Contact attack — skip if confused ──
  var contact = g.r + player.r;
  if (!g.confused && distToPlayer < contact && g.attackCooldown <= 0 && !player.iframes) {
    // Physical attack — absorbed by armor pips first
    var dmgLeft = g.dmg;
    if ((player.armor||0) > 0) {
      var absorbed = Math.min(player.armor, dmgLeft);
      player.armor -= absorbed;
      dmgLeft -= absorbed;
      showFloatingText(player.x, player.y - 55, '-' + absorbed + ' 🛡', '#AAAAAA');
    }
    if (dmgLeft > 0) {
      player.hp = Math.max(0, player.hp - dmgLeft);
      showFloatingText(player.x, player.y - 40, '-' + dmgLeft + ' HP', '#E24B4A');
    }
    player.iframes = 0.9;

    // Bounce goblin back
    var nx = -dx/distToPlayer, ny = -dy/distToPlayer;
    g.bounceVx = nx * 320;
    g.bounceVy = ny * 320;
    g.bounceTimer = 0.5;
    g.state = 'bounce';
    g.attackCooldown = (g.attackSlowed || g.attackDebuff > 0) ? 2.4 : 1.2;
    g.flashTimer = 0.2;

    if (player.hp <= 0) respawnPlayer();
  }

  // Player iframes
  if (player.iframes > 0) {
    player.iframes = Math.max(0, player.iframes - dt);
  }
}

function drawDeadGoblin(g) {
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
  // Icon sideways
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = fadeAlpha * 0.7;
  ctx.fillText('👺', 0, 0);
  // X eyes
  ctx.globalAlpha = fadeAlpha;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#ffffff88';
  ctx.fillText('✕', -5, -4);
  ctx.fillText('✕', 5, -4);
  ctx.restore();
}

function drawGoblin(g) {
  ctx.save();

  // Flash white on attack
  var flashing = g.flashTimer > 0;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(g.x, g.y + g.r - 3, g.r * 0.75, 5, 0, 0, Math.PI*2);
  ctx.fill();

  // State ring — red when chasing
  if (g.state === 'chase' || g.state === 'bounce') {
    ctx.shadowColor = '#E24B4A';
    ctx.shadowBlur = 16;
  } else {
    ctx.shadowColor = '#2a4a1a';
    ctx.shadowBlur = 10;
  }

  // Body
  ctx.fillStyle = flashing ? '#ffffff' : '#3a7a2a';
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r, 0, Math.PI*2);
  ctx.fill();

  // Inner
  ctx.shadowBlur = 0;
  ctx.fillStyle = flashing ? '#eeeeee' : '#4a9a35';
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r - 4, 0, Math.PI*2);
  ctx.fill();

  // Goblin icon
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👺', g.x, g.y);

  // Aggro indicator — small red dot when chasing
  if (g.state === 'chase') {
    ctx.fillStyle = '#E24B4A';
    ctx.beginPath();
    ctx.arc(g.x + g.r - 4, g.y - g.r + 4, 4, 0, Math.PI*2);
    ctx.fill();
  }

  // HP bar above goblin
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

  // ── Status effect icons ──
  var statusEffects = [];
  var now6 = performance.now();
  var pulse6 = 0.7 + 0.3 * Math.sin(now6 * 0.005);

  if (g.confused && g.confuseTimer > 0)
    statusEffects.push({ icon:'?', color:'#F5D000', timer: g.confuseTimer });
  if ((g.slowed && g.slowTimer > 0) || (g.attackSlowed && g.attackSlowTimer > 0)) {
    var debuffTimer = Math.max(g.slowTimer||0, g.attackSlowTimer||0);
    statusEffects.push({ icon:'⬇', color:'#7788cc', timer: debuffTimer });
  }

  // Check bleeds on this goblin
  var gBleeds = bleeds.filter(function(b){ return b.target === g && b.timer > 0; });
  if (gBleeds.length > 0) {
    var maxBleed = gBleeds.reduce(function(a,b){ return a.timer>b.timer?a:b; });
    statusEffects.push({ icon:'🩸', color:'#cc2200', timer: maxBleed.timer });
  }

  // Check if inside black darkness
  if (blackEffect && blackEffect.alpha > 0) {
    var bDist = Math.hypot(g.x - blackEffect.x, g.y - blackEffect.y);
    if (bDist < blackEffect.r)
      statusEffects.push({ icon:'◉', color:'#aaaaaa', timer: null });
  }

  if (statusEffects.length > 0) {
    // Sort shortest duration first (top of stack), null timers last
    statusEffects.sort(function(a, b) {
      if (a.timer === null) return 1;
      if (b.timer === null) return -1;
      return a.timer - b.timer;
    });

    var rowH = 16;
    // Start above HP numbers (barY - 5 is where hp text sits)
    var startY = barY - 8 - statusEffects.length * rowH;

    statusEffects.forEach(function(fx, fi) {
      var ry = startY + fi * rowH;
      ctx.save();
      ctx.globalAlpha = pulse6;
      ctx.textBaseline = 'middle';
      ctx.shadowColor = fx.color; ctx.shadowBlur = 5;
      // Icon
      ctx.font = '13px serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.icon, g.x - 2, ry);
      // Timer to the right
      if (fx.timer !== null) {
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#dddddd';
        ctx.shadowBlur = 0;
        ctx.fillText(Math.ceil(fx.timer) + 's', g.x + 2, ry);
      }
      ctx.restore();
    });
  }

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

  // Poison indicator
  if (g.poisoned) {
    ctx.save();
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1D9E75';
    ctx.shadowColor = '#1D9E75'; ctx.shadowBlur = 6 * Math.min(1, g.poisonTimer);
    var stackStr = (g.poisonStack||1) > 1 ? ' x' + g.poisonStack : '';
    ctx.fillText('☠' + stackStr + ' ' + Math.ceil(g.poisonTimer) + 's', g.x, g.y + g.r + 14);
    ctx.restore();
  }


  ctx.restore();
}

// ═══════════════════════════════════════════════════
// BRICK ACTIONS
// ═══════════════════════════════════════════════════
var brickAction = null;
var blackEffect = null; // current active brick action state

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
    showFloatingText(player.x, player.y - 50, 'WAIT...', '#888');
    return;
  }
  if (!player.bricks[color] || player.bricks[color] <= 0) return;

  if (player.bricks[color] <= 0) return; // no charges
  player.bricks[color]--;
  player.brickRecharge[color] = player.brickRecharge[color] || 0;
  renderBrickBar();

  if (color === 'red')    startRedCharge(1);
  if (color === 'white')  doWhiteHeal(player.x, player.y);
  if (color === 'yellow') startYellowAura({ follow: true, radius: scaleDist(120), duration: 3.0, label: 'DAZE FIELD' });
  if (color === 'blue')   startBlueBolt(null);
  if (color === 'orange') startOrangeTrap(player.x, player.y);
  if (color === 'gray')   startGrayArmor(player.x, player.y);
  if (color === 'purple') startPurpleBurst(player.x, player.y);
  if (color === 'black')  startBlackEffect(player.x, player.y);
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
  };
  showFloatingText(player.x, player.y-50, 'BLITZ!', '#E24B4A');
}

function startRedCharge(dmgMult, targetGoblin) {
  if (!goblins.length) return;
  var _dmgMult = dmgMult || 1;
  var goblin = targetGoblin || goblins.reduce(function(a,b){
    return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;});
  var startX = player.x, startY = player.y;
  var dx = goblin.x - player.x, dy = goblin.y - player.y;
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
  };
  showFloatingText(player.x, player.y - 50, 'CHARGE!', '#E24B4A');
}

// ── WHITE — Heal ─────────────────────────────────
var playerSparkles = [];
var playerRegen = null; // { hpPerSec, timer, duration, tick } // anchored to player position


function getArmorMax() {
  if (!player) return 0;
  var mult = player.cls === 'warrior' ? 0.75 : 0.5;
  return Math.floor(player.hpMax * mult);
}
function startWhiteRegen(tier) {
  var baseHeal = player.cls === 'mender' ? 5 : 3;
  var baseDur = 5;
  var hpPerSec = baseHeal * Math.pow(1.25, tier-1) / baseDur;
  var duration = baseDur * Math.pow(2, tier-1);
  if (playerRegen) {
    // Stack — extend duration
    playerRegen.hpPerSec = Math.max(playerRegen.hpPerSec, hpPerSec);
    playerRegen.timer = Math.max(playerRegen.timer, duration);
    playerRegen.duration = duration;
    showFloatingText(player.x, player.y-50, 'MENDING...', '#EFEFEF');
  } else {
    playerRegen = { hpPerSec: hpPerSec, timer: duration, duration: duration, tick: 0 };
    showFloatingText(player.x, player.y-50, 'CLOSING x'+count+'...', '#EFEFEF');
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
    var healed = Math.round((player.hp - prev) * 10) / 10;
    if (healed > 0) {
      showFloatingText(player.x, player.y-40, '✨ +'+healed, '#EFEFEF');
      spawnHealSparkles(1);
    }
  }
  if (playerRegen.timer <= 0) playerRegen = null;
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
  var healAmt = player.cls === 'mender' ? 5 : 3;
  var prev = player.hp;
  var cap = Math.max(player.hpMax, player.hp);
  player.hp = Math.min(cap, player.hp + healAmt);
  var actual = player.hp - prev;
  var fx = targetX !== undefined ? targetX : player.x;
  var fy = targetY !== undefined ? targetY : player.y;
  showFloatingText(fx, fy - 50, '✚ +' + actual, '#EFEFEF');
  spawnHealSparkles(1);
}

// ── YELLOW — Confuse ──────────────────────────────
// Two flavors:
//   • Aura (tap, overload):       3s ring that follows player or stays anchored;
//                                  any goblin inside gets confused, refreshed
//                                  each frame while in contact.
//   • Instant burst (drag-to-pt): one-shot confuse burst at the drop point.
var yellowAura = null; // { timer, baseRadius, followPlayer, ox, oy, label }

function startYellowAura(opts) {
  // opts = { radius, duration, follow (bool), ox, oy, label }
  yellowAura = {
    timer: opts.duration || 3.0,
    duration: opts.duration || 3.0,
    baseRadius: opts.radius || scaleDist(120),
    followPlayer: !!opts.follow,
    ox: opts.ox !== undefined ? opts.ox : player.x,
    oy: opts.oy !== undefined ? opts.oy : player.y,
    label: opts.label || 'DAZE FIELD',
    pulse: 0,
  };
  showFloatingText(yellowAura.ox, yellowAura.oy - 30, yellowAura.label, '#F5D000');
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
  goblins.forEach(function(g) {
    if (Math.hypot(g.x - cx, g.y - cy) <= r) {
      if (!g.confused) {
        // First entry this session: seed a 2s confuse that lingers briefly after leaving
        g.confused = true;
        g.confuseTimer = Math.max(g.confuseTimer || 0, 2.0);
      } else {
        // Already confused: top up by a small sliver each frame in contact
        g.confuseTimer = Math.max(g.confuseTimer || 0, 1.0);
      }
    }
  });
  // Occasional "?" particle shimmer while active (throttled)
  if (Math.random() < 0.15) {
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
  // Pulsing edge ring
  var pulseScale = 1 + Math.sin(yellowAura.pulse) * 0.03;
  ctx.strokeStyle = 'rgba(245, 208, 0, ' + a + ')';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.arc(cx, cy, r * pulseScale, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function startYellowConfuse(ox, oy, radius) {
  // Retained for drag-to-point instant bursts. Aura behavior now lives in
  // startYellowAura; taps and overloads route through there.
  var cx = ox !== undefined ? ox : player.x;
  var cy = oy !== undefined ? oy : player.y;
  var r = radius || scaleDist(300);
  var hit = 0;
  goblins.forEach(function(g) {
    if (Math.hypot(g.x-cx, g.y-cy) <= r) {
      g.confused = true;
      g.confuseTimer = (g.confuseTimer||0) + 2.0;
      hit++;
    }
  });
  brickAction = null;
  // Spawn ? particles within radius
  spawnConfuseParticles(cx, cy, r, Math.round((8 + hit * 3) * vScale(1)));
  showFloatingText(cx, cy - 30, 'DAZED!', '#F5D000');
}

// ── UPDATE BRICK ACTION ───────────────────────────
function updateBrickAction(dt, bounds) {
  if (!brickAction) return;

  if (brickAction.type === 'red') {
    if (brickAction.phase === 'charge') {
      if (brickAction.usePoint) {
        // Fixed direction toward dropped point
      } else {
        // Track nearest goblin
        var nearestG = goblins.length ? goblins.reduce(function(a,b){return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null;
        if (nearestG) {
          var cdx = nearestG.x - player.x, cdy = nearestG.y - player.y;
          var cdist = Math.sqrt(cdx*cdx+cdy*cdy);
          if (cdist > 1) { brickAction.dirX = cdx/cdist; brickAction.dirY = cdy/cdist; }
        }
      }
      brickAction.chargeTimer = (brickAction.chargeTimer||0) + dt;
      var step = brickAction.chargeSpeed * dt;
      player.x += brickAction.dirX * step;
      player.y += brickAction.dirY * step;
      player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
      player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));
      // Hit check
      if (!brickAction.hit) {
        var hitG = goblins.find(function(g){ return Math.hypot(player.x-g.x,player.y-g.y) < player.r+g.r; });
        if (hitG) {
          var rMult = brickAction.dmgMult||1;
          damageGoblin(hitG, 3 * rMult); hitG.flashTimer = 0.3;
          showFloatingText(hitG.x, hitG.y - 30, '-'+(3*rMult), '#E24B4A');
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
          hitG.bounceVx = (kx/kd)*300; hitG.bounceVy = (ky/kd)*300;
          hitG.bounceTimer = 0.35; hitG.state = 'bounce';
          brickAction.hit = true;
          if (goblins.length > 0 && goblins.every(function(g){return g.hp<=0;})) triggerVictory();
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
      var nearestForReturn = goblins.length ? goblins[0] : null;
      var safeStop = nearestForReturn ? nearestForReturn.AGGRO_RANGE * 1.5 : 0;
      var distToGoblin = nearestForReturn ? Math.hypot(player.x-nearestForReturn.x, player.y-nearestForReturn.y) : 9999;
      brickAction.returnTimer = (brickAction.returnTimer||0) + dt;
      if (distToGoblin >= safeStop || rd <= 8 || brickAction.returnTimer >= 3.0) {
        brickAction = null; // always terminates within 3s
      } else {
        var rs = Math.min(brickAction.returnSpeed * dt, rd);
        player.x += (rx/rd)*rs;
        player.y += (ry/rd)*rs;
      }
    }
  }

}


// ── UPDATE GOBLIN CONFUSION ───────────────────────
function updateGoblinConfusion(g, dt) {
  if (!g.confused) return;
  g.confuseTimer -= dt;
  if (g.confuseTimer <= 0) {
    g.confused = false;
    g.confuseTimer = 0;
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
  var target = lockedTarget || (goblins.length ? goblins.reduce(function(a,b){return Math.hypot(a.x-player.x,a.y-player.y)<Math.hypot(b.x-player.x,b.y-player.y)?a:b;}) : null);
  if (!target || !player) return;
  blueBolts.push({ x: player.x, y: player.y, target: target, speed: 500, dmg: 4, r: 7, dead: false, travelled: 0, tier: 1, glow: 0, delayTimer: 0 });
  showFloatingText(player.x, player.y - 50, 'LANCE!', '#4db8ff');
}

function updateBlueBolts(dt, bounds) {
  blueBolts = blueBolts.filter(function(b) { return !b.dead; });
  blueBolts.forEach(function(b) {
    if (b.dead) return;
    if (b.delayTimer > 0) { b.delayTimer -= dt; return; } // staggered launch
    if (!b.target || b.target.hp <= 0) { b.dead = true; return; }
    var dx = b.target.x - b.x, dy = b.target.y - b.y;
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
    // Require minimum travel before hit registers
    if (b.travelled > 30 && dist < b.r + b.target.r) {
      damageGoblin(b.target, b.dmg);
      b.target.flashTimer = 0.2;
      showFloatingText(b.target.x, b.target.y - 30, '-' + b.dmg, '#4db8ff');
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
  var onTarget = goblins.some(function(g){return Math.hypot(cx-g.x,cy-g.y)<g.r+30;});
  ctx.strokeStyle = onTarget ? '#4db8ff' : '#4db8ff44'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI*2); ctx.stroke();
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

function spawnSpikeTrap(x, y, r, initialDmg, sealed) {
  // sealed=true means trap immediately snaps (used for aura/drag at placement)
  var t = {
    x: x, y: y, r: r,
    triggered: false, sealed: sealed||false,
    snapTimer: 0, SNAP: 0.3,  // snap animation duration
    holdTimer: 0, HOLD_DURATION: 1.5,
    initialDmg: initialDmg || 2,
    pulse: 0, done: false, target: null,
    spikeAngle: Math.random() * Math.PI * 2,
    // if sealed, trap contains already-caught goblins
    caughtGoblins: [],
  };
  if (sealed) {
    // Catch goblins within radius immediately
    goblins.forEach(function(g) {
      if (Math.hypot(g.x-x, g.y-y) < r + g.r) {
        t.caughtGoblins.push(g);
        t.triggered = true;
        t.holdTimer = t.HOLD_DURATION;
        damageGoblin(g, t.initialDmg, false);
        showFloatingText(g.x, g.y-30, '⚡-'+t.initialDmg, '#ff6600');
      }
    });
  }
  traps.push(t);
}

function startOrangeTrap(ox, oy, tier) {
  var isDrag = ox !== undefined && Math.hypot(ox-player.x, oy-player.y) > scaleDist(40);
  if (isDrag) {
    var tr = 25 + (tier||1) * 15;
    var dmg = 1 + (tier||1);
    spawnSpikeTrap(ox, oy, tr, dmg, true);
    showFloatingText(ox, oy-40, 'SNARE!', '#F57C00');
  } else {
    // Tap — just place small trap at feet
    spawnSpikeTrap(player.x, player.y, 20, 2, false);
    showFloatingText(player.x, player.y-40, 'PRIMED!', '#F57C00');
  }
}

function fireOverloadOrangeScatter(count, ox, oy) {
  var tr = 25 + count * 15;
  var dmg = 1 + count;
  spawnSpikeTrap(ox, oy, tr, dmg, true);
  showFloatingText(ox, oy-40, 'PINNED x'+count+'!', '#F57C00');
}

function applyBleed(g, dmg, tier) {
  var bleedDmg = Math.max(1, Math.floor(dmg * 0.5));
  var duration = 3.0 * Math.pow(1.25, (tier || 1) - 1);
  bleeds.push({ target: g, dmg: bleedDmg, timer: duration, tick: 0 });
}

function updateBleeds(dt) {
  bleeds = bleeds.filter(function(b) { return b.timer > 0 && b.target && b.target.hp > 0; });
  bleeds.forEach(function(b) {
    b.timer -= dt;
    b.tick += dt;
    if (b.tick >= 1.0) {
      b.tick -= 1.0;
      damageGoblin(b.target, b.dmg, false);
      showFloatingText(b.target.x, b.target.y-20, '🩸 -'+b.dmg, '#cc2200');
      if (goblins.length > 0 && goblins.every(function(g){return g.hp<=0;})) triggerVictory();
    }
  });
}

function updateTraps(dt) {
  // Aura
  if (orangeAura) {
    orangeAura.pulse = (orangeAura.pulse + dt*4) % (Math.PI*2);
    goblins.forEach(function(g) {
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
        // Release — apply bleed to caught goblins
        var bTier = Math.max(1, t.initialDmg - 1);
        t.caughtGoblins.forEach(function(g) {
          applyBleed(g, t.initialDmg, bTier);
        });
        t.done = true;
        return;
      }
      // Hold caught goblins in place
      t.caughtGoblins.forEach(function(g) {
        g.bounceVx=0; g.bounceVy=0; g.bounceTimer=0.05; g.state='bounce';
        g.x += (t.x-g.x)*0.08; g.y += (t.y-g.y)*0.08; // pull toward center
      });
    } else {
      // Waiting — detect goblin
      goblins.forEach(function(g) {
        if (!t.triggered && Math.hypot(g.x-t.x,g.y-t.y)<t.r+g.r) {
          t.triggered = true;
          t.holdTimer = t.HOLD_DURATION;
          t.caughtGoblins = [g];
          damageGoblin(g, t.initialDmg, false);
          showFloatingText(t.x,t.y-30,'SPRING! -'+t.initialDmg,'#ff6600');
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
      // Hold timer bar
      var pct = t.holdTimer/t.HOLD_DURATION;
      ctx.globalAlpha=1; ctx.fillStyle=color;
      ctx.fillRect(t.x-20,t.y-t.r-10,40*pct,4);
      ctx.strokeStyle='#333'; ctx.lineWidth=1;
      ctx.strokeRect(t.x-20,t.y-t.r-10,40,4);
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
    // Base: 1 armor pip per gray brick. Future "Iron Hide"-style skill can
    // unlock 2-per-brick (multiplier will hook here once skill system lives).
    player.armor = Math.min(aMax, (player.armor||0) + 1);
    showFloatingText(player.x, player.y-50, 'PLATED!', '#AAAAAA');
    armorBursts.push({ x: player.x, y: player.y, r: player.r, alpha: 0.8 });
  }
}

function startGrayWall(cx, cy, tier) {
  var maxR = scaleDist(30 + tier * 22);
  var hp = 4 * tier;
  // Mark which goblins start inside — only they get contained
  var containedIds = [];
  goblins.forEach(function(g, i) {
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
  showFloatingText(cx, cy-50, containedIds.length > 0 ? 'CAGED! ('+containedIds.length+')' : 'RAMPART!', '#AAAAAA');
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
    // Block player from entering wall from outside
    if (player) {
      var pdx = player.x - w.x, pdy = player.y - w.y;
      var pdist = Math.sqrt(pdx*pdx+pdy*pdy) || 1;
      var pEdge = w.r + player.r;
      if (pdist < pEdge && pdist > w.r - player.r) {
        // Player is in the wall boundary — push outside
        player.x = w.x + (pdx/pdist) * pEdge;
        player.y = w.y + (pdy/pdist) * pEdge;
      }
    }

    // Push contained goblins back inside, damage wall on sustained contact
    if (!w._goblinCooldowns) w._goblinCooldowns = {};
    goblins.forEach(function(g, gi) {
      var isContained = w.containedIds && w.containedIds.indexOf(gi) >= 0;
      if (!isContained) return;
      var dx = g.x - w.x, dy = g.y - w.y;
      var dist = Math.sqrt(dx*dx+dy*dy) || 1;
      var wallEdge = w.r - g.r;
      if (dist > wallEdge && wallEdge > 0) {
        // Push back inside
        g.x = w.x + (dx/dist) * wallEdge;
        g.y = w.y + (dy/dist) * wallEdge;
        // Sustained damage — 1 per second per goblin
        w._goblinCooldowns[gi] = (w._goblinCooldowns[gi]||0) - dt;
        if (w._goblinCooldowns[gi] <= 0) {
          w._goblinCooldowns[gi] = 1.0; // 1s cooldown
          w.hp = Math.max(0, w.hp - 1);
          w.flashTimer = 0.15;
          showFloatingText(w.x + (dx/dist)*w.r, w.y + (dy/dist)*w.r - 10, 'CRACK!', '#AAAAAA');
        }
      } else {
        w._goblinCooldowns[gi] = 0; // reset when not pushing
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
  var BURST_R = scaleDist(400);
  if (greenBurst && !greenBurst.done) {
    // Already active — just trigger a new push wave without restarting radius
    greenBurst._poisonedIds = []; // allow re-poison on reuse
    greenBurst._pushIds = [];     // allow re-push
    showFloatingText(player.x, player.y-50, 'SHOCKWAVE!', '#1D9E75');
    return;
  }
  greenBurst = { r: 0, maxR: BURST_R, alpha: 1, done: false, _poisonedIds: [], _pushIds: [], ox: x, oy: y };
  showFloatingText(x, y-50, 'REPEL!', '#1D9E75');
}

function updateGreenBurst(dt) {
  if (!greenBurst || greenBurst.done) return;
  greenBurst.r += 600 * dt;
  greenBurst.alpha = Math.max(0, 1 - (greenBurst.r / greenBurst.maxR));

  // Ring acts as solid wall — push all goblins
  goblins.forEach(function(goblin) {
    var gox = greenBurst.ox||player.x, goy = greenBurst.oy||player.y;
    var dx = goblin.x - gox, dy = goblin.y - goy;
    var dist = Math.sqrt(dx*dx+dy*dy) || 1;
    var pushTarget = greenBurst.maxR * 0.75;
    var gId = goblins.indexOf(goblin);
    if (!greenBurst._pushIds) greenBurst._pushIds = [];
    if (dist < greenBurst.maxR && dist < pushTarget - goblin.r && greenBurst._pushIds.indexOf(gId) < 0) {
      var nx = dx/dist, ny = dy/dist;
      goblin.bounceVx = nx * 420; goblin.bounceVy = ny * 420;
      goblin.bounceTimer = 0.4; goblin.state = 'bounce';
      greenBurst._pushIds.push(gId);
    }
    // Poison when ring passes — per-burst tracking so stacking always works
    var distCheck = Math.hypot(goblin.x - gox, goblin.y - goy);
    if (greenBurst.r >= distCheck - goblin.r) {
      if (!greenBurst._poisonedIds) greenBurst._poisonedIds = [];
      var gId = goblins.indexOf(goblin);
      if (greenBurst._poisonedIds.indexOf(gId) < 0) {
        goblin.poisoned = true;
        goblin.poisonTimer = 4.0;
        // Normal cast doubles stack; overload multiplies by 2^count (1-2-4-8-16)
        var mult = greenBurst._poisonMult || 1;
        var newStack = Math.pow(2, mult - 1);
        goblin.poisonStack = goblin.poisonStack > 0 ? goblin.poisonStack * Math.pow(2, mult) : newStack;
        goblin.poisonTick = goblin.poisonTick || 0;
        greenBurst._poisonedIds.push(gId);
      }
    }
  });

  if (greenBurst.r >= greenBurst.maxR * 1.1) greenBurst.done = true;
}

function updateGoblinPoison(g, dt) {
  if (!g.poisoned) return;
  g.poisonTimer -= dt;
  if (g.poisonTimer <= 0) { g.poisoned = false; g.poisonTick = 0; g.poisonStack = 0; return; }
  g.poisonTick = (g.poisonTick||0) + dt;
  if (g.poisonTick >= 1.0) {
    g.poisonTick -= 1.0;
    var poisonDmg = g.poisonStack || 1;
    damageGoblin(g, poisonDmg, false); // poison is environmental
    g.flashTimer = 0.08;
    showFloatingText(g.x, g.y-30, '☠ -' + poisonDmg, '#1D9E75');
    if (goblins.length > 0 && goblins.every(function(x){return x.hp<=0;})) triggerVictory();
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
// PURPLE — Full Arena Burst
// ═══════════════════════════════════════════════════
var purpleBursts = [];

function startPurpleBurst(ox, oy) {
  var x = (ox !== undefined) ? ox : player.x;
  var y = (oy !== undefined) ? oy : player.y;
  purpleBursts.push({ r: 0, maxR: scaleDist(400), alpha: 1, done: false, hit: false, ox: x, oy: y });
  showFloatingText(x, y-50, 'RUPTURE!', '#7B2FBE');
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
  // Hit goblin — per-burst tracking so back-to-back bursts each deal damage
  if (!purpleBurst._hitIds) purpleBurst._hitIds = [];
  goblins.forEach(function(goblin) {
    var gId = goblins.indexOf(goblin);
    if (purpleBurst._hitIds.indexOf(gId) >= 0) return;
    var dist = Math.hypot(goblin.x-purpleBurst.ox, goblin.y-purpleBurst.oy);
    if (purpleBurst.r >= dist) {
      var pbRemote = Math.hypot(purpleBurst.ox-player.x, purpleBurst.oy-player.y) > 20;
      var purpleDmg = 3 * (purpleBurst.dmgMult||1);
      var prevHp = goblin.hp;
      damageGoblin(goblin, purpleDmg, !pbRemote); goblin.flashTimer = 0.2;
      var actualDmg = prevHp - goblin.hp; // actual damage dealt (may be less if goblin low HP)
      showFloatingText(goblin.x, goblin.y-30, '-' + actualDmg, '#7B2FBE');

      purpleBurst._hitIds.push(gId);
      // Heal player by damage dealt, allow overheal up to 3x max HP
      var overhealCap = player.hpMax * 3;
      if (player.hp < overhealCap) {
        player.hp = Math.min(overhealCap, player.hp + actualDmg);
        showFloatingText(player.x, player.y-50, '+' + actualDmg + ' HP', '#9B6FD4');
      }
      if (goblins.length > 0 && goblins.every(function(g){return g.hp<=0;})) triggerVictory();
    }
  });
  if (purpleBurst.r >= purpleBurst.maxR) purpleBurst.done = true;
  });
  purpleBursts = purpleBursts.filter(function(p) { return !p.done; });
}

function updatePurpleParticles(dt) {
  purpleParticles = purpleParticles.filter(function(p) { return p.alpha > 0.05; });
  purpleParticles.forEach(function(p) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.isRed) {
      p.vx *= 0.95; p.vy *= 0.95;
      p.alpha -= 1.2 * dt;
    } else {
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
    ctx.shadowColor = '#7B2FBE'; ctx.shadowBlur = 8 * p.alpha;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function startBlackEffect(ox, oy) {
  var x = (ox !== undefined) ? ox : player.x;
  var y = (oy !== undefined) ? oy : player.y;
  if (blackEffect) {
    // Already active — expand radius by 1.3x, reset timer, shift origin toward new cast
    blackEffect.RADIUS = Math.min(blackEffect.RADIUS * 1.3, 900);
    blackEffect.timer = blackEffect.DURATION;
    blackEffect.ox = (blackEffect.ox + x) / 2;
    blackEffect.oy = (blackEffect.oy + y) / 2;
    showFloatingText(x, y-50, 'DARKNESS+!', '#777');
  } else {
    blackEffect = { timer: 3.0, DURATION: 3.0, tickTimer: 0, TICK: 0.5, alpha: 0,
      FADE_IN: 0.8, FADE_OUT: 0.8, ox: x, oy: y, RADIUS: 50 };
    showFloatingText(x, y-50, 'VOID!', '#555555');
  }
  goblins.forEach(function(g) {
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
  // Pull goblins toward origin + damage ticks
  goblins.forEach(function(g) {
    var dx = blackEffect.ox - g.x, dy = blackEffect.oy - g.y;
    var dist = Math.sqrt(dx*dx+dy*dy);
    if (dist < blackEffect.RADIUS && dist > 4) {
      var pullStr = 220 * dt; // pull speed px/s
      g.x += (dx/dist) * pullStr;
      g.y += (dy/dist) * pullStr;
    }
  });
  blackEffect.tickTimer += dt;
  if (blackEffect.tickTimer >= blackEffect.TICK) {
    blackEffect.tickTimer -= blackEffect.TICK;
    goblins.forEach(function(goblin) {
      var dist = Math.hypot(goblin.x-blackEffect.ox, goblin.y-blackEffect.oy);
      if (dist < blackEffect.RADIUS) {
        var beRemote = Math.hypot(blackEffect.ox-player.x, blackEffect.oy-player.y) > 20;
        var beTick = blackEffect.tickDmg || 1;
        damageGoblin(goblin, beTick, !beRemote); goblin.flashTimer=0.08;
        showFloatingText(goblin.x, goblin.y-25, '💀 -1', '#888888');
      }
    });
    if (goblins.length > 0 && goblins.every(function(g){return g.hp<=0;})) triggerVictory();
  }
      if (blackEffect && blackEffect.timer <= 0) {
      var _ox = blackEffect.ox, _oy = blackEffect.oy, _r = blackEffect.RADIUS;
      blackEffect = null;
      goblins.forEach(function(g) {
        g.attackSlowed=false; g.attackSlowTimer=0;
        if (Math.hypot(g.x-_ox, g.y-_oy) < _r) { g.slowed=true; g.slowTimer=5.0; }
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
  // Edge ring
  ctx.globalAlpha = blackEffect.alpha * 0.4;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.setLineDash([6,6]);
  ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
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
    var bounds = getArenaBounds();
    player.x = Math.max(bounds.x + player.r, Math.min(bounds.x + bounds.w - player.r, player.x));
    player.y = Math.max(bounds.y + player.r, Math.min(bounds.y + bounds.h - player.r, player.y));
  }
  if (goblins && goblins.length) {
    goblins.forEach(function(g) {
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
  var cls = cfg.cls || 'warrior';
  player = makePlayer(cls);

  // Seed HP/armor from config if provided (else class default from makePlayer).
  if (typeof cfg.hp === 'number')      player.hp = cfg.hp;
  if (typeof cfg.hpMax === 'number')   player.hpMax = cfg.hpMax;
  if (typeof cfg.armor === 'number')   player.armor = cfg.armor;

  // Seed bricks + pool caps based on mode.
  // Spec mode: pool caps come from BRICK_ECONOMY (signature=4, secondary=3, baseline=2);
  // current counts come from cfg.bricks (the starting kit — usually 3 bricks total).
  // Sandbox mode: keeps makePlayer's random 1-10 per color (brickMax = starting = random).
  if (cfg.mode === 'spec') {
    var caps  = BRICK_ECONOMY.poolCaps;
    var rates = BRICK_ECONOMY.refreshRates;
    Object.keys(player.bricks).forEach(function(c) {
      var tier = brickTier(cls, c);
      var startQty = (cfg.bricks && cfg.bricks[c]) || 0;
      // brickMax per battle = what you BROUGHT (clamped by the tier's ceiling).
      // Bringing more than the cap is allowed in inventory but excess can't
      // enter the arena — it simply doesn't fit in your combat satchel.
      // To exceed starting counts across battles, player earns fragments on
      // the board, fuses them into bricks, equips more before next battle.
      var maxBricks = Math.min(startQty, caps[tier]);
      player.brickMax[c] = maxBricks;
      player.bricks[c] = maxBricks;
      // Stagger the initial refresh clock per color so that when you spend
      // bricks mid-battle, they don't all refresh at exactly the same moment.
      player.brickRecharge[c] = Math.random() * rates[tier];
    });
  } else if (cfg.bricks && typeof cfg.bricks === 'object') {
    // Sandbox with custom bricks: apply the provided counts, keep makePlayer's maxes
    Object.keys(player.bricks).forEach(function(c) {
      player.bricks[c] = cfg.bricks[c] || 0;
    });
  }

  // Reset fatigue counters (signature + off-class) at battle start.
  player.fatigue = { signature: 0, offClass: 0 };
  player.overloadCount = 0;
  _currentFatigueMult = 1.0;

  timerLeft = ARENA_DURATION;
  running = true;
  _startedAt = performance.now();
  renderBrickBar();

  // Spawn goblin after player is placed
  var bounds = getArenaBounds();
  goblins = [];
  goblins.push(makeGoblin(bounds, 0));

  // Reset all effects
  blueBolts = []; traps = []; armorBursts = []; grayWalls = []; orangeAura = null; bleeds = [];
  greenBurst = null; greenDragActive = false; greenDragPos = null; purpleBursts = []; purpleParticles = [];
  blackEffect = null; playerSparkles = []; goblinRespawnPending = false; playerRegen = null;
  brickAction = null; dashCooldown = 0; dragTarget = null; dashGoblin = null; overloadState = null;
  yellowAura = null;

  lastTs = performance.now();
  updateHUD();
  rafId = requestAnimationFrame(loop);

  _tickInterval = setInterval(function() {
    if (running) emit('tick', _computeState());
  }, 500);

  emit('start', { cls: cls, mode: cfg.mode || 'sandbox' });
}

var goblinRespawnPending = false;

function triggerVictory() {
  if (!running || goblinRespawnPending) return;
  goblinRespawnPending = true;
  showFloatingText(player.x, player.y - 60, 'FELLED!', '#F5D000');
  emit('enemyKilled');
  setTimeout(function() {
    if (!running) { goblinRespawnPending = false; return; }
    var bounds = getArenaBounds();
    goblins.push(makeGoblin(bounds, 0));
    goblinRespawnPending = false;
  }, 2000);
}

function respawnPlayer() {
  if (!running) return;
  showFloatingText(player.x, player.y - 60, 'RESPAWNING...', '#888');
  player.iframes = 3.0;
  var bounds = getArenaBounds();
  setTimeout(function() {
    if (!running || !player) return;
    player.hp = player.hpMax;
    player.x = bounds.x + bounds.w / 2;
    player.y = bounds.y + bounds.h / 2;
    player.iframes = 3.0;
    showFloatingText(player.x, player.y - 50, 'RESPAWNED', '#4a9a35');
  }, 1500);
}

// Internal — called by Rumble.forceEnd or via in-combat end conditions.
// Emits 'victory' | 'defeat' | 'timeout' | 'quit' | <custom> events.
function _internalEnd(reason) {
  running = false;
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
  for (var i = 0; i < goblins.length; i++) { if (goblins[i].hp > 0) { first = goblins[i]; break; } }
  return {
    playerCls:   player.cls,
    playerHp:    player.hp,
    playerHpMax: player.hpMax,
    playerArmor: player.armor || 0,
    playerBricks: Object.assign({}, player.bricks),
    playerBrickMax: Object.assign({}, player.brickMax || {}),
    enemyHp:     first ? first.hp : 0,
    enemyHpMax:  first ? first.hpMax : 0,
    elapsed:     _startedAt ? (performance.now() - _startedAt) / 1000 : 0,
    status:      running ? (player.hp > 0 ? 'active' : 'downed') : 'idle',
    mode:        (cfg && cfg.mode) || 'sandbox',
    fatigue:     player.fatigue ? Object.assign({}, player.fatigue) : { signature: 0, offClass: 0 },
    overloadCount: player.overloadCount || 0,
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
  goblins = [];
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
      goblinCount: goblins.length,
      projectileCount: (blueBolts||[]).length,
      trapCount: (traps||[]).length,
      wallCount: (grayWalls||[]).length,
      floatingTexts: (floatingTexts||[]).length,
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
  },
  setEnemyHP: function(n) {
    var g = goblins.find(function(x){ return x.hp > 0; });
    if (!g) return;
    g.hp = Math.max(0, Math.min(g.hpMax, n|0));
  },
};

})(); // end IIFE
