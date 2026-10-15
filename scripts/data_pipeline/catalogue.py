"""Independent, hash-pinned dataset coverage oracle (never inferred at build time)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.topology import station_order

if TYPE_CHECKING:
    from scripts.data_pipeline.override_models import Overrides


def check_expected_catalogue(overrides: Overrides, directory: Path) -> None:
    name = overrides.dataset.expected_catalogue_file
    digest = overrides.dataset.expected_catalogue_sha256
    if not name or Path(name).name != name:
        raise OverrideError(
            "dataset must name an expectedCatalogFile in its override directory"
        )
    try:
        payload = (directory / name).read_bytes()
        raw = json.loads(payload)
    except (OSError, ValueError) as error:
        raise OverrideError(f"expected catalogue cannot be read: {error}") from error
    if not digest or hashlib.sha256(payload).hexdigest() != digest:
        raise OverrideError("expected catalogue SHA-256 mismatch")
    expected: dict[str, Any] = {
        "services": [
            {"id": service.id, "stationIds": list(service.station_ids)}
            for service in overrides.services
        ],
        "stationIds": list(
            station_order(service.station_ids for service in overrides.services)
        ),
    }
    if raw != expected:
        raise OverrideError(
            "expected catalogue mismatch: service order, stop lists or station coverage differs"
        )
