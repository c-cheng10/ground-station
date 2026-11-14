"""Download monthly NASA data (GLDAS, MERRA-2, GPM) from Giovanni for a global grid of land points.

Giovanni (giovanni.gsfc.nasa.gov) serves GLDAS Noah 0.25° monthly: version 2.0 covers
1948-2014 and version 2.1 covers 2000 to today. Each request returns one variable at
one point. Responses are cached in giovanni-cache/, so reruns skip finished requests.

    python download_gldas.py --pilot          # one point, then report quota used
    python download_gldas.py --spacing 3      # every land point on a 3° lattice

Needs EARTHDATA_TOKEN in .env (see .env.example).
"""

import argparse
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "giovanni-cache"
API = "https://api.giovanni.earthdata.nasa.gov"
# Each measurement comes from its most consistent record (see TRAINING_DATA.md):
# (cache file name, Giovanni variable id, first year, last year).
GLDAS20 = [(f"2_0_{v}", f"GLDAS_NOAH025_M_2_0_{v}", 1948, 2014) for v in
           ("AvgSurfT_inst", "RootMoist_inst", "Evap_tavg", "Wind_f_inst", "SnowDepth_inst", "Psurf_f_inst")]
REQUESTS = GLDAS20 + [
    ("merra_T2M", "M2IMNXASM_5_12_4_T2M", 1980, 2025),
    ("merra_QV2M", "M2IMNXASM_5_12_4_QV2M", 1980, 2025),
    ("gpm_precipitation", "GPM_3IMERGM_07_precipitation", 1998, 2025),
    # GLDAS 2.1 air temperature, only for the site's "Do the datasets agree?" check.
    ("2_1_Tair_f_inst", "GLDAS_NOAH025_M_2_1_Tair_f_inst", 2000, 2025),
]
# Study areas and examples the site already uses, so they are always in the dataset.
FIXED_POINTS = [(44.125, -80.625), (38.625, -100.125), (23.125, -102.375), (-3.125, -60.125),
                (-15.625, -47.625), (-49.625, -70.625), (14.125, 1.875)]


def read_env():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def cell_centre(value):
    # GLDAS 0.25° cells are centred on x.125, x.375, x.625 and x.875.
    return round((value // 0.25) * 0.25 + 0.125, 3)


def land_polygons():
    text = (ROOT / "world-map.js").read_text(encoding="utf-8")
    countries = json.loads(re.search(r"countries: (\[.*\])\s*\};", text, re.S).group(1))
    return [ring for country in countries for polygon in country["polygons"] for ring in polygon[:1]]


def on_land(lat, lon, rings):
    inside = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def grid(spacing):
    rings = land_polygons()
    points = {(cell_centre(lat), cell_centre(lon))
              for lat in [-56 + spacing / 2 + i * spacing for i in range(int(140 / spacing))]
              for lon in [-180 + spacing / 2 + i * spacing for i in range(int(360 / spacing))]
              if on_land(lat, lon, rings)}
    return sorted(points | set(FIXED_POINTS))


def fetch(token, name, data, first, last, lat, lon):
    path = CACHE / f"{lat}_{lon}" / f"{name}.csv"
    if path.exists():
        return "cached"
    query = urlencode({"data": data, "location": f"[{lat},{lon}]",
                       "time": f"{first}-01-01T00:00:00/{last}-12-31T23:59:59"})
    request = Request(f"{API}/timeseries?{query}", headers={"Authorization": f"Bearer {token}"})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=180) as response:
                body = response.read().decode("utf-8")
            break
        except HTTPError as error:
            if error.code in (401, 403):
                raise SystemExit("Giovanni refused the token. Generate a new one at urs.earthdata.nasa.gov and update .env.")
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    if "Timestamp" not in body:
        # Ocean, ice sheet or outside coverage: record it so reruns don't ask again.
        body = "NO DATA\n" + body[:500]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return "saved"


def quota(token):
    with urlopen(Request(f"{API}/quota", headers={"Authorization": f"Bearer {token}"}), timeout=60) as response:
        return json.load(response)["quota"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot", action="store_true", help="download one point and report the quota it used")
    parser.add_argument("--spacing", type=float, default=3.0, help="lattice spacing in degrees")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    token = read_env().get("EARTHDATA_TOKEN")
    if not token:
        raise SystemExit("Add EARTHDATA_TOKEN to .env first (see .env.example).")

    points = FIXED_POINTS[:1] if args.pilot else grid(args.spacing)
    jobs = [(*request, lat, lon) for lat, lon in points for request in REQUESTS]
    before = quota(token)
    print(f"{len(points)} points, {len(jobs)} requests, quota used so far {before:.4f}")
    started = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        for done, result in enumerate(pool.map(lambda job: fetch(token, *job), jobs), 1):
            if done % 50 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} ({result}), {time.time() - started:.0f} s", flush=True)
    after = quota(token)
    per_point = (after - before) / len(points)
    print(f"quota used {before:.4f} -> {after:.4f}; about {per_point:.5f} per point")
    if args.pilot and per_point > 0:
        print(f"a full month's quota covers about {int((1 - after) / per_point)} more points")


if __name__ == "__main__":
    main()
