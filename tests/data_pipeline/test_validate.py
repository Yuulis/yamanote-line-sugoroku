from __future__ import annotations

import dataclasses

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import Overrides
from scripts.data_pipeline.validate import Dataset, validate_dataset


def _errors(
    dataset: Dataset, overrides: Overrides, updated_at: str | None = None
) -> str:
    if updated_at is not None:
        overrides = dataclasses.replace(
            overrides,
            dataset=dataclasses.replace(overrides.dataset, updated_at=updated_at),
        )
    return "\n".join(validate_dataset(dataset, overrides).errors)


def test_validate_published_data_passes(
    published_dataset: Dataset, committed_overrides: Overrides
) -> None:
    report = validate_dataset(published_dataset, committed_overrides)

    assert report.errors == []
    assert report.metrics["max_endpoint_distance_m"] <= config.ENDPOINT_MAX_DISTANCE_M
    assert report.metrics["segments_geojson_bytes"] < config.MAX_GEOJSON_BYTES
    assert report.metrics["length_km[jr-yamanote]"] == pytest.approx(34.5, abs=1.5)
    assert report.metrics["other_station_passes"] == 0


def test_validate_published_data_has_contract_shapes(
    published_dataset: Dataset,
) -> None:
    station = published_dataset.stations[0]
    service = published_dataset.services[0]

    assert list(station) == ["id", "name", "coordinates"]
    assert station["id"] == "shimbashi"
    assert service["stationIds"][0] == "shimbashi"
    assert service["stationIds"][-1] == "yurakucho"
    assert service["color"] == "#9ACD32"
    assert {"takanawa-gateway", "nishi-nippori", "shin-okubo", "takadanobaba"} <= set(
        service["stationIds"]
    )


def test_validate_with_duplicate_station_id_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.stations[1]["id"] = dataset.stations[0]["id"]

    assert "duplicate station id" in _errors(dataset, committed_overrides)


def test_validate_with_missing_station_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    del dataset.stations[5]

    assert "expected 30 stations" in _errors(dataset, committed_overrides)


def test_validate_with_broken_chain_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.segments[3]["to"] = "tokyo"

    errors = _errors(dataset, committed_overrides)

    assert "segments[3] differs from the directed pair contract" in errors
    assert "30-step walk" in errors


def test_validate_with_missing_geometry_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    del dataset.geojson["features"][7]

    assert "missing geometry" in _errors(dataset, committed_overrides)


def test_validate_with_far_endpoint_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    coordinates = dataset.geojson["features"][0]["geometry"]["coordinates"]
    coordinates[0] = [coordinates[0][0] + 0.001, coordinates[0][1]]  # ~90 m east

    assert "endpoint" in _errors(dataset, committed_overrides)


def test_validate_with_swapped_station_order_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.stations[5], dataset.stations[6] = dataset.stations[6], dataset.stations[5]

    assert "order differs" in _errors(dataset, committed_overrides)


def test_validate_with_crs_member_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.geojson["crs"] = {"type": "name"}

    assert "crs" in _errors(dataset, committed_overrides)


def test_validate_with_unrounded_coordinates_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    coordinates = dataset.geojson["features"][2]["geometry"]["coordinates"]
    coordinates[1] = [coordinates[1][0] + 1e-9, coordinates[1][1]]

    assert "not rounded" in _errors(dataset, committed_overrides)


@pytest.mark.parametrize("key, value", [("license", "CC0"), ("baseDate", "2024-01-01")])
def test_validate_with_wrong_manifest_source_fails(
    dataset: Dataset, committed_overrides: Overrides, key: str, value: str
) -> None:
    dataset.manifest["source"][key] = value

    assert "manifest.source" in _errors(dataset, committed_overrides)


def test_validate_published_manifest_has_override_updated_at(
    published_dataset: Dataset, committed_overrides: Overrides
) -> None:
    updated_at = committed_overrides.dataset.updated_at

    report = validate_dataset(published_dataset, committed_overrides)

    assert report.errors == []
    assert published_dataset.manifest["updatedAt"] == updated_at


@pytest.mark.parametrize("value", ["2026-13-01", "2026/10/11", "", None, 20261011])
def test_validate_with_malformed_updated_at_fails(
    dataset: Dataset, committed_overrides: Overrides, value: object
) -> None:
    dataset.manifest["updatedAt"] = value

    assert "manifest.updatedAt must be" in _errors(dataset, committed_overrides)


def test_validate_with_missing_updated_at_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    del dataset.manifest["updatedAt"]

    assert "updatedAt" in _errors(dataset, committed_overrides)


def test_validate_with_updated_at_differing_from_override_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    assert "differs from the override" in _errors(
        dataset, committed_overrides, "2099-01-01"
    )


def test_validate_with_oversized_geojson_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    padding = " " * (config.MAX_GEOJSON_BYTES + 1)
    payloads = {
        **dataset.payloads,
        config.SEGMENTS_GEOJSON_FILE: dataset.payloads[config.SEGMENTS_GEOJSON_FILE]
        + padding,
    }
    oversized = dataclasses.replace(dataset, payloads=payloads)

    assert "segments.geojson is" in _errors(oversized, committed_overrides)


def test_validate_with_renamed_station_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.stations[0]["name"] = "Wrong Station"

    assert "(id, name) order differs" in _errors(dataset, committed_overrides)


def test_validate_with_non_feature_member_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.geojson["features"][4]["type"] = "NotAFeature"

    assert "is not a GeoJSON Feature" in _errors(dataset, committed_overrides)


def test_validate_with_multilinestring_gap_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    geometry = dataset.geojson["features"][0]["geometry"]
    coordinates = geometry["coordinates"]
    dataset.geojson["features"][0]["geometry"] = {
        "type": "MultiLineString",
        "coordinates": [coordinates[:2], coordinates[-2:]],
    }

    assert "geometry must be a LineString" in _errors(dataset, committed_overrides)


def test_validate_with_contiguous_multilinestring_is_rejected_in_v2(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    coordinates = dataset.geojson["features"][0]["geometry"]["coordinates"]
    dataset.geojson["features"][0]["geometry"] = {
        "type": "MultiLineString",
        "coordinates": [coordinates[:3], coordinates[2:]],
    }

    assert "geometry must be a LineString" in _errors(dataset, committed_overrides)


def test_validate_with_stale_data_version_fails(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.manifest["dataVersion"] = "anything"

    assert "dataVersion is stale" in _errors(dataset, committed_overrides)


def test_validate_with_edited_payload_flags_stale_version(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    payloads = {
        **dataset.payloads,
        config.STATIONS_FILE: dataset.payloads[config.STATIONS_FILE] + " ",
    }

    assert "dataVersion is stale" in _errors(
        dataclasses.replace(dataset, payloads=payloads), committed_overrides
    )


def test_validate_with_null_station_ids_reports_instead_of_crashing(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    dataset.services[0]["stationIds"] = None
    dataset.stations[3]["name"] = {}

    errors = _errors(dataset, committed_overrides)

    assert "stationIds must be an array of strings" in errors
    assert "has no name" in errors


@pytest.mark.parametrize(
    "edit, expected",
    [
        (lambda d: d.manifest.update(schemaVersion=1), "schemaVersion must be 2"),
        (lambda d: d.services[0].update(circular=1), "circular must be a boolean"),
        (lambda d: d.services[0].update(directionLabels={}), "directionLabels differ"),
        (
            lambda d: d.services[0].update(
                endpoints={"first": "terminus", "last": "terminus"}
            ),
            "invalid v2 fields",
        ),
        (
            lambda d: d.services[0]["platformCoordinates"].pop("tokyo"),
            "cover exactly its stops",
        ),
        (
            lambda d: d.services[0]["platformCoordinates"].update(tokyo=[139.8, 35.8]),
            "representative platform",
        ),
        (
            lambda d: d.services[0].update(
                stationIds=["shimbashi", "tokyo", "yurakucho"]
            ),
            "stop order differs",
        ),
        (
            lambda d: d.segments[0].update(geometryFeatureId="orphan"),
            "directed pair contract",
        ),
        (
            lambda d: d.geojson["features"].append(d.geojson["features"][0]),
            "duplicate geometry feature",
        ),
        (
            lambda d: d.geojson["features"][0]["properties"].update(from_="other"),
            "properties mismatch",
        ),
        (
            lambda d: d.geojson["features"][0]["geometry"]["coordinates"].reverse(),
            "endpoint",
        ),
    ],
)
def test_v2_contract_rejects_invalid_metadata_and_geometry(
    dataset: Dataset, committed_overrides: Overrides, edit: object, expected: str
) -> None:
    # Callables are parametrized independently so each corruption has its own report.
    from collections.abc import Callable

    assert isinstance(edit, Callable)
    edit(dataset)
    assert expected in _errors(dataset, committed_overrides)


def test_noncanonical_bytes_fail_even_with_recomputed_hash(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    from scripts.data_pipeline.export import data_version, manifest_inputs

    dataset.payloads[config.STATIONS_FILE] += " "
    dataset.manifest["dataVersion"] = data_version(manifest_inputs(dataset.payloads))
    assert "bytes are not the canonical" in _errors(dataset, committed_overrides)
