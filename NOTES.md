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

### v0.16.31 — White/gray drop-target highlight via elementsFromPoint stack walk

> "if the fusion screen is present, draggin white and gray onto it
> cauuses highlighht. if there is no fusion screen present, dragtgin
> white and gray will trigger fusion screen, buut no white ouuutline
> prior"

Half-bug from v0.16.30. The fusion-drop routing in `_holdUp` was
fixed (using overlay display-toggle hack), so DROP works for white/
gray. But the LIVE highlight feedback in `_holdMove` was still using
`document.elementFromPoint` (singular), which returned the radial
fan overlay element first and never found the dz beneath. Result:
- Drop works (right routing)
- But no `.fusion-drop-target` highlight while dragging — player
  has no visual confirmation the dz is the drop target

When fusion screen was already open, the dz content shape changed
(taller content, surface card extends past fan icons), so the cursor
crossed the dz BEYOND the radial coverage area as the player moved
toward the dz center — and at that point elementFromPoint found the
dz. So highlight kicked in. Misleading "sometimes works" pattern.

**Fix: elementsFromPoint stack walk in `_holdMove`.**

`document.elementsFromPoint(x, y)` returns ALL elements at the
point in z-order top to bottom. Walk the stack and find the first
match for each role we care about (ally icon, option icon, dz).
The radial fan icons are in the stack but the dz is too — stack
walk finds both. No display-toggle, no DOM mutation, no perf
concern (one extra elementsFromPoint per move event vs one
elementFromPoint).

**Same approach applied to `_holdUp`.**

Replaced the v0.16.30 display-toggle hack with the cleaner stack
walk. Goal identical (find dz beneath overlay), implementation more
elegant. Aligns _holdMove and _holdUp to use the same lookup
pattern. ELEGANCE: one technique, two call sites.

**Also fixed: stale highlight cleanup.**

Tracked `_holdState._highlightedDz` so when the cursor leaves the dz
mid-drag, the previous highlight class is removed (was lingering).
And `_holdEnd` now clears the highlight on any termination path —
so successful drop, cancelled drop, and other-target releases all
leave a clean dz.

---

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, html files,
boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **No fusion screen open → drag white brick toward dz:** dz border
   brightens to white as soon as cursor is over the dz area.
3. **No fusion screen open → drag gray brick toward dz:** same — dz
   highlights immediately on hover.
4. **Drag onto dz, drop:** highlight clears as fusion placeholder
   opens (was working before, still works).
5. **Drag onto dz, drag off:** highlight clears as cursor leaves
   (no stale highlight persisting).
6. **Fusion screen already open, drag white/gray to dz:** highlight
   still works (was already working in v0.16.30).
7. **No regressions** to ally radial (Fixer hold without drag, drag
   to ally icon for heal still works).

---

**Risk surfaces:**

- `elementsFromPoint` is well-supported (all modern browsers) but
  not in IE. Fallback to single elementFromPoint if missing — see
  `typeof document.elementsFromPoint === 'function'` guard.
- Stack walk costs O(n) where n = elements at point. Usually 3-6
  elements; negligible perf impact at 60Hz.
- The `_highlightedDz` tracking handles "cursor leaves dz" cleanup,
  but if the dz element is replaced mid-drag by a re-render, the
  old reference is stale. Edge case unlikely during a single drag,
  but worth noting.

---

**Standards audit (rule #17 — push #50 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only — no markup or CSS
  changes. ✓
- Rule #6 (diagnostic-first): N/A — bug root cause was clear from
  Ross's symptom report (highlight works conditionally on fusion
  screen presence) plus knowledge of the v0.16.30 overlay-stack
  issue. Direct fix.
- Rule #19 (intuition): held — Ross's symptom description told me
  the issue was specifically "highlight not showing" not "drop not
  working," which meant the bug was in `_holdMove` not `_holdUp`.
  Fixed both call sites for consistency.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: _holdMove and _holdUp now use the same elementsFromPoint
    technique for dz lookup.
  - ELEGANCE: replaces the v0.16.30 display-toggle hack with a
    cleaner stack walk. No DOM mutation.
  - EFFICIENCY: O(n) stack walk per pointermove event is cheap.

---

### v0.16.32 — Strip redundant prepare-phase Market button

> "get rid of the dang market buuutton now, please!"
> "only market is the coin that activates the dz"

`buildPrepareActions` was always pushing a Market entry which
rendered as a "🛒 Market" expandable button in the prepare panel.
Duplicate of the coin-hold gesture which now opens the market
surface in the dz. Two paths to the same place = clutter.

Stripped the Market entry from `buildPrepareActions`. The only path
to market is now coin-hold (opens dz market surface). renderMarketPanel
+ _renderZoneMarket remain wired for the coin-hold surface — the
market itself still exists, just one entry point.

The `a.isMarket` branches in `renderActionButton` (lines 2886, 2910)
are now dead (no action sets `isMarket:true`) but harmless — left
in place in case future prepare-panel restoration wants the hook.

---

**Files changed:** `players-core.js`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, characters.js, html files,
boardFx, dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Prepare phase:** no "🛒 Market" button in dashboard.
3. **Hold coin:** market surface opens in dz (existing behavior).
4. **Buy a brick from the dz market:** purchase still works.
5. **No regressions** to other prepare actions (since list is now
   empty, prepare panel renders nothing).

---

**Standards audit (rule #17 — push #51 in S015 continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js only — no markup or CSS
  changes. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY): UNITY win — one path to
  market (coin-hold) instead of two. ELEGANCE: less code path.
  EFFICIENCY: smaller renderPreparePanel output (empty list now).
- Rule #19 (intuition): held — Ross's spec was clear, direct strip.

---

### v0.16.33 — Tier 1 unification: armorCapMult + grayCritChance as canonical class data

> "is an armor helper correct? Characters.js should have all data
> that is pulled from, or am I thinking wrong? Unity Elegance
> Efficiency"
>
> "lets do it all, and the pace should be determined by Unity,
> Elegance, and Efficiency"

S016 sets up Blocksmith design (The Forge identity, indirect-damage
philosophy, shrapnel reactive + wall-death armor regen). The
shrapnel formula needs to know what "full armor" means consistently
across the codebase. Existing audit (v0.16.25) found four-way
inconsistency in armor cap handling:

- rumble.js getArmorMax: BK × 0.75, others × 0.5 (canonical)
- server.js gray-charge: cap = hpMax (overshoot, no class diff)
- server.js blue-bonus/fail: × 0.5 (didn't honor BK)
- server.js adjustArmor: × 0.5 (didn't honor BK)
- players-core.js dashboard: hpMax pips (overshoot)

Plus a separate hardcoded BS-specific gray crit chance:
- server.js gray-charge: `cls === 'blocksmith' ? 0.25 : 0.10`

Both classes of inconsistency are CLASS DATA living as runtime
literals — exactly the failure mode characters.js was created to
prevent (per its own header comment). Pure unification fix.

**Choice locked at design discussion:** rumble values are canonical
(Option A). BK × 0.75 = signature heavy-tank class identity. Other
classes × 0.5 = standard armor-as-buffer. Lower numbers force
positional play; higher numbers would trivialize combat.

Per Ross design call: "Characters.js should have all data that is
pulled from." So the unification is FIELD ADDITIONS to each class
in CHARACTERS, not a helper function. Runtime sites read from the
data; no logic lives in the data file.

**Two new fields per class:**

```javascript
breaker:    { armorCapMult: 0.75, grayCritChance: 0.10 }
formwright: { armorCapMult: 0.50, grayCritChance: 0.10 }
snapstep:   { armorCapMult: 0.50, grayCritChance: 0.10 }
blocksmith: { armorCapMult: 0.50, grayCritChance: 0.25 }
fixer:      { armorCapMult: 0.50, grayCritChance: 0.10 }
wild_one:   { armorCapMult: 0.50, grayCritChance: 0.10 }
```

Concrete cap values: BK 10, BS 6, Fixer 4, Snapstep 4, Wild One 5,
Formwright 3.

**Five runtime sites updated:**

- `rumble.js:6534` getArmorMax — reads `CHARACTERS[cls].armorCapMult`
- `server.js:1707` blue-event-success armor bonus
- `server.js:1735` blue-event-fail armor consolation
- `server.js:2604+` gray-charge cap + crit chance (both)
- `server.js:2696+` adjustArmor (DM panel armor adjust)
- `players-core.js:944` dashboard pip render

All four files read the same canonical data. Adding a 7th class
with different cap or crit chance = field addition only, zero
runtime changes needed.

**Behavior changes from the unification:**

1. **Dashboard pip render now matches actual cap.** Previously BK
   showed 14 pips that could never fill above 10 (cap was 10 in
   rumble). Now BK shows 10 pips; full bar = full armor. Same fix
   applies to all classes — pip count = real ceiling.

2. **Server gray-charge respects 0.5/0.75 caps.** Previously cap =
   hpMax (full HP). Now matches rumble exactly. BK can charge
   to 10 max via gray. Other classes to floor(hpMax × 0.5).

3. **Server adjustArmor honors BK × 0.75.** Previously DM-panel
   armor adjustment was hardcoded × 0.5 for all. Now BK can
   accept armor up to 10 via DM panel.

4. **No behavior changes for grayCritChance.** Already worked
   correctly; just moved to data.

**Documentation updated** in characters.js header comment block.
Both new fields explained alongside `hp` and `speed`.

---

**Files changed:** `characters.js`, `rumble.js`, `server.js`,
`players-core.js`, `NOTES.md`.

UNTOUCHED: html files, boardFx, dm_screen.html, package.json.

---

**Test focus:**

1. Hard refresh.
2. **Breaker dashboard:** shows 10 pips (was 14). Charge gray,
   armor caps at 10.
3. **Other classes:** pip counts match new caps (BS 6, Fixer 4,
   Snapstep 4, Wild One 5, Formwright 3).
4. **Gray-charge action:** caps at correct value per class. Crit
   chance still triggers ~25% for BS, ~10% others.
5. **Blue event success with shield bonus:** armor goes up to
   correct cap, no overshoot.
6. **DM adjustArmor:** BK accepts up to 10, others up to floor.
7. **Rumble entry from dashboard:** armor doesn't drop on
   transition (caps are now consistent, no truncation).

---

**Risk surfaces:**

- Existing save states with `p.armor > new cap` (e.g. BK saved
  with armor 12 from old uncapped server). Server now caps further
  charges but doesn't actively truncate stale armor. Fresh games
  unaffected; carry-overs from previous sessions may briefly show
  armor exceeding cap until next damage.
- Dashboard pip count changes mid-session for any active games.
  Cosmetic — pip count is display-derived, not stored.

---

**Standards audit (rule #17 — push #52 in S015 continuation,
push #1 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players-core.js but NOT html — pip render
  uses inline styles, no CSS changes. ✓
- Rule #11 (data/runtime/UI): full UNITY win. Class-specific
  values (armor cap, gray crit chance) now live in CHARACTERS as
  data. Runtime files read from data. UI reads from data. One
  source of truth.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: 6 hardcoded sites → 1 canonical data source. Same
    pattern (`CHARACTERS[cls].fieldName`) repeated everywhere.
  - ELEGANCE: each runtime site is a clean CHARACTERS read with
    a defensive fallback to 0.5 / 0.10. No new helper functions.
  - EFFICIENCY: minimal change per file; no new abstractions.
- Rule #19 (intuition): held — Ross corrected my "armor helper
  function" instinct mid-design with the UNITY rule. Right call;
  data fields are cleaner than helpers.
- Rule #14 (UNITY): Ross-driven unification this push. Architecture
  now matches characters.js header doctrine: "SINGLE SOURCE OF
  TRUTH for everything class-specific."

---

### v0.16.34 — Tier 2 unification: rumblePassive schema + visual showcase

> "carry on"
>
> "lets have visual confirmation of the passives, is there something
> already? On rumble start, showcase what is going on"

Tier 2 of the v0.16.33 unification arc. Replaces the 6-class
hardcoded if/else passive switch (rumble.js:9885+) with a single
declarative dispatcher reading `CHARACTERS[cls].rumblePassive`.

**Schema:** each class declares its rumble-start passive as a
declarative object with `kind` (enum) + payload fields. Engine
dispatcher knows how to apply each kind. Adding a passive variant =
add the kind to the dispatcher + populate the field for that class.

```javascript
breaker:    { kind: 'firstHitMod', label: '💥 FIRST STRIKE', mult: 1.5 }
snapstep:   { kind: 'invulnMs',    label: '✦ FIRST STEP',   duration: 3000 }
blocksmith: { kind: 'armorBonus',  label: '🛡 BUILDER\'S GUARD', amount: 1 }
fixer:      { kind: 'hpOverheal',  label: '✚ MEND READY',   amount: 1 }
wild_one:   { kind: 'firstEnemyDebuff', label: '🐍 BLIGHT MARK',
              effect: 'poison', stacks: 1, duration: 6.0 }
formwright: null  // no rumble-start passive (refreshBoost is event-conditional)
```

**Visual upgrade per Ross spec ("showcase what is going on"):**

Replaced `showFloatingText` (small + brief) with `spawnCritBanner`
(large + glowing, 1.4s, gentle upward drift). Also adds
`spawnCritFlourish` particle ring (18 particles in class color)
around player at trigger time. Same visual vocabulary as crit
firings, so the reveal moment reads as "something just happened"
without feeling out of place. No pause / no slowdown — the banner
is non-blocking.

**Two new helper functions in rumble.js:**

- `applyRumblePassive()` — dispatcher. Called once at rumble start
  after BK death-save reset. Reads class data, switches on kind,
  applies effect, fires banner + flourish.
- `applyPendingEnemyDebuff()` — deferred dispatcher. Called after
  entities spawn. Reads `player._pendingEnemyDebuff` (set by
  applyRumblePassive for `firstEnemyDebuff` kind), applies to
  entities[0]. Currently handles `effect: 'poison'`; future debuff
  effects extend by adding cases.

**Consumer site cleanup** — class-name checks removed:

- `damageEntity` first-hit consumer (rumble.js:4788) now reads
  `player.firstHitActive` + `player.firstHitMult` (was
  `player.cls === 'breaker' && player.breakerFirstHit`). Class-
  agnostic — any class with firstHitMod kind gets the multiplier.
- `applyDamageToPlayer` invuln consumer (rumble.js:6700) now reads
  `player.passiveInvulnUntil` (was `cls === 'snapstep' &&
  player.snapstepInvulnUntil`). Class-agnostic.
- Wild One post-spawn block replaced with `applyPendingEnemyDebuff()`
  call. Was a 14-line `cls === 'wild_one' && wildOneFirstPoison`
  block; now a 1-line generic dispatcher invocation.

**Renames** (player-state field names):
- `breakerFirstHit` → `firstHitActive`
- `snapstepInvulnUntil` → `passiveInvulnUntil`
- `wildOneFirstPoison` → `_pendingEnemyDebuff` (object payload now,
  carries effect + stacks + duration instead of bare boolean)

**Behavior parity check:** the dispatcher applies identical effects
in the same order as the old switch:
- BK: sets first-hit flag (now generic) — identical
- SS: sets invuln timestamp (now generic) — identical
- BS: +1 armor pip (cap-aware via getArmorMax) — identical
- Fixer: hp = hpMax + 1 — identical
- WO: defers poison to post-spawn (now via deferred dispatcher) — identical

Visual change is a UPGRADE, not parity:
- OLD: showFloatingText (small, ~1s, no particles)
- NEW: spawnCritBanner (large + glowing, 1.4s, drift) + spawnCritFlourish
  (18-particle ring in class color)

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Each class entering rumble:** large class-colored banner + particle
   flourish on player. Banner readable for ~1.4s, drifts upward, fades.
3. **Breaker first hit:** still deals +50% damage, banner confirms it.
   Hit a second entity — no bonus (consumed).
4. **Snapstep invuln:** all incoming damage shows "EVADED" for first 3
   seconds. Damage normal after window expires.
5. **Blocksmith armor:** rumble starts with +1 armor pip. Banner shows
   "🛡 BUILDER'S GUARD". Pip caps at 6 (BS armor cap).
6. **Fixer overheal:** rumble starts with hp at hpMax + 1 (9/8).
   Existing overheal rendering shows the extra pip.
7. **Wild One blight:** first spawned enemy gets 1 poison stack,
   floating "BLIGHT MARK" text on enemy. Poison ticks normally.
8. **Formwright:** no banner (rumblePassive is null). RefreshBoost
   from blue events still works as before (separate path).
9. **All classes:** no console errors, no missing flag warnings.

---

**Risk surfaces:**

- Renamed flags. If any external code (server.js, players-core.js)
  was reading `player.breakerFirstHit` etc., that read returns
  undefined now. Grepped — those flags are rumble-only state, not
  serialized to server, so safe. Confirmed via `grep -n
  "breakerFirstHit\|snapstepInvulnUntil\|wildOneFirstPoison"` in
  server.js + players-core.js (zero matches).
- BK death-save reset moved one step earlier in init order (was
  immediately after BK passive block, now immediately before
  applyRumblePassive). Functionally identical — both happen before
  any combat begins.
- spawnCritBanner is in CANVAS coordinates. Player.x/y at rumble
  start should be valid (player just spawned). If banner doesn't
  appear, check player position is valid pre-dispatch.

---

**Standards audit (rule #17 — push #53 in S015 continuation,
push #2 in S016 unification arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A this push (rumble.js + characters.js,
  no UI)
- Rule #11 (data/runtime/UI): UNITY win continued — rumble-passive
  data lives in characters.js (declarative), runtime engine reads
  + dispatches based on kind. UI unchanged.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: 6 hardcoded if-blocks → 1 dispatcher reading 1 data field.
    Class-name checks removed from 3 consumer sites.
  - ELEGANCE: declarative schema with discriminated union (kind +
    payload). Renamed flags drop "breakerX" / "snapstepX" / "wildOneX"
    prefixes — names describe behavior, not class identity.
  - EFFICIENCY: dispatcher is one function, not 6 if-blocks.
    Visual upgrade adds spawnCritBanner + spawnCritFlourish (existing
    infrastructure, zero new visual systems).
- Rule #19 (intuition): held — when Ross asked for visual
  confirmation, my read was "use existing critBanner system, not
  build new visual layer." Right call per UNITY (reuse vocabulary)
  and EFFICIENCY (no new code).
- Rule #14 (UNITY): big win. Class-named state fields finally gone
  from rumble.js — engine no longer knows or cares which class is
  playing, only what the data says.
- Rule #6 (diagnostic-first): N/A — refactor with identical-behavior
  spec, no debugging needed.

---

### v0.16.35 — Passive visual: 1s delay so cinematic has settling beat

> "may need a 1s delay before firing 1, or maybe better to have
> duration 1s longer at rumble start"

After v0.16.34 playtest, Ross noted the passive banner fires
immediately at rumble start when the player hasn't settled.
Two-option call: delay the visual vs longer duration. Locked
delay (Option A) for two reasons:

1. **Cleaner narrative beat:** rumble start → settling moment →
   "OH, here's my passive." Like a hero shot after the establishing
   shot. The player has visual context for what they're seeing.

2. **Duration option had infrastructure cost:** `spawnCritBanner` is
   shared infrastructure used for crit firings during combat. Bumping
   the duration globally would lengthen ALL crit banners (wrong).
   Custom-per-call duration would require adding a parameter the
   other callers don't need. Delay sidesteps both.

**Implementation:** `setTimeout(visual, 1000)` inside applyRumblePassive.
Mechanic effects (BS armor, SS invuln, BK first-hit flag, etc.)
apply IMMEDIATELY at rumble start. Only the visual cinematic is
deferred. Edge case handled: if player dies in the 1s window, the
deferred visual checks `!player || player.hp <= 0` and skips the
banner + flourish.

Same approach applies whether the passive is firstHitMod (BK),
invulnMs (SS), armorBonus (BS), hpOverheal (Fixer), or
firstEnemyDebuff (WO). All five wait 1s for the banner regardless
of what the passive does.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Each class entering rumble:** rumble starts immediately with
   passive effect active, but banner + flourish appear 1 second
   later. Player has time to register the rumble before the reveal.
3. **BK:** first hit still +50% from t=0. Banner fires at t=1s.
4. **SS:** invuln window is 3s from t=0 (so 2 more seconds after
   banner appears at t=1). Damage shows "EVADED" during entire window.
5. **BS:** +1 armor pip at t=0. Banner at t=1.
6. **Fixer:** hp = hpMax+1 at t=0. Banner at t=1.
7. **WO:** first enemy gets poison stack at post-spawn (immediate).
   Player banner at t=1, "BLIGHT MARK" on enemy can be at any time.
8. **FW:** no banner ever (rumblePassive null). Unchanged.
9. **Edge case:** if you can die in the first second somehow (taking
   damage during a non-invuln passive), banner skips gracefully.

---

**Cross-machine note (housekeeping):**

The v0.16.34 push diff showed "11,932 insertions, 11,673 deletions"
in 5 files. The actual code change was small (one new dispatcher
function + 5 class data fields + 3 consumer renames). Inflated diff
is CRLF↔LF round-trip from cross-machine workflow (Linux dev
container edits with LF, Windows commits added CRLF, then Mac sync
saw all lines as changed because LF mismatch).

**Cosmetic only — code is correct, push succeeded, GitHub diff is
just noisy.** Worth a one-time housekeeping push to add
`.gitattributes` with `* text=auto eol=lf` so all files normalize
to LF on commit regardless of OS. Future commits would have small
diffs again. Park as a separate cleanup; not blocking work.

---

**Standards audit (rule #17 — push #54 in S015 continuation,
push #3 in S016 unification arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A this push (rumble.js only)
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: timing change applies to all 5 passives uniformly via
    one setTimeout. No per-class delay variation.
  - ELEGANCE: 5-line change inside an existing function, not a new
    layer. Edge case (death-during-delay) handled in the deferred
    callback, not in the call site.
  - EFFICIENCY: one setTimeout, no new state, no new abstractions.
- Rule #19 (intuition): held — chose delay over longer duration
  because the latter had infrastructure cost (shared crit banner).

---

### v0.16.36 — Fixer overheal fix + FW gets banner cinematic when refreshBoost active

> "fixer passive, does it always raise hp to +1 of max health, even
> if damaged? dropped hp to 7/8 and still started rumble with 9/8,
> lets look into. also, should all byt FW have starting banners?"

Two fixes from playtest.

**Bug 1: Fixer hpOverheal SET hp absolutely, secretly healing damaged players.**

Previous code: `player.hp = (hpMax + amount)` — wrote 9 unconditionally for an
8 HP class. If player entered at 7/8 (one damage), rumble started at 9/8 — a
free 2 HP heal disguised as the +1 overheal pip. At 1/8, rumble started at
9/8 — an 8-HP free heal.

Fix: ADDITIVE +1 to current hp, capped at hpMax+amount (the overheal ceiling).

| Starting HP | Before fix | After fix |
|---|---|---|
| 8/8 (full) | 9/8 ✓ | 9/8 ✓ |
| 7/8 (mild) | 9/8 ✗ heals 2 | 8/8 (heals 1) |
| 1/8 (critical) | 9/8 ✗ heals 8 | 2/8 (heals 1) |

Picked the additive interpretation over "only fire at full hp" because it
matches BS armorBonus semantics (always +1, cap-aware). UNITY: same shape
across both cap-aware additive passives. Other interpretation (passive
lapses if injured) creates a gotcha — player wonders why passive didn't
fire when damaged. Additive is simpler and forgiving without being
broken (small +1 heal isn't game-breaking).

If playtest reveals the +1 heal at low HP feels wrong (e.g. "I should be
punished for entering damaged"), trivial swap to the conditional form
`if hp >= hpMax then hp = hpMax + amount`.

**Issue 2: FW had no banner cinematic on rumble entry.**

Other 5 classes get the v0.16.35 banner+flourish cinematic at t=1s.
FW had `rumblePassive: null` (intentional — FW's refreshBoost is
event-conditional, not unconditional rumble-start).

Fixed by upgrading the existing refreshBoost intake block. When server
sends `cfg.refreshBoost`, the visual now matches other classes:
banner + flourish, 1s delay, death-during-delay edge case handled.
Same vocabulary as other class banners. Different code path (still
fires from refreshBoost block, not from applyRumblePassive) but
visually unified.

**FW banner only fires when refreshBoost is queued.** If FW player
hasn't earned a refreshBoost from a recent blue event success, no
banner — silence is correct (nothing to announce).

**Banner label changed: "⚡ FORMWRIGHT CHARGE" → "⚡ RHYTHM SHIFT".**

Other classes use action-word banners (FIRST STRIKE, FIRST STEP,
BUILDER'S GUARD, MEND READY, BLIGHT MARK). "FORMWRIGHT CHARGE" was
class+effect. "RHYTHM SHIFT" is action. Better fits the family. If
you want different wording, trivial swap.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Fixer at full HP (8/8):** rumble entry → hp goes to 9/8.
   Banner "✚ MEND READY" at t=1s.
3. **Fixer damaged (e.g. 7/8):** rumble entry → hp goes to 8/8 (only
   +1, not free heal to 9/8). Banner still fires at t=1s.
4. **Fixer critical (e.g. 1/8):** rumble entry → hp goes to 2/8 (only
   +1). Banner fires.
5. **Fixer already at 9/8 (multi-rumble overheal):** rumble entry →
   stays at 9/8 (no overflow). Banner fires.
6. **FW with no refreshBoost** (no recent blue event): rumble entry,
   no banner. Player gets silence. Other classes still banner.
7. **FW with refreshBoost queued:** "⚡ RHYTHM SHIFT" banner +
   flourish at t=1s, in FW blue. Refresh boost active during 10s
   window.

---

**Risk surfaces:**

- Fixer overheal at near-cap edge case: at 9/8 (already overhealed),
  Math.min(9, 9+1) = 9, no change. ✓
- The interpretation choice (additive vs conditional) is a gameplay
  call. If the +1 heal at low HP feels wrong, easy revert.
- FW banner code path is separate from applyRumblePassive — refreshBoost
  is event-conditional. The visual is unified but the dispatch path
  isn't. UNITY: deferred to when we unify event-conditional buffs as
  a class data shape (probably v0.16.4x or later).

---

**Standards audit (rule #17 — push #55 in S015 continuation,
push #4 in S016 unification arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: hpOverheal now matches armorBonus semantics (additive,
    cap-aware). FW visual now matches other class banner family.
  - ELEGANCE: 3-line fix for the bug, ~15-line upgrade for FW
    visual. No new abstractions.
  - EFFICIENCY: reused setTimeout + spawnCritBanner + spawnCritFlourish
    pattern from v0.16.35.
- Rule #19 (intuition): held — chose additive over conditional for
  hpOverheal because UNITY (matches armorBonus shape).

---

### v0.16.37 — Strip disarmTrap entirely + universal clean-escape trap consumption

> "this is old, broken content. lets remove disarm trap completely
> for now. all classes should gain 1 orange brick for 100% success
> on orange trap event, otherwise trap persists on that space."
>
> "if player lands on orange space or they roll an orange space,
> they trigger trap. if they complete the event with 100% success,
> orange brick is removed from board and they gain it in inventory.
> if not 100% sucess, brick stays on board and they gain no brick"

Closes the Tier 3 thread of the v0.16.33 unification arc. The
disarmTrap action handler was identified as dead-code class
discrimination (3-way switch: BS gray-cost, SS yellow+chain,
default RNG with damage). UI button stripped in S015. Per Ross
spec: not worth refactoring dead code that no client invokes —
just remove it. Universal trap resolution handles everything now.

**Audit found a pre-existing bug:** trap-dodge resolution
incremented `G.orangeSpaces[p.space] += trapCount` on every
event resolution. Combined with the line-1330 trap-trigger path
(which doesn't decrement orangeSpaces), this meant **every failed
dodge DOUBLED the trap count on that space**. Players were
inadvertently building up traps by failing to dodge. Fixed in
this push as a side-effect of the universal-resolution logic.

**Behavior changes:**

1. **Clean escape (zero damage taken on dodge):**
   - +1 orange brick (existing reward, unchanged)
   - **NEW: trap REMOVED from space** (orangeSpaces[X] decrements
     by trapCount, deletes if zero)

2. **Partial / failed dodge:**
   - Damage taken normally (unchanged)
   - **NEW: trap STAYS on space** (no increment, no decrement —
     was previously incrementing, now stable)

3. **disarmTrap action handler removed entirely.**
   - server.js line 2500 area (3-way class switch) gone
   - server.js line 1682 area (event-trigger handler) gone
   - players-core.js handleDisarmChain function gone
   - players.html snapstepDisarmChain message listener gone

4. **Trap "DISARMED" UI card removed.**
   - players-core.js dead branch (`if (trapResult.disarmed)`)
     removed — server never sets disarmed=true anymore.
   - All trap outcomes now flow through cleanEscape vs damage path.
   - Card titles: "✓ DODGED" (clean escape) or "🗡 SPRUNG" (damage).

**Files changed:** `server.js`, `players-core.js`, `players.html`,
`NOTES.md`.

UNTOUCHED: characters.js, rumble.js, test_players.html, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **Land on orange trap, dodge cleanly (zero damage):** card shows
   "✓ DODGED" + 1 orange brick reward. Trap removed from board map
   — verify on board view.
3. **Land on orange trap, take partial damage:** card shows "🗡 SPRUNG"
   with damage. Trap STAYS on board for next visitor.
4. **Land on orange trap, fail dodge entirely:** card shows "🗡 SPRUNG"
   with full damage. Trap stays on board.
5. **Roll a new trap on space already trapped:** stacks (existing
   behavior in line 1401-1403).
6. **Multi-landing test:** land repeatedly on same trap, fail dodge
   each time. Trap count should stay STABLE (was previously doubling).
7. **No DM panel disarm action visible** — those handlers are stripped.
   DM still has adjustHP / adjustBrick / adjustGold for emergency
   adjustment.

---

**Risk surfaces:**

- The `trapResult.disarmed` field still gets set to false in the
  server response (line 1679). Inert — client doesn't branch on
  it anymore. Could clean up the field later but harmless to leave.
- "DISARMED" card with green theme + "Defused. The fortress concedes
  one brick." flavor is GONE. Clean escape now uses the existing
  "DODGED" card with same brick reward. Visual is slightly less
  ceremonial but consistent — a clean escape is a clean escape.
- Pre-existing bug fixed: repeat-dodge-failure no longer doubles
  trap count. Old saves with bloated orangeSpaces values from this
  bug will normalize over time as players clean-escape them away.

---

**Standards audit (rule #17 — push #56 in S015 continuation,
push #5 in S016 unification arc — TIER 3 CLOSE):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html stripped (1 line removed),
  test_players.html unchanged (no disarm refs there). ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: trap resolution is now universal — all classes treated
    identically. Class data file has no trap-disarm fields.
  - ELEGANCE: dead code removed entirely (3 sites + dead UI branch
    + dead helper function). Pre-existing trap-doubling bug fixed
    as side effect.
  - EFFICIENCY: ~80 lines removed across server + client. No new
    abstractions added.
- Rule #14 (UNITY): tier 3 closes the v0.16.33 unification arc.
  Three pushes (33, 34, 37) collectively unified armor cap, gray
  crit chance, rumble passives, and stripped class-action dead
  code. Class data discipline restored.
- Rule #19 (intuition): held — Ross's "this is old, broken content"
  was the right read. I almost defended Tier 3 schema work; pivoted
  to strip when Ross flagged it as dead code.
- Rule #6 (diagnostic-first): N/A — strip + spec implementation,
  no debugging needed. Bug found incidentally during audit.

---

### v0.16.38 — Blocksmith data lock: grayProfile + yellowProfile + starting kit swap

> "does DM board map show orange bricks on board? double check this
> while starting bs profile work"

DM map check confirmed: orange traps render correctly on DM board
(dm_screen.html:789) — small orange square + ×N count badge per
trapped space. Player-side board has no trap rendering (existing
design — players don't see traps until they land). After v0.16.37,
clean escape removes trap → DM map updates immediately. Failed
dodge → trap stays. No client-side changes needed for the visual
verification path.

**Now: Blocksmith data lock.** First push of the Blocksmith arc
this whole unification was clearing the way for. Pure data + one
new helper. Engine wiring lands in v0.16.39.

**The Forge identity (locked in S016 design conversation):**

Indirect damage through defense. BS has zero "swing" abilities.
All damage comes through reaction (shrapnel) or coercion (confuse).
Class fantasy: "I plant my flag, and the world turns on itself
trying to take it."

**Three changes to characters.js:**

1. **Starting kit swap:** gray:2 + orange:1 → gray:2 + **yellow:1**.
   Was mismatched (orange not in signature). Now matches signature
   colors directly. Orange remains as 2nd affinity (acquired via
   play, not in starting kit).

2. **grayProfile** (new):
   ```javascript
   {
     pipLostShrapnel: true,
     shrapnelDamageCurve: 'linear',  // dmg = armorBeforeLoss (1..6)
     wallDeathArmorRegen: 1,
   }
   ```
   - **pipLostShrapnel:** when attacker removes a BS armor pip,
     a shrapnel projectile flies from BS to attacker dealing damage
     equal to current armor count BEFORE pip loss. Visible plate/
     spike falls off and travels — cinematic vocabulary similar to
     Snapstep chain trigger / Breaker blast bloom.
   - **wallDeathArmorRegen:** when ANY BS-owned gray wall hits 0 HP,
     BS gains +1 armor pip. Forge cycle: walls absorb → walls die
     → BS armor refills → BS builds more walls.

3. **yellowProfile** (new):
   ```javascript
   {
     forcesConfuse: true,
   }
   ```
   - All BS yellow casts ALWAYS apply confuse (instead of daze).
     Overrides universal crit-roll gate. Confuse semantics already
     in engine (rumble.js:5606): confused entity walks toward
     nearest OTHER entity at full speed, attacks them with own
     damage value (1.2s cooldown). Real damage between enemies.
     Pairs with gray walls → confused enemies funneled into wall
     corridors → mutual destruction in kill zone.

**One new helper in characters.js:**

```javascript
function getYellowProfile(cls) {
  return (CHARACTERS[cls] && CHARACTERS[cls].yellowProfile) || null;
}
```

Mirrors existing pattern (getGrayProfile, getOrangeProfile, getRedProfile,
getBlueProfile). Engine reads via this getter — null = baseline behavior.

**No engine wiring yet.** Profile fields exist but engine doesn't
read them. Behavior unchanged this push:
- BS still has standard gray (armor pip on tap, wall ring on overload)
- BS still has standard yellow (crit-gated daze→confuse)
- Pip loss does not trigger shrapnel
- Wall death does not regen armor

That's intentional — data locks first, runtime wires next. If data
shape needs revision after eyeballing characters.js, we don't need
to undo engine wiring. Standard pattern from prior class profile
work (Breaker red/gray, Formwright blue/purple, Snapstep orange).

---

**Files changed:** `characters.js`, `NOTES.md`.

UNTOUCHED: rumble.js, server.js, players-core.js, html, boardFx,
dm_screen.html.

---

**Test focus:**

1. Hard refresh.
2. **BS starting kit:** new game / reset → BS starts with 2 gray + 1
   yellow bricks. Was 2 gray + 1 orange.
3. **BS rumble passive:** still triggers "🛡 BUILDER'S GUARD" banner
   at t=1s (unchanged from v0.16.34).
4. **No new behavior:** shrapnel doesn't fire on pip loss yet, wall
   death doesn't regen armor yet, yellow still crit-gated. All
   v0.16.39 territory.

**Verifying data lock:**

5. **Console** `CHARACTERS.blocksmith.grayProfile` → object with
   pipLostShrapnel:true, shrapnelDamageCurve:'linear', wallDeathArmorRegen:1.
6. **Console** `CHARACTERS.blocksmith.yellowProfile` → object with
   forcesConfuse:true.
7. **Console** `getYellowProfile('blocksmith')` → returns the object.
   `getYellowProfile('breaker')` → returns null.
8. **Console** `CHARACTERS.blocksmith.startingKit` → `{gray: 2, yellow: 1}`.

---

**Risk surfaces:**

- Starting kit change affects fresh games only. Existing saved
  games keep whatever bricks the player has. Cosmetic — affects
  initial state only.
- yellowProfile.forcesConfuse field exists but engine doesn't
  read it yet. Inert until v0.16.39 wires it up.

---

**Standards audit (rule #17 — push #57 in S015 continuation,
push #1 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (characters.js only)
- Rule #11 (data/runtime/UI): pure data push. Profile fields,
  starting kit, getter helper. Zero runtime/UI changes. ✓
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: yellowProfile getter mirrors existing pattern
    (getGrayProfile / getOrangeProfile / etc).
  - ELEGANCE: 3 declarative fields, 1 small helper. No new
    abstractions or schema invention.
  - EFFICIENCY: data-only push leaves engine wiring as a separate
    focused push. If field shape needs revision, undo is trivial.
- Rule #19 (intuition): held — split data from engine wiring per
  established pattern. Don't roll both into one push.

---

### v0.16.39 — Blocksmith engine wiring: shrapnel + wall regen + forced confuse

> "lets roll!"

The Forge identity comes alive. Three engine hooks wire up the
v0.16.38 data lock.

**Hook 1: Yellow forces confuse for BS (the simplest).**

Both `updateYellowAura` and `startYellowConfuse` had an `isCrit`
gate determining confuse-vs-daze. Now read
`getYellowProfile(player.cls)?.forcesConfuse` and OR with the crit
flag — BS forces confuse regardless of crit roll. Other classes
unchanged. Two 2-line additions, one in each function.

**Hook 2: Wall ownership stamp + wall-death armor regen.**

Wall creation (`startGrayWall` push) now stamps `ownerCls: player.cls`
so future class-specific wall-death reactions can route by owner.
New death-detection block at top of `updateGrayWalls` checks
`w.hp <= 0 && !w._deathFired` and fires `getGrayProfile(w.ownerCls)
.wallDeathArmorRegen` if present. Currently only Blocksmith populates
this field (regen: 1).

Visual: `+1 🛡` floating text + 8-particle amber flourish at player
position when regen fires. Reuses existing armor-pip vocabulary so
the player reads it immediately without learning a new visual.

**Hook 3: Shrapnel projectile system + pip-loss reactive.**

The meaty visual addition. Three new functions:

- `spawnShrapnel(sx, sy, tx, ty, dmg, targetEntity)` — pushes a
  shrapnel piece into the global array. Flight duration scales
  gently with distance (0.18s floor, 0.55s ceiling).
- `updateShrapnel(dt)` — tick lifecycle, fire `damageEntity` on
  impact. Prefers tracking the target entity (shrapnel follows
  moving targets); falls back to position-based hit at original
  target point.
- `drawShrapnel()` — renders an irregular pentagon shape (gray
  fill, amber stroke + glow) tumbling in flight. Subtle 18px arc
  peak for 2D feel.

`maybeSpawnPipShrapnel(armorBeforeLoss, srcX, srcY, srcEntity)`
helper reads `getGrayProfile(player.cls).pipLostShrapnel` and
fires shrapnel toward the attacker. Damage = pre-loss armor count
(pure linear curve: 1..6 for BS).

**Wired into both armor-absorb sites:**

- `_applyEnemyMeleeDamage` — handles all proxied damage (boulders,
  projectiles via dispatcher). Source position resolution: prefer
  `g.x/g.y` if real entity, else reverse-resolve from dx/dy offset,
  else fallback to player position.
- Direct entity touch — full entity in scope, use `g.x/g.y` directly
  with entity link for moving-target tracking.

**Cleanup:** `shrapnelPieces = []` added to rumble cleanup site.

**Game loop:** `updateShrapnel(dt)` after `updateBoulders`,
`drawShrapnel()` after `drawBoulders`. Same render layer as other
projectiles.

**Behavior summary:**

- BS rumble entry: +1 armor pip (existing v0.16.34 passive), banner.
- BS melee hit while armored: pip absorbed → shrapnel fires from BS
  to attacker, amber tumble in flight, hit deals N damage (pre-loss
  armor count). Attacker takes damage, gets amber flourish.
- BS overload-gray creates wall: stamps ownerCls=blocksmith.
- BS wall HP hits 0: BS gains +1 armor pip (cap-aware), `+1 🛡`
  text + amber flourish on player.
- BS yellow cast: ALWAYS confuses enemies (instead of crit-gated
  daze/confuse). Confused enemies attack each other.

**Forge cycle in motion:**
1. BS plants wall via overload-gray (existing)
2. Yellow field confuses enemies → they attack each other (NEW)
3. Confused/attacking enemies hit BS → armor absorbs → shrapnel fires (NEW)
4. Wall HP eventually depletes → BS gains armor pip (NEW)
5. Loop continues

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js (data already locked v0.16.38), server.js,
players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS yellow cast (any tier):** spawn enemies, fire yellow, watch
   them all turn confused (purple ring around entities, attack each
   other instead of player). Even on non-crit casts.
3. **BS gray wall + entity inside:** drag-place gray-overload wall
   around enemy. Watch wall HP tick down as entity contacts it.
   When wall hp hits 0: BS gains +1 armor pip with floating text +
   amber flourish. Verify pip count goes up and respects cap.
4. **BS armor absorb:** start with 6 armor, take a melee hit. Pip
   absorbs damage, shrapnel piece tumbles from BS toward the
   attacker, hits for 6 damage. Take next hit at 5 armor: shrapnel
   for 5. Etc. Linear curve all the way down to 1 = 1 dmg.
5. **Other classes unchanged:** verify BK gray wall doesn't grant
   armor pip on death. Verify BK/SS/etc yellow still rolls for
   crit confuse vs daze. Verify other classes don't fire shrapnel.
6. **Edge cases:**
   - Attacker dies before shrapnel arrives (shrapnel falls back
     to position-based hit; should hit any entity at original
     target point within 28px).
   - Multiple pip losses in rapid succession (each spawns its own
     shrapnel, all visible in flight).
   - Boulder/projectile pip loss (source resolution from dx/dy,
     shrapnel flies in correct direction).

---

**Risk surfaces:**

- Shrapnel direction relies on dx/dy resolution for proxied damage.
  If dx/dy is wrong (zero, NaN), shrapnel may fire toward player
  position. Fallback handles this gracefully.
- Wall death detection uses `_deathFired` marker. If wall HP gets
  reset to >0 after hitting 0 (unlikely but possible via DM tools),
  marker prevents re-firing.
- Yellow forcesConfuse override is called on every entity update
  tick (cheap function call). Performance impact negligible.
- Shrapnel could potentially friendly-fire if entity arrays change
  unexpectedly. Damage application uses `damageEntity(g, dmg)` which
  has its own safety checks.

---

**Standards audit (rule #17 — push #58 in S015 continuation,
push #2 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #11 (data/runtime/UI): pure runtime push reading data from
  characters.js (locked v0.16.38). No data shape changes. UI
  unchanged.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: shrapnel system follows existing projectile pattern
    (boulders, enemyProjectiles). Same array+update+draw shape.
    forcesConfuse override mirrors the same isCrit gate in two
    sites identically.
  - ELEGANCE: 3 new functions (spawn/update/draw), 1 helper
    (`maybeSpawnPipShrapnel`). Wall-death check is one block at
    top of updateGrayWalls. No new abstractions.
  - EFFICIENCY: minimal additions. Shrapnel reuses spawnCritFlourish
    for impact visual. Wall-regen reuses showFloatingText +
    spawnCritFlourish for armor-gain visual.
- Rule #19 (intuition): held — implemented The Forge identity per
  locked design without scope creep. No "while we're here, let's
  also..." additions.
- Rule #6 (diagnostic-first): N/A — feature work, not bug fix.

---

### v0.16.40 — Server starting kit unification + shrapnel-kill victory trigger

> "BS still has orange, no yellow. shrapnel looks to work, not seeing
> any victory screen on entity defeat, though"

Two distinct fixes from v0.16.39 playtest.

**Fix 1: BS starting kit didn't apply (server hardcoded brick literals).**

Symptom: BS starting kit in characters.js was already updated to
`{gray:2, yellow:1}` in v0.16.38, but rumble showed BS with
`{gray:2, orange:1}`. Found server.js line 93 hardcoded the kit
inline:
```javascript
blocksmith: mkPlayer('blocksmith', '🔧', '#C87800', 12, {gray:2, orange:1}),
```

**Same UNITY violation pattern we've been hunting.** Class data
living as runtime literals in a non-data file. Server was
duplicating the brick counts independently of characters.js.

Fixed: server.js now imports `CHARACTERS` and reads
`CHARACTERS[cls].startingKit` directly in `mkPlayer` calls.
Adding/changing a class kit = data change in characters.js, no
server logic surgery. HP / icon / color still hardcoded in mkPlayer
calls — TODO move those too in a future unification pass (parking
lot item, not blocking).

Also fixed: `getYellowProfile` was defined in characters.js
(v0.16.38) but never added to the `module.exports` list. Server-side
imports would have failed if it tried to use it. Added to exports
alongside other profile getters.

**Fix 2: Shrapnel kills didn't trigger victory screen.**

Symptom: kill enemy with shrapnel as last hit → no victory screen,
rumble hangs.

Root cause: damage sources in rumble.js individually call
`triggerVictory()` after their damage application (blue bolts at
line 7998, traps, chain detonations, etc). The pattern is:

```javascript
damageEntity(target, dmg);
if (target.hp <= 0) triggerVictory();
```

My v0.16.39 shrapnel only called `damageEntity`, never followed
up with `triggerVictory`. So shrapnel kills succeeded mechanically
(entity HP hit 0, _lootDropped fired, loot spawned) but the victory
overlay was never invoked because the trigger didn't fire.

Fix: `updateShrapnel` now calls `triggerVictory()` after any
damage application, matching the established pattern.

**Caveat for playtest:** if you're testing in `rumble_test.html`
(sandbox mode), no victory screen ever appears regardless of damage
source — sandbox mode RESPAWNS entities continuously by design.
Spec mode (real battles from board) is where victory triggers.

---

**Files changed:** `characters.js`, `server.js`, `rumble.js`,
`NOTES.md`.

UNTOUCHED: players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh + restart server (server changes need restart).
2. **BS starting kit:** new game / Reset → BS starts with 2 gray + 1
   yellow bricks. Was 2 gray + 1 orange.
3. **Shrapnel kill victory:** play BS in spec mode (real battle).
   Take a hit while armored → shrapnel fires back → if shrapnel
   kills the last enemy, victory screen appears. Should work
   regardless of which damage source kills the last entity.
4. **Other regressions check:** all classes still get correct
   starting kits. BK should be `{red:2, gray:1}`, Fixer
   `{white:2, black:1}`, etc.

---

**Risk surfaces:**

- Server changes require server restart to take effect, not just
  client refresh. If kit still wrong after refresh, restart node
  process.
- The hardcoded HP/icon/color in mkPlayer are still violations
  but lower priority. Move in a future pass.

---

**Standards audit (rule #17 — push #59 in S015 continuation,
push #3 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (no paired UI changes)
- Rule #11 (data/runtime/UI): UNITY restored. Starting kit data
  in characters.js, server reads from CHARACTERS, no duplicate
  literals. Future HP/color/icon migration noted but parked.
- Rule #14 (UNITY): caught a UNITY violation that survived the
  v0.16.33-37 unification arc because the audit only grepped for
  hardcoded class checks (`cls === 'X'`), not hardcoded class
  literals (object literals like `{gray:2, orange:1}`). Worth
  noting for future audits — broaden the grep pattern.
- Rule #19 (intuition): held — Ross's symptom was specific enough
  to find the actual root cause quickly (server hardcoding)
  rather than a wild-goose chase through client state.
- Rule #6 (diagnostic-first): N/A — both bugs had clear root
  causes from symptoms.

---

### v0.16.41 — UNITY audit Tier 2: strip remaining class-data literals from server

> "audit grep patterns, lets lock this in moving forward. no
> hardcoded moments, only elegant flow"

After v0.16.40 caught the starting-kit literals, ran a comprehensive
audit for all hardcoded class-data patterns. Found three tiers:

**Tier 1 — Class-name checks (`cls === 'X'`, 36 matches):**
- rumble.js:1280-1336 — armor pip rendering switch (UI only, acceptable)
- server.js:1170-1486 — event identity flags (`isFormwright`, `isFixer`, etc).
  Tagging events with class for downstream routing — pattern could be
  unified to `eventMeta.cls = cls` but each tag is a one-line check.
  Acceptable for now.
- server.js:1708-2256 — local class-id vars for branch logic (genuine
  per-class behavior). Some candidates for migration to data fields,
  noted in parking lot.
- players-core.js:3402-7866 — UI gating per class (Snapstep scout,
  Fixer cleanse, etc). Display-layer affordances. Acceptable.

**Tier 2 — Class-data object literals (real violations, fixed):**

This is what v0.16.40 partially caught. Comprehensive sweep here:

- `mkPlayer` had 5-arg signature with `(cls, icon, color, hp, bricks)`.
  All four trailing args were class data already in CHARACTERS.
  Stripped to `mkPlayer(cls)` reading everything from
  `CHARACTERS[cls].{icon,color,hp,name,startingKit}`.
- Class name map `{breaker:'Breaker', formwright:'Formwright', ...}`
  duplicated TWICE: server.js:109 and server.js:1131. Both replaced
  with `CHARACTERS[cls].name` reads. Pure duplication eliminated.

**Tier 3 — Brick color hex hardcoding (91 instances across files):**
Parking-lot project — large enough to deserve dedicated push. Pattern:
`'#D01012'`, `'#006DB7'`, `'#AAAAAA'` etc scattered through render
sites. Should read from BRICK_COLORS table that already exists.
Tracked in design parking lot for future sweep.

**Memory rule added (rule #27):** "BrickQuest UNITY audit grep
patterns" — codifies the three patterns to grep for, when to flag
each, and which sessions caught which. Future audits mandatory
before feature pushes.

---

**Files changed:** `server.js`, `NOTES.md`.

UNTOUCHED: characters.js, rumble.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh + restart server.
2. **Class display data:** all 6 classes show correct icon, color, HP,
   name in dashboard. BS shows 🔧, BK shows ⚔️, etc.
3. **Class HP correct:** BK 14, BS 12, WO 10, SS 9, Fixer 8, FW 6.
4. **Starting kit:** all kits correct per characters.js startingKit.
5. **Player name registration:** "X registered as Y" log message
   uses correct display name.
6. **No regressions** — gameplay otherwise unchanged.

---

**Risk surfaces:**

- mkPlayer signature changed. If anything else calls mkPlayer
  with old args, it would silently fail (cls becomes undefined).
  Verified: only one caller (line 90-95). Safe.
- Server requires restart (signature change in player init).

---

**Standards audit (rule #17 — push #60 in S015 continuation,
push #4 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (server.js only)
- Rule #11 (data/runtime/UI): UNITY restored. Server reads zero
  class data as literals — all from CHARACTERS canonical source.
- Rule #14 (UNITY): Tier 2 class-data leaks fully closed in
  server.js. Class display data (icon, color, name), gameplay
  data (HP, startingKit), all single-source.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one source for all class data. Adding a 7th class =
    add one entry to CHARACTERS, ZERO server changes.
  - ELEGANCE: mkPlayer became simpler (1 arg vs 5).
  - EFFICIENCY: removed ~20 bytes of duplicate string literals.
- Rule #19 (intuition): held — Ross's directive was clear ("no
  hardcoded moments, only elegant flow"). Audited comprehensively,
  fixed Tier 2 in scope, parked Tier 3 with explicit rationale.

---

### v0.16.42 — Centralize triggerVictory in damageEntity (UNITY restoration)

> "why does every attack have to trigger victory, isnt there a
> better way to do this? UNITY ELEGANCE EFFICIENCY?"

Ross caught a pattern Claude was about to enshrine — the v0.16.40
shrapnel fix and v0.16.42 confuse-attack fix were treating SYMPTOMS
of a deeper UNITY violation, not the root cause.

**The pre-existing pattern was wrong:**

Every damage source (red dash, blue bolt, orange chain, green
poison, purple tick, black DoT, witherbolt, shrapnel,
confuse-attack — 16 sites total) manually called
`triggerVictory()` after `damageEntity()`. That's the textbook
anti-pattern: scatter the same concern across every site instead
of centralizing.

This violated UNITY (single concept implemented in 16 places),
ELEGANCE (16 lines of duplicate guard logic instead of 1), and
EFFICIENCY (every new damage source = remember-the-trigger tax).
Confuse-attack was missing the trigger, but adding it manually
would have just added a 17th site to the same anti-pattern. Ross
declined the v0.16.42 push and asked for the right architecture.

**The right architecture: centralize at the damage choke point.**

`damageEntity` is the single function every damage path flows
through. Verified by grepping `g.hp = 0` / `g.hp = -` — no entity
death paths bypass damageEntity. Adding the victory check there
catches every damage source automatically.

**Implementation:**

```javascript
// At the bottom of damageEntity, before return:
if (g.hp <= 0 && typeof triggerVictory === 'function') {
  triggerVictory();
}
```

Then strip the 16 scattered call sites. Behavior identical;
architecture unified.

**Sites stripped:**

- 3759 (shrapnel update — added v0.16.40, same pattern)
- 5807 (confuse-attack — was the original symptom)
- 6372 (witherbolt impact)
- 7733 (red dash hit)
- 8009 (blue fixedPoint impact)
- 8052 (blue bolt direct hit)
- 8545 (orange chain detonation)
- 8646 (orange sealed-trap spawn)
- 8705 (orange bleed tick)
- 8786 (orange trap explosion)
- 9415 (green poison tick)
- 9814 (purple tick)
- 9990 (black weaken DoT)

Plus the dead `hitFired` tracking variable in shrapnel update —
no longer needed since shrapnel doesn't conditionally call
victory anymore.

**Standards lesson (rule #20 — grep for symptoms when unifying):**
the comprehensive damageEntity audit in v0.16.40-42 was the right
instinct, but the conclusion "fix each site individually" missed
the bigger pattern. UNITY-ELEGANCE-EFFICIENCY didn't permit the
scattered approach. Always look for the choke point.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Confuse-kill (BS Forge cycle):** plant wall + yellow + confused
   enemies kill each other → victory fires.
3. **Shrapnel kill:** BS armor absorbs hit → shrapnel kills
   attacker → victory fires.
4. **All other damage sources:** red dash kill, blue bolt kill,
   orange chain kill, poison tick kill, purple drain kill, black
   weaken kill, witherbolt kill — every kill path triggers victory.
5. **No regressions** — kill counts, loot drops, victory screen,
   stats display all work.
6. **Edge case:** if an entity gets revived (bone_rise) during the
   frame after a damageEntity that took it to 0 HP, the victory
   trigger should defer to the bonePending guard inside
   triggerVictory (existing behavior). Re-verify by killing a
   skeleton with a small hit.

---

**Risk surfaces:**

- triggerVictory has internal guards (`bonePending`, `running`,
  `entityRespawnPending`) that suppress spurious calls. Already
  hardened from prior development.
- Centralizing means triggerVictory fires more frequently than
  before (every damage that takes HP to 0, not just specific
  paths). Internal guards handle the multi-fire case correctly.
- Visual: spurious calls during death animations? Verified
  triggerVictory has the bonePending guard which handles
  bone_rise revives. Other death-but-not-really paths (if any
  exist in future) would similarly need guards inside
  triggerVictory.

---

**Standards audit (rule #17 — push #61 in S015 continuation,
push #5 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #14 (UNITY): MAJOR win. Pattern that violated UNITY since
  the early game design (16+ scattered calls) finally centralized.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: "did the rumble end?" lives in ONE place now.
  - ELEGANCE: 16 scattered triggerVictory calls → 1 central check.
    Stripped ~25 lines of duplicate guard logic + dead variables.
  - EFFICIENCY: new damage sources need zero awareness of victory
    mechanics. Adding a hypothetical new damage path = no
    triggerVictory bookkeeping required.
- Rule #19 (intuition): caught BY ROSS this push. The v0.16.42
  draft I made (adding 17th scattered site) was the wrong answer.
  Should have recognized the pattern myself when auditing v0.16.40
  shrapnel fix.
- Rule #20 (grep-for-symptoms when unifying): held — grepped all
  damageEntity sites and identified the choke point. Just had to
  step UP to the right architecture instead of flat-fixing each
  site.

**Lesson for future audits:** when finding multiple sites with the
same fix pattern, ASK FIRST: "is there a choke point upstream
where this fix could live once?" Don't replicate the fix N times.

---

### v0.16.43 — Fixer overheal climbs to 2× hpMax over multiple rumbles

> "shouldnt fixer 9/8 hp rise to 10/8 on rumble open? or is it capped?"
>
> "feels like fixer should keep climbing until reaching max overheal,
> which is 100% max hp"
>
> "fixer is only 16 max total when base hp is 8 and overheal is 8,
> every tumble start +1 hp. if at 1/8 and initiate rumble, start at 2/8"

Fixer's hpOverheal passive previously capped at hpMax + 1 (Fixer 9
max). After playtest, Ross identified the design intent: Fixer
should climb +1 per rumble entry until reaching 2× hpMax (16 max
for Fixer). Tank fantasy earned over a full board run. Mid-build
clarification corrected an over-engineered "requireFullHp" gate I
nearly shipped — final spec is simpler: +1 every rumble entry, no
gate, no reset on damage.

**hpOverheal schema extended (characters.js):**

```javascript
rumblePassive: {
  kind: 'hpOverheal',
  amount: 1,
  capMult: 2.0,    // ceiling = hpMax × 2 (Fixer 8 → 16)
  // ... label, color
}
```

**Behavior summary:**

| Starting HP | After rumble entry |
|---|---|
| 1/8 | 2/8 |
| 7/8 | 8/8 |
| 8/8 | 9/8 |
| 9/8 | 10/8 (overheal climb) |
| 15/8 | 16/8 (one rumble from cap) |
| 16/8 | 16/8 (capped) |

**Damage model:** overheal pips lost like normal HP. Take 4 dmg from
16/8 → 12/8. Climb resumes from 12/8 next rumble entry → 13/8.
Doesn't reset to baseline on damage.

**Heal interaction:** existing white-brick heal still caps at hpMax
(unchanged). Only the rumble-entry passive can push above hpMax. So
falling below hpMax → standard heal recovers to 8/8, then next
rumble-entry passive bumps to 9/8 and starts climbing again.

**Tank fantasy realized:** Fixer at 16/8 over 8+ rumbles is a
genuine tank state. Pairs with healer identity (white/black sig,
heal-self, drain). Steady fighting over a full board run earns the
buffer.

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Fixer 8/8 → enter rumble → 9/8 → exit/re-enter → 10/8.** Climb
   visible per rumble.
3. **Fixer at 1/8 → enter rumble → 2/8.** Climbs even when injured.
4. **Fixer at 16/8 → enter rumble → 16/8.** Cap holds.
5. **Damage from overheal:** take a hit at 14/8 → 13/8 (or whatever
   damage). Pips lost like normal. Next rumble entry → 14/8 (climb
   resumes from current).
6. **Healing during overheal:** white-brick heal at 16/8 → no effect
   (cap held by heal logic). Heal at 13/8 → up to hpMax (8) only.
7. **Banner still fires** as "✚ MEND READY" with 1s delay (existing).

---

**Risk surfaces:**

- The cap is `Math.floor(hpMax × capMult)`. For Fixer hpMax=8 ×
  2.0 = 16. Exact. Other classes with non-integer caps would
  floor (8 × 1.5 = 12). Not a concern for current spec.
- Existing players may currently be at 9/8 (old cap). On next
  rumble entry, they'll go to 10/8, then climb normally. No
  back-compat issues.

---

**Standards audit (rule #17 — push #62 in S015 continuation,
push #6 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (characters.js + rumble.js, no UI)
- Rule #11 (data/runtime/UI): UNITY held. capMult lives in data,
  dispatcher reads it. Adding another hpOverheal class with
  different cap = data change only.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: capMult is a schema field, not a hardcoded literal.
  - ELEGANCE: 4-line dispatcher case, no special-casing.
  - EFFICIENCY: simple math, no allocations.
- Rule #19 (intuition): mid-spec clarification caught me overshooting
  with a requireFullHp gate. Final spec simpler than what I started
  to code. Always re-check the spec when adding a "feature" before
  it lands.

---

### v0.16.44 — Blocksmith max-armor arc wall (The Forge capstone)

> "arc BS walls, what is BS wall health? all BS walls when armorpips
> max become arc walls?"
>
> "ideas was that full armor creates wall around BS, but arc only"
>
> "Q: Lock the arc wall design — A: A only — personal arc around BS
> at max armor"

The deferred "BS arc wall variant" finally lands. The Forge's
capstone payoff state — when BS reaches max armor (6 pips), a
directional arc materializes around them tracking the nearest enemy
and intercepts incoming hits IN PLACE of pip loss. A free first hit
while at full armor.

**BS gray wall HP context (clarified for record):**

BS gray walls (the field-planted ring walls from overload-gray) use
`getGrayWallHp(cls, tier) = round(5 × affinity × tier)` with
affinity 1.25 for gray-sig classes. T1 = 6 HP, T2 = 13, T3 = 19,
T4 = 25. This is universal universal, unchanged. Arc wall is a
SEPARATE mechanic.

**Three locked design decisions (this push):**

1. **Geometry:** directional arc tracking nearest enemy. ~120°
   wedge, ~45px radius. Smooth interpolation (8 rad/s).
2. **Blocks:** projectiles AND melee touch. Flank attacks bypass.
   Future fusion-tier upgrade reflects projectiles (parking lot).
3. **Pip-loss:** arc absorbs IN PLACE of pip. No pip loss, no
   shrapnel, no HP damage. Persists while at max armor.

**Schema (BS grayProfile):**

```javascript
maxArmorArc: {
  radius: 45, arcDegrees: 120,
  blocksProjectiles: true, blocksMelee: true,
  // reflectProjectiles: false — fusion-tier parking lot
}
```

**Engine additions (rumble.js):**
- `updateMaxArmorArc(dt)` — tick state, track nearest enemy, fade
- `drawMaxArmorArc()` — amber arc with pulse, two-stroke render
- `maxArmorArcInterceptsHit(srcX, srcY, hitType)` — predicate
- `spawnArcAbsorbFlash(srcX, srcY)` — feedback particles + text

**Damage path integration:** `_applyEnemyMeleeDamage` and direct
entity touch both check arc BEFORE pip damage. If intercepted →
skip damage, skip shrapnel, apply bounce + cooldown so entity
reads the impact.

**Forge cycle now has its capstone:**
1. Plant walls + cast yellow + confused enemies attack each other
2. They eventually hit BS → pip absorbs → shrapnel fires
3. Walls die → BS gains pips
4. **Reach max armor → arc materializes**
5. **Frontal hits absorbed by arc, no pip loss**
6. **Flanks/rears take pip → arc dissolves until next climb**

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS at 6/6 armor:** amber arc visible, tracking nearest enemy.
3. **Front hit at max:** "BLOCKED" + amber flash, no pip loss.
4. **Flank hit at max:** standard pip loss + shrapnel + arc gone.
5. **Climb back:** wall dies → +1 pip → arc returns at max.
6. **Other classes:** no arc visible at their max.
7. **Projectile vs arc:** intercepted in cone, normal outside.

---

**Risk surfaces:**

- Arc cone (120°) generous. Tuning knob: tighten if too forgiving.
- Smooth angle interp (8 rad/s) tunable.
- Multiple enemies in cone all absorbed unconditionally — intended,
  but watch for OP feel.
- Reflect-projectiles flag is parking-lot only.

---

**Standards audit (rule #17 — push #63 in S015 continuation,
push #7 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js + characters.js)
- Rule #11 (data/runtime/UI): UNITY held. Arc data in characters.js,
  engine reads via getGrayProfile. UI unchanged.
- Rule #14 (UNITY): arc system follows same vocabulary as shrapnel
  (spawn/update/draw/predicate/feedback). Parallel structure.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: state on player object matches existing transient
    effects pattern (refreshBoost, warpState, etc).
  - ELEGANCE: 4 helper functions, one schema field, two
    integration sites. No new systems.
  - EFFICIENCY: reuses spawnCritFlourish + showFloatingText.
- Rule #19 (intuition): proposed concrete spec, asked for 3 locks,
  built to spec without scope creep.

---

### v0.16.45 — Strip v0.16.44 OP arc, add static arc wall (redesign)

> "too op, should be the same shape, but a static wall that is placed
> at that moment. just like normal walls, but it is in place in front
> of BS, looks like regular walls, but only arc facing nearest enemy
> and is static in arena"

The v0.16.44 auto-tracking absorbing arc was OP. Permanent shield
that tracked enemies and absorbed every frontal hit at max armor =
free defensive layer. Ross flagged immediately on playtest.

**Redesign per design lock:**

The arc wall is a STATIC wall, placed once at the moment BS armor
maxes, facing the nearest enemy at trigger time. It's just a normal
gray wall in every way — same HP from getGrayWallHp formula (T1 BS =
6 HP), same alpha fade lifecycle, same gray visual vocabulary, same
wallDeathArmorRegen reaction. The ONLY difference: collision and
rendering are restricted to a wedge instead of a full ring.

**Architecture: reuse existing grayWalls[] system**

Massive UNITY win compared to v0.16.44's separate arc system. The
existing wall lifecycle handles everything; arc walls are just a
data variant pushed into the same array.

Wall data shape: same as ring walls + `{ isArc: true, arcAngle, arcSpan }`.
Branches in updateGrayWalls (collision) and drawGrayWalls (render)
check `w.isArc` and use wedge geometry instead of full ring.

Net code SHRUNK vs v0.16.44 — stripped ~150 lines of separate arc
system (updateMaxArmorArc, drawMaxArmorArc, maxArmorArcInterceptsHit,
spawnArcAbsorbFlash, damage-path absorption hooks, player._arcWall
state). Added ~80 lines of arc-wall integration (trigger function,
spawn function, point-in-arc helper, branches in update/draw).

**Schema (BS grayProfile):**

```javascript
maxArmorArcWall: {
  arcDegrees: 120,    // wedge span (1/3 of full circle)
}
```

That's it. No radius (fixed at 50px in spawn function — sensible
default; tunable knob if needed). No "blocksProjectiles/Melee" (it's
just a wall — entities bump into it, projectiles aren't a special
case). No reflectProjectiles (parking lot dropped — when fusion
lands, fusion-tier upgrades will be expressed via different schema
fields, this one stays simple).

**Engine:**

- `checkMaxArmorArcTrigger()` — runs each frame. Detects rising
  edge of `armor === armorMax` via `player._lastArmorAtMax` flag.
  On rising edge, calls spawnMaxArmorArcWall.
- `spawnMaxArmorArcWall(arcCfg)` — pushes into grayWalls[] with
  arc fields. Reads HP via getGrayWallHp(cls, 1). Resolves arcAngle
  from nearest enemy at this moment.
- `_pointInArc(w, px, py)` — predicate used by both collision and
  render. Tests if point is within wedge angle range.

**Wall lifecycle integration:**

- Player-pushback collision (in updateGrayWalls): SKIPPED for arc
  walls (`w.isArc`). BS is the center; pushback math doesn't apply.
  Standard ring walls still block player as before.
- Entity collision: arc walls block entities within wedge cone,
  pass freely outside cone. Same HP-tick mechanics as ring walls'
  outer-bump (2.0s cooldown per entity).
- Wall death: existing wallDeathArmorRegen path fires. Arc wall
  death = +1 BS armor pip (same as ring walls). Forge cycle continues.

**Forge cycle now:**

1. Plant ring walls + cast yellow + confused enemies attack each other
2. They eventually hit BS → pip absorbs → shrapnel fires
3. Walls die → BS gains pips (existing)
4. **At max armor (rising edge): static arc wall placed, facing
   nearest enemy at that moment** (NEW)
5. **Enemies bump arc, take wall HP down (or pass freely outside cone)**
6. **Arc wall dies → +1 pip to BS** (regen, same as ring walls)
7. **If BS climbs back to max: NEW arc wall at NEW position**

The cycle now has a tactical positioning element — the arc wall
faces wherever the threat was when armor maxed. BS plays around
that placement.

**Stripped from v0.16.44:**

- `updateMaxArmorArc(dt)` and game-loop call
- `drawMaxArmorArc()` and draw-loop call
- `maxArmorArcInterceptsHit(srcX, srcY, hitType)` predicate
- `spawnArcAbsorbFlash(srcX, srcY)` feedback
- `player._arcWall` state + cleanup reset
- Arc absorption logic in `_applyEnemyMeleeDamage` (top of function)
- Arc absorption logic in direct entity touch (updateEntity)
- `maxArmorArc` schema field in BS grayProfile

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS climbs to max armor:** static arc wall appears centered on
   BS, facing nearest enemy. Same gray visual as ring walls, just
   arc-shaped. Has HP bar.
3. **Enemy walks into arc cone:** bumps wall, wall HP ticks down
   on cooldown. Enemy bounces or stops at wall edge.
4. **Enemy approaches from outside cone:** passes freely (no
   collision), can reach BS normally.
5. **Arc wall HP depletes → wall dies → +1 pip to BS** (existing
   wallDeathArmorRegen). +1 🛡 floater appears.
6. **BS at full → arc fires.** BS takes pip-loss hit (drops from
   max). BS's own walls die → climbs back to max → NEW arc wall
   placed at new position (relative to current nearest enemy).
7. **BS moves around at max:** arc wall STAYS at trigger position
   (not at BS's current position). Static.
8. **No regressions** — ring walls (overload-gray drag-cast) still
   work normally. Other classes have no arc walls (no maxArmorArcWall
   data in their grayProfile).

---

**Risk surfaces:**

- Spawn position is at `player.x, player.y` at trigger moment. If
  BS is at arena edge, the arc could cap into the arena bounds.
  Existing wall-spawn code clamps cx/cy for ring walls; arc walls
  don't go through that path. Watch for visual oddities at edges.
- Trigger fires on RISING EDGE only. If BS starts at max armor (e.g.
  rumble entry passive on Tier 2+), the rising edge may not detect
  initial state. Verified `_lastArmorAtMax` defaults false on player
  init (cleared on rumble cleanup); first frame at max armor → rising
  edge → fires. Should work but worth verifying.
- Entity collision tests entity CENTER against wedge. Entities with
  large radii (bosses) might visually overlap the wall edge when
  they should logically collide. Acceptable for v0.16.45; tune later
  if it feels wrong.

---

**Standards audit (rule #17 — push #64 in S015 continuation,
push #8 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js + characters.js)
- Rule #11 (data/runtime/UI): UNITY restored. Arc wall data lives
  alongside other grayProfile fields. Engine reads via getGrayProfile.
- Rule #14 (UNITY): MAJOR win. Arc walls reuse the existing ring
  wall infrastructure (grayWalls[] array, lifecycle, draw, regen).
  Just a data variant via `isArc` flag. v0.16.44 was a separate
  parallel system; v0.16.45 is a branch in the existing one.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one wall system, two geometry variants (ring/arc).
  - ELEGANCE: schema is one field (`arcDegrees: 120`). Engine is
    rising-edge detect + push-into-array + branch in 2 places.
  - EFFICIENCY: net code SHRINKS vs v0.16.44 (~70 lines saved).
- Rule #19 (intuition): caught by Ross on playtest. v0.16.44 felt OP,
  redesign returned to fundamentals — "what's the simplest thing that
  matches the spec?" Static wall in grayWalls[] was the answer.
- Rule #20 (grep-for-symptoms when unifying): held — when stripping
  v0.16.44, grepped for all references to `_arcWall`, `maxArmorArc`,
  `updateMaxArmorArc`, `drawMaxArmorArc`, `maxArmorArcInterceptsHit`,
  `spawnArcAbsorbFlash`. All cleaned in single sweep.
- Rule #28 (unify-at-choke-point): held — the choke point was
  grayWalls[] lifecycle. Adding arc as data variant beat building
  parallel system.

**Lesson: when designing a new mechanic, ask "is this a variant of
something I already have?" before "is this a new system?" The OP
v0.16.44 was a new system. The right v0.16.45 was a variant.**

---

### v0.16.46 — Arc walls: cast-mode-switch, solid blocking, projectile interception

> "arc walls should be the same as ring walls, cannot pass through
> them, player or entity. arc walls stop projectiles, arc walls
> continue being made instead of ring walls when BS armor full"
>
> "only make arc walls when self cast, still ring walls when drag
> and drop. arc walls on self when armor full"

Three significant refinements to the arc wall design:

1. **Trigger model rewrite** — strip rising-edge auto-spawn from
   v0.16.45 entirely. Arc walls only fire from SELF-CAST (tap)
   gestures while BS is at max armor. Drag-cast always produces
   ring walls regardless of armor state. Gesture distinction maps
   directly to wall variant.
2. **Solid arc walls** — arc segment is solid: blocks player and
   entities from passing through (in cone direction). Open side
   (outside cone) remains freely passable.
3. **Projectile interception** — projectiles colliding with any
   gray wall (ring or arc) are absorbed and damage the wall on
   impact. Pre-existing gap: ring walls didn't block projectiles
   either. Universal fix in this push.

**Cast behavior matrix:**

| BS armor state | Self-cast (tap) | Drag-cast |
|---|---|---|
| Below max | Ring wall (existing) | Ring wall (existing) |
| **At max** | **Arc wall** (v0.16.46) | Ring wall (existing) |

**Other classes** without `maxArmorArcWall` data: mode-switch
never fires, self-cast at max behaves as standard pip flow
(pips → armor + overflow ring around nearest entity).

**Player collision for arc walls:**

BS starts at the arc center. The arc segment blocks BS from
escaping outward through the cone direction. Math: if BS's
position is within arc cone AND `dist > w.r - player.r`, push
back to inner edge. The OPEN side of the arc is freely passable
in both directions (no wall there).

**Entity collision for arc walls:**

Same logic as v0.16.45 — entities approaching from outside the
wall radius AND within the cone get pushed back to outer edge.
Outside cone passes freely. Confirmed correct per redesign;
no changes.

**Projectile collision (NEW for both wall types):**

Universal mechanic: any enemy projectile that collides with a
gray wall (within `w.r ± p.r`) is absorbed. Damages wall on
impact (HP -1, flash). For arc walls, additional cone check
via `_pointInArc`. Pre-existing gap closed: ring walls didn't
block projectiles either before this push.

**Stripped from v0.16.45:**

- `checkMaxArmorArcTrigger()` function (rising-edge detection)
- Game-loop call to `checkMaxArmorArcTrigger()`
- `_lastArmorAtMax` flag on player + cleanup reset
- `spawnMaxArmorArcWall(arcCfg)` — replaced by `spawnArcWall(tier)`
  called from cast site

**Added in v0.16.46:**

- `spawnArcWall(tier)` — called from `fireOverloadGray` when BS
  self-casts at max armor. Reads tier from cast count for HP scaling.
- Mode-switch in `fireOverloadGray`: at start of self-cast branch,
  check `armor === armorMax` AND has `maxArmorArcWall` data → spawn
  arc wall, return. Otherwise continue to standard pip flow.
- Player collision branch in `updateGrayWalls` for `w.isArc`: push
  back to inner edge if BS in cone moves past arc radius.
- Projectile collision in `updateEnemyProjectiles`: universal gray
  wall collision check (rings + arcs).

**Forge cycle now reads (with cast mode-switch):**

1. Plant ring walls via drag-cast (any armor state)
2. Yellow → enemies confused, attack each other
3. They eventually hit BS → pip absorbs → shrapnel fires
4. Walls die → BS gains pips
5. **At max armor: SELF-CAST gray now produces arc walls** instead
   of pumping armor (full) + overflow ring (NEW)
6. Arc faces nearest enemy, blocks projectiles + pushes entities
7. Arc dies → +1 pip back to BS via wallDeathArmorRegen
8. Cycle continues

The cast distinction is legible: drag = ring wall (placed elsewhere,
cages enemies), self-cast at max = arc wall (personal, around BS).
Each gesture has a clear purpose at the right armor state.

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS not at max + self-cast:** standard pip flow (pips → armor,
   overflow → ring around nearest). No arc wall.
3. **BS not at max + drag-cast:** ring wall at drag location. No arc.
4. **BS at max + self-cast:** ARC WALL appears centered on BS,
   facing nearest enemy. Standard gray vocabulary, arc-shaped.
5. **BS at max + drag-cast:** still ring wall at drag location.
   Drag-cast NEVER produces arc walls. Critical to verify.
6. **BS hits arc edge (in cone):** can't push through. Pushed
   back to inner edge. Wall HP ticks down.
7. **BS moves through open side of arc:** passes freely.
8. **Entity in arc cone:** bumps wall, blocked, wall HP ticks.
9. **Entity outside arc cone:** passes freely (open side).
10. **Enemy projectile aimed at BS through arc cone:** absorbed,
    wall HP ticks down.
11. **Enemy projectile aimed at BS from open side:** passes through,
    hits BS normally.
12. **Enemy projectile through ring wall:** ALSO absorbed now (this
    was a pre-existing gap, now fixed).
13. **Arc death → +1 pip.** Same as ring walls.
14. **Other classes self-cast at max armor:** standard behavior
    (no arc — they have no `maxArmorArcWall` data). Critical.

---

**Risk surfaces:**

- Universal projectile-vs-wall collision is NEW behavior. Players
  who built strategies around projectiles passing through walls
  may notice a mechanical change. Acceptable since walls
  intuitively SHOULD block projectiles.
- Player pushback for arc walls assumes BS is at center of arc.
  If arc has been displaced somehow (e.g. arena edge clamp at
  spawn), the math holds because `w.x, w.y` is the trigger
  position, and player is presumed near it. If BS warps outside
  the arc via Snapstep+BS multiclass, behavior becomes "from
  outside the cone, BS is free" which is correct.
- `spawnArcWall` reads `arcRadius = 50` as a fixed value. If
  this needs class tuning later, surface as schema field.

---

**Standards audit (rule #17 — push #65 in S015 continuation,
push #9 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js + characters.js)
- Rule #11 (data/runtime/UI): UNITY held. Mode-switch reads
  schema field; arc walls live in same array as ring walls.
- Rule #14 (UNITY): MAJOR win again. Cast dispatcher (single
  function, fireOverloadGray) does the mode-switch — one entry
  point covers both gestures and both armor states. Projectile
  collision is universal, not arc-specific.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: gesture → variant mapping is one branch in cast logic.
  - ELEGANCE: spawnArcWall consumed by cast site (proper
    integration, not auto-fired).
  - EFFICIENCY: stripped checkMaxArmorArcTrigger entirely. Net
    delete vs v0.16.45.
- Rule #19 (intuition): proposed two interpretations of "BS armor
  maxes" trigger, asked for clarification. User's answer was
  cleaner than either of my leans (gesture-conditional). Listening
  to the user's intuition on cast UX paid off.
- Rule #20 (grep-for-symptoms when unifying): held — when adding
  projectile collision, recognized ring walls had the same gap
  and applied universal fix.
- Rule #28 (unify-at-choke-point): held — projectile collision
  lives at one site (`updateEnemyProjectiles`), not duplicated
  per wall type.

---

### v0.16.47 — Arc walls "taller" than rings: arc-only projectile block + visual height

> "ring walls should not block projectiles, only arc walls...they
> are 'taller' than ring walls..."

Two refinements per design lock:

**1. Projectile collision narrowed to arc walls only.**

v0.16.46 added universal projectile-vs-gray-wall collision (rings
+ arcs). Per design clarification, rings should NOT block — they're
"shorter" containment fences that projectiles arc over. Arcs are
"taller" vertical barriers that erect at max armor.

Code change: gate the projectile collision check with
`!w.isArc → continue`. One-line filter; rest of collision logic
unchanged.

**2. Visual height cue for arc walls.**

To communicate that arc walls are "taller" structures, the render
now draws arcs with:
- Heavier primary stroke (lineWidth 7+ vs ring's 4+)
- Solid bright highlight stroke inside the dashed primary
  (suggests top edge of vertical barrier catching light)

Both are subtle — arc walls still read as gray vocabulary, just
with more visual weight. Players should perceive arcs as "more
substantial" without needing explicit explanation.

**Mechanical/visual design coherence:**

| Wall variant | Visual | Mechanical |
|---|---|---|
| Ring wall | Thin dashed gray ring | Cages entities, blocks player melee, projectiles pass over |
| Arc wall | Heavy dashed gray arc + bright highlight | Solid in cone direction, blocks projectiles, blocks BS from escaping outward through cone |

The split makes lore sense: drag-cast rings are quick traps placed
around the field (low containment fence), self-cast arcs at max
armor are erected vertical barriers (full-height defensive walls).

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Ring wall + projectile:** projectile passes through normally.
   No wall HP damage. (Reverts v0.16.46 universal block.)
3. **Arc wall + projectile in cone:** projectile absorbed, wall
   HP -1, projectile dies.
4. **Arc wall + projectile from open side:** projectile passes
   through to BS normally.
5. **Visual:** arc walls look notably "thicker" / more substantial
   than ring walls. Highlight stroke visible.
6. **All other v0.16.46 behaviors:** mode-switch (self-cast at max
   = arc, drag-cast = ring), solid arc collision (player + entity),
   wallDeathArmorRegen on arc death — all still work.

---

**Risk surfaces:**

- Visual change is subtle. If arc walls don't read as "taller"
  in playtest, can dial up — thicker lineWidth, more saturated
  highlight, or add a faux-shadow drop below the arc.
- Projectile collision narrowing: any feature that USED to expect
  rings to block (e.g. a tutorial scenario) may now break. Audit:
  no current scenarios depend on ring walls blocking projectiles
  (the v0.16.46 behavior was only 1 push old).

---

**Standards audit (rule #17 — push #66 in S015 continuation,
push #10 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #11 (data/runtime/UI): UNITY held. Mechanical split is
  data-driven (w.isArc); visual split lives in render branch.
- Rule #14 (UNITY): MECHANICAL/VISUAL coherence achieved. Arc
  walls have one mechanical AND one visual differentiator from
  rings, both reading the same `w.isArc` flag.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: arc identity expressed mechanically AND visually,
    both keyed off `w.isArc`.
  - ELEGANCE: 1-line filter for projectile narrowing.
  - EFFICIENCY: visual height cue is 2 extra strokes during
    render (only for arcs, which are rare on screen).
- Rule #19 (intuition): designer feedback "they are taller than
  ring walls" was the spec. Implementation matched directly —
  visual + mechanical split that maps to "taller" intuition.

---

### v0.16.48 — UNITY consolidation: delete startGrayArmor, route all gray casts through fireOverloadGray

> "arc wall is not coming up on full armor for bs, only seeing
> ring wall on closest entity for bs"
>
> "do it now, do not wait. unity first"

**Symptom:** BS at full armor + tap gray brick → overflow ring wall
around nearest entity instead of arc wall around BS. The Forge cycle
was broken for the brick-tap cast path.

**Root cause:** the v0.16.46 mode-switch was added to
`fireOverloadGray` but NOT to `startGrayArmor`. Both functions
implemented essentially the same gray cast pip flow + overflow ring
logic — drag/tap split, pip yield via `getGrayPips`, pip distribution
with overflow ring, mode-switch gate. Two functions doing one job.
User's tap path went through `startGrayArmor` (called from line ~6601
via `color === 'gray'` brick-tap dispatcher), which lacked the
mode-switch added in v0.16.46.

**Initial fix instinct (rejected):** mirror the gate to startGrayArmor,
flag the duplication in parking lot. This would have shipped the bug
fix but left the UNITY violation in place — guaranteeing a future bug
when someone else changes one function and forgets the other.

**Correct fix per Ross feedback ("do it now, unity first"):** delete
`startGrayArmor` entirely, route both call sites to `fireOverloadGray`.
Single canonical gray cast handler. The duplication caused this bug;
patching one half of the duplication just defers the next one.

**Implementation:**

1. **Line 6601** (brick-tap color dispatcher):
   `startGrayArmor(player.x, player.y)` → `fireOverloadGray(1, player.x, player.y)`
2. **Line 2680** (gesture dispatcher table):
   `startGrayArmor(cx,cy,1)` → `fireOverloadGray(1, cx, cy)`
3. **Function deleted:** `startGrayArmor(targetX, targetY, tier)` removed
   from rumble.js entirely. Comment marker left at the deletion site
   pointing to fireOverloadGray as the canonical entry.

Both call sites now route through ONE function. Future changes to
gray cast behavior live in one place. Mode-switch, pip flow, overflow
ring, drag-vs-tap split — all centralized.

**Memory rule alignment:**

- Rule #6 (diagnostic-first): exception applied. Bug had a clear
  gating restriction (mode-switch in only one of two duplicate
  functions). Skipped diagnostic phase per the "promote to TOP of
  response when finding clear gating restriction contradicting
  design intent" guidance.
- Rule #28 (unify-at-choke-point): the choke point WAS the gray
  cast handler — split into two functions. UNITY restored by
  collapsing back to one.

**Net code reduction:** ~50 lines deleted from rumble.js (full
startGrayArmor body removed). Net delete after this push.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS at full armor (6/6) + tap gray brick:** ARC WALL appears
   centered on BS, facing nearest enemy. (Was missing pre-v0.16.48.)
3. **BS at full armor + drag gray brick:** ring wall at drag location.
4. **BS at half armor + tap gray brick:** standard pip flow.
5. **BS at full armor + tier 2 gray cast:** arc wall with T2 HP scaling.
6. **Other classes at their max armor + tap gray:** standard overflow
   ring (no arc data, mode-switch never fires).
7. **No regressions:** ring wall behavior unchanged for non-BS, drag
   casts, and below-max BS casts.

---

**Risk surfaces:**

- Single-function consolidation means any bug in `fireOverloadGray`
  now affects BOTH cast paths. This is the correct trade-off —
  centralization makes bugs visible once, not duplicated invisibly.
- Visual differences between the two old functions (crit shockwave
  maxR `scaleDist(160)` vs `scaleDist(140)`, particles 18 vs 14,
  armorBursts alpha 0.9 vs 0.8) — `fireOverloadGray` values now
  apply uniformly. Slightly bigger crit visual on tap path.
  Acceptable; visually consistent now.

---

**Standards audit (rule #17 — push #67 in S015 continuation,
push #11 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #6 (diagnostic-first): exception (clear gating restriction).
- Rule #14 (UNITY): MAJOR win. Two functions → one. Pre-existing
  duplication that caused this bug (and would have caused future
  bugs) eliminated.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: gray cast = one function, period.
  - ELEGANCE: 50 lines deleted, no logic added.
  - EFFICIENCY: net code reduction. Future changes to gray cast
    economy = one place.
- Rule #19 (intuition): caught by Ross's "unity first, do it now"
  feedback. Initial instinct (patch + parking-lot) was wrong;
  the right move was to fix the duplication itself.
- Rule #28 (unify-at-choke-point): held — the choke point is now
  ACTUALLY a single point. Was split, now unified.

**Lesson:** when a bug is caused by duplicated logic, fix the
duplication, not just the bug. Patching one half of a duplication
just defers the next bug to whoever next changes the other half.

---

### v0.16.49 — Arc wall collision fixes: narrow band + inside-arc no damage

> "BS getting pulled back to center of arc when moving outside of
> radius. damage to the arc should only happen from out of arc,
> not inside arc"

Two collision bugs in v0.16.46/v0.16.45 implementation:

**Bug 1: BS pulled back to arc center.**

Player collision logic was: "if BS is within cone direction AND
beyond inner edge → push to inner edge." This tested ANGLE-FROM-CENTER
without bounding by arc radius. Result: BS could be 200px from the
arc, but if their angle-from-center happened to be in the cone,
they'd get teleported to ~36px from arc center.

**Fix:** narrow collision band — only fires when BS is in the band
`[w.r - player.r, w.r + player.r]` AND in cone. Outside the band
in either direction (too close to center, or too far) → freely
passable. Same fix applied to entity collision branch.

**Bug 2: BS damaging own arc by leaning on it from inside.**

Per design intent: damage to arc walls should only come from OUTSIDE
the arc (enemy hits from outside-in). Owner leaning against arc
from inside should be a soft-block but no HP loss — owners shouldn't
break their own walls.

**Fix:** in player + entity collision, gate HP damage on
`dist >= w.r` (hit from outside). Inside hits are clamped to
inner band edge but no HP tick. Also applied to projectile
collision for consistency (edge case: projectiles fired from
inside the arc don't damage it).

**Combined effect:**

- BS at center, no enemies → arc wall present, no collision interactions
- BS pushes outward through arc cone → soft-blocked at inner edge,
  no HP loss
- BS pushes outward through open side → passes freely
- Enemy approaches arc through cone from outside → bumps wall edge,
  HP ticks down (existing behavior, preserved)
- Enemy approaches arc from open side → passes freely (existing,
  preserved)
- Projectile from outside through cone → blocked + HP tick
- Projectile from inside through cone → blocked but NO HP tick
  (new edge case rule, applies symmetrically)

**Owner identity preserved:** BS arc walls are tools BS deploys.
They don't get destroyed by their own movement. Pre-fix, BS leaning
on the arc from outside (the bug's effect of teleporting BS to a
point near center) ALSO ticked wall HP down, which was a double
problem — wrong position AND self-inflicted wall damage.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **BS at full armor + tap gray** → arc wall fires (v0.16.48 verified).
3. **BS walks AWAY from arc through open side** → moves freely, no
   pull, no clamp.
4. **BS walks TOWARD arc cone direction from inside** → soft-blocks
   at inner edge of arc. Doesn't pull to center. Doesn't damage wall.
5. **BS walks across the arena with arc wall behind them** → no
   interaction (out of band).
6. **Enemy bumps arc cone from outside** → bumps wall, HP -1 on
   cooldown. Same as before.
7. **Enemy walks through open side** → passes freely.
8. **Projectile through cone toward BS** → absorbed + wall HP -1.
9. **No regressions:** ring walls, drag-cast walls, other classes.

---

**Risk surfaces:**

- Narrow band may feel too thin for fast-moving entities (single
  frame can skip across the band entirely on high-speed dashes).
  Acceptable for v0.16.49; if it becomes a problem, swept-collision
  detection across previous-position to current-position would fix.
- Inside-vs-outside damage gate uses `dist >= w.r` cleanly. Edge
  case at exact `dist === w.r` resolves to "outside" → damage
  fires. Acceptable behavior (entity is exactly on the wall surface).

---

**Standards audit (rule #17 — push #68 in S015 continuation,
push #12 in S016 Blocksmith arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #14 (UNITY): held — narrow-band + inside-no-damage rules
  applied symmetrically to player, entity, AND projectile branches.
  All three follow the same shape: band check + cone check +
  outside-only damage gate.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: same collision rule across all three colliders.
  - ELEGANCE: explicit band variables (innerBand, outerBand) +
    explicit `fromOutside` flag. Reads as written.
  - EFFICIENCY: minor refactor, no new abstractions.
- Rule #19 (intuition): your two-bug report was crisp. Both fixes
  followed directly from the spec.
- Rule #20 (grep for symptoms when unifying): held — when fixing
  player collision, immediately checked entity + projectile
  branches for the same pattern. All three got symmetric treatment.

---

### v0.16.50 — SS red identity foundation: pierce-dash

> "SS red identity first"
>
> "1 and 3 together [pierce + trail]"
>
> "No cap — hit everything in path"

**Snapstep red identity depth pass.** SS had only `redProfile: { rangeBase: 240, rangeAffinityBonus: 1.25 }` — just extended reach, no signature mechanic. v0.16.50 ships the foundation; v0.16.51 will add the slipstream trail + push-back burst.

**The Pierce-Dash:**

SS dashes through entities — multi-hit along the path, no recoil, no AOE blast. Hits every entity in line at full damage, no entity cap. Light knockback (slipped past, didn't punch). Dash terminates at max range or wall block.

**Mechanical contrast with BK red:**

| | BK red | SS red |
|---|---|---|
| Model | aoe-blast | pierce |
| First-hit terminates | Yes | No |
| Damage targets | First + AOE radius | Every entity in path |
| Knockback | 2.0× radial | 0.4× forward |
| Recoil | No | No |
| Visual | Heavy blast ring + central bloom | Streaking trail particles + per-target sparks |
| Identity | "Stop, hit big, push everything outward" | "Go through, hit everyone, don't slow down" |

Same color, same dash gesture, completely different identity. Schema-driven via `dashProfile.dashModel`.

**Schema additions to SS redProfile:**

```javascript
redProfile: {
  rangeBase: 240, rangeAffinityBonus: 1.25,
  hitboxScale: 1.0,
  knockbackScale: 0.4,                // light, slipped past
  dashModel: 'pierce',                // v0.16.50 new model
  pierceDamageFalloff: 1.0,           // full dmg to all pierced
  knockbackMode: 'forward',
  recoilOnHit: false,
  blastVisual: null,
  critScreenShake: null,
  // v0.16.51 trail config (parking-lot for next push):
  // trail: { damageFraction: 0.5, duration: 1.7, tailBehindOrigin: 100, ... }
}
```

**Engine additions:**

- `dashModel === 'pierce'` branch in dash hit detection. Each frame
  during charge, finds ALL entities inside the bubble that aren't in
  `_hitSet`, applies damage to each, adds to `_hitSet`. Does NOT set
  `brickAction.hit` — dash continues until range cap or wall block.
- Pierce charge-phase trail particles: small red trail behind player
  during dash. Schema-gated to pierce model (other models unchanged).
- Per-target spark on each pierce hit (small flourish, not a full
  blast).
- Crit visual on first pierce hit: thinner shockwave (smaller than
  recoil/blast — pierce identity is fast, not flashy).
- `getRedDashProfile` extended to normalize `pierceDamageFalloff`
  and `trail` fields. Default values match baseline (no pierce, no
  trail) so other classes are unaffected.

**Forge cycle for SS red (post-v0.16.50, pre-trail):**

1. Position SS at one end of a line of enemies
2. Drag-cast red toward the line
3. Dash flies through, hits every entity in the bubble path
4. Dash terminates at max range or hits a wall
5. Each entity took full damage, no recoil, SS is now at the far end

This sets up tactical positioning play — SS aligns with multiple
enemies for max value per dash. Future v0.16.51 trail will reward
the followup ("they pursue, they eat trail damage").

---

**Files changed:** `characters.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **SS dashes through aligned line of 3 enemies** → all 3 take full
   damage, dash continues to range cap or wall.
3. **SS dashes through 1 enemy** → enemy takes damage, dash continues.
4. **SS dashes into empty space** → no damage, dash continues to
   range cap as before.
5. **SS dashes into wall** → blocked, dash terminates (existing wall
   sweep behavior preserved).
6. **BK dash unchanged** → still single-hit + AOE blast + radial
   knockback, no recoil. SS-only mechanic isolated by data.
7. **Other classes (Fixer, FW, WO) red dash unchanged** → recoil
   model with single-hit + recoil to start.
8. **Visual:** SS dash leaves a trail of red particles. Each pierce
   hit shows a small red flourish at the entity. Crit on first hit
   shows a small orange shockwave.
9. **Crit pierce:** first pierce hit triggers a thinner shockwave
   ring (not the full BK-style two-ring blast). Per-target sparks
   (4 each).

---

**Risk surfaces:**

- Pierce damage scales linearly with entities aligned. 6 enemies in
  a line = 6× full damage. This is intended — rewards positioning —
  but could feel OP if enemies cluster naturally. Tune via
  pierceDamageFalloff if needed (e.g. 0.85 = first full, then 85%
  cumulative).
- Knockback is forward (push along dash direction). With pierce, the
  pushed entities might end up just outside the dash bubble for the
  rest of the path, dodging the multi-hit. Acceptable behavior — the
  knockback is slight (0.4×) so they should still mostly stay in path.
- _hitSet reset between dashes via brickAction lifecycle — when
  brickAction = null, hitSet goes with it. Safe.
- Drag preview still shows the recoil-style bubble (no pierce-line
  preview). Polish for later if pierce identity needs more visual
  communication.

---

**Standards audit (rule #17 — push #69 in S015 continuation,
push #1 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js + characters.js)
- Rule #11 (data/runtime/UI): UNITY held. Pierce is dispatched
  via dashModel field. Engine reads schema, no class-name checks.
- Rule #14 (UNITY): pierce model lives alongside recoil + aoe-blast
  in the same schema. New behavior = new dashModel value, no
  parallel system. Symmetric extension of v0.15.13 architecture.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: same dispatch shape (charge → hit detection → terminate),
    pierce diverges only in the hit-detection branch.
  - ELEGANCE: pierce branch is one if/else block in the existing
    function; doesn't restructure the dispatcher.
  - EFFICIENCY: per-frame entity sweep is O(n) for both pierce
    and recoil; same cost.
- Rule #19 (intuition): your "1+3 combined" answer was bolder than
  my proposal (which leaned pierce-only). Building both identity
  beats together makes the SS arc complete instead of split.

---

### v0.16.52 — SS pierce polish (perpendicular knockback, slipstream trail) + riddle Collect button fix

> "keep knockback, but away from path, not pushing entity through
> path to end. all entities knockback same, all entities pierced,
> armored entities only block half as well"
>
> "[riddle] Collect button doesn't appear or is non-functional"

Combined push closing two threads at once: SS red identity polish
+ a bug fix on the riddle event Collect button that surfaced
during testing.

---

**SS Pierce-Dash Polish (continuation of v0.16.50 foundation):**

Several refinements after playtest:

1. **Perpendicular knockback (was: forward 0.4×, then removed entirely
   in v0.16.51 work, now: perpendicular fixed magnitude).**
   Entities pierced by SS are knocked SIDEWAYS out of the dash path,
   not forward through it. Side determined by cross-product of the
   entity's offset from the player and the dash direction:
   - Cross < 0 (entity left of dash) → knocked further left
   - Cross >= 0 (entity right of dash) → knocked right
   Magnitude is fixed (220 base, 360 on crit) — no per-entity
   weight scaling. Identity beat: "you cut through them so fast
   they spun out of the way."

2. **Front-shield reduction softened to 25% for piercing hits**
   (was 50%). Pierce attacks pass through defenses but don't
   ignore them. damageEntity extended with `opts.piercing` flag;
   shield block math reads it.

3. **Slipstream trail spawned on dash completion.** Red highlight
   line covering (origin - 100px in dash dir) → end point.
   Persists 1.7s, fades alpha. Entities crossing the line take
   50% pierce damage (one hit per entity per trail). Two-stroke
   render: outer glow + bright core.

4. **Push-back burst at origin point A on dash completion.**
   Radial knockback within 60px of point A (240 velocity). Visual:
   shockwave + flourish in red vocabulary. Anti-pursuit beat: "I
   left, don't come this way."

5. **Trail config in characters.js redProfile.trail** (was parking-
   lotted in v0.16.50, now active):
```javascript
trail: {
  damageFraction: 0.5,
  duration: 1.7,
  tailBehindOrigin: 100,
  pushBackBurstRadius: 60,
  pushBackBurstStrength: 240,
}
```

**Forge cycle for SS red, complete:**

1. Position SS at one end of a line of enemies (or pursue a target)
2. Drag-cast red toward the line
3. Pierce-dash flies through, hits every entity in path
4. Each pierced entity spins out perpendicular (no path-blocking)
5. Dash terminates at range cap or wall block
6. **Slipstream trail persists 1.7s** behind SS — covers dash path
   plus 100px tail extending behind origin
7. **Push-back burst at origin** knocks back enemies near where
   SS started
8. Pursuing enemies cross the trail → take 50% damage
9. Trail fades. Cycle ready to repeat.

---

**Riddle Collect Button Fix:**

**Symptom:** When a player won a riddle (correct answer), the
yellow brick was credited server-side immediately, but the Collect
button didn't appear in the UI. The brick reveal FX never fired
until DM resolved the event.

**Root cause:** `_collectedResolutions` dict was not cleared when
activeEvent became null between events. If the same player landed
on two yellow-brick spaces (both events have `roll: 'SPACE'`,
`evType: 'riddle'`, same cls), the second event inherited the
`collected: true` flag from the first, suppressing its Collect
button entirely. The flag check at `restoreActiveEvent()` line ~801
wiped the entire `landing-result` panel for any "collected" event.

**Fix:** add `_collectedResolutions = {};` to the existing cleanup
block at render() top (line ~781) that already wipes other state
dicts when `!G.activeEvent`. One-line addition; aligns
`_collectedResolutions` with the cleanup pattern of its peer
state dicts (`_drainedTokens`, `_cardFading`, etc).

**Why this wasn't caught earlier:** the bug only manifests when
the SAME signature key recurs. First-occurrence riddles always
worked fine (no stale flag). Bug requires (a) player wins a
riddle, (b) DM resolves, (c) same player lands on another
riddle space later in the game.

---

**Files changed:** `characters.js`, `rumble.js`, `players-core.js`,
`NOTES.md`.

UNTOUCHED: server.js, html, boardFx.

---

**Test focus — SS pierce:**

1. Hard refresh.
2. **SS dashes through aligned line of 3 enemies** → all 3 pierced,
   each spins out perpendicular (left or right depending on which
   side of the dash they were on). Dash continues to range cap.
3. **SS dashes through 1 enemy** → enemy knocked sideways
   (not forward), dash continues.
4. **Pierce + crit** → knockback magnitude 360 (was 220).
5. **Pierce vs. front_shield knight** → shield reduces by 25%
   (was 50%). Damage gets through better.
6. **Slipstream trail visible** for 1.7s after dash, covers path
   plus 100px behind origin. Two-stroke render.
7. **Pursuing entity crosses trail** → takes 50% pierce damage,
   marked as hit (no double-tick from same trail).
8. **Push-back burst at origin** when dash completes — entities
   near point A knocked outward radially.

**Test focus — riddle Collect:**

1. Player lands on yellow-brick space, answers riddle correctly.
2. Collect button appears immediately in resolution card.
3. Tap Collect → brick shower FX fires, yellow brick added to
   inventory. ✓ (this was the FIRST riddle case, already worked.)
4. **DM resolves the event. Player lands on ANOTHER yellow-brick
   space (or any other riddle event). Answers correctly.**
5. **Collect button NOW appears** (was missing pre-v0.16.52).

---

**Risk surfaces:**

- Perpendicular knockback magnitude (220/360) is a tuning knob.
  May need adjustment after extended playtest. Fixed values not
  in characters.js schema yet — easy to expose later.
- Trail damage fraction (50%) and duration (1.7s) are in schema.
  Tunable per-class without engine touch.
- Pierce damage scales linearly with entities aligned (no
  falloff). 6 enemies in line = 6× full damage. Intended for
  positioning reward; can dial back via `pierceDamageFalloff`
  if it feels OP.
- The riddle fix is broader than just riddles — applies to any
  event where the same `cls + roll + evType` key recurs. Should
  be net positive.

---

**Standards audit (rule #17 — push #70 in S015 continuation,
push #2 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (changes go through players-core.js
  which both players.html and test_players.html load)
- Rule #11 (data/runtime/UI): UNITY held. Trail config lives in
  characters.js, engine reads it. UI bug fix lives in players-
  core.js render lifecycle.
- Rule #14 (UNITY): pierce identity now mechanically AND visually
  consistent — perpendicular knockback reads "you spun out of my
  way," trail reads "I went THIS way and it's still hot," burst
  reads "I left, don't come this way." Three beats, one identity.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: trail spawn lives at single dispatcher (pierce dash
    termination). Collected-flag cleanup lives at single
    activeEvent-null check.
  - ELEGANCE: knockback math is one cross-product line. Fix is
    one-line addition to existing cleanup block.
  - EFFICIENCY: trail collision is O(n×trails) per frame; trails
    typically 0-2 active at once.
- Rule #19 (intuition): your "perpendicular not forward" feedback
  was sharper than my "remove entirely" lean. Sideways spin reads
  as both impactful and pierceable in a way zero-knockback didn't.
- Rule #28 (unify-at-choke-point): held — added cleanup at the
  single existing null-check site rather than creating a new
  transition tracker. Simpler, more aligned with the pattern.

---

### v0.16.52 — SS pierce overlap resolver fix + diagnostic

> "goblin and skeleton knight are pushed to end of dash line, not
> perpendicular. lets solve this!"

**Root cause:** the player-vs-entity overlap resolver at
rumble.js line 855-869 was running every frame during the dash,
instant-teleporting entities along the player→entity vector to
maintain `minDist = player.r + entity.r` separation. During a
dash, the player moves forward at ~1040 px/sec — the resolver
pushes entities aside on each frame, accumulating displacement
that overwrote the perpendicular knockback velocity set at
pierce hit.

The bounce-state movement (line 5639-5652) was firing AFTER the
overlap resolver, so velocity-based knockback was fighting against
the resolver's instant teleport. Resolver won.

**Clear gating restriction (per memory rule #6):** the resolver
was a UNITY violation against pierce identity ("go through, hit
everyone, don't slow down"). Promoted directly to fix; diagnostic
ships alongside to confirm root cause via console logs over a
single playtest, then strips next push.

**Fix:** detect pierce-dash via `brickAction.type === 'red'
&& phase === 'charge' && getRedDashProfile(cls).dashModel === 'pierce'`.
When active, skip the entity overlap resolver entirely. Pierce
identity restored: entities stay where the pierce hit them, then
get knocked perpendicular via bounce velocity over the next ~0.3s.

Other dash models (BK aoe-blast, recoil-default) still get the
resolver — they're physical-impact dashes where entity displacement
is part of the design.

**Diagnostic blocks** (will strip in v0.16.53):
- At pierce hit: log entity position, dash direction, computed perp
  vector, knockback velocity. Tag `entity._pierceDiagFrame = 1`.
- In overlap resolver: if entity is tagged, log pre/post position
  and push vector. (Now bypassed since resolver skips during pierce
  dash, so this log won't fire if the fix is correct.)
- In bounce update: if entity is tagged, log final position +
  velocity, then clear tag.

If diagnostic shows resolver-displacement still firing on tagged
entities, the gate condition in step 1 is wrong and we need
deeper investigation. If diagnostic shows clean perpendicular
movement only via bounce, fix is confirmed and we strip.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **SS dashes through goblin** → goblin gets knocked PERPENDICULAR
   to dash, not displaced forward to dash endpoint.
3. **SS dashes through skeleton knight** → same, perpendicular spin-out.
4. **SS dashes through line of 3 enemies** → all 3 spin out
   sideways (some left, some right based on which side of dash
   line they were on).
5. **BK dash unchanged** → entities get bumped/blasted as before
   (pierce-only fix doesn't affect aoe-blast model).
6. **Other classes' red dash unchanged** → recoil model preserved.
7. **Console logs** — open browser console during pierce dash.
   Should see [PIERCE-DIAG hit] then [PIERCE-DIAG bounce] but
   NOT [PIERCE-DIAG resolver]. If resolver fires, gate is wrong.

---

**Risk surfaces:**

- The pierce-dash detection runs per-frame in the player-update
  block. Cost is one function call + property access per frame
  during the dash window only — negligible.
- If pierce-dash player encounters an entity at frame 1 (entity
  spawned ON player or teleported in), no overlap resolver means
  player and entity could occupy the same space. Pierce hit logic
  still fires and damages the entity, then bounce velocity moves
  entity out. Brief visual overlap acceptable for the brief moment.
- Other dash models (recoil, aoe-blast) unaffected — their
  overlap resolver behavior is unchanged.

---

**Standards audit (rule #17 — push #71 in S015 continuation,
push #3 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #6 (diagnostic-first): exception applied. Clear gating
  restriction (overlap resolver overriding pierce knockback).
  Diagnostic ships alongside fix to confirm via real telemetry.
- Rule #11 (data/runtime/UI): runtime fix; pierce model detection
  reads schema. UNITY held.
- Rule #14 (UNITY): pierce identity now consistent across BOTH
  hit detection AND collision resolution. Two systems, same flag,
  same dispatch shape.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: single gate condition (pierce dash detection) covers
    all entities for the resolver bypass.
  - ELEGANCE: 3-line detection block + 1-line guard in forEach.
  - EFFICIENCY: pierce-dash check is one function call/frame
    during dash window only.
- Rule #19 (intuition): caught suspect via grep for "push" pattern
  in entity-update code; clear gating restriction surfaced
  immediately. Skipped extended diagnostic-first phase per rule #6.
- Rule #20 (grep-for-symptoms): held — searched for patterns
  matching "entity displacement during dash" before ruling out
  candidate causes.
- Rule #28 (unify-at-choke-point): held — single resolver site
  carries the pierce-dash bypass, not duplicated per entity type.

---

### v0.16.53 — SS pierce resolver redirect + comprehensive dash diagnostic

> "need diag for red dash, bizarre behavior for ss, getting caught
> on entity, shaking around, starting in odd places"

**Two threads in one push:**

**1. Resolver redirect (fix attempt for caught/shaking/odd-start):**

v0.16.52 attempted to bypass the player-vs-entity overlap resolver
entirely during pierce dash. This solved the forward-displacement
bug but introduced new symptoms:
- "Caught on entity" — without overlap separation, player visually
  clips into entities
- "Shaking around" — wall-sweep + arena-clamp interacting weirdly
  with overlapping bodies
- "Starting in odd places" — likely visual artifact of dash starting
  with player partially inside an entity hitbox

v0.16.53 takes a different approach: keep the resolver running
(visual separation matters), but during pierce dash redirect its
push direction to PERPENDICULAR (matching the bounce knockback).
This preserves visual cleanliness while keeping pierce identity
intact (entities spin out sideways, not forward).

Push direction is computed via cross product (entity_offset ×
dashDir) — same logic as bounce knockback. So resolver and bounce
agree on direction; entity gets pushed once by resolver, then bounce
velocity layered on top continues the perpendicular movement.

**2. Comprehensive dash diagnostic (DASH-DIAG family):**

Added five new diagnostic blocks to capture full lifecycle telemetry:
- `[DASH-DIAG create-drag]` — fires at drag-cast brickAction creation
- `[DASH-DIAG create-auto]` — fires at auto-target brickAction creation
- `[DASH-DIAG frame]` — throttled (every 4th frame) charge-phase log
- `[DASH-DIAG range-cap]` — fires when range cap clamps the step
- `[DASH-DIAG wall-block]` — fires when wall sweep stops the dash
- `[DASH-DIAG terminate]` — fires at dash null-out, summary stats

Combined with existing `[PIERCE-DIAG hit]`, `[PIERCE-DIAG bounce]`,
and `[PIERCE-DIAG resolver-perp]` (renamed from `resolver` to mark
the new branch), playtest will produce a complete trace:
1. Did the dash start where expected? (create-drag log)
2. Did the dash move smoothly each frame? (frame log)
3. Did pierce hits land at expected positions? (hit log)
4. Did the resolver fire and where? (resolver-perp log)
5. Did the dash terminate cleanly? (terminate log)

Console output should reveal whether "starting in odd places"
means startXY is wrong (engine bug) or just visually surprising
(design choice / animation artifact).

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **Play SS, dash through goblin** — entity should now spin out
   perpendicular AND visual should be clean (no clipping/shaking).
3. **Open browser console (F12)** — capture full DASH-DIAG +
   PIERCE-DIAG output for one full pierce dash.
4. **Look for:**
   - `[DASH-DIAG create-*]` startXY matches expected player position
   - `[DASH-DIAG frame]` shows smooth incrementing position (no jitter)
   - `[PIERCE-DIAG hit]` fires at expected entity positions
   - `[PIERCE-DIAG resolver-perp]` shows perpendicular pushVec
     matching dash direction's perpendicular
   - `[DASH-DIAG terminate]` shows expected end position + traveled distance
5. **If still bizarre behavior:** paste console output here and
   I'll diagnose from telemetry.

---

**Risk surfaces:**

- The resolver redirect mid-dash could feel weird if entity is
  ALREADY moving via bounce velocity — the resolver might add to
  bounce's perpendicular velocity (reinforcing) or fight it (if
  entity has crossed the dash line and cross-product flipped sign).
  Diagnostic will show whether this happens.
- "Odd starting places" might NOT be a code bug — could be that
  SS speed makes the dash appear to start "from somewhere else"
  visually because the first frame already moves the player ~16px.
  If so, no fix needed; explain to user.
- Many console logs may slow performance during dash. Throttling
  every 4th frame on the per-frame log helps but the others all
  fire on events. Strip in v0.16.54 once root cause confirmed.

---

**Standards audit (rule #17 — push #72 in S015 continuation,
push #5 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #6 (diagnostic-first): properly applied this push. Multiple
  bizarre symptoms ≠ single clear gating restriction, so diagnostic
  shipped FIRST to capture real telemetry. Resolver redirect
  shipped alongside as best-guess fix; if telemetry shows it didn't
  land, easy to revise in v0.16.54.
- Rule #14 (UNITY): pierce identity expressed across BOTH bounce
  velocity AND resolver displacement, both via the same cross-product
  perpendicular computation. Single source of geometric truth.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: resolver + bounce agree on push direction now.
  - ELEGANCE: resolver-redirect uses same cross-product math as
    bounce — symmetric implementation.
  - EFFICIENCY: per-frame throttle keeps diagnostic cost low.
- Rule #19 (intuition): paused before patching. Recognized that
  "multiple bizarre symptoms" = real diagnostic moment, not
  patch-on-instinct. Per memory rule #6 strict reading.
- Rule #20 (grep-for-symptoms): held — searched for existing
  diagnostic patterns and aligned new logs to the same tag style
  ([PIERCE-DIAG ...] / [DASH-DIAG ...]).

---

### v0.16.54 — SS pierce direction lock (telemetry-confirmed root cause)

> Console log paste: dirXY values flipping every few frames during
> a single dash — 0.88 → -0.99 → 0.86 → 0.87 → -0.95 → -0.96 → 0.83 → -0.96.

**Telemetry from v0.16.53 diagnostic revealed the actual root cause** —
not the overlap resolver, not the bounce velocity, not visual clipping.
The dash direction itself was being recomputed every frame to track
the nearest entity. As the player moved through pierced entities,
"nearest entity" kept changing — sometimes flipping to the OTHER
side of the player after overshooting — producing the chaotic
zigzag motion that read as "shaking, caught, odd positions."

**Why only pierce showed this:** other dash models (recoil, aoe-blast)
STOP on first hit. The retarget block runs ONCE before impact, then
the dash terminates. So zigzag wasn't visible — direction couldn't
flip in a single frame's window. Pierce continues through entities,
so the retarget block runs repeatedly across the dash duration,
producing visible direction flips.

**The diagnostic frame logs made this immediately legible:**

```
frame 5:  dirXY: "0.88,-0.47"   playerXY: 717,370
frame 9:  dirXY: "-0.99,0.11"   playerXY: 707,361
frame 13: dirXY: "0.86,-0.50"   playerXY: 711,347
frame 17: dirXY: "0.87,-0.50"   playerXY: 750,324
frame 21: dirXY: "-0.95,-0.31"  playerXY: 789,302
frame 25: dirXY: "-0.96,-0.26"  playerXY: 784,253
```

Direction flipping between 0.88 and -0.99 between consecutive frames —
that's the dash literally turning around. Player was retargeting to
a different entity every cycle.

**The fix:** add `_lockDirection: true` flag on pierce dash creation.
The retarget block in `updateBrickAction` skips the recompute when
this flag is set. Direction stays locked at the cast-time vector
toward the initial target, and the dash flies in a STRAIGHT LINE
until range cap or wall block.

This is a 4-line fix once the cause was identified — but identifying
it required real telemetry, which v0.16.53's diagnostic provided.
Memory rule #6 paid off here: the bizarre symptoms WERE single-cause,
just not the cause I would have guessed from first principles.

**Lesson reinforced:** when symptoms feel weird and multi-faceted,
ship the diagnostic and let the data speak. My v0.16.52 instinct
("overlap resolver is the problem") was wrong; v0.16.53's resolver
redirect was a defensive layered fix that didn't address the actual
issue. v0.16.54 fixes the real cause.

**The v0.16.53 perpendicular resolver redirect is still good** —
it preserves visual cleanliness during overlap AND aligns with
pierce identity. Worth keeping. The combination of (a) direction
lock + (b) perpendicular resolver push + (c) perpendicular bounce
velocity gives clean, coherent pierce identity:
- Dash flies straight from origin to range/wall (locked)
- Entities in path get hit, get visual separation via resolver,
  and continue spinning out via bounce
- All three motion vectors agree on direction

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **SS dashes through goblin** — should now be a STRAIGHT line from
   cast position to range cap (or wall block). No zigzag, no shaking.
3. **Console verification** — `[DASH-DIAG frame]` logs should show
   dirXY remaining CONSTANT across frames during a single dash
   (allowing tiny floating-point drift but no sign flips).
4. **Multiple aligned enemies** — dash should pierce all of them
   without zigzagging. Each entity spins out perpendicular cleanly.
5. **No regressions for other classes** — BK and other red-dash
   classes still auto-target and recoil-on-hit normally.

If straight-line dashes confirmed → v0.16.55 strips all DIAG blocks.
If still flipping → console output again, deeper investigation.

---

**Risk surfaces:**

- Pierce dash now ignores entity movement during the dash window.
  If an entity teleports across the dash path mid-dash, the dash
  doesn't redirect to chase. Acceptable for pierce identity (straight
  line is the design); other dash models still track if needed.
- Initial cast-time target selection still uses nearest-entity logic.
  If multiple entities are equidistant, JS reduce picks the first;
  edge case but rare.

---

**Standards audit (rule #17 — push #73 in S015 continuation,
push #6 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #6 (diagnostic-first): VINDICATED. v0.16.53 diagnostic
  ship was correct call; telemetry surfaced the real cause that
  patch-on-instinct would have missed.
- Rule #11 (data/runtime/UI): runtime fix; pierce model detection
  reads schema. UNITY held.
- Rule #14 (UNITY): pierce identity now coherent across direction
  (locked), resolver push (perpendicular), and bounce velocity
  (perpendicular). Three systems, one consistent geometry.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: single flag (_lockDirection) controls both retarget skip
    AND signals pierce mechanics through the rest of the dispatch.
  - ELEGANCE: 4-line fix once root cause was identified.
  - EFFICIENCY: skips the per-frame entity scan during pierce
    (small perf win — previously O(n) per frame for retargeting).
- Rule #19 (intuition): paused before patching on hypothesis,
  shipped diagnostic per rule #6, telemetry pointed to the real
  fix. Discipline paid off.

---

### v0.16.55 — SS pierce trail progressive draw + diagnostic strip

> "trail needs to blast out of back first, then trace along path
> to apex and persist for duration"
>
> "blast out 3x speed in reverse for 100px rear facing blast while
> forward trail is being drawn at speed of dash"

Trail is now a self-animating reveal instead of a single line spawned
at termination.

**Animation spec:**

| Segment | Direction | Speed |
|---|---|---|
| Forward path | A → B (apex) | chargeSpeed (~1040 px/s, matches dash speed) |
| Rearward tail | A → tailEnd (100px backward) | 3× chargeSpeed (~3120 px/s) |

Both segments START at point A simultaneously when the trail spawns.
- Tail blasts backward at 3× speed → finishes in ~0.032s for 100px
- Forward path traces at dash speed → finishes when full traveled
  distance / chargeSpeed (e.g. 250px / 1040 ≈ 0.24s)
- After both complete, trail persists at full length for the
  remainder of `duration` (1.7s total)
- Alpha fades linearly across the full duration

**Visual story:**

The forward path is the "afterimage" of the dash that just happened —
trail extends along the dash path at the same speed the player flew,
echoing the motion. The rearward tail is the "blast out the back" —
faster, snap-quick, anti-pursuit beat. Both grow from point A
because that's where the dash started; the forward direction is
where SS went, and the rearward tail is where SS came from
(a streak left behind that anyone chasing has to cross).

**Implementation:**

Trail data structure now tracks:
- `drawnFwdLen` (current forward draw progress)
- `drawnTailLen` (current rearward draw progress)
- `fullFwdLen`, `fullTailLen` (target lengths)
- `fwdDrawSpeed`, `tailDrawSpeed` (px/sec)
- `dirX, dirY` (forward unit vector — used to interpolate drawn endpoints)

Each frame, `updatePierceTrails`:
- Grows `drawnFwdLen` by `fwdDrawSpeed * dt` (capped at `fullFwdLen`)
- Grows `drawnTailLen` by `tailDrawSpeed * dt` (capped at `fullTailLen`)
- Computes current drawn endpoints from origin
- Damages entities along the CURRENTLY-DRAWN segment (not the full
  target line — entity in path of forward draw can't take damage from
  the unrendered rearward portion yet, and vice versa)

Render uses the same drawn endpoints — only renders the visible
portion at any moment.

**Spawn API:** `spawnPierceTrail()` now takes `chargeSpeed` as 7th
arg. Call site at dash termination passes `brickAction.chargeSpeed`.

---

**Diagnostic blocks stripped (all v0.16.52/53 DIAG markers):**

- `[PIERCE-DIAG hit]` (in pierce hit block)
- `[PIERCE-DIAG resolver-perp]` (in entity overlap resolver)
- `[PIERCE-DIAG bounce]` (in bounce-state movement)
- `[DASH-DIAG create-drag]` (in startRedChargeTo)
- `[DASH-DIAG create-auto]` (in startRedCharge)
- `[DASH-DIAG frame]` (per-frame charge log)
- `[DASH-DIAG range-cap]` (range cap clamp event)
- `[DASH-DIAG wall-block]` (wall sweep event)
- `[DASH-DIAG terminate]` (termination summary)
- `_pierceDiagFrame` flag and `_diagFrameNum` counter

The diagnostic served its purpose — telemetry from v0.16.53 revealed
the direction-flip bug that v0.16.54 fixed. Pierce dash is now
straight-line and clean. Strip restores production console output.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: characters.js, server.js, players-core.js, html, boardFx.

---

**Test focus:**

1. Hard refresh.
2. **SS pierce dash with trail** — dash through entity. Watch for:
   - Tail snaps backward from origin almost instantly (3× speed)
   - Forward path traces along dash route at the SAME speed the
     dash itself flew (echo / afterimage effect)
   - Once both drawn, full trail holds and fades over remaining ~1.4s
3. **Entity crossing trail mid-draw** — should only take damage if
   it's within the DRAWN portion. If trail hasn't reached entity's
   position yet, no damage. Once draw passes through entity → damage.
4. **Console clean** — no DASH-DIAG or PIERCE-DIAG output during dashes.
5. **No regressions** — pierce mechanics, knockback, range cap, wall
   block all still work; just the trail visual is now progressive.

---

**Risk surfaces:**

- Trail draw is tied to chargeSpeed, which scales with player speed.
  Future class with different speed → different trail draw rate.
  Acceptable: trail SHOULD echo the dash, so faster classes get
  faster trail-draw.
- Tail drawSpeed multiplier (3×) is hardcoded in `spawnPierceTrail`.
  Could expose as schema field if other classes need different
  rearward-blast speeds. Not urgent.
- Damage detection along the drawn segment may produce a "trail
  catches you" beat where entity sees trail extend toward them and
  then take damage — that's intentional but worth confirming feel.

---

**Standards audit (rule #17 — push #74 in S015 continuation,
push #7 in S016 SS red arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only)
- Rule #14 (UNITY): trail draw + collision share same
  drawn-endpoint computation (single source of geometric truth).
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: forward and rearward segments share lifecycle, fade,
    collision logic — only the speed differs.
  - ELEGANCE: drawnFwdLen/drawnTailLen progressively grow each
    frame; cap-and-clamp pattern is uniform.
  - EFFICIENCY: per-frame trail update is O(trails × entities).
    Trails typically 0-2 active simultaneously; cost is negligible.
- Rule #19 (intuition): your "blast out 3x speed in reverse" was
  more specific than my proposed sequential phasing. Concurrent
  with different speeds is the cleaner mental model — both draws
  start at A, just race outward at different rates.
- Rule #20 (grep-for-symptoms): held — verified all diagnostic
  markers stripped via final grep.

---

### v0.16.56 — Multiplayer foundation: websocket plumbing + ally rendering

> "lets get a multiplayer function ready for waves on rumble test,
> it is time!!!"
>
> Locks: server-authoritative, co-op only, 6 players, no friendly
> fire, walls=caster-only-regen, death=spectate-respawn-at-wave,
> sandbox first then production. Two devices on local network.

**S016 NEW ARC START.** SS red identity arc closed at v0.16.55. This
push opens the multiplayer rumble arc. Per
`MULTIPLAYER_PROPOSAL.md` (delivered prior turn): five-push plan,
v0.16.56 = networking foundation only.

**What this push delivers:**

1. **Server-side (server.js):**
   - New module-scope state: `rumbleSessions` dict (keyed by session
     ID), `rumbleClientSession` reverse-lookup map (ws → reg). NOT
     on G — sessions are ephemeral, never serialized to save file
     or broadcast in board-state messages.
   - Three new message handlers: `rumble_session_join`,
     `rumble_session_leave`, `rumble_player_state`. Self-contained
     block at top of message handler, returns early so they don't
     fall through to board-game logic.
   - Single 20 Hz broadcast loop (`setInterval` at module scope)
     that broadcasts `rumble_session_state` to clients in each
     active session.
   - Stale-player cleanup at 5s timeout — catches dead sockets
     that didn't trigger `close`.
   - `ws.on('close')` cleanup handler removes player from any
     session they were in.
   - Constants: `RUMBLE_TICK_HZ = 20`, `RUMBLE_TICK_MS = 50`,
     `RUMBLE_PLAYER_TIMEOUT_MS = 5000`.

2. **Client-side (rumble_test.html):**
   - New COOP mode card (4th picker option, 🤝 icon).
   - New self-contained block: `mpConnect`, `mpStartPushLoop`,
     `mpDisconnect`. Opens websocket to same host:port as
     players.html, joins session 'sandbox', pushes player state
     at 20 Hz, receives session state and forwards ally array
     to `Rumble.setAllyState`.
   - `startTestRumble` extended to detect coop mode and call
     `mpConnect` after `Rumble.start`.
   - `setMode` extended to handle coop card active toggle.
   - `beforeunload` listener disconnects cleanly on tab close.

3. **Client-side (rumble.js):**
   - New top-level state: `_allyState = []` array.
   - New function: `drawAllies()` — renders each ally as
     translucent circle (alpha 0.55 alive, 0.2 spectating) with
     class color/icon from CHARACTERS. HP bar above.
   - `draw()` extended to call `drawAllies()` BEFORE local player
     so local player stays on top.
   - New API: `Rumble.setAllyState(arr)` — host page passes
     ally state, rumble draws them.
   - `_computeState()` extended with `playerX`, `playerY` so coop
     client can read position via getState (was missing).

**What this push does NOT do:**

- Entity sync — each client still computes own goblins. Allies
  visible but enemies don't match across clients.
- Damage authority — purely client-side still.
- Wave authority — `_waveState` still local.
- Friendly fire / wall ownership — design landing in v0.16.59 polish.
- Death/respawn lifecycle — design landing in v0.16.58.

These are deliberately deferred to keep this push small and testable
in isolation. Foundation goal: "two browsers connect, both see each
other moving in same arena." That's it.

---

**Files changed:** `server.js`, `rumble.js`, `rumble_test.html`,
`NOTES.md`. Plus `MULTIPLAYER_PROPOSAL.md` (committed prior turn).

UNTOUCHED: characters.js, players-core.js, players.html,
test_players.html, dm_screen.html, boardFx, save.sh.

---

**Test focus:**

1. **Restart server** — new module-scope state + setInterval need
   fresh node process.
2. **Open two devices/tabs on local network** — both navigate to
   `http://<server-ip>:8080/rumble_test.html`.
3. **Both pick COOP mode** in picker.
4. **Both pick a class** (different classes recommended for visual
   distinction).
5. **Both should land in waves arena.** Look for:
   - Other player visible as translucent circle with their class
     color/icon.
   - HP bar above ally tracks their health (drops when goblin hits).
   - When ally moves, you see them move in real-time (~50ms latency).
   - Goblins on each screen are DIFFERENT (no entity sync yet) — this
     is expected for v0.16.56.
6. **Console verification:**
   - `[MP] Joined session sandbox — playerCount N`
   - No `[MP] Server error` messages.
7. **Disconnect test** — close one tab, the other should see ally
   disappear within 5s (stale-timeout cleanup).

If 2-device test works, foundation is solid → v0.16.57 entity
authority is next. If anything weird → console output, paste here.

---

**Risk surfaces:**

- `broadcastState()` (board-game state) sends to ALL connected
  clients including rumble_session ones. Wasteful but harmless —
  the rumble client ignores `type:'state'` messages. Worth gating
  in a polish push, not now.
- Connection params: rumble client uses `?role=rumble_session`.
  Server's `clients.set(ws, {role})` registers this but
  `G.players[role]` is undefined → no log emitted. Connection
  works, but the connect/disconnect log is silent for rumble
  clients. By design — these aren't board game players.
- Stale-timeout (5s) means a player with bad network might appear
  to pop in/out. Acceptable for sandbox; tighter heartbeat could
  come later.
- Player HP/bricks are CLIENT-AUTHORITATIVE in v0.16.56 (server
  trusts whatever client sends). When v0.16.57 ships entity
  authority, damage events route through server and HP becomes
  server-owned. v0.16.56 is pre-validation foundation only.

---

**Standards audit (rule #17 — push #1 of S016 multiplayer arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): players.html / test_players.html
  untouched. rumble_test.html is single-purpose; no pair to maintain.
- Rule #14 (UNITY): single `rumbleSessions` map, single broadcast
  function, single message handler block. Server is sole source
  of truth for session membership; clients are render-only for
  ally state.
- Rule #11 (data/runtime/UI):
  - Data: CHARACTERS table drives ally render colors/icons (no
    hardcoded class palette in drawAllies).
  - Runtime: server.js owns session lifecycle; rumble.js owns
    render.
  - UI: rumble_test.html owns picker + connection bridge.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: ally render mirrors local-player render shape (circle
    + icon + HP bar) so visual vocabulary stays consistent.
  - ELEGANCE: networking is ~150 lines client + ~120 lines server.
    No new files for the foundation.
  - EFFICIENCY: 20 Hz broadcast keeps bandwidth modest. Per-ally
    draw is O(1) per ally, max 6 allies = trivial cost.
- Rule #28 (unify-at-choke-point): rumbleClientSession Map is
  THE single source of truth for "which ws is in which session" —
  used by broadcast, leave, and disconnect cleanup. No duplication.
- Rule #15 (handoff hygiene): new arc kicked off with full
  pre-code architecture proposal (`MULTIPLAYER_PROPOSAL.md`).
  Locks captured before any code landed.

---

### v0.16.57 — HOTFIX: server crash on rumble_player_state

> Terminal: `[CRASH] Uncaught exception: Cannot read properties of
> undefined (reading 'sandbox')`
>
> Client: connected fine, joined session, then immediate disconnect.
> Server entered emergency-save state.

**Single-line bug from v0.16.56 refactor.** When pulling
`rumbleSessions` out of G to module scope (so it wouldn't pollute
the save file), I missed updating ONE reference inside the
`rumble_player_state` handler. Server crashed on the first state
push (50ms after successful join), which caused the connection
interruption the client saw.

**The fix:** changed `G.rumbleSessions[reg.sessionId]` →
`rumbleSessions[reg.sessionId]` at line 894. Plus cleanup of two
stale comments that still referenced the old `G.rumbleSessions`
location.

**Why this slipped past parse-check:** `G.rumbleSessions` is valid
JavaScript — `G` is defined, accessing an undefined property
returns `undefined`. The bug only triggers at runtime when
`undefined['sandbox']` is read. Parser can't catch this.

**Why it didn't fire on join:** the join handler used
`_ensureRumbleSession(sessionId)` which correctly references
module-scope `rumbleSessions`. Only the state-push handler had
the stale reference. Client successfully joined, then crashed
on first state tick.

**Lesson:** when refactoring a name across many sites, grep
EVERY reference, not just the obvious ones. I caught the
function-internal references but missed the message-handler
reference (which lived ~250 lines away from the function
definitions).

---

**Files changed:** `server.js` (1 fix + 2 comment cleanups), `NOTES.md`.

UNTOUCHED: rumble.js, rumble_test.html (client side was correct).

---

**Test focus:**

1. **Restart server.** Verify clean startup banner.
2. **Two devices into COOP mode** — same as v0.16.56 test.
3. **Server terminal should NOT show `[CRASH]`** when state pushes
   start arriving.
4. **Both clients should see each other** as ghost-circles with
   class color/icon, real-time movement.
5. **HP bar above ally tracks their actual HP.**
6. **Disconnect test** — close one tab, ally disappears within 5s.

If clean → v0.16.58 entity authority (or whatever next push you call).
If still issues → terminal output again.

---

**Standards audit (rule #17 — hotfix push):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #20 (grep-for-symptoms): SHOULD have caught this in v0.16.56
  by grepping `G\\.rumbleSessions` after the refactor. I greped for
  forward references but not backward ones. Lesson logged.
- Rule #28 (unify-at-choke-point): rumbleSessions IS now a single
  source. The bug was a residue of a partial refactor; fix
  completes the unification.

---

### v0.16.58 — Coord normalization (cross-device viewport fix)

> Mac sees Android player jittery, Android doesn't see Mac player at
> all. Both connected (`playerCount 2`). Asymmetry traced to viewport
> coordinate space mismatch.

**Root cause:** Mac and Android have different canvas sizes (different
viewport pixels). v0.16.56 sent raw `x/y` pixel coords. Mac player at
`x=600` sent literal 600 to Android, where 600 was off-screen. Android
player at `x=200` sent 200 to Mac, where 200 was a valid (but wrong)
position — visible but jittery as positions arrived faster than
pixel-equivalent device updates.

**The fix: normalized coords (0-1) as wire format.** Each client
divides by its own arena bounds before sending. Each client multiplies
incoming `nx/ny` by its own arena bounds before rendering. UNITY:
arena is now a shared LOGICAL space, not a shared pixel space.

**Implementation:**

1. `rumble.js` — `_computeState()` adds `playerNX`, `playerNY` (computed
   from `getRumbleBounds()`). Public API gets `Rumble.getArenaBounds()`
   helper for completeness. Legacy `playerX`/`playerY` kept for any
   non-multiplayer consumers (HUD, etc.).
2. `rumble.js` — `drawAllies()` reads `ally.nx/ny` and maps to local
   bounds at render time. Falls back to legacy `x/y` if a sender
   somehow still sends pixel coords (defensive, for graceful
   transition during deploy).
3. `rumble_test.html` — push loop sends `nx/ny`. Receive handler
   forwards `nx/ny` to `Rumble.setAllyState`. Join payload sends
   `nx: 0.5, ny: 0.5` (center spawn).
4. `server.js` — `rumble_session_join` and `rumble_player_state`
   handlers accept `nx/ny`. Session player struct stores `nx/ny`
   instead of `x/y`. Broadcast just relays this — server doesn't
   care about coord space, just stores and forwards.

**Why "jittery" specifically:** Android's small canvas + small coord
values + 30fps mobile render combined with Mac's 60fps render of those
positions = perceived jitter. With normalized coords, both clients
render at full local fps using the same logical positions.

---

**Files changed:** `server.js`, `rumble.js`, `rumble_test.html`,
`NOTES.md`. UNTOUCHED: characters.js, players-core.js, html files,
boardFx.

---

**Test focus:**

1. Restart server.
2. **Two devices on local network into COOP** — same as v0.16.56/57
   test. Mac browser + Android browser.
3. **Mac should see Android ally at correct logical position.** Move
   Android player to top-right corner — Mac should see ally at
   top-right of ITS arena (even though Mac's arena is bigger).
4. **Android should see Mac ally at correct logical position.** Move
   Mac player around — Android should see ally tracking proportionally.
5. **Smooth render** — no jitter. Both clients update at local frame
   rate using normalized values.
6. **No regressions** — solo modes (sandbox, spec, waves) untouched
   by this change. Test those still work.

---

**Risk surfaces:**

- `_computeState()` calls `getRumbleBounds()` twice per call (once for
  X, once for Y). Tiny perf hit; could memoize within the function but
  not worth the complexity for 20 Hz sample rate.
- `drawAllies()` falls back to legacy `x/y` if `nx/ny` absent. This
  was for graceful deploy across mixed-version clients. After
  v0.16.59 stabilizes, the fallback path can be stripped.
- Aspect ratio: a tall mobile screen + wide desktop will produce
  arenas with different W/H ratios. An ally at nx=0.5, ny=0.5 will
  render at the CENTER of each arena, but the same nx=0.5 horizontal
  movement will translate to different absolute pixel distances.
  This is correct (logical position is shared, physical extent isn't),
  but worth noting if it feels weird.

---

**Standards audit (rule #17 — push #2 of S016 multiplayer arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): coord space is unified as 0-1 logical, NOT pixel.
  Single transformation rule (multiply by bounds) used everywhere.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: nx/ny is the single coord protocol on the wire.
  - ELEGANCE: 4-line transform on send, 4-line transform on receive.
  - EFFICIENCY: server stores normalized (small floats), clients
    transform once per frame. No double-conversion on the wire.
- Rule #28 (unify-at-choke-point): _computeState is THE place player
  position becomes wire-ready. drawAllies is THE place ally coords
  become render-ready. No duplicate transformation logic anywhere.

---

### v0.16.59 — Ally interpolation polish (jitter fix)

> Both visible, still a bit jittery.

**Cause:** Server broadcasts at 20Hz (50ms). Client renders at 60fps
(16ms). Without smoothing, ally position only updates every 3rd
frame → step-step-step instead of smooth motion. v0.16.58 fixed
the WHERE (coords proportional across viewports). v0.16.59 fixes
the WHEN (frames between server updates render smooth motion).

**The fix: time-based exponential smoothing of ally render position.**

Each ally now has TWO position states:
- `targetNX/NY` — last received from server snapshot
- `currentNX/NY` — what's on screen RIGHT NOW (smoothed)

On `setAllyState`: target updates from server. Current does NOT change.

In `drawAllies` (every frame): current lerps toward target using
exponential smoothing with τ = 100ms. Render uses current.

**Why exponential, not linear:**
- Exponential smoothing handles arbitrary frame rate uniformly.
  60fps and 30fps converge identically over the same wall-clock time.
- No discontinuity if a snapshot arrives mid-lerp — the new target
  just changes the destination; current keeps smoothing.
- Standard pattern in real-time multiplayer rendering.

**Math:** `lerpAlpha = 1 - exp(-dt / τ)`, then
`current += (target - current) * lerpAlpha`.
- At 60fps, τ=100ms → ~15% per frame, 95% closed at ~333ms
- At 30fps, τ=100ms → ~28% per frame, same wall-clock convergence

**New ally appearance:** First time we see an ally id, current
SNAPS to target (not lerps from origin). Otherwise allies would
slide in from (0,0) every join.

**Ally departure:** Ally pruned from render if absent from snapshots
for `_MP_ALLY_GRACE_MS = 1500ms`. Short grace absorbs network blips
where one update is missing without making the ally flicker.

**Implementation:**

- `_mpAllyTargets` (dict by id) replaces flat `_allyState` array.
  Each entry holds full per-ally state including the smoothed
  position. Persists across snapshots so currentNX/NY is continuous.
- `_mpAllyOrder` (array of ids) preserves render order.
- `setAllyState` becomes a target-updater: matches incoming allies
  to existing records by id, snaps new entries, prunes stale ones.
- `drawAllies` iterates `_mpAllyOrder`, lerps each entry's current
  toward target using time-based factor, renders at current.

**Files changed:** `rumble.js`, `NOTES.md`. UNTOUCHED: server.js
(no protocol changes — interpolation is purely client-side polish).

---

**Test focus:**

1. Restart server. (Just to be safe, though server.js is unchanged.)
2. **Two devices into COOP** — Mac + Android.
3. **Move continuously on one device.** Ally on the other should
   move smoothly, not in 50ms steps.
4. **Quick direction changes** — verify no overshoot or weird
   easing artifacts. Ally should track changes within ~100ms.
5. **Stand still** — ally renders stationary, no drift or wobble.
6. **One device disconnects** — ally vanishes after ~1.5s grace.
7. **Solo modes still work** — sandbox/spec/waves untouched.

If both directions render smoothly → multiplayer foundation done.
v0.16.60+ becomes entity authority (separate handoff scan).

---

**Risk surfaces:**

- Time constant τ=100ms is a tuning knob. If motion still feels
  "draggy," lower to 60-80ms (snappier, less smoothing). If still
  "jittery," raise to 150-200ms (smoother, more lag). 100ms is the
  middle ground that matches a 50ms snapshot interval doubled.
- Memory: one record per active ally, max 6 allies, ~10 fields each
  → trivial.
- The exp() call is per-frame-per-ally, max 6 × 60fps = 360 calls/s.
  Negligible.
- Mobile Firefox with variable framerate: exponential smoothing
  handles this correctly because it's time-based. But if mobile
  is sending position updates IRREGULARLY (not just rendering at
  variable fps), the smoothing window absorbs ≤100ms variance.
  Larger network jitter would still be visible. Likely fine on
  local network; cross-internet might want τ=200ms.

---

**Standards audit (rule #17 — push #3 of S016 multiplayer arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #1 (paired files): N/A (rumble.js only).
- Rule #14 (UNITY): one ally state structure (_mpAllyTargets), one
  smoothing rule (exponential, τ=100ms), applied to all allies.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: target/current pattern is the standard idiom for this.
  - ELEGANCE: ~30 lines of new logic in drawAllies, similar
    rewrite of setAllyState to keep target-updates clean.
  - EFFICIENCY: O(N) per frame for N ≤ 6 allies. Trivial.
- Rule #20 (grep-for-symptoms): VERIFIED — `grep -n "_allyState"`
  after the rewrite returned zero. Unlike the v0.16.56 → 57 stale
  reference miss, this push completed the rename cleanly.
- Rule #28 (unify-at-choke-point): drawAllies remains THE single
  render point for all ally smoothing + drawing.

---

### v0.16.60 — Engine extraction (foundation, zero behavior change)

> "lets ride!"
>
> Locked: server-authoritative entity state, single engine for both
> solo and coop, full unification + dead-code pruning during
> migration, push count driven by elegance not pre-committed,
> rumbleEngine.js at repo root.

**S016 ENTITY AUTHORITY ARC OPENS.** Per ENTITY_AUTHORITY_PROPOSAL.md
delivered last turn. v0.16.60 is the foundation push: skeleton +
state ownership only. ZERO observable behavior change.

**The big architecture call (locked this push):**
> Solo and coop both run the SAME engine. Solo runs it in-process
> in the browser. Coop will run it on server.js (v0.16.63 cutover).
> The bridge is the only difference between modes.

This eliminates dual-path drift by design (memory rule #29 — when
bug is caused by duplicated logic, fix the duplication). Bug fixes
apply once. Behavior tunes once. Tests run once.

**What this push delivers:**

1. **NEW FILE: `rumbleEngine.js`** — canonical engine module:
   - Self-contained IIFE, exports via `module.exports` (node) AND
     `window.RumbleEngine` (browser). Same code both environments.
   - No DOM/canvas/performance dependencies — pure JS.
   - `createRumbleEngine(config)` factory.
   - Public API surface: `start`, `stop`, `addPlayer`, `removePlayer`,
     `tick`, `applyCast`, `applyDamage`, `getSnapshot`,
     `getRenderState`, `on`, `off`, `setArenaBounds`, `getArenaBounds`.
   - Canonical state object (entities, players, projectiles, walls,
     traps, DoT zones, wave, status). All initialized empty.
   - Event subscription system for FX hookup (subscribers get
     events from applyDamage, applyCast — populated in v0.16.61+).
   - Stable API surface — future pushes ADD methods, never break
     existing ones.

2. **rumble.js engine handle:**
   - New top-level `_engine` slot near other multiplayer state.
   - `_internalStart()` creates engine instance with arena bounds.
   - `_internalTeardown()` stops engine on cleanup.
   - rumble.js still owns simulation logic for v0.16.60 — engine
     just exists as a stable target for migration. v0.16.61
     starts moving damage paths into it.

3. **server.js engine require:**
   - `const RumbleEngine = require('./rumbleEngine.js')` at top.
   - Validates cross-environment compatibility — if engine code
     can't load in node, parse error surfaces at server boot
     (not at v0.16.63 cutover when it's harder to debug).
   - Server doesn't instantiate engine yet (v0.16.63 owns that).

4. **HTML script loads:**
   - `rumble_test.html`, `players.html`, `test_players.html` all
     load `rumbleEngine.js` BEFORE `rumble.js` (so global is
     available at module-init time).

**What this push does NOT do:**

- Update logic still in rumble.js (`updateEntity`, etc.)
- Damage paths still scattered (21 callsites, each calling
  `damageEntity` directly)
- Cast handlers still inline (11 fireOverload* functions)
- Coop mode unchanged — multiplayer still uses v0.16.59 architecture
  (player position broadcast only, no entity sync)

These are deliberately deferred. v0.16.61 introduces the damage
choke point. v0.16.62 unifies cast dispatch. v0.16.63 cuts coop
over to server-side engine. v0.16.64 final UNITY pass.

**Validation criterion:** solo play feels IDENTICAL to v0.16.59.
Same goblins, same casts, same damage, same FX. Engine just
exists alongside, ready for migration.

---

**Files changed:** `rumbleEngine.js` (NEW), `rumble.js`, `server.js`,
`rumble_test.html`, `players.html`, `test_players.html`, `NOTES.md`.

UNTOUCHED behavior surface: characters.js, players-core.js,
dm_screen.html, boardFx.

---

**Test focus:**

1. **Restart server.** New module dependency.
2. **Load rumble_test.html in browser.** Verify console:
   - No errors
   - `[Rumble] ready`
   - `RumbleEngine` global exists (open console: type `RumbleEngine`)
3. **Solo sandbox mode** — pick a class, play. Should feel IDENTICAL
   to v0.16.59. Same goblins, same combat, same flow.
4. **Solo waves mode** — same, identical to v0.16.59.
5. **Solo spec mode** — same, identical to v0.16.59.
6. **Coop mode** — still works as v0.16.59 (allies visible, no
   entity sync, smooth interpolation). Engine creates on each
   client but doesn't drive sim yet.
7. **Production rumble (board game)** — players.html, board flow
   into rumble. Should be unchanged.
8. **Console verification:**
   - In rumble: `Rumble.getState()` returns flat state as before
   - Engine present: `RumbleEngine.ENGINE_VERSION === '0.16.60'`

If anything feels different in solo play, the engine instantiation
broke something — easy revert (single commit).

---

**Risk surfaces:**

- Engine instantiation at start could fail if `RumbleEngine` global
  not loaded (script tag missing). All three HTML files updated; if
  any was missed, the `typeof RumbleEngine !== 'undefined'` guard
  in `_internalStart` keeps things working without engine.
- Server-side `require('./rumbleEngine.js')` will throw at boot if
  engine has parse error. Caught by `node -c` in delivery validation.
- Engine cleanup in teardown protected by try/catch — won't break
  rumble shutdown if engine state is weird.

---

**Standards audit (rule #17 — push #1 of S016 entity authority arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): single engine module, single API surface,
  same code in browser AND node. No parallel paths.
- Rule #15 (handoff hygiene): full ENTITY_AUTHORITY_PROPOSAL.md
  delivered before any code. Architecture locked before build.
- Rule #11 (data/runtime/UI):
  - Data: characters.js (untouched, host-injected to engine)
  - Runtime: rumbleEngine.js (NEW canonical home)
  - UI: rumble.js (slimmed progressively in subsequent pushes)
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: same engine code in both environments. No drift possible.
  - ELEGANCE: minimal surface — 13 public methods. Each subsequent
    push ADDS, never restructures. Skeleton is final shape.
  - EFFICIENCY: engine state IS canonical. v0.16.60 has zero
    runtime cost (no logic moved in yet); v0.16.61+ migrates work
    into it without doubling the simulation.
- Rule #28 (unify-at-choke-point): API surface IS the choke point.
  applyDamage IS the damage choke (v0.16.61 makes it real).
  applyCast IS the cast choke (v0.16.62 makes it real).
- Rule #29 (bug-from-duplication): the dual-path risk is avoided
  BY DESIGN. Solo+coop both will use the same engine code.

---

### v0.16.61 — Damage choke point (callsite-preserving)

**The first migration push of S016 entity authority arc.** Damage
application now flows through a single engine-side choke point.
The 20 scattered `damageEntity()` callsites in rumble.js all route
through `engine.applyDamage()` — without any callsite changes.

**The elegant trick:** `damageEntity` STAYS as a function name. Its
body is now a 6-line wrapper that calls `_engine.applyDamage()`,
which in turn calls a host-injected adapter that calls
`_applyDamageInternal()` (the renamed original). All callsites
continue to call `damageEntity(...)` — no mass rename needed. The
choke point is at the function BODY, not the function NAME.

**Per memory rule #28 (unify-at-choke-point):** by routing through
engine.applyDamage, we now have:
- ONE place where damage gets applied (engine choke)
- ONE place where 'damage' events emit (for FX subscribers)
- ONE place where 'death' events emit (when result.killed=true)
- Foundation for server-authoritative validation in v0.16.63

**Per memory rule #29 (bug-from-duplication):** by NOT renaming
the 20 callsites, we avoid 20 places where a future engineer
might forget to update something. The wrapper is the single
substitution point.

**Implementation:**

1. **`rumbleEngine.js` — new method:**
   - `applyDamage(entity, dmg, source, opts)` — the choke point
   - `registerDamageHandler(fn)` — host injection (rumble.js
     registers its `_applyDamageInternal` adapter at start)
   - Engine emits `'damage'` event after handler returns
   - Engine emits `'death'` event if `result.killed` truthy
   - Returns whatever the handler returned (null if no handler)

2. **`rumble.js` — wrapper + rename:**
   - `damageEntity(g, dmg, aggro, source, opts)` is now a wrapper:
     - If engine available: route through `_engine.applyDamage()`
     - Fallback: direct call to `_applyDamageInternal()`
   - Original `damageEntity` body renamed to `_applyDamageInternal()`
   - Function comment updated: "ALL callsites should now route
     through `_engine.applyDamage()` — NOT this function directly"
   - Return value extended with `killed: bool` so engine can emit
     death events

3. **`rumble.js` — engine handler registration:**
   - In `_internalStart()`, after engine creation, register an
     adapter that unpacks `opts._aggro` into the legacy 5-arg
     signature of `_applyDamageInternal()`. Engine signature stays
     clean (entity, dmg, source, opts); host adapts.

4. **No callsite changes.** All 20 sites keep calling
   `damageEntity(g, ...)` exactly as before. The wrapper handles
   routing transparently.

**Smoke test (in node):**

```
const E = require('./rumbleEngine.js');
const eng = E.createRumbleEngine();
eng.start();
eng.registerDamageHandler(handler);
eng.on('damage', fxHandler);
eng.on('death', deathFxHandler);
// damageEntity(g, dmg, source, opts) → engine.applyDamage()
//   → registered handler → result returned
//   → 'damage' event emitted with result
//   → 'death' event emitted if result.killed
```

All 4 test patterns (g+dmg only, full args, pierce opts, lethal)
returned correct results, fired correct events. Handler aggro
unpacking validated.

**What v0.16.61 does NOT do:**

- FX (damage numbers, flash, crit visuals) still spawned INLINE
  at each callsite. v0.16.62 strips inline FX and moves to event
  subscribers.
- Cast handlers (11 fireOverload* functions) still inline. v0.16.62
  unifies cast dispatch.
- Coop unchanged. v0.16.63 cuts over.
- Damage POLICY logic (resistance, signature reactions, etc.) still
  in `_applyDamageInternal` — host-side, not engine-side. v0.16.62+
  may migrate logic INTO engine; for now injection keeps rumble.js
  as logical owner.

---

**Files changed:** `rumbleEngine.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, rumble_test.html, players.html,
test_players.html, characters.js, players-core.js.

---

**Test focus:**

1. **Solo sandbox** — should feel IDENTICAL to v0.16.60. Damage
   applies the same, death triggers victory same, all visual
   feedback (damage numbers, flash, etc.) unchanged.
2. **Solo waves** — same.
3. **Solo spec** — same.
4. **Coop** — still works as v0.16.59 architecture.
5. **Production rumble** — board game flow unchanged.
6. **Console (optional):** set up a `damage` event listener:
   ```
   Rumble.getEngine && Rumble.getEngine().on('damage', console.log);
   ```
   Then play and watch damage events emit per hit. (Note:
   `Rumble.getEngine` doesn't exist yet — could add as a debug
   accessor in v0.16.62 if useful.)

If anything feels different in solo play, the wrapper isn't
routing correctly. Easy fallback: revert v0.16.61 commit, leaves
v0.16.60 foundation intact.

---

**Risk surfaces:**

- The wrapper assumes `_engine` is set when callsites fire. Falls
  back to `_applyDamageInternal` directly if engine is null. This
  preserves correctness even if engine init fails.
- Adapter unpacks `opts._aggro` — if any callsite passed an opts
  object that ALREADY had a property named `_aggro`, we'd collide.
  Search confirms no callsite uses that name (v0.16.51 used
  `piercing` for SS pierce; no other custom flags in opts).
- Function hoisting: `damageEntity` and `_applyDamageInternal` both
  hoist, so order of definition doesn't matter. Both available
  immediately at script load.
- If someone adds a NEW damage path in future code that calls
  `_applyDamageInternal` directly instead of `damageEntity`, the
  damage applies but engine's 'damage' event doesn't emit.
  Comment on `_applyDamageInternal` flags this clearly. Future
  v0.16.62+ migration will move logic into engine and eliminate
  the back-door entirely.

---

**Standards audit (rule #17 — push #2 of S016 entity authority arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): single damage choke point. Engine is sole
  emit point for damage/death events. No parallel damage paths.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: 20 callsites → 1 engine entry. Single source of truth
    for "did damage just happen" question.
  - ELEGANCE: 6-line wrapper preserves callsite signature. Zero
    callsite changes. Migration without disruption.
  - EFFICIENCY: minimal indirection (1 extra function call per
    damage event). Negligible cost. No double-execution.
- Rule #28 (unify-at-choke-point): VINDICATED. The wrapper-at-name
  pattern shows that choke unification is about behavior, not
  syntax. 20 callsites still write `damageEntity(...)` — but they
  all flow through one place now.
- Rule #29 (bug-from-duplication): by KEEPING the function name
  `damageEntity`, we don't introduce 20 sites to remember to
  update. Single substitution at the function body — no
  duplication of "did I update this site yet?" cognitive load.

---

### v0.16.62 — Cast dispatch foundation + white_overload proof

> "meet in the middle"

**Reading the call:** lay BOTH unification foundations (cast
dispatch + FX subscriber pattern), but only fully migrate ONE cast
as proof. Other 10 casts and FX migration extend in subsequent
pushes once the pattern is validated.

**Per memory rule #19 (intuition over menus):** I led with the
specific scope based on the audit findings, rather than asking
yet another sub-scope question. Cast dispatch infrastructure +
white_overload migration is a clean push. FX subscriber
infrastructure is too ambiguous to land cleanly given per-callsite
visual variations (different hex colors, y-offsets, prefix icons).
Punted FX migration to a future polish push.

**What this push delivers:**

1. **`rumbleEngine.js` — cast dispatch:**
   - `applyCast(playerId, castEvent)` now has a real implementation
     (not a stub). Looks up handler via `_castHandlers[castEvent.cast]`,
     invokes it, emits `'cast'` event with full context.
   - `registerCastHandler(castType, fn)` host-injection method.
   - `_castHandlers` map at module scope (closure-private).
   - Engine version bumped to `0.16.62`.

2. **`rumble.js` — white_overload migration:**
   - At engine init (in `_internalStart`), register
     `'white_overload'` cast handler that calls `fireOverloadWhite`.
   - In `fireOverload()` color dispatch, the white branch now
     builds a cast event and routes through `_engine.applyCast()`.
     Fallback to direct call if engine unavailable (init edge case).
   - Cast event shape: `{ cast: 'white_overload', count, ox, oy, isCrit, ts }`.
   - Other 10 colors (red, yellow, blue, orange, gray, green,
     purple, black) keep direct calls to fireOverload* — v0.16.63
     extends the dispatch pattern to all colors.

**Why white as proof:**
- Simplest cast logic (single function, no entity targeting)
- Independent from damage choke point (heal-only, not damage-side)
- Affects fewer code paths if migration introduces a bug

**The pattern (replicated in v0.16.63):**
```
fireOverload() dispatch branch
    → builds cast event { cast, count, ox, oy, isCrit, ts }
    → engine.applyCast(playerId, castEvent)
    → engine looks up handler in _castHandlers
    → handler invokes the existing fireOverloadX function
    → engine emits 'cast' event after
```

Same pattern as v0.16.61 damage handler injection. Engine is the
choke point, host registers handlers, engine emits events.

**Smoke test (in node):**
```
const E = require('./rumbleEngine.js');
const eng = E.createRumbleEngine();
eng.start();
eng.registerCastHandler('white_overload', handler);
eng.on('cast', logSubscriber);
eng.applyCast('p1', { cast: 'white_overload', count: 3, ox: 100, oy: 200 });
// → handler called with cast event
// → 'cast' event emitted
```

Validated. Unknown cast types return null (no handler) but still
emit cast event. Null cast events safely no-op.

**What this push does NOT do:**

- FX migration (damage number, flash, crit flourish migration to
  subscribers). Audit revealed per-callsite visual variation
  (different hex colors, y-offsets, prefix icons) — too risky for
  one push without regression. Future polish push handles this.
- Other 10 cast types (red, yellow, blue, orange, gray, green,
  purple, black). v0.16.63 extends the dispatch pattern to all.
- Coop wire-up. Cast events are now event-shaped (ready for wire),
  but server.js doesn't receive them yet. v0.16.63 cuts coop over.

---

**Files changed:** `rumbleEngine.js`, `rumble.js`, `NOTES.md`.

UNTOUCHED: server.js, html files, characters.js, players-core.js.

---

**Test focus:**

1. **Solo white overload casts** — should feel IDENTICAL. Tap heal,
   drag heal, self-cast burst, drag-far field. All paths through
   the white_overload handler.
2. **Solo other casts** (red, blue, etc.) — unchanged, still
   direct calls.
3. **Tap white** (regular T1 heal) — uses `doWhiteHeal`, NOT
   `fireOverloadWhite`. Untouched. Should work as before.
4. **Coop** — still v0.16.59 architecture. White overload locally
   routes through engine but has no remote effect yet.
5. **Production rumble** — board game flow unchanged.

If white overload feels different — wrong cast event shape,
handler not registered, or fallback path not firing. Easy revert.
If other colors feel different — should NOT happen, they didn't
change at all.

---

**Risk surfaces:**

- White overload is the ONLY cast through engine in v0.16.62.
  If the test pattern fails, we know exactly where the bug is.
- The `_currentCrit` flag is read at fireOverload() (host) and
  passed through cast event as `isCrit`. fireOverloadWhite reads
  `_currentCrit` again internally (since it's a top-level var the
  function closes over). Both read the same flag, so they should
  agree. v0.16.63 might want to deprecate the flag-based approach
  in favor of explicit cast event field.
- Cast event ts uses performance.now() if available, falls back to
  Date.now(). Server uses Date.now() for snapshot timestamps; this
  consistency is intentional for v0.16.63 latency math.

---

**Standards audit (rule #17 — push #3 of S016 entity authority arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): cast dispatch architecture is now data-driven
  (registerCastHandler call). Adding a new cast type doesn't touch
  engine code. Same pattern as damage handler injection.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: dispatch table is the single source of truth for "what
    happens when player casts X." Engine owns the dispatch.
  - ELEGANCE: ~15 LOC engine method + ~15 LOC host registration.
    Pattern proven, replicates trivially for next 10 casts.
  - EFFICIENCY: lookup is O(1) hash. No conditional cascade.
- Rule #19 (intuition over menus): committed to scope based on
  audit findings. Did NOT ask "should I do FX too?" mid-push —
  audit was clear FX migration needed its own push.
- Rule #28 (unify-at-choke-point): engine.applyCast IS the cast
  choke. Future cast types register, never fork.
- Rule #29 (bug-from-duplication): dispatch table eliminates the
  "did I add a handler in N places?" problem. Single registration
  point, single emission point.

---

### v0.16.63 — Blue Retrieve + Party Mode rename

**Feature push, breaking briefly from entity authority arc.**

**1. Blue Retrieve (new mechanic):**

Blue brick now has a third gesture variant. The full blue cast
behavior matrix:
- **Tap** (no drag): homing bolt → nearest entity (UNCHANGED)
- **Drag onto player** (≤30px from player): RETRIEVE — teleport all
  dropped loot to inventory with particle party (NEW)
- **Drag-far** (>30px from player): AoE bolt at drop point (UNCHANGED)

The retrieve gesture mirrors white heal's self-cast detection
(threshold pattern). All existing blue behavior preserved; only
the previously-undefined "drag onto self" gesture gets new logic.

Cost: 1 blue brick (same as tap). No special overload tier scaling
— T1 already retrieves EVERYTHING, no behavior left to extend.

**FX flow per item:**
- 6-particle burst at item's current position, color keyed to kind
  (brick→source color, gold→yellow, cheese→cream)
- Secondary lighter shade burst for sparkle pop (cyan-white)
- Item flagged done; updateDroppedBricks cleans up next frame

**FX flow at player (post-collection):**
- 12-particle blue celebration burst
- 8-particle lighter cyan layer
- 4-particle white sparkle
- Floating text: `+N ✦` (N = retrieved count)
- Brick bar refreshes to show new bricks immediately

**Empty arena fallback:** small puff at player + "— nothing to
retrieve —" floater, so the cast doesn't feel silent.

Function: `doBlueRetrieve()` in rumble.js, ~70 LOC. Pickup logic
mirrors the contact branch in `updateDroppedBricks` — could refactor
to a shared `_collectLoot(player, item)` helper if other features
need pickup-without-magnet, parking lot.

UNITY check: doBlueRetrieve handles all three loot kinds (brick,
cheese, gold) in one site. Same effect as walking onto each item
— this is a teleport, not a separate effect path.

**2. Party Mode rename:**

Picker card formerly labeled "COOP" with 🤝 icon now shows
"PARTY MODE" with 🎉 icon. Description updated to mention
"signature kits" since players already start with their canonical
class kit (was correct since v0.16.56 via `useCanonicalKit`).

Internal mode string `'coop'` UNCHANGED — only the visible label
shifted. All multiplayer code paths still use `currentMode === 'coop'`,
`isCoop`, etc. Avoids cascading rename across server, network, and
session-tracking code.

**Why mode string stayed:** rename would require updates in
rumble_test.html (`isCoop`, `setMode('coop')`), server.js (zero
references currently — server uses sessionId, not mode name), and
any future code. Per memory rule #29 (bug-from-duplication), a
purely cosmetic rename that touches multiple files invites drift.
Keep one canonical internal name, change only the player-visible
label.

---

**Files changed:** `rumble.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumbleEngine.js (no engine changes this push), server.js,
characters.js, players-core.js, other html.

---

**Test focus:**

1. **Blue tap** — homing bolt to nearest entity. Unchanged.
2. **Blue drag-far** (>30px from player) — AoE bolt at drop point.
   Unchanged.
3. **Blue drag-onto-self** (≤30px from player) — RETRIEVE. With
   loot in arena: particles burst at each, items vanish, brick
   bar updates, floater shows count.
4. **Blue retrieve with no loot** — small puff + "nothing to
   retrieve" floater.
5. **Mode picker** — PARTY MODE label visible with 🎉 icon.
6. **Party mode flow** — click PARTY MODE → pick class → join
   session → see ally → all unchanged from v0.16.59 architecture.
7. **All other casts** — unchanged.

If retrieve doesn't trigger when expected → distance threshold
(30px) might be too tight. Easy tune.

---

**Risk surfaces:**

- `doBlueRetrieve` directly mutates `player.bricks` and
  `player.brickMax`. Mirrors the existing pickup branch logic, but
  if pickup logic ever changes (different stat tracking, different
  hp gain, etc.), the retrieve path would need parallel update.
  Memory rule #29 (bug-from-duplication) flag — refactor to
  shared `_collectLoot()` helper deferred to future polish.
- The 30px threshold is in `scaleDist()` so it scales with display.
  On mobile (smaller arena) this might feel either generous or
  tight depending on viewport. Test on Android.
- Cheese auto-apply branch in retrieve mirrors waves-mode behavior.
  In live game (cheese inventory model), retrieved cheese goes to
  inventory, not auto-eaten. Same as standard contact pickup.

---

**Standards audit (rule #17 — push #4 of S016 entity authority arc,
feature interlude):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #11 (data/runtime/UI):
  - Data: BRICK_COLORS table for color keying (existing)
  - Runtime: `doBlueRetrieve` in rumble.js
  - UI: card label change in rumble_test.html
- Rule #14 (UNITY): retrieve logic is ONE function, called from
  ONE dispatch site. Pickup effect mirrors standard contact
  pickup at the level of behavior (same fields updated, same
  battleStats hooks).
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: blue gesture matrix (tap/drag-self/drag-far) parallels
    white's (tap-heal/drag-self/drag-far). Same gesture-language
    across colors with self-cast utility role.
  - ELEGANCE: ~70 LOC for retrieve, with built-in empty-arena
    feedback. No conditional flags, no special-case cleanup.
  - EFFICIENCY: O(N) over droppedBricks per cast. Typical N
    ≤ 10. Trivial.
- Rule #19 (intuition over menus): I led with full design (gesture,
  cost, fx, empty case) instead of asking 6 sub-questions.
  Picked the answer per UNITY/ELEGANCE/EFFICIENCY without
  interrupting the build.
- Rule #28 (unify-at-choke-point): blue dispatch in `onUp` has
  one decision tree (tap → drag-onto-self → drag-far). Choke at
  the dispatch level.

---

### v0.16.64 — Party Mode HOST/JOIN with game codes

> "white overload is great, need a way to join existing games in
> party mode"

**The problem:** prior to this push, every Party Mode player auto-
joined the hardcoded session 'sandbox'. No way to start a game
with specific friends. No way for two pairs of friends to play
parallel games on the same server. Just one global lobby.

**The fix: Jackbox-style game code system.**

**Server architecture:**

- **Code charset:** 24 letters (A-Z minus I,O for legibility) ×
  4 positions = 331,776 unique codes. Plenty for hundreds of
  concurrent sessions; collision retry is fast.
- **Code generation:** server-side at HOST. Random 4-letter,
  collision-checked against existing sessions, retry up to 32x
  before suffix-fallback (would never trigger in practice).
- **Code normalization:** player input trimmed + uppercased on
  arrival. Players type "blue" → server treats as "BLUE".
- **TTL for empty sessions:** 60s. Player clicks HOST, gets a
  code, walks away → server reaps the phantom session after a
  minute. Also ensures abandoned codes recycle.

**Three new server messages:**

1. `rumble_session_create` (in) → server generates code, creates
   session, replies `rumble_session_created { sessionId }`. No
   player joins yet — separation of concerns.
2. `rumble_session_check` (in) → server replies
   `rumble_session_check { sessionId, exists, playerCount }`.
   Lightweight pre-join validation (can't join a typo'd code).
3. `rumble_session_join` (existing, modified) — now normalizes
   sessionId via uppercase/trim. Backward-compat: any non-existent
   sessionId still creates lazily (preserves direct-URL/scripted
   tests).

**Client architecture:**

- **Picker UI:** new "PARTY MODE" panel between mode picker and
  class grid. Shown only when `currentMode === 'coop'`. Default
  state: HOST + JOIN buttons side by side. JOIN reveals 4-letter
  input. Once code is chosen, code displays prominently in gold
  monospace ("YOUR CODE: BLUE") so HOST can read it to friends.
- **Class grid:** disabled (40% opacity, no pointer events) until
  session is confirmed via HOST or JOIN. Forces the order:
  pick session → pick class → start. Defensive check in
  startTestRumble too.
- **Lobby socket:** one-shot WebSocket for HOST/JOIN handshake.
  Opens, performs request, closes. Gameplay socket opens fresh
  in mpConnect when class is picked. Keeps lifecycles clean.
- **Input UX:** code input auto-uppercases via oninput, accepts
  Enter key to submit, has visual feedback for invalid codes
  ("No game with code 'XXXX' — check spelling").

**Per-state CSS:** new `.party-panel`, `.party-btn`, `.party-code-display`
classes. Purple/violet color scheme distinguishes from gold mode
cards. Code value rendered in gold monospace at 36px with subtle
glow shadow.

**Why mode string stayed `'coop'` despite "Party Mode" UI label:**
deliberate choice from v0.16.63 (memory rule #29 — bug-from-
duplication). All multiplayer code paths still use `currentMode === 'coop'`,
`isCoop`, etc. Pure cosmetic rename at the player layer; internal
canonical name unchanged.

---

**Files changed:** `server.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, characters.js,
players-core.js, other html.

---

**Test focus:**

1. **HOST flow:**
   - Mode picker → click PARTY MODE
   - Party panel appears, default state shows HOST + JOIN buttons
   - Click HOST → "Creating game..." → code appears in gold
   - Code is 4 uppercase letters, no I or O
   - Status: "Game created! Pick a class to start."
   - Class grid becomes interactive
   - Pick class → enters arena, joins the new session
2. **JOIN flow:**
   - Open second device/tab
   - Mode picker → PARTY MODE → JOIN
   - Type the 4-letter code from device 1
   - Click JOIN (or press Enter)
   - Status: "Joined! ... (1 player waiting)"
   - Pick class → enters arena, sees device 1's player
3. **JOIN with wrong code:** status shows "No game with code XXXX"
4. **JOIN with code < 4 letters:** "Code must be 4 letters" error
5. **HOST waits 60+ seconds without joining:** server cleans up;
   if the host then tries to start, the session no longer exists
   on server — would create new on first play (lazy create still
   works as fallback). Acceptable corner case.
6. **Solo modes** (sandbox/spec/waves): party panel HIDDEN. No
   regression.
7. **Production rumble** (board game): unchanged.

---

**Risk surfaces:**

- Lobby socket lifecycle: opens, sends, closes. If onmessage
  takes too long, might not close cleanly. Try/catch on close
  guards against errors.
- 60s empty TTL: tight enough to clean up, generous enough that
  player typing on phone doesn't get bumped. If feedback says
  too short/long, easy tune at top of server.js.
- Code collisions are POSSIBLE but unlikely (24^4 = 331k space).
  Generator retries 32x; in practice n=1 is enough.
- Two sockets per coop session (lobby + gameplay): negligible
  resource cost. Lobby closes within ~100ms of handshake.
- `_normalizeRumbleCode` is permissive (any case, any whitespace
  trim). If user types "ABC D" it becomes "ABCD" — could be wrong
  if they meant "ABC D" as separate code. Rare edge; ignore.

---

**Standards audit (rule #17 — push #5 of S016 entity authority arc,
feature continuation):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #11 (data/runtime/UI):
  - Data: code charset constants in server.js
  - Runtime: code generation, validation, lookup in server.js
  - UI: party-panel HTML + CSS + JS in rumble_test.html
- Rule #14 (UNITY): single canonical sessionId throughout (server
  + client both treat code as the session key). No parallel
  "code → id" mapping; the code IS the id.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one code system, one normalization rule, one
    create-then-join two-step flow.
  - ELEGANCE: ~80 LOC server (3 handlers + helpers) + ~110 LOC
    client (UI+flow). Modular; each piece has one job.
  - EFFICIENCY: code charset is 24, length 4. 331k codes,
    O(1) lookup. Lobby socket is one-shot; no persistent overhead.
- Rule #19 (intuition over menus): committed to the design
  (Jackbox-style game codes, HOST/JOIN buttons, 4-letter input)
  rather than asking "should I do option A or B" mid-build.
- Rule #28 (unify-at-choke-point): _normalizeRumbleCode is THE
  code parser. Used by both join and check. No duplicate
  normalization logic.
- Rule #29 (bug-from-duplication): code IS the session id (no
  separate mapping table). Eliminates "did I update the code-to-
  id map?" risk.

---

### v0.16.65 — Four-bug fix push (blue retrieve, FX, wave refill, coop kits)

> "blue item teleport does not seem to be working, when blue
> touches items, the are treated same as collision with player.
> not a radial particle party, like tiny tiny fireworks, like
> backward rain.  add brick refill to wave end victory screen,
> like board rumble victory screen. each class needs to start
> coop with same starting kits as basic, not random color depths
> and amounts"

Four issues identified, all fixed in this push.

---

**1. Blue retrieve threshold loosened (was too tight to discover):**

The drag-onto-self threshold was `scaleDist(30)` which, given
player radius of 22px, only gave an 8-pixel halo around the
player edge to trigger retrieve. Anywhere outside that halo,
the cast fell through to "drag-far AoE bolt" — which was firing
projectiles that hit dropped items as collision, looking like
"items get treated same as collision with player."

Fix: threshold loosened to `scaleDist(80)` — generous "near me"
zone that's discoverable. The drag-far branch (>80px from player)
still works for AoE bolt deployment as before. Three blue
gestures remain distinct:
- Tap (no drag) → homing bolt
- Drag onto/near self (≤80px) → RETRIEVE
- Drag far (>80px) → AoE bolt at drop

---

**2. FX redesigned: radial → directional reverse-rain:**

User asked for "tiny tiny fireworks, like backward rain" instead
of the v0.16.63 radial particle bursts. Replaced
`spawnCritFlourish` calls per item with a directional particle
stream:

For each item:
- Compute unit vector from item → player
- Spawn 8 small particles AT item position
- Each particle has velocity along the item→player vector
- Add small perpendicular component for natural-looking arc
- Spread particles slightly along perpendicular for stream width
- Speed varies (180-380 px/s × scale) so particles arrive
  staggered (not a uniform spray)
- Color keyed to item kind (brick→source color, gold→yellow,
  cheese→cream)
- 3-particle accent burst at item so player sees stream origin
- Convergence shockwave at player when streams arrive (small
  bright pulse)

Result: "tiny fireworks pulled by gravity to the hero" instead
of confetti exploding outward. Movement reads as "items being
sucked toward you" — matches blue's precision/fast identity.

---

**3. Wave victory brick refill animation:**

Wave victory screen now shows animated brick pip refill — same
pattern as board-rumble victory. Previously: `Rumble.refillBricks()`
fired at wave clear, instantly filling bricks with no visual
feedback. Now: refill animates over the time the victory screen
is displayed.

Implementation:
- New API: `Rumble.startWaveVictoryRefill()` returns initial pip
  HTML for host injection. Internally sets `_victoryRefillActive`
  and starts the existing `_startVictoryRefillLoop` (used by
  board victory).
- New API: `Rumble.stopWaveVictoryRefill()` stops the loop and
  clears the active flag.
- Wave victory HTML now includes `<div id="rumble-victory-pips">`
  populated with `_renderVictoryPipsInitial()` — pips for each
  color showing current vs max charges.
- `_startVictoryRefillLoop` ticks every 80ms calling
  `_updateVictoryPips()` which mutates pip DOM in place. As
  bricks fill via the 20× boost rate, pips light up; once a
  color tops off, its group fades out (CSS transition).
- `onWaveCleared` no longer instant-fills (lets animation work).
- `continueToNextWave` force-fills as safety net (if player taps
  CONTINUE before animation completes, next wave still starts
  with full bricks).

UNITY: reuses the existing victory pip system (`_startVictoryRefillLoop`,
`_renderVictoryPipsInitial`, `_updateVictoryPips`) rather than
building a parallel implementation. Memory rule #28 — the pip
refill choke point is one place.

CSS: new `.wv-refill-row`, `.wv-refill-label`, `.wv-refill-pips`
rules. "BRICKS REFILLING" header in 9.5px gold, pips wrap at
520px max width.

---

**4. Coop canonical kit (one-line fix):**

Bug: coop mode players started with random brickMax values
("random color depths and amounts"). Tracked to a missing
condition in `_internalStart`:

```
if (cfg.mode === 'spec' || cfg.mode === 'waves') { ... canonical kit logic ... }
```

Coop wasn't in the list → fell through to else branch which
only set `player.bricks` (the active charges) but not
`player.brickMax` (the inventory ceiling). brickMax stayed at
whatever `makePlayer(cls)` randomized at character creation.

Fix: added `'coop'` to the mode check. Now coop, spec, and waves
all use canonical class kit (sig × 2 + secondary × 1) as both
starting charges AND inventory ceiling. Loot can grow the ceiling
during play, but the start point is the canonical kit.

Verified breaker:`{red:2, gray:1}`, formwright:`{blue:2, purple:1}`,
etc. now show as expected in coop sessions.

---

**Files changed:** `rumble.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumbleEngine.js (no engine changes), server.js,
characters.js, players-core.js, other html.

---

**Test focus:**

1. **Blue retrieve discoverability:**
   - Drop blue brick anywhere on/near player (within ~80px)
   - Particles stream from each dropped item TOWARD player
   - Items vanish, brick bar updates, +N ✦ floater
2. **Blue retrieve far drop:** drop blue >80px from player →
   AoE bolt at drop point as before
3. **Blue tap:** no drag, fires homing bolt as before
4. **Wave victory refill:**
   - Clear a wave with partial bricks
   - Wave victory screen shows pip refill animation
   - Pips light up over a few seconds as bricks regenerate
   - Tap CONTINUE → next wave starts with full bricks
5. **Coop canonical kit:**
   - HOST a Party Mode session, pick breaker
   - Brick bar shows 2 red + 1 gray (no other colors)
   - Same for joining: pick formwright, see 2 blue + 1 purple
   - No random colors, no surprise charges

---

**Standards audit (rule #17 — push #6 of S016 entity authority arc,
fix push):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): reused existing victory pip system for wave
  victory refill rather than parallel implementation. Single
  `_startVictoryRefillLoop` drives both modes.
- Rule #19 (intuition over menus): committed to specific fix
  approach for each issue based on root-cause analysis (audit:
  threshold tightness, FX direction request, missing mode in
  `_internalStart` branch, missing pip system on wave victory).
- Rule #28 (unify-at-choke-point): blue dispatch (tap/self/far),
  brick seeding (one mode check covers spec/waves/coop), wave
  refill (one pip system).
- Rule #29 (bug-from-duplication): coop kit fix is a one-line
  addition to existing condition rather than a parallel branch.
  Wave refill reuses board victory's pip system.

---

### v0.16.66 — Class collision UI + BS arc geometry fix

> Two from a four-item feedback batch. Class collision was small and
> safe; arc geometry was a real bug worth fixing now (BS arcs not
> blocking touch/pulse/swing damage). iOS connectivity (item 3) and
> wave alignment (item 4) deferred to v0.16.67 / v0.16.68 — they're
> larger and benefit from independent validation.

**Per memory rule #19:** committed to splitting four feedback items
into focused pushes rather than batching. Each push validates clean
or reverts clean.

---

**1. Class collision UI (taken classes greyed out for joiners):**

When a joiner enters PARTY MODE and types a code, the server now
returns the list of classes already chosen by other players in the
session. The joiner's class grid renders those classes as visually
disabled — card stays visible (player understands the roster), but
interaction is suppressed and a "TAKEN" label appears below the
kit.

**Server change:**
- `rumble_session_check` response now includes `takenClasses[]` —
  array of class strings (deduped) currently in the session.

**Client change:**
- New state: `_mpTakenClasses` array, populated on join.
- `renderClassGrid()` checks `(currentMode === 'coop') && _mpTakenClasses.indexOf(cls) >= 0`
  to flag taken classes.
- Taken cards: `.taken` CSS class adds `cursor:not-allowed`,
  `opacity:0.4`, `pointer-events:none`, `filter:grayscale(0.6)`.
- Click handler is omitted from taken cards (defense-in-depth on
  top of pointer-events).
- "TAKEN" label appears below the kit in muted red.

**Edge case (race condition):** if HOST creates code but hasn't
picked class yet, `takenClasses` returns []. JOIN gets empty list,
picks any class. HOST picks. Both could land on same class. Real-
time grid update would prevent this — deferred to a future polish
push (would require periodic re-check or a server push when state
changes). Acceptable for v0.16.66 because the practical case is:
HOST clicks HOST → picks class immediately → friend joins later.

---

**2. BS arc geometry — touch/pulse/swing now respect arc walls:**

Bug: blocksmith arc walls (drag-cast gray) only blocked physical
movement and projectiles. Touch attacks, AoE pulses, and heavy-
melee swings damaged the player THROUGH the wall when entity was
on one side and player on the other. Reported as "entities should
not be able to attack through BS arcs."

Code reading revealed the bug: three attack patterns at three
different sites had no wall-geometry check. They computed
`distToPlayer < attackRange` and applied damage based on raw
distance, ignoring whether geometry intervened.

**Sites:**
- **Touch** (line 6409): `pat === 'touch'` chase-attack path
- **Pulse** (line 6172): `aiType === 'stationary'` AoE pulse
  (creeping_vines, others)
- **Swing** (line 6229): `aiType === 'heavy_melee'` telegraphed
  swing (cursed_knight, stone_colossus)

**Fix: single geometry helper, called at all three sites.**

New function `_arcWallBlocksAttack(ax, ay, bx, by)` returns true
if any active arc wall blocks the line from (ax,ay) to (bx,by).
Implementation: 7-sample test along the segment — if any sample
lies inside the wall band AND inside the cone wedge, the line is
blocked. Approximate but fast and correct for typical attack
ranges. Reuses existing `_pointInArc(w, px, py)` for cone test.

Each attack site wraps its damage application:
```
if (_arcWallBlocksAttack(g.x, g.y, player.x, player.y)) {
  // Flash blocking wall(s) for visual feedback
  // Reset cooldown so entity tries again next tick
  return; // skip damage application
}
// existing damage application...
```

**Wall flash on block:** for each blocking wall, set
`flashTimer = max(flashTimer, 0.1)` so player sees which wall
deflected the attack. Visual reads as "the wall took the hit."

**Per memory rule #28 (unify-at-choke-point):** ONE helper
function at THE geometry choke. Adding more attack patterns in
the future = drop the same `if (_arcWallBlocksAttack(...))` guard
at the new site. No parallel implementations.

**Per memory rule #29 (bug-from-duplication):** the three sites
share the same fix shape (check, flash, return). They're parallel
implementations of the same concern but the concern itself
(geometry test) lives in one function. If geometry rules change
(e.g., partial damage attenuation through walls instead of
binary block), one place to update.

**Ring walls remain passable** per design lock (v0.16.47 comment):
ring walls are short fences (projectiles arc over, attacks reach
through), arc walls are tall barriers (block everything).
`!w.isArc` short-circuits the geometry check — only arc walls
participate in attack blocking.

---

**Files changed:** `rumble.js`, `rumble_test.html`, `server.js`,
`NOTES.md`.

UNTOUCHED: rumbleEngine.js, characters.js, players-core.js, other html.

---

**Test focus:**

1. **Class collision UI:**
   - Device 1: HOST → pick breaker → start game
   - Device 2: PARTY MODE → JOIN → enter code
   - Joiner's class grid: BREAKER card greyed out with "TAKEN"
     label. Clicking it does nothing.
   - Other 5 classes still selectable.
2. **BS arc — touch attacks blocked:**
   - Sandbox or coop, pick BLOCKSMITH
   - Cast gray arc between you and a chasing entity (goblin)
   - Entity touches arc → no damage to you, wall flashes
3. **BS arc — pulse attacks blocked:**
   - Same setup, but with creeping_vines or other stationary entity
   - Cast arc between vines and player
   - Pulse fires → no damage if arc is between, wall flashes
4. **BS arc — swing attacks blocked:**
   - Setup: cursed_knight or stone_colossus
   - Cast arc between knight and player when knight starts winding
   - Swing resolves → no damage, wall flashes
5. **BS arc — projectiles still blocked:** (existing behavior,
   verify no regression)
6. **Ring walls still passable:** (existing behavior, verify no
   regression)

If any pattern doesn't block → diagnostic: check `_arcWallBlocksAttack`
returns true via console (could expose as `Rumble.testArcBlock(g, p)`
later if needed).

---

**Risk surfaces:**

- 7-sample geometry check might miss skim cases (segment tangent
  to arc edge but not crossing midpoints). For typical attack
  ranges (50-300px) the samples are dense enough; 7 samples
  across 200px = 28px between samples, well below player.r=22
  and entity.r=18.
- Pulse arsenal (poison/confuse/slow) is now gated on damage
  landing. If wall blocks the pulse damage, no status either.
  This matches expectations — status rides on the damaging hit.
- Swing telegraph still resolves visually (the entity completes
  the swing animation). Damage just doesn't land. Reads as
  "entity attacked but missed" — better than blocking the
  telegraph itself.
- `_arcWallBlocksAttack` allocates no objects per call (no
  arrays, no maps). Cheap inside per-frame entity loop.
- Class collision check is one-shot at JOIN time. If host's
  class changes mid-game (impossible in current design but
  theoretically possible), joiner's view goes stale. Real-time
  sync deferred.

---

**Standards audit (rule #17 — push #7 of S016 entity authority arc):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #14 (UNITY): one geometry helper, three sites use it.
  Class collision uses existing session-check infrastructure
  (no new endpoints).
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: arc-wall geometry lives in one function. Class
    collision data flows through one existing message.
  - ELEGANCE: ~30 LOC for geometry helper, ~5 LOC at each
    attack site. Class collision is ~20 LOC client + ~10 LOC
    server.
  - EFFICIENCY: 7-sample test = O(walls × samples). Walls
    typically 1-2 active, so cost is negligible.
- Rule #19 (intuition over menus): split the four feedback items
  by size+risk rather than bundling. Each push has clean
  validation criteria.
- Rule #28 (unify-at-choke-point): geometry helper IS the choke
  for "is this attack path blocked." Three callers, one function.
- Rule #6 (diagnostic-first): not invoked here because the bug
  was fully diagnosed from code reading (no wall check at
  attack sites = damage passes through). Rule applies when
  cause is uncertain; here it was certain.

---

### v0.16.67 — Blue retrieve diagnostic (NOT a fix)

> "blue item pick does not seem to work, diag?"

**Per memory rule #6:** when bug cause is uncertain, ship
diagnostic FIRST, get real output, WAIT for user prompt + 
confirmation before writing fix code. Retrieve was supposed to
land in v0.16.65 but is still failing — cause is uncertain
(could be gesture detection, could be timing, could be FX, could
be pickup logic). Diagnostic reveals it.

**However — code reading already revealed a likely cause:**

Looking at the dispatch in `onUp` (line ~2931):

```js
if (held >= tierDur && Math.floor(held / tierDur) >= 1) {
  if (overloadState) {
    fireOverload(isDrag ? canvasX : undefined, isDrag ? canvasY : undefined, bricksUsed);
  }
} else {
  // ... my retrieve check lives here ...
}
```

If user holds the brick ≥0.5s before releasing (which is likely
for a "press and drag onto self" gesture), the cast falls into
the OVERLOAD path → `fireOverloadBlue(count, ox, oy)` → multi-bolt
spray that hits dropped items as collateral. My retrieve check
only fires for SHORT presses (held <0.5s). Bug.

But before fixing, I want runtime confirmation — the gesture
might also be hitting other paths (`_outOfRumble`, etc.). Better
to know exactly which path the user's actual gesture takes.

**Diagnostic patches:**

1. **At dispatch (onUp):** logs every blue cast with:
   - `held` duration (how long the brick was pressed)
   - `isDrag` (boolean — drag detection)
   - `dropDist` from player (in px)
   - `threshold` (scaled 80px)
   - `outOfRumble` (boolean — drop in playable area?)
   - `droppedBricks.length` (how many items exist in arena)
   - `→ <path>` (which dispatch branch fires)

2. **At doBlueRetrieve entry:** logs when the function is
   actually reached, with `droppedBricks` count and player position.

Console tag `[BQ-BLUE]` for dispatch, `[BQ-BLUE-RETRIEVE]` for
function entry. Easy grep.

**No behavior change.** Just logging. Cast still does whatever
it did before. User reproduces → shares console output → I have
the data needed to write the right fix.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: rumbleEngine.js, server.js, html files, characters.js,
players-core.js.

---

**Test focus:**

1. **Open browser console** (F12 / equivalent on mobile).
2. **Start a sandbox or party game.** Get some loot dropped on
   ground (kill an entity).
3. **Try to retrieve via blue brick:**
   - Tap the blue brick on the bar
   - Drag finger onto the player
   - Release
4. **Read console output** — should see `[BQ-BLUE] ...` log line.
5. **Try again with quick tap** (no hold), drag onto player.
6. **Try with HOLD** (deliberately wait ~1 second before
   releasing on player).
7. **Share the `[BQ-BLUE]` log lines.**

**Expected diagnostic output for each gesture:**

| Gesture | Expected `→ <path>` |
|---|---|
| Quick drag onto player (≤80px) | short-press DRAG → RETRIEVE |
| Quick drag away from player | short-press DRAG → AOE bolt |
| Quick tap (no drag) | short-press TAP → homing bolt |
| Hold + drag onto player | OVERLOAD ← LIKELY THE BUG |
| Hold + drag away | OVERLOAD |

If the user's "drop on player" gesture shows as `OVERLOAD`, that
confirms my hypothesis — long-press path is swallowing the
gesture. Fix in v0.16.68 will route OVERLOAD through retrieve
when drop is on/near player.

**If output shows something different** (e.g., outOfRumble=true,
or path is RETRIEVE but doBlueRetrieve never logs), we'll know
to look elsewhere.

---

**Standards audit (rule #17 — push #8 of S016 entity authority arc,
diagnostic push):**

- Rule #25 (version bump): patch `-v` ✓
- Rule #6 (diagnostic-first): VINDICATED. Bug reported, cause
  uncertain from outside, ship diagnostic to gather real data
  before committing to a fix. v0.16.65 attempt to fix retrieve
  by loosening the threshold didn't address the real issue —
  the gesture wasn't even reaching the threshold check.
- Rule #11 (data/runtime/UI):
  - Logs go to `console.log` (development tool, not user-facing)
  - No data structures changed
  - No UI changes
- Rule #29 (bug-from-duplication): TWO log sites (dispatch and
  function entry) intentional — they answer different questions
  ("which path was selected" vs "did the function actually run").

---

### v0.16.68 — Blue retrieve: context-aware tap (real fix)

> Diagnostic data from v0.16.67 (released as v0.16.66 due to
> version-stamp drift):
> ```
> [BQ-BLUE] held=0.07s isDrag=false dropDist=0px outOfRumble=true
>   droppedBricks=3 → short-press TAP → homing bolt
> ```
> Every retrieve attempt: isDrag=false, outOfRumble=true,
> dropDist=0px. The drag-onto-self gesture was being annihilated
> by the `_outOfRumble` branch at line 2910-2918, which forces
> `isDrag = false` and slams `canvasX/Y` to player position
> whenever release lands outside the rumble bounds — which on
> mobile is essentially always (brick bar height + HUD margins
> consume most of the visual canvas).

**The real fix: change the trigger.**

Drag-onto-self was a fragile gesture that:
1. Required `isDrag=true` (drag distance ≥20px)
2. Required `outOfRumble=false` (release inside playable area)
3. Required `dropDist ≤ 80px` (near player)

All three conditions had to hold. On mobile, `outOfRumble`
killed it before the user even released their finger.

**v0.16.68 trigger: TAP blue when loot is on ground.**

```
if (droppedBricks.length > 0) {
  doBlueRetrieve();    // priority
} else {
  startBlueBolt(null); // legacy homing bolt
}
```

Blue tap becomes context-aware. The cast adapts to the
situation:
- **Combat** (no loot) → tap fires homing bolt (legacy)
- **Post-combat / loot drop** (loot exists) → tap retrieves
- **Drag-far** → AoE bolt at drop point (unchanged)
- **Hold + release** → overload at drop or player (unchanged)

This is unambiguous, discoverable, and bounds-fragility-proof.
No gesture training. Player taps blue when they see loot, and
it just works.

**Trade-off:** can't fire a homing bolt while loot is on the
ground. Acceptable because:
- Combat usually clears before loot piles up
- Drag-bolt is right there if you need to attack a specific spot
- Retrieve is the BETTER move post-fight — nobody's tapping
  blue at homing-bolt-an-empty-arena anyway

**Per memory rule #19 (intuition over menus):** committed to the
trigger change rather than asking "should I keep drag or use
tap?" Diagnostic data confirmed drag was structurally broken on
mobile. Switching to a robust trigger is the right call.

**Per memory rule #28 (unify-at-choke-point):** dispatch is one
decision tree (drag → AoE bolt; tap → retrieve OR bolt based on
context). Single choke for blue cast.

**Per memory rule #6 (diagnostic-first):** VINDICATED. v0.16.65
attempted to fix retrieve by loosening the threshold to 80px —
which would NEVER have worked because the threshold check never
ran. The diagnostic exposed the upstream `_outOfRumble`
mutilation. Without diagnostic, I'd have made another speculative
fix and shipped another broken version.

---

**Files changed:** `rumble.js`, `NOTES.md`.

UNTOUCHED: rumbleEngine.js, server.js, html files, characters.js.

---

**Test focus:**

1. **Diagnostic logs removed** — console should be clean of
   `[BQ-BLUE]` spam.
2. **Tap blue with loot on ground:**
   - Kill an entity, loot drops
   - Tap blue brick (don't drag, don't hold)
   - Items teleport with reverse-rain particle streams
   - Brick bar updates with retrieved bricks
3. **Tap blue with no loot:**
   - Empty arena, tap blue → homing bolt fires at nearest entity
4. **Drag blue far:**
   - Drag onto enemy → AoE bolt at drop point
5. **Hold blue (overload):**
   - Hold ≥0.5s → overload at drop point or player

If retrieve doesn't fire when loot is dropped — `droppedBricks`
might not be the right collection name in some context, or the
items haven't fully spawned (popping → idle transition) before
the tap. Add diagnostic if needed (don't ship without verifying
this time).

---

**Standards audit (rule #17 — push #9 of S016 entity authority arc):**

- Rule #25 (version bump): patch (label drift acknowledged —
  save.sh is canonical going forward)
- Rule #6 (diagnostic-first): VINDICATED. Diagnostic in v0.16.66
  revealed the real bug location; v0.16.65 speculative fix would
  have stayed broken indefinitely without it.
- Rule #14 (UNITY): one dispatch tree for blue. Tap path now
  branches on loot context, not on gesture geometry.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: tap = "smart cast" with one decision (loot present?)
  - ELEGANCE: 4-line if/else replaces the broken 11-line
    distance-check branch. Removed bug surface.
  - EFFICIENCY: zero overhead — single array length check.
- Rule #19 (intuition over menus): didn't ask "should we keep
  drag-onto-self or switch to tap?" Diagnostic data made the
  answer obvious.
- Rule #28 (unify-at-choke-point): dispatch is the choke; tap
  branch makes context decision in one place.
- Rule #29 (bug-from-duplication): trigger is now in ONE place
  (the tap branch). Drag-onto-self check (which would have been
  parallel to tap-if-loot) is gone. No drift surface.

---

### v0.16.69 — Browse Games (active party listing)

> "show active parties, click to join"

Party Mode lobby gains a third option: BROWSE GAMES. Opens a
scrollable list of every active session on the server, each
showing code, player count, and class icons taken. Tap a card →
joins that session. Auto-refreshes every 3 seconds.

Lower-friction than typing a code. Code-typing still works
(useful when a friend reads you a code over the phone) but
discovery doesn't require knowing the code in advance.

**Server change:**
- New message: `rumble_session_list` → returns array of session
  cards: `{ sessionId, playerCount, takenClasses, createdAt }`.
- Sorted newest-first by `createdAt`.
- Empty sessions (HOST created but never joined) are listed —
  they're valid join targets until TTL cleans them up (60s).
- Reuses existing session struct fields; no new server state.

**Client change:**
- New BROWSE button alongside HOST/JOIN in party panel.
- Three buttons now share row: 🎲 HOST, 🔑 JOIN, 📋 BROWSE.
- BROWSE click → opens list panel (replaces default row).
- List panel: header row with title + ⟳ refresh + × cancel
  buttons; scrollable list (max-height 280px).
- Each card: code (gold monospace, large), player count, class
  icons taken. Hover lifts card with purple glow.
- Tap card → calls `partyJoinByCodeFromBrowse(code)` → pre-fills
  code input → reuses existing `partyJoinByCode()` flow.
- Auto-refresh every 3s while panel visible. Stopped on cancel,
  on join, on mode switch.
- Empty state: "No active games. Try HOST!"
- Connection failed state: "Connection failed."

**Per memory rule #14 (UNITY):**
- Browse uses the SAME `_partyOpenLobbySocket` infrastructure
  as HOST and JOIN — one-shot socket per request, no persistent
  connection during browse.
- Tap-to-join routes through the existing `partyJoinByCode()`
  flow (just pre-populates the code input). No parallel join
  logic.

**Per memory rule #28 (unify-at-choke-point):** join logic has
ONE entry (`partyJoinByCode`). Whether the user typed the code,
tapped a browse card, or clicked the JOIN button after typing —
all three paths converge at this function.

**Per memory rule #19 (intuition over menus):** committed to the
design without sub-questions:
- 3-second auto-refresh (frequent enough to feel live, infrequent
  enough not to spam server)
- Empty sessions listed (real targets — host might be on a
  loading screen waiting to pick class)
- Class icons not full names (compact, visually scannable)
- Newest-first ordering (recent activity is more likely live)

**Privacy note (parking lot):** in a local-network deployment,
all sessions being publicly listed is fine. If we ever go
internet-public, we'd want a "private game" toggle on HOST that
hides the session from `rumble_session_list`. Not a current
concern.

---

**Files changed:** `server.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, characters.js,
players-core.js.

---

**Test focus:**

1. **Browse with no sessions:**
   - PARTY MODE → BROWSE → "No active games. Try HOST!" appears
2. **HOST one session, BROWSE from another device:**
   - Device 1: PARTY MODE → HOST → get code (don't pick class yet)
   - Device 2: PARTY MODE → BROWSE → see device 1's session card
   - Card shows the 4-letter code, "0 players", "empty lobby"
3. **Auto-refresh:**
   - Device 2 keeps browse panel open
   - Device 1 picks class on host
   - Within 3s, device 2's card updates: "1 player" + class icon
4. **Tap to join:**
   - Device 2 taps card → switches to "Joined!" state with code
     displayed (same as JOIN-by-code flow)
   - Class grid unlocks; pick a class, enter arena
5. **Multiple sessions:**
   - Open 3 host devices, get 3 codes
   - Browser device sees all 3 cards, newest first
6. **Cancel browse:**
   - × button returns to default state (HOST/JOIN/BROWSE row)

If browse list is empty when a session SHOULD exist → server
might not be tracking the session correctly, or the auto-refresh
isn't firing. Console log on server side would show.

---

**Standards audit (rule #17 — push #10 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #14 (UNITY): browse uses same lobby socket pattern as
  HOST/JOIN. Tap-to-join routes through existing join flow.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: one socket pattern, one join flow, three entry
    points (HOST/JOIN/BROWSE) all converge.
  - ELEGANCE: ~30 LOC server (one handler, one sort), ~80 LOC
    client (button + render + join hook). Shared CSS
    vocabulary with existing party panel.
  - EFFICIENCY: 3s auto-refresh = 20 requests/min/device. Cheap.
    Sessions object iteration is O(n); typical n < 10.
- Rule #19 (intuition over menus): committed to design choices
  (refresh interval, empty state, ordering) without sub-questions.
- Rule #28 (unify-at-choke-point): join logic has one entry —
  three UI paths converge at `partyJoinByCode()`.
- Rule #29 (bug-from-duplication): no parallel join code,
  no parallel session-state tracking.

---

### v0.16.69 — iOS WebSocket diagnostic (NOT a fix)

> "iOS issues connecting to android mac and ios. ios is not seeing
> others or being seen"

**Per memory rule #6 (diagnostic-first):** iOS works for some
(macOS↔Android per earlier reports) but fails for iOS. Cause is
uncertain — could be local network permission, WS lifecycle quirk,
backgrounding behavior, or other iOS Safari weirdness. Ship
diagnostic, gather data on actual iOS device, then fix.

**Hypotheses being tested:**

1. **Local network permission (iOS 14+)** — Safari may silently
   fail WS connections to local IPs without user permission grant.
   Symptom: WS never opens.
2. **WS lifecycle quirk** — connection might open then immediately
   close due to extension/header negotiation difference.
3. **Background suspension** — iOS aggressively suspends background
   tabs; WS dies on app switch. Symptom: works initially, drops.
4. **Sleep/wake** — screen sleep closes WS. Works briefly, dies.
5. **CORS/origin** — less likely since server doesn't check, but
   possible.

The diagnostic surfaces all five scenarios.

---

**Server-side diagnostic:**

Every WebSocket connection logs:
- `role` (rumble_lobby, rumble_session, dm, etc.)
- `ip` (client IP — confirms iOS reaching server at all)
- `ua` (compact platform tag: iOS, Android, macOS, Windows, Linux)
- truncated user-agent string (full platform fingerprint)

Plus close events log code + reason. Plus error events log message.

Console output looks like:
```
[WS-CONNECT] role=rumble_lobby ip=192.168.86.42 ua=iOS (Mozilla/5.0 (iPhone; CPU iPhone OS 17_2...))
[WS-CLOSE]   role=rumble_lobby ip=192.168.86.42 ua=iOS code=1006 reason=
```

Code 1006 specifically would indicate "abnormal closure" — common
when iOS local-network permission isn't granted.

---

**Client-side diagnostic:**

1. **`_wsDiag` state object:** tracks
   - sent/recv message counts
   - last sent/received message type
   - WS state (idle/connecting/open/closed/error)
   - last error message + last close code
   - timestamp of last event

2. **`_wsDiagInstrument(ws, label)` helper:** wraps any WebSocket
   to log every send + receive + lifecycle event. Uses
   `addEventListener` (NOT `onopen`/`onmessage` setters) so it
   coexists with user-defined handlers. Both lobby socket and
   gameplay socket are instrumented.

3. **On-screen overlay:** floating panel at bottom-left,
   semi-transparent purple. Shows live state:
   ```
   WS: open
   sent: 3 (rumble_session_create)
   recv: 5 (rumble_session_state)
   last: 0.3s
   ```
   Refreshes every 500ms. CRITICAL for iOS testing — connecting
   an iOS device to Safari Web Inspector requires a Mac with
   develop menu enabled, which most users won't do. Overlay
   gives the data without a debugger.

4. **Console logs (`[WS-DIAG]` tag):** every event with timestamp,
   label, type, and byte count. Suppresses noisy `rumble_session_state`
   broadcasts (every 50ms) so the log stays scannable. Visible
   if a debugger IS attached.

---

**What we're looking for in iOS test:**

| Symptom | Likely cause | Action |
|---|---|---|
| WS state stays "connecting", never opens | Local network permission | iOS 14+ needs permission grant or `NSLocalNetworkUsageDescription` |
| WS opens, closes immediately (code 1006) | Mixed content / handshake | Check if page is https/ws mismatch |
| WS opens, no recv | Server not broadcasting | Server log will show send attempts |
| WS opens, sends work, recv = 0 | Browser-side filter | Inspect message format |
| WS works, dies after backgrounding | Background suspension | Need wake lock or auto-reconnect |
| WS works, only fails for OTHER clients | Cross-platform message routing | Check session membership server-side |

---

**Files changed:** `server.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, characters.js,
players-core.js.

---

**Test focus (this is the fact-finding mission):**

1. **Restart the server.** Watch the terminal output.
2. **Open rumble_test.html on each device** that you've tested:
   - macOS browser
   - Android browser
   - **iOS browser (the broken one)**
3. **For each, observe the on-screen `WS: ...` overlay** at bottom-
   left of screen. State transitions: idle → connecting → open
   (success) OR idle → connecting → error (failure).
4. **Try the lobby flows on iOS:**
   - PARTY MODE → HOST → does the code appear?
   - PARTY MODE → BROWSE → does the list load?
5. **Capture the server console output.** Save it. Specifically:
   - `[WS-CONNECT]` lines: who connected, what UA, what IP
   - `[WS-CLOSE]` lines: any unexpected disconnects? what code?
6. **Capture the client overlay snapshots** (screenshot if possible)
   for each device showing what the overlay reads.

**Specifically for iOS:** what does the overlay show at the
moment iOS attempts a HOST or JOIN? Is the WS in "connecting",
"open", "closed", or "error"?

**Share back:** server console output + iOS overlay snapshot.
With that data, the fix will be obvious.

---

**Standards audit (rule #17 — push #11 of S016 entity authority arc,
diagnostic push):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #6 (diagnostic-first): VINDICATED again. Speculating the
  iOS fix without data would have shipped wrong fixes. The diag
  exposes which of 5+ hypotheses is the actual cause.
- Rule #11 (data/runtime/UI):
  - Data: `_wsDiag` state object
  - Runtime: instrument wrapper, overlay refresh interval
  - UI: floating overlay div
- Rule #18 (ELEGANCE): ~80 LOC client + ~30 LOC server. Single
  instrument helper covers both lobby + gameplay sockets.
  Single overlay covers all WS state.
- Rule #19 (intuition over menus): committed to comprehensive
  diag (counts + types + lifecycle + on-screen overlay) rather
  than asking "should I add overlay too?" The overlay is the
  whole point of an iOS-debug push.
- Rule #28 (unify-at-choke-point): `_wsDiagInstrument` is THE
  WebSocket instrumentation. Both sockets use it. Adding more
  WS endpoints in the future = wrap them with same call.
- Rule #29 (bug-from-duplication): single `_wsDiag` state, single
  overlay renderer, single instrument helper. No drift.

---

### Blue cast sweep + iOS diag visibility (post-v0.16.69)

> "blue landed on two green bricks, wm ovld, did not pick up, fw
> blue pass through item and not sent to inv. treat any interaction
> with any player fired blue damage area or travel path as player
> collision with that item"

> "ios version 26.3.1(a) is not working to see other players in
> same party and other players do not see player from ios 26;
> ios 16.4.1 is working"

**Per memory rule #15 (handoff hygiene):** scanned the file FIRST
before adding new code. Discovered `_wsDiag` system already
shipped (existing v0.16.69 push — iOS diagnostic). Removed my
parallel `mp-debug-overlay` additions. The existing diagnostic is
canonical. Memory rule #29 averted: would have shipped two
parallel WS-state tracking systems otherwise.

---

**1. Blue is the loot color (cast sweep mechanic):**

Generalizes retrieve from "tap to gather" to "any blue cast
contacts loot → loot collected." Three pickup pathways now share
ONE collection helper:

- `updateDroppedBricks` contact pickup (player walks onto item)
- `doBlueRetrieve` (tap blue → teleport all loot)
- `_sweepBlueItems` (cast contacts items)

**New helper: `_collectLootItem(p, opts)`** — single source of
truth for "this dropped item gets collected by the player."
Handles cheese (live vs. waves auto-apply), gold, brick (charges
+ ceiling). `opts.showFloater` and `opts.cheeseFlavor` toggle
per-item floater behavior (suppressed in bulk-retrieve to avoid
text spam).

**New helper: `_sweepBlueItems(centerX, centerY, radius)`** —
checks all dropped items within radius, collects via
`_collectLootItem`, spawns reverse-rain particle stream toward
player for each. Skips popping/very-fresh items (kill animation
should complete before vacuum).

**Wired into:**
- Bolt travel (per-tick): `_sweepBlueItems(b.x, b.y, b.r * 1.5)`
  inside the bolt-update step. Bolt physically vacuums items it
  crosses.
- Fixed-point AoE impact: `_sweepBlueItems(ix, iy, impactR)` after
  damage application.
- Homing-bolt overload burst: `_sweepBlueItems(target.x, target.y, b.burstRadius)`
  alongside burst damage.
- Tap-blue homing impact (no burst): `_sweepBlueItems(target.x, target.y, b.r * 2)`
  smaller sweep at landing point.

**Per memory rule #28 (unify-at-choke-point):** all five pickup
paths converge through `_collectLootItem`. Adding a future pickup
path = call the helper, never duplicate the cheese/gold/brick
branches.

**Per memory rule #29 (bug-from-duplication):** v0.16.65 had three
copies of the cheese/gold/brick logic (contact, retrieve, would-
have-had bolt-sweep). One source of truth now. If pickup rules
change (e.g., capacity caps, animation, sound), one place to
update.

---

**2. Diagnostic overlay visibility improvements:**

The existing `_wsDiag` overlay was at `bottom:6px left:6px`. iOS
Safari's bottom toolbar can obscure bottom-fixed elements,
especially in landscape. Moved to `top:6px left:6px` — always
visible regardless of toolbar state.

Other improvements:
- Larger font (9.5px → 11px) for legibility on phone screens
- Added `readyState` field — shows `0/1/2/3 (connecting/open/closing/closed)`
  inline with state. Catches the case where state transitions
  silently (e.g., open → closing without close-event).
- Stamped abbreviated user agent at bottom of overlay (60 chars).
  iOS version visible in screenshots for direct comparison.
- Slightly more contrast: border `#4a3475` → `#6644aa`, background
  alpha 0.85 → 0.92, added soft shadow.

These are visibility tweaks, not architectural changes. The
underlying `_wsDiag` instrumentation (counts, types, errors) is
unchanged — already comprehensive from the previous push.

**Files changed:** `rumble.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: `server.js` (browse-games server changes already on
origin from previous push), rumbleEngine.js, characters.js,
players-core.js.

---

**Test focus:**

1. **Blue tap with loot on ground:** retrieve all → reverse-rain
   to player (from previous push, regression check)
2. **Blue tap with no loot:** homing bolt at nearest entity (legacy)
3. **Blue drag-far at loot cluster:** AoE bolt detonates → items
   in radius sweep to player as bolt does damage
4. **Blue drag-far past loot, hits enemy beyond:** items along
   the bolt's flight path sweep too
5. **Blue overload near loot:** multi-bolt spray sweeps all items
   in the burst radii
6. **iOS 26 with new overlay positioning:** load rumble_test.html
   on iOS 26 device. WS overlay should now be visible top-left.
   Try HOST/JOIN. Screenshot + compare to iOS 16. Share what each
   shows for `WS:` (state), `↑sent`, `↓recv`, error fields, and
   the UA stamp at the bottom.

If iOS 26 shows `state: connecting` and never advances → local
network permission likely. If it shows `open` but `↓recv: 0` →
upstream broadcast not reaching iOS. If it shows `closed` early →
WS lifecycle quirk.

---

**Standards audit (rule #17 — push #11 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #15 (handoff hygiene): scanned FIRST, found existing
  diagnostic, removed my parallel addition before shipping.
  Wasted ~80 LOC of work — but caught it before the bug.
- Rule #14 (UNITY): one pickup helper, one sweep helper, one
  diagnostic system. Three pickup paths converge.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: blue identity reinforced — every cast sweeps loot.
  - ELEGANCE: helper per concern (collect, sweep). Clean
    separation between "apply pickup effect" and "decide what to
    pick up."
  - EFFICIENCY: O(items × bolts) per tick. With typical
    items ≤ 10, bolts ≤ 5, cost is negligible.
- Rule #28 (unify-at-choke-point): collection logic at ONE
  function. Sweep geometry at ONE function.
- Rule #29 (bug-from-duplication): three previous pickup
  implementations consolidated. Caught duplicate diagnostic
  before shipping it.
- Rule #6 (diagnostic-first): VINDICATED — diagnostic from prior
  push is what we'll use to root-cause iOS 26 issue. The
  visibility improvements ensure the diagnostic actually serves
  its purpose on the device that needs it.

---

### iOS 26 auto-reconnect (post-v0.16.69)

> Diagnostic from v0.16.69 — iOS 26 (iPad iPadOS 26.3.1):
> ```
> WS: closed · ready: 3 (closed)
> ↑sent: 12 (rumble_player_state)
> ↓recv: 59 (rumble_session_state)
> last evt: 2.5s ago
> err: connection error
> close code: 1006
> ```

**Diagnostic VINDICATED.** Connection worked — 71 messages
exchanged successfully over ~29 seconds. Then died with close
code **1006** (abnormal closure, no close frame). This is a clean
signal: not a permission issue, not a protocol mismatch, not a
server reject. The connection was alive and exchanging real-time
data, then dropped without a clean close handshake.

**Cause hypothesis:** iOS 26 Safari is more aggressive than iOS 16
about closing WebSockets on tab background, screen lock, network
transitions, or notification-shade pulldown. The "iOS not seeing
others / not being seen" symptom is the after-effect of
post-disconnect: connection drops, no auto-reconnect, players
appear absent to each other.

**Fix: auto-reconnect with exponential backoff.**

WebSocket drops are a real-world condition (network blips, OS
backgrounding, route changes) — production multiplayer games have
to handle them transparently. Implementation:

**State (`_mpReconnect`):**
- `intent`: `'none'` | `'connect'` | `'disconnect'` — distinguishes
  user-initiated leave from drop
- `cls`, `meta`: saved class + SPEC_CLASSES entry, used to re-issue
  the join after reconnect
- `attempts`: consecutive reconnect attempts (capped at 6)
- `timer`: setTimeout handle, cleared on success or explicit
  disconnect

**mpConnect changes:**
- Sets `_mpReconnect.intent = 'connect'` on every call
- Saves cls/m to reconnect state
- Preserves `_mpPlayerId` across auto-reconnects so server
  treats the same player as continuing rather than joining
  fresh. Only generates new playerId on TRULY fresh connect
  (intent !== 'connect').
- onopen handler clears the reconnect timer + zeroes attempts

**onclose changes:**
- Reads close `code` from the event
- Distinguishes abnormal codes (`0`, `1006`, `1011`, `1012`) from
  clean (`1000`, `1001`)
- Schedules reconnect via `_mpScheduleReconnect()` if intent ===
  'connect' AND close was abnormal AND we have saved cls/meta

**`_mpScheduleReconnect()`:**
- Bumps attempt counter
- Gives up after 6 attempts (sets intent='none', clears state)
- Backoff: 1s → 2s → 4s → 8s → 8s → 8s (capped at 8s)
- Re-checks intent inside the timer callback (user might have
  disconnected during backoff)
- Calls `mpConnect(saved_cls, saved_meta)` — same flow as fresh
  connect

**mpDisconnect enhanced:**
- Sets `intent = 'disconnect'` so onclose suppresses reconnect
- Clears any pending reconnect timer
- Clears saved cls/meta
- Closes socket with code 1000 (clean) so server can clean up
- Existing rumble_session_leave message still sent

---

**Per memory rule #15 (handoff hygiene):** scanned FIRST and
found that `mpDisconnect()` already existed. Almost shipped a
duplicate. Merged my reconnect-state-clearing additions into the
existing function instead of creating a parallel implementation.

**Per memory rule #29 (bug-from-duplication):** rule paid off
TWICE on this push — first when I caught the duplicate
mp-debug-overlay vs. existing _wsDiag (last push), now catching
duplicate mpDisconnect.

**Per memory rule #28 (unify-at-choke-point):** reconnect
decision is at ONE function (`_mpScheduleReconnect`). All paths
that reach reconnect (network drop, iOS background, server
restart) flow through the same backoff + re-issue logic.

**Per memory rule #19 (intuition over menus):** committed to
exponential backoff (1s/2s/4s/8s) and 6-attempt cap without
asking — these are battle-tested defaults from production
WebSocket clients.

---

**Files changed:** `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, server.js, characters.js,
players-core.js.

---

**Test focus:**

1. **Normal play unchanged:**
   - PARTY MODE → HOST → pick class → enter arena
   - Run for 30+ seconds, verify allies still visible, no
     console reconnect messages
2. **iOS 26 auto-reconnect:**
   - PARTY MODE → JOIN → enter arena on iOS 26 device
   - Wait for the typical drop (close code 1006 expected after
     ~30s based on previous diag)
   - WS overlay should show:
     - `state: closed` momentarily
     - `state: connecting` 1-8s later (depending on attempt)
     - `state: open` once reconnect succeeds
     - `↑sent` and `↓recv` continue incrementing
   - Console: `[MP] Connection closed, code=1006`,
     `[MP] Scheduling reconnect attempt 1 in 1000ms`,
     `[MP] Attempting reconnect (attempt 1)`,
     `[MP] Reconnect succeeded`
   - Allies should reappear after reconnect. Brief visual gap is
     expected — that's the cost of the disconnect.
3. **Explicit disconnect doesn't reconnect:**
   - Refresh the page mid-session (location.reload triggers
     beforeunload → mpDisconnect with intent='disconnect')
   - No reconnect attempts after the close
4. **Server down → eventual giveup:**
   - Stop the server, wait
   - Should see 6 reconnect attempts logged (1, 2, 4, 8, 8, 8s)
   - Then `[MP] Reconnect limit reached (6 attempts) — giving up`
   - Restart server, manual page reload to reconnect

---

**Risk surfaces:**

- **Lobby socket drops** (`_partyOpenLobbySocket`) are NOT
  auto-reconnected — they're one-shot for HOST/JOIN/BROWSE
  handshakes. If browse refresh sees a drop, the next 3s tick
  opens a fresh socket anyway. Acceptable.
- **Reconnect during a stale game state** could be weird. If
  player died and the death event was the message that didn't
  arrive, reconnect re-joins with the saved cls/m as if alive.
  Server will broadcast the authoritative state and client will
  reconcile. Worth watching for desync.
- **rumble_session_leave** is sent on intentional disconnect
  but NOT on abnormal close. Server might keep the slot occupied
  for a few seconds until its own cleanup logic fires. This is
  fine — reconnect uses the same playerId so server replaces
  the entry rather than creating a new one.
- **6-attempt cap** is a balance: long enough to ride out brief
  drops (sleep/wake, brief network blip) but short enough to
  avoid eating battery on a permanently-down server. Could be
  longer; 6 felt right.
- The user-initiated mpDisconnect during a PENDING reconnect
  cleanly cancels the timer.

---

**Standards audit (rule #17 — push #12 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #15 (handoff hygiene): scanned existing mpDisconnect
  before adding new code. Merged into existing function instead
  of duplicating.
- Rule #14 (UNITY): one reconnect helper, one mpDisconnect
  function, one intent state field.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: reconnect logic flows through the same mpConnect
    that fresh-connect uses. Same code path, just re-entered.
  - ELEGANCE: ~80 LOC adding state, scheduler, intent-aware
    onclose. No parallel "session manager" class needed.
  - EFFICIENCY: zero overhead during normal operation — the
    timer is null, intent check is O(1).
- Rule #19 (intuition over menus): exponential backoff (1/2/4/8s)
  and 6-attempt cap chosen without sub-questions.
- Rule #28 (unify-at-choke-point): close handling is the choke;
  all reconnect decisions flow through onclose → schedule.
- Rule #29 (bug-from-duplication): caught duplicate mpDisconnect
  before shipping. Two near-misses in two pushes — rule is doing
  real work.
- Rule #6 (diagnostic-first): VINDICATED. Without v0.16.69's
  diagnostic data showing close code 1006, I'd have guessed at
  causes (CORS, permissions, etc.). The data made the fix
  targeted.

---

### Wave alignment — Path B "synced parallel play"

> "players need to join the wave that other players are currently
> active with"

The original feedback item from when iOS, BS arc, and class
collision were also flagged. Deferred through v0.16.66-70 because
each push had higher-immediacy items. Now it's the next call.

**Path B chosen** (over Path A "shared entities") because Path B
delivers the immediate user-visible improvement (joiners stop
spawning at wave 1) without requiring the entity authority
migration. Path A is the right end-state but it's a multi-push
arc; this push unlocks usable coop now.

**The model: synced parallel play.** Both players fight the same
wave NUMBER. Each client spawns its own entity instances locally
(no shared HP). Players see each other moving as ally markers.
When one clears their wave, server tracks the new wave so future
joiners spawn there.

**What's NOT in this push:**
- Shared entity HP (each client's monsters are local)
- Force-advancing existing players when a teammate races ahead
  (intentional — laggard shouldn't get yanked from their
  unfinished battle)
- Wave-clear synchronization (each client clears independently)

These are Path A territory.

---

**Server changes (`server.js`):**

1. **`sess.wave`** added to session struct, defaulting to 1. The
   only authoritative wave value in the system. Represents
   "where new joiners should start."

2. **`rumble_session_state`** broadcast includes `wave` field.
   Clients see the canonical value on every tick.

3. **`rumble_session_joined`** ack includes `wave`. Brand-new
   joiners know their target wave immediately, without waiting
   for the next session_state tick.

4. **`rumble_wave_advance`** new message type. Client → server,
   payload `{ newWave }`. Server takes max(currentWave, newWave)
   and rebroadcasts. Idempotent (multiple players advancing
   simultaneously all converge to the highest). Monotonic
   (laggards can't drag the session backwards — verified in
   smoke test).

5. **`rumble_session_check`** and **`rumble_session_list`**
   responses include `wave`. Browse UI can show "wave N" per
   session card so joiners know what they're entering.

---

**Client changes (`rumble_test.html`):**

1. **`session_joined` handler** — if `msg.wave > 1`, defer 100ms
   (let `Rumble.start` finish wave 1 spawn first), then call
   `jumpToWave(msg.wave)`.

2. **`continueToNextWave`** — at end, if `currentMode === 'coop'`,
   send `rumble_wave_advance` with the new wave.

3. **`jumpToWave(targetWave)`** new helper. Clears existing
   entities/projectiles/walls/loot/traps via `Rumble.clearArena()`,
   sets `_waveState.currentWave = targetWave`, calls `spawnWave`.
   Idempotent (no-op if already at/past target).

4. **Browse UI** — session cards show "wave N" inline when wave > 1
   (hidden for wave 1 = default, not informative).

---

**Engine change (`rumble.js`):**

1. **`Rumble.clearArena()`** new public API. Clears `entities`,
   `enemyProjectiles`, `droppedBricks`, `grayWalls`, `traps`,
   `blueBolts`. Player state preserved. Used by `jumpToWave` to
   wipe the wave-1 spawn before installing the target wave.
   Cosmetic FX (crit shockwaves, floating text) self-expire.

---

**Per memory rule #14 (UNITY):**
- ONE authoritative wave field on the server (`sess.wave`).
- ONE message to advance it (`rumble_wave_advance`).
- ONE place clients learn about it (the existing
  session_joined/session_state messages — no new pull request
  needed).
- ONE jump helper on the client (`jumpToWave`).

**Per memory rule #28 (unify-at-choke-point):** wave-update
decision is in ONE function (`rumble_wave_advance` handler).
All advance paths flow through max-comparison. All read paths
flow through session_joined/session_state.

**Per memory rule #19 (intuition over menus):** committed to
Path B without sub-questions about whether to attempt full
Path A. Path B is the right size for one push.

**Per memory rule #29 (bug-from-duplication):** `clearArena` lives
in ONE place on the engine API. If we needed it from another
spot (e.g., game-over reset), we'd call the same function rather
than re-implement.

---

**Files changed:** `server.js`, `rumble.js`, `rumble_test.html`,
`NOTES.md`.

UNTOUCHED: rumbleEngine.js, characters.js, players-core.js, other html.

---

**Test focus:**

1. **Solo coop (no joiners) — regression:**
   - PARTY MODE → HOST → pick class → enter arena
   - Run normally, advance through waves
   - No console errors. Server's `sess.wave` should advance with
     each clear (verify with server log if curious).
2. **Joiner enters at wave 1 — happy path:**
   - Device 1: HOST, pick class, do NOT advance past wave 1
   - Device 2: JOIN code, pick class
   - Both spawn at wave 1, see each other as allies
3. **Joiner enters mid-session at wave N — THE NEW BEHAVIOR:**
   - Device 1: HOST, pick class, clear wave 1 → CONTINUE (now wave 2)
   - Continue to wave 3, wave 4 (each CONTINUE sends advance)
   - Device 2: JOIN code → spawns at wave 1 briefly, jumps to wave 4
   - Both fighting wave 4 (separate entity instances per client)
4. **Wave alignment via BROWSE list:**
   - Device 1: HOST, advance to wave 3
   - Device 2: PARTY MODE → BROWSE → card shows "1 player · wave 3"
5. **Laggard doesn't get force-advanced:**
   - Two players in wave 2. Player A clears, advances to wave 3.
   - Player B is still mid-wave-2. Server reports wave=3 in next
     session_state. Player B should NOT jump — they keep fighting
     their wave 2.
   - jumpToWave is gated by `targetWave > _waveState.currentWave`
     AND only called from `session_joined`, not from session_state
     ticks. Laggards stay where they are.
6. **Race: both advance same time:**
   - Both clear wave 5 simultaneously, both send wave_advance(6).
   - Server takes max → 6. Both rebroadcast as wave=6. Idempotent.

---

**Risk surfaces:**

- **Wave-1 spawn → clear cycle on join:** The 100ms delay before
  jumpToWave means wave 1 entities exist for ~100ms before being
  wiped. Brief visual artifact. Could be fixed by deferring the
  initial spawn in coop mode until session_joined arrives, but
  that adds complexity for a small visual win. Acceptable.

- **`clearArena` doesn't clear all visual FX.** Crit shockwaves,
  floating text, and particle effects continue to play out their
  natural lifespan after the wipe. Reads as "the wave 1 spawn
  echo fades while wave N spawns in." Could be janky on slow
  devices but should be visually fine.

- **Wave advance via reconnect:** If iOS player drops mid-wave-3
  and auto-reconnects, they re-issue rumble_session_join with
  same playerId. Server returns wave=3 (or higher). jumpToWave
  is idempotent — no-op if already at 3, jumps if behind.
  Auto-reconnect now naturally handles wave catch-up.

- **Server's session_joined ack** includes wave but is sent
  BEFORE _broadcastRumbleSession. So the joining client gets
  joined first (with wave), then the broadcast. Order is correct
  for a clean catch-up.

- **No wave regression possible.** Server enforces monotonic max.
  Bad-actor client sending newWave=0 is silently ignored (the
  `> sess.wave` check rejects it).

---

**Standards audit (rule #17 — push #13 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #14 (UNITY): one wave field, one advance message, one
  jump helper, one clearArena.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: existing message channels (session_joined,
    session_state, session_check, session_list) all carry wave
    in the same shape.
  - ELEGANCE: ~20 LOC server, ~40 LOC client, ~15 LOC engine.
    No new schema, no new socket pattern.
  - EFFICIENCY: `wave` in broadcast adds 8 bytes/tick. Negligible.
- Rule #19 (intuition over menus): chose Path B without sub-asking.
  Was right call — push is contained, validates clean.
- Rule #28 (unify-at-choke-point): wave update is at the
  rumble_wave_advance handler. Wave reads are at the joined/
  state ack handlers.
- Rule #29 (bug-from-duplication): `clearArena` consolidated.
  jumpToWave reused by session_joined; could be reused later
  by other scenarios (testing/debug).
- Rule #15 (handoff hygiene): scanned `_waveState`,
  `continueToNextWave`, `spawnWave`, server session struct,
  before adding code. Found right insertion points first try.
- Rule #11 (data/runtime/UI):
  - Data: `sess.wave` server-side is data. ✓
  - Runtime: jumpToWave + advance broadcast is runtime. ✓
  - UI: browse-card wave label is UI. ✓
  No misplaced concerns.

---

### v0.16.72 — Diag accuracy fix + wave alignment diagnostic

> Test report from v0.16.71:
> - "first screen is ios 26 tried to join game, joined wave 1
>   instead of current"
> - Image 1 (iPad iOS 26): WS overlay shows `state: connecting`,
>   `↑sent: 28 (rumble_session_check)`, `↓recv: 84 (rumble_session_check)`,
>   `last evt: 41.1s ago` — but joiner is in-game with allies
>   visible
> - Image 2 (Android): WS overlay shows `state: open`,
>   `↑sent: 3235 (rumble_player_state)`, `↓recv: 3212 (rumble_session_state)`,
>   healthy session
> - Server log: code 1006 closes happening on Android + macOS too,
>   not just iOS

**Per memory rule #6 (diagnostic-first):** three concerns, one
contained, two needing data:

1. Diagnostic UI inaccuracy (FIX, not diag) — overlay shows
   lobby socket state instead of session
2. Wave alignment didn't fire (DIAG) — need to know if join.wave
   was actually > 1
3. Auto-reconnect status (DIAG) — code 1006 closes shouldn't be
   visible-as-broken if reconnect is firing

**Per memory rule #15 (handoff hygiene):** scanned `_wsDiag`,
`_wsDiagInstrument`, `_partyOpenLobbySocket`, `mpConnect`,
`session_joined` handler, `jumpToWave`, `_mpScheduleReconnect`
to find the right insertion points before changing anything.

---

**Concern 1: Overlay was showing the wrong socket.**

Root cause identified by reading `_wsDiagInstrument` calls:
- `_partyOpenLobbySocket` instrumented EVERY lobby socket (line 2869)
- `mpConnect` instruments the session socket (line 3119)
- `_wsDiag` is single-state — last instrumented socket wins

The BROWSE auto-refresh opens a fresh lobby socket every 3s.
Each one instrumented → resets `_wsDiag.state` to `connecting`,
then `open`, then `closed`. By the time the screenshot was taken,
the latest lobby socket was caught mid-`connecting`. The
long-lived session socket (which was healthy and streaming
ally state) was invisible to the overlay.

**Fix: stop instrumenting lobby sockets.** Diagnostic value
comes from the long-lived session socket only. Lobby sockets
are one-shot transactions — their state isn't useful to surface.

```diff
- _wsDiagInstrument(ws, 'lobby');  // every BROWSE refresh
+ // Lobby sockets are NOT instrumented (would constantly
+ // overwrite session state with stale lobby state).
```

After this fix, overlay reflects the SESSION socket lifecycle
faithfully: connecting → open during in-game play, closed +
reconnects on drops.

---

**Concern 2: Wave alignment didn't fire — diagnostic.**

We don't know yet if:
- (a) Server's `sess.wave` was wrong (still 1 when joiner came in)
- (b) Server included wave in ack but client missed it
- (c) Client read it but `jumpToWave` didn't fire (early return)
- (d) `jumpToWave` fired but `clearArena` failed silently

**Diagnostic added:**

1. **`_wsDiag.lastJoinWave`** — captures wave from
   `rumble_session_joined` ack. Surfaces in overlay as
   `join.wave=N`.
2. **`_wsDiag.jumps`** — bumps each time `jumpToWave` is called
   (regardless of whether it succeeds). Surfaces as `jumps=M`.
3. **Detailed console logs in `jumpToWave`:**
   - Entry log shows target, current, active state
   - Abort logs explain WHY the early return fired
4. **Console log on `wave_advance` send** — host can confirm
   the message is being broadcast on each CONTINUE.

The overlay will show one of:
- `join.wave=1 jumps=0` → server isn't advancing wave (concern a)
- `join.wave=N jumps=0` → client received wave but skipped jump (c)
- `join.wave=N jumps=M` → jumpToWave fired, but maybe
  `clearArena` failed (d) — visible as wave-1 entities still
  on screen
- (no field shown) → client didn't even reach `session_joined`
  handler

---

**Concern 3: Auto-reconnect visibility — diagnostic.**

Server log showed code 1006 on Android + macOS too. Auto-reconnect
should be handling these transparently, but we don't know if it's
firing.

**Diagnostic added:** `_wsDiag.reconnects` counter. Bumps every
time `_mpScheduleReconnect` queues a reconnect attempt. Surfaces
in overlay as `↻ reconnects: N` (only visible when N > 0, so it
doesn't clutter the normal-state overlay).

If overlay shows `↻ reconnects: 3`, auto-reconnect is firing.
If WS state stays `closed` for long without the counter going
up, reconnect logic isn't engaging.

---

**Files changed:** `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, server.js, characters.js,
players-core.js.

---

**Test focus:**

1. **Verify diagnostic accuracy fix:**
   - Open BROWSE panel → wait 10+ seconds (multiple lobby
     refresh cycles)
   - Overlay should NOT keep flipping to `connecting`
   - HOST or JOIN a session
   - Overlay should show `state: open` and stay there
2. **Test wave alignment with new diagnostic:**
   - Device 1: HOST → pick class → CLEAR wave 1 → CONTINUE to wave 2
   - Device 1 console: should see `[MP] Sent wave_advance newWave=2`
   - Device 2: BROWSE → card should show "wave 2" inline
   - Device 2: tap card → pick class → enter
   - Device 2 console: `[MP] Joined session XXXX — wave 2`,
     `[MP] jumpToWave called with target=2 current=1 active=true`,
     `[MP] Jumping from wave 1 → 2`
   - Device 2 overlay: should show `join.wave=2 jumps=1`
3. **If wave alignment STILL fails after this push:** screenshot
   the overlay + share console output. The diagnostic will
   pinpoint which step failed.
4. **Reconnect counter:** during an extended play session,
   if a 1006 happens, overlay should show `↻ reconnects: N`
   and recovery should happen within ~8s.

---

**Standards audit (rule #17 — push #14 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #6 (diagnostic-first): VINDICATED again. v0.16.71 fix
  was correct in principle but I have no way to know if it
  worked from "joined wave 1 instead of current." Need data.
- Rule #15 (handoff hygiene): scanned `_wsDiag` shape,
  `_wsDiagInstrument` callers, `jumpToWave` flow, `mpConnect`
  flow before adding diagnostic.
- Rule #14 (UNITY): one `_wsDiag` state object holding all
  counters. One overlay renderer for all fields.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: `_wsDiag` covers state + counters + last-event in
    one place.
  - ELEGANCE: ~5 LOC fields added, ~10 LOC overlay rendering,
    ~4 LOC counter bumps, ~6 LOC console diagnostic logs.
  - EFFICIENCY: counters are integer increments, render is
    string concat. Negligible.
- Rule #28 (unify-at-choke-point): wave-jump diagnostic at
  the choke (jumpToWave entry). Reconnect diagnostic at the
  choke (`_mpScheduleReconnect` entry).
- Rule #29 (bug-from-duplication): single instrumentation
  helper. Lobby/session distinction now correct (only
  long-lived session socket gets instrumented).

---

### v0.16.73 — Connection watchdog (iOS 26 stuck-connecting fix)

> v0.16.72 diagnostic data:
> - Image 1 (Mac joiner): `WS: open · ↑sent: 391 · ↓recv: 410 ·
>   join.wave=2 jumps=1` — wave alignment WORKS when host has
>   advanced before joiner arrives.
> - Image 4 (iPad iOS 26): `WS: connecting · ↑sent: 4509 ·
>   ↓recv: 4598 · last evt: 56.0s ago · close code: 1006 ·
>   ↻ reconnects: 1 · join.wave=1 jumps=0`

**Wave alignment confirmed working.** Image 1 proves the
mechanism (Mac jumped from wave 1 → 2 cleanly). Earlier "joined
wave 1" reports were just timing — host hadn't yet advanced at
the moment of join.

**Auto-reconnect partially working on iOS 26.** `↻ reconnects: 1`
means one reconnect WAS scheduled and fired after a 1006 close.
But the new socket entered `connecting` state and stayed there
for 56 seconds without ever firing `onopen` OR `onclose`.

**Hypothesis:** iOS 26 reopen behavior — first WebSocket
typically succeeds on a page; subsequent reopens after a 1006
close can hang in `connecting` indefinitely. The browser doesn't
fire either resolution event, so `_mpScheduleReconnect` never
gets re-triggered (it's gated on the close handler firing).

**Fix: connection watchdog.**

After creating each new WebSocket in `mpConnect`, start a 5-second
watchdog. If `onopen` doesn't fire within 5s:
1. Force-close the stuck socket (code 4000, app-defined "watchdog
   timeout")
2. Directly call `_mpScheduleReconnect()` — don't rely on
   `onclose` firing (iOS 26 may swallow it)

The next reconnect attempt creates a new socket with its own
watchdog. If that also hangs, watchdog forces another retry.
Backoff still applies (1s, 2s, 4s, 8s) so we don't spin tightly.

The 4000 close code is in the application range (4000-4999) and
intentionally NOT in the `isAbnormal` list — we're handling
reconnect directly from the watchdog rather than going through
the close handler. This keeps the close-code → reconnect logic
clean (real abnormal closes only).

**Also:** clear watchdog in `onclose` so it doesn't fire after
a clean close. (The clean-close path goes through `mpDisconnect`
→ `_mpWS.close(1000)` → `onclose` → watchdog cleared.)

**Per memory rule #28 (unify-at-choke-point):** all reconnect
paths still flow through `_mpScheduleReconnect`. The watchdog
is just a new TRIGGER for that function, not parallel reconnect
logic.

**Per memory rule #29 (bug-from-duplication):** watchdog logic
lives at ONE site (mpConnect). Each socket creation gets its own
watchdog via closure capture. Per-socket lifetime, not global.

---

**Why I'm NOT extending isAbnormal to include code 4000:**

The watchdog already handles its own retry. If we added 4000 to
the abnormal-close list, the close handler would ALSO schedule a
reconnect → double-schedule → bumps attempt counter twice per
hang. The current shape: watchdog OR onclose triggers reconnect,
never both for the same hang.

---

**Files changed:** `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, server.js, rumbleEngine.js.

---

**Test focus:**

1. **iOS 26 long session:** PARTY MODE → JOIN → enter arena.
   Play through wave clears. When the next 1006 hits (typically
   after screen sleep or notification shade), watch overlay:
   - Should see `↻ reconnects: 1` after the close
   - State should briefly go `connecting` then return to `open`
     within 5-10 seconds
   - If it hangs `connecting` for 5s, console will show
     `[MP] Connection watchdog: socket stuck in readyState=N for 5s`,
     and a new attempt should fire (`↻ reconnects: 2`)
2. **Verify clean disconnect doesn't trigger watchdog:** refresh
   page during play. No watchdog warnings in console.
3. **Verify wave alignment still works** (regression check from
   v0.16.71): Mac/Android host advance to wave 2, joiner arrives,
   should jump.
4. **Repeat-reconnect tracking:** if a session has multiple drops,
   `↻ reconnects: N` should increment each time. Counter doesn't
   reset until page reload or explicit disconnect.

---

**Standards audit (rule #17 — push #15 of S016 entity authority arc):**

- Rule #25 (version bump): patch — save.sh canonical
- Rule #6 (diagnostic-first): VINDICATED. v0.16.72 diagnostic
  pinpointed exact failure mode (`state: connecting · last evt:
  56.0s ago · ↻ reconnects: 1`). Without it I'd have guessed
  the fix wrong.
- Rule #14 (UNITY): one watchdog per socket via closure capture.
  Reconnect still routes through `_mpScheduleReconnect`.
- Rule #18 (UNITY/ELEGANCE/EFFICIENCY):
  - UNITY: single retry path via `_mpScheduleReconnect`.
  - ELEGANCE: ~15 LOC for watchdog, no new state, closure scoped.
  - EFFICIENCY: setTimeout per connect, cleared on success or
    close. Negligible.
- Rule #19 (intuition over menus): committed to watchdog
  approach (5s threshold, force-close + direct reschedule)
  without sub-questions.
- Rule #28 (unify-at-choke-point): reconnect choke remains
  `_mpScheduleReconnect`. Watchdog is one of multiple TRIGGERS
  for it (close-event + watchdog-timeout).
- Rule #29 (bug-from-duplication): watchdog reconnect bypasses
  the abnormal-close → schedule path on purpose. If I'd added
  4000 to isAbnormal, both watchdog AND onclose would schedule
  → double-reconnect. The intentional separation prevents
  duplication.

---

### v0.16.74 — Path A entry: shared entity mirror (host-authoritative)

> "lets do it! entities away"

The big architectural step. Path B (v0.16.71) gave each player
their own entity instances of the same wave. Path A delivers
**shared monsters**: when host damages an entity, all clients
see the HP drop. When mirror's bolt hits, host's entity takes
damage and the result propagates back.

**Architectural call: host-authoritative, not server-authoritative.**

The locked v0.16.60 design said "server runs rumbleEngine.js."
That's the right end-state but it's a multi-push migration
(updateEntity is 623 lines, deeply tied to player/wall/projectile
state in rumble.js). Going server-authoritative this push would
have been 1500+ LOC of risky migration.

**Interim shape:** the FIRST joiner is the entity host. Subsequent
joiners are mirrors. Wire protocol is the same shape it'll be
when server takes over (entity broadcasts, damage events from
non-owners). Future pushes migrate the simulator to server,
keeping the wire untouched.

**Per memory rule #19:** committed to interim approach without
asking "should we do this or wait for full server-auth?" — Path
A's user-visible value (shared monsters) ships now, full migration
is the next major arc.

---

**Server changes (`server.js`):**

- `sess.entityHostId` — playerId of canonical simulator. First
  joiner becomes host. On host disconnect, next-oldest player
  is elected.
- `sess.entities` — most recent entity snapshot from host.
  Server relays in `rumble_session_state` broadcast.
- `sess.pendingDamage` — queue of damage events from mirrors.
  Forwarded to host once per broadcast tick as
  `rumble_entity_damage_batch`.
- New message handlers: `rumble_entity_state` (host pushes),
  `rumble_entity_damage` (mirror pushes — server queues).
- `rumble_session_joined` ack includes `isEntityHost` boolean
  and `entityHostId` so client knows its role immediately.

**Client changes (`rumble_test.html`):**

- New state: `_mpIsEntityHost`, `_mpEntityHostId`,
  `_mpRemoteEntities`, `_coopWaveSpawnPending`.
- `session_joined` handler captures host status, calls
  `Rumble.setMirrorMode(!isHost)`. If host, spawns wave 1
  locally; if mirror, leaves entities empty until host
  broadcast arrives.
- `session_state` handler reads `entities` from broadcast and
  feeds to `Rumble.setRemoteEntities(arr)` when mirror.
- `session_state` handler also tracks host ID — if previous
  host disconnects and we're elected, log promotion.
- `entity_damage_batch` handler: host receives queued events,
  calls `Rumble.applyRemoteDamage` for each.
- Push loop: hosts also send `rumble_entity_state` at 10 Hz
  alongside `rumble_player_state`.
- `continueToNextWave`: mirrors skip local spawn, just bump
  the displayed wave number. Host owns spawning.

**Engine changes (`rumble.js`):**

- New entity field `id` (format `e_N`), assigned in `makeEntity`
  via `_nextEntityId++` counter. Reset on `_internalStart`.
- New flag `_mirrorMode`. Toggled by `setMirrorMode`. Used to
  gate two paths.
- `updateEntity` early-returns if `_mirrorMode && g._foreign`.
  Foreign entities don't tick local AI — host's simulation
  owns them.
- `damageEntity` redirects to wire if `_mirrorMode && g._foreign`.
  Calls `Rumble.sendRemoteDamage(entityId, dmg, color)` to
  fire-and-forget the wire event. Local mutation suppressed —
  host's next broadcast overwrites anyway.
- New public API:
  - `getEntitySnapshot()` — host: serialize entities for wire.
    Strips AI internals; keeps render-relevant fields plus
    state flags (dazed, swing telegraph, deathTimer).
  - `setRemoteEntities(arr)` — mirror: rebuild entities array
    from host's broadcast. Preserves existing entries by ID
    where possible (avoids transient FX flicker). Marks new
    entries with `_foreign: true`.
  - `applyRemoteDamage(id, dmg, color, casterPid)` — host:
    find entity by ID, route through standard `damageEntity`.
  - `sendRemoteDamage(id, dmg, color)` — mirror: send
    `rumble_entity_damage` to server.
  - `setMirrorMode(bool)` / `isMirrorMode()`.

---

**Per memory rule #28 (unify-at-choke-point):**
- Damage path has ONE choke (`damageEntity`). Mirror gate sits
  at top — branches between local mutation and wire event.
- Entity rendering uses ONE array (`entities`). For host, it's
  canonical; for mirror, it's host's broadcast painted in.
  Renderer doesn't branch.

**Per memory rule #29 (bug-from-duplication):**
- One entity ID counter, reset once per session start.
- One `setRemoteEntities` rebuild path. Doesn't duplicate the
  host's `makeEntity` factory — mirror entries are deliberately
  thin (no AI fields, no kit fields, no resistances) because
  they don't need them.

**Per memory rule #14 (UNITY):**
- Host's behavior is unchanged from solo (entities tick locally,
  damage applies locally). Coop is a transparent "mirror mode"
  toggle for non-hosts.
- Wire protocol matches the shape full server-auth will use,
  so the next migration push doesn't touch the wire.

---

**What's intentionally NOT in this push:**

- **Mirror player damage from host's entities.** Host's monster
  swings at mirror's player → no damage propagates to mirror's
  HP. Mirror's HP is still owned by the mirror client. Host
  knows the position of mirror's player (via player_state
  broadcast) but doesn't apply damage to it.

  Workaround: damage is one-directional (mirror → host's
  entities). Host's monsters can't attack mirror.

  This is a follow-up — needs a damage-from-host wire event.

- **FX over wire.** When mirror's bolt damages host's entity,
  mirror sees the local bolt+impact (because mirror still
  shoots locally). But if host damages a foreign entity that
  mirror is rendering, mirror sees HP drop with no visual
  effect (no projectile, no impact flash beyond the flashTimer
  field that comes through in the snapshot). Acceptable
  degraded experience.

- **Walls, traps, projectiles, droppedBricks** stay local per
  client. Each player has their own. Future pushes share these
  too, but they're less visible than monsters.

- **Server-authoritative simulation.** Per architectural lock,
  this is the next major arc. v0.16.74 ships the wire shape;
  future pushes migrate updateEntity to server.

---

**Files changed:** `server.js`, `rumble.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumbleEngine.js (will hold full simulator in future),
characters.js, players-core.js.

---

**Test focus:**

1. **Solo regression:**
   - Start sandbox or waves run, no coop
   - Entities should have `id: 'e_1'`, `'e_2'` etc. but otherwise
     behave identically. No mirror mode active.
2. **Host alone (1 player coop):**
   - PARTY MODE → HOST → pick class
   - Wave 1 spawns locally (we're host)
   - Console: `Joined session XXXX — host? true`
   - Plays normally, broadcasts entities.
3. **Mirror joins host:**
   - Device 1: HOST, pick class, see wave 1 entities
   - Device 2: BROWSE → tap host's session → pick class
   - Device 2 console: `Joined session XXXX — host? false`
   - Device 2 should see device 1's entities (same monsters,
     same positions proportional to arena), updating live
   - Device 2 attacks: bolts hit entities, HP drops on BOTH devices
4. **Host disconnects mid-session:**
   - Three+ players, host refreshes their tab
   - One of the remaining players gets promoted (next-oldest
     in sess.players key order)
   - Console: `[MP] Promoted to entity host — starting local simulation`
   - Brief gap (~50ms) where mirrors render stale entities; new
     host's first broadcast takes over.
5. **Wave clears:**
   - Host clears wave (kills all entities). Host's spawnWave(2) fires.
   - Mirrors detect empty entities → wave-victory screen → CONTINUE
     bumps mirror's local wave display. Host's wave-2 broadcast
     populates mirror's entities.

---

**Risk surfaces:**

- **Mirror entity count drift.** If host's broadcast is delayed
  but mirror's `setRemoteEntities([])` runs, mirror's entities
  go empty momentarily. Wave-clear detection might fire
  spuriously. Mitigation: mirror's `continueToNextWave` no-ops
  on local spawn anyway, and host's next broadcast restores
  the entity list. Worst case: mirror sees a flash of the
  victory screen.

- **Damage event flood.** Mirror tap-fires bolts at 10 Hz; each
  hit sends a `rumble_entity_damage` event. If mirror's bolts
  have AoE, each damaged entity = one event. Server caps queue
  at 100 events per tick — fine for normal play.

- **ID collision across devices.** Host counts `e_1, e_2, ...`
  Mirror also has its own counter (used only for solo paths;
  in coop mirror's local makeEntity isn't called for foreign
  entities). No collision in practice because mirror's entities
  array is rebuilt from host's broadcast, not appended to.

- **Promotion race.** If host disconnects AND simultaneously
  another player's client is mid-broadcast of an entity_state,
  server might forward stale events to a new host. Server
  clears `sess.pendingDamage` on promotion to avoid this.

---

**Standards audit (rule #17 — push #16 of S016 entity authority arc):**

- Rule #25: patch — save.sh canonical
- Rule #14 (UNITY): one entity ID system. One mirror gate at
  damageEntity choke.
- Rule #15 (handoff hygiene): scanned ENTITY_AUTHORITY_PROPOSAL,
  rumble.js entity scope, server session struct, before any
  new code.
- Rule #19 (intuition over menus): committed to interim
  host-auth shape rather than asking "or full server-auth?"
- Rule #28 (unify-at-choke-point): damage choke gates wire vs
  local at single function. Entity render reads single array.
- Rule #29: no parallel entity arrays. No parallel damage
  paths. Mirror's foreign entities live in the same array
  host's canonical entities live in (just marked `_foreign`).

---

### v0.16.75 — Wave-8 bug diagnostic

> "ios ended up displaying wave 8 between 2 and 3"

**Per memory rule #6 — diagnostic before guess.** Real bug
with concrete evidence, but I have zero data on which step
produced the rogue value. Three possible sources:

1. Server's `sess.wave` got bumped to 8 by some client's
   wave_advance message
2. Mirror's session_state handler wrote a stale wave value
3. continueToNextWave fired multiple times (event double-tap)

Adding logs at every wave write site:

- **server.js wave_advance handler** — logs ACCEPTED vs
  rejected with from-player and current sess.wave context
- **rumble_test.html continueToNextWave** — logs the
  increment site with previous/new value + role context
- **rumble_test.html jumpToWave** — logs the actual write
- **rumble_test.html session_joined mirror branch** — logs
  the wave-from-ack write
- **rumble_test.html session_state divergence** — warns when
  msg.wave differs from local by more than 1 (catches stale
  broadcasts)

**What the data will tell us:**
- If rogue advance came from a client: which playerId, what
  newWave value, when
- If it came from a stale broadcast: divergence warning fires
  with the gap
- If continueToNextWave fired twice: increment log shows two
  sequential bumps

---

**iOS 2-finger tap acknowledgment (NOT in this push):**

User confirmed: "two finger tap is only way to select buttons
on ios for BQ" — real platform UX bug, single-tap doesn't
register. Cause already known from code: body has
`touch-action: none`; only some buttons (mode-cards, party
buttons) have `touch-action: manipulation` override. The
wave-debug-icon at line 1488 has the canonical fix pattern
(`touchend` + `preventDefault` to claim gesture). iOS 26
appears stricter than older iOS — even `touch-action:
manipulation` no longer reliably synthesizes click on every
single tap.

**Fix is a separate push (v0.16.76 candidate):** new helper
`_bindTap(elem, action)` that wraps both `click` and
`touchend` handlers, applied at every binding site. ~30
conversion sites. Per rule #6, separating the iOS fix from
this diagnostic push so wave-8 data isn't muddled by tap
behavior changes.

---

**Files changed:** `server.js`, `rumble_test.html`, `NOTES.md`.

UNTOUCHED: rumble.js, rumbleEngine.js, characters.js.

---

**Test focus:**

1. Reproduce wave-8-between-2-and-3 condition. Watch console
   on ALL devices simultaneously. The `[WAVE-DIAG]` lines
   tell us which device wrote the rogue value.
2. If reproduced: screenshot/copy console logs from each
   device. Look for either:
   - `[WAVE-DIAG] advance request newWave=8 → ACCEPTED` on
     server (a client SAID wave should be 8)
   - `[WAVE-DIAG] session_state wave divergence: msg.wave=8
     local=2` on iOS (stale broadcast received)
   - `[WAVE-DIAG] continueToNextWave incremented 2 → 8` on
     any client (multi-fire bug)

---

**Standards audit (rule #17 — push #17 of S016 entity authority arc):**

- Rule #6 (diagnostic-first): VINDICATED yet again. Wave-8
  could have 3 different root causes; speculative fix would
  be coin-flip. Logs cost ~15 LOC; data is priceless.
- Rule #14 (UNITY): all diagnostic lines use `[WAVE-DIAG]`
  prefix so console grep is easy.
- Rule #25 (version bump): patch
- Rule #28 (unify-at-choke-point): logs at the actual write
  sites, not at every read. One log per write, no duplicates.

---

### v0.16.76 — Promotion path fix + role transition diagnostic

> "now it was the non host device, skipped from 2 to 3 then joined 2"

**Per memory rule #6 — diagnostic + targeted fix.** Server log
proved wave-8 was never sent. Real bug is rejoin/promotion
path:

Server log shows iOS connected first → became host → advanced
to wave 3 → dropped (1006) → reconnected. Mac was promoted to
host while iOS was gone. iOS rejoined as mirror.

Reading the v0.16.74 promotion code revealed two bugs:

**Bug 1: `setMirrorMode` not called on promotion via
session_state.** The flag flip only happened on session_joined.
If session_state caught the role change first (faster than
session_joined ack), the flag stayed stale. Result: a
just-promoted host kept `_mirrorMode=true`, suppressing local
AI on its own canonical entities.

**Bug 2: Stale comment.** Line 3260 comment claimed "mirror
suppression isn't implemented in v0.16.74" — but it WAS
implemented. The comment was leftover from an earlier draft
and misled my own audit.

**Bug 3 (architectural, partial fix):** When a player promotes
from mirror → host, their local `entities` array contains
`_foreign: true` entries from the previous host. These entries
are stale and shouldn't be broadcast as the new host's
canonical state. Fix: `clearArena()` on promotion. Trade-off:
brief entity gap during promotion vs broadcasting stale data.
Per memory rule #14 (UNITY) — clean state over partial.

---

**Diagnostic added: `[ROLE-DIAG]` lines.**

Two new log sites:
- `session_joined` ack — logs PREV → NEW role with entityHostId
  + own playerId. Catches initial joins AND reconnects.
- `session_state` mid-session role transition — logs the
  promotion/demotion with reason.

If wave-2-instead-of-wave-3 reproduces, these logs will show:
- What role was iOS assigned on rejoin?
- Was the role transition logged?
- Did mirror_mode flip correctly?

**Per memory rule #28 (unify-at-choke-point):** ROLE-DIAG
prefix matches WAVE-DIAG style for greppable logs. Both write
to console at every transition.

---

**What this push does NOT do:**

- Doesn't address ID collision between previous-host's local
  entities and new-host's broadcast IDs (both count from e_1).
  If iOS was host → dropped → Mac promoted → iOS rejoined as
  mirror, iOS's local entities (e_1, e_2, e_3) collide with
  Mac's broadcast entities (e_1, e_2, e_3). The clearArena on
  promotion fixes the new-host side but the rejoining-as-mirror
  side might still see ID overlap.
- Doesn't ship a fix for the wave bounce (yet). Need more
  data after this diagnostic lands. The fix may be: on
  reconnect-as-mirror, clear local entities AND let
  `setRemoteEntities` rebuild from scratch.
- iOS 2-finger tap fix still pending.

---

**Files changed:** `rumble_test.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, rumbleEngine.js.

---

**Test focus:**

1. Reproduce the rejoin scenario from this turn. Watch for
   `[ROLE-DIAG]` lines in console. Confirm:
   - iOS shows: `session_joined role: HOST → MIRROR` on rejoin
   - Mac shows: `session_state role transition: MIRROR → HOST`
     when iOS dropped (or `session_joined role: MIRROR → HOST`
     if Mac reconnected too)
2. After rejoin, what does iOS HUD show for wave?
3. Are entities visible on iOS post-rejoin (mirror role)?
4. Does Mac broadcast non-empty entities post-promotion?

---

**Standards audit (rule #17 — push #18 of S016 entity authority arc):**

- Rule #6: targeted fix on known issue (stale comment +
  missing flag flip), diagnostic on remaining unknowns
- Rule #14: clean state on promotion via clearArena
- Rule #15 (handoff hygiene): re-read v0.16.74 code carefully
  before writing fixes; caught the stale comment
- Rule #19: committed to clearArena tradeoff without sub-questions
- Rule #25: patch
- Rule #28: ROLE-DIAG prefix matches WAVE-DIAG, single console
  channel for diagnostic data

---

### v0.16.77 — Spurious wave-clear on coop start (regression from v0.16.74)

> Screenshot: "WAVE CLEARED · WAVE 1 · BASELINE" appears
> immediately on coop host start, blocking gameplay.

**Root cause: ordering bug in v0.16.74 deferred-spawn logic.**

v0.16.74 deferred wave-1 spawn until `session_joined` arrived
(needed because mirror IDs would otherwise collide with host's).
But it kept `_waveState.active = true` set BEFORE the spawn.
Result: wave-clear fallback detector at line 1754
(`active && !advancing && entityCount === 0`) fired immediately
on every coop start — entities array was empty, active was true,
victory screen popped up before session_joined could spawn wave 1.

**Fix:** keep `_waveState.active = false` until spawn happens.
`spawnWave()` flips it to true at its top (idempotent for
subsequent waves). Mirror flips it on first non-empty entity
broadcast (mirrors never call spawnWave directly).

**Per memory rule #15 (handoff hygiene):** caught this by
tracing my own v0.16.74 ordering. The flag's semantic should
be "we are mid-wave-run" not "we are configured for waves" —
v0.16.74 violated that without me noticing.

**Per memory rule #14 (UNITY):** spawnWave is now the single
choke point for "wave starts" — it owns flipping active=true.
Mirror has its parallel choke (first remote entity broadcast).
Two paths, same semantic, no duplication.

---

**Files changed:** `rumble_test.html`, `NOTES.md`.

UNTOUCHED: server.js, rumble.js, rumbleEngine.js.

---

**Test focus:**

1. Coop HOST → pick class → arena should appear with wave-1
   entities, no spurious wave-clear screen.
2. Coop HOST + mirror joins later → both see entities
   normally, both can advance through waves.
3. Solo waves run → still works, no regression.
4. Real wave clears (kill all entities) → victory screen
   appears as expected.

---

**Standards audit (push #19 of S016 entity authority arc):**

Quick observation logged for myself: I keep finding bugs by
re-reading my own comments in older code. The v0.16.74
deferred-spawn comment described WHAT was deferred but didn't
flag that `_waveState.active` was being set BEFORE the spawn —
which is exactly the kind of ordering detail that comments
should call out. Pattern noted; if this comes up again I'll
formalize as a memory rule about commenting state-flag
ordering near deferred-execution paths.

- Rule #6: known-bug fix (not speculative). Screenshot showed
  exactly the spurious-clear screen; trace was clean.
- Rule #14: spawnWave owns the active=true flip. Mirror has
  parallel choke. No duplication.
- Rule #15 (handoff hygiene): re-traced v0.16.74 ordering,
  found my own oversight.
- Rule #19: committed to "active=false until spawn" without
  alternatives menu.
- Rule #25: patch.

---

## Design Parking Lot

Captured ideas, design provocations, and "ponder while we build" threads
that don't fit a current chunk but should not be lost. Each entry includes
the seed idea + initial design unpacking so future sessions can pick up
without starting cold. When an idea is ready to build, move it to a chunk
in the relevant build's roadmap section.

### White cast redesign — fixer-as-anchor, others-as-pulse (logged S016 v0.16.74)

**Seed:** Ross at v0.16.74 close:

> "fixer - white aura on self, building white on drag cast; ovld tier
> determines health of white field - can add to field to increase
> radius and healing potential, each successful cast applies its
> amount of ovld charge as health, figure out what the health per
> second charged is, for each second filling ovld, how much health
> is stored in a white field?. all other classes can cast on self
> and on others in fixed range, single blast, no persisting field.
> range increases on ovld. small range, tight range; what about
> wild one?"

**Two distinct behaviors split by class:**

**FIXER (white sig):**
- Self-aura on tap-cast. Aura is a **persisting field** anchored to fixer's position.
- Drag-cast builds the field at the drop location (not following fixer).
- **Overload tier determines field "health"** — total healing the field
  can dispense before it dissipates. Effectively a HP pool the field
  burns through as it heals nearby allies.
- **Stacking is additive.** Cast white again at an existing field →
  cast's overload-charge worth of health adds to the existing pool.
  Field grows in radius proportionally as pool grows.
- **The math question Ross is flagging:** what's HP/sec of overload
  charge time? If overload tier 1 = 0.5s held, tier 2 = 1.0s, tier 3 = 1.5s
  (current pattern), and a tier-1 cast = X health in field, what's X?
  Need to playtest tune; could start with: tier 1 = 4 HP, tier 2 = 9 HP,
  tier 3 = 16 HP (quadratic-ish reward for full charge).
- Field heals all allies in radius at some HP/sec rate. Pool depletes
  as allies regen. When pool hits 0, field dissipates with FX.

**ALL OTHER CLASSES (white as secondary):**
- **No persistent field.** Single-blast cast.
- Self-targeting: tap-cast heals self.
- Others-targeting: cast on ally within fixed range heals them.
- **Range increases on overload tier** but stays small/tight even at
  max tier (white is for "I'm right next to my buddy" not cross-arena).
- One blast = instant heal for the cast's worth of HP. No DoT, no
  field, no pool.

**Wild One question:**
- Wild One signature is currently set to deal damage based on remaining
  HP / restore HP via cycle mechanics — its relationship to white is
  thematic (it's already a "lives close to HP" class). If Wild One's
  existing kit doesn't include white, applying the "small/tight range
  blast on others" rule might be enough. Or Wild One gets a unique
  white interaction — e.g., Wild One's cast heals based on its own
  remaining HP (low HP → bigger heal, high HP → smaller). Worth
  thinking about.
- **Decision to defer:** answer depends on Wild One's overall identity
  arc. For first build, treat Wild One like other non-fixer classes
  (small range blast). Iterate later if that creates dissonance.

**Why this is good design (Claude's read):**
- Fixer becomes a true "anchor" support class — places fields, manages
  HP pool, builds resource for the team. Distinct identity from "tap
  to instant-heal" support.
- Other classes get a small useful self/ally heal without diluting
  fixer's specialty. Tight range encourages positioning.
- Field stacking = depth without complexity. One mechanic (cast adds
  to existing field) replaces what could have been multiple variants.
- Aligns with the broader BrickQuest design ethos of "every color
  behaves the same way everywhere" — white = healing, fixer just gets
  the persistent-field variant of it.

**Build scope estimate (when this lands):**
- Medium. Two cast handlers (fixer-white-field-add vs other-white-blast).
- Field state (`whiteFields[]` already exists in engine state per
  v0.16.60 — empty array, ready to populate).
- Tuning iteration on health-per-second.
- Render: field is a soft white circle that pulses with remaining
  HP pool. Smaller pool = smaller circle. Empty pool = dissipate
  with sparkle FX.
- Ally targeting needs world-space target picking (pointer drag onto
  ally token within range). The "click on ally" UI doesn't exist yet
  — would need a new input mode for white-on-others.

**Roadmap fit:** post-S016 entity authority. Class-specific cast
work fits naturally after the multiplayer foundation is fully solid
(otherwise tuning fields-vs-blasts during multiplayer chaos is
unnecessarily hard).

**Black follows the same fixer-only-field rule (added S016 v0.16.74):**

> "fixer black field as well, only fixer behavior with black, other
> classes cannot create black fields, their ovld black drag needs
> another behavior"

Same architectural shape as white:

- **FIXER + black:** persistent field. Mechanics TBD but parallel
  to white — drag-cast to place, overload tier determines field
  potency, stacking adds to existing field, field has finite
  pool that depletes with use, dissipates when empty.
- **OTHER CLASSES + black overload-drag:** the existing "ovld
  black drag" cast needs a new non-field behavior. Currently
  black drag-cast creates a poison puddle / DoT zone (varies by
  implementation across colors); without the field option, what
  does black overload drag DO for non-fixers?

**Open design question for black:**
What's the fixer field behavior in concept? Black is currently
poison/DoT-zone color. Translating to a fixer field: maybe a
"plague aura" that ticks DoT damage to enemies inside (and pool
depletes per tick of damage dealt — symmetric to white's
heal-on-deplete). Or black field as a "void zone" that slows /
weakens enemies. Decide alongside the white build so both
fields share the same engine plumbing (`blackFields[]` and
`whiteFields[]` use the same field-pool struct).

**Open design question for non-fixer black overload-drag:**
Without the persistent-field option, ideas:
- **Burst at point** (parallel to white-on-others-but-blast):
  single-tick AoE damage at drop point, range scales with
  overload tier. Tight footprint, no DoT.
- **Linger small** (mini-DoT zone with hard time cap): a 2s
  duration poison patch at drop point, no scaling, just a
  consistent "I dropped a small DoT here." Fixed, predictable.
- **Travel projectile** (parallel to red dash, but black): a
  poison bolt that flies to the drop point and explodes on
  contact, applying brief DoT to entities in radius.

**Claude's intuition:** the "single burst at drop point" mirrors
how non-fixer white works (single blast on cast). Symmetric
design across colors:
- Non-fixer white = single heal blast (tight range)
- Non-fixer black = single damage blast (tight AoE at drop)
- Fixer white = persistent heal field
- Fixer black = persistent damage field

That symmetry is the elegance hook. Each color has a "fixer
variant" (persistent field) and a "non-fixer variant" (single
blast). The blast is the universal default; the field is the
specialty. Per memory rule #14 (UNITY): same color same way
everywhere, with fixer as the deliberate variant.

**Build scope (combined white+black):**
Slightly larger than white-only because black field semantics
need definition AND non-fixer black drag needs a new handler
written. But the shared field plumbing means the second color
costs less than the first — once `whiteFields[]` infrastructure
is in, `blackFields[]` is mostly schema reuse with different
on-tick behavior (heal vs damage).

**White and wither — remove caps (logged S016 v0.16.75):**

> "white should not have a cap [n]or wither"

Two caps Ross flagged for removal in the white/black build:

1. **White heal cap at hpMax** (current at `doWhiteHeal` line 8076-77:
   `cap = Math.max(player.hpMax, player.hp); player.hp = Math.min(cap, ...)`).
   Ross wants white heal to overheal beyond hpMax. Open
   question: is overheal infinite, or a temporary buff that
   decays? If decaying, what's the rate? If it's persistent
   shield-like overheal, that's a meaningful balance shift —
   white-stacked players become very tanky.
2. **Wither stack cap MAX_WITHER_STACKS=5** (rumble.js line 7032).
   Ross wants no upper limit on stacks. Currently wither
   amplifies subsequent damage exponentially-ish; uncapped
   stacks could mean a heavily-withered boss takes catastrophic
   damage from any tap-fire. Open question: is uncapped just
   "you can keep applying" with diminishing returns past 5,
   or is the damage curve also uncapped? The damage formula
   needs review at the same time as the cap.

**Shared theme:** white and black/wither are the
"investment-pays-off" colors. Caps at 5 and at hpMax limit how
much the investment can compound. Removing caps changes the
risk/reward curve significantly — worth tuning during the
white+black build, not as a one-off change.

---

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
