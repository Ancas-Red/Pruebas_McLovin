/**
 * Contratos de datos del frontend.
 *
 * Estos tipos reflejan el contrato `/api/v1` acordado con el backend.
 * Si el backend cambia un nombre de campo, se cambia aqui y en
 * `contracts/api-contract.md` en el mismo PR. El frontend nunca renombra
 * campos por su cuenta.
 */

export type Sensor = "MODIS_TERRA" | "MODIS_AQUA" | "VIIRS_SNPP";

export const SENSORS: Sensor[] = ["MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"];

export const SENSOR_META: Record<
  Sensor,
  { label: string; short: string; product: string; resolution: string; since: number; color: string }
> = {
  MODIS_TERRA: {
    label: "MODIS Terra",
    short: "TERRA",
    product: "MOD14A1.061",
    resolution: "1 km",
    since: 2000,
    color: "#f8850c",
  },
  MODIS_AQUA: {
    label: "MODIS Aqua",
    short: "AQUA",
    product: "MYD14A1.061",
    resolution: "1 km",
    since: 2002,
    color: "#e65c2f",
  },
  VIIRS_SNPP: {
    label: "VIIRS S-NPP",
    short: "VIIRS",
    product: "VNP14A1.002",
    resolution: "1 km",
    since: 2012,
    color: "#fcb416",
  },
};

/** Confianza de la deteccion. La clase 7 se reporta aparte del indicador principal. */
export type Confidence = "low" | "nominal" | "high";

export interface Hotspot {
  id: string;
  lat: number;
  lon: number;
  /** Fecha de la deteccion, ISO `YYYY-MM-DD`. */
  date: string;
  sensor: Sensor;
  /** Potencia radiativa del fuego, en megavatios. */
  frp: number;
  confidence: Confidence;
  /** Paso por el satelite, `HHMM` UTC. */
  acq_time: string;
}

/** Celda del calendario: un mes de un anio para un territorio y sensor. */
export interface MonthCell {
  year: number;
  /** 1 a 12. */
  month: number;
  /** Detecciones de confianza nominal/alta (clases 8-9). */
  detections: number;
  /** Detecciones / observaciones validas. `null` si no hay observacion valida. */
  activity_rate: number | null;
  /** Observaciones validas / esperadas, 0 a 1. */
  observation_coverage: number;
  /** Dias con al menos una deteccion. */
  active_days: number;
  /** Racha mas larga de dias consecutivos activos. */
  max_consecutive_active_days: number;
  /** z robusta frente al mismo mes de anios anteriores. `null` si no es estimable. */
  historical_anomaly: number | null;
  /** Anios comparables usados como linea base. */
  baseline_years: number;
}

export interface DayPoint {
  date: string;
  detections: number;
  observation_coverage: number;
}

/** Estado de acuerdo entre sensores para un mismo territorio y mes. */
export type ComparisonStatus =
  | "concordant_elevated"
  | "concordant_not_elevated"
  | "discordant"
  | "single_sensor"
  | "insufficient";

export interface SensorComparison {
  period_id: string;
  status: ComparisonStatus;
  sensors: Partial<
    Record<
      Sensor,
      {
        available: boolean;
        activity_rate: number | null;
        historical_anomaly: number | null;
        observation_coverage: number;
        signal_status: "elevated" | "not_elevated" | "unknown";
      }
    >
  >;
  interpretation: string;
}

/** Salida del arbol de decision de susceptibilidad contextual. */
export type SusceptibilityClass =
  | "high"
  | "moderate"
  | "low"
  | "partial"
  | "not_evaluable";

export interface SusceptibilityAssessment {
  classification: SusceptibilityClass;
  /** Ruta recorrida en el arbol, p. ej. ["N0:pass","N1:yes","N2:yes","N3a:no"]. */
  decision_path: string[];
  rules_triggered: string[];
  modifiers: string[];
  evidence: {
    variable: string;
    value: number | null;
    unit: string;
    rule_status: string;
    source_product: string;
  }[];
  missing_variables: string[];
}

/** Variables ambientales del area de interes para el periodo consultado. */
export interface EnvConditions {
  wind_speed_10m_ms: number;
  wind_direction_deg: number;
  temperature_2m_c: number;
  relative_humidity_2m_pct: number;
  precip_30d_mm: number;
  soil_moisture_surface: number;
  ndvi_median: number;
  vegetation_area_pct: number;
  water_area_pct: number;
  slope_mean_deg: number;
}

/** Origen de los datos que se estan mostrando. Se comunica siempre en la UI. */
export type DataOrigin = "api" | "fixture";

export interface AreaOfInterest {
  /** Vertices del poligono, en [lat, lon]. */
  ring: [number, number][];
  /** Area aproximada, en kilometros cuadrados. */
  areaKm2: number;
}
