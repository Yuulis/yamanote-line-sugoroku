# S4 assembled-stage review

This review was regenerated on 2026-10-18 after `REVIEW.md` was accidentally deleted during the post-review rebuild of A. It records the committed A artifacts and the existing review/handoff evidence; A was not rebuilt or re-measured for this regeneration.

## Lead adjustments and evidence

1. **Frozen canonical display names.** Registry names use the frozen canonical catalog name; distinct original station names remain aliases in frozen row order. `tests/data_pipeline/test_suburban_assembly_network.py` checks registry names and aliases against the frozen catalog. This follows the binding adjustment that supersedes the plan's joined-name wording.
2. **Correct frozen route counts.** The independent oracle derives counts from frozen catalog/service rows. The correction is 2,009 service route pairs (JR 922 + non-JR 1,087), producing 3,988 directed segments; this replaces the plan's erroneous 1,994-pair count. `verification.json` records 135 services, 1,586 station groups, 2,142 stop rows, 2,009 route-pair rows, and 3,988 directed segments.
3. **D1 merge offsets.** `offset-review.json` records 50 `d1-merge` rows. The greatest measured offset is 497.334596 m (below the frozen 600 m D1 bound); limits use the recorded rounded-up-to-10-m-plus-10-m formula, while the global 250 m default remains unchanged. `overrides/offset_exceptions.csv` contains those 50 entries. Three S3 exceptions were dropped because merged offsets returned within 250 m: `metro-yurakucho/iidabashi`, `metro-hanzomon/metro-akasaka-mitsuke`, and `metro-namboku/iidabashi`. Two were replaced after changed offsets: `metro-hanzomon/shin-nihombashi` (previous limit 270 m) and `metro-fukutoshin/ikebukuro` (previous limit 350 m).
4. **Non-target loops run both ways.** `stage_suburban_assembly.py` derives directed segment expectations with only the frozen target service one-way. `test_suburban_assembly_network.py::test_frozen_ui_groups_and_shared_track_review_are_complete` checks that `toei-oedo-loop` exports both directions for every frozen loop pair. The committed live bundle remains byte-identical, as recorded in the S4 handoff.
5. **Shared-track decisions.** `shared-track-review.json` is `reviewed`: 1,289 candidates, 0 open; 1,284 `keep-independent` and 5 `composed`. Reasons: 678 `transfer-boundary`, 49 `distinct-n02-lines`, 539 `inherited-jr-routing`, 14 `n02-coverage-borrowing`, 4 `plan-specified-independent`, and 5 `shared-track-composed`. The five Fukutoshin pairs between 和光市 and 小竹向原 are composed under owner `metro-yurakucho`, as also recorded in `assembly-report.json`.

## Evidence hashes and review outcome

The evidence hash fix uses `_stable_repr` to sort `frozenset` members before serialization; `tests/data_pipeline/test_suburban_assembly_evidence.py` exercises different `PYTHONHASHSEED` values and stable representations. This removes hash variation caused by set iteration order.

The follow-up review is `.claude/docs/reviews/tokyo-suburban-s4-review-1.md`. Its initial outcome was **fix first** for the audit path writing and deleting `.s4-baseline-check`. The S4 handoff records the subsequent Luna fix as in-memory baseline hashes plus a no-write test and the README gate-path correction; lead verification then passed. The handoff records 662 tests passed, ruff/ty, freeze checks, live-byte identity, LF checks, all eight S3 group audits, and S3 handoff verification as passing.

## Verification and carry-overs

`verification.json` is `verified`; A/B are byte-identical, both builds validated, all evidence batches verified, bidirectional reachability passed, shipped geometry/platforms and service platform keys were retained, and audit preservation passed. It records ten verified evidence batches and the frozen counts above. `README.md` records gate report SHA-256 `dc3085f9d630922f0dc7d2a93f1877f5b9905c1c0f3084256c39685d5ee7438f`.

S2/S3 carry-overs recorded for S4 are closed: baseline checks, S3 handoff and eight group audits, route/platform preservation, and full 2,009-pair evidence coverage are recorded as passing in the network handoff. The approved shared-track composition is limited to the five Fukutoshin pairs; all remaining candidates are classified independently.

Open carry-overs to S5/S6 from `.claude/docs/plans/tokyo-suburban-network-handoff.md`:

- Thread product `targetServiceId` and make a fresh product build from A's audited overrides.
- Change `stage_suburban_nonjr.py::_filter_recipe_hash` from `repr` to `_stable_repr`, and prove S3 outputs stay unchanged.
- Verify consumed sidecars against frozen inputs: shared-track review, UI groups, identity metadata, and mileage components.
- Decide how to display the 22 private-railway names containing large ケ as an S6 display choice.

## S5 provenance refresh (2026-10-18)

S5 changed hashed S4 helpers (`_stable_repr` moved to `stage_suburban_support.py`; `_distance_reference` now resolves the
historical baseline after the product cutover). The lead re-ran preflight, assemble, offsets, review-shared, all ten evidence
batches, gate, audit and handoff. Only provenance hashes changed (16 lines in `README.md`, `verification.json`,
`assembly-report.json`, `inputs-sha256.json` and the evidence manifests); catalogue, pair measurements, sidecars and the
five-file build hashes are unchanged. The current gate report SHA-256 is
`b324a5d69deff266a4348ea827bdb4b94750ad074eb14f0815f571bbbb0a4ee0` (S4 commit value: `dc3085f9…`). The S5 carry-overs listed
above are closed in S5 (see `.claude/docs/plans/tokyo-suburban-network-handoff.md`), except the large-ケ display choice (S6).
