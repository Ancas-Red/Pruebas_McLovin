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
    name: "ERA5-Land, Open-Meteo & Copernicus DEM",
    category: "satelital",
    categoryLabel: "Clima y Terreno",
    summary:
      "Contexto meteorológico y topográfico para Fase 1 (ERA5-Land + GLO-30) y consulta global en vivo (Open-Meteo + Sentinel-2 SAVI) en Fase 2.",
    uses: [
      "Temperatura a 2 m (t_amb_c), humedad relativa y viento vectorial a 10 m en ERA5-Land",
      "Topografía Copernicus DEM (GLO-30 en GEE y GLO-90 global vía Open-Meteo Elevation, malla 10×10)",
      "Viento y humedad horarios Open-Meteo (Forecast para fechas recientes, Archive para históricas) e índice SAVI Sentinel-2 L2A (Planetary Computer) en Fase 2",
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
      "API en src/backend/: Fase 1 estrictamente de solo lectura sobre JSON/GeoJSON y endpoints globales opcionales de Fase 2 desacoplados que consultan fuentes externas en vivo.",
    uses: [
      "Endpoints diarios de Fase 1 (date=YYYY-MM-DD, from/to) y preservación estricta de null",
      "Rutas globales opcionales de Fase 2, activas por defecto (MCHANAQ_ENABLE_REALTIME=0 las apaga): /reverse-geocode (OSM Nominatim), /realtime/area (Open-Meteo + focos NASA FIRMS NRT) y /spread-simulate",
      "Focos NRT con FIRMS_MAP_KEY o, si falta, con los feeds CSV públicos de NASA FIRMS (caché de 10 min); respaldo liviano en Python puro (httpx + Open-Meteo DEM) si no hay geopandas/numpy",
    ],
    href: "https://fastapi.tiangolo.com/",
    icon: "api",
  },
  {
    id: "azure-cloudflare",
    name: "Cloudflare R2, Azure App Service & Cloudflare Pages",
    category: "backend",
    categoryLabel: "Infraestructura",
    summary:
      "Snapshots procesados en Cloudflare R2, API Linux en Azure App Service (Premium v3, 8 GB RAM por el snapshot nacional de 427 territorios) y frontend estático en Cloudflare Pages.",
    uses: [
      "Subida del snapshot de data/processed/ a Cloudflare R2 con r2_sync.py (boto3 solo en la máquina de quien sube)",
      "Arranque en Azure App Service (Python 3.11) con infra/azure/startup.sh, que descarga el snapshot desde R2 si faltan archivos",
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
      "Gráficos históricos con Recharts y contingencia automática sobre data/fixtures/",
      "Verificación visual automatizada con Playwright en desktop (1440×900, 1280×720) y móvil",
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
      "Polígonos territoriales nacionales: 196 provincias INEI y 231 cuencas ANA nivel 4 (427 en total, < 1 MB GeoJSON)",
      "Simulación global 1 clic (Open-Meteo + DEM + SAVI), focos NASA FIRMS NRT en vivo y etiqueta administrativa OSM Nominatim",
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
    input: "Snapshot procesado publicado en Cloudflare R2",
    process: "FastAPI en modo solo lectura para Fase 1 (0 consultas a GEE por petición HTTP); la Fase 2 opcional consulta Open-Meteo, Planetary Computer y NASA FIRMS NRT en vivo.",
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
    detail: "~14.8 años donde coinciden Terra, Aqua, VIIRS S-NPP y ERA5-Land. El snapshot publicado llega hasta 2025-12; lo posterior se ve como focos NRT en vivo (NASA FIRMS), sin mezclarlo con la serie histórica.",
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

export interface TechConvention {
  code: string;
  title: string;
  standard: string;
  description: string;
}

export const TECH_CONVENTIONS: TechConvention[] = [
  {
    code: "SUSC · 01",
    title: "Susceptibilidad contextual (Alta / Moderada / Baja)",
    standard: "UNDRR · FAO · Copernicus EFFIS",
    description:
      "Siguiendo la jerarquía internacional UNDRR/FAO y EFFIS, «Susceptibilidad» describe la predisposición del entorno (vegetación combustible, sequedad < p25, viento > p75 y pendiente) ante una ignición. No afirma peligro físico (intensidad de llama) ni riesgo (Peligro × Exposición × Vulnerabilidad).",
  },
  {
    code: "N0 · 02",
    title: "Evaluación parcial y No evaluable",
    standard: "NASA FIRMS QA · OMM (Cobertura)",
    description:
      "Si la compuerta N0 detecta que falta algún bloque ambiental o menos de 5 años para percentiles estacionales, pero existen variables parciales válidas, se reporta «Evaluación parcial» (o «No evaluable» sin evidencia) en vez de imputar un nivel definitivo.",
  },
  {
    code: "NULL · 03",
    title: "Cero observado vs. Sin observación / No estimable",
    standard: "MODIS / VIIRS FireMask (Clases 7–9)",
    description:
      "«0» significa día observado con cobertura válida (≥ 70 %) y cero detecciones nominal/alta (clases 8–9). «Sin dato» o «Sin observación» indica nulidad por nubes o cero píxeles de tierra válidos; «No estimable» señala línea base < 5 años.",
  },
  {
    code: "SENS · 04",
    title: "Cero suma cruzada entre sensores y procedencia",
    standard: "NASA LP DAAC · Contrato McHanaq",
    description:
      "MODIS Terra (~10:30), MODIS Aqua (~13:30) y VIIRS S-NPP (~13:30) mantienen series separadas por resolución y hora de sobrevuelo. Toda vista separa explícitamente observaciones de «/api/v1» frente a respaldos de «Datos de muestra».",
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
    label: "Calidad y línea base",
    rule: "Bloques ambientales completos + ≥ 5 años para cuantiles (p25 / p75)",
    outcome: "Si falla → Evaluable parcial o No evaluable (sin ceros falsos)",
    tone: "muted",
  },
  {
    node: "N1",
    label: "Combustible vegetal",
    rule: "Vegetación efectiva ≥ 20.0 % (descontando cuerpos de agua)",
    outcome: "< 20 % → Susceptibilidad Baja (low)",
    tone: "term",
  },
  {
    node: "N2",
    label: "Sequedad estacional",
    rule: "precip_30d_mm < p25 o soil_moisture_surface < p25 del mismo mes",
    outcome: "Activa rama seca (N3a) o rama húmeda con relieve (N3b)",
    tone: "acid",
  },
  {
    node: "N3",
    label: "Viento, clima y agua",
    rule: "Viento > p75, (T > p75 ∧ HR < p25) o pendiente ≥ 15 % + buffer 150 m",
    outcome: "Alta / Moderada / Baja + atenuación hídrica (-1 nivel si buf ≥ 5 %)",
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
    code: "VIENTO",
    title: "Viento y humedad en vivo",
    source: "Open-Meteo Forecast / Archive",
    detail:
      "Viento horario a 10 m (velocidad y dirección) y humedad relativa de la fecha y el punto elegidos: ya no son valores fijos de la interfaz. Solo se respeta el viento si el usuario lo fija a mano; sin conexión se usa un perfil diurno ERA5 y la fuente queda etiquetada.",
  },
  {
    code: "SAVI",
    title: "Combustible (Huete, 1988)",
    source: "Sentinel-2 L2A · Planetary Computer · L = 0.5",
    detail:
      "((NIR − RED) / (NIR + RED + 0.5)) × 1.5 sobre la mejor escena con < 35 % de nubes de los 45 días previos, normalizado a carga combustible [0, 1] por celda. Sin escena disponible se usa un SAVI calibrado por cobertura y la fuente lo indica.",
  },
  {
    code: "DEM",
    title: "Relieve (Copernicus GLO-90)",
    source: "Open-Meteo Elevation · malla 10 × 10",
    detail:
      "Elevación remuestreada y suavizada a la grilla de la simulación; la pendiente media y máxima se derivan de ella y se muestran en el panel de resultados.",
  },
  {
    code: "ROS",
    title: "Velocidad base y humedad (Rothermel)",
    source: "Humedad de combustible (ext. 30 %)",
    detail:
      "Tasa head_ros_m_min amortiguada cuadráticamente por humedad (1 − M / 30 %)² y cobertura; la humedad del combustible se estima desde la humedad relativa en vivo si no se fija.",
  },
  {
    code: "L/B",
    title: "Elipse y relieve (Anderson · DEM)",
    source: "Viento 10 m · Copernicus DEM",
    detail:
      "Relación largo/ancho L/B ∈ [1.0, 8.0] acoplada a exp(0.0693 · pendiente°): ×2 cada +10° cuesta arriba.",
  },
  {
    code: "48h",
    title: "Frente mínimo e isócronas",
    source: "/api/v1/spread-simulate",
    detail:
      "Expansión por celdas hasta 6 · 12 · 24 · 36 · 48 h + GIF/MP4, infografías PNG y Shapefiles QGIS (.zip).",
  },
];
