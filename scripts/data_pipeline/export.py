"""Turn routed geometry into the public game data documents (deterministic)."""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config
from scripts.data_pipeline.composition import compose_chains, exact_chain_coordinates
from scripts.data_pipeline.overrides import (
    DatasetOverride,
    Overrides,
    ServiceOverrides,
)
from scripts.data_pipeline.registry import RegistryStation
from scripts.data_pipeline.topology import directed_pairs, station_order, station_pairs

Coordinate = list[float]

_TO_OUTPUT = Transformer.from_crs(config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True)


def to_lon_lat(x: float, y: float) -> Coordinate:
    lon, lat = _TO_OUTPUT.transform(x, y)
    return [
        round(float(lon), config.COORDINATE_DECIMALS),
        round(float(lat), config.COORDINATE_DECIMALS),
    ]


def line_to_lon_lat(
    line: LineString, tolerance_m: float = config.SIMPLIFY_TOLERANCE_M
) -> list[Coordinate]:
    """Simplify in metres, convert to lon/lat, round, and drop repeated points."""
    simplified = line.simplify(tolerance_m, preserve_topology=False)
    coords: list[Coordinate] = []
    for xy in simplified.coords:
        coordinate = to_lon_lat(xy[0], xy[1])
        if coords and coords[-1] == coordinate:
            continue
        coords.append(coordinate)
    if len(coords) < 2:
        raise ValueError("segment geometry collapsed to a single point")
    return coords


def segment_id(service_id: str, from_id: str, to_id: str) -> str:
    return f"{service_id}:{from_id}:{to_id}"


def build_stations(
    stations: Sequence[RegistryStation], points: Mapping[str, Point]
) -> list[dict[str, Any]]:
    """Station documents in the given order; ``points`` = representative points."""
    return [
        {
            "id": station.id,
            "name": station.name,
            "coordinates": to_lon_lat(points[station.id].x, points[station.id].y),
        }
        for station in stations
    ]


def build_services(
    services: Sequence[ServiceOverrides],
    dataset: DatasetOverride | str,
    platforms: Mapping[tuple[str, str], Point],
) -> list[dict[str, Any]]:
    """v3 service metadata and the platform point of every stop."""
    documents: list[dict[str, Any]] = []
    for service in services:
        definition = service.definition
        document = {
            "id": service.id,
            "name": definition.name,
            "operator": (
                service.effective_operator(dataset)
                if isinstance(dataset, DatasetOverride)
                else dataset
            ),
            "kind": definition.kind,
            "lineIds": list(definition.line_ids),
            "stationIds": list(service.station_ids),
            "circular": definition.circular,
            "color": definition.color,
            "directionLabels": {
                "forward": definition.direction_labels.forward,
                "backward": definition.direction_labels.backward,
            },
            "platformCoordinates": {
                station_id: to_lon_lat(
                    platforms[(service.id, station_id)].x,
                    platforms[(service.id, station_id)].y,
                )
                for station_id in service.station_ids
            },
        }
        if definition.endpoints is not None:
            document["endpoints"] = {
                "first": definition.endpoints.first,
                "last": definition.endpoints.last,
            }
        documents.append(document)
    return documents


def feature_id(service_id: str, from_id: str, to_id: str) -> str:
    """Canonical +1 pair identity shared by both directed segments."""
    return f"{service_id}:{from_id}~{to_id}"


def build_segments(
    service_id: str,
    station_ids: Sequence[str],
    circular: bool,
    target_service_id: str,
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    feature_by_direction: dict[tuple[str, str], str] = {}
    for origin, destination in station_pairs(station_ids, circular):
        feature = feature_id(service_id, origin, destination)
        feature_by_direction[(origin, destination)] = feature
        feature_by_direction[(destination, origin)] = feature
    for from_id, to_id in directed_pairs(
        station_ids,
        circular,
        service_id=service_id,
        target_service_id=target_service_id,
    ):
        segments.append(
            {
                "id": segment_id(service_id, from_id, to_id),
                "serviceId": service_id,
                "from": from_id,
                "to": to_id,
                "geometryFeatureIds": [feature_by_direction[(from_id, to_id)]],
            }
        )
    return segments


def build_segment_features(
    segments: Sequence[Mapping[str, Any]],
    lines: Sequence[LineString],
    line_id: str,
    tolerance_m: float = config.SIMPLIFY_TOLERANCE_M,
) -> dict[str, Any]:
    canonical: list[Mapping[str, Any]] = []
    seen: set[str] = set()
    for segment in segments:
        identifier = segment["geometryFeatureIds"][0]
        if identifier not in seen:
            seen.add(identifier)
            canonical.append(segment)
    features = [
        {
            "type": "Feature",
            "id": segment["geometryFeatureIds"][0],
            "properties": {
                "featureId": segment["geometryFeatureIds"][0],
                "serviceId": segment["serviceId"],
                "lineId": line_id,
                "from": segment["from"],
                "to": segment["to"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": line_to_lon_lat(line, tolerance_m),
            },
        }
        for segment, line in zip(canonical, lines, strict=True)
    ]
    return {"type": "FeatureCollection", "features": features}


def dumps_pretty(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def dumps_segments(segments: Sequence[Mapping[str, Any]]) -> str:
    """One compact directed segment per line, preserving travel/lottery order."""
    return (
        "[\n"
        + ",\n".join(
            json.dumps(segment, ensure_ascii=False, separators=(",", ":"))
            for segment in segments
        )
        + "\n]\n"
    )


def dumps_feature_collection(collection: Mapping[str, Any]) -> str:
    """One compact feature per line: small, yet readable in a git diff."""
    lines = [
        json.dumps(feature, ensure_ascii=False, separators=(",", ":"))
        for feature in collection["features"]
    ]
    body = ",\n".join(lines)
    return '{"type":"FeatureCollection","features":[\n' + body + "\n]}\n"


GAME_DATA_FILES = (
    config.STATIONS_FILE,
    config.SERVICES_FILE,
    config.SEGMENTS_FILE,
    config.SEGMENTS_GEOJSON_FILE,
)


def manifest_inputs(files: Mapping[str, str]) -> list[str]:
    """Payloads hashed into ``dataVersion``: the game data files, by file name."""
    return [files[name] for name in sorted(GAME_DATA_FILES)]


def data_version(payloads: Sequence[str]) -> str:
    """Data version = content hash of the game data, so it never needs a clock."""
    digest = hashlib.sha256()
    for payload in payloads:
        digest.update(payload.encode("utf-8"))
    return f"{config.DATA_VERSION_PREFIX}-{digest.hexdigest()[:12]}"


def build_manifest(payloads: Sequence[str], updated_at: str) -> dict[str, Any]:
    """``updated_at`` comes from the committed override and is deliberately not
    hashed: ``dataVersion`` identifies content, the date only records when the
    data was last refreshed."""
    return {
        "schemaVersion": 3,
        "dataVersion": data_version(payloads),
        "updatedAt": updated_at,
        "source": dict(config.MANIFEST_SOURCE),
    }


def build_files(
    overrides: Overrides,
    station_points: Mapping[str, Point],
    platforms: Mapping[tuple[str, str], Point],
    service_lines: Mapping[str, Sequence[LineString]],
    simplify_tolerance_m: float | None = None,
) -> dict[str, str]:
    """The five v3 files, in canonical service / station / pair order."""
    registry = overrides.registry.by_id()
    order = station_order(service.station_ids for service in overrides.services)
    stations = [registry[station_id] for station_id in order]
    segments_doc: list[dict[str, Any]] = []
    features: list[dict[str, Any]] = []
    tolerance = (
        overrides.dataset.simplify_tolerance_m
        if simplify_tolerance_m is None
        else simplify_tolerance_m
    )
    if (
        not isinstance(tolerance, int | float)
        or isinstance(tolerance, bool)
        or not math.isfinite(tolerance)
        or tolerance <= 0
    ):
        raise ValueError("simplification tolerance must be finite and positive")
    owned = {}
    for service in overrides.services:
        pairs = station_pairs(service.station_ids, service.circular)
        for (a, b), item, line in zip(
            pairs, service.segment_ranges(), service_lines[service.id], strict=True
        ):
            if item.compose:
                continue
            segment = build_segments(
                service.id,
                (a, b),
                False,
                overrides.dataset.directed_segment_target_service_id,
            )[0]
            feature = build_segment_features(
                [segment], [line], service.definition.line_ids[0], tolerance
            )["features"][0]
            features.append(feature)
            owned[(service.id, a, b)] = feature["id"]
    chains = compose_chains(overrides, owned)
    by_id = {feature["id"]: feature for feature in features}
    for service in overrides.services:
        segments = build_segments(
            service.id,
            service.station_ids,
            service.circular,
            overrides.dataset.directed_segment_target_service_id,
        )
        for segment in segments:
            key = (service.id, segment["from"], segment["to"])
            chain = chains.get(key)
            segment["geometryFeatureIds"] = (
                chain
                if chain is not None
                else list(
                    reversed(chains[(service.id, segment["to"], segment["from"])])
                )
            )
            exact_chain_coordinates(
                segment["geometryFeatureIds"], by_id, segment["from"]
            )
        segments_doc.extend(segments)
    files = {
        config.STATIONS_FILE: dumps_pretty(build_stations(stations, station_points)),
        config.SERVICES_FILE: dumps_pretty(
            {
                "lines": [
                    {"id": line.id, "name": line.name, "color": line.color}
                    for line in overrides.lines
                ],
                "services": build_services(
                    overrides.services, overrides.dataset, platforms
                ),
            }
        ),
        config.SEGMENTS_FILE: dumps_segments(segments_doc),
        config.SEGMENTS_GEOJSON_FILE: dumps_feature_collection(
            {"type": "FeatureCollection", "features": features}
        ),
    }
    manifest = build_manifest(manifest_inputs(files), overrides.dataset.updated_at)
    if overrides.dataset.validation_profile == "stage":
        # The existing browser contract rejects this schema, even if copied by hand.
        manifest.update(
            schemaVersion="3-stage",
            validationProfile="stage",
            stageStartStationId=overrides.dataset.stage_start_station_id,
        )
    files[config.MANIFEST_FILE] = dumps_pretty(manifest)
    return files


def write_text(path: Path, text: str) -> None:
    """Write via a temporary sibling and an atomic rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(text.encode("utf-8"))
    os.replace(temporary, path)


def write_outputs(out_dir: Path, files: Mapping[str, str]) -> None:
    """Write the game data first and the manifest last, so a failed build
    never leaves a manifest that points at data which was not written."""
    manifest = json.loads(files[config.MANIFEST_FILE])
    if (
        manifest.get("validationProfile") == "stage"
        and out_dir.resolve() == config.DEFAULT_OUT_DIR.resolve()
    ):
        raise ValueError("stage output cannot be written to public/data")
    names = sorted(files, key=lambda name: (name == config.MANIFEST_FILE, name))
    for name in names:
        write_text(out_dir / name, files[name])
