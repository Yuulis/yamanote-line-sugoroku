"""Regressions for Keisei, Hokuso and TX S3 staging evidence."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.stage_suburban_jr import _candidate_options

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/keisei-hokuso-tx"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def _service_file(service_id: str, filename: str) -> Path:
    return next(ROOT.glob(f"components/**/services/{service_id}/{filename}"))


def test_keisei_main_and_airport_access_pin_distinct_airport_codes() -> None:
    main = _csv(_service_file("keisei-main", "stops.csv"))
    access = _csv(_service_file("keisei-narita-airport-access", "stops.csv"))
    evidence = _csv(ROOT / "pair-evidence.csv")
    main_airport = [
        row for row in main if row["original_name"] in {"空港第2ビル", "成田空港"}
    ]
    access_airport = [
        row for row in access if row["original_name"] in {"空港第2ビル", "成田空港"}
    ]

    assert [
        parse_platform_selector(row["platform_selector"]).codes for row in main_airport
    ] == [
        frozenset({"003175"}),
        frozenset({"003205"}),
    ]
    assert [
        parse_platform_selector(row["platform_selector"]).codes
        for row in access_airport
    ] == [
        frozenset({"003174"}),
        frozenset({"003204"}),
    ]
    airport_pairs = [
        row for row in evidence if row["service_id"] == "keisei-narita-airport-access"
    ]
    assert [(row["from_id"], row["to_id"]) for row in airport_pairs] == [
        ("keisei-imba-nihon-idai", "keisei-narita-yukawa"),
        ("keisei-narita-yukawa", "keisei-airport-terminal-2"),
        ("keisei-airport-terminal-2", "keisei-narita-airport-terminal-1"),
    ]
    assert all(
        row["n02_line"] == "成田空港線" and row["status"] == "pass"
        for row in airport_pairs
    )


def test_hokuso_boundary_ids_remain_separate_from_keisei() -> None:
    hokuso_ids = {
        row["station_id"] for row in _csv(_service_file("hokuso-main", "stops.csv"))
    }
    keisei_ids = {
        row["station_id"] for row in _csv(_service_file("keisei-main", "stops.csv"))
    }
    hokuso_stop = next(
        row
        for row in _csv(_service_file("hokuso-main", "stops.csv"))
        if row["original_name"] in {"京成高砂", "印旛日本医大"}
    )
    keisei_takasago = next(
        row
        for row in _csv(_service_file("keisei-main", "stops.csv"))
        if row["original_name"] == "京成高砂"
    )
    hokuso_registry = json.loads(
        (ROOT / "components/hokuso-main/overrides/expected-catalog.json").read_text(
            encoding="utf-8"
        )
    )["stationIds"]
    keisei_registry = json.loads(
        (ROOT / "components/keisei-chiba/overrides/expected-catalog.json").read_text(
            encoding="utf-8"
        )
    )["stationIds"]

    assert "hokuso-keisei-takasago" in hokuso_ids
    assert "keisei-keisei-takasago" in keisei_ids
    assert "hokuso-keisei-takasago" in hokuso_registry
    assert "keisei-keisei-takasago" in keisei_registry
    assert hokuso_stop["n02_operator"] == "北総鉄道"
    assert parse_platform_selector(hokuso_stop["platform_selector"]).lines == frozenset(
        {"北総線"}
    )
    assert keisei_takasago["n02_operator"] == "京成電鉄"
    assert "hokuso-keisei-takasago" != "keisei-keisei-takasago"


def test_tx_hokuso_and_keisei_line_names_are_frozen_per_service() -> None:
    expected = {
        "tx": "常磐新線",
        "hokuso-main": "北総線",
        "keisei-chiba": "千葉線",
        "keisei-chihara": "千原線",
        "keisei-matsudo": "松戸線",
    }
    for service_id, line in expected.items():
        mappings = _csv(_service_file(service_id, "line_mapping.csv"))
        pairs = [
            row
            for row in _csv(ROOT / "pair-evidence.csv")
            if row["service_id"] == service_id
        ]
        assert mappings and all(row["n02_line"] == line for row in mappings)
        assert len(pairs) == len(mappings)
        assert all(row["n02_line"] == line and row["status"] == "pass" for row in pairs)
        assert all(not row["compose"] for row in mappings)


def test_wrong_line_and_wrong_operator_platforms_are_rejected() -> None:
    stop = Stop(
        order=0,
        station_id="keisei-keisei-takasago",
        station_number="KS10",
        platform_selector=parse_platform_selector("line=本線;code=003250"),
        original_name="京成高砂",
        n02_name="京成高砂",
        n02_operator="京成電鉄",
    )
    resolution = StopResolution("京成電鉄", "京成高砂", "京成高砂", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "京成高砂", "本線", "003250", "003248", geometry, Point(0, 0), "京成電鉄"
        ),
        PlatformCandidate(
            "京成高砂", "金町線", "003248", "003248", geometry, Point(0, 0), "京成電鉄"
        ),
        PlatformCandidate(
            "京成高砂", "本線", "003250", "003248", geometry, Point(0, 0), "北総鉄道"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(stop, resolution, SimpleNamespace(), source, {"本線"})

    assert [(item.operator, item.n02_line, item.station_code) for item in options] == [
        ("京成電鉄", "本線", "003250")
    ]


def test_all_group_lengths_have_primary_source_breakdowns_and_pass_measurement() -> (
    None
):
    references = _csv(ROOT / "length-refs.csv")
    components = _csv(ROOT / "length-ref-components.csv")
    evidence = _csv(ROOT / "pair-evidence.csv")

    assert len(references) == 10
    assert len(components) == 11
    assert all(row["source_url"].startswith("https://") for row in references)
    assert all(row["document"] and row["page_or_table"] for row in components)
    assert len(evidence) == 122
    assert all(row["status"] == "pass" for row in evidence)
    access_breakdown = [
        row for row in components if row["service_id"] == "keisei-narita-airport-access"
    ]
    assert [row["operation"] for row in access_breakdown] == ["+", "-"]
    assert [row["km"] for row in access_breakdown] == ["51.4", "32.3"]
