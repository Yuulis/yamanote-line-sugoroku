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
from scripts.data_pipeline.overrides import ServiceOverride, StationOverride

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
    stations: Sequence[StationOverride], points: Sequence[Point]
) -> list[dict[str, Any]]:
    return [
        {
            "id": station.id,
            "name": station.name,
            "coordinates": to_lon_lat(point.x, point.y),
        }
        for station, point in zip(stations, points, strict=True)
    ]


def build_services(
    service: ServiceOverride, station_ids: Sequence[str]
) -> list[dict[str, Any]]:
    return [
        {
            "id": service.id,
            "name": service.name,
            "operator": service.operator,
            "stationIds": list(station_ids),
            "circular": service.circular,
            "color": service.color,
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


def build_manifest(payloads: Sequence[str]) -> dict[str, Any]:
    """Data version = content hash of the game data, so it never needs a clock."""
    digest = hashlib.sha256()
    for payload in payloads:
        digest.update(payload.encode("utf-8"))
    return {
        "dataVersion": f"{config.DATA_VERSION_PREFIX}-{digest.hexdigest()[:12]}",
        "source": dict(config.MANIFEST_SOURCE),
    }


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
