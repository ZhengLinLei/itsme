import type { Message } from './message.js';

export type Session = {
  id: string;
  messages: Message[];
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};
