# B1 Edition Switching — Design and Implementation Plan

Source: Codex Sol (read-only) response to P1 in `b1-edition-switch-prompts.md`, 2026-10-20. Reviewed by the Claude lead; adopted as-is.

## 1. TL;DR

- Add a code registry describing each edition’s dataset URL, `GameConfig`, display copy, validation expectations, and save slot. Register only 東京近郊版.
- Keep `/data/`, the existing storage key, rules, engine, and save payload unchanged; pass the selected edition explicitly through the application.
- Hide the picker with one edition; test the complete switching path using two injected fixture editions.
- Reset the application subtree on edition changes, cancel stale load results, and isolate every save operation by the selected slot.
- Implement in six commits. No repository files were changed during this planning task.

## 2. Edition model

### Types and ownership

Add `src/features/editions/types.ts` and `src/features/editions/registry.ts`. Keep edition metadata outside the engine.

```ts
import type { GameConfig, ServiceId } from "../../types/network";

export type EditionId = string;

export type DeepReadonly<T> = {
  readonly [Key in keyof T]: DeepReadonly<T[Key]>;
};

export type EditionTextPart =
  | string
  | Readonly<{ strong: string }>;

export interface EditionDisplay {
  readonly title: string;
  readonly subtitle: string;
  readonly documentTitle: string;
  readonly ruleParagraphs:
    readonly (readonly EditionTextPart[])[];
}

export interface Edition {
  readonly id: EditionId;
  /** Includes Vite BASE_URL and ends in "/". */
  readonly dataBaseUrl: string;
  readonly config: DeepReadonly<GameConfig>;
  readonly expectedStationCounts:
    Readonly<Partial<Record<ServiceId, number>>>;
  readonly display: EditionDisplay;
  readonly saveKey: string;
}

/** The first entry is the initial selection on each page load. */
export type EditionRegistry =
  readonly [Edition, ...Edition[]];
```

The structured text parts preserve the existing `<strong>外回り</strong>` markup without storing JSX or raw HTML in the registry. Copy the current three title-screen paragraphs exactly, including spacing and punctuation.

Use the existing `MVP_GAME_CONFIG` and `EXPECTED_STATION_COUNTS` as the 東京近郊 entry’s values. Retain these exports in `gameConfig.ts`: many existing tests and simulations intentionally describe this frozen product edition. The active application must stop reading those globals directly.

The initial registry entry is:

| Field | Value |
|---|---|
| `id` | `tokyo-suburban` |
| `dataBaseUrl` | `` `${import.meta.env.BASE_URL}data/` `` |
| `config` | Existing `MVP_GAME_CONFIG`, unchanged |
| `expectedStationCounts` | Existing `EXPECTED_STATION_COUNTS`, unchanged |
| Title | `山手線すごろく` |
| Subtitle | `東京近郊版` |
| `documentTitle` | Exact existing `index.html` title |
| Rules | Exact existing `TitleScreen` copy and emphasis |
| `saveKey` | `yamanote-line-sugoroku:save:v1` |

Export `getEdition(id, editions = EDITIONS): Edition | undefined`. Unknown IDs must return `undefined`; they must not silently resolve to another edition.

Check registry invariants with tests: nonempty registry, nonempty unique IDs, trailing-slash data URLs, unique save keys, and agreement between each entry’s ID and derived save key. Sharing a data URL is allowed: a future ruleset edition may intentionally use the same dataset.

### Save-key derivation

Keep `SAVE_STORAGE_KEY` exported from `store/persistence.ts`, unchanged. Put the derivation function in `registry.ts`; persistence must not import the registry.

```ts
export const TOKYO_SUBURBAN_EDITION_ID = "tokyo-suburban";

export function saveKeyForEdition(id: EditionId): string {
  return id === TOKYO_SUBURBAN_EDITION_ID
    ? SAVE_STORAGE_KEY
    : `${SAVE_STORAGE_KEY}:${encodeURIComponent(id)}`;
}
```

The exception is tied to the permanent 東京近郊 ID, **not** to the first registry entry or the current default. Changing registry order later must never move the legacy slot.

Derive `saveKey` when declaring each registry entry. Do not derive it from a title, directory, `dataVersion`, or `rulesetVersion`. Those values can change without changing an edition’s identity.

Extend persistence with a trailing optional key, preserving existing callers:

```ts
readSave(storage, network, config, saveKey = SAVE_STORAGE_KEY)
writeSave(storage, game, saveKey = SAVE_STORAGE_KEY)
deleteSave(storage, saveKey = SAVE_STORAGE_KEY)
```

All active application calls must supply the edition’s key explicitly. `parseSave`, serialization, strict replay, and save version remain unchanged.

There is no migration, fallback search, storage enumeration, copied save, or `editionId` added to the payload. An old 1都3県 save still present under the legacy key continues to be rejected under 東京近郊 exactly as today.

### Application flow

Use props; the dependency chain is shallow enough that a context adds little value.

```text
App: registry + selected edition ID
  └─ EditionApp, keyed by edition.id
       ├─ loadRailwayData(edition.dataBaseUrl)
       ├─ networkFromData(data, edition.config, expectations)
       ├─ loading/error title with edition picker
       └─ GameApp
            ├─ useGameApp(network, storage, config, saveKey)
            ├─ TitleScreen: edition copy + picker
            ├─ GamePanel: edition title/subtitle
            │              target calculations from game.config
            └─ RailwayMap: explicit targetServiceId
```

`App` accepts an optional `editions: EditionRegistry` prop for component tests, defaulting to the production registry. Initialize selection from its first entry on every page mount. Do not read a URL parameter or persist the selection.

Extract existing loading/network construction into `src/app/EditionApp.tsx`. Key this boundary by edition ID so switching destroys the previous reducer, dialogs, animation state, map, and loading state together.

Each load effect retains a cancellation guard. An obsolete request must never publish data into the active edition. Keep the loaded data local to that keyed boundary; do not carry the previous edition’s data through a loading state.

Set `document.title` from the selected entry in `App`, including loading and error states. Leave the static HTML title as the existing default fallback.

`lineVisibilityStore.ts` contains module-level state, which survives React remounts. On an actual edition change, call its existing `setVisibleLineGroupIds(null)` before mounting the next edition. Preserve visibility selection when merely returning to the title or selecting the same edition.

## 3. Change list

The numbers below refer to investigation §4.

| File | Change | Assumption points |
|---|---|---|
| **Add** `src/features/editions/types.ts` | Readonly edition, copy, and registry types. | #3, #7, #13 |
| **Add** `src/features/editions/registry.ts` | Single production entry, exact current copy, lookup, stable legacy ID, save-key derivation. | #1, #3, #7, #9, #13 |
| `src/features/game/store/persistence.ts` | Parameterize read/write/delete by storage key; preserve current defaults and error handling. | #13 |
| `src/features/game/networkFromData.ts` | Accept config and expected station counts. Preserve existing defaults for current test callers; application supplies both explicitly. | #4 |
| `src/features/game/useGameApp.ts` | Require config and save key from the caller. Use config in reducer/read; key in read/write/delete. Include them in relevant hook dependencies. | #5, #13 |
| `src/app/GameApp.tsx` | Receive edition and picker props. Supply config/key to hook; edition config to target calculations and map; copy to title/panel. | #5–#7, #10–#11, #13 |
| `src/features/game/components/GamePanel.tsx` | Receive title/subtitle copy. Replace global config references with `session.game.config`; update memo dependencies. | #6–#7 |
| `src/features/game/components/TitleScreen.tsx` | Render registry copy; compose picker; preserve existing default text, emphasis, actions, and credits. Support loading/switch focus handling. | #7 |
| **Add** `src/features/game/components/EditionPicker.tsx` | Controlled native select, hidden for a single entry; typed change callback and focus ref. | #7 |
| `src/app/App.tsx` | Own registry/selection, validate selections, reset shared line visibility on changes, update document title, mount keyed edition boundary. | #1, #9–#11 |
| **Add** `src/app/EditionApp.tsx` | Selected-data loading, cancellation, network validation, loading/error recovery, ready `GameApp` rendering. | #1, #4, #11 |
| `src/styles.css` | Small picker layout using existing title-card conventions; visible focus and phone-width fit. | #7 |
| `package.json`, `package-lock.json` | Add `jsdom` as a development dependency for the new interaction tests only. | #15 |
| **Add** `tests/unit/helpers/reactDom.ts` | Small `createRoot`/React `act` mounting and cleanup helper. | #15 |
| **Add** `tests/unit/fixtures/editions.ts` | Two test-only edition definitions and tiny schema-v3 response bundles with distinct versions/configs. | #15 |
| **Add** `tests/unit/fixtures/edition-save-compatibility.json` | Pin pre-B1 source, resumed-save, and next-turn byte digests described below. | #13–#15 |
| **Add** `tests/unit/edition-registry.test.ts` | Registry, lookup, keys, URL/copy invariants. | #3, #7, #13 |
| **Add** `tests/unit/edition-runtime.test.ts` | Explicit config/validation expectations with small datasets. | #4–#6 |
| **Add** `tests/unit/edition-picker.test.ts` | Single/two-entry rendering, selection callback, labels, focus. | #7 |
| **Add** `tests/unit/edition-app.test.ts` | Real application/hook integration with mocked map and tiny fetch responses; save isolation and switching. | #5–#7, #11, #13 |
| **Add** `tests/unit/edition-loading.test.ts` | Deferred fetches, obsolete responses, error recovery, selected title/copy. | #1, #9, #11 |
| `tests/unit/persistence.test.ts` | Add explicit-key isolation, deletion, unavailable/quota, and invalid-slot preservation assertions. Keep existing tests. | #13–#14 |
| `tests/unit/product-data.test.ts` | Add captured current-save compatibility assertions against pre-B1 digests. | #14–#15 |
| `tests/e2e/layout.spec.ts` | Add hidden-picker and unchanged-default-title assertions to an existing title-screen scenario. No additional real-data playthrough. | #7, #15 |
| **Add** `docs/manual/edition-switching/implementation-status.md` | Japanese description of shipped infrastructure, picker behavior, save slots, and deferred editions. | #17 |
| `data/README.md` | Explain unchanged default directory and how a future edition supplies a separate schema-v3 directory and registry/copy entry. | #16–#17 |

Keep new component tests as `*.test.ts`, using `createElement`, consistent with existing tests. The real Vitest configuration is in `vite.config.ts`; its include pattern currently matches only `tests/unit/**/*.test.ts`. Use `// @vitest-environment jsdom` in the new DOM test files, leaving the existing suite in Node. No Vite configuration change is necessary.

### Points deliberately left single-edition or otherwise unchanged

- **#2 — loaders:** Already accept a base URL. Keep schema v3 and all guards.
- **#3 — existing config exports:** Retain frozen 東京近郊 constants for compatibility with product tests/simulations. The registry references them; selected runtime behavior uses props.
- **#8 — Yamanote goal wording:** Leave `ClearScreen`, `GameLegend`, and the panel’s goal-specific accessibility wording unchanged. B1 does not add another goal or ruleset. Edition-varying title-screen rules move to registry copy now. A future non-Yamanote product would require a separate UI scope.
- **#9 — `index.html`:** Keep current static title; selected runtime title is set by `App`.
- **#10 — map helpers:** Keep current optional defaults in `RailwayMap`, `railwayLayers`, `progressStyle`, and `stationCollection`. Both application map call sites pass the selected target explicitly; existing internal propagation already supports it. No edits to these helpers are required.
- **#12 — camera:** Existing overview behavior is data-driven and suitable for the deferred candidates.
- **#14 — engine/save:** No engine, RNG, save version, payload schema, or compatibility-validation changes.
- **#15 — current dataset tests:** Retain `public/data/` references, simulation assumptions, E2E fixtures, and the one-level `data/*` route. Multi-edition tests use injected fixtures in Vitest.
- **#16 — pipeline:** No pipeline, CI output-path, filtering, or regeneration change. No second dataset is produced, and the existing default output remains correct.
- **#17 — design decisions:** The 2026-10-20 decision is already recorded in `DESIGN.md`. Preserve historical entries and do not append a duplicate decision.

Adding a future edition using the existing Yamanote goal therefore requires its five data files, a registry entry with `GameConfig` and expectations, and display copy. It requires no engine or storage redesign.

## 4. Title-screen picker

### One registered edition

Render no picker and no extra read-only label. The existing `東京近郊版` subtitle already identifies the edition. This preserves the current layout and tab order.

Preserve the existing initial loading screen for this single-edition case.

### Two or more registered editions

Render a native `<select>` immediately below the subtitle:

- Visible `<label>`: `遊ぶ版`.
- Option values: permanent edition IDs.
- Option text: edition subtitles.
- Controlled value: active edition ID.
- Selecting a different valid ID switches immediately.
- Selecting the current ID is a no-op.
- Unknown values are ignored without loading data or accessing storage.

Native select behavior provides keyboard navigation and selection. Associate the label using `htmlFor`/`id`, retain a visible focus indicator, and fit the control within the phone title card.

During a multi-edition load, keep a picker available alongside `読み込み中…`, announced through `role="status"`. On data failure, show the selected edition’s copy, the existing error message, disabled start/resume actions, and an enabled picker so another edition can be selected.

Because the keyed subtree remounts, explicitly restore focus to the replacement picker during switching. Retain the focus request through loading, restore it again when the ready/error title mounts, then clear it. Ordinary “タイトル” navigation keeps the existing heading-focus behavior.

### Save behavior when switching

Switching editions performs **no storage writes or deletions**.

1. The existing title action has already left gameplay; committed turns retain today’s autosave timing.
2. Switching A → B unmounts A’s session and reads only B’s slot after B’s network validates.
3. B displays its own resume/result/error state.
4. Starting or deleting in B affects only B.
5. Switching back to A displays A’s saved progress.
6. Starting over in an edition with a valid in-progress save retains the existing overwrite-confirmation behavior.

The investigation’s cross-edition silent overwrite is prevented by separate slots. Do not broaden B1 into changing existing handling of an invalid save within its own slot.

Keep today’s storage-failure messages. Switching does not recover progress whose autosave already failed.

## 5. Steps

### Commit 1 — Define registry and pin current compatibility

Add edition types, the single registry entry, lookup/key helpers, registry tests, and the pre-B1 compatibility fixture/test.

Capture expected results before changing runtime code. Keep default data URLs, config values, copy, and storage key exact.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/edition-registry.test.ts tests/unit/product-data.test.ts
```

The acceptance test must establish compatibility before subsequent refactoring.

### Commit 2 — Parameterize persistence slots

Add trailing key arguments to read/write/delete. Add tests using one storage object with two simultaneous slots, including invalid and failing-storage cases. Preserve existing default-key tests.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/persistence.test.ts tests/unit/engine-save-v3.test.ts tests/unit/product-data.test.ts
```

### Commit 3 — Pass the current edition through runtime and presentation

Wire only the default entry initially:

- Parameterize `networkFromData`.
- Pass config/key into `useGameApp`.
- Pass edition into `GameApp`.
- Use `game.config` in `GamePanel`.
- Render title/rules from registry copy.
- Supply the target explicitly to both map call sites.

Keep registry constants stable and retain compatibility defaults for existing utility callers.

Acceptance:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e -- --project=desktop-chromium
```

This commit proves that introducing edition dependencies preserves the current product before selection is enabled.

### Commit 4 — Implement and test the picker component

Add the standalone controlled picker, CSS, test-only DOM dependency/helper, and two-edition fixture definitions.

Use DOM tests for actual change events and focus. Static markup alone is insufficient to prove interaction.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/edition-picker.test.ts tests/unit/edition-registry.test.ts
npm run build
```

### Commit 5 — Integrate edition switching and asynchronous loading

Add `EditionApp`; make `App` own selection and mount it by edition ID. Compose the picker in ready/loading/error views.

Add document-title updates, cancellation guards, focus restoration, and shared line-visibility reset. Test through real `App`, persistence, and reducer code; mock the map and fetch responses, not the application behavior under test.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/edition-app.test.ts tests/unit/edition-loading.test.ts tests/unit/edition-runtime.test.ts tests/unit/persistence.test.ts
npm test
npm run build
npm run test:e2e -- --project=desktop-chromium
```

### Commit 6 — Document behavior and complete regression gates

Update the two documentation locations and add assertions to the existing layout E2E case. Review the complete diff for production fixture editions, changed data, engine modifications, omitted key arguments, or altered default copy.

Acceptance:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e -- --project=desktop-chromium
npm run test:e2e -- --project=phone-chromium
xvfb-run --auto-servernum npm run test:e2e -- --project=desktop-firefox
E2E_WEBKIT=1 xvfb-run --auto-servernum npm run test:e2e -- --project=desktop-webkit
```

The final two commands require the browser/system dependencies used by CI. `playwright.config.ts` enables WebKit locally only with `E2E_WEBKIT=1`; CI enables it automatically. If local dependencies are unavailable, report those legs as unrun and require the existing four-project CI matrix to pass.

No `uv run pytest` is required for this plan because no pipeline file changes. If implementation expands into the pipeline, stop treating that as incidental: justify the scope change and run the Python gates.

## 6. Tests to add

Use these names or equivalent names preserving the requested intent.

| Area | Tests and assertions |
|---|---|
| Registry | `test_registry_known_id_returns_matching_edition`; `test_registry_unknown_id_returns_undefined`; `test_registry_production_entries_contains_only_tokyo_suburban`; `test_registry_duplicate_ids_or_keys_are_rejected` |
| Key derivation | `test_save_key_tokyo_suburban_returns_legacy_key`; `test_save_key_other_editions_returns_distinct_namespaced_keys`; `test_save_key_registry_reordered_keeps_tokyo_suburban_legacy_slot` |
| URL/config | `test_registry_tokyo_suburban_preserves_current_urls_config_and_copy`; `test_network_from_data_explicit_config_validates_selected_edition`; `test_network_from_data_invalid_selected_expectations_blocks_start` |
| Persistence | `test_persistence_two_editions_preserves_independent_saves`; `test_persistence_delete_selected_edition_preserves_other_slot`; `test_persistence_invalid_selected_save_does_not_read_or_modify_other_slot`; `test_persistence_explicit_slot_storage_failure_reports_existing_status` |
| Picker | `test_picker_one_edition_renders_no_control`; `test_picker_two_editions_renders_labeled_native_select`; `test_picker_changed_selection_emits_selected_id`; `test_picker_current_selection_does_not_restart_edition`; `test_picker_switch_remount_restores_focus` |
| App integration | `test_app_switch_away_and_back_restores_each_edition_save`; `test_app_new_game_in_second_edition_preserves_first_save_bytes`; `test_app_selected_in_progress_save_requires_existing_overwrite_confirmation`; `test_app_switch_without_starting_writes_no_save`; `test_app_switch_resets_line_visibility`; `test_app_reload_selects_default_without_remembering_previous_edition` |
| Loading/errors | `test_edition_load_late_previous_response_does_not_replace_active_data`; `test_edition_load_failed_bundle_keeps_picker_and_blocks_start`; `test_edition_load_failed_edition_can_switch_back`; `test_edition_switch_updates_copy_document_title_and_map_target` |
| Current save | `test_restore_existing_tokyo_suburban_save_preserves_unmodified_storage_bytes`; `test_resume_existing_tokyo_suburban_save_matches_pre_b1_serialized_bytes`; `test_next_turn_existing_tokyo_suburban_save_matches_pre_b1_result_bytes` |

Use small fixtures with different data versions **and** different valid config values. Merely changing the ID while sharing all inputs could hide accidental global-config usage.

For the race test, use deferred promises: select B before A’s response completes, settle B, then settle A. Also cover returning to A after a switch. No real timers, network, or real MapLibre instance are needed.

### Existing-save byte compatibility

A baseline detail matters here: **today’s restore reconstructs object properties in a different order from the captured save.** Therefore, `serializeGame(restoreGame(raw)) === raw` is already false, even though the complete restored state matches.

Test three separate contracts:

1. Reading/showing the title and switching away leave stored input bytes untouched.
2. Resuming produces exactly the serialized bytes produced by the pre-B1 code.
3. The next turn produces exactly the pre-B1 saved result, including history and RNG state.

For `tests/e2e/fixtures/tokyo-suburban-before-clear-save.json`, using the existing E2E convention of `trimEnd()`, the current read-only probe produced:

```json
{
  "sourceSha256": "738032db7775bb7725243b7395a31412822765e777e66685b5c230d842a642e4",
  "resumedSaveSha256": "7e7632404b613320a6f18c0835524aacc95aa6307f0057584bbfae0c1b915967",
  "nextTurnSaveSha256": "c7dcf4abc5ec25a28f15d338029799fff3108280c2bce21833cd2b0a9063efdb"
}
```

Pin those pre-change expectations in the new compatibility fixture. Do not regenerate expected values automatically from the implementation being tested.

## 7. Risks

| Risk | Mitigation and acceptance coverage |
|---|---|
| Previous edition state written under the next edition’s key | Key the entire edition boundary, pass immutable config/key dependencies, and test writes while switching. Caught in commits 2 and 5. |
| An older request replaces active data | Local keyed loading state plus cleanup guard; deferred-promise race tests. Caught in commit 5. |
| Default players lose saves or receive changed rules | Literal legacy-key assertion, frozen config/copy tests, captured-save byte baselines, existing restore E2E. Caught in commits 1–3 and final matrix. |
| Global config remains in progress calculations | Explicit runtime fixture with different config; panel uses `game.config`; inspect both map call sites. Caught in commits 3 and 5. |
| Shared line selection hides another edition’s routes | Reset the existing module-level store only on actual edition changes. Caught in commit 5. |
| Picker disappears after a failed load or loses keyboard focus | Keep it available in multi-edition loading/error states; explicit remount-focus tests. Caught in commits 4–5. |
| New test infrastructure slows or changes existing tests | Per-file jsdom environments; existing tests remain Node tests; tiny datasets and mocked map. Full `npm test` in commits 3, 5, and 6. |
| Single-edition title layout changes | Hide the picker completely for one entry; retain exact copy/markup; existing desktop/phone layout tests plus added assertions. |
| Registry/data path collisions | Unique IDs/keys and exact URL tests. Shared dataset URLs remain permitted intentionally for future ruleset editions. |
| Mixed cached files after deployment | Existing risk remains. Keep current structural validation and data-version checks; do not introduce cross-edition application caching. Cache/header redesign is outside B1. |
| Extra slots exhaust storage quota | Existing `failed`/`unavailable` handling remains; tests ensure failure in one slot does not delete another. |
| Existing fixture metadata is mistaken for a reliable byte oracle | All three current 東京近郊 save fixtures differ from their accompanying provenance `saveSha256`. Use independently captured pre-B1 outputs; do not rewrite provenance as part of B1. |

**Validation performed for this plan:** inspected the requested implementation, tests, package scripts, Playwright configuration, and CI matrix. Read-only runtime probes successfully restored all three captured 東京近郊 saves with strict seeded validation, confirmed full state equality, and advanced their next turns.

An exploratory assertion requiring original and restored JSON strings to match failed because the existing serializer changes property order. The follow-up probe established the baseline behavior and the byte expectations above. This does not justify changing serialization in B1.

The npm/Python suites, builds, and browser gates were not run: this task requested a read-only design, and those commands produce artifacts. The commands above are implementation acceptance gates, not claimed passes.

The working tree already contained a modified `.claude/docs/DESIGN.md` and an untracked `.claude/docs/plans/b1-edition-switch-prompts.md`; this task left both untouched.
