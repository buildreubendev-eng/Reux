// Business Simulator — Sellable Product Frontend
// API client, state, and all UI flows

const API = "/api";
const state = { view: "hero", templateId: null, template: null, baseline: null, scenarios: [], result: null, savedRunId: null };

const assumptionLabels = {
  employees: { label: "Employees", type: "int", group: "workforce" },
  averageHourlyCost: { label: "Avg Hourly Cost ($)", type: "currency", group: "workforce" },
  weeklyDemand: { label: "Weekly Demand", type: "int", group: "demand" },
  averageOrderValue: { label: "Avg Order Value ($)", type: "currency", group: "demand" },
  grossMarginRate: { label: "Gross Margin Rate", type: "rate", group: "financial" },
  productivityGainRate: { label: "Productivity Gain Rate", type: "rate", group: "operational" },
  overtimeReductionRate: { label: "Overtime Reduction Rate", type: "rate", group: "operational" },
  supplierDelayRiskRate: { label: "Supplier Delay Risk", type: "rate", group: "risk" },
  defectRate: { label: "Defect Rate", type: "rate", group: "risk" },
  forecastPeriods: { label: "Forecast Periods", type: "int", group: "forecast" },
  forecastUnit: { label: "Forecast Unit", type: "select", options: ["week", "month", "quarter"], group: "forecast" },
};

const metricLabels = {
  marginDelta: "Margin", productivity: "Productivity", operatingCost: "Operating Cost",
  riskScore: "Risk Score", revenue: "Revenue", laborCost: "Labor Cost",
  workforceLoad: "Workforce Load", margin: "Margin (abs)", defectCost: "Defect Cost",
};
const goodDirection = { marginDelta: "increase", productivity: "increase", operatingCost: "decrease", riskScore: "decrease", revenue: "increase", margin: "increase" };

const templateIcons = { "operations-decision": "\u2699\uFE0F", "capacity-planning": "\uD83D\uDCCA", "staffing-plan": "\uD83D\uDC65", "pricing-strategy": "\uD83D\uDCB0" };

function sessionId() {
  const key = "reuxSimSessionId";
  let id = localStorage.getItem(key);
  if (!id) { const b = new Uint8Array(8); crypto.getRandomValues(b); id = [...b].map(x => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem(key, id); }
  return id;
}

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { headers: { "x-reux-demo-session": sessionId() } });
  return handleResponse(r);
}
async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-reux-demo-session": sessionId() }, body: JSON.stringify(body) });
  return handleResponse(r);
}
async function handleResponse(r) {
  const body = await r.json();
  if (!r.ok) {
    const err = new Error(body.message || body.error || `Request failed (${r.status})`);
    err.code = body.code; err.category = body.category; err.retryable = body.retryable;
    err.userAction = body.userAction; err.issues = body.issues; err.expiresAt = body.expiresAt;
    throw err;
  }
  return body;
}

// ─── DOM helpers ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) { if (typeof c === "string") e.append(c); else if (c) e.append(c); }
  return e;
}
function show(id) { const e = typeof id === "string" ? $(id) : id; if (e) e.hidden = false; }
function hide(id) { const e = typeof id === "string" ? $(id) : id; if (e) e.hidden = true; }
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }
function setHtml(id, h) { const e = $(id); if (e) e.innerHTML = h; }

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function fmtNum(n, unit) {
  if (unit === "USD") return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (unit === "percent") return Number(n).toFixed(1) + "%";
  if (unit === "index") return Number(n).toFixed(2);
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtDelta(d) {
  const abs = Math.abs(d.delta);
  const prefix = d.direction === "increase" ? "+" : d.direction === "decrease" ? "-" : "";
  return prefix + fmtNum(abs, d.unit);
}
function notify(msg, error = false) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("error", error); t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2800);
}

// ─── Field-level validation ───
function clearFieldErrors() {
  for (const el of $$(".sim-field-error")) el.remove();
  for (const el of $$(".sim-input-error")) el.classList.remove("sim-input-error");
}
function markFieldError(inputId, message) {
  const input = $("#" + inputId) || $(`[data-field="${inputId}"]`);
  if (!input) return false;
  input.classList.add("sim-input-error");
  const errEl = el("span", { className: "sim-field-error" }, message);
  input.parentElement.append(errEl);
  return true;
}
function mapIssuesToFields(issues) {
  if (!issues?.length) return false;
  let mapped = 0;
  for (const issue of issues) {
    const path = issue.path || "";
    // baseline.employees → bl_employees
    const baselineMatch = path.match(/^baseline\.(.+)$/);
    if (baselineMatch) {
      if (markFieldError(`bl_${baselineMatch[1]}`, issue.message)) { mapped++; continue; }
    }
    // scenarios[0].assumptions.employees → sc_0_employees
    const scenarioMatch = path.match(/^scenarios\[(\d+)\]\.assumptions\.(.+)$/);
    if (scenarioMatch) {
      if (markFieldError(`sc_${scenarioMatch[1]}_${scenarioMatch[2]}`, issue.message)) { mapped++; continue; }
    }
    // scenarios[0].name → sc_0_name
    const scenarioNameMatch = path.match(/^scenarios\[(\d+)\]\.(.+)$/);
    if (scenarioNameMatch) {
      if (markFieldError(`sc_${scenarioNameMatch[1]}_${scenarioNameMatch[2]}`, issue.message)) { mapped++; continue; }
    }
  }
  return mapped > 0;
}

// ─── View Router ───
function navigate(view) {
  state.view = view;
  for (const sec of ["#simHero","#templateSection","#runSection","#resultsSection","#savedRunsSection"]) hide(sec);
  if (view === "hero") show("#simHero");
  else if (view === "templates") { show("#templateSection"); loadTemplates(); }
  else if (view === "run") show("#runSection");
  else if (view === "results") show("#resultsSection");
  else if (view === "saved") { show("#savedRunsSection"); loadSavedRuns(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Template Selection ───
async function loadTemplates() {
  hide("#templateError"); hide("#templateGrid"); show("#templateLoading");
  try {
    const data = await apiGet("/simulations");
    const grid = $("#templateGrid");
    grid.innerHTML = "";
    for (const sim of data.simulations) {
      const icon = templateIcons[sim.id] || "\uD83D\uDCCB";
      const card = el("button", { className: "sim-template-card", type: "button", onClick: () => selectTemplate(sim.id) },
        el("span", { className: "sim-template-icon" }, icon),
        el("strong", {}, sim.name),
        el("p", {}, sim.description),
        el("span", { className: "sim-template-domain" }, sim.domain),
      );
      grid.append(card);
    }
    hide("#templateLoading"); show("#templateGrid");
  } catch (err) {
    hide("#templateLoading"); setText("#templateErrorMessage", err.message); show("#templateError");
  }
}

async function selectTemplate(id) {
  try {
    const data = await apiGet(`/simulations/${encodeURIComponent(id)}`);
    state.templateId = id;
    state.template = data;
    state.baseline = { ...data.defaultAssumptions };
    state.scenarios = data.exampleScenarios.map(s => ({ ...s, assumptions: { ...s.assumptions } }));
    setText("#selectedTemplateName", data.simulation.name);
    setText("#selectedTemplateDescription", data.simulation.description);
    renderBaselineForm();
    renderScenarios();
    navigate("run");
  } catch (err) {
    notify(err.message, true);
  }
}

// ─── Baseline Assumptions Form ───
function renderBaselineForm() {
  const form = $("#baselineForm");
  form.innerHTML = "";
  for (const [key, meta] of Object.entries(assumptionLabels)) {
    const val = state.baseline[key];
    const display = meta.type === "rate" ? (val * 100).toFixed(1) : val;
    const label = el("label", {},
      el("span", {}, meta.label),
      meta.type === "select"
        ? (() => { const sel = el("select", { id: `bl_${key}`, "data-field": `bl_${key}` }); meta.options.forEach(o => { const opt = el("option", { value: o }, o); if (o === val) opt.selected = true; sel.append(opt); }); sel.addEventListener("change", () => { state.baseline[key] = sel.value; }); return sel; })()
        : (() => { const inp = el("input", { id: `bl_${key}`, "data-field": `bl_${key}`, type: "number", value: String(display), step: meta.type === "rate" ? "0.1" : "1", inputmode: "decimal" }); inp.addEventListener("change", () => { state.baseline[key] = meta.type === "rate" ? Number(inp.value) / 100 : Number(inp.value); }); return inp; })()
    );
    form.append(label);
  }
}

// ─── Scenarios ───
function renderScenarios() {
  const list = $("#scenarioList");
  list.innerHTML = "";
  setText("#scenarioCount", `${state.scenarios.length} scenario${state.scenarios.length !== 1 ? "s" : ""}`);
  state.scenarios.forEach((sc, idx) => {
    const card = el("div", { className: "sim-scenario-card" });
    const header = el("div", { className: "sim-scenario-header" },
      el("input", { className: "sim-scenario-name", value: sc.name, placeholder: "Scenario name", onChange: (e) => { sc.name = e.target.value; } }),
      el("button", { className: "sim-remove-btn", type: "button", title: "Remove scenario", onClick: () => { state.scenarios.splice(idx, 1); renderScenarios(); } }, "\u00D7"),
    );
    card.append(header);
    const descInput = el("input", { className: "sim-scenario-desc", value: sc.description || "", placeholder: "Brief description", onChange: (e) => { sc.description = e.target.value; } });
    card.append(descInput);
    const grid = el("div", { className: "sim-scenario-overrides" });
    const overrideKeys = Object.keys(assumptionLabels).filter(k => k !== "forecastPeriods" && k !== "forecastUnit");
    for (const key of overrideKeys) {
      const meta = assumptionLabels[key];
      const hasOverride = sc.assumptions[key] !== undefined;
      const val = hasOverride ? (meta.type === "rate" ? (sc.assumptions[key] * 100).toFixed(1) : sc.assumptions[key]) : "";
      const fieldId = `sc_${idx}_${key}`;
      const inp = el("input", { id: fieldId, "data-field": fieldId, type: "number", placeholder: meta.label, value: String(val), step: meta.type === "rate" ? "0.1" : "1", inputmode: "decimal", title: `${meta.label} override (leave empty to use baseline)` });
      inp.addEventListener("change", () => {
        if (inp.value === "") { delete sc.assumptions[key]; }
        else { sc.assumptions[key] = meta.type === "rate" ? Number(inp.value) / 100 : Number(inp.value); }
      });
      if (hasOverride) inp.classList.add("sim-override-active");
      inp.addEventListener("input", () => inp.classList.toggle("sim-override-active", inp.value !== ""));
      grid.append(el("label", { className: "sim-override-label" }, el("span", {}, meta.label), inp));
    }
    card.append(grid);
    list.append(card);
  });
}

// ─── Run Simulation ───
async function runSim() {
  hide("#runError"); show("#runLoading"); clearFieldErrors();
  try {
    const body = {
      simulationId: state.templateId,
      baseline: state.baseline,
      scenarios: state.scenarios.map(s => ({ id: s.id || slugify(s.name), name: s.name, description: s.description, assumptions: s.assumptions })),
    };
    const result = await apiPost("/simulations/run", body);
    state.result = result;
    state.savedRunId = result.run?.id || null;
    renderResults(result);
    navigate("results");
    notify("Simulation complete");
  } catch (err) {
    hide("#runLoading");
    // Map field-level validation errors to inputs
    const hasMappedFields = mapIssuesToFields(err.issues);
    setText("#runErrorTitle", err.category === "validation" ? "Validation Error" : "Simulation Failed");
    let msg = err.message;
    // Only show unmapped issues in the page-level block
    if (err.issues?.length && !hasMappedFields) {
      msg += "\n" + err.issues.map(i => `• ${i.path}: ${i.message}`).join("\n");
    } else if (err.issues?.length && hasMappedFields) {
      const unmapped = err.issues.filter(i => !$("#" + issuePath2FieldId(i.path)));
      if (unmapped.length) msg += "\n" + unmapped.map(i => `• ${i.path}: ${i.message}`).join("\n");
    }
    setText("#runErrorMessage", msg);
    setText("#runErrorAction", err.userAction || "");
    if (err.retryable) show("#runRetry"); else hide("#runRetry");
    show("#runError");
  }
}

function issuePath2FieldId(path) {
  if (!path) return "";
  const bl = path.match(/^baseline\.(.+)$/);
  if (bl) return `bl_${bl[1]}`;
  const sc = path.match(/^scenarios\[(\d+)\]\.assumptions\.(.+)$/);
  if (sc) return `sc_${sc[1]}_${sc[2]}`;
  const scn = path.match(/^scenarios\[(\d+)\]\.(.+)$/);
  if (scn) return `sc_${scn[1]}_${scn[2]}`;
  return "";
}

function slugify(s) { return (s || "scenario").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario"; }

// ─── Render Results ───
function renderResults(data) {
  const rec = data.comparison?.recommendation;
  const run = data.run;

  // Run metadata
  if (run) {
    show("#runMeta");
    setHtml("#runMetaSummary", `<strong>${esc(run.displayTitle)}</strong><br><span class="sim-meta-sub">${esc(run.displaySubtitle)} &middot; ${esc(run.shareLabel)}</span>`);
    if (run.resultSummary) { setHtml("#runMetaSummary", $("#runMetaSummary").innerHTML + `<p class="sim-result-summary">${esc(run.resultSummary)}</p>`); }
    if (run.keyMetric) { show("#runMetaKeyMetric"); setHtml("#runMetaKeyMetric", `<span class="sim-km-label">${esc(run.keyMetric.label)}</span><strong class="sim-km-value">${fmtNum(run.keyMetric.value, run.keyMetric.unit)}</strong>${run.keyMetric.scenarioName ? `<span class="sim-km-scenario">${esc(run.keyMetric.scenarioName)}</span>` : ""}`); }
    else hide("#runMetaKeyMetric");
    if (run.expiryNote) { show("#runMetaExpiry"); setText("#runMetaExpiry", run.expiryNote); } else hide("#runMetaExpiry");
  } else hide("#runMeta");

  setText("#resultTitle", data.simulation?.name || "Results");

  // Recommendation
  if (rec) {
    show("#recommendationCard");
    setText("#recScenarioName", rec.scenarioName);
    const badge = $("#recConfidenceBadge");
    badge.textContent = rec.confidence.charAt(0).toUpperCase() + rec.confidence.slice(1) + " Confidence";
    badge.dataset.confidence = rec.confidence;
    setText("#recDecisionSummary", rec.decisionSummary);
    setText("#recAction", rec.recommendedAction);
    setText("#recConfidenceSummary", rec.confidenceSummary);

    // Score breakdown
    if (rec.scoreBreakdown?.length) {
      show("#scoreBreakdownSection");
      const grid = $("#scoreBreakdownGrid");
      grid.innerHTML = "";
      for (const b of rec.scoreBreakdown) {
        grid.append(el("div", { className: "sim-breakdown-item" },
          el("div", { className: "sim-breakdown-bar-wrap" },
            el("div", { className: "sim-breakdown-bar", style: `width:${Math.min(Math.abs(b.contribution) * 3, 100)}%` }),
          ),
          el("strong", {}, b.label),
          el("span", {}, `Weight: ${b.weight}% · Contribution: ${b.contribution.toFixed(1)}`),
          el("p", {}, b.summary),
        ));
      }
      if (rec.scoreGap != null) {
        setText("#scoreGapNote", `Score gap: ${rec.scoreGap.toFixed(1)} points${rec.runnerUpScenarioName ? ` ahead of ${rec.runnerUpScenarioName}` : ""}`);
        show("#scoreGapNote");
      }
    } else hide("#scoreBreakdownSection");

    // Watchouts
    if (rec.watchouts?.length) {
      show("#watchoutsSection");
      const ul = $("#watchoutsList"); ul.innerHTML = "";
      rec.watchouts.forEach(w => ul.append(el("li", {}, w)));
    } else hide("#watchoutsSection");

    // What changed
    if (rec.whatChangedFromBaseline?.length) {
      show("#whatChangedSection");
      const ul = $("#whatChangedList"); ul.innerHTML = "";
      rec.whatChangedFromBaseline.forEach(c => ul.append(el("li", {}, c)));
    } else hide("#whatChangedSection");
  } else hide("#recommendationCard");

  // Key metric deltas
  const deltaGrid = $("#metricDeltaGrid");
  deltaGrid.innerHTML = "";
  if (rec?.keyMetricDeltas?.length) {
    for (const d of rec.keyMetricDeltas) {
      const favorable = goodDirection[d.metric] === d.direction;
      const cls = d.direction === "flat" ? "" : favorable ? "sim-delta-good" : "sim-delta-bad";
      deltaGrid.append(el("div", { className: `sim-delta-card ${cls}` },
        el("span", { className: "sim-delta-label" }, metricLabels[d.metric] || d.metric),
        el("strong", { className: "sim-delta-value" }, fmtDelta(d)),
        el("span", { className: "sim-delta-abs" }, `${fmtNum(d.baseline, d.unit)} → ${fmtNum(d.scenario, d.unit)}`),
      ));
    }
  }

  // Scenario ranking
  const ranking = data.comparison?.scenarioRanking;
  if (ranking?.length) {
    show("#rankingSection");
    const rows = ranking.map(r => `<tr class="${r.recommended ? "sim-rank-winner" : ""}"><td>${r.rank}</td><td>${esc(r.scenarioName)}</td><td>${r.score.toFixed(1)}</td><td>${r.scoreGapFromBest.toFixed(1)}</td><td>${esc(r.summary)}</td></tr>`).join("");
    setHtml("#rankingTable", `<table><thead><tr><th>#</th><th>Scenario</th><th>Score</th><th>Gap</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>`);
  } else hide("#rankingSection");

  // Comparison table
  const allScenarios = [data.baseline, ...data.scenarios];
  const metrics = ["revenue", "operatingCost", "laborCost", "productivity", "workforceLoad", "margin", "marginDelta", "riskScore", "defectCost"];
  const headers = allScenarios.map(s => `<th>${esc(s.name)}</th>`).join("");
  const compRows = metrics.map(m => {
    const cells = allScenarios.map(s => `<td>${fmtNum(s.finalMetrics[m], m.includes("Cost") || m === "revenue" || m === "margin" || m === "marginDelta" ? "USD" : m === "riskScore" ? "percent" : "")}</td>`).join("");
    return `<tr><th>${metricLabels[m] || m}</th>${cells}</tr>`;
  }).join("");
  setHtml("#comparisonTable", `<table><thead><tr><th>Metric</th>${headers}</tr></thead><tbody>${compRows}</tbody></table>`);
}

// ─── Saved Runs ───
async function loadSavedRuns() {
  hide("#savedRunsError"); hide("#savedRunsEmpty"); hide("#savedRunsList"); show("#savedRunsLoading");
  try {
    const data = await apiGet("/simulation-runs");
    hide("#savedRunsLoading");
    if (!data.runs?.length) { show("#savedRunsEmpty"); return; }
    const grid = $("#savedRunsList");
    grid.innerHTML = "";
    for (const run of data.runs) {
      grid.append(el("button", { className: "sim-saved-card", type: "button", onClick: () => loadSavedRun(run.id) },
        el("strong", {}, run.displayTitle),
        el("p", {}, run.displaySubtitle),
        el("span", { className: "sim-saved-meta" }, `${run.scenarioCount} scenarios · ${run.recommendedScenarioName ? "Rec: " + run.recommendedScenarioName : "No recommendation"}`),
        run.expiryNote ? el("span", { className: "sim-expiry-note" }, run.expiryNote) : null,
      ));
    }
    show("#savedRunsList");
  } catch (err) {
    hide("#savedRunsLoading"); setText("#savedRunsErrorMessage", err.message); show("#savedRunsError");
  }
}

async function loadSavedRun(id) {
  try {
    const data = await apiGet(`/simulation-runs/${encodeURIComponent(id)}`);
    state.result = data.run.response;
    state.savedRunId = id;
    // Hydrate form state from saved run request so "Revise Assumptions" works
    const req = data.run.request;
    if (req) {
      state.templateId = req.simulationId || state.templateId;
      if (req.baseline) state.baseline = { ...req.baseline };
      if (req.scenarios?.length) state.scenarios = req.scenarios.map(s => ({ ...s, assumptions: { ...s.assumptions } }));
      // Try to load the template metadata for header text
      try {
        const tmpl = await apiGet(`/simulations/${encodeURIComponent(state.templateId)}`);
        state.template = tmpl;
        setText("#selectedTemplateName", tmpl.simulation.name);
        setText("#selectedTemplateDescription", tmpl.simulation.description);
      } catch (_) { /* template metadata is optional for result viewing */ }
      renderBaselineForm();
      renderScenarios();
    }
    renderResults(data.run.response);
    navigate("results");
  } catch (err) {
    if (err.code === "saved_run_expired") {
      notify(`This result has expired. ${err.userAction || "Start a new simulation."}`, true);
    } else if (err.code === "not_found") {
      notify(`Result not found. ${err.userAction || "Check the link or run a new simulation."}`, true);
    } else {
      notify(err.message, true);
    }
  }
}

// ─── Pilot CTA ───
function handlePilotSubmit(e) {
  e.preventDefault();
  // Clear previous pilot field errors
  for (const inp of $$("#pilotForm .sim-input-error")) inp.classList.remove("sim-input-error");
  for (const err of $$("#pilotForm .sim-field-error")) err.remove();

  const nameInput = $("#pilotName");
  const emailInput = $("#pilotEmail");
  const decisionInput = $("#pilotDecision");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const decision = decisionInput.value.trim();
  let valid = true;

  if (!name) { nameInput.classList.add("sim-input-error"); nameInput.parentElement.append(el("span", { className: "sim-field-error" }, "Name is required")); valid = false; }
  if (!email) { emailInput.classList.add("sim-input-error"); emailInput.parentElement.append(el("span", { className: "sim-field-error" }, "Email is required")); valid = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailInput.classList.add("sim-input-error"); emailInput.parentElement.append(el("span", { className: "sim-field-error" }, "Enter a valid email address")); valid = false; }
  if (!decision) { decisionInput.classList.add("sim-input-error"); decisionInput.parentElement.append(el("span", { className: "sim-field-error" }, "Describe the decision you are modeling")); valid = false; }

  if (!valid) { notify("Please fix the highlighted fields", true); return; }

  // Build mailto — easy to replace with a POST endpoint later:
  // Replace this block with: await apiPost("/api/pilot-request", { name, email, decision });
  const subject = encodeURIComponent("Business Simulator Pilot Request");
  const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nDecision: ${decision}`);
  window.open(`mailto:pilot@reuben.dev?subject=${subject}&body=${body}`, "_self");
  hide("#pilotForm"); show("#pilotConfirmation");
  notify("Pilot request sent");
}

// ─── Deep link handling ───
function checkDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const runId = params.get("run");
  if (runId) { loadSavedRun(runId); return true; }
  return false;
}

// ─── Wire up events ───
$("#startSimulator").addEventListener("click", () => navigate("templates"));
$("#viewSavedRuns").addEventListener("click", () => navigate("saved"));
$("#backToTemplates").addEventListener("click", () => navigate("templates"));
$("#backToRun").addEventListener("click", () => navigate("run"));
$("#backFromSaved").addEventListener("click", () => navigate("hero"));
$("#addScenario").addEventListener("click", () => {
  const idx = state.scenarios.length + 1;
  state.scenarios.push({ id: `custom-${idx}`, name: `Custom Scenario ${idx}`, description: "", assumptions: {} });
  renderScenarios();
});
$("#runSimulation").addEventListener("click", runSim);
$("#runRetry").addEventListener("click", runSim);
$("#templateRetry").addEventListener("click", loadTemplates);
$("#savedRunsRetry").addEventListener("click", loadSavedRuns);
$("#startFromEmpty").addEventListener("click", () => navigate("templates"));
$("#reviseAssumptions").addEventListener("click", () => navigate("run"));
$("#newSimulation").addEventListener("click", () => navigate("templates"));
$("#copyShareLink").addEventListener("click", () => {
  if (state.savedRunId) {
    const url = `${window.location.origin}/simulator.html?run=${state.savedRunId}`;
    navigator.clipboard.writeText(url).then(() => notify("Share link copied")).catch(() => notify("Could not copy link", true));
  } else { notify("Save a run first to get a share link", true); }
});
$("#pilotForm").addEventListener("submit", handlePilotSubmit);

// Boot
if (!checkDeepLink()) navigate("hero");
