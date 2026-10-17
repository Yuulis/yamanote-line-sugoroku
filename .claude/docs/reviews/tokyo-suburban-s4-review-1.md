## Verdict

**fix first** — one reproducible blocker in the promised read-only audit path. The reviewed assembly data and topology otherwise passed the independent checks described below.

## Blocking findings

- **P2 — Audit writes to and deletes a fixed repository directory.**  
  [stage_suburban_assembly.py:87](/home/yuulis/yamanote-line-sugoroku/scripts/data_pipeline/stage_suburban_assembly.py:87)  
  **Failure scenario:** `audit → _require_current_assembly → preflight → _check_jr_baselines` creates `.s4-baseline-check/current`, writes baseline hashes, and removes the directory. Running the requested audit in this read-only checkout exits 2 with `FAIL [Errno 30] Read-only file system: '.../.s4-baseline-check'`. If that fixed directory already exists, line 89 recursively deletes it before checking anything.  
  **Fix:** extract a pure baseline-hash calculation into the shared support module; have both `write_baseline_hashes` and `_check_jr_baselines` use it. Compare hashes in memory. Add a test that rejects write/delete operations: the existing preflight test checks only before/after bytes, while the audit read-only test mocks away this call chain.

## Non-blocking

- **Live regression check passed:** rebuilt the live overrides entirely in memory and compared encoded output bytes against `public/data`; all five files were identical.
- **Topology looks correct:** explicit product targets take precedence; stage datasets resolve Yamanote only when present; other loops export both directions. Export, validation, walks, and reachability consistently receive the resolved target. No additional blocking caller assumption found.
- **Supplemental audit passed:** replacing only `_check_jr_baselines` in memory with an equivalent read-only hash comparison allowed the remaining real audit to complete: `audited`, preservation passed, and counts **135 / 1,586 / 2,142 / 2,009 / 3,988**. This does **not** make the unmodified CLI pass.
- **Evidence checks:** independently reran service length tolerances across all **2,009** recorded pairs; all passed. Re-derived shared-track candidates exactly matched all **1,289** saved entries. Existing checksum, source-hash, pair-coverage, and route-fingerprint checks remain substantive.
- **Identity and offsets:** no blocker found in frozen-map conversion, normalized canonical names/aliases, Fukutoshin owner composition, or offset audit re-derivation. Negative tests cover failed pre-merge checks, non-D1 offsets, the 600 m bound, incorrect limits, stale measurements, and incompatible composition inputs.
- **Tests:** 19 topology/network/offset tests and five targeted export/hash-stability tests passed. An additional selection had 18 passes and one temporary-directory setup error. The full suite could not start under the read-only sandbox; this review does not independently confirm the logged 661-test run.
- **Audit hardening:** the gate does not directly bind or re-derive `shared-track-review.json` and other sidecar metadata. The current shared review matched independent re-derivation, so this is not evidence of a present data defect.

## Carry-overs for S5

- Preserve the documented fresh product rebuild and explicit `targetServiceId`; retain the documented S3 fingerprint stabilization follow-up.
- Verify consumed sidecars—especially shared-track review, UI groups, identity metadata, and normalized mileage components—against frozen inputs rather than treating gate success as authentication of every file under A.
- The generated README uses `.claude/logs/s4` in its commands, while the reviewed saved gate is `.claude/logs/s4/gate`. Use the actual saved location when auditing this handoff.
- Fixing the baseline helper changes assembly/pipeline hashes. Refresh affected assembly provenance, evidence, gate, and handoff records before reporting S4 complete.
