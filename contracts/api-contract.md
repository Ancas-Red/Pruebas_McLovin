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

## 10. Fase 2 opcional / tiempo real global (desacoplado de Fase 1)

Los siguientes endpoints operan de forma **opcional y desacoplada**: no modifican, bloquean ni alteran ningún contrato de solo lectura de las secciones 1–9 (Fase 1).

| Ruta | Método(s) | Parámetros clave | Propósito |
|---|---|---|---|
| `/api/v1/territories/{type}/{id}/spread-forecast` | `GET` | `date` (`YYYY-MM-DD`, opcional), `horizon_h` (`6..48`, default `48`) | Devuelve pronóstico precalculado (`spread_forecasts.json`) o ejecuta simulación puntual sobre el territorio. |
| `/api/v1/reverse-geocode` | `GET` | `lat` (`-90..90`), `lon` (`-180..180`) | Geocodificación inversa administrativa vía OSM Nominatim (`OSM_NOMINATIM`). |
| `/api/v1/realtime/area` | `GET` | `south`, `west`, `north`, `east`, `days` (`1..10`, default `3`) | Clima en vivo (Open-Meteo), `location` administrativa y focos NRT separados por sensor (NASA FIRMS). |
| `/api/v1/spread-simulate` | `GET` \| `POST` | `lat`, `lon`, `date`, `horizon_h`, `use_open_meteo`, overrides físicos | **Paso 1 rápido:** simula propagación condicional hasta 48 h y devuelve JSON/GeoJSON inmediato. |
| `/api/v1/spread-export` | `GET` \| `POST` | Mismos parámetros que `/spread-simulate` | **Paso 2 bajo demanda:** genera GIF, MP4, ZIP QGIS e infografías PNG en `spread_outputs/`. |
| `/api/v1/spread-outputs/{filename}` | `GET` | `filename` en lista blanca de 5 artefactos | Sirve artefactos multimedia/GIS generados o precalculados (`FileResponse`). |

### 10.1 `GET /api/v1/reverse-geocode?lat=…&lon=…`

- **Parámetros obligatorios:** `lat` (`-90.0..90.0`) y `lon` (`-180.0..180.0`).
- **Fuente y caché:** consulta `https://nominatim.openstreetmap.org/reverse` (`zoom=14`, `accept-language=es`) con caché en memoria por coordenada redondeada a 3 decimales (hasta 512 entradas).
- **Campos devueltos:** `schema_version` (`"1.0"`), `lat`, `lon` (redondeados a 5 decimales), `status` (`"ok"` | `"unavailable"`), `source` (`"OSM_NOMINATIM"`), `country`, `country_code`, `region`, `province`, `city`, `district` (`string | null`), `hierarchy` (`string[]` sin duplicados), `header_primary`, `header_sub`, `display_name` (y `detail` si `status == "unavailable"`).

```json
{
  "schema_version": "1.0",
  "lat": -8.19833,
  "lon": -75.26669,
  "status": "ok",
  "source": "OSM_NOMINATIM",
  "country": "Perú",
  "country_code": "PE",
  "region": "Ucayali",
  "province": "Coronel Portillo",
  "city": "Campo Verde",
  "district": null,
  "hierarchy": ["Perú", "Ucayali", "Coronel Portillo", "Campo Verde"],
  "header_primary": "Perú",
  "header_sub": "Campo Verde · Coronel Portillo",
  "display_name": "Perú · Ucayali · Coronel Portillo · Campo Verde"
}
```

### 10.2 `GET /api/v1/realtime/area?south=…&west=…&north=…&east=…&days=3`

- **Parámetros:** `south`, `north` (`-90.0..90.0`), `west`, `east` (`-180.0..180.0`), `days` (`1..10`, default `3`). Si `south >= north` o `west >= east` → `400 INVALID_PARAMETER`.
- **Bloque `location`:** resuelve el centro del `bbox` con el mismo esquema administrativo de `/reverse-geocode` (`status`, `source: "OSM_NOMINATIM"`, `country`, `country_code`, `region`, `province`, `city`, `district`, `hierarchy`, `header_primary`, `header_sub`, `display_name`).
- **Bloque `weather`:** consulta Open-Meteo (`https://api.open-meteo.com/v1/forecast`, `wind_speed_unit=ms`) para el centro del `bbox`: `status` (`"ok"` | `"unavailable"`), `source` (`"Open-Meteo"`), `observed_at`, `center` (`{lat, lon}`), `t_amb_c`, `relative_humidity_2m_pct`, `wind_speed_10m_ms`, `wind_dir_deg` (o `detail` si falla).
- **Focos activos NASA FIRMS (separados por sensor):** consulta `MODIS_NRT` (`MODIS`), `VIIRS_SNPP_NRT` (`VIIRS_SNPP`) y `VIIRS_NOAA20_NRT` (`VIIRS_NOAA20`) usando la variable de entorno opcional `FIRMS_MAP_KEY`:
  - Sin `FIRMS_MAP_KEY`: devuelve `hotspots_status: "firms_map_key_required"`, `counts_by_sensor: {}`, `hotspots: {"type": "FeatureCollection", "features": []}` y `firms_setup: {"env_var": "FIRMS_MAP_KEY", "register_url": "...", "note": "..."}`.
  - Con `FIRMS_MAP_KEY`: devuelve `hotspots_status` (`"ok"` | `"partial"`), `counts_by_sensor` (conteos independientes por sensor, **nunca sumados**), `errors_by_sensor` (`dict | null`) y `hotspots` (`FeatureCollection` de puntos con `sensor`, `firms_source`, `acq_date`, `acq_time`, `confidence`, `frp_mw`, `satellite`, `daynight`).

### 10.3 `GET|POST /api/v1/spread-simulate` y `GET|POST /api/v1/spread-export`

- **Parámetros (query string en `GET` o cuerpo JSON en `POST`; si se envían ambos, prevalece el JSON body):**
  - Obligatorios: `lat` (`-90.0..90.0`), `lon` (`-180.0..180.0`). Si faltan o salen de rango → `400 INVALID_PARAMETER`.
  - Opcionales con default: `date` (`YYYY-MM-DD`, default `"2024-09-25"`), `horizon_h` (`6..48`, default `48`; fuera de rango → `400 INVALID_PARAMETER`), `use_open_meteo` (`bool`, default `false`).
  - Overrides físicos opcionales: `wind_speed_10m_ms` (`0..40`), `wind_dir_deg` (`0..360`), `vegetation_pct` (`0..100`), `slope_mean_deg` (`0..60`), `fuel_moisture_pct` (`1..35`).
  - Solo en JSON body: `territory_type` (default `"custom"`), `territory_id` (default `"custom"`), `territory_name` (default `"Punto (lat, lon)"`).
- **Respuesta de `/api/v1/spread-simulate`:**
  - **Con motor analítico completo (`src/analytics/spread_model.py`):** devuelve `schema_version` (`"1.0"`), `phase` (`"phase_2_optional"`), `territory`, `date`, `horizon_h`, `ignition`, `dominant_wind`, `hourly_wind`, `savi_summary` (`mean`, `p90`, `source`), `slope_summary` (`mean_deg`, `max_deg`, `dem_source`), `grid_summary` (`cols`, `rows`, `cell_size_m`, `bounds`, `total_area_ha`, `head_ros_m_min`, `length_to_breadth`), `bands`, `hourly_progression`, `isochrones` (`+6h`, `+12h`, `+24h`, `+36h`, `+48h`), `assumptions`, `data_sources` (`wind_source`, `dem_source`, `vegetation_index`, etc.), `outputs`, `model_metadata` y `timings_s`. Con `use_open_meteo=true`, activa por defecto Sentinel-2 L2A SAVI vía Planetary Computer (`SENTINEL2_L2A_PLANETARY_COMPUTER`), Open-Meteo horario y Open-Meteo Elevation (`COPERNICUS_DEM_GLO90_OPEN_METEO`), con respaldo determinista si no hay cobertura o red.
  - **Modo liviano Azure Free Tier F1 (sin `geopandas`/`numpy`/`matplotlib` en runtime):** ejecuta `_run_lightweight_global_spread` en Python puro + `httpx` consultando Open-Meteo Elevation (`COPERNICUS_DEM_GLO90_OPEN_METEO` sobre grilla 4×4, fallback `COPERNICUS_DEM_GLO30_PARAMETRIC`) y viento actual Open-Meteo si `use_open_meteo=true`. Devuelve `schema_version`, `phase`, `territory`, `date`, `horizon_h`, `ignition`, `dominant_wind`, `savi_summary` (`mean`, `source`), `slope_summary` (`mean_deg`, `max_deg`, `dem_source`), `spread_summary` (`head_ros_m_min`, `length_to_breadth`), `data_sources` y `timings_s`.
- **Respuesta de `/api/v1/spread-export`:**
  - Con motor completo: ejecuta la simulación, exporta los 5 archivos en `data/processed/spread_outputs/` y devuelve el mismo esquema con `outputs` y `timings_s` detallados (`total_export_s`, `total_s`, etc.).
  - En runtime liviano sin dependencias GIS/video: responde `503 EXPORT_LIBS_UNAVAILABLE` (las descargas precalculadas en `/api/v1/spread-outputs/{filename}` siguen disponibles).

### 10.4 `GET /api/v1/spread-outputs/{filename}`

Sirve desde `SPREAD_OUTPUTS_DIR` (`data/processed/spread_outputs/`) únicamente los 5 archivos permitidos:

| `filename` | `Content-Type` | Contenido |
|---|---|---|
| `simulacion_48h.gif` | `image/gif` | Animación horaria (48 frames) |
| `pronostico_48h.mp4` | `video/mp4` | Video MP4 (H.264) 48 h |
| `mchanaq_propagacion_48h_qgis.zip` | `application/zip` | Shapefiles ESRI WGS84 para QGIS |
| `infografia_impacto_48h.png` | `image/png` | Infografía ejecutiva 300 DPI |
| `panel_modelo_48h.png` | `image/png` | Panel comparativo SAVI + Pendiente/Viento + Simulación |

Si `filename` no pertenece a la lista o no existe en disco, responde `404 NOT_FOUND`.

Referencia metodológica completa: `docs/Fase2_Simulacion_Espacial_Propagacion_48h.md`.
