"""Raw N02 regressions: freshly seeded regions measure every added pair."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config, export
from scripts.data_pipeline import stage_suburban_jr as stage
from scripts.data_pipeline.build import build, route_service
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import load_overrides

pytestmark = pytest.mark.skipif(
    not (stage.ROOT / "N02-25_GML/UTF-8" / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded (see data/README.md)",
)

# Frozen S2 inventory: 295 new forward pairs across the four regions.
ADDED_PAIRS = {"tohoku": 131, "takasaki": 68, "chuo": 90, "tokaido": 6}
# Pairs that failed before the fix, with the N02 line they must be measured on.
FORMER_FAILURES = {
    "tohoku": {
        ("jr-utsunomiya", "kurihashi", "koga"): "東北線",
        ("jr-shonan-shinjuku-local", "koga", "kurihashi"): "東北線",
        ("jr-joban-local", "tennodai", "toride"): "常磐線",
        ("jr-joban-rapid", "suetsugi", "hirono"): "常磐線",
        ("jr-joban-rapid", "hirono", "j-village"): "常磐線",
        ("jr-joban-rapid", "j-village", "kido"): "常磐線",
    },
    "takasaki": {
        ("jr-takasaki", "jimbohara", "shimmachi"): "高崎線",
        ("jr-takasaki", "kuragano", "takasaki"): "高崎線",
        ("jr-hachiko", "kuragano", "takasaki"): "高崎線",
        ("jr-ryomo", "ino", "shim-maebashi"): "上越線",
    },
    "chuo": {},
    "tokaido": {("jr-tokaido", "yugawara", "atami"): "東海道線"},
}


def _seed_root(root: Path) -> Path:
    source = stage.ROOT
    shutil.copytree(source / "data/overrides", root / "data/overrides")
    shutil.copytree(source / "public/data", root / "public/data")
    (root / "N02-25_GML").symlink_to(source / "N02-25_GML")
    inputs: dict[str, str] = {}
    for name in (
        "tokyo-suburban-research-catalog.csv",
        "tokyo-suburban-research-services.csv",
    ):
        relative = f".claude/docs/research/{name}"
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
        inputs[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    freeze = root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
    freeze.parent.mkdir(parents=True)
    freeze.write_text(json.dumps({"inputs": inputs}), encoding="utf-8")
    return root


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


@pytest.mark.parametrize("region", stage.REGIONS)
def test_fresh_region_seed_measures_every_added_pair(
    tmp_path: Path, region: str
) -> None:
    root = _seed_root(tmp_path)
    stage.seed(region, root=root)

    evidence_path = stage.measure_pairs(region, root=root)

    with evidence_path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == ADDED_PAIRS[region]
    assert {row["status"] for row in rows} == {"pass"}
    assert all(
        float(row[field]) <= config.MAX_SNAP_OFFSET_M
        for row in rows
        for field in ("start_snap_m", "end_snap_m")
    )
    by_pair = {(row["service_id"], row["from_id"], row["to_id"]): row for row in rows}
    for pair, line in FORMER_FAILURES[region].items():
        assert by_pair[pair]["n02_line"] == line
        assert by_pair[pair]["n02_operator"] == "東日本旅客鉄道"


@pytest.mark.parametrize(
    "region, service_id",
    [
        ("tokaido", "jr-tokaido"),
        ("takasaki", "jr-takasaki"),
        ("tohoku", "jr-utsunomiya"),
    ],
)
def test_scoped_shipped_allow_lists_build_added_pairs_and_preserve_old_records(
    tmp_path: Path, region: str, service_id: str
) -> None:
    root = _seed_root(tmp_path)
    region_dir = stage.seed(region, root=root)
    service_dir = region_dir / "services" / service_id
    old_stops = _read_csv(root / "data/overrides/services" / service_id / "stops.csv")[
        1
    ]
    sections_path = service_dir / "sections.csv"
    with sections_path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    fields.extend(column for column in ("from_id", "to_id") if column not in fields)
    for row in rows:
        row["from_id"] = old_stops[0]["station_id"] if row["action"] == "allow" else ""
        row["to_id"] = old_stops[-1]["station_id"] if row["action"] == "allow" else ""
    with sections_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    stage.measure_pairs(region, root=root)
    live_overrides = load_overrides(root / "data/overrides")
    staged_overrides = load_overrides(region_dir)
    provider = N02SourceProvider(
        root / "N02-25_GML/UTF-8",
        staged_overrides.dataset.candidate_search_bbox,
    )
    if region == "tohoku":
        baseline_service = route_service(
            provider,
            live_overrides.service(service_id),
            live_overrides.registry,
            live_overrides,
        )
        staged_service = route_service(
            provider,
            staged_overrides.service(service_id),
            staged_overrides.registry,
            staged_overrides,
        )
        staged_result = None
    else:
        baseline_result = build(root / "N02-25_GML/UTF-8", root / "data/overrides")
        staged_result = build(root / "N02-25_GML/UTF-8", region_dir)
        baseline_service = baseline_result.services[service_id]
        staged_service = staged_result.services[service_id]
    assert [
        path.geometry for path in staged_service.routed.paths[: len(old_stops) - 1]
    ] == [path.geometry for path in baseline_service.routed.paths]
    if region == "tohoku":
        return
    out_dir = root / ".claude/logs/s2/filter-integration"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    assert staged_result is not None
    export.write_outputs(out_dir, staged_result.files)

    preservation_errors = stage._check_old_pair_records(
        region_dir,
        out_dir,
        root / "public/data",
        root / "data/overrides",
    )
    assert all(
        "shipped platform coordinates changed" in error for error in preservation_errors
    ), preservation_errors
