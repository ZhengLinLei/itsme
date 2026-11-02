import config from './config.js';
import type { Message } from './types/message.js';

export type { Message } from './types/message.js';

type OpenAiResponse = {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
  }>;
};

type OllamaResponse = {
  message?: { content?: string };
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
};

type StreamEvent = {
  type?: string;
  choices?: Array<{ delta?: { content?: string } }>;
  delta?: { text?: string };
};
type TokenHandler = (token: string) => void;
const { provider, model, baseUrl, apiKey, temperature, maxTokens, timeoutMs } = config.llm;

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${provider} responded with ${response.status}: ${text.slice(0, 500)}`);
  }
  return response;
}

async function* lines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function sseData(line: string): StreamEvent | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  return data === '[DONE]' ? null : (JSON.parse(data) as StreamEvent);
}

async function complete(
  system: string,
  messages: Message[],
  onToken?: TokenHandler,
  signal?: AbortSignal,
): Promise<string> {
  const stream = Boolean(onToken);
  const response = await post(
    `${baseUrl}/chat/completions`,
    apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    {
      model,
      stream,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    },
    signal,
  );
  if (!stream)
    return ((await response.json()) as OpenAiResponse).choices?.[0]?.message?.content ?? '';
  let output = '';
  for await (const line of lines(response)) {
    const token = sseData(line)?.choices?.[0]?.delta?.content || '';
    if (token) {
      output += token;
      onToken?.(token);
    }
  }
  return output;
}

export async function completeMessage(
  system: string,
  messages: Message[],
  onToken?: TokenHandler,
  signal?: AbortSignal,
): Promise<string> {
  if (provider === 'openai') return complete(system, messages, onToken, signal);
  if (provider === 'ollama') {
    const stream = Boolean(onToken);
    const response = await post(
      `${baseUrl}/api/chat`,
      {},
      {
        model,
        stream,
        messages: [{ role: 'system', content: system }, ...messages],
        options: { temperature, num_predict: maxTokens },
      },
      signal,
    );
    if (!stream) return ((await response.json()) as OllamaResponse).message?.content ?? '';
    let output = '';
    for await (const line of lines(response)) {
      const token = (JSON.parse(line) as OllamaResponse).message?.content || '';
      if (token) {
        output += token;
        onToken?.(token);
      }
    }
    return output;
  }
  const stream = Boolean(onToken);
  const response = await post(
    `${baseUrl}/v1/messages`,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      stream,
      system,
      temperature,
      max_tokens: maxTokens,
      messages,
    },
    signal,
  );
  if (!stream) {
    const data = (await response.json()) as AnthropicResponse;
    return (data.content || [])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  }
  let output = '';
  for await (const line of lines(response)) {
    const event = sseData(line);
    const token = event?.type === 'content_block_delta' ? event.delta?.text || '' : '';
    if (token) {
      output += token;
      onToken?.(token);
    }
  }
  return output;
}

export const info = { provider, model, baseUrl };
