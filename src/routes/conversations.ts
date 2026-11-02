import type { ServerResponse } from 'node:http';

import { deleteConversation } from '../services/conversation-store.js';
import { send } from '../utils/http.js';

export function deleteConversationRoute(
  response: ServerResponse,
  conversationId: string | null,
): void {
  send(response, 200, {
    deleted: conversationId ? deleteConversation(conversationId) : false,
  });
}
