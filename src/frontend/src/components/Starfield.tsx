import { useEffect, useRef } from "react";
import { createStars, drawStars, type Star } from "../lib/starfield";

/** Fondo estelar puro en `#000` reutilizando la misma lógica que la portada. */
export function Starfield() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      stars = createStars(w, h);
      if (reduced) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawStars(ctx, stars, w, h, 0, 0);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    if (reduced) {
      return () => ro.disconnect();
    }

    let raf = 0;
    let running = true;
    let prevT = 0;
    let elapsed = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - (prevT || now)) / 1000);
      prevT = now;
      elapsed += dt;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawStars(ctx, stars, w, h, dt, elapsed);

      if (running) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        prevT = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="starfield" ref={hostRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
