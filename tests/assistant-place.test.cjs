const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadAssistant(fetch, navigator = {}) {
  const countries = ["Australia", "Austria", "Madagascar", "Niger", "Nigeria"].map((name) => ({ name }));
  const window = { WORLD_MAP: { countries } };
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      dataset: {},
      addEventListener(type, handler) { this[type] = handler; },
      focus() {},
      querySelector: () => element("fieldset"),
      querySelectorAll: () => [],
      replaceChildren() {},
    });
    return nodes.get(id);
  };
  const context = vm.createContext({ window, document: { getElementById: element }, fetch, navigator, URL, URLSearchParams, AbortController, AbortSignal });
  const load = (file) => vm.runInContext(readFileSync(resolve(__dirname, "..", file), "utf8"), context, { filename: file });
  for (const file of ["trend-config.js", "assistant-place.js", "correlation-assistant.js"]) {
    load(file);
  }
  const ask = async (question) => {
    element("assistant-question").value = question;
    await element("assistant-form").submit({ preventDefault() {} });
  };
  return { window, element, ask, load };
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
});

test("country typos preserve exact countries, directions and ambiguity", async () => {
  const { window } = loadAssistant(async () => ({ ok: true, json: async () => ({ results: [] }) }));
  const { resolve: place } = window.AssistantPlace;
  assert.equal((await place("Niger")).country?.name, "Niger");
  const western = await place("western Nigeira");
  assert.equal(western.country?.name, "Nigeria");
  assert.equal(western.direction, "west");
  assert.match((await place("Austraia")).message, /more than one country/i);
  assert.match((await place("Sahara biome")).message, /Magic select/);
});

test("Ask AI sends the resolved site for correlations and dated research", async () => {
  const requests = [];
  const turns = [
    interpret({ kind: "correlation", place: "Cerado biome in Brazil", variable_ids: ["t2m", "rh2m"] }),
    interpret({ kind: "research", place: "the Cerrdao", variable_ids: ["prectotcorr"], start_year: 2012, end_year: 2014 }),
    interpret({ place: "the Cerado biome", variable_ids: ["t2m"] }),
    interpret({ place: "the Cerado in Canada", variable_ids: ["t2m"] }),
  ];
  const { window, element, ask } = loadAssistant(async (url, options) => {
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
  assert.match(element("assistant-reply").textContent, /grid points in Cerrado/);
  await ask("What is the air temperature trend in the Cerado in Canada?");
  assert.match(element("assistant-reply").textContent, /Cerrado study area is in Brazil/);
  assert.equal(requests.length, 2);
});

test("Ask AI submits casual wording as written and uses the interpreted place ahead of a selection", async () => {
  const requests = [];
  const { window, element, ask } = loadAssistant(async (_url, options) => {
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
  assert.match(element("assistant-reply").textContent, /grid points in Madagascar/);
});

test("Ask AI stops on invalid measurements, time windows or unclear intent", async () => {
  const intents = [interpret({ place: "Madagascar", variable_ids: ["unlisted"] }),
    interpret({ place: "Madagascar", variable_ids: ["prectotcorr"], start_year: 2020, end_year: 2021 }),
    interpret({ kind: "clarify", reason: "measurement" })];
  const { window, element, ask } = loadAssistant(async (_url, options) => {
    assert.equal(JSON.parse(options.body).mode, "interpret");
    return respond(intents.shift());
  });
  window.answerClimateArea = async () => assert.fail("Invalid intent cannot load climate data");
  await ask("Show Madagascar's oxidation");
  assert.match(element("assistant-reply").textContent, /could not identify/);
  await ask("Show Madagascar's rainfall trend from 2020 to 2021");
  assert.match(element("assistant-reply").textContent, /could not identify/);
  await ask("What about Madagascar's humidity?");
  assert.match(element("assistant-reply").textContent, /Which measurement/);
});

function loadOnboarding(fetch, answers, navigator) {
  const { window, element, load } = loadAssistant(fetch, navigator);
  const dialog = element("onboarding");
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  element("help").close = () => {};
  const form = element("onboarding-form");
  const inputs = { role: "role", customRole: "custom-role", place: "place", interest: "interest" };
  form.elements = Object.fromEntries(Object.entries(inputs).map(([name, id]) =>
    [name, Object.assign(element(`onboarding-${id}`), { value: answers[name] ?? "" })]));
  element("onboarding-place-step").hidden = true;
  element("onboarding-interest-step").hidden = true;
  const submit = () => form.submit({ preventDefault() {} });
  const visibleSteps = () => ["role", "place", "interest"].filter((step) => !element(`onboarding-${step}-step`).hidden);
  return { window, element, dialog, form, load, submit, visibleSteps };
}

test("onboarding advances one step at a time, preserves the typed place and falls back by role", async () => {
  const answers = [respond(interpret({ place: "Kenya", variable_ids: ["prectotcorr"] })),
    { ok: false, status: 429, json: async () => ({ error: "Rate limit" }) }];
  const { window, element, load, submit, dialog, visibleSteps } = loadOnboarding(async (_url, options) => {
    const { mode, question } = JSON.parse(options.body);
    assert.equal(mode, "interpret");
    for (const answer of ["farmer", "western Nigeria", "rainfall compared with Kenya"]) assert.ok(question.includes(answer));
    return answers.shift();
  }, { role: "farmer", place: "western Nigeria", interest: "rainfall compared with Kenya" });
  const selections = [];
  window.selectOnboardingArea = async ({ place, variable, signal }) => {
    assert.equal(signal.aborted, false);
    selections.push({ place, variable });
  };
  load("onboarding.js");
  assert.equal(dialog.open, true);
  assert.deepEqual(visibleSteps(), ["role"]);
  await submit();
  assert.deepEqual(visibleSteps(), ["place"]);
  await submit();
  assert.deepEqual(visibleSteps(), ["interest"]);
  element("onboarding-back").click();
  assert.deepEqual(visibleSteps(), ["place"]);
  await submit();
  assert.equal(answers.length, 2);
  await submit();
  assert.equal(dialog.open, false);
  element("show-onboarding").click();
  assert.deepEqual(visibleSteps(), ["role"]);
  await submit();
  await submit();
  await submit();
  assert.deepEqual(selections, [
    { place: "western Nigeria", variable: "PRECTOTCORR" },
    { place: "western Nigeria", variable: "GWETROOT" },
  ]);
});

test("device location allows a retry after permission denial and coordinates stay out of the assistant request", async () => {
  const coordinates = { latitude: 43.654321, longitude: -79.398765 };
  let geolocationResult;
  let request;
  let selected;
  const navigator = { geolocation: { getCurrentPosition(success, error) { geolocationResult = { success, error }; } } };
  const { window, element, form, load, submit, visibleSteps } = loadOnboarding(async (_url, options) => {
    request = JSON.parse(options.body);
    return respond(interpret({ place: "Kenya", variable_ids: ["ws10m"] }));
  }, { role: "other", interest: "wind trends" }, navigator);
  window.selectOnboardingArea = async (selection) => { selected = selection; };
  load("onboarding.js");
  await submit();
  assert.deepEqual(visibleSteps(), ["role"]);
  form.elements.customRole.value = "sailor";
  await submit();
  assert.deepEqual(visibleSteps(), ["place"]);
  element("onboarding-locate").click();
  geolocationResult.error({ code: 1 });
  assert.match(element("onboarding-location-note").textContent, /(?:denied|permission|unavailable|couldn.t)/i);
  await submit();
  assert.deepEqual(visibleSteps(), ["place"]);
  assert.equal(request, undefined);
  element("onboarding-locate").click();
  geolocationResult.success({ coords: coordinates });
  await submit();
  assert.deepEqual(visibleSteps(), ["interest"]);
  await submit();
  assert.equal(selected.coordinates.latitude, coordinates.latitude);
  assert.equal(selected.coordinates.longitude, coordinates.longitude);
  assert.equal(selected.variable, "WS10M");
  assert.equal(request.has_selection, true);
  assert.match(request.question, /sailor/);
  assert.doesNotMatch(JSON.stringify(request), /43\.654321|-79\.398765/);
  assert.ok(!selected.place);
});
