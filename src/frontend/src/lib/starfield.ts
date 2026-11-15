/** Campo de estrellas compartido entre el globo de portada y el fondo de tecnología. */

export const STAR_COUNT = 700;

export interface Star {
  x: number;
  y: number;
  z: number;
  r: number;
  tw: number;
}

export function createStars(width: number, height: number, count = STAR_COUNT): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      z: 0.25 + Math.random() * 0.75,
      r: Math.random() < 0.82 ? 0.7 : 1.5,
      tw: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

export function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  width: number,
  height: number,
  dt: number,
  elapsed: number
): void {
  for (const s of stars) {
    s.x -= dt * 2.6 * s.z;
    if (s.x < -2) {
      s.x = width + 2;
      s.y = Math.random() * height;
    }
    const tw = 0.42 + 0.58 * Math.sin(elapsed * 1.5 * s.z + s.tw);
    ctx.globalAlpha = Math.min(1, 0.95 * s.z * tw);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    // Destello en las más brillantes.
    if (s.r > 1 && tw > 0.82) {
      ctx.globalAlpha = (tw - 0.82) * 1.6 * s.z;
      ctx.fillRect(s.x - s.r * 3.4, s.y - 0.4, s.r * 6.8, 0.8);
      ctx.fillRect(s.x - 0.4, s.y - s.r * 3.4, 0.8, s.r * 6.8);
    }
  }
  ctx.globalAlpha = 1;
}
