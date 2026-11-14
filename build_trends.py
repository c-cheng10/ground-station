"""Regenerate the explorer configuration and annual CSV snapshot."""

import csv
import json
import math
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from scipy.stats import t


START_YEAR = 1981
END_YEAR = 2025
YEARS = list(range(START_YEAR, END_YEAR + 1))
ANNUAL_LAGS = 3
API = "https://power.larc.nasa.gov/api/temporal/monthly/point"
SOURCE = "https://power.larc.nasa.gov/docs/services/api/temporal/monthly/"
METHOD = "https://www.nber.org/papers/t0055"
ROOT = Path(__file__).resolve().parent
BASELINE_START = 1991
BASELINE_END = 2020

# NASA POWER uses a 0.5° latitude by 0.625° longitude meteorology grid.
LAT_STEP = 0.5
LON_STEP = 0.625
SITES = [
    ("southern-ontario", "Southern Ontario", "Canada", "North America", 44, -80.625),
    ("great-plains", "Central Great Plains", "United States", "North America", 38.5, -100),
    ("mexican-plateau", "Mexican Plateau", "Mexico", "North America", 23, -102.5),
    ("central-amazon", "Central Amazon", "Brazil", "South America", -3, -60),
    ("cerrado", "Cerrado", "Brazil", "South America", -15.5, -47.5),
    ("patagonian-steppe", "Patagonian Steppe", "Argentina", "South America", -49.5, -70.625),
]

# Key, display name, API unit, display unit, slope unit, digits, description.
VARIABLES = [
    ("T2M", "Air temperature", "C", "°C", "°C", 2, "Temperature of the air two metres above the surface."),
    ("TS", "Surface temperature", "C", "°C", "°C", 2, "Temperature at the ground or water surface."),
    ("PRECTOTCORR", "Precipitation", "mm/day", "mm/day", "mm/day", 2, "Average daily water from rain and snow, adjusted using observations."),
    ("QV2M", "Specific humidity", "g/kg", "g/kg", "g/kg", 2, "Grams of water vapour per kilogram of near-surface air."),
    ("RH2M", "Relative humidity", "%", "%", "pp", 2, "Near-surface water vapour as a percentage of saturation at that temperature."),
    ("GWETROOT", "Root-zone soil wetness", "1", "%", "pp", 2, "How close the top metre of soil is to saturation."),
    ("EVLAND", "Land evapotranspiration", "mm/day", "mm/day", "mm/day", 2, "Average daily water returned to the air from land, including evaporation and water released by plants."),
    ("WS10M", "Wind speed", "m/s", "m/s", "m/s", 2, "Wind speed ten metres above the surface."),
]
MONTH_KEYS = [f"{year}{month:02}" for year in YEARS for month in range(1, 13)]
ANNUAL_KEYS = [f"{year}13" for year in YEARS]


def coordinates(latitude, longitude):
    return list(product(
        [latitude - LAT_STEP, latitude, latitude + LAT_STEP],
        [longitude - LON_STEP, longitude, longitude + LON_STEP],
    ))


def download_cell(cell):
    latitude, longitude = cell
    query = urlencode({
        "parameters": ",".join(variable[0] for variable in VARIABLES),
        "community": "AG",
        "latitude": latitude,
        "longitude": longitude,
        "start": START_YEAR,
        "end": END_YEAR,
        "format": "JSON",
    })
    with urlopen(f"{API}?{query}", timeout=30) as response:
        payload = json.load(response)

    header = payload["header"]
    actual_coordinates = payload["geometry"]["coordinates"][:2]
    if "MERRA2" not in header["sources"] or actual_coordinates != [longitude, latitude]:
        raise ValueError(f"Unexpected data source or grid location for {cell}")
    values = payload["properties"]["parameter"]
    annual, monthly = [], []
    for key, _, api_unit, *_ in VARIABLES:
        if payload["parameters"][key]["units"] != api_unit:
            raise ValueError(f"Unexpected {key} unit for {cell}")
        cell_values = [values[key][date] for date in ANNUAL_KEYS + MONTH_KEYS]
        if any(value == header["fill_value"] or not math.isfinite(value) for value in cell_values):
            raise ValueError(f"Incomplete {key} record for {cell}")
        scale = 100 if key == "GWETROOT" else 1
        annual.append([value * scale for value in cell_values[:len(YEARS)]])
        monthly.append([value * scale for value in cell_values[len(YEARS):]])
    return np.array(annual), np.array(monthly)


def fit_trend(values):
    centred_year = np.array(YEARS) - np.mean(YEARS)
    design = np.column_stack((np.ones(len(YEARS)), centred_year))
    coefficients = np.linalg.lstsq(design, values, rcond=None)[0]
    fitted = design @ coefficients
    residual_scores = design * (values - fitted)[:, None]

    # Bartlett-weighted Newey–West covariance, with a small-sample correction.
    covariance_sum = residual_scores.T @ residual_scores
    for lag in range(1, ANNUAL_LAGS + 1):
        cross_product = residual_scores[lag:].T @ residual_scores[:-lag]
        covariance_sum += (1 - lag / (ANNUAL_LAGS + 1)) * (cross_product + cross_product.T)
    inverse = np.linalg.inv(design.T @ design)
    degrees_of_freedom = len(YEARS) - design.shape[1]
    covariance = inverse @ covariance_sum @ inverse * len(YEARS) / degrees_of_freedom

    slope = coefficients[1] * 10
    standard_error = np.sqrt(covariance[1, 1]) * 10
    if not standard_error > 0:
        raise ValueError("Cannot calculate trend uncertainty for a constant or exact series")
    half_width = t.ppf(0.975, degrees_of_freedom) * standard_error
    return {
        "slope": float(slope),
        "ciLow": float(slope - half_width),
        "ciHigh": float(slope + half_width),
        "pValue": float(2 * t.sf(abs(slope / standard_error), degrees_of_freedom)),
        "startValue": float(fitted[0]),
        "endValue": float(fitted[-1]),
    }


def monthly_correlations(monthly):
    # Centre time and values within each calendar month before fitting the
    # trend. This is equivalent to fitting the trend and 12 monthly means jointly.
    time = np.arange(len(YEARS)) - np.mean(np.arange(len(YEARS)))
    centred = monthly - monthly.mean(axis=1, keepdims=True)
    slopes = (centred * time[None, :, None]).sum(axis=(1, 2)) / (12 * (time**2).sum())
    deviations = centred - slopes[:, None, None] * time[None, :, None]
    coefficients = np.corrcoef(deviations.reshape(len(VARIABLES), -1)).clip(-1, 1)
    if not np.isfinite(coefficients).all():
        raise ValueError("Undefined correlation in monthly deviations")
    return {
        left[0]: {right[0]: float(coefficients[i, j]) for j, right in enumerate(VARIABLES)}
        for i, left in enumerate(VARIABLES)
    }


def analyse_site(site, cells):
    site_id, name, region, continent, latitude, longitude = site
    patch = coordinates(latitude, longitude)
    # Spherical cell area with fixed angular dimensions is proportional to cos(latitude).
    weights = [math.cos(math.radians(lat)) for lat, _ in patch]
    annual = np.average([cells[cell][0] for cell in patch], axis=0, weights=weights)
    monthly = np.average(
        [cells[cell][1] for cell in patch], axis=0, weights=weights
    ).reshape(len(VARIABLES), len(YEARS), 12)
    baseline = monthly[:, BASELINE_START - START_YEAR:BASELINE_END - START_YEAR + 1]
    anomalies = monthly - baseline.mean(axis=1, keepdims=True)

    return {
        "id": site_id,
        "name": name,
        "region": region,
        "continent": continent,
        "latitude": latitude,
        "longitude": longitude,
        "bounds": {
            "south": latitude - 1.5 * LAT_STEP,
            "north": latitude + 1.5 * LAT_STEP,
            "west": longitude - 1.5 * LON_STEP,
            "east": longitude + 1.5 * LON_STEP,
        },
        "cellCount": len(patch),
        "series": {
            variable[0]: {
                "values": annual[index].tolist(),
                "monthlyValues": monthly[index].ravel().round(6).tolist(),
                "monthlyAnomalies": anomalies[index].ravel().round(6).tolist(),
                "trend": fit_trend(annual[index]),
            }
            for index, variable in enumerate(VARIABLES)
        },
        "correlations": monthly_correlations(monthly),
    }


def adjust_trend_tests(sites):
    trends = [series["trend"] for site in sites for series in site["series"].values()]
    adjusted_p = 0
    for rank, trend in enumerate(sorted(trends, key=lambda result: result["pValue"])):
        # Holm adjustment controls the chance of any false positive across the full set.
        adjusted_p = min(1, max(adjusted_p, (len(trends) - rank) * trend["pValue"]))
        trend["adjustedPValue"] = adjusted_p
        if adjusted_p < 0.05:
            trend["verdict"] = "rising" if trend["slope"] > 0 else "falling"
        else:
            trend["verdict"] = "inconclusive"


def write_outputs(sites):
    data = {
        "startYear": START_YEAR,
        "endYear": END_YEAR,
        "baselineStart": BASELINE_START,
        "baselineEnd": BASELINE_END,
        "sourceUrl": SOURCE,
        "methodUrl": METHOD,
        "variables": [
            {"id": key, "name": name, "unit": unit, "trendUnit": trend_unit, "description": description, "decimals": decimals}
            for key, name, _, unit, trend_unit, decimals, description in VARIABLES
        ],
        "sites": [
            {key: value for key, value in site.items() if key not in ("series", "correlations")}
            for site in sites
        ],
    }
    script = "window.TREND_CONFIG = " + json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + ";\n"
    (ROOT / "trend-config.js").write_text(script, encoding="utf-8")
    with (ROOT / "americas-trends.csv").open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output, lineterminator="\n")
        columns = [f"{key} ({unit})" for key, _, _, unit, *_ in VARIABLES]
        writer.writerow(["site", "country", "centre_latitude", "centre_longitude", "year", *columns])
        for site in sites:
            for index, year in enumerate(YEARS):
                writer.writerow([
                    site["name"], site["region"], site["latitude"], site["longitude"], year,
                    *(f"{site['series'][v[0]]['values'][index]:.6f}" for v in VARIABLES),
                ])


def main():
    patch_cells = [cell for site in SITES for cell in coordinates(site[-2], site[-1])]
    with ThreadPoolExecutor(max_workers=6) as pool:
        cells = dict(zip(patch_cells, pool.map(download_cell, patch_cells)))
    sites = [analyse_site(site, cells) for site in SITES]
    adjust_trend_tests(sites)
    write_outputs(sites)
    print(f"Wrote {len(sites)} sites × {len(VARIABLES)} variables × {len(YEARS)} years")


if __name__ == "__main__":
    main()
