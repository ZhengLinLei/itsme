import config from '../config.js';
import { getSystemPrompt } from '../context.js';
import { completeMessage } from '../llm.js';
import { verifyCaptcha } from '../security/captcha.js';
import { ConcurrencyLimiter } from '../security/concurrency.js';
import { RateLimiter } from '../security/rate-limit.js';
import type { Session } from '../types/conversation.js';
import { httpError } from '../types/http.js';
import type { Message } from '../types/message.js';

import { appendExchange, createSession } from './session-store.js';

// Shared by the HTTP API and the WebSocket server so both get the same protections.

const { limits } = config;
const ipMessages = new RateLimiter('messages per IP', limits.messagesPerMinute, 60_000);
const sessionMessages = new RateLimiter('messages per session', limits.messagesPerMinute, 60_000);
const ipSessions = new RateLimiter('new sessions per IP', limits.sessionsPerHour, 3_600_000);
const llmSlots = new ConcurrencyLimiter(limits.llmConcurrency, limits.llmQueue);
const busySessions = new Set<string>();
// Control characters (except tabs and new lines) and invisible formatting characters.
const INVISIBLE_CHARACTERS = new RegExp(
  '[\\u0000-\\u0008\\u000B-\\u001F\\u007F\\u200B-\\u200F\\u2028-\\u202E\\uFEFF]',
  'g',
);

export async function openSession(ip: string, captchaToken: unknown): Promise<Session> {
  ipSessions.consume(ip);
  await verifyCaptcha(captchaToken, ip);
  return createSession();
}

export function cleanMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw httpError(400, 'invalid_message', 'The "message" field must be a string');
  }
  const message = value.replace(INVISIBLE_CHARACTERS, '').trim();
  if (!message) throw httpError(400, 'invalid_message', 'The "message" field is required');
  if (message.length > limits.maxMessageChars) {
    throw httpError(
      413,
      'message_too_long',
      `Messages are limited to ${limits.maxMessageChars} characters`,
    );
  }
  return message;
}

export async function reply(
  session: Session,
  rawMessage: unknown,
  ip: string,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const message = cleanMessage(rawMessage);
  if (session.messageCount >= limits.messagesPerSession) {
    throw httpError(
      429,
      'session_quota',
      'This session reached its message limit, start a new one',
    );
  }
  if (busySessions.has(session.id)) {
    throw httpError(
      409,
      'session_busy',
      'Wait for the previous reply before sending another message',
    );
  }
  ipMessages.consume(ip);
  sessionMessages.consume(session.id);

  busySessions.add(session.id);
  try {
    const userMessage: Message = { role: 'user', content: message };
    const answer = await llmSlots.run(async () => {
      signal?.throwIfAborted();
      return completeMessage(
        getSystemPrompt(),
        [...session.messages, userMessage],
        onToken,
        signal,
      );
    });
    appendExchange(session, userMessage, { role: 'assistant', content: answer });
    return answer;
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    // Provider errors may contain internal URLs or keys: log them, return a generic error.
    console.error('[llm]', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error(
        `[llm] no answer within LLM_TIMEOUT_MS=${config.llm.timeoutMs}: the model host is too slow ` +
          'for this context size (use a native Ollama with GPU, a smaller context, or raise the timeout)',
      );
      throw httpError(504, 'llm_timeout', 'The assistant took too long to answer, try again later');
    }
    throw httpError(502, 'llm_error', 'The assistant could not answer, try again later');
  } finally {
    busySessions.delete(session.id);
  }
}
