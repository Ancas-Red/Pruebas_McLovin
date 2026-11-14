# McHanaq — Arquitectura de comunicación frontend ↔ backend

**Versión:** 1.0 (propuesta) — 14 de noviembre de 2026
**Complementa:** Documento técnico y operativo v1.7, secciones 8.4 a 8.6 y 11.
**Destino sugerido en el repositorio:** `docs/frontend-backend-architecture.md`

---

## 1. Idea central

Mientras el backend lo vean Tom y Angelo, la regla es **minimizar superficie de conflicto**:

1. **Un backend mínimo, de solo lectura.** No calcula nada: lee los JSON que Tom ya generó en `data/processed/` y los sirve filtrados.
2. **El contrato `/api/v1` no cambia.** Es el mismo que ya está en el documento técnico (sección 8.5). Cuando se incorpore la persona que asumirá el backend, reemplaza o amplía la implementación y el frontend ni se entera.
3. **Un solo escritor por archivo.** Nadie edita un archivo que otro genera.
4. **El frontend nunca tiene modo "mock" propio.** Para desarrollar con fixtures se arranca el mismo backend apuntando a `data/fixtures/`. Así hay una sola forma de hablar con los datos.

---

## 2. Vista general

```text
 Angelo (GEE)                 Tom (Python)                         Sebastian (React)
 ────────────                 ────────────                         ─────────────────
 data/intermediate/           analytics/  ──genera──►  data/processed/*.json
   daily_activity.csv   ───►                                  │
   environmental_context.csv                                  │ lee al arrancar
   gee_manifest.json                                          ▼
 data/processed/                                     backend/app/main.py  (Tom)
   territories.geojson  ──────────────────────────►   FastAPI, solo lectura
                                                             │
                                                  HTTP JSON  │  /api/v1/...
                                                             ▼
                                              frontend/src/api/client.ts
                                              (único módulo que hace fetch)
                                                             │
                                                             ▼
                                         componentes: mapa · calendario · fichas
```

En desarrollo local:

- Backend en `http://localhost:8000`.
- Frontend en `http://localhost:5173`, con Vite reenviando `/api` al backend (sin CORS que configurar).

---

## 3. Reparto temporal del backend (Fase A) y relevo (Fase B)

### Fase A — ahora (Tom y Angelo)

El código de `backend/` tiene **un solo dueño: Tom**. Angelo participa en el backend **solo a través de archivos de datos**, nunca editando código del backend. Esto evita que el trabajo de GEE choque con el de la API.

| Archivo | Único escritor | Lo lee |
|---|---|---|
| `data/intermediate/daily_activity.csv` | Angelo | Tom |
| `data/intermediate/environmental_context.csv` | Angelo | Tom |
| `data/intermediate/gee_manifest.json` (colecciones, fechas disponibles, resoluciones, versiones) | Angelo | Tom |
| `data/processed/territories.geojson` | Angelo (validado con las capas de Jean) | Backend |
| `data/processed/activity_daily.json`, `activity_summary.json`, `sensor_comparison.json`, `conditions_assessment.json` | Tom | Backend |
| `data/processed/metadata.json` | **Tom** (a partir de `gee_manifest.json` y de sus propios parámetros) | Backend y frontend |
| `backend/**` | Tom | — |
| `frontend/**` | Sebastian | — |
| `contracts/**`, `data/fixtures/**` | Jean | Todos |

**Cambio respecto al documento v1.7:** allí `metadata.json` lo escriben Angelo y Tom. Para evitar conflictos de fusión, aquí lo escribe solo Tom, y Angelo le entrega su parte en `gee_manifest.json`.

Lo que sí hace Angelo "en el back" (todo es de datos, no de código):

1. Entrega `territories.geojson` con IDs estables y `territory_type`.
2. Entrega `gee_manifest.json` con los meses completos disponibles por sensor y por fuente ambiental.
3. Revisa, sin editar, que lo que devuelve `/territories` y `/metadata` coincide con lo que él exportó.

### Fase B — cuando llegue quien asume el backend

El documento técnico asigna el backend a Jhan; este documento supone que él es quien llegará más tarde. Su relevo:

1. Recibe `backend/` con el código de Tom y las pruebas de humo de la sección 9.
2. Añade modelos Pydantic, documentación OpenAPI completa y validaciones más finas.
3. Mantiene rutas, parámetros, nombres de campos y códigos de error. Si necesita cambiar algo del contrato, sigue la regla de la sección 10.

---

## 4. Contrato de comunicación

### 4.1. Reglas generales

| Tema | Regla |
|---|---|
| Prefijo y versión | `/api/v1`; `schema_version: "1.0"` en cada respuesta de datos. |
| Método | Solo `GET`. No hay escritura. |
| Formato | JSON y GeoJSON, UTF-8. Campos en `snake_case`. |
| Fechas y períodos | `YYYY-MM-DD` para días y `YYYY-MM` para meses. |
| Sensores | `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP`. Una consulta, un sensor. |
| Territorios | Siempre `type` (`province` o `hydro_unit`) junto con `id`. |
| Valores desconocidos | `null`, nunca `0`. El frontend muestra «Sin datos», «No estimable» o «No evaluable». |
| Caché | `Cache-Control: public, max-age=300`. Los datos son precomputados y no cambian durante la sesión. |

### 4.2. Endpoints (los mismos del documento técnico)

| Ruta | Prioridad de implementación |
|---|---|
| `GET /health` | 1 |
| `GET /metadata` | 1 |
| `GET /territories?type=` | 1 |
| `GET /territory-metrics?type=&period=&metric=&sensor=` | 1 |
| `GET /territories/{type}/{id}/summary?period=&sensor=` | 1 |
| `GET /territories/{type}/{id}/activity?period=&sensor=` | 2 |
| `GET /territories/{type}/{id}/sensor-comparison?period=` | 2 |
| `GET /territories/{type}/{id}/hotspots?period=&sensor=` | 3 (solo si existe `hotspots.geojson`) |

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

### 4.4. Validación de períodos

El backend consulta `metadata.json`, no calcula nada:

- Ficha completa: el mes debe estar en `available_periods_by_sensor[sensor]` **y** en `common_environmental_periods`.
- Solo actividad: basta `available_periods_by_sensor[sensor]`.
- Comparación multisensor: el mes debe estar en `common_analysis_periods`.
- Si un mes no está disponible, se responde 422. Nunca se rellena con ceros.

---

## 5. Flujo de llamadas del frontend

**Al abrir la aplicación** (en paralelo):

```text
GET /metadata                      → sensores, meses disponibles, unidades, fuentes
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
2. Cada cambio de mes, sensor o territorio cancela las peticiones en curso (`AbortController`) para no pintar respuestas viejas.
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

app = FastAPI(title="McHanaq API", version="1.0")

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

def check_period(period, sensor=None, full=False, comparison=False):
    ok = True
    if sensor: ok &= period in META.get("available_periods_by_sensor", {}).get(sensor, [])
    if full: ok &= period in META.get("common_environmental_periods", [])
    if comparison: ok &= period in META.get("common_analysis_periods", [])
    if not ok: raise ApiError(422, "PERIOD_NOT_AVAILABLE", f"El período {period} no está publicado para esta consulta")

def pick(items, **keys):
    return next((i for i in items if all(i.get(k) == v for k, v in keys.items())), None)

@app.get("/api/v1/health")
def health(): return {"status": "ok"}

@app.get("/api/v1/metadata")
def metadata(): return META

@app.get("/api/v1/territories")
def territories(type: str):
    check_type(type)
    feats = [f for f in TERR["features"] if f["properties"].get("territory_type") == type]
    return {"type": "FeatureCollection", "features": feats}

# Pendientes para Tom, con el mismo patrón (validar → filtrar → devolver):
#   GET /api/v1/territory-metrics
#   GET /api/v1/territories/{type}/{id}/summary
#   GET /api/v1/territories/{type}/{id}/activity
#   GET /api/v1/territories/{type}/{id}/sensor-comparison
#   GET /api/v1/territories/{type}/{id}/hotspots   (solo si existe hotspots.geojson)
```

Puntos que cuidar:

- **Solo lectura y sin cálculo.** Si falta un dato, se devuelve `null` o 422, nunca un valor inventado.
- **Dos modos con el mismo código:**
  - Datos reales: `uvicorn backend.app.main:app --port 8000`
  - Fixtures: `MCHANAQ_DATA_DIR=data/fixtures uvicorn backend.app.main:app --port 8000`
- Los fixtures de Jean deben llamarse igual que los archivos de `data/processed/` para que ambos modos funcionen.
- La ficha (`summary`) combina `activity_summary.json` con `conditions_assessment.json` y arma la forma de respuesta de la sección 8.5 del documento técnico.

---

## 8. Metas de tiempo sugeridas

Contando desde el inicio del hackathon (09:00 del 14/11):

| Cuándo | Qué | Quién |
|---|---|---|
| T+1 h | Contrato v1 congelado en `main` y fixtures con los nombres finales de archivo | Jean (revisan Angelo, Tom, Sebastian) |
| T+1,5 h | Backend con `health`, `metadata`, `territories`, `territory-metrics` y `summary` sirviendo fixtures | Tom |
| T+2 h | Frontend consumiendo la API real con fixtures: mapa y coropleta | Sebastian |
| T+4 h | `activity` y `sensor-comparison` disponibles | Tom |
| T+8 h | Primeros datos reales de GEE en `data/intermediate/` | Angelo |
| T+10 h | Primeros `data/processed/` reales y cambio de fixtures a datos reales (solo cambia la variable de entorno) | Tom |

---

## 9. Comprobaciones de integración

Pruebas de humo (cada una debe devolver el estado indicado):

```bash
curl -s localhost:8000/api/v1/health                                   # 200
curl -s "localhost:8000/api/v1/territories?type=province"              # 200, FeatureCollection
curl -s "localhost:8000/api/v1/territories?type=otro"                  # 400 INVALID_PARAMETER
curl -s "localhost:8000/api/v1/territory-metrics?type=province&period=1999-01&sensor=MODIS_TERRA&metric=activity_rate"   # 422
curl -s "localhost:8000/api/v1/territories/province/NO_EXISTE/summary?period=2026-09&sensor=MODIS_TERRA"                 # 404
```

Criterio de listo para esta capa:

- [ ] Los cinco endpoints de prioridad 1 responden con la forma del contrato, con fixtures.
- [ ] El frontend recorre mapa → territorio → ficha sin leer ningún archivo directamente.
- [ ] Los errores 400, 404 y 422 llegan al frontend con `code` y `detail` y se muestran en pantalla.
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
