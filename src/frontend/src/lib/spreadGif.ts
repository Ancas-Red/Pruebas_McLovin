/**
 * GIF animado de la simulación de propagación ACTUAL, generado en el navegador.
 *
 * Usa la grilla real de la corrida (`arrival`, `fuel`, `elevation`) y el recuadro
 * `bounds` en torno al punto de ignición, así que siempre cuadra con lo que el
 * usuario ve en el mapa; nunca es un archivo precalculado de otra zona.
 */

import { encodeGif, type GifFrame } from "./gif";
import { inferno } from "./palette";
import type { LatLon } from "./geo";
import type { SpreadResult } from "./spread";

// Paleta indexada: 0-63 terreno, 64-127 frente (inferno), resto = marcas.
const TERRAIN0 = 0;
const FRONT0 = 64;
const IDX_IGN = 128;
const IDX_RING = 129;
const IDX_BAR_BG = 130;
const IDX_BAR = 131;
const IDX_TEXT = 132;
const IDX_BG = 133;

function buildPalette(): Uint8Array {
  const pal = new Uint8Array(768);
  const set = (i: number, r: number, g: number, b: number) => {
    pal[i * 3] = r;
    pal[i * 3 + 1] = g;
    pal[i * 3 + 2] = b;
  };
  for (let i = 0; i < 64; i++) set(TERRAIN0 + i, 14 + i * 0.7, 22 + i * 2.0, 18 + i * 0.9);
  for (let j = 0; j < 64; j++) {
    const [r, g, b] = inferno(j / 63);
    set(FRONT0 + j, r, g, b);
  }
  set(IDX_IGN, 255, 255, 255);
  set(IDX_RING, 220, 38, 38);
  set(IDX_BAR_BG, 42, 53, 64);
  set(IDX_BAR, 212, 255, 58);
  set(IDX_TEXT, 230, 237, 243);
  set(IDX_BG, 11, 16, 20);
  return pal;
}

// Fuente 3x5 mínima para «t = NN h».
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  t: ["010", "111", "010", "010", "011"],
  h: ["100", "100", "111", "101", "101"],
  "=": ["000", "111", "000", "111", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

function drawText(
  px: Uint8Array,
  width: number,
  height: number,
  text: string,
  x0: number,
  y0: number,
  scale: number,
  idx: number
) {
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r][c] !== "1") continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const xx = x + c * scale + dx;
              const yy = y0 + r * scale + dy;
              if (xx >= 0 && xx < width && yy >= 0 && yy < height) px[yy * width + xx] = idx;
            }
          }
        }
      }
    }
    x += 4 * scale;
  }
}

export interface SpreadGif {
  blob: Blob;
  width: number;
  height: number;
  frames: number;
}

/**
 * Genera el GIF 1 cuadro por hora hasta `horizonHours`. Cede el hilo entre
 * cuadros para no congelar la interfaz.
 */
export async function renderSpreadGif(
  result: SpreadResult,
  ignition: LatLon | null,
  horizonHours: number,
  onProgress?: (done: number, total: number) => void
): Promise<SpreadGif> {
  const { cols, rows, arrival, fuel, elevation, bounds } = result;
  const scale = Math.max(3, Math.min(10, Math.floor(480 / Math.max(cols, rows))));
  const mapW = cols * scale;
  const mapH = rows * scale;
  const barH = 16;
  const width = mapW;
  const height = mapH + barH;
  const total = Math.max(1, Math.min(48, Math.round(horizonHours)));

  // Terreno base (relieve sombreado + combustible), común a todos los cuadros.
  let eMin = Infinity;
  let eMax = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] < eMin) eMin = elevation[i];
    if (elevation[i] > eMax) eMax = elevation[i];
  }
  const eSpan = Math.max(1, eMax - eMin);
  const terrain = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const f = Math.max(0, Math.min(1, fuel[i]));
    const e = (elevation[i] - eMin) / eSpan;
    const level = f <= 0 ? 4 + e * 10 : 14 + f * 34 + e * 14;
    terrain[i] = TERRAIN0 + Math.max(0, Math.min(63, Math.round(level)));
  }

  // Celda de la ignición dentro de la grilla.
  let igC = -1;
  let igR = -1;
  if (ignition) {
    igC = Math.floor(((ignition[1] - bounds.west) / (bounds.east - bounds.west)) * cols);
    igR = Math.floor(((bounds.north - ignition[0]) / (bounds.north - bounds.south)) * rows);
    if (igC < 0 || igC >= cols || igR < 0 || igR >= rows) {
      igC = -1;
      igR = -1;
    }
  }

  const frames: GifFrame[] = [];
  for (let h = 1; h <= total; h++) {
    const tHours = (h / total) * horizonHours;
    const px = new Uint8Array(width * height);
    px.fill(IDX_BG);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const t = arrival[i];
        let idx = terrain[i];
        if (isFinite(t) && t <= tHours) {
          const age = Math.min(1, ((tHours - t) / Math.max(0.5, horizonHours)) * 0.92);
          const level = Math.max(0.22, 1 - age);
          idx = FRONT0 + Math.round(level * 63);
        }
        const x0 = c * scale;
        const y0 = r * scale;
        for (let dy = 0; dy < scale; dy++) {
          const row = (y0 + dy) * width + x0;
          px.fill(idx, row, row + scale);
        }
      }
    }

    // Marca de ignición.
    if (igC >= 0) {
      const cx = Math.round((igC + 0.5) * scale);
      const cy = Math.round((igR + 0.5) * scale);
      const rad = Math.max(3, Math.round(scale * 0.9));
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const d2 = dx * dx + dy * dy;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= width || y < 0 || y >= mapH) continue;
          if (d2 <= (rad - 2) * (rad - 2)) px[y * width + x] = IDX_IGN;
          else if (d2 <= rad * rad) px[y * width + x] = IDX_RING;
        }
      }
    }

    // Barra de progreso y hora.
    for (let y = mapH; y < height; y++) px.fill(IDX_BAR_BG, y * width, (y + 1) * width);
    const fillW = Math.round((h / total) * width);
    for (let y = mapH + 12; y < height; y++) px.fill(IDX_BAR, y * width, y * width + fillW);
    drawText(px, width, height, `t = ${Math.round(tHours)} h`, 4, mapH + 3, 1, IDX_TEXT);

    frames.push({ pixels: px, delayCs: h === total ? 180 : 14 });
    onProgress?.(h, total);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const bytes = encodeGif(width, height, buildPalette(), frames);
  // Copia a un ArrayBuffer propio para que Blob acepte el tipo sin ambigüedad.
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return { blob: new Blob([buf], { type: "image/gif" }), width, height, frames: frames.length };
}
