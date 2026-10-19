#!/usr/bin/env python3
"""Acceptance checks for additive R1b inventories and raw N02 membership."""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = ROOT / ".claude/docs/research"
N02 = ROOT / "N02-25_GML/UTF-8"
SCHEMA = [
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
]
TRANSFER_SCHEMA = [
    "station_id",
    "operator",
    "other_operator",
    "other_station_name",
    "walking_note",
    "source_url",
]


def read(path: Path, expected: list[str]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        assert r.fieldnames == expected, f"{path.name}: schema {r.fieldnames!r}"
        rows = list(r)
    for line, row in enumerate(rows, start=2):
        assert None not in row, f"{path.name}:{line}: surplus columns"
        assert all(value is not None for value in row.values()), (
            f"{path.name}:{line}: missing columns"
        )
    assert rows, f"{path.name}: empty"
    return rows


def raw_index(filename: str) -> list[dict[str, str]]:
    data = json.loads((N02 / filename).read_text(encoding="utf-8"))
    return [f["properties"] for f in data["features"]]


def check_catalog(
    path: Path,
    service_counts: dict[str, int],
    expected_rows: int,
    expected_ids: int,
    station_features: list[dict[str, str]],
    rail_features: set[tuple[str, str]],
) -> None:
    rows = read(path, SCHEMA)
    assert len(rows) == expected_rows, (
        f"{path.name}: row count {len(rows)} != {expected_rows}"
    )
    by_service = defaultdict(list)
    ids_by_operator_name = defaultdict(set)
    for r in rows:
        assert all(
            r[k].strip()
            for k in SCHEMA
            if k not in ("endpoint_kind", "station_code", "notes")
        ), (path.name, r)
        assert r["service_kind"] == "local" and r["is_loop"] == "false", (path.name, r)
        assert r["prefecture"].endswith("県") or r["prefecture"] == "東京都", (
            path.name,
            r,
        )
        assert r["station_id_proposed"].startswith(
            {
                "横浜高速鉄道": "mm-",
                "北総鉄道": "hokuso-",
                "京浜急行電鉄": "keikyu-",
                "東武鉄道": "tobu-",
                "京成電鉄": "keisei-",
            }[r["operator"]]
        ), (path.name, r)
        matching = [
            p
            for p in station_features
            if p.get("N02_005") == r["station_name_ja"]
            and p.get("N02_004") == r["n02_operator"]
            and p.get("N02_003") == r["n02_line"]
        ]
        assert matching, (
            f"{path.name}: N02 station membership absent/mismapped for {r['station_name_ja']} ({r['n02_operator']}/{r['n02_line']})"
        )
        assert (r["n02_operator"], r["n02_line"]) in rail_features, (
            f"{path.name}: N02 railroad section absent for {r['n02_operator']}/{r['n02_line']}"
        )
        by_service[r["service_id"]].append(r)
        ids_by_operator_name[(r["operator"], r["station_name_ja"])].add(
            r["station_id_proposed"]
        )
    ids = {r["station_id_proposed"] for r in rows}
    assert len(ids) == expected_ids, (
        f"{path.name}: unique ids {len(ids)} != {expected_ids}"
    )
    assert {k: len(v) for k, v in by_service.items()} == service_counts, (
        f"{path.name}: service counts { {k: len(v) for k, v in by_service.items()} }"
    )
    for (operator, name), station_ids in ids_by_operator_name.items():
        assert len(station_ids) == 1, (
            f"{path.name}: one {operator}/{name} has inconsistent IDs {station_ids}"
        )
    for sid, rs in by_service.items():
        rs.sort(key=lambda r: int(r["order"]))
        orders = [int(r["order"]) for r in rs]
        assert orders == list(range(len(rs))), (
            f"{path.name}/{sid}: non-contiguous orders {orders}"
        )
        ends = [i for i, r in enumerate(rs) if r["endpoint_kind"]]
        assert ends == [0, len(rs) - 1], f"{path.name}/{sid}: endpoints {ends}"
        assert all(
            r["endpoint_kind"] in ("terminus", "service-boundary", "area-boundary")
            for r in rs
            if r["endpoint_kind"]
        ), sid
        assert len({r["station_id_proposed"] for r in rs}) == len(rs), (
            f"{path.name}/{sid}: duplicate station IDs"
        )
    print(
        f"PASS {path.name}: {len(rows)} rows, {len(by_service)} services, {len(ids)} unique IDs; all N02 station and line memberships match"
    )


def main() -> None:
    station_features = raw_index("N02-25_Station.geojson")
    rail_features = {
        (p.get("N02_004"), p.get("N02_003"))
        for p in raw_index("N02-25_RailroadSection.geojson")
    }
    check_catalog(
        RESEARCH / "tokyo-suburban-r1-extra-catalog.csv",
        {"mm-minatomirai": 6, "hokuso-main": 15},
        21,
        21,
        station_features,
        rail_features,
    )
    check_catalog(
        RESEARCH / "tokyo-suburban-r1-exceptions-catalog.csv",
        {"keikyu-kurihama": 9, "tobu-oshiage": 2, "keisei-narita-airport-access": 4},
        15,
        15,
        station_features,
        rail_features,
    )
    exception_rows = read(RESEARCH / "tokyo-suburban-r1-exceptions-catalog.csv", SCHEMA)
    added_keisei = {
        r["station_name_ja"]: r["station_id_proposed"]
        for r in exception_rows
        if r["service_id"] == "keisei-narita-airport-access"
    }
    assert added_keisei == {
        "印旛日本医大": "keisei-imba-nihon-idai",
        "成田湯川": "keisei-narita-yukawa",
        "空港第2ビル": "keisei-airport-terminal-2",
        "成田空港": "keisei-narita-airport-terminal-1",
    }, f"Keisei segment IDs/names mismatch: {added_keisei}"
    keisei_prior = read(RESEARCH / "tokyo-suburban-r1-pe-catalog.csv", SCHEMA)
    prior_ids = {
        r["station_name_ja"]: r["station_id_proposed"]
        for r in keisei_prior
        if r["operator"] == "京成電鉄"
    }
    assert (
        added_keisei["空港第2ビル"] == prior_ids["空港第2ビル"]
        and added_keisei["成田空港"] == prior_ids["成田空港"]
    ), "airport station IDs must reuse existing Keisei identities"
    hokuso_takasago = next(
        r["station_id_proposed"]
        for r in read(RESEARCH / "tokyo-suburban-r1-extra-catalog.csv", SCHEMA)
        if r["station_name_ja"] == "京成高砂"
    )
    assert (
        hokuso_takasago == "hokuso-keisei-takasago"
        and hokuso_takasago != prior_ids["京成高砂"]
    ), "operator-boundary IDs must remain separate until R2"
    print(
        "PASS IDs: Keisei airport IDs reused; shared-use Keisei-Takasago remains operator-specific"
    )
    transfers = read(
        RESEARCH / "tokyo-suburban-r1-extra-transfers.csv", TRANSFER_SCHEMA
    )
    assert len(transfers) == 8, f"transfer rows {len(transfers)} != 8"
    keys = {(r["station_id"], r["other_operator"]) for r in transfers}
    assert len(keys) == len(transfers), "duplicate transfer rows"
    assert all(
        r["station_id"]
        and r["operator"]
        and r["other_operator"]
        and r["other_station_name"]
        and r["source_url"]
        for r in transfers
    )
    assert ("hokuso-keisei-takasago", "北総鉄道") not in keys
    print(f"PASS tokyo-suburban-r1-extra-transfers.csv: {len(transfers)} transfer rows")


if __name__ == "__main__":
    main()
