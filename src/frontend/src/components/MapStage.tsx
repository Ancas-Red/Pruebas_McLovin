import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import type {
  Classification,
  HotspotFeature,
  MetricId,
  MetricItem,
  TerritoryCollection,
  TerritoryType,
} from "../api/types";
import { CLASSIFICATION_LABELS, METRIC_LABELS, SENSOR_META } from "../api/types";
import {
  PERU_CENTER,
  formatLatLon,
  rectRing,
  ringAreaKm2,
  ringFromGeoJson,
  type LatLon,
} from "../lib/geo";
import { cividisCss } from "../lib/palette";
import { renderSpreadPNG, type SpreadResult } from "../lib/spread";

export type DrawMode = "pan" | "polygon" | "rect" | "ignition";

export interface BaseLayerId {
  id: "dark" | "terrain" | "satellite";
}

/**
 * Ficha que acompaña al puntero.
 *
 * La arma la página con lo que devuelve el backend; el mapa solo la coloca.
 * `state` distingue los tres momentos del apunte —se pidió, llegó, falló—
 * porque taparlos todos con un hueco en blanco haría parecer que la
 * plataforma no responde cuando en realidad está consultando.
 */
export interface HoverCard {
  id: string;
  title: string;
  state: "loading" | "ready" | "error";
  rows: { k: string; v: string }[];
  notice?: string;
  foot?: string;
}

export interface HighSusceptibilityMarker {
  id: string;
  name: string;
  position: LatLon;
  kind: "territory" | "subbasin" | "cluster";
  targetTerritoryType?: TerritoryType;
  targetTerritoryId?: string;
  detail?: string;
}

export interface PrioritySubZone {
  id: string;
  label: string;
  rings: LatLon[][];
  kind: "subbasin" | "enclosure";
  targetTerritoryType?: TerritoryType;
  targetTerritoryId?: string;
  detail?: string;
}

interface Props {
  mode: DrawMode;
  onModeChange: (m: DrawMode) => void;
  ring: LatLon[] | null;
  onRingChange: (r: LatLon[] | null) => void;
  ignition: LatLon | null;
  onIgnitionChange: (p: LatLon | null) => void;
  hotspots: HotspotFeature[];
  showHotspots: boolean;

  /** Límites de los territorios del tipo activo. */
  territories: TerritoryCollection | null;
  /** Un valor por territorio. Vacío = coropleta apagada. */
  choropleth: MetricItem[];
  metric: MetricId;
  metricUnit: string | null;
  selectedId: string;
  onSelectTerritory: (id: string) => void;

  /**
   * El puntero entró o salió de un territorio. El identificador va hacia
   * arriba para que la página consulte al backend; aquí solo se detecta.
   */
  onHoverTerritory: (id: string | null) => void;
  /** Lo que se muestra junto al puntero mientras dura el apunte. */
  hoverCard: HoverCard | null;

  spread: SpreadResult | null;
  spreadTime: number;
  spreadHorizon: number;
  baseLayer: "dark" | "relief" | "satellite";
  onBaseLayer: (b: "dark" | "relief" | "satellite") => void;
  /** Dirección del viento del día, 0–360°, desde dónde sopla. */
  windDirDeg: number | null;
  windSpeedMs: number | null;
  /** La rosa de viento solo se muestra en la vista de simulación. */
  showWind: boolean;
  /** Cambia cuando el ancho disponible cambia; obliga a Leaflet a reencuadrar. */
  relayoutKey: string;
  /** Aviso breve cuando la fecha, territorio o sensor activo no tiene datos válidos. */
  dataNotice?: string | null;
  /** Marcadores ▲! de susceptibilidad alta en el período activo. */
  highMarkers?: HighSusceptibilityMarker[];
  /** Subcuencas altas o polígonos envolventes de monitoreo prioritario dentro de la región macro. */
  priorityZones?: PrioritySubZone[];
  /** Muestra u oculta marcadores ▲! y subzonas prioritarias. */
  showHighMarkers?: boolean;
  /** Al seleccionar un triángulo ▲! o subzona, selecciona territorio (si aplica) y abre el árbol. */
  onOpenSusceptibilityTree?: (targetId?: string, targetType?: TerritoryType) => void;
  children?: ReactNode;
}

/** Punto de cierre del poligono: tolerancia en pixeles sobre el primer vertice. */
const CLOSE_TOLERANCE_PX = 14;

/** Tamaño reservado para la ficha del puntero, al separarla del borde. */
const CARD_W = 256;
const CARD_H = 184;

/** Extremos de la leyenda: pocos dígitos, para que no partan la caja. */
function fmtShort(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
  if (a >= 1) return v.toLocaleString("es-PE", { maximumFractionDigits: 1 });
  return v.toLocaleString("es-PE", { maximumFractionDigits: 3 });
}

/** Trazo del territorio apuntado: blanco fino y relleno un punto más opaco. */
function hoverStyle(base: L.PathOptions): L.PathOptions {
  return {
    ...base,
    color: "#ffffff",
    weight: Math.max(2, (base.weight ?? 1) + 1.4),
    fillOpacity: Math.min(0.92, (base.fillOpacity ?? 0) + 0.14),
  };
}

/**
 * Dónde colocar la ficha para que no se salga del mapa.
 *
 * Se ancla una vez, al entrar en el territorio, y no sigue al puntero: con la
 * respuesta del backend llegando a destiempo, una ficha que persigue el ratón
 * y cambia de alto al cargar da un salto desagradable justo cuando se está
 * intentando leer.
 */
function anchorFor(e: L.LeafletMouseEvent, size: L.Point | undefined): { x: number; y: number } {
  const w = size?.x ?? 900;
  const h = size?.y ?? 600;
  const x = e.containerPoint.x + 18;
  const y = e.containerPoint.y + 18;
  return {
    x: Math.max(8, Math.min(x, w - CARD_W - 8)),
    y: Math.max(8, Math.min(y, h - CARD_H - 8)),
  };
}
/** Tope de puntos dibujados, para no bloquear el navegador. */
const MAX_DRAWN_POINTS = 9000;

/**
 * Capas base sin clave de API.
 *
 * Se retiraron las teselas de CARTO porque ahora exigen una clave y el mapa
 * aparecía cubierto de marcas "API KEY REQUIRED". El mapa oscuro se consigue
 * invirtiendo por CSS las teselas estándar de OpenStreetMap, que no piden
 * clave; las otras dos vienen de servicios abiertos de Esri y OpenTopoMap.
 */
const BASE_LAYERS = {
  dark: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    filtered: true,
  },
  relief: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Mapa &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Estilo: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
    filtered: false,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imágenes: Esri, Maxar, Earthstar Geographics",
    maxZoom: 18,
    filtered: false,
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
    territories,
    choropleth,
    metric,
    metricUnit,
    selectedId,
    onSelectTerritory,
    onHoverTerritory,
    hoverCard,
    spread,
    spreadTime,
    spreadHorizon,
    baseLayer,
    onBaseLayer,
    windDirDeg,
    windSpeedMs,
    showWind,
    relayoutKey,
    dataNotice,
    highMarkers = [],
    priorityZones = [],
    showHighMarkers = true,
    onOpenSusceptibilityTree,
    children,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const territoryLayer = useRef<L.LayerGroup | null>(null);
  const priorityZoneLayer = useRef<L.LayerGroup | null>(null);
  const hotspotLayer = useRef<L.LayerGroup | null>(null);
  const highMarkerLayer = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);
  const spreadOverlay = useRef<L.ImageOverlay | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);

  const [draft, setDraft] = useState<LatLon[]>([]);
  const [cursor, setCursor] = useState<LatLon | null>(null);
  const [zoom, setZoom] = useState(5.4);

  /* ------------------------------------------------------- apuntar ------ */
  /** Polígonos por territorio, para poder resaltarlos sin reconstruirlos. */
  const polysById = useRef<Map<string, { poly: L.Polygon; base: L.PathOptions }[]>>(new Map());
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Dónde se ancla la ficha, en píxeles del contenedor del mapa. */
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);
  /** Lo lee el constructor de polígonos, que no debe depender del estado. */
  const hoverIdRef = useRef<string | null>(null);
  /**
   * Un territorio con varios anillos dispara `mouseout` al pasar de uno al
   * siguiente. Sin esta espera corta la ficha parpadearía en cada frontera
   * interna, que no es una salida real del territorio.
   */
  const leaveTimer = useRef<number | undefined>(undefined);

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
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 110,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
    });

    L.control.scale({ imperial: false, position: "bottomright", maxWidth: 160 }).addTo(map);

    rendererRef.current = L.canvas({ padding: 0.4 });
    // El orden de alta fija el orden de pintado: los límites van debajo de
    // subzonas prioritarias y focos, y los ▲! encima para clic directo.
    territoryLayer.current = L.layerGroup().addTo(map);
    priorityZoneLayer.current = L.layerGroup().addTo(map);
    hotspotLayer.current = L.layerGroup().addTo(map);
    highMarkerLayer.current = L.layerGroup().addTo(map);
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

  /* ----------------------- reencuadre cuando cambia el ancho disponible -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // La transición de ancho dura 220 ms en CSS.
    const id = setTimeout(() => map.invalidateSize({ animate: false }), 260);
    return () => clearTimeout(id);
  }, [relayoutKey]);

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
      crossOrigin: true,
    }).addTo(map);
    baseRef.current.setZIndex(1);
    // El tema oscuro se obtiene invirtiendo las teselas claras por CSS.
    const pane = map.getPane("tilePane");
    if (pane) pane.classList.toggle("tilePane--dark", cfg.filtered);
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

  /* ------------------------------------------------- coropleta y límites -- */

  /** Techo de la escala: percentil 95, para que un valor extremo no la aplaste. */
  const scale = useMemo(() => {
    const vals = choropleth
      .map((it) => it.value)
      .filter((v): v is number => typeof v === "number" && isFinite(v))
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    const lo = vals[0];
    const hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))];
    return { lo, hi: hi > lo ? hi : lo + 1 };
  }, [choropleth]);

  useEffect(() => {
    const layer = territoryLayer.current;
    if (!layer) return;
    layer.clearLayers();
    polysById.current.clear();
    if (!territories?.features?.length) return;

    const byId = new Map(choropleth.map((it) => [it.territory_id, it.value]));

    // La clasificación es cualitativa: cuatro escalones de la misma rampa,
    // no una interpolación, porque entre «moderada» y «alta» no hay medios.
    const classStop: Record<Classification, number> = {
      not_evaluable: 0,
      partial: 0.2,
      low: 0.3,
      moderate: 0.62,
      high: 0.95,
    };

    for (const f of territories.features) {
      const id = f.properties.territory_id;
      const raw = byId.get(id);
      const selected = id === selectedId;

      let t: number | null = null;
      if (typeof raw === "number" && scale) {
        t = Math.max(0, Math.min(1, (raw - scale.lo) / (scale.hi - scale.lo)));
      } else if (typeof raw === "string" && raw in classStop) {
        t = classStop[raw as Classification];
      }

      // Sin dato no se pinta un color de la rampa: se deja hueco y se dice
      // «Sin datos». Pintarlo con el extremo bajo sería leerlo como cero.
      const hasValue = t !== null && raw !== null && raw !== undefined;

      const rings =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates as number[][][]].map((c) => c[0])
          : (f.geometry.coordinates as number[][][][]).map((poly) => poly[0]);

      for (const r of rings) {
        const latlngs = ringFromGeoJson(r as [number, number][]);
        const base: L.PathOptions = {
          renderer: rendererRef.current ?? undefined,
          color: selected ? "#d8ff33" : "rgba(236,246,235,0.34)",
          weight: selected ? 2.2 : 0.8,
          fillColor: hasValue ? cividisCss(t as number) : "#1b2a21",
          fillOpacity: choropleth.length === 0 ? 0.05 : hasValue ? 0.72 : 0.22,
        };
        const poly = L.polygon(latlngs, base);

        /* El globo de Leaflet se retiró a propósito: ahora el apunte abre la
           ficha con datos del backend, y tener las dos cosas flotando sobre
           el mismo territorio se pisaba una a la otra. */
        poly
          /* El clic solo selecciona en modo mover, y no se propaga al mapa:
             si no, dibujar un área sobre un territorio acababa cambiando el
             territorio activo. Ese arreglo viene de la rama de analítica. */
          .on("click", (e: L.LeafletMouseEvent) => {
            if (handlers.current.mode !== "pan") return;
            L.DomEvent.stopPropagation(e as unknown as Event);
            onSelectTerritory(id);
          })
          .on("mouseover", (e: L.LeafletMouseEvent) => {
            if (handlers.current.mode !== "pan") return;
            window.clearTimeout(leaveTimer.current);
            hoverIdRef.current = id;
            setHoverId(id);
            setHoverPt(anchorFor(e, mapRef.current?.getSize()));
            onHoverTerritory(id);
          })
          .on("mouseout", () => {
            window.clearTimeout(leaveTimer.current);
            leaveTimer.current = window.setTimeout(() => {
              hoverIdRef.current = null;
              setHoverId(null);
              setHoverPt(null);
              onHoverTerritory(null);
            }, 70);
          })
          .addTo(layer);

        const entry = polysById.current.get(id);
        if (entry) entry.push({ poly, base });
        else polysById.current.set(id, [{ poly, base }]);

        if (hoverIdRef.current === id) poly.setStyle(hoverStyle(base));
      }
    }
  }, [territories, choropleth, metric, metricUnit, selectedId, onSelectTerritory, onHoverTerritory, scale]);

  /* ------------------ encuadrar el territorio cuando cambia la selección -- */
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || prevSelectedIdRef.current === selectedId) return;
    const entries = polysById.current.get(selectedId);
    if (!entries || entries.length === 0) return;
    // La herramienta ya no arranca con un territorio preseleccionado
    // (`selectedId` vacío => este efecto sale arriba sin tocar el mapa), así
    // que la vista inicial es todo el Perú y cualquier selección que llegue
    // aquí la originó el usuario: se encuadra siempre.
    prevSelectedIdRef.current = selectedId;
    const group = L.featureGroup(entries.map((e) => e.poly));
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [60, 60], duration: 0.65, maxZoom: 11 });
    }
  }, [selectedId, territories]);

  /**
   * Resalte del territorio apuntado.
   *
   * Va aparte de la construcción: mover el puntero no debe rehacer cientos de
   * polígonos, solo cambiar el trazo de los que entran y salen.
   */
  useEffect(() => {
    polysById.current.forEach((entries, id) => {
      for (const { poly, base } of entries) {
        poly.setStyle(id === hoverId ? hoverStyle(base) : base);
      }
    });
  }, [hoverId]);

  /** Al soltar el componente no debe quedar un temporizador vivo. */
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

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
      const f = hotspots[i];
      const [lon, lat] = f.geometry.coordinates;
      const pr = f.properties;
      const conf = pr.confidence;

      // La clase 7 es confianza baja y se dibuja apagada: va aparte del
      // indicador principal, que usa 8–9.
      const low = conf === 7 || conf === "low";
      const high = conf === 9 || conf === "high";

      L.circleMarker([lat, lon], {
        renderer: rendererRef.current ?? undefined,
        radius,
        stroke: true,
        color: "#0b0d10",
        weight: 0.9,
        fillColor: SENSOR_META[pr.sensor]?.color ?? "#ff9f1c",
        fillOpacity: low ? 0.45 : high ? 0.95 : 0.78,
        interactive: true,
      })
        .bindTooltip(
          `<b>${SENSOR_META[pr.sensor]?.long ?? pr.sensor}</b> (${SENSOR_META[pr.sensor]?.product ?? ""}) · ${pr.date}<br/>` +
            `${pr.frp_mw !== null && pr.frp_mw !== undefined ? `FRP ${pr.frp_mw} MW · ` : ""}` +
            `confianza ${conf ?? "—"}<br/>${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          { direction: "top", opacity: 0.95 }
        )
        .addTo(layer);
    }
  }, [hotspots, showHotspots, zoom]);

  /* ---------------- subzonas prioritarias y marcadores ▲! de alerta alta --- */
  useEffect(() => {
    const zLayer = priorityZoneLayer.current;
    const mLayer = highMarkerLayer.current;
    if (!zLayer || !mLayer) return;
    zLayer.clearLayers();
    mLayer.clearLayers();
    if (!showHighMarkers) return;

    for (const z of priorityZones) {
      const isEnclosure = z.kind === "enclosure";
      for (const polyRing of z.rings) {
        if (polyRing.length < 3) continue;
        const poly = L.polygon(polyRing, {
          renderer: rendererRef.current ?? undefined,
          color: isEnclosure ? "#ff5a2f" : "#ff8547",
          weight: isEnclosure ? 2.2 : 1.8,
          dashArray: isEnclosure ? "6 4" : "4 3",
          fillColor: isEnclosure ? "#ff4a24" : "#ff6b35",
          fillOpacity: isEnclosure ? 0.14 : 0.16,
          interactive: true,
        });
        poly.bindTooltip(
          `<b>${isEnclosure ? "Polígono envolvente prioritario" : "Subcuenca en susceptibilidad alta"}</b>` +
            `<br/>${z.label}` +
            `${z.detail ? `<br/>${z.detail}` : ""}` +
            `<br/><span style="color:#ff9b7a">Clic → abrir árbol de susceptibilidad</span>`,
          { direction: "top", sticky: true, opacity: 0.96 }
        );
        poly.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onOpenSusceptibilityTree?.(z.targetTerritoryId, z.targetTerritoryType);
        });
        poly.addTo(zLayer);
      }
    }

    for (const m of highMarkers) {
      const size = m.kind === "territory" ? 28 : 24;
      const anchorY = m.kind === "territory" ? 22 : 19;
      const tipPrefix =
        m.kind === "subbasin"
          ? "Subcuenca en susceptibilidad alta"
          : m.kind === "cluster"
            ? "Foco prioritario dentro de región alta"
            : "Susceptibilidad alta";

      const safeName = m.name.replace(/"/g, "&quot;");
      const icon = L.divIcon({
        className: `high-susc-pin high-susc-pin--${m.kind}`,
        iconSize: [size, size],
        iconAnchor: [size / 2, anchorY],
        html:
          `<button type="button" class="high-susc-pin__btn" aria-label="${tipPrefix}: ${safeName}. Abrir árbol de susceptibilidad">` +
          `<span class="high-susc-pin__pulse" aria-hidden="true"></span>` +
          `<svg class="high-susc-pin__svg" viewBox="0 0 28 26" width="${size}" height="${Math.round(size * 0.93)}" aria-hidden="true">` +
          `<path d="M14 2.2 L26.2 23.6 Q26.7 24.5 25.6 24.5 L2.4 24.5 Q1.3 24.5 1.8 23.6 Z" fill="#ff3b1f" stroke="#090e0b" stroke-width="2.1" stroke-linejoin="round" />` +
          `<path d="M14 5.2 L23.5 22 L4.5 22 Z" fill="none" stroke="#ffd8cc" stroke-opacity="0.48" stroke-width="0.9" stroke-linejoin="round" />` +
          `<rect x="12.75" y="9.2" width="2.5" height="7.4" rx="1.1" fill="#fffaf4" />` +
          `<circle cx="14" cy="19.6" r="1.45" fill="#fffaf4" />` +
          `</svg>` +
          `</button>`,
      });

      const marker = L.marker(m.position, {
        icon,
        zIndexOffset: m.kind === "cluster" ? 720 : m.kind === "subbasin" ? 660 : 610,
      });
      marker.bindTooltip(
        `<b>${tipPrefix} · ${m.name}</b>` +
          `${m.detail ? `<br/>${m.detail}` : ""}` +
          `<br/><span style="color:#ff9b7a">Clic → abrir árbol de susceptibilidad</span>`,
        { direction: "top", offset: [0, -14], opacity: 0.96 }
      );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onOpenSusceptibilityTree?.(m.targetTerritoryId, m.targetTerritoryType);
      });
      marker.addTo(mLayer);
    }
  }, [highMarkers, priorityZones, showHighMarkers, onOpenSusceptibilityTree]);

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
        interactive: false,
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
  // Crea la capa UNA sola vez por simulacion (cuando cambia `spread`, es
  // decir, cuando hay una corrida nueva). Si en cada tick de la reproduccion
  // se destruye y se vuelve a crear el <img> (como antes), la animacion CSS
  // de aparicion (`mchanaq-fire-in`, 0.4s) se reinicia en cada frame y nunca
  // llega a opacity:1 — por eso solo se veian destellos en vez de un fuego
  // visible y estable.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spread]);

  // En cada tick de la reproduccion (mismo `spread`, solo avanza el tiempo)
  // actualizamos el bitmap de la capa YA existente con `setUrl`, sin tocar el
  // <img> del DOM: asi la animacion de aparicion corre una sola vez al
  // iniciar la simulacion y el fuego queda visible y estable mientras avanza.
  useEffect(() => {
    if (!spread || !spreadOverlay.current) return;
    const url = renderSpreadPNG(spread, spreadTime, spreadHorizon);
    if (!url) return;
    spreadOverlay.current.setUrl(url);
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

  const fullExtentLabel = useMemo(() => {
    const feats = territories?.features ?? [];
    if (feats.length === 0) return "Territorios cargados";
    const sources = feats.map((f) => f.properties.source ?? "");
    if (sources.some((s) => /ucayali/i.test(s)) && sources.every((s) => !s || /ucayali/i.test(s))) {
      return "Ucayali";
    }
    if (feats.length >= 150) return "Perú completo";
    return "Territorios cargados";
  }, [territories]);

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
        <div className="toolbar toolbar--zoom" role="group" aria-label="Control de zoom">
          <button
            type="button"
            className="btn"
            onClick={() => mapRef.current?.zoomIn()}
            title="Acercar el mapa"
            aria-label="Acercar el mapa"
          >
            +
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => mapRef.current?.zoomOut()}
            title="Alejar el mapa"
            aria-label="Alejar el mapa"
          >
            −
          </button>
        </div>
        <div className="toolbar" role="toolbar" aria-label="Herramientas del mapa" data-tour="map-toolbar">
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
        <div className="toolbar" role="group" aria-label="Mapa base">
          <button
            className={`btn${baseLayer === "dark" ? " btn--on" : ""}`}
            onClick={() => onBaseLayer("dark")}
            title="Mapa oscuro (OpenStreetMap)"
          >
            Oscuro
          </button>
          <button
            className={`btn${baseLayer === "relief" ? " btn--on" : ""}`}
            onClick={() => onBaseLayer("relief")}
            title="Relieve e hidrología (OpenTopoMap)"
          >
            Relieve
          </button>
          <button
            className={`btn${baseLayer === "satellite" ? " btn--on" : ""}`}
            onClick={() => onBaseLayer("satellite")}
            title="Imagen satelital (Esri World Imagery)"
          >
            Satélite
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
            <b>{ring ? `${Math.round(areaKm2).toLocaleString("es-PE")} km²` : fullExtentLabel}</b>
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
          {dataNotice && (
            <div className="hud__notice" role="status">
              {dataNotice}
            </div>
          )}
        </div>
      </div>

      {/* Ficha del puntero: lo que el backend responde del territorio apuntado.
          Vive fuera de las capas de Leaflet para que no la recorte el mapa ni
          se repinte con cada desplazamiento. */}
      {hoverCard && hoverPt && (
        <div
          className={`hovercard hovercard--${hoverCard.state}`}
          style={{ left: hoverPt.x, top: hoverPt.y }}
          aria-live="polite"
        >
          <div className="hovercard__name">{hoverCard.title}</div>
          {hoverCard.state === "loading" ? (
            <div className="hovercard__wait">
              <i className="hovercard__spark" aria-hidden="true" />
              Consultando al backend…
            </div>
          ) : hoverCard.state === "error" ? (
            <div className="hovercard__wait hovercard__wait--err">
              La data no está disponible o no es válida en este momento (sin respuesta del backend).
            </div>
          ) : (
            <>
              <dl className="hovercard__rows">
                {hoverCard.rows.map((r) => (
                  <div key={r.k}>
                    <dt>{r.k}</dt>
                    <dd>{r.v}</dd>
                  </div>
                ))}
              </dl>
              {hoverCard.notice && <div className="hovercard__notice">{hoverCard.notice}</div>}
            </>
          )}
          {hoverCard.foot && <div className="hovercard__foot">{hoverCard.foot}</div>}
        </div>
      )}

      <div className="ov ov--bl">
        {/* Clave de la coropleta. Sin ella el mapa pinta territorios de colores
            que nadie puede leer: es el primer dato que hay que poder traducir. */}
        {choropleth.length > 0 && (
          <div className="legend legend--ramp">
            {/* La unidad va en su propia línea: algunas son una frase entera
                («píxeles-día detectados / píxeles-día válidos»), y pegarla al
                título estiraba la caja hasta ocupar medio mapa. */}
            <div className="legend__title">{METRIC_LABELS[metric]}</div>
            {metric === "conditions_classification" ? (
              <div className="legend__items legend__items--flush">
                {(["low", "moderate", "high", "partial"] as Classification[]).map((c) => (
                  <div className="legend__item" key={c}>
                    <i
                      className="legend__swatch"
                      style={{
                        background: cividisCss(
                          { not_evaluable: 0, partial: 0.2, low: 0.3, moderate: 0.62, high: 0.95 }[c]
                        ),
                      }}
                    />
                    <span>{CLASSIFICATION_LABELS[c] ?? c}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="legend__ramp">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} style={{ background: cividisCss(i / 9) }} />
                  ))}
                </div>
                <div className="legend__scale">
                  <span>{scale ? fmtShort(scale.lo) : "—"}</span>
                  <span>{scale ? fmtShort(scale.hi) : "—"}</span>
                </div>
                {metricUnit && <div className="legend__unit">{metricUnit}</div>}
              </>
            )}
            <div className="legend__item legend__item--nodata">
              <i className="legend__swatch" style={{ background: "#1b2a21" }} />
              <span>Sin datos publicados</span>
            </div>
          </div>
        )}

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
            {showWind && windDirDeg !== null && (
              <div className="legend__item" style={{ marginTop: 2 }}>
                <i
                  className="legend__swatch"
                  style={{
                    background: "transparent",
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderBottom: "9px solid var(--ember)",
                    width: 0,
                    height: 0,
                    transform: `rotate(${windDirDeg + 180}deg)`,
                  }}
                />
                <span>
                  Viento {windSpeedMs?.toFixed(1) ?? "—"} m/s · desde{" "}
                  {Math.round(windDirDeg)}°
                </span>
              </div>
            )}
            {spread && (
              <div className="legend__item">
                <i
                  className="legend__swatch"
                  style={{ background: "linear-gradient(90deg,#f3e55c,#e65c2f,#480f62)" }}
                />
                <span>Frente simulado · Fase 2 · +6/12/24 h</span>
              </div>
            )}
            {showHighMarkers && highMarkers.length > 0 && (
              <button
                type="button"
                className="legend__jump"
                onClick={() => {
                  const targets = highMarkers.filter((m) => m.targetTerritoryId);
                  if (targets.length === 0) {
                    onOpenSusceptibilityTree?.();
                    return;
                  }
                  const curIdx = targets.findIndex((m) => m.targetTerritoryId === selectedId);
                  const next = targets[(curIdx + 1) % targets.length];
                  onOpenSusceptibilityTree?.(next.targetTerritoryId, next.targetTerritoryType);
                }}
                title="Saltar al siguiente territorio o foco en susceptibilidad alta"
              >
                <span className="legend__tri" aria-hidden="true">▲!</span>
                <span>
                  {highMarkers.length} alerta{highMarkers.length === 1 ? "" : "s"} alta
                  {highMarkers.length === 1 ? "" : "s"} · Ir →
                </span>
              </button>
            )}
            {showHighMarkers && priorityZones.length > 0 && (
              <div className="legend__item legend__item--zone">
                <i className="legend__swatch legend__swatch--poly" />
                <span>Subzona / envolvente prioritaria</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
