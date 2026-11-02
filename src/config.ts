type Provider = 'ollama' | 'openai' | 'anthropic';

const numberValue = (value: string | undefined, fallback: number): number =>
  value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value);

const booleanValue = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === ''
    ? fallback
    : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const listValue = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase() as Provider;
const providerDefaults: Record<Provider, { model: string; baseUrl: string }> = {
  ollama: { model: 'qwen2.5:3b', baseUrl: 'http://127.0.0.1:11434' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  anthropic: {
    model: 'claude-haiku-5-5',
    baseUrl: 'https://api.anthropic.com',
  },
};

if (!providerDefaults[provider]) {
  throw new Error(
    `Unknown LLM_PROVIDER: "${provider}". Use: ${Object.keys(providerDefaults).join(', ')}`,
  );
}

const defaults = providerDefaults[provider];

export default {
  port: numberValue(process.env.PORT, 3000),
  production: process.env.NODE_ENV === 'production',
  contextFile: process.env.CONTEXT_FILE || '/app/context/context.txt',
  dataDir: process.env.DATA_DIR || '/app/data',

  auth: {
    // Optional shared key for every route except /health. Only useful when the caller is
    // another backend: a key shipped in browser code is public.
    apiKey: process.env.API_KEY || '',
    // Required for admin routes (GET /api/context). Admin routes are disabled when empty.
    adminApiKey: process.env.ADMIN_API_KEY || '',
    // Signs session tokens. Generated and stored in DATA_DIR when empty.
    sessionSecret: process.env.SESSION_SECRET || '',
    // Optional Cloudflare Turnstile secret: when set, creating a session requires a captcha.
    turnstileSecret: process.env.TURNSTILE_SECRET || '',
  },

  cors: {
    // Comma-separated allowlist, e.g. "https://app.example.com,http://localhost:5173".
    // "*" allows any origin. Empty blocks every browser origin.
    origins: listValue(process.env.CORS_ORIGINS),
  },

  // Read the client IP from X-Forwarded-For. Enable only behind a trusted reverse proxy.
  trustProxy: booleanValue(process.env.TRUST_PROXY, false),

  limits: {
    maxBodyBytes: numberValue(process.env.MAX_BODY_BYTES, 16_384),
    maxMessageChars: numberValue(process.env.MAX_MESSAGE_CHARS, 2_000),
    // Messages per minute for each IP and for each session.
    messagesPerMinute: numberValue(process.env.RATE_LIMIT_MESSAGES_PER_MIN, 12),
    // Other HTTP requests per minute for each IP.
    requestsPerMinute: numberValue(process.env.RATE_LIMIT_REQUESTS_PER_MIN, 60),
    // New sessions per hour for each IP.
    sessionsPerHour: numberValue(process.env.RATE_LIMIT_SESSIONS_PER_HOUR, 20),
    // Messages each session may send during its lifetime.
    messagesPerSession: numberValue(process.env.MAX_MESSAGES_PER_SESSION, 200),
    maxSessions: numberValue(process.env.MAX_SESSIONS, 10_000),
    // LLM requests running at the same time, and requests allowed to wait for a slot.
    llmConcurrency: numberValue(process.env.LLM_CONCURRENCY, 2),
    llmQueue: numberValue(process.env.LLM_QUEUE, 20),
    wsConnectionsPerIp: numberValue(process.env.WS_MAX_CONNECTIONS_PER_IP, 5),
    wsIdleTimeoutMs: numberValue(process.env.WS_IDLE_TIMEOUT_SEC, 300) * 1000,
  },

  session: {
    ttlMs: numberValue(process.env.SESSION_TTL_HOURS, 24) * 3_600_000,
    maxHistory: numberValue(process.env.MAX_HISTORY, 20),
  },

  llm: {
    provider,
    model: process.env.LLM_MODEL || defaults.model,
    baseUrl: (process.env.LLM_BASE_URL || defaults.baseUrl).replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    temperature: numberValue(process.env.LLM_TEMPERATURE, 0.4),
    maxTokens: numberValue(process.env.LLM_MAX_TOKENS, 512),
    timeoutMs: numberValue(process.env.LLM_TIMEOUT_MS, 120_000),
  },
};
