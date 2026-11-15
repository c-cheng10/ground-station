(() => {
  "use strict";

  const normalize = (name) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\./g, "").replace(/’/g, "'").replace(/\s+/g, " ").trim();
  const countryNames = new Map(Object.entries({
    "us": "United States of America",
    "usa": "United States of America",
    "united states": "United States of America",
    "uk": "United Kingdom",
    "turkiye": "Turkey",
    "czech republic": "Czechia",
  }));
  const cityNames = new Map([
    ["new york city", "New York"],
    ["quebec city", "Québec"],
    ["washington dc", "Washington D.C."],
  ]);
  const studyAreaAliases = {
    cerrado: ["Brazilian Cerrado", "Cerrado savanna", "Cerrado savannah"],
    "central-amazon": ["Amazon rainforest", "Central Amazon rainforest"],
  };
  const unresolved = (message) => ({ kind: "unresolved", message });
  const nameKey = (name) => normalize(name).replace(/^the /, "").replace(/\p{Pd}+/gu, " ").replace(/\s+/g, " ").trim();
  const canonicalCountry = (name) => {
    const key = nameKey(name);
    return nameKey(countryNames.get(key) ?? key);
  };
  const findCountry = (key) => window.WORLD_MAP?.countries.find(({ name }) =>
    canonicalCountry(key) === canonicalCountry(name));

  function nameDistance(input, label) {
    const rows = [Array.from({ length: label.length + 1 }, (_, index) => index)];
    for (let i = 1; i <= input.length; i++) {
      const row = [i];
      for (let j = 1; j <= label.length; j++) {
        const cost = Number(input[i - 1] !== label[j - 1]);
        row[j] = Math.min(row[j - 1] + 1, rows[i - 1][j] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && input[i - 1] === label[j - 2] && input[i - 2] === label[j - 1]) {
          row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
        }
      }
      rows.push(row);
    }
    return rows[input.length][label.length];
  }

  function closestName(input, entries, labels, limit = input.length >= 12 ? 2 : input.length >= 6 ? 1 : 0) {
    const matches = [];
    for (const entry of entries) {
      const distance = Math.min(...labels(entry).map((label) => {
        const key = nameKey(label);
        if (key === input) return 0;
        return !limit || Math.abs(key.length - input.length) > limit ? Infinity : nameDistance(input, key);
      }));
      if (distance <= limit) matches.push({ entry, distance });
    }
    matches.sort((a, b) => a.distance - b.distance);
    const [first, second] = matches;
    return first && first.distance === second?.distance ? { ambiguous: true } : { entry: first?.entry };
  }

  function findStudyArea(place, sites) {
    if (!place) return {};
    const [name, qualifier, extra] = place.split(/,|\s+in\s+/i).map(nameKey);
    if (!name || extra !== undefined) return {};
    const key = name.replace(/ (?:biome|ecoregion|study area)$/, "");
    const match = closestName(key, sites, ({ id, name }) => [name, id, ...(studyAreaAliases[id] ?? [])]);
    if (!match.entry || !qualifier) return match;
    const region = nameKey(match.entry.region);
    return canonicalCountry(region) === canonicalCountry(qualifier) ? match : { wrongCountry: match.entry };
  }

  function findRegion(name, qualifier, fuzzy = false) {
    const regions = window.ADMIN1_REGIONS ?? [];
    const country = qualifier && canonicalCountry(qualifier);
    const entries = country ? regions.filter(([, nation]) => canonicalCountry(nation) === country) : regions;
    const labels = ([title, , code, , aliases]) =>
      [title, code, ...aliases.filter((alias) => qualifier || alias.length > 3)].filter(Boolean);
    const stripped = name.replace(/^(?:province|state|territory) of /, "").replace(/ (?:province|state|territory)$/, "");
    const exact = closestName(name, entries, labels, 0);
    if (exact.entry || exact.ambiguous) return exact;
    if (stripped !== name || fuzzy) return closestName(stripped, entries, labels, fuzzy ? undefined : 0);
    return {};
  }

  function regionPlace(match, input) {
    if (match.ambiguous) return unresolved(`More than one state or province matches “${input}”. Include its country.`);
    const [name, country, code, samples] = match.entry;
    return { kind: "region", displayName: `${name}, ${country}`, region: { name, country, code, samples } };
  }

  async function resolve(name, { signal } = {}) {
    const input = typeof name === "string" ? name.trim() : "";
    const [city, qualifier, countryQualifier, ...extra] = input.split(/,|\s+in\s+/i).map((part) => part.trim());
    if (input.length < 2 || input.length > 100 || extra.length ||
        [city, qualifier, countryQualifier].some((part) =>
          part !== undefined && !/^\p{L}[\p{L}\p{M}\p{N} .’'\p{Pd}]*$/u.test(part))) {
      return unresolved("Enter a country, state, province or city.");
    }

    const key = normalize(input).replace(/^the /, "");
    const country = findCountry(key);
    if (country) return { kind: "country", country };

    const cityKey = nameKey(city);
    const lookupRegion = !countryQualifier && !cityNames.has(cityKey) && !cityKey.startsWith("city of ");
    if (lookupRegion) {
      const match = findRegion(cityKey, qualifier);
      if (match.entry || match.ambiguous) return regionPlace(match, input);
    }

    const directional = input.match(/^(the\s+)?(north|south|east|west)(ern\s+(?:part\s+of\s+)?|\s+of\s+)(.+)$/i);
    if (directional) {
      const [, article, direction, connector, base] = directional;
      const bearing = direction.toLowerCase();
      const interior = Boolean(article) || /^ern/i.test(connector);
      const result = await resolve(base, { signal });
      if (result.kind === "unresolved") return result;
      if (result.region && !interior) {
        return unresolved("Use a direction within a state or province, such as “northern Ontario”.");
      }
      if (result.direction || (interior && !result.country && !result.region)) {
        return unresolved("Use a direction within a country, state or province, or say “north of” or “south of” a city.");
      }
      const label = result.displayName ?? result.country?.name ?? result.name;
      const title = bearing[0].toUpperCase() + bearing.slice(1);
      return { ...result, direction: bearing, interior, displayName: interior ? `${title}ern ${label}` : `${title} of ${label}` };
    }

    if (/\b(?:biome|ecoregion)$/.test(nameKey(city)) || /^(?:sahel|rain[ -]?forest|savann?ah?|tundra|taiga|desert|steppe)$/.test(key)) {
      return unresolved(`There’s no saved study area for “${input}”. Use Magic select on the globe to choose the grid points to compare.`);
    }

    const isWashingtonDC = cityKey === "washington" && qualifier && normalize(qualifier) === "dc";
    const searchName = isWashingtonDC ? "Washington D.C." : cityNames.get(cityKey) ?? city.replace(/^city of\s+/i, "");
    const searchQualifier = isWashingtonDC ? countryQualifier : qualifier;
    const expectedCountry = countryQualifier && canonicalCountry(countryQualifier);
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: searchQualifier ? `${searchName}, ${searchQualifier}` : searchName, count: 10, language: "en" });
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("The place search is unavailable. Try again, or select the area on the map.");
    const { results } = await response.json();
    const candidates = (Array.isArray(results) ? results : []).filter((place) =>
      typeof place?.name === "string" && normalize(place.name) === normalize(searchName) &&
      typeof place.feature_code === "string" && place.feature_code.startsWith("PPL") &&
      (!expectedCountry || [place.country, place.country_code].some((countryName) =>
        typeof countryName === "string" && canonicalCountry(countryName) === expectedCountry)) &&
      Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
      Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    ).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    const [best, second] = candidates;
    if (!best) {
      const nearby = !qualifier && closestName(nameKey(input), window.WORLD_MAP?.countries ?? [], ({ name }) => [name]);
      if (nearby?.entry) return { kind: "country", country: nearby.entry };
      if (nearby?.ambiguous) return unresolved(`More than one country matches “${input}”. Enter the full country name.`);
      if (lookupRegion) {
        const match = findRegion(cityKey, qualifier, true);
        if (match.entry || match.ambiguous) return regionPlace(match, input);
      }
      return unresolved(`I couldn’t find “${input}”. Check the spelling, add a country or use Magic select on the globe.`);
    }

    // shortcut: qualify close matches until the assistant offers a place picker.
    if (second && (!best.population || best.population < 10_000 || best.population < 10 * (second.population ?? 0))) {
      return unresolved(`More than one city matches “${input}”. Include its state, province or country.`);
    }
    const names = [best.name, best.admin1, best.country].filter((part) => typeof part === "string" && part.trim());
    const displayName = names.filter((part, index) => names.findIndex((name) => normalize(name) === normalize(part)) === index)
      .join(", ");
    return { kind: "city", name: best.name, displayName, latitude: best.latitude, longitude: best.longitude };
  }

  window.AssistantPlace = { findStudyArea, resolve };
})();
