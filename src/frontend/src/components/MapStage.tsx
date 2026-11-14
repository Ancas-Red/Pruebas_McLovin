import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { Hotspot } from "../api/types";
import { SENSOR_META } from "../api/types";
import {
  PERU_BOUNDS,
  PERU_CENTER,
  formatLatLon,
  rectRing,
  ringAreaKm2,
  type LatLon,
} from "../lib/geo";
import { renderSpreadPNG, type SpreadResult } from "../lib/spread";

export type DrawMode = "pan" | "polygon" | "rect" | "ignition";

export interface BaseLayerId {
  id: "dark" | "terrain" | "satellite";
}

interface Props {
  mode: DrawMode;
  onModeChange: (m: DrawMode) => void;
  ring: LatLon[] | null;
  onRingChange: (r: LatLon[] | null) => void;
  ignition: LatLon | null;
  onIgnitionChange: (p: LatLon | null) => void;
  hotspots: Hotspot[];
  showHotspots: boolean;
  spread: SpreadResult | null;
  spreadTime: number;
  spreadHorizon: number;
  baseLayer: "dark" | "terrain" | "satellite";
}

/** Punto de cierre del poligono: tolerancia en pixeles sobre el primer vertice. */
const CLOSE_TOLERANCE_PX = 14;
/** Tope de puntos dibujados, para no bloquear el navegador. */
const MAX_DRAWN_POINTS = 9000;

const BASE_LAYERS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Datos de mapa &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Estilo: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagenes: Esri, Maxar, Earthstar Geographics",
    maxZoom: 18,
  },
} as const;

export function MapStage(props: Props) {
  const {
    mode,
    onModeChange,
    ring,
    onRingChange,
    ignition,
    onIgnitionChange,
    hotspots,
    showHotspots,
    spread,
    spreadTime,
    spreadHorizon,
    baseLayer,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const hotspotLayer = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);
  const spreadOverlay = useRef<L.ImageOverlay | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);

  const [draft, setDraft] = useState<LatLon[]>([]);
  const [cursor, setCursor] = useState<LatLon | null>(null);
  const [zoom, setZoom] = useState(5.4);

  // Los manejadores viven en un ref para no recrear los listeners de Leaflet
  // en cada render.
  const handlers = useRef({ mode, draft, onRingChange, onIgnitionChange, onModeChange });
  handlers.current = { mode, draft, onRingChange, onIgnitionChange, onModeChange };

  /* ---------------------------------------------------------------- mapa -- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = L.map(hostRef.current, {
      center: PERU_CENTER,
      zoom: 5.4,
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 110,
      minZoom: 4,
      maxZoom: 18,
      worldCopyJump: false,
    });

    // El trabajo es sobre el Peru: se acota el paneo con un margen generoso.
    map.setMaxBounds(
      L.latLngBounds(
        L.latLng(PERU_BOUNDS.south - 6, PERU_BOUNDS.west - 8),
        L.latLng(PERU_BOUNDS.north + 6, PERU_BOUNDS.east + 8)
      )
    );

    L.control.scale({ imperial: false, position: "bottomright", maxWidth: 160 }).addTo(map);

    rendererRef.current = L.canvas({ padding: 0.4 });
    hotspotLayer.current = L.layerGroup().addTo(map);
    drawLayer.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const h = handlers.current;
      const p: LatLon = [e.latlng.lat, e.latlng.lng];

      if (h.mode === "ignition") {
        h.onIgnitionChange(p);
        h.onModeChange("pan");
        return;
      }
      if (h.mode === "polygon") {
        setDraft((prev) => {
          if (prev.length >= 3) {
            const first = map.latLngToContainerPoint(L.latLng(prev[0][0], prev[0][1]));
            const here = map.latLngToContainerPoint(e.latlng);
            if (first.distanceTo(here) < CLOSE_TOLERANCE_PX) {
              h.onRingChange(prev);
              h.onModeChange("pan");
              return [];
            }
          }
          return [...prev, p];
        });
        return;
      }
      if (h.mode === "rect") {
        setDraft((prev) => {
          if (prev.length === 0) return [p];
          h.onRingChange(rectRing(prev[0], p));
          h.onModeChange("pan");
          return [];
        });
      }
    });

    map.on("dblclick", (e: L.LeafletMouseEvent) => {
      const h = handlers.current;
      if (h.mode !== "polygon") return;
      L.DomEvent.stop(e as unknown as Event);
      setDraft((prev) => {
        if (prev.length >= 3) {
          h.onRingChange(prev);
          h.onModeChange("pan");
        }
        return [];
      });
    });

    map.on("mousemove", (e: L.LeafletMouseEvent) => setCursor([e.latlng.lat, e.latlng.lng]));
    map.on("mouseout", () => setCursor(null));
    map.on("zoomend", () => setZoom(map.getZoom()));

    mapRef.current = map;
    // El contenedor arranca con tamanio cero en algunos layouts de grilla.
    setTimeout(() => map.invalidateSize(), 60);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* -------------------------------------------------------- capa de base -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseRef.current) map.removeLayer(baseRef.current);
    const cfg = BASE_LAYERS[baseLayer];
    baseRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      maxNativeZoom: cfg.maxZoom,
    }).addTo(map);
    baseRef.current.setZIndex(1);
  }, [baseLayer]);

  /* -------------------------------------------- teclado: Esc y Enter ------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft([]);
        onModeChange("pan");
      }
      if (e.key === "Enter" && mode === "polygon" && draft.length >= 3) {
        onRingChange(draft);
        setDraft([]);
        onModeChange("pan");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draft, onRingChange, onModeChange]);

  /* ------------------------------------------------------------ hotspots -- */
  useEffect(() => {
    const layer = hotspotLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showHotspots || hotspots.length === 0) return;

    // Por encima de cierto volumen se muestra una fraccion uniforme, para que
    // el mapa siga respondiendo. La cifra real sigue en el panel de metricas.
    const step = Math.max(1, Math.ceil(hotspots.length / MAX_DRAWN_POINTS));
    const radius = zoom < 6 ? 1.6 : zoom < 8 ? 2.4 : zoom < 10 ? 3.4 : 4.6;

    for (let i = 0; i < hotspots.length; i += step) {
      const h = hotspots[i];
      const color = SENSOR_META[h.sensor].color;
      L.circleMarker([h.lat, h.lon], {
        renderer: rendererRef.current ?? undefined,
        radius,
        stroke: false,
        fillColor: color,
        fillOpacity: h.confidence === "low" ? 0.32 : h.confidence === "high" ? 0.95 : 0.7,
        interactive: zoom >= 8,
      })
        .bindTooltip(
          `<b>${SENSOR_META[h.sensor].short}</b> · ${h.date} ${h.acq_time}Z<br/>` +
            `FRP ${h.frp} MW · confianza ${h.confidence}<br/>` +
            `${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}`,
          { direction: "top", opacity: 0.95 }
        )
        .addTo(layer);
    }
  }, [hotspots, showHotspots, zoom]);

  /* ------------------------------------------- poligono, borrador, ignicion */
  useEffect(() => {
    const layer = drawLayer.current;
    if (!layer) return;
    layer.clearLayers();

    if (ring && ring.length >= 3) {
      L.polygon(ring, {
        color: "#d8ff33",
        weight: 1.6,
        fillColor: "#d8ff33",
        fillOpacity: 0.045,
        dashArray: "5 4",
      }).addTo(layer);
      for (const v of ring) {
        L.circleMarker(v, {
          radius: 3,
          color: "#d8ff33",
          weight: 1.4,
          fillColor: "#000",
          fillOpacity: 1,
        }).addTo(layer);
      }
    }

    if (draft.length > 0) {
      const path: LatLon[] = cursor && mode === "polygon" ? [...draft, cursor] : draft;
      if (mode === "rect" && cursor && draft.length === 1) {
        L.polygon(rectRing(draft[0], cursor), {
          color: "#d8ff33",
          weight: 1.4,
          dashArray: "3 4",
          fillColor: "#d8ff33",
          fillOpacity: 0.05,
        }).addTo(layer);
      } else if (path.length >= 2) {
        L.polyline(path, { color: "#d8ff33", weight: 1.4, dashArray: "3 4" }).addTo(layer);
      }
      for (const [i, v] of draft.entries()) {
        L.circleMarker(v, {
          radius: i === 0 ? 5 : 3,
          color: "#d8ff33",
          weight: 1.6,
          fillColor: i === 0 ? "#d8ff33" : "#000",
          fillOpacity: 1,
        }).addTo(layer);
      }
    }

    if (ignition) {
      L.circleMarker(ignition, {
        radius: 7,
        color: "#ff4a24",
        weight: 2,
        fillColor: "#ff4a24",
        fillOpacity: 0.45,
      })
        .bindTooltip("Punto de ignicion hipotetico", { direction: "top" })
        .addTo(layer);
      L.circleMarker(ignition, {
        radius: 2,
        color: "#fff",
        weight: 0,
        fillColor: "#fff",
        fillOpacity: 1,
      }).addTo(layer);
    }
  }, [ring, draft, cursor, mode, ignition]);

  /* ------------------------------------------------- superposicion de fuego */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (spreadOverlay.current) {
      map.removeLayer(spreadOverlay.current);
      spreadOverlay.current = null;
    }
    if (!spread) return;

    const url = renderSpreadPNG(spread, spreadTime, spreadHorizon);
    if (!url) return;
    const b = L.latLngBounds(
      L.latLng(spread.bounds.south, spread.bounds.west),
      L.latLng(spread.bounds.north, spread.bounds.east)
    );
    spreadOverlay.current = L.imageOverlay(url, b, {
      opacity: 0.78,
      interactive: false,
      className: "spread-overlay",
    }).addTo(map);
    spreadOverlay.current.setZIndex(350);
  }, [spread, spreadTime, spreadHorizon]);

  /* ----------------------------------- encuadrar el frente recien calculado */
  // Un frente de pocos miles de hectareas es invisible dentro de un area de
  // interes grande, asi que al terminar la simulacion el mapa se acerca a el.
  const framedRef = useRef<SpreadResult | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !spread || framedRef.current === spread) return;
    framedRef.current = spread;
    const rb = spread.reachedBounds;
    if (!rb) return;
    map.flyToBounds(
      L.latLngBounds(L.latLng(rb.south, rb.west), L.latLng(rb.north, rb.east)).pad(1.1),
      { duration: 0.8, maxZoom: 14 }
    );
  }, [spread]);

  /* --------------------------------------------- encuadrar el area nueva -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ring || ring.length < 3) return;
    map.flyToBounds(L.latLngBounds(ring.map((p) => L.latLng(p[0], p[1]))), {
      padding: [70, 70],
      duration: 0.7,
      maxZoom: 11,
    });
  }, [ring]);

  const areaKm2 = useMemo(() => (ring ? ringAreaKm2(ring) : 0), [ring]);

  const hint =
    mode === "polygon"
      ? draft.length === 0
        ? "Clic para el primer vertice"
        : draft.length < 3
        ? `${draft.length} vertice(s) · faltan ${3 - draft.length}`
        : "Clic en el primer vertice, doble clic o Enter para cerrar"
      : mode === "rect"
      ? draft.length === 0
        ? "Clic en una esquina"
        : "Clic en la esquina opuesta"
      : mode === "ignition"
      ? "Clic para situar la ignicion hipotetica"
      : null;

  return (
    <div className="stage">
      <div
        ref={hostRef}
        className={`map${mode !== "pan" ? " map--drawing" : ""}`}
        role="application"
        aria-label="Mapa del Peru con focos termicos"
      />

      <div className="ov ov--tl">
        <div className="toolbar" role="toolbar" aria-label="Herramientas del mapa">
          <button
            className={`btn${mode === "pan" ? " btn--on" : ""}`}
            onClick={() => {
              setDraft([]);
              onModeChange("pan");
            }}
            title="Mover el mapa"
          >
            Mover
          </button>
          <button
            className={`btn${mode === "polygon" ? " btn--on" : ""}`}
            onClick={() => {
              setDraft([]);
              onModeChange(mode === "polygon" ? "pan" : "polygon");
            }}
            title="Dibujar un area poligonal"
          >
            Poligono
          </button>
          <button
            className={`btn${mode === "rect" ? " btn--on" : ""}`}
            onClick={() => {
              setDraft([]);
              onModeChange(mode === "rect" ? "pan" : "rect");
            }}
            title="Dibujar un rectangulo"
          >
            Rect
          </button>
          <button
            className={`btn${mode === "ignition" ? " btn--on" : ""}`}
            onClick={() => {
              setDraft([]);
              onModeChange(mode === "ignition" ? "pan" : "ignition");
            }}
            title="Situar el punto de ignicion de la simulacion"
          >
            Ignicion
          </button>
          <button
            className="btn"
            disabled={!ring && !ignition && draft.length === 0}
            onClick={() => {
              setDraft([]);
              onRingChange(null);
              onIgnitionChange(null);
              onModeChange("pan");
            }}
            title="Borrar el area y la ignicion"
          >
            Limpiar
          </button>
        </div>
      </div>

      <div className="ov ov--tr">
        <div className="hud">
          <div className="hud__row">
            <span>Cursor</span>
            <b>{cursor ? formatLatLon(cursor) : "—"}</b>
          </div>
          <div className="hud__row">
            <span>Zoom</span>
            <b>{zoom.toFixed(2)}</b>
          </div>
          <div className="hud__row">
            <span>Area</span>
            <b>{ring ? `${Math.round(areaKm2).toLocaleString("es-PE")} km²` : "Perú completo"}</b>
          </div>
          <div className="hud__row">
            <span>Focos en vista</span>
            <b>{hotspots.length.toLocaleString("es-PE")}</b>
          </div>
          {hotspots.length > MAX_DRAWN_POINTS && (
            <div className="hud__row">
              <span className="muted">Dibujados</span>
              <b className="muted">1 de cada {Math.ceil(hotspots.length / MAX_DRAWN_POINTS)}</b>
            </div>
          )}
          {hint && <div className="hud__hint">{hint} · Esc cancela</div>}
        </div>
      </div>

      <div className="ov ov--bl">
        <div className="legend">
          <div className="legend__title">Sensor</div>
          <div className="legend__items" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
            {(Object.keys(SENSOR_META) as (keyof typeof SENSOR_META)[]).map((s) => (
              <div className="legend__item" key={s}>
                <i className="legend__swatch" style={{ background: SENSOR_META[s].color }} />
                <span>
                  {SENSOR_META[s].label} · {SENSOR_META[s].resolution}
                </span>
              </div>
            ))}
            {spread && (
              <div className="legend__item">
                <i
                  className="legend__swatch"
                  style={{ background: "linear-gradient(90deg,#f3e55c,#e65c2f,#480f62)" }}
                />
                <span>Frente simulado (reciente → antiguo)</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
