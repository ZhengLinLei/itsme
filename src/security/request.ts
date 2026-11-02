import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import config from '../config.js';

export function clientIp(request: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress || 'unknown';
}

// Requests without an Origin header (curl, server-to-server) are allowed; browser requests
// must come from the allowlist. This also blocks cross-site form posts and WebSocket hijacking.
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const { origins } = config.cors;
  return origins.includes('*') || origins.includes(origin.replace(/\/+$/, ''));
}

export function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin || !originAllowed(origin)) return;
  response.setHeader(
    'access-control-allow-origin',
    config.cors.origins.includes('*') ? '*' : origin,
  );
  response.setHeader('vary', 'Origin');
  response.setHeader(
    'access-control-allow-headers',
    'content-type, authorization, x-session-token',
  );
  response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('access-control-expose-headers', 'x-session-token, retry-after');
  response.setHeader('access-control-max-age', '600');
}

export function applySecurityHeaders(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('cross-origin-resource-policy', 'cross-origin');
  response.setHeader('cache-control', 'no-store');
  if (request.headers['x-forwarded-proto'] === 'https') {
    response.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

export function safeEqual(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function bearerToken(request: IncomingMessage): string {
  return (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
