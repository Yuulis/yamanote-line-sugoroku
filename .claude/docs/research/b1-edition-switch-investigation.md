# B1 Edition Switching — Scope Investigation

Date: 2026-10-20. Branch `feature/b1-edition-switch` (from develop `ed52d6e`).
Investigation only; no tracked file was edited. Sizes are bytes; "gzip" is GNU
`gzip -9 -n` per file, summed (the pipeline's own Python measurement is quoted
where it differs slightly).

## TL;DR

- The engine and loaders are already generic: `loadRailwayData(baseUrl)`,
  `GameConfig` (lottery policy as data), save validation by `dataVersion` +
  full config. Single-edition assumptions sit in ~10 thin places (config
  constant, data base URL, one storage key, title/subtitle/intro text, tests,
  pipeline default paths).
- Every past ruleset is expressible as a current `GameConfig` value; no engine
  rule variants are needed.
- 1都3県 can be revived with no conversion: `data/baselines/jr-east-capital-region/public/data/`
  is byte-identical to production `88d1745` and already loads through current
  loaders in `tests/unit/real-data.test.ts`.
- A 23区-like edition can be derived by filtering the current bundle. The filter
  reproduces the old counts exactly: 5 services, 67 stations, 146 segments and
  88 features. A Yamanote-only edition is 1, 30, 30 and 30, and its station
  order matches the MVP exactly.
- Game length: Yamanote-only has a median of ~9 turns, 23区 ~52, the current
  edition 55, and 1都3県 61. Only Yamanote-only is meaningfully shorter, which
  is where B1 and A3 overlap.

## 1. Current edition identity

| Item | Value | Evidence |
|---|---|---|
| Name / subtitle | 山手線すごろく — 東京近郊版 | `index.html:6`, `TitleScreen.tsx:139`, `GamePanel.tsx:156` |
| Production since | master `f644bdc` (2026-10-19, PR #29); now `3097627` (PR #33) | `git log --first-parent master` |
| manifest | `schemaVersion: 3`, `dataVersion: n02-2025-8a0970069659`, `updatedAt: 2026-10-15`, `uiPresentation` v1 (15 operators, 134 line groups) | `public/data/manifest.json` |
| Counts | 135 services (135 lines), 1,586 stations, 3,988 directed segments, 30 target segments; 11 prefectures | `public/data/*`, `data/README.md` |
| Operators | JR East 55 services + 14 private/subway operators (80 services) | `services.json` `operator` field |
| Size | 2,577,364 raw; 414,241 gzip (pipeline-measured 413,592). GeoJSON alone 1,288,259 / 265,544 | `ls -l public/data`, `data/README.md` |
| Ruleset | `tokyo-suburban-1`: start `shimbashi`, target `jr-yamanote` dir +1, `truncate-on-target-service`, kindWeights local 1 / rapid 1, Yamanote share 2/3 when ≥2 candidates, direction toward Yamanote 2:1 | `src/features/game/gameConfig.ts:14-25` |
| Edition-specific checks | `EXPECTED_STATION_COUNTS = { "jr-yamanote": 30 }` | `gameConfig.ts:4` |
| Save | `SAVE_VERSION = 3` (`engine/game.ts:23`), one key `yamanote-line-sugoroku:save:v1` (`store/persistence.ts:19`) | |
| Pipeline profile | `data/overrides/dataset.json`: budget `capital-region` (caps 3,145,728 raw / 921,600 gzip), start/target ids, `outputBbox`, expected catalogue SHA | `data/overrides/dataset.json` |
| Game length (S7, 5,000 seeds) | median 55 / p90 146 / p99 261 turns | `docs/manual/tokyo-suburban/implementation-status.md:18` |

The goal itself is the same in every edition shipped so far: traverse all 30
Yamanote outer segments, then arrive at 新橋. Only the network and the lottery
policy changed.

## 2. Past editions

Production follows master merges (memory: feature → develop → master).

| Edition | Prod first → last commit | public/data raw / gzip | Schema / save | Rules | Loadable by current engine? |
|---|---|---|---|---|---|
| Yamanote MVP | `4906c4a` (2026-10-11) → `05c931f` (2026-10-12); replaced by `68eedd8` | 23,223 / 5,008 (1 service, 30 stations, 30 segments, 30 features) | no `schemaVersion` (v1), `services.json` is an array, segment `geometryFeatureId` (singular), no `kind`/`lineIds`/`platformCoordinates`/`directionLabels`; SAVE_VERSION 1 | `mvp-1`; one service, so no lottery ever | **No, as-is.** `validateData` rejects it (`loaders.ts:43-45`, guards `isServicePattern`/`isSegment` require v3 fields). A mechanical conversion is possible but pointless: the filtered current Yamanote has identical `stationIds` (verified). |
| JR East 東京23区 | `68eedd8` (2026-10-12) → replaced by `88d1745` (2026-10-15) | 88,057 / 13,597 (5 services, 67 stations, 146 segments, 88 features) | schemaVersion 2, services array, `geometryFeatureId` singular, no `kind`/`lineIds`/`endpoints`/`lines`; SAVE_VERSION 2 | `jr-east-23ku-1`: uniform service draw, uniform direction draw (old `landing.ts` header at `68eedd8`) | **Not as-is** (v2). Conversion is mechanical except `endpoints` kinds, which need judgment. The better route is a **filter of the current bundle** (§3), which reproduces the counts exactly. Rules are expressible today as `serviceLottery {kindWeights 1/1, target {kind:"weight", weight:1}}`, `directionLottery {towardTargetWeight:1}`. Equal weights take the `drawIndex` path (`engine/rng.ts:211`), so the draws are identical to the old uniform draw. |
| JR East 1都3県 | `88d1745` (2026-10-15) → replaced by `f644bdc` (2026-10-19) | 744,720 / 125,353 (40 services, 472 stations, 1,224 segments, 568 features) | schemaVersion 3; SAVE_VERSION 3; no `uiPresentation` | `jr-east-capital-1`: Yamanote share 1/2, direction 2:1 | **Yes, as-is.** `data/baselines/jr-east-capital-region/public/data/*` is byte-identical to `88d1745:public/data/*` (sha256 checked for all 5 files). It is loaded through `loadRailwayData` + `networkFromData` by `tests/e2e/fixtures/bundle.ts` (`old-edition`) and played and restored in `tests/unit/real-data.test.ts` with `LEGACY_CAPITAL_REGION_CONFIG` (`tests/unit/fixtures/legacyConfig.ts`). Caveat: with no `uiPresentation`, `presentationResolver.lineGroups()` returns `[]` (`presentationResolver.ts:133`), so the line-visibility panel would be empty. A generated `uiPresentation` sidecar would fix that (S). |

Game length by edition: Yamanote-only median 9 (≈30/3.5;
`.claude/docs/research/jr-east-tokyo-expansion-design.md:143`); 23区 R1-a median
52 / p90 114 / p99 189 (same file §3.2); 1都3県 median 61 / p90 148 / p99 258
(`docs/manual/jr-east-capital-region/implementation-status.md:29`); current
55 / 146 / 261.

**Rule variants:** none needed in the engine. `GameConfig` already carries
every lottery parameter, and `parseLotteryPolicies` accepts all the
historical values (`engine/config.ts:39-74`). Reviving an edition is a matter
of config values plus a distinct `rulesetVersion`.

**Old saves:** v1 and v2 saves are rejected by `parseSaveVersion`
(`engine/save.ts:130-139`). A 1都3県 save still in a user's localStorage
(`dataVersion n02-2025-82589587088b`, `jr-east-capital-1`) would restore again
if that edition were revived with the identical bundle and config.

## 3. Cheap derivations by filtering the current bundle

Measured on `public/data` (scratch script; serialized compactly):

| Derived edition | Selection | Services / stations / segments / features | Approx. size (segments+geojson+stations) |
|---|---|---|---|
| Yamanote-only | `jr-yamanote` | 1 / 30 / 30 / 30 | ~20 KB raw / ~4.3 KB gzip |
| 23区-like | 5 services, truncated to the old `68eedd8` station ranges (all contiguous in the current order) | 5 / 67 / 146 / 88, exactly the old 23区 counts | ~72 KB raw / ~11 KB gzip |

All five services own their own geometry features: no segment in these subsets
references a feature owned by another service. Across the whole bundle, 148
segment→feature references cross services, so a general filter must check this.

What a filter step must handle, or else something breaks:

- **Engine invariants** (`engine/network.ts`): every station must be served
  (line ~173), and segments may only join adjacent stations. So drop
  unreferenced stations, and drop segments outside the kept station ranges.
- **Guards** (`data/guards.ts` `isServicePattern`): `platformCoordinates` must
  have exactly the kept `stationIds`. Truncated services need new `endpoints`
  (`area-boundary` at the cut). Endpoint kinds only affect labels
  (`gameSummary.ts:39-40`), not movement.
- **Geometry check** (`networkFromData.ts:32-77`): it rejects orphan features,
  owners missing from the network, and reverse-chain mismatches. Drop the
  unreferenced features, and refuse any subset whose segments use features of
  excluded services.
- **uiPresentation** (`guards.ts` `hasValidUiPresentationReferences`): every
  service must be in exactly one line group, and every alias and stop-name must
  reference kept ids. Otherwise the manifest is reported as failed
  (`loaders.ts:83-97`). The fix is to filter `lineGroups`, `operators`,
  `stations` and `serviceStopNames`.
- **dataVersion**: it must be new and derived, e.g. a hash of the subset plus
  the parent version, so saves never cross editions. Saves are bound to it
  (`engine/save.ts:359`).
- **Goal / config**: the Yamanote target and 新橋 start stay valid for both
  subsets (`validateConfig`, `engine/config.ts:112-136`), as does
  `EXPECTED_STATION_COUNTS`.
- **Lottery**: Yamanote-only never draws (k=1 at every station), so the game is
  pure dice: median ~9 turns. The UI copy about lotteries and the line-visibility
  panel become noise. 23区-like works with any policy, but its length under
  `tokyo-suburban-1` (2/3) is unmeasured; run `SIM_BUNDLE=<dir> npm run sim`.
- **Python validator**: `scripts/data_pipeline/validate.py` and CI
  (`.github/workflows/ci.yml:78`) validate only `public/data` against
  `data/overrides` (expected catalogue SHA, budget profile, bbox). A derived
  directory needs either a validator "derived" mode (subset of the parent, same
  geometry bytes) or a TS-side Vitest check via `networkFromData`. The filter
  needs no raw N02, so it can run in CI.
- **Transfers / platform offsets**: none of the reviewed exceptions (上野
  常磐線快速 transfer, 武蔵小杉 南武線) fall in either subset. 東京 京葉線 offset
  (≤500 m) is in 23区-like, and is reviewed and allowed.

## 4. Hard-wired single-edition points

| # | Location | Assumption | Edition-aware change | Size |
|---|---|---|---|---|
| 1 | `src/app/App.tsx:9,16-24` | `DATA_BASE_URL = BASE_URL + "data/"`; data loaded once on mount, before the title | Load the selected edition's path; reload on switch | S |
| 2 | `src/data/loaders.ts` | Already parameterised by `baseUrl`; schema v3 only | None (all candidate editions are v3) | — |
| 3 | `src/features/game/gameConfig.ts:4,14` | One `MVP_GAME_CONFIG` + `EXPECTED_STATION_COUNTS` | Move into an edition registry entry | S |
| 4 | `src/features/game/networkFromData.ts:29,31` | Validates with the global config | Take config/expectations as parameters | S |
| 5 | `src/features/game/useGameApp.ts:48,65` | Global config for the reducer and `readSave` | Pass the edition config + save slot | S |
| 6 | `src/app/GameApp.tsx:65`; `GamePanel.tsx:96,105-106` | Global config for target segments | Pass from the edition | S |
| 7 | `TitleScreen.tsx:124,139,142,145`; `GamePanel.tsx:155-156` | Subtitle and rule text (2/3, 2:1, 東京近郊) hard-coded | Text from the registry; edition picker UI (focus, a11y, phone layout) | M |
| 8 | `ClearScreen.tsx:44`, `GameLegend.tsx:24,54,58`, `GamePanel.tsx:215-216` | "山手線外回り全30区間" | No change while every edition targets Yamanote | — |
| 9 | `index.html:6` | Static `<title>` 東京近郊版 | Set `document.title` at runtime | S |
| 10 | `src/features/map/{RailwayMap.tsx:177, railwayLayers.ts:79,245, progressStyle.ts:12,20, stationCollection.ts:42}` | Default `targetServiceId` from the global config | Defaults stay valid (Yamanote); pass explicitly for hygiene | S |
| 11 | `RailwayMap.tsx:213-292` | Map is created in an effect keyed on `data` | Switching edition recreates the map and basemap (cost ≈ first-load time). Acceptable; key by edition id | S |
| 12 | `src/features/map/mapConfig.ts:6-7`, `camera.ts:36` | Initial centre is Yamanote; overview fits the whole network if it spans ≤0.5°, else Yamanote only | Already data-driven; fine for all candidates | — |
| 13 | `store/persistence.ts:19` (+ `tests/e2e/support/app.ts:10`) | One storage key for any edition | Per-edition key; legacy key = 東京近郊 slot | M (with tests) |
| 14 | `engine/save.ts:130-139,359-367`, `engine/game.ts:23` | SAVE_VERSION 3, dataVersion and config equality | **No change**: already rejects cross-edition saves correctly | — |
| 15 | Tests: `tests/e2e/fixtures/bundle.ts` (paths), `tests/e2e/fixtures.ts:41` (route glob `data/*`, one level only), `real-data.spec.ts:219-222`, `layout.spec.ts:70`, `tokyo-suburban.spec.ts`, `tests/unit/product-data.test.ts`, `tests/simulation/*` | One real dataset at `public/data/` | Keep the current edition at `public/data/` so these stay valid; add per-edition tests | M |
| 16 | Pipeline: `scripts/data_pipeline/config.py:11` `DEFAULT_OUT_DIR = public/data`; `validate.py:706`; CI step; ~40 files reference `public/data` | Single output | Keep the default; add a filter command writing `public/data/<edition>/` + validation | M |
| 17 | Docs: `.claude/docs/DESIGN.md:191` records the decision "エディション選択は設けない" (2026-10-12) | — | Reverse via `/design-tracker`; update `docs/manual`, `data/README.md` | S |

Key design point: **leave the current edition at `public/data/`** (unchanged
URLs, tests and pipeline) and put extra editions in subdirectories. This
avoids touching ~40 path references. The e2e route glob `data/*` does not
match subdirectories, which is acceptable because fixtures only stand in for
the default edition.

## 5. Save and caching implications

**Today:** one key `yamanote-line-sugoroku:save:v1`. `readSave` replays the
save against the loaded network and rejects it on `saveVersion`, then
`dataVersion` (`DATA_VERSION_MISMATCH` → "路線データが更新されたため…"), then the
full config (`CONFIG_MISMATCH`; `sameConfig` at `engine/save.ts:276`), then the
RNG replay (`persistence.ts:43-57`). Rejected saves can only be discarded.

**Shared-slot problem:** with editions sharing that key, a save from edition A
shows under edition B as "路線データが更新された". That message is misleading.
"はじめから" in B then overwrites A's game: the overwrite confirm in
`GameApp.tsx:174-185` only checks `saveLookup.kind === "valid"`.

**Per-edition slots require:**

- Key `yamanote-line-sugoroku:save:v1:<editionId>`. Keep the existing key as
  the 東京近郊 slot, so current production saves survive with zero migration.
- Validating only the selected edition's save. Full validation needs that
  edition's network, so the title can show other editions' saves only through a
  shallow JSON peek (turn, status).
- Remembering the last-selected edition (one more key).
- Quota: a save is ~362 KB at 1,000 turns (C-roadmap §4), and medians are
  ~55 turns. A few slots fit the typical ~5 MB per origin. `writeSave`
  already reports "failed".
- A2 (records) should key on edition id + dataVersion + rulesetVersion as well.

**Caching:** there is no `vercel.json`, no service worker, and no header
config in `vite.config.ts`. Files under `public/data` have unhashed names, so
they get Vercel's default static headers (assumed: revalidate each request,
not immutable; not verified against production). Loading 2.5 MB/0.41 MB gzip
happens only for the selected edition. Risks with several editions:

1. A mixed-version file set right after a deploy (old cached `segments.json` +
   new `manifest.json`). This risk exists today. `networkFromData` catches
   most structural mismatches, but `dataVersion` is read only from the
   manifest.
2. Two editions accidentally pointing at the same files.

Recommended: per-edition directory names, optionally including `dataVersion`
(e.g. `data/editions/<id>/`), and an editions registry in code (not fetched),
so the title can list editions before any data loads. Deploy size grows by
the added bundles only: Yamanote ~25 KB, 23区-like ~85 KB, 1都3県 745 KB.

## 6. Scope options

| Option | Size | What the user gets | Main risks | Forces decisions on |
|---|---|---|---|---|
| **O1** Infra only: registry, per-edition data path and save slot, picker with the single 東京近郊 entry | S–M | Nothing visible; groundwork | Abstraction with no second user (YAGNI); can't validate the design | Registry shape, save-key scheme, URL param |
| **O2** O1 + **Yamanote-only** derived by filter (new `rulesetVersion`, e.g. `yamanote-1`) | M | A ~1–2 min game (median ~9 turns), tiny data (~4 KB gzip), instant load; also delivers A3's "山手線だけ" | No lotteries, so pure dice and possibly dull. Optional rule tweak (`exact-stop` at 新橋) changes length, needs sim. Lottery-related UI text and panels need edition-aware hiding | Rules for this edition; whether pure-dice is acceptable |
| **O3** O1 + **23区-like** derived by filter (old rules `jr-east-23ku-1`-equivalent, or current 2/3 policy) | M | A compact 5-line JR network, small data (~14 KB gzip), nostalgia | **Not shorter** (median 52 vs 55). Geometry is today's, not the old bytes. Old v2 saves still unrestorable. Length under 2/3 policy is unmeasured | Historical vs current lottery; is "smaller map" valuable |
| **O4** O1 + **revive 1都3県** from `data/baselines/...` | M | The previous production edition back as-is (JR only, 40 lines) | 745 KB frozen bundle never regenerated (pipeline has moved on). Needs a `uiPresentation` sidecar (empty line panel otherwise). Longer game (median 61). Two large datasets in tests/CI | Freeze vs regenerate policy; whether "JR only" is wanted |
| **O5** O1 + filter tool + Yamanote-only **and** 23区-like | M–L | Three choices spanning ~9 / ~52 / ~55 turn medians | Combined risks of O2/O3; more UI copy and tests | All of the above |

**Recommendation: O2.** It is the only candidate whose game length differs
meaningfully from the current edition, so it is the only one with a clear user
reason to switch. It is also A3's Yamanote-only variant, so one piece of work
serves both roadmap items. Its data is tiny and derived mechanically from the
reviewed bundle, so there is no new data-quality review. And it exercises
every infra seam (registry, data path, save slots, picker, derived validation)
with a real second entry.

Design the filter generally (§3 checks) so 23区-like or 1都3県 can follow as
S-sized registry entries. Before building, confirm the user accepts a
lottery-free game, or choose a Yamanote-only rule twist and measure it with
`npm run sim`.

**B1 ↔ A3:** model an *edition* as (dataset, ruleset, presentation text). A3's
"short ruleset on the current network" then becomes another registry entry that
shares `public/data/` with a different `rulesetVersion`. Saves stay separate
because the slot key is the edition id and `sameConfig` checks the config.
Build B1's registry first; A3's ruleset comparison then plugs in without
another save or UI redesign.

## 7. User decisions needed

1. **Editions in the first release**: (a) infra only, (b) +山手線のみ, (c)
   +23区相当, (d) +1都3県 revived, (e) b+c. *Default: (b).*
2. **Rules of the added edition**: Yamanote-only keeps the current goal (stop
   at 新橋 after 30 segments; no lotteries) vs a variant such as `exact-stop`.
   For revived/derived editions, historical lottery rules vs current
   `tokyo-suburban-1`. *Default: Yamanote-only with the current goal and
   `rulesetVersion` `yamanote-1`; revived editions keep their historical
   rules.*
3. **Save handling**: per-edition slots (legacy key stays the 東京近郊 slot) vs
   one shared slot with an overwrite warning. *Default: per-edition slots.*
4. **How the edition is chosen and remembered**: title-screen picker only vs
   also a URL parameter (`?edition=`, useful for A1 sharing); remember the last
   choice. *Default: picker + remember last; URL param yes.*
5. **Data maintenance for non-default editions**: derived editions regenerated
   by the filter whenever the main bundle changes (their saves are invalidated
   on each data update) vs frozen copies. *Default: derived = regenerated and
   validated in CI; revived = frozen.*
6. **A3 relationship**: count Yamanote-only as A3's "山手線だけ" delivery, and
   treat A3's shorter ruleset on the current network as a later registry
   entry. *Default: yes.*

Each choice also requires reversing the DESIGN.md decision at line 191
("エディション選択は設けない") through `/design-tracker`.
