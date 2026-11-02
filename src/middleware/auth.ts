import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import config from '../config.js';

export function authorized(request: IncomingMessage): boolean {
  if (!config.apiKey) return true;

  const given = Buffer.from((request.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.apiKey);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
