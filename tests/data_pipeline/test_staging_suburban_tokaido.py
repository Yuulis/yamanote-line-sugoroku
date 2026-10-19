"""Raw N02 regressions for the staged Tokaido and Ito services."""

from __future__ import annotations

import csv
import json

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.routing import RoutingError
from scripts.data_pipeline.stage_suburban_jr import (
    _candidate_options,
    _stop_resolution,
)

STAGE_DIR = (
    config.REPO_ROOT
    / "data"
    / "staging"
    / "tokyo-suburban-jr"
    / "tokaido"
    / "overrides"
)
FROZEN_CATALOG = (
    config.REPO_ROOT
    / ".claude"
    / "docs"
    / "research"
    / "tokyo-suburban-r1-jr-catalog.csv"
)

pytestmark = pytest.mark.skipif(
    not (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded (see data/README.md)",
)


def _frozen_stops(service_id: str) -> list[str]:
    with FROZEN_CATALOG.open(newline="", encoding="utf-8") as catalog_file:
        rows = csv.DictReader(catalog_file)
        return [
            row["station_id_proposed"]
            for row in sorted(
                (row for row in rows if row["service_id"] == service_id),
                key=lambda row: int(row["order"]),
            )
        ]


def test_tokaido_and_ito_follow_frozen_stops_and_correct_lines() -> None:
    overrides = load_overrides(STAGE_DIR)
    result = generate_build(config.DEFAULT_RAW_DIR, overrides)

    for service_id in ("jr-tokaido", "jr-ito"):
        assert list(overrides.service(service_id).station_ids) == _frozen_stops(
            service_id
        )

    tokaido = result.services["jr-tokaido"]
    yugawara_index = tokaido.service.station_ids.index("yugawara")
    assert tokaido.segment_lines[yugawara_index] == "東海道線"
    assert tokaido.routed.paths[yugawara_index].length > 0

    ito = result.services["jr-ito"]
    assert ito.segment_lines == ("伊東線",) * len(ito.routed.paths)
    assert all(path.length > 0 for path in ito.routed.paths)
    assert ito.service.station_ids[-1] == "ito"
    services = json.loads(result.files[config.SERVICES_FILE])["services"]
    ito_output = next(item for item in services if item["id"] == "jr-ito")
    assert ito_output["endpoints"]["last"] == "terminus"


def test_atami_uses_jr_east_platforms_and_scope_ends_before_kannami() -> None:
    overrides = load_overrides(STAGE_DIR)
    service = overrides.service("jr-tokaido")
    stop = next(item for item in service.stops if item.station_id == "atami")
    resolution, station = _stop_resolution(overrides, service, stop)
    source = N02SourceProvider(
        config.DEFAULT_RAW_DIR,
        candidate_search_bbox=overrides.dataset.candidate_search_bbox,
    ).for_operator(resolution.source_operator)

    options = _candidate_options(stop, resolution, station, source, {"東海道線"})
    assert {option.operator for option in options} == {"東日本旅客鉄道"}
    assert {option.station_code for option in options} == {"005686"}

    central_source = N02SourceProvider(
        config.DEFAULT_RAW_DIR,
        candidate_search_bbox=overrides.dataset.candidate_search_bbox,
    ).for_operator("東海旅客鉄道")
    with pytest.raises(RoutingError, match="no N02 platform for atami"):
        _candidate_options(stop, resolution, station, central_source, {"東海道線"})

    scope = {
        row["station_id"]: row["in_area"]
        for row in csv.DictReader(
            (STAGE_DIR / "services/jr-tokaido/scope.csv").open(encoding="utf-8")
        )
    }
    assert scope["atami"] == "true"
    assert scope["kannami"] == "false"
    assert "kannami" not in service.station_ids

    staged_service = json.loads(
        generate_build(config.DEFAULT_RAW_DIR, overrides).files[config.SERVICES_FILE]
    )["services"]
    staged_tokaido = next(item for item in staged_service if item["id"] == "jr-tokaido")
    assert staged_tokaido["endpoints"]["last"] == "area-boundary"
