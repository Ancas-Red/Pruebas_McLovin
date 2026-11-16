import { Drawer } from "./Drawer";
import type { DockItem } from "./DockBar";
import type {
  Classification,
  ComparisonStatus,
  DailyRow,
  Metadata,
  SensorComparison,
  TerritorySummary,
} from "../api/types";
import {
  ANOMALY_LABELS,
  CLASSIFICATION_LABELS,
  COMPARISON_LABELS,
  NO_DATA,
  NO_OBSERVATION,
  NOT_ESTIMABLE,
  QUALITY_LABELS,
  SENSORS,
  SENSOR_META,
  isUnobserved,
} from "../api/types";
import type { MonthCell } from "../lib/calendar";

export const ANALYSIS_ITEMS: DockItem[] = [
  { id: "indicadores", label: "Period indicators", icon: "gauge" },
  { id: "multisensor", label: "Multi-sensor comparison", icon: "compare" },
  { id: "arbol", label: "Susceptibility tree", icon: "tree" },
  { id: "convenciones", label: "Conventions and reading", icon: "book" },
];

const STATUS_CHIP: Record<ComparisonStatus, string> = {
  concordant_elevated: "chip chip--ember",
  concordant_not_elevated: "chip chip--term",
  discordant: "chip chip--warn",
  single_sensor: "chip",
  insufficient: "chip",
};

const SUSC_CHIP: Record<Classification, string> = {
  high: "chip chip--ember",
  moderate: "chip chip--warn",
  low: "chip chip--term",
  partial: "chip",
  not_evaluable: "chip",
};

/** Lectura en castellano de cada nodo del árbol de decisión. */
const NODE_TEXT: Record<string, string> = {
  "N0:pass": "Quality gate passed",
  "N0:fail": "Not enough data to classify",
  "N1:yes": "Combustible vegetation above the threshold",
  "N1:no": "Little combustible vegetation",
  "N2:yes": "Dryness signal present",
  "N2:no": "No dryness signal",
  "N3a:yes": "Wind above its seasonal percentile",
  "N3a:no": "Wind not seasonally elevated",
  "N3b:yes": "Slope above the threshold",
  "N3b:no": "Slope below the threshold",
  "buffer_150m:attenuate":
    "Surface-water buffer attenuation (150 m): reduces maximum susceptibility",
};

/** Nombre legible de cada variable del árbol. */
const VAR_TEXT: Record<string, string> = {
  vegetation_area_pct: "Combustible vegetation",
  effective_vegetation_area_pct: "Effective vegetation (outside 150 m buffer)",
  precip_30d_mm: "Precipitation 30 d",
  wind_speed_10m_ms: "Wind at 10 m",
  temperature_2m_c: "Air temp.",
  relative_humidity_2m_pct: "Relative humidity (2 m)",
  slope_class_area_pct: "Slope above threshold",
  slope_pct: "Slope",
  soil_moisture_surface: "Soil moisture",
  water_area_pct: "Water and wetlands",
  water_buffer_150m_pct: "Surface-water buffer (150 m)",
  ndvi_median: "Median NDVI",
};

interface Props {
  section: string;
  onClose: () => void;
  onOpenConventions?: () => void;
  cell: MonthCell | undefined;
  /** Ficha del territorio tal como la devuelve la API. */
  summary: TerritorySummary | null;
  /** Comparación resuelta por el backend; el frontend no la calcula. */
  comparison: SensorComparison | null;
  /** Fila del día seleccionado. La ficha es diaria (contrato §4). */
  dayRow: DailyRow | null;
  dateIso: string;
  areaLabel: string;
  periodLabel: string;
  metadata: Metadata | null;
}

export function AnalysisRail(p: Props) {
  const minBaseline = p.metadata?.parameters?.min_baseline_years ?? 5;

  switch (p.section) {
    case "indicadores": {
      // El resumen del período viene de la API; la celda del calendario es el
      // respaldo cuando la ficha todavía no llegó.
      const act = p.summary?.activity;
      const rate = act?.activity_rate ?? p.cell?.activity_rate ?? null;
      const cov = act?.observation_coverage ?? p.cell?.observation_coverage ?? null;
      const activeDays = act?.active_days ?? p.cell?.active_days ?? null;
      const streak = act?.max_consecutive_active_days ?? p.cell?.max_consecutive_active_days ?? null;
      const anom = act?.historical_anomaly ?? null;
      const quality = p.summary?.data_quality;
      const unobserved = p.dayRow ? isUnobserved(p.dayRow) : false;

      return (
        <Drawer title="Indicators" note={p.periodLabel} onClose={p.onClose}>
          {quality && (
            <span className={`chip${quality.status === "usable" ? " chip--term" : " chip--warn"}`}>
              Quality: {QUALITY_LABELS[quality.status]}
            </span>
          )}

          {!p.summary && !p.dayRow && (
            <div className="note note--warn" style={{ marginTop: quality ? 10 : 0 }}>
              <b>Data not available.</b> The data for this territory or date is not valid or is not
              available at this time.
            </div>
          )}

          {quality?.status === "insufficient" && (
            <div className="note note--warn" style={{ marginTop: 10 }}>
              <b>Insufficient quality.</b> The current data does not meet the minimum coverage or
              baseline requirements to validate these indicators.
            </div>
          )}

          <div className="metric-grid" style={{ marginTop: quality || (!p.summary && !p.dayRow) ? 11 : 0 }}>
            <div className="metric">
              <div className="metric__label">Activity rate</div>
              <div className="metric__value">
                {rate != null ? (
                  <>
                    {(rate * 1000).toFixed(2)}
                    <span className="metric__unit">‰ pixel-day</span>
                  </>
                ) : (
                  <span style={{ fontSize: 15, color: "var(--fg-faint)" }}>{NOT_ESTIMABLE}</span>
                )}
              </div>
            </div>
            <div className="metric">
              <div className="metric__label">Coverage</div>
              <div className="metric__value">
                {cov != null ? (
                  <>
                    {Math.round(cov * 100)}
                    <span className="metric__unit">%</span>
                  </>
                ) : (
                  <span style={{ fontSize: 15, color: "var(--fg-faint)" }}>{NO_DATA}</span>
                )}
              </div>
            </div>
            <div className="metric">
              <div className="metric__label">Active days</div>
              <div className="metric__value">{activeDays ?? "—"}</div>
            </div>
            <div className="metric">
              <div className="metric__label">Longest streak</div>
              <div className="metric__value">
                {streak != null ? (
                  <>
                    {streak}
                    <span className="metric__unit">days</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>

          <div className="legend__title" style={{ marginTop: 15 }}>
            Day context · {p.dateIso}
          </div>

          {unobserved && (
            <div className="note note--warn" style={{ marginBottom: 10 }}>
              <b>{NO_OBSERVATION}.</b> On that day there were no valid land pixels. It does not mean
              there was no fire: it means the satellite could not see.
            </div>
          )}

          <dl className="kv">
            <dt>Detections 8–9</dt>
            <dd data-null={p.dayRow?.fire_pixels_nominal_high == null}>
              {p.dayRow?.fire_pixels_nominal_high != null
                ? p.dayRow.fire_pixels_nominal_high.toLocaleString("es-PE")
                : NO_DATA}
            </dd>
            <dt>Low confidence (7)</dt>
            <dd data-null={p.dayRow?.fire_pixels_low == null}>
              {p.dayRow?.fire_pixels_low != null
                ? p.dayRow.fire_pixels_low.toLocaleString("es-PE")
                : NO_DATA}
            </dd>
            <dt>Air temp.</dt>
            <dd data-null={p.dayRow?.t_amb_c == null}>
              {p.dayRow?.t_amb_c != null ? `${p.dayRow.t_amb_c} °C` : NO_DATA}
            </dd>
            <dt>Surface temp.</dt>
            <dd data-null={p.dayRow?.t_suelo_c == null}>
              {p.dayRow?.t_suelo_c != null
                ? `${p.dayRow.t_suelo_c} °C`
                : p.dayRow
                  ? "Cloudy (>30 %)"
                  : NO_DATA}
            </dd>
            <dt>Wind</dt>
            <dd data-null={p.dayRow?.wind_dir_deg == null}>
              {p.dayRow?.wind_dir_deg != null
                ? `${p.dayRow.wind_speed_10m_ms ?? "—"} m/s · ${Math.round(p.dayRow.wind_dir_deg)}° (from)`
                : NO_DATA}
            </dd>
            <dt>Elevation</dt>
            <dd data-null={p.dayRow?.elevation_m == null}>
              {p.dayRow?.elevation_m != null ? `${p.dayRow.elevation_m} m a.s.l.` : NO_DATA}
            </dd>
            <dt>DEM model</dt>
            <dd data-null={!p.dayRow?.dem_source}>{p.dayRow?.dem_source ?? NO_DATA}</dd>
          </dl>

          <div className="legend__title" style={{ marginTop: 15 }}>Monthly anomaly</div>
          <dl className="kv">
            <dt>Robust anomaly</dt>
            <dd data-null={anom?.value == null}>
              {anom?.value != null
                ? `z = ${anom.value.toFixed(2)}`
                : anom
                  ? ANOMALY_LABELS[anom.status]
                  : NOT_ESTIMABLE}
            </dd>
            <dt>Baseline years</dt>
            <dd data-null={!anom?.baseline_years}>
              {anom?.baseline_years
                ? `${anom.baseline_years} (min. ${minBaseline})`
                : "Insufficient history"}
            </dd>
          </dl>

          {p.summary?.provenance && (
            <>
              <div className="legend__title" style={{ marginTop: 15 }}>Provenance</div>
              <dl className="kv">
                <dt>Products</dt>
                <dd>{p.summary.provenance.source_products.join(" · ") || NO_DATA}</dd>
                <dt>Version</dt>
                <dd>{p.summary.provenance.processing_version ?? NO_DATA}</dd>
              </dl>
            </>
          )}

          <p className="mono-sm" style={{ marginTop: 12 }}>
            The rate normalizes detections per valid observation. It is not fire probability
            or burned area. A <code>0</code> means “observed and no detections”;
            “{NO_DATA}” means it is not known.
          </p>
        </Drawer>
      );
    }

    case "multisensor": {
      if (!p.comparison) {
        return (
          <Drawer title="Multi-sensor comparison" note={p.periodLabel} onClose={p.onClose}>
            <div className="note note--warn">
              The multi-sensor comparison data is not valid at this time or is not available
              for this date.
            </div>
          </Drawer>
        );
      }

      const minCov = p.metadata?.parameters?.min_observation_coverage_for_comparison ?? 0.5;

      return (
        <Drawer title="Multi-sensor comparison" note={p.periodLabel} onClose={p.onClose}>
          <span className={STATUS_CHIP[p.comparison.status]}>
            {COMPARISON_LABELS[p.comparison.status]}
          </span>

          <table className="cmp" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Sensor</th><th>Tasa ‰</th><th>z</th><th>Cov.</th></tr>
            </thead>
            <tbody>
              {SENSORS.map((s) => {
                const d = p.comparison?.sensors[s];
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
                    <td>
                      {d?.observation_coverage != null
                        ? `${Math.round(d.observation_coverage * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Un sensor sin señal declarada no es un sensor «sin elevación»:
              es uno que no alcanzó la cobertura mínima para pronunciarse. */}
          {SENSORS.some((s) => {
            const d = p.comparison?.sensors[s];
            return d?.available && d.signal_status === null;
          }) && (
            <p className="mono-sm" style={{ marginTop: 10 }}>
              An available sensor with no declared signal did not reach the minimum coverage
              ({Math.round(minCov * 100)} %): nothing can be claimed about it, either for or
              against.
            </p>
          )}

          {p.comparison.interpretation && (
            <div className="note" style={{ marginTop: 12 }}>{p.comparison.interpretation}</div>
          )}

          <p className="mono-sm" style={{ marginTop: 10 }}>
            Each sensor is classified against its own seasonal threshold before being compared. Counts
            are never added across sensors: the overpass time and the instrument change.
          </p>
        </Drawer>
      );
    }

    case "arbol": {
      const cond = p.summary?.environmental_conditions;

      if (!cond) {
        return (
          <Drawer title="Susceptibility tree" note={p.areaLabel} onClose={p.onClose}>
            <div className="note note--warn">
              The contextual assessment is not valid at this time or is not available for this
              date.
            </div>
          </Drawer>
        );
      }

      return (
        <Drawer title="Susceptibility tree" note={p.areaLabel} onClose={p.onClose}>
          <span className={SUSC_CHIP[cond.classification]}>
            {CLASSIFICATION_LABELS[cond.classification]}
          </span>

          {cond.classification === "high" && (
            <div className="note note--ember" role="alert" style={{ marginTop: 12 }}>
              <b>Priority review notice.</b> This polygonal zone (<code>{p.areaLabel}</code>)
              shows very favorable environmental conditions in the decision tree. Check the
              evidence for the period and compare the sensors before concluding.
            </div>
          )}

          <ol className="tree" style={{ marginTop: 13 }}>
            {cond.decision_path.map((node) => (
              <li key={node} className="tree__node">
                <code>{node}</code>
                <span>{NODE_TEXT[node] ?? node}</span>
              </li>
            ))}
          </ol>

          {cond.modifiers.length > 0 && (
            <>
              <div className="legend__title" style={{ marginTop: 13 }}>Informational modifiers</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {cond.modifiers.map((m) => (
                  <span className="chip" key={m}>{m}</span>
                ))}
              </div>
            </>
          )}

          {cond.missing_variables.length > 0 && (
            <div className="note note--warn" style={{ marginTop: 12 }}>
              <b>Missing variables:</b> {cond.missing_variables.join(", ")}. That is why the assessment
              stays partial instead of giving a complete result.
            </div>
          )}

          {cond.factors.length > 0 && (
            <>
              <div className="legend__title" style={{ marginTop: 14 }}>Evidence for the period</div>
              <dl className="kv">
                {cond.factors.map((f) => (
                  <div key={f.variable} style={{ display: "contents" }}>
                    <dt title={f.source_product ? `Source: ${f.source_product}` : undefined}>
                      {VAR_TEXT[f.variable] ?? f.variable}
                    </dt>
                    <dd data-null={f.value == null}>
                      {f.value != null ? `${f.value}${f.unit ? ` ${f.unit}` : ""}` : NO_DATA}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mono-sm">
                Each variable is compared against its own seasonal percentile, not against a fixed
                value: what is dry in the jungle is not what is dry on the coast.
              </p>
            </>
          )}

          <div className="note note--warn" style={{ marginTop: 13 }}>
            <b>Qualitative reading.</b> Describes how favorable the observed conditions are
            for a fire to spread, should one occur. It does not estimate ignition probability,
            does not predict where or when a fire will start, and is not validated against real
            fires.
          </div>
        </Drawer>
      );
    }

    case "convenciones": {
      return (
        <Drawer title="Conventions" note="UNDRR · FIRMS" onClose={p.onClose}>
          <div className="legend__title">Contextual susceptibility (UNDRR / FAO / EFFIS)</div>
          <div className="note">
            <b>High</b>, <b>moderate</b> and <b>low susceptibility</b> are used following the
            UNDRR/FAO and EFFIS hierarchy: <i>Susceptibility</i> measures how predisposed the environment is
            (combustible vegetation, dryness &lt; p25, wind &gt; p75 and slope), unlike
            <i>Hazard</i> (front intensity) or <i>Risk</i> (Hazard × Exposure ×
            Vulnerability). It does not predict ignition.
          </div>

          <div className="legend__title" style={{ marginTop: 14 }}>
            Partial assessment vs. Not assessable (Gate N0)
          </div>
          <dl className="kv kv--conv">
            <dt>
              <span className="chip">Partial assessment</span>
            </dt>
            <dd>Missing ≥ 1 block or &lt; 5 baseline years, but there is partial evidence</dd>
            <dt>
              <span className="chip">Not assessable</span>
            </dt>
            <dd>Gate N0 closed with no usable evidence</dd>
          </dl>
          <p className="mono-sm">
            McHanaq does not fill in missing variables to force a high/low level. In “Sample
            data” mode, a smaller fraction of periods with partial coverage is also simulated.
          </p>

          <div className="legend__title" style={{ marginTop: 14 }}>
            Thermal values and quality (NASA FIRMS / WMO)
          </div>
          <dl className="kv kv--conv">
            <dt>0</dt>
            <dd>Observed (coverage ≥ 70 %) and 0 class 8–9 detections</dd>
            <dt>No observation</dt>
            <dd>0 valid land pixels or cloudiness ≥ 30 % (null ≠ 0)</dd>
            <dt>Not estimable</dt>
            <dd>Fewer than {minBaseline} valid years to compute the z σ anomaly</dd>
            <dt>No cross sums</dt>
            <dd>Terra, Aqua and VIIRS are not added together (different orbit)</dd>
          </dl>

          {p.onOpenConventions && (
            <button
              type="button"
              className="btn btn--full"
              style={{ marginTop: 14 }}
              onClick={p.onOpenConventions}
            >
              See regulatory framework and standards →
            </button>
          )}
        </Drawer>
      );
    }

    default:
      return null;
  }
}
