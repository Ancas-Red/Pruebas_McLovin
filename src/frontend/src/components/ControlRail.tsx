import { useEffect, useMemo, useState } from "react";
import { Drawer } from "./Drawer";
import type { DockItem } from "./DockBar";
import type {
  DailyRow,
  HotspotFeature,
  Metadata,
  MetricId,
  Sensor,
  TerritoryCollection,
  TerritoryType,
} from "../api/types";
import {
  ACTIVITY_METRICS,
  ENV_METRICS,
  METRIC_LABELS,
  SENSORS,
  SENSOR_LABELS,
  TERRITORY_LABELS,
} from "../api/types";
import type { MonthCell } from "../lib/calendar";
import { calendarCsv, dailyCsv, download, hotspotsCsv, ringGeoJson } from "../lib/csv";
import {
  availablePeriodsForSensor,
  getBackendState,
  isDateAvailable,
  isoDate,
  monthRange,
  pad2,
  publishedDaysInMonth,
  usefulDaysFromRows,
} from "../api/client";
import { ringAreaKm2, type LatLon } from "../lib/geo";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export const LEFT_ITEMS: DockItem[] = [
  { id: "periodo", label: "Período", icon: "calendar" },
  { id: "sensores", label: "Sensor", icon: "satellite" },
  { id: "area", label: "Territorio", icon: "polygon" },
  { id: "capas", label: "Capas del mapa", icon: "layers" },
  { id: "descargas", label: "Descargas", icon: "download" },
];

interface Props {
  section: string;
  onClose: () => void;
  year: number;
  month: number;
  onPeriod: (y: number, m: number) => void;
  day: number;
  onDay: (d: number) => void;
  dateIso: string;
  granularity: "day" | "month";
  onGranularity: (g: "day" | "month") => void;
  metadata: Metadata | null;
  daily: DailyRow[];
  usefulDays?: number[];
  dailyLoading?: boolean;

  /** Territorio: la clave de toda consulta del contrato. */
  territoryType: TerritoryType;
  onTerritoryType: (t: TerritoryType) => void;
  territoryId: string;
  onTerritoryId: (id: string) => void;
  territories: TerritoryCollection | null;

  /** Un sensor por consulta: los conteos no se suman entre sensores. */
  sensor: Sensor;
  onSensor: (s: Sensor) => void;

  /** Qué métrica pinta la coropleta. */
  metric: MetricId;
  onMetric: (m: MetricId) => void;

  showHotspots: boolean;
  onShowHotspots: (v: boolean) => void;
  liveFirms: boolean;
  onLiveFirms: (v: boolean) => void;
  firmsSummary?: string | null;
  showChoropleth: boolean;
  onShowChoropleth: (v: boolean) => void;
  showCalendar: boolean;
  onShowCalendar: (v: boolean) => void;
  baseLayer: "dark" | "relief" | "satellite";
  onBaseLayer: (v: "dark" | "relief" | "satellite") => void;

  /** Fase 2: recorte opcional para la simulación. */
  ring: LatLon[] | null;
  onRing: (r: LatLon[] | null) => void;

  hotspots: HotspotFeature[];
  calendar: MonthCell[];
  origin: string;
  csvHref: string | null;
  monthSpan: { from: string; to: string };
}

export function ControlRail(p: Props) {
  const [lat, setLat] = useState("-8.90");
  const [lon, setLon] = useState("-73.92");
  const [radius, setRadius] = useState("60");
  const [coordError, setCoordError] = useState<string | null>(null);

  const lastDay = Number(monthRange(p.year, p.month).to.slice(8));

  const availablePeriods = useMemo(
    () => availablePeriodsForSensor(p.sensor, p.metadata),
    [p.metadata, p.sensor]
  );

  const years = useMemo(() => {
    if (!p.metadata) return [p.year];
    const yearSet = new Set<number>();
    for (const pr of availablePeriods) {
      const y = Number(pr.slice(0, 4));
      if (Number.isFinite(y)) yearSet.add(y);
    }
    return [...yearSet].sort((a, b) => b - a);
  }, [p.metadata, availablePeriods, p.year]);

  const validMonths = useMemo(() => {
    if (!p.metadata) return [p.month];
    return Array.from({ length: 12 }, (_, i) => i + 1).filter((m) =>
      availablePeriods.has(`${p.year}-${pad2(m)}`)
    );
  }, [p.metadata, availablePeriods, p.year, p.month]);

  const publishedDays = useMemo(
    () => publishedDaysInMonth(p.year, p.month, p.sensor, p.metadata),
    [p.year, p.month, p.sensor, p.metadata]
  );
  const minDay = publishedDays[0] ?? 1;
  const maxDay = publishedDays[publishedDays.length - 1] ?? lastDay;
  const monthDaysSpan = useMemo(
    () => Array.from({ length: Math.max(0, maxDay - minDay + 1) }, (_, i) => minDay + i),
    [minDay, maxDay]
  );

  const usefulDays = useMemo(
    () =>
      p.usefulDays ??
      usefulDaysFromRows(p.daily, p.year, p.month, p.sensor, p.metadata),
    [p.usefulDays, p.daily, p.year, p.month, p.sensor, p.metadata]
  );
  const usefulSet = useMemo(() => new Set(usefulDays), [usefulDays]);
  const activeUsefulIdx = useMemo(() => {
    const idx = usefulDays.indexOf(p.day);
    return idx >= 0 ? idx : Math.max(0, usefulDays.length - 1);
  }, [usefulDays, p.day]);

  const dailyByDate = useMemo(() => {
    const map = new Map<string, DailyRow>();
    for (const r of p.daily) {
      if (!r.sensor || r.sensor === p.sensor) map.set(r.date, r);
    }
    return map;
  }, [p.daily, p.sensor]);

  const features = p.territories?.features ?? [];

  useEffect(() => {
    const feat = features.find((f) => f.properties.territory_id === p.territoryId);
    if (!feat?.geometry) return;
    const rings: number[][][] =
      feat.geometry.type === "Polygon"
        ? (feat.geometry.coordinates as number[][][])
        : (feat.geometry.coordinates as number[][][][]).flat(1);
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const r of rings) {
      for (const [lo, la] of r) {
        if (la < minLat) minLat = la;
        if (la > maxLat) maxLat = la;
        if (lo < minLon) minLon = lo;
        if (lo > maxLon) maxLon = lo;
      }
    }
    if (isFinite(minLat) && isFinite(minLon)) {
      setLat(((minLat + maxLat) / 2).toFixed(2));
      setLon(((minLon + maxLon) / 2).toFixed(2));
    }
  }, [p.territoryId, features]);
  const stamp = `${p.year}${String(p.month).padStart(2, "0")}`;

  function applyCoords() {
    const la = Number(lat);
    const lo = Number(lon);
    const r = Number(radius);
    if (!isFinite(la) || !isFinite(lo) || !isFinite(r) || r <= 0) {
      setCoordError("Revisa los valores: deben ser números y el radio mayor que cero.");
      return;
    }
    if (la < -90 || la > 90 || lo < -180 || lo > 180) {
      setCoordError("Coordenadas fuera de rango global (latitud -90 a 90, longitud -180 a 180).");
      return;
    }
    setCoordError(null);
    const dLat = r / 110.574;
    const dLon = r / (111.32 * Math.cos((la * Math.PI) / 180));
    p.onRing([
      [la + dLat, lo - dLon],
      [la + dLat, lo + dLon],
      [la - dLat, lo + dLon],
      [la - dLat, lo - dLon],
    ]);
  }

  switch (p.section) {
    case "periodo":
      return (
        <Drawer title="Período" note={`${MONTHS[p.month - 1]} ${p.year}`} onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sel-year">Año</label>
            <select
              id="sel-year"
              value={years.includes(p.year) ? p.year : (years[0] ?? "")}
              disabled={!p.metadata || years.length === 0}
              onChange={(e) => {
                const y = Number(e.target.value);
                const monthsInYear = Array.from({ length: 12 }, (_, i) => i + 1).filter((mm) =>
                  availablePeriods.has(`${y}-${pad2(mm)}`)
                );
                const m = monthsInYear.includes(p.month)
                  ? p.month
                  : (monthsInYear[monthsInYear.length - 1] ?? p.month);
                p.onPeriod(y, m);
              }}
            >
              {years.length === 0 ? (
                <option value="" disabled>Sin años disponibles</option>
              ) : (
                years.map((y) => <option key={y} value={y}>{y}</option>)
              )}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sel-month">Mes</label>
            <select
              id="sel-month"
              value={validMonths.includes(p.month) ? p.month : (validMonths[validMonths.length - 1] ?? "")}
              disabled={!p.metadata || validMonths.length === 0}
              onChange={(e) => p.onPeriod(p.year, Number(e.target.value))}
            >
              {validMonths.length === 0 ? (
                <option value="" disabled>Sin meses disponibles</option>
              ) : (
                validMonths.map((m) => (
                  <option key={m} value={m}>
                    {MONTHS[m - 1]}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sel-day">
              Día <span className="field__value">{p.dateIso}</span>
            </label>
            <input
              id="sel-day"
              type="range"
              min={0}
              max={Math.max(0, usefulDays.length - 1)}
              step={1}
              disabled={Boolean(p.dailyLoading) || usefulDays.length <= 1}
              value={activeUsefulIdx}
              onChange={(e) => {
                const nextDay = usefulDays[Number(e.target.value)];
                if (nextDay !== undefined) {
                  p.onDay(nextDay);
                  p.onGranularity("day");
                }
              }}
            />
            <div className="legend__scale">
              <span>{pad2(usefulDays[0] ?? minDay)}</span>
              <span>
                {p.dailyLoading
                  ? "Cargando…"
                  : `${usefulDays.length} ${usefulDays.length === 1 ? "día útil" : "días útiles"}`}
              </span>
              <span>{pad2(usefulDays[usefulDays.length - 1] ?? maxDay)}</span>
            </div>

            {monthDaysSpan.length > 0 && (
              <div className="day-grid" role="group" aria-label="Días del mes con datos útiles">
                {monthDaysSpan.map((d) => {
                  const iso = isoDate(p.year, p.month, d);
                  const row = dailyByDate.get(iso);
                  const isUseful = usefulSet.has(d);
                  const isSelected = isUseful && p.day === d;
                  const covPct =
                    row?.observation_coverage != null
                      ? `${Math.round(row.observation_coverage * 100)} %`
                      : null;
                  const title = isUseful
                    ? `Día ${iso}${covPct ? ` · cobertura ${covPct}` : ""}`
                    : !isDateAvailable(iso, p.sensor, p.metadata)
                      ? `Día ${iso} · sin publicación en metadata`
                      : row?.activity_rate == null
                        ? `Día ${iso} · sin observación válida`
                        : `Día ${iso} · no útil (cobertura ${covPct ?? "—"} < 70 %)`;
                  return (
                    <button
                      key={d}
                      type="button"
                      className="day-pill"
                      disabled={Boolean(p.dailyLoading) || !isUseful}
                      aria-pressed={isSelected}
                      title={title}
                      onClick={() => {
                        p.onDay(d);
                        p.onGranularity("day");
                      }}
                    >
                      {pad2(d)}
                    </button>
                  );
                })}
              </div>
            )}

            {!p.dailyLoading && usefulDays.length === 0 && (
              <div className="note note--warn" style={{ marginTop: 8 }}>
                Sin días útiles en {MONTHS[p.month - 1]} {p.year} para{" "}
                {SENSOR_LABELS[p.sensor].long} (cobertura ≥ 70 % requerida).
              </div>
            )}
          </div>

          {p.metadata && !isDateAvailable(p.dateIso, p.sensor, p.metadata) && (
            <div className="note note--warn">
              {SENSOR_LABELS[p.sensor].long} no publica datos del {p.dateIso}. La API responde
              <code> PERIOD_NOT_AVAILABLE</code> y no se rellena con ceros.
            </div>
          )}

          <div className="field">
            <span className="field__label">Qué pinta el mapa</span>
            <div className="btn-row">
              <button
                className={`btn${p.granularity === "day" ? " btn--on" : ""}`}
                onClick={() => p.onGranularity("day")}
              >
                Ese día
              </button>
              <button
                className={`btn${p.granularity === "month" ? " btn--on" : ""}`}
                onClick={() => p.onGranularity("month")}
              >
                Mes completo
              </button>
            </div>
          </div>

          <button
            className="toggle"
            aria-pressed={p.showCalendar}
            onClick={() => p.onShowCalendar(!p.showCalendar)}
          >
            <i className="toggle__box" style={{ background: p.showCalendar ? "var(--acid)" : "transparent" }} />
            <span>Mostrar el calendario</span>
          </button>

          <p className="mono-sm">
            La API sirve en resolución diaria; el mes solo aporta contexto y anomalía. Las fechas
            disponibles las publica el backend en <code>metadata</code>
            {p.metadata?.parameters?.min_baseline_years
              ? ` (línea base mínima: ${p.metadata.parameters.min_baseline_years} años).`
              : "."}
          </p>
        </Drawer>
      );

    case "sensores":
      return (
        <Drawer title="Sensor" note={SENSOR_LABELS[p.sensor].short} onClose={p.onClose}>
          {SENSORS.map((s) => {
            const on = p.sensor === s;
            const meta = SENSOR_LABELS[s];
            const avail = p.metadata ? isDateAvailable(p.dateIso, s, p.metadata) : true;
            return (
              <button
                key={s}
                className="toggle"
                aria-pressed={on}
                onClick={() => p.onSensor(s)}
                title={`${meta.product} · ${avail ? "publica" : "sin datos"} el ${p.dateIso}`}
              >
                <i className="toggle__box" style={{ background: on ? "var(--acid)" : "transparent" }} />
                <span>{meta.long}</span>
                <span className="toggle__meta">{avail ? meta.product : "sin datos"}</span>
              </button>
            );
          })}
          <hr className="hr" />
          <p className="mono-sm">
            Una consulta de actividad es de <strong>un</strong> sensor: los conteos nunca se suman
            entre MODIS Terra, MODIS Aqua y VIIRS, porque cambian la hora de sobrevuelo y el
            instrumento. El contraste entre los tres se ve en «Comparación», que lo resuelve el
            backend.
          </p>
          <p className="mono-sm">
            El indicador principal usa las clases 8–9 (nominal y alta). La clase 7 se informa
            aparte, nunca sumada.
          </p>
        </Drawer>
      );

    case "area":
      return (
        <Drawer
          title="Territorio"
          note={TERRITORY_LABELS[p.territoryType].one}
          onClose={p.onClose}
        >
          <div className="field">
            <span className="field__label">Tipo</span>
            <div className="btn-row">
              <button
                className={`btn${p.territoryType === "province" ? " btn--on" : ""}`}
                onClick={() => p.onTerritoryType("province")}
              >
                Provincias
              </button>
              <button
                className={`btn${p.territoryType === "hydro_unit" ? " btn--on" : ""}`}
                onClick={() => p.onTerritoryType("hydro_unit")}
              >
                Cuencas
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sel-terr">
              {TERRITORY_LABELS[p.territoryType].one}{" "}
              <span className="field__value">{features.length} disponibles</span>
            </label>
            <select
              id="sel-terr"
              value={p.territoryId}
              onChange={(e) => p.onTerritoryId(e.target.value)}
            >
              {features.map((f) => (
                <option key={f.properties.territory_id} value={f.properties.territory_id}>
                  {f.properties.territory_name ?? f.properties.territory_id}
                </option>
              ))}
            </select>
          </div>

          <p className="mono-sm">
            Provincias y cuencas no se mezclan en un mismo ranking: son recortes distintos del
            territorio y compararlos entre sí no significa nada. También se puede elegir haciendo
            clic en el mapa.
          </p>

          <hr className="hr" />

          <p className="mono-sm" style={{ marginTop: 0 }}>
            <strong>Fase 2 (opcional).</strong> El recorte de abajo solo alimenta el recorrido
            simulado; no cambia ninguna consulta de la Fase 1.
          </p>
          <div className="field">
            <label className="field__label">Latitud <span className="field__value">°S/N</span></label>
            <input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label">Longitud <span className="field__value">°E/W</span></label>
            <input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label">Radio <span className="field__value">{radius} km</span></label>
            <input type="text" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
          <div className="btn-row">
            <button className="btn btn--primary" onClick={applyCoords}>Aplicar</button>
            <button className="btn" disabled={!p.ring} onClick={() => p.onRing(null)}>Quitar</button>
          </div>
          {coordError && <div className="note note--warn" style={{ marginTop: 10 }}>{coordError}</div>}
          {p.ring && (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Vértices</dt>
              <dd>{p.ring.length}</dd>
              <dt>Superficie</dt>
              <dd>{Math.round(ringAreaKm2(p.ring)).toLocaleString("es-PE")} km²</dd>
            </dl>
          )}
        </Drawer>
      );

    case "capas":
      return (
        <Drawer title="Capas del mapa" onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sel-base">Mapa base</label>
            <select
              id="sel-base"
              value={p.baseLayer}
              onChange={(e) => p.onBaseLayer(e.target.value as Props["baseLayer"])}
            >
              <option value="dark">Oscuro</option>
              <option value="relief">Relieve</option>
              <option value="satellite">Satelital</option>
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sel-metric">Métrica de la coropleta</label>
            <select
              id="sel-metric"
              value={p.metric}
              onChange={(e) => p.onMetric(e.target.value as MetricId)}
            >
              <optgroup label="Actividad (por sensor)">
                {ACTIVITY_METRICS.map((m) => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </optgroup>
              <optgroup label="Ambiental (sin sensor)">
                {ENV_METRICS.map((m) => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </optgroup>
              <optgroup label="Clasificación">
                <option value="conditions_classification">
                  {METRIC_LABELS.conditions_classification}
                </option>
              </optgroup>
            </select>
          </div>

          <button className="toggle" aria-pressed={p.showChoropleth} onClick={() => p.onShowChoropleth(!p.showChoropleth)}>
            <i className="toggle__box" style={{ background: p.showChoropleth ? "var(--acid)" : "transparent" }} />
            <span>Coropleta por territorio</span>
          </button>
          <button className="toggle" aria-pressed={p.showHotspots} onClick={() => p.onShowHotspots(!p.showHotspots)}>
            <i className="toggle__box" style={{ background: p.showHotspots ? "var(--acid)" : "transparent" }} />
            <span>Focos térmicos</span>
          </button>
          <button className="toggle" aria-pressed={p.liveFirms} onClick={() => p.onLiveFirms(!p.liveFirms)}>
            <i className="toggle__box" style={{ background: p.liveFirms ? "var(--acid)" : "transparent" }} />
            <span>Focos NRT en vivo (NASA FIRMS)</span>
          </button>
          {p.liveFirms && p.firmsSummary && (
            <p className="mono-sm" style={{ marginTop: 4 }}>{p.firmsSummary}</p>
          )}
          <button className="toggle" aria-pressed={p.showCalendar} onClick={() => p.onShowCalendar(!p.showCalendar)}>
            <i className="toggle__box" style={{ background: p.showCalendar ? "var(--acid)" : "transparent" }} />
            <span>Calendario</span>
          </button>

          <p className="mono-sm">
            Mapas base sin clave de API: OpenStreetMap con filtro oscuro, OpenTopoMap para relieve
            e hidrografía, y Esri World Imagery para satelital.
          </p>
        </Drawer>
      );

    case "descargas":
      return (
        <Drawer title="Descargas" onClose={p.onClose}>
          <div className="btn-row" style={{ flexDirection: "column" }}>
            {p.csvHref && getBackendState() === "online" && (
              <a
                className="btn btn--block btn--primary"
                style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                href={p.csvHref}
              >
                Serie diaria del backend (CSV)
              </a>
            )}
            <button
              className="btn btn--block"
              disabled={p.daily.length === 0}
              onClick={() =>
                download(
                  `mchanaq_diario_${p.dateIso.slice(0, 7)}_${p.sensor}.csv`,
                  dailyCsv(p.daily, p.sensor, p.territoryId, p.territoryType, p.origin)
                )
              }
            >
              Serie diaria CSV ({p.daily.length} días)
            </button>
            <button
              className="btn btn--block"
              disabled={p.hotspots.length === 0}
              onClick={() => download(`mchanaq_focos_${stamp}.csv`, hotspotsCsv(p.hotspots, p.origin))}
            >
              Focos CSV ({p.hotspots.length.toLocaleString("es-PE")})
            </button>
            <button
              className="btn btn--block"
              disabled={p.calendar.length === 0}
              onClick={() =>
                download(`mchanaq_calendario_${p.sensor}.csv`, calendarCsv(p.calendar, p.sensor, p.origin))
              }
            >
              Calendario CSV
            </button>
            <button
              className="btn btn--block"
              disabled={!p.ring}
              onClick={() =>
                p.ring &&
                download(`mchanaq_area_${stamp}.geojson`, ringGeoJson(p.ring, ringAreaKm2(p.ring)), "application/geo+json")
              }
            >
              Área GeoJSON (Fase 2)
            </button>
          </div>
          <p className="mono-sm" style={{ marginTop: 12 }}>
            El CSV del backend es la fuente a citar: trae <code>source_product</code> y{" "}
            <code>processing_version</code>. Los valores desconocidos van como celda vacía, nunca
            como <code>0</code>. Cada archivo generado aquí incluye <code>data_origin</code>, que
            dice si la fila viene de la API o del juego de muestra.
          </p>
        </Drawer>
      );

    default:
      return null;
  }
}
