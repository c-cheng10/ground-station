"""Train the monthly climate world model on the Giovanni dataset and write world-model.js.

Forecast measurements are the ones with records running to 2025: air temperature,
specific and relative humidity (MERRA-2) and precipitation (GPM IMERG). The model
reads the last 12 months of all four (as anomalies from each point's 2001-2020
normal), each one's 5-year average, the last 12 months of El Niño (Niño 3.4 from
KNMI Climate Explorer), the target calendar month and latitude, and predicts next
month. Feeding predictions back in gives 12 months; El Niño is held at its last
known value after the forecast starts, because the future isn't known then either.

Splits: 20% of grid points never train (unseen places). On the rest, fit 2003-2014,
choose the model on 2015-2019, refit on 2003-2019. Report 2020-2025 on both groups.

    python train_world_model.py
"""

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
VARS = ["T2M", "QV2M", "RH2M", "PRECTOTCORR"]
START = 1948
NORMAL = (2001, 2020)
LAGS, RECENT, LEADS = 12, 60, 12


def month_index(year, month=1):
    return (year - START) * 12 + month - 1


FIRST_TARGET = month_index(2003)  # 5 years after GPM starts (1998)
VAL_START, TEST_START = month_index(2015), month_index(2020)


def load():
    data = np.load(ROOT / "gldas-dataset.npz")
    ids = list(data["ids"])
    values = data["values"][:, :, [ids.index(v) for v in VARS]].astype(np.float64)
    usable = ~np.isnan(values).any(axis=(0, 2))
    end = int(np.flatnonzero(usable).max()) + 1  # first month with any gap at the end (GPM lags)
    first, last = month_index(NORMAL[0]), month_index(NORMAL[1], 12) + 1
    normal = np.nanmean(values[:, first:last].reshape(len(values), -1, 12, len(VARS)), axis=1)
    anomalies = values - np.tile(normal, (1, values.shape[1] // 12, 1))
    return anomalies, data["enso"], data["lat"], end


def features(window, enso_window, target, lat):
    """window [n, RECENT, V] scaled anomalies; enso_window [n, LAGS]; target and lat [n]."""
    n = len(window)
    angle = 2 * np.pi * (target % 12) / 12
    return np.concatenate([window[:, -LAGS:].reshape(n, -1), window.mean(axis=1), enso_window,
                           np.column_stack([np.sin(angle), np.cos(angle), lat / 90])], axis=1)


def enso_before(enso, months, origin):
    """El Niño for the LAGS months before each target, frozen after `origin` (unknown future)."""
    idx = np.minimum(np.asarray(months)[:, None] - LAGS + np.arange(LAGS), np.asarray(origin)[:, None])
    return enso[idx]


def samples(series, enso, lat, first, last):
    t = np.arange(max(first, FIRST_TARGET), last)
    p, t = np.repeat(np.arange(len(series)), len(t)), np.tile(t, len(series))
    window = series[p[:, None], t[:, None] - RECENT + np.arange(RECENT)]
    return features(window, enso_before(enso, t, t - 1), t, lat[p]), series[p, t]


class Ridge:
    kind = "linear"

    def __init__(self, alpha):
        self.alpha = alpha

    def fit(self, x, y, *_):
        mean = x.mean(axis=0)
        xc = np.hstack([x - mean, np.ones((len(x), 1))])
        penalty = self.alpha * np.eye(xc.shape[1])
        penalty[-1, -1] = 0
        solution = np.linalg.solve(xc.T @ xc + penalty, xc.T @ y)
        self.w, self.b = solution[:-1], solution[-1] - mean @ solution[:-1]
        return self

    def predict(self, x):
        return x @ self.w + self.b

    def layers(self):
        return [(self.w, self.b, None)]


class MLP:
    kind = "mlp"

    def __init__(self, hidden, seed=0):
        self.hidden, self.rng = hidden, np.random.default_rng(seed)

    def fit(self, x, y, xv, yv, epochs=60, batch=512, lr=2e-3, decay=1e-4, patience=8):
        d = x.shape[1]
        p = {"w1": self.rng.normal(0, 1 / math.sqrt(d), (d, self.hidden)), "b1": np.zeros(self.hidden),
             "w2": self.rng.normal(0, 1 / math.sqrt(self.hidden), (self.hidden, y.shape[1])), "b2": np.zeros(y.shape[1])}
        m = {k: np.zeros_like(v) for k, v in p.items()}
        v = {k: np.zeros_like(a) for k, a in p.items()}
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
        self.p = best
        return self

    def predict(self, x):
        return np.tanh(x @ self.p["w1"] + self.p["b1"]) @ self.p["w2"] + self.p["b2"]

    def layers(self):
        return [(self.p["w1"], self.p["b1"], "tanh"), (self.p["w2"], self.p["b2"], None)]


def describe(model):
    return f"ridge alpha={model.alpha}" if model.kind == "linear" else f"mlp hidden={model.hidden}"


def rollouts(model, series, enso, lat, first, last):
    """RMSE (scaled units) per lead and variable for the model and two simple guesses."""
    errors = {"model": [], "persistence": [], "recent": []}
    for s in range(first, last - LEADS + 1):
        window = series[:, s - RECENT:s]
        truth = series[:, s:s + LEADS]
        persistence = np.repeat(window[:, -1:], LEADS, axis=1)
        # "Recent average": that calendar month's mean anomaly over the 5 years before the start.
        recent = np.stack([series[:, s + k - 12 * np.arange(1, 6)].mean(axis=1) for k in range(LEADS)], axis=1)
        steps = []
        for k in range(LEADS):
            target = np.full(len(series), s + k)
            step = model.predict(features(window, enso_before(enso, target, np.full(len(series), s - 1)), target, lat))
            steps.append(step)
            window = np.concatenate([window[:, 1:], step[:, None]], axis=1)
        for key, guess in (("model", np.stack(steps, axis=1)), ("persistence", persistence), ("recent", recent)):
            errors[key].append((guess - truth) ** 2)
    return {key: np.sqrt(np.concatenate(value).mean(axis=0)) for key, value in errors.items()}


def main():
    anomalies, enso, lat, end = load()
    rng = np.random.default_rng(42)
    unseen = rng.random(len(anomalies)) < 0.2
    train = ~unseen
    scale = np.nanstd(anomalies[train, FIRST_TARGET - RECENT:VAL_START], axis=(0, 1))
    series = anomalies / scale
    print(f"{len(series)} points ({train.sum()} train, {unseen.sum()} unseen); data usable to month {end}")

    def fit(model, last):
        x, y = samples(series[train], enso, lat[train], FIRST_TARGET, last)
        xv, yv = samples(series[train], enso, lat[train], VAL_START, TEST_START)
        return model.fit(x, y, xv, yv)

    candidates = [Ridge(a) for a in (10, 100, 1000, 10000, 100000)] + [MLP(h) for h in (32, 64)]
    scores = {}
    for model in candidates:
        fit(model, VAL_START)
        scores[model] = rollouts(model, series[train], enso, lat[train], VAL_START, TEST_START)["model"].mean()
        print(f"  {describe(model):<20} 2015-2019 forecast error {scores[model]:.4f}")
    chosen = min(scores, key=scores.get)
    print(f"chosen: {describe(chosen)}")
    final = fit(Ridge(chosen.alpha) if chosen.kind == "linear" else MLP(chosen.hidden), TEST_START)

    seen = rollouts(final, series[train], enso, lat[train], TEST_START, end)
    fresh = rollouts(final, series[unseen], enso, lat[unseen], TEST_START, end)
    no_enso = None
    skill = 1 - fresh["model"] / fresh["recent"]
    print("\nSkill vs recent average on 2020-2025, unseen places (leads 1, 3, 6, 12):")
    for i, name in enumerate(VARS):
        print(f"  {name:<12}" + "  ".join(f"{skill[k, i]:+.2f}" for k in (0, 2, 5, 11)) +
              f"   seen places {1 - seen['model'][0, i] / seen['recent'][0, i]:+.2f}"
              f"   vs persistence {1 - fresh['model'][0, i] / fresh['persistence'][0, i]:+.2f}")

    rounded = lambda a, d=5: np.round(np.asarray(a, dtype=float), d).tolist()
    payload = {
        "kind": chosen.kind, "label": describe(chosen), "variables": VARS, "lags": LAGS, "recent": RECENT,
        "leads": LEADS, "normal": NORMAL, "startYear": START, "trainedThrough": 2019, "testYears": [2020, 2025],
        "unseenPoints": int(unseen.sum()), "scale": rounded(scale), "enso": rounded(enso, 3),
        "layers": [{"w": rounded(w, 6), "b": rounded(b, 6), "activation": act} for w, b, act in final.layers()],
        "rmse": rounded(fresh["model"] * scale),
        "skillVsRecent": rounded(skill, 4),
        "skillVsPersistence": rounded(1 - fresh["model"] / fresh["persistence"], 4),
    }
    (ROOT / "world-model.js").write_text("window.WORLD_MODEL = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"\nWrote world-model.js ({(ROOT / 'world-model.js').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
