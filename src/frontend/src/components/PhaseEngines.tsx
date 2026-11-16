import { PHASE1_TREE_GATES, PHASE2_SPREAD_STEPS } from "../data/tech";

interface Props {
  onOpenMap: () => void;
}

/**
 * Comparativa visual y operativa de las dos fases analíticas de McHanaq:
 * Fase 1 (árbol determinístico N0–N3) y Fase 2 (simulador físico a 48 h).
 */
export function PhaseEngines({ onOpenMap }: Props) {
  return (
    <div className="phases-grid">
      {/* FASE 1 — ÁRBOL DE DECISIÓN N0–N3 */}
      <article className="phase-card phase-card--p1" data-reveal>
        <div className="phase-card__head">
          <div className="phase-card__tags">
            <span className="phase-badge phase-badge--core">Phase 1 · Core</span>
            <code className="phase-code">src/analytics/decision_rules.py</code>
          </div>
          <h3 className="phase-card__title">Contextual decision tree (N0 → N3)</h3>
          <p className="phase-card__lead">
            Classifies environmental susceptibility by territory and date using 100 % auditable
            deterministic gates, with no opaque models and no invented zeros.
          </p>
        </div>

        {/* Esquema visual del árbol N0 -> N3 */}
        <div className="phase-diagram" aria-label="Diagram of the N0 to N3 decision tree">
          <svg
            className="phase-diagram__svg"
            viewBox="0 0 460 118"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Enlaces base */}
            <path d="M 78 46 H 116" stroke="#39e08a" strokeOpacity="0.65" strokeWidth="1.6" />
            <path d="M 192 46 H 230" stroke="#39e08a" strokeOpacity="0.65" strokeWidth="1.6" />
            <path d="M 306 46 H 344" stroke="#d8ff33" strokeOpacity="0.7" strokeWidth="1.6" />

            {/* Ramas de salida rápidas (fail / low / mod / high) */}
            <path d="M 46 66 V 92 H 68" stroke="#628a74" strokeWidth="1.3" strokeDasharray="3 3" />
            <path d="M 154 66 V 92 H 176" stroke="#39e08a" strokeWidth="1.3" strokeDasharray="3 3" />
            <path d="M 268 66 V 92 H 290" stroke="#d8ff33" strokeWidth="1.3" strokeDasharray="3 3" />
            <path d="M 382 66 V 92 H 404" stroke="#ff6c47" strokeWidth="1.3" />

            {/* Nodo N0 */}
            <rect x="14" y="24" width="64" height="42" fill="#0b1811" stroke="#628a74" strokeWidth="1.4" />
            <text x="46" y="42" textAnchor="middle" fill="#d8ff33" fontSize="11" fontWeight="700" fontFamily="monospace">
              N0
            </text>
            <text x="46" y="56" textAnchor="middle" fill="#b7cabf" fontSize="8.5" fontFamily="monospace">
              ≥ 5y · QA
            </text>
            <text x="73" y="96" fill="#8ea396" fontSize="8.5" fontFamily="monospace">
              partial / null
            </text>

            {/* Nodo N1 */}
            <rect x="116" y="24" width="76" height="42" fill="#0b1811" stroke="#39e08a" strokeWidth="1.4" />
            <text x="154" y="42" textAnchor="middle" fill="#39e08a" fontSize="11" fontWeight="700" fontFamily="monospace">
              N1
            </text>
            <text x="154" y="56" textAnchor="middle" fill="#b7cabf" fontSize="8.5" fontFamily="monospace">
              Veg ≥ 20%
            </text>
            <text x="181" y="96" fill="#72f3a8" fontSize="8.5" fontFamily="monospace">
              &lt;20% → low
            </text>

            {/* Nodo N2 */}
            <rect x="230" y="24" width="76" height="42" fill="#0b1811" stroke="#d8ff33" strokeWidth="1.4" />
            <text x="268" y="42" textAnchor="middle" fill="#d8ff33" fontSize="11" fontWeight="700" fontFamily="monospace">
              N2
            </text>
            <text x="268" y="56" textAnchor="middle" fill="#b7cabf" fontSize="8.5" fontFamily="monospace">
              &lt; p25 dry
            </text>
            <text x="295" y="96" fill="#d8ff33" fontSize="8.5" fontFamily="monospace">
              N3b: slope
            </text>

            {/* Nodo N3 + buffer 150 m */}
            <rect x="344" y="24" width="102" height="42" fill="#18120f" stroke="#ff6c47" strokeWidth="1.5" />
            <text x="395" y="42" textAnchor="middle" fill="#ff8e72" fontSize="11" fontWeight="700" fontFamily="monospace">
              N3 · Buf 150m
            </text>
            <text x="395" y="56" textAnchor="middle" fill="#d7e2db" fontSize="8.5" fontFamily="monospace">
              Wind · T · RH
            </text>
            <text x="408" y="96" fill="#ff8e72" fontSize="8.5" fontWeight="700" fontFamily="monospace">
              high / mod
            </text>
          </svg>
        </div>

        <ul className="phase-steps">
          {PHASE1_TREE_GATES.map((g) => (
            <li key={g.node} className={`phase-step phase-step--${g.tone}`}>
              <span className="phase-step__key">{g.node}</span>
              <div className="phase-step__body">
                <strong>{g.label}</strong>
                <p>{g.rule}</p>
                <span className="phase-step__out">{g.outcome}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="phase-card__foot">
          <div className="phase-card__note">
            <span>Output per query:</span>{" "}
            <code>classification · decision_path · evidence[]</code>
          </div>
          <button type="button" className="btn" onClick={onOpenMap}>
            See susceptibility on the map →
          </button>
        </div>
      </article>

      {/* FASE 2 — MODELO DE PROPAGACIÓN DE INCENDIOS 48 H */}
      <article className="phase-card phase-card--p2" data-reveal>
        <div className="phase-card__head">
          <div className="phase-card__tags">
            <span className="phase-badge phase-badge--opt">Phase 2 · Optional and decoupled</span>
            <code className="phase-code">src/analytics/spread_model.py</code>
          </div>
          <h3 className="phase-card__title">Spatial spread simulator (48 h)</h3>
          <p className="phase-card__lead">
            For a hypothetical point ignition, projects hourly isochrones up to 48 h integrating
            SAVI fuel (Sentinel-2), Copernicus DEM terrain and live wind and humidity from
            Open-Meteo; NASA FIRMS NRT hotspots cover everything after the historical snapshot.
          </p>
        </div>

        {/* Esquema visual de elipses / isocronas de propagacion */}
        <div className="phase-diagram" aria-label="Elliptical diagram of 6h to 48h isochrones">
          <svg
            className="phase-diagram__svg"
            viewBox="0 0 460 118"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Reticula topografica sutil */}
            <path
              d="M 20 28 H 255 M 20 58 H 255 M 20 88 H 255 M 70 16 V 104 M 130 16 V 104 M 190 16 V 104"
              stroke="#1f382a"
              strokeWidth="0.9"
            />
            {/* Isocronas elipticas Anderson / Huygens desplazadas segun viento + pendiente */}
            <g transform="translate(88 64) rotate(-14)">
              <ellipse cx="48" cy="0" rx="92" ry="38" fill="#d8ff33" fillOpacity="0.05" stroke="#d8ff33" strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="4 3" />
              <ellipse cx="38" cy="0" rx="70" ry="30" fill="#72f3a8" fillOpacity="0.06" stroke="#72f3a8" strokeOpacity="0.72" strokeWidth="1.2" />
              <ellipse cx="28" cy="0" rx="50" ry="22" fill="#39e08a" fillOpacity="0.08" stroke="#39e08a" strokeWidth="1.3" />
              <ellipse cx="18" cy="0" rx="31" ry="14.5" fill="#ffb224" fillOpacity="0.1" stroke="#ffb224" strokeWidth="1.4" />
              <ellipse cx="9" cy="0" rx="16" ry="8" fill="#ff4a24" fillOpacity="0.18" stroke="#ff4a24" strokeWidth="1.6" />
              {/* Punto de ignicion hipotetica t0 */}
              <circle cx="0" cy="0" r="3.4" fill="#ff4a24" stroke="#ffffff" strokeWidth="1.1" />
              {/* Vector de viento + pendiente */}
              <line x1="0" y1="0" x2="122" y2="0" stroke="#d8ff33" strokeWidth="1.6" strokeDasharray="3 2" />
              <polygon points="126,0 119,-3.2 119,3.2" fill="#d8ff33" />
            </g>

            {/* Leyenda derecha limpia dentro del visor */}
            <text x="260" y="30" fill="#d8ff33" fontSize="9.2" fontWeight="700" fontFamily="monospace">
              SPREAD ISOCHRONES
            </text>
            <circle cx="265" cy="48" r="3.4" fill="#ff4a24" />
            <text x="275" y="51" fill="#e8efe9" fontSize="8.8" fontFamily="monospace">
              6 h · hypothetical ignition t₀
            </text>
            <circle cx="265" cy="65" r="3.4" fill="#ffb224" />
            <text x="275" y="68" fill="#b7cabf" fontSize="8.8" fontFamily="monospace">
              12–24 h · elliptical front L/B
            </text>
            <circle cx="265" cy="82" r="3.4" fill="#39e08a" />
            <text x="275" y="85" fill="#b7cabf" fontSize="8.8" fontFamily="monospace">
              36 h · DEM + humidity adjustment
            </text>
            <circle cx="265" cy="99" r="3.4" fill="#d8ff33" />
            <text x="275" y="102" fill="#d8ff33" fontSize="8.8" fontFamily="monospace">
              48 h · exploratory horizon
            </text>
          </svg>
        </div>

        <ul className="phase-steps">
          {PHASE2_SPREAD_STEPS.map((s) => (
            <li key={s.code} className="phase-step phase-step--p2">
              <span className="phase-step__key">{s.code}</span>
              <div className="phase-step__body">
                <strong>
                  {s.title} <span className="phase-step__src">· {s.source}</span>
                </strong>
                <p>{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="phase-card__foot">
          <div className="phase-card__note">
            <span>Scope:</span>{" "}
            <code>Hypothetical scenario · does not predict a real ignition</code>
          </div>
          <button type="button" className="btn btn--primary" onClick={onOpenMap}>
            Simulate 48 h spread →
          </button>
        </div>
      </article>
    </div>
  );
}
