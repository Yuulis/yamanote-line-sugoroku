"""Turn routed geometry into the public game data documents (deterministic)."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import Overrides, ServiceDefinition
from scripts.data_pipeline.registry import RegistryStation
from scripts.data_pipeline.topology import station_order

Coordinate = list[float]

_TO_OUTPUT = Transformer.from_crs(config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True)


def to_lon_lat(x: float, y: float) -> Coordinate:
    lon, lat = _TO_OUTPUT.transform(x, y)
    return [
        round(float(lon), config.COORDINATE_DECIMALS),
        round(float(lat), config.COORDINATE_DECIMALS),
    ]


def line_to_lon_lat(line: LineString) -> list[Coordinate]:
    """Simplify in metres, convert to lon/lat, round, and drop repeated points."""
    simplified = line.simplify(config.SIMPLIFY_TOLERANCE_M, preserve_topology=False)
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
    definition: ServiceDefinition, operator: str, station_ids: Sequence[str]
) -> list[dict[str, Any]]:
    """v1 service document: the target service only."""
    return [
        {
            "id": definition.id,
            "name": definition.name,
            "operator": operator,
            "stationIds": list(station_ids),
            "circular": definition.circular,
            "color": definition.color,
        }
    ]


def build_segments(service_id: str, station_ids: Sequence[str]) -> list[dict[str, Any]]:
    count = len(station_ids)
    segments = []
    for index, from_id in enumerate(station_ids):
        to_id = station_ids[(index + 1) % count]
        identifier = segment_id(service_id, from_id, to_id)
        segments.append(
            {
                "id": identifier,
                "serviceId": service_id,
                "from": from_id,
                "to": to_id,
                "geometryFeatureId": identifier,
            }
        )
    return segments


def build_segment_features(
    segments: Sequence[Mapping[str, Any]], lines: Sequence[LineString]
) -> dict[str, Any]:
    features = [
        {
            "type": "Feature",
            "id": segment["id"],
            "properties": {
                "segmentId": segment["id"],
                "serviceId": segment["serviceId"],
                "from": segment["from"],
                "to": segment["to"],
            },
            "geometry": {"type": "LineString", "coordinates": line_to_lon_lat(line)},
        }
        for segment, line in zip(segments, lines, strict=True)
    ]
    return {"type": "FeatureCollection", "features": features}


def dumps_pretty(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


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
        "dataVersion": data_version(payloads),
        "updatedAt": updated_at,
        "source": dict(config.MANIFEST_SOURCE),
    }


class ExportError(ValueError):
    """Raised when routed data cannot be expressed in the output contract."""


def build_v1_files(
    overrides: Overrides,
    station_points: Mapping[str, Point],
    target_lines: Sequence[LineString],
) -> dict[str, str]:
    """The five v1 files: the target loop only, one feature per segment.

    The v1 contract has no per-service platforms, direction labels or endpoint
    kinds, so it cannot carry linear services; that is the v2 contract.
    """
    target = overrides.target
    if tuple(service.id for service in overrides.services) != (target.id,):
        raise ExportError(
            "the v1 data contract carries only the target service; multi-service "
            "output needs the v2 contract"
        )
    station_ids = target.station_ids
    registry = overrides.registry.by_id()
    stations = [registry[station_id] for station_id in station_order([station_ids])]
    segments_doc = build_segments(target.id, station_ids)
    files = {
        config.STATIONS_FILE: dumps_pretty(build_stations(stations, station_points)),
        config.SERVICES_FILE: dumps_pretty(
            build_services(target.definition, overrides.dataset.operator, station_ids)
        ),
        config.SEGMENTS_FILE: dumps_pretty(segments_doc),
        config.SEGMENTS_GEOJSON_FILE: dumps_feature_collection(
            build_segment_features(segments_doc, target_lines)
        ),
    }
    manifest = build_manifest(manifest_inputs(files), overrides.dataset.updated_at)
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
    names = sorted(files, key=lambda name: (name == config.MANIFEST_FILE, name))
    for name in names:
        write_text(out_dir / name, files[name])
