"""Pin the completed S3 non-JR handoff inventory and reviewed exceptions."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.data_pipeline.stage_suburban_nonjr import (
    GROUP_OPERATORS,
    handoff,
)
from scripts.data_pipeline.stage_suburban_support import read_csv, research_rows

ROOT = Path(__file__).parents[2]
STAGING = ROOT / "data/staging/tokyo-suburban-nonjr"
EXPECTED_COUNTS = {
    "services": 80,
    "stops": 1166,
    "pairs": 1087,
    "directedSegments": 2174,
}
EXPECTED_GROUP_COUNTS = {
    "metro": (10, 186, 176),
    "toei-yokohama": (7, 149, 143),
    "tobu": (14, 219, 205),
    "seibu": (12, 105, 93),
    "keisei-hokuso-tx": (10, 132, 122),
    "tokyu-mm": (10, 123, 113),
    "keio-odakyu": (9, 146, 137),
    "keikyu-sotetsu": (8, 106, 98),
}
EXPECTED_EXCEPTIONS = {
    ("offset", "metro", "metro-chiyoda", "metro-kokkai-gijidomae", "270"),
    ("offset", "metro", "metro-chiyoda", "metro-otemachi", "330"),
    ("offset", "metro", "metro-yurakucho", "metro-iidabashi", "310"),
    ("offset", "metro", "metro-hanzomon", "metro-nagatacho", "280"),
    ("offset", "metro", "metro-hanzomon", "metro-mitsukoshimae", "270"),
    ("offset", "metro", "metro-namboku", "metro-iidabashi", "270"),
    ("offset", "metro", "metro-fukutoshin", "metro-ikebukuro", "350"),
    ("offset", "toei-yokohama", "toei-oedo-loop", "toei-kuramae", "310"),
    ("detour", "tobu", "tobu-sano", "tobu-sanoshi", "2.10"),
    ("junction", "tobu", "tobu-oshiage", "", "139.81336,35.71012"),
}


def test_handoff_pins_frozen_coverage_identity_and_current_group_audits() -> None:
    report = handoff(root=ROOT)
    frozen_catalog = research_rows(ROOT, "tokyo-suburban-research-catalog.csv")
    nonjr_operators = {
        operator for operators in GROUP_OPERATORS.values() for operator in operators
    }
    expected_by_group = {
        group: {
            row["service_id"] for row in frozen_catalog if row["operator"] in operators
        }
        for group, operators in GROUP_OPERATORS.items()
    }
    actual_assignments = [
        service_id
        for values in report["groups"].values()
        for service_id in values["serviceIds"]
    ]
    expected_ids = {
        row["service_id"]
        for row in frozen_catalog
        if row["operator"] in nonjr_operators
    }

    assert report["counts"] == EXPECTED_COUNTS
    assert report["expected"] == EXPECTED_COUNTS
    assert report["duplicateServices"] == []
    assert report["missingServices"] == []
    assert report["unexpectedServices"] == []
    assert set(actual_assignments) == expected_ids
    assert len(actual_assignments) == len(set(actual_assignments)) == 80
    assert report["identityMapFindings"] == []
    assert report["freshnessFindings"] == []

    for group, expected_service_ids in expected_by_group.items():
        group_record = report["groups"][group]
        assert set(group_record["serviceIds"]) == expected_service_ids
        assert group_record["status"] == "audited"
        assert (
            group_record["services"],
            group_record["stops"],
            group_record["pairs"],
        ) == EXPECTED_GROUP_COUNTS[group]

        identity_rows = read_csv(STAGING / group / "identity-map.csv")[1]
        expected_identity = [
            {
                "service_id": row["service_id"],
                "station_id_original": row["station_id_original"],
                "station_id_proposed": row["station_id_proposed"],
            }
            for row in frozen_catalog
            if row["service_id"] in expected_service_ids
        ]
        assert identity_rows == expected_identity


def test_handoff_lists_every_reviewed_exception_at_its_approved_limit() -> None:
    report = handoff(root=ROOT)
    exceptions = report["exceptions"]
    actual = {
        (
            row["kind"],
            row["group"],
            row["serviceId"],
            row["stationId"] or row["fromId"],
            row["limit"],
        )
        for row in exceptions
    }

    assert actual == EXPECTED_EXCEPTIONS
    assert len(exceptions) == len(EXPECTED_EXCEPTIONS)
    for row in exceptions:
        if row["kind"] == "offset":
            assert "https://" in row["reason"]
            assert "N02" in row["reason"] and "m" in row["reason"]
        elif row["kind"] == "detour":
            assert "https://www.tobu.co.jp/" in row["reason"]
            assert "2.05" in row["reason"]
        else:
            assert row["limit"] == "139.81336,35.71012"
            assert "exact start" in row["reason"]

    index_path = STAGING / "handoff-index.json"
    readme_path = STAGING / "README.md"
    assert json.loads(index_path.read_text(encoding="utf-8")) == report
    readme = readme_path.read_text(encoding="utf-8")
    assert "stage_suburban_nonjr handoff" in readme
    assert "handoff-index.json" in readme
    assert (
        "80 services, 1166 stop rows, 1087 forward pairs, and 2174 directed segments"
        in readme
    )
