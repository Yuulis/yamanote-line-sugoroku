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
import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from scripts.data_pipeline import config

SELECTOR_KEYS = ("line", "group", "code")
SECTION_ACTIONS = ("allow", "deny")
SECTION_DIGEST_CHARS = 8

LonLat = tuple[float, float]
BBox = tuple[float, float, float, float]
STATION_NUMBER_PATTERN = re.compile(r"^([A-Z]{2})(\d{2})$")


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


def parse_via(
    text: str, bbox: BBox = config.DEFAULT_CANDIDATE_SEARCH_BBOX
) -> tuple[LonLat, ...]:
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
        min_lon, min_lat, max_lon, max_lat = bbox
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            raise ConstraintError(f"via point outside the search area: {item!r}")
        points.append((lon, lat))
    return tuple(points)


@dataclass(frozen=True)
class RouteRecipe:
    lines: tuple[str, ...]
    joints: tuple[LonLat, ...]
    reason: str


def parse_bbox(raw: Any, where: str) -> BBox:
    if (
        not isinstance(raw, list)
        or len(raw) != 4
        or not all(
            isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)
            for v in raw
        )
    ):
        raise ConstraintError(f"{where}: bbox must have four finite numbers")
    a, b, c, d = (float(v) for v in raw)
    if not (-180 <= a < c <= 180 and -90 <= b < d <= 90):
        raise ConstraintError(f"{where}: invalid bbox bounds")
    return a, b, c, d


def parse_route_recipe(text: str, bbox: BBox) -> RouteRecipe | None:
    if not text:
        return None
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as error:
        raise ConstraintError(f"route is not valid JSON: {error}") from error
    if not isinstance(raw, dict) or set(raw) != {"lines", "joints", "reason"}:
        raise ConstraintError("route needs lines, joints and reason")
    lines = raw["lines"]
    joints = raw["joints"]
    if (
        not isinstance(lines, list)
        or len(lines) < 2
        or not all(isinstance(v, str) and v.strip() for v in lines)
    ):
        raise ConstraintError("route needs at least two non-empty ordered N02 lines")
    if not isinstance(joints, list) or len(joints) != len(lines) - 1:
        raise ConstraintError("route needs one joint per line transition")
    points: list[LonLat] = []
    for joint in joints:
        if (
            not isinstance(joint, list)
            or len(joint) != 2
            or not all(
                isinstance(v, int | float) and not isinstance(v, bool) for v in joint
            )
        ):
            raise ConstraintError("route joint must be a lon/lat pair")
        try:
            points.extend(parse_via(f"{joint[0]} {joint[1]}", bbox))
        except ConstraintError as error:
            raise ConstraintError(f"route: {error}") from error
    reason = raw["reason"]
    if not isinstance(reason, str) or not reason.strip():
        raise ConstraintError("route needs a non-empty reason")
    return RouteRecipe(tuple(lines), tuple(points), reason)


def check_station_number_order(
    numbers: Sequence[str],
    station_ids: Sequence[str],
    circular: bool,
    where: str = "service",
    expected_sequence: tuple[str, ...] | None = None,
) -> None:
    """Pin the reviewed sequence, including skips and prefix transitions.

    Without explicit evidence, apply the legacy single-prefix ±1 rule (loops
    wrap once, JY01 -> JY30). Stop order is never inferred from numbers. A
    legacy service without numbers (every cell empty) is skipped.
    """
    if expected_sequence is not None:
        if tuple(numbers) != expected_sequence:
            raise ConstraintError(
                f"{where}: station-number order broken: station-number evidence differs from stops.csv"
            )
        return
    if not any(numbers):
        return
    parsed: list[tuple[str, int]] = []
    for number in numbers:
        match = STATION_NUMBER_PATTERN.match(number)
        if match is None:
            raise ConstraintError(f"{where}: invalid station number {number!r}")
        parsed.append((match.group(1), int(match.group(2))))
    if len({prefix for prefix, _ in parsed}) != 1:
        raise ConstraintError(f"{where}: station numbers mix prefixes")
    values = [value for _, value in parsed]
    count = len(values)
    low = min(values)
    if circular and sorted(values) != list(range(low, low + count)):
        raise ConstraintError(f"{where}: loop station numbers must be consecutive")
    step = values[1] - values[0]
    if step not in (1, -1):
        step = 0  # reported below at the first pair
    pairs = count if circular else count - 1
    for index in range(pairs):
        current = values[index]
        following = values[(index + 1) % count]
        expected = current + step
        if circular:
            expected = low + (current - low + step) % count
        if step == 0 or following != expected:
            raise ConstraintError(
                f"{where}: station-number order broken after "
                f"{station_ids[index]} ({numbers[index]} -> "
                f"{numbers[(index + 1) % count]})"
            )


@dataclass(frozen=True)
class OffsetException:
    service_id: str
    station_id: str
    max_platform_offset_m: float
    reason: str


@dataclass(frozen=True)
class DetourException:
    service_id: str
    from_id: str
    to_id: str
    max_detour_ratio: float
    reason: str


def parse_offset_rows(
    rows: Sequence[Mapping[str, str]],
) -> tuple[OffsetException, ...]:
    exceptions: list[OffsetException] = []
    for index, row in enumerate(rows):
        try:
            limit = float(row["max_platform_offset_m"])
        except ValueError as error:
            raise ConstraintError(f"offset exception row {index}: {error}") from error
        if not math.isfinite(limit) or limit <= 0 or not row["reason"]:
            raise ConstraintError(
                f"offset exception row {index} needs a positive limit and a reason"
            )
        exceptions.append(
            OffsetException(
                service_id=row["service_id"],
                station_id=row["station_id"],
                max_platform_offset_m=limit,
                reason=row["reason"],
            )
        )
    return tuple(exceptions)


def parse_detour_rows(rows: Sequence[Mapping[str, str]]) -> tuple[DetourException, ...]:
    exceptions: list[DetourException] = []
    for row in rows:
        try:
            limit = float(row["max_detour_ratio"])
        except ValueError as error:
            raise ConstraintError(f"detour exception: {error}") from error
        if (
            not math.isfinite(limit)
            or limit <= config.MAX_DETOUR_RATIO
            or not row["reason"]
        ):
            raise ConstraintError(
                "detour exception needs an increased finite limit and a reason"
            )
        exceptions.append(
            DetourException(
                row["service_id"], row["from_id"], row["to_id"], limit, row["reason"]
            )
        )
    return tuple(exceptions)


@dataclass(frozen=True)
class PlatformTransfer:
    """A reviewed stop where a service departs from another platform feature."""

    service_id: str
    station_id: str
    max_transfer_m: float
    reason: str


def parse_platform_transfer_rows(
    rows: Sequence[Mapping[str, str]],
) -> tuple[PlatformTransfer, ...]:
    transfers: list[PlatformTransfer] = []
    for index, row in enumerate(rows):
        try:
            limit = float(row["max_transfer_m"])
        except ValueError as error:
            raise ConstraintError(f"platform transfer row {index}: {error}") from error
        if (
            not math.isfinite(limit)
            or not 0 < limit <= config.MAX_PLATFORM_TRANSFER_M
            or not row["reason"]
        ):
            raise ConstraintError(
                f"platform transfer row {index} needs a limit in "
                f"(0, {config.MAX_PLATFORM_TRANSFER_M}] m and a reason"
            )
        transfers.append(
            PlatformTransfer(row["service_id"], row["station_id"], limit, row["reason"])
        )
    return tuple(transfers)
