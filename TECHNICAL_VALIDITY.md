# Technical validity

The explorer shows how a climate measurement changed at a stored land point and how two measurements moved together. It uses NASA Giovanni records downloaded into Supabase.

| Design choice | Why we made it |
|---|---|
| One record per sampled coordinate | The map and the assistant use the same point ID. The imported snapshot has 1,656 points, including all six named study areas. Different NASA products can have different native grid resolutions. [Point schema](supabase/climate_points.sql) · [Data pipeline](TRAINING_DATA.md) |
| A source per measurement | MERRA-2 supplies air temperature and specific humidity, GPM IMERG supplies precipitation, and GLDAS 2.0 supplies land measurements including root-zone soil moisture in millimetres. Relative humidity is derived from MERRA-2 temperature and humidity and a monthly GLDAS pressure baseline. [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/) · [Dataset builder](build_gldas_dataset.py) |
| Actual complete-year windows | Monthly arrays share a January 1948 origin and use nulls for unavailable months. The chart uses the longest consecutive run of complete years for each measurement and requires four years. Monthly anomalies compare each month with the average for that calendar month in the fitted window. [Explorer](trend-explorer.js) |
| Trend size and uncertainty | We fit a straight line to annual values and report the slope per decade with Newey–West standard errors using up to three annual lags. Theil–Sen’s median pairwise slope and the Mann–Kendall rank test provide a second estimate and test. Mann–Kendall uses the Hamed–Rao variance correction when the lag-1 autocorrelation of the detrended ranks is significantly positive, modelling longer lags as AR(1) for stability on short records; the correction never reduces the variance. Holm adjustment accounts for testing multiple variables. The globe applies the same Newey–West t test to each point, with Benjamini–Hochberg control of the false discovery rate across about 1,700 points. [Statistics code](trend-statistics.js) · [Newey and West](https://www.nber.org/papers/t0055) |
| Lagged correlation | We remove calendar-month means and a fitted linear trend for each series, then pair the first variable with the second zero to six months later. The result includes both date ranges, dataset names and the actual number of pairs. Correlation describes a historical association. Claims about causes or future conditions require separate evidence. [Correlation query](supabase/giovanni_correlations.sql) |
| Refresh by point | One month maps to one array index per measurement. The refresh stores newly published values in empty positions and preserves existing values during retries. The monthly charts can show the newest observations while annual statistics wait for a complete year. [Refresh SQL](supabase/giovanni_refresh.sql) |

## Worked example

At the Southern Ontario point, GPM IMERG precipitation and GLDAS 2.0 root-zone soil moisture have a same-month correlation of **0.2485** across **204** paired months from January 1998 to December 2014. At a one-month lag it is **0.3523** across **203** pairs. Precipitation months run from January 1998 to November 2014 and moisture months run from February 1998 to December 2014. These values were calculated from the stored Giovanni point arrays.

## AI use

Codex assisted with implementation, testing and documentation. Groq extracts a structured request from the original question. The app checks the place, measurements and lag before running the lookup. The browser calculates trends and area correlations from stored observations. A read-only MCP tool returns single-point correlations and research links. [Setup](TRAINING_DATA.md)
