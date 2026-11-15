import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Globe } from "../components/Globe";
import { SiteFooter } from "../components/SiteFooter";
import { TEAM, initials, type Member } from "../data/team";
import { revealFooterFirstIfJumping, revealSectionBatch } from "../lib/reveal";

interface Props {
  onOpenMap: () => void;
  onOpenTech?: () => void;
  onOpenConventions?: () => void;
  /** Retiene el inicio del efecto máquina mientras la cortina de carga está activa. */
  suspendTypewriter?: boolean;
}

const BLOCKS = [
  { id: "inicio", label: "Inicio" },
  { id: "proyecto", label: "El proyecto" },
  { id: "equipo", label: "El equipo" },
];

const TEAM_IDX = 2;
/** Espera breve para que las luces del planeta se atenúen antes de dibujar #equipo. */
const TEAM_LIGHTS_DELAY_MS = 380;
const HERO_LINE_1 = "El fuego deja huella.";
const HERO_TEMP_LINE = "Tranquilo.";
const HERO_LINE_2 = "Nosotros lo ordenamos.";

export function Landing({
  onOpenMap,
  onOpenTech,
  onOpenConventions,
  suspendTypewriter = false,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  /**
   * Sincroniza la barra lateral (`.dots`), el apagado de luces del planeta y la
   * aparición progresiva del contenido:
   * - Ningún bloque empieza a revelarse antes de que `.dots` lo marque activo.
   * - En `#equipo`, primero se atenúan las luces del planeta (~380 ms) y luego
   *   cada elemento entra poco a poco conforme aparece en el viewport.
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
    let teamUnlocked = reduce;
    let teamDelayTimer: number | null = null;

    const computeActive = (): number => {
      const rect = root.getBoundingClientRect();
      // Al llegar al fondo del contenedor, activa el último bloque aunque sea corto.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 12) {
        return BLOCKS.length - 1;
      }
      const refY = rect.top + rect.height * 0.52;
      for (let i = BLOCKS.length - 1; i >= 0; i--) {
        const el = document.getElementById(BLOCKS[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= refY) return i;
      }
      return 0;
    };

    const syncReveals = (currentActive: number) => {
      const rootRect = root.getBoundingClientRect();
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 12;

      for (let idx = 0; idx < BLOCKS.length; idx++) {
        if (idx > currentActive) continue;
        const section = document.getElementById(BLOCKS[idx].id);
        if (!section) continue;

        if (idx === TEAM_IDX && !teamUnlocked) {
          revealFooterFirstIfJumping(section, atBottom, revealCtx);
          continue;
        }

        revealSectionBatch({
          section,
          rootRect,
          atBottom,
          threshold: idx === TEAM_IDX ? 52 : 20,
          staggerMs: 80,
          maxDelayMs: 400,
          ctx: revealCtx,
          getItemDelay:
            idx === TEAM_IDX ? undefined : (el) => parseFloat(el.style.getPropertyValue("--d")) || 0,
          prioritizeFooterOnJump: idx === BLOCKS.length - 1,
        });
      }
    };

    const syncSectionFades = (rootRect: DOMRect) => {
      const sections = BLOCKS.map((b) => document.getElementById(b.id));
      if (reduce) {
        sections.forEach((sec) => {
          if (!sec) return;
          sec.style.setProperty("--section-fade", "1");
          sec.dataset.faded = "false";
        });
        return;
      }

      const h = Math.max(rootRect.height, 1);
      const wraps = sections.map((sec) => sec?.querySelector<HTMLElement>(":scope > .wrap") ?? null);

      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const curWrap = wraps[i];
        if (!sec || !curWrap) continue;

        let fade = 1;

        // Mientras la siguiente sección entra desde abajo, la anterior se desvanece suavemente.
        const nextWrap = wraps[i + 1];
        if (nextWrap) {
          const nextRatio = (nextWrap.getBoundingClientRect().top - rootRect.top) / h;
          const t = Math.min(1, Math.max(0, (0.86 - nextRatio) / (0.86 - 0.48)));
          const smooth = t * t * (3 - 2 * t);
          fade = Math.min(fade, 1 - smooth);
        }

        // Al retroceder hacia arriba, la sección inferior también se atenúa suavemente al salir.
        if (i > 0) {
          const curRatio = (curWrap.getBoundingClientRect().top - rootRect.top) / h;
          const tDown = Math.min(1, Math.max(0, (curRatio - 0.76) / (0.98 - 0.76)));
          const smoothDown = tDown * tDown * (3 - 2 * tDown);
          fade = Math.min(fade, 1 - smoothDown);
        }

        sec.style.setProperty("--section-fade", fade.toFixed(3));
        sec.dataset.faded = fade < 0.08 ? "true" : "false";
      }
    };

    const sync = () => {
      const next = computeActive();
      setActive((prev) => (prev === next ? prev : next));
      syncSectionFades(root.getBoundingClientRect());

      if (next >= TEAM_IDX) {
        if (!teamUnlocked && teamDelayTimer === null) {
          teamDelayTimer = window.setTimeout(() => {
            teamDelayTimer = null;
            teamUnlocked = true;
            syncReveals(computeActive());
          }, TEAM_LIGHTS_DELAY_MS);
        }
      } else if (teamDelayTimer !== null) {
        window.clearTimeout(teamDelayTimer);
        teamDelayTimer = null;
      }

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

    // Primer cuadro: dispara la entrada escalonada del hero o la sección inicial.
    const initRaf = requestAnimationFrame(sync);
    root.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      cancelAnimationFrame(initRaf);
      if (raf) cancelAnimationFrame(raf);
      if (teamDelayTimer !== null) window.clearTimeout(teamDelayTimer);
      revealCtx.timers.forEach((t) => window.clearTimeout(t));
      root.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  /**
   * Salto suave hasta un bloque.
   *
   * Se calcula sobre el contenedor en vez de usar `scrollIntoView`, porque
   * aquí lo que se desplaza no es la ventana sino un elemento con su propio
   * desbordamiento, y `block: "start"` llegaba a arrastrar la página entera
   * unos píxeles, que es parte del temblor que se veía.
   */
  const goTo = (id: string) => {
    const root = scrollerRef.current;
    const el = document.getElementById(id);
    if (!root || !el) return;
    root.scrollTo({
      top: el.offsetTop,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <div className="landing" ref={scrollerRef}>
      <div className="landing__bg" data-planet-lights={active < TEAM_IDX ? "on" : "off"}>
        <Globe anchorX={0.27} lightsActive={active < TEAM_IDX} />
      </div>

      <nav className="dots" aria-label="Secciones">
        {BLOCKS.map((b, i) => (
          <button
            key={b.id}
            className="dots__item"
            aria-current={active === i}
            onClick={() => goTo(b.id)}
          >
            <span className="dots__label">{b.label}</span>
            <span className="dots__mark" />
          </button>
        ))}
      </nav>

      {/* ============================================================ 1 === */}
      <section className="block" id="inicio">
        <div className="wrap wrap--right">
          <div className="col">
            <p className="eyebrow" data-reveal style={{ "--d": "0ms" } as React.CSSProperties}>
              NASA Space Apps Challenge 2026 · Los McLovin
            </p>
            <HeroTypewriterTitle suspended={suspendTypewriter} />
            <p className="hero__lead" data-reveal style={{ "--d": "160ms" } as React.CSSProperties}>
              Más de catorce años de focos térmicos de MODIS y VIIRS en un calendario territorial
              del Perú, con las condiciones del terreno ante una ignición hipotética.
            </p>
            <div className="hero__cta" data-reveal style={{ "--d": "280ms" } as React.CSSProperties}>
              <button className="btn btn--primary btn--lg" onClick={onOpenMap}>
                Abrir el mapa →
              </button>
              <button className="btn btn--lg" onClick={() => goTo("proyecto")}>
                El proyecto
              </button>
            </div>
            <dl className="facts" data-reveal style={{ "--d": "400ms" } as React.CSSProperties}>
              <div>
                <dt>Serie</dt>
                <dd>2012 — 2026</dd>
              </div>
              <div>
                <dt>Sensores</dt>
                <dd>MODIS ×2 · VIIRS</dd>
              </div>
              <div>
                <dt>Escala</dt>
                <dd>Provincias y cuencas</dd>
              </div>
            </dl>
          </div>
        </div>
        <button className="scroll-cue" onClick={() => goTo("proyecto")} aria-label="Bajar">
          <span />
        </button>
      </section>

      {/* ============================================================ 2 === */}
      <section className="block" id="proyecto">
        <div className="wrap wrap--right">
          <div className="col">
            <p className="eyebrow" data-reveal style={{ "--d": "0ms" } as React.CSSProperties}>
              01 · El proyecto
            </p>
            <h2 className="block__title" data-reveal style={{ "--d": "40ms" } as React.CSSProperties}>
              De puntos sueltos a una historia del territorio.
            </h2>
            <p className="block__lead" data-reveal style={{ "--d": "80ms" } as React.CSSProperties}>
              Ver dónde hay focos hoy es el primer paso, no el último. McHanaq responde si lo
              observado es inusual para esta época y cuánto alcanzó a ver el satélite.
            </p>

            <div className="scope" data-reveal style={{ "--d": "120ms" } as React.CSSProperties}>
              <div className="scope__col scope__col--yes">
                <h3>Sí hace</h3>
                <ul>
                  <li>Calendario histórico por provincia y cuenca</li>
                  <li>Comparación entre sensores con su cobertura</li>
                  <li>Anomalías contra el mismo mes de otros años</li>
                  <li>Recorrido simulado desde una ignición hipotética</li>
                </ul>
              </div>
              <div className="scope__col scope__col--no">
                <h3>No hace</h3>
                <ul>
                  <li>Predecir dónde o cuándo se iniciará un incendio</li>
                  <li>Estimar probabilidad de ignición</li>
                  <li>Confirmar que un foco térmico sea un incendio</li>
                  <li>Servir como alerta operativa</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ 3 === */}
      <section className="block block--team" id="equipo">
        <div className="wrap">
          <div className="team__head">
            <p className="eyebrow" data-reveal>
              02 · El equipo
            </p>
            <h2 className="block__title team__title" data-reveal>
              <span>Los McLovin</span>
              <a
                className="team__glasses-link"
                href="https://www.spaceappschallenge.org/2026/find-a-team/los-mclovin/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Equipo Los McLovin en NASA Space Apps Challenge 2026"
                title="Los McLovin · NASA Space Apps 2026"
              >
                <McLovinGlasses />
              </a>
            </h2>
          </div>

          <div className="team">
            {TEAM.map((m) => (
              <div key={m.slug} data-reveal>
                <MemberCard member={m} />
              </div>
            ))}
          </div>

          <SiteFooter
            route="inicio"
            onNavigate={(r) => {
              if (r === "mapa") onOpenMap();
              else if (r === "tecnologia") onOpenTech?.();
              else if (r === "convenciones") onOpenConventions?.();
              else goTo("inicio");
            }}
            note="Datos: NASA LP DAAC · Copernicus ERA5-Land · COPERNICUS DEM · MapBiomas"
          />
        </div>
      </section>
    </div>
  );
}

function lookaheadPrefix(text: string, count: number): string {
  if (count >= text.length) return text;
  let i = count;
  if (i === 0 || text[i - 1] === " ") {
    while (i < text.length && text[i] === " ") i++;
  }
  while (i < text.length && text[i] !== " ") i++;
  return text.slice(0, i);
}

function renderAccentLines(
  text: string,
  count: number,
  wrapBreaks: number[],
  cursorDone: boolean
) {
  const activeBreaks = wrapBreaks.filter((b) => count >= b);
  if (activeBreaks.length === 0) {
    const line = text.slice(0, count);
    return (
      <>
        {line || "\u200B"}
        <span className={`hero__cursor${cursorDone ? " hero__cursor--done" : ""}`} />
      </>
    );
  }

  const parts: string[] = [];
  let start = 0;
  for (const br of activeBreaks) {
    parts.push(text.slice(start, br).replace(/\s+$/, ""));
    start = br;
  }
  parts.push(text.slice(start, count));

  return (
    <>
      {parts.map((part, idx) => {
        const isLast = idx === parts.length - 1;
        return (
          <span key={idx}>
            {idx > 0 && <br />}
            {part || (isLast ? "\u200B" : "")}
            {isLast && (
              <span className={`hero__cursor${cursorDone ? " hero__cursor--done" : ""}`} />
            )}
          </span>
        );
      })}
    </>
  );
}

type TypePhase =
  | "idle"
  | "typing_temp"
  | "hold_temp"
  | "erasing_temp"
  | "typing_final"
  | "done";

function HeroTypewriterTitle({ suspended = false }: { suspended?: boolean }) {
  const totalTemp = HERO_TEMP_LINE.length;
  const totalFinal = HERO_LINE_2.length;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [phase, setPhase] = useState<TypePhase>(() => (reduced ? "done" : "idle"));
  const [count, setCount] = useState(() => (reduced ? totalFinal : 0));
  const [cursorDone, setCursorDone] = useState(reduced);
  const [settled, setSettled] = useState(reduced);
  const [boxHeight, setBoxHeight] = useState<number | null>(null);
  const [wrapBreaks, setWrapBreaks] = useState<number[]>([]);
  const [waitingNewline, setWaitingNewline] = useState(false);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const prevHeightRef = useRef<number | null>(null);
  const newlineStartedRef = useRef(false);

  const activeFullText =
    phase === "typing_temp" || phase === "hold_temp" || phase === "erasing_temp"
      ? HERO_TEMP_LINE
      : HERO_LINE_2;
  const probeText =
    phase === "typing_final"
      ? lookaheadPrefix(HERO_LINE_2, count)
      : phase === "done"
        ? HERO_LINE_2
        : HERO_TEMP_LINE.slice(0, count);

  useLayoutEffect(() => {
    if (settled) {
      setBoxHeight(null);
      return;
    }
    let active = true;
    const measure = () => {
      const el = probeRef.current;
      if (!active || !el) return;
      const nextH = Math.ceil(el.getBoundingClientRect().height);
      if (nextH > 0) {
        if (
          phase === "typing_final" &&
          prevHeightRef.current !== null &&
          nextH > prevHeightRef.current + 12
        ) {
          if (count > 0 && count < totalFinal && !wrapBreaks.includes(count)) {
            newlineStartedRef.current = true;
            setWaitingNewline(true);
          }
        }
        prevHeightRef.current = nextH;
        setBoxHeight(nextH);
      }
    };
    measure();
    document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => {
      active = false;
      window.removeEventListener("resize", measure);
    };
  }, [probeText, settled, phase, count, totalFinal, wrapBreaks]);

  useEffect(() => {
    if (!waitingNewline) return;
    // Primero se desliza suavemente el bloque inferior (~240 ms) y luego baja el cursor al salto de línea.
    const dropCursorTimer = window.setTimeout(() => {
      setWrapBreaks((prev) => (prev.includes(count) ? prev : [...prev, count]));
    }, 240);
    // Pausa breve con el cursor ya visible en la línea nueva antes de retomar la escritura.
    const resumeTimer = window.setTimeout(() => {
      newlineStartedRef.current = false;
      setWaitingNewline(false);
      setCount((c) => Math.min(c + 1, totalFinal));
    }, 440);
    return () => {
      window.clearTimeout(dropCursorTimer);
      window.clearTimeout(resumeTimer);
    };
  }, [waitingNewline, count, totalFinal]);

  useEffect(() => {
    if (reduced || suspended) return;
    if (waitingNewline || newlineStartedRef.current) return;

    if (phase === "idle") {
      const t = window.setTimeout(() => {
        setPhase("typing_temp");
        setCount(1);
      }, 220);
      return () => window.clearTimeout(t);
    }

    if (phase === "typing_temp") {
      if (count >= totalTemp) {
        setPhase("hold_temp");
        return;
      }
      const t = window.setTimeout(() => setCount((c) => c + 1), 46);
      return () => window.clearTimeout(t);
    }

    if (phase === "hold_temp") {
      const t = window.setTimeout(() => setPhase("erasing_temp"), 720);
      return () => window.clearTimeout(t);
    }

    if (phase === "erasing_temp") {
      if (count <= 0) {
        const t = window.setTimeout(() => {
          setPhase("typing_final");
          setCount(1);
        }, 200);
        return () => window.clearTimeout(t);
      }
      const t = window.setTimeout(() => setCount((c) => Math.max(0, c - 1)), 28);
      return () => window.clearTimeout(t);
    }

    if (phase === "typing_final") {
      if (count >= totalFinal) {
        setPhase("done");
        return;
      }
      const isEndOfWordBeforeSpace = count > 0 && HERO_LINE_2[count] === " ";
      const delay = isEndOfWordBeforeSpace ? 95 : 36;
      const t = window.setTimeout(() => setCount((c) => Math.min(c + 1, totalFinal)), delay);
      return () => window.clearTimeout(t);
    }

    // phase === "done"
    const settleTimer = window.setTimeout(() => setSettled(true), 460);
    const doneTimer = window.setTimeout(() => setCursorDone(true), 1100);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(doneTimer);
    };
  }, [phase, count, suspended, reduced, waitingNewline, totalTemp, totalFinal]);

  const currentShown =
    phase === "done"
      ? HERO_LINE_2
      : activeFullText.slice(0, count);

  return (
    <h1
      className={`hero__title hero__title--typewriter${settled ? "" : " hero__title--sizing"}`}
      aria-label={`${HERO_LINE_1} ${HERO_LINE_2}`}
      style={boxHeight !== null && !settled ? { height: `${boxHeight}px` } : undefined}
    >
      {/* Sonda invisible que anticipa el salto de línea de la siguiente palabra para
          suavizar el desplazamiento del bloque inferior sin saltos bruscos. */}
      {!settled && (
        <span className="hero__type-probe" ref={probeRef} aria-hidden="true">
          <span>{HERO_LINE_1}</span>
          <span className="hero__accent">{probeText || "\u200B"}</span>
        </span>
      )}

      <span className="hero__type-live">
        <span>{HERO_LINE_1}</span>
        <span className="hero__accent">
          {settled ? (
            <>
              {HERO_LINE_2}
              <span className={`hero__cursor${cursorDone ? " hero__cursor--done" : ""}`} />
            </>
          ) : phase === "typing_final" ? (
            renderAccentLines(HERO_LINE_2, count, wrapBreaks, cursorDone)
          ) : (
            <>
              {currentShown || "\u200B"}
              <span className={`hero__cursor${cursorDone ? " hero__cursor--done" : ""}`} />
            </>
          )}
        </span>
      </span>
    </h1>
  );
}

/* -------------------------------------------------------------------------- */

function McLovinGlasses() {
  return (
    <svg
      className="team__glasses"
      viewBox="0 0 132 58"
      fill="none"
      aria-hidden="true"
    >
      {/* Patilla trasera */}
      <path
        d="M 11 25 L 40 9 C 44 6.8 49 7.5 52 12"
        stroke="currentColor"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Lente izquierdo (en perspectiva 3/4) */}
      <path
        d="M 3 31 C 3 20 9.5 18 22 19 C 33 20 37 24 36 33.5 C 35 44.5 27.5 50 16.5 49 C 6.5 48 3 40 3 31 Z"
        fill="currentColor"
      />
      {/* Puente nasal */}
      <path
        d="M 34.5 24 C 38.5 20.5 43.5 20.5 47.5 24"
        stroke="currentColor"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* Lente derecho */}
      <path
        d="M 45 31.5 C 45 20.5 52 18.5 66 19.5 C 79.5 20.5 84 25.5 83 35.5 C 82 47 73 53 60.5 52 C 48.5 51 45 41.5 45 31.5 Z"
        fill="currentColor"
      />
      {/* Patilla delantera */}
      <path
        d="M 81 26 L 121 15 C 125.5 13.8 129 16 128 20.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.6 1H2.4C1.6 1 1 1.6 1 2.4v11.2c0 .8.6 1.4 1.4 1.4h11.2c.8 0 1.4-.6 1.4-1.4V2.4c0-.8-.6-1.4-1.4-1.4zM5.2 12.8H3.1V6.3h2.1v6.5zM4.15 5.4a1.22 1.22 0 1 1 0-2.44 1.22 1.22 0 0 1 0 2.44zm8.65 7.4h-2.1V9.5c0-.79-.02-1.8-1.1-1.8-1.1 0-1.27.86-1.27 1.74v3.36H6.24V6.3h2.01v.89h.03c.28-.53.96-1.09 1.98-1.09 2.12 0 2.54 1.39 2.54 3.2v3.5z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.35c-2.23.48-2.7-1.08-2.7-1.08-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 .2z" />
    </svg>
  );
}

function MemberSocialLink({
  href,
  label,
  memberName,
  icon,
}: {
  href?: string;
  label: "LinkedIn" | "GitHub";
  memberName: string;
  icon: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        className="member__link member__link--pending"
        aria-disabled="true"
        title={`Agrega el ${label} de ${memberName} en team.ts`}
      >
        {icon}
        <span>{label}</span>
      </span>
    );
  }
  return (
    <a
      className="member__link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} de ${memberName}`}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
}

/**
 * Tarjeta de integrante.
 *
 * La foto se busca en `public/equipo/<slug>.jpg` y, si no está, en `.png`.
 * Si tampoco está, se dibuja un monograma: cada uno solo tiene que dejar su
 * archivo en la carpeta, sin tocar código.
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
      <div className="member__links">
        <MemberSocialLink
          href={member.linkedin}
          label="LinkedIn"
          memberName={member.name}
          icon={<LinkedInIcon />}
        />
        <MemberSocialLink
          href={member.github}
          label="GitHub"
          memberName={member.name}
          icon={<GitHubIcon />}
        />
      </div>
    </article>
  );
}
