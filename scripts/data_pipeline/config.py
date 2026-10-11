"""Shared constants for the Yamanote Line data pipeline."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RAW_DIR = REPO_ROOT / "N02-25_GML" / "UTF-8"
DEFAULT_OVERRIDES_DIR = REPO_ROOT / "data" / "overrides"
DEFAULT_OUT_DIR = REPO_ROOT / "public" / "data"

RAW_STATION_FILE = "N02-25_Station.geojson"
RAW_SECTION_FILE = "N02-25_RailroadSection.geojson"

STATIONS_OVERRIDE_FILE = "yamanote_stations.csv"
LINE_MAPPING_OVERRIDE_FILE = "yamanote_line_mapping.csv"
SERVICE_OVERRIDE_FILE = "service.json"

STATIONS_FILE = "stations.json"
SERVICES_FILE = "services.json"
SEGMENTS_FILE = "segments.json"
SEGMENTS_GEOJSON_FILE = "segments.geojson"
MANIFEST_FILE = "manifest.json"

# N02 attribute names (KsjAppSchema-N02-v3_1.xsd).
ATTR_LINE = "N02_003"
ATTR_OPERATOR = "N02_004"
ATTR_STATION_NAME = "N02_005"
ATTR_STATION_CODE = "N02_005c"
ATTR_GROUP_CODE = "N02_005g"

# Coordinate reference systems.
SOURCE_CRS = "EPSG:6668"  # JGD2011 geographic (N02 native)
METRIC_CRS = "EPSG:6677"  # JGD2011 / Japan Plane Rectangular CS IX (Tokyo), metres
OUTPUT_CRS = "EPSG:4326"  # WGS84 lon/lat

# Processing parameters.
SECTION_SEARCH_MARGIN_M = 2_000.0  # bbox margin around station candidates
NODE_SNAP_DECIMALS = 2  # node identity tolerance: 1 cm in metric CRS
SIMPLIFY_TOLERANCE_M = 1.0  # Douglas-Peucker tolerance for segment geometry
COORDINATE_DECIMALS = 6  # ~0.1 m at Tokyo latitude

# Validation thresholds.
EXPECTED_STATION_COUNT = 30
START_STATION_ID = "shimbashi"
ENDPOINT_MAX_DISTANCE_M = 30.0
FOREIGN_STATION_MIN_DISTANCE_M = 100.0
MAX_DETOUR_RATIO = 1.8  # 品川->大崎 is ~1.6 in reality (curved track)
OFFICIAL_LOOP_LENGTH_KM = 34.5
LOOP_LENGTH_TOLERANCE_KM = 1.5
MAX_GEOJSON_BYTES = 300_000

# Tokyo-area sanity bbox for output coordinates: (min_lon, min_lat, max_lon, max_lat).
OUTPUT_BBOX = (139.60, 35.55, 139.85, 35.80)

MANIFEST_SOURCE = {
    "name": "国土数値情報（鉄道データ）",
    "dataset": "N02",
    "year": 2025,
    "baseDate": "2025-12-31",
    "url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html",
    "license": "CC BY 4.0",
    "attribution": "「国土数値情報（鉄道データ）」（国土交通省）を加工して作成",
}
DATA_VERSION_PREFIX = "n02-2025"
