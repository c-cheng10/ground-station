begin;

create table if not exists public.climate_refresh_limits (
    region_id text primary key,
    requested_at timestamptz not null
);

alter table public.climate_refresh_limits enable row level security;
revoke all on public.climate_refresh_limits from public, anon, authenticated;

create or replace function public.claim_climate_refresh(requested_region text)
returns boolean
language sql
security definer
set search_path = ''
as $$
    with claim as (
        insert into public.climate_refresh_limits (region_id, requested_at)
        values (requested_region, statement_timestamp())
        on conflict (region_id) do update
        set requested_at = excluded.requested_at
        where public.climate_refresh_limits.requested_at
            <= excluded.requested_at - interval '60 seconds'
        returning 1
    )
    select exists (select from claim);
$$;

create or replace function public.climate_refresh_state(requested_region text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    with regional as (
        select * from public.climate_cell_monthly
        where region_id = requested_region
    ),
    cells as (
        select distinct cell_id, lat, lon from regional
    ),
    complete_months as (
        select yyyymm from regional
        where t2m is not null and ts is not null and prectotcorr is not null
            and qv2m is not null and rh2m is not null and gwetroot is not null
            and evland is not null and ws10m is not null
        group by yyyymm
        having count(*) = 9
    )
    select jsonb_build_object(
        'latest_month', (select max(yyyymm) from complete_months),
        'cells', (select coalesce(jsonb_agg(cells order by cell_id), '[]'::jsonb) from cells)
    );
$$;

revoke all on function public.claim_climate_refresh(text) from public, anon, authenticated;
revoke all on function public.climate_refresh_state(text) from public, anon, authenticated;
grant execute on function public.claim_climate_refresh(text) to service_role;
grant execute on function public.climate_refresh_state(text) to service_role;

commit;
