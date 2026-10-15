"""Compare 1/3/5 m simplification on routed inputs without writing game data.

Usage: uv run python -m scripts.data_pipeline.simplification --out-file /tmp/comparison.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString

from scripts.data_pipeline import config, export
from scripts.data_pipeline.budgets import budget_errors, file_size_report
from scripts.data_pipeline.build import (
    generate_build,
    platform_points,
    representative_points,
)
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.topology import station_pairs


def compare(raw_dir: Path, overrides_dir: Path) -> dict[str, object]:
    overrides = load_overrides(overrides_dir)
    result = generate_build(raw_dir, overrides)
    paths = {
        identifier: [path.geometry for path in item.routed.paths]
        for identifier, item in result.services.items()
    }
    transformer = Transformer.from_crs(
        config.OUTPUT_CRS, config.METRIC_CRS, always_xy=True
    )
    raw_by_id = {
        export.feature_id(identifier, a, b): path
        for identifier, item in result.services.items()
        for (a, b), path, recipe in zip(
            station_pairs(item.service.station_ids, item.service.circular),
            paths[identifier],
            item.service.segment_ranges(),
            strict=True,
        )
        if not recipe.compose
    }
    comparisons = []
    for tolerance in (1.0, 3.0, 5.0):
        files = export.build_files(
            overrides,
            representative_points(overrides, result.services),
            platform_points(result.services),
            paths,
            tolerance,
        )
        features = json.loads(files[config.SEGMENTS_GEOJSON_FILE])["features"]
        geometries = {
            feature["id"]: LineString(
                [
                    transformer.transform(*point)
                    for point in feature["geometry"]["coordinates"]
                ]
            )
            for feature in features
        }
        sizes = file_size_report(files)
        comparisons.append(
            {
                "tolerance_m": tolerance,
                "metrics": sizes,
                "coordinate_count": sum(
                    len(geometry.coords) for geometry in geometries.values()
                ),
                "max_hausdorff_distance_m": round(
                    max(
                        (
                            geometry.hausdorff_distance(raw_by_id[identifier])
                            for identifier, geometry in geometries.items()
                        ),
                        default=0.0,
                    ),
                    6,
                ),
                "budget_errors": budget_errors(sizes, overrides.dataset.budgets),
                "equals_default_output": files == result.files,
            }
        )
    return {
        "budget_profile": overrides.dataset.budget_profile,
        "default_tolerance_m": overrides.dataset.simplify_tolerance_m,
        "comparisons": comparisons,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=config.DEFAULT_RAW_DIR)
    parser.add_argument(
        "--overrides-dir", type=Path, default=config.DEFAULT_OVERRIDES_DIR
    )
    parser.add_argument("--out-file", type=Path, required=True)
    args = parser.parse_args()
    report = compare(args.raw_dir, args.overrides_dir)
    args.out_file.parent.mkdir(parents=True, exist_ok=True)
    args.out_file.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
