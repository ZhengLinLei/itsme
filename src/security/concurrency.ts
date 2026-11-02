import { httpError } from '../types/http.js';

// Caps how many LLM calls run at once so a burst of clients cannot exhaust the model host.
export class ConcurrencyLimiter {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      if (this.waiting.length >= this.maxQueue) {
        throw httpError(503, 'busy', 'The assistant is busy, try again in a moment', 5);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
