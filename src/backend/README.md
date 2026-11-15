# Backend — McHanaq

API de solo lectura en **FastAPI** (`src/backend/app/main.py`) mantenida en Fase A por Tom (relevo planificado con Jhan en Fase B).

El contrato completo está en [contracts/api-contract.md](../../contracts/api-contract.md) y [docs/harness/README.md](../../docs/harness/README.md).
Cuando `/api/v1` responde con datos completos, la interfaz muestra la serie real; mientras falten datos o no responda, usa las muestras locales etiquetadas en UI.

## Endpoints implementados

```text
GET /                                           -> sonda liviana de warm-up (Azure App Service)
GET /api/v1/health                              -> {"status":"ok","data_loaded":bool,"data_dir":...}
GET /api/v1/metadata                            -> sensores, fechas/períodos útiles, unidades, parámetros
GET /api/v1/territories?type=                   -> GeoJSON FeatureCollection (province | hydro_unit)
GET /api/v1/territory-metrics                   -> ?type=&metric=&date=|period=&sensor=
GET /api/v1/territories/{type}/{id}/summary     -> ficha diaria + resumen mensual + susceptibilidad
GET /api/v1/territories/{type}/{id}/activity    -> serie diaria + variables ambientales (?from=&to=&sensor=)
GET /api/v1/territories/{type}/{id}/calendar    -> serie mensual longitudinal (?sensor=&from_period=&to_period=)
GET /api/v1/territories/{type}/{id}/sensor-comparison -> contraste por sensor (?date=|period=)
GET /api/v1/territories/{type}/{id}/export.csv  -> descarga CSV de 20 columnas (?from=&to=&sensor=)
GET /api/v1/territories/{type}/{id}/hotspots    -> FeatureCollection puntual (si existe hotspots.geojson)
```

## Reglas

- Solo lectura. Lee los JSON/GeoJSON ya generados en `data/processed/` (o `data/fixtures/`) y usa `ROOT = Path(__file__).resolve().parents[3]`.
- No recalcula tasas, anomalías ni reglas: eso lo produce `src/analytics/`.
- `null` significa dato no disponible. `0` significa que el indicador se calculó y vale cero.
- Errores uniformes: `{"code": "...", "detail": "..."}` con `400`, `404`, `422` o `500`.
- CORS configurable con `MCHANAQ_CORS_ORIGINS` y `MCHANAQ_CORS_ORIGIN_REGEX` (ej. vistas previas `*.pages.dev`).

## Arranque desde la raíz del repositorio

```bash
pip install -r requirements.txt
uvicorn src.backend.app.main:app --reload --port 8000

# Con fixtures en vez de datos reales:
MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn src.backend.app.main:app --port 8000
```
