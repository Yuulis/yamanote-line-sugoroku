"""D1 merge offset exception derivation and audit fixtures."""

from __future__ import annotations

from dataclasses import replace

import pytest

from scripts.data_pipeline.stage_suburban_assembly_offsets import (
    OffsetObservation,
    audit_offset_exceptions,
    derive_offset_exceptions,
)
from scripts.data_pipeline.stage_suburban_support import StageError


def _observation(
    *,
    measured: float = 291.286,
    pre_merge: float = 0.0,
    pre_limit: float = 250.0,
    merged: bool = True,
    pre_merge_passed: bool = True,
    source_stage: str = "S3",
) -> OffsetObservation:
    return OffsetObservation(
        service_id="toei-mita",
        station_id="tamachi",
        member_original_id="toei-mita",
        d1_group_id="tamachi" if merged else None,
        measured_a_offset_m=measured,
        pre_merge_offset_m=pre_merge,
        pre_merge_limit_m=pre_limit,
        pre_merge_passed=pre_merge_passed,
        source_stage=source_stage,
        source_group="toei-yokohama",
        source_component="toei-asakusa",
    )


def _old_exception(*, limit: str = "270") -> dict[str, str]:
    return {
        "service_id": "toei-mita",
        "station_id": "tamachi",
        "max_platform_offset_m": limit,
        "reason": "Reviewed pre-merge station offset.",
    }


def test_valid_d1_merge_row_is_derived_and_audited() -> None:
    observation = _observation(pre_merge=57.123)
    rows, review = derive_offset_exceptions(
        [observation], [_old_exception()], ["toei-mita"]
    )

    assert rows[0]["max_platform_offset_m"] == "310"
    assert "d1-merge" in rows[0]["reason"]
    assert "tamachi" in rows[0]["reason"]
    assert "toei-mita" in rows[0]["reason"]
    assert "291.286000 m" in rows[0]["reason"]
    assert "57.123000 m" in rows[0]["reason"]
    assert "250 m" in rows[0]["reason"]
    assert "600 m" in rows[0]["reason"]
    assert review["droppedOrReplacedRows"][0]["action"] == "replaced"
    audit_offset_exceptions(
        [observation], [_old_exception()], ["toei-mita"], rows, review
    )


def test_offset_over_default_at_non_merged_station_is_rejected() -> None:
    with pytest.raises(StageError, match="outside a merged D1 group"):
        derive_offset_exceptions([_observation(merged=False)], [], ["toei-mita"])


def test_passing_non_merge_exception_is_preserved() -> None:
    observation = _observation(merged=False, pre_merge=291.286, pre_limit=310)
    old_exception = _old_exception(limit="310")

    rows, review = derive_offset_exceptions(
        [observation], [old_exception], ["toei-mita"]
    )

    assert rows == [old_exception]
    assert review["preservedExistingRows"][0]["sourceStage"] == "S3"


def test_unchanged_d1_exception_is_preserved_without_replacement() -> None:
    observation = _observation(
        measured=259.306211,
        pre_merge=259.306211,
        pre_limit=270,
    )
    old_exception = _old_exception(limit="270")

    rows, review = derive_offset_exceptions(
        [observation], [old_exception], ["toei-mita"]
    )

    assert rows == [old_exception]
    assert review["d1MergeRows"] == []
    assert review["droppedOrReplacedRows"] == []
    assert review["preservedExistingRows"][0]["measuredAOffsetM"] == 259.306211


def test_d1_merge_offset_requires_a_passing_pre_merge_check() -> None:
    with pytest.raises(StageError, match="pre-merge offset check did not pass"):
        derive_offset_exceptions(
            [_observation(pre_merge=280, pre_limit=270, pre_merge_passed=False)],
            [],
            ["toei-mita"],
        )


def test_d1_merge_offset_over_frozen_bound_is_rejected() -> None:
    with pytest.raises(StageError, match="exceeds the frozen 600 m bound"):
        derive_offset_exceptions([_observation(measured=600.001)], [], ["toei-mita"])


def test_audit_rejects_wrong_limit() -> None:
    observation = _observation()
    rows, review = derive_offset_exceptions([observation], [], ["toei-mita"])
    wrong_rows = [{**rows[0], "max_platform_offset_m": "300"}]

    with pytest.raises(StageError, match="do not match the re-derived offsets"):
        audit_offset_exceptions([observation], [], ["toei-mita"], wrong_rows, review)


def test_audit_rejects_stale_measured_value() -> None:
    observation = _observation()
    rows, review = derive_offset_exceptions([observation], [], ["toei-mita"])
    stale_rows = [
        {**rows[0], "reason": rows[0]["reason"].replace("291.286", "290.000")}
    ]

    with pytest.raises(StageError, match="do not match the re-derived offsets"):
        audit_offset_exceptions([observation], [], ["toei-mita"], stale_rows, review)


def test_unused_s3_exception_is_dropped_and_listed() -> None:
    observation = replace(
        _observation(measured=140.0, pre_merge=299.0, pre_limit=310.0),
        station_id="iidabashi",
        d1_group_id="iidabashi",
    )
    old_exception = {
        **_old_exception(limit="310"),
        "station_id": "iidabashi",
        "reason": "Pre-merge offset exception no longer needed after D1 merge.",
    }
    rows, review = derive_offset_exceptions(
        [observation], [old_exception], ["toei-mita"]
    )

    assert rows == []
    assert review["droppedOrReplacedRows"] == [
        {
            "action": "dropped",
            "serviceId": "toei-mita",
            "stationId": "iidabashi",
            "sourceStage": "S3",
            "sourceGroup": "toei-yokohama",
            "sourceComponent": "toei-asakusa",
            "previousLimitM": 310.0,
            "previousReason": old_exception["reason"],
            "measuredAOffsetM": 140.0,
            "explanation": "The merged A offset is within the global 250 m limit.",
        }
    ]
