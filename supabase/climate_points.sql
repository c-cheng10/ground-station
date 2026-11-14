-- Run once in the Supabase SQL Editor. Stores one row per land point, every
-- measurement as a monthly array starting January 1948 (null outside its record).
-- Filled by build_gldas_dataset.py; read by the website with the public anon key.
begin;

create table public.climate_points (
    id text primary key,
    lat double precision not null check (lat between -90 and 90),
    lon double precision not null check (lon between -180 and 180),
    t2m real[],         -- MERRA-2 air temperature, °C, 1980-2025
    ts real[],          -- GLDAS 2.0 surface temperature, °C, 1948-2014
    prectotcorr real[], -- GPM IMERG precipitation, mm/day, 1998-2025
    qv2m real[],        -- MERRA-2 specific humidity, g/kg
    rh2m real[],        -- relative humidity from MERRA-2, %
    gwetroot real[],    -- GLDAS 2.0 root-zone soil moisture, mm
    evland real[],      -- GLDAS 2.0 evapotranspiration, mm/day
    ws10m real[],       -- GLDAS 2.0 wind speed, m/s
    snow real[],        -- GLDAS 2.0 snow depth, cm
    t2m_gldas21 real[]  -- GLDAS 2.1 air temperature, °C, 2000-2025 (comparison only)
);

alter table public.climate_points enable row level security;
-- The data is public NASA data, so anyone may read it; only the service role writes.
create policy "Anyone can read climate points" on public.climate_points for select to anon, authenticated using (true);
grant select on public.climate_points to anon, authenticated;
grant select, insert, update on public.climate_points to service_role;

commit;
