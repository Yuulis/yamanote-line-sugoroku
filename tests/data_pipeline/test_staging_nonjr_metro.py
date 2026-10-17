"""Regressions for Tokyo Metro S3 staging inputs and source selection."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.stage_suburban_jr import _candidate_options

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/metro"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def test_fukutoshin_boundary_pins_kotake_to_the_continuing_track() -> None:
    stops = _csv(
        ROOT / "components/metro-chiyoda/overrides/services/metro-fukutoshin/stops.csv"
    )
    boundary = next(
        row for row in stops if row["station_id"] == "metro-kotake-mukaihara"
    )
    selector = parse_platform_selector(boundary["platform_selector"])
    evidence = _csv(ROOT / "pair-evidence.csv")
    pair = next(
        row
        for row in evidence
        if row["service_id"] == "metro-fukutoshin"
        and row["from_id"] == "metro-hikawadai"
        and row["to_id"] == "metro-kotake-mukaihara"
    )

    assert selector.codes == frozenset({"003294"})
    assert pair["n02_line"] == "8号線有楽町線"
    assert pair["to_platform_code"] == "003294"
    assert pair["to_track_platform_code"] == "003295"
    assert pair["status"] == "pass"


def test_chiyoda_has_twenty_stops_including_kita_ayase() -> None:
    stops = _csv(
        ROOT / "components/metro-chiyoda/overrides/services/metro-chiyoda/stops.csv"
    )

    assert len(stops) == 20
    assert stops[-1]["station_id"] == "metro-kita-ayase"
    assert stops[-1]["original_name"] == "北綾瀬"


def test_each_reviewed_offset_exception_is_present_at_its_approved_limit() -> None:
    exceptions = _csv(ROOT / "components/metro-chiyoda/overrides/offset_exceptions.csv")
    actual = {
        (row["service_id"], row["station_id"]): row["max_platform_offset_m"]
        for row in exceptions
    }
    expected = {
        ("metro-chiyoda", "metro-kokkai-gijidomae"): "270",
        ("metro-chiyoda", "metro-otemachi"): "330",
        ("metro-yurakucho", "metro-iidabashi"): "310",
        ("metro-hanzomon", "metro-nagatacho"): "280",
        ("metro-hanzomon", "metro-mitsukoshimae"): "270",
        ("metro-namboku", "metro-iidabashi"): "270",
        ("metro-fukutoshin", "metro-ikebukuro"): "350",
    }

    assert actual == expected
    otemachi = next(
        row
        for row in exceptions
        if row["service_id"] == "metro-chiyoda"
        and row["station_id"] == "metro-otemachi"
    )
    assert "003730" in otemachi["reason"] and "003719" in otemachi["reason"]
    assert "320 m" in otemachi["reason"]
    assert "https://www.tokyometro.jp/station/otemachi/index.html" in otemachi["reason"]


def test_metro_platform_candidate_rejects_wrong_operator_and_wrong_line() -> None:
    stop = Stop(
        order=0,
        station_id="metro-shibuya",
        station_number="G01",
        platform_selector=parse_platform_selector("line=3号線銀座線"),
        original_name="渋谷",
        n02_name="渋谷",
        n02_operator="東京地下鉄",
    )
    resolution = StopResolution("東京地下鉄", "渋谷", "渋谷", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "渋谷", "3号線銀座線", "G01", "g1", geometry, Point(0, 0), "東京地下鉄"
        ),
        PlatformCandidate(
            "渋谷", "3号線銀座線", "G01", "g1", geometry, Point(0, 0), "東京地下鐵"
        ),
        PlatformCandidate(
            "渋谷", "11号線半蔵門線", "Z01", "g2", geometry, Point(0, 0), "東京地下鉄"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(
        stop, resolution, SimpleNamespace(), source, {"3号線銀座線"}
    )

    assert [candidate.operator for candidate in options] == ["東京地下鉄"]


def test_staging_catalog_is_generated_from_frozen_inventory() -> None:
    inventory = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))
    services = inventory["services"]
    assert len(inventory["serviceIds"]) == 10
    assert sum(len(service["stop_ids"].split("|")) for service in services) == 186
    assert sum(len(service["stop_ids"].split("|")) - 1 for service in services) == 176
