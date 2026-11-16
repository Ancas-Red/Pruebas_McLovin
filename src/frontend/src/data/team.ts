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
    role: "NASA data, spread model and backend",
    blurb: "Integrates environmental data from open sources and NASA, implements the spread model and develops the backend.",
    linkedin: "https://www.linkedin.com/in/angelo-castillo-guanilo/",
    github: "https://github.com/Ancas-Red",
    branch: "feature/gee-data-pipeline",
  },
  {
    slug: "tom",
    name: "Tom",
    role: "Lead, analytics and integration",
    blurb: "Leads the project, connects the analytics engine with the overall architecture and coordinates integration across areas.",
    linkedin: "https://www.linkedin.com/in/tomjordanpl/",
    github: "https://github.com/TomJordan1",
    branch: "feature/analytics-engine",
  },
  {
    slug: "sebastian",
    name: "Sebastian",
    role: "Frontend, hosting and deployment",
    blurb: "Built the initial frontend and sets up the hosting, the domain and the whole platform deployment.",
    linkedin: "https://www.linkedin.com/in/sebastian-esteban-quispe-rosas-b7a652378/",
    github: "https://github.com/sebastiansb1232-boop",
    branch: "feature/frontend-dashboard",
  },
  {
    slug: "jean-pierrer",
    name: "Jean Pierrer",
    role: "Documentation, review and presentation",
    blurb: "Develops the project documentation and presentation, running reviews to avoid key omissions.",
    linkedin: "https://www.linkedin.com/in/jean-pierrer-anthony-cercado-flores-aa9731210/",
    github: "https://github.com/jeancercado",
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
