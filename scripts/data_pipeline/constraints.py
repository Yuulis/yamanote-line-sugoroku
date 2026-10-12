"""Reviewed routing constraints: platform selectors, section filters, via points.

N02 names physical lines, not services, and one N02 line can carry parallel
track pairs (中央線 rapid/local, 総武線 錦糸町–小岩, 東北線 京浜東北/宇都宮). Shortest
paths may jump between them, so routing is constrained *before* optimising:

- a platform selector narrows the N02 platforms that may represent a stop;
- a section filter (allow/deny lists keyed by :func:`section_key`) narrows the
  track sections a service may use on one N02 line;
- ordered via points force the path of one adjacent stop pair.

All of them are plain data, hashable, and part of the track-graph cache key.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Protocol

from scripts.data_pipeline import config

SELECTOR_KEYS = ("line", "group", "code")
SECTION_ACTIONS = ("allow", "deny")
SECTION_DIGEST_CHARS = 8

LonLat = tuple[float, float]


class ConstraintError(ValueError):
    """Raised when a constraint string cannot be parsed."""


class PlatformAttributes(Protocol):
    @property
    def n02_line(self) -> str: ...

    @property
    def group_code(self) -> str: ...

    @property
    def station_code(self) -> str: ...


@dataclass(frozen=True)
class PlatformSelector:
    """Accept a platform only if every given attribute matches one value."""

    lines: frozenset[str] = frozenset()
    groups: frozenset[str] = frozenset()
    codes: frozenset[str] = frozenset()

    def matches(self, platform: PlatformAttributes) -> bool:
        checks = (
            (self.lines, platform.n02_line),
            (self.groups, platform.group_code),
            (self.codes, platform.station_code),
        )
        return all(not allowed or value in allowed for allowed, value in checks)

    @property
    def pins_group(self) -> bool:
        return bool(self.groups) or bool(self.codes)


ANY_PLATFORM = PlatformSelector()


def parse_platform_selector(text: str) -> PlatformSelector:
    """``"line=中央線;group=003604|003605"``; empty text selects every platform."""
    values: dict[str, frozenset[str]] = {}
    for clause in (part.strip() for part in text.split(";")):
        if not clause:
            continue
        key, separator, raw = clause.partition("=")
        key = key.strip()
        if not separator or key not in SELECTOR_KEYS:
            raise ConstraintError(f"bad platform selector clause: {clause!r}")
        if key in values:
            raise ConstraintError(f"platform selector repeats {key!r}: {text!r}")
        options = frozenset(item.strip() for item in raw.split("|") if item.strip())
        if not options:
            raise ConstraintError(f"platform selector {key!r} has no value")
        values[key] = options
    return PlatformSelector(
        lines=values.get("line", frozenset()),
        groups=values.get("group", frozenset()),
        codes=values.get("code", frozenset()),
    )


def _format_lon_lat(point: Sequence[float]) -> str:
    decimals = config.SECTION_KEY_DECIMALS
    return f"{float(point[0]):.{decimals}f} {float(point[1]):.{decimals}f}"


def section_key(source_coords: Sequence[Sequence[float]]) -> str:
    """Stable, orientation-free id of an N02 section.

    N02 sections carry no id attribute. The key is the section's end points in
    the source CRS (start = the smaller formatted end) plus a short digest of
    every vertex, because parallel track pairs can join the same two nodes:
    ``"139.70090 35.68952~139.70135 35.69381#1a2b3c4d"``. It has no commas, so
    it fits a CSV cell unquoted.
    """
    if len(source_coords) < 2:
        raise ConstraintError("a section needs at least two coordinates")
    points = [_format_lon_lat(point) for point in source_coords]
    if points[-1] < points[0]:
        points.reverse()
    digest = hashlib.sha256("|".join(points).encode("utf-8")).hexdigest()
    return f"{points[0]}~{points[-1]}#{digest[:SECTION_DIGEST_CHARS]}"


@dataclass(frozen=True)
class SectionFilter:
    """Allow list (when non-empty: only these) and deny list of section keys."""

    allow: frozenset[str] = frozenset()
    deny: frozenset[str] = frozenset()

    def admits(self, key: str) -> bool:
        if key in self.deny:
            return False
        return not self.allow or key in self.allow

    @property
    def is_open(self) -> bool:
        return not self.allow and not self.deny


OPEN_SECTIONS = SectionFilter()


def build_section_filter(rules: Iterable[tuple[str, str]]) -> SectionFilter:
    """``rules`` = (action, section_key) pairs; a key may appear only once."""
    allow: set[str] = set()
    deny: set[str] = set()
    for action, key in rules:
        if action not in SECTION_ACTIONS:
            raise ConstraintError(f"section action must be allow or deny: {action!r}")
        if key in allow or key in deny:
            raise ConstraintError(f"section {key} is listed twice")
        (allow if action == "allow" else deny).add(key)
    return SectionFilter(allow=frozenset(allow), deny=frozenset(deny))


def parse_via(text: str) -> tuple[LonLat, ...]:
    """``"139.70000 35.60000|139.71000 35.61000"`` -> ordered lon/lat points."""
    points: list[LonLat] = []
    for item in (part.strip() for part in text.split("|")):
        if not item:
            continue
        fields = item.split()
        if len(fields) != 2:
            raise ConstraintError(f"via point must be 'lon lat': {item!r}")
        try:
            lon, lat = float(fields[0]), float(fields[1])
        except ValueError as error:
            raise ConstraintError(f"via point is not numeric: {item!r}") from error
        min_lon, min_lat, max_lon, max_lat = config.CANDIDATE_SEARCH_BBOX
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            raise ConstraintError(f"via point outside the search area: {item!r}")
        points.append((lon, lat))
    return tuple(points)
