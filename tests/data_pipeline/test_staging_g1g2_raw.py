"""Raw-N02 proof of G1/G2 on a scratch copy of the Tokyo stage (skipped in CI).

G2: jr-joban-rapid 品川–東京–上野–日暮里 routes with a reviewed platform
transfer at 上野 (N02 東北線 has two disconnected components there).
G1: jr-shonan-shinjuku-local composes 池袋→新宿 from jr-saikyo next to its
東北線→山手線 route 赤羽→池袋.
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.validate import load_dataset, validate_dataset
from tests.data_pipeline.test_staging_tokyo import STAGE_DIR

RAW_AVAILABLE = (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file()
pytestmark = pytest.mark.skipif(
    not RAW_AVAILABLE, reason="raw N02 data not downloaded (see data/README.md)"
)

JOBAN = "jr-joban-rapid"
JOBAN_STOPS = (
    "shinagawa",
    "shimbashi",
    "tokyo",
    "ueno",
    "nippori",
    "mikawashima",
    "minami-senju",
    "kita-senju",
)
UENO_TRANSFER_M = 150


def _write_rows(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle, lineterminator="\n").writerows(rows)


def _rewrite_json(path: Path, edit: object) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    edit(payload)  # type: ignore[operator]
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _scratch_stage(target: Path) -> Path:
    shutil.copytree(STAGE_DIR, target)
    registry = {
        row["id"]: row
        for row in csv.DictReader((target / "stations.csv").open(encoding="utf-8"))
    }
    joban = target / "services" / JOBAN
    numbers = ["", "", "", "JJ01", "JJ02", "JJ03", "JJ04", "JJ05"]
    _write_rows(
        joban / "stops.csv",
        [["order", "station_id", "station_number", "platform_selector"]]
        + [[str(i), s, numbers[i], ""] for i, s in enumerate(JOBAN_STOPS)],
    )
    _write_rows(
        joban / "scope.csv",
        [["station_id", "prefecture", "municipality"]]
        + [
            [s, registry[s]["prefecture"], registry[s]["municipality"]]
            for s in JOBAN_STOPS
        ]
        + [["matsudo", "千葉県", "松戸市"]],
    )
    _write_rows(
        joban / "line_mapping.csv",
        [
            ["from_id", "to_id", "n02_line", "via"],
            ["shinagawa", "tokyo", "東海道線", ""],
            ["tokyo", "nippori", "東北線", ""],
            ["nippori", "kita-senju", "常磐線", ""],
        ],
    )
    _write_rows(
        target / config.PLATFORM_TRANSFERS_OVERRIDE_FILE,
        [
            ["service_id", "station_id", "max_transfer_m", "reason"],
            [JOBAN, "ueno", str(UENO_TRANSFER_M), "Two N02 東北線 components at 上野"],
        ],
    )

    def joban_definition(payload: dict) -> None:
        for service in payload["services"]:
            if service["id"] == JOBAN:
                service["expectedStopCount"] = len(JOBAN_STOPS)
                service["stationNumberRules"]["sequence"] = numbers
                service["lengthRef"]["km"] = 17.8

    _rewrite_json(target / "services.json", joban_definition)
    mapping = target / "services" / "jr-shonan-shinjuku-local" / "line_mapping.csv"
    rows = list(csv.reader(mapping.open(encoding="utf-8")))
    for row in rows[1:]:
        if row[:2] == ["ikebukuro", "shinjuku"]:
            row[2] = ""
            row[5] = json.dumps(
                {
                    "legs": [
                        {
                            "source_service": "jr-saikyo",
                            "from": "ikebukuro",
                            "to": "shinjuku",
                        }
                    ],
                    "shared_track_evidence": [
                        {
                            "lines": ["山手線"],
                            "allow": [],
                            "deny": [],
                            "reason": "山手貨物線",
                        }
                    ],
                },
                ensure_ascii=False,
            )
    _write_rows(mapping, rows)

    def full_joban(payload: dict) -> None:
        for service in payload["services"]:
            if service["id"] == JOBAN:
                service["stationIds"] = list(JOBAN_STOPS)

    _rewrite_json(target / "expected-catalog.json", full_joban)
    digest = hashlib.sha256((target / "expected-catalog.json").read_bytes()).hexdigest()
    _rewrite_json(
        target / "dataset.json",
        lambda payload: payload.update(expectedCatalogSha256=digest),
    )
    return target


def test_g1_g2_route_the_blocked_tokyo_recipes_on_raw_n02(tmp_path: Path) -> None:
    overrides = load_overrides(_scratch_stage(tmp_path / "overrides"))

    result = generate_build(config.DEFAULT_RAW_DIR, overrides)

    joban = result.services[JOBAN].routed
    ueno = JOBAN_STOPS.index("ueno")
    gap = joban.arrival(ueno).midpoint.distance(joban.departure(ueno).midpoint)
    assert 0 < gap <= UENO_TRANSFER_M
    segments = {
        item["id"]: item["geometryFeatureIds"]
        for item in json.loads(result.files[config.SEGMENTS_FILE])
    }
    assert segments["jr-shonan-shinjuku-local:ikebukuro:shinjuku"] == [
        "jr-saikyo:shinjuku~ikebukuro"
    ]
    out = tmp_path / "out"
    out.mkdir()
    for name, payload in result.files.items():
        (out / name).write_text(payload, encoding="utf-8")
    assert validate_dataset(load_dataset(out), overrides).errors == []
