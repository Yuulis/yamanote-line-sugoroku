"""Regressions for Seibu S3 staging inputs and source selection."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.stage_suburban_jr import _candidate_options

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/seibu"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def test_yamaguchi_agt_pairs_use_the_pinned_seibu_platforms() -> None:
    stops = _csv(
        ROOT / "components/seibu-chichibu/overrides/services/seibu-yamaguchi/stops.csv"
    )
    selectors = {
        row["station_id"]: parse_platform_selector(row["platform_selector"]).codes
        for row in stops
    }
    evidence = _csv(ROOT / "pair-evidence.csv")
    pairs = [row for row in evidence if row["service_id"] == "seibu-yamaguchi"]

    assert selectors["seibu-tamako"] == frozenset({"003202"})
    assert selectors["seibu-seibukyujo-mae"] == frozenset({"003182"})
    assert len(pairs) == 2
    assert all(row["n02_operator"] == "西武鉄道" for row in pairs)
    assert all(row["n02_line"] == "山口線" for row in pairs)
    assert pairs[0]["from_platform_code"] == "003202"
    assert pairs[1]["to_platform_code"] == "003182"
    assert all(row["status"] == "pass" for row in pairs)


def test_yamaguchi_pins_match_the_frozen_names_and_raw_n02_features() -> None:
    raw_path = Path(__file__).parents[2] / "N02-25_GML/UTF-8/N02-25_Station.geojson"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    expected = {"003202": "多摩湖", "003182": "西武球場前"}
    matches = {
        feature["properties"]["N02_005c"]: feature["properties"]
        for feature in raw["features"]
        if feature["properties"].get("N02_005c") in expected
    }

    assert set(matches) == set(expected)
    for code, name in expected.items():
        assert matches[code]["N02_005"] == name
        assert matches[code]["N02_003"] == "山口線"


def test_tamagawa_line_is_an_isolated_component() -> None:
    inventory = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))
    component = next(
        item
        for item in inventory["components"]
        if item["componentId"] == "seibu-tamagawa"
    )

    assert component["serviceIds"] == ["seibu-tamagawa"]
    assert inventory["counts"] == {"services": 12, "stops": 105, "pairs": 93}


def test_akitsu_uses_frozen_name_not_shin_akitsu() -> None:
    stops = _csv(
        ROOT / "components/seibu-chichibu/overrides/services/seibu-ikebukuro/stops.csv"
    )
    akitsu = next(row for row in stops if row["station_id"] == "seibu-akitsu")

    assert akitsu["original_name"] == "秋津"
    assert akitsu["n02_name"] == "秋津"
    assert akitsu["station_id"] == "seibu-akitsu"


def test_seibu_candidate_rejects_wrong_operator_and_wrong_line() -> None:
    stop = Stop(
        order=0,
        station_id="seibu-tamako",
        station_number="SY01",
        platform_selector=parse_platform_selector("line=山口線;code=003202"),
        original_name="多摩湖",
        n02_name="多摩湖",
        n02_operator="西武鉄道",
    )
    resolution = StopResolution("西武鉄道", "多摩湖", "多摩湖", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "多摩湖", "山口線", "003202", "003201", geometry, Point(0, 0), "西武鉄道"
        ),
        PlatformCandidate(
            "多摩湖", "多摩湖線", "003201", "003201", geometry, Point(0, 0), "西武鉄道"
        ),
        PlatformCandidate(
            "多摩湖", "山口線", "003202", "003201", geometry, Point(0, 0), "他社"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(
        stop, resolution, SimpleNamespace(), source, {"山口線"}
    )

    assert [(item.operator, item.n02_line) for item in options] == [
        ("西武鉄道", "山口線")
    ]
