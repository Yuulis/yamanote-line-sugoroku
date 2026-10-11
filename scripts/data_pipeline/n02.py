"""Read the MLIT N02 railway data and extract Yamanote-related features."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Point, box

from scripts.data_pipeline import config


class SourceDataError(RuntimeError):
    """Raised when the raw N02 data is missing or does not look as expected."""


@dataclass(frozen=True)
class PlatformCandidate:
    """One N02 station feature (a platform LineString) usable for a station."""

    station_name: str
    n02_line: str
    station_code: str
    group_code: str
    platform: LineString  # metric CRS
    midpoint: Point  # metric CRS, half-way along the platform

    @property
    def sort_key(self) -> tuple[str, str, float, float]:
        return (self.n02_line, self.station_code, self.midpoint.x, self.midpoint.y)


def _read(path: Path) -> gpd.GeoDataFrame:
    if not path.is_file():
        raise SourceDataError(
            f"raw N02 file not found: {path} (see data/README.md for download steps)"
        )
    frame = gpd.read_file(path)
    if frame.crs is None or frame.crs.to_epsg() != 6668:
        raise SourceDataError(f"unexpected CRS {frame.crs} in {path}")
    return frame


def _explode_lines(geometries: Iterable[object]) -> list[LineString]:
    lines: list[LineString] = []
    for geometry in geometries:
        if isinstance(geometry, LineString):
            lines.append(geometry)
            continue
        parts = getattr(geometry, "geoms", None)
        if parts is None:
            raise SourceDataError(f"unexpected geometry type: {type(geometry)}")
        lines.extend(part for part in parts if isinstance(part, LineString))
    return lines


def load_platform_candidates(
    raw_dir: Path, operator: str, names: Iterable[str], lines: Iterable[str]
) -> list[PlatformCandidate]:
    """Station platforms run by ``operator`` with a wanted name on a wanted line."""
    frame = _read(raw_dir / config.RAW_STATION_FILE)
    wanted_names = set(names)
    wanted_lines = set(lines)
    mask = (
        (frame[config.ATTR_OPERATOR] == operator)
        & frame[config.ATTR_STATION_NAME].isin(wanted_names)
        & frame[config.ATTR_LINE].isin(wanted_lines)
    )
    selected = frame[mask].to_crs(config.METRIC_CRS)
    candidates: list[PlatformCandidate] = []
    for row in selected.itertuples(index=False):
        for platform in _explode_lines([row.geometry]):
            candidates.append(
                PlatformCandidate(
                    station_name=str(getattr(row, config.ATTR_STATION_NAME)),
                    n02_line=str(getattr(row, config.ATTR_LINE)),
                    station_code=str(getattr(row, config.ATTR_STATION_CODE)),
                    group_code=str(getattr(row, config.ATTR_GROUP_CODE)),
                    platform=platform,
                    midpoint=platform.interpolate(0.5, normalized=True),
                )
            )
    return sorted(candidates, key=lambda candidate: candidate.sort_key)


def load_sections(
    raw_dir: Path, operator: str, lines: Iterable[str], around: Iterable[Point]
) -> dict[str, list[LineString]]:
    """Railroad sections per N02 line of ``operator`` near the given metric points."""
    points = list(around)
    if not points:
        raise ValueError("need at least one point to bound the section search")
    margin = config.SECTION_SEARCH_MARGIN_M
    bounds = box(
        min(point.x for point in points) - margin,
        min(point.y for point in points) - margin,
        max(point.x for point in points) + margin,
        max(point.y for point in points) + margin,
    )
    frame = _read(raw_dir / config.RAW_SECTION_FILE)
    frame = frame[frame[config.ATTR_OPERATOR] == operator].to_crs(config.METRIC_CRS)
    frame = frame[frame.intersects(bounds)]
    sections: dict[str, list[LineString]] = {}
    for line in sorted(set(lines)):
        selected = frame[frame[config.ATTR_LINE] == line]
        exploded = _explode_lines(selected.geometry)
        if not exploded:
            raise SourceDataError(f"no N02 sections found for {operator}/{line}")
        sections[line] = sorted(exploded, key=lambda section: tuple(section.coords))
    return sections
