import { useEffect, useRef, useState } from "react";
import { Planet } from "../components/Planet";
import { TEAM, initials, type Member } from "../data/team";

interface Props {
  onOpenMap: () => void;
}

const BLOCKS = [
  { id: "inicio", label: "Inicio" },
  { id: "problema", label: "El problema" },
  { id: "solucion", label: "La solución" },
  { id: "flujo", label: "Cómo funciona" },
  { id: "equipo", label: "El equipo" },
  { id: "alcance", label: "Alcance" },
];

export function Landing({ onOpenMap }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Marca el bloque visible para la navegación lateral.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = BLOCKS.findIndex((b) => b.id === e.target.id);
            if (i >= 0) setActive(i);
          }
        }
      },
      { root, threshold: 0.55 }
    );
    BLOCKS.forEach((b) => {
      const el = document.getElementById(b.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing" ref={scrollerRef}>
      <div className="landing__bg">
        <Planet />
      </div>

      <nav className="dots" aria-label="Secciones">
        {BLOCKS.map((b, i) => (
          <button
            key={b.id}
            className="dots__item"
            aria-current={active === i}
            onClick={() => goTo(b.id)}
          >
            <span className="dots__mark" />
            <span className="dots__label">{b.label}</span>
          </button>
        ))}
      </nav>

      {/* ---------------------------------------------------------- 1 ---- */}
      <section className="block block--hero" id="inicio">
        <div className="wrap">
          <p className="eyebrow">NASA Space Apps Challenge 2026 · Equipo Los McLovin</p>
          <h1 className="hero__title">
            El fuego deja huella.
            <br />
            <span className="hero__accent">Nosotros la ordenamos.</span>
          </h1>
          <p className="hero__lead">
            Dos décadas de focos térmicos repartidos entre satélites que no se pueden comparar
            directamente. McHanaq los reúne en un calendario territorial del Perú: cuándo arde cada
            provincia y cada cuenca, qué tan inusual es y qué tan de acuerdo están los sensores.
          </p>
          <div className="hero__cta">
            <button className="btn btn--primary btn--lg" onClick={onOpenMap}>
              Abrir el mapa →
            </button>
            <button className="btn btn--lg" onClick={() => goTo("problema")}>
              Ver el proyecto
            </button>
          </div>
          <dl className="facts">
            <div>
              <dt>Serie histórica</dt>
              <dd>2000 — hoy</dd>
            </div>
            <div>
              <dt>Sensores</dt>
              <dd>MODIS ×2 · VIIRS</dd>
            </div>
            <div>
              <dt>Escala</dt>
              <dd>Provincias y cuencas</dd>
            </div>
            <div>
              <dt>Territorio</dt>
              <dd>Perú</dd>
            </div>
          </dl>
        </div>
        <button className="scroll-cue" onClick={() => goTo("problema")} aria-label="Bajar">
          <span />
        </button>
      </section>

      {/* ---------------------------------------------------------- 2 ---- */}
      <section className="block" id="problema">
        <div className="wrap wrap--split">
          <div>
            <p className="eyebrow">01 · El problema</p>
            <h2 className="block__title">
              Un mapa de puntos no responde las preguntas que importan.
            </h2>
            <p className="block__lead">
              Ver dónde hay focos hoy es el primer paso, no el último. Quien vigila un territorio
              necesita saber si lo que pasa es raro para esta época del año, si se repite durante
              días, cuánto alcanzó a observar el satélite y si las fuentes coinciden.
            </p>
          </div>
          <ul className="qlist">
            <li>¿Esta actividad es inusual para esta época en esta provincia?</li>
            <li>¿Son detecciones sueltas o algo que se repite varios días?</li>
            <li>¿Cuánto del territorio llegó a observarse, y cuánto tapó la nube?</li>
            <li>¿En qué coinciden y en qué discrepan Terra, Aqua y VIIRS?</li>
            <li>¿Qué condiciones de vegetación, sequedad y relieve hay detrás?</li>
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------- 3 ---- */}
      <section className="block" id="solucion">
        <div className="wrap">
          <p className="eyebrow">02 · La solución</p>
          <h2 className="block__title">Cuatro piezas sobre una misma base de datos.</h2>
          <div className="cards">
            <article className="card">
              <span className="card__idx">01</span>
              <h3>Calendario territorial</h3>
              <p>
                Veintiséis años de actividad en una sola vista. Los meses en filas y los años en
                columnas hacen visible la estación seca de un vistazo.
              </p>
            </article>
            <article className="card">
              <span className="card__idx">02</span>
              <h3>Armonización honesta</h3>
              <p>
                Cada sensor conserva su identidad. Se unifican definiciones, ventanas y polígonos, y
                se normaliza por observación válida. Nunca se suman conteos.
              </p>
            </article>
            <article className="card">
              <span className="card__idx">03</span>
              <h3>Anomalía y cobertura</h3>
              <p>
                Cada mes se compara con el mismo mes de años anteriores, y siempre se muestra cuánto
                se pudo observar. Una nube no es ausencia de fuego.
              </p>
            </article>
            <article className="card">
              <span className="card__idx">04</span>
              <h3>Susceptibilidad y recorrido</h3>
              <p>
                Un árbol de reglas transparente describe qué tan favorable es el territorio a que un
                fuego se extienda, con su ruta de decisión a la vista.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- 4 ---- */}
      <section className="block" id="flujo">
        <div className="wrap">
          <p className="eyebrow">03 · Cómo funciona</p>
          <h2 className="block__title">Del satélite a la pantalla, sin atajos.</h2>
          <ol className="flow">
            {[
              {
                k: "Fuentes",
                v: "MOD14A1, MYD14A1 y VNP14A1 diarios de 1 km, más contexto ambiental y topográfico.",
              },
              {
                k: "Earth Engine",
                v: "Filtrado por calidad, separación de confianzas y agregación por provincia y cuenca.",
              },
              {
                k: "Analítica",
                v: "Tasas normalizadas, persistencia, anomalías robustas y el árbol de reglas.",
              },
              {
                k: "API",
                v: "Entrega de solo lectura de los resultados ya calculados, con su procedencia.",
              },
              {
                k: "Interfaz",
                v: "Mapa, calendario y fichas. No recalcula nada ni inventa valores que faltan.",
              },
            ].map((s, i) => (
              <li key={s.k}>
                <span className="flow__n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{s.k}</h3>
                <p>{s.v}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------- 5 ---- */}
      <section className="block" id="equipo">
        <div className="wrap">
          <p className="eyebrow">04 · El equipo</p>
          <h2 className="block__title">Los McLovin</h2>
          <p className="block__lead block__lead--narrow">
            Cinco frentes de trabajo, una sola ruta de datos. Cada integrante es dueño de su carpeta
            y de su rama.
          </p>
          <div className="team">
            {TEAM.map((m) => (
              <MemberCard key={m.slug} member={m} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- 6 ---- */}
      <section className="block" id="alcance">
        <div className="wrap wrap--split">
          <div>
            <p className="eyebrow">05 · Alcance</p>
            <h2 className="block__title">Lo que hace, y lo que no.</h2>
            <p className="block__lead">
              Decir con precisión dónde están los límites es parte del trabajo. Una herramienta de
              exploración histórica es útil; una que promete más de lo que puede, no.
            </p>
            <div className="hero__cta" style={{ marginTop: 26 }}>
              <button className="btn btn--primary btn--lg" onClick={onOpenMap}>
                Abrir el mapa →
              </button>
            </div>
          </div>
          <div className="scope">
            <div className="scope__col scope__col--yes">
              <h3>Sí hace</h3>
              <ul>
                <li>Calendario histórico por provincia y cuenca</li>
                <li>Comparación entre sensores con su cobertura</li>
                <li>Anomalías frente al mismo mes de otros años</li>
                <li>Contexto ambiental con fuente, unidad y fecha</li>
                <li>Descarga de focos en CSV y del área en GeoJSON</li>
              </ul>
            </div>
            <div className="scope__col scope__col--no">
              <h3>No hace</h3>
              <ul>
                <li>Predecir dónde o cuándo se iniciará un incendio</li>
                <li>Estimar probabilidad de ignición</li>
                <li>Confundir un foco térmico con un incendio confirmado</li>
                <li>Sustituir a las autoridades competentes</li>
                <li>Servir como sistema de alerta operativa</li>
              </ul>
            </div>
          </div>
        </div>
        <footer className="landing__foot">
          <span>McHanaq · Los McLovin · Perú 2026</span>
          <span className="muted">
            Datos: NASA LP DAAC · Copernicus ERA5-Land · SRTM · MapBiomas Perú
          </span>
        </footer>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Tarjeta de integrante.
 *
 * La foto se busca en `public/equipo/<slug>.jpg` y, si no está, en `.png`.
 * Si tampoco está, se dibuja un monograma. Así cada uno solo tiene que dejar
 * su archivo en la carpeta, sin tocar código.
 */
function MemberCard({ member }: { member: Member }) {
  const [attempt, setAttempt] = useState(0);
  const sources = [`./equipo/${member.slug}.jpg`, `./equipo/${member.slug}.png`];
  const src = sources[attempt];

  return (
    <article className="member">
      <div className="member__photo">
        {src ? (
          <img
            src={src}
            alt={`Fotografía de ${member.name}`}
            loading="lazy"
            onError={() => setAttempt((a) => a + 1)}
          />
        ) : (
          <span className="member__mono" aria-hidden="true">
            {initials(member.name)}
          </span>
        )}
        <span className="member__ring" aria-hidden="true" />
      </div>
      <h3 className="member__name">{member.name}</h3>
      <p className="member__role">{member.role}</p>
      <p className="member__blurb">{member.blurb}</p>
      <ul className="member__tags">
        {member.tags.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <code className="member__branch">{member.branch}</code>
    </article>
  );
}
