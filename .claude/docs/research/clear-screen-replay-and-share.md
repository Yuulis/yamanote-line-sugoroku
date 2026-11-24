# Clear-screen route image: export and share to X (research)

Date checked: 2026-11-22 (all URLs below fetched or searched on this date).
Scope: platform facts for exporting a PNG of the player's route from the
MapLibre map and getting it, with prefilled text, into an X post from a static
Vercel-hosted React app. Research only; no source files changed.

Repository facts (read from the tree on 2026-11-22):

- `maplibre-gl` **6.11.2** (`package.json`), React 19.3.0.
- Basemap style `https://tiles.openfreemap.org/styles/liberty`
  (`src/features/map/mapConfig.ts`, `MAP_STYLE_URL`).
- Style sources: `openmaptiles` (vector, TileJSON `https://tiles.openfreemap.org/planet`)
  and `ne2_shaded` (raster PNG, `natural_earth/ne2sr`, maxzoom 6). Sprite
  `https://tiles.openfreemap.org/sprites/ofm_f384/ofm`, glyphs
  `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`.
- The app already credits OpenFreeMap / OpenMapTiles / OpenStreetMap
  (`MAP_CREDITS`) and builds a data attribution from a manifest
  (`src/features/map/attribution.ts`), and creates the map with
  `attributionControl: false` plus its own `AttributionControl`.
- No existing `getCanvas().toBlob` / `toDataURL` / `preserveDrawingBuffer` use.

Legend: **VERIFIED** = confirmed from an official doc, spec, browser source code,
MDN browser-compat-data (BCD) 8.1.10 (timestamp 2026-11-19), or a live HTTP
check. **UNVERIFIED** = only third-party reports, old reports, or inference.

---

## 1. X web intent

**URL.** The official doc (docs.x.com, checked 2026-11-22) lists
`https://x.com/intent/tweet` as "the Web Intent URL". VERIFIED.
`https://x.com/intent/post` is also served: a live `curl` shows both
`/intent/post?text=hi` and `/intent/tweet?text=hi` answer `307` to the login
flow with the full path and query preserved in `redirect_after_login`, and
`https://twitter.com/intent/tweet` answers `301` to `https://x.com/intent/tweet`.
VERIFIED (HTTP behaviour, logged-out). Recommendation: use the documented
`https://x.com/intent/tweet`.

**Parameters (VERIFIED, official doc):** `text` (UTF-8, URL-encoded, shown
pre-selected and editable), `url` (fully-qualified http/https, shortened by
t.co), `hashtags` (comma-separated, no `#`), `via` (appends "via @username"),
`related`, `in_reply_to`. The doc says the combined `text` + `hashtags` + `via`
+ `url` "should not exceed 280 characters"; longer text must be edited by the
user before posting. Line breaks: `%0A` in `text` (encodeURIComponent of `\n`).

**Images via intent: not possible.** The doc lists no media parameter and the
page "does not mention media or images". VERIFIED (absence in the official
parameter table). The only ways to get the PNG into the post are the OS share
sheet (Web Share with files), the clipboard (paste into the composer), or the
user attaching a downloaded file.

**Character counting (VERIFIED, docs.x.com "Counting Characters"):** 280
weighted. Latin/punctuation weight 1; **CJK weight 2 (max 140)**; every emoji
weight 2 including ZWJ sequences; **every detected URL counts 23** regardless
of length; hashtags count normally; attached media counts 0; text is NFC
normalised. Use `twitter-text` `parseTweet().weightedLength` for exact
counting. Practical budget for a Japanese post with one URL and one hashtag:
`2*jpChars + 23 + 1 (space) + weighted(#tag)` must be <= 280.

**Mobile behaviour: UNVERIFIED / inconsistent.** No official 2026 statement.
X developer-community threads report intent links on iOS opening the X login
page or the composer inside the in-app browser instead of the native composer
(threads 2020, 2023, 2024, late 2025). Third-party tools claim universal links /
App Links hand intent URLs to the app. Treat as: "may open the app, may open
mobile web (possibly requiring login)". Avoid link shorteners/redirects in front
of the intent URL (they break universal-link handoff, per the 2020 thread).
A 2026 open-source project replaced `navigator.share` with
`twitter://post?message=` + 1.5 s fallback to the web intent; custom-scheme
behaviour is undocumented by X. UNVERIFIED.

Sources:
- https://docs.x.com/x-for-websites/post-button/guides/web-intent
- https://docs.x.com/fundamentals/counting-characters
- https://devcommunity.x.com/t/intent-tweet-not-opening-in-app-on-ios/137801
- https://devcommunity.x.com/t/bug-intent-urls-x-com-intent-post-open-login-page-inside-x-app-instead-of-post-composer/250749
- https://github.com/navarrillo/shipkudos.com/pull/25

## 2. Web Share API Level 2 (files)

**Support matrix (BCD 8.1.10, `api.Navigator.share` / `canShare` /
`share.data_files_parameter`). VERIFIED:**

| Platform | `navigator.share` | Files (`canShare({files})`) | Notes |
|---|---|---|---|
| iOS Safari (and all iOS browsers, WebKit) | 12.2+ | 14+ | Share sheet includes X if installed. |
| Android Chrome | 61+ | 76+ (canShare 75+) | Android intent `ACTION_SEND(_MULTIPLE)`. |
| Samsung Internet | 8.0+ | 11.0+ | |
| **Android WebView** (in-app browsers built on it) | **No** | **No** | `webview_android: false`. |
| Desktop Chrome Windows / ChromeOS | 89+ | 89+ | |
| Desktop Chrome macOS | 128+ | 128+ | Shipped Aug 2024. |
| Desktop Chrome **Linux** | No (UNVERIFIED whether absent or rejects) | No | wpt interop #1083. |
| Desktop Edge Windows | 81+ (all OS 93+) | 81+ | |
| Desktop Safari (macOS) | 12.1+ | 14+ | |
| Firefox desktop | behind `dom.webshare.enabled` (default off in Release) | **No** | Nightly-on-Windows only. |
| Firefox Android | 79+ | **No** (`data_files_parameter: false`) | Text/URL only. |

PNG is on Chromium's permitted list (`.png` / `image/png` in
`chrome/browser/webshare/share_service_impl.cc`). VERIFIED.

**User activation (VERIFIED, W3C spec):** `share()` step 6 rejects with
`NotAllowedError` without transient activation; step 7 **consumes** it, so one
gesture = one `share()`. `canShare()` needs no activation. Unsupported files
make validation fail -> `canShare` returns `false` and `share()` rejects with
`TypeError`.

**Async work before `share()`:** WebKit historically required the call to be
*inside* the gesture handler rather than within a time window (WebKit bug
197779), and WebKit bug 225559 documents `NotAllowedError` after awaiting
fetch/processing before `share()`. Current fix status of both bugs is
UNVERIFIED. Measured transient-activation windows (2025 test, third-party):
0.5 s delay OK everywhere, 1 s fails on macOS and iOS Safari, Chrome/Firefox
~5 s. Consequence: **generate the PNG `File` before the click** (e.g. when the
clear screen mounts) and call `navigator.share` synchronously as the first
async API in the click handler.

**Text kept when files are shared to X?** UNVERIFIED for the 2026 X apps.
- The spec lets UAs "discard or combine members"; on Android there is no URL
  field, so Chrome merges `url` into the text. VERIFIED (spec note).
- 2023 test (Raymond Camden): "Twitter on mobile ... got the text and selected
  image"; Facebook/LinkedIn kept only the image. Pre-rebrand, UNVERIFIED now.
- w3c/web-share#279 (2023-2024): apps vary; Messenger/Instagram/Facebook drop
  text/URL and keep only the image.
- 2026 reports: on iOS, mixing `files` with `text`/`url` makes some targets
  take the link instead of the image; one project saw the X app drop the
  separate `url` field and moved the link into `text`.
- Mitigation: put the URL **inside `text`** (do not use `url`), omit `title`,
  and additionally copy the post text to the clipboard (`writeText`) in the
  same gesture before `share()` so the user can paste it if X drops it.

Sources:
- https://unpkg.com/@mdn/browser-compat-data/data.json (BCD 8.1.10)
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
- https://w3c.github.io/web-share/
- https://web.dev/articles/web-share
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/webshare/share_service_impl.cc
- https://github.com/mdn/browser-compat-data/issues/24632 (Chrome 128 macOS)
- https://github.com/web-platform-tests/interop/issues/1083 (Linux, Firefox)
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features
- https://bugs.webkit.org/show_bug.cgi?id=197779
- https://bugs.webkit.org/show_bug.cgi?id=225559
- https://dontpaniclabs.com/blog/post/2025/07/29/understanding-window-open-behavior-on-ios-safari/
- https://www.raymondcamden.com/2023/04/20/testing-the-web-share-api
- https://github.com/w3c/web-share/issues/279
- https://dev.to/shibowen336/sharing-a-canvas-generated-image-on-ios-with-the-web-share-api-2j0m

## 3. Async Clipboard API for images

**Support (BCD 8.1.10). VERIFIED:**

| Browser | `ClipboardItem` | Promise-valued item | `ClipboardItem.supports()` | `clipboard.write` gesture rule |
|---|---|---|---|---|
| Chrome / Edge desktop | 76 / 79 | 98+ (Blob or Promise<Blob>), strings/Promise<string> 133+ | 121+ | From 107: user gesture or `clipboard-write` permission; **one** ClipboardItem only |
| Chrome Android / WebView | 84 | 98+ | 121+ | same |
| Safari macOS / iOS | 13.1 / 13.4 | yes (WebKit maps type -> Promise by design) | 18.4+ | must be within a user gesture |
| Firefox desktop / Android | **127+** | yes (full support, no partial note) | 127+ | must be within a user gesture; one item only |

WebKit supports `image/png` as the only image type for write; it decodes and
re-encodes the PNG and rejects if undecodable. VERIFIED (WebKit blog 10855).

**Safari async pitfall (VERIFIED by WebKit bug 222262 + WebKit blog):** any
`await` between the click and `clipboard.write` rejects with `NotAllowedError`
(or on iOS can show a paste-permission style prompt). Fix: call
`navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })])`
synchronously in the handler, passing a Promise if the blob is not ready yet.
With a pre-generated Blob, pass `Promise.resolve(blob)` or the Blob directly.

**Chromium focus rule (VERIFIED in source):** in current
`clipboard_promise.cc`, `ClipboardPromise::HandleWrite` -> `ValidatePreconditions`
runs synchronously from `clipboard.write()` and calls
`RejectIfDocumentNotFocused()` ("Document is not focused") at that moment; the
later `HandleWriteWithPermission` / promise-resolution path has no focus check.
A 2026 project test agrees: focus lost 300 ms after `write()` with the blob
ready at 1.5 s still succeeded. Therefore **in Chrome, call `clipboard.write()`
first and `window.open()` second in the same handler**; the reverse order (or
`window.open` before an `await`ed write) fails because the new tab has taken
focus. `clipboard.write` does not consume activation in Chromium; `window.open`
does (MDN), so the write-then-open order also keeps the popup allowed.
Safari/Firefox behaviour on focus loss after a started write: UNVERIFIED (no
source found); the same order is the safe choice.

**Paste into the X composer:** pasting an image from the clipboard into the
x.com web composer (Ctrl/Cmd+V) is widely used but not documented by X.
UNVERIFIED. Pasting into the iOS/Android X app composer: UNVERIFIED.

Sources:
- https://unpkg.com/@mdn/browser-compat-data/data.json (BCD 8.1.10)
- https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
- https://webkit.org/blog/10855/async-clipboard-api/
- https://bugs.webkit.org/show_bug.cgi?id=222262
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/clipboard/clipboard_promise.cc
- https://github.com/Ezveus/cartodex/pull/228
- https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation
- https://www.sitepoint.com/fix-navigator-clipboard-writetext-transient-activation-async-javascript/

## 4. Download fallback (`<a download>` + blob URL)

- BCD: `a[download]` Safari 10.1+, **iOS Safari 13+**, Chrome Android 18+
  (cross-origin downloads unsupported since 65 - irrelevant for same-origin
  `blob:` URLs), Firefox Android 20+ (the filename is honoured only for
  `blob:`/`data:` URLs). VERIFIED.
- iOS Safari: downloads go through Safari's download manager into Files >
  Downloads, **not Photos**; to post to X the user must then attach from Files.
  The exact 2026 prompt UI is UNVERIFIED. Revoking the object URL immediately
  after `click()` has broken iOS downloads in the past (Scratch/PenguinMod code
  delays revocation by 1 s; blob URLs regressed in iOS 17.4.1, fixed in 17.5).
  Keep the URL alive for a few seconds (or until unmount).
- An `<img src={blobUrl}>` preview lets iOS users long-press "Save to Photos"
  / "Share". Works with blob URLs in practice; UNVERIFIED as a documented
  guarantee.
- Android Chrome: blob download saves to Downloads; fine. VERIFIED by BCD only
  for attribute support; UX details UNVERIFIED.

Sources:
- https://unpkg.com/@mdn/browser-compat-data/data.json (`html.elements.a.download`)
- https://developer.apple.com/forums/thread/751063
- https://huggingface.co/spaces/soiz1/penguinmod-test/blob/main/src/lib/download-blob.js
- https://github.com/eligrey/FileSaver.js/issues/12

## 5. MapLibre GL JS 6.11.2 canvas export

**Options (VERIFIED from `node_modules/maplibre-gl/dist/maplibre-gl.d.ts`):**
- `canvasContextAttributes?: WebGLContextAttributes & { contextType?: 'webgl2' }`.
  Default `antialias: false, powerPreference: 'high-performance',
  preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
  desynchronized: false, contextType: 'webgl2'`. There is **no top-level
  `preserveDrawingBuffer` option** in 6.x; it lives inside
  `canvasContextAttributes`. WebGL2 only.
- `pixelRatio?: number` - canvas `width = container.clientWidth * pixelRatio`;
  defaults to `devicePixelRatio`. `setPixelRatio()` / `getPixelRatio()` exist.
- `maxCanvasSize?: [number, number]` default `[4096, 4096]`; a larger canvas
  lowers the pixel ratio and logs a warning.
- `redraw()` forces a synchronous `_render(0)` (dist source: aborts the pending
  frame and renders now). `triggerRepaint()` schedules one frame.
- `interactive`, `attributionControl: false`, `fadeDuration`, `transformRequest`
  are available.

**Capturing without `preserveDrawingBuffer`:** the HTML spec's `toBlob()`
takes "a copy of this canvas element's bitmap" synchronously, then encodes in
parallel (VERIFIED, WHATWG HTML). The WebGL drawing buffer is valid until the
frame is composited, so calling `toBlob()` / `drawImage(map.getCanvas())`
**synchronously inside a `render` handler, or immediately after
`map.redraw()`** captures the frame. Calling it later (e.g. from `idle` without
a re-render, or after an `await`) can yield a blank image (MapLibre discussion
#3900, Chrome). The robust pattern: `map.once('idle', () => { map.redraw();
ctx2d.drawImage(map.getCanvas(), 0, 0); })` then composite text on the 2D
canvas and `toBlob` the 2D canvas. For a dedicated hidden export map, simply
setting `canvasContextAttributes: { preserveDrawingBuffer: true }` on that map
only is what maplibre-gl-export does (no cost to the visible map).

**Offscreen fixed-size map:**
- The container must have layout (not `display: none`; width/height would be
  0). Use e.g. `position: fixed; left: -10000px; top: 0; width: 800px;
  height: 450px` or `visibility: hidden` with explicit size, `aria-hidden`.
- Output size = CSS size x `pixelRatio`. Labels/line widths are in CSS px, so
  **800x450 @ pixelRatio 2 -> 1600x900** keeps labels legible when X downsizes
  to ~504 px wide on desktop; 1600x900 @ 1 makes labels tiny. Set `pixelRatio`
  explicitly (do not inherit a phone's DPR 3, which would give 2400x1350).
- Use `interactive: false`, `attributionControl: false` (draw credits
  yourself), `fadeDuration: 0` (no symbol fade at capture), `fitBounds(route,
  { padding, animate: false })`, wait for `idle`, capture, then `map.remove()`
  to free the WebGL context (mobile browsers cap live contexts; iOS limit
  UNVERIFIED in number).
- Alternative that avoids a second WebGL context and second tile load: capture
  the visible map after a non-animated `fitBounds` + `redraw()`. Its size then
  follows the viewport, so a fixed 16:9 output needs cropping/letterboxing on a
  2D canvas. Trade-off for the implementer.

**CORS / tainting (VERIFIED by live HTTP check 2026-11-22):** all OpenFreeMap
assets used by the Liberty style return `access-control-allow-origin: *`:
style JSON, TileJSON `planet`, sprite PNG, glyph PBF, `ne2sr` raster PNG.
WebGL refuses non-CORS cross-origin images at upload (they never render rather
than tainting), so a MapLibre WebGL canvas is not origin-dirty; `toBlob` will
not throw `SecurityError`. Tainting risk is only in the 2D compositing step:
draw only same-origin or CORS-enabled images there (app assets on Vercel are
same-origin). The app's own railway GeoJSON is same-origin.

**Attribution in the exported image:**
- OpenFreeMap's requested credit (quick start, VERIFIED): "OpenFreeMap ©
  OpenMapTiles Data from OpenStreetMap". The TileJSON `attribution` matches:
  `OpenFreeMap`, `© OpenMapTiles`, `Data from OpenStreetMap` (links). VERIFIED.
- OSMF Attribution Guidelines (VERIFIED): static images "must be generally
  attributed the same way as interactive maps" - in a corner or adjacent;
  must name OpenStreetMap and indicate ODbL; "© OpenStreetMap contributors"
  is acceptable; text must be legible (font, size, contrast). Where links are
  impossible (print etc.) print `openstreetmap.org/copyright`. Exemptions
  (< 100 features, < 10,000 m², tiny thumbnails) do not apply to a Tokyo map.
- OpenMapTiles (vector schema/style lineage) credit "© OpenMapTiles" is part of
  OpenFreeMap's string; the OpenMapTiles licence terms themselves were not
  re-fetched. UNVERIFIED beyond OpenFreeMap's instruction.
- The app's railway data attribution (from the manifest, see
  `buildDataAttribution`) must also be reproduced; its licence text is
  project-specific and was not re-checked here.
- Recommended burned-in line (bottom corner, >= ~12 CSS px at the 800x450
  layout, high contrast plate):
  `© OpenStreetMap contributors (openstreetmap.org/copyright) · © OpenMapTiles · OpenFreeMap · <railway data credit>`.

Sources:
- `node_modules/maplibre-gl/dist/maplibre-gl.d.ts` (6.11.2, local)
- https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/
- https://github.com/maplibre/maplibre-gl-js/discussions/3900
- https://github.com/watergis/maplibre-gl-export/pull/710
- https://html.spec.whatwg.org/multipage/canvas.html (toBlob steps)
- https://openfreemap.org/quick_start/
- https://tiles.openfreemap.org/planet (TileJSON attribution)
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines

## 6. Image size for X timeline (2026)

X publishes **no official organic post image size**. UNVERIFIED (consensus of
third-party guides updated Aug-Nov 2026):
- Single image: **16:9** displays uncropped in the timeline;
  **1200x675** or **1600x900** most cited; <= 5 MB (mobile) commonly quoted.
- Desktop timeline renders images at max ~504 px wide; mobile full width.
- Images outside roughly 2:1 .. 3:4 are cropped in the feed (saliency or centre
  crop, sources disagree); keep the key content in the centre.
- PNG of a vector map at 1600x900 is typically well under 5 MB; verify size at
  implementation time.

Sources:
- https://postfa.st/sizes/x/posts
- https://recurpost.com/schedule-tweets/twitter-post-dimensions/
- https://socialroute.net/resources/image-sizes/x
- https://fixphotolab.com/blog/twitter-image-sizes/

---

## Recommendations for implementation

1. **Pre-generate the PNG before any share click.** When the clear screen
   mounts, render the route image (hidden 800x450 map at `pixelRatio: 2`,
   `fadeDuration: 0`, `interactive: false`, `attributionControl: false`,
   `canvasContextAttributes: { preserveDrawingBuffer: true }` on that map only;
   `fitBounds` without animation; on `idle` -> `redraw()` -> `drawImage` onto
   a 1600x900 2D canvas; composite title, stats and the attribution line; then
   `toBlob('image/png')`; `map.remove()`). Keep `Blob`, `File` and object URL in
   state. Disable the share buttons until ready (show progress).
2. **Burn attribution into the image**: OSM ("© OpenStreetMap contributors",
   with `openstreetmap.org/copyright` printed), "© OpenMapTiles",
   "OpenFreeMap", plus the railway data credit from the manifest, legible and in
   a corner.
3. **Post text**: one string with the URL inside it plus hashtags; count with
   weighted rules (CJK 2, URL 23) and keep <= 280, ideally <= ~250 for user
   edits. Use it for both the intent `text` and Web Share `text`.
4. **Per-platform flow** (decide by capability, not UA, but gate the file-share
   path to touch devices because desktop share sheets rarely reach X):
   - **iOS Safari / Android Chrome / Samsung Internet** (`canShare({files})`
     true and `(pointer: coarse)`): one "Share" button. In the click handler,
     synchronously: `navigator.clipboard.writeText(text).catch(noop)` (safety net
     if X drops text), then `navigator.share({ files: [file], text })` (no
     `url`, no `title`). On `AbortError` do nothing; on `NotAllowedError` /
     `TypeError` fall back to the intent + download path below.
   - **Desktop Chrome / Edge / Safari / Firefox >= 127** (ClipboardItem with
     `image/png`): "Copy image and open X" button. In the click handler,
     synchronously: `navigator.clipboard.write([new ClipboardItem({ 'image/png':
     blob })])` **first**, then `window.open(intentUrl, '_blank', 'noopener')`
     **second** (same tick, no `await` in between). Show a hint "画像をコピーしました。
     投稿画面で貼り付け (Ctrl/Cmd+V) してください". If `write` rejects, show
     the download button and keep the intent link.
   - **Fallback (Linux desktop share, Firefox Android, Android WebView in-app
     browsers, old browsers)**: separate "Save image" (`<a download>` with the
     blob URL; revoke later, not immediately) and "Post on X" (`<a
     href={intentUrl} target="_blank" rel="noopener">`) controls, plus an
     `<img>` preview for long-press save on iOS.
   - Always keep a plain text-only intent link available so posting works even
     when the image path fails.
5. **Intent URL**: `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
   (put URL and hashtags in `text`, or use `url`/`hashtags` params; do not
   double-count). Prefer an `<a target="_blank">` over `window.open` where no
   clipboard step precedes it, so mobile universal-link handoff has the best
   chance; do not wrap it in a shortener.
6. **Tests to plan**: unit-test the weighted-length helper and capability
   router with mocked `navigator.share`/`canShare`/`clipboard`/`ClipboardItem`;
   E2E only asserts that a PNG blob of the expected size is produced (WebGL
   capture in CI is flaky per existing Firefox/WebKit notes) and that buttons
   appear per capability. Real X app behaviour (text kept with files, intent
   opening the app) needs manual device checks - mark it in the release
   checklist because it is UNVERIFIED.
