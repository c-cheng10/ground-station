const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadAssistant(fetch) {
  const countries = ["Australia", "Austria", "Niger", "Nigeria"].map((name) => ({ name }));
  const window = { WORLD_MAP: { countries } };
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      dataset: {},
      addEventListener(type, handler) { this[type] = handler; },
      querySelector: () => element("fieldset"),
      querySelectorAll: () => [],
      replaceChildren() {},
    });
    return nodes.get(id);
  };
  const context = vm.createContext({ window, document: { getElementById: element }, fetch, URL, URLSearchParams, AbortSignal });
  for (const file of ["trend-config.js", "assistant-place.js", "assistant-question.js", "correlation-assistant.js"]) {
    vm.runInContext(readFileSync(resolve(__dirname, "..", file), "utf8"), context, { filename: file });
  }
  return { window, element };
}

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
  const { window, element } = loadAssistant(async (url, options) => {
    assert.equal(url.pathname, "/functions/v1/climate-assistant-giovanni");
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ reply: "OK" }) };
  });
  element("region-results").dataset = { site: "southern-ontario", point: "44.125,-80.625" };
  const ask = async (question) => {
    element("assistant-question").value = question;
    await element("assistant-form").submit({ preventDefault() {} });
  };
  await ask("What is the correlation between air temperature and relative humidity in the Cerado biome in Brazil?");
  await ask("Find research on rainfall in the Cerrdao from 2012 to 2014.");
  assert.deepEqual(requests, [
    { question: "What is the correlation between air temperature and relative humidity in Cerrado?", region_id: "cerrado" },
    { question: "Find research on rainfall in Cerrado from 2012 to 2014.", region_id: "cerrado" },
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
