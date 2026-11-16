/**
 * Capa de origen de datos.
 *
 * La herramienta pide aquí y no le importa de dónde salga: si `/api/v1`
 * responde, se usa; si no, se sirve el juego de muestra con la misma forma.
 * Cada respuesta viene etiquetada con su `origin`, y la interfaz lo muestra:
 * nadie debería confundir un número de muestra con una observación.
 *
 * Por qué vive separado del cliente: el cliente habla el contrato y nada más;
 * la decisión de «qué hago si no hay servicio» es de producto, no de
 * transporte. Teniéndola en un solo sitio, el día que el backend esté estable
 * se borra este archivo y no se toca ninguna pantalla.
 */

import {
  ApiError,
  fetchActivity,
  fetchHotspots,
  fetchMetadata,
  fetchSensorComparison,
  fetchSummary,
  fetchTerritories,
  fetchTerritoryMetrics,
  hasUsableMetadata,
  isAbort,
  metricNeedsSensor,
  type ActivityResponse,
} from "./client";
import type {
  DailyRow,
  HotspotCollection,
  Metadata,
  MetricId,
  MetricResponse,
  Sensor,
  SensorComparison,
  TerritoryCollection,
  TerritorySummary,
  TerritoryType,
} from "./types";
import {
  fixtureActivity,
  fixtureHotspots,
  fixtureMetadata,
  fixtureSensorComparison,
  fixtureSummary,
  fixtureTerritories,
  fixtureTerritoryMetrics,
} from "../lib/fixtures";

export type Origin = "api" | "fixture" | "unavailable";

export interface Sourced<T> {
  data: T | null;
  origin: Origin;
  /** Presente cuando la API contestó con un código del contrato. */
  error?: ApiError;
}

/**
 * Indica si `/api/v1/metadata` entregó metadatos utilizables (sensores + rangos).
 * Cuando el backend solo tiene geometrías (`data_loaded: false`), evita que
 * los endpoints de datos fallen con `422 PERIOD_NOT_AVAILABLE` y permite caer
 * limpiamente a la muestra mientras se preservan las geometrías reales.
 */
let apiMetadataAvailable = true;

export function isApiMetadataAvailable(): boolean {
  return apiMetadataAvailable;
}

/**
 * Intenta la API y cae a la muestra.
 *
 * Una cancelación se vuelve a lanzar: el llamador la ignora a propósito y
 * convertirla en datos de muestra haría parpadear la pantalla cada vez que el
 * usuario mueve el control de días.
 *
 * `PERIOD_NOT_AVAILABLE` (422) o una fecha fuera de los rangos publicados en
 * `metadata` NO se rellenan con datos de muestra: devuelven `data: null` y
 * `origin: "unavailable"` con el error para nunca disfrazar fechas sin
 * publicación como observaciones de muestra.
 */
async function sourced<T>(
  live: () => Promise<T>,
  sample: () => T,
  skipApi = false,
  requireApiMetadata = true
): Promise<Sourced<T>> {
  if (skipApi) {
    return {
      data: null,
      origin: "unavailable",
      error: new ApiError(
        "PERIOD_NOT_AVAILABLE",
        "The date or period is not published for this query",
        422
      ),
    };
  }

  if (requireApiMetadata && !apiMetadataAvailable) {
    return { data: sample(), origin: "fixture" };
  }

  try {
    return { data: await live(), origin: "api" };
  } catch (e) {
    if (isAbort(e)) throw e;
    if (e instanceof ApiError && e.isPeriodUnavailable) {
      return { data: null, origin: "unavailable", error: e };
    }
    return { data: sample(), origin: "fixture", error: e instanceof ApiError ? e : undefined };
  }
}

/* -------------------------------------------------------------------------- */

export async function getMetadata(signal?: AbortSignal): Promise<Sourced<Metadata>> {
  const res = await sourced(
    async () => {
      const m = await fetchMetadata(signal);
      if (!hasUsableMetadata(m)) {
        throw new Error("Incomplete or empty metadata in /api/v1/metadata");
      }
      return m;
    },
    fixtureMetadata,
    false,
    false
  );
  apiMetadataAvailable = res.origin === "api";
  return res;
}

export function getTerritories(
  type: TerritoryType,
  signal?: AbortSignal
): Promise<Sourced<TerritoryCollection>> {
  return sourced(
    async () => {
      const c = await fetchTerritories(type, signal);
      // Un backend en pie pero sin geometrías dejaría el mapa en blanco; se
      // prefiere la muestra, rotulada, a una pantalla vacía sin explicación.
      if (!c.features?.length) throw new ApiError("NOT_FOUND", "No territories published", 404);
      return c;
    },
    () => fixtureTerritories(type),
    false,
    false
  );
}

export function getTerritoryMetrics(
  q: { type: TerritoryType; metric: MetricId; date?: string; period?: string; sensor?: Sensor },
  signal?: AbortSignal,
  skipApi = false
): Promise<Sourced<MetricResponse>> {
  return sourced(
    () =>
      fetchTerritoryMetrics(
        {
          type: q.type,
          metric: q.metric,
          date: q.date,
          period: q.period,
          sensor: metricNeedsSensor(q.metric) ? q.sensor : undefined,
        },
        signal
      ),
    () => fixtureTerritoryMetrics(q),
    skipApi
  );
}

export function getSummary(
  q: { type: TerritoryType; id: string; sensor: Sensor; date: string },
  signal?: AbortSignal,
  skipApi = false
): Promise<Sourced<TerritorySummary>> {
  return sourced(() => fetchSummary(q, signal), () => fixtureSummary(q), skipApi);
}

export function getActivity(
  q: { type: TerritoryType; id: string; sensor: Sensor; from: string; to: string },
  signal?: AbortSignal,
  skipApi = false
): Promise<Sourced<{ items: DailyRow[] }>> {
  return sourced<ActivityResponse | { items: DailyRow[] }>(
    () => fetchActivity(q, signal),
    () => fixtureActivity(q),
    skipApi
  );
}

export function getSensorComparison(
  q: { type: TerritoryType; id: string; date: string },
  signal?: AbortSignal,
  skipApi = false
): Promise<Sourced<SensorComparison>> {
  return sourced(() => fetchSensorComparison(q, signal), () => fixtureSensorComparison(q), skipApi);
}

export function getHotspots(
  q: { type: TerritoryType; id: string; date: string; sensor: Sensor },
  signal?: AbortSignal,
  skipApi = false
): Promise<Sourced<HotspotCollection>> {
  return sourced(() => fetchHotspots(q, signal), () => fixtureHotspots(q), skipApi);
}
