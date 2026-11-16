begin;

create or replace function public.merge_giovanni_history(stored real[], imported real[])
returns real[]
language sql
immutable
set search_path = ''
as $$
    select case
        when imported is null then stored
        when stored is null then imported
        else array(
            select coalesce(imported_value, stored_value)
            from unnest(imported, stored) with ordinality as observations(imported_value, stored_value, month)
            order by month
        )
    end
$$;

create or replace function public.import_giovanni_points(points jsonb, history_months integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    entry jsonb;
    point public.climate_points%rowtype;
begin
    if history_months is null or history_months not between 1 and 2000
        or jsonb_typeof(points) is distinct from 'array' then
        raise exception 'Expected an array of points and a valid historical window' using errcode = '22023';
    end if;

    if jsonb_array_length(points) not between 1 and 40 then
        raise exception 'Supply 1 to 40 points per import' using errcode = '22023';
    end if;

    for entry in select value from jsonb_array_elements(points) order by value ->> 'id' loop
        if jsonb_typeof(entry) is distinct from 'object' then
            raise exception 'Expected a point object' using errcode = '22023';
        end if;

        if exists (
            select from jsonb_each(entry) as field(name, value)
            where name not in ('id', 'lat', 'lon', 'is_ocean') and case jsonb_typeof(value)
                when 'null' then false
                when 'array' then jsonb_array_length(value) <> history_months
                else true
            end
        ) then
            raise exception 'Measurement arrays must match the historical window' using errcode = '22023';
        end if;

        point := jsonb_populate_record(null::public.climate_points, entry);
        point.is_ocean := coalesce(point.is_ocean, false);

        -- Merge under the conflict lock so source gaps and newer months keep their stored readings.
        insert into public.climate_points as stored select point.*
        on conflict (id) do update set
            lat = excluded.lat,
            lon = excluded.lon,
            is_ocean = case when entry ? 'is_ocean' then excluded.is_ocean else stored.is_ocean end,
            t2m = public.merge_giovanni_history(stored.t2m, excluded.t2m),
            ts = public.merge_giovanni_history(stored.ts, excluded.ts),
            prectotcorr = public.merge_giovanni_history(stored.prectotcorr, excluded.prectotcorr),
            qv2m = public.merge_giovanni_history(stored.qv2m, excluded.qv2m),
            rh2m = public.merge_giovanni_history(stored.rh2m, excluded.rh2m),
            gwetroot = public.merge_giovanni_history(stored.gwetroot, excluded.gwetroot),
            evland = public.merge_giovanni_history(stored.evland, excluded.evland),
            ws10m = public.merge_giovanni_history(stored.ws10m, excluded.ws10m),
            snow = public.merge_giovanni_history(stored.snow, excluded.snow),
            t2m_gldas21 = public.merge_giovanni_history(stored.t2m_gldas21, excluded.t2m_gldas21),
            ozone_column = public.merge_giovanni_history(stored.ozone_column, excluded.ozone_column),
            tropopause_temp = public.merge_giovanni_history(stored.tropopause_temp, excluded.tropopause_temp),
            column_water_vapour = public.merge_giovanni_history(stored.column_water_vapour, excluded.column_water_vapour),
            cloud_fraction = public.merge_giovanni_history(stored.cloud_fraction, excluded.cloud_fraction),
            outgoing_longwave = public.merge_giovanni_history(stored.outgoing_longwave, excluded.outgoing_longwave),
            ocean_skin_temp = public.merge_giovanni_history(stored.ocean_skin_temp, excluded.ocean_skin_temp);
    end loop;
end;
$$;

revoke all on function public.merge_giovanni_history(real[], real[]), public.import_giovanni_points(jsonb, integer)
    from public, anon, authenticated;
grant execute on function public.merge_giovanni_history(real[], real[]), public.import_giovanni_points(jsonb, integer)
    to service_role;

notify pgrst, 'reload schema';
commit;
