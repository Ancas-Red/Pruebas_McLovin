import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRow, Metadata, Sensor } from "../api/types";
import { NO_OBSERVATION, SENSORS, SENSOR_META, isUnobserved } from "../api/types";
import { isUsefulDailyRow } from "../api/client";
import type { MonthCell } from "../lib/calendar";
import { cividisCss } from "../lib/palette";
import { CalendarTerrain3D } from "./CalendarTerrain3D";

const M_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const M_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  calendar: MonthCell[];
  sensor: Sensor;
  onSensor: (s: Sensor) => void;
  year: number;
  month: number;
  onPick: (y: number, m: number) => void;
  daily: DailyRow[];
  metadata?: Metadata | null;
  areaLabel: string;
  onHide: () => void;
  selectedDate: string;
  onPickDay: (day: number) => void;
  /** Sin territorio elegido: se muestra una indicación en vez de la grilla. */
  noTerritory?: boolean;
}

const MIN_PANEL_H = 175;

function defaultPanelHeight(): number {
  if (typeof window === "undefined") return 310;
  return Math.round(Math.max(245, Math.min(365, window.innerHeight * 0.42)));
}

function clampPanelHeight(h: number): number {
  if (typeof window === "undefined") return Math.max(MIN_PANEL_H, Math.min(420, h));
  const maxH = Math.max(230, window.innerHeight - 280);
  return Math.round(Math.max(MIN_PANEL_H, Math.min(maxH, h)));
}

export function CalendarStrip(p: Props) {
  const { calendar, year, month } = p;
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [panelHeight, setPanelHeight] = useState<number>(() => defaultPanelHeight());
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ active: boolean; startY: number; startH: number }>({
    active: false,
    startY: 0,
    startH: 310,
  });

  useEffect(() => {
    const onResize = () => setPanelHeight((h) => clampPanelHeight(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dy = dragRef.current.startY - e.clientY;
      setPanelHeight(clampPanelHeight(dragRef.current.startH + dy));
    };
    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const { byKey, years, max } = useMemo(() => {
    const byKey = new Map<string, MonthCell>();
    let max = 0;
    const yearSet = new Set<number>();
    for (const c of calendar) {
      byKey.set(`${c.year}-${c.month}`, c);
      yearSet.add(c.year);
      if (c.detections > max) max = c.detections;
    }
    return {
      byKey,
      // Años en columnas, de izquierda a derecha: el eje horizontal es el tiempo
      // y cada fila es un mes del año, que es como se lee la estacionalidad.
      years: [...yearSet].sort((a, b) => a - b),
      max: Math.max(1, max),
    };
  }, [calendar]);

  const selected = byKey.get(`${year}-${month}`);

  const usefulDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of p.daily) {
      if (isUsefulDailyRow(r, p.sensor, p.metadata)) set.add(r.date);
    }
    return set;
  }, [p.daily, p.sensor, p.metadata]);

  // Escala con raiz cuadrada: evita que un unico mes extremo aplane el resto.
  const tone = useCallback((v: number) => Math.sqrt(v / max), [max]);

  return (
    <section
      className={`calstrip${resizing ? " calstrip--resizing" : ""}`}
      style={{ height: panelHeight }}
      data-tour="calendar-strip"
    >
      <div
        className="calstrip__resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to adjust the calendar height"
        title="Hold click and drag up or down to adjust the height (double-click to restore)"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { active: true, startY: e.clientY, startH: panelHeight };
          setResizing(true);
        }}
        onDoubleClick={() => setPanelHeight(defaultPanelHeight())}
      >
        <span className="calstrip__grip" aria-hidden="true" />
      </div>
      <header className="panel__head">
        <span className="panel__idx">06</span>
        <h2 className="panel__title">Thermal activity calendar</h2>
        <div className="calstrip__controls">
          <div className="calstrip__mode" role="group" aria-label="Calendar display mode">
            <button
              type="button"
              className="tab"
              aria-selected={viewMode === "2d"}
              onClick={() => setViewMode("2d")}
              title="Flat heat map by month and year"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              2D Heat
            </button>
            <button
              type="button"
              className="tab"
              aria-selected={viewMode === "3d"}
              onClick={() => setViewMode("3d")}
              title="Interactive 3D surface of valleys and ridges"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              3D Relief
            </button>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {SENSORS.map((s) => (
              <button
                key={s}
                className="tab"
                aria-selected={p.sensor === s}
                onClick={() => p.onSensor(s)}
                title={`${SENSOR_META[s].product} · since ${SENSOR_META[s].since}`}
                style={{ padding: "4px 9px", fontSize: 10 }}
              >
                {SENSOR_META[s].short}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="calstrip__hide"
          onClick={p.onHide}
          aria-label="Minimize the calendar"
          title="Minimize the calendar (you can reopen it from the bottom bar)"
        >
          ▼ Minimize
        </button>
      </header>

      {p.noTerritory ? (
        <div
          className="calstrip__body"
          style={{ display: "grid", placeItems: "center", minHeight: 160 }}
        >
          <p className="mono-sm" style={{ textAlign: "center", maxWidth: 520, lineHeight: 1.6 }}>
            Select a province or basin on the map (or from the “Territory”
            panel on the left) to see its thermal activity
            calendar.
          </p>
        </div>
      ) : (
      <div className="calstrip__body">
        {viewMode === "3d" ? (
          <CalendarTerrain3D
            years={years}
            byKey={byKey}
            tone={tone}
            selectedYear={year}
            selectedMonth={month}
            onPick={p.onPick}
          />
        ) : (
          <div className="cal">
            <div
              className="cal__grid"
              style={{ gridTemplateColumns: `34px repeat(${years.length}, minmax(13px, 1fr))` }}
            >
              <div className="cal__corner" />
              {years.map((y) => (
                <div className="cal__colhead" key={y} title={String(y)}>
                  {String(y).slice(2)}
                </div>
              ))}

              {M_SHORT.map((label, i) => (
                <MonthRow
                  key={label}
                  monthIndex={i}
                  label={label}
                  years={years}
                  byKey={byKey}
                  tone={tone}
                  selectedYear={year}
                  selectedMonth={month}
                  onPick={p.onPick}
                />
              ))}
            </div>
          </div>
        )}

        <div className="calstrip__side">
          <div className="calstrip__legend">
            <div className="legend__title">Detections (classes 8–9)</div>
            <div className="legend__ramp">
              {Array.from({ length: 24 }, (_, i) => (
                <i key={i} style={{ background: cividisCss(i / 23) }} />
              ))}
            </div>
            <div className="legend__scale">
              <span>0</span>
              <span>{Math.round(max / 4).toLocaleString("es-PE")}</span>
              <span>{max.toLocaleString("es-PE")}</span>
            </div>
            <div
              className="calstrip__flag-legend"
              title="Upper-right triangle in a cell: month with a robust historical anomaly z ≥ 2 relative to its baseline"
            >
              <span className="calstrip__flag-sample" aria-hidden="true" />
              <span>Corner: strong anomaly (z ≥ 2)</span>
            </div>
          </div>

          <div className="calstrip__chart">
            <div className="legend__title">
              Daily series · {M_FULL[month - 1]} {year} · {p.areaLabel}
              <span style={{ color: "var(--acid)", marginLeft: 8 }}>
                day {p.selectedDate.slice(8)}
              </span>
            </div>
            {p.daily.length === 0 ? (
              <div className="calstrip__chart-empty">
                The daily data is not valid at this time or is not available for this period.
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={68}>
                  <BarChart data={p.daily} margin={{ top: 6, right: 4, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke="#1b1b1b" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => String(Number(d.slice(8)))}
                      interval={4}
                      tickLine={false}
                      axisLine={{ stroke: "#232323" }}
                    />
                    <YAxis tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      cursor={{ fill: "rgba(216,255,51,0.08)" }}
                      labelFormatter={(d: string) => {
                        const row = p.daily.find((r) => r.date === d);
                        if (!row) return `Day ${d}`;
                        if (isUnobserved(row) || row.fire_pixels_nominal_high == null) {
                          return `Day ${d} · ${NO_OBSERVATION}`;
                        }
                        if (row.data_origin === "firms_live_historical") {
                          return `Día ${d} · consulta en vivo a NASA FIRMS (sin cobertura/tasa validada)`;
                        }
                        if (!usefulDates.has(d)) {
                          const pct =
                            row.observation_coverage != null
                              ? `${Math.round(row.observation_coverage * 100)}%`
                              : "—";
                          return `Day ${d} · Coverage ${pct} (< 70 %, not usable)`;
                        }
                        return `Day ${d}`;
                      }}
                      formatter={(v) => [
                        typeof v === "number" && Number.isFinite(v)
                          ? v.toLocaleString("es-PE")
                          : NO_OBSERVATION,
                        "Detections",
                      ]}
                      labelStyle={{ color: "var(--fg-dim)" }}
                    />
                    <Bar
                      dataKey="fire_pixels_nominal_high"
                      isAnimationActive={false}
                      cursor="pointer"
                      onClick={(d: { date?: string }) =>
                        d?.date && usefulDates.has(d.date) && p.onPickDay(Number(d.date.slice(8)))
                      }
                    >
                      {p.daily.map((d) => (
                        <Cell
                          key={d.date}
                          fill={
                            d.date === p.selectedDate ? "var(--acid)" : SENSOR_META[p.sensor].color
                          }
                          fillOpacity={usefulDates.has(d.date) ? 1 : 0.25}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {usefulDates.size === 0 && (
                  <p className="mono-sm" style={{ color: "#ffd480", marginTop: 4 }}>
                    No valid days (coverage ≥ 70 %) for {SENSOR_META[p.sensor].label} this month.
                  </p>
                )}
              </>
            )}
          </div>

          {!selected && (
            <p className="mono-sm" style={{ color: "#ffd480", margin: "0 0 2px" }}>
              Monthly summary not valid or not available for this period.
            </p>
          )}
          <dl className="kv calstrip__kv">
            <dt>Detections of the month</dt>
            <dd>{selected ? selected.detections.toLocaleString("es-PE") : "—"}</dd>
            <dt>Active days</dt>
            <dd>{selected ? selected.active_days : "—"}</dd>
            <dt>Longest streak</dt>
            <dd>{selected ? `${selected.max_consecutive_active_days} d` : "—"}</dd>
            <dt>Observed coverage</dt>
            <dd data-null={selected?.observation_coverage == null}>
              {selected?.observation_coverage != null
                ? `${Math.round(selected.observation_coverage * 100)} %`
                : "No data"}
            </dd>
            <dt>Robust anomaly</dt>
            <dd data-null={selected?.historical_anomaly == null}>
              {selected?.historical_anomaly != null
                ? `z = ${selected.historical_anomaly.toFixed(2)}`
                : "Not estimable"}
            </dd>
            <dt>Baseline years</dt>
            <dd data-null={!selected?.baseline_years}>
              {selected?.baseline_years ? selected.baseline_years : "Insufficient history"}
            </dd>
          </dl>
        </div>
      </div>
      )}
    </section>
  );
}

function MonthRow({
  monthIndex,
  label,
  years,
  byKey,
  tone,
  selectedYear,
  selectedMonth,
  onPick,
}: {
  monthIndex: number;
  label: string;
  years: number[];
  byKey: Map<string, MonthCell>;
  tone: (v: number) => number;
  selectedYear: number;
  selectedMonth: number;
  onPick: (y: number, m: number) => void;
}) {
  const m = monthIndex + 1;
  return (
    <>
      <div className="cal__rowhead">{label}</div>
      {years.map((year) => {
        const cell = byKey.get(`${year}-${m}`);
        const isSel = year === selectedYear && m === selectedMonth;
        if (!cell) {
          return <div key={year} className="cal__cell" data-empty="true" aria-hidden="true" />;
        }
        const anomaly = cell.historical_anomaly;
        return (
          <button
            key={year}
            className="cal__cell"
            data-selected={isSel}
            style={{ background: cividisCss(tone(cell.detections)) }}
            onClick={() => onPick(year, m)}
            title={
              `${M_FULL[monthIndex]} ${year}\n` +
              `${cell.detections.toLocaleString("es-PE")} detections\n` +
              (cell.observation_coverage != null
                ? `coverage ${Math.round(cell.observation_coverage * 100)}%\n`
                : "coverage: no data\n") +
              (anomaly != null ? `anomaly z = ${anomaly.toFixed(2)}` : "anomaly not estimable")
            }
            aria-label={`${M_FULL[monthIndex]} ${year}, ${cell.detections} detections`}
          >
            {anomaly != null && anomaly >= 2 && <i className="cal__flag" aria-hidden="true" />}
          </button>
        );
      })}
    </>
  );
}
