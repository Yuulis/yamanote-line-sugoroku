"""Regression tests for stable recipe fingerprints and old-edition baselines."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.data_pipeline import stage_suburban_nonjr as nonjr
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    _stable_repr,
    hash_tree,
    read_csv,
    read_json,
    resolve_historical_baseline,
    write_json,
)


def _seed_baselines(root: Path) -> tuple[Path, Path]:
    public = root / "public/data"
    overrides = root / "data/overrides"
    public.mkdir(parents=True)
    overrides.mkdir(parents=True)
    (public / "manifest.json").write_text("old manifest\n", encoding="utf-8")
    (public / "services.json").write_text("old services\n", encoding="utf-8")
    (overrides / "dataset.json").write_text(
        json.dumps({"areaName": "old edition", "operator": "old operator"}) + "\n",
        encoding="utf-8",
    )
    (overrides / "services.json").write_text("old overrides\n", encoding="utf-8")

    jr_baseline = root / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
    jr_baseline.parent.mkdir(parents=True)
    public_hashes = hash_tree(public)
    write_json(jr_baseline, public_hashes)

    nonjr_baseline = (
        root / "data/staging/tokyo-suburban-nonjr/metro/baseline-sha256.json"
    )
    nonjr_baseline.parent.mkdir(parents=True)
    write_json(
        nonjr_baseline,
        {
            "schemaVersion": 1,
            "publicData": public_hashes,
            "liveOverrides": hash_tree(overrides),
        },
    )

    archive = root / "data/baselines/jr-east-capital-region"
    shutil.copytree(public, archive / "public/data")
    shutil.copytree(overrides, archive / "data/overrides")
    return public, overrides


def _install_product_marker(root: Path) -> None:
    dataset_path = root / "data/overrides/dataset.json"
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    dataset.update(
        {
            "areaName": "Tokyo suburban rail",
            "operator": "Tokyo suburban rail operators",
            "validationProfile": "gameplay",
            "startStationId": "shimbashi",
            "targetServiceId": "jr-yamanote",
        }
    )
    dataset.pop("stageStartStationId", None)
    write_json(dataset_path, dataset)
    (root / "public/data/manifest.json").write_text(
        "product manifest\n", encoding="utf-8"
    )


def test_stable_repr_keeps_set_free_rendering_and_sorts_frozensets() -> None:
    assert _stable_repr(("line", "route")) == repr(("line", "route"))
    assert _stable_repr(frozenset()) == repr(frozenset())
    assert _stable_repr(frozenset({"zebra", "apple", "metro"})) == (
        "frozenset({'apple', 'metro', 'zebra'})"
    )


def test_frozenset_recipe_hash_is_stable_across_processes() -> None:
    script = """\
from scripts.data_pipeline.stage_suburban_support import _stable_repr, hash_value
value = frozenset({'zebra', 'apple', 'metro', 'rapid'})
print(hash_value({'recipe': _stable_repr(value)}))
"""
    hashes = []
    for seed in ("1", "777"):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        result = subprocess.run(
            [sys.executable, "-c", script],
            check=True,
            capture_output=True,
            cwd=Path(__file__).resolve().parents[2],
            env=env,
            text=True,
        )
        hashes.append(result.stdout.strip())

    assert hashes[0] == hashes[1]


def test_stable_recipe_hashes_match_every_accepted_s3_pair() -> None:
    checked = 0
    for group in nonjr.GROUPS:
        group_root = nonjr._group_root(nonjr.ROOT, group)
        inventory = read_json(group_root / "inventory.json")
        _, evidence_rows = read_csv(group_root / "pair-evidence.csv")
        for component in inventory["components"]:
            component_id = component["componentId"]
            overrides = load_overrides(
                nonjr._component_overrides(nonjr.ROOT, group, component_id)
            )
            for service in overrides.services:
                pairs = service.segment_ranges()
                for row in evidence_rows:
                    if row["service_id"] != service.id:
                        continue
                    pair_index = next(
                        index
                        for index, item in enumerate(pairs)
                        if (item.from_id, item.to_id) == (row["from_id"], row["to_id"])
                    )
                    item = pairs[pair_index]
                    operators = service.range_operators(item, overrides.dataset)
                    assert (
                        nonjr._filter_recipe_hash(service, pair_index, item, operators)
                        == row["filter_recipe_sha256"]
                    ), (
                        f"{group}/{component_id}/{service.id}/"
                        f"{row['from_id']}~{row['to_id']}"
                    )
                    checked += 1

    assert checked == 1087


def test_historical_fixtures_and_installed_product_fixtures_are_separate(
    published_dataset,
    committed_overrides,
    installed_product_dataset,
    installed_product_overrides,
) -> None:
    assert len(committed_overrides.services) == 40
    assert len(committed_overrides.registry.stations) == 472
    assert len(published_dataset.service_patterns) == 40

    installed_service_ids = [
        service.id for service in installed_product_overrides.services
    ]
    product_service_ids = [
        service["id"] for service in installed_product_dataset.service_patterns
    ]
    assert installed_service_ids == product_service_ids


def test_repository_archive_matches_all_saved_s2_and_s3_baselines() -> None:
    archive = nonjr.ROOT / "data/baselines/jr-east-capital-region"
    expected_public = read_json(
        nonjr.ROOT / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
    )
    assert hash_tree(archive / "public/data") == expected_public

    expected_overrides = None
    for group in nonjr.GROUPS:
        snapshot = read_json(
            nonjr._group_root(nonjr.ROOT, group) / "baseline-sha256.json"
        )
        assert snapshot["publicData"] == expected_public
        if expected_overrides is None:
            expected_overrides = snapshot["liveOverrides"]
        assert snapshot["liveOverrides"] == expected_overrides
    assert expected_overrides is not None
    assert hash_tree(archive / "data/overrides") == expected_overrides


def test_historical_resolver_prefers_live_baseline_before_product_cutover(
    tmp_path: Path,
) -> None:
    public, overrides = _seed_baselines(tmp_path)

    assert resolve_historical_baseline(tmp_path, "public/data") == public
    assert resolve_historical_baseline(tmp_path, "data/overrides") == overrides


def test_historical_resolver_uses_complete_verified_archive_after_cutover(
    tmp_path: Path,
) -> None:
    _seed_baselines(tmp_path)
    _install_product_marker(tmp_path)
    archive = tmp_path / "data/baselines/jr-east-capital-region"

    assert (
        resolve_historical_baseline(tmp_path, "public/data") == archive / "public/data"
    )
    assert (
        resolve_historical_baseline(tmp_path, "data/overrides")
        == archive / "data/overrides"
    )


def test_historical_resolver_rejects_archive_tampering_after_cutover(
    tmp_path: Path,
) -> None:
    _seed_baselines(tmp_path)
    _install_product_marker(tmp_path)
    archive_public = (
        tmp_path / "data/baselines/jr-east-capital-region/public/data/manifest.json"
    )
    archive_public.write_text("tampered\n", encoding="utf-8")

    with pytest.raises(StageError, match="historical baseline archive mismatch"):
        resolve_historical_baseline(tmp_path, "public/data")


def test_historical_resolver_rejects_missing_archive_files_after_cutover(
    tmp_path: Path,
) -> None:
    _seed_baselines(tmp_path)
    _install_product_marker(tmp_path)
    archive_overrides = (
        tmp_path / "data/baselines/jr-east-capital-region/data/overrides/services.json"
    )
    archive_overrides.unlink()

    with pytest.raises(StageError, match="historical baseline archive mismatch"):
        resolve_historical_baseline(tmp_path, "public/data")


def test_historical_resolver_keeps_pre_cutover_live_mismatch_visible(
    tmp_path: Path,
) -> None:
    public, _ = _seed_baselines(tmp_path)
    (public / "manifest.json").write_text("unexpected live change\n", encoding="utf-8")

    with pytest.raises(StageError, match="live historical baseline mismatch"):
        resolve_historical_baseline(tmp_path, "public/data")


def _seed_live_length_reference(root: Path) -> tuple[Path, Path]:
    """Seed a combined JR owner whose distance falls back to live services.json."""
    public = root / "public/data"
    overrides = root / "data/overrides"
    public.mkdir(parents=True)
    overrides.mkdir(parents=True)
    (public / "manifest.json").write_text("old manifest\n", encoding="utf-8")
    write_json(
        overrides / "dataset.json",
        {"areaName": "old edition", "operator": "old operator"},
    )
    write_json(
        overrides / "services.json",
        {
            "services": [
                {
                    "id": "jr-test",
                    "lengthRef": {"km": 12.3, "source": "old timetable"},
                }
            ]
        },
    )
    combined = root / "data/staging/tokyo-suburban-jr/combined"
    owner_overrides = combined / "overrides"
    owner_overrides.mkdir(parents=True)
    (combined / "length-refs.csv").write_text(
        "service_id,km,source_url\n", encoding="utf-8"
    )
    public_hashes = hash_tree(public)
    write_json(combined / "baseline-sha256.json", public_hashes)
    nonjr_baseline = root / "data/staging/tokyo-suburban-nonjr/metro"
    nonjr_baseline.mkdir(parents=True)
    write_json(
        nonjr_baseline / "baseline-sha256.json",
        {
            "schemaVersion": 1,
            "publicData": public_hashes,
            "liveOverrides": hash_tree(overrides),
        },
    )
    archive = root / "data/baselines/jr-east-capital-region"
    shutil.copytree(public, archive / "public/data")
    shutil.copytree(overrides, archive / "data/overrides")
    return overrides, owner_overrides


def _replace_live_services_with_product(root: Path) -> None:
    _install_product_marker(root)
    write_json(
        root / "data/overrides/services.json",
        {
            "services": [
                {
                    "id": "jr-test",
                    "lengthRef": {"km": 99.9, "source": "product edition"},
                }
            ]
        },
    )


def test_live_distance_reference_resolves_historical_baseline_after_cutover(
    tmp_path: Path,
) -> None:
    from scripts.data_pipeline.stage_suburban_assembly_evidence import (
        _service_distance_source_hash,
    )

    _, owner_overrides = _seed_live_length_reference(tmp_path)
    before = _service_distance_source_hash(tmp_path, owner_overrides, "jr-test")

    _replace_live_services_with_product(tmp_path)
    after = _service_distance_source_hash(tmp_path, owner_overrides, "jr-test")

    assert after == before


def test_live_distance_reference_rejects_tampered_archive_after_cutover(
    tmp_path: Path,
) -> None:
    from scripts.data_pipeline.stage_suburban_assembly_evidence import (
        _service_distance_source_hash,
    )

    _, owner_overrides = _seed_live_length_reference(tmp_path)
    _replace_live_services_with_product(tmp_path)
    archived_services = (
        tmp_path / "data/baselines/jr-east-capital-region/data/overrides/services.json"
    )
    write_json(
        archived_services,
        {"services": [{"id": "jr-test", "lengthRef": {"km": 1.0, "source": "x"}}]},
    )

    with pytest.raises(StageError, match="historical baseline archive mismatch"):
        _service_distance_source_hash(tmp_path, owner_overrides, "jr-test")


def test_live_distance_reference_rejects_changed_historical_input_before_cutover(
    tmp_path: Path,
) -> None:
    from scripts.data_pipeline.stage_suburban_assembly_evidence import (
        _service_distance_source_hash,
    )

    overrides, owner_overrides = _seed_live_length_reference(tmp_path)
    write_json(
        overrides / "services.json",
        {"services": [{"id": "jr-test", "lengthRef": {"km": 7.0, "source": "x"}}]},
    )

    with pytest.raises(StageError, match="live historical baseline mismatch"):
        _service_distance_source_hash(tmp_path, owner_overrides, "jr-test")


def test_live_distance_reference_hash_tracks_rebaselined_historical_input(
    tmp_path: Path,
) -> None:
    from scripts.data_pipeline.stage_suburban_assembly_evidence import (
        _service_distance_source_hash,
    )

    _, owner_overrides = _seed_live_length_reference(tmp_path)
    recorded = _service_distance_source_hash(tmp_path, owner_overrides, "jr-test")
    _replace_live_services_with_product(tmp_path)
    archived_overrides = (
        tmp_path / "data/baselines/jr-east-capital-region/data/overrides"
    )
    write_json(
        archived_overrides / "services.json",
        {"services": [{"id": "jr-test", "lengthRef": {"km": 7.0, "source": "x"}}]},
    )
    snapshot_path = (
        tmp_path / "data/staging/tokyo-suburban-nonjr/metro/baseline-sha256.json"
    )
    snapshot = read_json(snapshot_path)
    write_json(
        snapshot_path,
        {**snapshot, "liveOverrides": hash_tree(archived_overrides)},
    )

    assert (
        _service_distance_source_hash(tmp_path, owner_overrides, "jr-test") != recorded
    )
