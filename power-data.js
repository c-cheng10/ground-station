(() => {
  "use strict";

  const endpoint = "https://power.larc.nasa.gov/api/temporal/monthly/point";
  const latitudeStep = 0.5;
  const longitudeStep = 0.625;
  const concurrency = 3;
  const timeoutMs = 30_000;
  const nativeUnits = {
    T2M: "C",
    TS: "C",
    PRECTOTCORR: "mm/day",
    QV2M: "g/kg",
    RH2M: "%",
    GWETROOT: "1",
    EVLAND: "mm/day",
    WS10M: "m/s",
  };

  async function fetchCell(cell, variableIds, years, annualKeys, monthlyKeys, signal) {
    const { latitude, longitude } = cell;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      parameters: variableIds.join(","),
      community: "AG",
      latitude,
      longitude,
      start: years[0],
      end: years.at(-1),
      format: "JSON",
    });
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status}.`);
    const payload = await response.json();
    const source = payload?.header?.sources;
    const coords = payload?.geometry?.coordinates;
    const fill = payload?.header?.fill_value;
    if (!Array.isArray(source) || !source.includes("MERRA2") ||
        coords?.[0] !== longitude || coords?.[1] !== latitude ||
        !Number.isFinite(fill)) {
      throw new Error(`Unexpected NASA POWER data at ${latitude}°, ${longitude}°.`);
    }

    const annual = {};
    const monthly = {};
    for (const id of variableIds) {
      if (payload.parameters?.[id]?.units !== nativeUnits[id]) {
        throw new Error(`NASA POWER changed the units or did not return ${id}.`);
      }
      const observations = payload.properties?.parameter?.[id];
      const scale = id === "GWETROOT" ? 100 : 1;
      const read = (date) => {
        const value = observations?.[date];
        if (!Number.isFinite(value) || value === fill) {
          throw new Error(`NASA POWER did not return ${id} for ${date} at ${latitude}°, ${longitude}°.`);
        }
        return value * scale;
      };
      annual[id] = annualKeys.map(read);
      monthly[id] = monthlyKeys.map(read);
    }
    return { annual, monthly };
  }

  function areaAverage(records, weights, variableIds, field) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return Object.fromEntries(variableIds.map((id) => {
      const values = records[0][field][id].map((_, period) =>
        records.reduce((sum, record, index) =>
          sum + record[field][id][period] * weights[index], 0) / totalWeight
      );
      return [id, values];
    }));
  }

  async function loadRegion(site, startYear, endYear, variableIds, { signal } = {}) {
    signal?.throwIfAborted();
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
      throw new Error("Invalid NASA POWER date range.");
    }
    if (!variableIds.length || variableIds.some((id) => !Object.hasOwn(nativeUnits, id))) {
      throw new Error("Unsupported NASA POWER variable.");
    }

    const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    const annualKeys = years.map((year) => `${year}13`);
    const monthlyKeys = years.flatMap((year) => Array.from({ length: 12 }, (_, index) =>
      `${year}${String(index + 1).padStart(2, "0")}`
    ));
    const cells = [-latitudeStep, 0, latitudeStep].flatMap((latOffset) =>
      [-longitudeStep, 0, longitudeStep].map((lonOffset) => ({
        latitude: site.latitude + latOffset,
        longitude: site.longitude + lonOffset,
      }))
    );
    // The area of equal-width latitude/longitude cells scales with cosine latitude.
    const weights = cells.map(({ latitude }) => Math.cos(latitude * Math.PI / 180));
    const records = new Array(cells.length);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("NASA POWER timed out.")), timeoutMs);

    try {
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        for (let index = worker; index < cells.length; index += concurrency) {
          records[index] = await fetchCell(
            cells[index], variableIds, years, annualKeys, monthlyKeys, controller.signal
          );
        }
      }));
      controller.signal.throwIfAborted();
      return {
        annual: areaAverage(records, weights, variableIds, "annual"),
        monthly: areaAverage(records, weights, variableIds, "monthly"),
      };
    } finally {
      controller.abort();
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  window.PowerData = { loadRegion };
})();
