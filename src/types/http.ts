export type RequestBody = {
  message?: unknown;
  conversationId?: string;
  history?: unknown;
  stream?: boolean;
};

export type HistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type HttpError = Error & { status?: number };
