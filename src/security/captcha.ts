import config from '../config.js';
import { httpError } from '../types/http.js';

type TurnstileResponse = { success?: boolean; 'error-codes'?: string[] };

// Verifies a Cloudflare Turnstile token when TURNSTILE_SECRET is set; otherwise does nothing.
export async function verifyCaptcha(token: unknown, ip: string): Promise<void> {
  const secret = config.auth.turnstileSecret;
  if (!secret) return;
  if (typeof token !== 'string' || !token || token.length > 4096) {
    throw httpError(400, 'captcha_required', 'A captcha token is required');
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as TurnstileResponse | null;
  if (!result?.success) throw httpError(403, 'captcha_failed', 'Captcha verification failed');
}
