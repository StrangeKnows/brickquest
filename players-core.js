/* ═══════════════════════════════════════════════════════════════════
 * players-core.js — shared spine for players.html and test_players.html
 *
 * Extracted in v0.15.34 from players.html (canonical source). Contains
 * the 184 functions shared between the two shells + top-level shared
 * state. Each shell file loads this then provides its own bootstrap:
 *   - players.html: production class-select IIFE, production
 *     connectWS (single-client), production setConn (real impl).
 *   - test_players.html: multi-client harness state, harness connectWS
 *     (loops PLAYER_META), setConn no-op, testSwitch.
 *
 * Architecture invariant: do NOT add shell-specific code here. If a
 * function diverges between production and harness, it stays in the
 * shell. The spine is the byte-identical-across-shells substrate.
 *
 * Load order: characters.js -> game.js -> rumble.js -> boardFx.js
 * -> players-core.js -> (inline shell bootstrap).
 * =================================================================== */


// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
var MY_CLASS = null;

var client   = null;
var G        = null; // full game state
var pendingTradeOffer = null;
var _pendingTradeSent = null; // { targetCls, wantColor, offerColor } — shown on sender's Bricks tab
var _marketOpen = false;
var _pendingResult = null;
var _landingRollSent = false;
var _burstFiredFor = null; // tracks which activeEvent got the burst — cls+roll key // prevents double-send of auto landing roll
var _statusOpen = {}; // tracks open/closed state of collapsible status cards // inline result card shown in action pane until dismissed
var lastRoll = null;

// v0.15.38 — Resolution-card dismissal state. When the player taps Collect
// on a buildResolutionCard, the card needs to STAY hidden across the next
// state broadcast (server still has activeEvent until DM marks resolved).
// Keyed by event signature (cls + roll + evType) — the same shape used by
// _burstFiredFor. Render functions check this; if set for the current event,
// the resolution card is skipped. Reset implicitly when activeEvent changes
// (new key = new entry, never matches old).
var _collectedResolutions = {};

// v0.15.39 — When _collectedResolutions has the active-event key, the entire
// active-event panel collapses (not just the resolution card). This lets the
// FX and the inventory stand on their own without leftover event card.
// restoreActiveEvent checks this flag and short-circuits.
function _activeEventCollectKey() {
  if (!G || !G.activeEvent) return null;
  var ev = G.activeEvent;
  return (ev.cls||'') + '|' + (ev.roll||'') + '|' + (ev.evType||'');
}

// v0.15.42 — Drained-tokens state. As each reward icon drains during Collect,
// its token is added to the set for the active event key. renderRewardIcons
// checks this set and renders drained icons as faded-out shells (preserves
// layout but visually removed). This makes the per-icon fade survive renders
// triggered by delta increments — without it, the card is rebuilt with fresh
// icons every render and the visual drain effect is invisible.
//
// Shape: { eventKey: { token: true, ... } }
// Cleared when activeEvent changes.
var _drainedTokens = {};

// v0.15.42 — Card-fading flag. Set when the post-drain card fade-out begins.
// buildResolutionCard renders the card with opacity:0 if this flag is set
// for the active event key, so subsequent renders preserve the fading state
// instead of reverting the card to full opacity. After the fade transition
// completes, _collectedResolutions flag is set which collapses the panel
// entirely.
//
// Shape: { eventKey: true }
// Cleared when activeEvent changes.
var _cardFading = {};

// v0.16.1 — Card-entered flag. Tracks which event keys have already shown
// the entrance animation. Without this, EVERY render re-rebuilds the card
// DOM with class `bq-card-enter`, retriggering the 250ms scale+opacity
// animation — visible as a "flash" on each re-render during gameplay.
//
// First render: flag absent → bq-card-enter applied → animation runs.
// Subsequent renders: flag present → bq-card-enter omitted → no animation.
//
// Shape: { eventKey: true }
// Cleared when activeEvent changes.
var _cardEntered = {};

// v0.16.4 — Frozen flavor stash. When a card is fading (post-drain), the
// rotating flavor text (button label AND body flavor) should STOP — text
// freezes at whatever it last rolled. Without this stash,
// _pickResolutionCollectFlavor and event-branch LANDING_FLAVOR picks would
// re-roll on each render during the fade and the text would visibly
// shuffle while the card is dissolving away. Bad polish.
//
// Set on each render that ISN'T fading: stash the latest values. Once
// fading begins, buildResolutionCard reads from stash instead of re-rolling.
// Stash is locked from that point until card collected.
//
// Shape: { eventKey: { button: "Snagged!", body: "..." } }
// Cleared when activeEvent changes.
var _cardFlavors = {};

// v0.16.5 — Post-rumble pulse delay flag. When the user just exited a
// rumble battle, dashboard chipPulse fires can land while the user's
// attention is still transitioning from the rumble UI. Without a beat
// to register where the dashboard chips are, the pulse is "over before
// you saw it."
//
// Set by the rumble-end handler (line ~410). Consumed by
// _detectInvIncreasesAndPulse — when set, defers the pulse calls so
// the user has time to land on the dashboard before the arrival
// highlights fire. v0.16.7: bumped 500ms → 1000ms per Ross feedback
// "need more delay after rumble for flair fx, maybe twice as long".
//
// Single boolean — covers any number of post-rumble chip rises in
// the same render pass.
var _justExitedRumble = false;

// v0.16.9 — Connection state cache. The conn-dot now lives inside the
// header card (rendered by _dashHeader), so connection events can fire
// before the dot exists in the DOM. This boolean is set by setConn()
// in players.html / setClass() in test_players.html and read by
// _dashHeader when rendering the dot. setConn() also still tries to
// directly update the DOM element (for connection events that happen
// AFTER the first render).
var _connState = false;

// v0.15.46 — Resolution snapshot model. REPLACES the v0.15.39 _displayDeltas
// system entirely.
//
// PROBLEM the old delta system had:
// _displayDeltas was set when buildResolutionCard fired, which happens INSIDE
// restoreActiveEvent which runs AFTER renderDashboard. So dashboard read raw
// values + 0 delta on the same frame the deltas were arming. The browser
// painted the un-masked count → "pre-tap flash" visible.
//
// THE NEW MODEL:
// Snapshot is taken at TOP OF render(), before any sub-renders. Detects an
// inventory change since the last render during an active uncollected event
// (the credit moment) — snapshots the PREVIOUS render's inventory at that
// moment. _displayed/_displayedBricks read the snapshot if present. Snapshot
// persists until Collect drain ticks it up to live value, or activeEvent
// changes.
//
// Why this fixes the flash universally:
// Snapshot is set before renderDashboard runs. Dashboard reads snapshot.
// No timing race, no flash. Works for ALL event types — the fix is
// render-order agnostic because it runs at top-of-render.
//
// Shape: { eventKey: { gold: N, cheese: N, bricks: { color: N } } }
// Cleared when activeEvent changes.
var _resolutionSnapshots = {};

// Previous-render inventory. Compared to current to detect "inventory changed
// during an uncollected event" — that change is the credit moment, and we
// snapshot _prevRenderInv as the pre-credit state.
var _prevRenderInv = null;

// _displayed/_displayedBricks: read snapshot if present for active event,
// else live value. Snapshot wins because it's pre-credit; the credit is
// what we want to mask until Collect drain reveals it.
function _displayed(me, field) {
  if (!me) return 0;
  var key = _activeEventCollectKey();
  if (key && _resolutionSnapshots[key] && _resolutionSnapshots[key][field] !== undefined) {
    return _resolutionSnapshots[key][field];
  }
  return me[field] || 0;
}

function _displayedBricks(me, color) {
  if (!me || !me.bricks) return 0;
  var key = _activeEventCollectKey();
  if (key && _resolutionSnapshots[key] && _resolutionSnapshots[key].bricks && _resolutionSnapshots[key].bricks[color] !== undefined) {
    return _resolutionSnapshots[key].bricks[color];
  }
  return me.bricks[color] || 0;
}

// Returns true if any snapshot is currently masking real values.
function _hasActiveSnapshot() {
  var key = _activeEventCollectKey();
  return !!(key && _resolutionSnapshots[key]);
}

// v0.15.46 — Take snapshot if conditions are right. Called at TOP of render()
// BEFORE renderDashboard or restoreActiveEvent. Detects "inventory changed
// during an active uncollected event" — the credit moment. Snapshots the
// PREVIOUS inventory as the pre-credit state.
//
// Idempotent: only snapshots once per event key. Subsequent renders no-op.
// Snapshot is locked until drain clears it or activeEvent changes.
//
// v0.16.3: SKIP snapshot for events that don't have a Collect drain.
// Specifically: monster/boss rumble results — server auto-credits at battleEnd,
// no Collect button shown, so masking the credit is harmful. Without this
// skip, the snapshot model freezes inventory at pre-rumble state until DM
// resolves (which clears activeEvent), and chipPulse doesn't fire because
// _hasActiveSnapshot blocks it. Rumble loot needs to be visible immediately.
function _maybeTakeSnapshot(me) {
  if (!G || !G.activeEvent) return;
  // v0.16.3: rumble events bypass the snapshot mask entirely.
  if (G.activeEvent.evType === 'monster' || G.activeEvent.evType === 'boss') return;
  var key = _activeEventCollectKey();
  if (!key) return;
  if (_resolutionSnapshots[key]) return;  // already snapshotted
  if (!_prevRenderInv) return;            // no previous to compare
  if (_collectedResolutions[key]) return; // already collected
  // Detect inventory change since previous render
  var changed = false;
  if ((me.gold||0) !== (_prevRenderInv.gold||0)) changed = true;
  if (!changed && (me.cheese||0) !== (_prevRenderInv.cheese||0)) changed = true;
  if (!changed) {
    var bricks = me.bricks || {};
    var pb = _prevRenderInv.bricks || {};
    var allColors = {};
    for (var c1 in bricks) allColors[c1] = true;
    for (var c2 in pb) allColors[c2] = true;
    for (var c in allColors) {
      if ((bricks[c]||0) !== (pb[c]||0)) { changed = true; break; }
    }
  }
  if (!changed) return;
  // Snapshot the previous inventory as pre-resolution state
  _resolutionSnapshots[key] = {
    gold: _prevRenderInv.gold || 0,
    cheese: _prevRenderInv.cheese || 0,
    bricks: Object.assign({}, _prevRenderInv.bricks || {})
  };
  _bqLog('snapshot-taken', { key: key, snap: _resolutionSnapshots[key] });
}

// Records the current inventory as the prev-render state for next render's
// comparison. Called at the END of render() so next render's snapshot detection
// works against this frame's data.
function _recordRenderInv(me) {
  _prevRenderInv = {
    gold: me.gold || 0,
    cheese: me.cheese || 0,
    bricks: Object.assign({}, me.bricks || {})
  };
}

// v0.15.46 — Detect inventory increases since previous render and fire
// chipPulse on the affected dashboard chips. This unifies the
// "inventory-grew arrival highlight" pattern beyond Collect drain to ALL
// inventory increase moments — most importantly post-rumble combat where
// rewards just credit without a Collect button.
//
// Skipped when a Collect-resolution snapshot is active: drain's manual
// chipPulse fires on per-element arrival, and the snapshot mask means
// `me[field]` rises but `_displayed` lags (drain ticks snapshot up). We
// don't want auto-pulse to compete with the drain visuals.
function _detectInvIncreasesAndPulse(me) {
  if (!_prevRenderInv) return;
  if (_hasActiveSnapshot()) return;
  // v0.16.5: post-rumble delay. If user just exited a rumble, defer the
  // pulse calls by 500ms so the dashboard has a beat to settle into the
  // user's attention before chipPulse fires. Without this, pulses fire
  // during the rumble→dashboard context switch and the user misses them.
  // Flag consumed (cleared) on this pass.
  // Re-queries chip position inside the deferred call so any layout shift
  // between now and 500ms is handled.
  var delayMs = 0;
  if (_justExitedRumble) {
    delayMs = 1000;
    _justExitedRumble = false;
  }
  function _firePulse(findFn, color, findArg) {
    if (delayMs > 0) {
      setTimeout(function(){
        var dest = findArg !== undefined ? findFn(findArg) : findFn();
        if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: color });
      }, delayMs);
    } else {
      var dest = findArg !== undefined ? findFn(findArg) : findFn();
      if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: color });
    }
  }
  // Gold
  if ((me.gold||0) > (_prevRenderInv.gold||0)) {
    _firePulse(_findGoldChipDest, '#F5D000');
  }
  // Cheese
  if ((me.cheese||0) > (_prevRenderInv.cheese||0)) {
    _firePulse(_findCheeseChipDest, '#FFD96A');
  }
  // Bricks — pulse each color whose count rose
  var bricks = me.bricks || {};
  var pb = _prevRenderInv.bricks || {};
  for (var c in bricks) {
    if ((bricks[c]||0) > (pb[c]||0)) {
      var hex = (typeof BRICK_COLORS !== 'undefined' && BRICK_COLORS[c]) || '#FFFFFF';
      _firePulse(_findBrickChipDest, hex, c);
    }
  }
}

// v0.15.46 — Tick snapshot value upward toward live during Collect drain.
// Replaces the v0.15.39 _displayDeltas mutations during drain arrivals.
// Each drain arrival calls this with field+amount; snapshot moves +amount.
// When snapshot equals live, the snapshot can be cleared (drain complete).
function _tickSnapshot(field, color, amount) {
  var key = _activeEventCollectKey();
  if (!key || !_resolutionSnapshots[key]) return;
  var snap = _resolutionSnapshots[key];
  if (field === 'bricks' && color) {
    snap.bricks[color] = (snap.bricks[color] || 0) + amount;
  } else {
    snap[field] = (snap[field] || 0) + amount;
  }
}

// v0.15.40/.41 — Console debug logger. Always fires during S015 development
// so the Collect drain flow is fully traceable. Once the flow is locked in,
// can be converted to flagged version (window._brickQuestDebug) or stripped.
// Tags: arm-deltas, collect-tap, drain-icon, brick-arrived, cheese-arrived,
// coin-arrived, card-fade-start, card-collected, drain-no-icon (warning),
// collect-fallback (warning).
function _bqLog(tag, data) {
  if (typeof console === 'undefined') return;
  try {
    var ts = (Date.now() % 100000);
    console.log('[bq:' + tag + '@' + ts + ']', data);
  } catch(e) {}
}

// Class UI styles live in characters.js (Phase 2 consolidation).
// Access via getCharUiStyle(cls) helper.

// ── BUILD CLASS SELECTOR ──

function selectClass(cls) {
  MY_CLASS = cls;
  const s = getCharUiStyle(cls);
  const m = PLAYER_META[cls];
  // Apply CSS vars
  document.documentElement.style.setProperty('--cls-color', s.color);
  document.documentElement.style.setProperty('--cls-bg',    s.bg);
  document.documentElement.style.setProperty('--cls-border',s.border);
  // v0.16.9: t-icon/t-name elements removed (topbar gone). Class info now
  // lives in the header card rendered by _dashHeader().
  // Build tabs (no-op stub since v0.16.8)
  buildTabs();
  // Show game screen
  document.getElementById('class-select-screen').style.display = 'none';
  document.getElementById('game-screen').classList.add('visible');
  // Connect
  connectWS();
}

// ── WEBSOCKET ──
function applyFontSize(size) {
  var scale = size / 16;
  var root = document.getElementById('zoom-root');
  var html = document.documentElement;
  var gs = document.getElementById('game-screen');
  // v0.16.8: tab-content replaced by dashboard-host
  var tc = document.getElementById('dashboard-host');

  if (scale <= 1) {
    // Default — body locked, dashboard-host scrolls naturally
    if (root) {
      root.style.transform = '';
      root.style.transformOrigin = '';
      root.style.width = '100%';
      root.style.minHeight = '';
    }
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100%';
    if (gs) { gs.style.height = ''; gs.style.minHeight = ''; gs.style.overflow = ''; }
    if (tc) { tc.style.overflow = ''; tc.style.flex = ''; tc.style.height = ''; }
  } else {
    // Zoomed in — root scaled up, body scrolls to reveal content
    var invScale = 1 / scale;
    if (root) {
      root.style.transformOrigin = 'top left';
      root.style.transform = 'scale(' + scale.toFixed(3) + ')';
      root.style.width = (invScale * 100).toFixed(2) + 'vw';
      root.style.minHeight = (invScale * 100).toFixed(2) + 'vh';
    }
    html.style.overflow = 'auto';
    html.style.overflowX = 'hidden';
    document.body.style.overflow = 'auto';
    document.body.style.overflowX = 'hidden';
    document.body.style.height = 'auto';
    if (gs) { gs.style.height = 'auto'; gs.style.minHeight = (invScale*100).toFixed(2)+'vh'; gs.style.overflow = 'visible'; }
    if (tc) { tc.style.overflow = 'visible'; tc.style.flex = 'none'; tc.style.height = 'auto'; }
  }
  try { localStorage.setItem('bq_font_size', size); } catch(e) {}
}
function initFontSize() {
  var saved = null;
  try { saved = localStorage.getItem('bq_font_size'); } catch(e) {}
  var size = saved ? Math.max(16, parseInt(saved)) : 16;
  applyFontSize(size);
  var sl = document.getElementById('font-size-slider');
  if (sl) sl.value = size;
}


// ═══════════════════════════════════════════════════════════════════════
//  RUMBLE MANAGER — bridges server rumbleBattle state to the Rumble runtime
// ═══════════════════════════════════════════════════════════════════════
// Lifecycle:
//   server state.rumbleBattle null → populated  ⇒  show rumble-root, Rumble.start()
//   server state.rumbleBattle populated → null  ⇒  teardown, hide rumble-root
//   server state.rumbleBattle.paused toggles    ⇒  Rumble.setPauseState()
//
// The Rumble runtime is initialized ONCE on first battle and reused across
// battles via start()/teardown() cycles. Events from Rumble propagate to
// the server via the existing GameClient.
var _rumbleInited = false;
var _rumbleActive = false;
var _rumbleBattleId = null; // identifies the current battle instance
var _rumbleTickThrottle = 0; // last tick sent time (ms)
var _rumbleTickInterval = 100; // send battleTick at 10 Hz

function initRumbleRuntime() {
  if (_rumbleInited || typeof Rumble === 'undefined') return;
  Rumble.init({
    onEvent: function(type, data) {
      handleRumbleEvent(type, data);
    }
  });
  _rumbleInited = true;
}

function handleRumbleEvent(type, data) {
  // Throttle tick forwarding — server doesn't need every frame.
  if (type === 'tick') {
    var now = Date.now();
    if (now - _rumbleTickThrottle < _rumbleTickInterval) return;
    _rumbleTickThrottle = now;
    if (!_rumbleActive || !client) return;
    client.send('battleTick', {
      cls: MY_CLASS,
      playerHp: data.playerHp,
      playerHpMax: data.playerHpMax,
      playerArmor: data.playerArmor,
      playerGold: data.playerGold,
      playerBricks: data.playerBricks,
      enemyHp: data.enemyHp,
      elapsedMs: data.elapsed || 0,
    });
    return;
  }
  // Terminal events — report to server and tear down locally.
  if (type === 'end') {
    if (!_rumbleActive || !client) return;
    _rumbleActive = false;
    // v0.16.5: flag the next chipPulse pass to delay so the user has a
    // beat to land on the dashboard before arrival highlights fire.
    // Consumed in _detectInvIncreasesAndPulse on next render.
    _justExitedRumble = true;
    var reason = (data && data.reason) || 'unknown';
    var victor = reason === 'victory' ? MY_CLASS
               : reason === 'defeat'  ? 'enemy'
               : 'none';
    var snap = Rumble.getState ? Rumble.getState() : {};
    client.send('battleEnd', {
      cls: MY_CLASS,
      victor: victor,
      reason: reason,
      finalHp: snap.playerHp,
      finalHpMax: snap.playerHpMax,
      finalArmor: snap.playerArmor,
      finalGold: snap.playerGold,
      finalCheese: snap.playerCheese || 0,
      // S012 §1.1 charge model:
      //   finalBrickMax = inventory ceiling (may have grown from rumble loot)
      //   finalBricks   = remaining charges (<= ceiling; persists to board as bricksCharged)
      finalBrickMax: snap.playerBrickMax || snap.playerBricks,
      finalBricks:   snap.playerBricks   || snap.playerBrickMax,
      // S013.6: revive counter from this rumble (drives loot penalty; surfaces on DM card)
      reviveCount:  snap.reviveCount || 0,
      battleStats: snap.battleStats || null,
    });
    // Victory already showed a full stats screen (dismissed via Continue button),
    // so skip the brief "VICTORY" exit-card flash and hide the rumble immediately.
    // Defeat/timeout/other reasons still show the brief exit card so the player
    // gets a clear signal before returning to the board.
    if (reason === 'victory') {
      hideRumble();
    } else {
      showRumbleExitOverlay(reason);
      setTimeout(function() { hideRumble(); }, 1200);
    }
    return;
  }
  // Other events (start, pause, resume, playerHit, enemyHit, etc.) can be
  // forwarded as log entries if desired. Skipping for MVP.
}

function showRumble() {
  var root = document.getElementById('rumble-root');
  var gs = document.getElementById('game-screen');
  if (root) root.classList.add('visible');
  if (gs) gs.classList.remove('visible');
}

function hideRumble() {
  var root = document.getElementById('rumble-root');
  var gs = document.getElementById('game-screen');
  if (root) root.classList.remove('visible');
  if (gs) gs.classList.add('visible');
  var ov = document.getElementById('rumble-exit-overlay');
  if (ov) ov.classList.remove('visible');
  // Release orientation lock so player can rotate back to portrait for board.
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch(_) {}
  // Exit fullscreen so board UI isn't cropped / app chrome returns.
  try {
    if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(function(){});
    else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
  } catch(_) {}
}

function showRumbleExitOverlay(reason) {
  var ov = document.getElementById('rumble-exit-overlay');
  if (!ov) return;
  var label = reason === 'victory' ? 'VICTORY'
            : reason === 'defeat'  ? 'DEFEATED'
            : reason === 'timeout' ? 'TIMEOUT'
            : reason === 'dm_force_quit' ? 'BATTLE ENDED'
            : 'BATTLE ENDED';
  ov.textContent = label;
  ov.classList.add('visible');
}

// Called on every server state update. Detects transitions in/out of
// rumbleBattle and drives the Rumble runtime accordingly.
function syncRumbleFromState(state) {
  if (!state) return;
  var ab = state.rumbleBattle;
  var myBattle = ab && ab.cls === MY_CLASS;

  // Transition: no battle → my battle starts
  if (myBattle && !_rumbleActive) {
    initRumbleRuntime();
    if (typeof Rumble === 'undefined') {
      console.warn('[rumble-manager] Rumble runtime not loaded; cannot start battle');
      return;
    }
    _rumbleActive = true;
    _rumbleBattleId = ab.startTime;
    showRumble();
    // Build config from server-provided player + enemy state.
    // S013 spec change: rumble starts at the player's current board charge
    // state, not full. Send bricksCharged as starting charges, bricks as
    // the ceiling (what rumble regen refills toward).
    var startConfig = {
      cls: ab.cls,
      mode: 'spec',  // real battles use the spec inventory-is-pool model
      hp: (ab.playerRumble && ab.playerRumble.hp) || 10,
      hpMax: (ab.playerRumble && ab.playerRumble.hpMax) || 10,
      armor: (ab.playerRumble && ab.playerRumble.armor) || 0,
      gold: (ab.playerRumble && ab.playerRumble.gold) || 0,
      bricks: (ab.playerRumble && ab.playerRumble.bricksCharged) || (ab.playerRumble && ab.playerRumble.bricks) || {},
      brickMax: (ab.playerRumble && ab.playerRumble.bricks) || {},
      queuedPoisonStacks: (ab.playerRumble && ab.playerRumble.queuedPoisonStacks) || 0, // v4
      refreshBoost: (ab.playerRumble && ab.playerRumble.refreshBoost) || null, // v4: FW blue-success buff
      entityCount: 1,
      entityType: ab.entityType,
      // Per-enemy resistances are baked into the rumble-side ENEMY_REGISTRY
      // (NOTES thread 4 done). entityResistances overrides only used by
      // the rumble_test dialer for tuning experiments.
      entityResistances: (ab.enemy && ab.enemy.resistances) || undefined,
    };
    try {
      Rumble.start(startConfig);
    } catch(e) {
      console.error('[rumble-manager] Rumble.start THREW:', e);
    }
    return;
  }

  // Transition: my battle ends
  if (!myBattle && _rumbleActive) {
    _rumbleActive = false;
    if (typeof Rumble !== 'undefined' && Rumble.isActive && Rumble.isActive()) {
      Rumble.forceEnd('dm_force_quit');
    }
    hideRumble();
    return;
  }

  // Ongoing battle — mirror pause state from server.
  if (myBattle && _rumbleActive && typeof Rumble !== 'undefined') {
    if (Rumble.setPauseState) {
      Rumble.setPauseState(!!ab.paused);
    }
  }
}


// ── DASHBOARD HOST (v0.16.8) ──
// Tabs system removed entirely. Pane-dashboard lives in the HTML directly
// inside .dashboard-host. The party and fusion panes are gone — their
// content surfaces in the dynamic zone via hold-gestures (v0.16.9+).
// `buildTabs` kept as a no-op for backward compatibility with the boot
// sequence; can be removed once we're confident nothing else calls it.
function buildTabs() {
  // No-op: pane-dashboard is now in the HTML, no dynamic tab construction needed.
}

// `switchTab` kept as a no-op stub. Any old call sites just trigger a render.
function switchTab(id, btn) {
  // No-op: no tabs to switch. Trigger a render in case the caller expected
  // a refresh (e.g., flavor-rotation on returning to dashboard).
  if (id === 'dashboard') {
    _flavorStaleTab = true;
    try { render(); } catch(e) {}
  }
}

// ── MAIN RENDER ──
var _riddleTimerInterval = null;

function _tickRiddleTimer() {
  var bar = document.getElementById('riddle-timer-bar');
  if (!bar || !G || !G.activeEvent || !G.activeEvent.riddleActive || !G.activeEvent.riddleEndsAt) {
    clearInterval(_riddleTimerInterval); _riddleTimerInterval = null; return;
  }
  var timeLeft = Math.max(0, G.activeEvent.riddleEndsAt - Date.now());
  var pct = Math.round(timeLeft / 300);
  var col = pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--yellow)' : 'var(--red)';
  bar.style.width = pct + '%';
  bar.style.background = col;
}
function render() {
  if (!G || !MY_CLASS) return;
  const me = G.players[MY_CLASS];
  if (!me) return;
  // v0.15.46 — TAKE SNAPSHOT before any sub-render. If inventory changed
  // since last render during an active uncollected event, snapshot the
  // PREVIOUS inventory as the pre-credit state. Subsequent renderDashboard /
  // restoreActiveEvent reads will return the snapshot via _displayed/
  // _displayedBricks. This is what eliminates the pre-tap flash universally.
  _maybeTakeSnapshot(me);
  // v0.15.46 — diagnostic log at top of every render. Shows the raw server
  // state, the active snapshot if any, and what _displayed will return.
  try {
    var __activeKey = (typeof _activeEventCollectKey === 'function') ? _activeEventCollectKey() : null;
    var __snap = __activeKey ? _resolutionSnapshots[__activeKey] : null;
    _bqLog('render-top', {
      raw: { gold: me.gold||0, cheese: me.cheese||0, bricks: Object.assign({}, me.bricks||{}) },
      snapshot: __snap,
      activeKey: __activeKey,
      hasActiveEvent: !!G.activeEvent
    });
  } catch (e) {}
  // Detect HP increases on any player and fire heal feedback visuals for MY_CLASS.
  // (Ally heals show on their own screen when their state propagates.)
  try { _detectHealsAndFire(); } catch (e) {}
  // v4: Auto-collapse header during active unresolved event on my turn — maximizes
  // action-pane space for minigames. Restored when event resolved or not mine.
  try {
    var _topbar = document.querySelector('.topbar');
    var _phaseBanner = document.querySelector('.phase-banner');
    var _hideHdr = G.activeEvent
      && G.activeEvent.cls === MY_CLASS
      && !G.activeEvent.resolved;
    if (_topbar) _topbar.classList.toggle('hidden-on-scroll', !!_hideHdr);
    if (_phaseBanner) _phaseBanner.classList.toggle('hidden-on-scroll', !!_hideHdr);
  } catch (e) {}
  if (G.phase !== 'land') _landingRollSent = false;
  if (!G.activeEvent) _burstFiredFor = null;
  // v0.15.46: when activeEvent clears, drop snapshots + drained-token state
  // + card-fading state. Server state is now authoritative.
  if (!G.activeEvent) {
    _resolutionSnapshots = {};
    _drainedTokens = {};
    _cardFading = {};
    _cardEntered = {};
    _cardFlavors = {};
  }
  renderPhaseBanner(me);
  // restoreActiveEvent MUST run AFTER renderDashboard. The active-event host
  // element #landing-result is created BY renderDashboard as part of
  // _dashTopSlot's HTML output (~line 1581). If restoreActiveEvent runs
  // first, document.getElementById returns null and the event card silently
  // fails to render. (v0.15.44 attempted reorder, broke event rendering,
  // reverted in v0.15.45. v0.15.46 solves the flash via snapshot model
  // instead, leaving render order intact.)
  renderDashboard(me);
  // v0.16.4: chipPulse fires AFTER renderDashboard so chip elements exist at
  // fresh positions. Previous order (pulse before dashboard render) meant
  // _findGoldChipDest etc. queried stale-or-detached chip elements with
  // potentially zero rects — chipPulse would render at viewport (0,0) or
  // mid-screen instead of on the actual chip. _prevRenderInv is still
  // captured at end of render, so the diff detection still works correctly.
  _detectInvIncreasesAndPulse(me);
  // v0.16.8: renderParty()/renderFusion() removed from render flow — pane-party
  // and pane-fusion no longer exist. Their content surfaces via hold-gestures
  // in the dynamic zone (v0.16.9+). The functions themselves remain for now
  // (stub-like, early-return on missing pane) until v0.16.9 stripping pass.
  restoreActiveEvent();
  // Start riddle timer tick if active, stop if not
  if (G.activeEvent && G.activeEvent.riddleActive && !_riddleTimerInterval) {
    _riddleTimerInterval = setInterval(_tickRiddleTimer, 500);
  } else if ((!G.activeEvent || !G.activeEvent.riddleActive) && _riddleTimerInterval) {
    clearInterval(_riddleTimerInterval); _riddleTimerInterval = null;
  }
  // v4: Red Trial timer tick for join/active countdown
  if (G.activeEvent && G.activeEvent.redVariant === 'trial_of_hand' && (G.activeEvent.redPhase === 'joining' || G.activeEvent.redPhase === 'active')) {
    if (!window._redTrialTimer) {
      window._redTrialTimer = setInterval(function() {
        if (!G.activeEvent || G.activeEvent.redVariant !== 'trial_of_hand') { clearInterval(window._redTrialTimer); window._redTrialTimer = null; return; }
        if (G.activeEvent.redPhase !== 'joining' && G.activeEvent.redPhase !== 'active') { clearInterval(window._redTrialTimer); window._redTrialTimer = null; return; }
        restoreActiveEvent();
      }, 1000);
    }
  } else if (window._redTrialTimer) {
    clearInterval(window._redTrialTimer); window._redTrialTimer = null;
  }
  // v0.15.46 — record this frame's inventory for next render's snapshot
  // detection. Must run AFTER all per-frame work so it captures the
  // post-render state.
  _recordRenderInv(me);
}

// updateGrayResult removed — gray result shown via restoreActiveEvent/showLandingResult

function restoreActiveEvent() {
  if (!G || !G.activeEvent) { return; }
  // v0.15.39: if the player has tapped Collect on this event's resolution,
  // collapse the entire active-event panel — not just the resolution card.
  // No leftover event-card visual evidence after Collect; the inventory
  // animation and updated counts are the only feedback. Re-renders won't
  // restore the panel until the activeEvent key changes (new event = new
  // signature = no entry in _collectedResolutions).
  var collectKey = _activeEventCollectKey();
  if (collectKey && _collectedResolutions[collectKey]) {
    var hostEl = document.getElementById('landing-result');
    if (hostEl) hostEl.innerHTML = '';
    return;
  }
  // If this is a monster event and we have a pending rumble battle for this player,
  // the rumble card handles the display instead. Skip the generic landing-result card.
  if (G.activeEvent.evType === 'monster' && G.pendingRumbleBattle && G.pendingRumbleBattle.cls === MY_CLASS) { return; }
  // Also skip during an active rumble battle — rumble card shows the state.
  if (G.rumbleBattle && G.rumbleBattle.cls === MY_CLASS) { return; }
  var isRiddleEvent = G.activeEvent.evType === 'riddle';
  var isRedTrialEvent = G.activeEvent.redVariant === 'trial_of_hand';
  if (!isRiddleEvent && !isRedTrialEvent && G.activeEvent.cls !== MY_CLASS) { return; }
  // Allow re-render even if resolved:true, as long as there's a result to show
  if (G.activeEvent.resolved
      && !G.activeEvent.blueResult && !G.activeEvent.trapResult && !G.activeEvent.goldResult
      && !G.activeEvent.goldVariant && !G.activeEvent.riddleActive && !G.activeEvent.riddleWinner
      && !G.activeEvent.riddleExpired && !G.activeEvent.grayRubbleResult
      && !G.activeEvent.redResult && !G.activeEvent.purpleResult && !G.activeEvent.whiteResult
      && !G.activeEvent.blackResult && !G.activeEvent.greenResult) { return; }
  var ev = G.activeEvent;
  var el = document.getElementById('landing-result');
  if (!el) { return; }

  // v4: No early-return on cached content — always re-render. Previously a guard checked
  // el.innerHTML.includes('roll-display') which short-circuited gray/red/purple/white/black/green
  // events that need continuous re-renders for phase changes, timers, and result screens.

  var evData = null;
  if (ev.forced) {
    var icons = {gray:'<span style="width:12px;height:12px;border-radius:2px;background:#AAAAAA;display:inline-block;vertical-align:middle;"></span>',blue:'<span style="width:12px;height:12px;border-radius:2px;background:#006DB7;display:inline-block;vertical-align:middle;"></span>',white:'<span style="width:12px;height:12px;border-radius:2px;background:#EFEFEF;border:1px solid #ccc;display:inline-block;vertical-align:middle;"></span>',gold:'🪙',monster:'👺',boss:'💀',trap:'<span style="width:12px;height:12px;border-radius:2px;background:#F57C00;display:inline-block;vertical-align:middle;"></span>',doubletrap:'<span style="width:12px;height:12px;border-radius:2px;background:#F57C00;display:inline-block;vertical-align:middle;"></span>',riddle:'<span style="width:12px;height:12px;border-radius:2px;background:#F5D000;display:inline-block;vertical-align:middle;"></span>',purple:'<span style="width:12px;height:12px;border-radius:2px;background:#7B2FBE;display:inline-block;vertical-align:middle;"></span>',green:'<span style="width:12px;height:12px;border-radius:2px;background:#237841;display:inline-block;vertical-align:middle;"></span>',red:'<span style="width:12px;height:12px;border-radius:2px;background:#D01012;display:inline-block;vertical-align:middle;"></span>',black:'<span style="width:12px;height:12px;border-radius:2px;background:#1a1a1a;display:inline-block;vertical-align:middle;"></span>'};
    var names = {gray:'Rubble Stacking',blue:'Arcane Shrine',white:"Pilgrim's Rest",gold:'Found Gold',monster:'Monster!',boss:'BOSS',trap:'Trap!',doubletrap:'Double Trap!',riddle:'Clue Found!',purple:'Fated Choice',green:'Vine Path',red:'Trial of the Hand',black:'Shadow Bargain'};
    var descs = {gray:'Fallen stones — stack 3 blocks into the outline.',blue:'A magical residue crystallized into brick form.',white:'A shrine. Heal yourself or an ally.',gold:'Coins on the ground.',monster:'A monster leaps out!',boss:'The boss awakens!',trap:'A hidden pressure plate!',doubletrap:'Two pressure plates — double damage!',riddle:'A yellow brick with a card beneath it.',purple:'Two sealed chests. One blesses, one curses.',green:'Three vines ripple across the path.',red:'The stone circle tests those who pass.',black:'A cloaked figure extends a pact.'};
    evData = {
      type: ev.evType,
      color: ev.brickColor || ev.evType,
      icon: icons[ev.evType] || '⚡',
      name: names[ev.evType] || ev.evType,
      desc: descs[ev.evType] || 'DM forced this event',
      amount: ev.goldAmount,
      mids: ev.mids || []
    };
  } else {
    var table = LANDING_EVENTS[ev.zone+1]||LANDING_EVENTS[1];
    evData = table ? table[ev.roll-1] : null;
  }
  if (evData) {
    showLandingResult(evData, ev.forced ? 'DM' : ev.roll, ev.zone);
    var burstKey = (ev.cls||'') + '|' + (ev.roll||'') + '|' + (ev.evType||'');
    if (_burstFiredFor !== burstKey) {
      _burstFiredFor = burstKey;
      burstParticles(evData.type || 'nothing');
    }
  } else {
  }
}

// ── PHASE BANNER (REMOVED v0.16.9) ──
// The phase-banner element is gone in v0.16.9. Player-turn signaling now
// lives on the dynamic zone via the .my-turn class (intense border + pulse
// animation, set by _dashDynamicZone based on turn check). Other phase
// states (waiting, battle, trade) surface as flavor text in the dynamic
// zone or as content cards (rumble card, trade modal, etc.).
// renderPhaseBanner kept as no-op so existing call sites don't break;
// future cleanup can remove the calls.
function renderPhaseBanner(me) {
  // No-op: phase banner element removed in v0.16.9.
}

// ═══════════════════════════════════════════
//  STATUS TAB
// ═══════════════════════════════════════════
function toggleStatusCard(id) {
  _statusOpen[id] = !_statusOpen[id];
  var body = document.getElementById(id+'-body');
  var arrow = document.getElementById(id+'-arrow');
  if (body) body.style.display = _statusOpen[id] ? 'block' : 'none';
  if (arrow) arrow.textContent = _statusOpen[id] ? '▼' : '▶';
}

function collapsibleCard(id, titleHtml, bodyHtml, startOpen) {
  var open = _statusOpen[id] !== undefined ? _statusOpen[id] : (startOpen || false);
  _statusOpen[id] = open;
  return '<div class="card" style="padding:0;overflow:hidden;">'
    + '<div onclick="toggleStatusCard(\'' + id + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;user-select:none;">'
    + '<div style="display:flex;align-items:center;gap:6px;">' + titleHtml + ' <span id="' + id + '-arrow" style="font-size:11px;color:#777;">' + (open ? '▼' : '▶') + '</span></div>'
    + '</div>'
    + '<div id="' + id + '-body" style="display:' + (open?'block':'none') + ';padding:0 14px 12px;border-top:1px solid #1a1a1a;">'
    + bodyHtml
    + '</div>'
    + '</div>';
}

// ═══════════════════════════════════════════
//  DASHBOARD (doc §7, 0.14.0 item 3/7)
// ═══════════════════════════════════════════
// Main play surface. Replaces old Status + Actions tabs. Lives in pane-dashboard.
//
// Structure (top-down):
//   _dashHeader        — class/HP/armor/resource chips + status badges
//   _dashBrickBar      — horizontal chip row, rumble-style (icon + embedded pips)
//   _dashPhaseContext  — prepare/move/land/rumble cards when phase applies
//   _dashActions       — SELF / ALLY (brick-action target) / CLASS / BOARD
//   renderStatusClues  — existing clue panel
//   renderKOPanel      — replaces everything if hp=0
//
// Hold-to-charge brick-action tier menus are item 6/7. Current buttons are
// tap-only (tier-1 action). The UI scaffolding here is designed so each action
// button can be upgraded to tap+hold without restructuring.
//
// Class signature/secondary tables live in characters.js (Phase 2 consolidation).
// Access via getSignature(cls) / getSecondary(cls) helpers.

// ── HEADER (v0.16.10 redesign) ──
// Horizontal-split card: identity (avatar + class name + zone + conn-dot
// + coin + cheese chips) on the left, HP big number + bar + shield on
// the right. Coin and cheese chips moved here from the interaction row
// (which was previously two-layer; now bricks-only). Fills the empty
// space below the name/zone block in the identity column.
//
// Conn-dot reads from global _connState (set by setConn() in players.html
// or test_players.html connect handlers).
function _dashHeader(me) {
  const isOH = me.hp > me.hpMax;
  const pct = Math.min(100, Math.max(0, Math.round(me.hp / me.hpMax * 100)));
  const hc  = isOH ? '#b06fef'
    : me.hp <= Math.floor(me.hpMax * 0.25) ? '#E24B4A'
    : me.hp <= Math.floor(me.hpMax * 0.5)  ? '#EF9F27'
    : getComputedStyle(document.documentElement).getPropertyValue('--cls-color').trim();
  const hpBg = isOH ? 'linear-gradient(90deg,#7B2FBE,#b06fef)' : hc;
  const hpShadow = isOH ? 'box-shadow:0 0 6px #b06fef88;' : '';
  const space = SPACES[me.space];
  const meta = PLAYER_META[MY_CLASS] || {};
  const className = meta.name || MY_CLASS;
  const classIcon = meta.icon || '◆';
  const connClass = (typeof _connState !== 'undefined' && _connState) ? 'on' : 'off';
  const goldVal = _displayed(me, 'gold');
  const cheeseVal = _displayed(me, 'cheese');

  const statuses = (me.statusEffects || []).map(s => `<span class="status-badge ${s}">${s}</span>`).join('');
  const debuff = G.movementDebuffs?.[MY_CLASS];
  const debuffBadge = debuff ? `<span class="status-badge poisoned">🐌 −${debuff} Move</span>` : '';

  const shieldMax = me.hpMax;
  let shieldPips = '';
  for (let i = 0; i < shieldMax; i++) {
    const filled = i < (me.armor || 0);
    const pipW = Math.max(10, Math.min(22, Math.floor(260 / shieldMax)));
    shieldPips += `<span style="display:inline-block;width:${pipW}px;height:14px;border-radius:3px;margin:1px;`
      + (filled ? 'background:#AAAAAA;box-shadow:0 1px 3px rgba(0,0,0,.5);' : 'background:#1a1a1a;border:1px solid #2a2a2a;')
      + '"></span>';
  }

  const myKeys = Object.entries(G.magicKeys || {}).filter(([, cls]) => cls === MY_CLASS).map(([c]) => c);

  return `<div class="head-card">
    <div class="head-id">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="head-icon">${classIcon}</div>
        <div style="flex:1;">
          <div class="head-name">${className}<span class="conn-dot ${connClass}" id="conn-dot" title="Connection status"></span></div>
          <div class="head-zone">${space?.label || 'Start'}</div>
        </div>
      </div>
      <div class="head-resources">
        <div class="res-chip" data-res="gold" data-zone-trigger="market" title="Hold to open market">
          <span class="res-chip-glyph">🪙</span>
          <span class="res-chip-num stat-num">${goldVal}</span>
        </div>
        <div class="res-chip" data-res="cheese" data-zone-trigger="cheese" title="Hold to open cheese options">
          <span class="res-chip-glyph">🧀</span>
          <span class="res-chip-num stat-num">${cheeseVal}</span>
        </div>
      </div>
    </div>
    <div class="head-stats">
      <div class="hp-row">
        <span class="hp-big" style="color:${hc};">${me.hp}</span>
        <span class="hp-max">/ ${me.hpMax} HP</span>
      </div>
      <div class="hpbar-outer" id="my-hp-bar">
        <div class="hpbar-inner" style="width:${pct}%;background:${hpBg};${hpShadow}"></div>
      </div>
      <div style="position:relative;" id="my-shield-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.06em;color:#888;">🛡 SHIELD</span>
          <span style="font-family:Cinzel,serif;font-size:14px;font-weight:700;color:${(me.armor||0)>0?'#AAAAAA':'#333'};">${me.armor||0}<span style="font-size:10px;color:#555;"> / ${shieldMax}</span></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;" id="my-shield-pips">${shieldPips}</div>
      </div>
      ${(statuses || debuffBadge) ? `<div class="status-wrap" style="margin-top:4px;">${statuses}${debuffBadge}</div>` : ''}
      ${(me.queuedPoisonStacks || 0) > 0 ? `<div style="margin-top:4px;padding:6px 8px;background:#1a2a10;border:1px solid #4a7a2a;border-radius:6px;">
        <span style="font-size:11px;color:#bada7a;font-family:Cinzel,serif;letter-spacing:.04em;">☠ POISON QUEUED: ${me.queuedPoisonStacks} stack${me.queuedPoisonStacks!==1?'s':''} (${me.queuedPoisonBattles||1} battle${(me.queuedPoisonBattles||1)!==1?'s':''})</span>
      </div>` : ''}
      ${(me.nextRumbleBuff && me.nextRumbleBuff.refreshBoost) ? `<div style="margin-top:4px;padding:6px 8px;background:#0a1a2a;border:1px solid #4d8abf;border-radius:6px;">
        <span style="font-size:11px;color:#4db8ff;font-family:Cinzel,serif;letter-spacing:.04em;">⚡ FORMWRIGHT CHARGE: 2× brick refresh for first ${Math.round((me.nextRumbleBuff.refreshBoost.durationMs||10000)/1000)}s of next rumble</span>
      </div>` : ''}
      ${myKeys.length ? `<div style="font-size:12px;color:var(--yellow);margin-top:4px;">🗝 Keys: ${myKeys.join(', ')}</div>` : ''}
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────
// HOLD-TO-CHARGE GESTURE — bones (per doc §1.3)
// ─────────────────────────────────────────────────────────────────
// State machine for the chip hold gesture:
//   - Tap (release in <250ms, no drag) → fires existing tier-1 action
//   - Hold (≥250ms) → enters tier mode, charging ring animates around chip
//   - Tier increments every 500ms (1 → 2 → 3 → 4), capped at charged count
//   - White at tier ≥2: ally icons fan radially around the chip
//   - Drag onto an ally icon → that icon highlights as target
//   - Release on chip = self action at reached tier
//   - Release on ally icon = ally action at reached tier
//   - Release elsewhere = cancel
//
// Tier-specific scaling (heal amounts, cleanse counts, party-wide effects)
// is NOT implemented in this patch — bones first, content lands when
// per-class abilities are designed (0.16+).
//
// Other colors stay tap-only for this patch. Hold ignored on non-white.

const HOLD_TAP_THRESHOLD_MS = 250;     // < this = tap, ≥ this = hold
const HOLD_TIER_INTERVAL_MS = 1000;    // ms per overload step (one full second per tier-up)
const HOLD_DRAG_THRESHOLD_PX = 15;     // px movement before drag mode

// All colors support hold-radial as of 0.14.0 framework. White uses the
// ally-target radial (shipped earlier); other colors use the generic
// option-radial whose content fills in with class actions in v0.15/0.16.
const HOLD_RADIAL_COLORS = ['red','gray','green','blue','purple','white','yellow','orange','black'];

// Per-color placeholder options for the generic option-radial. These are
// labels only — real actions wire in with v0.15/0.16 class identity.
// Two options per color is enough to validate layout + routing without
// committing to specific class behaviors.
const _GENERIC_RADIAL_OPTIONS = {
  red:    [{ label:'Strike', icon:'⚔' }, { label:'Cleave', icon:'⚒' }],
  gray:   [{ label:'Brace',  icon:'◆' }, { label:'Wall',   icon:'▣' }],
  blue:   [{ label:'Bolt',   icon:'◊' }, { label:'Pierce', icon:'⟢' }],
  purple: [{ label:'Burst',  icon:'✦' }, { label:'Drain',  icon:'⌬' }],
  green:  [{ label:'Bloom',  icon:'❀' }, { label:'Wilt',   icon:'☘' }],
  orange: [{ label:'Trap',   icon:'⌖' }, { label:'Snare',  icon:'⟆' }],
  yellow: [{ label:'Daze',   icon:'★' }, { label:'Mark',   icon:'※' }],
  black:  [{ label:'Curse',  icon:'☓' }, { label:'Hex',    icon:'⛧' }],
};

let _holdState = null;
let _holdTicker = null;

function _holdStart(e, color, chipEl) {
  console.log('[HOLD] _holdStart fired', { color, pointerId: e.pointerId, time: Date.now() });
  e.preventDefault();
  e.stopPropagation();
  if (_holdState) _holdEnd(true); // cancel any leftover

  const me = G.players[MY_CLASS];
  const charged = (me?.bricksCharged?.[color]) || 0;
  console.log('[HOLD] charges available:', charged);
  if (charged < 1) {
    console.log('[HOLD] aborted: no charges');
    return;
  }

  const rect = chipEl.getBoundingClientRect();

  // Fan direction: always horizontal. Chip on right half of viewport → fan
  // opens leftward (π). Chip on left half → fan opens rightward (0).
  // Predictable and avoids vertical clipping at top/bottom edges.
  const vw = window.innerWidth;
  const chipCx = rect.left + rect.width / 2;
  const chipCy = rect.top + rect.height / 2;
  const fanCenterAngle = (chipCx > vw / 2) ? Math.PI : 0;

  _holdState = {
    color,
    chipEl,
    chipRect: rect,
    chipCx,
    chipCy,
    fanCenterAngle,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startTime: performance.now(),
    tier: 1,
    maxCharges: charged,
    isDrag: false,
    dragX: e.clientX,
    dragY: e.clientY,
    dragTarget: null,        // class id of ally currently hovered
    cancelled: false,
    holdMode: false,         // true once HOLD_TAP_THRESHOLD_MS passed
    lastTierUpTime: 0,       // performance.now() timestamp of most recent tier increment
  };

  document.addEventListener('pointermove', _holdMove);
  document.addEventListener('pointerup', _holdUp);
  document.addEventListener('pointercancel', _holdUp);

  // RAF loop is the single source of truth — derives tier from elapsed time,
  // detects tier-up boundaries, and re-renders. No discrete ticker; arc fills
  // smoothly because tier is recomputed every frame from continuous time.
  function frame() {
    if (!_holdState) return;
    _holdUpdateTier();
    _renderHoldOverlay();
    _holdState.rafId = requestAnimationFrame(frame);
  }
  _holdState.rafId = requestAnimationFrame(frame);

  // Initial overlay render so the gesture state appears immediately
  _renderHoldOverlay();
}

// Derive current tier from elapsed hold time. Detects tier-up boundary
// crossings to trigger pulse animation. Called every frame during hold.
function _holdUpdateTier() {
  const s = _holdState;
  if (!s) return;
  const elapsed = performance.now() - s.startTime;
  if (elapsed < HOLD_TAP_THRESHOLD_MS) {
    s.tier = 1;
    s.holdMode = false;
    return;
  }
  // First frame entering hold mode → fire pulse for tier 1 (the gesture
  // just confirmed as a hold rather than a tap). This is the "you're now
  // overloading" signal even before the arc starts climbing.
  if (!s.holdMode) {
    s.lastTierUpTime = performance.now();
    s.lastTierUpValue = 1;
  }
  s.holdMode = true;
  // Tier progression is inventory-driven. With N charges you can reach tier N.
  // Arc fills smoothly across ALL N-1 overload steps. Pulse visuals cap at
  // tier 7 (handled in the pulse renderer); tier values themselves uncapped.
  const overloadSteps = Math.max(0, s.maxCharges - 1);
  if (overloadSteps <= 0) {
    s.tier = 1;
    return;
  }
  const overloadElapsed = elapsed - HOLD_TAP_THRESHOLD_MS;
  const totalDuration = overloadSteps * HOLD_TIER_INTERVAL_MS;
  const arcFill = Math.min(1, overloadElapsed / totalDuration);
  const newTier = 1 + Math.floor(arcFill * overloadSteps);
  // Cap tier at player's charge ceiling (== maxCharges, == 1 + overloadSteps)
  s.tier = Math.min(newTier, s.maxCharges);
  s.arcFill = arcFill;
  // Detect tier-up boundary: integer tier increased since last frame
  if (s.tier > (s.lastTier || 1)) {
    s.lastTierUpTime = performance.now();
    s.lastTierUpValue = s.tier;  // which tier we just celebrated (for pulse scaling)
  }
  s.lastTier = s.tier;
}

function _holdMove(e) {
  if (!_holdState) return;
  if (e.pointerId !== _holdState.pointerId) return;
  _holdState.dragX = e.clientX;
  _holdState.dragY = e.clientY;
  const moved = Math.hypot(e.clientX - _holdState.startX, e.clientY - _holdState.startY);
  if (moved > HOLD_DRAG_THRESHOLD_PX) {
    _holdState.isDrag = true;
  }
  // Drag-target detection — find ally icon OR option icon under cursor.
  // White uses ally targets; other colors use option targets. dragTarget
  // holds the matched id; _holdUp routes by which kind was hit.
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const allyIcon = el ? el.closest('[data-ally-target]') : null;
  const optIcon  = el ? el.closest('[data-option-target]') : null;
  _holdState.dragTarget = allyIcon
    ? allyIcon.getAttribute('data-ally-target')
    : (optIcon ? optIcon.getAttribute('data-option-target') : null);
  _renderHoldOverlay();
}

function _holdUp(e) {
  if (!_holdState) return;
  if (e.pointerId !== _holdState.pointerId) return;
  const s = _holdState;
  const heldMs = performance.now() - s.startTime;
  const isTap = heldMs < HOLD_TAP_THRESHOLD_MS && !s.isDrag;

  // Determine release target: chip itself, ally icon, option icon, or off-target
  const releaseEl = document.elementFromPoint(e.clientX, e.clientY);
  const onChip = releaseEl ? releaseEl.closest('[data-brick-chip]') : null;
  const onAlly = releaseEl ? releaseEl.closest('[data-ally-target]') : null;
  const onOption = releaseEl ? releaseEl.closest('[data-option-target]') : null;
  const releasedOnOwnChip = onChip && onChip.getAttribute('data-brick-chip') === s.color;

  // Capture target locations BEFORE _holdEnd destroys state.
  let allyIconRect = null;
  let allyTargetCls = null;
  if (onAlly) {
    allyIconRect = onAlly.getBoundingClientRect();
    allyTargetCls = onAlly.getAttribute('data-ally-target');
  }
  let optionIconRect = null;
  let optionLabel = null;
  if (onOption) {
    optionIconRect = onOption.getBoundingClientRect();
    optionLabel = onOption.getAttribute('data-option-target');
  }

  if (isTap) {
    // Plain tap — fire existing tier-1 baseline action, instant overlay clear
    _holdEnd(false);
    _fireTierAction(s.color, 1, null);
    return;
  }

  // Hold release routing
  if (onAlly) {
    // Ally heal — keep overlay alive for spotlight, fire action + ack, then cleanup
    _holdEnd(false, true);                              // skip immediate clear
    _fireTierAction(s.color, s.tier, allyTargetCls);
    if (allyIconRect) BoardFx.fire('casterAck', allyIconRect);
    _spotlightCleanup('[data-ally-target="' + allyTargetCls + '"]');
  } else if (onOption) {
    // Option fired — symmetric with ally path. Spotlight on the option, fire
    // tiered action with the option label as a routing key. Real per-class
    // behaviors land in v0.15/0.16; for now this toasts via _fireTierAction.
    _holdEnd(false, true);
    _fireTierAction(s.color, s.tier, optionLabel);
    if (optionIconRect) BoardFx.fire('casterAck', optionIconRect);
    _spotlightCleanup('[data-option-target="' + optionLabel + '"]');
  } else if (releasedOnOwnChip) {
    // Self heal — keep overlay alive briefly, fade everything together
    _holdEnd(false, true);                              // skip immediate clear
    _fireTierAction(s.color, s.tier, null);
    _spotlightCleanup(null);                            // no target = full fade
  } else {
    // Released off-target → silent cancel, instant clear
    _holdEnd(true);
  }
}

// Caster acknowledgment flash — brief white ring at the position an
// ally icon was when drag-released. v0.15.31: migrated to boardFx as
// the 'casterAck' preset. Call sites use BoardFx.fire('casterAck', rect)
// directly — the rect (captured at drag-release time, since the icon
// may dismount before fire) is passed straight to the preset's anchor.

// Spotlight cleanup — reusable mechanic for clean post-cast overlay tear-down.
//
// When a board action fires on a target (ally icon, future per-class targets),
// we want everything EXCEPT the target to fade away first, leaving the target
// briefly visible during the heal/effect animation, then the target fades too.
//
// Reads as: "this is what your action lands on" → action plays out → done.
//
// Args:
//   targetSelector — CSS selector matching the spotlight element inside the
//                    overlay (e.g. '[data-ally-target="snapstep"]'). Null
//                    means no spotlight — all elements fade together.
//   hangMs         — how long the target stays solo before fading (1000)
//   fadeMs         — how long the target's own fade-out takes (400)
//
// Non-target fade is 250ms (snappy). Total cleanup: 250 + hangMs + fadeMs.
function _spotlightCleanup(targetSelector, hangMs, fadeMs) {
  const NON_TARGET_FADE = 250;
  hangMs = hangMs == null ? 1000 : hangMs;
  fadeMs = fadeMs == null ? 400 : fadeMs;

  const overlay = document.getElementById('hold-overlay');
  if (!overlay) return;

  // Target element (if any) stays solid through the spotlight period
  const target = targetSelector ? overlay.querySelector(targetSelector) : null;

  // Fade every direct overlay child EXCEPT the target's parent chain
  Array.from(overlay.children).forEach(child => {
    if (target && child.contains(target)) return;  // skip target's container
    child.style.transition = `opacity ${NON_TARGET_FADE}ms ease-out`;
    child.style.opacity = '0';
  });

  // If we have a target, fade non-targets but keep target visible.
  // After hangMs, fade the target. After fadeMs more, clear overlay.
  if (target) {
    setTimeout(() => {
      // Fade the target's container (not just the icon — could be a wrapper SVG)
      let toFade = target;
      // Walk up to the direct overlay child that contains the target
      while (toFade.parentNode && toFade.parentNode !== overlay) {
        toFade = toFade.parentNode;
      }
      if (toFade && toFade !== overlay) {
        toFade.style.transition = `opacity ${fadeMs}ms ease-out, transform ${fadeMs}ms ease-out`;
        toFade.style.opacity = '0';
        toFade.style.transform = 'scale(0.92)';
      }
      setTimeout(() => _clearHoldOverlay(), fadeMs + 50);
    }, NON_TARGET_FADE + hangMs);
  } else {
    // No target — wipe overlay after non-target fade completes
    setTimeout(() => _clearHoldOverlay(), NON_TARGET_FADE + 50);
  }
}

function _holdEnd(cancelled, skipClearOverlay) {
  if (_holdTicker) { clearInterval(_holdTicker); _holdTicker = null; }
  if (_holdState && _holdState.rafId) { cancelAnimationFrame(_holdState.rafId); }
  document.removeEventListener('pointermove', _holdMove);
  document.removeEventListener('pointerup', _holdUp);
  document.removeEventListener('pointercancel', _holdUp);
  if (_holdState) _holdState.cancelled = cancelled;
  _holdState = null;
  if (!skipClearOverlay) _clearHoldOverlay();
}

// Fire an action with tier and optional target. For tier > 1, currently
// just calls existing tier-1 endpoint. Real tier scaling (extra charge
// burn, scaled output, multi-target effects) lands when per-ability
// content is designed in 0.16+. The gesture mechanic ships now; the
// payoff math waits for real ability design.
function _fireTierAction(color, tier, target) {
  // S015 DIAGNOSTIC: trace white tap path for full-HP toast investigation
  console.log('[DIAG _fireTierAction]', { color: color, tier: tier, target: target });
  // White actions — target is an ally class id (or null for self)
  if (color === 'white') {
    if (target === null) {
      console.log('[DIAG] white self-heal → client.healPlayer(' + MY_CLASS + ')');
      // Self heal — single-arg call (source defaults to target)
      client.healPlayer(MY_CLASS);
    } else {
      console.log('[DIAG] white ally-heal → client.healPlayer(' + target + ', ' + MY_CLASS + ')');
      // Ally heal — pass MY_CLASS as source (I pay), target as target class
      client.healPlayer(target, MY_CLASS);
    }
    if (tier > 1) {
      toast('Tier ' + tier + ' release — scaling lands with class abilities', 'info');
    }
    return;
  }
  // Gray = brace (existing tier-1 only)
  if (color === 'gray' && tier === 1 && !target) {
    client.addShield(MY_CLASS);
    return;
  }
  // Other colors with option-radial release. target is an option label
  // (e.g. "Strike", "Cleave") — actual class behavior wires in v0.15/0.16.
  if (target) {
    toast(target + ' (' + color + ' tier ' + tier + ') — class behavior in v0.15/0.16', 'info');
    return;
  }
  // Fallback — tap-only baseline for now
  if (tier === 1) {
    toast('Tap action for ' + color + ' — coming with class abilities', 'info');
  } else {
    toast(color + ' tier ' + tier + ' — abilities land in 0.16', 'info');
  }
}

// ── HOLD OVERLAY RENDERER ─────────────────────────────────────────
// Draws the charging ring, tier indicator, and ally radial fan during
// an active hold. Positioned absolutely over the dashboard.
function _renderHoldOverlay() {
  let overlay = document.getElementById('hold-overlay');
  if (!_holdState) { _clearHoldOverlay(); return; }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hold-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;'
      + 'pointer-events:none;z-index:1000;'
      + 'opacity:0;transition:opacity 250ms ease-out;';
    document.body.appendChild(overlay);
  }

  const s = _holdState;
  const elapsed = performance.now() - s.startTime;
  const inHoldMode = elapsed >= HOLD_TAP_THRESHOLD_MS;

  // Fade in once hold-mode confirms; stay invisible during tap-threshold window.
  // Spotlight cleanup on exit manages its own opacity (and resets to 0 isn't
  // needed since each new _holdState fires this branch fresh).
  overlay.style.opacity = inHoldMode ? '1' : '0';

  // Diagnostic panel — always visible during hold so we can see what's
  // happening in the gesture state machine. REMOVE this block once the
  // gesture is verified working in the field.
  let html = `<div style="position:absolute;top:8px;right:8px;background:#0a0a0a;
    border:1px solid #444;padding:6px 8px;border-radius:6px;
    font-family:ui-monospace,monospace;font-size:10px;color:#0f0;
    pointer-events:none;line-height:1.4;max-width:240px;">
    <div style="color:#ff0;font-weight:bold;">HOLD DEBUG</div>
    color: ${s.color}<br>
    elapsed: ${Math.round(elapsed)}ms<br>
    threshold: ${HOLD_TAP_THRESHOLD_MS}ms<br>
    inHoldMode: ${inHoldMode}<br>
    tier: ${s.tier} / max ${s.maxCharges}<br>
    isDrag: ${s.isDrag}<br>
    dragTarget: ${s.dragTarget || 'none'}<br>
    chipCx,Cy: ${Math.round(s.chipCx)},${Math.round(s.chipCy)}
  </div>`;

  // Charging visuals — only after hold threshold
  if (inHoldMode) {
    const tierColor = BRICK_COLORS[s.color] || '#fff';

    // Subtle chip ring — shows the gesture is active, no tier info embedded
    const ringSize = 64;
    const ringX = s.chipCx - ringSize / 2;
    const ringY = s.chipCy - ringSize / 2;
    html += `<div style="position:absolute;left:${ringX}px;top:${ringY}px;width:${ringSize}px;height:${ringSize}px;
      border:2px solid ${tierColor}88;border-radius:50%;
      box-shadow:0 0 12px ${tierColor}66;pointer-events:none;"></div>`;
  }

  // Heal preview number — raw amount the formula produces at the current tier.
  // Uses the canonical computeHeal from characters.js (same source rumble fires).
  // Shows what the cast WOULD produce, not what gets applied (no clamping to
  // target HP) — gives stable, learnable read of formula output as tier climbs.
  // Position: same side as the fan/arc (reads as a unit with the power arc).
  if (inHoldMode && s.color === 'white') {
    const me = G.players[MY_CLASS];
    const ownedW = (me && me.bricks && me.bricks.white) || 0;
    const previewAmt = computeHeal(MY_CLASS, 'white', ownedW, s.tier);
    // Same side as fan: fan opens left (π) → number on left; opens right (0) → number on right
    // Offset clears the arc (radius ~140) plus a small gap. Tight enough to fit on mobile.
    const fanOpensLeft = (s.fanCenterAngle === Math.PI);
    let previewX = fanOpensLeft ? (s.chipCx - 210) : (s.chipCx + 140);
    // Clamp to viewport so the number never clips on narrow screens
    const ESTIMATED_TEXT_W = 90;
    previewX = Math.max(8, Math.min(window.innerWidth - ESTIMATED_TEXT_W - 8, previewX));
    const previewY = s.chipCy - 24;
    const tColor = BRICK_COLORS[s.color] || '#fff';
    html += `<div style="position:absolute;left:${previewX}px;top:${previewY}px;
      font-family:Cinzel,serif;font-size:46px;font-weight:700;
      color:${tColor};text-shadow:0 0 14px ${tColor}cc, 0 2px 4px rgba(0,0,0,.8);
      letter-spacing:.02em;pointer-events:none;line-height:1;">+${previewAmt}</div>`;
  }

  // Radial fan — visible whenever in hold mode for radial-enabled colors.
  // White uses the ally-target radial (allies are heal targets). Other
  // colors use the generic option-radial (action options per color).
  // Both render the power arc + selection icons in the same layout space.
  if (inHoldMode && HOLD_RADIAL_COLORS.indexOf(s.color) >= 0) {
    if (s.color === 'white') {
      html += _renderAllyRadialFan(s);
    } else {
      html += _renderOptionRadialFan(s);
    }
  }

  // Drag line from chip to current pointer (visual feedback)
  if (s.isDrag && inHoldMode) {
    const dx = s.dragX - s.chipCx;
    const dy = s.dragY - s.chipCy;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const lineColor = BRICK_COLORS[s.color] || '#fff';
    html += `<div style="position:absolute;left:${s.chipCx}px;top:${s.chipCy}px;
      width:${len}px;height:2px;background:linear-gradient(90deg, ${lineColor}cc, ${lineColor}33);
      transform:rotate(${angle}deg);transform-origin:0 50%;
      pointer-events:none;border-radius:1px;"></div>`;
  }

  // Tier-up pulse — rendered LAST so it draws on top of the radial fan and
  // ally icons. Fires on every tier boundary crossing. Size + duration scale
  // with the tier being celebrated (capped at tier 7 — higher tiers use t7
  // values). Higher tier = bigger, longer-lasting pulse.
  if (inHoldMode) {
    const celebratedTier = Math.min(7, s.lastTierUpValue || 1);
    const PULSE_DURATION = 350 + 150 * celebratedTier;     // 500ms @ t1, 1400ms @ t7
    const pulseAge = performance.now() - (s.lastTierUpTime || 0);
    if (s.lastTierUpTime && pulseAge < PULSE_DURATION) {
      const tierColor = BRICK_COLORS[s.color] || '#fff';
      const progress = pulseAge / PULSE_DURATION;          // 0..1
      const startSize = 40 + 10 * celebratedTier;          // 50 @ t1, 110 @ t7
      const endSize   = 80 + 40 * celebratedTier;          // 120 @ t1, 360 @ t7
      const pulseSize = startSize + (endSize - startSize) * progress;
      const pulseAlpha = 1 - progress;                     // 1 → 0
      const borderWidth = Math.max(2, Math.round(2 + celebratedTier * 0.4));  // thicker at high tier
      const glowRadius = 18 + celebratedTier * 4;           // stronger glow at high tier
      const px = s.chipCx - pulseSize / 2;
      const py = s.chipCy - pulseSize / 2;
      html += `<div style="position:absolute;left:${px}px;top:${py}px;
        width:${pulseSize}px;height:${pulseSize}px;border-radius:50%;
        border:${borderWidth}px solid ${tierColor};opacity:${pulseAlpha.toFixed(2)};
        box-shadow:0 0 ${glowRadius}px ${tierColor}, inset 0 0 ${Math.round(glowRadius/2)}px ${tierColor}66;
        pointer-events:none;"></div>`;
    }
  }

  overlay.innerHTML = html;
}

function _clearHoldOverlay() {
  const overlay = document.getElementById('hold-overlay');
  if (overlay) overlay.remove();
}

// ── GENERIC OPTION RADIAL ──────────────────────────────────────────
// For colors other than white. Surfaces a list of action options. Layout
// grows from horizontal-direct → upward stack → full radial arc as N
// climbs. Drag-release on an option fires that tier with the option label.
//
// White uses _renderAllyRadialFan instead — different semantics (allies
// as targets, not options as actions).
function _renderOptionRadialFan(s) {
  const opts = _GENERIC_RADIAL_OPTIONS[s.color] || [];
  if (opts.length === 0) return '';

  const RADIUS = 80;
  const ICON_SIZE = 44;
  const ARC_RADIUS = RADIUS + 40;
  const tierColor = BRICK_COLORS[s.color] || '#fff';
  const arcFill = Math.max(0, Math.min(1, s.arcFill || 0));

  let html = '';

  // ── POWER ARC ─────────────────────────────────────────────
  // Same crown-arc pattern as ally radial, scaled to the same span so the
  // tier indicator reads identically across both radial flavors.
  const FAN_ARC_RAD = Math.PI;
  const center = s.fanCenterAngle;
  const svgSize = (ARC_RADIUS + 30) * 2;
  const svgX = s.chipCx - svgSize / 2;
  const svgY = s.chipCy - svgSize / 2;
  const arcStart = center - FAN_ARC_RAD / 2;
  const arcEnd   = center + FAN_ARC_RAD / 2;
  const arcFillEnd = arcStart + FAN_ARC_RAD * arcFill;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  function polar(r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  const [bgx1, bgy1] = polar(ARC_RADIUS, arcStart);
  const [bgx2, bgy2] = polar(ARC_RADIUS, arcEnd);
  const [fillx1, filly1] = polar(ARC_RADIUS, arcStart);
  const [fillx2, filly2] = polar(ARC_RADIUS, arcFillEnd);
  const fillArcLargeFlag = (FAN_ARC_RAD * arcFill) > Math.PI ? 1 : 0;
  const bgPath = `M ${bgx1.toFixed(2)} ${bgy1.toFixed(2)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${bgx2.toFixed(2)} ${bgy2.toFixed(2)}`;
  const fillPath = `M ${fillx1.toFixed(2)} ${filly1.toFixed(2)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${fillArcLargeFlag} 1 ${fillx2.toFixed(2)} ${filly2.toFixed(2)}`;
  const haloIntensity = 4 + 12 * arcFill;
  html += `<svg style="position:absolute;left:${svgX}px;top:${svgY}px;width:${svgSize}px;height:${svgSize}px;pointer-events:none;overflow:visible;">
    <path d="${bgPath}" stroke="${tierColor}33" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="${fillPath}" stroke="${tierColor}" stroke-width="6" fill="none" stroke-linecap="round"
      style="filter:drop-shadow(0 0 ${haloIntensity.toFixed(1)}px ${tierColor});"/>
  </svg>`;

  // ── OPTION ICONS ──────────────────────────────────────────
  // Layout angles per spec:
  //   N=1: [0]                     direct toward fanCenterAngle (horizontal)
  //   N=2: [0, -π/4]               first horizontal, second 45° up from it
  //   N=3: [0, -π/4, -π/2]         stacked upward by 45° steps
  //   N≥4: evenly distributed from 0 to -π (full upper half arc)
  // Negative angle offset = visually above on screen (canvas y inverted).
  const N = opts.length;
  function angleOffsetFor(idx) {
    if (N === 1) return 0;
    if (N === 2) return idx === 0 ? 0 : -Math.PI / 4;
    if (N === 3) return -idx * (Math.PI / 4);   // 0, -π/4, -π/2
    // N ≥ 4: even spread upward from 0 to -π
    return -idx * (Math.PI / (N - 1));
  }

  // The fan's "natural direction" — chip on left → fan opens right (angle 0);
  // chip on right → fan opens left (angle π). When mirrored to the right side,
  // the upward stack should also visually grow upward, which means flipping
  // the angle-offset's vertical component. The simple way: when mirrored,
  // angle = π + offset (which puts +offset BELOW on right side). Negate the
  // offset to keep "upward" consistent on both sides.
  const mirrored = (s.fanCenterAngle === Math.PI);
  opts.forEach((opt, i) => {
    let offset = angleOffsetFor(i);
    // Vertical flip on mirrored side keeps the stack growing UP on screen
    if (mirrored) offset = -offset;
    const angle = s.fanCenterAngle + offset;
    const ax = s.chipCx + Math.cos(angle) * RADIUS - ICON_SIZE / 2;
    const ay = s.chipCy + Math.sin(angle) * RADIUS - ICON_SIZE / 2;
    const isTarget = s.dragTarget === opt.label;
    const scale = isTarget ? 1.2 : 1.0;
    const ringGlow = isTarget
      ? `0 0 16px ${tierColor},0 0 24px #fff`
      : `0 2px 8px rgba(0,0,0,.5)`;
    html += `<div data-option-target="${opt.label}" style="position:absolute;left:${ax}px;top:${ay}px;
      width:${ICON_SIZE}px;height:${ICON_SIZE}px;pointer-events:auto;cursor:pointer;
      transform:scale(${scale});transition:transform .12s;">
      <div style="width:${ICON_SIZE}px;height:${ICON_SIZE}px;border-radius:50%;
        background:${tierColor};border:2px solid ${isTarget?'#fff':tierColor+'cc'};
        box-shadow:${ringGlow};
        display:flex;align-items:center;justify-content:center;
        font-size:20px;color:#000;text-shadow:0 1px 1px rgba(255,255,255,.4);">
        ${opt.icon}
      </div>
      <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);
        font-family:Cinzel,serif;font-size:9px;color:#fff;
        background:rgba(0,0,0,.7);padding:1px 6px;border-radius:3px;white-space:nowrap;
        letter-spacing:.06em;">
        ${opt.label}
      </div>
    </div>`;
  });

  return html;
}

function _renderAllyRadialFan(s) {
  // Fan ally icons radially around the chip, oriented by fanCenterAngle so
  // we open into the largest empty viewport quadrant. Power arc drawn at
  // larger radius OUTSIDE the icons, filling with tier progress — primary
  // tier indicator (distinct from rumble's vertical overload bar).
  const me = G.players[MY_CLASS];
  if (!me) return '';
  const myZone = (typeof SPACES !== 'undefined' && SPACES[me.space]) ? SPACES[me.space].zone : 0;
  const allies = Object.values(G.players || {}).filter(p => {
    if (p.cls === MY_CLASS) return false;
    if (p.hp <= 0) return false;
    const pz = (typeof SPACES !== 'undefined' && SPACES[p.space]) ? SPACES[p.space].zone : 0;
    return pz === myZone;
  });
  if (allies.length === 0) return '';

  const RADIUS = 80;
  const ICON_SIZE = 44;
  const ARC_RADIUS = RADIUS + 40;     // 40px beyond icon centers — room for HP labels
  const FAN_ARC_RAD = Math.PI; // 180° — full half-circle around the chip
  const center = s.fanCenterAngle;
  const tierColor = BRICK_COLORS[s.color] || '#fff';
  // arcFill is continuous time-progress (0..1) through the overload range.
  // Set every frame by _holdUpdateTier. Use this for smooth visual fill.
  const arcFill = Math.max(0, Math.min(1, s.arcFill || 0));

  let html = '';

  // ── POWER ARC ─────────────────────────────────────────────
  // SVG arc at ARC_RADIUS, spanning FAN_ARC_RAD centered on s.fanCenterAngle.
  // Fills progressively as tier grows. Distinct from rumble's linear overload
  // bar — this is a curved "crown of power" wrapping the radial.
  const svgSize = (ARC_RADIUS + 30) * 2;
  const svgX = s.chipCx - svgSize / 2;
  const svgY = s.chipCy - svgSize / 2;
  // Arc start/end angles
  const arcStart = center - FAN_ARC_RAD / 2;
  const arcEnd   = center + FAN_ARC_RAD / 2;
  // Filled portion (based on tier)
  const arcFillEnd = arcStart + FAN_ARC_RAD * arcFill;
  // Convert to SVG coords (SVG y is inverted vs math y; we center at svgSize/2)
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  function polar(r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  const [bgx1, bgy1] = polar(ARC_RADIUS, arcStart);
  const [bgx2, bgy2] = polar(ARC_RADIUS, arcEnd);
  const [fillx1, filly1] = polar(ARC_RADIUS, arcStart);
  const [fillx2, filly2] = polar(ARC_RADIUS, arcFillEnd);
  // Large-arc flag: 120° is less than 180°, so always 0
  const bgArcLargeFlag = 0;
  const fillArcLargeFlag = (FAN_ARC_RAD * arcFill) > Math.PI ? 1 : 0;
  const bgPath = `M ${bgx1.toFixed(2)} ${bgy1.toFixed(2)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${bgArcLargeFlag} 1 ${bgx2.toFixed(2)} ${bgy2.toFixed(2)}`;
  const fillPath = `M ${fillx1.toFixed(2)} ${filly1.toFixed(2)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${fillArcLargeFlag} 1 ${fillx2.toFixed(2)} ${filly2.toFixed(2)}`;
  // Halo intensity scales with tier (tier 1 = soft, tier 4 = saturated)
  const haloIntensity = 4 + 12 * arcFill;
  html += `<svg style="position:absolute;left:${svgX}px;top:${svgY}px;width:${svgSize}px;height:${svgSize}px;pointer-events:none;overflow:visible;">
    <path d="${bgPath}" stroke="${tierColor}33" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="${fillPath}" stroke="${tierColor}" stroke-width="6" fill="none" stroke-linecap="round"
      style="filter:drop-shadow(0 0 ${haloIntensity.toFixed(1)}px ${tierColor});"/>
  </svg>`;

  // ── ALLY ICONS ────────────────────────────────────────────
  allies.forEach((ally, i) => {
    // Distribute allies across the 120° arc centered on fanCenterAngle
    const step = (allies.length > 1) ? FAN_ARC_RAD / (allies.length - 1) : 0;
    const angle = center - FAN_ARC_RAD / 2 + i * step;
    const ax = s.chipCx + Math.cos(angle) * RADIUS - ICON_SIZE / 2;
    const ay = s.chipCy + Math.sin(angle) * RADIUS - ICON_SIZE / 2;
    const meta = (typeof PLAYER_META !== 'undefined' ? PLAYER_META[ally.cls] : null) || {};
    const clsColor = getCharUiStyle(ally.cls).color;
    const isTarget = s.dragTarget === ally.cls;
    const hpPct = Math.max(0, Math.min(1, (ally.hp || 0) / Math.max(1, ally.hpMax || 10)));
    const hpBarColor = hpPct < 0.3 ? '#e44' : (hpPct < 0.6 ? '#fa3' : '#5d5');
    const scale = isTarget ? 1.2 : 1.0;
    const ringGlow = isTarget ? `0 0 16px ${clsColor},0 0 24px #fff` : `0 2px 8px rgba(0,0,0,.5)`;
    html += `<div data-ally-target="${ally.cls}" style="position:absolute;left:${ax}px;top:${ay}px;
      width:${ICON_SIZE}px;height:${ICON_SIZE}px;pointer-events:auto;cursor:pointer;
      transform:scale(${scale});transition:transform .12s;">
      <div style="width:${ICON_SIZE}px;height:${ICON_SIZE}px;border-radius:50%;
        background:${clsColor};border:2px solid ${isTarget?'#fff':clsColor+'cc'};
        box-shadow:${ringGlow};
        display:flex;align-items:center;justify-content:center;
        font-family:Cinzel,serif;font-size:18px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);">
        ${meta.icon || (ally.cls || '?')[0].toUpperCase()}
      </div>
      <div style="position:absolute;bottom:-6px;left:0;right:0;height:4px;
        background:#222;border-radius:2px;overflow:hidden;">
        <div style="width:${hpPct*100}%;height:100%;background:${hpBarColor};transition:width .15s;"></div>
      </div>
      <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);
        font-family:ui-monospace,monospace;font-size:9px;color:#ccc;
        background:rgba(0,0,0,.7);padding:1px 4px;border-radius:3px;white-space:nowrap;">
        ${ally.hp || 0}/${ally.hpMax || 10}
      </div>
    </div>`;
  });
  return html;
}

// CSS keyframe injection for the charging ring pulse
(function injectHoldCss() {
  if (document.getElementById('hold-css')) return;
  const s = document.createElement('style');
  s.id = 'hold-css';
  s.textContent = '@keyframes holdRingPulse { from { box-shadow: 0 0 12px currentColor; } to { box-shadow: 0 0 24px currentColor, 0 0 36px currentColor; } }';
  document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════════════════════════
// HEAL FEEDBACK — visual reward when the dashboard player's HP increases.
// ═══════════════════════════════════════════════════════════════════════
// Detects HP increases on any player during render() and fires the heal
// preset for MY_CLASS specifically (I only see my own dashboard — ally
// heals show on their own screen when their state propagates).
//
// The FX itself (floater + ring + sparkles) lives in boardFx.js as the
// 'heal' preset. CSS keyframes live in boardFx.css. v0.15.31 migration
// retired _fireHealFeedback / injectHealCss / #heal-feedback-layer.

let _prevHpByCls = {};

function _detectHealsAndFire() {
  if (!G || !G.players) return;
  Object.values(G.players).forEach(p => {
    const prev = _prevHpByCls[p.cls];
    if (prev !== undefined && p.hp > prev) {
      const delta = p.hp - prev;
      if (p.cls === MY_CLASS) BoardFx.fire('heal', '#my-hp-bar', { delta });
    }
    _prevHpByCls[p.cls] = p.hp;
  });
}

// ── BRICK BAR ── horizontal chip row (rumble-style: icon + embedded pips).
// One chip per owned color. Inside each chip: 22×22 color square icon above a
// pip row. Pips = inventory count; lit pips = charged, empty pips = spent
// (pulse tier driven by lastDropped recency). Signature colors carry a brighter
// border + faint background tint. No recharge bar (board doesn't refresh —
// charges refresh only at rumble entry or zone gate crossing, per §1.1).
// Mirrors rumble's _brickBtnHTML so dashboard and rumble share one visual
// language for bricks.
// Returns BRICK CHIP HTML ONLY (no card wrapper, no card-title).
// Composed into the interaction row by _dashInteractionRow.
// v0.16.8: was _dashBrickBar — renamed for clarity, restructured to fit
// the new interaction-row composition.
function _dashBrickChips(me) {
  const sigs = getSignature(MY_CLASS);
  const bricks = me.bricks || {};
  const charged = me.bricksCharged || {};
  const ld = me.lastDropped || {};
  const owned = BRICK_NAMES.filter(c => _displayedBricks(me, c) > 0);
  if (!owned.length) {
    // No bricks — return placeholder text
    return `<div style="font-size:12px;color:var(--text-dim);padding:6px 8px;flex:1;">No bricks owned.</div>`;
  }
  let chips = '';
  owned.forEach(color => {
    const qty = _displayedBricks(me, color);
    const chg = Math.min(qty, charged[color] || 0);
    const bg = BRICK_COLORS[color] || '#555';
    const pulseTier = _pulseTier(ld[color]);
    const isSig = sigs.indexOf(color) >= 0;
    // Signature: brighter border (66→aa alpha), faint chip background.
    // Non-signature: standard subtle border/bg.
    const chipBorder = isSig ? `${bg}cc` : `${bg}66`;
    const chipBg     = isSig ? `${bg}22` : `${bg}11`;
    // Pips embedded inside chip, rumble style (6×6 squares).
    let pips = '';
    for (let i = 0; i < qty; i++) {
      const lit = i < chg;
      const cls = lit ? 'pip-lit' : ('pip-empty ' + pulseTier);
      pips += `<span class="${cls}" style="display:inline-block;width:6px;height:6px;border-radius:2px;margin:1px;`
        + (lit
            ? `background:${bg};box-shadow:0 0 4px ${bg};`
            : `background:#1a1a1a;border:1px solid ${bg}aa;box-sizing:border-box;`)
        + `"></span>`;
    }
    // Only wire pointer events for colors with defined actions today.
    // Other colors render as inert chips until 0.16 fills in abilities.
    const hasAction = (color === 'white' || color === 'gray');
    chips += `<div class="dash-brick-chip" data-brick-chip="${color}" data-color="${color}" `
      + (hasAction ? `onpointerdown="_holdStart(event, '${color}', this)" ` : '')
      + `style="`
      + `display:flex;flex-direction:column;align-items:center;justify-content:flex-start;`
      + `padding:6px 4px 4px 4px;border-radius:6px;`
      + (hasAction ? 'cursor:pointer;' : 'cursor:default;opacity:.85;')
      + `background:${chipBg};border:2px solid ${chipBorder};min-width:44px;`
      + `touch-action:none;user-select:none;-webkit-user-select:none;">`
      + `<span style="width:22px;height:22px;border-radius:4px;background:${bg};`
      + `box-shadow:0 1px 4px rgba(0,0,0,.5);margin-bottom:4px;"></span>`
      + `<div style="display:flex;flex-wrap:wrap;justify-content:center;max-width:40px;">${pips}</div>`
      + `</div>`;
  });
  return chips;
}

// ── INTERACTION ROW (v0.16.10 redesign) ──
// Bricks-only now. Coin and cheese moved up to the header card
// (.head-resources inside .head-id). Brick chips retain existing
// tier-charge hold behavior. v0.16.11+ will add fusion-drag gesture
// from a brick to the dynamic zone.
function _dashInteractionRow(me) {
  return `<div class="interaction-row">
    <div class="brick-chips">
      ${_dashBrickChips(me)}
    </div>
  </div>`;
}

// ── DYNAMIC ZONE (v0.16.9 — class-color outlined slot, intense pulse on turn) ──
// Single multi-state slot between header and interaction row. v0.16.8
// shipped foundation (idle + event); v0.16.9 adds class-color outline +
// my-turn highlight + pulse animation (replaces the gone phase-banner).
// Hold-invoked surfaces (market, cheese, party, fusion) wire in v0.16.10.
//
// Returns { html, active } so renderDashboard can track transitions.
// The .my-turn class lights up the border + triggers the pulse keyframes.
function _dashDynamicZone(me) {
  const isMyTurn = G.turnOrder[G.activePlayerIdx] === MY_CLASS;
  let html = '';
  let active = false;

  // Rumble card (pending or active) — always shown when applicable.
  const rumbleHtml = renderRumbleCard(me);
  if (rumbleHtml) { html += rumbleHtml; active = true; }

  // Event card — the #landing-result container, populated by restoreActiveEvent.
  const hasMyActiveEvent = isMyTurn && G.phase === 'land' && !_pendingResult
    && G.activeEvent && G.activeEvent.cls === MY_CLASS && !G.activeEvent.resolved;
  const hasSharedRiddle = !isMyTurn && G.activeEvent && G.activeEvent.evType === 'riddle'
    && (G.activeEvent.riddleActive || G.activeEvent.riddleWinner || G.activeEvent.riddleExpired);
  const hasSharedTrial = !isMyTurn && G.activeEvent && G.activeEvent.redVariant === 'trial_of_hand';
  if (hasMyActiveEvent || hasSharedRiddle || hasSharedTrial) {
    html += '<div id="landing-result"></div>';
    active = true;
  }

  // Idle state — flavor text. Only render when no other content claimed the zone.
  // Phase banner is gone (v0.16.9) — flavor text is the ambient "what's happening
  // when nothing is happening" surface, working alongside the .my-turn border
  // highlight to communicate state.
  if (!active) {
    const line = dashboardFlavor(false);
    if (line) {
      html = `<div style="padding:12px 16px;text-align:center;">
        <div style="font-family:Cinzel,serif;font-size:13px;font-style:italic;color:var(--text-dim);line-height:1.5;">${line}</div>
      </div>`;
    }
  }

  // .my-turn class triggers intense border + pulse animation on the dynamic zone.
  // Set whenever it's the player's turn, regardless of whether content is active —
  // so even an event card during your turn glows.
  const turnClass = isMyTurn ? ' my-turn' : '';
  return { html: `<div class="dynamic-zone${turnClass}" id="dynamic-zone">${html}</div>`, active };
}

// ── TOP SLOT and FLAVOR LINE (REMOVED v0.16.8) ──
// Old _dashTopSlot and _dashFlavorLine functions were merged into the new
// _dashDynamicZone (above). The dynamic zone is the unified successor —
// renders flavor (idle), event card (active event), or rumble card from
// the same slot. Will gain market/cheese/party/fusion states in v0.16.9
// when hold-gestures wire in.

// ── PHASE CONTEXT ── middle-of-dashboard cards (non-top-slot).
// Absorbs what the old Actions tab did, minus the event + rumble cards which
// now live in the top slot via _dashTopSlot.
function _dashPhaseContext(me) {
  const isMyTurn = G.turnOrder[G.activePlayerIdx] === MY_CLASS;
  let html = '';
  // Pending result card (from reward, gate, etc.)
  html += renderResultCard();
  // Prepare phase — full prepare panel with rumble-prep actions
  if (G.phase === 'prepare') {
    html += renderPreparePanel(me);
  }
  // Landing-event entry (Roll Die button) — only when no active event and no pending result
  if (isMyTurn && G.phase === 'land' && !_pendingResult) {
    var hasActiveEvent = G.activeEvent && G.activeEvent.cls === MY_CLASS && !G.activeEvent.resolved;
    if (!hasActiveEvent) {
      html += renderLandPanel(me);
    }
    // When active event: landing-result container is in the TOP SLOT now, not here.
  }
  // Gate buttons stripped (S015) — renderGateActions removed; gates now
  // resolved via DM screen forceGate / setGate. Future brick-bar overhaul
  // will re-introduce class-driven gate interactions.
  return html;
}

// ── ACTIONS section removed (S015 strip) ───────────────────────────────
// _dashActions / _dashActionsSelf / _dashActionsAlly / _dashActionsClass /
// _dashActionsBoard were a duplicate action surface for non-prepare phases
// (Self heal, brace, heal ally, mass repair, market). All bricks-as-buttons
// duplicates of the rumble bar — stripped per workflow rule (no redundant
// action surfaces). Market lives in buildPrepareActions; will move to a
// dedicated panel during 0.16.0 (Class Identity Board) overhaul.
// ────────────────────────────────────────────────────────────────────────

function renderDashboard(me) {
  const el = document.getElementById('pane-dashboard');
  if (!el) return;
  // v0.15.43 — diagnostic log: what _displayed actually returns at this
  // moment. Compare to render-top's `raw` to see if the override is in
  // effect or being bypassed.
  try {
    var displayedBricks = {};
    if (typeof BRICK_NAMES !== 'undefined') {
      BRICK_NAMES.forEach(function(c){
        var v = _displayedBricks(me, c);
        if (v > 0 || (me.bricks && me.bricks[c])) displayedBricks[c] = v;
      });
    }
    _bqLog('dashboard-rendering', {
      displayed: { gold: _displayed(me,'gold'), cheese: _displayed(me,'cheese'), bricks: displayedBricks }
    });
  } catch(e) {}
  const isKO = !me.alive || me.hp <= 0;
  if (isKO) {
    el.innerHTML = `<div class="card" style="border-color:var(--red);">
      <div style="text-align:center;color:var(--red);font-family:'Cinzel',serif;font-size:16px;margin-bottom:8px;">⬇ KNOCKED OUT</div>
      <div style="font-size:12px;color:var(--text-dim);text-align:center;">Your phone is still active. Hold your avatar to view party.</div>
    </div>`;
    return;
  }
  // Market expanded inline? Keep the existing market-panel render for now.
  const marketPanel = (typeof _marketOpen !== 'undefined' && _marketOpen)
    ? renderMarketPanel(me) : '';
  // v0.16.8 composition: header (identity+HP+shield) → dynamic zone
  // (flavor or event) → interaction row (bricks+coin+cheese+avatar).
  // The dynamic zone replaces the old top-slot/flavor split. Phase context
  // and clues remain below for prepare/land panels.
  const dz = _dashDynamicZone(me);
  // Track active state for next render's transition detection
  _dashTopSlotWasActive = dz.active;
  el.innerHTML = `
    ${_dashHeader(me)}
    ${dz.html}
    ${_dashInteractionRow(me)}
    ${_dashPhaseContext(me)}
    ${marketPanel}
    ${renderStatusClues()}
  `;
}

// ── FUSION (stub) ── 0.15.0+ will wire brick fusion for higher tiers
function renderFusion() {
  const el = document.getElementById('pane-fusion');
  if (!el) return;
  el.innerHTML = `<div class="card">
    <div class="card-title">Fusion</div>
    <div style="padding:12px 6px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:16px;color:var(--cls-color);margin-bottom:10px;letter-spacing:.08em;">⚗ Coming Soon</div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.6;">Brick fusion will unlock higher-tier pieces and special moves by combining charges across colors. Thank you for your patience.</div>
    </div>
  </div>`;
}

function renderPendingClue() {
  if (!G || !G.activeEvent || G.activeEvent.resolved) return '';
  var ev = G.activeEvent;
  if (!ev.pendingClue) return '';
  var pc = ev.pendingClue;
  var isSolver = ev.cls === MY_CLASS || (pc.solverCls === MY_CLASS);
  return '<div class="card" style="border:2px solid var(--yellow);background:#1a1500;text-align:center;">'
    + '<div style="font-family:Cinzel,serif;font-size:11px;color:var(--yellow);letter-spacing:.06em;margin-bottom:4px;">'
    + (isSolver ? '⭐ Clue Discovered!' : '<span style="width:10px;height:10px;border-radius:2px;background:#F5D000;display:inline-block;vertical-align:middle;margin-right:4px;"></span>Clue Discovered!')
    + '</div>'

    + '<div style="font-size:10px;color:var(--text-faint);font-style:italic;">Full clue saved to your Status tab</div>'
    + '</div>';
}


function renderStatusClues() {
  var clues = G.discoveredClues || [];
  if (!clues.length) return '';
  var html = '<div id="status-clues" class="card" style="border-color:var(--yellow)33;">';
  html += '<div class="card-title" style="color:var(--yellow);display:flex;align-items:center;gap:6px;"><span style=\"width:12px;height:12px;border-radius:2px;background:#F5D000;display:inline-block;\"></span>Clues Discovered</div>';
  clues.forEach(function(c) {
    var zoneName = c.zone !== undefined && ZONES[c.zone] ? ZONES[c.zone].name : '';
    var catColor = {
      'Zone Progression':'var(--green)',
      'Bosses':'var(--red)',
      'Boss Warning':'var(--red)',
      'Combat':'var(--orange)',
      'Class Tips':'var(--cls-color)',
      'Party Tips':'var(--green)',
      'Bricks':'#ccaa66',
      'Events':'var(--purple)',
      'Entities':'var(--cls-color)',
      'Cheese':'#F5C800',
      'Future':'#4db8ff',
    }[c.category] || 'var(--yellow)';
    html += '<div style="padding:8px 0;border-bottom:1px solid #1a1a1a;">';
    if (c.category) html += '<div style="font-size:9px;font-family:Cinzel,serif;letter-spacing:.06em;color:'+catColor+';margin-bottom:4px;">'+c.category.toUpperCase()+(zoneName?' · '+zoneName:'')+'</div>';
    html += '<div style="font-size:13px;color:var(--text);line-height:1.5;">' + c.clue + '</div>';

    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ── BRICK PIP RENDERING (S013 §7.2 / §1.2) ──────────────────
// Pip row for a player's inventory: one pip per owned brick, lit for
// charged, hollow+pulsing for empty. Pulse speed tier is set per-color
// from lastDropped[color] recency per §1.2.
//
// Usage:
//   renderBrickPips(me.bricks, me.bricksCharged, me.lastDropped, opts)
// opts (all optional):
//   size: pip size px (default 10, compact = 6)
//   clickable: {targetCls: string} → pips become tap-to-trade, one per pip
//
// Pips follow the rumble HUD visual: filled pip = brick color + glow;
// empty pip = dark fill + color-tinted border (readable for low-contrast
// colors like black).

function _pulseTier(lastDroppedAt) {
  if (!lastDroppedAt) return 'pulse-slow';
  var age = Date.now() - lastDroppedAt;
  if (age < 5000)  return 'pulse-fast';
  if (age < 30000) return 'pulse-med';
  return 'pulse-slow';
}

function renderBrickPips(bricks, bricksCharged, lastDropped, opts) {
  opts = opts || {};
  var size = opts.size || 10;
  var clickable = opts.clickable || null;
  var bc = bricksCharged || {};
  var ld = lastDropped || {};
  var out = '';
  BRICK_NAMES.forEach(function(color) {
    var owned = bricks[color] || 0;
    if (!owned) return;
    var charged = Math.min(owned, bc[color] || 0);
    var bg = BRICK_COLORS[color] || '#555';
    var tier = _pulseTier(ld[color]);
    for (var i = 0; i < owned; i++) {
      var lit = i < charged;
      var cls = lit ? 'pip-lit' : ('pip-empty ' + tier);
      var style = 'display:inline-block;width:'+size+'px;height:'+size+'px;border-radius:2px;margin:1px;'
        + (lit
          ? 'background:' + bg + ';box-shadow:0 0 4px ' + bg + ';'
          : 'background:#1a1a1a;border:1px solid ' + bg + 'aa;box-sizing:border-box;');
      var attrs = 'class="'+cls+'" style="'+style+'"';
      if (clickable && clickable.targetCls) {
        // Each lit pip is a tap-to-trade target (empty pips are not tradable —
        // they're charges, not inventory, but even empty owned slots represent
        // physical bricks the owner could trade; keep entire set clickable
        // per §1.1 "inventory is what you own" model).
        attrs += ' data-t="'+clickable.targetCls+'" data-k="'+color+'" onclick="event.stopPropagation();startTradeRequest(this.dataset.t,this.dataset.k)" ';
        attrs += 'title="Trade for 1 '+color+'"';
      }
      out += '<span ' + attrs + '></span>';
    }
  });
  return out;
}

// ── PREPARE PANEL ──
// Single panel shown during the prepare phase. Lists all available actions as
// flat buttons. Tapping a button expands it to show details and a Use button.
// Unavailable actions are shown grayed out.
var _expandedAction = null; // id of currently-expanded action
function toggleActionExpand(id) {
  _expandedAction = _expandedAction === id ? null : id;
  render();
}

// Diagnostic: call from browser console to see what wraps the action cards
window._debugPreparePanel = function() {
  var pane = document.getElementById('pane-dashboard');
  if (!pane) { console.log('pane-dashboard not found'); return; }
  console.log('=== pane-dashboard ancestors ===');
  var el = pane;
  var depth = 0;
  while (el && depth < 10) {
    var style = window.getComputedStyle(el);
    console.log(depth, el.tagName, 'id='+(el.id||''), 'class='+(el.className||''),
      'bg=' + style.backgroundColor, 'border=' + style.border, 'br=' + style.borderRadius,
      'mw=' + style.maxWidth, 'pad=' + style.padding);
    el = el.parentElement;
    depth++;
  }
  console.log('=== pane-dashboard direct children ===');
  Array.from(pane.children).forEach(function(c, i) {
    var style = window.getComputedStyle(c);
    console.log(i, c.tagName, 'class=' + (c.className||''),
      'bg=' + style.backgroundColor, 'border=' + style.border, 'br=' + style.borderRadius);
  });
};

// Thematic flavor pool — dungeon atmosphere, dungeony dad jokes, LEGO meta.
// Used by the Dashboard top slot when no event/rumble-pending card is active.
// Rotates on phase change, event-clear, or tab-switch to Dashboard.
//
// Tone: wry, brief, same cadence across voices. Self-aware but not snarky.
// Immersive when possible; the LEGO winks are occasional, not constant.
var FLAVOR_POOL = [
  // ── Dungeon atmosphere (original 20, kept verbatim — they land) ──
  'The torches crackle. Someone should really check the pilot light.',
  'A rat scurries past. It looks like it has somewhere to be.',
  'You smell damp stone and bad decisions.',
  'The dungeon sighs. It\'s been a long week.',
  'Distant dripping. Always distant dripping.',
  'A draft from nowhere. Ghosts, probably. Or the HVAC.',
  'Your boots squelch. You don\'t want to know why.',
  'Something skitters. Or was that your stomach?',
  'The walls seem closer than before. Or you ate a big lunch.',
  'An old map flutters by. It\'s not yours, but finders keepers.',
  'Faint music from the east. The goblins might have a piano.',
  'You feel watched. Check the corner. Yep, a crack in the stone shaped like a face.',
  'The dungeon master rolls dice behind a screen. You pretend not to hear.',
  'A torch flickers out. Dramatic. Unnecessary. You are impressed.',
  'Somewhere, a door slams. You did not move.',
  'A low rumble. Either a dragon, or someone is hungry.',
  'You find a copper coin. It\'s stuck to the floor.',
  'The air tastes like old parchment and regret.',
  'A skeleton waves. You wave back. It\'s only polite.',
  'Brave, aren\'t you? Or short on other options.',

  // ── Dungeon dad jokes (new, 20) ──
  'A dragon tried stand-up. The crowd was lit.',
  'A skeleton walked into a tavern. Couldn\'t order. No guts.',
  'Dungeon economics: all rock, no paper.',
  'The wizard filed his taxes. Audited by a specter.',
  'Heard the bard\'s new album. It\'s a lute.',
  'The necromancer threw a party. It was dead.',
  'A ghost haunted the library. Nobody checked him out.',
  'The troll charges tolls. Accepts teeth.',
  'The mage cast Identify on a sandwich. Results were bread-curdling.',
  'Two goblins walked into a bar. The third one ducked.',
  'The minotaur got lost at work. Occupational hazard.',
  'A vampire ordered stake. Kitchen refused.',
  'Why are orcs bad at poker? Too many tells.',
  'The lich took up pottery. Work was skeletal.',
  'The paladin misplaced his honor. Last seen near the tavern.',
  'Wizards hate stairs. Something about levels.',
  'The cleric\'s sermon ran long. Nobody was healed.',
  'A slime joined improv. Kept splitting into two characters.',
  'A mimic opened a gift shop. All items final.',
  'The dungeon\'s Yelp review: two stars, would flee again.',

  // ── LEGO meta (new, 20) ──
  'A loose 1x1 rolls past. Somewhere, a foot waits.',
  'Your inventory rattles when you walk. It\'s fine.',
  'Somebody stepped on a red brick. The scream echoed for years.',
  'You try to click a brick sideways. The studs disagree.',
  'The minifig next to you has the same face. Everyone does.',
  'A stud clicks somewhere overhead. Reassuring and concerning.',
  'You find a trans-clear 1x1 cheese slope. Cherished. Easily lost.',
  'The studs on this floor are decorative. Or the architect lied.',
  'A baseplate extends into the distance. The grid is the grid.',
  'Your cape is printed, not cloth. Nobody has to know.',
  'You can\'t turn your wrist. You\'ve made peace with this.',
  'The instructions are several rooms back. Wing it.',
  'A brick-built dog watches silently. It judges your stacking.',
  'Your hands grip but do not grasp. It has always been this way.',
  'Somewhere, a vacuum runs. You do not move.',
  'A wizard here has two faces. Literally. The print is double-sided.',
  'You step on a Technic pin. It rolls. You roll with it.',
  'The sky is a very large blue plate. You don\'t question it.',
  'Your belt is part of your torso print. It was always there.',
  'A 2x4 brick does many jobs. Respect the 2x4.',
];
// Back-compat alias — any older code paths referring to PREPARE_FLAVOR still work.
var PREPARE_FLAVOR = FLAVOR_POOL;
// ── Flavor rotation infrastructure ──
// One pool (FLAVOR_POOL), one LRU (_flavorRecent), two rotation policies.
//
// _flavorRecent holds the last LRU_SIZE indices shown on THIS client, across
// both surfaces. Prevents the dashboard and prepare header from both landing
// on the same line within a short window. Per-client (browser) state; server
// not involved.
//
// Class-seeded picks: the starting offset for any new selection factors in
// MY_CLASS, so two players on different classes rotating at the same moment
// drift apart in the pool. They can still land on the same line eventually,
// but not via mirror-rotation.
var FLAVOR_LRU_SIZE = 15;
var _flavorRecent = [];

// Simple string hash for seeding. Returns non-negative int.
function _flavorHash(s) {
  var h = 0;
  s = String(s || '');
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Pick the next flavor index given a seed string. Walks the pool from the
// seed position, skipping anything currently in _flavorRecent. Guaranteed to
// return a fresh index as long as pool.length > LRU_SIZE (60 > 15, so yes).
function _pickFlavor(seedKey) {
  var pool = FLAVOR_POOL;
  var n = pool.length;
  var start = _flavorHash(seedKey + '|' + Date.now()) % n;
  for (var step = 0; step < n; step++) {
    var idx = (start + step) % n;
    if (_flavorRecent.indexOf(idx) === -1) {
      _flavorRecent.push(idx);
      if (_flavorRecent.length > FLAVOR_LRU_SIZE) _flavorRecent.shift();
      return idx;
    }
  }
  // Pool exhausted (shouldn't happen) — reset and pick start.
  _flavorRecent = [start];
  return start;
}

// ── Dashboard top-slot flavor ──
// Rotates when any of these change:
//   - phase / round / activePlayerIdx (phase transitions)
//   - event card was active last render but no longer is (event cleared)
//   - tab switched TO dashboard (via _flavorStaleTab flag, set by switchTab)
//
// Between rotation triggers, the line stays put — readable, not strobing.
var _dashFlavorKey = null;
var _dashFlavor = '';
var _dashTopSlotWasActive = false;  // was an event/rumble card showing last render?
var _flavorStaleTab = false;         // set by switchTab when entering dashboard
function dashboardFlavor(topSlotActiveNow) {
  var phaseKey = (G && G.phase) + '|' + (G && G.round) + '|' + (G && G.activePlayerIdx);
  var clearedTrigger = _dashTopSlotWasActive && !topSlotActiveNow;
  var tabTrigger = _flavorStaleTab;
  var currentKey = phaseKey + '|' + (clearedTrigger ? 'c' + Date.now() : '') + (tabTrigger ? 't' + Date.now() : '');
  if (_dashFlavorKey !== currentKey) {
    _dashFlavorKey = currentKey;
    var seed = (MY_CLASS || 'x') + '|dash|' + phaseKey + '|' + (_flavorRecent.length);
    _dashFlavor = FLAVOR_POOL[_pickFlavor(seed)];
    _flavorStaleTab = false;
  }
  _dashTopSlotWasActive = topSlotActiveNow;
  return _dashFlavor;
}

function renderPreparePanel(me) {
  var actions = buildPrepareActions(me);
  if (!actions.length) return '';
  // Flavor line lives in the Dashboard top slot now — no second copy here.
  var html = '';
  actions.forEach(function(a) {
    html += renderActionButton(a);
  });
  return html;
}

function renderActionButton(a) {
  var expanded = _expandedAction === a.id || (a.children && a.children.some(function(c){return _expandedAction === c.id;}));
  var grayed = !a.available && !a.children && !a.isMarket;
  // Skip unusable actions entirely (except pending ones, which show "Waiting...")
  if (grayed && !a.pending) return '';
  // Each button is rendered as a standalone, visually distinct card.
  // Uses a dark card background with stronger border, generous outer margin,
  // and a drop shadow to lift each card off the page.
  var bg = a.pending ? '#3a1a0a' : expanded ? '#2a2a36' : '#1d1d28';
  var border = a.pending ? 'var(--red)' : expanded ? 'var(--cls-color)' : '#3a3a48';
  var opacity = grayed ? '0.45' : '1';
  var cursor = grayed ? 'not-allowed' : 'pointer';
  var boxShadow = expanded
    ? '0 0 0 2px var(--cls-color)55, 0 4px 12px rgba(0,0,0,0.6)'
    : '0 2px 6px rgba(0,0,0,0.5)';
  var html = '<div style="margin:0 0 14px 0;border-radius:12px;border:1px solid '+border+';background:'+bg+';overflow:hidden;box-shadow:'+boxShadow+';">'
    + '<div style="padding:16px 14px;font-size:15px;font-weight:700;color:var(--text);cursor:'+cursor+';opacity:'+opacity+';text-align:center;position:relative;" '
    +   'onclick="'+(grayed ? '' : "toggleActionExpand('"+a.id+"')")+'">'
    + '<span>'+a.label+'</span>'
    + '<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--text-dim);font-size:12px;">'+(expanded?'▾':'▸')+'</span>'
    + '</div>';
  if (expanded) {
    html += '<div style="padding:14px;border-top:1px solid rgba(255,255,255,0.08);font-size:13px;color:var(--text-dim);background:rgba(0,0,0,0.25);">'
         + '<div style="margin-bottom:12px;line-height:1.55;white-space:pre-line;text-align:center;">'+a.detail+'</div>';
    if (a.children) {
      a.children.forEach(function(c) { html += renderActionButton(c); });
    } else if (a.isMarket && a.available) {
      html += renderMarketGrid();
    } else if (a.available && a.onUse) {
      html += '<div style="text-align:center;"><button class="btn primary" style="width:100%;font-size:14px;" onclick="runAction(\''+a.id+'\')">Use</button></div>';
    } else if (a.pending) {
      html += '<div style="text-align:center;color:var(--red);font-family:Cinzel,serif;letter-spacing:.05em;padding:6px;">Waiting...</div>';
    }
    html += '</div>';
  }
  html += '</div>'; // close outer card div
  return html;
}

function renderMarketGrid() {
  if (!G || !G.players || !G.players[MY_CLASS]) return '';
  var me = G.players[MY_CLASS];
  var prices = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
  var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">';
  Object.entries(prices).forEach(function(e) {
    var col = e[0], price = e[1];
    var bg = BRICK_COLORS[col] || '#888';
    var bdr = col === 'white' ? 'border:1px solid #ccc;' : '';
    var tc = (col === 'white' || col === 'yellow') ? '#333' : bg;
    var canAfford = (me.gold || 0) >= price;
    html += '<button onclick="buyBrick(this.dataset.color)" data-color="' + col + '" ' + (canAfford ? '' : 'disabled') + ' '
          + 'style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 6px;border-radius:10px;'
          + 'background:' + bg + '18;border:1px solid ' + (canAfford ? bg : '#333') + ';cursor:' + (canAfford ? 'pointer' : 'not-allowed') + ';'
          + 'opacity:' + (canAfford ? '1' : '.4') + ';">'
          + '<span style="width:22px;height:22px;border-radius:4px;background:' + bg + ';' + bdr + 'display:block;box-shadow:0 1px 3px rgba(0,0,0,.4);"></span>'
          + '<span style="font-family:Cinzel,serif;font-size:9px;letter-spacing:.04em;color:' + tc + ';">' + col + '</span>'
          + '<span style="font-size:13px;color:var(--gold);">🪙' + price + '</span>'
          + '</button>';
  });
  html += '</div>';
  return html;
}

// Build list of prepare-phase action definitions.
// S015 strip: legacy class-action / brick-duplicate buttons removed.
// Bricks on the rumble bar are the canonical action surface for combat.
//
// REMOVED concepts (rebuild as brick-driven actions in 0.16+):
//   - 🎲 Move / Roll Die — needs new movement input model
//   - 🔴 Red Brick Dash — will live on character dashboard brick bar
//   - 💊 Self Heal (white) — duplicates rumble bar
//   - 🛡 Add Shield (gray) — duplicates rumble bar
//   - 💊 Heal Ally (Fixer, white + target select)
//   - 💊 Mass Repair (Fixer, 2 white → all allies)
//   - ✨ Revive (Fixer, 3 white → downed ally)
//   - 🔧 Forge (Blocksmith, 2 same-color → 1 any)
//   - 📋 Blueprint (Blocksmith, 1 gray → duplicate any)
// Server handlers, client.* methods, and modal helpers are PRESERVED for
// future re-wiring — only the dashboard buttons that triggered them were
// stripped. See REVISIT comments throughout server.js + characters.js.
function buildPrepareActions(me) {
  var list = [];

  // ── MARKET — always shown unless restricted ──
  var zone = (SPACES[me.space] && SPACES[me.space].zone) || 0;
  var zoneRestricted = zone === 4; // zone 5 (0-indexed 4)
  var marketBlocked = zoneRestricted || G.storeDisabled;
  var marketDetail;
  if (zoneRestricted) marketDetail = 'Market unavailable in this zone.';
  else if (G.storeDisabled) marketDetail = 'Market closed by DM.';
  else marketDetail = 'Buy bricks with gold.\nYour gold: 🪙' + (me.gold || 0) + '.';
  list.push({
    id: 'market',
    label: '🛒 Market',
    detail: marketDetail,
    available: !marketBlocked,
    isMarket: true,
    onUse: null,
  });

  return list;
}

// Action registry — called when a leaf's Use button is pressed
var _actionRegistry = null;
function runAction(id) {
  // Rebuild registry each call — availability may have changed
  _actionRegistry = {};
  var me = G && G.players ? G.players[MY_CLASS] : null;
  if (me) {
    var actions = buildPrepareActions(me);
    var walk = function(arr) { arr.forEach(function(a){ _actionRegistry[a.id] = a.onUse; if (a.children) walk(a.children); }); };
    walk(actions);
  }
  var fn = _actionRegistry[id];
  if (fn) fn();
}


// ── FIXER ──

// ── MOVE PANEL ──

// Render the red dash control — button, pending banner, or disabled state


// ── RUMBLE CARD ──
// Shown on the active player's screen when:
//  (A) G.pendingRumbleBattle targets them → event card with flavor + Enter Rumble button
//  (B) G.rumbleBattle active → handled by the rumble-manager + rumble runtime,
//      NOT rendered here. The fullscreen rumble-root overlay takes over; this
//      card only shows the PRE-battle event. The old "BATTLE ACTIVE placeholder"
//      panel was Phase 1 stub before rumble integration existed — deleted now
//      that syncRumbleFromState drives the actual combat UI.
function renderRumbleCard(me) {
  if (!G) return '';
  // Pending: event card with flavor text + Enter Rumble button
  if (G.pendingRumbleBattle && G.pendingRumbleBattle.cls === MY_CLASS && !G.rumbleBattle) {
    var pb = G.pendingRumbleBattle;
    // Per-entity identity — icon + family-themed accent color so the stone
    // troll doesn't get a goblin face or a red-tinted card.
    // Server rolls the color fresh per encounter (3 colors per family, doc §2.1)
    // so the same goblin can show red one fight, orange the next, gray after.
    var entityType = (pb.enemy && pb.enemy.type) || 'goblin';
    var meta = (typeof ENTITY_META !== 'undefined' && ENTITY_META[entityType]) || { icon: '👺', family: 'physical' };
    var entityIcon = meta.icon || '👺';
    var family = meta.family || 'physical';
    // 3 brick colors per family (doc §2.1 Per-Color Role Matrix)
    var FAMILY_PALETTE = {
      physical: ['red',    'orange', 'gray'],
      ethereal: ['blue',   'yellow', 'white'],
      malady:   ['green',  'purple', 'black'],
    };
    var palette = FAMILY_PALETTE[family] || FAMILY_PALETTE.physical;
    // Prefer server-rolled color (fresh per event). Fallback: deterministic
    // hash pick — covers any in-flight pending rumbles during a server
    // upgrade or malformed state.
    var pickColor = (pb.enemy && pb.enemy.encounterColor) || null;
    if (!pickColor || palette.indexOf(pickColor) < 0) {
      var h = 0; for (var ci = 0; ci < entityType.length; ci++) h = (h * 31 + entityType.charCodeAt(ci)) | 0;
      pickColor = palette[Math.abs(h) % palette.length];
    }
    var accent = (typeof BRICK_COLORS !== 'undefined' && BRICK_COLORS[pickColor]) || '#E24B4A';
    // Card tone — mix entity accent into the dark background gradient. Darker
    // on top, the color hints underneath. Readable on any family.
    var bgStart = accent + '22';  // ~13% alpha
    var bgEnd   = '#1a0505';
    return '<div id="rumble-event-card" style="margin:12px 0;padding:16px;border-radius:12px;background:linear-gradient(180deg,' + bgStart + ' 0%,' + bgEnd + ' 100%);border:2px solid ' + accent + ';box-shadow:0 4px 16px ' + accent + '44;">'
      + '<div style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.12em;color:' + accent + ';margin-bottom:8px;text-align:center;">⚔ ENCOUNTER</div>'
      + '<div style="font-size:40px;text-align:center;margin-bottom:8px;line-height:1;">' + entityIcon + '</div>'
      + '<div style="font-size:15px;color:var(--text);font-style:italic;text-align:center;line-height:1.5;margin-bottom:14px;">"' + escapeHtmlMin(pb.flavor) + '"</div>'
      + '<div style="font-size:12px;color:var(--text-dim);text-align:center;margin-bottom:12px;">A <strong>' + escapeHtmlMin(pb.enemy.name) + '</strong> blocks your path. Enter the rumble to fight.</div>'
      + '<button class="btn" style="width:100%;padding:14px;font-size:15px;font-family:Cinzel,serif;letter-spacing:.1em;background:linear-gradient(180deg,' + accent + ' 0%,' + accent + 'bb 100%);border-color:' + accent + ';color:#fff;font-weight:700;" onclick="enterRumbleClick()">⚔ ENTER RUMBLE</button>'
      + '<div style="font-size:10px;color:var(--text-faint);text-align:center;margin-top:8px;">Fullscreen landscape recommended</div>'
      + '</div>';
  }
  // Active battles no longer render a card — the rumble runtime owns the UI
  // via the fullscreen rumble-root overlay. syncRumbleFromState() handles the
  // show/hide transition based on G.rumbleBattle state.
  _rumbleForcedSeen = false;
  return '';
}

var _rumbleForcedSeen = false;

function escapeHtmlMin(s) {
  return String(s || '').replace(/[<>&"]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];});
}

function enterRumbleClick() {
  // Request fullscreen on button tap (valid user gesture)
  try {
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function(){});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch(_) {}
  // Lock landscape if supported (will silently fail on iOS)
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function(){});
    }
  } catch(_) {}
  // Tell server we're ready to start
  client.send('battleReady', { cls: MY_CLASS });
}

// ── LAND PANEL ──
function renderLandPanel(me) {
  const zone = SPACES[me.space]?.zone || 0;
  // Auto-trigger landing roll — server generates roll server-side
  if (!G.activeEvent && !_landingRollSent) {
    _landingRollSent = true;
    requestAnimationFrame(function() { requestAnimationFrame(function() { client.landingRoll(MY_CLASS, 0, zone); }); });
  }
  return '<div id="landing-result"></div>';
}


// burstParticles — fires the canvas-based event-landing burst.
// v0.15.36: migrated to boardFx as 'eventBurst' preset; this remains
// as a thin dispatcher so existing call sites don't need to change.
// Origin is computed from the event card's icon element (or fallback
// to the card center) — the boardFx preset receives the rect-anchor.
function burstParticles(evType) {
  var el = document.getElementById('landing-result');
  if (!el) return;
  var originEl = el.querySelector('.event-icon-origin') || el.querySelector('span[style*="border-radius"]') || el;
  var rect = originEl.getBoundingClientRect();
  if (rect.width === 0) rect = el.getBoundingClientRect();
  BoardFx.fire('eventBurst', rect, { evType: evType });
}

function showLandingResult(ev, r, zone) {
  var me = G && G.players && G.players[MY_CLASS];
  var el = document.getElementById('landing-result');
  if(!el||!ev) return;
  var extra = '';

  // Gold event — mini-game or result card
  if (ev.type === 'gold') {
    if (G.activeEvent && G.activeEvent.goldResult) {
      var gr2 = G.activeEvent.goldResult;
      var foundAmt2 = gr2.amount || 0;
      var grCheese = gr2.cheeseFound || 0;
      var grWT = gr2.wrongTap;
      var grIsCrack = (G.activeEvent.goldVariant === 'crack');
      var grSpec = {}, grFlav = '', grTitle = '', grTheme = '#F5D000', grBg = '#1a1200';

      if (grIsCrack && grWT && foundAmt2 === 0 && grCheese === 0) {
        // Crack: pure rat bite, nothing found at all
        grTitle = '🩸 RAT BITE'; grTheme = '#d44'; grBg = '#1a0505';
        grSpec.hp = -1;
        var rLines = ['Something bit back.','The rat was faster.','That was teeth, not coin.','The crack had other occupants.'];
        grFlav = rLines[Math.floor(Math.random()*rLines.length)];
      } else if (grIsCrack && grWT && foundAmt2 === 0 && grCheese > 0) {
        // Crack: rat bite but got cheese
        grTitle = '🧀 CHEESE (WITH TEETH)'; grTheme = '#FFD96A'; grBg = '#1a1205';
        grSpec.cheese = grCheese;
        grSpec.hp = -1;
        var rcLines = ['A cheese for your trouble. And your blood.','Cheese in hand, teeth in the other.','The rat and the cheese were close neighbors.','At least you got something.'];
        grFlav = rcLines[Math.floor(Math.random()*rcLines.length)];
      } else if (grIsCrack && grWT && foundAmt2 > 0) {
        // Crack: coins plus rat bite (optional cheese)
        grTitle = '🪙 FOUND (WITH TEETH)'; grTheme = '#E8C868'; grBg = '#1a1205';
        grSpec.coins = foundAmt2;
        if (grCheese > 0) grSpec.cheese = grCheese;
        grSpec.hp = -1;
        var rbLines = ['Could have done without the teeth.','Found some. Then found the rat.','Coins in one hand, bite marks on the other.','Not bad. The rat disagrees.','Worth it. Probably.','The rat wanted its cut.'];
        grFlav = rbLines[Math.floor(Math.random()*rbLines.length)];
      } else if (foundAmt2 === 0 && grCheese === 0) {
        // Torch burnout
        grTitle = '🔥 BURNED OUT'; grTheme = '#888'; grBg = '#141414';
        var bLines = ['The torch gave everything it had.','Light gone. The floor keeps its secrets.','The dark reclaims the floor.','It burns out. Nothing to show.','Flame out.'];
        grFlav = bLines[Math.floor(Math.random()*bLines.length)];
      } else {
        // Torch success (coins and/or cheese found)
        grTitle = grIsCrack ? '🪙 FOUND' : '🕯 GATHERED';
        grTheme = '#F5D000'; grBg = '#1a1200';
        if (foundAmt2 > 0) grSpec.coins = foundAmt2;
        if (grCheese > 0) grSpec.cheese = grCheese;
        var grZone = (G.activeEvent.zone !== undefined ? G.activeEvent.zone : _goldGameZone) || 0;
        var grPool = LANDING_FLAVOR['gold_z'+(grZone+1)] || LANDING_FLAVOR.gold_z1 || [];
        grFlav = grPool.length ? grPool[Math.floor(Math.random()*grPool.length)] : '';
      }

      // v0.16.2: wrap in outer stage frame matching gray/red/purple/white/
      // black/green pattern. Without this, the gold result card sits
      // ungrounded (no stage frame) compared to other events which have a
      // dark themed outer frame around their resolution card. UNITY: all
      // events share the two-layer visual structure (stage outer + result
      // card inner).
      extra = '<div style="margin-top:10px;padding:14px;background:#1a1200;border:2px solid #F5D00066;border-radius:12px;">'
        + buildResolutionCard({
        themeColor: grTheme,
        borderColor: grTheme + '66',
        bgColor: grBg,
        title: grTitle,
        rewardIcons: renderRewardIcons(grSpec),
        spec: grSpec,
        flavor: grFlav,
        showerTint: grTheme,
        shower: foundAmt2 > 0 || grCheese > 0,
      })
        + '</div>';
    } else if (G.activeEvent && G.activeEvent.goldVariant) {
      // Mini-game ready to launch — render into container after DOM settles
      extra = '<div id="gold-game-container" style="margin-top:10px;"></div>';
      setTimeout(function() {
        if (G.activeEvent && G.activeEvent.goldVariant && !G.activeEvent.goldResult) {
          startGoldEvent(G.activeEvent.goldVariant, G.activeEvent.goldMin||1, G.activeEvent.goldMax||2, G.activeEvent.zone||0);
        }
      }, 50);
    }
  }

  // Blue brick Category B event — interactive memory challenge
  if (ev.type === 'blue' || ev.color === 'blue') {
    var blueVariant = G.activeEvent && G.activeEvent.blueVariant;
    var blueResult = G.activeEvent && G.activeEvent.blueResult;
    if (blueResult) {
      var themeCol = blueResult.success ? '#4db8ff' : '#4db8ffaa';
      var borderC = blueResult.success ? '#4db8ff88' : '#4db8ff44';
      var blueTitle = blueResult.success ? '✨ ARCANE ✨' : '✗ FAILED';
      var msg = blueResult.msg || '';
      var spec = {};
      // Blue brick count
      var blueBrickM = msg.match(/\+(\d+)\s*Blue Brick/i);
      if (blueBrickM) spec.bricks = { blue: parseInt(blueBrickM[1]) };
      // Gold
      var blueGoldM = msg.match(/\+(\d+)\s*Gold/i);
      if (blueGoldM) spec.coins = parseInt(blueGoldM[1]);
      // Shield pip
      if (/shield pip/i.test(msg)) spec.shield = true;
      // HP loss on failure
      var blueHpM = /([\-−])(\d+)\s*HP/i.exec(msg);
      if (blueHpM && !blueResult.success) spec.hp = -parseInt(blueHpM[2]);
      // v4 FW: show lightning charge custom note
      if (blueResult.fwRefreshBuff) {
        spec.custom = '<span style="display:inline-flex;align-items:center;gap:3px;margin:0 4px;padding:2px 6px;background:#0a2035;border:1px solid #4db8ff;border-radius:4px;font-size:11px;color:#4db8ff;">⚡ 2× refresh 10s</span>';
      }
      // Resolve flavor (deterministic seed based on msg length)
      var resolveFKey = (blueVariant||'') + (blueResult.success?'_success':'_fail');
      var resolveFPool = BLUE_RESOLVE_FLAVORS[resolveFKey] || [];
      var resolveSeed = (blueResult.msg||'').length % (resolveFPool.length||1);
      var resolveFlav = resolveFPool.length ? resolveFPool[resolveSeed] : '';

      // v4: FW-only dedicated banner for the Formwright Charge reward
      var fwBanner = '';
      if (blueResult.fwRefreshBuff) {
        var fwFlavPool = [
          'The weave answers the Formwright — next battle the pattern flows twice as fast.',
          'A charge of pure form. Bricks will come eagerly into your next rumble.',
          'The arcane current is yours. Spend it in the next fight.',
          'Formwright\'s charge: the loom of battle will spin at double speed.',
        ];
        var fwSeed = (blueResult.msg||'').length % fwFlavPool.length;
        fwBanner = ''
          + '<div style="margin-top:10px;padding:10px 12px;background:linear-gradient(90deg,#0a2540,#0a1a30);border:1px solid #4db8ff;border-radius:8px;text-align:center;">'
          +   '<div style="font-family:Cinzel,serif;font-size:12px;color:#4db8ff;letter-spacing:.12em;margin-bottom:4px;">⚡ FORMWRIGHT CHARGE ⚡</div>'
          +   '<div style="font-size:11px;color:#aadcff;font-style:italic;line-height:1.4;margin-bottom:4px;">' + fwFlavPool[fwSeed] + '</div>'
          +   '<div style="font-size:10px;color:#7ac7ff;letter-spacing:.04em;">2× brick refresh · first 10 seconds of next rumble</div>'
          + '</div>';
      }

      extra = buildResolutionCard({
        themeColor: themeCol,
        borderColor: borderC,
        bgColor: '#020a14',
        title: blueTitle,
        rewardIcons: renderRewardIcons(spec) || '<span style="color:var(--text-faint);font-size:12px;">—</span>',
        spec: spec,
        flavor: resolveFlav,
        linger: !blueResult.success ? '✨ Arcane energy remains here' : '',
        extra: fwBanner,
        showerTint: '#4db8ff',
      });
    } else if (blueVariant) {
      extra = '<div style="margin-top:10px;padding:12px;background:#020a14;border:2px solid #006DB7;border-radius:12px;">'
        + '<div id="blue-event-container"></div>'
        + '</div>';
    } else {
      extra = '<div style="margin-top:10px;padding:12px;background:#020a14;border:2px solid #006DB7;border-radius:12px;text-align:center;">'
        + '<div style="font-size:12px;color:var(--text-dim);">Arcane energy materializes… DM to resolve</div>'
        + '</div>';
    }
  }

  // Riddle/clue event — show instructions clearly
  if (ev.type === 'riddle') {
    var ae = G.activeEvent;
    var isInitiator = ae && ae.cls === MY_CLASS;
    var YSQUARE = '<span style="width:32px;height:32px;border-radius:5px;background:var(--yellow);display:inline-block;vertical-align:middle;box-shadow:0 2px 8px #F5D00066;"></span>';

    if (ae && ae.riddleWinner) {
      // ── RESULT ──
      var winner = G.players[ae.riddleWinner];
      var winnerName = winner ? (winner.playerName||winner.name) : ae.riddleWinner;
      var iWon = ae.riddleWinner === MY_CLASS;
      var RIDDLE_WIN_FLAVORS = LANDING_FLAVOR.riddle || ['Knowledge has its rewards.'];
      var rFlavSeed = (ae.riddleQ||'').length % (RIDDLE_WIN_FLAVORS.length||1);
      var rFlav = RIDDLE_WIN_FLAVORS[rFlavSeed];
      var RIDDLE_SOLVED_FLAVORS = LANDING_FLAVOR.riddleSolved || ['Knowledge earned is knowledge kept.'];
      var solvedFlav = RIDDLE_SOLVED_FLAVORS[(ae.riddleIdx||0) % RIDDLE_SOLVED_FLAVORS.length];
      var CORRECT_TAGS = ['answered correctly', 'first to the mark', 'sharp mind', 'got there first', 'cracked it'];
      var correctTag = CORRECT_TAGS[(ae.riddleIdx||0) % CORRECT_TAGS.length];
      // v0.15.38: migrate riddle resolution to buildResolutionCard.
      // Winner gets +1 yellow brick (gated behind Collect tap if iWon).
      // Loser sees the same card without spec (no Collect button).
      // Clue payload (if any) lives in `extra` — narrative payload.
      var riddleSpec = iWon ? { bricks: { yellow: 1 } } : null;
      var riddleTheme = iWon ? '#F5D000' : '#888';
      var riddleBorder = iWon ? '#F5D00077' : '#F5D00033';
      var riddleTitle = iWon ? '🏆 ' + correctTag.toUpperCase() : winnerName + ' — ' + correctTag;
      var riddleExtra = '';
      if (ae.pendingClue) {
        var clue = ae.pendingClue.clue;
        var parts = clue.split(/: (.+)/);
        var hasTitle = parts.length > 1;
        var clueTitle = hasTitle ? parts[0] : '';
        var clueBody = hasTitle ? parts[1] : clue;
        riddleExtra = '<div style="margin-top:10px;margin-bottom:6px;padding:10px 14px;background:#0a0a00;border:1px solid #3a3000;border-radius:8px;text-align:center;">'
          + (hasTitle ? '<div style="font-family:Cinzel,serif;font-size:11px;color:#C8A84B;letter-spacing:.12em;font-weight:700;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #3a3000;">'+clueTitle+'</div>' : '')
          + '<div style="font-size:12px;color:#cccc99;line-height:2;">'+clueBody.replace(/\. /g,'.<br>')+'</div>'
          + '</div>';
      }
      extra = buildResolutionCard({
        themeColor: riddleTheme,
        borderColor: riddleBorder,
        bgColor: '#0d0d00',
        title: riddleTitle,
        rewardIcons: iWon ? renderRewardIcons(riddleSpec) : '',
        spec: riddleSpec,
        flavor: solvedFlav,
        extra: riddleExtra,
        showerTint: riddleTheme,
        shower: iWon,
      });

    } else if (ae && ae.riddleActive) {
      // ── ACTIVE — all players see Q + answer buttons ──
      var myAttempts = (ae.riddleWrong && ae.riddleWrong[MY_CLASS]) ? ae.riddleWrong[MY_CLASS] : 0;
      var attemptsLeft = 3 - myAttempts;
      var timeLeft = Math.max(0, ae.riddleEndsAt - Date.now());
      var timePct = Math.round(timeLeft / 300);
      var timerColor = timePct > 50 ? 'var(--green)' : timePct > 25 ? 'var(--yellow)' : 'var(--red)';
      var attemptColor = attemptsLeft >= 3 ? 'var(--green)' : attemptsLeft === 2 ? 'var(--yellow)' : 'var(--red)';
      var RIDDLE_HEADERS = ['ANSWER THE RIDDLE','WHAT AM I?','SPEAK THE ANSWER','NAME IT','THE FORTRESS ASKS','KNOWLEDGE OR SILENCE','ONE CHANCE TO KNOW','WHAT WALKS THESE HALLS?'];
      var Q_COLORS = ['#1D9E75','#F0EED8','#9B6FD4','#E8A23E','#4A9FD4'];
      var BTN_COLORS = ['#FFF8DC','#FFE87C','#E8A23E'];
      var rIdx = (ae.riddleIdx||0);
      var qColor = Q_COLORS[rIdx % Q_COLORS.length];
      var riddleHeader = RIDDLE_HEADERS[(rIdx + 3) % RIDDLE_HEADERS.length];
      var bColor = BTN_COLORS[(rIdx + 1) % BTN_COLORS.length]; // deterministic per riddle
      var optButtons = '';
      var outOfAttempts = attemptsLeft <= 0;
      var attemptLabel = myAttempts > 0 ? '<div style="font-size:10px;color:'+attemptColor+';text-align:right;margin-bottom:8px;font-family:Cinzel,serif;letter-spacing:.04em;">'
        + (outOfAttempts ? 'No attempts remaining — watching only' : attemptsLeft+' attempt'+(attemptsLeft!==1?'s':'')+' left')
        + '</div>' : '';
      optButtons = attemptLabel;
      (ae.riddleOptions||[]).forEach(function(opt) {
        if (outOfAttempts) {
          optButtons += '<button class="btn" disabled style="width:100%;margin-bottom:8px;border-color:#333;color:#444;font-size:15px;padding:12px 14px;background:#0a0a0a;letter-spacing:.02em;opacity:0.4;cursor:not-allowed;">' + opt + '</button>';
        } else {
          optButtons += '<button class="btn" style="width:100%;margin-bottom:8px;border-color:'+bColor+';color:'+bColor+';font-size:15px;padding:12px 14px;background:#0f0d00;letter-spacing:.02em;" '
            + 'onclick="client.riddleAnswer(MY_CLASS,\'' + opt.replace(/'/g,"\\'") + '\')">' + opt + '</button>';
        }
      });
      extra = '<div style="margin-top:10px;background:#0d0d00;border:2px solid var(--yellow);border-radius:12px;overflow:hidden;box-shadow:0 0 18px #F5D00022;">'
        + '<div style="background:#1a1400;height:8px;"><div id="riddle-timer-bar" style="height:100%;width:'+timePct+'%;background:'+timerColor+';transition:width 0.8s linear;box-shadow:0 0 6px '+timerColor+';"></div></div>'
        + '<div style="padding:16px;">'
        + '<div style="font-family:Cinzel,serif;font-size:9px;letter-spacing:.12em;color:var(--yellow);margin-bottom:10px;">' + riddleHeader + '</div>'
        + '<div style="font-size:16px;color:'+qColor+';line-height:1.7;margin-bottom:16px;font-style:italic;padding:12px 14px;background:#0a0900;border-radius:8px;border-left:4px solid var(--yellow);box-shadow:inset 0 0 20px #F5D00008;">\"' + ae.riddleQ + '\"</div>'
        + optButtons
        + '</div>'
        + '</div>';

    } else if (ae && ae.riddleExpired) {
      // ── EXPIRED ──
      var EXPIRED_FLAVORS = [
        'The question fades. The fortress remembers.',
        'No answer. The brick stays where it is.',
        'Silence was the only response.',
        'Time moved faster than the answer.'
      ];
      var expFlav = EXPIRED_FLAVORS[(ae.riddleIdx||0) % EXPIRED_FLAVORS.length];
      // v0.15.38: migrate to buildResolutionCard. No rewards on expiration,
      // so WAITING footer renders (correct — no Collect available).
      extra = buildResolutionCard({
        themeColor: '#888',
        borderColor: '#3a3000',
        bgColor: '#0d0d00',
        title: '⏱ TIME EXPIRED',
        flavor: expFlav,
        showerTint: '#888',
        shower: false,
      });

    } else {
      // ── INITIATE / WAITING ──
      var RIDDLE_FLAVORS = LANDING_FLAVOR.riddle || ['A yellow brick. Something beneath it.'];
      var initFlav = RIDDLE_FLAVORS[(ev.roll||0) % RIDDLE_FLAVORS.length];
      var REVEAL_LABELS = [
        'Lift the Brick',
        'Read What\'s Beneath',
        'Reveal the Riddle',
        'Speak the Question',
        'Turn It Over'
      ];
      var revealLabel = REVEAL_LABELS[Math.floor(Math.random() * REVEAL_LABELS.length)];
      if (isInitiator) {
        extra = '<div style="margin-top:10px;padding:16px 14px;background:#0d0d00;border:2px solid var(--yellow);border-radius:12px;text-align:center;box-shadow:0 0 18px #F5D00022;">'          + '<div style="display:flex;justify-content:center;margin-bottom:12px;">' + YSQUARE + '</div>'          + '<div style="font-size:13px;color:#F5D000bb;font-style:italic;line-height:1.5;margin-bottom:12px;">' + initFlav + '</div>'          + '<div style="font-size:11px;color:var(--text-faint);margin-bottom:14px;">First correct answer wins +1 yellow brick · 3 attempts each</div>'          + '<button class="btn" style="width:100%;font-size:15px;padding:13px;font-family:Cinzel,serif;border-color:var(--yellow);color:var(--yellow);letter-spacing:.06em;" '          + 'onclick="client.startRiddle(MY_CLASS)">' + revealLabel + '</button>'          + '</div>';
      } else {
        extra = '<div style="margin-top:10px;padding:16px 14px;background:#0d0d00;border:2px solid var(--yellow)33;border-radius:12px;text-align:center;">'          + '<div style="display:flex;justify-content:center;margin-bottom:12px;">' + YSQUARE + '</div>'          + '<div style="font-size:13px;color:#F5D000aa;font-style:italic;line-height:1.5;margin-bottom:8px;">' + initFlav + '</div>'          + '<div style="font-size:11px;color:var(--text-faint);margin-bottom:4px;">First correct answer wins +1 yellow brick · 3 attempts each</div>'          + '<div style="font-size:9px;color:var(--text-faint);font-family:Cinzel,serif;letter-spacing:.06em;margin-top:10px;">WAITING FOR ACTIVE PLAYER TO REVEAL</div>'          + '</div>';
      }
    }
  }

  // Trap event — show disarm option for Snapstep, Tap Burst for everyone, damage warning
  if (ev.type === 'trap' || ev.type === 'doubletrap') {
    var me2 = G.players[MY_CLASS];
    var hasGray = (me2 && (me2.bricks.gray||0) > 0);
    var isScout = MY_CLASS === 'snapstep';
    var double = ev.type === 'doubletrap';
    var trapResult = G.activeEvent && G.activeEvent.trapResult;
    if (trapResult) {
      if (trapResult.disarmed) {
        var disarmSpec = { bricks: { orange: 1 } };
        var disarmIcons = renderRewardIcons({ bricks: { orange: 1 }, custom: '<span style="font-size:18px;color:var(--text-dim);margin:0 6px;">(from</span>' + '<span style="width:22px;height:22px;border-radius:3px;background:#AAAAAA;display:inline-block;vertical-align:middle;box-shadow:0 1px 4px rgba(0,0,0,.5);margin:0 2px;"></span><span style="font-size:18px;color:var(--text-dim);">)</span>' });
        extra = buildResolutionCard({
          themeColor: '#9adb9a',
          borderColor: '#9adb9a66',
          bgColor: '#0a1200',
          title: '🔧 DISARMED',
          rewardIcons: disarmIcons,
          spec: disarmSpec,
          flavor: 'Defused. The fortress concedes one brick.',
          showerTint: '#9adb9a',
        });
      } else {
        var dodged = trapResult.dodged || 0;
        var TRAP_FLAVOR_BY_DMG = {
          0: [
            'Fast reflexes.',
            'Not today.',
            'The trap blinked. You didn\'t.',
            'You were already moving.',
            'Clean dodge. The fortress is unimpressed.',
            'You pried a piece loose on the way out.'
          ],
          1: [
            'A glancing blow. You\'ll feel it later.',
            'It grazed you. Could have been worse.',
            'One hit. The floor claims its small victory.',
            'Minor damage. Walk it off.',
            'Just a scratch. The trap is disappointed.'
          ],
          2: [
            'It was always going to happen like this.',
            'Two hits. The fortress is thorough.',
            'The floor had been waiting.',
            'You walked into both of them.',
            'Double tap. The trap was patient.'
          ],
          3: [
            'You found it. Painfully.',
            'Three strikes from the stone.',
            'One wrong step. The fortress collects its toll.',
            'The mechanism was well-designed.',
            'The trap gave no warning. It never does.'
          ],
          4: [
            'The fortress does not forgive impatience.',
            'Four hits. Something snapped.',
            'You triggered everything at once.',
            'The corridor emptied its lungs into you.',
            'Heavy toll. The architects were thorough.'
          ],
          5: [
            'The floor opened and did not stop.',
            'Five. You\'ve been marked by this place.',
            'The trap was old and angry.',
            'Maximum yield. The fortress is satisfied.',
            'Nothing personal. Entirely mechanical.'
          ]
        };
        var dmgKey = Math.min(trapResult.dmg, 5);
        if (dmgKey < 0) dmgKey = 0;
        var trapFlavPool = TRAP_FLAVOR_BY_DMG[dmgKey] || TRAP_FLAVOR_BY_DMG[3];
        var tSeed = (trapResult.dmg + dodged) % trapFlavPool.length;
        var trapFlav = trapFlavPool[tSeed];
        var trapThemeColor = trapResult.dmg === 0 ? '#9adb9a' : '#d44';
        var trapBg = trapResult.dmg === 0 ? '#0a1200' : '#1a0500';
        var dodgedNote = dodged > 0 ? '<div style="font-size:11px;color:#888;margin-bottom:4px;">' + dodged + ' blocked</div>' : '';
        // v4: Perfect dodge (zero dmg) earns +1 orange brick from server
        var trapRewardSpec = trapResult.dmg === 0
          ? (trapResult.cleanEscape ? { bricks: { orange: 1 } } : {})
          : { hp: -trapResult.dmg };
        extra = buildResolutionCard({
          themeColor: trapThemeColor,
          borderColor: trapThemeColor + '88',
          bgColor: trapBg,
          title: trapResult.dmg === 0 ? '✓ DODGED' : '🗡 SPRUNG',
          rewardIcons: renderRewardIcons(trapRewardSpec),
          spec: trapRewardSpec,
          flavor: trapFlav,
          extra: dodgedNote,
          showerTint: trapThemeColor,
          shower: trapResult.dmg === 0, // only shower if dodged
        });
      }
    } else {
      // Snapstep "Disarm Trap" class-action button stripped (S015) along
      // with other class buttons; server `disarmTrap` handler preserved.
      // Future overhaul will route via brick-bar gesture (drag yellow on
      // trapped space). For now traps trigger normally on landing.
      extra = '<div style="margin-top:10px;padding:10px;background:#1a0500;border:2px solid var(--orange);border-radius:12px;">'
        + '<div id="tap-burst-container"></div>'
        + '</div>';
    }
  }

  // v4: PURPLE FATED CHOICE — render when server set purpleVariant
  if ((ev.type === 'purple' || ev.evType === 'purple') && G.activeEvent && G.activeEvent.purpleVariant === 'fated_choice') {
    extra = '<div style="margin-top:10px;padding:14px;background:#1a0a2a;border:2px solid #7B2FBE;border-radius:12px;">'
      + renderPurpleFatedChoice(G.activeEvent, me)
      + '</div>';
  }

  // v4: WHITE PILGRIM'S REST
  if ((ev.type === 'white' || ev.evType === 'white') && G.activeEvent && G.activeEvent.whiteVariant === 'pilgrims_rest') {
    extra = '<div style="margin-top:10px;padding:14px;background:#0a1a1a;border:2px solid #6aaaaa;border-radius:12px;">'
      + renderWhitePilgrimsRest(G.activeEvent, me, G)
      + '</div>';
  }

  // v4: BLACK SHADOW BARGAIN
  if ((ev.type === 'black' || ev.evType === 'black') && G.activeEvent && G.activeEvent.blackVariant === 'shadow_bargain') {
    extra = '<div style="margin-top:10px;padding:14px;background:#0a0a0a;border:2px solid #333;border-radius:12px;">'
      + renderBlackShadowBargain(G.activeEvent, me, G)
      + '</div>';
  }

  // v4: GREEN VINE PATH
  if ((ev.type === 'green' || ev.evType === 'green') && G.activeEvent && G.activeEvent.greenVariant === 'vine_path') {
    extra = '<div style="margin-top:10px;padding:14px;background:#061508;border:2px solid #5a8a5a;border-radius:12px;">'
      + renderGreenVinePath(G.activeEvent, me, G)
      + '</div>';
  }

  // v4: RED TRIAL OF HAND
  if ((ev.type === 'red' || ev.evType === 'red') && G.activeEvent && G.activeEvent.redVariant === 'trial_of_hand') {
    extra = '<div style="margin-top:10px;padding:14px;background:#1a0505;border:2px solid #8a4a4a;border-radius:12px;">'
      + renderRedTrialOfHand(G.activeEvent, me, G)
      + '</div>';
  } else if (ev.type === 'red' || ev.evType === 'red') {
  }

  // v4: GRAY RUBBLE STACKING
  if ((ev.type === 'gray' || ev.evType === 'gray') && G.activeEvent && G.activeEvent.grayVariant === 'rubble_stacking') {
    extra = '<div style="margin-top:10px;padding:14px;background:#0a0a0a;border:2px solid #666;border-radius:12px;">'
      + renderGrayRubbleStacking(G.activeEvent, me, G)
      + '</div>';
  } else if (ev.type === 'gray' || ev.evType === 'gray') {
  }

  // v0.16.2: RUMBLE result card. After rumble ends, server credits loot
  // automatically (see server.js battleEnd handler ~line 988). Player view
  // shows an informational card with outcome + summary stats. Inventory chip
  // values pulse via _detectInvIncreasesAndPulse on the next render — no
  // Collect button, no drain. DM's "Mark Resolved" only advances the turn.
  if ((ev.evType === 'monster' || ev.evType === 'boss') && G.activeEvent && G.activeEvent.rumbleResult) {
    var rr = G.activeEvent.rumbleResult;
    var bs = rr.battleStats || {};
    var rTitle, rTheme, rBg, rFlavor;
    if (rr.victor === rr.cls) {
      // Player won
      rTitle = (ev.evType === 'boss') ? '🏆 BOSS DEFEATED' : '⚔ VICTORY';
      rTheme = '#9adb9a';
      rBg = '#0a1a0a';
      var enemiesK = (bs.enemiesKilled && bs.enemiesKilled.length) || 0;
      rFlavor = enemiesK > 0
        ? 'Steel rang. The path opens.'
        : 'The battle is yours.';
    } else if (rr.victor === 'enemy') {
      rTitle = '✗ DEFEATED';
      rTheme = '#d66';
      rBg = '#1a0808';
      rFlavor = rr.playerDied
        ? 'You fell. The page turns.'
        : 'Driven back. Lick your wounds.';
    } else if (rr.reason === 'timeout') {
      rTitle = '⊘ TIMEOUT';
      rTheme = '#aaa';
      rBg = '#141414';
      rFlavor = 'The clock ran out. Standoff.';
    } else if (rr.reason === 'force-quit' || rr.reason === 'dm_force_quit') {
      rTitle = '⊘ BATTLE ENDED';
      rTheme = '#aaa';
      rBg = '#141414';
      rFlavor = 'The DM called it.';
    } else {
      rTitle = '⊘ BATTLE OVER';
      rTheme = '#aaa';
      rBg = '#141414';
      rFlavor = '';
    }
    // Build a small stats line — what was looted, how the fight went
    var statsBits = [];
    if (bs.damageDealt > 0) statsBits.push(bs.damageDealt + ' dmg dealt');
    if (bs.damageTaken > 0) statsBits.push(bs.damageTaken + ' taken');
    if (bs.critsLanded > 0) statsBits.push(bs.critsLanded + ' crit' + (bs.critsLanded > 1 ? 's' : ''));
    var statsLine = statsBits.length
      ? '<div style="font-size:11px;color:var(--text-faint);letter-spacing:.04em;margin-top:6px;">' + statsBits.join(' · ') + '</div>'
      : '';
    // Loot summary (informational — actual credit already happened, chips pulse)
    var lootBits = [];
    if (bs.bricksGained && typeof bs.bricksGained === 'object') {
      Object.keys(bs.bricksGained).forEach(function(c) {
        var n = bs.bricksGained[c] || 0;
        if (n > 0) lootBits.push('+' + n + ' ' + c);
      });
    }
    if (bs.goldGained > 0) lootBits.push('+' + bs.goldGained + ' 🪙');
    var lootLine = lootBits.length
      ? '<div style="font-size:12px;color:var(--text-dim);margin-top:6px;">looted: ' + lootBits.join(', ') + '</div>'
      : '';
    extra = '<div style="margin-top:10px;padding:14px;background:'+rBg+';border:2px solid '+rTheme+'66;border-radius:12px;">'
      + buildResolutionCard({
          themeColor: rTheme,
          borderColor: rTheme + '66',
          bgColor: rBg,
          title: rTitle,
          flavor: rFlavor,
          extra: statsLine + lootLine,
          showerTint: rTheme,
          shower: rr.victor === rr.cls,
          // No spec — auto-credit already happened, no Collect button.
        })
      + '</div>';
  }

  // Brick square color mapping
  var evColor = ev.color || ev.type;
  var brickBg = {
    blue:'#006DB7', gray:'#AAAAAA', white:'#EFEFEF', orange:'#F57C00',
    purple:'#7B2FBE', yellow:'#F5D000', red:'#D01012', green:'#237841'
  }[evColor] || null;
  var brickBorder = evColor === 'white' ? 'border:1px solid #ccc;' : '';
  var brickSquare = brickBg
    ? '<span class="event-icon-origin" style="width:52px;height:52px;border-radius:8px;background:'+brickBg+';'+brickBorder+'display:inline-block;box-shadow:0 2px 10px '+brickBg+'66;margin-bottom:8px;"></span>'
    : '<span class="event-icon-origin" style="font-size:42px;display:inline-block;">' + (ev.icon||'?') + '</span>';

  var flavorLine = getLandingFlavor(ev.type, ev.color, zone);

  // If extra is a self-contained result card, skip the outer header to avoid redundancy
  var alreadyChoseBlue = (ev.type === 'blue' || ev.color === 'blue') && G.activeEvent && (G.activeEvent.blueResult || G.activeEvent.blueVariant);
  var alreadyRiddle = ev.type === 'riddle';
  var alreadyTrap = ev.type === 'trap' || ev.type === 'doubletrap';
  var alreadyGold = (ev.type === 'gold') && G.activeEvent && (G.activeEvent.goldResult || G.activeEvent.goldVariant);
  var alreadyPurple = (ev.type === 'purple' || ev.evType === 'purple') && G.activeEvent && G.activeEvent.purpleVariant === 'fated_choice';
  var alreadyWhite = (ev.type === 'white' || ev.evType === 'white') && G.activeEvent && G.activeEvent.whiteVariant === 'pilgrims_rest';
  var alreadyBlack = (ev.type === 'black' || ev.evType === 'black') && G.activeEvent && G.activeEvent.blackVariant === 'shadow_bargain';
  var alreadyGreen = (ev.type === 'green' || ev.evType === 'green') && G.activeEvent && G.activeEvent.greenVariant === 'vine_path';
  var alreadyRed = (ev.type === 'red' || ev.evType === 'red') && G.activeEvent && G.activeEvent.redVariant === 'trial_of_hand';
  var alreadyGrayRubble = (ev.type === 'gray' || ev.evType === 'gray') && G.activeEvent && G.activeEvent.grayVariant === 'rubble_stacking';
  // v0.16.2: rumble result card (monster/boss with rumbleResult) is self-
  // contained — hide the brick-square header for the same reason as other
  // dispatched events.
  var alreadyRumble = (ev.evType === 'monster' || ev.evType === 'boss') && G.activeEvent && G.activeEvent.rumbleResult;
  var hideHeader = alreadyChoseBlue || alreadyRiddle || alreadyTrap || alreadyGold || alreadyPurple || alreadyWhite || alreadyBlack || alreadyGreen || alreadyRed || alreadyGrayRubble || alreadyRumble;

  el.innerHTML = '<div class="roll-display" style="margin-top:8px;text-align:center;">'
    + (!hideHeader ? '<div style="display:flex;justify-content:center;margin-bottom:6px;">' + brickSquare + '</div>' : '')
    + (!hideHeader ? '<div style="font-size:13px;color:var(--text-dim);font-style:italic;line-height:1.6;margin-bottom:10px;padding:0 8px;">' + flavorLine + '</div>' : '')
    + extra
    + '</div>';
  if ((ev.type === 'trap' || ev.type === 'doubletrap') && !(G.activeEvent && G.activeEvent.trapResult)) {
    var trapCount = (G.activeEvent && G.activeEvent.trapCount) || (ev.type === 'doubletrap' ? 2 : 1);
    setTimeout(function() { startTapBurst(trapCount); }, 400);
  }
  // Launch blue Category B event
  if ((ev.type === 'blue' || ev.color === 'blue') && G.activeEvent && G.activeEvent.blueVariant && !G.activeEvent.blueResult) {
    setTimeout(function() { startBlueEvent(G.activeEvent.blueVariant, G.activeEvent.isWizard); }, 400);
  }
  // Start result shower if blue result just arrived
  if ((ev.type === 'blue' || ev.color === 'blue') && G.activeEvent && G.activeEvent.blueResult) {
    setTimeout(startResultShower, 100);
  }
  // v4: Launch GREEN vine path minigame
  if ((ev.type === 'green' || ev.evType === 'green') && G.activeEvent && G.activeEvent.greenVariant === 'vine_path' && !G.activeEvent.greenResult) {
    setTimeout(startGreenVinePath, 400);
  }
  // v4: Launch GRAY rubble stacking minigame
  if ((ev.type === 'gray' || ev.evType === 'gray') && G.activeEvent && G.activeEvent.grayVariant === 'rubble_stacking' && !G.activeEvent.grayRubbleResult) {
    setTimeout(startGrayRubble, 400);
  }
}


// ── TAP BURST MINI-GAME ──
var _tapBurstActive = false;
var _tapBurstHits = 0;
var _tapBurstMoveTimeout = null;
var _tapBurstInterval = null;
var _tapBurstLastQuad = -1;
var TAP_ESCAPE_MS = 565;
var _tapBurstTrapCount = 1;
var _tapBurstActive = false;
var _tapBurstHits = 0;
var _tapBurstMoveTimeout = null;
var _tapBurstInterval = null;
var _tapBurstLastQuad = -1;
var _tapBurstDistractInterval = null;

var TRAP_THEMES = [
  { name:'Pressure Plate',  btn:'DODGE!',  distracts:['PRESS!','CLICK!','SNAP!','TOO SLOW!','CRUNCH!'] },
  { name:'Tripwire',        btn:'JUMP!',   distracts:['WIRE!','SNAP!','TOO LATE!','DUCK!','TWANG!'] },
  { name:'Dart Wall',       btn:'DODGE!',  distracts:['INCOMING!','DART!','MOVE!','WATCH OUT!','WHIZ!'] },
  { name:'Swinging Blade',  btn:'DUCK!',   distracts:['SWING!','BLADE!','DOWN!','DANGER!','SLASH!'] },
  { name:'Floor Spikes',    btn:'JUMP!',   distracts:['SPIKES!','UP!','RISE!','MOVE!','JUMP!'] },
  { name:'Arrow Slit',      btn:'DODGE!',  distracts:['ARROW!','FIRE!','DUCK!','INCOMING!','LOOSE!'] },
  { name:'Cave-In',         btn:'RUN!',    distracts:['RUBBLE!','MOVE!','RUN!','ABOVE!','CRASH!'] },
  { name:'Fire Jet',        btn:'RUN!',    distracts:['FIRE!','HOT!','FLAMES!','BURN!','HEAT!'] },
];

var _currentTrap = null;

function startTapBurst(trapCount) {
  _tapBurstTrapCount = trapCount || 1;
  _currentTrap = TRAP_THEMES[Math.floor(Math.random() * TRAP_THEMES.length)];
  var needed = _tapBurstTrapCount * 9;
  var secs = _tapBurstTrapCount * 5;
  var container = document.getElementById('tap-burst-container');
  if (!container) return;

  var trapLabel = _tapBurstTrapCount === 1 ? '' : _tapBurstTrapCount === 2 ? 'DOUBLE ' : _tapBurstTrapCount + '× ';
  container.innerHTML =
    '<div style="text-align:center;padding:16px 12px;">'
    + '<div style="font-family:Cinzel,serif;font-size:15px;color:var(--orange);margin-bottom:6px;">'
    + '⚠' + ('⚠'.repeat(Math.min(_tapBurstTrapCount-1,2))) + ' ' + trapLabel + _currentTrap.name.toUpperCase() + '!'
    + '</div>'
    + '<div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;line-height:1.6;">'
    + 'Tap the target <strong style="color:var(--orange);">' + needed + ' times</strong> in ' + secs + 's<br>'
    + 'Every 3 hits blocks 1 damage — <strong style="color:var(--red);">' + (_tapBurstTrapCount*3) + ' damage</strong> total'
    + '</div>'
    + '<button class="btn warn" style="width:100%;font-size:18px;font-weight:700;padding:14px;font-family:Cinzel,serif;letter-spacing:.08em;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;" onclick="launchTapBurst()">'
    + '⚡ ' + _currentTrap.btn
    + '</button>'
    + '</div>';
}

function launchTapBurst() {
  var trapCount = _tapBurstTrapCount;
  var trap = _currentTrap || TRAP_THEMES[0];
  var NEEDED = trapCount * 9;
  var TOTAL_MS = trapCount * 5000;
  var container = document.getElementById('tap-burst-container');
  if (!container) return;
  _tapBurstActive = true;
  _tapBurstHits = 0;
  _tapBurstLastQuad = -1;
  var startTime = Date.now();
  var AW = 280, PAD = 32;

  container.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">'
    + '<div style="font-size:11px;color:var(--orange);font-family:Cinzel,serif;letter-spacing:.06em;">' + trap.name.toUpperCase() + '!</div>'
    + '<div id="tap-hits-display" style="font-size:16px;font-weight:700;color:var(--orange);">0 / ' + NEEDED + '</div>'
    + '</div>'
    + '<div style="height:6px;border-radius:3px;background:#2a1a0a;margin-bottom:4px;overflow:hidden;">'
    + '<div id="tap-timer-bar" style="height:100%;background:var(--orange);border-radius:3px;width:100%;"></div>'
    + '</div>'
    + '<div style="font-size:10px;color:var(--text-faint);margin-bottom:5px;text-align:right;">3 hits = −1 damage</div>'
    + '<div id="tap-arena" style="position:relative;width:100%;height:185px;background:#1a0505;border:2px solid var(--orange);border-radius:10px;overflow:hidden;touch-action:none;user-select:none;"></div>';

  var arena = document.getElementById('tap-arena');
  if (!arena) return;

  // Distraction words
  var distractWords = trap.distracts;
  clearInterval(_tapBurstDistractInterval);
  _tapBurstDistractInterval = setInterval(function() {
    if (!_tapBurstActive || !arena) return;
    var old = arena.querySelectorAll('.distract-word');
    if (old.length > 2) return; // max 2 at a time
    var word = distractWords[Math.floor(Math.random()*distractWords.length)];
    var el = document.createElement('div');
    el.className = 'distract-word';
    var arenaW = arena.offsetWidth || 280;
    var x = 20 + Math.random() * (arenaW - 80);
    var y = 20 + Math.random() * 140;
    el.style.cssText = 'position:absolute;left:'+x+'px;top:'+y+'px;'
      + 'font-family:Cinzel,serif;font-size:14px;font-weight:700;color:#cc3333;'
      + 'pointer-events:none;opacity:1;transition:opacity .6s;z-index:1;';
    el.textContent = word;
    arena.appendChild(el);
    setTimeout(function(){ el.style.opacity='0'; setTimeout(function(){ if(el.parentNode) el.remove(); }, 650); }, 600);
  }, 700);

  function getNewPos() {
    var quads = [0,1,2,3].filter(function(q){ return q !== _tapBurstLastQuad; });
    var q = quads[Math.floor(Math.random()*quads.length)];
    _tapBurstLastQuad = q;
    var hw = AW/2, hh = 92;
    var x = (q%2===0 ? PAD : hw+PAD) + Math.random()*Math.max(1, hw-PAD*2);
    var y = (q<2 ? PAD : hh+PAD) + Math.random()*Math.max(1, hh-PAD*2);
    return {x: Math.round(x), y: Math.round(y)};
  }

  function spawnTarget() {
    if (!_tapBurstActive) return;
    var old = arena.querySelector('.tap-target');
    if (old) old.remove();
    var pos = getNewPos();
    var target = document.createElement('div');
    target.className = 'tap-target';
    target.style.cssText = 'position:absolute;width:52px;height:52px;border-radius:50%;'
      + 'background:#E8610A;'
      + 'box-shadow:0 0 12px 3px #E8610A66;'
      + 'cursor:pointer;z-index:2;'
      + 'left:'+pos.x+'px;top:'+pos.y+'px;transform:translate(-50%,-50%);'
      + 'animation:target-pop .14s ease-out forwards;';
    var fired = false;
    function hitHandler(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!_tapBurstActive || fired) return;
      fired = true;
      clearTimeout(_tapBurstMoveTimeout);
      var ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;border-radius:50%;border:3px solid #E8610A;'
        + 'pointer-events:none;left:'+pos.x+'px;top:'+pos.y+'px;transform:translate(-50%,-50%);'
        + 'animation:hit-ring .35s ease-out forwards;width:52px;height:52px;z-index:2;';
      arena.appendChild(ring);
      setTimeout(function(){ if(ring.parentNode) ring.remove(); }, 380);
      _tapBurstHits++;
      var disp = document.getElementById('tap-hits-display');
      if (disp) {
        disp.textContent = _tapBurstHits + ' / ' + NEEDED;
        disp.style.color = _tapBurstHits >= NEEDED ? 'var(--green)' : _tapBurstHits >= Math.floor(NEEDED*2/3) ? 'var(--yellow)' : 'var(--orange)';
      }
      target.remove();
      if (_tapBurstHits >= NEEDED) { finishTapBurst(true); }
      else { setTimeout(spawnTarget, 90); }
    }
    target.addEventListener('click', hitHandler);
    target.addEventListener('touchstart', hitHandler, {passive:false});
    arena.appendChild(target);
    clearTimeout(_tapBurstMoveTimeout);
    _tapBurstMoveTimeout = setTimeout(function() {
      if (_tapBurstActive && !fired) spawnTarget();
    }, TAP_ESCAPE_MS);
  }

  _tapBurstInterval = setInterval(function() {
    var elapsed = Date.now() - startTime;
    var pct = Math.max(0, 100 - (elapsed / TOTAL_MS * 100));
    var bar = document.getElementById('tap-timer-bar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background = pct > 55 ? 'var(--orange)' : pct > 22 ? 'var(--yellow)' : 'var(--red)';
      bar.style.transition = 'none';
    }
    if (elapsed >= TOTAL_MS) finishTapBurst(false);
  }, 33);

  function finishTapBurst(success) {
    if (!_tapBurstActive) return;
    _tapBurstActive = false;
    clearInterval(_tapBurstInterval);
    clearInterval(_tapBurstDistractInterval);
    clearTimeout(_tapBurstMoveTimeout);
    var old = arena.querySelector('.tap-target');
    if (old) old.remove();
    var blocked = Math.floor(_tapBurstHits / 3);
    client.resolveEvent(MY_CLASS, 'trapDodge', { dodged: blocked });
    var maxDmg = trapCount * 3;
    var remaining = Math.max(0, maxDmg - blocked);
    var msg;
    if (success) {
      msg = '<div style="font-family:Cinzel,serif;font-size:18px;color:var(--green);margin-bottom:4px;">⚡ ' + trap.name + ' evaded!</div>'
          + '<div style="font-size:12px;color:var(--text-dim);">Full ' + maxDmg + ' damage blocked!</div>';
    } else if (blocked > 0) {
      msg = '<div style="font-family:Cinzel,serif;font-size:18px;color:var(--yellow);margin-bottom:4px;">🎯 ' + _tapBurstHits + ' / ' + NEEDED + ' hits</div>'
          + '<div style="font-size:12px;color:var(--text-dim);">' + blocked + ' damage blocked — ' + remaining + ' damage through.</div>';
    } else {
      msg = '<div style="font-family:Cinzel,serif;font-size:18px;color:var(--red);margin-bottom:4px;">💥 ' + trap.name + ' hits!</div>'
          + '<div style="font-size:12px;color:var(--text-dim);">Full ' + maxDmg + ' damage incoming.</div>';
    }
    container.innerHTML = '<div style="text-align:center;padding:14px;background:#0a0a0a;border-radius:10px;border:1px solid #333;">' + msg + '</div>';
  }

  setTimeout(function() {
    AW = arena.offsetWidth || 280;
    spawnTarget();
  }, 80);
}

// ── BLUE BRICK EVENTS — CATEGORY B (Memory & Sequence) ──

var BLUE_FLAVORS = {
  singing_stone: [
    'A weathered stone hums with stored energy — it responds to rhythm.',
    'The corridor walls seem to breathe. Something in the stone is listening.',
    'Three tones, low to high — the old guard used these to lock their vaults.'
  ],
  sentry_stone: [
    'A carved stone floats at chest height, its single eye scanning the corridor.',
    'The old guards used these — enchanted watchers that never sleep.',
    'It drifts slowly, watching. One eye. It never blinks unless you wait for it.'
  ],
  cipher_lock: [
    'Four runes scratched into the floor — they rearrange themselves as you watch.',
    'Old cipher work. The center rune is the key. Watch carefully.',
    'The fortress sealed its secrets. One rune holds still while the others dance.'
  ]
};

// Resolve flavor — shown on result card, keyed by variant + success/fail
var BLUE_RESOLVE_FLAVORS = {
  singing_stone_success: [
    'The stone remembers. So do you.',
    'The rhythm was always yours to find.',
    'It sang. You answered. The corridor listened.',
    'Perfectly tuned.'
  ],
  singing_stone_fail: [
    'The sequence dissolves into silence.',
    'One note off. The stone goes cold.',
    'It remembers better than you did.',
    'The tune was never quite right.'
  ],
  sentry_stone_success: [
    'Patience rewarded.',
    'You moved through the dark without being seen.',
    'It blinked. You were ready.',
    'The eye closed. You were faster.'
  ],
  sentry_stone_fail: [
    'It saw everything.',
    'One wrong moment. The eye was open.',
    'The stone does not forgive impatience.',
    'Caught.'
  ],
  cipher_lock_success: [
    'The still rune was always there. You just had to look.',
    'Clarity in chaos.',
    'One rune that did not move. Now yours.',
    'You saw what the others missed.'
  ],
  cipher_lock_fail: [
    'The runes scatter. The lock holds.',
    'Too many to track. The cipher resets.',
    'The wrong rune. The fortress keeps its secret.',
    'Close. Not close enough.'
  ]
};

function startBlueEvent(variant, isWizard) {
  var container = document.getElementById('blue-event-container');
  if (!container) return;

  var variantNames = { singing_stone:'The Singing Stone', sentry_stone:'The Sentry Stone', cipher_lock:'The Cipher Lock' };

  // Concise one-line mechanic descriptions
  var mechanics = {
    singing_stone: 'Hear the tones. Tap them back in order.',
    sentry_stone:  'Tap the stone when the eye closes (—).',
    cipher_lock:   'One rune holds still. Find it after they rearrange.'
  };

  // Success reward icons — brick + bonus per variant
  // Formwright gets 2 bricks on success
  var brickCount = isWizard ? 2 : 1;
  var BSQUARE = '<span style="width:20px;height:20px;border-radius:3px;background:#006DB7;display:inline-block;vertical-align:middle;box-shadow:0 1px 4px rgba(0,0,0,.5);margin:0 1px;"></span>';
  var brickIcons = BSQUARE.repeat(brickCount);

  var bonusIcon = {
    singing_stone: '<span style="font-size:18px;line-height:1;display:inline-block;vertical-align:middle;">🪙</span>',
    sentry_stone:  '<span style="font-size:16px;vertical-align:middle;">🛡</span>',
    cipher_lock:   '<span style="font-size:18px;line-height:1;display:inline-block;vertical-align:middle;">🪙</span>'
  }[variant] || '';

  var flavor = BLUE_FLAVORS[variant] || ['The magic stirs…'];
  var flavorText = flavor[Math.floor(Math.random()*flavor.length)];

  // Particle canvas for gentle shower behind content
  var wizardBadge = isWizard
    ? '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#0a0a1a;border:1px solid #F5D00088;border-radius:20px;margin-bottom:10px;">'
      + '<span style="font-size:14px;">🔮</span>'
      + '<span style="font-family:Cinzel,serif;font-size:10px;color:#F5D000;letter-spacing:.06em;">FORMWRIGHT +2 BRICKS</span>'
      + '</div>'
    : '';

  container.innerHTML =
    '<div style="position:relative;padding:14px 10px;overflow:hidden;">'
    + '<canvas id="ready-particles" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.35;"></canvas>'
    + '<div style="position:relative;z-index:1;">'

    // Variant name
    + '<div style="font-family:Cinzel,serif;font-size:16px;color:#4db8ff;margin-bottom:6px;text-align:center;">✨ ' + (variantNames[variant]||variant) + '</div>'

    // Formwright badge if applicable
    + '<div style="text-align:center;">' + wizardBadge + '</div>'

    // Flavor text — brief, italic
    + '<div style="font-size:12px;color:var(--text-dim);font-style:italic;text-align:center;margin-bottom:12px;line-height:1.5;">' + flavorText + '</div>'

    // Mechanic — one line
    + '<div style="font-size:12px;color:#4db8ffcc;text-align:center;margin-bottom:14px;">' + (mechanics[variant]||'') + '</div>'

    // Success reward icons — no text labels, just icons
    + '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;padding:8px;background:#020a14;border-radius:10px;border:1px solid #1a4a7a44;">'
    + '<span style="font-size:10px;color:#4db8ff66;font-family:Cinzel,serif;letter-spacing:.04em;">SUCCESS</span>'
    + '<span style="font-size:10px;color:#1a4a7a;">│</span>'
    + brickIcons
    + '<span style="font-size:22px;">' + bonusIcon + '</span>'
    + '</div>'

    // Ready button
    + '<button class="btn" style="width:100%;font-size:15px;padding:13px;font-family:Cinzel,serif;border-color:#006DB7;color:#4db8ff;letter-spacing:.06em;" '
    + 'id="blue-ready-btn" onclick="launchBlueEvent()">✨ Begin</button>'

    + '</div>'
    + '</div>';

  // Gentle particle shower
  var pc = document.getElementById('ready-particles');
  if (pc) {
    pc.width = pc.offsetWidth || 280;
    pc.height = pc.offsetHeight || 200;
    var pctx = pc.getContext('2d');
    var showerParticles = [];
    for (var i = 0; i < 40; i++) {
      showerParticles.push({
        x: Math.random()*pc.width, y: Math.random()*pc.height*2 - pc.height,
        vy: 0.3 + Math.random()*0.5, vx: (Math.random()-.5)*0.3,
        size: 1 + Math.random()*1.5, life: Math.random()
      });
    }
    var showerFrame;
    function drawShower() {
      if (!document.getElementById('ready-particles')) { cancelAnimationFrame(showerFrame); return; }
      pctx.clearRect(0, 0, pc.width, pc.height);
      showerParticles.forEach(function(p) {
        p.y += p.vy; p.x += p.vx; p.life -= 0.003;
        if (p.y > pc.height || p.life <= 0) { p.y = -5; p.x = Math.random()*pc.width; p.life = 0.6+Math.random()*0.4; }
        pctx.save();
        pctx.globalAlpha = Math.max(0, p.life);
        pctx.fillStyle = '#4db8ff';
        pctx.shadowColor = '#4db8ff';
        pctx.shadowBlur = 4;
        pctx.beginPath(); pctx.arc(p.x, p.y, p.size, 0, Math.PI*2); pctx.fill();
        pctx.restore();
      });
      showerFrame = requestAnimationFrame(drawShower);
    }
    drawShower();
  }

  window._blueEventVariant = variant;
  window._blueEventIsWizard = isWizard;
}

function launchBlueEvent() {
  var variant = window._blueEventVariant;
  var isWizard = window._blueEventIsWizard;
  var container = document.getElementById('blue-event-container');
  if (!container) return;
  var btn = document.getElementById('blue-ready-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Beginning…'; }
  var flavor = BLUE_FLAVORS[variant] || ['The magic stirs…'];
  var flavorText = flavor[Math.floor(Math.random()*flavor.length)];
  var extraTime = isWizard ? 1000 : 0;
  setTimeout(function() {
    if (variant === 'singing_stone') startSingingStone(container, flavorText, isWizard, extraTime);
    else if (variant === 'sentry_stone') startSentryStone(container, flavorText, isWizard, extraTime);
    else if (variant === 'cipher_lock') startCipherLock(container, flavorText, isWizard, extraTime);
  }, 200);
}

function startResultShower(tintColor) {
  var pc = document.getElementById('result-shower');
  if (!pc) return;
  pc.width = pc.offsetWidth || 280;
  pc.height = pc.offsetHeight || 120;
  var pctx = pc.getContext('2d');
  var tint = tintColor || '#4db8ff';
  var showerParticles = [];
  for (var i = 0; i < 35; i++) {
    showerParticles.push({
      x: Math.random()*pc.width, y: Math.random()*pc.height*2 - pc.height,
      vy: 0.4+Math.random()*0.6, vx: (Math.random()-.5)*0.4,
      size: 1+Math.random()*1.5, life: Math.random()*0.8+0.2
    });
  }
  var sf;
  function drawResultShower() {
    if (!document.getElementById('result-shower')) { cancelAnimationFrame(sf); return; }
    pctx.clearRect(0, 0, pc.width, pc.height);
    showerParticles.forEach(function(p) {
      p.y += p.vy; p.x += p.vx; p.life -= 0.004;
      if (p.y > pc.height || p.life <= 0) { p.y = -4; p.x = Math.random()*pc.width; p.life = 0.5+Math.random()*0.5; }
      pctx.save();
      pctx.globalAlpha = Math.max(0, p.life);
      pctx.fillStyle = tint;
      pctx.shadowColor = tint; pctx.shadowBlur = 4;
      pctx.beginPath(); pctx.arc(p.x, p.y, p.size, 0, Math.PI*2); pctx.fill();
      pctx.restore();
    });
    sf = requestAnimationFrame(drawResultShower);
  }
  drawResultShower();
}

function finishBlueEvent(success, bonus, msg) {
  // Store result on activeEvent so it persists through re-renders
  if (G.activeEvent) G.activeEvent.blueResult = { success, msg };
  client.resolveEvent(MY_CLASS, success ? 'blueEventComplete' : 'blueEventFail', {
    success, bonus: bonus||null, penalty: success ? null : (bonus||null)
  });
}

// ── THE SINGING STONE ──
// Three colored bars flash in sequence. Tap them back in order.
// ── WEB AUDIO HELPERS ──
var _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

// Ethereal tone: frequency, duration ms, type
function playEtherealTone(freq, durMs, type) {
  try {
    var ctx = getAudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var reverb = ctx.createConvolver ? null : null; // skip reverb for simplicity
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.002, ctx.currentTime + durMs/1000);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs/1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durMs/1000);
    // Second harmonic for richness
    var osc2 = ctx.createOscillator();
    var gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.01, ctx.currentTime);
    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs/1000 * 0.8);
    osc2.start(ctx.currentTime); osc2.stop(ctx.currentTime + durMs/1000);
  } catch(e) { /* audio not available */ }
}

// Stone tone frequencies: LOW=220Hz, MID=330Hz, HIGH=440Hz (ethereal minor)
var STONE_FREQS = [220, 330, 440];
var STONE_COLORS = ['#cc4444','#4db8ff','#44cc88'];
var STONE_LABELS = ['LOW','MID','HIGH'];

// ── THE SINGING STONE ──
// Plays tones with particles — no visual label during sequence. Player inputs via LOW/MID/HIGH buttons.
function startSingingStone(container, flavor, isWizard, extraTime) {
  var TONE_DUR = Math.round((900 + extraTime) * 1.25);
  var GAP = 320;
  var seqLen = 3 + Math.floor(Math.random() * 3); // 3-5
  var sequence = [];
  for (var i = 0; i < seqLen; i++) sequence.push(Math.floor(Math.random() * 3));
  var playerSeq = [];
  var inputLocked = true;
  // 1% tinted: LOW=red, MID=yellow, HIGH=green
  var TONE_TINT = ['#ff4444','#ffcc00','#44cc88'];

  container.innerHTML =
    '<div style="font-size:11px;color:#4db8ff;text-align:center;margin-bottom:6px;font-family:Cinzel,serif;letter-spacing:.05em;">LISTEN TO THE SEQUENCE</div>'
    + '<div style="font-size:11px;color:var(--text-faint);text-align:center;margin-bottom:8px;font-style:italic;">' + flavor + '</div>'
    + '<div id="stone-canvas-wrap" style="position:relative;width:100%;height:100px;background:#020a14;border-radius:10px;border:1px solid #1a4a7a;overflow:hidden;margin-bottom:8px;">'
    + '<canvas id="stone-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>'
    + '</div>'
    + '<div id="stone-status" style="font-size:11px;color:var(--text-faint);text-align:center;margin-bottom:8px;">Listen…</div>'
    + '<div id="stone-buttons" style="display:flex;gap:6px;opacity:.25;pointer-events:none;">'
    + STONE_LABELS.map(function(lbl,i){ return '<button id="stone-btn-'+i+'" style="flex:1;padding:12px 4px;border-radius:8px;background:#ffffff11;border:2px solid #ffffff22;font-family:Cinzel,serif;font-size:12px;color:#aaaaaa;letter-spacing:.04em;cursor:pointer;" onclick="onStoneBtnTap('+i+')">'+lbl+'</button>'; }).join('')
    + '</div>'
    + '<div id="stone-progress" style="display:flex;gap:4px;justify-content:center;margin-top:8px;">'
    + sequence.map(function(_,i){ return '<div id="stone-dot-'+i+'" style="width:10px;height:10px;border-radius:50%;background:#0a2a4a;border:1px solid #1a4a7a;transition:background .2s;"></div>'; }).join('')
    + '</div>';

  var canvas = document.getElementById('stone-canvas');
  var particles = [];
  var animFrame = null;
  var currentToneIdx = -1; // which tone is playing
  var toneStartTime = 0;

  function resizeCanvas() { if (!canvas) return; canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; }
  resizeCanvas();

  // Spawn: 99% white, 1% tone-tinted
  // fadePct: 0=fade in, 1=fully visible, fades out as tone ends
  function spawnParticles(toneIdx, fadePct) {
    if (!canvas) return;
    var W = canvas.width, H = canvas.height;
    for (var i = 0; i < 22; i++) {
      var isTinted = Math.random() < 0.01;
      var x = W * 0.05 + Math.random() * W * 0.9;
      var y = H * 0.05 + Math.random() * H * 0.9;
      var angle = Math.random() * Math.PI * 2;
      var spd = 0.3 + Math.random() * 1.4;
      particles.push({
        x:x, y:y,
        vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd,
        life: fadePct, // start at fade pct so they fade in/out with tone
        decay: 0.009 + Math.random()*0.009,
        size: 1.5 + Math.random()*2.5,
        color: isTinted && toneIdx >= 0 ? TONE_TINT[toneIdx] : '#ffffff',
        alpha: fadePct
      });
    }
  }

  function drawParticles() {
    if (!canvas) return;
    var ctx2 = canvas.getContext('2d');
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(function(p){ return p.life > 0; });
    particles.forEach(function(p) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98; p.life -= p.decay;
      ctx2.save();
      ctx2.globalAlpha = Math.max(0, p.life);
      ctx2.fillStyle = p.color;
      ctx2.shadowColor = p.color === '#ffffff' ? '#aaddff' : p.color;
      ctx2.shadowBlur = p.color === '#ffffff' ? 5 : 10;
      ctx2.beginPath(); ctx2.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx2.fill();
      ctx2.restore();
    });
    animFrame = requestAnimationFrame(drawParticles);
  }
  drawParticles();

  var step = 0;
  var burstIntervals = [];

  function playNext() {
    if (step >= sequence.length) {
      cancelAnimationFrame(animFrame); animFrame = null;
      setTimeout(enableInput, 500); return;
    }
    var idx = sequence[step];
    currentToneIdx = idx;
    toneStartTime = Date.now();
    playEtherealTone(STONE_FREQS[idx], TONE_DUR, 'sine');

    // Spawn particles that fade IN at start, then fade OUT toward end
    var elapsed = 0;
    var burstInterval = setInterval(function() {
      elapsed += 75;
      var fadeIn  = Math.min(1, elapsed / (TONE_DUR * 0.25));      // first 25% = fade in
      var fadeOut = Math.max(0, 1 - Math.max(0, (elapsed - TONE_DUR*0.7) / (TONE_DUR*0.3))); // last 30% = fade out
      var fadePct = Math.min(fadeIn, fadeOut);
      spawnParticles(idx, fadePct);
      if (elapsed >= TONE_DUR) { clearInterval(burstInterval); }
    }, 75);
    burstIntervals.push(burstInterval);

    step++;
    setTimeout(playNext, TONE_DUR + GAP);
  }

  function enableInput() {
    inputLocked = false;
    currentToneIdx = -1;
    var status = document.getElementById('stone-status');
    if (status) status.textContent = 'Tap the order — ' + seqLen + ' notes — LOW · MID · HIGH';
    var btns = document.getElementById('stone-buttons');
    if (btns) { btns.style.opacity='1'; btns.style.pointerEvents='auto'; }
    function idleParticles() {
      if (inputLocked !== false) return;
      spawnParticles(-1, 0.6);
      setTimeout(idleParticles, 600);
    }
    idleParticles();
    if (!animFrame) drawParticles();
  }

  window._stoneBtnHandler = function(idx) {
    if (inputLocked) return;
    playEtherealTone(STONE_FREQS[idx], 650, 'sine');
    // Button tap: white flash + small tinted burst
    var btn = document.getElementById('stone-btn-'+idx);
    if (btn) { btn.style.background='#ffffff33'; btn.style.borderColor='#ffffff66'; setTimeout(function(){ if(btn){ btn.style.background='#ffffff11'; btn.style.borderColor='#ffffff22'; } }, 240); }
    spawnParticles(idx, 1);
    if (!animFrame) drawParticles();
    playerSeq.push(idx);
    var pos = playerSeq.length - 1;
    var dot = document.getElementById('stone-dot-'+pos);
    if (dot) { dot.style.background = '#ffffff88'; dot.style.borderColor = '#ffffff'; }
    if (playerSeq[pos] !== sequence[pos]) {
      var status = document.getElementById('stone-status');
      if (status) { status.textContent = '\u2717 Wrong \u2014 the stone falls silent.'; status.style.color = 'var(--red)'; }
      cancelAnimationFrame(animFrame); animFrame = null;
      setTimeout(function(){ finishBlueEvent(false, 'gold', '+1 Gold consolation.'); }, 900);
      return;
    }
    if (playerSeq.length === sequence.length) {
      var status = document.getElementById('stone-status');
      if (status) { status.textContent = ''; }
      cancelAnimationFrame(animFrame); animFrame = null;
      setTimeout(function(){ finishBlueEvent(true, 'gold', isWizard ? '+2 Blue Bricks + 1 Gold (Formwright!)' : '+1 Blue Brick + 1 Gold'); }, 900);
    }
  };

  setTimeout(playNext, 700);
}

function onStoneBtnTap(idx) {
  if (window._stoneBtnHandler) window._stoneBtnHandler(idx);
}

// ── LANDING EVENT FLAVOR POOLS ──
var LANDING_FLAVOR = {
  blue: [
    'The air hums with something crystallized between worlds.',
    'A residue lingers here — magic that refused to fully dissipate.',
    'Something ancient pressed itself into solid form.',
    'The walls remember a spell that was never finished.',
    'You feel it before you see it. A warmth that is not heat.',
    'The corridor holds its breath. Something is here.'
  ],
  gray: [
    'The corridor gives up one of its secrets.',
    'Something solid beneath the dust. Yours if you want it.',
    'The fortress sheds what it no longer needs.',
    'A remnant. Useful, if you are willing to dig.',
    'Not treasure. But it will do.',
    'The rubble has been holding this.'
  ],
  white: [
    'Untouched by what happened here.',
    'Clean. Almost out of place in all this ruin.',
    'A quiet thing in a loud place.',
    'It found you. Not the other way around.',
    'Something pure survived the battle.'
  ],
  gold: [
    'Someone left in a hurry.',
    'A pocket, emptied by time.',
    'The floor glints. You almost missed it.',
    'Whoever dropped this is not coming back for it.',
    'Luck. Or just good eyes.',
    'The fortress has been keeping this.'
  ],
  purple: [
    'Two sealed chests rest on pedestals. One glows faintly.',
    'A choice. No middle ground.',
    'Fate favors the bold. Or punishes them.',
    'Power crystallized into violet. But at what cost?',
    'The rarest things always ask something in return.',
    'Both chests hum. Only one is kind.'
  ],
  yellow: [
    'Something was written here before the battle started.',
    'A brick with a secret beneath it. Left deliberately.',
    'Knowledge, if you can use it.',
    'The fortress is talking. Are you listening?',
    'A clue or a warning. Hard to tell which.'
  ],
  orange: [
    'The floor decides it has had enough of you.',
    'Something shifts beneath your weight.',
    'Too late. You already stepped on it.',
    'A sound like a pin dropping. Then nothing. Then everything.',
    'The fortress set this one just for you.',
    'It was always going to happen like this.'
  ],
  trap: [
    'The floor decides it has had enough of you.',
    'Something shifts beneath your weight.',
    'Too late. You already stepped on it.',
    'A sound like a pin dropping. Then nothing. Then everything.',
    'It was always going to happen like this.'
  ],
  doubletrap: [
    'Two. Of course there are two.',
    'The fortress does not do things by halves.',
    'You find the first one. The second one finds you.',
    'Both at once. The floor had been planning this.'
  ],
  monster: [
    'Something was waiting for you to stop paying attention.',
    'The dark rearranges itself. Not favorably.',
    'You are not alone in this corridor.',
    'It heard you coming.',
    'This one is not interested in negotiation.'
  ],
  boss: [
    'The room changes when it wakes.',
    'Everything you did to get here was just the beginning.',
    'The fortress saves the worst for last.',
    'It has been waiting.'
  ],
  riddle: [
    'Something was written here before the battle started.',
    'A brick with a secret beneath it.',
    'The fortress is talking. Are you listening?',
    'Knowledge, if you can use it.',
    'Someone left this here on purpose.'
  ],
  riddleSolved: [
    'The fortress gives up its secrets slowly.',
    'Knowledge earned is knowledge kept.',
    'The answer was always there.',
    'Quick mind. Quicker hand.',
    'First to know. First to act.',
    'The brick remembers who listened.',
    'Some walls fall to force. This one fell to wit.'
  ],
  green: [
    'Three vines ripple across the path, thorns bristling.',
    'The fortress wears its garden like armor.',
    'Green things grew here. Some of them hungry.',
    'Cut clean or do not cut at all.',
    'The vines have opinions about intruders.'
  ],
  red: [
    'A stone circle. Three standing stones mark the trial.',
    'The fortress tests those who pass.',
    'Prove you belong. Or leave.',
    'The old ways still demand their price.',
    'Skill. Wit. Will. Show one. Show all.'
  ],
  black: [
    'A cloaked figure waits. Hood up. Hands empty.',
    'The shadow has been expecting you.',
    'A bargain. The terms are less kind than they sound.',
    'Something stands where nothing should. Listening.',
    'The fortress keeps darker merchants than most.'
  ],
  gold_z1: [
    'Someone left in a hurry.',
    'The floor gives up what the battle forgot.',
    'Lucky eyes.',
    'Show me the money.',
    'Not much. But it is yours.',
    'Right place, right time.'
  ],
  gold_z2: [
    'Found some rich stuff.',
    'The dark was hiding this.',
    'A pocket emptied by someone who will not need it.',
    'Richer than you were a moment ago.',
    'The corridor gives something back.',
    'You almost walked past it.'
  ],
  gold_z3: [
    'They will not be needing this.',
    'Spoils of the brief.',
    'The goblin had better taste than expected.',
    'It fell out when you were not looking.',
    'Small victory. Still a victory.',
    'A finder fee from the defeated.'
  ],
  gold_z4: [
    'The water was keeping this for someone.',
    'Now we are talking.',
    'Worth getting wet for.',
    'The chest did not need to be this heavy.',
    'A real find.',
    'The fortress owed you one.'
  ]
};
function getLandingFlavor(type, color, zone) {
  if (type === 'gold') {
    var zoneKey = 'gold_z' + ((zone || 0) + 1);
    var pool = LANDING_FLAVOR[zoneKey] || LANDING_FLAVOR.gold_z1;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  var key = color || type;
  var pool = LANDING_FLAVOR[key] || LANDING_FLAVOR[type] || LANDING_FLAVOR.monster;
  return pool[Math.floor(Math.random() * pool.length)];
}



// ── THE SENTRY STONE ──
// Floating stone with blinking eye drifts across arena.
// Tap CLOSED eye N times (3–7 random). Each tap is pass/fail. Need all to pass.
function startSentryStone(container, flavor, isWizard, extraTime) {
  var BLINK_OPEN_MS   = 1500;
  var BLINK_CLOSED_MS = 1100;
  var NEEDED = 3 + Math.floor(Math.random() * 5);
  var tapsRemaining = NEEDED;
  var done = false;
  var eyeOpen = true;
  var eyeTimer = null;
  var animFrame = null;
  var posX = 50, posY = 45;

  // Stone is 46px (33% smaller than 68px)
  var STONE_SIZE = 46;

  container.innerHTML =
    '<div style="font-size:11px;color:#4db8ff;text-align:center;margin-bottom:6px;font-family:Cinzel,serif;letter-spacing:.05em;">TAP THE STONE WHEN THE EYE CLOSES</div>'
    + '<div style="font-size:11px;color:var(--text-faint);text-align:center;margin-bottom:6px;font-style:italic;">' + flavor + '</div>'
    + '<div id="sentry-field" style="position:relative;width:100%;height:200px;background:#020a14;border-radius:10px;border:2px solid #006DB7;margin-bottom:8px;overflow:hidden;">'
    // bg canvas behind stone (z-index 1)
    + '<canvas id="sentry-canvas-bg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;"></canvas>'
    + '<div id="sentry-stone" style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);width:'+STONE_SIZE+'px;height:'+STONE_SIZE+'px;border-radius:50%;background:#0a1a2a;border:3px solid #4db8ff88;box-shadow:0 0 14px 4px #4db8ff33;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;">'
    + '<div id="sentry-eye" style="font-size:16px;transition:all .2s;user-select:none;pointer-events:none;">👁</div>'
    + '</div>'
    // fg canvas above stone (z-index 3)
    + '<canvas id="sentry-canvas-fg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;"></canvas>'
    + '</div>'
    + '<div id="sentry-status" style="font-size:11px;color:var(--text-faint);text-align:center;margin-bottom:6px;">Watch the eye…</div>'
    + '<div id="sentry-progress" style="display:flex;gap:4px;justify-content:center;">'
    + Array(NEEDED).fill(0).map(function(_,i){ return '<div id="sentry-dot-'+i+'" style="width:10px;height:10px;border-radius:50%;background:#0a2a4a;border:1px solid #1a4a7a;transition:background .2s;"></div>'; }).join('')
    + '</div>';

  var canvasBg = document.getElementById('sentry-canvas-bg');
  var canvasFg = document.getElementById('sentry-canvas-fg');
  var particlesBg = []; // trail behind stone
  var particlesFg = []; // burst effects above stone
  var prevSX = -1, prevSY = -1;
  var burstQueue = []; // { x, y, type, count }

  function resizeCanvases() {
    [canvasBg, canvasFg].forEach(function(c) {
      if (!c) return;
      c.width = c.offsetWidth; c.height = c.offsetHeight;
    });
  }
  resizeCanvases();

  function getPct(pct, max) { return (pct / 100) * max; }

  function spawnTrailParticle(x, y, dirAngle) {
    // 8 particles total (33% less than 12)
    // 50% trailing in wide cone behind direction of travel
    // 50% scattered random, decay faster
    for (var i = 0; i < 8; i++) {
      var isTrail = i < 4;
      var angle, spd, decay;
      if (isTrail) {
        // Wide cone trailing behind movement direction
        var coneAngle = (dirAngle !== undefined ? dirAngle + Math.PI : Math.random() * Math.PI * 2);
        angle = coneAngle + (Math.random() - 0.5) * 1.8; // ±90° cone
        spd = 0.15 + Math.random() * 0.6;
        decay = 0.005 + Math.random() * 0.005; // slow fade
      } else {
        // Random scatter, fade quickly
        angle = Math.random() * Math.PI * 2;
        spd = 0.4 + Math.random() * 1.2;
        decay = 0.018 + Math.random() * 0.012; // fast fade
      }
      particlesBg.push({
        x:x, y:y,
        vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd,
        life:1, decay:decay,
        size:1.5 + Math.random()*2,
        birthLife:1
      });
    }
  }

  function spawnBurst(x, y, type, count) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var spd = 1.5 + Math.random() * 3;
      particlesFg.push({
        x:x, y:y,
        vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd,
        life:1, decay:0.02 + Math.random()*0.015,
        size:2.5 + Math.random()*3,
        color: type === 'fail' ? '#cc3333' : '#ffffff'
      });
    }
  }

  function drawLayer(canvas, particles, glowColor, migrate) {
    // migrate: array to push particles into when they should move fg
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var alive = [];
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98; p.life -= p.decay;
      if (p.life <= 0) continue;
      // Trail particles migrate to fg once they've drifted (life < 0.75)
      if (migrate && p.birthLife !== undefined && p.life < 0.75) {
        delete p.birthLife;
        migrate.push(p);
        continue;
      }
      alive.push(p);
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life * 0.75);
      ctx.fillStyle = p.color || '#ffffff';
      ctx.shadowColor = p.color ? p.color : glowColor;
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    particles.length = 0;
    for (var j = 0; j < alive.length; j++) particles.push(alive[j]);
  }

  function drawFrame() {
    if (!canvasBg || !canvasFg) return;
    var W = canvasBg.width, H = canvasBg.height;
    var sx = getPct(posX, W), sy = getPct(posY, H);
    if (!done && (Math.abs(sx-prevSX)>0.3 || Math.abs(sy-prevSY)>0.3)) {
      var dirAngle = Math.atan2(sy-prevSY, sx-prevSX);
      spawnTrailParticle(sx, sy, dirAngle);
      prevSX=sx; prevSY=sy;
    }
    // Draw bg layer — migrates old trail particles into fg
    drawLayer(canvasBg, particlesBg, '#4db8ff', particlesFg);
    // Draw fg layer — no migration
    drawLayer(canvasFg, particlesFg, '#4db8ff', null);
    animFrame = requestAnimationFrame(drawFrame);
  }
  drawFrame();

  // Smooth 2D random walk
  function scheduleMove() {
    if (done) return;
    setTimeout(function() {
      if (done) return;
      var targetX = 12 + Math.random()*76;
      var targetY = 12 + Math.random()*76;
      var STEPS = 35 + Math.floor(Math.random()*25);
      var dx = (targetX - posX) / STEPS;
      var dy = (targetY - posY) / STEPS;
      var step = 0;
      var mv = setInterval(function() {
        if (done) { clearInterval(mv); return; }
        posX += dx; posY += dy;
        var stone = document.getElementById('sentry-stone');
        if (stone) { stone.style.left = posX+'%'; stone.style.top = posY+'%'; }
        step++;
        if (step >= STEPS) { clearInterval(mv); scheduleMove(); }
      }, 18);
    }, 500 + Math.random()*900);
  }

  // Eye: always blue border/glow, only text changes
  function setEye(open) {
    if (done) return;
    eyeOpen = open;
    var eye = document.getElementById('sentry-eye');
    if (!eye) return;
    eye.textContent = open ? '👁' : '—';
    eye.style.transform = open ? 'scale(1)' : 'scale(0.7)';
    eyeTimer = setTimeout(function(){ if(!done) setEye(!open); }, open ? BLINK_OPEN_MS : BLINK_CLOSED_MS);
  }

  function onSentryTap(e) {
    if (e) e.preventDefault();
    if (done) return;
    var isWiz = G.activeEvent && G.activeEvent.isWizard;
    var tapIdx = NEEDED - tapsRemaining;
    var dot = document.getElementById('sentry-dot-'+tapIdx);
    var W = canvasBg ? canvasBg.width : 200;
    var H = canvasBg ? canvasBg.height : 200;
    var sx = getPct(posX, W), sy = getPct(posY, H);

    if (!eyeOpen) {
      // Closed — success tap
      tapsRemaining--;
      if (dot) { dot.style.background = '#4db8ff'; dot.style.borderColor = '#4db8ffaa'; }
      spawnBurst(sx, sy, 'hit', 27); // 200% more burst
      if (tapsRemaining === 0) {
        done = true; clearTimeout(eyeTimer); cancelAnimationFrame(animFrame);
        var eye = document.getElementById('sentry-eye');
        if (eye) eye.textContent = '✓';
        var status = document.getElementById('sentry-status');
        if (status) { status.textContent = ''; }
        setTimeout(function(){ finishBlueEvent(true, 'shield', isWiz ? '+2 Blue Bricks + shield pip (Formwright!)' : '+1 Blue Brick + shield pip'); }, 900);
      } else {
        var status = document.getElementById('sentry-status');
        if (status) status.textContent = tapsRemaining + ' more…';
      }
    } else {
      // Open — fail
      done = true; clearTimeout(eyeTimer); cancelAnimationFrame(animFrame);
      if (dot) { dot.style.background = '#cc3333'; dot.style.borderColor = '#cc3333'; }
      spawnBurst(sx, sy, 'fail', 33);
      var eye2 = document.getElementById('sentry-eye');
      if (eye2) eye2.textContent = '😠';
      var status = document.getElementById('sentry-status');
      if (status) { status.textContent = '👁 Seen! −1 HP · +1 Gold consolation'; status.style.color = 'var(--red)'; }
      setTimeout(function(){ finishBlueEvent(false, 'damage', 'It saw you! -1 HP. +1 Gold consolation.'); }, 900);
    }
  }

  setTimeout(function() {
    var stone = document.getElementById('sentry-stone');
    if (stone) {
      stone.addEventListener('click', onSentryTap);
      stone.addEventListener('touchstart', onSentryTap, {passive:false});
    }
    setEye(true);
    scheduleMove();
  }, 400);
}


// ── THE CIPHER LOCK ──
// ALL runes pulse during show (correct one is STATIC/steady). All rearrange for second phase.
function startCipherLock(container, flavor, isWizard, extraTime) {
  var SHOW_TIME = 1800 + extraTime;
  var FADE_TIME = 600; // fade to black before scramble
  var runeSet = ['\u16A0','\u16A2','\u16A6','\u16A8','\u16B1','\u16B2','\u16B7','\u16B9','\u16BA','\u16BE','\u16C1','\u16C3','\u16C7','\u16C8','\u16C9','\u16CA','\u16CF','\u16D2','\u16D6','\u16D7'];
  var count = Math.random() < 0.5 ? 5 : 7;
  var runes = [];
  while (runes.length < count) { var r = runeSet[Math.floor(Math.random()*runeSet.length)]; if(!runes.includes(r)) runes.push(r); }
  var centerIdx = Math.floor(Math.random() * count);
  var centerRune = runes[centerIdx];

  function genPositions(n) {
    // Scatter runes across the full arena with minimum separation
    var MIN_DIST = 22; // minimum % distance between any two runes
    var PAD_X = 10, PAD_Y = 15; // padding from edges
    var maxTries = 200;
    var pts = [];
    var attempts = 0;
    while (pts.length < n && attempts < maxTries) {
      attempts++;
      var x = PAD_X + Math.random() * (100 - PAD_X*2);
      var y = PAD_Y + Math.random() * (100 - PAD_Y*2);
      // Check distance from all existing points
      var ok = true;
      for (var j = 0; j < pts.length; j++) {
        var dx = x - pts[j].x, dy = (y - pts[j].y) * 1.8; // scale y so vertical gap feels similar
        if (Math.sqrt(dx*dx + dy*dy) < MIN_DIST) { ok = false; break; }
      }
      if (ok) pts.push({ x: Math.round(x), y: Math.round(y) });
    }
    // Fallback: if not enough placed (very rare), relax and fill remaining
    while (pts.length < n) {
      pts.push({ x: Math.round(10 + Math.random()*80), y: Math.round(15 + Math.random()*70) });
    }
    return pts;
  }
  var positions = genPositions(count);

  // Per-rune keyframes: others pulse erratically, correct one has slow steady breathe
  var cipherStyle = document.getElementById('cipher-pulse-style');
  if (!cipherStyle) { cipherStyle = document.createElement('style'); cipherStyle.id='cipher-pulse-style'; document.head.appendChild(cipherStyle); }
  var pulseAnims = runes.map(function(_,i){
    if (i === centerIdx) {
      // Correct: slow steady glow — obvious but calm, 1.6s cycle
      return '@keyframes rune-correct{0%{color:#4db8ff;text-shadow:0 0 8px #4db8ff88;}50%{color:#aaddff;text-shadow:0 0 22px #4db8ffdd,0 0 40px #4db8ff55;}100%{color:#4db8ff;text-shadow:0 0 8px #4db8ff88;}}';
    }
    // Others: fast erratic flicker with varying speed
    var spd = (0.3 + (i%4)*0.12).toFixed(2);
    return '@keyframes rune-pulse-'+i+'{0%{color:#1a3a6a;text-shadow:none;}'+Math.round(20+i*9)+'%{color:#4a90c0;text-shadow:0 0 10px #4db8ff66;}'+Math.round(50+i*5)+'%{color:#0d1f3a;text-shadow:none;}'+Math.round(75+i*3)+'%{color:#3a70a0;text-shadow:0 0 6px #4db8ff33;}100%{color:#1a3a6a;text-shadow:none;}}';
  }).join('');
  cipherStyle.textContent = pulseAnims;

  var fieldHeight = count > 5 ? 160 : 130;
  container.innerHTML =
    '<div style="font-size:11px;color:#4db8ff;text-align:center;margin-bottom:6px;font-family:Cinzel,serif;letter-spacing:.05em;">ONE RUNE IS STILL \u2014 FIND IT</div>'
    + '<div style="font-size:11px;color:var(--text-faint);text-align:center;margin-bottom:8px;font-style:italic;">' + flavor + '</div>'
    + '<div id="cipher-field" style="position:relative;width:100%;height:'+fieldHeight+'px;background:#020a14;border-radius:10px;border:1px solid #1a4a7a;margin-bottom:10px;overflow:hidden;transition:opacity 0.6s;">'
    + runes.map(function(r,i){
        var isCenter = (i === centerIdx);
        // Distraction runes: slow 1.3–1.8s, deliberately close to correct rune's 1.6s — hard to tell apart
        var distractSpeeds = [1.3, 1.55, 1.75, 1.45, 1.8, 1.35, 1.65];
        var anim = isCenter ? 'rune-correct 1.6s ease-in-out infinite' : 'rune-pulse-'+i+' '+distractSpeeds[i % distractSpeeds.length].toFixed(2)+'s ease-in-out infinite';
        var color = isCenter ? '#4db8ff' : '#1a3a6a';
        var shadow = isCenter ? 'text-shadow:0 0 8px #4db8ff88;' : '';
        return '<div id="cipher-rune-'+i+'" style="position:absolute;left:'+positions[i].x+'%;top:'+positions[i].y+'%;font-size:26px;color:'+color+';font-weight:700;transform:translate(-50%,-50%);transition:left .5s,top .5s,opacity .3s;animation:'+anim+';'+shadow+'">'+r+'</div>';
      }).join('')
    + '</div>'
    + '<div id="cipher-status" style="font-size:11px;color:var(--text-faint);text-align:center;">One rune breathes steadily \u2014 the others flicker\u2026</div>';

  // Phase 2: fade field to black, scramble while dark, then fade back in
  setTimeout(function() {
    var field = document.getElementById('cipher-field');
    if (field) field.style.opacity = '0';
    if (cipherStyle) cipherStyle.textContent = '';
    setTimeout(function() {
      // Scramble all while invisible
      var newPositions = genPositions(count).sort(function(){ return Math.random()-.5; });
      runes.forEach(function(_,i) {
        var el = document.getElementById('cipher-rune-'+i);
        if (el) {
          el.style.transition = 'none'; // instant move while faded
          el.style.left = newPositions[i].x+'%';
          el.style.top = newPositions[i].y+'%';
          el.style.color = '#2a5a8a';
          el.style.animation = 'none';
          el.style.textShadow = 'none';
          el.style.fontSize = '30px';
          el.style.cursor = 'pointer';
        }
      });
      var status = document.getElementById('cipher-status');
      if (status) status.textContent = 'Which rune was breathing steadily?';
      // Fade back in
      setTimeout(function() {
        if (field) { field.style.transition = 'opacity 0.5s'; field.style.opacity = '1'; }
        // Enable taps after visible
        runes.forEach(function(r,i) {
          var el = document.getElementById('cipher-rune-'+i);
          if (!el) return;
          function tapHandler(e){ if(e) e.preventDefault(); onCipherPick(r, centerRune); }
          el.addEventListener('click', tapHandler);
          el.addEventListener('touchstart', tapHandler, {passive:false});
        });
      }, 80);
    }, FADE_TIME); // wait for fade to complete before scrambling
  }, SHOW_TIME);
}

function onCipherPick(picked, correct) {
  var isWizard = G.activeEvent && G.activeEvent.isWizard;
  var status = document.getElementById('cipher-status');
  if (picked === correct) {
    if (status) { status.textContent = ''; }
    setTimeout(function(){ finishBlueEvent(true, 'gold', isWizard ? '+2 Blue Bricks + 1 Gold (Formwright!)' : '+1 Blue Brick + 1 Gold'); }, 700);
  } else {
    if (status) { status.textContent = '✗ Wrong rune — the lock resets.'; status.style.color = 'var(--red)'; }
    setTimeout(function(){ finishBlueEvent(false, 'shield', '+1 Shield pip consolation.'); }, 700);
  }
}

// ── CREEPER VINE MINI-GAME ──
// ── OUT OF BATTLE FREE ACTIONS ──
function renderResultCard() {
  if (!_pendingResult) return '';
  var r = _pendingResult;
  var numHtml = '';
  if (r.mainNum !== null && r.mainNum !== undefined) {
    if (r.numIsText) {
      numHtml = '<div style="font-family:Cinzel,serif;font-size:34px;font-weight:700;color:var(--gold);line-height:1;margin:8px 0;">' + r.mainNum + '</div>';
    } else {
      var numColor = (r.kind==='monster' && r.mainNum < 0) ? 'var(--red)' : r.border;
      numHtml = '<div style="font-family:Cinzel,serif;font-size:52px;font-weight:700;color:'+numColor+';line-height:1;margin:8px 0;text-shadow:0 0 20px '+numColor+'44;">' + r.mainNum + '</div>';
    }
  }
  var isVictory = r.kind === 'victory';
  return '<div class="card" style="border:2px solid '+r.border+';background:'+r.border+'11;text-align:center;padding:16px;">'
    + (isVictory
        ? '<div style="font-family:Cinzel,serif;font-size:22px;color:'+r.border+';margin-bottom:12px;">' + r.icon + ' ' + r.title + '</div>'
        : '<div style="font-family:Cinzel,serif;font-size:11px;letter-spacing:.08em;color:'+r.border+';margin-bottom:4px;">' + r.icon + ' ' + r.title + '</div>'
      )
    + numHtml
    + (r.brickDots ? '<div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px;margin:8px 0 12px;">' + r.brickDots + '</div>' : '')
    + (r.detail ? '<div style="font-size:13px;color:var(--text-dim);margin-bottom:12px;line-height:1.5;">' + r.detail + '</div>' : '')
    + '<button class="btn primary" style="border-color:'+r.border+';color:'+r.border+';width:100%;padding:12px;font-family:Cinzel,serif;" onclick="_pendingResult=null;render();">Continue →</button>'
    + '</div>';
}

function renderMarketPanel(me) {
  var gold = me.gold || 0;
  var prices = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
  var html = '<div class="card" style="border-color:var(--gold);">'
    + '<div class="card-title" style="color:var(--gold);">🏪 Market — ' + (SPACES[me.space]?.label||'Store') + '</div>'
    + '<div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Your gold: <strong style="color:var(--gold);font-size:14px;">🪙 ' + gold + '</strong></div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;">';

  Object.entries(prices).forEach(function(e) {
    var color = e[0]; var price = e[1];
    var bg = BRICK_COLORS[color] || '#888';
    var bdr = color === 'white' ? 'border:1px solid #ccc;' : '';
    var textColor = (color === 'white' || color === 'yellow') ? '#333' : bg;
    var canAfford = gold >= price;
    html += '<button onclick="buyBrick(\''+color+'\')" '+(canAfford?'':'disabled')+' '
      + 'style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 8px;border-radius:10px;'
      + 'background:'+bg+'18;border:1px solid '+(canAfford?bg:'#333')+';cursor:'+(canAfford?'pointer':'not-allowed')+';'
      + 'opacity:'+(canAfford?'1':'.4')+';min-width:64px;">'
      + '<span style="width:20px;height:20px;border-radius:4px;background:'+bg+';'+bdr+'display:block;"></span>'
      + '<span style="font-size:11px;color:'+textColor+';font-weight:700;">'+color+'</span>'
      + '<span style="font-size:12px;color:var(--gold);">🪙'+price+'</span>'
      + '</button>';
  });

  html += '</div></div>';
  return html;
}

function buyBrick(color) {
  var prices = { red:1, gray:1, green:1, blue:2, white:2, yellow:2, orange:2, purple:3, black:3 };
  var price = prices[color] || 0;
  var me = G.players[MY_CLASS];
  if ((me.gold||0) < price) { toast('Need '+price+' gold', 'warn'); return; }
  client.purchaseBrick(MY_CLASS, color);
  _pendingResult = {
    border: BRICK_COLORS[color] || 'var(--gold)',
    title: 'Purchased!',
    icon: '🏪',
    mainNum: null,
    detail: '1 ' + color + ' brick added — spent 🪙' + price + ' gold',
    kind: 'reward'
  };
  render();
}

// ── GOLD MINI-GAME LAUNCHER ──
var _goldGameVariant = null; // 'crack' or 'torch'
var _goldGameMin = 1;
var _goldGameMax = 2;
var _goldGameZone = 0;

function startGoldEvent(variant, min, max, zone) {
  _goldGameVariant = variant;
  _goldGameMin = min;
  _goldGameMax = max;
  _goldGameZone = zone;

  var el = document.getElementById('landing-result');
  if (!el) return;

  var zoneKey = 'gold_z' + (zone + 1);
  var pool = LANDING_FLAVOR[zoneKey] || LANDING_FLAVOR.gold_z1;
  var flavor = pool[Math.floor(Math.random() * pool.length)];

  // Torch gets its own initiate flavors
  var TORCH_INITIATE = [
    'Found a torch to search the floor with.',
    'A torch. Still lit. Not for long.',
    'The torch catches. Use it while it lasts.',
    'Light, briefly. Search before it goes.',
    'Someone left a torch. Lucky.'
  ];
  if (variant === 'torch') flavor = TORCH_INITIATE[Math.floor(Math.random()*TORCH_INITIATE.length)];

  el.innerHTML = '<div class="roll-display" style="margin-top:8px;text-align:center;">'
    + '<div id="gold-game-container">'
    + '<div style="padding:14px 10px;">'
    + '<div style="font-size:13px;color:var(--text-dim);font-style:italic;line-height:1.5;margin-bottom:14px;">' + flavor + '</div>'
    + '<button class="btn" style="width:100%;font-size:15px;padding:13px;font-family:Cinzel,serif;border-color:var(--gold);color:var(--gold);letter-spacing:.06em;" '
    + 'onclick="launchGoldGame()">&#129689; Search</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function launchGoldGame() {
  if (_goldGameVariant === 'crack') startCrackGame();
  else startTorchGame();
}

// ── CRACK IN THE WALL ──
function startCrackGame() {
  var container = document.getElementById('gold-game-container');
  if (!container) return;
  var min = _goldGameMin, max = _goldGameMax;
  var slots = max + 2; // extra empty/rat slots
  var coinsHidden = min + Math.floor(Math.random() * (max - min + 1));
  // v4: 15% chance to also hide a cheese tile. Replaces one 'empty' slot.
  var hasCheese = Math.random() < 0.15;
  // Build slot array: coins + empties + 1 rat stopper + maybe 1 cheese
  var slotArr = [];
  for (var i = 0; i < coinsHidden; i++) slotArr.push('coin');
  if (hasCheese) slotArr.push('cheese');
  while (slotArr.length < slots - 1) slotArr.push('empty');
  slotArr.push('rat'); // stopper
  // Shuffle
  for (var si = slotArr.length - 1; si > 0; si--) {
    var rj = Math.floor(Math.random() * (si + 1));
    var tmp = slotArr[si]; slotArr[si] = slotArr[rj]; slotArr[rj] = tmp;
  }
  var found = 0;
  var cheeseFound = 0;
  var done = false;

  function render() {
    var btns = slotArr.map(function(type, idx) {
      var revealed = type === '_coin' || type === '_empty' || type === '_rat' || type === '_cheese';
      var icon = revealed
        ? (type === '_coin' ? '&#129689;'
          : type === '_rat' ? '&#128001;'
          : type === '_cheese' ? '&#129472;'
          : '&#128065;')
        : '?';
      var bg = revealed
        ? (type === '_coin' ? '#1a1200'
          : type === '_cheese' ? '#1a1400'
          : '#1a0a0a')
        : '#1a1a1a';
      var border = revealed
        ? (type === '_coin' ? 'var(--gold)'
          : type === '_cheese' ? '#FFD96A'
          : '#444')
        : '#333';
      return '<button '+(revealed||done?'disabled':'')+' onclick="crackTap('+idx+')" '
        +'style="width:52px;height:52px;border-radius:10px;background:'+bg+';border:2px solid '+border+';font-size:22px;cursor:'+(revealed||done?'default':'pointer')+';transition:all .15s;">'
        +icon+'</button>';
    }).join('');
    container.innerHTML = '<div style="padding:12px;">'
      +'<div style="font-family:Cinzel,serif;font-size:13px;color:var(--gold);margin-bottom:6px;">Crack in the Wall</div>'
      +'<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;font-style:italic;">Reach in — find coins before you find the rat.</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px;">'+btns+'</div>'
      +(done ? '<div style="font-size:13px;color:var(--gold);font-family:Cinzel,serif;margin-bottom:8px;">Found: '+found+' &#129689;</div>' : '')
      +(done ? '' : '<div style="font-size:11px;color:var(--text-faint);">Tap to reach in. Stop when you want.</div>')
      +(found > 0 && !done ? '<button class="btn" style="width:100%;margin-top:8px;border-color:var(--gold);color:var(--gold);" onclick="crackStop()">Stop — Keep '+found+' gold</button>' : '')
      +'</div>';
    window._crackSlots = slotArr;
    window._crackFound = found;
    window._crackDone = done;
  }

  window.crackTap = function(idx) {
    if (done) return;
    var type = slotArr[idx];
    if (type === 'coin') { slotArr[idx] = '_coin'; found++; }
    else if (type === 'cheese') {
      // v4: found cheese in the crack. Golden sparks + floater, NOT game-ending.
      slotArr[idx] = '_cheese'; cheeseFound++;
    }
    else if (type === 'empty') { slotArr[idx] = '_empty'; }
    else if (type === 'rat') {
      slotArr[idx] = '_rat'; done = true;
      // Rat burst animation — emoji scales up and fades over the card
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999;display:flex;align-items:center;justify-content:center;';
      var ratEl = document.createElement('div');
      ratEl.textContent = '🐀';
      ratEl.style.cssText = 'font-size:32px;transition:none;will-change:transform,opacity;';
      overlay.appendChild(ratEl);
      document.body.appendChild(overlay);
      // Find crack container position for origin
      var rect = container.getBoundingClientRect();
      var btnEl = container.querySelectorAll('button')[idx];
      var startX = btnEl ? (btnEl.getBoundingClientRect().left + btnEl.getBoundingClientRect().width/2) : (rect.left + rect.width/2);
      var startY = btnEl ? (btnEl.getBoundingClientRect().top + btnEl.getBoundingClientRect().height/2) : (rect.top + rect.height/2);
      var centerX = window.innerWidth/2;
      var centerY = window.innerHeight/2;
      ratEl.style.position = 'fixed';
      ratEl.style.left = startX+'px';
      ratEl.style.top = startY+'px';
      ratEl.style.transform = 'translate(-50%,-50%) scale(1)';
      ratEl.style.opacity = '1';
      var startTime = null;
      var DURATION = 700;
      function animRat(ts) {
        if (!startTime) startTime = ts;
        var p = Math.min(1, (ts - startTime) / DURATION);
        var scale = 1 + p * 11; // grow to ~12x = roughly card size
        var opacity = 1 - p;
        // Move from button toward center
        var cx = startX + (centerX - startX) * p * 0.4;
        var cy = startY + (centerY - startY) * p * 0.4;
        ratEl.style.left = cx+'px';
        ratEl.style.top = cy+'px';
        ratEl.style.transform = 'translate(-50%,-50%) scale('+scale+')';
        ratEl.style.opacity = opacity;
        if (p < 1) {
          requestAnimationFrame(animRat);
        } else {
          overlay.remove();
          render();
          finishGoldGame(found, coinsHidden, true, cheeseFound); // wrongTap=true → -1 HP
        }
      }
      requestAnimationFrame(animRat);
      // Show rat in slot immediately, rest of render after anim
      slotArr[idx] = '_rat';
      render();
      return; // don't call finishGoldGame yet — anim callback does it
    }
    if (done || found === coinsHidden) {
      done = true;
      if (found > 0 && type !== 'rat') {
        // Firework burst from card center covering entire event card
        var crackRect = container.getBoundingClientRect();
        var burstOverlay = document.createElement('canvas');
        burstOverlay.style.cssText = 'position:fixed;left:'+crackRect.left+'px;top:'+crackRect.top+'px;width:'+crackRect.width+'px;height:'+crackRect.height+'px;pointer-events:none;z-index:500;border-radius:12px;';
        burstOverlay.width = Math.round(crackRect.width);
        burstOverlay.height = Math.round(crackRect.height);
        document.body.appendChild(burstOverlay);
        var bCtx = burstOverlay.getContext('2d');
        var bParts = [];
        var CX = burstOverlay.width / 2;
        var CY = burstOverlay.height / 2;

        function spawnShell(cx, cy, count, speedMin, speedMax, colors) {
          for (var pi=0; pi<count; pi++) {
            var a = (pi / count) * Math.PI * 2 + Math.random()*0.4;
            var spd = speedMin + Math.random()*(speedMax-speedMin);
            bParts.push({
              x:cx, y:cy,
              vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
              life:0.9+Math.random()*0.3, decay:0.010+Math.random()*0.012,
              size:1.8+Math.random()*2.8,
              color: colors[Math.floor(Math.random()*colors.length)],
              gravity: 0.04+Math.random()*0.03
            });
          }
        }

        var GOLD = ['#F5D000','#FFB800','#FFD700','#FFC200'];
        var WHITE = ['#ffffff','#fffce0','#F5D000'];

        // Initial big burst from center
        spawnShell(CX, CY, 80, 1.5, 6, GOLD);
        // Secondary smaller bursts at 300ms
        setTimeout(function() {
          if (!burstOverlay.parentNode) return;
          spawnShell(CX*0.4, CY*0.6, 40, 1, 4, WHITE);
          spawnShell(CX*1.6, CY*0.5, 40, 1, 4, GOLD);
        }, 300);
        // Third wave at 600ms
        setTimeout(function() {
          if (!burstOverlay.parentNode) return;
          spawnShell(CX, CY*1.4, 50, 1.2, 5, WHITE);
        }, 600);

        var burstFrame = null;
        function animBurst() {
          if (!burstOverlay.parentNode) return;
          bCtx.clearRect(0, 0, burstOverlay.width, burstOverlay.height);
          bParts = bParts.filter(function(p){ return p.life>0; });
          bParts.forEach(function(p) {
            p.vx *= 0.97; p.vy *= 0.97; p.vy += p.gravity;
            p.x += p.vx; p.y += p.vy;
            p.life -= p.decay;
            bCtx.save();
            bCtx.globalAlpha = Math.max(0, p.life);
            bCtx.fillStyle = p.color;
            bCtx.shadowColor = p.color; bCtx.shadowBlur = 8;
            bCtx.beginPath(); bCtx.arc(p.x, p.y, p.size, 0, Math.PI*2); bCtx.fill();
            bCtx.restore();
          });
          burstFrame = requestAnimationFrame(animBurst);
        }
        animBurst();
        setTimeout(function() {
          cancelAnimationFrame(burstFrame);
          if (burstOverlay.parentNode) burstOverlay.remove();
          finishGoldGame(found, coinsHidden, false, cheeseFound);
        }, 1500);
      } else {
        finishGoldGame(found, coinsHidden, false, cheeseFound);
      }
    }
    render();
  };
  window.crackStop = function() {
    done = true;
    finishGoldGame(found, coinsHidden, false, cheeseFound);
    render();
  };

  render();
}

function startTorchGame() {
  var container = document.getElementById('gold-game-container');
  if (!container) return;

  var min = _goldGameMin, max = _goldGameMax;
  var totalCoins = Math.max(2, min + Math.floor(Math.random() * (max - min + 1)));

  var DECOY_POOL = ['cheese'];
  var numDecoys = totalCoins + 2 + Math.floor(Math.random() * 2);
  var objects = [];
  for (var i = 0; i < totalCoins; i++) objects.push({ type:'coin', found:false, tapped:false, x:0, y:0 });
  for (var i = 0; i < numDecoys; i++) objects.push({ type: DECOY_POOL[i % DECOY_POOL.length], found:false, tapped:false, x:0, y:0 });
  for (var i = objects.length-1; i>0; i--) {
    var j = Math.floor(Math.random()*(i+1)); var t=objects[i]; objects[i]=objects[j]; objects[j]=t;
  }

  var coinsFound = 0;
  var cheeseFound = 0;
  var done = false;
  var OBJ_R = 14;
  var LIGHT_R_MAX = 110;   // overwritten by tryInit based on arena size
  var LIGHT_R = LIGHT_R_MAX;
  var ARENA_W = 0, ARENA_H = 0;
  var animFrame = null;
  var litState = {};
  var particles = [];

  // Torch burn duration — zone 4 gets more time (more coins)
  var BURN_MS = 12000 + (_goldGameZone||0) * 1500; // z1=12s z2=13.5s z3=15s z4=16.5s
  var startTime = null;

  // Flavor lines for initiate (already shown via outer card)
  // Flavor lines for burn-out end
  var BURNOUT_FLAVORS = [
    'The torch gave everything it had.',
    'Light gone. Take what you found.',
    'The dark reclaims the floor.',
    'It burns out. The corridor goes quiet.',
    'Flame out. Enough.',
    'The torch had its say.'
  ];

  container.innerHTML =
    '<div style="padding:10px 10px 4px;">'
    + '<div style="font-family:Cinzel,serif;font-size:11px;color:var(--gold)88;text-align:center;letter-spacing:.06em;margin-bottom:6px;">TORCH REVEAL</div>'
    + '<div id="torch-arena" style="position:relative;width:100%;height:220px;background:#030200;border-radius:10px;border:2px solid #1a1000;overflow:hidden;margin-bottom:8px;touch-action:none;contain:strict;">'
    + '<canvas id="torch-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>'
    + '</div>'
    + '<div id="torch-progress" style="display:flex;gap:4px;justify-content:center;">'
    + Array(totalCoins).fill(0).map(function(_,i){
        return '<span id="tdot-'+i+'" style="font-size:14px;opacity:.2;">&#129689;</span>';
      }).join('')
    + '</div>'
    + '</div>';

  var arena = document.getElementById('torch-arena');
  var canvas = document.getElementById('torch-canvas');
  var ctx = canvas.getContext('2d');

  // Billiard bounce movement
  var torchX = 0, torchY = 0;
  var velX = 0, velY = 0;
  var SPEED = 2.8;

  function newAngleDeg() { return 7 + Math.random() * 8; }

  function initTorch() {
    var cornerX = Math.random() < 0.5 ? 0 : 1;
    var cornerY = Math.random() < 0.5 ? 0 : 1;
    torchX = cornerX === 0 ? 4 : ARENA_W - 4;
    torchY = cornerY === 0 ? 4 : ARENA_H - 4;
    var xDir = cornerX === 0 ? 1 : -1;
    var yDir = cornerY === 0 ? 1 : -1;
    var ang = newAngleDeg() * Math.PI / 180;
    velX = Math.cos(ang) * SPEED * xDir;
    velY = Math.sin(ang) * SPEED * yDir;
  }

  function placeObjects() {
    var placed = [];
    objects.forEach(function(obj) {
      var attempts=0, ox, oy, ok;
      while (attempts<60) {
        ox = 28 + Math.random()*(ARENA_W-56);
        oy = 22 + Math.random()*(ARENA_H-44);
        ok = placed.every(function(p){ return Math.hypot(p.x-ox,p.y-oy) > OBJ_R*4.5; });
        if (ok) break; attempts++;
      }
      obj.x = (ox !== undefined) ? ox : 28+Math.random()*(ARENA_W-56);
      obj.y = (oy !== undefined) ? oy : 22+Math.random()*(ARENA_H-44);
      placed.push(obj);
    });
  }

  function spawnSparks(x, y, count, color) {
    for (var i=0; i<count; i++) {
      var a=Math.random()*Math.PI*2, spd=0.5+Math.random()*2;
      particles.push({ x:x,y:y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
        life:0.7+Math.random()*0.5, decay:0.014+Math.random()*0.014,
        size:1.2+Math.random()*2.2, color:color||'#F5D000' });
    }
  }
  function spawnRedBurst(x, y) { spawnSparks(x, y, 14, '#E24B4A'); }

  function drawObj(obj, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = (OBJ_R*1.8)+'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (obj.type === 'coin') ctx.fillText('🪙', obj.x, obj.y);
    else                     ctx.fillText('🧀', obj.x, obj.y);
    ctx.restore();
  }

  function endGame(wrongTap) {
    done = true;
    cancelAnimationFrame(animFrame);
    // Fade the canvas out so the 500-800ms gap before the result card isn't a black stare
    if (canvas) {
      canvas.style.transition = 'opacity 0.3s';
      canvas.style.opacity = '0';
    }
    setTimeout(function(){ finishGoldGame(coinsFound, totalCoins, wrongTap||false, cheeseFound); }, wrongTap ? 800 : 500);
  }

  function drawFrame(ts) {
    if (!canvas.parentNode || done) { cancelAnimationFrame(animFrame); return; }
    if (!startTime) startTime = ts;

    // Shrink light over time
    var elapsed = ts - startTime;
    var burnPct = Math.max(0, 1 - elapsed / BURN_MS);
    // Starts at max, flickers slightly at end
    var flicker = burnPct < 0.2 ? (0.85 + Math.random()*0.15) : 1;
    LIGHT_R = LIGHT_R_MAX * burnPct * flicker;

    // Warm color shifts — starts golden, gets redder as it dies
    var warmR = Math.round(255);
    var warmG = Math.round(175 * burnPct + 60 * (1-burnPct));
    var warmB = Math.round(30 * burnPct);

    if (LIGHT_R < 6) { endGame(false); return; }

    // Move torch
    torchX += velX; torchY += velY;
    if (torchX <= 4) { torchX=4; velX=Math.abs(velX); var a=newAngleDeg()*Math.PI/180; var s=Math.hypot(velX,velY); velX=Math.cos(a)*s; velY=(velY>=0?1:-1)*Math.sin(a)*s; }
    else if (torchX >= ARENA_W-4) { torchX=ARENA_W-4; velX=-Math.abs(velX); var a=newAngleDeg()*Math.PI/180; var s=Math.hypot(velX,velY); velX=-Math.cos(a)*s; velY=(velY>=0?1:-1)*Math.sin(a)*s; }
    if (torchY <= 4) { torchY=4; velY=Math.abs(velY); var a=newAngleDeg()*Math.PI/180; var s=Math.hypot(velX,velY); velY=Math.cos(a)*s; velX=(velX>=0?1:-1)*Math.sin(a)*s; }
    else if (torchY >= ARENA_H-4) { torchY=ARENA_H-4; velY=-Math.abs(velY); var a=newAngleDeg()*Math.PI/180; var s=Math.hypot(velX,velY); velY=-Math.cos(a)*s; velX=(velX>=0?1:-1)*Math.sin(a)*s; }

    // Draw
    ctx.clearRect(0,0,ARENA_W,ARENA_H);
    ctx.fillStyle='#030200'; ctx.fillRect(0,0,ARENA_W,ARENA_H);

    // Objects clipped to light
    ctx.save();
    ctx.beginPath(); ctx.arc(torchX,torchY,LIGHT_R,0,Math.PI*2); ctx.clip();
    var warm = ctx.createRadialGradient(torchX,torchY,0,torchX,torchY,LIGHT_R);
    warm.addColorStop(0,'rgba('+warmR+','+warmG+','+warmB+',0.18)');
    warm.addColorStop(0.5,'rgba('+warmR+','+warmG+','+warmB+',0.07)');
    warm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=warm; ctx.fillRect(0,0,ARENA_W,ARENA_H);
    objects.forEach(function(obj,idx) {
      if (obj.tapped) return;
      var dist=Math.hypot(obj.x-torchX,obj.y-torchY);
      var inLight=dist<LIGHT_R*0.88;
      var wasLit=litState[idx]; litState[idx]=inLight;
      if (inLight&&!wasLit&&!obj.found) spawnSparks(obj.x,obj.y,6,'#F5D000');
      if (inLight) { var a=0.3+0.7*Math.max(0,1-dist/(LIGHT_R*0.82)); drawObj(obj,a); }
    });
    ctx.restore();

    // (found coins removed from arena — not redrawn)

    // Vignette
    ctx.save();
    var vign=ctx.createRadialGradient(torchX,torchY,LIGHT_R*0.5,torchX,torchY,LIGHT_R*1.08);
    vign.addColorStop(0,'rgba(0,0,0,0)'); vign.addColorStop(1,'rgba(0,0,0,0.97)');
    ctx.fillStyle=vign; ctx.fillRect(0,0,ARENA_W,ARENA_H);
    ctx.restore();

    // Extra dim overlay as torch dies
    if (burnPct < 0.35) {
      ctx.fillStyle = 'rgba(0,0,0,'+(0.6*(1-burnPct/0.35))+')';
      ctx.fillRect(0,0,ARENA_W,ARENA_H);
    }

    // Particles
    particles=particles.filter(function(p){return p.life>0;});
    particles.forEach(function(p){
      p.x+=p.vx;p.y+=p.vy;p.vx*=0.93;p.vy*=0.93;p.life-=p.decay;
      ctx.save(); ctx.globalAlpha=Math.max(0,p.life);
      ctx.fillStyle=p.color; ctx.shadowColor=p.color; ctx.shadowBlur=5;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); ctx.restore();
    });

    animFrame = requestAnimationFrame(drawFrame);
  }

  function onTap(e) {
    if (done) return;
    e.preventDefault();
    var rect = arena.getBoundingClientRect();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    // Both rect and clientX/Y are in visual (scaled) px — ratio gives canvas coords
    var tapX = (cx - rect.left) * (ARENA_W / rect.width);
    var tapY = (cy - rect.top) * (ARENA_H / rect.height);

    var hit=null,hitD=Infinity;
    objects.forEach(function(obj,idx){
      if(obj.tapped||obj.found) return;
      if(!litState[idx]) return;
      var d=Math.hypot(obj.x-tapX,obj.y-tapY);
      if(d<OBJ_R*2.4&&d<hitD){hit=obj;hitD=d;}
    });
    if (!hit) return;
    hit.tapped=true;

    if (hit.type==='coin') {
      hit.found=true; coinsFound++;
      spawnSparks(hit.x,hit.y,22,'#F5D000');
      var dot=document.getElementById('tdot-'+(coinsFound-1));
      if(dot){dot.style.opacity='1';dot.style.textShadow='0 0 8px #F5D000';}
      if(coinsFound===totalCoins) { endGame(false); }
    } else {
      // Cheese tap: collect +1 cheese, do NOT end game — torch continues until all coins found or burnout
      hit.found=true; cheeseFound++;
      spawnSparks(hit.x,hit.y,16,'#FFD96A');
    }
  }

  arena.addEventListener('click', onTap);
  arena.addEventListener('touchstart', onTap, {passive:false});

  var _initAttempts=0;
  function tryInit() {
    // With transform:scale, offsetWidth is always true unscaled layout pixels
    var w = arena.offsetWidth;
    var h = arena.offsetHeight;
    if(w>20&&h>20){
      canvas.width = w;
      canvas.height = h;
      ARENA_W = w; ARENA_H = h;
      LIGHT_R_MAX = Math.round(Math.min(w, h) * 0.35);
      LIGHT_R = LIGHT_R_MAX;
      placeObjects(); initTorch(); requestAnimationFrame(drawFrame);
    } else if(_initAttempts<20){ _initAttempts++; setTimeout(tryInit,60); }
  }
  setTimeout(tryInit,60);
}




function finishGoldGame(amount, total, wrongTap, cheeseFound) {
  client.send('resolveEvent', { cls: MY_CLASS, eventType: 'gold', amount: amount, total: total||0, wrongTap: wrongTap||false, cheeseFound: cheeseFound||0 });
  var container = document.getElementById('gold-game-container');
  if (!container) return;

  var missed = (total || _goldGameMax) - amount;
  var isCrack = (_goldGameVariant === 'crack');

  // ── Build the big stat line ──
  var statLine = '';
  var flav = '';
  var hpLine = '';
  var cheeseLine = '';

  // Cheese row — torch only (crack doesn't spawn cheese)
  if (!isCrack && cheeseFound > 0) {
    var cheeseIcons = '';
    for (var cj=0; cj<cheeseFound; cj++) cheeseIcons += '<span style="font-size:24px;line-height:1;display:inline-block;margin:1px;">🧀</span>';
    cheeseLine = '<div style="display:flex;justify-content:center;flex-wrap:wrap;margin-bottom:4px;">' + cheeseIcons + '</div>'
      + '<div style="font-size:11px;color:#FFD96A;margin-bottom:6px;">+' + cheeseFound + ' 🧀 cheese</div>';
  }

  if (wrongTap && amount === 0 && isCrack) {
    // Crack: rat bite, nothing found
    statLine = '<div style="font-family:Cinzel,serif;font-size:28px;color:var(--red);margin-bottom:6px;">\u22121 \u2764\ufe0f</div>';
    var ratLines = ['Something bit back.','The rat was faster.','That was teeth, not coin.','The crack had other occupants.'];
    flav = ratLines[Math.floor(Math.random()*ratLines.length)];
  } else if (amount === 0 && cheeseFound === 0) {
    // Torch burned out, nothing found
    var burnoutLines = ['The torch gave everything it had.','Light gone. The floor keeps its secrets.','The dark reclaims the floor.','It burns out. Nothing to show.','Flame out.'];
    flav = burnoutLines[Math.floor(Math.random()*burnoutLines.length)];
  } else {
    // Coins found (optionally plus cheese)
    if (amount > 0) {
      var coinIcons = '';
      for (var ci=0; ci<amount; ci++) coinIcons += '<span style="font-size:28px;line-height:1;display:inline-block;margin:1px;">&#129689;</span>';
      statLine = '<div style="display:flex;justify-content:center;flex-wrap:wrap;margin-bottom:6px;">' + coinIcons + '</div>';
    }
    if (wrongTap && isCrack) {
      // Rat bite + coins
      var ratBiteLines = [
        'Could have done without the teeth.',
        'Found some. Then found the rat.',
        'Coins in one hand, bite marks on the other.',
        'Not bad. The rat disagrees.',
        'Worth it. Probably.',
        'The rat wanted its cut.'
      ];
      flav = ratBiteLines[Math.floor(Math.random()*ratBiteLines.length)];
      hpLine = '<div style="font-size:13px;color:var(--red);">\u22121 \u2764\ufe0f rat bite</div>';
    } else {
      var zone = (G.activeEvent && G.activeEvent.zone !== undefined ? G.activeEvent.zone : _goldGameZone) || 0;
      var zoneKey = 'gold_z' + (zone + 1);
      var pool = LANDING_FLAVOR[zoneKey] || LANDING_FLAVOR.gold_z1 || [];
      flav = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    }
  }

  container.innerHTML = '<div style="margin-top:10px;padding:14px;background:#1a1200;border:2px solid var(--gold)66;border-radius:12px;text-align:center;">'
    + statLine
    + cheeseLine
    + hpLine
    + (flav ? '<div style="font-size:13px;color:var(--text-dim);font-style:italic;line-height:1.5;margin-bottom:6px;">' + flav + '</div>' : '')
    + '<div style="font-size:10px;color:var(--text-faint);font-family:Cinzel,serif;letter-spacing:.04em;">WAITING FOR DM</div>'
    + '</div>';
  // v0.15.38 NOTE: gold-game finish renders into #gold-game-container (a child
  // of #landing-result) via this custom HTML rather than buildResolutionCard.
  // Migration to buildResolutionCard would be cleaner but requires routing
  // the container to be a sibling of the resolution card area, OR teaching
  // buildResolutionCard to render into a passed-in container. Deferred —
  // the gold-game card already shows rewards visually; the v0.15.36
  // goldGained/brickGained FX still fires through the rewardPopup server
  // event flow when DM marks resolved. The Collect-button gating is missing
  // for gold games specifically, but the inventory-flow FX visual is intact.
  // See parking lot at end of NOTES.md for the gold-game Collect migration.
}




// ── GATE ACTIONS ──

// Step 1: Player tapped a brick on another player — they want that brick
// Show modal to choose what to offer in return
// Step 1: Player taps a brick on another player — select what to want, then what to offer
var _tradeTarget = null;
var _tradeWantAmounts = {};
var _tradeOfferAmounts = {};
var _tradeStep = 'want'; // 'want' or 'offer'

function startTradeRequest(targetCls, wantColor) {
  var me = G.players[MY_CLASS];
  var target = G.players[targetCls];
  if (!me || !target) return;
  _tradeTarget = targetCls;
  _tradeWantAmounts = {};
  _tradeOfferAmounts = {};
  // If arriving from a brick tap, pre-fill want and go straight to offer step
  if (wantColor) {
    _tradeWantAmounts[wantColor] = 1;
    _tradeStep = 'offer';
  } else {
    _tradeStep = 'want';
  }
  _showTradeComposer(targetCls);
}

function _showTradeComposer(targetCls) {
  var me = G.players[MY_CLASS];
  var target = G.players[targetCls];
  if (!me || !target) return;
  var tColor = PLAYER_META[targetCls].color;
  var existing = document.getElementById('trade-composer');
  if (existing) existing.remove();

  var isWantStep = (_tradeStep === 'want');

  // Build want rows (their bricks — no limit)
  var wantRows = '';
  BRICK_NAMES.forEach(function(k) {
    var have = target.bricks[k]||0;
    if (!have) return;
    var bg=BRICK_COLORS[k]; var bdr=k==='white'?'border:1px solid #ccc;':'';
    var tc=(k==='white'||k==='yellow')?'#333':bg;
    var qty = _tradeWantAmounts[k]||0;
    wantRows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="width:20px;height:20px;border-radius:3px;background:'+bg+';'+bdr+'display:inline-block;flex-shrink:0;"></span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:'+tc+';flex:1;">'+k+'</span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+have+' avail</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="event.stopPropagation();adjustTradeWant(\''+k+'\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="twant-qty-'+k+'" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">'+qty+'</span>'
      +'<button onclick="event.stopPropagation();adjustTradeWant(\''+k+'\',1)" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  });
  // Want cheese row — can want cheese from them if they have any
  var targetCheese = target.cheese||0;
  if (targetCheese > 0) {
    var wcQty = _tradeWantAmounts.cheese||0;
    wantRows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="font-size:18px;line-height:1;">&#129472;</span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:#FFD96A;flex:1;"></span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+targetCheese+' avail</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="event.stopPropagation();adjustTradeWant(\'cheese\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="twant-qty-cheese" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">'+wcQty+'</span>'
      +'<button onclick="event.stopPropagation();adjustTradeWant(\'cheese\',1)" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  }

  // Build offer rows (my bricks)
  var offerRows = '';
  BRICK_NAMES.forEach(function(k) {
    var have = me.bricks[k]||0; if (!have) return;
    var bg=BRICK_COLORS[k]; var bdr=k==='white'?'border:1px solid #ccc;':'';
    var tc=(k==='white'||k==='yellow')?'#333':bg;
    var qty = _tradeOfferAmounts[k]||0;
    offerRows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="width:20px;height:20px;border-radius:3px;background:'+bg+';'+bdr+'display:inline-block;flex-shrink:0;"></span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:'+tc+';flex:1;">'+k+'</span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+have+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\''+k+'\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="toffer-qty-'+k+'" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">'+qty+'</span>'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\''+k+'\',1,'+have+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  });
  // Gold offer row
  var myGold = me.gold||0;
  if (myGold > 0) {
    var gQty = _tradeOfferAmounts.gold||0;
    offerRows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="font-size:18px;line-height:1;">&#129689;</span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:var(--gold);flex:1;"></span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+myGold+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\'gold\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="toffer-qty-gold" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">'+gQty+'</span>'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\'gold\',1,'+myGold+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  }
  // Cheese offer row — offer cheese alongside bricks/gold
  var myCheeseT = me.cheese||0;
  if (myCheeseT > 0) {
    var ocQty = _tradeOfferAmounts.cheese||0;
    offerRows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="font-size:18px;line-height:1;">&#129472;</span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:#FFD96A;flex:1;"></span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+myCheeseT+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\'cheese\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="toffer-qty-cheese" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">'+ocQty+'</span>'
      +'<button onclick="event.stopPropagation();adjustTradeOffer(\'cheese\',1,'+myCheeseT+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  }

  // Summary icons for headers
  function buildIcons(amounts, isOther) {
    var icons = '';
    BRICK_NAMES.forEach(function(k){
      var qty = amounts[k]||0; if(!qty)return;
      var bg=BRICK_COLORS[k]; var bdr=k==='white'?'border:1px solid #ccc;':'';
      for(var i=0;i<qty;i++) icons+='<span style="width:16px;height:16px;border-radius:2px;background:'+bg+';'+bdr+'display:inline-block;margin:1px;box-shadow:0 1px 2px rgba(0,0,0,.4);"></span>';
    });
    if((amounts.gold||0)>0) icons+='<span style="font-size:14px;vertical-align:middle;margin:1px;">&#129689;</span><span style="font-size:11px;color:var(--gold);">'+amounts.gold+'</span>';
    if((amounts.cheese||0)>0) icons+='<span style="font-size:14px;vertical-align:middle;margin:1px;">&#129472;</span><span style="font-size:11px;color:#FFD96A;">'+amounts.cheese+'</span>';
    return icons || '<span style="font-size:11px;color:var(--text-faint);">—</span>';
  }

  var wantSummary = buildIcons(_tradeWantAmounts, true);
  var offerSummary = buildIcons(_tradeOfferAmounts, false);

  var modal = document.createElement('div');
  modal.id = 'trade-composer';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = '<div style="background:#1a1a1a;border:1px solid '+tColor+';border-radius:14px;padding:20px;width:100%;max-width:340px;max-height:85vh;overflow-y:auto;">'
    // Header
    +'<div style="font-family:Cinzel,serif;font-size:13px;color:'+tColor+';margin-bottom:14px;">&#x21C4; Trade with '+target.icon+' '+(target.playerName||target.name)+'</div>'
    // Summary bar
    +'<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0a0a0a;border-radius:10px;margin-bottom:14px;font-size:11px;">'
    +'<div style="flex:1;text-align:center;">'
    +'<div style="font-size:9px;font-family:Cinzel,serif;letter-spacing:.05em;color:var(--text-faint);margin-bottom:4px;">YOU WANT</div>'
    +'<div style="display:flex;flex-wrap:wrap;justify-content:center;min-height:18px;align-items:center;">'+wantSummary+'</div></div>'
    +'<div style="font-size:18px;color:var(--text-faint);">&#x21C4;</div>'
    +'<div style="flex:1;text-align:center;">'
    +'<div style="font-size:9px;font-family:Cinzel,serif;letter-spacing:.05em;color:var(--text-faint);margin-bottom:4px;">YOU OFFER</div>'
    +'<div style="display:flex;flex-wrap:wrap;justify-content:center;min-height:18px;align-items:center;">'+offerSummary+'</div></div>'
    +'</div>'
    // Step tabs
    +'<div style="display:flex;gap:6px;margin-bottom:12px;">'
    +'<button onclick="event.stopPropagation();_tradeStep=\'want\';_showTradeComposer(\''+targetCls+'\')" style="flex:1;padding:8px;border-radius:8px;font-family:Cinzel,serif;font-size:11px;cursor:pointer;background:'+(isWantStep?'var(--cls-color)':'#222')+';border:1px solid '+(isWantStep?'var(--cls-color)':'#444')+';color:'+(isWantStep?'#000':'var(--text-dim)')+';">&#8592; Want</button>'
    +'<button onclick="event.stopPropagation();_tradeStep=\'offer\';_showTradeComposer(\''+targetCls+'\')" style="flex:1;padding:8px;border-radius:8px;font-family:Cinzel,serif;font-size:11px;cursor:pointer;background:'+(!isWantStep?'var(--cls-color)':'#222')+';border:1px solid '+(!isWantStep?'var(--cls-color)':'#444')+';color:'+(!isWantStep?'#000':'var(--text-dim)')+';">Offer &#8594;</button>'
    +'</div>'
    // Content
    +(isWantStep
      ? (wantRows||'<div style="font-size:12px;color:var(--text-faint);padding:8px 0;">They have no bricks.</div>')
      : (offerRows||'<div style="font-size:12px;color:var(--text-faint);padding:8px 0;">You have nothing to offer.</div>'))
    // Actions
    +'<div style="display:flex;gap:8px;margin-top:8px;">'
    +'<button class="btn" style="flex:1;" onclick="document.getElementById(\'trade-composer\').remove();">Cancel</button>'
    +'<button class="btn warn" style="flex:1;" onclick="event.stopPropagation();confirmTradeOffer(\''+targetCls+'\')">Trade</button>'
    +'</div></div>';
  document.body.appendChild(modal);
}

function adjustTradeWant(key, delta) {
  var cur = _tradeWantAmounts[key]||0;
  _tradeWantAmounts[key] = Math.max(0, cur+delta);
  var el = document.getElementById('twant-qty-'+key);
  if (el) el.textContent = _tradeWantAmounts[key];
}

function adjustTradeOffer(key, delta, max) {
  var cur = _tradeOfferAmounts[key]||0;
  var nv = Math.max(0, cur+delta);
  if (max !== undefined) nv = Math.min(nv, max);
  _tradeOfferAmounts[key] = nv;
  var el = document.getElementById('toffer-qty-'+key);
  if (el) el.textContent = nv;
}

function confirmTradeOffer(targetCls) {
  var hasWant = Object.values(_tradeWantAmounts).some(function(v){return v>0;});
  var hasOffer = Object.values(_tradeOfferAmounts).some(function(v){return v>0;});
  if (!hasWant) { toast('Select what you want', 'warn'); return; }
  if (!hasOffer) { toast('Select something to offer', 'warn'); return; }
  var wantBricks = {};
  BRICK_NAMES.forEach(function(k){ if((_tradeWantAmounts[k]||0)>0) wantBricks[k]=_tradeWantAmounts[k]; });
  var offerBricks = {};
  BRICK_NAMES.forEach(function(k){ if((_tradeOfferAmounts[k]||0)>0) offerBricks[k]=_tradeOfferAmounts[k]; });
  var offerGold   = _tradeOfferAmounts.gold   || 0;
  var offerCheese = _tradeOfferAmounts.cheese || 0;
  var wantCheese  = _tradeWantAmounts.cheese  || 0;
  client.offerTrade(MY_CLASS, targetCls, wantBricks, offerBricks, offerGold, wantCheese, offerCheese);
  document.getElementById('trade-composer')?.remove();
  _pendingTradeSent = { fromCls: MY_CLASS, targetCls, wantBricks, wantCheese, offerBricks, offerGold, offerCheese };
  var targetName = G.players[targetCls]?.playerName || G.players[targetCls]?.name || targetCls;
  var banner = document.getElementById('phase-banner');
  if (banner) {
    var prev=banner.textContent; var prevClass=banner.className;
    banner.className='phase-banner mine';
    banner.textContent='Trade offer sent to '+targetName+'...';
    setTimeout(function(){if(banner){banner.textContent=prev;banner.className=prevClass;}},3000);
  }
  _tradeWantAmounts={}; _tradeOfferAmounts={};
  render();
}





// Legacy alias
function openTradeComposer(targetCls) { startTradeRequest(targetCls, null); }
function sendTradeOffer(targetCls, color) { confirmTradeOffer(targetCls, null, color); }

// ═══════════════════════════════════════════
//  PARTY TAB
// ═══════════════════════════════════════════
function renderParty() {
  const el = document.getElementById('pane-party');
  if(!el)return;
  const me = G.players[MY_CLASS];
  let html='';

  if (_pendingTradeSent && _pendingTradeSent.fromCls === MY_CLASS) {
    var pt = _pendingTradeSent;
    var ptTarget = G.players[pt.targetCls];
    var ptName = ptTarget ? (ptTarget.playerName||ptTarget.name) : pt.targetCls;
    var ptColor = PLAYER_META[pt.targetCls]?.color || '#888';
    var wBg2 = BRICK_COLORS[pt.wantColor]||'#888';
    var offerBricks2 = pt.offerBricks || (pt.offerColor ? {[pt.offerColor]:1} : {});
    var wantBricks2 = pt.wantBricks || (pt.wantColor ? {[pt.wantColor]:1} : {});
    var offerIcons2 = '';
    Object.entries(offerBricks2).forEach(function(e){ var k=e[0];var qty=e[1];var bg=BRICK_COLORS[k]||'#888';var bdr=k==='white'?'border:1px solid #ccc;':'';for(var i=0;i<qty;i++)offerIcons2+='<span style="width:18px;height:18px;border-radius:3px;background:'+bg+';'+bdr+'display:inline-block;margin:1px;"></span>'; });
    if (pt.offerGold>0) offerIcons2+='<span style="font-size:14px;vertical-align:middle;">&#129689;</span><span style="font-size:11px;color:var(--gold);">'+pt.offerGold+'</span>';
    if ((pt.offerCheese||0)>0) offerIcons2+='<span style="font-size:14px;vertical-align:middle;">&#129472;</span><span style="font-size:11px;color:#FFD96A;">'+pt.offerCheese+'</span>';
    var wantIcons2 = '';
    Object.entries(wantBricks2).forEach(function(e){ var k=e[0];var qty=e[1];var bg=BRICK_COLORS[k]||'#888';var bdr=k==='white'?'border:1px solid #ccc;':'';for(var i=0;i<qty;i++)wantIcons2+='<span style="width:18px;height:18px;border-radius:3px;background:'+bg+';'+bdr+'display:inline-block;margin:1px;"></span>'; });
    if ((pt.wantCheese||0)>0) wantIcons2+='<span style="font-size:14px;vertical-align:middle;">&#129472;</span><span style="font-size:11px;color:#FFD96A;">'+pt.wantCheese+'</span>';
    html += '<div style="background:#1a1500;border:2px solid var(--gold);border-radius:12px;padding:12px 14px;margin-bottom:10px;text-align:center;">'
      + '<div style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.06em;color:var(--gold);margin-bottom:6px;">AWAITING RESPONSE</div>'
      + '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Trade sent to <span style="color:'+ptColor+';font-weight:700;">'+(ptTarget?.icon||'')+' '+ptName+'</span></div>'
      + '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:10px;">'
      + '<div style="text-align:center;"><div style="display:flex;flex-wrap:wrap;justify-content:center;min-height:22px;">'+offerIcons2+'</div><div style="font-size:9px;color:var(--text-dim);margin-top:2px;">you give</div></div>'
      + '<span style="font-size:16px;color:var(--text-faint);">&#x21C4;</span>'
      + '<div style="text-align:center;"><div style="display:flex;flex-wrap:wrap;justify-content:center;min-height:22px;">'+wantIcons2+'</div><div style="font-size:9px;color:var(--text-dim);margin-top:2px;">you get</div></div>'
      + '</div>'
      + '<button class="btn" style="font-size:12px;color:var(--red);" onclick="_pendingTradeSent=null;client.send(\'cancelTrade\',{});render();">Cancel</button>'
      + '</div>';
  }

  Object.entries(G.players).filter(function(e){return e[0]!==MY_CLASS;}).forEach(function(entry) {
    var cls=entry[0]; var p=entry[1];
    var isOh=p.hp>p.hpMax;
    var hpPct=Math.min(100,Math.max(0,Math.round(p.hp/p.hpMax*100)));
    var hc=isOh?'#b06fef':p.hp<=Math.floor(p.hpMax*.25)?'#E24B4A':p.hp<=Math.floor(p.hpMax*.5)?'#EF9F27':'#1D9E75';
    var hpBg=isOh?'linear-gradient(90deg,#7B2FBE,#b06fef)':hc;
    var pColor=PLAYER_META[cls].color;
    var statuses=(p.statusEffects||[]).map(function(s){return '<span class="status-badge '+s+'">'+s+'</span>';}).join('');
    var brickDots = renderBrickPips(
      p.bricks, p.bricksCharged, p.lastDropped,
      { size: 14, clickable: p.connected ? { targetCls: cls } : null }
    );
    html+='<div '+(p.connected?'onclick="openGivePanel(\''+cls+'\')" ':'')+'style="padding:12px;border-radius:12px;background:var(--surface3);border:1px solid #2a2a2a;margin-bottom:8px;'+(p.connected?'cursor:pointer;':'')+'">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
      +'<span style="font-size:22px;">'+p.icon+'</span>'
      +'<div style="flex:1;">'
      +'<div style="font-family:Cinzel,serif;font-size:12px;font-weight:700;color:'+pColor+';">'+(p.playerName||p.name)+(p.connected?'':' <span style="font-size:9px;color:#555;">(offline)</span>')+'</div>'
      +'<div style="height:3px;border-radius:2px;background:#222;margin-top:3px;overflow:hidden;"><div style="width:'+hpPct+'%;height:100%;background:'+hpBg+';border-radius:2px;'+(isOh?'box-shadow:0 0 4px #b06fef88;':'')+'"></div></div>'
      +'</div>'
      +'<div style="font-size:11px;color:'+hc+';">'+p.hp+'/'+p.hpMax+'</div>'
      +'</div>'
      +'<div style="font-size:10px;color:var(--text-faint);margin-bottom:6px;">'+(SPACES[p.space]?.label||'Start')+' &middot; &#129689;'+p.gold+' &middot; &#128737;'+(p.armor||0)+'</div>'
      +(statuses?'<div style="margin-bottom:6px;">'+statuses+'</div>':'')
      +(brickDots
        ?'<div style="display:flex;flex-wrap:wrap;margin-bottom:6px;">'+brickDots+'</div>'
          +(p.connected?'<div style="font-size:9px;color:var(--text-faint);margin-bottom:6px;">Tap brick to trade &middot; tap card to give</div>':'')
        :'<div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">No bricks</div>')
      +'</div>';
  });

  if(me){
    var myHpPct=Math.max(0,Math.round(me.hp/me.hpMax*100));
    var myHc=me.hp<=Math.floor(me.hpMax*.25)?'#E24B4A':me.hp<=Math.floor(me.hpMax*.5)?'#EF9F27':'#1D9E75';
    var myBricks = renderBrickPips(me.bricks, me.bricksCharged, me.lastDropped, { size: 10 });
    html+='<div style="padding:10px 12px;border-radius:12px;border:1px solid var(--cls-color);margin-bottom:8px;opacity:.7;">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
      +'<span style="font-size:16px;">'+me.icon+'</span>'
      +'<span style="font-family:Cinzel,serif;font-size:11px;color:var(--cls-color);">'+(me.playerName||me.name)+' (You)</span>'
      +'<div style="flex:1;height:3px;border-radius:2px;background:#222;margin:0 6px;overflow:hidden;"><div style="width:'+myHpPct+'%;height:100%;background:'+myHc+';border-radius:2px;"></div></div>'
      +'<span style="font-size:11px;color:'+myHc+';">'+me.hp+'/'+me.hpMax+'</span>'
      +'</div>'
      +(myBricks?'<div style="display:flex;flex-wrap:wrap;">'+myBricks+'</div>':'')
      +'</div>';
  }

  el.innerHTML=html;
}

var _giveAmounts = {};
function openGivePanel(targetCls) {
  var me=G.players[MY_CLASS]; var target=G.players[targetCls];
  if(!me||!target)return;
  var tColor=PLAYER_META[targetCls].color;
  var existing=document.getElementById('give-composer');
  if(existing)existing.remove();
  _giveAmounts={};
  var rows='';
  BRICK_NAMES.forEach(function(k){
    var have=me.bricks[k]||0; if(!have)return;
    var bg=BRICK_COLORS[k]; var bdr=k==='white'?'border:1px solid #ccc;':'';
    var tc=(k==='white'||k==='yellow')?'#333':bg;
    rows+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="width:20px;height:20px;border-radius:3px;background:'+bg+';'+bdr+'display:inline-block;flex-shrink:0;"></span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:'+tc+';flex:1;">'+k+'</span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+have+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="adjustGive(\''+k+'\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="give-qty-'+k+'" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">0</span>'
      +'<button onclick="adjustGive(\''+k+'\',1,'+have+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  });
  var myGold=me.gold||0;
  if(myGold>0){
    rows+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="font-size:18px;line-height:1;">&#129689;</span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:var(--gold);flex:1;"></span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+myGold+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="adjustGive(\'gold\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="give-qty-gold" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">0</span>'
      +'<button onclick="adjustGive(\'gold\',1,'+myGold+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  }
  // 0.14.0: cheese is giftable through the same unified give panel
  // (no more separate cheese-modal gift flow). Eat-cheese-on-self stays
  // standalone via showCheeseActions().
  var myCheese=me.cheese||0;
  if(myCheese>0){
    rows+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      +'<span style="font-size:18px;line-height:1;">&#129472;</span>'
      +'<span style="font-family:Cinzel,serif;font-size:12px;color:#FFD96A;flex:1;"></span>'
      +'<span style="font-size:11px;color:var(--text-dim);">x'+myCheese+'</span>'
      +'<div style="display:flex;align-items:center;gap:6px;">'
      +'<button onclick="adjustGive(\'cheese\','+-1+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8722;</button>'
      +'<span id="give-qty-cheese" style="min-width:24px;text-align:center;font-family:Cinzel,serif;font-size:14px;">0</span>'
      +'<button onclick="adjustGive(\'cheese\',1,'+myCheese+')" style="width:28px;height:28px;border-radius:50%;background:#222;border:1px solid #444;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>'
      +'</div></div>';
  }
  var modal=document.createElement('div');
  modal.id='give-composer';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML='<div style="background:#1a1a1a;border:1px solid '+tColor+';border-radius:14px;padding:20px;width:100%;max-width:340px;">'
    +'<div style="font-family:Cinzel,serif;font-size:13px;color:'+tColor+';margin-bottom:14px;">&#8594; Give to '+target.icon+' '+(target.playerName||target.name)+'</div>'
    +(rows||'<div style="font-size:12px;color:var(--text-faint);padding:8px 0;">Nothing to give.</div>')
    +'<div style="display:flex;gap:8px;margin-top:6px;">'
    +'<button class="btn" style="flex:1;" onclick="document.getElementById(\'give-composer\').remove();">Cancel</button>'
    +'<button class="btn success" style="flex:1;" onclick="confirmGive(\''+targetCls+'\')">Give</button>'
    +'</div></div>';
  document.body.appendChild(modal);
}

function adjustGive(key,delta,max){
  var cur=_giveAmounts[key]||0;
  var nv=Math.max(0,cur+delta);
  if(max!==undefined)nv=Math.min(nv,max);
  _giveAmounts[key]=nv;
  var el=document.getElementById('give-qty-'+key);
  if(el)el.textContent=nv;
}

function confirmGive(targetCls){
  var hasSomething=Object.values(_giveAmounts).some(function(v){return v>0;});
  if(!hasSomething){toast('Select something to give','warn');return;}
  var bricks={};
  BRICK_NAMES.forEach(function(k){if((_giveAmounts[k]||0)>0)bricks[k]=_giveAmounts[k];});
  var goldAmt=_giveAmounts.gold||0;
  var cheeseAmt=_giveAmounts.cheese||0;
  client.send('giveItems',{fromCls:MY_CLASS,targetCls:targetCls,bricks:bricks,gold:goldAmt,cheese:cheeseAmt});
  document.getElementById('give-composer')?.remove();
  _giveAmounts={};
  var tName=G.players[targetCls]?.playerName||G.players[targetCls]?.name||targetCls;
  toast('Gave to '+tName,'normal');
  render();
}



// ── TRADE MODAL ──
function showTradeModal(offer) {
  pendingTradeOffer = offer;
  const from = G.players[offer.fromCls];
  const fromName = from?.playerName || from?.name || offer.fromCls;
  const fromColor = PLAYER_META[offer.fromCls]?.color || '#888';
  const wantBg = BRICK_COLORS[offer.wantColor] || '#888';
  const wantBdr = offer.wantColor==='white' ? 'border:1px solid #ccc;' : '';

  // Build want items display (what they want from you)
  var wantBricks = offer.wantBricks || (offer.wantColor ? {[offer.wantColor]:1} : {});
  var wantItems = '';
  Object.entries(wantBricks).forEach(function(e) {
    var k=e[0]; var qty=e[1];
    var bg=BRICK_COLORS[k]||'#888'; var bdr=k==='white'?'border:1px solid #ccc;':'';
    for (var i=0;i<qty;i++) wantItems+='<span style="width:26px;height:26px;border-radius:4px;background:'+bg+';'+bdr+'display:inline-block;margin:2px;box-shadow:0 1px 4px rgba(0,0,0,.5);"></span>';
  });
  if ((offer.wantCheese||0) > 0) {
    wantItems += '<span style="font-size:22px;vertical-align:middle;margin:2px;">&#129472;</span><span style="font-size:13px;color:#FFD96A;font-family:Cinzel,serif;vertical-align:middle;">'+offer.wantCheese+'</span>';
  }

  // Build offer items display (what they give you — bricks + gold + cheese)
  var offerItems = '';
  var offerBricks = offer.offerBricks || (offer.offerColor ? {[offer.offerColor]:1} : {});
  Object.entries(offerBricks).forEach(function(e) {
    var k=e[0]; var qty=e[1];
    var bg=BRICK_COLORS[k]||'#888'; var bdr=k==='white'?'border:1px solid #ccc;':'';
    for (var i=0;i<qty;i++) {
      offerItems += '<span style="width:26px;height:26px;border-radius:4px;background:'+bg+';'+bdr+'display:inline-block;margin:2px;box-shadow:0 1px 4px rgba(0,0,0,.5);"></span>';
    }
  });
  if (offer.offerGold > 0) {
    offerItems += '<span style="font-size:18px;vertical-align:middle;margin:2px;">&#129689;</span><span style="font-size:13px;color:var(--gold);font-family:Cinzel,serif;vertical-align:middle;">'+offer.offerGold+'</span>';
  }
  if ((offer.offerCheese||0) > 0) {
    offerItems += '<span style="font-size:22px;vertical-align:middle;margin:2px;">&#129472;</span><span style="font-size:13px;color:#FFD96A;font-family:Cinzel,serif;vertical-align:middle;">'+offer.offerCheese+'</span>';
  }

  document.getElementById('trade-modal-body').innerHTML =
    '<div style="font-family:Cinzel,serif;font-size:12px;color:'+fromColor+';margin-bottom:12px;">'+(from?.icon||'')+' '+fromName+' wants to trade with you</div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
    // They give
    +'<div style="flex:1;text-align:center;padding:12px;background:#11110a;border:2px solid '+fromColor+'44;border-radius:10px;">'
    +'<div style="font-size:9px;font-family:Cinzel,serif;letter-spacing:.06em;color:var(--text-dim);margin-bottom:8px;">THEY GIVE YOU</div>'
    +'<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:2px;min-height:30px;align-items:center;">'+offerItems+'</div>'
    +'</div>'
    +'<div style="font-size:22px;color:var(--text-dim);">&#x21C4;</div>'
    // You give
    +'<div style="flex:1;text-align:center;padding:12px;background:#0a0a12;border:2px solid #4db8ff44;border-radius:10px;">'
    +'<div style="font-size:9px;font-family:Cinzel,serif;letter-spacing:.06em;color:var(--text-dim);margin-bottom:8px;">YOU GIVE THEM</div>'
    +'<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:2px;min-height:30px;align-items:center;">'+wantItems+'</div>'
    +'</div>'
    +'</div>';

  document.getElementById('trade-modal').classList.add('visible');
  var banner = document.getElementById('phase-banner');
  if (banner) { banner.className = 'phase-banner battle-mine'; banner.textContent = '&#x1F504; TRADE REQUEST — Respond Now!'; }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

function respondTrade(accept) {
  if(!pendingTradeOffer)return;
  client.respondTrade(pendingTradeOffer.id, accept);
  pendingTradeOffer=null;
  document.getElementById('trade-modal').classList.remove('visible');
  // Restore phase banner
  try { renderPhaseBanner(G.players[MY_CLASS]); } catch(e) {}
  toast(accept?'✓ Trade accepted!':'Trade declined','normal');
}

// ── DISARM CHAIN ──

// showRewardPopup — fallback for unknown reward kinds. Brick/gold/shield
// rewards now flow through boardFx (v0.15.36). This function only fires
// if the server emits a rewardPopup with a kind we haven't migrated yet
// (defensive — currently no such kind exists). When that happens, shows
// a minimal must-click card with the kind as a label so the reward isn't
// silently lost. New reward kinds should ideally migrate to boardFx
// directly rather than land here.
function showRewardPopup(data) {
  var kind = data.kind || 'reward';
  _pendingResult = {
    border: '#888',
    title: '',
    icon: '',
    mainNum: null,
    detail: '',
    kind: 'victory',
    brickDots: '<span style="font-size:13px;color:#aaa;">+1 ' + kind + '</span>'
  };
  render();
}

function showGateResult(msg, success) {
  _pendingResult = {
    border: success ? 'var(--green)' : 'var(--red)',
    title: success ? 'Gate Forced Open!' : 'Gate Held Firm',
    icon: success ? '🔓' : '🔒',
    mainNum: null,
    detail: msg,
    kind: 'gate'
  };
  render();
}

function showDashResult(data) {
  // Summarize outcome: any gate events, damage, final destination
  var events = data.gateEvents || [];
  var hadBreak = events.some(function(g){ return g.kind === 'break_success'; });
  var hadFail  = events.some(function(g){ return g.kind === 'break_fail'; });
  var hadKeyStop = events.some(function(g){ return g.kind === 'key_stop'; });
  var flavor = data.flavor || {};
  var lines = [];
  if (hadKeyStop) {
    lines.push('A locked magical gate bars the way. The dash ends.');
  }
  if (hadBreak) {
    lines.push(flavor.success || 'Crashed through!');
  }
  if (hadFail) {
    lines.push(flavor.fail || 'The gate held.');
  }
  if (!events.length) {
    lines.push((data.forcedByDM ? '[DM forced] ' : '') + 'Dashed ' + (data.end - data.start) + ' space' + ((data.end-data.start)===1?'':'s') + '.');
  }
  var dmgLine = data.totalDmg > 0
    ? '−' + data.totalDmg + ' HP' + (data.totalArmorAbsorbed>0?' ('+data.totalArmorAbsorbed+' absorbed by armor)':'')
    : data.totalArmorAbsorbed > 0 ? 'Armor absorbed all damage (' + data.totalArmorAbsorbed + ')' : '';
  var allClear = !hadFail && !hadKeyStop;
  _pendingResult = {
    border: hadFail ? 'var(--red)' : hadKeyStop ? 'var(--yellow)' : allClear ? 'var(--green)' : 'var(--orange)',
    title: data.forcedByDM ? 'Forced Dash' : (hadFail ? 'Dash Stopped' : hadBreak ? 'Through the Gate!' : hadKeyStop ? 'Gate Sealed' : 'Dashed!'),
    icon: hadBreak ? '💥' : hadFail ? '🛑' : hadKeyStop ? '🗝️' : '⚡',
    mainNum: data.totalDmg > 0 ? -data.totalDmg : null,
    detail: lines.join(' ') + (dmgLine ? '\n' + dmgLine : ''),
    kind: 'dash'
  };
  render();
}

function handleDisarmChain(data) {
  if(data.continueDisarm) {
    toast('Disarm continues!', 'success');
  } else {
    toast('Disarm stopped', 'normal');
  }
}

// ═══════════════════════════════════════════════════════
// v4 CHEESE / POISON / PURPLE FATED CHOICE FUNCTIONS
// ═══════════════════════════════════════════════════════



// giftCheeseTo kept for backwards-compat with any stragglers that still call it
// (server handler 'giftCheese' also still works). Unified give panel is the
// preferred path going forward.


// ── PURPLE FATED CHOICE CARD ──
// ── RESOLUTION CARD HELPERS (consistent blue-style cards across all events) ──
// Every event's completed-result state should render through buildResolutionCard.
// Fields:
//   themeColor  — hex/css color for title + accents (e.g. '#9adb9a' for green success)
//   borderColor — hex/css color for the bordered frame (themeColor + 44/66 alpha works)
//   bgColor     — dark themed background (e.g. '#020a14' for blue, '#1a0a10' for red)
//   title       — big Cinzel title text (e.g. '✨ BLESSED ✨' or '🏆 PERFECT')
//   rewardIcons — HTML string from renderRewardIcons (or empty for text-only results)
//   spec        — structured reward spec passed to renderRewardIcons; when present
//                 with at least one reward (bricks/coins/cheese/shield), the card
//                 renders a Collect button that fires boardFx + sends server msg.
//                 v0.15.37: pairs with rewardIcons. spec drives the FX dispatch;
//                 rewardIcons drives the visual preview. Both should be passed.
//   flavor      — italic flavor text shown below the icons
//   linger      — optional small italic note (e.g. "✨ energy remains here")
//   extra       — optional HTML appended inside the z-index wrapper (buttons etc)
//   shower      — whether to show the confetti shower canvas (default true)
//   showerTint  — tint color for shower particles (default themeColor)

// v0.15.37 — Collect button flavor pool. Dad-joke vibe, matches shieldCrit
// pool's tone. Single-tap puns and triumphant claims that vary per click
// to keep the moment fresh across an evening of play. Uses no-immediate-
// repeat logic via _pickResolutionCollectFlavor.
var REWARD_COLLECT_FLAVORS = [
  // Original 15 — proven flavor staples
  "Mine!",
  "Snagged!",
  "Pocket it!",
  "Stack it!",
  "Earned!",
  "Claimed!",
  "Locked in!",
  "Sweet!",
  "Got it!",
  "Yoink!",
  "Tucked away!",
  "Heck yes!",
  "Pay day!",
  "Cha-ching!",
  "Loot it!",
  // v0.16.4 — expanded pool (30 more, mix of styles)
  // Action-y
  "Grab it!",
  "Scoop it!",
  "Bag it!",
  "Hoard it!",
  "Nab it!",
  "Swipe!",
  "Stash!",
  "Pluck it!",
  "Pinch it!",
  "Lift it!",
  // Triumphant
  "Victory!",
  "Spoils!",
  "Plunder!",
  "Bounty!",
  "Riches!",
  "Treasure!",
  "Score!",
  "Jackpot!",
  "Boom!",
  "Win!",
  // Cheeky
  "Don't mind if I do!",
  "Finders keepers!",
  "Mine now!",
  "It's mine!",
  "Look at that!",
  "Well, well!",
  "Lucky me!",
  "About time!",
  "Worth it!",
  "Nice."
];
var _lastCollectFlavorIdx = null;
function _pickResolutionCollectFlavor() {
  if (REWARD_COLLECT_FLAVORS.length <= 1) return REWARD_COLLECT_FLAVORS[0] || 'Collect';
  var idx;
  do { idx = Math.floor(Math.random() * REWARD_COLLECT_FLAVORS.length); }
  while (idx === _lastCollectFlavorIdx);
  _lastCollectFlavorIdx = idx;
  return REWARD_COLLECT_FLAVORS[idx];
}

// v0.15.37/.38/.39 — Collect handler. Triggered by Collect button onclick.
//
// v0.15.39 changes:
// - Sequenced reward order: bricks (in BRICK_NAMES order) → cheese → coins.
// - Display-delta override: at tap time, the inventory display "rewinds" to
//   pre-resolution counts (server has already credited). As each burst lands,
//   the delta increments toward zero and a render is triggered. Effect:
//   inventory counts visually tick up *as each burst arrives*, not at server
//   credit time. This is the increment-on-arrival pattern Ross requested.
// - Active-event panel collapses entirely after Collect (handled in
//   restoreActiveEvent via _collectedResolutions check).
//
// Timing per burst type (rough, tuned during build):
//   brickGained: ~1200ms total animation; arrival landing at t≈1200
//   goldGained (cheese path, ≤3): ~1100ms total
//   goldGained (coins, pile + flow): ~350ms per coin + 850ms tail
//
// btnId is the unique DOM id of the Collect button — used to find the
// containing card and hide it after FX fires.
//
// v0.15.40 — Reservoir drain pattern:
// - Display deltas were already armed when the card first rendered (in
//   buildResolutionCard via _armResolutionDeltas). Inventory has been
//   showing pre-resolution counts the entire time the card was up.
// - Each reward icon in the card has a data-reward-token attribute. We
//   sequence drain by:
//   1. Find the icon span (by token) inside this card
//   2. Capture its viewport rect → use as FX origin
//   3. Fade the icon (transition opacity 0 + scale 0.5 over 350ms)
//   4. Fire boardFx from icon position to inventory destination
//   5. At ~1 sec mark: increment delta by 1 (or amount), trigger render
//   6. Move to next reward
// - After all rewards drained: card opacity 0 over 600ms (already set in
//   the card's transition CSS), then _collectedResolutions flag set so
//   restoreActiveEvent wipes the panel on next render.
//
// Per-element timing target: ~1 sec per reward (icon fade + FX travel
// + arrival increment).
function _collectResolutionReward(specJson, btnId) {
  var spec;
  try { spec = JSON.parse(specJson); } catch(e) { spec = {}; }
  var btn = document.getElementById(btnId);
  var card = btn ? btn.closest('[data-resolution-card]') : null;
  var collectKey = _activeEventCollectKey();

  _bqLog('collect-tap', { key: collectKey, spec: spec });

  // Fall-back path: if card or btn missing (shouldn't happen but defensive),
  // just credit deltas and bail. The display will sync to server state on
  // next render.
  if (!card || !btn) {
    _bqLog('collect-fallback', { reason: 'no-card-or-btn' });
    if (collectKey) {
      _collectedResolutions[collectKey] = true;
      delete _resolutionSnapshots[collectKey];
    }
    try { render(); } catch(e) {}
    return;
  }

  // Disable the Collect button — single-tap only, no double-fire.
  btn.disabled = true;
  btn.style.opacity = '0.4';
  btn.style.cursor = 'default';

  // Server message — ack-only. Server may or may not handle it.
  if (typeof client !== 'undefined' && client && typeof client.send === 'function') {
    try { client.send('collectReward', { spec: spec }); } catch(e) {}
  }

  // ── Sequence rewards: bricks (BRICK_NAMES order) → cheese → coins.
  // Each reward gets ~1 sec total: 350ms icon fade + 650ms FX travel.
  var t = 0;
  var ICON_FADE_MS    = 350;   // icon fade-out duration
  var FX_TRAVEL_MS    = 650;   // FX flight from icon to inventory
  var STEP_DURATION   = ICON_FADE_MS + FX_TRAVEL_MS;  // ~1000ms per element
  var INTER_STEP_MS   = 100;   // small pause between elements

  // Helper: drain a single icon by token.
  // v0.15.42: Sequence per element:
  //   1. Find icon in card (still present from previous renders)
  //   2. Pre-drain highlight (scale up + glow) for 200ms — visual beat
  //      saying "this one's draining now"
  //   3. Fade out (opacity 0 + scale 0.5) over 350ms
  //   4. Fire FX from icon's recorded position
  //   5. Mark token as drained — _drainedTokens[key][token] = true so
  //      subsequent renders skip this icon (renderRewardIcons checks it)
  //   6. At FX arrival time, run deltaIncrementFn (which calls render())
  //      — render rebuilds the card without this icon (drained-state
  //      preserved), and chipPulse fires at destination
  //
  // v0.15.43: re-query card before each drain. The `card` reference
  // captured at tap time becomes STALE after any render() rebuilds the
  // resolution card DOM — `card.querySelector(...)` then finds detached
  // nodes whose getBoundingClientRect returns 0×0, causing boardFx to
  // silently drop the FX (fx-no-pos). Fresh document-level query each
  // drain dodges this.
  function _drainIcon(token, fxFireFn, deltaIncrementFn, fireDelay) {
    setTimeout(function(){
      // v0.15.43: re-query the live card from document (not stale `card`).
      var liveCard = document.querySelector('[data-resolution-card]');
      var icon = liveCard ? liveCard.querySelector('[data-reward-token="'+token+'"]') : null;
      var dKey = _activeEventCollectKey();
      if (!icon) {
        _bqLog('drain-no-icon', { token: token, hasLiveCard: !!liveCard });
        // Still fire FX from card center as fallback so the delta gets
        // incremented and the player isn't stuck.
        var fbHost = liveCard || card;
        var fallbackRect = fbHost ? fbHost.getBoundingClientRect() : { left: 100, top: 100, width: 200, height: 100 };
        var fallbackPos = { left: fallbackRect.left + fallbackRect.width/2 - 10, top: fallbackRect.top + fallbackRect.height/2 - 10, right: 0, bottom: 0, width: 20, height: 20 };
        fxFireFn(fallbackPos);
        if (dKey) {
          if (!_drainedTokens[dKey]) _drainedTokens[dKey] = {};
          _drainedTokens[dKey][token] = true;
        }
        setTimeout(deltaIncrementFn, FX_TRAVEL_MS);
        return;
      }
      var iconRect = icon.getBoundingClientRect();
      _bqLog('drain-icon', { token: token, from: { x: iconRect.left, y: iconRect.top, w: iconRect.width, h: iconRect.height } });

      // Step 1: Pre-drain highlight — scale up briefly + brighten.
      // Visual cue saying "this one's draining now."
      icon.style.transform = 'scale(1.4)';
      icon.style.filter = 'brightness(1.6) drop-shadow(0 0 8px currentColor)';
      icon.style.zIndex = '10';

      // Step 2: After highlight, fade out
      setTimeout(function(){
        // v0.15.43: re-query in case render rebuilt the card mid-highlight
        var freshCard = document.querySelector('[data-resolution-card]');
        var freshIcon = freshCard ? freshCard.querySelector('[data-reward-token="'+token+'"]') : null;
        var target = freshIcon || icon;
        target.style.opacity = '0';
        target.style.transform = 'scale(0.5)';
        target.style.filter = '';
      }, 200);

      // Step 3: Fire FX from icon's recorded position (rect captured before
      // any render-rebuild, so its viewport coords stay valid even if the
      // icon DOM is replaced)
      setTimeout(function(){
        fxFireFn(iconRect);
      }, 250);

      // Step 4: Mark drained AFTER fade completes (so render() preserves
      // the absence and doesn't bring the icon back at full opacity)
      setTimeout(function(){
        if (dKey) {
          if (!_drainedTokens[dKey]) _drainedTokens[dKey] = {};
          _drainedTokens[dKey][token] = true;
        }
        _bqLog('drain-marked', { token: token, key: dKey });
      }, 550);

      // Step 5: At travel-arrival time, increment delta and render
      setTimeout(deltaIncrementFn, FX_TRAVEL_MS + 250);
    }, fireDelay);
  }

  // Bricks first, in canonical color order.
  if (spec.bricks && typeof spec.bricks === 'object') {
    var orderedColors = (typeof BRICK_NAMES !== 'undefined' ? BRICK_NAMES : Object.keys(spec.bricks))
      .filter(function(c){ return (spec.bricks[c]||0) > 0; });
    orderedColors.forEach(function(color) {
      var n = spec.bricks[color] || 0;
      for (var i = 0; i < n; i++) {
        var token = 'brick:' + color + ':' + i;
        var fireAt = t;
        _drainIcon(token,
          // v0.15.41: use flyingBrick with destination chip lookup so the
          // brick visibly arcs from card icon to inventory chip. Falls back
          // to no-dest drift if chip not found (rare — happens when first
          // brick of a color hasn't created the chip yet).
          (function(c){ return function(originRect){
            var dest = _findBrickChipDest(c);
            BoardFx.fire('flyingBrick', originRect, {
              brickColor: c,
              dest: dest ? { x: dest.x, y: dest.y } : null
            });
          }; })(color),
          (function(c){ return function(){
            _tickSnapshot('bricks', c, 1);
            _bqLog('brick-arrived', { color: c });
            try { render(); } catch(e) {}
            // v0.15.41: arrival highlight — pulse the chip after render
            // (next tick, so the chip exists if it was newly created).
            setTimeout(function(){
              var dest = _findBrickChipDest(c);
              if (dest && dest.rect) {
                var hex = (typeof BRICK_COLORS !== 'undefined' && BRICK_COLORS[c]) || '#FFFFFF';
                BoardFx.fire('chipPulse', dest.rect, { color: hex });
              }
            }, 30);
          }; })(color),
          fireAt
        );
        t += STEP_DURATION + INTER_STEP_MS;
      }
    });
  }

  // Cheese second. The cheese icon (or stacked icon if >5) drains as one
  // step that increments delta by spec.cheese.
  if (spec.cheese && spec.cheese > 0) {
    var cheeseAmount = spec.cheese;
    var cheeseToken = 'cheese:0';  // first cheese icon (or the stacked single)
    if (cheeseAmount <= 5) {
      // Drain each cheese icon individually
      for (var ci = 0; ci < cheeseAmount; ci++) {
        var ctoken = 'cheese:' + ci;
        var fireAt = t;
        _drainIcon(ctoken,
          (function(){ return function(originRect){ BoardFx.fire('goldGained', originRect, { amount: 1, dest: _findCheeseDest(), glyph: '🧀', noFloater: true }); }; })(),
          function(){
            _tickSnapshot('cheese', null, 1);
            _bqLog('cheese-arrived', {});
            try { render(); } catch(e) {}
            // v0.15.41: arrival highlight on cheese chip
            setTimeout(function(){
              var dest = _findCheeseChipDest();
              if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: '#FFD96A' });
            }, 30);
          },
          fireAt
        );
        t += STEP_DURATION + INTER_STEP_MS;
      }
    } else {
      // One stacked cheese icon, drains all at once
      _drainIcon(cheeseToken,
        function(originRect){ BoardFx.fire('goldGained', originRect, { amount: cheeseAmount, dest: _findCheeseDest(), glyph: '🧀', noFloater: true }); },
        function(){
          _tickSnapshot('cheese', null, cheeseAmount);
          _bqLog('cheese-stack-arrived', { amount: cheeseAmount });
          try { render(); } catch(e) {}
          setTimeout(function(){
            var dest = _findCheeseChipDest();
            if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: '#FFD96A' });
          }, 30);
        },
        t
      );
      t += STEP_DURATION + INTER_STEP_MS;
    }
  }

  // Coins last.
  if (spec.coins && spec.coins > 0) {
    var coinAmount = spec.coins;
    if (coinAmount <= 5) {
      // Drain each coin icon individually
      for (var coi = 0; coi < coinAmount; coi++) {
        var coToken = 'coin:' + coi;
        var fireAt = t;
        _drainIcon(coToken,
          (function(){ return function(originRect){ BoardFx.fire('goldGained', originRect, { amount: 1, noFloater: true }); }; })(),
          function(){
            _tickSnapshot('gold', null, 1);
            _bqLog('coin-arrived', {});
            try { render(); } catch(e) {}
            // v0.15.41: arrival highlight on gold chip
            setTimeout(function(){
              var dest = _findGoldChipDest();
              if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: '#F5D000' });
            }, 30);
          },
          fireAt
        );
        t += STEP_DURATION + INTER_STEP_MS;
      }
    } else {
      // Stacked coin icon, drains all at once
      _drainIcon('coin:0',
        function(originRect){ BoardFx.fire('goldGained', originRect, { amount: coinAmount, noFloater: true }); },
        function(){
          _tickSnapshot('gold', null, coinAmount);
          _bqLog('coin-stack-arrived', { amount: coinAmount });
          try { render(); } catch(e) {}
          // v0.15.41: arrival highlight on gold chip
          setTimeout(function(){
            var dest = _findGoldChipDest();
            if (dest && dest.rect) BoardFx.fire('chipPulse', dest.rect, { color: '#F5D000' });
          }, 30);
        },
        t
      );
      t += STEP_DURATION + INTER_STEP_MS;
    }
  }

  // Shield (rare in resolution cards). Drain its icon and fire shieldCrit.
  if (spec.shield) {
    _drainIcon('shield:0',
      function(originRect){ BoardFx.fire('shieldCrit', '#my-shield-section', { label: 'Shield!' }); },
      function(){
        // Shield isn't tracked in display deltas; nothing to increment.
      },
      t
    );
    t += STEP_DURATION + INTER_STEP_MS;
  }

  // After all drains complete, mark card as fading and trigger render.
  // The render rebuilds the card with class `bq-card-exit` (set by
  // buildResolutionCard via _cardFading flag) — CSS handles the
  // 850ms scale-down + fade-out animation. After 850ms, _collectedResolutions
  // flag wipes the panel.
  // v0.15.46: pure CSS-class-based fade. No inline opacity manipulation.
  // v0.16.4: bumped from 600ms to 850ms to match new dramatic dissolve
  // (CSS scale 1.0→0.6 + opacity 1→0 over 850ms). Pairs with flavor/button
  // freeze in buildResolutionCard so the card "lets go" cleanly.
  var totalDrainMs = t;
  var CARD_FADE_MS = 850;
  setTimeout(function(){
    if (collectKey) _cardFading[collectKey] = true;
    _bqLog('card-fade-start', { totalDrainMs: totalDrainMs, key: collectKey });
    // Trigger render so card re-renders with `bq-card-exit` class and CSS
    // animation kicks in.
    try { render(); } catch(e) {}
  }, totalDrainMs);
  setTimeout(function(){
    if (collectKey) {
      _collectedResolutions[collectKey] = true;
      delete _resolutionSnapshots[collectKey];
    }
    _bqLog('card-collected', { key: collectKey });
    try { render(); } catch(e) {}
  }, totalDrainMs + CARD_FADE_MS);
}

// v0.15.40 — Find cheese display destination. Mirrors _findGoldDestination
// in boardFx.js but for cheese. Used by the goldGained preset when the
// caller passes dest=_findCheeseDest() (cheese reuses goldGained for FX).
// v0.16.8: gold/cheese moved from .stats-row in header to .interaction-row
// at bottom; query by data-res attribute now (UNITY: same pattern for both).
function _findCheeseDest() {
  var pane = document.getElementById('pane-dashboard');
  if (!pane || !pane.classList.contains('active')) return null;
  var chip = pane.querySelector('.res-chip[data-res="cheese"]');
  if (!chip) return null;
  var r = chip.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// v0.15.41 — Find brick-chip destination for a given color. Used by the
// flyingBrick preset so each brick visibly transits to its inventory chip.
// Returns viewport coords + the rect (so chipPulse can size to the chip).
// Falls back to null if dashboard pane isn't active or chip doesn't exist
// yet (player owns no bricks of that color — first-of-color situation).
// v0.16.8: "Brick Charges" card-title is gone. First-of-color fallback now
// targets the .interaction-row's .brick-chips container instead.
function _findBrickChipDest(color) {
  var pane = document.getElementById('pane-dashboard');
  if (!pane || !pane.classList.contains('active')) return null;
  var chip = pane.querySelector('[data-brick-chip="'+color+'"]');
  if (!chip) {
    // First-of-color: no chip exists yet. Fall back to the interaction-row's
    // brick-chips container as the dest.
    var brickHost = pane.querySelector('.interaction-row .brick-chips');
    if (brickHost) {
      var hostR = brickHost.getBoundingClientRect();
      if (hostR.width === 0) return null;
      return {
        x: hostR.left + hostR.width / 2,
        y: hostR.top + hostR.height / 2,
        rect: null
      };
    }
    return null;
  }
  var r = chip.getBoundingClientRect();
  if (r.width === 0) return null;
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    rect: r
  };
}

// v0.15.41 — Find gold-display destination with rect (for chipPulse arrival).
// Mirrors boardFx's _findGoldDestination but returns rect so chipPulse can
// size the glow ring to the chip.
// v0.16.8: gold and cheese chips moved from .stats-row in header to
// .interaction-row at bottom; query by data-res attribute now.
function _findGoldChipDest() {
  var pane = document.getElementById('pane-dashboard');
  if (!pane || !pane.classList.contains('active')) return null;
  var chip = pane.querySelector('.res-chip[data-res="gold"]');
  if (!chip) return null;
  var r = chip.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
}

// v0.15.41 — Find cheese-display destination with rect (for chipPulse arrival).
function _findCheeseChipDest() {
  var pane = document.getElementById('pane-dashboard');
  if (!pane || !pane.classList.contains('active')) return null;
  var chip = pane.querySelector('.res-chip[data-res="cheese"]');
  if (!chip) return null;
  var r = chip.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
}

function buildResolutionCard(opts) {
  opts = opts || {};
  // v0.15.38: if the active-event resolution has been collected, return
  // empty string so the card stays hidden across renders. The flag is
  // implicitly cleared when activeEvent changes (new key = no entry).
  var dismissKey = _activeEventCollectKey();
  if (dismissKey && _collectedResolutions[dismissKey]) {
    return '';
  }
  var themeColor  = opts.themeColor  || '#9adb9a';
  var borderColor = opts.borderColor || themeColor;
  var bgColor     = opts.bgColor     || '#0a0a1a';
  var title       = opts.title       || '';
  var rewardIcons = opts.rewardIcons || '';
  var spec        = opts.spec        || null;
  var flavor      = opts.flavor      || '';
  var linger      = opts.linger      || '';
  var extra       = opts.extra       || '';
  var shower      = opts.shower !== false;
  var showerTint  = opts.showerTint  || themeColor;

  // v0.16.4: freeze body flavor if card is fading (post-drain). Without
  // this, the event-branch (e.g. gold's grFlav, riddle's rFlav) re-rolls
  // a fresh flavor on each render that fires during the fade window —
  // text would shuffle while the card is dissolving. Stash the last-used
  // flavor on the first non-fading render, then read from stash during
  // fade. Caller passes flavor in opts; we mutate the local var.
  if (dismissKey) {
    if (_cardFading[dismissKey]) {
      // Fading — read from stash if present (else fall through with
      // whatever the caller passed, harmless edge case).
      if (_cardFlavors[dismissKey] && _cardFlavors[dismissKey].body !== undefined) {
        flavor = _cardFlavors[dismissKey].body;
      }
    } else {
      // Not fading — stash the latest body flavor. Init the dict entry if
      // needed; button stash is set later in the hasReward branch.
      if (!_cardFlavors[dismissKey]) _cardFlavors[dismissKey] = {};
      _cardFlavors[dismissKey].body = flavor;
    }
  }

  // S013.6: Strip parsed reward tokens from flavor text so they don't
  // double-render (icon row already shows them). Keeps narrative tail.
  // Mirrors DM-side dm_screen.html v4DmResultBlock de-dup logic.
  if (flavor && rewardIcons) {
    flavor = flavor
      .replace(/\+\d+\s*(?:red|blue|gray|green|white|yellow|orange|purple|black)(?:\s+brick)?s?/gi, '')
      .replace(/\+\d+\s*(?:🧀|cheese)/gi, '')
      .replace(/\+\d+\s*🧀/gi, '')
      .replace(/\+\d+\s*gold/gi, '')
      .replace(/\+\d+\s*🪙/gi, '')
      .replace(/[-−]\d+\s*(?:max\s*)?HP(?!\s*max)/gi, '')
      .replace(/[-−]\d+\s*max\s*HP/gi, '')
      .replace(/\+1\s*shield\s*pip?/gi, '')
      .replace(/^[\s,·\-—]+/, '')
      .replace(/[\s,·\-—]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // v0.15.37 — Collect button. Renders when the spec has any tangible reward
  // (bricks/coins/cheese/shield). Replaces the "WAITING FOR DM" footer.
  // Player tap → boardFx fires for each reward, server collectReward sent,
  // card hides. Decouples player experience from DM-mark-resolved bookkeeping.
  var hasReward = spec && (
    (spec.bricks && Object.keys(spec.bricks).length > 0) ||
    (spec.coins && spec.coins > 0) ||
    (spec.cheese && spec.cheese > 0) ||
    spec.shield
  );

  // v0.15.40: arm display deltas the moment this card first renders with a
  // spec. Inventory shows pre-resolution counts the entire time the card is
  // up — no jump-up-then-jump-down flicker. Idempotent across re-renders.
  var armKey = _activeEventCollectKey();
  // v0.15.46: snapshot-based model means buildResolutionCard no longer
  // arms display deltas. The snapshot is taken at top of render() before
  // any sub-render runs. buildResolutionCard just renders the card; the
  // mask is automatic via _displayed/_displayedBricks reading the snapshot.
  if (hasReward) {
    _bqLog('build-card', {
      key: armKey,
      hasReward: hasReward,
      spec: spec,
      hasSnapshot: !!(armKey && _resolutionSnapshots[armKey])
    });
  }

  // Tag the card with the event key so the drain handler can find the
  // reward-icon spans within this specific card (multiple cards on screen
  // shouldn't be possible, but defensive).
  var keyAttr = armKey ? ' data-event-key="' + armKey.replace(/"/g, '&quot;') + '"' : '';

  // v0.15.46: card animations via CSS classes (defined in boardFx.css).
  // Entrance: `bq-card-enter` runs on first render — 250ms scale 0.85→1.0
  // + opacity 0→1. Dismissal: when _cardFading flag set, swap to
  // `bq-card-exit` — 600ms scale 1.0→0.85 + opacity 1→0. State-driven
  // class swap means renders during fade preserve the exit animation.
  // v0.16.1: enter only fires ONCE per event key — _cardEntered flag
  // prevents re-firing on subsequent renders. Without this, every render
  // rebuilds the card DOM and the entrance animation fires again,
  // visible as a "flash" each render during gameplay.
  var cardClass = 'bq-resolution-card';
  if (armKey && _cardFading[armKey]) {
    cardClass += ' bq-card-exit';
  } else if (armKey && !_cardEntered[armKey]) {
    cardClass += ' bq-card-enter';
    _cardEntered[armKey] = true;
  }

  var html = '<div data-resolution-card class="'+cardClass+'"' + keyAttr + ' style="margin-top:10px;padding:14px;background:'+bgColor+';border:2px solid '+borderColor+';border-radius:12px;text-align:center;position:relative;overflow:hidden;">';
  if (shower) {
    html += '<canvas id="result-shower" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.2;"></canvas>';
  }
  html += '<div style="position:relative;z-index:1;">';
  if (title) {
    html += '<div style="font-family:Cinzel,serif;font-size:18px;color:'+themeColor+';text-align:center;margin-bottom:8px;letter-spacing:.06em;">'+title+'</div>';
  }
  if (rewardIcons) {
    html += '<div data-reward-icons style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;padding:6px 0;flex-wrap:wrap;">'+rewardIcons+'</div>';
  }
  if (flavor) {
    html += '<div style="font-size:13px;color:var(--text-dim);font-style:italic;line-height:1.5;margin-bottom:6px;">'+flavor+'</div>';
  }
  if (linger) {
    html += '<div style="font-size:10px;color:'+themeColor+'aa;margin-top:6px;">'+linger+'</div>';
  }
  if (extra) {
    html += extra;
  }
  if (hasReward) {
    // v0.16.4: when card is fading (post-drain), use the LAST flavor that
    // was rolled, not a fresh one. _cardFlavors[armKey].button gets stashed
    // on each non-fading render; during fade, read from stash so the button
    // text doesn't shuffle while the card dissolves.
    var collectFlavor;
    if (armKey && _cardFading[armKey] && _cardFlavors[armKey] && _cardFlavors[armKey].button) {
      collectFlavor = _cardFlavors[armKey].button;
    } else {
      collectFlavor = _pickResolutionCollectFlavor();
      // Stash the latest button flavor so when fade kicks in it's the one frozen.
      if (armKey) {
        if (!_cardFlavors[armKey]) _cardFlavors[armKey] = {};
        _cardFlavors[armKey].button = collectFlavor;
      }
    }
    var btnId = 'collect-btn-' + Math.random().toString(36).slice(2, 9);
    var specJson = JSON.stringify(spec).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    html += '<button id="' + btnId + '" '
      +    'class="btn collect-btn" '
      +    'style="margin-top:10px;padding:12px 28px;background:'+themeColor+';color:'+bgColor+';border:none;border-radius:10px;font-family:Cinzel,serif;font-size:16px;font-weight:700;letter-spacing:.06em;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4);" '
      +    'onclick="_collectResolutionReward(\'' + specJson + '\', \'' + btnId + '\')">'
      +      '✋ ' + collectFlavor
      +    '</button>';
  } else {
    html += '<div style="font-size:10px;color:var(--text-faint);margin-top:6px;font-family:Cinzel,serif;letter-spacing:.04em;">WAITING FOR DM</div>';
  }
  html += '</div></div>';

  // Kick off shower animation on next tick (after DOM inserted)
  if (shower) setTimeout(function() { try { startResultShower(showerTint); } catch(e){} }, 50);

  return html;
}

// Render reward icons from a spec object:
//   bricks: { red:2, blue:1, ... }  → colored brick squares per count
//   coins:  N                       → N 🪙 emoji OR a single with count
//   cheese: N                       → N 🧀 emoji OR a single with count
//   shield: true                    → 🛡
//   hp:     +3 / -2                 → +N ❤️ (green) or -N ❤️ (red) chip
//   maxHp:  +N                      → +N max HP chip
//   poison: N                       → ☠ N stacks chip
//   custom: '<span>...</span>'      → raw HTML appended at end
const BRICK_SQUARE_COLORS = {
  red: '#D01012', blue: '#006DB7', gray: '#AAAAAA', green: '#237841',
  white: '#EFEFEF', yellow: '#F5D000', orange: '#F57C00',
  purple: '#7B2FBE', black: '#1a1a1a'
};
function renderRewardIcons(spec) {
  spec = spec || {};
  var html = '';
  // v0.15.40: each reward icon gets a data-reward-token attribute so the
  // drain handler (_collectResolutionReward) can find and fade individual
  // icons as their FX fires. Token format: "brick:<color>:<i>" / "coin:<i>" /
  // "cheese:<i>" / "shield:0". Per-element targeting is needed for the
  // "icons drain from card" effect.
  //
  // v0.15.42: also checks _drainedTokens for the active event key. Drained
  // icons render as visible-but-faded shells (opacity:0, scale:0.5, but
  // still occupying layout space) so the icon row preserves layout as
  // tokens drain. Without this, render() during drain rebuilds the card
  // with full-opacity icons and the visual fade is invisible.
  var dKey = (typeof _activeEventCollectKey === 'function') ? _activeEventCollectKey() : null;
  var drained = (dKey && _drainedTokens && _drainedTokens[dKey]) || {};
  var fadedStyle = 'opacity:0;transform:scale(0.5);';

  var BSQ = function(color, idx) {
    var c = BRICK_SQUARE_COLORS[color] || '#888';
    var border = color === 'white' ? 'border:1px solid #ccc;' : '';
    var token = 'brick:'+color+':'+idx;
    var extra = drained[token] ? fadedStyle : '';
    return '<span data-reward-token="'+token+'" style="width:22px;height:22px;border-radius:3px;background:'+c+';'+border+'display:inline-block;vertical-align:middle;box-shadow:0 1px 4px rgba(0,0,0,.5);margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+extra+'"></span>';
  };
  // Bricks
  if (spec.bricks && typeof spec.bricks === 'object') {
    Object.keys(spec.bricks).forEach(function(color) {
      var n = spec.bricks[color] || 0;
      for (var i = 0; i < n; i++) html += BSQ(color, i);
    });
  }
  // Coins — up to 5 icons, then "🪙 ×N"
  if (spec.coins && spec.coins > 0) {
    if (spec.coins <= 5) {
      for (var ci = 0; ci < spec.coins; ci++) {
        var coinToken = 'coin:'+ci;
        var coinExtra = drained[coinToken] ? fadedStyle : '';
        html += '<span data-reward-token="'+coinToken+'" style="font-size:20px;line-height:1;display:inline-block;vertical-align:middle;margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+coinExtra+'">🪙</span>';
      }
    } else {
      var coinExtra2 = drained['coin:0'] ? fadedStyle : '';
      html += '<span data-reward-token="coin:0" style="display:inline-flex;align-items:center;gap:2px;vertical-align:middle;margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+coinExtra2+'"><span style="font-size:20px;line-height:1;">🪙</span><span style="font-size:14px;color:#F5D000;font-weight:700;">×'+spec.coins+'</span></span>';
    }
  }
  // Cheese
  if (spec.cheese && spec.cheese > 0) {
    if (spec.cheese <= 5) {
      for (var chi = 0; chi < spec.cheese; chi++) {
        var cheeseToken = 'cheese:'+chi;
        var cheeseExtra = drained[cheeseToken] ? fadedStyle : '';
        html += '<span data-reward-token="'+cheeseToken+'" style="font-size:20px;line-height:1;display:inline-block;vertical-align:middle;margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+cheeseExtra+'">🧀</span>';
      }
    } else {
      var cheeseExtra2 = drained['cheese:0'] ? fadedStyle : '';
      html += '<span data-reward-token="cheese:0" style="display:inline-flex;align-items:center;gap:2px;vertical-align:middle;margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+cheeseExtra2+'"><span style="font-size:20px;line-height:1;">🧀</span><span style="font-size:14px;color:#FFD96A;font-weight:700;">×'+spec.cheese+'</span></span>';
    }
  }
  // Shield
  if (spec.shield) {
    var shieldExtra = drained['shield:0'] ? fadedStyle : '';
    html += '<span data-reward-token="shield:0" style="font-size:20px;vertical-align:middle;margin:0 2px;transition:opacity 0.35s ease-out, transform 0.35s ease-out;'+shieldExtra+'">🛡</span>';
  }
  // HP change (+ or -)
  if (typeof spec.hp === 'number' && spec.hp !== 0) {
    var hpColor = spec.hp > 0 ? 'var(--green)' : 'var(--red)';
    var sign = spec.hp > 0 ? '+' : '';
    html += '<span style="font-size:14px;color:'+hpColor+';vertical-align:middle;margin:0 4px;font-weight:700;">'+sign+spec.hp+' ❤️</span>';
  }
  // Max HP change
  if (typeof spec.maxHp === 'number' && spec.maxHp !== 0) {
    var mxColor = spec.maxHp > 0 ? 'var(--green)' : 'var(--red)';
    var mxSign = spec.maxHp > 0 ? '+' : '';
    html += '<span style="font-size:12px;color:'+mxColor+';vertical-align:middle;margin:0 4px;font-weight:700;">'+mxSign+spec.maxHp+' ❤️<span style="font-size:9px;opacity:.7;">max</span></span>';
  }
  // Poison stacks (debuff)
  if (spec.poison && spec.poison > 0) {
    html += '<span style="font-size:13px;color:#bada7a;vertical-align:middle;margin:0 4px;font-weight:700;">☠ '+spec.poison+'</span>';
  }
  // Custom HTML
  if (spec.custom) {
    html += spec.custom;
  }
  return html;
}

function renderPurpleFatedChoice(ev, me) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#2a1a3a;border:1px solid #7B2FBE88;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#c89ef0;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const alreadyChose = !!ev.purpleResult;
  if (alreadyChose) {
    const R = ev.purpleResult;
    // Parse rewards from R.msg for icon row
    const msg = R.msg || '';
    const spec = {};
    const brickM = msg.match(/\+(\d+)\s*(red|blue|gray|green|white|yellow|orange|purple|black)/i);
    if (brickM) { spec.bricks = {}; spec.bricks[brickM[2].toLowerCase()] = parseInt(brickM[1]); }
    const goldM = msg.match(/\+(\d+)\s*gold/i);
    if (goldM) spec.coins = parseInt(goldM[1]);
    const cheeseM = msg.match(/\+(\d+)\s*🧀|\+(\d+)\s*cheese/i);
    if (cheeseM) spec.cheese = parseInt(cheeseM[1] || cheeseM[2]);
    const hpM = msg.match(/([+\-−]?\d+)\s*HP/i);
    if (hpM) spec.hp = parseInt(hpM[1].replace('−','-'));
    const shieldM = /shield pip|\+1 shield/i.test(msg);
    if (shieldM) spec.shield = true;
    const poisonM = msg.match(/([+]?\d+)\s*poison/i) || /poison/i.test(msg);
    if (msg.match(/(\d+)\s*poison/i)) spec.poison = parseInt(msg.match(/(\d+)\s*poison/i)[1]);

    let title, themeColor, borderColor, bgColor, extraBtns = '', linger = '';
    if (R.outcome === 'blessed') {
      title = '✨ BLESSED ✨'; themeColor = '#E8C868'; borderColor = '#E8C86888'; bgColor = '#1a1405';
    } else if (R.outcome === 'cursed') {
      title = '🗡 CURSED'; themeColor = '#d44'; borderColor = '#d4444488'; bgColor = '#1a0505';
      if (MY_CLASS === 'fixer' && R.fixerCanCleanse) {
        const haveBlack = (me.bricks.black||0) >= 1;
        const haveWhite = (me.bricks.white||0) >= 2;
        if (haveBlack) {
          extraBtns = '<button class="btn success" style="width:100%;margin:8px 0 0;" onclick="purpleCleanse()">🩹 Cleanse Curse (1 black — receive blessed reward)</button>';
        } else if (haveWhite) {
          extraBtns = '<button class="btn" style="width:100%;margin:8px 0 0;background:#1a3a2a;border:1px solid #4a8a6a;color:#8ac;" onclick="purpleCleanse()">🩹 Cleanse Curse (2 white — no blessing)</button>';
        } else {
          extraBtns = '<div style="font-size:11px;color:#888;margin-top:6px;font-style:italic;">(Need 1 black or 2 white to cleanse)</div>';
        }
      }
    } else if (R.outcome === 'pass') {
      title = 'THE CHESTS REMAIN'; themeColor = '#aaa'; borderColor = '#aaaaaa66'; bgColor = '#15151a';
      linger = '✨ Fated Choice lingers here';
    } else if (R.outcome === 'cleansed_blessed' || R.outcome === 'cleansed_negated') {
      title = '🩹 CLEANSED'; themeColor = '#8ac'; borderColor = '#8accee66'; bgColor = '#0a1520';
    } else {
      title = '?'; themeColor = '#888'; borderColor = '#88888866'; bgColor = '#141414';
    }

    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor: msg,
      linger,
      extra: extraBtns,
      showerTint: themeColor,
    });
  }
  // Not yet chosen — show the chest decision UI
  return lingerHeader
    + '<div style="font-family:Cinzel,serif;font-size:18px;color:#c89ef0;text-align:center;margin-bottom:4px;">✨ FATED CHOICE ✨</div>'
    + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:14px;font-style:italic;">Two sealed chests. One blesses. One curses.</div>'
    + '<div style="display:flex;gap:10px;margin-bottom:10px;">'
    +   '<button class="btn" style="flex:1;padding:18px 10px;background:linear-gradient(135deg,#2a1a3a,#4a2a6a);border:2px solid #7B2FBE;color:#e4c4f4;font-family:Cinzel,serif;font-size:13px;" onclick="purpleChoose(\'left\')">📦 LEFT</button>'
    +   '<button class="btn" style="flex:1;padding:18px 10px;background:linear-gradient(135deg,#2a1a3a,#4a2a6a);border:2px solid #7B2FBE;color:#e4c4f4;font-family:Cinzel,serif;font-size:13px;" onclick="purpleChoose(\'right\')">📦 RIGHT</button>'
    + '</div>'
    + '<button class="btn" style="width:100%;background:#1a1a1f;border:1px solid #444;color:#888;font-size:12px;" onclick="purpleChoose(\'pass\')">↩ Pass (+1 🧀, chests linger)</button>';
}

function purpleChoose(choice) {
  client.resolveEvent(MY_CLASS, 'purpleChoose', { choice: choice });
}

function purpleCleanse() {
  client.resolveEvent(MY_CLASS, 'purpleCleanse', {});
}

// ── v4 WHITE PILGRIM'S REST ──
function renderWhitePilgrimsRest(ev, me, G) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#1a2a2a;border:1px solid #8acccc88;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#9adada;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const R = ev.whiteResult;
  if (R) {
    let title, themeColor, borderColor, bgColor;
    if (R.outcome === 'heal_ally') { title = '🤝 HEALED ALLY'; themeColor = '#9adada'; }
    else if (R.outcome === 'self_heal') { title = '💊 SELF HEAL'; themeColor = '#bde'; }
    else if (R.outcome === 'self_maxhp') { title = '✨ MAX HP UP'; themeColor = '#E8C868'; }
    else if (R.outcome === 'self_rest') { title = '🛏 SELF REST'; themeColor = '#8ca'; }
    else if (R.outcome === 'revive') { title = '✨ REVIVED ALLY ✨'; themeColor = '#E8C868'; }
    else { title = '🕊 RESTED'; themeColor = '#E8F4F4'; }
    borderColor = themeColor + '88';
    bgColor = '#0f1a1f';

    const msg = R.msg || '';
    const spec = {};
    const hpM = msg.match(/\+(\d+)\s*HP(?!\s*max)/i);
    if (hpM) spec.hp = parseInt(hpM[1]);
    const maxM = msg.match(/\+(\d+)\s*max\s*HP|\+(\d+)\s*HP\s*max/i);
    if (maxM) spec.maxHp = parseInt(maxM[1] || maxM[2]);
    const brickM = msg.match(/\+(\d+)\s*white/i);
    if (brickM) { spec.bricks = { white: parseInt(brickM[1]) }; }

    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor: msg,
      showerTint: themeColor,
    });
  }
  const isFixer = (MY_CLASS === 'fixer');
  const hasWhite = (me.bricks.white||0) >= 1;
  const hasPurple = (me.bricks.purple||0) >= 1;
  const myZone = SPACES[me.space] ? SPACES[me.space].zone : 0;
  const livingAllies = Object.values(G.players||{}).filter(p =>
    p.cls !== MY_CLASS && p.alive && p.hp > 0
  );
  const downedAllies = Object.values(G.players||{}).filter(p =>
    p.cls !== MY_CLASS && (!p.alive || p.hp <= 0)
  );
  let buttons = '';
  if (hasWhite && livingAllies.length > 0) {
    buttons += '<div style="font-size:10px;color:#888;text-align:center;margin:6px 0 4px;letter-spacing:.08em;">── HEAL ALLY (1 white) ──</div>';
    livingAllies.forEach(a => {
      buttons += '<button class="btn success" style="width:100%;margin-bottom:5px;" onclick="whitePilgrimHealAlly(\'' + a.cls + '\')">🤝 Heal ' + a.icon + ' ' + a.name + ' (+' + (isFixer?4:3) + ' HP)</button>';
    });
  }
  // Self heal or Max HP
  buttons += '<button class="btn" style="width:100%;margin-bottom:5px;background:#1a2a3a;border:1px solid #4a6a8a;color:#bde;" onclick="whitePilgrimHealSelf()">💊 Rest (+1 HP or +1 Max HP if full, +1 white)</button>';
  // Fixer revive
  if (isFixer && hasWhite && hasPurple && downedAllies.length > 0) {
    buttons += '<div style="font-size:10px;color:#F5D000;text-align:center;margin:6px 0 4px;letter-spacing:.08em;">── FIXER REVIVE (1 white + 1 purple) ──</div>';
    downedAllies.forEach(a => {
      buttons += '<button class="btn" style="width:100%;margin-bottom:5px;background:#3a2a1a;border:1px solid var(--gold);color:var(--gold);" onclick="whitePilgrimRevive(\'' + a.cls + '\')">✨ Revive ' + a.icon + ' ' + a.name + ' (50% HP)</button>';
    });
  }
  if (!hasWhite) {
    buttons += '<button class="btn" style="width:100%;margin-bottom:5px;background:#1a1a1f;border:1px solid #444;color:#aaa;" onclick="whitePilgrimSelfRest()">🛏 Self-Rest (no brick cost)</button>';
  }
  return lingerHeader
    + '<div style="font-family:Cinzel,serif;font-size:18px;color:#E8F4F4;text-align:center;margin-bottom:4px;">🕊 PILGRIM\'S REST</div>'
    + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:14px;font-style:italic;">A shrine. A blessing. Give or receive care.</div>'
    + buttons;
}

function whitePilgrimHealAlly(targetCls) {
  client.resolveEvent(MY_CLASS, 'whitePilgrimChoose', { choice: 'heal_ally', healTarget: targetCls });
}
function whitePilgrimHealSelf() {
  client.resolveEvent(MY_CLASS, 'whitePilgrimChoose', { choice: 'heal_self' });
}
function whitePilgrimSelfRest() {
  client.resolveEvent(MY_CLASS, 'whitePilgrimChoose', { choice: 'self_rest' });
}
function whitePilgrimRevive(targetCls) {
  client.resolveEvent(MY_CLASS, 'whitePilgrimChoose', { choice: 'revive', healTarget: targetCls });
}

// ── v4 BLACK SHADOW BARGAIN ──
const BLACK_OFFER_TEXT = {
  blood_price:     { title:'⚱ BLOOD PRICE',     desc:'Pay 2-5 permanent Max HP for 2 black bricks.' },
  brick_exchange:  { title:'🔀 BRICK EXCHANGE',  desc:'Trade 1 non-black brick for 1 black + 3 gold.' },
  poisoned_favor:  { title:'☠ POISONED FAVOR',   desc:'Free: +1 black. Cost: poisoned next 3 rumble battles.' },
  binding_pact:    { title:'⛓ BINDING PACT',     desc:'+2 black. All living allies lose 1 random non-black brick.' },
};

function renderBlackShadowBargain(ev, me, G) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#1a1a1a;border:1px solid #88888888;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#aaa;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const R = ev.blackResult;
  if (R) {
    let title, themeColor, bgColor;
    if (R.outcome === 'refused') { title = '↩ REFUSED'; themeColor = '#aaa'; bgColor = '#161616'; }
    else if (R.outcome === 'blood_price') { title = '⚱ BLOOD PRICE PAID'; themeColor = '#d44'; bgColor = '#1a0505'; }
    else if (R.outcome === 'brick_exchange') { title = '🔀 TRADE COMPLETE'; themeColor = '#c89ef0'; bgColor = '#140a1a'; }
    else if (R.outcome === 'poisoned_favor') { title = '☠ POISONED FAVOR'; themeColor = '#bada7a'; bgColor = '#0f1a05'; }
    else if (R.outcome === 'binding_pact') { title = '⛓ BINDING PACT'; themeColor = '#d44'; bgColor = '#1a0505'; }
    else { title = 'BARGAIN'; themeColor = '#aaa'; bgColor = '#141414'; }
    const borderColor = themeColor + '88';

    const msg = R.msg || '';
    const spec = {};
    // Black bricks gained
    const blackM = msg.match(/\+(\d+)\s*black/i);
    if (blackM) { spec.bricks = { black: parseInt(blackM[1]) }; }
    // Max HP lost
    const maxLost = msg.match(/[-−](\d+)\s*max\s*HP|lose\s*(\d+)\s*max\s*HP/i);
    if (maxLost) spec.maxHp = -parseInt(maxLost[1] || maxLost[2]);
    // Coins gained
    const goldM = msg.match(/\+(\d+)\s*gold/i);
    if (goldM) spec.coins = parseInt(goldM[1]);
    // Poison stacks queued
    const poiM = msg.match(/(\d+)\s*poison\s*stacks?|poisoned\s*\((\d+)\)/i);
    if (poiM) spec.poison = parseInt(poiM[1] || poiM[2]);
    // Cheese — handles both "+1 cheese" and "hands you N cheese" phrasings
    const cheeseM = msg.match(/\+(\d+)\s*(?:🧀|cheese)|(\d+)\s*cheese/i);
    if (cheeseM) spec.cheese = parseInt(cheeseM[1] || cheeseM[2]);

    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor: msg,
      showerTint: themeColor,
    });
  }
  const offer = ev.blackOffer;
  const isFormwright = (MY_CLASS === 'formwright');
  const info = BLACK_OFFER_TEXT[offer] || { title:'?', desc:'Unknown bargain' };

  // Cost/reward tables — shown to everyone now (previously FW-only via Scholar's Eye framing).
  // FW still gets the flavor header; others see the same info without the FW framing.
  const scholarHeader = isFormwright
    ? '<div style="font-size:10px;color:#F5D000;letter-spacing:.08em;margin-bottom:4px;">🔮 SCHOLAR\'S EYE reveals the terms:</div>'
    : '<div style="font-size:10px;color:#888;letter-spacing:.08em;margin-bottom:4px;text-transform:uppercase;">The shadow offers:</div>';

  // Build the "what you get / what you pay" rows per offer type
  let rewardRow = '', costRow = '';
  if (offer === 'blood_price') {
    rewardRow = '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="font-size:11px;color:#888;margin-left:4px;vertical-align:middle;">+2 black</span>';
    costRow = '<span style="font-size:13px;color:var(--red);font-weight:700;vertical-align:middle;">−2 to −5 ❤️ max</span>'
            + '<span style="font-size:10px;color:#888;margin-left:6px;vertical-align:middle;">(permanent)</span>';
  } else if (offer === 'brick_exchange') {
    rewardRow = '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="font-size:11px;color:#888;margin-left:2px;vertical-align:middle;">+1 black</span>'
              + '<span style="font-size:20px;line-height:1;vertical-align:middle;margin:0 4px 0 10px;">🪙</span>'
              + '<span style="font-size:11px;color:#F5D000;vertical-align:middle;">+3 gold</span>';
    costRow = '<span style="font-size:11px;color:#888;">− 1 brick (your choice, below)</span>';
  } else if (offer === 'poisoned_favor') {
    rewardRow = '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="font-size:11px;color:#888;margin-left:4px;vertical-align:middle;">+1 black</span>';
    costRow = '<span style="font-size:13px;color:#bada7a;font-weight:700;">☠ 1 poison stack</span>'
            + '<span style="font-size:10px;color:#888;margin-left:6px;">next 3 rumbles</span>';
  } else if (offer === 'binding_pact') {
    rewardRow = '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="width:22px;height:22px;border-radius:3px;background:#1a1a1a;border:1px solid #555;display:inline-block;vertical-align:middle;margin:0 2px;"></span>'
              + '<span style="font-size:11px;color:#888;margin-left:4px;vertical-align:middle;">+2 black</span>';
    costRow = '<span style="font-size:12px;color:#d44;">Every living ally loses 1 random brick</span>';
  }

  const offerBlock =
    '<div style="background:#1a1a2a;border:1px solid #6a4a7a;border-radius:6px;padding:10px;margin-bottom:10px;">'
    +   scholarHeader
    +   '<div style="font-family:Cinzel,serif;font-size:14px;color:#c8c;margin-bottom:2px;">'+info.title+'</div>'
    +   '<div style="font-size:11px;color:#aaa;margin-bottom:8px;font-style:italic;">'+info.desc+'</div>'
    +   '<div style="border-top:1px solid #3a2a4a;padding-top:6px;">'
    +     '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><span style="font-size:9px;color:#9a7aba;letter-spacing:.08em;min-width:48px;">GAIN</span>' + rewardRow + '</div>'
    +     '<div style="display:flex;align-items:center;gap:4px;"><span style="font-size:9px;color:#ba7a7a;letter-spacing:.08em;min-width:48px;">COST</span>' + costRow + '</div>'
    +   '</div>'
    + '</div>';

  // Brick picker for exchange — clickable tiles, shown to ALL classes
  let exchangePicker = '';
  let canAcceptExchange = true;
  if (offer === 'brick_exchange') {
    const nonBlackOwned = Object.entries(me.bricks||{}).filter(([c,n]) => c !== 'black' && n > 0);
    const BRICK_BG = {red:'#D01012', blue:'#006DB7', gray:'#AAAAAA', green:'#237841', white:'#EFEFEF', yellow:'#F5D000', orange:'#F57C00', purple:'#7B2FBE'};
    if (nonBlackOwned.length === 0) {
      canAcceptExchange = false;
      exchangePicker = '<div style="margin-bottom:10px;padding:8px;background:#1a0a0a;border:1px solid #6a3a3a;border-radius:6px;text-align:center;color:#d88;font-size:11px;">You have no non-black bricks to trade.</div>';
    } else {
      exchangePicker = '<div style="margin-bottom:10px;padding:8px;background:#0a0a1a;border:1px solid #4a4a6a;border-radius:6px;">'
        + '<div style="font-size:10px;color:#aaa;margin-bottom:6px;">Tap a brick to offer:</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;" id="black-ex-tiles">';
      nonBlackOwned.forEach(function(pair) {
        const c = pair[0], n = pair[1];
        const bg = BRICK_BG[c] || '#888';
        const border = c === 'white' ? 'border:1px solid #ccc;' : '';
        exchangePicker += '<button class="black-ex-brick" data-color="'+c+'" onclick="selectBlackExchangeBrick(\''+c+'\')" '
          + 'style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 10px;'
          + 'background:#1a1a20;border:2px solid #555;border-radius:8px;cursor:pointer;transition:all .15s;">'
          +   '<span style="width:28px;height:28px;border-radius:4px;background:'+bg+';'+border+'display:inline-block;box-shadow:0 1px 3px rgba(0,0,0,.5);"></span>'
          +   '<span style="font-size:9px;color:#aaa;letter-spacing:.06em;text-transform:uppercase;">'+c+' ×'+n+'</span>'
          + '</button>';
      });
      exchangePicker += '</div><div id="black-ex-selected" style="margin-top:6px;font-size:10px;color:#888;text-align:center;">Choose a brick to trade</div></div>';
    }
  }

  const acceptLabel = (offer === 'brick_exchange' && canAcceptExchange) ? '✓ ACCEPT (trade selected)' : '✓ ACCEPT';
  const acceptDisabled = (offer === 'brick_exchange' && !canAcceptExchange);
  const acceptStyle = acceptDisabled
    ? 'width:100%;margin-bottom:6px;background:#1a1a1a;border:2px solid #333;color:#555;font-family:Cinzel,serif;cursor:not-allowed;'
    : 'width:100%;margin-bottom:6px;background:#2a1020;border:2px solid #8a2a6a;color:#fcc;font-family:Cinzel,serif;';
  const acceptOnclick = acceptDisabled ? '' : 'onclick="blackBargainAccept()"';

  return lingerHeader
    + '<div style="font-family:Cinzel,serif;font-size:18px;color:#c8c;text-align:center;margin-bottom:4px;">🗡 SHADOW BARGAIN</div>'
    + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:12px;font-style:italic;">A cloaked figure extends a pact.</div>'
    + offerBlock
    + exchangePicker
    + '<button class="btn" '+acceptOnclick+' style="'+acceptStyle+'">'+acceptLabel+'</button>'
    + '<button class="btn" style="width:100%;background:#1a1a1f;border:1px solid #444;color:#888;font-size:12px;" onclick="blackBargainRefuse()">↩ Refuse (97% cheese, 3% black)</button>';
}

// Track which brick the player picked for brick_exchange (used by blackBargainAccept)
window._blackExchangeColor = null;
function selectBlackExchangeBrick(color) {
  window._blackExchangeColor = color;
  // Highlight chosen tile, dim others
  const tiles = document.querySelectorAll('.black-ex-brick');
  tiles.forEach(function(t) {
    if (t.dataset.color === color) {
      t.style.borderColor = '#F5D000';
      t.style.background = '#2a2010';
    } else {
      t.style.borderColor = '#555';
      t.style.background = '#1a1a20';
    }
  });
  const sel = document.getElementById('black-ex-selected');
  if (sel) sel.innerHTML = '<span style="color:#F5D000;">✓ Offering 1 ' + color + ' brick</span>';
}

function blackBargainAccept() {
  const ev = client.state && client.state.activeEvent;
  const offer = ev && ev.blackOffer;
  const data = { choice: 'accept' };
  if (offer === 'brick_exchange') {
    if (!window._blackExchangeColor) {
      toast('Pick a brick to trade first', 'warn');
      return;
    }
    data.exchangeColor = window._blackExchangeColor;
  }
  client.resolveEvent(MY_CLASS, 'blackBargainChoose', data);
  window._blackExchangeColor = null;
}
function blackBargainRefuse() {
  client.resolveEvent(MY_CLASS, 'blackBargainChoose', { choice: 'refuse' });
  window._blackExchangeColor = null;
}

// ══════════════════════════════════════════════════════════
// v4 GREEN VINE PATH — 3-vine SVG trace mini-game
// ══════════════════════════════════════════════════════════
// Each vine is an SVG path. Player drags finger along it staying within
// tolerance band. On stray → vine snaps red briefly, retry. Three vines,
// 25s total budget.

const GREEN_VINE_PATHS = [
  // Vine 1: gentle S-curve
  'M 20 40 Q 80 20 140 40 T 260 40',
  // Vine 2: spiral-ish loop
  'M 20 40 Q 60 0 100 40 Q 140 80 180 40 Q 220 0 260 40',
  // Vine 3: zigzag
  'M 20 40 L 70 10 L 120 70 L 170 10 L 220 70 L 260 40',
];
const GREEN_TOLERANCE = 14; // px

let _greenState = null;

function renderGreenVinePath(ev, me, G) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#0a2a1a;border:1px solid #4a8a5a88;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#9ada9a;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const R = ev.greenResult;
  if (R) {
    let title, themeColor, bgColor;
    if (R.outcome === 'all_cut') { title = '🌿 ALL VINES CUT 🌿'; themeColor = '#b6e89a'; bgColor = '#0a1a0a'; }
    else if (R.outcome === 'partial_2') { title = '✂ 2 CUT'; themeColor = '#b6e89a'; bgColor = '#0a1a0a'; }
    else if (R.outcome === 'partial_1') { title = '✂ 1 CUT'; themeColor = '#aaa'; bgColor = '#141414'; }
    else if (R.outcome === 'total_fail') { title = '☠ OVERWHELMED'; themeColor = '#d44'; bgColor = '#1a0505'; }
    else { title = 'VINES'; themeColor = '#9adb9a'; bgColor = '#0a1a0a'; }
    const borderColor = themeColor + '88';

    const msg = R.msg || '';
    const spec = {};
    const brickM = msg.match(/\+(\d+)\s*green/i);
    if (brickM) { spec.bricks = { green: parseInt(brickM[1]) }; }
    const hpM = msg.match(/[-−](\d+)\s*HP(?!\s*max)/i);
    if (hpM) spec.hp = -parseInt(hpM[1]);
    const poiM = msg.match(/(\d+)\s*poison/i);
    if (poiM) spec.poison = parseInt(poiM[1]);

    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor: msg,
      showerTint: themeColor,
    });
  }
  const isWO = MY_CLASS === 'wild_one';
  return lingerHeader
    + '<div style="font-family:Cinzel,serif;font-size:18px;color:#9adb9a;text-align:center;margin-bottom:4px;">🌿 VINE PATH</div>'
    + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:10px;font-style:italic;">Each vine demands its own cut. Three clean cuts pass the path.</div>'
    + '<div style="font-size:11px;color:#8ac;text-align:center;margin-bottom:8px;">⏱ <span id="green-timer">25</span>s · cut <span id="green-cut">0</span>/3</div>'
    // Legend
    + '<div style="display:flex;justify-content:center;gap:10px;margin-bottom:10px;font-size:10px;flex-wrap:wrap;">'
    +   '<span style="padding:2px 6px;background:#2a0a0a;border:1px solid #d44;border-radius:4px;color:#f9a;">🌵 THORN → tap</span>'
    +   '<span style="padding:2px 6px;background:#0a2a0a;border:1px solid #5aa05a;border-radius:4px;color:#b6e89a;">🌿 GRAB → hold 1.5s</span>'
    +   '<span style="padding:2px 6px;background:#0a1a2a;border:1px solid #5a8aaa;border-radius:4px;color:#9adcff;">💧 WEEP → swipe</span>'
    + '</div>'
    + '<div id="green-vine-stage" style="background:#081a0a;border:1px solid #3a5a3a;border-radius:6px;padding:10px;"></div>'
    + (isWO ? '<div style="font-size:10px;color:#F5D000;text-align:center;margin-top:6px;letter-spacing:.04em;">🐺 WILD ONE: HOLD any vine to tame it (counts regardless)</div>' : '')
    + '<div style="display:flex;gap:6px;margin-top:10px;">'
    +   '<button class="btn" style="flex:1;background:#1a3a1a;border:1px solid #5a8a5a;color:#9ada9a;font-size:12px;" onclick="greenVineGiveUp()">Give Up</button>'
    + '</div>';
}

// ── Vine puzzle state ──
// 6 vines, each with a type (thorn/grab/weep). Player must do the right action.
// Right action → cut (gold). Wrong action → damage + vine locks red (uncuttable).
// Need 3 cuts within 25s. WO can HOLD any vine regardless of type.
function startGreenVinePath() {
  const stage = document.getElementById('green-vine-stage');
  if (!stage) return;
  const TYPES = ['thorn', 'grab', 'weep'];
  // Generate 6 vines with balanced type distribution (at least 1 of each)
  const vines = [];
  for (let i = 0; i < 2; i++) vines.push({ type: TYPES[i % 3] });
  for (let i = 2; i < 6; i++) vines.push({ type: TYPES[Math.floor(Math.random() * 3)] });
  // Shuffle
  for (let i = vines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vines[i], vines[j]] = [vines[j], vines[i]];
  }
  vines.forEach(function(v, i) {
    v.id = i;
    v.state = 'pending';   // pending | cut | locked
    v.holdStart = 0;
    v.swipeStart = null;
  });
  _greenState = {
    vines: vines,
    cut: 0,
    locked: 0,
    timeLeft: 25,
    isWO: MY_CLASS === 'wild_one',
    activeHold: null,  // { vineId, startedAt }
    _interval: null,
  };
  renderVineStage();
  _greenState._interval = setInterval(greenVineTick, 100);
}

function renderVineStage() {
  const stage = document.getElementById('green-vine-stage');
  if (!stage || !_greenState) return;
  const cutEl = document.getElementById('green-cut');
  if (cutEl) cutEl.textContent = _greenState.cut;

  let html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
  _greenState.vines.forEach(function(v) {
    let icon, color, bg, border, label;
    if (v.state === 'cut') { icon = '✓'; color = '#E8C868'; bg = '#2a2405'; border = '#E8C868'; label = 'CUT'; }
    else if (v.state === 'locked') { icon = '✗'; color = '#d44'; bg = '#2a0505'; border = '#d44'; label = 'LOCKED'; }
    else {
      if (v.type === 'thorn') { icon = '🌵'; color = '#f9a'; bg = '#2a0a0a'; border = '#d44'; label = 'TAP'; }
      else if (v.type === 'grab') { icon = '🌿'; color = '#b6e89a'; bg = '#0a2a0a'; border = '#5aa05a'; label = 'HOLD'; }
      else { icon = '💧'; color = '#9adcff'; bg = '#0a1a2a'; border = '#5a8aaa'; label = 'SWIPE'; }
    }
    // Hold progress indicator
    let holdBar = '';
    if (_greenState.activeHold && _greenState.activeHold.vineId === v.id) {
      const pct = Math.min(1, (Date.now() - _greenState.activeHold.startedAt) / 1500);
      holdBar = '<div style="position:absolute;bottom:2px;left:4px;right:4px;height:4px;background:#000;border-radius:2px;overflow:hidden;"><div style="width:' + (pct*100).toFixed(1) + '%;height:100%;background:#E8C868;transition:width 0.1s;"></div></div>';
    }
    html += '<div class="green-vine-cell" data-vid="' + v.id + '" style="'
      + 'position:relative;aspect-ratio:1;background:' + bg + ';border:2px solid ' + border + ';border-radius:8px;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'user-select:none;-webkit-user-select:none;touch-action:none;cursor:' + (v.state === 'pending' ? 'pointer' : 'default') + ';'
      + '">'
      +   '<span style="font-size:32px;line-height:1;margin-bottom:4px;">' + icon + '</span>'
      +   '<span style="font-size:9px;color:' + color + ';letter-spacing:.08em;font-family:Cinzel,serif;">' + label + '</span>'
      +   holdBar
      + '</div>';
  });
  html += '</div>';
  stage.innerHTML = html;

  // Attach handlers — pointer events cover both mouse + touch
  _greenState.vines.forEach(function(v) {
    if (v.state !== 'pending') return;
    const cell = stage.querySelector('[data-vid="' + v.id + '"]');
    if (!cell) return;
    let swipeStartX = null, swipeStartY = null;
    const onDown = function(e) {
      e.preventDefault();
      if (v.state !== 'pending') return;
      const pt = e.touches ? e.touches[0] : e;
      swipeStartX = pt.clientX;
      swipeStartY = pt.clientY;
      // Start hold timer
      _greenState.activeHold = { vineId: v.id, startedAt: Date.now() };
      renderVineStage();
    };
    const onUp = function(e) {
      e.preventDefault();
      if (v.state !== 'pending') { _greenState.activeHold = null; return; }
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      const heldMs = _greenState.activeHold ? (Date.now() - _greenState.activeHold.startedAt) : 0;
      const isHold = heldMs >= 1500;
      const isSwipe = swipeStartX !== null
        && pt && Math.hypot(pt.clientX - swipeStartX, pt.clientY - swipeStartY) >= 40;
      _greenState.activeHold = null;

      let gesture;
      if (_greenState.isWO && isHold) { greenVineResolveCell(v, 'correct'); return; }
      if (isSwipe) gesture = 'swipe';
      else if (isHold) gesture = 'hold';
      else gesture = 'tap';

      const expected = v.type === 'thorn' ? 'tap' : v.type === 'grab' ? 'hold' : 'swipe';
      if (gesture === expected) greenVineResolveCell(v, 'correct');
      else greenVineResolveCell(v, 'wrong');
    };
    const onMove = function(e) {
      if (!_greenState.activeHold || _greenState.activeHold.vineId !== v.id) return;
      renderVineStage();
    };
    cell.addEventListener('pointerdown', onDown);
    cell.addEventListener('pointerup', onUp);
    cell.addEventListener('pointercancel', function() { _greenState.activeHold = null; });
    cell.addEventListener('pointermove', onMove);
  });
}

function greenVineResolveCell(v, result) {
  if (!_greenState) return;
  if (v.state !== 'pending') return;
  if (result === 'correct') {
    v.state = 'cut';
    _greenState.cut++;
    if (_greenState.cut >= 3) {
      greenVineFinish(_greenState.cut);
      return;
    }
  } else {
    v.state = 'locked';
    _greenState.locked++;
    // No immediate HP damage — damage applies via server based on cutCount at finish
    // Check if it's impossible to reach 3 cuts
    const pending = _greenState.vines.filter(function(x) { return x.state === 'pending'; }).length;
    if (_greenState.cut + pending < 3) {
      // Give the player a moment to see the locked state before finishing
      setTimeout(function() {
        if (_greenState) greenVineFinish(_greenState.cut);
      }, 800);
    }
  }
  renderVineStage();
}

function greenVineTick() {
  if (!_greenState) return;
  _greenState.timeLeft -= 0.1;
  const t = document.getElementById('green-timer');
  if (t) t.textContent = Math.max(0, Math.ceil(_greenState.timeLeft));
  // Live update the hold indicator
  if (_greenState.activeHold) {
    const heldMs = Date.now() - _greenState.activeHold.startedAt;
    // Auto-complete at 1.5s for hold-type vines (don't wait for release)
    const v = _greenState.vines[_greenState.activeHold.vineId];
    if (heldMs >= 1500 && v && v.state === 'pending') {
      if (v.type === 'grab' || _greenState.isWO) {
        _greenState.activeHold = null;
        greenVineResolveCell(v, 'correct');
      }
    }
    renderVineStage();
  }
  if (_greenState.timeLeft <= 0) greenVineFinish(_greenState.cut);
}

function greenVineGiveUp() {
  if (!_greenState) return;
  greenVineFinish(_greenState.cut);
}

function greenVineFinish(cutCount) {
  if (!_greenState) return;
  if (_greenState._interval) clearInterval(_greenState._interval);
  _greenState = null;
  client.resolveEvent(MY_CLASS, 'greenVineResolve', { cutCount });
}


// ══════════════════════════════════════════════════════════
// v4 RED TRIAL OF THE HAND — DM adjudicates
// ══════════════════════════════════════════════════════════

function renderRedTrialOfHand(ev, me, G) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#2a0a0a;border:1px solid #8a4a4a88;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#f4a;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const R = ev.redResult;

  // ── PHASE: done (result screen) ──
  if (ev.redPhase === 'done' || R) {
    if (!R) return lingerHeader + '<div style="text-align:center;color:#888;font-style:italic;">Resolving…</div>';
    const isWinner = (R.winnerCls === MY_CLASS);
    const myResult = (R.results||{})[MY_CLASS];
    const didJoin = (ev.redJoined||[]).includes(MY_CLASS);

    let title, themeColor, bgColor, spec = {}, flavor = '';
    if (R.cancelled) {
      title = '⊘ TRIAL CANCELLED'; themeColor = '#aaa'; bgColor = '#141414';
      flavor = 'The stone circle went quiet. The brick remains.';
    } else if (R.lingered) {
      title = '✗ NO WINNER'; themeColor = '#aaa'; bgColor = '#141414';
      flavor = 'None could claim the red brick. It remains for another challenger.';
    } else if (isWinner) {
      title = '🏆 YOU WON 🏆'; themeColor = '#E8C868'; bgColor = '#1a1405';
      spec.bricks = { red: 1 };
      spec.cheese = myResult ? myResult.cheese : 1;
      const bonus = myResult && myResult.breakerBonus;
      flavor = bonus ? 'BREAKER BONUS — the red echoes your strike.' : 'The red brick is yours.';
    } else if (didJoin) {
      const winnerP = R.winnerCls && G.players && G.players[R.winnerCls];
      const winnerName = winnerP ? (winnerP.icon + ' ' + winnerP.name) : 'Another';
      title = '✗ LOST'; themeColor = '#d66'; bgColor = '#1a0808';
      if (myResult && myResult.gold) spec.coins = myResult.gold;
      else spec.cheese = 1;
      flavor = winnerName + ' claimed the red.';
    } else {
      title = '— DID NOT JOIN —'; themeColor = '#888'; bgColor = '#121212';
      flavor = 'The Trial passed without you.';
    }
    const borderColor = themeColor + '88';
    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor,
      showerTint: themeColor,
      shower: isWinner, // only shower on victory
    });
  }

  const challenge = ev.redChallenge || { name:'TRIAL', kind:'?', text:'The trial stones await.', digital:false };
  const kindColor = { strength:'#d44', dexterity:'#F5D000', focus:'#6af' }[challenge.kind] || '#faa';
  const joined = ev.redJoined || [];
  const isJoined = joined.includes(MY_CLASS);
  const isBreaker = MY_CLASS === 'breaker';

  // ── PHASE: joining ──
  if (ev.redPhase === 'joining') {
    const secsLeft = Math.max(0, Math.ceil((ev.redJoinEndsAt - Date.now())/1000));
    const joinRoster = joined.map(function(c) {
      const jp = G.players[c];
      return jp ? ('<span style="display:inline-block;margin:2px 4px;padding:2px 8px;background:#2a0a0a;border:1px solid #8a4a4a;border-radius:10px;font-size:11px;color:#fcc;">'+jp.icon+' '+jp.name+(c === MY_CLASS ? ' (you)' : '')+'</span>') : '';
    }).join('');
    const joinBtn = isJoined
      ? '<div style="text-align:center;padding:10px;background:#1a3a1a;border:2px solid #5a8a5a;border-radius:8px;font-family:Cinzel,serif;color:#9adb9a;font-size:14px;">✓ JOINED — awaiting DM to start</div>'
      : '<button class="btn" style="width:100%;padding:16px;background:#2a1010;border:2px solid #d44;color:#fcc;font-family:Cinzel,serif;font-size:16px;letter-spacing:.08em;" onclick="redTrialJoin()">⚔ JOIN THE TRIAL</button>';
    return lingerHeader
      + '<div style="font-family:Cinzel,serif;font-size:18px;color:#faa;text-align:center;margin-bottom:4px;">⚔ '+challenge.name+'</div>'
      + '<div style="font-size:11px;color:'+kindColor+';text-align:center;margin-bottom:10px;letter-spacing:.12em;text-transform:uppercase;">'+challenge.kind+(challenge.digital?' · digital':'')+'</div>'
      + '<div style="font-size:13px;color:#fff;text-align:center;margin-bottom:14px;padding:12px;background:#1a0a0a;border:2px solid #8a4a4a;border-radius:8px;font-family:Cinzel,serif;line-height:1.5;">'+challenge.text+'</div>'
      + '<div style="font-size:11px;color:#F5D000;text-align:center;margin-bottom:8px;letter-spacing:.08em;">⏱ JOIN WINDOW · '+secsLeft+'s</div>'
      + joinBtn
      + '<div style="margin-top:12px;text-align:center;font-size:10px;color:#888;letter-spacing:.08em;">CHALLENGERS ('+joined.length+')</div>'
      + '<div style="text-align:center;margin-top:4px;">'+(joinRoster||'<span style="font-size:11px;color:#666;font-style:italic;">None yet</span>')+'</div>';
  }

  // ── PHASE: active (challenge in progress) ──
  if (ev.redPhase === 'active') {
    const secsLeft = Math.max(0, Math.ceil((ev.redEndsAt - Date.now())/1000));
    if (!isJoined) {
      // Spectator view for non-joiners
      return lingerHeader
        + '<div style="font-family:Cinzel,serif;font-size:18px;color:#faa;text-align:center;margin-bottom:4px;">⚔ '+challenge.name+'</div>'
        + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:12px;font-style:italic;">The trial is underway. You are watching.</div>'
        + '<div style="font-size:14px;color:#F5D000;text-align:center;letter-spacing:.08em;">⏱ '+secsLeft+'s remaining</div>';
    }
    // Joined player view
    let body = '<div style="font-family:Cinzel,serif;font-size:18px;color:#faa;text-align:center;margin-bottom:4px;">⚔ '+challenge.name+'</div>'
      + '<div style="font-size:11px;color:'+kindColor+';text-align:center;margin-bottom:10px;letter-spacing:.12em;text-transform:uppercase;">'+challenge.kind+'</div>'
      + '<div style="font-size:13px;color:#fff;text-align:center;margin-bottom:10px;padding:10px;background:#1a0a0a;border:2px solid #8a4a4a;border-radius:6px;line-height:1.4;">'+challenge.text+'</div>'
      + '<div style="font-size:13px;color:#F5D000;text-align:center;margin-bottom:10px;letter-spacing:.08em;">⏱ '+secsLeft+'s</div>';
    if (challenge.digital && challenge.id === 'frenzy') {
      body += renderRedFrenzy(ev, me);
    } else if (challenge.digital && challenge.id === 'reflex_hawk') {
      body += renderRedReflex(ev, me);
    } else {
      body += '<div style="font-size:11px;color:#aaa;text-align:center;margin-top:8px;font-style:italic;">Perform the challenge. DM picks the winner.</div>';
    }
    return lingerHeader + body;
  }

  // ── PHASE: picking (timer expired, DM deciding) ──
  if (ev.redPhase === 'picking') {
    return lingerHeader
      + '<div style="font-family:Cinzel,serif;font-size:18px;color:#faa;text-align:center;margin-bottom:4px;">⚔ '+challenge.name+'</div>'
      + '<div style="font-size:13px;color:#F5D000;text-align:center;margin-bottom:12px;letter-spacing:.08em;">⏱ TIME</div>'
      + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:10px;font-style:italic;">DM is picking the winner…</div>';
  }

  return lingerHeader + '<div style="text-align:center;color:#888;">Loading trial…</div>';
}

// RED digital minigame: FRENZY tap race
function renderRedFrenzy(ev, me) {
  const myScore = (ev.redDigitalScores||{})[MY_CLASS];
  if (myScore && myScore.finishedAt) {
    return '<div style="text-align:center;padding:12px;background:#1a3a1a;border:2px solid #5a8a5a;border-radius:8px;">'
      + '<div style="font-family:Cinzel,serif;font-size:14px;color:#9adb9a;">✓ 50 TAPS — SUBMITTED</div>'
      + '<div style="font-size:11px;color:#aaa;margin-top:4px;">Finished at '+(myScore.finishedAt/1000).toFixed(2)+'s</div></div>';
  }
  const taps = (window._redFrenzyTaps || 0);
  return '<div style="text-align:center;">'
    + '<div style="font-family:Cinzel,serif;font-size:32px;color:#F5D000;margin-bottom:4px;">'+taps+'/50</div>'
    + '<button class="btn" id="red-frenzy-btn" style="width:100%;padding:22px;background:#2a0505;border:3px solid #d44;color:#fff;font-family:Cinzel,serif;font-size:20px;letter-spacing:.12em;" ontouchstart="redFrenzyTap(event)" onclick="redFrenzyTap(event)">⚔ TAP FAST ⚔</button></div>';
}

function redFrenzyTap(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!window._redFrenzyTaps) window._redFrenzyTaps = 0;
  window._redFrenzyTaps++;
  const btn = document.getElementById('red-frenzy-btn');
  if (btn) {
    btn.style.background = '#4a1010';
    setTimeout(function(){ if (btn) btn.style.background = '#2a0505'; }, 50);
  }
  // Live update the counter without full re-render
  const card = btn ? btn.previousElementSibling : null;
  if (card) card.textContent = window._redFrenzyTaps + '/50';
  if (window._redFrenzyTaps >= 50) {
    client.resolveEvent(MY_CLASS, 'redTrialDigitalSubmit', { taps: 50 });
    window._redFrenzyTaps = 0;
  }
}

// RED digital minigame: REFLEX OF THE HAWK (react on GO)
let _redReflexState = null;
function renderRedReflex(ev, me) {
  const myScore = (ev.redDigitalScores||{})[MY_CLASS];
  if (myScore && myScore.finishedAt) {
    return '<div style="text-align:center;padding:12px;background:#1a3a1a;border:2px solid #5a8a5a;border-radius:8px;">'
      + '<div style="font-family:Cinzel,serif;font-size:14px;color:#9adb9a;">✓ REACTION LOGGED</div>'
      + '<div style="font-size:11px;color:#aaa;margin-top:4px;">'+myScore.reactionMs+'ms</div></div>';
  }
  if (!_redReflexState) {
    // Schedule the GO signal at a random delay 1.5-4.5s
    const delay = 1500 + Math.random()*3000;
    _redReflexState = { armed: true, goAt: Date.now() + delay, falseStart: false };
    setTimeout(function() {
      if (_redReflexState && _redReflexState.armed) {
        const btn = document.getElementById('red-reflex-btn');
        if (btn) { btn.style.background = '#1a5a1a'; btn.style.borderColor = '#5aaa5a'; btn.textContent = 'GO!'; }
      }
    }, delay);
  }
  const label = _redReflexState.falseStart ? 'FALSE START — WAIT FOR GO' : 'WAIT…';
  return '<button class="btn" id="red-reflex-btn" style="width:100%;padding:22px;background:#2a0505;border:3px solid #d44;color:#fff;font-family:Cinzel,serif;font-size:22px;letter-spacing:.12em;" onclick="redReflexTap()">'+label+'</button>';
}

function redReflexTap() {
  if (!_redReflexState) return;
  const now = Date.now();
  if (now < _redReflexState.goAt) {
    // False start — can still try again but penalty
    _redReflexState.falseStart = true;
    const btn = document.getElementById('red-reflex-btn');
    if (btn) { btn.style.background = '#5a0a0a'; btn.textContent = 'FALSE START — WAIT!'; }
    return;
  }
  const reactionMs = now - _redReflexState.goAt;
  client.resolveEvent(MY_CLASS, 'redTrialDigitalSubmit', { reactionMs });
  _redReflexState = null;
}

function redTrialJoin() {
  client.resolveEvent(MY_CLASS, 'redTrialJoin', {});
}

// ══════════════════════════════════════════════════════════
// v4 GRAY RUBBLE STACKING — canvas mini-game
// ══════════════════════════════════════════════════════════
// 5-wide × 6-tall grid. 3 blocks drop. Tap column to place. Match outline.

let _grayState = null;

function renderGrayRubbleStacking(ev, me, G) {
  const isLingering = ev.lingering;
  const lingerHeader = isLingering
    ? '<div style="background:#1a1a1a;border:1px solid #88888888;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#aaa;text-align:center;letter-spacing:.06em;">LINGERING — attempt #' + (ev.lingeringAttempt||2) + '</div>'
    : '';
  const R = ev.grayRubbleResult;
  if (R) {
    let title, themeColor, bgColor;
    if (R.tier === 'perfect') { title = '🏛 PERFECT STACK 🏛'; themeColor = '#E8C868'; bgColor = '#1a1405'; }
    else if (R.tier === 'good') { title = '🧱 GOOD'; themeColor = '#9adada'; bgColor = '#0a1a1a'; }
    else if (R.tier === 'miss') { title = '⚠ MISS'; themeColor = '#aaa'; bgColor = '#141414'; }
    else { title = '💥 FUMBLE'; themeColor = '#d44'; bgColor = '#1a0505'; }
    const borderColor = themeColor + '88';

    const msg = R.msg || '';
    const spec = {};
    const brickM = msg.match(/\+(\d+)\s*gray/i);
    if (brickM) { spec.bricks = { gray: parseInt(brickM[1]) }; }
    const cheeseM = msg.match(/\+(\d+)\s*(?:🧀|cheese)|(\d+)\s*cheese/i);
    if (cheeseM) spec.cheese = parseInt(cheeseM[1] || cheeseM[2]);

    const matchLine = '<div style="font-size:11px;color:#888;margin-bottom:6px;">Match: '+R.matchPct+'%'+(R.overhang?' · overhang: '+R.overhang:'')+'</div>';
    return lingerHeader + buildResolutionCard({
      themeColor, borderColor, bgColor, title,
      rewardIcons: renderRewardIcons(spec),
      spec,
      flavor: msg,
      extra: matchLine,
      showerTint: themeColor,
      shower: R.tier === 'perfect' || R.tier === 'good',
    });
  }
  const blocks = ev.grayBlocks || [];
  const isBlocksmith = MY_CLASS === 'blocksmith';
  return lingerHeader
    + '<div style="font-family:Cinzel,serif;font-size:18px;color:#ccc;text-align:center;margin-bottom:4px;">🧱 RUBBLE STACKING</div>'
    + '<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:10px;font-style:italic;">Drag to move the falling block. It locks when it lands.</div>'
    + '<div style="font-size:11px;color:#8ac;text-align:center;margin-bottom:8px;">⏱ <span id="gray-timer">'+(20 + 5*blocks.length)+'</span>s · block <span id="gray-block-idx">1</span>/<span id="gray-block-total">'+blocks.length+'</span></div>'
    + '<div style="text-align:center;"><canvas id="gray-canvas" style="background:#0a0a0a;border:1px solid #333;border-radius:6px;display:inline-block;touch-action:none;" width="300" height="360"></canvas></div>'
    + (isBlocksmith
      ? '<div style="font-size:10px;color:#F5D000;text-align:center;margin-top:6px;letter-spacing:.04em;">🔧 BLOCKSMITH: perfect bonus</div>'
      : '')
    + '<div style="font-size:10px;color:#888;text-align:center;margin-top:6px;">Drag, or tap a column to jump. Block drops 1 row/sec.</div>';
}

// ── TETRIS RUBBLE GAME (v4 — auto-fall with drag-and-drop) ──
// Grid: 5 cols × 6 rows, cell = 60px, canvas = 300 × 360 (square cells)
function startGrayRubble() {
  const ev = client.state && client.state.activeEvent;
  if (!ev || !ev.grayOutline || !ev.grayBlocks || ev.grayBlocks.length === 0) return;
  const canvas = document.getElementById('gray-canvas');
  if (!canvas) return;
  if (_grayState && _grayState._interval) clearInterval(_grayState._interval);
  if (_grayState && _grayState._fall) clearInterval(_grayState._fall);

  // v4: Timer scales with puzzle complexity — 20s base + 5s per block.
  // 5 blocks = 45s, 8 blocks = 60s. Prevents timeout on dense outlines.
  var _grayTimeBudget = 20 + 5 * (ev.grayBlocks ? ev.grayBlocks.length : 5);
  _grayState = {
    W: 5, H: 6,
    cellSize: 60,
    outline: ev.grayOutline,
    blocks: ev.grayBlocks,
    blockIdx: 0,
    grid: Array(6).fill(null).map(() => Array(5).fill(0)),
    fallingBlock: ev.grayBlocks[0],
    fallingCol: 2,
    fallingRow: 5,            // top row (visual row index from bottom = 5, highest)
    dragging: false,
    dragStartCol: 2,
    dragStartX: 0,
    timeLeft: _grayTimeBudget,
    finished: false,
  };

  // Pointer handlers — supports mouse + touch; tap = jump, drag = follow pointer
  function getPointerCol(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const x = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(4, Math.floor(x * 5)));
  }
  function onDown(e) {
    if (!_grayState || _grayState.finished) return;
    e.preventDefault();
    const col = getPointerCol(e);
    _grayState.dragging = true;
    _grayState.dragStartCol = col;
    moveFallingToCol(col);
  }
  function onMove(e) {
    if (!_grayState || _grayState.finished || !_grayState.dragging) return;
    e.preventDefault();
    const col = getPointerCol(e);
    moveFallingToCol(col);
  }
  function onUp(e) {
    if (!_grayState) return;
    _grayState.dragging = false;
  }
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', onUp);
  canvas.addEventListener('touchstart', onDown, { passive:false });
  canvas.addEventListener('touchmove', onMove, { passive:false });
  canvas.addEventListener('touchend', onUp);

  _grayState._interval = setInterval(grayRubbleTick, 100);   // timer tick
  _grayState._fall = setInterval(grayRubbleFallStep, 1000);  // fall 1 row per second
  drawGrayCanvas();
}

function moveFallingToCol(targetCol) {
  if (!_grayState || !_grayState.fallingBlock) return;
  // Clamp so the block shape stays within the grid
  const block = _grayState.fallingBlock;
  let maxDx = 0;
  block.forEach(function(o) { if (o.dx > maxDx) maxDx = o.dx; });
  // Try to center the block on the target column
  let newCol = targetCol;
  if (newCol + maxDx > 4) newCol = 4 - maxDx;
  if (newCol < 0) newCol = 0;
  // Don't move into a cell that's already occupied at the block's current row
  if (!blockCollides(block, newCol, _grayState.fallingRow)) {
    _grayState.fallingCol = newCol;
    drawGrayCanvas();
  }
}

function blockCollides(block, col, row) {
  // Returns true if placing block at (col,row) overlaps the existing grid or goes out of bounds
  for (let i = 0; i < block.length; i++) {
    const c = col + block[i].dx;
    const r = row + block[i].dy;
    if (c < 0 || c > 4) return true;
    if (r < 0) return true;
    if (r > 5) continue; // above top is OK during spawn
    if (_grayState.grid[r] && _grayState.grid[r][c]) return true;
  }
  return false;
}

function grayRubbleFallStep() {
  if (!_grayState || _grayState.finished) return;
  const block = _grayState.fallingBlock;
  const col = _grayState.fallingCol;
  const row = _grayState.fallingRow;
  const nextRow = row - 1;
  // Check if block can fall one row
  if (blockCollides(block, col, nextRow)) {
    // Lock block at current row
    lockFallingBlock();
  } else {
    _grayState.fallingRow = nextRow;
    drawGrayCanvas();
  }
}

function lockFallingBlock() {
  const block = _grayState.fallingBlock;
  const col = _grayState.fallingCol;
  const row = _grayState.fallingRow;
  block.forEach(function(o) {
    const c = col + o.dx;
    const r = row + o.dy;
    if (c >= 0 && c < 5 && r >= 0 && r < 6) _grayState.grid[r][c] = 1;
  });
  _grayState.blockIdx++;
  const idxEl = document.getElementById('gray-block-idx');
  if (idxEl) idxEl.textContent = Math.min(_grayState.blockIdx+1, _grayState.blocks.length);
  if (_grayState.blockIdx >= _grayState.blocks.length) {
    grayRubbleFinish();
  } else {
    // Spawn next block at top center
    _grayState.fallingBlock = _grayState.blocks[_grayState.blockIdx];
    _grayState.fallingCol = 2;
    _grayState.fallingRow = 5;
    drawGrayCanvas();
  }
}

function drawGrayCanvas() {
  const canvas = document.getElementById('gray-canvas');
  if (!canvas || !_grayState) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cs = _grayState.cellSize;

  // Grid lines
  ctx.strokeStyle = '#2a2a2a';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      ctx.strokeRect(c * cs, (5 - r) * cs, cs, cs);
    }
  }

  // Target outline (ghosted gold)
  ctx.fillStyle = 'rgba(245,208,0,0.15)';
  ctx.strokeStyle = '#F5D00066';
  for (let r = 0; r < 6; r++) {
    const row = _grayState.outline[r] || '.....';
    for (let c = 0; c < 5; c++) {
      if (row[c] === 'X') {
        ctx.fillRect(c * cs, (5 - r) * cs, cs, cs);
        ctx.strokeRect(c * cs + 0.5, (5 - r) * cs + 0.5, cs - 1, cs - 1);
      }
    }
  }

  // Placed blocks (solid gray)
  ctx.fillStyle = '#888';
  ctx.strokeStyle = '#ccc';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      if (_grayState.grid[r][c]) {
        ctx.fillRect(c * cs + 3, (5 - r) * cs + 3, cs - 6, cs - 6);
        ctx.strokeRect(c * cs + 3, (5 - r) * cs + 3, cs - 6, cs - 6);
      }
    }
  }

  // Falling block (blue preview — ghosted for cells above the grid top)
  if (!_grayState.finished && _grayState.fallingBlock) {
    ctx.fillStyle = '#6af';
    ctx.strokeStyle = '#9cf';
    _grayState.fallingBlock.forEach(function(o) {
      const c = _grayState.fallingCol + o.dx;
      const r = _grayState.fallingRow + o.dy;
      if (c >= 0 && c < 5 && r >= 0 && r < 6) {
        ctx.fillRect(c * cs + 4, (5 - r) * cs + 4, cs - 8, cs - 8);
        ctx.strokeRect(c * cs + 4, (5 - r) * cs + 4, cs - 8, cs - 8);
      }
    });
  }
}

function placeGrayBlock(col) {
  // Kept for backward compat but no longer called — drag/drop handles column selection
  if (!_grayState || _grayState.finished) return;
  moveFallingToCol(col);
}

function grayRubbleTick() {
  if (!_grayState) return;
  _grayState.timeLeft -= 0.1;
  const t = document.getElementById('gray-timer');
  if (t) t.textContent = Math.max(0, Math.ceil(_grayState.timeLeft));
  if (_grayState.timeLeft <= 0) grayRubbleFinish();
}

function grayRubbleFinish() {
  if (!_grayState || _grayState.finished) return;
  _grayState.finished = true;
  if (_grayState._interval) clearInterval(_grayState._interval);
  if (_grayState._fall) clearInterval(_grayState._fall);
  // Compute match percentage
  let outlineCells = 0, matchedCells = 0, overhangCells = 0;
  for (let r = 0; r < 6; r++) {
    const row = _grayState.outline[r] || '.....';
    for (let c = 0; c < 5; c++) {
      const wantFilled = row[c] === 'X';
      const isFilled = !!_grayState.grid[r][c];
      if (wantFilled) {
        outlineCells++;
        if (isFilled) matchedCells++;
      } else {
        if (isFilled) overhangCells++;
      }
    }
  }
  const matchPct = outlineCells > 0 ? Math.round(matchedCells / outlineCells * 100) : 0;
  client.resolveEvent(MY_CLASS, 'grayRubbleResolve', { matchPct, overhang: overhangCells });
  _grayState = null;
}


// ── TOAST ──
function toast(msg, type='normal') {
  const el=document.getElementById('toast');
  const colors={normal:'#333',success:'#0a3a1a',warn:'#3a1a00'};
  el.style.background=colors[type]||'#333';
  el.textContent=msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2500);
}

initFontSize();

// ── Mobile header auto-hide on scroll ──
// When scrolling DOWN within .dashboard-host, hide .topbar + .phase-banner
// (more action-pane room). When scrolling UP, restore them.
// v0.16.8: tabs system removed — was tab-content, now dashboard-host.
(function(){
  var dashHost = null;
  var lastScrollTop = 0;
  var ticking = false;
  var SCROLL_THRESHOLD = 6;  // ignore tiny scroll jitter
  var TOP_THRESHOLD = 20;    // show header if near top regardless

  function updateHeaderVisibility() {
    ticking = false;
    if (!dashHost) return;
    var topbar = document.querySelector('.topbar');
    var phaseBanner = document.querySelector('.phase-banner');
    if (!topbar) return;

    var scrollTop = dashHost.scrollTop;
    var delta = scrollTop - lastScrollTop;

    // Always show when at top
    if (scrollTop < TOP_THRESHOLD) {
      topbar.classList.remove('hidden-on-scroll');
      if (phaseBanner) phaseBanner.classList.remove('hidden-on-scroll');
    } else if (delta > SCROLL_THRESHOLD) {
      // Scrolling DOWN — hide
      topbar.classList.add('hidden-on-scroll');
      if (phaseBanner) phaseBanner.classList.add('hidden-on-scroll');
    } else if (delta < -SCROLL_THRESHOLD) {
      // Scrolling UP — show
      topbar.classList.remove('hidden-on-scroll');
      if (phaseBanner) phaseBanner.classList.remove('hidden-on-scroll');
    }
    lastScrollTop = scrollTop;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(updateHeaderVisibility);
      ticking = true;
    }
  }

  function attach() {
    dashHost = document.getElementById('dashboard-host');
    if (!dashHost) { setTimeout(attach, 200); return; }
    dashHost.addEventListener('scroll', onScroll, { passive: true });
  }
  attach();
})();


(function(){
  var pill=document.getElementById('fc-pill');
  var ring=document.getElementById('fc-ring');
  var mag=document.getElementById('fc-mag');
  var isOpen=false,holdT=null,tapN=0,tapT=null;
  function open(){pill.classList.add('open');ring.classList.remove('active');pill.classList.remove('pressing');isOpen=true;}
  function close(){pill.classList.remove('open');isOpen=false;}
  function reset(){applyFontSize(16);var s=document.getElementById('font-size-slider');if(s)s.value=16;close();}
  var holdDuration = 1500;
  function startHold(){
    ring.classList.add('active');pill.classList.add('pressing');
    holdT=setTimeout(function(){
      if(isOpen){ close(); ring.classList.remove('active'); pill.classList.remove('pressing'); }
      else { open(); }
    }, holdDuration);
  }
  function cancelHold(){
    clearTimeout(holdT);
    ring.classList.remove('active');
    pill.classList.remove('pressing');
  }
  function handleTripleTap(){
    tapN++;clearTimeout(tapT);
    tapT=setTimeout(function(){
      if(tapN>=3){ reset(); }
      tapN=0;
    },500);
  }
  if(!mag)return;
  mag.addEventListener('mousedown',startHold);
  mag.addEventListener('mouseup',function(){ cancelHold(); handleTripleTap(); });
  mag.addEventListener('mouseleave',cancelHold);
  mag.addEventListener('touchstart',function(e){e.preventDefault();startHold();},{passive:false});
  mag.addEventListener('touchend',function(e){e.preventDefault();cancelHold();handleTripleTap();});
  mag.addEventListener('touchmove',function(e){e.preventDefault();},{passive:false});
})();
