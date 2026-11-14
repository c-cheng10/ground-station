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

  const years = Array.from({ length: data.endYear - data.startYear + 1 }, (_, index) => data.startYear + index);
  const variableIds = data.variables.map(({ id }) => id);
  const regionResults = byId("region-results");
  const regionStatus = byId("region-status");
  const regionMessage = byId("region-message");
  const retryRegion = byId("retry-region");
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

  function setRegionStatus(message, canRetry = false) {
    regionMessage.textContent = message;
    regionStatus.hidden = !message;
    retryRegion.hidden = !canRetry;
  }

  function adjustRegionTests(series) {
    const trends = Object.values(series).map(({ trend }) => trend).sort((left, right) => left.pValue - right.pValue);
    let adjustedP = 0;
    trends.forEach((trend, index) => {
      adjustedP = Math.min(1, Math.max(adjustedP, (trends.length - index) * trend.pValue));
      trend.adjustedPValue = adjustedP;
      trend.verdict = adjustedP <= 0.05 ? (trend.slope > 0 ? "rising" : "falling") : "inconclusive";
    });
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
    setRegionStatus(`Loading ${nextSite.name} from NASA POWER…`);
    try {
      const records = await PowerData.loadRegion(nextSite, data.startYear, data.endYear, variableIds, { signal: request.signal });
      if (regionRequest !== request) return;
      analysis = TrendStatistics.analyseRegion(records, years, variableIds, data.baselineStart, data.baselineEnd);
      adjustRegionTests(analysis.series);
      regionResults.hidden = false;
      setRegionStatus("");
      renderDetails();
    } catch (error) {
      if (regionRequest !== request) return;
      analysis = null;
      regionResults.hidden = true;
      console.warn("Region data load failed", error);
      // POWER fills land-only variables (soil, evaporation) with -999 over water.
      if (!data.sites.includes(nextSite) && /did not return/.test(error.message)) {
        setRegionStatus(`NASA POWER has no complete land record around ${nextSite.name}. Soil and evaporation data stop at coasts and oceans, so choose a point farther inland.`);
      } else {
        setRegionStatus(`Could not load ${nextSite.name} from NASA POWER. Check your connection and try again.`, true);
      }
    } finally {
      if (regionRequest === request) regionRequest = null;
    }
  }

  function updateSiteButtons() {
    for (const button of document.querySelectorAll("button[data-site]")) {
      button.setAttribute("aria-pressed", String(button.dataset.site === site?.id));
    }
  }

  function renderSiteList() {
    const buttons = data.sites.filter((item) => item.continent === mapContinent).map((item) => {
      const button = create("button");
      button.dataset.site = item.id;
      button.append(create("strong", item.name), create("small", item.region));
      button.addEventListener("click", () => selectSite(item));
      return button;
    });
    byId("site-list").replaceChildren(...buttons);
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
    ctx.strokeStyle = "#bdcfcc";
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

    ctx.fillStyle = "#eef1e4";
    ctx.strokeStyle = "#8fa793";
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

    const areas = data.sites.filter((item) => item.continent === mapContinent);
    if (site && !data.sites.includes(site)) areas.push(site);
    for (const item of areas) {
      const { west, east, south, north } = item.bounds;
      const [left, top] = project(west, north);
      const [right, bottom] = project(east, south);
      const selected = item.id === site?.id;
      ctx.strokeStyle = selected ? "#a74824" : "#23654f";
      ctx.fillStyle = selected ? "#bc61365e" : "#23654f42";
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
    for (const item of data.sites.filter((item) => item.continent === mapContinent)) {
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
    return `${item.region} · ${latLon(item)} · ${item.cellCount} grid cells`;
  }

  function trendUnit(variable) {
    return variable.trendUnit === "pp" ? "percentage points" : variable.trendUnit || variable.unit;
  }

  function updateOverview() {
    byId("overview-title").textContent = `All trends in ${site.name}`;
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
        const r = analysis.correlations[first.id][second.id];
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
    byId("variables-title").textContent = site.name;
    const variables = data.variables.filter((variable) => selectedIds.has(variable.id));
    for (const [id, button] of optionButtons) button.setAttribute("aria-pressed", String(selectedIds.has(id)));
    const comparing = variables.length > 1;
    byId("compare-toggle").setAttribute("aria-pressed", String(compareMode));
    byId("variable-hint").textContent = compareMode ? "Choose two or more variables to see how they move together." : "Choose a variable to see its trend.";
    byId("single-report").hidden = comparing;
    byId("correlations").hidden = !comparing;
    if (comparing) {
      renderCorrelations(variables);
    } else {
      const variable = variables[0];
      const trend = analysis.series[variable.id].trend;
      const unit = trendUnit(variable);
      byId("chart-title").textContent = `${variable.name} (${variable.unit})`;
      byId("variable-description").textContent = variable.description;
      byId("site-description").textContent = coordinates(site);
      const verdict = byId("trend-verdict");
      verdict.dataset.state = trend.verdict;
      verdict.textContent = verdictLabels[trend.verdict];
      byId("trend-slope").textContent = `${format(trend.slope, variable.decimals, true)} ${unit}`;
      byId("trend-ci").textContent = `${format(trend.ciLow, variable.decimals, true)} to ${format(trend.ciHigh, variable.decimals, true)} ${unit}`;
      byId("trend-p").textContent = trend.adjustedPValue < 0.001 ? "<0.001" : format(trend.adjustedPValue, 3);
      const meaning = trend.verdict === "rising" ? risingMeans[variable.id] : fallingMeans[variable.id];
      byId("trend-meaning").textContent = trend.verdict === "inconclusive"
        ? "The record leaves the direction of change uncertain."
        : meaning || `Annual ${variable.name.toLowerCase()} was ${trend.verdict === "rising" ? "higher" : "lower"} toward the end of the record.`;
      updateView();
    }
    updateOverview();
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
    const values = series[chartViews[view].field];
    const { trend } = series;
    const annual = view === "annual";
    const endpoints = annual ? [trend.startValue, trend.endValue] : view === "anomaly" ? [0] : [];
    const { floor, ceiling, decimals, ticks } = axisScale(values, endpoints);
    ctx.font = "12px Inter, system-ui, sans-serif";
    const left = Math.max(29, ...ticks.map((tick) => ctx.measureText(format(tick, decimals)).width + 12));
    const right = width - 18;
    const top = 12;
    const bottom = height - 30;
    const x = (index) => left + (right - left) * index / (values.length - 1);
    const y = (value) => bottom - (bottom - top) * (value - floor) / (ceiling - floor);
    chartLayout = { left, right, length: values.length };

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#d7dfd5";
    ctx.fillStyle = "#4b6258";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of ticks) {
      const yPos = y(tick);
      ctx.strokeStyle = view === "anomaly" && Math.abs(tick) < 1e-9 ? "#82978a" : "#d7dfd5";
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

    ctx.strokeStyle = "#187a63";
    ctx.lineWidth = 2.1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();

    if (annual) {
      ctx.strokeStyle = "#aa4924";
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
      ctx.strokeStyle = "#8fa793";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPos, top);
      ctx.lineTo(xPos, bottom);
      ctx.stroke();
      ctx.fillStyle = "#187a63";
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
  byId("coverage").textContent = `${data.startYear}–${data.endYear} · ${data.sites.length} study areas · ${data.variables.length} variables`;
  setSource("data-source", data.sourceUrl);
  setSource("method-source", data.methodUrl);
  explorer.hidden = false;
  renderSiteList();
  renderMap();
  setRegionStatus("Choose a study area, or click anywhere on the map, to load its NASA POWER records.");
  retryRegion.addEventListener("click", () => selectSite(site));
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

  const observer = new ResizeObserver((entries) => {
    if (entries.some(({ target }) => target === byId("map-stage"))) drawMap();
    if (entries.some(({ target }) => target === byId("chart-stage"))) drawChart();
  });
  observer.observe(byId("map-stage"));
  observer.observe(byId("chart-stage"));
})();
