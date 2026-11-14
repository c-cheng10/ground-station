begin;

create table public.climate_cell_monthly (
    region_id text not null check (region_id <> ''),
    cell_id text not null,
    lat numeric(6, 3) not null check (lat between -90 and 90),
    lon numeric(6, 3) not null check (lon between -180 and 180),
    yyyymm integer not null check (
        yyyymm / 100 between 1981 and 9999 and yyyymm % 100 between 1 and 12
    ),
    t2m double precision,
    ts double precision,
    prectotcorr double precision,
    qv2m double precision,
    rh2m double precision,
    gwetroot double precision check (gwetroot between 0 and 1),
    evland double precision,
    ws10m double precision,
    primary key (cell_id, yyyymm),
    check (cell_id = lat::text || ',' || lon::text)
);

create index climate_cell_monthly_region_month
    on public.climate_cell_monthly (region_id, yyyymm);

comment on table public.climate_cell_monthly is 'Monthly NASA POWER MERRA-2 records at native grid-cell centres. Missing features use NULL.';
comment on column public.climate_cell_monthly.t2m is 'Air temperature at 2 m, degrees Celsius.';
comment on column public.climate_cell_monthly.ts is 'Surface skin temperature, degrees Celsius.';
comment on column public.climate_cell_monthly.prectotcorr is 'Corrected precipitation rate, mm/day.';
comment on column public.climate_cell_monthly.qv2m is 'Specific humidity at 2 m, g/kg.';
comment on column public.climate_cell_monthly.rh2m is 'Relative humidity at 2 m, percent.';
comment on column public.climate_cell_monthly.gwetroot is 'Root-zone soil wetness, fraction of saturation (0–1).';
comment on column public.climate_cell_monthly.evland is 'Land evapotranspiration rate, mm/day.';
comment on column public.climate_cell_monthly.ws10m is 'Wind speed at 10 m, m/s.';

alter table public.climate_cell_monthly enable row level security;
revoke all on public.climate_cell_monthly from public, anon, authenticated;
grant select, insert, update on public.climate_cell_monthly to service_role;

commit;
