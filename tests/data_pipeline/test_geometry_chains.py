"""Travel-chain validation is independent of the owner primitive set."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import Any

import pytest
from shapely.geometry import Point

from scripts.data_pipeline import config
from scripts.data_pipeline.export import (
    build_manifest,
    build_segments,
    build_services,
    build_stations,
    dumps_feature_collection,
    dumps_pretty,
    dumps_segments,
    manifest_inputs,
)
from scripts.data_pipeline.overrides import (
    Endpoints,
    LengthRef,
    LineMetadata,
    LineRange,
    Overrides,
)
from scripts.data_pipeline.registry import Registry, RegistryStation
from scripts.data_pipeline.rules import Report, ServiceStops, check_geometry_chains
from scripts.data_pipeline.validate import Dataset, to_metric, validate_dataset
from tests.data_pipeline.composition_support import recipe


def chain_fixture() -> tuple[
    list[dict[str, Any]], list[dict[str, Any]], list[ServiceStops]
]:
    services = [
        ServiceStops("owner-a", ("a", "b"), False),
        ServiceStops("owner-b", ("b", "c"), False),
        ServiceStops("rapid", ("a", "c"), False),
    ]
    features = [
        {
            "id": f"{owner}:{start}~{end}",
            "properties": {"serviceId": owner, "from": start, "to": end},
            "geometry": {"type": "LineString", "coordinates": points},
        }
        for owner, start, end, points in [
            ("owner-a", "a", "b", [[139.0, 35.0], [139.001, 35.0]]),
            ("owner-b", "b", "c", [[139.001, 35.0], [139.002, 35.0]]),
        ]
    ]
    segments = []
    for service, start, end, chain in [
        ("owner-a", "a", "b", ["owner-a:a~b"]),
        ("owner-b", "b", "c", ["owner-b:b~c"]),
        ("rapid", "a", "c", ["owner-a:a~b", "owner-b:b~c"]),
    ]:
        for a, b, ids in [(start, end, chain), (end, start, list(reversed(chain)))]:
            segments.append(
                {
                    "id": f"{service}:{a}:{b}",
                    "serviceId": service,
                    "from": a,
                    "to": b,
                    "geometryFeatureIds": ids,
                }
            )
    return segments, features, services


def test_multi_owner_rapid_chain_lengths_and_reverse_order() -> None:
    segments, features, services = chain_fixture()
    report = Report()

    lengths = check_geometry_chains(segments, features, services, report)

    assert report.errors == []
    assert lengths["rapid"] == pytest.approx(lengths["owner-a"] + lengths["owner-b"])
    assert report.metrics["geometry_reference_count"] == 8
    assert report.metrics["max_geometry_chain_length"] == 2


def test_multi_owner_rapid_chain_passes_whole_dataset_validation(
    committed_overrides: Overrides,
) -> None:
    segments, features, services = chain_fixture()
    # Add a lead-in to the first owner so the start is an interior stop of a
    # local service, outside the rapid's endpoints. Keep the two-owner hop.
    services[0] = ServiceStops("owner-a", ("lead", "start", "a", "b"), False)
    coordinates = {
        station: [139.696 + index * 0.002, 35.6]
        for index, station in enumerate(("lead", "start", "a", "b", "c"))
    }
    for feature in features:
        props = feature["properties"]
        feature["geometry"]["coordinates"] = [
            coordinates[props["from"]],
            coordinates[props["to"]],
        ]
    features[:0] = [
        {
            "id": f"owner-a:{a}~{b}",
            "properties": {"serviceId": "owner-a", "from": a, "to": b},
            "geometry": {
                "type": "LineString",
                "coordinates": [coordinates[a], coordinates[b]],
            },
        }
        for a, b in [("lead", "start"), ("start", "a")]
    ]
    for feature in features:
        feature["type"] = "Feature"
        feature["properties"].update(featureId=feature["id"], lineId="track")
    template = committed_overrides.services[0]
    service_overrides = tuple(
        replace(
            template,
            definition=replace(
                template.definition,
                id=service.id,
                name=service.id,
                kind="rapid" if service.id == "rapid" else "local",
                line_ids=("track",),
                circular=False,
                endpoints=Endpoints("terminus", "terminus"),
                expected_stop_count=len(service.station_ids),
                length_ref=LengthRef(
                    {"owner-a": 0.54, "owner-b": 0.18, "rapid": 0.36}[service.id],
                    0.02,
                    "Synthetic straight track",
                ),
            ),
            stops=tuple(
                replace(template.stops[0], order=index, station_id=station)
                for index, station in enumerate(service.station_ids, 1)
            ),
            line_ranges=(
                # Shared primitives require explicit reviewed composition metadata.
                LineRange(
                    "a",
                    "c",
                    "",
                    compose=recipe(
                        ("owner-a", "a", "b", ("track",)),
                        ("owner-b", "b", "c", ("track",)),
                    ),
                )
                if service.id == "rapid"
                else LineRange(
                    service.station_ids[0], service.station_ids[-1], "track"
                ),
            ),
            section_filters={},
        )
        for service in services
    )
    registry = Registry(
        tuple(
            RegistryStation(
                station,
                station,
                station,
                "東京都",
                "千代田区",
                "owner-b" if station == "c" else "owner-a",
            )
            for station in coordinates
        )
    )
    overrides = replace(
        committed_overrides,
        dataset=replace(
            committed_overrides.dataset,
            start_station_id="start",
            target_service_id="rapid",
            service_ids=tuple(service.id for service in services),
            reviewed_disconnected_service_ids=(),
        ),
        registry=registry,
        services=service_overrides,
        offset_exceptions=(),
        lines=(LineMetadata("track", "Track", "#000000"),),
    )
    segments = [
        segment
        for service in services
        for segment in build_segments(service.id, service.station_ids, service.circular)
    ][:-2] + segments[-2:]
    points = {
        station: Point(to_metric(position)) for station, position in coordinates.items()
    }
    stations_doc = build_stations(registry.stations, points)
    services_doc = {
        "lines": [{"id": "track", "name": "Track", "color": "#000000"}],
        "services": build_services(
            service_overrides,
            overrides.dataset.operator,
            {
                (service.id, station): points[station]
                for service in services
                for station in service.station_ids
            },
        ),
    }
    geojson = {"type": "FeatureCollection", "features": features}
    payloads = {
        config.STATIONS_FILE: dumps_pretty(stations_doc),
        config.SERVICES_FILE: dumps_pretty(services_doc),
        config.SEGMENTS_FILE: dumps_segments(segments),
        config.SEGMENTS_GEOJSON_FILE: dumps_feature_collection(geojson),
    }
    manifest = build_manifest(manifest_inputs(payloads), overrides.dataset.updated_at)
    dataset = Dataset(
        stations_doc,
        services_doc,
        segments,
        geojson,
        manifest,
        payloads,
        dumps_pretty(manifest),
    )

    report = validate_dataset(dataset, overrides)

    assert report.errors == []
    assert report.metrics["max_geometry_chain_length"] == 2
    assert report.metrics["geometry_reference_count"] == 12
    assert report.metrics["length_km[rapid]"] == pytest.approx(0.36, abs=0.02)


def test_contiguous_reverse_chain_must_exactly_reverse_forward_ids() -> None:
    segments, features, services = chain_fixture()
    alternate = deepcopy(features[1])
    alternate["id"] = "alternate-owner:b~c"
    alternate["properties"]["serviceId"] = "alternate-owner"
    features.append(alternate)
    services.append(ServiceStops("alternate-owner", ("b", "c"), False))
    for a, b in [("b", "c"), ("c", "b")]:
        segments.append(
            {
                "id": f"alternate-owner:{a}:{b}",
                "serviceId": "alternate-owner",
                "from": a,
                "to": b,
                "geometryFeatureIds": [alternate["id"]],
            }
        )
    forward, reverse = segments[4:6]
    reverse["geometryFeatureIds"] = [alternate["id"], forward["geometryFeatureIds"][0]]
    # Both routes pass all owner/ordering/joint/orphan checks when paired with
    # their own reverse. Only strict reversal equality rejects the mixed pair.
    for change_forward in [True, False]:
        matched = deepcopy(segments)
        if change_forward:
            matched[4]["geometryFeatureIds"] = list(
                reversed(reverse["geometryFeatureIds"])
            )
        else:
            matched[5]["geometryFeatureIds"] = list(
                reversed(forward["geometryFeatureIds"])
            )
        matched_report = Report()
        check_geometry_chains(matched, features, services, matched_report)
        assert matched_report.errors == []
    report = Report()

    check_geometry_chains(segments, features, services, report)

    assert len(report.errors) == 2
    assert all(
        "reverse segment chain is wrongly reversed" in error for error in report.errors
    )


@pytest.mark.parametrize(
    "problem, expected",
    [
        ("missing", "missing or empty"),
        ("empty", "missing or empty"),
        ("unknown", "unknown reference"),
        ("misordered", "misordered chain"),
        ("wrong reverse", "wrongly reversed"),
        ("wrong endpoint", "ends at b, expected c"),
        ("backtracking", "back-and-forth"),
        ("joint gap", "joint is not exact"),
        ("unknown owner", "unknown geometry owner"),
        ("orphan", "orphan owned geometry"),
    ],
)
def test_invalid_chain_is_rejected(problem: str, expected: str) -> None:
    segments, features, services = chain_fixture()
    forward, reverse = segments[-2:]
    if problem == "missing":
        del forward["geometryFeatureIds"]
    elif problem == "empty":
        forward["geometryFeatureIds"] = []
    elif problem == "unknown":
        forward["geometryFeatureIds"] = ["unknown"]
    elif problem == "misordered":
        forward["geometryFeatureIds"].reverse()
    elif problem == "wrong reverse":
        reverse["geometryFeatureIds"] = forward["geometryFeatureIds"].copy()
    elif problem == "wrong endpoint":
        forward["geometryFeatureIds"] = ["owner-a:a~b"]
    elif problem == "backtracking":
        forward["geometryFeatureIds"] = ["owner-a:a~b", "owner-a:a~b", "owner-b:b~c"]
    elif problem == "joint gap":
        features[1]["geometry"]["coordinates"][0][0] += 0.000001
    elif problem == "unknown owner":
        features[0]["properties"]["serviceId"] = "unknown"
    elif problem == "orphan":
        features.append({**features[0], "id": "unused"})
    report = Report()

    check_geometry_chains(segments, features, services, report)

    assert expected in "\n".join(report.errors)
