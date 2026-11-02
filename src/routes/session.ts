import type { IncomingMessage, ServerResponse } from 'node:http';

import config from '../config.js';
import { clientIp } from '../security/request.js';
import { openSession } from '../services/chat-service.js';
import { deleteSession, expiresAt, getSession, tokenFor } from '../services/session-store.js';
import type { Session } from '../types/conversation.js';
import { httpError } from '../types/http.js';
import { readJson, send, sessionTokenHeader } from '../utils/http.js';

export function requireSession(request: IncomingMessage): Session {
  const session = getSession(sessionTokenHeader(request));
  if (!session)
    throw httpError(401, 'invalid_session', 'Session is missing or expired, create a new one');
  return session;
}

export function sessionInfo(session: Session) {
  return {
    sessionToken: tokenFor(session),
    expiresAt: expiresAt(session),
    messageCount: session.messageCount,
    remainingMessages: Math.max(0, config.limits.messagesPerSession - session.messageCount),
  };
}

export async function createSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJson(request);
  const session = await openSession(clientIp(request), body.captchaToken);
  send(response, 201, sessionInfo(session));
}

export function getSessionRoute(request: IncomingMessage, response: ServerResponse): void {
  const session = requireSession(request);
  send(response, 200, { ...sessionInfo(session), messages: session.messages });
}

export function deleteSessionRoute(request: IncomingMessage, response: ServerResponse): void {
  deleteSession(requireSession(request));
  send(response, 200, { deleted: true });
}
