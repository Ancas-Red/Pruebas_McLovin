/**
 * Unico punto de acceso a datos del frontend.
 *
 * Regla de la arquitectura: ningun componente llama a `fetch` por su cuenta ni
 * lee archivos. Todo pasa por aqui.
 *
 * Mientras el backend de Tom no este levantado, cada metodo cae en el
 * generador de muestra (`lib/fixtures`) y marca el origen como "fixture", que
 * la interfaz muestra de forma visible. Cuando el backend responde, el origen
 * pasa a "api" y no cambia nada mas en los componentes.
 */

import type {
  DataOrigin,
  DayPoint,
  EnvConditions,
  Hotspot,
  MonthCell,
  Sensor,
  SensorComparison,
  SusceptibilityAssessment,
} from "./types";
import { SENSOR_META } from "./types";
import {
  buildCalendar,
  buildDailySeries,
  buildEnvConditions,
  filterByArea,
  monthlyHotspots,
} from "../lib/fixtures";
import { ringAreaKm2, ringCentroid, type LatLon } from "../lib/geo";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/v1";
const TIMEOUT_MS = 3500;

export class ApiError extends Error {
  constructor(public status: number, public code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
  }
}

export interface Envelope<T> {
  data: T;
  origin: DataOrigin;
}

async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.code ?? "UNKNOWN", body.detail ?? res.statusText);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Estado de la conexion                                                       */
/* -------------------------------------------------------------------------- */

export type BackendState = "checking" | "online" | "offline";

let backendState: BackendState = "checking";

export function getBackendState(): BackendState {
  return backendState;
}

/** Sondea `/health`. Se llama una vez al arrancar y luego cada pocos minutos. */
export async function probeBackend(): Promise<BackendState> {
  try {
    await getJson<{ status: string }>("/health");
    backendState = "online";
  } catch {
    backendState = "offline";
  }
  return backendState;
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

export interface HotspotQuery {
  sensors: Sensor[];
  year: number;
  month: number;
  ring: LatLon[] | null;
  /** Incluir las detecciones de baja confianza (clase 7). */
  includeLowConfidence: boolean;
}

export async function fetchHotspots(q: HotspotQuery): Promise<Envelope<Hotspot[]>> {
  if (backendState === "online") {
    try {
      const all: Hotspot[] = [];
      for (const sensor of q.sensors) {
        const r = await getJson<{ items: Hotspot[] }>("/hotspots", {
          sensor,
          period: `${q.year}-${String(q.month).padStart(2, "0")}`,
        });
        all.push(...r.items);
      }
      const filtered = q.includeLowConfidence ? all : all.filter((h) => h.confidence !== "low");
      return { data: filterByArea(filtered, q.ring), origin: "api" };
    } catch {
      backendState = "offline";
    }
  }

  const all: Hotspot[] = [];
  for (const sensor of q.sensors) {
    all.push(...monthlyHotspots(sensor, q.year, q.month));
  }
  const filtered = q.includeLowConfidence ? all : all.filter((h) => h.confidence !== "low");
  return { data: filterByArea(filtered, q.ring), origin: "fixture" };
}

export interface CalendarQuery {
  sensor: Sensor;
  ring: LatLon[] | null;
}

export async function fetchCalendar(q: CalendarQuery): Promise<Envelope<MonthCell[]>> {
  if (backendState === "online") {
    try {
      const r = await getJson<{ items: MonthCell[] }>("/calendar", { sensor: q.sensor });
      return { data: r.items, origin: "api" };
    } catch {
      backendState = "offline";
    }
  }
  const areaKm2 = q.ring ? ringAreaKm2(q.ring) : 1_285_000;
  // Peso local: un area sobre la Amazonia pesa mas que una sobre la costa.
  const localWeight = q.ring ? localActivityWeight(ringCentroid(q.ring)) : 1;
  return { data: buildCalendar(q.sensor, q.ring, areaKm2, localWeight), origin: "fixture" };
}

export function fetchDailySeries(
  points: Hotspot[],
  year: number,
  month: number,
  coverageHint: number
): DayPoint[] {
  return buildDailySeries(points, year, month, coverageHint);
}

export async function fetchEnvConditions(
  center: LatLon,
  year: number,
  month: number
): Promise<Envelope<EnvConditions>> {
  if (backendState === "online") {
    try {
      const r = await getJson<EnvConditions>("/environment", {
        lat: String(center[0]),
        lon: String(center[1]),
        period: `${year}-${String(month).padStart(2, "0")}`,
      });
      return { data: r, origin: "api" };
    } catch {
      backendState = "offline";
    }
  }
  return { data: buildEnvConditions(center, year, month), origin: "fixture" };
}

/* -------------------------------------------------------------------------- */
/* Derivaciones locales permitidas                                             */
/* -------------------------------------------------------------------------- */

/**
 * Comparacion multisensor.
 *
 * ATENCION: en produccion esto lo precomputa Tom y llega por
 * `/sensor-comparison`. La version local existe solo para que la vista se
 * pueda construir y probar sin backend, y clasifica la senal de cada sensor
 * por separado antes de compararlas. Nunca suma conteos entre sensores.
 */
export function deriveComparison(
  perSensor: Partial<Record<Sensor, MonthCell | undefined>>,
  periodId: string
): SensorComparison {
  const COVERAGE_MIN = 0.35;
  const ELEVATED_Z = 1.0;

  const sensors: SensorComparison["sensors"] = {};
  let elevated = 0;
  let notElevated = 0;
  let usable = 0;

  for (const [key, cell] of Object.entries(perSensor) as [Sensor, MonthCell | undefined][]) {
    if (!cell) {
      sensors[key] = {
        available: false,
        activity_rate: null,
        historical_anomaly: null,
        observation_coverage: 0,
        signal_status: "unknown",
      };
      continue;
    }
    const comparable = cell.observation_coverage >= COVERAGE_MIN && cell.historical_anomaly !== null;
    let signal: "elevated" | "not_elevated" | "unknown" = "unknown";
    if (comparable) {
      usable++;
      signal = (cell.historical_anomaly as number) >= ELEVATED_Z ? "elevated" : "not_elevated";
      if (signal === "elevated") elevated++;
      else notElevated++;
    }
    sensors[key] = {
      available: true,
      activity_rate: cell.activity_rate,
      historical_anomaly: cell.historical_anomaly,
      observation_coverage: cell.observation_coverage,
      signal_status: signal,
    };
  }

  let status: SensorComparison["status"];
  let interpretation: string;
  if (usable === 0) {
    status = "insufficient";
    interpretation =
      "Ninguna fuente alcanza la cobertura minima o la linea base necesaria para comparar.";
  } else if (usable === 1) {
    status = "single_sensor";
    interpretation =
      "Solo una fuente es utilizable en este mes. No se puede evaluar concordancia entre sensores.";
  } else if (elevated >= 2 && notElevated === 0) {
    status = "concordant_elevated";
    interpretation =
      "Dos o mas sensores con cobertura suficiente senalan actividad por encima de su patron estacional.";
  } else if (notElevated >= 2 && elevated === 0) {
    status = "concordant_not_elevated";
    interpretation =
      "Los sensores comparables coinciden en que la actividad no supera su umbral estacional.";
  } else {
    status = "discordant";
    interpretation =
      "Los sensores no coinciden. Revisar cobertura, hora de sobrevuelo y diferencias instrumentales antes de interpretar.";
  }

  return { period_id: periodId, status, sensors, interpretation };
}

/**
 * Arbol de decision de susceptibilidad contextual (seccion 7 del documento
 * tecnico v1.7).
 *
 * ATENCION: igual que la comparacion, en produccion lo precomputa Tom y llega
 * por `/summary`. Esta copia local es solo para desarrollo, y mantiene los
 * mismos nodos, categorias y ruta de decision del contrato.
 */
export function deriveSusceptibility(
  env: EnvConditions | null,
  thermalElevated: boolean
): SusceptibilityAssessment {
  const path: string[] = [];
  const rules: string[] = [];
  const modifiers: string[] = [];
  const missing: string[] = [];

  if (!env) {
    return {
      classification: "not_evaluable",
      decision_path: ["N0:fail"],
      rules_triggered: [],
      modifiers: [],
      evidence: [],
      missing_variables: ["cobertura vegetal", "sequedad", "meteorologia"],
    };
  }

  // Umbrales: parametros del modulo analitico, no constantes universales.
  const UMBRAL_VEG = 35; // % de cobertura potencialmente combustible
  const UMBRAL_PEND = 12; // grados de pendiente media
  const P25_PRECIP = 60; // mm acumulados en 30 dias
  const P25_SOIL = 0.22; // fraccion volumetrica
  const P75_WIND = 4.5; // m/s
  const P75_TEMP = 26; // °C
  const P25_RH = 45; // %

  const evidence: SusceptibilityAssessment["evidence"] = [
    {
      variable: "vegetation_area_pct",
      value: env.vegetation_area_pct,
      unit: "%",
      rule_status: env.vegetation_area_pct >= UMBRAL_VEG ? "sobre_umbral" : "bajo_umbral",
      source_product: "MAPBIOMAS_PERU_C4",
    },
    {
      variable: "precip_30d_mm",
      value: env.precip_30d_mm,
      unit: "mm",
      rule_status: env.precip_30d_mm < P25_PRECIP ? "bajo_p25_estacional" : "normal",
      source_product: "ERA5_LAND_HOURLY",
    },
    {
      variable: "soil_moisture_surface",
      value: env.soil_moisture_surface,
      unit: "m3/m3",
      rule_status: env.soil_moisture_surface < P25_SOIL ? "bajo_p25_estacional" : "normal",
      source_product: "ERA5_LAND_HOURLY",
    },
    {
      variable: "wind_speed_10m_ms",
      value: env.wind_speed_10m_ms,
      unit: "m/s",
      rule_status: env.wind_speed_10m_ms > P75_WIND ? "sobre_p75_estacional" : "normal",
      source_product: "ERA5_LAND_HOURLY",
    },
    {
      variable: "relative_humidity_2m_pct",
      value: env.relative_humidity_2m_pct,
      unit: "%",
      rule_status: env.relative_humidity_2m_pct < P25_RH ? "bajo_p25_estacional" : "normal",
      source_product: "ERA5_LAND_HOURLY",
    },
    {
      variable: "slope_mean_deg",
      value: env.slope_mean_deg,
      unit: "grados",
      rule_status: env.slope_mean_deg >= UMBRAL_PEND ? "pendiente_elevada" : "normal",
      source_product: "SRTM",
    },
  ];

  // N0 — compuerta de calidad
  path.push("N0:pass");

  // N1 — vegetacion combustible
  if (env.vegetation_area_pct < UMBRAL_VEG) {
    path.push("N1:no");
    return {
      classification: "low",
      decision_path: path,
      rules_triggered: rules,
      modifiers,
      evidence,
      missing_variables: missing,
    };
  }
  path.push("N1:yes");
  rules.push("vegetation_present");

  // N2 — sequedad
  const dry = env.precip_30d_mm < P25_PRECIP || env.soil_moisture_surface < P25_SOIL;
  const windy = env.wind_speed_10m_ms > P75_WIND;
  const hotDry = env.temperature_2m_c > P75_TEMP && env.relative_humidity_2m_pct < P25_RH;
  const steep = env.slope_mean_deg >= UMBRAL_PEND;

  if (steep) modifiers.push("steep_slope_share_high");
  if (thermalElevated) modifiers.push("thermal_history_elevated");
  if (env.water_area_pct >= 5) modifiers.push("water_share_high");

  let classification: SusceptibilityAssessment["classification"];
  if (dry) {
    path.push("N2:yes");
    rules.push("dryness_high");
    if (windy || hotDry) {
      path.push("N3a:yes");
      if (windy) rules.push("wind_high");
      if (hotDry) rules.push("hot_dry_air");
      classification = "high";
    } else {
      path.push("N3a:no");
      classification = "moderate";
    }
  } else {
    path.push("N2:no");
    if (windy && steep) {
      path.push("N3b:yes");
      rules.push("wind_high", "steep_slope");
      classification = "moderate";
    } else {
      path.push("N3b:no");
      classification = "low";
    }
  }

  return {
    classification,
    decision_path: path,
    rules_triggered: rules,
    modifiers,
    evidence,
    missing_variables: missing,
  };
}

/** Peso de actividad segun la ubicacion. Solo para el juego de muestra. */
function localActivityWeight(center: LatLon): number {
  const [lat, lon] = center;
  const amazon = lon > -77.5 && lat > -13.5 && lat < -3;
  const coast = lon < -78.5;
  if (coast) return 0.12;
  if (amazon) return 1.6;
  return 0.7;
}

export const SENSOR_LABELS = SENSOR_META;
