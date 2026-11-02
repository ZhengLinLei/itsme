import type { IncomingMessage, ServerResponse } from 'node:http';

import config from '../config.js';
import { getSystemPrompt } from '../context.js';
import { completeMessage, info } from '../llm.js';
import { buildMessages, rememberConversation } from '../services/conversation-store.js';
import { readJson, send } from '../utils/http.js';

export async function chat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const { conversationId, messages } = buildMessages(body);
  const system = getSystemPrompt();

  if (body.stream) {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const write = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);

    try {
      const reply = await completeMessage(system, messages, (token) => write({ token }));
      rememberConversation(conversationId, messages, reply);
      write({ done: true, conversationId, reply });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[chat]', message);
      write({ error: message });
    }

    response.end();
    return;
  }

  const started = Date.now();
  const reply = await completeMessage(system, messages);
  rememberConversation(conversationId, messages, reply);
  send(response, 200, {
    conversationId,
    reply,
    model: info.model,
    ms: Date.now() - started,
  });
}
