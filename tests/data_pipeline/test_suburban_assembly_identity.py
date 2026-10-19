"""Identity conversion and assembly checks for frozen S2/S3 staging."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_support import StageError, hash_tree
from tests.data_pipeline._local_inputs import requires_raw_n02


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _catalog_row(
    service_id: str,
    order: int,
    original: str,
    proposed: str,
    canonical: str,
    original_name: str,
    operator: str,
    municipality: str,
) -> dict[str, str]:
    return {
        "service_id": service_id,
        "order": str(order),
        "station_name_ja": canonical,
        "station_name_en_romaji": f"{canonical} English",
        "prefecture": "東京都",
        "municipality": municipality,
        "operator": operator,
        "line_official": "Test line",
        "service_name_ja": service_id,
        "service_kind": "local",
        "is_loop": "false",
        "endpoint_kind": "terminus",
        "station_id_proposed": proposed,
        "station_code": "",
        "n02_operator": operator,
        "n02_line": "Test N02 line",
        "source_url": f"https://example.test/{service_id}/{order}",
        "notes": "",
        "station_id_original": original,
        "station_name_original": original_name,
        "service_type": "local",
    }


def _service_row(service_id: str, stops: list[str]) -> dict[str, str]:
    return {
        "service_id": service_id,
        "line_name": service_id,
        "service_type": "local",
        "circular": "false",
        "stop_ids": "|".join(stops),
        "first_end_kind": "terminus",
        "last_end_kind": "terminus",
    }


def _registry_row(
    station_id: str, name: str, service_id: str, municipality: str
) -> dict[str, str]:
    return {
        "id": station_id,
        "name": name,
        "n02_name": name,
        "prefecture": "東京都",
        "municipality": municipality,
        "representative_service_id": service_id,
        "n02_selector": "",
    }


def _definition(service_id: str, line_id: str, name: str) -> dict[str, Any]:
    return {
        "id": service_id,
        "name": name,
        "kind": "local",
        "lineIds": [line_id],
        "color": "#123456",
        "circular": False,
        "directionLabels": {"forward": "Forward", "backward": "Backward"},
        "expectedStopCount": 2,
        "lengthRef": {"km": 1.0, "toleranceKm": 1.0, "source": "fixture"},
        "scopeSource": "fixture",
        "endpoints": {"first": "terminus", "last": "terminus"},
    }


def _install_service(
    overrides: Path,
    service_id: str,
    line_id: str,
    name: str,
    stops: list[str],
    registry_rows: list[dict[str, str]],
    compose: str = "",
    extra_scope: bool = False,
) -> None:
    _write_json(
        overrides / "dataset.json",
        {
            "serviceIds": [service_id],
            "operator": "Fixture operator",
            "n02Operator": "Fixture operator",
            "updatedAt": "2026-10-17",
            "areaName": "Fixture",
            "reviewedDisconnectedServiceIds": [],
            "areaPrefectures": ["東京都"],
            "outputBbox": [139.0, 35.0, 140.0, 36.0],
            "candidateSearchBbox": [138.9, 34.9, 140.1, 36.1],
            "budgetProfile": "capital-region",
            "simplifyToleranceM": 1,
        },
    )
    _write_json(
        overrides / "services.json",
        {
            "lines": [{"id": line_id, "name": name, "color": "#123456"}],
            "services": [_definition(service_id, line_id, name)],
        },
    )
    registry_fields = [
        "id",
        "name",
        "n02_name",
        "prefecture",
        "municipality",
        "representative_service_id",
        "n02_selector",
    ]
    _write_csv(overrides / "stations.csv", registry_fields, registry_rows)
    service_dir = overrides / "services" / service_id
    stop_fields = ["order", "station_id", "station_number", "platform_selector"]
    stop_rows = [
        {
            "order": str(index),
            "station_id": station_id,
            "station_number": f"T{index + 1:02d}",
            "platform_selector": f"selector-{station_id}",
        }
        for index, station_id in enumerate(stops)
    ]
    _write_csv(service_dir / "stops.csv", stop_fields, stop_rows)
    scope_fields = ["station_id", "prefecture", "municipality", "in_area"]
    scope_rows = [
        {
            "station_id": station_id,
            "prefecture": "東京都",
            "municipality": "Source municipality",
            "in_area": "true",
        }
        for station_id in stops
    ]
    if extra_scope:
        scope_rows.append(
            {
                "station_id": "outside-neighbour",
                "prefecture": "山梨県",
                "municipality": "Boundary town",
                "in_area": "false",
            }
        )
    _write_csv(service_dir / "scope.csv", scope_fields, scope_rows)
    line_fields = ["from_id", "to_id", "n02_line", "via", "route", "compose"]
    _write_csv(
        service_dir / "line_mapping.csv",
        line_fields,
        [
            {
                "from_id": stops[0],
                "to_id": stops[1],
                "n02_line": "" if compose else "Test N02 line",
                "via": "",
                "route": "",
                "compose": compose,
            }
        ],
    )
    _write_csv(
        service_dir / "sections.csv",
        ["n02_line", "action", "section_key", "reason", "from_id", "to_id"],
        [
            {
                "n02_line": "Test N02 line",
                "action": "include",
                "section_key": f"section-{service_id}",
                "reason": "fixture",
                "from_id": stops[0],
                "to_id": stops[1],
            }
        ],
    )


def _fixture_root(tmp_path: Path) -> Path:
    root = tmp_path
    catalog_fields = [
        "service_id",
        "order",
        "station_name_ja",
        "station_name_en_romaji",
        "prefecture",
        "municipality",
        "operator",
        "line_official",
        "service_name_ja",
        "service_kind",
        "is_loop",
        "endpoint_kind",
        "station_id_proposed",
        "station_code",
        "n02_operator",
        "n02_line",
        "source_url",
        "notes",
        "station_id_original",
        "station_name_original",
        "service_type",
    ]
    catalog_rows = [
        _catalog_row(
            "service-a",
            0,
            "station-x",
            "station-x",
            "Alpha",
            "Alpha",
            "Operator A",
            "Rep town",
        ),
        _catalog_row(
            "service-a",
            1,
            "station-y",
            "station-y",
            "Beta",
            "Beta",
            "Operator A",
            "Beta town",
        ),
        _catalog_row(
            "service-b",
            0,
            "station-new",
            "station-x",
            "Alpha",
            "Old Alpha",
            "Operator B",
            "Alias town",
        ),
        _catalog_row(
            "service-b",
            1,
            "station-z",
            "station-z",
            "Gamma",
            "Gamma",
            "Operator B",
            "Gamma town",
        ),
    ]
    service_fields = [
        "service_id",
        "line_name",
        "service_type",
        "circular",
        "stop_ids",
        "first_end_kind",
        "last_end_kind",
    ]
    service_rows = [
        _service_row("service-a", ["station-x", "station-y"]),
        _service_row("service-b", ["station-x", "station-z"]),
    ]
    _write_csv(root / assembly.CATALOG_PATH, catalog_fields, catalog_rows)
    _write_csv(root / assembly.SERVICES_PATH, service_fields, service_rows)
    freeze_inputs = {
        name: hashlib.sha256((root / name).read_bytes()).hexdigest()
        for name in (assembly.CATALOG_PATH, assembly.SERVICES_PATH)
    }
    freeze = {
        "inputs": freeze_inputs,
        "counts": {
            "services": 2,
            "stationGroups": 3,
            "serviceStopRows": 4,
            # Open chains remain bidirectional, including the target service.
            "directedSegments": 4,
        },
        "ruleset": {"targetServiceId": "service-a"},
        "representations": {
            "uiLineGroups": [
                {
                    "id": "fixture-group",
                    "displayName": "Fixture",
                    "serviceIds": ["service-a"],
                }
            ]
        },
        "shipped": {
            "serviceCount": 0,
            "serviceIds": [],
            "serviceStopSequences": {},
            "stationCount": 0,
            "stationIds": [],
        },
    }
    _write_json(root / assembly.FREEZE_PATH, freeze)

    jr_overrides = root / assembly.JR_OVERRIDES_PATH
    _install_service(
        jr_overrides,
        "service-a",
        "line-a",
        "Line A",
        ["station-x", "station-y"],
        [
            _registry_row("station-x", "Alpha", "service-a", "Rep town"),
            _registry_row("station-y", "Beta", "service-a", "Beta town"),
        ],
        compose=json.dumps(
            {
                "legs": [
                    {
                        "source_service": "service-b",
                        "from": "station-new",
                        "to": "station-z",
                    }
                ]
            }
        ),
    )
    _write_json(
        root / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json",
        {"manifest.json": "fixture"},
    )
    nonjr_overrides = (
        root
        / assembly.NONJR_STAGE_PATH
        / "fixture-group"
        / "components"
        / "service-b"
        / "overrides"
    )
    _install_service(
        nonjr_overrides,
        "service-b",
        "line-b",
        "Line B",
        ["station-new", "station-z"],
        [
            _registry_row("station-new", "Old Alpha", "service-b", "Alias town"),
            _registry_row("station-z", "Gamma", "service-b", "Gamma town"),
        ],
        extra_scope=True,
    )
    _write_csv(
        nonjr_overrides / "offset_exceptions.csv",
        ["service_id", "station_id", "max_platform_offset_m", "reason"],
        [
            {
                "service_id": "service-b",
                "station_id": "station-new",
                "max_platform_offset_m": "90",
                "reason": "fixture",
            }
        ],
    )
    _write_csv(
        nonjr_overrides / "detour_exceptions.csv",
        ["service_id", "from_id", "to_id", "max_detour_ratio", "reason"],
        [
            {
                "service_id": "service-b",
                "from_id": "station-new",
                "to_id": "station-z",
                "max_detour_ratio": "3",
                "reason": "fixture",
            }
        ],
    )
    _write_csv(
        jr_overrides / "platform_transfers.csv",
        ["service_id", "station_id", "max_transfer_m", "reason"],
        [
            {
                "service_id": "service-a",
                "station_id": "station-x",
                "max_transfer_m": "90",
                "reason": "fixture",
            }
        ],
    )
    return root


def _mock_preflight(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    freeze = json.loads((root / assembly.FREEZE_PATH).read_text(encoding="utf-8"))
    report = {
        "freezeManifestSha256": hashlib.sha256(
            (root / assembly.FREEZE_PATH).read_bytes()
        ).hexdigest(),
        "freezeInputs": freeze["inputs"],
    }
    monkeypatch.setattr(assembly, "preflight", lambda *, root: report)


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), list(reader)


def _refresh_catalog_hash(root: Path) -> None:
    freeze_path = root / assembly.FREEZE_PATH
    freeze = json.loads(freeze_path.read_text(encoding="utf-8"))
    freeze["inputs"][assembly.CATALOG_PATH] = hashlib.sha256(
        (root / assembly.CATALOG_PATH).read_bytes()
    ).hexdigest()
    _write_json(freeze_path, freeze)


def test_assemble_converts_identity_and_is_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    _mock_preflight(monkeypatch, root)
    output = root / "assembled"

    result = assembly.assemble(root=root, out_dir=output)

    assert result["changed"] is True
    expected_catalog = json.loads(
        (output / "overrides/expected-catalog.json").read_text(encoding="utf-8")
    )
    assert expected_catalog["stationIds"] == [
        "station-x",
        "station-y",
        "station-z",
    ]
    assert result["identity"] == {
        "originalIds": 4,
        "proposedIds": 3,
        "mergedOriginalIds": 1,
    }
    fields, identity = _read_csv(output / "identity-map.csv")
    assert fields == [
        "service_id",
        "order",
        "station_id_original",
        "station_id_proposed",
    ]
    assert len(identity) == 4
    assert any(
        row["station_id_original"] == "station-new"
        and row["station_id_proposed"] == "station-x"
        for row in identity
    )

    _, stations = _read_csv(output / "overrides/stations.csv")
    alpha = next(row for row in stations if row["id"] == "station-x")
    assert alpha["name"] == "Alpha"
    assert json.loads(alpha["aliases"]) == ["Old Alpha"]
    _, metadata = _read_csv(output / "service-stop-metadata.csv")
    assert len(metadata) == 4
    old_alpha = next(
        row
        for row in metadata
        if row["service_id"] == "service-b"
        and row["station_id_original"] == "station-new"
    )
    assert old_alpha["station_id_proposed"] == "station-x"
    assert old_alpha["municipality"] == "Alias town"
    assert old_alpha["platform_selector"] == "selector-station-new"
    groups = json.loads((output / "station-groups.json").read_text(encoding="utf-8"))
    alpha_group = next(
        row for row in groups["stationGroups"] if row["id"] == "station-x"
    )
    assert alpha_group["stationNameEnRomaji"] == "Alpha English"
    assert alpha_group["representativeServiceId"] == "service-a"
    assert alpha_group["aliases"] == ["Old Alpha"]

    _, stops = _read_csv(output / "overrides/services/service-b/stops.csv")
    assert [row["station_id"] for row in stops] == ["station-x", "station-z"]
    assert stops[0]["platform_selector"] == "selector-station-new"
    _, scope = _read_csv(output / "overrides/services/service-b/scope.csv")
    assert scope[0]["station_id"] == "station-x"
    assert scope[0]["municipality"] == "Rep town"
    assert scope[-1] == {
        "station_id": "outside-neighbour",
        "prefecture": "山梨県",
        "municipality": "Boundary town",
        "in_area": "false",
    }
    _, line_mapping = _read_csv(
        output / "overrides/services/service-a/line_mapping.csv"
    )
    compose = json.loads(line_mapping[0]["compose"])
    assert compose["legs"][0]["from"] == "station-x"
    assert compose["legs"][0]["to"] == "station-z"
    _, sections = _read_csv(output / "overrides/services/service-b/sections.csv")
    assert sections[0]["from_id"] == "station-x"
    _, offsets = _read_csv(output / "overrides/offset_exceptions.csv")
    assert offsets[0]["station_id"] == "station-x"
    _, detours = _read_csv(output / "overrides/detour_exceptions.csv")
    assert (detours[0]["from_id"], detours[0]["to_id"]) == (
        "station-x",
        "station-z",
    )
    _, transfers = _read_csv(output / "overrides/platform_transfers.csv")
    assert transfers[0]["station_id"] == "station-x"
    assert json.loads((output / "ui-line-groups.json").read_text(encoding="utf-8")) == [
        {"id": "fixture-group", "displayName": "Fixture", "serviceIds": ["service-a"]}
    ]
    inputs = json.loads((output / "inputs-sha256.json").read_text(encoding="utf-8"))
    assert inputs["freezeInputs"]
    assert inputs["jrStaging"] and inputs["nonjrStaging"]
    assert inputs["assemblyHelperSha256"] and inputs["identityModuleSha256"]
    verification = json.loads(
        (output / "verification.json").read_text(encoding="utf-8")
    )
    assert verification["status"] == "verified"
    assert verification["checks"]["expectedCatalogMatchesOracle"] is True

    before = hash_tree(output)
    repeated = assembly.assemble(root=root, out_dir=output)
    assert repeated["changed"] is False
    assert hash_tree(output) == before


def test_oracle_derives_first_appearance_station_ids_from_frozen_csvs(
    tmp_path: Path,
) -> None:
    root = _fixture_root(tmp_path)
    freeze, catalog, services = assembly._load_frozen_catalog(root)

    oracle = assembly._oracle(freeze, catalog, services)

    assert oracle["stationIds"] == ["station-x", "station-y", "station-z"]


def test_assemble_rejects_unknown_stop_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    stops = (
        root
        / assembly.NONJR_STAGE_PATH
        / "fixture-group/components/service-b/overrides/services/service-b/stops.csv"
    )
    _, rows = _read_csv(stops)
    rows[0]["station_id"] = "unknown-station"
    _write_csv(stops, list(rows[0]), rows)
    _mock_preflight(monkeypatch, root)

    with pytest.raises(StageError, match="unknown station ID.*unknown-station"):
        assembly.assemble(root=root, out_dir=root / "assembled")


def test_assemble_rejects_multi_target_original_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    catalog_path = root / assembly.CATALOG_PATH
    fields, rows = _read_csv(catalog_path)
    rows[2]["station_id_original"] = "station-x"
    rows[2]["station_id_proposed"] = "station-z"
    _write_csv(catalog_path, fields, rows)
    _refresh_catalog_hash(root)
    _mock_preflight(monkeypatch, root)

    with pytest.raises(StageError, match="one original ID to multiple targets"):
        assembly.assemble(root=root, out_dir=root / "assembled")


def test_assemble_rejects_distinct_jr_id_merge(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    catalog_path = root / assembly.CATALOG_PATH
    fields, rows = _read_csv(catalog_path)
    for row in rows:
        if row["station_id_proposed"] == "station-x":
            row["operator"] = "東日本旅客鉄道"
    _write_csv(catalog_path, fields, rows)
    _refresh_catalog_hash(root)
    _mock_preflight(monkeypatch, root)

    with pytest.raises(StageError, match="distinct JR station IDs merge"):
        assembly.assemble(root=root, out_dir=root / "assembled")


def test_assemble_rejects_same_service_target_duplicate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    catalog_path = root / assembly.CATALOG_PATH
    fields, rows = _read_csv(catalog_path)
    rows[1]["station_id_proposed"] = "station-x"
    rows[1]["station_name_ja"] = "Alpha"
    _write_csv(catalog_path, fields, rows)
    _refresh_catalog_hash(root)
    _mock_preflight(monkeypatch, root)

    with pytest.raises(StageError, match="duplicate target station IDs: service-a"):
        assembly.assemble(root=root, out_dir=root / "assembled")


def test_assemble_rejects_natural_key_collision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    line_mapping = (
        root / assembly.JR_OVERRIDES_PATH / "services/service-a/line_mapping.csv"
    )
    fields, rows = _read_csv(line_mapping)
    _write_csv(line_mapping, fields, rows + rows)
    _mock_preflight(monkeypatch, root)

    with pytest.raises(StageError, match="natural-key collision.*line_mapping.csv"):
        assembly.assemble(root=root, out_dir=root / "assembled")


def test_assemble_cli_writes_to_requested_output_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _fixture_root(tmp_path)
    _mock_preflight(monkeypatch, root)
    output = root / assembly.ASSEMBLED_PATH

    exit_code = assembly.main(["assemble", "--root", str(root)])

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out)["changed"] is True
    assert (output / "overrides/expected-catalog.json").is_file()


@requires_raw_n02()
def test_real_frozen_catalog_retains_shipped_472_stations_and_40_services(
    tmp_path: Path,
) -> None:
    root = assembly.ROOT
    output = tmp_path / "assembled"

    result = assembly.assemble(root=root, out_dir=output)

    freeze = json.loads((root / assembly.FREEZE_PATH).read_text(encoding="utf-8"))
    shipped = freeze["shipped"]
    _, stations = _read_csv(output / "overrides/stations.csv")
    station_ids = {row["id"] for row in stations}
    assert len(shipped["stationIds"]) == 472
    assert set(shipped["stationIds"]) <= station_ids
    services = json.loads(
        (output / "overrides/services.json").read_text(encoding="utf-8")
    )
    service_ids = {row["id"] for row in services["services"]}
    assert len(shipped["serviceIds"]) == 40
    assert set(shipped["serviceIds"]) <= service_ids
    assert result["counts"]["services"] == 135
    assert result["counts"]["serviceStopRows"] == 2142
    assert result["counts"]["stationGroups"] == 1586
    assert result["counts"]["serviceRoutePairRows"] == 2009
    assert result["counts"]["directedSegments"] == 3988
    assert result["identity"] == {
        "originalIds": 1794,
        "proposedIds": 1586,
        "mergedOriginalIds": 208,
    }
    _, metadata = _read_csv(output / "service-stop-metadata.csv")
    assert len(metadata) == 2142
    by_id = {row["id"]: row for row in stations}
    assert by_id["ichigaya"]["name"] == "市ケ谷"
    assert json.loads(by_id["ichigaya"]["aliases"]) == []
    assert by_id["j-village"]["name"] == "Jヴィレッジ"
    loaded = load_overrides(output / "overrides")
    assert len(loaded.registry.stations) == 1586


def test_group_aliases_are_normalized_and_drop_spelling_variants() -> None:
    # 市ヶ谷 (Metro/Toei) is only a small-ヶ spelling of the JR canonical 市ケ谷,
    # and the registry stores names and aliases in normalized form.
    originals = ["市ケ谷", "市ヶ谷", "霞ヶ関", "霞ケ関", "新宿三丁目"]

    aliases = assembly._group_aliases("市ケ谷", originals)

    assert aliases == ["霞ケ関", "新宿三丁目"]
