"""Curated JR station registry (``data/overrides/stations.csv``).

One row per JR station facility shared by every service that stops there. The
registry, not the station name, is the identity: N02 platforms are only matched
to a registry row by (normalised) name *and* the service's mapped N02 lines.
"""

from __future__ import annotations

import csv
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from scripts.data_pipeline import config

STATION_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REGISTRY_COLUMNS = ("id", "name", "n02_name", "ward", "representative_service_id")

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
    ward: str
    representative_service_id: str

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
    stations = tuple(
        RegistryStation(
            id=row["id"],
            name=row["name"],
            n02_name=row["n02_name"] or row["name"],
            ward=row["ward"],
            representative_service_id=row["representative_service_id"],
        )
        for row in rows
    )
    validate_registry(stations)
    return Registry(stations=stations)


def validate_registry(stations: tuple[RegistryStation, ...]) -> None:
    """Unique kebab-case ids, official spelling, no homonyms, in-area wards."""
    if not stations:
        raise OverrideError("station registry is empty")
    seen_ids: set[str] = set()
    seen_names: dict[str, str] = {}
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
        key = station.match_name
        if key in seen_names:
            raise OverrideError(
                f"homonym in registry: {station.id} and {seen_names[key]} both "
                f"match N02 name {key!r}"
            )
        seen_names[key] = station.id
        if station.ward not in config.TOKYO_23_WARDS:
            raise OverrideError(
                f"station {station.id} ward {station.ward!r} is not one of the "
                "23 special wards"
            )
        if not station.representative_service_id:
            raise OverrideError(f"station {station.id} has no representative service")


def load_registry(path: Path) -> Registry:
    return parse_registry(read_csv(path, REGISTRY_COLUMNS))
