"""Test latitude-weighted ocean skin-temperature anomalies as ridge inputs."""

import json
import numpy as np

import forecast_experiment as experiment

forecast = experiment.forecast

# Longitude bounds wrap across the date line where west > east.
REGIONS = {
    "north_pacific": (20, 60, 120, -110),
    "tropical_west_pacific": (-20, 20, 120, 180),
    "tropical_east_pacific": (-20, 20, -180, -75),
    "south_pacific": (-60, -20, 150, -75),
    "north_atlantic": (20, 65, -80, 0),
    "tropical_atlantic": (-20, 20, -65, 15),
    "south_atlantic": (-60, -20, -65, 20),
    "indian_ocean": (-40, 25, 25, 115),
}


def regional_series():
    points = experiment.experiment_ocean_grid()
    lat, lon = np.asarray(points).T
    weights = np.cos(np.radians(lat))
    series = np.stack([experiment.channel_values(point, ("airs_SurfSkinTemp",))[:, 0] for point in points])
    training = series[:, experiment.NORMAL_START:forecast.VAL_START]
    normal = np.nanmean(training.reshape(len(points), -1, 12), axis=1)
    anomalies = series - normal[:, np.arange(series.shape[1]) % 12]
    coverage, regional = {}, []
    for name, (south, north, west, east) in REGIONS.items():
        longitude = (lon >= west) & (lon < east) if west < east else (lon >= west) | (lon < east)
        mask = (lat >= south) & (lat < north) & longitude
        area = weights[mask, None]
        values = anomalies[mask]
        available_area = (np.isfinite(values) * area).sum(axis=0)
        mean = np.divide(np.nansum(values * area, axis=0), available_area,
                         out=np.full(series.shape[1], np.nan), where=available_area > 0)
        window = slice(experiment.FIRST_TARGET - forecast.RECENT, experiment.END)
        assert np.isfinite(mean[window]).all()
        coverage[name] = {"cells": int(mask.sum()), "min_available_area_fraction": float(available_area[window].min() / area.sum())}
        regional.append(mean)
    return np.column_stack(regional).astype(np.float32), coverage


def run(name, channels, data, train, regional):
    context = np.broadcast_to(regional, (len(train), *regional.shape))
    values = np.concatenate([*(data[key] for key in channels), context], axis=-1)
    series, scale = experiment.prepare(values, train)
    enso, lat = data["enso"], data["lat"]
    train_series, train_lat = series[train], lat[train]
    x, y = experiment.batches(train_series, enso, train_lat, experiment.FIRST_TARGET, forecast.VAL_START)
    scores = {}
    for alpha in (10, 100, 1000, 10000, 100000):
        model = forecast.Ridge(alpha).fit(x, y)
        rmse = forecast.rollouts(model, train_series, enso, train_lat, forecast.VAL_START, forecast.TEST_START)["model"]
        scores[alpha] = float(rmse[:, :experiment.TARGET_COUNT].mean())
        print(f"{name} alpha={alpha} validation={scores[alpha]:.7f}", flush=True)
    alpha = min(scores, key=scores.get)
    xv, yv = experiment.batches(train_series, enso, train_lat, forecast.VAL_START, forecast.TEST_START)
    model = forecast.Ridge(alpha).fit(np.concatenate((x, xv)), np.concatenate((y, yv)))
    rmse = forecast.rollouts(model, series[~train], enso, lat[~train], forecast.TEST_START, experiment.END)["model"]
    rmse = rmse[:, :experiment.TARGET_COUNT]
    np.savez_compressed(experiment.OUTPUT / f"{name}.npz", w=model.w, b=model.b, scale=scale, alpha=alpha)
    return {"alpha": alpha, "validation_rmse": scores[alpha], "validation_candidates": scores,
            "test_rmse_mean_standardized": float(rmse.mean()),
            "test_rmse": (rmse * scale[:experiment.TARGET_COUNT]).tolist()}


def main():
    with np.load(experiment.OUTPUT / "training-arrays.npz") as stored:
        data = dict(stored)
    train = np.random.default_rng(42).random(len(data["land"])) >= 0.2
    regional, coverage = regional_series()
    output = {"regions": coverage, "region_bounds": REGIONS, "held_out_locations": int((~train).sum()),
              "test_origins": experiment.END - forecast.TEST_START - forecast.LEADS + 1, "targets": forecast.VARS,
              "runs": {}}
    for name, channels in (("land-regional", ("land",)),
                           ("atmosphere-regional", ("land", "atmosphere")),
                           ("atmosphere-ocean-regional", ("land", "atmosphere", "ocean"))):
        output["runs"][name] = run(name, channels, data, train, regional)
        print(f"{name} test={output['runs'][name]['test_rmse_mean_standardized']:.7f}", flush=True)
        (experiment.OUTPUT / "regional-results.json").write_text(json.dumps(output, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
