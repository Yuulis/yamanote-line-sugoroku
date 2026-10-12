"""Shared constants for the JR East data pipeline."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RAW_DIR = REPO_ROOT / "N02-25_GML" / "UTF-8"
DEFAULT_OVERRIDES_DIR = REPO_ROOT / "data" / "overrides"
DEFAULT_OUT_DIR = REPO_ROOT / "public" / "data"

RAW_STATION_FILE = "N02-25_Station.geojson"
RAW_SECTION_FILE = "N02-25_RailroadSection.geojson"

# Override layout (data/overrides/, documented in data/README.md).
DATASET_OVERRIDE_FILE = "dataset.json"
REGISTRY_OVERRIDE_FILE = "stations.csv"
SERVICES_OVERRIDE_FILE = "services.json"
SERVICES_OVERRIDE_DIR = "services"
STOPS_OVERRIDE_FILE = "stops.csv"
LINE_MAPPING_OVERRIDE_FILE = "line_mapping.csv"
SECTION_CONSTRAINTS_OVERRIDE_FILE = "sections.csv"  # optional, per service
OFFSET_EXCEPTIONS_OVERRIDE_FILE = "offset_exceptions.csv"

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
SECTION_KEY_DECIMALS = 5  # N02 source coordinates carry 5 decimals
# A platform or via point farther than this from the track it is routed on is
# not on that track: such a pair is rejected before the routing DP runs.
MAX_SNAP_OFFSET_M = 30.0
# Only N02 platforms inside this lon/lat box can represent a curated station.
# It rejects same-name stations elsewhere in Japan (大久保 on the 奥羽線, Akita).
CANDIDATE_SEARCH_BBOX = (139.45, 35.45, 140.05, 35.95)

# Area: every registry station's ward must be one of Tokyo's 23 special wards.
TOKYO_23_WARDS = (
    "千代田区",
    "中央区",
    "港区",
    "新宿区",
    "文京区",
    "台東区",
    "墨田区",
    "江東区",
    "品川区",
    "目黒区",
    "大田区",
    "世田谷区",
    "渋谷区",
    "中野区",
    "杉並区",
    "豊島区",
    "北区",
    "荒川区",
    "板橋区",
    "練馬区",
    "足立区",
    "葛飾区",
    "江戸川区",
)

# Validation thresholds.
ENDPOINT_MAX_DISTANCE_M = 30.0
FOREIGN_STATION_MIN_DISTANCE_M = 100.0
MAX_DETOUR_RATIO = 1.8  # 品川->大崎 is ~1.6 in reality (curved track)
# Default limit for a service's platform point -> the station's representative
# point; larger offsets (東京 京葉線 ~450 m) need a reviewed exception row.
DEFAULT_MAX_PLATFORM_OFFSET_M = 250.0
MAX_GEOJSON_BYTES = 300_000

# Sanity bbox for output coordinates, (min_lon, min_lat, max_lon, max_lat):
# the 23 wards plus a margin (西荻窪 ~139.60 E, 葛西臨海公園 ~139.86 E).
OUTPUT_BBOX = (139.55, 35.50, 139.95, 35.85)

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
