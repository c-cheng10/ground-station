(() => {
  "use strict";

  const data = window.TREND_CONFIG;
  const { TrendStatistics, POINTS_INDEX: points = [], FEATURED_STRIPES: featured = {}, TREND_MAP: trendMap = {} } = window;
  const byId = (id) => document.getElementById(id);
  const explorer = byId("explorer");
  if (!data || !data.sites.length || !data.variables.length || !points.length || !TrendStatistics) {
    const error = byId("data-error");
    error.textContent = "The explorer could not start. Keep the JavaScript files next to this page, or download the study-area data above.";
    error.hidden = false;
    return;
  }

  const verdictLabels = {
    rising: "Rising",
    falling: "Falling",
    inconclusive: "Inconclusive",
  };
  const chartViews = {
    annual: { label: "Annual", legend: "Annual value", field: "values" },
    monthly: { label: "Monthly", legend: "Monthly value", field: "monthlyValues" },
    anomaly: { label: "Monthly anomaly", legend: "Monthly anomaly", field: "monthlyAnomalies" },
  };
  const monthFormat = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
  const risingMeans = {
    T2M: "Annual air temperatures were warmer toward the end of the record.",
    TS: "The surface was warmer toward the end of the record.",
    PRECTOTCORR: "Annual precipitation rates were higher toward the end of the record.",
    QV2M: "Near-surface air held more water vapour per kilogram toward the end of the record.",
    RH2M: "Near-surface air was closer to saturation toward the end of the record.",
    GWETROOT: "Soil in the upper metre was wetter toward the end of the record.",
    EVLAND: "More water returned from land to the air per day toward the end of the record.",
    WS10M: "Annual near-surface winds were stronger toward the end of the record.",
  };
  const fallingMeans = {
    T2M: "Annual air temperatures were cooler toward the end of the record.",
    TS: "The surface was cooler toward the end of the record.",
    PRECTOTCORR: "Annual precipitation rates were lower toward the end of the record.",
    QV2M: "Near-surface air held less water vapour per kilogram toward the end of the record.",
    RH2M: "Near-surface air was farther from saturation toward the end of the record.",
    GWETROOT: "Soil in the upper metre was drier toward the end of the record.",
    EVLAND: "Less water returned from land to the air per day toward the end of the record.",
    WS10M: "Annual near-surface winds were weaker toward the end of the record.",
  };

  const whyItMatters = {
    T2M: "The temperature you feel outdoors. It’s the most direct sign of warming or cooling.",
    TS: "How warm the ground or water surface gets. It shapes heat waves, frost and snowmelt.",
    PRECTOTCORR: "Rain plus melted snow. A shift here can mean more floods or more droughts.",
    QV2M: "The actual amount of water vapour in the air. Warmer air can hold more, so it often rises as places warm.",
    RH2M: "How close the air is to being full of water vapour. It affects comfort, fog and plant stress.",
    GWETROOT: "The water plant roots can reach. Falling values can warn of drought for farms and forests.",
    EVLAND: "Water leaving the land as vapour from soil and leaves. It links rain, heat and plant growth.",
    WS10M: "Average wind near the ground. It matters for wind energy, dust and how weather moves.",
    SNOW: "Snow on the ground stores winter water for spring rivers and keeps soil insulated. Less snow can mean drier summers.",
  };
  // Low and high colours for climate stripes: temperature runs blue to red, water runs brown to blue-green.
  const heat = { low: [33, 102, 172], high: [178, 24, 43], note: "Blue years were colder than average, red years warmer." };
  const water = { low: [140, 81, 10], high: [1, 102, 94], note: "Brown years were drier than average, teal years wetter." };
  const stripeScales = {
    T2M: heat, TS: heat,
    PRECTOTCORR: water, QV2M: water, RH2M: water, GWETROOT: water, EVLAND: water,
    WS10M: { low: [33, 102, 172], high: [84, 39, 143], note: "Blue years were calmer than average, purple years windier." },
    SNOW: { low: [140, 81, 10], high: [33, 102, 172], note: "Brown years had less snow than average, blue years more." },
  };
  const examples = [
    {
      title: "Is Southern Ontario getting warmer?",
      where: "Southern Ontario, Canada. Air temperature.",
      preview: ["ontario-T2M", "T2M"],
      blurb: "The classic first investigation: one place, one measurement, more than 40 years.",
      look: "Watch the stripes drift from blue to red, then read the verdict. The trend line climbs, and both statistical tests agree it is not luck.",
      site: () => data.sites.find(({ id }) => id === "southern-ontario"),
      ids: ["T2M"],
    },
    {
      title: "Is the Sahel in West Africa getting wetter?",
      where: "Near Niamey, Niger. Precipitation.",
      preview: ["sahel-PRECTOTCORR", "PRECTOTCORR"],
      blurb: "After severe droughts in the 1970s and 80s, rain partly came back. Is that a real trend?",
      look: "Look at the precipitation stripes and the verdict. Then open the table below the chart: soil wetness and humidity tell the same story, which makes the finding stronger.",
      site: () => pointSite(14, 2),
      ids: ["PRECTOTCORR"],
    },
    {
      title: "Does rain soak into the soil months later?",
      where: "Southern Ontario, Canada. Precipitation and soil wetness.",
      preview: ["ontario-PRECTOTCORR", "PRECTOTCORR"],
      blurb: "Compare two measurements and look for a time delay between them.",
      look: "This compares precipitation with root-zone soil wetness. Drag the time delay to 2 months: the link gets stronger, because rain takes time to sink down to plant roots.",
      site: () => data.sites.find(({ id }) => id === "southern-ontario"),
      ids: ["PRECTOTCORR", "GWETROOT"],
    },
  ];
  let story = null;
  // Canvases that show static stripes, redrawn whenever they resize.
  const liveStripes = new Map();

  const variableIds = data.variables.map(({ id }) => id);
  const regionResults = byId("region-results");
  const regionStatus = byId("region-status");
  const regionMessage = byId("region-message");
  const retryRegion = byId("retry-region");
  let site = null;
  let analysis = null;
  let regionRequest = null;
  let selectedIds = new Set([data.variables.find((item) => item.id === "T2M")?.id || data.variables[0].id]);
  let compareMode = false;
  let view = "annual";
  let activeIndex = null;
  let chartLayout;

  const chart = byId("chart");
  const tooltip = byId("chart-tooltip");
  const optionButtons = new Map();
  const viewButtons = new Map();
  const numberFormats = new Map();

  function format(value, decimals, signed = false) {
    const magnitude = Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value;
    const key = `${decimals}:${signed}`;
    if (!numberFormats.has(key)) {
      numberFormats.set(key, new Intl.NumberFormat("en-CA", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        signDisplay: signed ? "exceptZero" : "auto",
      }));
    }
    return numberFormats.get(key).format(magnitude).replace("-", "−");
  }

  function create(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    if (tag === "button") element.type = "button";
    return element;
  }

  function setSource(id, url) {
    const anchor = byId(id);
    if (url) anchor.href = url;
    else anchor.hidden = true;
  }

  function prepareCanvas(canvas) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function setRegionStatus(message, canRetry = false, loading = false) {
    regionMessage.textContent = message;
    regionStatus.hidden = !message;
    regionStatus.toggleAttribute("data-loading", loading);
    retryRegion.hidden = !canRetry;
  }

  function drawStripes(canvas, values, variableId, shown = values.length) {
    const drawing = prepareCanvas(canvas);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const scale = stripeScales[variableId] || stripeScales.T2M;
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    // Saturate at 2.2 standard deviations, close to the published warming-stripes scale.
    const spread = 2.2 * Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length) || 1;
    values.slice(0, shown).forEach((value, index) => {
      const t = Math.max(-1, Math.min(1, (value - mean) / spread));
      const end = t < 0 ? scale.low : scale.high;
      const rgb = end.map((channel) => Math.round(247 + (channel - 247) * Math.abs(t)));
      ctx.fillStyle = `rgb(${rgb})`;
      // Overlap by a pixel so no hairline gaps show between stripes.
      ctx.fillRect(Math.floor(index * width / values.length), 0, Math.ceil(width / values.length) + 1, height);
    });
  }

  // "1 in N" phrasing reads more easily than a raw p-value.
  function chanceText(p) {
    if (p < 0.001) return "less than 1 in 1,000 times";
    if (p >= 0.5) return "at least half the time";
    return `about 1 in ${Number((1 / p).toPrecision(2)).toLocaleString("en-CA")} times`;
  }

  function holmAdjust(trends, key, adjustedKey) {
    let adjustedP = 0;
    [...trends].sort((left, right) => left[key] - right[key]).forEach((trend, index) => {
      adjustedP = Math.min(1, Math.max(adjustedP, (trends.length - index) * trend[key]));
      trend[adjustedKey] = adjustedP;
    });
  }

  function adjustRegionTests(series) {
    const trends = Object.values(series).map(({ trend }) => trend);
    holmAdjust(trends, "pValue", "adjustedPValue");
    holmAdjust(trends, "mkPValue", "mkAdjustedPValue");
    for (const trend of trends) {
      trend.verdict = trend.adjustedPValue <= 0.05 ? (trend.slope > 0 ? "rising" : "falling") : "inconclusive";
    }
  }

  const pText = (p) => p < 0.001 ? "<0.001" : format(p, 3);

  // Every land point's record is stored in Supabase by build_gldas_dataset.py (NASA Giovanni data).
  async function loadPoint(point, signal) {
    const url = new URL("/rest/v1/climate_points", data.supabaseUrl);
    url.search = new URLSearchParams({ id: `eq.${point.latitude},${point.longitude}`, select: "*" });
    const response = await fetch(url, {
      signal, headers: { apikey: data.supabaseAnonKey, Authorization: `Bearer ${data.supabaseAnonKey}` },
    });
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
    const [row] = await response.json();
    if (!row) throw new Error(`No stored record for ${point.latitude}, ${point.longitude}.`);
    return row;
  }

  // Measurements come from different NASA datasets, so each is analysed over its own complete years.
  function analyseRow(row) {
    const series = {};
    const residuals = {};
    const starts = {};
    for (const variable of data.variables) {
      const firstYear = Math.ceil(variable.firstMonth / 12);
      const lastYear = Math.floor((variable.lastMonth + 1) / 12) - 1;
      const monthly = (row[variable.id.toLowerCase()] || []).slice(firstYear * 12, (lastYear + 1) * 12);
      if (monthly.length < 48 || monthly.some((value) => value === null)) continue;
      const span = Array.from({ length: lastYear - firstYear + 1 }, (_, k) => data.startYear + firstYear + k);
      const annual = span.map((_, k) => monthly.slice(k * 12, k * 12 + 12).reduce((a, b) => a + b, 0) / 12);
      const result = TrendStatistics.analyseRegion({ annual: { [variable.id]: annual }, monthly: { [variable.id]: monthly } },
        span, [variable.id], span[0], span.at(-1));
      series[variable.id] = { ...result.series[variable.id], firstYear: span[0], lastYear: span.at(-1) };
      residuals[variable.id] = result.residuals[variable.id];
      starts[variable.id] = firstYear * 12;
    }
    adjustRegionTests(series);
    return { series, residuals, starts, row };
  }

  async function selectSite(nextSite) {
    if (regionRequest && site.id === nextSite.id) return;
    regionRequest?.abort();
    const request = new AbortController();
    regionRequest = request;
    site = nextSite;
    analysis = null;
    chartLayout = null;
    byId("drawer-place").textContent = nextSite.name;
    byId("site-description").textContent = "";
    openDrawer();
    flyTo(nextSite.latitude, nextSite.longitude, Math.max(mapView.zoom, 3));
    regionResults.hidden = true;
    setRegionStatus(`Loading NASA data for ${nextSite.name}…`, false, true);
    try {
      const row = await loadPoint(nextSite, request.signal);
      if (regionRequest !== request) return;
      analysis = analyseRow(row);
      regionResults.hidden = false;
      setRegionStatus("");
      renderDetails();
    } catch (error) {
      if (regionRequest !== request) return;
      console.warn("Point data load failed", error);
      setRegionStatus(`The stored data for ${nextSite.name} didn’t load. Check your internet connection, then try again.`, true);
    } finally {
      if (regionRequest === request) regionRequest = null;
    }
  }

  // Snap to the nearest stored land point; null when the nearest is too far to stand for the click.
  function pointSite(latitude, longitude) {
    let best = null;
    let bestKm = Infinity;
    for (const [lat, lon] of points) {
      const dLon = ((lon - longitude + 540) % 360) - 180;
      const km = 111 * Math.hypot(lat - latitude, dLon * Math.cos(latitude * Math.PI / 180));
      if (km < bestKm) [best, bestKm] = [[lat, lon], km];
    }
    if (bestKm > 350) return null;
    const item = { latitude: best[0], longitude: best[1] };
    return {
      ...item,
      id: `point:${best[0]},${best[1]}`,
      name: countryAt(best[0], best[1]) || latLon(item),
      region: "Nearest NASA grid point",
      bounds: { south: best[0] - 0.125, north: best[0] + 0.125, west: best[1] - 0.125, east: best[1] + 0.125 },
    };
  }

  function stripeColour(scale, t) {
    const end = t < 0 ? scale.low : scale.high;
    return end.map((channel) => Math.round(247 + (channel - 247) * Math.min(1, Math.abs(t))));
  }

  function countryAt(latitude, longitude) {
    for (const country of window.WORLD_MAP?.countries || []) {
      for (const [ring] of country.polygons) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[j];
          if ((y1 > latitude) !== (y2 > latitude) && longitude < x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)) inside = !inside;
        }
        if (inside) return country.name;
      }
    }
    return null;
  }

  function trendMapVariable() {
    return data.variables.find((item) => item.id === [...selectedIds][0]) || data.variables[0];
  }

  function renderTrendMap() {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    for (const [id, button] of optionButtons) button.setAttribute("aria-pressed", String(selectedIds.has(id)));
    if (!entry) return;
    const unit = `${trendUnit(variable)} per decade`;
    byId("trend-map-sub").textContent = `${variable.name}, ${entry.years[0]}–${entry.years[1]}, from ${variable.source}.`;
    const scale = stripeScales[variable.id] || stripeScales.T2M;
    byId("trend-ramp").style.background = `linear-gradient(90deg, rgb(${scale.low}), rgb(247 247 247), rgb(${scale.high}))`;
    byId("trend-low").textContent = `${format(-entry.scale, variable.decimals + 1, true)}`;
    byId("trend-high").textContent = `${format(entry.scale, variable.decimals + 1, true)} ${unit}`;
    const ranked = points.map(([lat, lon], k) => ({ lat, lon, slope: entry.slope[k], significant: entry.significant[k] }))
      .filter((item) => item.significant && item.slope !== null);
    const list = (id, items) => byId(id).replaceChildren(...(items.length ? items.map((item) => {
      const button = create("button", "", "pick-variable");
      button.textContent = `${(countryAt(item.lat, item.lon) || "Coastal area")}: ${format(item.slope, variable.decimals + 1, true)} ${unit}`;
      button.addEventListener("click", () => choosePoint(item.lat, item.lon));
      const li = create("li");
      li.append(button);
      return li;
    }) : [create("li", "No place passes the significance test.")]));
    list("rising-list", ranked.filter((item) => item.slope > 0).sort((a, b) => b.slope - a.slope).slice(0, 5));
    list("falling-list", ranked.filter((item) => item.slope < 0).sort((a, b) => a.slope - b.slope).slice(0, 5));
    drawTrendMap();
  }

  function choosePoint(latitude, longitude) {
    const target = pointSite(latitude, longitude);
    if (target) {
      selectSite(target);
      return;
    }
    byId("drawer-place").textContent = "No land data here";
    byId("site-description").textContent = "";
    regionResults.hidden = true;
    byId("story").hidden = true;
    openDrawer();
    setRegionStatus("NASA’s land records cover land only, so pick a place on a continent.");
  }

  function latLon(item) {
    const latitude = `${format(Math.abs(item.latitude), 1)}° ${item.latitude < 0 ? "S" : "N"}`;
    const longitude = `${format(Math.abs(item.longitude), 2)}° ${item.longitude < 0 ? "W" : "E"}`;
    return `${latitude}, ${longitude}`;
  }

  function coordinates(item) {
    return `${item.region} at ${latLon(item)}: one 25 km grid cell.`;
  }

  function trendUnit(variable) {
    return variable.trendUnit === "pp" ? "percentage points" : variable.trendUnit || variable.unit;
  }

  function updateOverview() {
    byId("overview-title").textContent = `Every measurement in ${site.name}`;
    const rows = data.variables.map((variable) => {
      const trend = analysis.series[variable.id].trend;
      const row = create("tr");
      if (selectedIds.has(variable.id)) row.dataset.selected = "";
      const label = create("th");
      label.scope = "row";
      const button = create("button", variable.name, "pick-variable");
      button.addEventListener("click", () => {
        compareMode = false;
        selectedIds = new Set([variable.id]);
        renderDetails();
        optionButtons.get(variable.id).focus();
      });
      label.append(button);
      row.append(label, create("td", `${format(trend.slope, variable.decimals, true)} ${trendUnit(variable)}`), create("td", verdictLabels[trend.verdict]));
      return row;
    });
    byId("overview-rows").replaceChildren(...rows);
  }

  function renderCorrelations(variables) {
    const lag = byId("lag").valueAsNumber;
    const correlations = TrendStatistics.monthlyCorrelations(analysis.residuals, variables.map(({ id }) => id), lag, analysis.starts);
    byId("lag-value").textContent = lag === 1 ? "1 month" : `${lag} months`;
    byId("lag-note").textContent = lag === 0
      ? "Each cell compares the two variables in the same month."
      : `Each cell compares the row variable with the column variable ${lag === 1 ? "1 month" : `${lag} months`} later. A strong value means the row variable tends to lead the column variable. The diagonal shows how much each variable persists over that gap.`;
    const matrix = byId("matrix");
    const head = create("thead");
    const headingRow = create("tr");
    headingRow.append(create("td"));
    for (const variable of variables) {
      const heading = create("th", variable.name);
      heading.scope = "col";
      headingRow.append(heading);
    }
    head.append(headingRow);
    const body = create("tbody");
    for (const first of variables) {
      const row = create("tr");
      const heading = create("th", first.name);
      heading.scope = "row";
      row.append(heading);
      for (const second of variables) {
        const r = correlations[first.id][second.id];
        const cell = create("td", Number.isFinite(r) ? format(r, 2) : "N/A");
        if (Number.isFinite(r)) {
          const alpha = Math.abs(r) * 0.28;
          cell.style.backgroundColor = r < 0 ? `rgba(166, 100, 59, ${alpha})` : `rgba(28, 117, 88, ${alpha})`;
        }
        row.append(cell);
      }
      body.append(row);
    }
    matrix.replaceChildren(head, body);
  }

  function renderDetails() {
    renderTrendMap();
    if (!analysis) return;
    activeIndex = null;
    byId("chart-selection").textContent = "";
    byId("story").hidden = story?.siteId !== site.id;
    const variables = data.variables.filter((variable) => selectedIds.has(variable.id));
    for (const [id, button] of optionButtons) button.setAttribute("aria-pressed", String(selectedIds.has(id)));
    const comparing = variables.length > 1;
    byId("compare-toggle").setAttribute("aria-pressed", String(compareMode));
    byId("variable-hint").textContent = compareMode ? "Choose two or more measurements to see how they move together." : "Choose one measurement to see its trend.";
    byId("single-report").hidden = comparing;
    byId("correlations").hidden = !comparing;
    if (comparing) {
      renderCorrelations(variables);
    } else {
      const variable = variables[0];
      const trend = analysis.series[variable.id].trend;
      const unit = trendUnit(variable);
      byId("chart-title").textContent = `${variable.name} over time (${variable.unit})`;
      byId("result-headline").textContent = `${variable.name} in ${site.name} ${{
        rising: "is rising", falling: "is falling", inconclusive: "shows no clear trend yet",
      }[trend.verdict]}`;
      byId("variable-why").textContent = whyItMatters[variable.id] || "";
      byId("variable-description").textContent = variable.description;
      const scale = stripeScales[variable.id] || stripeScales.T2M;
      const { firstYear, lastYear } = analysis.series[variable.id];
      byId("stripes-note").textContent = `Each stripe is one year from ${firstYear} to ${lastYear}. ${scale.note}`;
      byId("site-description").textContent = coordinates(site);
      const verdict = byId("trend-verdict");
      verdict.dataset.state = trend.verdict;
      verdict.textContent = verdictLabels[trend.verdict];
      byId("trend-slope").textContent = `${format(trend.slope, variable.decimals, true)} ${unit}`;
      byId("trend-ci").textContent = `${format(trend.ciLow, variable.decimals, true)} to ${format(trend.ciHigh, variable.decimals, true)} ${unit}`;
      byId("trend-p").textContent = pText(trend.adjustedPValue);
      byId("trend-sen").textContent = `${format(trend.senSlope, variable.decimals, true)} ${unit}`;
      byId("trend-mk").textContent = pText(trend.mkAdjustedPValue);
      const mkSignificant = trend.mkAdjustedPValue <= 0.05;
      byId("trend-agree").textContent = mkSignificant === (trend.verdict !== "inconclusive")
        ? "The second test (Mann-Kendall) agrees with this result."
        : `The second test (Mann-Kendall) disagrees: it finds this trend ${mkSignificant ? "significant" : "not significant"}, so treat the result with caution.`;
      const meaning = trend.verdict === "rising" ? risingMeans[variable.id] : fallingMeans[variable.id];
      const total = `${format(trend.endValue - trend.startValue, variable.decimals, true)} ${unit}`;
      byId("trend-meaning").textContent = trend.verdict === "inconclusive"
        ? `No clear trend yet. The trend line moves ${total} from ${firstYear} to ${lastYear}, but the ups and downs between years are big enough to hide a steady change. ${yearsToSignificance(trend, lastYear - firstYear + 1)}`
        : `${meaning || `Annual ${variable.name.toLowerCase()} was ${trend.verdict === "rising" ? "higher" : "lower"} toward the end of the record.`} From ${firstYear} to ${lastYear} the trend line moves ${total}.`;
      byId("trend-chance").textContent = `If nothing were really changing, a trend this strong would show up by chance ${chanceText(trend.adjustedPValue)}.`;
      renderAgreement(variable);
      updateView();
      renderForecast(variable);
    }
    updateOverview();
  }

  // A trend's t-statistic grows with record length n as n^1.5 when the rate and the year-to-year
  // scatter stay the same, so we can estimate the years needed to reach |t| = 2 (about p = 0.05).
  // shortcut: ignores the stricter bar from adjusting for several measurements; say so in the text.
  function yearsToSignificance(trend, years) {
    const t = Math.abs(trend.slope) / ((trend.ciHigh - trend.ciLow) / (2 * 2));
    if (!Number.isFinite(t) || t < 0.3) return "There’s barely any change to detect, so a longer record probably wouldn’t show a trend either.";
    const more = Math.ceil(years * (2 / t) ** (2 / 3) - years);
    if (more > 100) return "At this slow rate, it would take more than a century of extra data to tell it apart from chance.";
    return `If it kept changing at this rate, about ${Math.max(1, more)} more ${more === 1 ? "year" : "years"} of data would likely make it significant on a standard test.`;
  }

  // Air temperature only: compare MERRA-2 with GLDAS 2.1 over the years both cover.
  function renderAgreement(variable) {
    const box = byId("datasets-agree");
    const compare = data.compare;
    box.hidden = variable.id !== "T2M" || !compare || !analysis.row[compare.id.toLowerCase()];
    if (box.hidden) return;
    const first = Math.ceil(compare.firstMonth / 12);
    const last = Math.min(Math.floor((compare.lastMonth + 1) / 12), Math.floor((variable.lastMonth + 1) / 12)) - 1;
    const yearly = (values) => Array.from({ length: last - first + 1 }, (_, k) =>
      values.slice((first + k) * 12, (first + k + 1) * 12).reduce((a, b) => a + b, 0) / 12);
    const merra = TrendStatistics.mannKendall(yearly(analysis.row.t2m)).senSlope;
    const gldas = TrendStatistics.mannKendall(yearly(analysis.row[compare.id.toLowerCase()])).senSlope;
    const gap = Math.abs(merra - gldas);
    const years = `${data.startYear + first}–${data.startYear + last}`;
    byId("datasets-agree-text").textContent =
      `Over ${years}, MERRA-2 says ${format(merra, 2, true)} °C per decade and the GLDAS 2.1 land model says ${format(gldas, 2, true)} °C. ` +
      (gap < 0.15
        ? "They agree closely, which makes the result more trustworthy."
        : `They differ by ${format(gap, 2)} °C per decade. When two NASA datasets disagree, a scientist checks how each was made before trusting either. GLDAS 2.1’s inputs changed over the years, so MERRA-2 is the more consistent record.`);
  }

  const model = window.WORLD_MODEL;
  const forecastViews = { ahead: "Next 12 months", backtest: `Test on ${model?.testYears.join("–")}` };
  const forecastButtons = new Map();
  let forecastView = "ahead";
  let forecastCache = null;
  const monthsText = (count) => count === 1 ? "1 month" : `${count} months`;

  function forecastData() {
    if (forecastCache?.analysis === analysis) return forecastCache;
    const anomalies = TrendStatistics.modelAnomalies(model,
      Object.fromEntries(model.variables.map((id) => [id, analysis.row[id.toLowerCase()]])));
    // Forecasts start after the last month every forecast measurement has (GPM lags a few months).
    let months = anomalies[model.variables[0]].length;
    while (model.variables.some((id) => Number.isNaN(anomalies[id][months - 1]))) months -= 1;
    const testStart = (model.testYears[0] - model.startYear) * 12;
    forecastCache = {
      analysis, anomalies, months, testStart,
      ahead: TrendStatistics.forecast(model, anomalies, site.latitude, months),
      backtest: TrendStatistics.backtest(model, anomalies, site.latitude, testStart, months),
    };
    return forecastCache;
  }

  function renderForecast(variable) {
    const index = model ? model.variables.indexOf(variable.id) : -1;
    byId("forecast").hidden = index < 0;
    if (index < 0) return;
    for (const [id, button] of forecastButtons) button.setAttribute("aria-pressed", String(id === forecastView));
    const skill = model.skillVsRecent.map((row) => row[index]);
    let good = 0;
    // Count a month only when the error drops at least 5% below the simple guess.
    while (good < skill.length && skill[good] >= 0.05) good += 1;
    const badge = byId("forecast-skill");
    badge.toggleAttribute("data-weak", good === 0);
    badge.textContent = good === 0
      ? `For ${variable.name.toLowerCase()}, the model can’t beat a simple guess yet, so treat this forecast as a rough sketch.`
      : `Tested on ${model.unseenPoints} places it never trained on, over ${model.testYears.join("–")}: it beats a simple guess by at least 5% for ${good === model.leads ? `all ${good} months` : monthsText(good)} ahead.`;
    byId("forecast-text").textContent = forecastView === "ahead"
      ? `The dashed line is the forecast for the 12 months after the record ends (${monthFormat.format(new Date(Date.UTC(model.startYear, forecastData().months)))} onward), shown as the difference from this point’s ${model.normal.join("–")} normal for that month. The shaded band is where 9 in 10 real months landed during testing. The simple guess it has to beat says each month will match its average over the last 5 years.`
      : `A fair test: the model never saw ${model.testYears.join(" to ")}. Each dashed point was predicted one month ahead using only the real months before it. The closer the dashed line follows the solid one, the better the model.`;
    const legend = [["", "Actual"], ["forecast", forecastView === "ahead" ? "Forecast" : "Predicted one month ahead"]];
    if (forecastView === "ahead") legend.push(["band", "Likely range (90%)"]);
    byId("forecast-legend").replaceChildren(...legend.map(([kind, label]) => {
      const item = create("span", "", "legend-item");
      const swatch = create("span", "", `swatch ${kind}`);
      swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, create("span", label));
      return item;
    }));
    drawForecast();
  }

  function drawForecast() {
    if (!analysis || !model || selectedIds.size !== 1 || byId("forecast").hidden) return;
    const drawing = prepareCanvas(byId("forecast-chart"));
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const variable = data.variables.find((item) => selectedIds.has(item.id));
    const index = model.variables.indexOf(variable.id);
    const result = forecastData();
    const history = result.anomalies[variable.id].slice(0, result.months);
    const ahead = forecastView === "ahead";
    const firstMonth = ahead ? result.months - 24 : result.testStart;
    const actual = history.slice(firstMonth);
    const predicted = (ahead ? result.ahead : result.backtest).map((row) => row[index]);
    const offset = ahead ? actual.length : 0;
    const total = offset + predicted.length;
    const band = ahead ? model.rmse.map((row) => 1.645 * row[index]) : [];
    const bandValues = band.flatMap((spread, k) => [predicted[k] + spread, predicted[k] - spread]);
    const { floor, ceiling, decimals, ticks } = axisScale([...actual, ...predicted, ...bandValues], [0]);
    ctx.font = '13px "Atkinson Hyperlegible Next", system-ui, sans-serif';
    const left = Math.max(29, ...ticks.map((tick) => ctx.measureText(format(tick, decimals)).width + 12));
    const right = width - 18;
    const top = 16;
    const bottom = height - 30;
    const x = (i) => left + (right - left) * i / (total - 1);
    const y = (value) => bottom - (bottom - top) * (value - floor) / (ceiling - floor);

    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of ticks) {
      ctx.strokeStyle = Math.abs(tick) < 1e-9 ? "#8a9bab" : "#dfe6ec";
      ctx.beginPath();
      ctx.moveTo(left, y(tick));
      ctx.lineTo(right, y(tick));
      ctx.stroke();
      ctx.fillStyle = "#46596c";
      ctx.fillText(format(tick, decimals), left - 9, y(tick));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < total; i += 1) {
      if ((firstMonth + i) % 12 === 0) ctx.fillText(String(model.startYear + Math.floor((firstMonth + i) / 12)), x(i), bottom + 10);
    }

    if (ahead) {
      ctx.fillStyle = "#a8402a2e";
      ctx.beginPath();
      predicted.forEach((value, k) => ctx[k ? "lineTo" : "moveTo"](x(offset + k), y(value + band[k])));
      for (let k = predicted.length - 1; k >= 0; k -= 1) ctx.lineTo(x(offset + k), y(predicted[k] - band[k]));
      ctx.fill();
      ctx.strokeStyle = "#9fb0c0";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x(offset - 0.5), top);
      ctx.lineTo(x(offset - 0.5), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "left";
      ctx.fillStyle = "#7d2a18";
      ctx.fillText("Forecast", x(offset - 0.5) + 6, top);
    }

    const line = (values, start, color, dashed) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.beginPath();
      values.forEach((value, k) => ctx[k ? "lineTo" : "moveTo"](x(start + k), y(value)));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(actual, 0, "#1f4e9c", false);
    // In forecast view the dashed line starts from the last real month so the two join up.
    line(ahead ? [actual.at(-1), ...predicted] : predicted, ahead ? offset - 1 : 0, "#a8402a", true);
  }

  function updateView() {
    const display = chartViews[view];
    for (const [id, button] of viewButtons) button.setAttribute("aria-pressed", String(id === view));
    byId("legend-value").textContent = display.legend;
    byId("trend-legend").hidden = view !== "annual";
    const note = byId("chart-note");
    note.hidden = view !== "anomaly";
    const shown = analysis?.series[[...selectedIds][0]];
    note.textContent = shown ? `Each value shows how far that month was from the average for the same calendar month over ${shown.firstYear}–${shown.lastYear}.` : "";
    drawChart();
  }

  function axisScale(values, endpoints) {
    const high = Math.max(...values, ...endpoints);
    const low = Math.min(...values, ...endpoints);
    const span = high - low || Math.abs(low) * 0.1 || 1;
    const roughStep = span / 4;
    const power = 10 ** Math.floor(Math.log10(roughStep));
    const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= roughStep) * power;
    const floor = Math.floor((low - span * 0.045) / step) * step;
    const ceiling = Math.ceil((high + span * 0.045) / step) * step;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step / power === 2.5 ? 1 : 0));
    const ticks = Array.from({ length: Math.round((ceiling - floor) / step) + 1 }, (_, index) => floor + index * step);
    return { floor, ceiling, decimals, ticks };
  }

  function drawChart() {
    if (!analysis || selectedIds.size !== 1) return;
    const drawing = prepareCanvas(chart);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const variable = data.variables.find((item) => selectedIds.has(item.id));
    const series = analysis.series[variable.id];
    drawStripes(byId("result-stripes"), series.values, variable.id);
    const values = series[chartViews[view].field];
    const { trend } = series;
    const annual = view === "annual";
    const endpoints = annual ? [trend.startValue, trend.endValue] : view === "anomaly" ? [0] : [];
    const { floor, ceiling, decimals, ticks } = axisScale(values, endpoints);
    ctx.font = '13px "Atkinson Hyperlegible Next", system-ui, sans-serif';
    const left = Math.max(29, ...ticks.map((tick) => ctx.measureText(format(tick, decimals)).width + 12));
    const right = width - 18;
    const top = 12;
    const bottom = height - 30;
    const x = (index) => left + (right - left) * index / (values.length - 1);
    const y = (value) => bottom - (bottom - top) * (value - floor) / (ceiling - floor);
    chartLayout = { left, right, length: values.length };

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#dfe6ec";
    ctx.fillStyle = "#46596c";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of ticks) {
      const yPos = y(tick);
      ctx.strokeStyle = view === "anomaly" && Math.abs(tick) < 1e-9 ? "#8a9bab" : "#dfe6ec";
      ctx.beginPath();
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.stroke();
      ctx.fillText(format(tick, decimals), left - 9, yPos);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const { firstYear, lastYear } = series;
    const years = [firstYear];
    const interval = width < 420 || lastYear - firstYear > 40 ? 20 : 10;
    for (let year = Math.ceil((firstYear + 4) / interval) * interval; year < lastYear - 3; year += interval) years.push(year);
    years.push(lastYear);
    for (const year of years) {
      const index = year === lastYear ? values.length - 1 : (year - firstYear) * (annual ? 1 : 12);
      ctx.fillText(String(year), x(index), bottom + 10);
    }

    ctx.strokeStyle = "#1f4e9c";
    ctx.lineWidth = 2.1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();

    if (annual) {
      ctx.strokeStyle = "#a8402a";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x(0), y(trend.startValue));
      ctx.lineTo(x(values.length - 1), y(trend.endValue));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    tooltip.hidden = activeIndex === null;
    if (activeIndex !== null) {
      const value = values[activeIndex];
      const xPos = x(activeIndex);
      const yPos = y(value);
      ctx.strokeStyle = "#9fb0c0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPos, top);
      ctx.lineTo(xPos, bottom);
      ctx.stroke();
      ctx.fillStyle = "#1f4e9c";
      ctx.beginPath();
      ctx.arc(xPos, yPos, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      const period = annual ? series.firstYear + activeIndex : monthFormat.format(new Date(Date.UTC(series.firstYear, activeIndex)));
      const label = `${period} · ${format(value, variable.decimals, view === "anomaly")} ${variable.unit}`;
      tooltip.textContent = label;
      tooltip.style.left = `${Math.max(2, Math.min(xPos + 9, width - tooltip.offsetWidth - 2))}px`;
      tooltip.style.top = `${Math.max(0, yPos - 35)}px`;
      if (byId("chart-selection").textContent !== label) byId("chart-selection").textContent = label;
    }
  }

  for (const variable of data.variables) {
    const button = create("button", variable.name);
    button.addEventListener("click", () => {
      if (!compareMode) {
        selectedIds = new Set([variable.id]);
      } else if (selectedIds.has(variable.id)) {
        if (selectedIds.size < 2) return;
        selectedIds.delete(variable.id);
      } else selectedIds.add(variable.id);
      renderDetails();
    });
    optionButtons.set(variable.id, button);
    byId("variable-options").append(button);
  }
  for (const [id, label] of Object.entries(forecastViews)) {
    const button = create("button", label);
    button.addEventListener("click", () => {
      forecastView = id;
      renderDetails();
    });
    forecastButtons.set(id, button);
    byId("forecast-options").append(button);
  }
  for (const [id, display] of Object.entries(chartViews)) {
    const button = create("button", display.label);
    button.addEventListener("click", () => {
      if (id === view) return;
      view = id;
      activeIndex = null;
      byId("chart-selection").textContent = "";
      updateView();
    });
    viewButtons.set(id, button);
    byId("chart-options").append(button);
  }
  byId("lag").addEventListener("input", renderDetails);
  byId("compare-toggle").addEventListener("click", () => {
    compareMode = !compareMode;
    if (!compareMode) selectedIds = new Set([selectedIds.values().next().value]);
    renderDetails();
  });
  function showValueAtPointer(event) {
    if (!chartLayout) return;
    const { left, right, length } = chartLayout;
    const relativeX = event.clientX - chart.getBoundingClientRect().left;
    const index = Math.round((relativeX - left) / (right - left) * (length - 1));
    const nextIndex = Math.max(0, Math.min(length - 1, index));
    if (nextIndex === activeIndex) return;
    activeIndex = nextIndex;
    drawChart();
  }
  chart.addEventListener("pointermove", showValueAtPointer);
  chart.addEventListener("pointerdown", showValueAtPointer);
  chart.addEventListener("pointerleave", () => { activeIndex = null; drawChart(); });
  chart.addEventListener("blur", () => { activeIndex = null; drawChart(); });
  chart.addEventListener("keydown", (event) => {
    if (!chartLayout || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const { length } = chartLayout;
    if (event.key === "Home") activeIndex = 0;
    else if (event.key === "End") activeIndex = length - 1;
    else if (activeIndex === null) activeIndex = event.key === "ArrowRight" ? 0 : length - 1;
    else activeIndex = Math.max(0, Math.min(length - 1, activeIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    drawChart();
  });
  setSource("data-source", data.sourceUrl);
  setSource("method-source", data.methodUrl);
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target === byId("chart-stage")) drawChart();
      else if (target === byId("forecast-stage")) drawForecast();
      else if (target === byId("trend-map-stage")) drawTrendMap();
      else if (liveStripes.has(target)) drawStripes(target, ...liveStripes.get(target));
    }
  });

  // ---- Full-screen map: pan, zoom, hover, click ----
  const app = byId("app");
  const stage = byId("trend-map-stage");
  const world = byId("trend-map");
  const mapTip = byId("map-tip");
  const pin = byId("map-pin");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones start zoomed in a little so squares are big enough to tap.
  const homeZoom = innerWidth < 760 ? 1.8 : 1;
  const mapView = { lon: 15, lat: 12, zoom: homeZoom };
  let revealLon = reduceMotion ? 180 : -180;
  let flight = 0;

  const mapSize = () => [world.clientWidth, world.clientHeight];
  // Plate carrée sized so the whole world (360° by the 144° the land records span) fits at zoom 1.
  const baseScale = (width, height) => Math.min(width / 360, height / 144);

  function projector(width, height) {
    const k = baseScale(width, height) * mapView.zoom;
    const project = (lon, lat) => [width / 2 + (lon - mapView.lon) * k, height / 2 - (lat - mapView.lat) * k];
    project.invert = (x, y) => [mapView.lon + (x - width / 2) / k, mapView.lat - (y - height / 2) / k];
    project.k = k;
    return project;
  }

  function clampView() {
    const [width, height] = mapSize();
    mapView.zoom = Math.min(16, Math.max(1, mapView.zoom));
    const k = baseScale(width, height) * mapView.zoom;
    const halfLon = width / 2 / k;
    const halfLat = height / 2 / k;
    mapView.lon = halfLon >= 180 ? 0 : Math.min(180 - halfLon, Math.max(-180 + halfLon, mapView.lon));
    mapView.lat = halfLat >= 72 ? 12 : Math.min(84 - halfLat, Math.max(-60 + halfLat, mapView.lat));
  }

  function drawTrendMap() {
    const drawing = prepareCanvas(world);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    clampView();
    const project = projector(width, height);
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    const scale = stripeScales[variable.id] || stripeScales.T2M;
    ctx.fillStyle = "#d6e3ed";
    ctx.fillRect(0, 0, width, height);
    const countries = window.WORLD_MAP?.countries || [];
    const trace = (polygon) => {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => ctx[index ? "lineTo" : "moveTo"](...project(lon, lat)));
        ctx.closePath();
      }
    };
    ctx.fillStyle = "#f6f8fa";
    for (const country of countries) {
      for (const polygon of country.polygons) {
        trace(polygon);
        ctx.fill("evenodd");
      }
    }
    if (entry) {
      // Points sit on a 3° lattice, so each square covers its share of the map.
      points.forEach(([lat, lon], k) => {
        const slope = entry.slope[k];
        if (slope === null || lon > revealLon) return;
        const [left, top] = project(lon - 1.5, lat + 1.5);
        const [right, bottom] = project(lon + 1.5, lat - 1.5);
        if (right < 0 || left > width || bottom < 0 || top > height) return;
        ctx.globalAlpha = entry.significant[k] ? 1 : 0.28;
        ctx.fillStyle = `rgb(${stripeColour(scale, slope / entry.scale)})`;
        ctx.fillRect(left, top, right - left + 0.6, bottom - top + 0.6);
      });
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#8a9db0";
    ctx.lineWidth = 0.7;
    for (const country of countries) {
      for (const polygon of country.polygons) {
        trace(polygon);
        ctx.stroke();
      }
    }
    if (site) {
      const [x, y] = project(site.longitude, site.latitude);
      pin.hidden = false;
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
    } else {
      pin.hidden = true;
    }
  }

  // Animate the view to a place; on wide screens keep it clear of the results panel.
  function flyTo(lat, lon, zoom, avoidPanel = true) {
    const [width, height] = mapSize();
    const open = avoidPanel && app.hasAttribute("data-drawer");
    // Side panel on wide screens, bottom sheet on phones: centre the place in the map that stays visible.
    const panelX = open && width > 760 ? byId("drawer").offsetWidth : 0;
    const panelY = open && width <= 760 ? byId("drawer").offsetHeight : 0;
    const k = baseScale(width, height) * zoom;
    const target = { lat: lat - panelY / 2 / k, lon: lon + panelX / 2 / k, zoom };
    const from = { ...mapView };
    cancelAnimationFrame(flight);
    if (reduceMotion) {
      Object.assign(mapView, target);
      drawTrendMap();
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 750);
      const e = 1 - (1 - t) ** 3;
      mapView.lat = from.lat + (target.lat - from.lat) * e;
      mapView.lon = from.lon + (target.lon - from.lon) * e;
      mapView.zoom = from.zoom * (target.zoom / from.zoom) ** e;
      drawTrendMap();
      if (t < 1) flight = requestAnimationFrame(step);
    };
    flight = requestAnimationFrame(step);
  }

  function zoomAt(x, y, factor) {
    const [width, height] = mapSize();
    const [lon, lat] = projector(width, height).invert(x, y);
    mapView.zoom *= factor;
    clampView();
    const k = baseScale(width, height) * mapView.zoom;
    mapView.lon = lon - (x - width / 2) / k;
    mapView.lat = lat + (y - height / 2) / k;
    drawTrendMap();
  }

  function pointIndexAt(x, y) {
    const [lon, lat] = projector(...mapSize()).invert(x, y);
    let best = -1;
    let bestDistance = 1.6;
    points.forEach(([pLat, pLon], k) => {
      const distance = Math.max(Math.abs(pLat - lat), Math.abs(pLon - lon));
      if (distance < bestDistance) [best, bestDistance] = [k, distance];
    });
    return best;
  }

  function showTip(x, y) {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    const k = pointIndexAt(x, y);
    if (!entry || k < 0 || entry.slope[k] === null) {
      mapTip.hidden = true;
      return;
    }
    const [lat, lon] = points[k];
    mapTip.replaceChildren(
      create("strong", countryAt(lat, lon) || "Coastal area"),
      create("span", `${format(entry.slope[k], variable.decimals + 1, true)} ${trendUnit(variable)} per decade`),
      create("br"),
      create("small", entry.significant[k] ? "A real trend. Click for details." : "Could be chance. Click for details."),
    );
    mapTip.hidden = false;
    mapTip.style.left = `${Math.min(x, mapSize()[0] - mapTip.offsetWidth - 24)}px`;
    mapTip.style.top = `${y}px`;
  }

  function openDrawer() {
    if (!app.hasAttribute("data-drawer")) {
      app.setAttribute("data-drawer", "");
      byId("welcome").hidden = true;
    }
    byId("drawer-title").focus({ preventScroll: true });
  }

  function closeDrawer() {
    app.removeAttribute("data-drawer");
    world.focus({ preventScroll: true });
  }

  const pointers = new Map();
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.offsetX, event.offsetY]);
    cancelAnimationFrame(flight);
    const [a, b] = [...pointers.values()];
    drag = {
      x: event.offsetX, y: event.offsetY, lon: mapView.lon, lat: mapView.lat, moved: b ? 99 : 0,
      pinch: b ? { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: mapView.zoom } : null,
    };
    mapTip.hidden = true;
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) {
      if (event.pointerType === "mouse") showTip(event.offsetX, event.offsetY);
      return;
    }
    pointers.set(event.pointerId, [event.offsetX, event.offsetY]);
    const [a, b] = [...pointers.values()];
    if (drag.pinch && b) {
      const factor = drag.pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / drag.pinch.distance / mapView.zoom;
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, factor);
      return;
    }
    const k = projector(...mapSize()).k;
    drag.moved = Math.max(drag.moved, Math.hypot(event.offsetX - drag.x, event.offsetY - drag.y));
    if (drag.moved > 4) stage.classList.add("dragging");
    mapView.lon = drag.lon - (event.offsetX - drag.x) / k;
    mapView.lat = drag.lat + (event.offsetY - drag.y) / k;
    drawTrendMap();
  });
  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (!drag || pointers.size) return;
    const clicked = drag.moved < 5 && event.type === "pointerup";
    drag = null;
    stage.classList.remove("dragging");
    if (clicked) {
      const [lon, lat] = projector(...mapSize()).invert(event.offsetX, event.offsetY);
      choosePoint(lat, lon);
    }
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("pointerleave", () => { mapTip.hidden = true; });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    cancelAnimationFrame(flight);
    zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });
  world.addEventListener("keydown", (event) => {
    const [width, height] = mapSize();
    const k = projector(width, height).k;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (moves[event.key]) {
      mapView.lon += moves[event.key][0] * width * 0.15 / k;
      mapView.lat += moves[event.key][1] * height * 0.15 / k;
      drawTrendMap();
    } else if (event.key === "+" || event.key === "=") zoomAt(width / 2, height / 2, 1.5);
    else if (event.key === "-") zoomAt(width / 2, height / 2, 1 / 1.5);
    else if (event.key === "Enter") choosePoint(mapView.lat, mapView.lon);
    else return;
    event.preventDefault();
  });
  byId("zoom-in").addEventListener("click", () => flyTo(mapView.lat, mapView.lon, mapView.zoom * 2, false));
  byId("zoom-out").addEventListener("click", () => flyTo(mapView.lat, mapView.lon, mapView.zoom / 2, false));
  byId("zoom-reset").addEventListener("click", () => flyTo(12, 15, homeZoom, false));

  // ---- Panels: results, welcome, how it works ----
  const hideWelcome = () => {
    byId("welcome").hidden = true;
    world.focus({ preventScroll: true });
  };
  byId("close-drawer").addEventListener("click", closeDrawer);
  byId("close-welcome").addEventListener("click", hideWelcome);
  byId("explore-map").addEventListener("click", hideWelcome);
  byId("show-welcome").addEventListener("click", () => {
    app.removeAttribute("data-drawer");
    byId("welcome").hidden = false;
    byId("close-welcome").focus();
  });
  const how = byId("how");
  byId("show-how").addEventListener("click", () => how.showModal());
  byId("close-how").addEventListener("click", () => how.close());
  how.addEventListener("click", (event) => { if (event.target === how) how.close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || how.open) return;
    if (app.hasAttribute("data-drawer")) closeDrawer();
    else if (!byId("welcome").hidden) hideWelcome();
  });
  byId("locate").addEventListener("click", () => {
    const button = byId("locate");
    if (!navigator.geolocation) {
      button.textContent = "Location unavailable";
      return;
    }
    button.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        button.textContent = "Use my location";
        choosePoint(coords.latitude, coords.longitude);
      },
      () => {
        button.textContent = "Location unavailable";
        setTimeout(() => { button.textContent = "Use my location"; }, 2500);
      },
      { timeout: 10000 },
    );
  });
  byId("point-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const { latitude, longitude } = event.target.elements;
    choosePoint(latitude.valueAsNumber, longitude.valueAsNumber);
  });
  retryRegion.addEventListener("click", () => selectSite(site));

  // ---- Examples in the welcome card ----
  function showStripes(canvas, values, id) {
    liveStripes.set(canvas, [values, id]);
    drawStripes(canvas, values, id);
    observer.observe(canvas);
  }
  for (const example of examples) {
    const button = create("button");
    const preview = create("canvas");
    preview.setAttribute("aria-hidden", "true");
    button.append(preview, create("span", example.title));
    button.addEventListener("click", () => {
      const target = example.site();
      if (!target) return;
      story = { siteId: target.id };
      byId("story-title").textContent = `What to look for: ${example.title}`;
      byId("story-text").textContent = example.look;
      compareMode = example.ids.length > 1;
      selectedIds = new Set(example.ids);
      byId("lag").value = 0;
      if (site?.id === target.id && analysis) {
        openDrawer();
        renderDetails();
      } else {
        selectSite(target);
      }
    });
    const item = create("li");
    item.append(button);
    byId("example-list").append(item);
    const values = featured[example.preview[0]];
    if (values?.length) showStripes(preview, values, example.preview[1]);
  }

  observer.observe(byId("chart-stage"));
  observer.observe(byId("forecast-stage"));
  observer.observe(stage);
  renderTrendMap();
  // The page's one load moment: trend squares sweep in west to east, like a satellite pass.
  if (!reduceMotion) {
    const start = performance.now();
    const sweep = (now) => {
      const t = Math.min(1, Math.max(0, (now - start - 250) / 1600));
      revealLon = -180 + 360 * (1 - (1 - t) ** 3);
      drawTrendMap();
      if (t < 1) requestAnimationFrame(sweep);
    };
    requestAnimationFrame(sweep);
  }
})();
