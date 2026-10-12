"""Shared fixtures for the data pipeline tests."""

from __future__ import annotations

import copy
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.validate import Dataset, load_dataset
from tests.data_pipeline.support import CORE_FIXTURE_DIR


@pytest.fixture(scope="session")
def published_dataset() -> Dataset:
    """The committed ``public/data`` files (read-only)."""
    return load_dataset(config.DEFAULT_OUT_DIR)


@pytest.fixture
def dataset(published_dataset: Dataset) -> Dataset:
    """A deep copy of the published data that a test may mutate freely."""
    return copy.deepcopy(published_dataset)


@pytest.fixture(scope="session")
def committed_overrides() -> Overrides:
    """The committed ``data/overrides`` tables (immutable dataclasses)."""
    return load_overrides(config.DEFAULT_OVERRIDES_DIR)


@pytest.fixture
def overrides_copy(tmp_path: Path) -> Path:
    """A writable copy of ``data/overrides``."""
    target = tmp_path / "overrides"
    shutil.copytree(config.DEFAULT_OVERRIDES_DIR, target)
    return target


@pytest.fixture
def core_copy(tmp_path: Path) -> Path:
    """A writable copy of the 5-service core fixture tables."""
    target = tmp_path / "core"
    shutil.copytree(CORE_FIXTURE_DIR, target)
    return target
