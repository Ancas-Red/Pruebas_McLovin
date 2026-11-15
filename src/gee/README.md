# McHanaq — Pipeline GEE (`src/gee/`)

Scripts de Google Earth Engine (GEE) para exportar las tablas diarias y mensuales de Ucayali sobre la **ventana común multisensor verificada** hacia `data/intermediate/`:

## Flujo de datos y puente en nube (Google Drive → Local → Azure Blob Storage)

1. **Exportación desde GEE (`Export.table.toDrive`):** por limitación nativa de Google Earth Engine para tablas vectoriales/CSV (`Export.table.toDrive`), GEE exporta los CSVs a Google Drive.
2. **Staging local (`data/intermediate/`):** los CSVs descargados de Google Drive se colocan en `data/intermediate/` y se procesan localmente con `python -m src.analytics.run_pipeline` para generar `data/processed/*.json`.
3. **Puente de producción en nube (Azure Blob Storage):** en reemplazo de Google Drive como almacenamiento en la nube para despliegue, los artefactos procesados (`data/processed/`) —y opcionalmente respaldos de CSVs intermedios— se suben a **Azure Blob Storage** (Free Tier) mediante `python -m src.analytics.azure_sync upload`, y el backend en Azure App Service (Free F1) opera en modo solo lectura sobre `data/processed/` (sin llamadas por petición a GEE ni a la nube).

## Ventana común multisensor verificada (decisión vigente)

* **Decisión operativa:** **ya no se exportan bloques pre-2012 (`2000–2011`)**. El pipeline se enfoca estrictamente en la ventana común multisensor verificada **`2012-01-19` a `2026-11-02`** (último mes completo común: **`2026-10`**; ver `gee_verified_dates.json` y `check_common_dates.js`), donde coinciden simultáneamente `MODIS_TERRA` (`MOD14A1`), `MODIS_AQUA` (`MYD14A1`), `VIIRS_SNPP` (`VNP14A1`) y `ERA5-Land`, cubriendo ~14.8 años (> mínimo de `5` años de línea base).
* **DEM único en ventana común:** `COPERNICUS/DEM/GLO30` (`COPERNICUS_DEM_GLO30`, 30 m).

### Estrategias oficiales de exportación en `ucayali_common_window_export.js`

El script `ucayali_common_window_export.js` configura `EXPORT_PRESET` con las 3 estrategias oficiales dentro de `[2012-01-19, 2026-11-03)` (límite superior exclusivo para incluir `2026-11-02`):

1. **Prueba rápida (`EXPORT_PRESET = 'quick_test'`):** `'2024-01-01'` a `'2026-11-03'`.
2. **Mínimo de línea base de 5+ años (`EXPORT_PRESET = 'baseline_5yr_min'`):** `'2018-01-01'` a `'2026-11-03'`.
3. **Ventana común completa en bloques de 2 años:**
   * `'block_2012_2014'`: `'2012-01-19'` .. `'2014-01-01'`
   * `'block_2014_2016'`: `'2014-01-01'` .. `'2016-01-01'`
   * `'block_2016_2018'`: `'2016-01-01'` .. `'2018-01-01'`
   * `'block_2018_2020'`: `'2018-01-01'` .. `'2020-01-01'`
   * `'block_2020_2022'`: `'2020-01-01'` .. `'2022-01-01'`
   * `'block_2022_2024'`: `'2022-01-01'` .. `'2024-01-01'`
   * `'block_2024_2026'`: `'2024-01-01'` .. `'2026-11-03'` (cubre hasta `2026-11-02`)

## Scripts base y parámetros del piloto Ucayali

1. **`hotspots_pipeline.js`** / sección 2 de **`ucayali_common_window_export.js`** → exporta actividad diaria por sensor (`MODIS_TERRA` `MOD14A1`, `MODIS_AQUA` `MYD14A1`, `VIIRS_SNPP` `VNP14A1`) sin sumar conteos entre sensores:
   * `FireMask` bits `0–3` (`bitwiseAnd(15)`): clase `7` (baja confianza) y clases `8–9` (nominal/alta).
   * `QA` bits `0–1` (`bitwiseAnd(3) == 2` para tierra firme).
   * `observation_coverage = valid_land_pixels / expected_land_pixels_per_day` (control `< 30 %` nubes = `>= 0.70`).
2. **`environmental_daily.js`** / sección 3 de **`ucayali_common_window_export.js`** → exporta clima diario:
   * **`t_amb_c`:** `temperature_2m - 273.15` (`ECMWF/ERA5_LAND/DAILY_AGGR`).
   * **`relative_humidity_2m_pct`:** ecuación de Magnus-Tetens usando `temperature_2m` y `dewpoint_temperature_2m`.
   * **`t_suelo_c` + `lst_valid_pixel_pct`:** `MODIS/061/MOD11A1` (`LST_Day_1km`, `QC_Day` bits `0–1 == 0`) y `NOAA/VIIRS/001/VNP21A1D` (`LST_1KM`, `QC`), aplicando `valor * 0.02 - 273.15`. Se invalida (`null`) si `lst_valid_pixel_pct < 70` (`>= 30 %` nubes).
   * **`wind_dir_deg` + `wind_speed_10m_ms`:** promedio diario vectorial de `u_component_of_wind_10m` y `v_component_of_wind_10m` antes de calcular `atan2(-u, -v) * 180 / π + 360 % 360`.
   * **`elevation_m` + `dem_source`:** `COPERNICUS/DEM/GLO30` (`COPERNICUS_DEM_GLO30`) para toda la ventana común `2012-01-19`..`2026-11-02`.

**Nota de catálogo VIIRS (`NOAA/VIIRS/001` vs `NASA/VIIRS/002`):**
* En `gee_verified_dates.json` y `ucayali_common_window_export.js` se utilizan `NOAA/VIIRS/001/VNP14A1` y `NOAA/VIIRS/001/VNP21A1D`, verificados activos en GEE desde `2012-01-19` hasta `2026-11-02`.
* Los scripts genéricos (`hotspots_pipeline.js`, `environmental_daily.js`) referencian `NASA/VIIRS/002/*` (Colección 2 de NASA LP DAAC). Ambos producen las mismas bandas (`FireMask`/`QA` y `LST_1KM`/`QC`).

## Piloto Ucayali y regla del buffer de agua de 150 m

* **Parámetros piloto Ucayali:** toda vegetación (`umbral_veg = 0.20`), `umbral_pend = 0.15` (15 %), nubosidad `< 30 %` (`>= 0.70`), mínimo `5` años de línea base.
* **Regla del buffer de agua de 150 m:**
  * En capas locales (`prepare_ucayali_layers.py`), se genera un buffer de `150 m` alrededor de cuerpos de agua de `CobVeg_180615.shp` (`Río`, `Lagunas, lagos y cochas`) y se descuentan de la vegetación (`effective_veg_fraction`) para distritos/provincias.
  * En GEE (`ucayali_common_window_export.js`, sección 4 `monthlyContext`), para que **todos** los territorios (`4` provincias y `20` unidades hidrográficas `hydro_unit`) cuenten con cobertura sin fallar la compuerta `N0`, se combina `ESA/WorldCover/v200` + `JRC/GSW1_4/GlobalSurfaceWater` (`occurrence >= 50` con `focalMax` de `150 m`) + pendiente/aspecto de `COPERNICUS/DEM/GLO30`.
* **Scripts Ucayali:**
  * `prepare_ucayali_layers.py` → filtra INEI 2023 + ANA UH + `CobVeg_180615.shp` a Ucayali, genera `data/processed/territories.geojson` simplificado (`0.0008°`, preservando topología, `< 1 MB`), `data/processed/ucayali_territories.geojson` completo y `data/processed/ucayali_districts_static.csv`.
  * `ucayali_common_window_export.js` → exporta terreno estático (`COPERNICUS/DEM/GLO30`), focos diarios (`MOD14A1`, `MYD14A1`, `VNP14A1`), clima/LST/elevación diaria y contexto mensual completo (`N0..N3`) para provincias y cuencas dentro de `2012-01-19`..`2026-11-02`.

## Respaldo FIRMS Country Yearly Summary — Perú (`src/gee/firms_peru/`)

Tablas CSV puntuales de anomalías térmicas descargadas de **NASA LANCE FIRMS** (*Country Yearly Summary*, Standard Processing) filtradas para **Perú**. No son imágenes raster satelitales, sino registros tabulares de focos de calor (`latitude`, `longitude`, `acq_date`, `acq_time`, `frp`, `confidence`, `daynight`, etc.):

* **`src/gee/firms_peru/modis/`**: `modis_2000_Peru.csv` .. `modis_2025_Peru.csv` (**26 archivos**, serie 2000–2025).
* **`src/gee/firms_peru/viirs-snpp/`**: `viirs-snpp_2012_Peru.csv` .. `viirs-snpp_2025_Peru.csv` (**14 archivos**, serie completa 2012–2025).
* **`src/gee/firms_peru/viirs-jpss1/`**: `viirs-jpss1_2018_Peru.csv` .. `viirs-jpss1_2025_Peru.csv` (**8 archivos**, VIIRS NOAA-20, serie 2018–2025).

*(Las carpetas globales crudas `MODIS/`, `VIRS/` y los archivos `*.zip` permanecen excluidos en `.gitignore`; únicamente se versionan los CSV de Perú bajo `src/gee/firms_peru/`).*

* **Conversión local a actividad diaria nacional (`src/analytics/firms_to_daily_activity.py`):** para evitar límites de memoria (`Error code: 8`) en `reduceRegions` de GEE al agregar los `427` territorios del Perú (`data/processed/peru_territories.geojson`, generado con `src/gee/prepare_peru_layers.py`), el script `python -m src.analytics.firms_to_daily_activity --firms-dir src/gee/firms_peru --territories data/processed/peru_territories.geojson --out data/intermediate/daily_activity_firms.csv` realiza el join espacial localmente sobre `modis/` y `viirs-snpp/` dentro de la ventana operativa `2012-01-19`..`2026-11-02`.
