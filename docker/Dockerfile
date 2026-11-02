# Two variants:
#   full (default): Node + Ollama in the same container (local LLM)
#   slim:           Node only, for an external provider (OpenAI / Anthropic / remote Ollama)
ARG NODE_VERSION=22
ARG OLLAMA_VERSION=0.6.8

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
    CONTEXT_FILE=/app/context/context.txt
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/context ./context
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]

# ---------- full ----------
FROM ollama/ollama:${OLLAMA_VERSION} AS full
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production \
    CONTEXT_FILE=/app/context/context.txt \
    LLM_PROVIDER=ollama \
    LLM_MODEL=qwen2.5:3b \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_KEEP_ALIVE=-1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_CONTEXT_LENGTH=4096

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/context ./context

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
