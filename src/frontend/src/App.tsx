import { useCallback, useEffect, useRef, useState } from "react";
import { SiteNav, type NavContext, type ToolTab } from "./components/SiteNav";
import { OrbitalLoader } from "./components/OrbitalLoader";
import { Landing } from "./pages/Landing";
import { MapTool } from "./pages/MapTool";
import { TechStack } from "./pages/TechStack";
import { Conventions } from "./pages/Conventions";
import { useRoute, type Route } from "./lib/router";
import type { BackendState } from "./api/client";

export default function App() {
  const [route, go] = useRoute();
  const [tab, setTab] = useState<ToolTab>("calendario");
  const [backend, setBackend] = useState<BackendState>("checking");
  const [navContext, setNavContext] = useState<NavContext | null>(null);
  const [tourTrigger, setTourTrigger] = useState(0);
  const [routeCurtain, setRouteCurtain] = useState<{
    active: boolean;
    label: string;
    suspendTour: boolean;
  }>({
    active: false,
    label: "",
    suspendTour: false,
  });
  const navTimers = useRef<number[]>([]);

  // `onBackend` se pasa a un efecto de MapTool: debe ser estable para no
  // reinstalar el sondeo en cada render.
  const onBackend = useCallback((s: BackendState) => setBackend(s), []);

  const clearNavTimers = useCallback(() => {
    navTimers.current.forEach((id) => window.clearTimeout(id));
    navTimers.current = [];
  }, []);

  useEffect(() => clearNavTimers, [clearNavTimers]);

  const navigateRoute = useCallback(
    (next: Route) => {
      if (next === route) return;
      clearNavTimers();

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        go(next);
        return;
      }

      const label =
        next === "mapa"
          ? "Abriendo visor territorial…"
          : next === "tecnologia"
            ? "Cargando arquitectura…"
            : next === "convenciones"
              ? "Cargando marco normativo…"
              : "Volviendo a portada…";
      setRouteCurtain({ active: true, label, suspendTour: true });

      const tSwap = window.setTimeout(() => go(next), 150);
      const tDone = window.setTimeout(
        () => setRouteCurtain((c) => ({ ...c, active: false })),
        580
      );
      const tTour = window.setTimeout(
        () => setRouteCurtain((c) => ({ ...c, suspendTour: false })),
        880
      );
      navTimers.current = [tSwap, tDone, tTour];
    },
    [route, go, clearNavTimers]
  );

  // La portada se desplaza dentro de su propio contenedor; la herramienta ocupa
  // la ventana entera. El atributo deja que el CSS trate cada caso.
  useEffect(() => {
    document.documentElement.dataset.route = route;
  }, [route]);

  return (
    <div className={`app app--${route}`}>
      <SiteNav
        route={route}
        onRoute={navigateRoute}
        tab={route === "mapa" ? tab : undefined}
        onTab={route === "mapa" ? setTab : undefined}
        backend={route === "mapa" ? backend : undefined}
        navContext={route === "mapa" ? navContext : null}
        onStartTour={route === "mapa" ? () => setTourTrigger((n) => n + 1) : undefined}
      />

      {route === "inicio" ? (
        <Landing
          onOpenMap={() => navigateRoute("mapa")}
          onOpenTech={() => navigateRoute("tecnologia")}
          onOpenConventions={() => navigateRoute("convenciones")}
          suspendTypewriter={routeCurtain.suspendTour}
        />
      ) : route === "tecnologia" ? (
        <TechStack
          onOpenMap={() => navigateRoute("mapa")}
          onOpenLanding={() => navigateRoute("inicio")}
          onOpenConventions={() => navigateRoute("convenciones")}
        />
      ) : route === "convenciones" ? (
        <Conventions
          onOpenMap={() => navigateRoute("mapa")}
          onOpenLanding={() => navigateRoute("inicio")}
          onOpenTech={() => navigateRoute("tecnologia")}
        />
      ) : (
        <MapTool
          tab={tab}
          onBackend={onBackend}
          onContextChange={setNavContext}
          onOpenConventions={() => navigateRoute("convenciones")}
          suspendLoader={routeCurtain.active}
          suspendTour={routeCurtain.suspendTour}
          tourTrigger={tourTrigger}
        />
      )}

      <OrbitalLoader
        scope="app"
        active={routeCurtain.active}
        label={routeCurtain.label}
        blocking
      />
    </div>
  );
}
