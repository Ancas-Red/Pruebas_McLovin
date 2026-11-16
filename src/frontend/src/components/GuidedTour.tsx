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
    title: "Period and usable days",
    body:
      "Choose the year, month and available usable days here. Only days with valid observation and less than 30 % cloudiness are enabled.",
    placement: "right",
  },
  {
    id: "territorio",
    selector: '[data-tour="dock-area"]',
    title: "Territory (Provinces and Basins)",
    body:
      "Switch between the provinces and hydrographic units of Peru, or change the environmental variable painted on the map.",
    placement: "right",
  },
  {
    id: "sensores",
    selector: '[data-tour="dock-sensores"]',
    title: "Active satellite sensor",
    body:
      "Select MODIS Terra, MODIS Aqua or VIIRS S-NPP. Each query reads one sensor separately: detections are never added across instruments.",
    placement: "right",
  },
  {
    id: "mapa",
    selector: '[data-tour="map-toolbar"]',
    title: "Map and polygonal zone",
    body:
      "Click any polygon of Peru to inspect it, or use the tools to draw an area and ignition in the exploratory simulation. Thermal hotspots and live NRT hotspots (NASA FIRMS) are shown on by default — turn them off anytime from Map layers.",
    placement: "bottom",
  },
  {
    id: "calendario",
    selector: '[data-tour="calendar-strip"]',
    fallbackSelector: '[data-tour="dock-periodo"]',
    title: "Thermal activity calendar (2D and 3D)",
    body:
      "Switch between 2D Heat and 3D Relief (drag to rotate and use the mouse wheel to zoom into valleys and ridges), or check the daily series of usable days. Click a cell, ridge/valley or bar to jump to that date.",
    placement: "top",
  },
  {
    id: "analisis",
    selector: '[data-tour="dock-arbol"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Susceptibility tree and indicators",
    body:
      "Open the normalized indicators, the multi-sensor comparison and the environmental decision tree here. If a polygonal zone shows high susceptibility, you will see a priority notice on screen.",
    placement: "left",
  },
  {
    id: "simulacion-tab",
    selector: '[data-tour="tab-simulacion"]',
    title: "Exploratory simulation · Global Phase 2",
    body:
      "Switch to Simulation to model hypothetical fire spread (up to 48 h) in Peru or any coordinate in the world with Open-Meteo wind, Copernicus GLO-90 DEM and GIF/MP4/QGIS outputs. Once it is open, press ? Guide to see its specific walkthrough.",
    placement: "bottom",
  },
];

export const SPREAD_TOUR_STEPS: TourStep[] = [
  {
    id: "spread-quick",
    selector: '[data-tour="spread-quick"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Global simulation in 1 click",
    body:
      "Choose Peru, California, Greece or type any latitude/longitude on the planet and press “Simulate spread here”: it draws the domain, places the ignition, queries real weather/DEM and animates the front on the map.",
    placement: "left",
  },
  {
    id: "spread-env",
    selector: '[data-tour="spread-env"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Ignition and live weather (Open-Meteo + FIRMS)",
    body:
      "You can also place the ignition manually at any point and import temperature, relative humidity, 10 m wind and NRT hotspots through /api/v1/realtime/area.",
    placement: "left",
  },
  {
    id: "spread-poly",
    selector: '[data-tour="map-toolbar"]',
    title: "Free area and Physical conditions",
    body:
      "Use POLYGON or RECT to delimit an exact cut on the map and adjust wind, fuel moisture, SAVI vegetation, slope and horizon in the Conditions drawer. Pick 1 day, 1 week, 1 month or 1 year — it always starts at 1 day; the farther out you go, the less reliable this exploratory model gets.",
    placement: "bottom",
  },
  {
    id: "spread-exports",
    selector: '[data-tour="spread-exports"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Visualization and outputs (GIF, MP4, QGIS)",
    body:
      "Preview the animated GIF for whatever horizon you picked (1 day by default), the executive infographic or the SAVI+DEM panel here. The Python/GIS report, MP4 and Shapefiles for QGIS stay fixed at 48 h, generated on demand with the backend.",
    placement: "left",
  },
  {
    id: "spread-result",
    selector: '[data-tour="dock-resultado"]',
    fallbackSelector: '[data-tour="right-dock"]',
    title: "Time playback and isochrones",
    body:
      "In Result and playback you can animate the Inferno patch hour by hour on the map and inspect hectares reached, ROS (m/min) and the real sources used.",
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
  const estH = 345;
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
  }, [phase, steps]);

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
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
            <span className="tour-kicker">Visual guide · First visit</span>
            <button
              type="button"
              className="drawer__close"
              onClick={() => onDismiss(dontShow)}
              aria-label="Close guide notice"
            >
              ×
            </button>
          </div>
          <h2 className="tour-modal__title" id="tour-prompt-title">
            Would you like a walkthrough of how the page works?
          </h2>
          <p className="tour-modal__body">
            In {steps.length} short steps we will show you where to select usable dates,
            explore the provinces and hydrographic units of Peru, interpret the thermal
            calendar and review the susceptibility tree.
          </p>

          <label className="tour-check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            <span>Do not show this guide again on future visits</span>
          </label>

          <div className="tour-actions">
            <button type="button" className="btn" onClick={() => onDismiss(dontShow)}>
              No, continue to the map
            </button>
            <button type="button" className="btn btn--primary" onClick={onStart}>
              Yes, start the guide →
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
            Step {stepIdx + 1} of {steps.length}
          </span>
          <button
            type="button"
            className="drawer__close"
            onClick={() => onDismiss(dontShow)}
            aria-label="Close guide"
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
          <span>Do not show again on future visits</span>
        </label>

        <div className="tour-actions">
          <button type="button" className="btn" onClick={() => onDismiss(dontShow)}>
            Close
          </button>
          <span className="tour-actions__spacer" />
          {!isFirst && (
            <button type="button" className="btn" onClick={() => setStepIdx((i) => Math.max(0, i - 1))}>
              Back
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
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
