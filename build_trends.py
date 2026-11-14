"""Regenerate the annual CSV snapshot from NASA POWER."""

import csv
import json
import math
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
API = "https://power.larc.nasa.gov/api/temporal/monthly/point"


def read_config():
    source = (ROOT / "trend-config.js").read_text(encoding="utf-8").strip()
    prefix = "window.TREND_CONFIG = "
    if not source.startswith(prefix) or not source.endswith(";"):
        raise ValueError("Expected trend-config.js to contain a single JSON assignment")
    return json.loads(source[len(prefix):-1])


def site_cells(site):
    latitude, longitude = site["latitude"], site["longitude"]
    return list(product(
        [latitude - 0.5, latitude, latitude + 0.5],
        [longitude - 0.625, longitude, longitude + 0.625],
    ))


def download_cell(cell, variables, years, periods):
    latitude, longitude = cell
    query = urlencode({
        "parameters": ",".join(variable["id"] for variable in variables),
        "community": "AG",
        "latitude": latitude,
        "longitude": longitude,
        "start": years.start,
        "end": years.stop - 1,
        "format": "JSON",
    })
    with urlopen(f"{API}?{query}", timeout=30) as response:
        payload = json.load(response)

    header = payload["header"]
    fill = header["fill_value"]
    if ("MERRA2" not in header["sources"]
            or payload["geometry"]["coordinates"][:2] != [longitude, latitude]
            or not math.isfinite(fill)):
        raise ValueError(f"Unexpected NASA POWER metadata for {cell}")

    columns = []
    for variable in variables:
        key, unit = variable["id"], variable["unit"]
        native_unit = "1" if key == "GWETROOT" else unit.replace("°C", "C")
        if payload["parameters"][key]["units"] != native_unit:
            raise ValueError(f"Unexpected {key} unit for {cell}")
        observations = payload["properties"]["parameter"][key]
        values = [observations.get(period, fill) for period in periods]
        if any(value == fill or not math.isfinite(value) for value in values):
            raise ValueError(f"Incomplete {key} record for {cell}")
        columns.append(values)
    return columns


def main():
    config = read_config()
    variables = config["variables"]
    years = range(config["startYear"], config["endYear"] + 1)
    periods = [f"{year}13" for year in years]
    scales = [100 if variable["id"] == "GWETROOT" else 1 for variable in variables]
    rows = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for site in config["sites"]:
            cells = site_cells(site)
            # The area of equal-width latitude/longitude cells scales with cosine latitude.
            weights = [math.cos(math.radians(lat)) for lat, _ in cells]
            total_weight = sum(weights)
            records = pool.map(lambda cell: download_cell(cell, variables, years, periods), cells)
            averages = []
            for columns, scale in zip(zip(*records), scales):
                averages.append([
                    sum(value * scale * weight for value, weight in zip(values, weights)) / total_weight
                    for values in zip(*columns)
                ])
            for year, values in zip(years, zip(*averages)):
                rows.append([
                    site["name"], site["region"], site["latitude"], site["longitude"], year,
                    *(f"{value:.6f}" for value in values),
                ])

    with (ROOT / "americas-trends.csv").open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output, lineterminator="\n")
        columns = [f"{variable['id']} ({variable['unit']})" for variable in variables]
        writer.writerow(["site", "country", "centre_latitude", "centre_longitude", "year", *columns])
        writer.writerows(rows)

    print(f"Wrote {len(rows)} site-year rows")


if __name__ == "__main__":
    main()
