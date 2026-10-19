"""Regressions for Keio and Odakyu S3 staging evidence."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point

from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline.build import filtered_network
from scripts.data_pipeline.constraints import (
    SectionFilter,
    parse_platform_selector,
)
from scripts.data_pipeline.n02 import N02SourceProvider, PlatformCandidate
from scripts.data_pipeline.override_loading import load_overrides
from scripts.data_pipeline.override_models import Stop, StopResolution
from scripts.data_pipeline.registry import normalize_station_name
from scripts.data_pipeline.routing import PairRoute, route_path
from tests.data_pipeline._local_inputs import requires_raw_n02

ROOT = Path(__file__).parents[2] / "data/staging/tokyo-suburban-nonjr/keio-odakyu"


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def _service_file(service_id: str, filename: str) -> Path:
    return next(ROOT.glob(f"components/**/services/{service_id}/{filename}"))


def _service_data(component_id: str) -> dict[str, object]:
    path = ROOT / "components" / component_id / "overrides/services.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _service_evidence(service_id: str) -> list[dict[str, str]]:
    return [
        row
        for row in _csv(ROOT / "pair-evidence.csv")
        if row["service_id"] == service_id
    ]


@requires_raw_n02()
def test_keio_shinjuku_hatsudai_pair_is_restricted_to_southern_new_line_sections() -> (
    None
):
    stops = _csv(_service_file("keio-main", "stops.csv"))
    section_rules = _csv(_service_file("keio-main", "sections.csv"))
    allowed = {
        "139.69791 35.68815~139.69932 35.68871#73bb9b54",
        "139.68862 35.68170~139.69791 35.68815#2e3327f6",
        "139.68792 35.68114~139.68862 35.68170#f8305d48",
    }
    scoped = [
        row
        for row in section_rules
        if row["from_id"] == "keio-shinjuku" and row["to_id"] == "keio-hatsudai"
    ]
    assert {row["section_key"] for row in scoped} == allowed
    assert all(row["action"] == "allow" for row in scoped)
    assert [(row["original_name"], row["n02_name"]) for row in stops[:2]] == [
        ("新宿", "新宿"),
        ("初台", "初台"),
    ]

    overrides = load_overrides(ROOT / "components/keio-dobutsuen/overrides")
    service = overrides.service("keio-main")
    source = N02SourceProvider(
        Path(__file__).parents[2] / "N02-25_GML/UTF-8",
        overrides.dataset.candidate_search_bbox,
    ).for_operator("京王電鉄")
    origin, destination = service.stops[:2]
    origin_resolution, origin_station = jr._stop_resolution(overrides, service, origin)
    destination_resolution, destination_station = jr._stop_resolution(
        overrides, service, destination
    )
    origins = jr._candidate_options(
        origin, origin_resolution, origin_station, source, {"京王線"}
    )
    destinations = jr._candidate_options(
        destination,
        destination_resolution,
        destination_station,
        source,
        {"京王線"},
    )
    assert len(origins) == 2
    assert len({(item.station_code, item.group_code) for item in origins}) == 1
    assert origins[0].station_code == origins[1].station_code == "003700"

    sections = source.track_sections(
        ["京王線"], [item.midpoint for item in (*origins, *destinations)]
    )["京王線"]
    network = filtered_network(
        sections,
        SectionFilter(allow=frozenset(allowed)),
        "keio-main 新宿→初台 京王新線 evidence",
    )
    routed = route_path([origins, destinations], [PairRoute(network)])
    southern_geometry = min(origins, key=lambda item: item.midpoint.y)
    assert routed.chosen[0].midpoint.coords[0] == southern_geometry.midpoint.coords[0]
    pair = next(
        row
        for row in _service_evidence("keio-main")
        if row["from_id"] == "keio-shinjuku" and row["to_id"] == "keio-hatsudai"
    )
    assert pair["n02_line"] == "京王線"
    assert pair["from_platform_code"] == "003700"
    assert pair["filter_recipe_sha256"]
    assert pair["status"] == "pass"


def test_keio_sasazuka_compatible_kanji_matches_the_frozen_station() -> None:
    sasazuka = next(
        row
        for row in _csv(_service_file("keio-main", "stops.csv"))
        if row["station_id"] == "keio-sasazuka"
    )
    assert normalize_station_name("笹塚") == normalize_station_name("笹塚")
    assert sasazuka["original_name"] == "笹塚"
    assert sasazuka["n02_name"] == "笹塚"
    evidence = next(
        row for row in _service_evidence("keio-main") if row["to_id"] == "keio-sasazuka"
    )
    assert evidence["to_platform_code"] == "003806"
    assert evidence["status"] == "pass"


@requires_raw_n02()
def test_shared_branch_stops_pin_the_raw_code_for_each_continuing_line() -> None:
    expected = {
        "keio-main": {
            "keio-shinjuku": ("京王線", "003700", "003700"),
            "keio-meidaimae": ("京王線", "003846", "003855"),
            "keio-chofu": ("京王線", "003966", "003966"),
            "keio-higashi-fuchu": ("京王線", "003850", "003850"),
            "keio-takahatafudo": ("京王線", "003904", "003904"),
            "keio-kitano": ("京王線", "004007", "004007"),
        },
        "keio-sagamihara": {"keio-chofu": ("相模原線", "003966", "003967")},
        "keio-takao": {"keio-kitano": ("高尾線", "004007", "004008")},
        "keio-keibajo": {"keio-higashi-fuchu": ("競馬場線", "003850", "003851")},
        "keio-dobutsuen": {"keio-takahatafudo": ("動物園線", "003904", "003905")},
        "keio-inokashira": {"keio-meidaimae": ("井の頭線", "003846", "003846")},
        "odakyu-odawara": {
            "odakyu-shin-yurigaoka": ("小田原線", "004227", "004227"),
            "odakyu-sagami-ono": ("小田原線", "004426", "004427"),
        },
        "odakyu-enoshima": {"odakyu-sagami-ono": ("江ノ島線", "004426", "004426")},
        "odakyu-tama": {"odakyu-shin-yurigaoka": ("多摩線", "004227", "004228")},
    }
    for service_id, stations in expected.items():
        overrides = load_overrides(_service_file(service_id, "stops.csv").parents[2])
        service = overrides.service(service_id)
        source = N02SourceProvider(
            Path(__file__).parents[2] / "N02-25_GML/UTF-8",
            overrides.dataset.candidate_search_bbox,
        ).for_operator(service.effective_n02_operator(overrides.dataset))
        for station_id, (line, group, code) in stations.items():
            stop = next(item for item in service.stops if item.station_id == station_id)
            selector = stop.platform_selector
            assert selector.lines == frozenset({line})
            assert selector.groups == frozenset({group})
            assert selector.codes == frozenset({code})
            assert stop.source_reason.startswith("Raw N02 confirms this ")

            resolution, registry_station = jr._stop_resolution(overrides, service, stop)
            candidates = jr._candidate_options(
                stop,
                resolution,
                registry_station,
                source,
                {line},
            )
            assert candidates
            assert all(
                (candidate.n02_line, candidate.group_code, candidate.station_code)
                == (line, group, code)
                for candidate in candidates
            )


def test_keio_branches_and_inokashira_keep_their_frozen_n02_lines() -> None:
    expected = {
        "keio-sagamihara": ("相模原線", 11),
        "keio-takao": ("高尾線", 6),
        "keio-keibajo": ("競馬場線", 1),
        "keio-dobutsuen": ("動物園線", 1),
        "keio-inokashira": ("井の頭線", 16),
    }
    for service_id, (line, pair_count) in expected.items():
        mappings = _csv(_service_file(service_id, "line_mapping.csv"))
        evidence = _service_evidence(service_id)
        assert len(mappings) == pair_count
        assert all(row["n02_line"] == line for row in mappings)
        assert all(not row["compose"] for row in mappings)
        assert len(evidence) == pair_count
        assert all(
            row["n02_line"] == line and row["status"] == "pass" for row in evidence
        )

    keio = _service_data("keio-dobutsuen")
    inokashira = next(row for row in keio["services"] if row["id"] == "keio-inokashira")
    assert inokashira["lineIds"] == ["keio-inokashira"]
    assert inokashira["n02Operator"] == "京王電鉄"


def test_odakyu_enoshima_passes_both_fujisawa_switchback_pairs_and_tama_stays_separate() -> (
    None
):
    evidence = _service_evidence("odakyu-enoshima")
    around_fujisawa = [
        row
        for row in evidence
        if (row["from_id"], row["to_id"])
        in {
            ("odakyu-fujisawa-hommachi", "odakyu-fujisawa"),
            ("odakyu-fujisawa", "odakyu-hon-kugenuma"),
        }
    ]
    assert [(row["from_id"], row["to_id"]) for row in around_fujisawa] == [
        ("odakyu-fujisawa-hommachi", "odakyu-fujisawa"),
        ("odakyu-fujisawa", "odakyu-hon-kugenuma"),
    ]
    assert all(row["n02_line"] == "江ノ島線" for row in around_fujisawa)
    assert all(row["status"] == "pass" for row in around_fujisawa)

    tama_mapping = _csv(_service_file("odakyu-tama", "line_mapping.csv"))
    tama_evidence = _service_evidence("odakyu-tama")
    assert len(tama_mapping) == 7
    assert all(row["n02_line"] == "多摩線" for row in tama_mapping)
    assert len(tama_evidence) == 7
    assert all(
        row["n02_line"] == "多摩線" and row["status"] == "pass" for row in tama_evidence
    )
    odakyu = _service_data("odakyu-enoshima")
    enoshima = next(row for row in odakyu["services"] if row["id"] == "odakyu-enoshima")
    assert enoshima["lineIds"] == ["odakyu-enoshima"]


def test_candidate_selection_rejects_the_wrong_line_and_operator() -> None:
    stop = Stop(
        order=0,
        station_id="keio-shinjuku",
        station_number="KO01",
        platform_selector=parse_platform_selector("line=京王線;code=003700"),
        original_name="新宿",
        n02_name="新宿",
        n02_operator="京王電鉄",
    )
    resolution = StopResolution("京王電鉄", "新宿", "新宿", False)
    geometry = LineString([(0, 0), (1, 1)])
    candidates = [
        PlatformCandidate(
            "新宿", "京王線", "003700", "003700", geometry, Point(0, 0), "京王電鉄"
        ),
        PlatformCandidate(
            "新宿", "井の頭線", "003700", "003700", geometry, Point(0, 0), "京王電鉄"
        ),
        PlatformCandidate(
            "新宿", "京王線", "003700", "003700", geometry, Point(0, 0), "小田急電鉄"
        ),
    ]
    source = SimpleNamespace(platform_candidates=lambda names, lines: candidates)

    options = jr._candidate_options(
        stop, resolution, SimpleNamespace(), source, {"京王線"}
    )

    assert [(item.operator, item.n02_line, item.station_code) for item in options] == [
        ("京王電鉄", "京王線", "003700")
    ]


def test_all_services_have_primary_length_breakdowns_and_measured_pairs() -> None:
    expected_lengths = {
        "keio-main": 37.9,
        "keio-sagamihara": 22.6,
        "keio-takao": 8.6,
        "keio-keibajo": 0.9,
        "keio-dobutsuen": 2.0,
        "keio-inokashira": 12.7,
        "odakyu-odawara": 82.5,
        "odakyu-enoshima": 27.4,
        "odakyu-tama": 10.6,
    }
    references = _csv(ROOT / "length-refs.csv")
    components = _csv(ROOT / "length-ref-components.csv")
    evidence = _csv(ROOT / "pair-evidence.csv")
    assert {row["service_id"] for row in references} == set(expected_lengths)
    assert len(components) == 11
    assert len(evidence) == 137
    assert all(row["status"] == "pass" for row in evidence)

    for service_id, expected_km in expected_lengths.items():
        reference = next(row for row in references if row["service_id"] == service_id)
        breakdown = [row for row in components if row["service_id"] == service_id]
        signed_km = sum(
            float(row["km"]) * (1 if row["operation"] == "+" else -1)
            for row in breakdown
        )
        assert float(reference["km"]) == expected_km
        assert round(signed_km, 3) == round(expected_km, 3)
        assert all(row["document"] and row["page_or_table"] for row in breakdown)
        assert float(reference["n02_pair_sum_km"])
        assert abs(float(reference["n02_pair_sum_km"]) - expected_km) <= 1.5

    service_files = list(ROOT.glob("components/*/overrides/services.json"))
    services = {
        row["id"]: row
        for path in service_files
        for row in json.loads(path.read_text(encoding="utf-8"))["services"]
    }
    assert set(services) == set(expected_lengths)
    assert all(
        services[service_id]["lengthRef"]["km"] == expected_km
        and services[service_id]["lengthRef"]["toleranceKm"] == 1.5
        for service_id, expected_km in expected_lengths.items()
    )


@requires_raw_n02()
def test_every_stop_selector_matches_its_measured_raw_n02_platform() -> None:
    measured: dict[str, dict[str, tuple[str, str]]] = {}
    for row in _csv(ROOT / "pair-evidence.csv"):
        service = measured.setdefault(row["service_id"], {})
        for prefix, station_id in (("from", row["from_id"]), ("to", row["to_id"])):
            value = (row[f"{prefix}_platform_code"], row[f"{prefix}_group_code"])
            assert service.setdefault(station_id, value) == value

    for component_id in ("keio-dobutsuen", "odakyu-enoshima"):
        override_dir = ROOT / "components" / component_id / "overrides"
        overrides = load_overrides(override_dir)
        source = N02SourceProvider(
            Path(__file__).parents[2] / "N02-25_GML/UTF-8",
            overrides.dataset.candidate_search_bbox,
        ).for_operator(overrides.dataset.n02_operator)
        for service in overrides.services:
            mapping = _csv(override_dir / "services" / service.id / "line_mapping.csv")
            lines = {row["n02_line"] for row in mapping}
            assert len(lines) == 1
            line = next(iter(lines))
            for stop in service.stops:
                selector = stop.platform_selector
                assert selector is not None
                assert selector.lines == {line}
                assert len(selector.groups) == len(selector.codes) == 1
                assert "pending" not in stop.source_reason.lower()
                expected_code, expected_group = measured[service.id][stop.station_id]
                assert selector.codes == {expected_code}
                assert selector.groups == {expected_group}

                resolution, registry_station = jr._stop_resolution(
                    overrides, service, stop
                )
                candidates = jr._candidate_options(
                    stop, resolution, registry_station, source, {line}
                )
                assert candidates
                assert all(
                    (item.station_code, item.group_code)
                    == (expected_code, expected_group)
                    for item in candidates
                )
