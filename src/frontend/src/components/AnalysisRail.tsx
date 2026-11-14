import { Panel } from "./Panel";
import type {
  ComparisonStatus,
  EnvConditions,
  MonthCell,
  SensorComparison,
  SusceptibilityAssessment,
  SusceptibilityClass,
} from "../api/types";
import { SENSORS, SENSOR_META } from "../api/types";

const STATUS_LABEL: Record<ComparisonStatus, { text: string; chip: string }> = {
  concordant_elevated: { text: "Coincidente · elevada", chip: "chip chip--ember" },
  concordant_not_elevated: { text: "Coincidente · no elevada", chip: "chip chip--term" },
  discordant: { text: "Discrepante", chip: "chip chip--warn" },
  single_sensor: { text: "Fuente única", chip: "chip" },
  insufficient: { text: "Información insuficiente", chip: "chip" },
};

const SUSC_LABEL: Record<SusceptibilityClass, { text: string; chip: string }> = {
  high: { text: "Susceptibilidad alta", chip: "chip chip--ember" },
  moderate: { text: "Susceptibilidad moderada", chip: "chip chip--warn" },
  low: { text: "Susceptibilidad baja", chip: "chip chip--term" },
  partial: { text: "Evaluación parcial", chip: "chip" },
  not_evaluable: { text: "No evaluable", chip: "chip" },
};

const NODE_TEXT: Record<string, string> = {
  "N0:pass": "Compuerta de calidad superada",
  "N0:fail": "Sin datos suficientes para clasificar",
  "N1:yes": "Vegetación combustible sobre el umbral",
  "N1:no": "Poca vegetación combustible",
  "N2:yes": "Señal de sequedad presente",
  "N2:no": "Sin señal de sequedad",
  "N3a:yes": "Condición atmosférica propicia",
  "N3a:no": "Sin condición atmosférica propicia",
  "N3b:yes": "Viento alto con pendiente elevada",
  "N3b:no": "Ni viento alto ni pendiente elevada",
};

interface Props {
  cell: MonthCell | undefined;
  comparison: SensorComparison;
  susceptibility: SusceptibilityAssessment;
  env: EnvConditions | null;
  areaLabel: string;
  periodLabel: string;
}

export function AnalysisRail(p: Props) {
  const st = STATUS_LABEL[p.comparison.status];
  const su = SUSC_LABEL[p.susceptibility.classification];

  return (
    <aside className="rail rail--right" aria-label="Análisis del territorio">
      <Panel index="07" title="Indicadores del período" note={p.periodLabel}>
        <div className="metric-grid">
          <div className="metric">
            <div className="metric__label">Tasa de actividad</div>
            <div className="metric__value">
              {p.cell?.activity_rate != null ? (
                <>
                  {(p.cell.activity_rate * 1000).toFixed(2)}
                  <span className="metric__unit">‰ píxel-día</span>
                </>
              ) : (
                <span style={{ fontSize: 15, color: "var(--fg-faint)" }}>No estimable</span>
              )}
            </div>
          </div>
          <div className="metric">
            <div className="metric__label">Cobertura</div>
            <div className="metric__value">
              {p.cell ? (
                <>
                  {Math.round(p.cell.observation_coverage * 100)}
                  <span className="metric__unit">%</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="metric">
            <div className="metric__label">Días activos</div>
            <div className="metric__value">{p.cell?.active_days ?? "—"}</div>
          </div>
          <div className="metric">
            <div className="metric__label">Racha máxima</div>
            <div className="metric__value">
              {p.cell ? (
                <>
                  {p.cell.max_consecutive_active_days}
                  <span className="metric__unit">días</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
        <p className="mono-sm" style={{ marginTop: 10 }}>
          La tasa normaliza las detecciones por observación válida. No es probabilidad de incendio
          ni superficie quemada.
        </p>
      </Panel>

      <Panel index="08" title="Comparación multisensor">
        <span className={st.chip}>{st.text}</span>
        <table className="cmp" style={{ marginTop: 11 }}>
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Tasa ‰</th>
              <th>z</th>
              <th>Cob.</th>
            </tr>
          </thead>
          <tbody>
            {SENSORS.map((s) => {
              const d = p.comparison.sensors[s];
              const elevated = d?.signal_status === "elevated";
              return (
                <tr key={s}>
                  <td>
                    <i className="cmp__dot" style={{ background: SENSOR_META[s].color }} />
                    {SENSOR_META[s].short}
                  </td>
                  <td style={{ color: elevated ? "var(--ember)" : undefined }}>
                    {d?.activity_rate != null ? (d.activity_rate * 1000).toFixed(2) : "—"}
                  </td>
                  <td style={{ color: elevated ? "var(--ember)" : undefined }}>
                    {d?.historical_anomaly != null ? d.historical_anomaly.toFixed(1) : "—"}
                  </td>
                  <td>{d?.available ? `${Math.round(d.observation_coverage * 100)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 11 }}>
          {p.comparison.interpretation}
        </div>
        <p className="mono-sm" style={{ marginTop: 8 }}>
          Cada sensor se clasifica contra su propio umbral estacional antes de compararlos. Nunca se
          suman conteos entre sensores.
        </p>
      </Panel>

      <Panel index="09" title="Árbol de susceptibilidad" note={p.areaLabel}>
        <span className={su.chip}>{su.text}</span>

        <ol className="tree" style={{ marginTop: 12 }}>
          {p.susceptibility.decision_path.map((node) => (
            <li key={node} className="tree__node">
              <code>{node}</code>
              <span>{NODE_TEXT[node] ?? node}</span>
            </li>
          ))}
        </ol>

        {p.susceptibility.modifiers.length > 0 && (
          <>
            <div className="legend__title" style={{ marginTop: 12 }}>
              Modificadores informativos
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {p.susceptibility.modifiers.map((m) => (
                <span className="chip" key={m}>
                  {m}
                </span>
              ))}
            </div>
          </>
        )}

        {p.env && (
          <>
            <div className="legend__title" style={{ marginTop: 13 }}>
              Evidencia del período
            </div>
            <dl className="kv">
              <dt>Vegetación combustible</dt>
              <dd>{p.env.vegetation_area_pct} %</dd>
              <dt>Precipitación 30 d</dt>
              <dd>{p.env.precip_30d_mm} mm</dd>
              <dt>Humedad del suelo</dt>
              <dd>{p.env.soil_moisture_surface.toFixed(3)} m³/m³</dd>
              <dt>Viento a 10 m</dt>
              <dd>{p.env.wind_speed_10m_ms} m/s</dd>
              <dt>Temperatura</dt>
              <dd>{p.env.temperature_2m_c} °C</dd>
              <dt>Humedad relativa</dt>
              <dd>{p.env.relative_humidity_2m_pct} %</dd>
              <dt>Pendiente media</dt>
              <dd>{p.env.slope_mean_deg}°</dd>
              <dt>Agua y humedales</dt>
              <dd>{p.env.water_area_pct} %</dd>
            </dl>
          </>
        )}

        <div className="note note--warn" style={{ marginTop: 12 }}>
          <b>Índice cualitativo.</b> Describe qué tan favorables son las condiciones observadas a
          que un fuego se extienda. No estima probabilidad de ignición ni está validado contra
          incendios reales.
        </div>
      </Panel>
    </aside>
  );
}
