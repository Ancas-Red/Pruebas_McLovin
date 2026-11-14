/**
 * DATOS DE MUESTRA — NO SON OBSERVACIONES REALES
 * ==============================================
 * Generador determinista que alimenta la interfaz mientras el backend
 * (Angelo/Tom) no publica `data/processed/`. Reproduce la *forma* de la senal
 * (estacionalidad, distribucion espacial, diferencias entre sensores) para
 * poder construir y probar las vistas, no sus valores.
 *
 * Toda la UI que consuma esto debe mostrar el distintivo "DATOS DE MUESTRA".
 * Nunca se presentan estas cifras como resultados en la demo ni en el pitch.
 */

import type { Confidence, DayPoint, EnvConditions, Hotspot, MonthCell, Sensor } from "../api/types";
import { SENSOR_META } from "../api/types";
import { PERU_BOUNDS, pointInRing, type LatLon } from "./geo";

/* -------------------------------------------------------------------------- */
/* Aleatoriedad reproducible                                                   */
/* -------------------------------------------------------------------------- */

/** PRNG mulberry32: misma semilla, misma salida, en cualquier navegador. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Campo espacial: donde se concentra la actividad termica en el Peru          */
/* -------------------------------------------------------------------------- */

/**
 * Focos de densidad aproximados por region. Sirven para que la nube de puntos
 * no sea uniforme y se parezca a un patron territorial creible.
 * [lat, lon, peso, dispersion en grados]
 */
const DENSITY_NODES: [number, number, number, number][] = [
  [-8.4, -74.6, 1.0, 1.5], // Ucayali / Pucallpa
  [-11.9, -70.6, 0.95, 1.4], // Madre de Dios
  [-6.5, -76.4, 0.85, 1.2], // San Martin
  [-4.6, -73.6, 0.7, 1.8], // Loreto / Amazonas bajo
  [-12.6, -73.9, 0.6, 1.0], // VRAEM / Ayacucho selva
  [-13.5, -71.9, 0.55, 0.8], // Cusco valles
  [-9.5, -77.3, 0.4, 0.7], // Ancash sierra
  [-15.5, -70.4, 0.4, 0.9], // Puno altiplano
  [-5.9, -78.6, 0.5, 0.9], // Cajamarca / Amazonas
  [-16.3, -71.6, 0.3, 0.7], // Arequipa
  [-7.2, -78.5, 0.35, 0.6], // Cajamarca sur
  [-10.9, -75.2, 0.5, 0.9], // Junin selva central
];

/** Peso relativo de actividad en un punto, 0 a ~1. */
function spatialWeight(lat: number, lon: number): number {
  let w = 0;
  for (const [nlat, nlon, weight, spread] of DENSITY_NODES) {
    const d2 = ((lat - nlat) / spread) ** 2 + ((lon - nlon) / spread) ** 2;
    w += weight * Math.exp(-d2);
  }
  // La franja costera desertica casi no registra actividad.
  const coastal = Math.max(0, 1 - Math.exp(-(((lon + 79.5) / 1.2) ** 2)) * 0.9);
  return Math.min(1, w * coastal);
}

/* -------------------------------------------------------------------------- */
/* Estacionalidad                                                              */
/* -------------------------------------------------------------------------- */

/** Peso por mes (indice 0 = enero). Pico en la estacion seca, agosto-octubre. */
const SEASON = [0.1, 0.09, 0.08, 0.1, 0.22, 0.45, 0.72, 1.0, 1.0, 0.78, 0.42, 0.2];

/** Tendencia suave interanual mas variabilidad por anio. */
function yearFactor(year: number): number {
  const r = rng(hashStr(`yr-${year}`));
  const trend = 1 + (year - 2001) * 0.012;
  const noise = 0.65 + r() * 0.75;
  // Anios con sequia marcada en la Amazonia
  const drought = year === 2005 || year === 2010 || year === 2016 || year === 2024 ? 1.45 : 1;
  return trend * noise * drought;
}

/** Sensibilidad relativa de cada sensor. No son factores de calibracion. */
const SENSOR_GAIN: Record<Sensor, number> = {
  MODIS_TERRA: 1.0,
  MODIS_AQUA: 0.88,
  VIIRS_SNPP: 1.26,
};

export const FIXTURE_FIRST_YEAR = 2001;
export const FIXTURE_LAST_YEAR = 2026;
/** Ultimo mes completo disponible en el juego de muestra. */
export const FIXTURE_LAST_MONTH = 10; // octubre de 2026

export function sensorAvailable(sensor: Sensor, year: number, month: number): boolean {
  const meta = SENSOR_META[sensor];
  if (year < meta.since) return false;
  if (year === FIXTURE_LAST_YEAR && month > FIXTURE_LAST_MONTH) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Hotspots                                                                    */
/* -------------------------------------------------------------------------- */

const CONF_BANDS: { c: Confidence; p: number }[] = [
  { c: "low", p: 0.22 },
  { c: "nominal", p: 0.52 },
  { c: "high", p: 0.26 },
];

function pickConfidence(u: number): Confidence {
  let acc = 0;
  for (const b of CONF_BANDS) {
    acc += b.p;
    if (u <= acc) return b.c;
  }
  return "nominal";
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Genera los hotspots de un mes para un sensor, sobre todo el Peru.
 * El resultado se memoiza: la misma consulta devuelve siempre lo mismo.
 */
const hotspotCache = new Map<string, Hotspot[]>();

export function monthlyHotspots(sensor: Sensor, year: number, month: number): Hotspot[] {
  const key = `${sensor}|${year}|${month}`;
  const cached = hotspotCache.get(key);
  if (cached) return cached;
  if (!sensorAvailable(sensor, year, month)) {
    hotspotCache.set(key, []);
    return [];
  }

  const r = rng(hashStr(key));
  const base = 1500 * SEASON[month - 1] * yearFactor(year) * SENSOR_GAIN[sensor];
  const target = Math.round(base * (0.85 + r() * 0.3));
  const nDays = daysInMonth(year, month);

  const out: Hotspot[] = [];
  let guard = 0;
  while (out.length < target && guard < target * 24) {
    guard++;
    const lat = PERU_BOUNDS.south + r() * (PERU_BOUNDS.north - PERU_BOUNDS.south);
    const lon = PERU_BOUNDS.west + r() * (PERU_BOUNDS.east - PERU_BOUNDS.west);
    // Muestreo por rechazo contra el campo de densidad.
    if (r() > spatialWeight(lat, lon)) continue;

    const day = 1 + Math.floor(r() * nDays);
    const conf = pickConfidence(r());
    // FRP con cola larga: muchos focos debiles, pocos muy intensos.
    const frp = Math.round((2 + Math.pow(r(), 3) * 260) * 10) / 10;
    const hh = sensor === "MODIS_TERRA" ? 14 + Math.floor(r() * 2) : 17 + Math.floor(r() * 3);
    const mm = Math.floor(r() * 60);

    out.push({
      id: `${sensor}-${year}${String(month).padStart(2, "0")}-${out.length}`,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      sensor,
      frp,
      confidence: conf,
      acq_time: `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  hotspotCache.set(key, out);
  return out;
}

/** Filtra hotspots por el area de interes. Sin area, devuelve todo el Peru. */
export function filterByArea(points: Hotspot[], ring: LatLon[] | null): Hotspot[] {
  if (!ring || ring.length < 3) return points;
  return points.filter((h) => pointInRing([h.lat, h.lon], ring));
}

/* -------------------------------------------------------------------------- */
/* Calendario e indicadores                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fraccion del area de interes respecto al Peru, con un suelo para que un
 * poligono pequenio no deje el calendario en cero.
 */
function areaShare(ring: LatLon[] | null, areaKm2: number): number {
  if (!ring) return 1;
  const PERU_KM2 = 1_285_000;
  return Math.max(0.0012, Math.min(1, areaKm2 / PERU_KM2));
}

/**
 * Serie mensual del calendario. Para el mes mostrado en el mapa se cuentan los
 * hotspots reales del juego de muestra; el resto se deriva del mismo modelo
 * estacional, que es mucho mas barato que generar 26 anios de puntos.
 */
export function buildCalendar(
  sensor: Sensor,
  ring: LatLon[] | null,
  areaKm2: number,
  localWeight: number
): MonthCell[] {
  const share = areaShare(ring, areaKm2);
  const cells: MonthCell[] = [];
  const rates: Record<number, number[]> = {};

  for (let year = FIXTURE_FIRST_YEAR; year <= FIXTURE_LAST_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      if (!sensorAvailable(sensor, year, month)) continue;
      const r = rng(hashStr(`cal|${sensor}|${year}|${month}|${share.toFixed(5)}`));

      const expected =
        1500 * SEASON[month - 1] * yearFactor(year) * SENSOR_GAIN[sensor] * share * localWeight;
      const detections = Math.max(0, Math.round(expected * (0.7 + r() * 0.6)));

      // Cobertura de observacion: peor en temporada humeda por nubosidad.
      const cloudiness = 1 - SEASON[month - 1] * 0.55;
      const coverage = Math.max(0.25, Math.min(0.97, 0.9 - cloudiness * 0.38 + (r() - 0.5) * 0.12));

      // Pixeles-dia terrestres validos aproximados para el denominador.
      const validPixelDays = Math.max(
        1,
        Math.round(1_285_000 * share * coverage * daysInMonth(year, month) * 0.0009)
      );
      const activity_rate = coverage < 0.15 ? null : detections / validPixelDays;

      const nDays = daysInMonth(year, month);
      const active_days = Math.min(nDays, Math.round(Math.min(nDays, Math.sqrt(detections) * 1.5)));
      const max_consecutive_active_days = Math.max(
        active_days > 0 ? 1 : 0,
        Math.round(active_days * (0.3 + r() * 0.35))
      );

      if (activity_rate !== null) {
        (rates[month] ||= []).push(activity_rate);
      }

      cells.push({
        year,
        month,
        detections,
        activity_rate,
        observation_coverage: coverage,
        active_days,
        max_consecutive_active_days,
        historical_anomaly: null,
        baseline_years: 0,
      });
    }
  }

  // Anomalia robusta frente al mismo mes calendario de anios anteriores.
  for (const cell of cells) {
    const history = (rates[cell.month] || []).filter((_, i) => i < cell.year - FIXTURE_FIRST_YEAR);
    cell.baseline_years = history.length;
    if (cell.activity_rate === null || history.length < 5) continue;
    const med = median(history);
    const mad = median(history.map((v) => Math.abs(v - med)));
    // MAD ~ 0 deja la z robusta sin sentido: se marca como no estimable.
    if (mad < 1e-9) continue;
    cell.historical_anomaly = (cell.activity_rate - med) / (1.4826 * mad);
  }

  return cells;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Serie diaria del mes seleccionado, derivada de los hotspots del area. */
export function buildDailySeries(
  points: Hotspot[],
  year: number,
  month: number,
  coverageHint: number
): DayPoint[] {
  const nDays = daysInMonth(year, month);
  const counts = new Map<string, number>();
  for (const h of points) {
    if (h.confidence === "low") continue; // el indicador principal usa 8-9
    counts.set(h.date, (counts.get(h.date) ?? 0) + 1);
  }
  const out: DayPoint[] = [];
  for (let d = 1; d <= nDays; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const r = rng(hashStr(`cov|${date}`));
    out.push({
      date,
      detections: counts.get(date) ?? 0,
      observation_coverage: Math.max(0, Math.min(1, coverageHint + (r() - 0.5) * 0.3)),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Contexto ambiental                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Variables ambientales de muestra para el area y mes seleccionados.
 * Coherentes con la estacion y la latitud, pero no medidas.
 */
export function buildEnvConditions(
  center: LatLon,
  year: number,
  month: number
): EnvConditions {
  const r = rng(hashStr(`env|${center[0].toFixed(2)}|${center[1].toFixed(2)}|${year}|${month}`));
  const dry = SEASON[month - 1]; // 0 humedo, 1 seco
  const amazon = center[1] > -77 && center[0] > -13;
  const altitudeProxy = Math.max(0, Math.min(1, (-center[1] - 70) / 9));

  return {
    wind_speed_10m_ms: Math.round((1.6 + dry * 4.2 + r() * 2.6) * 10) / 10,
    wind_direction_deg: Math.round(r() * 360),
    temperature_2m_c:
      Math.round(((amazon ? 27 : 17) - altitudeProxy * 7 + dry * 3 + (r() - 0.5) * 3) * 10) / 10,
    relative_humidity_2m_pct: Math.round((amazon ? 84 : 66) - dry * 28 + (r() - 0.5) * 9),
    precip_30d_mm: Math.round((amazon ? 230 : 110) * (1 - dry * 0.88) * (0.6 + r() * 0.8)),
    soil_moisture_surface: Math.round((0.36 - dry * 0.2 + (r() - 0.5) * 0.07) * 1000) / 1000,
    ndvi_median: Math.round((amazon ? 0.79 : 0.46) - dry * 0.14 + (r() - 0.5) * 0.08 * 100) / 100,
    vegetation_area_pct: Math.round((amazon ? 86 : 52) + (r() - 0.5) * 18),
    water_area_pct: Math.round((amazon ? 4.5 : 1.2) * (0.5 + r()) * 10) / 10,
    slope_mean_deg: Math.round(((amazon ? 4 : 17) + (r() - 0.5) * 9) * 10) / 10,
  };
}
