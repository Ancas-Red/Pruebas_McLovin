/**
 * Conversion geografica WGS84 (lat, lon) -> UTM (zona, hemisferio, E, N).
 *
 * Serie de Krüger (la misma que usan PROJ/GDAL para Transverse Mercator),
 * precision submetrica dentro de la zona. Peru cae en las zonas 17S, 18S y 19S.
 */

const A = 6378137.0; // semieje mayor WGS84
const F = 1 / 298.257223563; // achatamiento WGS84
const K0 = 0.9996;
const E0 = 500000; // falso este
const N0_SOUTH = 10000000; // falso norte hemisferio sur

export interface Utm {
  zone: number;
  hemisphere: "N" | "S";
  easting: number;
  northing: number;
}

export function utmZone(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

/** Convierte a UTM. Si se pasa `forceZone`, proyecta en esa zona (util para
 *  que todas las esquinas de un mismo recuadro queden en la misma zona). */
export function toUtm(lat: number, lon: number, forceZone?: number): Utm {
  const zone = forceZone ?? utmZone(lon);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const lam = lon * (Math.PI / 180);

  const n = F / (2 - F);
  const n2 = n * n;
  const n3 = n2 * n;
  const aBar = (A / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
  const alpha = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3,
    (13 / 48) * n2 - (3 / 5) * n3,
    (61 / 240) * n3,
  ];

  const e = Math.sqrt(F * (2 - F));
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - e * Math.atanh(e * sinPhi));
  const dLam = lam - lon0;
  const xiP = Math.atan2(t, Math.cos(dLam));
  const etaP = Math.atanh(Math.sin(dLam) / Math.sqrt(1 + t * t));

  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 3; j++) {
    xi += alpha[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += alpha[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }

  const easting = E0 + K0 * aBar * eta;
  let northing = K0 * aBar * xi;
  const hemisphere: "N" | "S" = lat < 0 ? "S" : "N";
  if (hemisphere === "S") northing += N0_SOUTH;
  return { zone, hemisphere, easting, northing };
}

/** "18S 512 345 E · 9 087 654 N" */
export function formatUtm(u: Utm): string {
  const fmt = (v: number) => Math.round(v).toLocaleString("es-PE").replace(/,/g, " ");
  return `${u.zone}${u.hemisphere} ${fmt(u.easting)} E · ${fmt(u.northing)} N`;
}
