import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlRail, LEFT_ITEMS } from "../components/ControlRail";
import {
  MapStage,
  type DrawMode,
  type HighSusceptibilityMarker,
  type HoverCard,
  type PrioritySubZone,
} from "../components/MapStage";
import { CalendarStrip } from "../components/CalendarStrip";
import { AnalysisRail, ANALYSIS_ITEMS } from "../components/AnalysisRail";
import {
  SpreadRail,
  SPREAD_ITEMS,
  type GlobalTelemetry,
  type SpreadParams,
} from "../components/SpreadRail";
import { DockBar } from "../components/DockBar";
import {
  GuidedTour,
  isTourDismissed,
  MAP_TOUR_STEPS,
  setTourDismissed,
  SPREAD_TOUR_STEPS,
  type TourPhase,
} from "../components/GuidedTour";
import { OrbitalLoader } from "../components/OrbitalLoader";
import type { NavContext, ToolTab } from "../components/SiteNav";
import {
  ApiError,
  availablePeriodsForSensor,
  exportCsvUrl,
  fetchCalendar,
  fetchRealtimeArea,
  fetchReverseGeocode,
  getBackendState,
  type ReverseGeocodeLocation,
  isAbort,
  isAnalysisDateAvailable,
  isDateAvailable,
  isEnvDateAvailable,
  isEnvPeriodAvailable,
  isPeriodAvailable,
  isSummaryDateAvailable,
  lastAvailableDate,
  metricNeedsSensor,
  monthClampedSpan,
  monthRange,
  pad2,
  postSpreadSimulate,
  probeBackend,
  publishedDaysInMonth,
  rangeBounds,
  splitIso,
  usefulDaysFromRows,
  type BackendState,
  type RealtimeAreaResponse,
} from "../api/client";
import {
  getActivity,
  getHotspots,
  getMetadata,
  getSensorComparison,
  getSummary,
  getTerritories,
  getTerritoryMetrics,
  type Origin,
} from "../api/source";
import {
  SENSOR_META,
  CLASSIFICATION_LABELS,
  METRIC_LABELS,
  isLiveHistorical,
  isUnobserved,
  type ActivitySummary,
  type Classification,
  type DailyRow,
  type HotspotFeature,
  type Metadata,
  type MetricId,
  type MetricItem,
  type Sensor,
  type SensorComparison,
  type TerritoryCollection,
  type TerritorySummary,
  type TerritoryType,
} from "../api/types";
import { DEFAULT_TERRITORY, FIXTURE_LAST_MONTH, FIXTURE_LAST_YEAR } from "../lib/fixtures";
import {
  aggregateMonthly,
  calendarFromApi,
  findCell,
  mergeAnomaly,
  type MonthCell,
} from "../lib/calendar";
import {
  clusterHotspotsIntoEnclosures,
  featureCentroid,
  featureOuterRings,
  formatLatLon,
  pointInFeature,
  polygonCentroid,
  ringBounds,
  ringCentroid,
  type LatLon,
} from "../lib/geo";
import { simulateSpread, type SpreadResult } from "../lib/spread";

const MONTHS_ES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_SHORT_ES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DEPT_BY_UBIGEO: Record<string, string> = {
  "01": "Amazonas",
  "02": "Áncash",
  "03": "Apurímac",
  "04": "Arequipa",
  "05": "Ayacucho",
  "06": "Cajamarca",
  "07": "Callao",
  "08": "Cusco",
  "09": "Huancavelica",
  "10": "Huánuco",
  "11": "Ica",
  "12": "Junín",
  "13": "La Libertad",
  "14": "Lambayeque",
  "15": "Lima",
  "16": "Loreto",
  "17": "Madre de Dios",
  "18": "Moquegua",
  "19": "Pasco",
  "20": "Piura",
  "21": "Puno",
  "22": "San Martín",
  "23": "Tacna",
  "24": "Tumbes",
  "25": "Ucayali",
};

function resolveDepartment(
  territories: TerritoryCollection | null,
  territoryType: TerritoryType,
  territoryId: string,
  territoryName: string
): string | null {
  const feats = territories?.features ?? [];
  const feat = feats.find((x) => x.properties.territory_id === territoryId);
  const src = feat?.properties.source ?? "";
  if (/ucayali/i.test(src)) return "Ucayali";
  const paren = src.match(/\(([^)]+)\)/);
  if (paren?.[1] && !/^\d+$/.test(paren[1].trim())) {
    return paren[1].trim();
  }
  if (territoryType === "province") {
    const byUbigeo = DEPT_BY_UBIGEO[territoryId.slice(0, 2)];
    if (byUbigeo) return byUbigeo;
  }
  const allSources = feats.map((f) => f.properties.source ?? "");
  if (allSources.some((s) => /ucayali/i.test(s)) && allSources.every((s) => !s || /ucayali/i.test(s))) {
    return "Ucayali";
  }
  if (/ucayali/i.test(territoryName)) return "Ucayali";
  if (/madre de dios/i.test(territoryName)) return "Madre de Dios";
  if (/r[ií]mac/i.test(territoryName)) return "Lima";
  if (/chira/i.test(territoryName)) return "Piura";
  if (/mara[ñn]on/i.test(territoryName)) return "Loreto";
  return null;
}

const MONTHLY_METRICS = new Set<MetricId>([
  "fire_pixel_days_8_9",
  "active_days",
  "max_consecutive_active_days",
]);
/* -------------------------------------------------------------------------- */
/* Ficha del puntero                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Valor de una métrica tal como se muestra.
 *
 * `null` y `0` se escriben distinto a propósito: el primero es «el indicador
 * no está publicado» y el segundo «se calculó y vale cero». Confundirlos en
 * la interfaz es el error que el contrato prohíbe expresamente.
 */
function compactTooltipUnit(unit: string | null): string | null {
  if (!unit) return null;
  if (/adimensional|dimensionless/i.test(unit)) return "(unitless)";
  if (unit.length > 22) return unit.slice(0, 20).trimEnd() + "…";
  return unit;
}

function formatMetricValue(v: number | string | null | undefined, unit: string | null): string {
  if (v === null || v === undefined) return "No data";
  if (typeof v === "string") return CLASSIFICATION_LABELS[v as Classification] ?? v;
  const n = v.toLocaleString("es-PE", { maximumFractionDigits: 3 });
  const shortUnit = compactTooltipUnit(unit);
  return shortUnit ? `${n} ${shortUnit}` : n;
}

function formatCoverage(v: number | null): string {
  if (v === null || v === undefined) return "No data";
  // La cobertura llega como fracción 0–1; se muestra en porcentaje.
  return `${(v * 100).toLocaleString("es-PE", { maximumFractionDigits: 0 })} %`;
}

function formatAnomaly(a: ActivitySummary["historical_anomaly"]): string {
  if (a.status === "insufficient_baseline") return "Insufficient series";
  if (a.status === "not_estimable" || a.value === null) return "Not estimable";
  const rounded = Math.abs(a.value) < 0.005 ? 0 : a.value;
  const s = rounded > 0 ? "+" : "";
  return `${s}${rounded.toLocaleString("es-PE", { maximumFractionDigits: 2 })} σ`;
}

/** Arma la ficha con lo que respondió `/summary`, sin interpretar de más. */
function buildHoverCard(
  id: string,
  name: string,
  painted: { k: string; v: string },
  s: TerritorySummary,
  origin: Origin
): HoverCard {
  const dailyInvalid =
    s.daily != null && isUnobserved(s.daily);
  const noValidSummary =
    s.data_quality?.status === "insufficient" ||
    (s.activity.activity_rate == null && s.activity.observation_coverage == null);

  const notice = dailyInvalid
    ? "No valid observation on this date: the data is not valid at this time."
    : noValidSummary
      ? "The data is not valid at this time or is not available for this territory."
      : s.data_quality?.status === "partial"
        ? "Partial coverage: some indicators are not available."
        : undefined;

  return {
    id,
    title: name,
    state: "ready",
    rows: [
      painted,
      { k: "Active days", v: s.activity.active_days?.toLocaleString("es-PE") ?? "No data" },
      { k: "Coverage", v: formatCoverage(s.activity.observation_coverage) },
      { k: "Anomaly", v: formatAnomaly(s.activity.historical_anomaly) },
      {
        k: "Conditions",
        v:
          CLASSIFICATION_LABELS[s.environmental_conditions.classification] ??
          s.environmental_conditions.classification,
      },
    ],
    notice,
    /* No se dice por qué son de muestra: `fixture` tapa tres casos distintos
       —fecha no publicada, el backend no contestó, o contestó un error del
       contrato— y atribuirlo al backend sería afirmar algo que aquí no se
       sabe. El rótulo de la cabecera ya informa si hay conexión. */
    foot: origin === "fixture" ? "Sample data" : "Backend · /api/v1",
  };
}

interface Props {
  tab: ToolTab;
  onBackend: (s: BackendState) => void;
  onContextChange?: (ctx: NavContext) => void;
  onOpenConventions?: () => void;
  suspendLoader?: boolean;
  suspendTour?: boolean;
  tourTrigger?: number;
}

export function MapTool({
  tab,
  onBackend,
  onContextChange,
  onOpenConventions,
  suspendLoader = false,
  suspendTour = false,
  tourTrigger = 0,
}: Props) {
  /* ------------------------------------------------------------- estado -- */

  /**
   * El territorio es la clave de toda consulta: el contrato pide siempre
   * tipo + id, y provincias y cuencas no se mezclan en un mismo ranking.
   */
  const [territoryType, setTerritoryType] = useState<TerritoryType>(DEFAULT_TERRITORY.type);
  // Arranca SIN territorio seleccionado (vista nacional, nada preseleccionado):
  // antes abría siempre en Coronel Portillo (Ucayali). Las consultas de datos
  // ya esperan a `territoryReady`, que es falso mientras el id esté vacío.
  const [territoryId, setTerritoryId] = useState<string>("");
  /** Punto interior del último territorio elegido: al cambiar de tipo
   *  (provincia ↔ cuenca) se busca el del nuevo tipo que lo contenga o el más
   *  cercano, en vez de saltar al primero de la lista. */
  const lastSelectedPointRef = useRef<LatLon | null>(null);
  const [territories, setTerritories] = useState<TerritoryCollection | null>(null);

  const [year, setYear] = useState(FIXTURE_LAST_YEAR);
  const [month, setMonth] = useState(FIXTURE_LAST_MONTH);
  const [day, setDay] = useState(31);
  /** Qué pinta el mapa: el día elegido o el mes completo. */
  const [granularity, setGranularity] = useState<"day" | "month">("day");

  /**
   * Un solo sensor activo. No es una limitación de la interfaz: una consulta
   * de actividad es de un sensor, y los conteos no se suman entre ellos. El
   * contraste entre los tres se ve en el panel de comparación, que lo
   * entrega la API ya resuelto.
   */
  const [sensor, setSensor] = useState<Sensor>("VIIRS_SNPP");

  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataOrigin, setMetadataOrigin] = useState<Origin>("fixture");
  const [metric, setMetric] = useState<MetricId>("activity_rate");

  const [showHotspots, setShowHotspots] = useState(true);
  const [liveFirms, setLiveFirms] = useState(true);
  const [liveFirmsAutoOffNotice, setLiveFirmsAutoOffNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!liveFirmsAutoOffNotice) return;
    const t = window.setTimeout(() => setLiveFirmsAutoOffNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [liveFirmsAutoOffNotice]);
  const [firmsSummary, setFirmsSummary] = useState<string | null>(null);
  const [showChoropleth, setShowChoropleth] = useState(true);
  const [showHighMarkers, setShowHighMarkers] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
  const [baseLayer, setBaseLayer] = useState<"dark" | "relief" | "satellite">("dark");

  /** Fase 2: recorte y punto de ignición. Nada de esto toca la Fase 1. */
  const [ring, setRing] = useState<LatLon[] | null>(null);
  const [ignition, setIgnition] = useState<LatLon | null>(null);
  const [mode, setMode] = useState<DrawMode>("pan");

  /** Un cajón abierto a la vez por lado. Con los dos cerrados manda el mapa. */
  const [leftOpen, setLeftOpen] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState<string | null>(null);

  const [hotspots, setHotspots] = useState<HotspotFeature[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [dailyKey, setDailyKey] = useState<string>("");
  const [series, setSeries] = useState<DailyRow[]>([]);
  const [apiCalendar, setApiCalendar] = useState<MonthCell[] | null>(null);
  const [summary, setSummary] = useState<TerritorySummary | null>(null);
  const [comparison, setComparison] = useState<SensorComparison | null>(null);
  const [choropleth, setChoropleth] = useState<MetricItem[]>([]);
  const [susceptibilityItems, setSusceptibilityItems] = useState<MetricItem[]>([]);
  const [hydroTerritories, setHydroTerritories] = useState<TerritoryCollection | null>(null);
  const [hydroSusceptibility, setHydroSusceptibility] = useState<MetricItem[]>([]);
  const [metricUnit, setMetricUnit] = useState<string | null>(null);
  /**
   * Dos procedencias, porque son dos cosas distintas.
   *
   * `origin` es la de la ficha y la serie: lo que la interfaz afirma sobre el
   * territorio. `hotspotsOrigin` es la de los puntos del mapa, que son
   * prioridad 3 del contrato y pueden no estar publicados. Con un solo
   * indicador, un `/hotspots` ausente marcaba toda la pantalla como muestra
   * aunque los indicadores vinieran de la API: justo lo contrario de lo que
   * un rótulo de procedencia tiene que lograr.
   */
  const [origin, setOrigin] = useState<Origin>("fixture");
  const [hotspotsOrigin, setHotspotsOrigin] = useState<Origin>("fixture");
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const [spreadParams, setSpreadParams] = useState<SpreadParams>({
    windSpeedMs: 4.5,
    windDirDeg: 135,
    fuelMoisturePct: 9,
    vegetationPct: 72,
    slopeMeanDeg: 8,
    horizonHours: 24,
  });
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadRunning, setSpreadRunning] = useState(false);
  const [spreadTime, setSpreadTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [envApplied, setEnvApplied] = useState(false);
  const [envLoading, setEnvLoading] = useState(false);
  const [globalTelemetry, setGlobalTelemetry] = useState<GlobalTelemetry | null>(null);
  const [simLocation, setSimLocation] = useState<ReverseGeocodeLocation | null>(null);
  const geoCacheRef = useRef<Map<string, ReverseGeocodeLocation>>(new Map());
  const slopeEditedRef = useRef(false);
  /** Parámetros que el usuario fijó a mano: solo esos se envían tal cual; el resto
   *  lo resuelven las APIs externas (viento/humedad Open-Meteo, DEM, SAVI). */
  const userSetParamsRef = useRef<Set<keyof SpreadParams>>(new Set());
  const spreadSeqRef = useRef(0);
  const envSeqRef = useRef(0);

  useEffect(() => {
    setGlobalTelemetry(null);
    setEnvApplied(false);
    slopeEditedRef.current = false;
  }, [ring, ignition]);

  const activeSimPoint: LatLon | null = useMemo(() => {
    if (ignition) return ignition;
    if (!ring || ring.length === 0) return null;
    const latAvg = ring.reduce((acc, p) => acc + p[0], 0) / ring.length;
    const lonAvg = ring.reduce((acc, p) => acc + p[1], 0) / ring.length;
    return [latAvg, lonAvg];
  }, [ignition, ring]);

  useEffect(() => {
    if (tab !== "simulacion" || !activeSimPoint) {
      if (!activeSimPoint) setSimLocation(null);
      return;
    }
    const key = `${activeSimPoint[0].toFixed(3)},${activeSimPoint[1].toFixed(3)}`;
    const cached = geoCacheRef.current.get(key);
    if (cached) {
      setSimLocation(cached);
      return;
    }
    const ctrl = new AbortController();
    fetchReverseGeocode(activeSimPoint[0], activeSimPoint[1], ctrl.signal).then((loc) => {
      if (ctrl.signal.aborted || !loc) return;
      if (loc.status === "ok") {
        geoCacheRef.current.set(key, loc);
      }
      setSimLocation(loc);
    });
    return () => ctrl.abort();
  }, [tab, activeSimPoint]);

  const [tourPhase, setTourPhase] = useState<TourPhase>(() =>
    isTourDismissed() ? "closed" : "prompt"
  );
  const [dismissedHighKey, setDismissedHighKey] = useState<string | null>(null);
  const [tabTransition, setTabTransition] = useState<string | null>(null);
  const prevTabRef = useRef<ToolTab>(tab);

  useEffect(() => {
    if (tourTrigger > 0) {
      setShowCalendar(true);
      setTourPhase("tour");
    }
  }, [tourTrigger]);

  // Al cambiar de pestaña: en Simulación abre de inmediato Escenario · Fase 2
  // (con controles globales, clima en vivo y salidas 48 h); en Calendario cierra el cajón previo.
  useEffect(() => {
    setRightOpen(tab === "simulacion" ? "escenario" : null);
    if (prevTabRef.current === tab) return;
    prevTabRef.current = tab;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTabTransition(tab === "simulacion" ? "Switching to simulation…" : "Thermal calendar mode…");
    const timer = window.setTimeout(() => setTabTransition(null), 420);
    return () => window.clearTimeout(timer);
  }, [tab]);

  /* ----------------------------------------------------- sondeo backend -- */
  const refreshMetadata = useCallback((signal?: AbortSignal) => {
    getMetadata(signal)
      .then((r) => {
        setMetadata(r.data);
        setMetadataOrigin(r.origin);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setMetadata(null);
          setMetadataOrigin("fixture");
        }
      });
  }, []);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    probeBackend().then((s) => {
      if (!alive) return;
      onBackend(s);
      refreshMetadata(ctrl.signal);
    });
    const id = setInterval(() => {
      probeBackend().then((s) => {
        if (!alive) return;
        onBackend(s);
        refreshMetadata();
      });
    }, 120_000);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(id);
    };
  }, [onBackend, refreshMetadata]);

  /* -------------------------------------------------------- metadatos ---- */
  useEffect(() => {
    const ctrl = new AbortController();
    refreshMetadata(ctrl.signal);
    return () => ctrl.abort();
  }, [refreshMetadata]);

  /* ------------------------------------------------------- territorios --- */
  useEffect(() => {
    const ctrl = new AbortController();
    setTerritories(null);
    getTerritories(territoryType, ctrl.signal)
      .then((r) => {
        const col = r.data;
        setTerritories(col);
        // Al cambiar de tipo, el id anterior pertenece a otra familia. Antes
        // se tomaba el primero de la lista (`ids[0]`), que solía estar en la
        // otra punta del país. Ahora: el territorio del nuevo tipo que
        // contiene el punto del que estaba seleccionado; si ninguno lo
        // contiene, el de centroide más cercano. Sin selección previa, se
        // queda sin selección.
        const feats = col?.features ?? [];
        if (!territoryId || feats.some((f) => f.properties.territory_id === territoryId)) return;
        const pt = lastSelectedPointRef.current;
        if (!pt || feats.length === 0) {
          setTerritoryId("");
          return;
        }
        const containing = feats.find((f) => {
          try {
            return pointInFeature(pt, f.geometry);
          } catch {
            return false;
          }
        });
        if (containing) {
          setTerritoryId(containing.properties.territory_id);
          return;
        }
        let bestId = "";
        let bestD = Infinity;
        for (const f of feats) {
          let c: LatLon;
          try {
            c = featureCentroid(f.geometry);
          } catch {
            continue;
          }
          const d = (c[0] - pt[0]) ** 2 + ((c[1] - pt[1]) * Math.cos((pt[0] * Math.PI) / 180)) ** 2;
          if (d < bestD) {
            bestD = d;
            bestId = f.properties.territory_id;
          }
        }
        setTerritoryId(bestId);
      })
      .catch((e) => {
        if (!isAbort(e)) setTerritories(null);
      });
    return () => ctrl.abort();
    // `territoryId` se lee pero no debe re-disparar la carga del tipo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territoryType]);

  /* ------------------------------------------------------------ fechas --- */
  const period = `${year}-${pad2(month)}`;
  const monthSpan = useMemo(() => monthRange(year, month), [year, month]);
  const dateIso = useMemo(() => {
    const maxDay = Number(monthSpan.to.slice(8));
    return `${period}-${pad2(Math.min(day, maxDay))}`;
  }, [period, day, monthSpan.to]);

  const span = granularity === "day" ? { from: dateIso, to: dateIso } : monthSpan;

  const availablePeriods = useMemo(
    () => availablePeriodsForSensor(sensor, metadata),
    [metadata, sensor]
  );
  const sortedPeriodsDesc = useMemo(
    () => [...availablePeriods].sort((a, b) => b.localeCompare(a)),
    [availablePeriods]
  );
  const validYears = useMemo(() => {
    const s = new Set<number>();
    for (const pr of availablePeriods) {
      const y = Number(pr.slice(0, 4));
      if (Number.isFinite(y)) s.add(y);
    }
    return [...s].sort((a, b) => b - a);
  }, [availablePeriods]);

  const userPickedPeriodRef = useRef(false);
  const userPickedDayRef = useRef(false);
  const lastAutoTargetRef = useRef<string | null>(null);
  const latestBySensorRef = useRef<Partial<Record<Sensor, string>>>({});
  const fallbackTriedPeriodsRef = useRef<Set<string>>(new Set());

  const handleSensor = useCallback((nextSensor: Sensor) => {
    userPickedPeriodRef.current = false;
    userPickedDayRef.current = false;
    lastAutoTargetRef.current = null;
    fallbackTriedPeriodsRef.current.clear();
    setSensor(nextSensor);
  }, []);

  /**
   * "Live NRT hotspots" (NASA FIRMS) siempre muestra las últimas ~72 h, sin importar
   * qué día del calendario esté elegido: si quedara prendido al elegir un día pasado,
   * el mapa parecería ignorar esa elección. Al elegir explícitamente un día/periodo
   * que no es "hoy", se apaga solo y se avisa con un popup — así el usuario ve los
   * focos reales de ESE día (vía /hotspots) y no los de "ahora".
   */
  const maybeAutoDisableLiveFirms = useCallback(
    (targetIso: string) => {
      if (!liveFirms) return;
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      if (targetIso === todayIso) return;
      setLiveFirms(false);
      setLiveFirmsAutoOffNotice(
        `"Live NRT hotspots" turned off: showing the real MODIS/VIIRS points for ${targetIso} instead of the last ~72 h. Turn it back on from Map layers any time.`
      );
    },
    [liveFirms]
  );

  const handlePeriod = useCallback(
    (nextYear: number, nextMonth: number) => {
      userPickedPeriodRef.current = true;
      userPickedDayRef.current = false;
      fallbackTriedPeriodsRef.current.clear();
      setYear(nextYear);
      setMonth(nextMonth);
      // El día concreto dentro de este mes aún se resolverá después (último día útil
      // disponible), pero si el año/mes elegido ya no es el actual, no hay forma de
      // que termine siendo "hoy" — se puede decidir ya mismo.
      const now = new Date();
      if (nextYear !== now.getFullYear() || nextMonth !== now.getMonth() + 1) {
        maybeAutoDisableLiveFirms(`${nextYear}-${pad2(nextMonth)}-01`);
      }
    },
    [maybeAutoDisableLiveFirms]
  );

  const handleDay = useCallback(
    (nextDay: number) => {
      userPickedDayRef.current = true;
      setDay(nextDay);
      maybeAutoDisableLiveFirms(`${year}-${pad2(month)}-${pad2(nextDay)}`);
    },
    [year, month, maybeAutoDisableLiveFirms]
  );

  /**
   * Al llegar o actualizarse los metadatos (o al cambiar de sensor), ubica
   * automáticamente la herramienta en la última fecha válida publicada si el
   * usuario no fijó otro período, o si llegó información más reciente.
   */
  useEffect(() => {
    if (!metadata || availablePeriods.size === 0) return;

    const latest = lastAvailableDate(sensor, metadata);
    if (latest) {
      const prevLatest = latestBySensorRef.current[sensor];
      const hasNewerData = prevLatest !== undefined && latest > prevLatest;
      latestBySensorRef.current[sensor] = latest;
      const targetKey = `${sensor}|${latest}|${metadataOrigin}`;

      if (hasNewerData) {
        userPickedPeriodRef.current = false;
        userPickedDayRef.current = false;
      }

      if (!userPickedPeriodRef.current && lastAutoTargetRef.current !== targetKey) {
        lastAutoTargetRef.current = targetKey;
        const { year: ly, month: lm, day: ld } = splitIso(latest);
        if (ly !== year) setYear(ly);
        if (lm !== month) setMonth(lm);
        if (ld !== day) setDay(ld);
        return;
      }
    }

    if (!validYears.includes(year)) {
      const targetYear = validYears[0];
      const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) =>
        availablePeriods.has(`${targetYear}-${pad2(m)}`)
      );
      const targetMonth = monthsInYear[monthsInYear.length - 1] ?? 1;
      const pubDays = publishedDaysInMonth(targetYear, targetMonth, sensor, metadata);
      setYear(targetYear);
      setMonth(targetMonth);
      setDay(pubDays[pubDays.length - 1] ?? 1);
      return;
    }

    if (!availablePeriods.has(period)) {
      const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) =>
        availablePeriods.has(`${year}-${pad2(m)}`)
      );
      if (monthsInYear.length > 0) {
        const targetMonth = monthsInYear[monthsInYear.length - 1];
        const pubDays = publishedDaysInMonth(year, targetMonth, sensor, metadata);
        setMonth(targetMonth);
        setDay(pubDays[pubDays.length - 1] ?? 1);
        return;
      }
    }

    if (!isDateAvailable(dateIso, sensor, metadata)) {
      const pubDays = publishedDaysInMonth(year, month, sensor, metadata);
      if (pubDays.length > 0) {
        setDay(pubDays[pubDays.length - 1]);
        return;
      }
      if (latest) {
        const { year: y, month: m, day: d } = splitIso(latest);
        setYear(y);
        setMonth(m);
        setDay(d);
      }
    }
  }, [metadata, metadataOrigin, sensor, year, month, day, period, dateIso, availablePeriods, validYears]);

  /**
   * Las fechas publicadas las decide `metadata`, no esta interfaz. Si el día
   * elegido no está, se avisa en vez de pedirlo y mostrar un hueco.
   */
  useEffect(() => {
    if (!metadata) return setUnavailable(null);
    setUnavailable(
      isDateAvailable(dateIso, sensor, metadata)
        ? null
        : `${SENSOR_META[sensor].label}: the data for ${dateIso} is not valid or is not available`
    );
  }, [dateIso, sensor, metadata]);

  /**
   * Nada de datos hasta tener `metadata` y que `territories` haya sincronizado
   * el `territoryId` activo para el tipo seleccionado. Sin esta guardia, el
   * arranque o un cambio de tipo disparaban 404 con `2501` o un id ajeno.
   */
  const territoryReady = useMemo(() => {
    if (!territories?.features?.length || !territoryId) return false;
    return territories.features.some(
      (f) =>
        (!f.properties.territory_type || f.properties.territory_type === territoryType) &&
        f.properties.territory_id === territoryId
    );
  }, [territories, territoryType, territoryId]);

  const ready = Boolean(metadata) && territoryReady;
  /** Base del mapa lista (metadata + polígonos), haya o no un territorio
   *  elegido: sin selección por defecto, el cargador no debe esperar a `ready`. */
  const baseLoaded = Boolean(metadata) && Boolean(territories?.features?.length);
  const activeMonthKey = `${territoryType}|${territoryId}|${sensor}|${period}`;
  const dailyLoading = dailyKey !== activeMonthKey;

  /**
   * Disponibilidad por endpoint según `metadata` (§5 del contrato).
   * Si la fecha o el período no está publicado para ese endpoint, se omite
   * la llamada para evitar `422 PERIOD_NOT_AVAILABLE` innecesarios.
   */
  const monthActivityOk = metadata
    ? availablePeriods.has(period) && isPeriodAvailable(period, sensor, metadata)
    : false;
  const summaryOk = metadata ? isSummaryDateAvailable(dateIso, sensor, metadata) : false;
  const analysisOk = metadata ? isAnalysisDateAvailable(dateIso, metadata) : false;
  const usePeriodMetrics = granularity === "month" || MONTHLY_METRICS.has(metric);
  const metricsOk = metadata
    ? usePeriodMetrics
      ? metricNeedsSensor(metric)
        ? isPeriodAvailable(period, sensor, metadata)
        : isEnvPeriodAvailable(period, metadata)
      : metricNeedsSensor(metric)
        ? isDateAvailable(dateIso, sensor, metadata)
        : isEnvDateAvailable(dateIso, metadata)
    : false;

  const clampedMonthSpan = useMemo(
    () => monthClampedSpan(year, month, sensor, metadata) ?? monthSpan,
    [year, month, sensor, metadata, monthSpan]
  );

  /* --------------------------------------------------------- hotspots ---- */
  useEffect(() => {
    if (liveFirms) return;
    if (!ready) {
      setHotspots([]);
      return;
    }
    const ctrl = new AbortController();
    getHotspots(
      { type: territoryType, id: territoryId, date: dateIso, sensor },
      ctrl.signal
    )
      .then((r) => {
        setHotspots(r.data?.features ?? []);
        setHotspotsOrigin(r.origin);
      })
      .catch((e) => {
        // Una petición cancelada no es un error: pasa en cada cambio de día.
        if (!isAbort(e)) setHotspots([]);
      });
    return () => ctrl.abort();
  }, [ready, liveFirms, territoryType, territoryId, dateIso, sensor]);

  /* ------------------------------------------- serie diaria del mes ------ */
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const targetKey = activeMonthKey;
    if (!monthActivityOk) {
      setDaily([]);
      setDailyKey(targetKey);
      return () => ctrl.abort();
    }
    getActivity(
      {
        type: territoryType,
        id: territoryId,
        sensor,
        from: clampedMonthSpan.from,
        to: clampedMonthSpan.to,
      },
      ctrl.signal,
      false
    )
      .then((r) => {
        setDaily(r.data?.items ?? []);
        setDailyKey(targetKey);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setDaily([]);
          setDailyKey(targetKey);
        }
      });
    return () => ctrl.abort();
  }, [
    ready,
    activeMonthKey,
    monthActivityOk,
    territoryType,
    territoryId,
    sensor,
    clampedMonthSpan.from,
    clampedMonthSpan.to,
  ]);

  const usefulDays = useMemo(() => {
    if (dailyKey !== activeMonthKey) return [];
    return usefulDaysFromRows(daily, year, month, sensor, metadata);
  }, [dailyKey, activeMonthKey, daily, year, month, sensor, metadata]);

  /** Días útiles del mes que además registran detecciones reales / actividad > 0. */
  const activeUsefulDays = useMemo(() => {
    if (dailyKey !== activeMonthKey || usefulDays.length === 0) return [];
    const usefulSet = new Set(usefulDays);
    const prefix = `${year}-${pad2(month)}-`;
    const withNominalHigh: number[] = [];
    const withAnyActivity: number[] = [];
    for (const r of daily) {
      if (!r.date?.startsWith(prefix)) continue;
      if (r.sensor && r.sensor !== sensor) continue;
      const d = Number(r.date.slice(8, 10));
      if (!usefulSet.has(d)) continue;
      if ((r.fire_pixels_nominal_high ?? 0) > 0 || (r.activity_rate ?? 0) > 0) {
        withNominalHigh.push(d);
      } else if ((r.fire_pixels_low ?? 0) > 0) {
        withAnyActivity.push(d);
      }
    }
    const chosen = withNominalHigh.length > 0 ? withNominalHigh : withAnyActivity;
    return [...new Set(chosen)].sort((a, b) => a - b);
  }, [dailyKey, activeMonthKey, usefulDays, daily, year, month, sensor]);

  useEffect(() => {
    userPickedDayRef.current = false;
  }, [territoryType, territoryId]);

  const calendarPeriodsWithData = useMemo(() => {
    const cells = apiCalendar ?? (series.length ? aggregateMonthly(series, sensor) : []);
    return new Set(
      cells
        .filter(
          (c) =>
            c.activity_rate !== null &&
            (c.observation_coverage === null || c.observation_coverage >= 0.7)
        )
        .map((c) => c.period)
    );
  }, [apiCalendar, series, sensor]);

  /**
   * Cuando llega la serie diaria del mes activo, asegura que el día
   * seleccionado pertenezca a `usefulDays` (cobertura ≥ 70 % y tasa no nula).
   * Si no hay ningún día útil al arrancar o cambiar de sensor, retrocede al
   * período anterior publicado con datos útiles.
   */
  useEffect(() => {
    if (!ready || !metadata || dailyKey !== activeMonthKey) return;

    if (usefulDays.length > 0) {
      if (!userPickedDayRef.current || !usefulDays.includes(day)) {
        const lastUseful =
          activeUsefulDays[activeUsefulDays.length - 1] ?? usefulDays[usefulDays.length - 1];
        if (day !== lastUseful) setDay(lastUseful);
      }
      return;
    }

    if (userPickedPeriodRef.current) return;
    fallbackTriedPeriodsRef.current.add(period);
    if (fallbackTriedPeriodsRef.current.size > 12) return;

    const candidates = sortedPeriodsDesc.filter(
      (pr) => pr < period && !fallbackTriedPeriodsRef.current.has(pr)
    );
    const nextPeriod = candidates.find((pr) => calendarPeriodsWithData.has(pr)) ?? candidates[0];
    if (!nextPeriod) return;
    const [ny, nm] = nextPeriod.split("-").map(Number);
    if (Number.isFinite(ny) && Number.isFinite(nm)) {
      setYear(ny);
      setMonth(nm);
    }
  }, [
    ready,
    metadata,
    dailyKey,
    activeMonthKey,
    usefulDays,
    activeUsefulDays,
    day,
    period,
    sortedPeriodsDesc,
    calendarPeriodsWithData,
  ]);

  /* ------------------------------------------- serie larga (calendario) -- */
  /**
   * Intenta primero `GET /territories/{type}/{id}/calendar?sensor=...`. Si el
   * backend aún no lo publica (404) o no está disponible, cae al rango diario
   * completo y agrupa por mes en `lib/calendar.ts` (`aggregateMonthly`).
   */
  const longSpan = useMemo(() => {
    const ranges = metadata?.available_date_ranges_by_sensor?.[sensor];
    if (!ranges?.length) return null;
    const bounds = ranges.map((r) => rangeBounds(r)).filter((b): b is { from: string; to: string } => b !== null);
    if (!bounds.length) return null;
    return { from: bounds[0].from, to: bounds[bounds.length - 1].to };
  }, [metadata, sensor]);

  useEffect(() => {
    if (!ready) {
      setApiCalendar(null);
      setSeries([]);
      return;
    }
    const ctrl = new AbortController();
    let active = true;

    (async () => {
      if (getBackendState() !== "offline" && metadataOrigin === "api") {
        try {
          const cal = await fetchCalendar(territoryType, territoryId, sensor, ctrl.signal);
          if (!active) return;
          setApiCalendar(calendarFromApi(cal.items ?? []));
          setSeries([]);
          return;
        } catch (e) {
          if (isAbort(e) || !active) return;
          if (e instanceof ApiError && e.isPeriodUnavailable) {
            setApiCalendar([]);
            setSeries([]);
            return;
          }
        }
      }

      if (!active) return;
      setApiCalendar(null);
      if (!longSpan) {
        setSeries([]);
        return;
      }
      try {
        const r = await getActivity(
          { type: territoryType, id: territoryId, sensor, from: longSpan.from, to: longSpan.to },
          ctrl.signal,
          false
        );
        if (!active) return;
        setSeries(r.data?.items ?? []);
      } catch (e) {
        if (!isAbort(e) && active) setSeries([]);
      }
    })();

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [ready, territoryType, territoryId, sensor, longSpan]);

  /* ------------------------------------------------------------- ficha --- */
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    getSummary(
      { type: territoryType, id: territoryId, sensor, date: dateIso },
      ctrl.signal,
      !summaryOk
    )
      .then((r) => {
        setSummary(r.data);
        setOrigin(r.origin);
        setEnvApplied(false);
      })
      .catch((e) => {
        if (!isAbort(e)) setSummary(null);
      });
    return () => ctrl.abort();
  }, [ready, summaryOk, territoryType, territoryId, sensor, dateIso]);

  /* ------------------------------------------------------ comparación ---- */
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    getSensorComparison(
      { type: territoryType, id: territoryId, date: dateIso },
      ctrl.signal,
      !analysisOk
    )
      .then((r) => setComparison(r.data))
      .catch((e) => {
        if (!isAbort(e)) setComparison(null);
      });
    return () => ctrl.abort();
  }, [ready, analysisOk, territoryType, territoryId, dateIso]);

  /* -------------------------------------------------------- coropleta ---- */
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    getTerritoryMetrics(
      usePeriodMetrics
        ? { type: territoryType, metric, period, sensor }
        : { type: territoryType, metric, date: dateIso, sensor },
      ctrl.signal,
      !metricsOk
    )
      .then((r) => {
        setChoropleth(r.data?.items ?? []);
        setMetricUnit(r.data?.unit ?? null);
      })
      .catch((e) => {
        if (!isAbort(e)) setChoropleth([]);
      });
    return () => ctrl.abort();
  }, [ready, metricsOk, usePeriodMetrics, territoryType, metric, dateIso, period, sensor]);

  /* ---------------- clasificación ambiental (todos los territorios + cuencas) */
  useEffect(() => {
    if (!ready) return;
    if (metric === "conditions_classification") {
      setSusceptibilityItems(choropleth);
      return;
    }
    const ctrl = new AbortController();
    getTerritoryMetrics(
      { type: territoryType, metric: "conditions_classification", period },
      ctrl.signal,
      !metricsOk
    )
      .then((r) => setSusceptibilityItems(r.data?.items ?? []))
      .catch((e) => {
        if (!isAbort(e)) setSusceptibilityItems([]);
      });
    return () => ctrl.abort();
  }, [ready, metricsOk, territoryType, metric, period, choropleth]);

  useEffect(() => {
    if (!ready || territoryType !== "province") return;
    const ctrl = new AbortController();
    if (!hydroTerritories) {
      getTerritories("hydro_unit", ctrl.signal)
        .then((r) => setHydroTerritories(r.data))
        .catch((e) => {
          if (!isAbort(e)) setHydroTerritories(null);
        });
    }
    getTerritoryMetrics(
      { type: "hydro_unit", metric: "conditions_classification", period },
      ctrl.signal,
      !metricsOk
    )
      .then((r) => setHydroSusceptibility(r.data?.items ?? []))
      .catch((e) => {
        if (!isAbort(e)) setHydroSusceptibility([]);
      });
    return () => ctrl.abort();
  }, [ready, metricsOk, territoryType, period, hydroTerritories]);

  /* --------------------------------------------------------- derivados --- */

  /** Calendario del sensor activo, con la anomalía del mes mirado. */
  const calendar: MonthCell[] = useMemo(() => {
    const raw =
      apiCalendar !== null ? apiCalendar : aggregateMonthly(series.length ? series : daily, sensor);
    // Solo meses que `metadata` publica para este sensor: el calendario no
    // debe pintar fechas que la metadata no declara disponibles (antes salían
    // p. ej. meses de 2026 sin respaldo en `available_periods_by_sensor`).
    const cells = raw.filter((c) => availablePeriods.has(`${c.year}-${pad2(c.month)}`));
    // `availablePeriods` incluye el piso histórico "en vivo" (NASA FIRMS, ver
    // firms_live_available_since_by_sensor), pero esos meses no tienen fila en
    // activity_summary.json/activity_daily.json local, así que nunca aparecen en `raw`.
    // Sin esto, aunque el día individual sí se pudiera seleccionar, la cuadrícula del
    // calendario jamás dibujaba esas columnas de años (p. ej. 2012-2021 desaparecía por
    // completo del calendario, aunque /summary ya respondiera para esas fechas).
    // Se agregan como celdas vacías — nunca con detecciones/cobertura inventadas, eso
    // solo lo entrega /summary al pedir un día puntual — solo para que el mes exista
    // como columna seleccionable.
    const present = new Set(cells.map((c) => c.period));
    const liveOnly: MonthCell[] = [];
    for (const pr of availablePeriods) {
      if (present.has(pr)) continue;
      const [y, m] = pr.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      liveOnly.push({
        year: y,
        month: m,
        period: pr,
        detections: 0,
        detections_low: 0,
        activity_rate: null,
        observation_coverage: null,
        active_days: 0,
        max_consecutive_active_days: 0,
        unobserved_days: 0,
        days_with_data: 0,
        historical_anomaly: null,
        anomaly_status: "not_estimable",
        baseline_years: 0,
      });
    }
    return mergeAnomaly([...cells, ...liveOnly], period, summary?.activity.historical_anomaly ?? null);
  }, [apiCalendar, series, daily, sensor, period, summary, availablePeriods]);

  const cell = useMemo(() => findCell(calendar, year, month), [calendar, year, month]);

  /** Fila del día: el contexto ambiental de la ficha es diario. */
  const dayRow = useMemo(
    () => summary?.daily ?? daily.find((d) => d.date === dateIso) ?? null,
    [summary, daily, dateIso]
  );

  const territoryName = useMemo(() => {
    const f = territories?.features.find((x) => x.properties.territory_id === territoryId);
    return f?.properties.territory_name ?? territoryId;
  }, [territories, territoryId]);

  const departmentName = useMemo(
    () => resolveDepartment(territories, territoryType, territoryId, territoryName),
    [territories, territoryType, territoryId, territoryName]
  );

  const periodLabel = `${MONTHS_ES[month - 1]} ${year}`;
  const navDateLabel =
    granularity === "day"
      ? `${day} ${MONTHS_SHORT_ES[month - 1]} ${year}`
      : periodLabel;

  useEffect(() => {
    const outsideUcayali =
      activeSimPoint !== null &&
      (activeSimPoint[0] < -11.6 ||
        activeSimPoint[0] > -7.1 ||
        activeSimPoint[1] < -76.2 ||
        activeSimPoint[1] > -70.3);
    const inGlobalSim =
      tab === "simulacion" &&
      activeSimPoint !== null &&
      (outsideUcayali || Boolean(simLocation?.header_primary) || Boolean(globalTelemetry?.coordsLabel) || Boolean(spread));

    if (inGlobalSim && activeSimPoint) {
      const resolvedPrimary =
        simLocation?.status === "ok" && simLocation.header_primary
          ? simLocation.header_primary
          : outsideUcayali
            ? "GLOBAL · AOI"
            : departmentName ?? "UCAYALI";
      const resolvedSub =
        simLocation?.status === "ok" && simLocation.header_sub
          ? simLocation.header_sub
          : globalTelemetry?.coordsLabel ?? formatLatLon(activeSimPoint, 2);
      onContextChange?.({
        department: resolvedPrimary,
        territoryName: resolvedSub,
        territoryType,
        dateLabel: `${spreadParams.horizonHours} H · FASE 2`,
        dateIso: `${year}-${pad2(month)}-${pad2(day)}`,
      });
      return;
    }

    onContextChange?.({
      department: departmentName,
      territoryName,
      territoryType,
      dateLabel: navDateLabel,
      dateIso: `${year}-${pad2(month)}-${pad2(day)}`,
    });
  }, [
    onContextChange,
    tab,
    activeSimPoint,
    simLocation,
    globalTelemetry,
    spread,
    spreadParams.horizonHours,
    departmentName,
    territoryName,
    territoryType,
    navDateLabel,
    year,
    month,
    day,
  ]);

  /* --------------------------------------------------------- apuntar ---- */

  /**
   * Apuntar un territorio con el puntero lo consulta al backend.
   *
   * Es una consulta por territorio, no por pantalla: pedir la ficha de los
   * ciento noventa y seis al cargar sería desperdiciar la mayor parte. Tres
   * cosas la hacen barata: una espera corta antes de disparar, para que al
   * cruzar el mapa de lado a lado no se pida nada de lo que se atraviesa; una
   * caché por territorio, fecha y sensor, que hace instantáneo el segundo
   * apunte; y la cancelación de la petición en vuelo cuando el puntero se va
   * antes de que llegue.
   */
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const hoverCache = useRef(new Map<string, { summary: TerritorySummary; origin: Origin }>());

  /** Valor que la coropleta ya tiene en memoria para ese territorio. */
  const choroplethById = useMemo(
    () => new Map(choropleth.map((it) => [it.territory_id, it.value])),
    [choropleth]
  );

  useEffect(() => {
    if (!hoverId) {
      setHoverCard(null);
      return;
    }

    const name =
      territories?.features.find((f) => f.properties.territory_id === hoverId)?.properties
        .territory_name ?? hoverId;

    /* Lo que ya está en memoria se muestra sin pedir nada: el valor pintado
       en el mapa no necesita otro viaje al backend. */
    const painted = choroplethById.get(hoverId);
    const localRow = {
      k: METRIC_LABELS[metric],
      v: formatMetricValue(painted, metricUnit),
    };

    const key = `${territoryType}|${hoverId}|${sensor}|${dateIso}`;
    const hit = hoverCache.current.get(key);
    if (hit) {
      setHoverCard(buildHoverCard(hoverId, name, localRow, hit.summary, hit.origin));
      return;
    }

    setHoverCard({ id: hoverId, title: name, state: "loading", rows: [localRow] });

    if (!ready) return;

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      getSummary(
        { type: territoryType, id: hoverId, sensor, date: dateIso },
        ctrl.signal,
        !summaryOk
      )
        .then((r) => {
          // Sin ficha publicada no se inventa nada: queda el valor que el
          // mapa ya pintaba y se dice que no hay ficha para esa fecha.
          if (!r.data) {
            setHoverCard({
              id: hoverId,
              title: name,
              state: "ready",
              rows: [localRow],
              notice: "The data is not valid at this time or is not available for this date.",
              foot: r.origin === "unavailable" ? "Date not published for this sensor" : "No card published",
            });
            return;
          }
          hoverCache.current.set(key, { summary: r.data, origin: r.origin });
          setHoverCard(buildHoverCard(hoverId, name, localRow, r.data, r.origin));
        })
        .catch((e) => {
          if (isAbort(e)) return;
          setHoverCard({ id: hoverId, title: name, state: "error", rows: [localRow] });
        });
    }, 170);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    hoverId,
    ready,
    summaryOk,
    territories,
    territoryType,
    sensor,
    dateIso,
    metric,
    metricUnit,
    choroplethById,
  ]);

  /** Centro del territorio: lo usa la simulación cuando no hay recorte. */
  const territoryCenter = useMemo<LatLon | null>(() => {
    const f = territories?.features.find((x) => x.properties.territory_id === territoryId);
    if (!f) return null;
    const rings = f.geometry.type === "Polygon"
      ? (f.geometry.coordinates as number[][][])
      : (f.geometry.coordinates as number[][][][])[0];
    return polygonCentroid(rings[0] as [number, number][]);
  }, [territories, territoryId]);

  // Recuerda un punto interior del territorio elegido (para el cambio de tipo).
  useEffect(() => {
    const f = territories?.features.find((x) => x.properties.territory_id === territoryId);
    if (!f) return;
    try {
      lastSelectedPointRef.current = featureCentroid(f.geometry);
    } catch {
      /* geometría inválida: se conserva el punto anterior */
    }
  }, [territories, territoryId]);

  /* ---------------- focos NRT en vivo (NASA FIRMS via /realtime/area) --- */
  useEffect(() => {
    if (!liveFirms) {
      setFirmsSummary(null);
      return;
    }
    const ctrl = new AbortController();
    let south = -18.5;
    let north = 0.0;
    let west = -81.5;
    let east = -68.5;
    if (ring && ring.length >= 3) {
      const lats = ring.map((pt) => pt[0]);
      const lons = ring.map((pt) => pt[1]);
      south = Math.max(-89.5, Math.min(...lats) - 0.25);
      north = Math.min(89.5, Math.max(...lats) + 0.25);
      west = Math.max(-179.5, Math.min(...lons) - 0.25);
      east = Math.min(179.5, Math.max(...lons) + 0.25);
    } else if (territoryCenter) {
      south = Math.max(-89.5, territoryCenter[0] - 1.5);
      north = Math.min(89.5, territoryCenter[0] + 1.5);
      west = Math.max(-179.5, territoryCenter[1] - 1.5);
      east = Math.min(179.5, territoryCenter[1] + 1.5);
    }
    setFirmsSummary("Consultando NASA FIRMS NRT…");
    fetchRealtimeArea({ south, west, north, east }, 3, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        if (!res) {
          setFirmsSummary("Could not query /realtime/area.");
          return;
        }
        if (res.hotspots_status === "realtime_disabled") {
          setFirmsSummary("Real-time mode is disabled on the server.");
          return;
        }
        if (res.hotspots_status === "firms_map_key_required") {
          setFirmsSummary("FIRMS_MAP_KEY is missing on the backend.");
          return;
        }
        if (res.hotspots_status === "unavailable") {
          setFirmsSummary("Feed NASA FIRMS NRT temporalmente no disponible.");
          return;
        }
        const mapped: HotspotFeature[] = (res.hotspots?.features ?? []).map((f) => {
          const sat = String(f.properties.satellite ?? "").toLowerCase();
          const mappedSensor =
            f.properties.sensor === "MODIS"
              ? sat.includes("aqua") || sat === "a"
                ? "MODIS_AQUA"
                : "MODIS_TERRA"
              : "VIIRS_SNPP";
          return {
            type: "Feature",
            geometry: f.geometry,
            properties: {
              date: f.properties.acq_date ?? dateIso,
              sensor: mappedSensor,
              confidence: f.properties.confidence ?? null,
              frp_mw: f.properties.frp_mw ?? null,
            },
          };
        });
        setHotspots(mapped);
        setHotspotsOrigin("api");
        const c = res.counts_by_sensor ?? {};
        const winLabel = res.firms_mode === "public_nrt_csv" ? "48 h" : `${res.days ?? 3} d`;
        const dates = (res.hotspots?.features ?? [])
          .map((f) => f.properties.acq_date)
          .filter((d): d is string => Boolean(d))
          .sort();
        const latestDate = dates.length > 0 ? ` · ${dates[dates.length - 1]}` : "";
        setFirmsSummary(
          `NRT (${winLabel}${latestDate}): MODIS ${c.MODIS ?? 0} · VIIRS S-NPP ${c.VIIRS_SNPP ?? 0} · NOAA-20 ${c.VIIRS_NOAA20 ?? 0}`
        );
      })
      .catch((e) => {
        if (!isAbort(e)) setFirmsSummary("Could not query /realtime/area.");
      });
    return () => ctrl.abort();
  }, [liveFirms, ring, territoryCenter, dateIso]);

  const csvHref = useMemo(
    () =>
      territoryId
        ? exportCsvUrl({
            type: territoryType,
            id: territoryId,
            from: monthSpan.from,
            to: monthSpan.to,
            sensor,
          })
        : null,
    [territoryType, territoryId, monthSpan.from, monthSpan.to, sensor]
  );

  /* -------------------------------------------------------- simulacion --- */
  const executeSpreadAt = useCallback(
    async (area: LatLon[], ignPt: LatLon, baseParams: SpreadParams) => {
      const seq = ++spreadSeqRef.current;
      setSpreadRunning(true);
      setPlaying(false);
      try {
        const userSet = userSetParamsRef.current;
        const windFixed = userSet.has("windSpeedMs") || userSet.has("windDirDeg");
        const simPayload: Record<string, unknown> = {
          lat: ignPt[0],
          lon: ignPt[1],
          date: dateIso,
          horizon_h: Math.max(6, Math.min(48, Math.round(baseParams.horizonHours))),
          use_open_meteo: true,
          // Si el usuario fijó el viento, el servidor lo respeta; si no, lo trae de Open-Meteo.
          live_wind: !windFixed,
        };
        // Solo se envían los valores que el usuario fijó a mano; el resto NO se hardcodea
        // desde los valores por defecto de la interfaz: lo resuelven Open-Meteo / DEM / SAVI.
        if (userSet.has("windSpeedMs")) simPayload.wind_speed_10m_ms = baseParams.windSpeedMs;
        if (userSet.has("windDirDeg")) simPayload.wind_dir_deg = baseParams.windDirDeg;
        if (userSet.has("vegetationPct")) simPayload.vegetation_pct = baseParams.vegetationPct;
        if (userSet.has("fuelMoisturePct")) simPayload.fuel_moisture_pct = baseParams.fuelMoisturePct;
        if (slopeEditedRef.current) {
          simPayload.slope_mean_deg = baseParams.slopeMeanDeg;
        }

        const remote = await postSpreadSimulate(simPayload);
        if (seq !== spreadSeqRef.current) return;

        const remoteSlope = remote?.slope_summary?.mean_deg;
        const hasRemoteSlope =
          !slopeEditedRef.current &&
          typeof remoteSlope === "number" &&
          Number.isFinite(remoteSlope);

        // Viento y humedad del combustible: lo que devolvió Open-Meteo reemplaza el valor
        // por defecto de la interfaz, salvo que el usuario lo haya fijado.
        const liveWindSources = new Set(["Open-Meteo", "Open-Meteo Archive", "open_meteo_hourly"]);
        const liveWindOk =
          !windFixed && liveWindSources.has(remote?.data_sources?.wind_source ?? "");
        const dom = remote?.dominant_wind;
        const rhVals = (remote?.hourly_wind ?? [])
          .slice(0, 24)
          .map((h) => h.rh_pct)
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
        const rhMean =
          rhVals.length > 0 && remote?.hourly_wind?.[0]?.source === "open_meteo_hourly"
            ? rhVals.reduce((a, b) => a + b, 0) / rhVals.length
            : null;

        const effectiveParams: SpreadParams = {
          ...baseParams,
          slopeMeanDeg: hasRemoteSlope ? remoteSlope : baseParams.slopeMeanDeg,
        };
        if (liveWindOk && !windFixed && dom) {
          if (Number.isFinite(dom.wind_speed_10m_ms)) {
            effectiveParams.windSpeedMs = Math.max(0, Math.min(18, Number(dom.wind_speed_10m_ms.toFixed(1))));
          }
          if (Number.isFinite(dom.wind_dir_deg)) {
            effectiveParams.windDirDeg = Math.round(((dom.wind_dir_deg % 360) + 360) % 360);
          }
        }
        if (rhMean !== null && !userSet.has("fuelMoisturePct")) {
          effectiveParams.fuelMoisturePct = Math.max(4, Math.min(18, Math.round(4 + rhMean * 0.18)));
        }
        if (
          effectiveParams.windSpeedMs !== baseParams.windSpeedMs ||
          effectiveParams.windDirDeg !== baseParams.windDirDeg ||
          effectiveParams.fuelMoisturePct !== baseParams.fuelMoisturePct
        ) {
          setSpreadParams((prev) => ({
            ...prev,
            windSpeedMs: effectiveParams.windSpeedMs,
            windDirDeg: effectiveParams.windDirDeg,
            fuelMoisturePct: effectiveParams.fuelMoisturePct,
          }));
        }

        if (hasRemoteSlope) {
          const roundedSlope = Math.min(35, Math.max(0, Math.round(remoteSlope)));
          setSpreadParams((prev) =>
            prev.slopeMeanDeg === roundedSlope ? prev : { ...prev, slopeMeanDeg: roundedSlope }
          );
        }

        const r = simulateSpread({ ring: area, ignition: ignPt, ...effectiveParams });
        const extraAssumptions: string[] = [];

        if (remote) {
          const demSource = remote.slope_summary?.dem_source ?? remote.data_sources?.dem_source;
          const windSource = remote.data_sources?.wind_source;
          if (demSource) {
            extraAssumptions.push(
              typeof remoteSlope === "number" && Number.isFinite(remoteSlope)
                ? `${demSource} (pendiente ${remoteSlope.toFixed(1)}°)`
                : demSource
            );
          }
          if (windSource) {
            extraAssumptions.push(
              remote.dominant_wind
                ? `Clima global: ${windSource} (${remote.dominant_wind.wind_speed_10m_ms.toFixed(1)} m/s · ${Math.round(remote.dominant_wind.wind_dir_deg)}°)`
                : `Clima global: ${windSource}`
            );
          }
          setGlobalTelemetry((prev) => ({
            ...(prev ?? {}),
            demSource: demSource ?? prev?.demSource,
            slopeDeg:
              typeof remoteSlope === "number" && Number.isFinite(remoteSlope)
                ? remoteSlope
                : prev?.slopeDeg,
            weatherSource: windSource ?? prev?.weatherSource,
            windInfo: remote.dominant_wind
              ? `${remote.dominant_wind.wind_speed_10m_ms.toFixed(1)} m/s · ${Math.round(remote.dominant_wind.wind_dir_deg)}°`
              : prev?.windInfo,
            coordsLabel: formatLatLon(ignPt, 3),
          }));
        } else {
          extraAssumptions.push(
            "Local offline mode: synthetic terrain and fuel (/api/v1/spread-simulate not available)."
          );
          setGlobalTelemetry((prev) => ({
            ...(prev ?? {}),
            demSource: prev?.demSource ?? "Local synthetic terrain (offline)",
            coordsLabel: formatLatLon(ignPt, 3),
          }));
        }

        if (extraAssumptions.length > 0) {
          r.assumptions = [...extraAssumptions, ...r.assumptions];
        }

        setSpread(r);
        setSpreadTime(effectiveParams.horizonHours);
        setPlaying(true);
        setRightOpen("resultado");
      } finally {
        if (seq === spreadSeqRef.current) setSpreadRunning(false);
      }
    },
    [dateIso]
  );

  const runSpread = useCallback(async () => {
    if (!ring || !ignition) return;
    await executeSpreadAt(ring, ignition, spreadParams);
  }, [ring, ignition, spreadParams, executeSpreadAt]);

  const quickSimulateAt = useCallback(
    async (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const halfKm = 3.5;
      const dLat = halfKm / 111;
      const dLon = halfKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      const south = Math.max(-89.9, lat - dLat);
      const north = Math.min(89.9, lat + dLat);
      const west = Math.max(-179.9, lon - dLon);
      const east = Math.min(179.9, lon + dLon);
      const demoRing: LatLon[] = [
        [south, west],
        [south, east],
        [north, east],
        [north, west],
      ];
      const ignPt: LatLon = [lat, lon];

      slopeEditedRef.current = false;
      userSetParamsRef.current = new Set();
      setMode("pan");
      setRing(demoRing);
      setIgnition(ignPt);

      setEnvLoading(true);
      let nextParams: SpreadParams = { ...spreadParams, horizonHours: 24 };
      try {
        const rt = await fetchRealtimeArea({ south, west, north, east }, 3);
        const w = rt?.weather;
        const weatherOk = w?.status === "ok";
        if (weatherOk) {
          if (typeof w?.wind_speed_10m_ms === "number" && Number.isFinite(w.wind_speed_10m_ms)) {
            nextParams.windSpeedMs = Math.max(0, Math.min(18, Number(w.wind_speed_10m_ms.toFixed(1))));
          }
          if (typeof w?.wind_dir_deg === "number" && Number.isFinite(w.wind_dir_deg)) {
            nextParams.windDirDeg = Math.round(((w.wind_dir_deg % 360) + 360) % 360);
          }
          if (typeof w?.relative_humidity_2m_pct === "number" && Number.isFinite(w.relative_humidity_2m_pct)) {
            nextParams.fuelMoisturePct = Math.max(4, Math.min(18, Math.round(4 + w.relative_humidity_2m_pct * 0.18)));
          }
          setEnvApplied(true);
        }
        setSpreadParams(nextParams);
        const firmsAvail = rt?.hotspots_status === "ok" || rt?.hotspots_status === "partial";
        const firmsTotal = firmsAvail
          ? Object.values(rt?.counts_by_sensor ?? {}).reduce((a, b) => a + b, 0)
          : undefined;
        if (rt?.location?.status === "ok") {
          const geoKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
          geoCacheRef.current.set(geoKey, rt.location);
          setSimLocation(rt.location);
        }
        setGlobalTelemetry({
          locationLabel: rt?.location?.display_name ?? undefined,
          weatherSource: weatherOk ? w?.source ?? "Open-Meteo" : undefined,
          windInfo: `${nextParams.windSpeedMs.toFixed(1)} m/s · ${Math.round(nextParams.windDirDeg)}°`,
          tempC: typeof w?.t_amb_c === "number" ? w.t_amb_c : null,
          rhPct: typeof w?.relative_humidity_2m_pct === "number" ? w.relative_humidity_2m_pct : null,
          firmsStatus: rt?.hotspots_status,
          firmsTotal,
          coordsLabel: formatLatLon(ignPt, 3),
        });
      } finally {
        setEnvLoading(false);
      }

      await executeSpreadAt(demoRing, ignPt, nextParams);
    },
    [spreadParams, executeSpreadAt]
  );

  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !spread) return;
    let last = performance.now();
    if (spreadTime >= spreadParams.horizonHours) setSpreadTime(0);
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSpreadTime((t) => {
        const next = t + dt * (1 / 0.42);
        if (next >= spreadParams.horizonHours) {
          setPlaying(false);
          return spreadParams.horizonHours;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, spread, spreadParams.horizonHours]);

  /**
   * Lleva a la simulación clima global en vivo (Open-Meteo + FIRMS) y, si
   * la coordenada cae dentro de Ucayali, combina vegetación/pendiente/lluvia
   * del árbol de decisión de Fase 1 manteniendo desacoplados los contratos.
   */
  const applyEnvToSpread = useCallback(async () => {
    const seq = ++envSeqRef.current;
    userSetParamsRef.current = new Set();
    setEnvLoading(true);
    try {
      const activeCoord: LatLon | null =
        ignition ?? (ring && ring.length >= 3 ? ringCentroid(ring) : territoryCenter);

      let rt: RealtimeAreaResponse | null = null;
      if ((ring && ring.length >= 3) || ignition) {
        const rawBbox =
          ring && ring.length >= 3
            ? ringBounds(ring)
            : {
                south: ignition![0] - 0.2,
                west: ignition![1] - 0.2,
                north: ignition![0] + 0.2,
                east: ignition![1] + 0.2,
              };
        const pad = 0.05;
        const south = Math.max(-89.9, rawBbox.south === rawBbox.north ? rawBbox.south - pad : rawBbox.south);
        const north = Math.min(89.9, rawBbox.south === rawBbox.north ? rawBbox.north + pad : rawBbox.north);
        const west = Math.max(-179.9, rawBbox.west === rawBbox.east ? rawBbox.west - pad : rawBbox.west);
        const east = Math.min(179.9, rawBbox.west === rawBbox.east ? rawBbox.east + pad : rawBbox.east);
        if (south < north && west < east) {
          rt = await fetchRealtimeArea({ south, west, north, east }, 3);
        }
      }
      if (seq !== envSeqRef.current) return;

      const inUcayali = activeCoord
        ? activeCoord[0] >= -11.8 &&
          activeCoord[0] <= -7.0 &&
          activeCoord[1] >= -76.2 &&
          activeCoord[1] <= -70.3
        : Boolean(summary || dayRow);

      const factors = inUcayali ? summary?.environmental_conditions.factors ?? [] : [];
      const num = (name: string): number | null => {
        const f = factors.find((x) => x.variable === name);
        return typeof f?.value === "number" ? f.value : null;
      };

      const weatherOk = rt?.weather?.status === "ok";
      const liveWindMs =
        weatherOk && typeof rt?.weather.wind_speed_10m_ms === "number"
          ? rt.weather.wind_speed_10m_ms
          : null;
      const liveWindDir =
        weatherOk && typeof rt?.weather.wind_dir_deg === "number"
          ? rt.weather.wind_dir_deg
          : null;
      const liveRh =
        weatherOk && typeof rt?.weather.relative_humidity_2m_pct === "number"
          ? rt.weather.relative_humidity_2m_pct
          : null;
      const liveTemp =
        weatherOk && typeof rt?.weather.t_amb_c === "number" ? rt.weather.t_amb_c : null;

      const veg = inUcayali
        ? num("vegetation_area_pct") ?? num("effective_vegetation_area_pct")
        : null;
      const slopePct = inUcayali ? num("slope_class_area_pct") ?? num("slope_pct") : null;
      const precip = inUcayali ? num("precip_30d_mm") : null;

      const nextWindMs =
        liveWindMs ??
        (inUcayali ? dayRow?.wind_speed_10m_ms ?? spreadParams.windSpeedMs : spreadParams.windSpeedMs);
      const nextWindDir =
        liveWindDir ??
        (inUcayali ? dayRow?.wind_dir_deg ?? spreadParams.windDirDeg : spreadParams.windDirDeg);

      let nextFuelMoisture = spreadParams.fuelMoisturePct;
      if (inUcayali && precip !== null) {
        nextFuelMoisture = Math.max(4, Math.min(28, Math.round(4 + precip * 0.18)));
      } else if (liveRh !== null) {
        nextFuelMoisture = Math.max(4, Math.min(28, Math.round(4 + liveRh * 0.24)));
      }

      const nextSlope =
        slopePct !== null
          ? Math.round((Math.atan(slopePct / 100) * 180) / Math.PI)
          : spreadParams.slopeMeanDeg;
      if (slopePct !== null) {
        slopeEditedRef.current = false;
      }

      setSpreadParams((p) => ({
        ...p,
        windSpeedMs: nextWindMs,
        windDirDeg: nextWindDir,
        vegetationPct: veg ?? p.vegetationPct,
        slopeMeanDeg: slopePct !== null ? nextSlope : p.slopeMeanDeg,
        fuelMoisturePct: nextFuelMoisture,
      }));

      const firmsAvailable =
        rt?.hotspots_status === "ok" || rt?.hotspots_status === "partial";
      const firmsTotal = firmsAvailable
        ? Object.values(rt?.counts_by_sensor ?? {}).reduce((a, b) => a + b, 0)
        : undefined;

      setGlobalTelemetry((prev) => ({
        ...(prev ?? {}),
        weatherSource: weatherOk
          ? rt?.weather.source ?? "Open-Meteo"
          : inUcayali && (dayRow || summary)
            ? "Ucayali / ERA5-Land (local)"
            : undefined,
        windInfo: `${nextWindMs.toFixed(1)} m/s · ${Math.round(nextWindDir)}°`,
        tempC: liveTemp ?? (inUcayali ? dayRow?.t_amb_c ?? null : null),
        rhPct: liveRh,
        firmsStatus: rt?.hotspots_status,
        firmsTotal,
        coordsLabel: activeCoord ? formatLatLon(activeCoord, 3) : undefined,
      }));
      setEnvApplied(true);
    } finally {
      if (seq === envSeqRef.current) setEnvLoading(false);
    }
  }, [
    ignition,
    ring,
    territoryCenter,
    summary,
    dayRow,
    spreadParams.windSpeedMs,
    spreadParams.windDirDeg,
    spreadParams.fuelMoisturePct,
    spreadParams.slopeMeanDeg,
  ]);

  const visibleSpread = tab === "simulacion" ? spread : null;
  const dataValidityNotice = useMemo(() => {
    if (!ready) return null;
    if (unavailable) return unavailable;
    if (origin === "unavailable") {
      return `The data for ${dateIso} is not valid at this time or is not available.`;
    }
    if (isLiveHistorical(dayRow)) {
      return `Detections for ${dateIso} queried live from NASA FIRMS: no coverage or rate calculated (no raster for this date).`;
    }
    if (
      dayRow &&
      ((dayRow.valid_land_pixels ?? 0) === 0 || (dayRow.observation_coverage ?? 0) === 0)
    ) {
      return `No valid observation on ${dateIso}: the data is not available (0 valid land pixels).`;
    }
    if (
      dayRow &&
      (dayRow.activity_rate == null ||
        (dayRow.observation_coverage != null && dayRow.observation_coverage < 0.7))
    ) {
      return `Coverage < 70 % on ${dateIso}: the data is not valid for estimating thermal activity.`;
    }
    if (summary?.data_quality?.status === "insufficient") {
      return "Insufficient quality: the data for this period is not valid or is not available.";
    }
    if (!dailyLoading && usefulDays.length === 0) {
      return `No valid days available this month for ${SENSOR_META[sensor].label}.`;
    }
    return null;
  }, [ready, unavailable, origin, dateIso, dayRow, summary, dailyLoading, usefulDays.length, sensor]);
  const isHighSusceptibility =
    summary?.environmental_conditions?.classification === "high";
  const highAlertKey = `${territoryType}|${territoryId}|${period}`;
  const showHighAlert =
    isHighSusceptibility && dismissedHighKey !== highAlertKey && rightOpen !== "arbol";

  const openSusceptibilityTree = useCallback(
    (targetId?: string, targetType?: TerritoryType) => {
      if (tab !== "calendario") {
        window.location.hash = "#/mapa";
      }
      if (targetType && targetType !== territoryType) {
        setTerritoryType(targetType);
      }
      if (targetId && targetId !== territoryId) {
        setTerritoryId(targetId);
      }
      setRightOpen("arbol");
    },
    [tab, territoryType, territoryId]
  );

  const { highMarkers, priorityZones } = useMemo(() => {
    const markers: HighSusceptibilityMarker[] = [];
    const zones: PrioritySubZone[] = [];
    if (!territories) return { highMarkers: markers, priorityZones: zones };

    const activeHighIds = new Set<string>(
      susceptibilityItems
        .filter((it) => it.value === "high")
        .map((it) => it.territory_id)
    );
    if (isHighSusceptibility && territoryId) {
      activeHighIds.add(territoryId);
    }

    for (const f of territories.features) {
      const id = f.properties.territory_id;
      if (!activeHighIds.has(id)) continue;
      const tName = f.properties.territory_name ?? id;
      markers.push({
        id: `ter-${territoryType}-${id}`,
        name: tName,
        position: featureCentroid(f.geometry),
        kind: "territory",
        targetTerritoryType: territoryType,
        targetTerritoryId: id,
        detail: `Susceptibilidad contextual alta · ${periodLabel}`,
      });
    }

    const selectedFeature = territories.features.find(
      (f) => f.properties.territory_id === territoryId
    );
    if (!selectedFeature) return { highMarkers: markers, priorityZones: zones };
    const selectedName = selectedFeature.properties.territory_name ?? territoryId;

    // 1. Subcuencas (hydro_unit) clasificadas en susceptibilidad alta dentro de la provincia macro seleccionada.
    if (territoryType === "province" && hydroTerritories) {
      const hydroHighIds = new Set<string>(
        hydroSusceptibility
          .filter((it) => it.value === "high")
          .map((it) => it.territory_id)
      );
      for (const hf of hydroTerritories.features) {
        if (!hydroHighIds.has(hf.properties.territory_id)) continue;
        const hc = featureCentroid(hf.geometry);
        if (!pointInFeature(hc, selectedFeature.geometry)) continue;
        const hName = hf.properties.territory_name ?? hf.properties.territory_id;
        const rings = featureOuterRings(hf.geometry);
        if (rings.length > 0) {
          zones.push({
            id: `sub-${hf.properties.territory_id}`,
            label: hName,
            rings,
            kind: "subbasin",
            targetTerritoryType: "hydro_unit",
            targetTerritoryId: hf.properties.territory_id,
            detail: `Priority sub-basin within ${selectedName}`,
          });
        }
        markers.push({
          id: `subm-${hf.properties.territory_id}`,
          name: hName,
          position: hc,
          kind: "subbasin",
          targetTerritoryType: "hydro_unit",
          targetTerritoryId: hf.properties.territory_id,
          detail: `Sub-basin with high susceptibility · ${selectedName}`,
        });
      }
    }

    // 2. Polígonos envolventes alrededor de los focos más severos (8-9) dentro de la región macro.
    if (hotspots.length > 0) {
      const insidePts: { latLon: LatLon; conf: unknown; frp: number }[] = [];
      for (const hs of hotspots) {
        const [lon, lat] = hs.geometry.coordinates;
        const p: LatLon = [lat, lon];
        if (pointInFeature(p, selectedFeature.geometry)) {
          insidePts.push({
            latLon: p,
            conf: hs.properties.confidence,
            frp: hs.properties.frp_mw ?? 0,
          });
        }
      }

      const severeHigh = insidePts.filter((x) => {
        const c = String(x.conf ?? "").toLowerCase();
        return x.conf === 9 || c === "high" || c === "h";
      });
      const severeNominalHigh = insidePts.filter((x) => {
        const c = String(x.conf ?? "").toLowerCase();
        return x.conf === 9 || x.conf === 8 || c === "high" || c === "nominal" || c === "h" || c === "n";
      });

      const targetPts =
        severeHigh.length >= 2
          ? severeHigh.map((x) => x.latLon)
          : severeNominalHigh.length > 0
            ? severeNominalHigh.map((x) => x.latLon)
            : insidePts.length > 0
              ? insidePts.map((x) => x.latLon)
              : [];

      if (targetPts.length >= 1) {
        const hasCritical = severeNominalHigh.length > 0 || isHighSusceptibility;
        const clusters = clusterHotspotsIntoEnclosures(targetPts, 34, 4.5);
        clusters.forEach((cl, idx) => {
          zones.push({
            id: `enc-${territoryId}-${idx}`,
            label: `${selectedName} · Core ${idx + 1}`,
            rings: [cl.ring],
            kind: "enclosure",
            targetTerritoryType: territoryType,
            targetTerritoryId: territoryId,
            detail: hasCritical
              ? `${cl.count} critical hotspot${cl.count === 1 ? "" : "s"} in a priority monitoring region`
              : `${cl.count} clustered hotspot${cl.count === 1 ? "" : "s"} (low conf. · verify area)`,
          });
          if (hasCritical && (isHighSusceptibility || idx === 0)) {
            markers.push({
              id: `clm-${territoryId}-${idx}`,
              name: `${selectedName} (priority core ${idx + 1})`,
              position: cl.center,
              kind: "cluster",
              targetTerritoryType: territoryType,
              targetTerritoryId: territoryId,
              detail: `${cl.count} high-severity hotspot${cl.count === 1 ? "" : "s"} · click → tree`,
            });
          }
        });
      }
    }

    return { highMarkers: markers, priorityZones: zones };
  }, [
    territories,
    susceptibilityItems,
    isHighSusceptibility,
    territoryId,
    territoryType,
    periodLabel,
    hydroTerritories,
    hydroSusceptibility,
    hotspots,
  ]);

  const rightItems =
    tab === "calendario"
      ? ANALYSIS_ITEMS.map((it) =>
          it.id === "arbol" && isHighSusceptibility
            ? { ...it, badge: "!", badgeTone: "ember" as const }
            : it
        )
      : SPREAD_ITEMS;

  const leftItems = LEFT_ITEMS.map((it) =>
    it.id === "area" ? { ...it, badge: territoryType === "province" ? "Prov" : "Cuen" } : it
  );

  const nominalHigh = hotspots.filter((f) => {
    const c = f.properties.confidence;
    return typeof c === "number" ? c >= 8 : c !== "low";
  }).length;

  return (
    <>
      {liveFirmsAutoOffNotice && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2000,
            maxWidth: 480,
            border: "1px solid var(--acid)",
            background: "var(--surface-1)",
            color: "var(--text-0, #fff)",
            padding: "10px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            boxShadow: "0 4px 18px rgba(0,0,0,0.4)",
          }}
        >
          <span className="mono-sm">{liveFirmsAutoOffNotice}</span>
          <button
            type="button"
            className="btn"
            style={{ flexShrink: 0 }}
            onClick={() => setLiveFirmsAutoOffNotice(null)}
          >
            OK
          </button>
        </div>
      )}
      <div
        className="tool"
        data-left={leftOpen ? "open" : "closed"}
        data-right={rightOpen ? "open" : "closed"}
      >
        <DockBar items={leftItems} open={leftOpen} onOpen={setLeftOpen} side="left" />

        <div className="dock dock--left">
          {leftOpen && (
            <ControlRail
              section={leftOpen}
              onClose={() => setLeftOpen(null)}
              year={year}
              month={month}
              onPeriod={handlePeriod}
              day={day}
              onDay={handleDay}
              dateIso={dateIso}
              granularity={granularity}
              onGranularity={setGranularity}
              metadata={metadata}
              daily={daily}
              usefulDays={usefulDays}
              dailyLoading={dailyLoading}
              territoryType={territoryType}
              onTerritoryType={setTerritoryType}
              territoryId={territoryId}
              onTerritoryId={setTerritoryId}
              territories={territories}
              sensor={sensor}
              onSensor={handleSensor}
              metric={metric}
              onMetric={setMetric}
              showHotspots={showHotspots}
              onShowHotspots={setShowHotspots}
              liveFirms={liveFirms}
              onLiveFirms={setLiveFirms}
              firmsSummary={firmsSummary}
              showChoropleth={showChoropleth}
              onShowChoropleth={setShowChoropleth}
              showHighMarkers={showHighMarkers}
              onShowHighMarkers={setShowHighMarkers}
              showCalendar={showCalendar}
              onShowCalendar={setShowCalendar}
              baseLayer={baseLayer}
              onBaseLayer={setBaseLayer}
              ring={ring}
              onRing={setRing}
              hotspots={hotspots}
              calendar={calendar}
              origin={origin}
              csvHref={csvHref}
              monthSpan={monthSpan}
            />
          )}
        </div>

        <main className="center">
          <MapStage
            mode={mode}
            onModeChange={setMode}
            ring={ring}
            onRingChange={setRing}
            ignition={ignition}
            onIgnitionChange={setIgnition}
            hotspots={hotspots}
            showHotspots={showHotspots}
            territories={territories}
            choropleth={showChoropleth ? choropleth : []}
            metric={metric}
            metricUnit={metricUnit}
            selectedId={territoryId}
            onSelectTerritory={setTerritoryId}
            onHoverTerritory={setHoverId}
            hoverCard={hoverCard}
            spread={visibleSpread}
            spreadTime={spreadTime}
            spreadHorizon={spreadParams.horizonHours}
            baseLayer={baseLayer}
            onBaseLayer={setBaseLayer}
            windDirDeg={envApplied ? spreadParams.windDirDeg : dayRow?.wind_dir_deg ?? null}
            windSpeedMs={envApplied ? spreadParams.windSpeedMs : dayRow?.wind_speed_10m_ms ?? null}
            showWind={tab === "simulacion"}
            relayoutKey={`${leftOpen ?? ""}|${rightOpen ?? ""}|${showCalendar}`}
            dataNotice={tab === "calendario" ? dataValidityNotice : null}
            highMarkers={highMarkers}
            priorityZones={priorityZones}
            showHighMarkers={showHighMarkers}
            onOpenSusceptibilityTree={openSusceptibilityTree}
          >
            <OrbitalLoader
              scope="stage"
              active={!suspendLoader && (!baseLoaded || spreadRunning || Boolean(tabTransition))}
              label={
                !baseLoaded
                  ? "Loading territories and sensors…"
                  : spreadRunning
                  ? "Computing spread front…"
                  : tabTransition ?? undefined
              }
              blocking={!baseLoaded || spreadRunning}
            />

            {showHighAlert && (
              <div className="susc-alert" role="alert" aria-live="polite">
                <div className="susc-alert__head">
                  <span className="susc-alert__dot" aria-hidden="true" />
                  <strong>High susceptibility in {territoryName}</strong>
                </div>
                <p className="susc-alert__body">
                  The decision tree flags conditions very favorable to fire spread in{" "}
                  {periodLabel}. It is worth reviewing the evidence and comparing sensors.
                </p>
                <div className="susc-alert__actions">
                  <button
                    type="button"
                    className="btn btn--ember"
                    onClick={() => {
                      setRightOpen("arbol");
                      setDismissedHighKey(highAlertKey);
                    }}
                  >
                    Review tree →
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setDismissedHighKey(highAlertKey)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </MapStage>

          {showCalendar ? (
            <CalendarStrip
              calendar={calendar}
              sensor={sensor}
              onSensor={handleSensor}
              year={year}
              month={month}
              onPick={handlePeriod}
              daily={daily}
              metadata={metadata}
              areaLabel={territoryName}
              onHide={() => setShowCalendar(false)}
              noTerritory={!territoryId}
              selectedDate={dateIso}
              onPickDay={(d) => {
                if (usefulDays.length > 0 && !usefulDays.includes(d)) return;
                handleDay(d);
                setGranularity("day");
              }}
            />
          ) : (
            <button
              type="button"
              className="calbar-restore"
              onClick={() => setShowCalendar(true)}
              aria-label="Show the thermal activity calendar"
              data-tour="calendar-strip"
            >
              <span className="panel__idx">06</span>
              <span className="calbar-restore__title">Thermal activity calendar</span>
              <span className="calbar-restore__cta">▲ Show panel</span>
            </button>
          )}
        </main>

        <div className="dock dock--right">
          {rightOpen && tab === "calendario" && (
            <AnalysisRail
              section={rightOpen}
              onClose={() => setRightOpen(null)}
              onOpenConventions={onOpenConventions}
              cell={cell}
              summary={summary}
              comparison={comparison}
              dayRow={dayRow}
              dateIso={dateIso}
              areaLabel={territoryName}
              periodLabel={periodLabel}
              metadata={metadata}
            />
          )}
          {rightOpen && tab === "simulacion" && (
            <SpreadRail
              section={rightOpen}
              onClose={() => setRightOpen(null)}
              params={spreadParams}
              onParams={(p) => {
                if (p.slopeMeanDeg !== spreadParams.slopeMeanDeg) {
                  slopeEditedRef.current = true;
                }
                // Registra qué controles tocó el usuario: solo esos se envían al servidor.
                for (const k of [
                  "windSpeedMs",
                  "windDirDeg",
                  "vegetationPct",
                  "fuelMoisturePct",
                ] as const) {
                  if (p[k] !== spreadParams[k]) userSetParamsRef.current.add(k);
                }
                setSpreadParams(p);
                setEnvApplied(false);
              }}
              ring={ring}
              ignition={ignition}
              onPickIgnition={() => setMode("ignition")}
              result={spread}
              running={spreadRunning}
              time={spreadTime}
              onTime={(t) => {
                setPlaying(false);
                setSpreadTime(t);
              }}
              onRun={runSpread}
              onQuickSimulate={quickSimulateAt}
              onPlayPause={() => setPlaying((v) => !v)}
              playing={playing}
              envApplied={envApplied}
              onApplyEnv={applyEnvToSpread}
              hasEnv={Boolean(summary || ring || ignition)}
              envLoading={envLoading}
              globalTelemetry={
                globalTelemetry || simLocation?.display_name
                  ? {
                      ...(globalTelemetry ?? {}),
                      locationLabel: simLocation?.display_name ?? globalTelemetry?.locationLabel,
                      coordsLabel:
                        globalTelemetry?.coordsLabel ??
                        (activeSimPoint ? formatLatLon(activeSimPoint, 3) : undefined),
                    }
                  : null
              }
              center={territoryCenter}
              dateIso={dateIso}
            />
          )}
        </div>

        <DockBar items={rightItems} open={rightOpen} onOpen={setRightOpen} side="right" />
      </div>

      <footer className="status">
        <span title={SENSOR_META[sensor].product}>
          <b>Sensor</b> {SENSOR_META[sensor].label}
        </span>
        <span title="Pixels with nominal or high confidence detection (FireMask classes 8–9; excludes low-confidence class 7)">
          <b>Detections (nominal/high conf.)</b> {nominalHigh.toLocaleString("es-PE")}
        </span>
        <span className="status__spacer" />
        {unavailable ? (
          <span className="chip chip--warn">{unavailable}</span>
        ) : (
          origin !== "unavailable" &&
          dataValidityNotice && <span className="chip chip--warn">{dataValidityNotice}</span>
        )}
        {origin === "fixture" ? (
          <span className="chip chip--warn">Sample indicators · not real observations</span>
        ) : origin === "unavailable" ? (
          <span className="chip chip--warn">No data published for this date and sensor</span>
        ) : (
          <span className="chip chip--term">Indicators from /api/v1</span>
        )}
        {origin === "api" && hotspotsOrigin === "fixture" && (
          <span className="chip chip--warn">Sample hotspots · could not reach the backend</span>
        )}
        {span.from !== span.to && (
          <span className="status__src">{`${span.from} → ${span.to}`}</span>
        )}
      </footer>

      <GuidedTour
        phase={suspendTour ? "closed" : tourPhase}
        steps={tab === "simulacion" ? SPREAD_TOUR_STEPS : MAP_TOUR_STEPS}
        onStart={() => {
          if (tab === "simulacion") setRightOpen("escenario");
          else setShowCalendar(true);
          setTourPhase("tour");
        }}
        onDismiss={(dontShowAgain) => {
          if (dontShowAgain) setTourDismissed(true);
          setTourPhase("closed");
        }}
      />
    </>
  );
}
