// Recent news for a measurement in a place. The Guardian Open Platform is the main source (needs
// GUARDIAN_API_KEY); GDELT is the keyless backup. Answers are cached per instance so repeat clicks
// at a busy venue don't spend the API limit.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Letters, spaces and a little punctuation only, so nothing can change the shape of the search query.
const safeTerm = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,59}$/u;
const cache = new Map<string, { at: number; articles: Article[] }>();
const cacheMs = 6 * 60 * 60 * 1000;

type Article = { title: string; url: string; source: string; date: string };

const json = (body: object, status = 200) => Response.json(body, { status, headers: cors });
const quoted = (term: string) => term.includes(" ") ? `"${term}"` : term;
const anyOf = (terms: string[]) => terms.length > 1 ? `(${terms.map(quoted).join(" OR ")})` : quoted(terms[0]);

function httpsUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function guardian(topics: string[], places: string[], key: string): Promise<Article[]> {
  const url = new URL("https://content.guardianapis.com/search");
  const from = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    q: `${anyOf(topics)} AND ${anyOf(places)}`, "order-by": "relevance", "page-size": "6",
    "from-date": from, "api-key": key,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Guardian HTTP ${response.status}`);
  const { response: body } = await response.json();
  return (body?.results ?? []).flatMap((item: Record<string, string>) => {
    const link = httpsUrl(item.webUrl);
    return link && item.webTitle ? [{ title: item.webTitle, url: link, source: "The Guardian", date: item.webPublicationDate?.slice(0, 10) ?? "" }] : [];
  });
}

async function gdelt(topics: string[], places: string[]): Promise<Article[]> {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.search = new URLSearchParams({
    query: `${anyOf(topics)} ${anyOf(places)} sourcelang:english`, mode: "artlist", maxrecords: "6",
    format: "json", sort: "hybridrel", timespan: "3months",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
  const body = await response.json().catch(() => ({}));
  return (body.articles ?? []).flatMap((item: Record<string, string>) => {
    const link = httpsUrl(item.url);
    const day = /^(\d{4})(\d{2})(\d{2})/.exec(item.seendate ?? "");
    return link && item.title ? [{ title: item.title, url: link, source: item.domain ?? "", date: day ? `${day[1]}-${day[2]}-${day[3]}` : "" }] : [];
  });
}

export async function climateNews(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (Number(request.headers.get("Content-Length")) > 2048) return json({ error: "Search is too large." }, 413);
  const body = await request.json().catch(() => null);
  const topics = body?.topics, places = body?.places;
  const valid = (list: unknown, max: number) => Array.isArray(list) && list.length >= 1 && list.length <= max &&
    list.every((term) => typeof term === "string" && safeTerm.test(term));
  if (!valid(topics, 4) || !valid(places, 3)) return json({ error: "Send 1–4 topics and 1–3 places." }, 400);

  const key = JSON.stringify([topics, places]).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheMs) return json({ articles: hit.articles });

  const guardianKey = Deno.env.get("GUARDIAN_API_KEY");
  let articles: Article[] = [];
  try {
    if (guardianKey) articles = await guardian(topics, places, guardianKey);
  } catch (error) {
    console.error("Guardian lookup failed", error instanceof Error ? error.message : "unknown error");
  }
  if (!articles.length) {
    try {
      articles = await gdelt(topics, places);
    } catch (error) {
      console.error("GDELT lookup failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "News search is temporarily unavailable." }, 502);
    }
  }
  articles = articles.slice(0, 5);
  cache.set(key, { at: Date.now(), articles });
  return json({ articles });
}

Deno.serve(climateNews);
