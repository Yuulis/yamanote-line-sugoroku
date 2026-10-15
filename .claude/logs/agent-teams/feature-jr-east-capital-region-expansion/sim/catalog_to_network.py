"""Convert the researcher's catalog CSV into Monte Carlo network JSON files.

Usage: python3 catalog_to_network.py <catalog.csv> <tag>
Writes net-<tag>-core.json, net-<tag>-all.json, net-<tag>-local.json.
"""
import csv
import json
import sys
from collections import OrderedDict

path, tag = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader(open(path, encoding="utf-8")))
by_service: "OrderedDict[str, list[dict]]" = OrderedDict()
for row in rows:
    by_service.setdefault(row["service_id"], []).append(row)

services = []
prefectures = {}
for sid, srows in by_service.items():
    srows.sort(key=lambda r: int(r["order"]))
    stops = [r["station_id_proposed"] for r in srows]
    circular = srows[0]["is_loop"] == "true"
    if sid == "yamanote" and stops[stops.index("shimbashi") - 1] == "hamamatsucho":
        # Draft catalog listed the loop in 内回り order; the game rides 外回り from 新橋 as +1.
        k = stops.index("shimbashi")
        stops = list(reversed(stops[: k + 1])) + list(reversed(stops[k + 1 :]))
    if sid == "yamanote":
        k = stops.index("shimbashi")
        stops = stops[k:] + stops[:k]
        assert stops[0] == "shimbashi" and stops[1] == "hamamatsucho", stops[:3]
    services.append({
        "id": sid,
        "type": srows[0]["service_type"],
        "recommendation": srows[0]["recommendation"],
        "circular": circular,
        "stops": stops,
    })
    for r in srows:
        prefectures.setdefault(r["station_id_proposed"], r["prefecture"])

def write(name: str, selected: list[dict]) -> None:
    net = {
        "label": f"{tag}-{name}",
        "target": "yamanote",
        "start": "shimbashi",
        "services": selected,
        "prefectures": {k: v for k, v in prefectures.items()
                        if any(k in s["stops"] for s in selected)},
    }
    with open(f"net-{tag}-{name}.json", "w", encoding="utf-8") as fh:
        json.dump(net, fh, ensure_ascii=False)
    stations = {st for s in selected for st in s["stops"]}
    print(name, len(selected), "services", len(stations), "stations")

write("core", [s for s in services if s["recommendation"] == "core"])
write("all", services)
write("local", [s for s in services if s["recommendation"] == "core" and s["type"] == "local"])
print("rows", len(rows))
