import { Logo } from "./Logo";
import type { BackendState } from "../api/client";
import type { TerritoryType } from "../api/types";
import type { Route } from "../lib/router";

export type ToolTab = "calendario" | "simulacion";

export interface NavContext {
  department: string | null;
  territoryName: string;
  territoryType: TerritoryType;
  dateLabel: string;
  dateIso: string;
}

interface Props {
  route: Route;
  onRoute: (r: Route) => void;
  /** Pestañas de la herramienta. Solo en la página del mapa. */
  tab?: ToolTab;
  onTab?: (t: ToolTab) => void;
  backend?: BackendState;
  navContext?: NavContext | null;
  onStartTour?: () => void;
}

const STATE: Record<BackendState, { dot: string; text: string; title: string }> = {
  checking: { dot: "dot", text: "Sondeando", title: "Comprobando si el backend responde" },
  online: { dot: "dot dot--live", text: "Conectado", title: "Los datos vienen de /api/v1" },
  offline: {
    dot: "dot dot--fixture",
    text: "Datos de muestra",
    title: "El backend no responde: la interfaz usa su juego de muestra",
  },
};

export function SiteNav({ route, onRoute, tab, onTab, backend, navContext, onStartTour }: Props) {
  const s = backend ? STATE[backend] : null;
  const dept = navContext?.department?.trim() || null;
  const territory = navContext?.territoryName?.trim() || "";
  const showTerritory =
    Boolean(territory) && (!dept || territory.toLowerCase() !== dept.toLowerCase());
  const placeTitle = [
    dept ? `Departamento: ${dept}` : null,
    territory ? `${navContext?.territoryType === "hydro_unit" ? "Cuenca" : "Provincia"}: ${territory}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className={`hdr${route !== "mapa" ? " hdr--over" : ""}`}>
      <button className="brand" onClick={() => onRoute("inicio")} title="Ir al inicio">
        {/* Blanco: las pantallas comparten cabecera oscura, y la marca
            monocroma se lee mejor sobre negro que cualquier versión con
            color. `tone="dark"` queda disponible para fondos claros.
            `compact={false}`: en la cabecera va la marca completa (globo
            con meridianos, doble órbita y satélite) propuesta por el
            equipo, no la versión reducida de abajo de 44px. */}
        <Logo size={36} tone="light" compact={false} />
        <span className="brand__text">
          <span className="brand__name">McHanaq</span>
          <span className="brand__tag">Actividad térmica</span>
        </span>
      </button>

      <nav className="hdr__nav" aria-label="Secciones del sitio">
        <button className="tab" aria-selected={route === "inicio"} onClick={() => onRoute("inicio")}>
          Inicio
        </button>
        <button className="tab" aria-selected={route === "mapa"} onClick={() => onRoute("mapa")}>
          Mapa
        </button>
        <button
          className="tab"
          aria-selected={route === "tecnologia"}
          onClick={() => onRoute("tecnologia")}
        >
          Tecnología
        </button>
        <button
          className="tab"
          aria-selected={route === "convenciones"}
          onClick={() => onRoute("convenciones")}
        >
          Convenciones
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
              data-tour="tab-simulacion"
            >
              Simulación
            </button>
          </nav>
        </>
      )}

      <div className="hdr__spacer" />

      {route === "mapa" && navContext && (
        <div
          className="hdr__ctx"
          aria-label="Departamento, región y fecha seleccionados"
          title={`${placeTitle} · Fecha: ${navContext.dateIso}`}
        >
          <span className="hdr__ctx-loc">
            <strong className="hdr__ctx-dept">{dept ?? territory}</strong>
            {dept && showTerritory && (
              <span className="hdr__ctx-sub">· {territory}</span>
            )}
          </span>
          <span className="hdr__ctx-sep" aria-hidden="true" />
          <span className="hdr__ctx-date">
            <time dateTime={navContext.dateIso}>{navContext.dateLabel}</time>
          </span>
        </div>
      )}

      {route === "mapa" && (
        <div className="hdr__right">
          {onStartTour && (
            <button
              type="button"
              className="btn hdr__tour-btn"
              onClick={onStartTour}
              title="Abrir guía visual interactiva de la herramienta"
            >
              ? Guía
            </button>
          )}
          {s && (
            <div className="hdr__conn" title={s.title}>
              <i className={s.dot} />
              <span>{s.text}</span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
