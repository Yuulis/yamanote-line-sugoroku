"""Shared helpers for the data pipeline tests (plain functions, no fixtures)."""

from __future__ import annotations

from pathlib import Path

from shapely.geometry import LineString, Point

from scripts.data_pipeline.n02 import PlatformCandidate

# Draft 5-service tables (researcher's verified stop lists) in the override
# layout. Used to exercise the multi-service code paths; not exported.
CORE_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "jr_east_core"


def candidate(
    name: str,
    x: float,
    y: float,
    code: str = "000001",
    line: str = "L",
    group: str | None = None,
) -> PlatformCandidate:
    """A 10 m east-west platform centred on (x, y) in metric coordinates."""
    return PlatformCandidate(
        station_name=name,
        n02_line=line,
        station_code=code,
        group_code=code if group is None else group,
        platform=LineString([(x - 5, y), (x + 5, y)]),
        midpoint=Point(x, y),
    )


def rewrite(path: Path, old: str, new: str) -> None:
    """Replace one exact snippet in a text file (fails if it is absent)."""
    text = path.read_text(encoding="utf-8")
    assert old in text, f"{old!r} not in {path}"
    path.write_text(text.replace(old, new), encoding="utf-8")


def append_line(path: Path, line: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
