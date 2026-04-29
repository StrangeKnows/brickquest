/* ═══════════════════════════════════════════════════════════════════
 * boardFx.js — unified board-side ambient FX
 *
 * Particle bursts, rings, rising text, fly-to icons. Schema-driven
 * via PRESETS. Never blocks input; never demands a click. For
 * must-click cards, see boardModal.js (later refactor).
 *
 * Architecture invariant — the bug-fix-by-construction:
 *   FX nodes are NEVER attached to elements that get rebuilt by
 *   render(). They live inside #board-fx-overlay, a position:fixed
 *   container appended to document.body lazily on first call. The
 *   overlay sits at z-index 1001 (above modals, dashboard, sheets).
 *
 * Public API:
 *   BoardFx.fire(presetName, anchor, data)
 *     - presetName: key in BoardFx.PRESETS
 *     - anchor:     Element OR selector string OR DOMRect
 *     - data:       optional payload (label, delta, etc.)
 *
 * Adding a preset: drop an entry in PRESETS. The preset function
 * receives ({centerX, centerY, anchorRect}, data) in viewport space.
 * Reuse primitives (_particleBurst, _risingText, _ring) — only add
 * new primitives when an existing one can't be parameterized.
 * ═══════════════════════════════════════════════════════════════════ */

(function(global){
  'use strict';

  var OVERLAY_ID = 'board-fx-overlay';
  var _overlay = null;

  function _ensureOverlay() {
    if (_overlay && document.body.contains(_overlay)) return _overlay;
    _overlay = document.getElementById(OVERLAY_ID);
    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.id = OVERLAY_ID;
      // Cover viewport, never block input. z-index 1001 puts it above
      // all dashboard / shield / modal layers (max prior was 1001 on
      // the retired #heal-feedback-layer).
      _overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:1001;' +
        'overflow:visible;';
      document.body.appendChild(_overlay);
    }
    return _overlay;
  }

  function _resolveAnchor(anchor) {
    if (!anchor) return null;
    if (typeof anchor === 'string') return document.querySelector(anchor);
    // DOMRect-shaped object — accept it directly (used by casterAck which
    // captures the rect at drag-release time, before the icon may dismount).
    if (typeof anchor.left === 'number' && typeof anchor.top === 'number'
        && typeof anchor.width === 'number') {
      return { _rect: anchor };
    }
    if (anchor.nodeType === 1) return anchor;
    return null;
  }

  function _anchorCenter(anchor) {
    var el = _resolveAnchor(anchor);
    if (!el) return null;
    var r = el._rect ? el._rect : el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return {
      x:    r.left + r.width  / 2,
      y:    r.top  + r.height / 2,
      rect: r
    };
  }

  /* ── Primitive: particle burst ───────────────────────────────────
   * Spawn N particles outward from (cx,cy). CSS custom properties:
   *   --pdx / --pdy : radial endpoint
   *   --pbx / --pby : optional perpendicular bow waypoint at 50%
   *
   * Per-particle randomization: angle jitter, distance, delay,
   * lifetime (lifeMsMin..lifeMsMax), size (sizeMin..sizeMax). Each
   * particle has its own animation duration — particles "sizzle out
   * at different times" rather than dying together.
   *
   * opts:
   *   count       — how many particles (required)
   *   className   — class to attach (animation in boardFx.css)
   *   minDist     — radial distance min (default 24)
   *   maxDist     — radial distance max (default 60)
   *   upBias      — Y offset (default 6, positive subtracts from dy = up bias)
   *   bowAmount   — perpendicular bow magnitude (default 0 = no bow)
   *   lifeMsMin   — min particle lifetime in ms
   *   lifeMsMax   — max particle lifetime in ms (defaults to min)
   *   sizeMin     — min particle size in px (default 5)
   *   sizeMax     — max particle size in px (default = sizeMin)
   *   symbol      — optional textContent (e.g. ✧ for sparkle particles)
   *   pickColor   — optional fn(): returns CSS color string per particle
   *   delayMaxMs  — random initial delay max (default 80)
   */
  function _particleBurst(cx, cy, opts) {
    var overlay = _ensureOverlay();
    var count       = opts.count       || 14;
    var minDist     = opts.minDist     || 24;
    var maxDist     = opts.maxDist     || 60;
    var upBias      = (opts.upBias !== undefined) ? opts.upBias : 6;
    var bowAmt      = opts.bowAmount   || 0;
    var className   = opts.className;
    var lifeMsMin   = opts.lifeMsMin   || opts.lifeMs || 950;
    var lifeMsMax   = opts.lifeMsMax   || lifeMsMin;
    var sizeMin     = opts.sizeMin     || opts.size   || 5;
    var sizeMax     = opts.sizeMax     || sizeMin;
    var symbol      = opts.symbol      || null;
    var pickColor   = opts.pickColor   || null;
    var delayMaxMs  = (opts.delayMaxMs !== undefined) ? opts.delayMaxMs : 80;

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = className;
      var ang = (Math.PI * 2) * (i / count) + (Math.random() - 0.5) * 0.4;
      var dist = minDist + Math.random() * (maxDist - minDist);
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist - upBias;
      var sz = sizeMin + Math.random() * (sizeMax - sizeMin);
      var life = lifeMsMin + Math.random() * (lifeMsMax - lifeMsMin);

      p.style.left = (cx - sz / 2) + 'px';
      p.style.top  = (cy - sz / 2) + 'px';
      p.style.setProperty('--pdx', dx + 'px');
      p.style.setProperty('--pdy', dy + 'px');

      // Optional perpendicular bow waypoint at 50% (used by presets
      // wanting arcing paths instead of straight outward).
      if (bowAmt > 0) {
        var sign = (Math.random() < 0.5) ? -1 : 1;
        var mag  = bowAmt * (0.5 + Math.random() * 0.5);
        var len  = Math.sqrt(dx*dx + dy*dy) || 1;
        var bx = (-dy / len) * mag * sign;
        var by = ( dx / len) * mag * sign;
        p.style.setProperty('--pbx', (dx * 0.5 + bx) + 'px');
        p.style.setProperty('--pby', (dy * 0.5 + by) + 'px');
      }

      // Per-particle size override via inline style (so caller can
      // randomize without per-class CSS variations).
      if (sizeMax !== sizeMin) {
        p.style.width  = sz + 'px';
        p.style.height = sz + 'px';
        if (symbol) p.style.fontSize = sz + 'px';
      } else if (symbol) {
        p.style.fontSize = sz + 'px';
      }

      if (symbol) p.textContent = symbol;
      if (pickColor) p.style.color = pickColor();

      // Per-particle animation duration — the "sizzle" effect.
      p.style.animationDuration = life + 'ms';
      p.style.animationDelay    = (Math.random() * delayMaxMs) + 'ms';

      overlay.appendChild(p);
      setTimeout(function(el){
        if (el.parentNode) el.parentNode.removeChild(el);
      }, life + delayMaxMs + 50, p);
    }
  }

  /* ── Primitive: rising text ──────────────────────────────────────
   * Drop a text node at (cx,cy) that animates per the className.
   * CSS variable --tdx supports diagonal trajectory; if not set in
   * keyframes, the text rises straight up.
   *
   * opts:
   *   className — class with animation declared in boardFx.css
   *   lifeMs    — total lifetime (default 1500)
   *   yOffset   — initial Y offset (default -18)
   *   tdx       — horizontal travel offset in px (default 0 = straight up)
   */
  function _risingText(cx, cy, text, opts) {
    var overlay   = _ensureOverlay();
    var className = opts.className;
    var lifeMs    = opts.lifeMs || 1500;
    var yOffset   = (opts.yOffset !== undefined) ? opts.yOffset : -18;
    var tdx       = opts.tdx || 0;

    var t = document.createElement('div');
    t.className = className;
    t.textContent = text;
    t.style.left = cx + 'px';
    t.style.top  = (cy + yOffset) + 'px';
    if (tdx !== 0) t.style.setProperty('--tdx', tdx + 'px');
    overlay.appendChild(t);
    setTimeout(function(){
      if (t.parentNode) t.parentNode.removeChild(t);
    }, lifeMs + 50);
  }

  /* ── Primitive: ring pulse ───────────────────────────────────────
   * Expanding circle centered at (cx,cy), styled and animated by
   * className. Used for heal ring and casterAck flash.
   */
  function _ring(cx, cy, opts) {
    var overlay   = _ensureOverlay();
    var className = opts.className;
    var lifeMs    = opts.lifeMs || 900;
    var r = document.createElement('div');
    r.className = className;
    r.style.left = cx + 'px';
    r.style.top  = cy + 'px';
    overlay.appendChild(r);
    setTimeout(function(){
      if (r.parentNode) r.parentNode.removeChild(r);
    }, lifeMs + 50);
  }

  /* ── Flavor pool helpers ─────────────────────────────────────────
   * Per-pool last-used index tracking to avoid immediate repeats. */
  var _lastFlavorIdx = {};
  function _pickFlavor(poolName, pool) {
    if (!pool || pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    var last = _lastFlavorIdx[poolName];
    var idx;
    do { idx = Math.floor(Math.random() * pool.length); } while (idx === last);
    _lastFlavorIdx[poolName] = idx;
    return pool[idx];
  }

  // ── Color palettes ──
  // Heal palette mirrors rumble heal visuals (white + pinks).
  var HEAL_COLORS = ['#ffffff', '#ffeeee', '#ffe0f0', '#ffddff'];
  function _pickHealColor() {
    return HEAL_COLORS[Math.floor(Math.random() * HEAL_COLORS.length)];
  }

  // ── shieldCrit flavor pool ──
  // Lego/dungeon dad-joke vibe. Each line short enough for one row
  // under the shield bar. Server "+N armor" appended separately.
  var SHIELD_CRIT_FLAVORS = [
    "Brick wall!",
    "Click! Locked in!",
    "Studs up!",
    "Built different!",
    "Plate armor — literally!",
    "Snap! Stronger!",
    "Stack 'em high!",
    "That'll hold!",
    "Brick by brick!",
    "Reinforced!",
    "Hold the line!",
    "Solid as a rock!"
  ];

  // Helper: find gold-display element on the dashboard. Returns
  // {x, y} viewport coords if found, null otherwise.
  function _findGoldDestination() {
    // Prefer a stable id-based selector if one exists; otherwise look for
    // the .stat-num element styled with the gold color in the dashboard.
    var el = document.getElementById('my-gold-display');
    if (!el) {
      // Fallback: scan dashboard pane for any element containing 🪙 emoji
      // followed by a number (the gold display)
      var pane = document.getElementById('pane-dashboard');
      if (pane && pane.classList.contains('active')) {
        var candidates = pane.querySelectorAll('.stat-num');
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i].textContent.indexOf('🪙') >= 0) {
            el = candidates[i];
            break;
          }
        }
      }
    }
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Brick color palette — used by brickGained preset. Mirrors the
  // server-emitted brickColor strings to a hex value. Keep in sync with
  // characters.js BRICK_PALETTE if that ever centralizes.
  var BRICK_HEX = {
    gray:   '#AAAAAA', blue:   '#006DB7', white:  '#EFEFEF',
    yellow: '#F5D000', orange: '#F57C00', red:    '#D01012',
    purple: '#7B2FBE', green:  '#237841', black:  '#1a1a1a'
  };
  var BRICK_GLOW = {
    gray:   '#FFFFFF', blue:   '#4db8ff', white:  '#FFFFFF',
    yellow: '#FFE87C', orange: '#FFC078', red:    '#E24B4A',
    purple: '#9B6FD4', green:  '#5DA831', black:  '#555555'
  };

  // Event burst color palette — migrated from burstParticles. Used by
  // eventBurst preset only.
  var EVENT_BURST_COLORS = {
    nothing:    ['#888888','#AAAAAA','#CCCCCC'],
    gold:       ['#F5D000','#E8A23E','#FFF8DC'],
    gray:       ['#AAAAAA','#CCCCCC','#F0EED8'],
    blue:       ['#006DB7','#4db8ff','#7B2FBE'],
    riddle:     ['#F5D000','#FFE87C','#E8A23E'],
    trap:       ['#F57C00','#E24B4A','#FFE87C'],
    doubletrap: ['#F57C00','#E24B4A','#FFE87C'],
    monster:    ['#E24B4A','#D01012','#F57C00'],
    purple:     ['#7B2FBE','#9B6FD4','#4db8ff'],
    green:      ['#1D9E75','#5DA831','#FFE87C'],
    red:        ['#D01012','#E24B4A','#F5D000'],
    white:      ['#EFEFEF','#FFFFFF','#CCCCCC'],
    black:      ['#1a1a1a','#555555','#7B2FBE'],
    boss:       ['#D01012','#7B2FBE','#F5D000']
  };

  // ── Primitive: canvas-based particle burst ──────────────────────
  // Used by eventBurst (50+ particles with gravity sim — too heavy
  // for DOM/CSS). Creates a transient canvas, runs requestAnimationFrame
  // loop with custom gravity, removes itself when done.
  function _canvasBurst(cx, cy, opts) {
    var colors = opts.colors || ['#FFF'];
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1001;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var baseCount = 32;
    var count = Math.round(baseCount * (1.3 + Math.random() * 1.4));
    var primaryCount = Math.round(count * 0.75);
    var particles = [];
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 1.5 + Math.random() * 3.5;
      var isPrimary = i < primaryCount;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 1.5,
        r: isPrimary ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: isPrimary ? 1 : 0.5
      });
    }
    var start = null;
    var DURATION = 420 * (1 + Math.random() * 1.7);
    function frame(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / DURATION, 1);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function(p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.12;
        var life = 1 - progress;
        ctx.globalAlpha = p.alpha * life * life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      if (progress < 1) requestAnimationFrame(frame);
      else { ctx.globalAlpha = 1; canvas.remove(); }
    }
    requestAnimationFrame(frame);
  }

  // ── Primitive: coin pile ───────────────────────────────────────
  // Cluster of glyph emoji at (cx,cy) that fades out over lifeMs. Used
  // by goldGained as visual cue for "stack to drain." v0.15.40: glyph
  // overrideable so cheese can render '🧀🧀🧀'.
  function _coinPile(cx, cy, opts) {
    var overlay = _ensureOverlay();
    var lifeMs  = opts.lifeMs || 600;
    var glyph   = opts.glyph  || '🪙';
    var pile = document.createElement('div');
    pile.className = 'coin-pile';
    pile.textContent = glyph + glyph + glyph;
    pile.style.left = cx + 'px';
    pile.style.top  = cy + 'px';
    pile.style.animationDuration = lifeMs + 'ms';
    overlay.appendChild(pile);
    setTimeout(function(){
      if (pile.parentNode) pile.parentNode.removeChild(pile);
    }, lifeMs + 50);
  }

  // ── Primitive: flying coin ─────────────────────────────────────
  // Single glyph emoji that arcs from (sx,sy) to dest. If dest is null,
  // the glyph drifts upward and fades (no destination — usually because
  // the player is on a different tab). Uses CSS variables for the
  // travel path so keyframes can interpolate. v0.15.40: glyph override
  // so cheese can render '🧀'.
  function _flyingCoin(sx, sy, dest, opts) {
    var overlay = _ensureOverlay();
    var delayMs = opts.delayMs || 0;
    var lifeMs  = opts.lifeMs  || 850;
    var glyph   = opts.glyph   || '🪙';
    var coin = document.createElement('div');
    coin.className = dest ? 'flying-coin' : 'flying-coin no-dest';
    coin.textContent = glyph;
    coin.style.left = sx + 'px';
    coin.style.top  = sy + 'px';
    if (dest) {
      var dx = dest.x - sx;
      var dy = dest.y - sy;
      coin.style.setProperty('--cdx', dx + 'px');
      coin.style.setProperty('--cdy', dy + 'px');
      // Bow waypoint at 50% — arc upward then come down (gives the
      // coin a "tossed" feel rather than a straight line).
      var bowY = -Math.abs(dx) * 0.3 - 30;  // higher arc for longer distances
      coin.style.setProperty('--cbx', (dx * 0.5) + 'px');
      coin.style.setProperty('--cby', (dy * 0.5 + bowY) + 'px');
    }
    coin.style.animationDelay    = delayMs + 'ms';
    coin.style.animationDuration = lifeMs + 'ms';
    overlay.appendChild(coin);
    setTimeout(function(){
      if (coin.parentNode) coin.parentNode.removeChild(coin);
    }, delayMs + lifeMs + 50);
  }


  /* ── Presets ───────────────────────────────────────────────────── */
  var PRESETS = {
    // shieldCrit — firework redesign (v0.15.31).
    // Particles: 18, per-particle 1500-2800ms lifetime (sizzle), high
    // initial velocity (CSS keyframe pushes most distance early), strong
    // upward bias on radial endpoint, gravity arc late in life. Variable
    // sizes 4-7px for visual depth. NO bow paths — pure radial firework.
    // Text: variable per fire (12-line flavor pool), random horizontal
    // trajectory above horizon — always upward, but tdx jitter so
    // successive crits don't stack the same dead-vertical line.
    shieldCrit: function(pos, data) {
      var pipsEl = document.getElementById('my-shield-pips');
      var cx = pos.x, cy = pos.y;
      if (pipsEl) {
        var pr = pipsEl.getBoundingClientRect();
        if (pr.width > 0) {
          cx = pr.left + pr.width  / 2;
          cy = pr.top  + pr.height / 2;
        }
      }
      _particleBurst(cx, cy, {
        count:      18,
        className:  'gray-crit-particle',
        minDist:    50,
        maxDist:    110,    // bigger blast radius for firework feel
        upBias:     14,     // stronger initial up bias (was 6)
        lifeMsMin:  1500,
        lifeMsMax:  2800,   // ~2× v0.15.30's 1.4s, randomized per particle
        sizeMin:    4,
        sizeMax:    7,
        delayMaxMs: 60
      });
      var serverLabel = (data && data.label) ? data.label : '';
      var armorMatch  = serverLabel.match(/\+(\d+)\s*armor/i);
      var flavor      = _pickFlavor('shieldCrit', SHIELD_CRIT_FLAVORS);
      var text        = '⚡ ' + flavor;
      if (armorMatch) text += ' +' + armorMatch[1] + ' armor';
      else if (!flavor) text = '⚡ ' + (serverLabel || 'Shield crit!');
      // Random horizontal travel: -40px to +40px. Always travels up
      // (yOffset and the keyframe upward translate); horizontal varies
      // so successive crits don't go the same direction.
      var tdx = (Math.random() * 80) - 40;
      _risingText(cx, cy, text, {
        className: 'gray-crit-text',
        lifeMs:    1800,
        yOffset:   -18,
        tdx:       tdx
      });
    },

    // heal — migrated from _fireHealFeedback. Multi-component:
    // floater "+N HP" + ring pulse + sparkle particles. Sparkles have
    // per-particle randomized lifetime (the "sizzle" prior art that
    // gray-crit now also adopts). Particle count and symbol scale
    // with delta (✦ for big heals ≥10, ✧ for small).
    heal: function(pos, data) {
      var delta = (data && data.delta) ? data.delta : 1;
      var cx = pos.x, cy = pos.y;
      _risingText(cx, cy - 12, '+' + delta + ' HP', {
        className: 'heal-floater',
        lifeMs:    1200,
        yOffset:   0
      });
      _ring(cx, cy, {
        className: 'heal-ring',
        lifeMs:    900
      });
      var particleCount = Math.min(20, 3 + delta);
      var symbol = (delta >= 10) ? '✦' : '✧';
      _particleBurst(cx, cy, {
        count:       particleCount,
        className:   'heal-sparkle',
        minDist:     40,
        maxDist:     80,
        upBias:      20,
        symbol:      symbol,
        sizeMin:     14,
        sizeMax:     22,
        pickColor:   _pickHealColor,
        lifeMsMin:   800,
        lifeMsMax:   1200,
        delayMaxMs:  0
      });
    },

    // casterAck — migrated from _fireCasterAck. Single-ring flash at
    // drag-release position (acknowledgment that an ally target was
    // selected). Anchor accepts a captured DOMRect since the ally icon
    // may dismount before fire time.
    casterAck: function(pos, data) {
      _ring(pos.x, pos.y, {
        className: 'caster-ack-ring',
        lifeMs:    500
      });
    },

    // eventBurst — migrated from burstParticles in v0.15.36. Canvas-based
    // colorful particle explosion when a player lands on an event space.
    // Uses _canvasBurst primitive (canvas-rendered for 50+ particles with
    // gravity sim — DOM particles don't perform well at this density on
    // mobile). Color palette per evType from EVENT_BURST_COLORS.
    eventBurst: function(pos, data) {
      var evType = (data && data.evType) || 'nothing';
      var colors = EVENT_BURST_COLORS[evType] || EVENT_BURST_COLORS.nothing;
      _canvasBurst(pos.x, pos.y, { colors: colors });
    },

    // brickGained — replaces the brick-gained must-click reward card with
    // ambient FX. Particle burst in the brick's color + rising "+1 brick"
    // text. Fast, frequent reward feedback that doesn't halt gameplay.
    brickGained: function(pos, data) {
      var brickColor = (data && data.brickColor) || 'gray';
      var hex = BRICK_HEX[brickColor] || '#888';
      var glow = BRICK_GLOW[brickColor] || hex;
      _particleBurst(pos.x, pos.y, {
        count:        12,
        className:    'brick-gained-particle',
        minDist:      30,
        maxDist:      70,
        upBias:       16,
        lifeMsMin:    700,
        lifeMsMax:    1100,
        sizeMin:      4,
        sizeMax:      7,
        pickColor:    function(){ return Math.random() < 0.7 ? hex : glow; },
        delayMaxMs:   40
      });
      _risingText(pos.x, pos.y, '+1 ' + brickColor + ' brick', {
        className: 'brick-gained-text',
        lifeMs:    1200,
        yOffset:   -16,
        tdx:       (Math.random() * 60) - 30
      });
    },

    // goldGained — replaces the gold-gained must-click reward card with
    // ambient flow-to-inventory FX. Showpiece preset.
    //
    // For amount <= 3: individual coins arc from origin to gold-display
    //                  position, ~80ms staggered.
    // For amount > 3:  pile of coins materializes briefly at origin,
    //                  then up to 12 individual coins flow out in a
    //                  staggered stream. Pile shrinks as coins leave.
    // The "+N gold" text rises briefly above the origin to confirm
    // the amount being awarded.
    //
    // Destination: tries to find the gold-display element on the dashboard.
    // If unavailable (player on different tab), the FX still plays at
    // the origin with the floater text — coins just drift up and fade
    // instead of flowing somewhere specific.
    goldGained: function(pos, data) {
      var amount = (data && data.amount) || 1;
      var cx = pos.x, cy = pos.y;
      // v0.15.40: caller can pass `dest` (viewport coords) to override the
      // auto-find. Used for cheese (which reuses this preset but needs its
      // own destination). If absent, fall back to gold-display auto-find.
      // Also `glyph` overrides the coin emoji ('🪙' default), and
      // `floaterText` overrides the +N text.
      var dest = (data && data.dest) || _findGoldDestination();
      var glyph = (data && data.glyph) || '🪙';
      var floaterText = (data && data.floaterText) || ('+' + amount + ' ' + glyph);
      var coinCount = Math.min(12, Math.max(1, amount));
      // Floater text — confirms the +N amount even if no coins reach destination
      _risingText(cx, cy, floaterText, {
        className: 'gold-gained-text',
        lifeMs:    1400,
        yOffset:   -22
      });
      // Pile (only for amount > 3) — shows briefly at origin, fades as
      // coins flow out. Visual cue that there's a stack to drain.
      if (amount > 3) {
        _coinPile(cx, cy, { lifeMs: 600, glyph: glyph });
      }
      // Individual coin flow — each coin staggered, arcs from origin to dest
      for (var i = 0; i < coinCount; i++) {
        _flyingCoin(cx, cy, dest, {
          delayMs:  i * 70,
          lifeMs:   850,
          glyph:    glyph
        });
      }
    },

    // v0.15.41 — flyingBrick. Arcs a brick-colored square from origin
    // (pos) to destination (data.dest), arriving over ~lifeMs. Used by
    // the Collect drain pattern so each brick visibly flies from the
    // resolution card icon to its inventory chip. Larger and more
    // visible than the brickGained particle burst — this is "the brick
    // travels," not "a brick happened."
    //
    // data:
    //   brickColor — color name ('red', 'blue', etc.) — required
    //   dest       — { x, y } viewport coords; falls back to upward drift
    //   lifeMs     — total flight time (default 650)
    flyingBrick: function(pos, data) {
      var brickColor = (data && data.brickColor) || 'gray';
      var hex  = BRICK_HEX[brickColor]  || '#888';
      var glow = BRICK_GLOW[brickColor] || hex;
      var dest = data && data.dest;
      var lifeMs = (data && data.lifeMs) || 650;
      _flyingBrickElement(pos.x, pos.y, dest, hex, glow, brickColor, lifeMs);
    },

    // v0.15.41 — chipPulse. Briefly scales + glows an inventory chip
    // when a reward lands. Used by Collect drain on arrival to visually
    // confirm "this is where it landed." Subtle but satisfying.
    //
    // anchor: an element selector or DOMRect (the chip itself).
    // data:
    //   color   — accent color (e.g. brick hex, gold yellow, cheese yellow)
    //   lifeMs  — total pulse duration (default 500)
    chipPulse: function(pos, data) {
      var color = (data && data.color) || '#FFFFFF';
      var lifeMs = (data && data.lifeMs) || 500;
      _chipPulseElement(pos.x, pos.y, pos.rect, color, lifeMs);
    }
  };

  // ── Primitive: flying brick ────────────────────────────────────
  // Single colored square that arcs from (sx,sy) to dest over lifeMs.
  // CSS keyframes interpolate the path via --bdx/--bdy (endpoint) and
  // --bbx/--bby (mid-arc waypoint). Bordered for visibility on dark
  // backgrounds, color-glow shadow for the brick's hue.
  function _flyingBrickElement(sx, sy, dest, hex, glow, brickColor, lifeMs) {
    var overlay = _ensureOverlay();
    var brick = document.createElement('div');
    brick.className = dest ? 'flying-brick' : 'flying-brick no-dest';
    brick.style.left = sx + 'px';
    brick.style.top  = sy + 'px';
    brick.style.background = hex;
    var borderStyle = brickColor === 'white' ? '1px solid #ccc' : '1px solid rgba(255,255,255,0.3)';
    brick.style.border = borderStyle;
    brick.style.boxShadow = '0 0 12px ' + glow + ', 0 2px 6px rgba(0,0,0,0.6)';
    if (dest) {
      var dx = dest.x - sx;
      var dy = dest.y - sy;
      brick.style.setProperty('--bdx', dx + 'px');
      brick.style.setProperty('--bdy', dy + 'px');
      // Arc waypoint at 50% — gentle upward bow
      var bowY = -Math.abs(dx) * 0.25 - 25;
      brick.style.setProperty('--bbx', (dx * 0.5) + 'px');
      brick.style.setProperty('--bby', (dy * 0.5 + bowY) + 'px');
    }
    brick.style.animationDuration = lifeMs + 'ms';
    overlay.appendChild(brick);
    setTimeout(function(){
      if (brick.parentNode) brick.parentNode.removeChild(brick);
    }, lifeMs + 50);
  }

  // ── Primitive: chip pulse ──────────────────────────────────────
  // Renders a glow-ring at (cx,cy) sized to fit the chip rect. Used
  // for arrival highlight when a reward lands at its destination.
  // The ring expands + fades, giving a "thunk landed here" beat.
  function _chipPulseElement(cx, cy, rect, color, lifeMs) {
    var overlay = _ensureOverlay();
    var ring = document.createElement('div');
    ring.className = 'chip-pulse';
    // Size to fit the chip rect (with padding)
    var w = (rect && rect.width)  ? rect.width  + 12 : 56;
    var h = (rect && rect.height) ? rect.height + 12 : 32;
    ring.style.left = (cx - w/2) + 'px';
    ring.style.top  = (cy - h/2) + 'px';
    ring.style.width  = w + 'px';
    ring.style.height = h + 'px';
    ring.style.borderColor = color;
    ring.style.boxShadow = '0 0 14px ' + color + ', inset 0 0 14px ' + color + '88';
    ring.style.animationDuration = lifeMs + 'ms';
    overlay.appendChild(ring);
    setTimeout(function(){
      if (ring.parentNode) ring.parentNode.removeChild(ring);
    }, lifeMs + 50);
  }


  function fire(presetName, anchor, data) {
    var fn = PRESETS[presetName];
    if (!fn) {
      console.warn('[BoardFx] unknown preset: ' + presetName);
      return;
    }
    var pos = _anchorCenter(anchor);
    if (!pos) return;
    fn(pos, data || {});
  }

  global.BoardFx = {
    fire:    fire,
    PRESETS: PRESETS
  };

})(typeof window !== 'undefined' ? window : this);
