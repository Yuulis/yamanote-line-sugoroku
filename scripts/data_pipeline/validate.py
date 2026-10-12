"""Validate ``public/data/*`` (v1 contract) against ``data/overrides``.

Usage: ``uv run python -m scripts.data_pipeline.validate [--data-dir ...]``

Exit code 0 when every check passes, 1 otherwise. Only the generated JSON and
the override tables are read, so this runs without the raw N02 download.

This module parses the v1 file shapes; the contract-independent rules of the
design §5.4 live in ``rules.py`` and are applied to the parsed v1 data here.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point

from scripts.data_pipeline import config, rules
from scripts.data_pipeline.export import (
    GAME_DATA_FILES,
    data_version,
    manifest_inputs,
)
from scripts.data_pipeline.overrides import (
    OverrideError,
    Overrides,
    is_iso_date,
    load_overrides,
)
from scripts.data_pipeline.rules import Report, ServiceStops
from scripts.data_pipeline.topology import station_order

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


def official_station_order(overrides: Overrides) -> list[tuple[str, str]]:
    """(id, registry name) of every published station, in contract order."""
    registry = overrides.registry.by_id()
    order = station_order(service.station_ids for service in overrides.services)
    return [(station_id, registry[station_id].name) for station_id in order]


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
    official: Sequence[tuple[str, str]],
    report: Report,
) -> dict[str, list[float]]:
    """Count, unique ids/names, coordinates, and (id, name) vs. the override."""
    if not _is_object_list(stations):
        report.errors.append("stations.json must be a JSON array of objects")
        return {}
    if len(stations) != len(official):
        report.errors.append(f"expected {len(official)} stations, got {len(stations)}")
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
    published = [(station.get("id"), station.get("name")) for station in stations]
    if published != [tuple(pair) for pair in official]:
        report.errors.append(
            "stations.json (id, name) order differs from data/overrides"
        )
    return positions


def check_service(
    services: Any, station_order: Sequence[Any], overrides: Overrides, report: Report
) -> tuple[str, list[str]]:
    """v1 shape: exactly one service, the circular target, starting at S[0]."""
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
    start = overrides.dataset.start_station_id
    if service.get("circular") is not True:
        report.errors.append("service must be circular")
    if not station_ids or station_ids[0] != start:
        report.errors.append(f"stationIds must start at {start}")
    if len(station_ids) != len(set(station_ids)):
        report.errors.append("stationIds must not repeat (start is not re-listed)")
    if station_ids != list(station_order):
        report.errors.append("service stationIds differ from stations.json order")
    for key in ("id", "name", "operator", "color"):
        if not isinstance(service.get(key), str) or not service[key]:
            report.errors.append(f"service is missing {key}")
    rules.check_service_metadata(
        service, overrides.target.definition, overrides.dataset.operator, report
    )
    return (str(service.get("id", "")), station_ids)


def check_segments(
    segments: Any,
    service_id: str,
    station_ids: Sequence[str],
    overrides: Overrides,
    report: Report,
) -> list[dict[str, Any]]:
    """Directed outer-loop chain E[i] = S[i] -> S[i+1], closing to the start."""
    if not _is_object_list(segments):
        report.errors.append("segments.json must be a JSON array of objects")
        return []
    count = len(station_ids)
    expected_count = overrides.target.definition.expected_stop_count
    start = overrides.dataset.start_station_id
    if len(segments) != expected_count:
        report.errors.append(f"expected {expected_count} segments, got {len(segments)}")
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
    if segments and segments[-1].get("to") != start:
        report.errors.append(f"last segment must close to {start}")
    referenced = {segment.get("from") for segment in segments} | {
        segment.get("to") for segment in segments
    }
    unreferenced = sorted(set(station_ids) - referenced)
    if unreferenced:
        report.errors.append(f"stations not referenced by segments: {unreferenced}")
    return segments


def check_walk(
    segments: Sequence[dict[str, Any]], start: str, steps: int, report: Report
) -> None:
    """Walking one full lap from the start must visit every segment once."""
    outgoing = {segment.get("from"): segment for segment in segments}
    current = start
    visited: list[str] = []
    for _ in range(steps):
        segment = outgoing.get(current)
        if segment is None:
            report.errors.append(f"walk stuck at {current}: no outgoing segment")
            return
        visited.append(str(segment.get("id")))
        current = str(segment.get("to"))
    if current != start:
        report.errors.append(f"{steps}-step walk ends at {current}, not the start")
    if len(set(visited)) != steps:
        report.errors.append(
            f"{steps}-step walk does not cover every segment exactly once"
        )


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
    overrides: Overrides,
    report: Report,
) -> None:
    """Track geometry: presence, endpoints, detours, skipped stops, length."""
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

    target = overrides.target
    station_points = {
        station_id: Point(to_metric(coordinate))
        for station_id, coordinate in positions.items()
    }
    service_points = {
        station_id: point
        for station_id, point in station_points.items()
        if station_id in target.station_ids
    }
    other_points = {
        station_id: point
        for station_id, point in station_points.items()
        if station_id not in service_points
    }
    max_endpoint = 0.0
    min_skipped = math.inf
    max_detour = 0.0
    other_passes = 0
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
        ends = (str(segment.get("from")), str(segment.get("to")))
        min_skipped = min(
            min_skipped,
            rules.check_skipped_stops(label, geometry, ends, service_points, report),
        )
        other_passes += rules.count_other_passes(geometry, other_points)

    rules.check_service_length(
        target.id, total_length, target.definition.length_ref, report
    )
    report.metrics.update(
        {
            "max_endpoint_distance_m": round(max_endpoint, 3),
            "min_skipped_stop_distance_m": round(min_skipped, 1),
            "max_detour_ratio": round(max_detour, 3),
            "other_station_passes": other_passes,
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


def published_services(services: Any) -> list[ServiceStops]:
    """Topology of every well-formed published service (malformed ones skipped;
    their shape errors are reported by :func:`check_service`)."""
    parsed: list[ServiceStops] = []
    for service in services if _is_object_list(services) else []:
        station_ids = service.get("stationIds")
        if not isinstance(station_ids, list) or not all(
            isinstance(item, str) for item in station_ids
        ):
            continue
        parsed.append(
            ServiceStops(
                id=str(service.get("id")),
                station_ids=tuple(station_ids),
                circular=service.get("circular") is True,
            )
        )
    return parsed


def check_network_rules(
    dataset: Dataset,
    overrides: Overrides,
    positions: dict[str, list[float]],
    report: Report,
) -> None:
    """Contract-independent rules (registry, catalogue, topology, reachability)."""
    stations = dataset.stations if _is_object_list(dataset.stations) else []
    rules.check_registry_membership(
        [(str(station.get("id")), str(station.get("name"))) for station in stations],
        overrides.registry,
        report,
    )
    services = published_services(dataset.services)
    rules.check_catalogue(
        [service.id for service in services],
        overrides.dataset.service_ids,
        excluded=(),
        report=report,
    )
    segments = dataset.segments if _is_object_list(dataset.segments) else []
    for service in services:
        try:
            expected = overrides.service(service.id).station_ids
        except KeyError:
            continue  # reported by check_catalogue
        pairs = [
            (str(segment.get("from")), str(segment.get("to")))
            for segment in segments
            if segment.get("serviceId") == service.id
        ]
        rules.check_stop_list(service, expected, positions, report)
        rules.check_contiguity(service, pairs, report)
        rules.check_directed_pairs(service, pairs, report)
        rules.check_walks(service, pairs, report)
    start = overrides.dataset.start_station_id
    rules.check_connectivity(
        services,
        start,
        overrides.dataset.target_service_id,
        overrides.dataset.reviewed_disconnected_service_ids,
        report,
    )
    rules.check_start_not_endpoint(services, start, report)
    # v1 has one service, so its platform point is the station point.
    points = {
        station_id: Point(to_metric(coordinate))
        for station_id, coordinate in positions.items()
    }
    platforms = {
        (service.id, station_id): points[station_id]
        for service in services
        for station_id in service.station_ids
        if station_id in points
    }
    rules.check_platform_offsets(platforms, points, overrides.offset_exceptions, report)


def validate_dataset(dataset: Dataset, overrides: Overrides) -> Report:
    """Run every check of the published v1 files against ``overrides``."""
    report = Report()
    positions = check_stations(
        dataset.stations, official_station_order(overrides), report
    )
    stations = dataset.stations if _is_object_list(dataset.stations) else []
    station_ids_order = [station.get("id") for station in stations]
    service_id, station_ids = check_service(
        dataset.services, station_ids_order, overrides, report
    )
    segments = check_segments(
        dataset.segments, service_id, station_ids, overrides, report
    )
    check_walk(
        segments,
        overrides.dataset.start_station_id,
        overrides.target.definition.expected_stop_count,
        report,
    )
    check_geometry(dataset.geojson, segments, positions, overrides, report)
    check_network_rules(dataset, overrides, positions, report)
    check_manifest(
        dataset.manifest, dataset.payloads, report, overrides.dataset.updated_at
    )
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
    report = validate_dataset(load_dataset(args.data_dir), overrides)
    for name, value in sorted(report.metrics.items()):
        print(f"{name}: {value}")
    print(
        f"thresholds: endpoint<={config.ENDPOINT_MAX_DISTANCE_M} m, "
        f"skipped stop>={config.FOREIGN_STATION_MIN_DISTANCE_M} m, "
        f"detour<={config.MAX_DETOUR_RATIO}, "
        f"platform offset<={config.DEFAULT_MAX_PLATFORM_OFFSET_M} m, "
        f"length=services.json lengthRef, "
        f"geojson<={config.MAX_GEOJSON_BYTES} bytes"
    )
    for error in report.errors:
        print(f"FAIL {error}")
    print("OK" if report.ok else f"{len(report.errors)} check(s) failed")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
