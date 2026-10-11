from __future__ import annotations

import dataclasses

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.validate import Dataset, validate_dataset


def _official_order() -> list[tuple[str, str]]:
    stations = load_overrides(config.DEFAULT_OVERRIDES_DIR).stations
    return [(station.id, station.name) for station in stations]


def _errors(dataset: Dataset) -> str:
    return "\n".join(validate_dataset(dataset, _official_order()).errors)


def test_validate_published_data_passes(published_dataset: Dataset) -> None:
    report = validate_dataset(published_dataset, _official_order())

    assert report.errors == []
    assert report.metrics["max_endpoint_distance_m"] <= config.ENDPOINT_MAX_DISTANCE_M
    assert report.metrics["segments_geojson_bytes"] < config.MAX_GEOJSON_BYTES


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


def test_validate_with_duplicate_station_id_fails(dataset: Dataset) -> None:
    dataset.stations[1]["id"] = dataset.stations[0]["id"]

    assert "duplicate station id" in _errors(dataset)


def test_validate_with_missing_station_fails(dataset: Dataset) -> None:
    del dataset.stations[5]

    assert "expected 30 stations" in _errors(dataset)


def test_validate_with_broken_chain_fails(dataset: Dataset) -> None:
    dataset.segments[3]["to"] = "tokyo"

    errors = _errors(dataset)

    assert "segments[3].to != next segment's from" in errors
    assert "30-step walk" in errors or "walk stuck" in errors


def test_validate_with_missing_geometry_fails(dataset: Dataset) -> None:
    del dataset.geojson["features"][7]

    assert "missing geometry" in _errors(dataset)


def test_validate_with_far_endpoint_fails(dataset: Dataset) -> None:
    coordinates = dataset.geojson["features"][0]["geometry"]["coordinates"]
    coordinates[0] = [coordinates[0][0] + 0.001, coordinates[0][1]]  # ~90 m east

    assert "endpoint" in _errors(dataset)


def test_validate_with_swapped_station_order_fails(dataset: Dataset) -> None:
    dataset.stations[5], dataset.stations[6] = dataset.stations[6], dataset.stations[5]

    assert "order differs" in _errors(dataset)


def test_validate_with_crs_member_fails(dataset: Dataset) -> None:
    dataset.geojson["crs"] = {"type": "name"}

    assert "crs" in _errors(dataset)


def test_validate_with_unrounded_coordinates_fails(dataset: Dataset) -> None:
    coordinates = dataset.geojson["features"][2]["geometry"]["coordinates"]
    coordinates[1] = [coordinates[1][0] + 1e-9, coordinates[1][1]]

    assert "not rounded" in _errors(dataset)


@pytest.mark.parametrize("key, value", [("license", "CC0"), ("baseDate", "2024-01-01")])
def test_validate_with_wrong_manifest_source_fails(
    dataset: Dataset, key: str, value: str
) -> None:
    dataset.manifest["source"][key] = value

    assert "manifest.source" in _errors(dataset)


def test_validate_with_oversized_geojson_fails(dataset: Dataset) -> None:
    padding = " " * (config.MAX_GEOJSON_BYTES + 1)
    payloads = {
        **dataset.payloads,
        config.SEGMENTS_GEOJSON_FILE: dataset.payloads[config.SEGMENTS_GEOJSON_FILE]
        + padding,
    }
    oversized = dataclasses.replace(dataset, payloads=payloads)

    assert "segments.geojson is" in _errors(oversized)


def test_validate_with_renamed_station_fails(dataset: Dataset) -> None:
    dataset.stations[0]["name"] = "Wrong Station"

    assert "(id, name) order differs" in _errors(dataset)


def test_validate_with_non_feature_member_fails(dataset: Dataset) -> None:
    dataset.geojson["features"][4]["type"] = "NotAFeature"

    assert "is not a GeoJSON Feature" in _errors(dataset)


def test_validate_with_multilinestring_gap_fails(dataset: Dataset) -> None:
    geometry = dataset.geojson["features"][0]["geometry"]
    coordinates = geometry["coordinates"]
    dataset.geojson["features"][0]["geometry"] = {
        "type": "MultiLineString",
        "coordinates": [coordinates[:2], coordinates[-2:]],
    }

    assert "gap between parts" in _errors(dataset)


def test_validate_with_contiguous_multilinestring_passes(dataset: Dataset) -> None:
    coordinates = dataset.geojson["features"][0]["geometry"]["coordinates"]
    dataset.geojson["features"][0]["geometry"] = {
        "type": "MultiLineString",
        "coordinates": [coordinates[:3], coordinates[2:]],
    }

    assert _errors(dataset) == ""


def test_validate_with_stale_data_version_fails(dataset: Dataset) -> None:
    dataset.manifest["dataVersion"] = "anything"

    assert "dataVersion is stale" in _errors(dataset)


def test_validate_with_edited_payload_flags_stale_version(dataset: Dataset) -> None:
    payloads = {
        **dataset.payloads,
        config.STATIONS_FILE: dataset.payloads[config.STATIONS_FILE] + " ",
    }

    assert "dataVersion is stale" in _errors(
        dataclasses.replace(dataset, payloads=payloads)
    )


def test_validate_with_null_station_ids_reports_instead_of_crashing(
    dataset: Dataset,
) -> None:
    dataset.services[0]["stationIds"] = None
    dataset.stations[3]["name"] = {}

    errors = _errors(dataset)

    assert "stationIds must be an array of strings" in errors
    assert "has no name" in errors
