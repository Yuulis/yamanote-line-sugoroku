from __future__ import annotations

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline.network import NoPathError, TrackNetwork


def _ladder() -> TrackNetwork:
    """Two routes from (0,0) to (100,0): direct (100 m) and a detour (~241 m)."""
    return TrackNetwork(
        [
            LineString([(0, 0), (50, 0)]),
            LineString([(50, 0), (100, 0)]),
            LineString([(0, 0), (0, 70), (100, 70), (100, 0)]),
        ]
    )


def test_shortest_path_with_two_routes_takes_shorter_one() -> None:
    network = _ladder()

    path = network.shortest_path(Point(10, 0), Point(90, 0))

    assert path.length == pytest.approx(80.0)
    assert list(path.geometry.coords) == [(10, 0), (50, 0), (90, 0)]


def test_shortest_path_is_oriented_from_origin_to_destination() -> None:
    network = _ladder()

    path = network.shortest_path(Point(90, 0), Point(10, 0))

    assert path.geometry.coords[0] == (90, 0)
    assert path.geometry.coords[-1] == (10, 0)


def test_shortest_path_on_same_edge_returns_substring() -> None:
    network = TrackNetwork([LineString([(0, 0), (100, 0)])])

    path = network.shortest_path(Point(70, 5), Point(20, -5))

    assert path.length == pytest.approx(50.0)
    assert list(path.geometry.coords) == [(70, 0), (20, 0)]
    assert path.start_offset == pytest.approx(5.0)
    assert path.end_offset == pytest.approx(5.0)


def test_shortest_path_follows_track_vertices_not_straight_line() -> None:
    network = TrackNetwork([LineString([(0, 0), (0, 50), (50, 50)])])

    path = network.shortest_path(Point(0, 0), Point(50, 50))

    assert list(path.geometry.coords) == [(0, 0), (0, 50), (50, 50)]
    assert path.length == pytest.approx(100.0)


def test_shortest_path_with_disconnected_pieces_raises() -> None:
    network = TrackNetwork(
        [LineString([(0, 0), (10, 0)]), LineString([(100, 0), (110, 0)])]
    )

    with pytest.raises(NoPathError):
        network.shortest_path(Point(1, 0), Point(105, 0))


def test_track_network_with_no_lines_raises() -> None:
    with pytest.raises(ValueError):
        TrackNetwork([])
