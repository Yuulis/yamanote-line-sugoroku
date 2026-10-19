"""Regressions for Tokyu and Minatomirai S3 staging evidence."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.stage_suburban_jr import _candidate_options

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/tokyu-mm"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def _service_file(service_id: str, filename: str) -> Path:
    return next(ROOT.glob(f"components/**/services/{service_id}/{filename}"))


def test_meguro_boundary_pins_den_en_chofu_and_uses_toyoko_track_south() -> None:
    stops = _csv(_service_file("tokyu-meguro", "stops.csv"))
    den_en_chofu = next(
        row for row in stops if row["station_id"] == "tokyu-den-en-chofu"
    )
    selector = parse_platform_selector(den_en_chofu["platform_selector"])
    evidence = _csv(ROOT / "pair-evidence.csv")
    pair = next(
        row
        for row in evidence
        if row["service_id"] == "tokyu-meguro"
        and row["from_id"] == "tokyu-den-en-chofu"
        and row["to_id"] == "tokyu-tamagawa"
    )

    assert selector.lines == frozenset({"目黒線"})
    assert selector.groups == frozenset({"004245"})
    assert pair["n02_line"] == "東横線"
    assert pair["from_platform_code"] == "004246"
    assert pair["from_track_platform_code"] == "004245"
    assert pair["status"] == "pass"
    south_pairs = [
        row
        for row in evidence
        if row["service_id"] == "tokyu-meguro"
        and row["from_id"]
        in {
            "tokyu-tamagawa",
            "tokyu-shin-maruko",
            "tokyu-musashi-kosugi",
            "tokyu-motosumiyoshi",
        }
    ]
    assert len(south_pairs) == 4
    assert all(
        row["n02_line"] == "東横線" and row["status"] == "pass" for row in south_pairs
    )


def test_oimachi_continues_on_den_en_toshi_track_after_futako_tamagawa() -> None:
    stops = _csv(_service_file("tokyu-oimachi", "stops.csv"))
    boundary = next(
        row for row in stops if row["station_id"] == "tokyu-futako-tamagawa"
    )
    selector = parse_platform_selector(boundary["platform_selector"])
    evidence = _csv(ROOT / "pair-evidence.csv")
    downstream = [
        row
        for row in evidence
        if row["service_id"] == "tokyu-oimachi"
        and row["from_id"]
        in {"tokyu-futako-tamagawa", "tokyu-futako-shinchi", "tokyu-takatsu"}
    ]

    assert selector.lines == frozenset({"田園都市線"})
    assert selector.groups == frozenset({"004177"})
    assert [row["n02_line"] for row in downstream] == ["田園都市線"] * 3
    assert downstream[0]["from_track_platform_code"] == "004178"
    assert all(row["status"] == "pass" for row in downstream)


def test_shin_yokohama_and_setagaya_services_keep_their_own_n02_lines() -> None:
    evidence = _csv(ROOT / "pair-evidence.csv")
    shin_yokohama = [
        row for row in evidence if row["service_id"] == "tokyu-shin-yokohama"
    ]
    setagaya = [row for row in evidence if row["service_id"] == "tokyu-setagaya"]
    inventory = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))
    setagaya_component = next(
        item
        for item in inventory["components"]
        if "tokyu-setagaya" in item["serviceIds"]
    )
    setagaya_rows = _csv(_service_file("tokyu-setagaya", "stops.csv"))
    den_en_toshi_rows = _csv(_service_file("tokyu-den-en-toshi", "stops.csv"))

    assert len(shin_yokohama) == 2
    assert all(
        row["n02_line"] == "東急新横浜線" and row["status"] == "pass"
        for row in shin_yokohama
    )
    assert len(setagaya) == 9
    assert all(
        row["n02_line"] == "世田谷線" and row["status"] == "pass" for row in setagaya
    )
    assert setagaya_component["componentId"] == "tokyu-den-en-toshi"
    setagaya_shared = next(
        row for row in setagaya_rows if row["station_id"] == "tokyu-sangen-jaya"
    )
    den_en_toshi_shared = next(
        row for row in den_en_toshi_rows if row["station_id"] == "tokyu-sangen-jaya"
    )
    assert (
        setagaya_shared["n02_operator"]
        == den_en_toshi_shared["n02_operator"]
        == "東急電鉄"
    )


def test_minatomirai_is_an_independent_operator_component_without_composition() -> None:
    inventory = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))
    component = next(
        item
        for item in inventory["components"]
        if item["componentId"] == "mm-minatomirai"
    )
    mapping = _csv(_service_file("mm-minatomirai", "line_mapping.csv"))
    evidence = _csv(ROOT / "pair-evidence.csv")
    pairs = [row for row in evidence if row["service_id"] == "mm-minatomirai"]
    service_data = json.loads(
        (ROOT / "components/mm-minatomirai/overrides/services.json").read_text(
            encoding="utf-8"
        )
    )
    service = next(
        row for row in service_data["services"] if row["id"] == "mm-minatomirai"
    )

    assert component["serviceIds"] == ["mm-minatomirai"]
    assert service["operator"] == "横浜高速鉄道"
    assert service["n02Operator"] == "横浜高速鉄道"
    assert all(row["n02_line"] == "みなとみらい21線" for row in mapping)
    assert all(not row["compose"] for row in mapping)
    assert len(pairs) == 5 and all(row["status"] == "pass" for row in pairs)


def test_tokyu_candidate_selection_rejects_wrong_operator_and_wrong_line() -> None:
    stop = Stop(
        order=0,
        station_id="tokyu-den-en-chofu",
        station_number="TY08",
        platform_selector=parse_platform_selector("line=東横線;code=004245"),
        original_name="田園調布",
        n02_name="田園調布",
        n02_operator="東急電鉄",
    )
    resolution = StopResolution("東急電鉄", "田園調布", "田園調布", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "田園調布", "東横線", "004245", "004245", geometry, Point(0, 0), "東急電鉄"
        ),
        PlatformCandidate(
            "田園調布", "目黒線", "004246", "004245", geometry, Point(0, 0), "東急電鉄"
        ),
        PlatformCandidate(
            "田園調布", "東横線", "004245", "004245", geometry, Point(0, 0), "別事業者"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(
        stop, resolution, SimpleNamespace(), source, {"東横線"}
    )

    assert [(item.operator, item.n02_line, item.station_code) for item in options] == [
        ("東急電鉄", "東横線", "004245")
    ]


def test_all_group_lengths_have_published_components_and_pass_measurement() -> None:
    references = _csv(ROOT / "length-refs.csv")
    components = _csv(ROOT / "length-ref-components.csv")
    evidence = _csv(ROOT / "pair-evidence.csv")

    assert len(references) == 10
    assert len(components) == 10
    assert all(
        row["km"] and row["source_url"].startswith("https://") for row in references
    )
    assert all(
        row["document"] and row["page_or_table"] and row["operation"] == "+"
        for row in components
    )
    assert len(evidence) == 113
    assert all(row["status"] == "pass" for row in evidence)
