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
DETOUR_EXCEPTIONS_OVERRIDE_FILE = "detour_exceptions.csv"  # optional
PLATFORM_TRANSFERS_OVERRIDE_FILE = "platform_transfers.csv"  # optional
SCOPE_OVERRIDE_FILE = "scope.csv"

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
MAX_COMPOSE_PRIMITIVES = 4_096  # expansion safety cap, before recipe anchor checks
COORDINATE_DECIMALS = 6  # ~0.1 m at Tokyo latitude
# Largest metric distance error between two points each rounded to
# COORDINATE_DECIMALS (0.5e-6 degree per axis is <= 0.056 m north, 0.046 m east
# at the regional latitudes; twice the diagonal, rounded up). Used only where a
# reviewed limit is re-checked on published coordinates, never for joints.
COORDINATE_ROUNDING_M = 0.15
SECTION_KEY_DECIMALS = 5  # N02 source coordinates carry 5 decimals
# A platform or via point farther than this from the track it is routed on is
# not on that track: such a pair is rejected before the routing DP runs.
MAX_SNAP_OFFSET_M = 30.0
# Defaults cover the JR East railway extent in the four prefectures. Each
# dataset can narrow its area/bounds without changing public metadata.
CAPITAL_REGION_PREFECTURES = ("東京都", "千葉県", "神奈川県", "埼玉県")
DEFAULT_OUTPUT_BBOX = (138.6, 34.8, 141.0, 36.8)
DEFAULT_CANDIDATE_SEARCH_BBOX = (138.5, 34.65, 141.2, 37.0)
# Only numerical projection noise is allowed at an explicitly declared
# cross-line joint; platform snap tolerance must never bridge a track gap.
ROUTE_JOINT_TOLERANCE_M = 0.000001

# Validation thresholds.
ENDPOINT_MAX_DISTANCE_M = 30.0
FOREIGN_STATION_MIN_DISTANCE_M = 100.0
MAX_DETOUR_RATIO = 1.8  # 品川->大崎 is ~1.6 in reality (curved track)
# Default limit for a service's platform point -> the station's representative
# point; larger offsets (東京 京葉線 ~450 m) need a reviewed exception row.
DEFAULT_MAX_PLATFORM_OFFSET_M = 250.0
# Upper bound for a reviewed platform transfer: a service arriving on one N02
# platform feature of a stop and departing from another feature of that stop.
MAX_PLATFORM_TRANSFER_M = 250.0
MAX_GEOJSON_BYTES = 300_000

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
