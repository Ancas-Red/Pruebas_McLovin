/**
 * Mosaico de teselas reales (satélite/relieve) para un recuadro `bounds` dado,
 * usado por `spreadReport.ts` y `spreadGif.ts` para que el fondo del GIF y la
 * infografía de propagación sea la imagen/relieve REAL del lugar simulado (no
 * un fondo neutro genérico que se vería igual en cualquier zona).
 *
 * Mismas teselas sin clave de API que ya usa el mapa principal (`MapStage.tsx`
 * → BASE_LAYERS): OpenTopoMap para relieve y Esri World Imagery para satélite.
 * Si la red falla (o el navegador tiñe el canvas), se devuelve `ok:false` y
 * quien llama debe caer al fondo neutro anterior — nunca se inventa ni se
 * reutiliza una tesela de otro lugar («que no alucine»).
 */

export interface TileSource {
  /** Plantilla XYZ. Puede traer `{s}` (subdominio) y siempre `{z}/{x}/{y}`. */
  urlTemplate: string;
  subdomains?: string[];
  maxZoom: number;
}

// Mismas fuentes que MapStage.tsx (BASE_LAYERS.relief / BASE_LAYERS.satellite).
export const RELIEF_TILES: TileSource = {
  urlTemplate: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  subdomains: ["a", "b", "c"],
  maxZoom: 17,
};
export const SATELLITE_TILES: TileSource = {
  // Nótese y/x invertidos: así los sirve ArcGIS REST, igual que en MapStage.tsx.
  urlTemplate: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 18,
};

export interface LonLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const TILE_SIZE = 256;

function lon2x(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2y(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/** Mejor nivel de zoom para que `bounds` cubra aproximadamente `pxSize` px. */
function pickZoom(bounds: LonLatBounds, pxWidth: number, pxHeight: number, maxZoom: number): number {
  for (let z = maxZoom; z >= 0; z--) {
    const x0 = lon2x(bounds.west, z);
    const x1 = lon2x(bounds.east, z);
    const y0 = lat2y(bounds.north, z);
    const y1 = lat2y(bounds.south, z);
    const w = Math.abs(x1 - x0) * TILE_SIZE;
    const h = Math.abs(y1 - y0) * TILE_SIZE;
    if (w >= pxWidth * 0.9 && h >= pxHeight * 0.9) return z;
  }
  return 1;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

export interface Basemap {
  /** Canvas recortado exactamente a `bounds`, tamaño `pxWidth`x`pxHeight`. */
  canvas: HTMLCanvasElement;
  ok: true;
}

/**
 * Arma un mosaico recortado exactamente a `bounds` (sin franjas de teselas
 * vecinas), en un canvas de `pxWidth`x`pxHeight`. Si no se pudo cargar
 * ninguna tesela, devuelve `null` (nunca una imagen a medias de otro lugar).
 */
export async function stitchBasemap(
  bounds: LonLatBounds,
  pxWidth: number,
  pxHeight: number,
  source: TileSource
): Promise<Basemap | null> {
  try {
    return await stitchBasemapInner(bounds, pxWidth, pxHeight, source);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[basemap] stitchBasemap failed", { bounds, pxWidth, pxHeight, source: source.urlTemplate, err });
    return null;
  }
}

async function stitchBasemapInner(
  bounds: LonLatBounds,
  pxWidth: number,
  pxHeight: number,
  source: TileSource
): Promise<Basemap | null> {
  if (!(pxWidth > 0) || !(pxHeight > 0)) return null;
  const z = pickZoom(bounds, pxWidth, pxHeight, source.maxZoom);
  // eslint-disable-next-line no-console
  console.log("[basemap] bounds", bounds, "z", z);
  const xMinF = lon2x(bounds.west, z);
  const xMaxF = lon2x(bounds.east, z);
  const yMinF = lat2y(bounds.north, z); // norte → y menor
  const yMaxF = lat2y(bounds.south, z);

  const xTileMin = Math.floor(xMinF);
  const xTileMax = Math.floor(xMaxF);
  const yTileMin = Math.floor(yMinF);
  const yTileMax = Math.floor(yMaxF);
  const nTiles = 2 ** z;

  const mosaicW = (xTileMax - xTileMin + 1) * TILE_SIZE;
  const mosaicH = (yTileMax - yTileMin + 1) * TILE_SIZE;
  if (mosaicW <= 0 || mosaicH <= 0 || mosaicW > 4096 || mosaicH > 4096) return null;

  const mosaic = document.createElement("canvas");
  mosaic.width = mosaicW;
  mosaic.height = mosaicH;
  const mctx = mosaic.getContext("2d");
  if (!mctx) return null;

  let loaded = 0;
  let attempted = 0;
  const subdomains = source.subdomains ?? [""];
  const jobs: Promise<void>[] = [];
  for (let ty = yTileMin; ty <= yTileMax; ty++) {
    for (let tx = xTileMin; tx <= xTileMax; tx++) {
      const wrappedX = ((tx % nTiles) + nTiles) % nTiles;
      if (ty < 0 || ty >= nTiles) continue;
      attempted++;
      const s = subdomains[(tx + ty) % subdomains.length];
      const url = source.urlTemplate
        .replace("{s}", s)
        .replace("{z}", String(z))
        .replace("{x}", String(wrappedX))
        .replace("{y}", String(ty));
      jobs.push(
        loadImage(url).then((img) => {
          if (!img) return;
          loaded++;
          mctx.drawImage(img, (tx - xTileMin) * TILE_SIZE, (ty - yTileMin) * TILE_SIZE);
        })
      );
    }
  }
  await Promise.all(jobs);
  // eslint-disable-next-line no-console
  console.log("[basemap] attempted", attempted, "loaded", loaded, "mosaic", mosaicW, mosaicH);
  // Si se perdió más de un tercio de las teselas, mejor no mostrar un mosaico
  // con huecos que podrían confundirse con el lugar real.
  if (attempted === 0 || loaded < attempted * 0.67) return null;

  // Recorte exacto a bounds dentro del mosaico.
  const srcX = (xMinF - xTileMin) * TILE_SIZE;
  const srcY = (yMinF - yTileMin) * TILE_SIZE;
  const srcW = (xMaxF - xMinF) * TILE_SIZE;
  const srcH = (yMaxF - yMinF) * TILE_SIZE;
  if (!(srcW > 0) || !(srcH > 0)) return null;

  const out = document.createElement("canvas");
  out.width = pxWidth;
  out.height = pxHeight;
  const octx = out.getContext("2d");
  if (!octx) return null;
  try {
    octx.drawImage(mosaic, srcX, srcY, srcW, srcH, 0, 0, pxWidth, pxHeight);
    // Fuerza la lectura de píxeles ahora: si alguna tesela tiñó el canvas
    // (CORS), esto tira SecurityError y se cae al fondo neutro del llamador.
    octx.getImageData(0, 0, 1, 1);
  } catch {
    return null;
  }
  return { canvas: out, ok: true };
}
