import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import config from './config.js';
import { getContext } from './context.js';
import { info } from './llm.js';
import { adminAuthorized, authorized } from './middleware/auth.js';
import { chat } from './routes/chat.js';
import { context } from './routes/context.js';
import { createSessionRoute, deleteSessionRoute, getSessionRoute } from './routes/session.js';
import { RateLimiter } from './security/rate-limit.js';
import { applyCors, applySecurityHeaders, clientIp, originAllowed } from './security/request.js';
import { loadSessions, removeExpiredSessions, saveSessions } from './services/session-store.js';
import { httpError, type HttpError } from './types/http.js';
import { send } from './utils/http.js';
import { attachWebSocket } from './ws/server.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => unknown;
type Route = { handler: Handler; access: 'public' | 'client' | 'admin' };

const routes: Record<string, Route> = {
  'GET /health': {
    access: 'public',
    handler: (_, response) => send(response, 200, { status: 'ok' }),
  },
  'POST /api/session': { access: 'client', handler: createSessionRoute },
  'GET /api/session': { access: 'client', handler: getSessionRoute },
  'DELETE /api/session': { access: 'client', handler: deleteSessionRoute },
  'POST /api/chat': { access: 'client', handler: chat },
  'GET /api/context': { access: 'admin', handler: (_, response) => context(response) },
  'GET /api/info': { access: 'admin', handler: (_, response) => send(response, 200, info) },
};

const requestLimiter = new RateLimiter('requests per IP', config.limits.requestsPerMinute, 60_000);

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  applySecurityHeaders(request, response);
  applyCors(request, response);

  // Browser requests from origins outside the allowlist are refused, not only left without CORS.
  if (!originAllowed(request.headers.origin))
    throw httpError(403, 'origin_not_allowed', 'Origin not allowed');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  requestLimiter.consume(clientIp(request));

  const path = new URL(request.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
  const route = routes[`${request.method} ${path}`];
  // Admin routes stay hidden while ADMIN_API_KEY is not configured.
  if (!route || (route.access === 'admin' && !config.auth.adminApiKey)) {
    throw httpError(404, 'not_found', 'Route not found');
  }
  if (route.access === 'client' && !authorized(request))
    throw httpError(401, 'unauthorized', 'Unauthorized');
  if (route.access === 'admin' && !adminAuthorized(request))
    throw httpError(401, 'unauthorized', 'Unauthorized');

  await route.handler(request, response);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    const typed = error as HttpError;
    const status = typed.status || 500;
    if (status >= 500) console.error(`[${request.method} ${request.url}]`, typed.message);
    if (response.headersSent) {
      response.end();
      return;
    }
    if (typed.retryAfter) response.setHeader('retry-after', String(typed.retryAfter));
    send(response, status, {
      error: status >= 500 && !typed.code ? 'Internal error' : typed.message,
      code: typed.code || 'internal_error',
    });
  });
});

// Slow or idle clients cannot hold connections open.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.maxConnections = 1_000;

const wss = attachWebSocket(server);

loadSessions();
setInterval(() => {
  removeExpiredSessions();
  saveSessions();
}, 30_000).unref();

server.listen(config.port, () => {
  console.log(
    `[api] listening on :${config.port} (HTTP + WebSocket /ws) | provider=${info.provider} model=${info.model}`,
  );
  if (!config.cors.origins.length)
    console.warn('[api] CORS_ORIGINS is empty: browsers on other origins are blocked');
  if (config.cors.origins.includes('*'))
    console.warn('[api] CORS_ORIGINS=* allows any website to use this API');
  getContext();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    saveSessions();
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
