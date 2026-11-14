import { Panel } from "./Panel";
import type { SpreadResult } from "../lib/spread";
import { formatLatLon, type LatLon } from "../lib/geo";

export interface SpreadParams {
  windSpeedMs: number;
  windDirDeg: number;
  fuelMoisturePct: number;
  vegetationPct: number;
  slopeMeanDeg: number;
  horizonHours: number;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (deg: number) => COMPASS[Math.round(((deg % 360) / 45)) % 8];

interface Props {
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
  onPlayPause: () => void;
  playing: boolean;
  envApplied: boolean;
  onApplyEnv: () => void;
}

export function SpreadRail(p: Props) {
  const { params: v } = p;
  const set = <K extends keyof SpreadParams>(k: K, value: SpreadParams[K]) =>
    p.onParams({ ...v, [k]: value });

  const ready = p.ring !== null && p.ignition !== null;

  return (
    <aside className="rail rail--right" aria-label="Simulación de recorrido">
      <Panel index="S1" title="Simulación de recorrido">
        <div className="note note--ember">
          <b>Modelo exploratorio, no validado.</b> Estima hasta dónde podría avanzar un frente desde
          una ignición <i>hipotética</i>, con las condiciones que fijes abajo. No predice si habrá
          un incendio, ni dónde, ni cuándo. No usar para decisiones operativas ni de evacuación.
        </div>
      </Panel>

      <Panel index="S2" title="Escenario">
        <dl className="kv">
          <dt>Área de interés</dt>
          <dd data-null={!p.ring}>{p.ring ? `${p.ring.length} vértices` : "Sin definir"}</dd>
          <dt>Ignición</dt>
          <dd data-null={!p.ignition}>{p.ignition ? formatLatLon(p.ignition, 3) : "Sin definir"}</dd>
        </dl>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={p.onPickIgnition}>
            Situar ignición
          </button>
          <button className="btn" onClick={p.onApplyEnv} disabled={p.envApplied}>
            {p.envApplied ? "Clima aplicado" : "Usar clima del mes"}
          </button>
        </div>
        {!p.ring && (
          <div className="note note--warn" style={{ marginTop: 10 }}>
            Dibuja primero un área en el mapa: define el dominio de la simulación.
          </div>
        )}
      </Panel>

      <Panel index="S3" title="Condiciones">
        <div className="field">
          <label className="field__label" htmlFor="sp-wind">
            Viento a 10 m <span className="field__value">{v.windSpeedMs.toFixed(1)} m/s</span>
          </label>
          <input
            id="sp-wind"
            type="range"
            min={0}
            max={18}
            step={0.5}
            value={v.windSpeedMs}
            onChange={(e) => set("windSpeedMs", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sp-dir">
            Viento desde{" "}
            <span className="field__value">
              {Math.round(v.windDirDeg)}° {cardinal(v.windDirDeg)}
            </span>
          </label>
          <input
            id="sp-dir"
            type="range"
            min={0}
            max={359}
            step={5}
            value={v.windDirDeg}
            onChange={(e) => set("windDirDeg", Number(e.target.value))}
          />
          <div className="compass" aria-hidden="true">
            <i style={{ transform: `rotate(${v.windDirDeg + 180}deg)` }} />
            <span>avance</span>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sp-fm">
            Humedad del combustible{" "}
            <span className="field__value">{v.fuelMoisturePct.toFixed(0)} %</span>
          </label>
          <input
            id="sp-fm"
            type="range"
            min={2}
            max={30}
            step={1}
            value={v.fuelMoisturePct}
            onChange={(e) => set("fuelMoisturePct", Number(e.target.value))}
          />
          <p className="mono-sm">A 30 % el frente se apaga: es el contenido de extinción.</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sp-veg">
            Cobertura vegetal <span className="field__value">{v.vegetationPct.toFixed(0)} %</span>
          </label>
          <input
            id="sp-veg"
            type="range"
            min={5}
            max={100}
            step={1}
            value={v.vegetationPct}
            onChange={(e) => set("vegetationPct", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sp-slope">
            Pendiente media <span className="field__value">{v.slopeMeanDeg.toFixed(0)}°</span>
          </label>
          <input
            id="sp-slope"
            type="range"
            min={0}
            max={35}
            step={1}
            value={v.slopeMeanDeg}
            onChange={(e) => set("slopeMeanDeg", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sp-h">
            Horizonte <span className="field__value">{v.horizonHours} h</span>
          </label>
          <input
            id="sp-h"
            type="range"
            min={3}
            max={48}
            step={1}
            value={v.horizonHours}
            onChange={(e) => set("horizonHours", Number(e.target.value))}
          />
        </div>

        <button
          className="btn btn--ember btn--block"
          disabled={!ready || p.running}
          onClick={p.onRun}
          style={{ marginTop: 4 }}
        >
          {p.running ? "Calculando…" : "Ejecutar simulación"}
        </button>
        {!ready && (
          <p className="mono-sm" style={{ marginTop: 8 }}>
            Faltan {!p.ring ? "el área" : ""}
            {!p.ring && !p.ignition ? " y " : ""}
            {!p.ignition ? "el punto de ignición" : ""}.
          </p>
        )}
      </Panel>

      {p.result && (
        <>
          <Panel index="S4" title="Reproducción" note={`t = ${p.time.toFixed(1)} h`}>
            <div className="transport">
              <button className="btn" onClick={p.onPlayPause} style={{ minWidth: 62 }}>
                {p.playing ? "Pausa" : "Reproducir"}
              </button>
              <input
                type="range"
                min={0}
                max={v.horizonHours}
                step={0.25}
                value={p.time}
                onChange={(e) => p.onTime(Number(e.target.value))}
                aria-label="Instante de la simulación"
              />
            </div>
            <div className="legend__scale" style={{ marginTop: 2 }}>
              <span>0 h</span>
              <span>{v.horizonHours} h</span>
            </div>
          </Panel>

          <Panel index="S5" title="Resultado">
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

            <div className="legend__title" style={{ marginTop: 13 }}>
              Superficie acumulada
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
              <dt>Relación largo/ancho</dt>
              <dd>{p.result.lengthToBreadth.toFixed(2)} : 1</dd>
              <dt>Resolución de celda</dt>
              <dd>{Math.round(p.result.cellSizeM)} m</dd>
              <dt>Grilla</dt>
              <dd>
                {p.result.cols} × {p.result.rows}
              </dd>
            </dl>
          </Panel>

          <Panel index="S6" title="Supuestos activos">
            <ul className="assume">
              {p.result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <div className="note" style={{ marginTop: 11 }}>
              Forma elíptica de Anderson (1983), pendiente con la regla de duplicar la velocidad
              cada 10°, y amortiguamiento por humedad de Rothermel. Cuando el backend publique
              SRTM y cobertura reales, se reemplazan el relieve y el combustible sintéticos.
            </div>
          </Panel>
        </>
      )}
    </aside>
  );
}

function areaAt(r: SpreadResult, t: number): number {
  const cellHa = (r.cellSizeM * r.cellSizeM) / 10_000;
  let n = 0;
  for (let i = 0; i < r.arrival.length; i++) if (r.arrival[i] <= t) n++;
  return Math.round(n * cellHa);
}
