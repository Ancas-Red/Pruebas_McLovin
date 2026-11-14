import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlRail } from "../components/ControlRail";
import { MapStage, type DrawMode } from "../components/MapStage";
import { CalendarStrip } from "../components/CalendarStrip";
import { AnalysisRail } from "../components/AnalysisRail";
import { SpreadRail, type SpreadParams } from "../components/SpreadRail";
import type { ToolTab } from "../components/SiteNav";
import {
  deriveComparison,
  deriveSusceptibility,
  fetchCalendar,
  fetchDailySeries,
  fetchEnvConditions,
  fetchHotspots,
  probeBackend,
  type BackendState,
} from "../api/client";
import type { EnvConditions, Hotspot, MonthCell, Sensor } from "../api/types";
import { SENSORS } from "../api/types";
import { FIXTURE_LAST_MONTH, FIXTURE_LAST_YEAR } from "../lib/fixtures";
import { PERU_CENTER, ringCentroid, type LatLon } from "../lib/geo";
import { simulateSpread, type SpreadResult } from "../lib/spread";

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Props {
  tab: ToolTab;
  onBackend: (s: BackendState) => void;
}

export function MapTool({ tab, onBackend }: Props) {
  /* ------------------------------------------------------------- estado -- */
  const [year, setYear] = useState(FIXTURE_LAST_YEAR);
  const [month, setMonth] = useState(FIXTURE_LAST_MONTH);
  const [sensors, setSensors] = useState<Sensor[]>([...SENSORS]);
  const [calendarSensor, setCalendarSensor] = useState<Sensor>("VIIRS_SNPP");
  const [includeLow, setIncludeLow] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);
  const [baseLayer, setBaseLayer] = useState<"dark" | "terrain" | "satellite">("dark");

  const [ring, setRing] = useState<LatLon[] | null>(null);
  const [ignition, setIgnition] = useState<LatLon | null>(null);
  const [mode, setMode] = useState<DrawMode>("pan");

  /** Oculta los raíles laterales y el calendario: el mapa a pantalla completa. */
  const [focusMap, setFocusMap] = useState(false);

  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [calendars, setCalendars] = useState<Partial<Record<Sensor, MonthCell[]>>>({});
  const [env, setEnv] = useState<EnvConditions | null>(null);
  const [origin, setOrigin] = useState<"api" | "fixture">("fixture");

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

  /* ----------------------------------------------------- sondeo backend -- */
  useEffect(() => {
    let alive = true;
    probeBackend().then((s) => alive && onBackend(s));
    const id = setInterval(() => {
      probeBackend().then((s) => alive && onBackend(s));
    }, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onBackend]);

  /* --------------------------------------------------------- hotspots ---- */
  useEffect(() => {
    let alive = true;
    fetchHotspots({ sensors, year, month, ring, includeLowConfidence: includeLow }).then((r) => {
      if (!alive) return;
      setHotspots(r.data);
      setOrigin(r.origin);
    });
    return () => {
      alive = false;
    };
  }, [sensors, year, month, ring, includeLow]);

  /* -------------------------------------------------------- calendarios -- */
  useEffect(() => {
    let alive = true;
    Promise.all(SENSORS.map((s) => fetchCalendar({ sensor: s, ring }))).then((results) => {
      if (!alive) return;
      const next: Partial<Record<Sensor, MonthCell[]>> = {};
      SENSORS.forEach((s, i) => {
        next[s] = results[i].data;
      });
      setCalendars(next);
    });
    return () => {
      alive = false;
    };
  }, [ring]);

  /* ---------------------------------------------------------- ambiente --- */
  const center = useMemo<LatLon>(() => (ring ? ringCentroid(ring) : PERU_CENTER), [ring]);

  useEffect(() => {
    let alive = true;
    fetchEnvConditions(center, year, month).then((r) => {
      if (!alive) return;
      setEnv(r.data);
      setEnvApplied(false);
    });
    return () => {
      alive = false;
    };
  }, [center, year, month]);

  /* --------------------------------------------------------- derivados --- */
  const calendar = calendars[calendarSensor] ?? [];

  const cell = useMemo(
    () => calendar.find((c) => c.year === year && c.month === month),
    [calendar, year, month]
  );

  const comparison = useMemo(() => {
    const per: Partial<Record<Sensor, MonthCell | undefined>> = {};
    for (const s of SENSORS) {
      per[s] = (calendars[s] ?? []).find((c) => c.year === year && c.month === month);
    }
    return deriveComparison(per, `${year}-${String(month).padStart(2, "0")}`);
  }, [calendars, year, month]);

  const thermalElevated = useMemo(
    () => Object.values(comparison.sensors).some((d) => d?.signal_status === "elevated"),
    [comparison]
  );

  const susceptibility = useMemo(
    () => deriveSusceptibility(env, thermalElevated),
    [env, thermalElevated]
  );

  const daily = useMemo(() => {
    const forSensor = hotspots.filter((h) => h.sensor === calendarSensor);
    return fetchDailySeries(forSensor, year, month, cell?.observation_coverage ?? 0.7);
  }, [hotspots, calendarSensor, year, month, cell]);

  const countsBySensor = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of hotspots) out[h.sensor] = (out[h.sensor] ?? 0) + 1;
    return out;
  }, [hotspots]);

  const areaLabel = ring ? "Área dibujada" : "Perú";
  const periodLabel = `${MONTHS_ES[month - 1]} ${year}`;

  /* -------------------------------------------------------- simulacion --- */
  const runSpread = useCallback(() => {
    if (!ring || !ignition) return;
    setSpreadRunning(true);
    setPlaying(false);
    requestAnimationFrame(() => {
      try {
        const r = simulateSpread({ ring, ignition, ...spreadParams });
        setSpread(r);
        setSpreadTime(spreadParams.horizonHours);
        setPlaying(true);
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

  const applyEnvToSpread = useCallback(() => {
    if (!env) return;
    setSpreadParams((p) => ({
      ...p,
      windSpeedMs: env.wind_speed_10m_ms,
      windDirDeg: env.wind_direction_deg,
      vegetationPct: env.vegetation_area_pct,
      slopeMeanDeg: env.slope_mean_deg,
      fuelMoisturePct: Math.max(3, Math.min(28, Math.round(env.relative_humidity_2m_pct * 0.28))),
    }));
    setEnvApplied(true);
  }, [env]);

  const visibleSpread = tab === "simulacion" ? spread : null;

  return (
    <>
      <div className={`tool${focusMap ? " tool--focus" : ""}`}>
        <ControlRail
          year={year}
          month={month}
          onPeriod={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
          sensors={sensors}
          onSensors={setSensors}
          calendarSensor={calendarSensor}
          onCalendarSensor={setCalendarSensor}
          includeLow={includeLow}
          onIncludeLow={setIncludeLow}
          showHotspots={showHotspots}
          onShowHotspots={setShowHotspots}
          baseLayer={baseLayer}
          onBaseLayer={setBaseLayer}
          ring={ring}
          onRing={setRing}
          hotspots={hotspots}
          calendar={calendar}
          origin={origin}
          countsBySensor={countsBySensor}
        />

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
            spread={visibleSpread}
            spreadTime={spreadTime}
            spreadHorizon={spreadParams.horizonHours}
            baseLayer={baseLayer}
            focusMap={focusMap}
            onToggleFocus={() => setFocusMap((v) => !v)}
          />

          <CalendarStrip
            calendar={calendar}
            sensor={calendarSensor}
            onSensor={setCalendarSensor}
            year={year}
            month={month}
            onPick={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
            daily={daily}
            areaLabel={areaLabel}
          />
        </main>

        {tab === "calendario" ? (
          <AnalysisRail
            cell={cell}
            comparison={comparison}
            susceptibility={susceptibility}
            env={env}
            areaLabel={areaLabel}
            periodLabel={periodLabel}
          />
        ) : (
          <SpreadRail
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
          />
        )}
      </div>

      <footer className="status">
        <span className="status__prompt">root@mchanaq ~ %</span>
        <span>
          <b>período</b> {periodLabel}
        </span>
        <span>
          <b>área</b> {areaLabel}
        </span>
        <span>
          <b>focos</b> {hotspots.length.toLocaleString("es-PE")}
        </span>
        <span>
          <b>sensores</b> {sensors.length}/3
        </span>
        <span className="status__spacer" />
        {origin === "fixture" && (
          <span className="chip chip--warn">Datos de muestra · no son observaciones reales</span>
        )}
        <span className="status__src">MODIS MOD14A1 · MYD14A1 · VIIRS VNP14A1</span>
      </footer>
    </>
  );
}
