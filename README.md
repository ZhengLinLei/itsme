# itsme

Docker image

```bash
docker push zhenglinlei/itsme:latest
```

Self-hosted AI assistant backend for a message manager. A Node (TypeScript) server answers each message with an LLM. It uses the business or personal information in `context/context.txt` and keeps every conversation for 24 hours. Clients connect over a **REST API** (optional streaming) or a **WebSocket**, whichever they prefer. It runs in Docker (`RUN.sh`) or directly on your machine (`RUN.local.sh`).

- **Local by default:** [Ollama](https://ollama.com) runs inside the container with `qwen2.5:3b`. Messages never leave the machine.
- **Configurable:** any Ollama model, any OpenAI-compatible API (OpenAI, Groq, vLLM, LM Studio...), or Anthropic.
- **Safe to expose to a browser front end:** origin allowlist, signed session tokens, rate limits, an LLM concurrency cap, input limits and security headers. See [Security](#security).
- **Context tools:** pull information from GitHub, LinkedIn, Google Business, websites, or documents into the context file.

## Contents

- [Quick start](#quick-start)
- [Run locally without Docker](#run-locally-without-docker)
- [Sessions](#sessions)
- [REST API](#rest-api)
- [WebSocket API](#websocket-api)
- [Errors](#errors)
- [Security](#security)
- [Context file and tools](#context-file-and-tools)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Development](#development)
- [Deployment](#deployment)

## Quick start

```bash
cp .env.example .env     # set CORS_ORIGINS to your front-end URL
./BUILD.sh
./RUN.sh                 # http://localhost:3000 and ws://localhost:3000/ws
```

The first run downloads the model into the `itsme-api-models` volume. Sessions are stored in the `itsme-api-data` volume.

```bash
curl -X POST localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"How much does the Pro plan cost?"}'
```

> **On a Mac, use [`RUN.local.sh`](#run-locally-without-docker).** Docker on macOS cannot use the GPU and runs in a VM with limited memory. Ollama inside the container then processes prompts at about 30 tokens/s, so a longer `context.txt` hits `LLM_TIMEOUT_MS` (`504 llm_timeout`) even with a 1B model. Native Ollama uses Metal and answers in seconds.

## Run locally without Docker

```bash
cp .env.example .env     # optional
./RUN.local.sh           # http://localhost:3000 and ws://localhost:3000/ws
```

The script does everything needed to run the project on your machine:

1. Checks for Node.js 20+ and Ollama. Asks before installing anything missing: `brew install` on macOS, the official Ollama installer on Linux.
2. Starts `ollama serve` if it is not already running, and stops it again on exit. Logs go to `data/ollama.log`.
3. Downloads `LLM_MODEL` if needed and loads it into memory.
4. Runs `npm ci` when dependencies are missing or out of date, builds, and starts the API.

The settings come from `.env`, like `RUN.sh`. The context file is `context/context.txt` and sessions are saved in `./data`. Press Ctrl+C to stop.

| Option         | Description                                       |
| -------------- | ------------------------------------------------- |
| `--dev`        | Hot reload with `tsx watch` instead of a build.   |
| `--model NAME` | Use another Ollama model (overrides `LLM_MODEL`). |
| `-y`           | Install missing tools without asking.             |
| `--no-install` | Never install anything, only check.               |

Models for an 8 GB machine: `gemma3:1b` and `qwen3:1.7b` (fast), `qwen2.5:3b` and `llama3.2:3b` (better answers). Each model takes 1-2 GB of disk space.

## Sessions

The server identifies each conversation with a **session token** that it issues. Clients never choose the id.

```
<id>.<signature>      e.g. 6fSE4ZWucczfe--sPiXqL25wqHmovE0B.sScquLaMfxqHj6Zd...
```

- `id` is 192 random bits and `signature` is an HMAC-SHA256 made with `SESSION_SECRET`. A token that the server did not sign is rejected straight away, so ids cannot be guessed, enumerated or forged.
- A session stays alive for **24 hours after its last message** (`SESSION_TTL_HOURS`). It keeps the last `MAX_HISTORY` messages and survives restarts (saved to `DATA_DIR`).
- The client stores the token (for example in `localStorage`) and sends it back:
  - **REST:** in the `x-session-token` header.
  - **WebSocket:** in the `hello` frame.
- If the token has expired, the server answers `invalid_session` and the client starts a new session.

**Why not a client-supplied `session_id`?** If the client picks the id, anyone who guesses or copies another user's id can read and continue that conversation. A server-signed token avoids that and needs no database lookup to reject fake ids. If your users already log in to your own backend, have **your backend** call this API (set `API_KEY`) and store a session token for each user. That links conversations to real accounts, and the browser never talks to the LLM directly.

## REST API

Base URL: `http://localhost:3000`. Bodies are JSON (`content-type: application/json`). Send the session token as `x-session-token: <token>`. Send `authorization: Bearer <API_KEY>` only if `API_KEY` is set.

| Method   | Path           | Auth            | Description                                          |
| -------- | -------------- | --------------- | ---------------------------------------------------- |
| `GET`    | `/health`      | none            | Liveness check: `{ "status": "ok" }`.                |
| `POST`   | `/api/session` | -               | Creates a session.                                   |
| `GET`    | `/api/session` | session         | Session info and stored messages.                    |
| `DELETE` | `/api/session` | session         | Deletes the session and its history.                 |
| `POST`   | `/api/chat`    | session or none | Answers a message (JSON or Server-Sent Events).      |
| `GET`    | `/api/context` | `ADMIN_API_KEY` | Loaded context. Hidden (404) if no admin key is set. |
| `GET`    | `/api/info`    | `ADMIN_API_KEY` | Provider, model and LLM URL.                         |

### `POST /api/session`

```json
{ "captchaToken": "only when TURNSTILE_SECRET is set" }
```

`201 Created`

```json
{
  "sessionToken": "6fSE4ZWu...sScquLaM...",
  "expiresAt": "2026-11-03T16:29:10.416Z",
  "messageCount": 0,
  "remainingMessages": 200
}
```

### `POST /api/chat`

```json
{ "message": "Do you ship to Portugal?", "stream": false }
```

| Field          | Type    | Notes                                                          |
| -------------- | ------- | -------------------------------------------------------------- |
| `message`      | string  | Required, up to `MAX_MESSAGE_CHARS` (2000).                    |
| `stream`       | boolean | `true` returns Server-Sent Events.                             |
| `captchaToken` | string  | Only needed without a session token when Turnstile is enabled. |

Without `x-session-token`, a new session is created. The response always includes the token, in the `sessionToken` field and in the `x-session-token` header.

`200 OK`

```json
{
  "reply": "Yes, we ship to Portugal within 24-48 business hours.",
  "model": "qwen2.5:3b",
  "ms": 2350,
  "sessionToken": "6fSE4ZWu...",
  "expiresAt": "2026-11-03T16:29:10.416Z",
  "messageCount": 1,
  "remainingMessages": 199
}
```

**Streaming** (`"stream": true`) returns `text/event-stream`:

```
event: session
data: {"sessionToken":"...","expiresAt":"...","messageCount":0,"remainingMessages":200}

event: token
data: {"token":"Yes"}

event: token
data: {"token":", we"}

event: done
data: {"reply":"Yes, we ship...","sessionToken":"...","messageCount":1,...}
```

If the model fails mid-stream, you get `event: error` with `data: {"code":"llm_error","error":"..."}`. Browsers cannot send a POST body with `EventSource`, so read the stream with `fetch`:

```js
const response = await fetch(`${API}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-session-token': token },
  body: JSON.stringify({ message, stream: true }),
});
const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  const events = buffer.split('\n\n');
  buffer = events.pop();
  for (const raw of events) {
    const event = raw.match(/^event: (.*)$/m)?.[1];
    const data = JSON.parse(raw.match(/^data: (.*)$/m)?.[1] ?? 'null');
    if (event === 'token') render(data.token);
    if (event === 'done') localStorage.setItem('itsme-session', data.sessionToken);
  }
}
```

### `GET /api/session`

```json
{
  "sessionToken": "...",
  "expiresAt": "...",
  "messageCount": 1,
  "remainingMessages": 199,
  "messages": [
    { "role": "user", "content": "Do you ship to Portugal?" },
    { "role": "assistant", "content": "Yes, we ship to Portugal..." }
  ]
}
```

## WebSocket API

Endpoint: `ws://localhost:3000/ws` (`wss://` behind TLS). Frames are JSON text. The first frame must be `hello`, sent within 10 seconds. The connection is checked against `CORS_ORIGINS`, and against `API_KEY` if it is set (only possible from non-browser clients, which can send headers).

### Client → server

| Frame                                                                 | Description                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `{ "type": "hello", "sessionToken"?: "...", "captchaToken"?: "..." }` | Resumes a session, or creates one when the token is missing or expired. |
| `{ "type": "message", "id"?: "m1", "text": "..." }`                   | Sends a message. `id` is echoed back so you can match replies.          |
| `{ "type": "history" }`                                               | Returns the stored messages.                                            |
| `{ "type": "reset" }`                                                 | Deletes the session and starts a new one (cancels a running reply).     |
| `{ "type": "ping" }`                                                  | Application-level ping.                                                 |

### Server → client

| Frame                                                                                     | When                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `{ "type": "session", "sessionToken", "expiresAt", "messageCount", "remainingMessages" }` | After `hello` or `reset`.             |
| `{ "type": "token", "id", "token" }`                                                      | Each streamed piece of the reply.     |
| `{ "type": "reply", "id", "reply", "sessionToken", "expiresAt", "messageCount", ... }`    | The full reply, when it is finished.  |
| `{ "type": "history", "messages": [...], ... }`                                           | Answer to `history`.                  |
| `{ "type": "pong" }`                                                                      | Answer to `ping`.                     |
| `{ "type": "error", "id"?, "code", "error", "retryAfter"? }`                              | Any error. The connection stays open. |

Send one message at a time per session: a second message before the reply ends gets `session_busy`. The server also sends WebSocket pings every 30 seconds and closes connections that are idle for `WS_IDLE_TIMEOUT_SEC`.

```js
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onopen = () =>
  ws.send(JSON.stringify({ type: 'hello', sessionToken: localStorage.getItem('itsme-session') }));
ws.onmessage = ({ data }) => {
  const frame = JSON.parse(data);
  if (frame.type === 'session') localStorage.setItem('itsme-session', frame.sessionToken);
  if (frame.type === 'token') render(frame.token);
  if (frame.type === 'error') console.warn(frame.code, frame.error);
};
const ask = (text) => ws.send(JSON.stringify({ type: 'message', id: crypto.randomUUID(), text }));
```

Close codes: `1008` no `hello` in time, `1003` binary frame, `1000` idle timeout, `1001` server shutting down. Upgrade requests are refused with HTTP `403` (origin not allowed), `401` (bad `API_KEY`) or `429` (too many connections from the IP).

## Errors

REST errors use the HTTP status and a JSON body `{ "error": "message", "code": "code" }`. WebSocket errors use the same codes in an `error` frame. Answers `429` and `503` include a `retry-after` header (`retryAfter` on WebSocket), in seconds.

| Status | Code                     | Meaning                                                                                            |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| 400    | `invalid_message`        | `message` is missing, empty, or not a string.                                                      |
| 400    | `invalid_json`           | The body is not a JSON object.                                                                     |
| 400    | `captcha_required`       | Turnstile is enabled and no `captchaToken` was sent.                                               |
| 401    | `invalid_session`        | The session token is missing, forged, or expired.                                                  |
| 401    | `unauthorized`           | Wrong or missing `API_KEY` or `ADMIN_API_KEY`.                                                     |
| 403    | `origin_not_allowed`     | The browser origin is not in `CORS_ORIGINS`.                                                       |
| 403    | `captcha_failed`         | Turnstile rejected the token.                                                                      |
| 404    | `not_found`              | Unknown route.                                                                                     |
| 409    | `session_busy`           | The previous reply in this session has not finished.                                               |
| 413    | `message_too_long`       | The message is longer than `MAX_MESSAGE_CHARS`.                                                    |
| 413    | `body_too_large`         | The body is larger than `MAX_BODY_BYTES`.                                                          |
| 415    | `unsupported_media_type` | The body is not `application/json`.                                                                |
| 429    | `rate_limited`           | Too many requests, messages, sessions or frames.                                                   |
| 429    | `session_quota`          | The session used all of its `MAX_MESSAGES_PER_SESSION`.                                            |
| 502    | `llm_error`              | The model failed. Details are logged, never sent to clients.                                       |
| 503    | `busy`                   | Every LLM slot is taken and the queue is full.                                                     |
| 504    | `llm_timeout`            | The model did not answer within `LLM_TIMEOUT_MS`. The model host is too slow for the context size. |

## Security

The API is built so that a browser front end can call it directly. Every layer is configurable in `.env`.

| Layer                  | What it does                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin allowlist       | `CORS_ORIGINS` sets the CORS headers, and requests and WebSocket upgrades from other origins get `403`. This blocks other websites from using your API, including WebSocket hijacking.                      |
| Signed session tokens  | Unguessable, HMAC-signed ids. Users cannot read each other's conversations.                                                                                                                                 |
| Rate limits            | Token buckets per IP and per session: messages per minute, requests per minute, new sessions per hour, WebSocket frames per minute.                                                                         |
| Session quota          | `MAX_MESSAGES_PER_SESSION` caps the total cost of one session. `MAX_SESSIONS` caps memory use.                                                                                                              |
| LLM concurrency cap    | `LLM_CONCURRENCY` calls run at once and `LLM_QUEUE` wait. Anything beyond that gets `503` instead of overloading the model.                                                                                 |
| Cancellation           | If a client disconnects, its LLM call is aborted.                                                                                                                                                           |
| Input limits           | Small JSON-only bodies, maximum message length, control and invisible characters removed, only one in-flight message per session.                                                                           |
| Slow-client protection | Header, request and keep-alive timeouts. Limits on headers and connections. WebSocket `maxPayload`, hello timeout, idle timeout, heartbeat.                                                                 |
| Captcha (optional)     | Set `TURNSTILE_SECRET` to require a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) token for every new session. This is the strongest protection against bots when the API is public. |
| Admin separation       | `/api/context` and `/api/info` need `ADMIN_API_KEY` and are hidden when it is not set. Never put that key in front-end code.                                                                                |
| Prompt hardening       | The system prompt treats user messages as questions, not instructions, and keeps the assistant on topic.                                                                                                    |
| No information leaks   | Provider errors are logged, not returned. Message contents are never logged.                                                                                                                                |
| Security headers       | `nosniff`, `X-Frame-Options: DENY`, a strict CSP, `no-referrer`, `no-store`, and HSTS behind HTTPS.                                                                                                         |
| Container hardening    | `RUN.sh` uses `--cap-drop ALL`, `no-new-privileges` and `--pids-limit`, and mounts the context read-only. The slim image runs as the `node` user.                                                           |

Recommended production setup:

1. Put the container behind a reverse proxy with TLS (Caddy, nginx, Traefik or Cloudflare). Set `TRUST_PROXY=true` so rate limits use the real client IP. Don't publish port 3000 to the internet directly.
2. Set `CORS_ORIGINS` to your exact front-end origins (never `*`).
3. Set `SESSION_SECRET` (for example `openssl rand -base64 32`) and `ADMIN_API_KEY`.
4. For a public website, enable Turnstile. For a logged-in app, call the API from your own backend with `API_KEY`.
5. Lower `RATE_LIMIT_*` and `MAX_MESSAGES_PER_SESSION` to match your expected traffic.

Rate limits and sessions are kept in memory in one process. If you run several replicas, use sticky sessions or move the stores to Redis.

## Context file and tools

`context/context.txt` is plain text that is added to the system prompt. The API reloads it when it changes, without a restart. Keep it short and factual: small local models have a context window of about 4096 tokens, and the conversation history shares it.

The tools in `scripts/` collect information and **append** it to the end of the file. They never overwrite it. Each block is marked with its source and date, for example `[added by resumeGithub on 2026-11-02 17:27 - review before use]`. Afterwards the tool asks you to review the file. The assistant uses the new text at once, so check it for mistakes or private data. Every tool accepts `--dry-run` (print without writing), `--context <file>` and `--max-chars <n>`. They need Python 3.9+ and have no dependencies.

| Tool                                             | Source                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/resumeGithub.py <user>`                 | Public GitHub API: profile, profile README, main languages, top repositories. Optional `GITHUB_TOKEN` for higher rate limits.                                                                                                                                                                  |
| `scripts/resumeLinkedin.py <source>`             | Your LinkedIn data export (ZIP or folder from _Settings > Data privacy > Get a copy of your data_) or a profile PDF (_More > Save to PDF_, needs `pdftotext`). LinkedIn forbids scraping, so this tool uses the files LinkedIn gives you. Address, birth date and contact details are skipped. |
| `scripts/resumeGoogleBusiness.py "<name, city>"` | Google Places API (New): category, address, phone, website, opening hours, price level, services, rating and recent reviews (without reviewer names). Needs `GOOGLE_MAPS_API_KEY`. Use `--place-id` to pick an exact place.                                                                    |
| `scripts/resumeWebsite.py <url>`                 | Home page plus up to `--pages` same-domain pages that look useful (about, FAQ, pricing, contact, shipping, returns...). Respects `robots.txt`.                                                                                                                                                 |
| `scripts/resumeFile.py <files...>`               | Local documents: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.docx`, `.pdf`.                                                                                                                                                                                                                     |

```bash
python3 scripts/resumeGithub.py octocat --repos 6
python3 scripts/resumeLinkedin.py ~/Downloads/Basic_LinkedInDataExport.zip
GOOGLE_MAPS_API_KEY=... python3 scripts/resumeGoogleBusiness.py "Cafe Central, Madrid" --reviews 3
python3 scripts/resumeWebsite.py https://example.com --pages 4
python3 scripts/resumeFile.py menu.pdf faq.md --title "Menu and FAQ"
```

## Configuration

All settings come from environment variables. `RUN.sh` loads `.env`; see [.env.example](.env.example) for the full list with comments.

| Variable                                                | Default                                  | Description                                                         |
| ------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `LLM_PROVIDER`                                          | `ollama`                                 | `ollama`, `openai` (any compatible API) or `anthropic`.             |
| `LLM_MODEL`                                             | per provider                             | `qwen2.5:3b` / `gpt-4o-mini` / `claude-haiku-5-5`.                  |
| `LLM_BASE_URL`                                          | per provider                             | With Ollama, setting this skips the Ollama inside the container.    |
| `LLM_API_KEY`                                           |                                          | Key for external providers.                                         |
| `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` / `LLM_TIMEOUT_MS` | `0.4` / `512` / `120000`                 |                                                                     |
| `CORS_ORIGINS`                                          | empty (block all)                        | Allowed browser origins, comma-separated.                           |
| `TRUST_PROXY`                                           | `false`                                  | Read the client IP from `X-Forwarded-For`.                          |
| `API_KEY`                                               |                                          | Shared key on every route except `/health` (server-to-server only). |
| `ADMIN_API_KEY`                                         |                                          | Enables the admin routes.                                           |
| `SESSION_SECRET`                                        | auto-generated                           | HMAC key for session tokens (stored in `DATA_DIR` if not set).      |
| `TURNSTILE_SECRET`                                      |                                          | Require a Cloudflare Turnstile token to create sessions.            |
| `SESSION_TTL_HOURS`                                     | `24`                                     | Session lifetime after the last message.                            |
| `MAX_HISTORY`                                           | `20`                                     | Messages kept and sent to the model.                                |
| `MAX_MESSAGES_PER_SESSION`                              | `200`                                    | Messages a session may send in total.                               |
| `MAX_SESSIONS`                                          | `10000`                                  | When full, the least recently used session is removed.              |
| `RATE_LIMIT_MESSAGES_PER_MIN`                           | `12`                                     | Per IP and per session.                                             |
| `RATE_LIMIT_REQUESTS_PER_MIN`                           | `60`                                     | All HTTP requests per IP.                                           |
| `RATE_LIMIT_SESSIONS_PER_HOUR`                          | `20`                                     | New sessions per IP.                                                |
| `MAX_MESSAGE_CHARS` / `MAX_BODY_BYTES`                  | `2000` / `16384`                         |                                                                     |
| `LLM_CONCURRENCY` / `LLM_QUEUE`                         | `2` / `20`                               | Parallel LLM calls and waiting requests.                            |
| `WS_MAX_CONNECTIONS_PER_IP` / `WS_IDLE_TIMEOUT_SEC`     | `5` / `300`                              |                                                                     |
| `CONTEXT_FILE` / `DATA_DIR`                             | `/app/context/context.txt` / `/app/data` |                                                                     |

## Scripts

| Script                                  | Description                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `./BUILD.sh`                            | Full image (Node + Ollama). `--preload` bakes the model in (offline), `--slim` builds Node only, `-t tag`. |
| `./RUN.sh`                              | Starts the hardened container. `-f` foreground, `--gpu` NVIDIA GPU, `--stop` stop.                         |
| `./RUN.local.sh`                        | Runs everything locally without Docker (native Ollama + Node). See [above](#run-locally-without-docker).   |
| `./CLIENT.sh`                           | Interactive terminal chat client. Saves its signed session token under `$XDG_STATE_HOME` (or `~/.local/state`). |
| `./EXPORT.sh hub user/repository[:tag]` | Pushes the image to Docker Hub (run `docker login` first).                                                 |
| `./EXPORT.sh tar [file]`                | Saves the image to `dist/*.tar.gz`. Load it elsewhere with `gunzip -c file.tar.gz \| docker load`.         |
| `./scripts/clientTester.sh`             | Tests the REST API and its security checks (`API_URL`, `API_KEY`, `ADMIN_API_KEY`).                        |
| `node scripts/wsTester.mjs [token]`     | Tests the WebSocket API (`WS_URL`, `MESSAGE`).                                                             |

The terminal client reads `.env` when present and connects to `API_URL` (or
`http://localhost:$PORT`). Use `./CLIENT.sh --new` to start without the saved conversation,
`./CLIENT.sh --url https://api.example.com` for another server, and `./CLIENT.sh --help` for
all options and interactive commands. If `API_KEY` is configured, it is sent as a bearer token.

## Development

```bash
npm install
npm run build && npm start
```

With a local Ollama and hot reload:

```bash
./RUN.local.sh --dev
```

## Deployment

The repository includes [`deploy/docker-compose.yml`](deploy/docker-compose.yml), which builds and runs
the **full image** (Node.js + Ollama). It persists the Ollama models and application data in
Docker volumes and mounts `context/context.txt` as read-only.

### Production requirements

- A Linux server with Docker Engine and the Docker Compose plugin.
- Enough memory for the selected LLM. The default `qwen2.5:3b` may require several GB.
- A reverse proxy with HTTPS (Caddy, nginx, Traefik or Cloudflare). Do not expose port 3000
  directly to the public internet.
- A strong `SESSION_SECRET` and an `ADMIN_API_KEY`.
- An exact `CORS_ORIGINS` value for each browser frontend; do not use `*` in production.

### Deploy from source

On the server:

```bash
git clone https://github.com/ZhengLinLei/itsme.git
cd itsme
cp .env.example .env
```

Edit `.env` before starting. At minimum, configure the public frontend origin and secrets:

```dotenv
CORS_ORIGINS=https://app.example.com
SESSION_SECRET=<output-of-openssl-rand-base64-32>
ADMIN_API_KEY=<long-random-admin-key>
```

Build and start the service:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

The API is available on `HOST_PORT` (3000 by default). The first startup downloads the model
into the `itsme-models` volume and may take several minutes.

The Compose file uses the latest Ollama image by default so newer Ollama model manifests
remain compatible. Pin `OLLAMA_VERSION` in `.env` only after verifying that the selected
version supports your model.

### Check and operate the deployment

```bash
# Check the public health endpoint
curl http://localhost:${HOST_PORT:-3000}/health

# Follow API and Ollama logs
docker compose --env-file .env -f deploy/docker-compose.yml logs -f itsme-api

# Restart without rebuilding
docker compose --env-file .env -f deploy/docker-compose.yml restart

# Rebuild after updating the source
git pull
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

To stop the service without deleting its data:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml down
```

Do not use `down --volumes` unless you intentionally want to delete the downloaded models
and persisted application data.

If you change `OLLAMA_VERSION` or `LLM_MODEL`, rebuild the image and recreate the container:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml down
docker compose --env-file .env -f deploy/docker-compose.yml build --pull --no-cache
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

### Use an external provider

To avoid running Ollama in the application container, build the slim image and configure
`LLM_PROVIDER`, `LLM_BASE_URL` and `LLM_API_KEY` in `.env`:

```bash
./BUILD.sh --slim
./RUN.sh
```

For a public deployment, place the reverse proxy in front of the API, forward WebSocket
connections to `/ws`, and set `TRUST_PROXY=true` only when that proxy is trusted.
