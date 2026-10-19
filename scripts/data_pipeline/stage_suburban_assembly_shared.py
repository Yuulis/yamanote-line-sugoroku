"""Build the S4 shared-track candidate review from assembled route evidence."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts.data_pipeline.composition import check_recipe_anchors, flatten_recipe
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.override_models import ServiceOverrides
from scripts.data_pipeline.override_parsing import (
    parse_dataset,
    parse_line_ranges,
    parse_scoped_section_filters,
    parse_service_definition,
    parse_stops,
)
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_assembly import (
    ASSEMBLED_PATH,
    ROOT,
    _load_frozen_catalog,
    _oracle,
)
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    read_csv,
    read_json,
    write_csv,
    write_json,
)
from scripts.data_pipeline.topology import station_pairs

CLASSIFICATION_ORDER = (
    "same-station-pair",
    "shared-source-sections",
    "boundary-connection",
)
PLAN_CORRIDORS = {
    "fukutoshin-wako-kotake": (
        {"metro-fukutoshin", "metro-yurakucho"},
        "metro-wakoshi",
        "metro-kotake-mukaihara",
    ),
    "tokyu-meguro-den-en-chofu-hiyoshi": (
        {"tokyu-meguro", "tokyu-toyoko"},
        "tokyu-den-en-chofu",
        "tokyu-hiyoshi",
    ),
    "tokyu-oimachi-futako-mizonokuchi": (
        {"tokyu-oimachi", "tokyu-den-en-toshi"},
        "tokyu-futako-tamagawa",
        "musashi-mizonokuchi",
    ),
    "namboku-mita-meguro-shirokane": (
        {"metro-namboku", "toei-mita"},
        "meguro",
        "metro-shirokane-takanawa",
    ),
}
FUKUTOSHIN_OWNER = "metro-yurakucho"
FUKUTOSHIN_CONSUMER = "metro-fukutoshin"
TOKYO_METRO_OPERATOR = "東京地下鉄"
YURAKUCHO_LINE = "8号線有楽町線"
KOTAKE_MUKAIHARA = "metro-kotake-mukaihara"
FUKUTOSHIN_SHARED_STOPS = (
    "metro-wakoshi",
    "metro-chikatetsu-narimasu",
    "metro-chikatetsu-akatsuka",
    "metro-heiwadai",
    "metro-hikawadai",
    KOTAKE_MUKAIHARA,
)


@dataclass(frozen=True)
class PairEvidence:
    """One converted route pair and its exact staged N02 section evidence."""

    service_id: str
    origin: str
    destination: str
    operators: tuple[str, ...]
    lines: tuple[tuple[str, str], ...]
    section_keys: tuple[str, ...]
    plan_cases: tuple[str, ...] = ()
    composed_owner: str = ""


def _pair_row(pair: PairEvidence) -> dict[str, str]:
    return {
        "serviceId": pair.service_id,
        "from": pair.origin,
        "to": pair.destination,
    }


def _pair_key(pair: PairEvidence) -> tuple[str, str]:
    ordered = sorted((pair.origin, pair.destination))
    return ordered[0], ordered[1]


def _relation(
    first: PairEvidence, second: PairEvidence
) -> tuple[str, tuple[str, ...]] | None:
    if first.service_id == second.service_id:
        shared_stations = tuple(
            sorted(
                {first.origin, first.destination} & {second.origin, second.destination}
            )
        )
        if shared_stations and first.lines != second.lines:
            return "boundary-connection", shared_stations
        return None
    if _pair_key(first) == _pair_key(second):
        return "same-station-pair", _pair_key(first)
    shared_sections = tuple(sorted(set(first.section_keys) & set(second.section_keys)))
    if shared_sections:
        return "shared-source-sections", shared_sections
    shared_stations = tuple(
        sorted({first.origin, first.destination} & {second.origin, second.destination})
    )
    if shared_stations:
        return "boundary-connection", shared_stations
    return None


def _candidate_key(
    classification: str,
    first: PairEvidence,
    second: PairEvidence,
    relation_keys: tuple[str, ...],
) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
    ordered_services = tuple(sorted({first.service_id, second.service_id}))
    return (
        classification,
        ordered_services,
        relation_keys,
    )


def _review_decision(
    classification: str,
    first: PairEvidence,
    second: PairEvidence,
    service_ids: tuple[str, ...],
    shared_plan_cases: set[str],
) -> tuple[str, str, str]:
    """Apply the lead's closed set of shared-track review outcomes."""
    if (
        set(service_ids) == {FUKUTOSHIN_CONSUMER, FUKUTOSHIN_OWNER}
        and classification == "same-station-pair"
        and "fukutoshin-wako-kotake" in shared_plan_cases
    ):
        consumer_pair = next(
            pair for pair in (first, second) if pair.service_id == FUKUTOSHIN_CONSUMER
        )
        if consumer_pair.composed_owner == FUKUTOSHIN_OWNER:
            return (
                "composed",
                "Fukutoshin Wako-shi–Kotake-Mukaihara",
                "shared-track-composed",
            )
        return (
            "compose-candidate",
            "Fukutoshin Wako-shi–Kotake-Mukaihara",
            "composition-required",
        )

    plan_decisions = {
        "tokyu-meguro-den-en-chofu-hiyoshi": (
            {"tokyu-meguro", "tokyu-toyoko"},
            "Tokyu Meguro Den-en-chofu–Hiyoshi",
            "n02-coverage-borrowing",
        ),
        "tokyu-oimachi-futako-mizonokuchi": (
            {"tokyu-oimachi", "tokyu-den-en-toshi"},
            "Oimachi Futako-tamagawa–Mizonokuchi",
            "n02-coverage-borrowing",
        ),
        "namboku-mita-meguro-shirokane": (
            {"metro-namboku", "toei-mita"},
            "Namboku–Mita Meguro–Shirokane-takanawa",
            "plan-specified-independent",
        ),
        "keisei-airport-pair": (
            {"keisei-main", "keisei-narita-airport-access"},
            "Keisei Main–Narita Airport Access airport pair",
            "plan-specified-independent",
        ),
        "keisei-hokuso-inba-connection": (
            {"keisei-main", "hokuso-main"},
            "Keisei–Hokuso connection",
            "plan-specified-independent",
        ),
    }
    for case, (case_services, plan_label, reason) in plan_decisions.items():
        if set(service_ids) == case_services and case in shared_plan_cases:
            return "keep-independent", plan_label, reason

    if all(service_id.startswith("jr-") for service_id in service_ids):
        return (
            "keep-independent",
            "JR existing and S2-added shared routes",
            "inherited-jr-routing",
        )

    if classification == "boundary-connection":
        plan_case = (
            "Yokohama Blue Kannai boundary"
            if "yokohama-blue" in service_ids
            and "kannai"
            in {first.origin, first.destination, second.origin, second.destination}
            else ""
        )
        return "keep-independent", plan_case, "transfer-boundary"

    if classification != "same-station-pair":
        return "needs-lead-review", "", "unresolved-candidate"

    if set(first.lines).isdisjoint(second.lines):
        return "keep-independent", "", "distinct-n02-lines"
    return "needs-lead-review", "", "unresolved-candidate"


def _normalize_length_component_rows(
    rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Normalize the signed source range endpoints in the A-only copy."""
    expected = {
        ("+", "51.4"): (
            "印旛日本医大",
            "成田空港",
            "京成高砂",
            "成田空港",
        ),
        ("-", "32.3"): (
            "京成高砂",
            "成田空港",
            "京成高砂",
            "印旛日本医大",
        ),
    }
    seen: set[tuple[str, str]] = set()
    normalized: list[dict[str, str]] = []
    for row in rows:
        copied = dict(row)
        if copied.get("service_id") == "keisei-narita-airport-access":
            key = copied.get("operation", ""), copied.get("km", "")
            if key in expected:
                if key in seen:
                    raise StageError(
                        f"duplicate Narita Airport mileage component: {key}"
                    )
                seen.add(key)
                old_from, old_to, new_from, new_to = expected[key]
                if (copied.get("from"), copied.get("to")) not in {
                    (old_from, old_to),
                    (new_from, new_to),
                }:
                    raise StageError(
                        "unexpected Narita Airport source range endpoints for "
                        f"{key}: {copied.get('from')} -> {copied.get('to')}"
                    )
                copied["from"] = new_from
                copied["to"] = new_to
        normalized.append(copied)
    if seen != set(expected):
        raise StageError(
            "Narita Airport mileage components are incomplete: "
            f"missing={sorted(set(expected) - seen)}"
        )
    return normalized


def copy_length_references(root: Path, destination: Path) -> None:
    """Merge frozen S2/S3 mileage references and normalize A's signed ranges."""
    source_roots = [root / "data/staging/tokyo-suburban-jr/combined"]
    nonjr_root = root / "data/staging/tokyo-suburban-nonjr"
    if nonjr_root.is_dir():
        source_roots.extend(
            path for path in sorted(nonjr_root.iterdir()) if path.is_dir()
        )
    if not any(
        (source_root / "length-refs.csv").is_file() for source_root in source_roots
    ):
        return
    reference_fields: list[str] | None = None
    reference_rows: list[dict[str, str]] = []
    service_ids: set[str] = set()
    component_fields: list[str] | None = None
    component_rows: list[dict[str, str]] = []
    for source_root in source_roots:
        path = source_root / "length-refs.csv"
        if not path.is_file():
            raise StageError(f"length reference file is missing: {path}")
        fields, rows = read_csv(path)
        if reference_fields is None:
            reference_fields = fields
        elif fields != reference_fields:
            raise StageError(f"length reference schema differs: {path}")
        for row in rows:
            service_id = row.get("service_id", "")
            if not service_id or service_id in service_ids:
                raise StageError(
                    f"duplicate or empty length reference service: {service_id}"
                )
            service_ids.add(service_id)
            reference_rows.append(row)
        component_path = source_root / "length-ref-components.csv"
        if component_path.is_file():
            fields, rows = read_csv(component_path)
            if component_fields is None:
                component_fields = fields
            elif fields != component_fields:
                raise StageError(f"length component schema differs: {component_path}")
            component_rows.extend(rows)
    if reference_fields is None or component_fields is None:
        raise StageError("staged mileage references are incomplete")
    write_csv(destination / "length-refs.csv", reference_fields, reference_rows)
    write_csv(
        destination / "length-ref-components.csv",
        component_fields,
        _normalize_length_component_rows(component_rows),
    )


def _pinned_platform_coordinate(
    source: Any, service: ServiceOverrides, stop_index: int
) -> tuple[float, float]:
    stop = service.stops[stop_index]
    selector = stop.platform_selector
    if (
        len(selector.lines) != 1
        or len(selector.groups) != 1
        or len(selector.codes) != 1
    ):
        raise StageError(
            f"Fukutoshin shared-track anchor is not exactly pinned: {service.id}/{stop.station_id}"
        )
    operator = stop.n02_operator or service.definition.n02_operator
    if operator != TOKYO_METRO_OPERATOR:
        raise StageError(
            f"Fukutoshin shared-track anchor uses another N02 operator: {service.id}/{stop.station_id}"
        )
    candidates = source.platform_candidates([stop.n02_name], selector.lines)
    coordinates = {
        tuple(candidate.midpoint.coords[0])
        for candidate in candidates
        if selector.matches(candidate)
    }
    if len(coordinates) != 1:
        raise StageError(
            "Fukutoshin shared-track selector must resolve to exactly one anchor: "
            f"{service.id}/{stop.station_id}/{sorted(selector.codes)}"
        )
    coordinate = next(iter(coordinates))
    return float(coordinate[0]), float(coordinate[1])


def apply_fukutoshin_composition(root: Path, overrides_dir: Path) -> dict[str, Any]:
    """Compose the five frozen Fukutoshin pairs from exact Yurakucho owner routes."""
    if not overrides_dir.is_absolute():
        overrides_dir = root / overrides_dir
    overrides_dir = overrides_dir.resolve()
    service_ids = {
        row["id"] for row in read_json(overrides_dir / "services.json")["services"]
    }
    required_services = {FUKUTOSHIN_CONSUMER, FUKUTOSHIN_OWNER}
    if not service_ids & required_services:
        return {
            "status": "not-applicable",
            "consumerServiceId": FUKUTOSHIN_CONSUMER,
            "ownerServiceId": FUKUTOSHIN_OWNER,
            "pairs": [],
            "anchorChecks": [],
        }
    if not required_services <= service_ids:
        raise StageError("Fukutoshin shared-track owner or consumer is missing")
    overrides = load_overrides(overrides_dir)
    consumer = overrides.service(FUKUTOSHIN_CONSUMER)
    owner = overrides.service(FUKUTOSHIN_OWNER)
    if len(consumer.station_ids) <= 5:
        raise StageError("Fukutoshin shared-track route has fewer than six anchors")
    expected_pairs = tuple(
        zip(
            FUKUTOSHIN_SHARED_STOPS[:-1],
            FUKUTOSHIN_SHARED_STOPS[1:],
            strict=True,
        )
    )
    if consumer.station_ids[:6] != FUKUTOSHIN_SHARED_STOPS:
        raise StageError(
            "Fukutoshin exact shared-track route anchors differ from freeze"
        )
    if owner.station_ids[:6] != consumer.station_ids[:6]:
        raise StageError("Fukutoshin and Yurakucho exact route anchors differ")
    if (
        consumer.effective_n02_operator(overrides.dataset) != TOKYO_METRO_OPERATOR
        or owner.effective_n02_operator(overrides.dataset) != TOKYO_METRO_OPERATOR
    ):
        raise StageError("Fukutoshin shared-track owners must use Tokyo Metro N02")

    source_provider = N02SourceProvider(
        root / "N02-25_GML/UTF-8", overrides.dataset.candidate_search_bbox
    )
    source = source_provider.for_operator(TOKYO_METRO_OPERATOR)
    anchor_checks: list[dict[str, Any]] = []
    for stop_index, station_id in enumerate(consumer.station_ids[:6]):
        if owner.station_ids[stop_index] != station_id:
            raise StageError(f"Fukutoshin shared station order differs: {station_id}")
        consumer_stop = consumer.stops[stop_index]
        owner_stop = owner.stops[stop_index]
        if (
            consumer_stop.platform_selector.groups
            != owner_stop.platform_selector.groups
        ):
            raise StageError(f"Fukutoshin platform groups differ at {station_id}")
        consumer_point = _pinned_platform_coordinate(source, consumer, stop_index)
        owner_point = _pinned_platform_coordinate(source, owner, stop_index)
        if consumer_point != owner_point:
            raise StageError(
                f"Fukutoshin consumer and owner platform anchors differ at {station_id}: "
                f"{consumer_point} != {owner_point}"
            )
        anchor_checks.append(
            {
                "stationId": station_id,
                "consumerCode": sorted(consumer_stop.platform_selector.codes)[0],
                "ownerCode": sorted(owner_stop.platform_selector.codes)[0],
                "groupCode": sorted(owner_stop.platform_selector.groups)[0],
                "metricCoordinate": list(consumer_point),
            }
        )
    kotake_check = next(
        check for check in anchor_checks if check["stationId"] == KOTAKE_MUKAIHARA
    )
    if (kotake_check["consumerCode"], kotake_check["ownerCode"]) != (
        "003294",
        "003295",
    ) or kotake_check["groupCode"] != "003294":
        raise StageError(
            "Fukutoshin Kotake-Mukaihara selectors differ from the frozen shared-anchor pins"
        )

    consumer_pairs = station_pairs(list(consumer.station_ids), consumer.circular)
    owner_pairs = station_pairs(list(owner.station_ids), owner.circular)
    consumer_ranges = list(consumer.segment_ranges())
    owner_ranges = list(owner.segment_ranges())
    line_mapping_path = (
        overrides_dir / "services" / FUKUTOSHIN_CONSUMER / "line_mapping.csv"
    )
    line_fields, line_rows = read_csv(line_mapping_path)
    for origin, destination in expected_pairs:
        pair_index = consumer_pairs.index((origin, destination))
        owner_index = owner_pairs.index((origin, destination))
        consumer_range = consumer_ranges[pair_index]
        owner_range = owner_ranges[owner_index]
        for service_id, item, service in (
            (FUKUTOSHIN_CONSUMER, consumer_range, consumer),
            (FUKUTOSHIN_OWNER, owner_range, owner),
        ):
            if (
                item.route_lines != (YURAKUCHO_LINE,)
                or item.route is not None
                or item.compose is not None
                or item.via
                or service.range_operators(item, overrides.dataset)
                != (TOKYO_METRO_OPERATOR,)
            ):
                raise StageError(
                    f"Fukutoshin shared pair is not an exact Tokyo Metro owner route: "
                    f"{service_id}:{origin}->{destination}"
                )
        owner_filter = owner.section_filter_for_pair(
            YURAKUCHO_LINE, TOKYO_METRO_OPERATOR, origin, destination
        )
        consumer_filter = consumer.section_filter_for_pair(
            YURAKUCHO_LINE, TOKYO_METRO_OPERATOR, origin, destination
        )
        if owner_filter != SectionFilter() or consumer_filter != owner_filter:
            raise StageError(
                f"Fukutoshin shared pair has a non-identical section filter: {origin}->{destination}"
            )
        matching_rows = [
            row
            for row in line_rows
            if row.get("from_id") == origin and row.get("to_id") == destination
        ]
        if len(matching_rows) != 1:
            raise StageError(
                f"Fukutoshin consumer mapping must contain one exact pair: {origin}->{destination}"
            )
        recipe = {
            "legs": [
                {
                    "source_service": FUKUTOSHIN_OWNER,
                    "from": origin,
                    "to": destination,
                }
            ],
            "shared_track_evidence": [
                {
                    "lines": [YURAKUCHO_LINE],
                    "allow": [],
                    "deny": [],
                    "reason": "Shared Tokyo Metro physical track; pair, operator, N02 line, filter, and platform anchors are pinned to the Yurakucho owner route.",
                    "n02Operator": TOKYO_METRO_OPERATOR,
                }
            ],
        }
        matching_rows[0]["n02_line"] = ""
        matching_rows[0]["via"] = ""
        matching_rows[0]["route"] = ""
        matching_rows[0]["compose"] = json.dumps(
            recipe, ensure_ascii=False, separators=(",", ":")
        )
    write_csv(line_mapping_path, line_fields, line_rows)

    composed = load_overrides(overrides_dir)
    composed_consumer = composed.service(FUKUTOSHIN_CONSUMER)
    for origin, destination in expected_pairs:
        pair_index = station_pairs(
            list(composed_consumer.station_ids), composed_consumer.circular
        ).index((origin, destination))
        item = composed_consumer.segment_ranges()[pair_index]
        if item.compose is None:
            raise StageError(
                f"Fukutoshin pair was not composed: {origin}->{destination}"
            )
        primitives = flatten_recipe(composed, item.compose, composed_consumer)
        check_recipe_anchors(origin, destination, primitives)
        if primitives != ((FUKUTOSHIN_OWNER, origin, destination, False),):
            raise StageError(
                f"Fukutoshin pair does not resolve to its exact owner anchor: {origin}->{destination}"
            )
    return {
        "consumerServiceId": FUKUTOSHIN_CONSUMER,
        "ownerServiceId": FUKUTOSHIN_OWNER,
        "pairs": [
            {"from": origin, "to": destination}
            for origin, destination in expected_pairs
        ],
        "anchorChecks": anchor_checks,
    }


def build_review_entries(pairs: list[PairEvidence]) -> list[dict[str, Any]]:
    """Group pair-level exact identity, source-section, and boundary evidence."""
    grouped: dict[
        tuple[str, tuple[str, ...], tuple[str, ...]],
        dict[str, Any],
    ] = {}
    ordered_pairs = sorted(
        pairs,
        key=lambda pair: (
            pair.service_id,
            pair.origin,
            pair.destination,
            pair.operators,
            pair.lines,
            pair.section_keys,
        ),
    )
    for index, first in enumerate(ordered_pairs):
        for second in ordered_pairs[index + 1 :]:
            matched = _relation(first, second)
            if matched is None:
                continue
            classification, relation_keys = matched
            service_ids = tuple(sorted({first.service_id, second.service_id}))
            key = _candidate_key(classification, first, second, relation_keys)
            entry = grouped.setdefault(
                key,
                {
                    "classification": classification,
                    "services": list(service_ids),
                    "pairs": {},
                    "operators": set(),
                    "lines": set(),
                    "sectionKeys": set(),
                    "connectionStationIds": set(),
                    "pairEvidence": {},
                },
            )
            for pair in (first, second):
                entry["pairs"][
                    _pair_row(pair)["serviceId"], pair.origin, pair.destination
                ] = _pair_row(pair)
                entry["pairEvidence"][
                    pair.service_id, pair.origin, pair.destination
                ] = pair
                entry["operators"].update(pair.operators)
                entry["lines"].update(pair.lines)
                entry["sectionKeys"].update(pair.section_keys)
            if classification == "shared-source-sections":
                entry["sectionKeys"].update(relation_keys)
            if classification == "boundary-connection":
                entry["connectionStationIds"].update(relation_keys)
            pair_plan_cases = set(first.plan_cases) & set(second.plan_cases)
            if "pairPlanCases" not in entry:
                entry["pairPlanCases"] = pair_plan_cases
            else:
                entry["pairPlanCases"].intersection_update(pair_plan_cases)

    entries: list[dict[str, Any]] = []
    for key, value in sorted(
        grouped.items(),
        key=lambda item: (
            CLASSIFICATION_ORDER.index(item[0][0]),
            item[0][1],
            item[0][2],
        ),
    ):
        classification, service_ids, relation_keys = key
        pair_values = sorted(
            value["pairEvidence"].values(),
            key=lambda pair: (pair.service_id, pair.origin, pair.destination),
        )
        decision, plan_case, reason = _review_decision(
            classification,
            pair_values[0],
            pair_values[-1],
            service_ids,
            value["pairPlanCases"],
        )
        candidate: dict[str, Any] = {
            "classification": classification,
            "services": list(service_ids),
            "pairs": sorted(
                value["pairs"].values(),
                key=lambda pair: (pair["serviceId"], pair["from"], pair["to"]),
            ),
            "operators": sorted(value["operators"]),
            "lines": [
                {"operator": operator, "line": line}
                for operator, line in sorted(value["lines"])
            ],
            "sectionKeys": sorted(value["sectionKeys"]),
            "decision": decision,
            "reason": reason,
        }
        if classification == "boundary-connection":
            candidate["connectionStationIds"] = sorted(value["connectionStationIds"])
        if plan_case:
            candidate["planCase"] = plan_case
        entries.append(candidate)
    for index, entry in enumerate(entries, start=1):
        entry["candidateId"] = f"candidate-{index:04d}"
    return entries


def _pair_evidence(overrides_dir: Path) -> list[PairEvidence]:
    dataset = parse_dataset(read_json(overrides_dir / "dataset.json"))
    service_envelope = read_json(overrides_dir / "services.json")
    definitions = [
        parse_service_definition(row) for row in service_envelope["services"]
    ]
    result: list[PairEvidence] = []
    for definition in definitions:
        service_id = definition.id
        service_dir = overrides_dir / "services" / service_id
        _, stop_rows = read_csv(service_dir / "stops.csv")
        stops = parse_stops(stop_rows, service_id)
        _, range_rows = read_csv(service_dir / "line_mapping.csv")
        line_ranges = parse_line_ranges(
            range_rows, service_id, dataset.candidate_search_bbox
        )
        section_path = service_dir / "sections.csv"
        section_rows = read_csv(section_path)[1] if section_path.is_file() else []
        section_filters, scoped_section_filters = parse_scoped_section_filters(
            section_rows,
            service_id,
            definition.n02_operator or dataset.n02_operator,
        )
        service = ServiceOverrides(
            definition=definition,
            stops=stops,
            line_ranges=line_ranges,
            section_filters=section_filters,
            scoped_section_filters=scoped_section_filters,
        )
        pairs = station_pairs(list(service.station_ids), service.circular)
        ranges = service.segment_ranges()
        route_ids = list(service.station_ids)
        pair_plan_cases: dict[int, set[str]] = defaultdict(set)
        for case, (case_services, start_id, end_id) in PLAN_CORRIDORS.items():
            if service_id not in case_services:
                continue
            if start_id not in route_ids or end_id not in route_ids:
                continue
            start_index, end_index = route_ids.index(start_id), route_ids.index(end_id)
            if start_index < end_index:
                for index in range(start_index, end_index):
                    pair_plan_cases[index].add(case)
        if len(pairs) != len(ranges):
            raise StageError(f"route pair and line range counts differ: {service.id}")
        for pair_index, (origin, destination) in enumerate(pairs):
            item = ranges[pair_index]
            composed_owner = ""
            if item.compose:
                line_pairs = tuple(
                    sorted(
                        {
                            (
                                leg.evidence.n02_operator
                                or service.effective_n02_operator(dataset),
                                line,
                            )
                            for leg in item.compose.legs
                            for line in leg.evidence.lines
                        }
                    )
                )
                owners = {leg.source_service for leg in item.compose.legs}
                if len(owners) == 1:
                    composed_owner = next(iter(owners))
            else:
                route_lines = item.route_lines
                operators = service.range_operators(item, dataset)
                if len(route_lines) != len(operators):
                    raise StageError(f"route ownership is incomplete: {service.id}")
                line_pairs = tuple(
                    sorted(set(zip(operators, route_lines, strict=True)))
                )
            section_keys: set[str] = set()
            for operator, line in line_pairs:
                section_filter = (
                    service.section_filter_for_pair(line, operator, origin, destination)
                    if not item.compose
                    else next(
                        leg.evidence.filter_for(line)
                        for leg in item.compose.legs
                        if line in leg.evidence.lines
                    )
                )
                section_keys.update(section_filter.allow)
            plan_cases = pair_plan_cases[pair_index]
            if {origin, destination} == {
                "narita-airport-terminal-2-3",
                "narita-airport-terminal-1",
            } and service_id in {
                "keisei-main",
                "keisei-narita-airport-access",
            }:
                plan_cases.add("keisei-airport-pair")
            if "hokuso-imba-nihon-idai" in {origin, destination} and (
                service_id.startswith("keisei-") or service_id.startswith("hokuso-")
            ):
                plan_cases.add("keisei-hokuso-inba-connection")
            result.append(
                PairEvidence(
                    service_id=service_id,
                    origin=origin,
                    destination=destination,
                    operators=tuple(sorted({operator for operator, _ in line_pairs})),
                    lines=line_pairs,
                    section_keys=tuple(sorted(section_keys)),
                    plan_cases=tuple(sorted(plan_cases)),
                    composed_owner=composed_owner,
                )
            )
    return result


def review_shared(*, root: Path = ROOT) -> dict[str, Any]:
    """Write the complete shared-track review to the assembled staging tree."""
    assembled_dir = root / ASSEMBLED_PATH
    overrides_dir = assembled_dir / "overrides"
    if not (assembled_dir / "inventory.json").is_file() or not overrides_dir.is_dir():
        raise StageError("assembled S4 data is missing; run assemble first")
    inventory = read_json(assembled_dir / "inventory.json")
    freeze, catalog, frozen_services = _load_frozen_catalog(root)
    expected_counts = _oracle(freeze, catalog, frozen_services)["counts"]
    if inventory["counts"] != expected_counts:
        raise StageError(
            "assembled inventory differs from the frozen catalog oracle: "
            f"{inventory['counts']} != {expected_counts}"
        )
    pair_evidence = _pair_evidence(overrides_dir)
    actual_pair_count = len(pair_evidence)
    if actual_pair_count != expected_counts["serviceRoutePairRows"]:
        raise StageError(
            "assembled route pairs differ from the frozen catalog oracle: "
            f"{actual_pair_count} != {expected_counts['serviceRoutePairRows']}"
        )
    entries = build_review_entries(pair_evidence)
    counts: dict[str, int] = defaultdict(int)
    decision_counts: dict[str, int] = defaultdict(int)
    reason_counts: dict[str, int] = defaultdict(int)
    for entry in entries:
        counts[entry["classification"]] += 1
        decision_counts[entry["decision"]] += 1
        reason_counts[entry["reason"]] += 1
    open_candidates = [
        entry
        for entry in entries
        if entry["decision"] in {"needs-lead-review", "compose-candidate"}
    ]
    report = {
        "schemaVersion": 1,
        "status": "reviewed" if not open_candidates else "review-required",
        "expectedCounts": expected_counts,
        "candidateCounts": {
            name: counts.get(name, 0)
            for name in (
                "same-station-pair",
                "shared-source-sections",
                "boundary-connection",
                "parallel",
            )
        },
        "decisionCounts": dict(sorted(decision_counts.items())),
        "reasonCounts": dict(sorted(reason_counts.items())),
        "openCandidates": [entry["candidateId"] for entry in open_candidates],
        "candidates": entries,
    }
    write_json(assembled_dir / "shared-track-review.json", report)
    return {
        "status": report["status"],
        "candidateCount": len(entries),
        "candidateCounts": report["candidateCounts"],
        "decisionCounts": report["decisionCounts"],
        "reasonCounts": report["reasonCounts"],
        "openCandidateCount": len(open_candidates),
        "output": str((assembled_dir / "shared-track-review.json").relative_to(root)),
    }


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(arguments)
    try:
        result = review_shared(root=args.root)
    except (OSError, KeyError, StageError, ValueError) as error:
        print(f"FAIL {error}")
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "reviewed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
