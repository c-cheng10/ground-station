"""Turn the Giovanni downloads into one monthly dataset, the site's config, and Supabase rows.

Each measurement uses its most consistent NASA record (all served by Giovanni):
  MERRA-2 (1980-2025): air temperature, specific humidity, and relative humidity
      (computed from those two plus GLDAS 2.0's typical surface pressure for that month).
  GPM IMERG (1998-2025): precipitation, from satellites calibrated to rain gauges.
  GLDAS 2.0 (1948-2014): surface temperature, root-zone soil moisture, evaporation,
      wind and snow depth. GLDAS 2.1 continues to 2025 but its weather inputs change
      over time and give false trends, so it is used only for the "datasets agree" check.

Writes gldas-dataset.npz (training), points-index.js and featured-stripes.js (site),
study-areas.csv (download), trend-config.js, and upserts rows into Supabase when
SUPABASE_SERVICE_ROLE_KEY is in .env.

    python build_gldas_dataset.py
"""

import csv
import json
import math
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

from download_gldas import CACHE, REQUESTS, ROOT, read_env

START_YEAR, END_YEAR = 1948, 2025
MONTHS = (END_YEAR - START_YEAR + 1) * 12
GIOVANNI = "https://giovanni.gsfc.nasa.gov/giovanni/"
# id, name, unit, trend unit, decimals, source, cache file, conversion, description
VARIABLES = [
    ("T2M", "Air temperature", "°C", "°C", 2, "MERRA-2", "merra_T2M", lambda v: v - 273.15,
     "Temperature of the air two metres above the ground."),
    ("TS", "Surface temperature", "°C", "°C", 2, "GLDAS 2.0", "2_0_AvgSurfT_inst", lambda v: v - 273.15,
     "Temperature of the ground surface itself."),
    ("PRECTOTCORR", "Precipitation", "mm/day", "mm/day", 2, "GPM IMERG", "gpm_precipitation", lambda v: v * 24,
     "Average daily rain and snow, measured from space by the GPM satellites and calibrated to rain gauges."),
    ("QV2M", "Specific humidity", "g/kg", "g/kg", 2, "MERRA-2", "merra_QV2M", lambda v: v * 1000,
     "Grams of water vapour in each kilogram of air near the ground."),
    ("RH2M", "Relative humidity", "%", "pp", 1, "MERRA-2", None, None,
     "How close the air near the ground is to being saturated with water vapour."),
    ("GWETROOT", "Root-zone soil moisture", "mm", "mm", 1, "GLDAS 2.0", "2_0_RootMoist_inst", lambda v: v,
     "Water held in the soil where plant roots reach, as a depth of water."),
    ("EVLAND", "Evapotranspiration", "mm/day", "mm/day", 2, "GLDAS 2.0", "2_0_Evap_tavg", lambda v: v * 86400,
     "Water returned to the air each day from soil, water surfaces and plant leaves."),
    ("WS10M", "Wind speed", "m/s", "m/s", 2, "GLDAS 2.0", "2_0_Wind_f_inst", lambda v: v,
     "Average wind speed near the ground."),
    ("SNOW", "Snow depth", "cm", "cm", 1, "GLDAS 2.0", "2_0_SnowDepth_inst", lambda v: v * 100,
     "Average depth of snow on the ground through the month."),
]
COMPARE = ("T2M_GLDAS21", "2_1_Tair_f_inst", lambda v: v - 273.15)
IDS = [v[0] for v in VARIABLES] + [COMPARE[0]]
SITES = [
    ("southern-ontario", "Southern Ontario", "Canada", 44.125, -80.625),
    ("great-plains", "Central Great Plains", "United States", 38.625, -100.125),
    ("mexican-plateau", "Mexican Plateau", "Mexico", 23.125, -102.375),
    ("central-amazon", "Central Amazon", "Brazil", -3.125, -60.125),
    ("cerrado", "Cerrado", "Brazil", -15.625, -47.625),
    ("patagonian-steppe", "Patagonian Steppe", "Argentina", -49.625, -70.625),
]


def read_series(path):
    """Values on the 1948-01 month axis (NaN where missing), or None for a NO DATA point."""
    text = path.read_text(encoding="utf-8")
    if text.startswith("NO DATA") or "Timestamp" not in text:
        return None
    header, _, rows = text.partition("Timestamp")
    undef = float(next(l.split(",")[1] for l in header.splitlines() if l.startswith("undef")))
    series = np.full(MONTHS, np.nan)
    for line in rows.splitlines()[1:]:
        stamp, _, value = line.partition(",")
        if stamp[:4].isdigit() and value.strip():
            index = (int(stamp[:4]) - START_YEAR) * 12 + int(stamp[5:7]) - 1
            if 0 <= index < MONTHS and float(value) != undef:
                series[index] = float(value)
    return series


def relative_humidity(q_gkg, t_c, p_pa):
    # Vapour pressure from specific humidity, over saturation vapour pressure (Bolton 1980).
    q = q_gkg / 1000
    e = q * p_pa / (0.622 + 0.378 * q)
    return np.clip(100 * e / (611.2 * np.exp(17.67 * t_c / (t_c + 243.5))), 0, 100)


def build_point(folder):
    raw = {name: read_series(folder / f"{name}.csv") for name, *_ in REQUESTS}
    # Coastal cells can be land on the map but ocean in a model's mask: all values missing.
    if any(raw[name] is None or np.isnan(raw[name]).all() for name, *_ in REQUESTS if name != COMPARE[1]):
        return None
    values = np.full((MONTHS, len(IDS)), np.nan)
    for i, (vid, *_, cache, convert, _) in enumerate(VARIABLES):
        if cache:
            values[:, i] = convert(raw[cache])
    # GLDAS 2.0 pressure barely changes from year to year, so its 1948-2014 monthly normal
    # stands in for 1980-2025.
    pressure = np.tile(np.nanmean(raw["2_0_Psurf_f_inst"].reshape(-1, 12), axis=0), MONTHS // 12)
    values[:, IDS.index("RH2M")] = relative_humidity(values[:, IDS.index("QV2M")], values[:, IDS.index("T2M")], pressure)
    if raw[COMPARE[1]] is not None:
        values[:, -1] = COMPARE[2](raw[COMPARE[1]])
    return values


def coverage(data):
    """First and last month with data for each measurement, across all points."""
    have = ~np.isnan(data).all(axis=0)
    return [(int(np.argmax(have[:, i])), int(MONTHS - 1 - np.argmax(have[::-1, i]))) for i in range(len(IDS))]


def annual(series):
    """Yearly means for complete years only."""
    years = series.reshape(-1, 12)
    return np.where(np.isnan(years).any(axis=1), np.nan, years.mean(axis=1))


def enso():
    """Monthly Niño 3.4 anomaly (°C) from KNMI Climate Explorer (NOAA ERSSTv5)."""
    with urlopen("https://climexp.knmi.nl/data/iersst_nino3.4a.dat", timeout=60) as response:
        lines = response.read().decode().splitlines()
    series = np.full(MONTHS, np.nan)
    for line in lines:
        parts = line.split()
        if len(parts) == 2 and not line.startswith("#"):
            year = float(parts[0])
            index = (int(year) - START_YEAR) * 12 + round((year - int(year)) * 12)
            if 0 <= index < MONTHS:
                series[index] = float(parts[1])
    assert not np.isnan(series).any(), "KNMI Niño 3.4 record has gaps"
    return series


def nearest(lats, lons, lat, lon):
    return int(np.argmin((np.array(lats) - lat) ** 2 + ((np.array(lons) - lon) * math.cos(math.radians(lat))) ** 2))


def write_site_files(lats, lons, data, spans):
    previous = (ROOT / "trend-config.js").read_text(encoding="utf-8")
    keep = json.loads(previous[previous.index("{"):previous.rindex("}") + 1])
    variables = []
    for (vid, name, unit, trend_unit, decimals, source, *_ , description), (first, last) in zip(VARIABLES, spans):
        variables.append({"id": vid, "name": name, "unit": unit, "trendUnit": trend_unit, "decimals": decimals,
                          "description": description, "source": source,
                          "firstMonth": first, "lastMonth": last})
    sites = []
    for sid, name, region, lat, lon in SITES:
        i = nearest(lats, lons, lat, lon)
        sites.append({"id": sid, "name": name, "region": region, "latitude": lats[i], "longitude": lons[i],
                      "bounds": {"south": lats[i] - 0.125, "north": lats[i] + 0.125,
                                 "west": lons[i] - 0.125, "east": lons[i] + 0.125}, "cellCount": 1})
    config = {"startYear": START_YEAR, "endYear": END_YEAR, "sourceUrl": GIOVANNI,
              "methodUrl": keep.get("methodUrl"), "supabaseUrl": keep.get("supabaseUrl"),
              "supabaseAnonKey": keep.get("supabaseAnonKey"), "variables": variables, "sites": sites,
              "compare": {"id": COMPARE[0], "source": "GLDAS 2.1", "firstMonth": spans[-1][0], "lastMonth": spans[-1][1]}}
    (ROOT / "trend-config.js").write_text("window.TREND_CONFIG = " + json.dumps(config, ensure_ascii=False, indent=2) + ";\n",
                                         encoding="utf-8")
    (ROOT / "points-index.js").write_text(
        "// Land points stored in Supabase (0.25° grid-cell centres): [latitude, longitude].\n"
        "window.POINTS_INDEX = " + json.dumps([[a, b] for a, b in zip(lats, lons)], separators=(",", ":")) + ";\n",
        encoding="utf-8")
    # Real-data stripes for the hero and example cards, so the page shows data before any request.
    featured = {}
    for key, lat, lon, vid in [("ontario-T2M", 44.125, -80.625, "T2M"), ("ontario-PRECTOTCORR", 44.125, -80.625, "PRECTOTCORR"),
                               ("sahel-PRECTOTCORR", 14.125, 1.875, "PRECTOTCORR")]:
        values = annual(data[nearest(lats, lons, lat, lon), :, IDS.index(vid)])
        featured[key] = [round(float(v), 3) for v in values[~np.isnan(values)]]
    (ROOT / "featured-stripes.js").write_text("window.FEATURED_STRIPES = " + json.dumps(featured, separators=(",", ":")) + ";\n",
                                             encoding="utf-8")
    with (ROOT / "study-areas.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["site", "country", "latitude", "longitude", "year",
                         *[f"{v[0]} ({v[2]}, {v[5]})" for v in VARIABLES]])
        for site in sites:
            i = nearest(lats, lons, site["latitude"], site["longitude"])
            yearly = [annual(data[i, :, k]) for k in range(len(VARIABLES))]
            for y in range(END_YEAR - START_YEAR + 1):
                if any(not np.isnan(col[y]) for col in yearly):
                    writer.writerow([site["name"], site["region"], site["latitude"], site["longitude"], START_YEAR + y,
                                     *["" if np.isnan(col[y]) else f"{col[y]:.4f}" for col in yearly]])


def upload(env, lats, lons, data):
    url = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/climate_points?on_conflict=id"
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    clean = lambda a: [None if math.isnan(x) else round(float(x), 3) for x in a]
    for start in range(0, len(lats), 40):
        rows = [{"id": f"{lats[i]},{lons[i]}", "lat": lats[i], "lon": lons[i],
                 **{vid.lower(): clean(data[i, :, k]) for k, vid in enumerate(IDS)}}
                for i in range(start, min(start + 40, len(lats)))]
        with urlopen(Request(url, data=json.dumps(rows).encode(), headers=headers, method="POST"), timeout=180):
            pass
        print(f"  uploaded {min(start + 40, len(lats))}/{len(lats)}", flush=True)


def main():
    lats, lons, data, skipped = [], [], [], 0
    for folder in sorted(p for p in CACHE.iterdir() if p.is_dir()):
        if not all((folder / f"{name}.csv").exists() for name, *_ in REQUESTS):
            continue  # not downloaded yet
        values = build_point(folder)
        if values is None:
            skipped += 1
            continue
        lat, lon = map(float, folder.name.split("_"))
        lats.append(lat), lons.append(lon), data.append(values)
    data = np.stack(data).astype(np.float32)
    spans = coverage(data)
    print(f"{len(lats)} points built, {skipped} skipped (missing data)")
    for vid, (first, last) in zip(IDS, spans):
        print(f"  {vid:<12} {START_YEAR + first // 12}-{first % 12 + 1:02} to {START_YEAR + last // 12}-{last % 12 + 1:02}")
    np.savez_compressed(ROOT / "gldas-dataset.npz", lat=np.array(lats), lon=np.array(lons), values=data,
                        enso=enso(), ids=np.array(IDS), start_year=START_YEAR)
    write_site_files(lats, lons, data, spans)
    env = read_env()
    if env.get("SUPABASE_SERVICE_ROLE_KEY"):
        upload(env, lats, lons, data)
    else:
        print("No SUPABASE_SERVICE_ROLE_KEY in .env, so nothing was uploaded.")


if __name__ == "__main__":
    main()
