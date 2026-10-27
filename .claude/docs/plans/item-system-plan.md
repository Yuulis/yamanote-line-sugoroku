## TL;DR

- Implement A6 on `feature/item-system` as **engine → save v4 → application flow → UI → shipped default**, keeping classic available only through internal configuration.
- Recommend a **saveable two-phase turn**: commit pre-roll choices and the revealed roll, then accept adjustment and resolve movement. Preserve the spike’s two RNG streams: dice/landing together, items separately.
- Use the spike’s effects as the reference, but obtain decisions on its product simplifications before freezing `tokyo-suburban-items-1`. No files were modified; the commands below are implementation acceptance commands, not checks already run.

## Analysis

### Current architecture facts

| Area | Current implementation and consequence |
|---|---|
| Turn execution | [`engine/game.ts:96`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/game.ts:96) implements a history-free `computeTurn`; [`game.ts:209`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/game.ts:209) exposes atomic `playTurn`. `seededTurn` draws the die before computing movement and landing. There is no pending decision state. |
| State and records | [`network.ts:66`](/home/yuulis/yamanote-line-sugoroku/src/types/network.ts:66) defines `MoveRecord` around one die roll, ridden service, traversed segments and landing. [`network.ts:101`](/home/yuulis/yamanote-line-sugoroku/src/types/network.ts:101) has one RNG state and no inventory or effects. These shared types live outside `engine/`. |
| RNG | [`engine/rng.ts:13`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/rng.ts:13) specifies one stream ordered die → service → direction. Forced choices consume no draw. [`rng.ts:195`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/rng.ts:195) deliberately avoids weight normalization because equivalent probabilities can produce different seeded trajectories. |
| Lottery representation | [`landing.ts:78`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/landing.ts:78) compares `towardTargetWeight` against implicit weight 1. It cannot express 3:2. Service share already supports 1/2. [`config.ts:63`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/config.ts:63) requires the direction object to contain exactly its current key. |
| Candidate construction | [`landing.ts:103`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/landing.ts:103) constructs all station services and assumes the ridden service is present. Suspension and detour require filtered candidates without changing classic candidate order. |
| Movement | [`movement.ts:69`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/movement.ts:69) accepts a hop budget and records every traversed segment. Goal checks occur during traversal. The public turn wrapper restricts the die to 1–6; movement itself is reusable for doubled, rapid and oversleep movement. |
| Save validation | [`save.ts:130`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/save.ts:130) accepts only the current format, presently v3. Structural replay compares supplied rolls/landings; [`save.ts:313`](/home/yuulis/yamanote-line-sugoroku/src/features/game/engine/save.ts:313) independently verifies seeded history. Both currently assume completed, atomic turns. |
| Application lifecycle | [`gameSession.ts:134`](/home/yuulis/yamanote-line-sugoroku/src/features/game/gameSession.ts:134) commits a turn and then animates it. [`useGameApp.ts:57`](/home/yuulis/yamanote-line-sugoroku/src/features/game/useGameApp.ts:57) saves committed changes through an effect. Existing session/turn guards prevent stale clicks. |
| Restored presentation | [`gameSession.ts:79`](/home/yuulis/yamanote-line-sugoroku/src/features/game/gameSession.ts:79) reconstructs the last landing from current, unfiltered `landingOptions`. That becomes incorrect when historical suspension/detour filters differ from current effects. |
| Presentation/statistics | [`gameSummary.ts:45`](/home/yuulis/yamanote-line-sugoroku/src/features/game/gameSummary.ts:45) calculates unused pips as `roll - traversedSegmentIds.length`. This fails for double, rapid and oversleep. [`GamePanel.tsx:36`](/home/yuulis/yamanote-line-sugoroku/src/features/game/components/GamePanel.tsx:36) treats absent landing as a goal, which fails for deadhead. |
| Product wiring | [`gameConfig.ts:14`](/home/yuulis/yamanote-line-sugoroku/src/features/game/gameConfig.ts:14) exports classic as `MVP_GAME_CONFIG`; [`registry.ts:13`](/home/yuulis/yamanote-line-sugoroku/src/features/editions/registry.ts:13) registers one edition using that configuration. Rules text belongs to edition display metadata. |
| Persistence boundary | [`persistence.ts:14`](/home/yuulis/yamanote-line-sugoroku/src/features/game/store/persistence.ts:14) intentionally keeps one stable storage key while checking the payload’s format. Preserve that key so an old save remains discoverable and discardable. |

The two 2026-10-27 decisions in `DESIGN.md:223–224` supersede the earlier suggestion in proposal §8 to expose classic through edition selection. **Do not add a classic edition, rules picker, URL mode or remembered classic selection.**

### Reference effects to preserve, subject to the open questions

- Route selects a service at the current station. A non-Yamanote choice draws its direction before the die; a direction ticket can then override it.
- Adjustment changes the die face within 1–6, then double multiplies it. Rapid converts the resulting pips into transfer-station arrivals.
- Delay acquired on turn `t` forces turn `t+3` to 1 and prevents active item use.
- Suspension filters future landing and route-ticket candidates for five turns. It does not immediately stop the current ride.
- Detour waits until another active service is available; it does not stack.
- Oversleep affects the next turn, takes precedence over a delay due that turn, prevents active item use, and still consumes a die draw.
- Deadhead replaces a turn: no die, no landing lottery, no completed segments; nearest Yamanote station by directed graph distance; ties follow Yamanote station order.
- A certificate occupies an inventory slot and automatically consumes itself to cancel the next harmful pickup.
- Drops occur after the landing lottery, only at the final arrival, with no clearing-turn drop in the spike.

The spike also uses its **item RNG for the random bot’s choices**. Production must not couple drop randomness to an automated player’s implementation. That distinction matters for parity testing.

## Decisions recommended

### 1. Turn model: choose a saveable two-phase turn

| Consideration | A. Saveable pending roll | B. Deterministic preview from separate dice RNG |
|---|---|---|
| Transition | `beginItemTurn(preActions)` → pending roll → `finishItemTurn(adjustment)` | Preview next die, then atomically commit all actions |
| Pre-roll ordering | Choices are frozen before revealing the die | Requires a separate lock to prevent changing choices after preview |
| Reload | Restores the same roll and frozen choices | Restores the same die, but an unsaved choice lock disappears |
| RNG/reference parity | Can preserve the spike’s shared dice/landing stream | Introduces new trajectories; route-direction draws no longer precede dice in the same stream |
| Save complexity | Adds a pending transcript and replay validation | Simple only if pre-roll choices may be reconsidered after seeing the die |
| Fairness | Normal UI cannot undo committed pre-roll choices | A saved choice lock effectively reintroduces a pending state |

**Recommend A.** The principal benefit is a clear gameplay contract: pre-roll items really are chosen before the roll.

Proposed sequence:

1. At the next turn, determine due delay/oversleep restrictions.
2. Let the player compose pre-roll choices without revealing random outcomes.
3. On “roll”, validate and freeze the complete pre-roll bundle.
4. Resolve route selection and its direction draw, then direction override, then double/rapid modifiers.
5. Draw the die and create a saveable pending-roll transcript.
6. Reveal the roll after the save attempt. If adjustment is available, offer valid `−1`, unchanged and `+1` choices.
7. Resolve movement, goal, landing and drop; append one completed record.
8. Save the completed result, then animate it.

Deadhead is an exclusive alternative at step 3: it resolves the replacement turn directly and cannot accompany other active items.

Use a canonical order independent of UI click order:

`route → direction → double → rapid → die → adjust → movement`

Permit at most one use of each active kind per turn, subject to user confirmation below. Certificate remains passive.

**Pending-state representation:** retain the top-level position, inventory, timers and RNG at the last completed turn. Add a pending transcript containing the next turn number, committed pre-actions, resolved ride and raw roll. Selected inventory instances are reserved and unavailable while pending. The pure engine reconstructs the prepared position and post-roll RNG from the base state when completing the turn.

This avoids an unexplained half-turn mutation of top-level fields. Pure reconstruction does not consume a second random draw: only the returned RNG states define advancement.

Rules:

- Completed history length and `turn` advance only on final resolution.
- Pending turns cannot accept new pre-roll choices, deadhead or another roll.
- Leaving for the title and resuming preserves pending choices.
- Closing the adjustment UI means “continue without adjustment” or leaves it pending; it never cancels the roll.
- When no adjustment decision is possible, the application may begin and finish in one deterministic transition.
- An atomic convenience API for simulation composes the same functions; it must not implement another turn loop.

This prevents ordinary UI reload exploits, not deliberate save editing. Existing seeded verification already documents that reproducibility is not authenticity.

### 2. RNG contract: two production streams, preserving classic exactly

Recommend **main dice/landing RNG + independent item RNG** for this ruleset.

| Stream | Initialization | Draw contract |
|---|---|---|
| Classic main | Existing `seedRng(seed)` | Entire existing contract unchanged |
| Item-mode main | `seedRng(seed)` | Optional route-direction draw → die → landing service → landing direction |
| Items | `seedRng(seed + "|items")` | Drop over 1,000 → harmful classification over 100 → kind → suspension service if applicable |
| Simulation policy | Separate test-only seed namespace | Random bot choices only; never part of a production save |

Specific invariants:

- Drop succeeds for indices `<300`; harmful classification succeeds for indices `<30`.
- Preserve beneficial/harmful pool order from the spike.
- A forced choice consumes no draw.
- Goal completion consumes no landing or drop draws.
- Deadhead consumes no main-stream draw, but does make its arrival drop draw.
- Delay and oversleep consume the normal die draw before overriding movement.
- Certificate cancellation occurs after harmful kind selection and **before suspension-service selection**. A cancelled suspension therefore consumes no target-service draw.
- Rendering, hints, action previews, animation and save serialization consume no RNG.
- Classic must neither initialize nor draw an item stream.

Separating dice from landing is unnecessary for A6 with this turn model. It would be appropriate when adding a future “show upcoming dice” item, under a newly versioned contract. A6 must not imply such a feature is already supported.

Keep sfc32, rejection sampling and `drawWeightedIndex` unchanged. Preserve existing die snapshots, mixed-turn snapshots and S7 classic game lengths exactly.

### 3. Lottery weights: extend the existing shape without rewriting classic

Recommend:

```ts
interface DirectionLotteryPolicy {
  towardTargetWeight: number;
  awayFromTargetWeight?: number; // absent means 1
}
```

- Classic retains the exact existing object `{ towardTargetWeight: 2 }`.
- Item mode uses `{ towardTargetWeight: 3, awayFromTargetWeight: 2 }`.
- Validate optional presence strictly: an explicitly supplied invalid or `undefined` value is rejected.
- Validate each supplied weight using existing positive-integer bounds.
- Equal next-stop distances remain `[1, 1]`.
- One direction remains forced and consumes no RNG.
- Unequal distances receive `[toward, away]` in canonical direction order.
- Do not normalize by GCD or rewrite classic config objects.
- Extend config copying, parsing and equality, including preservation of an absent optional property.

Service weighting stays in the existing representation:

```ts
target: { kind: "share", numerator: 1, denominator: 2 }
kindWeights: { local: 1, rapid: 1 }
```

Apply suspension filtering, its all-filtered fallback, then detour filtering, **before** computing service shares. This preserves Yamanote’s 1/2 share among remaining eligible candidates.

### 4. State, records and save v4

Use a validated item-policy block in `GameConfig`, absent for classic. It identifies the station-item mechanism and carries the fixed probability/cap settings. It is not a user-configurable options screen.

Add item-mode state through explicitly narrowed types rather than making every engine function handle unrelated optional fields.

| State | Recommended representation |
|---|---|
| Inventory | Ordered array of held instances `{ id, kind }`, maximum three; deterministic IDs derived from acquisition turn |
| Delays | Sorted, unique due-turn numbers |
| Suspensions | JSON-safe service/expiry entries, with deterministic ordering |
| Detour | Boolean pending flag |
| Oversleep | Boolean pending flag |
| Certificate | An inventory kind; no separate certificate boolean |
| Item randomness | Serialized `itemRngState` |
| Pending decision | Nullable pending-turn transcript described above |

Do not serialize `Map` or `Set` directly.

Evolve records as a union while preserving classic record shape:

- **Classic record:** current fields and meanings.
- **Item ride record:** raw die, effective face where applicable, movement mode, movement pips, hop budget, actual segments, unused pips, commands, resolved pre-roll ride, landing snapshot and item outcomes.
- **Deadhead record:** replacement-turn discriminator, origin/destination, committed ticket use, no roll, no traversed segments, no landing lottery and an explicit relocation outcome.

Record item outcomes as tagged events: pickup retained/discarded, harmful effect scheduled, effect activated/expired, certificate cancellation and consumed item instance. Record player choices as commands; generated outcomes remain outputs.

A deadhead record must not use a fake roll of 0 or a fabricated segment. `landing: null` must no longer imply “cleared”.

For rapid movement, distinguish **pips** from **physical hops**:

- Double can produce 2–12 pips.
- Rapid and oversleep can traverse substantially more than 12 segments.
- Keep all actual completed segments in production, including non-target ones.
- Calculate rapid pips spent from actual counted transfer-station arrivals.
- Report endpoint/goal unused pips from the movement mode, not `roll - hops`.
- The spike loses some endpoint metadata by converting pips to hops before `advance`; correcting that metadata must preserve its arrival/progress behavior.

Save v4 should:

1. Reject v1–v3 before replay; provide no migration.
2. Preserve the storage key and current invalid-save/discard interaction.
3. Validate config, every RNG string, inventory capacity/IDs, known services, timer bounds, pending combinations and record variants.
4. Structurally replay commands and recorded outcomes, checking legal consumption, effects, movement, candidates and final item state.
5. Seededly replay the same commands, regenerating every die, lottery and drop and comparing all generated outputs and RNG states.
6. Replay completed history first, then reconstruct/verify a pending turn if present.
7. Preserve the history-free kernel so restore remains linear in history length.

Classic remains internally constructible and can use the current v4 envelope. Its gameplay/RNG contract stays unchanged.

Some current tests literally assert `SAVE_VERSION === 3` or treat 4 as a future version. Those assertions must be updated for the intentional format change, with equivalent or stronger rejection tests. **Do not update gameplay/RNG snapshots to accommodate a changed sequence.**

### 5. Configuration and edition wiring

In `gameConfig.ts`:

- Extract/export `CLASSIC_GAME_CONFIG` with the existing contents.
- Initially preserve `MVP_GAME_CONFIG` as its compatibility alias.
- Add `ITEM_GAME_CONFIG` using `tokyo-suburban-items-1`, mild weights and the validated item policy.
- At final integration, make `MVP_GAME_CONFIG` the shipped item configuration, or replace product consumers with an explicit `DEFAULT_GAME_CONFIG`. Prefer the explicit name for new code.

Before switching the default, change classic simulation and baseline tests to import `CLASSIC_GAME_CONFIG` explicitly, including:

- `tests/simulation/suburban-product.test.ts`
- S7 observation runner
- Spike reference configuration
- Tests whose purpose is classic trajectory preservation

Keep one edition, the same edition ID, data URL, station counts and save key. Point its config to item mode only after the engine, save and UI paths pass. Update `ruleParagraphs`; do not add a rules picker or a second classic registry entry.

## UI plan

### Inventory and pre-roll use

Add small components rather than extending the already substantial `GamePanel` indefinitely:

- `InventoryPanel.tsx`: three slots, item name, one-sentence effect, timing, availability and disabled reason.
- `ItemUseDialog.tsx`: service/direction selection and pre-roll bundle review.
- `RollAdjustment.tsx`: raw die, legal adjustments, resulting movement pips and continue action.
- `ItemEventNotice.tsx`: arrival events, cancellation and future-effect countdowns.
- Pure `itemPresentation.ts` helpers for descriptions and hints.

Allow the player to stage choices before rolling and revise them freely while no outcome has been revealed. Show selected items next to the roll button. Committing the roll freezes them.

Do not reveal the route ticket’s randomized direction while the bundle is still editable. Once committed, show the resolved ride alongside the die.

Certificate is labelled passive and has no “use” button. Explain that it occupies one of the three slots.

### Guidance for first-time players

Use the same legal-option queries as the engine:

- At an eligible interchange: “路線指定券で山手線に乗れます”.
- Show each candidate’s direction labels and whether its next stop is closer to Yamanote.
- At equal distances, say there is no shorter direction.
- Explain that distances are graph-hop guidance, not guaranteed travel times.
- Recommend rapid when heading toward Yamanote; warn that it can carry the player farther away in the opposite direction.
- Show double/adjust composition explicitly, for example raw 4 → adjusted 5 → doubled 10 pips.
- Disable invalid choices with text explaining why: Yamanote’s direction is fixed, suspension excludes a route, delay/oversleep prevents active use, or an item is already selected.
- Preserve service-specific choices beneath grouped display names such as Oedo; do not collapse distinct selectable services into one ambiguous option.

Guidance changes neither legal effects nor the frozen reference bot’s policy.

### Harmful events and historical presentation

After arrival, announce the landing and item outcome together:

- Delay: activation turn and countdown.
- Suspension: affected service and remaining turns; explain fallback when it cannot exclude every service.
- Detour: waiting until an eligible interchange.
- Oversleep: next turn’s forced movement.
- Certificate: harmful item drawn, cancelled, certificate consumed.
- Inventory full: discarded pickup and reason.

Derive restored notices and landing candidates from verified history/replay outputs. Do not reconstruct historical candidates using today’s effects.

For deadhead, show relocation text and reposition the marker without inventing a travelled route. For long rapid/oversleep moves, support skip and reduced motion; avoid an unbounded animation duration.

### Accessibility and mobile

- Announce roll availability, raw roll, adjustment choice, harmful events and effect activation through a coordinated polite live region. Avoid competing announcements from multiple components.
- Put focus on the adjustment heading/control when that decision opens; restore it to the roll control after resolution.
- Item dialogs use native modal focus behavior. Escape cancels an uncommitted selection; it cannot undo a revealed roll.
- Keep controls keyboard-operable and expose selected state and unavailable reasons.
- Reduced motion skips presentation only; it must retain the adjustment decision and all announcements.
- Keep three inventory slots readable at 320–390 px widths, with a scrollable item sheet for longer descriptions. Maintain access to the main action, save status and map controls without horizontal scrolling.
- Include map-unavailable coverage: every item decision must remain usable through text.

### Title and result sharing

Update edition rule paragraphs and the manual with acquisition probability, harmful share, capacity, pre-roll timing and the adjustment exception.

Identify shared results as “東京近郊版・アイテム制” while retaining the existing hashtag and site URL. Preserve the three established summary metrics unless the user approves an extension. Define relocation and pre-roll transfer accounting before updating `gameSummary.ts`.

## Steps

All paths described as “new” are proposed implementation files. Each step is a separate reviewable commit; keep the product registry on classic until S11.

| Step | Deliverable | Size | Implementer suitability |
|---|---|---:|---|
| S1 | Explicit classic baseline and contract fixtures | S | Cheaper implementer after exact scope is supplied |
| S2 | 3:2 direction policy and internal item config | M | Cheaper implementer after schema decision |
| S3 | Movement modes and filtered candidate queries | M | Judgment required |
| S4 | Inventory, drops and harmful-effect reducers | M | Well-specified after product answers |
| S5 | Item turn orchestration and pending-roll state | L | Judgment required |
| S6 | Save v4 parsing and both replay modes | L | Judgment required |
| S7 | Real-engine simulation and parity evidence | M | Policy port is mechanical; findings need judgment |
| S8 | Application/session flow and persistence boundary | M | Judgment required |
| S9 | Inventory, selection, adjustment and hints | M | Cheaper implementer with fixed UI contract |
| S10 | Notifications, animation and accessibility | M | Mixed; integration needs judgment |
| S11 | Product default, result text, manuals and fixtures | M | Mostly well-specified |
| S12 | Integration gates and final review | S | Lead/reviewer judgment |

### S1 — Isolate and freeze classic

**Files:** `gameConfig.ts`; classic consumers in `tests/simulation/`; relevant unit fixtures; new `tests/unit/item-classic-regression.test.ts`.

- Introduce `CLASSIC_GAME_CONFIG` without changing values or product behavior.
- Make S7 and spike baseline imports explicit.
- Preserve the existing mixed-turn snapshot and die sequence.
- Add focused classic regression coverage proving new item APIs reject classic input and do not change classic RNG.
- Capture baseline config, seed set and input hashes without replacing historical evidence.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-rng.test.ts tests/unit/engine-landing.test.ts tests/unit/engine-lottery-policy.test.ts tests/unit/item-classic-regression.test.ts
npm test
```

Accept only if classic gameplay snapshots remain unchanged. Full 5,000-game classic verification runs at S7.

### S2 — Extend direction policy and define item config

**Files:** `src/types/network.ts`, `engine/config.ts`, `engine/landing.ts`, config parsing/equality in `engine/save.ts`, `gameConfig.ts`; policy/config unit tests.

- Add the optional away weight, validation and absent-property-preserving copies.
- Define the internal item policy/config; keep edition wiring unchanged.
- Test 3:2 in both canonical direction orders, ties, unreachable/tied distances, forced direction, invalid policy fields and save config comparison.
- Prove existing classic weights and RNG results remain unchanged.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-policy-config.test.ts tests/unit/engine-lottery-policy.test.ts tests/unit/engine-weighted-rng.test.ts tests/unit/engine-save-v3.test.ts
npm test
```

### S3 — Add pure movement and candidate queries

**Files:** `engine/landing.ts`, `engine/movement.ts`, `engine/proximity.ts`; new `engine/itemMovement.ts`, `engine/itemOptions.ts`; new corresponding unit tests.

- Add suspension/detour filtering with stable ordering and explicit consumption results.
- Reuse current lottery weighting after filtering.
- Implement rapid hop planning, oversleep endpoints and deterministic nearest-target selection.
- Add mode-aware pip accounting and relocation output.
- Expose pure legal-option/hint queries without exposing future lottery outcomes.

**Tests:** all-suspended fallback, one active service, detour persistence, suspension-forced detour consumption, endpoint truncation, target goal truncation, rapid plus double, long paths, BFS tie order and no-target-path error handling.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-item-movement.test.ts tests/unit/engine-item-options.test.ts tests/unit/engine-landing.test.ts tests/unit/engine-game.test.ts
```

### S4 — Implement inventory and effect transitions

**Files:** new `engine/items.ts`, `engine/itemEffects.ts`; item domain types; new `tests/unit/engine-items.test.ts`, `engine-item-effects.test.ts`.

- Implement immutable inventory operations and deterministic instance IDs.
- Implement drop/classification/pool draws in the specified order.
- Implement capacity, certificate cancellation, delay scheduling, suspension expiry, detour and oversleep flags.
- Return typed events and next RNG state; no React, storage or clock access.
- Keep helpers unconnected to the shipped classic flow.

**Tests:** probability boundaries 299/300 and 29/30, pool coverage, full inventory, duplicate certificates, cancellation before suspension-target draw, exact `t+3`/five-turn boundaries and non-stacking behavior.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-items.test.ts tests/unit/engine-item-effects.test.ts tests/unit/engine-rng.test.ts
```

### S5 — Build the item turn kernel

**Files:** `engine/game.ts`, `engine/types.ts`, `engine/index.ts`, shared state/record types; new `engine/itemTurn.ts` and `tests/unit/engine-item-turn.test.ts`.

- Implement begin/finalize APIs and an atomic composition for noninteractive callers.
- Validate commands, instance ownership, canonical ordering and forced-turn restrictions.
- Integrate all beneficial/harmful effects, movement, landing and drops.
- Add the item/deadhead record variants and typed events.
- Prevent duplicate completion, stale pending input, changing pre-actions after reveal and completing after the goal.
- Keep the classic execution branch and record output intact.

**Tests:** phased versus composed result equality, exact draw sequence, route+direction+double+rapid+adjust, invalid ±1 boundaries, delay/oversleep collision, deadhead exclusion, clearing-turn behavior, deterministic replay inputs and input immutability.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-item-turn.test.ts tests/unit/item-classic-regression.test.ts tests/unit/engine-game.test.ts tests/unit/engine-landing.test.ts
npm test
```

### S6 — Introduce save v4 and replay validation

**Files:** `engine/game.ts` save constant, `engine/save.ts`; new parser/replay modules as needed to keep files focused; `store/persistence.ts`; save/persistence tests.

- Bump to v4 globally; reject old formats without migration.
- Add strict item/pending record parsing and full config comparison.
- Extend structural replay and seeded replay through the same turn kernel.
- Compare final inventory, timers, flags, pending transcript and all RNG states.
- Preserve typed error categories and stable storage-key behavior.
- Update literal version assertions and future-version rejection fixtures; retain gameplay assertions.

**Tests:** settled/pending/completed round-trips; pending turn zero; illegal item use; forged raw die, landing, drop, suspension target, certificate use, timers, inventory and RNG; missing required fields; byte-preserving old-save rejection/discard.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/engine-save.test.ts tests/unit/engine-save-v2.test.ts tests/unit/engine-save-v3.test.ts tests/unit/engine-save-v4.test.ts tests/unit/persistence.test.ts
npm test
```

### S7 — Validate gameplay through the real engine

**Files:** new `tests/simulation/item-engine/` runner, policy adapters and report logic; new unit tests for policy/report logic; `tests/simulation/README.md`. Keep the spike implementation frozen.

- Drive the real begin/finalize APIs.
- Port greedy/random policies without importing spike mutation or landing logic.
- Preserve a separate policy RNG.
- Produce parity reports and classic exact-comparison evidence as specified below.
- Sample complete histories through production save verification.

**Acceptance:**

```bash
npx vitest run tests/unit/item-simulation-policy.test.ts tests/unit/item-simulation-report.test.ts

ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 \
  npm run sim -- tests/simulation/item-engine/item-engine.test.ts

ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=5000 \
  npm run sim -- tests/simulation/item-engine/item-engine.test.ts

SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=5000 \
  S5_OUTPUT=.claude/logs/s6/simulation/a6-classic/sim-0.json \
  npm run sim -- tests/simulation/suburban-product.test.ts
```

The new runner must implement the proposed `ITEM_ENGINE_*` interface before these commands become executable. An unexpected parity failure blocks product-default wiring.

### S8 — Integrate session state and persistence

**Files:** `gameSession.ts`, `useGameApp.ts`, `src/app/GameApp.tsx`; session/app-state unit tests.

- Add preparing, adjustment and animation transitions around the engine’s pending state.
- Keep editable drafts separate from committed pending choices.
- Identify actions by session, completed turn and decision revision, because multiple actions now occur within one turn.
- Attempt pending persistence before revealing its roll; report write failure and allow continued in-memory play.
- Resume pending decisions directly; resume completed movement without replaying its animation.
- Treat `turn > 0 OR pending != null` as progress when deciding whether a new game overwrites an active game.
- Preserve StrictMode purity and stale-callback guards.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/game-session.test.ts tests/unit/game-app-state.test.ts tests/unit/game-session-items.test.ts tests/unit/persistence.test.ts
```

### S9 — Build inventory and decisions

**Files:** proposed item components and `itemPresentation.ts`; `GamePanel.tsx`, `GameApp.tsx`, `src/styles.css`; component/presentation tests.

- Render three slots, selection controls, timing and disabled reasons.
- Implement staged pre-roll choices and raw-roll adjustment.
- Add route/direction/rapid guidance from pure engine queries.
- Preserve grouped route labels while selecting concrete services.
- Verify narrow-screen layout and text-only operation.

**Acceptance:**

```bash
npm run typecheck
npx vitest run tests/unit/item-presentation.test.ts tests/unit/item-controls.test.ts tests/unit/game-presentation.test.ts
npm run build
```

### S10 — Integrate events, animation and accessibility

**Files:** `presentation.ts`, `gameSession.ts`, event components, affected `animation/*` modules; component tests; new `tests/e2e/items.spec.ts`.

- Replace assumptions that no landing means a goal or that hops equal pips.
- Reconstruct historical landing/event information correctly on resume.
- Handle long moves and direct deadhead repositioning.
- Coordinate announcements and focus.
- Test pending reload, certificate cancellation, harmful countdowns, repeated clicks, skip, reduced motion and map failure.

**Acceptance:**

```bash
npx vitest run tests/unit/animation.test.ts tests/unit/game-presentation.test.ts tests/unit/item-controls.test.ts tests/unit/game-session-items.test.ts
npx playwright test tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts tests/e2e/map-failure.spec.ts --workers=2 --retries=0
```

### S11 — Ship item mode as the sole product ruleset

**Files:** `gameConfig.ts`, `editions/registry.ts`, affected edition tests; `gameSummary.ts`, `shareText.ts`, `ClearScreen.tsx`; product E2E fixtures/proofs; `docs/manual/tokyo-suburban/rules.md`, implementation status and current README/spec references.

- Switch the single registered edition to item mode.
- Update title rules, share identification and approved statistics.
- Regenerate product seeds/saves through the real engine with provenance.
- Keep historical save payloads immutable as rejection fixtures; generate new v4 counterparts for current resume scenarios.
- Update existing product E2E expectations intentionally.
- Keep synthetic classic engine tests and classic S7 imports explicit.
- Write manual content in Japanese.

**Acceptance:**

```bash
npx vitest run tests/unit/edition-registry.test.ts tests/unit/edition-runtime.test.ts tests/unit/result-share.test.ts tests/unit/real-data-e2e-scenarios.test.ts tests/unit/e2e-fixture-seeds.test.ts
npx playwright test tests/e2e/items.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/full-game.spec.ts --workers=2 --retries=0
npm run build
```

### S12 — Final integration gates

- Inspect the complete feature diff for unrelated edits, weakened tests, fake movement records, swallowed errors and duplicate turn implementations.
- Re-run simulation only if gameplay, config, policy or RNG changed after S7.
- Verify no production entry point offers classic.
- Record actual test results, simulation hashes and unresolved device/browser limitations.
- Treat release/deployment and the project’s advance-notice policy as separate delivery work.

**Acceptance:**

```bash
npm run typecheck
npm test
npm run build
npx playwright test --workers=2 --retries=0
git diff --check
bash scripts/check.sh
```

## Simulation parity plan

### Three distinct acceptance layers

**1. Classic exactness**

Use explicit classic config, shipped bundle, seeds `s1m-20261012-0..4999` and a 20,000-turn cap.

Require:

- Existing RNG and mixed-turn snapshots unchanged.
- All 5,000 per-seed turn counts equal the frozen S7 evidence.
- Median 55, p90 146, p99 261, mean 69.3858, maximum 446.
- Zero cap hits and zero games over 500 turns.

Engine source hashes will legitimately change. Record new hashes alongside the unchanged golden trajectory evidence; do not rewrite historical evidence to hide that difference.

**2. Effect-level equivalence**

Use small networks and deterministic seeds/commands to compare production behavior against independently stated expectations for:

- Each item alone and relevant combinations.
- Suspension fallback/expiry.
- Detour waiting and consumption.
- Delay/oversleep precedence.
- Certificate cancellation draw order.
- Rapid endpoint/goal behavior.
- Nearest-target ties.
- Deadhead not completing segments or triggering a landing lottery.

These are hard correctness checks, not statistical tolerance checks.

**3. Round-2 distribution reproduction**

Use the real engine for both policies:

| Policy | Reference median | p90 | p99 | Maximum | Over 500 |
|---|---:|---:|---:|---:|---:|
| Greedy | 67 | 157 | 285 | 478 | 0.00% |
| Random | 112 | 231 | 370 | 642 | 0.22% |

Freeze the reference greedy heuristic, including its imperfect rapid use when off Yamanote. Do not substitute the UI’s improved recommendation and still claim reference-policy reproduction.

The random bot must use an independent policy RNG. Consequently, its per-seed games will differ from the spike, whose choices advanced item RNG. Compare distributions rather than requiring identical trajectories.

For 5,000 games per policy, predeclare:

- Median difference ≤ `max(5 turns, 10% of reference)`.
- p90 difference ≤ `max(10 turns, 10%)`.
- p99 difference ≤ `max(20 turns, 10%)`.
- Additionally require p99 **below 400** for each policy.
- Over-500 share ≤ 0.5%; zero cap hits; 100% completion.
- Maximum is diagnostic, not an exact acceptance target.

With all recommended reference semantics retained, greedy should additionally reproduce per-seed turn counts exactly because it introduces no random-policy draws. Investigate any difference before accepting the broader tolerance.

For each report, save config, seed list/hash, five bundle hashes, engine/policy hashes, raw turns, quantile convention, item-use/drop/discard counters, cancellations and errors. Repeat one fixed subset to prove deterministic output, excluding runtime.

A failure triggers investigation of the first divergent decision or event. Do not retune weights, seeds or tolerances to pass. If the user chooses different product semantics, preserve the original reference report and produce a clearly labelled new measurement.

## Open questions for the user

These are product decisions left by the simulation’s simplifications. Engine work depending on them should wait for answers; unrelated foundation work can proceed.

| Question | Recommendation |
|---|---|
| Can suspension select Yamanote? What happens when every candidate is suspended? | **Yes**, matching the measured model. Suspend selection for turns `t+1..t+5`, retain the current ride until landing, and ignore suspension locally if it would remove every candidate. No forced reversal. |
| What constitutes an arrival for drops? Include the goal and rapid pass-through stations? | Only the final non-clearing arrival of a turn. No start-of-game, intermediate-station or clearing-turn drop. Deadhead arrival does receive a drop. |
| What happens to a beneficial pickup when inventory is full? | Discard the newly drawn item and announce it. Choosing a replacement introduces another saveable decision and changes the measured policy. |
| How many active items may be combined? Can duplicate tickets multiply again? | At most one of each active kind per turn; allow route → direction → double → rapid and one post-roll adjust. Deadhead is exclusive. Duplicate held items remain available for later turns. |
| Does a route ticket also choose direction? May the player select the current service? | Service only; draw a non-Yamanote direction before the die, then permit a direction ticket override. Allow current-service selection when a route choice exists, matching the random reference policy. |
| Are all active items blocked by delay/oversleep? Do repeated effects stack? | Block active use on those forced turns. Delay is due at `t+3`; identical due turns collapse. Detour/oversleep use one flag. Repeated suspension refreshes that service’s expiry. Oversleep consumes and overrides a coincident due delay. |
| What exactly does rapid count? | Stations with at least two underlying services, regardless of temporary suspension. Count only their arrivals, preserve every traversed segment and normal goal checks, and allow double/adjust combinations. Correct unused-pip reporting without changing destinations. |
| What does oversleep do on a circular service? | On Yamanote, move six hops as measured. For another circular service, recommend a documented bounded six-hop fallback rather than an arbitrary whole-network traversal limit. Test whether the shipped graph can exercise that case; if it can, remeasure the difference. |
| What are deadhead’s destination and goal semantics? | Directed-hop nearest Yamanote station; ties follow target station order; board outer loop. Spend one turn, no die/lottery/segment completion. Do not clear merely by relocation to Shimbashi, matching the spike. |
| Does deadhead count as a “move” or transfer in results? | Keep “moves” as actual travelled segment hops, so deadhead adds **zero moves and one turn**. Count actual service-group changes from route tickets and deadhead as transfers, excluding same-group Oedo changes. State this in the manual. |
| Can certificates be activated or protect an already scheduled effect? | Passive inventory items; consume the oldest certificate against the next harmful pickup only. They cannot retroactively cancel scheduled effects. Multiple held certificates protect multiple later pickups. |

## Risks

- **Pending persistence is the largest architectural change.** Keep one engine transition implementation, validate pending transcripts through replay and test reloads before/after every decision boundary.
- **Historical candidate reconstruction can silently become wrong.** Verify and retain landing snapshots from the relevant turn, rather than applying current effects to past records.
- **Rapid/oversleep exceed existing die-based presentation assumptions.** Separate die face, movement pips, hop budget and actual hops throughout records, summaries and animation.
- **Reference random-policy RNG differs from production policy RNG.** Document the distinction and use predeclared distribution tolerances; preserve exact classic checks.
- **Several product answers can change balance.** Freeze them before claiming Round-2 reproduction. The 30%/30%, mild weights and selected item set are already decided.
- **Changing the shipped default invalidates current product fixtures.** Regenerate current saves with provenance while preserving historical payloads for rejection tests.
- **v4 intentionally makes old saves unusable.** Retain discovery and explicit discard behavior; apply the project’s announced-update/release policy when shipping.
- **Planning is complete, implementation remains unverified.** No source, tests or documents were changed, and no test suite or simulation was executed during this read-only task.

## Addendum (2026-10-27): user answers to the open questions

Recorded in `.claude/docs/DESIGN.md` Key Decisions (2026-10-27). Answers that differ from the recommendations above take precedence:

- Inventory full: the player chooses which one of the four items (three held + the new one) to discard. This adds a saveable post-turn decision; treat it like the pending-roll state (one engine transition, replay-validated).
- At most ONE active item per turn in total, including 出目調整券 (no adjust after a pre-roll item). Deadhead remains exclusive; the certificate is passive and not counted.
- All other recommendations were accepted as written.
- Round 3 simulation (`.claude/docs/research/item-system-simulation.md`, "Round 3") confirms the targets under these rules: greedy 65/143/241, random 113/232/370. S7 parity should target the round-3 "both rules" rows, not round 2.
