# Two variants:
#   full (default): Node + Ollama in the same container (local LLM)
#   slim:           Node only, for an external provider (OpenAI / Anthropic / remote Ollama)
ARG NODE_VERSION=22
ARG OLLAMA_VERSION=latest

FROM node:${NODE_VERSION}-bookworm-slim AS node

# ---------- build ----------
FROM node AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
COPY context ./context

# ---------- slim ----------
FROM node AS slim
WORKDIR /app
ENV NODE_ENV=production \
    CONTEXT_FILE=/app/context/context.txt \
    DATA_DIR=/app/data
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/context ./context
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]

# ---------- full ----------
FROM ollama/ollama:${OLLAMA_VERSION} AS full
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production \
    CONTEXT_FILE=/app/context/context.txt \
    DATA_DIR=/app/data \
    LLM_PROVIDER=ollama \
    LLM_MODEL=qwen2.5:3b \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_KEEP_ALIVE=-1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_CONTEXT_LENGTH=4096

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/context ./context
RUN mkdir -p /app/data

# Optional: include the model in the image (larger image, but works offline).
ARG PRELOAD_MODEL=
RUN if [ -n "$PRELOAD_MODEL" ]; then \
      (ollama serve >/dev/null 2>&1 &) && \
      until ollama list >/dev/null 2>&1; do sleep 1; done && \
      ollama pull "$PRELOAD_MODEL"; \
    fi

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
