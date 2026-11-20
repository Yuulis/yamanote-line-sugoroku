# Issue #95: Lottery Landing Root Cause

## Finding

The lottery row can begin its CSS settle animation before `LotteryRow` measures the source rectangle in `useLayoutEffect`. Under WebKit scheduling contention, the source row is sometimes already partway through its flight when `getBoundingClientRect()` runs. The measurement then treats that moved position as the origin, producing a translation that is too short. The HUD target remains stationary, so the final row undershoots it.

This is an inference from the diagnostic measurements: the reports do not directly timestamp the `useLayoutEffect` read. The measured command shortfall matches the final landing error, while target rectangles, scale, and layout inputs remain stable.

## Evidence

The standard-library analyzer is [analyze_diag95.py](../../logs/issue102/analyze_diag95.py). Run it with:

```bash
python3 .claude/logs/issue102/analyze_diag95.py \
  .claude/logs/issue102/diag95-run1 \
  .claude/logs/issue102/diag95-run2
```

It reads the unzipped run 1 attachments and the embedded JSON attachments in each run 2 Playwright HTML report. It found 90 diagnostic sample sets: 30 WebKit from run 1, 30 WebKit from run 2, and 30 Chromium from run 2.

- Run 1 WebKit passed 30/30; final row-centre error was 0.029 px in the recorded sets.
- Run 2 WebKit passed 25/30 diagnostic cases and failed 5/30. The five failing maximum row errors were 2.408, 2.684, 4.436, 4.436, and 4.615 px. The full run also had 10/30 failures in the original E2E, for 15/60 WebKit failures across both tests.
- Run 2 Chromium passed 30/30 diagnostic cases with 0 px final error.
- In the five failing WebKit cases, card scale was 0.749403 and the sampled board-to-offset-width ratio was 0.750287. Both stayed constant through the 24 sampled frames. The recorded scale source rectangles and available-size inputs also stayed constant in all 90 cases.
- `hudTargetRect` stayed unchanged from the first recorded sample to the final sample in all 90 cases. No pill-layout, font, or visual-viewport event occurred near the landing window. Card `ResizeObserver` callbacks were estimated at +68, +70, +117, +119, and +158 ms from landing start in the five failures. Similar callbacks also appeared in passing cases, so the callback alone is not causal evidence.
- A passing WebKit row 0 commanded about 190.670 viewport px (`--lottery-y × cardScale`) for an inferred required delta of 190.699 px, leaving 0.029 px residual. In failing WebKit cases the command was only 186.084–188.291 px for the same 190.699 px required delta; the 2.408–4.615 px shortfall matches the endpoint error. Row 1 shows the same pattern: 158.722–160.604 px commanded for about 162.662–162.663 px required, leaving 2.058–3.941 px residual.

The stable target and scale rule out HUD drift and scale/input changes during the sampled landing. The variable is the source translation measured by the row effect. Its shortfall directly predicts the final error, which is consistent with the animation having advanced before the source measurement under WebKit contention.

## Fix

`LotteryRow` now withholds `data-motion` until its layout effect has measured the source and target. The CSS settle animation only applies to rows with `data-motion`, so its first frame cannot move the source before measurement. The measured state is also invalidated when the board scale or target ref changes; the effect then measures again with the animation removed and starts the updated flight.

The motion duration, target calculation, scale compensation, HUD values, and E2E tolerance are unchanged. Chromium and Firefox retain the same animation behavior after the measurement completes.

The focused jsdom test verifies that neither row has `data-motion` while its source rectangle is read, and that each receives the expected flight translation afterward. A CSS contract test verifies the animation is gated by that measured-motion attribute.

## Validation and CI Confirmation

- `npm run typecheck`: passed.
- `npx vitest run`: 105 files passed; 2,363 tests passed and one was skipped.
- `env -u WAYLAND_DISPLAY npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --project=phone-chromium --workers=1`: 42 passed.
- `DIAG_95=1 env -u WAYLAND_DISPLAY npx playwright test tests/e2e/diag-95.spec.ts --project=desktop-chromium --repeat-each=3 --workers=1`: 3 passed; each run recorded 0 px row-centre error.
- Local WebKit was not run after the fix. The next CI diagnostic run should show 0/60 WebKit failures across the original test and the diagnostic spec. The retained diagnostic attachments should show commanded viewport deltas matching the inferred required deltas, stable targets, and final row-centre errors within the existing 2 px tolerance.
