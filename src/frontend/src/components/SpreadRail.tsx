import { useEffect, useState } from "react";
import { renderSpreadReport } from "../lib/spreadReport";
import { renderSpreadGif } from "../lib/spreadGif";
import { Lightbox } from "./Lightbox";
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

/** Quick horizon picks for the exploratory spread model. Always defaults to 1 day. */
export const HORIZON_PRESETS: { label: string; hours: number }[] = [
  { label: "1 day", hours: 24 },
  { label: "1 week", hours: 24 * 7 },
  { label: "1 month", hours: 24 * 30 },
  { label: "1 year", hours: 24 * 365 },
];

function formatHorizon(hours: number): string {
  if (hours % (24 * 365) === 0 && hours >= 24 * 365) {
    const n = hours / (24 * 365);
    return `${n} year${n === 1 ? "" : "s"} (${hours} h)`;
  }
  if (hours % (24 * 30) === 0 && hours >= 24 * 30) {
    const n = hours / (24 * 30);
    return `${n} month${n === 1 ? "" : "s"} (${hours} h)`;
  }
  if (hours % (24 * 7) === 0 && hours >= 24 * 7) {
    const n = hours / (24 * 7);
    return `${n} week${n === 1 ? "" : "s"} (${hours} h)`;
  }
  if (hours % 24 === 0) {
    const n = hours / 24;
    return `${n} day${n === 1 ? "" : "s"} (${hours} h)`;
  }
  return `${hours} h`;
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
  { id: "escenario", label: "Scenario · Phase 2", icon: "flame" },
  { id: "condiciones", label: "Conditions", icon: "sliders" },
  { id: "resultado", label: "Result and playback", icon: "play" },
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
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

const GLOBAL_PRESETS: Array<{ label: string; lat: number; lon: number }> = [
  { label: "Ucayali", lat: -8.198, lon: -75.267 },
  { label: "California", lat: 39.76, lon: -121.62 },
  { label: "Greece", lat: 37.98, lon: 23.73 },
];

export function SpreadRail(p: Props) {
  const v = p.params;
  const set = <K extends keyof SpreadParams>(k: K, value: SpreadParams[K]) =>
    p.onParams({ ...v, [k]: value });
  const ready = p.ring !== null && p.ignition !== null;
  const [forecastDate, setForecastDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  // GIF generado en el navegador con la simulación actual (coordenadas actuales).
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifBusy, setGifBusy] = useState<string | null>(null);
  const [showGif, setShowGif] = useState(false);
  // GIF del servidor: solo si /spread-export respondió OK para ESTE punto.
  const [serverGifUrl, setServerGifUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; title: string; name: string } | null>(null);
  // Infografía generada en el navegador a partir de la simulación ACTUAL
  // (antes se mostraba un PNG precalculado del servidor con otra zona fija).
  // Es async porque arma el fondo con teselas reales (satélite/relieve) del
  // lugar simulado; mientras carga, el botón "Ver infografía" queda deshabilitado.
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  useEffect(() => {
    if (!p.result) {
      setReportUrl(null);
      return;
    }
    let cancelled = false;
    setReportBusy(true);
    renderSpreadReport({
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
    })
      .then((url) => {
        if (!cancelled) setReportUrl(url || null);
      })
      .catch(() => {
        if (!cancelled) setReportUrl(null);
      })
      .finally(() => {
        if (!cancelled) setReportBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.result, p.ignition, p.globalTelemetry?.locationLabel, p.dateIso]);
  const defaultPt = p.ignition ?? p.center ?? [-8.198, -75.267];
  const [quickLat, setQuickLat] = useState(() => defaultPt[0].toFixed(3));
  const [quickLon, setQuickLon] = useState(() => defaultPt[1].toFixed(3));
  const ignLat = p.ignition?.[0];
  const ignLon = p.ignition?.[1];

  // Si cambia el punto de ignición o la simulación, se descarta todo lo generado
  // para no mostrar una infografía/GIF de unas coordenadas distintas a las actuales.
  useEffect(() => {
    setGifUrl((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return null;
    });
    setShowGif(false);
    setShowReport(false);
    setServerGifUrl(null);
    setExportInfo(null);
    setLightbox(null);
  }, [ignLat, ignLon, p.result]);

  async function handleBrowserGif() {
    if (!p.result) return;
    if (gifUrl) {
      setShowReport(false);
      setShowGif((x) => !x);
      return;
    }
    setGifBusy("Generating GIF…");
    try {
      const out = await renderSpreadGif(p.result, p.ignition, v.horizonHours, v.windDirDeg, (d, t) =>
        setGifBusy(`Generating GIF… ${d}/${t}`)
      );
      setGifUrl(URL.createObjectURL(out.blob));
      setShowReport(false);
      setShowGif(true);
    } catch {
      setExportInfo("Could not generate the GIF in the browser.");
    } finally {
      setGifBusy(null);
    }
  }

  // Mantener sincronizadas las coordenadas rápidas con el punto de ignición
  // marcado en el mapa para que "Simular extensión aquí" no salte a otra zona.
  useEffect(() => {
    if (ignLat == null || ignLon == null) return;
    setQuickLat(ignLat.toFixed(3));
    setQuickLon(ignLon.toFixed(3));
  }, [ignLat, ignLon]);

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
      const exp = data?.ignition;
      const sameSpot =
        !exp ||
        (Math.abs(Number(exp.lat) - pt[0]) < 1e-3 && Math.abs(Number(exp.lon) - pt[1]) < 1e-3);
      if (sameSpot) setServerGifUrl(`${API_BASE}/spread-outputs/simulacion_48h.gif?r=${Date.now()}`);
      setExportInfo(
        `${data?.horizon_h ?? 48}h package (${forecastDate}) generated on the server for ${formatLatLon(pt, 3)}${t ? ` in ${Number(t).toFixed(1)} s` : ""} (${ws} · ${ds} · ${ss}).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setExportInfo(
        `The server could not generate the package (${msg}). The infographic and the GIF above are generated in your browser with the current simulation and coordinates.`
      );
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

  const previewBox = {
    marginTop: 8,
    border: "1px solid var(--line-strong)",
    background: "var(--surface-1)",
    padding: 6,
  } as const;

  const exportsBlock = (
    <div data-tour="spread-exports">
      <div className="legend__title" style={{ marginTop: 14 }}>
        {formatHorizon(v.horizonHours)} visualization and outputs · Python / GIS
      </div>
      <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 5 }}>
        <button
          type="button"
          className={`btn${showGif ? " btn--on" : ""}`}
          disabled={!p.result || Boolean(gifBusy)}
          title={p.result ? undefined : "Run a simulation first"}
          onClick={handleBrowserGif}
        >
          {gifBusy ?? (gifUrl ? "View GIF" : "Generate GIF")}
        </button>
        {gifUrl && (
          <a className="btn" href={gifUrl} download={`mchanaq_simulacion_${Math.round(v.horizonHours)}h.gif`}>
            Download GIF
          </a>
        )}
        <button
          type="button"
          className={`btn${showReport ? " btn--on" : ""}`}
          disabled={!reportUrl}
          title={reportBusy ? "Building the real background (satellite/relief)…" : reportUrl ? undefined : "Run a simulation first"}
          onClick={() => {
            setShowGif(false);
            setShowReport((x) => !x);
          }}
        >
          {reportBusy ? "Generating infographic…" : "View infographic"}
        </button>
        {reportUrl && (
          <a
            className="btn"
            href={reportUrl}
            download={`mchanaq_infografia_${Math.round(v.horizonHours)}h.png`}
          >
            Download infographic
          </a>
        )}
      </div>
      {showReport && reportUrl && (
        <div style={previewBox}>
          <img
            src={reportUrl}
            alt="Infographic of the current simulation (UTM coordinates)"
            style={{ display: "block", width: "100%", height: "auto", cursor: "zoom-in" }}
            onClick={() =>
              setLightbox({
                src: reportUrl,
                title: `Infographic · ${p.ignition ? formatLatLon(p.ignition, 3) : "current simulation"}`,
                name: `mchanaq_infografia_${Math.round(v.horizonHours)}h.png`,
              })
            }
          />
        </div>
      )}
      {showGif && gifUrl && (
        <div style={previewBox}>
          <img
            src={gifUrl}
            alt="GIF of the current simulation"
            style={{ display: "block", width: "100%", height: "auto", cursor: "zoom-in", imageRendering: "pixelated" }}
            onClick={() =>
              setLightbox({
                src: gifUrl,
                title: `GIF ${Math.round(v.horizonHours)} h · ${p.ignition ? formatLatLon(p.ignition, 3) : "current simulation"}`,
                name: `mchanaq_simulacion_${Math.round(v.horizonHours)}h.gif`,
              })
            }
          />
        </div>
      )}
      {serverGifUrl && (
        <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 5 }}>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setLightbox({
                src: serverGifUrl,
                title: "Server GIF (Python) · current point",
                name: "simulacion_48h.gif",
              })
            }
          >
            View server GIF
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn--block"
        disabled={exporting}
        onClick={handleServerExport}
        style={{ marginTop: 8 }}
      >
        {exporting ? "Generating GIF, MP4, SHP and infographics…" : "Generate 48 h report (API)"}
      </button>
      {exportInfo && (
        <p className="mono-sm" style={{ marginTop: 6 }}>{exportInfo}</p>
      )}
      <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
        <a className="btn" href={`${API_BASE}/spread-outputs/pronostico_48h.mp4`} download>MP4 (sample)</a>
        <a className="btn" href={`${API_BASE}/spread-outputs/mchanaq_propagacion_48h_qgis.zip`} download>QGIS Shapefiles (sample)</a>
      </div>
      <p className="mono-sm" style={{ marginTop: 6, color: "var(--ink-3)" }}>
        The infographic and the GIF correspond to your current simulation and are generated in the browser.
        MP4 and Shapefiles are precomputed samples of a reference zone, not of your point.
      </p>
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          title={lightbox.title}
          downloadName={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );

  switch (p.section) {
    case "escenario":
      return (
        <Drawer title="Scenario" onClose={p.onClose}>
          <span className="chip chip--warn">Phase 2 · optional</span>
          <div className="note note--ember" style={{ marginTop: 10 }}>
            <b>Exploratory, unvalidated model.</b> Estimates how far a front could advance
            from a <i>hypothetical</i> ignition, under the conditions you set. It does not predict whether there will be
            a fire, or where, or when. Do not use for operational or evacuation decisions.
          </div>
          <p className="mono-sm" style={{ marginTop: 9 }}>
            This layer is decoupled from Phase 1: it does not alter the calendar, the multi-sensor
            comparison or any endpoint of the contract.
          </p>
          <dl className="kv" style={{ marginTop: 13 }}>
            <dt>Area of interest</dt>
            <dd data-null={!p.ring}>{p.ring ? `${p.ring.length} vertices` : "Not defined"}</dd>
            <dt>Ignition</dt>
            <dd data-null={!p.ignition}>{p.ignition ? `${formatUtm(toUtm(p.ignition[0], p.ignition[1]))} (${formatLatLon(p.ignition, 3)})` : "Not defined"}</dd>
            <dt>Territory center</dt>
            <dd data-null={!p.center}>{p.center ? `${formatUtm(toUtm(p.center[0], p.center[1]))} (${formatLatLon(p.center, 3)})` : "Not defined"}</dd>
          </dl>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="field__label" htmlFor="sp-date">
              Start date (48 h) <span className="field__value">{forecastDate}</span>
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
                Next 48 h (today)
              </button>
              {p.dateIso && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setForecastDate(p.dateIso!)}
                >
                  Use calendar date
                </button>
              )}
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 11 }} data-tour="spread-env">
            <button className="btn" onClick={p.onPickIgnition}>Place ignition</button>
            <button
              className="btn"
              onClick={p.onApplyEnv}
              disabled={p.envApplied || !p.hasEnv || Boolean(p.envLoading)}
              title={
                p.hasEnv
                  ? "Queries live global wind and humidity (Open-Meteo) + local factors if the area is in Ucayali"
                  : "Define an area/ignition or wait for the territory card"
              }
            >
              {p.envLoading
                ? "Querying Open-Meteo…"
                : p.envApplied
                  ? "Weather applied"
                  : p.ring || p.ignition
                    ? "Use global weather"
                    : "Use the day's weather"}
            </button>
          </div>
          {p.globalTelemetry && (
            <div className="note" style={{ marginTop: 10 }}>
              <dl className="kv">
                {(p.globalTelemetry.locationLabel || p.globalTelemetry.coordsLabel) && (
                  <>
                    <dt>Detected region</dt>
                    <dd>{p.globalTelemetry.locationLabel ?? "—"}</dd>
                    <dt>Location</dt>
                    <dd>{p.globalTelemetry.coordsLabel ?? "—"}</dd>
                  </>
                )}
                <dt>Weather / wind</dt>
                <dd data-null={!p.globalTelemetry.weatherSource}>
                  {p.globalTelemetry.weatherSource
                    ? `${p.globalTelemetry.weatherSource}${p.globalTelemetry.windInfo ? ` (${p.globalTelemetry.windInfo})` : ""}`
                    : "No live data"}
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
                    <dt>DEM terrain</dt>
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
              Draw a polygon/rectangle on the map, or use the global quick simulation below.
            </div>
          )}

          <div
            className="note"
            style={{ marginTop: 12, borderColor: "var(--line-strong)" }}
            data-tour="spread-quick"
          >
            <div className="legend__title" style={{ marginBottom: 6 }}>
              Global quick simulation · 1 click (Open-Meteo + DEM)
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
                Latitude
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
                Longitude
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
              {p.running ? "Computing fire spread…" : "Simulate spread here (1 click)"}
            </button>
          </div>

          {ready && (
            <button
              className="btn btn--ember btn--block"
              disabled={p.running}
              onClick={p.onRun}
              style={{ marginTop: 11 }}
            >
              {p.running ? "Computing…" : "Recompute with current area"}
            </button>
          )}

          {exportsBlock}
        </Drawer>
      );

    case "condiciones":
      return (
        <Drawer title="Conditions" onClose={p.onClose}>
          <div className="field">
            <label className="field__label" htmlFor="sp-wind">
              Wind at 10 m <span className="field__value">{v.windSpeedMs.toFixed(1)} m/s</span>
            </label>
            <input id="sp-wind" type="range" min={0} max={18} step={0.5}
              value={v.windSpeedMs} onChange={(e) => set("windSpeedMs", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-dir">
              Wind from <span className="field__value">{Math.round(v.windDirDeg)}° {cardinal(v.windDirDeg)}</span>
            </label>
            <input id="sp-dir" type="range" min={0} max={359} step={5}
              value={v.windDirDeg} onChange={(e) => set("windDirDeg", Number(e.target.value))} />
            <div className="compass" aria-hidden="true">
              <i style={{ transform: `rotate(${v.windDirDeg + 180}deg)` }} />
              <span>advance</span>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-fm">
              Fuel moisture <span className="field__value">{v.fuelMoisturePct.toFixed(0)} %</span>
            </label>
            <input id="sp-fm" type="range" min={2} max={30} step={1}
              value={v.fuelMoisturePct} onChange={(e) => set("fuelMoisturePct", Number(e.target.value))} />
            <p className="mono-sm">At 30 % the front dies out: it is the moisture of extinction.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-veg">
              Vegetation cover <span className="field__value">{v.vegetationPct.toFixed(0)} %</span>
            </label>
            <input id="sp-veg" type="range" min={5} max={100} step={1}
              value={v.vegetationPct} onChange={(e) => set("vegetationPct", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-slope">
              Mean slope <span className="field__value">{v.slopeMeanDeg.toFixed(0)}°</span>
            </label>
            <input id="sp-slope" type="range" min={0} max={35} step={1}
              value={v.slopeMeanDeg} onChange={(e) => set("slopeMeanDeg", Number(e.target.value))} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sp-h">
              Horizon <span className="field__value">{formatHorizon(v.horizonHours)}</span>
            </label>
            <input id="sp-h" type="range" min={3} max={Math.max(48, v.horizonHours)} step={1}
              value={v.horizonHours} onChange={(e) => set("horizonHours", Number(e.target.value))} />
            <div className="btn-row" style={{ marginTop: 6, flexWrap: "wrap", gap: 5 }}>
              {HORIZON_PRESETS.map((preset) => (
                <button
                  key={preset.hours}
                  type="button"
                  className={`btn${v.horizonHours === preset.hours ? " btn--on" : ""}`}
                  onClick={() => set("horizonHours", preset.hours)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="mono-sm" style={{ marginTop: 6 }}>
              Default: 1 day. Beyond 48 h the model (SAVI + DEM + constant wind) is a rough
              long-range extrapolation — treat it as even less reliable the longer the horizon.
            </p>
          </div>

          <button className="btn btn--ember btn--block" disabled={!ready || p.running} onClick={p.onRun}>
            {p.running ? "Computing…" : "Run simulation"}
          </button>
          {!ready && (
            <p className="mono-sm" style={{ marginTop: 9 }}>
              Missing {!p.ring ? "the area" : ""}{!p.ring && !p.ignition ? " and " : ""}
              {!p.ignition ? "the ignition point" : ""}.
            </p>
          )}
        </Drawer>
      );

    case "resultado":
      if (!p.result) {
        return (
          <Drawer title="Result" onClose={p.onClose}>
            <div className="note">
              There is no simulation yet. Define an area and an ignition point, adjust the
              conditions and press <b>Run simulation</b>.
            </div>
          </Drawer>
        );
      }
      return (
        <Drawer title="Result" note={`t = ${p.time.toFixed(1)} h`} onClose={p.onClose}>
          <div className="transport">
            <button type="button" className="btn" onClick={p.onPlayPause} style={{ flexShrink: 0, minWidth: 88 }}>
              {p.playing ? "Pause" : "Play"}
            </button>
            <input type="range" min={0} max={v.horizonHours} step={0.25}
              value={p.time} onChange={(e) => p.onTime(Number(e.target.value))}
              aria-label="Simulation time" />
          </div>
          <div className="legend__scale" style={{ marginTop: 2, marginBottom: 14 }}>
            <span>0 h</span><span>{v.horizonHours} h</span>
          </div>

          <div className="metric-grid">
            <div className="metric">
              <div className="metric__label">Area reached</div>
              <div className="metric__value">
                {areaAt(p.result, p.time).toLocaleString("es-PE")}
                <span className="metric__unit">ha</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric__label">Head advance</div>
              <div className="metric__value">
                {p.result.headRosMMin.toFixed(1)}
                <span className="metric__unit">m/min</span>
              </div>
            </div>
          </div>

          <div className="legend__title" style={{ marginTop: 14 }}>
            Isochrones · cumulative area
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
                <dt>Region</dt>
                <dd>{p.globalTelemetry.locationLabel}</dd>
              </>
            )}
            <dt>Wind / Weather</dt>
            <dd>
              {p.globalTelemetry?.weatherSource
                ? `${p.globalTelemetry.weatherSource}${p.globalTelemetry.windInfo ? ` (${p.globalTelemetry.windInfo})` : ""}`
                : "Local / manual parameters"}
            </dd>
            <dt>DEM terrain</dt>
            <dd>
              {p.globalTelemetry?.demSource
                ? `${p.globalTelemetry.demSource}${typeof p.globalTelemetry.slopeDeg === "number" ? ` (${p.globalTelemetry.slopeDeg.toFixed(1)}°)` : ""}`
                : "Local synthetic terrain"}
            </dd>
            <dt>Mean SAVI</dt><dd>{p.result.saviMean.toFixed(2)}</dd>
            <dt>Length / width</dt><dd>{p.result.lengthToBreadth.toFixed(2)} : 1</dd>
            <dt>Resolution</dt><dd>{Math.round(p.result.cellSizeM)} m</dd>
            <dt>Grid</dt><dd>{p.result.cols} × {p.result.rows}</dd>
          </dl>

          {exportsBlock}

          <div className="legend__title" style={{ marginTop: 14 }}>Active assumptions</div>
          <ul className="assume">
            {p.result.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          <dl className="kv" style={{ marginTop: 13 }}>
            <dt>Model</dt>
            <dd style={{ fontSize: 10 }}>{SPREAD_MODEL_NAME}</dd>
          </dl>
          <div className="note note--ember" style={{ marginTop: 10 }}>
            {SPREAD_DISCLAIMER}
          </div>
          <p className="mono-sm" style={{ marginTop: 9 }}>
            Anderson (1983) elliptical shape, slope with the rule of doubling the speed every
            10° and Rothermel moisture damping. When the backend publishes the DEM per
            epoch and the real cover, the synthetic terrain and fuel are replaced.
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
  if (typeof rhPct === "number" && Number.isFinite(rhPct)) parts.push(`RH ${Math.round(rhPct)} %`);
  return parts.length ? parts.join(" · ") : "No data";
}

function formatFirmsStatus(status: string, total?: number): string {
  if (status === "ok") return `${(total ?? 0).toLocaleString("es-PE")} NRT hotspots`;
  if (status === "partial") return `${(total ?? 0).toLocaleString("es-PE")} hotspots (partial)`;
  if (status === "realtime_disabled") return "Real time disabled";
  if (status === "unavailable") return "FIRMS NRT not available";
  if (status === "firms_map_key_required") return "Requires FIRMS_MAP_KEY";
  return status;
}
