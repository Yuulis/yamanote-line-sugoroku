"""Generate S0b product CSVs from approved v2 and the frozen S0 crosswalk.

Run from any directory. Outputs use UTF-8/LF, retaining input service/stop order.
endpoint_kind is populated only at a linear service's first and last stops;
interior stops and circular services have an empty endpoint_kind.
"""

import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RESEARCH = ROOT / ".claude/docs/research"
INPUT_HASHES = {
    "jr-east-capital-region-catalog-v2.csv": "ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4",
    "jr-east-capital-region-services-v2.csv": "45ee942862f0def53625e76dbafbc4ab306cc181123d71bd37cf225d70746d8b",
    "jr-east-capital-region-id-map.csv": "ca6a7c7c957ab153f787d78a040dc5d57fa044d59da758064a632789ab96885f",
}
RAPID_IDS = {"chuo_rapid", "sobu_rapid", "joban_rapid", "shonan_shinjuku_rapid_takasaki"}
ENDPOINT_MAP = {
    "terminus": "terminus",
    "area-boundary": "area-boundary",
    "through-split": "service-boundary",
}
CATALOG_FIELDS = ["service_id", "order", "station_id", "name_ja", "prefecture", "endpoint_kind", "kind"]
SERVICE_FIELDS = ["service_id", "research_id", "name_ja", "kind", "circular", "first_end_kind", "last_end_kind", "stop_count"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_input(name: str) -> list[dict[str, str]]:
    path = RESEARCH / name
    raw = path.read_bytes()
    require(b"\r" not in raw, f"Input must use LF bytes: {name}")
    require(hashlib.sha256(raw).hexdigest() == INPUT_HASHES[name], f"Frozen input changed: {name}")
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def write_csv(name: str, fields: list[str], rows: list[dict[str, str]]) -> str:
    path = RESEARCH / name
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    catalog = read_input("jr-east-capital-region-catalog-v2.csv")
    services = read_input("jr-east-capital-region-services-v2.csv")
    crosswalk = read_input("jr-east-capital-region-id-map.csv")
    maps = {}
    for entity, count in [("service", 40), ("station", 472)]:
        entries = [r for r in crosswalk if r["entity_type"] == entity]
        require(len(entries) == count, f"Wrong {entity} map count")
        require(len({r["research_id"] for r in entries}) == count, f"Duplicate {entity} research id")
        require(len({r["product_id"] for r in entries}) == count, f"Duplicate {entity} product id")
        maps[entity] = {r["research_id"]: r["product_id"] for r in entries}
    require(len(crosswalk) == 512, "Unknown crosswalk entity")
    require(len(catalog) == 666 and len(services) == 40, "Wrong research counts")
    grouped = defaultdict(list)
    for row in catalog:
        grouped[row["service_id"]].append(row)
    require(list(grouped) == [s["service_id"] for s in services], "Research service order differs")
    require(set(grouped) == set(maps["service"]), "Service map coverage differs")
    require({r["station_id_proposed"] for r in catalog} == set(maps["station"]), "Station map coverage differs")
    require({s["service_id"] for s in services if s["service_type"] == "rapid"} == RAPID_IDS, "Rapid classification changed")

    product_services = []
    metadata = {}
    for service in services:
        sid = service["service_id"]
        rows = grouped[sid]
        require([r["order"] for r in rows] == [str(i) for i in range(len(rows))], f"Invalid stop order: {sid}")
        require(service["stop_ids"].split("|") == [r["station_id_proposed"] for r in rows], f"Stop lists differ: {sid}")
        require(service["circular"] in {"true", "false"}, f"Unknown circular value: {sid}")
        kind = "rapid" if sid in RAPID_IDS else "local"
        require(service["service_type"] == kind, f"Unknown research classification: {sid}")
        require(all(r["service_type"] == kind and r["is_loop"] == service["circular"] for r in rows), f"Stop metadata differs: {sid}")
        if service["circular"] == "true":
            require(not service["first_end_kind"] and not service["last_end_kind"], f"Circular endpoints: {sid}")
            first = last = ""
        else:
            first = ENDPOINT_MAP[service["first_end_kind"]]
            last = ENDPOINT_MAP[service["last_end_kind"]]
        product = {
            "service_id": maps["service"][sid], "research_id": sid,
            "name_ja": service["line_name"], "kind": kind, "circular": service["circular"],
            "first_end_kind": first, "last_end_kind": last, "stop_count": str(len(rows)),
        }
        metadata[sid] = product
        product_services.append(product)

    product_catalog = []
    for row in catalog:
        service = metadata[row["service_id"]]
        endpoint = ""
        if service["circular"] == "false":
            if row["order"] == "0":
                endpoint = service["first_end_kind"]
            elif int(row["order"]) == int(service["stop_count"]) - 1:
                endpoint = service["last_end_kind"]
        product_catalog.append({
            "service_id": service["service_id"], "order": row["order"],
            "station_id": maps["station"][row["station_id_proposed"]],
            "name_ja": row["station_name_ja"], "prefecture": row["prefecture"],
            "endpoint_kind": endpoint, "kind": service["kind"],
        })
    hashes = {
        "jr-east-capital-region-product-catalog.csv": write_csv("jr-east-capital-region-product-catalog.csv", CATALOG_FIELDS, product_catalog),
        "jr-east-capital-region-product-services.csv": write_csv("jr-east-capital-region-product-services.csv", SERVICE_FIELDS, product_services),
    }
    print(json.dumps({"ok": True, "rows": len(product_catalog), "services": len(product_services), "sha256": hashes}))


if __name__ == "__main__":
    main()
