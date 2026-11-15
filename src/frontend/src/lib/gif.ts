/**
 * Codificador GIF89a mínimo (paleta global de 256 colores, animación en bucle).
 * Sin dependencias: se usa para generar en el navegador el GIF de la
 * simulación ACTUAL, en vez de depender de un archivo precalculado del servidor.
 */

/** LZW de GIF con códigos de ancho variable (mínimo 8 bits). Devuelve los bytes sin sub-bloques. */
function lzwEncode(indices: Uint8Array): number[] {
  const minCode = 8;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out: number[] = [];
  let bitBuf = 0;
  let bitCnt = 0;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();

  const emit = (code: number) => {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };
  // Tras emitir un código, el decodificador ya tiene `next` entradas: si se
  // llenó el ancho actual, el siguiente código usa un bit más.
  const growIfNeeded = () => {
    if (next === 1 << codeSize && codeSize < 12) codeSize++;
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    growIfNeeded();
    if (next < 4096) {
      dict.set(key, next++);
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  growIfNeeded();
  emit(eoi);
  if (bitCnt > 0) out.push(bitBuf & 0xff);
  return out;
}

export interface GifFrame {
  /** Índices de paleta, `width * height`. */
  pixels: Uint8Array;
  /** Duración del cuadro en centésimas de segundo. */
  delayCs: number;
}

/** `palette`: 768 bytes (256 colores RGB). */
export function encodeGif(
  width: number,
  height: number,
  palette: Uint8Array,
  frames: GifFrame[]
): Uint8Array {
  const bytes: number[] = [];
  const u16 = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };

  str("GIF89a");
  u16(width);
  u16(height);
  bytes.push(0xf7, 0, 0); // tabla global de 256 colores
  for (let i = 0; i < 768; i++) bytes.push(palette[i] ?? 0);
  // Bucle infinito
  bytes.push(0x21, 0xff, 0x0b);
  str("NETSCAPE2.0");
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const f of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    u16(f.delayCs);
    bytes.push(0x00, 0x00);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0x00);
    bytes.push(8);
    const data = lzwEncode(f.pixels);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      bytes.push(n);
      for (let j = 0; j < n; j++) bytes.push(data[i + j]);
    }
    bytes.push(0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
