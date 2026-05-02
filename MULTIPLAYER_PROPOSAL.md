# Multiplayer Rumble — Architecture Proposal

**Status:** Pre-code design. Awaiting Ross approval before v0.16.56 build starts.

**Locked design parameters:**
- Server-authoritative entity state
- Co-op only (PvP later)
- 6 player max
- No friendly fire (attacks pass through allies, walls treat all players as owner)
- Death = spectate until wave clears, respawn at next wave
- rumble_test.html sandbox FIRST, production rumble flow LATER
- Design philosophy: UNITY / ELEGANCE / EFFICIENCY

---

## Audit findings

### Current rumble_test.html architecture
- **Standalone offline page.** Loads `rumble.js` as a script. NO server connection.
- Calls `Rumble.start({...})` with a class config.
- `_waveState` is a local var. `spawnWave(n)` calls `Rumble.spawnEntity(t)` directly.
- Wave-clear detection is in a polling loop checking `info.entityCount === 0`.
- Public `Rumble` API is well-defined (init, start, spawnEntity, getState, setPauseState, etc.)

### Current rumble.js architecture
- **Client-authoritative.** `entities[]`, `player`, `blueBolts[]`, `grayWalls[]`, `traps[]` all live in the client.
- Entity AI ticks each frame on the client. Damage applies locally.
- Public API exposes `Rumble.spawnEntity()` and `Rumble.getState()` — server can use these as integration points.

### Current server.js architecture
- Has `G.rumbleBattle` for the production board-game flow. Currently used for "DM watches the rumble" — server stores cosmetic state from client `battleTick` messages.
- Production rumble is also client-authoritative. **We are not changing that in this arc.**
- Sandbox multiplayer (rumble_test.html) gets its own server lifecycle, separate from `G.rumbleBattle`.

### NOTES.md prior thinking
- Multi-player arena was deferred to "thread 9, polish stage" in earlier roadmap.
- Reordering now: sandbox multiplayer first proves out the protocol cheaply. Production gets it later.
- "Socket wire between rumble and server" was always identified as a BLOCKER — it's just now we're building it for the sandbox not production.

---

## Architecture

### Server-side state (new)

A new `G.rumbleSession` struct on the server, keyed by session ID. Lifecycle is independent from `G.rumbleBattle` (production). Sandbox sessions don't touch board game state.

```
G.rumbleSession = {
  id: 'rs_abc123',           // session ID
  players: {
    'p_xyz1': {              // player ID (per-socket, not class)
      cls: 'snapstep',
      x, y, hp, hpMax, armor,
      bricks: { red: 2, ... },
      alive: true,
      spectating: false,
      lastInputTs: 12345,
    },
    ...
  },
  entities: [
    {
      id: 'e_001',
      type: 'goblin',
      x, y, hp, hpMax,
      state: 'chase',          // patrol | chase | bounce | etc
      aggroTarget: 'p_xyz1',   // which player they're chasing
      ...                      // full entity state
    },
    ...
  ],
  walls: [...],                // gray walls — no ownerCls (or shared ownership)
  projectiles: [...],          // blueBolts
  traps: [...],
  wave: {
    current: 3,
    advancing: false,
    nextSpawnAt: null,
  },
  arena: { x, y, w, h },       // arena bounds
  status: 'waiting' | 'active' | 'between_waves' | 'victory' | 'defeat',
  startedAt: 1700...,
}
```

### Client-side responsibilities

**LOCAL (per-client, not synced):**
- Floating texts, sparkles, screen shake, FX particles
- Input handling (gestures, brick taps)
- Rendering (draw loop, HUD)
- Sound

**LOCAL → SERVER (client sends):**
- Player position updates (capped rate, ~20-30 Hz)
- Cast events ("I cast red dash from X to Y at time T")
- Brick consumption events
- Pause/resume requests

**SERVER → CLIENT (server broadcasts):**
- Tick: full entity state (positions, HP, AI state)
- Tick: all player positions/HPs/bricks
- Tick: walls, projectiles, traps
- Wave events (banner, spawn, clear, victory)
- Cast result events (damage applied, FX trigger)
- Death/respawn events

### Tick rate

- Server runs entity AI tick at **30 Hz** (33ms)
- Server broadcasts state at **20 Hz** (50ms — keeps bandwidth modest for 6 players)
- Client renders at 60fps locally with interpolation between server snapshots

### Friendly fire / wall behavior

- All damage application checks: `if (target is ally) skip`
- All gray walls: treat ANY player as owner for collision (player passes freely through ally walls; wall blocks all enemies)
- Enemy projectiles: hit any player; arc walls block (existing behavior)

### Death/respawn

- Player HP → 0: `alive = false, spectating = true`. Stop sending input from server's perspective. Client can move camera, watch.
- Wave clear: server scans players where `spectating === true`, resets HP, repositions at safe spawn, sets `alive = true, spectating = false`.

---

## Push plan

### v0.16.56 — FOUNDATION: server endpoint + client connect + ally rendering

**Scope (MVP):**
- Server: new message types `rumble_session_join`, `rumble_session_leave`, `rumble_player_state` (input from client), `rumble_session_state` (broadcast to clients)
- Server: simple `G.rumbleSessions` dict keyed by session id (one session for now)
- Server: 20 Hz broadcast loop for the session
- Client (rumble_test.html): connect via websocket on load, declare session, enter shared arena
- Client: when entering rumble, send player state each tick (position, HP, bricks)
- Client: render allies as ghost-sprites at their positions
- **STILL CLIENT-AUTHORITATIVE for entities this push** — entities run locally on each client, NOT synced. Allies see different goblins but they see each other moving.
- Goal: prove the network plumbing. Two browsers connect, both see each other moving.

**Files touched:** server.js, rumble_test.html, rumble.js (small — add ally render + send player state hooks)

**Out of scope for this push:** entity sync, damage authority, waves, death, friendly fire (still single-player from entity perspective).

---

### v0.16.57 — ENTITY AUTHORITY: server owns entities

**Scope:**
- Server: spawns entities, runs AI tick, broadcasts entity state
- Client: stops computing own entities, renders from server snapshot
- Client → Server: cast events (server applies damage)
- Server → Client: damage results + FX trigger broadcasts
- Goal: same goblin in same place, same HP for everyone. When ally hits, you see the damage.

**Files touched:** server.js (large — port entity AI from rumble.js), rumble.js (entity ownership shifted to render-only), rumble_test.html (cast event wire)

**Out of scope:** waves still client-driven, death still client-side.

---

### v0.16.58 — WAVES + DEATH/RESPAWN

**Scope:**
- Server: wave state machine, `spawnWave(n)` server-side, wave-clear detection
- Server: player death lifecycle (spectator state, respawn at wave clear)
- Client: render banner from server "waveStart" events
- Client: spectator camera mode when alive=false
- Goal: full coop loop closes. 6 players join, fight waves, die, respawn, victory.

**Files touched:** server.js, rumble_test.html (UI updates for spectator/wave events), rumble.js (spectator render)

---

### v0.16.59 — POLISH

**Scope:**
- Friendly fire gate (all damage paths skip allies)
- Wall ownership treats all players as owner (collision, projectile block, regen)
- Latency interpolation for entity rendering
- Disconnect handling (player drops out mid-rumble)
- Goal: feels solid, feels coop.

---

### v0.16.60 — PRODUCTION ROLLOUT (board-game rumble)

**Scope:**
- Apply same architecture to `G.rumbleBattle` (production)
- Multi-player landing on monster space → all join same rumble
- Existing single-player rumble entry continues working (1-player session)
- Goal: board game multiplayer fights work

---

## Why this order

1. **Sandbox first** isolates risk. If anything in the multiplayer architecture is wrong, we discover it without breaking production rumble. The board game flow stays solid throughout.
2. **Networking before authority** (v0.16.56 → v0.16.57) lets us verify the websocket plumbing on its own. If two browsers can't see each other moving, no point porting entity AI yet.
3. **Authority before waves** (v0.16.57 → v0.16.58) means waves naturally inherit server authority. Wave logic on server is simpler than wave logic + ad-hoc entity-syncing patches.
4. **Polish last** because the polish items (friendly fire, wall ownership) need the foundation to be testable.

---

## Risks + open questions

### Performance: 6 players × full entity broadcast

20 Hz broadcast of full state to 6 clients. Estimate per tick:
- 6 players × ~80 bytes = 480 bytes
- 8 entities × ~100 bytes = 800 bytes
- ~10 walls/projectiles/traps × ~60 bytes = 600 bytes
- = ~2 KB per snapshot
- × 20 Hz = ~40 KB/s per client
- × 6 clients = ~240 KB/s total server bandwidth

Tolerable on local network. Compression / delta-broadcast can come later.

### Lag spikes / packet loss

Local network (the deployment target per NOTES.md) is highly reliable. We don't need entity prediction or rollback. A 50ms server tick is fast enough that entity motion will look smooth at 60fps client interp.

### Player count >2 in v0.16.56

Foundation push targets 2+ players. Architecture supports up to 6 from day one. We just won't stress-test 6 until v0.16.59 polish phase.

### Class identity preservation

Each player keeps their class mechanics (BS arc walls, SS pierce, etc.). Server entity authority means class abilities ALSO need server-side validation (e.g. "cls=blocksmith cast gray, server applies pip increment"). This is straightforward — characters.js already drives all class logic, and characters.js is loaded by both client and server.

### Walls as shared resources

Per design: gray walls treat all players as owner. So:
- Any player passing through their ally's wall → no collision
- Any enemy projectile hitting any wall → blocked (already works)
- Wall death regen: only the original caster gets the +1 pip (or shared? worth a design call)

Open question: **does wall death regen go to the caster, OR to all alive players, OR to whoever last hit the wall?** I lean caster-only (preserves identity beat — BS gets pip back when their wall dies). Confirm.

### Test infrastructure

For a 6-player test, we'd need 6 browser tabs/devices connecting. Realistic test setup:
- 2 dev machines for early testing
- Phone + laptop combo for actual multiplayer feel
- 6-player stress test only when polish push lands

---

## Memory rule alignment

- **Rule #14 (UNITY):** server.js is single source of truth for entities. No parallel logic on each client.
- **Rule #18 (UNITY/ELEGANCE/EFFICIENCY):**
  - UNITY: server.js authority for state, client.js authority for rendering, no overlap
  - ELEGANCE: minimal new files, extend existing structures (`G.rumbleSessions` mirrors `G.rumbleBattle` shape)
  - EFFICIENCY: 20 Hz broadcast, ~40 KB/s per client. No premature optimization.
- **Rule #28 (unify-at-choke-point):** entity AI tick lives in ONE place (server). All player damage/cast handling at ONE entry on server.
- **Rule #15 (handoff hygiene):** this proposal IS the scan output. Multiplayer arc starts fresh from here.

---

## What I need from Ross before code

1. **Approve this architecture** OR identify changes
2. **Wall regen ownership:** caster-only, shared, or last-hitter? (My lean: caster-only.)
3. **Confirm push scope:** v0.16.56 = networking foundation only. Allies visible, no entity sync. OK?
4. **Test setup:** how do you want to test 2-player initially? Two browser tabs on same machine, or two devices on local network?

Once these four are answered, I start v0.16.56 build.
