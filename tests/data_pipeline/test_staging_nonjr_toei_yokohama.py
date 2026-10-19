"""Regressions for the Toei and Yokohama S3 staging inputs."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.stage_suburban_jr import _candidate_options
from tests.data_pipeline._local_inputs import requires_raw_n02

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/toei-yokohama"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def _service_json(component: str) -> dict[str, object]:
    path = ROOT / "components" / component / "overrides/services.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_oedo_loop_closes_at_tochomae_and_radial_shares_it() -> None:
    loop = _csv(
        ROOT
        / "components/toei-asakusa/overrides/services/toei-oedo-loop/line_mapping.csv"
    )
    radial = _csv(
        ROOT
        / "components/toei-asakusa/overrides/services/toei-oedo-radial/line_mapping.csv"
    )

    assert (loop[-1]["from_id"], loop[-1]["to_id"]) == (
        "toei-shinjuku",
        "toei-tochomae",
    )
    assert (radial[0]["from_id"], radial[0]["to_id"]) == (
        "toei-tochomae",
        "toei-nishi-shinjuku-gochome",
    )


def test_toei_display_operator_and_n02_source_operator_are_distinct() -> None:
    services = _service_json("toei-asakusa")["services"]
    assert isinstance(services, list)
    for service in services:
        assert service["operator"] == "東京都交通局"
        assert service["n02Operator"] == "東京都"


@requires_raw_n02()
def test_yokohama_blue_pins_kannai_to_continuing_line_code_and_both_tracks() -> None:
    stops = _csv(
        ROOT / "components/yokohama-blue/overrides/services/yokohama-blue/stops.csv"
    )
    kannai = next(row for row in stops if row["station_id"] == "yokohama-kannai")
    selector = parse_platform_selector(kannai["platform_selector"])
    mappings = _csv(
        ROOT
        / "components/yokohama-blue/overrides/services/yokohama-blue/line_mapping.csv"
    )

    assert selector.codes == frozenset({"004691"})
    assert mappings[15]["n02_line"] == "1号線"
    assert mappings[16]["n02_line"] == "3号線"

    station_features = []
    station_path = Path(__file__).parents[2] / "N02-25_GML/UTF-8/N02-25_Station.geojson"
    station_data = json.loads(station_path.read_text(encoding="utf-8"))
    for feature in station_data["features"]:
        properties = feature["properties"]
        if properties["N02_005"] == "関内" and properties["N02_005c"] in {
            "004691",
            "004692",
        }:
            station_features.append(feature)
    by_code = {
        feature["properties"]["N02_005c"]: feature for feature in station_features
    }
    assert by_code["004691"]["properties"]["N02_003"] == "1号線"
    assert by_code["004692"]["properties"]["N02_003"] == "3号線"
    assert by_code["004691"]["properties"]["N02_005g"] == "004691"
    assert by_code["004692"]["properties"]["N02_005g"] == "004691"
    assert (
        by_code["004691"]["geometry"]["coordinates"]
        == by_code["004692"]["geometry"]["coordinates"]
    )


def test_oedo_kuramae_offset_exception_is_reviewed_at_300m() -> None:
    exceptions = _csv(ROOT / "components/toei-asakusa/overrides/offset_exceptions.csv")
    row = next(
        row
        for row in exceptions
        if row["service_id"] == "toei-oedo-loop" and row["station_id"] == "toei-kuramae"
    )
    assert row["max_platform_offset_m"] == "310"
    assert "003571" in row["reason"] and "003583" in row["reason"]
    assert "291.286 m" in row["reason"]
    assert (
        "https://www.kotsu.metro.tokyo.jp/subway/stations/kuramae.html" in row["reason"]
    )


def test_toei_platform_candidate_rejects_wrong_operator_and_wrong_line() -> None:
    stop = Stop(
        order=0,
        station_id="toei-nishi-magome",
        station_number="A01",
        platform_selector=parse_platform_selector("line=1号線浅草線"),
        original_name="西馬込",
        n02_name="西馬込",
        n02_operator="東京都",
    )
    resolution = StopResolution("東京都", "西馬込", "西馬込", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "西馬込", "1号線浅草線", "A01", "g1", geometry, Point(0, 0), "東京都"
        ),
        PlatformCandidate(
            "西馬込", "1号線浅草線", "A01", "g1", geometry, Point(0, 0), "東京都交通局"
        ),
        PlatformCandidate(
            "西馬込", "6号線三田線", "I01", "g2", geometry, Point(0, 0), "東京都"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(
        stop, resolution, SimpleNamespace(), source, {"1号線浅草線"}
    )

    assert [candidate.operator for candidate in options] == ["東京都"]
