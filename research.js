(() => {
  "use strict";

  function sourceItem(source) {
    if (typeof source?.title !== "string" || !source.title.trim() || typeof source.url !== "string") return null;
    let url;
    try {
      url = new URL(source.url);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title;
    item.append(link);
    if (typeof source.summary === "string" && source.summary.trim()) {
      const summary = document.createElement("p");
      summary.className = "description";
      summary.textContent = source.summary;
      item.append(summary);
    }
    return item;
  }

  function renderResearchSources(list, sources) {
    const items = sources.slice(0, 3).map(sourceItem).filter(Boolean);
    list.replaceChildren(...items);
    list.hidden = !items.length;
    return items.length;
  }

  const partialNotice = "The research index is temporarily unavailable. Results may be incomplete.";
  window.ClimateResearch = { renderSources: renderResearchSources, partialNotice };

  const config = window.TREND_CONFIG;
  const form = document.getElementById("research-form");
  if (!config || !form) return;

  const regionResults = document.getElementById("region-results");
  const variableOptions = document.getElementById("variable-options");
  const scope = document.getElementById("research-scope");
  const from = document.getElementById("research-start");
  const to = document.getElementById("research-end");
  const submit = document.getElementById("research-submit");
  const status = document.getElementById("research-status");
  const results = document.getElementById("research-sources");
  const siteById = new Map(config.sites.map((site) => [site.id, site]));
  const variableById = new Map(config.variables.map((variable) => [variable.id, variable]));

  for (const input of [from, to]) {
    input.min = config.startYear;
    input.max = config.endYear;
  }
  from.value = config.startYear;
  to.value = config.endYear;

  let criteriaKey;
  let request;

  function currentSelection() {
    const region = siteById.get(regionResults.dataset.site);
    const variables = Array.from(variableOptions.querySelectorAll("button[data-variable][aria-pressed='true']"), (button) =>
      variableById.get(button.dataset.variable)
    ).filter(Boolean);
    return { region, variables };
  }

  function updateScope() {
    const { region, variables } = currentSelection();
    const key = [regionResults.dataset.site, ...variables.map(({ id }) => id), from.value, to.value].join("|");
    if (key === criteriaKey) return;
    criteriaKey = key;
    request?.abort();
    request = null;
    results.replaceChildren();
    results.hidden = true;
    status.textContent = "";
    form.hidden = !region;
    submit.disabled = !variables.length;
    scope.textContent = region
      ? [region.name, variables.map(({ name }) => name).join(", ")].filter(Boolean).join(" · ")
      : "Choose one of the six named study areas to find research.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { region, variables } = currentSelection();
    if (!region || !variables.length || request) return;
    const startYear = from.valueAsNumber;
    const endYear = to.valueAsNumber;
    if (startYear > endYear) {
      status.textContent = "The start year must come before or match the end year.";
      return;
    }
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      status.textContent = "Research search is unavailable.";
      return;
    }

    const controller = new AbortController();
    request = controller;
    submit.disabled = true;
    results.replaceChildren();
    results.hidden = true;
    status.textContent = "Looking for sources…";
    try {
      const response = await fetch(new URL("/functions/v1/climate-research-giovanni", config.supabaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          region_id: region.id,
          variable_ids: variables.map(({ id }) => id.toLowerCase()),
          start_year: startYear,
          end_year: endYear,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const answer = await response.json().catch(() => null);
      if (request !== controller) return;
      if (response.status === 404) {
        status.textContent = "Giovanni research search is awaiting deployment.";
        return;
      }
      if (response.status === 429) {
        status.textContent = "Research search reached its request limit. Try again later.";
        return;
      }
      if (!response.ok || !Array.isArray(answer?.sources)) {
        throw new Error(typeof answer?.error === "string" ? answer.error : "Research search failed. Try again.");
      }
      const count = renderResearchSources(results, answer.sources);
      if (answer.partial === true) {
        const fallback = count ? "Showing verified reports." : "No matching fallback reports found.";
        status.textContent = `${partialNotice} ${fallback}`;
      } else {
        status.textContent = count
          ? `${count} ${count === 1 ? "source" : "sources"} found.`
          : "No sources found for this region, selection and date range.";
      }
    } catch (error) {
      if (request !== controller) return;
      status.textContent = error instanceof TypeError || error.name === "TimeoutError"
        ? "Could not reach research search. Try again."
        : error.message;
    } finally {
      if (request === controller) {
        request = null;
        submit.disabled = false;
      }
    }
  });

  const observer = new MutationObserver(updateScope);
  observer.observe(regionResults, { attributes: true, attributeFilter: ["data-site"] });
  observer.observe(variableOptions, { attributes: true, attributeFilter: ["aria-pressed"], subtree: true });
  form.addEventListener("input", updateScope);
  updateScope();
})();
