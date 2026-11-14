# Data pipeline

Every number on the site comes from sources on the NASA Space Apps resource list: NASA's **Giovanni** (GES DISC) and the **KNMI Climate Explorer**. The data is downloaded once into the team's Supabase database, and the site reads from there.

## Which record each measurement uses

Each measurement uses the most consistent NASA record Giovanni offers for it:

| Measurement | Record | Years | Giovanni variable |
|---|---|---|---|
| Air temperature | MERRA-2 | 1980–2025 | `M2IMNXASM_5_12_4_T2M` |
| Specific humidity | MERRA-2 | 1980–2025 | `M2IMNXASM_5_12_4_QV2M` |
| Relative humidity | computed from MERRA-2 temperature and humidity, with GLDAS 2.0's typical surface pressure for each month | 1980–2025 | — |
| Precipitation | GPM IMERG (satellites calibrated to rain gauges) | 1998–Sep 2025 | `GPM_3IMERGM_07_precipitation` |
| Surface temperature, root-zone soil moisture, evapotranspiration, wind speed, snow depth | GLDAS 2.0 Noah land model | 1948–2014 | `GLDAS_NOAH025_M_2_0_*` |
| Air temperature, comparison only | GLDAS 2.1 Noah | 2000–2025 | `GLDAS_NOAH025_M_2_1_Tair_f_inst` |
| El Niño (Niño 3.4 anomaly) | KNMI Climate Explorer, NOAA ERSSTv5 | 1854–present | `iersst_nino3.4a.dat` |

**Why not GLDAS 2.1 for everything:** its weather inputs come from an operational system that was upgraded over the years, which builds false trends into it. Over 2000–2025 it shows the Sahel warming at +0.63 °C per decade where MERRA-2 shows +0.04, and India at +0.49 where MERRA-2 shows −0.14. GLDAS 2.0 agrees with MERRA-2 over 1980–2014. The site shows GLDAS 2.1 only in the "Do the datasets agree?" check.

## Rebuilding the data

1. Copy `.env.example` to `.env`. Add an Earthdata token (urs.earthdata.nasa.gov → Generate Token) and approve the Giovanni app once by visiting https://api.giovanni.earthdata.nasa.gov/signin.
2. `python download_gldas.py --pilot` fetches one point and checks the token. `python download_gldas.py --spacing 3 --workers 8` fetches about 1,700 land points (about an hour). Responses are cached in `giovanni-cache/`, so reruns resume.
3. Run `supabase/climate_points.sql` once in the Supabase SQL Editor, and add the service-role key to `.env`.
4. `python build_gldas_dataset.py` builds `gldas-dataset.npz` (training), `points-index.js`, `featured-stripes.js`, `study-areas.csv` and `trend-config.js`, and upserts every point into Supabase.
5. `python train_world_model.py` trains the forecast and writes `world-model.js`.

The table `climate_points` holds one row per land point: every measurement is a monthly array starting January 1948, with nulls outside its record. Anyone can read it with the public anon key; only the service role writes.

## Current build

1,656 land points (58 coastal cells were skipped because the models treat them as ocean). The trend map flags a significant change at 73% of places for air temperature, 77% for specific humidity, but only 4% for precipitation.

World model skill against the recent-average guess on 2020–2025, at 350 places it never trained on (lead 1 / 3 / 6 / 12 months):

| Measurement | 1 | 3 | 6 | 12 |
|---|---|---|---|---|
| Relative humidity | +0.17 | +0.07 | +0.04 | +0.02 |
| Air temperature | +0.10 | +0.08 | +0.06 | +0.04 |
| Specific humidity | +0.11 | +0.02 | +0.00 | −0.02 |
| Precipitation | +0.07 | +0.05 | +0.05 | +0.04 |

The linear model (ridge, alpha 10,000) beat 32- and 64-unit neural networks on 2015–2019 forecasts, so it ships.
