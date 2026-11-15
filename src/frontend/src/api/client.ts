/**
 * Único punto de contacto con `/api/v1`.
 *
 * Reglas que este módulo respeta al pie de la letra (contrato v1.2):
 *
 *  - Solo `GET`. La API es de solo lectura.
 *  - **El frontend no calcula** tasas, anomalías ni categorías: las pide.
 *  - Una consulta de actividad = **un** sensor. Nunca se suman conteos.
 *  - `null` nunca se convierte en `0` por el camino.
 *  - Las fechas disponibles las decide `metadata`, no esta interfaz.
 *
 * Cuando el backend no responde, la aplicación sigue viva con el juego de
 * muestra de `lib/fixtures.ts`, que imita la **forma** del contrato. Eso se
 * avisa en pantalla con el rótulo «Datos de muestra»: no es lo mismo que un
 * dato real y no debe presentarse como tal.
 */

import type {
  AnomalyStatus,
  ApiErrorBody,
  DailyRow,
  DateRange,
  HistoricalAnomaly,
  HotspotCollection,
  MetricId,
  MetricResponse,
  Metadata,
  Sensor,
  SensorComparison,
  TerritoryCollection,
  TerritorySummary,
  TerritoryType,
} from "./types";
import { ACTIVITY_METRICS, SCHEMA_VERSION, SENSORS } from "./types";

/* -------------------------------------------------------------------------- */
/* Configuración                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resuelve la URL base de la API aceptando `VITE_API_BASE` o `VITE_API_BASE_URL`.
 * Normaliza barras finales y añade `/api/v1` si se configuró solo el dominio raíz
 * (por ejemplo `https://mchanaq-api.azurewebsites.net` desde Cloudflare Pages).
 */
export function resolveApiBase(raw?: string): string {
  const cleaned = (raw ?? "").trim().replace(/\/+$/, "");
  if (!cleaned) return "http://localhost:8000/api/v1";
  return cleaned.endsWith("/api/v1") ? cleaned : `${cleaned}/api/v1`;
}

/**
 * Base de la API. En Cloudflare Pages se configura al compilar mediante
 * `VITE_API_BASE` (o `VITE_API_BASE_URL`) apuntando al App Service de Azure.
 * En desarrollo apunta a uvicorn local en el puerto 8000.
 */
export const API_BASE: string = resolveApiBase(
  (import.meta.env?.VITE_API_BASE as string | undefined) ||
    (import.meta.env?.VITE_API_BASE_URL as string | undefined)
);

/** Cuánto se espera a la API antes de darla por caída. */
const TIMEOUT_MS = 8000;

/* -------------------------------------------------------------------------- */
/* Errores y cancelación                                                      */
/* -------------------------------------------------------------------------- */

/** Error con el `code` del contrato, para que la interfaz pueda reaccionar. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
    readonly http: number
  ) {
    super(detail || code);
    this.name = "ApiError";
  }

  /** La fecha es válida pero no está publicada: no es un fallo del usuario. */
  get isPeriodUnavailable() {
    return this.code === "PERIOD_NOT_AVAILABLE";
  }
  get isNotFound() {
    return this.code === "NOT_FOUND";
  }
}

/**
 * Una petición cancelada no es un error: ocurre cada vez que el usuario
 * cambia de día o de territorio mientras la anterior viajaba.
 */
export function isAbort(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return e instanceof Error && (e.name === "AbortError" || e.message === "aborted");
}

/* -------------------------------------------------------------------------- */
/* Transporte                                                                 */
/* -------------------------------------------------------------------------- */

/** Une el `signal` de quien llama con un plazo propio. */
function withTimeout(
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", relay, { once: true });
  }
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relay);
    },
  };
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Construye una URL de la API. Se expone porque el CSV se abre en el navegador. */
export function apiUrl(path: string, params: Record<string, string | number | undefined | null> = {}): string {
  return `${API_BASE}${path}${qs(params)}`;
}

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
  signal?: AbortSignal
): Promise<T> {
  const { signal: s, done } = withTimeout(signal);
  try {
    const res = await fetch(apiUrl(path, params), {
      signal: s,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        /* el cuerpo no era JSON: nos quedamos con el código HTTP */
      }
      throw new ApiError(body?.code ?? "INTERNAL_ERROR", body?.detail ?? res.statusText, res.status);
    }

    const data = (await res.json()) as T & { schema_version?: string };

    // Un esquema distinto puede traer campos renombrados: se avisa en consola
    // en vez de pintar datos mal interpretados en silencio.
    if (data?.schema_version && data.schema_version !== SCHEMA_VERSION) {
      console.warn(
        `[McHanaq] schema_version ${data.schema_version} ≠ ${SCHEMA_VERSION} esperada en ${path}. ` +
          `Revisar contracts/api-contract.md antes de confiar en la pantalla.`
      );
    }
    return data;
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* 1 · /health                                                                */
/* -------------------------------------------------------------------------- */

export type BackendState = "checking" | "online" | "offline";

let backendState: BackendState = "checking";
export function getBackendState(): BackendState {
  return backendState;
}

export interface Health {
  status: string;
  data_loaded: boolean;
  data_dir?: string;
}

/**
 * `data_loaded: false` cuenta como caído: el servicio está en pie pero no
 * tiene datos que servir, y pintar una pantalla vacía sería peor que avisar.
 */
export async function probeBackend(signal?: AbortSignal): Promise<BackendState> {
  try {
    const h = await get<Health>("/health", {}, signal);
    backendState = h.status === "ok" && h.data_loaded ? "online" : "offline";
  } catch (e) {
    if (isAbort(e)) return backendState;
    backendState = "offline";
  }
  return backendState;
}

/* -------------------------------------------------------------------------- */
/* 2 · /metadata                                                              */
/* -------------------------------------------------------------------------- */

export function fetchMetadata(signal?: AbortSignal): Promise<Metadata> {
  return get<Metadata>("/metadata", {}, signal);
}

/* -------------------------------------------------------------------------- */
/* 3 · /territories                                                           */
/* -------------------------------------------------------------------------- */

export function fetchTerritories(type: TerritoryType, signal?: AbortSignal): Promise<TerritoryCollection> {
  return get<TerritoryCollection>("/territories", { type }, signal);
}

/* -------------------------------------------------------------------------- */
/* 4 · /territory-metrics  (coropleta)                                        */
/* -------------------------------------------------------------------------- */

/** `sensor` es obligatorio solo para las métricas de actividad. */
export function metricNeedsSensor(metric: MetricId): boolean {
  return (ACTIVITY_METRICS as string[]).includes(metric);
}

export interface MetricQuery {
  type: TerritoryType;
  metric: MetricId;
  /** Diario por defecto. Si se omite, se usa `period`. */
  date?: string;
  period?: string;
  sensor?: Sensor;
}

export function fetchTerritoryMetrics(q: MetricQuery, signal?: AbortSignal): Promise<MetricResponse> {
  return get<MetricResponse>(
    "/territory-metrics",
    {
      type: q.type,
      metric: q.metric,
      date: q.date,
      period: q.date ? undefined : q.period,
      sensor: metricNeedsSensor(q.metric) ? q.sensor : undefined,
    },
    signal
  );
}

/* -------------------------------------------------------------------------- */
/* 5 · /territories/{type}/{id}/summary                                       */
/* -------------------------------------------------------------------------- */

export interface SummaryQuery {
  type: TerritoryType;
  id: string;
  sensor: Sensor;
  date?: string;
  period?: string;
}

export function fetchSummary(q: SummaryQuery, signal?: AbortSignal): Promise<TerritorySummary> {
  return get<TerritorySummary>(
    `/territories/${encodeURIComponent(q.type)}/${encodeURIComponent(q.id)}/summary`,
    { sensor: q.sensor, date: q.date, period: q.date ? undefined : q.period },
    signal
  );
}

/* -------------------------------------------------------------------------- */
/* 6 · /territories/{type}/{id}/activity  (serie diaria)                      */
/* -------------------------------------------------------------------------- */

export interface ActivityQuery {
  type: TerritoryType;
  id: string;
  sensor: Sensor;
  from?: string;
  to?: string;
  period?: string;
}

export interface ActivityResponse {
  schema_version: string;
  territory: { type: TerritoryType; id: string };
  territory_type?: TerritoryType;
  territory_id?: string;
  sensor: Sensor;
  from?: string | null;
  to?: string | null;
  period?: string | null;
  items: DailyRow[];
}

export async function fetchActivity(q: ActivityQuery, signal?: AbortSignal): Promise<ActivityResponse> {
  const byRange = Boolean(q.from && q.to);
  const res = await get<ActivityResponse>(
    `/territories/${encodeURIComponent(q.type)}/${encodeURIComponent(q.id)}/activity`,
    {
      sensor: q.sensor,
      from: byRange ? q.from : undefined,
      to: byRange ? q.to : undefined,
      period: byRange ? undefined : q.period,
    },
    signal
  );
  if (!res.territory) {
    res.territory = {
      type: res.territory_type ?? q.type,
      id: res.territory_id ?? q.id,
    };
  }
  return res;
}

/* -------------------------------------------------------------------------- */
/* 6b · /territories/{type}/{id}/calendar  (opcional, serie mensual)          */
/* -------------------------------------------------------------------------- */

export interface CalendarItem {
  period?: string;
  period_id?: string;
  year?: number;
  month?: number;
  detections?: number | null;
  fire_pixel_days_8_9?: number | null;
  detections_low?: number | null;
  fire_pixel_days_7_9?: number | null;
  fire_pixel_days_7?: number | null;
  activity_rate: number | null;
  observation_coverage: number | null;
  active_days: number | null;
  max_consecutive_active_days: number | null;
  unobserved_days?: number;
  days_with_data?: number;
  historical_anomaly?: number | HistoricalAnomaly | null;
  anomaly_status?: AnomalyStatus;
  baseline_years?: number;
}

export interface CalendarResponse {
  schema_version?: string;
  territory?: { type: TerritoryType; id: string };
  territory_type?: TerritoryType;
  territory_id?: string;
  sensor?: Sensor;
  items: CalendarItem[];
}

export function fetchCalendar(
  type: TerritoryType,
  id: string,
  sensor: Sensor,
  signal?: AbortSignal
): Promise<CalendarResponse> {
  return get<CalendarResponse>(
    `/territories/${encodeURIComponent(type)}/${encodeURIComponent(id)}/calendar`,
    { sensor },
    signal
  );
}

/* -------------------------------------------------------------------------- */
/* 7 · /territories/{type}/{id}/sensor-comparison                             */
/* -------------------------------------------------------------------------- */

/**
 * Lo que antes derivaba el frontend ahora lo entrega la API, que es quien
 * conoce la cobertura mínima y el umbral `robust_z`.
 */
export function fetchSensorComparison(
  q: { type: TerritoryType; id: string; date?: string; period?: string },
  signal?: AbortSignal
): Promise<SensorComparison> {
  return get<SensorComparison>(
    `/territories/${encodeURIComponent(q.type)}/${encodeURIComponent(q.id)}/sensor-comparison`,
    { date: q.date, period: q.date ? undefined : q.period },
    signal
  );
}

/* -------------------------------------------------------------------------- */
/* 8 · /territories/{type}/{id}/export.csv                                    */
/* -------------------------------------------------------------------------- */

/** El navegador descarga directo de la API: no pasa por esta interfaz. */
export function exportCsvUrl(q: {
  type: TerritoryType;
  id: string;
  from: string;
  to: string;
  sensor: Sensor;
}): string {
  return apiUrl(`/territories/${encodeURIComponent(q.type)}/${encodeURIComponent(q.id)}/export.csv`, {
    from: q.from,
    to: q.to,
    sensor: q.sensor,
  });
}

/* -------------------------------------------------------------------------- */
/* 9 · /territories/{type}/{id}/hotspots  (prioridad 3)                       */
/* -------------------------------------------------------------------------- */

/**
 * Puede no existir: solo hay respuesta si el backend tiene `hotspots.geojson`.
 * Un `404` aquí es un estado previsto; un `200 OK` con `features: []` indica
 * cero focos observados en el backend real.
 */
export function fetchHotspots(
  q: { type: TerritoryType; id: string; date: string; sensor: Sensor },
  signal?: AbortSignal
): Promise<HotspotCollection> {
  return get<HotspotCollection>(
    `/territories/${encodeURIComponent(q.type)}/${encodeURIComponent(q.id)}/hotspots`,
    { date: q.date, sensor: q.sensor },
    signal
  );
}

/* -------------------------------------------------------------------------- */
/* 10 · Fase 2 / tiempo real global (desacoplado de Fase 1)                   */
/* -------------------------------------------------------------------------- */

export interface ReverseGeocodeLocation {
  status: string;
  source?: string;
  country?: string | null;
  country_code?: string | null;
  region?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  hierarchy?: string[];
  header_primary?: string | null;
  header_sub?: string | null;
  display_name?: string | null;
}

export interface RealtimeAreaResponse {
  days?: number;
  firms_mode?: string;
  truncated?: boolean;
  location?: ReverseGeocodeLocation;
  weather: {
    status?: string;
    source?: string;
    observed_at?: string;
    t_amb_c?: number | null;
    relative_humidity_2m_pct?: number | null;
    wind_speed_10m_ms?: number | null;
    wind_dir_deg?: number | null;
  };
  hotspots_status: string;
  counts_by_sensor: Record<string, number>;
  hotspots?: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: "Point"; coordinates: [number, number] };
      properties: {
        sensor: string;
        firms_source?: string;
        acq_date?: string | null;
        acq_time?: string | null;
        confidence?: number | string | null;
        frp_mw?: number | null;
        satellite?: string | null;
        daynight?: string | null;
      };
    }>;
  };
}

export interface SpreadSimulateResponse {
  territory?: { type: string; id: string; name: string };
  date?: string;
  horizon_h?: number;
  dominant_wind?: { wind_dir_deg: number; wind_speed_10m_ms: number };
  hourly_wind?: Array<{
    hour: number;
    wind_speed_ms?: number;
    wind_dir_deg?: number;
    temp_c?: number | null;
    rh_pct?: number | null;
    source?: string;
  }>;
  slope_summary?: { mean_deg?: number; max_deg?: number; dem_source?: string };
  savi_summary?: { mean?: number; p90?: number; source?: string };
  data_sources?: { wind_source?: string; dem_source?: string; vegetation_index?: string };
  timings_s?: Record<string, number>;
}

const PHASE2_REALTIME_TIMEOUT_MS = 12000;
const PHASE2_SIMULATE_TIMEOUT_MS = 10000;

const PHASE2_GEOCODE_TIMEOUT_MS = 5000;

/**
 * Resuelve país, región/estado, provincia/condado y ciudad/distrito vía OSM Nominatim.
 */
export async function fetchReverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<ReverseGeocodeLocation | null> {
  const { signal: s, done } = withTimeout(signal, PHASE2_GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/reverse-geocode", { lat, lon }), {
      signal: s,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ReverseGeocodeLocation;
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Consulta clima global (Open-Meteo) y focos NRT (NASA FIRMS) para cualquier bbox.
 * Nunca propaga excepciones ni bloquea la UI si el backend o red externa están caídos.
 */
export async function fetchRealtimeArea(
  bbox: { south: number; west: number; north: number; east: number },
  days = 3,
  signal?: AbortSignal
): Promise<RealtimeAreaResponse | null> {
  const { signal: s, done } = withTimeout(signal, PHASE2_REALTIME_TIMEOUT_MS);
  try {
    const res = await fetch(
      apiUrl("/realtime/area", {
        south: bbox.south,
        west: bbox.west,
        north: bbox.north,
        east: bbox.east,
        days,
      }),
      {
        signal: s,
        headers: { Accept: "application/json" },
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as RealtimeAreaResponse;
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Simulación global Fase 2 vía `/api/v1/spread-simulate` (Open-Meteo + Copernicus GLO-90 DEM).
 * Devuelve `null` ante error HTTP, timeout (~6.5 s) o caída de red para habilitar fallback local.
 */
export async function postSpreadSimulate(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SpreadSimulateResponse | null> {
  const { signal: s, done } = withTimeout(signal, PHASE2_SIMULATE_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/spread-simulate"), {
      method: "POST",
      signal: s,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as SpreadSimulateResponse;
  } catch {
    return null;
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* Disponibilidad de fechas — la decide `metadata` (§5)                       */
/* -------------------------------------------------------------------------- */

/** Cobertura diaria mínima exigida para considerar un día analizable (<30% nubes). */
export const MIN_USEFUL_COVERAGE = 0.7;

export function rangeBounds(r: DateRange | undefined | null): { from: string; to: string } | null {
  if (!r || typeof r !== "object") return null;
  const from = r.from || r.start || "";
  const to = r.to || r.end || "";
  return from && to ? { from, to } : null;
}

/**
 * Valida que `/api/v1/metadata` traiga sensores y al menos un rango de fechas
 * utilizable; si llega vacío (p. ej. `data_loaded: false`), se cae a muestra.
 */
export function hasUsableMetadata(meta: Partial<Metadata> | null | undefined): meta is Metadata {
  if (!meta || typeof meta !== "object") return false;
  if (!Array.isArray(meta.sensors) || meta.sensors.length === 0) return false;
  const rangesBySensor = meta.available_date_ranges_by_sensor;
  if (!rangesBySensor || typeof rangesBySensor !== "object") return false;
  return Object.values(rangesBySensor).some(
    (ranges) => Array.isArray(ranges) && ranges.some((r) => rangeBounds(r) !== null)
  );
}

function inRanges(date: string, ranges: DateRange[] | undefined): boolean {
  if (!ranges?.length) return false;
  return ranges.some((r) => {
    const b = rangeBounds(r);
    return b !== null && date >= b.from && date <= b.to;
  });
}

function periodInRanges(period: string, ranges: DateRange[] | undefined): boolean {
  if (!ranges?.length) return false;
  return ranges.some((r) => {
    const b = rangeBounds(r);
    return b !== null && period >= b.from.slice(0, 7) && period <= b.to.slice(0, 7);
  });
}

/** ¿Hay datos de ese sensor ese día? (`activity`, `metrics`, `export.csv`) */
export function isDateAvailable(date: string, sensor: Sensor, meta: Metadata | null): boolean {
  if (!meta) return false;
  const useful = meta.available_useful_dates_by_sensor?.[sensor];
  const rng = meta.available_date_ranges_by_sensor?.[sensor];
  const periods = meta.available_periods_by_sensor?.[sensor];
  const inPublished = rng?.length
    ? inRanges(date, rng)
    : periods?.length
      ? periods.includes(periodOf(date))
      : Boolean(useful?.length);
  if (inPublished) {
    if (Array.isArray(useful)) return useful.includes(date);
    return true;
  }
  // Fuera de la tabla diaria local (p. ej. años anteriores a 2022): no es un "día útil"
  // validado, pero si el backend tiene FIRMS_MAP_KEY configurada, /summary lo complementa
  // con una consulta en vivo a NASA FIRMS. Se deja seleccionar en vez de bloquear.
  const liveSince = meta.firms_live_available_since_by_sensor?.[sensor];
  if (liveSince && date >= liveSince) {
    const today = new Date().toISOString().slice(0, 10);
    return date <= today;
  }
  return false;
}

/** ¿El período `YYYY-MM` está publicado para ese sensor? */
export function isPeriodAvailable(period: string, sensor: Sensor, meta: Metadata | null): boolean {
  if (!meta) return false;
  const rng = meta.available_date_ranges_by_sensor?.[sensor];
  if (rng?.length) return periodInRanges(period, rng);
  return meta.available_periods_by_sensor?.[sensor]?.includes(period) ?? false;
}

/** ¿Hay variables ambientales ese día? (métricas sin sensor) */
export function isEnvDateAvailable(date: string, meta: Metadata | null): boolean {
  if (!meta) return false;
  if (meta.common_environmental_dates?.length) return inRanges(date, meta.common_environmental_dates);
  return meta.common_environmental_periods?.includes(periodOf(date)) ?? false;
}

/** ¿Hay variables ambientales en ese período `YYYY-MM`? */
export function isEnvPeriodAvailable(period: string, meta: Metadata | null): boolean {
  if (!meta) return false;
  if (meta.common_environmental_periods?.length) return meta.common_environmental_periods.includes(period);
  if (meta.common_environmental_dates?.length) return periodInRanges(period, meta.common_environmental_dates);
  return false;
}

/** ¿Se puede comparar sensores ese día? */
export function isAnalysisDateAvailable(date: string, meta: Metadata | null): boolean {
  if (!meta) return false;
  if (meta.common_analysis_dates?.length) return inRanges(date, meta.common_analysis_dates);
  return meta.common_analysis_periods?.includes(periodOf(date)) ?? false;
}

/** La ficha exige las dos cosas a la vez: sensor **y** ambiental. */
export function isSummaryDateAvailable(date: string, sensor: Sensor, meta: Metadata | null): boolean {
  // La ficha se pide mientras la fecha caiga en la ventana publicada del
  // sensor: ni la lista de "días útiles" ni la ventana ambiental deben
  // bloquear la consulta (antes casi cualquier fecha salía «sin datos» sin
  // siquiera preguntarle al backend). El backend devuelve lo que tenga.
  if (!meta) return false;
  const rng = meta.available_date_ranges_by_sensor?.[sensor];
  const periods = meta.available_periods_by_sensor?.[sensor];
  const inPublished = rng?.length
    ? inRanges(date, rng)
    : periods?.length
      ? periods.includes(periodOf(date))
      : false;
  if (inPublished) return true;
  // Igual que isDateAvailable: fuera de la tabla diaria local pero dentro del piso
  // histórico "en vivo" (NASA FIRMS), si el backend tiene FIRMS_MAP_KEY configurada.
  const liveSince = meta.firms_live_available_since_by_sensor?.[sensor];
  if (liveSince && date >= liveSince) {
    const today = new Date().toISOString().slice(0, 10);
    return date <= today;
  }
  return isDateAvailable(date, sensor, meta);
}

/**
 * Último día publicado de un sensor.
 *
 * Sirve para abrir la herramienta en una fecha que exista de verdad. Sin
 * esto, la interfaz arranca en «hoy», el backend contesta
 * `PERIOD_NOT_AVAILABLE` para todo y el primer contacto con la aplicación es
 * una pantalla de avisos.
 */
export function lastAvailableDate(sensor: Sensor, meta: Metadata | null): string | null {
  const useful = meta?.available_useful_dates_by_sensor?.[sensor];
  if (Array.isArray(useful)) {
    if (useful.length === 0) return null;
    const sorted = [...useful].sort();
    return sorted[sorted.length - 1] ?? null;
  }
  const r = meta?.available_date_ranges_by_sensor?.[sensor];
  if (r?.length) {
    const ends = r.map((item) => rangeBounds(item)?.to ?? "").filter(Boolean).sort();
    return ends.length ? ends[ends.length - 1] : null;
  }
  const p = meta?.available_periods_by_sensor?.[sensor];
  if (p?.length) {
    const sorted = [...p].sort();
    const lastP = sorted[sorted.length - 1];
    if (lastP) {
      const [y, m] = lastP.split("-").map(Number);
      return monthRange(y, m).to;
    }
  }
  return null;
}

/** Sensores que publican algo ese día. */
export function sensorsAvailableOn(date: string, meta: Metadata | null): Sensor[] {
  if (!meta) return [];
  return SENSORS.filter((s) => isDateAvailable(date, s, meta));
}

/** Períodos `YYYY-MM` habilitados en la interfaz para un sensor. */
export function availablePeriodsForSensor(sensor: Sensor, meta: Metadata | null): Set<string> {
  const set = new Set<string>();
  if (!meta) return set;
  // OJO: antes cada rama (useful/periods/ranges) hacía `return set` apenas encontraba
  // algo, así que el piso histórico "en vivo" de más abajo nunca se alcanzaba en
  // producción (available_periods_by_sensor casi siempre viene poblado). Ahora las tres
  // ramas son aditivas y el piso en vivo se suma siempre al final, sin importar cuál
  // de las tres trajo datos.
  const useful = meta.available_useful_dates_by_sensor?.[sensor];
  if (Array.isArray(useful) && useful.length) {
    for (const d of useful) {
      if (typeof d === "string" && d.length >= 7) set.add(d.slice(0, 7));
    }
  } else {
    const periods = meta.available_periods_by_sensor?.[sensor];
    if (periods?.length) {
      for (const pr of periods) set.add(pr);
    }
    const ranges = meta.available_date_ranges_by_sensor?.[sensor];
    if (ranges?.length) {
      for (const r of ranges) {
        const b = rangeBounds(r);
        if (!b) continue;
        for (const [y, m] of monthsBetween(b.from, b.to)) {
          set.add(`${y}-${pad2(m)}`);
        }
      }
    }
  }
  // Piso histórico "en vivo" (NASA FIRMS): se suma como meses seleccionables además de
  // la tabla diaria local, para no bloquear años como 2012-2021 si el backend puede
  // complementarlos con una consulta en vivo (ver firms_live_available_since_by_sensor).
  const liveSince = meta.firms_live_available_since_by_sensor?.[sensor];
  if (liveSince) {
    const today = new Date().toISOString().slice(0, 10);
    for (const [y, m] of monthsBetween(liveSince, today)) {
      set.add(`${y}-${pad2(m)}`);
    }
  }
  return set;
}

/** Días del mes `(year, month)` que caen dentro de las fechas disponibles del sensor. */
export function publishedDaysInMonth(
  year: number,
  month: number,
  sensor: Sensor,
  meta: Metadata | null
): number[] {
  const maxD = daysInMonth(year, month);
  const out: number[] = [];
  for (let d = 1; d <= maxD; d++) {
    const iso = isoDate(year, month, d);
    if (!meta || isDateAvailable(iso, sensor, meta)) out.push(d);
  }
  return out;
}

/**
 * Un día es analizable si tiene tasa calculable (`activity_rate !== null`) y
 * cobertura suficiente (`observation_coverage === null || >= 0.70`), además de
 * respetar `available_useful_dates_by_sensor` si el backend lo publica.
 */
export function isUsefulDailyRow(
  row: Pick<DailyRow, "date" | "activity_rate" | "observation_coverage">,
  sensor?: Sensor,
  meta?: Metadata | null
): boolean {
  if (row.activity_rate === null || row.activity_rate === undefined) return false;
  if (
    row.observation_coverage !== null &&
    row.observation_coverage !== undefined &&
    row.observation_coverage < MIN_USEFUL_COVERAGE
  ) {
    return false;
  }
  if (sensor && meta && !isDateAvailable(row.date, sensor, meta)) {
    return false;
  }
  return true;
}

/** Días ordenados (1..31) del mes con datos útiles analizables en la serie diaria. */
export function usefulDaysFromRows(
  rows: DailyRow[],
  year: number,
  month: number,
  sensor: Sensor,
  meta: Metadata | null
): number[] {
  const prefix = `${year}-${pad2(month)}-`;
  const daySet = new Set<number>();
  for (const r of rows) {
    if (!r.date?.startsWith(prefix)) continue;
    if (r.sensor && r.sensor !== sensor) continue;
    if (!isUsefulDailyRow(r, sensor, meta)) continue;
    const d = Number(r.date.slice(8, 10));
    if (Number.isFinite(d) && d >= 1 && d <= 31) daySet.add(d);
  }
  return [...daySet].sort((a, b) => a - b);
}

/** Tramo del mes intersectado con los rangos publicados del sensor en `metadata`. */
export function monthClampedSpan(
  year: number,
  month: number,
  sensor: Sensor,
  meta: Metadata | null
): { from: string; to: string } | null {
  const span = monthRange(year, month);
  const ranges = meta?.available_date_ranges_by_sensor?.[sensor];
  if (!ranges?.length) {
    return isPeriodAvailable(`${year}-${pad2(month)}`, sensor, meta) ? span : null;
  }
  let minFrom: string | null = null;
  let maxTo: string | null = null;
  for (const r of ranges) {
    const b = rangeBounds(r);
    if (!b || b.to < span.from || b.from > span.to) continue;
    const f = b.from > span.from ? b.from : span.from;
    const t = b.to < span.to ? b.to : span.to;
    if (f <= t) {
      if (minFrom === null || f < minFrom) minFrom = f;
      if (maxTo === null || t > maxTo) maxTo = t;
    }
  }
  return minFrom && maxTo ? { from: minFrom, to: maxTo } : null;
}

/* -------------------------------------------------------------------------- */
/* Utilidades de fecha                                                        */
/* -------------------------------------------------------------------------- */

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function splitIso(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

/** Pares `[año, mes]` entre dos fechas, ambos extremos incluidos. */
export function monthsBetween(from: string, to: string): [number, number][] {
  const a = splitIso(from);
  const b = splitIso(to);
  const out: [number, number][] = [];
  let y = a.year;
  let m = a.month;
  while (y < b.year || (y === b.year && m <= b.month)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Suma días a una fecha ISO sin arrastrar husos horarios. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = splitIso(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function clampDate(date: string, from: string, to: string): string {
  return date < from ? from : date > to ? to : date;
}
