# Backend — McHanaq

API en **FastAPI** (`src/backend/app/main.py`) — solo lectura en Fase 1 y módulo opcional Fase 2 — mantenida por **Angelo** (backend, ingesta ambiental Open-Meteo/NASA FIRMS y `src/analytics/spread_model.py`), con co-revisión de arquitectura e integración de **Tom** y configuración de hosting/despliegue en la nube por **Sebastian**.

El contrato completo está en [contracts/api-contract.md](../../contracts/api-contract.md) y [docs/harness/README.md](../../docs/harness/README.md).
Cuando `/api/v1` responde con datos completos, la interfaz muestra la serie real; mientras falten datos o no responda, usa las muestras locales etiquetadas en UI.

## Endpoints implementados

### Fase 1 (solo lectura sobre `data/processed/` o `data/fixtures/`)

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

### Fase 2 opcional y tiempo real global (desacoplada de Fase 1)

```text
GET      /api/v1/territories/{type}/{id}/spread-forecast -> pronóstico precalculado o simulación puntual (?date=&horizon_h=)
GET|POST /api/v1/spread-simulate                         -> simulación condicional hasta 48 h (lat, lon, date, horizon_h, use_open_meteo)
GET|POST /api/v1/spread-export                           -> genera GIF, MP4, ZIP QGIS e infografías PNG bajo demanda
GET      /api/v1/spread-outputs/{filename}               -> sirve simulacion_48h.gif, pronostico_48h.mp4, ZIP QGIS y PNGs
GET      /api/v1/reverse-geocode                         -> país, región, provincia, ciudad/distrito vía OSM Nominatim (?lat=&lon=)
GET      /api/v1/realtime/area                           -> clima Open-Meteo, location y focos NRT NASA FIRMS (?south=&west=&north=&east=&days=)
```

## Variables de entorno

| Variable | Uso | Valor por defecto |
|---|---|---|
| `MCHANAQ_DATA_DIR` | Directorio de lectura para JSON/GeoJSON y `spread_outputs/` | `data/processed` |
| `MCHANAQ_NO_CACHE` | Si es `"1"`, responde con `Cache-Control: no-store` (útil con fixtures) | `"0"` |
| `MCHANAQ_CORS_ORIGINS` | Lista separada por comas de orígenes CORS permitidos | `"http://localhost:5173"` |
| `MCHANAQ_CORS_ORIGIN_REGEX` | Expresión regular opcional de orígenes CORS (ej. vistas previas `*.pages.dev`) | vacío (`None`) |
| `FIRMS_MAP_KEY` | Clave opcional para consultar focos NRT (`MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`) en `/api/v1/realtime/area`; si falta, devuelve `hotspots_status: "firms_map_key_required"` sin error | vacío |

## Reglas y runtime liviano (Azure App Service Free F1)

- **Fase 1 es estrictamente de solo lectura:** lee los JSON/GeoJSON ya generados en `data/processed/` (o `data/fixtures/`) usando `ROOT = Path(__file__).resolve().parents[3]`, sin recalcular tasas ni consultar GEE por petición HTTP.
- **`null` nunca es `0`:** `null` significa dato no disponible; `0` significa indicador calculado igual a cero.
- **Errores uniformes:** `{"code": "...", "detail": "..."}` con `400`, `404`, `422`, `500` o `503`.
- **Runtime liviano en Azure F1:** el `requirements.txt` raíz instala únicamente `fastapi`, `uvicorn[standard]` y `httpx` para mantenerse ligero en Azure App Service (Plan Free F1, Linux Python 3.11 con `infra/azure/startup.sh`).
- **Fallback sin librerías GIS pesadas:** si no están instalados `geopandas`/`numpy`/`matplotlib`/`rasterio`, `/api/v1/spread-simulate` activa automáticamente `_run_lightweight_global_spread` en Python puro + `httpx` (pendiente real vía Open-Meteo Elevation `COPERNICUS_DEM_GLO90_OPEN_METEO` y viento actual Open-Meteo), `/api/v1/spread-outputs/{filename}` sigue sirviendo los artefactos precalculados, y `/api/v1/spread-export` responde `503 EXPORT_LIBS_UNAVAILABLE`.

## Arranque desde la raíz del repositorio

```bash
pip install -r requirements.txt
uvicorn src.backend.app.main:app --reload --port 8000

# Con fixtures en vez de datos reales:
MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn src.backend.app.main:app --port 8000
```
