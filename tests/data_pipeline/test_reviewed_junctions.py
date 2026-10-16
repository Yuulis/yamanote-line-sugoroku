from __future__ import annotations

import pytest
from shapely.geometry import LineString

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import (
    ConstraintError,
    JunctionRule,
    parse_junction_rows,
)
from scripts.data_pipeline.n02 import (
    N02Source,
    SourceDataError,
    TrackSection,
    split_reviewed_junctions,
)
from scripts.data_pipeline.network import NoPathError, TrackNetwork


def _rule(lon: float = 1.0, lat: float = 1.0) -> JunctionRule:
    return JunctionRule(
        "JR", "常磐線", "target", "peer", lon, lat, "Reviewed exact node"
    )


def _sections() -> list[TrackSection]:
    return [
        TrackSection(
            "target",
            LineString([(0, 0), (1, 0), (2, 0)]),
            ((0.0, 0.0), (1.0, 1.0), (2.0, 0.0)),
        ),
        TrackSection(
            "peer",
            LineString([(1, 0), (1, 1)]),
            ((1.0, 1.0), (1.0, 2.0)),
        ),
    ]


def test_reviewed_junction_splits_only_at_exact_shared_vertex_and_preserves_length() -> (
    None
):
    sections = _sections()

    result = split_reviewed_junctions(sections, [_rule()])

    assert [item.key for item in result] == ["target", "target", "peer"]
    assert sum(item.geometry.length for item in result[:2]) == pytest.approx(
        sections[0].geometry.length
    )
    assert list(result[0].geometry.coords)[-1] == list(result[1].geometry.coords)[0]
    assert result[1].geometry.coords[0] == result[2].geometry.coords[0]


def test_reviewed_junction_rejects_coordinate_one_millimetre_away() -> None:
    with pytest.raises(SourceDataError, match="exact internal source vertex"):
        split_reviewed_junctions(_sections(), [_rule(1.0, 1.00000001)])


def test_reviewed_junction_rejects_unknown_section_key() -> None:
    rule = JunctionRule("JR", "常磐線", "missing", "peer", 1.0, 1.0, "reason")
    with pytest.raises(SourceDataError, match="section keys must each resolve once"):
        split_reviewed_junctions(_sections(), [rule])


def test_reviewed_junction_rejects_non_endpoint_peer() -> None:
    sections = _sections()
    sections[1] = TrackSection("peer", sections[1].geometry, ((1.1, 1.0), (1.0, 2.0)))
    with pytest.raises(SourceDataError, match="not a peer section endpoint"):
        split_reviewed_junctions(sections, [_rule()])


def test_junction_csv_parser_rejects_duplicate_or_empty_rules() -> None:
    row = {
        "n02_operator": "JR",
        "n02_line": "常磐線",
        "section_key": "target",
        "peer_section_key": "peer",
        "lon": "1",
        "lat": "1",
        "reason": "Reviewed exact node",
    }
    with pytest.raises(ConstraintError, match="duplicate junction"):
        parse_junction_rows([row, row])
    with pytest.raises(ConstraintError, match="at least one rule"):
        parse_junction_rows([])


@pytest.mark.skipif(
    not (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded (see data/README.md)",
)
def test_j_village_reviewed_junction_connects_hirono_through_to_kido() -> None:
    source = N02Source(
        config.DEFAULT_RAW_DIR,
        "東日本旅客鉄道",
        (140.8, 37.0, 141.2, 37.4),
    )
    platforms = {
        name: source.platform_candidates([name], ["常磐線"])[0]
        for name in ("広野", "Jヴィレッジ", "木戸")
    }
    sections = source.track_sections(
        ["常磐線"], [platform.midpoint for platform in platforms.values()]
    )["常磐線"]
    rule = JunctionRule(
        "東日本旅客鉄道",
        "常磐線",
        "141.00748 37.24274~141.00776 37.24270#9d1f3f94",
        "140.99921 37.21210~141.00738 37.24077#de4dc6de",
        141.0073806,
        37.24077448,
        "Jヴィレッジ platform section shares the exact source vertex",
    )
    network = TrackNetwork(
        [item.geometry for item in split_reviewed_junctions(sections, [rule])]
    )

    with pytest.raises(NoPathError):
        TrackNetwork([item.geometry for item in sections]).shortest_path(
            platforms["広野"].midpoint, platforms["木戸"].midpoint
        )
    path = network.shortest_path(platforms["広野"].midpoint, platforms["木戸"].midpoint)

    assert path.start_offset <= config.MAX_SNAP_OFFSET_M
    assert path.end_offset <= config.MAX_SNAP_OFFSET_M
    assert path.length > platforms["広野"].midpoint.distance(platforms["木戸"].midpoint)
