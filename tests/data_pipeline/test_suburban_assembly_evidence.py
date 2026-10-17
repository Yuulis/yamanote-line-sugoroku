"""Batch evidence coverage and exact route-chain checks for S4."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline import stage_suburban_assembly_evidence as evidence
from scripts.data_pipeline.composition import (
    ComposeLeg,
    ComposeRecipe,
    SharedTrackEvidence,
)
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.override_models import LineRange
from scripts.data_pipeline.stage_suburban_support import StageError


def _write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), list(reader)


def _evidence_row(
    service_id: str, from_id: str, to_id: str, source_hashes: dict[str, Any]
) -> dict[str, str]:
    return {
        "service_id": service_id,
        "from_id": from_id,
        "to_id": to_id,
        "route_kind": "route",
        "n02_operator": "Fixture operator",
        "n02_line": "Fixture line",
        "from_platform_code": "from-anchor",
        "from_group_code": "from-group",
        "from_track_platform_code": "from-track",
        "to_platform_code": "to-anchor",
        "to_group_code": "to-group",
        "to_track_platform_code": "to-track",
        "path_length_km": "1.000000",
        "start_snap_m": "0.000",
        "end_snap_m": "0.000",
        "route_legs_json": "[]",
        "recipe_sha256": "a" * 64,
        "filter_sha256": "b" * 64,
        "override_sha256": source_hashes["assembledOverridesSha256"],
        "raw_station_sha256": source_hashes["rawStationSha256"],
        "raw_section_sha256": source_hashes["rawSectionSha256"],
        "distance_source_sha256": source_hashes["distanceSources"][service_id],
        "status": "pass",
        "notes": "fixture",
    }


def _install_evidence(
    directory: Path,
    batch: str,
    rows: list[dict[str, str]],
    source_hashes: dict[str, Any],
    expected_pairs: list[tuple[str, str, str]],
) -> tuple[Path, Path]:
    evidence_path = directory / "pair-evidence.csv"
    manifest_path = directory / "evidence-manifest.json"
    _write_csv(evidence_path, list(evidence.EVIDENCE_FIELDS), rows)
    manifest = {
        "formatVersion": 1,
        "batch": batch,
        "serviceIds": list(dict.fromkeys(key[0] for key in expected_pairs)),
        "pairCount": len(rows),
        "expectedPairKeysSha256": evidence.hash_value(expected_pairs),
        "pairEvidenceSha256": hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
        "sourceHashes": source_hashes,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return evidence_path, manifest_path


def _source_hashes() -> dict[str, Any]:
    return {
        "assembledOverridesSha256": "1" * 64,
        "rawStationSha256": "2" * 64,
        "rawSectionSha256": "3" * 64,
        "distanceSources": {"service-a": "4" * 64},
    }


def test_pair_primitives_expand_compose_and_validate_the_exact_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_primitives = (("owner", "a", "c", False),)
    compose_item = SimpleNamespace(compose=object())
    service = SimpleNamespace(
        id="consumer",
        station_ids=("a", "c"),
        circular=False,
        segment_ranges=lambda: (compose_item,),
    )
    overrides = SimpleNamespace(
        service=lambda service_id: SimpleNamespace(id=service_id)
    )
    monkeypatch.setattr(
        evidence, "flatten_recipe", lambda *args, **kwargs: expected_primitives
    )
    seen: list[tuple[str, str, tuple[Any, ...]]] = []
    monkeypatch.setattr(
        evidence,
        "check_recipe_anchors",
        lambda start, end, primitives: seen.append((start, end, tuple(primitives))),
    )

    primitives = evidence._pair_primitives(overrides, service, 0)

    assert primitives == expected_primitives
    assert seen == [("a", "c", primitives)]


def test_composed_pair_evidence_keeps_owner_chain_and_both_anchor_types(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    expected_primitives = (
        ("owner-a", "a", "b", False),
        ("owner-b", "b", "c", False),
    )
    service = SimpleNamespace(
        id="consumer",
        station_ids=("a", "c"),
        circular=False,
        segment_ranges=lambda: (SimpleNamespace(compose=object()),),
    )
    overrides = SimpleNamespace(service=lambda service_id: service)
    monkeypatch.setattr(evidence, "_pair_primitives", lambda *args: expected_primitives)
    monkeypatch.setattr(
        evidence, "_pair_fingerprints", lambda *args: ("r" * 64, "f" * 64)
    )

    def measured(
        _overrides: Any,
        owner_id: str,
        origin: str,
        destination: str,
        *_args: Any,
    ) -> dict[str, Any]:
        return {
            "from_id": origin,
            "to_id": destination,
            "n02_operator": "Operator",
            "n02_line": "Line",
            "from_platform_code": f"{owner_id}-{origin}-platform",
            "from_group_code": f"{owner_id}-{origin}-group",
            "from_track_platform_code": f"{owner_id}-{origin}-track",
            "to_platform_code": f"{owner_id}-{destination}-platform",
            "to_group_code": f"{owner_id}-{destination}-group",
            "to_track_platform_code": f"{owner_id}-{destination}-track",
            "path_length_km": "1.250000",
            "start_snap_m": "0.100",
            "end_snap_m": "0.200",
            "route_legs": [
                {"operator": "Operator", "line": "Line", "sectionKeys": ["x"]}
            ],
        }

    monkeypatch.setattr(evidence, "_measure_primitive", measured)
    sources = {
        "assembledOverridesSha256": "1" * 64,
        "rawStationSha256": "2" * 64,
        "rawSectionSha256": "3" * 64,
        "distanceSources": {"consumer": "4" * 64},
    }

    row = evidence._measure_batch_pair(
        overrides,
        "consumer",
        0,
        object(),
        {},
        tmp_path,
        sources,
    )

    chain = json.loads(row["route_legs_json"])
    assert row["route_kind"] == "compose"
    assert row["path_length_km"] == "2.500000"
    assert row["from_platform_code"] == "owner-a-a-platform"
    assert row["from_track_platform_code"] == "owner-a-a-track"
    assert row["to_platform_code"] == "owner-b-c-platform"
    assert row["to_track_platform_code"] == "owner-b-c-track"
    assert [
        (leg["ownerServiceId"], leg["fromId"], leg["toId"], leg["reversed"])
        for leg in chain
    ] == list(expected_primitives)
    assert row["override_sha256"] == sources["assembledOverridesSha256"]
    assert row["raw_station_sha256"] == sources["rawStationSha256"]
    assert row["raw_section_sha256"] == sources["rawSectionSha256"]
    assert row["distance_source_sha256"] == sources["distanceSources"]["consumer"]


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        ([], "missing"),
        (
            [
                _evidence_row("service-a", "a", "b", _source_hashes()),
                _evidence_row("service-a", "a", "b", _source_hashes()),
            ],
            "duplicated",
        ),
        (
            [_evidence_row("service-a", "b", "c", _source_hashes())],
            "unexpected",
        ),
    ],
)
def test_evidence_file_check_rejects_incomplete_or_duplicate_pair_coverage(
    tmp_path: Path, rows: list[dict[str, str]], message: str
) -> None:
    evidence_path, manifest_path = _install_evidence(
        tmp_path,
        "jr-core",
        rows,
        _source_hashes(),
        [("service-a", "a", "b")],
    )

    with pytest.raises(StageError, match=message):
        evidence._validate_evidence_files(
            evidence_path,
            manifest_path,
            "jr-core",
            [("service-a", "a", "b")],
            _source_hashes(),
        )


def test_evidence_file_check_rejects_tampering_and_stale_source_hashes(
    tmp_path: Path,
) -> None:
    source_hashes = _source_hashes()
    evidence_path, manifest_path = _install_evidence(
        tmp_path,
        "jr-core",
        [_evidence_row("service-a", "a", "b", source_hashes)],
        source_hashes,
        [("service-a", "a", "b")],
    )
    fields, rows = _read_csv(evidence_path)
    rows[0]["path_length_km"] = "900.000000"
    _write_csv(evidence_path, fields, rows)

    with pytest.raises(StageError, match="tampered"):
        evidence._validate_evidence_files(
            evidence_path,
            manifest_path,
            "jr-core",
            [("service-a", "a", "b")],
            source_hashes,
        )

    evidence_path, manifest_path = _install_evidence(
        tmp_path,
        "jr-core",
        [_evidence_row("service-a", "a", "b", source_hashes)],
        source_hashes,
        [("service-a", "a", "b")],
    )
    stale = {**source_hashes, "rawSectionSha256": "5" * 64}
    with pytest.raises(StageError, match="stale"):
        evidence._validate_evidence_files(
            evidence_path,
            manifest_path,
            "jr-core",
            [("service-a", "a", "b")],
            stale,
        )


def test_evidence_row_binds_platform_anchor_separately_from_track_anchor() -> None:
    row = _evidence_row("service-a", "a", "b", _source_hashes())

    assert row["from_platform_code"] != row["from_track_platform_code"]
    assert row["to_platform_code"] != row["to_track_platform_code"]


def test_valid_evidence_file_passes_coverage_and_hash_checks(tmp_path: Path) -> None:
    source_hashes = _source_hashes()
    expected_pairs = [("service-a", "a", "b")]
    evidence_path, manifest_path = _install_evidence(
        tmp_path,
        "jr-core",
        [_evidence_row("service-a", "a", "b", source_hashes)],
        source_hashes,
        expected_pairs,
    )

    result = evidence._validate_evidence_files(
        evidence_path,
        manifest_path,
        "jr-core",
        expected_pairs,
        source_hashes,
    )

    assert result == {"status": "verified", "batch": "jr-core", "pairs": 1}


def test_batch_names_partition_frozen_jr_and_nonjr_services(tmp_path: Path) -> None:
    frozen_services = [
        {"service_id": "jr-core"},
        {"service_id": "jr-new"},
        {"service_id": "metro-service"},
        {"service_id": "tobu-service"},
    ]
    catalog = {
        "jr-core": [{"operator": evidence.JR_OPERATOR}],
        "jr-new": [{"operator": evidence.JR_OPERATOR}],
        "metro-service": [{"operator": "東京地下鉄"}],
        "tobu-service": [{"operator": "東武鉄道"}],
    }
    freeze = {"shipped": {"serviceIds": ["jr-core"]}}
    assignments = {"metro": ["metro-service"], "tobu": ["tobu-service"]}
    for group in evidence.nonjr.GROUPS:
        inventory = {"serviceIds": assignments.get(group, [])}
        path = tmp_path / evidence.NONJR_STAGE_PATH / group / "inventory.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(inventory) + "\n", encoding="utf-8")

    assert evidence._batch_service_ids(
        tmp_path, "jr-core", freeze, frozen_services, catalog
    ) == ["jr-core"]
    assert evidence._batch_service_ids(
        tmp_path, "jr-new", freeze, frozen_services, catalog
    ) == ["jr-new"]
    assert evidence._batch_service_ids(
        tmp_path, "metro", freeze, frozen_services, catalog
    ) == ["metro-service"]


def test_batch_pairs_include_frozen_loop_closing_pair() -> None:
    oracle = {
        "catalogByService": {
            "loop": [
                {"station_id_proposed": "a"},
                {"station_id_proposed": "b"},
                {"station_id_proposed": "c"},
            ],
        },
        "circularByService": {"loop": True},
    }

    assert evidence._batch_pairs("metro", ["loop"], {}, oracle) == [
        ("loop", "a", "b"),
        ("loop", "b", "c"),
        ("loop", "c", "a"),
    ]


def test_jr_batch_assigns_every_pair_of_each_service_to_one_batch() -> None:
    freeze = {
        "shipped": {
            "serviceStopSequences": {"jr-core": ["a", "b"]},
        },
        "ruleset": {"targetServiceId": "jr-loop"},
    }
    oracle = {
        "catalogByService": {
            "jr-core": [
                {"station_id_proposed": "a"},
                {"station_id_proposed": "b"},
                {"station_id_proposed": "c"},
            ],
            "jr-new": [
                {"station_id_proposed": "x"},
                {"station_id_proposed": "y"},
            ],
        },
        "circularByService": {"jr-core": False, "jr-new": False},
    }

    assert evidence._batch_pairs("jr-core", ["jr-core"], freeze, oracle) == [
        ("jr-core", "a", "b"),
        ("jr-core", "b", "c"),
    ]
    assert evidence._batch_pairs("jr-new", ["jr-new"], freeze, oracle) == [
        ("jr-new", "x", "y")
    ]


def test_frozen_batches_partition_every_service_and_cover_all_2009_pairs() -> None:
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(assembly.ROOT)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    catalog_by_service: dict[str, list[dict[str, str]]] = {}
    for row in catalog:
        catalog_by_service.setdefault(row["service_id"], []).append(row)

    batch_names = ("jr-core", "jr-new", *evidence.nonjr.GROUPS)
    service_assignments = {
        batch: evidence._batch_service_ids(
            assembly.ROOT, batch, freeze, frozen_services, catalog_by_service
        )
        for batch in batch_names
    }
    all_service_ids = [
        service_id for ids in service_assignments.values() for service_id in ids
    ]
    expected_service_ids = [item["id"] for item in oracle["services"]]

    assert len(all_service_ids) == len(set(all_service_ids))
    assert set(all_service_ids) == set(expected_service_ids)
    assert len(service_assignments["jr-core"]) == 40
    assert len(service_assignments["jr-new"]) == 15

    batch_pairs = {
        batch: evidence._batch_pairs(batch, service_ids, freeze, oracle)
        for batch, service_ids in service_assignments.items()
    }
    jr_pair_counts = {batch: len(batch_pairs[batch]) for batch in ("jr-core", "jr-new")}
    expected_jr_pair_count = sum(
        len(
            evidence.station_pairs(
                [row["station_id_proposed"] for row in catalog_by_service[service_id]],
                oracle["circularByService"][service_id],
            )
        )
        for service_id, rows in catalog_by_service.items()
        if rows[0]["operator"] == evidence.JR_OPERATOR
    )
    all_pairs = [pair for pairs in batch_pairs.values() for pair in pairs]
    expected_pairs = [
        (service_id, origin, destination)
        for service_id in expected_service_ids
        for origin, destination in evidence.station_pairs(
            [
                row["station_id_proposed"]
                for row in oracle["catalogByService"][service_id]
            ],
            oracle["circularByService"][service_id],
        )
    ]

    assert sum(jr_pair_counts.values()) == expected_jr_pair_count == 922
    assert len(all_pairs) == oracle["counts"]["serviceRoutePairRows"] == 2009
    assert len(all_pairs) == len(set(all_pairs))
    assert set(all_pairs) == set(expected_pairs)


def test_live_distance_reference_hash_changes_with_source(tmp_path: Path) -> None:
    overrides = tmp_path / assembly.JR_OVERRIDES_PATH
    overrides.mkdir(parents=True)
    _write_csv(
        overrides.parent / "length-refs.csv",
        ["service_id", "from", "to", "km", "source_url"],
        [],
    )
    services_path = tmp_path / "data/overrides/services.json"
    services_path.parent.mkdir(parents=True)
    services_path.write_text(
        json.dumps(
            {
                "services": [
                    {
                        "id": "jr-yamanote",
                        "lengthRef": {"km": 34.5, "source": "fixture"},
                    }
                ]
            }
        )
        + "\n",
        encoding="utf-8",
    )

    before = evidence._service_distance_source_hash(tmp_path, overrides, "jr-yamanote")
    services_path.write_text(
        json.dumps(
            {
                "services": [
                    {
                        "id": "jr-yamanote",
                        "lengthRef": {"km": 34.6, "source": "fixture"},
                    }
                ]
            }
        )
        + "\n",
        encoding="utf-8",
    )

    assert before != evidence._service_distance_source_hash(
        tmp_path, overrides, "jr-yamanote"
    )


def test_measure_pairs_writes_only_the_selected_batch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service_id = "service-a"
    source_hashes = _source_hashes()
    oracle = {
        "catalogByService": {
            service_id: [
                {"station_id_proposed": "a", "order": "0"},
                {"station_id_proposed": "b", "order": "1"},
            ]
        },
        "circularByService": {service_id: False},
    }
    monkeypatch.setattr(
        evidence,
        "_evidence_context",
        lambda *_args, **_kwargs: (
            {},
            oracle,
            [],
            [service_id],
            [(service_id, "a", "b")],
            source_hashes,
            SimpleNamespace(dataset=SimpleNamespace(candidate_search_bbox=[])),
        ),
    )
    monkeypatch.setattr(
        evidence,
        "N02SourceProvider",
        lambda *_args, **_kwargs: object(),
    )
    monkeypatch.setattr(
        evidence,
        "_measure_batch_pair",
        lambda *_args, **_kwargs: _evidence_row(service_id, "a", "b", source_hashes),
    )
    monkeypatch.setattr(
        evidence,
        "_load_frozen_catalog",
        lambda _root: ({}, [], [{"service_id": service_id}]),
    )
    monkeypatch.setattr(
        evidence,
        "_load_source_sets",
        lambda *_args, **_kwargs: (
            {service_id: {"overrides": tmp_path / "source"}},
            {},
        ),
    )
    monkeypatch.setattr(evidence, "_check_batch_length_tolerances", lambda *args: None)
    monkeypatch.setattr(evidence, "_validate_route_fingerprints", lambda *args: None)
    monkeypatch.setattr(
        evidence,
        "check_evidence",
        lambda *_args, **_kwargs: {
            "status": "verified",
            "batch": "fixture",
            "pairs": 1,
        },
    )

    result = evidence.measure_pairs("fixture", root=tmp_path)

    output = tmp_path / evidence.ASSEMBLED_PATH / "evidence/fixture"
    assert result["status"] == "verified"
    assert {path.name for path in output.iterdir()} == {
        evidence.EVIDENCE_FILE,
        evidence.EVIDENCE_MANIFEST,
    }
    all_files = {
        path.relative_to(tmp_path).as_posix()
        for path in tmp_path.rglob("*")
        if path.is_file()
    }
    assert all_files == {
        f"{evidence.ASSEMBLED_PATH}/evidence/fixture/{evidence.EVIDENCE_FILE}",
        f"{evidence.ASSEMBLED_PATH}/evidence/fixture/{evidence.EVIDENCE_MANIFEST}",
    }


def test_cli_exposes_batch_required_measure_and_check_commands(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        evidence,
        "measure_pairs",
        lambda batch, *, root: {"command": "measure-pairs", "batch": batch},
    )
    monkeypatch.setattr(
        evidence,
        "check_evidence",
        lambda batch, *, root: {"command": "check-evidence", "batch": batch},
    )

    assert assembly.main(["measure-pairs", "--batch", "jr-core"]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "command": "measure-pairs",
        "batch": "jr-core",
    }
    assert assembly.main(["check-evidence", "--batch", "metro"]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "command": "check-evidence",
        "batch": "metro",
    }


REPO_ROOT = Path(__file__).resolve().parents[2]
HASH_SEEDS = ("0", "1", "2", "3", "4", "5")
WITNESS_ALLOW = ("k-01", "k-02", "k-03", "k-04", "k-05", "k-06", "k-07", "k-08")


def _compose_consumer(allow: tuple[str, ...] = WITNESS_ALLOW) -> SimpleNamespace:
    """A composed consumer pair whose shared-track witness holds multi-key sets."""
    section_filter = SectionFilter(
        allow=frozenset(allow), deny=frozenset({"d-01", "d-02", "d-03", "d-04"})
    )
    recipe = ComposeRecipe(
        (
            ComposeLeg(
                source_service="owner",
                from_id="a",
                to_id="b",
                evidence=SharedTrackEvidence(
                    lines=("Line A", "Line B"),
                    section_filter=section_filter,
                    reason="shared track",
                    line_filters=(("Line A", section_filter),),
                    n02_operator="Operator",
                ),
            ),
        )
    )
    item = LineRange(from_id="a", to_id="b", n02_line="", compose=recipe)
    return SimpleNamespace(
        id="consumer",
        station_ids=("a", "b"),
        circular=False,
        segment_ranges=lambda: (item,),
    )


def _compose_fingerprints(allow: tuple[str, ...] = WITNESS_ALLOW) -> tuple[str, str]:
    consumer = _compose_consumer(allow)
    overrides = SimpleNamespace(service=lambda _service_id: consumer)
    return evidence._pair_fingerprints(overrides, consumer, 0, (), {})


def test_composed_pair_fingerprints_do_not_depend_on_the_process_hash_seed() -> None:
    # measure-pairs and check-evidence run in separate processes; frozenset
    # iteration order of str follows PYTHONHASHSEED, so the recipe and filter
    # hashes must not be built from a raw repr() of the set-bearing recipe.
    script = (
        "from tests.data_pipeline.test_suburban_assembly_evidence import "
        "_compose_fingerprints; print(*_compose_fingerprints())"
    )
    outputs = {
        subprocess.run(
            [sys.executable, "-c", script],
            cwd=REPO_ROOT,
            env={**os.environ, "PYTHONHASHSEED": seed},
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        for seed in HASH_SEEDS
    }

    assert len(outputs) == 1
    assert outputs == {" ".join(_compose_fingerprints())}


def test_stable_repr_matches_repr_for_set_free_and_sorts_set_members() -> None:
    route_item = LineRange(from_id="a", to_id="b", n02_line="Line", via=((1.5, 2.0),))
    assert evidence._stable_repr(route_item) == repr(route_item)
    assert evidence._stable_repr(None) == repr(None)
    assert evidence._stable_repr(("x",)) == repr(("x",))
    assert evidence._stable_repr(frozenset()) == repr(frozenset())
    assert evidence._stable_repr(frozenset({"only"})) == repr(frozenset({"only"}))
    assert (
        evidence._stable_repr(SectionFilter(allow=frozenset({"b", "a", "c"})))
        == "SectionFilter(allow=frozenset({'a', 'b', 'c'}), deny=frozenset())"
    )


def test_route_fingerprint_check_accepts_fresh_and_rejects_changed_recipe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(evidence, "_pair_primitives", lambda *args: ())
    catalog_by_service = {
        "consumer": [{"station_id_proposed": "a"}, {"station_id_proposed": "b"}]
    }
    oracle = {"circularByService": {"consumer": False}}
    recipe_hash, filter_hash = _compose_fingerprints()
    row = {
        "service_id": "consumer",
        "from_id": "a",
        "to_id": "b",
        "recipe_sha256": recipe_hash,
        "filter_sha256": filter_hash,
        "route_legs_json": "[]",
    }

    def overrides_for(allow: tuple[str, ...]) -> SimpleNamespace:
        consumer = _compose_consumer(allow)
        return SimpleNamespace(service=lambda _service_id: consumer)

    evidence._validate_route_fingerprints(
        [row], overrides_for(WITNESS_ALLOW), oracle, catalog_by_service
    )
    changed = overrides_for((*WITNESS_ALLOW, "k-09"))
    with pytest.raises(StageError, match="recipe hash is stale"):
        evidence._validate_route_fingerprints(
            [row], changed, oracle, catalog_by_service
        )
    with pytest.raises(StageError, match="filter hash is stale"):
        evidence._validate_route_fingerprints(
            [
                {
                    **row,
                    "recipe_sha256": _compose_fingerprints((*WITNESS_ALLOW, "k-09"))[0],
                }
            ],
            changed,
            oracle,
            catalog_by_service,
        )
