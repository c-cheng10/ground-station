begin;

create table public.climate_assistant_usage (
    singleton boolean primary key default true check (singleton),
    utc_day date not null,
    minute_bucket timestamptz not null,
    day_requests integer not null,
    minute_requests integer not null
);

alter table public.climate_assistant_usage enable row level security;
revoke all on public.climate_assistant_usage from public, anon, authenticated;

create function public.claim_climate_assistant_request()
returns boolean
language sql
security definer
set search_path = ''
as $$
    with claimed as (
        insert into public.climate_assistant_usage as usage
            (utc_day, minute_bucket, day_requests, minute_requests)
        values (
            (statement_timestamp() at time zone 'UTC')::date,
            date_trunc('minute', statement_timestamp()), 1, 1
        )
        on conflict (singleton) do update
        set utc_day = excluded.utc_day,
            minute_bucket = excluded.minute_bucket,
            day_requests = case when usage.utc_day = excluded.utc_day
                                then usage.day_requests + 1 else 1 end,
            minute_requests = case when usage.minute_bucket = excluded.minute_bucket
                                   then usage.minute_requests + 1 else 1 end
        where (usage.utc_day <> excluded.utc_day or usage.day_requests < 120)
          and (usage.minute_bucket <> excluded.minute_bucket or usage.minute_requests < 8)
        returning 1
    )
    select exists (select from claimed);
$$;

revoke all on function public.claim_climate_assistant_request() from public, anon, authenticated;
grant execute on function public.claim_climate_assistant_request() to service_role;

commit;
