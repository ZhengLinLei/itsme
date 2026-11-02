# itsme

Node API that answers messages with an LLM. Business information, tone, and policies are read from `context/context.txt`, which reloads automatically. Everything runs in Docker.

- **Default:** local LLM with [Ollama](https://ollama.com), using `qwen2.5:3b`.
- **Configurable:** Ollama, any OpenAI-compatible API, or Anthropic.
- **Language:** TypeScript, compiled to `dist/`.
- No runtime npm dependencies.

## Quick start

```bash
cp .env.example .env
./BUILD.sh
./RUN.sh
```

The first run downloads the model into the `itsme-api-models` volume.

```bash
curl -X POST localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"How much does the Pro plan cost?"}'
```

## Scripts

| Script                                  | Description                                                    |
| --------------------------------------- | -------------------------------------------------------------- |
| `./BUILD.sh`                            | Builds the full image. Use `--preload`, `--slim`, or `-t tag`. |
| `./RUN.sh`                              | Starts the container. Use `-f`, `--gpu`, or `--stop`.          |
| `./scripts/clientTester.sh`             | Tests the main API endpoints against a running server.         |
| `./EXPORT.sh hub user/repository[:tag]` | Pushes the image to Docker Hub.                                |
| `./EXPORT.sh tar [file]`                | Saves the image to `dist/*.tar.gz`.                            |

## Endpoints

| Method   | Path                        | Description                                      |
| -------- | --------------------------- | ------------------------------------------------ |
| `GET`    | `/health`                   | Health and active model, without authentication. |
| `POST`   | `/api/chat`                 | Answers a message.                               |
| `GET`    | `/api/context`              | Returns the currently loaded context.            |
| `DELETE` | `/api/conversations?id=...` | Deletes an in-memory conversation.               |

### `POST /api/chat`

```json
{ "message": "Hello", "conversationId": "optional", "stream": false }
```

With `stream: true`, the response is Server-Sent Events. Set `API_KEY` to require authorization for all routes except `/health`.

## Configuration

See [.env.example](.env.example) for all settings. Set `LLM_BASE_URL` to connect to a remote Ollama instance without starting Ollama in the container.

## Development

```bash
npm install
npm run build
npm start
```

For local Ollama development:

```bash
CONTEXT_FILE=./context/context.txt npm run dev
```

## Tools