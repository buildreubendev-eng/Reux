import { describe, expect, it } from "vitest";
import {
  PilotRequestValidationError,
  createPilotRequestSender,
  formatPilotRequestText,
  normalizePilotRequest,
  submitPilotRequest,
} from "../demo/pilot-app/pilot-requests.mjs";

describe("demo pilot request backend", () => {
  const now = new Date("2026-05-03T12:00:00.000Z");
  const idFactory = () => "pilot_test123";

  it("normalizes a public pilot request", () => {
    expect(
      normalizePilotRequest(
        {
          name: " Ada Founder ",
          email: "ADA@Example.com ",
          company: " Example Ops ",
          decision: "We need to decide whether to hire more operators before Q3 demand spikes.",
          sourceRunId: "live_abc123",
          pageUrl: "https://reuben.example/simulator.html?run=live_abc123",
        },
        { now, idFactory },
      ),
    ).toEqual({
      id: "pilot_test123",
      receivedAt: "2026-05-03T12:00:00.000Z",
      name: "Ada Founder",
      email: "ada@example.com",
      company: "Example Ops",
      decision: "We need to decide whether to hire more operators before Q3 demand spikes.",
      sourceRunId: "live_abc123",
      pageUrl: "https://reuben.example/simulator.html?run=live_abc123",
    });
  });

  it("returns field-level validation issues", () => {
    expect(() => normalizePilotRequest({ name: "A", email: "bad", decision: "short" }, { now, idFactory })).toThrow(PilotRequestValidationError);

    try {
      normalizePilotRequest({ name: "A", email: "bad", decision: "short" }, { now, idFactory });
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        code: "pilot_request_validation_failed",
        issues: [
          { path: "$.name", message: "name must be at least 2 characters" },
          { path: "$.email", message: "email must be a valid email address" },
          { path: "$.decision", message: "decision must be at least 10 characters" },
        ],
      });
    }
  });

  it("uses a disabled delivery fallback until Resend is configured", async () => {
    const response = await submitPilotRequest(
      {
        name: "Ada Founder",
        email: "ada@example.com",
        decision: "We need to compare hiring four people against process automation.",
      },
      {
        now,
        idFactory,
        sender: createPilotRequestSender({ apiKey: "", to: "", fallbackEmail: "pilot@example.com" }),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      request: {
        id: "pilot_test123",
        receivedAt: "2026-05-03T12:00:00.000Z",
      },
      delivery: {
        status: "disabled",
        channel: "none",
        fallbackEmail: "pilot@example.com",
      },
    });
    expect(response.delivery.mailto).toContain("mailto:pilot@example.com");
  });

  it("sends Resend payloads without exposing the API key", async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    const sender = createPilotRequestSender({
      apiKey: "resend_test",
      to: "pilot@example.com, ops@example.com",
      from: "Reuben <hello@example.com>",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init as { headers: Record<string, string>; body: string } });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "email_123" }),
        } as any;
      },
    });

    const response = await submitPilotRequest(
      {
        name: "Ada Founder",
        email: "ada@example.com",
        decision: "We need to compare hiring four people against process automation.",
      },
      { now, idFactory, sender },
    );

    expect(response.delivery).toEqual({
      status: "sent",
      channel: "resend",
      providerId: "email_123",
    });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers.authorization).toBe("Bearer resend_test");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      from: "Reuben <hello@example.com>",
      to: ["pilot@example.com", "ops@example.com"],
      reply_to: "ada@example.com",
      subject: "Business Simulator pilot request: Ada Founder",
    });
  });

  it("formats the email body for operator handoff", () => {
    const text = formatPilotRequestText({
      id: "pilot_test123",
      receivedAt: "2026-05-03T12:00:00.000Z",
      name: "Ada Founder",
      email: "ada@example.com",
      decision: "We need to compare hiring four people against process automation.",
    });

    expect(text).toContain("New Business Simulator pilot request");
    expect(text).toContain("Decision to model:");
    expect(text).toContain("Request ID: pilot_test123");
  });
});
