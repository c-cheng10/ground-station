"""Build the site extension from the Giovanni cache and optionally upsert it."""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np

from build_gldas_dataset import MONTHS, START_YEAR, annual, benjamini_hochberg, read_series, trend_test
from download_gldas import CACHE, ROOT, grid, ocean_grid, read_env

FIELDS = (
    ("OZONE_COLUMN", "Total column ozone", "DU", "MERRA-2", "merra_TO3", 1, 0,
     "Ozone in the full atmospheric column. Stratospheric ozone absorbs ultraviolet light."),
    ("TROPOPAUSE_TEMP", "Tropopause temperature", "°C", "MERRA-2", "merra_TROPT", 1, -273.15,
     "Temperature at the boundary between the troposphere and stratosphere."),
    ("COLUMN_WATER_VAPOUR", "Total column water vapour", "kg/m²", "AIRS", "airs_TotH2OVap", 1, 0,
     "Water vapour through the full atmospheric column, per square metre."),
    ("CLOUD_FRACTION", "Cloud fraction", "%", "AIRS", "airs_CloudFrc", 100, 0,
     "Daytime effective cloud fraction. Clouds affect the solar energy reflected and heat emitted to space."),
    ("OUTGOING_LONGWAVE", "Outgoing longwave radiation", "W/m²", "AIRS", "airs_OLR", 1, 0,
     "Daytime thermal radiation leaving Earth for space per square metre."),
    ("OCEAN_SKIN_TEMP", "Sea surface skin temperature", "°C", "AIRS", "airs_SurfSkinTemp", 1, -273.15,
     "Daytime temperature at the ocean surface measured by infrared satellite retrievals."),
)
SHARED = {"t2m": ("merra_T2M", 1, -273.15), "prectotcorr": ("gpm_precipitation", 24, 0)}


def read_point(point, ocean, existing):
    lat, lon = point
    folder = CACHE / f"{lat}_{lon}"
    data = {}
    for name, _, _, _, source, multiplier, offset, _ in FIELDS:
        if name != "OCEAN_SKIN_TEMP" or ocean:
            data[name.lower()] = (source, multiplier, offset)
    series = {}
    for name, (source, multiplier, offset) in (data | SHARED).items():
        values = read_series(folder / f"{source}.csv")
        if values is None or not np.isfinite(values).any():
            raise ValueError(f"Missing Giovanni series {source} at {lat},{lon}")
        series[name] = values * multiplier + offset
    if not ocean and not existing:
        series["qv2m"] = read_series(folder / "merra_QV2M.csv") * 1000
        data["qv2m"] = None
    if not existing:
        data.update(SHARED)
    row = {"id": f"{lat},{lon}", "lat": lat, "lon": lon, "is_ocean": ocean}
    row.update({name: [round(float(v), 3) if np.isfinite(v) else None for v in series[name]] for name in data})
    return row, series


def map_entry(series, ocean_start):
    covered = [np.flatnonzero(np.isfinite(values)) for values in series if values is not None]
    first = min(months[0] for months in covered)
    last = max(months[-1] for months in covered)
    a, b = (first + 11) // 12, (last + 1) // 12
    slopes, probabilities = [], []
    for values in series:
        yearly = annual(values)[a:b] if values is not None else np.full(b - a, np.nan)
        slope, probability = trend_test(yearly) if len(yearly) >= 4 and np.isfinite(yearly).all() else (np.nan, 1)
        slopes.append(slope)
        probabilities.append(probability)
    magnitude = np.abs([slope for slope in slopes if np.isfinite(slope) and slope != 0])
    eligible = np.isfinite(slopes)
    significant = np.zeros(len(slopes), dtype=int)
    significant[eligible] = benjamini_hochberg(np.asarray(probabilities)[eligible])
    return int(first), int(last), {
        "slope": [round(slope, 4) if np.isfinite(slope) else None for slope in slopes],
        "significant": significant.tolist(),
        "scale": float(np.percentile(magnitude, 95)) if len(magnitude) else 1,
        "years": [int(START_YEAR + a), int(START_YEAR + b - 1)],
        "oceanStart": ocean_start,
    }


def upload(groups):
    env = read_env()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/climate_points"
    key = env["SUPABASE_SERVICE_ROLE_KEY"].strip("\"'")
    if not key:
        raise SystemExit("Set SUPABASE_SERVICE_ROLE_KEY in .env before uploading.")
    headers = {"apikey": key, "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"

    try:
        with urlopen(Request(base + "?select=id,is_ocean,ocean_skin_temp&limit=1", headers=headers), timeout=30):
            pass
    except HTTPError as error:
        raise SystemExit(f"Supabase schema check returned HTTP {error.code}. Apply supabase/giovanni_ocean_atmosphere.sql first.") from None

    for group in groups:
        for i in range(0, len(group), 40):
            batch = group[i:i + 40]
            request = Request(base + "?on_conflict=id", headers=headers, method="POST",
                              data=json.dumps(batch, separators=(",", ":")).encode())
            try:
                with urlopen(request, timeout=90):
                    pass
            except (HTTPError, URLError, TimeoutError) as error:
                raise SystemExit(f"Upload stopped at {batch[0]['id']}: {error}. Rerun to resume by upserting the same rows.") from None
        print(f"Uploaded {len(group):,} rows", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true", help="upsert rows after building the site extension")
    args = parser.parse_args()
    index = (ROOT / "points-index.js").read_text(encoding="utf-8")
    existing = [tuple(point) for point in json.loads(index.split("=", 1)[1].strip().rstrip(";"))]
    land = grid(3)
    extra_land = sorted(set(land).difference(existing))
    ocean = sorted(set(ocean_grid(5)).difference(land))
    points = existing + extra_land + ocean
    ocean_start = len(existing) + len(extra_land)
    jobs = [(point, i >= ocean_start, i < len(existing)) for i, point in enumerate(points)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows, series = zip(*pool.map(lambda job: read_point(*job), jobs))
    print(f"Prepared {ocean_start:,} land and {len(ocean):,} ocean rows", flush=True)

    variables, trends = [], {}
    for name, label, unit, source, _, _, _, description in FIELDS:
        first, last, trends[name] = map_entry([values.get(name.lower()) for values in series], ocean_start)
        variables.append(dict(id=name, name=label, unit=unit, trendUnit="pp" if unit == "%" else unit,
                              source=source, decimals=2, description=description, firstMonth=first, lastMonth=last))
    for name in SHARED:
        _, _, trends[name.upper()] = map_entry([values[name] for values in series], ocean_start)
    extension = dict(extraLand=extra_land, ocean=ocean, variables=variables, trends=trends)
    (ROOT / "ocean-atmosphere.js").write_text("window.GIOVANNI_EXTENSION = " +
        json.dumps(extension, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Wrote ocean-atmosphere.js. Monthly arrays contain {MONTHS} slots.", flush=True)
    if args.upload:
        upload((rows[:len(existing)], rows[len(existing):ocean_start], rows[ocean_start:]))


if __name__ == "__main__":
    main()
