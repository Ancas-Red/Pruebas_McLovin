import { useEffect, useState } from "react";

/**
 * Enrutador por hash, sin dependencias.
 *
 * Se usa hash y no History API porque la aplicacion se sirve como archivos
 * estaticos y debe poder abrirse tambien desde `file://` o desde una subcarpeta,
 * donde no hay servidor que reescriba rutas.
 */
export type Route = "inicio" | "mapa" | "tecnologia" | "convenciones";

function parse(hash: string): Route {
  const seg = hash.replace(/^#\/?/, "").split("?")[0];
  if (seg === "mapa") return "mapa";
  if (seg === "tecnologia") return "tecnologia";
  if (seg === "marco-normativo" || seg === "convenciones") return "convenciones";
  return "inicio";
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (r: Route) => {
    if (r === "mapa") window.location.hash = "#/mapa";
    else if (r === "tecnologia") window.location.hash = "#/tecnologia";
    else if (r === "convenciones") window.location.hash = "#/marco-normativo";
    else window.location.hash = "#/";
  };

  return [route, go];
}
