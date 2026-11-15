"""Compare the previous forecast architecture with added Giovanni histories."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_gldas_dataset as dataset
import train_world_model as forecast
from download_gldas import CACHE, cell_centre, grid, land_polygons, on_land

OUTPUT = CACHE / "forecast-experiment"
ATMOSPHERE = ("merra_TO3", "merra_TROPT", "airs_TotH2OVap", "airs_CloudFrc", "airs_OLR")
OCEAN = ("merra_T2M", "gpm_precipitation", "airs_SurfSkinTemp")
NORMAL_START = forecast.month_index(2003)
FIRST_TARGET = forecast.month_index(2008)
END = forecast.month_index(2025, 10)
TARGET_COUNT = len(forecast.VARS)


def point_path(point):
    lat, lon = point
    return CACHE / f"{lat}_{lon}"


def channel_values(point, channels):
    return np.column_stack([dataset.read_series(point_path(point) / f"{name}.csv") for name in channels])


def experiment_ocean_grid():
    """Keep the 5° ocean cohort used in the original benchmark."""
    rings = land_polygons()
    latitudes = [cell_centre(-60 + (i + 0.5) * 5) for i in range(26)]
    longitudes = [cell_centre(-180 + (i + 0.5) * 5) for i in range(72)]
    return sorted({(lat, lon) for lat in latitudes for lon in longitudes
                   if not on_land(lat, lon, rings)}.difference(grid(3)))


def read_data():
    enso_source = OUTPUT / "knmi-nino34.dat"
    if enso_source.exists():
        with patch.object(dataset, "urlopen", return_value=enso_source.open("rb")):
            enso = dataset.enso()
    else:
        enso = dataset.enso()
    land_grid = grid(3)
    points, land, atmosphere = [], [], []
    target_columns = [dataset.IDS.index(name) for name in forecast.VARS]
    for point in sorted(land_grid, key=point_path):
        raw = dataset.build_point(point_path(point))
        if raw is None:
            continue
        points.append(point)
        land.append(raw[:, target_columns].astype(np.float32))
        atmosphere.append(channel_values(point, ATMOSPHERE).astype(np.float32))

    ocean_grid_points = experiment_ocean_grid()

    def sphere(coords):
        lat, lon = np.radians(coords).T
        return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))

    similarity = sphere(points) @ sphere(ocean_grid_points).T
    nearest = similarity.argmax(axis=1)
    distance = 6371 * np.arccos(np.clip(similarity.max(axis=1), -1, 1))
    ocean_history = {i: channel_values(ocean_grid_points[i], OCEAN).astype(np.float32) for i in set(nearest)}
    return dict(land=np.stack(land), atmosphere=np.stack(atmosphere),
                ocean=np.stack([ocean_history[i] for i in nearest]),
                lat=np.asarray(points)[:, 0], points=np.asarray(points), enso=enso, ocean_distance=distance)


def prepare(values, train):
    sliced = values[:, NORMAL_START:forecast.VAL_START]
    normal = np.nanmean(sliced.reshape(len(values), -1, 12, values.shape[-1]), axis=1)
    anomalies = values - normal[:, np.arange(values.shape[1]) % 12]
    scale = np.nanstd(anomalies[train, FIRST_TARGET - forecast.RECENT:forecast.VAL_START], axis=(0, 1))
    assert np.isfinite(scale).all() and (scale > 0).all()
    assert np.isfinite(anomalies[:, FIRST_TARGET - forecast.RECENT:END, :TARGET_COUNT]).all()
    return np.nan_to_num(anomalies / scale, nan=0.0), scale


def batches(series, enso, lat, first, last):
    # Keep the original feature generator while limiting its temporary 60-month windows.
    parts = [forecast.samples(series[start:start + 32], enso, lat[start:start + 32], first, last)
             for start in range(0, len(series), 32)]
    return tuple(np.concatenate(parts_by_type) for parts_by_type in zip(*parts))


def train_arm(label, values, data, train):
    series, scale = prepare(values, train)
    enso, lat = data["enso"], data["lat"]
    train_series, train_lat = series[train], lat[train]
    x, y = batches(train_series, enso, train_lat, FIRST_TARGET, forecast.VAL_START)
    xv, yv = batches(train_series, enso, train_lat, forecast.VAL_START, forecast.TEST_START)
    candidates = [forecast.Ridge(a) for a in (10, 100, 1000, 10000, 100000)]
    candidates += [forecast.MLP(h) for h in (32, 64)]
    scores = {}
    for model in candidates:
        model.fit(x, y, xv, yv)
        val = forecast.rollouts(model, train_series, enso, train_lat, forecast.VAL_START, forecast.TEST_START)
        scores[model] = float(val["model"][:, :TARGET_COUNT].mean())
        print(f"{label:18} {forecast.describe(model):20}  validation {scores[model]:.6f}", flush=True)
    chosen = min(scores, key=scores.get)
    final = forecast.Ridge(chosen.alpha) if chosen.kind == "linear" else forecast.MLP(chosen.hidden)
    final.fit(np.concatenate((x, xv)), np.concatenate((y, yv)), xv, yv)
    fresh = forecast.rollouts(final, series[~train], enso, lat[~train], forecast.TEST_START, END)
    arrays = {f"{prefix}{i}": array for i, (w, b, _) in enumerate(final.layers())
              for prefix, array in (("w", w), ("b", b))}
    np.savez_compressed(OUTPUT / f"{label}.npz", **arrays, scale=scale, kind=final.kind)
    result = {"model": forecast.describe(final), "validation_rmse": scores[chosen],
              "candidates": {forecast.describe(model): score for model, score in scores.items()},
              "test_rmse": (fresh["model"][:, :TARGET_COUNT] * scale[:TARGET_COUNT]).tolist(),
              "test_rmse_mean_standardized": float(fresh["model"][:, :TARGET_COUNT].mean()),
              "recent_rmse": (fresh["recent"][:, :TARGET_COUNT] * scale[:TARGET_COUNT]).tolist()}
    print(f"{label:18} selected {result['model']}; test mean {result['test_rmse_mean_standardized']:.6f}", flush=True)
    return result


def main():
    OUTPUT.mkdir(exist_ok=True)
    cache = OUTPUT / "training-arrays.npz"
    if not cache.exists():
        print("Building training arrays from Giovanni CSVs and KNMI Niño 3.4", flush=True)
        np.savez_compressed(cache, **read_data())
    with np.load(cache) as stored:
        data = dict(stored)

    train = np.random.default_rng(42).random(len(data["land"])) >= 0.2
    result = {"training_points": int(train.sum()), "test_points": int((~train).sum()),
              "test_origins": END - forecast.TEST_START - forecast.LEADS + 1, "targets": forecast.VARS,
              "ocean_distance_km_percentiles": np.percentile(data["ocean_distance"], (0, 50, 90, 100)).tolist(),
              "runs": {}}
    print(f"{train.sum()} training points, {(~train).sum()} held-out points, {result['test_origins']} test origins", flush=True)
    for label, context in (("land", ()), ("atmosphere", ("atmosphere",)), ("ocean", ("ocean",)),
                           ("atmosphere-ocean", ("atmosphere", "ocean"))):
        values = np.concatenate([data[key] for key in ("land", *context)], axis=-1)
        result["runs"][label] = train_arm(label, values, data, train)
        (OUTPUT / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
