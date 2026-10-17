"""Read-only preflight checks for frozen S2/S3 assembly inputs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline import stage_suburban_nonjr as nonjr
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    write_baseline_hashes,
)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _root(tmp_path: Path) -> Path:
    root = tmp_path
    frozen_file = root / "frozen.csv"
    frozen_file.write_text("frozen\n", encoding="utf-8")
    digest = hashlib.sha256(frozen_file.read_bytes()).hexdigest()
    _write_json(root / assembly.FREEZE_PATH, {"inputs": {"frozen.csv": digest}})
    s3 = root / "data/staging/tokyo-suburban-nonjr"
    report = _empty_report()
    _write_json(s3 / "handoff-index.json", report)
    (s3 / "README.md").write_text(nonjr._handoff_readme(report), encoding="utf-8")
    public = root / "public/data"
    public.mkdir(parents=True)
    (public / "manifest.json").write_text("{}\n", encoding="utf-8")
    for name in ("combined", "chuo", "takasaki", "tohoku", "tokaido"):
        region = root / "data/staging/tokyo-suburban-jr" / name
        region.mkdir(parents=True)
        write_baseline_hashes(region, root)
    return root


def _mock_report(monkeypatch: pytest.MonkeyPatch, report: dict[str, Any]) -> None:
    monkeypatch.setattr(nonjr, "build_handoff_report", lambda *, root: report)


def test_preflight_returns_hashes_without_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    report = _empty_report()
    _mock_report(monkeypatch, report)
    before = {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }

    result = assembly.preflight(root=root)

    after = {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }
    assert result["status"] == "ready"
    assert (
        result["freezeInputs"]["frozen.csv"]
        == hashlib.sha256((root / "frozen.csv").read_bytes()).hexdigest()
    )
    assert before == after


def test_preflight_does_not_create_or_delete_filesystem_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    _mock_report(monkeypatch, _empty_report())

    def reject_write(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("preflight attempted a filesystem write")

    monkeypatch.setattr(Path, "mkdir", reject_write)
    monkeypatch.setattr(assembly.shutil, "rmtree", reject_write)

    result = assembly.preflight(root=root)

    assert result["status"] == "ready"


def test_preflight_rejects_changed_frozen_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    _mock_report(monkeypatch, _empty_report())
    (root / "frozen.csv").write_text("changed\n", encoding="utf-8")

    with pytest.raises(StageError, match="frozen input hash mismatch"):
        assembly.preflight(root=root)


def test_preflight_rejects_stale_handoff_after_distance_input_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    s3 = root / "data/staging/tokyo-suburban-nonjr"
    (s3 / "length-refs.csv").write_text(
        "service_id,km\nservice-a,1\n", encoding="utf-8"
    )
    old_report = _empty_report()
    _write_json(s3 / "handoff-index.json", old_report)
    new_report = {**old_report, "lengthRefSha256": "changed"}
    _mock_report(monkeypatch, new_report)

    with pytest.raises(StageError, match="handoff-index.json is missing or stale"):
        assembly.preflight(root=root)


def test_preflight_rejects_crlf_staged_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    _mock_report(monkeypatch, _empty_report())
    staged = root / "data/staging/tokyo-suburban-jr" / "stops.csv"
    staged.parent.mkdir(parents=True, exist_ok=True)
    staged.write_bytes(b"id\r\n")

    with pytest.raises(StageError, match="not LF-only"):
        assembly.preflight(root=root)


def test_preflight_rejects_baseline_mismatch_from_s3_verifier(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)

    def reject_baseline(*, root: Path) -> dict[str, Any]:
        raise StageError(
            "handoff is incomplete: metro: liveOverrides baseline mismatch"
        )

    monkeypatch.setattr(nonjr, "build_handoff_report", reject_baseline)
    with pytest.raises(StageError, match="liveOverrides baseline mismatch"):
        assembly.preflight(root=root)


def test_preflight_rejects_live_s2_baseline_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _root(tmp_path)
    _mock_report(monkeypatch, _empty_report())
    (root / "public/data/manifest.json").write_text(
        '{"changed":true}\n', encoding="utf-8"
    )

    with pytest.raises(
        StageError,
        match="S2 baseline mismatch: data/staging/tokyo-suburban-jr/combined/baseline-sha256.json",
    ):
        assembly.preflight(root=root)


def _empty_report() -> dict[str, Any]:
    return {
        "counts": {"services": 0, "stops": 0, "pairs": 0, "directedSegments": 0},
        "groups": {},
    }
