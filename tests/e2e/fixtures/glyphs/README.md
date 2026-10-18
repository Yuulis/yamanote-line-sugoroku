# Japanese glyph fixtures

These local MapLibre glyph PBFs contain rendered SDF bitmaps for the characters
used by shipped station names, audited aliases, and service stop names. They
allow hermetic browser tests to render real Japanese labels. The font program is
not included in this repository.

The bitmaps are generated from **Noto Sans JP** under the SIL Open Font License
1.1 ([licence text at the pinned Google Fonts revision](https://raw.githubusercontent.com/google/fonts/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/notosansjp/OFL.txt)).
The official Google Fonts source is
[`ofl/notosansjp/NotoSansJP[wght].ttf`](https://raw.githubusercontent.com/google/fonts/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf)
at commit `47d54ca1ebb14fd864695f1d39dc734f39017c33`; its upstream Noto CJK
source commit recorded in `METADATA.pb` is `523d033d6cb47f4a80c58a35753646f5c3608a78`.
The font SHA-256 is
`c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`.

The SDF bitmaps are generated with `@mapbox/tiny-sdf` 2.3.0, distributed under
the [BSD 2-Clause License](https://opensource.org/license/bsd-2-clause/), using
font size 24 px, buffer 3 px, radius 8 px, and cutoff 0.25. Character coverage,
256-code-point ranges, and the `Noto Sans Regular` output directory match the
map style's glyph URL template.

To regenerate, download the pinned TTF to a scratch directory outside the
repository, then run:

```bash
GLYPH_FONT_PATH='/path/to/NotoSansJP[wght].ttf' node tests/e2e/fixtures/glyphs/generate.mjs
```

The generator removes stale range files and writes deterministic PBF output.
Provenance: These fixtures replace the earlier IPAexGothic-generated fixtures.
