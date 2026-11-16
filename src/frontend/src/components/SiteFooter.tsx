import { Logo } from "./Logo";
import type { Route } from "../lib/router";

interface Props {
  route: Route;
  onNavigate: (r: Route) => void;
  note?: string;
}

export function SiteFooter({
  route,
  onNavigate,
  note = "Data: NASA LP DAAC · Copernicus ERA5-Land · COPERNICUS DEM · MapBiomas",
}: Props) {
  return (
    <footer className="site-foot" data-reveal>
      <div className="site-foot__top">
        <button
          type="button"
          className="brand site-foot__brand"
          onClick={() => onNavigate("inicio")}
          title="Back to home"
        >
          <Logo size={36} tone="light" compact={false} />
          <span className="brand__text">
            <span className="brand__name">McHanaq</span>
            <span className="brand__tag">Territorial thermal activity</span>
          </span>
        </button>

        <div className="site-foot__actions">
          {route === "inicio" ? (
            <>
              <button type="button" className="btn" onClick={() => onNavigate("convenciones")}>
                Regulatory framework →
              </button>
              <button type="button" className="btn" onClick={() => onNavigate("tecnologia")}>
                Technology & stack →
              </button>
            </>
          ) : route === "tecnologia" ? (
            <>
              <button type="button" className="btn" onClick={() => onNavigate("convenciones")}>
                Regulatory framework →
              </button>
              <button type="button" className="btn btn--primary" onClick={() => onNavigate("mapa")}>
                Open the map →
              </button>
            </>
          ) : route === "convenciones" ? (
            <>
              <button type="button" className="btn" onClick={() => onNavigate("tecnologia")}>
                Technology & stack →
              </button>
              <button type="button" className="btn btn--primary" onClick={() => onNavigate("mapa")}>
                Open the map →
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => onNavigate("mapa")}>
              Open the map →
            </button>
          )}
        </div>
      </div>

      <div className="site-foot__bottom">
        <span className="site-foot__copy">
          © 2026 McHanaq · Los McLovin · NASA Space Apps Challenge 2026
        </span>
        <span className="site-foot__note">{note}</span>
      </div>
    </footer>
  );
}
