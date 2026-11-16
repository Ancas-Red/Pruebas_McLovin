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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const LEFT_ITEMS: DockItem[] = [
  { id: "periodo", label: "Period", icon: "calendar" },
  { id: "sensores", label: "Sensor", icon: "satellite" },
  { id: "area", label: "Territory", icon: "polygon" },
  { id: "capas", label: "Map layers", icon: "layers" },
  { id: "descargas", label: "Downloads", icon: "download" },
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
  showHighMarkers: boolean;
  onShowHighMarkers: (v: boolean) => void;
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

  const daysWithFiresCount = useMemo(() => {
    let count = 0;
    for (const d of usefulDays) {
      const row = dailyByDate.get(isoDate(p.year, p.month, d));
      if ((row?.fire_pixels_nominal_high ?? 0) > 0 || (row?.fire_pixels_low ?? 0) > 0) {
        count += 1;
      }
    }
    return count;
  }, [usefulDays, dailyByDate, p.year, p.month]);

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
      setCoordError("Check the values: they must be numbers and the radius must be greater than zero.");
      return;
    }
    if (la < -90 || la > 90 || lo < -180 || lo > 180) {
      setCoordError("Coordinates outside the global range (latitude -90 to 90, longitude -180 to 180).");
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
        <Drawer title="Period" note={`${MONTHS[p.month - 1]} ${p.year}`} onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sel-year">Year</label>
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
                <option value="" disabled>No years available</option>
              ) : (
                years.map((y) => <option key={y} value={y}>{y}</option>)
              )}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sel-month">Month</label>
            <select
              id="sel-month"
              value={validMonths.includes(p.month) ? p.month : (validMonths[validMonths.length - 1] ?? "")}
              disabled={!p.metadata || validMonths.length === 0}
              onChange={(e) => p.onPeriod(p.year, Number(e.target.value))}
            >
              {validMonths.length === 0 ? (
                <option value="" disabled>No months available</option>
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
              Day <span className="field__value">{p.dateIso}</span>
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
                  ? "Loading…"
                  : `${usefulDays.length} ${usefulDays.length === 1 ? "usable day" : "usable days"}${
                      daysWithFiresCount > 0 ? ` · ${daysWithFiresCount} with hotspots` : ""
                    }`}
              </span>
              <span>{pad2(usefulDays[usefulDays.length - 1] ?? maxDay)}</span>
            </div>

            {monthDaysSpan.length > 0 && (
              <>
                <div className="day-grid" role="group" aria-label="Days of the month with usable data">
                  {monthDaysSpan.map((d) => {
                    const iso = isoDate(p.year, p.month, d);
                    const row = dailyByDate.get(iso);
                    const isUseful = usefulSet.has(d);
                    const isSelected = isUseful && p.day === d;
                    const nomHigh = row?.fire_pixels_nominal_high ?? 0;
                    const lowOnly = row?.fire_pixels_low ?? 0;
                    const hasFires = nomHigh > 0 || lowOnly > 0;
                    const covPct =
                      row?.observation_coverage != null
                        ? `${Math.round(row.observation_coverage * 100)} %`
                        : null;
                    const fireLabel =
                      nomHigh > 0
                        ? `${nomHigh} hotspot(s) ${SENSOR_LABELS[p.sensor].short}`
                        : lowOnly > 0
                          ? `${lowOnly} hotspot(s) low conf.`
                          : "0 hotspots";
                    const isLive = row?.data_origin === "firms_live_historical";
                    const title = isLive
                      ? `Day ${iso} · ${fireLabel} · live NASA FIRMS query (coverage/rate not validated)`
                      : isUseful
                        ? `Day ${iso} · ${fireLabel}${covPct ? ` · coverage ${covPct}` : ""}`
                        : !isDateAvailable(iso, p.sensor, p.metadata)
                          ? `Day ${iso} · not published in metadata`
                          : row?.activity_rate == null
                            ? `Day ${iso} · no valid observation`
                            : `Day ${iso} · not usable (coverage ${covPct ?? "—"} < 70 %)`;
                    return (
                      <button
                        key={d}
                        type="button"
                        className="day-pill"
                        data-live={isUseful && isLive ? "true" : undefined}
                        data-fires={isUseful && hasFires ? "true" : undefined}
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
                <div className="day-grid__legend" aria-hidden="true">
                  <span><i className="day-dot day-dot--fire" /> With hotspots</span>
                  <span><i className="day-dot day-dot--clear" /> Usable, no hotspots</span>
                  <span><i className="day-dot day-dot--off" /> No coverage</span>
                  <span><i className="day-dot day-dot--live" /> Live (NASA FIRMS, not validated)</span>
                </div>
              </>
            )}

            {!p.dailyLoading && usefulDays.length === 0 && (
              <div className="note note--warn" style={{ marginTop: 8 }}>
                No usable days in {MONTHS[p.month - 1]} {p.year} for{" "}
                {SENSOR_LABELS[p.sensor].long} (coverage ≥ 70 % required).
              </div>
            )}
          </div>

          {p.metadata && !isDateAvailable(p.dateIso, p.sensor, p.metadata) && (
            <div className="note note--warn">
              {SENSOR_LABELS[p.sensor].long} does not publish data for {p.dateIso}. The API responds with
              <code> PERIOD_NOT_AVAILABLE</code> and it is not filled with zeros.
            </div>
          )}

          <div className="field">
            <span className="field__label">What the map paints</span>
            <div className="btn-row">
              <button
                className={`btn${p.granularity === "day" ? " btn--on" : ""}`}
                onClick={() => p.onGranularity("day")}
              >
                That day
              </button>
              <button
                className={`btn${p.granularity === "month" ? " btn--on" : ""}`}
                onClick={() => p.onGranularity("month")}
              >
                Full month
              </button>
            </div>
          </div>

          <button
            className="toggle"
            aria-pressed={p.showCalendar}
            onClick={() => p.onShowCalendar(!p.showCalendar)}
          >
            <i className="toggle__box" style={{ background: p.showCalendar ? "var(--acid)" : "transparent" }} />
            <span>Show the calendar</span>
          </button>

          <p className="mono-sm">
            The API serves daily resolution; the month only provides context and anomaly. The available
            dates are published by the backend in <code>metadata</code>
            {p.metadata?.parameters?.min_baseline_years
              ? ` (minimum baseline: ${p.metadata.parameters.min_baseline_years} years).`
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
                title={`${meta.product} · ${avail ? "publishes" : "no data"} on ${p.dateIso}`}
              >
                <i className="toggle__box" style={{ background: on ? "var(--acid)" : "transparent" }} />
                <span>{meta.long}</span>
                <span className="toggle__meta">{avail ? meta.product : "no data"}</span>
              </button>
            );
          })}
          <hr className="hr" />
          <p className="mono-sm">
            An activity query uses <strong>one</strong> sensor: counts are never added
            across MODIS Terra, MODIS Aqua and VIIRS, because the overpass time and the
            instrument change. The contrast between the three is seen in “Comparison”, which the
            backend resolves.
          </p>
          <p className="mono-sm">
            The main indicator uses classes 8–9 (nominal and high). Class 7 is reported
            separately, never added.
          </p>
        </Drawer>
      );

    case "area":
      return (
        <Drawer
          title="Territory"
          note={TERRITORY_LABELS[p.territoryType].one}
          onClose={p.onClose}
        >
          <div className="field">
            <span className="field__label">Type</span>
            <div className="btn-row">
              <button
                className={`btn${p.territoryType === "province" ? " btn--on" : ""}`}
                onClick={() => p.onTerritoryType("province")}
              >
                Provinces
              </button>
              <button
                className={`btn${p.territoryType === "hydro_unit" ? " btn--on" : ""}`}
                onClick={() => p.onTerritoryType("hydro_unit")}
              >
                Basins
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sel-terr">
              {TERRITORY_LABELS[p.territoryType].one}{" "}
              <span className="field__value">{features.length} available</span>
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
            Provinces and basins are not mixed in the same ranking: they are different cuts of the
            territory and comparing them with each other means nothing. You can also choose by
            clicking on the map.
          </p>

          <hr className="hr" />

          <p className="mono-sm" style={{ marginTop: 0 }}>
            <strong>Phase 2 (optional).</strong> The cut below only feeds the simulated
            spread; it does not change any Phase 1 query.
          </p>
          <div className="field">
            <label className="field__label">Latitude <span className="field__value">°S/N</span></label>
            <input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label">Longitude <span className="field__value">°E/W</span></label>
            <input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label">Radius <span className="field__value">{radius} km</span></label>
            <input type="text" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
          <div className="btn-row">
            <button className="btn btn--primary" onClick={applyCoords}>Apply</button>
            <button className="btn" disabled={!p.ring} onClick={() => p.onRing(null)}>Remove</button>
          </div>
          {coordError && <div className="note note--warn" style={{ marginTop: 10 }}>{coordError}</div>}
          {p.ring && (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Vertices</dt>
              <dd>{p.ring.length}</dd>
              <dt>Area</dt>
              <dd>{Math.round(ringAreaKm2(p.ring)).toLocaleString("es-PE")} km²</dd>
            </dl>
          )}
        </Drawer>
      );

    case "capas":
      return (
        <Drawer title="Map layers" onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sel-base">Base map</label>
            <select
              id="sel-base"
              value={p.baseLayer}
              onChange={(e) => p.onBaseLayer(e.target.value as Props["baseLayer"])}
            >
              <option value="dark">Dark</option>
              <option value="relief">Relief</option>
              <option value="satellite">Satellite</option>
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sel-metric">Choropleth metric</label>
            <select
              id="sel-metric"
              value={p.metric}
              onChange={(e) => p.onMetric(e.target.value as MetricId)}
            >
              <optgroup label="Activity (per sensor)">
                {ACTIVITY_METRICS.map((m) => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </optgroup>
              <optgroup label="Environmental (no sensor)">
                {ENV_METRICS.map((m) => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </optgroup>
              <optgroup label="Classification">
                <option value="conditions_classification">
                  {METRIC_LABELS.conditions_classification}
                </option>
              </optgroup>
            </select>
          </div>

          <button className="toggle" aria-pressed={p.showChoropleth} onClick={() => p.onShowChoropleth(!p.showChoropleth)}>
            <i className="toggle__box" style={{ background: p.showChoropleth ? "var(--acid)" : "transparent" }} />
            <span>Choropleth by territory</span>
          </button>
          <button className="toggle" aria-pressed={p.showHighMarkers} onClick={() => p.onShowHighMarkers(!p.showHighMarkers)}>
            <i className="toggle__box" style={{ background: p.showHighMarkers ? "var(--ember)" : "transparent" }} />
            <span>Alerts ▲! and high-susceptibility subzones</span>
          </button>
          <button className="toggle" aria-pressed={p.showHotspots} onClick={() => p.onShowHotspots(!p.showHotspots)}>
            <i className="toggle__box" style={{ background: p.showHotspots ? "var(--acid)" : "transparent" }} />
            <span>Thermal hotspots</span>
          </button>
          <button className="toggle" aria-pressed={p.liveFirms} onClick={() => p.onLiveFirms(!p.liveFirms)}>
            <i className="toggle__box" style={{ background: p.liveFirms ? "var(--acid)" : "transparent" }} />
            <span>Live NRT hotspots (NASA FIRMS)</span>
          </button>
          {p.liveFirms && p.firmsSummary && (
            <p className="mono-sm" style={{ marginTop: 4 }}>{p.firmsSummary}</p>
          )}
          <button className="toggle" aria-pressed={p.showCalendar} onClick={() => p.onShowCalendar(!p.showCalendar)}>
            <i className="toggle__box" style={{ background: p.showCalendar ? "var(--acid)" : "transparent" }} />
            <span>Calendar</span>
          </button>

          <p className="mono-sm">
            Base maps without an API key: OpenStreetMap with a dark filter, OpenTopoMap for relief
            and hydrography, and Esri World Imagery for satellite.
          </p>
        </Drawer>
      );

    case "descargas":
      return (
        <Drawer title="Downloads" onClose={p.onClose}>
          <div className="btn-row" style={{ flexDirection: "column" }}>
            {p.csvHref && getBackendState() === "online" && (
              <a
                className="btn btn--block btn--primary"
                style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                href={p.csvHref}
              >
                Backend daily series (CSV)
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
              Daily series CSV ({p.daily.length} days)
            </button>
            <button
              className="btn btn--block"
              disabled={p.hotspots.length === 0}
              onClick={() => download(`mchanaq_focos_${stamp}.csv`, hotspotsCsv(p.hotspots, p.origin))}
            >
              Hotspots CSV ({p.hotspots.length.toLocaleString("es-PE")})
            </button>
            <button
              className="btn btn--block"
              disabled={p.calendar.length === 0}
              onClick={() =>
                download(`mchanaq_calendario_${p.sensor}.csv`, calendarCsv(p.calendar, p.sensor, p.origin))
              }
            >
              Calendar CSV
            </button>
            <button
              className="btn btn--block"
              disabled={!p.ring}
              onClick={() =>
                p.ring &&
                download(`mchanaq_area_${stamp}.geojson`, ringGeoJson(p.ring, ringAreaKm2(p.ring)), "application/geo+json")
              }
            >
              Area GeoJSON (Phase 2)
            </button>
          </div>
          <p className="mono-sm" style={{ marginTop: 12 }}>
            The backend CSV is the source to cite: it carries <code>source_product</code> and{" "}
            <code>processing_version</code>. Unknown values go as an empty cell, never
            as <code>0</code>. Every file generated here includes <code>data_origin</code>, which
            says whether the row comes from the API or from the sample dataset.
          </p>
        </Drawer>
      );

    default:
      return null;
  }
}
