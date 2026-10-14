"""Build ``public/data/*`` from raw N02 data plus ``data/overrides``.

Usage: ``uv run python -m scripts.data_pipeline.build [--raw-dir ...] [--out-dir ...]``

The build routes every service in ``services.json`` (loops with
:func:`route_loop`, open chains with :func:`route_path`) and then exports the
v3 contract with shared station ids and one-element owned geometry chains.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point

from scripts.data_pipeline import config, export, rules
from scripts.data_pipeline.budgets import check_file_budgets, file_size_report
from scripts.data_pipeline.composition import dependency_order
from scripts.data_pipeline.composition_build import (
    check_inherited_route_anchors,
    composed_pairs,
    inherited_candidates,
)
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.n02 import N02Source, PlatformCandidate, TrackSection
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.overrides import (
    LineRange,
    Overrides,
    ServiceOverrides,
    load_overrides,
)
from scripts.data_pipeline.registry import BoundaryTruncation, Registry, check_scope
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
    boundaries: tuple[BoundaryTruncation, ...] = ()


@dataclass(frozen=True)
class BuildResult:
    files: dict[str, str]  # file name -> text payload
    services: dict[str, ServiceBuild]  # services.json order


def stop_lines(
    segment_lines: Sequence[str | LineRange], circular: bool
) -> list[set[str]]:
    """N02 lines whose platforms may represent each stop: its adjacent pairs.

    A loop stop touches pairs i-1 and i (wrapping); an open chain's ends touch
    only their one pair.
    """
    count = len(segment_lines) if circular else len(segment_lines) + 1
    lines: list[set[str]] = []
    for index in range(count):
        adjacent: set[str] = set()
        if circular or index > 0:
            item = segment_lines[index - 1]
            if not isinstance(item, LineRange) or item.route_lines:
                adjacent.add(
                    item.route_lines[-1] if isinstance(item, LineRange) else item
                )
        if circular or index < count - 1:
            item = segment_lines[index]
            if not isinstance(item, LineRange) or item.route_lines:
                adjacent.add(
                    item.route_lines[0] if isinstance(item, LineRange) else item
                )
        lines.append(adjacent)
    return lines


def group_candidates(
    service: ServiceOverrides,
    registry: Registry,
    candidates: Sequence[PlatformCandidate],
    lines_per_stop: Sequence[set[str]],
    inherited: Mapping[int, Sequence[PlatformCandidate]] | None = None,
    open_stops: Collection[int] = (),
) -> list[list[PlatformCandidate]]:
    """Candidates per stop: name, line and selector match, deduplicated.

    Homonym guard: the platforms of one stop must share one N02 group code
    unless the stop's platform selector pins a group or station code.
    ``inherited`` stops use their exact composed anchors only, unless they are
    ``open_stops`` (a transfer stop with one free side), which add N02 options.
    """
    stations = registry.by_id()
    grouped: list[list[PlatformCandidate]] = []
    for index, (stop, lines) in enumerate(
        zip(service.stops, lines_per_stop, strict=True)
    ):
        fixed = list(inherited.get(index, ())) if inherited else []
        if fixed and index not in open_stops:
            grouped.append(fixed)
            continue
        station = stations[stop.station_id]
        seen: set[tuple[str, float, float]] = set()
        groups: set[str] = set()
        options: list[PlatformCandidate] = []
        for candidate in candidates:
            if (
                candidate.match_name != station.match_name
                or candidate.n02_line not in lines
                or not stop.platform_selector.matches(candidate)
                or not station.n02_selector.matches(candidate)
            ):
                continue
            groups.add(candidate.group_code)
            key = (
                candidate.n02_line,
                round(candidate.midpoint.x, 3),
                round(candidate.midpoint.y, 3),
            )
            if key in seen:
                continue
            seen.add(key)
            options.append(candidate)
        if not options:
            raise RoutingError(
                f"no N02 platform for {station.name} ({service.id}) on {sorted(lines)}"
            )
        if len(groups) > 1 and not (
            stop.platform_selector.pins_group or station.n02_selector.pins_group
        ):
            raise RoutingError(
                f"ambiguous N02 platforms for {station.name} ({service.id}): groups "
                f"{sorted(groups)}; add a registry n02_selector or stops.csv platform_selector"
            )
        grouped.append([*fixed, *options])
    return grouped


def distinct_anchors(
    *anchors: PlatformCandidate | None,
) -> tuple[PlatformCandidate, ...]:
    """Inherited anchors of one stop, one per exact point, in side order."""
    result: list[PlatformCandidate] = []
    for anchor in anchors:
        if anchor is not None and all(
            anchor.midpoint.coords[0] != kept.midpoint.coords[0] for kept in result
        ):
            result.append(anchor)
    return tuple(result)


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
    source: N02Source,
    service: ServiceOverrides,
    registry: Registry,
    overrides: Overrides | None = None,
    builds: Mapping[str, ServiceBuild] | None = None,
) -> ServiceBuild:
    """Choose platforms and trace every +1 stop pair of one service."""
    composed = composed_pairs(service, overrides, builds or {}) if overrides else {}
    transfers = {
        index: limit
        for index, station_id in enumerate(service.station_ids)
        if overrides
        and (limit := overrides.transfer_limit(service.id, station_id)) is not None
    }
    arrivals, departures = inherited_candidates(composed, len(service.stops), transfers)
    inherited = {
        stop: distinct_anchors(arrivals.get(stop), departures.get(stop))
        for stop in set(arrivals) | set(departures)
    }
    open_stops = {
        stop for stop in transfers if stop not in arrivals or stop not in departures
    }
    ranges = service.segment_ranges()
    segment_lines = tuple(" -> ".join(item.route_lines) for item in ranges)
    all_lines = {line for item in ranges for line in item.route_lines}
    stations = registry.by_id()
    candidates = source.platform_candidates(
        [stations[station_id].match_name for station_id in service.station_ids],
        all_lines,
    )
    grouped = group_candidates(
        service,
        registry,
        candidates,
        stop_lines(ranges, service.circular),
        inherited,
        open_stops,
    )
    sections = source.track_sections(
        all_lines,
        [candidate.midpoint for options in grouped for candidate in options]
        + [
            to_metric_point(joint)
            for item in ranges
            if item.route
            for joint in item.route.joints
        ]
        + [to_metric_point(via) for item in ranges for via in item.via],
    )
    # Graph cache keyed by the constraints, not just the line.
    networks: dict[tuple[str, SectionFilter], TrackNetwork] = {}
    routes: list[PairRoute] = []
    for index, item in enumerate(ranges):
        if index in composed:
            path = composed[index][0]
            routes.append(PairRoute(TrackNetwork([path.geometry]), fixed_path=path))
            continue
        ordered_networks: list[TrackNetwork] = []
        for line in item.route_lines:
            section_filter = service.section_filter(line)
            key = (line, section_filter)
            if key not in networks:
                networks[key] = filtered_network(
                    sections[line], section_filter, f"{service.id}/{line}"
                )
            ordered_networks.append(networks[key])
        via = tuple(to_metric_point(point) for point in item.via)
        routes.append(
            PairRoute(
                network=ordered_networks[0],
                via=via,
                networks=tuple(ordered_networks) if item.route else (),
                joints=tuple(to_metric_point(point) for point in item.route.joints)
                if item.route
                else (),
                line_order=item.route.lines if item.route else (),
            )
        )
    if service.circular:
        routed = route_loop(grouped, routes)
    else:
        routed = route_path(grouped, routes, transfers=transfers)
    check_inherited_route_anchors(
        routed.paths, arrivals, departures, len(service.stops)
    )
    return ServiceBuild(service=service, segment_lines=segment_lines, routed=routed)


def route_network(source: N02Source, overrides: Overrides) -> dict[str, ServiceBuild]:
    builds: dict[str, ServiceBuild] = {}
    for identifier in dependency_order(overrides.services):
        service = overrides.service(identifier)
        item = route_service(source, service, overrides.registry, overrides, builds)
        report = rules.Report()
        points = {
            station_id: chosen.midpoint
            for station_id, chosen in zip(
                service.station_ids, item.routed.chosen, strict=True
            )
        }
        for index, path in enumerate(item.routed.paths):
            a, b = (
                service.station_ids[index],
                service.station_ids[(index + 1) % len(service.stops)],
            )
            rules.check_skipped_stops(
                f"{service.id}/{a}~{b}", path.geometry, (a, b), points, report
            )
            # At a reviewed transfer the departing pair's straight line starts at
            # its own track point, exactly as the artifact validator sees it.
            start = (
                Point(path.geometry.coords[0])
                if overrides.transfer_limit(service.id, a) is not None
                else item.routed.departure(index).midpoint
            )
            rules.check_detour(
                f"{service.id}/{a}~{b}",
                path.geometry,
                start,
                item.routed.arrival(index + 1).midpoint,
                overrides.detour_limit(service.id, a, b),
                report,
            )
        if report.errors:
            raise RoutingError("; ".join(report.errors))
        ends = service.definition.endpoints
        boundaries = check_scope(
            service.id,
            service.station_ids,
            service.scope_stops,
            overrides.registry,
            overrides.dataset.area,
            (ends.first, ends.last) if ends else None,
        )
        builds[service.id] = ServiceBuild(
            item.service, item.segment_lines, item.routed, boundaries
        )
    return {service.id: builds[service.id] for service in overrides.services}


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


def generate_build(raw_dir: Path, overrides: Overrides) -> BuildResult:
    """Route, export and check topology without enforcing publication budgets."""
    source = N02Source(
        raw_dir,
        operator=overrides.dataset.n02_operator,
        candidate_search_bbox=overrides.dataset.candidate_search_bbox,
    )
    builds = route_network(source, overrides)
    files = export.build_files(
        overrides,
        representative_points(overrides, builds),
        platform_points(builds),
        {
            service_id: [path.geometry for path in item.routed.paths]
            for service_id, item in builds.items()
        },
    )
    report = rules.Report()
    segments = json.loads(files[config.SEGMENTS_FILE])
    rules.check_two_way_reachability(
        (station.id for station in overrides.registry.stations),
        ((segment["from"], segment["to"]) for segment in segments),
        overrides.dataset.start_station_id,
        report,
    )
    if report.errors:
        raise RoutingError("; ".join(report.errors))
    return BuildResult(files=files, services=builds)


def build(raw_dir: Path, overrides_dir: Path) -> BuildResult:
    overrides = load_overrides(overrides_dir)
    result = generate_build(raw_dir, overrides)
    check_file_budgets(result.files, overrides.dataset.budgets)
    return result


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
            chosen = item.routed.departure(i)
            rows.append(
                f"{i:2d} {ids[i]} -> {ids[(i + 1) % count]} | "
                f"{item.segment_lines[i]} | {path.length:7.1f} | "
                f"{path.start_offset:.2f}/{path.end_offset:.2f} | "
                f"{chosen.n02_line}/{chosen.station_code}"
            )
        total_km = sum(path.length for path in item.routed.paths) / 1000
        rows.append(f"{service_id} track length: {total_km:.3f} km")
        for boundary in item.boundaries:
            rows.append(
                f"{service_id} {boundary.endpoint} truncation: last in-area {boundary.last_in_area}; first out-of-area {boundary.first_out_of_area} (scope.csv; {item.service.definition.scope_source})"
            )
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
        for key, value in sorted(file_size_report(result.files).items()):
            print(f"{key}: {value}")
        for name in sorted(result.files):
            size = (args.out_dir / name).stat().st_size
            print(f"wrote {args.out_dir / name} ({size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
