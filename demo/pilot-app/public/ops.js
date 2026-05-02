const elements = {
  refresh: document.querySelector("#refreshOps"),
  health: document.querySelector("#opsHealth"),
  active: document.querySelector("#opsActive"),
  failed: document.querySelector("#opsFailed"),
  dead: document.querySelector("#opsDead"),
  domains: document.querySelector("#opsDomains"),
  toast: document.querySelector("#toast"),
  lastRefreshed: document.querySelector("#lastRefreshed"),
};

elements.refresh.addEventListener("click", refresh);
refresh().catch((error) => notify(error.message, true));

async function refresh() {
  elements.domains.innerHTML = `<div class="empty">Fetching operations data...</div>`;
  if (elements.lastRefreshed) elements.lastRefreshed.textContent = "Refreshing...";
  
  try {
    const response = await fetch("/api/ops", { headers: sessionHeaders() });
    const dashboard = await response.json();
    if (!response.ok) throw new Error(dashboard.error ?? "operations dashboard failed");

    elements.health.textContent = titleCase(dashboard.health);
    elements.active.textContent = String(dashboard.totals.active);
    elements.failed.textContent = String(dashboard.totals.failed);
    elements.dead.textContent = String(dashboard.totals.dead);
    elements.domains.innerHTML = dashboard.domains.length 
      ? dashboard.domains.map(renderDomain).join("")
      : `<div class="empty">No active domains found.</div>`;
      
    const time = new Date(dashboard.generatedAt).toLocaleTimeString();
    if (elements.lastRefreshed) elements.lastRefreshed.textContent = `Last refreshed: ${time}`;
    notify(`Operations refreshed at ${time}`);
  } catch (error) {
    elements.domains.innerHTML = `<div class="empty" style="color: var(--red);">Failed to load operations data: ${escapeHtml(error.message)}</div>`;
    if (elements.lastRefreshed) elements.lastRefreshed.textContent = "Refresh failed";
    notify(error.message, true);
  }
}

function renderDomain(domain) {
  return `
    <div class="panel">
      <div class="panel-heading">
        <h2>${escapeHtml(domain.title)}</h2>
        <span class="queue-status" data-health="${escapeHtml(domain.queue.health)}">Queue: ${escapeHtml(titleCase(domain.queue.health))}</span>
      </div>
      <div class="table">
        <table>
          <tbody>
            ${row("Pending Events", domain.queue.pending)}
            ${row("Currently Processing", domain.queue.processing)}
            ${row("Successfully Processed", domain.queue.processed)}
            ${row("Failed Events", domain.queue.failed)}
            ${row("Dead Letter Queue", domain.queue.dead)}
            ${row("Total Attempts", domain.queue.attempts)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function row(label, value) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`;
}

function sessionHeaders() {
  const id = window.localStorage.getItem("reuxDemoSessionId");
  return id ? { "x-reux-demo-session": id } : {};
}

function notify(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 2200);
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
