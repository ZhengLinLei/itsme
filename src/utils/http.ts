import type { IncomingMessage, ServerResponse } from 'node:http';

import config from '../config.js';
import { httpError, type RequestBody } from '../types/http.js';

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function sessionTokenHeader(request: IncomingMessage): string | undefined {
  const value = request.headers['x-session-token'];
  return Array.isArray(value) ? value[0] : value;
}

export function readJson(request: IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    const type = request.headers['content-type'] || '';
    const length = Number(request.headers['content-length'] || 0);
    if (length > config.limits.maxBodyBytes) {
      reject(httpError(413, 'body_too_large', 'Request body is too large'));
      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.limits.maxBodyBytes) {
        reject(httpError(413, 'body_too_large', 'Request body is too large'));
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
      // Browsers can send text/plain cross-site without a preflight, so only accept JSON.
      if (!type.toLowerCase().startsWith('application/json')) {
        reject(httpError(415, 'unsupported_media_type', 'Use content-type: application/json'));
        return;
      }

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body as RequestBody);
      } catch {
        reject(httpError(400, 'invalid_json', 'Invalid JSON'));
      }
    });

    request.on('error', reject);
  });
}
