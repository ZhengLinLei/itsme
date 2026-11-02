import http from 'node:http';

import config from './config.js';
import { getContext } from './context.js';
import { authorized } from './middleware/auth.js';
import { info } from './llm.js';
import { chat } from './routes/chat.js';
import { context } from './routes/context.js';
import { deleteConversationRoute } from './routes/conversations.js';
import { removeExpiredConversations } from './services/conversation-store.js';
import type { HttpError } from './types/http.js';
import { send } from './utils/http.js';

const server = http.createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', config.corsOrigin);
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url || '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (path === '/health' && request.method === 'GET') {
      send(response, 200, { status: 'ok', ...info });
      return;
    }

    if (path === '/api/context' && request.method === 'GET') {
      if (!authorized(request)) {
        send(response, 401, { error: 'Unauthorized' });
        return;
      }
      context(response);
      return;
    }

    if (path === '/api/chat' && request.method === 'POST') {
      if (!authorized(request)) {
        send(response, 401, { error: 'Unauthorized' });
        return;
      }
      await chat(request, response);
      return;
    }

    if (path === '/api/conversations' && request.method === 'DELETE') {
      if (!authorized(request)) {
        send(response, 401, { error: 'Unauthorized' });
        return;
      }
      deleteConversationRoute(response, url.searchParams.get('id'));
      return;
    }

    send(response, 404, { error: 'Route not found' });
  } catch (error) {
    const typedError = error as HttpError;
    const message = typedError instanceof Error ? typedError.message : String(error);
    console.error(`[${request.method} ${path}]`, message);
    if (!response.headersSent) send(response, typedError.status || 502, { error: message });
    else response.end();
  }
});

server.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} | provider=${info.provider} model=${info.model}`);
  getContext();
});

setInterval(removeExpiredConversations, 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
