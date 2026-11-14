# McHanaq — Presentation Deck & 30-Second Video Script (NASA Space Apps 2026)

**Challenge:** *Harmonization of MODIS and VIIRS Hot Spots*
**Team:** Los McLovin — Peru
**Format:** 7-slide deck (English primary submission text + Spanish presenter notes) and 30-second video script alternative.

> **Presentation Rule (v1.7 §15 & §19.3):** Never present `data/fixtures/` as real observations. Insert real Ucayali numerical examples only after Angelo and Tom verify the exported `data/processed/` outputs; keep explicit `[PENDING VERIFIED UCAYALI EXPORT]` markers anywhere final CSV numbers are not yet locked.

---

## Part A — 7-Slide Deck Outline

### Slide 1 — Opening: A Harmonized Burning Activity Calendar by Territory
**Headline:** *Beyond Raw Dots: A Harmonized Burning Activity Calendar for MODIS and VIIRS*

* **Visual:** Hero screenshot of McHanaq's **Burning Activity Calendar** view (`#/mapa`, Cividis colorblind-safe heatmap by month × year) for a selected Peruvian province and hydrographic unit (`province` / `hydro_unit` selector visible).
* **Core Message:**
  * NASA satellites have tracked active thermal anomalies for over two decades, yet **MODIS Terra (`MOD14A1`), MODIS Aqua (`MYD14A1`), and VIIRS S-NPP (`VNP14A1`)** cannot be summed directly into a single count due to different spatial supports, overpass times (~10:30 vs. ~13:30), and detection algorithms.
  * **McHanaq** transforms fragmented daily hotspots into a **traceable territorial burning activity calendar** across administrative provinces (INEI) and hydrographic basins (ANA Pfafstetter), paired with observation quality and contextual environmental conditions.
* **Notas del presentador (ES):**
  * Abrir directamente mostrando el **calendario de actividad térmica** (no un índice de propagación).
  * Plantear la pregunta central: *¿Cuándo la actividad térmica de una provincia o cuenca es realmente inusual para esa época del año, y cuánta superficie pudo observar el satélite sin nubes?*

---

### Slide 2 — Methodological Core: Semantic, Temporal & Statistical Harmonization
**Headline:** *Why Observation Coverage & `null != 0` Matter as Much as Detections*

* **Visual:** Pipeline diagram showing daily QA filtering → `<30%` cloud mask → normalized rate & `robust_z` anomaly formula.
* **Key Points:**
  * **Strict QA Separation:** Extracts `FireMask` bits `0–3` (keeping classes `8–9` nominal/high confidence for primary metrics and class `7` separately for sensitivity) and `QA` bits `0–1 == 2` (valid land pixels only).
  * **Cloud Filter (`< 30%` clouds):** Daily `activity_rate` and `t_suelo_c` (LST) require `observation_coverage >= 0.70` (`lst_valid_pixel_pct >= 70%`). Unobserved or cloudy days remain `null` (*"Sin observación"*) — **never `0`**.
  * **Normalized Monthly Metrics (`/calendar` & `/summary`):**
    * `activity_rate = fire_pixel_days_8_9 / valid_land_pixel_days` (dimensionless frequency, not burned area or fire probability).
    * Persistence via `active_days` and `max_consecutive_active_days` (broken by unobserved days).
    * **Seasonal Anomaly (`robust_z`):** `(rate - median) / (1.4826 * MAD)` compared strictly against the same calendar month and same sensor with `min_baseline_years = 5`.
* **Notas del presentador (ES):**
  * Recalcar que «armonizar» en nuestro MVP significa **armonización semántica, temporal y estadística**, no calibración radiométrica.
  * Destacar que un día nublado sin datos nunca se convierte en «cero fuego» (`null != 0`).

---

### Slide 3 — Multisensor Comparison Without Summing Counts
**Headline:** *Comparing MODIS Terra, MODIS Aqua & VIIRS Side-by-Side — Never Summing Raw Counts*

* **Visual:** Screenshot of McHanaq's **Multisensor Comparison** panel (`/sensor-comparison`) showing separate rows for `MODIS_TERRA`, `MODIS_AQUA`, and `VIIRS_SNPP` with their own `activity_rate`, `observation_coverage`, `historical_anomaly`, and qualitative concordance badge.
* **Key Points:**
  * Each sensor keeps its own denominator (`valid_land_pixel_days`) and seasonal baseline.
  * Backend computes a transparent qualitative concordance status across sensors in the common analysis window:
    * `concordant_elevated` · `concordant_not_elevated` · `discordant` · `single_sensor` · `insufficient`
  * Helps analysts distinguish genuine elevated burning seasons from single-sensor artifacts, cloud gaps, or morning vs. afternoon overpass differences.
* **Notas del presentador (ES):**
  * Explicar la regla innegociable: **nunca sumamos conteos entre MODIS Terra, MODIS Aqua y VIIRS**.
  * Mostrar cómo una discrepancia (`discordant`) entre Terra (~10:30) y VIIRS (~13:30) orienta la revisión técnica en vez de ocultarse en un promedio opaco.

---

### Slide 4 — Architecture & NASA Challenge Resources Credit
**Headline:** *Reproducible Open-Data Pipeline: From Google Earth Engine to Read-Only API*

* **Visual:** Clean 4-stage architecture flow:
  `GEE (src/gee/)` → `Python Analytics (src/analytics/)` → `Read-Only FastAPI /api/v1 (src/backend/)` → `React + TypeScript + Leaflet UI (src/frontend/)`
* **NASA Challenge Resources & Open Data Credits:**
  * **NASA Challenge Resources (MODIS & VIIRS Active Fire / Thermal Products):**
    * `MODIS/061/MOD14A1` (MODIS Terra Thermal Anomalies & Fire Daily 1 km, since `2000-02-24`)
    * `MODIS/061/MYD14A1` (MODIS Aqua Thermal Anomalies & Fire Daily 1 km, since `2002-07-04`)
    * `NASA/VIIRS/002/VNP14A1` / `NOAA/VIIRS/001/VNP14A1` (VIIRS S-NPP Thermal Anomalies & Fire Daily 1 km, since `2012-01-19`)
    * `MODIS/061/MOD11A1` / `MYD11A1` & `VNP21A1D` (Daily Land Surface Temperature, 1 km)
    * `MODIS/061/MOD13A3` (Monthly Vegetation Indices NDVI/EVI, 1 km)
  * **Complementary Open Sources:** `ECMWF/ERA5_LAND/DAILY_AGGR` (~11.1 km meteorology: 2 m temp, dewpoint → Magnus-Tetens RH, vector u/v wind, 30-day precip, soil moisture), `COPERNICUS/DEM/GLO30` (`COPERNICUS_DEM_GLO30` 30 m DEM across the verified `2012–2026` common window; pre-2012 `NASADEM` archived as out-of-scope legacy note), MINAM Cobertura Vegetal 2015 (`CobVeg_180615.shp`), INEI 2023 provinces, ANA Pfafstetter level-4 hydrographic units, and API-key-free basemaps (OpenStreetMap, OpenTopoMap CC-BY-SA, Esri World Imagery).
* **Notas del presentador (ES):**
  * Resaltar la separación de responsabilidades: el frontend no calcula, la API es de solo lectura sobre `data/processed/`, desplegada en **Microsoft Azure Free Tier** (**Azure Static Web Apps Plan Free** + **Azure App Service Plan Free F1**), con **Azure Blob Storage** como puente offline/build-time de artefactos (GEE exporta inicialmente a Drive/GCS y se espeja a Azure Blob Storage; nunca se consulta GEE ni almacenamiento externo en runtime).
  * Citar expresamente al menos un dataset de la pestaña *Resources* del reto NASA (`MOD14A1`, `MYD14A1`, `VNP14A1`).

---

### Slide 5 — Ucayali Pilot Walkthrough & Contextual Susceptibility Tree
**Headline:** *Pilot Walkthrough: Ucayali, Peru (4 Provinces & 20 Hydrographic Units)*

* **Visual:** Ucayali map choropleth (`data/processed/territories.geojson`) + Territory Summary Card showing `daily` meteorology, monthly `/calendar` anomaly, and the transparent `N0..N3b` decision path.
* **Verified Pilot Configuration:**
  * **Territories (`24` total, strictly separated by `territory_type`):**
    * `4` INEI Provinces: Coronel Portillo (`2501`), Atalaya (`2502`), Padre Abad (`2503`), Purús (`2504`).
    * `20` ANA Pfafstetter Level-4 Hydrographic Units (e.g., Cuenca Tarau `4964`, Intercuenca Alto Yurúa `4969`, Intercuenca Alto Iaco `49289`).
  * **Temporal Coverage Verified in GEE (`src/gee/gee_verified_dates.json`):**
    * Verified multisensor common window: **`2012-01-19` to `2026-11-02`** (last complete common month: **`2026-10`**, ~14.8 years > 5-year minimum baseline, using `COPERNICUS_DEM_GLO30`), where `MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP`, and `ERA5-Land` coincide. Metadata exposes only useful recorded days (`valid_land_pixels > 0`, `< 30 %` clouds / `observation_coverage >= 0.70`, non-null `activity_rate`).
  * **Contextual Susceptibility Tree (`N0..N3b` — Qualitative Interpretation Layer):**
    * Uses MINAM `CobVeg_180615.shp` fuel definition (`umbral_veg = 20%`), Copernicus DEM slope (`umbral_pend = 15%`), ERA5-Land seasonal p25/p75 thresholds, and a **150 m surface-water buffer rule** (`water_buffer_150m_pct >= 5%` attenuates `high` → `moderate` with full `decision_path` traceability).
    * Optional, decoupled **Phase 2 Explorer** (`heuristic_wind_slope_spread_v1`) visualizes hypothetical `+6h / +12h / +24h` isochrones without touching Phase 1 endpoints.
  * **Verified Pilot Finding Placeholder:** `[INSERT VERIFIED UCAYALI MONTH/TERRITORY CASE STUDY AFTER FINAL GEE CSV EXPORT]`
* **Notas del presentador (ES):**
  * Recorrer un caso real de Ucayali (provincia o unidad hidrográfica) apenas Tom y Angelo confirmen las cifras finales procesadas.
  * Mostrar la trazabilidad del árbol (`N0:pass → N1:yes → N2:yes → N3a:...` y la regla de buffer hídrico de `150 m`), dejando claro que es contexto descriptivo y no predicción de propagación.

---

### Slide 6 — Scientific Integrity, Limitations & Demo Plan B
**Headline:** *Transparent Boundaries: What McHanaq Shows — and What It Refuses to Claim*

* **Visual:** Two-column card: **Explicit Scientific Limits** vs. **Operational Demo Plan B**.
* **Scientific Limitations (Always Visible in UI & `/metadata`):**
  * Thermal hotspots are radiometric anomalies, **not** confirmed fire perimeters or burned hectares.
  * Cloud cover and satellite geometry can hide fires (`null != 0`).
  * MODIS and VIIRS differ in overpass schedule, resolution, and sensitivity — semantic/statistical harmonization is **not** radiometric calibration.
  * Contextual susceptibility (`high` / `moderate` / `low` / `partial` / `not_evaluable`) is qualitative and unvalidated against observed fire spread; McHanaq does **not** predict ignitions or replace emergency dispatch authorities.
* **Demo Plan B (Live Fail-Safe):**
  1. **Primary:** Live frontend on **Azure Static Web Apps (Free)** connected to read-only FastAPI on **Azure App Service (Plan Free F1)** reading local verified `data/processed/` JSONs synced from Azure Blob Storage at build/deploy time (zero external GEE/Blob/Drive dependency at runtime).
  2. **Plan B-1 (Backend offline):** Run local `uvicorn src.backend.app.main:app` with `MCHANAQ_DATA_DIR=data/processed` (offline snapshot) or `data/fixtures` (clearly labeled `"Datos de muestra"` / `"fixture"`).
  3. **Plan B-2 (Browser/host fallback):** Pre-captured screenshots from the verified running prototype, explicitly labeled by data origin.
* **Notas del presentador (ES):**
  * Reconocer límites aumenta la credibilidad ante el jurado (*Validity*).
  * En caso de fallo de red o API en vivo, el Plan B garantiza continuidad sin jamás presentar fixtures como si fueran observaciones reales.

---

### Slide 7 — Impact, Target Audience & Open Deliverables
**Headline:** *From Historical Hotspots to Actionable Seasonal Context*

* **Visual:** Summary of target users, public repository structure, and next steps (`2012–2026` national multisensor scaling).
* **Who Benefits & How:**
  * **Regional land & environmental managers (e.g., Ucayali):** Identify recurring critical months and separate cloud-gap years from genuine anomalies across provinces and watersheds.
  * **Scientists & monitoring teams:** Audit sensor agreement/discrepancy (`MODIS_TERRA` / `MODIS_AQUA` / `VIIRS_SNPP`), download clean daily CSVs with explicit `null` cells, and inspect rule-tree evidence with source resolutions.
* **Open & Reproducible Deliverables:**
  * Public repository with locked API contract (`contracts/api-contract.md`), automated acceptance test suite (`tests/acceptance/test_mvp_acceptance.py`), full dataset attributions, and transparent AI disclosure (`AI_USAGE.md`).
  * **Next Step:** Extend the verified GEE batch export across the `2012–2026` common multisensor window for all Peruvian departments and hydrographic units (hosted on Microsoft Azure Free Tier).
* **Notas del presentador (ES):**
  * Cerrar conectando con el reto: McHanaq no compite con FIRMS como otro visor de puntos; aporta lectura territorial histórica, calidad explícita y comparación multisensor trazable.

---

## Part B — 30-Second Video Script (Alternative Submission Format)

**Target duration:** 30 seconds (~70–75 words spoken at clear pace).
**Language:** English audio/captions (with Spanish cues for rehearsal).

| Time | Visual on Screen | Spoken Narration (EN) | Nota de ensayo (ES) |
|---|---|---|---|
| **00–05 s** | Open directly on McHanaq's **Burning Activity Calendar** heatmap (Cividis) for Ucayali, switching between `province` and `hydro_unit`. | "NASA's MODIS and VIIRS satellites track fires for over twenty years, but you cannot simply add their raw hotspot counts together." | Arrancar directo en el calendario térmico (no en propagación). |
| **05–12 s** | Click a Ucayali territory; show `<30%` cloud filter, `null` ("Sin observación") vs. `0`, and monthly `robust_z` anomaly with `baseline_years`. | "McHanaq harmonizes Terra, Aqua, and VIIRS into a territorial burning activity calendar—normalizing by cloud-free observations so missing data is never treated as zero fire." | Mostrar que nube/falta de dato es `null`, nunca `0`, y destacar la anomalía estacional. |
| **12–20 s** | Open the **Multisensor Comparison** panel (`MODIS_TERRA`, `MODIS_AQUA`, `VIIRS_SNPP` side-by-side with concordance status). | "Instead of merging counts, McHanaq keeps each sensor's baseline separate and flags when signals agree or diverge across provinces and watersheds." | Resaltar las tres series separadas y la etiqueta de concordancia/discrepancia. |
| **20–26 s** | Expand **Contextual Susceptibility** (`N0..N3b` path, `CobVeg_180615.shp` fuel, 150 m water buffer attenuation, ERA5-Land, DEM). | "An interpretable rule tree adds environmental context—vegetation fuel, dryness, wind, slope, and a 150-meter water buffer—without claiming to predict ignitions." | Mostrar ruta de decisión transparente y aclarar que no predice igniciones. |
| **26–30 s** | End card: McHanaq logo/UI, NASA MODIS/VIIRS + Copernicus/INEI/ANA credits, and open repository URL. | "McHanaq: transparent, reproducible fire history from NASA Earth observations." | Cierre limpio con créditos de datasets NASA y enlace público. |
