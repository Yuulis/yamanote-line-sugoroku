## Verdict

**fix first** — one reproducible regression in the data-error fallback. The normal S6 product path otherwise appears consistent with the approved decisions.

## Blocking findings

- **[P2] Uncaught network-validation exception during fallback rendering — `src/features/map/RailwayMap.tsx:153`.**  
  The map now calls `buildRailwayNetwork()` during render without handling its validation errors. When shape-valid gameplay data contains inconsistent references, `networkFromData()` correctly returns an error, and `App` renders the fallback map plus the explanatory title screen. The map then reconstructs the same invalid network and throws, aborting that fallback UI.
  **Reproduced:** changing the first segment’s `serviceId` to `nonexistent-service` makes `networkFromData()` return `{ok:false, reason:"路線データが不正です"}`, while the new map construction throws `INVALID_NETWORK`.
  **Fix:** reuse a successfully validated network/resolver, or build the display resolver from lightweight station/service indexes. When the network is invalid, preserve the map’s canonical-label fallback without throwing. Add a regression asserting that inconsistent references still show the error message and disabled start control.

## Non-blocking

- **Approved decisions:** independently confirmed the exact introductory copy, unchanged `dataVersion`, one Oedo presentation group containing both engine services, and the single `大江戸線（抽選枠2）` candidate row. Resolver checks passed for all **22 small-ヶ station identities**, spanning 25 service-stop records. Title/subtitle, notice removal, and resolver wiring through panel, popup and history match the intended changes.

- **Gameplay integrity:** independently compared all four gameplay payloads byte-for-byte with `c76ad92`; all match. No engine/lottery implementation changes were found. Presentation grouping retains engine candidate IDs and weights.

- **Pipeline:** independently ran `product_suburban verify` successfully. It verified audited inputs, derived presentation, payload hashes and budgets: **2,577,364 raw / 413,592 gzip bytes**. The color table has 134 cited rows and a pinned checksum.

- **Map:** primitive visibility resolves geometry references, including the Fukutoshin/Yurakucho shared primitive, and filters both background layers. Highlight/progress layers remain independent. Three sources and nine layers are retained; label ordering, zoom eligibility and camera coverage have corresponding checks.

- **Tests:** the six S5 midpoint panel assertions are restored and compare browser output against the pre-landing ride and displayed-progress expectations. Legend interaction checks are restored. However, `tests/e2e/capital-region.spec.ts:152` checks multi-service member names only in fixture data; that assertion does not itself establish browser behavior.

- **Metadata hardening — `src/data/guards.ts:216`:** removing a line group still passes the TS reference validator, although the Python pipeline rejects incomplete service coverage. The shipped metadata is complete, so this is not a current product blocker; consider matching the Python coverage invariant.

- **Glyphs:** the fixture README provides pinned Noto Sans JP provenance, font hash, OFL reference and generation parameters. No remaining IPA-font provenance concern was found.

- **Worker failures:** the recorded failures cluster around readiness, glyph/render completion and overall timeouts across browsers; browser-closed messages often follow timeout teardown. Together with the serial pass, this supports resource pressure, but **does not prove a load-only cause**. I found no demonstrated application race. Browser tests were not rerun during this read-only review.

## Carry-overs for S7/S8

- Preserve the explicit release gaps: physical desktop/phone testing, actual phone touch-pan, and representative network performance remain unverified.
- On an authorized preview, verify JSON/GeoJSON content types, negotiated compression and decoded hashes. Local gzip sizes and Vite preview do not establish deployed delivery behavior.
- Keep the default four-worker failure visible. Establish a reliable software-WebGL worker configuration or investigate resource/trace evidence further; do not describe the configured default suite as passing.
- Consider code splitting separately; the large-chunk warning predates S6.
- After fixing the fallback regression, rerun its focused regression and relevant UI checks before accepting S6.
