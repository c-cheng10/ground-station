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

  window.parseClimateAreaQuestion = (question, variables) => {
    const text = question.trim().replace(/[–—‐‑]/g, "-").replace(/\s+/g, " ").replace(/[?!.]+$/, "");
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
    let prompt = text.replace(delayPattern, blank).replace(sameMonth, blank);
    if (/\b(?:lag|lags|delay|delays|months?|weeks?|days?)\b/i.test(prompt)) return null;

    // Keep the wording offsets so “earlier” and “later” apply to the right measurement.
    let place = null;
    const leading = prompt.match(/^(?:in|near|around|across)\s+(.+?),?\s+(?=(?:what|how|which|has|have|had|is|are|does|do|did|can|could|show|tell|compare)\b)/i)
      ?? prompt.match(/^([^:]+):\s*/);
    if (leading) {
      place = leading[1];
      prompt = blank(leading[0]) + prompt.slice(leading[0].length);
    } else {
      const trailing = [...prompt.matchAll(/\s+(?:in|near|around|across|at|for)\s+/gi)].at(-1);
      if (trailing) {
        place = prompt.slice(trailing.index + trailing[0].length).replace(/[,\s]+$/, "");
        const ending = place.match(/\s+((?:changed|risen|fallen|increased|decreased)\s*(?:over time)?)$/i);
        if (ending) place = place.slice(0, ending.index).trim();
        prompt = prompt.slice(0, trailing.index);
        if (ending) prompt += ` ${ending[1]}`;
      } else {
        const direction = prompt.match(/\s+((?:north|south|east|west)\s+of\s+.+?)\s*$/i);
        if (direction) {
          place = direction[1];
          prompt = prompt.slice(0, direction.index);
        }
      }
    }
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
      return { kind: "correlation", place, ids, lag };
    }
    const trend = /\b(?:trends?|chang(?:e|es|ed|ing)|ris(?:e|es|en|ing)|rose|increas\w*|decreas\w*|fall(?:s|en|ing)?|fell|declin\w*|warm(?:ed|ing)|cool(?:ed|ing))\b|\bover time\b/i.test(prompt);
    return !correlation && trend && ids.length === 1 && !delay
      ? { kind: "trend", place, ids, lag: 0 }
      : null;
  };
})();
