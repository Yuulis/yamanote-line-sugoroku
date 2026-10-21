"""Generate the provisional brand assets into public/.

The mark (loop ring + die) is hand-written geometry below. The wordmark is
Zen Maru Gothic (SIL OFL 1.1) shaped with HarfBuzz and converted to outlines,
so no webfont is loaded at runtime. Raster files are rendered with resvg and
the ICO is packed with Pillow. See brand/README.md for the pinned font and the
exact command.
"""

from __future__ import annotations

import argparse
import io
import json
from dataclasses import dataclass
from pathlib import Path

import resvg_py
import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

# Vermilion is the brand primary. Green is deliberately not used: a green ring
# would read as the Yamanote line colour / a station-numbering roundel.
VERMILION = "#d9502f"
INK = "#263238"
INK_ON_DARK = "#eceae3"
PIP = "#fffdf6"
CREAM = "#faf7ef"
MUTED = "#5f6b70"

TITLE = "山手線すごろく"
SUBTITLE = "東京近郊版"
HOOK = "サイコロと抽選まかせで、山手線を一周して新橋へ。"
SITE_HOST = "yamanote-line-sugoroku.vercel.app"

TITLE_FONT = "ZenMaruGothic-Bold.ttf"
SUBTITLE_FONT = "ZenMaruGothic-Bold.ttf"
BODY_FONT = "ZenMaruGothic-Medium.ttf"

MARK_UNITS = 64
# Loop + die, in a 64x64 box: one continuous ink ring (the loop, offset to the
# upper left) with a tilted vermilion die showing the 3 face sitting on it at
# the lower right. The ring is cut by a gap around the die, so the die reads
# as a token travelling the loop. The asymmetric layout and the absence of
# any letter keep it clear of line-colour roundels and station-number badges.
MARK_BODY = (
    '<mask id="loop-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
    '<rect width="64" height="64" fill="#fff"/>'
    '<rect transform="translate(42 42) rotate(-15)" x="-20" y="-20" width="40" '
    'height="40" rx="11" fill="#000"/>'
    "</mask>"
    f'<circle class="mark-ring" cx="26" cy="26" r="20" fill="none" stroke="{INK}" '
    'stroke-width="8" mask="url(#loop-cut)"/>'
    '<g transform="translate(42 42) rotate(-15)">'
    f'<rect x="-17" y="-17" width="34" height="34" rx="8" fill="{VERMILION}"/>'
    f'<g fill="{PIP}">'
    '<circle cx="-8.6" cy="-8.6" r="4.5"/>'
    '<circle cx="0" cy="0" r="4.5"/>'
    '<circle cx="8.6" cy="8.6" r="4.5"/>'
    "</g></g>"
)
# Only the standalone favicon follows the browser's colour scheme: the ink ring
# would vanish on a dark tab strip.
FAVICON_STYLE = (
    "<style>@media (prefers-color-scheme: dark)"
    f"{{.mark-ring{{stroke:{INK_ON_DARK}}}}}</style>"
)

LOGO_SIZE = (1200, 300)
OGP_SIZE = (1200, 630)
ICO_SIZES = (16, 32, 48)
APPLE_TOUCH_SIZE = 180
APPLE_TOUCH_MARK = 140  # ~20 px margin on each side
ICON_SIZES = (192, 512)
ICON_MARK_RATIO = 0.8
MASKABLE_SIZE = 512
MASKABLE_MARK = (
    360  # farthest mark point ~196 px from centre, inside the 409 px safe circle
)


@dataclass(frozen=True)
class TextRun:
    """An outlined line of text: SVG path data plus its ink bounds."""

    path: str
    x_min: float
    y_min: float
    x_max: float
    y_max: float

    @property
    def width(self) -> float:
        return self.x_max - self.x_min

    @property
    def height(self) -> float:
        return self.y_max - self.y_min


def fmt(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def outline_text(font_path: Path, text: str, size: float) -> TextRun:
    """Shape `text` and return its outlines with the pen starting at x=0 and
    the baseline at y=0 (SVG y-down)."""
    blob = hb.Blob.from_file_path(str(font_path))
    hb_font = hb.Font(hb.Face(blob))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, {"kern": True})

    tt = TTFont(str(font_path))
    glyph_set = tt.getGlyphSet()
    glyph_order = tt.getGlyphOrder()
    scale = size / tt["head"].unitsPerEm

    svg_pen = SVGPathPen(glyph_set, ntos=fmt)
    bounds_pen = BoundsPen(glyph_set)
    pen_x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True):
        name = glyph_order[info.codepoint]
        x = (pen_x + pos.x_offset) * scale
        y = -pos.y_offset * scale
        transform = (scale, 0, 0, -scale, x, y)
        glyph_set[name].draw(TransformPen(svg_pen, transform))
        glyph_set[name].draw(TransformPen(bounds_pen, transform))
        pen_x += pos.x_advance

    if bounds_pen.bounds is None:
        raise ValueError(f"no outlines for {text!r}")
    x_min, y_min, x_max, y_max = bounds_pen.bounds
    return TextRun(svg_pen.getCommands(), x_min, y_min, x_max, y_max)


def text_element(run: TextRun, x: float, y: float, fill: str) -> str:
    """Place a run so its ink box starts at (x, y)."""
    dx, dy = x - run.x_min, y - run.y_min
    return (
        f'<path transform="translate({fmt(dx)} {fmt(dy)})" fill="{fill}" '
        f'd="{run.path}"/>'
    )


def mark_element(x: float, y: float, size: float) -> str:
    scale = size / MARK_UNITS
    return f'<g transform="translate({fmt(x)} {fmt(y)}) scale({fmt(scale)})">{MARK_BODY}</g>'


def svg_document(width: int, height: int, body: str, background: str | None) -> str:
    fill = (
        f'<rect width="{width}" height="{height}" fill="{background}"/>'
        if background
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{fill}{body}</svg>\n'
    )


@dataclass(frozen=True)
class Lockup:
    """Horizontal mark + wordmark, laid out in its own coordinate box."""

    body: str
    width: float
    height: float


def build_lockup(font_dir: Path) -> Lockup:
    mark_size = 200.0
    gap_mark_text = 40.0
    gap_lines = 26.0
    title = outline_text(font_dir / TITLE_FONT, TITLE, 132)
    subtitle = outline_text(font_dir / SUBTITLE_FONT, SUBTITLE, 58)

    text_height = title.height + gap_lines + subtitle.height
    text_top = (mark_size - text_height) / 2
    text_x = mark_size + gap_mark_text
    body = (
        mark_element(0, 0, mark_size)
        + text_element(title, text_x, text_top, INK)
        + text_element(subtitle, text_x, text_top + title.height + gap_lines, VERMILION)
    )
    width = text_x + max(title.width, subtitle.width)
    return Lockup(body, width, mark_size)


def place_lockup(
    lockup: Lockup, cx: float, cy: float, max_w: float, max_h: float
) -> str:
    scale = min(max_w / lockup.width, max_h / lockup.height)
    x = cx - lockup.width * scale / 2
    y = cy - lockup.height * scale / 2
    return (
        f'<g transform="translate({fmt(x)} {fmt(y)}) scale({fmt(scale)})">'
        f"{lockup.body}</g>"
    )


def build_logo_svg(lockup: Lockup) -> str:
    width, height = LOGO_SIZE
    body = place_lockup(lockup, width / 2, height / 2, width - 80, height - 60)
    return svg_document(width, height, body, None)


def build_ogp_svg(lockup: Lockup, font_dir: Path) -> str:
    width, height = OGP_SIZE
    hook = outline_text(font_dir / BODY_FONT, HOOK, 40)
    host = outline_text(font_dir / BODY_FONT, SITE_HOST, 28)
    body = (
        place_lockup(lockup, width / 2, 250, 940, 230)
        + text_element(hook, (width - hook.width) / 2, 418, INK)
        + text_element(host, (width - host.width) / 2, 512, MUTED)
    )
    return svg_document(width, height, body, CREAM)


def square_icon_svg(size: int, mark_size: float, background: str | None) -> str:
    offset = (size - mark_size) / 2
    return svg_document(size, size, mark_element(offset, offset, mark_size), background)


def render_png(svg: str, width: int, height: int) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def save_png(image: Image.Image, path: Path, opaque: bool) -> None:
    out = image.convert("RGB") if opaque else image
    out.save(path, format="PNG", optimize=True)


def build_manifest() -> str:
    manifest = {
        "name": f"{TITLE} — {SUBTITLE}",
        "short_name": TITLE,
        "description": "サイコロと抽選で東京近郊の路線を乗り継ぎ、山手線を一周して新橋を目指すすごろく。",
        "lang": "ja",
        "start_url": "/",
        "scope": "/",
        "display": "browser",
        "theme_color": VERMILION,
        "background_color": CREAM,
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {
                "src": "/icon-maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"


def build_all(font_dir: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    favicon_svg = svg_document(MARK_UNITS, MARK_UNITS, FAVICON_STYLE + MARK_BODY, None)
    (out_dir / "favicon.svg").write_text(favicon_svg, encoding="utf-8")

    ico_images = [render_png(favicon_svg, s, s) for s in ICO_SIZES]
    ico_images[-1].save(
        out_dir / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_images[:-1],
    )

    apple = square_icon_svg(APPLE_TOUCH_SIZE, APPLE_TOUCH_MARK, CREAM)
    apple_png = render_png(apple, APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE)
    save_png(apple_png, out_dir / "apple-touch-icon.png", opaque=True)
    for size in ICON_SIZES:
        icon = square_icon_svg(size, size * ICON_MARK_RATIO, CREAM)
        save_png(
            render_png(icon, size, size), out_dir / f"icon-{size}.png", opaque=True
        )
    maskable = square_icon_svg(MASKABLE_SIZE, MASKABLE_MARK, CREAM)
    maskable_png = render_png(maskable, MASKABLE_SIZE, MASKABLE_SIZE)
    save_png(maskable_png, out_dir / "icon-maskable-512.png", opaque=True)

    lockup = build_lockup(font_dir)
    logo_svg = build_logo_svg(lockup)
    (out_dir / "logo.svg").write_text(logo_svg, encoding="utf-8")
    save_png(render_png(logo_svg, *LOGO_SIZE), out_dir / "logo.png", opaque=False)

    ogp_svg = build_ogp_svg(lockup, font_dir)
    save_png(render_png(ogp_svg, *OGP_SIZE), out_dir / "ogp.png", opaque=True)

    (out_dir / "site.webmanifest").write_text(build_manifest(), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--font-dir",
        type=Path,
        required=True,
        help="directory containing the pinned ZenMaruGothic-*.ttf files",
    )
    parser.add_argument("--out-dir", type=Path, default=Path("public"))
    args = parser.parse_args()
    build_all(args.font_dir, args.out_dir)


if __name__ == "__main__":
    main()
