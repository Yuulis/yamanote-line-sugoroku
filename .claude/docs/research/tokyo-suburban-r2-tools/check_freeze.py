"""Create and validate the frozen Tokyo suburban implementation baseline."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

from check_catalog import read_csv

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = ROOT / ".claude/docs/research"
DEFAULT_CATALOG = RESEARCH / "tokyo-suburban-research-catalog.csv"
DEFAULT_SERVICES = RESEARCH / "tokyo-suburban-research-services.csv"
DEFAULT_FREEZE = ROOT / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
SHIPPED_CATALOG = RESEARCH / "jr-east-capital-region-product-catalog.csv"
CATALOG_FIELDS = {
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
}
SERVICE_FIELDS = {
    "service_id",
    "line_name",
    "service_type",
    "circular",
    "stop_ids",
    "first_end_kind",
    "last_end_kind",
}
SHIPPED_FIELDS = {
    "service_id",
    "order",
    "station_id",
    "name_ja",
    "prefecture",
    "endpoint_kind",
    "kind",
}
SHIPPED_STATIONS = 472
SHIPPED_SERVICES = 40
START_STATION = "shimbashi"
TARGET_SERVICE = "jr-yamanote"
LOOP_SERVICE_IDS = ["toei-oedo-loop", "toei-oedo-radial"]
KNOWN_N02_CONCERNS = [
    "Oyama junction gaps on Ryomo and Mito; Mito/Suigun gap; station representatives do not prove connectivity.",
    "Tokyu Meguro Tamagawa–Hiyoshi uses N02 Toyoko coverage; Oimachi Futako-Tamagawa–Mizonokuchi uses Den-en-toshi coverage.",
    "Fukutoshin north of Kotake-mukaihara uses the Yurakucho N02 line; Yokohama Blue spans two legal N02 lines at Kannai.",
    "Joban/Ueno and Shonan-Shinjuku substitution decisions retain explicit caveats.",
    "Airport track ownership and shared-use boundary stations need reviewed source selectors, not proximity joins.",
]


class ArgumentParser(argparse.ArgumentParser):
    """Use the requested exit code for invalid command-line arguments."""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(1, f"{self.prog}: error: {message}\n")


def sha256(path: Path) -> str:
    """Return a file's SHA-256 digest."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def input_paths() -> dict[str, Path]:
    """Return named research inputs consumed by the freeze."""
    paths = sorted(
        path
        for pattern in (
            "tokyo-suburban-r1-*",
            "tokyo-suburban-r2-*",
            "tokyo-suburban-research-*",
        )
        for path in RESEARCH.glob(pattern)
        if path.is_file() and "__pycache__" not in path.parts
    )
    paths.append(SHIPPED_CATALOG)
    return {path.relative_to(ROOT).as_posix(): path for path in paths}


def strict_rows(path: Path, fields: set[str]) -> list[dict[str, str]]:
    """Read CSV with the shared strict reader and enforce its exact schema."""
    rows = read_csv(path)
    with path.open(encoding="utf-8", newline="") as source:
        import csv

        header = next(csv.reader(source), [])
    if set(header) != fields or len(header) != len(fields):
        raise ValueError(f"Unexpected CSV fields in {path}: {header}")
    return rows


def identity_and_sequences(
    shipped_rows: list[dict[str, str]],
) -> tuple[list[str], dict[str, list[str]]]:
    """Return shipped identities and ordered service stop sequences."""
    by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in shipped_rows:
        by_service[row["service_id"]].append(row)
    station_ids = sorted({row["station_id"] for row in shipped_rows})
    sequences: dict[str, list[str]] = {}
    for service_id, rows in sorted(by_service.items()):
        ordered = sorted(rows, key=lambda row: int(row["order"]))
        if [int(row["order"]) for row in ordered] != list(range(len(ordered))):
            raise ValueError(f"Shipped service order is not contiguous: {service_id}")
        sequences[service_id] = [row["station_id"] for row in ordered]
    if len(station_ids) != SHIPPED_STATIONS or len(sequences) != SHIPPED_SERVICES:
        raise ValueError(
            "Shipped catalog no longer has the required 472 station / 40 service identities"
        )
    return station_ids, sequences


def make_baseline(catalog_path: Path, services_path: Path) -> dict[str, Any]:
    """Recompute frozen inputs, counts, rules, and representation decisions."""
    catalog = strict_rows(catalog_path, CATALOG_FIELDS)
    services = strict_rows(services_path, SERVICE_FIELDS)
    shipped_rows = strict_rows(SHIPPED_CATALOG, SHIPPED_FIELDS)
    service_ids = {row["service_id"] for row in services}
    stops_by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    group_names: dict[str, str] = {}
    group_prefectures: dict[str, str] = {}
    groups_by_service: dict[str, set[str]] = defaultdict(set)
    for row in catalog:
        service_id = row["service_id"]
        station_id = row["station_id_proposed"]
        if service_id not in service_ids:
            raise ValueError(f"Catalog stop has no service metadata: {service_id}")
        if (
            station_id in group_names
            and group_names[station_id] != row["station_name_ja"]
        ):
            raise ValueError(f"Conflicting canonical station names: {station_id}")
        if (
            station_id in group_prefectures
            and group_prefectures[station_id] != row["prefecture"]
        ):
            raise ValueError(f"Station group crosses prefectures: {station_id}")
        group_names[station_id] = row["station_name_ja"]
        group_prefectures[station_id] = row["prefecture"]
        stops_by_service[service_id].append(row)
        groups_by_service[service_id].add(station_id)
    if set(stops_by_service) != service_ids:
        raise ValueError("Catalog and service metadata service sets differ")
    edges: dict[str, set[str]] = defaultdict(set)
    segment_count = 0
    services_by_operator: Counter[str] = Counter()
    stops_by_operator: Counter[str] = Counter()
    for service in services:
        service_id = service["service_id"]
        stops = sorted(stops_by_service[service_id], key=lambda row: int(row["order"]))
        ids = [row["station_id_proposed"] for row in stops]
        if [int(row["order"]) for row in stops] != list(range(len(stops))):
            raise ValueError(f"Non-contiguous service stop order: {service_id}")
        if len(ids) < 2 or len(set(ids)) != len(ids):
            raise ValueError(
                f"Invalid repeated or short service stop sequence: {service_id}"
            )
        if "|".join(ids) != service["stop_ids"]:
            raise ValueError(
                f"Service stop_ids disagree with catalog order: {service_id}"
            )
        loop = service["circular"] == "true"
        if any((row["is_loop"] == "true") != loop for row in stops):
            raise ValueError(f"Loop metadata mismatch: {service_id}")
        operator_set = {row["operator"] for row in stops}
        if len(operator_set) != 1:
            raise ValueError(f"Service spans multiple operators: {service_id}")
        operator = next(iter(operator_set))
        services_by_operator[operator] += 1
        stops_by_operator[operator] += len(stops)
        pair_count = len(ids) if loop else len(ids) - 1
        for index in range(pair_count):
            start, end = ids[index], ids[(index + 1) % len(ids)]
            if service_id == TARGET_SERVICE:
                edges[start].add(end)
                segment_count += 1
            else:
                edges[start].add(end)
                edges[end].add(start)
                segment_count += 2
    if not set(group_names) <= set().union(*groups_by_service.values()):
        raise ValueError("Unreferenced station group")
    for service_id, ids in groups_by_service.items():
        if any(station_id not in group_names for station_id in ids):
            raise ValueError(f"Unresolved service stop: {service_id}")
    reached = {START_STATION}
    pending = deque([START_STATION])
    while pending:
        for neighbor in edges[pending.popleft()] - reached:
            reached.add(neighbor)
            pending.append(neighbor)
    if reached != set(group_names):
        raise ValueError(
            f"Unreachable station groups: {sorted(set(group_names) - reached)}"
        )
    shipped_station_ids, shipped_sequences = identity_and_sequences(shipped_rows)
    shipped_services = set(shipped_sequences)
    if (
        not set(shipped_station_ids) <= set(group_names)
        or not shipped_services <= service_ids
    ):
        raise ValueError("Shipped station or service identities were removed")
    for service_id, original in shipped_sequences.items():
        current = [
            row["station_id_proposed"]
            for row in sorted(
                stops_by_service[service_id], key=lambda row: int(row["order"])
            )
        ]
        if not any(
            current[index : index + len(original)] == original
            for index in range(len(current) - len(original) + 1)
        ):
            raise ValueError(f"Shipped contiguous stop sequence changed: {service_id}")
    if set(LOOP_SERVICE_IDS) - service_ids:
        raise ValueError("Oedo UI group must refer to two existing services")
    inputs = {name: sha256(path) for name, path in input_paths().items()}
    if catalog_path != DEFAULT_CATALOG:
        inputs[DEFAULT_CATALOG.relative_to(ROOT).as_posix()] = sha256(catalog_path)
    if services_path != DEFAULT_SERVICES:
        inputs[DEFAULT_SERVICES.relative_to(ROOT).as_posix()] = sha256(services_path)
    per_prefecture = Counter(group_prefectures.values())
    per_operator = {
        operator: {
            "services": services_by_operator[operator],
            "stops": stops_by_operator[operator],
        }
        for operator in sorted(services_by_operator)
    }
    matching = json.loads(
        (RESEARCH / "tokyo-suburban-r2-results.json").read_text(encoding="utf-8")
    )["cases"]["target-two-thirds"]
    return {
        "schemaVersion": 1,
        "inputs": inputs,
        "counts": {
            "services": len(services),
            "stationGroups": len(group_names),
            "serviceStopRows": len(catalog),
            "directedSegments": segment_count,
            "perOperator": per_operator,
            "perPrefectureStationGroups": dict(sorted(per_prefecture.items())),
        },
        "shipped": {
            "stationCount": len(shipped_station_ids),
            "stationIds": shipped_station_ids,
            "serviceCount": len(shipped_sequences),
            "serviceIds": sorted(shipped_services),
            "serviceStopSequences": shipped_sequences,
        },
        "ruleset": {
            "id": "tokyo-suburban-1",
            "sourceCaseId": "target-two-thirds",
            "targetServiceId": matching["config"]["targetServiceId"],
            "startStationId": matching["config"]["startStationId"],
            "targetDirection": matching["config"]["targetDirection"],
            "serviceLottery": matching["config"]["serviceLottery"],
            "directionLottery": matching["config"]["directionLottery"],
            "goalArrivalPolicy": "all 30 jr-yamanote outer directed segments, then arrive shimbashi",
            "statistics": {
                key: matching["statistics"][key]
                for key in ("games", "median", "p90", "p99", "max")
            },
        },
        "representations": {
            "stationIdentity": {
                "rule": "R2 B",
                "maximumStationPointGroupDistanceMeters": 600,
                "evidence": [
                    "official interchanges within the station-point group",
                    "documented shared structures",
                ],
                "sameNamePriority": True,
                "retainOriginalNamesAsAliases": True,
                "allowSameServiceStopCollapse": False,
                "allowDistinctJrIdCollapse": False,
            },
            "boundaries": {
                "joban": "Shinagawa–Namie, one service",
                "chuoMain": "Takao–Shiojiri, one service",
                "utsunomiya": "Tokyo–Kuroiso, one service",
                "shinonoiAndShinetsu": "separate services",
                "mitoLine": "ends at Tomobe",
                "chiyodaKitaAyase": "same service",
                "seibuYamaguchi": "included",
                "retainedServiceIds": ["jr-chuo-takao-fujino"],
            },
            "oedoServiceIds": LOOP_SERVICE_IDS,
            "uiLineGroups": [
                {
                    "id": "toei-oedo",
                    "displayName": "大江戸線",
                    "serviceIds": LOOP_SERVICE_IDS,
                }
            ],
        },
        "presentation": {
            "title": "山手線すごろく",
            "subtitle": "東京近郊版",
            "removeNoticeSentences": ["オリジナルゲーム", "非公式のファンメイド作品"],
            "applyInS0": False,
        },
        "knownN02Concerns": KNOWN_N02_CONCERNS,
    }


def parse_args(arguments: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line paths and mode."""
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--services", type=Path, default=DEFAULT_SERVICES)
    parser.add_argument("--freeze", type=Path, default=DEFAULT_FREEZE)
    parser.add_argument(
        "--write", action="store_true", help="regenerate the freeze JSON"
    )
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    """Write the baseline or compare current sources against it."""
    args = parse_args(arguments)
    try:
        actual = make_baseline(args.catalog.resolve(), args.services.resolve())
        if args.write:
            args.freeze.parent.mkdir(parents=True, exist_ok=True)
            args.freeze.write_text(
                json.dumps(actual, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            print(f"PASS wrote {args.freeze}")
            return 0
        expected = json.loads(args.freeze.read_text(encoding="utf-8"))
        if actual != expected:
            print("MISMATCH freeze baseline differs from current inputs or counts")
            return 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"MISMATCH {error}")
        return 2
    print(
        "PASS freeze hashes, counts, coverage, shipped sequences, and decisions match"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
