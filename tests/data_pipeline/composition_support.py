"""Synthetic mixed route/compose bundle with two owners and a nested consumer."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from shapely.geometry import LineString, Point

from scripts.data_pipeline.build import ServiceBuild, route_network
from scripts.data_pipeline.composition import (
    ComposeLeg,
    ComposeRecipe,
    SharedTrackEvidence,
)
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.export import build_files
from scripts.data_pipeline.n02 import PlatformCandidate, TrackSection
from scripts.data_pipeline.overrides import (
    Endpoints,
    LengthRef,
    LineMetadata,
    LineRange,
    Overrides,
)
from scripts.data_pipeline.registry import Registry, RegistryStation, ScopeStop
from scripts.data_pipeline.validate import to_metric
from tests.data_pipeline.support import candidate


def recipe(*legs: tuple[str, str, str, tuple[str, ...]]) -> ComposeRecipe:
    return ComposeRecipe(
        tuple(
            ComposeLeg(
                owner,
                a,
                b,
                SharedTrackEvidence(
                    lines, SectionFilter(), "Reviewed synthetic common track"
                ),
            )
            for owner, a, b, lines in legs
        )
    )


class SyntheticSource:
    def __init__(self) -> None:
        origin_x, origin_y = to_metric([139.7, 35.6])
        self.points = {
            station: Point(origin_x + x, origin_y + y)
            for station, x, y in [
                ("lead", -300, 0),
                ("start", 0, 0),
                ("a", 300, 0),
                ("b", 600, 0),
                ("c", 900, 0),
                ("d", 1200, 0),
                ("t", 0, 300),
                ("u", -300, 300),
            ]
        }
        self.members = {
            "L0": ("lead", "start", "a", "b"),
            "L1": ("b", "c", "d"),
            "LOOP": ("start", "t", "u"),
        }

    def platform_candidates(self, names: Any, lines: Any) -> list[PlatformCandidate]:
        return [
            candidate(
                station,
                self.points[station].x,
                self.points[station].y,
                code=str(index),
                line=line,
            )
            for line in sorted(lines)
            for index, station in enumerate(self.members[line])
            if station in names
        ]

    def track_sections(self, lines: Any, around: Any) -> dict[str, list[TrackSection]]:
        return {
            line: [
                TrackSection(
                    "key",
                    LineString(
                        [
                            self.points[station].coords[0]
                            for station in (*self.members[line], self.members[line][0])
                            if line == "LOOP"
                        ]
                        if line == "LOOP"
                        else [
                            self.points[station].coords[0]
                            for station in self.members[line]
                        ]
                    ),
                )
            ]
            for line in lines
        }


def composition_overrides(template: Overrides) -> Overrides:
    definitions = [
        (
            "rapid",
            ("a", "c", "d"),
            False,
            (
                LineRange(
                    "a", "c", "", compose=recipe(("nested", "a", "c", ("L0", "L1")))
                ),
                LineRange("c", "d", "L1"),
            ),
        ),
        (
            "reverse",
            ("c", "a"),
            False,
            (
                LineRange(
                    "c",
                    "a",
                    "",
                    compose=recipe(
                        ("owner-b", "c", "b", ("L1",)), ("owner-a", "b", "a", ("L0",))
                    ),
                ),
            ),
        ),
        (
            "nested",
            ("a", "c"),
            False,
            (
                LineRange(
                    "a",
                    "c",
                    "",
                    compose=recipe(
                        ("owner-a", "a", "b", ("L0",)), ("owner-b", "b", "c", ("L1",))
                    ),
                ),
            ),
        ),
        ("owner-b", ("b", "c", "d"), False, (LineRange("b", "d", "L1"),)),
        ("target", ("start", "t", "u"), True, (LineRange("start", "start", "LOOP"),)),
        (
            "owner-a",
            ("lead", "start", "a", "b"),
            False,
            (LineRange("lead", "b", "L0"),),
        ),
    ]
    services = []
    for identifier, ids, circular, ranges in definitions:
        if circular:
            ranges = (LineRange("start", "u", "LOOP"), LineRange("u", "start", "LOOP"))
        services.append(
            replace(
                template.services[0],
                definition=replace(
                    template.services[0].definition,
                    id=identifier,
                    name=identifier,
                    circular=circular,
                    kind="rapid"
                    if identifier in ("rapid", "reverse", "nested")
                    else "local",
                    line_ids=("track",),
                    endpoints=None if circular else Endpoints("terminus", "terminus"),
                    expected_stop_count=len(ids),
                    length_ref=LengthRef(
                        0.9 if identifier in ("owner-a", "rapid") else 0.6,
                        1.0,
                        "Synthetic",
                    ),
                ),
                stops=tuple(
                    replace(
                        template.services[0].stops[0],
                        order=i,
                        station_id=station,
                        station_number="",
                    )
                    for i, station in enumerate(ids)
                ),
                line_ranges=ranges,
                section_filters={},
                scope_stops=tuple(
                    ScopeStop(station, "東京都", "千代田区") for station in ids
                ),
            )
        )
    representatives = {
        "lead": "owner-a",
        "start": "target",
        "a": "owner-a",
        "b": "owner-b",
        "c": "owner-b",
        "d": "owner-b",
        "t": "target",
        "u": "target",
    }
    registry = Registry(
        tuple(
            RegistryStation(station, station, station, "東京都", "千代田区", owner)
            for station, owner in representatives.items()
        )
    )
    return replace(
        template,
        dataset=replace(
            template.dataset,
            service_ids=tuple(item.id for item in services),
            start_station_id="start",
            target_service_id="target",
        ),
        services=tuple(services),
        registry=registry,
        offset_exceptions=(),
        platform_transfers=(),
        detour_exceptions=(),
        lines=(LineMetadata("track", "Track", "#000000"),),
    )


def synthetic_build(
    overrides: Overrides,
    source: SyntheticSource | None = None,
) -> tuple[dict[str, str], dict[str, ServiceBuild]]:
    from scripts.data_pipeline.build import platform_points, representative_points

    source = source or SyntheticSource()
    builds = route_network(source, overrides)  # type: ignore[arg-type]
    files = build_files(
        overrides,
        representative_points(overrides, builds),
        platform_points(builds),
        {
            identifier: [path.geometry for path in item.routed.paths]
            for identifier, item in builds.items()
        },
    )
    return files, builds
