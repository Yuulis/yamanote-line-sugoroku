"""Reviewed composition recipes, dependency order and primitive traversal."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.topology import station_pairs

if TYPE_CHECKING:
    from scripts.data_pipeline.override_models import Overrides, ServiceOverrides


@dataclass(frozen=True)
class SharedTrackEvidence:
    lines: tuple[str, ...]
    section_filter: SectionFilter
    reason: str
    line_filters: tuple[tuple[str, SectionFilter], ...] = ()

    def filter_for(self, line: str) -> SectionFilter:
        return dict(self.line_filters).get(line, self.section_filter)


@dataclass(frozen=True)
class ComposeLeg:
    source_service: str
    from_id: str
    to_id: str
    evidence: SharedTrackEvidence


@dataclass(frozen=True)
class ComposeRecipe:
    legs: tuple[ComposeLeg, ...]


def parse_compose(value: str) -> ComposeRecipe | None:
    if not value.strip():
        return None
    try:
        raw = json.loads(value)
    except json.JSONDecodeError as error:
        raise OverrideError(f"compose is not valid JSON: {error}") from error
    if not isinstance(raw, dict) or set(raw) != {"legs", "shared_track_evidence"}:
        raise OverrideError("compose needs legs and shared_track_evidence")
    legs, evidence = raw["legs"], raw["shared_track_evidence"]
    if (
        not isinstance(legs, list)
        or not legs
        or not isinstance(evidence, list)
        or len(legs) != len(evidence)
    ):
        raise OverrideError("compose needs one shared_track_evidence per leg")
    parsed = []
    for leg, witness in zip(legs, evidence, strict=True):
        if (
            not isinstance(leg, dict)
            or set(leg) != {"source_service", "from", "to"}
            or not all(isinstance(v, str) and v.strip() for v in leg.values())
        ):
            raise OverrideError("compose leg needs source_service/from/to strings")
        if not isinstance(witness, dict) or set(witness) - {"line_filters"} != {
            "lines",
            "allow",
            "deny",
            "reason",
        }:
            raise OverrideError("shared_track_evidence needs lines/allow/deny/reason")
        if not isinstance(witness["reason"], str) or not witness["reason"].strip():
            raise OverrideError("shared_track_evidence needs a review reason")
        for key in ("lines", "allow", "deny"):
            items = witness[key]
            if (
                not isinstance(items, list)
                or not all(isinstance(v, str) and v.strip() for v in items)
                or len(items) != len(set(items))
            ):
                raise OverrideError(f"shared_track_evidence {key} needs unique strings")
        if not witness["lines"] or set(witness["allow"]) & set(witness["deny"]):
            raise OverrideError(
                "shared_track_evidence has empty lines or conflicting filters"
            )
        line_filters = witness.get("line_filters", {})
        if not isinstance(line_filters, dict) or (
            line_filters and set(line_filters) != set(witness["lines"])
        ):
            raise OverrideError(
                "shared_track_evidence line_filters must cover exactly its lines"
            )
        filters = []
        for line, item in line_filters.items():
            if not isinstance(item, dict) or set(item) != {"allow", "deny"}:
                raise OverrideError("line_filters need allow/deny arrays")
            for key in ("allow", "deny"):
                if (
                    not isinstance(item[key], list)
                    or not all(
                        isinstance(value, str) and value.strip() for value in item[key]
                    )
                    or len(item[key]) != len(set(item[key]))
                ):
                    raise OverrideError("line_filters need unique section keys")
            if set(item["allow"]) & set(item["deny"]):
                raise OverrideError("line_filters contain conflicting section keys")
            filters.append(
                (line, SectionFilter(frozenset(item["allow"]), frozenset(item["deny"])))
            )
        parsed.append(
            ComposeLeg(
                leg["source_service"],
                leg["from"],
                leg["to"],
                SharedTrackEvidence(
                    tuple(witness["lines"]),
                    SectionFilter(
                        frozenset(witness["allow"]), frozenset(witness["deny"])
                    ),
                    witness["reason"],
                    tuple(filters),
                ),
            )
        )
    return ComposeRecipe(tuple(parsed))


def dependency_order(services: Sequence[ServiceOverrides]) -> tuple[str, ...]:
    """Topological build order; catalogue order is deliberately a separate input."""
    by_id = {service.id: service for service in services}
    visiting: set[str] = set()
    completed: set[str] = set()
    ordered: list[str] = []

    def visit(identifier: str) -> None:
        if identifier in completed:
            return
        if identifier in visiting:
            raise OverrideError(f"compose dependency cycle at {identifier}")
        if identifier not in by_id:
            raise OverrideError(f"compose unknown source service {identifier}")
        visiting.add(identifier)
        for item in by_id[identifier].segment_ranges():
            if item.compose:
                for leg in item.compose.legs:
                    visit(leg.source_service)
        visiting.remove(identifier)
        completed.add(identifier)
        ordered.append(identifier)

    for service in services:
        visit(service.id)
    return tuple(ordered)


Primitive = tuple[str, str, str, bool]  # owner, canonical from/to, reversed


def source_pairs(
    service: ServiceOverrides, start: str, end: str
) -> list[tuple[str, str, bool]]:
    ids = service.station_ids
    if start not in ids or end not in ids or start == end:
        raise OverrideError(
            f"compose invalid source anchors {service.id}:{start}->{end}"
        )
    first, last = ids.index(start), ids.index(end)
    if service.circular:
        indexes = [(first + i) % len(ids) for i in range((last - first) % len(ids))]
        return [(ids[i], ids[(i + 1) % len(ids)], False) for i in indexes]
    if first < last:
        return [(ids[i], ids[i + 1], False) for i in range(first, last)]
    return [(ids[i - 1], ids[i], True) for i in range(first, last, -1)]


def flatten_recipe(
    overrides: Overrides,
    recipe: ComposeRecipe,
    *,
    max_primitives: int = config.MAX_COMPOSE_PRIMITIVES,
) -> tuple[Primitive, ...]:
    """Expand with bounded allocations and invocation-local indexes/cache.

    Cache only complete expansions: each leg's evidence is still checked against
    the ultimate routed owners, including when a nested result is reused.
    """
    dependency_order(overrides.services)
    services = {service.id: service for service in overrides.services}
    ranges = {
        (service.id, a, b): item
        for service in overrides.services
        for (a, b), item in zip(
            station_pairs(service.station_ids, service.circular),
            service.segment_ranges(),
            strict=True,
        )
    }
    cache: dict[ComposeRecipe, tuple[Primitive, ...]] = {}

    def expand(current: ComposeRecipe) -> tuple[Primitive, ...]:
        if current in cache:
            return cache[current]
        primitives: list[Primitive] = []
        for leg in current.legs:
            source = services[leg.source_service]
            expanded: list[Primitive] = []
            for a, b, reverse in source_pairs(source, leg.from_id, leg.to_id):
                item = ranges[(source.id, a, b)]
                nested = (
                    expand(item.compose)
                    if item.compose
                    else ((source.id, a, b, False),)
                )
                if len(primitives) + len(expanded) + len(nested) > max_primitives:
                    raise OverrideError(
                        f"compose expansion exceeds primitive limit {max_primitives}"
                    )
                if reverse:
                    expanded.extend(
                        (owner, x, y, not rev) for owner, x, y, rev in reversed(nested)
                    )
                else:
                    expanded.extend(nested)
            lines: set[str] = set()
            for owner, a, b, _ in expanded:
                owner_service = services[owner]
                item = ranges[(owner, a, b)]
                lines.update(item.route_lines)
                if any(
                    owner_service.section_filter(line) != leg.evidence.filter_for(line)
                    for line in item.route_lines
                ):
                    raise OverrideError(
                        "compose wrong-track sharing: section filter differs from owner"
                    )
            if lines != set(leg.evidence.lines):
                raise OverrideError(
                    "compose wrong-track sharing: N02 lines differ from owner"
                )
            primitives.extend(expanded)
        cache[current] = tuple(primitives)
        return cache[current]

    return expand(recipe)


def check_recipe_anchors(start: str, end: str, primitives: Sequence[Primitive]) -> None:
    current = start
    visited = {start}
    for _, a, b, reverse in primitives:
        origin, destination = (b, a) if reverse else (a, b)
        if origin != current:
            raise OverrideError(
                f"compose misordered multi-owner leg: {origin} does not join {current}"
            )
        if destination in visited:
            raise OverrideError("compose backtracking through a repeated station")
        visited.add(destination)
        current = destination
    if current != end:
        raise OverrideError(f"compose wrong last station {current}, expected {end}")


def check_recipes(overrides: Overrides) -> None:
    dependency_order(overrides.services)
    for service in overrides.services:
        for (a, b), item in zip(
            station_pairs(service.station_ids, service.circular),
            service.segment_ranges(),
            strict=True,
        ):
            if item.compose:
                check_recipe_anchors(a, b, flatten_recipe(overrides, item.compose))


def compose_chains(
    overrides: Overrides, owned: Mapping[tuple[str, str, str], str]
) -> dict[tuple[str, str, str], list[str]]:
    """Flat canonical forward chains, resolved without affecting output order."""
    check_recipes(overrides)
    chains = {}
    for identifier in dependency_order(overrides.services):
        service = overrides.service(identifier)
        for (a, b), item in zip(
            station_pairs(service.station_ids, service.circular),
            service.segment_ranges(),
            strict=True,
        ):
            primitives = (
                flatten_recipe(overrides, item.compose)
                if item.compose
                else ((identifier, a, b, False),)
            )
            chains[(identifier, a, b)] = [
                owned[(owner, x, y)] for owner, x, y, _ in primitives
            ]
    return chains


def oriented_coordinates(
    feature: Mapping[str, Any], current: str
) -> tuple[str, list[Any]]:
    props = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(props, dict) or not isinstance(geometry, dict):
        raise OverrideError("compose invalid primitive properties or geometry")
    coordinates = geometry.get("coordinates")
    if (
        geometry.get("type") != "LineString"
        or not isinstance(coordinates, list)
        or len(coordinates) < 2
        or not all(
            isinstance(point, list)
            and len(point) == 2
            and all(
                isinstance(value, int | float)
                and not isinstance(value, bool)
                and math.isfinite(value)
                for value in point
            )
            for point in coordinates
        )
    ):
        raise OverrideError("compose invalid primitive coordinates")
    if not isinstance(props.get("from"), str) or not isinstance(props.get("to"), str):
        raise OverrideError("compose invalid primitive station anchors")
    if props["from"] == current:
        return props["to"], coordinates
    if props["to"] == current:
        return props["from"], list(reversed(coordinates))
    raise OverrideError(f"compose feature does not join {current}")


def exact_chain_coordinates(
    chain: Sequence[str], features: Mapping[str, Mapping[str, Any]], start: str
) -> list[Any]:
    coordinates: list[Any] = []
    current = start
    for identifier in chain:
        current, points = oriented_coordinates(features[identifier], current)
        if coordinates and coordinates[-1] != points[0]:
            raise OverrideError(f"compose platform-gap joint is not exact at {current}")
        coordinates.extend(points[1:] if coordinates else points)
    return coordinates
