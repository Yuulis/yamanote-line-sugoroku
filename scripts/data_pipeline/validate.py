"""Validate ``public/data/*`` against the spec §5.2 data-quality conditions.

Usage: ``uv run python -m scripts.data_pipeline.validate [--data-dir ...]``

Exit code 0 when every check passes, 1 otherwise. Only the generated JSON and
the override tables are read, so this runs without the raw N02 download.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point

from scripts.data_pipeline import config
from scripts.data_pipeline.export import (
    GAME_DATA_FILES,
    data_version,
    manifest_inputs,
)
from scripts.data_pipeline.overrides import OverrideError, is_iso_date, load_overrides

_TO_METRIC = Transformer.from_crs(config.OUTPUT_CRS, config.METRIC_CRS, always_xy=True)
_DECIMALS_PATTERN = re.compile(r"\.(\d+)")


@dataclass(frozen=True)
class Dataset:
    stations: Any
    services: Any
    segments: Any
    geojson: Any
    manifest: Any
    payloads: dict[str, str]  # raw text of the game data files, for the hash

    @property
    def geojson_bytes(self) -> int:
        return len(self.payloads.get(config.SEGMENTS_GEOJSON_FILE, "").encode())


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_dataset(data_dir: Path) -> Dataset:
    payloads = {
        name: (data_dir / name).read_text(encoding="utf-8") for name in GAME_DATA_FILES
    }
    manifest_text = (data_dir / config.MANIFEST_FILE).read_text(encoding="utf-8")
    return Dataset(
        stations=json.loads(payloads[config.STATIONS_FILE]),
        services=json.loads(payloads[config.SERVICES_FILE]),
        segments=json.loads(payloads[config.SEGMENTS_FILE]),
        geojson=json.loads(payloads[config.SEGMENTS_GEOJSON_FILE]),
        manifest=json.loads(manifest_text),
        payloads=payloads,
    )


def to_metric(coordinate: Sequence[float]) -> tuple[float, float]:
    x, y = _TO_METRIC.transform(coordinate[0], coordinate[1])
    return (float(x), float(y))


def _is_coordinate(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 2:
        return False
    if not all(
        isinstance(item, int | float) and not isinstance(item, bool) for item in value
    ):
        return False
    if not all(math.isfinite(item) for item in value):
        return False
    min_lon, min_lat, max_lon, max_lat = config.OUTPUT_BBOX
    return min_lon <= value[0] <= max_lon and min_lat <= value[1] <= max_lat


def _too_many_decimals(value: float) -> bool:
    match = _DECIMALS_PATTERN.search(repr(value))
    return match is not None and len(match.group(1)) > config.COORDINATE_DECIMALS


def _is_object_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, dict) for item in value)


def check_stations(
    stations: Any,
    official: Sequence[tuple[str, str]] | None,
    report: Report,
) -> dict[str, list[float]]:
    """Count, unique ids/names, coordinates, and (id, name) vs. the override."""
    if not _is_object_list(stations):
        report.errors.append("stations.json must be a JSON array of objects")
        return {}
    if len(stations) != config.EXPECTED_STATION_COUNT:
        report.errors.append(
            f"expected {config.EXPECTED_STATION_COUNT} stations, got {len(stations)}"
        )
    positions: dict[str, list[float]] = {}
    names: list[str] = []
    for index, station in enumerate(stations):
        station_id = station.get("id")
        name = station.get("name")
        if not isinstance(station_id, str) or not station_id:
            report.errors.append(f"stations[{index}] has no id")
            continue
        if station_id in positions:
            report.errors.append(f"duplicate station id: {station_id}")
        if not isinstance(name, str) or not name:
            report.errors.append(f"station {station_id} has no name")
        else:
            names.append(name)
        coordinates = station.get("coordinates")
        if not _is_coordinate(coordinates):
            report.errors.append(f"station {station_id} has invalid coordinates")
            continue
        positions[station_id] = coordinates
    if len(set(names)) != len(names):
        report.errors.append("station names must be unique")
    if official is not None:
        published = [(station.get("id"), station.get("name")) for station in stations]
        if published != [tuple(pair) for pair in official]:
            report.errors.append(
                "stations.json (id, name) order differs from data/overrides"
            )
    return positions


def check_service(
    services: Any, station_order: Sequence[Any], report: Report
) -> tuple[str, list[str]]:
    if not _is_object_list(services) or len(services) != 1:
        report.errors.append("services.json must be an array with one service object")
        return ("", [])
    service = services[0]
    station_ids = service.get("stationIds")
    if not isinstance(station_ids, list) or not all(
        isinstance(item, str) for item in station_ids
    ):
        report.errors.append("service stationIds must be an array of strings")
        return (str(service.get("id", "")), [])
    if service.get("circular") is not True:
        report.errors.append("service must be circular")
    if not station_ids or station_ids[0] != config.START_STATION_ID:
        report.errors.append(f"stationIds must start at {config.START_STATION_ID}")
    if len(station_ids) != len(set(station_ids)):
        report.errors.append("stationIds must not repeat (start is not re-listed)")
    if station_ids != list(station_order):
        report.errors.append("service stationIds differ from stations.json order")
    for key in ("id", "name", "operator", "color"):
        if not isinstance(service.get(key), str) or not service[key]:
            report.errors.append(f"service is missing {key}")
    return (str(service.get("id", "")), station_ids)


def check_segments(
    segments: Any, service_id: str, station_ids: Sequence[str], report: Report
) -> list[dict[str, Any]]:
    """Directed outer-loop chain E[i] = S[i] -> S[i+1], closing to the start."""
    if not _is_object_list(segments):
        report.errors.append("segments.json must be a JSON array of objects")
        return []
    count = len(station_ids)
    if len(segments) != config.EXPECTED_STATION_COUNT:
        report.errors.append(
            f"expected {config.EXPECTED_STATION_COUNT} segments, got {len(segments)}"
        )
    ids = [str(segment.get("id")) for segment in segments]
    if len(set(ids)) != len(ids):
        report.errors.append("segment ids must be unique")
    for index, segment in enumerate(segments):
        expected_from = station_ids[index] if index < count else None
        expected_to = station_ids[(index + 1) % count] if count else None
        expected_id = f"{service_id}:{segment.get('from')}:{segment.get('to')}"
        if segment.get("id") != expected_id:
            report.errors.append(f"segments[{index}] id must be {expected_id}")
        if segment.get("geometryFeatureId") != segment.get("id"):
            report.errors.append(f"segments[{index}] geometryFeatureId != id")
        if segment.get("serviceId") != service_id:
            report.errors.append(f"segments[{index}] serviceId mismatch")
        if segment.get("from") != expected_from or segment.get("to") != expected_to:
            report.errors.append(
                f"segments[{index}] must run {expected_from} -> {expected_to}"
            )
    for index, segment in enumerate(segments):
        following = segments[(index + 1) % len(segments)]
        if segment.get("to") != following.get("from"):
            report.errors.append(f"segments[{index}].to != next segment's from")
    if segments and segments[-1].get("to") != config.START_STATION_ID:
        report.errors.append(f"last segment must close to {config.START_STATION_ID}")
    referenced = {segment.get("from") for segment in segments} | {
        segment.get("to") for segment in segments
    }
    unreferenced = sorted(set(station_ids) - referenced)
    if unreferenced:
        report.errors.append(f"stations not referenced by segments: {unreferenced}")
    return segments


def check_walk(segments: Sequence[dict[str, Any]], report: Report) -> None:
    """Walking one full lap from the start must visit every segment once."""
    outgoing = {segment.get("from"): segment for segment in segments}
    current = config.START_STATION_ID
    visited: list[str] = []
    for _ in range(config.EXPECTED_STATION_COUNT):
        segment = outgoing.get(current)
        if segment is None:
            report.errors.append(f"walk stuck at {current}: no outgoing segment")
            return
        visited.append(str(segment.get("id")))
        current = str(segment.get("to"))
    if current != config.START_STATION_ID:
        report.errors.append(f"30-step walk ends at {current}, not the start")
    if len(set(visited)) != config.EXPECTED_STATION_COUNT:
        report.errors.append("30-step walk does not cover every segment exactly once")


def _feature_parts(feature: dict[str, Any]) -> list[Any]:
    """Coordinate arrays of a LineString / MultiLineString feature, else []."""
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return []
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return []
    if kind == "LineString":
        return [coordinates]
    if kind == "MultiLineString":
        return list(coordinates)
    return []


def _feature_geometry(
    feature: dict[str, Any], label: str, report: Report
) -> MultiLineString | None:
    """Validated metric geometry of one feature (parts kept separate)."""
    parts = _feature_parts(feature)
    if not parts or any(not isinstance(part, list) or len(part) < 2 for part in parts):
        report.errors.append(f"empty or degenerate geometry: {label}")
        return None
    coordinates = [point for part in parts for point in part]
    if not all(_is_coordinate(point) for point in coordinates):
        report.errors.append(f"bad coordinate in {label}")
        return None
    if any(_too_many_decimals(value) for point in coordinates for value in point):
        report.errors.append(f"coordinates not rounded in {label}")
    lines = [LineString([to_metric(point) for point in part]) for part in parts]
    for previous, following in zip(lines, lines[1:], strict=False):
        gap = Point(previous.coords[-1]).distance(Point(following.coords[0]))
        if gap > config.ENDPOINT_MAX_DISTANCE_M:
            report.errors.append(f"{label} has a {gap:.0f} m gap between parts")
    return MultiLineString(lines)


def _check_feature_shape(feature: Any, segment: dict[str, Any], report: Report) -> bool:
    label = str(segment.get("id"))
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        report.errors.append(f"{label} is not a GeoJSON Feature")
        return False
    expected = {
        "segmentId": segment.get("id"),
        "serviceId": segment.get("serviceId"),
        "from": segment.get("from"),
        "to": segment.get("to"),
    }
    if feature.get("properties") != expected:
        report.errors.append(f"properties mismatch on {label}")
    return True


def check_geometry(
    geojson: Any,
    segments: Sequence[dict[str, Any]],
    positions: dict[str, list[float]],
    report: Report,
) -> None:
    """Track geometry: presence, endpoints, detours, stations passed, length."""
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        report.errors.append("segments.geojson must be a FeatureCollection")
        return
    if "crs" in geojson:
        report.errors.append("segments.geojson must not carry a crs member")
    features = geojson.get("features")
    if not isinstance(features, list):
        report.errors.append("segments.geojson features must be an array")
        return
    feature_ids = [
        f.get("id") if isinstance(f, dict) and isinstance(f.get("id"), str) else None
        for f in features
    ]
    if feature_ids != [segment.get("id") for segment in segments]:
        report.errors.append("geojson feature ids must match segments order")
    by_id = dict(zip(feature_ids, features, strict=True))

    station_points = {
        station_id: Point(to_metric(coordinate))
        for station_id, coordinate in positions.items()
    }
    max_endpoint = 0.0
    min_foreign = math.inf
    max_detour = 0.0
    total_length = 0.0
    for segment in segments:
        label = str(segment.get("id"))
        feature = by_id.get(segment.get("id"))
        if feature is None:
            report.errors.append(f"missing geometry for {label}")
            continue
        if not _check_feature_shape(feature, segment, report):
            continue
        geometry = _feature_geometry(feature, label, report)
        start = station_points.get(str(segment.get("from")))
        end = station_points.get(str(segment.get("to")))
        if geometry is None or start is None or end is None:
            continue
        first, last = geometry.geoms[0], geometry.geoms[-1]
        endpoint_gap = max(
            Point(first.coords[0]).distance(start), Point(last.coords[-1]).distance(end)
        )
        max_endpoint = max(max_endpoint, endpoint_gap)
        if endpoint_gap > config.ENDPOINT_MAX_DISTANCE_M:
            report.errors.append(f"{label} endpoint {endpoint_gap:.1f} m from station")
        straight = start.distance(end)
        detour = geometry.length / straight if straight > 0 else math.inf
        max_detour = max(max_detour, detour)
        if detour > config.MAX_DETOUR_RATIO:
            report.errors.append(f"{label} detour ratio {detour:.2f}")
        total_length += geometry.length
        for station_id, point in station_points.items():
            if station_id in (segment.get("from"), segment.get("to")):
                continue
            distance = geometry.distance(point)
            min_foreign = min(min_foreign, distance)
            if distance < config.FOREIGN_STATION_MIN_DISTANCE_M:
                report.errors.append(
                    f"{label} passes {distance:.0f} m from {station_id} "
                    "(station order or routing is wrong)"
                )

    total_km = total_length / 1000
    if abs(total_km - config.OFFICIAL_LOOP_LENGTH_KM) > config.LOOP_LENGTH_TOLERANCE_KM:
        report.errors.append(
            f"loop length {total_km:.2f} km is far from the official "
            f"{config.OFFICIAL_LOOP_LENGTH_KM} km"
        )
    report.metrics.update(
        {
            "max_endpoint_distance_m": round(max_endpoint, 3),
            "min_foreign_station_distance_m": round(min_foreign, 1),
            "max_detour_ratio": round(max_detour, 3),
            "loop_length_km": round(total_km, 3),
        }
    )


def check_manifest(
    manifest: Any,
    payloads: dict[str, str],
    report: Report,
    updated_at: str | None = None,
) -> None:
    if not isinstance(manifest, dict):
        report.errors.append("manifest.json must be an object")
        return
    if set(manifest) != {"dataVersion", "updatedAt", "source"}:
        report.errors.append(
            "manifest.json must have exactly dataVersion, updatedAt and source"
        )
    if not is_iso_date(manifest.get("updatedAt")):
        report.errors.append("manifest.updatedAt must be a YYYY-MM-DD date")
    elif updated_at is not None and manifest["updatedAt"] != updated_at:
        report.errors.append(
            f"manifest.updatedAt differs from the override ({updated_at}); rebuild"
        )
    if manifest.get("source") != config.MANIFEST_SOURCE:
        report.errors.append("manifest.source differs from the N02 2025 contract")
    expected = data_version(manifest_inputs(payloads))
    if manifest.get("dataVersion") != expected:
        report.errors.append(
            f"manifest.dataVersion is stale (expected {expected}); rebuild"
        )


def validate_dataset(
    dataset: Dataset,
    official: Sequence[tuple[str, str]] | None = None,
    updated_at: str | None = None,
) -> Report:
    """Run every check.

    ``official`` is the override (id, name) outer-loop order and ``updated_at``
    the override's update date; each is compared only when given.
    """
    report = Report()
    positions = check_stations(dataset.stations, official, report)
    stations = dataset.stations if _is_object_list(dataset.stations) else []
    station_order = [station.get("id") for station in stations]
    service_id, station_ids = check_service(dataset.services, station_order, report)
    segments = check_segments(dataset.segments, service_id, station_ids, report)
    check_walk(segments, report)
    check_geometry(dataset.geojson, segments, positions, report)
    check_manifest(dataset.manifest, dataset.payloads, report, updated_at)
    report.metrics["segments_geojson_bytes"] = dataset.geojson_bytes
    if dataset.geojson_bytes > config.MAX_GEOJSON_BYTES:
        report.errors.append(f"segments.geojson is {dataset.geojson_bytes} bytes")
    return report


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=config.DEFAULT_OUT_DIR)
    parser.add_argument(
        "--overrides-dir", type=Path, default=config.DEFAULT_OVERRIDES_DIR
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        overrides = load_overrides(args.overrides_dir)
    except OverrideError as error:
        print(f"FAIL overrides: {error}")
        return 1
    official = [(station.id, station.name) for station in overrides.stations]
    report = validate_dataset(
        load_dataset(args.data_dir), official, overrides.service.updated_at
    )
    for name, value in sorted(report.metrics.items()):
        print(f"{name}: {value}")
    print(
        f"thresholds: endpoint<={config.ENDPOINT_MAX_DISTANCE_M} m, "
        f"foreign station>={config.FOREIGN_STATION_MIN_DISTANCE_M} m, "
        f"detour<={config.MAX_DETOUR_RATIO}, "
        f"loop={config.OFFICIAL_LOOP_LENGTH_KM}±{config.LOOP_LENGTH_TOLERANCE_KM} km, "
        f"geojson<={config.MAX_GEOJSON_BYTES} bytes"
    )
    for error in report.errors:
        print(f"FAIL {error}")
    print("OK" if report.ok else f"{len(report.errors)} check(s) failed")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
