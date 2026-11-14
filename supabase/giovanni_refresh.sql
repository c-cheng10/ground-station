begin;

create table if not exists public.giovanni_refresh_claims (
    point_id text primary key,
    refreshed_at timestamptz
);

alter table public.giovanni_refresh_claims enable row level security;
revoke all on public.giovanni_refresh_claims from public, anon, authenticated;
insert into public.giovanni_refresh_claims (point_id) values ('') on conflict do nothing;

create or replace function public.claim_giovanni_refresh(requested_point text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    global_claim_at timestamptz;
    point_claim_at timestamptz;
    next_allowed_at timestamptz;
    now_at timestamptz;
begin
    if not exists (select from public.climate_points where id = requested_point) then
        return jsonb_build_object('status', 'not_found');
    end if;

    -- The empty point ID names a single row that serializes claims across the project.
    select refreshed_at into global_claim_at
    from public.giovanni_refresh_claims
    where point_id = ''
    for update;

    select refreshed_at into point_claim_at
    from public.giovanni_refresh_claims
    where point_id = requested_point;

    now_at := clock_timestamp();
    next_allowed_at := greatest(global_claim_at + interval '30 seconds', point_claim_at + interval '15 minutes');
    if next_allowed_at > now_at then
        return jsonb_build_object(
            'status', 'limited', 'retry_after_seconds', ceil(extract(epoch from next_allowed_at - now_at))::integer
        );
    end if;

    update public.giovanni_refresh_claims set refreshed_at = now_at where point_id = '';
    insert into public.giovanni_refresh_claims (point_id, refreshed_at)
    values (requested_point, now_at)
    on conflict (point_id) do update set refreshed_at = excluded.refreshed_at;
    return jsonb_build_object('status', 'claimed');
end;
$$;

create or replace function public.append_giovanni_months(requested_point text, additions jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    point public.climate_points%rowtype;
    measurement record;
    observation record;
    series real[];
    reading real;
    yyyymm integer;
    slot integer;
    utc_now timestamp := statement_timestamp() at time zone 'UTC';
    current_month integer := extract(year from utc_now)::integer * 100 + extract(month from utc_now)::integer;
    filled_slots integer := 0;
    filled_months integer[] := '{}';
    latest_month integer;
begin
    if jsonb_typeof(additions) is distinct from 'object' then
        raise exception 'Expected a JSON object keyed by measurement' using errcode = '22023';
    end if;

    select * into point from public.climate_points where id = requested_point for update;
    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;

    for measurement in select * from jsonb_each(additions) loop
        if measurement.key not in ('t2m', 'qv2m', 'rh2m', 'prectotcorr', 't2m_gldas21')
            or jsonb_typeof(measurement.value) is distinct from 'object' then
            raise exception 'Invalid Giovanni measurement or month object' using errcode = '22023';
        end if;

        series := case measurement.key
            when 't2m' then point.t2m
            when 'qv2m' then point.qv2m
            when 'rh2m' then point.rh2m
            when 'prectotcorr' then point.prectotcorr
            when 't2m_gldas21' then point.t2m_gldas21
        end;

        for observation in select * from jsonb_each(measurement.value) loop
            if observation.key !~ '^[0-9]{6}$' or jsonb_typeof(observation.value) is distinct from 'number' then
                raise exception 'Invalid Giovanni month or reading' using errcode = '22023';
            end if;
            yyyymm := observation.key::integer;
            if yyyymm % 100 not between 1 and 12 or yyyymm >= current_month
                or yyyymm < (case when measurement.key = 'prectotcorr' then 202510 else 202601 end) then
                raise exception 'Giovanni month is outside the refresh window' using errcode = '22023';
            end if;
            begin
                reading := observation.value::real;
            exception when numeric_value_out_of_range then
                raise exception 'Giovanni reading is outside real number range' using errcode = '22023';
            end;

            slot := (yyyymm / 100 - 1948) * 12 + yyyymm % 100;
            if series[slot] is null then
                if coalesce(cardinality(series), 0) = 0 then
                    series := array[null]::real[];
                end if;
                series[slot] := reading;
                filled_slots := filled_slots + 1;
                if not (yyyymm = any(filled_months)) then
                    filled_months := array_append(filled_months, yyyymm);
                end if;
                latest_month := greatest(latest_month, yyyymm);
            end if;
        end loop;

        case measurement.key
            when 't2m' then point.t2m := series;
            when 'qv2m' then point.qv2m := series;
            when 'rh2m' then point.rh2m := series;
            when 'prectotcorr' then point.prectotcorr := series;
            when 't2m_gldas21' then point.t2m_gldas21 := series;
        end case;
    end loop;

    if filled_slots > 0 then
        update public.climate_points set
            t2m = point.t2m,
            qv2m = point.qv2m,
            rh2m = point.rh2m,
            prectotcorr = point.prectotcorr,
            t2m_gldas21 = point.t2m_gldas21
        where id = requested_point;
    end if;

    return jsonb_build_object(
        'status', 'ok', 'filled_slots', filled_slots, 'filled_months', cardinality(filled_months), 'latest_month', latest_month
    );
end;
$$;

revoke all on function public.claim_giovanni_refresh(text), public.append_giovanni_months(text, jsonb)
    from public, anon, authenticated;
grant execute on function public.claim_giovanni_refresh(text), public.append_giovanni_months(text, jsonb)
    to service_role;

commit;
