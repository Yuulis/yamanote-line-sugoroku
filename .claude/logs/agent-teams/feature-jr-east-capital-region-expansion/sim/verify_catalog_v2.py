"""Verify selection, evidence preservation, endpoints and reachability of v2."""

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RESEARCH = ROOT / ".claude/docs/research"

# Frozen catalog hashes use LF-normalized UTF-8 bytes, matching .gitattributes.
EXPECTED_CATALOG_SHA256 = {
    "jr-east-capital-region-catalog.csv": "244bd49d40a957fa17e8eeba205746d268c1ba197306b636592b875b98f6194d",
    "jr-east-capital-region-services.csv": "ab58f1ff64d2e3b69f6f5225d73fdf88bd0042c1bea30a7f1540b9abda33da12",
    "jr-east-capital-region-catalog-v2.csv": "ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4",
    "jr-east-capital-region-services-v2.csv": "45ee942862f0def53625e76dbafbc4ab306cc181123d71bd37cf225d70746d8b",
}

# Independently reviewed expectations for every v1 id. Do not derive this table
# from service_type, the generator's constants, or station-coverage results:
# coverage alone cannot detect the loss of a base through route.
EXPECTED_CLASSIFICATION: dict[str, tuple[str, str]] = {
    "yamanote": ("keep", "Base pattern of the Yamanote loop tracks."),
    "keihin_tohoku_negishi": ("keep", "Base pattern of the Keihin-Tohoku/Negishi through route."),
    "keihin_tohoku_rapid": ("drop", "Upper type of keihin_tohoku_negishi."),
    "chuo_sobu_local": ("keep", "Base pattern of the Chuo/Sobu local tracks, separate from rapid tracks."),
    "chuo_rapid": ("keep", "Base pattern of the Chuo rapid tracks, separate from local tracks."),
    "chuo_special_rapid": ("drop", "Upper type of chuo_rapid."),
    "chuo_commuter_rapid": ("drop", "Upper type of chuo_rapid."),
    "chuo_commuter_special_rapid": ("drop", "Upper type of chuo_rapid."),
    "chuo_takao_fujino": ("keep", "Base pattern of the Chuo main-line route beyond Takao."),
    "ome": ("keep", "Base pattern of the Ome route."),
    "ome_holiday_special_rapid": ("drop", "Upper type of ome."),
    "itsukaichi": ("keep", "Base pattern of the Itsukaichi branch route."),
    "hachiko": ("keep", "Base pattern of the Hachiko route."),
    "kawagoe_west": ("keep", "Base pattern of the western Kawagoe route."),
    "saikyo_kawagoe": ("keep", "Base pattern of the Saikyo/Kawagoe through route."),
    "saikyo_rapid": ("drop", "Upper type of saikyo_kawagoe."),
    "saikyo_commuter_rapid": ("drop", "Upper type of saikyo_kawagoe."),
    "sotetsu_direct": ("keep", "Base pattern of the JR/Sotetsu named through route within the JR area."),
    "keiyo": ("keep", "Base pattern of the Keiyo route."),
    "keiyo_rapid": ("drop", "Upper type of keiyo."),
    "musashino": ("keep", "Base pattern of the Musashino main route."),
    "musashino_takaya": ("keep", "Base pattern of the Musashino/Takaya through branch route."),
    "musashino_futamata": ("keep", "Base pattern of the Musashino/Futamata through branch route."),
    "musashino_shimousa": ("drop", "Upper named through type over musashino and saikyo_kawagoe."),
    "musashino_musashino": ("drop", "Upper named through type over chuo_rapid, musashino and utsunomiya/takasaki."),
    "nambu": ("keep", "Base pattern of the Nambu main route."),
    "nambu_rapid": ("drop", "Upper type of nambu."),
    "nambu_branch": ("keep", "Base pattern of the Nambu Hamakawasaki branch route."),
    "tsurumi": ("keep", "Base pattern of the Tsurumi main route."),
    "tsurumi_umishibaura": ("keep", "Base pattern of the Tsurumi Umishibaura branch route."),
    "tsurumi_okawa": ("keep", "Base pattern of the Tsurumi Okawa branch route."),
    "yokohama": ("keep", "Base pattern of the Yokohama route."),
    "yokohama_rapid": ("drop", "Upper type of yokohama."),
    "sagami": ("keep", "Base pattern of the Sagami route."),
    "tokaido": ("keep", "Base pattern of the Tokaido tracks, separate from Keihin-Tohoku tracks."),
    "yokosuka": ("keep", "Base pattern of the Yokosuka tracks, separate from Tokaido/Keihin-Tohoku tracks."),
    "sobu_rapid": ("keep", "Base pattern of the Tokyo/Chiba Sobu rapid tracks, separate from local tracks."),
    "sobu_rapid_narita_airport": ("drop", "Upper through type over sobu_main, narita and narita_airport_branch."),
    "uchibo_rapid": ("drop", "Upper through type of uchibo."),
    "sotobo_rapid": ("drop", "Upper through type of sotobo."),
    "utsunomiya": ("keep", "Base pattern of the Utsunomiya/Ueno-Tokyo route."),
    "utsunomiya_rapid_rabbit": ("drop", "Upper type of utsunomiya."),
    "takasaki": ("keep", "Base pattern of the Takasaki/Ueno-Tokyo route."),
    "takasaki_rapid_urban": ("drop", "Upper type of takasaki."),
    "shonan_shinjuku_local": ("keep", "Base pattern of the whole Utsunomiya/Yokosuka Shonan-Shinjuku route."),
    "shonan_shinjuku_rapid_utsunomiya": ("drop", "Upper type of shonan_shinjuku_local."),
    "shonan_shinjuku_rapid_takasaki": ("keep", "Base pattern of the whole Takasaki/Tokaido Shonan-Shinjuku route; no local type exists."),
    "shonan_shinjuku_special_rapid": ("drop", "Upper type of shonan_shinjuku_rapid_takasaki."),
    "joban_rapid": ("keep", "Base pattern of the Joban rapid tracks, separate from local tracks."),
    "joban_special_rapid": ("drop", "Upper type of joban_rapid."),
    "joban_local": ("keep", "Base pattern of the Joban local tracks, separate from rapid tracks."),
    "narita_abiko": ("keep", "Base pattern of the Narita Abiko branch route."),
    "narita": ("keep", "Base pattern of the Narita Sakura/Matsugishi route."),
    "narita_airport_branch": ("keep", "Base pattern of the Narita airport branch route."),
    "kashima": ("keep", "Base pattern of the in-area Kashima route."),
    "sobu_main": ("keep", "Base pattern of the Sobu main route beyond Chiba."),
    "sotobo": ("keep", "Base pattern of the Sotobo route."),
    "uchibo": ("keep", "Base pattern of the Uchibo route."),
    "kururi": ("keep", "Base pattern of the Kururi route, truncated at Kururi by Q6."),
    "togane": ("keep", "Base pattern of the Togane route."),
}


def read_csv(name):
    with (RESEARCH / name).open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        return reader.fieldnames, list(reader)


def reachable(graph, start):
    visited = {start}
    queue = [start]
    for station in queue:
        for other in graph[station] - visited:
            visited.add(other)
            queue.append(other)
    return visited


def main():
    for name, expected_hash in EXPECTED_CATALOG_SHA256.items():
        raw = (RESEARCH / name).read_bytes()
        assert b"\r" not in raw, f"catalog must use LF bytes: {name}"
        assert hashlib.sha256(raw).hexdigest() == expected_hash, f"catalog hash changed: {name}"
    fields1, v1 = read_csv("jr-east-capital-region-catalog.csv")
    fields2, v2 = read_csv("jr-east-capital-region-catalog-v2.csv")
    service_fields1, services1 = read_csv("jr-east-capital-region-services.csv")
    service_fields2, services2 = read_csv("jr-east-capital-region-services-v2.csv")
    assert fields1 == fields2 and service_fields1 == service_fields2, "schema changed"
    source_ids = [s["service_id"] for s in services1]
    assert len(source_ids) == len(set(source_ids)) == len(EXPECTED_CLASSIFICATION) == 60
    assert set(source_ids) == set(EXPECTED_CLASSIFICATION), "classification must cover every v1 service"
    assert all(decision in {"keep", "drop"} and reason for decision, reason in EXPECTED_CLASSIFICATION.values())
    kept = {sid for sid, (decision, _) in EXPECTED_CLASSIFICATION.items() if decision == "keep"}
    assert [s["service_id"] for s in services2] == [s["service_id"] for s in services1 if s["service_id"] in kept], "v2 differs from independent keep/drop classification"
    removed_names = {"平山", "上総松丘", "上総亀山"}
    expected_rows = [r for r in v1 if r["service_id"] in kept and not
                     (r["service_id"] == "kururi" and r["station_name_ja"] in removed_names)]
    keys = lambda rows: [(r["service_id"], r["order"], r["station_id_proposed"]) for r in rows]
    assert keys(v2) == keys(expected_rows), "ids, stop order or selection changed"
    for original, actual in zip(expected_rows, v2):
        allowed = {"notes"} if actual["service_id"] == "kururi" and actual["station_name_ja"] == "木更津" else set()
        if actual["service_id"] == "kururi" and actual["station_name_ja"] == "久留里":
            allowed = {"notes", "is_terminus_in_area"}
        assert all(original[k] == actual[k] for k in fields1 if k not in allowed), "v1 evidence changed"
        assert actual["source_url"]
        assert (actual["hop_evidence_trains"] == "" and actual["order"] == "0") or int(actual["hop_evidence_trains"]) > 0
    by_service = defaultdict(list)
    names = {}
    for row in v2:
        by_service[row["service_id"]].append(row)
        names[row["station_id_proposed"]] = row["station_name_ja"]
    served = Counter(r["station_id_proposed"] for r in v2)
    source_stations = {r["station_id_proposed"] for r in v1}
    before_truncation = {r["station_id_proposed"] for r in v1 if r["service_id"] in kept}
    assert source_stations == before_truncation, "service selection orphaned stations"
    source_services_at = defaultdict(set)
    for row in v1:
        source_services_at[row["station_id_proposed"]].add(row["service_id"])
    dropped_exclusive = sorted({next(iter(service_ids)) for service_ids in source_services_at.values()
                                if len(service_ids) == 1 and not service_ids & kept})
    assert not dropped_exclusive, "a dropped service was a station's only service"
    lost = source_stations - set(served)
    assert lost == {r["station_id_proposed"] for r in v1 if r["station_name_ja"] in removed_names}
    assert len(names) == len(set(names.values())) == 472 and len(services2) == len(by_service) == 40
    assert len(v2) == 666 and all(n >= 1 for n in served.values())
    graph, reverse = defaultdict(set), defaultdict(set)
    service_pairs = 0
    for service in services2:
        rows = by_service[service["service_id"]]
        stops = [r["station_id_proposed"] for r in rows]
        assert len(stops) == len(set(stops))
        assert [int(r["order"]) for r in rows] == list(range(len(rows)))
        assert service["stop_ids"].split("|") == stops
        assert service["stops_ja"].split("|") == [r["station_name_ja"] for r in rows]
        original = next(s for s in services1 if s["service_id"] == service["service_id"])
        allowed = {"stops_ja", "stop_ids", "status_reason"} if service["service_id"] == "kururi" else set()
        assert all(original[k] == service[k] for k in service_fields1 if k not in allowed)
        if service["circular"] != "true":
            for row, key in [(rows[0], "first_end_kind"), (rows[-1], "last_end_kind")]:
                assert service[key] in {"terminus", "area-boundary", "through-split"}
                assert row["is_terminus_in_area"] == ("true" if service[key] == "terminus" else "false")
        pairs = list(zip(stops, stops[1:]))
        if service["circular"] == "true":
            pairs.append((stops[-1], stops[0]))
        service_pairs += len(pairs)
        # Linear services move both ways; use an undirected service graph as requested.
        for a, b in pairs:
            graph[a].add(b)
            graph[b].add(a)
            reverse[b].add(a)
            reverse[a].add(b)
    outward, inward = reachable(graph, "shimbashi"), reachable(reverse, "shimbashi")
    assert outward == inward == set(names), "network disconnected"
    kururi = by_service["kururi"]
    assert kururi[-1]["station_name_ja"] == "久留里" and kururi[-1]["is_terminus_in_area"] == "true"
    assert next(s for s in services2 if s["service_id"] == "kururi")["last_end_kind"] == "terminus"
    for station, service in [("hamakawasaki", "nambu_branch"), ("hamakawasaki", "tsurumi"),
                             ("tsurumi", "tsurumi"), ("tsurumi", "keihin_tohoku_negishi")]:
        assert station in [r["station_id_proposed"] for r in by_service[service]]
    services_at = defaultdict(set)
    for row in v2:
        services_at[row["station_id_proposed"]].add(row["service_id"])
    hub_ids = ["tokyo", "shinjuku", "omiya", "yokohama", "chiba"]
    print(json.dumps({
        "ok": True, "rows": len(v2), "services": len(by_service), "stations": len(names),
        "classification": {"total": len(EXPECTED_CLASSIFICATION), "keep": len(kept),
                           "drop": len(EXPECTED_CLASSIFICATION) - len(kept)},
        "local_services": sum(s["service_type"] == "local" for s in services2),
        "rapid_base_services": sum(s["service_type"] == "rapid" for s in services2),
        "rapid_track_services": sum(s["service_id"] in {"chuo_rapid", "sobu_rapid", "joban_rapid"} for s in services2),
        "rapid_through_route_services": sum(s["service_id"] == "shonan_shinjuku_rapid_takasaki" for s in services2),
        "transfer_stations": sum(len(sids) >= 2 for sids in services_at.values()),
        "max_k": max(map(len, services_at.values())),
        "hub_k": {names[st]: len(services_at[st]) for st in hub_ids},
        "hub_candidates": {names[st]: [s["service_id"] for s in services2
                                      if s["service_id"] in services_at[st]] for st in hub_ids},
        "minimum_services_per_station": min(len({r["service_id"] for r in v2 if r["station_id_proposed"] == st}) for st in names),
        "reachable_from_shimbashi": len(outward), "can_reach_shimbashi": len(inward),
        "service_selection_orphans": len(source_stations - before_truncation),
        "dropped_services_with_exclusive_stations": dropped_exclusive,
        "truncated_stations": ["平山", "上総松丘", "上総亀山"],
        "kururi_last_stop": kururi[-1]["station_name_ja"], "kururi_last_end_kind": "terminus",
        "tsurumi_transfers": ["浜川崎", "鶴見"], "undirected_service_segments": service_pairs,
        "distinct_station_pairs": sum(map(len, graph.values())) // 2,
        "sha256": hashlib.sha256((RESEARCH / "jr-east-capital-region-catalog-v2.csv").read_bytes()).hexdigest(),
        "hash_byte_convention": "LF-normalized UTF-8 bytes",
        "decision_items": [],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
