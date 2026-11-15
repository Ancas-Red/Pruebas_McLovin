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
  { id: "todos", label: "Todos" },
  { id: "internacional", label: "Marcos internacionales" },
  { id: "satelital", label: "Estándares satelitales" },
  { id: "nacional", label: "Normativa Perú y Argentina" },
];

export const CONV_STANDARDS: ConvStandard[] = [
  {
    id: "undrr",
    code: "ONU · UNDRR",
    name: "Terminología UNDRR de Reducción del Riesgo",
    category: "internacional",
    categoryLabel: "Marco internacional",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "Distingue formalmente entre Amenaza (proceso físico), Exposición (población e infraestructura), Vulnerabilidad y Riesgo. Prohíbe llamar «riesgo» a una capa física sin elementos expuestos.",
    adoptions: [
      "Fase 1 se etiqueta siempre como «Susceptibilidad contextual» y nunca como «Riesgo» ni «Peligro de incendio»",
      "Alineado con la exclusión explícita de elementos expuestos documentada en CENEPRED / SERFOR",
      "Cada categoría indica contexto físico-climático observado, no pérdida potencial ni probabilidad de ignición",
    ],
    href: "https://www.undrr.org/terminology",
    icon: "shield",
  },
  {
    id: "fao",
    code: "ONU · FAO",
    name: "Directrices Voluntarias para el Manejo del Fuego",
    category: "internacional",
    categoryLabel: "Marco internacional",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "Estándar de la FAO que separa la detección de anomalías térmicas activas del diagnóstico de causas de ignición, la evaluación de condiciones propicias y la gestión operativa.",
    adoptions: [
      "Un foco MODIS/VIIRS representa anomalía térmica radiométrica, no origen antrópico ni extensión quemada",
      "Los nombres en el visor preservan alcance exploratorio: detectar ≠ predecir causa ni supresión",
      "Fase 2 declara explícitamente no sustituir protocolos operativos de alerta ni evacuación",
    ],
    href: "https://www.fao.org/sustainable-forest-management/toolbox/tools/tool-detail/en/c/280388/",
    icon: "flame",
  },
  {
    id: "effis",
    code: "UE · Copernicus",
    name: "Copernicus EFFIS — Clasificación Ordinal de Peligro",
    category: "internacional",
    categoryLabel: "Marco internacional",
    traceability: "UI + contracts/data-dictionary.md §6",
    summary:
      "El sistema europeo EFFIS adopta niveles ordinales comprensibles para decisores (Bajo, Moderado, Alto) subrayando que una clase baja jamás implica inmunidad frente al fuego.",
    adoptions: [
      "Mapeo estricto de salidas: high → Susceptibilidad alta, moderate → moderada, low → baja",
      "La leyenda aclara explícitamente que «Susceptibilidad baja» no significa territorio libre de incendios",
      "Incluye el estado «Evaluación parcial» (partial) ante insuficiencia temporal de variables ambientales",
    ],
    href: "https://forest-fire.emergency.copernicus.eu/",
    icon: "globe",
  },
  {
    id: "wmo",
    code: "OMM · WMO-No. 1203",
    name: "Directrices OMM para Normales Climatológicas y Anomalías",
    category: "internacional",
    categoryLabel: "Climatología",
    traceability: "v1.7.md §Etapa 7 + src/analytics/",
    summary:
      "Define criterios estadísticos para líneas base climáticas y detección de anomalías estacionales consistentes por mes calendario y estación/unidad territorial.",
    adoptions: [
      "Anomalía histórica calculada por territorio y mes calendario (nunca umbral único nacional)",
      "Ventana común de ~14.8 años (2012-01-19 a 2026-11-02), superando el mínimo operativo de ≥ 5 años",
      "Si una unidad no alcanza el mínimo de años de referencia, la anomalía se marca como no estimable",
    ],
    href: "https://community.wmo.int/en/wmo-climatological-normals",
    icon: "climate",
  },
  {
    id: "nasa-firms",
    code: "NASA LP DAAC · FIRMS",
    name: "Especificación MOD14A1 · MYD14A1 · VNP14A1 (FireMask / QA)",
    category: "satelital",
    categoryLabel: "Estándar satelital",
    traceability: "Documentado por Angelo en v1.7.md §§260–295",
    summary:
      "Reglas oficiales de decodificación de bits para productos diarios de anomalías térmicas MODIS (1 km) y VIIRS Suomi-NPP (375 m/1 km) separando confianza nominal/alta de baja.",
    adoptions: [
      "Extracción de FireMask bits 0–3: clase 5 (tierra sin fuego), 7 (baja confianza aparte) y 8–9 (nominal/alta)",
      "Filtro estricto de píxel terrestre mediante QA bits 0–1 == 2, excluyendo agua, costa y nube",
      "Prohibición absoluta de sumar conteos entre Terra, Aqua y VIIRS; nubosidad ≥ 30 % produce null",
    ],
    href: "https://firms.modaps.eosdis.nasa.gov/",
    icon: "satellite",
  },
  {
    id: "spread-physics",
    code: "Literatura Física · 1972–1988",
    name: "Modelado Celular Condicional: Rothermel · Anderson · Alexander · Huete",
    category: "satelital",
    categoryLabel: "Física de propagación",
    traceability: "Documentado por Angelo en Fase2_Simulacion_Espacial_Propagacion_48h.md",
    summary:
      "Base física de Fase 2 opcional: integra ajuste de vegetación resistente al suelo SAVI (Huete, 1988), amortiguación eólica/hídrica (Rothermel, 1972) y geometría elíptica de frente (Anderson 1983 / Alexander 1985).",
    adoptions: [
      "Simulación condicional a un punto de ignición elegido por el usuario hasta +48 h (+6h/+12h/+24h/+36h/+48h)",
      "Pendiente direccional desde COPERNICUS_DEM_GLO30 y vector de viento horario (ERA5-Land / Open-Meteo)",
      "Artefactos reproducibles independientes de Fase 1 (.json, .gif, .mp4 y Shapefiles QGIS WGS84)",
    ],
    href: "https://lpdaac.usgs.gov/",
    icon: "model",
  },
  {
    id: "cenepred-sinagerd",
    code: "Perú · Ley N.º 29664",
    name: "SINAGERD · Protocolo CENEPRED / SERFOR y D.S. N.º 010-2025-PCM",
    category: "nacional",
    categoryLabel: "Normativa Perú",
    traceability: "CENEPRED/SERFOR en v1.7.md:434 + marco SINAGERD en UI",
    summary:
      "Marco nacional peruano de Gestión del Riesgo de Desastres. En v1.7.md se documentan las 4 diferencias deliberadas entre el árbol N0–N3 de McHanaq y un Escenario de Riesgo oficial de CENEPRED.",
    adoptions: [
      "1) Antecedente térmico meramente informativo: no modela factor desencadenante antrópico (vías/centros poblados)",
      "2) Vegetación combustible binaria MINAM (umbral_veg = 20 %) sin pesos AHP diferenciales por cobertura",
      "3) Clasifica polígonos agregados (provincias/cuencas) en 3 niveles en lugar de ráster continuo de 4 niveles",
      "4) No cruza con elementos expuestos (población, ANP o infraestructura), evitando llamarse «Riesgo»",
    ],
    href: "https://www.gob.pe/cenepred",
    icon: "peru",
  },
  {
    id: "inei-ana",
    code: "Perú · INEI / ANA",
    name: "Límites INEI 2023 y Unidades Hidrográficas ANA Pfafstetter Nivel 4",
    category: "nacional",
    categoryLabel: "Normativa Perú",
    traceability: "v1.7.md:191,1392 + data/processed/territories.geojson",
    summary:
      "Estandarización territorial dual sobre el piloto Ucayali (4 provincias INEI 2023 y 20 cuencas ANA codificadas por método Pfafstetter, R.M. N.º 033-2008-AG) sin mezclar rankings.",
    adoptions: [
      "Separación estricta de consultas por territory_type (province vs hydro_unit) en toda la API /api/v1",
      "Regla hídrica local en N1–N3: buffer de agua superficial de 150 m (atenuación si ≥ 5 % del territorio)",
      "Exclusión de clases no combustibles y cuerpos de agua (CobVeg_180615.shp + JRC Surface Water)",
    ],
    href: "https://www.gob.pe/ana",
    icon: "basin",
  },
  {
    id: "argentina-26815",
    code: "Argentina · Ley 26.815",
    name: "Ley Nacional N.º 26.815 (SNMF) · SMN · CONAE–Instituto Gulich / SARTiv",
    category: "nacional",
    categoryLabel: "Normativa Argentina",
    traceability: "Documentado por Angelo en Fase2_Simulacion_Espacial_Propagacion_48h.md §1",
    summary:
      "Marco normativo y científico-espacial de presupuestos mínimos para el manejo del fuego (SNMF, pronóstico meteorológico FWI/SMN y analítica satelital operativa CONAE–Gulich / SARTiv).",
    adoptions: [
      "Alineación metodológica de la Fase 2 de simulación espacial 48 h descrita en Fase2_Simulacion...md",
      "Integración de variables físicas condicionantes (viento horario, relieve, índice de combustible SAVI)",
      "Salidas vectoriales estándar WGS84 (.shp QGIS) e infografías pensadas para interoperar con equipos técnicos",
    ],
    href: "https://www.argentina.gob.ar/normativa/nacional/ley-26815-207402",
    icon: "argentina",
  },
];

export const CONV_GATES: ConvGate[] = [
  {
    step: "01",
    title: "Compuerta de Calidad Satelital",
    layer: "src/analytics/metrics.py",
    input: "QA bits 0–1 (tierra=2) + FireMask + nubosidad diaria",
    process: "Exige valid_land_pixels > 0 y observation_coverage >= 0.70 (nubes < 30 %).",
    output: "Días nubosos se emiten como null; jamás se convierten en 0.",
  },
  {
    step: "02",
    title: "Línea Base Climatológica OMM",
    layer: "metadata.json · calendar",
    input: "Serie 2012-01-19 → 2026-11-02 (~14.8 años comunes)",
    process: "Calcula p25/p75 y z-score por territorio y mes calendario (mínimo ≥ 5 años).",
    output: "Si baseline_years < 5, la referencia queda marcada como «no estimable».",
  },
  {
    step: "03",
    title: "Árbol Contextual N0–N3",
    layer: "src/analytics/decision_rules.py",
    input: "Cobertura vegetal MINAM (≥ 20 %), déficit hídrico ERA5 y pendiente (≥ 15 %)",
    process: "Evalúa compuerta de calidad N0, bloques N1–N3 y atenuación por buffer hídrico 150 m.",
    output: "high / moderate / low / partial / not_evaluable + decision_path trazable.",
  },
  {
    step: "04",
    title: "Desacoplamiento Fase 1 vs Fase 2",
    layer: "Fase2_Simulacion...md",
    input: "Susceptibilidad histórica (Fase 1) vs punto de ignición opcional (Fase 2)",
    process: "Aísla el monitoreo satelital histórico de la proyección elíptica a 48 horas.",
    output: "Fase 1 explica condiciones observadas; Fase 2 explora trayectorias bajo escenario dado.",
  },
];

export const CONV_GLOSSARY: ConvTerm[] = [
  {
    code: "N3a / N3b · N1",
    standard: "UNDRR · Copernicus EFFIS",
    title: "Susceptibilidad alta / moderada / baja",
    detail:
      "Grado en que las condiciones físicas observadas (vegetación combustible, sequedad, viento y pendiente) favorecen la propagación térmica. No mide probabilidad de ignición ni riesgo socioeconómico; «baja» tampoco garantiza ausencia de fuego.",
  },
  {
    code: "N0 pass · bloque incompleto",
    standard: "Integridad analítica N0–N3",
    title: "Evaluación parcial (partial)",
    detail:
      "La calidad satelital base pasó N0 y existen métricas válidas, pero falta al menos una serie ambiental clave (por ejemplo LST, precipitación o evapotranspiración del mes). Nunca se completa con ceros ni con promedios ficticios.",
  },
  {
    code: "N0 fail",
    standard: "NASA FIRMS QA + Cobertura",
    title: "No evaluable (not_evaluable)",
    detail:
      "La fracción válida terrestre cae bajo el mínimo operativo (observation_coverage < 0.70 / nubosidad ≥ 30 %) o no hay ventana suficiente. Se bloquea la inferencia para evitar falsos diagnósticos.",
  },
  {
    code: "0 vs null",
    standard: "Contrato API diario",
    title: "Cero real frente a «Sin observación / Sin dato»",
    detail:
      "«0» significa que el satélite observó cielo despejado sobre tierra válida y no registró focos. «Sin observación» o «null» indica que hubo nubes, borde de barrido o mes no publicado.",
  },
  {
    code: "0.0 σ · ±σ",
    standard: "OMM · WMO-No. 1203",
    title: "Anomalía estacional y signo cero",
    detail:
      "Desviación estandarizada frente al mismo mes del calendario histórico local. Cualquier valor redondeado a cero se normaliza como 0.0 σ (nunca -0.0 σ); con menos de 5 años se reporta no estimable.",
  },
  {
    code: "FASE 2 · OPCIONAL",
    standard: "Ley 26.815 · Rothermel / Anderson",
    title: "Simulación condicional de propagación 48 h",
    detail:
      "Proyección exploratoria a partir de un punto de ignición hipotético, pendiente Copernicus DEM y viento horario de 48 h. Desacoplada de Fase 1; no constituye pronóstico ni sistema de alerta temprana.",
  },
];
