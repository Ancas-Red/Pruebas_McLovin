import { useEffect, useRef } from "react";
import { LAND, PERU_MARK, PULSE_POINTS, WATER } from "../data/landmask";
import { drawMcTropicAdrift } from "../lib/drawMcTropicAdrift";
import { createStars, drawStars, type Star } from "../lib/starfield";

/**
 * Fondo de la portada: un planeta sobre campo de estrellas.
 *
 * El dibujo es una esfera de verdad, no un disco con textura. Cada punto vive
 * en coordenadas de esfera, se rota al punto de vista y se sombrea contra una
 * dirección de sol fija: de ahí salen el volumen, el terminador —la frontera
 * entre día y noche— y el borde iluminado. En la cara nocturna quedan encendidas
 * las luces de ciudad, que es lo que termina de leerse como un planeta visto
 * desde órbita y no como un círculo de puntos.
 *
 * Se arrastra con el ratón o el dedo y conserva inercia. Los pulsos cálidos son
 * adorno —no son detecciones de nuestro conjunto de datos— y brillan más sobre
 * la cara oscura, como se ven de noche los incendios reales desde un satélite.
 * Respeta `prefers-reduced-motion` y se detiene con la pestaña oculta.
 */

interface Props {
  /** Posición horizontal del centro del globo, 0 a 1. */
  anchorX?: number;
  /** Cuando pasa a false (al entrar en la sección de equipo), atenúa las luces del planeta. */
  lightsActive?: boolean;
}

const POINTS = 22000;
const LIGHT_LEVELS = 24;
/** Resolución de la máscara de tierra, en grados por píxel ÷ 2. */
const MASK_W = 720;
const MASK_H = 360;

/** Dirección del sol en coordenadas de cámara, ya normalizada. */
const SUN = (() => {
  const v = [-0.78, 0.26, 0.38];
  const n = Math.hypot(v[0], v[1], v[2]);
  return { x: v[0] / n, y: v[1] / n, z: v[2] / n };
})();

type Orbit = { inc: number; roll: number; rr: number; sp: number };

const ORBITS: Orbit[] = [
  { inc: 1.05, roll: -0.55, rr: 1.3, sp: 0.5 },
  { inc: 0.55, roll: 0.75, rr: 1.19, sp: 0 },
  { inc: 1.3, roll: 1.9, rr: 1.4, sp: 0 },
];

/**
 * Rampa de un material: del tono en sombra al tono a pleno sol.
 *
 * Se precalcula porque componer la cadena `rgba(...)` para cada punto y cada
 * cuadro —trece mil veces, sesenta veces por segundo— cuesta más que el
 * dibujo en sí.
 */
function ramp(dark: [number, number, number], lit: [number, number, number]): string[] {
  const out: string[] = [];
  for (let k = 0; k < LIGHT_LEVELS; k++) {
    const t = k / (LIGHT_LEVELS - 1);
    const r = Math.round(dark[0] + (lit[0] - dark[0]) * t);
    const g = Math.round(dark[1] + (lit[1] - dark[1]) * t);
    const b = Math.round(dark[2] + (lit[2] - dark[2]) * t);
    out.push(`rgb(${r},${g},${b})`);
  }
  return out;
}

/* Tierra y mar en tonos terrestres: la vegetación tira a verde oliva, como el
   resto del sitio, y el océano a azul profundo. */
const LAND_PAL = ramp([9, 24, 18], [128, 186, 112]);
const SEA_PAL = ramp([5, 13, 26], [38, 104, 168]);
/** Franja del amanecer: el terminador no es un corte, es una banda cálida. */
const DUSK_PAL = ramp([26, 14, 16], [196, 104, 58]);

export function Globe({ anchorX = 0.3, lightsActive = true }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /* El objetivo vive en una referencia para que cambiarlo no reinicie el
     lienzo: el bucle de dibujo lo lee en cada cuadro y se acerca a él. */
  const lightsTargetRef = useRef(lightsActive);

  useEffect(() => {
    lightsTargetRef.current = lightsActive;
  }, [lightsActive]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------------------------------- máscara de tierra ---------- */
    const mc = document.createElement("canvas");
    mc.width = MASK_W;
    mc.height = MASK_H;
    const mx = mc.getContext("2d");
    if (!mx) return;
    mx.fillStyle = "#000";
    mx.fillRect(0, 0, MASK_W, MASK_H);
    const paint = (rings: [number, number][][], color: string) => {
      mx.fillStyle = color;
      for (const ring of rings) {
        mx.beginPath();
        ring.forEach(([lon, lat], i) => {
          const x = (lon + 180) * 2;
          const y = (90 - lat) * 2;
          if (i === 0) mx.moveTo(x, y);
          else mx.lineTo(x, y);
        });
        mx.closePath();
        mx.fill();
      }
    };
    paint(LAND, "#fff");
    paint(WATER, "#000");
    const mask = mx.getImageData(0, 0, MASK_W, MASK_H).data;
    const isLand = (lon: number, lat: number) => {
      const ix = Math.min(MASK_W - 1, Math.max(0, Math.floor((lon + 180) * 2)));
      const iy = Math.min(MASK_H - 1, Math.max(0, Math.floor((90 - lat) * 2)));
      return mask[(iy * MASK_W + ix) * 4] > 127;
    };

    /* ------------------------------- puntos sobre la esfera -------------- */
    const PX = new Float32Array(POINTS);
    const PY = new Float32Array(POINTS);
    const PZ = new Float32Array(POINTS);
    const PL = new Uint8Array(POINTS);
    /** Luz de ciudad: 0 si no hay, 0.35–1 según intensidad. Fija por punto. */
    const PC = new Float32Array(POINTS);
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < POINTS; i++) {
      const y = 1 - (2 * (i + 0.5)) / POINTS;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * i;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      PX[i] = x;
      PY[i] = y;
      PZ[i] = z;
      const lat = (Math.asin(y) * 180) / Math.PI;
      const land = isLand((Math.atan2(x, z) * 180) / Math.PI, lat);
      PL[i] = land ? 1 : 0;
      // Las luces se agrupan en latitudes medias y escasean hacia los polos,
      // que es, a grandes rasgos, cómo se reparte la población.
      const band = 1 - Math.min(1, Math.abs(lat) / 72);
      PC[i] = land && Math.random() < 0.16 * band ? 0.4 + Math.random() * 0.6 : 0;
    }

    const toVec = ([lon, lat]: [number, number]) => {
      const la = (lat * Math.PI) / 180;
      const lo = (lon * Math.PI) / 180;
      return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
    };
    const pulses = PULSE_POINTS.map((p) => ({ ...toVec(p), ph: Math.random() * 6.28 }));
    const peru = toVec(PERU_MARK);

    /* ------------------------------------------------ estrellas ---------- */
    let stars: Star[] = [];

    /* -------------------------------------------------- estado ----------- */
    let W = 0;
    let H = 0;
    let R = 0;
    let dpr = 1;
    let viewLon = 2.1;
    let tilt = 0.34;
    let vel = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let satA = 0.6;
    const AUTO = reduced ? 0 : 0.075;

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = host!.clientWidth;
      H = host!.clientHeight;
      canvas!.width = Math.max(1, Math.round(W * dpr));
      canvas!.height = Math.max(1, Math.round(H * dpr));
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      // Más grande que antes: el planeta es lo primero que se ve de la
      // portada, y a tamaño pequeño el terminador y las luces no se apreciaban.
      R = W < 820 ? Math.min(W * 0.4, H * 0.29) : Math.min(W * 0.27, H * 0.43);

      stars = createStars(W, H);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const cxOf = () => (W < 820 ? W * 0.5 : W * anchorX);
    const cyOf = () => (W < 820 ? H * 0.36 : H * 0.52);

    function orbPt(o: Orbit, a: number) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = o.rr * c;
      const y = o.rr * s * Math.cos(o.inc);
      const z = o.rr * s * Math.sin(o.inc);
      const cr = Math.cos(o.roll);
      const sr = Math.sin(o.roll);
      return { x: x * cr - y * sr, y: x * sr + y * cr, z };
    }

    function drawOrbit(o: Orbit, front: boolean, alpha: number) {
      if (alpha <= 0.004) return;
      const cx = cxOf();
      const cy = cyOf();
      const SEG = 140;
      let prev: { sx: number; sy: number } | null = null;
      ctx!.lineWidth = 1;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const p = orbPt(o, a);
        const sx = cx + R * p.x;
        const sy = cy - R * p.y;
        if (prev && p.z >= 0 === front) {
          ctx!.globalAlpha = alpha;
          ctx!.strokeStyle = front ? "rgba(150,205,215,.3)" : "rgba(150,205,215,.1)";
          ctx!.beginPath();
          ctx!.moveTo(prev.sx, prev.sy);
          ctx!.lineTo(sx, sy);
          ctx!.stroke();
        }
        prev = { sx, sy };
      }
      ctx!.globalAlpha = 1;
    }

    function drawSat(front: boolean, alpha: number) {
      if (alpha <= 0.004) return;
      const o = ORBITS[0];
      const p = orbPt(o, satA);
      if (p.z >= 0 !== front) return;
      const cx = cxOf();
      const cy = cyOf();
      const sx = cx + R * p.x;
      const sy = cy - R * p.y;
      const q = orbPt(o, satA + 0.02);
      const ang = Math.atan2(-(q.y - p.y), q.x - p.x);
      const u = R / 300;
      ctx!.save();
      ctx!.translate(sx, sy);
      ctx!.rotate(ang + Math.PI / 4);
      ctx!.globalAlpha = (front ? 1 : 0.4) * alpha;
      ctx!.strokeStyle = "#cfe6f7";
      ctx!.fillStyle = "#06101c";
      ctx!.lineWidth = 1.2;
      ctx!.fillRect(-4 * u, -4 * u, 8 * u, 8 * u);
      ctx!.strokeRect(-4 * u, -4 * u, 8 * u, 8 * u);
      ctx!.strokeRect(-20 * u, -4 * u, 13 * u, 8 * u);
      ctx!.strokeRect(7 * u, -4 * u, 13 * u, 8 * u);
      ctx!.beginPath();
      ctx!.moveTo(-13.5 * u, -4 * u);
      ctx!.lineTo(-13.5 * u, 4 * u);
      ctx!.moveTo(13.5 * u, -4 * u);
      ctx!.lineTo(13.5 * u, 4 * u);
      ctx!.moveTo(0, -4 * u);
      ctx!.lineTo(0, -10 * u);
      ctx!.stroke();
      ctx!.restore();
      ctx!.globalAlpha = 1;
    }

    let raf = 0;
    let running = true;
    let prevT = 0;
    let t = 0;
    let lights = lightsTargetRef.current ? 1 : 0;
    let adriftT = lightsTargetRef.current ? 0 : 1.6;
    let adriftAlpha = lightsTargetRef.current ? 0 : 1;

    function frame(now: number) {
      const dt = Math.min(0.05, (now - (prevT || now)) / 1000);
      prevT = now;
      t += dt;

      /* Atenuado: baja más rápido de lo que sube, para que al llegar a la
         sección de equipo el planeta se apague con decisión y vuelva despacio. */
      const lt = lightsTargetRef.current ? 1 : 0;
      if (reduced) {
        lights = lt;
      } else {
        const rate = lt < lights ? 7.5 : 4.5;
        lights += (lt - lights) * Math.min(1, dt * rate);
        if (Math.abs(lt - lights) < 0.004) lights = lt;
      }
      if (!lightsTargetRef.current) {
        adriftAlpha = reduced ? 1 : Math.min(1, adriftAlpha + dt * 2.2);
        adriftT += dt;
      } else {
        adriftAlpha = reduced ? 0 : Math.max(0, adriftAlpha - dt * 3.5);
        if (adriftAlpha <= 0.004) adriftT = 0;
      }
      const beaconAlpha = Math.pow(lights, 1.6);
      const orbitAlpha = Math.pow(lights, 1.3);
      const surfaceAlpha = Math.pow(lights, 1.3);

      if (!dragging) {
        const target = -AUTO;
        vel += (target - vel) * Math.min(1, dt * 2.2);
        viewLon += vel * dt;
      }
      satA += ORBITS[0].sp * dt * (reduced ? 0.25 : 1);

      const cx = cxOf();
      const cy = cyOf();
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      /* --- estrellas --- */
      drawStars(ctx!, stars, W, H, dt, t);

      /* --- atmósfera exterior ---
         Un halo estrecho pegado al borde, no un disco. Con el radio grande y
         la suma de luces, un degradado ancho se convertía en una mancha azul
         que se comía media portada; el aire de un planeta se ve como una
         línea fina, así que eso es lo que se dibuja. */
      {
        const g = ctx!.createRadialGradient(cx, cy, R * 0.99, cx, cy, R * 1.22);
        g.addColorStop(0, "rgba(120,200,240,.1)");
        g.addColorStop(0.18, "rgba(95,175,225,.055)");
        g.addColorStop(0.45, "rgba(70,140,200,.022)");
        g.addColorStop(1, "rgba(50,110,170,0)");
        ctx!.globalCompositeOperation = "lighter";
        ctx!.globalAlpha = 0.45 + 0.55 * lights;
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(cx, cy, R * 1.22, 0, 7);
        ctx!.fill();
        ctx!.globalAlpha = 1;
        ctx!.globalCompositeOperation = "source-over";
      }

      ORBITS.forEach((o) => drawOrbit(o, false, orbitAlpha));
      drawSat(false, lights);
      drawMcTropicAdrift(ctx!, cx, cy, R, adriftT, adriftAlpha, reduced);

      /* --- disco base ---
         El relleno ya lleva la luz: claro del lado del sol y casi negro del
         opuesto. Los puntos se apoyan encima, de modo que los huecos entre
         ellos no dejan ver el fondo estrellado a través del planeta. */
      {
        const gx = cx + SUN.x * R * 0.62;
        const gy = cy - SUN.y * R * 0.62;
        const d = ctx!.createRadialGradient(gx, gy, R * 0.04, cx, cy, R * 1.05);
        d.addColorStop(0, "#2b6b9c");
        d.addColorStop(0.3, "#19496f");
        d.addColorStop(0.58, "#0b2742");
        d.addColorStop(0.82, "#04101f");
        d.addColorStop(1, "#01050a");
        ctx!.fillStyle = d;
        ctx!.beginPath();
        ctx!.arc(cx, cy, R, 0, 7);
        ctx!.fill();
      }

      /* --- superficie --- */
      const cl = Math.cos(viewLon);
      const sl = Math.sin(viewLon);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const u = R / 300;
      /* Las casillas se solapan un poco a propósito: con la rejilla de
         Fibonacci, dejar aire entre ellas dibujaba espirales concéntricas muy
         visibles —el ojo las lee como un patrón, no como un planeta—. Al
         solaparse, el muaré desaparece y la superficie se cierra. */
      const sizeL = 3.4 * u;
      const sizeS = 3.1 * u;
      const last = LIGHT_LEVELS - 1;

      ctx!.globalAlpha = surfaceAlpha;
      for (let i = 0; i < POINTS; i++) {
        const x0 = PX[i];
        const z0 = PZ[i];
        const x = x0 * cl - z0 * sl;
        const z = x0 * sl + z0 * cl;
        const y0 = PY[i];
        const y = y0 * ct - z * st;
        const z2 = y0 * st + z * ct;
        if (z2 <= 0.015) continue;

        const sx = cx + R * x;
        const sy = cy - R * y;

        /* La normal de una esfera unitaria es su propia posición: el producto
           escalar con el sol da directamente cuánta luz recibe el punto. */
        const sun = x * SUN.x + y * SUN.y + z2 * SUN.z;
        const land = PL[i] === 1;

        if (sun > 0.06) {
          /* Día. */
          const lit = Math.min(1, 0.24 + sun * 0.95);
          const lv = Math.round(lit * last);
          ctx!.fillStyle = land ? LAND_PAL[lv] : SEA_PAL[lv];
          const s = (land ? sizeL : sizeS) * (0.62 + 0.38 * z2);
          ctx!.fillRect(sx - s / 2, sy - s / 2, s, s);
        } else if (sun > -0.07) {
          /* Terminador: banda cálida y estrecha, el borde del amanecer. */
          const k = (sun + 0.07) / 0.13;
          const lv = Math.round(Math.min(1, k) * last);
          ctx!.fillStyle = DUSK_PAL[lv];
          const s = (land ? sizeL : sizeS) * (0.62 + 0.38 * z2) * 0.92;
          ctx!.fillRect(sx - s / 2, sy - s / 2, s, s);
        } else {
          /* Noche: tierra apenas insinuada y, encima, las luces. */
          if (land) {
            ctx!.fillStyle = "#0b1712";
            const s = sizeL * (0.62 + 0.38 * z2) * 0.85;
            ctx!.fillRect(sx - s / 2, sy - s / 2, s, s);
          }
          const city = PC[i];
          if (city > 0) {
            // Se apagan cerca del terminador para que no aparezcan de golpe.
            const fade = Math.min(1, (-sun - 0.07) * 9);
            ctx!.globalAlpha = city * fade * (0.5 + 0.5 * z2) * surfaceAlpha;
            ctx!.fillStyle = "#ffdcab";
            const s = 2 * u;
            ctx!.fillRect(sx - s / 2, sy - s / 2, s, s);
            ctx!.globalAlpha = surfaceAlpha;
          }
        }
      }

      /* --- borde iluminado ---
         Un aro fino justo por dentro del limbo, más intenso del lado del sol.
         Es lo que separa el planeta del espacio y lo que lo hace parecer una
         esfera y no un recorte. */
      ctx!.globalAlpha = 1;
      {
        ctx!.save();
        ctx!.globalAlpha = 0.35 + 0.65 * lights;
        ctx!.beginPath();
        ctx!.arc(cx, cy, R, 0, 7);
        ctx!.clip();
        ctx!.globalCompositeOperation = "lighter";
        const g = ctx!.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
        g.addColorStop(0, "rgba(90,180,225,0)");
        g.addColorStop(0.72, "rgba(90,180,225,.1)");
        g.addColorStop(1, "rgba(150,220,255,.5)");
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(cx, cy, R, 0, 7);
        ctx!.fill();
        ctx!.restore();
        ctx!.globalCompositeOperation = "source-over";
      }

      /* --- pulsos ---
         Brillan más sobre la cara nocturna: así se ven los incendios de noche
         desde un satélite. Siguen siendo adorno, no datos. */
      for (const v of pulses) {
        const hx = v.x * cl - v.z * sl;
        const hz = v.x * sl + v.z * cl;
        const hy = v.y * ct - hz * st;
        const hz2 = v.y * st + hz * ct;
        if (hz2 <= 0.05) continue;
        const sx = cx + R * hx;
        const sy = cy - R * hy;
        const sun = hx * SUN.x + hy * SUN.y + hz2 * SUN.z;
        const night = Math.max(0.35, Math.min(1, 0.5 - sun));
        const pulse = (Math.sin(t * 2.2 + v.ph) + 1) / 2;
        ctx!.globalAlpha = Math.min(1, hz2 * 2.2) * night * beaconAlpha;
        ctx!.globalCompositeOperation = "lighter";
        ctx!.fillStyle = `rgba(255,120,50,${(0.16 + 0.22 * pulse).toFixed(2)})`;
        ctx!.beginPath();
        ctx!.arc(sx, sy, (3 + 3.4 * pulse) * u * 1.3, 0, 7);
        ctx!.fill();
        ctx!.fillStyle = "#ffb070";
        ctx!.beginPath();
        ctx!.arc(sx, sy, 1.5 * u * 1.3, 0, 7);
        ctx!.fill();
        ctx!.globalCompositeOperation = "source-over";
        ctx!.globalAlpha = 1;
      }

      /* --- marca del Perú --- */
      {
        const hx = peru.x * cl - peru.z * sl;
        const hz = peru.x * sl + peru.z * cl;
        const hy = peru.y * ct - hz * st;
        const hz2 = peru.y * st + hz * ct;
        if (hz2 > 0.08) {
          const sx = cx + R * hx;
          const sy = cy - R * hy;
          const ring = 6.5 + 3.5 * ((Math.sin(t * 1.5) + 1) / 2);
          ctx!.globalAlpha = Math.min(1, hz2 * 2) * beaconAlpha;
          ctx!.strokeStyle = "rgba(216,255,51,.9)";
          ctx!.lineWidth = 1.4;
          ctx!.beginPath();
          ctx!.arc(sx, sy, ring * u * 1.3, 0, 7);
          ctx!.stroke();
          ctx!.fillStyle = "#d8ff33";
          ctx!.beginPath();
          ctx!.arc(sx, sy, 2.4 * u * 1.3, 0, 7);
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      }

      ORBITS.forEach((o) => drawOrbit(o, true, orbitAlpha));
      drawSat(true, lights);

      if (running) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* --------------------------------------------- interacción ---------- */
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      vel = 0;
      host.classList.add("globe--drag");
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* algunos navegadores lo rechazan; el arrastre sigue funcionando */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const k = 2.2 / (R * 2);
      viewLon -= dx * k * 1.6;
      vel = -dx * k * 1.6 * 60;
      tilt = Math.max(-0.9, Math.min(0.9, tilt + dy * 0.005));
    };
    const onUp = () => {
      dragging = false;
      host.classList.remove("globe--drag");
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

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
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [anchorX]);

  return (
    <div className="globe" ref={hostRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
