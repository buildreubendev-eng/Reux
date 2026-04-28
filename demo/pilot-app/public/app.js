const state = {
  sessionId: loadSessionId(),
  setupRequired: false,
  ids: {
    account: "",
    order: "",
  },
};

const elements = {
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
  actionResult: document.querySelector("#actionResult"),
  actionSummary: document.querySelector("#actionSummary"),
  lastAction: document.querySelector("#lastAction"),
  toast: document.querySelector("#toast"),
  migrationCount: document.querySelector("#migrationCount"),
  pendingCount: document.querySelector("#pendingCount"),
  openOrderCount: document.querySelector("#openOrderCount"),
  outboxCount: document.querySelector("#outboxCount"),
  ordersTable: document.querySelector("#ordersTable"),
  paymentsTable: document.querySelector("#paymentsTable"),
  balancesTable: document.querySelector("#balancesTable"),
  summaryTable: document.querySelector("#summaryTable"),
  outboxTable: document.querySelector("#outboxTable"),
};
const demoActionButtons = [...document.querySelectorAll("[data-action]")];

const displayLabels = {
  event_type: "Event Type",
  ordercount: "Order Count",
  paymentamount: "Payment Amount",
  paymentstatus: "Payment Status",
  totalspend: "Total Spend",
};

elements.setupButton.addEventListener("click", async () => {
  await withBusy(elements.setupButton, async () => {
    const result = await postJson("/api/setup", {
      setupToken: elements.setupToken.value,
    });
    elements.actionResult.textContent = JSON.stringify(result, null, 2);
    elements.adminTools.open = false;
    notify("Database migrated and pilot seed reset");
    await refresh();
  });
});

elements.refreshButton.addEventListener("click", () => withBusy(elements.refreshButton, refresh));
elements.resetSessionButton.addEventListener("click", async () => {
  await withBusy(elements.resetSessionButton, async () => {
    const result = await postJson("/api/session/reset", {});
    elements.actionResult.textContent = JSON.stringify(result, null, 2);
    elements.actionSummary.textContent = "Your isolated demo session was reset with fresh seed data.";
    notify("Session reset with fresh demo data");
    await refresh();
  });
});

document.querySelector('[data-action="capture"]').addEventListener("click", async () => {
  await runAction("capturePayment", "/api/actions/capture-payment", {
    orderId: elements.orderId.value,
    amount: elements.paymentAmount.value,
  });
});

document.querySelector('[data-action="markPaid"]').addEventListener("click", async () => {
  await runAction("markOrderPaid", "/api/actions/mark-paid", {
    orderId: elements.orderId.value,
  });
});

document.querySelector('[data-action="credit"]').addEventListener("click", async () => {
  await runAction("creditAccount", "/api/actions/credit-account", {
    accountId: elements.accountId.value,
    amount: elements.creditAmount.value,
  });
});

document.querySelector('[data-action="processOutbox"]').addEventListener("click", async () => {
  await runAction("processOutbox", "/api/actions/process-outbox", {});
});

refresh().catch((error) => {
  notify(error.message, true);
});

async function runAction(label, url, payload) {
  elements.lastAction.textContent = label;
  const result = await postJson(url, payload);
  elements.actionResult.textContent = JSON.stringify(result, null, 2);
  elements.actionSummary.textContent = summarizeAction(label, result);
  notify(`${label} complete`);
  await refresh();
}

async function refresh() {
  const dashboard = await getJson("/api/dashboard");
  state.setupRequired = Boolean(dashboard.setupRequired);
  elements.sessionLabel.textContent = dashboard.session?.id ? dashboard.session.id.slice(0, 8) : "shared";
  elements.setupNotice.hidden = !dashboard.setupRequired;
  state.ids.account = dashboard.ids.account;
  state.ids.order = dashboard.ids.order;
  elements.accountId.value ||= dashboard.ids.account;
  elements.orderId.value ||= dashboard.ids.order;

  elements.migrationCount.textContent = String(dashboard.migrations.applied);
  elements.pendingCount.textContent = String(dashboard.migrations.pending.length);
  elements.openOrderCount.textContent = String(dashboard.openOrders.length);
  elements.outboxCount.textContent = String(dashboard.outbox.length);

  renderTable(elements.ordersTable, dashboard.orders, ["email", "total", "status"]);
  renderTable(elements.paymentsTable, dashboard.payments, ["total", "paymentamount", "paymentstatus"]);
  renderTable(elements.balancesTable, dashboard.balances, ["email", "balance"]);
  renderTable(elements.summaryTable, dashboard.summary, ["email", "ordercount", "totalspend"]);
  renderTable(elements.outboxTable, dashboard.outbox, ["event_type", "status", "attempts", "payload"]);
  setActionAvailability();
}

function renderTable(target, rows, preferredColumns) {
  if (!rows.length) {
    target.innerHTML = '<div class="empty">No rows</div>';
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
    button.disabled = state.setupRequired;
  });
}

function sessionHeaders() {
  return { "x-reux-demo-session": state.sessionId };
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

function summarizeAction(label, result) {
  if (label === "processOutbox") {
    return `Processed ${result.processed} outbox event(s); ${result.failed} failed.`;
  }
  const events = result.outboxEvents?.length ?? 0;
  const hooks = result.afterCommit?.length ?? 0;
  return `${label} ran in ${result.attempts} attempt(s), wrote ${events} outbox event(s), and returned ${hooks} after-commit hook(s).`;
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

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
