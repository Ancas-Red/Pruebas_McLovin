#!/usr/bin/env bash
set -euo pipefail

# McHanaq — Startup script para Azure App Service (Linux Python 3.11)
# Lee artefactos estáticos en modo solo lectura desde MCHANAQ_DATA_DIR (por defecto data/processed).
# Nunca invoca Google Earth Engine ni descarga archivos por petición HTTP.

export MCHANAQ_DATA_DIR="${MCHANAQ_DATA_DIR:-data/processed}"
export PORT="${PORT:-8000}"
export PYTHONPATH="${PYTHONPATH:-}:."

# Sincronización opcional única al arranque si se configuró Cloudflare R2 y faltan archivos locales.
# (Storage: Cloudflare R2. Cómputo/hosting del backend: Azure App Service. Ver
# src/analytics/r2_sync.py — solo hace un GET plano por stdlib, sin dependencias nuevas aquí.)
if [[ -n "${R2_PUBLIC_BASE_URL:-}" ]]; then
  if [[ ! -s "${MCHANAQ_DATA_DIR}/metadata.json" || ! -s "${MCHANAQ_DATA_DIR}/activity_daily.json" ]]; then
    echo "[mchanaq-startup] Sincronizando snapshot inicial desde Cloudflare R2 hacia ${MCHANAQ_DATA_DIR}..."
    python -m src.analytics.r2_sync download --target "${MCHANAQ_DATA_DIR}" --if-missing
  fi
fi

exec uvicorn src.backend.app.main:app --host 0.0.0.0 --port "${PORT}"
