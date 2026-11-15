# Giovanni forecast experiments

The experiments reuse the site's monthly feature generation, ridge trainer, and recursive backtest. They predict land air temperature, specific humidity, relative humidity, and precipitation. All runs use the same 350 held-out land locations and 58 forecast start months from January 2020 through October 2024, with verification through September 2025. Training starts in 2008 to allow five years of AIRS history. Seasonal normals and feature scales use data through 2014.

| Experiment | Finding | Results |
|---|---|---|
| Local atmospheric and ocean histories | Combined inputs cut test RMSE by 0.16% versus land-only ridge, with slightly higher validation error. | [JSON](results/results.json) |
| Deeper neural networks | The validation-selected deeper model scored worse than ridge on the test set for both input sets. | [JSON](results/depth-results.json) |
| Regional ocean temperatures | Eight area-weighted AIRS skin-temperature averages cut test RMSE by 0.04–0.10% versus corresponding ridge runs, with slightly higher validation error. | [JSON](results/regional-results.json) |

## Reproduce

Use Python with NumPy and the historical 5° Giovanni cache. The 5° backtest cohort and its download command are available on `codex/forecast-experiments` at `f2a352a`. Run from the repository root.

```sh
python forecast-experiments/forecast_experiment.py
python forecast-experiments/deep_forecast.py
python forecast-experiments/regional_ocean_forecast.py
```

The first script reads Niño 3.4 from [KNMI Climate Explorer](https://climexp.knmi.nl/data/iersst_nino3.4a.dat). If needed, save that file as `giovanni-cache/forecast-experiment/knmi-nino34.dat` before running. The scripts write their training arrays, weights, and new results under `giovanni-cache/forecast-experiment/`. The site continues to load `world-model.js`.
