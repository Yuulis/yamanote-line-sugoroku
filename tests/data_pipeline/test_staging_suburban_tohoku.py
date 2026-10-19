"""Raw N02 regressions for the staged Tohoku and Joban services."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.overrides import load_overrides

STAGE_DIR = (
    config.REPO_ROOT / "data" / "staging" / "tokyo-suburban-jr" / "tohoku" / "overrides"
)

pytestmark = pytest.mark.skipif(
    not (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded (see data/README.md)",
)


def _assert_area_boundary(
    overrides,
    service_id,
    terminal,
    terminal_prefecture,
    terminal_municipality,
    neighbour,
    neighbour_prefecture,
    neighbour_municipality,
):
    service = overrides.service(service_id)
    assert service.stops[-1].station_id == terminal
    assert service.scope_stops[-2].station_id == terminal
    assert (
        service.scope_stops[-2].prefecture,
        service.scope_stops[-2].municipality,
    ) == (
        terminal_prefecture,
        terminal_municipality,
    )
    assert service.scope_stops[-2].in_area is True
    assert service.scope_stops[-1].station_id == neighbour
    assert (
        service.scope_stops[-1].prefecture,
        service.scope_stops[-1].municipality,
    ) == (
        neighbour_prefecture,
        neighbour_municipality,
    )
    assert service.scope_stops[-1].in_area is False
    assert service.definition.endpoints.last == "area-boundary"


def test_tohoku_area_boundaries_match_independent_r1_expectations() -> None:
    overrides = load_overrides(STAGE_DIR)
    _assert_area_boundary(
        overrides,
        "jr-utsunomiya",
        "kuroiso",
        "栃木県",
        "那須塩原市",
        "takaku",
        "栃木県",
        "那須塩原市",
    )
    _assert_area_boundary(
        overrides,
        "jr-joban-rapid",
        "namie",
        "福島県",
        "浪江町",
        "momouchi",
        "福島県",
        "南相馬市",
    )
    _assert_area_boundary(
        overrides,
        "jr-suigun",
        "hitachi-daigo",
        "茨城県",
        "大子町",
        "shimonomiya",
        "茨城県",
        "久慈郡大子町",
    )


def test_tohoku_scope_boundary_expectation_rejects_a_farther_neighbour() -> None:
    overrides = load_overrides(STAGE_DIR)
    service = overrides.service("jr-joban-rapid")
    mutated_scope = (
        *service.scope_stops[:-1],
        replace(service.scope_stops[-1], station_id="odaka"),
    )
    mutated_service = replace(service, scope_stops=mutated_scope)
    mutated_overrides = replace(
        overrides,
        services=tuple(
            mutated_service if item.id == service.id else item
            for item in overrides.services
        ),
    )
    with pytest.raises(AssertionError):
        _assert_area_boundary(
            mutated_overrides,
            "jr-joban-rapid",
            "namie",
            "福島県",
            "浪江町",
            "momouchi",
            "福島県",
            "南相馬市",
        )


def test_tohoku_routes_known_platform_gaps_and_j_village_junction() -> None:
    overrides = load_overrides(STAGE_DIR)
    result = generate_build(config.DEFAULT_RAW_DIR, overrides)

    mito = result.services["jr-mito"].routed
    assert mito.departure(0).station_code == "002410"
    assert mito.departure(0).group_code == "002407"
    assert result.services["jr-mito"].segment_lines[0] == "水戸線"

    suigun = result.services["jr-suigun"].routed
    assert suigun.departure(0).station_code == "002317"
    assert suigun.departure(0).group_code == "002319"
    assert result.services["jr-suigun"].segment_lines[0] == "水郡線"

    joban_service = result.services["jr-joban-rapid"]
    j_village = joban_service.service.station_ids.index("j-village")
    assert joban_service.segment_lines[j_village - 1 : j_village + 1] == (
        "常磐線",
        "常磐線",
    )
    assert all(
        path.length > 0
        for path in joban_service.routed.paths[j_village - 1 : j_village + 1]
    )


def test_tohoku_uses_frozen_spelling_for_fubasami() -> None:
    overrides = load_overrides(STAGE_DIR)
    fubasami = next(
        stop
        for stop in overrides.service("jr-nikko").stops
        if stop.station_id == "fubasami"
    )
    assert overrides.registry.by_id()["fubasami"].name == "文挾"
    assert fubasami.n02_name == "文挟"


def test_tohoku_build_preserves_shipped_platforms_and_geometry() -> None:
    overrides = load_overrides(STAGE_DIR)
    result = generate_build(config.DEFAULT_RAW_DIR, overrides)
    shipped_services = json.loads(
        (config.REPO_ROOT / "public" / "data" / "services.json").read_text(
            encoding="utf-8"
        )
    )["services"]
    staged_services = json.loads(result.files[config.SERVICES_FILE])["services"]
    shipped_by_id = {service["id"]: service for service in shipped_services}
    staged_by_id = {service["id"]: service for service in staged_services}

    for service_id in (
        "jr-utsunomiya",
        "jr-shonan-shinjuku-local",
        "jr-joban-rapid",
        "jr-joban-local",
        "jr-kashima",
    ):
        shipped_platforms = shipped_by_id[service_id]["platformCoordinates"]
        staged_platforms = staged_by_id[service_id]["platformCoordinates"]
        assert all(
            staged_platforms[station_id] == coordinates
            for station_id, coordinates in shipped_platforms.items()
        )
