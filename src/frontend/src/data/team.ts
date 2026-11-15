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
  /** URL del perfil de LinkedIn (opcional mientras se completa). */
  linkedin?: string;
  /** URL del perfil de GitHub (opcional mientras se completa). */
  github?: string;
  /** Rama de GitHub que le corresponde. */
  branch: string;
}

export const TEAM: Member[] = [
  {
    slug: "angelo",
    name: "Angelo",
    role: "Procesamiento geoespacial",
    blurb:
      "Lidera Google Earth Engine: extrae los focos de MODIS y VIIRS, decodifica la calidad de cada producto y agrega los resultados por territorio.",
    github: "https://github.com/Ancas-Red",
    branch: "feature/gee-data-pipeline",
  },
  {
    slug: "tom",
    name: "Tom",
    role: "Líder y coordinación general",
    blurb:
      "Lidera el proyecto y articula al equipo entre áreas, conectando datos satelitales, analítica, backend e interfaz de extremo a extremo.",
    linkedin: "https://www.linkedin.com/in/tomjordanpl/",
    github: "https://github.com/TomJordan1",
    branch: "feature/analytics-engine",
  },
  {
    slug: "jhan",
    name: "Jhan",
    role: "Backend e integración",
    blurb:
      "Construye la API de solo lectura que entrega los resultados ya calculados y mantiene el contrato entre los módulos.",
    branch: "feature/api-backend",
  },
  {
    slug: "sebastian",
    name: "Sebastian",
    role: "Interfaz y experiencia",
    blurb:
      "Diseña y desarrolla la aplicación: el mapa, el calendario, las fichas territoriales y la simulación de recorrido.",
    branch: "feature/frontend-dashboard",
  },
  {
    slug: "jean-pierrer",
    name: "Jean Pierrer",
    role: "Producto, calidad y relato",
    blurb:
      "Reúne las capas territoriales oficiales, mantiene el contrato legible, verifica la evidencia y construye la narrativa del proyecto.",
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
