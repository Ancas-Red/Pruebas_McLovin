import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MonthCell } from "../lib/calendar";
import { cividis } from "../lib/palette";

const M_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const M_FULL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Cámara mirando desde arriba y ligeramente al frente-izquierda (vista cenital-isométrica)
const DEFAULT_YAW = -0.10;
const DEFAULT_PITCH = 0.72;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;
const SUB = 3;

interface Props {
  years: number[];
  byKey: Map<string, MonthCell>;
  tone: (v: number) => number;
  selectedYear: number;
  selectedMonth: number;
  onPick: (year: number, month: number) => void;
}

interface Pt3 {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  camZ: number;
}

interface HoveredVertex {
  year: number;
  month: number;
  cell?: MonthCell;
  sx: number;
  sy: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleGrid(grid: number[][], fx: number, fz: number): number {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return 0;

  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;

  const get = (r: number, c: number) =>
    grid[Math.max(0, Math.min(rows - 1, r))][Math.max(0, Math.min(cols - 1, c))];

  const rowVals = [-1, 0, 1, 2].map((dr) =>
    catmullRom(get(ix + dr, iz - 1), get(ix + dr, iz), get(ix + dr, iz + 1), get(ix + dr, iz + 2), tz)
  );
  const v = catmullRom(rowVals[0], rowVals[1], rowVals[2], rowVals[3], tx);
  return Math.max(0, Math.min(1, v));
}

export function CalendarTerrain3D({
  years,
  byKey,
  tone,
  selectedYear,
  selectedMonth,
  onPick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const verticesRef = useRef<HoveredVertex[]>([]);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, startYaw: DEFAULT_YAW, startPitch: DEFAULT_PITCH });

  const [yaw, setYaw] = useState(DEFAULT_YAW);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [hovered, setHovered] = useState<HoveredVertex | null>(null);
  const [size, setSize] = useState({ w: 620, h: 222 });

  // Construye matriz base [yearIdx][monthIdx] y malla suavizada de valles/crestas
  const terrain = useMemo(() => {
    const ny = Math.max(2, years.length);
    const nm = 12;
    const rawH: number[][] = [];
    const hasData: boolean[][] = [];

    for (let ix = 0; ix < years.length; ix++) {
      const y = years[ix];
      const hRow: number[] = [];
      const dRow: boolean[] = [];
      for (let im = 0; im < nm; im++) {
        const cell = byKey.get(`${y}-${im + 1}`);
        hRow.push(cell ? tone(cell.detections) : 0);
        dRow.push(Boolean(cell));
      }
      rawH.push(hRow);
      hasData.push(dRow);
    }

    if (years.length === 1) {
      rawH.push([...rawH[0]]);
      hasData.push([...hasData[0]]);
    }

    const gx = (ny - 1) * SUB + 1;
    const gz = (nm - 1) * SUB + 1;
    const heights: number[][] = [];
    const filled: boolean[][] = [];

    for (let i = 0; i < gx; i++) {
      const fx = i / SUB;
      const ix0 = Math.min(ny - 1, Math.floor(fx));
      const ix1 = Math.min(ny - 1, Math.ceil(fx));
      const rowH: number[] = [];
      const rowF: boolean[] = [];
      for (let j = 0; j < gz; j++) {
        const fz = j / SUB;
        const iz0 = Math.min(nm - 1, Math.floor(fz));
        const iz1 = Math.min(nm - 1, Math.ceil(fz));
        const anyData =
          hasData[ix0][iz0] || hasData[ix1][iz0] || hasData[ix0][iz1] || hasData[ix1][iz1];
        rowF.push(anyData);
        rowH.push(anyData ? sampleGrid(rawH, fx, fz) : 0);
      }
      heights.push(rowH);
      filled.push(rowF);
    }

    return { ny, nm, gx, gz, heights, filled };
  }, [years, byKey, tone]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setHovered(null);
  }, [years, byKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = Math.exp(-e.deltaY * 0.0014);
      setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || years.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.65);
    bg.addColorStop(0, "rgba(255,255,255,0.03)");
    bg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    // Cámara por encima del plano (+Y arriba, mirando hacia abajo con pitch > 0):
    // - A mayor rz0 (fondo) o mayor wy (cresta), ry aumenta -> sube en pantalla (sy menor)
    // - A mayor wy (cresta), rz disminuye -> queda más cerca de la cámara superior
    const fov = 8.0;
    const camDist = 8.0;
    const scaleBase = Math.min(w / 6.0, h / 2.55) * zoom;
    const cx = w * 0.53;
    const cy = h * 0.53;

    const project = (wx: number, wy: number, wz: number): Pt3 => {
      const rx = wx * cosY - wz * sinY;
      const rz0 = wx * sinY + wz * cosY;
      const ry = wy * cosP + rz0 * sinP;
      const rz = -wy * sinP + rz0 * cosP;
      const depth = camDist + rz;
      const k = fov / Math.max(0.8, depth);
      return {
        x: wx,
        y: wy,
        z: wz,
        sx: cx + rx * k * scaleBase,
        sy: cy - ry * k * scaleBase,
        camZ: depth,
      };
    };

    const { gx, gz, heights, filled } = terrain;
    const spanX = 4.9;
    const spanZ = 1.5;
    const elevScale = 0.62;

    const pts: Pt3[][] = [];
    for (let i = 0; i < gx; i++) {
      const wx = (i / Math.max(1, gx - 1) - 0.5) * spanX;
      const row: Pt3[] = [];
      for (let j = 0; j < gz; j++) {
        // ENE al fondo (+wz), DIC al frente (-wz): coincide con la lectura arriba->abajo del 2D
        const wz = (0.5 - j / Math.max(1, gz - 1)) * spanZ;
        const wy = heights[i][j] * elevScale;
        row.push(project(wx, wy, wz));
      }
      pts.push(row);
    }

    // Recolectar caras para pintar atrás -> adelante (painter's algorithm)
    const quads: {
      i: number;
      j: number;
      depth: number;
      hAvg: number;
      hasData: boolean;
      p0: Pt3;
      p1: Pt3;
      p2: Pt3;
      p3: Pt3;
    }[] = [];

    for (let i = 0; i < gx - 1; i++) {
      for (let j = 0; j < gz - 1; j++) {
        const p0 = pts[i][j];
        const p1 = pts[i + 1][j];
        const p2 = pts[i + 1][j + 1];
        const p3 = pts[i][j + 1];
        const hasData =
          filled[i][j] || filled[i + 1][j] || filled[i + 1][j + 1] || filled[i][j + 1];
        const hAvg = (heights[i][j] + heights[i + 1][j] + heights[i + 1][j + 1] + heights[i][j + 1]) * 0.25;
        const depth = (p0.camZ + p1.camZ + p2.camZ + p3.camZ) * 0.25;
        quads.push({ i, j, depth, hAvg, hasData, p0, p1, p2, p3 });
      }
    }

    quads.sort((a, b) => b.depth - a.depth);

    // Luz superior-frontal-izquierda para modelar crestas y valles
    const lx = -0.34;
    const ly = 0.86;
    const lz = -0.38;

    for (const q of quads) {
      const { p0, p1, p2, p3 } = q;

      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.lineTo(p3.sx, p3.sy);
      ctx.closePath();

      if (!q.hasData) {
        ctx.fillStyle = "rgba(16, 34, 23, 0.78)";
        ctx.fill();
        if (q.i % SUB === 0 || q.j % SUB === 0) {
          ctx.strokeStyle = "rgba(162, 179, 166, 0.12)";
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
        continue;
      }

      const ax = p2.x - p0.x;
      const ay = p2.y - p0.y;
      const az = p2.z - p0.z;
      const bx = p3.x - p1.x;
      const by = p3.y - p1.y;
      const bz = p3.z - p1.z;
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const dot = Math.max(0, (nx * lx + ny * ly + nz * lz) / nLen);
      const shade = 0.74 + dot * 0.38;

      const [r, g, b] = cividis(q.hAvg);
      const sr = Math.min(255, Math.round(r * shade));
      const sg = Math.min(255, Math.round(g * shade));
      const sb = Math.min(255, Math.round(b * shade));
      ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
      ctx.fill();

      const isMajor = q.i % SUB === 0 || q.j % SUB === 0;
      ctx.strokeStyle = isMajor ? "rgba(255, 255, 255, 0.14)" : `rgba(${sr},${sg},${sb},0.55)`;
      ctx.lineWidth = isMajor ? 0.65 : 0.4;
      ctx.stroke();
    }

    // Etiquetas de ejes sobre la base (años al frente, meses al costado izquierdo)
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(232, 237, 245, 0.6)";

    const yearLabelZ = -spanZ * 0.5 - 0.14;
    const yearStep = years.length > 10 ? 2 : 1;
    for (let ix = 0; ix < years.length; ix += yearStep) {
      const wx = (ix / Math.max(1, years.length - 1) - 0.5) * spanX;
      const lp = project(wx, 0, yearLabelZ);
      ctx.fillText(`'${String(years[ix]).slice(2)}`, lp.sx, lp.sy);
    }

    const monthLabelX = -spanX * 0.5 - 0.44;
    ctx.textAlign = "right";
    for (let im = 0; im < 12; im += 2) {
      const wz = (0.5 - im / 11) * spanZ;
      const lp = project(monthLabelX, 0, wz);
      ctx.fillText(M_SHORT[im], lp.sx, lp.sy);
    }
    ctx.textAlign = "center";

    // Vértices interactivos + marcadores de anomalía fuerte
    const vertices: HoveredVertex[] = [];
    for (let ix = 0; ix < years.length; ix++) {
      const y = years[ix];
      const gi = ix * SUB;
      if (gi >= gx) continue;
      for (let im = 0; im < 12; im++) {
        const gj = im * SUB;
        const pt = pts[gi][gj];
        const cell = byKey.get(`${y}-${im + 1}`);
        vertices.push({ year: y, month: im + 1, cell, sx: pt.sx, sy: pt.sy });

        if (cell && cell.historical_anomaly != null && cell.historical_anomaly >= 2) {
          ctx.beginPath();
          ctx.arc(pt.sx, pt.sy, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(216, 255, 51, 0.78)";
          ctx.fill();
        }
      }
    }
    verticesRef.current = vertices;

    if (hovered) {
      const hv = vertices.find((v) => v.year === hovered.year && v.month === hovered.month);
      if (hv) {
        ctx.beginPath();
        ctx.arc(hv.sx, hv.sy, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Marcador de selección activa (faro + rombo ácido)
    const selIx = years.indexOf(selectedYear);
    const selIm = selectedMonth - 1;
    if (selIx >= 0 && selIm >= 0 && selIm < 12) {
      const wx = (selIx / Math.max(1, years.length - 1) - 0.5) * spanX;
      const wz = (0.5 - selIm / 11) * spanZ;
      const selCell = byKey.get(`${selectedYear}-${selectedMonth}`);
      const wy = (selCell ? tone(selCell.detections) : 0) * elevScale;
      const basePt = project(wx, 0, wz);
      const topPt = project(wx, wy + 0.16, wz);
      const surfPt = project(wx, wy, wz);

      ctx.beginPath();
      ctx.moveTo(basePt.sx, basePt.sy);
      ctx.lineTo(topPt.sx, topPt.sy);
      ctx.strokeStyle = "rgba(216, 255, 51, 0.78)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(surfPt.sx, surfPt.sy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = "#d8ff33";
      ctx.fill();
      ctx.strokeStyle = "#040806";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(topPt.sx, topPt.sy - 5);
      ctx.lineTo(topPt.sx + 4.5, topPt.sy);
      ctx.lineTo(topPt.sx, topPt.sy + 5);
      ctx.lineTo(topPt.sx - 4.5, topPt.sy);
      ctx.closePath();
      ctx.fillStyle = "#d8ff33";
      ctx.fill();
    }
  }, [size, yaw, pitch, zoom, terrain, years, byKey, tone, selectedYear, selectedMonth, hovered]);

  useEffect(() => {
    draw();
  }, [draw]);

  const findNearestVertex = (clientX: number, clientY: number): HoveredVertex | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let best: HoveredVertex | null = null;
    let bestD2 = 22 * 22;
    for (const v of verticesRef.current) {
      const dx = v.sx - x;
      const dy = v.sy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best;
  };

  return (
    <div className="cal3d" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="cal3d__canvas"
        aria-label="Vista 3D de valles y crestas de actividad térmica por año y mes"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            startYaw: yaw,
            startPitch: pitch,
          };
        }}
        onPointerMove={(e) => {
          if (dragRef.current.active) {
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
            setYaw(dragRef.current.startYaw + dx * 0.009);
            setPitch(Math.max(0.24, Math.min(1.22, dragRef.current.startPitch + dy * 0.008)));
            return;
          }
          setHovered(findNearestVertex(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          const wasClick = dragRef.current.active && !dragRef.current.moved;
          dragRef.current.active = false;
          if (wasClick) {
            const hit = findNearestVertex(e.clientX, e.clientY);
            if (hit && hit.cell) {
              onPick(hit.year, hit.month);
            }
          }
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
        }}
        onPointerLeave={() => {
          if (!dragRef.current.active) setHovered(null);
        }}
      />

      <div className="cal3d__hud">
        <span className="cal3d__hint">Arrastra para rotar · Rueda para zoom · Clic en cresta/valle</span>
        <button
          type="button"
          className="cal3d__reset"
          onClick={() => {
            setYaw(DEFAULT_YAW);
            setPitch(DEFAULT_PITCH);
            setZoom(DEFAULT_ZOOM);
          }}
          title="Restaurar ángulo y zoom 3D inicial"
        >
          ↺ Vista
        </button>
      </div>

      {hovered && (
        <div
          className="cal3d__tooltip"
          style={{
            left: Math.min(Math.max(12, hovered.sx + 12), Math.max(12, size.w - 220)),
            top: Math.max(10, hovered.sy - 46),
          }}
        >
          <div className="cal3d__tt-head">
            {M_FULL[hovered.month - 1]} {hovered.year}
          </div>
          {hovered.cell ? (
            <div className="cal3d__tt-meta">
              {hovered.cell.detections.toLocaleString("es-PE")} det. ·{" "}
              {hovered.cell.observation_coverage != null
                ? `cob. ${Math.round(hovered.cell.observation_coverage * 100)}%`
                : "cob. s/d"}
              {hovered.cell.historical_anomaly != null
                ? ` · z=${hovered.cell.historical_anomaly.toFixed(2)}`
                : ""}
            </div>
          ) : (
            <div className="cal3d__tt-meta">Sin datos publicados</div>
          )}
        </div>
      )}
    </div>
  );
}
