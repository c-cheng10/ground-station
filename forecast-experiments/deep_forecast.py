"""Compare deeper MLPs on the saved forecast backtest split."""

import json
import numpy as np

import forecast_experiment as experiment

forecast = experiment.forecast


class DeepMLP:
    def __init__(self, widths, n_in, n_out, seed=0):
        self.rng = np.random.default_rng(seed)
        self.params = []
        dims = (n_in, *widths, n_out)
        for i, j in zip(dims, dims[1:]):
            self.params.extend([self.rng.standard_normal((i, j), dtype=np.float32) / np.sqrt(np.float32(i)),
                                np.zeros(j, dtype=np.float32)])

    def forward(self, x):
        activations = [np.asarray(x, dtype=np.float32)]
        for i in range(0, len(self.params), 2):
            value = activations[-1] @ self.params[i] + self.params[i + 1]
            activations.append(np.tanh(value) if i + 2 < len(self.params) else value)
        return activations

    def predict(self, x):
        return self.forward(x)[-1]

    def fit(self, x, y, epochs=60, validation=None):
        means = [np.zeros_like(p) for p in self.params]
        variances = [np.zeros_like(p) for p in self.params]
        best, best_epoch, best_loss, step = None, None, np.inf, 0
        for epoch in range(1, epochs + 1):
            order = self.rng.permutation(len(x))
            for start in range(0, len(x), 512):
                idx = order[start:start + 512]
                states = self.forward(x[idx])
                delta = (states[-1] - y[idx]) * (2 / len(idx))
                grads = []
                for layer in reversed(range(len(states) - 1)):
                    w = self.params[2 * layer]
                    grads[0:0] = [states[layer].T @ delta + 1e-4 * w, delta.sum(axis=0)]
                    if layer:
                        delta = (delta @ w.T) * (1 - states[layer] ** 2)
                step += 1
                for p, m, v, g in zip(self.params, means, variances, grads):
                    m *= 0.9
                    m += 0.1 * g
                    v *= 0.999
                    v += 0.001 * g ** 2
                    p -= (2e-3 / (1 - 0.9 ** step)) * m / (np.sqrt(v / (1 - 0.999 ** step)) + 1e-8)
            if validation is not None:
                xv, yv = validation
                loss = np.mean((self.predict(xv) - yv) ** 2)
                if loss < best_loss - 1e-5:
                    best, best_epoch, best_loss = [p.copy() for p in self.params], epoch, loss
                elif epoch - best_epoch >= 8:
                    break
        if best is not None:
            self.params = best
        return best_epoch


def score(model, series, enso, lat, first, last):
    rmse = forecast.rollouts(model, series, enso, lat, first, last)["model"][:, :experiment.TARGET_COUNT]
    return float(rmse.mean()), rmse


def run(data, train, name, channels):
    values = np.concatenate([data[key] for key in channels], axis=-1)
    series, scale = experiment.prepare(values, train)
    enso, lat = data["enso"], data["lat"]
    xs = series[train]
    x, y = (arr.astype(np.float32) for arr in experiment.batches(xs, enso, lat[train], experiment.FIRST_TARGET, forecast.VAL_START))
    xv, yv = (arr.astype(np.float32) for arr in experiment.batches(xs, enso, lat[train], forecast.VAL_START, forecast.TEST_START))
    dims = (x.shape[1], y.shape[1])
    runs = []
    for widths in ((64,), (64, 32), (64, 64, 32)):
        model = DeepMLP(widths, *dims)
        epochs = model.fit(x, y, validation=(xv, yv))
        validation, _ = score(model, xs, enso, lat[train], forecast.VAL_START, forecast.TEST_START)
        runs.append(dict(widths=widths, epochs=epochs, validation=validation))
        print(f"{name} {widths} validation={validation:.7f} epochs={epochs}", flush=True)

    deep = min(runs[1:], key=lambda item: item["validation"])
    x, y = np.concatenate((x, xv)), np.concatenate((y, yv))
    for result in (runs[0], deep):
        fit = DeepMLP(result["widths"], *dims)
        fit.fit(x, y, epochs=result["epochs"])
        result["test"], rmse = score(fit, series[~train], enso, lat[~train], forecast.TEST_START, experiment.END)
        result["rmse_by_lead"] = (rmse * scale[:experiment.TARGET_COUNT]).tolist()
        key = "-".join(map(str, result["widths"]))
        np.savez_compressed(experiment.OUTPUT / f"mlp-{name}-{key}.npz", *fit.params, scale=scale)
        print(f"{name} {result['widths']} test={result['test']:.7f}", flush=True)
    return runs


def main():
    with np.load(experiment.OUTPUT / "training-arrays.npz") as stored:
        data = dict(stored)
    train = np.random.default_rng(42).random(len(data["land"])) >= 0.2
    results = {}
    for name, channels in (("land", ("land",)), ("atmosphere-ocean", ("land", "atmosphere", "ocean"))):
        results[name] = run(data, train, name, channels)
        (experiment.OUTPUT / "depth-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
