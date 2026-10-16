"""Planning estimate from selected N02 sections, not a final routed product bundle."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from build_catalog import load_rows, station_points
from pyproj import Transformer
from shapely import transform
from shapely.geometry import MultiPoint, mapping, shape


def serialized_size(value: dict) -> dict[str, int]:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return {
        "raw_bytes": len(data),
        "gzip_bytes": len(gzip.compress(data, compresslevel=9, mtime=0)),
    }


def estimate() -> dict:
    rows, _ = load_rows()
    points, missing = station_points(rows)
    assert not missing, missing
    pairs = {
        (r["n02_operator"], line) for r in rows for line in r["n02_line"].split(";")
    }
    forward = Transformer.from_crs("EPSG:6668", "EPSG:6677", always_xy=True).transform
    backward = Transformer.from_crs("EPSG:6677", "EPSG:4326", always_xy=True).transform
    hull = transform(
        MultiPoint(list(points.values())).convex_hull, forward, interleaved=False
    ).buffer(5000)
    raw = json.loads(
        Path("N02-25_GML/UTF-8/N02-25_RailroadSection.geojson").read_text()
    )
    selected = []
    for f in raw["features"]:
        p = f["properties"]
        if (p["N02_004"], p["N02_003"]) not in pairs or p["N02_002"] == "1":
            continue
        g = transform(shape(f["geometry"]), forward, interleaved=False)
        selected.append((p, g))
    results = {}
    for mode in ("all-matching-lines", "station-hull-plus-5km"):
        features = []
        vertices = 0
        for p, g in selected:
            if mode != "all-matching-lines" and not g.intersects(hull):
                continue
            # Retain whole intersecting sections; this deliberately overincludes boundary sections.
            line = transform(
                g.simplify(1.0, preserve_topology=False), backward, interleaved=False
            )
            geom = mapping(line)
            coords = [[round(x, 6), round(y, 6)] for x, y in geom["coordinates"]]
            vertices += len(coords)
            features.append(
                {
                    "type": "Feature",
                    "id": f"estimate-{len(features)}",
                    "properties": {"operator": p["N02_004"], "line": p["N02_003"]},
                    "geometry": {"type": "LineString", "coordinates": coords},
                }
            )
        results[mode] = {
            **serialized_size({"type": "FeatureCollection", "features": features}),
            "features": len(features),
            "coordinates": vertices,
        }
    shipped = {}
    for p in sorted(
        [p for p in Path("public/data").iterdir() if p.suffix in (".json", ".geojson")]
    ):
        data = p.read_bytes()
        shipped[p.name] = {
            "raw_bytes": len(data),
            "gzip_bytes": len(gzip.compress(data, compresslevel=9, mtime=0)),
        }
    return {
        "simplification_m": 1,
        "coordinate_decimals": 6,
        "crs": "EPSG:6677",
        "method": "N02 operator/line selection; excludes Shinkansen; whole raw sections; no routing or track deduplication",
        "limitations": [
            "All-matching-lines extends beyond the allowed area and includes tracks not selected by services.",
            "Hull envelope is a planning proxy, not exact service routing; excludes some detours if outside envelope.",
            "Feature properties and partitioning differ from export; final geometry/reference budgets remain to be measured.",
            "No browser rendering, label-density or device timing benchmark was run.",
        ],
        "estimates": results,
        "shipped_files": shipped,
        "capital_region_geometry_budget": {"raw_bytes": 1572864, "gzip_bytes": 460800},
        "capital_region_total_budget": {"raw_bytes": 3145728, "gzip_bytes": 921600},
    }


if __name__ == "__main__":
    result = estimate()
    Path(".claude/docs/research/tokyo-suburban-r2-size.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(json.dumps(result, indent=2))
