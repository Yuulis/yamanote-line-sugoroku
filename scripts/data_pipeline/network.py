"""Shortest track paths on a set of railroad section LineStrings (metric CRS).

The network is an undirected graph whose nodes are section endpoints (rounded
to ``NODE_SNAP_DECIMALS`` metres) and whose edges are the sections themselves.
A query point is snapped onto the nearest section, splitting it virtually, so a
path can start or end in the middle of a section.
"""

from __future__ import annotations

import heapq
from collections.abc import Sequence
from dataclasses import dataclass

import shapely
from shapely.geometry import LineString, Point
from shapely.ops import substring

from scripts.data_pipeline import config

Node = tuple[float, float]


class NoPathError(RuntimeError):
    """Raised when two snapped points are not connected in the network."""


@dataclass(frozen=True)
class Edge:
    start: Node
    end: Node
    geometry: LineString

    @property
    def length(self) -> float:
        return float(self.geometry.length)


@dataclass(frozen=True)
class Snap:
    """Projection of a query point onto one network edge."""

    edge_index: int
    along: float  # distance from edge.start along the edge
    offset: float  # perpendicular distance from the query point


@dataclass(frozen=True)
class TrackPath:
    geometry: LineString
    length: float
    start_offset: float
    end_offset: float


def _node(coord: Sequence[float], decimals: int) -> Node:
    return (round(float(coord[0]), decimals), round(float(coord[1]), decimals))


def _concat(parts: Sequence[LineString]) -> LineString:
    coords: list[tuple[float, float]] = []
    for part in parts:
        for xy in part.coords:
            point = (float(xy[0]), float(xy[1]))
            if coords and coords[-1] == point:
                continue
            coords.append(point)
    if len(coords) < 2:
        coords = coords * 2
    return LineString(coords)


def _sub(edge: Edge, start: float, end: float) -> LineString:
    """Substring of ``edge`` from ``start`` to ``end`` (reversed if end < start)."""
    part = substring(edge.geometry, start, end)
    if isinstance(part, Point):
        return LineString([part.coords[0], part.coords[0]])
    return LineString(part.coords)


class TrackNetwork:
    def __init__(
        self,
        lines: Sequence[LineString],
        node_decimals: int = config.NODE_SNAP_DECIMALS,
    ) -> None:
        if not lines:
            raise ValueError("track network needs at least one line")
        self.edges: tuple[Edge, ...] = tuple(
            Edge(
                start=_node(line.coords[0], node_decimals),
                end=_node(line.coords[-1], node_decimals),
                geometry=line,
            )
            for line in lines
        )
        self._tree = shapely.STRtree([edge.geometry for edge in self.edges])
        adjacency: dict[Node, list[tuple[Node, int]]] = {}
        for index, edge in enumerate(self.edges):
            adjacency.setdefault(edge.start, []).append((edge.end, index))
            adjacency.setdefault(edge.end, []).append((edge.start, index))
        self._adjacency = {node: sorted(items) for node, items in adjacency.items()}

    def snap(self, point: Point) -> Snap:
        """Project ``point`` onto the nearest edge (lowest index wins ties)."""
        indices = self._tree.query_nearest(point, all_matches=True)
        edge_index = int(min(indices))
        geometry = self.edges[edge_index].geometry
        return Snap(
            edge_index=edge_index,
            along=float(geometry.project(point)),
            offset=float(geometry.distance(point)),
        )

    def _dijkstra(
        self, seeds: Sequence[tuple[float, Node, LineString]]
    ) -> tuple[dict[Node, float], dict[Node, tuple[Node | None, LineString]]]:
        distances: dict[Node, float] = {}
        previous: dict[Node, tuple[Node | None, LineString]] = {}
        heap: list[tuple[float, Node, int]] = []
        for order, (cost, node, part) in enumerate(seeds):
            if cost < distances.get(node, float("inf")):
                distances[node] = cost
                previous[node] = (None, part)
                heapq.heappush(heap, (cost, node, order))
        settled: set[Node] = set()
        while heap:
            cost, node, _ = heapq.heappop(heap)
            if node in settled:
                continue
            settled.add(node)
            for neighbour, edge_index in self._adjacency.get(node, []):
                edge = self.edges[edge_index]
                candidate = cost + edge.length
                if candidate < distances.get(neighbour, float("inf")):
                    distances[neighbour] = candidate
                    forward = edge.start == node
                    part = (
                        _sub(edge, 0, edge.length)
                        if forward
                        else _sub(edge, edge.length, 0)
                    )
                    previous[neighbour] = (node, part)
                    heapq.heappush(heap, (candidate, neighbour, 0))
        return distances, previous

    @staticmethod
    def _unwind(
        node: Node, previous: dict[Node, tuple[Node | None, LineString]]
    ) -> list[LineString]:
        parts: list[LineString] = []
        current: Node | None = node
        while current is not None:
            parent, part = previous[current]
            parts.append(part)
            current = parent
        parts.reverse()
        return parts

    def shortest_path(self, origin: Point, destination: Point) -> TrackPath:
        """Shortest path along the tracks from ``origin`` to ``destination``."""
        source = self.snap(origin)
        target = self.snap(destination)
        source_edge = self.edges[source.edge_index]
        target_edge = self.edges[target.edge_index]

        best_length = float("inf")
        best_parts: list[LineString] = []
        if source.edge_index == target.edge_index:
            best_length = abs(target.along - source.along)
            best_parts = [_sub(source_edge, source.along, target.along)]

        seeds = [
            (source.along, source_edge.start, _sub(source_edge, source.along, 0)),
            (
                source_edge.length - source.along,
                source_edge.end,
                _sub(source_edge, source.along, source_edge.length),
            ),
        ]
        distances, previous = self._dijkstra(seeds)
        exits = [
            (target_edge.start, target.along, _sub(target_edge, 0, target.along)),
            (
                target_edge.end,
                target_edge.length - target.along,
                _sub(target_edge, target_edge.length, target.along),
            ),
        ]
        for node, tail_length, tail in exits:
            if node not in distances:
                continue
            total = distances[node] + tail_length
            if total < best_length:
                best_length = total
                best_parts = [*self._unwind(node, previous), tail]

        if not best_parts:
            raise NoPathError("origin and destination are not connected")
        return TrackPath(
            geometry=_concat(best_parts),
            length=best_length,
            start_offset=source.offset,
            end_offset=target.offset,
        )
