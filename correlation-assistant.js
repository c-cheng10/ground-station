(() => {
  "use strict";

  const config = window.TREND_CONFIG;
  const form = document.getElementById("assistant-form");
  if (!config || !form) return;

  const history = document.getElementById("assistant-history");
  const template = document.getElementById("assistant-message-template");
  const send = form.querySelector('button[type="submit"]');
  const input = document.getElementById("assistant-question");
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

  function showCorrelation(row, { result, resultTitle, resultValue, resultWindow }) {
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

  function showAreaAnswer(answer, question, { reply, result, resultTitle, resultValue, resultWindow }) {
    if (answer.status === "outside_coverage") {
      reply.textContent = answer.region
        ? `No stored NASA grid points in ${answer.region} cover the requested measurements. Try a different measurement or a broader area.`
        : "No stored NASA grid point is close enough to that place. Try another place or use Box select on the globe.";
      return;
    }
    if (answer.status === "unavailable") {
      reply.textContent = "The selected area could not be loaded. Try again or choose a different place.";
      return;
    }
    if (answer.status === "no_data") {
      reply.textContent = `The grid points in ${answer.name} don’t share enough complete months for this question. Try another measurement or draw a smaller area.`;
      return;
    }
    const { count, counts, distance, name, outsideBorder } = answer;
    const [first, second] = question.ids.map((id) => variables.get(id));
    const coverage = distance ? `, within ${distance} km of the city` : outsideBorder ? ", within about 500 km of the border" : "";
    const points = (count) => `${count} NASA grid ${count === 1 ? "point" : "points"}`;
    if (answer.status === "trend") {
      const { slope, ciLow, ciHigh, verdict } = answer.trend;
      const unit = first.trendUnit === "pp" ? "percentage points" : first.trendUnit || first.unit;
      const rate = (value) => `${quantity.format(value)} ${unit}`;
      reply.textContent = `The trend uses annual averages from ${points(count)}${coverage}. ${verdict === "inconclusive"
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
        : `This compares monthly averages after removing seasonal cycles and long-term trends. ${first.name} uses ${points(counts[0])} and ${second.name.toLowerCase()} uses ${points(counts[1])}${coverage}.`;
      resultTitle.textContent = `${name} · ${first.name} ${lag ? "→" : "and"} ${second.name}`;
      resultValue.textContent = `${answer.r === null ? "Pearson r unavailable" : `Pearson r = ${answer.r.toFixed(4)}`} · ${lag ? `${lag} month${lag === 1 ? "" : "s"} later` : "Same month"}`;
      resultWindow.textContent = `${answer.to - answer.from} paired months · ${first.name} (${first.source}): ${dates(0)} · ${second.name} (${second.source}): ${dates(lag)}`;
    }
    result.hidden = false;
  }

  async function askAssistant(body) {
    const response = await fetch(new URL("/functions/v1/climate-assistant-giovanni", config.supabaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const answer = await response.json();
    if (response.status === 404) throw new Error("The Giovanni assistant is awaiting deployment.");
    if (!response.ok) throw new Error(answer?.error || "The assistant could not answer. Try again.");
    return answer;
  }

  function validateIntent(intent) {
    const { kind, place, variable_ids, lag_months, start_year, end_year, reason } = intent ?? {};
    const hasPlace = typeof place === "string" && place.trim() && place.length <= 100;
    const count = kind === "trend" ? 1 : kind === "correlation" ? 2 : null;
    if (kind === "clarify" && typeof reason === "string" && Object.hasOwn(clarification, reason)) {
      return { kind, reason, place: hasPlace ? place.trim() : null };
    }
    if (kind === "select" && hasPlace && Array.isArray(variable_ids) && variable_ids.length === 0 && lag_months === 0 &&
        start_year === null && end_year === null && reason === null) return { kind, place: place.trim() };
    if ((count === null && kind !== "research") || reason !== null ||
        (place !== null && !hasPlace) ||
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

  async function showLookup(answer, turn) {
    const { reply, researchNotice, researchSources } = turn;
    if (typeof answer?.reply !== "string") throw new Error("The assistant returned an invalid reply.");
    if (answer.correlation) {
      showCorrelation(answer.correlation, turn);
      await window.selectAssistantPoint(answer.correlation);
    }
    const research = window.ClimateResearch;
    if (research && Array.isArray(answer.sources)) research.renderSources(researchSources, answer.sources);
    if (research && answer.partial === true) {
      researchNotice.hidden = false;
      researchNotice.textContent = research.partialNotice;
    }
    reply.textContent = reply.textContent ? `${reply.textContent}\n\n${answer.reply}` : answer.reply;
  }

  function coordinatePair(name) {
    const coordinate = typeof name === "string"
      ? name.match(/^([+-]?\d{1,3}(?:\.\d{1,6})?)\s*,\s*([+-]?\d{1,3}(?:\.\d{1,6})?)$/) : null;
    return coordinate?.slice(1).map(Number);
  }

  async function resolvePlace(name, localOnly = false) {
    const { entry, ambiguous, wrongCountry } = window.AssistantPlace.findStudyArea(name, config.sites);
    const unresolved = (message) => ({ kind: "unresolved", message });
    if (wrongCountry) return unresolved(`The saved ${wrongCountry.name} study area is in ${wrongCountry.region}. Check the place name or use Box select.`);
    if (ambiguous) return unresolved(`More than one study area matches “${name}”. Enter its full name.`);
    if (entry) return entry;
    const coordinate = coordinatePair(name);
    if (coordinate) {
      const [latitude, longitude] = coordinate;
      return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { kind: "point", latitude, longitude }
        : unresolved("Enter latitude from −90° to 90° and longitude from −180° to 180°.");
    }
    return window.AssistantPlace.resolve(name, { localOnly, signal: AbortSignal.timeout(8_000) });
  }

  function selectPlace(place, reply) {
    const target = window.selectClimateArea(place);
    reply.textContent = target ? `Selected ${target.name} on the globe.`
      : "No stored NASA grid points are close enough to that place. Try another location.";
    return target;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || send.disabled) return;
    const message = document.createElement("p");
    message.className = "assistant-message";
    message.textContent = question;
    const response = template.content.firstElementChild.cloneNode(true);
    const turn = {
      reply: response.querySelector(".assistant-reply"),
      result: response.querySelector(".assistant-result"),
      resultTitle: response.querySelector(".assistant-result-title"),
      resultValue: response.querySelector(".assistant-result-value"),
      resultWindow: response.querySelector(".assistant-result-window"),
      researchNotice: response.querySelector(".assistant-research-notice"),
      researchSources: response.querySelector(".assistant-research-sources"),
    };
    const { reply } = turn;
    input.value = "";
    input.focus({ preventScroll: true });
    send.disabled = true;
    reply.textContent = "Looking up your question…";
    history.append(message, response);
    history.scrollTop = history.scrollHeight;
    const { site: selected, point: selectedPoint, centre } = window.getClimateSelection();
    const selectedRegion = regionNames.has(selected) ? selected : undefined;

    try {
      const candidate = question.replace(/^(?:please )?(?:(?:can|could) you )?(?:show (?:me )?|take me to |go to |zoom (?:in )?on |select |tell me about |what about )/i, "")
        .replace(/[.!?]+$/, "").trim();
      const localPlace = await resolvePlace(candidate, true);
      if (localPlace && localPlace.kind !== "unresolved") return selectPlace(localPlace, reply);

      // Direct names still work when the deployed interpreter is older or rate-limited.
      const bareName = candidate.split(/\s+/).length <= 6 &&
        /^[\p{L}\p{M}][\p{L}\p{M} .,’'\p{Pd}]*$/u.test(candidate) &&
        !/^(?:how|what|where|why|does|did|is|has|find|news|research|compare)\b|\b(?:and|trend|correlation)\b|[’']s /i.test(candidate);
      const fallbackPlace = async () => bareName ? localPlace ?? await resolvePlace(candidate).catch(() => null) : null;
      let interpreted;
      try {
        if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("The climate assistant is unavailable.");
        const interpret = (prompt) => askAssistant({ mode: "interpret", question: prompt,
          has_selection: Boolean(selected), region_id: selectedRegion, point_id: selectedPoint });
        interpreted = await interpret(question);
        if (centre && interpreted?.intent?.kind === "clarify" && interpreted.intent.reason === "place") {
          // Older interpreters sometimes overlook has_selection. Preserve the original map area on retry.
          const contextual = question.replace(/\b(?:(?:at|in|around) )?(?:here|this (?:area|place|point|region|location))\b/i, `at ${centre}`);
          if (contextual !== question && contextual.length <= 500) {
            const retry = (await interpret(contextual))?.intent;
            if (["trend", "correlation"].includes(retry?.kind) &&
                (retry.place === null || coordinatePair(retry.place)?.join(",") === centre)) {
              interpreted = { intent: { ...retry, place: null } };
            }
          }
        }
      } catch (error) {
        const place = await fallbackPlace();
        if (!place || place.kind === "unresolved") throw error;
        return selectPlace(place, reply);
      }

      if (!interpreted?.intent) {
        const name = typeof interpreted?.place === "string" ? interpreted.place : null;
        const hasEvidence = interpreted?.sources || interpreted?.correlation;
        const place = name ? await resolvePlace(name).catch(() => null) : hasEvidence ? null : await fallbackPlace();
        reply.textContent = "";
        if (place && place.kind !== "unresolved") selectPlace(place, reply);
        if (name && place?.kind === "unresolved") reply.textContent = place.message;
        if (name || hasEvidence || !place || place.kind === "unresolved") await showLookup(interpreted, turn);
        return;
      }
      const area = validateIntent(interpreted.intent);
      const placeName = area.place ?? (area.kind === "clarify" && bareName ? candidate : null);
      const place = placeName ? await resolvePlace(placeName) : null;
      if (place?.kind === "unresolved") {
        reply.textContent = area.place ? place.message : clarification[area.reason];
        return;
      }
      if (area.kind === "select") return selectPlace(place, reply);
      if (area.kind === "clarify") {
        if (place) selectPlace(place, reply);
        if (!place || area.place) reply.textContent = place
          ? `${reply.textContent}\n\n${clarification[area.reason]}` : clarification[area.reason];
        return;
      }
      const region_id = place?.id ?? (!place ? selectedRegion : undefined);
      if (area.kind === "research") {
        reply.textContent = "";
        if (place) selectPlace(place, reply);
        if (!region_id) reply.textContent += `${place ? "\n\n" : ""}Research search covers the six saved study areas. Choose one to find sources.`;
        else await showLookup(await askAssistant({ mode: "lookup", tool: "find_research", region_id,
          variable_ids: area.variable_ids, start_year: area.start_year ?? config.startYear,
          end_year: area.end_year ?? config.endYear }), turn);
        return;
      }
      if (!place && !selected) {
        reply.textContent = clarification.place;
        return;
      }
      if (area.kind === "correlation" && (region_id || place?.kind === "point" || (!place && selectedPoint))) {
        reply.textContent = "";
        const target = place && selectPlace(place, reply);
        const point_id = region_id ? undefined : target ? target.point : !place ? selectedPoint : undefined;
        if (!region_id && !point_id) return;
        await showLookup(await askAssistant({ mode: "lookup", tool: "get_correlation", region_id, point_id,
          variable_ids: area.variable_ids, lag_months: area.lag }), turn);
        return;
      }

      reply.textContent = "Loading NASA data…";
      const answer = await window.answerClimateArea(area, place);
      if (answer) showAreaAnswer(answer, area, turn);
      else reply.textContent = clarification.place;
    } catch (error) {
      reply.textContent = error instanceof TypeError || error.name === "TimeoutError"
        ? "Could not reach the climate assistant. Try again."
        : error.message;
    } finally {
      send.disabled = false;
      history.scrollTop = history.scrollHeight;
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });

  for (const button of form.querySelectorAll("button[data-question]")) {
    button.addEventListener("click", () => {
      input.value = button.dataset.question;
      form.requestSubmit();
    });
  }
})();
