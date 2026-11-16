/**
 * GIF animado de la simulación de propagación ACTUAL, generado en el navegador.
 *
 * Usa la grilla real de la corrida (`arrival`, `fuel`, `elevation`) y el recuadro
 * `bounds` en torno al punto de ignición, así que siempre cuadra con lo que el
 * usuario ve en el mapa; nunca es un archivo precalculado de otra zona.
 *
 * El terreno de fondo se cuantiza a partir de la foto satelital REAL del lugar
 * (Esri World Imagery, recortada a `bounds`) a un cubo RGB fijo de 64 colores
 * (la paleta indexada de un GIF exige un máximo de 256 colores en total); si
 * la red falla, se cae al sombreado sintético de fuel/elevación de siempre,
 * nunca a una imagen de otro lugar.
 */

import { SATELLITE_TILES, stitchBasemap } from "./basemap";
import { encodeGif, type GifFrame } from "./gif";
import { inferno } from "./palette";
import type { LatLon } from "./geo";
import type { SpreadResult } from "./spread";

// Paleta indexada: 0-63 terreno (cubo RGB real), 64-127 frente (inferno), resto = marcas.
const TERRAIN0 = 0;
const FRONT0 = 64;
const IDX_IGN = 128;
const IDX_RING = 129;
const IDX_BAR_BG = 130;
const IDX_BAR = 131;
const IDX_TEXT = 132;
const IDX_BG = 133;
const IDX_WIND = 134;

// Cubo RGB de 4 niveles por canal = 64 colores: cuantiza cualquier color real
// (foto satelital o sombreado sintético de respaldo) a un índice fijo.
const CUBE_LEVELS = [0, 85, 170, 255];
function cubeIndex(r: number, g: number, b: number): number {
  const q = (v: number) => Math.max(0, Math.min(3, Math.round((v / 255) * 3)));
  return TERRAIN0 + q(r) * 16 + q(g) * 4 + q(b);
}

function buildPalette(): Uint8Array {
  const pal = new Uint8Array(768);
  const set = (i: number, r: number, g: number, b: number) => {
    pal[i * 3] = r;
    pal[i * 3 + 1] = g;
    pal[i * 3 + 2] = b;
  };
  for (let ri = 0; ri < 4; ri++) {
    for (let gi = 0; gi < 4; gi++) {
      for (let bi = 0; bi < 4; bi++) {
        set(TERRAIN0 + ri * 16 + gi * 4 + bi, CUBE_LEVELS[ri], CUBE_LEVELS[gi], CUBE_LEVELS[bi]);
      }
    }
  }
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
  set(IDX_WIND, 212, 255, 58);
  return pal;
}

/** Línea con punta de flecha dibujada directamente en el buffer indexado. */
function drawArrow(
  px: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  bearingDeg: number,
  length: number,
  idx: number
) {
  const rad = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const plot = (x: number, y: number) => {
    for (let ddy = -1; ddy <= 1; ddy++) {
      for (let ddx = -1; ddx <= 1; ddx++) {
        const xx = Math.round(x + ddx);
        const yy = Math.round(y + ddy);
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        px[yy * width + xx] = idx;
      }
    }
  };
  const steps = Math.ceil(length);
  for (let s = 0; s <= steps; s++) plot(cx + dx * s, cy + dy * s);
  const tipX = cx + dx * steps;
  const tipY = cy + dy * steps;
  const headLen = Math.max(4, length * 0.3);
  for (const sign of [1, -1]) {
    const hRad = rad + sign * ((Math.PI * 3) / 4);
    const hdx = Math.sin(hRad);
    const hdy = -Math.cos(hRad);
    for (let s = 0; s <= headLen; s++) plot(tipX + hdx * s, tipY + hdy * s);
  }
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
  windDirDeg = 0,
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

  // Terreno base: foto satelital REAL del lugar (recortada a `bounds`,
  // exactamente un píxel por celda), cuantizada al cubo de 64 colores. Si la
  // red falla, se cae al sombreado sintético de fuel/elevación de siempre.
  let eMin = Infinity;
  let eMax = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] < eMin) eMin = elevation[i];
    if (elevation[i] > eMax) eMax = elevation[i];
  }
  const eSpan = Math.max(1, eMax - eMin);
  const syntheticRGB = (i: number): [number, number, number] => {
    const f = Math.max(0, Math.min(1, fuel[i]));
    const e = (elevation[i] - eMin) / eSpan;
    const level = f <= 0 ? 4 + e * 10 : 14 + f * 34 + e * 14;
    const g = Math.max(0, Math.min(63, Math.round(level)));
    return [14 + g * 0.7, 22 + g * 2.0, 18 + g * 0.9];
  };
  const satBasemap = await stitchBasemap(bounds, cols, rows, SATELLITE_TILES).catch(() => null);
  let satPixels: Uint8ClampedArray | null = null;
  if (satBasemap) {
    const sctx = satBasemap.canvas.getContext("2d");
    try {
      satPixels = sctx?.getImageData(0, 0, cols, rows).data ?? null;
    } catch {
      satPixels = null;
    }
  }
  const terrain = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    if (satPixels) {
      const o = i * 4;
      // Un poco oscurecido para que el frente de fuego resalte encima.
      terrain[i] = cubeIndex(satPixels[o] * 0.6, satPixels[o + 1] * 0.6, satPixels[o + 2] * 0.6);
    } else {
      const [r, g, b] = syntheticRGB(i);
      terrain[i] = cubeIndex(r, g, b);
    }
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

    // Flecha de viento (apunta hacia donde avanza; windDirDeg es "desde").
    const arrowLen = Math.max(10, Math.round(Math.min(mapW, mapH) * 0.16));
    drawArrow(px, width, height, mapW - arrowLen - 6, arrowLen + 6, windDirDeg + 180, arrowLen, IDX_WIND);

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
