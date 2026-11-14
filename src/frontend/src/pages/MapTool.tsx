import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlRail, LEFT_ITEMS } from "../components/ControlRail";
import { MapStage, type DrawMode } from "../components/MapStage";
import { CalendarStrip } from "../components/CalendarStrip";
import { AnalysisRail, ANALYSIS_ITEMS } from "../components/AnalysisRail";
import { SpreadRail, SPREAD_ITEMS, type SpreadParams } from "../components/SpreadRail";
import { DockBar } from "../components/DockBar";
import type { ToolTab } from "../components/SiteNav";
import {
  ApiError,
  availablePeriodsForSensor,
  exportCsvUrl,
  fetchCalendar,
  getBackendState,
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
  probeBackend,
  publishedDaysInMonth,
  rangeBounds,
  splitIso,
  usefulDaysFromRows,
  type BackendState,
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
import { polygonCentroid, type LatLon } from "../lib/geo";
import { simulateSpread, type SpreadResult } from "../lib/spread";

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MONTHLY_METRICS = new Set<MetricId>([
  "fire_pixel_days_8_9",
  "active_days",
  "max_consecutive_active_days",
]);

interface Props {
  tab: ToolTab;
  onBackend: (s: BackendState) => void;
}

export function MapTool({ tab, onBackend }: Props) {
  /* ------------------------------------------------------------- estado -- */

  /**
   * El territorio es la clave de toda consulta: el contrato pide siempre
   * tipo + id, y provincias y cuencas no se mezclan en un mismo ranking.
   */
  const [territoryType, setTerritoryType] = useState<TerritoryType>(DEFAULT_TERRITORY.type);
  const [territoryId, setTerritoryId] = useState<string>(DEFAULT_TERRITORY.id);
  const [territories, setTerritories] = useState<TerritoryCollection | null>(null);

  const [year, setYear] = useState(FIXTURE_LAST_YEAR);
  const [month, setMonth] = useState(FIXTURE_LAST_MONTH);
  const [day, setDay] = useState(15);
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
  const [showChoropleth, setShowChoropleth] = useState(true);
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
    horizonHours: 12,
  });
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadRunning, setSpreadRunning] = useState(false);
  const [spreadTime, setSpreadTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [envApplied, setEnvApplied] = useState(false);

  // Al cambiar de pestaña, el cajón derecho ya no corresponde.
  useEffect(() => setRightOpen(null), [tab]);

  /* ----------------------------------------------------- sondeo backend -- */
  useEffect(() => {
    let alive = true;
    probeBackend().then((s) => alive && onBackend(s));
    const id = setInterval(() => probeBackend().then((s) => alive && onBackend(s)), 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onBackend]);

  /* -------------------------------------------------------- metadatos ---- */
  useEffect(() => {
    const ctrl = new AbortController();
    getMetadata(ctrl.signal)
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
    return () => ctrl.abort();
  }, []);

  /* ------------------------------------------------------- territorios --- */
  useEffect(() => {
    const ctrl = new AbortController();
    setTerritories(null);
    getTerritories(territoryType, ctrl.signal)
      .then((r) => {
        const col = r.data;
        setTerritories(col);
        // Al cambiar de tipo, el id anterior pertenece a otra familia: se
        // toma el primero del nuevo tipo en vez de dejar una selección que
        // no existe.
        const ids = col?.features.map((f) => f.properties.territory_id) ?? [];
        if (ids.length > 0 && !ids.includes(territoryId)) {
          setTerritoryId(ids[0]);
        }
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
  const fallbackTriedPeriodsRef = useRef<Set<string>>(new Set());

  const handleSensor = useCallback((nextSensor: Sensor) => {
    userPickedPeriodRef.current = false;
    fallbackTriedPeriodsRef.current.clear();
    setSensor(nextSensor);
  }, []);

  const handlePeriod = useCallback((nextYear: number, nextMonth: number) => {
    userPickedPeriodRef.current = true;
    fallbackTriedPeriodsRef.current.clear();
    setYear(nextYear);
    setMonth(nextMonth);
  }, []);

  /**
   * Al llegar los metadatos o cambiar de sensor/año/mes, si la fecha abierta
   * no cae dentro de los períodos o rangos publicados del sensor activo, se
   * ajusta automáticamente al último año/mes/día válido.
   */
  useEffect(() => {
    if (!metadata || availablePeriods.size === 0) return;

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
      const last = lastAvailableDate(sensor, metadata);
      if (last) {
        const { year: y, month: m, day: d } = splitIso(last);
        setYear(y);
        setMonth(m);
        setDay(d);
      }
    }
  }, [metadata, sensor, year, month, period, dateIso, availablePeriods, validYears]);

  /**
   * Las fechas publicadas las decide `metadata`, no esta interfaz. Si el día
   * elegido no está, se avisa en vez de pedirlo y mostrar un hueco.
   */
  useEffect(() => {
    if (!metadata) return setUnavailable(null);
    setUnavailable(
      isDateAvailable(dateIso, sensor, metadata)
        ? null
        : `${sensor} no publica datos del ${dateIso}`
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
  const activeMonthKey = `${territoryType}|${territoryId}|${sensor}|${period}`;
  const dailyLoading = dailyKey !== activeMonthKey;

  /**
   * Disponibilidad por endpoint según `metadata` (§5 del contrato).
   * Si la fecha o el período no está publicado para ese endpoint, se omite
   * la llamada para evitar `422 PERIOD_NOT_AVAILABLE` innecesarios.
   */
  const activityOk = metadata ? isDateAvailable(dateIso, sensor, metadata) : false;
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
    if (!ready) return;
    const ctrl = new AbortController();
    getHotspots(
      { type: territoryType, id: territoryId, date: dateIso, sensor },
      ctrl.signal,
      !activityOk
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
  }, [ready, activityOk, territoryType, territoryId, dateIso, sensor]);

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
      if (!usefulDays.includes(day)) {
        setDay(usefulDays[usefulDays.length - 1]);
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

  /* --------------------------------------------------------- derivados --- */

  /** Calendario del sensor activo, con la anomalía del mes mirado. */
  const calendar: MonthCell[] = useMemo(() => {
    if (apiCalendar !== null) {
      return mergeAnomaly(apiCalendar, period, summary?.activity.historical_anomaly ?? null);
    }
    const cells = aggregateMonthly(series.length ? series : daily, sensor);
    return mergeAnomaly(cells, period, summary?.activity.historical_anomaly ?? null);
  }, [apiCalendar, series, daily, sensor, period, summary]);

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

  /** Centro del territorio: lo usa la simulación cuando no hay recorte. */
  const territoryCenter = useMemo<LatLon | null>(() => {
    const f = territories?.features.find((x) => x.properties.territory_id === territoryId);
    if (!f) return null;
    const rings = f.geometry.type === "Polygon"
      ? (f.geometry.coordinates as number[][][])
      : (f.geometry.coordinates as number[][][][])[0];
    return polygonCentroid(rings[0] as [number, number][]);
  }, [territories, territoryId]);

  const periodLabel = `${MONTHS_ES[month - 1]} ${year}`;

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
  const runSpread = useCallback(() => {
    const area = ring;
    if (!area || !ignition) return;
    setSpreadRunning(true);
    setPlaying(false);
    requestAnimationFrame(() => {
      try {
        const r = simulateSpread({ ring: area, ignition, ...spreadParams });
        setSpread(r);
        setSpreadTime(spreadParams.horizonHours);
        setPlaying(true);
        setRightOpen("resultado");
      } finally {
        setSpreadRunning(false);
      }
    });
  }, [ring, ignition, spreadParams]);

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
   * Lleva a la simulación el viento del día y los factores del árbol de
   * decisión, que es lo que la arquitectura v1.2 §12.1 manda reutilizar en
   * Fase 2 en vez de pedir variables nuevas.
   */
  const applyEnvToSpread = useCallback(() => {
    const factors = summary?.environmental_conditions.factors ?? [];
    const num = (name: string): number | null => {
      const f = factors.find((x) => x.variable === name);
      return typeof f?.value === "number" ? f.value : null;
    };

    setSpreadParams((p) => {
      const veg = num("vegetation_area_pct") ?? num("effective_vegetation_area_pct");
      const slopePct = num("slope_class_area_pct") ?? num("slope_pct");
      const precip = num("precip_30d_mm");
      return {
        ...p,
        windSpeedMs: dayRow?.wind_speed_10m_ms ?? p.windSpeedMs,
        windDirDeg: dayRow?.wind_dir_deg ?? p.windDirDeg,
        vegetationPct: veg ?? p.vegetationPct,
        // El árbol informa pendiente en porcentaje; la simulación la usa en
        // grados.
        slopeMeanDeg: slopePct !== null ? Math.round((Math.atan(slopePct / 100) * 180) / Math.PI) : p.slopeMeanDeg,
        // Sin humedad de combustible medida, se aproxima con la lluvia de los
        // 30 días previos y se acota al rango útil del modelo.
        fuelMoisturePct:
          precip !== null ? Math.max(4, Math.min(28, Math.round(4 + precip * 0.18))) : p.fuelMoisturePct,
      };
    });
    setEnvApplied(true);
  }, [summary, dayRow]);

  const visibleSpread = tab === "simulacion" ? spread : null;
  const rightItems = tab === "calendario" ? ANALYSIS_ITEMS : SPREAD_ITEMS;

  const leftItems = LEFT_ITEMS.map((it) =>
    it.id === "area" ? { ...it, badge: territoryType === "province" ? "Prov" : "Cuen" } : it
  );

  const nominalHigh = hotspots.filter((f) => {
    const c = f.properties.confidence;
    return typeof c === "number" ? c >= 8 : c !== "low";
  }).length;

  return (
    <>
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
              onDay={setDay}
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
              showChoropleth={showChoropleth}
              onShowChoropleth={setShowChoropleth}
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
            spread={visibleSpread}
            spreadTime={spreadTime}
            spreadHorizon={spreadParams.horizonHours}
            baseLayer={baseLayer}
            windDirDeg={dayRow?.wind_dir_deg ?? null}
            windSpeedMs={dayRow?.wind_speed_10m_ms ?? null}
            showWind={tab === "simulacion"}
            relayoutKey={`${leftOpen ?? ""}|${rightOpen ?? ""}|${showCalendar}`}
          />

          {showCalendar && (
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
              selectedDate={dateIso}
              onPickDay={(d) => {
                if (usefulDays.length > 0 && !usefulDays.includes(d)) return;
                setDay(d);
                setGranularity("day");
              }}
            />
          )}
        </main>

        <div className="dock dock--right">
          {rightOpen && tab === "calendario" && (
            <AnalysisRail
              section={rightOpen}
              onClose={() => setRightOpen(null)}
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
              onPlayPause={() => setPlaying((v) => !v)}
              playing={playing}
              envApplied={envApplied}
              onApplyEnv={applyEnvToSpread}
              hasEnv={Boolean(summary)}
              center={territoryCenter}
            />
          )}
        </div>

        <DockBar items={rightItems} open={rightOpen} onOpen={setRightOpen} side="right" />
      </div>

      <footer className="status">
        <span className="status__prompt">root@mchanaq ~ %</span>
        <span>
          <b>{granularity === "day" ? "día" : "mes"}</b>{" "}
          {granularity === "day" ? dateIso : periodLabel}
        </span>
        <span>
          <b>{territoryType === "province" ? "provincia" : "cuenca"}</b> {territoryName}
        </span>
        <span><b>focos 8–9</b> {nominalHigh.toLocaleString("es-PE")}</span>
        <span><b>sensor</b> {sensor}</span>
        <span className="status__spacer" />
        {unavailable && <span className="chip chip--warn">{unavailable}</span>}
        {origin === "fixture" ? (
          <span className="chip chip--warn">Indicadores de muestra · no son observaciones reales</span>
        ) : origin === "unavailable" ? (
          <span className="chip chip--warn">Sin publicación para esta fecha en /api/v1</span>
        ) : (
          <span className="chip chip--term">Indicadores desde /api/v1</span>
        )}
        {origin === "api" && hotspotsOrigin === "fixture" && (
          <span className="chip chip--warn">Focos de muestra · el backend no publica /hotspots</span>
        )}
        <span className="status__src">{span.from === span.to ? span.from : `${span.from} → ${span.to}`}</span>
      </footer>
    </>
  );
}
