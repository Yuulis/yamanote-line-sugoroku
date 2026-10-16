"""Raw N02 regression checks for the Takasaki/Ryomo staging region."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.constraints import parse_platform_selector
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.routing import RoutingError
from scripts.data_pipeline.stage_suburban_jr import (
    ROOT,
    _candidate_options,
    _stop_resolution,
)

RAW_AVAILABLE = (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file()

pytestmark = pytest.mark.skipif(
    not RAW_AVAILABLE, reason="raw N02 data not downloaded (see data/README.md)"
)

STAGE_DIR = ROOT / "data/staging/tokyo-suburban-jr/takasaki/overrides"


@pytest.fixture(scope="module")
def staged_build():
    """Build the reviewed region once for its real-track regressions."""
    overrides = load_overrides(STAGE_DIR)
    return overrides, generate_build(config.DEFAULT_RAW_DIR, overrides)


def test_takasaki_region_routes_catalog_and_preserves_reverse_compose(staged_build):
    overrides, result = staged_build
    assert len(overrides.services) == len(overrides.dataset.service_ids)
    assert set(overrides.dataset.service_ids) >= {
        "jr-takasaki",
        "jr-shonan-shinjuku-rapid-takasaki",
        "jr-hachiko",
        "jr-joetsu",
        "jr-agatsuma",
        "jr-ryomo",
        "jr-shinetsu-yokokawa",
    }

    segments = {
        row["id"]: row["geometryFeatureIds"]
        for row in json.loads(result.files[config.SEGMENTS_FILE])
    }
    forward = segments["jr-hachiko:kuragano:takasaki"]
    backward = segments["jr-hachiko:takasaki:kuragano"]
    assert forward == ["jr-takasaki:kuragano~takasaki"]
    assert backward == list(reversed(forward))
    hachiko = result.services["jr-hachiko"]
    owner = result.services["jr-takasaki"]
    hachiko_index = hachiko.service.station_ids.index("kuragano")
    owner_index = owner.service.station_ids.index("kuragano")
    assert list(hachiko.routed.paths[hachiko_index].geometry.coords) == list(
        owner.routed.paths[owner_index].geometry.coords
    )


def test_takasaki_line_name_boundaries_and_new_maebashi_anchor_succeed(staged_build):
    _, result = staged_build

    def selected(service_id: str, station_id: str):
        service = result.services[service_id]
        index = service.service.station_ids.index(station_id)
        return service.routed.chosen[index]

    # Hachiko's final pair composes the Takasaki Line owner's pair.
    hachiko = result.services["jr-hachiko"]
    assert hachiko.segment_lines[-1] == ""
    assert hachiko.routed.paths[-1].length > 0
    takasaki = result.services["jr-takasaki"]
    kuragano_index = takasaki.service.station_ids.index("kuragano")
    assert takasaki.segment_lines[kuragano_index] == "高崎線"
    ryomo = result.services["jr-ryomo"]
    shim_index = ryomo.service.station_ids.index("shim-maebashi")
    assert ryomo.segment_lines[shim_index - 1] == ""
    assert ryomo.segment_lines[shim_index] == "両毛線"
    joetsu = result.services["jr-joetsu"]
    joetsu_shim_index = joetsu.service.station_ids.index("shim-maebashi")
    assert joetsu.segment_lines[joetsu_shim_index - 1] == "上越線"

    owner_anchor = selected("jr-joetsu", "shim-maebashi")
    consumer_anchor = selected("jr-ryomo", "shim-maebashi")
    assert owner_anchor.operator == consumer_anchor.operator == "東日本旅客鉄道"
    assert owner_anchor.n02_line == "上越線"
    assert consumer_anchor.group_code
    assert owner_anchor.group_code == consumer_anchor.group_code
    assert owner_anchor.midpoint.equals(consumer_anchor.midpoint)
    assert ryomo.routed.paths[shim_index].geometry.coords[0] == (
        owner_anchor.midpoint.x,
        owner_anchor.midpoint.y,
    )


def test_wrong_platform_group_and_operator_are_rejected():
    overrides = load_overrides(STAGE_DIR)
    service = overrides.service("jr-ryomo")
    stop = next(item for item in service.stops if item.station_id == "oyama")
    resolution, station = _stop_resolution(overrides, service, stop)
    source = N02SourceProvider(
        config.DEFAULT_RAW_DIR,
        candidate_search_bbox=overrides.dataset.candidate_search_bbox,
    ).for_operator(resolution.source_operator)
    lines = {"両毛線"}

    wrong_group = replace(
        stop,
        platform_selector=parse_platform_selector(
            "line=両毛線;group=wrong-reviewed-group"
        ),
    )
    with pytest.raises(RoutingError, match="no N02 platform for oyama"):
        _candidate_options(wrong_group, resolution, station, source, lines)

    wrong_operator = replace(resolution, source_operator="wrong operator")
    with pytest.raises(RoutingError, match="no N02 platform for oyama"):
        _candidate_options(stop, wrong_operator, station, source, lines)
