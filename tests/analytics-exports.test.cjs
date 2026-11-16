const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../trend-explorer.js"), "utf8");
const statistics = readFileSync(join(__dirname, "../trend-statistics.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function loadAnalytics() {
  const variables = [
    { id: "T2M", name: "Air temperature", unit: "°C", source: "MERRA-2" },
    { id: "SNOW", name: "Snow depth", unit: "cm", source: "GLDAS 2.0" },
    { id: "OCEAN_SKIN_TEMP", name: "Sea surface skin temperature", unit: "°C", source: "AIRS" },
  ];
  const window = {};
  runInNewContext(statistics, { window });
  const context = { window, data: { startYear: 2000, variables }, TrendStatistics: window.TrendStatistics, layers: { air: [] } };
  runInNewContext(section("  function holmAdjust", "  async function selectSite"), context);
  return context;
}

test("partial observed months stay aligned with the full-year anomaly baseline and trend", () => {
  const { analyseRow } = loadAnalytics();
  const t2m = Array.from({ length: 64 }, (_, index) => index < 8 || index === 9 ? null : index);
  const { series, starts, observations } = analyseRow({ t2m, snow: [null, 3] });
  assert.equal(starts.T2M, 12);
  assert.equal(series.T2M.firstYear, 2001);
  assert.equal(series.T2M.lastYear, 2004);
  assert.equal(series.T2M.monthlyStart, 8);
  assert.equal(series.T2M.monthlyValues[0], 8);
  assert.equal(series.T2M.monthlyValues[1], null);
  assert.equal(series.T2M.monthlyAnomalies[0], -30);
  assert.equal(series.T2M.monthlyAnomalies[1], null);
  assert.equal(series.T2M.monthlyValues.at(-1), 63);
  assert.equal(series.SNOW, undefined);
  assert.equal(observations.SNOW.monthlyValues[0], 3);
});

test("monthly area averages count each measurement's contributing points", async () => {
  const context = loadAnalytics();
  context.loadPoints = async () => [
    { t2m: [2, 4], snow: [6, 8] },
    { t2m: [4, null], snow: [null, null], ocean_skin_temp: [10, 12] },
  ];
  const row = await context.loadArea(["land", "sea"], new AbortController().signal);
  assert.deepEqual({ ...row.contributorCounts }, { t2m: 2, snow: 1, ocean_skin_temp: 1 });
  assert.deepEqual([...row.t2m], [3, null]);
  assert.deepEqual([...row.snow], [6, 8]);
  assert.deepEqual([...row.ocean_skin_temp], [10, 12]);
});

test("a narrow axis preserves its end year without overlapping labels", () => {
  const context = {};
  runInNewContext(section("  function drawAxisYears", "  function drawChart"), context);
  const labels = [];
  const ctx = { measureText: () => ({ width: 28 }), fillText: (label) => labels.push(label) };
  const years = [1980, 2000, 2020, 2025];
  const positions = [29, 113, 196, 217];
  context.drawAxisYears(ctx, years, (year) => positions[years.indexOf(year)], 200, 235);
  assert.deepEqual(labels, ["1980", "2000", "2025"]);
});

test("exports the selection shown by the dialog in one readable ZIP", {
  skip: Boolean(spawnSync("unzip", ["-v"]).error),
}, async () => {
  const context = loadAnalytics();
  const elements = new Map();
  let chosen = ["monthly", "sources"];
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, {
      elements: { forecast: {}, news: {} },
      events: {},
      addEventListener(type, handler) { this.events[type] = handler; },
      querySelectorAll() { return chosen.map((name) => ({ name })); },
      showModal() { this.open = true; },
      close() { this.open = false; this.events.close?.(); },
    });
    return elements.get(id);
  };
  const downloads = [];
  const selection = { name: "Southern Ontario", latitude: 44.125, longitude: -80.625 };
  const analysis = context.analyseRow({ t2m: Array.from({ length: 64 }, (_, i) => i < 8 ? null : i) });
  Object.assign(context, {
    byId, Blob, TextEncoder,
    site: selection, analysis, model: null,
    location: { origin: "http://localhost", pathname: "/" },
    trendMapVariable: () => context.data.variables[0],
    format: String,
    URL: { createObjectURL: (blob) => blob },
    document: { body: { append() {} } },
    setTimeout() {},
    create: () => ({ click() { downloads.push({ name: this.download, blob: this.href }); }, remove() {} }),
  });
  context.window.ClimateNews = { articles: () => [] };
  runInNewContext(section("  function gridPoints", "  function renderCorrelations"), context);
  runInNewContext(section("  const exportDialog =", "  // Air temperature only:"), context);
  byId("open-export").events.click();
  context.site = null;
  context.analysis = null;
  byId("export-form").events.submit({ preventDefault() {} });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, "southern-ontario-data.zip");
  assert.equal(downloads[0].blob.type, "application/zip");
  const temporary = mkdtempSync(join(tmpdir(), "ground-station-export-test-"));
  try {
    const zipPath = join(temporary, downloads[0].name);
    writeFileSync(zipPath, Buffer.from(await downloads[0].blob.arrayBuffer()));
    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n");
    assert.deepEqual(entries, ["southern-ontario-monthly.csv", "southern-ontario-sources-and-methods.txt"]);
    const csv = execFileSync("unzip", ["-p", zipPath, entries[0]], { encoding: "utf8" });
    assert.match(csv, /^\uFEFF"month","Air temperature \(°C\)"\r\n"2000-09",8\r\n/);
    assert.match(csv, /"2005-04",63\r\n$/);
    const methods = execFileSync("unzip", ["-p", zipPath, entries[1]], { encoding: "utf8" });
    assert.match(methods, /Southern Ontario/);
    assert.match(methods, /44\.125, -80\.625/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  chosen = ["monthly"];
  context.site = selection;
  context.analysis = analysis;
  byId("open-export").events.click();
  byId("export-form").events.submit({ preventDefault() {} });
  assert.equal(downloads[1].name, "southern-ontario-monthly.csv");
  assert.equal(downloads[1].blob.type, "text/csv;charset=utf-8");
});
