(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const dialog = byId("onboarding");
  const form = byId("onboarding-form");
  const fields = byId("onboarding-fields");
  const start = byId("onboarding-start");
  const status = byId("onboarding-status");
  const variables = new Map(window.TREND_CONFIG.variables.map(({ id, name }) => [id, name]));
  const roles = {
    farmer: { name: "farmer", variable: "GWETROOT" },
    policymaker: { name: "policymaker", variable: "T2M" },
    researcher: { name: "student researcher", variable: "PRECTOTCORR" },
  };
  const seenKey = "climate-explorer-onboarding-seen";
  let pending;

  async function interpret(role, place, interest, signal) {
    const question = interest
      ? `As a ${role.name}, what is the historical climate trend in “${place}” for ${interest}?`
      : `As a ${role.name}, what is the historical ${variables.get(role.variable).toLowerCase()} trend in “${place}”?`;
    let intent;
    try {
      const answer = await window.CorrelationAssistant.ask({ mode: "interpret", question, has_selection: false },
        AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
      intent = answer?.intent;
    } catch {
      signal.throwIfAborted();
    }

    const interpretedVariable = intent?.variable_ids?.[0];
    const id = typeof interpretedVariable === "string" ? interpretedVariable.toUpperCase() : "";
    const match = ["trend", "correlation"].includes(intent?.kind) && variables.has(id);
    const plain = place.replace(/^(?:in|near|around)\s+/i, "");
    const normalize = (value) => value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
    // Keep the entered geography if the model picked a different place mentioned in the interest.
    const samePlace = typeof intent?.place === "string" && normalize(intent.place) === normalize(plain);
    return { place: samePlace ? intent.place : place, variable: match ? id : role.variable, fallback: !match };
  }

  function dismiss() {
    dialog.close();
    try { localStorage.setItem(seenKey, "1"); } catch { /* Storage can be unavailable. */ }
  }

  function skip() {
    pending?.abort();
    dismiss();
  }

  byId("onboarding-skip").addEventListener("click", skip);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    skip();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
  byId("show-onboarding").addEventListener("click", () => {
    byId("help").close();
    dialog.showModal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    const { role, place, interest } = form.elements;
    if (!Object.hasOwn(roles, role.value)) return;
    if (!place.value.trim()) {
      status.textContent = "Enter a place to explore.";
      place.focus();
      return;
    }

    pending = new AbortController();
    const { signal } = pending;
    fields.disabled = true;
    start.disabled = true;
    status.textContent = "Choosing a heatmap…";
    try {
      const result = await interpret(roles[role.value], place.value.trim(), interest.value.trim(), signal);
      signal.throwIfAborted();
      status.textContent = result.fallback
        ? `Finding ${result.place} with the ${variables.get(result.variable).toLowerCase()} heatmap…`
        : `Finding ${result.place} on the globe…`;
      await window.selectOnboardingArea({ place: result.place, variable: result.variable, signal });
      signal.throwIfAborted();
      dismiss();
      byId("drawer-title").focus({ preventScroll: true });
    } catch (error) {
      if (!signal.aborted) status.textContent = error instanceof Error ? error.message : "Could not open the map. Try again.";
    } finally {
      pending = null;
      fields.disabled = false;
      start.disabled = false;
      if (!dialog.open) status.textContent = "";
    }
  });

  let seen;
  try { seen = localStorage.getItem(seenKey); } catch { /* Storage can be unavailable. */ }
  if (!seen) dialog.showModal();
})();
