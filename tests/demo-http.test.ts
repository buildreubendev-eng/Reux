import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  InvalidJsonRequestError,
  JsonBodyTooLargeError,
  readJson,
} from "../demo/pilot-app/http.mjs";

describe("demo HTTP helpers", () => {
  it("parses JSON request bodies", async () => {
    await expect(readJson(requestFrom("{\"ok\":true}"))).resolves.toEqual({ ok: true });
  });

  it("treats empty request bodies as empty objects", async () => {
    await expect(readJson(requestFrom("  "))).resolves.toEqual({});
  });

  it("rejects invalid JSON with a stable 400 error", async () => {
    await expect(readJson(requestFrom("{bad json"))).rejects.toMatchObject({
      name: "InvalidJsonRequestError",
      statusCode: 400,
      code: "invalid_json",
    } satisfies Partial<InvalidJsonRequestError>);
  });

  it("rejects oversized JSON with a stable 413 error", async () => {
    await expect(readJson(requestFrom("{\"large\":\"payload\"}"), { limitBytes: 5 })).rejects.toMatchObject({
      name: "JsonBodyTooLargeError",
      statusCode: 413,
      code: "request_too_large",
      limitBytes: 5,
    } satisfies Partial<JsonBodyTooLargeError>);
  });
});

function requestFrom(body: string): Readable {
  return Readable.from([body]);
}
