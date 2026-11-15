import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "../components/SiteFooter";
import { Starfield } from "../components/Starfield";
import { TechTerminal } from "../components/TechTerminal";
import { revealSectionBatch } from "../lib/reveal";
import {
  PIPELINE_STAGES,
  TECH_CATEGORIES,
  TECH_ITEMS,
  TECH_SPECS,
  type TechCategory,
  type TechIconKey,
  type TechItem,
} from "../data/tech";

interface Props {
  onOpenMap: () => void;
  onOpenLanding: () => void;
}

const TECH_SECTIONS = [
  { id: "arquitectura", label: "Arquitectura" },
  { id: "stack", label: "Stack y APIs" },
  { id: "ruta-datos", label: "Ruta de datos" },
  { id: "parametros", label: "Parámetros" },
];

export function TechStack({ onOpenMap, onOpenLanding }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [category, setCategory] = useState<TechCategory>("todas");

  const visibleItems = useMemo(
    () =>
      category === "todas"
        ? TECH_ITEMS
        : TECH_ITEMS.filter((item) => item.category === category),
    [category]
  );

  const countsByCategory = useMemo(() => {
    const counts: Record<TechCategory, number> = {
      todas: TECH_ITEMS.length,
      satelital: 0,
      procesamiento: 0,
      backend: 0,
      frontend: 0,
    };
    for (const item of TECH_ITEMS) {
      counts[item.category] += 1;
    }
    return counts;
  }, []);

  /**
   * Sincroniza la barra lateral (`.dots`) con la aparición progresiva de cada
   * bloque de la página técnica al entrar en el viewport.
   */
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealCtx = {
      revealedEls: new WeakSet<HTMLElement>(),
      timers: [] as number[],
      reduce,
    };

    const computeActive = (): number => {
      const rect = root.getBoundingClientRect();
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 12) {
        return TECH_SECTIONS.length - 1;
      }
      const refY = rect.top + rect.height * 0.45;
      for (let i = TECH_SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(TECH_SECTIONS[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= refY) return i;
      }
      return 0;
    };

    const syncReveals = (currentActive: number) => {
      const rootRect = root.getBoundingClientRect();
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 12;

      for (let idx = 0; idx < TECH_SECTIONS.length; idx++) {
        if (idx > currentActive) continue;
        const section = document.getElementById(TECH_SECTIONS[idx].id);
        if (!section) continue;

        revealSectionBatch({
          section,
          rootRect,
          atBottom,
          threshold: 36,
          staggerMs: 65,
          maxDelayMs: 360,
          ctx: revealCtx,
          prioritizeFooterOnJump: idx === TECH_SECTIONS.length - 1,
        });
      }
    };

    const sync = () => {
      const next = computeActive();
      setActiveSection((prev) => (prev === next ? prev : next));
      syncReveals(next);
    };

    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    };

    const initRaf = requestAnimationFrame(sync);
    root.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      cancelAnimationFrame(initRaf);
      if (raf) cancelAnimationFrame(raf);
      revealCtx.timers.forEach((t) => window.clearTimeout(t));
      root.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [category]);

  const goTo = (id: string) => {
    const root = scrollerRef.current;
    const el = document.getElementById(id);
    if (!root || !el) return;
    root.scrollTo({
      top: el.offsetTop - 24,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <div className="tech" ref={scrollerRef}>
      <div className="tech__bg" aria-hidden="true">
        <Starfield />
      </div>

      <nav className="dots" aria-label="Secciones de arquitectura">
        {TECH_SECTIONS.map((s, i) => (
          <button
            key={s.id}
            className="dots__item"
            aria-current={activeSection === i}
            onClick={() => goTo(s.id)}
          >
            <span className="dots__label">{s.label}</span>
            <span className="dots__mark" />
          </button>
        ))}
      </nav>

      {/* ======================================================= 00 HERO === */}
      <section className="tech-section tech-hero" id="arquitectura">
        <div className="wrap">
          <div className="tech-hero__grid">
            <div className="tech-hero__head">
              <p className="eyebrow" data-reveal>
                00 · Arquitectura y Stack Técnico
              </p>
              <h1 className="tech-hero__title" data-reveal>
                Cómo convertimos órbitas en
                <span className="hero__accent">evidencia territorial.</span>
              </h1>
              <p className="block__lead tech-hero__lead" data-reveal>
                McHanaq separa el cómputo satelital pesado de la consulta web interactiva. Google
                Earth Engine extrae y agrega las series diarias; Python normaliza tasas, anomalías y
                reglas explicables; y FastAPI sirve artefactos precomputados de solo lectura hacia el
                visor Leaflet.
              </p>

              <div className="hero__cta tech-hero__cta" data-reveal>
                <button className="btn btn--lg" onClick={() => goTo("stack")}>
                  Explorar tecnologías ↓
                </button>
              </div>
            </div>

            <div className="tech-hero__terminal" data-reveal>
              <TechTerminal />
            </div>
          </div>

          <dl className="facts tech-facts" data-reveal>
            <div>
              <dt>Ventana común Perú</dt>
              <dd>2012-01-19 — 2026-11-02</dd>
            </div>
            <div>
              <dt>Cobertura mínima diaria</dt>
              <dd>Nubosidad &lt; 30 % (≥ 0.70)</dd>
            </div>
            <div>
              <dt>Modelo de ejecución HTTP</dt>
              <dd>Solo lectura · 0 consultas a GEE</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ================================================= 01 STACK Y APIS === */}
      <section className="tech-section" id="stack">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                01 · Stack, sensores y servicios
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Plataformas y motores que sostienen cada capa.
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Cada herramienta cumple un rol acotado y trazable dentro de la ruta de datos, desde la
              decodificación de píxeles térmicos hasta el despliegue sin costo operativo.
            </p>
          </div>

          <div
            className="tech-filters"
            role="tablist"
            aria-label="Filtrar tecnologías por capa"
            data-reveal
          >
            {TECH_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                className="tech-filter"
                aria-selected={category === cat.id}
                onClick={() => setCategory(cat.id)}
              >
                <span>{cat.label}</span>
                <span className="tech-filter__count">{countsByCategory[cat.id]}</span>
              </button>
            ))}
          </div>

          <div className={`tech-cards${visibleItems.length === 2 ? " tech-cards--two" : ""}`}>
            {visibleItems.map((item) => (
              <div key={item.id} className="tech-card-slot" data-reveal>
                <TechCard item={item} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================ 02 RUTA DE DATOS === */}
      <section className="tech-section" id="ruta-datos">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                02 · Ruta de datos desacoplada
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Cuatro etapas del píxel crudo al navegador.
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Ninguna petición del usuario dispara descargas externas ni cálculos sobre Earth Engine:
              toda la serie histórica se compila antes del despliegue.
            </p>
          </div>

          <div className="pipeline">
            {PIPELINE_STAGES.map((stage) => (
              <article key={stage.step} className="pipeline__step" data-reveal>
                <div className="pipeline__top">
                  <span className="pipeline__num">{stage.step}</span>
                  <span className="pipeline__layer">{stage.layer}</span>
                </div>
                <h3 className="pipeline__title">{stage.title}</h3>
                <dl className="pipeline__meta">
                  <div>
                    <dt>Entrada</dt>
                    <dd>{stage.input}</dd>
                  </div>
                  <div>
                    <dt>Transformación</dt>
                    <dd>{stage.process}</dd>
                  </div>
                  <div>
                    <dt>Salida</dt>
                    <dd className="pipeline__out">{stage.output}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================== 03 PARÁMETROS === */}
      <section className="tech-section tech-section--last" id="parametros">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                03 · Rigor metodológico y umbrales
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Parámetros verificados a escala nacional (Perú).
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Reglas explícitas definidas en la documentación técnica y validadas mediante contratos
              de datos automatizados.
            </p>
          </div>

          <div className="specs">
            {TECH_SPECS.map((spec) => (
              <div key={spec.label} className="spec" data-reveal>
                <span className="spec__label">{spec.label}</span>
                <strong className="spec__val">{spec.value}</strong>
                <p className="spec__detail">{spec.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="tech-foot-band">
          <div className="wrap">
            <SiteFooter
              route="tecnologia"
              onNavigate={(r) => {
                if (r === "mapa") onOpenMap();
                else if (r === "inicio") onOpenLanding();
                else goTo("arquitectura");
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TechCard({ item }: { item: TechItem }) {
  return (
    <article className="tech-card">
      <div className="tech-card__top">
        <div className="tech-card__id">
          <span className="tech-card__icon" aria-hidden="true">
            <TechIcon kind={item.icon} />
          </span>
          <div className="tech-card__headings">
            <h3 className="tech-card__title">{item.name}</h3>
            <span className="tech-card__badge">{item.categoryLabel}</span>
          </div>
        </div>
        <a
          className="tech-card__ext"
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`Documentación oficial de ${item.name}`}
          aria-label={`Documentación oficial de ${item.name}`}
        >
          ↗
        </a>
      </div>

      <p className="tech-card__summary">{item.summary}</p>

      <div className="tech-card__uses">
        <span className="tech-card__uses-label">Usos en McHanaq</span>
        <ul>
          {item.uses.map((use) => (
            <li key={use}>{use}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function TechIcon({ kind }: { kind: TechIconKey }) {
  switch (kind) {
    case "satellite":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="5.5" strokeOpacity="0.45" />
          <path d="M2 14L14 2" />
          <rect x="6" y="6" width="4" height="4" fill="currentColor" fillOpacity="0.2" />
        </svg>
      );
    case "viirs":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
          <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" />
        </svg>
      );
    case "gee":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="6" />
          <ellipse cx="8" cy="8" rx="2.6" ry="6" />
          <path d="M2 8h12" />
        </svg>
      );
    case "climate":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 10.5C3.5 9 5 9 6.5 10.5S9.5 12 11 10.5 13 9 14 10" />
          <path d="M2 6h8.5a2 2 0 1 0-2-2" />
        </svg>
      );
    case "python":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M4 5.5L2 8l2 2.5M12 5.5L14 8l-2 2.5M9.5 3.5L6.5 12.5" />
        </svg>
      );
    case "api":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2" y="3" width="12" height="4" />
          <rect x="2" y="9" width="12" height="4" />
          <path d="M4.5 5h1M4.5 11h1" />
        </svg>
      );
    case "cloud":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M4.5 12h7.2a2.5 2.5 0 0 0 .3-4.98A4 4 0 0 0 4.3 6.2 2.9 2.9 0 0 0 4.5 12Z" />
        </svg>
      );
    case "react":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <ellipse cx="8" cy="8" rx="6.2" ry="2.4" />
          <ellipse cx="8" cy="8" rx="6.2" ry="2.4" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.2" ry="2.4" transform="rotate(120 8 8)" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
        </svg>
      );
    case "map":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 3.5l4-1.3 4 1.5 4-1.3v10.1l-4 1.3-4-1.5-4 1.3V3.5Z" />
          <path d="M6 2.2v10.1M10 3.7v10.1" strokeOpacity="0.5" />
        </svg>
      );
  }
}
