# BrickQuest — Project Notes

## Major Cleanup — April 2026

The turn-based battle system and all class skills were ripped out to make room for the real-time arena battle system (v1 shipped Phase 1, Phase 2 next). Removed server-side: all `startBattle`, `rollAttack`, `useBrickInBattle`, `monsterAttack`, `endBattle`, `resolveBattle*`, `advanceBattleTurn`, `nextBattleRound`, `setComplication`, `bossPhase2`, `monsterHPDelta`, `battleTrapPersist`, plus all skill handlers (`unlockSkill`, `activateEnhanced`, `consumeEnhanced`, `deconstructGate`, `rebuildBridge`, `blueprint`, `forge`, `infiniteBlueprint`, `salvage`, `wrecking_ball`, `tameAttempt`, `commandTamed`, `catapult`), plus the legacy out-of-battle brick actions (`addShield`, `healPlayer`, `massRepair`, `revivePlayer`). Game.js lost `MONSTER_TEMPLATES`, `COMPLICATIONS`, and the entire `SKILLS` block. Player state no longer has `skills`, `tamed`, `scavengeRolled` fields; global no longer has `enhancedMovement` or `battleResult`.

Player files (players.html, test_players.html) still contain **dead code paths** that reference the old system — skill tab rendering, battle-mode phase banners, initiative displays. Those paths never execute (they gate on `G.battle` or call SKILLS which is now empty). Left in for now to keep the rip contained; scrub during arena Phase 2 integration. Also kept as no-op stubs: the client-side wrappers like `client.startBattle()`, `client.tameAttempt()`, etc., so any orphaned UI buttons log a warning instead of crashing.

**Kept working** (untouched by rip): Red dash + gate-break, landing events (gold/gray/blue/trap/riddle/purple/creeper), prepare phase UI, trade/market/gate mechanics, arena battle pending + active flow, DM screen, player classes (HP/speed/starting bricks).

**Rebuild queue:** skills system, all class-specific abilities (Builder's Blueprint/Forge, Beastcaller's Tame/Command, Mender's Mass Repair/Revive, etc.) — will be redesigned from scratch during arena Phase 2+ when combat is real.

---

## What is BrickQuest?

A multiplayer tabletop arena game. Players use colored "bricks" as abilities in real-time combat. DM controls the encounter via a separate screen. Runs on local network — players use phones, DM uses laptop.

## Brick Colors & Actions

| Brick | Action |
|-------|--------|
| Red | Charge toward target — deals damage, bounces goblin |
| White | Tap=instant heal, Drag=regen over time |
| Yellow | Confuse in radius — random movement, halved attack speed |
| Blue | Homing bolt to target — impact burst |
| Orange | Tap=trap at feet, Drag=sealed trap at point, bleed on release |
| Gray | Tap=armor pips, Drag=expanding wall |
| Green | Expanding ring push + poison |
| Purple | Expanding burst — heals player for damage dealt |
| Black | Darkness zone — pulls goblins, damage ticks, slow debuff |

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

## Arena Test — Technical Notes

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

Draw order matters. The HP bar's dark background paints over text if text is drawn first. Current order: bar → numbers-on-top with a 3px black stroke for readability on any background. Goblin HP numbers were previously `#151528` (invisible on the dark arena) — now white-with-stroke.

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

## Arena Test — Brick Interaction Fix (Pointer Events)

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

When the arena brick interactions broke on mobile (no targeting, tap-acting-as-hold), debugging traced the root cause to touch-event coalescing on Brave Android. The fix was to switch to Pointer Events — but that required reverting `arena_test.html` to an older baseline (`ArenaTest001.html`) that had working brick mechanics. The reversion RE-INTRODUCED some prior mobile issues that had been addressed in a later version. Status below is honest about what's fixed vs. lost-in-revert.

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
- Goblin HP numbers invisible → changed from `#151528` to white-with-stroke
- Gray and white bricks indistinguishable → gray moved from `#AAAAAA` to `#5e6a7a` slate
- Red charge had no visual feedback → slowed speed, added per-frame trail particles + position streak

## Goblin Stats

- HP: 60, attack: 3 dmg, cooldown: 1.8s
- Goblin types planned: Brute (100hp/5dmg/slow), Scout (35hp/2dmg/fast), Shaman (heals allies)

## File Delivery Note

Default: only deliver files that changed this session.

Full set (when explicitly requested): `server.js`, `game.js`, `players.html`, `dm_screen.html`, `test_players.html`, `arena_test.html`, `serve.sh`, `package.json`, `package-lock.json`.

End deliveries with the push command:
```
cd ~/Desktop/BrickQuest && git add . && git commit -m "update" && git push
```
or `./save.sh "what changed"`.
