"""Validate ``public/data/*`` (v3 contract) against ``data/overrides``.

Usage: ``uv run python -m scripts.data_pipeline.validate [--data-dir ...]``

Exit code 0 when every check passes, 1 otherwise. Only the generated JSON and
the override tables are read, so this runs without the raw N02 download.

Strict schemas and geometry checks are combined with the contract-independent
rules in ``rules.py`` (design section 5.4).
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
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config, rules
from scripts.data_pipeline.budgets import BUDGET_PROFILES, budget_errors, size_report
from scripts.data_pipeline.composition_validate import check_composed_artifacts
from scripts.data_pipeline.constraints import BBox
from scripts.data_pipeline.export import (
    GAME_DATA_FILES,
    build_segments,
    data_version,
    dumps_feature_collection,
    dumps_pretty,
    dumps_segments,
    feature_id,
    manifest_inputs,
)
from scripts.data_pipeline.overrides import (
    OverrideError,
    Overrides,
    is_iso_date,
    load_overrides,
)
from scripts.data_pipeline.rules import Report, ServiceStops
from scripts.data_pipeline.topology import station_order, station_pairs

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
    manifest_payload: str | None = None

    @property
    def service_patterns(self) -> Any:
        return self.services["services"]

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
        manifest_payload=manifest_text,
    )


def official_station_order(overrides: Overrides) -> list[tuple[str, str]]:
    """(id, registry name) of every published station, in contract order."""
    registry = overrides.registry.by_id()
    order = station_order(service.station_ids for service in overrides.services)
    return [(station_id, registry[station_id].name) for station_id in order]


def to_metric(coordinate: Sequence[float]) -> tuple[float, float]:
    x, y = _TO_METRIC.transform(coordinate[0], coordinate[1])
    return (float(x), float(y))


def _is_coordinate(value: Any, bbox: BBox = config.DEFAULT_OUTPUT_BBOX) -> bool:
    if not isinstance(value, list) or len(value) != 2:
        return False
    if not all(
        isinstance(item, int | float) and not isinstance(item, bool) for item in value
    ):
        return False
    if not all(math.isfinite(item) for item in value):
        return False
    min_lon, min_lat, max_lon, max_lat = bbox
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
    bbox: BBox = config.DEFAULT_OUTPUT_BBOX,
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
        if set(station) != {"id", "name", "coordinates"}:
            report.errors.append(f"station {index} has invalid v3 fields")
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
        if not _is_coordinate(coordinates, bbox):
            report.errors.append(f"station {station_id} has invalid coordinates")
            continue
        if any(_too_many_decimals(value) for value in coordinates):
            report.errors.append(f"station {station_id} coordinates not rounded")
        positions[station_id] = coordinates
    published = [(station.get("id"), station.get("name")) for station in stations]
    if published != [tuple(pair) for pair in official]:
        report.errors.append(
            "stations.json (id, name) order differs from data/overrides"
        )
    return positions


def check_services(
    services: Any,
    positions: dict[str, list[float]],
    overrides: Overrides,
    report: Report,
) -> tuple[list[ServiceStops], dict[tuple[str, str], Point]]:
    """Strict v3 metadata, topology and platform coordinates against overrides."""
    if not isinstance(services, dict) or set(services) != {"lines", "services"}:
        report.errors.append("services.json must be a v3 {lines, services} object")
        return [], {}
    expected_lines = [
        {"id": line.id, "name": line.name, "color": line.color}
        for line in overrides.lines
    ]
    if services["lines"] != expected_lines:
        report.errors.append("services.json lines differ from data/overrides")
    services = services["services"]
    if not _is_object_list(services):
        report.errors.append("services.json services must be an array of objects")
        return [], {}
    parsed: list[ServiceStops] = []
    platforms: dict[tuple[str, str], Point] = {}
    ids = [
        service.get("id") for service in services if isinstance(service.get("id"), str)
    ]
    rules.check_catalogue(ids, overrides.dataset.service_ids, (), report)
    for raw in services:
        service_id = raw.get("id")
        if (
            not isinstance(service_id, str)
            or service_id not in overrides.dataset.service_ids
        ):
            report.errors.append("service has an unknown id")
            continue
        expected = overrides.service(service_id)
        definition = expected.definition
        keys = {
            "id",
            "name",
            "operator",
            "kind",
            "lineIds",
            "color",
            "circular",
            "stationIds",
            "directionLabels",
            "platformCoordinates",
        }
        if not definition.circular:
            keys.add("endpoints")
        if set(raw) != keys:
            report.errors.append(f"service {service_id} has invalid v3 fields")
        if type(raw.get("circular")) is not bool:
            report.errors.append(f"service {service_id} circular must be a boolean")
        rules.check_service_metadata(
            raw, definition, overrides.dataset.operator, report
        )
        if raw.get("directionLabels") != {
            "forward": definition.direction_labels.forward,
            "backward": definition.direction_labels.backward,
        }:
            report.errors.append(
                f"service {service_id} directionLabels differ from data/overrides"
            )
        expected_ends = (
            None
            if definition.endpoints is None
            else {
                "first": definition.endpoints.first,
                "last": definition.endpoints.last,
            }
        )
        if raw.get("endpoints") != expected_ends:
            report.errors.append(
                f"service {service_id} endpoints differ from data/overrides"
            )
        stop_ids = raw.get("stationIds")
        if not isinstance(stop_ids, list) or not all(
            isinstance(item, str) for item in stop_ids
        ):
            report.errors.append(
                f"service {service_id} stationIds must be an array of strings"
            )
            continue
        service = ServiceStops(service_id, tuple(stop_ids), definition.circular)
        parsed.append(service)
        rules.check_stop_list(service, expected.station_ids, positions, report)
        coords = raw.get("platformCoordinates")
        if not isinstance(coords, dict):
            report.errors.append(f"{service_id} platformCoordinates must be an object")
            continue
        rules.check_platform_keys(service, coords, report)
        for station_id, coordinate in coords.items():
            if not _is_coordinate(coordinate, overrides.dataset.output_bbox):
                report.errors.append(
                    f"{service_id}/{station_id} has invalid platform coordinates"
                )
                continue
            if any(_too_many_decimals(value) for value in coordinate):
                report.errors.append(
                    f"{service_id}/{station_id} coordinates not rounded"
                )
            platforms[(service_id, station_id)] = Point(to_metric(coordinate))
    for station in overrides.registry.stations:
        coordinate = positions.get(station.id)
        platform = platforms.get((station.representative_service_id, station.id))
        if (
            coordinate is not None
            and platform is not None
            and Point(to_metric(coordinate)) != platform
        ):
            report.errors.append(
                f"station {station.id} coordinates differ from its representative platform"
            )
    return parsed, platforms


def check_segments(
    segments: Any, services: Sequence[ServiceStops], report: Report
) -> None:
    """Exact directed pair set, ids, shared geometry reference and deterministic order."""
    if not _is_object_list(segments):
        report.errors.append("segments.json must be a JSON array of objects")
        return
    expected: list[dict[str, Any]] = []
    for service in services:
        expected.extend(
            build_segments(service.id, service.station_ids, service.circular)
        )
        pairs = [
            (raw.get("from"), raw.get("to"))
            for raw in segments
            if raw.get("serviceId") == service.id
            and isinstance(raw.get("from"), str)
            and isinstance(raw.get("to"), str)
        ]
        rules.check_contiguity(service, pairs, report)
        rules.check_directed_pairs(service, pairs, report)
        rules.check_walks(service, pairs, report)
    if len(segments) != len(expected):
        report.errors.append(f"expected {len(expected)} segments, got {len(segments)}")
    seen: set[str] = set()
    for index, raw in enumerate(segments):
        identifier = raw.get("id")
        if not isinstance(identifier, str) or identifier in seen:
            report.errors.append(f"duplicate or invalid segment id at {index}")
        else:
            seen.add(identifier)
        chain = raw.get("geometryFeatureIds")
        if (
            not isinstance(chain, list)
            or not chain
            or not all(isinstance(item, str) and item for item in chain)
        ):
            report.errors.append(
                f"segment {identifier} needs a non-empty geometryFeatureIds chain"
            )
        keys = {"id", "serviceId", "from", "to", "geometryFeatureIds"}
        if (
            set(raw) != keys
            or index >= len(expected)
            or any(
                raw.get(key) != expected[index][key]
                for key in keys - {"geometryFeatureIds"}
            )
        ):
            report.errors.append(
                f"segments[{index}] differs from the directed pair contract"
            )


def _feature_geometry(
    feature: dict[str, Any],
    label: str,
    report: Report,
    bbox: BBox = config.DEFAULT_OUTPUT_BBOX,
) -> LineString | None:
    geometry = feature.get("geometry")
    if (
        not isinstance(geometry, dict)
        or set(geometry) != {"type", "coordinates"}
        or geometry.get("type") != "LineString"
    ):
        report.errors.append(f"{label} geometry must be a LineString")
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        report.errors.append(f"empty or degenerate geometry: {label}")
        return None
    if not all(_is_coordinate(point, bbox) for point in coordinates):
        report.errors.append(f"bad coordinate in {label}")
        return None
    if any(_too_many_decimals(value) for point in coordinates for value in point):
        report.errors.append(f"coordinates not rounded in {label}")
    if any(a == b for a, b in zip(coordinates, coordinates[1:], strict=False)):
        report.errors.append(f"repeated coordinate in {label}")
    line = LineString([to_metric(point) for point in coordinates])
    if line.length == 0:
        report.errors.append(f"degenerate geometry: {label}")
        return None
    return line


def check_geometry(
    geojson: Any,
    services: Sequence[ServiceStops],
    platforms: dict[tuple[str, str], Point],
    positions: dict[str, list[float]],
    overrides: Overrides,
    report: Report,
) -> None:
    """One canonical feature per pair; platforms, same-service skipped stops and via hints."""
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        report.errors.append("segments.geojson must be a FeatureCollection")
        return
    if set(geojson) != {"type", "features"}:
        report.errors.append(
            "segments.geojson must contain only type and features (no crs)"
        )
    features = geojson.get("features")
    if not isinstance(features, list):
        report.errors.append("segments.geojson features must be an array")
        return
    expected = [
        (service.id, a, b)
        for service in services
        for a, b in station_pairs(service.station_ids, service.circular)
    ]
    identifiers = [feature_id(service_id, a, b) for service_id, a, b in expected]
    actual = [raw.get("id") if isinstance(raw, dict) else None for raw in features]
    actual_ids = {identifier for identifier in actual if isinstance(identifier, str)}
    if actual != [identifier for identifier in identifiers if identifier in actual_ids]:
        report.errors.append(
            "geojson feature ids must match canonical owner pair order (missing geometry or orphan feature)"
        )
    by_id: dict[str, Any] = {}
    for raw in features:
        if isinstance(raw, dict) and isinstance(raw.get("id"), str):
            if raw["id"] in by_id:
                report.errors.append(f"duplicate geometry feature {raw['id']}")
            by_id[raw["id"]] = raw
    representatives = {
        station_id: Point(to_metric(coordinate))
        for station_id, coordinate in positions.items()
    }
    lengths = {service.id: 0.0 for service in services}
    max_endpoint = max_detour = 0.0
    min_skipped = math.inf
    other_passes = 0
    for service_id, a, b in expected:
        label = feature_id(service_id, a, b)
        raw = by_id.get(label)
        if raw is None:
            continue
        if (
            set(raw) != {"type", "id", "properties", "geometry"}
            or raw.get("type") != "Feature"
        ):
            report.errors.append(f"{label} is not a GeoJSON Feature with v3 fields")
            continue
        if raw.get("properties") != {
            "featureId": label,
            "serviceId": service_id,
            "lineId": overrides.service(service_id).definition.line_ids[0],
            "from": a,
            "to": b,
        }:
            report.errors.append(f"properties mismatch on {label}")
        line = _feature_geometry(raw, label, report, overrides.dataset.output_bbox)
        start, end = platforms.get((service_id, a)), platforms.get((service_id, b))
        if line is None or start is None or end is None:
            continue
        gap = max(
            Point(line.coords[0]).distance(start), Point(line.coords[-1]).distance(end)
        )
        max_endpoint = max(max_endpoint, gap)
        if gap > config.ENDPOINT_MAX_DISTANCE_M:
            report.errors.append(f"{label} endpoint {gap:.1f} m from service platform")
        detour = rules.check_detour(
            label, line, start, end, overrides.detour_limit(service_id, a, b), report
        )
        max_detour = max(max_detour, detour)
        lengths[service_id] += line.length
        service_points = {
            sid: point for (svc, sid), point in platforms.items() if svc == service_id
        }
        min_skipped = min(
            min_skipped,
            rules.check_skipped_stops(label, line, (a, b), service_points, report),
        )
        other_passes += rules.count_other_passes(
            line,
            {
                sid: point
                for sid, point in representatives.items()
                if sid not in service_points
            },
        )
        service_override = overrides.service(service_id)
        pairs = station_pairs(service_override.station_ids, service_override.circular)
        if (a, b) not in pairs:
            report.errors.append(f"{label} is not an override pair")
            continue
        pair_index = pairs.index((a, b))
        hint = service_override.segment_ranges()[pair_index]
        for via in hint.via:
            if line.distance(Point(to_metric(via))) > config.ENDPOINT_MAX_DISTANCE_M:
                report.errors.append(f"{label} misses a committed via point")
        if hint.route:
            joints = [Point(to_metric(joint)) for joint in hint.route.joints]
            if any(
                line.distance(joint) > overrides.dataset.simplify_tolerance_m + 1.0
                for joint in joints
            ):
                report.errors.append(
                    f"{label} multi-line route misses a committed joint"
                )
            distances = [line.project(joint) for joint in joints]
            if any(a >= b for a, b in zip(distances, distances[1:], strict=False)):
                report.errors.append(
                    f"{label} multi-line route joints are out of order"
                )
    report.metrics.update(
        {
            "max_endpoint_distance_m": round(max_endpoint, 3),
            "max_detour_ratio": round(max_detour, 3),
            "min_skipped_stop_distance_m": round(min_skipped, 1),
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
    if set(manifest) != {"schemaVersion", "dataVersion", "updatedAt", "source"}:
        report.errors.append(
            "manifest.json must have exactly schemaVersion, dataVersion, updatedAt and source"
        )
    if type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 3:
        report.errors.append("manifest.schemaVersion must be 3")
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


def validate_dataset(dataset: Dataset, overrides: Overrides) -> Report:
    """Run all seventeen v3 rules without the raw N02 download."""
    report = Report()
    positions = check_stations(
        dataset.stations,
        official_station_order(overrides),
        report,
        overrides.dataset.output_bbox,
    )
    stations = dataset.stations if _is_object_list(dataset.stations) else []
    rules.check_registry_membership(
        [(str(raw.get("id")), str(raw.get("name"))) for raw in stations],
        overrides.registry,
        report,
        overrides.dataset.area,
    )
    services, platforms = check_services(dataset.services, positions, overrides, report)
    check_segments(dataset.segments, services, report)
    check_geometry(dataset.geojson, services, platforms, positions, overrides, report)
    if (
        _is_object_list(dataset.segments)
        and isinstance(dataset.geojson, dict)
        and _is_object_list(dataset.geojson.get("features"))
    ):
        lengths = rules.check_geometry_chains(
            dataset.segments, dataset.geojson["features"], services, report
        )
        check_composed_artifacts(
            dataset.segments, dataset.geojson["features"], overrides, platforms, report
        )
        for service in services:
            rules.check_service_length(
                service.id,
                lengths.get(service.id, 0.0),
                overrides.service(service.id).definition.length_ref,
                report,
            )
    start = overrides.dataset.start_station_id
    rules.check_connectivity(
        services,
        start,
        overrides.dataset.target_service_id,
        overrides.dataset.reviewed_disconnected_service_ids,
        report,
    )
    if _is_object_list(dataset.segments):
        rules.check_two_way_reachability(
            positions,
            [
                (str(segment.get("from")), str(segment.get("to")))
                for segment in dataset.segments
            ],
            start,
            report,
        )
    rules.check_start_not_endpoint(services, start, report)
    representatives = {
        station_id: Point(to_metric(coordinate))
        for station_id, coordinate in positions.items()
    }
    rules.check_platform_offsets(
        platforms, representatives, overrides.offset_exceptions, report
    )
    check_manifest(
        dataset.manifest, dataset.payloads, report, overrides.dataset.updated_at
    )
    documents = {
        config.STATIONS_FILE: dataset.stations,
        config.SERVICES_FILE: dataset.services,
        config.SEGMENTS_FILE: dataset.segments,
        config.SEGMENTS_GEOJSON_FILE: dataset.geojson,
    }
    for name, document in documents.items():
        payload = dataset.payloads.get(name, "")
        expected = (
            dumps_feature_collection(document)
            if name == config.SEGMENTS_GEOJSON_FILE
            and isinstance(document, dict)
            and isinstance(document.get("features"), list)
            else dumps_segments(document)
            if name == config.SEGMENTS_FILE and _is_object_list(document)
            else dumps_pretty(document)
        )
        if payload != expected:
            report.errors.append(f"{name} bytes are not the canonical v3 serialization")
        report.metrics[f"bytes[{name}]"] = len(payload.encode())
    if dataset.manifest_payload is not None:
        if dataset.manifest_payload != dumps_pretty(dataset.manifest):
            report.errors.append("manifest.json bytes are not canonical")
        report.metrics["bytes[manifest.json]"] = len(dataset.manifest_payload.encode())
    report.metrics["segments_geojson_bytes"] = dataset.geojson_bytes
    files = {
        **dataset.payloads,
        config.MANIFEST_FILE: dataset.manifest_payload
        or dumps_pretty(dataset.manifest),
    }
    sizes = size_report(
        files,
        int(report.metrics.get("geometry_reference_count", 0)),
        int(report.metrics.get("max_geometry_chain_length", 0)),
    )
    # Dataset.geojson_bytes reflects even malformed or padded payloads.
    sizes[f"bytes[{config.SEGMENTS_GEOJSON_FILE}]"] = dataset.geojson_bytes
    report.metrics.update(sizes)
    limits = (
        overrides.dataset.budgets or BUDGET_PROFILES[overrides.dataset.budget_profile]
    )
    if dataset.geojson_bytes > limits["geojsonRaw"]:
        report.errors.append(f"segments.geojson is {dataset.geojson_bytes} bytes")
    report.errors.extend(budget_errors(sizes, limits))
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
        f"budgetProfile={overrides.dataset.budget_profile}, "
        f"geojson<={overrides.dataset.budgets['geojsonRaw']} raw / "
        f"{overrides.dataset.budgets['geojsonGzip']} gzip bytes"
    )
    for error in report.errors:
        print(f"FAIL {error}")
    print("OK" if report.ok else f"{len(report.errors)} check(s) failed")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
