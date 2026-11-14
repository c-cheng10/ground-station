(() => {
  "use strict";

  const data = window.TREND_CONFIG;
  const { PowerData, TrendStatistics } = window;
  const byId = (id) => document.getElementById(id);
  const explorer = byId("explorer");
  if (!data || !data.sites.length || !data.variables.length || !PowerData || !TrendStatistics) {
    const error = byId("data-error");
    error.textContent = "The explorer could not start. Keep the JavaScript files next to this page, or download the CSV snapshot above.";
    error.hidden = false;
    return;
  }

  const mapFrames = {
    "North America": { west: -170, east: -48, south: 6, north: 74, aspect: 0.80 },
    "South America": { west: -87, east: -32, south: -57, north: 14, aspect: 0.95 },
  };
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
  };
  // Low and high colours for climate stripes: temperature runs blue to red, water runs brown to blue-green.
  const heat = { low: [33, 102, 172], high: [178, 24, 43], note: "Blue years were colder than average, red years warmer." };
  const water = { low: [140, 81, 10], high: [1, 102, 94], note: "Brown years were drier than average, teal years wetter." };
  const stripeScales = {
    T2M: heat, TS: heat,
    PRECTOTCORR: water, QV2M: water, RH2M: water, GWETROOT: water, EVLAND: water,
    WS10M: { low: [33, 102, 172], high: [84, 39, 143], note: "Blue years were calmer than average, purple years windier." },
  };
  const examples = [
    {
      title: "Is Southern Ontario getting warmer?",
      where: "Southern Ontario, Canada. Air temperature.",
      csvColumn: 5,
      previewId: "T2M",
      blurb: "The classic first investigation: one place, one measurement, 45 years.",
      look: "Watch the stripes drift from blue to red, then read the verdict. The trend line climbs, and both statistical tests agree it is not luck.",
      site: () => data.sites.find(({ id }) => id === "southern-ontario"),
      ids: ["T2M"],
    },
    {
      title: "Is the Sahel in West Africa getting wetter?",
      where: "Near Niamey, Niger. Precipitation.",
      previewId: "PRECTOTCORR",
      // Annual NASA POWER means for the same 3×3 patch the explorer loads, 1981–2025.
      values: [1.186, 1.159, 1.205, 0.915, 1.129, 1.22, 0.88, 1.337, 1.32, 1.061, 1.275, 1.189, 1.06, 1.401, 1.312, 1.205, 1.194, 1.603, 1.588, 1.087, 1.141, 1.048, 1.366, 0.951, 1.369, 1.078, 1.338, 1.234, 1.247, 1.397, 1.076, 1.567, 1.456, 1.219, 1.495, 1.359, 1.264, 1.261, 1.209, 1.878, 1.24, 1.473, 1.166, 1.96, 1.336],
      blurb: "After severe droughts in the 1970s and 80s, rain partly came back. Is that a real trend?",
      look: "Look at the precipitation stripes and the verdict. Then open the table below the chart: soil wetness and humidity tell the same story, which makes the finding stronger.",
      site: () => pointSite(14, 2),
      ids: ["PRECTOTCORR"],
    },
    {
      title: "Does rain soak into the soil months later?",
      where: "Southern Ontario, Canada. Precipitation and soil wetness.",
      csvColumn: 7,
      previewId: "PRECTOTCORR",
      blurb: "Compare two measurements and look for a time delay between them.",
      look: "This compares precipitation with root-zone soil wetness. Drag the time delay to 2 months: the link gets stronger, because rain takes time to sink down to plant roots.",
      site: () => data.sites.find(({ id }) => id === "southern-ontario"),
      ids: ["PRECTOTCORR", "GWETROOT"],
    },
  ];
  let story = null;
  // Canvases that show static stripes, redrawn whenever they resize.
  const liveStripes = new Map();

  const years = Array.from({ length: data.endYear - data.startYear + 1 }, (_, index) => data.startYear + index);
  const variableIds = data.variables.map(({ id }) => id);
  const regionResults = byId("region-results");
  const regionStatus = byId("region-status");
  const regionMessage = byId("region-message");
  const retryRegion = byId("retry-region");
  const refreshRegion = byId("refresh-region");
  let mapContinent = "North America";
  let site = null;
  let analysis = null;
  let regionRequest = null;
  let selectedIds = new Set([data.variables.find((item) => item.id === "T2M")?.id || data.variables[0].id]);
  let compareMode = false;
  let view = "annual";
  let activeIndex = null;
  let chartLayout;

  const map = byId("map");
  const chart = byId("chart");
  const tooltip = byId("chart-tooltip");
  const optionButtons = new Map();
  const continentButtons = new Map();
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

  function analyseRecords(records) {
    const result = TrendStatistics.analyseRegion(records, years, variableIds, data.baselineStart, data.baselineEnd);
    adjustRegionTests(result.series);
    return result;
  }

  function readCachedAnalysis(key) {
    try {
      const saved = localStorage.getItem(key);
      return saved ? analyseRecords(JSON.parse(saved)) : null;
    } catch {
      // A corrupt entry or blocked browser storage falls back to NASA.
      return null;
    }
  }

  async function syncNewMonths(regionId, signal) {
    const url = new URL("/functions/v1/refresh-climate", data.supabaseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.supabaseAnonKey}`,
      },
      body: JSON.stringify({ region_id: regionId }),
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Supabase could not refresh the region.");
    if (!Number.isInteger(result.new_rows) || result.new_rows < 0 ||
        !Number.isInteger(result.latest_month) || result.latest_month % 100 < 1 ||
        result.latest_month % 100 > 12 || result.latest_month < 198101) {
      throw new Error("Supabase returned an invalid refresh result.");
    }
    const latest = monthFormat.format(new Date(Date.UTC(
      Math.floor(result.latest_month / 100), result.latest_month % 100 - 1, 1
    )));
    return result.new_rows
      ? `Saved ${result.new_rows} new grid-cell records to Supabase through ${latest}.`
      : `No new complete months from NASA POWER. Supabase has records through ${latest}.`;
  }

  async function selectSite(nextSite, refresh = false) {
    if (regionRequest && site.id === nextSite.id) return;
    regionRequest?.abort();
    regionRequest = null;
    const key = `nasa-power-v1:${nextSite.id}:${nextSite.latitude},${nextSite.longitude}:${data.startYear}-${data.endYear}:${variableIds.join(",")}`;
    analysis = site?.id === nextSite.id && analysis ? analysis : readCachedAnalysis(key);
    site = nextSite;
    chartLayout = null;
    updateSiteButtons();
    drawMap();
    regionResults.hidden = !analysis;
    refreshRegion.disabled = refresh;
    if (analysis) renderDetails();
    if (analysis && !refresh) {
      setRegionStatus("");
      return;
    }

    const request = new AbortController();
    regionRequest = request;
    // Supabase stores the six study areas only; chosen points refresh in this browser.
    const syncToSupabase = refresh && analysis && data.supabaseUrl && data.sites.includes(nextSite);
    setRegionStatus(analysis ? `Refreshing ${nextSite.name} from NASA POWER…` : `Loading 45 years of NASA data for ${nextSite.name}… This usually takes 5 to 10 seconds.`, false, true);
    try {
      if (syncToSupabase) {
        const message = await syncNewMonths(nextSite.id, request.signal);
        if (regionRequest === request) setRegionStatus(message);
        return;
      }
      const records = await PowerData.loadRegion(nextSite, data.startYear, data.endYear, variableIds, { signal: request.signal });
      if (regionRequest !== request) return;
      analysis = analyseRecords(records);
      try {
        localStorage.setItem(key, JSON.stringify(records));
      } catch {
        // The plot still works if the browser cannot save the result.
      }
      regionResults.hidden = false;
      const supabaseNote = data.sites.includes(nextSite) && !data.supabaseUrl ? " Supabase isn’t connected yet, so nothing was saved to the shared dataset." : "";
      setRegionStatus(refresh ? `Updated ${nextSite.name} in this browser.${supabaseNote}` : "");
      renderDetails();
    } catch (error) {
      if (regionRequest !== request) return;
      console.warn("Region data load failed", error);
      // POWER fills land-only variables (soil, evaporation) with -999 over water.
      if (!data.sites.includes(nextSite) && /did not return/.test(error.message)) {
        setRegionStatus(`NASA POWER has no complete land record around ${nextSite.name}. Soil and evaporation data stop at coasts and oceans, so choose a point farther inland.`);
        return;
      }
      const detail = analysis ? "Showing the last successful result." : "Check your connection and try again.";
      const problem = syncToSupabase && error instanceof Error
        ? error.message : `Could not load ${nextSite.name} from NASA POWER.`;
      setRegionStatus(`${problem} ${detail}`, true);
    } finally {
      if (regionRequest === request) {
        regionRequest = null;
        refreshRegion.disabled = false;
      }
    }
  }

  function visibleSites() {
    return data.sites.filter(({ continent }) => continent === mapContinent);
  }

  function updateSiteButtons() {
    for (const button of document.querySelectorAll("button[data-site]")) {
      button.setAttribute("aria-pressed", String(button.dataset.site === site?.id));
    }
  }

  function renderSiteList() {
    const buttons = visibleSites().map((item) => {
      const button = create("button");
      button.dataset.site = item.id;
      button.append(create("strong", item.name), create("small", item.region));
      button.addEventListener("click", () => selectSite(item));
      return button;
    });
    const title = create("p", "Study areas", "site-list-title");
    title.id = "site-list-title";
    byId("site-list").replaceChildren(title, ...buttons);
    updateSiteButtons();
  }

  function mapProjection(width, height) {
    const frame = mapFrames[mapContinent];
    const side = Math.min(22, width * 0.045);
    const innerWidth = width - 2 * side;
    const innerHeight = height - 2 * side;
    const longitudeSpan = frame.east - frame.west;
    const latitudeSpan = frame.north - frame.south;
    const scale = Math.min(innerWidth / (longitudeSpan * frame.aspect), innerHeight / latitudeSpan);
    const xOffset = (width - longitudeSpan * frame.aspect * scale) / 2;
    const yOffset = (height - latitudeSpan * scale) / 2;
    const project = (longitude, latitude) => [
      xOffset + (longitude - frame.west) * frame.aspect * scale,
      yOffset + (frame.north - latitude) * scale,
    ];
    project.invert = (x, y) => [
      frame.west + (x - xOffset) / (frame.aspect * scale),
      frame.north - (y - yOffset) / scale,
    ];
    return project;
  }

  // Snap to NASA POWER's 0.5° × 0.625° cell centres so the 3×3 patch matches its grid exactly.
  function pointSite(latitude, longitude) {
    const lat = Math.max(-88.5, Math.min(88.5, Math.round(latitude / 0.5) * 0.5));
    const lon = Math.max(-179.375, Math.min(179.375, Math.round(longitude / 0.625) * 0.625));
    const item = { latitude: lat, longitude: lon };
    return {
      ...item,
      id: `point:${lat},${lon}`,
      name: latLon(item),
      region: "Chosen point",
      bounds: { south: lat - 0.75, north: lat + 0.75, west: lon - 0.9375, east: lon + 0.9375 },
      cellCount: 9,
    };
  }

  function drawMap() {
    const drawing = prepareCanvas(map);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const project = mapProjection(width, height);
    const frame = mapFrames[mapContinent];
    ctx.strokeStyle = "#bccbd8";
    ctx.lineWidth = 0.75;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let lat = -50; lat <= 70; lat += 10) {
      ctx.moveTo(...project(frame.west, lat));
      ctx.lineTo(...project(frame.east, lat));
    }
    for (let lon = -170; lon <= -30; lon += 10) {
      ctx.moveTo(...project(lon, frame.north));
      ctx.lineTo(...project(lon, frame.south));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#f8fafb";
    ctx.strokeStyle = "#9fb0c0";
    ctx.lineWidth = 0.9;
    for (const country of window.AMERICAS_MAP?.countries || []) {
      for (const polygon of country.polygons) {
        ctx.beginPath();
        for (const ring of polygon) {
          ring.forEach(([lon, lat], index) => {
            const point = project(lon, lat);
            if (index === 0) ctx.moveTo(...point);
            else ctx.lineTo(...point);
          });
          ctx.closePath();
        }
        ctx.fill("evenodd");
        ctx.stroke();
      }
    }

    const areas = visibleSites();
    if (site && !data.sites.includes(site)) areas.push(site);
    for (const item of areas) {
      const { west, east, south, north } = item.bounds;
      const [left, top] = project(west, north);
      const [right, bottom] = project(east, south);
      const selected = item.id === site?.id;
      ctx.strokeStyle = selected ? "#a8402a" : "#1f4e9c";
      ctx.fillStyle = selected ? "#a8402a40" : "#1f4e9c2e";
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeRect(left, top, right - left, bottom - top);
    }

    for (const element of byId("map-markers").children) {
      const item = data.sites.find((item) => item.id === element.dataset.mapSite);
      const [left, top] = project(item.longitude, item.latitude);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      if (element.classList.contains("map-marker-label")) {
        element.classList.toggle("align-left", left > width * 0.63);
        element.style.maxWidth = `${Math.floor(width * 0.38)}px`;
      }
    }
  }

  function renderMap() {
    const container = byId("map-markers");
    container.replaceChildren();
    for (const item of visibleSites()) {
      const marker = create("button", "", "map-marker");
      marker.dataset.site = item.id;
      marker.dataset.mapSite = item.id;
      marker.setAttribute("aria-label", `${item.name}, ${item.region}`);
      marker.addEventListener("click", () => selectSite(item));
      const label = create("span", item.name, "map-marker-label");
      label.dataset.mapSite = item.id;
      label.setAttribute("aria-hidden", "true");
      container.append(marker, label);
    }
    updateSiteButtons();
    drawMap();
  }

  function latLon(item) {
    const latitude = `${format(Math.abs(item.latitude), 1)}° ${item.latitude < 0 ? "S" : "N"}`;
    const longitude = `${format(Math.abs(item.longitude), 2)}° ${item.longitude < 0 ? "W" : "E"}`;
    return `${latitude}, ${longitude}`;
  }

  function coordinates(item) {
    return `${item.region} at ${latLon(item)}, averaged over ${item.cellCount} grid cells.`;
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
    const correlations = TrendStatistics.monthlyCorrelations(analysis.residuals, variables.map(({ id }) => id), lag);
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
      byId("result-headline").textContent = `${variable.name} ${data.sites.includes(site) ? "in" : "at"} ${site.name} ${{
        rising: "is rising", falling: "is falling", inconclusive: "shows no clear trend yet",
      }[trend.verdict]}`;
      byId("variable-why").textContent = whyItMatters[variable.id] || "";
      byId("variable-description").textContent = variable.description;
      const scale = stripeScales[variable.id] || stripeScales.T2M;
      byId("stripes-note").textContent = `Each stripe is one year from ${data.startYear} to ${data.endYear}. ${scale.note}`;
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
        ? `No clear trend yet. The trend line moves ${total} from ${data.startYear} to ${data.endYear}, but the ups and downs between years are big enough to hide a steady change.`
        : `${meaning || `Annual ${variable.name.toLowerCase()} was ${trend.verdict === "rising" ? "higher" : "lower"} toward the end of the record.`} From ${data.startYear} to ${data.endYear} the trend line moves ${total}.`;
      byId("trend-chance").textContent = `If nothing were really changing, a trend this strong would show up by chance ${chanceText(trend.adjustedPValue)}.`;
      updateView();
      renderForecast(variable);
    }
    updateOverview();
  }

  const model = window.WORLD_MODEL;
  const forecastViews = { ahead: "Next 12 months", backtest: `Test on ${model?.testYears.join("–")}` };
  const forecastButtons = new Map();
  let forecastView = "ahead";
  let forecastCache = null;
  const monthsText = (count) => count === 1 ? "1 month" : `${count} months`;

  function forecastData() {
    if (forecastCache?.analysis === analysis) return forecastCache;
    const anomalies = Object.fromEntries(variableIds.map((id) => [id, analysis.series[id].monthlyAnomalies]));
    const months = anomalies[variableIds[0]].length;
    const testStart = (model.testYears[0] - data.startYear) * 12;
    forecastCache = {
      analysis, months, testStart,
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
      : `Tested on 6 regions over ${model.testYears.join("–")}: it beats a simple guess by at least 5% for ${good === model.leads ? `all ${good} months` : monthsText(good)} ahead.`;
    byId("forecast-text").textContent = forecastView === "ahead"
      ? `The dashed line is the forecast for each month of ${data.endYear + 1}, shown as the difference from the ${data.baselineStart}–${data.baselineEnd} normal for that month. The shaded band is where 9 in 10 real months landed during testing. The simple guess it has to beat says each month will match its average over the last 5 years.`
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
    const history = analysis.series[variable.id].monthlyAnomalies;
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
      if ((firstMonth + i) % 12 === 0) ctx.fillText(String(data.startYear + Math.floor((firstMonth + i) / 12)), x(i), bottom + 10);
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
    note.textContent = `Each value shows how far that month was from the average for the same calendar month in ${data.baselineStart}–${data.baselineEnd}.`;
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
    const years = [data.startYear];
    const interval = width < 420 ? 20 : 10;
    for (let year = Math.ceil((data.startYear + 4) / interval) * interval; year < data.endYear - 3; year += interval) years.push(year);
    years.push(data.endYear);
    for (const year of years) {
      const index = year === data.endYear ? values.length - 1 : (year - data.startYear) * (annual ? 1 : 12);
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
      const period = annual ? data.startYear + activeIndex : monthFormat.format(new Date(Date.UTC(data.startYear, activeIndex)));
      const label = `${period} · ${format(value, variable.decimals, view === "anomaly")} ${variable.unit}`;
      tooltip.textContent = label;
      tooltip.style.left = `${Math.max(2, Math.min(xPos + 9, width - tooltip.offsetWidth - 2))}px`;
      tooltip.style.top = `${Math.max(0, yPos - 35)}px`;
      if (byId("chart-selection").textContent !== label) byId("chart-selection").textContent = label;
    }
  }

  for (const continent of Object.keys(mapFrames)) {
    const button = create("button", continent);
    button.setAttribute("aria-pressed", String(continent === mapContinent));
    button.addEventListener("click", () => {
      if (mapContinent === continent) return;
      mapContinent = continent;
      for (const [name, control] of continentButtons) {
        control.setAttribute("aria-pressed", String(name === mapContinent));
      }
      renderSiteList();
      renderMap();
    });
    continentButtons.set(continent, button);
    byId("continent-controls").append(button);
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
      if (target === byId("map-stage")) drawMap();
      else if (target === byId("chart-stage")) drawChart();
      else if (target === byId("forecast-stage")) drawForecast();
      else if (liveStripes.has(target)) drawStripes(target, ...liveStripes.get(target));
    }
  });
  explorer.hidden = false;
  renderSiteList();
  renderMap();
  setRegionStatus("Pick a study area, click the map, or try an example above to load a place.");
  retryRegion.addEventListener("click", () => selectSite(site, true));
  refreshRegion.addEventListener("click", () => selectSite(site, true));

  for (const example of examples) {
    const item = create("li", "", "example");
    const button = create("button", "Investigate", "button primary small");
    button.addEventListener("click", () => {
      const target = example.site();
      story = { siteId: target.id };
      byId("story-title").textContent = `What to look for: ${example.title}`;
      byId("story-text").textContent = example.look;
      compareMode = example.ids.length > 1;
      selectedIds = new Set(example.ids);
      byId("lag").value = 0;
      byId("explore").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (site?.id === target.id && analysis) renderDetails();
      else selectSite(target);
    });
    const preview = create("canvas");
    preview.setAttribute("aria-hidden", "true");
    example.canvas = preview;
    const body = create("div", "", "example-body");
    body.append(create("h3", example.title), create("p", example.where, "where"), create("p", example.blurb), button);
    item.append(preview, body);
    byId("example-list").append(item);
  }

  function showStripes(canvas, values, id) {
    liveStripes.set(canvas, [values, id]);
    drawStripes(canvas, values, id);
    observer.observe(canvas);
  }

  // The hero and example stripes come from the bundled CSV, so the page shows real data before any NASA request.
  fetch("americas-trends.csv").then((response) => response.text()).then((text) => {
    const rows = text.trim().split("\n").slice(1).map((line) => line.split(",")).filter(([name]) => name === "Southern Ontario");
    for (const example of examples) {
      const values = example.values || rows.map((row) => Number(row[example.csvColumn]));
      if (values.length) showStripes(example.canvas, values, example.previewId);
    }
    const values = rows.map((row) => Number(row[5]));
    if (!values.length) return;
    liveStripes.set(byId("hero-stripes"), [values, "T2M"]);
    // The page's one load moment: years appear left to right, easing out.
    const start = performance.now();
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400;
    const step = (now) => {
      const progress = duration ? Math.min(1, (now - start) / duration) : 1;
      drawStripes(byId("hero-stripes"), values, "T2M", Math.ceil(values.length * (1 - (1 - progress) ** 3)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }).catch(() => { byId("hero-stripes").hidden = true; });
  byId("map-stage").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const rect = map.getBoundingClientRect();
    const [longitude, latitude] = mapProjection(rect.width, rect.height).invert(event.clientX - rect.left, event.clientY - rect.top);
    selectSite(pointSite(latitude, longitude));
  });
  byId("point-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const { latitude, longitude } = event.target.elements;
    selectSite(pointSite(latitude.valueAsNumber, longitude.valueAsNumber));
  });

  observer.observe(byId("hero-stripes"));
  observer.observe(byId("map-stage"));
  observer.observe(byId("chart-stage"));
  observer.observe(byId("forecast-stage"));
})();
