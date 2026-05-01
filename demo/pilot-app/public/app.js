const state = {
  currentDomain: requestedDomain() ?? window.localStorage.getItem("reuxDemoDomain") ?? "commerce",
  sessionId: loadSessionId(),
  setupRequired: false,
};

const domains = {
  commerce: {
    title: "Commerce Console",
    dashboardUrl: "/api/dashboard",
    setupUrl: "/api/setup",
    resetUrl: "/api/session/reset",
    controls: "#commerceControls",
    metrics: [
      ["Applied Migrations", (dashboard) => dashboard.migrations.applied],
      ["Pending Migrations", (dashboard) => dashboard.migrations.pending.length],
      ["Open Orders", (dashboard) => dashboard.openOrders.length],
      ["Active Events", (dashboard) => queueSummary(dashboard).active],
    ],
    actions: {
      capture: {
        label: "capturePayment",
        url: "/api/actions/capture-payment",
        payload: () => ({ orderId: elements.orderId.value, amount: elements.paymentAmount.value }),
      },
      markPaid: {
        label: "markOrderPaid",
        url: "/api/actions/mark-paid",
        payload: () => ({ orderId: elements.orderId.value }),
      },
      credit: {
        label: "creditAccount",
        url: "/api/actions/credit-account",
        payload: () => ({ accountId: elements.accountId.value, amount: elements.creditAmount.value }),
      },
      processOutbox: {
        label: "processOutbox",
        url: "/api/actions/process-outbox",
        payload: () => ({}),
      },
    },
    hydrateInputs(dashboard) {
      elements.accountId.value ||= dashboard.ids.account;
      elements.orderId.value ||= dashboard.ids.order;
    },
    tables: {
      summary: ["Account Summary", "summary", ["email", "ordercount", "totalspend"]],
      dataOne: ["Orders", "orders", ["email", "total", "status"]],
      dataTwo: ["Payments", "payments", ["total", "paymentamount", "paymentstatus"]],
      dataThree: ["Balances", "balances", ["email", "balance"]],
      outbox: ["Outbox", "outbox", ["event_type", "status", "attempts", "payload"]],
    },
  },
  logistics: {
    title: "Logistics Dispatch",
    dashboardUrl: "/api/logistics/dashboard",
    setupUrl: "/api/logistics/setup",
    resetUrl: "/api/logistics/session/reset",
    controls: "#logisticsControls",
    metrics: [
      ["Schema State", (dashboard) => (dashboard.setupRequired ? "Pending" : "Ready")],
      ["Pending Setup", (dashboard) => dashboard.migrations.pending.length],
      ["Active Shipments", (dashboard) => dashboard.activeShipments.length],
      ["Active Events", (dashboard) => queueSummary(dashboard).active],
    ],
    actions: {
      startShipment: {
        label: "startShipment",
        url: "/api/logistics/actions/start-shipment",
        payload: () => ({ shipmentId: elements.shipmentId.value }),
      },
      markDelivered: {
        label: "markDelivered",
        url: "/api/logistics/actions/mark-delivered",
        payload: () => ({ shipmentId: elements.shipmentId.value }),
      },
      creditDriver: {
        label: "creditDriver",
        url: "/api/logistics/actions/credit-driver",
        payload: () => ({ driverId: elements.driverId.value, amount: elements.driverCreditAmount.value }),
      },
      processOutbox: {
        label: "processOutbox",
        url: "/api/logistics/actions/process-outbox",
        payload: () => ({}),
      },
    },
    hydrateInputs(dashboard) {
      elements.shipmentId.value ||= dashboard.ids.shipment;
      elements.driverId.value ||= dashboard.ids.driver;
    },
    tables: {
      summary: ["Shipment Status", "statusSummary", ["status", "shipmentcount", "totalweight"]],
      dataOne: ["Active Shipments", "activeShipments", ["trackingnumber", "destination", "status"]],
      dataTwo: ["Driver Manifest", "driverManifest", ["email", "trackingnumber", "destination", "weight"]],
      dataThree: null,
      outbox: ["Outbox", "outbox", ["event_type", "status", "attempts", "payload"]],
    },
  },
};

const elements = {
  consoleTitle: document.querySelector("#consoleTitle"),
  adminTools: document.querySelector("#adminTools"),
  setupButton: document.querySelector("#setupButton"),
  setupToken: document.querySelector("#setupToken"),
  refreshButton: document.querySelector("#refreshButton"),
  resetSessionButton: document.querySelector("#resetSessionButton"),
  setupNotice: document.querySelector("#setupNotice"),
  sessionLabel: document.querySelector("#sessionLabel"),
  orderId: document.querySelector("#orderId"),
  paymentAmount: document.querySelector("#paymentAmount"),
  accountId: document.querySelector("#accountId"),
  creditAmount: document.querySelector("#creditAmount"),
  shipmentId: document.querySelector("#shipmentId"),
  driverId: document.querySelector("#driverId"),
  driverCreditAmount: document.querySelector("#driverCreditAmount"),
  actionResult: document.querySelector("#actionResult"),
  actionSummary: document.querySelector("#actionSummary"),
  lastAction: document.querySelector("#lastAction"),
  toast: document.querySelector("#toast"),
  metricLabels: [
    document.querySelector("#metricOneLabel"),
    document.querySelector("#metricTwoLabel"),
    document.querySelector("#metricThreeLabel"),
    document.querySelector("#metricFourLabel"),
  ],
  metricCounts: [
    document.querySelector("#metricOneCount"),
    document.querySelector("#metricTwoCount"),
    document.querySelector("#metricThreeCount"),
    document.querySelector("#metricFourCount"),
  ],
  queueHealth: document.querySelector("#queueHealth"),
  queuePending: document.querySelector("#queuePending"),
  queueProcessing: document.querySelector("#queueProcessing"),
  queueFailed: document.querySelector("#queueFailed"),
  queueDead: document.querySelector("#queueDead"),
  summaryTitle: document.querySelector("#summaryTitle"),
  summaryTable: document.querySelector("#summaryTable"),
  dataOnePanel: document.querySelector("#dataOnePanel"),
  dataOneTitle: document.querySelector("#dataOneTitle"),
  dataOneTable: document.querySelector("#dataOneTable"),
  dataTwoPanel: document.querySelector("#dataTwoPanel"),
  dataTwoTitle: document.querySelector("#dataTwoTitle"),
  dataTwoTable: document.querySelector("#dataTwoTable"),
  dataThreePanel: document.querySelector("#dataThreePanel"),
  dataThreeTitle: document.querySelector("#dataThreeTitle"),
  dataThreeTable: document.querySelector("#dataThreeTable"),
  outboxTable: document.querySelector("#outboxTable"),
};

const displayLabels = {
  event_type: "Event Type",
  ordercount: "Order Count",
  paymentamount: "Payment Amount",
  paymentstatus: "Payment Status",
  totalspend: "Total Spend",
  shipmentcount: "Shipment Count",
  totalweight: "Total Weight",
  trackingnumber: "Tracking Number",
};

const emptyStates = {
  summary: "No summary rows yet. Reset this session to load the seed data.",
  dataOne: "No primary records yet. Reset this session, then run a transaction.",
  dataTwo: "No related records yet. Capture a payment or process a logistics update to create rows.",
  dataThree: "No balance rows yet. Reset this session to load accounts or drivers.",
  outbox: "No queued events. Run a transaction that emits an event, then process the outbox.",
};

const domainTabs = [...document.querySelectorAll("[data-domain]")];
const demoActionButtons = [...document.querySelectorAll("[data-action]")];

elements.setupButton.addEventListener("click", async () => {
  await withBusy(elements.setupButton, async () => {
    const config = activeDomain();
    const result = await postJson(config.setupUrl, {
      setupToken: elements.setupToken.value,
    });
    elements.actionResult.textContent = JSON.stringify(result, null, 2);
    elements.adminTools.open = false;
    notify(`${config.title} schema and seed reset`);
    await refresh();
  });
});

elements.refreshButton.addEventListener("click", () => withBusy(elements.refreshButton, refresh));
elements.resetSessionButton.addEventListener("click", async () => {
  await withBusy(elements.resetSessionButton, async () => {
    const config = activeDomain();
    const result = await postJson(config.resetUrl, {});
    elements.actionResult.textContent = JSON.stringify(result, null, 2);
    elements.actionSummary.textContent = `Your isolated ${config.title.toLowerCase()} session was reset with fresh seed data.`;
    notify("Session reset with fresh demo data");
    await refresh();
  });
});

domainTabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    state.currentDomain = tab.dataset.domain;
    window.localStorage.setItem("reuxDemoDomain", state.currentDomain);
    elements.actionResult.textContent = "";
    elements.actionSummary.textContent = "Run an action to see the generated transaction or outbox result.";
    elements.lastAction.textContent = "Idle";
    await refresh();
  });
});

demoActionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const config = activeDomain();
    const action = config.actions[button.dataset.action];
    if (!action) return;
    await withBusy(button, () => runAction(action));
  });
});

refresh().catch((error) => {
  notify(error.message, true);
});

async function runAction(action) {
  elements.lastAction.textContent = action.label;
  const result = await postJson(action.url, action.payload());
  elements.actionResult.textContent = JSON.stringify(result, null, 2);
  elements.actionSummary.textContent = summarizeAction(action.label, result);
  notify(`${action.label} complete`);
  await refresh();
}

async function refresh() {
  const config = activeDomain();
  syncDomainChrome(config);
  const dashboard = await getJson(config.dashboardUrl);
  state.setupRequired = Boolean(dashboard.setupRequired);
  elements.sessionLabel.textContent = dashboard.session?.id ? dashboard.session.id.slice(0, 8) : "shared";
  elements.setupNotice.hidden = !dashboard.setupRequired;
  config.hydrateInputs(dashboard);

  config.metrics.forEach(([labelText, count], index) => {
    elements.metricLabels[index].textContent = labelText;
    elements.metricCounts[index].textContent = String(count(dashboard));
  });

  renderQueueSummary(dashboard);
  renderDomainTables(config, dashboard);
  setActionAvailability();
}

function syncDomainChrome(config) {
  elements.consoleTitle.textContent = config.title;
  domainTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.domain === state.currentDomain);
  });
  document.querySelectorAll(".domain-controls").forEach((controls) => {
    controls.hidden = controls !== document.querySelector(config.controls);
  });
}

function renderDomainTables(config, dashboard) {
  renderConfiguredTable(config.tables.summary, elements.summaryTitle, elements.summaryTable, dashboard, undefined, emptyStates.summary);
  renderConfiguredTable(config.tables.dataOne, elements.dataOneTitle, elements.dataOneTable, dashboard, elements.dataOnePanel, emptyStates.dataOne);
  renderConfiguredTable(config.tables.dataTwo, elements.dataTwoTitle, elements.dataTwoTable, dashboard, elements.dataTwoPanel, emptyStates.dataTwo);
  renderConfiguredTable(config.tables.dataThree, elements.dataThreeTitle, elements.dataThreeTable, dashboard, elements.dataThreePanel, emptyStates.dataThree);
  renderConfiguredTable(config.tables.outbox, null, elements.outboxTable, dashboard, undefined, emptyStates.outbox);
}

function renderQueueSummary(dashboard) {
  const queue = queueSummary(dashboard);
  elements.queueHealth.textContent = titleCase(queue.health);
  elements.queueHealth.dataset.health = queue.health;
  elements.queuePending.textContent = String(queue.pending);
  elements.queueProcessing.textContent = String(queue.processing);
  elements.queueFailed.textContent = String(queue.failed);
  elements.queueDead.textContent = String(queue.dead);
}

function queueSummary(dashboard) {
  return {
    health: dashboard.queue?.health ?? "clear",
    active: Number(dashboard.queue?.active ?? dashboard.outbox?.length ?? 0),
    pending: Number(dashboard.queue?.pending ?? 0),
    processing: Number(dashboard.queue?.processing ?? 0),
    failed: Number(dashboard.queue?.failed ?? 0),
    dead: Number(dashboard.queue?.dead ?? 0),
  };
}

function renderConfiguredTable(tableConfig, titleTarget, tableTarget, dashboard, panelTarget, emptyMessage) {
  if (!tableConfig) {
    if (panelTarget) panelTarget.hidden = true;
    tableTarget.innerHTML = "";
    return;
  }
  if (panelTarget) panelTarget.hidden = false;
  const [title, key, columns] = tableConfig;
  if (titleTarget) titleTarget.textContent = title;
  renderTable(tableTarget, dashboard[key] ?? [], columns, emptyMessage);
}

function renderTable(target, rows, preferredColumns, emptyMessage = "No rows yet.") {
  if (!rows.length) {
    target.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  const columns = preferredColumns.filter((column) => Object.prototype.hasOwnProperty.call(rows[0], column));
  const fallbackColumns = Object.keys(rows[0]).filter((column) => !columns.includes(column));
  const allColumns = [...columns, ...fallbackColumns].slice(0, 6);
  target.innerHTML = `
    <table>
      <thead>
        <tr>${allColumns.map((column) => `<th>${escapeHtml(label(column))}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${allColumns.map((column) => `<td>${formatCell(row[column])}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
  return escapeHtml(String(value));
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: sessionHeaders(),
  });
  return parseResponse(response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionHeaders() },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(friendlyError(body.error ?? `request failed with ${response.status}`));
  }
  return body;
}

async function withBusy(button, task) {
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((item) => {
    item.disabled = true;
  });
  try {
    await task();
  } catch (error) {
    notify(error.message, true);
  } finally {
    buttons.forEach((item) => {
      item.disabled = false;
    });
    setActionAvailability();
    button.focus();
  }
}

function setActionAvailability() {
  demoActionButtons.forEach((button) => {
    button.disabled = state.setupRequired || button.dataset.domainAction !== state.currentDomain;
  });
}

function sessionHeaders() {
  return { "x-reux-demo-session": state.sessionId };
}

function activeDomain() {
  return domains[state.currentDomain] ?? domains.commerce;
}

function requestedDomain() {
  const domain = new URLSearchParams(window.location.search).get("domain");
  return domain && domain in domains ? domain : undefined;
}

function loadSessionId() {
  const key = "reuxDemoSessionId";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  const generated = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  window.localStorage.setItem(key, generated);
  return generated;
}

function summarizeAction(labelText, result) {
  if (labelText === "processOutbox") {
    return `Processed ${result.processed} outbox event(s); ${result.failed} failed.`;
  }
  const events = result.outboxEvents?.length ?? 0;
  const hooks = result.afterCommit?.length ?? 0;
  return `${labelText} ran in ${result.attempts} attempt(s), wrote ${events} outbox event(s), and returned ${hooks} after-commit hook(s).`;
}

function friendlyError(message) {
  if (/transition guard failed/.test(message)) {
    return "That state change is not valid from the current status. Reset your session or try another action.";
  }
  if (/relation ".+" does not exist/.test(message)) {
    return "This session is not initialized yet. Use Reset My Session to create demo data.";
  }
  return message;
}

function notify(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("visible");
  window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2800);
}

function label(value) {
  if (displayLabels[value]) return displayLabels[value];
  return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
