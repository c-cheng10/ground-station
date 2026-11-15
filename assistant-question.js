(() => {
  "use strict";

  const aliases = {
    "soil wetness": "GWETROOT", "soil moisture": "GWETROOT", "root-zone soil wetness": "GWETROOT",
    "root zone soil moisture": "GWETROOT", "root zone soil wetness": "GWETROOT",
    windspeed: "WS10M", rain: "PRECTOTCORR", rainfall: "PRECTOTCORR",
  };
  const amounts = ["zero", "one", "two", "three", "four", "five", "six"];
  const amount = `(?:\\d+|${amounts.join("|")}|a|an)`;
  const delayPattern = new RegExp(
    `\\b(?:(?:with|at|using)(?: a| an)? )?(?:(?:lag|delay)(?: of)? (${amount})(?:[- ]months?)?|(${amount})[- ]months?[- ](later|earlier|before|after|lag|delay))\\b`,
    "gi",
  );
  const sameMonth = /\b(?:same[- ]month|same time|simultaneously)\b/gi;
  const blank = (value) => " ".repeat(value.length);
  const cleanQuestion = (question) => question.trim().replace(/[–—‐‑]/g, "-").replace(/\s+/g, " ").replace(/[?!.]+$/, "");

  function splitPlace(prompt) {
    const leading = prompt.match(/^(?:in|near|around|across)\s+(.+?),?\s+(?=(?:what|how|which|has|have|had|is|are|does|do|did|can|could|show|tell|compare)\b)/i)
      ?? prompt.match(/^([^:]+):\s*/);
    if (leading) return { place: leading[1], prompt: blank(leading[0]) + prompt.slice(leading[0].length) };

    const markers = [...prompt.matchAll(/\s+(?:in|near|around|across|at|for)\s+/gi)];
    const trailing = markers.at(-1);
    if (trailing) {
      const start = trailing.index + trailing[0].length;
      const wording = prompt.slice(start).replace(/[,\s]+$/, "");
      const ending = wording.match(/\s+((?:changed|risen|fallen|increased|decreased)(?:\s+over time)?|over time)$/i);
      const place = ending ? wording.slice(0, ending.index).trim() : wording;
      const previous = markers.at(-2);
      const qualified = previous && trailing[0].trim().toLowerCase() === "in" &&
        prompt.slice(previous.index + previous[0].length, trailing.index).trim();
      return {
        place,
        qualifiedPlace: qualified ? `${qualified} in ${place}` : null,
        prompt: prompt.slice(0, trailing.index) + (ending ? ` ${ending[1]}` : ""),
      };
    }
    const direction = prompt.match(/\s+((?:north|south|east|west)\s+of\s+.+?)\s*$/i);
    return direction ? { place: direction[1], prompt: prompt.slice(0, direction.index) } : { place: null, prompt };
  }

  window.climateStudyAreaMention = (question) => splitPlace(cleanQuestion(question)
    .replace(/(?:,|\s+(?:from|between|during|in|since|until|before|after))\s*\d{4}\b.*$/i, ""));

  window.parseClimateAreaQuestion = (question, variables) => {
    const text = cleanQuestion(question);
    if (!text || /\b(?:research|papers?|articles?|studies|citations?|sources?|forecast|predict)\b/i.test(text) ||
      /\b\d{4}s?\b|\b(?:last|past|next|previous)\b[^,.!?]*\b(?:years?|decades?|months?)\b/i.test(text) ||
      /(?:-\d+|\d+\.\d+|\d+\s+to\s+\d+)[- ]months?\b/i.test(text)) return null;

    const delays = [...text.matchAll(delayPattern)];
    const simultaneous = [...text.matchAll(sameMonth)].length > 0;
    if (delays.length > 1) return null;
    const delay = delays[0];
    const count = (delay?.[1] ?? delay?.[2])?.toLowerCase();
    const lag = !count ? 0 : count === "a" || count === "an" ? 1 : amounts.includes(count) ? amounts.indexOf(count) : Number(count);
    if (lag > 6 || (lag && simultaneous)) return null;
    const wording = text.replace(delayPattern, blank).replace(sameMonth, blank);
    if (/\b(?:lag|lags|delay|delays|months?|weeks?|days?)\b/i.test(wording)) return null;

    // Keep the wording offsets so “earlier” and “later” apply to the right measurement.
    const { place: extractedPlace, prompt, qualifiedPlace } = splitPlace(wording);
    let place = extractedPlace;
    if (place && /^[-+]?\d|°/.test(place)) return null;
    if (place && /^(?:here|me|(?:this|the|my) (?:selected )?(?:area|circle|place|region|point))$/i.test(place)) place = null;

    const byName = new Map(Object.entries(aliases));
    for (const { id, name } of variables) byName.set(name.toLowerCase(), id);
    const names = [...byName.keys()].sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const mentions = [...prompt.matchAll(new RegExp(`\\b(?:${names.join("|")})\\b`, "gi"))];
    const ids = [...new Set(mentions.map(([name]) => byName.get(name.toLowerCase())))];
    const correlation = /\b(?:correlat\w*|relation\w*|related|association|associated|linked|compare)\b|\bmove together\b/i.test(prompt);
    if (correlation && ids.length === 2) {
      const direction = delay?.[3]?.toLowerCase();
      if (lag && ["before", "earlier", "after", "later"].includes(direction)) {
        const preceding = new Set(mentions.filter(({ index }) => index < delay.index).map(([name]) => byName.get(name.toLowerCase())));
        if (!preceding.size) return null;
        const secondMeasurement = preceding.size === 2 || preceding.has(ids[1]);
        const earlier = direction === "before" || direction === "earlier";
        if (secondMeasurement === earlier) ids.reverse();
      }
      return { kind: "correlation", place, qualifiedPlace, ids, lag };
    }
    const trend = /\b(?:trends?|chang(?:e|es|ed|ing)|ris(?:e|es|en|ing)|rose|increas\w*|decreas\w*|fall(?:s|en|ing)?|fell|declin\w*|warm(?:ed|ing)|cool(?:ed|ing))\b|\bover time\b/i.test(prompt);
    return !correlation && trend && ids.length === 1 && !delay
      ? { kind: "trend", place, qualifiedPlace, ids, lag: 0 }
      : null;
  };
})();
