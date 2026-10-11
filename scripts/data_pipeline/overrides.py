"""Load and validate the manual correction tables in ``data/overrides/``."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from scripts.data_pipeline import config

STATION_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
JY_NUMBER_PATTERN = re.compile(r"^JY(\d{2})$")
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class OverrideError(ValueError):
    """Raised when an override table is malformed or inconsistent."""


@dataclass(frozen=True)
class StationOverride:
    order: int
    id: str
    name: str
    jy_number: str


@dataclass(frozen=True)
class LineRange:
    from_id: str
    to_id: str
    n02_line: str


@dataclass(frozen=True)
class ServiceOverride:
    id: str
    name: str
    operator: str
    circular: bool
    color: str
    n02_operator: str
    updated_at: str  # data update date, YYYY-MM-DD (bump on every regeneration)


@dataclass(frozen=True)
class Overrides:
    stations: tuple[StationOverride, ...]
    line_ranges: tuple[LineRange, ...]
    service: ServiceOverride

    @property
    def station_ids(self) -> tuple[str, ...]:
        return tuple(station.id for station in self.stations)

    def segment_lines(self) -> tuple[str, ...]:
        """Return the N02 line name used for each outer-loop segment E[i]."""
        return expand_line_ranges(self.station_ids, self.line_ranges)


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise OverrideError(f"override file not found: {path}")
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_stations(path: Path) -> tuple[StationOverride, ...]:
    rows = _read_csv(path)
    stations = tuple(
        StationOverride(
            order=int(row["order"]),
            id=row["id"].strip(),
            name=row["name"].strip(),
            jy_number=row["jy_number"].strip(),
        )
        for row in rows
    )
    validate_stations(stations)
    return stations


def validate_stations(stations: tuple[StationOverride, ...]) -> None:
    if len(stations) != config.EXPECTED_STATION_COUNT:
        raise OverrideError(
            f"expected {config.EXPECTED_STATION_COUNT} stations, got {len(stations)}"
        )
    orders = [station.order for station in stations]
    if orders != list(range(len(stations))):
        raise OverrideError("station 'order' must be 0..N-1 in file order")
    for field in ("id", "name", "jy_number"):
        values = [getattr(station, field) for station in stations]
        if len(set(values)) != len(values):
            raise OverrideError(f"station '{field}' values must be unique")
    for station in stations:
        if not STATION_ID_PATTERN.match(station.id):
            raise OverrideError(f"station id is not kebab-case: {station.id!r}")
    if stations[0].id != config.START_STATION_ID:
        raise OverrideError(f"S[0] must be {config.START_STATION_ID!r}")
    validate_jy_order(stations)


def validate_jy_order(stations: tuple[StationOverride, ...]) -> None:
    """Outer loop = descending JR East station numbers (JY30 -> JY01 -> JY30)."""
    count = len(stations)
    numbers = []
    for station in stations:
        match = JY_NUMBER_PATTERN.match(station.jy_number)
        if match is None:
            raise OverrideError(f"invalid JY number: {station.jy_number!r}")
        numbers.append(int(match.group(1)))
    if sorted(numbers) != list(range(1, count + 1)):
        raise OverrideError(f"JY numbers must be exactly JY01..JY{count:02d}")
    for index, number in enumerate(numbers):
        following = numbers[(index + 1) % count]
        expected = count if number == 1 else number - 1
        if following != expected:
            raise OverrideError(
                f"outer-loop order broken after {stations[index].id} "
                f"(JY{number:02d} -> JY{following:02d})"
            )


def load_line_ranges(path: Path) -> tuple[LineRange, ...]:
    rows = _read_csv(path)
    return tuple(
        LineRange(
            from_id=row["from_id"].strip(),
            to_id=row["to_id"].strip(),
            n02_line=row["n02_line"].strip(),
        )
        for row in rows
    )


def expand_line_ranges(
    station_ids: tuple[str, ...], ranges: tuple[LineRange, ...]
) -> tuple[str, ...]:
    """Map every directed segment E[i] = S[i] -> S[i+1] to exactly one N02 line."""
    count = len(station_ids)
    index_of = {station_id: index for index, station_id in enumerate(station_ids)}
    assigned: list[str | None] = [None] * count
    for line_range in ranges:
        for endpoint in (line_range.from_id, line_range.to_id):
            if endpoint not in index_of:
                raise OverrideError(f"unknown station in line mapping: {endpoint!r}")
        start = index_of[line_range.from_id]
        end = index_of[line_range.to_id]
        span = (end - start) % count
        if span == 0:
            raise OverrideError(f"empty line range: {line_range}")
        for offset in range(span):
            segment_index = (start + offset) % count
            if assigned[segment_index] is not None:
                raise OverrideError(
                    f"segment E[{segment_index}] mapped twice "
                    f"({assigned[segment_index]} and {line_range.n02_line})"
                )
            assigned[segment_index] = line_range.n02_line
    missing = [index for index, line in enumerate(assigned) if line is None]
    if missing:
        raise OverrideError(f"segments without an N02 line mapping: {missing}")
    return tuple(line for line in assigned if line is not None)


def is_iso_date(value: object) -> bool:
    """True for a strict ``YYYY-MM-DD`` string that is a real calendar date."""
    if not isinstance(value, str) or not ISO_DATE_PATTERN.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def load_service(path: Path) -> ServiceOverride:
    if not path.is_file():
        raise OverrideError(f"override file not found: {path}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    updated_at = raw.get("updatedAt")
    if not is_iso_date(updated_at):
        raise OverrideError(
            f"service 'updatedAt' must be a YYYY-MM-DD date, got {updated_at!r}"
        )
    return ServiceOverride(
        id=str(raw["id"]),
        name=str(raw["name"]),
        operator=str(raw["operator"]),
        circular=bool(raw["circular"]),
        color=str(raw["color"]),
        n02_operator=str(raw["n02Operator"]),
        updated_at=updated_at,
    )


def load_overrides(overrides_dir: Path) -> Overrides:
    overrides = Overrides(
        stations=load_stations(overrides_dir / config.STATIONS_OVERRIDE_FILE),
        line_ranges=load_line_ranges(overrides_dir / config.LINE_MAPPING_OVERRIDE_FILE),
        service=load_service(overrides_dir / config.SERVICE_OVERRIDE_FILE),
    )
    overrides.segment_lines()  # fail fast on an incomplete mapping
    return overrides
