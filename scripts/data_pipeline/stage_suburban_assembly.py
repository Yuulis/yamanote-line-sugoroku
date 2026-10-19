"""Preflight and assemble frozen S2/S3 suburban staging inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline import stage_suburban_nonjr as nonjr
from scripts.data_pipeline.registry import normalize_station_name
from scripts.data_pipeline.stage_suburban_assembly_identity import (
    METADATA_FIELDS,
    _group_aliases,
    convert_exceptions,
    convert_service,
)
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    baseline_hashes,
    hash_tree,
    read_csv,
    read_json,
    sha256_file,
    verify_freeze,
    write_csv,
    write_json,
)
from scripts.data_pipeline.topology import directed_pairs, station_order

ROOT = jr.ROOT
FREEZE_PATH = ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
ASSEMBLED_PATH = "data/staging/tokyo-suburban-assembled"
PROTECTED_TEXT_ROOTS = (
    "data/staging/tokyo-suburban-jr",
    "data/staging/tokyo-suburban-nonjr",
)
TEXT_SUFFIXES = {".csv", ".json", ".md", ".txt"}
CATALOG_PATH = ".claude/docs/research/tokyo-suburban-research-catalog.csv"
SERVICES_PATH = ".claude/docs/research/tokyo-suburban-research-services.csv"
JR_OVERRIDES_PATH = "data/staging/tokyo-suburban-jr/combined/overrides"
NONJR_STAGE_PATH = "data/staging/tokyo-suburban-nonjr"
IDENTITY_FIELDS = [
    "service_id",
    "order",
    "station_id_original",
    "station_id_proposed",
]


def _staged_text_findings(root: Path) -> list[str]:
    findings: list[str] = []
    for relative in PROTECTED_TEXT_ROOTS:
        directory = root / relative
        for path in sorted(directory.rglob("*")) if directory.is_dir() else []:
            if (
                path.is_file()
                and path.suffix.lower() in TEXT_SUFFIXES
                and b"\r" in path.read_bytes()
            ):
                findings.append(f"CRLF or carriage return in {path.relative_to(root)}")
    return findings


def _check_saved_handoff(root: Path, report: dict[str, Any]) -> None:
    stage_dir = root / "data/staging/tokyo-suburban-nonjr"
    index_path = stage_dir / "handoff-index.json"
    readme_path = stage_dir / "README.md"
    if not index_path.is_file() or read_json(index_path) != report:
        raise StageError("S3 handoff-index.json is missing or stale")
    expected_readme = nonjr._handoff_readme(report)
    if (
        not readme_path.is_file()
        or readme_path.read_text(encoding="utf-8") != expected_readme
    ):
        raise StageError("S3 README.md is missing or stale")


def _check_jr_baselines(root: Path) -> list[str]:
    """Compare every S2 saved baseline against current live public data."""
    staging = root / "data/staging/tokyo-suburban-jr"
    try:
        expected = baseline_hashes(root)
    except StageError as error:
        raise StageError(
            "S2 baseline mismatch: "
            "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
        ) from error
    checked: list[str] = []
    locations = [staging / "combined"] + [
        path
        for path in sorted(staging.iterdir())
        if path.is_dir() and path.name != "combined"
    ]
    for location in locations:
        baseline_path = location / "baseline-sha256.json"
        relative = baseline_path.relative_to(root).as_posix()
        if not baseline_path.is_file():
            raise StageError(f"S2 baseline is missing: {relative}")
        if read_json(baseline_path) != expected:
            raise StageError(f"S2 baseline mismatch: {relative}")
        checked.append(relative)
    return checked


def preflight(*, root: Path = ROOT) -> dict[str, Any]:
    """Verify frozen S2/S3 inputs and return their byte hashes without writing."""
    freeze_path = root / FREEZE_PATH
    verify_freeze(freeze_path, root)
    report = nonjr.build_handoff_report(root=root)
    _check_saved_handoff(root, report)
    baseline_checks = _check_jr_baselines(root)
    text_findings = _staged_text_findings(root)
    if text_findings:
        raise StageError("staged text is not LF-only: " + "; ".join(text_findings))

    freeze_inputs = read_json(root / FREEZE_PATH)["inputs"]
    input_hashes = {name: sha256_file(root / name) for name in sorted(freeze_inputs)}
    return {
        "status": "ready",
        "freezeManifestSha256": sha256_file(freeze_path),
        "freezeInputs": input_hashes,
        "jrStaging": hash_tree(root / PROTECTED_TEXT_ROOTS[0]),
        "nonjrStaging": hash_tree(root / PROTECTED_TEXT_ROOTS[1]),
        "s3Counts": report["counts"],
        "baselineChecks": baseline_checks,
        "stagedTextLineEndings": "LF",
    }


def _source_directories(root: Path) -> list[Path]:
    jr_overrides = root / JR_OVERRIDES_PATH
    nonjr_root = root / NONJR_STAGE_PATH
    if not jr_overrides.is_dir() or not nonjr_root.is_dir():
        raise StageError("frozen S2/S3 override directories are incomplete")
    return [
        jr_overrides,
        *sorted(
            path.parent
            for path in nonjr_root.rglob("dataset.json")
            if path.parent.name == "overrides" and "components" in path.parts
        ),
    ]


def _load_frozen_catalog(
    root: Path,
) -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, str]]]:
    freeze = read_json(root / FREEZE_PATH)
    verify_freeze(root / FREEZE_PATH, root)
    catalog_fields, catalog = read_csv(root / CATALOG_PATH)
    service_fields, services = read_csv(root / SERVICES_PATH)
    required_catalog = {
        "service_id",
        "order",
        "station_name_ja",
        "station_name_en_romaji",
        "prefecture",
        "municipality",
        "operator",
        "station_id_proposed",
        "n02_operator",
        "source_url",
        "station_id_original",
        "station_name_original",
    }
    if not required_catalog <= set(catalog_fields):
        raise StageError("frozen catalog is missing identity or representative fields")
    if not {
        "service_id",
        "circular",
        "stop_ids",
        "first_end_kind",
        "last_end_kind",
    } <= set(service_fields):
        raise StageError("frozen service catalog is missing route fields")
    return freeze, catalog, services


def _oracle(
    freeze: dict[str, Any],
    catalog: list[dict[str, str]],
    frozen_services: list[dict[str, str]],
) -> dict[str, Any]:
    service_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    original_targets: dict[str, set[str]] = defaultdict(set)
    target_names: dict[str, set[str]] = defaultdict(set)
    target_jr_originals: dict[str, set[str]] = defaultdict(set)
    for row in catalog:
        service_rows[row["service_id"]].append(row)
        original_targets[row["station_id_original"]].add(row["station_id_proposed"])
        target_names[row["station_id_proposed"]].add(row["station_name_ja"])
        if row["operator"] == "東日本旅客鉄道":
            target_jr_originals[row["station_id_proposed"]].add(
                row["station_id_original"]
            )
    multi_target = {
        original: sorted(targets)
        for original, targets in original_targets.items()
        if len(targets) != 1
    }
    if multi_target:
        raise StageError(
            f"frozen identity maps one original ID to multiple targets: {multi_target}"
        )
    name_collisions = {
        target: sorted(names)
        for target, names in target_names.items()
        if len(names) != 1
    }
    if name_collisions:
        raise StageError(
            f"frozen station groups have conflicting canonical names: {name_collisions}"
        )
    jr_collisions = {
        target: sorted(originals)
        for target, originals in target_jr_originals.items()
        if len(originals) > 1
    }
    if jr_collisions:
        raise StageError(
            f"distinct JR station IDs merge in frozen identity: {jr_collisions}"
        )

    by_service: dict[str, dict[str, str]] = {}
    circular_by_service: dict[str, bool] = {}
    expected_catalog: list[dict[str, Any]] = []
    identity_rows: list[dict[str, str]] = []
    catalog_by_target: dict[str, list[dict[str, str]]] = defaultdict(list)
    for service in frozen_services:
        service_id = service["service_id"]
        if service_id in by_service:
            raise StageError(
                f"duplicate service in frozen service catalog: {service_id}"
            )
        rows = sorted(
            service_rows.get(service_id, []), key=lambda row: int(row["order"])
        )
        if not rows:
            raise StageError(f"frozen service has no catalog stops: {service_id}")
        if [int(row["order"]) for row in rows] != list(range(len(rows))):
            raise StageError(f"frozen stop order is not contiguous: {service_id}")
        targets = [row["station_id_proposed"] for row in rows]
        if len(set(targets)) != len(targets):
            raise StageError(
                f"frozen service contains duplicate target station IDs: {service_id}"
            )
        stop_ids = service["stop_ids"].split("|")
        if stop_ids != targets:
            raise StageError(
                f"frozen services and catalog disagree on stop order: {service_id}"
            )
        circular = service["circular"] == "true"
        for row in rows:
            if (row["is_loop"] == "true") != circular:
                raise StageError(f"frozen circular status disagrees for {service_id}")
            catalog_by_target[row["station_id_proposed"]].append(row)
            identity_rows.append(
                {
                    "service_id": service_id,
                    "order": row["order"],
                    "station_id_original": row["station_id_original"],
                    "station_id_proposed": row["station_id_proposed"],
                }
            )
        by_service[service_id] = {
            row["station_id_original"]: row["station_id_proposed"] for row in rows
        }
        circular_by_service[service_id] = circular
        expected_catalog.append({"id": service_id, "stationIds": targets})

    extra_catalog_services = sorted(set(service_rows) - set(by_service))
    if extra_catalog_services:
        raise StageError(
            f"frozen catalog contains unlisted services: {extra_catalog_services}"
        )
    # Same definition as the freeze check: the target service runs one way only,
    # every other service contributes both directions of each pair.
    target_service_id = freeze["ruleset"]["targetServiceId"]
    route_pair_rows = 0
    directed_segments = 0
    for index, item in enumerate(expected_catalog):
        station_ids = item["stationIds"]
        circular = frozen_services[index]["circular"] == "true"
        pair_count = len(station_ids) if circular else max(len(station_ids) - 1, 0)
        route_pair_rows += pair_count
        directed_segments += len(
            directed_pairs(
                station_ids,
                circular,
                service_id=item["id"],
                target_service_id=target_service_id,
            )
        )
    expected_counts = freeze["counts"]
    counts = {
        "services": len(expected_catalog),
        "stationGroups": len(catalog_by_target),
        "serviceStopRows": len(identity_rows),
        "serviceRoutePairRows": route_pair_rows,
        "directedSegments": directed_segments,
    }
    for key in ("services", "stationGroups", "serviceStopRows", "directedSegments"):
        if counts[key] != expected_counts[key]:
            raise StageError(
                f"frozen oracle count mismatch for {key}: {counts[key]} != {expected_counts[key]}"
            )
    by_service_rows = {
        service_id: sorted(rows, key=lambda row: int(row["order"]))
        for service_id, rows in service_rows.items()
    }
    return {
        "services": expected_catalog,
        "stationIds": station_order(
            service["stationIds"] for service in expected_catalog
        ),
        "catalogByTarget": catalog_by_target,
        "catalogByService": by_service_rows,
        "byService": by_service,
        "circularByService": circular_by_service,
        "identityRows": identity_rows,
        "counts": counts,
    }


def _load_source_sets(
    root: Path, service_order: list[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, str]]]:
    sources: dict[str, dict[str, Any]] = {}
    registries: dict[str, dict[str, str]] = {}
    for overrides in _source_directories(root):
        dataset = read_json(overrides / "dataset.json")
        services = read_json(overrides / "services.json")
        definitions = {row["id"]: row for row in services["services"]}
        if len(definitions) != len(services["services"]):
            raise StageError(f"duplicate service definition in {overrides}")
        if set(definitions) != set(dataset["serviceIds"]):
            raise StageError(
                f"dataset and service definition inventories differ: {overrides}"
            )
        for service_id in dataset["serviceIds"]:
            if service_id in sources:
                raise StageError(f"service has multiple staging owners: {service_id}")
            if service_id not in definitions:
                raise StageError(f"staged service definition is missing: {service_id}")
            sources[service_id] = {
                "overrides": overrides,
                "definition": definitions[service_id],
            }
        fields, rows = read_csv(overrides / "stations.csv")
        if not {"id", "name", "prefecture", "municipality"} <= set(fields):
            raise StageError(f"staged registry schema is incomplete: {overrides}")
        for row in rows:
            station_id = row["id"]
            previous = registries.get(station_id)
            if previous is not None and previous != row:
                raise StageError(
                    f"staged registry ID has conflicting rows: {station_id}"
                )
            registries[station_id] = row
    if set(sources) != set(service_order):
        raise StageError(
            "S2/S3 service ownership differs from frozen inventory: "
            f"missing={sorted(set(service_order) - set(sources))}, "
            f"extra={sorted(set(sources) - set(service_order))}"
        )
    return sources, registries


def _station_groups(
    oracle: dict[str, Any],
    registries: dict[str, dict[str, str]],
    sources: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, str]], list[dict[str, Any]], dict[str, dict[str, str]]]:
    station_rows: list[dict[str, str]] = []
    groups: list[dict[str, Any]] = []
    registry_by_target: dict[str, dict[str, str]] = {}
    for target, rows in oracle["catalogByTarget"].items():
        frozen_name = rows[0]["station_name_ja"]
        # Registry names use the normalized spelling (as S2/S3 already do);
        # the frozen spelling stays the N02 fallback and is kept in groups.
        canonical_name = normalize_station_name(frozen_name)
        aliases = _group_aliases(
            canonical_name, [row["station_name_original"] for row in rows]
        )
        candidates = [row for row in rows if row["station_id_original"] == target]
        if not candidates:
            raise StageError(
                f"frozen station group has no representative identity: {target}"
            )
        source_registry = registries.get(target)
        if source_registry is None:
            raise StageError(
                f"representative registry row is missing for frozen ID: {target}"
            )
        representative_service = source_registry["representative_service_id"]
        representative_rows = [
            row
            for row in rows
            if row["service_id"] == representative_service
            and row["station_id_original"] == target
        ]
        if not representative_rows:
            raise StageError(
                "representative service does not match the frozen target identity: "
                f"{target}/{representative_service}"
            )
        representative = representative_rows[0]
        if not representative["station_name_en_romaji"]:
            raise StageError(
                f"representative English name is missing for frozen ID: {target}"
            )
        if representative_service not in sources:
            raise StageError(
                f"representative service is not staged: {representative_service}"
            )
        source_name = source_registry.get("n02_name", "") or frozen_name
        station_rows.append(
            {
                "id": target,
                "name": canonical_name,
                "n02_name": source_name,
                "prefecture": representative["prefecture"],
                "municipality": representative["municipality"],
                "representative_service_id": representative_service,
                "n02_selector": source_registry.get("n02_selector", ""),
                "aliases": json.dumps(
                    aliases, ensure_ascii=False, separators=(",", ":")
                ),
                "n02_operator": representative["n02_operator"],
            }
        )
        registry_by_target[target] = station_rows[-1]
        members: list[dict[str, Any]] = []
        seen_originals: set[str] = set()
        for row in rows:
            original = row["station_id_original"]
            if original in seen_originals:
                continue
            seen_originals.add(original)
            members.append(
                {
                    "stationIdOriginal": original,
                    "stationNameOriginal": row["station_name_original"],
                    "serviceIds": list(
                        dict.fromkeys(
                            member["service_id"]
                            for member in rows
                            if member["station_id_original"] == original
                        )
                    ),
                }
            )
        groups.append(
            {
                "id": target,
                "name": canonical_name,
                "frozenName": frozen_name,
                "aliases": aliases,
                "members": members,
                "representativeServiceId": representative_service,
                "representativeMunicipality": representative["municipality"],
                "stationNameEnRomaji": representative["station_name_en_romaji"],
                "sourceReferences": list(
                    dict.fromkeys(
                        row["source_url"] for row in rows if row["source_url"]
                    )
                ),
            }
        )
    return station_rows, groups, registry_by_target


def _verify_shipped_retention(freeze: dict[str, Any], oracle: dict[str, Any]) -> None:
    shipped = freeze["shipped"]
    service_ids = shipped["serviceIds"]
    sequences = shipped["serviceStopSequences"]
    if len(service_ids) != shipped["serviceCount"] or set(service_ids) != set(
        sequences
    ):
        raise StageError("frozen shipped service inventory is inconsistent")
    if len(shipped["stationIds"]) != shipped["stationCount"]:
        raise StageError("frozen shipped station inventory is inconsistent")
    if len(set(shipped["stationIds"])) != shipped["stationCount"]:
        raise StageError("frozen shipped station IDs are duplicated")
    all_station_ids = set(oracle["catalogByTarget"])
    if not set(shipped["stationIds"]) <= all_station_ids:
        raise StageError("frozen shipped station IDs are missing from S4 catalog")
    routes = {row["id"]: row["stationIds"] for row in oracle["services"]}
    for service_id in service_ids:
        if service_id not in routes:
            raise StageError(f"frozen shipped service is missing from S4: {service_id}")
        previous = sequences[service_id]
        current = routes[service_id]
        searchable = (
            current + current[:-1]
            if oracle["circularByService"][service_id] and current
            else current
        )
        if not any(
            searchable[index : index + len(previous)] == previous
            for index in range(len(current))
        ):
            raise StageError(
                f"frozen shipped stop order is not a same-direction contiguous run: {service_id}"
            )


def _merge_services(
    frozen_services: list[dict[str, str]],
    source_services: dict[str, dict[str, Any]],
    oracle: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    definitions: list[dict[str, Any]] = []
    line_index: dict[str, dict[str, Any]] = {}
    line_order: list[str] = []
    for frozen in frozen_services:
        service_id = frozen["service_id"]
        definition = dict(source_services[service_id]["definition"])
        circular = frozen["circular"] == "true"
        if bool(definition["circular"]) != circular:
            raise StageError(
                f"staged service circular status differs from freeze: {service_id}"
            )
        route_ids = oracle["byService"][service_id]
        first_row = oracle["catalogByService"][service_id][0]
        expected_endpoints = {
            key: "service-boundary"
            if frozen[f"{key}_end_kind"] == "through-split"
            else frozen[f"{key}_end_kind"]
            for key in ("first", "last")
            if frozen[f"{key}_end_kind"]
        }
        actual_endpoints = definition.get("endpoints", {})
        if actual_endpoints != expected_endpoints:
            raise StageError(
                f"staged service endpoints differ from freeze: {service_id}"
            )
        definition["operator"] = first_row["operator"]
        definition["n02Operator"] = first_row["n02_operator"]
        definition["expectedStopCount"] = len(route_ids)
        definitions.append(definition)
        overrides = source_services[service_id]["overrides"]
        lines = read_json(overrides / "services.json")["lines"]
        service_line_ids = set(definition.get("lineIds", []))
        available_line_ids = {line["id"] for line in lines}
        if not service_line_ids <= available_line_ids:
            raise StageError(
                f"service line metadata is missing for {service_id}: "
                f"{sorted(service_line_ids - available_line_ids)}"
            )
        for line in lines:
            if line["id"] not in service_line_ids:
                continue
            previous = line_index.get(line["id"])
            if previous is not None and previous != line:
                raise StageError(f"conflicting line definition: {line['id']}")
            if previous is None:
                line_index[line["id"]] = line
                line_order.append(line["id"])
    if len(definitions) != len(frozen_services):
        raise StageError("merged service definitions do not cover frozen inventory")
    return {
        "services": definitions,
        "lines": [line_index[key] for key in line_order],
    }, {
        "services": oracle["services"],
        # The loader's catalogue check also requires first-appearance station order.
        "stationIds": oracle["stationIds"],
    }


def _build_inputs_report(
    root: Path, preflight_report: dict[str, Any]
) -> dict[str, Any]:
    return {
        "freezeManifestSha256": preflight_report["freezeManifestSha256"],
        "freezeInputs": preflight_report["freezeInputs"],
        "jrStaging": hash_tree(root / PROTECTED_TEXT_ROOTS[0]),
        "nonjrStaging": hash_tree(root / PROTECTED_TEXT_ROOTS[1]),
        "assemblyHelperSha256": sha256_file(Path(__file__)),
        "evidenceHelperSha256": sha256_file(
            Path(__file__).with_name("stage_suburban_assembly_evidence.py")
        ),
        "identityModuleSha256": sha256_file(
            Path(__file__).with_name("stage_suburban_assembly_identity.py")
        ),
        "sharedModuleSha256": sha256_file(
            Path(__file__).with_name("stage_suburban_assembly_shared.py")
        ),
    }


def _write_assembly(
    root: Path,
    destination: Path,
    freeze: dict[str, Any],
    catalog: list[dict[str, str]],
    frozen_services: list[dict[str, str]],
    oracle: dict[str, Any],
    preflight_report: dict[str, Any],
) -> dict[str, Any]:
    _verify_shipped_retention(freeze, oracle)
    sources, registries = _load_source_sets(
        root, [row["service_id"] for row in frozen_services]
    )
    station_rows, station_groups, target_registry = _station_groups(
        oracle, registries, sources
    )
    by_service = oracle["byService"]
    metadata_rows: list[dict[str, str]] = []
    output_overrides = destination / "overrides"
    output_overrides.mkdir(parents=True)
    services_json, expected_catalog = _merge_services(frozen_services, sources, oracle)

    base_dataset = read_json(root / JR_OVERRIDES_PATH / "dataset.json")
    dataset = {
        **base_dataset,
        "operator": "Tokyo suburban rail operators (staging)",
        "n02Operator": "東日本旅客鉄道",
        "areaName": "Tokyo suburban rail (staging)",
        "serviceIds": [row["service_id"] for row in frozen_services],
        "reviewedDisconnectedServiceIds": [],
        "expectedCatalogFile": "expected-catalog.json",
        "validationProfile": "stage",
        "stageStartStationId": "shimbashi",
    }
    expected_bytes = json.dumps(expected_catalog, ensure_ascii=False, indent=2) + "\n"
    dataset["expectedCatalogSha256"] = hashlib.sha256(
        expected_bytes.encode("utf-8")
    ).hexdigest()
    write_json(output_overrides / "dataset.json", dataset)
    write_json(output_overrides / "services.json", services_json)
    write_json(output_overrides / "expected-catalog.json", expected_catalog)
    station_fields = [
        "id",
        "name",
        "n02_name",
        "prefecture",
        "municipality",
        "representative_service_id",
        "n02_selector",
        "aliases",
        "n02_operator",
    ]
    write_csv(output_overrides / "stations.csv", station_fields, station_rows)

    catalog_by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in catalog:
        catalog_by_service[row["service_id"]].append(row)
    for frozen in frozen_services:
        service_id = frozen["service_id"]
        convert_service(
            service_id,
            sources[service_id],
            by_service[service_id],
            target_registry,
            catalog_by_service[service_id],
            output_overrides,
            metadata_rows,
            by_service,
        )
    convert_exceptions(_source_directories(root), output_overrides, by_service)
    from scripts.data_pipeline.stage_suburban_assembly_shared import (
        apply_fukutoshin_composition,
    )

    composition_report = apply_fukutoshin_composition(root, output_overrides)
    write_csv(destination / "identity-map.csv", IDENTITY_FIELDS, oracle["identityRows"])
    write_csv(destination / "service-stop-metadata.csv", METADATA_FIELDS, metadata_rows)
    write_json(destination / "station-groups.json", {"stationGroups": station_groups})
    write_json(
        destination / "ui-line-groups.json",
        freeze["representations"]["uiLineGroups"],
    )
    baseline = read_json(
        root / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
    )
    write_json(destination / "baseline-sha256.json", baseline)
    from scripts.data_pipeline.stage_suburban_assembly_shared import (
        copy_length_references,
    )

    copy_length_references(root, destination)
    inputs_report = _build_inputs_report(root, preflight_report)
    write_json(destination / "inputs-sha256.json", inputs_report)

    actual_catalog = read_json(output_overrides / "expected-catalog.json")
    if actual_catalog != {
        "services": oracle["services"],
        "stationIds": oracle["stationIds"],
    }:
        raise StageError("assembled expected catalog differs from frozen CSV oracle")
    counts = oracle["counts"]
    inventory = {
        "counts": counts,
        "serviceIds": [row["service_id"] for row in frozen_services],
        "stationIds": [row["id"] for row in station_rows],
    }
    write_json(destination / "inventory.json", inventory)
    verification = {
        "status": "verified",
        "oracleSource": {
            CATALOG_PATH: sha256_file(root / CATALOG_PATH),
            SERVICES_PATH: sha256_file(root / SERVICES_PATH),
        },
        "oracle": {"counts": oracle["counts"], "expectedCatalog": oracle["services"]},
        "checks": {
            "frozenServiceOrder": True,
            "frozenStopOrder": True,
            "typedIdentityMapping": True,
            "naturalKeysUnique": True,
            "expectedCatalogMatchesOracle": True,
        },
    }
    write_json(destination / "verification.json", verification)
    report = {
        "status": "assembled",
        "counts": counts,
        "compositions": [composition_report],
        "identity": {
            "originalIds": len({row["station_id_original"] for row in catalog}),
            "proposedIds": len(station_rows),
            "mergedOriginalIds": len({row["station_id_original"] for row in catalog})
            - len(station_rows),
        },
        "inputHashesSha256": hashlib.sha256(
            json.dumps(
                inputs_report, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest(),
        "overrideFiles": len(hash_tree(output_overrides)),
    }
    write_json(destination / "assembly-report.json", report)
    return report


def assemble(*, root: Path = ROOT, out_dir: Path | None = None) -> dict[str, Any]:
    """Build the merged S4 override stage from immutable S2/S3 inputs."""
    preflight_report = preflight(root=root)
    freeze, catalog, frozen_services = _load_frozen_catalog(root)
    oracle = _oracle(freeze, catalog, frozen_services)
    destination = out_dir if out_dir is not None else root / ASSEMBLED_PATH
    if not destination.is_absolute():
        destination = root / destination
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    try:
        report = _write_assembly(
            root,
            temporary,
            freeze,
            catalog,
            frozen_services,
            oracle,
            preflight_report,
        )
        if destination.exists():
            existing_inputs = read_json(destination / "inputs-sha256.json")
            current_inputs = read_json(temporary / "inputs-sha256.json")
            existing_tree = hash_tree(destination)
            existing_tree.pop("shared-track-review.json", None)
            if existing_inputs != current_inputs or existing_tree != hash_tree(
                temporary
            ):
                raise StageError(
                    "assembled output exists with stale or different inputs"
                )
            shutil.rmtree(temporary)
            return {**report, "changed": False}
        temporary.rename(destination)
        return {**report, "changed": True}
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def main(arguments: list[str] | None = None) -> int:
    command_line = arguments if arguments is not None else sys.argv[1:]
    if command_line and command_line[0] in {"gate", "audit", "handoff"}:
        from scripts.data_pipeline import stage_suburban_assembly_gate as gate

        return gate.main(command_line)
    if command_line and command_line[0] == "offsets":
        from scripts.data_pipeline import stage_suburban_assembly_offsets as offsets

        return offsets.main(command_line[1:])
    if command_line and command_line[0] == "review-shared":
        from scripts.data_pipeline import stage_suburban_assembly_shared as shared

        return shared.main(command_line[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight").add_argument("--root", type=Path, default=ROOT)
    commands.add_parser("assemble").add_argument("--root", type=Path, default=ROOT)
    measure_parser = commands.add_parser("measure-pairs")
    measure_parser.add_argument("--batch", required=True)
    measure_parser.add_argument("--root", type=Path, default=ROOT)
    check_parser = commands.add_parser("check-evidence")
    check_parser.add_argument("--batch", required=True)
    check_parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(arguments)
    try:
        if args.command == "preflight":
            result = preflight(root=args.root)
        elif args.command == "assemble":
            result = assemble(root=args.root)
        else:
            from scripts.data_pipeline import (
                stage_suburban_assembly_evidence as evidence,
            )

            if args.command == "measure-pairs":
                result = evidence.measure_pairs(args.batch, root=args.root)
            else:
                result = evidence.check_evidence(args.batch, root=args.root)
    except (OSError, KeyError, StageError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL {error}")
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
