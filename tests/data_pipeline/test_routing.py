from __future__ import annotations

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.network import TrackNetwork
from scripts.data_pipeline.routing import RoutingError, route_loop


def _candidate(
    name: str, x: float, y: float, code: str = "000001"
) -> PlatformCandidate:
    platform = LineString([(x - 5, y), (x + 5, y)])
    return PlatformCandidate(
        station_name=name,
        n02_line="L",
        station_code=code,
        group_code=code,
        platform=platform,
        midpoint=Point(x, y),
    )


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


def test_route_loop_picks_platform_on_through_route() -> None:
    network = _square_with_spur()
    candidates = [
        [_candidate("A", 50, 0)],
        [_candidate("B", 300, 0, "000009"), _candidate("B", 100, 50, "000002")],
        [_candidate("C", 50, 100)],
        [_candidate("D", 0, 50)],
    ]

    loop = route_loop(candidates, ["L"] * 4, {"L": network})

    assert loop.chosen[1].station_code == "000002"
    assert sum(path.length for path in loop.paths) == pytest.approx(400.0)
    assert loop.paths[0].geometry.coords[0] == (50, 0)
    assert loop.paths[-1].geometry.coords[-1] == (50, 0)


def test_route_loop_with_station_without_candidates_raises() -> None:
    network = _square_with_spur()
    candidates = [[_candidate("A", 50, 0)], []]

    with pytest.raises(RoutingError, match="no platform candidate"):
        route_loop(candidates, ["L", "L"], {"L": network})


def test_route_loop_with_line_count_mismatch_raises() -> None:
    network = _square_with_spur()

    with pytest.raises(RoutingError, match="one N02 line per segment"):
        route_loop([[_candidate("A", 50, 0)]], ["L", "L"], {"L": network})
