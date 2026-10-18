"""Shared frozen-input and artifact helpers for suburban staging workflows."""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any


class StageError(ValueError):
    """Invalid staging input or a failed preservation gate."""


HISTORICAL_BASELINE_ROOT = Path("data/baselines/jr-east-capital-region")
HISTORICAL_BASELINE_TREES = ("public/data", "data/overrides")


def _stable_repr(value: Any) -> str:
    """Render nested values deterministically while preserving set-free reprs."""
    if isinstance(value, set | frozenset):
        if not value:
            return repr(value)
        members = ", ".join(sorted(_stable_repr(member) for member in value))
        if isinstance(value, frozenset):
            return f"frozenset({{{members}}})"
        return f"{{{members}}}"
    if is_dataclass(value) and not isinstance(value, type):
        parts = ", ".join(
            f"{field.name}={_stable_repr(getattr(value, field.name))}"
            for field in fields(value)
            if field.repr
        )
        return f"{type(value).__qualname__}({parts})"
    if isinstance(value, tuple):
        items = [_stable_repr(item) for item in value]
        return f"({items[0]},)" if len(items) == 1 else f"({', '.join(items)})"
    if isinstance(value, list):
        return f"[{', '.join(_stable_repr(item) for item in value)}]"
    if isinstance(value, dict):
        entries = ", ".join(
            f"{_stable_repr(key)}: {_stable_repr(item)}" for key, item in value.items()
        )
        return f"{{{entries}}}"
    return repr(value)


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


def baseline_hashes(root: Path) -> dict[str, str]:
    """Return the selected historical public-data hashes for staging checks."""
    return hash_tree(resolve_historical_baseline(root, "public/data"))


def _baseline_hash_records(root: Path, relative: str) -> list[dict[str, str]]:
    """Read every saved staging hash map for one historical tree."""
    records: list[dict[str, str]] = []
    staging_roots = (
        root / "data/staging/tokyo-suburban-jr",
        root / "data/staging/tokyo-suburban-nonjr",
    )
    for staging_root in staging_roots:
        if not staging_root.is_dir():
            continue
        for path in sorted(staging_root.rglob("baseline-sha256.json")):
            try:
                snapshot = read_json(path)
            except (OSError, json.JSONDecodeError) as error:
                raise StageError(
                    f"saved staging baseline is unreadable: {path.relative_to(root)}"
                ) from error
            if not isinstance(snapshot, dict):
                continue
            if relative == "public/data":
                candidate = snapshot.get("publicData", snapshot)
            else:
                candidate = snapshot.get("liveOverrides")
            if (
                isinstance(candidate, dict)
                and candidate
                and all(
                    isinstance(name, str) and isinstance(digest, str)
                    for name, digest in candidate.items()
                )
            ):
                records.append(candidate)
    return records


def _saved_baseline_hashes(root: Path, relative: str) -> dict[str, str] | None:
    records = _baseline_hash_records(root, relative)
    if not records:
        return None
    expected = records[0]
    if any(record != expected for record in records[1:]):
        raise StageError(f"saved staging baselines disagree for {relative}")
    return expected


def _is_product_cutover(root: Path) -> bool:
    """Recognize only the S5 product identity that replaces historical live data."""
    try:
        dataset = read_json(root / "data/overrides/dataset.json")
    except (OSError, json.JSONDecodeError):
        return False
    return (
        isinstance(dataset, dict)
        and dataset.get("operator") == "Tokyo suburban rail operators"
        and dataset.get("areaName") == "Tokyo suburban rail"
        and dataset.get("validationProfile") == "gameplay"
        and dataset.get("startStationId") == "shimbashi"
        and dataset.get("targetServiceId") == "jr-yamanote"
        and "stageStartStationId" not in dataset
    )


def resolve_historical_baseline(root: Path, relative: str) -> Path:
    """Resolve an old-edition tree, preferring verified live data before cutover.

    The archived copy is eligible only after S5 product metadata replaces the
    live edition and both archived trees exactly match the saved staging hashes.
    """
    if relative not in HISTORICAL_BASELINE_TREES:
        raise StageError(f"unsupported historical baseline tree: {relative}")
    expected = _saved_baseline_hashes(root, relative)
    live = root / relative
    if expected is None:
        return live
    if live.is_dir() and hash_tree(live) == expected:
        return live
    if not _is_product_cutover(root):
        raise StageError(f"live historical baseline mismatch: {relative}")

    archive = root / HISTORICAL_BASELINE_ROOT
    for archived_relative in HISTORICAL_BASELINE_TREES:
        archived_expected = _saved_baseline_hashes(root, archived_relative)
        archived = archive / archived_relative
        if (
            archived_expected is None
            or not archived.is_dir()
            or hash_tree(archived) != archived_expected
        ):
            raise StageError(
                f"historical baseline archive mismatch: {archived_relative}"
            )
    return archive / relative


def write_baseline_hashes(region_root: Path, root: Path) -> None:
    write_json(region_root / "baseline-sha256.json", baseline_hashes(root))


def research_rows(root: Path, filename: str) -> list[dict[str, str]]:
    return read_csv(root / ".claude/docs/research" / filename)[1]
