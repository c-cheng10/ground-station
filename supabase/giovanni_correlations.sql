begin;

create or replace function public.get_giovanni_correlation(
    point_id text,
    variable_x text,
    variable_y text,
    lag_months integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with point as (
        select * from public.climate_points
        where id = point_id and lag_months between 0 and 6
    ),
    samples as (
        select feature.variable_id, feature.source, sample.month_index,
               (sample.month_index - 1) / 12 as year_index,
               (sample.month_index - 1) % 12 as calendar_month,
               sample.value::double precision as value
        from point
        cross join lateral (values
            ('t2m', 'MERRA-2', point.t2m),
            ('ts', 'GLDAS 2.0', point.ts),
            ('prectotcorr', 'GPM IMERG', point.prectotcorr),
            ('qv2m', 'MERRA-2', point.qv2m),
            ('rh2m', 'Derived from MERRA-2 and GLDAS 2.0 pressure', point.rh2m),
            ('gwetroot', 'GLDAS 2.0', point.gwetroot),
            ('evland', 'GLDAS 2.0', point.evland),
            ('ws10m', 'GLDAS 2.0', point.ws10m),
            ('snow', 'GLDAS 2.0', point.snow)
        ) as feature(variable_id, source, monthly_values)
        cross join lateral unnest(feature.monthly_values) with ordinality as sample(value, month_index)
        where feature.variable_id in (variable_x, variable_y)
          and sample.month_index <= (2025 - 1948 + 1) * 12
          and sample.value > '-Infinity'::real and sample.value < 'Infinity'::real
    ),
    complete_years as (
        select variable_id, year_index,
               year_index - row_number() over (partition by variable_id order by year_index) as run_id
        from samples
        group by variable_id, year_index
        having count(*) = 12
    ),
    runs as (
        select variable_id, min(year_index) as first_year, max(year_index) as last_year
        from complete_years
        group by variable_id, run_id
        having count(*) >= 4
    ),
    -- Use the longest contiguous run of complete years, favouring the latest on ties.
    spans as (
        select distinct on (variable_id) variable_id, first_year, last_year
        from runs
        order by variable_id, last_year - first_year desc, last_year desc
    ),
    seasons as (
        select samples.*, first_value(value) over (
            partition by samples.variable_id, calendar_month order by year_index
        ) as reference
        from samples join spans using (variable_id)
        where year_index between first_year and last_year
    ),
    centred as (
        select *, (value - reference) - avg(value - reference) over (
            partition by variable_id, calendar_month
        ) as anomaly
        from seasons
    ),
    residuals as (
        select variable_id, source, month_index,
               (1948 + year_index) * 100 + calendar_month + 1 as yyyymm,
               anomaly - regr_slope(anomaly, year_index) over series_window
                       * (year_index - avg(year_index::double precision) over series_window) as residual
        from centred
        window series_window as (partition by variable_id)
    ),
    pairs as (
        select x.source as source_x, y.source as source_y,
               min(x.yyyymm) as first_month_x, max(x.yyyymm) as last_month_x,
               min(y.yyyymm) as first_month_y, max(y.yyyymm) as last_month_y,
               count(*)::integer as paired_months, corr(x.residual, y.residual) as r
        from residuals x
        join residuals y on y.month_index = x.month_index + lag_months
        where x.variable_id = variable_x and y.variable_id = variable_y
        group by x.source, y.source
    )
    select jsonb_build_object(
        'point_id', point.id, 'lat', point.lat, 'lon', point.lon,
        'variable_x', variable_x, 'variable_y', variable_y, 'lag_months', lag_months,
        'pearson_r', case when paired_months >= 24 and r is not null then greatest(-1.0, least(1.0, r)) end,
        'paired_months', paired_months,
        'first_month', first_month_x, 'last_month', last_month_y,
        'first_month_x', first_month_x, 'last_month_x', last_month_x,
        'first_month_y', first_month_y, 'last_month_y', last_month_y,
        'source_x', source_x, 'source_y', source_y,
        'method', 'pearson_monthly_detrended_v1'
    )
    from point cross join pairs;
$function$;

revoke all on function public.get_giovanni_correlation(text, text, text, integer)
    from public, anon, authenticated;
grant execute on function public.get_giovanni_correlation(text, text, text, integer) to service_role;

commit;
