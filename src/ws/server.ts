import crypto from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import config from '../config.js';
import { authorized } from '../middleware/auth.js';
import { sessionInfo } from '../routes/session.js';
import { RateLimiter } from '../security/rate-limit.js';
import { clientIp, originAllowed } from '../security/request.js';
import { openSession, reply } from '../services/chat-service.js';
import { deleteSession, getSession } from '../services/session-store.js';
import type { Session } from '../types/conversation.js';
import type { HttpError } from '../types/http.js';

// Protocol (JSON text frames), see README:
//   client -> { type: "hello", sessionToken?, captchaToken? }  must be the first frame
//   client -> { type: "message", id?, text }
//   client -> { type: "history" } | { type: "reset" } | { type: "ping" }
//   server -> session | token | reply | history | pong | error

const PATH = '/ws';
const HELLO_TIMEOUT_MS = 10_000;
const connectionsPerIp = new Map<string, number>();
const frameLimiter = new RateLimiter('WebSocket frames per connection', 60, 60_000);

type ClientFrame = {
  type?: unknown;
  id?: unknown;
  text?: unknown;
  sessionToken?: unknown;
  captchaToken?: unknown;
};

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.limits.maxBodyBytes,
    perMessageDeflate: false,
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== PATH) return reject(socket, 404, 'Not Found');
    if (!originAllowed(request.headers.origin)) return reject(socket, 403, 'Forbidden');
    if (!authorized(request)) return reject(socket, 401, 'Unauthorized');

    const ip = clientIp(request);
    const open = connectionsPerIp.get(ip) || 0;
    if (open >= config.limits.wsConnectionsPerIp) return reject(socket, 429, 'Too Many Requests');

    wss.handleUpgrade(request, socket, head, (ws) => {
      connectionsPerIp.set(ip, open + 1);
      ws.once('close', () => {
        const left = (connectionsPerIp.get(ip) || 1) - 1;
        if (left > 0) connectionsPerIp.set(ip, left);
        else connectionsPerIp.delete(ip);
      });
      handleConnection(ws, ip);
    });
  });

  // Drop connections that stop answering pings.
  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleConnection(ws: WebSocket, ip: string): void {
  const key = crypto.randomUUID();
  let session: Session | null = null;
  let pending: AbortController | null = null;
  let idleTimer: NodeJS.Timeout | undefined;

  const send = (frame: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
  const fail = (error: unknown, id?: unknown) => {
    const typed = error as HttpError;
    send({
      type: 'error',
      ...(id !== undefined && { id }),
      code: typed.code || 'error',
      error: typed.message || 'Unexpected error',
      ...(typed.retryAfter && { retryAfter: typed.retryAfter }),
    });
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ws.close(1000, 'Idle timeout'), config.limits.wsIdleTimeoutMs);
  };

  const helloTimer = setTimeout(() => ws.close(1008, 'Expected hello'), HELLO_TIMEOUT_MS);
  touch();

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clearTimeout(idleTimer);
    pending?.abort();
  });

  ws.on('message', async (data: RawData, isBinary: boolean) => {
    touch();
    if (isBinary) return ws.close(1003, 'Binary frames are not supported');

    const retryAfter = frameLimiter.take(key);
    if (retryAfter) return fail({ code: 'rate_limited', message: 'Too many frames', retryAfter });

    let frame: ClientFrame;
    try {
      frame = JSON.parse(data.toString()) as ClientFrame;
      if (!frame || typeof frame !== 'object') throw new Error();
    } catch {
      return fail({ code: 'invalid_json', message: 'Frames must be JSON objects' });
    }

    try {
      if (!session) {
        if (frame.type !== 'hello')
          return fail({ code: 'hello_required', message: 'Send a hello frame first' });
        clearTimeout(helloTimer);
        session = frame.sessionToken ? getSession(frame.sessionToken) : null;
        if (!session && frame.sessionToken) {
          // The old session expired: tell the client and open a new one.
          send({
            type: 'error',
            code: 'invalid_session',
            error: 'Session expired, a new one was created',
          });
        }
        session ??= await openSession(ip, frame.captchaToken);
        return send({ type: 'session', ...sessionInfo(session) });
      }

      switch (frame.type) {
        case 'message': {
          const id =
            typeof frame.id === 'string' || typeof frame.id === 'number' ? frame.id : undefined;
          pending = new AbortController();
          const answer = await reply(
            session,
            frame.text,
            ip,
            (token) => send({ type: 'token', id, token }),
            pending.signal,
          );
          pending = null;
          return send({ type: 'reply', id, reply: answer, ...sessionInfo(session) });
        }
        case 'history':
          return send({ type: 'history', messages: session.messages, ...sessionInfo(session) });
        case 'reset':
          pending?.abort();
          deleteSession(session);
          session = await openSession(ip, frame.captchaToken);
          return send({ type: 'session', ...sessionInfo(session) });
        case 'ping':
          return send({ type: 'pong' });
        default:
          return fail({ code: 'unknown_type', message: 'Unknown frame type' });
      }
    } catch (error) {
      pending = null;
      fail(error, frame.id);
    }
  });
}
