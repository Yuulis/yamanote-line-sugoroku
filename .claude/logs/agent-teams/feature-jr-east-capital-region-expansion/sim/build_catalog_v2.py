"""Derive catalog v2 from v1 without fetching or changing source artifacts."""

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RESEARCH = ROOT / ".claude/docs/research"
# A rapid can be the base pattern of separate tracks or a named through route.
# The Takasaki/Tokaido Shonan-Shinjuku route has no local pattern.
BASE_RAPID = {"chuo_rapid", "sobu_rapid", "joban_rapid", "shonan_shinjuku_rapid_takasaki"}
TRUNCATED_NAMES = {"平山", "上総松丘", "上総亀山"}


def read_csv(path):
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        return reader.fieldnames, list(reader)


def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main():
    fields, source = read_csv(RESEARCH / "jr-east-capital-region-catalog.csv")
    service_fields, services = read_csv(RESEARCH / "jr-east-capital-region-services.csv")
    kept = {s["service_id"] for s in services
            if s["service_type"] == "local" or s["service_id"] in BASE_RAPID}
    # Abort rather than silently remove a station through service selection.
    source_stations = {r["station_id_proposed"] for r in source}
    selected = [r.copy() for r in source if r["service_id"] in kept]
    assert source_stations == {r["station_id_proposed"] for r in selected}
    selected = [r for r in selected
                if not (r["service_id"] == "kururi" and r["station_name_ja"] in TRUNCATED_NAMES)]
    for row in selected:
        if row["service_id"] == "kururi":
            if row["station_name_ja"] == "久留里":
                row["is_terminus_in_area"] = "true"
                row["notes"] = "terminus: 久留里; Q6 user decision 2026-10-13: truncate the playable service here."
            elif row["station_name_ja"] == "木更津":
                row["notes"] = "terminus: 木更津; Q6 user decision 2026-10-13: 久留里 is the other playable endpoint."
    selected_services = [s.copy() for s in services if s["service_id"] in kept]
    kururi = next(s for s in selected_services if s["service_id"] == "kururi")
    stops = [r for r in selected if r["service_id"] == "kururi"]
    kururi["stops_ja"] = "|".join(r["station_name_ja"] for r in stops)
    kururi["stop_ids"] = "|".join(r["station_id_proposed"] for r in stops)
    kururi["last_end_kind"] = "terminus"
    kururi["status_reason"] = "core: Q6 user decision 2026-10-13; playable extent 木更津–久留里"
    write_csv(RESEARCH / "jr-east-capital-region-catalog-v2.csv", fields, selected)
    write_csv(RESEARCH / "jr-east-capital-region-services-v2.csv", service_fields, selected_services)
    print(f"rows={len(selected)} services={len(kept)} stations={len({r['station_id_proposed'] for r in selected})}")
    print("dropped_services=" + ",".join(s["service_id"] for s in services if s["service_id"] not in kept))


if __name__ == "__main__":
    main()
