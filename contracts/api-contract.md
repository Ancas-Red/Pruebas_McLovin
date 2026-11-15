# McHanaq — Contrato de API `/api/v1` (versión legible)

**Versión del contrato:** 1.2 · `schema_version: "1.0"`
**Mantiene:** Jean Pierrer (redacción) · **Valida:** Jhan/Tom (backend), Sebastian (frontend), Tom y Angelo (significado de los datos)
**Basado en:** `docs/McHanaq_documento_tecnico_operativo_v1.7.md` (§8.4–8.6) y `docs/arquitectura_frontend_backend_McHanaq.md` (§4–5)

> Este documento explica el contrato en lenguaje claro. Si hay contradicción con los documentos de `docs/`, se avisa al equipo y se corrige en un PR; nadie cambia nombres, tipos o unidades por su cuenta (ver §8).

---

## 1. Reglas generales

| Tema | Regla |
|---|---|
| Base | `/api/v1` (más sonda `GET /` en raíz). Solo `GET` (la API es de solo lectura). |
| Formato | JSON / GeoJSON en UTF-8; CSV (`text/csv`) solo en la exportación. Campos en `snake_case`. |
| Versión | Toda respuesta JSON de datos incluye `"schema_version": "1.0"`. |
| Fechas | Diario por defecto: `date=YYYY-MM-DD`, rangos `from` / `to` (`YYYY-MM-DD`). `period=YYYY-MM` es opcional (contexto mensual). |
| Territorio | Siempre se envía **tipo + id**: `type` = `province` o `hydro_unit`, junto con `id` (`territory_id`). Provincias y cuencas **no se mezclan** en un mismo ranking. |
| Sensor | `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP`. Una consulta de actividad = un sensor. **Nunca se suman conteos entre sensores.** |
| Valores desconocidos | `null`, **nunca `0`**. El frontend muestra «Sin datos», «No estimable» o «No evaluable». `0` significa «se observó y no hubo detecciones». |
| Colecciones | Los JSON tabulares usan `{"schema_version": "1.0", "items": [...]}`. |
| Caché | `Cache-Control: public, max-age=300` (con fixtures: `MCHANAQ_NO_CACHE=1` → `no-store`; `/health` no cachea). |
| Cálculo | La API **no calcula** tasas, anomalías ni categorías: lee lo que Tom dejó en `data/processed/`. El frontend tampoco calcula nada. |
| Infraestructura | Objetivo oficial en **Microsoft Azure Free Tier + Cloudflare Pages** (`infra/azure/`): backend en **Azure App Service (Plan Free F1, Linux Python 3.11)** con `requirements.txt` raíz, `GET /` para warm-up y `MCHANAQ_CORS_ORIGIN_REGEX`, de solo lectura sobre `data/processed/` local (o `data/fixtures/` en CI/demo), y frontend en **Cloudflare Pages** (`src/frontend/public/_headers`, recomendado) o **Azure Static Web Apps (`infra/azure/staticwebapp.config.json`)** sobre `src/frontend/dist/`. Nunca consulta GEE ni Azure Blob Storage/Drive por petición HTTP. |

## 2. Endpoints

| # | Ruta | Prioridad | Parámetros | Devuelve |
|---|---|---|---|---|
| 0 | `GET /` (fuera de `/api/v1`) | 1 | — | Sonda liviana de warm-up/root (`{"service": "McHanaq API", "status": "ok", "health": "/api/v1/health"}`). |
| 1 | `GET /health` | 1 | — | `{"status": "ok", "data_loaded": true, "data_dir": "..."}` |
| 2 | `GET /metadata` | 1 | — | Sensores, fechas/períodos disponibles, unidades, fuentes, DEM por época, parámetros y limitaciones. |
| 3 | `GET /territories` | 1 | `type` | GeoJSON `FeatureCollection` del tipo pedido. |
| 4 | `GET /territory-metrics` | 1 | `type`, `date` (o `period`), `metric`, `sensor`* | Un valor por territorio para pintar la coropleta. |
| 5 | `GET /territories/{type}/{id}/summary` | 1 | `date` (o `period`), `sensor` | Ficha del territorio (actividad + condiciones + calidad + procedencia). |
| 6 | `GET /territories/{type}/{id}/activity` | 2 | `from`, `to` (o `period`), `sensor` | Serie diaria del rango con variables ambientales diarias. |
| 7 | `GET /territories/{type}/{id}/sensor-comparison` | 2 | `date` (o `period`) | Indicadores separados por sensor + `status` + `interpretation`. |
| 8 | `GET /territories/{type}/{id}/export.csv` | 2 | `from`, `to`, `sensor` | CSV (20 columnas) con la serie diaria del territorio. |
| 9 | `GET /territories/{type}/{id}/hotspots` | 3 | `date`, `sensor` | Puntos de detección. Solo si existe `hotspots.geojson`. |
| 10 | `GET /territories/{type}/{id}/calendar` | 2 | `sensor`, opcionales `from_period`, `to_period` (`YYYY-MM`) | Serie mensual longitudinal del calendario con `historical_anomaly`. |

\* `sensor` es **obligatorio** para métricas de actividad y **opcional** para `conditions_classification` y métricas ambientales.

### Métricas permitidas en `metric`

| Grupo | Valores | ¿Requiere `sensor`? |
|---|---|---|
| Actividad | `activity_rate`, `fire_pixels_nominal_high`, `fire_pixels_low`, `fire_pixel_days_8_9`, `active_days`, `max_consecutive_active_days`, `observation_coverage` | Sí |
| Ambiental (diaria) | `t_amb_c`, `relative_humidity_2m_pct`, `t_suelo_c`, `lst_valid_pixel_pct`, `wind_dir_deg`, `wind_speed_10m_ms`, `elevation_m` | No |
| Clasificación | `conditions_classification` | No |

## 3. Respuestas de ejemplo

> Los números son de los fixtures (ficticios). Solo muestran la **forma**.

### 3.1 `GET /territory-metrics?type=province&date=2026-09-15&sensor=MODIS_TERRA&metric=activity_rate`

```json
{
  "schema_version": "1.0",
  "date": "2026-09-15",
  "metric": "activity_rate",
  "unit": "adimensional",
  "sensor": "MODIS_TERRA",
  "items": [
    { "territory_type": "province", "territory_id": "1501", "value": 0.0 }
  ]
}
```

El campo `"sensor"` se incluye siempre en la respuesta de `/territory-metrics` (contiene el identificador del sensor consultado o `null` cuando se consulta una métrica ambiental o de clasificación sin sensor).

### 3.2 `GET /territories/province/1501/summary?date=2026-09-15&sensor=MODIS_TERRA`

```json
{
  "schema_version": "1.0",
  "territory": { "type": "province", "id": "1501", "name": "Provincia de muestra (FIXTURE)" },
  "date": "2026-09-15",
  "period": { "id": "2026-09" },
  "sensor": "MODIS_TERRA",
  "daily": {
    "fire_pixels_nominal_high": 0, "fire_pixels_low": 1,
    "valid_land_pixels": 359, "observation_coverage": 0.8975, "activity_rate": 0.0,
    "t_amb_c": 19.5, "t_suelo_c": 31.3, "wind_dir_deg": 108.1,
    "wind_speed_10m_ms": 3.95, "elevation_m": 850.0, "dem_source": "COPERNICUS_DEM_GLO30"
  },
  "activity": {
    "fire_pixel_days_8_9": 13, "active_days": 11, "max_consecutive_active_days": 4,
    "activity_rate": 0.001403, "observation_coverage": 0.7721,
    "historical_anomaly": { "value": 1.4, "status": "estimated", "baseline_years": 10 }
  },
  "environmental_conditions": {
    "classification": "moderate",
    "decision_path": ["N0:pass", "N1:yes", "N2:yes", "N3a:no"],
    "factors": [ { "variable": "precip_30d_mm", "value": 18.4, "unit": "mm", "rule_status": "below_seasonal_p25" } ],
    "modifiers": ["thermal_history_elevated"],
    "missing_variables": []
  },
  "data_quality": { "status": "usable", "notes": [] },
  "provenance": { "source_products": ["MOD14A1", "ERA5_LAND_HOURLY"], "generated_at": "2026-11-14T00:00:00Z", "processing_version": "fixture-0.1.0" }
}
```

Cómo arma el backend la ficha:
- `daily` (y alias retrocompatible `daily_context`) ← fila de `activity_daily.json` con (`type`, `id`, `sensor`, `date`).
- `activity` ← fila de `activity_summary.json` con (`type`, `id`, `sensor`, mes de `date`).
- `environmental_conditions` ← fila de `conditions_assessment.json` con (`type`, `id`, mes de `date`; expone `factors` y alias `evidence`). **No depende del sensor.**
- `data_quality` y `provenance` pueden incluir campos auxiliares de trazabilidad (`valid_land_pixel_days`, `expected_land_pixel_days`, `observation_coverage`, `source_product`, `data_origin`, `dem_source`).

### 3.3 `GET /territories/province/1501/activity?from=2026-09-01&to=2026-09-30&sensor=MODIS_TERRA`

```json
{
  "schema_version": "1.0",
  "territory": { "type": "province", "id": "1501" },
  "sensor": "MODIS_TERRA",
  "from": "2026-09-01", "to": "2026-09-30",
  "items": [
    { "date": "2026-09-10", "fire_pixels_nominal_high": 0, "fire_pixels_low": 0,
      "valid_land_pixels": 0, "expected_land_pixels_per_day": 400, "observation_coverage": 0.0,
      "activity_rate": null,
      "t_amb_c": 19.2, "t_suelo_c": null, "wind_dir_deg": 114.9, "wind_speed_10m_ms": 2.1,
      "elevation_m": 850.0, "dem_source": "COPERNICUS_DEM_GLO30" }
  ]
}
```

`value: 0.0` en la coropleta del 15/09 significa «observado, sin detecciones nominales/altas»; un día sin observación devolvería `null`.

Validación de rango en `/activity`: cuando se envía `from` y `to` (sin `period`), ambos deben cumplir `from <= to`; si `from > to`, la API responde `400 INVALID_PARAMETER`.

Ojo con el 10/09: `valid_land_pixels = 0` y `observation_coverage = 0.0` → **día sin observación**, no «cero fuego». La interfaz debe mostrarlo como «Sin observación».

### 3.4 `GET /territories/province/1501/sensor-comparison?date=2026-09-15`

Devuelve la fila de `sensor_comparison.json` del mes: `status`, bloque `sensors` con cada sensor por separado e `interpretation`. Ver `data/fixtures/sensor_comparison.json`.

### 3.5 `GET /territories/province/1501/export.csv?from=2026-09-01&to=2026-09-30&sensor=MODIS_TERRA`

Cabecera del CSV (mismo orden que los campos diarios):

```text
date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day,observation_coverage,activity_rate,t_amb_c,relative_humidity_2m_pct,t_suelo_c,lst_valid_pixel_pct,wind_dir_deg,wind_speed_10m_ms,elevation_m,dem_source,source_product,processing_version
```

Los `null` se exportan como celda vacía (no como `0`).

### 3.6 `GET /territories/province/1501/calendar?sensor=MODIS_TERRA&from_period=2026-01&to_period=2026-09`

Resuelve la §7.3 de `docs/harness/README.md`: entrega la serie mensual longitudinal precomputada desde `activity_summary.json` para **un** territorio y **un** sensor (nunca suma conteos entre sensores), incluyendo `historical_anomaly` (`value`, `status`, `baseline_years`).

- Parámetros: `sensor` (obligatorio: `MODIS_TERRA`, `MODIS_AQUA` o `VIIRS_SNPP`); `from_period` y `to_period` (opcionales, formato `YYYY-MM`).
- Validación: formato distinto a `YYYY-MM` o `from_period > to_period` → `400 INVALID_PARAMETER`; territorio inexistente → `404 NOT_FOUND`. Si se omiten `from_period` y `to_period`, devuelve todos los meses publicados para ese territorio y sensor ordenados cronológicamente (o `items: []` si el rango filtrado no contiene filas).

```json
{
  "schema_version": "1.0",
  "territory": { "type": "province", "id": "1501" },
  "sensor": "MODIS_TERRA",
  "from_period": "2026-09",
  "to_period": "2026-09",
  "items": [
    {
      "period_id": "2026-09",
      "fire_pixel_days_8_9": 13,
      "fire_pixel_days_7_9": 20,
      "activity_rate": 0.001403,
      "observation_coverage": 0.7721,
      "active_days": 11,
      "max_consecutive_active_days": 4,
      "historical_anomaly": { "value": 1.4, "status": "estimated", "baseline_years": 10 },
      "source_product": "MOD14A1",
      "processing_version": "fixture-0.1.0"
    }
  ]
}
```

## 4. Errores

Formato único, sin trazas técnicas:

```json
{ "code": "INVALID_PARAMETER", "detail": "type debe ser uno de ['hydro_unit', 'province']" }
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_PARAMETER` | Falta un parámetro, tiene un valor no permitido (`type`, `sensor`, `metric`, formato de fecha/período), o el rango está invertido (`from > to` en `/activity`, `from_period > to_period` en `/calendar`). |
| 404 | `NOT_FOUND` | El territorio no existe. |
| 422 | `PERIOD_NOT_AVAILABLE` | La fecha/período es válido pero no está publicado para esa consulta. |
| 500 | `INTERNAL_ERROR` | Error interno. |

**Orden de validación:** 400 (`type`/`sensor`/`metric`/rango) → 422 (fecha/período) → 404 (`id`).

## 5. ¿Qué fechas acepta cada endpoint?

El backend lo decide **solo** mirando `metadata.json`:

| Consulta | La fecha debe estar en… |
|---|---|
| `summary` (ficha) | `available_date_ranges_by_sensor[sensor]` **y** `common_environmental_dates` |
| `activity`, `territory-metrics` con sensor, `export.csv` | `available_date_ranges_by_sensor[sensor]` |
| `calendar` (serie mensual) | Filtra los meses publicados en `activity_summary.json` (opcionalmente con `from_period`/`to_period` válidos en `YYYY-MM`) |
| `territory-metrics` ambiental sin sensor | `common_environmental_dates` |
| `sensor-comparison` | `common_analysis_dates` |

Equivalentes mensuales: `available_periods_by_sensor`, `common_environmental_periods`, `common_analysis_periods`. Si no está → `422`. Nunca se rellena con ceros.

**Política de días útiles y ventana común verificada (Ucayali):**
- `available_date_ranges_by_sensor` y `available_periods_by_sensor` (equivalente operativo de `available_periods`) reflejan **únicamente días útiles registrados**: días con `valid_land_pixels > 0`, nubosidad `< 30 %` (`observation_coverage >= 0.70`) y `activity_rate` no nulo.
- El frontend habilita exclusivamente años, meses y días que cuentan con datos útiles analizables según `GET /metadata`.
- Ventana común multisensor verificada en GEE para Ucayali (`src/gee/gee_verified_dates.json`): **`2012-01-19` a `2026-11-02`** (último mes completo común **`2026-10`**, ~14.8 años > `min_baseline_years = 5`), utilizando `COPERNICUS_DEM_GLO30` donde coinciden `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP` y `ERA5-Land`.

## 6. Valores enumerados

| Campo | Valores |
|---|---|
| `territory_type` | `province`, `hydro_unit` |
| `sensor` | `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP` |
| `classification` | `high`, `moderate`, `low`, `partial`, `not_evaluable` |
| `sensor_comparison.status` | `concordant_elevated`, `concordant_not_elevated`, `discordant`, `single_sensor`, `insufficient` |
| `signal_status` | `elevated`, `not_elevated`, `null` (no utilizable) |
| `historical_anomaly.status` | `estimated`, `insufficient_baseline`, `not_estimable` |
| `data_quality_status` | `usable`, `partial`, `insufficient` |

Etiquetas visibles en español (las pone el frontend):

| Código | Etiqueta |
|---|---|
| `high` / `moderate` / `low` | Susceptibilidad alta / moderada / baja |
| `partial` | Evaluación parcial |
| `not_evaluable` | No evaluable |
| `insufficient_baseline` | Historial insuficiente |
| `null` en un valor | Sin datos |
| cobertura `0` | Sin observación |

## 7. Pruebas de humo

```bash
curl -s localhost:8000/api/v1/health                                                        # 200, data_loaded: true
curl -s "localhost:8000/api/v1/territories?type=province"                                   # 200, FeatureCollection
curl -s "localhost:8000/api/v1/territories?type=otro"                                       # 400 INVALID_PARAMETER
curl -s "localhost:8000/api/v1/territory-metrics?type=province&date=1999-01-01&sensor=MODIS_TERRA&metric=activity_rate"  # 422
curl -s "localhost:8000/api/v1/territories/province/NO_EXISTE/summary?date=2026-09-15&sensor=MODIS_TERRA"                # 404
```

Con fixtures (desde la raíz del repositorio): `MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn src.backend.app.main:app --port 8000`

## 8. Cómo se cambia este contrato

1. Quien necesite el cambio lo propone en el chat del equipo.
2. Jean abre **un PR** que cambia a la vez `contracts/` y `data/fixtures/` (y vuelve a ejecutar `generate_fixtures.py`).
3. Revisan los responsables afectados: antes (quien produce el dato) y después (quien lo consume).
4. Solo se fusiona a `main` con su aprobación. Cambios que rompen → subir `schema_version`.

## 9. Estado de decisiones y pendientes

- [x] Área piloto y nivel Pfafstetter definitivos: Ucayali (`4` provincias INEI 2023 + `20` unidades hidrográficas ANA nivel 4) en `data/processed/territories.geojson`. *(Pendiente únicamente cargar los CSVs de GEE en `data/intermediate/` para generar `data/processed/*.json`.)*
- [x] Bloque diario en la ficha (`daily`, conservando alias `daily_context`) implementado en `src/backend/app/main.py` y `data/fixtures/`.
- [x] `activity_rate` diario (`fire_pixels_nominal_high / valid_land_pixels`, `null` si no hubo observación o cobertura `< 0.70`) implementado en `src/analytics/metrics.py` y `src/analytics/run_pipeline.py`.
- [x] Umbrales y parámetros implementados en `src/analytics/`: `observation_coverage >= 0.70`, `robust_z > 1.5` para señal elevada, `umbral_veg = 20 %`, `umbral_pend = 15 %`, `water_buffer_m = 150 m` / atenuación `>= 5 %`, `min_baseline_years = 5`.
