# McHanaq

**NASA Space Apps Challenge 2026 — reto *Harmonization of MODIS and VIIRS Hot Spots***
Equipo: Los McLovin · Perú

Calendario longitudinal de actividad térmica (MODIS Terra/Aqua y VIIRS S-NPP) con contexto ambiental, susceptibilidad contextual, comparación multisensor y simulación exploratoria de recorrido de fuego (Fase 2 opcional).

---

## Documentación principal (fuente de verdad)

* [Documento técnico y operativo v1.7](docs/McHanaq_documento_tecnico_operativo_v1.7.md)
* [Arquitectura frontend ↔ backend y procesamiento longitudinal (v1.2)](docs/arquitectura_frontend_backend_McHanaq.md)
* [Fase 2: Simulación espacial de propagación 48 h (SAVI + Topografía + Viento horario)](docs/Fase2_Simulacion_Espacial_Propagacion_48h.md)
* [Descripción del reto](docs/reto.txt)
* [Ancla para agentes (`docs/harness/`)](docs/harness/README.md)
* [Uso de IA y transparencia (NASA Space Apps 2026)](AI_USAGE.md)

## Estructura del repositorio

```text
McHanaq/
├── src/
│   ├── frontend/        # Sebastian — React + Vite + TypeScript + Leaflet (hosting y despliegue)
│   ├── backend/         # Angelo — FastAPI + ingesta ambiental (co-revisión: Tom)
│   ├── analytics/       # Tom — analítica longitudinal; Angelo — spread_model.py (Fase 2)
│   └── gee/             # Angelo — Google Earth Engine y fuentes NASA/abiertas
├── contracts/           # Contrato de API, diccionario de datos y esquemas (Jean Pierrer)
├── data/
│   ├── reference/       # Capas territoriales oficiales de referencia (Jean Pierrer)
│   ├── fixtures/        # Datos sintéticos para desarrollo/pruebas (Jean Pierrer)
│   ├── intermediate/    # Exportaciones GEE crudas (ignorado en Git)
│   └── processed/       # JSON/GeoJSON listos para la API
├── tests/               # Pruebas unitarias, de humo y de aceptación
├── docs/                # Documentación técnica, metodológica y harness (Jean Pierrer)
└── presentation/        # Deck y guion de exposición (Jean Pierrer)
```

## Ramas del equipo y repositorios

* **Repositorio de integración activa (Fase 2 global + UX):** [`sebastiansb1232-boop/McHanaq-labs`](https://github.com/sebastiansb1232-boop/McHanaq-labs) en la rama `feature/labs-phase2-integration`.
* **Repositorio *upstream* del equipo:** [`TomJordan1/McHanaq`](https://github.com/TomJordan1/McHanaq).

| Rama | Responsable | Carpeta principal / alcance |
|---|---|---|
| `feature/gee-data-pipeline`, `feature/api-backend` | Angelo | `src/backend/`, `src/gee/` (+ Open-Meteo/NASA FIRMS/Earth Engine) y `src/analytics/spread_model.py` (Fase 2) |
| `feature/analytics-engine` | Tom | Liderazgo e integración transversal, `src/analytics/` (Fase 1 longitudinal) y co-revisión de `src/backend/` |
| `feature/frontend-dashboard` | Sebastian | `src/frontend/`, hosting, dominio y despliegue en la nube (`infra/azure/`, Cloudflare Pages / SWA) |
| `feature/product-qa-demo` | Jean Pierrer | `docs/`, `contracts/`, `AI_USAGE.md`, `presentation/`, auditoría documental, `data/reference/`, `data/fixtures/`, `tests/acceptance/` |

## Inicio rápido

```bash
git clone https://github.com/sebastiansb1232-boop/McHanaq-labs.git
cd McHanaq-labs
git checkout feature/labs-phase2-integration
# Upstream oficial: https://github.com/TomJordan1/McHanaq.git
```

### Arrancar el backend (en modo fixtures)

* **Linux/macOS:**
  ```bash
  MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn src.backend.app.main:app --reload --port 8000
  ```
* **Windows PowerShell:**
  ```powershell
  $env:MCHANAQ_DATA_DIR="data/fixtures"; $env:MCHANAQ_NO_CACHE="1"; uvicorn src.backend.app.main:app --reload --port 8000
  ```

### Arrancar el frontend

```bash
cd src/frontend
npm install
npm run dev          # http://localhost:5173 (proxy /api -> localhost:8000)
```

Mientras el backend no responda, el frontend cae en sus fixtures locales y lo indica de forma visible en la interfaz.

## Infraestructura oficial (Azure App Service Free Tier + Cloudflare Pages / Azure SWA)

* **Backend (`src/backend/`):** **Azure App Service (Plan Free F1, Linux Python 3.11)** con `requirements.txt` en la raíz para Oryx, `infra/azure/startup.sh`, sonda `GET /` para warm-up y `MCHANAQ_CORS_ORIGIN_REGEX` para habilitar vistas previas. Opera en modo de solo lectura sobre `data/processed/` local (o `data/fixtures/` en CI/demo), conservando `ROOT = Path(__file__).resolve().parents[3]`, sin consultar GEE ni almacenamiento externo por petición HTTP.
* **Frontend (`src/frontend/`):** **Cloudflare Pages** (`src/frontend/public/_headers`, recomendado) o **Azure Static Web Apps (Plan Free, `infra/azure/staticwebapp.config.json`)** sirviendo `src/frontend/dist/` con `VITE_API_BASE` (o `VITE_API_BASE_URL`) apuntando a la URL del Azure App Service.
* **Puente de datos y estado actual (`data/processed/` vs. `data/intermediate/`):** **Azure Blob Storage (Free Tier)** resguarda `data/intermediate/` y `data/processed/` mediante `python -m src.analytics.azure_sync`. Actualmente `data/processed/` ya contiene `territories.geojson` (4 provincias + 20 cuencas de Ucayali), `ucayali_territories.geojson`, `peru_territories.geojson`, `ucayali_districts_static.csv`, `metadata.json` y los artefactos precalculados de Fase 2 (`spread_forecasts.json` y `spread_outputs/`). En cambio, `data/intermediate/` aún espera la descarga de los CSVs exportados desde GEE y aún no existen `activity_daily.json`, `activity_summary.json`, `sensor_comparison.json` ni `conditions_assessment.json` en `data/processed/`. Por ello, la **Fase 1** opera en modo `"Datos de muestra"` (`data/fixtures/`) hasta que ingresen los CSVs en `data/intermediate/` y se ejecute `python -m src.analytics.run_pipeline`; mientras tanto, la **Fase 2 global** ya corre en vivo con **Open-Meteo** (clima/viento y elevación **Copernicus GLO-90 DEM**), **OSM Nominatim** (geocodificación administrativa) y **Microsoft Planetary Computer (Sentinel-2 L2A)** para SAVI. `render.yaml` se conserva únicamente como referencia *legacy*/opcional.

## Ventana común verificada (Ucayali) y días útiles

* **Ventana multisensor común verificada en GEE (`src/gee/gee_verified_dates.json`):** **`2012-01-19` a `2026-11-02`** (último mes completo común **`2026-10`**), donde coinciden `MODIS_TERRA` (`MOD14A1`), `MODIS_AQUA` (`MYD14A1`), `VIIRS_SNPP` (`VNP14A1`) y `ERA5-Land` (~14.8 años > 5 años de línea base mínima), utilizando `COPERNICUS_DEM_GLO30`. Se retira la expectativa operativa de exportar bloques pre-2012 (`2000–2011`, nota *legacy* fuera de alcance).
* **Tres opciones oficiales de exportación GEE (Ucayali):**
  1. **Prueba rápida:** `2024-01-01` a `2026-11-03`
  2. **Línea base mínima (5 años):** `2018-01-01` a `2026-11-03`
  3. **Ventana común completa en bloques de 2 años:** `2012-01-19`..`2014-01-01`, `2014-01-01`..`2016-01-01`, `2016-01-01`..`2018-01-01`, `2018-01-01`..`2020-01-01`, `2020-01-01`..`2022-01-01`, `2022-01-01`..`2024-01-01`, `2024-01-01`..`2026-11-03`.
* **Política de días útiles:** `available_date_ranges_by_sensor` y `available_periods_by_sensor` en `/api/v1/metadata` reflejan **únicamente días útiles registrados** (`valid_land_pixels > 0`, nubosidad `< 30 %` / `observation_coverage >= 0.70`, `activity_rate` no nulo); el frontend habilita solo años, meses y días con datos útiles analizables.

## Qué hace la aplicación

* **Inicio (`#/`):** portada por bloques con paleta bosque-carbón (`#040806` / `#0c1810` / `#d8ff33`), cortina orbital (`OrbitalLoader`), globo 3D interactivo + campo estelar (`#inicio`, titular animado de la ventana `2012 — 2026`), propósito y límites (`#proyecto`), y sección de equipo **Los McLovin** (`#equipo`) con transición de opacidad suave entre bloques, enlaces individuales a LinkedIn/GitHub (`src/frontend/src/data/team.ts`) y enlace oficial en el emblema de lentes.
* **Mapa (`#/mapa`):**
  * **Calendario:** visor Leaflet del Perú / Ucayali con tour guiado inicial (`? Guía`, 7 pasos en `MAP_TOUR_STEPS`), selector territorial, calendario longitudinal 2D y relieve 3D (`CalendarTerrain3D`, `2012–2026`), serie diaria, indicadores, comparación multisensor y árbol de susceptibilidad.
  * **Simulación (Fase 2 opcional, hasta 48 h):** abre automáticamente el cajón `Escenario · Fase 2` con `? Guía` dedicada de 5 pasos (`SPREAD_TOUR_STEPS`), modelo exploratorio desacoplado (`src/analytics/spread_model.py`, `heuristic_wind_slope_spread_v1`) que combina SAVI (Sentinel-2 L2A vía Microsoft Planetary Computer o fallback calibrado), pendiente DEM (Copernicus GLO-90 vía Open-Meteo, incluyendo fallback Python puro `COPERNICUS_DEM_GLO90_OPEN_METEO` en Azure F1) y viento horario de hasta `48 h` (`+6h..+48h`). Incluye **simulación global en 1 clic** (presets *Ucayali*, *California*, *Grecia* o cualquier par Lat/Lon), selector `Fecha de inicio (48 h)`, **geocodificación administrativa inversa** país / región / provincia / ciudad / distrito (`GET /api/v1/reverse-geocode`) sincronizada en la cabecera (`SiteNav`) y en el panel, previsualización integrada (`simulacion_48h.gif`, `infografia_impacto_48h.png`, `panel_modelo_48h.png`) y generación/descarga bajo demanda (`/spread-simulate`, `/spread-export`, `/spread-outputs/{filename}`) más consultas globales Open-Meteo / NASA FIRMS NRT (`/realtime/area`, opcional con `FIRMS_MAP_KEY`).
* **Tecnología (`#/tecnologia`):** vista dedicada con tarjetas filtrables por capa técnica (`src/frontend/src/data/tech.ts`) y terminal interactiva (`TechTerminal` en pestañas Bash / Python / API).
* **Fotos del equipo:** las 4 fotos del equipo están activas en `src/frontend/public/equipo/` (`angelo.jpg`, `tom.jpg`, `sebastian.jpg`, `jean-pierrer.jpg`).

## Límites que la interfaz declara siempre

* Un foco térmico es una anomalía detectada, no un incendio confirmado ni un perímetro.
* Nube y falta de dato no son ausencia de fuego: se muestran como cobertura, nunca como `0`.
* Los conteos no se suman entre sensores. Cada uno se compara contra su propio umbral estacional.
* La susceptibilidad es un índice cualitativo basado en reglas, sin validar contra incendios reales.
* La simulación de recorrido no predice dónde ni cuándo habrá un incendio ni sirve para decisiones operativas.

## Créditos de datos

* Focos activos: MODIS `MOD14A1.061` y `MYD14A1.061`, VIIRS `VNP14A1.002` (NASA LP DAAC) y focos NRT opcionales vía NASA FIRMS (`MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT` con `FIRMS_MAP_KEY`).
* Contexto ambiental y Fase 2 global: ERA5-Land (Copernicus/ECMWF), Copernicus DEM GLO-30 (`COPERNICUS_DEM_GLO30` para `2012–2026`), MapBiomas Perú / MINAM `CobVeg_180615.shp`, **Open-Meteo** (clima/viento actual y API de elevación Copernicus GLO-90), **Microsoft Planetary Computer** (`sentinel-2-l2a` para SAVI global) y **OpenStreetMap Nominatim** (geocodificación inversa administrativa).
* Mapas base: OpenStreetMap, OpenTopoMap (CC-BY-SA), Esri World Imagery.
