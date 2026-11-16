import { useEffect, useState } from "react";
import { Logo } from "./Logo";

interface Props {
  /** Controla si el loader está activo; al pasar a false se desvanece suavemente. */
  active: boolean;
  /** `app`: transición global; `stage`: centrado sobre el visor del mapa. */
  scope?: "app" | "stage";
  /** Texto breve mostrado debajo de la órbita. */
  label?: string;
  /** Si bloquea la interacción de puntero mientras está visible (no al salir). */
  blocking?: boolean;
}

const EXIT_MS = 280;

export function OrbitalLoader({
  active,
  scope = "stage",
  label,
  blocking = false,
}: Props) {
  const [rendered, setRendered] = useState(active);
  const [shown, setShown] = useState(active);

  useEffect(() => {
    if (active) {
      setRendered(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        if (inner) cancelAnimationFrame(inner);
      };
    }

    setShown(false);
    const timer = window.setTimeout(() => setRendered(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!rendered) return null;

  return (
    <div
      className={[
        "orbital-curtain",
        `orbital-curtain--${scope}`,
        shown ? "is-shown" : "",
        blocking && active ? "is-blocking" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
    >
      <div className="orbital-curtain__stage">
        <div className="orbital-curtain__halo" aria-hidden="true" />
        <Logo size={scope === "app" ? 88 : 78} tone="light" animate />
        {label && <span className="orbital-curtain__label">{label}</span>}
        <span className="orbital-curtain__bar" aria-hidden="true" />
      </div>
    </div>
  );
}
