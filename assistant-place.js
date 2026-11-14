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
  const unresolved = (message) => ({ kind: "unresolved", message });
  const findCountry = (key) => window.WORLD_MAP?.countries.find(({ name }) =>
    normalize(countryNames.get(key) ?? key) === normalize(name));

  async function resolve(name, { signal } = {}) {
    const input = typeof name === "string" ? name.trim() : "";
    const [city, qualifier, countryQualifier, ...extra] = input.split(",").map((part) => part.trim());
    if (input.length < 2 || input.length > 100 || extra.length ||
        [city, qualifier, countryQualifier].some((part) =>
          part !== undefined && !/^\p{L}[\p{L}\p{M} .’'\p{Pd}]*$/u.test(part))) {
      return unresolved("Use a country name or a city with its state, province or country.");
    }

    const key = normalize(input).replace(/^the /, "");
    const country = findCountry(key);
    if (country) return { kind: "country", country };

    const directional = input.match(/^(the\s+)?(north|south|east|west)(ern\s+(?:part\s+of\s+)?|\s+of\s+)(.+)$/i);
    if (directional) {
      const [, article, direction, connector, base] = directional;
      const bearing = direction.toLowerCase();
      const interior = Boolean(article) || /^ern/i.test(connector);
      const result = await resolve(base, { signal });
      if (result.kind === "unresolved") return result;
      if (result.direction || (interior && !result.country)) {
        return unresolved("Use a direction within a country, or say “north of” or “south of” a city.");
      }
      const label = result.displayName ?? result.country?.name ?? result.name;
      const title = bearing[0].toUpperCase() + bearing.slice(1);
      return { ...result, direction: bearing, interior, displayName: interior ? `${title}ern ${label}` : `${title} of ${label}` };
    }

    const cityKey = normalize(city);
    const isWashingtonDC = cityKey === "washington" && qualifier && normalize(qualifier) === "dc";
    const searchName = isWashingtonDC ? "Washington D.C." : cityNames.get(cityKey) ?? city;
    const searchQualifier = isWashingtonDC ? countryQualifier : qualifier;
    const expectedCountry = countryQualifier && normalize(countryQualifier);
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: searchQualifier ? `${searchName}, ${searchQualifier}` : searchName, count: 10, language: "en" });
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("The place search is unavailable. Try again, or select the area on the map.");
    const { results } = await response.json();
    const candidates = (Array.isArray(results) ? results : []).filter((place) =>
      typeof place?.name === "string" && normalize(place.name) === normalize(searchName) &&
      typeof place.feature_code === "string" && place.feature_code.startsWith("PPL") &&
      (!expectedCountry || [place.country, place.country_code].some((countryName) =>
        typeof countryName === "string" && normalize(countryName) === expectedCountry)) &&
      Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
      Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    ).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    const [best, second] = candidates;
    if (!best) return unresolved(`I couldn’t find “${input}”. Check the spelling or include its state, province or country.`);

    // shortcut: qualify close matches until the assistant offers a place picker.
    if (second && (!best.population || best.population < 10_000 || best.population < 10 * (second.population ?? 0))) {
      return unresolved(`More than one city matches “${input}”. Include its state, province or country.`);
    }
    const names = [best.name, best.admin1, best.country].filter((part) => typeof part === "string" && part.trim());
    const displayName = names.filter((part, index) => names.findIndex((name) => normalize(name) === normalize(part)) === index)
      .join(", ");
    return { kind: "city", name: best.name, displayName, latitude: best.latitude, longitude: best.longitude };
  }

  window.AssistantPlace = { normalize, resolve };
})();
