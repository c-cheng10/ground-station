# Monthly climate training data

The six CSVs use the same columns and units. Each has 4,860 rows from 9 grid cells across 540 months, January 1981 through December 2025. Coordinates are the centres of the native NASA POWER grid cells and `cell_id` is the latitude and longitude joined with a comma. `yyyymm` is an integer such as `198101` for January 1981. [NASA POWER monthly API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/)

| Column | Monthly feature | Unit |
|---|---|---|
| `t2m` | Air temperature at 2 m | °C |
| `ts` | Surface skin temperature | °C |
| `prectotcorr` | Corrected precipitation rate | mm/day |
| `qv2m` | Specific humidity at 2 m | g/kg |
| `rh2m` | Relative humidity at 2 m | % |
| `gwetroot` | Root-zone soil wetness | Fraction of saturation (0–1) |
| `evland` | Land evapotranspiration rate | mm/day |
| `ws10m` | Wind speed at 10 m | m/s |

## Regional CSVs

- [Southern Ontario](training-data/southern-ontario.csv)
- [Central Great Plains](training-data/great-plains.csv)
- [Mexican Plateau](training-data/mexican-plateau.csv)
- [Central Amazon](training-data/central-amazon.csv)
- [Cerrado](training-data/cerrado.csv)
- [Patagonian Steppe](training-data/patagonian-steppe.csv)

## Import into Supabase

1. Create a project and run [schema.sql](supabase/schema.sql) once in the SQL Editor.
2. In **Table Editor → climate_cell_monthly → Insert → Import Data from CSV**, import each file in [training-data](training-data/) into the same table. The table key prevents duplicate cell-month rows. [Supabase CSV import](https://supabase.com/docs/guides/database/import-data#option-1-csv-import-via-supabase-dashboard)
3. Verify the result in the SQL Editor.

   ```sql
   select region_id, count(*) as rows, count(distinct cell_id) as cells,
          min(yyyymm) as first_month, max(yyyymm) as last_month
   from public.climate_cell_monthly
   group by region_id
   order by region_id;
   ```

   Expect six results with 4,860 rows, 9 cells, `198101` and `202512` each.

The table is private to database administrators and the backend service role. Keep the service key on the server. [Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys)

## Connect the refresh button

1. After importing the CSVs, run [refresh.sql](supabase/refresh.sql) in the SQL Editor. It adds the queries the Edge Function uses to find the latest complete month and limit refreshes to once a minute per region.
2. In **Edge Functions → Deploy a new function → Via Editor**, name it `refresh-climate` and replace the editor contents with [index.ts](supabase/functions/refresh-climate/index.ts). Keep **Verify JWT with legacy secret** enabled for this configuration. The function accepts a region ID and keeps the privileged database key server-side. [Dashboard deployment](https://supabase.com/docs/guides/functions/quickstart-dashboard)
3. Set `supabaseUrl` and `supabaseAnonKey` in [trend-config.js](trend-config.js) to the project URL and its public legacy `anon` key. Supabase plans to retire legacy API keys in early 2027. [Key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
4. Open the explorer, choose a region and click **Refresh from NASA**. The function inserts nine grid-cell rows per new complete month. The table’s unique key and conflict handling let you repeat the request without creating duplicate rows.

## Training

Group by `cell_id` and order by `yyyymm` before building input sequences. Use the same target-month cutoffs for all regions. Fit scaling on the training period only. Supabase refreshes add to the shared dataset. The charts continue to use the end year set in `trend-config.js`.

## World model

`python train_world_model.py` (numpy only, about 20 seconds) trains the forecast the explorer shows and writes `world-model.js`.

- **Input:** the last 12 months of all 8 measurements as anomalies from the 1991–2020 monthly normal, each measurement's 5-year average anomaly, the target calendar month and latitude. **Output:** next month's 8 anomalies. Feeding predictions back in gives 12 months.
- **Splits by time:** fit 1986–2014, choose the model on 2015–2019 forecasts, refit on 1986–2019, report 2020–2025. Scores use the 9-cell region averages the explorer shows.
- **Models tried:** ridge regression (a vector autoregression) at 6 strengths and a 1-hidden-layer network at 16, 32 and 64 units. The linear model forecast better on 2015–2019, so it ships.
- **Baselines:** "same as last month" (persistence) and "this month's average over the last 5 years" (recent average). Skill is 1 − model error ÷ baseline error.
- **Unseen-region check:** each region is held out in turn, trained on the other five, and tested on 2020–2025.

Skill against the recent average on 2020–2025 (lead 1 / 3 / 6 / 12 months; unseen region at lead 1):

| Measurement | 1 | 3 | 6 | 12 | Unseen region |
|---|---|---|---|---|---|
| Root-zone soil wetness | +0.56 | +0.27 | +0.16 | +0.09 | +0.47 |
| Land evapotranspiration | +0.37 | +0.15 | +0.08 | +0.01 | +0.36 |
| Relative humidity | +0.26 | +0.10 | +0.06 | −0.00 | +0.22 |
| Surface temperature | +0.19 | +0.07 | +0.02 | −0.05 | +0.20 |
| Air temperature | +0.17 | +0.07 | +0.03 | −0.04 | +0.18 |
| Specific humidity | +0.16 | +0.07 | +0.07 | +0.04 | +0.14 |
| Precipitation | +0.12 | +0.10 | +0.07 | +0.04 | +0.07 |
| Wind speed | +0.03 | +0.03 | +0.04 | +0.02 | +0.02 |

The explorer's badge counts the months where skill stays at or above 0.05. The model has no greenhouse-gas input, so it is a 12-month forecast, not a long-term projection. The 1991–2020 normal overlaps the 2015–2019 tuning years, a small leak kept so anomalies match the explorer's chart.
