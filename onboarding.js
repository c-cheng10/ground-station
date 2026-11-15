(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const dialog = byId("onboarding");
  const form = byId("onboarding-form");
  const fields = byId("onboarding-fields");
  const start = byId("onboarding-start");
  const back = byId("onboarding-back");
  const status = byId("onboarding-status");
  const title = byId("onboarding-title");
  const locate = byId("onboarding-locate");
  const locationNote = byId("onboarding-location-note");
  const steps = [
    { page: byId("onboarding-role-step"), title: "Which role fits you?" },
    { page: byId("onboarding-place-step"), title: "Where are you looking?" },
    { page: byId("onboarding-interest-step"), title: "What are you interested in?" },
  ];
  const variables = new Map(window.TREND_CONFIG.variables.map(({ id, name }) => [id, name]));
  const roles = {
    farmer: { name: "farmer", variable: "GWETROOT" },
    policymaker: { name: "policymaker", variable: "T2M" },
    researcher: { name: "student researcher", variable: "PRECTOTCORR" },
  };
  let step = 0;
  let coordinates;
  let locationRequest;
  let pending;

  async function interpret(role, place, interest, signal) {
    const context = role.custom ? `As someone who describes their role as “${role.name}”` : `As a ${role.name}`;
    const where = place ? `in “${place}”` : "in this area";
    const question = interest ? `${context}, what is the historical climate trend ${where} for ${interest}?`
      : role.custom ? `${context}, which historical climate trend ${where} should I look at for this work?`
        : `${context}, what is the historical ${variables.get(role.variable).toLowerCase()} trend ${where}?`;
    let intent;
    try {
      const answer = await window.CorrelationAssistant.ask({ mode: "interpret", question, has_selection: !place },
        AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
      intent = answer?.intent;
    } catch {
      signal.throwIfAborted();
    }

    const interpretedVariable = intent?.variable_ids?.[0];
    const id = typeof interpretedVariable === "string" ? interpretedVariable.toUpperCase() : "";
    const match = ["trend", "correlation"].includes(intent?.kind) && variables.has(id);
    const plain = place?.replace(/^(?:in|near|around)\s+/i, "");
    const normalize = (value) => value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
    // Keep the entered geography if the model picked a different place mentioned in the interest.
    const samePlace = plain && typeof intent?.place === "string" && normalize(intent.place) === normalize(plain);
    return { place: samePlace ? intent.place : place, variable: match ? id : role.variable, fallback: !match };
  }

  function stopLocating() {
    if (locationRequest) locationNote.textContent = "";
    locationRequest = undefined;
    locate.disabled = false;
  }

  function showStep(next) {
    stopLocating();
    step = next;
    steps.forEach(({ page }, index) => { page.hidden = index !== step; });
    title.textContent = steps[step].title;
    byId("onboarding-progress").textContent = `${step + 1} of ${steps.length}`;
    back.hidden = step === 0;
    start.textContent = step === steps.length - 1 ? "Open my map" : "Next";
    status.textContent = "";
    title.focus({ preventScroll: true });
  }

  steps[0].page.addEventListener("change", () => {
    byId("onboarding-custom-role-field").hidden = form.elements.role.value !== "other";
    status.textContent = "";
  });
  back.addEventListener("click", () => {
    if (step && !pending) showStep(step - 1);
  });
  byId("onboarding-place").addEventListener("input", () => {
    stopLocating();
    coordinates = undefined;
    locationNote.textContent = "";
    status.textContent = "";
  });
  locate.addEventListener("click", () => {
    if (!navigator.geolocation) {
      locationNote.textContent = "Device location is unavailable. Enter a place instead.";
      return;
    }
    const request = {};
    locationRequest = request;
    coordinates = undefined;
    locate.disabled = true;
    status.textContent = "";
    locationNote.textContent = "Finding your location…";
    const isCurrent = () => dialog.open && step === 1 && locationRequest === request;
    navigator.geolocation.getCurrentPosition(({ coords: { latitude, longitude } }) => {
      if (!isCurrent()) return;
      stopLocating();
      coordinates = { latitude, longitude };
      form.elements.place.value = "";
      locationNote.textContent = "Device location selected.";
    }, (error) => {
      if (!isCurrent()) return;
      stopLocating();
      locationNote.textContent = error.code === 1
        ? "Location permission is off. Enter a place instead."
        : "Couldn’t find your location. Enter a place instead.";
    }, { timeout: 10_000 });
  });

  function dismiss() {
    stopLocating();
    dialog.close();
  }

  function skip() {
    pending?.abort();
    dismiss();
  }

  function open() {
    dialog.showModal();
    showStep(0);
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
    open();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    const { role, customRole, place, interest } = form.elements;
    const ownRole = role.value === "other";
    const profile = ownRole ? { name: customRole.value.trim(), variable: "T2M", custom: true }
      : Object.hasOwn(roles, role.value) && roles[role.value];
    if (step === 0) {
      if (!profile?.name) {
        status.textContent = ownRole ? "Describe your role to continue." : "Choose a role to continue.";
        if (ownRole) customRole.focus();
      } else showStep(1);
      return;
    }
    const enteredPlace = place.value.trim();
    if (step === 1) {
      if (enteredPlace || coordinates) showStep(2);
      else {
        status.textContent = "Enter a place or use your device location.";
        if (!locationRequest) place.focus();
      }
      return;
    }

    pending = new AbortController();
    const { signal } = pending;
    fields.disabled = true;
    start.disabled = true;
    back.disabled = true;
    status.textContent = "Choosing a heatmap…";
    try {
      const result = await interpret(profile, coordinates ? undefined : enteredPlace, interest.value.trim(), signal);
      signal.throwIfAborted();
      const location = result.place ?? "your area";
      status.textContent = result.fallback
        ? `Finding ${location} with the ${variables.get(result.variable).toLowerCase()} heatmap…`
        : `Finding ${location} on the globe…`;
      const target = coordinates ? { coordinates } : { place: result.place };
      await window.selectOnboardingArea({ ...target, variable: result.variable, signal });
      signal.throwIfAborted();
      dismiss();
      byId("drawer-title").focus({ preventScroll: true });
    } catch (error) {
      if (!signal.aborted) status.textContent = error instanceof Error ? error.message : "Could not open the map. Try again.";
    } finally {
      pending = null;
      fields.disabled = false;
      start.disabled = false;
      back.disabled = false;
      if (!dialog.open) status.textContent = "";
    }
  });

  open();
})();
