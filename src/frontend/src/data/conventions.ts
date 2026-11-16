export type ConvCategory =
  | "todos"
  | "internacional"
  | "satelital"
  | "nacional";

export type ConvIconKey =
  | "globe"
  | "shield"
  | "flame"
  | "climate"
  | "satellite"
  | "model"
  | "peru"
  | "basin"
  | "argentina";

export interface ConvStandard {
  id: string;
  code: string;
  name: string;
  category: Exclude<ConvCategory, "todos">;
  categoryLabel: string;
  traceability: string;
  summary: string;
  adoptions: string[];
  href: string;
  icon: ConvIconKey;
}

export interface ConvGate {
  step: string;
  title: string;
  layer: string;
  input: string;
  process: string;
  output: string;
}

export interface ConvTerm {
  code: string;
  standard: string;
  title: string;
  detail: string;
}

export const CONV_CATEGORIES: { id: ConvCategory; label: string }[] = [
  { id: "todos", label: "All" },
  { id: "internacional", label: "International frameworks" },
  { id: "satelital", label: "Satellite standards" },
  { id: "nacional", label: "Peru and Argentina regulations" },
];

export const CONV_STANDARDS: ConvStandard[] = [
  {
    id: "undrr",
    code: "UN · UNDRR",
    name: "UNDRR Risk Reduction Terminology",
    category: "internacional",
    categoryLabel: "International framework",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "Formally distinguishes between Hazard (physical process), Exposure (population and infrastructure), Vulnerability and Risk. It forbids calling a physical layer “risk” when there are no exposed elements.",
    adoptions: [
      "Phase 1 is always labeled “Contextual susceptibility” and never “Risk” or “Fire hazard”",
      "Aligned with the explicit exclusion of exposed elements documented by CENEPRED / SERFOR",
      "Each category indicates observed physical-climatic context, not potential loss or ignition probability",
    ],
    href: "https://www.undrr.org/terminology",
    icon: "shield",
  },
  {
    id: "fao",
    code: "UN · FAO",
    name: "Voluntary Guidelines for Fire Management",
    category: "internacional",
    categoryLabel: "International framework",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "FAO standard that separates the detection of active thermal anomalies from the diagnosis of ignition causes, the assessment of favorable conditions and operational management.",
    adoptions: [
      "A MODIS/VIIRS hotspot represents a radiometric thermal anomaly, not anthropogenic origin or burned extent",
      "Names in the viewer preserve an exploratory scope: detecting ≠ predicting cause or suppression",
      "Phase 2 explicitly states that it does not replace operational alert or evacuation protocols",
    ],
    href: "https://www.fao.org/sustainable-forest-management/toolbox/tools/tool-detail/en/c/280388/",
    icon: "flame",
  },
  {
    id: "effis",
    code: "EU · Copernicus",
    name: "Copernicus EFFIS — Ordinal Hazard Classification",
    category: "internacional",
    categoryLabel: "International framework",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "The European EFFIS system adopts ordinal levels that decision-makers can understand (Low, Moderate, High), stressing that a low class never implies immunity to fire.",
    adoptions: [
      "Strict output mapping: high → High susceptibility, moderate → Moderate, low → Low",
      "The legend explicitly clarifies that “Low susceptibility” does not mean a fire-free territory",
      "Includes the “Partial assessment” (partial) state when environmental variables are temporarily insufficient",
    ],
    href: "https://forest-fire.emergency.copernicus.eu/",
    icon: "globe",
  },
  {
    id: "wmo",
    code: "WMO · WMO-No. 1203",
    name: "WMO Guidelines on Climatological Normals and Anomalies",
    category: "internacional",
    categoryLabel: "Climatology",
    traceability: "v1.7.md §Stage 7 + src/analytics/",
    summary:
      "Defines statistical criteria for climatic baselines and detection of seasonal anomalies consistent by calendar month and station/territorial unit.",
    adoptions: [
      "Historical anomaly calculated per territory and calendar month (never a single national threshold)",
      "Common window of ~14.8 years (2012-01-19 to 2026-11-02), exceeding the operational minimum of ≥ 5 years",
      "If a unit does not reach the minimum number of reference years, the anomaly is flagged as not estimable",
    ],
    href: "https://community.wmo.int/en/wmo-climatological-normals",
    icon: "climate",
  },
  {
    id: "nasa-firms",
    code: "NASA LP DAAC · FIRMS",
    name: "MOD14A1 · MYD14A1 · VNP14A1 Specification (FireMask / QA)",
    category: "satelital",
    categoryLabel: "Satellite standard",
    traceability: "Documented by Angelo in v1.7.md §§260–295",
    summary:
      "Official bit-decoding rules for daily MODIS (1 km) and VIIRS Suomi-NPP (375 m/1 km) thermal anomaly products, separating nominal/high confidence from low.",
    adoptions: [
      "FireMask bits 0–3 extraction: class 5 (land without fire), 7 (low confidence, kept apart) and 8–9 (nominal/high)",
      "Strict land-pixel filter using QA bits 0–1 == 2, excluding water, coast and cloud",
      "Absolute ban on adding counts across Terra, Aqua and VIIRS; cloudiness ≥ 30 % produces null",
    ],
    href: "https://firms.modaps.eosdis.nasa.gov/",
    icon: "satellite",
  },
  {
    id: "spread-physics",
    code: "Physics literature · 1972–1988",
    name: "Conditional Cellular Modeling: Rothermel · Anderson · Alexander · Huete",
    category: "satelital",
    categoryLabel: "Spread physics",
    traceability: "Documented by Angelo in Fase2_Simulacion_Espacial_Propagacion_48h.md",
    summary:
      "Physical basis of the optional Phase 2: integrates the soil-adjusted vegetation index SAVI (Huete, 1988), wind/moisture damping (Rothermel, 1972) and elliptical front geometry (Anderson 1983 / Alexander 1985).",
    adoptions: [
      "Simulation conditional on an ignition point chosen by the user up to +48 h (+6h/+12h/+24h/+36h/+48h)",
      "Directional slope from COPERNICUS_DEM_GLO30 and hourly wind vector (ERA5-Land / Open-Meteo)",
      "Reproducible artifacts independent of Phase 1 (.json, .gif, .mp4 and WGS84 QGIS Shapefiles)",
    ],
    href: "https://lpdaac.usgs.gov/",
    icon: "model",
  },
  {
    id: "cenepred-sinagerd",
    code: "Peru · Law No. 29664",
    name: "SINAGERD · CENEPRED / SERFOR Protocol and D.S. No. 010-2025-PCM",
    category: "nacional",
    categoryLabel: "Peru regulations",
    traceability: "CENEPRED/SERFOR in v1.7.md:434 + SINAGERD framework in UI",
    summary:
      "Peruvian national Disaster Risk Management framework. v1.7.md documents the 4 deliberate differences between the McHanaq N0–N3 tree and an official CENEPRED Risk Scenario.",
    adoptions: [
      "1) Thermal background is purely informative: it does not model anthropogenic triggers (roads/populated centers)",
      "2) Binary MINAM combustible vegetation (umbral_veg = 20 %) without differential AHP weights per cover type",
      "3) Classifies aggregated polygons (provinces/basins) into 3 levels instead of a continuous 4-level raster",
      "4) Does not cross with exposed elements (population, protected areas or infrastructure), avoiding the name “Risk”",
    ],
    href: "https://www.gob.pe/cenepred",
    icon: "peru",
  },
  {
    id: "inei-ana",
    code: "Peru · INEI / ANA",
    name: "INEI 2023 Boundaries and ANA Pfafstetter Level 4 Hydrographic Units",
    category: "nacional",
    categoryLabel: "Peru regulations",
    traceability: "v1.7.md:191,1392 + data/processed/territories.geojson",
    summary:
      "Dual territorial standardization over the Ucayali pilot (4 INEI 2023 provinces and 20 ANA basins coded by the Pfafstetter method, R.M. No. 033-2008-AG) without mixing rankings.",
    adoptions: [
      "Strict separation of queries by territory_type (province vs hydro_unit) across the whole /api/v1 API",
      "Local water rule in N1–N3: 150 m surface-water buffer (attenuation if ≥ 5 % of the territory)",
      "Exclusion of non-combustible classes and water bodies (CobVeg_180615.shp + JRC Surface Water)",
    ],
    href: "https://www.gob.pe/ana",
    icon: "basin",
  },
  {
    id: "argentina-26815",
    code: "Argentina · Law 26.815",
    name: "National Law No. 26.815 (SNMF) · SMN · CONAE–Instituto Gulich / SARTiv",
    category: "nacional",
    categoryLabel: "Argentina regulations",
    traceability: "Documented by Angelo in Fase2_Simulacion_Espacial_Propagacion_48h.md §1",
    summary:
      "Regulatory and space-science framework of minimum budgets for fire management (SNMF, FWI/SMN weather forecast and operational satellite analytics CONAE–Gulich / SARTiv).",
    adoptions: [
      "Methodological alignment of the Phase 2 48 h spatial simulation described in Fase2_Simulacion...md",
      "Integration of conditioning physical variables (hourly wind, terrain, SAVI fuel index)",
      "Standard WGS84 vector outputs (.shp QGIS) and infographics designed to interoperate with technical teams",
    ],
    href: "https://www.argentina.gob.ar/normativa/nacional/ley-26815-207402",
    icon: "argentina",
  },
];

export const CONV_GATES: ConvGate[] = [
  {
    step: "01",
    title: "Satellite Quality Gate",
    layer: "src/analytics/metrics.py",
    input: "QA bits 0–1 (land=2) + FireMask + daily cloudiness",
    process: "Requires valid_land_pixels > 0 and observation_coverage >= 0.70 (clouds < 30 %).",
    output: "Cloudy days are emitted as null; they are never turned into 0.",
  },
  {
    step: "02",
    title: "WMO Climatological Baseline",
    layer: "metadata.json · calendar",
    input: "Series 2012-01-19 → 2026-11-02 (~14.8 common years)",
    process: "Computes p25/p75 and z-score per territory and calendar month (minimum ≥ 5 years).",
    output: "If baseline_years < 5, the reference is flagged as “not estimable”.",
  },
  {
    step: "03",
    title: "N0–N3 Contextual Tree",
    layer: "src/analytics/decision_rules.py",
    input: "MINAM vegetation cover (≥ 20 %), ERA5 water deficit and slope (≥ 15 %)",
    process: "Evaluates quality gate N0, blocks N1–N3 and attenuation by 150 m water buffer.",
    output: "high / moderate / low / partial / not_evaluable + traceable decision_path.",
  },
  {
    step: "04",
    title: "Phase 1 vs Phase 2 Decoupling",
    layer: "Fase2_Simulacion...md",
    input: "Historical susceptibility (Phase 1) vs optional ignition point (Phase 2)",
    process: "Isolates historical satellite monitoring from the 48-hour elliptical projection.",
    output: "Phase 1 explains observed conditions; Phase 2 explores trajectories under a given scenario.",
  },
];

export const CONV_GLOSSARY: ConvTerm[] = [
  {
    code: "N3a / N3b · N1",
    standard: "UNDRR · Copernicus EFFIS",
    title: "High / moderate / low susceptibility",
    detail:
      "Degree to which the observed physical conditions (combustible vegetation, dryness, wind and slope) favor thermal spread. It does not measure ignition probability or socioeconomic risk; “low” does not guarantee the absence of fire either.",
  },
  {
    code: "N0 pass · incomplete block",
    standard: "N0–N3 analytical integrity",
    title: "Partial assessment (partial)",
    detail:
      "Base satellite quality passed N0 and valid metrics exist, but at least one key environmental series is missing (for example LST, precipitation or evapotranspiration of the month). It is never filled in with zeros or fictitious averages.",
  },
  {
    code: "N0 fail",
    standard: "NASA FIRMS QA + Coverage",
    title: "Not assessable (not_evaluable)",
    detail:
      "The valid land fraction falls below the operational minimum (observation_coverage < 0.70 / cloudiness ≥ 30 %) or there is not enough window. Inference is blocked to avoid false diagnoses.",
  },
  {
    code: "0 vs null",
    standard: "Daily API contract",
    title: "True zero vs. “No observation / No data”",
    detail:
      "“0” means the satellite observed a clear sky over valid land and recorded no hotspots. “No observation” or “null” indicates there were clouds, swath edge or an unpublished month.",
  },
  {
    code: "0.0 σ · ±σ",
    standard: "WMO · WMO-No. 1203",
    title: "Seasonal anomaly and zero sign",
    detail:
      "Standardized deviation against the same month of the local historical calendar. Any value rounded to zero is normalized as 0.0 σ (never -0.0 σ); with fewer than 5 years it is reported as not estimable.",
  },
  {
    code: "PHASE 2 · OPTIONAL",
    standard: "Law 26.815 · Rothermel / Anderson",
    title: "Conditional 48 h spread simulation",
    detail:
      "Exploratory projection from a hypothetical ignition point, Copernicus DEM slope and 48 h hourly wind. Decoupled from Phase 1; it is not a forecast or an early warning system.",
  },
];
