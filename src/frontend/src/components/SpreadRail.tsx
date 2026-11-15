import { useMemo, useState } from "react";
import { renderSpreadReport } from "../lib/spreadReport";
import { formatUtm, toUtm } from "../lib/utm";
import { Drawer } from "./Drawer";
import type { DockItem } from "./DockBar";
import { API_BASE } from "../api/client";
import { SPREAD_DISCLAIMER, SPREAD_MODEL_NAME, type SpreadResult } from "../lib/spread";
import { formatLatLon, type LatLon } from "../lib/geo";

export interface SpreadParams {
  windSpeedMs: number;
  windDirDeg: number;
  fuelMoisturePct: number;
  vegetationPct: number;
  slopeMeanDeg: number;
  horizonHours: number;
}

export interface GlobalTelemetry {
  locationLabel?: string;
  weatherSource?: string;
  demSource?: string;
  windInfo?: string;
  slopeDeg?: number;
  tempC?: number | null;
  rhPct?: number | null;
  firmsStatus?: string;
  firmsTotal?: number;
  coordsLabel?: string;
}

export const SPREAD_ITEMS: DockItem[] = [
  { id: "escenario", label: "Escenario · Fase 2", icon: "flame" },
  { id: "condiciones", label: "Condiciones", icon: "sliders" },
  { id: "resultado", label: "Resultado y reproducción", icon: "play" },
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (deg: number) => COMPASS[Math.round((deg % 360) / 45) % 8];

interface Props {
  section: string;
  onClose: () => void;
  params: SpreadParams;
  onParams: (p: SpreadParams) => void;
  ring: LatLon[] | null;
  ignition: LatLon | null;
  onPickIgnition: () => void;
  result: SpreadResult | null;
  running: boolean;
  time: number;
  onTime: (t: number) => void;
  onRun: () => void;
  /** Traza un dominio de 12x12 km en (lat, lon), fija la ignición, consulta clima/DEM y simula en 1 clic. */
  onQuickSimulate: (lat: number, lon: number) => void;
  onPlayPause: () => void;
  playing: boolean;
  envApplied: boolean;
  onApplyEnv: () => void;
  /** ¿Hay entorno aplicable (área/ignición global o ficha de Ucayali)? */
  hasEnv: boolean;
  /** Consulta en vuelo a Open-Meteo / FIRMS. */
  envLoading?: boolean;
  /** Telemetría global real (Open-Meteo, Copernicus GLO-90 DEM, FIRMS NRT). */
  globalTelemetry?: GlobalTelemetry | null;
  /** Centro del territorio activo; orienta al usuario al dibujar el recorte. */
  center: LatLon | null;
  /** Fecha activa del calendario Fase 1 (opcional). */
  dateIso?: string;
}

type PreviewAsset = "simulacion_48h.gif" | null;

const GLOBAL_PRESETS: Array<{ label: string; lat: number; lon: number }> = [
  { label: "Ucayali", lat: -8.198, lon: -75.267 },
  { label: "California", lat: 39.76, lon: -121.62 },
  { label: "Grecia", lat: 37.98, lon: 23.73 },
];

export function SpreadRail(p: Props) {
  const v = p.params;
  const set = <K extends keyof SpreadParams>(k: K, value: SpreadParams[K]) =>
    p.onParams({ ...v, [k]: value });
  const ready = p.ring !== null && p.ignition !== null;
  const [forecastDate, setForecastDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset>(null);
  const [previewRev, setPreviewRev] = useState(0);
  const [showReport, setShowReport] = useState(false);
  // Infografía generada en el navegador a partir de la simulación ACTUAL
  // (antes se mostraba un PNG precalculado del servidor con otra zona fija).
  const reportUrl = useMemo(() => {
    if (!p.result) return null;
    try {
      return renderSpreadReport({
        result: p.result,
        ignition: p.ignition,
        horizonHours: v.horizonHours,
        windSpeedMs: v.windSpeedMs,
        windDirDeg: v.windDirDeg,
        fuelMoisturePct: v.fuelMoisturePct,
        vegetationPct: v.vegetationPct,
        slopeMeanDeg: v.slopeMeanDeg,
        locationLabel: p.globalTelemetry?.locationLabel,
        dateIso: p.dateIso,
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.result, p.ignition, p.globalTelemetry?.locationLabel, p.dateIso]);
  const defaultPt = p.ignition ?? p.center ?? [-8.198, -75.267];
  const [quickLat, setQuickLat] = useState(() => defaultPt[0].toFixed(3));
  const [quickLon, setQuickLon] = useState(() => defaultPt[1].toFixed(3));

  async function handleServerExport() {
    setExporting(true);
    setExportInfo(null);
    try {
      const pt = p.ignition ?? p.center ?? [-8.19833, -75.26669];
      const res = await fetch(`${API_BASE}/spread-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pt[0],
          lon: pt[1],
          date: forecastDate,
          horizon_h: Math.max(6, Math.min(48, Math.round(v.horizonHours))),
          wind_speed_10m_ms: v.windSpeedMs,
          wind_dir_deg: v.windDirDeg,
          vegetation_pct: v.vegetationPct,
          slope_mean_deg: v.slopeMeanDeg,
          fuel_moisture_pct: v.fuelMoisturePct,
          use_open_meteo: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const t = data?.timings_s?.total_s;
      const ws = data?.data_sources?.wind_source ?? "local";
      const ds = data?.slope_summary?.dem_source ?? "DEM";
      const ss = data?.savi_summary?.source ?? "SAVI";
      setPreviewRev((n) => n + 1);
      setExportInfo(
        `Paquete ${data?.horizon_h ?? 48}h (${forecastDate}) generado${t ? ` en ${Number(t).toFixed(1)} s` : ""} (${ws} · ${ds} · ${ss}).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setExportInfo(`Exportación en vivo no disponible (${msg}); descargas precalculadas activas.`);
    } finally {
      setExporting(false);
    }
  }

  const parsedLat = Number(quickLat);
  const parsedLon = Number(quickLon);
  const quickValid =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLon) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLon >= -180 &&
    parsedLon <= 180;

  const exportsBlock = (
    <div data-tour="spread-exports">
      <div className="legend__title" style={{ marginTop: 14 }}>
        Visualización y salidas 48 h · Python / GIS
      </div>
      <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 5 }}>
        <button
          type="button"
          className={`btn${previewAsset === "simulacion_48h.gif" ? " btn--on" : ""}`}
          onClick={() =>
            setPreviewAsset((cur) => (cur === "simulacion_48h.gif" ? null : "simulacion_48h.gif"))
          }
        >
          Ver GIF 48h
        </button>
        <button
          type="button"
          className={`btn${showReport ? " btn--on" : ""}`}
          disabled={!reportUrl}
          title={reportUrl ? undefined : "Ejecuta una simulación primero"}
          onClick={() => {
            setPreviewAsset(null);
            setShowReport((v) => !v);
          }}
        >
          Ver infografía
        </button>
        {reportUrl && (
          <a
            className="btn"
            href={reportUrl}
            download={`mchanaq_infografia_${Math.round(v.horizonHours)}h.png`}
          >
            Descargar infografía
          </a>
        )}
      </div>
      {showReport && reportUrl && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid var(--line-strong)",
            background: "var(--surface-1)",
            padding: 6,
          }}
        >
          <img
            src={reportUrl}
            alt="Infografía de la simulación actual (coordenadas UTM)"
            style={{ display: "block", width: "100%", height: "auto", cursor: "zoom-in" }}
            onClick={() => window.open(reportUrl, "_blank")}
          />
        </div>
      )}
      {previewAsset && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid var(--line-strong)",
            background: "var(--surface-1)",
            padding: 6,
          }}
        >
          <img
            src={`${API_BASE}/spread-outputs/${previewAsset}${previewRev ? `?r=${previewRev}` : ""}`}
            alt={`Vista previa ${previewAsset}`}
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </div>
      )}
      <button
        type="button"
        className="btn btn--block"
        disabled={exporting}
        onClick={handleServerExport}
        style={{ marginTop: 8 }}
      >
        {exporting ? "Generando GIF, MP4, SHP e infografías…" : "Generar reporte 48 h (API)"}
      </button>
      {exportInfo && (
        <p className="mono-sm" style={{ marginTop: 6 }}>{exportInfo}</p>
      )}
      <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
        <a className="btn" href={`${API_BASE}/spread-outputs/simulacion_48h.gif${previewRev ? `?r=${previewRev}` : ""}`} target="_blank" rel="noreferrer">GIF 48h</a>
        <a className="btn" href={`${API_BASE}/spread-outputs/pronostico_48h.mp4${previewRev ? `?r=${previewRev}` : ""}`} target="_blank" rel="noreferrer">MP4 48h</a>
        <a className="btn" href={`${API_BASE}/spread-outputs/mchanaq_propagacion_48h_qgis.zip${previewRev ? `?r=${previewRev}` : ""}`} target="_blank" rel="noreferrer">Shapefiles QGIS</a>
      </div>
      <p className="mono-sm" style={{ marginTop: 6, color: "var(--ink-3)" }}>
        GIF, MP4 y Shapefiles son muestras precalculadas en el servidor (zona de referencia); la
        infografía sí corresponde a tu simulación actual.
      </p>
    </div>
  );

  switch (p.section) {
    case "escenario":
      return (
        <Drawer title="Escenario" onClose={p.onClose}>
          <span className="chip chip--warn">Fase 2 · opcional</span>
          <div className="note note--ember" style={{ marginTop: 10 }}>
            <b>Modelo exploratorio, no validado.</b> Estima hasta dónde podría avanzar un frente
            desde una ignición <i>hipotética</i>, con las condiciones que fijes. No predice si habrá
            un incendio, ni dónde, ni cuándo. No usar para decisiones operativas ni de evacuación.
          </div>
          <p className="mono-sm" style={{ marginTop: 9 }}>
            Esta capa está desacoplada de la Fase 1: no altera el calendario, la comparación
            multisensor ni ningún endpoint del contrato.
          </p>
          <dl className="kv" style={{ marginTop: 13 }}>
            <dt>Área de interés</dt>
            <dd data-null={!p.ring}>{p.ring ? `${p.ring.length} vértices` : "Sin definir"}</dd>
            <dt>Ignición</dt>
            <dd data-null={!p.ignition}>{p.ignition ? `${formatUtm(toUtm(p.ignition[0], p.ignition[1]))} (${formatLatLon(p.ignition, 3)})` : "Sin definir"}</dd>
            <dt>Centro del territorio</dt>
            <dd data-null={!p.center}>{p.center ? `${formatUtm(toUtm(p.center[0], p.center[1]))} (${formatLatLon(p.center, 3)})` : "Sin definir"}</dd>
          </dl>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="field__label" htmlFor="sp-date">
              Fecha de inicio (48 h) <span className="field__value">{forecastDate}</span>
            </label>
            <input
              id="sp-date"
              type="date"
              value={forecastDate}
              onChange={(e) => {
                if (e.target.value) setForecastDate(e.target.value);
              }}
              style={{ width: "100%" }}
            />
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setForecastDate(new Date().toISOString().slice(0, 10))}
              >
                Próximas 48 h (hoy)
              </button>
              {p.dateIso && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setForecastDate(p.dateIso!)}
                >
                  Usar fecha del calendario
                </button>
              )}
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 11 }} data-tour="spread-env">
            <button className="btn" onClick={p.onPickIgnition}>Situar ignición</button>
            <button
              className="btn"
              onClick={p.onApplyEnv}
              disabled={p.envApplied || !p.hasEnv || Boolean(p.envLoading)}
              title={
                p.hasEnv
                  ? "Consulta viento e higrometría global en vivo (Open-Meteo) + factores locales si el área está en Ucayali"
                  : "Define un área/ignición o espera la ficha del territorio"
              }
            >
              {p.envLoading
                ? "Consultando Open-Meteo…"
                : p.envApplied
                  ? "Clima aplicado"
                  : p.ring || p.ignition
                    ? "Usar clima global"
                    : "Usar clima del día"}
            </button>
          </div>
          {p.globalTelemetry && (
            <div className="note" style={{ marginTop: 10 }}>
              <dl className="kv">
                {(p.globalTelemetry.locationLabel || p.globalTelemetry.coordsLabel) && (
                  <>
                    <dt>Región detectada</dt>
                    <dd>{p.globalTelemetry.locationLabel ?? "—"}</dd>
                    <dt>Ubicación</dt>
                    <dd>{p.globalTelemetry.coordsLabel ?? "—"}</dd>
                  </>
                )}
                <dt>Clima / viento</dt>
                <dd data-null={!p.globalTelemetry.weatherSource}>
                  {p.globalTelemetry.weatherSource
                    ? `${p.globalTelemetry.weatherSource}${p.globalTelemetry.windInfo ? ` (${p.globalTelemetry.windInfo})` : ""}`
                    : "Sin dato en vivo"}
                </dd>
                <dt>T° / HR</dt>
                <dd
                  data-null={
                    p.globalTelemetry.tempC == null && p.globalTelemetry.rhPct == null
                  }
                >
                  {formatTempRh(p.globalTelemetry.tempC, p.globalTelemetry.rhPct)}
                </dd>
                {p.globalTelemetry.demSource && (
                  <>
                    <dt>Relieve DEM</dt>
                    <dd>
                      {p.globalTelemetry.demSource}
                      {typeof p.globalTelemetry.slopeDeg === "number"
                        ? ` (${p.globalTelemetry.slopeDeg.toFixed(1)}°)`
                        : ""}
                    </dd>
                  </>
                )}
                {p.globalTelemetry.firmsStatus && (
                  <>
                    <dt>FIRMS NRT</dt>
                    <dd>
                      {formatFirmsStatus(
                        p.globalTelemetry.firmsStatus,
                        p.globalTelemetry.firmsTotal
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
          {!p.ring && (
            <div className="note note--warn" style={{ marginTop: 11 }}>
              Dibuja un polígono/rectángulo en el mapa, o usa la simulación rápida global abajo.
            </div>
          )}

          <div
            className="note"
            style={{ marginTop: 12, borderColor: "var(--line-strong)" }}
            data-tour="spread-quick"
          >
            <div className="legend__title" style={{ marginBottom: 6 }}>
              Simulación rápida global · 1 clic (Open-Meteo + DEM)
            </div>
            <div className="btn-row" style={{ flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {GLOBAL_PRESETS.map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuickLat(pr.lat.toFixed(3));
                    setQuickLon(pr.lon.toFixed(3));
                    p.onQuickSimulate(pr.lat, pr.lon);
                  }}
                  disabled={p.running}
                >
                  {pr.label}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 6, marginBottom: 8 }}>
              <label className="mono-sm" style={{ minWidth: 0, display: "grid", gap: 4 }}>
                Latitud
                <input
                  id="sp-quick-lat"
                  type="text"
                  inputMode="decimal"
                  className="select"
                  value={quickLat}
                  onChange={(e) => setQuickLat(e.target.value)}
                />
              </label>
              <label className="mono-sm" style={{ minWidth: 0, display: "grid", gap: 4 }}>
                Longitud
                <input
                  id="sp-quick-lon"
                  type="text"
                  inputMode="decimal"
                  className="select"
                  value={quickLon}
                  onChange={(e) => setQuickLon(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn--ember btn--block"
              disabled={!quickValid || p.running}
              onClick={() => p.onQuickSimulate(parsedLat, parsedLon)}
            >
              {p.running ? "Calculando extensión de fuego…" : "Simular extensión aquí (1 clic)"}
            </button>
          </div>

          {ready && (
            <button
              className="btn btn--ember btn--block"
              disabled={p.running}
              onClick={p.onRun}
              style={{ marginTop: 11 }}
            >
              {p.running ? "Calculando…" : "Recalcular con área actual"}
            </button>
          )}

          {exportsBlock}
        </Drawer>
      );

    case "condiciones":
      return (
        <Drawer title="Condiciones" onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sp-wind">
              Viento a 10 m <span className="field__value">{v.windSpeedMs.toFixed(1)} m/s</span>
            </label>
            <input id="sp-wind" type="range" min={0} max={18} step={0.5}
              value={v.windSpeedMs} onChange={(e) => set("windSpeedMs", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-dir">
              Viento desde <span className="field__value">{Math.round(v.windDirDeg)}° {cardinal(v.windDirDeg)}</span>
            </label>
            <input id="sp-dir" type="range" min={0} max={359} step={5}
              value={v.windDirDeg} onChange={(e) => set("windDirDeg", Number(e.target.value))} />
            <div className="compass" aria-hidden="true">
              <i style={{ transform: `rotate(${v.windDirDeg + 180}deg)` }} />
              <span>avance</span>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-fm">
              Humedad del combustible <span className="field__value">{v.fuelMoisturePct.toFixed(0)} %</span>
            </label>
            <input id="sp-fm" type="range" min={2} max={30} step={1}
              value={v.fuelMoisturePct} onChange={(e) => set("fuelMoisturePct", Number(e.target.value))} />
            <p className="mono-sm">A 30 % el frente se apaga: es el contenido de extinción.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-veg">
              Cobertura vegetal <span className="field__value">{v.vegetationPct.toFixed(0)} %</span>
            </label>
            <input id="sp-veg" type="range" min={5} max={100} step={1}
              value={v.vegetationPct} onChange={(e) => set("vegetationPct", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-slope">
              Pendiente media <span className="field__value">{v.slopeMeanDeg.toFixed(0)}°</span>
            </label>
            <input id="sp-slope" type="range" min={0} max={35} step={1}
              value={v.slopeMeanDeg} onChange={(e) => set("slopeMeanDeg", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-h">
              Horizonte <span className="field__value">{v.horizonHours} h</span>
            </label>
            <input id="sp-h" type="range" min={3} max={48} step={1}
              value={v.horizonHours} onChange={(e) => set("horizonHours", Number(e.target.value))} />
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button type="button" className="btn" onClick={() => set("horizonHours", 24)}>24 h</button>
              <button type="button" className="btn" onClick={() => set("horizonHours", 48)}>Pronóstico 48 h (SAVI + DEM)</button>
            </div>
          </div>

          <button className="btn btn--ember btn--block" disabled={!ready || p.running} onClick={p.onRun}>
            {p.running ? "Calculando…" : "Ejecutar simulación"}
          </button>
          {!ready && (
            <p className="mono-sm" style={{ marginTop: 9 }}>
              Faltan {!p.ring ? "el área" : ""}{!p.ring && !p.ignition ? " y " : ""}
              {!p.ignition ? "el punto de ignición" : ""}.
            </p>
          )}
        </Drawer>
      );

    case "resultado":
      if (!p.result) {
        return (
          <Drawer title="Resultado" onClose={p.onClose}>
            <div className="note">
              Todavía no hay simulación. Define un área y un punto de ignición, ajusta las
              condiciones y pulsa <b>Ejecutar simulación</b>.
            </div>
          </Drawer>
        );
      }
      return (
        <Drawer title="Resultado" note={`t = ${p.time.toFixed(1)} h`} onClose={p.onClose}>
          <div className="transport">
            <button className="btn" onClick={p.onPlayPause} style={{ minWidth: 62 }}>
              {p.playing ? "Pausa" : "Reproducir"}
            </button>
            <input type="range" min={0} max={v.horizonHours} step={0.25}
              value={p.time} onChange={(e) => p.onTime(Number(e.target.value))}
              aria-label="Instante de la simulación" />
          </div>
          <div className="legend__scale" style={{ marginTop: 2, marginBottom: 14 }}>
            <span>0 h</span><span>{v.horizonHours} h</span>
          </div>

          <div className="metric-grid">
            <div className="metric">
              <div className="metric__label">Superficie alcanzada</div>
              <div className="metric__value">
                {areaAt(p.result, p.time).toLocaleString("es-PE")}
                <span className="metric__unit">ha</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric__label">Avance de cabeza</div>
              <div className="metric__value">
                {p.result.headRosMMin.toFixed(1)}
                <span className="metric__unit">m/min</span>
              </div>
            </div>
          </div>

          <div className="legend__title" style={{ marginTop: 14 }}>
            Isócronas · superficie acumulada
          </div>
          <dl className="kv">
            {p.result.bands.map((b) => (
              <div key={b.hours} style={{ display: "contents" }}>
                <dt>{b.hours} h</dt>
                <dd>{b.areaHa.toLocaleString("es-PE")} ha</dd>
              </div>
            ))}
          </dl>

          <hr className="hr" />
          <dl className="kv">
            {p.globalTelemetry?.locationLabel && (
              <>
                <dt>Región</dt>
                <dd>{p.globalTelemetry.locationLabel}</dd>
              </>
            )}
            <dt>Viento / Clima</dt>
            <dd>
              {p.globalTelemetry?.weatherSource
                ? `${p.globalTelemetry.weatherSource}${p.globalTelemetry.windInfo ? ` (${p.globalTelemetry.windInfo})` : ""}`
                : "Parámetros locales / manuales"}
            </dd>
            <dt>Relieve DEM</dt>
            <dd>
              {p.globalTelemetry?.demSource
                ? `${p.globalTelemetry.demSource}${typeof p.globalTelemetry.slopeDeg === "number" ? ` (${p.globalTelemetry.slopeDeg.toFixed(1)}°)` : ""}`
                : "Relieve sintético local"}
            </dd>
            <dt>SAVI medio</dt><dd>{p.result.saviMean.toFixed(2)}</dd>
            <dt>Largo / ancho</dt><dd>{p.result.lengthToBreadth.toFixed(2)} : 1</dd>
            <dt>Resolución</dt><dd>{Math.round(p.result.cellSizeM)} m</dd>
            <dt>Grilla</dt><dd>{p.result.cols} × {p.result.rows}</dd>
          </dl>

          {exportsBlock}

          <div className="legend__title" style={{ marginTop: 14 }}>Supuestos activos</div>
          <ul className="assume">
            {p.result.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          <dl className="kv" style={{ marginTop: 13 }}>
            <dt>Modelo</dt>
            <dd style={{ fontSize: 10 }}>{SPREAD_MODEL_NAME}</dd>
          </dl>
          <div className="note note--ember" style={{ marginTop: 10 }}>
            {SPREAD_DISCLAIMER}
          </div>
          <p className="mono-sm" style={{ marginTop: 9 }}>
            Forma elíptica de Anderson (1983), pendiente con la regla de duplicar la velocidad cada
            10° y amortiguamiento por humedad de Rothermel. Cuando el backend publique el DEM por
            época y la cobertura reales, se reemplazan el relieve y el combustible sintéticos.
          </p>
        </Drawer>
      );

    default:
      return null;
  }
}

function areaAt(r: SpreadResult, t: number): number {
  const cellHa = (r.cellSizeM * r.cellSizeM) / 10_000;
  let n = 0;
  for (let i = 0; i < r.arrival.length; i++) if (r.arrival[i] <= t) n++;
  return Math.round(n * cellHa);
}

function formatTempRh(tempC?: number | null, rhPct?: number | null): string {
  const parts: string[] = [];
  if (typeof tempC === "number" && Number.isFinite(tempC)) parts.push(`${tempC.toFixed(1)} °C`);
  if (typeof rhPct === "number" && Number.isFinite(rhPct)) parts.push(`HR ${Math.round(rhPct)} %`);
  return parts.length ? parts.join(" · ") : "Sin dato";
}

function formatFirmsStatus(status: string, total?: number): string {
  if (status === "ok") return `${(total ?? 0).toLocaleString("es-PE")} focos NRT`;
  if (status === "partial") return `${(total ?? 0).toLocaleString("es-PE")} focos (parcial)`;
  if (status === "firms_map_key_required") return "Requiere FIRMS_MAP_KEY";
  return status;
}
