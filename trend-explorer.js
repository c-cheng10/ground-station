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
  const pointId = ({ latitude, longitude }) => `${latitude},${longitude}`;
  const gridSpacing = 3;
  const sourceCellHalfSize = 0.125;
  const sampleCountries = new Map();
  const pointIds = new Set(points.map(([lat, lon]) => `${lat},${lon}`));
  const storedSites = data.sites.filter((item) => pointIds.has(pointId(item)));

  const verdictLabels = {
    rising: "Rising",
    falling: "Falling",
    inconclusive: "No clear trend",
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
      title: "Is Southern Ontario warming?",
      photo: "ontario-shore.webp",
      stripeKey: "ontario-T2M",
      crop: "center 72%",
      look: "Compare the stripes at the start and end of the record. Check the estimated rate of change and what each trend test found.",
      site: () => storedSites.find(({ id }) => id === "southern-ontario"),
      ids: ["T2M"],
    },
    {
      title: "Is the Sahel getting wetter?",
      photo: "niger-dunes.webp",
      stripeKey: "sahel-PRECTOTCORR",
      look: "Read the estimated rate of change and its uncertainty. Check the dates covered by each measurement before comparing trends.",
      site: () => pointIds.has("14.125,1.875") ? pointSite(14.125, 1.875) : null,
      ids: ["PRECTOTCORR"],
    },
    {
      title: "Does wetter soil follow rain?",
      photo: "ontario-fields.webp",
      stripeKey: "ontario-PRECTOTCORR",
      crop: "center 82%",
      look: "Compare precipitation and root-zone soil moisture at zero lag and one month. The two records overlap from 1998 to 2014. How does the correlation change?",
      site: () => storedSites.find(({ id }) => id === "southern-ontario"),
      ids: ["PRECTOTCORR", "GWETROOT"],
    },
  ];
  let story = null;
  // Canvases that show static stripes, redrawn whenever they resize.
  const liveStripes = new Map();

  const regionResults = byId("region-results");
  const regionStatus = byId("region-status");
  const regionMessage = byId("region-message");
  const retryRegion = byId("retry-region");
  const refreshGiovanni = byId("refresh-giovanni");
  const refreshStatus = byId("refresh-status");
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
  const mapVariable = byId("map-variable");
  const compareToggle = byId("compare-toggle");
  const compareVariable = byId("compare-variable");
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

  function drawStripes(canvas, values, variableId, firstYear) {
    const drawing = prepareCanvas(canvas);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const bandHeight = firstYear === undefined ? height : height - 24;
    const stripeWidth = width / values.length;
    const scale = stripeScales[variableId] || stripeScales.T2M;
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    // Saturate at 2.2 standard deviations, close to the published warming-stripes scale.
    const spread = 2.2 * Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length) || 1;
    values.forEach((value, index) => {
      const t = Math.max(-1, Math.min(1, (value - mean) / spread));
      const end = t < 0 ? scale.low : scale.high;
      const rgb = end.map((channel) => Math.round(247 + (channel - 247) * Math.abs(t)));
      ctx.fillStyle = `rgb(${rgb})`;
      // Overlap by a pixel so no hairline gaps show between stripes.
      ctx.fillRect(Math.floor(index * stripeWidth), 0, Math.ceil(stripeWidth) + 1, bandHeight);
    });
    if (firstYear !== undefined) drawStripeYears(ctx, width, bandHeight, firstYear, values.length);
  }

  function drawStripeYears(ctx, width, bandHeight, firstYear, count) {
    const lastYear = firstYear + count - 1;
    const stepWidth = width / count;
    const tickX = (year) => (year - firstYear + 0.5) * stepWidth;
    ctx.font = '12px "Space Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#a5b8c3";
    ctx.strokeStyle = "#637986";
    const labelWidth = ctx.measureText(String(lastYear)).width;
    const labelGap = labelWidth + 8;
    const inset = labelWidth / 2 + 1;
    const labelX = (year) => Math.max(inset, Math.min(width - inset, tickX(year)));
    const interval = [1, 2, 5, 10, 20, 50, 100].find((years) => years * stepWidth >= labelGap) ?? 100;
    const years = [firstYear];
    for (let year = Math.ceil((firstYear + 1) / interval) * interval; year < lastYear; year += interval) {
      if (labelX(year) - labelX(years.at(-1)) >= labelGap && labelX(lastYear) - labelX(year) >= labelGap) years.push(year);
    }
    if (labelX(lastYear) - labelX(firstYear) >= labelGap) years.push(lastYear);
    ctx.beginPath();
    ctx.moveTo(0, bandHeight + 0.5);
    ctx.lineTo(width, bandHeight + 0.5);
    for (const year of years) {
      ctx.moveTo(tickX(year), bandHeight + 0.5);
      ctx.lineTo(tickX(year), bandHeight + 5);
      ctx.fillText(String(year), labelX(year), bandHeight + 8);
    }
    ctx.stroke();
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
  async function loadPoints(ids, signal) {
    const url = new URL("/rest/v1/climate_points", data.supabaseUrl);
    const filter = ids.length === 1 ? `eq.${ids[0]}` : `in.(${ids.map((id) => JSON.stringify(id)).join(",")})`;
    url.search = new URLSearchParams({ id: filter, select: "*" });
    const response = await fetch(url, {
      signal, cache: "no-store",
      headers: { apikey: data.supabaseAnonKey, Authorization: `Bearer ${data.supabaseAnonKey}` },
    });
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
    const rows = await response.json();
    const received = new Set(rows.map(({ id }) => id));
    if (rows.length !== ids.length || !ids.every((id) => received.has(id))) {
      throw new Error("Some selected grid points did not return a stored record.");
    }
    return rows;
  }

  async function loadPoint(point, signal) {
    const [row] = await loadPoints([pointId(point)], signal);
    return row;
  }

  async function loadArea(ids, signal, onProgress = () => {}) {
    const columns = [...data.variables, data.compare].filter(Boolean).map(({ id }) => id.toLowerCase());
    const totals = columns.map(() => []);
    const counts = columns.map(() => []);
    let offset = 0;
    let loaded = 0;
    const readBatches = async () => {
      while (offset < ids.length && !signal.aborted) {
        const batch = ids.slice(offset, offset + 40);
        offset += batch.length;
        const rows = await loadPoints(batch, signal);
        for (const row of rows) {
          columns.forEach((column, index) => {
            row[column]?.forEach((value, month) => {
              if (!Number.isFinite(value)) return;
              totals[index][month] = (totals[index][month] ?? 0) + value;
              counts[index][month] = (counts[index][month] ?? 0) + 1;
            });
          });
        }
        loaded += batch.length;
        if (!signal.aborted) onProgress(loaded);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, Math.ceil(ids.length / 40)) }, readBatches));
    } catch (error) {
      offset = ids.length;
      throw error;
    }
    signal.throwIfAborted();
    // A month has a mean only when the same set of grid points contributes to it.
    return Object.fromEntries(columns.map((column, index) => [column,
      Array.from(totals[index], (sum, month) => counts[index][month] === ids.length ? sum / ids.length : null),
    ]));
  }

  // Choose the longest uninterrupted run of complete years, breaking ties with the newest one.
  function completeYearRun(values) {
    const totalYears = Math.floor(values.length / 12);
    let best = [0, 0];
    let start = 0;
    for (let year = 0; year < totalYears; year += 1) {
      const months = values.slice(year * 12, (year + 1) * 12);
      if (months.length !== 12 || !months.every(Number.isFinite)) {
        start = year + 1;
      } else if (year + 1 - start >= best[1] - best[0]) {
        best = [start, year + 1];
      }
    }
    return best;
  }

  // Measurements come from different NASA datasets, so each is analysed over its own complete years.
  function analyseRow(row) {
    const series = {};
    const residuals = {};
    const starts = {};
    for (const variable of data.variables) {
      const values = row[variable.id.toLowerCase()] ?? [];
      const [firstYear, endYear] = completeYearRun(values);
      if (endYear - firstYear < 4) continue;
      const monthly = values.slice(firstYear * 12, endYear * 12);
      const span = Array.from({ length: endYear - firstYear }, (_, k) => data.startYear + firstYear + k);
      const annual = span.map((_, k) => monthly.slice(k * 12, k * 12 + 12).reduce((a, b) => a + b, 0) / 12);
      const result = TrendStatistics.analyseRegion({ annual: { [variable.id]: annual }, monthly: { [variable.id]: monthly } },
        span, [variable.id], span[0], span.at(-1));
      const fitted = result.series[variable.id];
      const extra = values.slice(endYear * 12, values.findLastIndex(Number.isFinite) + 1);
      // Include newer observations in monthly views while fitting trends to complete years.
      const seasonalMean = fitted.monthlyValues.slice(0, 12).map((value, month) => value - fitted.monthlyAnomalies[month]);
      series[variable.id] = {
        ...fitted,
        firstYear: span[0], lastYear: span.at(-1),
        monthlyValues: [...fitted.monthlyValues, ...extra],
        monthlyAnomalies: [...fitted.monthlyAnomalies, ...extra.map((value, index) =>
          Number.isFinite(value) ? value - seasonalMean[index % 12] : null)],
      };
      residuals[variable.id] = result.residuals[variable.id];
      starts[variable.id] = firstYear * 12;
    }
    adjustRegionTests(series);
    return { series, residuals, starts, row };
  }

  async function selectSite(nextSite) {
    if (regionRequest && site.id === nextSite.id) {
      openDrawer();
      if (nextSite.mapAnchor) {
        site.mapAnchor = nextSite.mapAnchor;
        flyTo(focusZoom(site));
      }
      return;
    }
    regionRequest?.abort();
    const request = new AbortController();
    regionRequest = request;
    site = nextSite;
    if (!site.platformCountries) site.platformCountries = selectedCountries(site);
    if (!site.selectionSegments) {
      const cells = site.areaIds?.map((id) => id.split(",").map(Number)) ?? [[site.latitude, site.longitude]];
      const bounds = site.platformCountries.length ? site.platformCountries : countries;
      site.selectionSegments = window.selectionOutline(cells, bounds, gridSpacing);
    }
    deselectButton.hidden = false;
    analysis = null;
    delete regionResults.dataset.site;
    delete regionResults.dataset.point;
    refreshGiovanni.disabled = false;
    refreshStatus.textContent = "";
    chartLayout = null;
    byId("drawer-place").textContent = nextSite.name;
    byId("site-description").textContent = coordinates(nextSite);
    byId("story").hidden = true;
    byId("point-tools").hidden = true;
    byId("point-tools").open = false;
    explorer.scrollTop = 0;
    mapVariable.value = trendMapVariable().id;
    openDrawer();
    if (nextSite.keepCamera) drawTrendMap();
    else flyTo(focusZoom(nextSite));
    regionResults.hidden = true;
    setRegionStatus(`Loading NASA data for ${nextSite.name}…`, false, true);
    try {
      const row = nextSite.areaIds ? await loadArea(nextSite.areaIds, request.signal, (loaded) => {
        regionMessage.textContent = `Loading NASA data from ${format(loaded, 0)} of ${format(nextSite.areaIds.length, 0)} grid points…`;
      }) : await loadPoint(nextSite, request.signal);
      if (regionRequest !== request) return;
      analysis = analyseRow(row);
      if (!Object.keys(analysis.series).length) {
        setRegionStatus(nextSite.areaIds
          ? "No measurement has four consecutive complete years shared by all selected points. Try a smaller area."
          : `No measurement has four consecutive complete years at ${nextSite.name}.`);
        return;
      }
      regionResults.dataset.site = nextSite.id;
      if (!nextSite.areaIds) regionResults.dataset.point = row.id;
      byId("point-tools").hidden = Boolean(nextSite.areaIds);
      regionResults.hidden = false;
      setRegionStatus("");
      renderDetails();
      return analysis;
    } catch (error) {
      if (regionRequest !== request) return;
      request.abort();
      console.warn("Climate data load failed", error);
      setRegionStatus(`The stored data for ${nextSite.name} didn’t load. Check your internet connection, then try again.`, true);
    } finally {
      if (regionRequest === request) regionRequest = null;
    }
  }

  async function refreshPoint() {
    if (!analysis || site.areaIds || regionRequest) return;
    const selectedSite = site;
    const request = new AbortController();
    regionRequest = request;
    refreshGiovanni.disabled = true;
    refreshStatus.textContent = "Checking Giovanni for new months…";
    try {
      const response = await fetch(new URL("/functions/v1/refresh-climate-giovanni", data.supabaseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${data.supabaseAnonKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ point_id: analysis.row.id }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Could not refresh Giovanni data. Try again.");
      if (!Number.isInteger(result?.added_values) || result.added_values < 0 ||
          !Number.isInteger(result.added_months) || result.added_months < 0) {
        throw new Error("Giovanni refresh returned an invalid result.");
      }
      if (regionRequest !== request) return;
      const partial = Array.isArray(result.unavailable_variables) && result.unavailable_variables.length > 0;
      if (result.added_values === 0) {
        refreshStatus.textContent = partial
          ? "Giovanni did not return every measurement. No new values were saved."
          : "Giovanni has no new months for this point.";
        return;
      }
      const latest = Number.isInteger(result.latest_month) && result.latest_month % 100 >= 1 && result.latest_month % 100 <= 12
        ? ` Latest: ${monthFormat.format(new Date(Date.UTC(Math.floor(result.latest_month / 100), result.latest_month % 100 - 1)))}.`
        : "";
      const saved = `Saved ${result.added_values} values across ${monthsText(result.added_months)}.${latest}`;
      refreshStatus.textContent = partial ? `${saved} Some measurements were unavailable.` : saved;
      let row;
      try {
        row = await loadPoint(selectedSite, request.signal);
      } catch {
        if (regionRequest === request) refreshStatus.textContent += " Reopen this point to reload the charts.";
        return;
      }
      if (regionRequest !== request) return;
      analysis = analyseRow(row);
      renderDetails();
    } catch (error) {
      if (regionRequest === request) {
        refreshStatus.textContent = error.name === "TimeoutError" ? "Giovanni refresh timed out. Try again." : error.message;
      }
    } finally {
      if (regionRequest === request) {
        regionRequest = null;
        refreshGiovanni.disabled = false;
      }
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
    const named = storedSites.find((point) => pointId(point) === pointId(item));
    if (named) return named;
    return {
      ...item,
      id: `point:${best[0]},${best[1]}`,
      name: countryAt(best[0], best[1]) || latLon(item),
      region: "Nearest NASA grid point",
      bounds: { south: best[0] - sourceCellHalfSize, north: best[0] + sourceCellHalfSize,
        west: best[1] - sourceCellHalfSize, east: best[1] + sourceCellHalfSize },
    };
  }

  function stripeColour(scale, t) {
    const end = t < 0 ? scale.low : scale.high;
    return end.map((channel) => Math.round(247 + (channel - 247) * Math.min(1, Math.abs(t))));
  }

  function inCountry(country, latitude, longitude) {
    const containsPoint = (ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[j];
        if ((y1 > latitude) !== (y2 > latitude) && longitude < x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)) inside = !inside;
      }
      return inside;
    };
    return country.polygons.some(([outline, ...holes]) => containsPoint(outline) && !holes.some(containsPoint));
  }

  function countryForSample(latitude, longitude) {
    const id = `${latitude},${longitude}`;
    if (sampleCountries.has(id)) return sampleCountries.get(id);
    let match = countries.find((country) => inCountry(country, latitude, longitude));
    if (!match && pointIds.has(id)) {
      // A simplified coastline can miss a land sample. Limit the fallback to half a source cell diagonal.
      let closest = sourceCellHalfSize * Math.hypot(1, Math.cos(latitude * radians));
      for (const country of countries) {
        const offset = nearestBorderOffset(country, latitude, longitude, closest);
        if (!offset) continue;
        match = country;
        closest = Math.hypot(...offset);
      }
    }
    sampleCountries.set(id, match ?? null);
    return match ?? null;
  }

  function countryAt(latitude, longitude) {
    return countryForSample(latitude, longitude)?.name ?? null;
  }

  function selectedCountries(target) {
    const coordinates = target.areaIds ? target.areaIds.map((id) => id.split(",").map(Number)) :
      [[target.latitude, target.longitude]];
    const sampled = new Set(coordinates.map(([lat, lon]) => countryForSample(lat, lon)));
    return countries.filter((country) => sampled.has(country) ||
      target.outline?.some(([lon, lat]) => inCountry(country, lat, lon)));
  }

  function distanceKm(latitude, longitude, lat, lon) {
    const radians = Math.PI / 180;
    const arc = Math.sin((lat - latitude) * radians / 2) ** 2 +
      Math.cos(latitude * radians) * Math.cos(lat * radians) * Math.sin((lon - longitude) * radians / 2) ** 2;
    return 12_742 * Math.asin(Math.min(1, Math.sqrt(arc)));
  }

  const signedLongitude = (difference) => ((difference + 540) % 360) - 180;

  function isInDirection(direction, north, east) {
    const axis = { north, south: -north, east, west: -east }[direction];
    return axis > 0 && axis >= Math.abs(direction === "north" || direction === "south" ? east : north);
  }

  function nearestBorderOffset(country, lat, lon, closest) {
    const longitudeScale = Math.cos(lat * Math.PI / 180);
    let delta = null;
    for (const [outline] of country.polygons) {
      for (let index = 0; index < outline.length; index += 1) {
        const [lonA, latA] = outline[index];
        const [lonB, latB] = outline[(index + 1) % outline.length];
        const ax = signedLongitude(lonA - lon) * longitudeScale;
        const ay = latA - lat;
        const dx = signedLongitude(lonB - lonA) * longitudeScale;
        const dy = latB - latA;
        const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const east = -(ax + fraction * dx);
        const north = -(ay + fraction * dy);
        const distance = Math.hypot(east, north);
        if (distance < closest) {
          closest = distance;
          delta = [north, east];
        }
      }
    }
    return delta;
  }

  function outsideCountryInDirection(country, direction, lat, lon) {
    const delta = nearestBorderOffset(country, lat, lon, 500 / 111);
    return delta && isInDirection(direction, ...delta);
  }

  function assistantArea(place) {
    const { country, direction, interior } = place;
    const name = place.displayName ?? country?.name ?? place.name;
    let { latitude, longitude } = place;
    let selected;
    let distance;
    if (country) {
      const inside = points.filter(([lat, lon]) => inCountry(country, lat, lon));
      selected = inside;
      if (direction && !interior) {
        const insideSet = new Set(inside);
        selected = points.filter((coords) => !insideSet.has(coords) && outsideCountryInDirection(country, direction, ...coords));
      } else if (direction && inside.length) {
        const axis = direction === "north" || direction === "south" ? 0 : 1;
        const values = inside.map((coords) => coords[axis]);
        const middle = (Math.min(...values) + Math.max(...values)) / 2;
        const sign = direction === "north" || direction === "east" ? 1 : -1;
        selected = inside.filter((coords) => sign * (coords[axis] - middle) >= 0);
      }
      if (!selected.length) return null;
      const latitudes = selected.map(([lat]) => lat);
      const longitudes = selected.map(([, lon]) => lon);
      latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
      longitude = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
    } else {
      const nearby = points.map((coords) => ({ coords, km: distanceKm(latitude, longitude, ...coords) }))
        .filter(({ coords: [lat, lon], km }) => km <= 700 && (!direction ||
          isInDirection(direction, lat - latitude, signedLongitude(lon - longitude) * Math.cos(latitude * Math.PI / 180))))
        .sort((a, b) => a.km - b.km).slice(0, 5);
      if (!nearby.length || (!direction && nearby[0].km > 350)) return null;
      selected = nearby.map(({ coords }) => coords);
      distance = Math.ceil(nearby.at(-1).km);
    }
    const areaIds = selected.map(([lat, lon]) => `${lat},${lon}`);
    return { id: `assistant:${name}:${latitude},${longitude}`, name, latitude, longitude, areaIds, distance,
      outsideBorder: Boolean(country && direction && !interior) };
  }

  window.answerClimateArea = async (question, place) => {
    const target = place ? (place.id ? place : assistantArea(place)) : (site?.areaIds || question.kind === "trend") && site;
    if (!target) return place ? { status: "outside_coverage" } : null;
    const { ids, lag } = question;
    compareMode = ids.length === 2;
    selectedIds = new Set(ids);
    byId("lag").value = lag;
    if (site !== target || !analysis) {
      if (!await selectSite(target)) return { status: "unavailable" };
    } else {
      openDrawer();
      explorer.scrollTop = 0;
      renderDetails();
    }
    const { series, residuals, starts } = analysis;
    const [first, second] = ids;
    const scope = { name: target.name, count: target.areaIds?.length ?? 1, distance: target.distance,
      outsideBorder: target.outsideBorder };
    if (ids.some((id) => !series[id])) return { status: "no_data", ...scope };
    if (!second) return { status: "trend", ...scope, ...series[first] };
    const from = Math.max(starts[first], starts[second] - lag);
    const to = Math.min(starts[first] + residuals[first].length, starts[second] + residuals[second].length - lag);
    if (to - from < 24) return { status: "no_data", ...scope };
    const r = TrendStatistics.monthlyCorrelations(residuals, ids, lag, starts)[first][second];
    return { status: "correlation", ...scope, r, from, to };
  };

  window.selectAssistantPoint = ({ lat, lon, variable_x, variable_y, lag_months }) => {
    if (!pointIds.has(`${lat},${lon}`)) return null;
    const target = pointSite(lat, lon);
    const ids = [variable_x.toUpperCase(), variable_y.toUpperCase()];
    compareMode = ids[0] !== ids[1];
    selectedIds = new Set(ids);
    byId("lag").value = lag_months;
    return selectSite(target);
  };

  function trendMapVariable() {
    return data.variables.find((item) => item.id === [...selectedIds][0]) || data.variables[0];
  }

  function renderTrendMap() {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    mapVariable.value = variable.id;
    if (!entry) return;
    const unit = `${trendUnit(variable)} per decade`;
    byId("trend-map-sub").textContent = `${variable.name}, ${entry.years[0]}–${entry.years[1]}, from ${variable.source}.`;
    byId("trend-ramp").parentElement.hidden = !heatVisible;
    const note = byId("heatmap-note");
    if (note) note.textContent = heatVisible ? "Fainter colour marks weaker evidence or the edge of coverage." : "Heatmap off. You can still select grid points.";
    byId("trend-low").textContent = `${format(-entry.scale, variable.decimals + 1, true)}`;
    byId("trend-high").textContent = `${format(entry.scale, variable.decimals + 1, true)} ${unit}`;
    runLensChange();
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

  function choosePoint(latitude, longitude, useGridCell = false) {
    const sample = useGridCell ? points[gridPointIndex(latitude, longitude)] : [latitude, longitude];
    const target = sample && pointSite(...sample);
    if (target) {
      selectSite(useGridCell ? { ...target, mapAnchor: [longitude, latitude] } : target);
      return;
    }
    regionRequest?.abort();
    regionRequest = null;
    site = null;
    deselectButton.hidden = true;
    analysis = null;
    chartLayout = null;
    delete regionResults.dataset.site;
    delete regionResults.dataset.point;
    byId("drawer-place").textContent = useGridCell ? "No data for this cell" : "No land data here";
    byId("site-description").textContent = "";
    regionResults.hidden = true;
    byId("story").hidden = true;
    byId("point-tools").hidden = true;
    openDrawer();
    flyTo(mapView.zoom);
    setRegionStatus(useGridCell
      ? "There’s no stored NASA point for this 3° cell. Select a nearby cell or use Magic select to cover more ground."
      : "No stored Giovanni point is close enough. Choose a place near a coloured part of the globe.");
  }

  function latLon(item) {
    const latitude = `${format(Math.abs(item.latitude), 1)}° ${item.latitude < 0 ? "S" : "N"}`;
    const longitude = `${format(Math.abs(item.longitude), 2)}° ${item.longitude < 0 ? "W" : "E"}`;
    return `${latitude}, ${longitude}`;
  }

  function coordinates(item) {
    if (item.areaIds) {
      const count = item.areaIds.length;
      const distance = item.distance ? ` within ${format(item.distance, 0)} km of the city` :
        item.outsideBorder ? " within about 500 km of the border" : "";
      return `Monthly average across ${format(count, 0)} NASA grid ${count === 1 ? "point" : "points"}${distance}. Each month uses the same points.`;
    }
    return `${item.region} at ${latLon(item)}. Each source uses its own grid resolution.`;
  }

  function trendUnit(variable) {
    return variable.trendUnit === "pp" ? "percentage points" : variable.trendUnit || variable.unit;
  }

  function renderCorrelations(variables) {
    const lag = byId("lag").valueAsNumber;
    const correlations = TrendStatistics.monthlyCorrelations(analysis.residuals, variables.map(({ id }) => id), lag, analysis.starts);
    byId("lag-value").textContent = lag === 1 ? "1 month" : `${lag} months`;
    byId("lag-note").textContent = lag === 0
      ? "Rows and columns use the same month."
      : `The row measurement comes ${monthsText(lag)} before the column measurement.`;
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
          cell.style.backgroundColor = r < 0 ? `rgba(240, 127, 103, ${alpha})` : `rgba(75, 195, 176, ${alpha})`;
        }
        row.append(cell);
      }
      body.append(row);
    }
    matrix.replaceChildren(head, body);
  }

  function renderDetails() {
    if (!analysis) {
      renderTrendMap();
      return;
    }
    activeIndex = null;
    byId("chart-selection").textContent = "";
    byId("story").hidden = story?.siteId !== site.id;
    const variable = trendMapVariable();
    const series = analysis.series[variable.id];
    const [, otherId] = selectedIds;
    const comparing = Boolean(series && analysis.series[otherId]);
    if (!comparing) selectedIds = new Set([variable.id]);
    regionResults.dataset.variables = series ? [...selectedIds].join(" ") : "";
    renderTrendMap();

    const empty = byId("trend-empty");
    empty.hidden = Boolean(series);
    if (!series) {
      chartLayout = null;
      empty.textContent = `No complete record for ${variable.name.toLowerCase()} here. Choose another heatmap measurement.`;
    }
    let canCompare = false;
    for (const option of compareVariable.options) {
      if (!option.value) continue;
      option.hidden = option.disabled = option.value === variable.id || !analysis.series[option.value];
      canCompare ||= !option.disabled;
    }
    if (!series || !canCompare) compareMode = false;
    byId("compare-panel").hidden = !series;
    compareToggle.disabled = !canCompare;
    compareToggle.textContent = comparing ? "Done" : compareMode ? "Cancel" : "Compare";
    compareToggle.setAttribute("aria-expanded", String(compareMode));
    compareVariable.value = comparing ? otherId : "";
    byId("compare-picker").hidden = !compareMode;
    byId("single-report").hidden = !series || comparing;
    byId("correlations").hidden = !comparing;
    if (comparing) {
      renderCorrelations([variable, data.variables.find(({ id }) => id === otherId)]);
    } else if (series) {
      const { trend, firstYear, lastYear, values } = series;
      const unit = trendUnit(variable);
      byId("chart-title").textContent = `${variable.name} (${variable.unit})`;
      byId("chart-unit").textContent = variable.unit;
      byId("result-headline").textContent = variable.name;
      byId("variable-why").textContent = whyItMatters[variable.id] || "";
      // Say plainly whether a number was measured from space or comes from a model.
      const sourceKinds = {
        "MERRA-2": "NASA weather model built from observations",
        "GLDAS 2.0": "NASA land model driven by observed weather",
        "GPM IMERG": "satellite measurement",
      };
      byId("variable-description").textContent = `${variable.description} Source: ${variable.source}` +
        (sourceKinds[variable.source] ? ` (${sourceKinds[variable.source]}).` : ".");
      const scale = stripeScales[variable.id] || stripeScales.T2M;
      showStripes(byId("result-stripes"), values, variable.id, firstYear);
      byId("stripes-note").textContent = `Each stripe compares one year with the ${firstYear}–${lastYear} average. ${scale.note}`;
      const verdict = byId("trend-verdict");
      verdict.dataset.state = trend.verdict;
      verdict.textContent = verdictLabels[trend.verdict];
      byId("trend-slope").textContent = `${format(trend.slope, variable.decimals, true)} ${unit}`;
      byId("trend-ci").textContent = `${format(trend.ciLow, variable.decimals, true)} to ${format(trend.ciHigh, variable.decimals, true)} ${unit}`;
      byId("trend-p").textContent = pText(trend.adjustedPValue);
      byId("trend-sen").textContent = `${format(trend.senSlope, variable.decimals, true)} ${unit}`;
      byId("trend-mk").textContent = pText(trend.mkAdjustedPValue);
      // Hover notes: where each number comes from and how it was worked out.
      const years = lastYear - firstYear + 1;
      const tested = Object.keys(analysis.series).length;
      const basis = `${years} yearly averages of ${variable.source} data (${firstYear}–${lastYear}), downloaded from NASA Giovanni`;
      const tips = {
        "trend-verdict": `Decided by the adjusted p-value: 0.05 or lower counts as a clear rise or fall. Based on ${basis}.` +
          (trend.verdict === "inconclusive" ? " “No clear trend” doesn’t mean nothing changed. The change is small next to the normal ups and downs between years, so the direction isn’t certain yet." : ""),
        "trend-slope": `The slope of a straight line fitted through ${basis} (least squares), times 10 to give the change per decade.`,
        "trend-ci": `The slope ± about two standard errors (Student’s t with ${years - 2} degrees of freedom). The standard error uses the Newey–West method with 3 years of lag, so years that resemble their neighbours make the range wider.`,
        "trend-p": `Raw p = ${pText(trend.pValue)}, from a t-test of whether the slope differs from zero. It is then raised with the Holm method because ${tested} measurements are tested at this place, so a lucky result is less likely to slip through.`,
        "trend-sen": "The Theil–Sen slope: the median of the slopes between every pair of years, times 10. One extreme year barely moves it.",
        "trend-mk": `The Mann–Kendall test counts how often later years are higher or lower than earlier ones. It is widened with the Hamed–Rao correction when years are clearly linked, then Holm-adjusted across ${tested} measurements. Raw p = ${pText(trend.mkPValue)}.`,
      };
      for (const [id, tip] of Object.entries(tips)) {
        const row = id === "trend-verdict" ? byId(id) : byId(id).parentElement;
        row.dataset.tip = tip;
        row.tabIndex = 0;
      }
      const mkSignificant = trend.mkAdjustedPValue <= 0.05;
      byId("trend-agree").textContent = mkSignificant === (trend.verdict !== "inconclusive")
        ? "The Mann–Kendall test agrees."
        : "The Mann–Kendall test disagrees. Treat this result with caution.";
      // The map judges each square against about 1,700 places; this panel against the 9 measurements
      // here. Both use the same test, but the bar differs, so say so when they land differently.
      const pointIndex = site.areaIds ? -1 : points.findIndex(([lat, lon]) => lat === site.latitude && lon === site.longitude);
      const mapClear = pointIndex >= 0 ? trendMap[variable.id]?.significant[pointIndex] : undefined;
      if (mapClear !== undefined && Boolean(mapClear) !== (trend.verdict !== "inconclusive")) {
        byId("trend-agree").textContent += " The map adjusts for testing many places at once. This panel adjusts for testing several measurements at one place.";
      }
      const meaning = trend.verdict === "rising" ? risingMeans[variable.id] : fallingMeans[variable.id];
      const total = `${format(trend.endValue - trend.startValue, variable.decimals, true)} ${unit}`;
      byId("trend-meaning").textContent = trend.verdict === "inconclusive"
        ? `The fitted change from ${firstYear} to ${lastYear} is ${total}. Year-to-year variation makes the direction uncertain.`
        : `${meaning || `Annual ${variable.name.toLowerCase()} was ${trend.verdict === "rising" ? "higher" : "lower"} toward the end of the record.`} From ${firstYear} to ${lastYear} the trend line moves ${total}.`;
      renderAgreement(variable);
      updateView();
      renderForecast(variable);
    }
  }

  // Air temperature only: compare MERRA-2 with GLDAS 2.1 over the years both cover.
  function renderAgreement(variable) {
    const box = byId("datasets-agree");
    const compare = data.compare;
    const merraValues = analysis.row.t2m;
    const gldasValues = compare && analysis.row[compare.id.toLowerCase()];
    box.hidden = variable.id !== "T2M" || !merraValues || !gldasValues;
    if (box.hidden) return;
    const [first, end] = completeYearRun(merraValues.map((value, index) =>
      Number.isFinite(gldasValues[index]) ? value : null));
    box.hidden = end - first < 4;
    if (box.hidden) return;
    const last = end - 1;
    const yearly = (values) => Array.from({ length: last - first + 1 }, (_, k) =>
      values.slice((first + k) * 12, (first + k + 1) * 12).reduce((a, b) => a + b, 0) / 12);
    const merra = TrendStatistics.mannKendall(yearly(merraValues)).senSlope;
    const gldas = TrendStatistics.mannKendall(yearly(gldasValues)).senSlope;
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
    if (model.startYear !== data.startYear) return null;
    const raw = Object.fromEntries(model.variables.map((id) => [id, analysis.row[id.toLowerCase()]]));
    if (Object.values(raw).some((values) => !Array.isArray(values))) return null;
    // Forecasts start after the last month every forecast measurement has (GPM lags a few months).
    let months = Math.min(model.enso.length, ...Object.values(raw).map((values) => values.length));
    while (months > 0 && Object.values(raw).some((values) => !Number.isFinite(values[months - 1]))) months -= 1;
    const testStart = (model.testYears[0] - model.startYear) * 12;
    const normalStart = (model.normal[0] - model.startYear) * 12;
    const normalEnd = (model.normal[1] - model.startYear + 1) * 12;
    const firstRequired = Math.min(normalStart, testStart - model.recent);
    if (months <= testStart || months < normalEnd || firstRequired < 0 ||
        Object.values(raw).some((values) => !values.slice(firstRequired, months).every(Number.isFinite))) {
      return null;
    }
    const anomalies = TrendStatistics.modelAnomalies(model, raw);
    forecastCache = {
      analysis, anomalies, months, testStart,
      ahead: TrendStatistics.forecast(model, anomalies, site.latitude, months),
      backtest: TrendStatistics.backtest(model, anomalies, site.latitude, testStart, months),
    };
    return forecastCache;
  }

  function renderForecast(variable) {
    const index = model ? model.variables.indexOf(variable.id) : -1;
    const forecast = index < 0 || site.areaIds ? null : forecastData();
    byId("forecast").hidden = !forecast;
    if (!forecast) return;
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
      ? `The dashed line is the forecast for the 12 months after the record ends (${monthFormat.format(new Date(Date.UTC(model.startYear, forecast.months)))} onward), shown as the difference from this point’s ${model.normal.join("–")} normal for that month. The shaded band is where 9 in 10 real months landed during testing. The simple guess it has to beat says each month will match its average over the last 5 years.`
      : `The dashed line shows one-month-ahead predictions for ${model.testYears.join(" to ")} at held-out locations. The anomaly baseline uses ${model.normal.join("–")} and overlaps the first test year.`;
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
    if (!result) return;
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
    ctx.font = '13px "Geist", system-ui, sans-serif';
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
      ctx.strokeStyle = Math.abs(tick) < 1e-9 ? "#637986" : "#293842";
      ctx.beginPath();
      ctx.moveTo(left, y(tick));
      ctx.lineTo(right, y(tick));
      ctx.stroke();
      ctx.fillStyle = "#a5b8c3";
      ctx.fillText(format(tick, decimals), left - 9, y(tick));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < total; i += 1) {
      if ((firstMonth + i) % 12 === 0) ctx.fillText(String(model.startYear + Math.floor((firstMonth + i) / 12)), x(i), bottom + 10);
    }

    if (ahead) {
      ctx.fillStyle = "#ff9c822e";
      ctx.beginPath();
      predicted.forEach((value, k) => ctx[k ? "lineTo" : "moveTo"](x(offset + k), y(value + band[k])));
      for (let k = predicted.length - 1; k >= 0; k -= 1) ctx.lineTo(x(offset + k), y(predicted[k] - band[k]));
      ctx.fill();
      ctx.strokeStyle = "#617485";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x(offset - 0.5), top);
      ctx.lineTo(x(offset - 0.5), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffb19a";
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
    line(actual, 0, "#7cdeec", false);
    // In forecast view the dashed line starts from the last real month so the two join up.
    line(ahead ? [actual.at(-1), ...predicted] : predicted, ahead ? offset - 1 : 0, "#ff9c82", true);
  }

  function updateView() {
    const display = chartViews[view];
    for (const [id, button] of viewButtons) button.setAttribute("aria-pressed", String(id === view));
    byId("legend-value").textContent = display.legend;
    byId("trend-legend").hidden = view !== "annual";
    const note = byId("chart-note");
    const shown = analysis?.series[[...selectedIds][0]];
    const monthlyEnd = shown && monthFormat.format(new Date(Date.UTC(shown.firstYear, shown.monthlyValues.length - 1)));
    note.textContent = view === "anomaly" && shown
      ? `Compared with the average for the same calendar month over ${shown.firstYear}–${shown.lastYear}. Observations through ${monthlyEnd}.`
      : view === "monthly" && shown ? `Observations through ${monthlyEnd}.` : "";
    note.hidden = !note.textContent;
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
    const variable = trendMapVariable();
    const series = analysis.series[variable.id];
    if (!series) return;
    const drawing = prepareCanvas(chart);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    const values = series[chartViews[view].field];
    const { trend } = series;
    const annual = view === "annual";
    const endpoints = annual ? [trend.startValue, trend.endValue] : view === "anomaly" ? [0] : [];
    const { floor, ceiling, decimals, ticks } = axisScale(values.filter(Number.isFinite), endpoints);
    ctx.font = '13px "Geist", system-ui, sans-serif';
    const left = Math.max(29, ...ticks.map((tick) => ctx.measureText(format(tick, decimals)).width + 12));
    const right = width - 18;
    const top = 12;
    const bottom = height - 30;
    const x = (index) => left + (right - left) * index / (values.length - 1);
    const y = (value) => bottom - (bottom - top) * (value - floor) / (ceiling - floor);
    chartLayout = { left, right, length: values.length };

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#293842";
    ctx.fillStyle = "#a5b8c3";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of ticks) {
      const yPos = y(tick);
      ctx.strokeStyle = view === "anomaly" && Math.abs(tick) < 1e-9 ? "#637986" : "#293842";
      ctx.beginPath();
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.stroke();
      ctx.fillText(format(tick, decimals), left - 9, yPos);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const { firstYear } = series;
    const lastYear = annual ? series.lastYear : firstYear + Math.floor((values.length - 1) / 12);
    const years = [firstYear];
    const interval = width < 420 || lastYear - firstYear > 40 ? 20 : 10;
    for (let year = Math.ceil((firstYear + 4) / interval) * interval; year < lastYear - 3; year += interval) years.push(year);
    years.push(lastYear);
    for (const year of years) {
      const index = (year - firstYear) * (annual ? 1 : 12);
      ctx.fillText(String(year), x(index), bottom + 10);
    }

    ctx.strokeStyle = "#7cdeec";
    ctx.lineWidth = 2.1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      if (!Number.isFinite(values[index - 1])) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();

    if (annual) {
      ctx.strokeStyle = "#ff9c82";
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
      const yPos = Number.isFinite(value) ? y(value) : top;
      ctx.strokeStyle = "#617485";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPos, top);
      ctx.lineTo(xPos, bottom);
      ctx.stroke();
      if (Number.isFinite(value)) {
        ctx.fillStyle = "#7cdeec";
        ctx.beginPath();
        ctx.arc(xPos, yPos, 4.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      const period = annual ? series.firstYear + activeIndex : monthFormat.format(new Date(Date.UTC(series.firstYear, activeIndex)));
      const measurement = Number.isFinite(value) ? `${format(value, variable.decimals, view === "anomaly")} ${variable.unit}` : "No observation";
      const label = `${period} · ${measurement}`;
      tooltip.textContent = label;
      tooltip.style.left = `${Math.max(2, Math.min(xPos + 9, width - tooltip.offsetWidth - 2))}px`;
      tooltip.style.top = `${Math.max(0, yPos - 35)}px`;
      if (byId("chart-selection").textContent !== label) byId("chart-selection").textContent = label;
    }
  }

  for (const variable of data.variables) {
    mapVariable.add(new Option(variable.name, variable.id));
    compareVariable.add(new Option(variable.name, variable.id));
  }
  mapVariable.addEventListener("change", () => {
    compareMode = false;
    selectedIds = new Set([mapVariable.value]);
    if (app.hasAttribute("data-drawer")) renderDetails();
    else renderTrendMap();
  });
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
  compareToggle.addEventListener("click", () => {
    compareMode = !compareMode;
    if (!compareMode) selectedIds = new Set([trendMapVariable().id]);
    renderDetails();
    if (compareMode) compareVariable.focus({ preventScroll: true });
  });
  compareVariable.addEventListener("change", () => {
    if (!compareMode || !analysis?.series[compareVariable.value]) return;
    selectedIds = new Set([trendMapVariable().id, compareVariable.value]);
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
      else if (target === byId("trend-map-stage")) {
        drawTrendMap();
        syncStatic();
      }
      else if (liveStripes.has(target)) drawStripes(target, ...liveStripes.get(target));
    }
  });

  // ---- Satellite globe and input ----
  const app = byId("app");
  const stage = byId("trend-map-stage");
  const world = byId("trend-map");
  const effects = byId("globe-effects");
  const mapTip = byId("map-tip");
  const pin = byId("map-pin");
  const areaButton = byId("draw-circle");
  const areaHint = byId("circle-hint");
  const heatButton = byId("toggle-heat");
  const deselectButton = byId("deselect-area");
  const grain = byId("camera-grain");
  const cameraCoordinates = byId("camera-coordinates");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const countries = window.WORLD_MAP.countries;
  const heatPalette = [
    [45, 112, 174], [48, 144, 184], [60, 171, 179], [91, 182, 151], [131, 185, 111],
    [176, 194, 98], [215, 190, 85], [230, 157, 76], [213, 101, 66],
  ];
  const bandStops = heatPalette.map((colour, i) =>
    `rgb(${colour}) ${100 * i / heatPalette.length}% ${100 * (i + 1) / heatPalette.length}%`);
  byId("trend-ramp").style.background = `linear-gradient(90deg, ${bandStops.join(", ")})`;
  const fields = window.createGlobeFields({ countries, points });
  const globe = window.createGlobeView(world, countries, heatPalette);
  if (!globe) {
    byId("data-error").textContent = "This browser couldn’t start the globe. Reload the page or try another browser.";
    byId("data-error").hidden = false;
    return;
  }
  const home = { lat: 17, lon: -18, zoom: 1 };
  const initialOrbitTilt = 0.9;
  const mapView = { ...home, offsetX: 0, offsetY: 0, rise: 0, outlineOpacity: 0,
    cameraFocus: 0, cameraLift: 0, orbitAzimuth: 0, orbitTilt: initialOrbitTilt };
  let heatVisible = true;
  let displayedVariable;
  let lensStarted = 0;
  let lensFrame = 0;
  const sensorSweep = 620;
  let flight = 0;
  let focusAnimation;
  let staticTimer = 0;
  let grainIndex = 0;
  let grainTiles;
  let viewedSite = null;
  let drawingArea = false;
  let magicPath = [];
  let magicPointer = null;
  let magicCentre = null;
  let magicRadius = 34;
  let sparkles = [];
  let sparkleFrame = 0;
  let sparkleSeed = 0;
  const pointers = new Map();
  let drag = null;
  const magicDragThreshold = 6;
  const magicInstructions = "Draw at least three quarters of a circle, then release. Or tap its centre and edge. Keyboard: move with arrows, Enter marks the centre, + or − changes the radius, Enter selects, Esc cancels.";
  const mapSize = () => [world.clientWidth, world.clientHeight];
  const radians = Math.PI / 180;
  const ease = (value) => value * value * (3 - 2 * value);
  const clampZoom = (zoom) => Math.min(8, Math.max(1, zoom));
  const clampLatitude = (latitude) => Math.min(89.9, Math.max(-89.9, latitude));
  const toVector = (lat, lon) => [
    Math.cos(lat * radians) * Math.cos(lon * radians),
    Math.sin(lat * radians),
    Math.cos(lat * radians) * Math.sin(lon * radians),
  ];

  function focusZoom(target) {
    if (!target.areaIds && !target.platformCountries?.length) return Math.max(mapView.zoom, 3.1);
    const angularDistance = (lat, lon) => distanceKm(target.latitude, target.longitude, lat, lon) / 111;
    const samples = (target.areaIds ?? []).map((id) => {
      const [lat, lon] = id.split(",").map(Number);
      return angularDistance(lat, lon);
    });
    let countrySpread = 0;
    for (const country of target.platformCountries ?? []) {
      for (const [outline] of country.polygons) {
        for (const [lon, lat] of outline) countrySpread = Math.max(countrySpread, angularDistance(lat, lon));
      }
    }
    const spread = Math.max(2.5, Math.min(countrySpread, 7), ...samples);
    const [width, height] = mapSize();
    const mobile = width <= 760;
    const visibleWidth = mobile ? width : width - byId("drawer").offsetWidth;
    const visibleHeight = mobile ? height - byId("drawer").offsetHeight - byId("map-toolbar").offsetHeight - 38 : height;
    const available = Math.min(visibleWidth, visibleHeight);
    return clampZoom(globe.zoomFor(spread + 1.25, Math.max(30, available * (mobile ? 0.54 : 0.58))));
  }

  function drawMagicEffects(now) {
    const drawing = prepareCanvas(effects);
    if (!drawing) return;
    const { ctx, width, height } = drawing;
    ctx.clearRect(0, 0, width, height);
    const [cx, cy] = viewCentre();
    if (drawingArea && !magicPath.length && !magicCentre) {
      ctx.strokeStyle = "rgba(244,250,255,.85)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy);
      ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx, cy + 7);
      ctx.stroke();
    }
    if (magicPath.length || magicCentre) {
      ctx.beginPath();
      if (magicPath.length) magicPath.forEach(([x, y], index) => ctx[index ? "lineTo" : "moveTo"](x, y));
      else ctx.arc(...magicCentre, magicRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(174,228,255,.20)";
      ctx.lineWidth = 3.5;
      ctx.shadowColor = "#b1eaff";
      ctx.shadowBlur = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#f8fdff";
      ctx.lineWidth = 1.35;
      ctx.stroke();
    }
    sparkles = sparkles.filter(({ start }) => now - start < 370);
    for (const particle of sparkles) {
      const t = Math.max(0, (now - particle.start) / 370);
      const x = particle.x + particle.dx * t;
      const y = particle.y + particle.dy * t;
      const size = particle.size * (1 - 0.35 * t);
      ctx.fillStyle = `rgba(220,249,255,${0.64 * (1 - t) ** 1.6})`;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * 0.65, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size * 0.65, y);
      ctx.fill();
    }
  }

  function emitSparkle(x, y, angle = sparkleSeed * 2.39996) {
    if (motion.matches) return;
    const distance = 4 + sparkleSeed % 6;
    sparkles.push({ x, y, dx: distance * Math.cos(angle), dy: distance * Math.sin(angle),
      size: 0.85 + 0.15 * (sparkleSeed++ % 4), start: performance.now() });
    if (sparkleFrame) return;
    const update = (now) => {
      drawMagicEffects(now);
      sparkleFrame = sparkles.length ? requestAnimationFrame(update) : 0;
    };
    sparkleFrame = requestAnimationFrame(update);
  }

  function drawTrendMap(now = performance.now()) {
    const elapsed = lensStarted ? Math.max(0, now - lensStarted) : Infinity;
    const lensProgress = Math.min(1, elapsed / sensorSweep);
    const lens = 1 - 0.115 * Math.sin(Math.PI * lensProgress) ** 2;
    const variableId = lensProgress < 0.42 && displayedVariable ? displayedVariable : trendMapVariable().id;
    if (lensProgress >= 0.42) displayedVariable = variableId;
    const texture = heatVisible && trendMap[variableId]
      ? fields.measurement(trendMap[variableId]) : {};
    const platformCountries = viewedSite?.platformCountries;
    const platform = fields.platform(platformCountries);
    const hasRelief = Boolean(heatVisible && mapView.rise > 0 && (platform || viewedSite?.areaIds));
    globe.render({ longitude: mapView.lon, latitude: mapView.lat, zoom: mapView.zoom, lens,
      offsetX: mapView.offsetX, offsetY: mapView.offsetY, surface: fields.surface,
      ...texture, platform, platformCountries, rise: mapView.rise,
      tilt: mapView.orbitTilt * mapView.cameraFocus, orbitAzimuth: mapView.orbitAzimuth * mapView.cameraFocus,
      cameraLift: mapView.cameraLift,
      selectionSegments: viewedSite?.selectionSegments, outlineOpacity: drawingArea ? 0 : mapView.outlineOpacity,
      selection: platform ?? fields.select(viewedSite), relief: hasRelief ? mapView.rise : 0 });
    cameraCoordinates.textContent = `${latLon({ latitude: mapView.lat, longitude: mapView.lon })}  /  ${format(mapView.zoom, 1)}×`;
    const reliefNote = byId("relief-note");
    if (reliefNote) reliefNote.hidden = !(globe.reliefAvailable && hasRelief);
    drawMagicEffects(now);
    const anchor = !drawingArea && site && !site.areaIds && globe.project(...(site.mapAnchor ?? [site.longitude, site.latitude]));
    pin.hidden = !anchor;
    if (anchor) {
      pin.style.left = `${anchor[0]}px`;
      pin.style.top = `${anchor[1]}px`;
    }
  }

  function refocus(delay = 0) {
    if (motion.matches || focusAnimation?.playState === "running") return;
    focusAnimation = world.animate([
      { filter: "blur(0px)", offset: 0 },
      { filter: "blur(1.65px)", offset: 0.22 },
      { filter: "blur(0.4px)", offset: 0.55 },
      { filter: "blur(0.58px)", offset: 0.69 },
      { filter: "blur(0px)", offset: 1 },
    ], { duration: 410, delay, easing: "ease-out" });
  }

  function paintStatic() {
    const ctx = grain.getContext("2d");
    const [width, height] = mapSize();
    if (!ctx || !width || !height) return;
    if (!grainTiles) {
      let seed = 0x924a239;
      grainTiles = Array.from({ length: 5 }, () => {
        const tile = document.createElement("canvas");
        tile.width = tile.height = 160;
        const tileCtx = tile.getContext("2d");
        const image = tileCtx.createImageData(tile.width, tile.height);
        for (let i = 0; i < image.data.length; i += 4) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          const value = seed & 255;
          image.data[i] = image.data[i + 1] = image.data[i + 2] = value < 120 ? 0 : 235;
          image.data[i + 3] = 8 + Math.round((seed >>> 8 & 63) * 0.76);
        }
        tileCtx.putImageData(image, 0, 0);
        return ctx.createPattern(tile, "repeat");
      });
    }
    if (grain.width !== width || grain.height !== height) {
      grain.width = width;
      grain.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = grainTiles[grainIndex++ % grainTiles.length];
    ctx.fillRect(0, 0, width, height);
  }

  function syncStatic() {
    clearInterval(staticTimer);
    if (document.hidden) return;
    paintStatic();
    if (!motion.matches) staticTimer = setInterval(paintStatic, 125);
  }

  document.addEventListener("visibilitychange", syncStatic);
  motion.addEventListener("change", () => {
    if (motion.matches) focusAnimation?.cancel();
    syncStatic();
  });
  syncStatic();

  function runLensChange() {
    if (!heatVisible || motion.matches || !displayedVariable || displayedVariable === trendMapVariable().id) {
      if (lensStarted) {
        lensStarted = 0;
        cancelAnimationFrame(lensFrame);
        stage.removeAttribute("data-lens-change");
      }
      return;
    }
    if (lensStarted && stage.dataset.lensChange === trendMapVariable().id) return;
    cancelAnimationFrame(lensFrame);
    stage.removeAttribute("data-lens-change");
    void stage.offsetWidth;
    stage.dataset.lensChange = trendMapVariable().id;
    lensStarted = performance.now();
    refocus(105);
    const step = (now) => {
      if (!flight) drawTrendMap(now);
      if (now - lensStarted < sensorSweep) lensFrame = requestAnimationFrame(step);
      else {
        lensStarted = 0;
        stage.removeAttribute("data-lens-change");
      }
    };
    lensFrame = requestAnimationFrame(step);
  }

  function viewCentre() {
    const [width, height] = mapSize();
    return [width / 2 + mapView.offsetX, height / 2 + mapView.offsetY];
  }

  function stopFlight() {
    cancelAnimationFrame(flight);
    flight = 0;
    if (focusAnimation?.playState === "running" && focusAnimation.currentTime < focusAnimation.effect.getTiming().delay) {
      focusAnimation.cancel();
    }
  }

  function flyTo(zoom, { avoidPanel = true,
    lat = site?.mapAnchor?.[1] ?? site?.latitude ?? mapView.lat,
    lon = site?.mapAnchor?.[0] ?? site?.longitude ?? mapView.lon } = {}) {
    const selection = site;
    const [width] = mapSize();
    const open = avoidPanel && app.hasAttribute("data-drawer");
    const panel = byId("drawer");
    const offsetX = open && width > 760 ? -panel.offsetWidth / 2 : 0;
    const toolbar = open && width <= 760 ? byId("map-toolbar").getBoundingClientRect().bottom : 0;
    const offsetY = toolbar ? (toolbar - panel.offsetHeight) / 2 : 0;
    const from = { ...mapView };
    const previous = viewedSite;
    const changingSite = previous?.id !== selection?.id;
    const previousCountries = previous?.platformCountries ?? [];
    const nextCountries = selection?.platformCountries ?? [];
    const keepPlatform = previousCountries.length > 0 && previousCountries.length === nextCountries.length &&
      previousCountries.every((country) => nextCountries.includes(country));
    if (keepPlatform) selection.platformCountries = previousCountries;
    const swapAt = changingSite && from.rise > 0 && selection ? 0.34 : 0;
    const target = { lat: clampLatitude(lat), lon, zoom: clampZoom(zoom), offsetX, offsetY,
      rise: selection ? 1 : 0, outlineOpacity: selection ? 1 : 0, orbitAzimuth: changingSite ? 0 : from.orbitAzimuth,
      orbitTilt: changingSite ? initialOrbitTilt : from.orbitTilt,
      cameraFocus: selection ? 1 : 0, cameraLift: nextCountries.length ? 1 : 0 };
    const startVector = toVector(from.lat, from.lon);
    const endVector = toVector(target.lat, target.lon);
    const dot = Math.max(-1, Math.min(1, startVector.reduce((sum, n, i) => sum + n * endVector[i], 0)));
    const angle = Math.acos(dot);
    const side = [-Math.sin(from.lon * radians), 0, Math.cos(from.lon * radians)];
    const tangent = Math.sin(angle) > 1e-5 ? endVector.map((n, i) => (n - startVector[i] * dot) / Math.sin(angle)) : side;
    const longFlight = angle > Math.PI * 0.42;
    const viaOverview = longFlight && (!previous || !selection);
    stopFlight();
    mapTip.hidden = true;
    if (motion.matches) {
      Object.assign(mapView, target);
      viewedSite = selection;
      drawTrendMap();
      return;
    }
    const start = performance.now();
    const duration = longFlight ? 1420 : 710;
    if (viaOverview || Math.abs(Math.log(target.zoom / from.zoom)) > 0.06) {
      focusAnimation?.cancel();
      refocus(viaOverview ? 920 : 245);
    }
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const progress = ease(t);
      const turn = angle * (viaOverview ? ease(Math.min(1, t / 0.66)) : progress);
      const [x, y, z] = startVector.map((n, i) => Math.cos(turn) * n + Math.sin(turn) * tangent[i]);
      mapView.lat = clampLatitude(Math.atan2(y, Math.hypot(x, z)) / radians);
      mapView.lon = Math.atan2(z, x) / radians;
      const zoomed = (a, b, fraction) => a * (b / a) ** ease(fraction);
      mapView.zoom = viaOverview && t < 0.66 ? zoomed(from.zoom, 1, Math.min(1, t / 0.36)) :
        zoomed(viaOverview ? 1 : from.zoom, target.zoom, viaOverview ? (t - 0.66) / 0.34 : t);
      mapView.offsetX = from.offsetX + (offsetX - from.offsetX) * progress;
      mapView.offsetY = from.offsetY + (offsetY - from.offsetY) * progress;
      mapView.orbitAzimuth = from.orbitAzimuth + (target.orbitAzimuth - from.orbitAzimuth) * progress;
      mapView.orbitTilt = from.orbitTilt + (target.orbitTilt - from.orbitTilt) * progress;
      const liftStart = Math.max(swapAt, viaOverview ? 0.6 : 0.14);
      const lift = ease(Math.max(0, (t - liftStart) / (1 - liftStart)));
      const lowering = ease(Math.min(1, t / 0.5));
      const cameraProgress = selection ? lift : lowering;
      mapView.cameraFocus = from.cameraFocus + (target.cameraFocus - from.cameraFocus) * cameraProgress;
      mapView.cameraLift = from.cameraLift + (target.cameraLift - from.cameraLift) * cameraProgress;
      if (t < swapAt) {
        const remaining = 1 - ease(t / swapAt);
        mapView.rise = keepPlatform ? from.rise : from.rise * remaining;
        mapView.outlineOpacity = from.outlineOpacity * remaining;
      } else if (selection) {
        viewedSite = selection;
        const startRise = swapAt && !keepPlatform ? 0 : from.rise;
        mapView.rise = startRise + (1 - startRise) * lift;
        const startOpacity = changingSite ? 0 : from.outlineOpacity;
        mapView.outlineOpacity = startOpacity + (1 - startOpacity) * ease(Math.max(0, (t - 0.6) / 0.4));
      } else {
        const remaining = 1 - lowering;
        mapView.rise = from.rise * remaining;
        mapView.outlineOpacity = from.outlineOpacity * remaining;
        if (!mapView.rise) viewedSite = null;
      }
      if (t === 1) {
        Object.assign(mapView, target);
        viewedSite = selection;
      }
      drawTrendMap(now);
      flight = t < 1 ? requestAnimationFrame(step) : 0;
    };
    flight = requestAnimationFrame(step);
  }

  function zoomBy(factor) {
    if (selectionLanding()) return;
    stopFlight();
    const zoom = clampZoom(mapView.zoom * factor);
    if (zoom !== mapView.zoom) refocus();
    mapView.zoom = zoom;
    drawTrendMap();
  }

  function gridPointIndex(lat, lon) {
    let best = -1;
    let bestDistance = Infinity;
    points.forEach(([pLat, pLon], index) => {
      const distance = Math.max(Math.abs(pLat - lat), Math.abs(signedLongitude(pLon - lon)));
      if (distance <= gridSpacing / 2 && distance < bestDistance) [best, bestDistance] = [index, distance];
    });
    return best;
  }

  function showTip(x, y) {
    const variable = trendMapVariable();
    const entry = trendMap[variable.id];
    const coords = globe.invert(x, y);
    const index = coords ? gridPointIndex(coords[1], coords[0]) : -1;
    if (!entry || index < 0 || entry.slope[index] === null) {
      mapTip.hidden = true;
      return;
    }
    const [lat, lon] = points[index];
    mapTip.replaceChildren(
      create("strong", countryAt(lat, lon) || "Coastal area"),
      create("span", `${format(entry.slope[index], variable.decimals + 1, true)} ${trendUnit(variable)} per decade`),
      create("br"),
      create("small", entry.significant[index] ? "Clear trend. Select for details." : "No clear trend. Select for details."),
    );
    mapTip.hidden = false;
    mapTip.style.left = `${Math.max(2, Math.min(x, mapSize()[0] - mapTip.offsetWidth - 24))}px`;
    mapTip.style.top = `${y}px`;
  }

  function openDrawer() {
    if (drawingArea) setAreaMode(false);
    app.setAttribute("data-drawer", "");
    byId("welcome").hidden = true;
    byId("drawer-title").focus({ preventScroll: true });
  }

  function closeDrawer() {
    app.removeAttribute("data-drawer");
    if (flight || mapView.offsetX || mapView.offsetY) flyTo(mapView.zoom, { avoidPanel: false });
    world.focus({ preventScroll: true });
  }

  function setAreaMode(enabled) {
    drawingArea = enabled;
    magicPath = [];
    magicPointer = null;
    magicCentre = null;
    magicRadius = 34;
    stage.toggleAttribute("data-drawing", enabled);
    areaButton.setAttribute("aria-pressed", String(enabled));
    areaHint.hidden = !enabled;
    areaHint.textContent = enabled ? magicInstructions : "";
    mapTip.hidden = true;
    if (enabled) {
      sparkles = [];
      stopFlight();
      app.removeAttribute("data-drawer");
      mapView.offsetX = mapView.offsetY = 0;
      byId("welcome").hidden = true;
      world.focus({ preventScroll: true });
    }
    drawTrendMap();
  }

  function fitMagicCircle(path) {
    if (path.length < 5) return null;
    const mean = path.reduce(([a, b], [x, y]) => [a + x / path.length, b + y / path.length], [0, 0]);
    let xx = 0, yy = 0, xy = 0, xr = 0, yr = 0;
    for (const [x, y] of path) {
      const a = x - mean[0];
      const b = y - mean[1];
      const r2 = a * a + b * b;
      xx += a * a;
      yy += b * b;
      xy += a * b;
      xr += a * r2 / 2;
      yr += b * r2 / 2;
    }
    const det = xx * yy - xy * xy;
    if (det <= (xx + yy) ** 2 * 0.013) return null;
    const x = mean[0] + (yy * xr - xy * yr) / det;
    const y = mean[1] + (xx * yr - xy * xr) / det;
    const distances = path.map(([px, py]) => Math.hypot(px - x, py - y)).sort((a, b) => a - b);
    const radius = distances[Math.floor(distances.length / 2)];
    if (!Number.isFinite(radius) || radius < 9 || radius > Math.min(...mapSize()) * 0.49) return null;
    if (distances[Math.floor(distances.length * 0.9)] - distances[Math.floor(distances.length * 0.1)] > radius * 0.7) return null;
    // Measure the undrawn gap so retracing a short arc cannot count as closure.
    const angles = path.map(([px, py]) => Math.atan2(py - y, px - x)).sort((a, b) => a - b);
    let previous = angles.at(-1) - 2 * Math.PI;
    for (const angle of angles) {
      if (angle - previous > Math.PI / 2 + 1e-6) return null;
      previous = angle;
    }
    return [x, y, radius];
  }

  function completeMagicCircle(circle) {
    magicPath = [];
    magicCentre = null;
    if (!circle) {
      areaHint.textContent = "Draw at least three quarters of a circle, or tap its centre and edge.";
      drawTrendMap();
      return;
    }
    const [x, y, radius] = circle;
    const inside = points.filter(([lat, lon]) => {
      const p = globe.project(lon, lat);
      return p && Math.hypot(p[0] - x, p[1] - y) <= radius;
    });
    if (!inside.length) {
      areaHint.textContent = "No grid points inside. Draw a bigger circle over a coloured part of the globe.";
      drawTrendMap();
      return;
    }
    const [lon, lat] = globe.invert(x, y) ?? [...inside[0]].reverse();
    const areaIds = inside.map(([latitude, longitude]) => `${latitude},${longitude}`);
    const outline = Array.from({ length: 48 }, (_, index) => {
      const angle = index * Math.PI / 24;
      return globe.invert(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    });
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      emitSparkle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, angle);
    }
    const target = { id: `area:${areaIds.join(";")}`, name: "Selected area", latitude: lat, longitude: lon,
      areaIds, drawn: true, outline: outline.every(Boolean) ? outline : null };
    target.platformCountries = selectedCountries(target);
    for (const country of countries) {
      if (target.platformCountries.includes(country)) continue;
      const overlaps = country.polygons.some(([ring]) => ring.some(([lon, lat]) => {
        const p = globe.project(lon, lat);
        return p && Math.hypot(p[0] - x, p[1] - y) <= radius;
      }));
      if (overlaps) target.platformCountries.push(country);
    }
    setAreaMode(false);
    selectSite(target);
  }

  function magicTap(x, y) {
    if (!magicCentre) {
      magicCentre = [x, y];
      areaHint.textContent = "Centre placed. Tap the edge or use + and −, then Enter to select.";
      drawTrendMap();
    } else completeMagicCircle([...magicCentre, Math.max(9, Math.hypot(x - magicCentre[0], y - magicCentre[1]))]);
  }

  function selectionCentred() {
    const [lon, lat] = site.mapAnchor ?? [site.longitude, site.latitude];
    return viewedSite === site && mapView.rise === 1 &&
      Math.abs(mapView.lat - clampLatitude(lat)) < 1e-7 &&
      Math.abs(signedLongitude(mapView.lon - lon)) < 1e-7;
  }

  function selectionLanding() {
    return flight && site && !drawingArea && !selectionCentred();
  }

  function orbitRegion(dx, dy) {
    if (drawingArea || !site) return false;
    if (!selectionCentred()) {
      if (!flight) flyTo(mapView.zoom);
      return true;
    }
    stopFlight();
    mapView.orbitAzimuth = signedLongitude(mapView.orbitAzimuth + dx * 0.25);
    mapView.orbitTilt = Math.max(0.15, Math.min(1, mapView.orbitTilt - dy * 0.005));
    return true;
  }

  heatButton.addEventListener("click", () => {
    heatVisible = !heatVisible;
    heatButton.setAttribute("aria-pressed", String(heatVisible));
    runLensChange();
    renderTrendMap();
  });
  areaButton.addEventListener("click", () => setAreaMode(!drawingArea));
  stage.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    const point = [event.offsetX, event.offsetY];
    if (drawingArea) {
      if (magicPointer || !globe.invert(...point)) return;
      stage.setPointerCapture(event.pointerId);
      magicPointer = { id: event.pointerId, start: point, tracing: false };
      return;
    }
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    const [a, b] = [...pointers.values()];
    if (b) {
      drag.pinch = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
      drag.zoom = mapView.zoom;
      drag.moved = true;
    } else drag = { point, last: point, moved: false };
    mapTip.hidden = true;
  });
  stage.addEventListener("pointermove", (event) => {
    const point = [event.offsetX, event.offsetY];
    if (drawingArea) {
      if (magicPointer?.id === event.pointerId) {
        if (!magicPointer.tracing && Math.hypot(point[0] - magicPointer.start[0], point[1] - magicPointer.start[1]) >= magicDragThreshold) {
          magicPointer.tracing = true;
          magicCentre = null;
          magicPath = [magicPointer.start];
        }
        const last = magicPath.at(-1);
        if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) >= 3 && magicPath.length < 1400) {
          magicPath.push(point);
          if (magicPath.length % 5 === 0) emitSparkle(...point);
          drawMagicEffects(performance.now());
        }
      }
      return;
    }
    if (!drag || !pointers.has(event.pointerId)) {
      if (!drag && event.pointerType === "mouse") showTip(...point);
      return;
    }
    pointers.set(event.pointerId, point);
    const [a, b] = [...pointers.values()];
    if (drag.pinch && b) {
      const span = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
      if (selectionLanding()) {
        drag.pinch = span;
        drag.zoom = mapView.zoom;
        return;
      }
      stopFlight();
      const zoom = clampZoom(drag.zoom * span / drag.pinch);
      if (Math.abs(Math.log(zoom / mapView.zoom)) > 0.012) refocus();
      mapView.zoom = zoom;
    } else {
      if (!drag.moved && Math.hypot(point[0] - drag.point[0], point[1] - drag.point[1]) < 5) return;
      drag.moved = true;
      stage.classList.add("dragging");
      const dx = point[0] - drag.last[0];
      const dy = point[1] - drag.last[1];
      if (!orbitRegion(dx, dy)) {
        stopFlight();
        const scale = 70 / Math.max(50, globe.radius);
        const latitudeScale = Math.max(0.32, Math.cos(mapView.lat * radians));
        mapView.lon = signedLongitude(mapView.lon - dx * scale / latitudeScale);
        mapView.lat = clampLatitude(mapView.lat + dy * scale);
      }
      drag.last = point;
    }
    drawTrendMap();
  });
  const endPointer = (event) => {
    if (drawingArea) {
      if (magicPointer?.id !== event.pointerId) return;
      const { tracing, start } = magicPointer;
      magicPointer = null;
      if (event.type === "pointercancel") {
        magicPath = [];
        drawMagicEffects(performance.now());
      } else if (tracing) {
        completeMagicCircle(fitMagicCircle([...magicPath, [event.offsetX, event.offsetY]]));
      } else if (Math.hypot(event.offsetX - start[0], event.offsetY - start[1]) < magicDragThreshold) {
        magicTap(event.offsetX, event.offsetY);
      } else completeMagicCircle(null);
      return;
    }
    if (!pointers.delete(event.pointerId) || !drag) return;
    if (pointers.size) {
      const [point] = pointers.values();
      drag = { point, last: point, moved: true };
      return;
    }
    const clicked = !drag.moved && event.type === "pointerup";
    drag = null;
    stage.classList.remove("dragging");
    if (clicked) {
      const coords = globe.invert(event.offsetX, event.offsetY);
      if (!coords) return;
      if (event.ctrlKey || event.metaKey) chooseCountry(coords[1], coords[0], event.shiftKey);
      else if (event.shiftKey && site) toggleCell(coords[1], coords[0]);
      else choosePoint(coords[1], coords[0], true);
    }
  };

  // Shift-click and Ctrl-click build an area out of grid squares, like Magic select does.
  function selectCells(ids, name, keepCamera = false) {
    if (!ids.length) return clearSelection({ lat: mapView.lat, lon: mapView.lon, zoom: mapView.zoom });
    if (ids.length === 1) return selectSite({ ...pointSite(...ids[0].split(",").map(Number)), keepCamera });
    const cells = ids.map((id) => id.split(",").map(Number));
    const latitudes = cells.map(([lat]) => lat);
    const longitudes = cells.map(([, lon]) => lon);
    const places = new Set(cells.map((cell) => countryAt(...cell)).filter(Boolean));
    selectSite({ id: `area:${ids.join(";")}`, areaIds: ids,
      name: name ?? (places.size === 1 ? [...places][0] : "Selected area"),
      latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
      longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2, keepCamera });
  }
  const selectedCells = () => site ? site.areaIds ?? [pointId(site)] : [];

  function toggleCell(latitude, longitude) {
    const sample = points[gridPointIndex(latitude, longitude)];
    if (!sample) return;
    const id = sample.join(",");
    const ids = selectedCells();
    // Keep the camera still so the next shift-click lands where the user aimed.
    selectCells(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id], undefined, true);
  }

  function chooseCountry(latitude, longitude, add) {
    const country = countries.find((item) => inCountry(item, latitude, longitude));
    const inside = country ? points.filter(([lat, lon]) => countryForSample(lat, lon) === country).map((cell) => cell.join(",")) : [];
    if (!inside.length) return choosePoint(latitude, longitude, true);
    selectCells(add ? [...new Set([...selectedCells(), ...inside])] : inside, add ? undefined : country.name);
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("pointerleave", () => { mapTip.hidden = true; });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (magicPointer) return;
    if (drawingArea && magicCentre) {
      magicRadius = Math.min(Math.min(...mapSize()) * 0.48, Math.max(9, magicRadius * Math.exp(-event.deltaY * 0.002)));
      drawMagicEffects(performance.now());
    } else zoomBy(Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });
  world.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      if (!orbitRegion(dx * 40, dy * 22)) {
        stopFlight();
        mapView.lon = signedLongitude(mapView.lon + dx * 15 / Math.sqrt(mapView.zoom));
        mapView.lat = clampLatitude(mapView.lat + dy * 12 / Math.sqrt(mapView.zoom));
      }
      drawTrendMap();
    } else if (["+", "=", "-"].includes(event.key)) {
      const factor = event.key === "-" ? 1 / 1.3 : 1.3;
      if (drawingArea && magicCentre) {
        magicRadius = Math.min(Math.min(...mapSize()) * 0.48, Math.max(9, magicRadius * factor));
        drawMagicEffects(performance.now());
      } else zoomBy(factor);
    } else if (event.key === "Enter") {
      if (!drawingArea) choosePoint(mapView.lat, mapView.lon, true);
      else if (magicCentre) completeMagicCircle([...magicCentre, magicRadius]);
      else magicTap(...viewCentre());
    } else return;
    event.preventDefault();
  });
  byId("zoom-in").addEventListener("click", () => flyTo(mapView.zoom * 1.6));
  byId("zoom-out").addEventListener("click", () => flyTo(mapView.zoom / 1.6));
  function clearSelection(view) {
    if (drawingArea) setAreaMode(false);
    if (app.hasAttribute("data-drawer")) closeDrawer();
    regionRequest?.abort();
    regionRequest = null;
    site = null;
    analysis = null;
    deselectButton.hidden = true;
    regionResults.hidden = true;
    delete regionResults.dataset.site;
    delete regionResults.dataset.point;
    flyTo(view.zoom, { avoidPanel: false, lat: view.lat, lon: view.lon });
    world.focus({ preventScroll: true });
  }
  byId("zoom-reset").addEventListener("click", () => clearSelection(home));
  deselectButton.addEventListener("click", () => clearSelection({ lat: mapView.lat, lon: mapView.lon, zoom: 1 }));

  // ---- Panels: results, welcome, how it works ----
  const hideWelcome = () => {
    byId("welcome").hidden = true;
    world.focus({ preventScroll: true });
  };
  byId("close-drawer").addEventListener("click", closeDrawer);
  byId("close-welcome").addEventListener("click", hideWelcome);
  byId("show-welcome").addEventListener("click", () => {
    if (drawingArea) setAreaMode(false);
    closeDrawer();
    byId("welcome").hidden = false;
    byId("close-welcome").focus();
  });
  const how = byId("how");
  const assistantDialog = byId("assistant-dialog");
  for (const id of ["show-assistant", "ask-at-point"]) {
    byId(id).addEventListener("click", () => assistantDialog.showModal());
  }
  byId("close-assistant").addEventListener("click", () => assistantDialog.close());
  byId("show-how").addEventListener("click", () => how.showModal());
  byId("close-how").addEventListener("click", () => how.close());
  how.addEventListener("click", (event) => { if (event.target === how) how.close(); });
  const drawerHead = byId("drawer-title").parentElement;
  for (const summary of explorer.querySelectorAll(".info-icon, #point-tools > summary")) {
    const details = summary.parentElement;
    details.name = "drawer-info";
    let previewing = false;
    let dismissTimer;
    details.addEventListener("toggle", () => {
      if (!details.open) {
        previewing = false;
        return;
      }
      const content = summary.nextElementSibling;
      const { top, bottom } = summary.getBoundingClientRect();
      const below = explorer.getBoundingClientRect().bottom - bottom - 4;
      const above = top - drawerHead.getBoundingClientRect().bottom - 4;
      const openAbove = below < Math.min(content.scrollHeight, 140) && above > below;
      details.toggleAttribute("data-info-above", openAbove);
      content.style.setProperty("--info-room", `${Math.max(38, openAbove ? above : below)}px`);
    });
    if (!summary.classList.contains("info-icon")) continue;
    details.addEventListener("pointerenter", () => clearTimeout(dismissTimer));
    summary.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse" || details.open) return;
      previewing = true;
      details.open = true;
    });
    details.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse" || !previewing) return;
      dismissTimer = setTimeout(() => { if (previewing) details.open = false; }, 160);
    });
    summary.addEventListener("click", (event) => {
      if (!previewing) return;
      previewing = false;
      event.preventDefault();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || how.open || assistantDialog.open) return;
    const info = explorer.querySelector("details[open] > .info-icon, #point-tools[open] > summary");
    if (info && app.hasAttribute("data-drawer")) {
      info.parentElement.open = false;
      info.focus({ preventScroll: true });
    } else if (drawingArea) {
      setAreaMode(false);
      areaButton.focus();
    } else if (site || app.hasAttribute("data-drawer")) clearSelection({ lat: mapView.lat, lon: mapView.lon, zoom: 1 });
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
        how.close();
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
    how.close();
    choosePoint(latitude.valueAsNumber, longitude.valueAsNumber);
  });
  retryRegion.addEventListener("click", () => selectSite(site));
  refreshGiovanni.addEventListener("click", refreshPoint);

  // ---- Examples in the welcome card ----
  function showStripes(canvas, values, id, firstYear) {
    liveStripes.set(canvas, [values, id, firstYear]);
    drawStripes(canvas, values, id, firstYear);
    observer.observe(canvas);
  }
  for (const example of examples.filter(({ site }) => site())) {
    const button = create("button");
    const photo = create("img");
    photo.src = `assets/investigations/${example.photo}`;
    photo.alt = "";
    photo.draggable = false;
    if (example.crop) photo.style.objectPosition = example.crop;
    button.append(photo, create("span", example.title));
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
    const values = featured[example.stripeKey];
    if (values?.length) {
      const variable = data.variables.find(({ id }) => id === example.ids[0]);
      const firstYear = data.startYear + Math.ceil(variable.firstMonth / 12);
      const preview = create("canvas");
      preview.setAttribute("aria-hidden", "true");
      button.setAttribute("aria-description", `${variable.name}, ${firstYear}–${firstYear + values.length - 1}.`);
      button.append(preview);
      showStripes(preview, values, variable.id, firstYear);
    }
  }

  observer.observe(byId("chart-stage"));
  observer.observe(byId("forecast-stage"));
  observer.observe(stage);
  renderTrendMap();
})();
