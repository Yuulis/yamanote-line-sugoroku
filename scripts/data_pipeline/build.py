"""Build ``public/data/*`` from raw N02 data plus ``data/overrides``.

Usage: ``uv run python -m scripts.data_pipeline.build [--raw-dir ...] [--out-dir ...]``
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from scripts.data_pipeline import config, export
from scripts.data_pipeline.n02 import (
    PlatformCandidate,
    load_platform_candidates,
    load_sections,
)
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.routing import RoutedLoop, RoutingError, route_loop


@dataclass(frozen=True)
class BuildResult:
    files: dict[str, str]  # file name -> text payload
    loop: RoutedLoop
    segment_lines: tuple[str, ...]


def station_lines(segment_lines: Sequence[str]) -> list[set[str]]:
    """Lines whose platforms may represent S[i]: lines of E[i-1] and E[i]."""
    count = len(segment_lines)
    return [{segment_lines[i - 1], segment_lines[i]} for i in range(count)]


def group_candidates(
    overrides: Overrides,
    candidates: Sequence[PlatformCandidate],
    lines_per_station: Sequence[set[str]],
) -> list[list[PlatformCandidate]]:
    """Candidates per station, deduplicating identical platform midpoints."""
    grouped: list[list[PlatformCandidate]] = []
    for station, lines in zip(overrides.stations, lines_per_station, strict=True):
        seen: set[tuple[float, float]] = set()
        options: list[PlatformCandidate] = []
        for candidate in candidates:
            if (
                candidate.station_name != station.name
                or candidate.n02_line not in lines
            ):
                continue
            key = (round(candidate.midpoint.x, 3), round(candidate.midpoint.y, 3))
            if key in seen:
                continue
            seen.add(key)
            options.append(candidate)
        if not options:
            raise RoutingError(f"no N02 platform for {station.name} on {sorted(lines)}")
        grouped.append(options)
    return grouped


def build(raw_dir: Path, overrides_dir: Path) -> BuildResult:
    overrides = load_overrides(overrides_dir)
    operator = overrides.service.n02_operator
    segment_lines = overrides.segment_lines()
    lines_per_station = station_lines(segment_lines)

    candidates = load_platform_candidates(
        raw_dir,
        operator=operator,
        names=[station.name for station in overrides.stations],
        lines=set(segment_lines),
    )
    grouped = group_candidates(overrides, candidates, lines_per_station)
    sections = load_sections(
        raw_dir,
        operator=operator,
        lines=segment_lines,
        around=[candidate.midpoint for candidate in candidates],
    )
    networks = {line: TrackNetwork(lines) for line, lines in sections.items()}
    loop = route_loop(grouped, segment_lines, networks)

    station_ids = overrides.station_ids
    service_id = overrides.service.id
    stations_doc = export.build_stations(
        overrides.stations, [candidate.midpoint for candidate in loop.chosen]
    )
    services_doc = export.build_services(overrides.service, station_ids)
    segments_doc = export.build_segments(service_id, station_ids)
    features_doc = export.build_segment_features(
        segments_doc, [path.geometry for path in loop.paths]
    )

    files = {
        config.STATIONS_FILE: export.dumps_pretty(stations_doc),
        config.SERVICES_FILE: export.dumps_pretty(services_doc),
        config.SEGMENTS_FILE: export.dumps_pretty(segments_doc),
        config.SEGMENTS_GEOJSON_FILE: export.dumps_feature_collection(features_doc),
    }
    manifest = export.build_manifest(export.manifest_inputs(files))
    files[config.MANIFEST_FILE] = export.dumps_pretty(manifest)
    return BuildResult(files=files, loop=loop, segment_lines=segment_lines)


def describe(result: BuildResult, station_ids: Sequence[str]) -> str:
    """Human-readable per-segment diagnostics for the build log."""
    count = len(station_ids)
    rows = [
        "i  from -> to  | n02 line | track m | snap m (from/to) | platform (line/code)"
    ]
    for i, path in enumerate(result.loop.paths):
        chosen = result.loop.chosen[i]
        rows.append(
            f"{i:2d} {station_ids[i]} -> {station_ids[(i + 1) % count]} | "
            f"{result.segment_lines[i]} | {path.length:7.1f} | "
            f"{path.start_offset:.2f}/{path.end_offset:.2f} | "
            f"{chosen.n02_line}/{chosen.station_code}"
        )
    total_km = sum(path.length for path in result.loop.paths) / 1000
    rows.append(f"loop track length: {total_km:.3f} km")
    return "\n".join(rows)


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=config.DEFAULT_RAW_DIR)
    parser.add_argument(
        "--overrides-dir", type=Path, default=config.DEFAULT_OVERRIDES_DIR
    )
    parser.add_argument("--out-dir", type=Path, default=config.DEFAULT_OUT_DIR)
    parser.add_argument("--quiet", action="store_true", help="suppress diagnostics")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    result = build(args.raw_dir, args.overrides_dir)
    export.write_outputs(args.out_dir, result.files)
    if not args.quiet:
        overrides = load_overrides(args.overrides_dir)
        print(describe(result, overrides.station_ids))
        for name in sorted(result.files):
            size = (args.out_dir / name).stat().st_size
            print(f"wrote {args.out_dir / name} ({size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
