"""Build ``public/data/*`` from raw N02 data plus ``data/overrides``.

Usage: ``uv run python -m scripts.data_pipeline.build [--raw-dir ...] [--out-dir ...]``

The build routes every service in ``services.json`` (loops with
:func:`route_loop`, open chains with :func:`route_path`) and then exports the
v1 contract, which carries only the target service.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point

from scripts.data_pipeline import config, export
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.n02 import N02Source, PlatformCandidate, TrackSection
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.overrides import Overrides, ServiceOverrides, load_overrides
from scripts.data_pipeline.registry import Registry
from scripts.data_pipeline.routing import (
    PairRoute,
    RoutedService,
    RoutingError,
    route_loop,
    route_path,
)

_SOURCE_TO_METRIC = Transformer.from_crs(
    config.SOURCE_CRS, config.METRIC_CRS, always_xy=True
)


@dataclass(frozen=True)
class ServiceBuild:
    service: ServiceOverrides
    segment_lines: tuple[str, ...]  # N02 line of each +1 stop pair
    routed: RoutedService


@dataclass(frozen=True)
class BuildResult:
    files: dict[str, str]  # file name -> text payload
    services: dict[str, ServiceBuild]  # services.json order


def stop_lines(segment_lines: Sequence[str], circular: bool) -> list[set[str]]:
    """N02 lines whose platforms may represent each stop: its adjacent pairs.

    A loop stop touches pairs i-1 and i (wrapping); an open chain's ends touch
    only their one pair.
    """
    count = len(segment_lines) if circular else len(segment_lines) + 1
    lines: list[set[str]] = []
    for index in range(count):
        adjacent: set[str] = set()
        if circular or index > 0:
            adjacent.add(segment_lines[index - 1])
        if circular or index < count - 1:
            adjacent.add(segment_lines[index])
        lines.append(adjacent)
    return lines


def group_candidates(
    service: ServiceOverrides,
    registry: Registry,
    candidates: Sequence[PlatformCandidate],
    lines_per_stop: Sequence[set[str]],
) -> list[list[PlatformCandidate]]:
    """Candidates per stop: name, line and selector match, deduplicated.

    Homonym guard: the platforms of one stop must share one N02 group code
    unless the stop's platform selector pins a group or station code.
    """
    stations = registry.by_id()
    grouped: list[list[PlatformCandidate]] = []
    for stop, lines in zip(service.stops, lines_per_stop, strict=True):
        station = stations[stop.station_id]
        seen: set[tuple[float, float]] = set()
        options: list[PlatformCandidate] = []
        for candidate in candidates:
            if (
                candidate.match_name != station.match_name
                or candidate.n02_line not in lines
                or not stop.platform_selector.matches(candidate)
            ):
                continue
            key = (round(candidate.midpoint.x, 3), round(candidate.midpoint.y, 3))
            if key in seen:
                continue
            seen.add(key)
            options.append(candidate)
        if not options:
            raise RoutingError(
                f"no N02 platform for {station.name} ({service.id}) on {sorted(lines)}"
            )
        groups = sorted({option.group_code for option in options})
        if len(groups) > 1 and not stop.platform_selector.pins_group:
            raise RoutingError(
                f"ambiguous N02 platforms for {station.name} ({service.id}): groups "
                f"{groups}; add a platform_selector to stops.csv"
            )
        grouped.append(options)
    return grouped


def filtered_network(
    sections: Sequence[TrackSection], section_filter: SectionFilter, label: str
) -> TrackNetwork:
    """Track graph of one N02 line after applying a reviewed section filter."""
    keys = {section.key for section in sections}
    stale = sorted((section_filter.allow | section_filter.deny) - keys)
    if stale:
        raise RoutingError(f"{label}: section keys not found near the service {stale}")
    kept = [
        section.geometry for section in sections if section_filter.admits(section.key)
    ]
    if not kept:
        raise RoutingError(f"{label}: the section filter removes every section")
    return TrackNetwork(kept)


def to_metric_point(lon_lat: tuple[float, float]) -> Point:
    x, y = _SOURCE_TO_METRIC.transform(lon_lat[0], lon_lat[1])
    return Point(float(x), float(y))


def route_service(
    source: N02Source, service: ServiceOverrides, registry: Registry
) -> ServiceBuild:
    """Choose platforms and trace every +1 stop pair of one service."""
    ranges = service.segment_ranges()
    segment_lines = tuple(item.n02_line for item in ranges)
    stations = registry.by_id()
    candidates = source.platform_candidates(
        [stations[station_id].match_name for station_id in service.station_ids],
        set(segment_lines),
    )
    grouped = group_candidates(
        service, registry, candidates, stop_lines(segment_lines, service.circular)
    )
    sections = source.track_sections(
        segment_lines, [candidate.midpoint for candidate in candidates]
    )
    # Graph cache keyed by the constraints, not just the line.
    networks: dict[tuple[str, SectionFilter], TrackNetwork] = {}
    routes: list[PairRoute] = []
    for item in ranges:
        section_filter = service.section_filter(item.n02_line)
        key = (item.n02_line, section_filter)
        if key not in networks:
            networks[key] = filtered_network(
                sections[item.n02_line], section_filter, f"{service.id}/{item.n02_line}"
            )
        via = tuple(to_metric_point(point) for point in item.via)
        routes.append(PairRoute(network=networks[key], via=via))
    route = route_loop if service.circular else route_path
    return ServiceBuild(
        service=service, segment_lines=segment_lines, routed=route(grouped, routes)
    )


def route_network(source: N02Source, overrides: Overrides) -> dict[str, ServiceBuild]:
    return {
        service.id: route_service(source, service, overrides.registry)
        for service in overrides.services
    }


def platform_points(builds: Mapping[str, ServiceBuild]) -> dict[tuple[str, str], Point]:
    """(service id, station id) -> chosen platform midpoint."""
    points: dict[tuple[str, str], Point] = {}
    for service_id, item in builds.items():
        for station_id, candidate in zip(
            item.service.station_ids, item.routed.chosen, strict=True
        ):
            points[(service_id, station_id)] = candidate.midpoint
    return points


def representative_points(
    overrides: Overrides, builds: Mapping[str, ServiceBuild]
) -> dict[str, Point]:
    """Station point = platform point of its registry-selected service."""
    platforms = platform_points(builds)
    return {
        station.id: platforms[(station.representative_service_id, station.id)]
        for station in overrides.registry.stations
    }


def build(raw_dir: Path, overrides_dir: Path) -> BuildResult:
    overrides = load_overrides(overrides_dir)
    source = N02Source(raw_dir, operator=overrides.dataset.n02_operator)
    builds = route_network(source, overrides)
    target = builds[overrides.dataset.target_service_id]
    files = export.build_v1_files(
        overrides,
        representative_points(overrides, builds),
        [path.geometry for path in target.routed.paths],
    )
    return BuildResult(files=files, services=builds)


def describe(result: BuildResult) -> str:
    """Human-readable per-service, per-pair diagnostics for the build log."""
    rows: list[str] = []
    for service_id, item in result.services.items():
        ids = item.service.station_ids
        count = len(ids)
        rows.append(f"[{service_id}] {'loop' if item.service.circular else 'chain'}")
        rows.append(
            "i  from -> to  | n02 line | track m | snap m (from/to) | platform (line/code)"
        )
        for i, path in enumerate(item.routed.paths):
            chosen = item.routed.chosen[i]
            rows.append(
                f"{i:2d} {ids[i]} -> {ids[(i + 1) % count]} | "
                f"{item.segment_lines[i]} | {path.length:7.1f} | "
                f"{path.start_offset:.2f}/{path.end_offset:.2f} | "
                f"{chosen.n02_line}/{chosen.station_code}"
            )
        total_km = sum(path.length for path in item.routed.paths) / 1000
        rows.append(f"{service_id} track length: {total_km:.3f} km")
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
        print(describe(result))
        for name in sorted(result.files):
            size = (args.out_dir / name).stat().st_size
            print(f"wrote {args.out_dir / name} ({size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
