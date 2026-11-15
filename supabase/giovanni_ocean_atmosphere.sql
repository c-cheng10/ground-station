-- Apply in the Supabase SQL Editor before running import_ocean_atmosphere.py --upload.
begin;

alter table public.climate_points
    add column if not exists is_ocean boolean not null default false,
    add column if not exists ozone_column real[],        -- MERRA-2, Dobson units
    add column if not exists tropopause_temp real[],     -- MERRA-2, °C
    add column if not exists column_water_vapour real[], -- AIRS, kg/m²
    add column if not exists cloud_fraction real[],       -- AIRS, %
    add column if not exists outgoing_longwave real[],    -- AIRS, W/m²
    add column if not exists ocean_skin_temp real[];      -- AIRS, °C

-- Arrays share the existing January 1948 origin.
notify pgrst, 'reload schema';
commit;
