"""Raw N02 integration checks for shared stations across operators."""

from __future__ import annotations

from dataclasses import replace
from typing import NamedTuple

import pytest
from shapely.geometry import Point

from scripts.data_pipeline import config, export
from scripts.data_pipeline.build import group_candidates, route_service, stop_lines
from scripts.data_pipeline.constraints import ANY_PLATFORM, parse_platform_selector
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.override_parsing import parse_stops
from scripts.data_pipeline.overrides import (
    LineRange,
    OverrideError,
    Overrides,
    ServiceOverrides,
    Stop,
)
from scripts.data_pipeline.registry import Registry, RegistryStation


class RawServiceSpec(NamedTuple):
    id: str
    display_operator: str
    n02_operator: str
    neighbour_id: str
    neighbour_name: str
    n02_line: str
    hub_original_name: str
    hub_n02_name: str


@pytest.fixture(scope="module")
def raw_provider() -> N02SourceProvider:
    return N02SourceProvider(
        config.DEFAULT_RAW_DIR, config.DEFAULT_CANDIDATE_SEARCH_BBOX
    )


def _service_bundle(
    template: Overrides,
    hub_id: str,
    hub_display_name: str,
    hub_n02_name: str,
    hub_aliases: tuple[str, ...],
    registry_operator: str,
    registry_selector: str,
    specs: tuple[RawServiceSpec, ...],
) -> Overrides:
    base = template.service("jr-keiyo")
    services: list[ServiceOverrides] = []
    stations: list[RegistryStation] = []
    for spec in specs:
        service = replace(
            base,
            definition=replace(
                base.definition,
                id=spec.id,
                name=spec.id,
                circular=False,
                expected_stop_count=2,
                endpoints=replace(
                    base.definition.endpoints,
                    first="terminus",
                    last="terminus",
                ),
                operator=spec.display_operator,
                n02_operator=spec.n02_operator,
                station_number_sequence=None,
            ),
            stops=(
                Stop(0, spec.neighbour_id, "", ANY_PLATFORM),
                Stop(
                    1,
                    hub_id,
                    "",
                    ANY_PLATFORM,
                    original_name=spec.hub_original_name,
                    n02_name=spec.hub_n02_name,
                ),
            ),
            line_ranges=(LineRange(spec.neighbour_id, hub_id, spec.n02_line),),
            section_filters={},
            scope_stops=(),
        )
        services.append(service)
        stations.append(
            RegistryStation(
                spec.neighbour_id,
                spec.neighbour_name,
                spec.neighbour_name,
                "東京都",
                "市",
                spec.id,
                n02_operator=spec.n02_operator,
            )
        )

    stations.append(
        RegistryStation(
            hub_id,
            hub_display_name,
            hub_n02_name,
            "東京都",
            "市",
            specs[0].id,
            n02_selector=parse_platform_selector(registry_selector),
            aliases=hub_aliases,
            n02_operator=registry_operator,
        )
    )
    registry = Registry(tuple(stations))
    dataset = replace(
        template.dataset,
        service_ids=tuple(service.id for service in services),
        target_service_id=services[0].id,
    )
    return replace(
        template,
        dataset=dataset,
        registry=registry,
        services=tuple(services),
    )


def _route(raw_provider: N02SourceProvider, overrides: Overrides, service_id: str):
    service = overrides.service(service_id)
    return route_service(raw_provider, service, overrides.registry, overrides)


def test_korakuen_kasuga_select_real_platforms(
    committed_overrides: Overrides, raw_provider: N02SourceProvider
) -> None:
    hub_id = "korakuen-kasuga"
    specs = (
        RawServiceSpec(
            "metro-maru",
            "東京地下鉄株式会社",
            "東京地下鉄",
            "myogadani",
            "茗荷谷",
            "4号線丸ノ内線",
            "後楽園",
            "後楽園",
        ),
        RawServiceSpec(
            "toei-mita",
            "東京都交通局",
            "東京都",
            "hakusan",
            "白山",
            "6号線三田線",
            "春日",
            "春日",
        ),
    )
    overrides = _service_bundle(
        committed_overrides,
        hub_id,
        "後楽園・春日",
        "後楽園",
        ("後楽園", "春日"),
        "東京地下鉄",
        "code=003550",
        specs,
    )

    metro = _route(raw_provider, overrides, "metro-maru").routed.chosen[-1]
    toei_service = overrides.service("toei-mita")
    toei = _route(raw_provider, overrides, "toei-mita").routed.chosen[-1]

    assert overrides.service("metro-maru").station_ids[-1] == hub_id
    assert toei_service.station_ids[-1] == hub_id
    assert overrides.registry.by_id()[hub_id].name == "後楽園・春日"
    assert metro.operator == "東京地下鉄"
    assert metro.station_code == "003550"
    assert toei.operator == "東京都"
    assert toei.station_code == "003529"
    assert toei_service.effective_operator(overrides.dataset) == "東京都交通局"
    assert toei_service.effective_n02_operator(overrides.dataset) == "東京都"
    exported = export.build_services(
        [toei_service],
        overrides.dataset,
        {
            (toei_service.id, station_id): Point(0, 0)
            for station_id in toei_service.station_ids
        },
    )
    assert exported[0]["operator"] == "東京都交通局"


def test_hamamatsucho_daimon_select_real_platforms(
    committed_overrides: Overrides, raw_provider: N02SourceProvider
) -> None:
    hub_id = "hamamatsucho-daimon"
    specs = (
        RawServiceSpec(
            "jr-hamamatsucho",
            "東日本旅客鉄道",
            "東日本旅客鉄道",
            "tamachi",
            "田町",
            "東海道線",
            "浜松町",
            "浜松町",
        ),
        RawServiceSpec(
            "toei-daimon",
            "東京都交通局",
            "東京都",
            "shimbashi",
            "新橋",
            "1号線浅草線",
            "大門",
            "大門",
        ),
    )
    overrides = _service_bundle(
        committed_overrides,
        hub_id,
        "浜松町・大門",
        "浜松町",
        ("浜松町", "大門"),
        "東日本旅客鉄道",
        "code=003949",
        specs,
    )

    jr = _route(raw_provider, overrides, "jr-hamamatsucho").routed.chosen[-1]
    toei = _route(raw_provider, overrides, "toei-daimon").routed.chosen[-1]

    assert jr.operator == "東日本旅客鉄道"
    assert jr.station_code == "003949"
    assert toei.operator == "東京都"
    assert toei.station_code in {"003940", "003939"}
    assert overrides.registry.by_id()[hub_id].name == "浜松町・大門"


def test_oshiage_same_group_keeps_operator_membership(
    committed_overrides: Overrides, raw_provider: N02SourceProvider
) -> None:
    hub_id = "oshiage-shared"
    specs = (
        RawServiceSpec(
            "keisei-oshiage",
            "京成電鉄",
            "京成電鉄",
            "aoto",
            "青砥",
            "押上線",
            "押上",
            "押上",
        ),
        RawServiceSpec(
            "metro-oshiage",
            "東京地下鉄",
            "東京地下鉄",
            "kinshicho",
            "錦糸町",
            "11号線半蔵門線",
            "押上",
            "押上",
        ),
        RawServiceSpec(
            "toei-oshiage",
            "東京都交通局",
            "東京都",
            "honjo-azumabashi",
            "本所吾妻橋",
            "1号線浅草線",
            "押上",
            "押上",
        ),
        RawServiceSpec(
            "tobu-oshiage",
            "東武鉄道",
            "東武鉄道",
            "hikifune",
            "曳舟",
            "伊勢崎線",
            "押上",
            "押上",
        ),
    )
    overrides = _service_bundle(
        committed_overrides,
        hub_id,
        "押上",
        "押上",
        ("押上",),
        "京成電鉄",
        "code=003527",
        specs,
    )
    expected = {
        "keisei-oshiage": ("003527", "京成電鉄"),
        "metro-oshiage": ("003540", "東京地下鉄"),
        "toei-oshiage": ("003526", "東京都"),
        "tobu-oshiage": ("003541", "東武鉄道"),
    }

    for service_id, (station_code, operator) in expected.items():
        service = overrides.service(service_id)
        station_by_id = overrides.registry.by_id()
        resolutions = []
        registry_operators = []
        for stop in service.stops:
            station = station_by_id[stop.station_id]
            representative = overrides.service(station.representative_service_id)
            registry_operator = (
                station.n02_operator
                or representative.effective_n02_operator(overrides.dataset)
            )
            registry_operators.append(registry_operator)
            resolutions.append(
                service.resolve_stop(
                    stop, station, overrides.dataset, registry_operator
                )
            )
        lines_per_stop = stop_lines(service.segment_ranges(), service.circular)
        wanted_lines = {line for lines in lines_per_stop for line in lines}
        source = raw_provider.for_operator(operator)
        candidates = source.platform_candidates(
            [resolution.match_name for resolution in resolutions], wanted_lines
        )
        grouped = group_candidates(
            service,
            overrides.registry,
            candidates,
            lines_per_stop,
            operators_per_stop=[
                resolution.source_operator for resolution in resolutions
            ],
            stop_resolutions=resolutions,
        )
        selected = next(
            candidate
            for candidate in grouped[-1]
            if candidate.station_code == station_code
        )
        assert selected.station_code == station_code
        assert selected.operator == operator
        assert selected.group_code == "003526"


def test_ayase_requires_explicit_alternate_source_and_reason(
    committed_overrides: Overrides, raw_provider: N02SourceProvider
) -> None:
    hub_id = "ayase"
    spec = RawServiceSpec(
        "metro-ayase",
        "東京地下鉄",
        "東京地下鉄",
        "kita-senju",
        "北千住",
        "9号線千代田線",
        "綾瀬",
        "綾瀬",
    )
    overrides = _service_bundle(
        committed_overrides,
        hub_id,
        "綾瀬",
        "綾瀬",
        (),
        "東日本旅客鉄道",
        "code=003215",
        (spec,),
    )

    selected = _route(raw_provider, overrides, spec.id).routed.chosen[-1]
    assert selected.station_code == "003214"
    assert selected.operator == "東京地下鉄"

    raw_stop = {
        "order": "0",
        "station_id": hub_id,
        "station_number": "",
        "platform_selector": "",
        "n02_operator": "東日本旅客鉄道",
        "source_reason": "",
    }
    with pytest.raises(OverrideError, match="source_reason required"):
        parse_stops([raw_stop], spec.id)

    explicit = parse_stops(
        [{**raw_stop, "source_reason": "Reviewed Ayase JR source"}], spec.id
    )
    assert explicit[0].n02_operator == "東日本旅客鉄道"
