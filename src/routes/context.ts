import type { ServerResponse } from 'node:http';

import config from '../config.js';
import { getContext } from '../context.js';
import { send } from '../utils/http.js';

export function context(response: ServerResponse): void {
  send(response, 200, {
    file: config.contextFile,
    context: getContext(),
  });
}
