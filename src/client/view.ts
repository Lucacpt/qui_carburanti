// Costruzione del DOM SOLO con API sicure (createElement + textContent): niente innerHTML,
// coerente con Trusted Types e con le note dei gestori, che sono testo libero.

import type { Reliability } from "../domain/reliability.ts";
import { State } from "../domain/types.ts";
import { PULL_DEAD_ZONE_PX, PULL_TRIGGER_PX, pullProgress } from "./pull.ts";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Colore, forma e testo: il colore non è mai l'unico indicatore (NFR-U1, daltonismo). */
export const STATE_UI: Readonly<Record<State, { shape: string; cls: string; rank: number }>> = {
  [State.GREEN]: { shape: "●", cls: "s-green", rank: 0 },
  [State.AMBER]: { shape: "▲", cls: "s-amber", rank: 1 },
  [State.GREY]: { shape: "○", cls: "s-grey", rank: 2 },
  [State.RED]: { shape: "✕", cls: "s-red", rank: 3 },
};

const RELIABILITY_TEXT = ["", "affidabilità bassa", "affidabilità media", "affidabilità alta"];

export function reliabilityBadge(r: Reliability): HTMLElement | null {
  if (r === 0) return null;
  return h(
    "span",
    { class: `bars r${r}`, title: RELIABILITY_TEXT[r], "aria-label": RELIABILITY_TEXT[r] },
    "▮".repeat(r) + "▯".repeat(3 - r),
  );
}

/** Pannello in sovrimpressione (al posto di <dialog>, non supportato da iOS 15.0-15.3). */
export function openSheet(title: string): { body: HTMLElement; close: () => void } {
  const body = h("div", { class: "sheet-body" });
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") close();
  };
  const overlay = h(
    "div",
    { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": title },
    h(
      "div",
      { class: "sheet" },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", {}, title),
        h("button", { class: "icon", type: "button", "aria-label": "Chiudi", onClick: close }, "✕"),
      ),
      body,
    ),
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  return { body, close };
}

export function announce(text: string): void {
  const live = document.getElementById("live");
  if (live) live.textContent = text;
}

/** "Tira giù per aggiornare" in cima alla pagina (src/client/pull.ts). */
export function onPullDown(opts: {
  indicator: HTMLElement;
  enabled: () => boolean;
  refresh: () => Promise<void>;
}): void {
  const { indicator, enabled, refresh } = opts;
  let start: { x: number; y: number } | null = null;
  let ready = false;
  let busy = false;

  const show = (height: number, text: string) => {
    indicator.style.height = `${height}px`;
    indicator.textContent = text;
  };
  const reset = () => {
    start = null;
    ready = false;
    indicator.classList.remove("dragging");
    show(0, "");
  };

  window.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (busy || !t || e.touches.length !== 1 || window.scrollY > 0 || !enabled()) return;
      start = { x: t.clientX, y: t.clientY };
      indicator.classList.add("dragging");
    },
    { passive: true },
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dy = t.clientY - start.y;
      const dx = Math.abs(t.clientX - start.x);
      if (window.scrollY > 0 || dy < -PULL_DEAD_ZONE_PX || (dx > PULL_DEAD_ZONE_PX && dx > dy)) {
        reset();
        return;
      }
      if (dy < PULL_DEAD_ZONE_PX) return;
      const p = pullProgress(dy);
      ready = p.ready;
      show(p.height, ready ? "↻ Rilascia per aggiornare" : "↓ Tira per aggiornare");
    },
    { passive: true },
  );

  window.addEventListener("touchend", () => {
    if (!start) return;
    if (!ready) {
      reset();
      return;
    }
    start = null;
    busy = true;
    indicator.classList.remove("dragging");
    show(PULL_TRIGGER_PX / 2, "Aggiorno…");
    void refresh().finally(() => {
      busy = false;
      reset();
    });
  });
  window.addEventListener("touchcancel", () => {
    if (!busy) reset();
  });
}
