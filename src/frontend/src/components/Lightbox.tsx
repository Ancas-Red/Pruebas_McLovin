import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** URL http(s) o blob: de la imagen (nunca se abre en otra pestaña). */
  src: string;
  title: string;
  /** Nombre sugerido para la descarga. */
  downloadName: string;
  onClose: () => void;
}

const MIN = 1;
const MAX = 6;

/**
 * Visor ampliado dentro de la propia app, con zoom y descarga.
 * Sustituye a `window.open(url)`, que terminaba en `about:blank` cuando el
 * navegador bloqueaba la URL `data:`.
 */
export function Lightbox({ src, title, downloadName, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const clampZoom = (z: number) => Math.min(MAX, Math.max(MIN, z));
  const zoomBy = useCallback((f: number) => {
    setZoom((z) => {
      const nz = Math.min(MAX, Math.max(MIN, z * f));
      if (nz === MIN) setPan({ x: 0, y: 0 });
      return nz;
    });
  }, []);
  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, zoomBy, reset]);

  const btn: CSSProperties = {
    background: "var(--surface-2, #1a232d)",
    color: "var(--ink, #e6edf3)",
    border: "1px solid var(--line-strong, #3a4856)",
    padding: "6px 12px",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "none",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(4, 8, 11, 0.92)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--line-strong, #3a4856)",
        }}
      >
        <b style={{ flex: 1, minWidth: 120, fontSize: 13 }}>{title}</b>
        <button type="button" style={btn} onClick={() => zoomBy(0.8)} aria-label="Alejar">−</button>
        <span style={{ fontSize: 12, minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)} %</span>
        <button type="button" style={btn} onClick={() => zoomBy(1.25)} aria-label="Acercar">+</button>
        <button type="button" style={btn} onClick={reset}>Restablecer</button>
        <a style={btn} href={src} download={downloadName}>Descargar</a>
        <button type="button" style={btn} onClick={onClose}>Cerrar ✕</button>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: zoom > 1 ? "grab" : "zoom-in",
        }}
        onWheel={(e) => {
          e.stopPropagation();
          zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
        }}
        onMouseUp={() => {
          drag.current = null;
        }}
        onMouseLeave={() => {
          drag.current = null;
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Clic en la imagen: alterna entre ajustado y 2×; clic en el fondo: cierra.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <img
          src={src}
          alt={title}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            if (drag.current === null) setZoom((z) => (z > 1 ? 1 : clampZoom(2)));
            setPan({ x: 0, y: 0 });
          }}
          style={{
            maxWidth: "94vw",
            maxHeight: "calc(100vh - 80px)",
            imageRendering: zoom > 2 ? "pixelated" : "auto",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: drag.current ? "none" : "transform 0.12s ease-out",
            userSelect: "none",
          }}
        />
      </div>
    </div>,
    document.body
  );
}
