# BrickQuest — Project Notes

## Versioning & Commit Conventions (as of 0.14.0)

The game has THREE related but distinct numbering systems that have drifted before. This section is the authority.

**Build numbers** come from `DESIGN_S012_PROPOSAL_V2.txt` §8 roadmap:
- 0.12.0 "Foundations" — shipped
- 0.13.0 "Charge Visible" — shipped (+ extensive 0.13.x polish arc)
- 0.14.0 "Action Hub" — in progress
- 0.15.0 "Class Identity: Rumble"
- 0.16.0 "Class Identity: Board"
- 0.17.0 "Cheese System"
- 0.18.0 "Achievements & Unlocks"
- 0.19.0 "Multiplayer Proximity Join"
- 0.20.0 "Entity Overload"
- 0.21.0+ "Rares, Polish, Ship"

**Session codes** (S011, S012, S013, ...) are the design/development session labels. They live ONLY in the design doc header and in `/mnt/transcripts/journal.txt`. They do NOT go into commit messages or package.json — this has caused confusion before.

**package.json version** reflects the current in-flight build. Bump rules:
- `./save.sh -v "msg"` — patch bump (0.14.0 → 0.14.1) for incremental commits inside a build
- `./save.sh -V "msg"` — minor bump (0.14.x → 0.15.0) when starting a new build milestone
- Plain `./save.sh "msg"` — no version bump (rare, for docs/notes-only commits)

**Commit message format**: save.sh auto-prepends `v<version>: ` to whatever message is passed. So the message itself should NOT include the version. Use this plain-English format:

```
./save.sh -v "item 2/7 — strip Enhanced Movement"
```

Produces:
```
v0.14.1: item 2/7 — strip Enhanced Movement
```

For work inside a specific build's roadmap (like 0.14.0's 7 sub-items), include `item N/M — <description>`. For polish/bugfixes outside a feature build's scope, just describe what changed.

When a build is complete (all items shipped, exit criteria met), the NEXT commit uses `-V` to bump minor and open the next build.

**The old "s012" / "s013" session prefixes in commit messages are deprecated.** They conflicted with version numbers visually and weren't what the roadmap or save.sh expected. Use clean build-item format going forward.

---

## Debugging Protocol (standing practice)

**For any non-trivial bug, the first patch is a diagnostic, not a fix.**

Diagnostics reduce uncertainty. Speculative fixes don't. Guessing at fixes without ground truth produces guess-iterate-reload loops that burn hours to find something a 5-minute diagnostic would have surfaced immediately.

### The rule

When a bug is reported:
1. **First response is a question in two parts:** (a) best guess at the bug category (rendering / state / timing / data / integration), (b) a diagnostic patch that will print or display what is actually happening at the suspected failure point.
2. **Ship the diagnostic, not the fix.** User runs it, reports the output.
3. **Fix is then targeted and informed** by the diagnostic's actual data, not by speculation about what might be wrong.

### Exception — skip the diagnostic when

The bug is screamingly obvious from the symptom alone:
- Typo in a variable name surfaced in a stack trace
- `undefined is not a function` pointing at a specific line
- Missing closing brace causing a syntax error
- User pastes the exact error message and the cause is unambiguous

When in doubt, ship the diagnostic first. The cost of a diagnostic that wasn't needed is one extra reload. The cost of skipping a diagnostic that was needed is ten iterations of guessing.

### Diagnostic patterns that work in this codebase

- **On-screen debug overlays** (the victory 🔍 button is the template — colored element outlines + readout panel of computed styles/dimensions/state). Tap to toggle. Reusable across any DOM layout issue.
- **Console dumps with console.table** for any data structure under suspicion (RIDDLES pool, player state, activeEvent). Dump the whole object; don't pre-filter because you might filter out the wrong field.
- **State snapshot buttons** — a hidden admin button that exports current game state as JSON for copy-paste inspection.
- **Inline assertions** that throw descriptive errors when an invariant breaks mid-flow. Throw early, throw loud; the stack trace tells you where.
- **Temporary log spam** around a suspected code path, removed once the bug is located.

### Historical example (why this rule exists)

**April 2026 victory-layout bug (~15 wasted iterations):** User reported landscape mobile victory cards looked wrong. Claude iterated on CSS values — `max-width`, `fit-content`, media query thresholds, `vmin` vs `vw` — shipping each guess and asking for a screenshot. Nothing worked. Fifteen patches in, user suggested a debug overlay. First debug output showed `.bq-vic-card` rendering `display:block width:269px` when CSS specified `display:flex width:480px`. That single discrepancy led directly to the root cause: JavaScript `/* comments */` inside string concatenation were evaluating to `NaN` via unary plus coercion, corrupting the rendered CSS and invalidating entire rule blocks. Five minutes of diagnostic work replaced fifteen iterations of guesswork. This is the default failure mode when diagnostics are skipped. Don't repeat it.

### The meta-principle

Debugging is NOT the same as writing new code. Writing new code: you know the goal, plan a path, execute, check. Debugging: you don't know what's wrong, so any "plan a path" is a guess and "execute" is speculation. The right shape of debugging is **reduce uncertainty first, act second.** Every guess-and-check iteration that doesn't reduce uncertainty is wasted motion.

---

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
- Player enters with their current inventory of bricks
- Starting kit is 3 bricks (2 signature + 1 secondary); inventory grows via progression
- Bricks refresh CONTINUOUSLY during battle at per-class per-color rate
- Signature colors refresh fast, baseline colors refresh slowly
- Overload (holding a brick) burns multiple bricks at once, with fatigue curve
- Inventory IS the rumble pool. No separate cap. Own 5 blues → have 5 blues available (minus whatever is currently refreshing)
- When battle ends, spent bricks all refresh for next battle (inventory is persistent)

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

| Class | HP | Speed | Signature (3s refresh) | Secondary (5s refresh) | Starting kit |
|---|---|---|---|---|---|
| Warrior | 14 | 150 | red | gray | red×2, gray×1 |
| Wizard | 6 | 180 | blue | purple | blue×2, purple×1 |
| Scout | 9 | 260 | orange | red | orange×2, red×1 |
| Builder | 12 | 150 | gray | orange | gray×2, orange×1 |
| Mender | 8 | 160 | white | black | white×2, black×1 |
| Beastcaller | 10 | 220 | green | yellow | green×2, yellow×1 |

All non-signature, non-secondary colors are **baseline** (10s refresh).

### Brick refresh mechanics (rumble only)

| Tier | Refresh rate |
|---|---|
| Signature (1 color per class) | 3s per brick |
| Secondary (1 color per class) | 5s per brick |
| Baseline (7 colors per class) | 10s per brick |

Refresh ticks continuously. Each brick refreshes back to available once its timer elapses. Available count tops out at inventory count — you can't have more bricks in a rumble than you own.

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
- Reduce refresh time on secondary color
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

| Class | HP | Speed | Signature (3s refresh) | Secondary (5s refresh) | Starting Kit |
|---|---|---|---|---|---|
| Warrior | 14 | 150 | red | gray | red×2 + gray×1 |
| Wizard | 6 | 180 | blue | purple | blue×2 + purple×1 |
| Scout | 9 | 260 | orange | red | orange×2 + red×1 |
| Builder | 12 | 150 | gray | orange | gray×2 + orange×1 |
| Mender | 8 | 160 | white | black | white×2 + black×1 |
| Beastcaller | 10 | 220 | green | yellow | green×2 + yellow×1 |

**Mender design note:** Originally Mender had white signature + purple secondary. This proved to be a problem — both bricks in the kit are pure support/healing, meaning a Mender had no threat capability and never felt endangered. Swapping purple for black (pull/crush zone) gives them a control tool: they can pull goblins into a zone, damage them over time, slow them. This creates tension in combat (they have to choose between healing and threat management) while keeping white as their core healing identity. Purple becomes baseline for Mender again.

- Baseline colors: 10s refresh. Not in starting kit — only enter a rumble via future fragment/fusion economy.
- **Inventory IS the rumble pool.** No separate pool cap. If you own N blues, you can fire up to N blues in a battle before needing to wait for refresh. Growth via fragments/fusion directly increases rumble capability.
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

### Overload stack bonus (locked)

Overloading adds a per-brick power bonus on top of linear count scaling. The more bricks you commit to one cast, the more powerful each individual brick becomes. This addresses the v1 problem where 2-brick overload equaled 2 taps mathematically — making overload feel identical to split-firing, which defeats the purpose of holding/committing.

Formula:
```
overloadStackMult(count) = 1 + (count - 1) * 0.2
final_output = base × count × overloadStackMult(count) × affinityMult(color)
```

Scale table (per-brick multiplier at different counts):
- count=1 (tap): 1.0× (no bonus — this is the baseline)
- count=2: 1.2× per brick (output = base × 2 × 1.2)
- count=3: 1.4× per brick
- count=4: 1.6× per brick
- count=5: 1.8× per brick
- count=10: 2.8× per brick

**Unbounded by design.** No diminishing returns curve, no hard cap. Monster difficulty scales to match player progression — tougher monsters will justify bigger numbers. A 10-brick overload should feel like a god-tier nuke, and that's the point.

Applied to ALL 9 brick colors (damage, heal, duration, radius, charge count — whatever output the color produces).

Concrete impact — Wizard blue overload damage before vs after:

| Count | Before (4 × count × 1.25) | After (× stack mult) |
|-------|---|---|
| 1 (tap) | 5 | 5 (unchanged) |
| 2 | 10 | 12 |
| 3 | 15 | 21 |
| 5 | 25 | 45 |
| 10 | 50 | 140 |

Design intent: make the choice to HOLD and commit bricks meaningful. Previously a 2-brick overload was identical to two taps except for timing/fatigue downsides, which is backwards incentive. Now committing to overload is mathematically rewarded proportional to commitment.

### Inventory as rumble pool (locked)

Previously there was a concept of "pool caps" (signature=4, secondary=3, baseline=2) that clamped how many bricks of each color a player could bring into rumble. This concept has been **removed entirely**. Inventory IS the rumble pool.

- Own N bricks of a color → have N available in rumble (minus currently-refreshing).
- No artificial ceiling. Earning bricks through progression (fragments → fusion → inventory) directly increases rumble capability.
- Refresh rates still tier by class (3s signature / 5s secondary / 10s baseline) — but refresh tops back up to inventory count, not to some separate cap.

Design intent: progression feels like permanent power growth. A Wizard who fuses 2 more blue bricks into their inventory now has 4 blue available in EVERY future rumble until they lose or spend them. No artificial invisible ceiling capping the benefit.

Implementation: `BRICK_ECONOMY.poolCaps` removed from code. Spec-mode `_internalStart` no longer clamps brickMax via `Math.min(startQty, caps[tier])` — it just uses `startQty` directly.

Update bookkeeping: overload stack bonus + uncapped inventory together mean a Wizard could theoretically commit 10 bricks to a single blue overload. Fatigue system is already safe (5-entry curve uses last value as floor for indices ≥ 5). Monster difficulty will scale with progression to justify these numbers.

### Tap inventory scaling (locked)

The BASE value of every brick's output scales with bricks OWNED beyond the starting kit. Permanent progression — earning a brick makes every use of that color stronger forever.

Formula:
```
tapScaleMult(color) = 1 + 0.10 × max(0, owned - startingCount)
scaledBase = originalBase × tapScaleMult(color)
```

Where `owned` comes from the player's brickMax (equals current inventory in spec mode), and `startingCount` comes from the locked starting kit (e.g., 2 for Wizard blue, 1 for Wizard purple).

**Applies to both tap AND overload.** Overload math multiplies off the scaled base, so they compound naturally:
```
tap damage   = scaledBase × affinityMult(color)
overload dmg = scaledBase × count × overloadStackMult(count) × affinityMult(color)
```

Example — Wizard blue progression (base=4, starting kit=2):

| Owned | tapScaleMult | Tap damage (×1.25 sig aff) | 3-brick overload |
|-------|--------------|---------------------------|-------------------|
| 2 (start) | 1.0 | 5 | 21 |
| 3 | 1.1 | 6 | 23 |
| 5 | 1.3 | 7 | 27 |
| 10 | 1.8 | 9 | 38 |
| 20 | 2.8 | 14 | 59 |
| 50 | 5.8 | 29 | 122 |

Uncapped by design — consistent with the "monster difficulty scales, don't cap player power" philosophy. A player with 50 owned bricks of their signature color is endgame-strong and will face endgame monsters.

Applied to all 9 colors (damage, heal, armor pips, burst radii, effect durations, trap radii, charge counts — every output).

### Crit roll system (fully implemented)

Every cast (tap OR overload) rolls for a critical. On success, a color-specific **threshold effect** fires AND the full visual signature triggers (screen flash, banner, haptic, per-color flourish).

Formula:
```
critChance(color, count) = 0.10 + 0.08 × max(0, count - 1) + affinityBonus
```

Where:
- Tap count = 1
- Overload count = bricks committed (2+)
- **affinityBonus:** signature +5%, secondary 0%, baseline -3%
- Clamped to [0, 0.99] — always some chance to fail

Example rates for a Wizard:

| Cast | Count | Base | Sig bonus | Final |
|------|-------|------|-----------|-------|
| Tap blue (sig) | 1 | 10% | +5% | **15%** |
| Tap purple (sec) | 1 | 10% | 0% | 10% |
| Tap red (baseline) | 1 | 10% | -3% | 7% |
| 3-brick blue overload | 3 | 26% | +5% | **31%** |
| 5-brick blue overload | 5 | 42% | +5% | **47%** |
| 5-brick red overload (off-class) | 5 | 42% | -3% | 39% |
| 10-brick blue overload | 10 | 82% | +5% | **87%** |

Design intent:
- Taps get occasional crit excitement (~7-15% depending on class match) — rare enough to feel special
- Overloads scale up — committing more bricks means more likely to see the threshold fire
- Class affinity rewards playing your colors (signature) and gently punishes off-class
- Never guaranteed (99% ceiling) — the 1% miss keeps the moment honest

Implementation:
- `critChance(color, count)` + `rollCrit(color, count)` helpers
- Roll fires at central dispatch: `fireOverload` (overloads) and `useBrickAction` (taps)
- Global `_currentCrit` flag set per cast, reset at battle start
- Async effects (red charge, blue bolt, bursts) store `isCrit` on their struct to survive until impact
- On successful roll, `triggerCritSignature(color, x, y)` fires the universal visual package

### 9 threshold effects (all implemented)

Each crit fires a color-specific threshold on top of normal damage/effect. All 9 are designed to work against single enemies AND groups — no dead crits.

| Color | Name | Mechanic | Implementation site |
|---|---|---|---|
| RED | CRUSHING BLOW | 2× damage + 2× knockback | charge impact in updateBrickAction |
| BLUE | MARK | Target takes +50% dmg from ALL sources for 3s | bolt impact; `g.markedTimer` read in `damageEntity` |
| WHITE | BLESSING | Self-heal: purge debuff hook (no player debuffs yet in v1) / Field: first tick heals 2× | doWhiteHeal + updateWhiteField |
| GRAY | REINFORCE | Armor pips 2× / Wall HP 2× | startGrayArmor, fireOverloadGray, startGrayWall |
| GREEN | NECROSIS | Poison never decays (permanent until cleansed/killed) | greenBurst._necrosis flag → entity._poisonNoDecay → updateEntityPoison |
| ORANGE | SHRAPNEL | Trap detonates AoE (1.8× radius) on trigger | spawnSpikeTrap sealed + unsealed trigger |
| YELLOW | DAZE | Confused entities take 2× damage from all sources | aura/burst sets `g.dazed`, read in `damageEntity` alongside confuseTimer |
| PURPLE | SILENCE | Disables enemy attacks for 2s | purple burst impact sets `g.silencedTimer`; attack gate in updateEntity respects it |
| BLACK (overload zone) | SINGULARITY | Pull 2× speed + tick damage 2× | isCrit stored on blackEffect; updateBlackEffect reads it |
| BLACK (tap witherbolt) | DEEP WITHER | Applies 2 wither stacks instead of 1 | witherBolt.stacksApplied=2 when isCrit |

Amp flags (`markedTimer`, `dazed`, `poisonNoDecay`, `silencedTimer`) decay per-frame in updateEntity. Dazed clears when confuse expires. Marked/Silenced decay on their own timers.

### WITHERBOLT — Mender black tap identity (fully implemented)

Black TAP replaced a generic zone-pull with a distinct ranged damage tool. Black OVERLOAD still uses the zone mechanic. This split is intentional: overload is commitment-heavy area denial; tap is Mender's signature "chip and amp" ranged offense.

Mechanics:
- Medium-range slow bolt (260 px/s vs blue's 500 px/s — preserves "slow application" identity)
- Auto-targets nearest entity. If dragged, targets nearest entity to drag coords.
- Wobbles sinusoidally in flight — sinister curved path
- Base damage: 2 × tap × affinity (Mender black aff = 1.0 secondary)
- Applies 1 **WITHER stack** on hit (2 on DEEP WITHER crit)
- Refund brick if no target present

Wither stack mechanics:
- **No hard cap on stacks** — scaling handles balance
- **Shared timer:** each new witherbolt refreshes full 5s duration. Don't cast for 5s → all stacks drop.
- Stacks + timer displayed on entity body (`✦ W x3 4s`) + subtle dark stain overlay (stain opacity scales with stack count, caps at 45% alpha)

Witherbolt-specific self-scaling (back-to-back hits snowball):
```
scale(stacks) = 1.5^stacks
```
| Existing stacks | Next witherbolt damage (base 2) |
|---|---|
| 0 | 2 |
| 1 | 3 |
| 2 | 5 |
| 3 | 7 |
| 4 | 11 |
| 5 | 16 |
| 6 | 23 |

Other-source amplification (red/blue/orange/etc. against withered target):
```
amp(stacks) = 1 + 0.6 × (1 - 0.75^stacks)   — asymptotic to +60%
```
| Stacks | Amp |
|---|---|
| 0 | 1.00× |
| 1 | 1.15× |
| 2 | 1.26× |
| 3 | 1.35× |
| 5 | 1.46× |
| 10 | 1.57× |

Design intent:
- Mender builds a target's "wither" via repeated witherbolts, snowballing direct damage
- Other party members' damage also benefits from the wither amp, making Mender a team buff — "I make everyone's damage hurt more"
- Soft cap on amp (~+60%) prevents runaway; steep witherbolt self-scaling rewards committed focus fire
- Refund-if-no-target makes the tap low-risk to experiment with

Implementation:
- State: `witherBolts[]` array + per-entity `witherStacks`, `witherTimer`
- Helpers: `witherSelfScale(stacks)`, `witherOtherAmp(stacks)`, `decayWither(g, dt)`
- `startWitherbolt(ox, oy)` returns `false` if no target → caller refunds brick
- `damageEntity` applies wither amp for non-witherbolt sources via `_witherboltDamage` flag
- Visuals: 3-layer bolt draw (outer glow + dark core + light highlight), sinusoidal trail particles
- Updated CRIT_FLAVOR: black = ['DEEP WITHER!', 'CURSED!', 'DECAY UNLEASHED!', 'THE ROT SPREADS!']

Orphaned: old `startBlackEffect` function is no longer called from any tap path (overload still uses fireOverloadBlack directly). Left in place in case we need it later.

### Crit visual signature (fully implemented)

Universal (fires for every crit):
- **Screen flash** — color-tinted overlay tinted to the brick color, 180ms fade
- **Banner text** — 26px bold Cinzel, color-matched glow, black stroke, gentle upward drift, 1.4s duration. Picks randomly from 4 flavor lines per color ("CRUSHING BLOW!" / "SHATTERING IMPACT!" / "BONE-BREAKER!" / "DEVASTATION!" etc.)
- **Haptic ping** — `navigator.vibrate(30)` on mobile; silent no-op on desktop
- **Triggered from** central dispatch via `triggerCritSignature(color, x, y)`

Per-color flourish (layered on top of universal):
- **Shockwave ring** — expanding color-tinted ring via `spawnCritShockwave(x, y, color, opts)`. Configurable start radius, max radius, thickness, growth speed, fade rate.
- **Particle burst** — dense radial particles via `spawnCritFlourish(x, y, color, n)` using the existing purpleParticles buffer.

Per-color palette choices:
- **RED** — orange shockwave + red inner ring + gold particle storm
- **BLUE** — cyan shockwave + pastel blue halo burst
- **WHITE** — radiant white shockwave + pink-tinted sparkles
- **GRAY** — silver shockwave + silver particle burst
- **GREEN** — toxic green shockwave + virulent spore burst (two-shade)
- **ORANGE** — trap-colored shockwave + firework-style particle explosion
- **YELLOW** — electric yellow shockwave + static spark burst
- **PURPLE** — arcane violet shockwave + wisp burst (deep violet + light violet)
- **BLACK** — dark-violet shockwave + void particle burst (two-shade)

Reset on battle start: `critFlash = null; critBanners = []; critShockwaves = [];`

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

### Enemy ideas (sketchbook)

Ideas for future enemy types. None implemented yet. When we build the template-driven spawner, these become the first roster to wire in.

**Blight Worm** (family: Malady? — resistance profile TBD)
- Starts as one large worm: slow move speed, hits hard, moderate HP
- **Split-on-death mechanic:** every time a worm dies, it spawns 2 child worms at the death location
  - Child worms are **half size, half HP, double speed, half damage**
  - Children can themselves split on death following the same rule (size/HP halve again, speed doubles again, damage halves again)
- The 2× multiplier means a single parent produces 2 children → 4 grandchildren → 8 great-grandchildren if left unchecked — exponential swarm
- Design tension: killing it feels bad (swarm grows) but ignoring it is worse (it keeps hitting)
- **Counter strategies (design intent):**
  - AoE damage (green poison zone, orange trap detonation, purple burst) — clear multiple children in one hit
  - White healing field — weather the swarm
  - Yellow daze — freeze a whole generation
  - Black wither — stack it so the children die faster than they can split again (since stacks persist on death... or do they? design question: does wither stack transfer to spawned children?)
- **Open design questions:**
  - Resistance profile? Pure Malady family (naturally plague-adjacent) or split across families?
  - Does the split count scale with zone/difficulty (3× at higher tiers)?
  - Is there a minimum-size cap where smallest worms stop splitting, or does it go infinite until the smallest becomes 1-HP crumbs?
  - Do children inherit parent state (wither stacks, poison stacks, daze, silence)?
  - Does each split have a brief "birth" animation where children are invulnerable for 0.5s? Prevents AoE instantly killing the split.
  - Visual: single large segmented worm body → splits into two smaller worms writhing outward?

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
- ✅ Overload stack bonus (Option E: +20% per stacked brick, all 9 colors, unbounded)
- ✅ Pool caps stripped from code (inventory = rumble pool)
- ✅ Tap inventory scaling (+10% base per owned brick past starting, uncapped, all 9 colors)
- ✅ Crit roll system (mechanics + full implementation, tap + overload paths)
- ✅ 9 threshold effects implemented (crushing blow, mark, blessing, reinforce, necrosis, shrapnel, daze, silence, singularity)
- ✅ Crit visual signature (screen flash, banner with flavor text rotation, haptic)
- ✅ 9 per-color visual flourishes (shockwave + particle burst per color)
- ✅ Rumble test selection screen: side-by-side layout for mobile

### Locked design decisions

- Refresh rates: 3s/5s/10s per signature/secondary/baseline tier, staggered at start.
- Inventory IS the rumble pool. No artificial ceiling. Own N bricks of a color → can fire up to N of them per battle (between refreshes). Progression directly scales rumble capability.
- Tap inventory scaling: +10% base output per brick owned beyond starting kit. Uncapped. Applied to BOTH tap and overload (overload scales off the scaled base).
- Crit roll: 10% + 8% per overload brick, signature +5% / baseline -3%. Every cast rolls. Crits fire color-specific threshold effects.
- Fatigue curve `[1.0, 0.8, 0.6, 0.5, 0.4]`, hybrid penalty (+1 sig / +2 off-class), 1-brick exempt.
- Starting kits: 3 bricks (2 sig + 1 sec) per class, locked per table above.
- Mender kit: white + black (NOT white + purple). Purple-purple kits produced a class with no threat capability; black gives Mender defensive control to match their support.
- Class identity: signature color refreshes fastest. Refresh tier is *latent identity* — surfaces once fragment/fusion lets you bring non-class bricks in.
- Damage affinity: signature ×1.25, secondary ×1.0, baseline ×0.8. Applied to ALL 9 brick colors (amounts, durations, radii). Rewards class-thematic spending across every output.
- Brick bar: always balanced, signature right, secondary left, alternating for extras.
- Growth path: starting kits stay static in v1 (3 bricks). Progression is entirely board-side (fragments → fusion → expanded inventory). Earning more bricks permanently increases rumble capability since inventory = pool.
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


---

## FUSION / SKILL SYSTEM (redesign — replaces prior fragments→studs concept)

### Core pivot
The old fusion concept (fragments melt into studs, studs are currency) is
**deprecated**. Replaced by direct-brick collection + physical-build skill
assignment. The LEGO metaphor becomes load-bearing: your character's skills
are **literally what you have built**.

### Collection layer
- **No fragments. No studs.** Every found object is a brick (colored).
- Pickups add directly to the player's total brick inventory by color.
- Brick inventory is persistent across battles (or per session — TBD based
  on game loop design later).

### Skill-unlock layer
- To unlock a skill, the player arranges bricks into a **specific shape**.
- Match is **exact footprint + exact color placement** (brick-by-brick
  identical). No "any color in slot X" flex — the pattern IS the signature.
- Single-color shapes yield color-aligned skills (e.g. an all-red pattern
  might unlock a red-family skill).
- Multi-color shapes combine color affinities and unlock hybrid skills
  (e.g. red+orange = physical-family combo; red+green = toxic-strike).

### Capacity
- **Inventory of bricks** = how many shapes the player can have built
  simultaneously = how many skills they can have active.
- Bricks committed to a built shape are **locked** to that shape while
  the skill is assigned.
- Rearrangement is free: the player can tear down and rebuild in new
  configurations to swap their active skill loadout.

### Disassembly rule (HYBRID model)
- Discovering a skill-shape is permanent. Once built, it appears in the
  player's **recipe book** for reference and re-assembly.
- Disassembly **unequips** the skill (active → inactive).
- To use an unlocked skill again, the player must **rebuild** its shape
  from their current brick inventory.
- Recipe book shows: shape preview, color layout, skill description,
  required brick count per color.
- Implication: if a player's brick inventory lacks the colors/count needed
  to reassemble a known skill, that skill is still "discovered" but
  inaccessible until they find more bricks.

### Assembly interface
- Fusion/Build is a page accessible from **players.html** at any time
  **out of battle**.
- Tapping Fusion/Build opens an assembly grid.
- Grid: empty cells, player drags bricks from their inventory into cells.
- Colors shown on each brick match the color system (red/orange/gray/blue/
  purple/white/yellow/green/black).
- Each placed arrangement is checked against the skill-recipe library.
- Match found → skill unlocked + assigned, entry added to recipe book.
- No match → player sees "unknown arrangement" and can continue experimenting
  or tear down.
- Combat-phase lock: Fusion/Build is inaccessible during active battle so
  players can't rearrange skills mid-fight. Battle-start takes a snapshot
  of the current skill loadout.

### Recipe book
- Separate page on players.html, accessible anytime.
- Lists every skill the player has ever discovered.
- Each entry shows: skill name, effect description, exact shape + color
  recipe, "currently built" status indicator.
- Recipe entries are the lookup reference — players can study their book
  to plan what to build next.
- Future: recipe book could have a "research" mode where players study a
  partial recipe (found in-world, dropped by bosses, etc.) and need to
  complete the shape to unlock the skill. Not v1.

### Implementation threads (future sessions)
- **Shape canonicalization**: need a hash function that converts a grid
  arrangement + color map into a unique identifier. Exact footprint means
  rotational/reflective duplicates are DISTINCT shapes (turning a pattern
  90° creates a new recipe unless we decide otherwise — might want to
  make rotations equivalent).
- **Recipe library**: data structure mapping canonical shape-hashes to
  skill definitions. Starts small; grows per-skill as skills are designed.
- **Inventory persistence**: brick counts need server-side storage so the
  loadout survives session boundaries.
- **Assembly grid UI**: drag-and-drop on players.html with touch support.
- **Battle-start snapshot**: when battle begins, the current set of built
  shapes freezes as the active skill loadout.
- **Visual signature**: could render the player's avatar wearing /
  showing their active-brick arrangement (long-term polish, not v1).

### Design questions still open
- **Shape rotation**: are rotational/reflective duplicates the same recipe
  (symmetric) or different (strict)?
- **Brick unit**: is a "brick" always a 1x1 cell, or are there 2x1 / 2x2
  multi-cell bricks that snap into the grid like real LEGO?
- **Skill complexity curve**: how many bricks for a starter skill (2-3?),
  and how many for an endgame skill (10-20+?). Drives inventory pacing.
- **Color rules**: are some shape-color combos "forbidden" (impossible
  recipes), or is every combination either a discovered skill, undiscovered
  skill, or just an invalid arrangement?
- **Skill families**: does a shape's dominant color family determine the
  skill's damage family (physical/ethereal/malady)? Or is it shape-first,
  color-flavor-second?
- **Transferability**: can a player share a recipe with another player
  (co-op / teaching)? Or is discovery strictly individual?


---

## RUMBLE ↔ BOARD INTEGRATION (open threads)

The rumble combat runtime (`rumble.js`) and the board game state (`server.js`
+ `game.js` + `players.html`) are currently two mostly-disconnected systems.
The server-side has scaffolding for battle lifecycle (`pendingArenaBattle`
→ `arenaBattle` → resolved), but rumble doesn't actually speak to it. This
section catalogs the gaps in priority order.

### Priority tiers
- **[BLOCKER]** — rumble can't be tied to the board without this
- **[CORE]** — needed for minimum viable end-to-end loop
- **[POLISH]** — quality-of-life or late-game scope
- **[DEFERRED]** — known open question, not v1

### 1. Socket wire between rumble and server  [BLOCKER]
Currently rumble is a self-contained sandbox. Needs:
- Socket/WebSocket client attaching to the same server `players.html` uses
- Handshake on load: identify as `cls` (class) + battle session id
- Subscribe to battle state updates (paused/reset/quit from DM)
- Publish `battleTick` at ~10 Hz with `{playerHp, playerArmor, playerBricks, enemyHp, elapsedMs, logEntries}`
- Server already has the receive handler — this is all client-side plumbing

### 2. Battle-end detection and resolver  [BLOCKER]
Rumble's current `triggerVictory` is a sandbox auto-respawn loop. Needs real
battle-end logic:
- Distinguish "all enemies dead" (victor) from "player dead" (defeat) from "timeout"
- Emit `battleEnd` message: `{cls, victor, finalHp, finalArmor, finalBricks, reason}`
- Reason strings: `'victory' | 'player_killed' | 'timeout' | 'fled' | 'dm_force_quit'`
- Server handler exists (see server.js:575), receives and resolves cleanly

### 3. Battle-start payload: server → rumble  [BLOCKER]
When server spins up an `arenaBattle`, rumble needs to initialize from it:
- Read `cls`, `enemyType`, `playerArena.hp/hpMax/armor/bricks` from server state
- Map `enemyType` string to a rumble-side entity template (see thread 4)
- Rumble's current `start(config)` mostly has the right shape; wire the config
  from server state instead of hardcoded defaults

### 4. Enemy template library  [BLOCKER]
Rumble has ONE enemy type (`makeEntity`: 50 HP, 165 speed, generic chase).
Game design calls for: goblin, skeleton, slinger, shadow_wolf, creeping_vines,
stone_troll, cursed_knight, void_wraith, stone_colossus, blight_worm. Need:
- Registry (rumble-side) keyed by enemy type name
- Per-enemy: hp, hpMax, speed, r, resistances, ai-behavior, attack pattern, visual tint/icon
- AI variants — not all chase-and-melee:
  - `slinger` → kites player, ranged attack
  - `creeping_vines` → stationary, area-denial root attack
  - `stone_colossus` → slow but heavy melee, telegraphed attacks
  - `void_wraith` → teleport, phase-through walls
  - `blight_worm` (boss) → multi-phase, burrowing
- Attack patterns: currently entity does touch-damage bounce. Need telegraphed
  swings, projectiles, aoe pulses, summons.

### 5. Loot → brick award on kill  [CORE]
Kills currently drop nothing. Economy expects bricks:
- Per-enemy loot tables (e.g. goblin: `{green: 1}` guaranteed, `{red: 1}` 30%)
- Visual: brick tokens spawn at death point, player walks over to collect
  (or auto-collect on kill for v1 simplicity)
- Collected bricks add to rumble's `player.bricks[color]` and propagate to
  the server via `battleTick` so the board-side inventory stays synced
- Future: multi-brick drops for bosses, rare-color drops from named enemies

### 6. DM control honoring  [CORE]
Server has `battlePause`, `battleForceReset`, `battleForceQuit` endpoints.
Rumble needs to listen and respond:
- `paused` state from server → rumble halts tick loop, shows "paused" overlay
- Force-reset → rumble snapshots fresh state (player/enemy HP reset, bricks
  restored to pre-battle snapshot that server provides)
- Force-quit → rumble tears down and emits navigation event to return to board

### 7. HP / armor / brick reconciliation  [CORE]
Currently rumble ships whatever its local `player` thinks at `battleEnd`.
Needs policy:
- Server trusts rumble wholesale for v1 (simplest), add reconciliation later
- Pre-battle snapshot + delta model: server knows starting bricks, rumble
  reports what was spent / gained, server computes final state
- Disconnect handling: if socket drops mid-battle, server force-quits after
  15s timeout; any unsaved brick gains are lost (penalty for disconnect)

### 8. Post-battle UX  [CORE]
When `battleEnd` fires, what does the player see?
- Rumble exit screen: damage dealt, damage taken, crits landed, bricks
  gained, battle duration, victor/defeat banner
- Transition animation back to board view (fade out rumble, fade in board)
- Death handling: if player HP hit 0, are they permanently dead (`p.alive = false`
  on server) or do they limp back at 1 HP? Probably "KO at 1 HP" for MVP;
  permadeath as optional hardcore mode later.

### 9. Multi-player arenas  [DEFERRED]
Current server `arenaBattle` is single-`cls`. Design could support party combat:
- Option A: everyone fights separately in their own rumble instance, stats
  aggregate at board. Simpler; what server already supports.
- Option B: shared arena with all heroes visible, friendly-fire off, shared
  enemy pool. Much more complex — need position sync, shared timer, revive
  mechanics.
- Defer until single-player loop is polished.

### 10. Board state → arena flavor  [POLISH]
Arena should reflect the board-space the battle was triggered from:
- Forest tile → more green bricks drop, grass-themed background
- Cave tile → darkness biome (reduced visibility, black damage amplified)
- Prep-phase buffs carry into rumble: gray shields as starting armor, green
  poison pre-armed, yellow speed buff as first-30s haste, etc.
- Board clocks tick during rumble (status effects on tile decay while in arena)

### Sequencing suggestion
Recommended build order to avoid getting stuck:
1. Socket wire (thread 1) — prerequisite for everything else
2. Battle-start payload (thread 3) — rumble can now INITIALIZE from server
3. Battle-end resolver (thread 2) — rumble can now TERMINATE to server
4. DM control honoring (thread 6) — battle is controllable
5. Loot drops (thread 5) — economy comes alive
6. Enemy templates (thread 4) — content expands
7. Reconciliation policy (thread 7) — trust model settled
8. Post-battle UX (thread 8) — loop feels complete
9. Multi-player and board-flavor (threads 9, 10) — polish

After step 4 you have a working end-to-end loop with a single enemy type. After
step 6 the combat has real variety. After step 8 it feels like a game.


---

## Board Events v4 — Complete (April 21, 2026)

Design + implementation spanning ~8 sessions. Full v4 spec at
`design/board_events_proposal_v4.txt` (900 lines, 9 locked decisions).

### Shipped event types (all working end-to-end)

**New v4 minigames + cards:**
- **GREEN Vine Path** — 3-vine SVG trace with ±14px tolerance, 25s timer,
  stray-flash retry, Wild One 1s hold-to-tame (0.5 credit). Rewards:
  3 cut = 1 green + 2-3 gold; 2 = 1-2 gold; 1 = -1 HP; 0 = -1 HP +
  1 queued poison (next battle). Non-perfect results linger.
- **RED Trial of the Hand** — 14-challenge pool tagged strength /
  dexterity / mental / social. DM adjudicates via dm_screen panel
  (PERFECT / GOOD / FAILED buttons). Breaker auto-win badge on
  strength. Perfect = 1 red + 2 gold + 1 cheese; Good = 1 red +
  1 gold; Failed = 1 cheese + event lingers.
- **GRAY Rubble Stacking** — 5×6 canvas tetris with 8 outline patterns,
  6 block shapes, 3 blocks per attempt, 25s timer. Support/landing
  physics. Perfect (≥90% match, 0 overhang) = 1 gray + 2 cheese
  (Blocksmith +1 gray); Good/Miss/Fail = 1-2 cheese + lingers.
- **PURPLE Fated Choice** — 2-chest decision. 67% blessed (+1 purple,
  2-3 gold); 33% cursed from 5-item pool (lost brick 25%, weakness 25%,
  slow tongue 20%, thin pockets 15%, hex mark 15%). PASS = +1 cheese,
  event lingers. Fixer cleanse: 1 black → negate + blessed; or
  2 white → negate without blessing.
- **WHITE Pilgrim's Rest** — heal-ally / heal-self / self-rest (fallback,
  no bricks) / Fixer revive. 1 white → +3 HP target + 2 white + 1 gold
  back (Fixer: +4 HP, +3 white). Self at full HP = +1 Max HP instead.
  Fixer revive costs 1 white + 1 purple, target revives at 50% HP,
  Fixer gains +3 white + 2 gold.
- **BLACK Shadow Bargain** — 4 weighted offers (55% blood_price rolled
  1d10 for 2-5 permanent max HP loss, 25% brick_exchange 1 non-black →
  1 black + 3 gold, 15% poisoned_favor +1 black + 3 battles poison
  queued, 5% binding_pact +2 black, all living allies lose 1 random
  non-black brick). Formwright Scholar's Eye: sees offer type +
  description before deciding. REFUSE: 97% → 1 cheese, 3% → 1 black,
  event lingers.

### Infrastructure added

- **Lingering events** (`G.lingeringEvents[spaceIdx]`) — tracks partial
  failures + passes so next player to land triggers fresh attempt.
  Dispatched in `landingRoll` before rolling new event. Variant
  re-rolled each attempt (new chest positions, new vines, new rubble
  layout).
- **Cheese** (`player.cheese`) — tradable inventory separate from
  bricks. Eat 1 = +1 Max HP; gift 1 to ally (same-zone required).
  No store mechanics in v4 (deferred). Flows from purple PASS, black
  REFUSE, red/gray/green partial results.
- **Queued poison** (`player.queuedPoisonStacks`, `queuedPoisonBattles`) —
  cross-system poison from failed green/black events. Applied at
  rumble `_internalStart` via `applyStatus('poison',{stacks,duration:6,
  dmgPerTick:1})`. Cleansed on board for 1 white (any class, new
  `cleansePoison` handler).
- **Yellow riddles** expanded 13 → 25 with `a_alt` (case-insensitive
  alternate answers). Bridge riddle removed (mechanic doesn't exist).
  New riddles cover bricks, classes, events, bosses, entities.
- **Zone transition cleanup** — WEAKNESS restores max HP; SLOW TONGUE
  clears expired zones from `G.slowTongueZones`.

### Event table rebalance (April 21 session)

Stripped entirely:
- `nothing` (3 slots across zones 1-2)
- `creeper` (old rumble vines, 1 slot)
- Old `purple` LEGO trivia (replaced by fated_choice)
- Old `gray` take/search UI (replaced by rubble_stacking)

Expanded to 7 slots per zone (was 6). Server landing roll changed
from `roll(6)` to `roll(7)`. All zones balanced by theme:
- **Z1** gentle: gray, red, gold, riddle, monster, trap, gray
- **Z2** magic: white, green, gold, blue, monster, riddle, trap
- **Z3** pressure: monster, black, purple, green, riddle, red, gold
- **Z4** escalation: monster, gray, black, purple, white, doubletrap, red
- **Z5** boss: all 7 slots → Stone Colossus

**Critical bug fixed:** two landing tables existed (server.js LANDING
drives natural rolls, game.js LANDING_EVENTS drives DM force-event).
They had drifted out of sync — DM was forcing pre-v4 events.
Rewrote both in sync, then extended server.js `forceEvent` handler
to properly set v4 variant fields (purpleVariant, blackVariant,
blackOffer, greenVariant, redVariant, redChallenge, grayVariant,
grayOutline, grayBlocks, whiteVariant, class-flag hints).

### Flavor + UI polish

- Added 5-line pools for `green`, `red`, `black` to `LANDING_FLAVOR`
  in players.html + test_players.html (they were falling back to
  `nothing` pool).
- Rewrote `purple` flavor (was LEGO trivia context, now 2-chest context).
- Every event has:
  - Styled card with Cinzel-serif title + icon + themed border
  - Inline flavor text describing the encounter
  - Interactive buttons / minigame
  - Result state with outcome label + reward description
  - Lingering badge when re-triggered
- Cheese HUD chip added next to Gold in main player HUD (tap to
  open eat/gift modal when > 0).
- Queued poison warning badge appears below HUD with cleanse button
  when `queuedPoisonStacks > 0` and player has ≥ 1 white brick.
- DM has single **"✓ Mark Resolved"** button on active event panel
  that handles every event type — advances turn, ticks poison damage
  if round wraps, increments round counter + fortress decay.

### File state

Deliverables in `/mnt/user-data/outputs`:
- server.js 114277 bytes
- game.js 34051 bytes
- rumble.js 351014 bytes
- players.html 319535 bytes
- test_players.html 321064 bytes
- dm_screen.html 79066 bytes

All syntax-verified. Ready for commit.

### Deferred (post-v4)

- Lingering event marker on board graphic (colored dot per space)
- Cheese display on dm_screen.html per-player roster
- Cheese store mechanics (buy/sell)
- RED digital fallback (reflex minigame for remote play)
- Event variant expansions (more chest types, more bargain offers)
- **Class skills rework with fusion gating + achievement unlocks**
  (queued as next major session)
- **Board actions audit + consistency pass** (queued)

---


---

## Patch Log Archive

For closed-session patch logs and the S015 process retrospective, see
**`ARCHIVE.md`**. This was split out at the close of S015 to keep this
NOTES.md lean — patch entries are dense reference material that doesn't
need to be in context every turn.

Currently archived: Session 011 → Session 015 (including v0.16.0 → v0.16.6
continuation work) plus the S015 process retrospective.

When a future session's patch log grows past ~20 entries, move it to
ARCHIVE.md and leave a one-line pointer here.

---

## Session 016 — Active Patch Log

Current-session patches live here until the session closes, then they
migrate to ARCHIVE.md.

### v0.16.7 — Post-rumble pulse delay 500ms → 1000ms

> "need more delay after rumble for flair fx, maybe twice as long"

v0.16.5 introduced the 500ms post-rumble delay (gives user time to land
on dashboard before chipPulse fires). Playtest revealed 500ms isn't
quite enough beat — bumped to 1000ms.

The delay is tracked via `_justExitedRumble` boolean set in the rumble-end
handler (~line 410), consumed in `_detectInvIncreasesAndPulse` to defer
the pulse calls. Re-queries chip position inside the deferred call to
handle any layout shift between detect and fire.

**File changed:** `players-core.js` only (one-line constant + comment).

---

### v0.16.8 — Dynamic Zone Foundation (layout restructure)

> "this redesign should feel at home in all orientations, purposeful
> and intuitive… cheese and coins move down to bricks, event/flavor
> text zone becomes all-in-one… market button gone completely…"

**Foundation push for the All-in-One Dynamic Zone redesign.**

This patch ships the structural layer ONLY — layout, HTML restructure,
new helper functions for the dashboard composition. The hold-gesture
state machine that turns the dynamic zone into a true multi-state slot
(market / cheese / party / fusion surfaces) lands in v0.16.9. The
brick-drag-to-fusion gesture with particle/flicker/flash choreography
lands in v0.16.10.

---

**Design vision (locked in S016):**

The dashboard becomes radically simpler:
- **Top:** identity + survival (avatar, class, zone, HP bar, shield)
- **Middle:** dynamic zone — single slot, multiple states, one mental
  model. Currently shows flavor (idle) or event card (active). v0.16.9+
  adds market / cheese options / party / fusion states reachable via
  hold-gestures on the interaction row chips below.
- **Bottom:** interaction row — bricks + coin + cheese + avatar. Each
  is a hold-target. Hold-gestures invoke their respective dynamic zone
  surface (wired in v0.16.9).

UNITY: every interactive element follows the same hold-to-invoke
pattern. Every "view" lives in the same dynamic zone.

ELEGANCE: removes Market button (redundant), removes tabs (redundant),
removes BRICK CHARGES label (redundant). The interactions ARE the
navigation.

EFFICIENCY: dashboard becomes a tight stack — three sections doing the
work of seven. Landscape no longer wastes the right half because the
dynamic zone can flow horizontally when nothing forces narrow content.

---

**v0.16.8 ships (foundation only):**

1. **Tabs system removed entirely.** `.tabs` and `.tab-content` divs
   replaced with single `.dashboard-host` containing `pane-dashboard`
   directly. `pane-party` and `pane-fusion` removed from the HTML —
   their content surfaces via the dynamic zone going forward.
   `buildTabs()` and `switchTab()` kept as no-op stubs (boot
   sequence still calls them; v0.16.9 strip can remove the calls).
2. **Connect indicator inline.** `.conn-pill` (standalone right-side
   pill with text "online"/"offline") replaced with `.conn-dot` —
   8px color-coded circle (green/dark gray) inline with player name
   in the topbar. Updated in players.html, test_players.html, plus
   their inline JS (`setConn`, test connect handlers).
3. **Compact `_dashHeader`.** Renders avatar + class name + zone label,
   HP big number + bar, shield label + count + pips, status badges.
   No gold/cheese chips here anymore — those moved to the interaction
   row. Same layout for portrait/landscape (responsive depends on the
   parent flex flow).
4. **New `_dashDynamicZone(me)`.** Replaces old `_dashTopSlot` +
   `_dashFlavorLine`. Returns `{html, active}` so renderDashboard can
   track active state for transitions. Today's states: idle (flavor
   text from `dashboardFlavor()`), event (`#landing-result` container
   when active event), rumble pending/active (via `renderRumbleCard`).
   The shell `<div class="dynamic-zone" id="dynamic-zone">` wraps the
   content for v0.16.9 state transitions to target.
5. **New `_dashInteractionRow(me)`.** Replaces old `_dashBrickBar`.
   Renders `.interaction-row` containing brick chips (via renamed
   helper `_dashBrickChips`, returns chip HTML only, no card wrapper)
   plus three resource chips: gold (`data-res="gold"`), cheese
   (`data-res="cheese"`), avatar (`data-res="avatar"`). Each
   resource chip has `data-zone-trigger` attribute hinting at which
   dynamic zone surface its hold-gesture should invoke (wired
   in v0.16.9).
6. **`renderDashboard` composition rewritten:**
   `header → dynamic zone → interaction row → phase context → market
   panel → status clues`. Old composition was
   `top slot → header → brick bar → phase context → market → clues`.
7. **Chip-finder helpers updated** for new gold/cheese position.
   `_findGoldChipDest` and `_findCheeseChipDest` now query
   `.res-chip[data-res="gold"]` / `[data-res="cheese"]` directly
   instead of scanning `.stat-num` for emoji content. Maintains
   chipPulse arrival highlights without changes downstream.
   `_findBrickChipDest` first-of-color fallback updated — was looking
   for the "Brick Charges" card-title (now removed); now falls back to
   the `.interaction-row .brick-chips` host.
8. **Scroll-hide IIFE** updated to attach to `dashboard-host` instead
   of `tab-content`.
9. **`applyFontSize`** updated to target `dashboard-host` for zoom
   scrolling instead of `tab-content`.

---

**v0.16.8 deliberately does NOT ship:**

- Hold-to-invoke gestures for coin/cheese/avatar — `data-zone-trigger`
  attributes are present but no event handlers attached. Chips render
  but holds are inert. v0.16.9 wires the gesture state machine.
- Brick-drag-to-fusion gesture with particle/flicker/flash. v0.16.10.
- `renderParty` / `renderFusion` function strip — kept in code for now
  with early-return on missing pane. v0.16.9 cleanup pass removes them.
- `.stats-row` and `.stat-chip` CSS — orphaned after gold/cheese moved
  out of header but harmless. Cleanup in v0.16.9.
- Tab CSS (`.tabs`, `.tab`, `.tab-content`, `.tab-pane`) — already
  removed from players.html and test_players.html.

---

**Files changed:**

- `players.html` — topbar conn-pill→conn-dot, tabs/tab-content removed,
  replaced with `.dashboard-host > pane-dashboard`. CSS for
  `.dashboard-host`, `.dash-surface`, `.dynamic-zone`,
  `.interaction-row`, `.res-chip`, `.conn-dot`. Inline `setConn` updated.
- `test_players.html` — mirrors all players.html changes (memory rule
  #1: paired files always move together). Test-specific connect
  handlers updated.
- `players-core.js` — major edit. New `_dashHeader` (compact, no
  gold/cheese), new `_dashBrickChips` (was `_dashBrickBar`, returns
  chips only), new `_dashInteractionRow`, new `_dashDynamicZone`,
  removed `_dashTopSlot` and `_dashFlavorLine`, rewritten
  `renderDashboard` composition, removed `renderParty()`/`renderFusion()`
  calls from `render()`, replaced TAB_DEFS / buildTabs / switchTab
  with no-op stubs, updated chip-finder helpers
  (`_findCheeseDest`/`_findGoldChipDest`/`_findCheeseChipDest`/
  `_findBrickChipDest`), updated scroll-hide IIFE and `applyFontSize`
  to target `dashboard-host` instead of `tab-content`.
- `NOTES.md` — this entry.

---

**Test focus:**

1. **Hard refresh** (HTML + CSS + JS all changed).
2. **Connect:** conn-dot turns green (top of screen, inline with class
   name). Disconnect: turns dark gray. No more text-based pill.
3. **Header:** compact card with class icon, name, zone, HP bar +
   number, shield label + count + pips. NO gold/cheese here.
4. **Dynamic zone:** when idle, shows flavor text in italic, dim
   styling (same as old flavor line). When active event, shows event
   card. When rumble pending/active, shows rumble card. Same content
   as before, just relocated between header and interaction row.
5. **Interaction row:** at bottom, single rounded card containing
   brick chips on the left (with charge pips, signature highlighting),
   gold + cheese + avatar chips on the right. No "BRICK CHARGES" label.
   No Market button.
6. **Brick hold-tier:** existing white/gray hold-tier behavior should
   still work — tap fires tier-1 action, hold opens fan-out for
   white. (Untouched by this patch.)
7. **Resource chip holds:** holding coin, cheese, or avatar should
   do NOTHING in v0.16.8. They render and visually press but no
   action invokes. (v0.16.9 wires the hold-gestures.)
8. **chipPulse arrivals:** gold/cheese rises (from rumble or events)
   should still pulse on the right chips — the finder updates
   maintained the pattern. Brick rises pulse on the brick chips
   in the interaction row.
9. **Scroll-hide:** scrolling the dashboard content should still
   hide topbar + phase banner (now attached to dashboard-host).
10. **Tab regression:** any old call sites that expected
    `pane-party` / `pane-fusion` should fail gracefully (early-return
    on missing element). No console errors.

---

**Risk surfaces being watched:**

- `renderParty` / `renderFusion` still exist as functions; they target
  removed elements and early-return. Until v0.16.9 cleanup, any
  external caller (rumble manager? KO panel?) that referenced them
  is now silently no-op. Watch for missing UI in those flows.
- Hold-gesture conflict: brick chips have `_holdStart` for tier-charge
  (white/gray). v0.16.10's brick-drag-to-fusion gesture will need to
  coexist via drag-direction differentiation. Parked for v0.16.10.
- KO panel text references the "Party tab" — updated to "Hold your
  avatar to view party" to match the new gesture pattern. v0.16.9
  needs to actually wire that gesture.

---

**Standards audit (rule #17 — push #28 in S015 continuation):**

This is the largest single patch in S016 so far. Ross signed off on
the scope after the planning loop. Build executed in the order:
HTML restructure → CSS → players-core.js helpers → composition
rewrite → chip-finders → audit pass → NOTES.

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html moved
  together ✓
- Rule #11 (data/runtime/UI separation): UI-only changes; no
  characters.js touched, no runtime in rumble.js disturbed ✓
- Rule #14 (handoff hygiene): files re-read before each major edit;
  layout decisions grounded in actual current structure, not
  assumptions ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): the redesign IS the principle.
  Three sections doing the work of seven.
- Rule #19 (intuition): led with intuition (dynamic zone as unified
  slot), Ross extended it (cheese/coins move down to bricks, hold
  gestures invoke surfaces). Bundled both into the build.

---

### v0.16.9 — Header redesign + class-color dynamic zone + two-layer interaction row

> "move health/armor/status bar next to player tag/name and move the
> connected icon down next to player tag remove the red header
> completely and the player icon and connect icon, these are
> unnecessary and redundant. get rid of player icon next to cheese,
> player icon next to health bar will work just fine; remove market
> button completely; moe cheese and coin above brick bar, two layers,
> a bit more breathing room between coin and cheese; a bit of space
> between coin/cheese and brick layers. outline dynamic card in
> player color, and more intense highlight when it is player turn."

Plus: "no banner; always flavor text when not in event; during turn
intense highlight and gentle pulsing of border."

---

**Vision shift (S016 redesign continuation):**

v0.16.8 shipped the structural foundation (tabs gone, dynamic zone +
interaction row scaffolded). v0.16.9 finishes the layout vision based
on Ross's playtest annotations on the v0.16.8 result.

Originally v0.16.9 was scoped to be the hold-gesture state machine
(coin→market, cheese→eat, avatar→party). That moves to v0.16.10.
Layout polish takes priority — the dashboard needs to feel right
visually before behavior layers on top.

---

**Removed:**

1. **Topbar entirely** (`.topbar` div + class icon + class name +
   conn-dot at top of viewport). Class info now lives in the header
   card; conn-dot moved inline with class name in the header.
2. **Phase banner entirely** (`.phase-banner` div with "▶ YOUR TURN —
   PREPARE", "Waiting…", etc.). Replaced by:
   - Dynamic zone border outlined in class color (always)
   - `.my-turn` class on dynamic zone triggers intense glow + gentle
     pulse animation when it's the player's turn
   - Flavor text inside dynamic zone covers the "ambient state when
     nothing else is happening" case
3. **Avatar resource chip** from interaction row. Class icon in header
   serves as the avatar reference (v0.16.10 wires holding it for
   party invocation).
4. **`renderPhaseBanner`** stubbed to no-op — element is gone, callers
   harmless (existing call sites in render() and trade flow guard with
   `if (banner)` checks or just no-op out).
5. **t-icon / t-name DOM updates** in `chooseClass()` (players-core.js)
   and `setClass()` (test_players.html) — those elements are gone.

---

**Restructured:**

1. **Header is now a horizontal-split card** (`.head-card`):
   - LEFT (`.head-id`): class icon (28px) + class name + zone label +
     conn-dot inline next to the name
   - RIGHT (`.head-stats`): HP big number + bar + shield label/count
     + pips + status badges
   - Flexes evenly: in landscape, fills width as one row; in portrait,
     wraps to two stacked rows
   - **Fixes v0.16.8 HP bar overflow** — bar was unbounded and read as
     full-viewport-wide; now bounded by `.head-stats` container.
2. **Interaction row is now two layers** (`.interaction-row`,
   `flex-direction:column`):
   - LAYER 1 (top, `.resource-chips`): coin chip + cheese chip with
     `gap:14px` for breathing room
   - LAYER 2 (bottom, `.brick-chips`): brick chips, centered
   - `gap:10px` between the two layers
   - `padding:10px` around the whole row
   - Resource chips redesigned: now horizontal (icon + number side-by-side)
     instead of vertical stack; bigger touch target.
3. **Dynamic zone styled** as the visual chrome (replaces inner card
   borders):
   - Always: 1px border in `var(--cls-color)`, padding 8px, transparent
     interior, no inner card border
   - On player's turn: `.my-turn` class adds glow + 2.4s pulse animation
     via `@keyframes dz-pulse`
   - Inner `.card` and `#landing-result` get border:none, background:
     transparent, margin:0 so the outer dz border is the visual frame

---

**State-cache for conn-dot:**

The conn-dot now lives inside the header card (rendered by
`_dashHeader`), which means connection events can fire BEFORE the dot
exists in the DOM. Added `_connState` global in players-core.js.
`setConn()` (players.html) and the test_players connect/disconnect
handlers now write to `_connState` AND attempt direct DOM update. On
each render, `_dashHeader` reads `_connState` to set the initial
class. Direct updates between renders still work for connection
events.

---

**Files changed:**

- `players.html` — removed topbar div, removed phase-banner div,
  removed topbar/phase-banner CSS, restyled `.dynamic-zone` (class-color
  border + my-turn pulse), restyled `.interaction-row` (two-layer flex
  column), restyled `.res-chip` (horizontal icon+number), added
  `.head-card` / `.head-id` / `.head-stats` / `.head-icon` / `.head-name`
  / `.head-zone` CSS. Updated `setConn()` to write `_connState`.
- `test_players.html` — mirrors all players.html changes (memory rule
  #1). Updated test connect/disconnect handlers to write `_connState`.
  Updated setClass() to remove t-icon/t-name updates and persist
  `_connState`.
- `players-core.js` — rewrote `_dashHeader` (horizontal split, conn-dot
  inline, reads `_connState`), rewrote `_dashInteractionRow` (two-layer,
  no avatar), rewrote `_dashDynamicZone` (returns `.my-turn` class on
  player's turn, sheds inner `.card` wrapper), stubbed `renderPhaseBanner`
  to no-op, removed `t-icon`/`t-name` updates from `chooseClass`,
  added `_connState` global.
- `NOTES.md` — this entry.

---

**Test focus:**

1. Hard refresh (everything changed: HTML, CSS, JS).
2. **No top topbar visible** — class identity is in the header card now.
3. **No phase banner visible** — turn signal is the dynamic zone glow.
4. **Header card** at top of dashboard:
   - Avatar (class icon) + class name + zone label on left
   - Conn-dot is the small color-coded circle right after the class
     name (green = connected, gray = disconnected)
   - HP big number, bar, shield label/count, pips on the right
   - In landscape: identity left, stats right, single row
   - In portrait: identity row, stats wrap below
   - **HP bar bounded** to the right column — no longer overflowing
5. **Dynamic zone** between header and interaction row:
   - Always outlined in class color (subtle)
   - When it's YOUR turn: intense glow + gentle pulsing border
   - Idle: shows flavor text in italic dim style
   - Event: shows event card content (same as before, fits inside
     the class-color frame)
6. **Interaction row** at bottom:
   - Top layer: coin + cheese chips with space between, centered
   - Bottom layer: brick chips, centered
   - Space between the two layers
   - Resource chips are bigger now (horizontal icon+number)
   - **No avatar chip** — class icon is in the header instead
7. **No Market button** anywhere
8. Brick hold-tier (white/gray) still works — tap=tier-1, hold=fan-out
9. chipPulse arrivals still hit the new chip positions
10. Connection: connect → green dot, disconnect → gray dot
11. Trade flow still works (the trade-toast fallback that wrote to
    phase-banner is now silently no-op; trade composer still appears)

---

**Risk surfaces:**

- The `dz-pulse` animation is constant 2.4s loop while it's your turn.
  If that's too aggressive (eye fatigue during long prepare phases),
  Ross calls and we tune duration / amplitude.
- `_connState` global — writing happens in two files (players.html,
  test_players.html). Risk of state desync if a future patch only
  touches one. NOTES'd here so the pair-update is documented.
- Trade toast (line 4970-area) writes to gone `phase-banner` element.
  Currently if-guarded so silent no-op. v0.16.10 should surface
  trade-sent feedback via dynamic zone or a fade-toast.
- Battle-mine phase-banner update at line 5213 — same pattern, silently
  no-ops. Also for v0.16.10 polish.
- Existing landing-result inner content that has its OWN class-color
  border may double-up visually with the new dynamic-zone border.
  Watch in playtest.

---

**Standards audit (rule #17 — push #29 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #11 (data/runtime/UI separation): UI-only, no characters.js or
  rumble.js touched ✓
- Rule #14 (handoff hygiene): re-read each file region before editing ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: phase signal lives in dynamic zone (one place for state)
  - ELEGANCE: removed redundant topbar, phase-banner, avatar chip
  - EFFICIENCY: landscape uses width (header is one row); portrait
    still works (head-card flex-wrap)
- Rule #19 (intuition): Ross gave concrete annotations, I extended with
  the implied design choices (head-card horizontal split, conn-dot
  position, removing avatar chip). Asked for clarification on a few
  before building.

---

### v0.16.10 — Coin + cheese chips moved into header card

> "so close, lets move coin and cheese back up, will fit perfectly on
> upper card now in the space below icon player tag"

v0.16.9's two-layer interaction row left the space below name+zone in
the head-id column empty while filling the bottom card with two layers
(resources + bricks). Ross's read: those resources fit better in the
empty header space, and the interaction row simplifies to bricks-only.

**Change:**

- **Coin + cheese res-chips moved** from `.interaction-row .resource-chips`
  (top layer) into the header card's `.head-id` column, in a new
  `.head-resources` block below the name/zone identity row.
- **`.head-id` switched** from `align-items:center` (horizontal layout)
  to `flex-direction:column` so the identity row and resources stack
  vertically inside the left column of the head-card.
- **`.interaction-row` simplified** — removed `.resource-chips`
  sub-element, now contains only `.brick-chips`. Still a rounded card
  with `padding:10px` so bricks have visual containment.
- **`_dashHeader`** rewritten: identity row inside its own wrapper,
  followed by `.head-resources` containing the two chips with their
  existing `data-zone-trigger` attributes (still inert; v0.16.11
  wires the hold-gestures).
- **`_dashInteractionRow`** simplified to just brick chips.

**Files changed:** `players-core.js`, `players.html`, `test_players.html`,
`NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx.js, boardFx.css.

---

**Layout result (landscape):**

```
┌─ HEAD CARD ────────────────────────────────────────┐
│ ┌── .head-id ─────┐  ┌── .head-stats ──────────┐ │
│ │ [icon] Name •   │  │ HP big / max + bar      │ │
│ │        Zone     │  │ SHIELD label + count    │ │
│ │                 │  │ + pips                  │ │
│ │ [coin] [cheese] │  │ (statuses, badges)      │ │
│ └─────────────────┘  └──────────────────────────┘ │
└────────────────────────────────────────────────────┘
┌─ DYNAMIC ZONE (class-color border, pulse on turn) ─┐
│ flavor / event / rumble                             │
└─────────────────────────────────────────────────────┘
┌─ INTERACTION ROW (bricks only) ─────────────────────┐
│ [brick] [brick] [brick]                             │
└─────────────────────────────────────────────────────┘
```

Portrait: `.head-card` flex-wrap kicks in — `.head-stats` stacks below
`.head-id`. Coin + cheese remain in the head-id column either way.

---

**Test focus:**

1. Hard refresh.
2. **Coin + cheese chips visible inside header card**, beneath the
   class name + zone label, on the LEFT side.
3. **Interaction row is bricks-only** at the bottom — no resource chips
   there anymore.
4. **chipPulse arrivals** on coin/cheese should land on the chips in
   their new header position. (Finder helpers query
   `.res-chip[data-res="..."]` so they work regardless of where the
   chip lives in the DOM.)
5. Existing brick hold-tier still works.
6. Header card in landscape is still one row (identity left, stats
   right); in portrait still wraps cleanly.
7. Dynamic zone class-color border + my-turn pulse still right.

---

**Standards audit (rule #17 — push #30 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: each card has one clear purpose now — head holds identity
    + survival + spendables, dynamic zone holds narrative state,
    interaction row holds the interactive brick layer
  - EFFICIENCY: filled the empty space in the head-id column, removed
    a sub-component (`.resource-chips` layer) from interaction row.
    Visual density better, code simpler.

---

### v0.16.11 — Vertically center coin+cheese in head-id column

> "so close, bring the cheese and coin down just a bit, sit middle of
> vertical space from player icon to lower boundry of card"

v0.16.10 placed coin+cheese chips inside `.head-id` but they sat
hugging the identity row at the top. Visual goal: the chips should
sit vertically centered in the leftover space below the
icon/name/zone block.

**Fix:**

- **`.head-card`** changed from `align-items:flex-start` to
  `align-items:stretch` — both columns (head-id, head-stats) now
  stretch to match the taller sibling's height. .head-stats is
  typically taller (HP + bar + shield + pips + badges), so the head-id
  column gets that same height.
- **`.head-id`** kept flex-column, but `gap:10px` removed (was forcing
  fixed spacing). Added `align-self:stretch` for explicit cross-axis
  filling.
- **`.head-resources`** got `margin:auto 0` — flexbox auto-margin
  trick that pushes the element to vertical-center of remaining space
  in a flex-column parent. Identity row stays at top; resources land
  in the middle of leftover space; bottom of card gets matching empty
  space below the chips.

CSS-only patch — no JS changes, no markup changes.

**Files changed:** `players.html`, `test_players.html`, `NOTES.md`.

UNTOUCHED: players-core.js, server.js, rumble.js, characters.js, boardFx.

---

**Test focus:**

1. Hard refresh (CSS changed).
2. Coin + cheese chips visually centered in the vertical space from
   icon/name down to bottom of head-card.
3. Rest of header still right (HP/shield on right, conn-dot inline,
   etc.).
4. Header still wraps cleanly in portrait (head-stats below head-id).

---

**Standards audit (rule #17 — push #31 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): pure ELEGANCE polish — visual
  rhythm, no behavior change, no code complexity added ✓

---

### v0.16.12 — Fullscreen on player select + bottom-anchored coin/cheese in both orientations

> "fullscreen after player select on player/html, landscape and portrait
> fullscreen forced; cheese and coin need to maintain lower position
> beneath icon whether landscape or portrait, in portrait shrink health
> bar to compensate, slightly closer to bottom boundry with coin and
> cheese, sttil feels too close to player icon, this is the one to
> drive it home!"

Three fixes bundled:

**1. Fullscreen request on player select.** `selectClass()` in
players-core.js now calls `requestFullscreen` on the document element
after switching to game-screen. The class-tap is a user gesture (the
only context where fullscreen API is allowed). Vendor-prefixed
fallbacks included (webkitRequestFullscreen / mozRequestFullScreen /
msRequestFullscreen). Wrapped in try/catch — some embedded views or
permission policies may deny, in which case behavior degrades to
non-fullscreen (current behavior). Both orientations supported —
fullscreen API is orientation-agnostic.

NOT applied to test_players.html — debug harness needs side-by-side
multi-class inspection without fullscreen interfering.

**2. No-wrap layout across orientations.** v0.16.11 had
`.head-card` with `flex-wrap:wrap` — in portrait, head-stats (right
column, min-width:200px) couldn't fit alongside head-id, wrapped to a
new row, breaking the side-by-side layout AND the
`align-items:stretch` math (no leftover vertical space for chips to
center in).

Now: `.head-card` is `flex-wrap:nowrap` so the horizontal split
persists in both orientations. `.head-stats` `min-width` dropped from
200px to 0 (relies on `flex:2` for proportional sizing instead of
hard-pixel floors). `.head-id` `min-width` dropped from 140px to 0
similarly. HP bar inherits responsive width — compresses naturally
in narrow portrait. Per Ross's spec: "in portrait shrink health bar
to compensate."

**3. Coin/cheese pinned to bottom of head-id (not centered).** v0.16.11
used `margin:auto 0` to vertically center the chips in leftover space.
Ross feedback: "still feels too close to player icon, this is the
one to drive it home!" — the chips need to BIAS toward the bottom,
not center.

Now: `.head-resources` uses `margin-top:auto` (pushes to bottom of
flex column, no `margin-bottom`). `.head-id` got
`min-height:120px` so there's guaranteed space for the chips to be
"pushed to the bottom" of even when the identity row is short.

Result: identity row at top, blank space, coin/cheese flush against
the bottom of the head-id column with `padding:12px` of head-card
padding below them.

---

**Files changed:** `players-core.js`, `players.html`, `test_players.html`,
`NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Player select → fullscreen.** Pick a class, browser should
   immediately go fullscreen (browser chrome disappears). Both
   landscape and portrait. If the browser denies (some Android browsers
   in restricted contexts), fallback is the existing non-fullscreen
   behavior.
3. **Coin + cheese in landscape:** sit at the bottom of the head-id
   column, flush against the card's bottom padding. Significant blank
   space between identity row and chips.
4. **Coin + cheese in portrait:** SAME relative position (bottom of
   head-id column). The columns stay side-by-side — head-stats does
   NOT wrap below.
5. **HP bar in portrait:** compressed but functional. Numbers and
   labels still readable, bar shorter horizontally.
6. **HP bar in landscape:** unchanged from v0.16.11 — full width of
   right column.
7. **chipPulse** still hits the chips in their new lower position
   (finder helpers position-agnostic).

---

**Standards audit (rule #17 — push #32 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html (note that
  fullscreen is players-only by design) ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): UNITY for layout (same shape
  in both orientations); ELEGANCE for the bottom-anchor approach
  (margin-top:auto is the simplest tool for "push to bottom"); 
  EFFICIENCY for fullscreen (more screen, less chrome).

---

### v0.16.13 — Stack coin/cheese vertically + pip wrap + remove duplicate CSS rule

> "maybe coin on top of cheese for dynamic response if elements get too
> tight, and armor pips can consolodate onto more rows, making room for
> everything to breathe. also, need to bump up coin and cheese just a
> bit, about halfway between last orientation and current for lowest
> elemtn"

Three fixes:

**1. Coin and cheese stack vertically** (coin on top, cheese below).
Was `display:flex` row with `gap:10px`. Now `flex-direction:column`,
`gap:6px`, `align-items:flex-start`. UNITY: chips remain a single
visual block, just orient compactly when squeezed. Solves overflow
in narrow portrait where the side-by-side chips were spilling out
of head-id horizontally.

**2. Shield pips can shrink smaller for narrow viewports.** Was
`Math.max(10, Math.min(22, Math.floor(260/shieldMax)))` — for
shieldMax=14 that yielded 18px pips × 14 = ~250px+ wide, which
overflowed narrow portrait. Now
`Math.max(8, Math.min(18, Math.floor(220/shieldMax)))` — yields
15px pips for 14-pip case, allows shrink to 8px floor for very
narrow. Also pip height nudged 14px → 12px for compactness. Pips
will wrap to multiple rows naturally via existing
`flex-wrap:wrap` on `#my-shield-pips`.

**3. CRITICAL FIX: Removed duplicate `.head-stats` CSS rule.**
v0.16.12's edit landed two `.head-stats` rules in players.html — the
first with `min-width:0` (intended), the second from the v0.16.11
version with `min-width:200px` (forgot to clean up). Cascade gave
the `200px` rule precedence, which in narrow portrait forced
`.head-stats` too wide and triggered the overflow chaos seen in
Ross's screenshot (HP big number rendering on top of class name,
pips overflowing into head-id territory). Single clean rule now.

**4. Coin/cheese position bumped up slightly.** v0.16.12 used
`margin-top:auto` to push chips flush against card bottom. Per
Ross: "halfway between last orientation and current." Added
`margin-bottom:8%` so chips lift off the very bottom. The
auto-margin still pushes them past the identity row; the bottom
margin gives ~75% mark instead of 100%.

CSS-only + tiny JS tweak. No markup changes.

**Files changed:** `players-core.js` (pip sizing only), `players.html`,
`test_players.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Portrait orientation:**
   - Header card splits side by side (no wrap)
   - HP bar fits in right column (compressed but visible)
   - HP big number "14" sits cleanly in head-stats column, NOT
     overlapping the BREAKER name
   - Shield pips wrap to 2 rows if needed, contained inside
     head-stats
   - Coin chip on top, cheese chip below — stacked in head-id column
   - Chips ~75% down the column (clear space above and small space
     below, no longer flush bottom)
3. **Landscape orientation:**
   - Same layout, more horizontal room — pips might stay one row
   - Coin/cheese still stacked vertically (consistent across
     orientations)
4. chipPulse arrivals still hit the chips.

---

**Standards audit (rule #17 — push #33 in S015 continuation):**

The duplicate `.head-stats` rule is exactly the kind of bug rule #14
(handoff hygiene) is meant to catch — re-read files before editing,
spot leftover state. Caught it on Ross's screenshot pass instead of
edit pass. Slightly drift from the rule but caught quickly in the
iteration loop.

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #14 (handoff hygiene): partially drifted (left duplicate CSS
  rule) but recovered in next iteration ⚠️
- Rule #20 (grep for old-pattern symptoms): would have caught the
  duplicate rule. Lesson: when editing CSS that was modified in a
  prior recent push, grep for the SELECTOR to find duplicates.

---

### v0.16.14 — Coin/cheese: side-by-side default + responsive sizing + wrap fallback

> "coind and cheese should be side by side, unless there is not enough
> room for them, then stack centered within the available space on
> card. zoomed out and in all the way, looks like there is room on each
> for them to be stacked horizontally both times. cant they be a bit
> smaller if needed as well? are they not responsive to display size?"

v0.16.13 forced vertical-stack by default. Wrong heuristic — the
columns DO have room for side-by-side in both orientations on most
viewports. The chips weren't responsive (fixed `min-width:64px`,
fixed font sizes), so they appeared too large to fit even when
they could.

**Fix: let CSS do the responsive work.**

**1. `.head-resources` is now `flex-direction:row` with `flex-wrap:wrap`.**
Side-by-side by default. When the column is genuinely too narrow,
flex-wrap kicks in and they stack. `justify-content:center` keeps
them centered (in the row when side-by-side; visually centered in
the column when wrapped). `align-self:stretch` gives the chip block
the full width of head-id so chips have room to spread.

**2. `.res-chip` is now responsive.**
- `flex:1` — chips share available width equally
- `min-width:48px` — comfortable touch target floor (was 64px fixed)
- `max-width:90px` — caps so they don't sprawl in landscape (new)
- `padding:clamp(4px, 1.5%, 8px) clamp(6px, 3%, 14px)` — scales
  with viewport, smaller when squeezed
- `gap:6px` — tighter inner spacing (was 8px)

**3. Glyph and number font sizes use `clamp()`.**
- `.res-chip-glyph` — `font-size:clamp(14px, 4vw, 20px)`
  (was fixed 20px)
- `.res-chip-num` — `font-size:clamp(13px, 3.5vw, 18px)`
  (was fixed 18px)

The `clamp(min, preferred, max)` pattern lets the browser scale
naturally with viewport width, so the chips look right at every
zoom level and in both orientations without fixed breakpoints.

UNITY: one rule for chip layout that handles all viewport sizes —
no media queries, no JS branching, no orientation-detection.
ELEGANCE: CSS does the responsive work. EFFICIENCY: zero added
complexity, just better-chosen flex/clamp values.

---

**Files changed:** `players.html`, `test_players.html`, `NOTES.md`.

UNTOUCHED: players-core.js, server.js, rumble.js, characters.js, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Landscape, default zoom:** coin + cheese side-by-side in the
   head-id column.
3. **Landscape, zoomed in:** chips remain side-by-side (responsive
   sizing keeps them small enough); fall back to vertical stack
   only when truly squeezed.
4. **Portrait, default zoom:** side-by-side if room exists, wrapped
   to stack if not — let the browser decide.
5. **Portrait, zoomed in:** likely stacks as fallback. Centered in
   the available space.
6. **Both orientations:** chips look proportional to the rest of
   the card — not overly large, not too small.

---

**Standards audit (rule #17 — push #34 in S015 continuation):**

Checked for duplicate CSS selectors with grep before shipping (rule
#20 lesson from v0.16.12). All `.head-*` and `.res-chip` selectors
appear exactly once in each file. ✓

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): one CSS rule covers all
  viewport sizes — no JS, no media queries, no orientation hacks.
  This is the elegant version.
- Rule #19 (intuition): trusted Ross's observation ("looks like
  there is room") over my v0.16.13 default-to-stack pessimism.

---

### v0.16.15 — HP cluster right-anchored + status badges in freed left space

> "still overlapping elements on landscape. what if we moved large HP
> number closer to its end 14_/14 instead of 14____________/14. Make
> denominator a bit larger and same color as well, numerator stays
> same. space between character icon and hp numbers can be used for
> status effect icons"

The HP-overlap-with-BREAKER bug from v0.16.13 had a structural cause
I missed: `.hp-row` was `justify-content:space-between` which pushed
`.hp-big` to the FAR LEFT and `.hp-max` to the FAR RIGHT of head-stats.
At narrow widths, the far-left HP big number physically overlapped
with head-id content. v0.16.13 chip changes didn't address this.

**Fix per Ross's spec:**

**1. HP cluster right-anchored as one visual unit.**
- New `.hp-cluster` div wraps `.hp-big` + `.hp-max` together
- `gap:4px` between number and "/14 HP" — tight, reads as one stat
- `flex-shrink:0` so the cluster never collapses
- Cluster sits at the right of `.hp-row` via parent's
  `justify-content:space-between` (paired with the new status slot)

**2. Denominator picks up HP color, slightly larger font.**
- `.hp-max` now `clamp(13px, 3vw, 18px)` (was fixed 14px)
- `.hp-max` now uses inline `style="color:${hc};"` matching the HP
  big number's color — the dynamic color (cls-color, orange, red,
  purple-overheal)
- `opacity:.85` so the denominator reads as supporting text, not
  competing weight

**3. Status badges relocated to freed left space.**
- New `.hp-status-slot` div on the LEFT of `.hp-row`
- Contains poison/curse/confused/down + movement debuff badges
- `flex:1` takes the remaining width; wraps if many badges
- Uses the visual gap between class icon and HP cluster — Ross's
  "space between character icon and hp numbers can be used for
  status effect icons"
- Old `.status-wrap` container (below shield) removed from header
  markup; `.status-wrap` CSS rule still exists, harmless, will
  prune in a later cleanup

**4. HP big number also clamp()'d.**
- `.hp-big` was fixed 28px; now `clamp(20px, 5vw, 28px)` for
  responsive scaling at narrow viewports

UNITY: HP is one stat — rendered as one cluster, not two anchored to
opposite edges. Status info groups visually with HP since they're
both health-related.

ELEGANCE: removes the awkward white-space gap. Same color treatment
makes the denominator read as part of the same number rather than
a separate label.

EFFICIENCY: status badges no longer take their own row below shield —
they live in space that was previously empty. Card height shrinks.

---

**Files changed:** `players.html`, `test_players.html`, `players-core.js`,
`NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Landscape:** HP "14 / 14 HP" sits clustered together at the
   right of head-stats. Both numbers in cls-color orange. No more
   overlap with BREAKER name.
3. **Status badges (when present):** sit in the gap to the LEFT of
   the HP cluster, between the class identity column and the HP
   numbers. Wrap if many.
4. **Portrait:** same right-anchored HP cluster, same status slot.
   Cluster size shrinks via clamp() but stays readable.
5. **Zoomed in:** HP cluster shrinks proportionally; status slot
   compresses; no overlap with head-id content.
6. **Zoomed out:** HP cluster at max size (28px / 18px) without
   sprawling. Reads as one unit.

---

**Standards audit (rule #17 — push #35 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #20 (grep for old-pattern symptoms): checked for duplicate
  `.hp-*` selectors before shipping. Each appears exactly once. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): HP becomes one cluster
  (UNITY), denominator color-matched (ELEGANCE), status moves into
  empty space (EFFICIENCY).
- Rule #19 (intuition): Ross's diagnosis (move HP toward right,
  use freed left for status) was exactly right. Built directly to
  spec.

The HP-row structural issue should have been caught earlier in the
arc — the `space-between` push-apart was always going to overflow at
narrow widths regardless of how chips were positioned. Lesson for
next layout audit: when an overlap occurs, also check the
"intentional spacer" mechanisms in flexbox parents, not just
the children's sizing.

---

### v0.16.16 — Hold-gesture state machine for dynamic zone surfaces

> "lets finish 2 and 3 before 1" (referring to v0.16.16 hold-gestures
> and v0.16.17 fusion-drag, deferring roadmap+design doc).

The dynamic zone foundation laid in v0.16.8 had `data-zone-trigger`
attributes on coin/cheese chips, sitting inert until gesture handlers
wired in. v0.16.16 wires them: hold any of {coin, cheese, class icon}
for 400ms to invoke its dynamic zone surface.

---

**Gesture model:**

- **Hold threshold:** 400ms (constant `RES_HOLD_THRESHOLD_MS`). Long
  enough to clearly distinguish from accidental taps; short enough
  to feel responsive. Distinct from brick `_holdStart`'s 250ms which
  needs to feel snappier for tier-charge actions.
- **During hold (0-400ms):** chip gets `.hold-active` class — border
  takes class color, slight scale-up (1.05). Visual feedback that the
  gesture is being recognized.
- **At 400ms:** surface fades into dynamic zone via `_holdResCommit()`.
  `_zoneState` set to the surface name ('market'/'cheese'/'party').
  `render()` called to re-render dashboard with new state.
- **Tap (release before 400ms):** `_showResourceTapInfo()` shows a
  tooltip above the chip teaching the gesture: "🪙 3 coins · Hold to
  open market". Auto-dismisses after `RES_HOLD_TAP_INFO_MS` (1500ms).

**Toggle behavior:** holding the same chip when its surface is open
toggles back to idle. Holding a different chip swaps to that surface.

**Outside-tap dismiss:** when `_zoneState !== 'idle'`, a document-level
click listener (`_zoneOutsideTapHandler`) is attached. Tapping outside
the dynamic zone (and not on another hold-target chip) dismisses back
to idle. Listener attaches with 50ms delay so the click that opened
the surface doesn't immediately close it. Detached when state returns
to idle.

**Event priority (v0.16.8 rule held):** active landing event ALWAYS
wins. `_holdResStart` checks `_isEventActive()` first — if true,
shows toast "Resolve the current event first" and aborts. Same for
active rumble. If event arrives WHILE a hold-surface is open, the
surface is force-reset in `_dashDynamicZone` (the event wins the slot).

---

**State machine:**

```
'idle' (default — flavor text shown)
  ↓ hold coin 400ms
'market' (renderMarketPanel content)
  ↓ tap outside | tap coin again | hold different chip
back to 'idle' or swap

'idle' ↔ 'cheese' (Eat 1 cheese button → consumeCheese)
'idle' ↔ 'party' (renderParty content)
```

`_zoneState` reset to 'idle' when:
- User dismisses (outside-tap, close button, toggle)
- Event arrives (`_dashDynamicZone` snaps it back)
- Surface fails to render (defensive fallback)

---

**Surface integration:**

- **Market** — reuses existing `renderMarketPanel(me)` HTML output,
  wrapped in the new `_zoneSurfaceFrame` chrome (title + close button
  + body container). Same panel that was previously shown via the
  removed Market button.
- **Cheese** — new surface. One button: "🧀 Eat 1 cheese". Disabled
  if cheese count is 0. Click fires
  `client.send('consumeCheese', {cls: MY_CLASS, amount: 1})` —
  server handler ALREADY EXISTS (server.js line 2635, was wired but
  unused since v0.16.x removed the old market button). Server
  decrements cheese, increments hpMax + hp, broadcasts. Surface
  doesn't auto-close — user can eat multiple in a row, dismisses
  when done.
- **Party** — temporarily injects a hidden `pane-party` div, calls
  `renderParty()` (which writes into that id), captures the resulting
  HTML, removes the temp div. v0.16.17+ should refactor renderParty
  to return HTML directly instead of writing to a host id.

---

**Files changed:**

- `players-core.js` — new globals (`_zoneState`, `_holdRes`,
  `RES_HOLD_THRESHOLD_MS`, `RES_HOLD_TAP_INFO_MS`); new functions
  (`_holdResStart`, `_holdResCommit`, `_holdResEnd`, `_holdResCancel`,
  `_holdResCleanup`, `_showResourceTapInfo`, `_isEventActive`,
  `_dismissDynamicZone`, `_zoneOutsideTapHandler`,
  `_renderZoneSurface`, `_zoneSurfaceFrame`, `_renderZoneMarket`,
  `_renderZoneCheese`, `_zoneEatCheese`, `_renderZoneParty`);
  `_dashHeader` updated to wire onpointerdown on class icon and
  res-chips with `_holdResStart` calls; `_dashDynamicZone` extended
  with hold-surface state branch + event-takes-priority reset; `render()`
  now attaches/detaches `_zoneOutsideTapHandler` based on `_zoneState`.
- `players.html` — added CSS for `.res-chip.hold-active`,
  `.head-icon` (cursor + hold-active state), `.zone-tap-info`
  tooltip with in/out animations, `.zone-surface` frame
  components, `.zone-action-btn`.
- `test_players.html` — mirrored CSS changes.
- `NOTES.md` — this entry.

UNTOUCHED: server.js (consumeCheese already existed), rumble.js,
characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Tap coin briefly:** small tooltip appears above chip showing
   "🪙 3 coins · Hold to open market". Auto-dismisses ~1.5s.
3. **Hold coin 400ms+:** chip glows class color → market surface
   fades into dynamic zone. Tap outside → returns to idle/flavor.
4. **Tap cheese briefly:** tooltip "🧀 N cheese · Hold for options".
5. **Hold cheese:** cheese surface opens with "Eat 1 cheese" button.
   Click button → cheese count drops by 1, max HP increases by 1,
   HP increases by 1. Surface stays open (eat multiple). Tap close
   button or outside to dismiss.
6. **Hold class icon (head-card avatar):** party surface opens
   showing other players' status.
7. **Toggle:** holding the same chip while its surface is open
   closes it (back to idle).
8. **Swap:** holding cheese while market is open swaps to cheese
   surface.
9. **During event:** if you hold a chip while a landing event is
   active, toast appears "Resolve the current event first"; surface
   does not open.
10. **Event arrival:** if you have a surface open and an event
    fires (off-turn riddle activation, etc.), surface is replaced
    by the event card.
11. **No regressions:** brick hold-tier still works (coin/cheese/icon
    handlers separate from `_holdStart`); chipPulse arrivals still
    fire on inventory rises.

---

**Risk surfaces:**

- The `_renderZoneParty` temp-div hack works but is fragile — if
  `renderParty` has any side effects beyond writing to `pane-party`,
  they may misfire. v0.16.17 should refactor `renderParty` properly.
- The 50ms outside-tap-attach delay may need tuning. If hold-surface
  closes immediately on iOS Safari (different click event timing),
  bump to 100ms.
- Hold-during-rumble check uses `typeof _rumbleActive !== 'undefined'
  && _rumbleActive` defensively — if `_rumbleActive` global doesn't
  exist on all client builds, the typeof guard prevents errors.
- Cheese surface reads `_displayed(me, 'cheese')` for the count display
  but `client.send('consumeCheese')` operates on server state — there's
  a brief render lag where button shows "Eat 1 cheese" enabled even
  after pressing it (until server broadcasts new state). Acceptable
  for v0.16.16; could add optimistic UI in polish push.

---

**Standards audit (rule #17 — push #36 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #11 (data/runtime/UI separation): all UI work in players-core
  + html. characters.js, server.js, rumble.js untouched (server's
  consumeCheese was pre-existing, just newly wired). ✓
- Rule #14 (handoff hygiene): verified consumeCheese existed in
  server.js BEFORE assuming it didn't (Ross caught my prior assumption
  this session). ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one gesture pattern (hold 400ms) for all three triggers.
    One state machine. One frame component (`_zoneSurfaceFrame`).
  - ELEGANCE: hold-gestures replace what would have been three
    separate buttons + three separate panels. Same chip serves
    display + interaction.
  - EFFICIENCY: zero new server endpoints (consumeCheese reused);
    market panel and party renderer reused from existing code.
- Rule #20 (grep duplicates): checked CSS selectors before shipping.
  All new selectors appear exactly once in each file. ✓

---

### v0.16.17 — Swipe-to-dismiss + remove tooltip + remove close X + active chip pulse

> "do not need amounts in tool tip, tool tip itself seems unnessecary
> clutter. I think we should remove it. and also remove the X in the
> corner of dynamic sections. maybe a swipe right to remove current
> dynamic card, click and drag off screen to get rid of on
> non touchscreen. will need to be some threshhold for this, drag
> certain distance to dismiss"
>
> "remove outside tap, swipe to remove and hold icon to remove; when
> dynamic portion is loaded, the associated icon should pulse
> differently than turn pulse, but similar color and behavior"

v0.16.16 shipped the gesture system but with three pieces of clutter
that didn't earn their space: tap-info tooltip, close X button, and
outside-tap dismiss. v0.16.17 strips all three and replaces with two
gesture-driven dismissal paths plus a visual link from open surface
back to the chip that opened it.

---

**Removed:**

1. **Tap-info tooltip system** — entire `_showResourceTapInfo`
   function gone, all callers gone, `RES_HOLD_TAP_INFO_MS` constant
   gone, `.zone-tap-info` CSS + keyframes gone. The `.hold-active`
   visual feedback during the gesture (chip glow + scale) already
   teaches the chip is interactive. Tooltip was redundant clutter.
2. **Close X button** in surface header. `_zoneSurfaceFrame` now
   renders title-only. `.zone-surface-close` CSS gone.
   `.zone-surface-head` `justify-content` changed from `space-between`
   to `center` since there's only the title now.
3. **Outside-tap dismiss** — `_zoneOutsideTapHandler` function gone,
   render-time attach/detach logic gone. Was complementary to swipe;
   per Ross's spec, gesture-driven dismissal is THE path now.

**Tap (release-before-threshold) is now silent.** No tooltip, no
feedback. The hold-active visual during the gesture itself is the
only feedback needed. Players learn the gesture by trying it.

---

**Added:**

1. **Swipe-to-dismiss** — `_zoneSwipeStart/Move/End/Cancel` handlers
   wired via inline onpointer attributes on the `.dynamic-zone`
   element when `_zoneState !== 'idle'`. Pointer-based so it works
   for touch (swipe) and mouse (click-drag) uniformly.
   - `SWIPE_DISMISS_THRESHOLD_PX = 80` — drag right past this
     distance to dismiss.
   - During drag: `dynamic-zone` translates with the pointer
     (rightward only); opacity fades to 60% at threshold (visual
     cue release here will dismiss).
   - Past threshold on release: animate translateX(120%) +
     opacity 0 over 240ms, then `_dismissDynamicZone()`.
   - Below threshold on release: snap back (clear transform/opacity).
   - Pointer capture so the gesture continues even if pointer leaves
     the element bounds.
   - Guards against hijacking interactions with buttons/inputs/[data-no-swipe]
     so users can still click the Eat Cheese button etc.
   - Multi-touch safety: only one active swipe at a time
     (`_zoneSwipe` is a single object, not an array).
2. **`.has-surface` class on dynamic-zone** when a hold-invoked
   surface is open. Adds `cursor:grab` / `cursor:grabbing` for
   mouse users (visual affordance that the card is draggable).
3. **Active-trigger chip pulse** — when a hold-invoked surface is
   open, the chip that opened it gets `.surface-active` class.
   `_dashHeader` reads `_zoneState` and applies the class to
   coin/cheese/icon as appropriate.
   - Animation: `chip-surface-pulse` 1.2s ease-in-out infinite
   - Box-shadow expands 4px → 14px and back, scale 1 → 1.04 → 1
   - Class color (`var(--cls-color)`) — same color family as
     `.my-turn` pulse on dynamic zone (UNITY)
   - Different rhythm: `.my-turn` is 2.4s slow breath on the dynamic
     zone border; `.surface-active` is 1.2s tighter pulse on the
     chip itself. Player can tell them apart at a glance.
   - Visual link: open card and the chip that opened it pulse
     together. ELEGANCE — player always knows which chip controls
     this card.

---

**Dismissal paths now (UNITY: gesture-driven only):**

1. **Swipe right** past 80px on the dynamic zone (touch + mouse)
2. **Hold the trigger chip again** (toggle behavior, already in v0.16.16)
3. **Event arrival** (event takes priority, snaps back to event display)

That's it. No buttons, no outside-tap. Closing a surface is always
a gesture you do, never an accident from clicking elsewhere.

---

**Files changed:** `players-core.js`, `players.html`,
`test_players.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Tap a chip briefly:** nothing happens (no tooltip).
3. **Hold a chip 400ms+:** surface opens. Chip starts pulsing in
   class color (faster rhythm than dynamic-zone pulse if it's also
   your turn).
4. **Swipe right on the open surface:**
   - Touch: drag finger right, card follows your finger
   - Mouse: click and drag right, card follows cursor
   - Past ~80px: card animates off-screen-right, dismisses
   - Below ~80px: card snaps back to position
5. **Hold same chip again while surface is open:** toggles the
   surface closed (back to flavor text idle).
6. **Click outside the surface:** nothing happens (outside-tap
   dismiss removed).
7. **Click a button INSIDE the surface (Eat Cheese):** still
   works — swipe handler ignores clicks on buttons/inputs.
8. **Swap surfaces:** while market open, hold cheese — market
   pulse stops, cheese pulse starts, surface switches.
9. **During event:** hold gestures still blocked with toast
   (priority unchanged).
10. **No regressions:** brick hold-tier still works.

---

**Risk surfaces:**

- Swipe gesture conflict potential: brick chips have their own
  `_holdStart` on pointerdown. Brick chips live in the interaction
  row, NOT inside the dynamic zone, so the swipe handler on
  `.dynamic-zone` shouldn't see brick pointer events. But if
  bubbling becomes an issue, may need explicit stopPropagation in
  brick handlers. Will watch in playtest.
- 80px threshold is a starting guess. Per Ross's design philosophy
  (UNITY/ELEGANCE/EFFICIENCY), this is a value to tune by feel.
  Too low = accidental dismissals; too high = annoying to dismiss.
- The `chip-surface-pulse` 1.2s rhythm vs `.my-turn` 2.4s rhythm —
  if both fire simultaneously on the same card (your turn AND a
  surface is open), there could be visual interference. The dynamic
  zone has `.my-turn` pulse on its border; the chip has
  `.surface-active` pulse on the chip itself — different elements,
  so should compose cleanly. Watch in playtest.
- Pointer capture in swipe handler uses `setPointerCapture` which
  is well-supported but wrap in try/catch for older browsers.

---

**Standards audit (rule #17 — push #37 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: dismissal becomes gesture-driven (one paradigm), matching
    the gesture-driven invocation. No mixed paradigms (button +
    gesture + click-elsewhere — the v0.16.16 mishmash).
  - ELEGANCE: zero new chrome. Surface header is just title. The
    swipe gesture itself is its own affordance for touch users;
    cursor:grab is the affordance for mouse users.
  - EFFICIENCY: removed three subsystems (tooltip, close button,
    outside-tap), added one (swipe). Net code shrinks.
- Rule #14 (handoff hygiene): verified all removals are clean —
  grep'd for orphaned references to `_showResourceTapInfo`,
  `_zoneOutsideTapHandler`, `RES_HOLD_TAP_INFO_MS`,
  `.zone-tap-info`, `.zone-surface-close`. All return 0. ✓
- Rule #20 (grep duplicates): all new selectors appear once in
  each file. ✓
- Rule #19 (intuition): Ross's read on the v0.16.16 surface chrome
  (tooltip clutter, close button redundant) was clearly correct in
  retrospect. Should have intuited "gesture-in, gesture-out" symmetry
  during v0.16.16 design rather than shipping with three dismissal
  paths.

---

### v0.16.18 — Card sizing for radial-overlay coexistence + radial fade-beyond-bounds

> "I think we need to expand the size of the dynamic and brick cards,
> so that the current hold tool does not get in the way of fusion drop,
> both need to feel intentionally sized and comfortable in their space"
>
> "we can gray out/reduce opacity of radial menu when beyond bounds?
> could be an elegant solution so we are not making huge spaces on
> these cards to avoid an overlap of tools. handle it with slightly
> larger space and enhanced visuals so it is clear what is happening"

While prepping for v0.16.19 fusion-drag, Ross spotted the architectural
collision incoming: the existing white-tier hold-radial overlay (~440px
diameter) sprawls across the dashboard, overlapping head-card, dynamic
zone, and interaction-row. Adding fusion-drag on top would compound the
spatial conflict. Solution wasn't "make the cards bigger to contain the
overlay" (would waste vertical space when content is small) but
"make the overlay self-aware of card bounds + give cards more
breathing room."

Two paired changes:

**1. Card sizing — modest, intentional bumps:**

- `.dynamic-zone`: `min-height` 48 → 80, `padding` 8 → 14. Card has
  visible presence even when content is just one flavor line.
- `.interaction-row`: `padding` 10 → 16, internal `gap` 10 → 14, chip
  row `gap` 6 → 10. Brick chips have room to breathe.
- `.dash-brick-chip` (inline styled in `_dashBrickChips`):
  `min-width` 44 → 58, `padding` 6/4 → 9/6, swatch 22×22 → 28×28,
  pip-row `max-width` 40 → 50, swatch margin-bottom 4 → 5,
  border-radius 6 → 8. Brick has the presence of a primary
  interaction surface, not a tiny chip.

This is option-3 from the spec sketch (content-driven, padding/sizing
push the cards larger naturally), NOT option-1 (flex-grow into empty
space). Empty space below the dashboard is fine when content is small;
forcing cards to fill it would feel cramped when content IS large.

**2. Radial fade-beyond-bounds:**

The hold overlay (`_renderAllyRadialFan`, `_renderOptionRadialFan`)
now tests each item's center against the `.interaction-row` bounding
rect. Items inside → opacity 1. Items outside → opacity 0.4. Items
the player is actively targeting (`s.dragTarget`) → always opacity 1
regardless (player is pointing AT it, must be visible).

New helper `_radialHomeBounds()` returns
`document.querySelector('.interaction-row').getBoundingClientRect()`,
or null if not found (no fade applied as fallback).

The fade is per-icon, not gradient. Either inside the card or outside;
binary. Cleanest visual; hard to misread.

The power arc (the SVG curve wrapping the chip) and the central chip
ring stay full-strength regardless of bounds — they're anchored to
the brick and ARE the gesture indicator. Only the radial icons fade.

This communicates layered relationship: "the gesture extends past
the home card, but the dashboard content is still beneath in those
regions." UNITY between tool and content.

---

**Files changed:** `players-core.js`, `players.html`, `test_players.html`,
`NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Brick chips visibly bigger** — more presence, more comfortable
   touch targets.
3. **Dynamic zone has more visual weight** — even just flavor text
   reads as a card, not a thin strip.
4. **Interaction row breathes** — chips have room around them.
5. **Hold a white brick (Fixer test):**
   - Radial fans out as before
   - Allies whose icon centers are INSIDE the interaction-row card:
     full opacity
   - Allies whose centers are OUTSIDE (above or beyond): 0.4 opacity
   - Drag pointer toward an "outside" ally — as it becomes the target,
     it lights back up to full opacity
6. **Hold a gray brick:** option icons get same fade-by-bounds
   treatment.
7. **Power arc stays solid** regardless of where it visually extends.

---

**Risk surfaces:**

- The fade threshold is binary (in/out). For radial layouts where
  many icons land near the boundary, this could feel jumpy. If
  noticeable, switch to a gradient based on distance-from-rect.
  Watch in playtest.
- `.interaction-row` as the "home card" for bounds is correct for
  brick-originated holds. Future fusion-drag from bricks will use
  the same anchor. If hold-gestures get added on chips OUTSIDE
  the interaction-row (unlikely now that coin/cheese/icon use the
  separate hold-resource system), this helper would need
  per-color-target lookup.

---

**Next: v0.16.19 — fusion-drag.**

Pending design questions for v0.16.19 (parking here so the work
doesn't lose context):
1. What does fusion mechanically DO right now? `renderFusion()` is
   a "Coming Soon" stub. Building drag choreography into a
   placeholder = wasted polish. Either:
   (a) Spec the fusion mechanic first, then build drag against it
   (b) Build drag with a v1 "fuse 2 same-color = +1 tier" mechanic
       as starter game design
   (c) Build drag UI that drops into a stub view that still says
       "Coming Soon" but with a draggable target zone
2. Where does the drop happen — into the dynamic zone (showing a
   brick selector for the second ingredient), or onto another brick
   chip directly (immediate fuse if compatible)?

Defer answering until current sizing push is verified clean.

---

**Standards audit (rule #17 — push #38 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #11 (data/runtime/UI separation): characters.js untouched
  (chip sizing is UI, not data); rumble.js untouched. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: tools (radial overlay) and content (cards) coexist
    visually. The fade communicates layered relationship.
  - ELEGANCE: smaller code change than expanding cards to contain
    the overlay would have been. Per-item bounds check is ~6 lines
    of math.
  - EFFICIENCY: cards grow modestly, overlay self-manages —
    neither becomes monstrously large.
- Rule #19 (intuition + UNITY/ELEGANCE/EFFICIENCY): Ross's
  intuition that the elegant fix was "make the overlay aware of
  bounds" rather than "make the cards bigger to fit" was the right
  read. I was about to default to bigger cards.
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. ✓

---

### v0.16.19 — Diagnostic: surface radial-bounds rect to debug missing fade

> "what is determining opacity in radial cuurrently?"

Ross's playtest screenshot (Windows Brave, white-tier hold on Fixer)
shows ally icons clearly OUTSIDE the interaction-row card all rendering
at full opacity — the v0.16.18 fade-beyond-bounds isn't firing. Per
rule #6 (diagnostic-first for non-trivial bugs), this push ships
diagnostic instrumentation to surface what's actually happening BEFORE
guessing at a fix.

**Diagnostics added to existing HOLD DEBUG panel:**

- `_radialHomeBounds()` result displayed inline as
  `L:N T:N R:N B:N` or `NULL (selector miss?)` if the helper returns
  null. Tells us if `document.querySelector('.interaction-row')` is
  finding the element at overlay-render time.

**Visual bounds outline:**

- Yellow dashed rectangle drawn on screen at the bounds rect
  coordinates. Lets us see VISUALLY where the in/out cutoff is and
  compare to where the radial icons actually land.

**What we'll learn from playtest:**

1. If rect is `NULL` → selector mismatch or DOM timing issue.
   `.interaction-row` isn't being found when the radial renders.
2. If rect values are reasonable but icons still don't fade → the
   per-icon math (icon center vs rect bounds) has a coordinate
   issue — e.g. `getBoundingClientRect` returns viewport coords but
   icon positions are in some other system.
3. If the dashed outline visually contains all the icons → the fade
   IS working as written, but we need a different "outside" definition
   (maybe the dashboard-host bounds, not interaction-row).

After Ross reports what the panel shows, the fix is whichever of
the above three.

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: players.html, test_players.html (no UI behavior changes,
only the existing debug overlay gains new fields).

---

**Standards audit (rule #17 — push #39 in S015 continuation):**

- Rule #6 (diagnostic-first for non-trivial bugs): held this push.
  Did NOT speculate at a fix without first surfacing real values.
  The temptation to "probably it's the timing — let me wrap it in
  a setTimeout" was real and rejected.
- Rule #20 (grep duplicates): N/A (no new selectors).
- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only; no HTML changes
  needed. ✓

---

### v0.16.20 — Radial fade by cursor engagement (player-attention-driven)

> "can we fade if cursor is beyond radial bounds instead?"

The v0.16.18 per-icon bounds-fade approach was geometrically correct
but produced an awkward "some icons fade, some don't" pattern (per
v0.16.19 diagnostic) because the `.interaction-row` rect was inherently
shorter than the radial diameter. Icons whose centers landed in the
middle band of the radial were technically inside the rect; icons at
top/bottom of the radial were outside. Visually this read as random.

Ross's reframe is the elegant move: **fade based on cursor position,
not icon position**. While cursor is inside the radial bounds, the
player is still selecting an option — full opacity. When cursor leaves
the radial bounds, the player has visually disengaged — fade the whole
fan together.

This is player-attention-driven instead of geometry-driven. The radial
becomes one visual unit that responds to player intent.

**Changes:**

**1. Per-icon bounds fade removed.** Both `_renderAllyRadialFan` and
`_renderOptionRadialFan` strip their `homeRect` / `inBounds` /
`boundsOpacity` per-icon logic. Icons render at full opacity (with the
existing `isTarget` scale + glow on the active drag target).

**2. `_radialHomeBounds()` helper removed.** Only a brief comment
remains noting why it was removed.

**3. Cursor-distance engagement fade added at `_renderHoldOverlay`.**
- Compute `cursorDist = hypot(s.dragX - s.chipCx, s.dragY - s.chipCy)`
  using the cursor position tracked on every pointermove (works
  whether `isDrag` is true or not — `dragX/dragY` are updated regardless).
- Compare against `RADIAL_ENGAGE_RADIUS = 124` (RADIUS=80 + ICON_SIZE=44).
  Inside → opacity 1.0. Outside → opacity 0.4.
- Wrap the entire fan output in a div with that opacity + CSS transition
  (`opacity .2s ease-out`) so the fade smooths across threshold crossings
  rather than flickering.
- Both fans (ally and option) get the same wrapper.

**4. Chip ring + tier-up pulse stay solid regardless** — they're
"the gesture is active" feedback, not "the options," so they don't
fade with engagement.

**5. v0.16.19 diagnostics removed.** HOLD DEBUG panel returns to its
pre-v0.16.19 form (no bounds rect line). Yellow dashed outline gone.

UNITY: radial is one visual unit, fades together. ELEGANCE: fade
follows player intent. EFFICIENCY: one cursor-distance calculation
per render, not per-icon math × N icons.

---

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: players.html, test_players.html.

---

**Test focus:**

1. Hard refresh.
2. Hold a white brick (Fixer/Snapstep), let radial fan out.
3. **Cursor inside radial:** all ally icons + power arc at full opacity.
4. **Move cursor outside the ~124px radial bound:** entire fan
   (icons + arc) fades to 0.4 together. Smooth transition, no flicker.
5. **Move cursor back inside:** fan brightens back to full.
6. **Drag onto an ally icon:** icon scales/glows; if cursor is back
   inside radial bounds (which it would be while on an icon), full
   opacity throughout.
7. Same behavior with gray brick (option radial).
8. Chip ring + tier-up pulse always full strength.

---

**Standards audit (rule #17 — push #40 in S015 continuation):**

- Rule #6 (diagnostic-first): held in v0.16.19; v0.16.20 is the
  fix shipped against real diagnostic data. Right cadence. ✓
- Rule #19 (intuition + UNITY/ELEGANCE/EFFICIENCY): Ross's
  cursor-based reframe was the elegant read I missed. I had been
  thinking geometry first; the answer was player-intent first.
  Lesson: when a "smart" geometric solution feels off, check if
  there's a player-intent reframing that simplifies it.
- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only. ✓

---

### v0.16.21 — Head-icon pulse: drop-shadow silhouette glow (Image 1 reference)

> "first image for pulse bounds, not the rect in the second image, lets
> adjust all character icons to this behavior"
> "want the drop shadow only, no box shadow for this use case. all other
> functionality for party access should remain for now"

Image 1 reference: Breaker icon with strong orange-red bloom that
follows the sword silhouette — soft halo sized to the icon's actual
shape, not a rectangle around it.

I overcorrected on first attempt: made `.head-icon` a circular container
with `box-shadow` (would have produced a circular halo around a 44px
disc). Ross clarified: just the drop-shadow effect, glowing the icon
silhouette itself. Reverted.

**Final approach:**

- `.head-icon` keeps its original shape (rounded square wrapper, 6px
  border-radius, 2px padding, transparent background). No circle.
- `.head-icon.hold-active`: `filter: drop-shadow(0 0 8px var(--cls-color))
  drop-shadow(0 0 16px var(--cls-color))` — layered drop-shadows for a
  punchier bloom than the v0.16.16 single 6px. Glows the emoji's actual
  silhouette like Image 1.
- `.head-icon.surface-active`: new `head-icon-surface-pulse` keyframes
  using drop-shadow filter (4-10px and 8-20px layered, scale 1→1.04).
  Same rhythm as `chip-surface-pulse` (1.2s ease-in-out infinite),
  different technique to suit the icon-shape glow.
- `.res-chip.surface-active`: unchanged — chips ARE rectangular
  containers, box-shadow halo is the right tool there. Split the v0.16.17
  combined rule so chip and head-icon use separate animations
  (`chip-surface-pulse` for chips, `head-icon-surface-pulse` for icon).

UNITY: same color, same rhythm. ELEGANCE: technique fits each shape —
drop-shadow for icon silhouettes, box-shadow for rectangular chips.
EFFICIENCY: animations isolated; no cross-element styling.

Party access functionality unchanged — hold class icon still invokes
party surface (v0.16.16 behavior intact).

---

**Files changed:** `players.html`, `test_players.html`, `NOTES.md`.

UNTOUCHED: players-core.js (markup unchanged, only CSS), server.js,
rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Tap-and-hold the class icon (head-card avatar) briefly:**
   icon glows in class color following the icon's silhouette
   (sword shape for Breaker, etc.). Strong bloom.
3. **Hold past 400ms (party surface opens):** icon pulses with
   layered drop-shadow at 1.2s rhythm — bloom expands and contracts.
4. **Tap coin or cheese chip and hold:** chip border glows
   class color (rectangular halo via box-shadow — chip-surface-pulse).
   Different visual technique, same color/rhythm. Both look
   intentional alongside each other.
5. **Hold party surface open + watch dynamic zone with .my-turn pulse
   (your turn):** all three pulses (head-icon drop-shadow,
   res-chip box-shadow if open, dynamic-zone .my-turn) coexist
   visually without competing.
6. Party surface still opens correctly on 400ms hold.

---

**Standards audit (rule #17 — push #41 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #19 (intuition): partial drift on first attempt — went to
  "circular container with box-shadow" instead of "drop-shadow on
  existing shape". Ross's clarification course-corrected within
  one iteration. Lesson: when reference image shows a glow, the
  default first read should be drop-shadow (silhouette glow) not
  box-shadow (container halo). They're visually distinct techniques.
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): UNITY in shared color/rhythm
  across pulses; ELEGANCE in technique-per-shape; EFFICIENCY in
  isolated animations.

---

### v0.16.22 — Tuning pass: dim radial-disengaged, halve glow intensity, slow surface pulses

> "1 - radial opacity 0.2; 2 - this should be correct, goal is to have
> half intensity; 3 - lets make 2.3 for pulse duration"

Three numerical tuning adjustments after playtesting v0.16.20 (cursor-
engagement radial fade) + v0.16.21 (head-icon drop-shadow pulse). All
three reduce visual intensity — the system was reading too loud at
v0.16.21 levels.

**1. Radial outside-engagement opacity 0.4 → 0.2.** When cursor leaves
the radial bounds, the fan now dims more aggressively. Reads more
clearly as "you've disengaged from this gesture, options are still
here but de-emphasized." The 0.2 value makes the disengaged state
distinctly muted without being invisible.

**2. Head-icon drop-shadow blur values halved across the board.**
- `.head-icon.hold-active`: layered 8px+16px → 4px+8px
- `head-icon-surface-pulse` keyframes: (4+8 → 2+4) at rest, (10+20 →
  5+10) at peak
- Bloom is still visible and follows the icon silhouette (Image 1
  reference behavior), just at half the glow intensity.

**3. Surface pulse duration 1.2s → 2.3s** for both
`chip-surface-pulse` and `head-icon-surface-pulse`. Slow pulse rhythm
puts these surface-active animations near (but not literally equal to)
the dynamic-zone `.my-turn` 2.4s pulse — close enough to feel like
unified ambient slow-cadence breathing across all three pulse states,
without being synchronized (which would look mechanical).

UNITY across pulse cadence: dynamic-zone `.my-turn` 2.4s, surface-active
2.3s. Three pulses (turn, surface-active chip, surface-active icon)
all in the slow ambient family.

---

**Files changed:** `players-core.js` (one constant), `players.html`
(three CSS rules), `test_players.html` (mirrored), `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Hold a brick, move cursor outside radial:** fan dims to 0.2 —
   distinctly muted but still readable. Move back inside → returns
   to full opacity smoothly.
3. **Hold class icon briefly:** subtle drop-shadow bloom on
   silhouette. Half the intensity of v0.16.21 — feels less aggressive,
   still clearly a glow effect.
4. **Hold past 400ms (party surface opens):** icon pulses with
   gentler bloom at slower 2.3s rhythm. Reads as ambient breathing,
   not insistent flashing.
5. **Hold cheese / coin (surface opens):** chip pulses with same
   2.3s rhythm.
6. **All ambient pulses together** (your turn + party surface open):
   feels like one unified slow-breathing cadence, not three
   competing rhythms.

---

**Standards audit (rule #17 — push #42 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #19 (intuition): direct numerical tuning per spec — no
  speculation, no hedging. ✓
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): all three changes pull
  toward UNITY (slow pulse cadence family), ELEGANCE (less visual
  noise), EFFICIENCY (no architectural change, just numerical tune).

---

### v0.16.23 — Strip coin/cheese chip cards, replace with bare icons matching head-icon vocabulary

> "what if we just got rid of the card altogether for coin and cheese?
> could put numbers below the icon. icon would have its outline shadow
> lit, like we just did with player icon."

Triple-digit values (e.g. coin "122") were overflowing the chip
containers — `.res-chip` with `max-width:90px` was too tight for
3-digit numbers at any meaningful font size. The fix wasn't tighter
sizing but eliminating the chip card entirely. Bare icons with
numbers stacked underneath, each icon a hold-target with the same
silhouette glow vocabulary as the class icon (.head-icon).

**Architectural collapse:**

Stripped from CSS:
- `.res-chip` (the chip container)
- `.res-chip:active`, `.res-chip.hold-active`, `.res-chip.surface-active`
- `.res-chip-glyph`, `.res-chip-num`
- `.res-chip[data-res="gold"] .res-chip-num` color rule
- `.res-chip[data-res="cheese"] .res-chip-num` color rule
- `chip-surface-pulse` keyframes (only used by .res-chip)
- All `flex:1`, `min-width:48px`, `max-width:90px`, padding/gap
  clamps that constrained the chip layout

Added to CSS:
- `.head-resource` — bare flex column container, transparent, no
  border, no background. Just the hold-target wrapper.
- `.head-resource-glyph` — emoji at clamp(18px, 4.5vw, 24px) (slightly
  bigger than old chip glyph since it has more space now)
- `.head-resource-num` — number at clamp(13px, 3.5vw, 18px), color
  per data-res attribute (#F5D000 gold, #FFD96A cheese)
- `.head-icon:active, .head-resource:active` unified scale-down
- `.head-icon.hold-active, .head-resource.hold-active` unified
  drop-shadow bloom
- `.head-icon.surface-active, .head-resource.surface-active` unified
  `head-icon-surface-pulse` animation

Markup (players-core.js _dashHeader):
- `<div class="res-chip" ...>` with `<span class="res-chip-glyph">`
  and `<span class="res-chip-num stat-num">` →
- `<div class="head-resource" ...>` with `<span class="head-resource-glyph">`
  and `<span class="head-resource-num">`
- All onpointerdown / data-res / data-zone-trigger attributes intact.

Finder helpers (`_findCheeseDest`, `_findGoldChipDest`,
`_findCheeseChipDest`):
- Selector switched from `.res-chip[data-res="X"]` to
  `[data-res="X"]` — class-agnostic, durable across future renames.
  Added v0.16.23 comment noting the migration.

Triple-digit numbers fit naturally now because the layout has no
chip box constraining the number's horizontal space. Whatever width
the digits need, they get.

**UNITY across all three header hold-targets:**

Class icon, coin, cheese all now:
- Render as bare icons (no container card)
- Glow with drop-shadow on `.hold-active` (same intensity, same
  layered bloom)
- Pulse with `head-icon-surface-pulse` on `.surface-active` (same
  rhythm, same drop-shadow keyframe values)
- Scale 0.95 on `:active`, 1.05 on `.hold-active`, 1.04 peak on pulse

One vocabulary, three triggers. ELEGANCE.

---

**Files changed:** `players.html`, `test_players.html`, `players-core.js`,
`NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Coin/cheese display:** bare icons with numbers stacked beneath
   in the head-id column. No chip background, no border, no padding
   around them as a card.
3. **Triple-digit values fit:** coin "122" shows cleanly under the
   coin icon without overflow or truncation.
4. **Hold coin or cheese:** drop-shadow bloom on the icon silhouette
   (Image 1 vocabulary), same as holding the class icon.
5. **Past 400ms (surface opens):** icon pulses with `head-icon-surface-pulse`
   at 2.3s rhythm. Class icon, coin, cheese all pulse with same look
   when their respective surfaces are open.
6. **chipPulse arrivals** (gold from coin pickup, cheese from event):
   still hit the icons in their new bare form (finder selectors are
   data-res based, position-agnostic).
7. **No regressions:** market opens on coin hold, cheese options on
   cheese hold, party on class-icon hold. Swipe-to-dismiss works.

---

**Risk surfaces:**

- Bare icons may look TOO bare without the chip background to
  ground them visually. If layout reads as floating-numbers-with-no-frame,
  may want subtle bg restored (lighter than old surface3, just a hint).
- `head-resource-glyph` size went UP (clamp(18, 4.5vw, 24px) vs old
  chip's clamp(14, 4vw, 20)). This was intentional — bare icons can
  be larger since they have more space — but if the icon dominates
  visually over the number, dial back.
- Vertical-stack flex column changes spacing in `.head-resources`.
  May need `gap:6px` or similar adjustment if icons sit too close
  to each other.

---

**Standards audit (rule #17 — push #43 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): big UNITY win — three
  header hold-targets now share one vocabulary. ELEGANCE in the
  removal of three CSS rule groups + one keyframe set. EFFICIENCY
  in not constraining triple-digit numbers (problem solved by
  architecture not by tighter sizing).
- Rule #19 (intuition): Ross's reframe (ditch the card, go bare-icon)
  was the right read. My instinct was to tune `clamp()` values
  tighter — would have technically worked but kept the awkward
  chip-with-cramped-number aesthetic. Architectural collapse beats
  numerical squeeze.
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. Old `.res-chip` references confirmed all comment-only
  (migration history). ✓

---

### v0.16.24 — Strip redundant "Purchased!" confirmation card on market buy

> "get rid of these cards showing purchase, you can see this in
> inventory. inventory should have pulse same as gaining loot from
> event when purchase is made"

The market `buyBrick()` was setting `_pendingResult` to render a
"Purchased! 1 red brick added — spent 🪙1 gold" landing card that
ate vertical space and told the player something they could see in
the inventory. Meanwhile chipPulse + brickGained boardFx animations
were ALREADY firing on the brick chip (per console log: brickGained
at boardFx.js:709, chipPulse at boardFx.js:712).

UNITY: same feedback path for ANY inventory increase, regardless of
source (market purchase, event loot, rumble reward). chipPulse on
the brick chip handles it. No need for a separate confirmation card.

**Change:** removed the `_pendingResult = { ... 'Purchased!' ... }`
block from `buyBrick()` along with the explicit `render()` call.
Server broadcasts updated state on next tick which triggers render
through normal state flow; `_detectInvIncreasesAndPulse` detects the
brick count bump and fires chipPulse with the brick's color. Same
feedback as event-loot gains.

Spent-gold feedback handled implicitly by the gold number visibly
decrementing on the dashboard. Same as how cheese-spend and
brick-spend work — gain → pulse, spend → just number update.

---

**Files changed:** `players-core.js` (one function), `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx, html files.

---

**Test focus:**

1. Hard refresh.
2. Open market (hold coin).
3. Buy a brick (any color you can afford).
4. **Expected:**
   - No "Purchased!" card appears in dynamic zone
   - Brick flies from market to brick row (brickGained animation)
   - Brick chip pulses on arrival (chipPulse)
   - Gold number decrements on the head-resource
   - Brick count on the chip increments
5. **Should NOT see:** confirmation card with "1 red brick added —
   spent 🪙1 gold" text.
6. **No regressions:** event-loot gains (riddles, gold trials, etc.)
   still pulse the inventory. Rumble rewards still pulse.
   _pendingResult still works for actual landing-event resolutions
   (the field hasn't been removed, just no longer set by buyBrick).

---

**Standards audit (rule #17 — push #44 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only — no markup or CSS
  changed. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one feedback path for inventory increases regardless of
    source. Was three (event card, rumble card, market card) →
    now one (chipPulse).
  - ELEGANCE: removed clutter.
  - EFFICIENCY: smaller code, same information conveyed.
- Rule #19 (intuition): trusted Ross's read that the "Purchased!"
  card was clutter, didn't second-guess. Direct strip.

---

### v0.16.25 — Event card containment + post-event themed flavor + armor cap audit

> "need events to fit inside dynamic event card, rubble stacking
> hangs beyond, lets have this responsive to bounds as well as other
> events as well. also, when event is finished, relevant flavor text
> about event just finished shoudl display in dynamic zone, not just
> empty space. flavor pools need depth, and should relate to how
> player did in event. favorable? not favorable? we have a dad joke
> for that and it is themed per event. also, does rumble and board
> agree on max overload HP and max armor per character?"

Three asks, three responses:

---

**1. Event card containment (UI fix):**

`.dynamic-zone` gets `max-height: 340px` + `overflow-y: auto`. Long
event content (Rubble Stacking, Trial of Hand, etc.) now scrolls
inside the bounded card rather than overflowing. Card stays within
layout bounds; content respects them. Min-height 80 unchanged so
short content (one flavor line) still has presence.

Mirrored in test_players.html. Both files.

---

**2. Post-event themed flavor (system + content):**

Added `POST_EVENT_FLAVOR` keyed by `[eventType][outcome]` where
outcome is `'favorable' | 'unfavorable'`. Initial pool: 13 event
types × 2 outcomes × 3 lines = ~78 entries. Voice: dungeon dad-joke
per event, wry post-mortem on what just happened. Examples:
- gray favorable: "You stack the rubble like a true mason. The
  dungeon nods, vaguely."
- gray unfavorable: "The rubble defeats you. Even gravity is
  judging."
- purple favorable: "You picked the right chest. Fate, this time,
  was a friend."
- purple unfavorable: "You picked the wrong chest. Fate is a stern
  teacher."

System scaffolding:
- `getPostEventFlavor(type, outcome)` — random pick from the matching
  pool, returns null if no match.
- `_eventOutcome(ev, myCls)` — per-event-type classification reading
  result fields (`grayRubbleResult.success`, `redResult.winner`,
  `purpleResult.outcome`, `whiteResult.healed`, `greenResult.success`,
  `blackResult.outcome`, `riddleWinner`, `goldAmount`, etc.). Returns
  `'favorable' | 'unfavorable' | 'neutral'`. Neutral falls through
  to ambient flavor (no themed line shown when wash).
- `_lastResolvedEvent` cache: `{ key, type, outcome, line, expiresAt }`.
  Captured on first render where activeEvent is `cls=me` and
  `resolved=true`. Persists 12 seconds (long enough to read, short
  enough to return to ambient before next event).

Render hookup in `_dashDynamicZone` idle slot: prefer
`_lastResolvedEvent.line` over ambient `dashboardFlavor()`. Themed
line styled with class color (favorable) or muted gray
(unfavorable) so player reads it as a verdict, not generic ambient.

**Content depth note:** v1 ships with 3 lines per cell as the
end-to-end-shippable baseline. Real depth (8-12 lines per cell, with
zone-tier variants) is iterative content work. Pool can grow as
playtest reveals which lines land and which fall flat.

**Outcome detection caveats (TODOs in code):**
- monster/boss: heuristic returns favorable always (combat resolved
  ≈ win, but doesn't distinguish flee vs win). Refine when combat
  result fields surface a clear signal.
- gold: relies on `ev.goldAmount > 0`. Works but minimal.
- trap/doubletrap: hardcoded unfavorable. Traps can technically miss;
  refine if hit/miss flag surfaces.

---

**3. Armor cap audit (game-state integrity finding, NOT patched):**

**HP — AGREES.** Single source of truth: `characters.js` `c.hp`
field per class (Breaker=14, Formwright=6, Snapstep=9, Blocksmith=12,
Fixer=8, Wild One=10). Server hardcodes the same values when calling
mkPlayer. Rumble's standalone makePlayer reads
`window.CHARACTERS[cls].hp`. Server passes `p.hpMax` to rumble via
cfg → rumble assigns to `player.hpMax`. All paths trace to
characters.js. ✓

**ARMOR — DISAGREES.** Three different caps in play:
- **Rumble** (`getArmorMax()` in rumble.js:6532):
  Breaker → `floor(hpMax × 0.75)`, others → `floor(hpMax × 0.5)`
- **Server gray-charge action** (server.js:2608):
  cap = `p.hpMax` (full HP, all classes)
- **Server event-bonus armor** (server.js:1707, 1735):
  cap = `floor(hpMax × 0.5)`
- **Dashboard pip display** (players-core.js:940):
  shows `hpMax` slots regardless

**Concrete bug surface:** Breaker leaves dashboard with 14 armor.
Enters rumble. Rumble cap drops to 10 (`14 × 0.75`). 4 pips
disappear in transit. Same applies for any class — server
gray-charges allow up to hpMax armor; rumble caps at half.

**Resolution requires DESIGN DECISION** — which rule is canonical?
- Option A: Rumble cap is intentional combat balance. Server
  gray-charge cap should be lowered to match (`hpMax × 0.5` or
  `× 0.75` for Breaker).
- Option B: Server cap is correct. Rumble should accept up to
  `hpMax` armor.
- Option C: Hybrid — board allows accumulation up to hpMax, rumble
  treats excess as "depletes first" temp armor.

Parking this in NOTES; not patched in v0.16.25. Need design call
before code change.

Same audit done for max overload HP — no separate concept; HP and
hpMax are fully consistent. The "overload" mechanic in rumble is a
brick-charge tier system, not an HP ceiling.

---

**Files changed:** `players-core.js`, `players.html`,
`test_players.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Long event (Rubble Stacking on Breaker red landing):** event
   card now scrolls inside the dz instead of overflowing below it.
   The dz visual stays bounded.
3. **Resolve any event** (gray rubble, riddle, purple choice, etc.):
   - Win/favorable outcome: dz shows themed flavor in class color.
     Example after gray rubble win: "You stack the rubble like a
     true mason..."
   - Lose/unfavorable outcome: dz shows themed flavor in muted gray.
     Example after gray rubble loss: "The rubble defeats you..."
   - Themed flavor persists ~12 seconds, then dz returns to ambient
     FLAVOR_POOL.
4. **Next event arrives:** post-event flavor clears, event card
   takes over.
5. **All event types**: gray, red, purple, white, green, black,
   riddle/yellow, gold, monster, boss, trap, doubletrap, blue. Each
   should show themed flavor on resolution (flavor pool covers all
   13 types).
6. **Armor cap inconsistency**: NOT FIXED. Documented in NOTES for
   design decision. Continue current behavior — rumble caps stay
   in effect, dashboard pip count exceeds rumble cap on Breaker
   etc. Awaiting your call on which rule is canonical.

---

**Risk surfaces:**

- Outcome detection heuristics (monster/boss/trap) may classify
  wrong on edge cases. Watch playtest; refine in subsequent push.
- `_lastResolvedEvent` 12-second window may feel too short or too
  long. Tunable.
- Class-color vs muted-gray styling for favorable vs unfavorable
  may not read clearly enough as a verdict. Could add ✓/✗ icon
  prefix if needed.
- Content depth at 3 lines per cell is thin. Repeats will become
  noticeable with 10+ events per session. Pool growth is the
  iterative path — push more content as playtest exposes which
  lines land.

---

**Standards audit (rule #17 — push #45 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #11 (data/runtime/UI separation): POST_EVENT_FLAVOR is a
  data table, lives in players-core.js alongside LANDING_FLAVOR
  (consistent with existing pattern). `_eventOutcome` is runtime
  classification, near it. Render hookup is UI in `_dashDynamicZone`.
  Right place for each. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: post-event flavor uses same dz-idle render path as
    ambient flavor; just preferred when fresh outcome cached.
  - ELEGANCE: outcome classification is a pure function reading
    existing result fields, no new state on G.activeEvent.
  - EFFICIENCY: 12-second cache window keeps flavor active across
    re-renders without re-rolling each frame.
- Rule #6 (diagnostic-first): N/A — no bug, this is a feature
  build with audit findings reported.
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. ✓
- Rule #10 (don't fragment): handled all three ask items in one
  push. Items (1) and (2) shipped as code. Item (3) reported with
  full findings + design options + parked for your call. ✓

---

### v0.16.26 — Three corrections to v0.16.25 post-event flavor + dz containment

> "no scrolling, make the card fit the data and the data fit the
> card, and event data needs to convert to fit. still seeing blank
> card after event resolutions before DM presses resolve. These
> after event flavor text shoulw come up immediately after loot
> distribution, and persist until next ambient refresh from event
> or other trigger"

Three fixes to the v0.16.25 work:

**1. No scrolling — strip max-height + overflow-y from .dynamic-zone.**

v0.16.25 added `max-height:340px; overflow-y:auto`. Wrong move. The
correct framing is "card fits data, data fits card" — bidirectional
adaptation, not scrolling. Stripped both rules. Card now grows with
content; content compacts itself for the card (see fix #3 below).

**2. Trigger threshold lowered: result fields, not `resolved:true`.**

v0.16.25 detected post-event flavor when `G.activeEvent.resolved`,
which only flips when DM clicks "Mark Resolved." That created the
blank-card window Ross saw — gameplay finished, loot distributed,
but DM hadn't yet clicked the button. Fix: detection runs when ANY
result field is populated (`grayRubbleResult`, `redResult`,
`purpleResult`, `whiteResult`, `blackResult`, `greenResult`,
`riddleWinner`, `riddleExpired`, `goldAmount`, OR `resolved`).
Captures outcome at loot-distribution moment.

New helper `_eventHasResult(ev)` encapsulates this check. Replaces
the `G.activeEvent.resolved` test in detection.

**3. Persistence: cleared event-driven, not time-driven.**

v0.16.25 cleared `_lastResolvedEvent` after 12 seconds. Wrong model.
Per Ross spec: themed flavor persists until the next event starts
or another trigger (e.g. phase change) refreshes ambient. Stripped
the `expiresAt` field and the time-based expiry check. Cache now
clears only when:
- A NEW event of mine starts (different key, no result fields yet)
- The cache key is replaced by a fresh resolution

This means while sitting between turns or waiting for DM, player
keeps seeing the verdict line. UNITY: dz idle slot reads as "the
last thing that happened" until something new happens.

**4. Data fits card: rubble stacking compacted.**

v0.16.25's overflow-scroll hid the symptom. Real fix: make event
content compact enough to fit. Started with rubble stacking (the
event Ross screenshotted overflowing):
- Title font: 18→15px
- Instruction text: 12→11px, condensed
- Timer text: 11→10px, smaller margin
- Canvas: now CSS-scaled via `width:100%; max-width:240px;
  aspect-ratio:5/6`. Internal resolution stays 300×360 (pointer
  math via `getBoundingClientRect` is coord-agnostic), display
  fits dz at ≤240×288px.
- Footer text: 10→9px

Total height compression: the 300×360 canvas plus verbose
chrome was ~440px tall. Now ~310px max — fits dz cleanly.

**Other events not yet compacted** — green vine path, red trial of
hand likely have the same issue. Pattern documented; iterate as
playtest reveals which need attention.

---

**Files changed:** `players-core.js`, `players.html`,
`test_players.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Rubble stacking event:** card now fits inside dynamic zone
   without scroll bar. Canvas visibly smaller (≤240px wide) but
   gameplay works identically.
3. **Resolve any event** (drop the 3rd brick, answer riddle, pick
   chest, etc.):
   - Themed flavor appears IMMEDIATELY after loot distribution,
     not after DM clicks Mark Resolved.
   - Wait — actually the event card itself stays on screen until
     DM resolves. Post-event flavor populates the dz idle slot
     after that. The cache captures the outcome at result-field
     time so it's ready when the slot opens.
4. **DM clicks Mark Resolved:** event card disappears; themed
   flavor appears in dz idle slot.
5. **Player sits between turns:** themed flavor PERSISTS, no time
   expiry. Reads as "the last thing that happened."
6. **Next event starts:** themed flavor pre-empted by event card.
7. **No regressions** to ambient FLAVOR_POOL when no event
   recently resolved (fresh game, first turn, etc.).

---

**Risk surfaces:**

- Other long event cards (green vine path canvas, red trial of
  hand canvas) may still overflow. Watch playtest.
- Canvas CSS scaling on rubble: pointer math should work because
  `getPointerCol` uses `getBoundingClientRect` (DPI/scale-aware).
  If touch precision feels off post-scale, tune.
- `_eventHasResult` checks for `goldAmount` numeric — gold
  variants always set this field on init? Need to confirm; if
  pre-resolution it's already a number, the cache will fire too
  early. Watch playtest — if gold events show post-event flavor
  during the gameplay phase, refine the heuristic.

---

**Standards audit (rule #17 — push #46 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #19 (intuition): Ross's framing ("card fits data, data fits
  card") was the right reframe. v0.16.25 reached for scroll first;
  the intuitive answer was bidirectional adaptation. Rule #19
  reminder: when an "easy" UI fix introduces a scroll bar, the
  layout is probably wrong, not the constraint.
- Rule #6 (diagnostic-first): N/A — these are corrections to known
  v0.16.25 issues with clear specs from Ross. Direct fixes.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: dz idle slot reads "what just happened" until something
    new happens — no arbitrary time gates.
  - ELEGANCE: trigger detection on existing result fields (no new
    server flag), no time logic, no overflow scroll.
  - EFFICIENCY: less CSS, less code, content compacted not capped.

---

### v0.16.27 — Event card hand-off to flavor at result-time + fix gold/blue/trap detection + strip WAITING FOR DM

> "just finished rubble stacking, all fit in card, but no flavor text
> after loot collection, same for red event, gold event different
> resolution - waiting for DM, some flavor text, can get rid of
> waiting for DM, same for yellow event, empty card after look
> collection, on DM resolve the flavor text seems to be populating,
> it ties in to event"

Three layered bugs in v0.16.26 that I missed:

**Bug 1: Cache populated but flavor never displayed before DM resolve.**

v0.16.26 fixed detection threshold (result-fields, not `resolved:true`).
But the EVENT CARD render check still gated on `!G.activeEvent.resolved`,
which kept the event card on screen after loot distribution. The dz
idle slot (where post-event flavor renders) doesn't activate while the
event card is showing. Cache populated correctly; flavor sat unused.

Fix: detection moved BEFORE the event-card render check. New gate
`myEventDoneWithFlavor` on the event-card show condition: when result
fields populate AND a themed flavor cached AND its key matches the
current event, the event card stops rendering and the idle slot picks
up the cached flavor. Falls back to event card if no flavor cached
(neutral outcome) so player isn't left with nothing.

Architecturally cleaner: the event card is for ACTIVE gameplay. Once
gameplay completes (result fields populate), the post-event flavor
takes over. DM still sees the event in the landing-events panel until
they Mark Resolved — that's their separate workflow. UNITY: one player-
facing render path for "event done."

**Bug 2: `_eventHasResult` used wrong gold field.**

v0.16.26 used `typeof ev.goldAmount === 'number'` as the gold trigger.
But `goldAmount` is set at event CREATION (server.js:1140, 1397, 2416),
not at resolution. So the gold-event flavor cache fired immediately
when the event spawned, not after the player searched.

Fix: switched to `ev.goldResult` (server.js:1638 — set when gold
gameplay completes). Same pattern applied to:
- `_eventOutcome.gold`: now reads `goldResult.amount` instead of
  `goldAmount`. Rat bite case (amount=0) properly classifies as
  unfavorable.
- `_eventOutcome.trap`: now reads `trapResult.missed` for favorable
  case (trap missed), falls through to unfavorable default.
- `_eventOutcome.blue`: now reads `blueResult.success` instead of
  always-favorable default.

Full result-field roster in `_eventHasResult`: `grayRubbleResult`,
`redResult`, `purpleResult`, `whiteResult`, `blackResult`,
`greenResult`, `goldResult`, `blueResult`, `trapResult`,
`riddleWinner`, `riddleExpired`, `resolved`. Matches the server
event-cleanup whitelist at server.js:2365.

**Bug 3: "WAITING FOR DM" footer text was redundant.**

Two render sites:
- `players-core.js:5524` — gold-game finish container
- `players-core.js:6741` — buildResolutionCard else branch

Both stripped. The dz idle slot now carries the "waiting" beat through
themed flavor — explicit "WAITING FOR DM" text was clutter alongside
the verdict line.

---

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, html files, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Gray rubble:** stack the bricks. The instant the last brick locks,
   loot distributed, themed flavor should appear in dz (replacing the
   event card). DM panel still shows event in landing-events (for DM
   to Mark Resolved). DM clicks Mark Resolved → no visible change on
   player dashboard (already showing flavor).
3. **Red trial of hand:** complete the trial. Same pattern — event
   card replaced by themed flavor immediately on result, not after DM
   resolve.
4. **Gold mini-game (search/torch):** search succeeds → "Coins jingle
   in your pocket..." (favorable). Rat bite case (found nothing AND
   took damage) → "The coins were fool's gold..." or similar
   (unfavorable). No "WAITING FOR DM" footer.
5. **Yellow riddle:** answer correctly → "Knowledge unlocked..."
   (favorable). Wrong answer → "The riddle outlasted you..."
   (unfavorable).
6. **Blue arcane shrine:** brick obtained → favorable flavor. Failed
   memory challenge → unfavorable.
7. **Trap:** if trap missed (lucky) → favorable. Otherwise unfavorable.
8. **Persists:** themed flavor stays through DM resolve, between turns,
   until next event of mine starts.

---

**Risk surfaces:**

- Outcome detection still has heuristic gaps:
  - monster/boss always returns 'favorable' (no result-field signal
    for win vs flee yet)
  - white shrine assumes `whiteResult.healed` truthy = favorable,
    falsy = unfavorable — may need refining if white has multiple
    sub-outcomes
- Event-card hand-off relies on themed flavor being CACHED. If
  outcome is 'neutral' (no flavor available), event card stays up.
  This is intentional fallback but worth noting — neutral cases
  show empty event card body until DM resolve.
- The `myEventDoneWithFlavor` check requires the cache key to match
  current event key. If cache was populated for event A and event A
  is somehow re-used or restated, edge-case behavior unknown. Watch
  for weird cache stickiness in playtest.

---

**Standards audit (rule #17 — push #47 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only — no markup or CSS
  change. ✓
- Rule #6 (diagnostic-first): lessons learned. v0.16.25 + v0.16.26
  shipped detection logic without testing the ACTUAL render path
  (assumed cached flavor would just appear). v0.16.27 fixes the
  render path AFTER playtest revealed the cache wasn't being
  consumed. Better to have shipped a diagnostic in v0.16.25 to
  confirm the cache-to-render path worked end-to-end before
  declaring done. This is the same diagnostic-first lesson that
  should have caught v0.16.18's geometric fade issue earlier.
- Rule #19 (intuition): partial drift. The "post-event flavor"
  concept seemed straightforward (cache outcome → render in idle
  slot) but the gating logic between event-card and idle-slot
  needed careful thought up front. Should have traced the full
  render path mentally before coding.
- Rule #11 (data/runtime/UI): held. Fixed gold/trap/blue field
  reads in `_eventOutcome` (data/runtime), gating in
  `_dashDynamicZone` (UI). Right separation. ✓

---

### v0.16.28 — Park events-overhaul plan + red-outcome detection bug

> "rubble stacking deferred until events overhaul? what is your take"
> "add to parking lot what we were discussing about events"

Confirmed in v0.16.27 playtest:
- Post-event flavor pipeline working end-to-end (rubble → flavor at
  loot-distribution; trial of hand → flavor at win moment).
- Red trial outcome detection BUG: "BREAKER WON" on DM panel but
  Breaker dashboard showed unfavorable flavor. `ev.redResult.winner`
  field read suspect — server may use different field name.

Per "wrap with players first, events overhaul later": parked the
events-system overhaul plan in NOTES.md parking lot. Captures:
- Current architecture (4-5 nested containers per event, reinvented
  per type)
- Proposed unified `EventCard` + body-slot pattern
- UNITY/ELEGANCE/EFFICIENCY wins
- Tech debt the overhaul absorbs (rubble sizing, other canvases,
  outcome detection refactor, red field-name bug)
- Defer-until criteria

NOTES-only push. No code changes.

---

### v0.16.29 — Fusion placeholder: drag any brick to dynamic zone

> "fusion should do nothing but initate the placeholder for now:
> Fusion coming soon... - dad joke flavor text pool - you just
> cannot wait to get stronger, that sort of thing. Drag drop brick
> in dz, opens card/space with some flair, colored to brick you
> dragged in and giving flavor text plus coming soon"

Wires the drag-to-fuse gesture for ALL brick chips (not just
white/gray). Drop on dz opens a colored coming-soon placeholder
with themed dad-joke flavor. Mechanic itself ships later — this is
scaffolding so the gesture has a real destination during playtest.

**Brick chip pointer-down: now wired for all colors.**

Previously only white/gray had `onpointerdown="_holdStart(...)"`.
Other colors were inert (`cursor:default; opacity:.85`). v0.16.29:
all colors get the handler, normal cursor, full opacity. Visual
parity across all bricks since they're all draggable now.

**`_holdStart` branches internally on eligibility:**

- `radialEligible` = (color is white or gray) && charged ≥ 1 →
  hold-without-drag opens the radial fan (existing white/gray
  ally-target / option-target action).
- `fusionEligible` = owned ≥ 1 (any color) → drag-and-drop on dz
  opens fusion placeholder.
- Aborts only if NEITHER (no charges AND no inventory of this color).

**Drag-over-dz detection in `_holdMove`:**

Walks pointer element to detect `.dynamic-zone` ancestor. Sets
`s.overDz = true` while dragging over dz with `fusionEligible`.
Toggles `.fusion-drop-target` class on the dz element — CSS
highlights with brighter border + soft white glow as the drop
zone affordance.

**Fusion drop branch in `_holdUp`:**

NEW first branch: if `s.isDrag && onDz && s.fusionEligible` →
clean up drop-target class, end hold state, fire
`_openFusionPlaceholder(s.color)`. Takes priority over other
release routing because dz drop is intentional.

**`_openFusionPlaceholder(color)`:**

Sets `_fusionColor = color` and `_zoneState = 'fusion'`, triggers
render. The dz idle slot picks up via `_renderZoneSurface` ('fusion'
case → `_renderZoneFusion(me, color)`).

**`_renderZoneFusion(me, color)`:**

Renders a coming-soon placeholder card:
- Border in the brick's color (BRICK_COLORS table)
- Title "⚗ FUSION" in matching color
- Centered colored brick swatch with bloom glow + subtle
  scale-pulse animation (`fusion-bloom` keyframes, 2.3s rhythm,
  joins the slow ambient family)
- Color name (e.g. "RED BRICK") under the swatch
- One line of themed flavor (random from `FUSION_COMING_SOON_FLAVOR`)
- "FUSION COMING SOON…" footer

**`FUSION_COMING_SOON_FLAVOR` pool:**

12 lines, dad-joke voice per Ross spec ("you just cannot wait to
get stronger"). Examples:
- "You just cannot wait to get stronger."
- "Brick + brick = bigger brick. The math works. The mechanic is pending."
- "The dungeon\'s blacksmith is on a coffee break. Try again later."

Pool grows as content depth accrues.

**Hold-overlay render gates updated:**

- Chip ring: now gated on `s.radialEligible` (was unconditional).
  Non-radial chips show no overlay during hold-without-drag.
- Tier-up pulse: now gated on `s.radialEligible`.
- Radial fan render: now gated on `s.radialEligible`.
- NEW: fusion drag ghost — small colored brick at pointer position,
  visible during any drag (`s.isDrag && s.fusionEligible`),
  rotated slightly with shadow + colored glow. Communicates "the
  brick is following your cursor."

**Dismiss paths clear `_fusionColor`:**

`_dismissDynamicZone`, event-priority reset, surface-render fallback
all set `_fusionColor = null` alongside `_zoneState = 'idle'`.

**Existing white/gray hold-radial behavior unchanged.** Hold without
dragging on white/gray chip still opens the ally/option fan as
before. Drag from white/gray to dz also triggers fusion placeholder
(inclusive — white/gray bricks can also be fused).

---

**Files changed:** `players-core.js`, `players.html`,
`test_players.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Tap or hold any non-action color (red, blue, green, etc):**
   chip is now visually active (no `.85` opacity). Hold without drag:
   nothing happens visually (no chip ring, no fan). Tap and release:
   silent.
3. **Drag any brick chip toward dz:** colored ghost brick follows
   cursor. dz border brightens to white when ghost is over it.
4. **Drop on dz:** placeholder card opens — colored in brick's
   color, "⚗ FUSION", brick swatch with bloom, "RED BRICK" label,
   one flavor line, "FUSION COMING SOON…" footer.
5. **Different color, drop:** placeholder re-renders in new color.
6. **Swipe right on dz:** placeholder dismisses (existing dismiss
   gesture).
7. **No regressions:** white hold-radial (Fixer) still opens ally
   fan. Gray hold-radial still opens shield options. Tap-to-fire
   still works on white/gray. Hold timing unchanged.

---

**Risk surfaces:**

- `_holdStart` continues even with 0 charges if `fusionEligible`.
  Means non-radial chips with 0 inventory still abort (good), but
  white/gray with 0 charges and ≥1 owned will enter hold state.
  Radial doesn\'t render (gated), but the chip ring is also gated
  now, so it should be silent. Watch for any cosmetic side effects.
- The drag-to-dz detection uses `.fusion-drop-target` class on the
  dz element. If the dz element is replaced mid-drag (re-render),
  the class is lost. Should be rare in practice but worth watching.
- Drop on dz while a hold-radial fan is showing (white/gray with
  charges, dragged off-radial) should still trigger fusion. The
  routing in `_holdUp` checks dz BEFORE ally/option/chip — fusion
  takes priority. White/gray can be fused.
- Fusion placeholder re-render on second drop replaces the color.
  Real fusion will need 2-brick staging — out of scope for v1.

---

**Standards audit (rule #17 — push #48 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html + test_players.html ✓
- Rule #11 (data/runtime/UI): UI only — no server changes, no
  characters.js changes. Mechanic punted to mechanic-spec session.
  Right scope. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: all bricks share gesture vocabulary now. Hold-radial
    is the special case (white/gray); fusion-drag is the universal.
    Joins the fusion-bloom 2.3s ambient pulse family.
  - ELEGANCE: branched `_holdStart` rather than parallel handler;
    one state machine; placeholder reuses `_zoneState` cascade.
  - EFFICIENCY: minimal new code (one new state, one new renderer,
    one flavor pool, one keyframe).
- Rule #19 (intuition): held — Ross's "drag any brick to dz" was
  the right shape. I almost over-architected with two-handler
  approach; folding into `_holdStart` is simpler.
- Rule #6 (diagnostic-first): N/A — this is feature work, not bug
  fix. Watch playtest for unexpected gesture interactions.
- Rule #20 (grep duplicates): touched selectors verified to appear
  exactly once. ✓

---

### v0.16.30 — Fusion drag works for ALL colors + cancelled-drag flavor pool

> "works great, but not for every brick color. gray and white do not
> trigger - do we just work on this later, or is it something that
> will benefit us down the line to solve now?"
>
> "only treat as fusion intent when released inside dz, otherwise
> the action is cancelled...maybe some flavor pool for this as well,
> cancelled flavor pool, the brick slips out of your fingers, caught
> it just before it shattered, oops!, something silly, dad joke"

Two coupled fixes from v0.16.29 playtest:

**Bug 1: Gray/white drag-to-fuse never reached the dz.**

Root cause: for radial-eligible chips, the hold overlay (radial fan
icons + arc SVG) renders over the dz with `pointer-events:auto`.
When player drags from white/gray and releases over the dz, the
elementFromPoint check finds an overlay element FIRST, never reaching
the dz beneath. So `releaseEl.closest('.dynamic-zone')` returns null
even though the cursor is visually over the dz.

Fix: when first elementFromPoint check fails to find dz AND the
gesture is a drag, do a SECOND check with the overlay temporarily
hidden via `display:none`. The second check sees what's actually
underneath. Restore display immediately. One-frame visual blip is
imperceptible (overlay is removed at `_holdEnd` in the fusion-drop
branch anyway).

Falls through naturally for non-radial chips (no overlay exists,
first check works as before).

**Bug 2: Drag released outside dz was silent.**

Per Ross spec: drag-to-anywhere-but-dz should cancel WITH flavor,
not silently. New `FUSION_DRAG_CANCEL_FLAVOR` pool — 15 lines of
"oops, slipped" dad-jokes:
- "The brick slips out of your fingers."
- "Butterfingers. The fortress has seen worse."
- "The brick winks at you and returns to your inventory."
- "You ALMOST fused it with the floor. Close one."

New `_holdUp` branch fires AFTER fusion-drop check fails:
```
if (s.isDrag && s.fusionEligible && offValidRadialTarget) {
  toast(cancelLine, 'warn');
  _holdEnd(true);
  return;
}
```

`offValidRadialTarget = !onAlly && !onOption && !releasedOnOwnChip`
— ensures we don't intercept legitimate ally-target / option-target
release for radial-eligible chips. If white/gray drag releases on
an ally icon, existing radial routing fires; if it releases in
dead space, cancel-flavor fires.

Released-on-own-chip stays silent (user effectively cancelled their
own drag by returning to start — no need for "you fumbled" flavor
when they brought the brick home).

---

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, html files,
boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Gray brick (Breaker red, has charges):** drag to dz → fusion
   placeholder opens, gray-colored. Release over dead space →
   cancel flavor toast appears.
3. **White brick (Fixer):** drag to dz → fusion placeholder opens,
   white-colored. Release on ally icon → existing heal still works.
   Release in dead space → cancel flavor toast.
4. **Red/blue/etc. (non-radial):** drag to dz → fusion placeholder.
   Release in dead space → cancel flavor toast (was silent before).
5. **Tap radial-eligible chip without drag:** existing tier-1 action
   fires. (No regression.)
6. **Hold radial-eligible chip without drag, release on radial
   target:** ally heal / gray option fires. (No regression.)
7. **Cancel flavor variety:** drag-cancel multiple times, see
   different lines from the 15-line pool.

---

**Risk surfaces:**

- The temporary overlay hide on elementFromPoint may briefly cause a
  paint flicker. Should be imperceptible (one frame), but if visible
  in playtest, alternative is `document.elementsFromPoint` (plural)
  which returns the stack — pick the first non-overlay match.
- `toast` function exists (line 8108) but its visual style for
  `'warn'` type is generic. Cancel-flavor toasts may want a softer
  tone. Tunable later.
- 15-line pool is reasonable depth for v1; can grow if cancels
  become frequent in playtest.

---

**Standards audit (rule #17 — push #49 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only — no markup or CSS
  changes. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: gray/white now share the same drag-to-fuse vocabulary
    as other colors. No more "fusion only works for some bricks"
    inconsistency.
  - ELEGANCE: overlay-hide trick is one block, three lines, one
    purpose. Cancel flavor uses existing toast infrastructure.
  - EFFICIENCY: no new state, no new render paths.
- Rule #19 (intuition): held — Ross's read that "released outside
  dz = cancel with flavor" was the right shape. I almost left
  silent-cancel as fallback for radial chips; folding cancel-flavor
  into the universal drag path is the unified answer.
- Rule #6 (diagnostic-first): N/A — bug root cause was clear from
  reading the code (overlay z-order interception). Direct fix.
- Rule #14 (UNITY): big win this push. Per Ross's "is it something
  that will benefit us down the line to solve now?" — yes. Solving
  it now means future fusion-mechanic work doesn't inherit a
  "some bricks fuse, some don't" arbitrary inconsistency.

---

## Design Parking Lot

Captured ideas, design provocations, and "ponder while we build" threads
that don't fit a current chunk but should not be lost. Each entry includes
the seed idea + initial design unpacking so future sessions can pick up
without starting cold. When an idea is ready to build, move it to a chunk
in the relevant build's roadmap section.

### Unified board FX system — particle/text vocabulary across all colors (logged S015 v0.15.25)

**Seed:** v0.15.25 shipped a one-off gray-crit FX (particle burst +
rising flavor text at the shield bar, replacing the legacy blue popup).
White already has its own particle effects on the board for healing
events. Other colors will need similar feedback as their board
mechanics flesh out — but right now there's no shared vocabulary or
infrastructure for it. Each new effect would be built ad-hoc, drift
apart, and create another v0.15.25-style cleanup later.

**The case for unification:** every color is going to need a way to
express on-board moments without the legacy "Continue →" popup
friction. Crits, special outcomes, status applications, healing,
protection events, etc. The visual language should be:
* **Color-coherent** (each color reads instantly as that color's family)
* **Friction-free** (no clicks, just visual feedback that fades)
* **Anchored to context** (FX appears at the relevant UI element, not
  some random screen position)
* **Composable** (particles + text + glow + ring as building blocks
  that any color can pick from)

---

**Architectural skeleton (proposed):**

A small FX module in players.html (and mirrored to test_players.html)
exposing primitives:

```js
// Spawn N particles in a burst from an anchor element
fxParticleBurst(anchorId, { color, count, distRange, duration, gravity });

// Rising/fading flavor text above an anchor
fxFloatText(anchorId, label, { color, duration, riseDistance });

// Pulsing glow ring around an anchor (e.g., HP bar on heal)
fxPulseRing(anchorId, { color, duration, expandTo });

// Color tint flash on an element (e.g., shield pip flash)
fxColorFlash(anchorId, { color, duration });
```

Color-coherent palette per family (drawn from existing BRICK_COLORS):
* red — `#E24B4A` particles, white-hot tail
* orange — `#F57C00` shrapnel, sparks
* yellow — `#F5D000` motes, slow drift
* green — `#1D9E75` glow, organic pulse
* blue — `#4db8ff` shimmer, water-like
* purple — `#7B2FBE` arcane sparks, faster
* white — `#EFEFEF` light motes (current heal FX is the prototype)
* gray — `#AAAAAA` dust/spark (current shield-crit FX is the prototype)
* black — `#552288` (purple-tinged) wisp/smoke

Each color picks 1-2 primitives appropriate to its identity. Not every
color uses every primitive — black might lean glow + smoke, yellow
might lean motes + text, etc.

---

**Anchor system:**

Standard DOM IDs on key player UI elements so any FX can target them:
* `#my-hp-bar` (heal events, damage, HP changes) — already exists
* `#my-shield-section` (gray events) — added in v0.15.25
* `#my-shield-pips` (specific pip-level FX) — added in v0.15.25
* `#my-brick-bar` (cast events on bricks)
* `#my-stats-row` (gold/cheese gains)
* Per-brick chip element (color-specific cast feedback)

Each FX call takes an anchor ID and computes positions relative to its
rect. Skips silently if anchor isn't visible (player on different tab).

---

**Migration path when this lands:**

1. Extract the v0.15.25 `showGrayCritFx` into the shared `fxParticleBurst`
   + `fxFloatText` primitives. Gray-crit becomes a thin caller.
2. Audit existing white heal FX, refactor to use the same primitives.
3. Add color-specific helpers (`grayCritFx`, `whiteHealFx`, `redCritFx`,
   etc.) as thin wrappers that pick the right primitive cocktail per
   color's identity.
4. Replace remaining `_pendingResult` popup paths that don't add
   information (audit each `_pendingResult = ...` site to decide if it's
   informational or noise).

**Decision deferred to:** when 2+ additional colors need on-board FX
beyond what white/gray already have. At that point, the cost of
building the unified system is justified by the savings on those
colors. Until then, gray-crit and white-heal stand as independent
prototypes.

**Current state:** v0.15.25 gray-crit FX is INTENTIONALLY one-off. Not
DRY-extracted yet. When this parking-lot entry activates, it absorbs
that code into the shared system.

### Debug overlay toggles in waves-debug panel (logged S015, ready to build)

**Seed:** developer diagnostic overlays (`yellowDiag`, future class-sig
diagnostics) currently render unconditionally during playtest. They
served their initial debug purpose but now leak into normal play
feedback. Need a way to gate them on/off without code changes.

(`redDashDiag` was the original example here — removed entirely in
v0.15.26 since red dash work is shipped and the diag overlay was no
longer wanted, even gated. Future class diagnostics shipped during
active development should follow the same lifecycle: start as a
diagnostic during the build, then EITHER remove entirely OR add to
this toggle system once the work is done.)

**Existing infrastructure:** rumble_test.html already has a working
debug-panel system anchored to a circular icon at the bottom-left
viewport gutter (`#waves-debug-icon`, ~line 348). Tap → panel
(`#waves-live-debug`, ~line 383) expands upward, anchored to arena
bounds. Updated each frame by `updateLiveDebug()` (~line 1419) which
reads from `Rumble.getDebugInfo()`. Panel uses a clean class
vocabulary (`.lbl`, `.val`, `.hi`, `.warn`).

**Design:**

Add a section to the debug panel with toggle checkboxes for each
diagnostic overlay. Each toggle writes to a flag namespaced under
`window.DBG_FLAGS` (or similar), and the rendering code in rumble.js
checks the flag before drawing. Defaults: all OFF — debug overlays
are opt-in. State persists in localStorage so it survives reloads.

Flags to add (initial set):
* `DBG_FLAGS.yellowConfuse` — gates the yellow confuse diagnostic
  shipped in v0.15.18 (`yellowDiag` rendering in rumble.js)
* Reserve namespace pattern for future class diagnostics (e.g.
  `DBG_FLAGS.orangeChainNetwork`, `DBG_FLAGS.blueDropPoint`, etc.)

Pattern in rumble.js render path:
```js
if (window.DBG_FLAGS && window.DBG_FLAGS.yellowConfuse && yellowDiag) {
  // existing yellow diag render code
}
```

UI in panel (HTML structure):
```html
<div class="dbg-toggles">
  <h4>Debug Overlays</h4>
  <label><input type="checkbox" data-flag="redDashOverlay"> Red dash trajectory</label>
  <label><input type="checkbox" data-flag="yellowConfuse"> Yellow confuse state</label>
  <!-- future toggles append here -->
</div>
```

Wire-up (in updateLiveDebug or a one-time init):
```js
panel.querySelectorAll('input[data-flag]').forEach(function(cb) {
  var flag = cb.getAttribute('data-flag');
  // Initial state from localStorage
  var saved = localStorage.getItem('dbg.' + flag) === '1';
  cb.checked = saved;
  window.DBG_FLAGS = window.DBG_FLAGS || {};
  window.DBG_FLAGS[flag] = saved;
  cb.addEventListener('change', function() {
    window.DBG_FLAGS[flag] = cb.checked;
    localStorage.setItem('dbg.' + flag, cb.checked ? '1' : '0');
  });
});
```

**Architectural notes:**

* Flag-gating only — overlay code itself unchanged, just wrapped in a
  conditional. No behavior changes when flags are OFF beyond hiding
  the visualization.
* localStorage key prefix `dbg.` keeps the namespace clean. Could use
  a single JSON blob if the count grows past ~10.
* Panel currently anchors to arena bounds. Toggle section should sit
  in a fixed position within the panel so it doesn't shift as live
  diag info updates.
* Consider grouping toggles by category (Cast diagnostics / Movement /
  AI / etc.) once the count grows past 5-6.

**Net diff estimate:**
* rumble_test.html: ~30 lines (CSS for toggle section + HTML markup +
  init/wire-up code)
* rumble.js: ~10 lines (wrap each diag overlay render in `if
  (window.DBG_FLAGS && window.DBG_FLAGS.X)`)

**Test focus:**
1. Open debug panel via icon. Verify toggle section appears.
2. All toggles default OFF. Red dash and yellow confuse overlays
   should NOT show in normal play.
3. Toggle red dash overlay ON → diag overlay reappears on next dash.
4. Reload page → toggle state preserved (localStorage worked).
5. Toggle OFF → overlay disappears immediately on next render.
6. Verify no console errors when flags are missing or undefined
   (defensive `window.DBG_FLAGS && ...` checks hold up).

**Decision deferred to:** ready to build. Next chat task after
gray-crit diagnostic.

### Spike aura → fusion-gate candidate (logged S015 v0.15.22)

**Seed:** the existing orange spike aura (currently the overload-no-drag
path: `fireOverloadOrange` else-branch creates `orangeAura` on player) is
mechanically interesting but has no clear class home in the new
trap-as-signature model. SS's orange identity is now the chain-trap
network — explicitly traps in the world, not auras attached to player.

**Question parked:** does the spike aura become a **fusion gate**
unlockable rather than a class-baseline mechanic? Fusion candidates:
* Orange + red + something → "kinetic shroud" (the existing aura model,
  enabled via fusion pattern, available to any class that can fuse it)
* Orange + yellow → "deterrent halo" (slows attackers + reflects damage)
* Orange + gray → "spiked armor" (charges convert to armor when struck)

**Current state:** aura code stays in place (no removal). It's still
reachable via overload-orange-no-drag and works as a self-targeted
defensive option for any class. Just no longer counts as SS signature
identity. Future fusion work can claim it cleanly.

**Decision deferred to:** 0.16.5 Fusion slot when the grid-skill system
lands. At that point, decide whether aura becomes a fusion-only mechanic
(remove from baseline cast paths) or stays as both (baseline + fusion
buffs).

### Fusion system — 3x3 grid skill creation (logged S015 v0.15.5)

**Seed:** the universal skill-creation system. A 3x3 grid is the canvas
where players arrange colored bricks in patterns to create new passive
and active skills. Every domain — offense, defense, utility, mobility,
healing, status, environmental — gets expressed as fusion combinations.
Armor is one lane within this system, not the whole system.

The 0.16.5 Fusion slot (per S014 handoff) is where this lives. Class
Identity at the brick-bar level (0.15.0 / 0.16.0) builds the *baseline*;
fusion is where players go beyond baseline and create their personal
build. Step-changes from fusion is what the v0.15.0 tier-curve
compression reserves headroom for.

**Architectural skeleton:**

* **The grid:** 3x3 cells, 9 slots. Each slot holds one brick of a single
  color. Empty cells valid for many patterns.
* **The pattern grammar:** which arrangements of filled cells count as a
  recognized fusion. Lines, corners, diagonals, plus, diamond, square,
  frame, full — each pattern maps to a category of effect.
* **The color language:** the brick colors filling those cells determine
  the *kind* of skill. Same pattern + different colors = different skills.
* **Class identity overlay:** which patterns a class can recognize, what
  bonuses they get on certain colors, what cost discounts apply.

**Pattern → effect category mapping (initial sketch):**

| Pattern | Cells | Effect category |
|---------|-------|-----------------|
| Single | 1 | Augment (small modifier) |
| Line (row/col) | 3 | Direct effect of dominant color |
| Diagonal | 3 | Reflect / redirect — kinetic recoil |
| Corners | 4 | Coverage — affects in all directions |
| Plus | 5 | Burst — radial single-trigger effect |
| Diamond | 4 | Surround — defensive/positional |
| Square | 4 | Compact — small but durable buff |
| Frame | 8 | Aura — sustained zone effect |
| Full | 9 | Transformation — temporary form change |

These are starting hooks, not locked. Each maps loosely to "what does the
*shape* feel like" — diagonals deflect because they're vectors, plus
because it's radial, frame because it bounds a space.

---

### Color language — thoughts per color and per class

Each color has a domain it expresses. Fusion lets these domains combine
in unexpected ways. Below is a primer for how each color *could* read
inside the fusion system, and how each class might naturally bend that
expression. These are seed notes for design, not commitments.

**RED (impact, motion, attack)**
* Solo fusion: kinetic skills — dashes, charges, impact AOEs
* Per class: BK = body-check spike (line + 3 red = lunge with knockback);
  SS = phase-step (diagonal + red = teleport-strike); FW = projectile
  red (red + purple = magic bolt instead of charge)
* Pairs naturally with: gray (armored charge), orange (trap-charge),
  yellow (confusing strike)

**GRAY (defense, structure, persistence)**
* Solo fusion: pure armor patterns (the "armor lane" sketched in
  earlier entries — typed resist, nullification, healing redirect)
* Per class: BS = unlocks advanced patterns + cost discount; BK =
  spike-shield (gray + red corners = damage attackers on contact);
  FX = healing armor (gray + white = HP regen while equipped)
* Pairs naturally with: every color (gray is the universal binder —
  "stability for the volatile color")

**WHITE (heal, restore, support)**
* Solo fusion: regen patterns — slow heal over time, HP cap raise,
  cleanse on tick
* Per class: FX = unlocks ally-targeted fusion (white frame = party-wide
  aura); BK = self-heal-on-hit (white plus = small heal per impact);
  WO = poison-cleanse on tick (white + green = nullify own poison stacks)
* Pairs naturally with: black (drain becomes heal), red (combat regen),
  gray (durable healing armor)

**BLUE (slow, control, magic)**
* Solo fusion: slow zones, freeze-on-hit, time-skew effects
* Per class: FW = unlocks projectile fusion (blue line = magic missile);
  SS = slow-immune diamond (blue diamond = SS becomes immune to slows);
  BS = wall-slow (blue + gray = walls slow attackers)
* Pairs naturally with: purple (control + AOE = mass freeze), white
  (slowed enemies heal you), green (slow-bleed combo)

**PURPLE (AOE, magic, displacement)**
* Solo fusion: zones — AOE blast, teleport pads, area denial
* Per class: FW = unlocks rare patterns (signature class — full grid
  unlocks at lower cost); BK = "shoulder slam" (purple plus + red =
  knockback AOE); WO = poison cloud (purple + green = AOE poison)
* Pairs naturally with: blue (control AOE), black (curse zone), yellow
  (confusion AOE)

**BLACK (curse, drain, sacrifice)**
* Solo fusion: drain effects, witherbolt enhancement, life-steal
* Per class: FW = curse signature (Scholar's Eye — black cost halved);
  FX = bargain master (black for healing); BK = pain-channel (black +
  red = damage taken increases damage dealt)
* Pairs naturally with: white (drain heals you), green (poison-curse),
  red (blood for power)

**GREEN (poison, growth, decay)**
* Solo fusion: poison stacks, viral spread, slow rot
* Per class: WO = signature unlock (viral patterns at half cost);
  FX = poison conversion (green + white = poison damage heals); BK =
  weaponized poison (green + red = poison weapon)
* Pairs naturally with: yellow (stat debuff stack), purple (cloud),
  black (necrosis)

**YELLOW (confuse, distract, taunt)**
* Solo fusion: enemy AI manipulation — confuse, redirect, taunt zones
* Per class: BS = signature unlock (taunt patterns); WO = whistle
  pattern (yellow + green = beast call); SS = phase-confuse (yellow +
  red diagonal = enemies miss the next attack)
* Pairs naturally with: green (debuff stack), blue (control mind),
  orange (confused enemies trigger traps)

**ORANGE (trap, environmental, damage-over-zone)**
* Solo fusion: trap variants, sustained zone damage, terrain shaping
* Per class: SS = trap-chain signature (orange line = connected traps);
  BS = wall-trap fusion (orange + gray = walls explode on break); BK
  = explosive lunge (orange + red = trap-laying dash)
* Pairs naturally with: red (lay-and-charge), green (poison floor),
  yellow (confusion mine)

---

**Class identity in fusion (mechanism, not just flavor):**

Each class gets:
1. **One signature color domain** they unlock advanced patterns in
2. **One cost discount** for fusions matching their signature affinity
3. **One unique pattern** unavailable to other classes (signature
   passive, e.g. FW's "signature spell page")

Class signature mappings (matches existing affinity from characters.js):

* Breaker (red, gray) — body-check signatures, spike-armor patterns
* Formwright (blue, purple, black) — projectile + zone + curse signatures
* Snapstep (orange, red) — trap-chain + phase-step signatures
* Blocksmith (gray, yellow) — armor mastery + taunt signatures
* Fixer (white, black) — heal + bargain signatures
* Wild One (green, yellow) — viral + summon signatures

---

**Open design questions before this builds:**

1. **Combinatorics control:** 9 colors × 9 cells × 8+ patterns is
   astronomical. How many combinations have meaningful distinct effects
   vs. overlap? Probably need a curated set of ~50-100 named fusions,
   not "every combo does something unique."
2. **Discovery model:** how do players learn what fusions exist? Recipe
   book / class progression unlock / experimentation with hints?
3. **Persistence:** fusions live until disassembled? Until used X times?
   Until next zone? Different per category?
4. **Slots:** how many fusions can a player have active at once? Per
   class limit? Stacking rules?
5. **Cost balance:** brick economy already tight (S013 economy fix).
   Fusion shouldn't trivialize brick supply or starve normal cast economy.
6. **Active vs passive:** are some fusions "always-on" (passive) and
   others "trigger when used" (active)? How does the player know which?
7. **Forge timing:** board-phase only? Mid-rumble assembly? Some
   categories rumble-only, others board-only?
8. **Class progression:** does Blocksmith *start* with armor mastery,
   or does it unlock at level X? Tied to the existing skill system?
9. **UI:** 3x3 grid as a separate panel in player dashboard? On Fusion
   tab (currently a stub at 0.16.5)? Drag bricks from inventory into
   cells? Confirm to forge?

---

**Architectural placement when this builds:**

* Data: `FUSIONS` table in game.js or new `fusions.js`
  * `{ id, pattern, colorRequirement, effect, category, classGate, cost }`
* Server resolver: validate forge attempt (pattern + colors match a
  recognized fusion + class allowed + cost paid + slot available)
* Server state: `player.fusions: [...active fusion ids]` with metadata
  for durability, charges, etc.
* Player UI: dedicated Fusion panel — 3x3 grid picker, brick inventory
  alongside, "Forge" button on valid match. Show recipe book.
* Rumble layer: `player.fusions` consulted during damage/cast/ability
  resolution for typed effects.

---

**Roadmap fit:**

* **0.16.5 Fusion** is the locked slot for this. Per S014 handoff,
  fusion is the "step-change" payoff that the tier-curve compression
  reserved headroom for. The brick-bar and class-identity work in
  0.15.0 / 0.16.0 establishes the baseline; fusion is where players
  go beyond it.
* This is a **multi-session build** even at v1. Probably:
  * Session A: schema, ~15 starter fusions across categories,
    server resolver, minimal UI to forge and equip
  * Session B: discovery / unlock model, class signatures, balance pass
  * Session C: more fusions, polish, edge-case handling

---

**Why this matters strategically:**

* Solves the "after baseline class identity, what's next?" question.
  Fusion is the long arc.
* Gives every color a deeper expression beyond its baseline cast.
* Creates synergy webs: every brick can become part of multiple
  build paths.
* Establishes a content treadmill — adding new fusions is incremental
  work that doesn't require new mechanics.
* Class identity scales naturally — class signatures aren't just flat
  affinities, they unlock unique build paths.
* Pairs with brick economy: gives players a long-term goal for hoarding
  specific colors.

---

### BS gray wall regen — pips back on wall destruction (logged S015 v0.15.8)

**Seed:** when a Blocksmith-built gray wall is destroyed (HP reduced to 0
by entity attacks), BS gets +1 armor pip back. Walls become a renewable
resource cycle for BS — they're the only class who benefits when their
walls die.

**The BS gameplay loop this enables:**

1. BS taps yellow → entities aggro toward BS (taunt mechanic, deferred
   for BS chunk)
2. BS taps gray to wall up → entities attack wall instead of BS
3. Wall dies → BS gets pip back → BS rebuilds wall
4. Repeat

This wall-regen mechanic is the keystone that closes the BS combat loop.
Without it, walls are a one-time-use mechanic. With it, BS gameplay is
continuously turning enemy aggression into more walls.

**Why this works as the BS gray identity:**

* Differentiates BS from BK without breaking numerical unity (per
  v0.15.8 lock: BS = BK numerically, mechanical differentiation only)
* Pairs with existing BS pre-rumble passive (Builder's Guard +1 starting
  armor) — BS starts the wall cycle ahead
* Pairs naturally with planned BS yellow taunt + BS arc-wall variant
* No other class has a "gain from your own things being destroyed"
  mechanic — distinctive identity

**Design questions to lock when building:**

1. **Universal or BS-only?** BS-only matches signature identity.
   Recommend BS-only.
2. **Trigger condition:** wall HP reaches 0 only, or any destruction
   (including arena cleanup at battle end)? Recommend HP=0 only — reward
   for absorbing damage, not for placement.
3. **Cap respect:** if BS is at armor cap when wall dies, is the pip
   lost? Recommend yes, respects cap (consistent with other pip
   mechanics). Could combo with overflow → spawn another wall around
   nearest entity, continuing the loop.
4. **Multi-wall scenarios:** if 3 walls die in one frame, +3 pips at
   once? Recommend yes, stack normally.
5. **Excess-overflow walls count?** When BS overflows pips into a wall
   around nearest entity (universal mechanic from v0.15.8), does THAT
   wall regen on destruction? Recommend yes — same wall, same rule.
6. **Visual feedback:** wall dying with regen needs a clear pip-back
   beat. Suggested: gray particle trail from dying wall to BS player,
   plus small "+1" floater at BS.

**Architectural placement:**

* characters.js: add `wallRegenPip: true` to `blocksmith.grayProfile`.
  Optional helper `getGrayWallRegen(cls)` returns true/false.
* rumble.js: track wall ownership — `grayWalls[].ownerCls` set on
  creation. In wall destruction handler (likely `updateGrayWalls` when
  `wall.hp <= 0`), check if owner has `wallRegenPip`. If yes and current
  armor < cap, increment armor + spawn visual (particle trail player-ward
  + floater).
* Need to handle player-departed scenarios: if BS player leaves the
  rumble before their wall dies, what happens? Probably no regen (player
  not present to receive it).

**Roadmap fit:**

* Lands in BS chunk — bundled with yellow taunt + arc wall variant on
  excess-pip overflow + mid-fight regen rate (if any additional regen
  is needed beyond wall-destruction pips).

**Build estimate:** small chunk. Wall ownership tracking is the only
new state. Regen logic is a single hook in the existing wall destruction
path. Visual is one particle system + one floater.

**Why log this now:**

BS is queued as the third class to receive signature mechanics (after
BK and SS per current order). When BS chunk lands, this seed is the
locked starting point so we don't redesign from scratch.

---

### Forced enemy encounter on dry streak (logged S015)

**Seed:** if a player completes 2 turns without an enemy encounter, the
next turn forces one. Prevents long stretches of pure board navigation
that drain combat tension.

**Design space — open questions to resolve before building:**

1. **Counter scope — per player or per party?**
   * **Per player** (recommended) — each player tracks their own dry streak.
     Snapstep moving fast through empty zones racks up; their next turn
     forces. Breaker who fights every turn never triggers. Independent
     counters reward dodgers' luck up to a point, then demand engagement.
   * **Per party** — single counter advances each turn nobody fought.
     Simpler but punishes the wrong player ("Snapstep gets the forced
     fight because Breaker had a long dry streak").

2. **What counts as an encounter?**
   * Cleanest definition: anything that triggers a rumble battle resets
     the counter. Events without combat don't.
   * Force-gate, poison ticks, environmental damage: don't count.
   * Rumble that ends in 0 entities (instant clear from prior wave): does
     count (battle was triggered).

3. **How does the encounter manifest?**
   * **Spawn at next landing space** (recommended) — wherever they land
     turn 3, plant a monster regardless of what was there. Cleaner
     architecturally — overrides the landing event roll.
   * **Spawn mid-move** — interrupt their movement, force a battle on the
     spot. More dramatic but changes movement mechanics significantly.
   * **Choose monster from current zone** (recommended) — zone-appropriate
     (zone 1 = goblin, zone 4 = stone troll).
   * **Tier scales with streak** — 2-turn dry = standard, 3+ = harder
     (encourages not letting it pile up).

4. **Player communication:**
   * **Counter visible on dashboard** (recommended) — small chip:
     "🎯 1 quiet turn" → "🎯 2 quiet turns — encounter pending". Gives the
     player tactical info without ruining surprise. They can choose
     whether to burn red dash to avoid landing on a bad space, or
     prepare for combat.
   * Silent: surprise but feels arbitrary.
   * Warning toasts at 1 / 2: noisy, breaks rhythm.

5. **Counter reset timing:**
   * **Reset on rumble entry** (recommended), not outcome. Avoids
     feedback loop where losing → still owe an encounter → harder to
     recover.

6. **Class identity hooks:**
   * Snapstep (speed signature) — most likely to chain dry turns. The
     forced encounter gives them a real cost for high-mobility play.
   * Wild One (poison spread) — viral poison could spread to forced-spawn
     enemies, immediate payoff.
   * Breaker (high HP) — handles forced encounters well.
   * Fixer (lowest HP) — forced encounter is genuinely punishing.
   * Could shape forced-encounter type per class (deep design, probably
     0.18+ material).

**Architectural placement:**
* Board mechanic in `server.js`, not rumble.
* New field: `G.players[cls].quietTurns` (counter, persists across turns).
* Reset hook in rumble entry/exit.
* Increment hook at end-of-turn handler if no rumble fired.
* Forced-encounter logic in landing-event resolver — when a player lands
  and `quietTurns >= 2`, override the landing event with a monster spawn.
* Parameters in characters.js (`forcedEncounterThreshold` per class) or
  game.js (universal threshold).

**Roadmap fit:**
* Closest match in design doc §8: 0.20.0 "Entity Overload" (entity
  behavior systems pass).
* Could also fit 0.21.0+ "Polish" (pacing tuning).
* Small enough to slot earlier alongside any entity AI work
  (e.g., goblin charge AI from audit Thread A).

**Recommended v1 defaults if shipping quickly:**
per-player counter, 2-turn threshold, reset on rumble entry, next-landing
override, visible counter chip, uniform threshold across classes.

**Build estimate:** small to medium chunk, mostly server.js.

---

## Parking lot — v0.15.36 close

### Events-system overhaul (v0.16.27 close)

**Source:** Ross during v0.16.27 close on rubble stacking sizing:
> "feels like rubble stacking can take more room in this card, how
> many cards is it on top of? seems like we can make this more
> efficient and elegant, not to mention unify the whole event
> system. that is coming down the pipeline...lol, still need to
> wrap with players. rubble stacking deferred until events
> overhaul? what is your take"
>
> "add to parking lot what we were discussing about events"

**Current architecture** (problem inventory):

Each event type has its own custom inline rendering through
`showLandingResult` → `restoreActiveEvent` → per-color branches
that emit raw HTML into `#landing-result`. Stack of nested chrome
per event:
1. `_dashDynamicZone` outer dz card (border + class color + padding)
2. `#landing-result` inner div
3. `roll-display` wrapper (margin + text-align)
4. Event-specific outer (background, border, padding)
5. Event-specific body (canvas/UI/buttons)

That's 4-5 nested containers per event type. Each event reinvents
the wrapper wheel: gray, red, green, gold (with sub-variants
search/torch), blue (with sub-variants), purple, white, black,
riddle, trap. Rubble-stacking sizing fix in v0.16.26 was a
patch on rubble's specific markup — won't survive an overhaul.

**Proposed unified shape:**

One `EventCard` component:
- Reads `G.activeEvent` for type/state
- Renders standardized header (icon + name + zone tag) +
  body slot + footer slot
- Body slot is per-event-type module — same interface, different
  contents (canvas for spatial mini-games, choice grid for
  binary events, animated stages for combat)
- Header/footer/wrapper chrome shared, only body differs
- Hand-off to post-event flavor at result-field-populate (already
  built in v0.16.27)
- Event types as data: `EVENT_TYPES = { gray: { icon, name,
  bodyRenderer, ... }, red: { ... } }` — UNITY: same shape,
  different fields per type

**Wins:**
- UNITY: one render path, one container hierarchy
- ELEGANCE: per-event chrome stripped, body modules are pure
  content
- EFFICIENCY: shared header/footer = less code; sizing fix
  applies to all events at once (not per-type patches)
- Overflow problem solved structurally — body fits dz width
  by default, body modules render to that width

**Dependencies / risk:**
- Touches `showLandingResult`, `restoreActiveEvent`, all per-type
  result branches (gray/red/green/gold/blue/purple/white/black/
  riddle/trap). Big surface area.
- Server-side result fields stay as-is — overhaul is client-only
- Need to validate every event type rerender works post-migration
  (per rule #20 grep migration symptoms)
- Big enough that it deserves a dedicated session, not mixed
  with other work

**Defer until:** dashboard interaction layer fully sealed
(post-event flavor verified clean across all 13 types, fusion
mechanic spec begun or completed). Then events-overhaul as a
focused session.

**Pre-overhaul tech debt parked for the overhaul to absorb:**
- Rubble stacking sizing — v0.16.26 patched canvas to 240px
  width with CSS scaling, but wider dz could accommodate larger.
  Defer to overhaul (body slot will inherit dz width naturally).
- Other event canvases (green vine path, red trial of hand)
  may have similar overflow issues — not yet playtest-verified.
  Overhaul fixes by structure.
- Outcome detection edge cases (monster/boss heuristic, white
  shrine sub-outcomes) — overhaul is good moment to refactor
  `_eventOutcome` against the unified type schema.
- Red trial outcome detection: v0.16.27 playtest showed
  Breaker WON on DM panel but unfavorable flavor displayed.
  Field-name mismatch suspected — `ev.redResult.winner` may
  not match server's actual field name. Worth grep before/after
  overhaul to verify all per-type field reads.

---

### Market redesign — cheese-modal visual language + coin icon

**Source:** Ross during v0.15.36 playtest:
> "cheese modal - use for inspiration for new market using coin icon"

**Read:** the cheese-grab modal has UI shape worth carrying into the
market. Migration would unify the market visual language with the
rest of the dashboard's reward iconography (🪙 coins explicit,
not text "gold"). Could combine with:
- Tactile click rhythm (similar to brick-chip taps elsewhere)
- Coin-flow FX on purchase (BoardFx `goldGained` plays in reverse —
  coins fly FROM gold display TO market item being bought)
- Cheese-modal layout for purchase confirmation (single tap to confirm,
  not multi-card)

**Build estimate:** medium chunk. Touches market-tab rendering in
players-core.js (`renderMarket` and related), gold-display anchoring
(would benefit from `id="my-gold-display"` finally being added —
see goldGained TODO above), and possibly new boardFx preset for the
reverse-flow purchase confirmation.

**Dependencies:** none blocking, but boardModal.js extract first
would make this cleaner since the cheese modal is a must-click card
that boardModal would own. Suggest sequencing: boardModal extract →
market redesign.

**Roadmap fit:** §10 "Polish" range. Player-experience patch.

---

### [REPORTED] Shield amount discrepancy — rumble vs board

**Source:** Ross during v0.15.36 playtest:
> "shield amount discrepancy rumble and board, max?"

**Status:** REPORTED, NOT YET DIAGNOSED. Player observed shield/armor
amounts differing between board context (dashboard pip display) and
rumble context (rumble HUD). Possible causes:
- Different MAX_SHIELD constant in two places (one in players-core.js
  vs one in rumble.js or characters.js)
- Cap applied at one layer but not the other (gain capped on board,
  not capped in rumble — or vice versa)
- Display divergence (server state has one value, rumble UI shows another)

**Players-core.js anchor:** `const shieldMax = me.hpMax;` (line ~530
in render). Shield cap = max HP (i.e., shield can absorb up to one
full HP-bar's worth before being maxed).

**Rumble side:** unknown — needs scan of rumble.js for shield/armor
display logic and any independent max calculation.

**Diagnostic next step:** scan rumble.js + characters.js for shield
max/cap logic. Compare against players-core.js. If a divergence
exists, surface it with both code paths visible before fixing.

**Build estimate:** small (likely a one-line constant fix or a
single-source-of-truth refactor moving max into characters.js).

---

### [REPORTED] Server-side reward gating — Collect button currently theatre

**Source:** Ross during v0.15.38 playtest:
> "do rewards move immediately to inventory on event resolution?
> should be gated behind button press"

**Status:** REPORTED. Client-side scaffold exists (v0.15.37 added
`client.send('collectReward', ...)` on tap). Server-side handler
does not exist yet.

**Current behavior:** Server credits reward to player inventory when
trial winner is determined / event resolved. Client renders Collect
button + boardFx, but the brick is already in inventory before tap.
The FX is decorative, not transitional.

**Desired behavior:** Server holds reward as `pendingRewards` per
player or per event. Client tap fires `collectReward` action. Server
processes, credits inventory, broadcasts state. The boardFx animation
becomes the literal animation of the credit.

**Server.js changes needed:**
1. State shape: add `pendingRewards` field per player or per active
   event (e.g. `G.players[cls].pendingRewards = [{kind:'brick',color:'yellow',count:1}]`)
2. Reward resolution paths (riddle winner, trial winner, gold-game
   finish, etc.) write to pendingRewards instead of directly crediting
3. `collectReward` action handler: drains pendingRewards, credits
   actual inventory, broadcasts state
4. Timeout / DM-mark-resolved fallback: grant pendingRewards
   automatically if player hasn't collected after N seconds OR DM
   marks resolved. Prevents reward loss for AFK players.

**Build estimate:** medium chunk, mostly server.js. Touches every
reward-grant code path.

**Roadmap fit:** §10 polish, but high-value because the visual UX
relies on this for the FX to feel right.

---

### Gold-game finish Collect migration

**Source:** v0.15.38 audit found gold-game finish still uses custom
HTML (renders into `#gold-game-container`, sibling of landing-result),
bypassing buildResolutionCard. So gold-game has no Collect button.

**Current behavior:** Player completes torch/crack minigame; sees
custom HTML card showing coins + cheese + flavor + "WAITING FOR DM".
No Collect button. brickGained/goldGained FX still fires when DM
marks resolved (via rewardPopup server flow), but click-friction
between minigame end and DM resolution remains.

**Migration scope:**
- Refactor `finishGoldGame` to render via buildResolutionCard
- Spec: `{ coins: amount, cheese: cheeseFound, hp: -1 if rat-bite }`
- Container routing: either render into `#landing-result` (sibling
  of #gold-game-container) or teach buildResolutionCard to accept
  a target container

**Build estimate:** small. Mostly mechanical — same pattern as
v0.15.38 riddle migration.

**Roadmap fit:** next polish push. Natural follow-on to v0.15.38.

---

### Display-helper audit — extend _displayed coverage to all inventory read sites

**Source:** v0.15.39 build acknowledgment.

**Status:** Partial coverage. The dashboard gold/cheese stats and
brick-charges chip use `_displayed()` / `_displayedBricks()` helpers.
Other read sites (bricks-tab pip displays, party-card brick chips,
fusion tab counts, possibly trade modal) still read `me.bricks` /
`me.gold` / `me.cheese` directly, which means during a Collect
animation those views show the server total while the dashboard
shows the pre-resolution total. Inconsistency.

**Build scope:** grep for `me.bricks[`, `me.gold`, `me.cheese`,
`bricks[color]`, `players[cls].gold` etc. across players-core.js.
Route each through `_displayed` / `_displayedBricks` where the value
is being *displayed* (vs. used in logic, like "do I have enough?"
gates which should still read raw server state).

**Build estimate:** small to medium. Mechanical replace + careful
review of which read sites are display vs. logic.

**Roadmap fit:** §10 polish, sibling to v0.15.39.

---
