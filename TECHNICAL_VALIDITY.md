# Technical validity

The explorer makes it possible to see how a climate measurement changed at a stored land point and how two measurements moved together. This branch uses NASA Giovanni records downloaded into Supabase.

| Design choice | Why we made it |
|---|---|
| One record per sampled coordinate | The map and the assistant use the same point ID. Repeated requests read the stored data and missing preset points stay unavailable. The selected coordinate identifies a grid sample and different NASA products can have different native resolutions. [Point schema](supabase/climate_points.sql) · [Data pipeline](TRAINING_DATA.md) |
| A source per measurement | MERRA-2 supplies air temperature and specific humidity, GPM IMERG supplies precipitation, and GLDAS 2.0 supplies land measurements including root-zone soil moisture in millimetres. Relative humidity is derived from MERRA-2 temperature and humidity and a monthly GLDAS pressure baseline. [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/) · [Dataset builder](build_gldas_dataset.py) |
| Actual complete-year windows | Monthly arrays share a January 1948 origin and use nulls for unavailable months. The chart uses the longest consecutive run of complete years for each measurement and requires four years. Monthly anomalies compare each month with the average for that calendar month in the fitted window. [Explorer](trend-explorer.js) |
| Trend size and uncertainty | We fit a straight line to annual values and report the slope per decade with Newey–West standard errors using up to three annual lags. Theil–Sen’s median pairwise slope and the Mann–Kendall rank test provide a second estimate and test. The classic Mann–Kendall test assumes independent annual values. Holm adjustment accounts for testing multiple variables. [Statistics code](trend-statistics.js) · [Newey and West](https://www.nber.org/papers/t0055) |
| Lagged correlation | We remove calendar-month means and a fitted linear trend for each series, then pair the first variable with the second zero to six months later. The result includes both date ranges, dataset names and the actual number of pairs. Correlation describes a historical association. Claims about causes or future conditions require separate evidence. [Correlation query](supabase/giovanni_correlations.sql) |

## Worked example

At the Southern Ontario point, GPM IMERG precipitation and GLDAS 2.0 root-zone soil moisture have a same-month correlation of **0.2485** across **204** paired months from January 1998 to December 2014. At a one-month lag it is **0.3523** across **203** pairs. Precipitation months run from January 1998 to November 2014 and moisture months run from February 1998 to December 2014. These values were calculated from the stored Giovanni point arrays.

## AI use

Codex assisted with implementation, testing and documentation. Groq routes a question to a read-only MCP tool. SQL computes the correlation from the stored point, and the interface displays the coefficient and coverage returned by the tool. The research tool links to external sources for context. [Setup](TRAINING_DATA.md)
