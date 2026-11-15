/** Utilidades geometricas. Todo en [lat, lon] salvo que se indique lo contrario. */

export type LatLon = [number, number];

/** Recuadro aproximado del Peru continental. */
export const PERU_BOUNDS: { south: number; west: number; north: number; east: number } = {
  south: -18.4,
  west: -81.4,
  north: -0.03,
  east: -68.6,
};

export const PERU_CENTER: LatLon = [-9.9, -75.0];

const R_EARTH_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Punto dentro de poligono por cruce de rayos. El borde cuenta como dentro. */
export function pointInRing(p: LatLon, ring: LatLon[]): boolean {
  if (ring.length < 3) return false;
  const [y, x] = p;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Area del poligono en kilometros cuadrados.
 * Proyeccion equirectangular local: suficiente para un area de interes de
 * hackathon, no para calculo catastral.
 */
export function ringAreaKm2(ring: LatLon[]): number {
  if (ring.length < 3) return 0;
  const latRef = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const kx = (Math.PI / 180) * R_EARTH_KM * Math.cos(toRad(latRef));
  const ky = (Math.PI / 180) * R_EARTH_KM;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1] * kx;
    const yi = ring[i][0] * ky;
    const xj = ring[j][1] * kx;
    const yj = ring[j][0] * ky;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}

export function ringBounds(ring: LatLon[]) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lon] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { south, west, north, east };
}

export function ringCentroid(ring: LatLon[]): LatLon {
  const lat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return [lat, lon];
}

/**
 * Centroide de un anillo en coordenadas GeoJSON.
 *
 * GeoJSON guarda `[lon, lat]` y el resto de la aplicación trabaja en
 * `[lat, lon]`, que es el orden de Leaflet. Invertir el par al entrar, en un
 * solo sitio, evita el error silencioso de pintar el Perú en medio del
 * Pacífico.
 */
export function polygonCentroid(ring: [number, number][]): LatLon {
  if (!ring.length) return PERU_CENTER;
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return [lat, lon];
}

/** Convierte un anillo GeoJSON (`[lon, lat]`) al orden de Leaflet. */
export function ringFromGeoJson(ring: [number, number][]): LatLon[] {
  return ring.map(([lon, lat]) => [lat, lon] as LatLon);
}

/** Distancia haversine en kilometros. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function insidePeru(p: LatLon): boolean {
  return (
    p[0] >= PERU_BOUNDS.south &&
    p[0] <= PERU_BOUNDS.north &&
    p[1] >= PERU_BOUNDS.west &&
    p[1] <= PERU_BOUNDS.east
  );
}

/** Rectangulo a partir de dos esquinas opuestas, en sentido horario. */
export function rectRing(a: LatLon, b: LatLon): LatLon[] {
  const south = Math.min(a[0], b[0]);
  const north = Math.max(a[0], b[0]);
  const west = Math.min(a[1], b[1]);
  const east = Math.max(a[1], b[1]);
  return [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
  ];
}

export function formatLatLon(p: LatLon, digits = 3): string {
  const ns = p[0] >= 0 ? "N" : "S";
  const ew = p[1] >= 0 ? "E" : "W";
  return `${Math.abs(p[0]).toFixed(digits)}°${ns} ${Math.abs(p[1]).toFixed(digits)}°${ew}`;
}

export interface GeoJsonPolygonLike {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

function toLatLonRing(ring: number[][]): LatLon[] {
  return ring.map(([lon, lat]) => [lat, lon] as LatLon);
}

/** Devuelve los anillos exteriores `[lat, lon]` de un Polygon o MultiPolygon GeoJSON. */
export function featureOuterRings(geom: GeoJsonPolygonLike): LatLon[][] {
  if (geom.type === "Polygon") {
    const coords = geom.coordinates as number[][][];
    return coords.length ? [toLatLonRing(coords[0])] : [];
  }
  const coords = geom.coordinates as number[][][][];
  return coords
    .filter((poly) => poly.length > 0 && poly[0].length >= 3)
    .map((poly) => toLatLonRing(poly[0]));
}

function pointInPolygonRings(p: LatLon, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(p, toLatLonRing(rings[0]))) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(p, toLatLonRing(rings[i]))) return false;
  }
  return true;
}

/** Comprueba si `[lat, lon]` cae dentro de una geometría GeoJSON Polygon/MultiPolygon. */
export function pointInFeature(p: LatLon, geom: GeoJsonPolygonLike): boolean {
  if (geom.type === "Polygon") return pointInPolygonRings(p, geom.coordinates as number[][][]);
  return (geom.coordinates as number[][][][]).some((poly) => pointInPolygonRings(p, poly));
}

/**
 * Punto interior representativo de un territorio para anclar marcadores de alerta.
 * Garantiza caer dentro del anillo mayor cuando la forma es cóncava.
 */
export function featureCentroid(geom: GeoJsonPolygonLike): LatLon {
  const parts =
    geom.type === "Polygon"
      ? [geom.coordinates as number[][][]]
      : (geom.coordinates as number[][][][]);
  let bestRing: LatLon[] = [];
  let bestArea = -1;
  for (const part of parts) {
    if (!part.length || part[0].length < 3) continue;
    const outer = toLatLonRing(part[0]);
    const area = ringAreaKm2(outer);
    if (area > bestArea) {
      bestArea = area;
      bestRing = outer;
    }
  }
  if (!bestRing.length) return PERU_CENTER;

  const avg = ringCentroid(bestRing);
  if (pointInRing(avg, bestRing)) return avg;

  // Fallback para geometrías muy cóncavas: punto medio de la cuerda horizontal central.
  const b = ringBounds(bestRing);
  const midLat = (b.south + b.north) / 2;
  const xs: number[] = [];
  for (let i = 0, j = bestRing.length - 1; i < bestRing.length; j = i++) {
    const [y1, x1] = bestRing[i];
    const [y2, x2] = bestRing[j];
    if (y1 > midLat !== y2 > midLat) {
      xs.push(((x2 - x1) * (midLat - y1)) / (y2 - y1) + x1);
    }
  }
  xs.sort((a, c) => a - c);
  if (xs.length >= 2) return [midLat, (xs[0] + xs[1]) / 2];
  return avg;
}

/** Convex hull (Monotone Chain) en `[lat, lon]`. */
export function convexHullLatLon(points: LatLon[]): LatLon[] {
  const unique: LatLon[] = [];
  const seen = new Set<string>();
  for (const [lat, lon] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([lat, lon]);
    }
  }
  if (unique.length <= 2) return unique;

  // Ordenar por X = lon, luego Y = lat
  const pts = [...unique].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: LatLon, a: LatLon, b: LatLon) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);

  const lower: LatLon[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LatLon[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function offsetLatLon(center: LatLon, dNorthKm: number, dEastKm: number): LatLon {
  const latDeg = dNorthKm / 110.574;
  const lonScale = 111.32 * Math.max(0.2, Math.cos(toRad(center[0])));
  const lonDeg = dEastKm / lonScale;
  return [center[0] + latDeg, center[1] + lonDeg];
}

/**
 * Genera el polígono envolvente expandido `padKm` alrededor de uno o varios focos
 * para delimitar visualmente subzonas de monitoreo prioritario.
 */
export function enclosurePolygonLatLon(points: LatLon[], padKm = 4): LatLon[] {
  const hull = convexHullLatLon(points);
  if (hull.length === 0) return [];

  if (hull.length === 1) {
    const c = hull[0];
    const ring: LatLon[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      ring.push(offsetLatLon(c, Math.sin(a) * padKm, Math.cos(a) * padKm));
    }
    return ring;
  }

  if (hull.length === 2) {
    const [a, b] = hull;
    const dLat = b[0] - a[0];
    const dLon = b[1] - a[1];
    const cosLat = Math.max(0.2, Math.cos(toRad((a[0] + b[0]) / 2)));
    const dyKm = dLat * 110.574;
    const dxKm = dLon * 111.32 * cosLat;
    const len = Math.hypot(dxKm, dyKm) || 1;
    const ux = dxKm / len;
    const uy = dyKm / len;
    const ring: LatLon[] = [];
    // Cápsula alrededor del segmento [a, b]
    const theta = Math.atan2(uy, ux);
    for (let i = 0; i <= 6; i++) {
      const ang = theta + Math.PI / 2 + (i / 6) * Math.PI;
      ring.push(offsetLatLon(a, Math.sin(ang) * padKm, Math.cos(ang) * padKm));
    }
    for (let i = 0; i <= 6; i++) {
      const ang = theta - Math.PI / 2 + (i / 6) * Math.PI;
      ring.push(offsetLatLon(b, Math.sin(ang) * padKm, Math.cos(ang) * padKm));
    }
    return ring;
  }

  const c = ringCentroid(hull);
  return hull.map((pt) => {
    const dyKm = (pt[0] - c[0]) * 110.574;
    const dxKm = (pt[1] - c[1]) * 111.32 * Math.max(0.2, Math.cos(toRad(c[0])));
    const d = Math.hypot(dxKm, dyKm) || 1;
    return offsetLatLon(pt, (dyKm / d) * padKm, (dxKm / d) * padKm);
  });
}

export interface PriorityCluster {
  ring: LatLon[];
  center: LatLon;
  count: number;
}

/**
 * Agrupa puntos cercanos dentro de una región macro para trazar polígonos envolventes
 * diferenciados cuando existen focos dispersos y evitar envolventes gigantes ambiguas.
 */
export function clusterHotspotsIntoEnclosures(
  points: LatLon[],
  clusterRadiusKm = 28,
  padKm = 4
): PriorityCluster[] {
  if (!points.length) return [];
  const step = Math.max(1, Math.ceil(points.length / 180));
  const sample = step === 1 ? points : points.filter((_, idx) => idx % step === 0);

  const visited = new Uint8Array(sample.length);
  const clusters: PriorityCluster[] = [];

  for (let i = 0; i < sample.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const queue = [i];
    const group: LatLon[] = [];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      group.push(sample[cur]);
      for (let j = 0; j < sample.length; j++) {
        if (!visited[j] && distanceKm(sample[cur], sample[j]) <= clusterRadiusKm) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }
    const ring = enclosurePolygonLatLon(group, padKm);
    if (ring.length >= 3) {
      clusters.push({
        ring,
        center: ringCentroid(group),
        count: group.length * step,
      });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters.slice(0, 6);
}
