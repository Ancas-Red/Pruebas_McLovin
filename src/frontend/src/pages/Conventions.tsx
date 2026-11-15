import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "../components/SiteFooter";
import { Starfield } from "../components/Starfield";
import { McTropicReader } from "../components/McTropicReader";
import { revealSectionBatch } from "../lib/reveal";
import {
  CONV_CATEGORIES,
  CONV_GATES,
  CONV_GLOSSARY,
  CONV_STANDARDS,
  type ConvCategory,
  type ConvIconKey,
  type ConvStandard,
} from "../data/conventions";

interface Props {
  onOpenMap: () => void;
  onOpenLanding: () => void;
  onOpenTech: () => void;
}

const CONV_SECTIONS = [
  { id: "resumen", label: "Normativa" },
  { id: "marcos", label: "Estándares" },
  { id: "compuertas", label: "Compuertas" },
  { id: "glosario", label: "Glosario UI" },
];

export function Conventions({ onOpenMap, onOpenLanding, onOpenTech }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [category, setCategory] = useState<ConvCategory>("todos");

  const visibleStandards = useMemo(
    () =>
      category === "todos"
        ? CONV_STANDARDS
        : CONV_STANDARDS.filter((item) => item.category === category),
    [category]
  );

  const countsByCategory = useMemo(() => {
    const counts: Record<ConvCategory, number> = {
      todos: CONV_STANDARDS.length,
      internacional: 0,
      satelital: 0,
      nacional: 0,
    };
    for (const item of CONV_STANDARDS) {
      counts[item.category] += 1;
    }
    return counts;
  }, []);

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
        return CONV_SECTIONS.length - 1;
      }
      const refY = rect.top + rect.height * 0.45;
      for (let i = CONV_SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(CONV_SECTIONS[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= refY) return i;
      }
      return 0;
    };

    const syncReveals = (currentActive: number) => {
      const rootRect = root.getBoundingClientRect();
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 12;

      for (let idx = 0; idx < CONV_SECTIONS.length; idx++) {
        if (idx > currentActive) continue;
        const section = document.getElementById(CONV_SECTIONS[idx].id);
        if (!section) continue;

        revealSectionBatch({
          section,
          rootRect,
          atBottom,
          threshold: 36,
          staggerMs: 65,
          maxDelayMs: 360,
          ctx: revealCtx,
          prioritizeFooterOnJump: idx === CONV_SECTIONS.length - 1,
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

      <nav className="dots" aria-label="Secciones de convenciones y normativa">
        {CONV_SECTIONS.map((s, i) => (
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
      <section className="tech-section tech-hero" id="resumen">
        <div className="wrap">
          <div className="tech-hero__grid">
            <div className="tech-hero__head">
              <p className="eyebrow" data-reveal>
                00 · Marco Normativo y Convenciones
              </p>
              <h1 className="tech-hero__title" data-reveal>
                Cada etiqueta responde a una
                <span className="hero__accent">norma y límite científico.</span>
              </h1>
              <p className="block__lead tech-hero__lead" data-reveal>
                McHanaq adopta vocabulario estandarizado internacional y marcos normativos de Perú y
                Argentina para evitar confusiones críticas: distingue anomalía térmica de ignición,
                susceptibilidad física de riesgo humano, y dato nulo de ausencia real de fuego.
              </p>

              <div className="hero__cta tech-hero__cta" data-reveal>
                <button className="btn btn--lg" onClick={() => goTo("marcos")}>
                  Explorar marcos y leyes ↓
                </button>
              </div>
            </div>

            <div className="tech-hero__terminal" data-reveal>
              <McTropicReader />
            </div>
          </div>

          <dl className="facts tech-facts" data-reveal>
            <div>
              <dt>Estándares internacionales</dt>
              <dd>UNDRR · FAO · Copernicus EFFIS · WMO-No. 1203</dd>
            </div>
            <div>
              <dt>Reglas satelitales y físicas</dt>
              <dd>NASA FIRMS QA · Rothermel · Anderson · Huete SAVI</dd>
            </div>
            <div>
              <dt>Marco regional documentado</dt>
              <dd>Perú CENEPRED / INEI / ANA · Arg. Ley N.º 26.815</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* =============================================== 01 NORMAS Y LEYES === */}
      <section className="tech-section" id="marcos">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                01 · Reglamentos, estándares y literatura
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Fuentes institucionales y científicas de respaldo.
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Reúne las convenciones ya documentadas en el expediente técnico (CENEPRED/SERFOR, Ley
              26.815, FIRMS y literatura física) junto con los estándares internacionales UNDRR, FAO,
              EFFIS y OMM aplicados en el visor.
            </p>
          </div>

          <div
            className="tech-filters"
            role="tablist"
            aria-label="Filtrar marcos normativos por ámbito"
            data-reveal
          >
            {CONV_CATEGORIES.map((cat) => (
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

          <div className={`tech-cards${visibleStandards.length === 2 ? " tech-cards--two" : ""}`}>
            {visibleStandards.map((item) => (
              <div key={item.id} className="tech-card-slot" data-reveal>
                <ConventionCard item={item} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================= 02 COMPUERTAS === */}
      <section className="tech-section" id="compuertas">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                02 · Compuertas metodológicas
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Reglas que impiden inferencias falsas.
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Antes de pintar una provincia, cuenca o día en el calendario, cuatro compuertas
              verifican calidad de píxel, suficiencia histórica y trazabilidad del árbol N0–N3.
            </p>
          </div>

          <div className="pipeline">
            {CONV_GATES.map((gate) => (
              <article key={gate.step} className="pipeline__step" data-reveal>
                <div className="pipeline__top">
                  <span className="pipeline__num">{gate.step}</span>
                  <span className="pipeline__layer">{gate.layer}</span>
                </div>
                <h3 className="pipeline__title">{gate.title}</h3>
                <dl className="pipeline__meta">
                  <div>
                    <dt>Criterio</dt>
                    <dd>{gate.input}</dd>
                  </div>
                  <div>
                    <dt>Regla</dt>
                    <dd>{gate.process}</dd>
                  </div>
                  <div>
                    <dt>Efecto UI</dt>
                    <dd>{gate.output}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================= 03 GLOSARIO UI === */}
      <section className="tech-section tech-section--last" id="glosario">
        <div className="wrap">
          <div className="tech-head">
            <div>
              <p className="eyebrow" data-reveal>
                03 · Glosario de estados y etiquetas
              </p>
              <h2 className="block__title tech-head__title" data-reveal>
                Qué significa exactamente cada estado visible.
              </h2>
            </div>
            <p className="block__lead" data-reveal>
              Equivalencia directa entre los códigos del contrato REST (`contracts/data-dictionary.md`)
              y las etiquetas mostradas en mapas, tarjetas emergentes y calendario.
            </p>
          </div>

          <div className="specs specs--2">
            {CONV_GLOSSARY.map((term) => (
              <div key={term.title} className="spec" data-reveal>
                <span className="spec__label">
                  {term.code} · {term.standard}
                </span>
                <strong className="spec__val">{term.title}</strong>
                <p className="spec__detail">{term.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="tech-foot-band">
          <div className="wrap">
            <SiteFooter
              route="convenciones"
              onNavigate={(r) => {
                if (r === "mapa") onOpenMap();
                else if (r === "tecnologia") onOpenTech();
                else if (r === "inicio") onOpenLanding();
                else goTo("resumen");
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ConventionCard({ item }: { item: ConvStandard }) {
  return (
    <article className="tech-card">
      <div className="tech-card__top">
        <div className="tech-card__id">
          <span className="tech-card__icon" aria-hidden="true">
            <ConvIcon kind={item.icon} />
          </span>
          <div className="tech-card__headings">
            <h3 className="tech-card__title">{item.name}</h3>
            <span className="tech-card__badge">
              {item.code} · {item.categoryLabel}
            </span>
          </div>
        </div>
        <a
          className="tech-card__ext"
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`Referencia oficial: ${item.name}`}
          aria-label={`Referencia oficial: ${item.name}`}
        >
          ↗
        </a>
      </div>

      <p className="tech-card__summary">{item.summary}</p>

      <div className="tech-card__uses">
        <span className="tech-card__uses-label">Aplicación en McHanaq ({item.traceability})</span>
        <ul>
          {item.adoptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ConvIcon({ kind }: { kind: ConvIconKey }) {
  switch (kind) {
    case "shield":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M8 1.8 13.5 4v4.2c0 3.2-2.3 5.2-5.5 6.3-3.2-1.1-5.5-3.1-5.5-6.3V4L8 1.8Z" />
          <path d="M5.7 8.1 7.3 9.7 10.6 6.4" />
        </svg>
      );
    case "flame":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M8.6 1.8c.4 2.1 2.9 3.4 2.9 6.2a3.5 3.5 0 1 1-7 0c0-1.6.9-2.8 1.9-3.9.2 1.2 1 1.7 1.6 1.7-.4-1.3.1-2.8.6-4Z" />
        </svg>
      );
    case "globe":
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
    case "satellite":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="5.5" strokeOpacity="0.45" />
          <path d="M2 14 14 2" />
          <rect x="6" y="6" width="4" height="4" fill="currentColor" fillOpacity="0.2" />
        </svg>
      );
    case "model":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <ellipse cx="8" cy="8" rx="6" ry="3.2" transform="rotate(-24 8 8)" />
          <circle cx="6.2" cy="8.8" r="1.4" fill="currentColor" />
        </svg>
      );
    case "peru":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2.2" y="3" width="11.6" height="10" />
          <path d="M6.1 3v10M9.9 3v10" />
        </svg>
      );
    case "basin":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2.5 11.5c2-2 3.5-4.8 5.5-7 1.2 1.8 2.6 3.5 5.5 7" />
          <path d="M2 13.5h12" strokeOpacity="0.55" />
        </svg>
      );
    case "argentina":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2.2" y="3" width="11.6" height="10" />
          <path d="M2.2 6.4h11.6M2.2 9.6h11.6" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
        </svg>
      );
  }
}
