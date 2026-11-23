#!/bin/bash
# Start ComfyUI + Ollama for RPG Story Generator
# Usage: ./scripts/start-services.sh

set -e

echo "=== Starting RPG Story Generator services ==="

# Start containers
docker compose up -d

echo "Waiting for Ollama to be ready..."
until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 2
done
echo "Ollama is ready."

# Decide how to invoke ollama: prefer the docker container, fall back to a
# native ollama CLI on the host (Ollama is often run natively rather than via
# the docker 'ollama' compose profile).
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^rpg-ollama$'; then
  OLLAMA="docker exec rpg-ollama ollama"
elif command -v ollama > /dev/null 2>&1; then
  OLLAMA="ollama"
else
  OLLAMA=""
  echo "WARNING: no 'rpg-ollama' container and no native 'ollama' CLI found."
  echo "         Skipping model pulls - pull them manually once Ollama is reachable."
fi

pull_model() {
  local model="$1"
  [ -z "$OLLAMA" ] && return 0
  if $OLLAMA list 2>/dev/null | grep -qF "$model"; then
    echo "  - $model already present."
  else
    echo "  - Pulling $model (this may take a while)..."
    $OLLAMA pull "$model"
  fi
}

# Narrator model (~8GB VRAM at Q4). You can switch to any other
# installed Ollama model in-app under Settings -> Model.
DEFAULT_MODEL="gemma3:12b"

echo "Ensuring narrator model is installed..."
pull_model "$DEFAULT_MODEL"

echo "Waiting for ComfyUI to be ready..."
until curl -s http://localhost:8188/system_stats > /dev/null 2>&1; do
  sleep 3
done
echo "ComfyUI is ready."

echo ""
echo "=== All services running ==="
echo "  ComfyUI:        http://localhost:8188"
echo "  Ollama:         http://localhost:11434"
echo "  Default model:  $DEFAULT_MODEL"
echo ""
echo "Switch models anytime in the app: Settings -> Model (click refresh)."
echo "Start the app with: npm run dev"
