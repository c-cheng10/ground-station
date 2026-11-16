const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadAssistant(fetch) {
  const countries = ["Australia", "Austria", "Georgia", "Madagascar", "Niger", "Nigeria",
    "Bosnia and Herz.", "Dominican Rep."].map((name) => ({ name }));
  const window = { WORLD_MAP: { countries } };
  const createNode = () => {
    const selectors = new Map();
    return {
      children: [],
      dataset: {},
      addEventListener(type, handler) { this[type] = handler; },
      append(...children) { this.children.push(...children); },
      focus() {},
      querySelector(selector) {
        if (!selectors.has(selector)) selectors.set(selector, createNode());
        return selectors.get(selector);
      },
      querySelectorAll: () => [],
    };
  };
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, createNode());
    return nodes.get(id);
  };
  const history = element("assistant-history");
  element("assistant-message-template").content = { firstElementChild: { cloneNode: createNode } };
  window.getClimateSelection = () => element("region-results").dataset;
  window.selectClimateArea = (place) => ({ name: place.displayName ?? place.name ?? place.country?.name });
  const document = { getElementById: element, createElement: createNode };
  const context = vm.createContext({ window, document, fetch, URL, URLSearchParams, AbortSignal });
  const load = (file) => vm.runInContext(readFileSync(resolve(__dirname, "..", file), "utf8"), context, { filename: file });
  for (const file of ["trend-config.js", "selection-admin1.js", "selection-cities.js", "assistant-place.js", "correlation-assistant.js"]) {
    load(file);
  }
  const ask = async (question) => {
    element("assistant-question").value = question;
    await element("assistant-form").submit({ preventDefault() {} });
  };
  const replies = () => history.children.filter((_, index) => index % 2 === 1)
    .map((message) => message.querySelector(".assistant-reply").textContent);
  return { window, element, ask, history, replies };
}

const interpret = (details) => ({ intent: { kind: "trend", place: null, variable_ids: [], lag_months: 0,
  start_year: null, end_year: null, reason: null, ...details } });
const respond = (answer) => ({ ok: true, json: async () => answer });

test("saved sites accept close spelling and aliases but check country qualifiers", () => {
  const { window } = loadAssistant();
  const find = (name) => window.AssistantPlace.findStudyArea(name, window.TREND_CONFIG.sites);
  for (const name of ["the Cerradó", "Cerado", "Cerrdao", "Cerradoo", "Cerado biome in Brazil", "Brazilian Cerrado"]) {
    assert.equal(find(name).entry?.id, "cerrado", name);
  }
  assert.equal(find("Central‑Amazno rainforest").entry?.id, "central-amazon");
  assert.equal(find("Cerado, Canada").wrongCountry?.id, "cerrado");
  assert.equal(find("rainforest").entry, undefined);
  assert.equal(find("Sahel").entry, undefined);
  assert.equal(find("Southern Ontario, Canada").entry?.id, "southern-ontario");
  assert.equal(find("Ontario, Canada").entry, undefined);
});

test("province, state and qualified-city lookups stay distinct", async () => {
  const city = (name, admin1, country, country_code) => ({ name, admin1, country, country_code,
    feature_code: "PPL", latitude: 40, longitude: -80 });
  const { window } = loadAssistant(async (url) => {
    const name = url.searchParams.get("name");
    return respond({ results: ({
      "Ontario, California": [city("Ontario", "California", "United States", "US")],
      "Paris, Texas": [city("Paris", "Texas", "United States", "US")],
      "Québec": [city("Québec", "Québec", "Canada", "CA")],
    })[name] ?? [] });
  });
  const { resolve: place } = window.AssistantPlace;
  for (const name of ["Ontario", "Ontario, Canada", "Ontario in Canada", "Onatrio, Canada", "CA-ON"]) {
    const match = await place(name);
    assert.equal(match.region?.code, "CA-ON", name);
    assert.ok(match.region.samples.some(([latitude]) => latitude > 50));
  }
  assert.equal((await place("northern Ontario, Canada")).direction, "north");
  assert.equal((await place("California state")).region?.code, "US-CA");
  assert.equal((await place("Georgia")).kind, "country");
  assert.equal((await place("Georgia, USA")).region?.code, "US-GA");
  assert.equal((await place("Québec, Canada")).region?.code, "CA-QC");
  assert.equal((await place("Quebec City")).kind, "city");
  assert.equal((await place("Ontario, California")).kind, "city");
  assert.equal((await place("Paris, Texas, USA")).kind, "city");
  assert.match((await place("Punjab")).message, /include its country/i);
  assert.equal((await place("New York State")).region?.code, "US-NY");
});

test("country typos preserve exact countries, directions and ambiguity", async () => {
  const { window } = loadAssistant(async () => ({ ok: true, json: async () => ({ results: [] }) }));
  const { resolve: place } = window.AssistantPlace;
  assert.equal((await place("Niger")).country?.name, "Niger");
  const western = await place("western Nigeira");
  assert.equal(western.country?.name, "Nigeria");
  assert.equal(western.direction, "west");
  assert.match((await place("Austraia")).message, /more than one country/i);
  assert.match((await place("Sahara biome")).message, /Box select/);
});

test("Ask AI sends the resolved site for correlations and dated research", async () => {
  const requests = [];
  const turns = [
    interpret({ kind: "correlation", place: "Cerado biome in Brazil", variable_ids: ["t2m", "rh2m"] }),
    interpret({ kind: "research", place: "the Cerrdao", variable_ids: ["prectotcorr"], start_year: 2012, end_year: 2014 }),
    interpret({ place: "the Cerado biome", variable_ids: ["t2m"] }),
    interpret({ place: "the Cerado in Canada", variable_ids: ["t2m"] }),
  ];
  const { window, element, ask, replies } = loadAssistant(async (url, options) => {
    assert.equal(url.pathname, "/functions/v1/climate-assistant-giovanni");
    const body = JSON.parse(options.body);
    if (body.mode === "interpret") return respond(turns.shift());
    requests.push(body);
    return respond({ reply: "OK" });
  });
  element("region-results").dataset = { site: "southern-ontario", point: "44.125,-80.625" };
  await ask("What is the correlation between air temperature and relative humidity in the Cerado biome in Brazil?");
  await ask("Find research on rainfall in the Cerrdao from 2012 to 2014.");
  assert.deepEqual(requests, [
    { mode: "lookup", tool: "get_correlation", region_id: "cerrado", variable_ids: ["t2m", "rh2m"], lag_months: 0 },
    { mode: "lookup", tool: "find_research", region_id: "cerrado", variable_ids: ["prectotcorr"], start_year: 2012, end_year: 2014 },
  ]);

  window.answerClimateArea = async (question, place) => {
    assert.equal(question.kind, "trend");
    assert.equal(place.id, "cerrado");
    return { status: "no_data", name: place.name };
  };
  await ask("How has air temperature changed in the Cerado biome over time?");
  assert.match(replies().at(-1), /grid points in Cerrado/);
  await ask("What is the air temperature trend in the Cerado in Canada?");
  assert.match(replies().at(-1), /Cerrado study area is in Brazil/);
  assert.equal(requests.length, 2);
});

test("Ask AI submits casual wording as written and uses the interpreted place ahead of a selection", async () => {
  const requests = [];
  const { window, element, ask, replies } = loadAssistant(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return respond(interpret({ place: "Madagascar", variable_ids: ["prectotcorr"] }));
  });
  element("region-results").dataset = { site: "cerrado", point: "-15.625,-47.625" };
  window.answerClimateArea = async (question, place) => {
    assert.equal(question.kind, "trend");
    assert.equal(question.ids.join(","), "PRECTOTCORR");
    assert.equal(place.country?.name, "Madagascar");
    return { status: "no_data", name: place.country.name };
  };
  await ask("tell me about madagascar's rain");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mode, "interpret");
  assert.equal(requests[0].question, "tell me about madagascar's rain");
  assert.match(replies().at(-1), /grid points in Madagascar/);
});

test("Ask AI resolves the Ontario soil question to the province's grid points", async () => {
  const question = "tell me about ontario, Canada and its soil levels";
  const { window, ask, replies } = loadAssistant(async (url, options) => {
    assert.equal(url.pathname, "/functions/v1/climate-assistant-giovanni");
    assert.equal(JSON.parse(options.body).question, question);
    return respond(interpret({ place: "Ontario, Canada", variable_ids: ["gwetroot"] }));
  });
  window.answerClimateArea = async (intent, place) => {
    assert.equal(intent.ids.join(","), "GWETROOT");
    assert.equal(place.kind, "region");
    assert.equal(place.region.code, "CA-ON");
    assert.ok(place.region.samples.length > 1);
    return { status: "no_data", name: place.displayName };
  };
  await ask(question);
  assert.match(replies().at(-1), /grid points in Ontario, Canada/);
});

test("Ask AI stops on invalid measurements, time windows or unclear intent", async () => {
  const intents = [interpret({ place: "Madagascar", variable_ids: ["unlisted"] }),
    interpret({ place: "Madagascar", variable_ids: ["prectotcorr"], start_year: 2020, end_year: 2021 }),
    interpret({ kind: "clarify", reason: "measurement" })];
  const { window, ask, replies } = loadAssistant(async (_url, options) => {
    assert.equal(JSON.parse(options.body).mode, "interpret");
    return respond(intents.shift());
  });
  window.answerClimateArea = async () => assert.fail("Invalid intent cannot load climate data");
  await ask("Show Madagascar's oxidation");
  assert.match(replies().at(-1), /could not identify/);
  await ask("Show Madagascar's rainfall trend from 2020 to 2021");
  assert.match(replies().at(-1), /could not identify/);
  await ask("What about Madagascar's humidity?");
  assert.match(replies().at(-1), /Which measurement/);
});

test("Ask AI selects local place-only prompts without a request and keeps earlier turns", async () => {
  const { window, ask, history, replies } = loadAssistant(() => assert.fail("Local places need no request"));
  const selections = [];
  window.selectClimateArea = (place) => {
    selections.push(place.id ?? place.region?.code ?? place.country.name);
    return { name: place.displayName ?? place.name };
  };

  await ask("the Cerrado");
  await ask("Show me Ontario, Canada");
  await ask("Please take me to western Nigeria.");

  assert.deepEqual(selections, ["cerrado", "CA-ON", "Nigeria"]);
  assert.deepEqual(history.children.filter((_, index) => index % 2 === 0).map((message) => message.textContent),
    ["the Cerrado", "Show me Ontario, Canada", "Please take me to western Nigeria."]);
  assert.deepEqual(replies(), ["Selected Cerrado on the globe.", "Selected Ontario, Canada on the globe.",
    "Selected Western Nigeria on the globe."]);
});

test("Ask AI selects a place from an interpreted location request", async () => {
  const question = "Could you put my view over western Nigeria?";
  const { window, ask, replies } = loadAssistant(async (url, options) => {
    assert.equal(url.pathname, "/functions/v1/climate-assistant-giovanni");
    assert.equal(JSON.parse(options.body).question, question);
    return respond(interpret({ kind: "select", place: "western Nigeria" }));
  });
  window.selectClimateArea = (place) => {
    assert.equal(place.country.name, "Nigeria");
    assert.equal(place.direction, "west");
    return { name: place.displayName };
  };

  await ask(question);
  assert.deepEqual(replies(), ["Selected Western Nigeria on the globe."]);
});

test("full country names and the unoutlined country Tonga resolve before city search", async () => {
  const { window } = loadAssistant(() => assert.fail("Known country aliases do not need geocoding"));
  for (const [name, label] of [["Bosnia and Herzegovina", "Bosnia and Herz."], ["Dominican Republic", "Dominican Rep."]]) {
    const result = await window.AssistantPlace.resolve(name);
    assert.equal(result.country.name, label);
  }
  const tonga = await window.AssistantPlace.resolve("Tonga");
  assert.equal(tonga.kind, "country");
  assert.equal(tonga.name, "Tonga");
  assert.equal(tonga.latitude, -21.139);
  assert.equal(tonga.longitude, -175.221);
});

test("contextual retry retains the selected area and only uses the centre to clarify intent", async () => {
  const prompts = [];
  const { window, element, ask, replies } = loadAssistant(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.has_selection, true);
    prompts.push(body.question);
    return respond(prompts.length === 1 ? interpret({ kind: "clarify", reason: "place" })
      : interpret({ place: "53,-88", variable_ids: ["prectotcorr"] }));
  });
  element("region-results").dataset = { site: "area:Ontario", centre: "53,-88" };
  window.answerClimateArea = async (question, place) => {
    assert.equal(question.ids[0], "PRECTOTCORR");
    assert.equal(place, null, "The synthetic coordinate must not narrow the selected area");
    return { status: "no_data", name: "Custom Ontario area" };
  };
  await ask("Has rainfall changed here?");
  assert.deepEqual(prompts, ["Has rainfall changed here?", "Has rainfall changed at 53,-88?"]);
  assert.match(replies().at(-1), /Custom Ontario area/);
});

test("coordinate correlation queries the point selected on the map instead of the typed coordinates", async () => {
  const requests = [];
  const { window, ask, replies } = loadAssistant(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return respond(body.mode === "interpret"
      ? interpret({ kind: "correlation", place: "45.5,-75.5", variable_ids: ["t2m", "rh2m"] }) : { reply: "Correlation result" });
  });
  window.selectClimateArea = (place) => {
    assert.equal(place.latitude, 45.5);
    assert.equal(place.longitude, -75.5);
    return { name: "Eastern Ontario", point: "44.625,-76.375" };
  };
  await ask("Correlate air temperature and relative humidity at 45.5,-75.5.");
  assert.equal(requests[1].point_id, "44.625,-76.375");
  assert.match(replies().at(-1), /Selected Eastern Ontario.*\n\nCorrelation result/);
});

test("country area directions use wrapped longitude and exclude far-away border outliers", async () => {
  const window = {};
  const context = vm.createContext({ window, countryBounds: new Map() });
  const read = (file) => readFileSync(resolve(__dirname, "..", file), "utf8");
  for (const file of ["points-index.js", "ocean-atmosphere.js", "world-map.js", "assistant-place.js"]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const source = read("trend-explorer.js");
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  context.points = [...window.POINTS_INDEX, ...window.GIOVANNI_EXTENSION.extraLand];
  vm.runInContext(section("  function inCountry(", "  function countryForSample(") +
    section("  function distanceKm(", "  function regionalName(") +
    section("  function isInDirection(", "  function assistantTarget("), context);

  const local = async (name) => window.AssistantPlace.resolve(name, { localOnly: true });
  const russia = await local("Russia");
  const full = context.assistantArea(russia);
  const west = context.assistantArea(await local("western Russia"));
  assert.ok(context.inCountry(russia.country, full.latitude, full.longitude));
  assert.ok(west.longitude < full.longitude && west.areaIds.length > 100);
  const south = context.assistantArea(await local("south of Canada"));
  assert.ok(south.latitude < 49 && south.areaIds.length > 20);
  assert.ok(south.areaIds.every((id) => Number(id.split(",")[0]) < 49));
});
