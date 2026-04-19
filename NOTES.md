# BrickQuest — Project Notes

## Major Cleanup — April 2026

The turn-based battle system and all class skills were ripped out to make room for the real-time rumble system (v1 shipped Phase 1, Phase 2 next). Removed server-side: all `startBattle`, `rollAttack`, `useBrickInBattle`, `monsterAttack`, `endBattle`, `resolveBattle*`, `advanceBattleTurn`, `nextBattleRound`, `setComplication`, `bossPhase2`, `monsterHPDelta`, `battleTrapPersist`, plus all skill handlers (`unlockSkill`, `activateEnhanced`, `consumeEnhanced`, `deconstructGate`, `rebuildBridge`, `blueprint`, `forge`, `infiniteBlueprint`, `salvage`, `wrecking_ball`, `tameAttempt`, `commandTamed`, `catapult`), plus the legacy out-of-battle brick actions (`addShield`, `healPlayer`, `massRepair`, `revivePlayer`). Game.js lost `MONSTER_TEMPLATES`, `COMPLICATIONS`, and the entire `SKILLS` block. Player state no longer has `skills`, `tamed`, `scavengeRolled` fields; global no longer has `enhancedMovement` or `battleResult`.

Player files (players.html, test_players.html) still contain **dead code paths** that reference the old system — skill tab rendering, battle-mode phase banners, initiative displays. Those paths never execute (they gate on `G.battle` or call SKILLS which is now empty). Left in for now to keep the rip contained; scrub during Rumble Phase 2 integration. Also kept as no-op stubs: the client-side wrappers like `client.startBattle()`, `client.tameAttempt()`, etc., so any orphaned UI buttons log a warning instead of crashing.

**Kept working** (untouched by rip): Red dash + gate-break, landing events (gold/gray/blue/trap/riddle/purple/creeper), prepare phase UI, trade/market/gate mechanics, rumble pending + active flow, DM screen, player classes (HP/speed/starting bricks).

**Rebuild queue:** skills system, all class-specific abilities (Builder's Blueprint/Forge, Beastcaller's Tame/Command, Mender's Mass Repair/Revive, etc.) — will be redesigned from scratch during Rumble Phase 2+ when combat is real.

---

## Combat & Economy Design — v1 (April 2026)

> **Status:** design spec, no code yet. This doc is the canonical reference for the redesigned game economy. Replaces all previous class/combat notes below.

### Philosophy

Starting conditions should feel **weak and scared**. A first goblin fight should leave a Warrior bloodied and a Wizard almost dead. Power and complexity grow as players earn skills, fuse fragments into bricks, and invest bricks into their kit and combat. The combat economy is driven by **brick refresh rate** during rumble, and **fragment/fusion** on the board. Progression and discovery are the center of player experience — customization comes through earned upgrades.

### The two-layer economy

**In-rumble (real-time combat):**
- Player enters with a fixed class starting kit of 3 bricks
- Bricks refresh CONTINUOUSLY during battle at per-class per-color rate
- Signature colors refresh fast, baseline colors refresh slowly
- Overload (holding a brick) burns multiple bricks at once, with fatigue curve
- Pool caps prevent infinite stockpiling
- When battle ends, rumble brick state is discarded; inventory is separate

**On-board (turn-based):**
- Fragments are the primary resource (all 9 colors, 1 fragment type per color)
- Fragments drop from landing events, enemy battle rewards, and market purchases
- Fragments fuse into full bricks via a fusion minigame (mix of same-color and recipe combinations)
- Bricks live in player inventory between battles
- Bricks have rich **out-of-battle** uses — every color has pre-battle prep effects and other utility

**The funnel:**
```
Fragments (scattered) → Fusion (minigame) → Bricks (inventory)
                                                ↓
                           ┌────────────────────┴────────────────────┐
                           ↓                                         ↓
                  BOARD USES (prep, events)           RUMBLE USES (abilities + refresh)
                           ↓                                         ↓
                  Armor/HP buffs, utility            Combat with fatigue curve
                                                                     ↓
                                                              BATTLE END
                                                                     ↓
                                              HP regen (scaled by performance)
                                              Fragments (earned) + gold
                                              Rare: full brick drop
```

### Class lineup (6 classes)

Starting values — rumble-entry. HP does not auto-refill fully between battles; regen scales with performance.

| Class | HP | Speed | Signature (3s refresh, pool 4) | Secondary (5s refresh, pool 3) | Starting kit |
|---|---|---|---|---|---|
| Warrior | 14 | 150 | red | gray | red×2, gray×1 |
| Wizard | 6 | 180 | blue | purple | blue×2, purple×1 |
| Scout | 9 | 260 | orange | red | orange×2, red×1 |
| Builder | 12 | 150 | gray | orange | gray×2, orange×1 |
| Mender | 8 | 160 | white | purple | white×2, purple×1 |
| Beastcaller | 10 | 220 | green | yellow | green×2, yellow×1 |

All non-signature, non-secondary colors are **baseline** (10s refresh, pool cap 2).

### Brick refresh mechanics (rumble only)

| Tier | Refresh rate | Pool cap |
|---|---|---|
| Signature (1 color per class) | 3s per brick | 4 max |
| Secondary (1 color per class) | 5s per brick | 3 max |
| Baseline (7 colors per class) | 10s per brick | 2 max |

Refresh ticks continuously. Pool caps at the listed maximum.

### Overload fatigue (hybrid)

Every battle maintains two fatigue counters: **signature** and **off-class**.

- Overload on signature or secondary color → signature counter +1
- Overload on baseline color → off-class counter +2

Each counter applies to its own overloads. Damage multiplier table:

| Counter | Effectiveness |
|---|---|
| 0 | 100% |
| 1 | 80% |
| 2 | 60% |
| 3 | 50% |
| 4+ | 40% floor |

Both counters reset at battle end.

### Fragment & fusion system

- 9 fragment types (one per color): red-frag, blue-frag, gray-frag, white-frag, yellow-frag, orange-frag, purple-frag, green-frag, black-frag
- Fusion minigame recipes (TBD in playtest, but examples):
  - 3 red-frag → 1 red brick (same-color)
  - 2 red-frag + 1 blue-frag → 1 purple brick (recipe)
  - 3 red-frag + 3 yellow-frag → 1 orange brick
  - 3 white-frag → 1 white brick
  - 5 gray-frag → 1 black brick (dark, rare)
- Exact recipes and ratios to be tuned during playtest
- Fragments drop from every event (landing rolls, enemy drops, market)

### Out-of-battle brick uses (every color has rich uses)

To be designed in detail (next session). Examples to start thinking:
- Gray: convert to armor pip pre-battle; build temporary wall on board?
- White: heal HP between battles; cleanse debuff?
- Red: deal damage to a gate; intimidate (reroll?); pre-battle rage +damage?
- Blue: scry (peek at next event); long-range reveal?
- Orange: set trap on board space; pre-battle damage pool?
- Green: create green-space (blocks enemies on board?); boost regen?
- Purple: sacrifice HP for extra action; cleanse status?
- Yellow: hint toward riddle; skip bad event?
- Black: unclear; design later

### Battle loot

Victory rewards:
- Fragments (guaranteed; quantity scales with battle performance)
- Gold (small amount)
- Very rarely: 1 full brick drop (jackpot)

Battle performance metrics:
- Speed of kill
- HP remaining
- No-damage or flawless (took 0 damage)
- Overloads used (fewer = harder fight handled better)
- Fatigue minimized

These performance metrics ALSO drive post-battle HP regen rate. A flawless kill regenerates more HP than a squeaker.

### HP regeneration philosophy

- Does NOT auto-refill between battles
- Regen happens based on achievement — better fights = more HP back
- Exact curves TBD (candidate: flawless = +6 HP, dominant = +3 HP, survived = +1 HP, limping = 0)
- This creates risk/reward for playing aggressively vs. conservatively
- Also rewards cautious play on board (use prep bricks to buff before the fight)

### Progression (skills system — deferred design)

Not in this spec. Skills will be designed next economy pass. Current placeholder directions:

- Reduce refresh time on signature color
- Expand pool cap on signature
- Reduce fatigue decay on overloads
- Increase fragment drop rate from events
- Class-specific abilities (each class gets 1-2 unique hooks)

### Open questions for next design pass

1. Exact out-of-battle use for every brick color (9 designs needed)
2. Fusion minigame mechanic (what does it look like?)
3. Fragment drop table by event type
4. Precise HP regen formula tied to performance metrics
5. Board prep action UI — how does player pick pre-battle buffs?
6. Character tuning via playtest after base system is in code

---

## What is BrickQuest?

A multiplayer tabletop rumble game. Players use colored "bricks" as abilities in real-time combat. DM controls the encounter via a separate screen. Runs on local network — players use phones, DM uses laptop.

## Brick Colors & Actions

| Brick | Action |
|-------|--------|
| Red | Charge toward target — deals damage, bounces entity |
| White | Tap=instant heal, Drag=regen over time |
| Yellow | Confuse in radius — random movement, halved attack speed |
| Blue | Homing bolt to target — impact burst |
| Orange | Tap=trap at feet, Drag=sealed trap at point, bleed on release |
| Gray | Tap=armor pips, Drag=expanding wall |
| Green | Expanding ring push + poison |
| Purple | Expanding burst — heals player for damage dealt |
| Black | Darkness zone — pulls entities, damage ticks, slow debuff |

**Canonical hex values** (in `BRICK_COLORS` constant):
red `#E24B4A`, blue `#006DB7`, green `#1D9E75`, white `#EFEFEF`, gray `#5e6a7a`, purple `#7B2FBE`, yellow `#F5D000`, orange `#F57C00`, black `#333333`. Gray was `#AAAAAA` but was visually indistinguishable from white on the brick bar — moved to slate.

Brick buttons render as solid-colored rounded squares (no emoji icons) with an inset bevel shadow for a brick feel. Qty badge top-right, pips anchored bottom.

Overload: hold brick button in place to charge — each tier costs 1 brick charge, increases power. Tier duration is 0.9s (was 0.5s; raised because taps on Android regularly exceeded 0.5s and accidentally triggered overload).

**Drag vs. overload dispatch.** A drag (finger moved > 20px) always wins over a hold. Rules at release:
- Drag only → fire the brick's drag handler at release point, consume 1 brick
- Drag + held ≥ tier duration → `fireOverload(x, y, n)` at release point (overload drag)
- Held ≥ tier duration in place → `fireOverload(undefined, undefined, n)` at player
- Quick tap → single brick action at player

This ordering matters: if "held" beat "dragged," long drags across the screen would always overload instead of placing the effect where the player dragged it.

## Class System

| Class | HP | Speed | Signature | Starting Bricks |
|-------|----|-------|-----------|----------------|
| Warrior | 16 | 170 | Red 0.8s | red×3, gray×2, white×1 |
| Wizard | 8 | 195 | Blue 1.5s | blue×2, black×1, yellow×1, purple×1 |
| Scout | 12 | 260 | Orange 1s | orange×3, blue×1, red×1 |
| Builder | 14 | 150 | Gray 0.7s | gray×4, orange×2, white×1 |
| Mender | 10 | 160 | White 0.8s | white×3, purple×2, yellow×1 |
| Beastcaller | 12 | 220 | Green 0.9s | green×3, yellow×2, orange×1 |

## Skill Paths (designed, not yet built)

Each class has two paths. Examples:
- Warrior: Wrath (red gets stronger per hit) vs Bastion (armor converts to damage)
- Wizard: Puppetmaster (confuse + darkness combo) vs Conduit (debuffs boost bolt)
- Scout: Ambush (traps hit harder the longer dormant) vs Blur (dash leaves poison)
- Builder: Siege (walls explode when broken) vs Recycle (traps/walls reset on kill)
- Mender: Lifeline (damage triggers regen pulse) vs Drain (heal scales with target missing HP)
- Beastcaller: Plague (poison spreads on death) vs Herder (confuse becomes directional)

## Rumble Test — Technical Notes

- Single HTML file, no dependencies
- Canvas 2D rendering
- Touch events for Android/iOS
- Local network server: `bash serve.sh` on Mac
- Class buttons use `<button>` elements with `onclick` handlers
- Canvas touch listeners added AFTER class selection to avoid blocking overlay
- `updateHUD()` uses null-safe element setters (elements may be hidden)
- Brick bar split: left col (black/yellow/green/gray/white), right col (red/blue/orange/purple)
- Zero-count bricks not rendered

### DPR-aware canvas sizing

The canvas must be sized in two coordinate spaces: backing store (physical pixels) and CSS (logical pixels). `resize()` does:

```js
canvas.width  = cssW * dpr;  // backing store — sharp on hi-DPI
canvas.height = cssH * dpr;
canvas.style.width  = cssW + 'px';  // CSS display size
canvas.style.height = cssH + 'px';
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // drawing code uses CSS pixels
```

All touch→canvas coord mapping is then 1:1 via `rect.left`/`rect.top` subtraction — **do not** multiply by `canvas.width / rect.width` (that gives physical pixels and breaks hit-testing). Do NOT put `width:100vw; height:100vh` in the canvas CSS — it fights the JS-set inline sizes, and on Android Chrome `100vh ≠ innerHeight` during URL-bar transitions, which visibly stretches circles into ovals.

### Floating text rendering

There's ONE draw path for `floatingTexts`: the monkey-patched `draw` wrapper that runs after `_origDraw()`. The original `draw()` must NOT also iterate `floatingTexts` — doing so decrements alpha twice per frame and damage numbers vanish before they can be seen. If you're adding a new effect layer, put it in the wrapper, not the base.

### Ghost-click guard on brick buttons

Android fires both `touchstart` and a synthetic `mousedown` ~300ms later. Without a guard, `onBrickDown` registers two copies of document listeners per press. Guard: record `_lastTouchBrickTime` on touchstart; on mousedown within 600ms, bail. Also `_brickDownActive` flag prevents re-entry from a second finger.

### HP numbers above bars

Draw order matters. The HP bar's dark background paints over text if text is drawn first. Current order: bar → numbers-on-top with a 3px black stroke for readability on any background. Entity HP numbers were previously `#151528` (invisible on the dark arena) — now white-with-stroke.

### Red charge visuals

Charge speed is `player.speed × 2.6` (was ×4, too fast to see). Every frame of the charge phase emits 3 trail particles behind the player AND records player position into `brickAction._trail` (max 12 points); the streak is rendered as fading red-orange line segments under the player with `shadowBlur` glow.

## Board Game Features

### Prepare Phase

Earlier phases `setup`, `trade`, `move` were merged into a single `prepare` phase. Remaining phases: `prepare | land | battle`. Old saves auto-migrate on load.

Player UI: flat list of expandable action cards. Tap a card to expand, shows details and a Use button. Unavailable actions (no bricks, wrong class, wrong skill) are hidden entirely, not grayed. Active-player-only actions (Move) only render on the active player's turn.

Header above actions uses rotating dungeon dad-joke flavor text (see `PREPARE_FLAVOR` pool in both player files). Holds steady for a round to avoid flicker.

### Red Brick Dash

Player spends 1 red brick to dash 1–4 spaces. Gated by DM approval (`pendingDashRequest` → DM sees card → approve/deny). Server-side resolver: `resolveDash(cls, spaces, forcedByDM)` in `server.js`.

**Gate-break on dash.** If dash path crosses a locked forceable gate (z1z2, z3z4, z5boss), class weight determines outcome:
- Heavy (Warrior, Builder): always break, 0-3 damage
- Mid (Mender): 50% break chance, 1-2 damage rolled regardless of success
- Light (Scout, Beastcaller): 35% break chance, 1-2 damage always
- Wizard (lightest): 15% break chance, 1-2 damage always

Key-only gates (z2z3, z4z5) stop the dash entirely with no attempt — require actual keys.

Class-specific flavor text for success and fail (`DASH_FLAVOR` in `game.js`). Dash result card shows outcome with appropriate icon/color per gate event.

**Charge tax.** Using dash sets `battleDashPenalty = 1`. Next battle that turn consumes an extra red brick (fatigue). Detail shown in the dash action button: "One red charge will be unavailable if you encounter any enemy this turn, but will return on next prepare phase."

### DM Force Dash

Testing tool in DM's Movement card. Enter any number of spaces, teleports the active player through the same `resolveDash` (so gate-break rolls still apply). No brick cost, no fatigue flag. Unlike player dash, does NOT transition to `land` phase — player returns to their prior state after dismissing the dash result card.

### Trade Restrictions

Trade and direct item give blocked if either party is currently in battle (i.e., listed in `G.battle.combatants`). Non-battling players can still trade among themselves. Server-side check in `offerTrade` and `giveItems` handlers.

### Market

Always accessible from prepare phase unless: player in battle, on a restricted zone (zone 5), or DM toggled off. No longer tied to specific board spaces. Rendered as an expandable action card with an inline 3x3 brick-purchase grid.

## Rumble Test — Brick Interaction Fix (formerly Arena Test) (Pointer Events)

Original brick handler used mouse + touch events with listeners on `document`. On Brave Android (and likely other modern mobile browsers), this hit two problems:

1. **Touchend coalescing.** When a touch lasted longer than the browser's gesture heuristic (~500ms) without significant movement, the browser reclassified it and `touchend` didn't fire at document-level listeners. Tap-acting-as-hold.
2. **Drag gesture hijacking.** Dragging from a brick button onto the canvas fired `pointercancel` because the browser claimed the gesture as a pan/scroll.

**Fix:** rewrote `onBrickDown` to use **Pointer Events**. Single unified stream, no touch/mouse split. Key details:

- Listeners attached to `document`, not the button. (`renderBrickBar()` runs in the animation loop and replaces brick-panel innerHTML every frame; button-level listeners would die mid-press.)
- `pointerId` filter on each callback so multitouch doesn't cross wires.
- `touch-action: none` on body AND `.brick-btn` — without this, the browser still claims drag gestures and fires pointercancel. The pointer-events API alone isn't sufficient; it needs CSS cooperation.
- `preventDefault()` on pointerdown only. No synthetic event suppression needed (pointer events don't generate synthetic mouse events).

### Fullscreen

Arena requests fullscreen automatically on class selection (valid user-gesture, browser allows). Manual toggle button in top-left corner. Works on Android Chrome and iPad Safari. iPhone Safari blocks element fullscreen — workaround is "Add to Home Screen" for web-app mode.

## Android Issues — Status Overview

When the arena brick interactions broke on mobile (no targeting, tap-acting-as-hold), debugging traced the root cause to touch-event coalescing on Brave Android. The fix was to switch to Pointer Events — but that required reverting `rumble_test.html` to an older baseline (`ArenaTest001.html`) that had working brick mechanics. The reversion RE-INTRODUCED some prior mobile issues that had been addressed in a later version. Status below is honest about what's fixed vs. lost-in-revert.

### Fixed (current)

- **Brick press on mobile** — Pointer Events rewrite. Tap, hold-to-overload, and drag-to-target all work on Android Chrome/Brave and desktop. See "Arena Test — Brick Interaction Fix" above.
- Class selection buttons blocked by canvas touch listeners → fixed by deferring canvas listeners
- `updateHUD()` crashing on missing DOM elements → fixed with null-safe setters
- Canvas colors too dark → class colors brightened

### Lost in revert (may need re-fixing if reported)

- **Oblong characters on Android Chrome** — caused by `width:100vw; height:100vh` in canvas CSS fighting JS-set sizes, especially during URL-bar transitions. Earlier fix was DPR-aware sizing with `ctx.setTransform(dpr, ...)` everywhere. That fix was lost in the revert. If ovals show up on mobile, reapply DPR sizing — but this time carefully, since a partial rewrite is what deleted the drag-reticle drawing code last time.
- **OVERLOAD_TIER** currently 0.5s. Taps that exceed 0.5s will trigger overload instead of a plain tap. May want to raise to 0.9s again if testers accidentally overload on slow taps.
- **Gray vs. white distinction.** Gray brick is `#AAAAAA`, visually close to white on the bar. Earlier fix moved it to `#5e6a7a` slate. Revisit if it causes confusion.
- **Damage number flickering** — earlier fix removed a duplicate floating-text loop. Unclear if the revert reintroduced the double-decrement issue. Check if damage numbers vanish instantly on next playtest.

### Resolved in the current pointer-events flow (no longer needed)

- Ghost-click guard (`_lastTouchBrickTime`, `_brickDownActive`) — pointer events don't fire synthetic mousedown after touchstart, so the guard is unnecessary and was removed.
- Drag-vs-overload dispatch race — the Pointer Events rewrite has simpler logic, not the three-branch dispatch from the earlier Android fix. If drag-to-target misbehaves under specific scenarios (rare), revisit.

## Android Issues Resolved (legacy, from earlier arena work)

- Class selection buttons blocked by canvas touch listeners → fixed by deferring canvas listeners
- `updateHUD()` crashing on missing DOM elements → fixed with null-safe setters
- Canvas colors too dark to see → class colors brightened
- Characters oblong → canvas CSS size set to match pixel size exactly; later resolved properly with DPR-aware sizing (see Technical Notes)
- Overload triggered on every tap → OVERLOAD_TIER raised 0.5s → 0.9s
- Drag-to-target ignored on long drags → dispatch reordered so drag beats hold (see Technical Notes)
- Double-firing brick actions from touch + synthetic mouse → ghost-click guard added
- Damage numbers invisible / flickering off instantly → removed duplicate floating-text loop from original `draw()`
- Entity HP numbers invisible → changed from `#151528` to white-with-stroke
- Gray and white bricks indistinguishable → gray moved from `#AAAAAA` to `#5e6a7a` slate
- Red charge had no visual feedback → slowed speed, added per-frame trail particles + position streak

## Goblin Stats

- HP: 60, attack: 3 dmg, cooldown: 1.8s
- Goblin types planned: Brute (100hp/5dmg/slow), Scout (35hp/2dmg/fast), Shaman (heals allies)

## File Delivery Note

Default: only deliver files that changed this session.

Full set (when explicitly requested): `server.js`, `game.js`, `players.html`, `dm_screen.html`, `test_players.html`, `rumble_test.html`, `rumble.js`, `rumble.css`, `serve.sh`, `package.json`, `package-lock.json`.

End deliveries with the push command:
```
cd ~/Desktop/BrickQuest && git add . && git commit -m "update" && git push
```
or `./save.sh "what changed"`.

---

## Session: Rumble module v1 — extraction, economy, scaling, yellow aura

### Architecture

- Renamed `arena` → `rumble` project-wide (server, game, client pages, NOTES).
- Extracted combat loop out of `rumble_test.html` (previously `arena_test.html`) into a standalone IIFE module: `rumble.js` + `rumble.css`. Test harness `rumble_test.html` is now a 150-line thin wrapper.
- Public API on `window.Rumble`:
  - Lifecycle: `init(opts)`, `teardown()`
  - Control: `start(config)`, `setPauseState(bool)`, `forceEnd(reason)`
  - Queries: `isActive()`, `getState()`, `getConfig()`, `getDebugInfo()`
  - DM tools: `injectBricks(delta)`, `setPlayerHP(n)`, `setEnemyHP(n)`
- Events emitted: `ready`, `start`, `tick` (~500ms), `pause`, `resume`, `playerHit`, `enemyHit`, `playerDown`, `enemyKilled`, `victory`, `defeat`, `timeout`, `quit`, `end` (always last).
- Required DOM: `<canvas id="rumble-canvas">`, `<div id="rumble-brick-bar-left">`, `<div id="rumble-brick-bar-right">`. Optional: `<div id="rumble-hud">` with `#rumble-timer-display`, `<div id="rumble-debug">` (only created when URL has `?debug=1`).

### Combat & Economy v1 (locked)

| Class | HP | Speed | Signature (3s refresh, pool 4) | Secondary (5s, pool 3) | Starting Kit |
|---|---|---|---|---|---|
| Warrior | 14 | 150 | red | gray | red×2 + gray×1 |
| Wizard | 6 | 180 | blue | purple | blue×2 + purple×1 |
| Scout | 9 | 260 | orange | red | orange×2 + red×1 |
| Builder | 12 | 150 | gray | orange | gray×2 + orange×1 |
| Mender | 8 | 160 | white | black | white×2 + black×1 |
| Beastcaller | 10 | 220 | green | yellow | green×2 + yellow×1 |

**Mender design note:** Originally Mender had white signature + purple secondary. This proved to be a problem — both bricks in the kit are pure support/healing, meaning a Mender had no threat capability and never felt endangered. Swapping purple for black (pull/crush zone) gives them a control tool: they can pull goblins into a zone, damage them over time, slow them. This creates tension in combat (they have to choose between healing and threat management) while keeping white as their core healing identity. Purple becomes baseline for Mender again.

- Baseline colors: 10s refresh, pool cap 2. Not in starting kit — only enter a rumble via future fragment/fusion economy.
- **Critical clarification (learned this session):** pool caps are *ceilings*, not per-battle maxes. `brickMax per battle = min(starting kit count, pool cap)`. To exceed starting counts you find fragments on the board and fuse them, equipping more before next battle. Refreshing in combat only tops up to starting count, never higher.
- Refresh timers staggered at battle start per color (random 0–rate offset) so when you spend bricks they don't all refresh synchronously.

### Fatigue (visible, not yet scaling damage)

- Curve: `[1.0, 0.8, 0.6, 0.5, 0.4]` (floor).
- **1-brick overloads are exempt** — no fatigue cost. Only 2+ brick overloads increment counters.
- Signature/secondary overloads increment signature counter +1.
- Baseline overloads increment off-class counter +2 (hybrid penalty).
- Floating "FATIGUE X%" text shows over player on each fatiguing fire.
- Counter state exposed via `getState().fatigue` and `.overloadCount`.
- **Damage is NOT yet scaled by the multiplier.** Deferred to a tuning pass post-playtest; hooks are in place at each `fireOverload<Color>` call site.

### Display scaling

- `getDisplayScale()` returns 0.60→1.00 based on `min(W, H)`:
  - ≤400px → 0.60
  - 400–700px → 0.60→0.80 linear
  - 700–1100px → 0.80→1.00 linear
  - ≥1100px → 1.00
- `scaleDist(px)` helper multiplies by current scale.
- Applied to: `player.r` (base 22), `entity.r` (base 18), `AGGRO_RANGE` (base 200), `DEAGGRO_RANGE` (base 320), drag/tap thresholds (base 40, 20), green/purple burst radii (base 400), yellow confuse default radius (base 300), yellow aura radius (base 120), gray wall maxR (base 30+tier*22), black effect radius ranges.
- `resize()` re-applies scale to living entities on viewport change (phone rotation handled).

### Brick bar layout

- Split into two fixed-position containers: `#rumble-brick-bar-left` + `#rumble-brick-bar-right`.
- No backing card; transparent container with `pointer-events: none`, buttons opt back in. Minimal styling.
- `_distributeBricks(colors)` sorts by tier (sig→sec→base, alphabetical tiebreak) then alternates right/left starting with RIGHT. Signature goes to dominant (right) hand by default.
- Filter rule: render bricks where `brickMax > 0`. Empty-but-in-kit bricks stay visible showing their recharge bar. Colors not in kit stay hidden for full battle.
- `getArenaBounds`: panelWidth 54 per side, pad 12, topHUD 50. Rumble space gains ~28px per side + 18px top vs. pre-split layout.

### Gray armor (rebalance)

- Base: **1 armor pip per gray brick**.
  - Tap: +1 armor
  - Overload N gray: +N armor
- Comments mark `// Future "Iron Hide" skill will unlock 2-per-brick` at both hook sites. When skill system lands, multiplier attaches there.

### Yellow aura (new mechanic)

- **Tap yellow:** 3s persistent aura on player, follows as player moves. Radius ~120px (scaled). Entity on first entry gets 2.0s confuse; each frame of contact refreshes timer to 1.0s. Stay in the field → stay confused. Leave → snap out ~1s later.
- **Drag yellow to point:** unchanged — instant confuse burst at drop, ~87px radius.
- **Overload yellow:** 3s aura, radius scales `120 + 40*(count-1)`. Anchored if drag-originated, follows player if tap-originated. Duration on caught entities extends naturally via the per-frame refresh.
- Visual: soft radial glow + dashed pulsing edge ring, occasional "?" particle shimmer above caught entities.
- New state: module-level `yellowAura`. New functions: `startYellowAura`, `updateYellowAura`, `drawYellowAura`. Reset on battle start.

### Damage affinity (class-color multiplier)

Using a brick whose color matches your class identity hits harder; off-class colors hit softer. Baked into `affinityMult(color)` in `rumble.js`.

- **Signature color:** output × 1.25
- **Secondary color:** output × 1.0 (neutral)
- **Baseline color:** output × 0.8

**Full coverage:** affinity is now applied to EVERY brick's damage, heal, and effect output across all 9 colors. No brick is affinity-blind.

What affinity multiplies (per locked design):
- **Amounts** — damage dealt, healing received/given, armor pips granted
- **Durations** — confuse time, poison tick count, bleed duration, regen duration, stun time
- **Radii** — burst zones, aura sizes, trap areas, healing field size, pull zone radius

Per-color coverage:
- **Red** — charge damage
- **Blue** — tap bolt damage, overload bolt damage, overload impact burst radius + damage
- **White** — tap heal, overload direct heal, healing field radius + heal/tick, regen hp/sec + duration
- **Gray** — tap armor pips, overload armor pips, wall radius + HP
- **Green** — burst radius, poison damage multiplier
- **Purple** — burst radius, burst damage multiplier (both tap and overload paths)
- **Orange** — trap radius + damage, scatter trap radius + damage, aura charge count, bleed duration
- **Yellow** — aura radius (tap & overload), drag-burst radius, first-entry confuse duration, in-field confuse refresh duration
- **Black** — pull zone radius, effect duration, tick damage

Design intent: rewards class-thematic play. A Mender's white heal is stronger than anyone else's; a Wizard's blue lances are more precise; a Beastcaller's green poison is more potent. Off-class usage still works but is meaningfully weaker, which pushes players toward their class identity without locking them out of off-class utility.

Matrix reference (each class has exactly one signature + one secondary; all 7 other colors are baseline):

| Class | Signature (×1.25) | Secondary (×1.0) |
|---|---|---|
| Warrior | red | gray |
| Wizard | blue | purple |
| Scout | orange | red |
| Builder | gray | orange |
| Mender | white | black |
| Beastcaller | green | yellow |

### Blue overload impact burst (new mechanic)

Blue overload bolts (2+ bricks) now create an AoE burst on impact that damages nearby entities for roughly half primary damage.

- **Burst radius:** `30 + count * 15` pixels (scaled for display). At 1 brick = no burst (tap-blue path), at 3 bricks = 75px, at 10 bricks = 180px.
- **Burst damage:** `2 * count * affinityMult('blue')` (half of primary bolt damage, rounded).
- **Primary target excluded** from burst — they already took the full bolt damage.
- Tap-blue remains single-target (no `burstRadius` on that bolt).

Design intent: tap-blue = precise, overload-blue = tactical AoE. Gives blue overload a reason to exist beyond "bigger number on one target." Wizard with max-stack blue becomes a genuine crowd-damage threat.

Future: chain bolts, bouncing bolts, extended radius via skill system unlocks. Not in v1.

### White healing field (new mechanic — Mender signature identity)

White overload now branches based on target:

- **Tap or drop-on-player:** direct overload heal (current behavior preserved). Heals `(player.cls === 'mender' ? 5 : 3) * count`.
- **Drop on empty arena space or entity:** creates a static healing field.

Static healing field details:
- **Duration:** `3s * count`
- **Radius:** `scaleDist(60 + count * 20)`. At 1 brick ~60px, at 5 bricks ~160px.
- **Heal:** player inside gets `1 + count` HP per 0.5s tick. Floating text shows per-tick heal.
- **Entity soft-slow:** any entity inside has movement reduced to 50% (whiteFieldMult). Applied at all 3 speed sites: patrol, confused, and chase movement. Refreshes every frame while inside, decays when they leave.
- **Visual:** soft white radial glow, dashed pulsing edge ring, ambient sparkle shimmer inside the zone.

Design intent: Menders get a positional defensive tool. Instead of spamming heals, they can drop a healing zone and pull the team into it. Creates tactical depth — position it well, the party thrives; position it badly, it's a wasted overload. Enemies don't heal inside (we considered and rejected that), but they do move slower, creating a gentle repel effect without being overpowered like a hard push.

Implementation: module-level `whiteField` state. New functions: `startWhiteField`, `updateWhiteField`, `drawWhiteField`, `spawnHealSparkleAt`. Sparkles use a new worldspace render path in the player sparkle loop. Reset on battle start.

### Black damage display (readability fix)

Black overload effect ticks damage every 0.5s, but the floating text display is now throttled to every 1.5s, showing **accumulated damage since last display** rather than individual ticks.

- Tick damage unchanged — gameplay timing same as before.
- `entity._blackAccumDmg` accumulates per-entity between displays.
- Every 1.5s, flush the accumulator — show total as "💀 -X".
- When the effect ends, any pending accumulator flushes immediately so the player sees final total.

Problem solved: at high overload counts (5+ bricks), the per-tick display was a stream of identical small numbers that made it hard to gauge the effect's actual power. Now a 10-brick overload shows meaningful totals like "💀 -30" every 1.5s, which accurately reflects the accumulated damage from 3 ticks worth of heavy strikes.

### Entity rename (goblin → entity)

Module-wide rename of `goblin`/`Goblin` to `entity`/`Entity` across all 145+ references in `rumble.js` and corresponding identifiers in supporting files. Reserved exceptions: places that specifically refer to the GOBLIN creature as a type (monster templates, flavor text, encounter names in `game.js`, `server.js`, `players.html`, `test_players.html`). Those stay as "goblin" because they name a specific creature.

Renamed identifiers include: `updateGoblin → updateEntity`, `damageGoblin → damageEntity`, `makeGoblin → makeEntity`, `goblins → entities`, `deadGoblins → deadEntities`, etc.

Design intent: the rumble module is a generic combat arena. Eventually it will host many enemy types (goblins, brutes, scouts, shamans, etc.). Using "entity" as the internal term makes it forward-compatible. Specific creature types get named via data (`entity.type = 'goblin'`) rather than baked into function names.

### Known issues / TODO queue

**Still open:**
1. **No auto-victory/defeat resolver.** Module emits `enemyKilled` but doesn't end the rumble; only `forceEnd()` terminates. Needs a combat resolver before real game integration.
2. **Elapsed keeps ticking during pause** (cosmetic).
3. **Fatigue-to-damage tuning pass** after playtest — wire multiplier into each color's damage/effect math. Fatigue is tracked and visible but doesn't yet scale output.
4. **Yellow particle density** possibly too busy (~9/sec). Decide after visual test.
5. **Fragment drop tables + fusion minigame** — TBD. Fragments are the board-side progression path but the mechanic isn't designed yet.
6. **HP regen precise formula** — scales with battle performance, exact curve TBD.
7. **Phase 2 integration:** wire rumble.js into players.html with server-sourced state, battleTick, victory/loss resolver, loot generation.
8. **Audit remaining brick output values** against "1 brick = 1 unit; skills give multiplier" principle. Affinity now covers all 9 colors (amounts, durations, radii). Base values themselves still need a playtest pass to see if any color feels under/over-tuned.
9. **Board UI design** — brick counts on players.html board view, spend-brick action flow with target selection, stored-buffs indicator, slowdown indicator, DM "prompt brick spend" flow.
10. **Board state model** — per-tile state for orange traps, black caches, any tile-targeted effects.
11. **Skill system rebuild** — class-specific abilities like Builder drawing walls, upgrade paths for out-of-battle brick uses (Bull Rush, Field Medic, Iron Hide, etc.). Deferred entirely from v1.

**Done this session (no longer pending):**
- ✅ Out-of-battle brick uses designed (9 distinct verbs locked, per-tier debuff model locked)
- ✅ Mender starting kit rebalanced (white + black, not white + purple)
- ✅ White healing field on overload
- ✅ Yellow aura mechanic replacing instant burst on tap
- ✅ Gray armor rebalance (1 pip per brick base, 2 per brick deferred to skill unlock)
- ✅ Damage affinity multiplier (all 9 colors: amounts, durations, radii)
- ✅ Blue overload impact burst
- ✅ Black damage display readability fix (1.5s accumulation)
- ✅ Display scaling for mobile (player.r, entity.r, aggro ranges, effect radii, drag thresholds)
- ✅ Split brick bar layout (signature right, secondary left, auto-distribute)
- ✅ Goblin → entity rename (modular combat arena is now enemy-type-agnostic)
- ✅ 1-brick overloads exempt from fatigue (only 2+ consume)

### Locked design decisions

- Refresh rates: 3s/5s/10s per signature/secondary/baseline tier, staggered at start.
- Pool caps: 4/3/2 are ceilings. Battle max = min(starting kit, cap).
- Fatigue curve `[1.0, 0.8, 0.6, 0.5, 0.4]`, hybrid penalty (+1 sig / +2 off-class), 1-brick exempt.
- Starting kits: 3 bricks (2 sig + 1 sec) per class, locked per table above.
- Mender kit: white + black (NOT white + purple). Purple-purple kits produced a class with no threat capability; black gives Mender defensive control to match their support.
- Class identity: signature color refreshes fastest. Refresh tier is *latent identity* — surfaces once fragment/fusion lets you bring non-class bricks in.
- Damage affinity: signature ×1.25, secondary ×1.0, baseline ×0.8. Applied to ALL 9 brick colors (amounts, durations, radii). Rewards class-thematic spending across every output.
- Brick bar: always balanced, signature right, secondary left, alternating for extras.
- Growth path: starting kits stay static in v1; progression is entirely board-side (fragments → fusion → expanded inventory → richer kits).
- Skill system: ripped out, pending redesign. Multiplier hooks reserved at gray armor + (future) other colors.
- Arena generic-naming: internal identifiers use `entity`; specific creature types (goblin, future brute, etc.) are named via data, not function names.

---

## Out-of-Battle Brick Uses v1 (locked)

Each brick has one signature out-of-battle use. Distinct verb per color.

| Brick | Theme | Use |
|---|---|---|
| RED    | Force, physical   | Dash up to 4 spaces. Chance to break doors or reveal hidden areas. |
| GRAY   | Sturdy, solid     | +1 armor pip carried into next rumble. Max 2 carry-over. Persists until consumed. |
| GREEN  | Poison, push      | Next attack in battle poisons target for 2s. Consumed on first hit dealt. |
| YELLOW | Riddle, escape    | Start next rumble with 2x movement speed for 15s. |
| BLUE   | Ethereal, blast   | Telekinetic grab: retrieve a brick or fragment from up to 3 spaces away. |
| ORANGE | Trap, bleed       | Place a trap on a board space. Next enemy to enter takes 3 dmg + 3s stun. |
| PURPLE | Wisdom, burst     | Next single event roll auto-succeeds. If it triggers a rumble, start with max overheal. |
| WHITE  | Blessing, soothe  | Heal any party member +3 HP (self or ally), regardless of board position. |
| BLACK  | Cursed, crushing  | Reveal a hidden cache on the board. Contents random. Risk: may reveal a threat. |

### Split by timing
- **Battle-prep (stored):** gray, yellow, green, purple — spend now, effect triggers at/during next battle.
- **Board-immediate:** red, blue, orange, white, black — spend now, effect happens now on the board.

### Unresolved timing questions (defer to playtest)
1. Green/gray/yellow/purple carry window — default "persist until consumed, one buff stored per color at a time."
2. Purple "event roll" precise definition — any non-combat skill check, or if unspent when rumble begins auto-converts to overheal.
3. Black cache contents — default: fragments + small item + small chance at one intact brick. Preserves fragment economy.
4. Orange trap radius — default: within current encounter area / room.
5. Overload (2+ brick) out-of-battle uses — deferred. Test 1-brick version first, design overloads after.

### Open design threads
- **Usage flow:** who initiates? Player declares a spend, or DM calls for a roll that invites spend? Default: both paths exist.
  - Player-initiated: "I spend orange to set a trap on the doorway."
  - DM-initiated: "This door is reinforced. A red brick could force it open."
- **Overload at board:** possible power uses for 2+ (TBD)
  - 2 white = revive a downed ally
  - 2 red = break through walls, not just doors
  - 2 gray = grant carried armor to an ally
  - 2 purple = party-wide event auto-succeed
  - 2 blue = grab from 6 tiles or teleport an object
- **Cost asymmetry:** should some uses be 1-brick (common, cheap) and others 2-brick (rare, powerful)? Or should all 9 cost exactly 1, with overload 2+ for amplified version?
- **UI implications:**
  - Prep-phase screen needs "stored buffs" panel (gray pips carried, yellow speed armed, etc.)
  - Board interface needs a "spend brick" action on player turn
  - DM needs "request brick spend" prompt to trigger checks


---

## Out-of-Battle Brick Economy v1 (locked)

Out-of-battle uses consume bricks from the SAME live inventory as combat.
No separate out-of-battle pool. Spending a brick at the board means that
brick isn't in your next rumble kit.

### Shared inventory rules
- Brick count shown on both players.html (board view) and rumble.
- Spending at the board decrements the same count used at the rumble.
- Fully refreshing pools still only happens via in-rumble refresh AND/OR board events (fragments, campfires — TBD).

### Stored-for-battle uses (NO refresh debuff)
These bricks are spent now for an effect that triggers at or during next rumble.
The tradeoff IS the spent brick — no additional debuff imposed.
- GRAY: +1 armor pip carried into next rumble. This pip can exceed normal
  armor max (temp bonus pip above the cap). Consumed on first damage taken.
- GREEN: Next attack in next rumble poisons target for 2s. Consumed on first hit.
- YELLOW: Next rumble starts with 2x movement speed for 15s.
- PURPLE: Next event roll auto-succeeds. If rumble triggers before an event
  consumes it, converts to max overheal at rumble start.

### Board-immediate uses (tier-scaled refresh slowdown)

These bricks are spent now for an effect that happens on the board.
Effect on NEXT rumble (same turn) depends on the spender's class-color tier.

Tier → debuff mapping:
- **Signature color: NO debuff.** Class identity. Spend freely at the board.
- **Secondary color: +1s refresh slowdown**, plus that color is LOCKED from
  board re-spend until either recovered or next turn.
- **Baseline color: +3s refresh slowdown**, plus LOCKED from board re-spend
  until recovered or next turn.

Slowdown and lockout clear via EITHER path (whichever comes first):
1. The pips you spent refresh back to their previous count in rumble.
2. Next board turn begins (automatic reset).

| Brick | Board-immediate use |
|---|---|
| RED    | Dash 4 spaces, chance break doors |
| BLUE   | Telekinetic grab from up to 3 tiles |
| ORANGE | Place trap on board tile (3 dmg + 3s stun to next entrant) |
| WHITE  | Heal any party member +3 HP remotely |
| BLACK  | Reveal hidden cache (risk: may reveal threat) |

Design intent: players should feel encouraged to use their signature color
at the board (class identity expressed in both realms). Secondary/baseline
spending remains meaningful but lightly taxed — not enough to discourage
use, just enough to register a tradeoff.

### Balance stance (v1)
- Gray gets a "stronger than battle" boost (temp pip above max).
- Other stored-for-battle bricks ship at current values, rebalance after playtest.
- Board-immediate bricks stand on their own value; tier-scaled slowdown is the cost.
- Healers (Menders) can heal out of battle freely — white is their signature.
- Similarly, Builders can fortify with gray, Scouts can trap with orange, etc.

### Upgrades via skill system (deferred)
Many out-of-battle uses are natural upgrade targets once the skill system
is rebuilt. Examples for future:
- Red "Bull Rush": dash 6 spaces, guaranteed door break
- White "Field Medic": +5 HP instead of +3
- Gray "Reinforced": +2 temp pips instead of +1
- Black "Cartographer": cache reveal never triggers threat
No upgrades in v1. Skill system is a separate project.

### UI implications (deferred)
- Brick count must be visible on players.html (board view), not just rumble.
- Prep-phase display needs "stored buffs" indicator (gray pips banked, green
  poison armed, yellow speed ready, purple insurance pending).
- Board-turn interface needs a "spend brick" action flow with target
  selection (tile for orange/black, ally for white, object for blue).
- DM interface needs "prompt brick spend" flow (narrate obstacle, invite
  specific color or player).
- Slowdown status needs visible indicator on rumble brick bar (e.g., thicker
  border or clock icon on affected color) so players can see they're debuffed.
- Bricks under lockout should show a visual block on the board-spend UI
  (greyed out or "locked" icon) so players know they can't re-spend.

