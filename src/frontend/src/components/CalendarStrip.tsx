import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPoint, MonthCell, Sensor } from "../api/types";
import { SENSORS, SENSOR_META } from "../api/types";
import { rampCss } from "../lib/spread";

const M_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const M_FULL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Props {
  calendar: MonthCell[];
  sensor: Sensor;
  onSensor: (s: Sensor) => void;
  year: number;
  month: number;
  onPick: (y: number, m: number) => void;
  daily: DayPoint[];
  areaLabel: string;
}

export function CalendarStrip(p: Props) {
  const { calendar, year, month } = p;

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

  // Escala con raiz cuadrada: evita que un unico mes extremo aplane el resto.
  const tone = (v: number) => Math.sqrt(v / max);

  return (
    <section className="calstrip">
      <header className="panel__head">
        <span className="panel__idx">06</span>
        <h2 className="panel__title">Calendario de actividad térmica</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {SENSORS.map((s) => (
            <button
              key={s}
              className="tab"
              aria-selected={p.sensor === s}
              onClick={() => p.onSensor(s)}
              title={`${SENSOR_META[s].product} · desde ${SENSOR_META[s].since}`}
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              {SENSOR_META[s].short}
            </button>
          ))}
        </div>
      </header>

      <div className="calstrip__body">
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

        <div className="calstrip__side">
          <div className="calstrip__legend">
            <div className="legend__title">Detecciones (clases 8–9)</div>
            <div className="legend__ramp">
              {Array.from({ length: 24 }, (_, i) => (
                <i key={i} style={{ background: rampCss(i / 23) }} />
              ))}
            </div>
            <div className="legend__scale">
              <span>0</span>
              <span>{Math.round(max / 4).toLocaleString("es-PE")}</span>
              <span>{max.toLocaleString("es-PE")}</span>
            </div>
          </div>

          <div className="calstrip__chart">
            <div className="legend__title">
              Serie diaria · {M_FULL[month - 1]} {year} · {p.areaLabel}
            </div>
            <ResponsiveContainer width="100%" height={92}>
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
                  labelFormatter={(d: string) => `Día ${d}`}
                  formatter={(v: number) => [v.toLocaleString("es-PE"), "Detecciones"]}
                />
                <Bar dataKey="detections" fill={SENSOR_META[p.sensor].color} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <dl className="kv calstrip__kv">
            <dt>Detecciones del mes</dt>
            <dd>{selected ? selected.detections.toLocaleString("es-PE") : "—"}</dd>
            <dt>Días activos</dt>
            <dd>{selected ? selected.active_days : "—"}</dd>
            <dt>Racha máxima</dt>
            <dd>{selected ? `${selected.max_consecutive_active_days} d` : "—"}</dd>
            <dt>Cobertura observada</dt>
            <dd>{selected ? `${Math.round(selected.observation_coverage * 100)} %` : "—"}</dd>
            <dt>Anomalía robusta</dt>
            <dd data-null={selected?.historical_anomaly == null}>
              {selected?.historical_anomaly != null
                ? `z = ${selected.historical_anomaly.toFixed(2)}`
                : "No estimable"}
            </dd>
            <dt>Años de línea base</dt>
            <dd data-null={!selected?.baseline_years}>
              {selected?.baseline_years ? selected.baseline_years : "Historial insuficiente"}
            </dd>
          </dl>
        </div>
      </div>
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
            style={{ background: rampCss(tone(cell.detections)) }}
            onClick={() => onPick(year, m)}
            title={
              `${M_FULL[monthIndex]} ${year}\n` +
              `${cell.detections.toLocaleString("es-PE")} detecciones\n` +
              `cobertura ${Math.round(cell.observation_coverage * 100)}%\n` +
              (anomaly != null ? `anomalía z = ${anomaly.toFixed(2)}` : "anomalía no estimable")
            }
            aria-label={`${M_FULL[monthIndex]} de ${year}, ${cell.detections} detecciones`}
          >
            {anomaly != null && anomaly >= 2 && <i className="cal__flag" aria-hidden="true" />}
          </button>
        );
      })}
    </>
  );
}
