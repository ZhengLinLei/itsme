#!/bin/sh
# Start Ollama for the local provider, download the model if needed, and start the API.
set -e

if [ "${LLM_PROVIDER:-ollama}" = "ollama" ] && [ -z "$LLM_BASE_URL" ]; then
  echo "[entrypoint] starting Ollama..."
  ollama serve &
  OLLAMA_PID=$!
  until ollama list >/dev/null 2>&1; do sleep 1; done

  if ! ollama list | awk 'NR>1 {print $1}' | grep -qx "$LLM_MODEL" \
     && ! ollama list | awk 'NR>1 {print $1}' | grep -qx "$LLM_MODEL:latest"; then
    echo "[entrypoint] downloading model $LLM_MODEL (first run only)..."
    ollama pull "$LLM_MODEL"
  fi

  # Preload the model so the first response is fast.
  node -e "fetch('http://127.0.0.1:11434/api/generate',{method:'POST',body:JSON.stringify({model:process.env.LLM_MODEL})}).catch(()=>{})" &

  node dist/server.js &
  NODE_PID=$!
  trap 'kill $NODE_PID $OLLAMA_PID 2>/dev/null' INT TERM
  # Stop the container if either process exits.
  while kill -0 $NODE_PID 2>/dev/null && kill -0 $OLLAMA_PID 2>/dev/null; do sleep 2; done
  kill $NODE_PID $OLLAMA_PID 2>/dev/null || true
  exit 1
fi

exec node dist/server.js
