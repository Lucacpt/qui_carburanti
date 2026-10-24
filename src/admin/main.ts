// Area admin (ADR-0013): avvisi, contestazioni, stato della provincia, ultime segnalazioni con
// annullamento e blocco di una rete, indicazioni di QUI, impianti chiusi, congelamenti, avviso a
// tutti, sola lettura, andamento, storico, registro esportabile.
// La pagina è dietro Cloudflare Access; le API verificano di nuovo il login a ogni richiesta.
// Delle segnalazioni si vede solo cosa, dove e quando, più un codice di rete di 4 caratteri che
// cambia ogni giorno: chi ha segnalato non è nel database.

import { FUEL_NAMES, loadSnapshot, loadStations, type Station } from "../client/data.ts";
import { matches } from "../client/search.ts";
import { announce, h, openSheet } from "../client/view.ts";
import { type Fuel, State } from "../domain/types.ts";

const PROV = "AV";
const REFRESH_MS = 60_000;
const MAX_STATE_HOURS = 8;
const MAX_NOTICE = 280;
const NOTICE_HOURS = [1, 2, 4, 8, 12, 24, 48, 72];
const app = document.getElementById("app") as HTMLElement;

interface Override {
  station: number;
  fuel: string;
  state: number;
  note: string;
  ts: number;
  until: number;
}

interface LogRow {
  ts: number;
  action: string;
  station: number | null;
  detail: string | null;
}

interface Overview {
  readOnly: boolean;
  lastHour: number;
  alerts: Array<{
    id: number;
    ts: number;
    kind: string;
    station: number | null;
    fuel: string | null;
    detail: string | null;
  }>;
  contests: Array<{
    id: number;
    ts: number;
    station: number;
    fuel: string | null;
    reason: string;
    contact: string | null;
    status: string;
  }>;
  frozen: Array<{ station: number; until: number; note: string }>;
  overrides: Override[];
  closed: Array<{ station: number; note: string; ts: number }>;
  notice: { text: string; until: number } | null;
  blocked: Array<{ net: string; until: number }>;
  stats: Array<{ hour: number; fuel: string; pos: number; neg: number; dropped: number }>;
  log: LogRow[];
}

interface Report {
  id: number;
  ts: number;
  station: number;
  fuel: string;
  has: number;
  near: number;
  queue: number | null;
  lim: number | null;
  net: string;
}

interface History {
  transitions: Array<{
    ts: number;
    fuel: string;
    from_state: number | null;
    to_state: number;
    confirmations: number;
    absences: number;
    cause: string;
  }>;
  contests: Overview["contests"];
  frozen: { until: number; note: string } | null;
  overrides: Override[];
}

/** Stato attuale di un impianto per carburante, dallo snapshot pubblico. */
type Current = Map<number, Array<{ fuel: Fuel; state: number }>>;

const KIND: Record<string, string> = {
  red_pending: "Rosso in verifica",
  contest: "Contestazione",
  override_superseded: "Indicazione di QUI superata dagli utenti",
};
const REASON: Record<string, string> = {
  has_fuel: "dice che c'è carburante",
  no_fuel: "dice che non c'è carburante",
  closed: "impianto chiuso",
  wrong_data: "dati dell'impianto sbagliati",
  other: "altro",
};
const STATUS: Array<[string, string]> = [
  ["new", "Nuova"],
  ["in_progress", "In corso"],
  ["closed", "Chiusa"],
];
const STATE_NAME: Record<number, string> = {
  [State.GREY]: "grigio",
  [State.RED]: "rosso",
  [State.AMBER]: "ambra",
  [State.GREEN]: "verde",
};
const STATE_SHAPE: Record<number, string> = {
  [State.GREY]: "○",
  [State.RED]: "✕",
  [State.AMBER]: "▲",
  [State.GREEN]: "●",
};
const CAUSE: Record<string, string> = {
  report: "segnalazione",
  hold: "fine verifica",
  ttl: "rosso scaduto",
  window: "8 ore senza segnalazioni",
  fresh: "conferme invecchiate",
  time: "tempo",
  freeze: "congelato",
  unfreeze: "sbloccato",
  annul: "segnalazioni annullate",
  official: "indicazione di QUI",
  clear: "indicazione tolta",
  users: "indicazione superata dagli utenti",
};
const ACTION: Record<string, string> = {
  ack: "Avvisi visti",
  contest: "Contestazione",
  freeze: "Congelamento",
  unfreeze: "Sblocco",
  read_only: "Sola lettura",
  annul: "Annullamento",
  set_state: "Indicazione di QUI",
  clear_state: "Indicazione tolta",
  block_net: "Rete bloccata",
  unblock_net: "Rete sbloccata",
  close: "Impianto chiuso",
  reopen: "Impianto riaperto",
  notice: "Avviso a tutti",
};

const fmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const hm = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (ms: number) => fmt.format(ms);
const fuelName = (f: string | null) => (f ? (FUEL_NAMES[f as Fuel] ?? f) : "tutti i carburanti");

let stations = new Map<number, Station>();
const place = (id: number | null) => {
  if (id === null) return "—";
  const s = stations.get(id);
  return s ? `${s.brand} · ${s.address}, ${s.town} (${id})` : `impianto ${id}`;
};

/** Stato della pagina che sopravvive ai ridisegni: ricerca, filtro, selezione, avvisi già visti. */
const view = {
  query: "",
  /** Impianto scelto: le ultime segnalazioni mostrano solo le sue. */
  station: null as number | null,
  selected: new Set<number>(),
  /** Avvisi già mostrati: le notifiche del browser partono solo per quelli nuovi. */
  seenAlerts: null as Set<number> | null,
  allAlerts: false,
  closedContests: false,
};

/** Quanti avvisi mostrare prima di "Mostra tutti": il resto della pagina deve restare a portata. */
const ALERTS_SHOWN = 5;

async function api<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ p: PROV, ...body }),
        }
      : { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `errore ${res.status}`);
  return data as T;
}

async function act(body: object, done: string): Promise<void> {
  try {
    await api("/api/admin/action", body);
    announce(done);
    await load();
  } catch (err) {
    alert(err instanceof Error ? err.message : "errore");
  }
}

// ------------------------------------------------------------------ mattoncini

function section(id: string, title: string, ...children: Array<Node | null | false>): HTMLElement {
  return h("section", { class: "admin-section", id }, h("h2", {}, title), ...children);
}

function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", { type: "button", class: cls, onClick }, text);
}

function list(items: Node[], compact = false): HTMLElement {
  return h("ul", { class: compact ? "admin-list compact" : "admin-list" }, ...items);
}

/** Contatto lasciato dal gestore: email e telefono diventano link da toccare. */
function contactLink(contact: string): Node {
  const c = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) {
    return h(
      "a",
      { href: `mailto:${c}?subject=${encodeURIComponent("QUI · la tua segnalazione")}` },
      c,
    );
  }
  if (/^\+?[\d\s./-]{6,}$/.test(c)) return h("a", { href: `tel:${c.replace(/[^\d+]/g, "")}` }, c);
  return document.createTextNode(c);
}

/** Le azioni su un impianto, uguali ovunque compaia. */
function stationActions(station: number, o: Overview): HTMLElement {
  const closed = o.closed.some((c) => c.station === station);
  return h(
    "div",
    { class: "admin-actions" },
    button("Segnalazioni", () => {
      view.station = station;
      view.selected.clear();
      void load().then(() => document.getElementById("segnalazioni")?.scrollIntoView());
    }),
    button("Imposta stato", () => setStateForm(station)),
    button("Storico", () => void showHistory(station)),
    button("Congela", () => freezeForm(station)),
    closed
      ? button("Riapri", () => void act({ kind: "reopen", station }, "Impianto riaperto"))
      : button("Segna chiuso", () => closeForm(station)),
    h(
      "a",
      { class: "btn", href: `/d/${station}`, target: "_blank", rel: "noopener" },
      "Apri scheda",
    ),
  );
}

// ------------------------------------------------------------------ sezioni

function navSection(): HTMLElement {
  const links: Array<[string, string]> = [
    ["avvisi", "Avvisi"],
    ["provincia", "Provincia"],
    ["cerca", "Cerca"],
    ["segnalazioni", "Segnalazioni"],
    ["interventi", "Interventi"],
    ["avviso", "Avviso a tutti"],
    ["sicurezza", "Sicurezza"],
    ["andamento", "Andamento"],
    ["registro", "Registro"],
  ];
  return h(
    "nav",
    { class: "chips", "aria-label": "Sezioni" },
    ...links.map(([id, text]) => h("a", { class: "chip", href: `#${id}` }, text)),
  );
}

function notificationsControl(): Node | null {
  if (!("Notification" in window)) return null;
  if (Notification.permission === "granted") {
    return h("p", { class: "muted small" }, "🔔 Notifiche del browser attive per i nuovi avvisi.");
  }
  if (Notification.permission === "denied") {
    return h(
      "p",
      { class: "muted small" },
      "Notifiche bloccate nel browser: riattivale dalle impostazioni del sito.",
    );
  }
  return button("🔔 Avvisami con una notifica", () => {
    void Notification.requestPermission().then(() => void load());
  });
}

function alertsSection(o: Overview): HTMLElement {
  return section(
    "avvisi",
    o.alerts.length === 0 ? "Avvisi" : `Avvisi da vedere (${o.alerts.length})`,
    notificationsControl(),
    o.alerts.length === 0
      ? h("p", { class: "muted" }, "Nessun avviso da vedere.")
      : h(
          "div",
          {},
          button(
            "Segna tutti come visti",
            () =>
              void act(
                { kind: "ack", ids: o.alerts.map((a) => a.id) },
                "Avvisi segnati come visti",
              ),
          ),
          list(
            (view.allAlerts ? o.alerts : o.alerts.slice(0, ALERTS_SHOWN)).map((a) =>
              h(
                "li",
                { class: "card" },
                h("strong", {}, `${KIND[a.kind] ?? a.kind} · ${when(a.ts)}`),
                h("p", {}, `${place(a.station)} · ${fuelName(a.fuel)}`),
                a.detail ? h("p", { class: "muted small" }, REASON[a.detail] ?? a.detail) : null,
                h(
                  "div",
                  { class: "admin-actions" },
                  button("Visto", () => void act({ kind: "ack", ids: [a.id] }, "Avviso visto")),
                ),
                a.station !== null && stationActions(a.station, o),
              ),
            ),
          ),
          o.alerts.length > ALERTS_SHOWN &&
            button(
              view.allAlerts ? "Mostra solo i primi" : `Mostra tutti (${o.alerts.length})`,
              () => {
                view.allAlerts = !view.allAlerts;
                void load();
              },
            ),
        ),
  );
}

function contestsSection(o: Overview): HTMLElement {
  if (o.contests.length === 0) {
    return section("contestazioni", "Contestazioni", h("p", { class: "muted" }, "Nessuna."));
  }
  const open = o.contests.filter((c) => c.status !== "closed");
  const closed = o.contests.length - open.length;
  const shown = view.closedContests ? o.contests : open;
  return section(
    "contestazioni",
    `Contestazioni aperte (${open.length})`,
    closed > 0 &&
      button(
        view.closedContests ? "Nascondi le chiuse" : `Mostra anche le chiuse (${closed})`,
        () => {
          view.closedContests = !view.closedContests;
          void load();
        },
      ),
    h(
      "p",
      { class: "muted small" },
      "Il contatto si cancella da solo dopo 30 giorni, la contestazione dopo 180.",
    ),
    list(
      shown.map((c) => {
        const status = h(
          "select",
          {
            "aria-label": "Stato della contestazione",
            onChange: (e) =>
              void act(
                { kind: "contest", id: c.id, status: (e.target as HTMLSelectElement).value },
                "Stato aggiornato",
              ),
          },
          ...STATUS.map(([value, text]) =>
            h("option", { value, selected: value === c.status }, text),
          ),
        );
        return h(
          "li",
          { class: "card" },
          h("strong", {}, `${when(c.ts)} · ${place(c.station)}`),
          h("p", {}, `${fuelName(c.fuel)}: ${REASON[c.reason] ?? c.reason}`),
          c.contact
            ? h("p", {}, "Contatto: ", contactLink(c.contact))
            : h("p", { class: "muted small" }, "Nessun contatto lasciato"),
          h("div", { class: "admin-actions" }, status),
          stationActions(c.station, o),
        );
      }),
    ),
  );
}

/** Il quadro della provincia adesso, dallo stesso snapshot che vedono tutti. */
function provinceSection(o: Overview, current: Current): HTMLElement {
  const counts = new Map<number, number>();
  for (const rows of current.values()) {
    for (const r of rows) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
  }
  const withInfo = [...current.entries()].sort(
    (a, b) =>
      Math.max(...b[1].map((r) => r.state)) - Math.max(...a[1].map((r) => r.state)) || a[0] - b[0],
  );
  return section(
    "provincia",
    "Stato della provincia",
    h(
      "p",
      {},
      `${counts.get(State.GREEN) ?? 0} verdi · ${counts.get(State.AMBER) ?? 0} ambra · ${counts.get(State.RED) ?? 0} rossi (per carburante) · ${stations.size - current.size} distributori senza informazioni · ${o.closed.length} chiusi`,
    ),
    h("p", { class: "muted small" }, "Le modifiche si vedono qui e nell'app entro un minuto."),
    withInfo.length === 0
      ? h("p", { class: "muted" }, "Nessuna informazione in questo momento.")
      : list(
          withInfo.map(([id, rows]) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(id)),
              h(
                "p",
                {},
                rows
                  .map(
                    (r) => `${STATE_SHAPE[r.state]} ${FUEL_NAMES[r.fuel]} ${STATE_NAME[r.state]}`,
                  )
                  .join(" · "),
              ),
              stationActions(id, o),
            ),
          ),
        ),
  );
}

/** Cerca un impianto per nome, marchio, via o comune: niente più codici da ricordare. */
function searchSection(o: Overview): HTMLElement {
  const results = h("ul", { class: "admin-list" });
  const show = () => {
    const q = view.query.trim();
    const found = q ? [...stations.values()].filter((s) => matches(s.text, q)).slice(0, 8) : [];
    results.replaceChildren(
      ...found.map((s) =>
        h(
          "li",
          { class: "card" },
          h("strong", {}, `${s.brand} ${s.name}`),
          h("p", { class: "muted small" }, `${s.address}, ${s.town} (${s.id})`),
          stationActions(s.id, o),
        ),
      ),
    );
    if (q && found.length === 0) results.replaceChildren(h("li", { class: "muted" }, "Nessuno."));
  };
  const input = h("input", {
    type: "search",
    placeholder: "Nome, marchio, via o comune",
    "aria-label": "Cerca un distributore",
    value: view.query,
    onInput: (e) => {
      view.query = (e.target as HTMLInputElement).value;
      show();
    },
  });
  show();
  return section("cerca", "Cerca un distributore", input, results);
}

function reportsSection(reports: Report[], o: Overview): HTMLElement {
  const shown = view.station === null ? reports : reports.filter((r) => r.station === view.station);
  // Quante segnalazioni per rete in 8 ore: una serie dalla stessa rete salta all'occhio.
  const perNet = new Map<string, number>();
  for (const r of reports) perNet.set(r.net, (perNet.get(r.net) ?? 0) + 1);
  for (const id of view.selected) if (!reports.some((r) => r.id === id)) view.selected.delete(id);

  const count = h("span", { class: "muted small" });
  const annulButton = button(
    "Annulla le selezionate",
    () => annulForm([...view.selected], `${view.selected.size} segnalazioni selezionate`),
    "btn no",
  );
  const refreshCount = () => {
    count.textContent = `${view.selected.size} selezionate`;
    annulButton.disabled = view.selected.size === 0;
  };
  const boxes = new Map<number, HTMLInputElement>();
  const toggle = (ids: number[], on: boolean) => {
    for (const id of ids) {
      if (on) view.selected.add(id);
      else view.selected.delete(id);
      const box = boxes.get(id);
      if (box) box.checked = on;
    }
    refreshCount();
  };

  const rows = shown.map((r) => {
    const box = h("input", {
      type: "checkbox",
      checked: view.selected.has(r.id),
      "aria-label": "Seleziona",
      onChange: (e) => toggle([r.id], (e.target as HTMLInputElement).checked),
    });
    boxes.set(r.id, box);
    const sameNet = shown.filter((x) => x.net === r.net).map((x) => x.id);
    return h(
      "li",
      { class: "card" },
      h(
        "label",
        { class: "admin-actions" },
        box,
        h(
          "strong",
          {},
          `${hm.format(r.ts)} · ${FUEL_NAMES[r.fuel as Fuel] ?? r.fuel}: ${r.has ? "✓ C'è" : "✕ Non c'è"}`,
        ),
      ),
      h("p", {}, place(r.station)),
      h(
        "p",
        { class: "muted small" },
        `${r.near ? "sul posto" : "da remoto"} · rete ${r.net} (${perNet.get(r.net)} in 8 ore)`,
      ),
      h(
        "div",
        { class: "admin-actions" },
        sameNet.length > 1 &&
          button(`Seleziona le ${sameNet.length} di questa rete`, () => toggle(sameNet, true)),
        button("Blocca questa rete", () => blockForm(r, perNet.get(r.net) ?? 1)),
      ),
    );
  });
  refreshCount();

  return section(
    "segnalazioni",
    view.station === null
      ? `Ultime segnalazioni (${reports.length} in 8 ore)`
      : `Segnalazioni: ${place(view.station)}`,
    h(
      "p",
      { class: "muted small" },
      "Annulla solo segnalazioni palesemente false o in serie: lo stato si ricalcola subito e l'annullamento resta nel registro con la motivazione.",
    ),
    view.station !== null &&
      h(
        "div",
        { class: "admin-actions" },
        button("Mostra tutte", () => {
          view.station = null;
          view.selected.clear();
          void load();
        }),
        stationActions(view.station, o),
      ),
    shown.length === 0
      ? h("p", { class: "muted" }, "Nessuna segnalazione nelle ultime 8 ore.")
      : h(
          "div",
          {},
          h(
            "div",
            { class: "admin-actions" },
            button("Seleziona tutte", () =>
              toggle(
                shown.map((r) => r.id),
                true,
              ),
            ),
            button("Deseleziona", () =>
              toggle(
                shown.map((r) => r.id),
                false,
              ),
            ),
            annulButton,
            count,
          ),
          list(rows),
        ),
  );
}

/** Tutto ciò che il titolare ha deciso a mano e che ora si vede nell'app. */
function interventionsSection(o: Overview): HTMLElement {
  const none = (text: string) => h("p", { class: "muted" }, text);
  return section(
    "interventi",
    "Interventi in corso",
    h("h3", {}, "Indicazioni di QUI"),
    o.overrides.length === 0
      ? none("Nessuna.")
      : list(
          o.overrides.map((ov) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(ov.station)),
              h(
                "p",
                {},
                `${fuelName(ov.fuel)}: ${STATE_NAME[ov.state]} · «${ov.note}» · fino alle ${when(ov.until)}`,
              ),
              button(
                "Togli",
                () =>
                  void act(
                    { kind: "clearState", station: ov.station, fuel: ov.fuel },
                    "Indicazione tolta",
                  ),
              ),
            ),
          ),
        ),
    h("h3", {}, "Impianti chiusi"),
    o.closed.length === 0
      ? none("Nessuno.")
      : list(
          o.closed.map((c) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(c.station)),
              h("p", {}, `«${c.note}» · dal ${when(c.ts)}`),
              button(
                "Riapri",
                () => void act({ kind: "reopen", station: c.station }, "Impianto riaperto"),
              ),
            ),
          ),
        ),
    h("h3", {}, "Congelati"),
    o.frozen.length === 0
      ? none("Nessuno.")
      : list(
          o.frozen.map((f) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(f.station)),
              h("p", {}, `«${f.note}» · fino alle ${when(f.until)}`),
              button(
                "Sblocca",
                () => void act({ kind: "unfreeze", station: f.station }, "Distributore sbloccato"),
              ),
            ),
          ),
        ),
  );
}

function noticeSection(o: Overview): HTMLElement {
  const text = h("textarea", {
    rows: "3",
    maxlength: String(MAX_NOTICE),
    "aria-label": "Testo dell'avviso, visibile a tutti",
    placeholder: "Es. Consegne previste domani mattina ai distributori di Ariano Irpino.",
  });
  const hours = h(
    "select",
    { "aria-label": "Durata" },
    ...NOTICE_HOURS.map((n) =>
      h("option", { value: String(n), selected: n === 12 }, `${n} ${n === 1 ? "ora" : "ore"}`),
    ),
  );
  return section(
    "avviso",
    "Avviso a tutti",
    h(
      "p",
      { class: "muted small" },
      "Compare in cima all'app per tutti, come «Avviso di QUI». Scrivi solo informazioni di cui sei sicuro e indica la fonte.",
    ),
    o.notice
      ? h(
          "div",
          { class: "note-box" },
          h("p", {}, `«${o.notice.text}» · fino alle ${when(o.notice.until)}`),
          button(
            "Togli l'avviso",
            () => void act({ kind: "notice", text: null, hours: 0 }, "Avviso tolto"),
          ),
        )
      : h("p", { class: "muted" }, "Nessun avviso attivo."),
    text,
    hours,
    button(
      o.notice ? "Sostituisci l'avviso" : "Pubblica l'avviso",
      () => {
        if (confirm("Pubblicare l'avviso a tutti?")) {
          void act(
            { kind: "notice", text: text.value, hours: Number(hours.value) },
            "Avviso pubblicato",
          );
        }
      },
      "btn primary",
    ),
  );
}

function securitySection(o: Overview): HTMLElement {
  return section(
    "sicurezza",
    "Sicurezza",
    h("h3", {}, "Reti bloccate"),
    o.blocked.length === 0
      ? h("p", { class: "muted" }, "Nessuna rete bloccata a mano.")
      : h(
          "div",
          {},
          list(
            o.blocked.map((b) =>
              h(
                "li",
                { class: "card" },
                h("strong", {}, `Rete ${b.net}`),
                h("p", { class: "muted small" }, `bloccata fino alle ${when(b.until)}`),
                button(
                  "Sblocca",
                  () => void act({ kind: "unblock", net: b.net }, `Rete ${b.net} sbloccata`),
                ),
              ),
            ),
          ),
          o.blocked.length > 1 &&
            button(
              "Sblocca tutte",
              () => void act({ kind: "unblock", net: null }, "Reti sbloccate"),
            ),
        ),
    h("h3", {}, "Sola lettura"),
    h(
      "p",
      {},
      o.readOnly
        ? "ATTIVA: le segnalazioni sono sospese e tutti vedono un avviso."
        : "Disattivata: le segnalazioni funzionano normalmente.",
    ),
    button(
      o.readOnly ? "Riattiva le segnalazioni" : "Attiva la sola lettura",
      () => {
        const msg = o.readOnly
          ? "Riattivare le segnalazioni?"
          : "Sospendere tutte le segnalazioni della provincia? Usalo solo in caso di attacco o anomalie.";
        if (confirm(msg)) {
          void act(
            { kind: "readOnly", on: !o.readOnly },
            o.readOnly ? "Segnalazioni riattivate" : "Sola lettura attiva",
          );
        }
      },
      o.readOnly ? "btn" : "btn no",
    ),
  );
}

/** Le ultime 24 ore, ora per ora: picchi e tentativi di abuso si vedono a occhio. */
function trendSection(o: Overview): HTMLElement {
  const hours = new Map<number, { pos: number; neg: number; dropped: number }>();
  for (const s of o.stats) {
    const v = hours.get(s.hour) ?? { pos: 0, neg: 0, dropped: 0 };
    v.pos += s.pos;
    v.neg += s.neg;
    v.dropped += s.dropped;
    hours.set(s.hour, v);
  }
  const rows = [...hours.entries()].sort((a, b) => b[0] - a[0]);
  const max = Math.max(1, ...rows.map(([, v]) => v.pos + v.neg + v.dropped));
  const sum = (k: "pos" | "neg" | "dropped") => o.stats.reduce((n, s) => n + s[k], 0);
  return section(
    "andamento",
    "Andamento delle ultime 24 ore",
    h(
      "p",
      {},
      `${o.lastHour} segnalazioni nell'ultima ora · ${sum("pos")} "c'è" e ${sum("neg")} "non c'è" in 24 ore · ${sum("dropped")} scartate dall'anti-abuso`,
    ),
    h(
      "p",
      { class: "muted small" },
      "Molte scartate in poco tempo indicano un tentativo di abuso: blocca la rete o valuta la sola lettura.",
    ),
    rows.length === 0
      ? h("p", { class: "muted" }, "Nessuna segnalazione nelle ultime 24 ore.")
      : list(
          rows.map(([hour, v]) => {
            const total = v.pos + v.neg + v.dropped;
            const bar = "█".repeat(Math.max(1, Math.round((total / max) * 20)));
            return h(
              "li",
              {},
              h("strong", {}, `${hm.format(hour * 3_600_000)} `),
              h("span", { "aria-hidden": "true" }, `${bar} `),
              `${v.pos} c'è · ${v.neg} non c'è · ${v.dropped} scartate`,
            );
          }),
          true,
        ),
  );
}

async function downloadLog(): Promise<void> {
  try {
    const rows = await api<LogRow[]>(`/api/admin/log?p=${PROV}`);
    const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const csv = [
      "data;azione;impianto;dettaglio",
      ...rows.map((r) =>
        [
          new Date(r.ts).toISOString(),
          ACTION[r.action] ?? r.action,
          r.station === null ? "" : place(r.station),
          r.detail ?? "",
        ]
          .map(cell)
          .join(";"),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = h("a", {
      href: url,
      download: `qui-registro-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    alert(err instanceof Error ? err.message : "errore");
  }
}

function logSection(o: Overview): HTMLElement {
  return section(
    "registro",
    "Registro delle azioni",
    h(
      "p",
      { class: "muted small" },
      "Ogni decisione resta qui per 180 giorni: serve a rendere conto (procedura di contestazione).",
    ),
    button("Scarica tutto il registro (CSV)", () => void downloadLog()),
    o.log.length === 0
      ? h("p", { class: "muted" }, "Nessuna azione.")
      : list(
          o.log.map((l) =>
            h(
              "li",
              {},
              `${when(l.ts)} · ${ACTION[l.action] ?? l.action}${l.station ? ` · ${place(l.station)}` : ""}${l.detail ? ` · ${l.detail}` : ""}`,
            ),
          ),
          true,
        ),
  );
}

// ------------------------------------------------------------------ pannelli

function reasonField(value: string, label: string): HTMLTextAreaElement {
  const t = h("textarea", { rows: "2", maxlength: "200", "aria-label": label });
  t.value = value;
  return t;
}

function annulForm(ids: number[], what: string): void {
  if (ids.length === 0) return;
  const sheet = openSheet("Annulla segnalazioni");
  const reason = reasonField("Segnalazioni false in serie", "Motivazione, resta nel registro");
  sheet.body.replaceChildren(
    h("p", {}, `${what}: verranno cancellate e lo stato si ricalcola subito.`),
    h("p", { class: "muted small" }, "La motivazione resta nel registro delle azioni."),
    reason,
    button(
      "Annulla le segnalazioni",
      () => {
        sheet.close();
        view.selected.clear();
        void act(
          { kind: "annul", ids, reason: reason.value },
          ids.length === 1 ? "Segnalazione annullata" : `${ids.length} segnalazioni annullate`,
        );
      },
      "btn no",
    ),
  );
}

function blockForm(r: Report, sameNet: number): void {
  const sheet = openSheet(`Blocca la rete ${r.net}`);
  const annul = h("input", { type: "checkbox", checked: true });
  const reason = reasonField("Segnalazioni false in serie", "Motivazione, resta nel registro");
  sheet.body.replaceChildren(
    h(
      "p",
      {},
      `Da questa rete sono arrivate ${sameNet === 1 ? "1 segnalazione" : `${sameNet} segnalazioni`} nelle ultime 8 ore. Le prossime verranno ignorate in silenzio fino a mezzanotte UTC, quando il codice di rete cambia.`,
    ),
    h(
      "p",
      { class: "muted small" },
      "Una rete può essere condivisa (un ufficio, un operatore mobile): usalo solo per lo spam evidente.",
    ),
    h("label", { class: "admin-actions" }, annul, "Annulla anche le sue segnalazioni già arrivate"),
    reason,
    button(
      "Blocca la rete",
      () => {
        sheet.close();
        view.selected.clear();
        void act(
          { kind: "blockNet", report: r.id, annul: annul.checked, reason: reason.value },
          "Rete bloccata fino a mezzanotte",
        );
      },
      "btn no",
    ),
  );
}

function closeForm(station: number): void {
  const sheet = openSheet("Segna l'impianto come chiuso");
  const note = reasonField(
    "Il gestore ha comunicato: impianto chiuso ",
    "Nota con la fonte, mostrata a tutti",
  );
  sheet.body.replaceChildren(
    h("p", {}, place(station)),
    h(
      "p",
      { class: "muted small" },
      "Si vede a tutti come «Chiuso secondo QUI» con questa nota, in fondo alla lista, finché non lo riapri.",
    ),
    note,
    button(
      "Segna chiuso",
      () => {
        sheet.close();
        void act({ kind: "close", station, note: note.value }, "Impianto segnato come chiuso");
      },
      "btn no",
    ),
  );
}

function setStateForm(station: number): void {
  const st = stations.get(station);
  const sheet = openSheet("Indicazione di QUI");
  const fuel = h(
    "select",
    { "aria-label": "Carburante" },
    h("option", { value: "" }, "Tutti i carburanti venduti"),
    ...(st?.fuels ?? []).map((f) => h("option", { value: f }, FUEL_NAMES[f])),
  );
  const state = h(
    "select",
    { "aria-label": "Stato" },
    h("option", { value: "green" }, "C'è (verde)"),
    h("option", { value: "red" }, "Esaurito (rosso)"),
  );
  const note = h("textarea", {
    rows: "3",
    maxlength: "200",
    "aria-label": "Nota con la fonte, mostrata a tutti",
  });
  note.value = "Il gestore ha comunicato per telefono alle ";
  const hours = h(
    "select",
    { "aria-label": "Durata" },
    ...Array.from({ length: MAX_STATE_HOURS }, (_, i) => i + 1).map((n) =>
      h("option", { value: String(n), selected: n === 2 }, `${n} ${n === 1 ? "ora" : "ore"}`),
    ),
  );
  sheet.body.replaceChildren(
    h("p", {}, place(station)),
    h(
      "p",
      { class: "muted small" },
      "Si vede a tutti come «Indicazione di QUI» con questa nota: scrivi da dove viene l'informazione. Vale fino alla scadenza, ma decade appena le segnalazioni degli utenti danno uno stato chiaro.",
    ),
    fuel,
    state,
    note,
    hours,
    button(
      "Pubblica l'indicazione",
      () => {
        sheet.close();
        void act(
          {
            kind: "setState",
            station,
            fuel: fuel.value || null,
            state: state.value,
            note: note.value,
            hours: Number(hours.value),
          },
          "Indicazione pubblicata",
        );
      },
      "btn primary",
    ),
  );
}

function freezeForm(station: number): void {
  const sheet = openSheet("Congela il distributore");
  const note = h("textarea", {
    rows: "3",
    maxlength: "200",
    "aria-label": "Nota mostrata a tutti",
  });
  note.value = "Il gestore segnala: ";
  const hours = h(
    "select",
    { "aria-label": "Durata" },
    ...[1, 2, 3].map((n) =>
      h("option", { value: String(n), selected: n === 3 }, `${n} ${n === 1 ? "ora" : "ore"}`),
    ),
  );
  sheet.body.replaceChildren(
    h("p", {}, place(station)),
    h(
      "p",
      { class: "muted small" },
      "Il distributore verrà mostrato in ambra con questa nota, attribuita a chi l'ha inviata. Mai come «Disponibile».",
    ),
    note,
    hours,
    button(
      "Congela",
      () => {
        sheet.close();
        void act(
          { kind: "freeze", station, note: note.value, hours: Number(hours.value) },
          "Distributore congelato",
        );
      },
      "btn primary",
    ),
  );
}

async function showHistory(station: number): Promise<void> {
  if (!Number.isInteger(station) || station < 1) return;
  const sheet = openSheet("Storico");
  sheet.body.replaceChildren(h("p", {}, "Caricamento…"));
  try {
    const hst = await api<History>(`/api/admin/history?p=${PROV}&id=${station}`);
    sheet.body.replaceChildren(
      h("p", {}, h("strong", {}, place(station))),
      hst.frozen
        ? h(
            "p",
            { class: "note-box" },
            `Congelato fino alle ${when(hst.frozen.until)}: «${hst.frozen.note}»`,
          )
        : "",
      ...hst.overrides.map((ov) =>
        h(
          "p",
          { class: "note-box" },
          `Indicazione di QUI, ${fuelName(ov.fuel)} ${STATE_NAME[ov.state]} fino alle ${when(ov.until)}: «${ov.note}»`,
        ),
      ),
      hst.transitions.length === 0
        ? h("p", { class: "muted" }, "Nessun cambio di stato negli ultimi 30 giorni.")
        : list(
            hst.transitions.map((t) =>
              h(
                "li",
                {},
                `${when(t.ts)} · ${fuelName(t.fuel)}: ${t.from_state === null ? "—" : STATE_NAME[t.from_state]} → ${STATE_NAME[t.to_state]} (${CAUSE[t.cause] ?? t.cause}; ${t.confirmations} conferme, ${t.absences} assenze)`,
              ),
            ),
            true,
          ),
    );
  } catch (err) {
    sheet.body.replaceChildren(
      h("p", { class: "err" }, err instanceof Error ? err.message : "errore"),
    );
  }
}

// ------------------------------------------------------------------ caricamento

/** Una notifica del browser per ogni avviso nuovo, anche con la scheda in secondo piano. */
function notifyNew(o: Overview): void {
  const ids = new Set(o.alerts.map((a) => a.id));
  const seen = view.seenAlerts;
  view.seenAlerts = ids;
  if (!seen || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const a of o.alerts) {
    if (seen.has(a.id)) continue;
    new Notification(`QUI · ${KIND[a.kind] ?? a.kind}`, {
      body: `${place(a.station)} · ${fuelName(a.fuel)}`,
      tag: `qui-alert-${a.id}`,
    });
  }
}

async function currentStates(): Promise<Current> {
  const current: Current = new Map();
  try {
    const snap = await loadSnapshot(PROV);
    for (const row of snap.rows.values()) {
      const [id, fuel, state] = row;
      if (state === State.GREY) continue;
      current.set(id, [...(current.get(id) ?? []), { fuel, state }]);
    }
  } catch {
    // il quadro della provincia resta vuoto, il resto della pagina funziona
  }
  return current;
}

async function load(): Promise<void> {
  try {
    const [o, reports, current] = await Promise.all([
      api<Overview>(`/api/admin/overview?p=${PROV}`),
      api<Report[]>(`/api/admin/reports?p=${PROV}`),
      currentStates(),
    ]);
    notifyNew(o);
    document.title = `${o.alerts.length > 0 ? `(${o.alerts.length}) ` : ""}Amministrazione — QUI`;
    app.replaceChildren(
      h(
        "p",
        { class: "muted small" },
        `Provincia di Avellino · aggiornato alle ${when(Date.now())}`,
      ),
      navSection(),
      alertsSection(o),
      contestsSection(o),
      provinceSection(o, current),
      searchSection(o),
      reportsSection(reports, o),
      interventionsSection(o),
      noticeSection(o),
      securitySection(o),
      trendSection(o),
      logSection(o),
    );
  } catch (err) {
    app.replaceChildren(
      h("p", { class: "err" }, err instanceof Error ? err.message : "errore"),
      h(
        "p",
        { class: "muted" },
        "Se il problema è l'accesso, controlla Cloudflare Access e i secret ACCESS_TEAM_DOMAIN, ACCESS_AUD e ADMIN_EMAILS.",
      ),
    );
  }
}

/** Il ridisegno automatico non deve rubare la ricerca, la selezione o un testo a metà. */
function busy(): boolean {
  const el = document.activeElement;
  return (
    !!document.querySelector(".overlay") ||
    view.selected.size > 0 ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

async function init(): Promise<void> {
  try {
    stations = new Map((await loadStations(PROV)).map((s) => [s.id, s]));
  } catch {
    // senza anagrafica si mostrano i codici degli impianti
  }
  await load();
  window.setInterval(() => {
    // Anche in secondo piano: così le notifiche dei nuovi avvisi arrivano.
    if (!busy()) void load();
  }, REFRESH_MS);
}

void init();
