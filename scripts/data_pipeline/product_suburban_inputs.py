"""Read-only validation of frozen S4 sources and historical baselines."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.data_pipeline import config, export
from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline import stage_suburban_assembly_gate as assembly_gate
from scripts.data_pipeline import stage_suburban_assembly_shared as shared
from scripts.data_pipeline import stage_suburban_nonjr as nonjr
from scripts.data_pipeline.stage_suburban_assembly_identity import METADATA_FIELDS
from scripts.data_pipeline.stage_suburban_support import (
    HISTORICAL_BASELINE_ROOT,
    StageError,
    _saved_baseline_hashes,
    hash_tree,
    read_csv,
    read_json,
    resolve_historical_baseline,
    verify_freeze,
)

ROOT = assembly.ROOT
FREEZE_PATH = assembly.FREEZE_PATH
ASSEMBLED_PATH = assembly.ASSEMBLED_PATH
PRODUCT_FILES = (
    config.MANIFEST_FILE,
    config.SEGMENTS_GEOJSON_FILE,
    config.SEGMENTS_FILE,
    config.SERVICES_FILE,
    config.STATIONS_FILE,
)
PAYLOAD_FILES = export.GAME_DATA_FILES
AIRPORT_ACCESS_SERVICE = "keisei-narita-airport-access"
AIRPORT_ACCESS_REFERENCE = {
    "from": "印旛日本医大",
    "to": "成田空港",
    "km": "19.1",
}
AIRPORT_ACCESS_COMPONENTS = {
    ("+", "51.4", "京成高砂", "成田空港"),
    ("-", "32.3", "京成高砂", "印旛日本医大"),
}


def _raise_mismatch(label: str) -> None:
    raise StageError(f"{label} differs from the frozen/source-derived expectation")


def _check_json_sidecar(path: Path, expected: Any, label: str) -> None:
    try:
        actual = read_json(path)
    except (OSError, json.JSONDecodeError) as error:
        raise StageError(f"{label} is missing or unreadable: {path}") from error
    if actual != expected:
        _raise_mismatch(label)


def _check_csv_sidecar(
    path: Path,
    expected_fields: list[str],
    expected_rows: list[dict[str, str]],
    label: str,
) -> None:
    try:
        fields, rows = read_csv(path)
    except OSError as error:
        raise StageError(f"{label} is missing or unreadable: {path}") from error
    if fields != expected_fields or rows != expected_rows:
        _raise_mismatch(label)


def expected_identity_rows(*, root: Path = ROOT) -> list[dict[str, str]]:
    """Return the frozen catalog's ordered original-to-product identity rows."""
    freeze, catalog, services = assembly._load_frozen_catalog(root)
    return assembly._oracle(freeze, catalog, services)["identityRows"]


def check_identity_sidecar(path: Path, expected: list[dict[str, str]]) -> None:
    _check_csv_sidecar(path, assembly.IDENTITY_FIELDS, expected, "identity-map")


def expected_metadata_rows(*, root: Path = ROOT) -> list[dict[str, str]]:
    """Reconstruct merged stop metadata from frozen rows and source stops."""
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    sources, _ = assembly._load_source_sets(
        root, [row["service_id"] for row in frozen_services]
    )
    rows: list[dict[str, str]] = []
    for service in frozen_services:
        service_id = service["service_id"]
        frozen_rows = oracle["catalogByService"][service_id]
        source_path = sources[service_id]["overrides"] / "services" / service_id
        fields, source_stops = read_csv(source_path / "stops.csv")
        if "order" not in fields or "station_id" not in fields:
            raise StageError(f"source stop schema is incomplete: {service_id}")
        if len(source_stops) != len(frozen_rows):
            raise StageError(
                f"source stop rows differ from frozen identity: {service_id}"
            )
        for order, (stop, frozen) in enumerate(
            zip(source_stops, frozen_rows, strict=True)
        ):
            if (
                stop.get("order") != str(order)
                or stop.get("station_id") != frozen["station_id_original"]
            ):
                raise StageError(
                    f"source stop identity/order differs from frozen catalog: {service_id}/{order}"
                )
            rows.append(
                {
                    "service_id": service_id,
                    "order": str(order),
                    "station_id_original": frozen["station_id_original"],
                    "station_id_proposed": frozen["station_id_proposed"],
                    "station_name_original": frozen["station_name_original"],
                    "prefecture": frozen["prefecture"],
                    "municipality": frozen["municipality"],
                    "n02_name": stop.get("n02_name", "")
                    or frozen["station_name_original"],
                    "n02_operator": stop.get("n02_operator", "")
                    or frozen["n02_operator"],
                    "platform_selector": stop.get("platform_selector", ""),
                    "source_url": frozen["source_url"],
                }
            )
    return rows


def check_metadata_sidecar(path: Path, expected: list[dict[str, str]]) -> None:
    _check_csv_sidecar(path, METADATA_FIELDS, expected, "service-stop-metadata")


def expected_ui_groups(*, root: Path = ROOT) -> list[dict[str, Any]]:
    freeze = read_json(root / FREEZE_PATH)
    return freeze["representations"]["uiLineGroups"]


def check_ui_groups_sidecar(path: Path, expected: list[dict[str, Any]]) -> None:
    _check_json_sidecar(path, expected, "ui-line-groups")


def expected_shared_track_review(*, root: Path = ROOT) -> dict[str, Any]:
    """Recompute every reviewed candidate from the assembled route definitions."""
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    pairs = shared._pair_evidence(root / ASSEMBLED_PATH / "overrides")
    if len(pairs) != oracle["counts"]["serviceRoutePairRows"]:
        raise StageError("shared-track pair evidence differs from frozen route count")
    candidates = shared.build_review_entries(pairs)
    classifications: dict[str, int] = defaultdict(int)
    decisions: dict[str, int] = defaultdict(int)
    reasons: dict[str, int] = defaultdict(int)
    for candidate in candidates:
        classifications[candidate["classification"]] += 1
        decisions[candidate["decision"]] += 1
        reasons[candidate["reason"]] += 1
    open_candidates = [
        candidate["candidateId"]
        for candidate in candidates
        if candidate["decision"] in {"needs-lead-review", "compose-candidate"}
    ]
    return {
        "schemaVersion": 1,
        "status": "reviewed" if not open_candidates else "review-required",
        "expectedCounts": oracle["counts"],
        "candidateCounts": {
            name: classifications.get(name, 0)
            for name in (
                "same-station-pair",
                "shared-source-sections",
                "boundary-connection",
                "parallel",
            )
        },
        "decisionCounts": dict(sorted(decisions.items())),
        "reasonCounts": dict(sorted(reasons.items())),
        "openCandidates": open_candidates,
        "candidates": candidates,
    }


def check_shared_track_sidecar(path: Path, expected: dict[str, Any]) -> None:
    _check_json_sidecar(path, expected, "shared-track-review")


def check_composition_report(path: Path, review: dict[str, Any]) -> None:
    """Match the approved composition inventory to recomputed review decisions."""
    composed = [
        candidate
        for candidate in review["candidates"]
        if candidate["decision"] == "composed"
    ]
    if len(composed) != 5:
        raise StageError(
            f"shared-track review has {len(composed)} approved compositions, expected 5"
        )
    expected_services = ["metro-fukutoshin", "metro-yurakucho"]
    if any(candidate.get("services") != expected_services for candidate in composed):
        raise StageError(
            "shared-track composition owners differ from the reviewed pair"
        )
    consumer_pairs = {
        (pair["from"], pair["to"])
        for candidate in composed
        for pair in candidate["pairs"]
        if pair["serviceId"] == "metro-fukutoshin"
    }
    if len(consumer_pairs) != 5:
        raise StageError("reviewed Fukutoshin composition pair inventory is incomplete")
    actual = read_json(path)
    compositions = actual.get("compositions")
    if not isinstance(compositions, list) or len(compositions) != 1:
        raise StageError("assembly composition report is missing or has extra records")
    composition = compositions[0]
    actual_pairs = {
        (pair.get("from"), pair.get("to")) for pair in composition.get("pairs", [])
    }
    if (
        composition.get("consumerServiceId") != "metro-fukutoshin"
        or composition.get("ownerServiceId") != "metro-yurakucho"
        or actual_pairs != consumer_pairs
        or len(composition.get("pairs", [])) != 5
    ):
        raise StageError(
            "assembly composition differs from recomputed shared-track review"
        )
    anchors = composition.get("anchorChecks")
    if not isinstance(anchors, list) or [
        row.get("stationId") for row in anchors
    ] != list(shared.FUKUTOSHIN_SHARED_STOPS):
        raise StageError(
            "assembly composition anchor identities differ from reviewed stops"
        )
    required_anchor_fields = {
        "stationId",
        "consumerCode",
        "ownerCode",
        "groupCode",
        "metricCoordinate",
    }
    for anchor in anchors:
        coordinate = anchor.get("metricCoordinate")
        if (
            set(anchor) != required_anchor_fields
            or not all(
                anchor.get(field)
                for field in ("consumerCode", "ownerCode", "groupCode")
            )
            or not isinstance(coordinate, list)
            or len(coordinate) != 2
            or not all(
                isinstance(value, int | float) and math.isfinite(value)
                for value in coordinate
            )
        ):
            raise StageError("assembly composition anchor evidence is malformed")


def _source_length_files(
    root: Path,
) -> tuple[list[str], list[dict[str, str]], list[str], list[dict[str, str]]]:
    source_roots = [root / "data/staging/tokyo-suburban-jr/combined"]
    nonjr_root = root / "data/staging/tokyo-suburban-nonjr"
    source_roots.extend(path for path in sorted(nonjr_root.iterdir()) if path.is_dir())
    ref_fields: list[str] | None = None
    component_fields: list[str] | None = None
    refs: list[dict[str, str]] = []
    components: list[dict[str, str]] = []
    service_ids: set[str] = set()
    for source_root in source_roots:
        refs_path = source_root / "length-refs.csv"
        component_path = source_root / "length-ref-components.csv"
        if not refs_path.is_file():
            if any(
                (candidate / "length-refs.csv").is_file() for candidate in source_roots
            ):
                raise StageError(f"staged length reference is missing: {refs_path}")
            continue
        current_fields, current_rows = read_csv(refs_path)
        if ref_fields is None:
            ref_fields = current_fields
        elif current_fields != ref_fields:
            raise StageError(f"staged length reference schema differs: {refs_path}")
        for row in current_rows:
            service_id = row.get("service_id", "")
            if not service_id or service_id in service_ids:
                raise StageError(
                    f"duplicate or empty staged length reference: {service_id}"
                )
            service_ids.add(service_id)
            refs.append(row)
        if not component_path.is_file():
            if source_root.name != "combined":
                raise StageError(
                    f"staged length components are missing: {component_path}"
                )
            continue
        current_fields, current_rows = read_csv(component_path)
        if component_fields is None:
            component_fields = current_fields
        elif current_fields != component_fields:
            raise StageError(
                f"staged length component schema differs: {component_path}"
            )
        components.extend(current_rows)
    if ref_fields is None or component_fields is None:
        raise StageError("staged S2/S3 mileage references are incomplete")
    return (
        ref_fields,
        refs,
        component_fields,
        shared._normalize_length_component_rows(components),
    )


def validate_mileage_arithmetic(
    references: list[dict[str, str]], components: list[dict[str, str]]
) -> None:
    """Check signed source arithmetic, endpoint identity and the airport subtraction."""
    refs: dict[str, dict[str, str]] = {}
    for row in references:
        service_id = row.get("service_id", "")
        if not service_id or service_id in refs:
            raise StageError(f"mileage reference is duplicated or empty: {service_id}")
        refs[service_id] = row

    by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in components:
        service_id = row.get("service_id", "")
        if service_id not in refs:
            raise StageError(
                f"mileage component has no service reference: {service_id}"
            )
        if not all(row.get(key, "").strip() for key in row):
            raise StageError(f"mileage component has an incomplete row: {service_id}")
        if row.get("operation") not in {"+", "-"}:
            raise StageError(
                f"mileage component has an invalid operation: {service_id}"
            )
        if row.get("source_class") not in {"primary", "secondary"}:
            raise StageError(
                f"mileage component has an invalid source class: {service_id}"
            )
        try:
            distance = float(row["km"])
        except ValueError as error:
            raise StageError(
                f"mileage component is not numeric: {service_id}"
            ) from error
        if not math.isfinite(distance) or distance <= 0:
            raise StageError(f"mileage component must be positive: {service_id}")
        if not row["source_url"].startswith("https://"):
            raise StageError(f"mileage component source is not HTTPS: {service_id}")
        by_service[service_id].append(row)

    for service_id, reference in refs.items():
        rows = by_service.get(service_id, [])
        if not rows:
            continue
        try:
            official_km = float(reference["km"])
            signed_km = sum(
                (1 if row["operation"] == "+" else -1) * float(row["km"])
                for row in rows
            )
        except (KeyError, ValueError) as error:
            raise StageError(f"mileage breakdown is malformed: {service_id}") from error
        if not math.isfinite(official_km) or round(signed_km, 3) != round(
            official_km, 3
        ):
            raise StageError(
                f"mileage breakdown totals {signed_km:.3f} km, not "
                f"{official_km:.3f} km: {service_id}"
            )
        if service_id != AIRPORT_ACCESS_SERVICE and (
            rows[0]["from"] != reference["from"] or rows[-1]["to"] != reference["to"]
        ):
            raise StageError(f"mileage breakdown endpoints differ: {service_id}")
        if not any(row["source_url"] == reference.get("source_url") for row in rows):
            raise StageError(
                f"mileage breakdown does not cite its reference: {service_id}"
            )

    airport_reference = refs.get(AIRPORT_ACCESS_SERVICE)
    airport_rows = by_service.get(AIRPORT_ACCESS_SERVICE, [])
    if airport_reference is None or {
        airport_reference.get(key) for key in ("from", "to", "km")
    } != set(AIRPORT_ACCESS_REFERENCE.values()):
        raise StageError(
            "airport mileage reference differs from frozen endpoint identity"
        )
    airport_components = {
        (row["operation"], row["km"], row["from"], row["to"]) for row in airport_rows
    }
    if airport_components != AIRPORT_ACCESS_COMPONENTS:
        raise StageError("airport mileage component endpoints or subtraction differ")


def _verify_mileage_sources(root: Path, assembled: Path) -> None:
    ref_fields, refs, component_fields, components = _source_length_files(root)
    _check_csv_sidecar(assembled / "length-refs.csv", ref_fields, refs, "length-refs")
    _check_csv_sidecar(
        assembled / "length-ref-components.csv",
        component_fields,
        components,
        "length-ref-components",
    )
    validate_mileage_arithmetic(refs, components)
    # The source groups perform their own complete service coverage and arithmetic checks.
    for group in nonjr.GROUPS:
        group_root = root / "data/staging/tokyo-suburban-nonjr" / group
        inventory = read_json(group_root / "inventory.json")
        nonjr._parse_length_refs(group_root, inventory["serviceIds"])


def expected_station_groups(
    *, root: Path = ROOT
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    sources, registries = assembly._load_source_sets(
        root, [row["service_id"] for row in frozen_services]
    )
    stations, groups, _ = assembly._station_groups(oracle, registries, sources)
    return stations, groups


def _verify_sidecars(root: Path) -> dict[str, int]:
    assembled = root / ASSEMBLED_PATH
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    check_identity_sidecar(assembled / "identity-map.csv", oracle["identityRows"])
    metadata = expected_metadata_rows(root=root)
    check_metadata_sidecar(assembled / "service-stop-metadata.csv", metadata)
    check_ui_groups_sidecar(
        assembled / "ui-line-groups.json", expected_ui_groups(root=root)
    )
    expected_review = expected_shared_track_review(root=root)
    check_shared_track_sidecar(assembled / "shared-track-review.json", expected_review)
    check_composition_report(assembled / "assembly-report.json", expected_review)
    station_rows, groups = expected_station_groups(root=root)
    _check_json_sidecar(
        assembled / "station-groups.json", {"stationGroups": groups}, "station-groups"
    )
    _check_csv_sidecar(
        assembled / "overrides/stations.csv",
        [
            "id",
            "name",
            "n02_name",
            "prefecture",
            "municipality",
            "representative_service_id",
            "n02_selector",
            "aliases",
            "n02_operator",
        ],
        station_rows,
        "assembled station registry",
    )
    _check_json_sidecar(
        assembled / "baseline-sha256.json",
        read_json(
            root / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
        ),
        "S4 baseline snapshot",
    )
    _verify_mileage_sources(root, assembled)
    return {
        "identityRows": len(oracle["identityRows"]),
        "metadataRows": len(metadata),
        "stationGroups": len(groups),
        "sharedTrackCandidates": len(
            read_json(assembled / "shared-track-review.json")["candidates"]
        ),
        "mileageReferences": len(read_csv(assembled / "length-refs.csv")[1]),
        "mileageComponents": len(read_csv(assembled / "length-ref-components.csv")[1]),
    }


def _check_s4_payload_hashes(root: Path) -> dict[str, str]:
    verification = read_json(root / ASSEMBLED_PATH / "verification.json")
    saved = verification.get("gate", {}).get("buildHashes", {})
    if set(saved) != {"a", "b"} or saved["a"] != saved["b"]:
        raise StageError("accepted S4 A/B five-file hashes are missing or differ")
    expected = saved["a"]
    if set(expected) != set(PRODUCT_FILES):
        raise StageError("accepted S4 five-file hash inventory is incomplete")
    for label in ("a", "b"):
        path = root / ".claude/logs/s4/gate" / label
        if hash_tree(path) != expected:
            raise StageError(f"accepted S4 build {label} hashes changed")
    for name in PAYLOAD_FILES:
        if not expected.get(name):
            raise StageError(f"accepted S4 payload hash is missing: {name}")
    return expected


def verify_inputs(*, root: Path = ROOT) -> dict[str, Any]:
    """Verify frozen sources, accepted S4 evidence, sidecars, and raw N02 hashes."""
    verify_freeze(root / FREEZE_PATH, root)
    current = assembly_gate._require_current_assembly(root)
    nonjr._check_raw_checksums(root)
    hashes = _check_s4_payload_hashes(root)
    sidecars = _verify_sidecars(root)
    evidence_results = assembly_gate._check_all_evidence(root)
    if len(evidence_results) != len(assembly_gate.BATCHES):
        raise StageError("not all frozen S4 evidence batches were verified")
    return {
        "status": "verified",
        "counts": current["oracle"]["counts"],
        "evidenceBatches": len(evidence_results),
        "evidencePairs": sum(result["pairs"] for result in evidence_results),
        "s4PayloadHashes": {name: hashes[name] for name in PAYLOAD_FILES},
        "sidecars": sidecars,
    }


def verify_history(*, root: Path = ROOT) -> dict[str, Any]:
    """Verify both archived historical trees and the active resolver selection."""
    result: dict[str, Any] = {"status": "verified", "trees": {}}
    archive = root / HISTORICAL_BASELINE_ROOT
    for relative in ("public/data", "data/overrides"):
        expected = _saved_baseline_hashes(root, relative)
        if expected is None:
            raise StageError(f"saved historical baseline is missing: {relative}")
        archived = archive / relative
        if not archived.is_dir() or hash_tree(archived) != expected:
            raise StageError(f"historical archive hashes differ: {relative}")
        selected = resolve_historical_baseline(root, relative)
        selected_hashes = hash_tree(selected)
        if selected_hashes != expected:
            raise StageError(f"resolved historical baseline hashes differ: {relative}")
        result["trees"][relative] = {
            "source": "archive"
            if selected.is_relative_to(archive.resolve())
            else "live",
            "files": len(selected_hashes),
            "sha256": selected_hashes,
        }
    return result
