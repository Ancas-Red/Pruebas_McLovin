# harness — ancla para agentes de IA

Esta carpeta es el punto de entrada para cualquier agente de IA que trabaje en McHanaq,
y la referencia que manda sobre el proyecto. Si el código, un comentario o una
diapositiva contradicen lo que dice aquí, vale lo que está aquí.

**Lee esto primero. En este orden.**

## 1. Qué hay y quién manda

| Archivo | Qué contiene | Autoridad |
|---|---|---|
| `documento-tecnico-operativo.md` | Alcance, fuentes, metodología, contratos de datos, árbol de susceptibilidad, rúbrica y entrega. **v1.7**. | Fuente de verdad |
| `arquitectura-frontend-backend.md` | Contrato `/api/v1`, procesamiento longitudinal, reparto de archivos, dueños por carpeta, Fase 2. **v1.2**. | Fuente de verdad |
| `reto.txt` | Enunciado oficial del reto de la NASA. | Fuente de verdad |

Estos tres archivos se sincronizan con `docs/` de la rama `main` del remoto. **No los
edites desde una rama de trabajo**: se cambian en `main`, con acuerdo del equipo, y
después se replican aquí.

## 2. Estructura de carpetas

Nuestra estructura tiene prioridad sobre la del remoto: el **código** vive bajo `src/`,
con frontend y backend claramente separados, y la **documentación** bajo `docs/`.

```text
McHanaq/
├── docs/
│   ├── harness/            # ESTO: ancla de IA + fuente de verdad
│   └── …                   # documentación propia adicional
├── src/
│   ├── frontend/           # Sebastian — React + Vite + TypeScript + Leaflet
│   ├── backend/            # Jhan (Fase B) / Tom (Fase A) — FastAPI de solo lectura
│   ├── analytics/          # Tom — métricas, anomalías, árbol de reglas
│   └── gee/                # Angelo — pipelines de Google Earth Engine
├── contracts/              # contrato de API y esquemas JSON
├── data/
│   ├── reference/          # capas territoriales oficiales
│   ├── fixtures/           # datos de muestra para desarrollo
│   ├── intermediate/       # exportaciones GEE crudas (ignorado en Git)
│   └── processed/          # JSON/GeoJSON listos para la API
├── tests/
└── presentation/
```

**Estructura unificada en todo el repositorio.** Tanto `main` como todas las ramas `feature/*` usan `src/frontend/`, `src/backend/`, `src/analytics/` y `src/gee/` (si algún documento antiguo en `docs/` menciona `frontend/`, `backend/`, `analytics/` o `gee/` en la raíz, traduce a `src/<carpeta>/`).

Consecuencia práctica para el backend: el ejemplo del documento usa
`ROOT = Path(__file__).resolve().parents[2]`. Con `src/backend/app/main.py` hay un nivel
más, así que ahí va `parents[3]` (arranque desde la raíz: `uvicorn src.backend.app.main:app --port 8000`).

## 2.1. Operación, almacenamiento, mapas base y despliegue

* **Ownership actual (Fase A):** Tom lleva `src/analytics/` y `src/backend/` con apoyo de datos de Angelo (`src/gee/`); Sebastian lleva `src/frontend/`; Jean Pierrer lleva `contracts/`, `data/fixtures/`, `data/reference/`, `docs/`, `tests/acceptance/` y `presentation/`.
* **Puente de datos y Azure Blob Storage (Free Tier):** Las tareas batch desde GEE Code Editor exportan inicialmente a Google Drive o GCS; luego se descargan localmente a `data/intermediate/` (ignorado en Git) y se espejan en **Azure Blob Storage (Free Tier / Azure Storage)** junto con los paquetes procesados de `data/processed/`. Tom genera `data/processed/` y sincroniza los paquetes con Azure Blob Storage offline o en tiempo de build/deploy. El backend nunca consulta GEE ni lee Azure Blob Storage o Google Drive por petición HTTP de usuario.
* **Despliegue oficial (`infra/azure/` + Cloudflare Pages):**
  * **Backend (`src/backend/`):** **Azure App Service (Plan Free F1, Linux Python 3.11)** usando el `requirements.txt` raíz para Oryx, `infra/azure/startup.sh`, sonda `GET /` para warm-up y `MCHANAQ_CORS_ORIGIN_REGEX` (vistas previas `*.pages.dev`), en modo solo lectura sobre `data/processed/` local (o `data/fixtures/` en CI/demo), manteniendo `ROOT = Path(__file__).resolve().parents[3]` y `< 1 MB` en `territories.geojson` (paquete de datos `< 30–40 MB`).
  * **Frontend (`src/frontend/`):** **Cloudflare Pages** (`src/frontend/public/_headers`, recomendado) o **Azure Static Web Apps (`infra/azure/staticwebapp.config.json`)** sirviendo `src/frontend/dist/` con `VITE_API_BASE` (o `VITE_API_BASE_URL` en `infra/azure/`) apuntando a la URL del Azure App Service.
  * **Estado actual en `data/processed/`:** `territories.geojson` (24 polígonos Ucayali), `ucayali_territories.geojson` y `ucayali_districts_static.csv` ya están generados; los JSON de series (`metadata.json`, `activity_daily.json`, `activity_summary.json`, `sensor_comparison.json`, `conditions_assessment.json`) esperan los CSVs de GEE en `data/intermediate/`.
  * **Nota *legacy*:** `render.yaml` se conserva únicamente como referencia *legacy*/opcional; Azure App Service Free F1 + Cloudflare Pages / Azure SWA es la configuración activa.
* **Mapas base libres tipo QGIS (sin API keys):** OpenTopoMap (`https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png`, ideal para hidrología y relieve), OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) y Esri World Imagery. No usar CARTO (exige clave).

### 2.2. Alineación del piloto Ucayali

* **Territorios piloto (`data/processed/territories.geojson`):** región Ucayali con `4` provincias INEI 2023 (`2501` Coronel Portillo, `2502` Atalaya, `2503` Padre Abad, `2504` Purús) y `20` unidades hidrográficas ANA Pfafstetter nivel 4 (`24` polígonos en total).
* **Combustible y buffer de agua superficial (`CobVeg_180615.shp`):** se considera combustible toda cobertura vegetal de `CobVeg_180615.shp` (MINAM 2015) excluyendo agua y clases no combustibles (`umbral_veg = 20%`, `umbral_pend = 15%`), y se aplica un buffer de `150 m` (`water_buffer_m = 150 m`) sobre cuerpos de agua superficial; cuando `water_buffer_150m_pct >= 5%` (o `water_area_pct >= 5%`), una susceptibilidad `high` se atenúa a `moderate` (`water_buffer_150m_attenuation` / `surface_water_buffer_150m`).
* **Ventana común multisensor verificada en GEE (`src/gee/gee_verified_dates.json`):** **`2012-01-19` a `2026-11-02`** (último mes completo común **`2026-10`**), donde coinciden `MODIS_TERRA` (`MOD14A1`), `MODIS_AQUA` (`MYD14A1`), `VIIRS_SNPP` (`VNP14A1`) y `ERA5-Land` (~14.8 años > `min_baseline_years = 5`), con `COPERNICUS_DEM_GLO30`. Se retira la expectativa operativa de exportar bloques pre-2012 (`2000–2011` queda solo como nota *legacy* fuera de alcance).
* **Tres opciones oficiales de exportación GEE (Ucayali):**
  1. **Prueba rápida:** `2024-01-01` a `2026-11-03`
  2. **Línea base mínima de 5 años:** `2018-01-01` a `2026-11-03`
  3. **Ventana común completa en bloques de 2 años:** `2012-01-19`..`2014-01-01`, `2014-01-01`..`2016-01-01`, `2016-01-01`..`2018-01-01`, `2018-01-01`..`2020-01-01`, `2020-01-01`..`2022-01-01`, `2022-01-01`..`2024-01-01`, `2024-01-01`..`2026-11-03`.
* **Filtro diario de nubes y política de días útiles:** se exige `< 30%` de nubes diario (`observation_coverage >= 0.70` y `lst_valid_pixel_pct >= 70.0`). `available_date_ranges_by_sensor` y `available_periods_by_sensor` reflejan **únicamente días útiles registrados** (`valid_land_pixels > 0`, nubosidad `< 30 %` / `observation_coverage >= 0.70` y `activity_rate` no nulo), y el frontend habilita solo años, meses y días con datos útiles analizables.
* **Respaldo tabular FIRMS Perú (`src/gee/firms_peru/`):** series CSV completas de focos de calor para Perú (`modis/` `2000–2025` con 26 archivos, `viirs-snpp/` `2012–2025` con 14 archivos y `viirs-jpss1/` `2018–2025` con 8 archivos).
* **Alcance de susceptibilidad (`N0–N3`) frente a CENEPRED/SERFOR:** el árbol evalúa factores condicionantes físico-climáticos (`CobVeg_180615.shp` con buffer de agua de `150 m`, pendiente `COPERNICUS_DEM_GLO30` $\ge 15\%$ y clima `ERA5-Land` contra percentiles estacionales `p25`/`p75`), manteniendo `thermal_history_elevated` como modificador informativo; no modela presión antrópica (vías/centros poblados), pesos diferenciales por tipo de cobertura vegetal ni exposición de elementos (riesgo).

## 3. Reglas que no se negocian

1. **La API es diaria por defecto.** `date=YYYY-MM-DD` y rangos `from`/`to`.
   `period=YYYY-MM` es opcional y solo aporta contexto y anomalía mensual.
2. **Nunca se suman conteos entre sensores.** Cada uno conserva su propio denominador
   (`valid_land_pixel_days`) y se clasifica contra su propio umbral estacional antes de
   compararlos.
3. **`null` nunca es `0`.** Dato ausente se muestra como «Sin datos», «No estimable» o
   «No evaluable». Si hay más del 30 % de nubes (`lst_valid_pixel_pct < 70`), `t_suelo_c`
   llega como `null`.
4. **Línea base mínima: 5 años** (`min_baseline_years`). Por debajo, la anomalía robusta
   no es estimable.
5. **El frontend no calcula.** No deriva concordancia multisensor ni categorías de
   susceptibilidad: muestra lo que devuelve la API. Lo que hay en
   `src/frontend/src/api/client.ts` bajo «derivaciones locales» existe solo para
   desarrollar sin backend y está marcado como tal.
6. **Paletas aptas para daltonismo**: Viridis, Cividis o ColorBrewer. Usamos **Cividis**
   en el calendario y la coropleta. La rampa cálida queda reservada al frente simulado,
   donde el color codifica tiempo, no magnitud.
7. **Un solo escritor por archivo.** Nadie edita un archivo que otro genera.
8. **Los fixtures no son resultados.** Nunca se presentan como observaciones en la demo
   ni en el pitch.

## 4. Variables diarias del contrato

Están en `src/frontend/src/api/types.ts` (`DailyEnv`) y en
`data/intermediate/environmental_daily.csv`:

| Campo | Unidad | Origen y regla |
|---|---|---|
| `t_amb_c` | °C | ERA5-Land `temperature_2m` − 273.15 |
| `relative_humidity_2m_pct` | % | Magnus-Tetens desde temperatura y punto de rocío |
| `t_suelo_c` | °C | LST MODIS/VIIRS, `valor × 0.02 − 273.15`; `null` con >30 % de nubes |
| `lst_valid_pixel_pct` | % | debe ser ≥ 70 para usar `t_suelo_c` |
| `wind_dir_deg` | grados | `(atan2(−u, −v) · 180/π + 360) % 360`; nunca promediar ángulos |
| `wind_speed_10m_ms` | m/s | `sqrt(u² + v²)` |
| `elevation_m` | m s. n. m. | `COPERNICUS/DEM/GLO30` (`COPERNICUS_DEM_GLO30`, 30 m) en la ventana común `2012–2026` *(nota legacy fuera de alcance operativo: `NASADEM/SRTM` solo aplicaba a tramos pre-2012)* |
| `dem_source` | — | identificador del DEM aplicado |

## 5. Fase 2 — propagación

Es **opcional y desacoplada**. No toca ningún endpoint de Fase 1. En el frontend vive en
`src/frontend/src/lib/spread.ts` (`SpreadRail.tsx`), y en Python en
`src/analytics/spread_model.py` (`heuristic_wind_slope_spread_v1`, documentada en
`docs/Fase2_Simulacion_Espacial_Propagacion_48h.md`). Integra **SAVI (Huete, 1988)**,
**topografía/pendiente DEM** y **viento horario hasta 48 h** (`+6`, `+12`, `+24`, `+36`, `+48 h`),
genera `data/processed/spread_forecasts.json` y salidas en `data/processed/spread_outputs/`
(`simulacion_48h.gif`, `pronostico_48h.mp4`, Shapefiles `.zip` QGIS e infografías PNG) y
expone una arquitectura API en 2 pasos (`/spread-forecast`, `/spread-simulate` rápido y
`/spread-export` + `/spread-outputs/{filename}` bajo demanda, con soporte global vía
Open-Meteo en `use_open_meteo=true` y `/realtime/area`), manteniendo siempre su aviso no operativo.

## 6. Qué queda fuera del alcance

Predicción de ocurrencia o ignición, probabilidad de incendio, estimación de superficie
futura quemada, modelos entrenados con aprendizaje automático y cualquier uso operativo
de alerta, despacho o evacuación.

## 7. Estado del frontend

Alineado con el contrato v1.2, **verificado contra el backend real** (`src/backend/` con `data/fixtures/` y `data/processed/territories.geojson`) e incluye tres rutas SPA (`#/` portada inmersiva con crossfade y sección Los McLovin, `#/mapa` visor con `GuidedTour`, y `#/tecnologia` con `TechTerminal` y `Starfield`, bajo cortina de carga `OrbitalLoader`). Mientras `/api/v1` no responda o no tenga series publicadas en `data/processed/`, la interfaz usa su juego de datos de muestra —con la **misma forma** del contrato— y lo indica en la barra de estado y en la columna `data_origin` de cada CSV.

### 7.1. Cómo está organizado

| Archivo | Responsabilidad |
|---|---|
| `src/api/types.ts` | Tipos y enumerados del contrato, etiquetas en castellano. Nadie cambia aquí un nombre, tipo o unidad sin tocar primero `contracts/`. |
| `src/api/client.ts` | Los 10 endpoints de `/api/v1` (incluido `/calendar`), normalización de `VITE_API_BASE` / `VITE_API_BASE_URL` y manejo de `AbortController`. |
| `src/api/source.ts` | Decide API o muestra, y etiqueta la procedencia. El día que el backend sea estable, se borra este archivo sin tocar pantallas. |
| `src/lib/fixtures.ts` | Muestra determinista con la forma del contrato, endpoint por endpoint. |
| `src/lib/calendar.ts` | Respaldo offline / agrupación local del calendario (ver 7.3). |
| `src/pages/Landing.tsx` | Portada por bloques (`#inicio`, `#proyecto`, `#equipo`) con globo 3D, crossfade entre secciones y tarjetas del equipo (`public/equipo/`). |
| `src/pages/MapTool.tsx` | Herramienta cartográfica con `GuidedTour`, selector territorial, calendario, contraste multisensor, árbol de susceptibilidad y simulación Fase 2. |
| `src/pages/TechStack.tsx` | Vista `#/tecnologia` con tarjetas por capa técnica (`src/data/tech.ts`), terminal interactiva (`TechTerminal`) y campo estelar (`Starfield`). |

### 7.2. Reglas que el frontend cumple y conviene no romper

* **Consulta por territorio.** Tipo + id en toda llamada. Provincias y cuencas no se
  mezclan; al cambiar de tipo se reselecciona el primer id del tipo nuevo.
* **Un sensor activo.** La interfaz tiene *un* sensor seleccionado, no varios. Es la
  forma de que no exista la tentación de sumar conteos. El contraste entre los tres se
  ve en «Comparación», que lo resuelve el backend.
* **`metadata` manda.** No se dispara ninguna consulta de datos antes de tener
  `metadata`, y si la fecha abierta no está publicada para el sensor no se consulta la
  API en absoluto: el contrato ya dice que contestaría `422`. `available_date_ranges_by_sensor`
  y `available_periods_by_sensor` representan **únicamente días útiles registrados**
  (`valid_land_pixels > 0`, `< 30 %` de nubes / `observation_coverage >= 0.70` y `activity_rate`
  no nulo), por lo que el selector de interfaz habilita solo años, meses y días analizables.
  Al arrancar, la herramienta salta a la última fecha publicada.
* **El frontend no calcula.** Tasa, anomalía, estado de señal y clasificación llegan de
  `/summary` y `/sensor-comparison`. Se borraron las derivaciones que había antes.
* **`null` nunca es `0`.** Un día sin observación se rotula «Sin observación», un valor
  ausente «Sin datos», una anomalía sin línea base «Historial insuficiente». En la
  coropleta, un territorio sin dato se deja en hueco gris, nunca en el extremo bajo de
  la rampa.
* **Procedencia separada.** El rótulo de los indicadores y el de los focos son
  independientes: `/hotspots` es prioridad 3 y puede faltar sin que eso convierta en
  muestra lo que sí vino de la API.
* **Cividis** para magnitudes en mapa y calendario; la rampa cálida solo para el frente
  simulado, donde el color codifica tiempo. Los colores por sensor son categóricos.

### 7.3. Serie mensual del calendario (resuelto en contrato y API)

`GET /api/v1/territories/{type}/{id}/calendar?sensor=…` (con parámetros opcionales `from_period` y `to_period` en formato `YYYY-MM`) ya forma parte de `contracts/api-contract.md` (§2 y §3.6) y resuelve la serie mensual longitudinal directamente desde `activity_summary.json`. Devuelve por mes `period_id`, `fire_pixel_days_8_9`, `fire_pixel_days_7_9`, `activity_rate`, `observation_coverage`, `active_days`, `max_consecutive_active_days`, `historical_anomaly` (`value`, `status`, `baseline_years`), `source_product` y `processing_version`, sin sumar conteos entre sensores y preservando `null` ante falta de observación o línea base insuficiente (`< 5` años). `src/lib/calendar.ts` se mantiene únicamente como respaldo local cuando el frontend opera sin backend conectado.

### 7.4. Variable de entorno del frontend

`VITE_API_BASE` (o `VITE_API_BASE_URL` si se mapea en los flujos de `infra/azure/`)
fija la base de la API al compilar `src/frontend/dist/`; por omisión
`http://localhost:8000/api/v1`. En **Cloudflare Pages** (`src/frontend/public/_headers`)
o **Azure Static Web Apps (`infra/azure/staticwebapp.config.json`)** apunta a la URL
del **Azure App Service (Plan Free F1)** del backend (`render.yaml` queda únicamente
como referencia *legacy*/opcional). El backend debe incluir el origen del frontend en
`MCHANAQ_CORS_ORIGINS` (o patrón de vistas previas en `MCHANAQ_CORS_ORIGIN_REGEX`).

### 7.5. Comprobado en navegador

Prueba sin interfaz (Chrome headless) contra `uvicorn` + `data/fixtures`: cabecera
estática sin solapar el contenido, bloques de la portada a la altura exacta del
contenedor, sin `scroll-snap`, ningún texto visible con `opacity: 0`, sin capas de
composición retenidas, los 5 espacios de foto del equipo, territorios desde
`/territories`, e indicadores desde `/summary`. Cero peticiones desperdiciadas: ningún
`422` en el arranque.
