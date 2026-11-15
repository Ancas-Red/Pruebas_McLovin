import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const TOUR_STORAGE_KEY = "mchanaq.tour.dismissed.v1";

export interface TourStep {
  id: string;
  selector: string;
  fallbackSelector?: string;
  title: string;
  body: string;
  placement?: "right" | "left" | "top" | "bottom";
}

export const MAP_TOUR_STEPS: TourStep[] = [
  {
    id: "periodo",
    selector: '[data-tour="dock-periodo"]',
    title: "Período y días útiles",
    body:
      "Elige aquí el año, mes y los días útiles disponibles. Solo se habilitan jornadas con observación válida y menor a 30 % de nubosidad.",
    placement: "right",
  },
  {
    id: "territorio",
    selector: '[data-tour="dock-area"]',
    title: "Territorio (Provincias y Cuencas)",
    body:
      "Alterna entre las provincias y unidades hidrográficas del Perú, o cambia la variable ambiental pintada en el mapa.",
    placement: "right",
  },
  {
    id: "sensores",
    selector: '[data-tour="dock-sensores"]',
    title: "Sensor satelital activo",
    body:
      "Selecciona MODIS Terra, MODIS Aqua o VIIRS S-NPP. Cada consulta lee un sensor por separado: nunca se suman detecciones entre instrumentos.",
    placement: "right",
  },
  {
    id: "mapa",
    selector: '[data-tour="map-toolbar"]',
    title: "Mapa y zona poligonal",
    body:
      "Haz clic sobre cualquier polígono del Perú para inspeccionarlo, o usa las herramientas para trazar un área e ignición en la simulación exploratoria.",
    placement: "bottom",
  },
  {
    id: "calendario",
    selector: '[data-tour="calendar-strip"]',
    fallbackSelector: '[data-tour="dock-periodo"]',
    title: "Calendario de actividad térmica (2D y 3D)",
    body:
      "Alterna entre 2D Calor y 3D Relieve (arrastra para rotar y usa la rueda del ratón para hacer zoom en valles y crestas), o revisa la serie diaria de días útiles. Haz clic en una celda, cresta/valle o barra para saltar a esa fecha.",
    placement: "top",
  },
  {
    id: "analisis",
    selector: '[data-tour="dock-arbol"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Árbol de susceptibilidad e indicadores",
    body:
      "Abre aquí los indicadores normalizados, la comparación multisensor y el árbol de decisión ambiental. Si una zona poligonal presenta susceptibilidad alta, verás un aviso prioritario en pantalla.",
    placement: "left",
  },
];

export type TourPhase = "closed" | "prompt" | "tour";

interface Props {
  phase: TourPhase;
  steps?: TourStep[];
  onStart: () => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

interface SpotlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Placement = "right" | "left" | "top" | "bottom";

function computePopoverGeometry(
  rect: SpotlightRect | null,
  preferred: Placement = "right"
): {
  top: number;
  left: number;
  placement: Placement;
  caretOffset: number;
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(370, vw - 24);
  const estH = 265;
  const gap = 16;

  if (!rect) {
    return {
      top: Math.max(16, Math.round((vh - estH) / 2)),
      left: Math.max(12, Math.round((vw - cardW) / 2)),
      placement: "bottom",
      caretOffset: cardW / 2,
    };
  }

  const spaceRight = vw - (rect.left + rect.width);
  const spaceLeft = rect.left;
  const spaceBottom = vh - (rect.top + rect.height);
  const spaceTop = rect.top;

  let placement: Placement = preferred;
  const fits = (p: Placement) =>
    p === "right"
      ? spaceRight >= cardW + gap + 12
      : p === "left"
        ? spaceLeft >= cardW + gap + 12
        : p === "bottom"
          ? spaceBottom >= estH + gap + 12
          : spaceTop >= estH + gap + 12;

  if (!fits(placement)) {
    const order: Placement[] = ["right", "left", "bottom", "top"];
    placement = order.find(fits) ?? preferred;
  }

  const clampX = (x: number) => Math.max(12, Math.min(vw - cardW - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - estH - 12, y));

  if (placement === "right") {
    const left = Math.min(vw - cardW - 12, rect.left + rect.width + gap);
    const top = clampY(rect.top + rect.height / 2 - estH / 2);
    const caretOffset = Math.max(18, Math.min(estH - 18, rect.top + rect.height / 2 - top));
    return { top, left, placement, caretOffset };
  }

  if (placement === "left") {
    const left = Math.max(12, rect.left - cardW - gap);
    const top = clampY(rect.top + rect.height / 2 - estH / 2);
    const caretOffset = Math.max(18, Math.min(estH - 18, rect.top + rect.height / 2 - top));
    return { top, left, placement, caretOffset };
  }

  if (placement === "bottom") {
    const top = Math.min(vh - estH - 12, rect.top + rect.height + gap);
    const left = clampX(rect.left + rect.width / 2 - cardW / 2);
    const caretOffset = Math.max(20, Math.min(cardW - 20, rect.left + rect.width / 2 - left));
    return { top, left, placement, caretOffset };
  }

  const top = Math.max(12, rect.top - estH - gap);
  const left = clampX(rect.left + rect.width / 2 - cardW / 2);
  const caretOffset = Math.max(20, Math.min(cardW - 20, rect.left + rect.width / 2 - left));
  return { top, left, placement, caretOffset };
}

export function isTourDismissed(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTourDismissed(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
    else window.localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* modo privado o sin storage: ignorar */
  }
}

export function GuidedTour({ phase, steps = MAP_TOUR_STEPS, onStart, onDismiss }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const [measureState, setMeasureState] = useState<{ key: string; spot: SpotlightRect | null }>({
    key: "",
    spot: null,
  });

  const step = steps[stepIdx] ?? steps[0];
  const activeKey = phase === "tour" ? `${phase}|${stepIdx}` : phase;
  const spot = measureState.key === activeKey ? measureState.spot : null;
  const measured = phase === "tour" && measureState.key === activeKey;

  useEffect(() => {
    if (phase === "tour") {
      setStepIdx(0);
    }
    if (phase !== "closed") {
      setDontShow(isTourDismissed());
    }
  }, [phase]);

  const measure = useCallback(() => {
    if (phase !== "tour" || !step) {
      setMeasureState({ key: activeKey, spot: null });
      return;
    }
    const el =
      document.querySelector<HTMLElement>(step.selector) ??
      (step.fallbackSelector ? document.querySelector<HTMLElement>(step.fallbackSelector) : null);
    if (!el) {
      setMeasureState({ key: activeKey, spot: null });
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    setMeasureState({
      key: activeKey,
      spot: {
        left: Math.max(2, Math.round(r.left - pad)),
        top: Math.max(2, Math.round(r.top - pad)),
        width: Math.round(r.width + pad * 2),
        height: Math.round(r.height + pad * 2),
      },
    });
  }, [phase, step, activeKey]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (phase !== "tour") return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [phase, measure]);

  useEffect(() => {
    if (phase === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss(dontShow);
      } else if (phase === "tour" && e.key === "ArrowRight") {
        setStepIdx((i) => (i + 1 < steps.length ? i + 1 : i));
      } else if (phase === "tour" && e.key === "ArrowLeft") {
        setStepIdx((i) => (i > 0 ? i - 1 : i));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dontShow, steps.length, onDismiss]);

  if (phase === "closed") return null;

  if (phase === "prompt") {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-prompt-title">
        <div className="tour-modal">
          <div className="tour-modal__head">
            <span className="tour-kicker">Guía visual · Primera visita</span>
            <button
              type="button"
              className="drawer__close"
              onClick={() => onDismiss(dontShow)}
              aria-label="Cerrar aviso de guía"
            >
              ×
            </button>
          </div>
          <h2 className="tour-modal__title" id="tour-prompt-title">
            ¿Deseas recorrer cómo funciona la página?
          </h2>
          <p className="tour-modal__body">
            Te mostraremos en {steps.length} pasos breves dónde seleccionar fechas útiles,
            explorar las provincias y unidades hidrográficas del Perú, interpretar el calendario
            térmico y revisar el árbol de susceptibilidad.
          </p>

          <label className="tour-check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            <span>No volver a mostrar esta guía en futuros ingresos</span>
          </label>

          <div className="tour-actions">
            <button type="button" className="btn" onClick={() => onDismiss(dontShow)}>
              No, continuar al mapa
            </button>
            <button type="button" className="btn btn--primary" onClick={onStart}>
              Sí, iniciar guía →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const geom = computePopoverGeometry(spot, step.placement ?? "right");
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
      {/* Escudo transparente + recorte spotlight que oscurece y desenfoca el resto */}
      <div className="tour-backdrop" onClick={() => onDismiss(dontShow)} aria-hidden="true" />
      {spot && (
        <div
          className="tour-spotlight"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
          }}
          aria-hidden="true"
        />
      )}

      {measured && (
        <div
          className={`tour-popover tour-popover--${geom.placement}`}
          style={{
            top: geom.top,
            left: geom.left,
            ["--caret" as string]: `${geom.caretOffset}px`,
          }}
        >
        <div className="tour-modal__head">
          <span className="tour-kicker">
            Paso {stepIdx + 1} de {steps.length}
          </span>
          <button
            type="button"
            className="drawer__close"
            onClick={() => onDismiss(dontShow)}
            aria-label="Cerrar guía"
          >
            ×
          </button>
        </div>

        <h3 className="tour-popover__title" id="tour-step-title">
          {step.title}
        </h3>
        <p className="tour-modal__body">{step.body}</p>

        <label className="tour-check">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          <span>No volver a mostrar en futuros ingresos</span>
        </label>

        <div className="tour-actions">
          <button type="button" className="btn" onClick={() => onDismiss(dontShow)}>
            Cerrar
          </button>
          <span className="tour-actions__spacer" />
          {!isFirst && (
            <button type="button" className="btn" onClick={() => setStepIdx((i) => Math.max(0, i - 1))}>
              Atrás
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (isLast) onDismiss(dontShow);
              else setStepIdx((i) => Math.min(steps.length - 1, i + 1));
            }}
          >
            {isLast ? "Finalizar" : "Siguiente"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
