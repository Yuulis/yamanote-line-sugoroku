"""Independent R2 acceptance and regression checks; no product data is written."""

from __future__ import annotations

import itertools
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path
from unittest.mock import patch

from build_catalog import RESEARCH, identity_map, load_rows, read_csv, variant_rows


class CsvRegressionChecks(unittest.TestCase):
    def test_reject_surplus_and_missing_columns(self) -> None:
        for content in ("a,b\n1,2,3\n", "a,b\n1\n", "a,a\n1,2\n"):
            with (
                self.subTest(content=content),
                tempfile.TemporaryDirectory() as directory,
            ):
                path = Path(directory) / "bad.csv"
                path.write_text(content)
                with self.assertRaises(ValueError):
                    read_csv(path)

    def test_keep_quoted_commas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "good.csv"
            path.write_text('id,notes\na,"one, two"\n')
            self.assertEqual(read_csv(path), [{"id": "a", "notes": "one, two"}])

    def test_same_name_without_official_evidence_does_not_merge(self) -> None:
        # All same-name candidates are non-evidence and must stay separate.
        rows = [
            {
                "station_id_proposed": i,
                "station_name_ja": "test",
                "operator": op,
                "service_id": service,
            }
            for i, op, service in [
                ("a", "test-a", "s"),
                ("b", "test-b", "t"),
                ("c", "test-c", "s"),
            ]
        ]
        mapping, _, _ = identity_map(
            rows, {"a": (139, 35), "b": (139, 35), "c": (139, 35)}, "official", 500
        )
        self.assertEqual(len(set(mapping.values())), 3)

    def test_official_chain_rejects_service_collapse_and_wide_components(self) -> None:
        for services, coordinates, reason in [
            (["s", "t", "s"], [(139, 35)] * 3, "rejected-same-service-collapse"),
            (
                ["s", "t", "u"],
                [(139, 35), (139.004, 35), (139.008, 35)],
                "rejected-component-diameter",
            ),
        ]:
            rows = [
                {
                    "station_id_proposed": i,
                    "station_name_ja": i,
                    "operator": i,
                    "service_id": s,
                }
                for i, s in zip(["a", "b", "c"], services, strict=True)
            ]
            pairs = [
                {
                    "a": a,
                    "b": b,
                    "name_a": a,
                    "name_b": b,
                    "distance_m": 300,
                    "official_evidence": True,
                }
                for a, b in [("a", "b"), ("b", "c")]
            ]
            with patch("build_catalog.transfer_candidates", return_value=(pairs, [])):
                mapping, decisions, _ = identity_map(
                    rows,
                    dict(zip(["a", "b", "c"], coordinates, strict=True)),
                    "official",
                    500,
                )
            self.assertEqual(len(set(mapping.values())), 2)
            self.assertIn(reason, [p["decision"] for p in decisions])


def validate_pair(prefix: Path, preserve_services: bool = True) -> dict:
    rows = read_csv(prefix.with_name(prefix.name + "-catalog.csv"))
    services = read_csv(prefix.with_name(prefix.name + "-services.csv"))
    grouped = defaultdict(list)
    names = {}
    for row in rows:
        grouped[row["service_id"]].append(row)
        identifier = row["station_id_proposed"]
        if identifier in names:
            assert names[identifier] == row["station_name_ja"], identifier
        names[identifier] = row["station_name_ja"]
    assert len(services) == len(grouped)
    assert len({r["service_id"] for r in services}) == len(services)
    for service in services:
        stops = grouped[service["service_id"]]
        assert [r["order"] for r in stops] == list(map(str, range(len(stops))))
        ids = [r["station_id_proposed"] for r in stops]
        assert len(set(ids)) == len(ids) and len(ids) >= 2
        assert "|".join(ids) == service["stop_ids"]
        loop = service["circular"] == "true"
        assert all((r["is_loop"] == "true") == loop for r in stops)
        assert [i for i, r in enumerate(stops) if r["endpoint_kind"]] == (
            [] if loop else [0, len(stops) - 1]
        )
        assert service["service_type"] in ("local", "rapid")
        assert all(r["service_type"] == service["service_type"] for r in stops)
    # Every shipped station id and service id survives in the recommended whole input.
    shipped = read_csv(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    shipped_ids = {r["station_id"] for r in shipped}
    assert len(shipped_ids) == 472
    assert shipped_ids <= names.keys(), shipped_ids - names.keys()
    if preserve_services:
        shipped_services = {r["service_id"] for r in shipped}
        assert len(shipped_services) == 40
        assert shipped_services <= grouped.keys()
        for service in shipped_services:
            original = [r["station_id"] for r in shipped if r["service_id"] == service]
            ids = [r["station_id_proposed"] for r in grouped[service]]
            assert any(
                ids[i : i + len(original)] == original for i in range(len(ids))
            ), service
    adjacent = defaultdict(set)
    for service in services:
        ids = service["stop_ids"].split("|")
        pairs = list(itertools.pairwise(ids)) + (
            [(ids[-1], ids[0])] if service["circular"] == "true" else []
        )
        for a, b in pairs:
            adjacent[a].add(b)
            adjacent[b].add(a)
    reached = {"shimbashi"}
    queue = ["shimbashi"]
    for station in queue:
        for neighbor in adjacent[station] - reached:
            reached.add(neighbor)
            queue.append(neighbor)
    return {
        "rows": len(rows),
        "services": len(services),
        "stations": len(names),
        "reachable_from_shimbashi": len(reached),
        "unreachable": sorted(names.keys() - reached),
    }


def validate_variants() -> None:
    rows, _ = load_rows()
    original = {r["station_id_proposed"] for r in rows}
    for name in (
        "whole",
        "split",
        "split-joban",
        "split-chuo",
        "split-utsunomiya",
        "merge-shinonoi",
        "mito-through",
    ):
        changed = variant_rows(rows, name)
        assert {r["station_id_proposed"] for r in changed} == original, name
        grouped = defaultdict(list)
        for r in changed:
            grouped[r["service_id"]].append(r)
        for service, stops in grouped.items():
            assert len({r["service_kind"] for r in stops}) == 1, (name, service)
            assert [r["order"] for r in stops] == list(map(str, range(len(stops)))), (
                name,
                service,
            )
            assert len({r["station_id_proposed"] for r in stops}) == len(stops), (
                name,
                service,
            )
    print(
        "PASS all representation variants preserve station coverage, unique stops, and order"
    )


if __name__ == "__main__":
    import json
    import sys

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CsvRegressionChecks)
    if not unittest.TextTestRunner().run(suite).wasSuccessful():
        sys.exit(1)
    validate_variants()
    print(
        json.dumps(
            validate_pair(RESEARCH / "tokyo-suburban-research"), ensure_ascii=False
        )
    )
