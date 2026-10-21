# Brand assets (provisional)

Source and provenance for the provisional brand chosen in decision D2
(`.claude/docs/DESIGN.md`, 2026-10-21): an original "loop ring + die" mark and
the horizontal wordmark 「山手線すごろく」 / 「東京近郊版」. The mark and name may
change after the name/trademark check, so everything here is regenerated from
one script.

## What is generated

`build_brand.py` writes these files into `public/` (Vite copies them to `dist/`):

| File | Content |
|------|---------|
| `favicon.svg` | Mark only, 64×64 viewBox |
| `favicon.ico` | Mark at 16, 32 and 48 px |
| `apple-touch-icon.png` | 180×180, opaque cream background, ~20 px margin |
| `icon-192.png`, `icon-512.png` | Mark on opaque cream (manifest `any`) |
| `icon-maskable-512.png` | 512×512 opaque; the whole mark stays inside the 409 px safe circle |
| `logo.svg`, `logo.png` | Mark + outlined wordmark, 1200×300, transparent (for light backgrounds) |
| `ogp.png` | 1200×630 share image: lockup, hook line, site host, centred |
| `site.webmanifest` | Name, colours and icons; `display: browser` (no PWA claim) |

The meta/link tags that reference them live in `index.html` and are checked by
`tests/unit/launch-metadata.test.ts`.

## Design notes

- The mark is hand-written SVG geometry (`MARK_BODY` in `build_brand.py`): one
  continuous ink ring (the loop) with a tilted vermilion die showing the 3
  face sitting on it at the lower right; a gap is cut into the ring around the
  die. `favicon.svg` switches the ring to a light colour under
  `prefers-color-scheme: dark`; the raster files use the light version.
- Avoided on purpose: JR logos and letterforms, the JY station-numbering sign
  (rounded square with line letters), a line-colour ring with a letter inside
  (metro station numbering), Yamanote green as a dominant colour, a ring made
  of 30 parts (JR East's 2025 loop-centenary logo), gold rings around trains,
  station signs, train imagery, and the wording 「まるっと山手線」.
- Colours: vermilion `#d9502f` (brand primary, `theme-color`), ink `#263238`,
  cream `#faf7ef` (icon and OGP background).
- Text is converted to outlines at build time, so no webfont is loaded at
  runtime and the outlined SVG/PNG files do not embed the font.

## Font

Zen Maru Gothic (Bold for the wordmark, Medium for the OGP hook line), licensed
under the SIL Open Font License 1.1 — see `OFL.txt` next to this file. The font
files are not committed; download them from the official Google Fonts
repository, pinned to commit `92503f07b74eab956c1abf4956fbf46170716caa`:

```bash
FONT_DIR="$(mktemp -d)"
BASE=https://raw.githubusercontent.com/google/fonts/92503f07b74eab956c1abf4956fbf46170716caa/ofl/zenmarugothic
for f in OFL.txt ZenMaruGothic-Bold.ttf ZenMaruGothic-Medium.ttf; do
  curl -fsSL -o "$FONT_DIR/$f" "$BASE/$f"
done
sha256sum "$FONT_DIR"/*
```

Expected SHA-256:

| File | SHA-256 |
|------|---------|
| `OFL.txt` | `2a20cf7ce1909d8ee1e949095d340f7d7656705f7c810a2d6faf56800ad0cb3d` |
| `ZenMaruGothic-Bold.ttf` | `fe24426b9c8b5523a0146a8235c8674eccf0493af354a53ec895c3596d9eb745` |
| `ZenMaruGothic-Medium.ttf` | `3cfdb98a13571ede17fcc769f5093a97c38b80a7b9b2ab754a26b4d822092b3b` |

## Regenerate

From the repository root (throwaway environment; nothing is added to
`package.json` or `pyproject.toml`):

```bash
uv run --no-project \
  --with fonttools==4.67.0 --with uharfbuzz==0.56.3 \
  --with resvg-py==0.5.0 --with pillow==13.0.0 \
  python -I brand/build_brand.py --font-dir "$FONT_DIR"
```

Output is deterministic for the pinned font and tool versions. Pass
`--out-dir <dir>` to render somewhere other than `public/` for a preview.
After changing `ogp.png`, re-check the X and LINE previews: both cache images
by URL, so a replaced image may need a new file name or a cache refresh.
