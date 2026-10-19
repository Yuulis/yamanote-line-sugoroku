"""Raw N02 regressions for Chuo/Shinonoi/Shinetsu staging."""

from __future__ import annotations

import csv
from dataclasses import replace

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_jr import ROOT

RAW_AVAILABLE = (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file()
pytestmark = pytest.mark.skipif(
    not RAW_AVAILABLE, reason="raw N02 data not downloaded (see data/README.md)"
)

STAGE_DIR = ROOT / "data/staging/tokyo-suburban-jr/chuo/overrides"
REGION_SERVICE_IDS = {
    "jr-chuo-takao-fujino",
    "jr-chuo-tatsuno",
    "jr-koumi",
    "jr-shinonoi",
    "jr-shinetsu-nagano",
    "jr-oito",
}


@pytest.fixture(scope="module")
def staged_build():
    """Build the reviewed Chuo region once for real-track regressions."""
    overrides = load_overrides(STAGE_DIR)
    return overrides, generate_build(config.DEFAULT_RAW_DIR, overrides)


def _candidate(result, service_id: str, station_id: str):
    service = result.services[service_id]
    index = service.service.station_ids.index(station_id)
    return service.routed.chosen[index]


def _assert_area_boundary(
    overrides,
    service_id,
    terminal,
    terminal_municipality,
    neighbour,
    neighbour_municipality,
):
    service = overrides.service(service_id)
    assert service.stops[-1].station_id == terminal
    assert service.scope_stops[-2].station_id == terminal
    assert (
        service.scope_stops[-2].prefecture,
        service.scope_stops[-2].municipality,
    ) == (
        "長野県",
        terminal_municipality,
    )
    assert service.scope_stops[-2].in_area is True
    assert service.scope_stops[-1].station_id == neighbour
    assert (
        service.scope_stops[-1].prefecture,
        service.scope_stops[-1].municipality,
    ) == (
        "長野県",
        neighbour_municipality,
    )
    assert service.scope_stops[-1].in_area is False
    assert service.definition.endpoints.last == "area-boundary"


def test_chuo_region_matches_frozen_catalog_and_keeps_boundary_neighbours_out(
    staged_build,
):
    overrides, result = staged_build
    catalog_path = ROOT / ".claude/docs/research/tokyo-suburban-r1-jr-catalog.csv"
    with catalog_path.open(newline="", encoding="utf-8") as catalog_file:
        rows = list(csv.DictReader(catalog_file))
    expected = {
        service_id: [
            row["station_id_proposed"]
            for row in sorted(
                (item for item in rows if item["service_id"] == service_id),
                key=lambda item: int(item["order"]),
            )
        ]
        for service_id in REGION_SERVICE_IDS
    }

    assert set(expected) == REGION_SERVICE_IDS
    for service_id in REGION_SERVICE_IDS:
        service = overrides.service(service_id)
        assert list(service.station_ids) == expected[service_id]
        assert (
            list(result.services[service_id].service.station_ids)
            == expected[service_id]
        )
        assert all(
            candidate.operator == "東日本旅客鉄道"
            for candidate in result.services[service_id].routed.chosen
        )

    assert "shinano-kawakami" not in expected["jr-koumi"]
    assert "minami-otari" not in expected["jr-oito"]
    _assert_area_boundary(
        overrides,
        "jr-koumi",
        "nobeyama",
        "南牧村",
        "shinano-kawakami",
        "南佐久郡川上村",
    )
    _assert_area_boundary(
        overrides, "jr-oito", "hakuba", "白馬村", "shinano-moriue", "北安曇郡白馬村"
    )


def test_chuo_scope_boundary_expectation_rejects_a_farther_neighbour(staged_build):
    overrides, _ = staged_build
    service = overrides.service("jr-oito")
    mutated_scope = (
        *service.scope_stops[:-1],
        replace(service.scope_stops[-1], station_id="minami-otari"),
    )
    mutated_service = replace(service, scope_stops=mutated_scope)
    with pytest.raises(AssertionError):
        _assert_area_boundary(
            replace(
                overrides,
                services=tuple(
                    mutated_service if item.id == service.id else item
                    for item in overrides.services
                ),
            ),
            "jr-oito",
            "hakuba",
            "白馬村",
            "shinano-moriue",
            "北安曇郡白馬村",
        )


def test_chuo_keeps_shipped_pairs_and_routes_west_of_fujino_on_chuo_line(
    staged_build,
):
    _, result = staged_build
    service = result.services["jr-chuo-takao-fujino"]
    station_ids = list(service.service.station_ids)
    assert station_ids[:3] == ["takao", "sagamiko", "fujino"]
    assert service.segment_lines[:2] == ("中央線", "中央線")

    fujino_index = station_ids.index("fujino")
    assert all(line == "中央線" for line in service.segment_lines[fujino_index:])
    assert station_ids[-1] == "shiojiri"

    expected_codes = {
        "takao": "004029",
        "sagamiko": "004148",
        "fujino": "004156",
    }
    for station_id, station_code in expected_codes.items():
        assert _candidate(result, "jr-chuo-takao-fujino", station_id).station_code == (
            station_code
        )


def test_chuo_tatsuno_and_nagano_service_connections_use_jr_east_tracks(
    staged_build,
):
    _, result = staged_build
    connections = {
        "shiojiri": {"jr-chuo-takao-fujino", "jr-chuo-tatsuno", "jr-shinonoi"},
        "matsumoto": {"jr-shinonoi", "jr-oito"},
        "shinonoi": {"jr-shinonoi", "jr-shinetsu-nagano"},
    }
    for station_id, service_ids in connections.items():
        for service_id in service_ids:
            assert station_id in result.services[service_id].service.station_ids

    assert result.services["jr-chuo-tatsuno"].service.station_ids == (
        "okaya",
        "kawagishi",
        "tatsuno",
        "shinano-kawashima",
        "ono-nagano",
        "shiojiri",
    )
    assert _candidate(result, "jr-chuo-takao-fujino", "shiojiri").operator == (
        "東日本旅客鉄道"
    )
    assert _candidate(result, "jr-shinonoi", "shiojiri").operator == ("東日本旅客鉄道")
