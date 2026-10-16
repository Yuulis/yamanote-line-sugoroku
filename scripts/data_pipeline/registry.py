"""Curated JR station registry (``data/overrides/stations.csv``).

One row per JR station facility shared by every service that stops there. The
registry, not the station name, is the identity: N02 platforms are only matched
to a registry row by (normalised) name *and* the service's mapped N02 lines.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import (
    ANY_PLATFORM,
    ConstraintError,
    PlatformSelector,
    parse_platform_selector,
)

STATION_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REGISTRY_COLUMNS = (
    "id",
    "name",
    "n02_name",
    "prefecture",
    "municipality",
    "representative_service_id",
)

# Small katakana that JR East timetables write large (阿佐ヶ谷 -> 阿佐ケ谷).
_SMALL_KANA = str.maketrans({"ヶ": "ケ", "ヵ": "カ"})


class OverrideError(ValueError):
    """Raised when an override table is malformed or inconsistent."""


def normalize_station_name(name: str) -> str:
    """Canonical comparison form: NFKC, trimmed, small ヶ/ヵ -> ケ/カ."""
    return unicodedata.normalize("NFKC", name).strip().translate(_SMALL_KANA)


@dataclass(frozen=True)
class RegistryStation:
    id: str
    name: str  # official JR East spelling (large ケ)
    n02_name: str  # name used to match N02 platforms (defaults to ``name``)
    prefecture: str
    municipality: str
    representative_service_id: str
    n02_selector: PlatformSelector = ANY_PLATFORM
    aliases: tuple[str, ...] = ()
    n02_operator: str = ""

    @property
    def match_name(self) -> str:
        """Normalised name compared against normalised N02 station names."""
        return normalize_station_name(self.n02_name)


@dataclass(frozen=True)
class Registry:
    stations: tuple[RegistryStation, ...]

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(station.id for station in self.stations)

    def by_id(self) -> dict[str, RegistryStation]:
        return {station.id: station for station in self.stations}


@dataclass(frozen=True)
class Area:
    prefectures: tuple[str, ...] = config.CAPITAL_REGION_PREFECTURES
    municipalities: tuple[str, ...] = ()  # optional restriction for older datasets

    def contains(self, prefecture: str, municipality: str) -> bool:
        return prefecture in self.prefectures and (
            not self.municipalities or municipality in self.municipalities
        )


@dataclass(frozen=True)
class ScopeStop:
    station_id: str
    prefecture: str
    municipality: str


@dataclass(frozen=True)
class BoundaryTruncation:
    endpoint: str
    last_in_area: str
    first_out_of_area: str


def parse_scope(rows: Iterable[Mapping[str, str]]) -> tuple[ScopeStop, ...]:
    stops = tuple(
        ScopeStop(row["station_id"], row["prefecture"], row["municipality"])
        for row in rows
    )
    if not stops or len({stop.station_id for stop in stops}) != len(stops):
        raise OverrideError("served stop evidence must be non-empty with unique ids")
    for stop in stops:
        if (
            not STATION_ID_PATTERN.fullmatch(stop.station_id)
            or not stop.prefecture
            or not stop.municipality
        ):
            raise OverrideError(
                "served stop evidence needs an id, prefecture and municipality"
            )
    return stops


def check_scope(
    service_id: str,
    station_ids: tuple[str, ...],
    evidence: tuple[ScopeStop, ...],
    registry: Registry,
    area: Area,
    endpoint_kinds: tuple[str, str] | None,
) -> tuple[BoundaryTruncation, ...]:
    """One contiguous in-area run, all served stops and boundary neighbours.

    Evidence is a reviewed ordered stop pattern, including at least the first
    excluded stop at each area boundary. A filtered list alone cannot prove
    that a service did not leave and re-enter the area between playable stops.
    """
    indices = [
        i
        for i, stop in enumerate(evidence)
        if area.contains(stop.prefecture, stop.municipality)
    ]
    if not indices:
        raise OverrideError(f"{service_id}: served stop evidence has no in-area stops")
    if indices != list(range(indices[0], indices[-1] + 1)):
        raise OverrideError(f"{service_id}: out-of-area gap cannot be bridged")
    in_area = tuple(evidence[i].station_id for i in indices)
    if in_area != station_ids:
        raise OverrideError(
            f"{service_id}: served stop evidence differs from stops.csv"
        )
    stations = registry.by_id()
    for i in indices:
        stop = evidence[i]
        station = stations[stop.station_id]
        if (stop.prefecture, stop.municipality) != (
            station.prefecture,
            station.municipality,
        ):
            raise OverrideError(
                f"{service_id}/{stop.station_id}: served stop evidence area differs from registry"
            )
    boundaries: list[BoundaryTruncation] = []
    for endpoint, index, neighbour, kind in (
        (
            "first",
            indices[0],
            indices[0] - 1,
            endpoint_kinds[0] if endpoint_kinds else None,
        ),
        (
            "last",
            indices[-1],
            indices[-1] + 1,
            endpoint_kinds[1] if endpoint_kinds else None,
        ),
    ):
        has_outside = 0 <= neighbour < len(evidence)
        if has_outside != (kind == "area-boundary"):
            raise OverrideError(
                f"{service_id}: {endpoint} boundary truncation evidence disagrees with endpoint kind"
            )
        if has_outside:
            boundaries.append(
                BoundaryTruncation(
                    endpoint, evidence[index].station_id, evidence[neighbour].station_id
                )
            )
    return tuple(boundaries)


def read_csv(path: Path, columns: Iterable[str]) -> list[dict[str, str]]:
    """Rows of a UTF-8 CSV override, requiring the given header columns."""
    if not path.is_file():
        raise OverrideError(f"override file not found: {path}")
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [name for name in columns if name not in (reader.fieldnames or [])]
        if missing:
            raise OverrideError(f"{path.name} is missing columns {missing}")
        return [
            {key: (value or "").strip() for key, value in row.items() if key}
            for row in reader
        ]


def parse_registry(rows: Iterable[Mapping[str, str]]) -> Registry:
    stations: list[RegistryStation] = []
    for row in rows:
        try:
            selector = parse_platform_selector(row.get("n02_selector", ""))
        except ConstraintError as error:
            raise OverrideError(f"station {row['id']}: {error}") from error
        aliases_raw = row.get("aliases", "")
        try:
            aliases_value = json.loads(aliases_raw) if aliases_raw else []
        except json.JSONDecodeError as error:
            raise OverrideError(
                f"station {row['id']}: aliases must be a JSON string array"
            ) from error
        if not isinstance(aliases_value, list) or not all(
            isinstance(value, str) and value.strip() for value in aliases_value
        ):
            raise OverrideError(
                f"station {row['id']}: aliases must be a JSON string array"
            )
        aliases = tuple(aliases_value)
        if len(set(aliases)) != len(aliases):
            raise OverrideError(f"station {row['id']}: aliases must be unique")
        stations.append(
            RegistryStation(
                id=row["id"],
                name=row["name"],
                n02_name=row["n02_name"] or row["name"],
                prefecture=row["prefecture"],
                municipality=row["municipality"],
                representative_service_id=row["representative_service_id"],
                n02_selector=selector,
                aliases=aliases,
                n02_operator=row.get("n02_operator", ""),
            )
        )
    validate_registry(tuple(stations))
    return Registry(stations=tuple(stations))


def validate_registry(stations: tuple[RegistryStation, ...]) -> None:
    """Unique ids, official spelling, explicit homonym identity and area."""
    if not stations:
        raise OverrideError("station registry is empty")
    seen_ids: set[str] = set()
    seen_names: dict[str, list[RegistryStation]] = {}
    for station in stations:
        if not STATION_ID_PATTERN.match(station.id):
            raise OverrideError(f"station id is not kebab-case: {station.id!r}")
        if station.id in seen_ids:
            raise OverrideError(f"duplicate station id in registry: {station.id}")
        seen_ids.add(station.id)
        if not station.name:
            raise OverrideError(f"station {station.id} has no name")
        if normalize_station_name(station.name) != station.name:
            raise OverrideError(
                f"station {station.id} name {station.name!r} is not in official "
                f"spelling (use {normalize_station_name(station.name)!r}; put the "
                "N02 spelling in n02_name)"
            )
        if station.n02_operator and not station.n02_operator.strip():
            raise OverrideError(f"station {station.id} has blank n02_operator")
        for alias in station.aliases:
            if not alias.strip() or normalize_station_name(alias) != alias:
                raise OverrideError(f"station {station.id} has invalid alias {alias!r}")
        key = station.match_name
        for previous in seen_names.get(key, []):
            # An omitted operator is resolved from each row's representative
            # service after services.json has loaded. Defer those homonyms to
            # check_consistency, where effective operators and stop selectors
            # are available.
            if (
                not station.n02_operator
                or not previous.n02_operator
                or station.n02_operator != previous.n02_operator
            ):
                continue
            left, right = station.n02_selector, previous.n02_selector
            disjoint = any(
                a and b and a.isdisjoint(b)
                for a, b in (
                    (left.lines, right.lines),
                    (left.groups, right.groups),
                    (left.codes, right.codes),
                )
            )
            if not disjoint:
                raise OverrideError(
                    f"homonym in registry: {station.id} and {previous.id} need "
                    "disjoint N02 selectors"
                )
        seen_names.setdefault(key, []).append(station)
        if station.prefecture not in config.ALLOWED_RAILWAY_PREFECTURES:
            raise OverrideError(
                f"station {station.id} prefecture {station.prefecture!r} is unsupported"
            )
        if not station.municipality:
            raise OverrideError(f"station {station.id} has no municipality")
        if not station.representative_service_id:
            raise OverrideError(f"station {station.id} has no representative service")


def load_registry(path: Path) -> Registry:
    return parse_registry(read_csv(path, REGISTRY_COLUMNS))
