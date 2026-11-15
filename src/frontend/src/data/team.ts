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
    role: "Datos NASA, propagación y backend",
    blurb: "Integra datos ambientales de fuentes abiertas y de la NASA, implementa el modelo de propagación y desarrolla el backend.",
    linkedin: "https://www.linkedin.com/in/angelo-castillo-guanilo/",
    github: "https://github.com/Ancas-Red",
    branch: "feature/gee-data-pipeline",
  },
  {
    slug: "tom",
    name: "Tom",
    role: "Líder, analítica e integración",
    blurb: "Lidera el proyecto, articula el motor analítico con la arquitectura general y coordina la integración entre áreas.",
    linkedin: "https://www.linkedin.com/in/tomjordanpl/",
    github: "https://github.com/TomJordan1",
    branch: "feature/analytics-engine",
  },
  {
    slug: "sebastian",
    name: "Sebastian",
    role: "Frontend, hosting y despliegue",
    blurb: "Desarrolló el frontend inicial y configura el hosting, el dominio y todo el despliegue de la plataforma.",
    linkedin: "https://www.linkedin.com/in/sebastian-esteban-quispe-rosas-b7a652378/",
    github: "https://github.com/sebastiansb1232-boop",
    branch: "feature/frontend-dashboard",
  },
  {
    slug: "jean-pierrer",
    name: "Jean Pierrer",
    role: "Documentación, revisión y presentación",
    blurb: "Desarrolla la documentación y la presentación del proyecto, realizando revisiones para evitar omisiones clave.",
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
