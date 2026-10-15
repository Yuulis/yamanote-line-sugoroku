"""Physical-track regressions using published geometry; no raw N02 required.

Sample points are interior points of the reviewed N02 branches, in WGS84.
They deliberately avoid shared endpoints, which cannot prove branch traversal.
See jr-east-capital-region-s6.md for sources and generalized-span limits.
"""

from __future__ import annotations

import json

import pytest
from shapely.geometry import LineString
from shapely.ops import unary_union

from scripts.data_pipeline import config
from scripts.data_pipeline.build import to_metric_point
from scripts.data_pipeline.overrides import load_overrides

BRANCHES = {
    "61967b18": (139.705286906, 35.539510452),
    "a88144bb": (139.705454212, 35.539436940),
    "21d405a8": (139.882505500, 35.768909110),
    "990bbe76": (139.882520934, 35.768614957),
    "eacbe1e8": (139.891238256, 35.770253412),
    "6924bdce": (139.891349563, 35.770007847),
    "bd4cd661": (139.674644182, 35.842441831),
    "a6459c6d": (139.668615011, 35.848335004),
}
ASSIGNMENTS = [
    ("jr-tokaido", "shinagawa", "kawasaki", "東海道線", "a88144bb", "61967b18"),
    ("jr-keihin-tohoku", "kamata", "kawasaki", "東海道線", "61967b18", "a88144bb"),
    ("jr-joban-rapid", "kita-senju", "matsudo", "常磐線", "990bbe76", "21d405a8"),
    ("jr-joban-rapid", "kita-senju", "matsudo", "常磐線", "eacbe1e8", "6924bdce"),
    ("jr-joban-local", "kanamachi", "matsudo", "常磐線", "21d405a8", "990bbe76"),
    ("jr-joban-local", "kanamachi", "matsudo", "常磐線", "6924bdce", "eacbe1e8"),
    ("jr-utsunomiya", "akabane", "urawa", "東北線", "bd4cd661", "a6459c6d"),
    ("jr-takasaki", "akabane", "urawa", "東北線", "bd4cd661", "a6459c6d"),
    ("jr-shonan-shinjuku-local", "urawa", "akabane", "東北線", "bd4cd661", "a6459c6d"),
    (
        "jr-shonan-shinjuku-rapid-takasaki",
        "urawa",
        "akabane",
        "東北線",
        "bd4cd661",
        "a6459c6d",
    ),
]


@pytest.mark.parametrize("service_id,start,end,line,chosen,rejected", ASSIGNMENTS)
def test_service_pins_and_traverses_reviewed_branch_in_both_directions(
    service_id: str, start: str, end: str, line: str, chosen: str, rejected: str
) -> None:
    overrides = load_overrides(config.DEFAULT_OVERRIDES_DIR)
    service = next(item for item in overrides.services if item.id == service_id)
    section_filter = service.section_filter(line)
    # Deny-only filters leave the intended branch open; allow lists pin it.
    assert not any(key.endswith(chosen) for key in section_filter.deny)
    if section_filter.allow:
        assert any(key.endswith(chosen) for key in section_filter.allow)
    assert any(key.endswith(rejected) for key in section_filter.deny)

    segments = json.loads((config.DEFAULT_OUT_DIR / "segments.json").read_text())
    features = json.loads((config.DEFAULT_OUT_DIR / "segments.geojson").read_text())
    geometries = {
        feature["id"]: LineString(
            [
                to_metric_point(tuple(xy)).coords[0]
                for xy in feature["geometry"]["coordinates"]
            ]
        )
        for feature in features["features"]
    }
    for a, b in [(start, end), (end, start)]:
        segment = next(
            item
            for item in segments
            if (item["serviceId"], item["from"], item["to"]) == (service_id, a, b)
        )
        path = unary_union([geometries[key] for key in segment["geometryFeatureIds"]])
        assert path.distance(to_metric_point(BRANCHES[chosen])) < 1.2
        assert path.distance(to_metric_point(BRANCHES[rejected])) > 10


def test_keihin_tohoku_keeps_the_minami_urawa_platform_branch() -> None:
    overrides = load_overrides(config.DEFAULT_OVERRIDES_DIR)
    service = next(item for item in overrides.services if item.id == "jr-keihin-tohoku")
    section_filter = service.section_filter("東北線")
    assert "139.66635 35.85033~139.68335 35.83490#bd4cd661" in section_filter.deny
    assert section_filter.admits("139.66760 35.84922~139.66963 35.84745#a6459c6d")
