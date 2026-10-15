"""Artifact checks against reviewed composition recipes and inherited anchors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from shapely.geometry import LineString, Point

from scripts.data_pipeline import config, rules
from scripts.data_pipeline.composition import compose_chains, exact_chain_coordinates
from scripts.data_pipeline.export import feature_id
from scripts.data_pipeline.override_models import Overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.topology import station_pairs


def check_composed_artifacts(
    segments: Sequence[Mapping[str, Any]],
    features: Sequence[Mapping[str, Any]],
    overrides: Overrides,
    platforms: Mapping[tuple[str, str], Point],
    report: rules.Report,
) -> None:
    owned = {
        (service.id, a, b): feature_id(service.id, a, b)
        for service in overrides.services
        for (a, b), item in zip(
            station_pairs(service.station_ids, service.circular),
            service.segment_ranges(),
            strict=True,
        )
        if not item.compose
    }
    expected = compose_chains(overrides, owned)
    by_id = {
        str(feature.get("id")): feature
        for feature in features
        if isinstance(feature.get("id"), str)
    }
    required_ids = set(owned.values())
    if set(by_id) != required_ids:
        report.errors.append(
            "routed primitive id set differs from reviewed recipes: "
            f"missing {sorted(required_ids - set(by_id))}, "
            f"extra {sorted(set(by_id) - required_ids)}"
        )
    for segment in segments:
        identifier, a, b = (segment.get(key) for key in ("serviceId", "from", "to"))
        if (
            not isinstance(identifier, str)
            or not isinstance(a, str)
            or not isinstance(b, str)
        ):
            continue
        try:
            service = overrides.service(identifier)
        except KeyError:
            continue
        pairs = station_pairs(service.station_ids, service.circular)
        canonical = (a, b) if (a, b) in pairs else (b, a)
        if canonical not in pairs:
            continue
        item = service.segment_ranges()[pairs.index(canonical)]
        chain = expected[(identifier, *canonical)]
        if canonical != (a, b):
            chain = list(reversed(chain))
        if segment.get("geometryFeatureIds") != chain:
            kind = "compose" if item.compose else "route"
            report.errors.append(
                f"{segment.get('id')}: {kind} chain differs from reviewed recipe"
            )
            continue
        if not item.compose:
            continue
        try:
            coordinates = exact_chain_coordinates(chain, by_id, a)
        except (KeyError, OverrideError) as error:
            report.errors.append(f"{segment.get('id')}: {error}")
            continue
        # Inherited platforms equal output primitive anchors, not nearby platforms.
        # A reviewed transfer publishes the arrival anchor; only the departing
        # side of the canonical +1 pair may use another anchor of the stop.
        from scripts.data_pipeline.validate import to_metric

        ends: dict[str, Point] = {}
        for station, coordinate in ((a, coordinates[0]), (b, coordinates[-1])):
            point = platforms.get((identifier, station))
            anchor = Point(to_metric(coordinate))
            transfer = (
                overrides.transfer_limit(identifier, station)
                if station == canonical[0]
                else None
            )
            ends[station] = anchor if transfer is not None or point is None else point
            if point is None or (
                point.coords[0] != anchor.coords[0]
                and (
                    transfer is None
                    or point.distance(anchor) > transfer + config.COORDINATE_ROUNDING_M
                )
            ):
                report.errors.append(
                    f"{identifier}: compose platform is not exact primitive anchor at {station}"
                )
        geometry = LineString([to_metric(point) for point in coordinates])
        service_points = {
            station: point
            for (owner, station), point in platforms.items()
            if owner == identifier
        }
        rules.check_skipped_stops(
            str(segment.get("id")), geometry, (a, b), service_points, report
        )
        rules.check_detour(
            str(segment.get("id")),
            geometry,
            ends[a],
            ends[b],
            overrides.detour_limit(identifier, *canonical),
            report,
        )


def check_platform_transfers(
    segments: Sequence[Mapping[str, Any]],
    features: Sequence[Mapping[str, Any]],
    overrides: Overrides,
    report: rules.Report,
) -> None:
    """A reviewed transfer must be used: the +1 chains into and out of it differ."""
    by_id = {
        str(feature.get("id")): feature
        for feature in features
        if isinstance(feature.get("id"), str)
    }
    chains = {
        str(segment.get("id")): segment.get("geometryFeatureIds")
        for segment in segments
    }
    for transfer in overrides.platform_transfers:
        service = overrides.service(transfer.service_id)
        stops = service.station_ids
        index = stops.index(transfer.station_id)
        legs = []
        for start, end in (
            (stops[index - 1], stops[index]),
            (stops[index], stops[index + 1]),
        ):
            chain = chains.get(f"{service.id}:{start}:{end}")
            if (
                not isinstance(chain, list)
                or not chain
                or not all(isinstance(item, str) and item for item in chain)
            ):
                break  # malformed chains are reported by the chain checks
            try:
                legs.append(exact_chain_coordinates(chain, by_id, start))
            except (KeyError, OverrideError):
                break  # reported by the chain and composition checks
        if len(legs) == 2 and legs[0][-1] == legs[1][0]:
            report.errors.append(
                f"{service.id}: platform transfer at {transfer.station_id} is unused"
            )
