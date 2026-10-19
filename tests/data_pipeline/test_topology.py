from __future__ import annotations

from scripts.data_pipeline.topology import directed_pairs


def test_non_target_loop_has_both_directions_in_pair_order() -> None:
    pairs = directed_pairs(
        ("a", "b", "c"),
        True,
        service_id="metro-loop",
        target_service_id="jr-yamanote",
    )

    assert pairs == [
        ("a", "b"),
        ("b", "a"),
        ("b", "c"),
        ("c", "b"),
        ("c", "a"),
        ("a", "c"),
    ]


def test_target_loop_has_only_forward_pairs() -> None:
    pairs = directed_pairs(
        ("a", "b", "c"),
        True,
        service_id="jr-yamanote",
        target_service_id="jr-yamanote",
    )

    assert pairs == [("a", "b"), ("b", "c"), ("c", "a")]


def test_open_chain_remains_forward_then_reverse_per_pair() -> None:
    pairs = directed_pairs(
        ("a", "b", "c"),
        False,
        service_id="jr-utsunomiya",
        target_service_id="jr-yamanote",
    )

    assert pairs == [
        ("a", "b"),
        ("b", "a"),
        ("b", "c"),
        ("c", "b"),
    ]
