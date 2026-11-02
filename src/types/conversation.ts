import type { Message } from './message.js';

export type Conversation = {
  messages: Message[];
  updatedAt: number;
};
