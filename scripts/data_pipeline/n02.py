"""Read the MLIT N02 railway data and extract JR platform and track features."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Point, box

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import BBox, JunctionRule, section_key
from scripts.data_pipeline.registry import normalize_station_name


class SourceDataError(RuntimeError):
    """Raised when the raw N02 data is missing or does not look as expected."""


@dataclass(frozen=True)
class PlatformCandidate:
    """One N02 station feature (a platform LineString) usable for a station."""

    station_name: str  # N02 spelling, as published
    n02_line: str
    station_code: str
    group_code: str
    platform: LineString  # metric CRS
    midpoint: Point  # metric CRS, half-way along the platform
    operator: str = ""  # N02_004 source operator; empty for legacy synthetic fixtures

    @property
    def match_name(self) -> str:
        return normalize_station_name(self.station_name)

    @property
    def sort_key(self) -> tuple[str, str, str, float, float]:
        return (
            self.operator,
            self.n02_line,
            self.station_code,
            self.midpoint.x,
            self.midpoint.y,
        )


@dataclass(frozen=True)
class TrackSection:
    """One N02 railroad section part with its stable key (see section_key)."""

    key: str
    geometry: LineString  # metric CRS
    source_coordinates: tuple[tuple[float, float], ...] = ()


def split_reviewed_junctions(
    sections: Iterable[TrackSection], rules: Iterable[JunctionRule]
) -> list[TrackSection]:
    """Split only named sections at exact source vertices shared with peer ends."""
    values = list(sections)
    pending = list(rules)
    if not pending:
        return values
    result = list(values)
    for rule in pending:
        targets = [i for i, item in enumerate(result) if item.key == rule.section_key]
        peers = [
            i for i, item in enumerate(result) if item.key == rule.peer_section_key
        ]
        if len(targets) != 1 or len(peers) != 1:
            raise SourceDataError(
                f"junction section keys must each resolve once: {rule.section_key}, {rule.peer_section_key}"
            )
        target_index, peer_index = targets[0], peers[0]
        target, peer = result[target_index], result[peer_index]
        coordinate = (rule.lon, rule.lat)
        if not target.source_coordinates or not peer.source_coordinates:
            raise SourceDataError("junction source coordinates are unavailable")
        target_matches = [
            index
            for index, point in enumerate(target.source_coordinates)
            if point == coordinate
        ]
        if len(target_matches) != 1 or target_matches[0] in (
            0,
            len(target.source_coordinates) - 1,
        ):
            raise SourceDataError(
                f"junction coordinate must be one exact internal source vertex in {rule.section_key}"
            )
        if coordinate not in (peer.source_coordinates[0], peer.source_coordinates[-1]):
            raise SourceDataError(
                f"junction coordinate is not a peer section endpoint in {rule.peer_section_key}"
            )
        metric_coords = list(target.geometry.coords)
        split_index = target_matches[0]
        if len(metric_coords) != len(target.source_coordinates):
            raise SourceDataError("junction source and metric vertices do not align")
        if not 0 < split_index < len(metric_coords) - 1:
            raise SourceDataError("junction split would create an empty section")
        left_source = target.source_coordinates[: split_index + 1]
        right_source = target.source_coordinates[split_index:]
        left = TrackSection(
            target.key,
            LineString(metric_coords[: split_index + 1]),
            left_source,
        )
        right = TrackSection(
            target.key,
            LineString(metric_coords[split_index:]),
            right_source,
        )
        result[target_index : target_index + 1] = [left, right]
    return result


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


class N02Source:
    """The raw N02 files of one operator, read once and queried per service."""

    def __init__(
        self,
        raw_dir: Path,
        operator: str,
        candidate_search_bbox: BBox = config.DEFAULT_CANDIDATE_SEARCH_BBOX,
        *,
        raw_frames: tuple[gpd.GeoDataFrame, gpd.GeoDataFrame] | None = None,
    ) -> None:
        self.operator = operator
        stations, sections = raw_frames or (
            _read(raw_dir / config.RAW_STATION_FILE),
            _read(raw_dir / config.RAW_SECTION_FILE),
        )
        stations = stations[stations[config.ATTR_OPERATOR] == operator]
        # Same-name platforms elsewhere in Japan never represent a curated stop.
        stations = stations[stations.intersects(box(*candidate_search_bbox))]
        self._stations = stations.assign(
            _match_name=stations[config.ATTR_STATION_NAME].map(normalize_station_name)
        )
        self._sections = sections[sections[config.ATTR_OPERATOR] == operator]
        self._sections_metric = self._sections.to_crs(config.METRIC_CRS)

    def platform_candidates(
        self, match_names: Iterable[str], lines: Iterable[str]
    ) -> list[PlatformCandidate]:
        """Platforms whose normalised name and N02 line are both wanted."""
        frame = self._stations
        mask = frame["_match_name"].isin(set(match_names)) & frame[
            config.ATTR_LINE
        ].isin(set(lines))
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
                        operator=self.operator,
                    )
                )
        return sorted(candidates, key=lambda candidate: candidate.sort_key)

    def track_sections(
        self, lines: Iterable[str], around: Iterable[Point]
    ) -> dict[str, list[TrackSection]]:
        """Sections per N02 line near the given metric points, with stable keys."""
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
        near = self._sections_metric.intersects(bounds)
        sections: dict[str, list[TrackSection]] = {}
        for line in sorted(set(lines)):
            mask = near & (self._sections_metric[config.ATTR_LINE] == line)
            metric_parts = _explode_lines(self._sections_metric[mask].geometry)
            source_parts = _explode_lines(self._sections[mask].geometry)
            if not metric_parts:
                raise SourceDataError(
                    f"no N02 sections found for {self.operator}/{line}"
                )
            if len(metric_parts) != len(source_parts):
                raise SourceDataError(f"section parts do not align on {line}")
            parts = [
                TrackSection(
                    key=section_key(list(source.coords)),
                    geometry=metric,
                    source_coordinates=tuple(
                        (float(point[0]), float(point[1])) for point in source.coords
                    ),
                )
                for source, metric in zip(source_parts, metric_parts, strict=True)
            ]
            sections[line] = sorted(
                parts, key=lambda section: tuple(section.geometry.coords)
            )
        return sections


class N02SourceProvider:
    """Read each raw frame once and lazily cache operator-specific source views."""

    def __init__(self, raw_dir: Path, candidate_search_bbox: BBox) -> None:
        self._raw_frames = (
            _read(raw_dir / config.RAW_STATION_FILE),
            _read(raw_dir / config.RAW_SECTION_FILE),
        )
        self._bbox = candidate_search_bbox
        self._sources: dict[str, N02Source] = {}

    def for_operator(self, operator: str) -> N02Source:
        if operator not in self._sources:
            self._sources[operator] = N02Source(
                Path("."), operator, self._bbox, raw_frames=self._raw_frames
            )
        return self._sources[operator]
