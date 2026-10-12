from __future__ import annotations

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline.build import filtered_network, stop_lines
from scripts.data_pipeline.constraints import SectionFilter, section_key
from scripts.data_pipeline.n02 import TrackSection
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.routing import (
    PairRoute,
    RoutingError,
    route_loop,
    route_path,
)
from tests.data_pipeline.support import candidate


def _square_with_spur() -> TrackNetwork:
    """A 400 m square loop plus a 300 m spur leaving the corner (100, 0)."""
    return TrackNetwork(
        [
            LineString([(0, 0), (100, 0)]),
            LineString([(100, 0), (100, 100)]),
            LineString([(100, 100), (0, 100)]),
            LineString([(0, 100), (0, 0)]),
            LineString([(100, 0), (400, 0)]),
        ]
    )


def _parallel_tracks() -> TrackNetwork:
    """Two parallel east-west tracks (y=0 local, y=20 rapid), joined at x=0.

    The local track has stops; the rapid track is 20 m north and has none.
    """
    return TrackNetwork(
        [
            LineString([(0, 0), (500, 0)]),
            LineString([(500, 0), (1000, 0)]),
            LineString([(0, 0), (0, 20)]),
            LineString([(0, 20), (1000, 20)]),
        ]
    )


def _routes(network: TrackNetwork, count: int) -> list[PairRoute]:
    return [PairRoute(network=network) for _ in range(count)]


# --- route_loop --------------------------------------------------------------


def test_route_loop_picks_platform_on_through_route() -> None:
    network = _square_with_spur()
    candidates = [
        [candidate("A", 50, 0)],
        [candidate("B", 300, 0, "000009"), candidate("B", 100, 50, "000002")],
        [candidate("C", 50, 100)],
        [candidate("D", 0, 50)],
    ]

    loop = route_loop(candidates, _routes(network, 4))

    assert loop.circular is True
    assert loop.chosen[1].station_code == "000002"
    assert sum(path.length for path in loop.paths) == pytest.approx(400.0)
    assert loop.paths[0].geometry.coords[0] == (50, 0)
    assert loop.paths[-1].geometry.coords[-1] == (50, 0)


def test_route_loop_with_station_without_candidates_raises() -> None:
    network = _square_with_spur()
    candidates = [[candidate("A", 50, 0)], []]

    with pytest.raises(RoutingError, match="no platform candidate"):
        route_loop(candidates, _routes(network, 2))


def test_route_loop_with_route_count_mismatch_raises() -> None:
    network = _square_with_spur()

    with pytest.raises(RoutingError, match="one pair route per stop pair"):
        route_loop([[candidate("A", 50, 0)]], _routes(network, 2))


# --- route_path (open chain) ------------------------------------------------


def test_route_path_routes_n_minus_one_pairs_without_closing() -> None:
    network = _square_with_spur()
    candidates = [
        [candidate("A", 50, 0)],
        [candidate("B", 100, 50)],
        [candidate("C", 50, 100)],
    ]

    chain = route_path(candidates, _routes(network, 2))

    assert chain.circular is False
    assert len(chain.paths) == 2
    assert chain.paths[0].geometry.coords[0] == (50, 0)
    assert chain.paths[-1].geometry.coords[-1] == (50, 100)
    assert sum(path.length for path in chain.paths) == pytest.approx(200.0)


def test_route_path_chooses_cheapest_free_ends() -> None:
    network = _square_with_spur()
    candidates = [
        # first stop: a far platform on the spur and a near one on the square
        [candidate("A", 380, 0, "000009"), candidate("A", 50, 0, "000001")],
        [candidate("B", 100, 50)],
        # last stop: a near platform and a far one around the square
        [candidate("C", 100, 90, "000003"), candidate("C", 10, 100, "000004")],
    ]

    chain = route_path(candidates, _routes(network, 2))

    assert [c.station_code for c in chain.chosen] == ["000001", "000001", "000003"]
    assert chain.total_cost_mm == 50_000 + 50_000 + 40_000


def test_route_path_breaks_equal_cost_ties_by_candidate_index() -> None:
    network = TrackNetwork([LineString([(0, 0), (200, 0)])])
    candidates = [
        [candidate("A", 0, 0)],
        # 100 m and an equally cheap mirrored option: first index wins
        [candidate("B", 100, 0, "000001"), candidate("B", 100, 0, "000002")],
        [candidate("C", 200, 0)],
    ]

    chain = route_path(candidates, _routes(network, 2))

    assert chain.chosen[1].station_code == "000001"


def test_route_path_with_disconnected_middle_raises() -> None:
    network = TrackNetwork(
        [LineString([(0, 0), (100, 0)]), LineString([(500, 0), (600, 0)])]
    )
    candidates = [[candidate("A", 0, 0)], [candidate("B", 550, 0)]]

    with pytest.raises(RoutingError, match="no track path from A to B"):
        route_path(candidates, _routes(network, 1))


def test_route_path_with_single_stop_raises() -> None:
    with pytest.raises(RoutingError, match="at least two stops"):
        route_path([[candidate("A", 50, 0)]], [])


def test_route_path_with_route_count_mismatch_raises() -> None:
    network = _square_with_spur()
    candidates = [[candidate("A", 50, 0)], [candidate("B", 100, 50)]]

    with pytest.raises(RoutingError, match="one pair route per stop pair"):
        route_path(candidates, _routes(network, 2))


# --- constraints --------------------------------------------------------------


def test_route_path_rejects_platform_far_from_track() -> None:
    network = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    candidates = [
        [candidate("A", 0, 0)],
        # 50 m off the track (rejected) vs on the track 30 m further along
        [candidate("B", 470, 50, "000009"), candidate("B", 500, 0, "000002")],
    ]

    chain = route_path(candidates, _routes(network, 1), max_snap_offset_m=30.0)

    assert chain.chosen[1].station_code == "000002"


def test_route_path_with_every_platform_far_from_track_raises() -> None:
    network = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    candidates = [[candidate("A", 0, 0)], [candidate("B", 500, 80)]]

    with pytest.raises(RoutingError, match="farther than 30.0 m"):
        route_path(candidates, _routes(network, 1), max_snap_offset_m=30.0)


def test_route_path_with_via_point_takes_the_parallel_track() -> None:
    network = _parallel_tracks()
    candidates = [[candidate("A", 100, 0)], [candidate("B", 900, 0)]]
    direct = route_path(candidates, _routes(network, 1))

    via = route_path(candidates, [PairRoute(network=network, via=(Point(500, 20),))])

    assert direct.paths[0].length == pytest.approx(800.0)
    assert via.paths[0].length > direct.paths[0].length
    assert via.paths[0].geometry.distance(Point(500, 20)) == pytest.approx(0.0)
    assert via.paths[0].geometry.coords[0] == (100, 0)
    assert via.paths[0].geometry.coords[-1] == (900, 0)


def test_route_path_with_via_point_off_track_raises() -> None:
    network = _parallel_tracks()
    candidates = [[candidate("A", 100, 0)], [candidate("B", 900, 0)]]
    route = PairRoute(network=network, via=(Point(500, 200),))

    with pytest.raises(RoutingError, match="via point"):
        route_path(candidates, [route])


def _sections(*lines: LineString) -> list[TrackSection]:
    return [
        TrackSection(key=section_key(list(line.coords)), geometry=line)
        for line in lines
    ]


def test_filtered_network_with_deny_list_routes_on_the_local_track() -> None:
    rapid = LineString([(0, 0), (1000, 0)])  # straight, shortest
    local = LineString([(0, 0), (500, 30), (1000, 0)])  # ~1001.8 m, has stops
    sections = _sections(rapid, local)
    candidates = [[candidate("A", 0, 0)], [candidate("B", 1000, 0)]]
    open_network = filtered_network(sections, SectionFilter(), "test")
    deny_rapid = SectionFilter(deny=frozenset({sections[0].key}))

    unconstrained = route_path(candidates, _routes(open_network, 1))
    constrained = route_path(
        candidates, _routes(filtered_network(sections, deny_rapid, "test"), 1)
    )

    assert unconstrained.paths[0].length == pytest.approx(1000.0)
    assert constrained.paths[0].length == pytest.approx(local.length)
    assert constrained.paths[0].geometry.distance(Point(500, 30)) == pytest.approx(0)


def test_filtered_network_with_allow_list_keeps_only_listed_sections() -> None:
    sections = _sections(
        LineString([(0, 0), (1000, 0)]), LineString([(0, 50), (1000, 50)])
    )
    allow = SectionFilter(allow=frozenset({sections[1].key}))

    network = filtered_network(sections, allow, "test")

    assert [edge.geometry for edge in network.edges] == [sections[1].geometry]


def test_filtered_network_with_stale_key_raises() -> None:
    sections = _sections(LineString([(0, 0), (1000, 0)]))
    stale = SectionFilter(deny=frozenset({"139.00000 35.00000~139.00001 35.00001#0"}))

    with pytest.raises(RoutingError, match="section keys not found"):
        filtered_network(sections, stale, "test")


def test_filtered_network_removing_everything_raises() -> None:
    sections = _sections(LineString([(0, 0), (1000, 0)]))
    deny_all = SectionFilter(deny=frozenset({sections[0].key}))

    with pytest.raises(RoutingError, match="removes every section"):
        filtered_network(sections, deny_all, "test")


# --- stop lines ---------------------------------------------------------------


def test_stop_lines_for_loop_wraps_and_for_chain_keeps_one_line_at_ends() -> None:
    assert stop_lines(["X", "Y", "Z"], circular=True) == [
        {"Z", "X"},
        {"X", "Y"},
        {"Y", "Z"},
    ]
    assert stop_lines(["X", "Y"], circular=False) == [{"X"}, {"X", "Y"}, {"Y"}]
