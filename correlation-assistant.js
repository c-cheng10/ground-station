(() => {
  "use strict";

  const config = window.TREND_CONFIG;
  const form = document.getElementById("assistant-form");
  if (!config || !form) return;

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
  const variableNames = new Map(config.variables.map(({ id, name }) => [id.toLowerCase(), name]));
  const monthFormat = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });

  function validMonth(yyyymm) {
    return Number.isInteger(yyyymm) && yyyymm >= config.startYear * 100 + 1 && yyyymm <= config.endYear * 100 + 12 &&
      yyyymm % 100 >= 1 && yyyymm % 100 <= 12;
  }

  function formatMonth(yyyymm) {
    return monthFormat.format(new Date(Date.UTC(Math.floor(yyyymm / 100), yyyymm % 100 - 1, 1)));
  }

  function showCorrelation(row) {
    const { region_id, lat, lon, variable_x, variable_y, paired_months, lag_months, pearson_r,
      first_month_x, last_month_x, first_month_y, last_month_y, source_x, source_y } = row;
    const region = regionNames.get(region_id) ?? `${lat}°, ${lon}°`;
    const earlier = variableNames.get(variable_x);
    const later = variableNames.get(variable_y);
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
    resultWindow.textContent = `${paired_months} paired months · ${earlier} (${source_x}): ${xWindow} · ${later} (${source_y}): ${yWindow}`;
    result.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || fieldset.disabled) return;
    result.hidden = true;
    researchNotice.hidden = true;
    researchSources.replaceChildren();
    researchSources.hidden = true;
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      reply.textContent = "The climate assistant is unavailable.";
      return;
    }

    const selection = document.getElementById("region-results")?.dataset;
    const selected = selection?.site;
    const region_id = regionNames.has(selected) ? selected : undefined;
    const point_id = selection?.point || undefined;
    fieldset.disabled = true;
    reply.textContent = "Looking up your question…";
    try {
      const response = await fetch(new URL("/functions/v1/climate-assistant-giovanni", config.supabaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ question, region_id, point_id }),
        signal: AbortSignal.timeout(45_000),
      });
      const answer = await response.json();
      if (response.status === 404) throw new Error("The Giovanni assistant is awaiting deployment.");
      if (!response.ok) throw new Error(answer?.error || "The assistant could not answer. Try again.");
      if (typeof answer?.reply !== "string") throw new Error("The assistant returned an invalid reply.");
      if (answer.correlation) showCorrelation(answer.correlation);
      const research = window.ClimateResearch;
      if (research && Array.isArray(answer.sources)) research.renderSources(researchSources, answer.sources);
      if (research && answer.partial === true) {
        researchNotice.hidden = false;
        researchNotice.textContent = research.partialNotice;
      }
      reply.textContent = answer.reply;
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
