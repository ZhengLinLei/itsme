import type { IncomingMessage, ServerResponse } from 'node:http';

import config from '../config.js';
import type { RequestBody } from '../types/http.js';

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function readJson(request: IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        reject(Object.assign(new Error('Request body is too large'), { status: 413 }));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });

    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as RequestBody);
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });

    request.on('error', reject);
  });
}
