"""Reproduce R2 research inputs; run from the repository root with uv run python."""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from shapely.geometry import MultiPoint, Point, shape

RESEARCH = Path(".claude/docs/research")
JR = "東日本旅客鉄道"
ALIASES = {"JR東日本": JR, "東京都交通局": "東京都", "横浜市交通局": "横浜市"}
KANTO = {"東京都", "神奈川県", "千葉県", "埼玉県", "栃木県", "群馬県", "茨城県"}


def normalize(value: str) -> str:
    return (
        unicodedata.normalize("NFKC", value)
        .replace("ケ", "ヶ")
        .replace("挾", "挟")
        .replace("曽", "曾")
        .replace(" ", "")
    )


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or len(reader.fieldnames) != len(
            set(reader.fieldnames)
        ):
            raise ValueError(f"Invalid CSV header: {path}")
        rows = list(reader)
        for line, row in enumerate(rows, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Invalid CSV column count: {path}:{line}")
        return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(h)))


def load_rows() -> tuple[list[dict[str, str]], dict]:
    rows = []
    counts = {}
    for slug in ("jr", "sub", "pe", "pw", "extra"):
        current = read_csv(RESEARCH / f"tokyo-suburban-r1-{slug}-catalog.csv")
        counts[slug] = {
            "rows": len(current),
            "services": len({r["service_id"] for r in current}),
            "stations": len({r["station_id_proposed"] for r in current}),
        }
        rows.extend(current)
    exceptions = read_csv(RESEARCH / "tokyo-suburban-r1-exceptions-catalog.csv")
    replacing = {r["service_id"] for r in exceptions}
    removed = [r for r in rows if r["service_id"] in replacing]
    rows = [r for r in rows if r["service_id"] not in replacing] + exceptions
    counts["exceptions"] = {
        "rows": len(exceptions),
        "services": len(replacing),
        "replaced_rows": len(removed),
    }
    return rows, counts


def station_points(rows: list[dict[str, str]]) -> tuple[dict, list]:
    raw = json.loads(Path("N02-25_GML/UTF-8/N02-25_Station.geojson").read_text())
    index = defaultdict(list)
    for feature in raw["features"]:
        p = feature["properties"]
        if p["N02_002"] == "1":
            continue
        index[(p["N02_004"], normalize(p["N02_005"]))].append(feature)
    by_id = defaultdict(list)
    for row in rows:
        by_id[row["station_id_proposed"]].append(row)
    points, missing = {}, []
    for identifier, stops in by_id.items():
        matches = []
        for row in stops:
            operator = ALIASES.get(row["n02_operator"], row["n02_operator"])
            candidates = index.get((operator, normalize(row["station_name_ja"])), [])
            lines = row["n02_line"].split(";")
            filtered = [f for f in candidates if f["properties"]["N02_003"] in lines]
            matches.extend(filtered or candidates)
        if not matches:
            missing.append(identifier)
            continue
        # One deterministic point per physical id, averaging distinct platform midpoints.
        coords = sorted(
            {
                tuple(shape(f["geometry"]).interpolate(0.5, normalized=True).coords[0])
                for f in matches
            }
        )
        points[identifier] = tuple(
            sum(p[i] for p in coords) / len(coords) for i in (0, 1)
        )
    return points, missing


def transfer_candidates(stations: dict, points: dict) -> tuple[list[dict], list[dict]]:
    by_name = defaultdict(list)
    for identifier, row in stations.items():
        operator = ALIASES.get(row["operator"], row["operator"])
        by_name[(operator, normalize(row["station_name_ja"]))].append(identifier)
    evidence_path = RESEARCH / "tokyo-suburban-r2-transfer-evidence.json"
    evidence = json.loads(evidence_path.read_text()) if evidence_path.exists() else []
    verified = {
        (r["station_id"], r["other_operator"], r["other_station_name"]): r
        for r in evidence
    }
    pairs = {}
    unresolved = []
    for slug in ("sub", "pe", "pw", "extra"):
        for row in read_csv(RESEARCH / f"tokyo-suburban-r1-{slug}-transfers.csv"):
            a = row["station_id"]
            op = ALIASES.get(row["other_operator"], row["other_operator"])
            name = re.split(r"[（(]", row["other_station_name"])[0].strip()
            if name == "とうきょうスカイツリー/押上":
                name = "押上"
            targets = by_name.get((op, normalize(name)), [])
            if a not in stations or not targets:
                unresolved.append({**row, "resolution": "out-of-scope-or-unmatched"})
                continue
            for b in targets:
                if a == b:
                    continue
                key = tuple(sorted((a, b)))
                pair = pairs.setdefault(
                    key,
                    {
                        "a": key[0],
                        "b": key[1],
                        "sources": [],
                        "notes": [],
                        "official_evidence": False,
                    },
                )
                pair["sources"].append(row["source_url"])
                pair["notes"].append(row["walking_note"])
                audit = verified.get(
                    (a, row["other_operator"], row["other_station_name"])
                )
                original_official = any(
                    url.startswith("https://") and "wikipedia.org" not in url
                    for url in row["source_url"].split()
                ) and not any(
                    tag in row["walking_note"].lower()
                    for tag in ("unverified", "inferred", "wikipedia")
                )
                if audit:
                    pair["sources"].append(audit["source_url"])
                    pair["notes"].append(
                        "R2 audit: " + audit["status"] + ": " + audit["evidence"]
                    )
                    original_official = audit["status"] == "yes"
                pair["official_evidence"] |= original_official
    # Same-name candidates are recorded even when no transfer was listed; never auto-merge them.
    names = defaultdict(list)
    for identifier, row in stations.items():
        names[normalize(row["station_name_ja"])].append(identifier)
    for ids in names.values():
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                if stations[a]["operator"] != stations[b]["operator"]:
                    key = tuple(sorted((a, b)))
                    pairs.setdefault(
                        key,
                        {
                            "a": key[0],
                            "b": key[1],
                            "sources": [],
                            "notes": [],
                            "official_evidence": False,
                        },
                    )
    result = []
    for pair in pairs.values():
        a, b = pair["a"], pair["b"]
        pair.update(
            name_a=stations[a]["station_name_ja"],
            name_b=stations[b]["station_name_ja"],
            distance_m=round(distance(points[a], points[b]), 3)
            if a in points and b in points
            else None,
        )
        pair["sources"] = sorted(set(pair["sources"]))
        pair["notes"] = sorted(set(pair["notes"]))
        result.append(pair)
    return sorted(result, key=lambda p: (p["a"], p["b"])), unresolved


def identity_map(
    rows: list[dict], points: dict, rule: str, threshold: float
) -> tuple[dict, list, list]:
    stations = {r["station_id_proposed"]: r for r in rows}
    pairs, unresolved = transfer_candidates(stations, points)
    parent = {i: i for i in stations}
    groups = {i: {i} for i in stations}
    service_sets = defaultdict(set)
    for row in rows:
        service_sets[row["station_id_proposed"]].add(row["service_id"])
    shared = [
        ("metro-meguro", "toei-meguro"),
        ("metro-shirokanedai", "toei-shirokanedai"),
        ("metro-shirokane-takanawa", "toei-shirokane-takanawa"),
        ("tokyu-meguro", "metro-meguro"),
        ("keikyu-sengakuji", "toei-sengakuji"),
        ("tokyu-shin-yokohama", "sotetsu-shin-yokohama"),
        ("metro-nakano", "nakano"),
        ("metro-nishi-funabashi", "nishi-funabashi"),
        ("metro-ayase", "ayase"),
        ("metro-yoyogi-uehara", "odakyu-yoyogi-uehara"),
        ("metro-wakoshi", "tobu-wakoshi"),
        ("metro-kotake-mukaihara", "seibu-kotake-mukaihara"),
        ("metro-kudanshita", "toei-kudanshita"),
        ("hazawa-yokohama-kokudai", "sotetsu-hazawa-yokohama-kokudai"),
        ("keio-shinjuku", "toei-shinjuku"),
        ("metro-shibuya", "tokyu-shibuya"),
        ("metro-naka-meguro", "tokyu-naka-meguro"),
        ("metro-oshiage", "tobu-oshiage"),
        ("toei-oshiage", "keisei-oshiage"),
        ("keisei-imba-nihon-idai", "hokuso-imba-nihon-idai"),
        ("tokyu-yokohama", "mm-yokohama"),
        ("keisei-keisei-takasago", "hokuso-keisei-takasago"),
    ]
    shared_keys = {tuple(sorted(p)) for p in shared}
    for a, b in shared:
        if (
            a in stations
            and b in stations
            and not any(p["a"] == min(a, b) and p["b"] == max(a, b) for p in pairs)
        ):
            pairs.append(
                {
                    "a": min(a, b),
                    "b": max(a, b),
                    "name_a": stations[min(a, b)]["station_name_ja"],
                    "name_b": stations[max(a, b)]["station_name_ja"],
                    "distance_m": round(distance(points[a], points[b]), 3),
                    "sources": [],
                    "notes": ["R1 documented shared-platform boundary"],
                    "official_evidence": False,
                }
            )

    def root(i: str) -> str:
        while parent[i] != i:
            i = parent[i]
        return i

    for pair in sorted(
        pairs,
        key=lambda p: (
            tuple(sorted((p["a"], p["b"]))) not in shared_keys,
            normalize(p["name_a"]) != normalize(p["name_b"]),
            p["distance_m"] or 0,
            p["a"],
            p["b"],
        ),
    ):
        a, b = pair["a"], pair["b"]
        eligible = tuple(sorted((a, b))) in shared_keys
        if rule != "shared":
            eligible |= bool(
                pair["official_evidence"]
                and pair["distance_m"] is not None
                and pair["distance_m"] <= threshold
                and (
                    rule != "same-name"
                    or normalize(pair["name_a"]) == normalize(pair["name_b"])
                )
            )
        pair["decision"] = "not-eligible"
        if not eligible:
            continue
        ra, rb = root(a), root(b)
        if ra == rb:
            pair["decision"] = "already-merged"
            continue
        ga, gb = groups[ra], groups[rb]
        services_a = set().union(*(service_sets[i] for i in ga))
        services_b = set().union(*(service_sets[i] for i in gb))
        if services_a & services_b:
            pair["decision"] = "rejected-same-service-collapse"
            continue
        if sum(stations[i]["operator"] == JR for i in ga | gb) > 1:
            pair["decision"] = "rejected-distinct-jr-identities"
            continue
        # Bound component diameter, not just individual links (prevents long transfer chains).
        if rule != "shared" and any(
            distance(points[x], points[y]) > threshold for x in ga for y in gb
        ):
            pair["decision"] = "rejected-component-diameter"
            continue
        parent[rb] = ra
        groups[ra] |= groups.pop(rb)
        pair["decision"] = "merged"
    mapping = {}
    for members in groups.values():
        representative = min(members, key=lambda i: (stations[i]["operator"] != JR, i))
        mapping.update({i: representative for i in members})
    return mapping, pairs, unresolved


def variant_rows(rows: list[dict], variant: str) -> list[dict]:
    if variant == "whole":
        return rows
    grouped = defaultdict(list)
    for r in rows:
        grouped[r["service_id"]].append(r)
    splits = {
        "jr-joban-rapid": ["toride", "iwaki"],
        "jr-chuo-takao-fujino": ["kofu"],
        "jr-utsunomiya": ["utsunomiya"],
    }
    output = []
    for identifier, stops in grouped.items():
        if (
            variant in ("split", "split-joban", "split-chuo", "split-utsunomiya")
            and identifier in splits
            and (
                variant == "split"
                or identifier
                == {
                    "split-joban": "jr-joban-rapid",
                    "split-chuo": "jr-chuo-takao-fujino",
                    "split-utsunomiya": "jr-utsunomiya",
                }.get(variant)
            )
        ):
            cuts = (
                [0]
                + [
                    i
                    for i, r in enumerate(stops)
                    if r["station_id_proposed"] in splits[identifier]
                ]
                + [len(stops) - 1]
            )
            for j, (first, last) in enumerate(itertools.pairwise(cuts)):
                for k, row in enumerate(stops[first : last + 1]):
                    output.append(
                        {
                            **row,
                            "service_id": identifier
                            if j == 0
                            else f"{identifier}-r2-part{j + 1}",
                            "order": str(k),
                            "endpoint_kind": (
                                "service-boundary"
                                if (k == 0 and j > 0)
                                or (k == last - first and last < len(stops) - 1)
                                else row["endpoint_kind"]
                            ),
                        }
                    )
        else:
            output.extend(stops)
    if variant == "merge-shinonoi":
        first = [r for r in rows if r["service_id"] == "jr-shinonoi"]
        second = [r for r in rows if r["service_id"] == "jr-shinetsu-nagano"]
        assert first[-1]["station_id_proposed"] == second[0]["station_id_proposed"]
        merged = first + second[1:]
        output = [
            r
            for r in rows
            if r["service_id"] not in ("jr-shinonoi", "jr-shinetsu-nagano")
        ]
        output += [
            {
                **r,
                "service_id": "jr-shinonoi",
                "order": str(i),
                "endpoint_kind": first[0]["endpoint_kind"]
                if i == 0
                else second[-1]["endpoint_kind"]
                if i == len(merged) - 1
                else "",
            }
            for i, r in enumerate(merged)
        ]
    if variant == "mito-through":
        mito = [r for r in rows if r["service_id"] == "jr-mito"]
        joban = [r for r in rows if r["service_id"] == "jr-joban-rapid"]
        tomobe = next(
            i for i, r in enumerate(joban) if r["station_id_proposed"] == "tomobe"
        )
        end = next(i for i, r in enumerate(joban) if r["station_id_proposed"] == "mito")
        assert mito[-1]["station_id_proposed"] == "tomobe"
        extended = mito + joban[tomobe + 1 : end + 1]
        output = [r for r in rows if r["service_id"] != "jr-mito"]
        output += [
            {
                **r,
                "service_id": "jr-mito",
                "service_kind": mito[0]["service_kind"],
                "service_name_ja": "水戸線 小山–水戸",
                "order": str(i),
                "endpoint_kind": mito[0]["endpoint_kind"]
                if i == 0
                else "service-boundary"
                if i == len(extended) - 1
                else "",
            }
            for i, r in enumerate(extended)
        ]
    return output


def build(rule: str, threshold: float, variant: str, out: Path) -> dict:
    rows, counts = load_rows()
    stations = {r["station_id_proposed"]: r for r in rows}
    points, missing = station_points(rows)
    if missing:
        raise ValueError(f"Unmatched N02 stations: {missing}")
    hull = MultiPoint(
        [p for i, p in points.items() if stations[i]["operator"] == JR]
    ).convex_hull
    cuts = [
        i
        for i, r in stations.items()
        if r["operator"] != JR and r["prefecture"] not in KANTO
    ]
    if cuts:
        raise ValueError(
            f"Unexpected geographic cuts require contiguous service splitting: {cuts}"
        )
    outside_hull = [
        i
        for i, r in stations.items()
        if r["operator"] != JR and not hull.covers(Point(points[i]))
    ]
    mapping, pairs, unresolved = identity_map(rows, points, rule, threshold)
    canonical = {mapping[i]: stations[mapping[i]]["station_name_ja"] for i in stations}
    converted = []
    services = []
    grouped = defaultdict(list)
    for row in variant_rows(rows, variant):
        grouped[row["service_id"]].append(row)
    for identifier, stops in grouped.items():
        ids = [mapping[r["station_id_proposed"]] for r in stops]
        assert len(ids) == len(set(ids)), f"Duplicate stops in {identifier}"
        for i, row in enumerate(stops):
            converted.append(
                {
                    **row,
                    "order": str(i),
                    "station_id_original": row["station_id_proposed"],
                    "station_name_original": row["station_name_ja"],
                    "station_id_proposed": ids[i],
                    "station_name_ja": canonical[ids[i]],
                    "service_type": row["service_kind"],
                }
            )
        services.append(
            {
                "service_id": identifier,
                "line_name": stops[0]["service_name_ja"],
                "service_type": stops[0]["service_kind"],
                "circular": stops[0]["is_loop"],
                "stop_ids": "|".join(ids),
                "first_end_kind": stops[0]["endpoint_kind"].replace(
                    "service-boundary", "through-split"
                ),
                "last_end_kind": stops[-1]["endpoint_kind"].replace(
                    "service-boundary", "through-split"
                ),
            }
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    write_csv(out.with_name(out.name + "-catalog.csv"), converted)
    write_csv(out.with_name(out.name + "-services.csv"), services)
    report = {
        "rule": rule,
        "threshold_m": threshold,
        "variant": variant,
        "r1_counts": counts,
        "input_stations": len(stations),
        "stations": len(set(mapping.values())),
        "services": len(services),
        "rows": len(converted),
        "geographic_cuts": cuts,
        "outside_jr_hull": outside_hull,
        "station_identity_map": mapping,
        "candidates": pairs,
        "unresolved_transfer_rows": unresolved,
        "source_sha256": {
            str(p): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(RESEARCH.glob("tokyo-suburban-r1-*-*.csv"))
            + [
                RESEARCH / "tokyo-suburban-r2-transfer-evidence.json",
                Path("N02-25_GML/UTF-8/N02-25_Station.geojson"),
                Path("N02-25_GML/UTF-8/N02-25_RailroadSection.geojson"),
            ]
        },
    }
    out.with_name(out.name + "-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: v
                for k, v in report.items()
                if k
                not in (
                    "station_identity_map",
                    "candidates",
                    "unresolved_transfer_rows",
                    "source_sha256",
                )
            },
            ensure_ascii=False,
        )
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rule", choices=["shared", "same-name", "official"], default="official"
    )
    parser.add_argument("--threshold", type=float, default=600)
    parser.add_argument(
        "--variant",
        choices=[
            "whole",
            "split",
            "split-joban",
            "split-chuo",
            "split-utsunomiya",
            "merge-shinonoi",
            "mito-through",
        ],
        default="whole",
    )
    parser.add_argument(
        "--out", type=Path, default=RESEARCH / "tokyo-suburban-research"
    )
    args = parser.parse_args()
    build(args.rule, args.threshold, args.variant, args.out)
