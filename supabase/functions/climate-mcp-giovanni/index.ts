import { timingSafeEqual } from "node:crypto";

const protocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const regionPoints = new Map([
  ["central-amazon", "-3.125,-60.125"],
  ["cerrado", "-15.625,-47.625"],
  ["great-plains", "38.625,-100.125"],
  ["mexican-plateau", "23.125,-102.375"],
  ["patagonian-steppe", "-49.625,-70.625"],
  ["southern-ontario", "44.125,-80.625"],
]);
const regions = [...regionPoints.keys()];
const variables = ["t2m", "ts", "prectotcorr", "qv2m", "rh2m", "gwetroot", "evland", "ws10m", "snow"];
const pointPattern = "^-?\\d{1,3}(?:\\.\\d{1,6})?,-?\\d{1,3}(?:\\.\\d{1,6})?$";
const encoder = new TextEncoder();

const inputs = {
  region_id: { type: "string", enum: regions, description: "Named study area. Supply either this or point_id." },
  point_id: { type: "string", pattern: pointPattern, description: "Exact stored point as latitude,longitude. Supply either this or region_id." },
  variable_x: { type: "string", enum: variables, description: "Variable measured first." },
  variable_y: { type: "string", enum: variables, description: "Variable measured lag_months later." },
  lag_months: { type: "integer", minimum: 0, maximum: 6 },
};
const tool = {
  name: "get_correlation",
  description: "Calculate monthly Pearson correlation from stored NASA Giovanni observations at one exact point, after removing the seasonal cycle and linear trend. A positive lag compares variable X this month with variable Y that many months later. The result gives the two paired date ranges, sources and actual sample count. Coverage depends on the point and variables. Correlation does not establish causation.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object", properties: inputs, required: ["variable_x", "variable_y", "lag_months"], additionalProperties: false,
  },
};

const researchYear = { type: "integer", minimum: 1948, maximum: 2025 };
const researchInputs = {
  region_id: { type: "string", enum: regions },
  variable_ids: {
    type: "array",
    items: { type: "string", enum: variables },
    minItems: 1,
    maxItems: variables.length,
    uniqueItems: true,
  },
  start_year: { ...researchYear, description: "First year covered by the requested sources." },
  end_year: { ...researchYear, description: "Last year covered by the requested sources." },
};
const researchTool = {
  name: "find_research",
  description: "Find up to three linked journal articles and agency reports for one study area, selected variables and a year range. Years refer to the period the source covers. Use these for context and cite the returned URLs.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: researchInputs,
    required: Object.keys(researchInputs),
    additionalProperties: false,
  },
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

function toolResult(data: object) {
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
}

function isPointId(value: unknown): value is string {
  if (typeof value !== "string" || !new RegExp(pointPattern).test(value)) return false;
  const [lat, lon] = value.split(",").map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

async function getCorrelation(args: JsonObject | null) {
  const { region_id, point_id, variable_x, variable_y, lag_months } = args ?? {};
  const hasRegion = region_id !== undefined;
  const hasPoint = point_id !== undefined;
  const point = hasRegion && typeof region_id === "string"
    ? regionPoints.get(region_id) : isPointId(point_id) ? point_id : undefined;
  const namedRegion = hasRegion ? { region_id } : {};
  if (!args || Object.keys(args).length !== 4 ||
      hasRegion === hasPoint || !point ||
      typeof variable_x !== "string" || !variables.includes(variable_x) ||
      typeof variable_y !== "string" || !variables.includes(variable_y) ||
      typeof lag_months !== "number" || !Number.isInteger(lag_months) || lag_months < 0 || lag_months > 6) {
    return toolError("Choose one named study area or exact point, two variable IDs, and a whole-number lag from 0 to 6 months.");
  }

  try {
    const url = new URL("/rest/v1/rpc/get_giovanni_correlation", Deno.env.get("SUPABASE_URL"));
    const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) throw new Error("Missing Supabase server key");
    const headers = new Headers({ apikey: key, "Content-Type": "application/json" });
    if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
    const response = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({ point_id: point, variable_x, variable_y, lag_months }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Supabase lookup returned HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (value === null) {
      return toolResult({ status: "no_data", ...namedRegion, point_id: point, variable_x, variable_y, lag_months });
    }
    const row = asObject(value);
    if (!row || row.point_id !== point || row.variable_x !== variable_x ||
        row.variable_y !== variable_y || row.lag_months !== lag_months) {
      throw new Error("Unexpected Giovanni correlation result");
    }
    return toolResult({ ...row, ...namedRegion });
  } catch (error) {
    console.error("Correlation lookup failed", error);
    return toolError("The stored correlation could not be loaded.");
  }
}

async function findResearch(args: JsonObject | null) {
  const { region_id, variable_ids, start_year, end_year } = args ?? {};
  if (!args || Object.keys(args).length !== 4 ||
      typeof region_id !== "string" || !regions.includes(region_id) ||
      !Array.isArray(variable_ids) || !variable_ids.length || variable_ids.length > variables.length ||
      new Set(variable_ids).size !== variable_ids.length ||
      !variable_ids.every((id) => typeof id === "string" && variables.includes(id)) ||
      typeof start_year !== "number" || !Number.isInteger(start_year) || start_year < researchYear.minimum ||
      typeof end_year !== "number" || !Number.isInteger(end_year) || end_year > researchYear.maximum ||
      start_year > end_year) {
    return toolError("Choose a supported study area, at least one measurement and a year range between 1948 and 2025.");
  }

  try {
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    if (!key) throw new Error("Missing Supabase public key");
    const url = new URL("/functions/v1/climate-research-giovanni", Deno.env.get("SUPABASE_URL"));
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ region_id, variable_ids, start_year, end_year }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Research lookup returned HTTP ${response.status}`);
    const { sources, partial } = await response.json();
    if (!Array.isArray(sources) || sources.length > 3 ||
        !sources.every((source) => typeof source?.title === "string" && typeof source.url === "string" &&
          source.url.startsWith("https://") && typeof source.summary === "string" &&
          typeof source.source_type === "string") ||
        (partial !== undefined && typeof partial !== "boolean")) {
      throw new Error("Unexpected research lookup result");
    }
    return toolResult({ sources, partial });
  } catch (error) {
    console.error("Climate research lookup failed", error instanceof Error ? error.message : "unknown error");
    return toolError("Research search is temporarily unavailable. Try again later.");
  }
}

export async function climateMcp(request: Request) {
  let token = Deno.env.get("CLIMATE_MCP_TOKEN");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token && serviceKey) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`climate-mcp:v1:${serviceKey}`));
    token = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (!token) return new Response(null, { status: 503 });
  const provided = encoder.encode(request.headers.get("x-climate-mcp-token") ?? "");
  const expected = encoder.encode(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return new Response(null, { status: 401 });
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const version = request.headers.get("MCP-Protocol-Version");
  if (version && !protocolVersions.includes(version)) {
    return rpcError(null, -32600, "Unsupported MCP protocol version.", 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, -32700, "Invalid JSON.", 400);
  }
  const message = asObject(payload);
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(null, -32600, "Invalid request.", 400);
  }
  if (!Object.hasOwn(message, "id")) return new Response(null, { status: 202 });
  const { id } = message;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "Invalid request ID.", 400);
  const params = asObject(message.params);
  const result = (value: object) => Response.json({ jsonrpc: "2.0", id, result: value });

  switch (message.method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = typeof requested === "string" && protocolVersions.includes(requested)
        ? requested : protocolVersions[0];
      return result({
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "space-apps-climate-correlations", version: "1.0.0" },
      });
    }
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: [tool, researchTool] });
    case "tools/call":
      if (params?.name === tool.name) return result(await getCorrelation(asObject(params.arguments)));
      if (params?.name === researchTool.name) return result(await findResearch(asObject(params.arguments)));
      return rpcError(id, -32602, "Unknown tool.");
    default:
      return rpcError(id, -32601, "Method not found.");
  }
}

Deno.serve(climateMcp);
