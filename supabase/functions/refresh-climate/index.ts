const regions = new Set([
  "southern-ontario",
  "great-plains",
  "mexican-plateau",
  "central-amazon",
  "cerrado",
  "patagonian-steppe",
]);

const units = {
  T2M: "C",
  TS: "C",
  PRECTOTCORR: "mm/day",
  QV2M: "g/kg",
  RH2M: "%",
  GWETROOT: "1",
  EVLAND: "mm/day",
  WS10M: "m/s",
};
const features = Object.entries(units);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
};

type Cell = { cell_id: string; lat: number; lon: number };
type RegionState = { latest_month: number | null; cells: Cell[] };
type PowerResponse = {
  header?: { sources?: string[]; fill_value?: number };
  geometry?: { coordinates?: number[] };
  parameters?: Record<string, { units: string }>;
  properties?: { parameter?: Record<string, Record<string, number>> };
};

function json(body: object, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...cors, ...extraHeaders } });
}

function databaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase Edge Function credentials");

  return async function db<T>(path: string, body: object, prefer?: string): Promise<T> {
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Supabase operation failed with HTTP ${response.status}`);
    return await response.json();
  };
}

function nextMonth(month: number) {
  return month % 100 === 12 ? month + 89 : month + 1;
}

function lastClosedMonth(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return month === 0 ? (year - 1) * 100 + 12 : year * 100 + month;
}

async function fetchMonths(cell: Cell, start: number, end: number, signal: AbortSignal) {
  const url = new URL("https://power.larc.nasa.gov/api/temporal/monthly/point");
  url.search = new URLSearchParams({
    parameters: features.map(([name]) => name).join(","),
    community: "AG",
    latitude: String(cell.lat),
    longitude: String(cell.lon),
    start: String(Math.floor(start / 100)),
    end: String(Math.floor(end / 100)),
    format: "JSON",
  }).toString();
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status}`);
  const payload: PowerResponse = await response.json();
  const coordinates = payload.geometry?.coordinates;
  const observations = payload.properties?.parameter;
  const fill = payload.header?.fill_value;
  if (!payload.header?.sources?.includes("MERRA2") || !Number.isFinite(fill) ||
      coordinates?.[0] !== cell.lon || coordinates?.[1] !== cell.lat ||
      !observations ||
      features.some(([name, unit]) => payload.parameters?.[name]?.units !== unit || !observations[name])) {
    throw new Error(`NASA POWER returned unexpected data for ${cell.cell_id}`);
  }

  const months = new Map<number, Record<string, number>>();
  for (let month = start; month <= end; month = nextMonth(month)) {
    const entries = features.map(([name]) => [name.toLowerCase(), observations[name][month]] as const);
    if (entries.every(([, value]) => Number.isFinite(value) && value !== fill)) {
      months.set(month, Object.fromEntries(entries));
    }
  }
  return months;
}

export async function refreshClimate(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405, { Allow: "POST, OPTIONS" });

  const body = await request.json().catch(() => null);
  const region = body?.region_id;
  if (typeof region !== "string" || !regions.has(region)) {
    return json({ error: "Choose a supported study area." }, 400);
  }

  try {
    const db = databaseClient();
    const args = { requested_region: region };
    const state = await db<RegionState>("rpc/climate_refresh_state", args);
    const cells = state.cells;
    const latest = state.latest_month;
    if (typeof latest !== "number" || !Number.isInteger(latest) || !Array.isArray(cells) ||
        cells.length !== 9 ||
        new Set(cells.map(({ cell_id }) => cell_id)).size !== 9 ||
        cells.some(({ cell_id, lat, lon }) =>
          !Number.isFinite(lat) || !Number.isFinite(lon) ||
          Math.abs(lat) > 90 || Math.abs(lon) > 180 ||
          !Number.isInteger(lat * 2) || !Number.isInteger(lon / 0.625) ||
          cell_id !== `${lat.toFixed(3)},${lon.toFixed(3)}`)) {
      return json({ error: "Import the region's historical CSV into Supabase first." }, 409);
    }
    if (!(await db<boolean>("rpc/claim_climate_refresh", args))) {
      return json({
        error: "A refresh was requested recently. Try again in a minute.",
        latest_month: latest,
        new_rows: 0,
      }, 429, { "Retry-After": "60" });
    }

    const end = lastClosedMonth();
    const start = nextMonth(latest);
    if (start > end) return json({ latest_month: latest, new_rows: 0 });

    const signal = AbortSignal.timeout(30_000);
    const series = [];
    for (let index = 0; index < cells.length; index += 3) {
      const batch = cells.slice(index, index + 3);
      series.push(...await Promise.all(batch.map((cell) => fetchMonths(cell, start, end, signal))));
    }

    const rows = [];
    for (let month = start; month <= end; month = nextMonth(month)) {
      // Stop at an incomplete month so the next refresh can fill it.
      if (series.some((cell) => !cell.has(month))) break;
      rows.push(...cells.map((cell, index) => ({
        region_id: region,
        ...cell,
        yyyymm: month,
        ...series[index].get(month),
      })));
    }

    let newRows = 0;
    for (let offset = 0; offset < rows.length; offset += 900) {
      const inserted = await db<Cell[]>(
        "climate_cell_monthly?on_conflict=cell_id,yyyymm&select=cell_id",
        rows.slice(offset, offset + 900),
        "resolution=ignore-duplicates,return=representation",
      );
      newRows += inserted.length;
    }
    return json({ latest_month: rows.at(-1)?.yyyymm ?? latest, new_rows: newRows });
  } catch (error) {
    console.error("Climate refresh failed", error);
    return json({ error: "Could not refresh climate data. Try again later." }, 502);
  }
}

Deno.serve(refreshClimate);
