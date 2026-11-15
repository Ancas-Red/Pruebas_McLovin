/**
 * Infografía de la simulación de propagación (Fase 2), generada en el
 * navegador a partir del resultado REAL de la corrida del usuario.
 *
 * Reemplaza a las imágenes precalculadas del servidor
 * (`/spread-outputs/infografia_impacto_48h.png`, `panel_modelo_48h.png`), que
 * siempre mostraban la misma zona fija sin importar dónde se simulara.
 *
 * - Sin mapa base de fondo: solo la grilla del modelo sobre un fondo neutro,
 *   así nada en la imagen sugiere un lugar distinto al simulado.
 * - Todas las ubicaciones se expresan en UTM (WGS84), en la zona del punto de
 *   ignición.
 */

import { inferno } from "./palette";
import { SPREAD_DISCLAIMER, SPREAD_MODEL_NAME, type SpreadResult } from "./spread";
import { formatUtm, toUtm } from "./utm";
import type { LatLon } from "./geo";

export interface ReportContext {
  result: SpreadResult;
  ignition: LatLon | null;
  horizonHours: number;
  windSpeedMs: number;
  windDirDeg: number;
  fuelMoisturePct: number;
  vegetationPct: number;
  slopeMeanDeg: number;
  locationLabel?: string;
  dateIso?: string;
}

const BG = "#0b1014";
const PANEL = "#111820";
const LINE = "#2a3540";
const TEXT = "#e6edf3";
const MUTED = "#8b98a5";
const ACCENT = "#d4ff3a";
const MONO = "13px 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace";

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Pinta una grilla del modelo (cols x rows) dentro de un rectángulo, píxel a píxel. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  x: number,
  y: number,
  w: number,
  h: number,
  colorAt: (i: number) => [number, number, number, number] | null
) {
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(cols, rows);
  for (let i = 0; i < cols * rows; i++) {
    const c = colorAt(i);
    const o = i * 4;
    if (!c) {
      img.data[o + 3] = 0;
      continue;
    }
    img.data[o] = c[0];
    img.data[o + 1] = c[1];
    img.data[o + 2] = c[2];
    img.data[o + 3] = c[3];
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, x, y, w, h);
  ctx.restore();
}

function panelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = MUTED;
  ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText(title.toUpperCase(), x + 12, y + 20);
}

function rampBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: (t: number) => [number, number, number],
  left: string,
  right: string
) {
  for (let i = 0; i < w; i++) {
    const [r, g, b] = ramp(i / (w - 1));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x + i, y, 1, h);
  }
  ctx.fillStyle = MUTED;
  ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText(left, x, y + h + 13);
  const rw = ctx.measureText(right).width;
  ctx.fillText(right, x + w - rw, y + h + 13);
}

const greenRamp = (t: number): [number, number, number] => [
  Math.round(30 + 40 * t),
  Math.round(40 + 150 * t),
  Math.round(35 + 50 * t),
];
const greyRamp = (t: number): [number, number, number] => {
  const v = Math.round(40 + 170 * t);
  return [v, v, Math.round(v * 1.05)];
};

/** Genera la infografía y devuelve un data URL PNG. */
export function renderSpreadReport(c: ReportContext): string {
  const { result } = c;
  const { cols, rows, arrival, fuel, elevation, bounds } = result;
  const W = 1600;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ---------------------------------------------------------------- cabecera
  ctx.fillStyle = ACCENT;
  ctx.font = "700 26px 'Space Grotesk', 'Inter', system-ui, sans-serif";
  ctx.fillText("McHanaq · Simulación de propagación de fuego", 40, 50);
  ctx.fillStyle = MUTED;
  ctx.font = MONO;
  const horizon = Math.round(c.horizonHours);
  ctx.fillText(
    `Fase 2 (exploratoria) · horizonte ${horizon} h · modelo ${SPREAD_MODEL_NAME}${c.dateIso ? ` · ${c.dateIso}` : ""}`,
    40,
    76
  );
  if (c.locationLabel) {
    ctx.fillStyle = TEXT;
    ctx.fillText(c.locationLabel.slice(0, 120), 40, 98);
  }

  // Zona UTM: la del punto de ignición (o el centro del dominio).
  const refLat = c.ignition?.[0] ?? (bounds.south + bounds.north) / 2;
  const refLon = c.ignition?.[1] ?? (bounds.west + bounds.east) / 2;
  const zone = toUtm(refLat, refLon).zone;
  const sw = toUtm(bounds.south, bounds.west, zone);
  const ne = toUtm(bounds.north, bounds.east, zone);
  const nw = toUtm(bounds.north, bounds.west, zone);
  const se = toUtm(bounds.south, bounds.east, zone);

  // ------------------------------------------------------ mapa principal
  const mapX = 40;
  const mapY = 125;
  const mapS = 800; // panel cuadrado
  panelFrame(ctx, mapX, mapY, mapS, mapS + 40, `Tiempo de llegada del frente · UTM zona ${zone}${sw.hemisphere}`);

  // área útil para la grilla (con márgenes para ejes)
  const gx = mapX + 90;
  const gy = mapY + 40;
  const gw = mapS - 120;
  const gh = mapS - 90;

  // fondo neutro (sin mapa base): el combustible del propio modelo en gris
  // tenue da contexto sin sugerir un lugar distinto.
  drawGrid(ctx, cols, rows, gx, gy, gw, gh, (i) => {
    const v = Math.max(0, Math.min(1, fuel[i]));
    const g = Math.round(22 + v * 30);
    return [g, g + 4, g + 6, 255];
  });
  // frente al horizonte, pixel a pixel
  drawGrid(ctx, cols, rows, gx, gy, gw, gh, (i) => {
    const t = arrival[i];
    if (!isFinite(t) || t > c.horizonHours) return null;
    const [r, g, b] = inferno(0.15 + 0.85 * (1 - t / Math.max(1, c.horizonHours)));
    return [r, g, b, 255];
  });
  ctx.strokeStyle = LINE;
  ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);

  // ejes UTM (km) — lineal dentro del dominio (~decenas de km, error despreciable)
  const eMin = Math.min(sw.easting, nw.easting);
  const eMax = Math.max(ne.easting, se.easting);
  const nMin = Math.min(sw.northing, se.northing);
  const nMax = Math.max(ne.northing, nw.northing);
  const spanKm = Math.max(eMax - eMin, nMax - nMin) / 1000;
  const stepM = spanKm > 40 ? 10000 : spanKm > 16 ? 5000 : spanKm > 6 ? 2000 : 1000;
  ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = MUTED;
  ctx.strokeStyle = "rgba(139,152,165,0.18)";
  for (let e = Math.ceil(eMin / stepM) * stepM; e <= eMax; e += stepM) {
    const px = gx + ((e - eMin) / (eMax - eMin)) * gw;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, gy);
    ctx.lineTo(px + 0.5, gy + gh);
    ctx.stroke();
    const label = `${(e / 1000).toFixed(0)}`;
    ctx.fillText(label, px - ctx.measureText(label).width / 2, gy + gh + 16);
  }
  for (let n = Math.ceil(nMin / stepM) * stepM; n <= nMax; n += stepM) {
    const py = gy + gh - ((n - nMin) / (nMax - nMin)) * gh;
    ctx.beginPath();
    ctx.moveTo(gx, py + 0.5);
    ctx.lineTo(gx + gw, py + 0.5);
    ctx.stroke();
    const label = `${(n / 1000).toFixed(0)}`;
    ctx.fillText(label, gx - 8 - ctx.measureText(label).width, py + 4);
  }
  ctx.fillStyle = TEXT;
  ctx.fillText("Este (km, UTM)", gx + gw / 2 - 45, gy + gh + 34);
  ctx.save();
  ctx.translate(mapX + 22, gy + gh / 2 + 50);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Norte (km, UTM)", 0, 0);
  ctx.restore();

  // punto de ignición
  if (c.ignition) {
    const ig = toUtm(c.ignition[0], c.ignition[1], zone);
    const px = gx + ((ig.easting - eMin) / (eMax - eMin)) * gw;
    const py = gy + gh - ((ig.northing - nMin) / (nMax - nMin)) * gh;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff4a24";
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  // norte + viento
  const nx = gx + gw - 34;
  const ny = gy + 40;
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 22);
  ctx.lineTo(nx - 8, ny);
  ctx.lineTo(nx + 8, ny);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 13px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText("N", nx - 4, ny + 16);

  rampBar(ctx, gx, mapY + mapS + 14, 260, 10, (t) => inferno(0.15 + 0.85 * (1 - t)), "0 h", `${horizon} h`);
  ctx.fillStyle = MUTED;
  ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText("llegada del frente (más claro = más temprano)", gx + 275, mapY + mapS + 23);

  // ---------------------------------------------------- paneles secundarios
  const sx = mapX + mapS + 30;
  const sw2 = W - sx - 40;
  const miniS = (sw2 - 20) / 2;
  panelFrame(ctx, sx, mapY, miniS, miniS + 30, "Combustible (modelo)");
  drawGrid(ctx, cols, rows, sx + 12, mapY + 30, miniS - 24, miniS - 24, (i) => {
    const [r, g, b] = greenRamp(Math.max(0, Math.min(1, fuel[i])));
    return [r, g, b, 255];
  });
  rampBar(ctx, sx + 12, mapY + miniS + 10, miniS - 24, 6, greenRamp, "0", "1");

  let eLo = Infinity;
  let eHi = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] < eLo) eLo = elevation[i];
    if (elevation[i] > eHi) eHi = elevation[i];
  }
  const ex = sx + miniS + 20;
  panelFrame(ctx, ex, mapY, miniS, miniS + 30, "Relieve (modelo)");
  drawGrid(ctx, cols, rows, ex + 12, mapY + 30, miniS - 24, miniS - 24, (i) => {
    const t = eHi > eLo ? (elevation[i] - eLo) / (eHi - eLo) : 0.5;
    const [r, g, b] = greyRamp(t);
    return [r, g, b, 255];
  });
  rampBar(ctx, ex + 12, mapY + miniS + 10, miniS - 24, 6, greyRamp, `${Math.round(eLo)} m`, `${Math.round(eHi)} m`);

  // -------------------------------------------------------------- métricas
  const my = mapY + miniS + 50;
  const mh = 290;
  panelFrame(ctx, sx, my, sw2, mh, "Resultado");
  const rowsTxt: [string, string][] = [
    ["Superficie alcanzada", `${result.totalAreaHa.toLocaleString("es-PE")} ha`],
    ["Avance de cabeza", `${result.headRosMMin.toFixed(1)} m/min`],
    ["Relación largo/ancho", `${result.lengthToBreadth.toFixed(2)} : 1`],
    ["Viento", `${c.windSpeedMs.toFixed(1)} m/s desde ${Math.round(c.windDirDeg)}° (${cardinal(c.windDirDeg)})`],
    ["Humedad combustible", `${c.fuelMoisturePct.toFixed(0)} %`],
    ["Vegetación combustible", `${c.vegetationPct.toFixed(0)} % · SAVI ${result.saviMean.toFixed(2)}`],
    ["Pendiente media", `${c.slopeMeanDeg.toFixed(0)}°`],
    ["Resolución / grilla", `${Math.round(result.cellSizeM)} m · ${cols} × ${rows}`],
  ];
  ctx.font = MONO;
  rowsTxt.forEach(([k, v], i) => {
    const yy = my + 48 + i * 24;
    ctx.fillStyle = MUTED;
    ctx.fillText(k, sx + 14, yy);
    ctx.fillStyle = TEXT;
    ctx.fillText(v, sx + sw2 - 14 - ctx.measureText(v).width, yy);
  });
  // isócronas
  const by = my + 48 + rowsTxt.length * 24 + 12;
  ctx.fillStyle = MUTED;
  ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText("ISÓCRONAS · SUPERFICIE ACUMULADA", sx + 14, by);
  ctx.font = MONO;
  const bandTxt = result.bands.map((b) => `${b.hours} h: ${b.areaHa} ha`).join("   ");
  ctx.fillStyle = TEXT;
  ctx.fillText(bandTxt.slice(0, 80), sx + 14, by + 22);

  // ---------------------------------------------------- coordenadas UTM
  const uy = my + mh + 16;
  const uh = mapY + mapS + 40 - uy;
  panelFrame(ctx, sx, uy, sw2, uh, `Coordenadas UTM (WGS84) · zona ${zone}${sw.hemisphere}`);
  const coords: [string, string][] = [];
  if (c.ignition) coords.push(["Ignición", formatUtm(toUtm(c.ignition[0], c.ignition[1], zone))]);
  coords.push(["Esquina NO", formatUtm(nw)]);
  coords.push(["Esquina SE", formatUtm(se)]);
  if (result.reachedBounds) {
    const rb = result.reachedBounds;
    const cy = (rb.south + rb.north) / 2;
    const cxx = (rb.west + rb.east) / 2;
    coords.push(["Centro del frente", formatUtm(toUtm(cy, cxx, zone))]);
  }
  ctx.font = MONO;
  coords.forEach(([k, v], i) => {
    const yy = uy + 46 + i * 24;
    ctx.fillStyle = MUTED;
    ctx.fillText(k, sx + 14, yy);
    ctx.fillStyle = TEXT;
    ctx.fillText(v, sx + sw2 - 14 - ctx.measureText(v).width, yy);
  });

  // --------------------------------------------------------------- pie
  ctx.fillStyle = "#ffb347";
  ctx.font = "12px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText(SPREAD_DISCLAIMER, 40, H - 22);

  return canvas.toDataURL("image/png");
}
