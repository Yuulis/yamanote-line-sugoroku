from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FREEZE_PATH = REPO_ROOT / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"


def test_tracked_frozen_inputs_match_git_index_blob_hashes() -> None:
    try:
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        pytest.skip("not inside an available git work tree")
    assert Path(root).resolve() == REPO_ROOT

    frozen = json.loads(FREEZE_PATH.read_text(encoding="utf-8"))
    input_hashes = frozen["inputs"]
    for relative_path, expected_hash in input_hashes.items():
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", relative_path],
            cwd=REPO_ROOT,
            capture_output=True,
        )
        if tracked.returncode != 0:
            continue
        blob = subprocess.run(
            ["git", "cat-file", "blob", f":{relative_path}"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        ).stdout
        actual_hash = hashlib.sha256(blob).hexdigest()
        assert actual_hash == expected_hash, (
            f"git index bytes for frozen input {relative_path} hash to "
            f"{actual_hash}, expected {expected_hash}"
        )
