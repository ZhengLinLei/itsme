import type { IncomingMessage } from 'node:http';

import config from '../config.js';
import { bearerToken, safeEqual } from '../security/request.js';

// Shared client key (optional). With ADMIN_API_KEY, admins also pass this check.
export function authorized(request: IncomingMessage): boolean {
  if (!config.auth.apiKey) return true;
  const token = bearerToken(request);
  return safeEqual(token, config.auth.apiKey) || adminAuthorized(request);
}

export function adminAuthorized(request: IncomingMessage): boolean {
  return (
    Boolean(config.auth.adminApiKey) && safeEqual(bearerToken(request), config.auth.adminApiKey)
  );
}
