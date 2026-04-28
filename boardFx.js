/* ═══════════════════════════════════════════════════════════════════
 * boardFx.js — unified board-side ambient FX
 *
 * Particle bursts, rising text, fly-to icons. Schema-driven via PRESETS.
 * Never blocks input; never demands a click. For must-click cards, see
 * boardModal.js (later refactor).
 *
 * Architecture invariant — the bug-fix-by-construction:
 *   FX nodes are NEVER attached to elements that get rebuilt by
 *   render(). They live inside #board-fx-overlay, a position:fixed
 *   container appended to document.body lazily on first call. The
 *   overlay is outside the dashboard pane's innerHTML wipe zone, so
 *   particles complete their full animation lifecycle regardless of
 *   render frequency. Anchor coordinates are computed at fire time
 *   via getBoundingClientRect(); the overlay covers the viewport.
 *
 * Public API:
 *   BoardFx.fire(presetName, anchor, data)
 *     - presetName: key in BoardFx.PRESETS
 *     - anchor:     Element or selector string identifying the
 *                   element to position FX over
 *     - data:       optional payload (label, color overrides, etc.)
 *                   shape depends on preset
 *
 * To add a preset: drop an entry in PRESETS. The preset function
 * receives ({centerX, centerY, anchorRect}, data) in viewport space
 * and returns nothing — it just attaches DOM nodes to the overlay
 * and schedules their cleanup.
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
      // Cover viewport, never block input, never affect layout.
      _overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:90;' +
        'overflow:visible;';
      document.body.appendChild(_overlay);
    }
    return _overlay;
  }

  function _resolveAnchor(anchor) {
    if (!anchor) return null;
    if (typeof anchor === 'string') return document.querySelector(anchor);
    if (anchor.nodeType === 1) return anchor;
    return null;
  }

  function _anchorCenter(anchor) {
    var el = _resolveAnchor(anchor);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return {
      x:    r.left + r.width  / 2,
      y:    r.top  + r.height / 2,
      rect: r
    };
  }

  /* ── Primitive: particle burst ───────────────────────────────────
   * Spawn N particles drifting outward in a rough circle from (cx,cy).
   * Each particle gets randomized direction via CSS custom properties
   * --pdx/--pdy (radial endpoint) and --pbx/--pby (perpendicular bow
   * waypoint at midpoint, used by keyframes for arcing paths). Caller
   * provides the className that styles + animates the particle
   * (animation declared in boardFx.css). */
  function _particleBurst(cx, cy, opts) {
    var overlay  = _ensureOverlay();
    var count    = opts.count     || 14;
    var minDist  = opts.minDist   || 24;
    var maxDist  = opts.maxDist   || 60;
    var upBias   = opts.upBias    || 6;
    var bowAmt   = opts.bowAmount || 0;   // 0 = straight; >0 = arcing
    var className = opts.className;
    var lifeMs   = opts.lifeMs    || 950;
    var size     = opts.size      || 5;

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = className;
      var ang = (Math.PI * 2) * (i / count) + (Math.random() - 0.5) * 0.4;
      var dist = minDist + Math.random() * (maxDist - minDist);
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist - upBias;
      p.style.left = (cx - size / 2) + 'px';
      p.style.top  = (cy - size / 2) + 'px';
      p.style.setProperty('--pdx', dx + 'px');
      p.style.setProperty('--pdy', dy + 'px');
      // Perpendicular bow waypoint for the 50% keyframe — gives the
      // particle an arcing path instead of a straight line. Direction
      // (left vs right of the radial) is randomized per particle.
      // Magnitude is bowAmt × random(0.5–1.0) of the radial distance.
      if (bowAmt > 0) {
        var sign = (Math.random() < 0.5) ? -1 : 1;
        var mag  = bowAmt * (0.5 + Math.random() * 0.5);
        // perpendicular to (dx,dy) is (-dy,dx); normalize then scale
        var len = Math.sqrt(dx*dx + dy*dy) || 1;
        var bx  = (-dy / len) * mag * sign;
        var by  = ( dx / len) * mag * sign;
        // Midpoint position = halfway to endpoint + perpendicular bow
        p.style.setProperty('--pbx', (dx * 0.5 + bx) + 'px');
        p.style.setProperty('--pby', (dy * 0.5 + by) + 'px');
      } else {
        // straight-line midpoint (no bow)
        p.style.setProperty('--pbx', (dx * 0.5) + 'px');
        p.style.setProperty('--pby', (dy * 0.5) + 'px');
      }
      p.style.animationDelay = (Math.random() * 0.08) + 's';
      overlay.appendChild(p);
      setTimeout(function(el){
        if (el.parentNode) el.parentNode.removeChild(el);
      }, lifeMs, p);
    }
  }

  /* ── Primitive: rising text ──────────────────────────────────────
   * Drop a text node at (cx, cy) that fades up + away. Caller provides
   * className (animation in boardFx.css). The translate(-50%) in the
   * keyframes horizontally centers the node on cx. */
  function _risingText(cx, cy, text, opts) {
    var overlay = _ensureOverlay();
    var className = opts.className;
    var lifeMs    = opts.lifeMs || 1500;
    var yOffset   = (opts.yOffset !== undefined) ? opts.yOffset : -18;

    var t = document.createElement('div');
    t.className = className;
    t.textContent = text;
    t.style.left = cx + 'px';
    t.style.top  = (cy + yOffset) + 'px';
    overlay.appendChild(t);
    setTimeout(function(){
      if (t.parentNode) t.parentNode.removeChild(t);
    }, lifeMs);
  }

  /* ── Presets ─────────────────────────────────────────────────────
   * Each preset is a function (anchorPos, data) → void. anchorPos is
   * { x, y, rect } in viewport coords; data is the payload from the
   * caller (typically server-emitted reward info). Add new presets by
   * dropping an entry here. */

  // Per-preset flavor state. Tracks last-used index per pool to avoid
  // immediate repeats. Keyed by pool name.
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

  // shieldCrit flavor pool — Lego/dungeon dad-joke vibe. Each line is
  // short enough to fit on one row under the shield bar. The "+N armor"
  // amount is parsed from the server label and appended separately so
  // the flavor stays variable while the count info is preserved.
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

  var PRESETS = {
    shieldCrit: function(pos, data) {
      // Center on the shield-pip row specifically (sub-element of the
      // shield section anchor) when available, falling back to the
      // anchor's center. Visually anchors the burst at the pips, not
      // mid-section.
      var pipsEl = document.getElementById('my-shield-pips');
      var cx = pos.x, cy = pos.y;
      if (pipsEl) {
        var pr = pipsEl.getBoundingClientRect();
        if (pr.width > 0) {
          cx = pr.left + pr.width  / 2;
          cy = pr.top  + pr.height / 2;
        }
      }
      // Particles: consistent shape per fire (recognizable signature),
      // per-particle randomization (angle/distance/delay/bow direction)
      // for visual richness. 18 particles, 1.4s life, bow paths.
      _particleBurst(cx, cy, {
        count:      18,
        className:  'gray-crit-particle',
        lifeMs:     1425,
        size:       5,
        bowAmount:  18    // perpendicular waypoint magnitude in px
      });
      // Text: variable per fire. Pull a flavor line, append the armor
      // amount if the server label carries it (regex match "+N armor").
      // Falls back to "Shield crit!" if data has no label at all.
      var serverLabel = (data && data.label) ? data.label : '';
      var armorMatch  = serverLabel.match(/\+(\d+)\s*armor/i);
      var flavor      = _pickFlavor('shieldCrit', SHIELD_CRIT_FLAVORS);
      var text        = '⚡ ' + flavor;
      if (armorMatch) text += ' +' + armorMatch[1] + ' armor';
      else if (!flavor) text = '⚡ ' + (serverLabel || 'Shield crit!');
      _risingText(cx, cy, text, {
        className: 'gray-crit-text',
        lifeMs:    1500,
        yOffset:   -18
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
    if (!pos) {
      // Anchor missing or hidden — silent skip. Same behavior as the
      // pre-refactor showGrayCritFx; FX is non-essential feedback so
      // a missing anchor (e.g., player on a different tab) is fine.
      return;
    }
    fn(pos, data || {});
  }

  global.BoardFx = {
    fire:    fire,
    PRESETS: PRESETS
  };

})(typeof window !== 'undefined' ? window : this);
