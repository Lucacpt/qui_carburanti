// Costruzione del DOM SOLO con API sicure (createElement + textContent): niente innerHTML,
// coerente con Trusted Types e con le note dei gestori, che sono testo libero.

import type { Reliability } from "../domain/reliability.ts";
import { State } from "../domain/types.ts";

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
