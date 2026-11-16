const regions = new Map([
  ["central-amazon", ["central amazon", "central amazonia"]],
  ["cerrado", ["cerrado"]],
  ["great-plains", ["central great plains", "great plains"]],
  ["mexican-plateau", ["mexican plateau", "central mexican plateau", "altiplano mexicano"]],
  ["patagonian-steppe", ["patagonian steppe", "patagonia", "patagonian"]],
  ["southern-ontario", ["southern ontario", "southwestern ontario", "southwest ontario"]],
]);
const variables = new Map([
  ["t2m", ["air temperature", "near-surface temperature", "warming", "heatwave"]],
  ["ts", ["land surface temperature", "surface temperature", "skin temperature"]],
  ["prectotcorr", ["precipitation", "rainfall", "drought"]],
  ["qv2m", ["specific humidity", "water vapour", "water vapor"]],
  ["rh2m", ["relative humidity"]],
  ["gwetroot", ["soil moisture", "soil wetness", "root zone", "root-zone"]],
  ["evland", ["evapotranspiration", "evaporation"]],
  ["ws10m", ["wind speed", "near-surface wind", "surface winds"]],
  ["snow", ["snow depth", "snow cover", "snowpack"]],
  ["ocean_skin_temp", ["sea surface skin temperature", "sea surface temperature", "marine heatwave"]],
  ["ozone_column", ["total column ozone", "total ozone", "ozone column", "ozone layer"]],
  ["tropopause_temp", ["tropopause temperature", "cold point tropopause", "tropopause warming"]],
  ["column_water_vapour", ["total column water vapour", "total column water vapor", "precipitable water"]],
  ["cloud_fraction", ["cloud fraction", "cloud cover", "cloud amount"]],
  ["outgoing_longwave", ["outgoing longwave radiation", "outgoing long-wave radiation", "outgoing thermal radiation"]],
]);
const agencyReports = [
  {
    title: "Canadian Drought Monitor · August 2016",
    url: "https://publications.gc.ca/collections/collection_2018/aac-aafc/A27-39-2016-8-eng.pdf",
    summary: "Agriculture and Agri-Food Canada reports that August rain improved soil moisture in parts of Ontario while longer-standing precipitation deficits persisted.",
    source_type: "Government report",
  },
  {
    title: "Canadian Drought Monitor · July 2016",
    url: "https://publications.gc.ca/collections/collection_2018/aac-aafc/A27-39-2016-7-eng.pdf",
    summary: "Agriculture and Agri-Food Canada describes how low precipitation affected more than 17,000 Ontario farms in July 2016.",
    source_type: "Government report",
  },
];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Work = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

function abstractOf(index: Work["abstract_inverted_index"]) {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index ?? {})) {
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 3_000) words[position] = word;
    }
  }
  return words.join(" ");
}

// Read explicit study years from the paper's title or abstract.
function coveredYears(title: string, abstract: string) {
  const text = `${title}; ${abstract}`.split(/©|\bcopyright\b/i)[0];
  const years: [number, number][] = [];
  const withoutRanges = text.replace(
    /\b((?:19|20)\d{2})(?:\s+[a-z]{3,9})?\s*(?:[–—/-]|to|through|and)\s*(?:[a-z]{3,9}\s+)?((?:19|20)\d{2}|\d{2})\b/gi,
    (_, first, last) => {
      const start = Number(first);
      const end = last.length === 2 ? Math.floor(start / 100) * 100 + Number(last) : Number(last);
      if (end >= start && end <= 2100) years.push([start, end]);
      return " ";
    },
  );
  for (const match of withoutRanges.matchAll(/\b(?:in|during|since|summer|winter|spring|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:the\s+)?((?:19|20)\d{2})\b/gi)) {
    const year = Number(match[1]);
    years.push([year, year]);
  }
  return years;
}

function containsTerm(text: string, term: string) {
  return new RegExp(`\\b${term}\\b`, "i").test(text);
}

function paperSource(work: Work, regionTerms: string[], topics: string[][], start: number, end: number) {
  const title = work.title?.trim();
  const url = [work.doi, work.id].find((link) =>
    typeof link === "string" && /^https:\/\/(?:doi\.org\/10\.\d{4,}\/\S+|openalex\.org\/W\d+)$/i.test(link)
  );
  if (!title || !url) return null;
  const abstract = abstractOf(work.abstract_inverted_index);
  const text = `${title} ${abstract}`;
  const score = topics.filter((aliases) => aliases.some((term) => containsTerm(text, term))).length;
  if (!score || !regionTerms.some((term) => containsTerm(text, term))) return null;
  const period = coveredYears(title, abstract).find(([first, last]) => first <= end && last >= start);
  if (!period) return null;
  const [first, last] = period;
  return {
    score,
    source: {
      title,
      url,
      summary: `The title or abstract refers to ${first === last ? first : `${first}–${last}`} and matches ${score} of the selected variables.`,
      source_type: "Journal article",
    },
  };
}

async function searchPapers(regionTerms: string[], topics: string[][], start: number, end: number) {
  const regionQuery = regionTerms.map((term) => `"${term}"`).join(" OR ");
  const variableQuery = topics.flat().map((term) => `"${term}"`).join(" OR ");
  const years = end - start <= 2
    ? ` AND (${Array.from({ length: end - start + 1 }, (_, index) => start + index).join(" OR ")})`
    : "";
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({
    "search.title_and_abstract": `(${regionQuery}) AND (${variableQuery})${years}`,
    "per-page": "20",
    filter: "type:article,is_retracted:false",
    select: "id,doi,title,abstract_inverted_index",
  }).toString();
  const apiKey = Deno.env.get("OPENALEX_API_KEY");
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429) return null;
  if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`);
  const { results } = await response.json() as { results: Work[] };
  const matches = results.flatMap((work) => {
    const match = paperSource(work, regionTerms, topics, start, end);
    return match ? [match] : [];
  }).sort((left, right) => right.score - left.score);
  return Array.from(new Map(matches.map(({ source }) => [source.url.toLowerCase(), source])).values());
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: cors });
}

export async function climateResearch(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (Number(request.headers.get("Content-Length")) > 4096) {
    return json({ error: "Research search parameters are too large." }, 413);
  }
  const body = await request.json().catch(() => null);
  const { region_id, variable_ids, start_year, end_year } = body ?? {};
  const regionTerms = regions.get(region_id);
  if (!regionTerms || !Array.isArray(variable_ids) || !variable_ids.length || variable_ids.length > variables.size ||
      new Set(variable_ids).size !== variable_ids.length || !variable_ids.every((id) => variables.has(id)) ||
      !Number.isInteger(start_year) || !Number.isInteger(end_year) ||
      start_year < 1948 || end_year > 2025 || start_year > end_year) {
    return json({ error: "Choose a study area, at least one measurement and a year range between 1948 and 2025." }, 400);
  }

  const reports = region_id === "southern-ontario" && start_year <= 2016 && end_year >= 2016 &&
    variable_ids.some((id) => id === "prectotcorr" || id === "gwetroot")
    ? agencyReports : [];
  try {
    const topics = variable_ids.map((id) => variables.get(id)!);
    const papers = await searchPapers(regionTerms, topics, start_year, end_year);
    if (!papers) {
      return reports.length
        ? json({ sources: reports, partial: true })
        : json({ error: "The research index reached its search limit. Try again later." }, 429);
    }
    return json({ sources: [...reports, ...papers].slice(0, 3) });
  } catch (error) {
    console.error("Climate research lookup failed", error instanceof Error ? error.message : "unknown error");
    if (reports.length) return json({ sources: reports, partial: true });
    return json({ error: "Research search is temporarily unavailable. Try again later." }, 502);
  }
}

Deno.serve(climateResearch);
