"""Skip markers for inputs that are intentionally kept out of git."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.data_pipeline import config

ROOT = Path(__file__).resolve().parents[2]
RAW_N02_FILES = (
    config.DEFAULT_RAW_DIR / config.RAW_STATION_FILE,
    config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE,
)


def requires_raw_n02() -> pytest.MarkDecorator:
    available = all(path.is_file() for path in RAW_N02_FILES)
    return pytest.mark.skipif(
        not available,
        reason="raw N02 data not downloaded (see data/README.md)",
    )


def requires_local_evidence(*paths: str) -> pytest.MarkDecorator:
    missing = [path for path in paths if not (ROOT / path).is_file()]
    first_missing = missing[0] if missing else paths[0]
    return pytest.mark.skipif(
        bool(missing),
        reason=(
            f"local evidence {first_missing} not present (git-ignored .claude/logs)"
        ),
    )
