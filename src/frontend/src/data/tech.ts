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
  { id: "todas", label: "Todas" },
  { id: "satelital", label: "Satelital y Clima" },
  { id: "procesamiento", label: "Procesamiento" },
  { id: "backend", label: "Backend e Infra" },
  { id: "frontend", label: "Frontend y Mapas" },
];

export const TECH_ITEMS: TechItem[] = [
  {
    id: "modis",
    name: "NASA MODIS Terra & Aqua",
    category: "satelital",
    categoryLabel: "Satelital",
    summary:
      "Observación térmica diaria a 1 km mediante los productos MOD14A1 (Terra) y MYD14A1 (Aqua), sin mezclar ni sumar conteos entre sensores.",
    uses: [
      "Decodificación de FireMask bits 0–3: clase 7 (baja confianza) y clases 8–9 (nominal/alta)",
      "Filtro de píxeles válidos en tierra firme mediante QA bits 0–1 == 2",
      "Cálculo independiente de observation_coverage diario para descartar días nubosos",
    ],
    href: "https://lpdaac.usgs.gov/products/mod14a1v061/",
    icon: "satellite",
  },
  {
    id: "viirs",
    name: "VIIRS Suomi-NPP (VNP14A1 / VNP21A1D)",
    category: "satelital",
    categoryLabel: "Satelital",
    summary:
      "Sensor de referencia continua en toda la ventana común verificada (2012-01-19 a 2026-11-02) con focos térmicos y temperatura superficial del suelo.",
    uses: [
      "Detecciones diarias VNP14A1 y temperatura superficial LST_1KM (VNP21A1D)",
      "Control estricto de días útiles: nubosidad < 30 % y valid_land_pixels > 0",
      "Anulación explícita a null (nunca 0) cuando no hay cobertura satelital suficiente",
    ],
    href: "https://lpdaac.usgs.gov/products/vnp14a1v002/",
    icon: "viirs",
  },
  {
    id: "gee",
    name: "Google Earth Engine",
    category: "procesamiento",
    categoryLabel: "Geoespacial",
    summary:
      "Motor de cómputo geoespacial batch en nube encargado de reducir millones de píxeles satelitales a tablas zonales por provincia y cuenca.",
    uses: [
      "Exportación por bloques de 2 años en ucayali_common_window_export.js",
      "Buffer hídrico de 150 m combinando JRC Global Surface Water y CobVeg",
      "Cobertura vegetal ESA WorldCover v200 y agregación territorial INEI / ANA",
    ],
    href: "https://earthengine.google.com/",
    icon: "gee",
  },
  {
    id: "era5-dem",
    name: "ECMWF ERA5-Land & Copernicus DEM",
    category: "satelital",
    categoryLabel: "Clima y Terreno",
    summary:
      "Contexto meteorológico diario y topografía única a 30 m (COPERNICUS/DEM/GLO30) para caracterizar sequedad, viento y pendiente del terreno.",
    uses: [
      "Temperatura ambiente a 2 m (t_amb_c) y humedad relativa vía Magnus-Tetens",
      "Promedio vectorial diario de viento a 10 m (wind_dir_deg y wind_speed_10m_ms)",
      "Elevación, pendiente y exposición de ladera sobre toda la ventana 2012–2026",
    ],
    href: "https://cds.climate.copernicus.eu/",
    icon: "climate",
  },
  {
    id: "python-analytics",
    name: "Python 3.11 + Pipeline Analítico",
    category: "procesamiento",
    categoryLabel: "Analítica",
    summary:
      "Módulo reproducible en src/analytics/ que armoniza las tablas exportadas en indicadores diarios, anomalías estacionales y reglas explicables.",
    uses: [
      "Normalización de tasas por área útil observable (detections_high_per_1000km2)",
      "Anomalías comparando cada mes contra ≥ 5 años de línea base histórica",
      "Árbol de decisión contextual (niveles N0–N3) desacoplado del servidor HTTP",
    ],
    href: "https://www.python.org/",
    icon: "python",
  },
  {
    id: "fastapi",
    name: "FastAPI + Uvicorn (/api/v1)",
    category: "backend",
    categoryLabel: "API REST",
    summary:
      "Backend en src/backend/ estrictamente de solo lectura: sirve artefactos JSON/GeoJSON precomputados sin ejecutar consultas externas por petición.",
    uses: [
      "Endpoints diarios por defecto (date=YYYY-MM-DD, from/to) y comparativa multisensor",
      "Preservación estricta de null en fechas sin observación útil y cabeceras HTTP limpias",
      "Pruebas de contrato e integración con pytest + httpx y simulación opcional en Fase 2",
    ],
    href: "https://fastapi.tiangolo.com/",
    icon: "api",
  },
  {
    id: "azure-cloudflare",
    name: "Microsoft Azure Free Tier & Cloudflare",
    category: "backend",
    categoryLabel: "Infraestructura",
    summary:
      "Arquitectura de despliegue sin costos operativos con puente de datos en Azure Blob Storage, API Linux en App Service y frontend estático.",
    uses: [
      "Sincronización de snapshots procesados vía azure_sync.py hacia Azure Blob Storage",
      "Arranque en Azure App Service (Plan Free F1, Python 3.11) con infra/azure/startup.sh",
      "Distribución SPA en Cloudflare Pages / Azure SWA apuntando a VITE_API_BASE",
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
      "Aplicación web compilada con Vite en tipado estricto, enrutamiento por hash sin dependencias pesadas y gráficos de series comparativas.",
    uses: [
      "Sincronización continua entre calendario térmico, selector de sensor y ficha territorial",
      "Gráficos históricos comparativos y resumen diario con Recharts",
      "Modo de contingencia automático sobre data/fixtures/ cuando no hay API activa",
    ],
    href: "https://react.dev/",
    icon: "react",
  },
  {
    id: "leaflet",
    name: "Leaflet + Cartografía Libre",
    category: "frontend",
    categoryLabel: "Cartografía",
    summary:
      "Visor geográfico interactivo basado en mapas base abiertos sin claves de pago, con polígonos oficiales simplificados preservando topología.",
    uses: [
      "Capas base libres: OpenStreetMap, OpenTopoMap (relieve/hidrología) y Esri Imagery",
      "Polígonos territoriales de 4 provincias y 20 cuencas ANA (< 1 MB GeoJSON)",
      "Dibujo interactivo de área de interés y simulación de propagación sobre pendiente/viento",
    ],
    href: "https://leafletjs.com/",
    icon: "map",
  },
];

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    step: "01",
    title: "Extracción Batch",
    layer: "src/gee/",
    input: "MOD14A1 · MYD14A1 · VNP14A1 · ERA5-Land · COPERNICUS_DEM",
    process: "Filtrado QA, enmascaramiento hídrico (150 m) y reducción zonal por bloque de 2 años.",
    output: "Tablas CSV intermedias en data/intermediate/",
  },
  {
    step: "02",
    title: "Armonización Analítica",
    layer: "src/analytics/",
    input: "Series diarias crudas + contexto ambiental mensual + manifest GEE",
    process: "Tasas normalizadas, persistencia, anomalías mensuales y árbol contextual N0–N3.",
    output: "Artefactos JSON y territories.geojson en data/processed/",
  },
  {
    step: "03",
    title: "Puente Nube y API",
    layer: "infra/azure/ · src/backend/",
    input: "Snapshot procesado sincronizado en Azure Blob Storage",
    process: "FastAPI en modo solo lectura (0 consultas a GEE en tiempo de petición HTTP).",
    output: "Contrato REST diario /api/v1 y modelo opcional Fase 2",
  },
  {
    step: "04",
    title: "Visor Territorial",
    layer: "src/frontend/",
    input: "Respuestas /api/v1 (o data/fixtures/ en contingencia offline)",
    process: "Calendario de días útiles, comparativa por sensor y mapa Leaflet interactivo.",
    output: "Evidencia territorial trazable sin confundir foco con ignición",
  },
];

export const TECH_SPECS: TechSpec[] = [
  {
    label: "Ventana común verificada",
    value: "2012-01-19 → 2026-11-02",
    detail: "~14.8 años continuos donde coinciden Terra, Aqua, VIIRS S-NPP y ERA5-Land.",
  },
  {
    label: "Umbral de nubosidad",
    value: "< 30 % (≥ 0.70)",
    detail: "Solo se exponen días útiles con cobertura válida sobre tierra firme.",
  },
  {
    label: "Regla hídrica",
    value: "Buffer de 150 m",
    detail: "Descuento de cuerpos de agua sobre vegetación efectiva (CobVeg / JRC GSW).",
  },
  {
    label: "Compuertas base (N0)",
    value: "Veg ≥ 0.20 · Pend ≥ 15 %",
    detail: "Condiciones mínimas verificables de combustible disponible y relieve.",
  },
  {
    label: "Integridad multisensor",
    value: "Cero suma cruzada",
    detail: "Cada sensor conserva su serie separada; null jamás se convierte en 0.",
  },
  {
    label: "Línea base estacional",
    value: "≥ 5 años mínimos",
    detail: "Anomalías evaluadas contra el mismo mes de años previos con datos válidos.",
  },
];
