from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline.composition import (
    ComposeRecipe,
    check_recipe_anchors,
    flatten_recipe,
)
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.stage_suburban_assembly_shared import (
    PairEvidence,
    _normalize_length_component_rows,
    build_review_entries,
    copy_length_references,
)
from scripts.data_pipeline.topology import station_pairs
from tests.data_pipeline._local_inputs import requires_raw_n02


@pytest.fixture(scope="module")
def assembled_overrides(tmp_path_factory: pytest.TempPathFactory):
    output = tmp_path_factory.mktemp("s4-fukutoshin") / "assembled"
    assembly.assemble(out_dir=output)
    return load_overrides(output / "overrides")


def _pair(
    service_id: str,
    origin: str,
    destination: str,
    *,
    operator: str = "Operator",
    line: str = "Line",
    section_keys: tuple[str, ...] = (),
    plan_cases: tuple[str, ...] = (),
) -> PairEvidence:
    return PairEvidence(
        service_id=service_id,
        origin=origin,
        destination=destination,
        operators=(operator,),
        lines=((operator, line),),
        section_keys=section_keys,
        plan_cases=plan_cases,
    )


def test_build_review_entries_classifies_station_pair_section_and_boundary_candidates():
    pairs = [
        _pair("service-a", "alpha", "beta", section_keys=("section-1",)),
        _pair("service-b", "beta", "alpha", operator="Other", line="Other"),
        _pair("service-c", "gamma", "delta", section_keys=("section-2",)),
        _pair("service-d", "epsilon", "zeta", section_keys=("section-2",)),
        _pair("service-e", "theta", "iota"),
        _pair("service-f", "iota", "kappa", operator="Other", line="Other"),
    ]

    entries = build_review_entries(pairs)

    assert [entry["classification"] for entry in entries] == [
        "same-station-pair",
        "shared-source-sections",
        "boundary-connection",
    ]
    assert entries[0]["pairs"] == [
        {"serviceId": "service-a", "from": "alpha", "to": "beta"},
        {"serviceId": "service-b", "from": "beta", "to": "alpha"},
    ]
    assert entries[0]["sectionKeys"] == ["section-1"]
    assert entries[0]["decision"] == "keep-independent"
    assert entries[0]["reason"] == "distinct-n02-lines"
    assert entries[1]["sectionKeys"] == ["section-2"]
    assert entries[1]["decision"] == "needs-lead-review"
    assert entries[2]["connectionStationIds"] == ["iota"]
    assert entries[2]["decision"] == "keep-independent"
    assert entries[2]["reason"] == "transfer-boundary"


def test_fukutoshin_plan_case_is_compose_candidate_and_overlapping_pair_stays_open():
    entries = build_review_entries(
        [
            _pair(
                "metro-fukutoshin",
                "metro-wakoshi",
                "metro-chikatetsu-narimasu",
                plan_cases=("fukutoshin-wako-kotake",),
            ),
            _pair(
                "metro-yurakucho",
                "metro-wakoshi",
                "metro-chikatetsu-narimasu",
                plan_cases=("fukutoshin-wako-kotake",),
            ),
            _pair(
                "metro-fukutoshin",
                "metro-kanamecho",
                "ikebukuro",
            ),
            _pair(
                "metro-yurakucho",
                "metro-kanamecho",
                "ikebukuro",
            ),
            _pair(
                "tokyu-meguro",
                "tokyu-den-en-chofu",
                "tokyu-tamagawa",
                plan_cases=("tokyu-meguro-den-en-chofu-hiyoshi",),
            ),
            _pair(
                "tokyu-toyoko",
                "tokyu-den-en-chofu",
                "tokyu-tamagawa",
                plan_cases=("tokyu-meguro-den-en-chofu-hiyoshi",),
            ),
        ]
    )

    fukutoshin_entries = [
        entry
        for entry in entries
        if set(entry["services"]) == {"metro-fukutoshin", "metro-yurakucho"}
    ]
    tokyo_entries = [
        entry
        for entry in entries
        if set(entry["services"]) == {"tokyu-meguro", "tokyu-toyoko"}
    ]
    assert any(entry["decision"] == "compose-candidate" for entry in fukutoshin_entries)
    assert any(entry["decision"] == "needs-lead-review" for entry in fukutoshin_entries)
    assert all(entry["decision"] == "keep-independent" for entry in tokyo_entries)
    assert all(entry["reason"] == "n02-coverage-borrowing" for entry in tokyo_entries)


@pytest.mark.parametrize(
    ("first_service", "second_service", "expected_case", "expected_reason"),
    [
        (
            "jr-shonan-shinjuku",
            "jr-tokaido",
            "JR existing and S2-added shared routes",
            "inherited-jr-routing",
        ),
        (
            "tokyu-meguro",
            "tokyu-toyoko",
            "Tokyu Meguro Den-en-chofu–Hiyoshi",
            "n02-coverage-borrowing",
        ),
        (
            "tokyu-den-en-toshi",
            "tokyu-oimachi",
            "Oimachi Futako-tamagawa–Mizonokuchi",
            "n02-coverage-borrowing",
        ),
        (
            "metro-namboku",
            "toei-mita",
            "Namboku–Mita Meguro–Shirokane-takanawa",
            "plan-specified-independent",
        ),
        (
            "keisei-main",
            "keisei-narita-airport-access",
            "Keisei Main–Narita Airport Access airport pair",
            "plan-specified-independent",
        ),
        (
            "keisei-main",
            "hokuso-main",
            "Keisei–Hokuso connection",
            "plan-specified-independent",
        ),
    ],
)
def test_review_restores_plan_row_decision_and_case(
    first_service: str,
    second_service: str,
    expected_case: str,
    expected_reason: str,
):
    plan_cases = {
        "Tokyu Meguro Den-en-chofu–Hiyoshi": "tokyu-meguro-den-en-chofu-hiyoshi",
        "Oimachi Futako-tamagawa–Mizonokuchi": "tokyu-oimachi-futako-mizonokuchi",
        "Namboku–Mita Meguro–Shirokane-takanawa": "namboku-mita-meguro-shirokane",
        "Keisei Main–Narita Airport Access airport pair": "keisei-airport-pair",
        "Keisei–Hokuso connection": "keisei-hokuso-inba-connection",
    }
    case = plan_cases.get(expected_case)
    pair_cases = (case,) if case else ()
    entries = build_review_entries(
        [
            _pair(first_service, "alpha", "beta", plan_cases=pair_cases),
            _pair(second_service, "beta", "alpha", plan_cases=pair_cases),
        ]
    )

    assert len(entries) == 1
    assert entries[0]["decision"] == "keep-independent"
    assert entries[0]["reason"] == expected_reason
    assert entries[0]["planCase"] == expected_case


def test_review_precedence_keeps_fukutoshin_composition_ahead_of_other_rules():
    entries = build_review_entries(
        [
            _pair(
                "metro-fukutoshin",
                "metro-wakoshi",
                "metro-chikatetsu-narimasu",
                operator="東京地下鉄",
                line="8号線有楽町線",
                plan_cases=("fukutoshin-wako-kotake",),
            ),
            _pair(
                "metro-yurakucho",
                "metro-wakoshi",
                "metro-chikatetsu-narimasu",
                operator="東京地下鉄",
                line="8号線有楽町線",
                plan_cases=("fukutoshin-wako-kotake",),
            ),
        ]
    )

    assert entries[0]["decision"] == "compose-candidate"
    assert entries[0]["planCase"] == "Fukutoshin Wako-shi–Kotake-Mukaihara"
    assert entries[0]["reason"] == "composition-required"


def test_jr_inherited_rule_precedes_adjustment_nine_distinct_line_rule():
    entries = build_review_entries(
        [
            _pair("jr-yamanote", "alpha", "beta", line="Yamanote"),
            _pair("jr-keihin-tohoku", "beta", "alpha", line="Keihin-Tohoku"),
        ]
    )

    assert entries[0]["decision"] == "keep-independent"
    assert entries[0]["planCase"] == "JR existing and S2-added shared routes"
    assert entries[0]["reason"] == "inherited-jr-routing"


def test_tokyu_plan_decision_precedes_adjustment_nine_distinct_line_rule():
    entries = build_review_entries(
        [
            _pair(
                "tokyu-meguro",
                "alpha",
                "beta",
                operator="Tokyu",
                line="Meguro",
                plan_cases=("tokyu-meguro-den-en-chofu-hiyoshi",),
            ),
            _pair(
                "tokyu-toyoko",
                "beta",
                "alpha",
                operator="Tokyu",
                line="Toyoko",
                plan_cases=("tokyu-meguro-den-en-chofu-hiyoshi",),
            ),
        ]
    )

    assert entries[0]["decision"] == "keep-independent"
    assert entries[0]["reason"] == "n02-coverage-borrowing"
    assert entries[0]["planCase"] == "Tokyu Meguro Den-en-chofu–Hiyoshi"


def test_yokohama_blue_line_transition_at_kannai_is_listed_as_independent_boundary():
    entries = build_review_entries(
        [
            PairEvidence(
                service_id="yokohama-blue",
                origin="yokohama-isezakichojamachi",
                destination="kannai",
                operators=("Yokohama City",),
                lines=(("Yokohama City", "1号線"),),
                section_keys=(),
            ),
            PairEvidence(
                service_id="yokohama-blue",
                origin="kannai",
                destination="yokohama-sakuragicho",
                operators=("Yokohama City",),
                lines=(("Yokohama City", "3号線"),),
                section_keys=(),
            ),
        ]
    )

    assert len(entries) == 1
    assert entries[0]["classification"] == "boundary-connection"
    assert entries[0]["services"] == ["yokohama-blue"]
    assert entries[0]["decision"] == "keep-independent"
    assert entries[0]["planCase"] == "Yokohama Blue Kannai boundary"
    assert entries[0]["reason"] == "transfer-boundary"


def test_same_station_pair_with_overlapping_n02_line_sets_stays_open():
    entries = build_review_entries(
        [
            _pair("service-a", "alpha", "beta", operator="Shared", line="L1"),
            _pair("service-b", "beta", "alpha", operator="Shared", line="L1"),
        ]
    )

    assert len(entries) == 1
    assert entries[0]["classification"] == "same-station-pair"
    assert entries[0]["decision"] == "needs-lead-review"


def test_length_component_normalization_changes_only_signed_airport_source_ranges():
    rows = [
        {
            "service_id": "keisei-narita-airport-access",
            "from": "印旛日本医大",
            "to": "成田空港",
            "km": "51.4",
            "operation": "+",
        },
        {
            "service_id": "keisei-narita-airport-access",
            "from": "京成高砂",
            "to": "成田空港",
            "km": "32.3",
            "operation": "-",
        },
        {
            "service_id": "other-service",
            "from": "A",
            "to": "B",
            "km": "1.0",
            "operation": "+",
        },
    ]

    normalized = _normalize_length_component_rows(rows)

    assert [(row["from"], row["to"]) for row in normalized] == [
        ("京成高砂", "成田空港"),
        ("京成高砂", "印旛日本医大"),
        ("A", "B"),
    ]
    assert rows[0]["from"] == "印旛日本医大"


def test_copy_length_references_allows_minimal_assembly_fixtures(
    tmp_path: Path,
) -> None:
    copy_length_references(tmp_path, tmp_path / "assembled")

    assert not (tmp_path / "assembled").exists()


def test_parallel_classification_is_reserved_for_explicit_source_evidence():
    entries = build_review_entries(
        [
            _pair("service-a", "alpha", "beta", section_keys=("section-1",)),
            _pair("service-b", "gamma", "delta", section_keys=("section-2",)),
        ]
    )

    assert entries == []


def test_review_entry_pair_facts_are_stably_ordered():
    entries = build_review_entries(
        [
            _pair("service-z", "alpha", "beta"),
            _pair("service-a", "alpha", "beta"),
        ]
    )

    assert entries[0]["services"] == ["service-a", "service-z"]
    assert entries[0]["pairs"][0]["serviceId"] == "service-a"


@requires_raw_n02()
def test_fukutoshin_pair_composition_has_exact_reverse_owner_anchors(
    assembled_overrides,
):
    consumer = assembled_overrides.service("metro-fukutoshin")
    pairs = station_pairs(list(consumer.station_ids), consumer.circular)
    pair_index = pairs.index(("metro-wakoshi", "metro-chikatetsu-narimasu"))
    recipe = consumer.segment_ranges()[pair_index].compose

    assert recipe is not None
    assert len(recipe.legs) == 1
    leg = recipe.legs[0]
    assert (leg.source_service, leg.from_id, leg.to_id) == (
        "metro-yurakucho",
        "metro-wakoshi",
        "metro-chikatetsu-narimasu",
    )
    reversed_recipe = ComposeRecipe(
        tuple(
            replace(item, from_id=item.to_id, to_id=item.from_id)
            for item in recipe.legs
        )
    )
    reverse_primitives = flatten_recipe(assembled_overrides, reversed_recipe, consumer)

    assert reverse_primitives == (
        ("metro-yurakucho", "metro-wakoshi", "metro-chikatetsu-narimasu", True),
    )
    check_recipe_anchors(
        "metro-chikatetsu-narimasu", "metro-wakoshi", reverse_primitives
    )


@requires_raw_n02()
def test_fukutoshin_composition_stops_at_kotake_and_checks_both_pins(
    assembled_overrides,
):
    consumer = assembled_overrides.service("metro-fukutoshin")
    owner = assembled_overrides.service("metro-yurakucho")
    pairs = station_pairs(list(consumer.station_ids), consumer.circular)
    ranges = consumer.segment_ranges()

    assert len(pairs) >= 6
    assert all(item.compose is not None for item in ranges[:5])
    assert pairs[4][1] == "metro-kotake-mukaihara"
    assert pairs[5] == ("metro-kotake-mukaihara", "metro-senkawa")
    assert ranges[5].compose is None
    assert ranges[5].route_lines == ("13号線副都心線",)

    consumer_stop = consumer.stops[5]
    owner_stop = owner.stops[5]
    assert consumer_stop.platform_selector.codes == {"003294"}
    assert owner_stop.platform_selector.codes == {"003295"}
    assert (
        consumer_stop.platform_selector.groups
        == owner_stop.platform_selector.groups
        == {"003294"}
    )
    source = N02SourceProvider(
        assembly.ROOT / "N02-25_GML/UTF-8",
        assembled_overrides.dataset.candidate_search_bbox,
    ).for_operator("東京地下鉄")
    coordinates = []
    for _service, stop in ((consumer, consumer_stop), (owner, owner_stop)):
        candidates = source.platform_candidates(
            [stop.n02_name], stop.platform_selector.lines
        )
        matching = [
            candidate
            for candidate in candidates
            if stop.platform_selector.matches(candidate)
        ]
        assert len(matching) == 1
        coordinates.append(tuple(matching[0].midpoint.coords[0]))

    assert coordinates[0] == coordinates[1]


@pytest.mark.parametrize(
    ("fault", "message"),
    [
        ("operator", "N02 operator differs"),
        ("line", "N02 lines differ"),
        ("filter", "section filter differs"),
    ],
)
@requires_raw_n02()
def test_fukutoshin_composition_rejects_other_owner_operator_line_or_filter(
    assembled_overrides, fault: str, message: str
):
    consumer = assembled_overrides.service("metro-fukutoshin")
    owner = assembled_overrides.service("metro-yurakucho")
    pair_index = station_pairs(list(consumer.station_ids), consumer.circular).index(
        ("metro-wakoshi", "metro-chikatetsu-narimasu")
    )
    recipe = consumer.segment_ranges()[pair_index].compose
    assert recipe is not None
    if fault == "operator":
        bad_owner = replace(
            owner, definition=replace(owner.definition, n02_operator="Other operator")
        )
    elif fault == "line":
        ranges = list(owner.line_ranges)
        ranges[pair_index] = replace(ranges[pair_index], n02_line="Other line")
        bad_owner = replace(owner, line_ranges=tuple(ranges))
    else:
        bad_owner = replace(
            owner,
            section_filters={
                ("東京地下鉄", "8号線有楽町線"): SectionFilter(
                    allow=frozenset({"other-section"})
                )
            },
        )
    bad_overrides = replace(
        assembled_overrides,
        services=tuple(
            bad_owner if service.id == owner.id else service
            for service in assembled_overrides.services
        ),
    )

    with pytest.raises(OverrideError, match=message):
        flatten_recipe(bad_overrides, recipe, consumer)
