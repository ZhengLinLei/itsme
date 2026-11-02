export type RequestBody = {
  message?: unknown;
  stream?: unknown;
  captchaToken?: unknown;
};

export type HttpError = Error & { status?: number; code?: string; retryAfter?: number };

export function httpError(
  status: number,
  code: string,
  message: string,
  retryAfter?: number,
): HttpError {
  return Object.assign(new Error(message), { status, code, retryAfter });
}
