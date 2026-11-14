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

  const mapFrames = {
    World: { west: -180, east: 180, south: -58, north: 84, aspect: 1 },
    Americas: { west: -170, east: -30, south: -57, north: 74, aspect: 0.85 },
    "Europe & Africa": { west: -25, east: 60, south: -38, north: 72, aspect: 0.85 },
    "Asia & Oceania": { west: 55, east: 180, south: -48, north: 78, aspect: 0.85 },
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
  let mapContinent = "World";
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
    updateSiteButtons();
    drawMap();
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

  function visibleSites() {
    const { west, east, south, north } = mapFrames[mapContinent];
    return data.sites.filter(({ latitude, longitude }) =>
      longitude >= west && longitude <= east && latitude >= south && latitude <= north);
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

  function mapProjection(width, height, frame = mapFrames[mapContinent]) {
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
      name: latLon(item),
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
    return "Coast";
  }

  function trendMapVariable() {
    return data.variables.find((item) => item.id === [...selectedIds][0]) || data.variables[0];
  }

  function renderTrendMap() {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    byId("trend-card").hidden = !entry;
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
      button.textContent = `${countryAt(item.lat, item.lon)}: ${format(item.slope, variable.decimals + 1, true)} ${unit}`;
      button.addEventListener("click", () => choosePoint(item.lat, item.lon));
      const li = create("li");
      li.append(button);
      return li;
    }) : [create("li", "No place passes the significance test.")]));
    list("rising-list", ranked.filter((item) => item.slope > 0).sort((a, b) => b.slope - a.slope).slice(0, 5));
    list("falling-list", ranked.filter((item) => item.slope < 0).sort((a, b) => a.slope - b.slope).slice(0, 5));
    drawTrendMap();
  }

  function drawTrendMap() {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    const drawing = entry && prepareCanvas(byId("trend-map"));
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const project = mapProjection(width, height, mapFrames.World);
    const scale = stripeScales[variable.id] || stripeScales.T2M;
    ctx.fillStyle = "#dbe6ee";
    ctx.fillRect(0, 0, width, height);
    const outline = (fill, stroke) => {
      for (const country of window.WORLD_MAP?.countries || []) {
        for (const polygon of country.polygons) {
          ctx.beginPath();
          for (const ring of polygon) {
            ring.forEach(([lon, lat], index) => ctx[index ? "lineTo" : "moveTo"](...project(lon, lat)));
            ctx.closePath();
          }
          if (fill) { ctx.fillStyle = fill; ctx.fill("evenodd"); }
          if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); }
        }
      }
    };
    outline("#f4f7f9", null);
    // Points sit on a 3° lattice, so each square covers its share of the map.
    points.forEach(([lat, lon], k) => {
      const slope = entry.slope[k];
      if (slope === null) return;
      const [left, top] = project(lon - 1.5, lat + 1.5);
      const [right, bottom] = project(lon + 1.5, lat - 1.5);
      ctx.globalAlpha = entry.significant[k] ? 1 : 0.3;
      ctx.fillStyle = `rgb(${stripeColour(scale, slope / entry.scale)})`;
      ctx.fillRect(left, top, right - left + 0.5, bottom - top + 0.5);
    });
    ctx.globalAlpha = 1;
    outline(null, "#7f93a6");
    if (site) {
      const [x, y] = project(site.longitude, site.latitude);
      ctx.strokeStyle = "#0f2338";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  function choosePoint(latitude, longitude) {
    const target = pointSite(latitude, longitude);
    if (target) selectSite(target);
    else setRegionStatus("There’s no land data near that spot. NASA’s land records cover land only, so pick a point on a continent.");
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
    for (let lat = Math.ceil(frame.south / 10) * 10; lat <= frame.north; lat += 10) {
      ctx.moveTo(...project(frame.west, lat));
      ctx.lineTo(...project(frame.east, lat));
    }
    for (let lon = Math.ceil(frame.west / 10) * 10; lon <= frame.east; lon += 10) {
      ctx.moveTo(...project(lon, frame.north));
      ctx.lineTo(...project(lon, frame.south));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#f8fafb";
    ctx.strokeStyle = "#9fb0c0";
    ctx.lineWidth = 0.9;
    for (const country of window.WORLD_MAP?.countries || []) {
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
      byId("result-headline").textContent = `${variable.name} ${data.sites.includes(site) ? "in" : "at"} ${site.name} ${{
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
        ? `No clear trend yet. The trend line moves ${total} from ${firstYear} to ${lastYear}, but the ups and downs between years are big enough to hide a steady change.`
        : `${meaning || `Annual ${variable.name.toLowerCase()} was ${trend.verdict === "rising" ? "higher" : "lower"} toward the end of the record.`} From ${firstYear} to ${lastYear} the trend line moves ${total}.`;
      byId("trend-chance").textContent = `If nothing were really changing, a trend this strong would show up by chance ${chanceText(trend.adjustedPValue)}.`;
      renderAgreement(variable);
      updateView();
      renderForecast(variable);
    }
    updateOverview();
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
      else if (target === byId("trend-map-stage")) drawTrendMap();
      else if (liveStripes.has(target)) drawStripes(target, ...liveStripes.get(target));
    }
  });
  explorer.hidden = false;
  renderSiteList();
  renderMap();
  setRegionStatus("Pick a study area, click the map, or try an example above to load a place.");
  retryRegion.addEventListener("click", () => selectSite(site));

  for (const example of examples) {
    const item = create("li", "", "example");
    const button = create("button", "Investigate", "button primary small");
    button.addEventListener("click", () => {
      const target = example.site();
      if (!target) {
        setRegionStatus("This example’s data isn’t in the database yet. Try another example.");
        return;
      }
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

  // Hero and example stripes are bundled (featured-stripes.js), so the page shows real data at once.
  for (const example of examples) {
    const values = featured[example.preview[0]];
    if (values?.length) showStripes(example.canvas, values, example.preview[1]);
  }
  const values = featured["ontario-T2M"];
  if (values?.length) {
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
  } else {
    byId("hero-stripes").hidden = true;
  }
  byId("map-stage").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const rect = map.getBoundingClientRect();
    const [longitude, latitude] = mapProjection(rect.width, rect.height).invert(event.clientX - rect.left, event.clientY - rect.top);
    choosePoint(latitude, longitude);
  });
  byId("point-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const { latitude, longitude } = event.target.elements;
    choosePoint(latitude.valueAsNumber, longitude.valueAsNumber);
  });

  observer.observe(byId("hero-stripes"));
  observer.observe(byId("map-stage"));
  observer.observe(byId("chart-stage"));
  observer.observe(byId("forecast-stage"));
  observer.observe(byId("trend-map-stage"));
  renderTrendMap();
  byId("trend-map").addEventListener("click", (event) => {
    const rect = byId("trend-map").getBoundingClientRect();
    const [longitude, latitude] = mapProjection(rect.width, rect.height, mapFrames.World)
      .invert(event.clientX - rect.left, event.clientY - rect.top);
    choosePoint(latitude, longitude);
  });
})();
