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
