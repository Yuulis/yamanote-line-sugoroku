"""Per-dataset payload and primitive-reference budgets; deterministic gzip reports."""

from __future__ import annotations

import gzip
from collections.abc import Mapping
from typing import Any

from scripts.data_pipeline import config
from scripts.data_pipeline.registry import OverrideError

# Regional payload caps are provisional until S6P measures the full staging data.
BUDGET_PROFILES: dict[str, dict[str, int]] = {
    "23ku": {
        "geojsonRaw": config.MAX_GEOJSON_BYTES,
        "geojsonGzip": 100_000,
        "totalRaw": 1_048_576,
        "totalGzip": 307_200,
        "references": 1_000,
        "maxChainLength": 64,
    },
    "capital-region": {
        "geojsonRaw": 1_572_864,
        "geojsonGzip": 460_800,
        "totalRaw": 3_145_728,
        "totalGzip": 921_600,
        "references": 20_000,
        "maxChainLength": 128,
    },
}


def parse_budgets(raw: Any) -> tuple[str, dict[str, int]]:
    profile = raw.get("budgetProfile", "23ku")
    if not isinstance(profile, str) or profile not in BUDGET_PROFILES:
        raise OverrideError("unknown budgetProfile")
    limits = raw.get("budgets", {})
    if (
        not isinstance(limits, dict)
        or not set(limits) <= set(BUDGET_PROFILES[profile])
        or any(
            isinstance(v, bool) or not isinstance(v, int) or v <= 0
            for v in limits.values()
        )
    ):
        raise OverrideError("budgets must contain known positive integer limits")
    return profile, {**BUDGET_PROFILES[profile], **limits}


def size_report(
    files: Mapping[str, str], references: int, max_chain: int
) -> dict[str, int]:
    sizes = {}
    for name, payload in files.items():
        data = payload.encode("utf-8")
        sizes[f"bytes[{name}]"] = len(data)
        sizes[f"gzip_bytes[{name}]"] = len(
            gzip.compress(data, compresslevel=9, mtime=0)
        )
    sizes["total_raw_bytes"] = sum(sizes[f"bytes[{name}]"] for name in files)
    sizes["total_gzip_bytes"] = sum(sizes[f"gzip_bytes[{name}]"] for name in files)
    sizes["geometry_reference_count"] = references
    sizes["max_geometry_chain_length"] = max_chain
    return sizes


def budget_errors(metrics: Mapping[str, Any], limits: Mapping[str, int]) -> list[str]:
    keys = {
        "geojsonRaw": f"bytes[{config.SEGMENTS_GEOJSON_FILE}]",
        "geojsonGzip": f"gzip_bytes[{config.SEGMENTS_GEOJSON_FILE}]",
        "totalRaw": "total_raw_bytes",
        "totalGzip": "total_gzip_bytes",
        "references": "geometry_reference_count",
        "maxChainLength": "max_geometry_chain_length",
    }
    return [
        f"budget overrun {name}: {metrics.get(key, 0)} > {limits[name]}"
        for name, key in keys.items()
        if metrics.get(key, 0) > limits[name]
    ]


def file_size_report(files: Mapping[str, str]) -> dict[str, int]:
    """Measure all five serialized files, plus flattened directed references."""
    import json

    segments = json.loads(files[config.SEGMENTS_FILE])
    chains = [segment["geometryFeatureIds"] for segment in segments]
    return size_report(files, sum(map(len, chains)), max(map(len, chains), default=0))


def check_file_budgets(files: Mapping[str, str], limits: Mapping[str, int]) -> None:
    errors = budget_errors(file_size_report(files), limits)
    if errors:
        raise OverrideError("; ".join(errors))
