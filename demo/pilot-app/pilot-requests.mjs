import { randomUUID } from "node:crypto";

const defaultFromAddress = "Reuben Pilot <pilot@reuben.dev>";
const defaultFallbackEmail = "pilot@reuben.dev";
const resendEndpoint = "https://api.resend.com/emails";

export class PilotRequestValidationError extends Error {
  constructor(issues) {
    super(formatIssues(issues));
    this.name = "PilotRequestValidationError";
    this.statusCode = 400;
    this.code = "pilot_request_validation_failed";
    this.issues = issues;
  }
}

export function normalizePilotRequest(body, options = {}) {
  const now = options.now ?? new Date();
  const idFactory = options.idFactory ?? defaultPilotRequestId;
  const issues = [];
  const input = isPlainObject(body) ? body : {};

  if (!isPlainObject(body)) {
    issues.push({ path: "$", message: "request body must be an object" });
  }

  const name = requiredString(input.name, "$.name", "name", issues, { minLength: 2, maxLength: 120 });
  const email = requiredEmail(input.email, issues);
  const decision = requiredString(input.decision, "$.decision", "decision", issues, { minLength: 10, maxLength: 2000 });
  const company = optionalString(input.company, "$.company", "company", issues, 160);
  const role = optionalString(input.role, "$.role", "role", issues, 120);
  const phone = optionalString(input.phone, "$.phone", "phone", issues, 60);
  const sourceRunId = optionalString(input.sourceRunId, "$.sourceRunId", "sourceRunId", issues, 120);
  const pageUrl = optionalString(input.pageUrl, "$.pageUrl", "pageUrl", issues, 500);

  if (pageUrl && !isHttpUrl(pageUrl)) {
    issues.push({ path: "$.pageUrl", message: "must be an http or https URL" });
  }
  if (sourceRunId && !/^[A-Za-z0-9_-]+$/.test(sourceRunId)) {
    issues.push({ path: "$.sourceRunId", message: "must contain only letters, numbers, underscores, or dashes" });
  }

  if (issues.length > 0) throw new PilotRequestValidationError(issues);

  return omitUndefined({
    id: idFactory(),
    receivedAt: now.toISOString(),
    name,
    email: email.toLowerCase(),
    decision,
    company,
    role,
    phone,
    sourceRunId,
    pageUrl,
  });
}

export function createPilotRequestSender(options = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const to = options.to ?? process.env.REUX_PILOT_REQUEST_TO ?? "";
  const from = options.from ?? process.env.REUX_PILOT_REQUEST_FROM ?? defaultFromAddress;
  const fallbackEmail = options.fallbackEmail || process.env.REUX_PILOT_REQUEST_FALLBACK_EMAIL || to || defaultFallbackEmail;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const configured = Boolean(apiKey && to && from && fetchImpl);

  return {
    status() {
      return {
        channel: configured ? "resend" : "disabled",
        configured,
        fallbackEmail,
      };
    },
    async send(pilotRequest) {
      if (!configured) {
        return {
          status: "disabled",
          channel: "none",
          fallbackEmail,
          mailto: pilotRequestMailto(pilotRequest, fallbackEmail),
        };
      }

      const response = await fetchImpl(resendEndpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: splitRecipients(to),
          reply_to: pilotRequest.email,
          subject: `Business Simulator pilot request: ${pilotRequest.name}`,
          text: formatPilotRequestText(pilotRequest),
        }),
      });

      if (!response.ok) {
        const error = new Error(`pilot request email delivery failed with ${response.status}`);
        error.statusCode = 502;
        throw error;
      }

      const body = await readJsonResponse(response);
      return {
        status: "sent",
        channel: "resend",
        providerId: typeof body?.id === "string" ? body.id : undefined,
      };
    },
  };
}

export async function submitPilotRequest(body, options = {}) {
  const pilotRequest = normalizePilotRequest(body, options);
  const sender = options.sender ?? createPilotRequestSender();
  const delivery = await sender.send(pilotRequest);
  return {
    ok: true,
    request: {
      id: pilotRequest.id,
      receivedAt: pilotRequest.receivedAt,
    },
    delivery: omitUndefined(delivery),
  };
}

export function formatPilotRequestText(pilotRequest) {
  return [
    "New Business Simulator pilot request",
    "",
    `Name: ${pilotRequest.name}`,
    `Email: ${pilotRequest.email}`,
    pilotRequest.company ? `Company: ${pilotRequest.company}` : undefined,
    pilotRequest.role ? `Role: ${pilotRequest.role}` : undefined,
    pilotRequest.phone ? `Phone: ${pilotRequest.phone}` : undefined,
    pilotRequest.sourceRunId ? `Source run: ${pilotRequest.sourceRunId}` : undefined,
    pilotRequest.pageUrl ? `Page URL: ${pilotRequest.pageUrl}` : undefined,
    "",
    "Decision to model:",
    pilotRequest.decision,
    "",
    `Request ID: ${pilotRequest.id}`,
    `Received at: ${pilotRequest.receivedAt}`,
  ].filter(Boolean).join("\n");
}

function requiredString(value, path, label, issues, { minLength, maxLength }) {
  if (typeof value !== "string") {
    issues.push({ path, message: `${label} is required` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    issues.push({ path, message: `${label} must be at least ${minLength} characters` });
  }
  if (trimmed.length > maxLength) {
    issues.push({ path, message: `${label} must be ${maxLength} characters or fewer` });
  }
  return trimmed;
}

function requiredEmail(value, issues) {
  const email = requiredString(value, "$.email", "email", issues, { minLength: 3, maxLength: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ path: "$.email", message: "email must be a valid email address" });
  }
  return email;
}

function optionalString(value, path, label, issues, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    issues.push({ path, message: `${label} must be a string` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) {
    issues.push({ path, message: `${label} must be ${maxLength} characters or fewer` });
  }
  return trimmed;
}

function pilotRequestMailto(pilotRequest, email) {
  const subject = encodeURIComponent("Business Simulator Pilot Request");
  const body = encodeURIComponent(formatPilotRequestText(pilotRequest));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function defaultPilotRequestId() {
  return `pilot_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function formatIssues(issues) {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function splitRecipients(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
