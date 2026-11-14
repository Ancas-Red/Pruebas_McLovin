# McHanaq — Arquitectura de comunicación frontend ↔ backend y procesamiento longitudinal

**Versión:** 1.2 (alineada con `McHanaq_documento_tecnico_operativo_v1.7.md` y `reto.txt`) — 14 de noviembre de 2026
**Complementa:** [McHanaq_documento_tecnico_operativo_v1.7.md](McHanaq_documento_tecnico_operativo_v1.7.md) (secciones 5, 7, 8.4–8.6 y 11) y [reto.txt](reto.txt).
**Destino sugerido en el repositorio:** `docs/frontend-backend-architecture.md`

---

## 1. Idea central

Mientras el backend lo vean Tom y Angelo, la regla es **minimizar superficie de conflicto** y respetar las decisiones metodológicas del documento técnico v1.7:

1. **Un backend mínimo, de solo lectura.** No calcula nada en tiempo de petición: lee los JSON preprocesados que Tom generó en `data/processed/` y los sirve filtrados.
2. **Armonización sin sumar sensores.** Según la sección 7 (Etapa 3) de v1.7, `MODIS_TERRA`, `MODIS_AQUA` y `VIIRS_SNPP` (todos a 1 km en `MOD14A1`, `MYD14A1` y `VNP14A1`) **nunca se suman ni se mezclan como conteos equivalentes**. La armonización longitudinal (2000–presente) es semántica, temporal y estadística: cada sensor mantiene su propio denominador (`valid_land_pixel_days`) y se comparan en `sensor_comparison.json`.
3. **Procesamiento longitudinal diario → mensual.** Las variables extras solicitadas (`T_amb`, `T_suelo`, `dirección del viento` diaria y `altura` DEM por época) se procesan a resolución **diaria** en `data/intermediate/` y luego Tom las agrega al calendario mensual y a las series diarias (`activity_daily.json`) y fichas (`conditions_assessment.json`).
4. **El contrato `/api/v1` de v1.7 (sección 8.5) se mantiene.** Cuando se incorpore Jhan (Fase B), reemplaza o amplía la implementación y el frontend ni se entera.
5. **Un solo escritor por archivo.** Nadie edita un archivo que otro genera.
6. **El frontend nunca tiene modo "mock" propio.** Para desarrollar con fixtures se arranca el mismo backend apuntando a `data/fixtures/`.

---

## 2. Vista general y proyecto longitudinal

```text
 Angelo (GEE — Serie diaria 2000→presente)         Tom (Python — analytics/)            Sebastian (React)
 ─────────────────────────────────────────         ─────────────────────────            ─────────────────
 data/intermediate/                                analytics/ ──genera──► data/processed/*.json
   daily_activity.csv          (MOD14/MYD14/VNP14)   • tasas y anomalías (MAD)    │
   environmental_daily.csv     (T_amb, T_suelo,      • resumen mensual            │ lee al arrancar
                                viento diario, DEM)  • árbol de susceptibilidad   ▼
   environmental_context.csv   (mensual + MapBiomas) • comparación multisensor   backend/app/main.py (Tom)
   gee_manifest.json           (fuentes, DEM/época)                              FastAPI, solo lectura
 data/processed/                                                                         │
   territories.geojson         ────────────────────────────────────────────────►  HTTP   │ /api/v1/...
                                                                                  JSON/CSV▼
                                                                           frontend/src/api/client.ts
                                                                           (único módulo que hace fetch)
                                                                                         │
                                                                                         ▼
                                                                      mapa · calendario · fichas · CSV
```

### 2.1. Proyecto longitudinal de procesamiento (2000–presente)

1. **Capa diaria en GEE (Angelo → `data/intermediate/`):**
   * **`daily_activity.csv`:** conteos diarios por territorio y sensor (`MODIS_TERRA` desde feb-2000, `MODIS_AQUA` desde jul-2002, `VIIRS_SNPP` desde ene-2012) con clases `FireMask` 7 y 8–9, `valid_land_pixels`, `expected_land_pixels_per_day` y `observation_coverage` (sección 8.4 de v1.7).
   * **`environmental_daily.csv`:** serie longitudinal **diaria** por `(date, territory_type, territory_id)` con las 4 variables extras (sección 2.2).
   * **`environmental_context.csv`:** tabla mensual por `(period_id, territory_type, territory_id)` alineada con v1.7 (MapBiomas anual, NDVI `MOD13A3`, `precip_30d_mm`, `soil_moisture_surface`, pendiente SRTM, más los agregados mensuales de las variables diarias).
   * **`gee_manifest.json`:** registra colecciones exactas, fechas reales disponibles en GEE, modelo DEM aplicado por época y fuente de `t_amb_c`.
   * **Regla operativa GEE:** exportar `daily_activity.csv` y `environmental_daily.csv` por bloques de 1–2 años sobre el área piloto (`Export.table.toDrive`) para evitar timeouts o límites de cuota EECU en la serie 2000–presente.
2. **Capa analítica longitudinal en Python (Tom → `analytics/` → `data/processed/`):**
   * Calcula `activity_rate`, `observation_coverage`, `active_days`, `max_consecutive_active_days` y la anomalía histórica robusta (`robust_z` con mediana y MAD por mes calendario) en `activity_summary.json`.
   * Conserva el detalle diario (actividad + `t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m`) en `activity_daily.json`.
   * Evalúa el árbol de susceptibilidad contextual (Etapa 7 de v1.7) en `conditions_assessment.json` y la concordancia multisensor (`concordant_elevated`, `concordant_not_elevated`, `discordant`, `single_sensor`, `insufficient`) en `sensor_comparison.json`.

### 2.2. Variables extras ambientales y topográficas (proceso diario)

Se exportan en `data/intermediate/environmental_daily.csv` con clave `(date, territory_type, territory_id)` en formato `YYYY-MM-DD`:

| Variable | Campo en CSV/JSON | Unidad | Fuente GEE y regla de procesamiento diario |
|---|---|---|---|
| **Temperatura ambiente (`T_amb`)** | `t_amb_c` *(equiv. `temperature_2m_c` en v1.7)* | `°C` | Temperatura del aire a 2 m diaria desde `ECMWF/ERA5_LAND/HOURLY` (agregado diario en GEE). Si en algún tramo se extrae perfil atmosférico de MODIS/VIIRS (`MOD07_L2` / `MYD07_L2`), documentarlo en `gee_manifest.json` (MODIS/VIIRS miden LST superficial de forma nativa, no aire a 2 m). |
| **Temperatura del suelo (`T_suelo` / LST)** | `t_suelo_c` *(opcionalmente `t_suelo_day_c`, `t_suelo_night_c`)* | `°C` | Land Surface Temperature diaria extraída directamente de **MODIS** (`MODIS/061/MOD11A1` Terra / `MYD11A1` Aqua, 1 km) y **VIIRS** (`NASA/VIIRS/002/VNP21A1D` / `VNP21A1N`, 1 km), aplicando factor de escala y conversión de Kelvin a `°C` (`K - 273.15`), filtrando por banda `QC`. |
| **Dirección del viento (diaria)** | `wind_dir_deg` + `wind_speed_10m_ms` | `grados` (0–360) y `m/s` | Procesada **por día** desde `u_component_of_wind_10m` y `v_component_of_wind_10m` de `ECMWF/ERA5_LAND/HOURLY`. **Regla vectorial:** nunca promediar ángulos directamente; promediar `u` y `v` en el día/territorio y luego calcular `atan2(-u, -v) * 180 / π mod 360` (convención meteorológica: de dónde viene el viento) y `sqrt(u² + v²)`. |
| **Altura / Elevación (DEM por época)** | `elevation_m` + `dem_source` | `m s.n.m.` | Extraída del modelo DEM correspondiente a la época del sensor/fecha: **SRTM / NASADEM 30 m** (`USGS/SRTMGL1_003` o `NASA/NASADEM_HGT/001`, época 2000) para el tramo histórico **MODIS (2000–2011)**, y **Copernicus DEM GLO-30** (`COPERNICUS/DEM/GLO30`, época 2011–2015) para el tramo **VIIRS (2012–presente)**, registrando la elevación media/mediana del territorio en `environmental_daily.csv` y `gee_manifest.json`. |

En desarrollo local:

- Backend en `http://localhost:8000`.
- Frontend en `http://localhost:5173`, con Vite reenviando `/api` al backend (sin CORS en local; si en la demo se despliegan en orígenes distintos, habilitar `CORSMiddleware` en FastAPI).

---

## 3. Reparto temporal del backend (Fase A) y relevo (Fase B)

### Fase A — ahora (Tom y Angelo)

El código de `backend/` tiene **un solo dueño: Tom**. Angelo participa en el backend **solo a través de archivos de datos**, nunca editando código del backend.

| Archivo | Único escritor | Lo lee |
|---|---|---|
| `data/intermediate/daily_activity.csv` | Angelo | Tom |
| `data/intermediate/environmental_daily.csv` *(diario: `t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m`, `dem_source`)* | Angelo | Tom |
| `data/intermediate/environmental_context.csv` *(mensual: MapBiomas, `MOD13A3`, ERA5-Land, pendiente SRTM)* | Angelo | Tom |
| `data/intermediate/gee_manifest.json` *(colecciones, fechas disponibles, DEM por época, versiones)* | Angelo | Tom |
| `data/processed/territories.geojson` | Angelo (validado con las capas de Jean) | Backend |
| `data/processed/activity_daily.json`, `activity_summary.json`, `sensor_comparison.json`, `conditions_assessment.json` | Tom | Backend |
| `data/processed/metadata.json` | **Tom** (a partir de `gee_manifest.json` y parámetros de `analytics/`) | Backend y frontend |
| `backend/**` | Tom | — |
| `frontend/**` | Sebastian | — |
| `contracts/**`, `data/fixtures/**` | Jean | Todos |

**Cambio respecto al documento v1.7:** allí `metadata.json` lo escriben Angelo y Tom. Para evitar conflictos de fusión, aquí lo escribe solo Tom, y Angelo le entrega su parte en `gee_manifest.json`.

Lo que sí hace Angelo "en el back" (todo es de datos, no de código):

1. Entrega `territories.geojson` con IDs estables y `territory_type`.
2. Entrega `environmental_daily.csv` (con `t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m`) y `environmental_context.csv`.
3. Entrega `gee_manifest.json` con los meses completos disponibles por sensor/fuente y la trazabilidad del DEM por época.
4. Revisa, sin editar, que lo que devuelve `/territories` y `/metadata` coincide con lo que él exportó.

### Fase B — cuando llegue quien asume el backend (Jhan)

1. Recibe `backend/` con el código de Tom y las pruebas de humo de la sección 9.
2. Añade modelos Pydantic, documentación OpenAPI completa y validaciones más finas.
3. Mantiene rutas, parámetros, nombres de campos y códigos de error. Si necesita cambiar algo del contrato, sigue la regla de la sección 10.

---

## 4. Contrato de comunicación

### 4.1. Reglas generales

| Tema | Regla |
|---|---|
| Prefijo y versión | `/api/v1`; `schema_version: "1.0"` en cada respuesta de datos JSON. |
| Método | Solo `GET`. No hay escritura. |
| Formato | JSON, GeoJSON y CSV (`text/csv` en exportación), UTF-8. Campos en `snake_case`. |
| Fechas y períodos | `YYYY-MM-DD` para días y `YYYY-MM` para meses. |
| Sensores | `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP`. Una consulta de actividad, un sensor (no se suman conteos entre sensores). |
| Territorios | Siempre `type` (`province` o `hydro_unit`) junto con `id`. |
| Valores desconocidos | `null`, nunca `0`. El frontend muestra «Sin datos», «No estimable» o «No evaluable». |
| Envoltorio de colecciones | Todos los JSON tabulares en `data/processed/` usan la raíz `{"schema_version": "1.0", "items": [...]}`. |
| Caché | `Cache-Control: public, max-age=300` en respuestas de datos (desactivable en fixtures con `MCHANAQ_NO_CACHE=1`). |

### 4.2. Endpoints (v1.7 sección 8.5 + exportación CSV de `reto.txt`)

| Ruta | Prioridad | Notas |
|---|---|---|
| `GET /health` | 1 | Devuelve `{"status": "ok", "data_loaded": bool}`. |
| `GET /metadata` | 1 | Sensores, períodos, unidades, resoluciones, fuentes ambientales y DEM por época. |
| `GET /territories?type=` | 1 | `FeatureCollection` filtrada por `territory_type`. |
| `GET /territory-metrics?type=&period=&metric=&sensor=` | 1 | `sensor` obligatorio para métricas de actividad; opcional para `conditions_classification` o métricas ambientales (`t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `elevation_m`). |
| `GET /territories/{type}/{id}/summary?period=&sensor=` | 1 | Ficha mensual: actividad del sensor + `environmental_conditions` (con `t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `elevation_m` y `classification`). |
| `GET /territories/{type}/{id}/activity?period=&sensor=` | 2 | Serie **diaria** del mes: focos del sensor + contexto diario (`t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m`). |
| `GET /territories/{type}/{id}/sensor-comparison?period=` | 2 | Comparación multisensor (`concordant_elevated`, `concordant_not_elevated`, `discordant`, `single_sensor`, `insufficient`). |
| `GET /territories/{type}/{id}/export.csv?from=&to=&sensor=` | 2 | Descarga CSV de la serie diaria del territorio en el rango pedido (`reto.txt`). |
| `GET /territories/{type}/{id}/hotspots?period=&sensor=` | 3 | Solo si existe `hotspots.geojson`. |

`classification` en la ficha admite: `high`, `moderate`, `low`, `partial`, `not_evaluable`.

### 4.3. Errores

Un solo formato, sin trazas técnicas:

```json
{ "code": "INVALID_PARAMETER", "detail": "Descripción clara del problema" }
```

| Estado | Cuándo | `code` sugerido |
|---|---|---|
| 400 | Parámetro ausente o con valor no permitido | `INVALID_PARAMETER` |
| 404 | Territorio o recurso inexistente | `NOT_FOUND` |
| 422 | Período válido pero no publicado para ese sensor, o no común | `PERIOD_NOT_AVAILABLE` |
| 500 | Error interno | `INTERNAL_ERROR` |

**Orden de validación en endpoints de territorio:** `400` (`type`/`sensor`/`metric`) → `422` (`period`) → `404` (`id` de territorio inexistente).

### 4.4. Validación de períodos

El backend consulta `metadata.json`, no calcula nada:

- Ficha completa (`/summary`): el mes debe estar en `available_periods_by_sensor[sensor]` **y** en `common_environmental_periods`.
- Solo actividad (`/activity`) o métrica de actividad (`/territory-metrics` con `sensor`): basta `available_periods_by_sensor[sensor]`.
- Métrica ambiental o `conditions_classification` sin `sensor` (`/territory-metrics`): el mes debe estar en `common_environmental_periods`.
- Comparación multisensor (`/sensor-comparison`): el mes debe estar en `common_analysis_periods`.
- Si un mes no está disponible, se responde `422`. Nunca se rellena con ceros.

---

## 5. Flujo de llamadas del frontend

**Al abrir la aplicación** (en paralelo):

```text
GET /metadata                      → sensores, meses disponibles, unidades, fuentes DEM/clima
GET /territories?type=province     → geometrías para el mapa
```

**Al elegir vista, mes y sensor:**

```text
GET /territory-metrics?type=province&period=2026-09&sensor=MODIS_TERRA&metric=activity_rate
```

El frontend une los valores con las geometrías por `territory_id` y pinta la coropleta. No calcula nada.

**Al hacer clic en un territorio** (en paralelo):

```text
GET /territories/province/1501/summary?period=2026-09&sensor=MODIS_TERRA
GET /territories/province/1501/activity?period=2026-09&sensor=MODIS_TERRA
GET /territories/province/1501/sensor-comparison?period=2026-09
```

**Reglas del lado del cliente:**

1. Los meses y sensores que se ofrecen en los selectores salen de `/metadata`.
2. Cada cambio de mes, sensor o territorio cancela las peticiones en curso (`AbortController`). Si `fetch` lanza `AbortError`, **se ignora** y no se muestra estado de error.
3. Las geometrías de `/territories` se piden una vez por tipo y se guardan en memoria.
4. Cada panel tiene sus cuatro estados: cargando, con datos, sin datos (`null`) y error (`ApiError`).
5. El frontend **no deriva** concordancia entre sensores ni categorías de susceptibilidad: muestra lo que devuelve la API.

---

## 6. Frontend: un solo módulo de acceso

Todo `fetch` vive en `frontend/src/api/client.ts`. Los componentes nunca llaman a `fetch` directamente.

```ts
// frontend/src/api/client.ts
const BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, detail: string) {
    super(detail);
  }
}

type Params = Record<string, string | undefined>;

async function get<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
  ).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? "UNKNOWN", body.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  metadata: (s?: AbortSignal) => get<Metadata>("/metadata", {}, s),
  territories: (type: TerritoryType, s?: AbortSignal) => get<GeoJSON.FeatureCollection>("/territories", { type }, s),
  metrics: (p: { type: TerritoryType; period: string; metric: string; sensor?: Sensor }, s?: AbortSignal) =>
    get<TerritoryMetrics>("/territory-metrics", p, s),
  summary: (type: TerritoryType, id: string, period: string, sensor: Sensor, s?: AbortSignal) =>
    get<TerritorySummary>(`/territories/${type}/${id}/summary`, { period, sensor }, s),
  activity: (type: TerritoryType, id: string, period: string, sensor: Sensor, s?: AbortSignal) =>
    get<ActivityDaily>(`/territories/${type}/${id}/activity`, { period, sensor }, s),
  comparison: (type: TerritoryType, id: string, period: string, s?: AbortSignal) =>
    get<SensorComparison>(`/territories/${type}/${id}/sensor-comparison`, { period }, s),
  exportCsvUrl: (type: TerritoryType, id: string, from: string, to: string, sensor: Sensor) =>
    `${BASE}/territories/${type}/${id}/export.csv?${new URLSearchParams({ from, to, sensor })}`,
};
```

- Los tipos (`Metadata`, `TerritorySummary`, etc.) viven en `frontend/src/api/types.ts` y se escriben a partir de los ejemplos de `contracts/` y de `data/fixtures/`.
- Vite reenvía `/api` al backend (`vite.config.ts`):

```ts
server: { proxy: { "/api": "http://localhost:8000" } }
```

---

## 7. Backend mínimo (Fase A)

Un solo archivo, `backend/app/main.py`, que carga los JSON al arrancar y los sirve filtrados. No calcula tasas, anomalías ni reglas. El punto de partida (Tom lo completa y lo prueba contra los fixtures):

```python
# backend/app/main.py
import json, os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.getenv("MCHANAQ_DATA_DIR", ROOT / "data" / "processed"))
NO_CACHE = os.getenv("MCHANAQ_NO_CACHE", "0") == "1"
TYPES = {"province", "hydro_unit"}
SENSORS = {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}

def load(name):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

META = load("metadata.json") or {}
TERR = load("territories.geojson") or {"type": "FeatureCollection", "features": []}
SUMMARY = (load("activity_summary.json") or {}).get("items", [])
DAILY = (load("activity_daily.json") or {}).get("items", [])
COMPARE = (load("sensor_comparison.json") or {}).get("items", [])
ASSESS = (load("conditions_assessment.json") or {}).get("items", [])

class ApiError(Exception):
    def __init__(self, status, code, detail):
        self.status, self.code, self.detail = status, code, detail

app = FastAPI(title="McHanaq API", version="1.2")

@app.middleware("http")
async def add_cache_header(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and not request.url.path.endswith("/health"):
        response.headers["Cache-Control"] = "no-store" if NO_CACHE else "public, max-age=300"
    return response

@app.exception_handler(ApiError)
async def api_error(_: Request, e: ApiError):
    return JSONResponse(status_code=e.status, content={"code": e.code, "detail": e.detail})

@app.exception_handler(RequestValidationError)
async def bad_params(_: Request, e: RequestValidationError):
    return JSONResponse(status_code=400, content={"code": "INVALID_PARAMETER", "detail": "Parámetros inválidos"})

def check_type(t):
    if t not in TYPES: raise ApiError(400, "INVALID_PARAMETER", f"type debe ser uno de {sorted(TYPES)}")

def check_sensor(s):
    if s not in SENSORS: raise ApiError(400, "INVALID_PARAMETER", f"sensor debe ser uno de {sorted(SENSORS)}")

def check_period(period, sensor=None, full=False, comparison=False, env_only=False):
    ok = True
    if sensor: ok &= period in META.get("available_periods_by_sensor", {}).get(sensor, [])
    if full or env_only: ok &= period in META.get("common_environmental_periods", [])
    if comparison: ok &= period in META.get("common_analysis_periods", [])
    if not ok: raise ApiError(422, "PERIOD_NOT_AVAILABLE", f"El período {period} no está publicado para esta consulta")

def pick(items, **keys):
    return next((i for i in items if all(i.get(k) == v for k, v in keys.items())), None)

@app.get("/api/v1/health")
def health():
    return {"status": "ok", "data_loaded": bool(META and TERR.get("features"))}

@app.get("/api/v1/metadata")
def metadata():
    return {"schema_version": "1.0", **META}

@app.get("/api/v1/territories")
def territories(type: str):
    check_type(type)
    feats = [f for f in TERR["features"] if f["properties"].get("territory_type") == type]
    return {"schema_version": "1.0", "type": "FeatureCollection", "features": feats}

# Pendientes para Tom, con el mismo patrón (validar → filtrar → devolver):
#   GET /api/v1/territory-metrics
#   GET /api/v1/territories/{type}/{id}/summary
#   GET /api/v1/territories/{type}/{id}/activity
#   GET /api/v1/territories/{type}/{id}/sensor-comparison
#   GET /api/v1/territories/{type}/{id}/export.csv
#   GET /api/v1/territories/{type}/{id}/hotspots   (solo si existe hotspots.geojson)
```

Puntos que cuidar:

- **Solo lectura y sin cálculo.** Si falta un dato, se devuelve `null` o `422`, nunca un valor inventado.
- **Dos modos con el mismo código:**
  - Datos reales: `uvicorn backend.app.main:app --port 8000`
  - Fixtures: `MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn backend.app.main:app --port 8000`
- Los fixtures de Jean deben llamarse igual que los archivos de `data/processed/` y respetar el envoltorio `{"items": [...]}`.
- La ficha (`summary`) combina `activity_summary.json` con `conditions_assessment.json` (incluyendo `t_amb_c`, `t_suelo_c`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m`) y arma la respuesta de la sección 8.5 de v1.7.

---

## 8. Metas de tiempo sugeridas

Contando desde el inicio del hackathon (09:00 del 14/11):

| Cuándo | Qué | Quién |
|---|---|---|
| T+1 h | Contrato v1.2 congelado en `main` y fixtures con las 4 variables extras | Jean (revisan Angelo, Tom, Sebastian) |
| T+1,5 h | Backend con `health`, `metadata`, `territories`, `territory-metrics` y `summary` sirviendo fixtures | Tom |
| T+2 h | Frontend consumiendo la API real con fixtures: mapa, coropleta y calendario | Sebastian |
| T+4 h | `activity`, `sensor-comparison` y `export.csv` disponibles | Tom |
| T+8 h | Primeros datos reales longitudinales de GEE en `data/intermediate/` (`daily_activity.csv` y `environmental_daily.csv`) | Angelo |
| T+10 h | Primeros `data/processed/` reales y cambio de fixtures a datos reales (solo cambia la variable de entorno) | Tom |

---

## 9. Comprobaciones de integración

Pruebas de humo (cada una debe devolver el estado indicado):

```bash
curl -s localhost:8000/api/v1/health                                   # 200 (data_loaded: true)
curl -s "localhost:8000/api/v1/territories?type=province"              # 200, FeatureCollection
curl -s "localhost:8000/api/v1/territories?type=otro"                  # 400 INVALID_PARAMETER
curl -s "localhost:8000/api/v1/territory-metrics?type=province&period=1999-01&sensor=MODIS_TERRA&metric=activity_rate"   # 422
curl -s "localhost:8000/api/v1/territories/province/NO_EXISTE/summary?period=2026-09&sensor=MODIS_TERRA"                 # 404
```

Criterio de listo para esta capa:

- [ ] Los cinco endpoints de prioridad 1 responden con la forma del contrato, con fixtures.
- [ ] El frontend recorre mapa → calendario longitudinal → territorio → ficha (con `t_amb_c`, `t_suelo_c`, `wind_dir_deg` y `elevation_m`) sin leer ningún archivo directamente.
- [ ] Los errores 400, 404 y 422 llegan al frontend con `code` y `detail` y se muestran en pantalla; los `AbortError` se ignoran.
- [ ] Cambiar `MCHANAQ_DATA_DIR` de fixtures a datos reales no exige tocar el frontend.
- [ ] Ningún `null` se pinta como 0.

---

## 10. Cómo cambiar el contrato sin romper la integración

1. Jean abre un PR que actualiza `contracts/` y `data/fixtures/` en el mismo cambio.
2. Tom confirma que el backend puede servirlo; Sebastian, que el frontend puede consumirlo; Angelo, solo si afecta a lo que él exporta.
3. Se fusiona en `main` y las ramas se actualizan antes de seguir.
4. Nadie renombra campos, tipos ni unidades por su cuenta.

---

## 11. Plan B si falla la API durante la demo

1. Dejar el backend corriendo con `MCHANAQ_DATA_DIR` apuntando a una copia de `data/processed/` ya verificada, sin conexión a nada externo (es solo lectura local).
2. Si el backend no arranca, tener capturas reales de la aplicación y los fixtures etiquetados como datos de muestra (la guía de demo de Jean lo prevé).
3. Los fixtures nunca se presentan como resultados reales.
