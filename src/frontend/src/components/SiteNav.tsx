import type { BackendState } from "../api/client";
import type { Route } from "../lib/router";

export type ToolTab = "calendario" | "simulacion";

interface Props {
  route: Route;
  onRoute: (r: Route) => void;
  /** Pestañas de la herramienta. Solo se muestran en la página del mapa. */
  tab?: ToolTab;
  onTab?: (t: ToolTab) => void;
  backend?: BackendState;
}

/** Marca propia: cumbre con brasa. Sin referencias a ninguna institución. */
function Glyph() {
  return (
    <svg className="hdr__glyph" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M2 28 L13 7 L19 18 L23 12 L30 28 Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 7 L19 18 L23 12 L30 28 Z" fill="#d8ff33" opacity="0.14" />
      <circle cx="13" cy="21.5" r="3.2" fill="#ff4a24" />
      <circle cx="13" cy="21.5" r="1.3" fill="#d8ff33" />
    </svg>
  );
}

const STATE: Record<BackendState, { dot: string; text: string; title: string }> = {
  checking: { dot: "dot", text: "Sondeando", title: "Comprobando si el backend responde" },
  online: { dot: "dot dot--live", text: "Backend conectado", title: "Los datos vienen de /api/v1" },
  offline: {
    dot: "dot dot--fixture",
    text: "Datos de muestra",
    title: "El backend no responde: la interfaz usa su juego de muestra",
  },
};

export function SiteNav({ route, onRoute, tab, onTab, backend }: Props) {
  const s = backend ? STATE[backend] : null;

  return (
    <header className={`hdr${route === "inicio" ? " hdr--over" : ""}`}>
      <button className="hdr__mark" onClick={() => onRoute("inicio")} title="Ir al inicio">
        <Glyph />
        <span>
          <span className="hdr__name">McHanaq</span>
          <span className="hdr__tag">Actividad térmica · Perú</span>
        </span>
      </button>

      <nav className="hdr__nav" aria-label="Secciones del sitio">
        <button
          className="tab"
          aria-selected={route === "inicio"}
          onClick={() => onRoute("inicio")}
        >
          Inicio
        </button>
        <button className="tab" aria-selected={route === "mapa"} onClick={() => onRoute("mapa")}>
          Mapa
        </button>
      </nav>

      {route === "mapa" && tab && onTab && (
        <>
          <span className="hdr__sep" aria-hidden="true" />
          <nav className="hdr__nav" role="tablist" aria-label="Vistas de la herramienta">
            <button
              role="tab"
              className="tab tab--sub"
              aria-selected={tab === "calendario"}
              onClick={() => onTab("calendario")}
            >
              Calendario
            </button>
            <button
              role="tab"
              className="tab tab--sub"
              aria-selected={tab === "simulacion"}
              onClick={() => onTab("simulacion")}
            >
              Simulación
            </button>
          </nav>
        </>
      )}

      <div className="hdr__spacer" />

      {route === "inicio" ? (
        <button className="btn btn--primary" onClick={() => onRoute("mapa")}>
          Abrir el mapa →
        </button>
      ) : (
        s && (
          <div className="hdr__conn" title={s.title}>
            <i className={s.dot} />
            <span>{s.text}</span>
          </div>
        )
      )}
    </header>
  );
}
