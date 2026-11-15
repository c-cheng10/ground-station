(() => {
  "use strict";

  const panel = document.getElementById("news-panel");
  const details = document.getElementById("news");
  const scope = document.getElementById("news-scope");
  const status = document.getElementById("news-status");
  const results = document.getElementById("news-list");
  const more = document.getElementById("news-more");
  const config = window.TREND_CONFIG;
  const topicsById = {
    T2M: ["heatwave", "temperature"], TS: ["heatwave", "temperature"],
    PRECTOTCORR: ["rainfall", "drought", "flooding"], QV2M: ["humidity", "heatwave"], RH2M: ["humidity", "heatwave"],
    GWETROOT: ["drought", "soil moisture", "crops"], EVLAND: ["drought", "evaporation", "water shortage"],
    WS10M: ["wind", "storms"], SNOW: ["snow", "snowfall", "snowpack"],
    OZONE_COLUMN: ["ozone layer", "ozone hole"], TROPOPAUSE_TEMP: ["stratosphere", "upper atmosphere"],
    COLUMN_WATER_VAPOUR: ["water vapour", "atmospheric river"], CLOUD_FRACTION: ["cloud cover", "clouds"],
    OUTGOING_LONGWAVE: ["heat", "climate"], OCEAN_SKIN_TEMP: ["marine heatwave", "sea temperature"],
  };
  const safeTerm = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,59}$/u;
  const cache = new Map();
  const sixHours = 6 * 60 * 60 * 1_000;
  const dateFormat = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  let criteria;
  let request;
  let displayedArticles = [];

  async function post(functionName, body, signal, timeout) {
    if (!config?.supabaseUrl || !config.supabaseAnonKey) return null;
    const response = await fetch(new URL(`/functions/v1/${functionName}`, config.supabaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    return response.ok ? response.json() : null;
  }

  async function fetchNews({ topics, places }, signal) {
    try {
      const body = await post("climate-news", { topics, places }, signal, 18_000);
      if (Array.isArray(body?.articles)) return body.articles;
    } catch {
      signal.throwIfAborted();
    }

    // The assistant can return news links while climate-news is awaiting deployment.
    try {
      const question = `Recent news about ${topics.join(" or ")} in ${places.join(" or ")}.`;
      const body = await post("climate-assistant-giovanni", { mode: "interpret", question, has_selection: false }, signal, 20_000);
      if (Array.isArray(body?.sources) && body.sources.length) return body.sources;
    } catch {
      signal.throwIfAborted();
    }

    const anyOf = (terms) => {
      const quoted = terms.map((term) => `"${term}"`).join(" OR ");
      return terms.length > 1 ? `(${quoted})` : quoted;
    };
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.search = new URLSearchParams({
      query: `${anyOf(topics)} ${anyOf(places)} sourcelang:english`,
      mode: "artlist", maxrecords: "6", format: "json", sort: "hybridrel", timespan: "3months",
    });
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
    if (!response.ok) throw new Error("The news index is unavailable.");
    const body = await response.json();
    return (Array.isArray(body?.articles) ? body.articles : []).map((item) => ({
      title: item.title, url: item.url, source: item.domain,
      date: /^(\d{4})(\d{2})(\d{2})/.exec(item.seendate ?? "")?.slice(1).join("-"),
    }));
  }

  function display(articles) {
    displayedArticles = [];
    const items = [];
    const seen = new Set();
    for (const article of articles) {
      if (typeof article?.title !== "string" || !article.title.trim() || typeof article.url !== "string") continue;
      let url;
      try { url = new URL(article.url); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password) continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = article.title.trim();
      const note = document.createElement("p");
      note.className = "description";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(article.date ?? "") ? Date.parse(`${article.date}T00:00:00Z`) : NaN;
      const source = article.source || url.hostname.replace(/^www\./, "");
      note.textContent = [source, Number.isFinite(date) ? dateFormat.format(date) : ""]
        .filter(Boolean).join(" · ");
      displayedArticles.push({ title: link.textContent, source, date: Number.isFinite(date) ? article.date : "", url: url.href });
      item.append(link, note);
      items.push(item);
      if (items.length === 5) break;
    }
    results.replaceChildren(...items);
    results.hidden = !items.length;
    status.textContent = items.length ? "" : "No matching articles found.";
  }

  async function load() {
    request?.abort();
    request = null;
    results.hidden = true;
    results.replaceChildren();
    status.textContent = "";
    if (!details.open) return;
    if (!criteria) {
      status.textContent = "Select a named place to find local articles.";
      return;
    }
    const { key } = criteria;
    const cached = cache.get(key);
    if (cached?.expires > Date.now()) {
      display(cached.articles);
      return;
    }
    const controller = new AbortController();
    request = controller;
    status.textContent = "Finding articles…";
    try {
      const articles = await fetchNews(criteria, controller.signal);
      if (request !== controller) return;
      cache.delete(key);
      cache.set(key, { expires: Date.now() + sixHours, articles });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      display(articles);
    } catch {
      if (request === controller) status.textContent = "The news index is unavailable.";
    } finally {
      if (request === controller) request = null;
    }
  }

  details.addEventListener("toggle", load);
  window.ClimateNews = {
    articles: () => displayedArticles.slice(),
    update(variable, places = [], title) {
      panel.hidden = !variable;
      if (!variable) {
        criteria = null;
        displayedArticles = [];
        details.open = false;
        load();
        return;
      }
      const topics = topicsById[variable.id] ?? [variable.name.toLowerCase()].filter((term) => safeTerm.test(term));
      places = [...new Set(places.filter((term) => safeTerm.test(term)))].slice(0, 3);
      scope.textContent = `${title} · ${variable.name}`;
      more.hidden = !topics.length || !places.length;
      if (more.hidden) {
        criteria = null;
        displayedArticles = [];
        load();
        return;
      }
      more.href = `https://news.google.com/search?q=${encodeURIComponent(`${topics[0]} ${places[0]}`)}`;
      const key = JSON.stringify([topics, places]).toLowerCase();
      if (criteria?.key === key) return;
      criteria = { topics, places, key };
      displayedArticles = [];
      load();
    },
  };
})();
