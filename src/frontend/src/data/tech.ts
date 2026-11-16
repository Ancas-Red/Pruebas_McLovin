export type TechCategory =
  | "todas"
  | "satelital"
  | "procesamiento"
  | "backend"
  | "frontend";

export type TechIconKey =
  | "satellite"
  | "viirs"
  | "gee"
  | "climate"
  | "python"
  | "api"
  | "cloud"
  | "react"
  | "map";

export interface TechItem {
  id: string;
  name: string;
  category: Exclude<TechCategory, "todas">;
  categoryLabel: string;
  summary: string;
  uses: string[];
  href: string;
  icon: TechIconKey;
}

export interface PipelineStage {
  step: string;
  title: string;
  layer: string;
  input: string;
  process: string;
  output: string;
}

export interface TechSpec {
  label: string;
  value: string;
  detail: string;
}

export const TECH_CATEGORIES: { id: TechCategory; label: string }[] = [
  { id: "todas", label: "All" },
  { id: "satelital", label: "Satellite & Climate" },
  { id: "procesamiento", label: "Processing" },
  { id: "backend", label: "Backend & Infra" },
  { id: "frontend", label: "Frontend & Maps" },
];

export const TECH_ITEMS: TechItem[] = [
  {
    id: "modis",
    name: "NASA MODIS Terra & Aqua",
    category: "satelital",
    categoryLabel: "Satellite",
    summary:
      "Daily thermal observation at 1 km using the MOD14A1 (Terra) and MYD14A1 (Aqua) products, without mixing or adding counts across sensors.",
    uses: [
      "FireMask bits 0–3 decoding: class 7 (low confidence) and classes 8–9 (nominal/high)",
      "Valid land-pixel filter using QA bits 0–1 == 2",
      "Independent daily observation_coverage calculation to discard cloudy days",
    ],
    href: "https://lpdaac.usgs.gov/products/mod14a1v061/",
    icon: "satellite",
  },
  {
    id: "viirs",
    name: "VIIRS Suomi-NPP (VNP14A1 / VNP21A1D)",
    category: "satelital",
    categoryLabel: "Satellite",
    summary:
      "Continuous reference sensor across the whole verified common window (2012-01-19 to 2026-11-02) with thermal hotspots and land surface temperature.",
    uses: [
      "Daily VNP14A1 detections and LST_1KM land surface temperature (VNP21A1D)",
      "Strict usable-day control: cloudiness < 30 % and valid_land_pixels > 0",
      "Explicit null (never 0) when there is not enough satellite coverage",
    ],
    href: "https://lpdaac.usgs.gov/products/vnp14a1v002/",
    icon: "viirs",
  },
  {
    id: "gee",
    name: "Google Earth Engine",
    category: "procesamiento",
    categoryLabel: "Geospatial",
    summary:
      "Cloud batch geospatial compute engine that reduces millions of satellite pixels to zonal tables by province and basin.",
    uses: [
      "Export in 2-year blocks in ucayali_common_window_export.js",
      "150 m water buffer combining JRC Global Surface Water and CobVeg",
      "ESA WorldCover v200 vegetation cover and INEI / ANA territorial aggregation",
    ],
    href: "https://earthengine.google.com/",
    icon: "gee",
  },
  {
    id: "era5-dem",
    name: "ERA5-Land, Open-Meteo & Copernicus DEM",
    category: "satelital",
    categoryLabel: "Climate & Terrain",
    summary:
      "Meteorological and topographic context for Phase 1 (ERA5-Land + GLO-30) and live global query (Open-Meteo + Sentinel-2 SAVI) in Phase 2.",
    uses: [
      "2 m temperature (t_amb_c), relative humidity and 10 m vector wind in ERA5-Land",
      "Copernicus DEM topography (GLO-30 in GEE and global GLO-90 via Open-Meteo Elevation, 10×10 grid)",
      "Hourly Open-Meteo wind and humidity (Forecast for recent dates, Archive for historical ones) and Sentinel-2 L2A SAVI index (Planetary Computer) in Phase 2",
    ],
    href: "https://cds.climate.copernicus.eu/",
    icon: "climate",
  },
  {
    id: "python-analytics",
    name: "Python 3.11 + Analytics Pipeline",
    category: "procesamiento",
    categoryLabel: "Analytics",
    summary:
      "Reproducible module in src/analytics/ that harmonizes the exported tables into daily indicators, seasonal anomalies and explainable rules.",
    uses: [
      "Rate normalization by observable usable area (detections_high_per_1000km2)",
      "Anomalies comparing each month against ≥ 5 years of historical baseline",
      "Contextual decision tree (levels N0–N3) decoupled from the HTTP server",
    ],
    href: "https://www.python.org/",
    icon: "python",
  },
  {
    id: "fastapi",
    name: "FastAPI + Uvicorn (/api/v1)",
    category: "backend",
    categoryLabel: "REST API",
    summary:
      "API in src/backend/: strictly read-only Phase 1 over JSON/GeoJSON and optional, decoupled global Phase 2 endpoints that query external live sources.",
    uses: [
      "Daily Phase 1 endpoints (date=YYYY-MM-DD, from/to) and strict null preservation",
      "Optional global Phase 2 routes, enabled by default (MCHANAQ_ENABLE_REALTIME=0 turns them off): /reverse-geocode (OSM Nominatim), /realtime/area (Open-Meteo + NASA FIRMS NRT hotspots) and /spread-simulate",
      "NRT hotspots with FIRMS_MAP_KEY or, if missing, with the public NASA FIRMS CSV feeds (10 min cache); lightweight pure-Python fallback (httpx + Open-Meteo DEM) if geopandas/numpy are unavailable",
    ],
    href: "https://fastapi.tiangolo.com/",
    icon: "api",
  },
  {
    id: "azure-cloudflare",
    name: "Cloudflare R2, Azure App Service & Cloudflare Pages",
    category: "backend",
    categoryLabel: "Infrastructure",
    summary:
      "Processed snapshots in Cloudflare R2, Linux API on Azure App Service (Premium v3, 8 GB RAM because of the national snapshot of 427 territories) and static frontend on Cloudflare Pages.",
    uses: [
      "Upload of the data/processed/ snapshot to Cloudflare R2 with r2_sync.py (boto3 only on the uploader's machine)",
      "Startup on Azure App Service (Python 3.11) with infra/azure/startup.sh, which downloads the snapshot from R2 if files are missing",
      "SPA distribution on Cloudflare Pages / Azure SWA pointing to VITE_API_BASE",
    ],
    href: "https://azure.microsoft.com/",
    icon: "cloud",
  },
  {
    id: "react-ts",
    name: "React 18 + TypeScript + Recharts",
    category: "frontend",
    categoryLabel: "Frontend",
    summary:
      "Web application built with Vite in strict typing, hash routing without heavy dependencies and comparative series charts.",
    uses: [
      "Continuous synchronization between the thermal calendar, the sensor selector and the territory card",
      "Historical charts with Recharts and automatic fallback to data/fixtures/",
      "Automated visual verification with Playwright on desktop (1440×900, 1280×720) and mobile",
    ],
    href: "https://react.dev/",
    icon: "react",
  },
  {
    id: "leaflet",
    name: "Leaflet + Free Cartography",
    category: "frontend",
    categoryLabel: "Cartography",
    summary:
      "Interactive geographic viewer based on open basemaps with no paid keys, with simplified official polygons that preserve topology.",
    uses: [
      "Free base layers: OpenStreetMap, OpenTopoMap (relief/hydrology) and Esri Imagery",
      "National territorial polygons: 196 INEI provinces and 231 ANA level-4 basins (427 in total, < 1 MB GeoJSON)",
      "One-click global simulation (Open-Meteo + DEM + SAVI), live NASA FIRMS NRT hotspots and OSM Nominatim administrative label",
    ],
    href: "https://leafletjs.com/",
    icon: "map",
  },
];

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    step: "01",
    title: "Batch Extraction",
    layer: "src/gee/",
    input: "MOD14A1 · MYD14A1 · VNP14A1 · ERA5-Land · COPERNICUS_DEM",
    process: "QA filtering, water masking (150 m) and zonal reduction per 2-year block.",
    output: "Intermediate CSV tables in data/intermediate/",
  },
  {
    step: "02",
    title: "Analytical Harmonization",
    layer: "src/analytics/",
    input: "Raw daily series + monthly environmental context + GEE manifest",
    process: "Normalized rates, persistence, monthly anomalies and N0–N3 contextual tree.",
    output: "JSON artifacts and territories.geojson in data/processed/",
  },
  {
    step: "03",
    title: "Cloud Bridge & API",
    layer: "infra/azure/ · src/backend/",
    input: "Processed snapshot published on Cloudflare R2",
    process: "FastAPI in read-only mode for Phase 1 (0 GEE queries per HTTP request); the optional Phase 2 queries Open-Meteo, Planetary Computer and NASA FIRMS NRT live.",
    output: "Daily REST contract /api/v1 and optional Phase 2 model",
  },
  {
    step: "04",
    title: "Territorial Viewer",
    layer: "src/frontend/",
    input: "/api/v1 responses (or data/fixtures/ as offline fallback)",
    process: "Usable-day calendar, per-sensor comparison and interactive Leaflet map.",
    output: "Traceable territorial evidence without confusing a hotspot with an ignition",
  },
];

export const TECH_SPECS: TechSpec[] = [
  {
    label: "Verified common window",
    value: "2012-01-19 → 2026-11-02",
    detail: "~14.8 years where Terra, Aqua, VIIRS S-NPP and ERA5-Land overlap. The published snapshot runs up to 2025-12; anything later is shown as live NRT hotspots (NASA FIRMS), without mixing it into the historical series.",
  },
  {
    label: "Cloudiness threshold",
    value: "< 30 % (≥ 0.70)",
    detail: "Only usable days with valid coverage over land are exposed.",
  },
  {
    label: "Water rule",
    value: "150 m buffer",
    detail: "Water bodies are discounted from effective vegetation (CobVeg / JRC GSW).",
  },
  {
    label: "Base gates (N0)",
    value: "Veg ≥ 0.20 · Slope ≥ 15 %",
    detail: "Minimum verifiable conditions of available fuel and terrain.",
  },
  {
    label: "Multi-sensor integrity",
    value: "No cross-sensor sums",
    detail: "Each sensor keeps its own separate series; null is never turned into 0.",
  },
  {
    label: "Seasonal baseline",
    value: "≥ 5 years minimum",
    detail: "Anomalies are evaluated against the same month of previous years with valid data.",
  },
];

export interface TechConvention {
  code: string;
  title: string;
  standard: string;
  description: string;
}

export const TECH_CONVENTIONS: TechConvention[] = [
  {
    code: "SUSC · 01",
    title: "Contextual susceptibility (High / Moderate / Low)",
    standard: "UNDRR · FAO · Copernicus EFFIS",
    description:
      "Following the international UNDRR/FAO and EFFIS hierarchy, “Susceptibility” describes how predisposed the environment is to an ignition (combustible vegetation, dryness < p25, wind > p75 and slope). It does not claim physical hazard (flame intensity) or risk (Hazard × Exposure × Vulnerability).",
  },
  {
    code: "N0 · 02",
    title: "Partial assessment and Not assessable",
    standard: "NASA FIRMS QA · OMM (Cobertura)",
    description:
      "If gate N0 detects a missing environmental block or fewer than 5 years for seasonal percentiles, but valid partial variables exist, “Partial assessment” (or “Not assessable” without evidence) is reported instead of imputing a definitive level.",
  },
  {
    code: "NULL · 03",
    title: "Observed zero vs. No observation / Not estimable",
    standard: "MODIS / VIIRS FireMask (Clases 7–9)",
    description:
      "“0” means a day observed with valid coverage (≥ 70 %) and zero nominal/high detections (classes 8–9). “No data” or “No observation” indicates nullity due to clouds or zero valid land pixels; “Not estimable” flags a baseline of < 5 years.",
  },
  {
    code: "SENS · 04",
    title: "No cross-sensor sums and provenance",
    standard: "NASA LP DAAC · Contrato McHanaq",
    description:
      "MODIS Terra (~10:30), MODIS Aqua (~13:30) and VIIRS S-NPP (~13:30) keep separate series because of resolution and overpass time. Every view explicitly separates observations from “/api/v1” from fallbacks of “Sample data”.",
  },
];

export interface PhaseGate {
  node: string;
  label: string;
  rule: string;
  outcome: string;
  tone: "acid" | "term" | "ember" | "muted";
}

export const PHASE1_TREE_GATES: PhaseGate[] = [
  {
    node: "N0",
    label: "Quality and baseline",
    rule: "Complete environmental blocks + ≥ 5 years for quantiles (p25 / p75)",
    outcome: "If it fails → Partially assessable or Not assessable (no false zeros)",
    tone: "muted",
  },
  {
    node: "N1",
    label: "Plant fuel",
    rule: "Effective vegetation ≥ 20.0 % (discounting water bodies)",
    outcome: "< 20 % → Low susceptibility (low)",
    tone: "term",
  },
  {
    node: "N2",
    label: "Seasonal dryness",
    rule: "precip_30d_mm < p25 or soil_moisture_surface < p25 for the same month",
    outcome: "Activates the dry branch (N3a) or the wet branch with terrain (N3b)",
    tone: "acid",
  },
  {
    node: "N3",
    label: "Wind, climate and water",
    rule: "Wind > p75, (T > p75 ∧ RH < p25) or slope ≥ 15 % + 150 m buffer",
    outcome: "High / Moderate / Low + water attenuation (-1 level if buf ≥ 5 %)",
    tone: "ember",
  },
];

export interface PhasePhysicalStep {
  code: string;
  title: string;
  source: string;
  detail: string;
}

export const PHASE2_SPREAD_STEPS: PhasePhysicalStep[] = [
  {
    code: "WIND",
    title: "Live wind and humidity",
    source: "Open-Meteo Forecast / Archive",
    detail:
      "Hourly 10 m wind (speed and direction) and relative humidity for the chosen date and point: they are no longer fixed interface values. Wind is only held fixed if the user sets it by hand; offline, a daytime ERA5 profile is used and the source is labeled.",
  },
  {
    code: "SAVI",
    title: "Fuel (Huete, 1988)",
    source: "Sentinel-2 L2A · Planetary Computer · L = 0.5",
    detail:
      "((NIR − RED) / (NIR + RED + 0.5)) × 1.5 over the best scene with < 35 % cloud from the previous 45 days, normalized to fuel load [0, 1] per cell. If no scene is available, a cover-calibrated SAVI is used and the source says so.",
  },
  {
    code: "DEM",
    title: "Terrain (Copernicus GLO-90)",
    source: "Open-Meteo Elevation · 10 × 10 grid",
    detail:
      "Elevation resampled and smoothed to the simulation grid; mean and maximum slope are derived from it and shown in the results panel.",
  },
  {
    code: "ROS",
    title: "Base speed and moisture (Rothermel)",
    source: "Fuel moisture (ext. 30 %)",
    detail:
      "head_ros_m_min rate quadratically damped by moisture (1 − M / 30 %)² and cover; fuel moisture is estimated from live relative humidity if not fixed.",
  },
  {
    code: "L/B",
    title: "Ellipse and terrain (Anderson · DEM)",
    source: "10 m wind · Copernicus DEM",
    detail:
      "Length/width ratio L/B ∈ [1.0, 8.0] coupled to exp(0.0693 · slope°): ×2 for every +10° uphill.",
  },
  {
    code: "1D-1Y",
    title: "Minimum front and isochrones",
    source: "/api/v1/spread-simulate",
    detail:
      "Cell-by-cell expansion over a chosen horizon — 1 day, 1 week, 1 month or 1 year, hypothetical conditions — with 6 · 12 · 24 · 36 · 48 h isochrones plus GIF, PNG infographics. The Python/GIS report (MP4 + QGIS Shapefiles .zip) stays fixed at 48 h.",
  },
];
