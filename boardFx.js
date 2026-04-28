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
    }
  };

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
