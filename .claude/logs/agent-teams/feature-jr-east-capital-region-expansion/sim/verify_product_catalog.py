"""Independently verify S0b CSVs against frozen inputs and shipped identities.

Does not import the generator. Validates every output field and gameplay graph.
"""

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RESEARCH = ROOT / ".claude/docs/research"
EXPECTED_INPUT_HASHES = {
    "jr-east-capital-region-catalog-v2.csv": "ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4",
    "jr-east-capital-region-services-v2.csv": "45ee942862f0def53625e76dbafbc4ab306cc181123d71bd37cf225d70746d8b",
    "jr-east-capital-region-id-map.csv": "ca6a7c7c957ab153f787d78a040dc5d57fa044d59da758064a632789ab96885f",
}
EXPECTED_RAPID_IDS = {"chuo_rapid", "sobu_rapid", "joban_rapid", "shonan_shinjuku_rapid_takasaki"}
SHIPPED_SERVICES = {
    "yamanote": "jr-yamanote", "keihin_tohoku_negishi": "jr-keihin-tohoku",
    "chuo_sobu_local": "jr-chuo-sobu-local", "saikyo_kawagoe": "jr-saikyo", "keiyo": "jr-keiyo",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    require(b"\r" not in path.read_bytes(), f"CSV must use LF bytes: {path.name}")
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames
        require(fields is not None, f"Missing header: {path.name}")
        rows = list(reader)
    require(all(set(row) == set(fields) and None not in row.values() for row in rows), f"Malformed CSV: {path.name}")
    return fields, rows


def endpoint(value: str) -> str:
    require(value in {"", "terminus", "area-boundary", "through-split"}, f"Unknown research endpoint: {value}")
    return "service-boundary" if value == "through-split" else value


def reachable(graph: dict[str, set[str]], start: str) -> set[str]:
    visited = {start}
    queue = [start]
    for station in queue:
        for other in graph[station] - visited:
            visited.add(other)
            queue.append(other)
    return visited


def main() -> None:
    for name, expected in EXPECTED_INPUT_HASHES.items():
        require(hashlib.sha256((RESEARCH / name).read_bytes()).hexdigest() == expected, f"Frozen input changed: {name}")
    _, source = read_csv(RESEARCH / "jr-east-capital-region-catalog-v2.csv")
    _, source_services = read_csv(RESEARCH / "jr-east-capital-region-services-v2.csv")
    _, crosswalk = read_csv(RESEARCH / "jr-east-capital-region-id-map.csv")
    fields, catalog = read_csv(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    service_fields, services = read_csv(RESEARCH / "jr-east-capital-region-product-services.csv")
    require(fields == ["service_id", "order", "station_id", "name_ja", "prefecture", "endpoint_kind", "kind"], "Product catalog schema differs")
    require(service_fields == ["service_id", "research_id", "name_ja", "kind", "circular", "first_end_kind", "last_end_kind", "stop_count"], "Product services schema differs")
    require(len(source) == len(catalog) == 666, "Wrong stop row count")
    require(len(source_services) == len(services) == 40, "Wrong service count")
    maps = {}
    for entity, count in [("service", 40), ("station", 472)]:
        entries = [r for r in crosswalk if r["entity_type"] == entity]
        require(len(entries) == len({r["research_id"] for r in entries}) == len({r["product_id"] for r in entries}) == count, f"Map not bijective: {entity}")
        maps[entity] = {r["research_id"]: r for r in entries}
    require(len(crosswalk) == 512, "Unknown map entity")
    service_map, station_map = maps["service"], maps["station"]
    require(set(service_map) == {s["service_id"] for s in source_services}, "Research service coverage differs")
    require(set(station_map) == {r["station_id_proposed"] for r in source}, "Research station coverage differs")
    require({s["service_id"] for s in services} == {r["product_id"] for r in service_map.values()}, "Product service coverage differs")
    station_ids = {r["station_id"] for r in catalog}
    require(len(station_ids) == 472 and station_ids == {r["product_id"] for r in station_map.values()}, "Product station coverage differs")
    require([s["research_id"] for s in services] == [s["service_id"] for s in source_services], "Service order changed")
    require({r["product_id"] for r in service_map.values()}.isdisjoint(station_ids), "Product namespaces collide")
    require({s["research_id"] for s in services if s["kind"] == "rapid"} == EXPECTED_RAPID_IDS, "Rapid classification differs")
    require(all(s["kind"] in {"local", "rapid"} for s in services), "Unsupported product kind")
    grouped = defaultdict(list)
    source_grouped = defaultdict(list)
    for row in catalog:
        grouped[row["service_id"]].append(row)
    for row in source:
        source_grouped[row["service_id"]].append(row)
    require(list(grouped) == [s["service_id"] for s in services], "Catalog service order differs")
    require(list(source_grouped) == [s["service_id"] for s in source_services], "Research catalog service order differs")

    graph, reverse = defaultdict(set), defaultdict(set)
    directed_segments = 0
    for original, product in zip(source_services, services):
        rid, pid = original["service_id"], product["service_id"]
        rows, original_rows = grouped[pid], source_grouped[rid]
        require(pid == service_map[rid]["product_id"], f"Service mapping changed: {rid}")
        kind = "rapid" if rid in EXPECTED_RAPID_IDS else "local"
        require(original["service_type"] == product["kind"] == kind, f"Classification changed: {rid}")
        require(product["name_ja"] == original["line_name"] == service_map[rid]["name_ja"], f"Service name changed: {rid}")
        require(product["circular"] == original["circular"] and product["circular"] in {"true", "false"}, f"Circular metadata changed: {rid}")
        require(product["stop_count"] == str(len(rows)) and len(rows) == len(original_rows) >= 2, f"Stop count differs: {rid}")
        require([r["order"] for r in rows] == [str(i) for i in range(len(rows))], f"Non-contiguous order: {rid}")
        require([r["station_id_proposed"] for r in original_rows] == original["stop_ids"].split("|"), f"Research stop order differs: {rid}")
        stops = [r["station_id"] for r in rows]
        require(len(stops) == len(set(stops)), f"Duplicate stop: {rid}")
        for key in ["first_end_kind", "last_end_kind"]:
            require(product[key] == endpoint(original[key]), f"Endpoint changed: {rid}/{key}")
            require(product[key] in ({""} if product["circular"] == "true" else {"terminus", "area-boundary", "service-boundary"}), f"Invalid endpoint: {rid}/{key}")
        pairs = list(zip(stops, stops[1:]))
        if product["circular"] == "true":
            pairs.append((stops[-1], stops[0]))
        # Match gameplay: the target Yamanote loop is +1 only, others both ways.
        for a, b in pairs:
            directions = [(a, b)] if pid == "jr-yamanote" else [(a, b), (b, a)]
            directed_segments += len(directions)
            for start, end in directions:
                graph[start].add(end)
                reverse[end].add(start)

    metadata = {s["service_id"]: s for s in services}
    for original, product in zip(source, catalog):
        mapped = station_map[original["station_id_proposed"]]
        require(product["service_id"] == service_map[original["service_id"]]["product_id"], "Catalog service order/mapping changed")
        require(product["order"] == original["order"] and product["station_id"] == mapped["product_id"], "Catalog stop order/mapping changed")
        require(product["name_ja"] == original["station_name_ja"] == mapped["name_ja"], "Station name changed")
        require(product["prefecture"] == original["prefecture"] == mapped["prefecture"], "Station prefecture changed")
        service = metadata[product["service_id"]]
        require(product["kind"] == original["service_type"] == service["kind"], "Stop kind differs")
        require(original["is_loop"] == service["circular"], "Stop circular metadata differs")
        expected_endpoint = ""
        if service["circular"] == "false":
            if product["order"] == "0":
                expected_endpoint = service["first_end_kind"]
            elif product["order"] == str(int(service["stop_count"]) - 1):
                expected_endpoint = service["last_end_kind"]
        require(product["endpoint_kind"] == expected_endpoint, "Stop endpoint position/kind differs")
        if expected_endpoint:
            require(original["is_terminus_in_area"] == ("true" if expected_endpoint == "terminus" else "false"), "Research endpoint semantics differ")

    _, registry = read_csv(ROOT / "data/overrides/stations.csv")
    shipped = json.loads((ROOT / "public/data/services.json").read_text(encoding="utf-8"))["services"]
    require(len(registry) == 67 and len(shipped) == 5, "Shipped baseline counts changed")
    require({s["id"] for s in shipped} == set(SHIPPED_SERVICES.values()), "Shipped service IDs changed")
    for rid, pid in SHIPPED_SERVICES.items():
        require(service_map[rid]["product_id"] == pid and service_map[rid]["id_source"] == "shipped", f"Shipped service changed: {rid}")
    matched = set()
    for station in registry:
        candidates = {
            r["station_id_proposed"] for r in source
            if (r["n02_name"] or r["station_name_ja"]) == (station["n02_name"] or station["name"])
            and r["prefecture"] == "東京都"
            and service_map[r["service_id"]]["product_id"] == station["representative_service_id"]
        }
        require(len(candidates) == 1, f"Ambiguous shipped station: {station['id']}")
        rid = next(iter(candidates))
        matched.add(rid)
        require(station_map[rid]["product_id"] == station["id"] and station_map[rid]["id_source"] == "shipped", f"Shipped station ID changed: {station['id']}")
    require(len(matched) == 67 and matched == {rid for rid, r in station_map.items() if r["id_source"] == "shipped"}, "Shipped station coverage differs")
    for service in shipped:
        product_stops = [r["station_id"] for r in grouped[service["id"]]]
        require([sid for sid in product_stops if sid in service["stationIds"]] == service["stationIds"], f"Shipped stop order changed: {service['id']}")
    outward, inward = reachable(graph, "shimbashi"), reachable(reverse, "shimbashi")
    require(outward == inward == station_ids, "Product gameplay network disconnected")
    require(directed_segments == 1224, "Gameplay segment count changed")
    hashes = {name: hashlib.sha256((RESEARCH / name).read_bytes()).hexdigest() for name in [
        "jr-east-capital-region-product-catalog.csv", "jr-east-capital-region-product-services.csv",
    ]}
    print(json.dumps({
        "ok": True, "rows": len(catalog), "services": len(services), "stations": len(station_ids),
        "kinds": dict(Counter(s["kind"] for s in services)), "bijection": "verified",
        "service_and_stop_order": "preserved", "endpoints": "preserved; through-split -> service-boundary",
        "endpoint_counts": dict(sorted(Counter(r["endpoint_kind"] for r in catalog if r["endpoint_kind"]).items())),
        "shipped_services_preserved": 5, "shipped_stations_preserved": len(matched),
        "reachable_from_shimbashi": len(outward), "can_reach_shimbashi": len(inward),
        "directed_gameplay_segments": directed_segments, "lf_bytes": True, "sha256": hashes,
    }))


if __name__ == "__main__":
    main()
