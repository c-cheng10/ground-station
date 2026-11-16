const giovanni = "https://api.giovanni.earthdata.nasa.gov";
const cmr = "https://cmr.earthdata.nasa.gov/search/granules.json";
const firstYear = 1948;
const sources = {
  merra: { collection: "M2IMNXASM", version: "5.12.4" },
  imerg: { collection: "GPM_3IMERGM", version: "07" },
  gldas: { collection: "GLDAS_NOAH025_M", version: "2.1" },
};
const fields = [
  { field: "t2m", source: "merra", id: "M2IMNXASM_5_12_4_T2M", from: 202601,
    unit: /^(?:k|kelvin)$/i, min: 150, max: 370, convert: (value: number) => value - 273.15 },
  { field: "qv2m", source: "merra", id: "M2IMNXASM_5_12_4_QV2M", from: 202601,
    unit: /^kg(?:\/kg|kg-?1|kg\^-1|kg⁻¹|kg\*\*-1)$/i, min: 0, max: 0.1, convert: (value: number) => value * 1000 },
  { field: "prectotcorr", source: "imerg", id: "GPM_3IMERGM_07_precipitation", from: 202510,
    unit: /^mm(?:\/(?:hr|h|hour)|(?:hr|h|hour)-?1|h\^-1|h⁻¹|h\*\*-1)$/i, min: 0, max: 1000,
    convert: (value: number) => value * 24 },
  { field: "t2m_gldas21", source: "gldas", id: "GLDAS_NOAH025_M_2_1_Tair_f_inst", from: 202601,
    unit: /^(?:k|kelvin)$/i, min: 150, max: 370, convert: (value: number) => value - 273.15 },
] as const;
const pressure = {
  id: "GLDAS_NOAH025_M_2_0_Psurf_f_inst", unit: /^(?:pa|pascals?)$/i, min: 30_000, max: 120_000,
};
const select = ["id", "lat", "lon", ...fields.map(({ field }) => field), "rh2m"].join(",");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
  "Cache-Control": "no-store",
};

type Field = typeof fields[number]["field"] | "rh2m";
type Samples = Record<number, number>;
type Additions = Partial<Record<Field, Samples>>;
type Point = { id: string; lat: number; lon: number } & Partial<Record<Field, (number | null)[] | null>>;
type Variable = { id: string; unit: RegExp; min: number; max: number };

class GiovanniError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Giovanni returned HTTP ${status}`);
    this.status = status;
  }
}

function json(data: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...cors, ...headers } });
}

function indexOfMonth(month: number) {
  return (Math.floor(month / 100) - firstYear) * 12 + month % 100 - 1;
}

function monthAt(index: number) {
  return (firstYear + Math.floor(index / 12)) * 100 + index % 12 + 1;
}

function utcStart(index: number) {
  return new Date(Date.UTC(firstYear, index, 1));
}

function pointId(value: unknown): value is string {
  return typeof value === "string" && /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,3}(?:\.\d{1,6})?$/.test(value);
}

function database() {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !key) throw new Error("Missing database configuration");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return async (route: string, body?: object, query?: URLSearchParams) => {
    const url = new URL(`/rest/v1/${route}`, baseUrl);
    if (query) url.search = query.toString();
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status} for ${route}`);
    return await response.json();
  };
}

async function publishedMonth(source: typeof sources[keyof typeof sources], signal: AbortSignal) {
  // Giovanni's configured-variables endpoint lists IDs, so cap requests with NASA's granule catalogue.
  const url = new URL(cmr);
  url.search = new URLSearchParams({
    short_name: source.collection, version: source.version, provider: "GES_DISC", "sort_key[]": "-start_date", page_size: "1",
  }).toString();
  const response = await fetch(url, { headers: { "Client-Id": "space-apps-climate-trend-explorer" }, signal });
  if (!response.ok) throw new Error(`NASA catalogue returned HTTP ${response.status} for ${source.collection}`);
  const { feed } = await response.json();
  const stamp = feed?.entry?.[0]?.time_start;
  if (typeof stamp !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-01T/.test(stamp)) {
    throw new Error(`NASA catalogue did not give monthly coverage for ${source.collection}`);
  }
  return indexOfMonth(Number(stamp.slice(0, 4) + stamp.slice(5, 7)));
}

function parseSeries(csv: string, variable: Variable, from: number, to: number) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.findIndex((line) => /^"?Timestamp(?:\s*\(UTC\))?"?\s*,/i.test(line.trim()));
  if (header < 0) throw new Error(`Giovanni returned no CSV for ${variable.id}`);
  const metadata = lines.slice(0, header).join("\n");
  const undef = metadata.match(/^"?undef"?\s*,\s*"?([^"\s,]+)"?/im)?.[1];
  const fill = Number(undef);
  if (!Number.isFinite(fill)) throw new Error(`Giovanni response has no numeric fill value for ${variable.id}`);
  const unit = metadata.match(/^"?units?"?\s*,\s*"?([^"\r\n,]+)"?/im)?.[1];
  if (unit && !variable.unit.test(unit.replace(/\s/g, ""))) {
    throw new Error(`Giovanni reported unexpected units for ${variable.id}`);
  }
  const product = metadata.match(/^"?prod_name"?\s*,\s*"?([^"\r\n,]+)"?/im)?.[1]?.trim();
  const parameter = metadata.match(/^"?param_short_name"?\s*,\s*"?([^"\r\n,]+)"?/im)?.[1]?.trim();
  if (product && parameter && `${product}.${parameter}`.replace(/\./g, "_") !== variable.id) {
    throw new Error(`Giovanni returned a different product or parameter for ${variable.id}`);
  }
  const values: Samples = {};
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) continue;
    const [date, raw] = line.split(",").map((field) => field.trim().replace(/^"|"$/g, ""));
    const stamp = date.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:[T ]|$)/);
    if (!stamp || raw === undefined) throw new Error(`Unexpected monthly row for ${variable.id}`);
    const month = Number(stamp[1] + stamp[2]);
    const index = indexOfMonth(month);
    if (Number(stamp[3]) > new Date(utcStart(index + 1).getTime() - 1000).getUTCDate()) {
      throw new Error(`Invalid monthly date for ${variable.id}`);
    }
    if (index < from || index > to) continue;
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value === fill) continue;
    if (value < variable.min || value > variable.max || (month in values && values[month] !== value)) {
      throw new Error(`Unexpected monthly value for ${variable.id}`);
    }
    values[month] = value;
  }
  return values;
}

async function fetchSeries(token: string, point: Point, variable: Variable, from: number, to: number, signal: AbortSignal) {
  const end = new Date(utcStart(to + 1).getTime() - 1000).toISOString();
  const time = `${utcStart(from).toISOString().slice(0, 19)}/${end.slice(0, 19)}`;
  const url = new URL("/timeseries", giovanni);
  url.search = new URLSearchParams({ data: variable.id, location: `[${point.lat},${point.lon}]`, time }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new GiovanniError(response.status);
  return parseSeries(await response.text(), variable, from, to);
}

function firstGap(values: Point[Field], from: number, to: number) {
  for (let index = from; index <= to; index += 1) {
    if (!Number.isFinite(values?.[index])) return index;
  }
  return to + 1;
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

async function fillHumidity(point: Point, additions: Additions, token: string, end: number, signal: AbortSignal) {
  const pairs = [];
  for (let index = indexOfMonth(202601); index <= end; index += 1) {
    if (Number.isFinite(point.rh2m?.[index])) continue;
    const month = monthAt(index);
    const temperature = additions.t2m?.[month] ?? point.t2m?.[index];
    const humidity = additions.qv2m?.[month] ?? point.qv2m?.[index];
    if (typeof temperature === "number" && typeof humidity === "number") {
      pairs.push({ index, month, temperature, humidity });
    }
  }
  if (!pairs.length) return;
  // Match build_gldas_dataset.py's point-specific GLDAS 2.0 pressure climatology.
  const normal = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  const data = await fetchSeries(token, point, pressure, indexOfMonth(194801), indexOfMonth(201412), signal);
  for (const [month, value] of Object.entries(data)) {
    const season = normal[Number(month) % 100 - 1];
    season.total += value;
    season.count += 1;
  }
  if (pairs.some(({ index }) => !normal[index % 12].count)) {
    throw new Error("Missing pressure data for the relative humidity calculation");
  }
  const values: Samples = {};
  for (const { index, month, temperature, humidity } of pairs) {
    const { total, count } = normal[index % 12];
    const q = humidity / 1000;
    const e = q * (total / count) / (0.622 + 0.378 * q);
    const saturation = 611.2 * Math.exp(17.67 * temperature / (temperature + 243.5));
    values[month] = rounded(Math.min(100, Math.max(0, 100 * e / saturation)));
  }
  additions.rh2m = values;
}

export async function refreshGiovanni(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST to refresh a stored point." }, 405, { Allow: "POST, OPTIONS" });
  if (Number(request.headers.get("Content-Length")) > 512) return json({ error: "Request is too large." }, 413);
  const body = await request.json().catch(() => null);
  const requestedPoint: unknown = body?.point_id;
  if (!pointId(requestedPoint)) return json({ error: "Select a stored Giovanni point." }, 400);

  const token = Deno.env.get("EARTHDATA_TOKEN");
  if (!token) return json({ error: "Giovanni refresh needs an Earthdata Login token in the server’s EARTHDATA_TOKEN secret." }, 503);
  try {
    const db = database();
    const claim = await db("rpc/claim_giovanni_refresh", { requested_point: requestedPoint });
    if (claim.status === "not_found") return json({ error: "This point is not stored in Supabase." }, 404);
    if (claim.status === "limited") {
      return json({ error: "Refresh limit reached. Try again later." }, 429, { "Retry-After": String(claim.retry_after_seconds) });
    }
    if (claim.status !== "claimed") throw new Error("Unexpected refresh quota status");

    const [point] = await db("climate_points", undefined,
      new URLSearchParams({ id: `eq.${requestedPoint}`, select, limit: "1" })) as Point[];
    if (!point) return json({ error: "This point is not stored in Supabase." }, 404);
    if (point.id !== requestedPoint || `${point.lat},${point.lon}` !== point.id) {
      throw new Error("Stored point coordinates do not match the selected point");
    }

    const now = new Date();
    const closed = (now.getUTCFullYear() - firstYear) * 12 + now.getUTCMonth() - 1;
    const signal = AbortSignal.timeout(40_000);
    const coverage = new Map(Object.entries(sources).map(([id, source]) =>
      [id, publishedMonth(source, signal)]));
    const additions: Additions = {};
    const unavailable: string[] = [];
    let authRejected = false;
    const unavailableField = (field: string, reason: unknown) => {
      unavailable.push(field);
      if (reason instanceof GiovanniError && (reason.status === 401 || reason.status === 403)) authRejected = true;
      // The token and upstream response bodies never enter the logs.
      console.warn("Giovanni refresh source unavailable", field, reason instanceof Error ? reason.message : "");
    };
    const refreshed = await Promise.allSettled(fields.map(async (variable) => {
      const end = Math.min(closed, await coverage.get(variable.source)!);
      const start = firstGap(point[variable.field], indexOfMonth(variable.from), end);
      if (start > end) return;
      // Limit each upstream query to two years and leave later gaps eligible for the next refresh.
      const values = await fetchSeries(token, point, variable, start, Math.min(end, start + 23), signal);
      const pending = Object.entries(values)
        .filter(([month]) => !Number.isFinite(point[variable.field]?.[indexOfMonth(Number(month))]))
        .map(([month, value]) => [month, variable.convert(value)]);
      if (pending.length) additions[variable.field] = Object.fromEntries(pending);
    }));
    refreshed.forEach((result, index) => {
      if (result.status === "rejected") unavailableField(fields[index].field, result.reason);
    });
    try {
      await fillHumidity(point, additions, token, closed, signal);
    } catch (error) {
      unavailableField("rh2m", error);
    }

    if (!Object.keys(additions).length && authRejected) {
      return json({ error: "Giovanni rejected the Earthdata token. Check its expiry and approve the Giovanni application in Earthdata Login." }, 503);
    }
    if (!Object.keys(additions).length && refreshed.every(({ status }) => status === "rejected")) {
      return json({ error: "Giovanni data is temporarily unavailable. Try again later." }, 502);
    }
    for (const values of Object.values(additions)) {
      for (const month of Object.keys(values)) values[Number(month)] = rounded(values[Number(month)]);
    }
    const saved = await db("rpc/append_giovanni_months", { requested_point: requestedPoint, additions });
    if (saved.status === "not_found") return json({ error: "This point is not stored in Supabase." }, 404);
    if (saved.status !== "ok") throw new Error("Unexpected database result after refresh");
    return json({
      added_values: saved.filled_slots,
      added_months: saved.filled_months,
      latest_month: saved.latest_month,
      unavailable_variables: unavailable,
    });
  } catch (error) {
    console.error("Giovanni refresh failed", error instanceof Error ? error.message : "");
    return json({ error: "The Giovanni refresh could not save new measurements. Try again later." }, 502);
  }
}

Deno.serve(refreshGiovanni);
