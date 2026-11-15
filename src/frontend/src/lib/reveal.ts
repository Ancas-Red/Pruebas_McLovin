export interface RevealContext {
  revealedEls: WeakSet<HTMLElement>;
  timers: number[];
  reduce: boolean;
}

/** Marca un elemento `[data-reveal]` como visible respetando el retardo indicado. */
export function triggerReveal(el: HTMLElement, delayMs: number, ctx: RevealContext): void {
  if (ctx.revealedEls.has(el)) return;
  ctx.revealedEls.add(el);

  if (ctx.reduce) {
    el.classList.add("is-in", "is-done");
    return;
  }

  el.style.setProperty("--d", `${delayMs}ms`);
  el.classList.add("is-in");
  const t = window.setTimeout(() => el.classList.add("is-done"), delayMs + 740);
  ctx.timers.push(t);
}

/**
 * Si el usuario salta de golpe al fondo (`atBottom`) mientras el bloque final
 * aún tiene elementos pendientes, revela primero el footer antes de desbloquear
 * el resto (por ejemplo, antes de la espera por las luces del planeta en `#equipo`).
 */
export function revealFooterFirstIfJumping(
  section: HTMLElement,
  atBottom: boolean,
  ctx: RevealContext
): boolean {
  if (!atBottom) return false;
  const footer = section.querySelector<HTMLElement>(".site-foot[data-reveal]");
  if (!footer || ctx.revealedEls.has(footer)) return false;

  const hasPendingSiblings = Array.from(
    section.querySelectorAll<HTMLElement>("[data-reveal]")
  ).some((el) => el !== footer && !ctx.revealedEls.has(el));

  if (!hasPendingSiblings) return false;

  triggerReveal(footer, 0, ctx);
  return true;
}

export interface BatchRevealOptions {
  section: HTMLElement;
  rootRect: DOMRect;
  atBottom: boolean;
  threshold: number;
  staggerMs: number;
  maxDelayMs: number;
  ctx: RevealContext;
  /** Permite conservar un retardo fijo declarado en el DOM cuando aplica. */
  getItemDelay?: (el: HTMLElement, idx: number) => number;
  /** Cuando llega directo al pie junto con otros elementos sin revelar, prioriza el footer. */
  prioritizeFooterOnJump?: boolean;
}

/**
 * Revela los elementos `[data-reveal]` visibles dentro de una sección.
 * Solo si se llega de golpe hasta el pie de página junto con otros elementos
 * pendientes, el `.site-foot` aparece primero y el resto se escalona después.
 */
export function revealSectionBatch({
  section,
  rootRect,
  atBottom,
  threshold,
  staggerMs,
  maxDelayMs,
  ctx,
  getItemDelay,
  prioritizeFooterOnJump = false,
}: BatchRevealOptions): void {
  const items = Array.from(section.querySelectorAll<HTMLElement>("[data-reveal]"));
  const batch: HTMLElement[] = [];

  for (const el of items) {
    if (ctx.revealedEls.has(el)) continue;
    const r = el.getBoundingClientRect();
    const inView = atBottom || (r.top <= rootRect.bottom - threshold && r.bottom >= rootRect.top);
    if (inView) batch.push(el);
  }

  if (batch.length === 0) return;

  const footerIdx = prioritizeFooterOnJump
    ? batch.findIndex((el) => el.classList.contains("site-foot"))
    : -1;

  if (footerIdx !== -1 && batch.length > 1) {
    const footer = batch[footerIdx];
    triggerReveal(footer, 0, ctx);

    const rest = batch.filter((el) => el !== footer);
    rest.forEach((el, idx) => {
      const delay = Math.min(120 + idx * staggerMs, maxDelayMs + 120);
      triggerReveal(el, delay, ctx);
    });
    return;
  }

  batch.forEach((el, idx) => {
    const delay = getItemDelay
      ? getItemDelay(el, idx)
      : Math.min(idx * staggerMs, maxDelayMs);
    triggerReveal(el, delay, ctx);
  });
}
