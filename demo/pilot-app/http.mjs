export const defaultJsonBodyLimitBytes = 64 * 1024;

export class JsonBodyTooLargeError extends Error {
  constructor(limitBytes) {
    super(`JSON request body exceeds ${limitBytes} bytes`);
    this.name = "JsonBodyTooLargeError";
    this.statusCode = 413;
    this.code = "request_too_large";
    this.limitBytes = limitBytes;
  }
}

export class InvalidJsonRequestError extends Error {
  constructor() {
    super("invalid JSON request body");
    this.name = "InvalidJsonRequestError";
    this.statusCode = 400;
    this.code = "invalid_json";
  }
}

export function readJson(request, { limitBytes = defaultJsonBodyLimitBytes } = {}) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    let bytes = 0;
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > limitBytes) {
        rejected = true;
        reject(new JsonBodyTooLargeError(limitBytes));
        request.destroy?.();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (rejected) return;
      if (!body.trim()) {
        resolveJson({});
        return;
      }
      try {
        resolveJson(JSON.parse(body));
      } catch {
        reject(new InvalidJsonRequestError());
      }
    });
    request.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}
