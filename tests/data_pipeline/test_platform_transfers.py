"""G2: reviewed platform transfers (one stop, two disconnected platform features)."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import LineString

from scripts.data_pipeline import config, export
from scripts.data_pipeline.build import platform_points, route_network
from scripts.data_pipeline.constraints import (
    ConstraintError,
    PlatformTransfer,
    parse_platform_transfer_rows,
)
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.routing import PairRoute, RoutingError, route_path
from scripts.data_pipeline.validate import load_dataset, validate_dataset
from tests.data_pipeline.composition_support import (
    composition_overrides,
    synthetic_build,
)
from tests.data_pipeline.support import candidate
from tests.data_pipeline.transfer_support import (
    TRANSFER_GAP_M,
    TransferSource,
    with_transfer_services,
)


def _split_stops() -> tuple[TrackNetwork, list[list]]:
    """A(0,0) -> B on one track; B' (60 m away) -> C on a disconnected track."""
    network = TrackNetwork(
        [LineString([(0, 0), (500, 0)]), LineString([(500, 60), (1000, 60)])]
    )
    stops = [
        [candidate("A", 0, 0)],
        [
            candidate("B", 500, 0, code="2", group="B"),
            candidate("B", 500, 60, code="3", group="B"),
        ],
        [candidate("C", 1000, 60, code="4")],
    ]
    return network, stops


def test_route_path_without_transfer_cannot_cross_disconnected_platforms() -> None:
    network, stops = _split_stops()

    with pytest.raises(RoutingError, match=r"no connected path reaches S\[2\]"):
        route_path(stops, [PairRoute(network), PairRoute(network)])


def test_route_path_departs_from_the_other_platform_at_a_reviewed_transfer() -> None:
    network, stops = _split_stops()

    routed = route_path(
        stops, [PairRoute(network), PairRoute(network)], transfers={1: 100.0}
    )

    assert routed.arrival(1) == stops[1][0]
    assert routed.departure(1) == stops[1][1]
    assert routed.chosen[1] == stops[1][0]  # the published platform is the arrival
    assert routed.paths[0].geometry.coords[-1] == (500.0, 0.0)
    assert routed.paths[1].geometry.coords[0] == (500.0, 60.0)
    # 500 m + 60 m transfer + 500 m, in integer millimetres.
    assert routed.total_cost_mm == 1_060_000


def test_route_path_transfer_respects_its_reviewed_limit() -> None:
    network, stops = _split_stops()

    with pytest.raises(RoutingError, match=r"no connected path reaches S\[2\]"):
        route_path(stops, [PairRoute(network), PairRoute(network)], transfers={1: 59.0})


def test_route_path_rejects_an_unused_transfer() -> None:
    network = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    stops = [
        [candidate("A", 0, 0)],
        [candidate("B", 500, 0, code="2"), candidate("B", 500, 25, code="3")],
        [candidate("C", 1000, 0, code="4")],
    ]

    with pytest.raises(RoutingError, match=r"transfer is unused at S\[1\]"):
        route_path(
            stops, [PairRoute(network), PairRoute(network)], transfers={1: 100.0}
        )


@pytest.mark.parametrize("stop", [0, 2])
def test_route_path_rejects_a_transfer_at_an_endpoint(stop: int) -> None:
    network, stops = _split_stops()

    with pytest.raises(RoutingError, match="needs an interior stop"):
        route_path(
            stops, [PairRoute(network), PairRoute(network)], transfers={stop: 100.0}
        )


def test_route_path_without_transfers_keeps_one_platform_per_stop() -> None:
    network = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    stops = [
        [candidate("A", 0, 0)],
        [candidate("B", 500, 0, code="2")],
        [candidate("C", 1000, 0, code="3")],
    ]

    routed = route_path(stops, [PairRoute(network), PairRoute(network)])

    assert routed.departures == ()
    assert [routed.departure(i) for i in range(3)] == list(routed.chosen)


@pytest.mark.parametrize("limit", ["0", "-5", "nan", "inf", "251", "far"])
def test_platform_transfer_rows_need_a_bounded_positive_limit(limit: str) -> None:
    row = {"service_id": "s", "station_id": "x", "max_transfer_m": limit, "reason": "r"}

    with pytest.raises(ConstraintError, match="platform transfer row 0"):
        parse_platform_transfer_rows([row])


def test_platform_transfer_rows_need_a_reason() -> None:
    row = {"service_id": "s", "station_id": "x", "max_transfer_m": "50", "reason": ""}

    with pytest.raises(ConstraintError, match="and a reason"):
        parse_platform_transfer_rows([row])


def _write_transfers(directory: Path, *rows: str) -> None:
    (directory / config.PLATFORM_TRANSFERS_OVERRIDE_FILE).write_text(
        "service_id,station_id,max_transfer_m,reason\n"
        + "".join(f"{row},Reviewed\n" for row in rows),
        encoding="utf-8",
    )


def test_platform_transfer_table_loads_with_its_limit(overrides_copy: Path) -> None:
    _write_transfers(overrides_copy, "jr-keihin-tohoku,tokyo,80")

    overrides = load_overrides(overrides_copy)

    assert overrides.transfer_limit("jr-keihin-tohoku", "tokyo") == 80.0
    assert overrides.transfer_limit("jr-keihin-tohoku", "kanda") is None


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        (("jr-unknown,tokyo,80",), "unknown service"),
        (("jr-yamanote,tokyo,80",), "circular service"),
        (("jr-keiyo,tokyo,80",), "interior stop"),
        (("jr-keihin-tohoku,shinjuku,80",), "interior stop"),
        (("jr-keihin-tohoku,tokyo,80", "jr-keihin-tohoku,tokyo,90"), "duplicate"),
    ],
)
def test_platform_transfer_table_rejects_bad_references(
    overrides_copy: Path, rows: tuple[str, ...], message: str
) -> None:
    _write_transfers(overrides_copy, *rows)

    with pytest.raises(OverrideError, match=message):
        load_overrides(overrides_copy)


def _transfer_bundle(
    committed: Overrides, tmp_path: Path, **options: object
) -> tuple[Overrides, dict]:
    overrides = with_transfer_services(composition_overrides(committed), **options)  # type: ignore[arg-type]
    files, builds = synthetic_build(overrides, TransferSource())
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")
    return overrides, builds


def test_build_without_reviewed_transfer_fails_at_the_split_stop(
    committed_overrides: Overrides,
) -> None:
    overrides = with_transfer_services(
        composition_overrides(committed_overrides), transfer_m=None
    )

    with pytest.raises(RoutingError, match=r"no connected path reaches S\[2\]"):
        route_network(TransferSource(), overrides)  # type: ignore[arg-type]


def test_transfer_build_publishes_arrival_and_validates(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, builds = _transfer_bundle(committed_overrides, tmp_path)

    routed = builds["split"].routed
    gap = routed.arrival(1).midpoint.distance(routed.departure(1).midpoint)
    assert gap == pytest.approx(TRANSFER_GAP_M)
    assert platform_points(builds)[("split", "x")] == routed.arrival(1).midpoint
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def test_validator_requires_the_reviewed_transfer_for_a_platform_gap(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, _ = _transfer_bundle(committed_overrides, tmp_path)
    unreviewed = with_transfer_services(
        composition_overrides(committed_overrides), transfer_m=None
    )

    errors = validate_dataset(load_dataset(tmp_path), unreviewed).errors

    assert errors == ["split:x~y endpoint 60.0 m from service platform"]


def test_composed_and_mixed_consumers_inherit_each_side_of_a_transfer(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, builds = _transfer_bundle(committed_overrides, tmp_path, consumers=True)

    owner = builds["split"].routed
    for consumer in ("split-composed", "split-mixed"):
        routed = builds[consumer].routed
        assert routed.arrival(1).midpoint == owner.arrival(1).midpoint
        assert routed.departure(1).midpoint == owner.departure(1).midpoint
    segments = {
        item["id"]: item["geometryFeatureIds"]
        for item in json.loads((tmp_path / config.SEGMENTS_FILE).read_text())
    }
    assert segments["split-composed:x:y"] == ["split:x~y"]
    assert segments["split-mixed:x:y"] == ["split-mixed:x~y"]
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def test_composed_hops_meeting_at_two_platforms_need_a_reviewed_transfer(
    committed_overrides: Overrides,
) -> None:
    overrides = with_transfer_services(
        composition_overrides(committed_overrides), consumers=True
    )
    # Keep the owner's transfer only: the consumers would join two platforms.
    overrides = replace(overrides, platform_transfers=overrides.platform_transfers[:1])

    with pytest.raises(OverrideError, match="compose platform-gap"):
        route_network(TransferSource(), overrides)  # type: ignore[arg-type]


def test_route_then_compose_at_a_transfer_frees_the_arrival_side(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, builds = _transfer_bundle(committed_overrides, tmp_path, consumers=True)

    routed = builds["split-routed-first"].routed
    owner = builds["split"].routed
    assert routed.arrival(1).midpoint == owner.arrival(1).midpoint  # free, routed
    assert (
        routed.departure(1).midpoint.coords[0]
        == (
            owner.paths[1].geometry.coords[0]  # fixed, inherited anchor
        )
    )
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def test_a_composed_hop_cannot_cross_its_owners_transfer(
    committed_overrides: Overrides,
) -> None:
    overrides = with_transfer_services(
        composition_overrides(committed_overrides), express=True
    )

    with pytest.raises(OverrideError, match="joint is not exact"):
        route_network(TransferSource(), overrides)  # type: ignore[arg-type]


def test_build_and_validator_measure_a_transfer_detour_from_the_same_point(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    # x' lies 243 m from x towards t; y is only 165 m from the published x
    # but 400 m of straight track from x', so x -> y is not a detour.
    overrides = with_transfer_services(
        composition_overrides(committed_overrides), transfer_m=250.0, consumers=True
    )
    files, _ = synthetic_build(overrides, TransferSource((40.0, -240.0)))
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")

    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def _republish(
    tmp_path: Path, overrides: Overrides, service_id: str, coordinate: list[float]
) -> None:
    """Move one published platform of a service and re-serialize canonically."""
    path = tmp_path / config.SERVICES_FILE
    document = json.loads(path.read_text(encoding="utf-8"))
    for service in document["services"]:
        if service["id"] == service_id:
            service["platformCoordinates"]["x"] = coordinate
    files = {
        name: (tmp_path / name).read_text(encoding="utf-8")
        for name in (
            config.STATIONS_FILE,
            config.SEGMENTS_FILE,
            config.SEGMENTS_GEOJSON_FILE,
        )
    }
    files[config.SERVICES_FILE] = export.dumps_pretty(document)
    files[config.MANIFEST_FILE] = export.dumps_pretty(
        export.build_manifest(
            export.manifest_inputs(files), overrides.dataset.updated_at
        )
    )
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")


def test_validator_requires_the_published_platform_on_the_arrival_side(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, _ = _transfer_bundle(committed_overrides, tmp_path, consumers=True)
    departure = _departure_anchor(tmp_path, "split-composed")
    _republish(tmp_path, overrides, "split-composed", departure)

    errors = validate_dataset(load_dataset(tmp_path), overrides).errors

    assert (
        errors
        == ["split-composed: compose platform is not exact primitive anchor at x"] * 2
    )  # both travel directions of t <-> x


def test_validator_rejects_an_unused_transfer_row(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides = composition_overrides(committed_overrides)
    files, _ = synthetic_build(overrides)
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")
    reviewed = replace(
        overrides,
        platform_transfers=(
            PlatformTransfer("owner-a", "a", 100.0, "Not needed on one track"),
        ),
    )

    errors = validate_dataset(load_dataset(tmp_path), reviewed).errors

    assert errors == ["owner-a: platform transfer at a is unused"]


def test_equal_cost_transfers_resolve_deterministically() -> None:
    network = TrackNetwork(
        [
            LineString([(0, 0), (500, 0)]),
            LineString([(500, 60), (1000, 0)]),
            LineString([(500, -60), (1000, 0)]),
        ]
    )
    b = [
        candidate("B", 500, 0, code="2", group="B"),
        candidate("B", 500, 60, code="3", group="B"),
        candidate("B", 500, -60, code="4", group="B"),
    ]
    stops = [[candidate("A", 0, 0)], b, [candidate("C", 1000, 0, code="5")]]
    routes = [PairRoute(network), PairRoute(network)]

    first = route_path(stops, routes, transfers={1: 100.0})
    again = route_path(stops, routes, transfers={1: 100.0})

    assert first == again
    assert first.departure(1) == b[1]  # equal cost: the lower candidate index


def test_validator_requires_the_routed_arrival_on_the_published_platform(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides, _ = _transfer_bundle(committed_overrides, tmp_path, consumers=True)
    # Publish the departure anchor for a service that routes into x.
    _republish(
        tmp_path,
        overrides,
        "split-routed-first",
        _departure_anchor(tmp_path, "split-composed"),
    )

    errors = validate_dataset(load_dataset(tmp_path), overrides).errors

    assert errors == ["split-routed-first:t~x endpoint 60.0 m from service platform"]


def _departure_anchor(tmp_path: Path, service_id: str) -> list[float]:
    segments = json.loads((tmp_path / config.SEGMENTS_FILE).read_text())
    features = {
        item["id"]: item
        for item in json.loads((tmp_path / config.SEGMENTS_GEOJSON_FILE).read_text())[
            "features"
        ]
    }
    chain = next(s for s in segments if s["id"] == f"{service_id}:x:y")
    return features[chain["geometryFeatureIds"][0]]["geometry"]["coordinates"][0]


@pytest.mark.parametrize("east", [0.0, 20.0, 37.0])
def test_transfer_at_exactly_its_limit_survives_coordinate_rounding(
    committed_overrides: Overrides, tmp_path: Path, east: float
) -> None:
    overrides = with_transfer_services(
        composition_overrides(committed_overrides),
        transfer_m=TRANSFER_GAP_M,
        consumers=True,
    )
    files, _ = synthetic_build(overrides, TransferSource(east=east))
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")

    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


@pytest.mark.parametrize("segment", ["split:t:x", "split:x:y"])
@pytest.mark.parametrize("chain", [[], [{}]])
def test_unused_transfer_check_skips_malformed_chains(
    committed_overrides: Overrides, tmp_path: Path, segment: str, chain: list
) -> None:
    overrides, _ = _transfer_bundle(committed_overrides, tmp_path)
    segments = json.loads((tmp_path / config.SEGMENTS_FILE).read_text())
    for item in segments:
        if item["id"] == segment:
            item["geometryFeatureIds"] = chain
    files = {
        name: (tmp_path / name).read_text(encoding="utf-8")
        for name in (
            config.STATIONS_FILE,
            config.SERVICES_FILE,
            config.SEGMENTS_GEOJSON_FILE,
        )
    }
    files[config.SEGMENTS_FILE] = export.dumps_segments(segments)
    files[config.MANIFEST_FILE] = export.dumps_pretty(
        export.build_manifest(
            export.manifest_inputs(files), overrides.dataset.updated_at
        )
    )
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")

    errors = validate_dataset(load_dataset(tmp_path), overrides).errors

    assert errors  # reported by the chain checks instead of raising
    assert not any("transfer" in error for error in errors)
