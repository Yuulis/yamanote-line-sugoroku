"""Shared fixtures for the data pipeline tests."""

from __future__ import annotations

import copy
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.stage_suburban_support import resolve_historical_baseline
from scripts.data_pipeline.validate import Dataset, load_dataset
from tests.data_pipeline.support import CORE_FIXTURE_DIR


@pytest.fixture(scope="session")
def published_dataset() -> Dataset:
    """The archived JR East capital-region edition for legacy regressions."""
    path = resolve_historical_baseline(config.REPO_ROOT, "public/data")
    return load_dataset(path)


@pytest.fixture(scope="session")
def installed_product_dataset() -> Dataset:
    """The currently installed product bundle from ``public/data``."""
    return load_dataset(config.DEFAULT_OUT_DIR)


@pytest.fixture
def dataset(published_dataset: Dataset) -> Dataset:
    """A deep copy of the published data that a test may mutate freely."""
    return copy.deepcopy(published_dataset)


@pytest.fixture(scope="session")
def committed_overrides() -> Overrides:
    """The archived JR East capital-region overrides for legacy regressions."""
    path = resolve_historical_baseline(config.REPO_ROOT, "data/overrides")
    return load_overrides(path)


@pytest.fixture(scope="session")
def installed_product_overrides() -> Overrides:
    """The currently installed product overrides from ``data/overrides``."""
    return load_overrides(config.DEFAULT_OVERRIDES_DIR)


@pytest.fixture
def overrides_copy(tmp_path: Path) -> Path:
    """A writable copy of ``data/overrides``."""
    target = tmp_path / "overrides"
    historical = resolve_historical_baseline(config.REPO_ROOT, "data/overrides")
    shutil.copytree(historical, target)
    return target


@pytest.fixture
def core_copy(tmp_path: Path) -> Path:
    """A writable copy of the 5-service core fixture tables."""
    target = tmp_path / "core"
    shutil.copytree(CORE_FIXTURE_DIR, target)
    return target
