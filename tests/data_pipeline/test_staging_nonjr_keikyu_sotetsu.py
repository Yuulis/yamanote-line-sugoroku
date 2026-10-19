"""Regressions for Keikyu and Sotetsu S3 staging inputs."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.registry import normalize_station_name
from scripts.data_pipeline.stage_suburban_jr import _candidate_options
from tests.data_pipeline._local_inputs import requires_raw_n02

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/keikyu-sotetsu"
RAW_STATIONS = Path(__file__).parents[2] / "N02-25_GML/UTF-8/N02-25_Station.geojson"
EXPECTED = {
    "keikyu-main": ("京浜急行電鉄", "本線", 50),
    "keikyu-airport": ("京浜急行電鉄", "空港線", 7),
    "keikyu-daishi": ("京浜急行電鉄", "大師線", 7),
    "keikyu-zushi": ("京浜急行電鉄", "逗子線", 4),
    "keikyu-kurihama": ("京浜急行電鉄", "久里浜線", 9),
    "sotetsu-main": ("相模鉄道", "相鉄本線", 18),
    "sotetsu-izumino": ("相模鉄道", "相鉄いずみ野線", 8),
    "sotetsu-shin-yokohama": ("相模鉄道", "相鉄新横浜線", 3),
}


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def _service_files(service_id: str) -> tuple[Path, Path]:
    for path in ROOT.glob("components/*/overrides/services/*/stops.csv"):
        if path.parent.name == service_id:
            return path, path.with_name("line_mapping.csv")
    raise AssertionError(f"missing staged service {service_id}")


def test_group_inventory_and_pair_evidence_cover_frozen_services() -> None:
    inventory = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))
    evidence = _csv(ROOT / "pair-evidence.csv")

    assert inventory["counts"] == {"services": 8, "stops": 106, "pairs": 98}
    assert {row["service_id"] for row in evidence} == set(EXPECTED)
    assert len(evidence) == 98
    assert all(row["status"] == "pass" for row in evidence)

    for service_id, (operator, line, stop_count) in EXPECTED.items():
        rows = [row for row in evidence if row["service_id"] == service_id]
        assert len(rows) == stop_count - 1
        assert {(row["n02_operator"], row["n02_line"]) for row in rows} == {
            (operator, line)
        }


@requires_raw_n02()
def test_keikyu_and_sotetsu_selectors_pin_frozen_name_raw_n02_features() -> None:
    raw = json.loads(RAW_STATIONS.read_text(encoding="utf-8"))["features"]

    for service_id, (operator, line, stop_count) in EXPECTED.items():
        stops_path, line_path = _service_files(service_id)
        stops = _csv(stops_path)
        line_by_station: dict[str, str] = {}
        for row in _csv(line_path):
            line_by_station[row["from_id"]] = row["n02_line"]
            line_by_station[row["to_id"]] = row["n02_line"]
        assert len(stops) == stop_count
        assert all(line_by_station[row["station_id"]] == line for row in stops)
        for row in stops:
            selector = parse_platform_selector(row["platform_selector"])
            assert selector.codes and selector.groups
            candidates = [
                feature["properties"]
                for feature in raw
                if feature["properties"].get("N02_004") == operator
                and feature["properties"].get("N02_003") == line
                and normalize_station_name(feature["properties"].get("N02_005", ""))
                == normalize_station_name(row["n02_name"])
                and feature["properties"].get("N02_005c") in selector.codes
                and feature["properties"].get("N02_005g") in selector.groups
            ]
            assert len(candidates) == 1, row["station_id"]
            assert normalize_station_name(row["n02_name"]) == normalize_station_name(
                row["original_name"]
            )
            assert row["n02_operator"] == operator


def test_required_branch_and_boundary_stops_are_present() -> None:
    keikyu_main, _ = _service_files("keikyu-main")
    main_rows = _csv(keikyu_main)
    assert main_rows[0]["station_id"] == "keikyu-sengakuji"
    assert parse_platform_selector(
        main_rows[0]["platform_selector"]
    ).codes == frozenset({"004043"})

    kurihama, _ = _service_files("keikyu-kurihama")
    assert [row["station_id"] for row in _csv(kurihama)] == [
        "keikyu-horinouchi",
        "keikyu-shin-otsu",
        "keikyu-kitakurihama",
        "keikyu-kurihama",
        "keikyu-yrp-nobi",
        "keikyu-nagasawa",
        "keikyu-tsukuihama",
        "keikyu-miurakaigan",
        "keikyu-misakiguchi",
    ]

    shin_yokohama, _ = _service_files("sotetsu-shin-yokohama")
    assert [row["station_id"] for row in _csv(shin_yokohama)] == [
        "sotetsu-nishiya",
        "sotetsu-hazawa-yokohama-kokudai",
        "sotetsu-shin-yokohama",
    ]


def test_wrong_operator_and_line_candidates_are_rejected() -> None:
    stop = Stop(
        order=0,
        station_id="keikyu-sengakuji",
        station_number="",
        platform_selector=parse_platform_selector("line=本線;group=004042;code=004043"),
        original_name="泉岳寺",
        n02_name="泉岳寺",
        n02_operator="京浜急行電鉄",
    )
    resolution = StopResolution("京浜急行電鉄", "泉岳寺", "泉岳寺", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "泉岳寺", "本線", "004043", "004042", geometry, Point(0, 0), "京浜急行電鉄"
        ),
        PlatformCandidate(
            "泉岳寺", "1号線浅草線", "004042", "004042", geometry, Point(0, 0), "東京都"
        ),
        PlatformCandidate(
            "泉岳寺", "本線", "004043", "004042", geometry, Point(0, 0), "他社"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = _candidate_options(stop, resolution, SimpleNamespace(), source, {"本線"})

    assert [(item.operator, item.n02_line, item.station_code) for item in options] == [
        ("京浜急行電鉄", "本線", "004043")
    ]
