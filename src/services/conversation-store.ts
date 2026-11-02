import crypto from 'node:crypto';

import config from '../config.js';
import type { Conversation } from '../types/conversation.js';
import type { HistoryItem, RequestBody } from '../types/http.js';
import type { Message } from '../types/message.js';

const conversations = new Map<string, Conversation>();

export function removeExpiredConversations(): void {
  const limit = Date.now() - config.conversationTtlMs;
  for (const [id, conversation] of conversations) {
    if (conversation.updatedAt < limit) conversations.delete(id);
  }
}

export function deleteConversation(conversationId: string): boolean {
  return conversations.delete(conversationId);
}

export function buildMessages(body: RequestBody): {
  conversationId: string;
  messages: Message[];
} {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    throw Object.assign(new Error('The "message" field is required'), { status: 400 });
  }

  let conversationId = body.conversationId;
  let history: Message[] = [];
  if (conversationId) {
    history = conversations.get(conversationId)?.messages || [];
  } else if (Array.isArray(body.history)) {
    history = body.history.filter(isHistoryItem);
  } else {
    conversationId = crypto.randomUUID();
  }

  const currentMessage: Message = { role: 'user', content: message };
  const messages: Message[] = [...history.slice(-config.maxHistory), currentMessage];
  while (messages[0]?.role !== 'user') messages.shift();

  return { conversationId: conversationId || crypto.randomUUID(), messages };
}

export function rememberConversation(
  conversationId: string,
  messages: Message[],
  reply: string,
): void {
  const assistantMessage: Message = { role: 'assistant', content: reply };
  conversations.set(conversationId, {
    messages: [...messages, assistantMessage].slice(-config.maxHistory),
    updatedAt: Date.now(),
  });
}

function isHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string';
}
