"""Regressions for the Tobu S3 staging inputs."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.build import route_service
from scripts.data_pipeline.constraints import JunctionRule, parse_platform_selector
from scripts.data_pipeline.n02 import (
    N02Source,
    PlatformCandidate,
    split_reviewed_junctions,
)
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_jr import _candidate_options
from tests.data_pipeline._local_inputs import requires_raw_n02

ROOT = Path(__file__).parents[2]
STAGE = ROOT / "data/staging/tokyo-suburban-nonjr/tobu"
RAW = ROOT / "N02-25_GML/UTF-8"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


@requires_raw_n02()
def test_oshiage_junction_matches_raw_n02_internal_vertex_and_peer_endpoint() -> None:
    service = STAGE / "components/tobu-daishi/overrides/services/tobu-oshiage"
    stop_rows = _csv(service / "stops.csv")
    oshiage = next(row for row in stop_rows if row["station_id"] == "tobu-oshiage")
    assert oshiage["platform_selector"] == "line=伊勢崎線;code=003541"

    source = N02Source(RAW, "東武鉄道", (139.7, 35.6, 139.9, 35.8))
    platforms = source.platform_candidates(["押上", "曳舟"], ["伊勢崎線"])
    by_code = {platform.station_code: platform for platform in platforms}
    assert by_code["003541"].station_name == "押上"
    assert by_code["003541"].group_code == "003526"
    assert by_code["003479"].station_name == "曳舟"

    sections = source.track_sections(
        ["伊勢崎線"], [by_code["003541"].midpoint, by_code["003479"].midpoint]
    )["伊勢崎線"]
    rule = JunctionRule(
        "東武鉄道",
        "伊勢崎線",
        "139.81335 35.71026~139.81415 35.70668#3c398c3b",
        "139.81336 35.71012~139.81437 35.71184#e2b7d560",
        139.81336,
        35.71012,
        "押上 platform section internal vertex joins the northbound 伊勢崎線 section",
    )
    assert len(split_reviewed_junctions(sections, [rule])) == len(sections) + 1


@requires_raw_n02()
def test_oshiage_build_loads_junction_and_routes_both_stops() -> None:
    overrides_dir = STAGE / "components/tobu-daishi/overrides"
    overrides = load_overrides(overrides_dir)
    service = overrides.service("tobu-oshiage")
    assert len(service.junction_rules) == 1

    source = N02Source(
        RAW,
        "東武鉄道",
        overrides.dataset.candidate_search_bbox,
    )
    built = route_service(source, service, overrides.registry, overrides, {})

    assert built.service.station_ids == ("tobu-oshiage", "tobu-hikifune")
    assert len(built.routed.paths) == 1
    assert built.routed.paths[0].length > 0


def test_uses_frozen_esojima_name_with_raw_n02_spelling() -> None:
    stops = _csv(
        STAGE / "components/tobu-daishi/overrides/services/tobu-utsunomiya/stops.csv"
    )
    esojima = next(row for row in stops if row["station_id"] == "tobu-esojima")

    assert esojima["original_name"] == "江曽島"
    assert esojima["n02_name"] == "江曾島"


def test_koizumi_branch_services_and_mileage_arithmetic_are_explicit() -> None:
    base = STAGE / "components/tobu-daishi/overrides/services"
    koizumi_routes = _csv(base / "tobu-koizumi/line_mapping.csv")
    ota_routes = _csv(base / "tobu-koizumi-ota/line_mapping.csv")
    assert all(row["n02_line"] == "小泉線" for row in koizumi_routes + ota_routes)
    assert (koizumi_routes[0]["from_id"], koizumi_routes[-1]["to_id"]) == (
        "tobu-tatebayashi",
        "tobu-nishi-koizumi",
    )
    assert (ota_routes[0]["from_id"], ota_routes[-1]["to_id"]) == (
        "tobu-ota",
        "tobu-higashi-koizumi",
    )

    refs = _csv(STAGE / "length-refs.csv")
    lengths = {row["service_id"]: float(row["km"]) for row in refs}
    assert lengths["tobu-koizumi"] == 12.0
    assert lengths["tobu-koizumi-ota"] == 6.4
    assert lengths["tobu-koizumi"] + lengths["tobu-koizumi-ota"] == 18.4
    components = _csv(STAGE / "length-ref-components.csv")
    by_service = {row["service_id"]: row for row in components}
    for service_id in ("tobu-koizumi", "tobu-koizumi-ota"):
        row = by_service[service_id]
        assert row["source_class"] == "primary"
        assert row["source_url"] == (
            "https://wwwtb.mlit.go.jp/kanto/content/000340764.pdf"
        )
        assert row["page_or_table"] == ("p.4, JR以外 鉄道一覧, 小泉線 区間 rows")
    services = json.loads(
        (STAGE / "components/tobu-daishi/overrides/services.json").read_text(
            encoding="utf-8"
        )
    )["services"]
    service_by_id = {service["id"]: service for service in services}
    for service_id in ("tobu-koizumi", "tobu-koizumi-ota"):
        source = service_by_id[service_id]["lengthRef"]["source"]
        assert "Official primary-source operating mileage" in source
        assert "https://wwwtb.mlit.go.jp/kanto/content/000340764.pdf" in source


def test_tojo_and_ogose_are_separate_from_tobu_main_component() -> None:
    inventory = json.loads((STAGE / "inventory.json").read_text(encoding="utf-8"))
    components = {
        item["componentId"]: set(item["serviceIds"]) for item in inventory["components"]
    }

    assert components["tobu-ogose"] == {"tobu-tojo", "tobu-ogose"}
    assert "tobu-isesaki" in components["tobu-daishi"]
    assert "tobu-tojo" not in components["tobu-daishi"]


def test_tobu_candidate_rejects_wrong_operator_and_wrong_line() -> None:
    stop = Stop(
        order=0,
        station_id="tobu-esojima",
        station_number="TN-38",
        platform_selector=parse_platform_selector("line=宇都宮線"),
        original_name="江曽島",
        n02_name="江曾島",
        n02_operator="東武鉄道",
    )
    resolution = StopResolution("東武鉄道", "江曾島", "江曾島", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "江曾島", "宇都宮線", "002155", "002155", geometry, Point(0, 0), "東武鉄道"
        ),
        PlatformCandidate(
            "江曾島", "伊勢崎線", "002155", "002155", geometry, Point(0, 0), "東武鉄道"
        ),
        PlatformCandidate(
            "江曾島", "宇都宮線", "002155", "002155", geometry, Point(0, 0), "他社"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(
        stop, resolution, SimpleNamespace(), source, {"宇都宮線"}
    )

    assert [(item.operator, item.n02_line, item.station_code) for item in options] == [
        ("東武鉄道", "宇都宮線", "002155")
    ]


def test_sano_detour_exception_is_the_reviewed_single_row() -> None:
    path = (
        ROOT
        / "data/staging/tokyo-suburban-nonjr/tobu/components/tobu-daishi/overrides"
        / "detour_exceptions.csv"
    )
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert [(row["service_id"], row["from_id"], row["to_id"]) for row in rows] == [
        ("tobu-sano", "tobu-sanoshi", "tobu-sano")
    ]
    assert float(rows[0]["max_detour_ratio"]) == 2.10
    assert "002416" in rows[0]["reason"] and "002398" in rows[0]["reason"]
