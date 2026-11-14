"""Train the monthly climate world model and write world-model.js.

The model reads the last 12 months of all 8 measurements (as anomalies from the
1991-2020 monthly normal), each measurement's 5-year average anomaly, the target
calendar month and latitude, then predicts next month's 8 anomalies. Feeding each
prediction back in gives a 12-month forecast.

Splits are by time: fit 1986-2014, choose the model on 2015-2019, report 2020-2025.
The shipped model is refit on 1986-2019, so 2020-2025 stays unseen by it.
A leave-one-region-out run checks how it does on a place it never trained on.

    python train_world_model.py
"""

import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
VARS = ["T2M", "TS", "PRECTOTCORR", "QV2M", "RH2M", "GWETROOT", "EVLAND", "WS10M"]
START_YEAR, END_YEAR = 1981, 2025
BASELINE = (1991, 2020)
LAGS, RECENT, LEADS = 12, 60, 12


def month_index(year, month=1):
    return (year - START_YEAR) * 12 + month - 1


VAL_START, TEST_START = month_index(2015), month_index(2020)
MONTHS = month_index(END_YEAR, 12) + 1


def load():
    """Return {region: {"cells": [(lat, values[T, 8])], "lat": centre_lat}} in the explorer's units."""
    regions = {}
    for path in sorted((ROOT / "training-data").glob("*.csv")):
        cells = {}
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                values = [float(row[name.lower()]) for name in VARS]
                values[VARS.index("GWETROOT")] *= 100  # the explorer shows soil wetness in percent
                cells.setdefault((float(row["lat"]), float(row["lon"])), {})[int(row["yyyymm"])] = values
        series = []
        for (lat, _), months in sorted(cells.items()):
            keys = sorted(months)
            assert len(keys) == MONTHS and keys[0] == START_YEAR * 100 + 1, path
            series.append((lat, np.array([months[key] for key in keys])))
        lats = sorted({lat for lat, _ in series})
        regions[path.stem] = {"cells": series, "lat": lats[len(lats) // 2]}
    return regions


def anomalies(values):
    """Subtract each calendar month's 1991-2020 mean, as the explorer's monthly anomaly view does."""
    first, last = month_index(BASELINE[0]), month_index(BASELINE[1], 12) + 1
    normal = values[first:last].reshape(-1, 12, len(VARS)).mean(axis=0)
    return values - np.tile(normal, (MONTHS // 12, 1))


def region_average(cells):
    # Same area weighting as the explorer: cell area scales with cos(latitude).
    weights = np.array([math.cos(math.radians(lat)) for lat, _ in cells])
    return np.tensordot(weights / weights.sum(), np.stack([values for _, values in cells]), axes=1)


def features(window, target_months, lat):
    """window: [n, RECENT, 8] scaled anomalies ending just before each row's target month."""
    n = window.shape[0]
    angle = 2 * np.pi * (np.broadcast_to(target_months, n) % 12) / 12
    return np.concatenate([
        window[:, -LAGS:].reshape(n, -1),
        window.mean(axis=1),
        np.column_stack([np.sin(angle), np.cos(angle), np.full(n, lat / 90)]),
    ], axis=1)


def samples(series, lat, first, last):
    """One-step training pairs for target months first..last-1."""
    targets = np.arange(max(first, RECENT), last)
    window = np.stack([series[t - RECENT:t] for t in targets])
    return features(window, targets, lat), series[targets]


def stack(pairs):
    return np.concatenate([p[0] for p in pairs]), np.concatenate([p[1] for p in pairs])


class Ridge:
    kind = "linear"

    def __init__(self, alpha):
        self.alpha = alpha

    def fit(self, x, y, *_):
        self.mean = x.mean(axis=0)
        xc = np.hstack([x - self.mean, np.ones((len(x), 1))])
        penalty = self.alpha * np.eye(xc.shape[1])
        penalty[-1, -1] = 0
        solution = np.linalg.solve(xc.T @ xc + penalty, xc.T @ y)
        # Fold the centring into the weights so the browser does one matrix product.
        self.w = solution[:-1]
        self.b = solution[-1] - self.mean @ self.w
        return self

    def predict(self, x):
        return x @ self.w + self.b

    def export(self):
        return {"layers": [{"w": self.w.tolist(), "b": self.b.tolist(), "activation": None}]}


class MLP:
    kind = "mlp"

    def __init__(self, hidden, seed=0):
        self.hidden, self.rng = hidden, np.random.default_rng(seed)

    def fit(self, x, y, xv, yv, epochs=400, batch=256, lr=2e-3, decay=1e-4, patience=25):
        d = x.shape[1]
        p = {
            "w1": self.rng.normal(0, 1 / math.sqrt(d), (d, self.hidden)), "b1": np.zeros(self.hidden),
            "w2": self.rng.normal(0, 1 / math.sqrt(self.hidden), (self.hidden, y.shape[1])), "b2": np.zeros(y.shape[1]),
        }
        m = {k: np.zeros_like(v) for k, v in p.items()}
        v = {k: np.zeros_like(v) for k, v in p.items()}
        best, best_loss, wait, step = None, np.inf, 0, 0
        for _ in range(epochs):
            order = self.rng.permutation(len(x))
            for start in range(0, len(x), batch):
                idx = order[start:start + batch]
                h = np.tanh(x[idx] @ p["w1"] + p["b1"])
                err = (h @ p["w2"] + p["b2"] - y[idx]) * (2 / len(idx))
                dh = (err @ p["w2"].T) * (1 - h ** 2)
                grads = {"w2": h.T @ err + decay * p["w2"], "b2": err.sum(0),
                         "w1": x[idx].T @ dh + decay * p["w1"], "b1": dh.sum(0)}
                step += 1
                for k in p:  # Adam
                    m[k] = 0.9 * m[k] + 0.1 * grads[k]
                    v[k] = 0.999 * v[k] + 0.001 * grads[k] ** 2
                    p[k] -= lr * (m[k] / (1 - 0.9 ** step)) / (np.sqrt(v[k] / (1 - 0.999 ** step)) + 1e-8)
            self.p = p
            loss = np.mean((self.predict(xv) - yv) ** 2)
            if loss < best_loss - 1e-5:
                best, best_loss, wait = {k: a.copy() for k, a in p.items()}, loss, 0
            elif (wait := wait + 1) >= patience:
                break
        self.p, self.epochs = best, step
        return self

    def predict(self, x):
        return np.tanh(x @ self.p["w1"] + self.p["b1"]) @ self.p["w2"] + self.p["b2"]

    def export(self):
        return {"layers": [
            {"w": self.p["w1"].tolist(), "b": self.p["b1"].tolist(), "activation": "tanh"},
            {"w": self.p["w2"].tolist(), "b": self.p["b2"].tolist(), "activation": None},
        ]}


def rollouts(model, series, lat, first, last):
    """12-month forecasts from every start month whose 12 targets fall in first..last-1.

    Returns predictions, persistence and recent-average guesses, and truth, each [starts, LEADS, 8].
    """
    starts = np.arange(first, last - LEADS + 1)
    window = np.stack([series[s - RECENT:s] for s in starts])
    persistence = np.repeat(window[:, -1:], LEADS, axis=1)
    # "Recent average": that calendar month's mean anomaly over the 5 years before the start.
    recent = np.stack([[series[s + k - 12 * np.arange(1, 6)].mean(axis=0) for k in range(LEADS)] for s in starts])
    predictions = []
    for k in range(LEADS):
        step = model.predict(features(window, starts + k, lat))
        predictions.append(step)
        window = np.concatenate([window[:, 1:], step[:, None]], axis=1)
    truth = np.stack([series[s:s + LEADS] for s in starts])
    return np.stack(predictions, axis=1), persistence, recent, truth


def scores(results, scale):
    """RMSE in real units per lead and variable for the model and both baselines."""
    pred, pers, recent, truth = (np.concatenate([r[i] for r in results]) for i in range(4))
    rmse = lambda guess: np.sqrt(((guess - truth) ** 2).mean(axis=0)) * scale
    return {"model": rmse(pred), "persistence": rmse(pers), "recent": rmse(recent)}


def describe(model):
    return f"ridge alpha={model.alpha}" if model.kind == "linear" else f"mlp hidden={model.hidden}"


def skill(score, against):
    return 1 - score["model"] / score[against]


def main():
    regions = load()
    cell_series, region_series = [], {}
    for name, region in regions.items():
        cell_series += [(name, lat, anomalies(values)) for lat, values in region["cells"]]
        region_series[name] = (region["lat"], anomalies(region_average(region["cells"])))
    scale = np.concatenate([s[:VAL_START] for _, _, s in cell_series]).std(axis=0)
    cell_series = [(name, lat, s / scale) for name, lat, s in cell_series]
    region_series = {name: (lat, s / scale) for name, (lat, s) in region_series.items()}

    def fit(model, names, last_train):
        train = stack([samples(s, lat, 0, last_train) for name, lat, s in cell_series if name in names])
        val = stack([samples(s, lat, VAL_START, TEST_START) for name, lat, s in cell_series if name in names])
        return model.fit(*train, *val)

    def evaluate(model, names, first, last):
        return scores([rollouts(model, region_series[n][1], region_series[n][0], first, last) for n in names], scale)

    names = list(regions)
    # Choose the model on 2015-2019 forecasts, scored on the region averages the explorer shows.
    candidates = [Ridge(alpha) for alpha in (10, 100, 1000, 3000, 10000, 30000)] + [MLP(hidden) for hidden in (16, 32, 64)]
    errors = {}
    for model in candidates:
        fit(model, names, VAL_START)
        errors[model] = (evaluate(model, names, VAL_START, TEST_START)["model"] / scale).mean()
        print(f"{describe(model):<22} validation error {errors[model]:.4f}")
    chosen = min(errors, key=errors.get)
    best_linear = min((m for m in errors if m.kind == "linear"), key=errors.get)
    label = describe(chosen)
    make = (lambda: Ridge(chosen.alpha)) if chosen.kind == "linear" else (lambda: MLP(chosen.hidden))
    print(f"chosen: {label}")

    # Refit on 1986-2019 and test on 2020-2025, which neither choice nor fit has seen.
    final = fit(make(), names, TEST_START)
    test = evaluate(final, names, TEST_START, MONTHS)
    linear_test = evaluate(fit(Ridge(best_linear.alpha), names, TEST_START), names, TEST_START, MONTHS)

    # Leave one region out: train on the other five, test the unseen one on 2020-2025.
    unseen = [evaluate(fit(make(), [n for n in names if n != held], TEST_START), [held], TEST_START, MONTHS) for held in names]
    unseen_skill = np.mean([skill(score, "recent") for score in unseen], axis=0)

    beat_recent, beat_persistence = skill(test, "recent"), skill(test, "persistence")
    print("\n2020-2025 skill vs recent average, leads 1, 3, 6, 12:")
    for i, name in enumerate(VARS):
        print(f"  {name:<12}" + "  ".join(f"{beat_recent[k, i]:+.2f}" for k in (0, 2, 5, 11)) +
              f"   unseen region {unseen_skill[0, i]:+.2f}  vs persistence {beat_persistence[0, i]:+.2f}")
    print(f"linear baseline mean skill {skill(linear_test, 'recent').mean():+.3f}, chosen {beat_recent.mean():+.3f}")

    round_list = lambda a: np.round(a, 4).tolist()
    payload = {
        "kind": chosen.kind,
        "label": label,
        "variables": VARS,
        "lags": LAGS,
        "recent": RECENT,
        "leads": LEADS,
        "baseline": BASELINE,
        "trainedThrough": 2019,
        "testYears": [2020, END_YEAR],
        "scale": round_list(scale),
        "layers": [{"w": np.round(np.array(layer["w"]), 6).tolist(), "b": np.round(np.array(layer["b"]), 6).tolist(),
                    "activation": layer["activation"]} for layer in final.export()["layers"]],
        "rmse": round_list(test["model"]),
        "skillVsRecent": round_list(beat_recent),
        "skillVsPersistence": round_list(beat_persistence),
        "unseenRegionSkillVsRecent": round_list(unseen_skill),
        "linearSkillVsRecent": round_list(skill(linear_test, "recent")),
    }
    (ROOT / "world-model.js").write_text("window.WORLD_MODEL = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"\nWrote world-model.js ({(ROOT / 'world-model.js').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
