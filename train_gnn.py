"""Graph neural network world model: a small GraphCast-style model on the site's land points.

Every land point is a node. Edges join each node to its 8 nearest neighbours (local
spread) and to 4 points 1,500-2,500 km away (longer-range links, standing in for
GraphCast's multi-scale mesh). An encoder embeds each node's recent history, a
processor passes messages along edges for a few rounds, and a decoder predicts next
month's anomalies for every node at once. A linear path from inputs to outputs runs
alongside, so the network only has to learn what a linear model can't.

Inputs per node match train_world_model.py: the last 12 months of the 4 forecast
measurements (scaled anomalies from the 2001-2020 normal), their 5-year means, El Niño
for the 12 months before the target, the season, and the node's location.

Training unrolls several months at a time (feeding predictions back in, as GraphCast's
fine-tuning does) so 12-month forecasts drift less. Same splits as the ridge model:
fit 2003-2014, early-stop on 2015-2019 forecasts, report 2020-2025 at the 20% of
places whose own errors never trained the model.

    .venv/Scripts/python train_gnn.py            # full run, writes gnn-world-model.pt
    .venv/Scripts/python train_gnn.py --quick    # 2-epoch smoke test
"""

import argparse
import math
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

import train_world_model as base

ROOT = Path(__file__).resolve().parent
EARTH_KM = 6371


def build_graph(lat, lon, near=8, far=4, far_km=(1500, 2500)):
    """Edges (sender, receiver) plus edge features: direction and distance."""
    phi, lam = np.radians(lat), np.radians(lon)
    xyz = np.column_stack([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    km = EARTH_KM * np.arccos(np.clip(xyz @ xyz.T, -1, 1))
    np.fill_diagonal(km, np.inf)
    senders, receivers = [], []
    rng = np.random.default_rng(0)
    for i in range(len(lat)):
        links = list(np.argsort(km[i])[:near])
        ring = np.flatnonzero((km[i] > far_km[0]) & (km[i] < far_km[1]))
        if len(ring):
            links += list(rng.choice(ring, size=min(far, len(ring)), replace=False))
        senders += links
        receivers += [i] * len(links)
    senders, receivers = np.array(senders), np.array(receivers)
    dlat = (lat[senders] - lat[receivers]) / 30
    dlon = ((lon[senders] - lon[receivers] + 180) % 360 - 180) / 30
    features = np.column_stack([dlat, dlon, km[senders, receivers] / 2500])
    return torch.tensor(np.stack([senders, receivers])), torch.tensor(features, dtype=torch.float32)


def mlp(n_in, n_out, hidden, dropout=0.0):
    return nn.Sequential(nn.Linear(n_in, hidden), nn.SiLU(), nn.Dropout(dropout), nn.Linear(hidden, n_out))


class GraphWorldModel(nn.Module):
    """Hybrid, in the spirit of NeuralGCM: a frozen linear core (the ridge model) plus a
    graph network that learns corrections. The correction starts at exactly zero, so
    training begins from the core's forecast and can only add what helps."""

    def __init__(self, n_in, n_out, edges, edge_features, core, hidden=32, rounds=2, dropout=0.1):
        super().__init__()
        self.register_buffer("edges", edges)
        self.register_buffer("edge_features", edge_features)
        self.register_buffer("core_w", torch.tensor(core.w, dtype=torch.float32))
        self.register_buffer("core_b", torch.tensor(core.b, dtype=torch.float32))
        self.encoder = mlp(n_in, hidden, hidden, dropout)
        self.messages = nn.ModuleList(mlp(2 * hidden + edge_features.shape[1], hidden, hidden, dropout) for _ in range(rounds))
        self.updates = nn.ModuleList(mlp(2 * hidden, hidden, hidden, dropout) for _ in range(rounds))
        self.norms = nn.ModuleList(nn.LayerNorm(hidden) for _ in range(rounds))
        self.decoder = mlp(hidden, n_out, hidden)
        nn.init.zeros_(self.decoder[-1].weight)
        nn.init.zeros_(self.decoder[-1].bias)

    def forward(self, x):
        """x: [nodes, n_in] -> next month [nodes, n_out]."""
        senders, receivers = self.edges
        h = self.encoder(x)
        degree = torch.bincount(receivers, minlength=len(x)).clamp(min=1).unsqueeze(1)
        for message, update, norm in zip(self.messages, self.updates, self.norms):
            m = message(torch.cat([h[senders], h[receivers], self.edge_features], dim=1))
            incoming = torch.zeros_like(h).index_add_(0, receivers, m) / degree
            h = norm(h + update(torch.cat([h, incoming], dim=1)))
        core = x[:, :len(self.core_w)] @ self.core_w + self.core_b
        return core + self.decoder(h)


class Inputs:
    """Builds node features for a whole-graph step, matching train_world_model.features()."""

    def __init__(self, lat, lon, enso):
        self.lat = lat
        self.static = np.column_stack([np.sin(np.radians(lon)), np.cos(np.radians(lon))])
        self.enso = enso

    def __call__(self, window, target, origin):
        n = len(window)
        x = base.features(window, base.enso_before(self.enso, np.full(n, target), np.full(n, origin)),
                          np.full(n, target), self.lat)
        return torch.tensor(np.concatenate([x, self.static], axis=1), dtype=torch.float32)


def rollout(model, inputs, series, start, steps):
    """Predict `steps` months for every node from the real months before `start`."""
    window = series[:, start - base.RECENT:start]
    out = []
    for k in range(steps):
        step = model(inputs(window, start + k, start - 1))
        out.append(step)
        window = np.concatenate([window[:, 1:], step.detach().numpy()[:, None]], axis=1)
    return torch.stack(out, dim=1)  # [nodes, steps, vars]


def train_loss(model, inputs, series, start, steps, mask):
    """Unrolled loss that keeps gradients through fed-back predictions."""
    window = torch.tensor(series[:, start - base.RECENT:start], dtype=torch.float32)
    loss = 0
    for k in range(steps):
        x = inputs(window.detach().numpy(), start + k, start - 1)
        # Swap the lag block for the differentiable window so errors flow back through earlier steps.
        lags = window[:, -base.LAGS:].reshape(len(window), -1)
        x = torch.cat([lags, x[:, lags.shape[1]:]], dim=1)
        step = model(x)
        loss = loss + ((step - torch.tensor(series[:, start + k], dtype=torch.float32))[mask] ** 2).mean()
        window = torch.cat([window[:, 1:], step[:, None]], dim=1)
    return loss / steps


def evaluate(model, inputs, series, first, last, nodes):
    """RMSE per lead and variable (scaled units) for the model and the two simple guesses."""
    errors = {"model": [], "persistence": [], "recent": []}
    chosen = series[nodes]
    with torch.no_grad():
        for s in range(first, last - base.LEADS + 1):
            truth = chosen[:, s:s + base.LEADS]
            window = chosen[:, s - base.RECENT:s]
            recent = np.stack([chosen[:, s + k - 12 * np.arange(1, 6)].mean(axis=1) for k in range(base.LEADS)], axis=1)
            guesses = {"model": rollout(model, inputs, series, s, base.LEADS).numpy()[nodes],
                       "persistence": np.repeat(window[:, -1:], base.LEADS, axis=1), "recent": recent}
            for key, guess in guesses.items():
                errors[key].append((guess - truth) ** 2)
    return {key: np.sqrt(np.concatenate(value).mean(axis=0)) for key, value in errors.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--hidden", type=int, default=32)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--alpha", type=float, default=10000, help="ridge strength of the frozen core")
    parser.add_argument("--rollout", type=int, default=3, help="months unrolled per training example")
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--quick", action="store_true", help="2 epochs, to check everything runs")
    args = parser.parse_args()
    if args.quick:
        args.epochs = 2
    torch.manual_seed(0)

    anomalies, enso, lat, end = base.load()
    lon = np.load(ROOT / "gldas-dataset.npz")["lon"]
    unseen = np.random.default_rng(42).random(len(anomalies)) < 0.2  # same split as the ridge model
    scale = np.nanstd(anomalies[~unseen, base.FIRST_TARGET - base.RECENT:base.VAL_START], axis=(0, 1))
    series = np.nan_to_num(anomalies / scale)
    edges, edge_features = build_graph(lat, lon)
    inputs = Inputs(lat, lon, enso)
    n_in = inputs(series[:, :base.RECENT], base.RECENT, base.RECENT - 1).shape[1]
    # The frozen core: the same ridge model the site uses, fit on the same training years and places.
    core = base.Ridge(args.alpha).fit(*base.samples(series[~unseen], enso, lat[~unseen], base.FIRST_TARGET, base.VAL_START))
    model = GraphWorldModel(n_in, len(base.VARS), edges, edge_features, core, args.hidden, args.rounds, args.dropout)
    print(f"{len(lat)} nodes, {edges.shape[1]} edges, {sum(p.numel() for p in model.parameters()):,} parameters")

    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)
    train_mask = torch.tensor(~unseen)
    train_nodes, unseen_nodes = np.flatnonzero(~unseen), np.flatnonzero(unseen)
    starts = np.arange(base.FIRST_TARGET, base.VAL_START - args.rollout + 1)
    model.eval()
    best_error = evaluate(model, inputs, series, base.VAL_START, base.TEST_START, train_nodes)["model"].mean()
    best, wait, core_error = {k: v.clone() for k, v in model.state_dict().items()}, 0, best_error
    print(f"epoch  0: core only (ridge)       2015-2019 forecast error {core_error:.4f}", flush=True)
    for epoch in range(args.epochs):
        began = time.time()
        model.train()
        total = 0
        for start in np.random.default_rng(epoch).permutation(starts):
            optimiser.zero_grad()
            loss = train_loss(model, inputs, series, int(start), args.rollout, train_mask)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            total += loss.item()
        model.eval()
        val = evaluate(model, inputs, series, base.VAL_START, base.TEST_START, train_nodes)["model"].mean()
        print(f"epoch {epoch + 1:>2}: train {total / len(starts):.4f}  2015-2019 forecast error {val:.4f}  ({time.time() - began:.0f} s)", flush=True)
        if val < best_error - 1e-4:
            best, best_error, wait = {k: v.clone() for k, v in model.state_dict().items()}, val, 0
        elif (wait := wait + 1) >= args.patience:
            break
    model.load_state_dict(best)
    torch.save({"state": best, "args": vars(args), "scale": scale, "n_in": n_in}, ROOT / "gnn-world-model.pt")

    test = evaluate(model, inputs, series, base.TEST_START, end, unseen_nodes)
    skill = 1 - test["model"] / test["recent"]
    print(f"\nbest 2015-2019 forecast error {best_error:.4f} vs core alone {core_error:.4f}")
    core_only = GraphWorldModel(n_in, len(base.VARS), edges, edge_features, core, args.hidden, args.rounds).eval()
    ridge_test = evaluate(core_only, inputs, series, base.TEST_START, end, unseen_nodes)
    print("Skill vs recent average on 2020-2025, unseen places (leads 1, 3, 6, 12):")
    for i, name in enumerate(base.VARS):
        ridge_skill = 1 - ridge_test["model"][:, i] / ridge_test["recent"][:, i]
        print(f"  {name:<12}" + "  ".join(f"{skill[k, i]:+.2f}" for k in (0, 2, 5, 11)) +
              "   ridge alone " + "  ".join(f"{ridge_skill[k]:+.2f}" for k in (0, 2, 5, 11)))
    print("Saved gnn-world-model.pt")


if __name__ == "__main__":
    main()
