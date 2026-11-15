/**
 * Equipo Los McLovin.
 *
 * FOTOS: cada integrante solo tiene que dejar su imagen en
 * `public/equipo/<slug>.jpg` — por ejemplo `public/equipo/sebastian.jpg`.
 * No hay que tocar codigo. Si el archivo no existe, la tarjeta muestra un
 * monograma con las iniciales y sigue viendose bien.
 *
 * Formato sugerido: cuadrada, 600x600 px o mas, JPG o PNG.
 */

export interface Member {
  /** Nombre del archivo de foto, sin extension. */
  slug: string;
  name: string;
  role: string;
  /** Que hace en el proyecto, en una o dos lineas. */
  blurb: string;
  /** Etiquetas cortas de su frente de trabajo. */
  tags: string[];
  /** Rama de GitHub que le corresponde. */
  branch: string;
}

export const TEAM: Member[] = [
  {
    slug: "angelo",
    name: "Angelo",
    role: "Procesamiento geoespacial",
    blurb: "Extrae los focos en Earth Engine y los agrega por territorio.",
    tags: ["Earth Engine", "QA de sensores", "Agregación zonal"],
    branch: "feature/gee-data-pipeline",
  },
  {
    slug: "tom",
    name: "Tom",
    role: "Analítica y armonización",
    blurb: "Convierte las tablas en tasas, anomalías y el árbol de susceptibilidad.",
    tags: ["Python", "Anomalías", "Árbol de reglas"],
    branch: "feature/analytics-engine",
  },
  {
    slug: "jhan",
    name: "Jhan",
    role: "Backend e integración",
    blurb: "Construye la API de solo lectura y mantiene el contrato entre módulos.",
    tags: ["FastAPI", "Contrato REST", "Integración"],
    branch: "feature/api-backend",
  },
  {
    slug: "sebastian",
    name: "Sebastian",
    role: "Interfaz y experiencia",
    blurb: "Diseña y desarrolla la aplicación: mapa, calendario y simulación.",
    tags: ["React", "Leaflet", "Diseño"],
    branch: "feature/frontend-dashboard",
  },
  {
    slug: "jean-pierrer",
    name: "Jean Pierrer",
    role: "Producto, calidad y relato",
    blurb: "Reúne las capas oficiales, verifica la evidencia y arma el relato.",
    tags: ["Fuentes", "QA de producto", "Presentación"],
    branch: "feature/product-qa-demo",
  },
];

export function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
