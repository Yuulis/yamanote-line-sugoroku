"""S6P Tokyo staging overrides: parse, pinned oracle and stop-list reachability.

Raw N02 is not needed: routing is checked by the staged build, not here.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.topology import directed_pairs

STAGE_DIR = (
    config.REPO_ROOT
    / "data"
    / "staging"
    / "jr-east-capital-region"
    / "tokyo"
    / "overrides"
)


def test_tokyo_stage_loads_with_pinned_oracle_and_regional_profile() -> None:
    overrides = load_overrides(STAGE_DIR)

    dataset = overrides.dataset
    payload = (STAGE_DIR / dataset.expected_catalogue_file).read_bytes()
    assert hashlib.sha256(payload).hexdigest() == dataset.expected_catalogue_sha256
    assert dataset.area.prefectures == ("東京都",)
    assert dataset.budget_profile == "capital-region"
    assert dataset.simplify_tolerance_m == 1.0


def test_tokyo_stage_stop_lists_reach_every_station_both_ways() -> None:
    overrides = load_overrides(STAGE_DIR)
    report = Report()

    check_two_way_reachability(
        overrides.registry.ids,
        (
            pair
            for service in overrides.services
            for pair in directed_pairs(
                service.station_ids,
                service.circular,
                service_id=service.id,
                target_service_id=overrides.dataset.directed_segment_target_service_id,
            )
        ),
        overrides.dataset.start_station_id,
        report,
    )

    assert report.errors == []


def test_tokyo_stage_rejects_an_edited_oracle(tmp_path: Path) -> None:
    target = tmp_path / "overrides"
    shutil.copytree(STAGE_DIR, target)
    oracle_path = target / "expected-catalog.json"
    oracle = json.loads(oracle_path.read_text(encoding="utf-8"))
    oracle["services"][-1]["stationIds"].pop()
    oracle_path.write_text(json.dumps(oracle, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(OverrideError, match="SHA-256 mismatch"):
        load_overrides(target)
