export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function httpError(
  status: number,
  code: string,
  message: string,
): HttpError {
  return new HttpError(status, code, message);
}

export function sanitizeMessage(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(/Bearer\s+\S{8,}/gi, "Bearer [redacted]");
  return sanitized;
}
