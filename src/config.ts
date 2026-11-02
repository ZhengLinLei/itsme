type Provider = 'ollama' | 'openai' | 'anthropic';

const numberValue = (value: string | undefined, fallback: number): number =>
  value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value);

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
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  contextFile: process.env.CONTEXT_FILE || '/app/context/context.txt',
  maxBodyBytes: numberValue(process.env.MAX_BODY_BYTES, 1_000_000),
  maxHistory: numberValue(process.env.MAX_HISTORY, 20),
  conversationTtlMs: numberValue(process.env.CONVERSATION_TTL_MIN, 60) * 60_000,
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
