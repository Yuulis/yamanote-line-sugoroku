from __future__ import annotations

import pytest

from scripts.data_pipeline.registry import (
    Area,
    OverrideError,
    Registry,
    RegistryStation,
    check_scope,
    parse_scope,
)


def _registry(*rows: tuple[str, str, str]) -> Registry:
    return Registry(
        tuple(
            RegistryStation(station, station, station, prefecture, municipality, "jr")
            for station, prefecture, municipality in rows
        )
    )


def _scope(*rows: tuple[str, str, str, str]) -> tuple:
    return parse_scope(
        [
            {
                "station_id": station,
                "prefecture": prefecture,
                "municipality": municipality,
                "in_area": in_area,
            }
            for station, prefecture, municipality, in_area in rows
        ]
    )


def test_explicit_scope_accepts_contiguous_stops_outside_dataset_prefecture() -> None:
    registry = _registry(
        ("before", "東京都", "区"),
        ("a", "栃木県", "市"),
        ("b", "栃木県", "市"),
        ("after", "茨城県", "市"),
    )
    evidence = _scope(
        ("before", "東京都", "区", "false"),
        ("a", "栃木県", "市", "true"),
        ("b", "栃木県", "市", "true"),
        ("after", "茨城県", "市", "false"),
    )

    boundaries = check_scope(
        "jr",
        ("a", "b"),
        evidence,
        registry,
        Area(("東京都",)),
        ("area-boundary", "area-boundary"),
    )

    assert [(item.last_in_area, item.first_out_of_area) for item in boundaries] == [
        ("a", "before"),
        ("b", "after"),
    ]


def test_explicit_scope_rejects_noncontiguous_true_rows() -> None:
    registry = _registry(("a", "栃木県", "市"), ("b", "栃木県", "市"))
    evidence = _scope(
        ("a", "栃木県", "市", "true"),
        ("b", "栃木県", "市", "false"),
        ("a2", "栃木県", "市", "true"),
    )

    with pytest.raises(OverrideError, match="out-of-area gap"):
        check_scope("jr", ("a", "a2"), evidence, registry, Area(("栃木県",)), None)


@pytest.mark.parametrize("value", ["", "TRUE", "yes"])
def test_explicit_scope_rejects_blank_or_nonliteral_boolean(value: str) -> None:
    with pytest.raises(OverrideError, match="exactly true or false"):
        _scope(("a", "栃木県", "市", value))


def test_explicit_scope_requires_immediate_false_boundary_neighbour() -> None:
    registry = _registry(("a", "栃木県", "市"), ("b", "栃木県", "市"))
    evidence = _scope(("a", "栃木県", "市", "true"), ("b", "栃木県", "市", "true"))

    with pytest.raises(OverrideError, match="boundary truncation evidence disagrees"):
        check_scope(
            "jr",
            ("a", "b"),
            evidence,
            registry,
            Area(("栃木県",)),
            ("area-boundary", "area-boundary"),
        )


def test_explicit_scope_rejects_served_stop_missing_from_stops_or_registry() -> None:
    evidence = _scope(("missing", "栃木県", "市", "true"))

    with pytest.raises(OverrideError, match="differs from stops.csv"):
        check_scope("jr", (), evidence, Registry(()), Area(("栃木県",)), None)

    with pytest.raises(OverrideError, match="missing from registry"):
        check_scope(
            "jr",
            ("missing",),
            evidence,
            Registry(()),
            Area(("栃木県",)),
            None,
        )


def test_explicit_scope_rejects_unsupported_prefecture() -> None:
    registry = _registry(("a", "沖縄県", "市"))
    evidence = _scope(("a", "沖縄県", "市", "true"))

    with pytest.raises(OverrideError, match="unsupported in-area prefecture"):
        check_scope("jr", ("a",), evidence, registry, Area(("沖縄県",)), None)


def test_legacy_scope_without_in_area_uses_prefecture_area() -> None:
    evidence = parse_scope(
        [
            {"station_id": "before", "prefecture": "山梨県", "municipality": "市"},
            {"station_id": "a", "prefecture": "東京都", "municipality": "区"},
            {"station_id": "after", "prefecture": "埼玉県", "municipality": "市"},
        ]
    )
    registry = _registry(
        ("before", "山梨県", "市"),
        ("a", "東京都", "区"),
        ("after", "埼玉県", "市"),
    )

    boundaries = check_scope(
        "jr",
        ("a",),
        evidence,
        registry,
        Area(("東京都",)),
        ("area-boundary", "area-boundary"),
    )

    assert len(boundaries) == 2
