"""Non-JR staging component and frozen-seed regressions."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline import stage_suburban_nonjr as stage
from scripts.data_pipeline.composition import ComposeRecipe
from scripts.data_pipeline.constraints import PlatformSelector
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.override_models import LineRange, Stop, StopResolution
from scripts.data_pipeline.routing import RoutingError
from scripts.data_pipeline.stage_suburban_support import StageError
from tests.data_pipeline.support import historical_baseline


def test_component_assignments_keep_operators_and_disconnected_services_separate() -> (
    None
):
    result = stage.component_assignments(
        {
            "tobu-main": ["a", "shared"],
            "tobu-branch": ["shared", "b"],
            "tobu-independent": ["c"],
            "seibu-main": ["shared", "d"],
        },
        {
            "tobu-main": "東武鉄道",
            "tobu-branch": "東武鉄道",
            "tobu-independent": "東武鉄道",
            "seibu-main": "西武鉄道",
        },
    )

    assert result == {
        "tobu-main": "tobu-branch",
        "tobu-branch": "tobu-branch",
        "tobu-independent": "tobu-independent",
        "seibu-main": "seibu-main",
    }


def test_component_assignments_reject_mismatched_inventories() -> None:
    with pytest.raises(StageError, match="inventories disagree"):
        stage.component_assignments({"metro-a": ["a"]}, {})


def test_nonjr_seed_refuses_overwrite_and_uses_frozen_original_ids(
    tmp_path: Path,
) -> None:
    source = stage.ROOT
    for relative in ("data/overrides", "public/data"):
        shutil.copytree(historical_baseline(relative), tmp_path / relative)
    shutil.copytree(
        source / ".claude/docs/research", tmp_path / ".claude/docs/research"
    )
    (tmp_path / ".claude/docs/plans").mkdir(parents=True)
    shutil.copy2(
        source / ".claude/docs/plans/tokyo-suburban-s0-freeze.json",
        tmp_path / ".claude/docs/plans/tokyo-suburban-s0-freeze.json",
    )

    seeded = stage.seed("metro", root=tmp_path)
    inventory = json.loads((seeded / "inventory.json").read_text(encoding="utf-8"))
    assert inventory["counts"] == {"services": 10, "stops": 186, "pairs": 176}
    first_service = inventory["serviceIds"][0]
    component = next(
        item for item in inventory["components"] if first_service in item["serviceIds"]
    )
    first_stop = (
        (
            seeded
            / "components"
            / component["componentId"]
            / "overrides"
            / "services"
            / first_service
            / "stops.csv"
        )
        .read_text(encoding="utf-8")
        .splitlines()[1]
    )
    first_identity = next(
        row
        for row in (seeded / "identity-map.csv")
        .read_text(encoding="utf-8")
        .splitlines()[1:]
        if row.startswith(f"{first_service},")
    )
    assert first_stop.split(",")[1] == first_identity.split(",")[1]
    with pytest.raises(StageError, match="refusing to overwrite"):
        stage.seed("metro", root=tmp_path)


def test_seed_keeps_disconnected_seibu_components_separate(tmp_path: Path) -> None:
    _copy_seed_inputs(tmp_path)
    seeded = stage.seed("seibu", root=tmp_path)
    inventory = json.loads((seeded / "inventory.json").read_text(encoding="utf-8"))
    component_for = {
        service_id: component["componentId"]
        for component in inventory["components"]
        for service_id in component["serviceIds"]
    }

    assert component_for["seibu-yamaguchi"] != component_for["seibu-tamagawa"]
    assert component_for["seibu-tamagawa"] == "seibu-tamagawa"
    assert (seeded / "components" / "seibu-tamagawa" / "overrides").is_dir()


def test_seed_matches_n02_by_original_name_not_d1_group_name(tmp_path: Path) -> None:
    # The frozen catalog groups Seibu 秋津 with JR 新秋津 (D1); N02 only knows 秋津.
    _copy_seed_inputs(tmp_path)
    seeded = stage.seed("seibu", root=tmp_path)
    inventory = json.loads((seeded / "inventory.json").read_text(encoding="utf-8"))
    component_id = next(
        component["componentId"]
        for component in inventory["components"]
        if "seibu-ikebukuro" in component["serviceIds"]
    )
    stops_path = (
        seeded
        / "components"
        / component_id
        / "overrides"
        / "services"
        / "seibu-ikebukuro"
        / "stops.csv"
    )
    with stops_path.open(encoding="utf-8", newline="") as handle:
        akitsu = next(
            row for row in csv.DictReader(handle) if row["station_id"] == "seibu-akitsu"
        )

    assert akitsu["n02_name"] == "秋津"
    assert akitsu["original_name"] == "秋津"


def test_loop_pair_indexes_include_the_closing_pair() -> None:
    stop_ids = ["a", "b", "c", "d"]

    indexes = stage.service_pair_indexes(stop_ids, circular=True)

    assert [stage.station_pairs(stop_ids, True)[index] for index in indexes] == [
        ("a", "b"),
        ("b", "c"),
        ("c", "d"),
        ("d", "a"),
    ]


def test_candidate_resolution_rejects_foreign_operator_platforms() -> None:
    foreign = PlatformCandidate(
        station_name="Example",
        n02_line="Line",
        station_code="01",
        group_code="01",
        platform=LineString([(0, 0), (1, 0)]),
        midpoint=Point(0.5, 0),
        operator="Foreign Operator",
    )
    source = SimpleNamespace(platform_candidates=lambda names, lines: [foreign])
    stop = Stop(0, "example", "", PlatformSelector(), n02_name="Example")
    resolution = StopResolution("Expected Operator", "Example", "Example", False)

    with pytest.raises(RoutingError, match="no N02 platform"):
        jr._candidate_options(stop, resolution, SimpleNamespace(), source, {"Line"})


def test_tampered_pair_evidence_fails_actual_output_comparison() -> None:
    evidence = [
        {
            "service_id": "seibu-line",
            "from_id": "a",
            "to_id": "b",
            "n02_line": "Line",
            "from_platform_code": "01",
            "from_group_code": "01",
            "to_platform_code": "02",
            "to_group_code": "02",
            "path_length_km": "1.000000",
            "start_snap_m": "0.000",
            "end_snap_m": "0.000",
        }
    ]
    gated_evidence_hash = stage._evidence_hash(evidence)
    evidence[0]["path_length_km"] = "1.250000"
    actual = {
        "seibu-line|a|b": {
            **evidence[0],
            "path_length_km": "1.000000",
        }
    }

    assert stage._compare_measurements(evidence, actual) == [
        "evidence differs from actual build for seibu-line|a|b path_length_km"
    ]
    assert stage._evidence_hash(evidence) != gated_evidence_hash


def test_measure_pair_endpoint_accepts_exact_other_line_anchor() -> None:
    anchor = _platform_candidate(
        line="Anchor line", code="A01", group="003294", midpoint=(139.7, 35.7)
    )
    track = _platform_candidate(
        line="Pair line", code="A02", group="003294", midpoint=(139.7, 35.7)
    )
    stop = Stop(
        0,
        "example",
        "",
        PlatformSelector(
            lines=frozenset({"Anchor line"}),
            groups=frozenset({"003294"}),
            codes=frozenset({"A01"}),
        ),
        n02_name="Example",
    )
    resolution = StopResolution("Metro", "Example", "Example", False)
    source = _CandidateSource([anchor, track])

    options, anchors_by_track = stage._pair_endpoint_options(
        stop, resolution, SimpleNamespace(), source, "Pair line", "from"
    )

    assert options == [track]
    assert anchors_by_track[("A02", "003294")] == (anchor, track)


@pytest.mark.parametrize(
    ("group", "midpoint", "operator"),
    [
        ("different-group", (139.7, 35.7), "Metro"),
        ("003294", (139.7000001, 35.7), "Metro"),
        ("003294", (139.7, 35.7), "Other operator"),
    ],
    ids=["different-group", "midpoint-offset-1e-7-degrees", "different-operator"],
)
def test_measure_pair_endpoint_rejects_nonidentical_other_line_anchor(
    group: str,
    midpoint: tuple[float, float],
    operator: str,
) -> None:
    anchor = _platform_candidate(
        line="Anchor line", code="A01", group="003294", midpoint=(139.7, 35.7)
    )
    track = _platform_candidate(
        line="Pair line",
        code="A02",
        group=group,
        midpoint=midpoint,
        operator=operator,
    )
    stop = Stop(
        0,
        "example",
        "",
        PlatformSelector(
            lines=frozenset({"Anchor line"}),
            groups=frozenset({"003294"}),
            codes=frozenset({"A01"}),
        ),
        n02_name="Example",
    )
    resolution = StopResolution("Metro", "Example", "Example", False)

    with pytest.raises(RoutingError, match="no N02 platform"):
        stage._pair_endpoint_options(
            stop,
            resolution,
            SimpleNamespace(),
            _CandidateSource([anchor, track]),
            "Pair line",
            "to",
        )


def _code_only_pinned_stop() -> Stop:
    # 関内 shape: the stop pins one N02 code and names no line.
    return Stop(
        0,
        "example",
        "",
        PlatformSelector(codes=frozenset({"A01"})),
        n02_name="Example",
    )


def test_measure_pair_origin_accepts_exact_anchor_for_code_only_pin() -> None:
    anchor = _platform_candidate(
        line="Anchor line", code="A01", group="004691", midpoint=(139.6, 35.4)
    )
    track = _platform_candidate(
        line="Pair line", code="A02", group="004691", midpoint=(139.6, 35.4)
    )
    resolution = StopResolution("Metro", "Example", "Example", False)

    options, anchors_by_track = stage._pair_endpoint_options(
        _code_only_pinned_stop(),
        resolution,
        SimpleNamespace(),
        _CandidateSource([anchor, track]),
        "Pair line",
        "from",
        stop_lines=frozenset({"Anchor line", "Pair line"}),
    )

    assert options == [track]
    assert anchors_by_track[("A02", "004691")] == (anchor, track)


@pytest.mark.parametrize(
    ("group", "midpoint", "operator"),
    [
        ("different-group", (139.6, 35.4), "Metro"),
        ("004691", (139.6000001, 35.4), "Metro"),
        ("004691", (139.6, 35.4), "Other operator"),
    ],
    ids=["different-group", "midpoint-offset-1e-7-degrees", "different-operator"],
)
def test_measure_pair_origin_rejects_nonidentical_anchor_for_code_only_pin(
    group: str,
    midpoint: tuple[float, float],
    operator: str,
) -> None:
    anchor = _platform_candidate(
        line="Anchor line", code="A01", group="004691", midpoint=(139.6, 35.4)
    )
    track = _platform_candidate(
        line="Pair line",
        code="A02",
        group=group,
        midpoint=midpoint,
        operator=operator,
    )
    resolution = StopResolution("Metro", "Example", "Example", False)

    with pytest.raises(RoutingError, match="no N02 platform"):
        stage._pair_endpoint_options(
            _code_only_pinned_stop(),
            resolution,
            SimpleNamespace(),
            _CandidateSource([anchor, track]),
            "Pair line",
            "from",
            stop_lines=frozenset({"Anchor line", "Pair line"}),
        )


def test_measure_pair_code_only_pin_without_other_stop_line_stays_unresolved() -> None:
    anchor = _platform_candidate(
        line="Anchor line", code="A01", group="004691", midpoint=(139.6, 35.4)
    )
    track = _platform_candidate(
        line="Pair line", code="A02", group="004691", midpoint=(139.6, 35.4)
    )
    resolution = StopResolution("Metro", "Example", "Example", False)

    with pytest.raises(RoutingError, match="no N02 platform"):
        stage._pair_endpoint_options(
            _code_only_pinned_stop(),
            resolution,
            SimpleNamespace(),
            _CandidateSource([anchor, track]),
            "Pair line",
            "from",
            stop_lines=frozenset({"Pair line"}),
        )


def _loop_service(*, circular: bool = True) -> SimpleNamespace:
    station_ids = ("a", "b", "c", "d")
    stops = tuple(
        Stop(index, station_id, "", PlatformSelector(), n02_name=station_id)
        for index, station_id in enumerate(station_ids)
    )
    ranges = tuple(
        LineRange(from_id, to_id, line)
        for from_id, to_id, line in (
            ("a", "b", "Line AB"),
            ("b", "c", "Line BC"),
            ("c", "d", "Line CD"),
            ("d", "a", "Line DA"),
        )
    )
    pair_ranges = ranges if circular else ranges[:-1]
    return SimpleNamespace(
        circular=circular,
        stops=stops,
        station_ids=station_ids,
        segment_ranges=lambda: pair_ranges,
    )


def test_measure_loop_closing_pair_wraps_to_first_stop() -> None:
    service = _loop_service()

    origin, destination = stage._pair_stops(service.stops, 3)

    assert (origin.station_id, destination.station_id) == ("d", "a")


def test_measure_loop_closing_pair_endpoints_see_wrapped_stop_lines() -> None:
    service = _loop_service()

    assert stage._endpoint_stop_lines(service, 3, "from") == {"Line CD", "Line DA"}
    assert stage._endpoint_stop_lines(service, 3, "to") == {"Line DA", "Line AB"}
    assert stage._endpoint_stop_lines(service, 0, "from") == {"Line DA", "Line AB"}


def test_measure_linear_chain_ends_offer_only_their_own_pair_line() -> None:
    service = _loop_service(circular=False)

    assert stage._endpoint_stop_lines(service, 0, "from") == {"Line AB"}
    assert stage._endpoint_stop_lines(service, 1, "to") == {"Line BC", "Line CD"}
    assert stage._endpoint_stop_lines(service, 2, "to") == {"Line CD"}


def test_measure_endpoint_stop_lines_skip_a_compose_neighbour() -> None:
    service = _loop_service(circular=False)
    composed = LineRange("a", "b", "", compose=ComposeRecipe(legs=()))
    ranges = (composed, *service.segment_ranges()[1:])
    service.segment_ranges = lambda: ranges

    assert stage._endpoint_stop_lines(service, 1, "from") == {"Line BC"}


@pytest.mark.parametrize(
    ("field", "actual_code", "expected_problem"),
    [
        (
            "from_platform_code",
            "003295",
            "evidence differs from actual build for metro-line|a|b from_platform_code",
        ),
        (
            "from_track_platform_code",
            "003294",
            "evidence differs from actual build for metro-line|a|b from_track_platform_code",
        ),
        (
            "from_platform_code",
            "3294",
            "evidence differs from actual build for metro-line|a|b from_platform_code",
        ),
    ],
)
def test_gate_measurement_comparison_rejects_platform_code_mismatch(
    field: str, actual_code: str, expected_problem: str
) -> None:
    evidence = [
        {
            "service_id": "metro-line",
            "from_id": "a",
            "to_id": "b",
            "n02_line": "Pair line",
            "from_platform_code": "003294",
            "from_group_code": "003294",
            "from_track_platform_code": "track-code",
            "to_platform_code": "02",
            "to_group_code": "02",
            "to_track_platform_code": "02",
            "path_length_km": "1.000000",
            "start_snap_m": "0.000",
            "end_snap_m": "0.000",
        }
    ]
    actual = {
        "metro-line|a|b": {
            **evidence[0],
            field: actual_code,
        }
    }

    assert stage._compare_measurements(evidence, actual) == [expected_problem]


def test_audit_baseline_check_rejects_stale_public_bundle(tmp_path: Path) -> None:
    shutil.copytree(historical_baseline("public/data"), tmp_path / "public/data")
    snapshot = stage._baseline_snapshot(tmp_path)
    (tmp_path / "public/data/manifest.json").write_text("tampered\n", encoding="utf-8")

    assert stage._protected_changes(tmp_path, snapshot) == ["publicData"]


def test_secondary_length_component_keeps_its_class_in_length_ref_source(
    tmp_path: Path,
) -> None:
    group_root = tmp_path / "metro"
    component_root = group_root / "components/test-service/overrides"
    component_root.mkdir(parents=True)
    stage.write_csv(
        group_root / "length-refs.csv",
        list(stage.LENGTH_FIELDS),
        [
            {
                "service_id": "test-service",
                "from": "Start",
                "to": "End",
                "km": "2.5",
                "source_url": "https://example.test/mileage",
                "n02_pair_sum_km": "",
                "notes": "",
            }
        ],
    )
    stage.write_csv(
        group_root / "length-ref-components.csv",
        list(stage.COMPONENT_FIELDS),
        [
            {
                "service_id": "test-service",
                "from": "Start",
                "to": "End",
                "km": "2.5",
                "source_url": "https://example.test/mileage",
                "document": "Published timetable appendix",
                "page_or_table": "table 1",
                "operation": "+",
                "source_class": "secondary",
                "notes": "Cites the official operator table.",
            }
        ],
    )
    stage.write_json(
        component_root / "services.json", {"services": [{"id": "test-service"}]}
    )

    stage._apply_length_refs(group_root, ["test-service"], ["test-service"])

    service = json.loads(
        (component_root / "services.json").read_text(encoding="utf-8")
    )["services"][0]
    assert service["lengthRef"]["source"].startswith(
        "Secondary-source operating mileage Start–End: 2.500 km;"
    )
    assert stage._length_measurement_note([{"source_class": "secondary"}]) == (
        "Secondary-source mileage breakdown agrees with raw N02 pair sum within 1.5 km."
    )


def test_handoff_marks_group_stale_when_only_a_mileage_csv_changes(
    tmp_path: Path,
) -> None:
    group_root = tmp_path / "metro"
    group_root.mkdir()
    refs_path = group_root / "length-refs.csv"
    components_path = group_root / "length-ref-components.csv"
    refs_path.write_text("service_id,km\nmetro-example,1.0\n", encoding="utf-8")
    components_path.write_text("service_id,km\nmetro-example,1.0\n", encoding="utf-8")
    recorded_hashes = stage._length_reference_hashes(group_root)
    gate_report = {"lengthReferenceHashes": recorded_hashes}
    verification = {"lengthReferenceHashes": recorded_hashes}

    refs_path.write_text("service_id,km\nmetro-example,1.1\n", encoding="utf-8")

    assert stage._length_reference_freshness_findings(
        "metro", group_root, gate_report, verification
    ) == [
        "metro: gate length reference CSV hashes are stale",
        "metro: audit length reference CSV hashes are stale",
    ]


def _copy_seed_inputs(root: Path) -> None:
    source = stage.ROOT
    for relative in ("data/overrides", "public/data"):
        shutil.copytree(historical_baseline(relative), root / relative)
    shutil.copytree(source / ".claude/docs/research", root / ".claude/docs/research")
    (root / ".claude/docs/plans").mkdir(parents=True)
    shutil.copy2(
        source / ".claude/docs/plans/tokyo-suburban-s0-freeze.json",
        root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json",
    )


def _platform_candidate(
    *,
    line: str,
    code: str,
    group: str,
    midpoint: tuple[float, float],
    operator: str = "Metro",
) -> PlatformCandidate:
    point = Point(midpoint)
    return PlatformCandidate(
        station_name="Example",
        n02_line=line,
        station_code=code,
        group_code=group,
        platform=LineString([(point.x - 1, point.y), (point.x + 1, point.y)]),
        midpoint=point,
        operator=operator,
    )


class _CandidateSource:
    def __init__(self, candidates: list[PlatformCandidate]) -> None:
        self.candidates = candidates

    def platform_candidates(
        self, match_names: list[str], lines: set[str]
    ) -> list[PlatformCandidate]:
        return [
            candidate
            for candidate in self.candidates
            if candidate.match_name in match_names and candidate.n02_line in lines
        ]
