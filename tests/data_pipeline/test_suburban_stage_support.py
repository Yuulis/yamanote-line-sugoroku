"""Regression tests for suburban staging setup, raw pair measurement and audit."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.data_pipeline import stage_suburban_jr as stage
from scripts.data_pipeline.constraints import JunctionRule, SectionFilter
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.routing import RoutingError
from tests.data_pipeline.support import historical_baseline


def _copy_seed_inputs(root: Path) -> Path:
    source = stage.ROOT
    shutil.copytree(historical_baseline("data/overrides"), root / "data/overrides")
    shutil.copytree(historical_baseline("public/data"), root / "public/data")
    research = root / ".claude/docs/research"
    research.mkdir(parents=True)
    input_names = (
        "tokyo-suburban-research-catalog.csv",
        "tokyo-suburban-research-services.csv",
    )
    inputs: dict[str, str] = {}
    for name in input_names:
        relative = f".claude/docs/research/{name}"
        source_path = source / relative
        target_path = root / relative
        shutil.copy2(source_path, target_path)
        inputs[relative] = hashlib.sha256(target_path.read_bytes()).hexdigest()
    freeze_path = root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
    freeze_path.parent.mkdir(parents=True)
    freeze_path.write_text(json.dumps({"inputs": inputs}), encoding="utf-8")
    return root


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def test_verify_freeze_rejects_changed_input(tmp_path: Path) -> None:
    source = tmp_path / "catalog.csv"
    source.write_text("frozen\n", encoding="utf-8")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    freeze = tmp_path / "freeze.json"
    freeze.write_text(json.dumps({"inputs": {"catalog.csv": digest}}), encoding="utf-8")

    stage.verify_freeze(freeze, tmp_path)
    source.write_text("changed\n", encoding="utf-8")

    with pytest.raises(stage.StageError, match="hash mismatch"):
        stage.verify_freeze(freeze, tmp_path)


def test_seed_writes_frozen_assigned_stops_metadata_scope_and_oracle(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    stage_dir = stage.seed("tohoku", root=root)
    frozen_order, frozen = stage._frozen_jr_catalog(root)
    assigned = set(stage.REGION_SERVICES["tohoku"])
    shipped_ids = {
        row["id"]
        for row in _read_json(root / "data/overrides/services.json")["services"]
    }
    service_order = [
        service_id
        for service_id in frozen_order
        if service_id in shipped_ids or service_id in assigned
    ]

    services = _read_json(stage_dir / "services.json")
    assert [service["id"] for service in services["services"]] == service_order
    assert len(services["services"]) == len(shipped_ids | assigned)
    definitions = {service["id"]: service for service in services["services"]}
    for service_id in assigned:
        _, stops = _read_csv(stage_dir / "services" / service_id / "stops.csv")
        assert [row["station_id"] for row in stops] == [
            row["station_id_proposed"] for row in frozen[service_id]
        ]
        assert definitions[service_id]["expectedStopCount"] == len(stops)
        assert definitions[service_id]["areaPrefectures"] == stage.STAGE_PREFECTURES
        _, scope = _read_csv(stage_dir / "services" / service_id / "scope.csv")
        assert all(
            row["in_area"] == "true"
            for row in scope
            if row["station_id"] in {s["station_id"] for s in stops}
        )

    mito_stops = {
        row["station_id"]: row
        for row in _read_csv(stage_dir / "services/jr-mito/stops.csv")[1]
    }
    assert mito_stops["oyama"]["platform_selector"] == (
        "line=水戸線;group=002407;code=002410"
    )
    assert _read_csv(stage_dir / "services/jr-suigun/scope.csv")[1][-1] == {
        "station_id": "shimonomiya",
        "prefecture": "茨城県",
        "municipality": "久慈郡大子町",
        "in_area": "false",
    }
    nikko_stops = {
        row["station_id"]: row
        for row in _read_csv(stage_dir / "services/jr-nikko/stops.csv")[1]
    }
    assert nikko_stops["fubasami"]["n02_name"] == "文挟"
    assert definitions["jr-mito"]["color"] == "#808080"
    assert definitions["jr-mito"]["directionLabels"] == {
        "forward": "友部方面",
        "backward": "小山方面",
    }

    expected = _read_json(stage_dir / "expected-catalog.json")
    expected_by_id = {
        service["id"]: service["stationIds"] for service in expected["services"]
    }
    live_stop_ids = {
        service_id: {
            row["station_id"]
            for row in _read_csv(
                root / "data/overrides/services" / service_id / "stops.csv"
            )[1]
        }
        for service_id in service_order
        if service_id not in assigned
    }
    for service_id in service_order:
        if service_id in assigned:
            assert expected_by_id[service_id] == [
                row["station_id_proposed"] for row in frozen[service_id]
            ]
        else:
            assert expected_by_id[service_id] == [
                row["station_id_proposed"]
                for row in frozen[service_id]
                if row["station_id_proposed"] in live_stop_ids[service_id]
            ]
    dataset = _read_json(stage_dir / "dataset.json")
    assert (
        hashlib.sha256(
            (stage_dir / dataset["expectedCatalogFile"]).read_bytes()
        ).hexdigest()
        == dataset["expectedCatalogSha256"]
    )
    actual_station_ids = {
        row["station_id"]
        for service_id in service_order
        for row in _read_csv(stage_dir / "services" / service_id / "stops.csv")[1]
    }
    assert set(expected["stationIds"]) == actual_station_ids

    length_refs = stage.parse_length_refs(
        root / "data/staging/tokyo-suburban-jr/tohoku/length-refs.csv"
    )
    assert len(length_refs) == len(assigned)
    assert {row["service_id"] for row in length_refs} == assigned


def test_seed_keeps_nonassigned_definitions_and_route_files_shipped(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    live_services = _read_json(root / "data/overrides/services.json")
    old_definition = next(
        row for row in live_services["services"] if row["id"] == "jr-yamanote"
    )
    old_stops = (root / "data/overrides/services/jr-yamanote/stops.csv").read_bytes()
    old_mapping = (
        root / "data/overrides/services/jr-yamanote/line_mapping.csv"
    ).read_bytes()
    old_stop_ids = {
        row["station_id"]
        for row in _read_csv(root / "data/overrides/services/jr-yamanote/stops.csv")[1]
    }
    old_scope = _read_csv(root / "data/overrides/services/jr-yamanote/scope.csv")[1]

    stage_dir = stage.seed("tohoku", root=root)
    staged_services = _read_json(stage_dir / "services.json")
    new_definition = next(
        row for row in staged_services["services"] if row["id"] == "jr-yamanote"
    )
    old_definition["areaPrefectures"] = stage.FOUR_PREFECTURES
    assert new_definition == old_definition
    assert (stage_dir / "services/jr-yamanote/stops.csv").read_bytes() == old_stops
    assert (
        stage_dir / "services/jr-yamanote/line_mapping.csv"
    ).read_bytes() == old_mapping
    _, staged_scope = _read_csv(stage_dir / "services/jr-yamanote/scope.csv")
    assert [
        {**row, "in_area": "true" if row["station_id"] in old_stop_ids else "false"}
        for row in old_scope
    ] == staged_scope


def test_seed_refuses_to_overwrite_an_existing_region(tmp_path: Path) -> None:
    root = _copy_seed_inputs(tmp_path)
    destination = stage.seed("tohoku", root=root)
    before = (destination / "services/jr-mito/stops.csv").read_bytes()
    with pytest.raises(stage.StageError, match="refusing to overwrite"):
        stage.seed("tohoku", root=root)
    assert (destination / "services/jr-mito/stops.csv").read_bytes() == before


@pytest.mark.parametrize("region", stage.REGIONS)
def test_seed_assignments_match_the_frozen_catalog_for_each_region(
    tmp_path: Path, region: str
) -> None:
    root = _copy_seed_inputs(tmp_path)
    stage_dir = stage.seed(region, root=root)
    _, frozen = stage._frozen_jr_catalog(root)
    assigned = set(stage.REGION_SERVICES[region])
    staged_services = _read_json(stage_dir / "services.json")["services"]
    definitions = {row["id"]: row for row in staged_services}
    shipped = _read_json(root / "data/overrides/services.json")["services"]
    shipped_definitions = {row["id"]: row for row in shipped}
    for service_id in stage.REGION_SERVICES[region]:
        stops = _read_csv(stage_dir / "services" / service_id / "stops.csv")[1]
        expected = [row["station_id_proposed"] for row in frozen[service_id]]
        assert [row["station_id"] for row in stops] == expected
    oracle = _read_json(stage_dir / "expected-catalog.json")
    oracle_by_id = {row["id"]: row["stationIds"] for row in oracle["services"]}
    for service_id in assigned:
        assert oracle_by_id[service_id] == [
            row["station_id_proposed"] for row in frozen[service_id]
        ]
    for service in staged_services:
        if service["id"] not in assigned:
            assert service["areaPrefectures"] == stage.FOUR_PREFECTURES
            expected_definition = dict(shipped_definitions[service["id"]])
            expected_definition["areaPrefectures"] = stage.FOUR_PREFECTURES
            assert definitions[service["id"]] == expected_definition
            for filename in ("stops.csv", "line_mapping.csv"):
                relative = Path("services") / service["id"] / filename
                assert (stage_dir / relative).read_bytes() == (
                    root / "data/overrides" / relative
                ).read_bytes()
    load_overrides(stage_dir)


def test_assemble_merges_each_region_once_into_the_complete_frozen_catalog(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    for region in stage.REGIONS:
        stage.seed(region, root=root)

    combined_dir = stage.assemble(root=root)
    overrides = load_overrides(combined_dir)
    oracle = _read_json(combined_dir / "expected-catalog.json")

    assert len(overrides.services) == 55
    assert len(overrides.registry.stations) == 746
    assert len(oracle["stationIds"]) == 746
    assert sum(len(service.stops) for service in overrides.services) == 976
    readme = (root / "data/staging/tokyo-suburban-jr/combined/README.md").read_text(
        encoding="utf-8"
    )
    assert (
        "regional s2gate (tests, deterministic A/B, validate, preservation audit) passed"
        not in readme
    )
    assert (
        "run `s2gate tohoku 2>&1 | tee .claude/logs/s2/tohoku-verification.log`"
        in readme
    )
    assert ".claude/logs/s2/tohoku-verification.log" in readme
    assert (
        len(
            stage.parse_length_refs(
                root / "data/staging/tokyo-suburban-jr/combined/length-refs.csv"
            )
        )
        == 25
    )


def test_assemble_unions_region_dataset_level_exception_rows(tmp_path: Path) -> None:
    root = _copy_seed_inputs(tmp_path)
    for region in stage.REGIONS:
        stage.seed(region, root=root)

    region_dir = root / "data/staging/tokyo-suburban-jr/tohoku/overrides"
    fields, rows = _read_csv(region_dir / "detour_exceptions.csv")
    rows.append(
        {
            "service_id": "jr-karasuyama",
            "from_id": "taki",
            "to_id": "karasuyama",
            "max_detour_ratio": "1.90",
            "reason": "Reviewed regional exception",
        }
    )
    stage._write_csv(region_dir / "detour_exceptions.csv", fields, rows)

    combined_dir = stage.assemble(root=root)
    _, combined_rows = _read_csv(combined_dir / "detour_exceptions.csv")

    assert {
        (row["service_id"], row["from_id"], row["to_id"]): row for row in combined_rows
    }[("jr-karasuyama", "taki", "karasuyama")] == {
        "service_id": "jr-karasuyama",
        "from_id": "taki",
        "to_id": "karasuyama",
        "max_detour_ratio": "1.90",
        "reason": "Reviewed regional exception",
    }


@pytest.mark.parametrize("mutation", ["modify", "delete"])
def test_assemble_rejects_changed_or_deleted_live_exception_rows(
    tmp_path: Path, mutation: str
) -> None:
    root = _copy_seed_inputs(tmp_path)
    for region in stage.REGIONS:
        stage.seed(region, root=root)
    region_dir = root / "data/staging/tokyo-suburban-jr/tohoku/overrides"
    path = region_dir / "detour_exceptions.csv"
    fields, rows = _read_csv(path)
    if mutation == "modify":
        rows[0]["reason"] = "Changed shipped row"
    else:
        rows = rows[1:]
    stage._write_csv(path, fields, rows)

    with pytest.raises(
        stage.StageError,
        match=f"live row {'modified' if mutation == 'modify' else 'deleted'} in tohoku/detour_exceptions.csv",
    ):
        stage.assemble(root=root)


def test_assemble_rejects_conflicting_dataset_exception_additions(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    for region in stage.REGIONS:
        stage.seed(region, root=root)
    key_row = {
        "service_id": "jr-karasuyama",
        "from_id": "taki",
        "to_id": "karasuyama",
        "max_detour_ratio": "1.90",
        "reason": "Reviewed regional exception",
    }
    for region, reason in (
        ("tohoku", "First reviewed value"),
        ("takasaki", "Conflict"),
    ):
        region_dir = root / "data/staging/tokyo-suburban-jr" / region / "overrides"
        path = region_dir / "detour_exceptions.csv"
        fields, rows = _read_csv(path)
        rows.append({**key_row, "reason": reason})
        stage._write_csv(path, fields, rows)

    with pytest.raises(
        stage.StageError, match="dataset-level row conflicts across regions"
    ):
        stage.assemble(root=root)


def test_length_refs_parser_and_fixed_tolerance(tmp_path: Path) -> None:
    path = tmp_path / "length-refs.csv"
    stage._write_csv(
        path,
        list(stage.LENGTH_REF_FIELDS),
        [
            {
                "service_id": "jr-mito",
                "from": "小山",
                "to": "友部",
                "km": "50.200",
                "source_url": "https://example.test/mileage",
                "n02_pair_sum_km": "51.700",
                "notes": "fixture",
            }
        ],
    )
    assert stage.parse_length_refs(path)[0]["km"] == "50.200"
    stage.check_length_tolerance(50.2, 51.7)
    with pytest.raises(stage.StageError, match="tolerance 1.5 km"):
        stage.check_length_tolerance(50.2, 51.701)

    path.write_text("service_id,from,to,km\njr-mito,小山,友部,50.2\n", encoding="utf-8")
    with pytest.raises(stage.StageError, match="must use columns"):
        stage.parse_length_refs(path)


def test_raw_pair_measurement_oyama_to_otabayashi_is_about_4_812_km(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    overrides_dir = stage.seed("tohoku", root=root)
    overrides = load_overrides(overrides_dir)
    provider = N02SourceProvider(
        stage.ROOT / "N02-25_GML/UTF-8",
        overrides.dataset.candidate_search_bbox,
    )
    _, catalog = stage._frozen_jr_catalog(root)

    measured = stage.measure_single_pair(
        overrides, "jr-mito", 0, provider, catalog["jr-mito"]
    )

    assert measured["status"] == "pass"
    assert (measured["from_id"], measured["to_id"]) == ("oyama", "otabayashi")
    assert float(measured["path_length_km"]) == pytest.approx(4.811758, abs=0.002)
    assert float(measured["start_snap_m"]) < 0.01
    assert float(measured["end_snap_m"]) < 0.01


def test_added_pair_measurement_rejects_scoped_allow_missing_from_its_window(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    overrides_dir = stage.seed("tohoku", root=root)
    overrides = load_overrides(overrides_dir)
    provider = N02SourceProvider(
        stage.ROOT / "N02-25_GML/UTF-8",
        overrides.dataset.candidate_search_bbox,
    )
    _, catalog = stage._frozen_jr_catalog(root)
    service = overrides.service("jr-mito")
    operator = service.effective_n02_operator(overrides.dataset)
    constraints = stage.AddedRangeConstraints(
        scoped_section_filters={
            (operator, "水戸線", "oyama", "otabayashi"): SectionFilter(
                allow=frozenset({"section-only-in-another-window"})
            )
        }
    )

    with pytest.raises(RoutingError, match="admits no section"):
        stage.measure_single_pair(
            overrides,
            "jr-mito",
            0,
            provider,
            catalog["jr-mito"],
            constraints=constraints,
        )


def test_preservation_gate_detects_old_station_mutation(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline"
    output = tmp_path / "output"
    shutil.copytree(historical_baseline("public/data"), baseline)
    shutil.copytree(baseline, output)
    (tmp_path / "data/overrides").mkdir(parents=True)
    shutil.copytree(
        historical_baseline("data/overrides") / "services",
        tmp_path / "data/overrides/services",
    )
    stage_dir = tmp_path / "data/staging/tokyo-suburban-jr/tohoku/overrides"
    shutil.copytree(tmp_path / "data/overrides", stage_dir)

    assert (
        stage._check_old_pair_records(
            stage_dir,
            output,
            baseline,
            live_overrides=historical_baseline("data/overrides"),
        )
        == []
    )

    stations = json.loads((output / "stations.json").read_text(encoding="utf-8"))
    stations[0]["name"] = "changed"
    (output / "stations.json").write_text(json.dumps(stations), encoding="utf-8")

    findings = stage._check_old_pair_records(stage_dir, output, baseline)
    assert "shipped station record changed: shimbashi" in findings


def test_audit_rejects_missing_region_stage(tmp_path: Path) -> None:
    (tmp_path / ".claude/docs/plans").mkdir(parents=True)
    (tmp_path / ".claude/docs/plans/tokyo-suburban-s0-freeze.json").write_text(
        json.dumps({"inputs": {}}), encoding="utf-8"
    )

    with pytest.raises(stage.StageError, match="staging directory is missing"):
        stage.audit("tohoku", tmp_path / "output", root=tmp_path)


def test_audit_accepts_a_fresh_region_seed_against_the_shipped_baseline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _copy_seed_inputs(tmp_path)
    stage.seed("tohoku", root=root)
    n02_identities = stage._n02_station_identities(stage.ROOT)
    monkeypatch.setattr(stage, "_n02_station_identities", lambda _root: n02_identities)

    assert stage.audit("tohoku", root / "public/data", root=root) == []


def test_preservation_gate_accepts_added_but_rejects_changed_or_missing_platforms(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)
    stage.seed("takasaki", root=root)
    baseline = root / "public/data"
    stage_dir = root / "data/staging/tokyo-suburban-jr/takasaki/overrides"
    shipped_service_id = "jr-takasaki"

    def updated_output(
        name: str,
        update: Callable[[dict[str, list[float]]], object],
    ) -> Path:
        output = tmp_path / name
        shutil.copytree(baseline, output)
        services_path = output / "services.json"
        services = _read_json(services_path)
        service = next(
            row for row in services["services"] if row["id"] == shipped_service_id
        )
        update(service["platformCoordinates"])
        services_path.write_text(json.dumps(services), encoding="utf-8")
        return output

    added = updated_output(
        "added-platform",
        lambda platforms: platforms.update({"new-stage-stop": [139.0, 36.0]}),
    )
    assert (
        stage._check_old_pair_records(
            stage_dir, added, baseline, live_overrides=root / "data/overrides"
        )
        == []
    )

    changed = updated_output(
        "changed-platform",
        lambda platforms: platforms.__setitem__(next(iter(platforms)), [0.0, 0.0]),
    )
    assert (
        f"shipped platform coordinates changed: {shipped_service_id}"
        in stage._check_old_pair_records(
            stage_dir,
            changed,
            baseline,
            live_overrides=root / "data/overrides",
        )
    )

    missing = updated_output(
        "missing-platform",
        lambda platforms: platforms.pop(next(iter(platforms))),
    )
    assert (
        f"shipped platform coordinates changed: {shipped_service_id}"
        in stage._check_old_pair_records(
            stage_dir,
            missing,
            baseline,
            live_overrides=root / "data/overrides",
        )
    )


def test_seed_maps_reviewed_line_boundary_pairs_to_their_track_line(
    tmp_path: Path,
) -> None:
    root = _copy_seed_inputs(tmp_path)

    stage_dir = stage.seed("takasaki", root=root)

    def line_of(service_id: str, pair: tuple[str, str]) -> str:
        rows = _read_csv(stage_dir / "services" / service_id / "line_mapping.csv")[1]
        return next(
            row["n02_line"] for row in rows if (row["from_id"], row["to_id"]) == pair
        )

    assert line_of("jr-hachiko", ("kuragano", "takasaki")) == "高崎線"
    assert line_of("jr-ryomo", ("ino", "shim-maebashi")) == "上越線"
    assert line_of("jr-ryomo", ("shim-maebashi", "maebashi")) == "両毛線"


def test_new_pair_line_rejects_an_unreviewed_line_name_change() -> None:
    origin = {"station_id_proposed": "a", "n02_line": "八高線"}
    destination = {"station_id_proposed": "b", "n02_line": "高崎線"}

    with pytest.raises(stage.StageError, match="unreviewed N02 line boundary"):
        stage._new_pair_line("jr-example", origin, destination)
    assert (
        stage._new_pair_line(
            "jr-example", origin, {**destination, "n02_line": "八高線"}
        )
        == "八高線"
    )


def test_seed_writes_the_reviewed_j_village_junction_rule(tmp_path: Path) -> None:
    root = _copy_seed_inputs(tmp_path)

    stage_dir = stage.seed("tohoku", root=root)

    fields, rows = _read_csv(stage_dir / "services/jr-joban-rapid/junctions.csv")
    assert tuple(fields) == stage.JUNCTION_FIELDS
    assert [(row["section_key"], row["lon"], row["lat"]) for row in rows] == [
        (
            "141.00748 37.24274~141.00776 37.24270#9d1f3f94",
            "141.0073806",
            "37.24077448",
        )
    ]
    service = load_overrides(stage_dir).service("jr-joban-rapid")
    assert [rule.peer_section_key for rule in service.junction_rules] == [
        "140.99921 37.21210~141.00738 37.24077#de4dc6de"
    ]


def _write_sections(path: Path, rows: list[tuple[str, str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["n02_line,action,section_key,reason"]
    lines.extend(f"{line},{action},{key},reviewed" for line, action, key in rows)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_added_ranges_drop_shipped_allow_lists_but_keep_shipped_denies(
    tmp_path: Path,
) -> None:
    live, staged = tmp_path / "live", tmp_path / "staged"
    shipped = [("東北線", "allow", "shipped-allow"), ("東北線", "deny", "shipped-deny")]
    _write_sections(live / "services/jr-x/sections.csv", shipped)
    _write_sections(
        staged / "services/jr-x/sections.csv",
        [*shipped, ("東北線", "allow", "new-allow"), ("東北線", "deny", "new-deny")],
    )
    service = SimpleNamespace(id="jr-x", junction_rules=())

    constraints = stage.added_range_constraints(service, staged, live, "JR")

    assert constraints.section_filters[("JR", "東北線")] == SectionFilter(
        allow=frozenset({"new-allow"}),
        deny=frozenset({"shipped-deny", "new-deny"}),
    )
    assert constraints.reviewed_keys == {
        ("JR", "東北線"): frozenset({"new-allow", "new-deny"})
    }


def test_added_ranges_without_staged_rows_inherit_no_allow_list(
    tmp_path: Path,
) -> None:
    live, staged = tmp_path / "live", tmp_path / "staged"
    shipped = [("高崎線", "allow", "shipped-allow")]
    _write_sections(live / "services/jr-x/sections.csv", shipped)
    _write_sections(staged / "services/jr-x/sections.csv", shipped)
    service = SimpleNamespace(id="jr-x", junction_rules=())

    constraints = stage.added_range_constraints(service, staged, live, "JR")

    assert constraints.section_filters == {}
    assert constraints.reviewed_keys == {}


def test_scoped_reuse_of_inherited_allow_key_is_measured_as_new_range_rule(
    tmp_path: Path,
) -> None:
    live, staged = tmp_path / "live", tmp_path / "staged"
    live_service = live / "services/jr-x"
    stage_service = staged / "services/jr-x"
    live_service.mkdir(parents=True)
    stage_service.mkdir(parents=True)
    _write_sections(live_service / "sections.csv", [("L", "allow", "same-key")])
    stage._write_csv(
        live_service / "stops.csv",
        ["order", "station_id"],
        [
            {"order": "0", "station_id": "old-start"},
            {"order": "1", "station_id": "old-end"},
        ],
    )
    stage._write_csv(
        stage_service / "sections.csv",
        ["n02_line", "action", "section_key", "reason", "from_id", "to_id"],
        [
            {
                "n02_line": "L",
                "action": "allow",
                "section_key": "same-key",
                "reason": "Migrated shipped range",
                "from_id": "old-start",
                "to_id": "old-end",
            },
            {
                "n02_line": "L",
                "action": "allow",
                "section_key": "same-key",
                "reason": "Reviewed new range reuse",
                "from_id": "old-end",
                "to_id": "new-end",
            },
        ],
    )

    constraints = stage.added_range_constraints(
        SimpleNamespace(id="jr-x", junction_rules=()), staged, live, "JR"
    )

    assert constraints.section_filters == {}
    assert constraints.scoped_section_filters[
        ("JR", "L", "old-end", "new-end")
    ].allow == frozenset({"same-key"})
    assert constraints.scoped_reviewed_keys == {
        ("JR", "L", "old-end", "new-end"): frozenset({"same-key"})
    }


def test_scoped_reviewed_key_must_exist_in_a_covered_pair_window() -> None:
    constraints = stage.AddedRangeConstraints(
        scoped_reviewed_keys={("JR", "L", "a", "b"): frozenset({"only-other-pair"})}
    )
    wrong_pair = {("JR", "L"): frozenset({"only-other-pair"})}

    problems = stage.unresolved_reviewed_constraints(
        constraints,
        [wrong_pair],
        {("b", "c"): wrong_pair},
        ("a", "b", "c"),
    )

    assert problems == [
        "JR/L a->b: reviewed section keys not found near covered pairs ['only-other-pair']"
    ]


def test_window_filter_keeps_admission_and_fails_closed_outside_allow() -> None:
    reviewed = SectionFilter(allow=frozenset({"a", "far"}), deny=frozenset({"d", "x"}))

    trimmed = stage._window_filter(reviewed, frozenset({"a", "b", "d"}), "label")

    assert trimmed == SectionFilter(allow=frozenset({"a"}), deny=frozenset({"d"}))
    assert [key for key in ("a", "b", "d") if trimmed.admits(key)] == [
        key for key in ("a", "b", "d") if reviewed.admits(key)
    ]
    with pytest.raises(RoutingError, match="admits no section"):
        stage._window_filter(reviewed, frozenset({"b"}), "label")


def test_unresolved_reviewed_constraints_report_stale_keys_and_unused_rules() -> None:
    rule = JunctionRule("JR", "常磐線", "target", "peer", 1.0, 2.0, "reviewed")
    constraints = stage.AddedRangeConstraints(
        reviewed_keys={("JR", "常磐線"): frozenset({"seen", "stale"})},
        junction_rules=(rule,),
    )
    # The rule's two sections are seen, but never in the same pair window.
    windows = [
        {("JR", "常磐線"): frozenset({"seen", "target"})},
        {("JR", "常磐線"): frozenset({"peer"})},
    ]

    problems = stage.unresolved_reviewed_constraints(constraints, windows)

    assert problems == [
        "JR/常磐線: reviewed section keys not found near any added pair ['stale']",
        "JR/常磐線: junction rule not near any added pair target",
    ]
    windows.append({("JR", "常磐線"): frozenset({"stale", "target", "peer"})})
    assert stage.unresolved_reviewed_constraints(constraints, windows) == []
