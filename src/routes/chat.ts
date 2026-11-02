import type { IncomingMessage, ServerResponse } from 'node:http';

import { info } from '../llm.js';
import { clientIp } from '../security/request.js';
import { cleanMessage, openSession, reply } from '../services/chat-service.js';
import { tokenFor } from '../services/session-store.js';
import type { HttpError } from '../types/http.js';
import { readJson, send, sessionTokenHeader } from '../utils/http.js';

import { requireSession, sessionInfo } from './session.js';

export async function chat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const ip = clientIp(request);
  // Validate before creating a session so invalid requests do not use the session quota.
  cleanMessage(body.message);
  // Without a token a new session is created; an invalid or expired token is an error so the
  // client knows its conversation is gone.
  const session = sessionTokenHeader(request)
    ? requireSession(request)
    : await openSession(ip, body.captchaToken);
  response.setHeader('x-session-token', tokenFor(session));

  // Cancel the LLM call if the client goes away.
  const abort = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) abort.abort();
  });

  if (body.stream === true) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (event: string, value: unknown) =>
      response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);

    write('session', sessionInfo(session));
    try {
      const answer = await reply(
        session,
        body.message,
        ip,
        (token) => write('token', { token }),
        abort.signal,
      );
      write('done', { reply: answer, ...sessionInfo(session) });
    } catch (error) {
      const typed = error as HttpError;
      write('error', { code: typed.code || 'error', error: typed.message });
    }
    response.end();
    return;
  }

  const started = Date.now();
  const answer = await reply(session, body.message, ip, undefined, abort.signal);
  send(response, 200, {
    reply: answer,
    model: info.model,
    ms: Date.now() - started,
    ...sessionInfo(session),
  });
}
