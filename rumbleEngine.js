// ═══════════════════════════════════════════════════════════════════
// ─── rumbleEngine.js — Canonical Rumble Engine ──────────────────────
// ═══════════════════════════════════════════════════════════════════
// Single source of truth for rumble simulation state. Runs in two
// environments:
//   - BROWSER (solo + coop client renders): rumble.js loads this and
//     calls engine.tick(dt) from raf loop. Local cast events pass
//     through engine.applyCast() for solo authority.
//   - NODE (coop server): server.js loads this and runs engine
//     headless. Cast events arrive via websocket, snapshots broadcast
//     out at 20 Hz.
//
// Same code, both environments. UNITY: bug fixes apply once. ELEGANCE:
// no parallel logic paths. EFFICIENCY: render = view of engine state,
// no double-ownership.
//
// v0.16.60 (THIS PUSH) — Skeleton + state ownership only. No
// behavior change. Engine OWNS the canonical state arrays; rumble.js
// reads/writes them via engine.state references that are passed in
// at init. All update logic still in rumble.js for now. v0.16.61
// (next push) introduces the damage choke point. v0.16.62 unifies
// cast dispatch. v0.16.63 cuts coop over to server-side engine.
// v0.16.64 final UNITY pass + cleanup.
//
// ENVIRONMENT CONSTRAINTS:
// This file must run UNCHANGED in both browser and node. That means:
//   - No DOM access (document.*, window.*, etc.)
//   - No canvas / ctx access
//   - No performance.now() — use injected clock if needed
//   - No ENTITY_REGISTRY / characters.js direct reference (host injects)
//   - No global side effects on load
//
// All host-specific resources (clock, RNG, character data) flow in
// through createRumbleEngine(config). Engine is otherwise pure.
// ═══════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ─── Engine version ──────────────────────────────────────────────
  // Bumped per push. Helps verify both client and server load matching
  // engine versions when coop sessions start (v0.16.63+).
  var ENGINE_VERSION = '0.16.62';

  // ─── Default config ──────────────────────────────────────────────
  // Host can override any of these via createRumbleEngine(config).
  var DEFAULTS = {
    // Tick rate the engine expects to be called at. Solo runs at raf
    // (60 Hz, dt-driven, this value advisory). Server runs at 30 Hz
    // (locked). Engine logic must be dt-driven, not tick-count driven.
    tickRateHz: 30,
    // Snapshot broadcast rate (server-side only). Browser ignores.
    snapshotRateHz: 20,
    // Logical arena bounds. Coords are normalized 0-1 on the wire,
    // mapped to local viewport at render time. Engine tracks pixels
    // because existing rumble.js logic uses pixel coords; conversion
    // happens at the host edge.
    arenaW: 1000,
    arenaH: 700,
  };

  // ─── createRumbleEngine ──────────────────────────────────────────
  // Factory. Each call produces an independent engine instance. Solo
  // mode creates one. Coop server creates one per session.
  //
  // config: { tickRateHz, snapshotRateHz, arenaW, arenaH, clock, ... }
  // returns: engine object with public API
  function createRumbleEngine(config) {
    config = config || {};
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = (k in config) ? config[k] : DEFAULTS[k];

    // ─── State ─────────────────────────────────────────────────────
    // The CANONICAL state. All simulation lives here. Host (rumble.js
    // for browser, server.js for coop) takes references to these
    // arrays/objects at init and mutates through them. Engine and
    // host see the same memory.
    //
    // v0.16.60 strategy: arrays start empty, host populates as before
    // via existing top-level code. The arrays just live HERE now
    // instead of as scattered top-level vars in rumble.js. Future
    // pushes migrate the mutation logic INTO engine methods.
    var state = {
      // Players (multi-player ready, even in solo there's just one)
      players: {},
      // World entities — enemies
      entities: [],
      deadEntities: [],
      // Projectiles
      blueBolts: [],
      witherbolts: [],
      // Placed structures
      grayWalls: [],
      traps: [],
      // DoT zones
      poisonPuddles: [],
      thornShards: [],
      redDashTrails: [],
      // Pickups
      droppedBricks: [],
      // Field effects
      whiteFields: [],
      // Per-entity DoT effects
      bleeds: [],
      // Ability persistence
      greenSlowAuras: [],
      greenBubbles: [],
      purpleBursts: [],
      warpTrails: [],
      armorBursts: [],
      // Wave state
      wave: {
        current: 0,
        active: false,
        advancing: false,
        startedAt: 0,
      },
      // Tick metadata
      tickCount: 0,
      lastTickMs: 0,
      // Status — drives coop session lifecycle (active, victory, defeat)
      status: 'idle',
    };

    // ─── Event subscribers ─────────────────────────────────────────
    // Host subscribes to engine events for FX triggering. Engine emits
    // events via _emit; subscribers fire side effects (floating text,
    // particles, screen shake, etc.). FX is per-client polish, never
    // engine state.
    //
    // v0.16.60: subscriber surface ready but engine doesn't emit yet
    // (no logic moved in). v0.16.61 starts emitting from applyDamage.
    var subscribers = {
      damage:    [],   // (entity, dmg, source, opts, result)
      death:     [],   // (entity, source)
      cast:      [],   // (playerId, castType, args)
      waveStart: [],   // (waveNum)
      waveClear: [],   // (waveNum)
      victory:   [],   // ()
      defeat:    [],   // ()
    };

    // Host-injected damage handler (v0.16.61). Engine's applyDamage
    // delegates to this. Future pushes (v0.16.62+) may migrate the
    // handler body into the engine itself, eliminating this hook.
    var _damageHandler = null;

    // Host-injected cast handlers (v0.16.62). Map cast string →
    // handler fn. engine.applyCast() looks up the handler and
    // invokes it. Adding a new cast type = registerCastHandler call,
    // never an engine code change. UNITY: dispatch is data-driven.
    var _castHandlers = {};

    function _emit(eventName) {
      var subs = subscribers[eventName];
      if (!subs || subs.length === 0) return;
      var args = Array.prototype.slice.call(arguments, 1);
      for (var i = 0; i < subs.length; i++) {
        try { subs[i].apply(null, args); }
        catch (e) {
          // Subscriber threw — log but don't crash the engine.
          // Engine is the foundation; if FX code breaks, sim continues.
          if (typeof console !== 'undefined' && console.error) {
            console.error('[engine] subscriber error in', eventName, e);
          }
        }
      }
    }

    // ─── Public API ────────────────────────────────────────────────
    // Stable surface. Future pushes ADD to this; existing methods keep
    // their signatures. Memory rule #14 (UNITY): one canonical API,
    // no parallel paths.
    var engine = {
      version: ENGINE_VERSION,

      // Direct state access. Host takes references and uses them.
      // v0.16.60: this is THE migration vehicle — arrays live here,
      // host points its existing top-level vars at engine.state arrays.
      // Future pushes (v0.16.63+) make state read-only externally and
      // require all mutations to go through engine methods.
      state: state,

      // ── Lifecycle ──
      start: function () {
        state.status = 'active';
        state.tickCount = 0;
        state.lastTickMs = (typeof performance !== 'undefined' && performance.now)
                           ? performance.now() : Date.now();
      },
      stop: function () {
        state.status = 'idle';
      },

      // ── Player management ──
      // v0.16.60 stub: player records live here, but host (rumble.js)
      // still owns the active-player object via top-level `player` var.
      // v0.16.61+ migrates ownership.
      addPlayer: function (playerId, cls, opts) {
        opts = opts || {};
        state.players[playerId] = {
          id: playerId,
          cls: cls,
          x: opts.x || cfg.arenaW * 0.5,
          y: opts.y || cfg.arenaH * 0.5,
          hp: opts.hp || 10,
          hpMax: opts.hpMax || opts.hp || 10,
          armor: opts.armor || 0,
          bricks: opts.bricks || {},
          alive: true,
          spectating: false,
        };
      },
      removePlayer: function (playerId) {
        delete state.players[playerId];
      },

      // ── Tick ──
      // Called by host. Solo: from raf loop. Server: from setInterval
      // at tickRateHz. v0.16.60 stub: tick records elapsed time but
      // doesn't run simulation logic (host's update() still drives
      // everything). v0.16.61+ migrates logic into engine.
      tick: function (dt) {
        state.tickCount++;
        state.lastTickMs = (typeof performance !== 'undefined' && performance.now)
                           ? performance.now() : Date.now();
        // v0.16.61+ adds: phased pipeline (sense, decide, act, react,
        // cleanup). For v0.16.60 this is a no-op so behavior stays
        // identical to pre-engine code path.
      },

      // ── Cast handling ──
      // CHOKE POINT for all player casts. v0.16.62: dispatch table
      // architecture lands. Host (rumble.js) registers per-cast
      // handlers via registerCastHandler('white_overload', fn). When
      // a player input becomes a cast event, host calls
      // engine.applyCast(playerId, castEvent) — engine looks up the
      // registered handler and invokes it.
      //
      // Cast event shape:
      //   { cast: 'white_overload', count: 3, ox: number, oy: number,
      //     isCrit: bool, ts: number }
      // (cast types and field names per per-handler convention. The
      // cast string is the dispatch key.)
      //
      // EMITS: 'cast' event after handler returns. Subscribers see
      //   every cast for analytics, FX, and (v0.16.63+) coop sync.
      //
      // v0.16.62 wires ONE cast (white_overload) through dispatch.
      // Other 10 fireOverload* calls stay direct in rumble.js until
      // v0.16.63 extends the pattern.
      applyCast: function (playerId, castEvent) {
        if (!castEvent || !castEvent.cast) return null;
        var handler = _castHandlers[castEvent.cast];
        var result = null;
        if (handler) {
          result = handler(playerId, castEvent);
        }
        _emit('cast', playerId, castEvent.cast, castEvent, result);
        return result;
      },

      // Host registers a cast handler. Multiple casts can share a
      // handler (rare); a cast can have only one handler at a time.
      // Re-registering replaces the previous handler.
      registerCastHandler: function (castType, fn) {
        _castHandlers[castType] = fn;
      },

      // ── Damage handling ──
      // CHOKE POINT for all damage application. v0.16.61: engine
      // delegates to a host-injected internal handler (rumble.js
      // registers `_applyDamageInternal` here). The 20 scattered
      // callsites in rumble.js now route through this method —
      // foundation for centralized damage policy (resistance,
      // tier calc, death detect, FX events).
      //
      // Returns whatever the internal handler returns:
      //   { applied, tier, witherBoost, killed }  (or null if no handler)
      //
      // EMITS: 'damage' event after handler returns, with full
      //   context. Subscribers (FX layer) can spawn floaters etc.
      //   without inlining at each callsite. v0.16.62 migrates FX
      //   to subscribers; v0.16.62+ moves the internal handler
      //   logic INTO the engine itself.
      applyDamage: function (entity, dmg, source, opts) {
        if (!_damageHandler) {
          // No handler registered — engine.applyDamage is the choke
          // point but rumble.js hasn't booted yet. Return null so
          // any caller knows the damage didn't land.
          return null;
        }
        var result = _damageHandler(entity, dmg, source, opts);
        _emit('damage', entity, dmg, source, opts, result);
        if (result && result.killed) {
          _emit('death', entity, source);
        }
        return result;
      },

      // Host (rumble.js) registers the internal damage handler at
      // start. Engine doesn't know damage internals (resistance
      // tables, signature reactions, etc.) — host provides them.
      // v0.16.62+ may migrate handler logic INTO engine; for now
      // injection keeps rumble.js as logical owner.
      registerDamageHandler: function (fn) {
        _damageHandler = fn;
      },

      // ── Snapshot APIs ──
      // getSnapshot: wire-ready state for broadcast. Subset of full
      //   state — only what other clients need to render. v0.16.60
      //   returns a structural shell; v0.16.63 fills in entity data
      //   when coop cuts over to server-authoritative entities.
      // getRenderState: full state for local render. Returns the
      //   actual state object so host can iterate efficiently. NEVER
      //   mutate this — it's the same memory the engine owns.
      getSnapshot: function () {
        // Wire-format snapshot. Coop server broadcasts this; coop
        // clients receive it and feed to renderer. Solo never calls.
        // v0.16.60 returns minimal shape — extended progressively.
        var playersOut = {};
        for (var pid in state.players) {
          var p = state.players[pid];
          // Normalize coords to 0-1 for cross-device coop. Same
          // approach as v0.16.58 player state push.
          playersOut[pid] = {
            cls: p.cls,
            nx: cfg.arenaW > 0 ? p.x / cfg.arenaW : 0.5,
            ny: cfg.arenaH > 0 ? p.y / cfg.arenaH : 0.5,
            hp: p.hp, hpMax: p.hpMax,
            armor: p.armor,
            bricks: p.bricks,
            alive: p.alive,
            spectating: p.spectating,
          };
        }
        return {
          version: ENGINE_VERSION,
          tickCount: state.tickCount,
          status: state.status,
          players: playersOut,
          // Entities, projectiles etc. populate in v0.16.63 cutover
          // when server takes ownership of these arrays. For v0.16.60
          // they're empty in the snapshot (host still client-auth).
          entities: [],
          wave: { current: state.wave.current, active: state.wave.active },
        };
      },
      getRenderState: function () {
        // Returns the live state object. Host renderer reads directly.
        // SAFETY: do NOT mutate from render code. This will be
        // enforced by Object.freeze in v0.16.64 polish.
        return state;
      },

      // ── Event subscription ──
      // Host (rumble.js) registers callbacks for FX triggers. Engine
      // emits events from applyDamage / applyCast / lifecycle moves.
      // Memory rule #28 (unify-at-choke-point): emit at the single
      // choke, subscribers handle FX without duplicating logic.
      on: function (eventName, callback) {
        if (!subscribers[eventName]) subscribers[eventName] = [];
        subscribers[eventName].push(callback);
      },
      off: function (eventName, callback) {
        var subs = subscribers[eventName];
        if (!subs) return;
        var idx = subs.indexOf(callback);
        if (idx >= 0) subs.splice(idx, 1);
      },

      // ── Bounds / config ──
      // Host can update arena dimensions when canvas resizes. v0.16.60
      // these come from the host; v0.16.64+ may centralize.
      setArenaBounds: function (w, h) {
        cfg.arenaW = w;
        cfg.arenaH = h;
      },
      getArenaBounds: function () {
        return { w: cfg.arenaW, h: cfg.arenaH };
      },
    };

    return engine;
  }

  // ─── Module export ───────────────────────────────────────────────
  // Browser: attach to window. Node: attach to module.exports.
  // Both environments: also attach to root for direct access.
  var api = { createRumbleEngine: createRumbleEngine, ENGINE_VERSION: ENGINE_VERSION };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.RumbleEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis :
   typeof window !== 'undefined' ? window :
   typeof global !== 'undefined' ? global : this);
