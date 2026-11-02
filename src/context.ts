import fs from 'node:fs';
import config from './config.js';

const BASE_PROMPT = `You are a message manager assistant. Answer users clearly, briefly, politely, and in the same language they use.
Use only the CONTEXT for concrete information (hours, prices, policies, and so on).
If the answer is not in the context, say so honestly and offer an alternative (for example, contacting a person).
Do not make up information.`;

let cache: { mtimeMs: number; text: string } = { mtimeMs: -1, text: '' };

export function getContext(): string {
  try {
    const { mtimeMs } = fs.statSync(config.contextFile);
    if (mtimeMs !== cache.mtimeMs) {
      cache = {
        mtimeMs,
        text: fs.readFileSync(config.contextFile, 'utf8').trim(),
      };
      console.log(`[context] loaded ${config.contextFile} (${cache.text.length} characters)`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cache.mtimeMs !== 0)
      console.warn(`[context] could not read ${config.contextFile}: ${message}`);
    cache = { mtimeMs: 0, text: '' };
  }
  return cache.text;
}

export function getSystemPrompt(): string {
  const context = getContext();
  return context ? `${BASE_PROMPT}\n\n### CONTEXT\n${context}` : BASE_PROMPT;
}
