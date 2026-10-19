"""Integration checks for operator-aware metadata and artifact validation."""

from __future__ import annotations

from dataclasses import replace

from shapely.geometry import Point

from scripts.data_pipeline import export
from scripts.data_pipeline.rules import Report
from scripts.data_pipeline.validate import check_services


def test_export_and_validation_use_service_operator(
    committed_overrides,
) -> None:
    original = committed_overrides.service("jr-keiyo")
    service = replace(
        original,
        definition=replace(original.definition, operator="Test Railway"),
    )
    overrides = replace(
        committed_overrides,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )
    platforms = {
        (service.id, station_id): Point(0, 0) for station_id in service.station_ids
    }

    exported = export.build_services([service], overrides.dataset, platforms)

    assert exported[0]["operator"] == "Test Railway"
    artifact = {
        "lines": [
            {"id": line.id, "name": line.name, "color": line.color}
            for line in overrides.lines
        ],
        "services": exported,
    }
    report = Report()
    check_services(artifact, {}, overrides, report)
    assert not any("operator differs" in error for error in report.errors)

    wrong_operator_artifact = {
        **artifact,
        "services": [{**exported[0], "operator": overrides.dataset.operator}],
    }
    report = Report()
    check_services(wrong_operator_artifact, {}, overrides, report)
    assert any("operator differs" in error for error in report.errors)
