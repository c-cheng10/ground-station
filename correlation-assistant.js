(() => {
  "use strict";

  const config = window.TREND_CONFIG;
  const form = document.getElementById("assistant-form");
  if (!config || !form) return;

  const dialog = document.getElementById("assistant-dialog");
  const viewArea = document.getElementById("assistant-view-area");
  const fieldset = form.querySelector("fieldset");
  const input = document.getElementById("assistant-question");
  const reply = document.getElementById("assistant-reply");
  const result = document.getElementById("assistant-result");
  const resultTitle = document.getElementById("assistant-result-title");
  const resultValue = document.getElementById("assistant-result-value");
  const resultWindow = document.getElementById("assistant-result-window");
  const researchNotice = document.getElementById("assistant-research-notice");
  const researchSources = document.getElementById("assistant-research-sources");
  const regionNames = new Map(config.sites.map(({ id, name }) => [id, name]));
  const variables = new Map(config.variables.map((variable) => [variable.id, variable]));
  const monthFormat = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
  const quantity = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3, signDisplay: "exceptZero" });
  const clarification = {
    place: "Name a city, country or saved study area, or select an area on the globe.",
    measurement: "Which measurement do you want to explore? You can choose one from the heatmap menu.",
    period: "Trends and correlations use the available historical record. For a specific year range, try a research search.",
    lag: "Choose a delay from 0 to 6 months between the two measurements.",
    scope: "Ask one question about a historical trend, a correlation between two measurements, or research sources.",
  };

  function validMonth(yyyymm) {
    const now = new Date();
    const currentMonth = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
    return Number.isInteger(yyyymm) && yyyymm >= config.startYear * 100 + 1 && yyyymm < currentMonth &&
      yyyymm % 100 >= 1 && yyyymm % 100 <= 12;
  }

  function formatMonth(yyyymm) {
    return monthFormat.format(new Date(Date.UTC(Math.floor(yyyymm / 100), yyyymm % 100 - 1, 1)));
  }

  function showCorrelation(row) {
    const { region_id, lat, lon, variable_x, variable_y, paired_months, lag_months, pearson_r,
      first_month_x, last_month_x, first_month_y, last_month_y, source_x, source_y } = row;
    const region = regionNames.get(region_id) ?? `${lat}°, ${lon}°`;
    const earlier = variables.get(variable_x?.toUpperCase?.())?.name;
    const later = variables.get(variable_y?.toUpperCase?.())?.name;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !earlier || !later ||
        !Number.isInteger(paired_months) || paired_months < 1 ||
        !Number.isInteger(lag_months) || lag_months < 0 || lag_months > 6 ||
        ![first_month_x, last_month_x, first_month_y, last_month_y].every(validMonth) ||
        first_month_x > last_month_x || first_month_y > last_month_y ||
        typeof source_x !== "string" || !source_x || typeof source_y !== "string" || !source_y ||
        (pearson_r !== null && (!Number.isFinite(pearson_r) || Math.abs(pearson_r) > 1))) {
      throw new Error("The assistant returned an invalid correlation.");
    }

    const lag = lag_months === 0 ? "Same month" : `${lag_months} month${lag_months === 1 ? "" : "s"} later`;
    resultTitle.textContent = `${region} · ${earlier} ${lag_months ? "→" : "and"} ${later}`;
    resultValue.textContent = pearson_r === null
      ? `Pearson r unavailable · ${lag}`
      : `Pearson r = ${pearson_r.toFixed(4)} · ${lag}`;
    const xWindow = `${formatMonth(first_month_x)}–${formatMonth(last_month_x)}`;
    const yWindow = `${formatMonth(first_month_y)}–${formatMonth(last_month_y)}`;
    resultWindow.textContent = `1 NASA grid point · ${paired_months} paired months · ${earlier} (${source_x}): ${xWindow} · ${later} (${source_y}): ${yWindow}`;
    result.hidden = false;
  }

  function showAreaAnswer(answer, question) {
    if (answer.status === "outside_coverage") {
      reply.textContent = answer.region
        ? `No stored NASA grid points in ${answer.region} cover the requested measurements. Try a different measurement or a broader area.`
        : "No stored NASA grid point is close enough to that place. Try another place or use Magic select on the globe.";
      return;
    }
    if (answer.status === "unavailable") {
      reply.textContent = "The selected area could not be loaded. Try again or choose a different place.";
      return;
    }
    viewArea.hidden = false;
    if (answer.status === "no_data") {
      reply.textContent = `The grid points in ${answer.name} don’t share enough complete months for this question. Try another measurement or draw a smaller area.`;
      return;
    }
    const { count, distance, name, outsideBorder } = answer;
    const [first, second] = question.ids.map((id) => variables.get(id));
    const coverage = distance ? `, within ${distance} km of the city` : outsideBorder ? ", within about 500 km of the border" : "";
    const scope = `${count} NASA grid ${count === 1 ? "point" : "points"}${coverage}`;
    if (answer.status === "trend") {
      const { slope, ciLow, ciHigh, verdict } = answer.trend;
      const unit = first.trendUnit === "pp" ? "percentage points" : first.trendUnit || first.unit;
      const rate = (value) => `${quantity.format(value)} ${unit}`;
      reply.textContent = `The trend uses annual averages from ${scope}. ${verdict === "inconclusive"
        ? "The trend tests found no clear change." : `The measurement is ${verdict}.`}`;
      resultTitle.textContent = `${name} · ${first.name}`;
      resultValue.textContent = `${rate(slope)} per decade, with a 95% range of ${rate(ciLow)} to ${rate(ciHigh)}`;
      resultWindow.textContent = `${answer.firstYear}–${answer.lastYear} · ${first.source}`;
    } else {
      const { lag } = question;
      const month = (index) => formatMonth((config.startYear + Math.floor(index / 12)) * 100 + index % 12 + 1);
      const dates = (offset) => `${month(answer.from + offset)}–${month(answer.to - 1 + offset)}`;
      reply.textContent = answer.r === null
        ? "One measurement is constant after removing the seasonal cycle and trend, so a correlation is unavailable."
        : `This compares monthly averages across ${scope} after removing seasonal cycles and long-term trends.`;
      resultTitle.textContent = `${name} · ${first.name} ${lag ? "→" : "and"} ${second.name}`;
      resultValue.textContent = `${answer.r === null ? "Pearson r unavailable" : `Pearson r = ${answer.r.toFixed(4)}`} · ${lag ? `${lag} month${lag === 1 ? "" : "s"} later` : "Same month"}`;
      resultWindow.textContent = `${answer.to - answer.from} paired months · ${first.name} (${first.source}): ${dates(0)} · ${second.name} (${second.source}): ${dates(lag)}`;
    }
    result.hidden = false;
  }

  viewArea.addEventListener("click", () => {
    dialog.close();
    document.getElementById("drawer-title").focus({ preventScroll: true });
  });

  async function askAssistant(body, signal = AbortSignal.timeout(45_000)) {
    const response = await fetch(new URL("/functions/v1/climate-assistant-giovanni", config.supabaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify(body),
      signal,
    });
    const answer = await response.json();
    if (response.status === 404) throw new Error("The Giovanni assistant is awaiting deployment.");
    if (!response.ok) throw new Error(answer?.error || "The assistant could not answer. Try again.");
    return answer;
  }

  window.CorrelationAssistant = { ask: askAssistant };

  function validateIntent(intent) {
    const { kind, place, variable_ids, lag_months, start_year, end_year, reason } = intent ?? {};
    const count = kind === "trend" ? 1 : kind === "correlation" ? 2 : null;
    if (kind === "clarify" && typeof reason === "string" && Object.hasOwn(clarification, reason)) return { kind, reason };
    if ((count === null && kind !== "research") || reason !== null ||
        (place !== null && (typeof place !== "string" || !place.trim() || place.length > 100)) ||
        !Array.isArray(variable_ids) || !variable_ids.length || (count !== null && variable_ids.length !== count) ||
        new Set(variable_ids).size !== variable_ids.length ||
        !variable_ids.every((id) => typeof id === "string" && id === id.toLowerCase() && variables.has(id.toUpperCase())) ||
        !Number.isInteger(lag_months) || lag_months < 0 || lag_months > 6 || (kind !== "correlation" && lag_months !== 0) ||
        (kind === "research" && (start_year !== null || end_year !== null) ?
          !Number.isInteger(start_year) || !Number.isInteger(end_year) || start_year < config.startYear ||
          end_year > config.endYear || start_year > end_year : start_year !== null || end_year !== null)) {
      throw new Error("The assistant could not identify a supported climate question. Try naming one place and measurement.");
    }
    return { kind, place: place?.trim() ?? null, ids: variable_ids.map((id) => id.toUpperCase()), lag: lag_months,
      variable_ids, start_year, end_year };
  }

  async function showLookup(answer, pointId) {
    if (typeof answer?.reply !== "string") throw new Error("The assistant returned an invalid reply.");
    if (answer.correlation) {
      showCorrelation(answer.correlation);
      if (!pointId || answer.correlation.point_id !== pointId) {
        viewArea.hidden = !await window.selectAssistantPoint(answer.correlation);
      }
    }
    const research = window.ClimateResearch;
    if (research && Array.isArray(answer.sources)) research.renderSources(researchSources, answer.sources);
    if (research && answer.partial === true) {
      researchNotice.hidden = false;
      researchNotice.textContent = research.partialNotice;
    }
    reply.textContent = answer.reply;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || fieldset.disabled) return;
    result.hidden = true;
    viewArea.hidden = true;
    researchNotice.hidden = true;
    researchSources.replaceChildren();
    researchSources.hidden = true;
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      reply.textContent = "The climate assistant is unavailable.";
      return;
    }

    const selection = document.getElementById("region-results")?.dataset;
    const selected = selection?.site;
    const selectedRegion = regionNames.has(selected) ? selected : undefined;
    const selectedPoint = selection?.point || undefined;
    fieldset.disabled = true;
    reply.textContent = "Looking up your question…";
    try {
      const interpreted = await askAssistant({ mode: "interpret", question, has_selection: Boolean(selected),
        region_id: selectedRegion, point_id: selectedPoint });
      if (!interpreted?.intent) {
        await showLookup(interpreted, selectedPoint);
        return;
      }
      const area = validateIntent(interpreted.intent);
      if (area.kind === "clarify") {
        reply.textContent = clarification[area.reason];
        return;
      }
      const placeName = area.place;
      const match = window.AssistantPlace.findStudyArea(placeName, config.sites);
      if (match.ambiguous || match.wrongCountry) {
        reply.textContent = match.wrongCountry
          ? `The saved ${match.wrongCountry.name} study area is in ${match.wrongCountry.region}. Check the place name or use Magic select.`
          : `More than one study area matches “${placeName}”. Enter its full name.`;
        return;
      }
      const namedSite = match.entry;
      const region_id = namedSite?.id ?? (!placeName ? selectedRegion : undefined);
      if (area.kind === "research") {
        if (!region_id) reply.textContent = "Research search covers the six saved study areas. Choose one to find sources.";
        else await showLookup(await askAssistant({ mode: "lookup", tool: "find_research", region_id,
          variable_ids: area.variable_ids, start_year: area.start_year ?? config.startYear,
          end_year: area.end_year ?? config.endYear }), selectedPoint);
        return;
      }
      if (!placeName && !selected) {
        reply.textContent = clarification.place;
        return;
      }

      const coordinate = placeName?.match(/^([+-]?\d{1,3}(?:\.\d{1,6})?)\s*,\s*([+-]?\d{1,3}(?:\.\d{1,6})?)$/);
      const [latitude, longitude] = coordinate ? coordinate.slice(1).map(Number) : [];
      if (coordinate && (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) {
        reply.textContent = "Enter latitude from −90° to 90° and longitude from −180° to 180°.";
        return;
      }
      const point_id = region_id ? undefined : coordinate ? `${latitude},${longitude}` : !placeName ? selectedPoint : undefined;
      if (area.kind === "correlation" && (region_id || point_id)) {
        await showLookup(await askAssistant({ mode: "lookup", tool: "get_correlation", region_id, point_id,
          variable_ids: area.variable_ids, lag_months: area.lag }), selectedPoint);
        return;
      }

      reply.textContent = placeName ? `Finding ${placeName} on the map…` : "Loading the selected area…";
      const place = namedSite ?? (coordinate ? { kind: "point", latitude, longitude } : placeName
        ? await window.AssistantPlace.resolve(placeName, { signal: AbortSignal.timeout(8_000) }) : null);
      if (place?.kind === "unresolved") {
        reply.textContent = place.message;
        return;
      }
      const answer = await window.answerClimateArea(area, place);
      if (answer) showAreaAnswer(answer, area);
      else reply.textContent = clarification.place;
    } catch (error) {
      reply.textContent = error instanceof TypeError || error.name === "TimeoutError"
        ? "Could not reach the climate assistant. Try again."
        : error.message;
    } finally {
      fieldset.disabled = false;
    }
  });

  for (const button of form.querySelectorAll("button[data-question]")) {
    button.addEventListener("click", () => {
      input.value = button.dataset.question;
      form.requestSubmit();
    });
  }
})();
