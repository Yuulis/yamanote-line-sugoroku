"""Shared frozen-input and artifact helpers for suburban staging workflows."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any


class StageError(ValueError):
    """Invalid staging input or a failed preservation gate."""


def sha256_file(path: Path) -> str:
    """Hash a file without loading the full file into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_tree(path: Path) -> dict[str, str]:
    """Return sorted relative-file SHA-256 values for a directory tree."""
    if not path.is_dir():
        return {}
    return {
        child.relative_to(path).as_posix(): sha256_file(child)
        for child in sorted(path.rglob("*"))
        if child.is_file()
    }


def hash_value(value: Any) -> str:
    """Hash a stable UTF-8 JSON representation of a value."""
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def verify_freeze(freeze_path: Path, root: Path) -> None:
    """Reject staging if any source pinned by the freeze manifest has drifted."""
    freeze = read_json(freeze_path)
    for name, expected in freeze["inputs"].items():
        path = root / name
        if (
            not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            raise StageError(f"frozen input hash mismatch: {name}")


def write_baseline_hashes(region_root: Path, root: Path) -> None:
    baseline = root / "public/data"
    hashes = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(baseline.iterdir())
        if path.is_file()
    }
    write_json(region_root / "baseline-sha256.json", hashes)


def research_rows(root: Path, filename: str) -> list[dict[str, str]]:
    return read_csv(root / ".claude/docs/research" / filename)[1]
