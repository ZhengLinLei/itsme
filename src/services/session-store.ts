import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import config from '../config.js';
import type { Session } from '../types/conversation.js';
import type { Message } from '../types/message.js';

// Sessions are identified by a server-issued token "<id>.<signature>". The id is 192 random
// bits and the signature is an HMAC, so clients cannot pick, guess or forge ids. Sessions
// expire after SESSION_TTL_HOURS without activity and are saved to DATA_DIR.

const sessions = new Map<string, Session>();
const dataFile = path.join(config.dataDir, 'sessions.json');
const secret = loadSecret();
let dirty = false;

function loadSecret(): string {
  if (config.auth.sessionSecret) return config.auth.sessionSecret;
  const file = path.join(config.dataDir, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const generated = crypto.randomBytes(32).toString('base64url');
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, generated, { mode: 0o600 });
    } catch (error) {
      console.warn(
        `[session] could not save the session secret, tokens will reset on restart: ${String(error)}`,
      );
    }
    return generated;
  }
}

function sign(id: string): string {
  return crypto.createHmac('sha256', secret).update(id).digest('base64url');
}

export function tokenFor(session: Session): string {
  return `${session.id}.${sign(session.id)}`;
}

function idFromToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [id, signature] = token.split('.');
  if (!id || !signature) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? id : null;
}

function expired(session: Session): boolean {
  return session.updatedAt < Date.now() - config.session.ttlMs;
}

export function createSession(): Session {
  if (sessions.size >= config.limits.maxSessions) evictOldest();
  const now = Date.now();
  const session: Session = {
    id: crypto.randomBytes(24).toString('base64url'),
    messages: [],
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.id, session);
  dirty = true;
  return session;
}

export function getSession(token: unknown): Session | null {
  const id = idFromToken(token);
  const session = id ? sessions.get(id) : undefined;
  if (!session) return null;
  if (expired(session)) {
    sessions.delete(session.id);
    dirty = true;
    return null;
  }
  return session;
}

export function deleteSession(session: Session): void {
  sessions.delete(session.id);
  dirty = true;
}

export function appendExchange(session: Session, user: Message, assistant: Message): void {
  session.messages = [...session.messages, user, assistant].slice(-config.session.maxHistory);
  session.messageCount += 1;
  session.updatedAt = Date.now();
  dirty = true;
}

export function expiresAt(session: Session): string {
  return new Date(session.updatedAt + config.session.ttlMs).toISOString();
}

function evictOldest(): void {
  let oldest: Session | undefined;
  for (const session of sessions.values()) {
    if (!oldest || session.updatedAt < oldest.updatedAt) oldest = session;
  }
  if (oldest) sessions.delete(oldest.id);
}

export function removeExpiredSessions(): void {
  for (const session of sessions.values()) {
    if (expired(session)) {
      sessions.delete(session.id);
      dirty = true;
    }
  }
}

export function loadSessions(): void {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Session[];
    for (const session of saved) if (!expired(session)) sessions.set(session.id, session);
    console.log(`[session] restored ${sessions.size} sessions`);
  } catch {
    // No saved sessions yet.
  }
}

export function saveSessions(): void {
  if (!dirty) return;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const temporary = `${dataFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...sessions.values()]), { mode: 0o600 });
    fs.renameSync(temporary, dataFile);
    dirty = false;
  } catch (error) {
    console.warn(`[session] could not save sessions: ${String(error)}`);
  }
}
