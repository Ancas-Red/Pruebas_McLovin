#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$REPO_ROOT/.venv/bin/python"
else
  PYTHON_BIN="python3"
fi

if [[ "${1:-}" == "--fixtures" ]] || [[ ! -f "$REPO_ROOT/data/processed/territories.geojson" ]]; then
  export MCHANAQ_DATA_DIR="data/fixtures"
  export MCHANAQ_NO_CACHE="1"
  echo "[McHanaq] Backend usando data/fixtures (MCHANAQ_NO_CACHE=1)"
else
  unset MCHANAQ_DATA_DIR MCHANAQ_NO_CACHE 2>/dev/null || true
  echo "[McHanaq] Backend usando data/processed (Ucayali + Fase 2)"
fi

cleanup() {
  echo ""
  echo "[McHanaq] Deteniendo servicios..."
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$REPO_ROOT"
echo "[McHanaq] Iniciando Backend en http://localhost:${BACKEND_PORT} ..."
"$PYTHON_BIN" -m uvicorn src.backend.app.main:app --reload --port "$BACKEND_PORT" &
BACKEND_PID=$!

cd "$REPO_ROOT/src/frontend"
echo "[McHanaq] Iniciando Frontend en http://localhost:${FRONTEND_PORT} ..."
npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

wait
