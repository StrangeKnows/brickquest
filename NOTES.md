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

## Session 011 — Polish, Resolution Consistency, Revive Minigame (April 22-23, 2026)

Post-v4 polish session. Big theme: shared component helpers for resolution
cards, mid-combat death recovery, diagnostic fixes for mobile, and
progression-system instrumentation.

### Resolution card consistency pass — all 9 v4 events unified

Introduced two shared helpers in players.html + test_players.html:

- `buildResolutionCard({themeColor, borderColor, bgColor, title, rewardIcons, flavor, linger, extra, shower, showerTint})`
  — builds the bordered themed result card with confetti canvas (20%
  opacity), icon row, italic flavor, linger note, extras slot, and
  "WAITING FOR DM" footer.
- `renderRewardIcons({bricks:{color:n}, coins, cheese, shield, hp, maxHp, poison, custom})`
  — builds the icon row. Supports colored brick squares, coins (🪙),
  cheese (🧀), shield (🛡), HP chips (±N), Max HP chips, poison (☠)
  stacks, plus arbitrary custom HTML.

Every v4 resolution card migrated:
1. Purple — 4 outcomes (Blessed/Cursed/Pass/Cleansed)
2. White — 5 outcomes (Heal Ally / Self Heal / Max HP / Self Rest / Revive)
3. Black — 5 outcomes (Refused / Blood Price / Brick Exchange / Poisoned Favor / Binding Pact)
4. Green — 4 tiers (All Cut / 2 Cut / 1 Cut / Overwhelmed)
5. Red — Winner/Loser/DNJ/Cancelled/No Winner
6. Gray Rubble — 4 tiers (Perfect/Good/Miss/Fumble, match % in extras)
7. Trap — Disarmed / Dodged / Sprung (per-damage flavor pool)
8. Gold — Torch gathered / Crack found / Rat bite / Burnout
9. Blue — migrated to helper (was the original template)

Numeric rewards are auto-extracted from `R.msg` via regex (e.g. `+2 red`,
`+3 gold`, `-2 HP`, `☠ 1 poison`). If no numeric content present, icon
row omitted — card still renders cleanly with just title + flavor.

### Green vine puzzle — redesigned

Replaced the SVG trace minigame with a **multi-vine puzzle**. 6 vines
in a 3×3 grid, each with a type:
- **Thorn** 🌵 → TAP (quick press)
- **Grab** 🌿 → HOLD 1.5s
- **Weep** 💧 → SWIPE 40px

Need 3 correct cuts out of 6 to pass (matches existing scoring tiers).
Wrong gesture locks vine red. 25s timer. WO Wild One: HOLD on any vine
counts as correct regardless of type. Legend row at top teaches the
pairings.

### Revive minigame — new death recovery mechanic

Player HP=0 in rumble no longer silently auto-respawns. Instead:
- Full-screen defeat overlay fades in
- Tap-to-fill bar: 20 taps in 6s
- Rumble is fully paused via new `_revivePaused` flag gating the main
  `update()` loop + all damage sources
- **Success with cheese** → full HP, cheese consumed, floater "🧀 REVIVED"
- **Success without cheese** → 50% HP, floater "REVIVED"
- **Failure** → retry at 80% speed (7.5s window). Second failure →
  `_internalEnd('defeat')` fires, battle ends
- 2.5s iframes + statuses cleared on revive
- Battle continues mid-state (enemy HP, bricks, timer all preserved)

Also audited all HP=0 paths to ensure revive triggers correctly:
- Enemy melee/projectile hit: existing calls preserved
- Poison DoT tick: fixed (was silently killing player until next enemy hit)
- Poison puddle → poison status → tick: covered by poison tick fix
- External `Rumble.setPlayerHP(n)`: defensive fix (triggers revive if set to 0)

### Overheal cap 3× → 2× hpMax + purple HP bars on board

Lifesteal overheal ceiling reduced from `hpMax * 3` to `hpMax * 2`.
New caps per class (examples): BK 28 (was 42), FW 12 (was 18).

Verified overheal already persists to board via
`p.hp = Math.max(0, finalHp)` in battleEnd handler — no clamp.

Added visual overheal state to every HP bar on player + DM screens:
- When `hp > hpMax`, bar fill becomes purple gradient
  `linear-gradient(90deg,#7B2FBE,#b06fef)` + `box-shadow: 0 0 6px #b06fef88`
- HP text color → `#b06fef`
- Bar width clamped to 100%
- DM card also shows `(+N)` suffix on HP text for overheal amount
- Applied to: main player stats strip, status tab HP card, party tab
  HP bars, DM player roster cards

### Mobile header auto-hide on scroll

`.topbar` + `.phase-banner` now collapse smoothly on scroll-down in
`#tab-content`, restore on scroll-up. Max action-pane real estate on
landscape mobile screens. Uses `requestAnimationFrame` throttling +
20px top-threshold (always visible near top). Transitions on
max-height, padding, opacity, border-bottom-width.

### Blue event FW Formwright Charge

FW gets +1 blue brick (same as other classes) PLUS a persistent
`nextRumbleBuff.refreshBoost = { multiplier: 2.0, durationMs: 10000 }`
on blue-event success. Consumed at rumble start.

Rumble side: `player.refreshBoost = { multiplier, endsAt }`. Check in
`playerRefreshMult()` multiplies refresh rate while active. Floater
"⚡ FORMWRIGHT CHARGE" at battle start. Compounds multiplicatively
with daze (2× × 0.5 = 1.0).

**UI additions:**
- Blue resolution card → dedicated FW banner with 4-line flavor pool
  when `fwRefreshBuff: true`
- Player persistent banner shown between rounds while the buff is queued
- DM blue result card shows same banner
- DM roster shows `⚡ FW charge` pill until rumble consumes it
- Also added `☠ N` poison pill for queued poison stacks (was invisible)

### Shadow Bargain UX rework

Old flow used browser `prompt()` dialog for brick_exchange — terrible
on mobile, zero context. Rewrote:

- **All classes** see the offer details now (FW retains Scholar's Eye
  flavor framing; others see plain "The shadow offers:" lead-in)
- Clear GAIN / COST rows per offer type:
  - Blood Price → +2 black / −2-5 max HP (rolled, permanent)
  - Brick Exchange → +1 black, +3 gold / −1 brick (your pick, below)
  - Poisoned Favor → +1 black / ☠ 1 poison stack × 3 rumbles
  - Binding Pact → +2 black / every ally loses 1 random brick
- **Inline brick picker** for exchange — clickable tiles showing colored
  brick square + class + count. Selection highlights gold. Replaces
  dropdown/prompt entirely.
- Accept button disabled if player has no eligible bricks; label
  reflects state ("✓ ACCEPT (trade selected)" for exchange)

### Skeleton bone-rise victory guard + universal corpse icons

Two fixes in the victory flow:

1. `triggerVictory()` now checks for pending `_boneRiseQueued` flags.
   Skeleton small-hit deaths (finalDmg ≤ 10) queue a bone-rise that's
   processed on the next frame. Without the guard, victory declared +
   loot dropped before the skeleton could revive.

2. `drawDeadEntity()` was hardcoded to draw 👺 (goblin). Now uses
   `g.visIcon` (populated from entity registry) so every monster
   shows its own icon in the corpse visual. Icons + X eyes scale with
   entity radius — bosses now have larger corpse visuals. All monsters
   laid on side, 70% opacity, grey body overlay, fade in last 0.5s.

### Victory screen single-hit highlights + zero-hiding

Added 6 new `_battleStats` fields:
- `biggestDamageDealt` — largest single hit to any enemy
- `biggestDamageTaken` — largest single hit to player (melee, projectile, poison)
- `biggestHealPlayer` + `totalHealed` — biggest + total self-heal
- `biggestHealEntity` + `totalEntityHeal` — biggest + total enemy self-heal
  (cursed_knight +5, stone_colossus +3, others +2)

Instrumented 6 damage sites + 5 heal sites. All stats passed through
`battleEnd` snapshot for DM visibility.

Victory screen rebuilt to show only non-zero stats in logical order:
1. Time / HP (always)
2. DMG DEALT / DMG TAKEN
3. HIGHEST HIT / BIGGEST HIT TAKEN
4. HP HEALED / BIGGEST HEAL
5. ENEMY HEALED / BIGGEST ENEMY HEAL
6. DPS / CRITS
7. OVERLOADS / ARMOR ABSORBED

Zero-valued stats hidden so "took no damage" runs don't show
"DMG TAKEN 0", etc.

### Debug log strip

Removed 37 of 38 `[BQ-DBG]`, `[BQ-DBG-DM]`, `[BQ-DBG-SRV]`, `[BQ-RUMBLE]`
console calls across all 5 files. Kept 1 legit `console.warn` in
rumble.js that fires when `_showVictoryScreen` is called without state.

### Small fixes

- **Torch black-screen bug** — `test_players.html` missing
  `var cheeseFound = 0;` declaration. Caused ReferenceError at
  `endGame` → `finishGoldGame` never called → canvas stuck black.
  Added declaration + canvas fade-to-opacity so gap between burnout
  and result card is smooth.
- **Crumb emoji cleanup** — `test_players.html` still had
  `DECOY_POOL = ['crumb', 'cheese']` + 🟡 crumb draw branch. Removed
  both. Torch now spawns only 🪙 coins + 🧀 cheese. `players.html`
  was already clean.
- **Mobile victory screen diagnostics** — user reported victory screen
  not appearing on mobile. Added 4 `console.log` diagnostics in
  rumble.js through the victory trigger flow. Left in place for
  remote debugging.

### File state

Shipped in `/mnt/user-data/outputs`:
- server.js 130978 bytes
- rumble.js 364830 bytes
- players.html 341547 bytes
- test_players.html 342121 bytes
- dm_screen.html 94880 bytes
- game.js 32573 bytes (unchanged this session)

All syntax-verified via `node --check` (server, rumble) and brace/paren
count (HTML script tags).

### Still deferred

- Purple chest pictures — needs design direction (emoji / SVG / asset)
- Pilgrim's Rest full rework — needs design direction (options, minigame vs decision)
- Lingering event marker on board graphic
- Cheese display on DM screen per-player roster
- Cheese store mechanics
- Class skills rework with fusion gating (MAJOR multi-session)
- Board actions audit + consistency pass
- Zone-scaled revive minigame difficulty

---

## Session 011 continuation — post-first-push iteration (April 23, 2026)

After the first S011 push (commit `6e7b164`), Ross kept iterating.
This section captures everything shipped AFTER that commit, before
the session-capstone `-V` minor bump.

### Revive button redesign (heart, 120px)

The radial-gradient circle "egg" at 220px was too big and read wrong
for the moment. Replaced with a thematic pulsing heart:

- ❤ glyph at 90px font size, 120px button frame
- Transparent background, drop-shadow glow in theme color
- CSS keyframe `reviveHeartPulse` — 0.9s ease cycle, scale 1.0 ↔ 1.08
- "TAP!" overlay text centered on the heart for clarity
- Tap feedback scales just the heart span to 0.85 (not the button
  itself — the pulse keyframe needs to keep running uninterrupted)

Thematic tie: hearts already appear as damage floaters during combat.
The revive heart reads as life force returning.

### Post-victory poison death bug fix

When the last enemy died in spec-mode rumble, the code entered a
15-second "wait for loot collection" phase with `running = true`
and no DoT-freeze. Poison kept ticking. If HP hit 0 during the wait,
the revive minigame fired AFTER the fight was already won — jarring.

Fix: one line in `triggerVictory()` spec-mode branch. The moment the
loot-wait begins, call `clearStatuses()` to wipe lingering DoTs.
Heals/regen untouched since they're not status effects. Player wins
in peace.

### Version system

`package.json` version bumped to `0.11.0` (matching session number).
`server.js` now reads `BQ_VERSION` from `package.json` at startup
with a failure-safe fallback to 'dev':

```js
const BQ_VERSION = (() => {
  try { return require('./package.json').version || 'dev'; }
  catch (e) { return 'dev'; }
})();
```

Banner shows `🧱 BRICK QUEST v0.11.0 RUNNING` dynamically.

`save.sh` upgraded with version-bump flags using
`npm version --no-git-tag-version` (edits package.json in place, no
git tag — regular commit carries version info):

```bash
./save.sh "msg"            # commit + push only (unchanged)
./save.sh -v "msg"         # patch bump (0.11.0 → 0.11.1)
./save.sh -V "msg"         # minor bump (0.11.0 → 0.12.0)
./save.sh --major "msg"    # major bump
```

Convention: `-v` for bug fixes and small additions, `-V` for
session-capstone commits with multiple features.

### Icons-only UI pass (gold / cheese words stripped)

Ross wanted "Gold" and "Cheese" word labels gone from the player
screen — icons are now universal enough to stand alone. Stripped:

- Main player HUD stat chips: `🪙 ${gold}` / `🧀 ${cheese}` (was
  number + label row below)
- Trade/give UI rows: `🪙 x N` / `🧀 x N` (labels removed)
- Rumble victory loot chips: `🪙 +3` / `🧀 +1` (word suffix dropped)

Not stripped (intentionally):
- Market description prose ("Buy bricks with gold" — reads naturally)
- Crack-game stop button ("Stop — Keep N gold")
- Free-action button labels (explain mechanics)
- Server log messages

Gold icon confirmed standard: 🪙 across ALL 47 uses. No competing
icons. 🏆 only in victory contexts, never as currency.
Cheese icon 🧀 consistent across all surfaces.

### Stat chip centering + Attack Die removal

`.stats-row` got `align-items:stretch` and `.stat-chip` became a flex
column with `align-items:center; justify-content:center`. This makes
icon-only chips (Gold, Cheese) match the height of label-bearing
chips (Position) with content centered in the available space.

Also removed the Attack Die chip entirely — `me.die` is still on the
player object but only referenced in dead turn-based battle code.
Clean removal of one stale UI element.

### Cheese icon cross-surface audit + fixes

Before this session, cheese display was inconsistent:

Player side, 6 v4 render functions — only 2 extracted cheese:
- Purple ✓ / White (no awards) / **Black ✗ BUG** / Green (no awards)
- Red ✓ / **Gray Rubble ✗ BUG**

Fixes:
- Black bargain `renderBlackShadowBargain` — added cheese regex
  handling both "+N cheese" AND plain "N cheese" (for "Shadow hands
  you 1 cheese")
- Gray rubble — added cheese regex to the spec extraction
- Both regexes now: `/\+(\d+)\s*(?:🧀|cheese)|(\d+)\s*cheese/i`

DM side was worse — no dedicated result panels for purple, white,
black, green, gray rubble. Added `v4DmResultBlock()` helper that
parses `R.msg` into an icon row (bricks, coins, cheese, HP, max HP,
poison, shield). Hooked up to all 5 event types. Expanded the
panel-hide gate to include v4 results.

### Torch cheese server bug (critical fix)

Ross reported clicking cheese tiles in torch event, no cheese on
result screen. Dug in and found a silent server-side bug:

Client sends `cheeseFound` at TOP LEVEL of the `resolveEvent` payload:
```js
client.send('resolveEvent', { cls, eventType: 'gold', amount,
  total, wrongTap, cheeseFound });
```

Server was reading from NESTED `data`:
```js
const cheeseFound = Math.max(0,
  parseInt((data && data.cheeseFound) || 0) || 0);
```

`data.cheeseFound` was always `undefined`. Cheese was being silently
dropped on the server. Other fields (`amount`, `wrongTap`) had
`P.amount ?? data.amount` fallback patterns — cheeseFound was
missing that fallback.

Fix: `P.cheeseFound ?? (data && data.cheeseFound) ?? 0`. Same
pattern as other fields.

### Crack game cheese (15% spawn)

Per Ross's direction, crack game now optionally spawns 1 cheese tile:

- 15% spawn chance per crack game (dice-roll at game start)
- Replaces one 'empty' slot (doesn't reduce coin count)
- Tapping cheese: collect +1 cheese, game continues (rat still ends)
- Reveals as 🧀 with gold border, warm background
- Server awards cheese for `variant === 'torch' || variant === 'crack'`

Result card paths — all 6 outcomes handled:
- Coins only | Coins + cheese | Cheese only | Rat bite alone
- Rat bite + cheese (new title "🧀 CHEESE (WITH TEETH)" with
  dedicated flavor pool)
- Rat bite + coins (± cheese — now includes cheese if present)

All 4 `finishGoldGame()` calls in crack path pass the cheeseFound
parameter. Mirrored to test_players.html.

### Orange brick reward for trap clean escape

Ross: "orange event, brick rewards?" — identified gap where
non-Snapstep players took damage from traps with no consolation.

Decision: **Perfect dodge (zero damage taken) gives +1 orange brick.**
Rewards skill, parallels Snapstep disarm path. Sprung traps still
punish (no brick when damaged).

Server: `trapDodge` handler checks `finalDmg === 0 && rawDmg > 0`,
grants `p.bricks.orange++`, fires rewardPopup, sets
`trapResult.cleanEscape = true`.

Player card: dodged card shows orange brick icon via
`renderRewardIcons({bricks:{orange:1}})`. New flavor line added to
0-damage pool: *"You pried a piece loose on the way out."*

DM card: new clean-escape branch (`tr.dmg === 0 && !tr.disarmed`)
shows "✓ DODGED" in green + earned orange brick swatch + flavor.

### Gray rubble timer scaling

30s was too tight for dense outlines — Ross reported timeouts before
completion. New formula:

```
timeLeft = 20 + 5 * blockCount
```

5 blocks → 45s, 6 blocks → 50s, 7 blocks → 55s, 8 blocks → 60s.
Initial display label computes the budget inline so no "30" flicker
before the first tick.

### Mobile header compact + auto-hide

Topbar + phase banner got two combined treatments:

**Compact (always):**
- Topbar 36px (was 60) / emoji 18px (was 24) / name 12px (was 15)
- Phase banner 32px / 11px font
- Tighter padding throughout

**Auto-hide on active event (new):**
- `render()` toggles `.hidden-on-scroll` on both elements based on
  `G.activeEvent.cls === MY_CLASS && !G.activeEvent.resolved`
- Wrapped in try/catch for safety during class selection phase
- When event resolves → header pops back in for post-event actions

Combined effect: during any active event minigame (rubble stacking,
torch, crack, trap dodge, etc.) the full viewport is available for
the action pane. Header returns after resolve.

### Victory screen stats — single-hit highlights

Added 6 new `_battleStats` fields:
- `biggestDamageDealt` / `biggestDamageTaken` — single-hit highs
- `biggestHealPlayer` + `totalHealed` — self-heal tracking
- `biggestHealEntity` + `totalEntityHeal` — enemy self-heal tracking

Instrumented 6 damage sites (2 player-hit paths, poison tick, entity
damage) + 5 heal sites (white tap, white field tick, doWhiteHeal,
regen tick, lifesteal, enemy heal).

Victory screen rebuilt with dynamic cell array — zero-value stats
hidden. Order: TIME / HP (always) → damage totals → single-hit highs
→ heal totals → enemy heals → DPS/CRITS → overloads/armor. All 6 new
fields pass through battleEnd snapshot for DM visibility.

### File state at session end

Shipped in `/mnt/user-data/outputs`:
- server.js      (cheese fix + clean escape + version read)
- rumble.js      (victory stats + post-victory poison fix + heart button)
- players.html   (resolution cards + action polish + mobile header + crack cheese)
- test_players.html   (mirror of players.html)
- dm_screen.html (v4 result cards + clean escape)
- package.json   (version 0.11.x)
- save.sh        (version bump flags)

### Design proposal (for S012)

Shipped alongside code: `DESIGN_S012_PROPOSAL.txt` — 479 lines.
Covers current understanding, proposed charge model for bricks
(consumable → charge with empty pip visual), action screen redesign
(SELF / ALLY / BOARD groupings), per-class identity audit, ordered
implementation checklist, and 6 open design questions for Ross.

Intended as the kickoff document for S012 in a fresh chat. Major
refactor scope — bricksCharged data model touches server state,
persistence, rumble reconciliation, all render surfaces. Should
NOT be attempted in the current chat due to context budget.

### Session close

Session 011 ran April 22-23, 2026. Primary themes: polish,
consistency, mobile ergonomics, bug surgery, versioning foundation,
and a design-level reset for S012 via the proposal doc.

Rough shipment count: ~20 substantive features/fixes across 5 files.
Git pushes: 1 at the commit `6e7b164` midpoint, 1 session-capstone
at v0.12.0 minor bump.

---

## Session 011 final — design closeout + v2 proposal (April 23, 2026)

After shipping S011 code (commits up through 0.11.x patches), the
closing half of the session was pure design work. Ross wanted a
bulletproof handoff document for S012 before context ran out. This
section captures every design decision from that conversation.

### Structure of the design dialogue

Ross marked up the v1 DESIGN_S012_PROPOSAL.txt with `***` comments.
Those 10 comments triggered a back-and-forth that expanded the
proposal scope by 3-4×. The v2 proposal now locks every decision.

### Core systems approved

CHARGE MODEL B (tactical)
  - bricksCharged empty pips = zero rumble power contribution
  - Empty pip still COUNTS as owned (inventory depth ceiling)
  - Refresh only at rumble entry + zone gate crossing
  - No mid-turn board refresh (preserves the rest-beat rhythm)

HP BLEED-OUT
  - Damage > 40% hpMax + would kill → slow drain instead of instant
  - 1500ms duration
  - Heal during bleed = rescue
  - No instant KO
  - Ripples favorably into Fixer identity as rescue class

CLEANSE = WHITE OVERLOAD
  - Universal (players + entities)
  - Tier = number of status effects removed
  - Works with regen zones (Fixer's white field tick)
  - Applies to entity self-cleanse (Cursed Knight, etc.)

OVERLOAD ON BOARD
  - Same hold-to-charge mechanic as rumble
  - Tier menu reveals action options as charge builds
  - Per-class menus differ (FW purple sees different options
    than BK purple)
  - Hidden bonus sparkles occasionally (discovery mechanic)

### Class expression framework

Per-color specialization per class, felt in BOTH rumble AND board.

Signature colors (2-3 per class):
  BK: red, gray
  FW: blue, purple, black
  SS: orange, red
  BS: gray, yellow
  FX: white, black
  WO: green, yellow

Key specific mechanics ratified:
  - FW purple: 90° cone AOE + teleport + dual blast (70% each end)
  - FW purple board: 2× refresh rate
  - SS orange rumble: 0.5s invuln on tap
  - SS orange board: Cache infuse mechanic
  - BS gray rumble: mid-fight armor regen (+1 pip every 8s)
  - BS yellow rumble: true taunt (pulls enemy focus)
  - WO green rumble PASSIVE: poison auto-spreads to adjacent enemies
  - FX white: 1.5× output + field ticks double (existing, preserved)

Pre-rumble buffs per class (passive, always on):
  - BK: first hit +50% damage
  - FW: starts with 1 FW Charge active (2× brick refresh 10s)
  - SS: "First Step" — all enemy attacks miss SS for first 3 sec
  - BS: +1 armor pip at start
  - FX: start at hpMax + 1 (overheal pip)
  - WO: first enemy starts poisoned (1 stack)

Purple radii class-specific:
  - FW: 90° cone
  - FX: 60° cone
  - Others: 30-60° tighter cones
  - Class expression visible in every rumble

### Class achievement unlocks

All per-class board actions beyond baseline are achievement-gated.
Progress visible in status tab. Unlock via toast + board overload
menu appearance.

SNAPSTEP:
  - Cache Mastery (20 caches laid, 10 claimed) — doubles depth
  - Ghost Step (100 attacks dodged) — undetectable movement
  - Hunter's Mark (50 overload crits) — 2× damage to marked

BREAKER (pick ONE for S012 flagship ship):
  - Shatter (25 overload crits) — enemies lose 20% max HP pre-fight
  - Ground Slam (150 damage absorbed) — space becomes damage zone
  - Bulwark (survive below 10% HP 5 times) — transfer armor to ally
  - DECISION POINT: Ross chooses at S012 start

BLOCKSMITH:
  - Mason Keystone (30 perfect stacks) — party ablative armor
  - Architect Reroll (5 boss rumbles) — reroll an event once per
    zone. PREVIOUSLY was "unlimited" — now LOCKED to once/zone.
  - Forge, Blueprint — existing skills preserved

FORMWRIGHT:
  - Oracle Scry (10 black bargains survived) — party 3-event peek
  - Wordsmith Confound (20 riddle firsts) — enemy's first action
    randomized (non-boss, requires prior combat)

FIXER:
  - Heal Ally (baseline, no gate) — same-zone healing
  - Field Medic (25 poison cures) — instant cure in zone
  - Last Rites (10 rumble revives) — mid-zone resurrection

WILD ONE:
  - Spread Poison (baseline, no gate) — passive in rumble
  - Mire (100 poison ticks) — zone-wide enemy pre-poison
  - Whistle (50 killing blows on poisoned) — summon defeated
    entity type. 30s. Tier by kill count (1/5/15/30 = 25/50/75/100%).
  - Tracks killLog per-entity for tier calc

REMOVED FROM V1:
  - Rallying Cry — too OP, infinite red loop
  - Enhanced Movement — vestigial purple-as-movement, deprecated
  - Simple poison trap — would grief players, poisoned-entity
    passive is cleaner
  - Breaker Rally — replaced by destruction-focused alternatives

### Cheese system

Parallel economy alongside bricks. UNIFIED UX.

MECHANICS:
  - Cheese is consumed on eat OR throw (permanent loss)
  - Eat at status tab → +N max HP (variant-specific scaling)
  - Throw at pre-rumble modal → rumble effect (variant-specific)
  - Same cheese = one use; cannot eat AND throw

VARIANTS (initial ship = 6):
  🧀 Standard (+1 HP, eat-only basic)
  🧀 Sour green-spot (+2 HP / skip rumble)
  🧀 Smoky mottled (+2 HP / distract 5s)
  🧀 Rich deep gold (+2 HP / double loot)
  🧀 Bleu blue-spot (+3 HP / force rarest drops)
  🧀 Aged cracked (+3 HP / halve enemy count)

HOLD-TO-CHARGE CHEESE (status tab):
  - Tier 1: eat 1 cheese
  - Tier 2: eat 2 simultaneously
  - Tier 3: eat ALL (tests all variant effects)

CHEESE DROP ROLLS:
  - Rolled on rumble victory + event rewards
  - Weighted toward common; rare variants from drops only
  - Cheese shop sells basic 🧀 only

DM PANEL:
  - Per-player cheese inventory by variant
  - DM can grant/revoke manually (story beats, testing)
  - Display: 🧀 ×3  🧀ᴳ ×1  🧀ᴮ ×0

### Entity overload system

Parallel to player overload. Entities build charge, fire tiered
attacks with AOE scaling.

DATA MODEL:
  entity.colors = { purple: 2, white: 1, green: 3, ... }
  Rolled per entity at spawn within type-specific ranges.

COLOR LEVEL RANGES:
  Goblin:      all 0-1
  Skeleton:    white 1-2, purple 0-1
  Rot grub:    green 2-3, purple 1-2
  Cursed Kt:   white 2-3, purple 2-3, red 1-2
  Stone Col:   gray 3, red 2, purple 1-2
  Bosses:      3-4 across multiple sigs

OVERLOAD EFFECTS (aggression-focused, not defensive):
  Red: berserk +50% dmg 5s
  Blue: stagger zone on self
  Orange: invuln burst
  Yellow: pulls allied entities (aggro gather)
  Green: poison pulse +stacks
  Purple: self-heal OR teleport toward player
  White: CLEANSE SELF (tier = statuses removed)
  Black: shadow blink
  Gray: +3 DR for 8s

DROP RATES:
  More of a color = higher drop chance for that brick color
  Formula: baseDropChance + (level × 10%)
  Rolled per entity — strategic enemy selection emerges

INITIAL SCOPE:
  Start with Cursed Knight, Rot Grub Matron, Stone Colossus
  Expand after balancing

### Multiplayer proximity rumble

MECHANICS:
  - N spaces = 2 (tunable) — initial value
  - Auto-join, not opt-in
  - Shared arena, shared enemy pool
  - Individual loot zones
  - Last damage = main drop (kill attribution)

ARCHITECTURE:
  - Server picks rumble host (first to trigger)
  - Server-authoritative simulation
  - 20 FPS state sync
  - Client-side prediction for own player
  - Local save on device, DM backup authoritative

INCREMENTAL SHIP:
  Phase 1: 2 players
  Phase 2: 3-4
  Phase 3: 6

### Other locked decisions

CACHE NAMING: "Cache" is locked as the SS placed-item name.

MIRE NAMING: "Mire" is the approved name (was "Blight Bearer"
placeholder).

WHISTLE NAMING: "Whistle" is the approved name (was "Packmaster"
placeholder).

SCRY: party-wide visibility, not caster-only.

ARCHITECT: once per zone, not once per game.

ALLY ZONE: same-zone scoping (not same-space, not adjacency).

### Timeline summary

BUILD 0.12.0 — Foundations (charge model data layer)
BUILD 0.13.0 — Charge Visible (UI renders)
BUILD 0.14.0 — Action Hub + Bleed-Out (flagship UX)
BUILD 0.15.0 — Class Identity: Rumble (per-color expression)
BUILD 0.16.0 — Class Identity: Board (per-class overload menus)
BUILD 0.17.0 — Cheese System (variants, throw, DM panel)
BUILD 0.18.0 — Achievements + Unlocks (progression)
BUILD 0.19.0 — Multiplayer Proximity (co-op rumble)
BUILD 0.20.0 — Entity Overload (tactical depth)
BUILD 0.21.0+ — Rares + polish

Estimated 15-20 sessions to v1.0.0. 2-3 months at Ross's pacing.

### Files shipped in this closing batch

Shipped in /mnt/user-data/outputs:
  - DESIGN_S012_PROPOSAL_V2.txt (1267 lines) — bulletproof handoff
  - NOTES.md (updated with this section)
  - No code changes in closing conversations (all code was shipped
    in earlier S011 turns)

### Handoff chain integrity

For S012 Claude: read DESIGN_S012_PROPOSAL_V2.txt FIRST. It
supersedes the v1 proposal. Every decision from this doc is
approved. Begin work on Build 0.12.0.

---

## Session 012 — Build 0.12.0 Foundations (April 23, 2026)

First working session under the V2 proposal. Build 0.12.0 scope per
§8.1: strip dead code, introduce `p.bricksCharged` data layer. No
visible UI changes (§8.1 exit criterion: "existing gameplay unaffected";
charge rendering is §8.2 / Build 0.13.0).

### Part A — Dead code strip

Removed all turn-based battle vestiges from the ripped combat system
(commit 548e8be era). These were UI scaffolding over ghost state
objects (G.battle, G.battleResult) whose server-side writers had been
gone for months. The audit also surfaced orphaned skill-system
renderers (SKILLS = {} stub, Skills tab pane, status-skills card,
renderUnlockedSkills).

players.html:
  - Victory-screen block reading G.battleResult (ghost field, zero
    writers server-side)
  - renderActions if(inBattle)/else wrapper — flattened the always-
    false branch, reindented the always-run else body
  - renderPhaseBanner dead battle branch
  - renderPreparePanel market-during-battle guard
  - render() battle machinery: battleFeed reset, lastAction pickup,
    killing-blow death-detection timer
  - Nine dead WebSocket handlers with zero server emitters:
    attackResult, brickResult, monsterAttackResult, battleLoot,
    _battleLoot_legacy, enhancedResult, lootReady, skillUnlocked,
    scavengeResult
  - Orphaned functions: doAttack, showRollResult, showBrickResult,
    pushBattleFeed, renderBattleFeed, showDamageFlash, doSearch,
    renderBrickButtons, renderClassAbilities, showLootScreen,
    collectLoot, renderUnlockedSkills
  - All turn-based class ability fns: doRageBreak, doWhirlwind,
    doFortressStance, doLegendaryBastion, doWarlordsFury, doTimeFreeze,
    doCataclysm, doBlitz, doTame, showTameResult, doAlphaPredator,
    doNaturesWrath, doPhoenixSurge, doDivineShield
  - renderParty initiative-order card + dead inBattle local
  - renderBricks stub (pane-bricks was never created — TAB_DEFS
    has no 'bricks' entry)
  - Skills tab block: _skillCostMap, doUnlockSkill, renderSkills
    (pane-skills similarly never created)
  - Six dead module-level vars: battleFeed, _wasBattle, _wasAllDead,
    _victoryPending, _victoryTimer, _lastActionDesc
  - SKILLS = {} declaration + its 2-line "kept as stub" comment
  - renderSkills(me) call in render() hot path

  Before: 6792 lines. After: 6062 lines. Δ = −730.

test_players.html:
  - Full mirror of every players.html strip
  - Plus test-harness variant: second _skillCostMap in harness
    globals block, second event-handler dispatch (one-liner format)
    with condensed versions of the dead battle handlers, second
    renderSkills/renderBricks variants

  Before: 7525 lines. After: 6773 lines. Δ = −752.

game.js:
  - 12 of 25 legacy stubs removed (those with zero callers):
    unlockSkill, tameAttempt, commandTamed, rollAttack, catapult,
    startBattle, endBattle, monsterAttack, nextBattleRound,
    setComplication, bossPhase2, salvage
  - 10 stubs preserved: healPlayer, revivePlayer, massRepair,
    useBrick, deconstructGate, rebuildBridge, blueprint, forge,
    activateEnhanced, addShield. These still have live callers
    from player UI (Fixer heal/revive/mass-repair, Blocksmith
    deconstruct-gate/rebuild-bridge, Enhanced Movement, self-heal,
    add-shield buttons).
  - Comment rewritten to reflect current state and 0.14.0 plan
  - Before: 620 lines. After: 607 lines. Δ = −13.

Combined dead-code strip across session: −1495 lines.

### Discovery: pre-existing broken UI

The audit surfaced that 8 live player-UI buttons route to
legacy-stub no-ops with zero server-side handlers. These have
been broken since the turn-based system was ripped (commit 548e8be).
Not caused by S012 strips. Per proposal §8.3/§8.14, these rebuild
in Build 0.14.0 (Action Hub). Logged, deferred, 10 stubs preserved
to prevent throw-on-click.

Affected buttons (all currently no-op with console warn):
  - Spend white brick — heal self
  - Fixer: Heal ally / Revive player / Mass Repair
  - Shield-up (status tab add-shield)
  - Blocksmith: Deconstruct Gate / Rebuild Bridge
  - Enhanced Movement (purple brick use)

### Part B — bricksCharged data layer

New data model per V2 §1.1, Charge Model B (Tactical):
  p.bricks[c]         = owned inventory (ceiling)
  p.bricksCharged[c]  = active charges; invariant bricksCharged[c] <= bricks[c]

Charges spent on board action (future 0.14.0+). Refreshed only at
rumble entry (full reset) and zone gate crossing. No mid-board
refresh. Preserves the tactical rest-beat rhythm of traversal.

Implementation, server.js:

  - Four helpers at top of file, after mkPlayer:
      refreshCharges(p)           — bricksCharged = {...bricks}
      addBrick(p, color, n=1)     — new bricks arrive charged
      removeBrick(p, color, n=1)  — hard remove from inventory;
                                    clamps charges down to preserve
                                    invariant
      spendBrickCharge(p, color, n=1) — consume charge without
                                    removing from inventory

  - mkPlayer: new `bricksCharged` field mirrors starting `bricks`
    (new players start fully charged).

  - Save migration (loadState): if p.bricksCharged is missing on
    load, defaults to {...p.bricks}. Existing saves come back as
    fully-charged — matches Q9's "exact saved state" intent at
    migration boundary since any pre-S012 save never had partial
    charges to preserve.

  - Rumble start hook: refreshCharges(p) called before the
    playerRumble snapshot (line 800 area). Rumble always starts
    with full charges regardless of prior board state. The snapshot
    now carries both `bricks` (ceiling) and `bricksCharged`
    (matching ceiling post-refresh).

  - Rumble end hook (battleEnd handler): extended to accept
    `finalBrickMax` (inventory ceiling after any mid-rumble loot)
    and `finalBricks` (remaining charges). Backward-compatible:
    if finalBrickMax is absent, finalBricks writes to both.
    Charge write clamps to ceiling for invariant safety.

  - Zone gate crossing: refreshCharges(p) in two paths:
      1. dmMovePlayer: already had `if (newZone !== prevZone)`
         zone-transition cleanup block; added refresh there.
      2. requestRedDash: after final destination resolved, checks
         zone of start vs finalDest; refresh on change. Catches
         dashes that break through gates AND dashes that cross
         zone boundaries without gates (rare, forward-safe).

  - Gain/spend sites rewired through helpers:
      L694 market purchase → addBrick
      L1550 event brick reward → addBrick
      L1693 cursed lost_brick penalty → removeBrick
      L1918-1920 black bargain brick_exchange → removeBrick + addBrick
      L1911 blood_price +2 black → addBrick
      L1926 poisoned_favor +1 black → addBrick
      L1933 binding_pact +2 black → addBrick
      L1942 binding_pact ally loss → removeBrick
      L2417 DM adjustBrick (grant/revoke) → addBrick/removeBrick
      L2543-2546 trade acceptance → removeBrick + addBrick (both sides)
      L2581-2585 direct give → removeBrick + addBrick

Implementation, client:

  - players.html + test_players.html battleEnd emit: now sends
    `finalBrickMax` (= snap.playerBrickMax, the inventory ceiling)
    and `finalBricks` (= snap.playerBricks, remaining charges) as
    separate fields. Rumble.getState() already exposes both.
    Matches new server semantics.

  - No other client changes for 0.12.0. UI still renders from
    p.bricks as the single brick count (unchanged). Charge-state
    rendering is deferred to 0.13.0 per proposal §8.2.

### Verification

  node --check passes on all modified JS-bearing files:
    server.js, game.js, players.html, test_players.html, rumble.js

  Unit test exercised helpers end-to-end: mkPlayer → addBrick →
  spendBrickCharge → refreshCharges → removeBrick with over-clamp.
  Invariant bricksCharged[c] <= bricks[c] holds across all ops.

  Ran `node -e "require('./server.js')"` — loads past all top-level
  helper/mkPlayer/freshState/save-load execution, fails only at
  'ws' module (expected in this container; not installed).

### What 0.12.0 does NOT do (per §8.1 exit criteria)

  - No visible UI changes. Empty-pip rendering is 0.13.0.
  - No per-pip timestamp/pulse animations. That's 0.13.0 §1.2.
  - No hold-to-charge board overload. That's 0.14.0 §1.3.
  - No damage-scaling read of bricksCharged in rumble.js. Rumble
    keeps its internal charge model (brickMax / bricks) as before.
    The server's bricksCharged is a parallel board-side field that
    feeds rumble's starting state but doesn't influence in-rumble
    scaling this build.
  - No HP bleed-out. 0.14.0 §1.4.
  - No class-identity work. 0.15.0 / 0.16.0.

### Deferred items noted for S013+

  - Preserved game.js stubs (10) all get real implementations in
    0.14.0 when the Action Hub rebuild wires proper server handlers.
  - bricksCharged has no UI surface yet. Add visible pip-dimming +
    pulse in 0.13.0 per §1.2.
  - rumble.js damage scaling eventually reads server's bricksCharged
    start-state instead of player.bricks at rumble-begin (§1.1
    "Model B power scaling"). For now both paths are equivalent
    since refreshCharges at rumble start makes them equal.

### Files shipped

Modified this session:
  - server.js          (2681 lines)
  - game.js            ( 607 lines)
  - players.html       (6062 lines)
  - test_players.html  (6773 lines)
  - NOTES.md           (this append)

No changes to: rumble.js, dm_screen.html, package.json, rumble.css,
rumble_test.html, game.js constants, board graphic.

Version: still v0.12.0 (bumped by S011 capstone). No bump this
session — no feature ship yet, only foundation. Next bump at
Build 0.13.0.

### Session close notes

No commit this session per standing prefs (push only at session-end
trigger phrases). Hold for Ross's "session done" signal.

Standing-prefs memory needs updates on session close:
  - Remove arena_test.html (deleted in S011, still listed in memory's
    full file set)
  - Add rumble.js to full file set (central, 358 KB, central combat)
  - Confirm NOTES.md is appended every session (handoff says so)

---

## Session 013 — Build 0.13.0 Charge Visible (April 23, 2026)

Second session under the V2 proposal. Build 0.13.0 scope per §8.2:
brick chip visual redesign with lit/dim pip states, pulse on empty
pips per §1.2 timing, board heal/shield consume bricksCharged.

### Part A — Pip rendering

New shared helper renderBrickPips(bricks, bricksCharged, lastDropped, opts)
in players.html and test_players.html. Same visual vocabulary as the
rumble brick HUD (rumble.js _brickBtnHTML at line 2362 — 6×6px rounded
square, solid color + glow when lit, dark fill + color-tinted border
when empty). Board version sized 10-14px depending on surface. opts
supports clickable={targetCls} for party tab tap-to-trade.

CSS (S013 §1.2 timing):
  @keyframes pip-pulse: 0.55 ↔ 0.95 opacity sine
  .pip-empty default 1.8s cycle (slow / aging tier)
  .pulse-fast 0.6s   (<5s since last spend)
  .pulse-med  1.0s   (5-30s since last spend)
  .pulse-slow 1.8s   (30s+ / never spent)

Per-color recency from p.lastDropped[color] (server-stamped on every
spendBrickCharge call). Per §1.2 line 131 "Start with per-color
tracking; per-pip specificity can expand later."

### Part B — Surfaces retrofit

Four surfaces now show the pip chip:
  1. Main HUD mini-inventory (status tab) — renderMiniInventory
  2. Party tab other-player card — preserves click-to-trade per pip
  3. Party tab self card (compact)
  4. DM roster (dm_screen.html) — adds mini pip row + charged/total
     count format ("2/3") next to each color's adjust controls

The dm_screen retrofit answers §8.2's test target "DM sees dim pips
on partial players." Adjust buttons unchanged — DM still grants/revokes
inventory as before.

### Part C — Board actions consume charges

S012 left game.js with 10 _legacy() stubs servicing live UI. §8.2
asks for board heal + shield to consume bricksCharged. Two stubs
got real implementations:

  game.js:
    healPlayer(cls) → this.send('healPlayer', { cls })
    addShield(cls)  → this.send('addShield', { cls })
  Other 8 stubs unchanged (Action Hub work in 0.14.0).

  server.js handlers:
    healPlayer — gates on bricksCharged.white >= 1 and hp < hpMax.
                 Spends 1 white charge, heals per-class amount
                 (SELF_HEAL_AMT table: fixer 4, others 2). Errors
                 routed to ws.send for client toast.

    addShield — uniform base per Ross's S013 design call: 1 gray
                charge → +1 armor for ALL classes, cap = hpMax.
                Crit: 10% chance (Blocksmith 25%) yields +2 armor
                at the same 1-gray cost. Crit fires a rewardPopup
                so the player sees the lucky outcome.
                Class-specific scaling (iron_hide bonus, per-class
                multipliers) removed. Class abilities + fusion
                upgrades will reintroduce variation in later builds.

  Client-side gating switched from inventory to charge:
    - selfHeal() — checks bricksCharged.white not bricks.white,
      checks hp < hpMax before send, no premature success toast
      (server emits error on failure).
    - Add Shield button (prepare-panel + out-of-battle) — gates
      on bricksCharged.gray, copy reads "1 gray charge" not
      "1 gray brick" to reinforce the model.
    - Status-tab shield-cap display (renderStatus) flattened
      to me.hpMax (was per-class mult with iron_hide branch).

### Part D — lastDropped data field

p.lastDropped: {} added to mkPlayer. Save migration defaults to
empty object on load (no pulse-worthy events on first session).
spendBrickCharge stamps p.lastDropped[color] = Date.now() on every
charge consumption. Field persists across rumble entry/exit and
zone gate refresh — refresh restores charges but doesn't erase the
"what did I last use" memory. Pulses naturally cease once a color is
fully charged (pip-empty class only applies when i >= charged).

### Verification

  node --check passes on all modified files:
    server.js, game.js, players.html, test_players.html, dm_screen.html

  End-to-end charge-flow walkthrough:
    Pre-heal (8/14 HP, 2 white charges) → spend 1 → 10/14 HP, 1 charge
    Empty white pip immediately reads pulse-fast (just-dropped)
    Spend 1 gray with crit → +2 armor at 1-charge cost
    Zone gate refresh → all charges back to inventory ceiling
    lastDropped persists across refresh (history intact)

  §1.2 pulse tier function:
    1s ago  → pulse-fast (0.6s)
    10s ago → pulse-med  (1.0s)
    60s ago → pulse-slow (1.8s, default)
    Never   → pulse-slow

  Crit probability sanity (1000 rolls each):
    10% rolled 104, 25% rolled 263 (within expected range)

### What 0.13.0 does NOT do

  - No Character Dashboard layout (§7 — that's 0.14.0 Action Hub)
  - No hold-to-charge overload (§1.3, 0.14.0)
  - No HP bleed-out (§1.4, 0.14.0)
  - No class-specific charge effectiveness (§8.5+ class identity)
  - No fusion-system upgrades to brick effectiveness (much later)
  - 8 of the 10 game.js _legacy stubs still in place (Fixer ally
    heal/revive/mass-repair, Blocksmith deconstruct-gate/rebuild-
    bridge, Enhanced Movement, Blueprint, Forge, useBrick — all
    rebuilt in 0.14.0 Action Hub)

### Files shipped

  - server.js          (2740 lines, +59 from 0.12.1)
    healPlayer + addShield handlers, lastDropped on mkPlayer + migration,
    spendBrickCharge stamps lastDropped
  - game.js            ( 609 lines, +2 from 0.12.1)
    Real send() for healPlayer + addShield, narrowed legacy block 10→8
  - players.html       (6115 lines, +52 from 0.12.1)
    pip-pulse CSS, renderBrickPips helper, 4 surface retrofits, charge-
    gated heal/shield buttons, flat shield cap
  - test_players.html  (6810 lines, +37 from 0.12.1)
    Full mirror of players.html
  - dm_screen.html     (1728 lines, +12 from 0.12.1)
    Roster pip row + charged/total format
  - NOTES.md           (this append)

### Test targets (§8.2)

  ☐ Charge state readable at glance
       — pip row with lit/empty + pulse should make this immediate.
         Verify on phone in actual session.
  ☐ Heal self → white pip empties, pulses
       — server stamps lastDropped.white on spendBrickCharge,
         empty pip gets pulse-fast class within 5s.
  ☐ Rumble entry → charges refill
       — refreshCharges(p) at battleStart is unchanged from S012.
  ☐ Zone gate crossing → charges refill
       — refreshCharges(p) at zone transition unchanged from S012.
  ☐ DM sees dim pips on partial players
       — DM roster shows 2/3 + lit/empty mini pip row per color.

All five test targets are wired. Playtest-readiness pending on
physical-device check.

### Session close notes

No commit this session per standing prefs (push only at session-end
trigger phrases). Hold for Ross's "session done" signal.


---

## Session 013 continuation — Post-ship patches (April 23, 2026)

After v0.13.0 shipped, playtest on Mac + Windows surfaced three
things worth addressing before starting 0.14.0:

### Part A — DM compact card footer bug

The DM screen has two brick-render sites: an expanded roster panel
(which got the S013 pip retrofit) and an inline compact card footer
(which I missed in my S013 audit). Players spending charges saw
correct state on player screens, but the DM's glance-view card
showed solid pips only. Fixed by reading bricksCharged per color
and rendering lit/hollow accordingly. Uses the same visual vocab
as the expanded panel: solid+glow for lit, dark fill + color border
for empty.

This was a partial-audit gap on my part. The V2 §8.2 test target
"DM sees dim pips on partial players" only fully passes with both
render sites updated.

### Part A.2 — DM BRICK CHANGES delta showed wrong numbers

Playtest surfaced: after a rumble where Breaker looted 1 red + 1
gray, the victory card's BRICK CHANGES only showed "+1 red",
missing the gray. Root cause: the DM delta computation was reading
`rr.finalBricks` as if it were the inventory count, but under the
S013 wire protocol `finalBricks` = remaining charges and
`finalBrickMax` = inventory ceiling.

Separately, server.js's rumbleResult object only saved
`finalBricks: {...p.bricks}` — which is the inventory (because
p.bricks is inventory post-S012). So `rr.finalBricks` on the DM
side was actually showing inventory but computed delta against
pre.bricks (also inventory) as `finalBricks - pre.bricks` — meaning
if 1 gray was looted and 0 charges spent by session end on the
still-charged gray, the delta would display 0 for gray and miss
the loot entirely.

Actually more subtle: the rr.finalBricks from server was
`{...p.bricks}` (inventory, post-loot). The DM read that as
`after` inventory. The delta should work. But because I then
split the server rumbleResult to have a separate `finalBrickMax`
field and the DM code still read `finalBricks`, the values shifted
semantically — finalBricks was now charges, not inventory, and
delta math went wrong.

Fix applied in two places:
  - server.js: rumbleResult now saves both finalBrickMax (inventory)
    and finalBricks (charges) as separate fields, matching the
    wire protocol used in the battleEnd message
  - dm_screen.html: BRICK CHANGES delta reads finalBrickMax (with
    finalBricks fallback for older save data)

Comment updated to clarify what each field means to prevent
future confusion.

### Part B — Rumble spec change: no refresh at rumble start

V2 §1.1 line 98 specified "Rumble start: bricksCharged = {...bricks}
(full reset)". In practice this meant the board charge model had no
teeth: players could spend freely before rumble, knowing entry would
refill everything. The partial-charge tactical weight collapsed at
every monster encounter.

Ross decided rumble should START at the player's current board
charge state. Rumble no longer refreshes. Zone gate crossings remain
the only full-refresh beat.

Implementation:

  server.js battleStart: removed refreshCharges(p) call at rumble
    entry. Board charge state carries through unchanged.

  server.js snapshot: playerRumble already included both bricks and
    bricksCharged; no shape change needed.

  players.html + test_players.html Rumble.start config: client now
    passes bricks (= bricksCharged as starting charges) AND brickMax
    (= bricks as ceiling) as separate fields. Backward-compat
    fallback if either absent.

  rumble.js spec-mode init: reads cfg.brickMax (ceiling) separately
    from cfg.bricks (starting charges). Invariant enforced: charges
    <= ceiling. Previous code forced both to the same value.

Class-color regen behavior during rumble is UNCHANGED. The existing
BRICK_ECONOMY.refreshRates system already tiers regen by class
signature (3s), secondary (5s), baseline (10s). A Fixer entering
rumble with 1/4 white can recover white charges during combat at
3s per pip because white is signature. A Fixer with 1/4 red
recovers slowly (10s per pip, baseline). This ties rumble sustain
to class identity via existing color depth — no new code needed
for that part.

Net effect: board charge spends matter. A player who burned 3
whites before rumble enters combat with only their remaining white
pips charged, pays a tactical price, and has to earn them back
through zone gates or rumble time-in-combat.

### Part C — Dead-code sweep

Ross caught poolCaps in BRICK_ECONOMY — a declared config block
with zero readers, left over from a pre-"inventory-is-pool" design.
Pulled the thread and surfaced more family-member orphans.

Stripped from game.js:
  - SHIELD_MAX per-class percentages table (obsoleted by S013
    flat hpMax cap)
  - SHIELD_COST per-class gray-cost table (obsoleted by S013 flat
    1-gray cost)
  - BRICK_ECONOMY.poolCaps block (inventory IS the pool)
  - BRICK_ECONOMY.fatigueCurve (consumeFatigue is a no-op stub)
  - BRICK_ECONOMY.offClassFatigueTicks (same)
  - brickTierFor function + its export (rumble.js uses local
    brickTier; this was an unused duplicate)

Stripped from rumble.js:
  - BRICK_ECONOMY duplicate fields (fatigueCurve, offClassFatigueTicks)
  - consumeFatigue function (deprecated stub returning 1.0) and
    its "kept for backward compat" comment block
  - _currentFatigueMult module var (written thrice, never read)
  - Fatigue HUD render block (⚡ icon + stack count showing a
    number that no longer affects play)
  - player.fatigue state field init in makePlayer
  - player.fatigue reset at battle start
  - fatigue: field in getState() snapshot

Stripped from rumble_test.html:
  - Fatigue readout in the spec-mode debug panel (showing sig:N
    off:N counts that did nothing)

Stripped from server.js:
  - SHIELD_MAX and SHIELD_COST imports (neither had any call site
    after S013 flat-shield rewrite)

Fixed in server.js:
  - Dash brick consumption now routes through removeBrick(p, 'red',
    1) helper instead of direct p.bricks.red -= 1 (was inconsistent
    with S013 charge-model invariant enforcement)
  - Stale "battle fatigue" comment on the dash handler rewritten
    to describe what the code actually does (next-battle penalty)

Net strip: ~55 lines of confirmed dead code across 4 files.
Zero behavior change; everything removed was a no-op, a config
read by nothing, or a display indicator for a dead mechanic.

Honest meta-note: this is the second audit pass where Ross caught
dead config I missed on first sweep. Pattern: grep for exact names
finds orphan functions, but structural dead code (declared but
unread config keys, HUD indicators for ripped mechanics) slips
through unless I broaden the search. Recording this to improve
next audit.

### Verification

  node --check passes on all modified JS-bearing files:
    server.js, game.js, rumble.js, players.html, test_players.html,
    dm_screen.html, rumble_test.html

  Dead-code sweep final grep counts:
    poolCap, SHIELD_MAX, SHIELD_COST, fatigueCurve,
    offClassFatigueTicks, consumeFatigue, _currentFatigueMult,
    player.fatigue, brickTierFor — all zero refs across codebase.

### Files shipped

  - server.js          (2741 lines)
    No refresh at rumble start, removeBrick for dash, cleaned imports
  - game.js            ( 572 lines, -35)
    BRICK_ECONOMY trimmed to just refreshRates, stripped SHIELD_MAX,
    SHIELD_COST, brickTierFor
  - rumble.js          (8517 lines, -30)
    Fatigue system excised, brickMax/bricks split from cfg at start
  - players.html       (6119 lines, -1 from adjustments)
    Rumble.start now passes brickMax separately
  - test_players.html  (6812 lines, +2 from mirror)
    Same brickMax addition
  - dm_screen.html     (1733 lines, +5)
    Compact card footer shows charged/total pips
  - rumble_test.html   ( 416 lines, -4)
    Fatigue readout stripped
  - NOTES.md           (this append)

### Version

  This session bundles: DM render fix (bug), rumble spec change
  (behavior), dead-code sweep (cleanup). Per standing conventions:
  v0.13.1 patch — all three are post-ship polish on the v0.13.0
  foundation, not new feature scope.

