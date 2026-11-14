const regions = [
  "central-amazon", "cerrado", "great-plains", "mexican-plateau", "patagonian-steppe", "southern-ontario",
];
const variables = ["t2m", "ts", "prectotcorr", "qv2m", "rh2m", "gwetroot", "evland", "ws10m", "snow"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const instructions = `You route climate questions to get_correlation (one coefficient from stored NASA Giovanni data) or find_research (sources about a named region, measurements and study period).
Regions: central-amazon (Central Amazon), cerrado (Cerrado), great-plains (Central Great Plains), mexican-plateau (Mexican Plateau), patagonian-steppe (Patagonian Steppe), southern-ontario (Southern Ontario).
Variables: t2m (air temperature), ts (surface temperature), prectotcorr (precipitation or rain), qv2m (specific humidity), rh2m (relative humidity), gwetroot (root-zone soil moisture or wetness), evland (land evapotranspiration), ws10m (wind speed), snow (snow depth).
Use an explicit region or exact point in the question ahead of the selected-place hints. Otherwise use selected_region when supplied; only for correlation, use selected_point when no region is supplied. Pass region_id or point_id, never both, and preserve exact coordinates. If no supported place is supplied or a variable is ambiguous (e.g. just humidity), ask for clarification before calling a tool.
For correlation use lag 0 for same-month or unspecified lag. For a positive lag, variable_x is measured first and variable_y is measured that many months later. A negative lag can be represented by swapping X and Y. Require a single pair and lag 0–6. The overlap depends on the observations and cannot be overridden; when a user requests a specific date window, do not imply your result used that window.
For papers, articles or sources use find_research and supply a named region. Pass the mentioned variable IDs and period of interest. If no dates were asked for, use 1948–2025. Ask for dates within this window when needed. Use one tool at most once. Only a tool supplies numerical values and source links. Never infer causation.`;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toolData(output: unknown) {
  const result = asObject(parseJson(output));
  if (!result || result.isError === true) return null;
  const content = Array.isArray(result.content) ? asObject(result.content[0]) : null;
  return result.structuredContent
    ? asObject(result.structuredContent)
    : content?.type === "text" ? asObject(parseJson(content.text)) : result;
}

function isPointId(value: unknown): value is string {
  if (typeof value !== "string" || !/^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,3}(?:\.\d{1,6})?$/.test(value)) return false;
  const [lat, lon] = value.split(",").map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function monthIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) ||
      value < 194801 || value > 202512 || value % 100 < 1 || value % 100 > 12) return NaN;
  return Math.floor(value / 100) * 12 + value % 100;
}

function validCorrelationLookup(row: JsonObject, argumentsJson: unknown) {
  const { region_id, point_id, variable_x, variable_y, lag_months } = row;
  if ((region_id !== undefined && (typeof region_id !== "string" || !regions.includes(region_id))) ||
      !isPointId(point_id) ||
      typeof variable_x !== "string" || !variables.includes(variable_x) ||
      typeof variable_y !== "string" || !variables.includes(variable_y) ||
      typeof lag_months !== "number" || !Number.isInteger(lag_months) || lag_months < 0 || lag_months > 6) return false;
  if (argumentsJson === undefined) return true;
  const args = asObject(parseJson(argumentsJson));
  return args !== null &&
    ["region_id", "variable_x", "variable_y", "lag_months"].every((key) => args[key] === row[key]) &&
    (region_id === undefined ? args.point_id === point_id : args.point_id === undefined);
}

function storedCorrelation(row: JsonObject) {
  const {
    region_id, point_id, lat, lon, variable_x, variable_y, lag_months, pearson_r, paired_months,
    first_month, last_month, first_month_x, last_month_x, first_month_y, last_month_y, source_x, source_y, method,
  } = row;
  const [startX, endX, startY, endY] = [first_month_x, last_month_x, first_month_y, last_month_y].map(monthIndex);
  if (typeof lat !== "number" || typeof lon !== "number" || !isPointId(point_id) ||
      `${lat},${lon}` !== point_id ||
      typeof source_x !== "string" || !source_x.trim() || typeof source_y !== "string" || !source_y.trim() ||
      (pearson_r !== null && (typeof pearson_r !== "number" || !Number.isFinite(pearson_r) || Math.abs(pearson_r) > 1)) ||
      !Number.isFinite(startX) || !Number.isFinite(endX) || startX > endX ||
      startY - startX !== lag_months || endY - endX !== lag_months ||
      first_month !== first_month_x || last_month !== last_month_y || paired_months !== endX - startX + 1 ||
      method !== "pearson_monthly_detrended_v1") {
    return null;
  }
  return {
    region_id, point_id, lat, lon, variable_x, variable_y, lag_months, pearson_r, paired_months,
    first_month, last_month, first_month_x, last_month_x, first_month_y, last_month_y, source_x, source_y, method,
  };
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: cors });
}

export async function climateAssistant(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (Number(request.headers.get("Content-Length")) > 8192) {
    return json({ error: "Enter a question of 500 characters or fewer." }, 413);
  }
  const body = asObject(await request.json().catch(() => null));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const region = body?.region_id;
  const point = body?.point_id;
  if (!question || question.length > 500 ||
      (region !== undefined && (typeof region !== "string" || !regions.includes(region))) ||
      (point !== undefined && !isPointId(point))) {
    return json({ error: "Enter a question of 500 characters or fewer about a supported study area." }, 400);
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) return json({ error: "The climate assistant is waiting for its Groq API key." }, 503);

  try {
    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const dbKey = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || serviceKey;
    let mcpToken = Deno.env.get("CLIMATE_MCP_TOKEN");
    if (!mcpToken && serviceKey) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`climate-mcp:v1:${serviceKey}`));
      mcpToken = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    if (!baseUrl || !anonKey || !dbKey || !mcpToken) throw new Error("Missing Supabase server settings");

    const dbHeaders = new Headers({ apikey: dbKey, "Content-Type": "application/json" });
    if (!dbKey.startsWith("sb_secret_")) dbHeaders.set("Authorization", `Bearer ${dbKey}`);
    const quota = await fetch(new URL("/rest/v1/rpc/claim_climate_assistant_request", baseUrl), {
      method: "POST",
      headers: dbHeaders,
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
    if (!quota.ok) throw new Error(`Assistant quota returned HTTP ${quota.status}`);
    if (await quota.json() !== true) {
      return json({ error: "The climate assistant reached its shared request limit. Try again later." }, 429);
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        instructions,
        input: JSON.stringify({ question, selected_region: region ?? null, selected_point: point ?? null }),
        max_output_tokens: 600,
        parallel_tool_calls: false,
        store: false,
        tools: [{
          type: "mcp",
          server_label: "climate",
          server_url: new URL("/functions/v1/climate-mcp-giovanni", baseUrl).href,
          headers: { Authorization: `Bearer ${anonKey}`, "x-climate-mcp-token": mcpToken },
          allowed_tools: ["get_correlation", "find_research"],
          require_approval: "never",
        }],
      }),
      signal: AbortSignal.timeout(19_000),
    });
    if (groqResponse.status === 429) {
      return json({ error: "Groq reached its request limit. Try again later." }, 429);
    }
    if (!groqResponse.ok) throw new Error(`Groq returned HTTP ${groqResponse.status}`);

    const response = await groqResponse.json();
    const calls: JsonObject[] = Array.isArray(response.output)
      ? response.output.filter((item: unknown) => asObject(item)?.type === "mcp_call") : [];
    if (response.error || response.status === "failed") throw new Error("Groq assistant request failed");
    if (!calls.length) {
      return json({ reply: "For a correlation, select a point or name a study area, then name two measurements and a delay from 0 to 6 months. For research, name a study area, measurements, and years." });
    }
    if (calls.length !== 1) {
      return json({ reply: "Ask one correlation or research question at a time." });
    }
    const call = calls[0];
    const result = call.error ? null : toolData(call.output);
    if (call.name === "find_research") {
      if (!Array.isArray(result?.sources)) throw new Error("The MCP search did not return sources");
      const sources = result.sources.slice(0, 3);
      return json({
        reply: sources.length
          ? "These sources cover the region, at least one requested measurement and part of the selected period."
          : result.partial ? "The research index is temporarily unavailable." : "No matching sources were found.",
        sources,
        partial: result.partial === true,
      });
    }
    if (call.name !== "get_correlation" || !result || !validCorrelationLookup(result, call.arguments)) {
      throw new Error("The MCP call did not return a valid Giovanni lookup");
    }
    if (result.status === "no_data") {
      return json({ reply: "Giovanni has no stored observations at that point with overlapping dates for those measurements and delay. Choose another point or pair." });
    }
    const correlation = storedCorrelation(result);
    if (!correlation) throw new Error("The MCP call did not return a valid Giovanni correlation");
    return json({
      reply: correlation.pearson_r === null
        ? "A correlation is unavailable when fewer than 24 months overlap or one measurement is constant after removing its seasonal cycle and trend."
        : "This compares monthly changes after removing the seasonal cycle and the long-term trend. Correlation measures how two series move together. It cannot establish that one causes the other.",
      correlation,
    });
  } catch (error) {
    console.error("Climate assistant failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The climate assistant could not complete the lookup. Try again later." }, 502);
  }
}

Deno.serve(climateAssistant);
