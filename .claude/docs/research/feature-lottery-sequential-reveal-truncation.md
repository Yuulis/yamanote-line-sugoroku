# Lottery board: long candidate labels truncated during the flip (#63)

Branch `feature/lottery-sequential-reveal` at `12c8af2`. Read-only investigation;
measurements come from a throwaway Chromium/Firefox harness that renders the
board markup with the real `src/styles.css` inside the real host structure
(flex region + card). It reproduces the unit-test constant exactly: the natural
board at 320px is 127.2 x 190.6 px (`tests/unit/lottery-board-fit.test.ts:20-21`).
Harness: `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/659df460-8751-4c2b-bf3f-415b58f4f4f7/scratchpad/measure.cjs`
(plus `widths.cjs` for the real-data label widths).
Fonts in this environment are IPAexGothic / Noto fallbacks, so absolute pixel
numbers will differ by a few percent on Hiragino, Yu Gothic, or Noto CJK devices.

## Root cause

One sizing defect causes both symptoms: only the drawn result takes part in
layout, and every other candidate is an absolutely positioned overlay that
has to fit into the box the drawn result produced.

1. `LotteryReveal.tsx:92` renders the drawn value (`frames.at(-1)`) as the
   row's only in-flow child. The candidate frames (`:94-95`) and the
   placeholder (`:93`) are `position: absolute; inset: 0`
   (`styles.css:3288-3290`, `:3299-3302`), so they never contribute to the
   row's or board's intrinsic size.
2. The board shrinks to fit its content. The host region is a centring flex
   container (`styles.css:57-64`), and the card is a flex item with
   `width: auto; max-width: 100%` (`styles.css:66-69`). In the non-fit path,
   `TurnMomentHost.tsx:521` (`fitsLottery`) only sets `maxHeight` and `scale`,
   not width. While the card is shrink-wrapped, `.lottery-reveal { width:
   min(26rem, 100%) }` (`styles.css:3255-3256`) treats the cyclic percentage as
   `auto`. The board width is therefore `max(heading, drawn badge, drawn
   direction label)`, capped at 26rem (desktop) or at the region content box
   (180px at 320 wide with the 56/84 insets).
3. Each frame fills that box. A candidate wider than the drawn result is
   squeezed into it.

### Route row: pre-existing (not introduced by this branch)

- The frame badge is clipped by `.lottery-reveal .line-badge__name { overflow:
  hidden; text-overflow: ellipsis; white-space: nowrap }`
  (`styles.css:3314-3318`). It and the absolutely positioned frames are
  identical on `develop`. The ellipsis rule dates from `986d3ea`, and its
  `wbr` suppression (`:3319-3321`) from `89195e7` (#70).
- Measured (Chromium, 320 and 1280): drawn 山手線 → board 127.2px →
  frames for 京急空港線 and 湘南新宿ライン (宇都宮線・横須賀線系統 普通) show `…`.

### Direction row: pre-existing sizing, made worse by 12c8af2

- The sizing cause is the same: direction frames (`LotteryReveal.tsx:116`) are
  overlays sized by the drawn label. A wider sibling label does not get a
  literal `…`, because no ellipsis rule covers `.lottery-reveal__frame`. It
  wraps onto two lines inside the narrow row (measured in Chromium and
  Firefox: 羽田空港第1・第2ターミナル方面 behind a drawn 京急蒲田方面). The
  user perceives this as cut off.
- 12c8af2 added `.lottery-reveal__row--direction .lottery-reveal__result {
  nowrap; ellipsis }` (`styles.css:3322-3327`) to stop the result changing the
  row height. That rule now ellipsizes the drawn long direction result on
  phones (measured: 羽田空港… → `…` at 180px), while its own frame wraps. The
  same label therefore renders two different ways within one flip. This part
  is new on this branch.

### Leak finding (also pre-existing, not closed by step 2)

The board width is set by the drawn route badge and the drawn direction label,
and it is visible from t=0 (row borders, centred badge). So the board size
reveals the result before the route row stops. Measured with the same candidates
(京急空港線 / 山手線):

| drawn | phone board W | desktop board W |
|---|---|---|
| 山手線 / 外回り | 127.2 | 127.2 |
| 京急空港線 / 羽田空港…方面 | 180 | 271 |

Step 2 closed the label and motion channels. Its `nowrap` closed the height
channel, but the width channel stayed open, because max-content ignores
wrapping. The fix below closes it.

## Proposed fix

### Approach: invisible sizer copies in the result's grid cell

Every row is already `display: grid; place-items: center`
(`styles.css:3265-3269`). Render invisible copies of every label the row may
need to fit in the same cell (`grid-area: 1 / 1`) as the result. The row's
intrinsic size, and through it the shrink-to-fit board, becomes the maximum
over a set that does not depend on the drawn outcome. The frames and
placeholder stay overlays and inherit that size.

`src/features/game/components/LotteryReveal.tsx` (~15-20 LOC):

- `LotteryRow` gets a `sizers: readonly ReactNode[]` prop and renders
  `sizers.map((s, i) => <span key={i} className="lottery-reveal__sizer">{s}</span>)`
  before the result, in **both** stages. Keeping the sizers in settle means the
  board and row sizes, and with them the `ResizeObserver` fit, do not jump at
  the flip→settle hand-off. The settle measurement in `chooseSettleMotion` also
  stays stable.
- Route sizers: `unique([...landing.serviceCandidates, landing.serviceId]).map(serviceFrame)`.
  Sizing by candidates is not a leak, because the route frames show those
  candidates anyway.
- Direction sizers come from a route-independent set:
  `sizingServices = landing.serviceDrawRequired ? landing.serviceCandidates : [landing.serviceId]`,
  then `unique(sizingServices.flatMap(id => [directionLabel(network, id, 1), directionLabel(network, id, -1)]))`,
  plus `DIRECTION_PLACEHOLDER` when it is shown.
  - The set depends only on `serviceCandidates` while the route is undecided.
    It uses both labels of every candidate service, not the per-station
    boardable directions: `landing` carries directions only for the drawn
    service, and the superset is still route-independent. Its only cost is a
    possibly wider board.
  - It must be applied in **every** direction-row mode. That includes the
    `snap` case (single-direction drawn service such as 山手線 → 外回り),
    otherwise the row size would reveal that the drawn service has one
    direction.
  - When the route was not drawn, the route is already shown statically, so
    sizing by the drawn service's two labels leaks nothing.
  - Extract it as a small exported pure helper (e.g.
    `lotteryDirectionSizingLabels(landing, network)`) so it can be unit-tested.
- Results and probabilities are untouched. The change adds presentation only;
  no RNG, engine, or save data is involved.

`src/styles.css` (~6-8 LOC):

```css
.lottery-reveal__result,
.lottery-reveal__sizer { grid-area: 1 / 1; }
.lottery-reveal__sizer { visibility: hidden; max-width: 100%; min-width: 0; }
```

For the direction one-line rule (`styles.css:3322-3327`), two variants were
measured:

- **B (recommended): delete the rule and let direction labels wrap.** Height no
  longer needs `nowrap` to stay route-independent: the row height is the
  maximum over the sizer set, wrapped at the board width, and both are
  route-independent. Frames and the result wrap identically, because the frame
  content box equals the row content box. On a 320px phone only one real
  service's label (keikyu-airport 羽田空港第1・第2ターミナル方面) exceeds the
  row and wraps to 2 lines (42px). That still fits the 56px `min-height`
  content box (`styles.css:3268`, content-box sizing → 77.2px row), so the row
  height does not change. No direction text is ever ellipsized.
- A: keep one line everywhere. This means extending the rule to sizers, and
  wrapping direction frame text in an element (e.g.
  `<span className="lottery-reveal__label">`), because an ellipsis cannot apply
  to the anonymous grid item inside the `display: grid` frame. It works, but it
  needs more markup and hides the full label on phones.

Optional (+1 LOC): `.lottery-reveal { width: min(27rem, 100%) }`. The natural
route-row widths of the two longest services are 427.1px (武蔵野線直通
西船橋–市川塩浜 (京葉線高谷支線)) and 418.2px (湘南新宿ライン
(宇都宮線・横須賀線系統 普通)). Both exceed 26rem = 416px and would keep a
slight ellipsis on desktop. 27rem = 432px fits every real name with about 5px to
spare under these fonts; the margin may not hold under other device fonts.

### Measured outcome (variant B, Chromium; Firefox matches within 1-5px)

| scenario | before | after |
|---|---|---|
| desktop, drawn 山手線, candidate 京急空港線 | frame `…`, board 127.2 | full, board 271 |
| desktop, drawn 京急蒲田方面, sibling 羽田空港…方面 | frame wraps 2 lines | one line, board 271 |
| leak pair above (same candidates, different draw) | 127.2 vs 271 wide | 271 vs 271, heights equal |
| phone 320, same cases | 127.2 / 180, mixed `…` and wraps | 180 both, identical |
| fixture data (テスト南線/テスト西線, 大森/品川/東中野/新宿方面) | 159.2 x 190.6 | 159.2 x 190.6 (unchanged) |

### Longest labels and the 320px phone

- Real data, 327 stations with 2 or more services:
  - Route row: at 305 of them, at least one candidate badge row is wider than
    the 180px phone cap.
  - Direction row: only 1 station (keikyu-airport, 271px natural) exceeds the
    cap.
  - Desktop 416px cap: 38 stations exceed it for the route row (only because of
    the two names above) and none for the direction row.
- So on a phone, long route names remain ellipsized after the fix. The result
  and every frame are now cut at the same width (180px instead of the drawn
  label's width), and medium names such as 京急空港線 become fully visible.
  The ellipsized drawn result on phones is pre-existing behaviour from
  `986d3ea`.
- The existing fit scale cannot rescue width. The card's `max-width: 100%`
  clamps the board to the region, so `lotteryFitScale` never sees
  `board.width > availableWidth` and only acts on height.
- Letting the board measure its natural width (card `maxWidth: none` in the
  lottery path) and scaling to fit would need:
  - a median scale of 0.69;
  - a scale of 0.42 at the worst station;
  - a scale below the 0.5 floor (`LOTTERY_FIT_MIN_SCALE`) at 80 of 327
    stations, where the card would then overflow into the pill/controls
    clearance.

  This is not viable as the phone answer.
- Full names on phones need a separate product decision, e.g. two-line badges
  in the lottery on narrow viewports by re-enabling `wbr` with a 2-line clamp.
  The sizers keep that leak-free: about 12 characters fit in 2 lines at
  ~100px name width, against 25 for the longest name.

### Phone @layout specs

`turn-result-card.spec.ts:722` ("board that fits keeps scale 1" at 320x568) runs
on the `fixture` dataset (`test.use({ dataset: "fixture" })`, `:266`). Its names
and labels are short, so the measured board stays 159.2 x 190.6 with the
sizers, and the scale stays 1. The 480-high case still fits by height (<1),
because the height is unchanged. No expectation change is expected. The
real-data S16 placement test (`ui-pop-turn-moments.spec.ts` ~L1053, 320x720
etc.) only asserts that the card fits and avoids obstacles. The board stays
clamped by the card, so it still fits.

## Tests to add/change

1. `tests/unit/turn-moment-components.test.ts` ("S14 LotteryReveal", ~L1333):
   - The route row has one `.lottery-reveal__sizer` per unique candidate
     (names equal the candidate display names), and the direction row's sizers
     equal the union of both labels of every candidate when the route is drawn.
   - **Leak guard:** render twice with the same `serviceCandidates` but
     different `serviceId`/`direction`, including a single-direction drawn
     service (snap) versus a two-direction one. Assert that the sizer
     `textContent` lists of both rows are identical.
   - Sizers are still present in `lottery-settle`.
   - Existing assertions keep passing: they select `__result`, `__frame`, and
     `__placeholder` explicitly, and `container.textContent` only checks
     `%|確率|重み`.
2. Same file, CSS rule block (~L333): replace the `nowrap` assertion on
   `.lottery-reveal__row--direction .lottery-reveal__result` (variant B). Instead,
   assert `grid-area: 1 / 1` on result and sizer, `visibility: hidden` on
   `.lottery-reveal__sizer`, and the absence of `white-space: nowrap` for the
   direction result.
3. Pure helper unit test for the direction sizing set: candidates only while
   the route is drawn, the drawn service only otherwise, deduplicated, with the
   placeholder included when shown.
4. E2E (branch CI, desktop): in the both-drawn hub test
   (`ui-pop-turn-moments.spec.ts` ~L708), during `lottery-flip` assert that every
   `.lottery-reveal__frame .line-badge__name` and every direction frame satisfy
   `scrollWidth <= clientWidth + 1` and are a single line. Also assert that the
   board rect at flip start equals the rect at route stop. This assertion
   applies only when the hub's longest name is under the cap; otherwise apply
   the 27rem bump.
5. No change is needed to `lottery-board-fit.test.ts`: it is pure-function
   input. The "measured at 320px" comment remains a valid fixture value.

## Risks

- **Settle flight squash:** rows can now be wider than the drawn label, so
  `chooseSettleMotion`'s non-uniform `scaleX = target.width / row.width` squashes
  a short label more horizontally while it flies and fades. This is decorative
  only. The e2e landing-box assertions compare row box to HUD box and still
  hold.
- **Clamp-equality rounding:** boards will hit the 180px phone clamp more often
  on real data. `lotteryFitScale` compares `board.width <= availableWidth`, so a
  sub-LayoutUnit mismatch could yield a scale of about 0.994 instead of 1. The
  same case already exists today whenever a long name is drawn. If it shows up
  in CI, add a 0.5px epsilon.
- **Extra DOM:** up to about 12 badges and 24 labels at the largest hubs, all
  in the `aria-hidden` board and `visibility: hidden`. Accessibility and
  performance impact is negligible.
- **Font variance:** widths were measured with IPAex/Noto in headless
  Chromium. The 27rem margin (~5px) may not hold on every device font, which
  only results in a slight ellipsis on the two longest names.
- **Phone long names stay ellipsized.** This is consistent and leak-free, but
  it is not "full names"; the user may expect that. Raise it as a follow-up
  decision rather than widening this fix.
