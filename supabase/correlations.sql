begin;

create materialized view public.climate_correlations as
with cell_values as (
    select cell.region_id, cell.yyyymm, feature.variable_id, feature.value,
           cos(radians(cell.lat::double precision)) as weight
    from public.climate_cell_monthly as cell
    cross join lateral (values
        ('t2m', cell.t2m), ('ts', cell.ts), ('prectotcorr', cell.prectotcorr),
        ('qv2m', cell.qv2m), ('rh2m', cell.rh2m), ('gwetroot', cell.gwetroot),
        ('evland', cell.evland), ('ws10m', cell.ws10m)
    ) as feature(variable_id, value)
    where cell.yyyymm between 198101 and 202512
),
regional_months as (
    select region_id, variable_id, yyyymm / 100 as sample_year,
           yyyymm % 100 as calendar_month,
           (yyyymm / 100) * 12 + yyyymm % 100 as month_index,
           sum(value * weight) / sum(weight) as measurement,
           count(*) over (partition by region_id, variable_id) as complete_months
    from cell_values
    group by region_id, variable_id, yyyymm
    having count(*) = 9 and bool_and(
        value is not null and value > '-Infinity'::double precision
        and value < 'Infinity'::double precision
    )
),
season_references as (
    select *, first_value(measurement) over (
        partition by region_id, variable_id, calendar_month order by sample_year
    ) as reference
    from regional_months
    where complete_months = 540
),
centred as (
    select region_id, variable_id, month_index, sample_year,
           (measurement - reference) - avg(measurement - reference) over (
               partition by region_id, variable_id, calendar_month
           ) as anomaly
    from season_references
),
residuals as (
    select region_id, variable_id, month_index,
           anomaly - regr_slope(anomaly, sample_year) over series_window
                   * (sample_year - avg(sample_year::double precision) over series_window)
               as residual
    from centred
    window series_window as (partition by region_id, variable_id)
),
series as (
    select region_id, variable_id, array_agg(residual order by month_index) as monthly_residuals
    from residuals
    group by region_id, variable_id
),
correlations as (
    select earlier.region_id, earlier.variable_id as variable_x,
           later.variable_id as variable_y, lag.lag_months,
           corr(pair.x, pair.y) as r,
           count(*)::integer as paired_months
    from series as earlier
    join series as later using (region_id)
    cross join generate_series(0, 6) as lag(lag_months)
    cross join lateral unnest(
        earlier.monthly_residuals[1:cardinality(earlier.monthly_residuals) - lag.lag_months],
        later.monthly_residuals[1 + lag.lag_months:cardinality(later.monthly_residuals)]
    ) as pair(x, y)
    group by earlier.region_id, earlier.variable_id, later.variable_id, lag.lag_months
)
select region_id, variable_x, variable_y, lag_months,
       case when r is not null then greatest(-1.0, least(1.0, r)) end as pearson_r,
       paired_months, 198101 as first_month, 202512 as last_month,
       'pearson_monthly_detrended_v1'::text as method
from correlations;

create unique index climate_correlations_key on public.climate_correlations
    (region_id, lag_months, variable_x, variable_y, first_month, last_month, method);

comment on materialized view public.climate_correlations is
    'Area-weighted regional monthly Pearson correlations after removing calendar-month means and linear trends. X leads Y by lag_months.';

revoke all on public.climate_correlations from public, anon, authenticated, service_role;
grant select on public.climate_correlations to service_role;

commit;
